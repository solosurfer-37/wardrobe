package com.smartwardrobe.services;

import com.smartwardrobe.dto.OutfitRecommendation;
import com.smartwardrobe.dto.OutfitRequest;
import com.smartwardrobe.engine.OutfitEngine;
import com.smartwardrobe.entities.ClothingItem;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** The frontend-supplied wardrobe goes through the real OutfitEngine. */
class OutfitRecommendationServiceTest {

    private static OutfitRequest.ClosetItem item(long id, String type, String color, String season, int wears, String lastWorn) {
        OutfitRequest.ClosetItem i = new OutfitRequest.ClosetItem();
        i.setId(id); i.setType(type); i.setColor(color); i.setPattern("solid");
        i.setSeason(season); i.setWearCount(wears); i.setLastWornDate(lastWorn); i.setPrice(1000.0);
        return i;
    }

    private static List<OutfitRequest.ClosetItem> wardrobe() {
        List<OutfitRequest.ClosetItem> w = new ArrayList<>();
        w.add(item(1, "shirt", "white", "spring,summer,fall", 3, "2026-09-01"));
        w.add(item(2, "t-shirt", "navy", "summer", 10, "2026-10-09"));      // worn yesterday
        w.add(item(3, "trousers", "beige", "", 2, null));
        w.add(item(4, "jeans", "blue", "fall,winter", 8, "2026-09-20"));
        w.add(item(5, "loafers", "brown", null, 1, null));
        w.add(item(6, "sneakers", "white", null, 12, "2026-10-01"));
        w.add(item(7, "jacket", "gray", "fall,winter", 0, null));
        return w;
    }

    @Test
    void convertsFrontendItemsKeepingWearHistory() {
        List<ClothingItem> c = OutfitRecommendationService.toClosetItems(wardrobe());
        assertEquals(7, c.size());
        assertEquals(LocalDate.of(2026, 10, 9), c.get(1).getLastWornDate());
        assertEquals(10, c.get(1).getWearCount());
        assertNull(c.get(2).getLastWornDate());
    }

    @Test
    void seasonsFollowTheHemisphere() {
        assertEquals("fall", OutfitRecommendationService.seasonOf(LocalDate.of(2026, 10, 10), 28.6));
        assertEquals("spring", OutfitRecommendationService.seasonOf(LocalDate.of(2026, 10, 10), -33.9));
        ClothingItem summerOnly = new ClothingItem(); summerOnly.setSeason("summer");
        ClothingItem untagged = new ClothingItem();
        assertFalse(OutfitRecommendationService.fitsSeason(summerOnly, "fall"));
        assertTrue(OutfitRecommendationService.fitsSeason(untagged, "fall"));
    }

    @Test
    void realEngineUsesWeatherEventAndWearHistory() {
        OutfitEngine engine = new OutfitEngine();
        List<ClothingItem> closet = OutfitRecommendationService.toClosetItems(wardrobe());
        LocalDate today = LocalDate.of(2026, 10, 10);

        // Cold, rainy work day: a layer is required
        OutfitEngine.WeatherContext cold = new OutfitEngine.WeatherContext(9, 6, 13, 80, true, 12);
        List<OutfitRecommendation> work = engine.recommend(closet, cold, OutfitEngine.Event.parse("Client meeting"), today);
        assertFalse(work.isEmpty());
        work.forEach(o -> assertNotNull(o.getOuterwear(), "cold day → layered"));
        work.forEach(o -> assertNotEquals(2L, o.getTop().getId(), "worn yesterday → skipped"));
        assertNotNull(work.get(0).getReason());

        // Hot day: no outerwear
        OutfitEngine.WeatherContext hot = new OutfitEngine.WeatherContext(35, 28, 38, 0, false, 5);
        List<OutfitRecommendation> casual = engine.recommend(closet, hot, OutfitEngine.Event.parse("casual"), today);
        assertFalse(casual.isEmpty());
        casual.forEach(o -> assertNull(o.getOuterwear(), "hot day → no layer"));
    }
}
