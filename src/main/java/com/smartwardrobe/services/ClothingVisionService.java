package com.smartwardrobe.services;

import com.smartwardrobe.dto.ClothingAnalysisResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.json.JsonParserFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * ClothingVisionService
 * ─────────────────────
 * AI clothing recognition for the Add to Wardrobe flow, backed by the Google
 * Gemini API.
 *
 * Detects ONLY: clothing category (ClothingItem.type), primary colour and
 * pattern — for the
 * main garment and, in the same single request, for each distinct garment in an
 * outfit photo.
 * Season, occasion, brand, rating and price are never requested from the model;
 * the user
 * enters them by hand.
 *
 * The model is constrained to the values the application already uses
 * (CONFIG.ALL_TYPES and
 * CONFIG.COLORS in the frontend) and may answer "unknown". Anything unknown,
 * outside the
 * allowed lists, or below the confidence threshold is returned as null so the
 * UI leaves the
 * field unselected instead of inventing a value.
 *
 * One image = one request. The API key is read from GEMINI_API_KEY on the
 * server only.
 */
@Service
public class ClothingVisionService {

    private static final Logger log = LoggerFactory.getLogger(ClothingVisionService.class);

    /** Same values as the Type dropdown / CONFIG.ALL_TYPES. */
    public static final List<String> CATEGORIES = List.of(
            "shirt", "t-shirt", "blouse", "top",
            "jacket", "sweater", "hoodie",
            "pants", "jeans", "shorts", "skirt", "trousers",
            "shoes", "sneakers", "boots", "sandals", "loafers");

    /** Same values as the Color dropdown / CONFIG.COLORS. */
    public static final List<String> COLORS = List.of(
            "white", "black", "blue", "red", "green", "navy",
            "gray", "brown", "beige", "pink", "yellow", "orange", "purple");

    /**
     * Pattern suggestions offered in the form (the pattern field itself stays free
     * text).
     */
    public static final List<String> PATTERNS = List.of(
            "solid", "striped", "checked", "graphic", "floral", "polka-dot");

    /**
     * Garment groups, matching what the in-browser clothing segmentation can
     * isolate.
     */
    public static final List<String> GROUPS = List.of("top", "bottom", "footwear", "dress");

    /**
     * Which group each category belongs to (a category in the wrong group is
     * discarded).
     */
    private static final Map<String, String> CATEGORY_GROUP = Map.ofEntries(
            Map.entry("shirt", "top"), Map.entry("t-shirt", "top"), Map.entry("blouse", "top"), Map.entry("top", "top"),
            Map.entry("jacket", "top"), Map.entry("sweater", "top"), Map.entry("hoodie", "top"),
            Map.entry("pants", "bottom"), Map.entry("jeans", "bottom"), Map.entry("shorts", "bottom"),
            Map.entry("skirt", "bottom"), Map.entry("trousers", "bottom"),
            Map.entry("shoes", "footwear"), Map.entry("sneakers", "footwear"), Map.entry("boots", "footwear"),
            Map.entry("sandals", "footwear"), Map.entry("loafers", "footwear"));

    private static final String UNKNOWN = "unknown";

    private static final String PROMPT = """
            You are labelling a photo for a wardrobe app.
            0. First set imageKind: "receipt" if the photo is a shop receipt / bill / invoice,
               "clothing" if it shows clothes or shoes, otherwise "other". For a receipt or other,
               answer "unknown" for every other field and return an empty garments list.
            The photo may show one garment, or a person wearing several garments.
            1. In "garments", list each distinct visible garment, at most one entry per group:
               - "top": the outermost upper-body garment (shirt, t-shirt, blouse, top, jacket, sweater, hoodie)
               - "bottom": trousers, jeans, shorts, pants or a skirt
               - "footwear": the pair of shoes
               - "dress": a one-piece dress
               For each give the closest allowed category, the garment's dominant colour and its surface pattern.
            2. In the top-level category/color/pattern fields, describe the most prominent garment.
            For every value also return a confidence between 0 and 1.
            If something is not clearly visible, matches no allowed value well, or you are not confident,
            answer "unknown" with a low confidence. Never guess, and leave out garments you cannot see.
            Do not describe season, occasion, brand, price or quality.""";

    @Value("${gemini.api-key:}")
    private String apiKey;

    @Value("${gemini.model:gemini-flash-latest}")
    private String model;

    /**
     * Comma-separated models tried, in order, when the main model is busy or
     * unavailable.
     */
    @Value("${gemini.fallback-models:gemini-flash-lite-latest,gemini-flash-latest}")
    private String fallbackModels;

