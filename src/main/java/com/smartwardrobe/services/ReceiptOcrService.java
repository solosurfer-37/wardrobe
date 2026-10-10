package com.smartwardrobe.services;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * ReceiptOcrService
 * ─────────────────
 * Reads a shopping receipt photo with Gemini (same GEMINI_API_KEY as clothing recognition, one
 * request per receipt) and returns the store, date, total and the clothing lines with prices.
 * The Add to Wardrobe form uses it to fill in brand and purchase price.
 *
 * Only what is printed on the receipt is returned: unreadable values are left out (null), and
 * non-clothing lines (bags, discounts, tax) are dropped.
 */
@Service
public class ReceiptOcrService {

    private static final String PROMPT = """
            Read this shopping receipt. Return:
            - store: the shop or brand name printed on the receipt
            - date: the purchase date as YYYY-MM-DD
            - currency: the currency code (e.g. INR, USD)
            - total: the total amount paid
            - items: one entry per CLOTHING or FOOTWEAR line with its name as printed, its price,
              the closest allowed category and colour if the line says so (else "unknown").
            Leave out bags, discounts, tax, gift cards and anything that is not clothing.
            If a value is not printed or not readable, use null (or "unknown" for category/color).
            Never invent values.""";

    private final ClothingVisionService gemini;

    public ReceiptOcrService(ClothingVisionService gemini) {
        this.gemini = gemini;
    }

    public record ReceiptLine(String name, Double price, String category, String color) {
    }

    public record Receipt(String store, String date, String currency, Double total, List<ReceiptLine> items) {
    }

    public boolean isConfigured() {
        return gemini.isConfigured();
    }

    public Receipt parse(byte[] imageBytes, String contentType) {
        String body = buildRequestBody(Base64.getEncoder().encodeToString(imageBytes),
                contentType == null || contentType.isBlank() ? "image/jpeg" : contentType);
        return interpret(ClothingVisionService.extractJson(gemini.callGemini(body)));
    }

    static String buildRequestBody(String base64Image, String mimeType) {
        String unknownEnum = ",\"unknown\"]";
        StringBuilder cats = new StringBuilder("[");
        ClothingVisionService.CATEGORIES.forEach(c -> cats.append(ClothingVisionService.json(c)).append(','));
        StringBuilder cols = new StringBuilder("[");
        ClothingVisionService.COLORS.forEach(c -> cols.append(ClothingVisionService.json(c)).append(','));
        String catEnum = cats.substring(0, cats.length() - 1) + unknownEnum;
        String colEnum = cols.substring(0, cols.length() - 1) + unknownEnum;
        return "{"
                + "\"contents\":[{\"parts\":["
                +   "{\"text\":" + ClothingVisionService.json(PROMPT) + "},"
                +   "{\"inline_data\":{\"mime_type\":" + ClothingVisionService.json(mimeType)
                +     ",\"data\":" + ClothingVisionService.json(base64Image) + "}}"
                + "]}],"
                + "\"generationConfig\":{\"temperature\":0,\"responseMimeType\":\"application/json\","
                +   "\"responseSchema\":{\"type\":\"OBJECT\",\"properties\":{"
                +     "\"store\":{\"type\":\"STRING\",\"nullable\":true},"
                +     "\"date\":{\"type\":\"STRING\",\"nullable\":true},"
                +     "\"currency\":{\"type\":\"STRING\",\"nullable\":true},"
                +     "\"total\":{\"type\":\"NUMBER\",\"nullable\":true},"
                +     "\"items\":{\"type\":\"ARRAY\",\"items\":{\"type\":\"OBJECT\",\"properties\":{"
                +       "\"name\":{\"type\":\"STRING\"},"
                +       "\"price\":{\"type\":\"NUMBER\",\"nullable\":true},"
                +       "\"category\":{\"type\":\"STRING\",\"enum\":" + catEnum + "},"
                +       "\"color\":{\"type\":\"STRING\",\"enum\":" + colEnum + "}"
                +     "},\"required\":[\"name\",\"category\",\"color\"]}}"
                +   "},\"required\":[\"items\"]}"
                + "}}";
    }

    static Receipt interpret(Map<String, Object> f) {
        List<ReceiptLine> lines = new ArrayList<>();
        if (f.get("items") instanceof List<?> items) {
            Map<String, ReceiptLine> seen = new LinkedHashMap<>();
            for (Object o : items) {
                if (!(o instanceof Map<?, ?> m) || !(m.get("name") instanceof String name) || name.isBlank()) continue;
                Double price = ClothingVisionService.number(m.get("price"));
                if (price != null && price < 0) price = null;
                ReceiptLine line = new ReceiptLine(name.trim(), price,
                        allowed(m.get("category"), ClothingVisionService.CATEGORIES),
                        allowed(m.get("color"), ClothingVisionService.COLORS));
                seen.putIfAbsent(line.name().toLowerCase(Locale.ROOT) + "|" + price, line);
            }
            lines.addAll(seen.values());
        }
        String date = f.get("date") instanceof String d && d.matches("\\d{4}-\\d{2}-\\d{2}") ? d : null;
        Double total = ClothingVisionService.number(f.get("total"));
        return new Receipt(text(f.get("store")), date, text(f.get("currency")), total, lines);
    }

    private static String allowed(Object v, List<String> values) {
        if (!(v instanceof String s)) return null;
        String t = s.trim().toLowerCase(Locale.ROOT);
        return values.contains(t) ? t : null;
    }

    private static String text(Object v) {
        return v instanceof String s && !s.isBlank() && !s.equalsIgnoreCase("null") ? s.trim() : null;
    }
}
