package com.smartwardrobe.controllers;

import com.smartwardrobe.dto.OutfitRecommendation;
import com.smartwardrobe.dto.OutfitRequest;
import com.smartwardrobe.services.OutfitRecommendationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/outfits")
public class OutfitController {
    private final OutfitRecommendationService outfitRecommendationService;

    public OutfitController(OutfitRecommendationService outfitRecommendationService) {
        this.outfitRecommendationService = outfitRecommendationService;
    }

    /**
     * GET /api/outfits/recommend?latitude={lat}&longitude={lon}[&event=college]
     * Returns up to three ranked outfits while preserving the existing response contract.
     */
    @GetMapping("/recommend")
    public ResponseEntity<List<OutfitRecommendation>> getRecommendations(
            @RequestParam(defaultValue = "28.6139") double latitude,
            @RequestParam(defaultValue = "77.2090") double longitude,
            @RequestParam(required = false) String event) {
        return ResponseEntity.ok(outfitRecommendationService.recommendOutfits(latitude, longitude, event));
    }

    /**
     * POST /api/outfits/recommend
     * Body: { latitude, longitude, event, date, items: [...the logged-in user's wardrobe...] }
     * Runs the same OutfitEngine (weather + calendar event + colour graph + usage-decay) on the
     * items the frontend sends, so each user gets outfits from their own clothes.
     */
    @PostMapping("/recommend")
    public ResponseEntity<OutfitRecommendationService.Result> recommendForWardrobe(@RequestBody OutfitRequest request) {
        return ResponseEntity.ok(outfitRecommendationService.recommendFor(request));
    }
}