    @Value("${vision.min-confidence:0.6}")
    private double minConfidence;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    /**
     * Thrown when recognition is not configured (no API key): the UI falls back to
     * manual entry.
     */
    public static class VisionUnavailableException extends RuntimeException {
        public VisionUnavailableException(String message) {
            super(message);
        }
    }

    /**
     * Thrown when the AI provider fails, rejects the request or returns something
     * unusable.
     */
    public static class VisionAnalysisException extends RuntimeException {
        private final int status;

        public VisionAnalysisException(int status, String message) {
            super(message);
            this.status = status;
        }

        public int getStatus() {
            return status;
        }
    }

    public boolean isConfigured() {
        return apiKey != null && !apiKey.isBlank();
    }

    /**
     * Sends the image to Gemini once and returns the interpreted result.
     */
    public ClothingAnalysisResponse analyze(byte[] imageBytes, String contentType) {
        if (!isConfigured()) {
            throw new VisionUnavailableException(
                    "AI recognition is not configured on the server (GEMINI_API_KEY is missing). "
                            + "Fill in the details manually.");
        }
        String body = buildRequestBody(Base64.getEncoder().encodeToString(imageBytes),
                contentType == null || contentType.isBlank() ? "image/jpeg" : contentType);
        return interpretResponse(callGemini(body), minConfidence);
    }

