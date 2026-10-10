package com.smartwardrobe.dto;

import java.util.ArrayList;
import java.util.List;

/**
 * Result of AI clothing recognition for the Add to Wardrobe flow.
 *
 * Only category (stored as ClothingItem.type), primary colour and pattern are detected.
 * A field is null when the model could not identify it confidently; the frontend then
 * leaves the matching form field unselected instead of showing a guess.
 *
 * The top-level fields describe the most prominent garment. {@link #getGarments()} lists every
 * distinct garment the AI saw (at most one per group: top, bottom, footwear, dress), so that a
 * photo of a full outfit can be split into separate wardrobe items with one AI request.
 */
public class ClothingAnalysisResponse {
    private String category;
    private String color;
    private String pattern;
    private Double categoryConfidence;
    private Double colorConfidence;
    private Double patternConfidence;
    private List<Garment> garments = new ArrayList<>();

    /** One garment seen in the photo. {@code group} is always set; the other values may be null. */
    public static class Garment {
        private String group;
        private String category;
        private String color;
        private String pattern;
        private Double categoryConfidence;
        private Double colorConfidence;
        private Double patternConfidence;

        public Garment() {
        }

        public Garment(String group, String category, String color, String pattern,
                       Double categoryConfidence, Double colorConfidence, Double patternConfidence) {
            this.group = group;
            this.category = category;
            this.color = color;
            this.pattern = pattern;
            this.categoryConfidence = categoryConfidence;
            this.colorConfidence = colorConfidence;
            this.patternConfidence = patternConfidence;
        }

        public String getGroup() { return group; }
        public void setGroup(String group) { this.group = group; }
        public String getCategory() { return category; }
        public void setCategory(String category) { this.category = category; }
        public String getColor() { return color; }
        public void setColor(String color) { this.color = color; }
        public String getPattern() { return pattern; }
        public void setPattern(String pattern) { this.pattern = pattern; }
        public Double getCategoryConfidence() { return categoryConfidence; }
        public void setCategoryConfidence(Double v) { this.categoryConfidence = v; }
        public Double getColorConfidence() { return colorConfidence; }
        public void setColorConfidence(Double v) { this.colorConfidence = v; }
        public Double getPatternConfidence() { return patternConfidence; }
        public void setPatternConfidence(Double v) { this.patternConfidence = v; }
    }

    public ClothingAnalysisResponse() {
    }

    public ClothingAnalysisResponse(String category, String color, String pattern,
                                    Double categoryConfidence, Double colorConfidence, Double patternConfidence) {
        this.category = category;
        this.color = color;
        this.pattern = pattern;
        this.categoryConfidence = categoryConfidence;
        this.colorConfidence = colorConfidence;
        this.patternConfidence = patternConfidence;
    }

    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }

    public String getColor() { return color; }
    public void setColor(String color) { this.color = color; }

    public String getPattern() { return pattern; }
    public void setPattern(String pattern) { this.pattern = pattern; }

    public Double getCategoryConfidence() { return categoryConfidence; }
    public void setCategoryConfidence(Double categoryConfidence) { this.categoryConfidence = categoryConfidence; }

    public Double getColorConfidence() { return colorConfidence; }
    public void setColorConfidence(Double colorConfidence) { this.colorConfidence = colorConfidence; }

    public Double getPatternConfidence() { return patternConfidence; }
    public void setPatternConfidence(Double patternConfidence) { this.patternConfidence = patternConfidence; }

    public List<Garment> getGarments() { return garments; }
    public void setGarments(List<Garment> garments) { this.garments = garments == null ? new ArrayList<>() : garments; }
}
