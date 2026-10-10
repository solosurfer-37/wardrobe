package com.smartwardrobe.dto;

import java.util.List;

/**
 * Body of POST /api/outfits/recommend. The frontend sends the logged-in user's own wardrobe
 * (loaded from Supabase), so the backend never has to guess whose clothes to use.
 */
public class OutfitRequest {
    private Double latitude;
    private Double longitude;
    private String event;          // e.g. "work", "Client meeting", or null for casual
    private String date;           // user's local date, YYYY-MM-DD (optional)
    private List<ClosetItem> items;

    public static class ClosetItem {
        private Long id;
        private String type, color, pattern, imageUrl, name, brand, season, occasion, lastWornDate;
        private Double price, rating;
        private Integer wearCount;

        public Long getId() { return id; }
        public void setId(Long id) { this.id = id; }
        public String getType() { return type; }
        public void setType(String type) { this.type = type; }
        public String getColor() { return color; }
        public void setColor(String color) { this.color = color; }
        public String getPattern() { return pattern; }
        public void setPattern(String pattern) { this.pattern = pattern; }
        public String getImageUrl() { return imageUrl; }
        public void setImageUrl(String imageUrl) { this.imageUrl = imageUrl; }
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public String getBrand() { return brand; }
        public void setBrand(String brand) { this.brand = brand; }
        public String getSeason() { return season; }
        public void setSeason(String season) { this.season = season; }
        public String getOccasion() { return occasion; }
        public void setOccasion(String occasion) { this.occasion = occasion; }
        public String getLastWornDate() { return lastWornDate; }
        public void setLastWornDate(String lastWornDate) { this.lastWornDate = lastWornDate; }
        public Double getPrice() { return price; }
        public void setPrice(Double price) { this.price = price; }
        public Double getRating() { return rating; }
        public void setRating(Double rating) { this.rating = rating; }
        public Integer getWearCount() { return wearCount; }
        public void setWearCount(Integer wearCount) { this.wearCount = wearCount; }
    }

    public Double getLatitude() { return latitude; }
    public void setLatitude(Double latitude) { this.latitude = latitude; }
    public Double getLongitude() { return longitude; }
    public void setLongitude(Double longitude) { this.longitude = longitude; }
    public String getEvent() { return event; }
    public void setEvent(String event) { this.event = event; }
    public String getDate() { return date; }
    public void setDate(String date) { this.date = date; }
    public List<ClosetItem> getItems() { return items; }
    public void setItems(List<ClosetItem> items) { this.items = items; }
}
