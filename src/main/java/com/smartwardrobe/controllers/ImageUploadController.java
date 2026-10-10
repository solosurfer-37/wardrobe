package com.smartwardrobe.controllers;

import com.smartwardrobe.entities.ClothingItem;
import com.smartwardrobe.services.ClothingItemService;
import com.smartwardrobe.services.SupabaseStorageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.io.IOException;
import java.net.URI;
import java.util.Map;

/**
 * ImageUploadController
 * ─────────────────────
 * Handles the complete "upload processed image → store to Supabase Storage
 * → save path in database" pipeline.
 *
 * Endpoint: POST /api/clothes/{id}/upload-image
 *
 * This is designed for AFTER your AI/processing tweaks are done.
 * Your frontend or processing pipeline:
 *  1. Creates the clothing item first (POST /api/clothes) → gets back an ID
 *  2. Does its image processing (AI, background removal, etc.)
 *  3. Calls this endpoint with the processed image file to store it
 *
 * The endpoint:
 *  - Uploads the image to Supabase Storage at: users/{userId}/clothing/{itemId}/processed.{ext}
 *  - Updates ClothingItem.imagePath in PostgreSQL with the stored object path
 *  - Optionally stores the original raw upload at: users/{userId}/clothing/{itemId}/original.{ext}
 */
@RestController
@RequestMapping("/api/clothes")
public class ImageUploadController {

    private static final Logger log = LoggerFactory.getLogger(ImageUploadController.class);

    private final ClothingItemService clothingItemService;
    private final SupabaseStorageService storageService;

    public ImageUploadController(ClothingItemService clothingItemService,
                                  SupabaseStorageService storageService) {
        this.clothingItemService = clothingItemService;
        this.storageService = storageService;
    }

