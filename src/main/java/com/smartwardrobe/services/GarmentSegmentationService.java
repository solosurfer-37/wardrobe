package com.smartwardrobe.services;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.json.JsonParserFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * GarmentSegmentationService
 * ──────────────────────────
 * Individual garment segmentation with Meta's SAM 3 through Roboflow's hosted API.
 *
 * SAM 3 takes text prompts ("jacket", "t-shirt", "jeans", "shoes", ...) and returns a separate
 * outline (polygon) for every matching garment. Unlike the in-browser SegFormer model, it can tell
 * a jacket from the shirt under it and works on flat-lay / hanger photos too.
 *
 * The service only returns outlines. The browser cuts the garment out of the user's ORIGINAL pixels,
 * so colours, prints and logos are never redrawn.
 *
 * One request per photo. The API key (ROBOFLOW_API_KEY) stays on the server.
 */
@Service
public class GarmentSegmentationService {

    private static final Logger log = LoggerFactory.getLogger(GarmentSegmentationService.class);

    /**
     * Text prompts sent to SAM 3 (max 16 per request). Each maps to the app's clothing type
     * (null = no matching type, the user picks one). Overlapping answers from similar prompts
     * (e.g. "shirt" and "t-shirt" on the same garment) are merged by Roboflow's cross-prompt NMS.
     */
    public static final Map<String, String> PROMPT_TYPES = orderedPrompts();

    private static Map<String, String> orderedPrompts() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("jacket", "jacket");
        m.put("coat", "jacket");
        m.put("sweater", "sweater");
        m.put("hoodie", "hoodie");
        m.put("shirt", "shirt");
        m.put("t-shirt", "t-shirt");
        m.put("blouse", "blouse");
        m.put("dress", null);
        m.put("skirt", "skirt");
        m.put("jeans", "jeans");
        m.put("trousers", "trousers");
        m.put("shorts", "shorts");
        m.put("shoes", "shoes");
        m.put("sneakers", "sneakers");
        m.put("boots", "boots");
        m.put("sandals", "sandals");
        return m;
    }

    @Value("${roboflow.api-key:}")
    private String apiKey;

    @Value("${roboflow.sam3.url:https://serverless.roboflow.com/sam3/concept_segment}")
    private String endpoint;

    @Value("${roboflow.sam3.min-confidence:0.5}")
    private double minConfidence;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    /** One garment outline found by SAM 3. Coordinates are pixels of the image that was sent. */
    public record Garment(String prompt, String type, double confidence, List<List<double[]>> polygons) {
    }

    public static class SegmentationUnavailableException extends RuntimeException {
        public SegmentationUnavailableException(String message) { super(message); }
    }

    public static class SegmentationException extends RuntimeException {
        private final int status;
        public SegmentationException(int status, String message) { super(message); this.status = status; }
        public int getStatus() { return status; }
    }

    public boolean isConfigured() {
        return apiKey != null && !apiKey.isBlank();
    }

    public List<Garment> segment(byte[] imageBytes) {
        if (!isConfigured()) {
            throw new SegmentationUnavailableException(
                    "SAM 3 garment segmentation is not configured on the server (ROBOFLOW_API_KEY is missing).");
        }
        HttpRequest request = HttpRequest.newBuilder(URI.create(endpoint))
                .timeout(Duration.ofSeconds(60))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey.trim())
                .POST(HttpRequest.BodyPublishers.ofString(
                        buildRequestBody(Base64.getEncoder().encodeToString(imageBytes), minConfidence)))
                .build();

        HttpResponse<String> response;
        try {
            response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new SegmentationException(502, "Could not reach the SAM 3 service: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new SegmentationException(502, "SAM 3 request was interrupted.");
        }

        int status = response.statusCode();
        if (status == 429 || status == 402) {
            throw new SegmentationException(429, "The SAM 3 free quota has been used up. Try again later.");
        }
        if (status == 401 || status == 403) {
            log.error("Roboflow rejected the API key ({}): {}", status, abbreviate(response.body()));
            throw new SegmentationException(502, "Roboflow rejected the request (HTTP " + status + "). Check ROBOFLOW_API_KEY.");
        }
        if (status < 200 || status >= 300) {
            log.error("Roboflow SAM 3 error ({}): {}", status, abbreviate(response.body()));
            throw new SegmentationException(502, "The SAM 3 service returned an error (HTTP " + status + ").");
        }
        return parseResponse(response.body(), minConfidence);
    }

    // ── Request / response handling (static so it can be unit-tested without HTTP) ──

    static String buildRequestBody(String base64Image, double threshold) {
        StringBuilder prompts = new StringBuilder();
        for (String p : PROMPT_TYPES.keySet()) {
            if (!prompts.isEmpty()) prompts.append(',');
            prompts.append("{\"type\":\"text\",\"text\":").append(ClothingVisionService.json(p)).append('}');
        }
        return "{"
                + "\"image\":{\"type\":\"base64\",\"value\":" + ClothingVisionService.json(base64Image) + "},"
                + "\"prompts\":[" + prompts + "],"
                + "\"format\":\"polygon\","
                + "\"output_prob_thresh\":" + threshold + ","
                + "\"nms_iou_threshold\":0.6"
                + "}";
    }

    @SuppressWarnings("unchecked")
    static List<Garment> parseResponse(String body, double threshold) {
        Map<String, Object> root;
        try {
            root = JsonParserFactory.getJsonParser().parseMap(body);
        } catch (RuntimeException e) {
            throw new SegmentationException(502, "The SAM 3 service returned an unreadable response.");
        }
        List<Garment> garments = new ArrayList<>();
        if (!(root.get("prompt_results") instanceof List<?> results)) return garments;
        List<String> prompts = new ArrayList<>(PROMPT_TYPES.keySet());

        for (Object r : results) {
            if (!(r instanceof Map<?, ?> result)) continue;
            String prompt = null;
            if (result.get("echo") instanceof Map<?, ?> echo && echo.get("text") instanceof String t) prompt = t;
            if (prompt == null && result.get("prompt_index") instanceof Number n && n.intValue() < prompts.size()) {
                prompt = prompts.get(n.intValue());
            }
            if (prompt == null || !PROMPT_TYPES.containsKey(prompt)) continue;
            if (!(result.get("predictions") instanceof List<?> predictions)) continue;

            for (Object p : predictions) {
                if (!(p instanceof Map<?, ?> pred)) continue;
                double confidence = pred.get("confidence") instanceof Number c ? c.doubleValue() : 0;
                if (confidence < threshold) continue;
                List<List<double[]>> polygons = new ArrayList<>();
                if (pred.get("masks") instanceof List<?> masks) {
                    for (Object poly : masks) {
                        List<double[]> points = toPoints(poly);
                        if (points.size() >= 3) polygons.add(points);
                    }
                }
                if (!polygons.isEmpty()) {
                    garments.add(new Garment(prompt, PROMPT_TYPES.get(prompt), confidence, polygons));
                }
            }
        }
        return garments;
    }

    private static List<double[]> toPoints(Object poly) {
        List<double[]> points = new ArrayList<>();
        if (!(poly instanceof List<?> list)) return points;
        for (Object pt : list) {
            if (pt instanceof List<?> xy && xy.size() >= 2
                    && xy.get(0) instanceof Number x && xy.get(1) instanceof Number y) {
                points.add(new double[] {x.doubleValue(), y.doubleValue()});
            }
        }
        return points;
    }

    private static String abbreviate(String s) {
        if (s == null) return "";
        return s.length() > 500 ? s.substring(0, 500) + "…" : s;
    }
}
