package com.smartwardrobe.services;

import com.smartwardrobe.engine.OutfitEngine;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * CalendarService
 * ───────────────
 * Reads today's events from the user's calendar through its private iCal (.ics) link — Google
 * Calendar ("Secret address in iCal format"), Outlook ("Publish calendar → ICS") and Apple iCloud
 * all provide one. No API key and no OAuth: the user pastes the link once.
 *
 * The event titles become the outfit engine's dress code (OutfitEngine.Event.parse):
 * "Client meeting" → work, "Wedding" → formal, "Lecture" → college, ...
 *
 * Supported: single and all-day events, UTC / TZID / floating times, and simple repeats
 * (FREQ=DAILY / WEEKLY with INTERVAL, BYDAY, UNTIL, COUNT). Exceptions (EXDATE) are honoured;
 * other complex repeat rules are skipped.
 */
@Service
public class CalendarService {

    private static final int MAX_BYTES = 3 * 1024 * 1024;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    public record CalendarEvent(String summary, String start, boolean allDay, String dressCode) {
    }

    public record Today(List<CalendarEvent> events, String suggestedEvent, String title) {
    }

    public static class CalendarException extends RuntimeException {
        private final int status;
        public CalendarException(int status, String message) { super(message); this.status = status; }
        public int getStatus() { return status; }
    }

    public Today today(String icsUrl, LocalDate date, int tzOffsetMinutes) {
        String ics = fetch(icsUrl);
        return summarise(eventsOn(ics, date, ZoneOffset.ofTotalSeconds(tzOffsetMinutes * 60)));
    }

    // ── Fetching (only public https/http hosts) ──────────────────────────

