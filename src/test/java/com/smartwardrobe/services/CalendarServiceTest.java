package com.smartwardrobe.services;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** iCal parsing: today's events, time zones, repeats and the dress code they imply. */
class CalendarServiceTest {

    private static final ZoneOffset IST = ZoneOffset.ofHoursMinutes(5, 30);
    private static final LocalDate DAY = LocalDate.of(2026, 10, 12);   // a Monday

    private static final String ICS = String.join("\r\n",
            "BEGIN:VCALENDAR", "VERSION:2.0",
            "BEGIN:VEVENT", "SUMMARY:Client meeting with Acme", "DTSTART:20261012T053000Z", "END:VEVENT",
            "BEGIN:VEVENT", "SUMMARY:Lecture: Data Str", " uctures", "DTSTART;TZID=Asia/Kolkata:20260907T090000",
            "RRULE:FREQ=WEEKLY;BYDAY=MO,WE", "END:VEVENT",
            "BEGIN:VEVENT", "SUMMARY:Gym", "DTSTART;TZID=Asia/Kolkata:20261001T070000", "RRULE:FREQ=DAILY;UNTIL=20261005T000000Z", "END:VEVENT",
            "BEGIN:VEVENT", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261012", "END:VEVENT",
            "BEGIN:VEVENT", "SUMMARY:Standup", "DTSTART;TZID=Asia/Kolkata:20261005T100000", "RRULE:FREQ=WEEKLY", "EXDATE;TZID=Asia/Kolkata:20261012T100000", "END:VEVENT",
            "BEGIN:VEVENT", "SUMMARY:Tomorrow's wedding", "DTSTART:20261013T120000Z", "END:VEVENT",
            "END:VCALENDAR");

    @Test
    void findsTodaysEventsInTheUsersTimeZone() {
        List<CalendarService.CalendarEvent> events = CalendarService.eventsOn(ICS, DAY, IST);
        assertEquals(List.of("Holiday", "Lecture: Data Structures", "Client meeting with Acme"),
                events.stream().map(CalendarService.CalendarEvent::summary).toList());
        assertTrue(events.get(0).allDay());
        assertEquals("09:00", events.get(1).start(), "weekly repeat on Monday, unfolded title");
        assertEquals("11:00", events.get(2).start(), "05:30 UTC shown as 11:00 IST");
    }

    @Test
    void mostFormalEventSetsTheDressCode() {
        CalendarService.Today t = CalendarService.summarise(CalendarService.eventsOn(ICS, DAY, IST));
        assertEquals("work", t.suggestedEvent());
        assertEquals("Client meeting with Acme", t.title());
        assertEquals("college", t.events().get(1).dressCode());
    }

    @Test
    void emptyDayHasNoSuggestion() {
        CalendarService.Today t = CalendarService.summarise(CalendarService.eventsOn(ICS, LocalDate.of(2026, 10, 14).plusDays(1), IST));
        assertEquals(0, t.events().size());
        assertNull(t.suggestedEvent());
    }

    @Test
    void rejectsNonHttpAndPrivateLinks() {
        CalendarService svc = new CalendarService();
        assertEquals(400, assertThrows(CalendarService.CalendarException.class, () -> svc.fetch("file:///etc/passwd")).getStatus());
        assertEquals(400, assertThrows(CalendarService.CalendarException.class, () -> svc.fetch("http://127.0.0.1:8080/x.ics")).getStatus());
        assertEquals(400, assertThrows(CalendarService.CalendarException.class, () -> svc.fetch("https://192.168.1.10/cal.ics")).getStatus());
    }
}
