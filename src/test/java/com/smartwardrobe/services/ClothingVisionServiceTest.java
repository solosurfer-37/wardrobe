package com.smartwardrobe.services;

import com.smartwardrobe.dto.ClothingAnalysisResponse;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Checks how AI answers are interpreted: only allowed values above the confidence
 * threshold are kept, everything else is left unselected (null).
 */
class ClothingVisionServiceTest {

    private static String geminiReply(String innerJson) {
        String escaped = innerJson.replace("\\", "\\\\").replace("\"", "\\\"");
        return "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"" + escaped + "\"}],\"role\":\"model\"}}]}";
    }

    @Test
    void keepsConfidentAllowedValues() {
        ClothingAnalysisResponse r = ClothingVisionService.interpretResponse(geminiReply(
                "{\"category\":\"t-shirt\",\"categoryConfidence\":0.93,\"color\":\"Navy\",\"colorConfidence\":0.88,"
                + "\"pattern\":\"striped\",\"patternConfidence\":0.71}"), 0.6);
        assertEquals("t-shirt", r.getCategory());
        assertEquals("navy", r.getColor());
        assertEquals("striped", r.getPattern());
    }

    @Test
    void leavesUnknownUnsureOrUnlistedValuesEmpty() {
        ClothingAnalysisResponse r = ClothingVisionService.interpretResponse(geminiReply(
                "{\"category\":\"dress\",\"categoryConfidence\":0.95,\"color\":\"black\",\"colorConfidence\":0.4,"
                + "\"pattern\":\"unknown\",\"patternConfidence\":0.9}"), 0.6);
        assertNull(r.getCategory(), "values outside the app's type list are not invented");
        assertNull(r.getColor(), "low confidence stays unselected");
        assertNull(r.getPattern(), "unknown stays unselected");
        assertEquals(0.4, r.getColorConfidence(), 1e-9);
    }

    @Test
    void acceptsJsonWrappedInCodeFence() {
        ClothingAnalysisResponse r = ClothingVisionService.interpretResponse(geminiReply(
                "```json\n{\"category\":\"jeans\",\"categoryConfidence\":0.9,\"color\":\"blue\",\"colorConfidence\":0.9,"
                + "\"pattern\":\"solid\",\"patternConfidence\":0.9}\n```"), 0.6);
        assertEquals("jeans", r.getCategory());
    }

    @Test
    void blockedOrEmptyReplyIsAnError() {
        ClothingVisionService.VisionAnalysisException e = assertThrows(ClothingVisionService.VisionAnalysisException.class,
                () -> ClothingVisionService.interpretResponse("{\"promptFeedback\":{\"blockReason\":\"OTHER\"}}", 0.6));
        assertEquals(422, e.getStatus());
    }

    @Test
    void requestNeverAsksForSeasonOccasionBrandRatingOrPrice() {
        String body = ClothingVisionService.buildRequestBody("AAAA", "image/jpeg");
        assertTrue(body.contains("\"category\""));
        assertTrue(body.contains("\"color\""));
        assertTrue(body.contains("\"pattern\""));
        for (String forbidden : new String[] {"\"season\"", "\"occasion\"", "\"brand\"", "\"rating\"", "\"price\""}) {
            assertFalse(body.contains(forbidden), forbidden + " must not be requested from the AI");
        }
    }

    @Test
    void returnsOneEntryPerGarmentGroupWithItsOwnDetails() {
        ClothingAnalysisResponse r = ClothingVisionService.interpretResponse(geminiReply(
                "{\"category\":\"t-shirt\",\"categoryConfidence\":0.9,\"color\":\"white\",\"colorConfidence\":0.9,"
                + "\"pattern\":\"solid\",\"patternConfidence\":0.9,\"garments\":["
                + "{\"group\":\"top\",\"category\":\"t-shirt\",\"categoryConfidence\":0.9,\"color\":\"white\",\"colorConfidence\":0.9,\"pattern\":\"solid\",\"patternConfidence\":0.8},"
                + "{\"group\":\"bottom\",\"category\":\"jeans\",\"categoryConfidence\":0.85,\"color\":\"blue\",\"colorConfidence\":0.9,\"pattern\":\"unknown\",\"patternConfidence\":0.2},"
                + "{\"group\":\"footwear\",\"category\":\"shirt\",\"categoryConfidence\":0.9,\"color\":\"black\",\"colorConfidence\":0.7,\"pattern\":\"solid\",\"patternConfidence\":0.7},"
                + "{\"group\":\"bottom\",\"category\":\"shorts\",\"categoryConfidence\":0.3,\"color\":\"gray\",\"colorConfidence\":0.3,\"pattern\":\"solid\",\"patternConfidence\":0.3},"
                + "{\"group\":\"hat\",\"category\":\"top\",\"categoryConfidence\":0.9,\"color\":\"red\",\"colorConfidence\":0.9,\"pattern\":\"solid\",\"patternConfidence\":0.9}"
                + "]}"), 0.6);
        assertEquals(3, r.getGarments().size(), "one per group; unknown groups dropped");
        ClothingAnalysisResponse.Garment top = r.getGarments().get(0);
        ClothingAnalysisResponse.Garment bottom = r.getGarments().get(1);
        ClothingAnalysisResponse.Garment shoes = r.getGarments().get(2);
        assertEquals("top", top.getGroup());
        assertEquals("t-shirt", top.getCategory());
        assertEquals("jeans", bottom.getCategory(), "most confident bottom kept");
        assertEquals("blue", bottom.getColor());
        assertNull(bottom.getPattern(), "unsure pattern stays empty");
        assertEquals("footwear", shoes.getGroup());
        assertNull(shoes.getCategory(), "a category that does not fit its group is not used");
        assertEquals("black", shoes.getColor());
    }

    @Test
    void missingGarmentListIsEmptyNotAnError() {
        ClothingAnalysisResponse r = ClothingVisionService.interpretResponse(geminiReply(
                "{\"category\":\"shirt\",\"categoryConfidence\":0.9,\"color\":\"white\",\"colorConfidence\":0.9,"
                + "\"pattern\":\"solid\",\"patternConfidence\":0.9}"), 0.6);
        assertEquals("shirt", r.getCategory());
        assertEquals(0, r.getGarments().size());
    }
}
