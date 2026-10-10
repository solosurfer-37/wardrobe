package com.smartwardrobe.services;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** Receipt reading: only printed, allowed values are kept. */
class ReceiptOcrServiceTest {

    @Test
    void keepsClothingLinesAndDropsInvalidValues() {
        Map<String, Object> f = Map.of(
                "store", "ZUDIO", "date", "2026-09-30", "currency", "INR", "total", 1698,
                "items", List.of(
                        Map.of("name", "Regular Fit Polo", "price", 699, "category", "t-shirt", "color", "black"),
                        Map.of("name", "Denim Straight", "price", 999, "category", "jeans", "color", "unknown"),
                        Map.of("name", "Regular Fit Polo", "price", 699, "category", "t-shirt", "color", "black"),
                        Map.of("name", "Mystery", "price", -5, "category", "cape", "color", "teal")));
        ReceiptOcrService.Receipt r = ReceiptOcrService.interpret(f);
        assertEquals("ZUDIO", r.store());
        assertEquals("2026-09-30", r.date());
        assertEquals(1698.0, r.total(), 1e-9);
        assertEquals(3, r.items().size(), "duplicate line merged");
        assertEquals("jeans", r.items().get(1).category());
        assertNull(r.items().get(1).color(), "unknown stays empty");
        assertNull(r.items().get(2).price(), "negative price dropped");
        assertNull(r.items().get(2).category(), "category outside the app's list dropped");
    }

    @Test
    void badDateIsIgnored() {
        assertNull(ReceiptOcrService.interpret(Map.of("date", "30/09/26", "items", List.of())).date());
    }

    @Test
    void requestAsksOnlyForReceiptFields() {
        String body = ReceiptOcrService.buildRequestBody("QUJD", "image/jpeg");
        assertTrue(body.contains("\"store\""));
        assertTrue(body.contains("\"items\""));
        assertTrue(body.contains("\"t-shirt\""));
        assertFalse(body.contains("\"season\""));
    }
}
