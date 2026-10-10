package com.smartwardrobe.services;

import com.smartwardrobe.dto.OutfitRecommendation;
import com.smartwardrobe.engine.OutfitEngine;
import com.smartwardrobe.entities.ClothingItem;
import com.smartwardrobe.entities.User;
import com.smartwardrobe.repositories.ClothingItemRepository;
import com.smartwardrobe.repositories.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.smartwardrobe.dto.OutfitRequest;

import java.time.LocalDate;
import java.time.Month;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * Orchestrates wardrobe loading, weather lookup and the single recommendation
 * engine.
 */
@Service
public class OutfitRecommendationService {
    private final ClothingItemRepository clothingItemRepository;
    private final UserRepository userRepository;
    private final WeatherService weatherService;
    private final OutfitEngine outfitEngine;

    public OutfitRecommendationService(ClothingItemRepository clothingItemRepository,
            UserRepository userRepository,
            WeatherService weatherService,
            OutfitEngine outfitEngine) {
        this.clothingItemRepository = clothingItemRepository;
        this.userRepository = userRepository;
        this.weatherService = weatherService;
        this.outfitEngine = outfitEngine;
    }

    /**
     * The project currently has no authentication/current-user component.
     * Until one exists, use the same deterministic first-user convention as the
     * demo wardrobe and never combine different users' clothing in one outfit.
     */
    @Transactional(readOnly = true)
    public List<OutfitRecommendation> recommendOutfits(double latitude, double longitude) {
        return recommendOutfits(latitude, longitude, null);
    }

    @Transactional(readOnly = true)
    public List<OutfitRecommendation> recommendOutfits(double latitude, double longitude, String event) {
        User wardrobeOwner = userRepository.findAll().stream()
                .min(Comparator.comparing(User::getId, Comparator.nullsLast(Comparator.naturalOrder())))
                .orElse(null);
        if (wardrobeOwner == null || wardrobeOwner.getId() == null) {
            return List.of();
        }

        List<ClothingItem> closet = clothingItemRepository.findByUserId(wardrobeOwner.getId());
        if (closet.isEmpty()) {
            return List.of();
        }

        OutfitEngine.WeatherContext weather = weatherService.getWeatherContext(latitude, longitude);
        return outfitEngine.recommend(closet, weather, OutfitEngine.Event.parse(event));
    }

    // ── Logged-in user's wardrobe sent by the frontend (Supabase) ────────

    /** Result of a recommendation request, with the context the engine used. */
    public record Result(List<OutfitRecommendation> outfits, OutfitEngine.WeatherContext weather,
                         String event, String season, boolean seasonFiltered) {
    }

    /**
     * Runs the outfit engine on the wardrobe the frontend sent (the logged-in user's own items).
     * Items tagged for other seasons are left out first; if that leaves too few items to build an
     * outfit, the engine runs on the whole wardrobe instead.
     */
    public Result recommendFor(OutfitRequest request) {
        double lat = request.getLatitude() != null ? request.getLatitude() : 28.6139;
        double lon = request.getLongitude() != null ? request.getLongitude() : 77.2090;
        LocalDate today = parseDate(request.getDate());
        List<ClothingItem> closet = toClosetItems(request.getItems());
        OutfitEngine.Event event = OutfitEngine.Event.parse(request.getEvent());
        String season = seasonOf(today, lat);

        OutfitEngine.WeatherContext weather = weatherService.getWeatherContext(lat, lon);
        if (closet.isEmpty()) return new Result(List.of(), weather, event.label(), season, false);

        List<ClothingItem> inSeason = closet.stream().filter(i -> fitsSeason(i, season)).toList();
        if (inSeason.size() < closet.size()) {
            List<OutfitRecommendation> outfits = outfitEngine.recommend(inSeason, weather, event, today);
            if (!outfits.isEmpty()) return new Result(outfits, weather, event.label(), season, true);
        }
        return new Result(outfitEngine.recommend(closet, weather, event, today), weather, event.label(), season, false);
    }

    static List<ClothingItem> toClosetItems(List<OutfitRequest.ClosetItem> items) {
        List<ClothingItem> closet = new ArrayList<>();
        if (items == null) return closet;
        for (OutfitRequest.ClosetItem in : items) {
            if (in == null || in.getType() == null || in.getColor() == null) continue;
            ClothingItem c = new ClothingItem();
            c.setId(in.getId());
            c.setType(in.getType().toLowerCase(Locale.ROOT).trim());
            c.setColor(in.getColor().toLowerCase(Locale.ROOT).trim());
            c.setPattern(in.getPattern());
            c.setImageUrl(in.getImageUrl());
            c.setName(in.getName());
            c.setBrand(in.getBrand());
            c.setSeason(in.getSeason());
            c.setOccasion(in.getOccasion());
            c.setPrice(in.getPrice() != null ? in.getPrice() : 0.0);
            c.setRating(in.getRating());
            c.setWearCount(in.getWearCount() != null ? in.getWearCount() : 0);
            LocalDate worn = parseDateOrNull(in.getLastWornDate());
            c.setLastWornDate(worn);
            closet.add(c);
        }
        return closet;
    }

    /** Meteorological season for the date; flipped for the southern hemisphere. */
    static String seasonOf(LocalDate day, double latitude) {
        Month m = day.getMonth();
        String north = switch (m) {
            case MARCH, APRIL, MAY -> "spring";
            case JUNE, JULY, AUGUST -> "summer";
            case SEPTEMBER, OCTOBER, NOVEMBER -> "fall";
            default -> "winter";
        };
        if (latitude >= 0) return north;
        return switch (north) {
            case "spring" -> "fall";
            case "summer" -> "winter";
            case "fall" -> "spring";
            default -> "summer";
        };
    }

    /** Items without season tags fit every season. */
    static boolean fitsSeason(ClothingItem item, String season) {
        String s = item.getSeason();
        if (s == null || s.isBlank()) return true;
        return Arrays.stream(s.toLowerCase(Locale.ROOT).split("[,;/ ]+")).anyMatch(t -> t.equals(season)
                || (season.equals("fall") && t.equals("autumn")));
    }

    private static LocalDate parseDate(String raw) {
        LocalDate d = parseDateOrNull(raw);
        return d != null ? d : LocalDate.now();
    }

    private static LocalDate parseDateOrNull(String raw) {
        if (raw == null || raw.length() < 10) return null;
        try { return LocalDate.parse(raw.substring(0, 10)); } catch (Exception e) { return null; }
    }
}
