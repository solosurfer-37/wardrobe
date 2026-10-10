package com.smartwardrobe.services;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** SAM 3 (Roboflow) request building and response parsing, without HTTP. */
class GarmentSegmentationServiceTest {

    @Test
    void requestUsesTextPromptsPolygonsAndCrossPromptNms() {
        String body = GarmentSegmentationService.buildRequestBody("QUJD", 0.5);
        assertTrue(body.contains("\"type\":\"base64\""));
        assertTrue(body.contains("\"text\":\"t-shirt\""));
        assertTrue(body.contains("\"text\":\"shoes\""));
        assertTrue(body.contains("\"format\":\"polygon\""));
        assertTrue(body.contains("\"nms_iou_threshold\":0.6"));
        assertTrue(GarmentSegmentationService.PROMPT_TYPES.size() <= 16, "Roboflow allows at most 16 prompts");
    }

    @Test
    void parsesEachInstanceAndDropsLowConfidenceOrBrokenOutlines() {
        String body = "{\"prompt_results\":["
                + "{\"prompt_index\":0,\"echo\":{\"type\":\"text\",\"text\":\"jacket\"},\"predictions\":["
                + "  {\"format\":\"polygon\",\"confidence\":0.91,\"masks\":[[[10,10],[100,10],[100,120],[10,120]]]}]},"
                + "{\"prompt_index\":12,\"echo\":{\"type\":\"text\",\"text\":\"shoes\"},\"predictions\":["
                + "  {\"confidence\":0.8,\"masks\":[[[5,200],[30,200],[30,220]]]},"
                + "  {\"confidence\":0.3,\"masks\":[[[50,200],[80,200],[80,220]]]},"
                + "  {\"confidence\":0.9,\"masks\":[[[1,1],[2,2]]]}]},"
                + "{\"prompt_index\":7,\"echo\":{\"type\":\"text\",\"text\":\"dress\"},\"predictions\":[]}"
                + "],\"time\":0.4}";
        List<GarmentSegmentationService.Garment> g = GarmentSegmentationService.parseResponse(body, 0.5);
        assertEquals(2, g.size());
        assertEquals("jacket", g.get(0).prompt());
        assertEquals("jacket", g.get(0).type());
        assertEquals(4, g.get(0).polygons().get(0).size());
        assertEquals("shoes", g.get(1).prompt());
        assertEquals(0.8, g.get(1).confidence(), 1e-9);
    }

    @Test
    void emptyOrMissingResultsGiveNoGarments() {
        assertEquals(0, GarmentSegmentationService.parseResponse("{\"time\":0.1}", 0.5).size());
    }
}