    String fetch(String rawUrl) {
        if (rawUrl == null || rawUrl.isBlank()) throw new CalendarException(400, "Calendar link is required.");
        String url = rawUrl.trim().replaceFirst("(?i)^webcals?://", "https://");
        URI uri;
        try {
            uri = URI.create(url);
        } catch (IllegalArgumentException e) {
            throw new CalendarException(400, "That calendar link is not a valid URL.");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http") || uri.getHost() == null) {
            throw new CalendarException(400, "Use the calendar's https iCal (.ics) link.");
        }
        assertPublicHost(uri.getHost());

        HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(15)).GET().build();
        HttpResponse<byte[]> response;
        try {
            response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
        } catch (IOException e) {
            throw new CalendarException(502, "Could not download the calendar: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CalendarException(502, "Calendar download was interrupted.");
        }
        if (response.statusCode() == 404 || response.statusCode() == 403 || response.statusCode() == 401) {
            throw new CalendarException(502, "The calendar link was refused (HTTP " + response.statusCode()
                    + "). Copy the private/secret iCal address again.");
        }
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new CalendarException(502, "The calendar server answered HTTP " + response.statusCode() + ".");
        }
        if (response.body().length > MAX_BYTES) throw new CalendarException(413, "The calendar file is too large.");
        String text = new String(response.body(), StandardCharsets.UTF_8);
        if (!text.contains("BEGIN:VCALENDAR")) {
            throw new CalendarException(422, "That link did not return an iCal calendar (.ics).");
        }
        return text;
    }

    /** Blocks links to this machine or private networks, so the endpoint cannot probe internal services. */
    private static void assertPublicHost(String host) {
        try {
            for (InetAddress a : InetAddress.getAllByName(host)) {
                if (a.isLoopbackAddress() || a.isSiteLocalAddress() || a.isLinkLocalAddress()
                        || a.isAnyLocalAddress() || a.isMulticastAddress()) {
                    throw new CalendarException(400, "Calendar links must point to a public calendar service.");
                }
            }
        } catch (java.net.UnknownHostException e) {
            throw new CalendarException(400, "Unknown calendar host: " + host);
        }
    }

    // ── Parsing (static, unit-tested) ────────────────────────────────────

    private record RawEvent(String summary, String dtStart, String dtStartParams, String rrule, List<String> exDates) {
    }

    static List<CalendarEvent> eventsOn(String ics, LocalDate day, ZoneOffset userOffset) {
        List<CalendarEvent> out = new ArrayList<>();
        for (RawEvent ev : parse(ics)) {
            if (ev.dtStart() == null) continue;
            boolean allDay = ev.dtStartParams().toUpperCase(Locale.ROOT).contains("VALUE=DATE") || ev.dtStart().length() == 8;
            LocalDateTime start = toUserTime(ev.dtStart(), ev.dtStartParams(), userOffset);
            if (start == null) continue;
            if (!occursOn(start, ev.rrule(), ev.exDates(), day, userOffset)) continue;
            String summary = ev.summary() == null || ev.summary().isBlank() ? "Event" : ev.summary();
            out.add(new CalendarEvent(summary, allDay ? null : start.toLocalTime().toString(), allDay,
                    OutfitEngine.Event.parse(summary).label()));
        }
        out.sort(Comparator.comparing((CalendarEvent e) -> e.allDay() ? "" : e.start()));
        return out;
    }

    static Today summarise(List<CalendarEvent> events) {
        OutfitEngine.Event best = null;
        String title = null;
        for (CalendarEvent e : events) {
            OutfitEngine.Event ev = OutfitEngine.Event.parse(e.summary());
            if (best == null || ev.formality() > best.formality()) { best = ev; title = e.summary(); }
        }
        return new Today(events, best == null ? null : best.label(), title);
    }

    private static List<RawEvent> parse(String ics) {
        // Unfold continuation lines (RFC 5545: a line starting with space/tab continues the previous one)
        String unfolded = ics.replace("\r\n", "\n").replace("\r", "\n").replaceAll("\n[ \t]", "");
        List<RawEvent> events = new ArrayList<>();
        String summary = null, dt = null, dtParams = "", rrule = null;
        List<String> ex = new ArrayList<>();
        boolean inEvent = false;
        for (String line : unfolded.split("\n")) {
            if (line.equals("BEGIN:VEVENT")) { inEvent = true; summary = null; dt = null; dtParams = ""; rrule = null; ex = new ArrayList<>(); continue; }
            if (line.equals("END:VEVENT")) { if (inEvent) events.add(new RawEvent(summary, dt, dtParams, rrule, ex)); inEvent = false; continue; }
            if (!inEvent) continue;
            int colon = line.indexOf(':');
            if (colon < 0) continue;
            String head = line.substring(0, colon), value = line.substring(colon + 1);
            String name = head.contains(";") ? head.substring(0, head.indexOf(';')) : head;
            String params = head.contains(";") ? head.substring(head.indexOf(';') + 1) : "";
            switch (name.toUpperCase(Locale.ROOT)) {
                case "SUMMARY" -> summary = value.replace("\\,", ",").replace("\\;", ";").replace("\\n", " ").trim();
                case "DTSTART" -> { dt = value.trim(); dtParams = params; }
                case "RRULE" -> rrule = value.trim();
                case "EXDATE" -> { for (String d : value.split(",")) ex.add(d.trim().length() >= 8 ? d.trim().substring(0, 8) : d.trim()); }
                default -> { }
            }
        }
        return events;
    }

    private static LocalDateTime toUserTime(String value, String params, ZoneOffset userOffset) {
        try {
            if (value.length() == 8) return LocalDate.parse(value, DateTimeFormatter.BASIC_ISO_DATE).atStartOfDay();
            boolean utc = value.endsWith("Z");
            LocalDateTime t = LocalDateTime.parse(value.replace("Z", ""), DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss"));
            if (utc) return t.atOffset(ZoneOffset.UTC).withOffsetSameInstant(userOffset).toLocalDateTime();
            String tzid = param(params, "TZID");
            if (tzid != null) {
                try {
                    return t.atZone(ZoneId.of(tzid)).withZoneSameInstant(userOffset).toLocalDateTime();
                } catch (Exception ignored) { /* unknown zone name: treat as local time */ }
            }
            return t;
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean occursOn(LocalDateTime start, String rrule, List<String> exDates, LocalDate day, ZoneOffset offset) {
        LocalDate first = start.toLocalDate();
        if (exDates.contains(day.format(DateTimeFormatter.BASIC_ISO_DATE))) return false;
        if (rrule == null) return first.equals(day);
        if (day.isBefore(first)) return false;

        String freq = param(rrule, "FREQ");
        int interval = parseInt(param(rrule, "INTERVAL"), 1);
        String until = param(rrule, "UNTIL");
        if (until != null) {
            LocalDateTime u = toUserTime(until.length() >= 8 ? until : until, "", offset);
            if (u != null && day.isAfter(u.toLocalDate())) return false;
        }
        Integer count = param(rrule, "COUNT") == null ? null : parseInt(param(rrule, "COUNT"), Integer.MAX_VALUE);

        if ("DAILY".equals(freq)) {
            long n = ChronoUnit.DAYS.between(first, day);
            return n % interval == 0 && (count == null || n / interval < count);
        }
        if ("WEEKLY".equals(freq)) {
            List<DayOfWeek> days = new ArrayList<>();
            String byDay = param(rrule, "BYDAY");
            if (byDay != null) for (String d : byDay.split(",")) { DayOfWeek w = dayOf(d.replaceAll("[^A-Z]", "")); if (w != null) days.add(w); }
            if (days.isEmpty()) days.add(first.getDayOfWeek());
            if (!days.contains(day.getDayOfWeek())) return false;
            long weeks = ChronoUnit.WEEKS.between(first.minusDays(first.getDayOfWeek().getValue() - 1),
                    day.minusDays(day.getDayOfWeek().getValue() - 1));
            if (weeks % interval != 0) return false;
            return count == null || (weeks / interval) * days.size() < count;   // approximate COUNT
        }
        return false;   // MONTHLY/YEARLY and other rules are not expanded
    }

    private static DayOfWeek dayOf(String code) {
        return switch (code) {
            case "MO" -> DayOfWeek.MONDAY; case "TU" -> DayOfWeek.TUESDAY; case "WE" -> DayOfWeek.WEDNESDAY;
            case "TH" -> DayOfWeek.THURSDAY; case "FR" -> DayOfWeek.FRIDAY; case "SA" -> DayOfWeek.SATURDAY;
            case "SU" -> DayOfWeek.SUNDAY; default -> null;
        };
    }

    private static String param(String list, String key) {
        for (String part : list.split(";")) {
            int eq = part.indexOf('=');
            if (eq > 0 && part.substring(0, eq).trim().equalsIgnoreCase(key)) return part.substring(eq + 1).trim();
        }
        return null;
    }

    private static int parseInt(String s, int dflt) {
        try { return s == null ? dflt : Integer.parseInt(s); } catch (NumberFormatException e) { return dflt; }
    }
}