    /**
     * Sends a ready-made generateContent request body to Gemini and returns the raw
     * response body.
     * Shared with ReceiptOcrService so both use the same key, model and error
     * handling.
     *
     * Gemini often answers 500/503 ("model overloaded") or times out when busy.
     * Each model is
     * tried up to MAX_ATTEMPTS times with a short back-off, then the next model in
     * GEMINI_FALLBACK_MODELS is tried. The whole call stays inside TOTAL_BUDGET so
     * the frontend
     * (which waits longer) always gets a real answer instead of its own timeout.
     */
    public String callGemini(String requestBody) {
        if (!isConfigured()) {
            throw new VisionUnavailableException("AI is not configured on the server (GEMINI_API_KEY is missing).");
        }
        List<String> models = new ArrayList<>();
        models.add(model.trim());
        if (fallbackModels != null) {
            for (String m : fallbackModels.split(",")) {
                String t = m.trim();
                if (!t.isEmpty() && !models.contains(t))
                    models.add(t);
            }
        }

        long deadline = System.nanoTime() + TOTAL_BUDGET.toNanos();
        VisionAnalysisException last = null;
        for (String m : models) {
            for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                long remainingMs = (deadline - System.nanoTime()) / 1_000_000;
                if (remainingMs < 5_000) {
                    throw last != null ? last : new VisionAnalysisException(502, "The AI service took too long.");
                }
                try {
                    String body = callModelOnce(m, requestBody,
                            Duration.ofMillis(Math.min(remainingMs, PER_ATTEMPT.toMillis())));
                    if (!m.equals(model.trim()) || attempt > 1) {
                        log.info("Gemini succeeded with model {} on attempt {}", m, attempt);
                    }
                    return body;
                } catch (RetryableException e) {
                    last = new VisionAnalysisException(502, e.getMessage());
                    log.warn("Gemini model {} attempt {}/{} failed: {}", m, attempt, MAX_ATTEMPTS, e.getMessage());
                    if (e.skipModel)
                        break; // e.g. 404: this model name is not available, try the next one
                    sleepQuietly(1_500L * attempt);
                }
            }
        }
        throw last != null ? last : new VisionAnalysisException(502, "The AI service returned an error.");
    }

    private static final int MAX_ATTEMPTS = 2;
    private static final Duration PER_ATTEMPT = Duration.ofSeconds(40);
    private static final Duration TOTAL_BUDGET = Duration.ofSeconds(85);

    /**
     * A failure worth trying again (overloaded, server error, timeout) or with
     * another model (404).
     */
    private static class RetryableException extends RuntimeException {
        final boolean skipModel;

        RetryableException(String message, boolean skipModel) {
            super(message);
            this.skipModel = skipModel;
        }
    }

    private String callModelOnce(String modelName, String requestBody, Duration timeout) {
        String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                + URLEncoder.encode(modelName, StandardCharsets.UTF_8) + ":generateContent";

        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .header("x-goog-api-key", apiKey.trim())
                .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                .build();

        HttpResponse<String> response;
        try {
            response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new RetryableException("Could not reach the AI service: " + e.getMessage(), false);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new VisionAnalysisException(502, "AI request was interrupted.");
        }

        int status = response.statusCode();
        if (status >= 200 && status < 300) {
            return response.body();
        }
        if (status == 429) {
            throw new VisionAnalysisException(429,
                    "The AI service quota has been reached. Try again later or fill in the details manually.");
        }
        if (status == 404) {
            log.error("Gemini model {} not found: {}", modelName, abbreviate(response.body()));
            throw new RetryableException("The AI model '" + modelName + "' is not available (HTTP 404).", true);
        }
        if (status == 400 || status == 401 || status == 403) {
            log.error("Gemini rejected the request ({}): {}", status, abbreviate(response.body()));
            throw new VisionAnalysisException(502,
                    "The AI service rejected the request (HTTP " + status
                            + "). Check GEMINI_API_KEY and GEMINI_MODEL.");
        }
        log.error("Gemini error ({}) from {}: {}", status, modelName, abbreviate(response.body()));
        throw new RetryableException("The AI service returned an error (HTTP " + status + ").", false);
    }

    private static void sleepQuietly(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    // ── Request / response handling (static so it can be unit-tested without HTTP)
    // ──

    static String buildRequestBody(String base64Image, String mimeType) {
        return "{"
                + "\"contents\":[{\"parts\":["
                + "{\"text\":" + json(PROMPT) + "},"
                + "{\"inline_data\":{\"mime_type\":" + json(mimeType) + ",\"data\":" + json(base64Image) + "}}"
                + "]}],"
                + "\"generationConfig\":{"
                + "\"temperature\":0,"
                + "\"responseMimeType\":\"application/json\","
                + "\"responseSchema\":{\"type\":\"OBJECT\",\"properties\":{"
                + "\"imageKind\":{\"type\":\"STRING\",\"enum\":[\"clothing\",\"receipt\",\"other\"]},"
                + garmentProperties() + ","
                + "\"garments\":{\"type\":\"ARRAY\",\"items\":{\"type\":\"OBJECT\",\"properties\":{"
                + "\"group\":{\"type\":\"STRING\",\"enum\":" + jsonArray(GROUPS) + "},"
                + garmentProperties()
                + "},\"required\":[\"group\"," + REQUIRED_FIELDS + "]}}"
                + "},\"required\":[\"imageKind\"," + REQUIRED_FIELDS + ",\"garments\"]}"
                + "}}";
    }

    private static final String REQUIRED_FIELDS = "\"category\",\"categoryConfidence\",\"color\",\"colorConfidence\",\"pattern\",\"patternConfidence\"";

    private static String garmentProperties() {
        return "\"category\":" + enumSchema(CATEGORIES) + ","
                + "\"categoryConfidence\":{\"type\":\"NUMBER\"},"
                + "\"color\":" + enumSchema(COLORS) + ","
                + "\"colorConfidence\":{\"type\":\"NUMBER\"},"
                + "\"pattern\":" + enumSchema(PATTERNS) + ","
                + "\"patternConfidence\":{\"type\":\"NUMBER\"}";
    }

    /**
     * Turns the raw Gemini response into a ClothingAnalysisResponse, dropping every
     * value that is
     * unknown, not in the allowed list, or below {@code threshold}.
     */
    @SuppressWarnings("unchecked")
    static ClothingAnalysisResponse interpretResponse(String responseBody, double threshold) {
        Map<String, Object> fields = extractJson(responseBody);

        Double categoryConf = number(fields.get("categoryConfidence"));
        Double colorConf = number(fields.get("colorConfidence"));
        Double patternConf = number(fields.get("patternConfidence"));

        ClothingAnalysisResponse result = new ClothingAnalysisResponse(
                accept(fields.get("category"), categoryConf, CATEGORIES, threshold),
                accept(fields.get("color"), colorConf, COLORS, threshold),
                accept(fields.get("pattern"), patternConf, PATTERNS, threshold),
                categoryConf, colorConf, patternConf);
        Object kind = fields.get("imageKind");
        String k = kind instanceof String ks ? ks.trim().toLowerCase(Locale.ROOT) : "clothing";
        result.setImageKind(List.of("clothing", "receipt", "other").contains(k) ? k : "clothing");
        if (!result.getImageKind().equals("clothing")) {
            // Not a clothing photo: never return garment values for it.
            result.setCategory(null);
            result.setColor(null);
            result.setPattern(null);
            result.setGarments(new ArrayList<>());
        } else {
            result.setGarments(interpretGarments(fields.get("garments"), threshold));
        }
        return result;
    }

    /**
     * Pulls the model's JSON answer out of a generateContent response (shared with
     * receipts).
     */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> extractJson(String responseBody) {
        Map<String, Object> root;
        try {
            root = JsonParserFactory.getJsonParser().parseMap(responseBody);
        } catch (RuntimeException e) {
            throw new VisionAnalysisException(502, "The AI service returned an unreadable response.");
        }

        Object candidatesObj = root.get("candidates");
        if (!(candidatesObj instanceof List<?> candidates) || candidates.isEmpty()) {
            throw new VisionAnalysisException(422,
                    "The AI could not analyse this image. Fill in the details manually.");
        }

        StringBuilder text = new StringBuilder();
        Object first = candidates.get(0);
        if (first instanceof Map<?, ?> candidate
                && candidate.get("content") instanceof Map<?, ?> content
                && content.get("parts") instanceof List<?> parts) {
            for (Object part : parts) {
                if (part instanceof Map<?, ?> p && p.get("text") instanceof String s) {
                    text.append(s);
                }
            }
        }
        if (text.isEmpty()) {
            throw new VisionAnalysisException(422,
                    "The AI could not analyse this image. Fill in the details manually.");
        }
        try {
            return JsonParserFactory.getJsonParser().parseMap(stripCodeFence(text.toString()));
        } catch (RuntimeException e) {
            throw new VisionAnalysisException(502, "The AI service returned an unreadable result.");
        }
    }

    /**
     * At most one garment per group (the most confident one); categories must fit
     * their group.
     */
    private static List<ClothingAnalysisResponse.Garment> interpretGarments(Object raw, double threshold) {
        Map<String, ClothingAnalysisResponse.Garment> byGroup = new LinkedHashMap<>();
        if (!(raw instanceof List<?> list))
            return new ArrayList<>();
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> g))
                continue;
            if (!(g.get("group") instanceof String groupRaw))
                continue;
            String group = groupRaw.trim().toLowerCase(Locale.ROOT);
            if (!GROUPS.contains(group))
                continue;

            Double catConf = number(g.get("categoryConfidence"));
            Double colConf = number(g.get("colorConfidence"));
            Double patConf = number(g.get("patternConfidence"));
            String category = accept(g.get("category"), catConf, CATEGORIES, threshold);
            if (category != null && !group.equals(CATEGORY_GROUP.get(category)))
                category = null;

            ClothingAnalysisResponse.Garment garment = new ClothingAnalysisResponse.Garment(group, category,
                    accept(g.get("color"), colConf, COLORS, threshold),
                    accept(g.get("pattern"), patConf, PATTERNS, threshold),
                    catConf, colConf, patConf);
            ClothingAnalysisResponse.Garment existing = byGroup.get(group);
            if (existing == null || conf(catConf) > conf(existing.getCategoryConfidence())) {
                byGroup.put(group, garment);
            }
        }
        return new ArrayList<>(byGroup.values());
    }

    private static double conf(Double d) {
        return d == null ? 0 : d;
    }

    private static String accept(Object value, Double confidence, List<String> allowed, double threshold) {
        if (!(value instanceof String s))
            return null;
        String v = s.trim().toLowerCase(Locale.ROOT);
        if (v.isEmpty() || v.equals(UNKNOWN) || !allowed.contains(v))
            return null;
        if (confidence == null || confidence < threshold)
            return null;
        return v;
    }

    static Double number(Object o) {
        if (o instanceof Number n)
            return n.doubleValue();
        if (o instanceof String s) {
            try {
                return Double.parseDouble(s.trim());
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private static String stripCodeFence(String s) {
        String t = s.trim();
        if (t.startsWith("```")) {
            t = t.replaceFirst("^```[a-zA-Z]*\\s*", "").replaceFirst("\\s*```$", "");
        }
        return t;
    }

    private static String jsonArray(List<String> values) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < values.size(); i++)
            sb.append(i == 0 ? "" : ",").append(json(values.get(i)));
        return sb.append(']').toString();
    }

    private static String enumSchema(List<String> values) {
        StringBuilder sb = new StringBuilder("{\"type\":\"STRING\",\"enum\":[");
        for (String v : values)
            sb.append(json(v)).append(',');
        sb.append(json(UNKNOWN)).append("]}");
        return sb.toString();
    }

    /**
     * Minimal JSON string encoder for the values above (prompt text, enum values,
     * base64).
     */
    static String json(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20)
                        sb.append(String.format("\\u%04x", (int) c));
                    else
                        sb.append(c);
                }
            }
        }
        return sb.append('"').toString();
    }

    private static String abbreviate(String s) {
        if (s == null)
            return "";
        return s.length() > 500 ? s.substring(0, 500) + "…" : s;
    }
}