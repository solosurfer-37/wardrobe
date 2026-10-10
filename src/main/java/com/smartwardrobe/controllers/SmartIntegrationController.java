package com.smartwardrobe.controllers;

import com.smartwardrobe.dto.CalendarEventResponse;
import com.smartwardrobe.dto.ClothingAnalysisResponse;
import com.smartwardrobe.dto.ReceiptOcrResponse;
import com.smartwardrobe.dto.VisionAnalysisResponse;
import com.smartwardrobe.services.ClothingVisionService;
import com.smartwardrobe.services.GarmentSegmentationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Mocks advanced AI and external integrations for hackathon judging purposes.
 * Demonstrates the system architecture and data contracts.
 */
@RestController
@RequestMapping("/api")
public class SmartIntegrationController {

    private static final Logger log = LoggerFactory.getLogger(SmartIntegrationController.class);

    private final ClothingVisionService visionService;
    private final GarmentSegmentationService segmentationService;

    public SmartIntegrationController(ClothingVisionService visionService,
                                      GarmentSegmentationService segmentationService) {
        this.visionService = visionService;
        this.segmentationService = segmentationService;
    }

    /**
     * POST /api/vision/segment-garments  (multipart field "file")
     *
     * Individual garment outlines from SAM 3 (Roboflow). Returns
     *   { "engine": "sam3", "garments": [ { prompt, type, confidence, polygons: [[[x,y],...]] } ] }
     * with coordinates in pixels of the uploaded image.
     *   503 → not configured (no ROBOFLOW_API_KEY); the browser falls back to its on-device model
     *   429 → free quota used up
     *   502 → provider error
     */
    @PostMapping("/vision/segment-garments")
    public ResponseEntity<?> segmentGarments(@RequestParam("file") MultipartFile file) {
        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Image file is required"));
        }
        String contentType = file.getContentType();
        if (contentType == null || !contentType.toLowerCase().startsWith("image/")) {
            return ResponseEntity.badRequest().body(Map.of("error", "Only image files can be segmented"));
        }
        try {
            return ResponseEntity.ok(Map.of("engine", "sam3", "garments", segmentationService.segment(file.getBytes())));
        } catch (GarmentSegmentationService.SegmentationUnavailableException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", e.getMessage()));
        } catch (GarmentSegmentationService.SegmentationException e) {
            log.warn("Garment segmentation failed: {}", e.getMessage());
            return ResponseEntity.status(e.getStatus()).body(Map.of("error", e.getMessage()));
        } catch (IOException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Could not read the uploaded image"));
        }
    }

    /**
     * POST /api/vision/analyze-image  (multipart field "file")
     *
     * Real AI recognition used by the Add to Wardrobe modal. Detects only category, primary colour
     * and pattern; fields the AI is not confident about come back as null.
     *   503 → recognition not configured (no GEMINI_API_KEY); the UI switches to manual entry
     *   429 → AI quota reached
     *   422 → the AI could not analyse the image
     *   502 → AI provider error
     */
    @PostMapping("/vision/analyze-image")
    public ResponseEntity<?> analyzeClothingImage(@RequestParam("file") MultipartFile file) {
        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Image file is required"));
        }
        String contentType = file.getContentType();
        if (contentType == null || !contentType.toLowerCase().startsWith("image/")) {
            return ResponseEntity.badRequest().body(Map.of("error", "Only image files can be analysed"));
        }
        try {
            ClothingAnalysisResponse result = visionService.analyze(file.getBytes(), contentType);
            return ResponseEntity.ok(result);
        } catch (ClothingVisionService.VisionUnavailableException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", e.getMessage()));
        } catch (ClothingVisionService.VisionAnalysisException e) {
            log.warn("Clothing recognition failed: {}", e.getMessage());
            return ResponseEntity.status(e.getStatus()).body(Map.of("error", e.getMessage()));
        } catch (IOException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Could not read the uploaded image"));
        }
    }

    /** Mock kept for the judging demo; the Add to Wardrobe modal uses the POST endpoint above. */
    @GetMapping("/vision/analyze-image")
    public ResponseEntity<VisionAnalysisResponse> mockVisionAnalysis() {
        VisionAnalysisResponse response = new VisionAnalysisResponse(
                List.of("jacket", "leather", "outerwear", "biker", "black"),
                "black",
                "jacket",
                0.982
        );
        return ResponseEntity.ok(response);
    }

    @GetMapping("/ocr/parse-receipt")
    public ResponseEntity<ReceiptOcrResponse> mockOcrReceipt() {
        ReceiptOcrResponse response = new ReceiptOcrResponse(
                "Zara",
                89.99,
                LocalDate.now().toString(),
                List.of("Faux Leather Biker Jacket - BLK")
        );
        return ResponseEntity.ok(response);
    }

    @GetMapping("/calendar/today-events")
    public ResponseEntity<CalendarEventResponse> mockCalendarEvent() {
        CalendarEventResponse response = new CalendarEventResponse(
                "Q4 Client Pitch",
                "Business Meeting",
                "Formal",
                "14:00 PM"
        );
        return ResponseEntity.ok(response);
    }
}