    /**
     * POST /api/clothes/{id}/upload-image
     *
     * Accepts multipart form data:
     *   - file     (required): The processed/final image file
     *   - original (optional): The original raw image before AI processing
     *
     * Returns the updated ClothingItem with imagePath and optionally originalImagePath set.
     *
     * Usage example from your AI pipeline:
     *   FormData fd = new FormData();
     *   fd.append('file', processedImageBlob, 'processed.png');
     *   fd.append('original', rawImageBlob, 'original.jpg');  // optional
     *   fetch('/api/clothes/5/upload-image', { method: 'POST', body: fd });
     */
    @PostMapping("/{id}/upload-image")
    public ResponseEntity<?> uploadImage(
            @PathVariable Long id,
            @RequestParam("file") MultipartFile processedImage,
            @RequestParam(value = "original", required = false) MultipartFile originalImage) {

        // 1. Verify the clothing item exists and belongs to the current user
        ClothingItem item = clothingItemService.getClothingItemById(id);
        if (item == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Clothing item not found or access denied"));
        }

        if (processedImage.isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Image file is required and cannot be empty"));
        }

        try {
            Long userId = clothingItemService.getOwnerIdForItem(id);
            if (userId == null) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(Map.of("error", "Access denied to this clothing item"));
            }

            // 2. Determine file extension from content type
            String processedExt = getExtension(processedImage.getContentType());
            String processedPath = SupabaseStorageService.buildObjectPath(
                    userId, id, "processed." + processedExt);

            // 3. Upload processed/final image to Supabase Storage
            String storedProcessedPath = storageService.uploadImage(processedImage, processedPath);

            // 4. Upload original image if provided
            String storedOriginalPath = null;
            if (originalImage != null && !originalImage.isEmpty()) {
                String originalExt = getExtension(originalImage.getContentType());
                String originalPath = SupabaseStorageService.buildObjectPath(
                        userId, id, "original." + originalExt);
                storedOriginalPath = storageService.uploadImage(originalImage, originalPath);
            }

            // 5. Save paths back to the clothing item in PostgreSQL
            ClothingItem patch = new ClothingItem();
            patch.setType(item.getType());           // required non-null field
            patch.setColor(item.getColor());         // required non-null field
            patch.setWearCount(item.getWearCount()); // preserve existing value
            patch.setImagePath(storedProcessedPath);
            // Also set imageUrl so the existing frontend card renderer can display it.
            // It points at GET /api/clothes/{id}/image, which signs a fresh URL on every view,
            // so the card keeps working after a one-hour signed URL would have expired.
            // ?v= changes with every upload so a retried upload is never shown from cache.
            patch.setImageUrl(buildStableImageUrl(id));
            if (storedOriginalPath != null) {
                patch.setOriginalImagePath(storedOriginalPath);
            }

            ClothingItem updated = clothingItemService.updateClothingItem(id, patch);

            log.info("Image stored in Supabase for clothing item id={}: processedPath={}", id, storedProcessedPath);

            return ResponseEntity.ok(updated);

        } catch (IllegalStateException e) {
            // Service role key missing / wrong key type / rejected by Supabase Storage
            log.error("Supabase Storage not configured: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", e.getMessage()));
        } catch (IOException e) {
            // Supabase Storage answered with an error (bucket missing, bad request, ...)
            log.error("Supabase Storage error for clothing item id={}: {}", id, e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(Map.of("error", "Supabase Storage error: " + e.getMessage()));
        } catch (Exception e) {
            log.error("Failed to upload image for clothing item id={}: {}", id, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Image upload failed: " + e.getMessage()));
        }
    }

    /**
     * POST /api/clothes/{id}/upload-extracted
     *
     * Stores the background-removed / AI-extracted garment image separately.
     * Call this after your Gemini/background-removal step completes.
     *
     *   fd.append('file', extractedBlob, 'extracted.png');
     *   fetch('/api/clothes/5/upload-extracted', { method: 'POST', body: fd });
     */
    @PostMapping("/{id}/upload-extracted")
    public ResponseEntity<?> uploadExtractedImage(
            @PathVariable Long id,
            @RequestParam("file") MultipartFile extractedImage) {

        ClothingItem item = clothingItemService.getClothingItemById(id);
        if (item == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Clothing item not found or access denied"));
        }

        if (extractedImage.isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Extracted image file cannot be empty"));
        }

        try {
            Long userId = clothingItemService.getOwnerIdForItem(id);
            if (userId == null) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(Map.of("error", "Access denied to this clothing item"));
            }
            String ext = getExtension(extractedImage.getContentType());
            String objectPath = SupabaseStorageService.buildObjectPath(userId, id, "extracted." + ext);

            String storedPath = storageService.uploadImage(extractedImage, objectPath);

            ClothingItem patch = new ClothingItem();
            patch.setType(item.getType());
            patch.setColor(item.getColor());
            patch.setWearCount(item.getWearCount());
            patch.setExtractedImagePath(storedPath);

            ClothingItem updated = clothingItemService.updateClothingItem(id, patch);

            log.info("Extracted image stored in Supabase for clothing item id={}: path={}", id, storedPath);
            return ResponseEntity.ok(updated);

        } catch (IllegalStateException e) {
            log.error("Supabase Storage not configured: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", e.getMessage()));
        } catch (IOException e) {
            log.error("Supabase Storage error for clothing item id={}: {}", id, e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(Map.of("error", "Supabase Storage error: " + e.getMessage()));
        } catch (Exception e) {
            log.error("Failed to upload extracted image for clothing item id={}: {}", id, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Extracted image upload failed: " + e.getMessage()));
        }
    }

    /**
     * GET /api/clothes/{id}/image
     *
     * Redirects to a freshly signed Supabase Storage URL for the item's stored image
     * (ClothingItem.imagePath). The bucket stays private and the service-role key never
     * leaves the backend.
     */
    @GetMapping("/{id}/image")
    public ResponseEntity<?> viewImage(@PathVariable Long id) {
        ClothingItem item = clothingItemService.getClothingItemById(id);
        if (item == null || item.getImagePath() == null || item.getImagePath().isBlank()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "No stored image for this clothing item"));
        }
        String signed;
        try {
            signed = storageService.getSignedUrl(item.getImagePath(), SIGNED_URL_SECONDS);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", e.getMessage()));
        }
        if (signed == null) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(Map.of("error", "Could not sign the image URL in Supabase Storage"));
        }
        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(signed))
                // Let the browser reuse the redirect for a while, but never past the signature's expiry.
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=" + (SIGNED_URL_SECONDS - 300))
                .build();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static final int SIGNED_URL_SECONDS = 3600;

    private String buildStableImageUrl(Long id) {
        return ServletUriComponentsBuilder.fromCurrentContextPath()
                .path("/api/clothes/{id}/image")
                .queryParam("v", System.currentTimeMillis())
                .buildAndExpand(id)
                .toUriString();
    }

    private String getExtension(String contentType) {
        if (contentType == null) return "jpg";
        return switch (contentType.toLowerCase()) {
            case "image/png"  -> "png";
            case "image/webp" -> "webp";
            case "image/gif"  -> "gif";
            default           -> "jpg";
        };
    }

}
