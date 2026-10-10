package com.smartwardrobe.engine;

import com.smartwardrobe.dto.OutfitRecommendation;
import com.smartwardrobe.entities.ClothingItem;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * OutfitEngine - the single home for ALL "what should I wear today?" logic.
 *
 * Pipeline:
 *   1. HARD FILTERS   remove items that make no sense for today's weather
 *   2. COMBINE        top x bottom x shoes (x outerwear when needed)
 *   3. COLOR GRAPH    drop combos whose colors clash
 *   4. SCORE          weighted sum of warmth, rain, layering, material,
 *                     color tone, wind, formality (calendar event), usage-decay
 *   5. DIVERSIFY      pick the top 3 that don't repeat the same items
 *   6. EXPLAIN        attach a human-readable reason to each outfit
 *
 * This class is pure logic: it never touches the database or the network.
 * Feed it the closet, a WeatherContext and an Event, and it returns outfits.
 */
@Component
public class OutfitEngine {

    // ═════════════════════════════════════════════════════════════════
    //  1. TUNABLE SETTINGS  (change these to tune the engine)
    // ═════════════════════════════════════════════════════════════════

    // Score weights - should add up to 1.0
    private static final double W_WARMTH    = 0.25;
    private static final double W_FORMALITY = 0.20;
    private static final double W_DECAY     = 0.20;
    private static final double W_RAIN      = 0.12;
    private static final double W_LAYER     = 0.08;
    private static final double W_MATERIAL  = 0.08;
    private static final double W_TONE      = 0.04;
    private static final double W_WIND      = 0.03;

    private static final int    MAX_RESULTS       = 3;
    private static final int    RECENCY_DAYS      = 2;    // skip items worn in the last 2 days
    private static final int    DECAY_FULL_DAYS   = 30;   // unworn for 30 days = max decay bonus
    private static final int    NEGLECTED_DAYS    = 14;   // mention "you haven't worn X" after this

    // Weather thresholds
    private static final double HOT_FEELS_LIKE    = 32;   // above: no outerwear, no boots
    private static final double WARM_FEELS_LIKE   = 28;   // above: prefer breathable, light colors
    private static final double COLD_FEELS_LIKE   = 15;   // below: outerwear required
    private static final double FREEZING           = 10;  // below: no shorts / skirts / sandals
    private static final double BIG_SWING          = 10;  // max-min above: removable layer
    private static final double RAINY_CHANCE       = 50;  // % chance counted as "rainy"
    private static final double HEAVY_RAIN_CHANCE  = 70;  // % chance that bans sandals
    private static final double WINDY_KMH          = 25;

    // ═════════════════════════════════════════════════════════════════
    //  2. PUBLIC TYPES
    // ═════════════════════════════════════════════════════════════════

    /** Everything the engine needs to know about today's weather. */
    public record WeatherContext(double feelsLike, double minTemp, double maxTemp,
                                 double rainChance, boolean raining, double windSpeed) {

        /** Safe default if the weather API fails: a mild, dry day. */
        public static WeatherContext fallback() {
            return new WeatherContext(20, 15, 25, 0, false, 5);
        }

        public boolean isRainy() {
            return raining || rainChance >= RAINY_CHANCE;
        }

        public double swing() {
            return maxTemp - minTemp;
        }
    }

    /** What the user is doing today (comes from calendar metadata or a dropdown). */
    public enum Event {
        CASUAL("casual", 2),
        COLLEGE("college", 2),
        PARTY("party", 3),
        WORK("work", 3),
        FORMAL("formal", 4);

        private final String label;
        private final int formality;   // target formality 1 (very casual) .. 5 (very formal)

        Event(String label, int formality) {
            this.label = label;
            this.formality = formality;
        }

        public String label()    { return label; }
        public int formality()   { return formality; }

        /** Forgiving parser: "Business Meeting", "formal", "college", null... all work. */
        public static Event parse(String raw) {
            if (raw == null || raw.isBlank()) return CASUAL;
            String s = raw.toLowerCase(Locale.ROOT);
            if (containsAny(s, "formal", "wedding", "ceremony"))                                   return FORMAL;
            if (containsAny(s, "work", "business", "meeting", "interview", "office", "pitch"))     return WORK;
            if (containsAny(s, "party", "dinner", "club", "concert"))                              return PARTY;
            if (containsAny(s, "college", "class", "campus", "school", "lecture", "university"))   return COLLEGE;
            return CASUAL;
        }

        private static boolean containsAny(String s, String... keys) {
            for (String k : keys) if (s.contains(k)) return true;
            return false;
        }
    }

    // ═════════════════════════════════════════════════════════════════
    //  3. CLOTHING KNOWLEDGE TABLES  (types must match your config.js lists)
    // ═════════════════════════════════════════════════════════════════

    private enum Slot { TOP, OUTER, BOTTOM, SHOES, UNKNOWN }

    private enum LayerMode { REQUIRED, OPTIONAL, NONE }

    private static final Map<String, Slot> SLOT_BY_TYPE = Map.ofEntries(
            Map.entry("shirt", Slot.TOP), Map.entry("t-shirt", Slot.TOP),
            Map.entry("blouse", Slot.TOP), Map.entry("top", Slot.TOP),
            Map.entry("jacket", Slot.OUTER), Map.entry("sweater", Slot.OUTER),
            Map.entry("hoodie", Slot.OUTER),
            Map.entry("pants", Slot.BOTTOM), Map.entry("jeans", Slot.BOTTOM),
            Map.entry("shorts", Slot.BOTTOM), Map.entry("skirt", Slot.BOTTOM),
            Map.entry("trousers", Slot.BOTTOM),
            Map.entry("shoes", Slot.SHOES), Map.entry("sneakers", Slot.SHOES),
            Map.entry("boots", Slot.SHOES), Map.entry("sandals", Slot.SHOES),
            Map.entry("loafers", Slot.SHOES)
    );

    /** How warm each garment is, 0 (none) .. 4 (very warm). */
    private static final Map<String, Integer> WARMTH = Map.ofEntries(
            Map.entry("t-shirt", 1), Map.entry("top", 1), Map.entry("blouse", 1), Map.entry("shirt", 2),
            Map.entry("sweater", 3), Map.entry("hoodie", 3), Map.entry("jacket", 4),
            Map.entry("shorts", 1), Map.entry("skirt", 1), Map.entry("pants", 2),
            Map.entry("trousers", 2), Map.entry("jeans", 3),
            Map.entry("sandals", 0), Map.entry("sneakers", 1), Map.entry("loafers", 1),
            Map.entry("shoes", 1), Map.entry("boots", 2)
    );

    /** Base formality of each garment, 1 (very casual) .. 5 (very formal). */
    private static final Map<String, Integer> FORMALITY = Map.ofEntries(
            Map.entry("t-shirt", 1), Map.entry("top", 2), Map.entry("blouse", 3), Map.entry("shirt", 3),
            Map.entry("hoodie", 1), Map.entry("sweater", 2), Map.entry("jacket", 3),
            Map.entry("jeans", 2), Map.entry("shorts", 1), Map.entry("skirt", 3),
            Map.entry("pants", 3), Map.entry("trousers", 4),
            Map.entry("sneakers", 1), Map.entry("sandals", 1), Map.entry("boots", 3),
            Map.entry("loafers", 4), Map.entry("shoes", 4)
    );

    // The item's "pattern" field doubles as its material/fabric in your data.
    private static final Set<String> HEAVY_MATERIALS     = Set.of("wool", "fleece", "knit", "quilted", "corduroy");
    private static final Set<String> BREATHABLE_MATERIALS = Set.of("solid", "chambray", "canvas", "floral", "graphic", "chino", "linen", "cotton");

    private static final Set<String> LIGHT_COLORS = Set.of("white", "beige", "yellow", "pink");
    private static final Set<String> DARK_COLORS  = Set.of("black", "navy", "gray", "brown", "green", "purple");

    /** Color graph: pairs that clash (symmetric). */
    private static final Set<Set<String>> CLASHING_PAIRS = Set.of(
            Set.of("red", "green"),   Set.of("red", "orange"),   Set.of("red", "pink"),
            Set.of("orange", "pink"), Set.of("brown", "black"),  Set.of("navy", "black"),
            Set.of("green", "orange"), Set.of("purple", "red"),  Set.of("yellow", "green"),
            Set.of("brown", "gray")
    );

    // ═════════════════════════════════════════════════════════════════
    //  4. MAIN ENTRY POINT
    // ═════════════════════════════════════════════════════════════════

    public List<OutfitRecommendation> recommend(List<ClothingItem> closet, WeatherContext weather, Event event) {
        return recommend(closet, weather, event, LocalDate.now());
    }

    public List<OutfitRecommendation> recommend(List<ClothingItem> closet, WeatherContext weather,
                                                Event event, LocalDate today) {
        if (closet == null || closet.isEmpty()) return List.of();

        WeatherContext w = weather != null ? weather : WeatherContext.fallback();
        Event ev = event != null ? event : Event.CASUAL;
        LocalDate day = today != null ? today : LocalDate.now();

        // Step 1: hard filters (weather + "not worn in the last 2 days")
        List<ClothingItem> tops    = pool(closet, Slot.TOP, w, day);
        List<ClothingItem> bottoms = pool(closet, Slot.BOTTOM, w, day);
        List<ClothingItem> shoes   = pool(closet, Slot.SHOES, w, day);
        List<ClothingItem> outers  = pool(closet, Slot.OUTER, w, day);
        if (tops.isEmpty() || bottoms.isEmpty()) return List.of();
        // No shoes saved: still suggest top + bottom (shoes are optional).
        if (shoes.isEmpty()) { shoes = new ArrayList<>(); shoes.add(null); }

        boolean closetHasOuter = closet.stream().anyMatch(i -> slotOf(i) == Slot.OUTER);
        LayerMode mode = layerMode(w, !outers.isEmpty());
        boolean missingOuter = w.feelsLike() < COLD_FEELS_LIKE && !closetHasOuter;
        int maxWear = closet.stream().mapToInt(ClothingItem::getWearCount).max().orElse(0);
        Ctx ctx = new Ctx(w, ev, mode, day, maxWear, missingOuter);

        List<ClothingItem> outerOptions = new ArrayList<>();
        switch (mode) {
            case REQUIRED -> outerOptions.addAll(outers);
            case OPTIONAL -> { outerOptions.add(null); outerOptions.addAll(outers); }
            case NONE     -> outerOptions.add(null);
        }

        // Steps 2-4: combine, color-check, score
        List<Scored> scored = generate(tops, bottoms, shoes, outerOptions, ctx, true);
        if (scored.isEmpty()) {
            // Everything clashed; better to suggest something than nothing.
            scored = generate(tops, bottoms, shoes, outerOptions, ctx, false);
        }

        // Step 5: diverse top N
        List<Scored> picked = pickDiverse(scored);

        // Step 6: explain
        List<OutfitRecommendation> result = new ArrayList<>();
        for (Scored s : picked) {
            int totalWear = s.pieces().stream().mapToInt(ClothingItem::getWearCount).sum();
            OutfitRecommendation rec =
                    new OutfitRecommendation(s.top(), s.bottom(), s.shoes(), s.outer(), totalWear);
            rec.setScore(Math.round(s.score() * 1000.0) / 10.0);   // 0..100, one decimal
            rec.setReason(explain(s, ctx));
            result.add(rec);
        }
        return result;
    }

    // ═════════════════════════════════════════════════════════════════
    //  5. HARD FILTERS
    // ═════════════════════════════════════════════════════════════════

    private List<ClothingItem> pool(List<ClothingItem> closet, Slot slot, WeatherContext w, LocalDate today) {
        List<ClothingItem> inSlot = closet.stream().filter(i -> slotOf(i) == slot).toList();

        List<ClothingItem> weatherOk = inSlot.stream().filter(i -> passesWeather(i, slot, w)).toList();
        // If the closet has nothing suitable for a slot, relax rather than return no outfit.
        // (Not for outerwear: in extreme heat "no outerwear" is the right answer.)
        if (slot != Slot.OUTER && weatherOk.isEmpty()) weatherOk = inSlot;

        List<ClothingItem> fresh = weatherOk.stream().filter(i -> notWornRecently(i, today)).toList();
        return fresh.isEmpty() ? weatherOk : fresh;
    }

    private boolean passesWeather(ClothingItem item, Slot slot, WeatherContext w) {
        String type = norm(item.getType());

        // Too hot: no jackets/sweaters/hoodies, no boots
        if (w.feelsLike() > HOT_FEELS_LIKE && (slot == Slot.OUTER || type.equals("boots"))) return false;

        // Freezing: no shorts, skirts, sandals
        if (w.feelsLike() < FREEZING && Set.of("shorts", "skirt", "sandals").contains(type)) return false;

        // Heavy rain: no sandals
        if ((w.rainChance() > HEAVY_RAIN_CHANCE || w.raining()) && type.equals("sandals")) return false;

        return true;
    }

    private boolean notWornRecently(ClothingItem item, LocalDate today) {
        return item.getLastWornDate() == null
                || item.getLastWornDate().isBefore(today.minusDays(RECENCY_DAYS));
    }

    private LayerMode layerMode(WeatherContext w, boolean hasOuter) {
        if (!hasOuter) return LayerMode.NONE;
        if (w.feelsLike() < COLD_FEELS_LIKE) return LayerMode.REQUIRED;
        // Cool morning but warm afternoon: a layer is optional, scoring decides.
        if (w.minTemp() < COLD_FEELS_LIKE && w.swing() > BIG_SWING) return LayerMode.OPTIONAL;
        return LayerMode.NONE;
    }

    // ═════════════════════════════════════════════════════════════════
    //  6. COMBINE + COLOR GRAPH
    // ═════════════════════════════════════════════════════════════════

    private List<Scored> generate(List<ClothingItem> tops, List<ClothingItem> bottoms, List<ClothingItem> shoes,
                                  List<ClothingItem> outerOptions, Ctx ctx, boolean enforceColors) {
        List<Scored> out = new ArrayList<>();
        for (ClothingItem top : tops) {
            for (ClothingItem bottom : bottoms) {
                if (enforceColors && clash(top, bottom)) continue;
                for (ClothingItem shoe : shoes) {
                    if (enforceColors && shoe != null && (clash(top, shoe) || clash(bottom, shoe))) continue;
                    for (ClothingItem outer : outerOptions) {
                        if (enforceColors && outer != null
                                && (clash(outer, top) || clash(outer, bottom) || (shoe != null && clash(outer, shoe)))) continue;
                        out.add(new Scored(top, bottom, shoe, outer, score(top, bottom, shoe, outer, ctx)));
                    }
                }
            }
        }
        return out;
    }

    /**
     * Items can have several colours ("navy,white"). Two items clash when their main (first)
     * colours clash and they share no colour that would tie them together.
     */
    private boolean clash(ClothingItem a, ClothingItem b) {
        List<String> ca = colorsOf(a), cb = colorsOf(b);
        if (ca.isEmpty() || cb.isEmpty()) return false;
        for (String c : ca) if (cb.contains(c)) return false;   // a shared colour never clashes
        return CLASHING_PAIRS.contains(Set.of(ca.get(0), cb.get(0)));
    }

    // ═════════════════════════════════════════════════════════════════
    //  7. SCORING  (each factor returns 0..1, higher = better)
    // ═════════════════════════════════════════════════════════════════

    private double score(ClothingItem top, ClothingItem bottom, ClothingItem shoes, ClothingItem outer, Ctx c) {
        List<ClothingItem> p = piecesOf(top, bottom, shoes, outer);
        return W_WARMTH    * warmthScore(p, c)
             + W_FORMALITY * formalityScore(p, c.event())
             + W_DECAY     * decayScore(p, c)
             + W_RAIN      * rainScore(shoes, outer, c.weather())
             + W_LAYER     * layerScore(outer, c.mode())
             + W_MATERIAL  * materialScore(p, c.weather())
             + W_TONE      * toneScore(p, c.weather())
             + W_WIND      * windScore(bottom, c.weather());
    }

    /** Is the total warmth of the outfit close to what today's temperature needs? */
    private double warmthScore(List<ClothingItem> p, Ctx c) {
        int total = 0;
        for (ClothingItem i : p) total += WARMTH.getOrDefault(norm(i.getType()), 1);

        // On cool-morning/warm-afternoon days, dress for the blend of the two.
        double temp = c.mode() == LayerMode.OPTIONAL
                ? (c.weather().feelsLike() + c.weather().minTemp()) / 2.0
                : c.weather().feelsLike();

        // 30C -> need ~2 warmth points (tee+shorts+sandals); 10C -> ~11 (full layers)
        double needed = clamp(2 + (30 - temp) * 0.45, 2, 12);
        return clamp(1 - Math.abs(total - needed) / 6.0, 0, 1);
    }

    /** Does the outfit match the calendar event, and do its pieces match each other? */
    private double formalityScore(List<ClothingItem> p, Event event) {
        double avg = avgFormality(p);
        int min = Integer.MAX_VALUE, max = Integer.MIN_VALUE;
        for (ClothingItem i : p) {
            int f = formalityOf(i);
            min = Math.min(min, f);
            max = Math.max(max, f);
        }
        double fit = clamp(1 - Math.abs(avg - event.formality()) / 3.0, 0, 1);
        double coherence = clamp(1 - (max - min) / 4.0, 0, 1);   // no tuxedo shoes with a hoodie
        return 0.5 * fit + 0.2 * coherence + 0.3 * occasionMatch(p, event);
    }

    /** Occasion tags the user gave each item (several allowed) that suit each dress code. */
    private static final Map<Event, Set<String>> OCCASIONS_FOR_EVENT = Map.of(
            Event.FORMAL,  Set.of("formal"),
            Event.WORK,    Set.of("work", "formal"),
            Event.PARTY,   Set.of("party"),
            Event.COLLEGE, Set.of("daily", "travel", "work"),
            Event.CASUAL,  Set.of("daily", "travel", "sports"));

    /** Share of pieces the user tagged for this dress code (untagged pieces count as neutral). */
    private double occasionMatch(List<ClothingItem> p, Event event) {
        Set<String> wanted = OCCASIONS_FOR_EVENT.getOrDefault(event, Set.of());
        double sum = 0;
        for (ClothingItem i : p) {
            List<String> tags = splitList(i.getOccasion());
            if (tags.isEmpty()) { sum += 0.5; continue; }
            sum += tags.stream().anyMatch(wanted::contains) ? 1.0 : 0.0;
        }
        return sum / p.size();
    }

    /** USAGE-DECAY: the longer an item sat unworn, the bigger the bonus. */
    private double decayScore(List<ClothingItem> p, Ctx c) {
        double sum = 0;
        for (ClothingItem i : p) {
            double recency = i.getLastWornDate() == null
                    ? 1.0
                    : clamp(daysSince(i, c.today()) / (double) DECAY_FULL_DAYS, 0, 1);
            double usage = 1.0 - (double) i.getWearCount() / (c.maxWear() + 1);
            sum += 0.7 * recency + 0.3 * usage;
        }
        return sum / p.size();
    }

    /** Rainy day: reward boots/jackets, punish sandals and suede. */
    private double rainScore(ClothingItem shoes, ClothingItem outer, WeatherContext w) {
        if (!w.isRainy()) return 1.0;
        double outerPart = outer != null ? rainSuitability(outer) : 0.5;
        double shoePart = shoes != null ? rainSuitability(shoes) : 0.5;
        return 0.7 * shoePart + 0.3 * outerPart;
    }

    private double rainSuitability(ClothingItem item) {
        double base = switch (norm(item.getType())) {
            case "boots"    -> 1.0;
            case "jacket"   -> 0.9;
            case "sneakers" -> 0.7;
            case "hoodie"   -> 0.6;
            case "shoes"    -> 0.6;
            case "sweater"  -> 0.5;
            case "loafers"  -> 0.4;
            case "sandals"  -> 0.0;
            default         -> 0.6;
        };
        return norm(item.getPattern()).equals("suede") ? Math.min(base, 0.2) : base;
    }

    /** Cool morning + warm afternoon: prefer an easy-to-remove layer. */
    private double layerScore(ClothingItem outer, LayerMode mode) {
        if (mode != LayerMode.OPTIONAL) return 1.0;
        if (outer == null) return 0.4;
        return norm(outer.getType()).equals("jacket") ? 0.85 : 1.0;   // sweater/hoodie are lighter to carry
    }

    /** Hot: breathable fabrics. Cold: warm fabrics. */
    private double materialScore(List<ClothingItem> p, WeatherContext w) {
        double sum = 0;
        for (ClothingItem i : p) {
            String m = norm(i.getPattern());
            boolean heavy = HEAVY_MATERIALS.contains(m);
            boolean breathable = BREATHABLE_MATERIALS.contains(m);
            if (w.feelsLike() >= WARM_FEELS_LIKE)      sum += heavy ? 0.1 : (breathable ? 1.0 : 0.6);
            else if (w.feelsLike() <= 12)              sum += heavy ? 1.0 : 0.5;
            else                                       sum += 0.8;
        }
        return sum / p.size();
    }

    /** Hot: light colors. Cold or rainy: darker colors. */
    private double toneScore(List<ClothingItem> p, WeatherContext w) {
        boolean hot = w.feelsLike() >= WARM_FEELS_LIKE;
        boolean gloomy = w.feelsLike() <= COLD_FEELS_LIKE || w.isRainy();
        double sum = 0;
        for (ClothingItem i : p) {
            List<String> cols = colorsOf(i);
            if (cols.isEmpty() || !(hot || gloomy)) { sum += 0.6; continue; }
            double itemSum = 0;
            for (String col : cols) {
                if (hot) itemSum += LIGHT_COLORS.contains(col) ? 1.0 : (DARK_COLORS.contains(col) ? 0.3 : 0.6);
                else     itemSum += DARK_COLORS.contains(col) ? 1.0 : (LIGHT_COLORS.contains(col) ? 0.4 : 0.6);
            }
            sum += itemSum / cols.size();
        }
        return sum / p.size();
    }

    /** Windy day: skirts are a bad idea. */
    private double windScore(ClothingItem bottom, WeatherContext w) {
        return (w.windSpeed() > WINDY_KMH && norm(bottom.getType()).equals("skirt")) ? 0.3 : 1.0;
    }

    // ═════════════════════════════════════════════════════════════════
    //  8. DIVERSITY: don't return 3 near-identical outfits
    // ═════════════════════════════════════════════════════════════════

    private List<Scored> pickDiverse(List<Scored> all) {
        List<Scored> sorted = new ArrayList<>(all);
        sorted.sort(Comparator.comparingDouble(Scored::score).reversed());

        List<Scored> picked = new ArrayList<>();
        // First insist on sharing at most 1 item; relax only if we can't fill 3 slots.
        for (int maxShared = 1; maxShared <= 4 && picked.size() < MAX_RESULTS; maxShared++) {
            for (Scored s : sorted) {
                if (picked.size() >= MAX_RESULTS) break;
                if (picked.stream().anyMatch(p -> p == s)) continue;
                final int limit = maxShared;
                if (picked.stream().allMatch(p -> sharedItems(p, s) <= limit)) picked.add(s);
            }
        }
        picked.sort(Comparator.comparingDouble(Scored::score).reversed());
        return picked;
    }

    private int sharedItems(Scored a, Scored b) {
        int n = 0;
        for (ClothingItem x : a.pieces()) {
            for (ClothingItem y : b.pieces()) {
                if (sameItem(x, y)) n++;
            }
        }
        return n;
    }

    private boolean sameItem(ClothingItem a, ClothingItem b) {
        return a == b || (a.getId() != null && a.getId().equals(b.getId()));
    }

    // ═════════════════════════════════════════════════════════════════
    //  9. EXPLANATION  (shown to the user / judges)
    // ═════════════════════════════════════════════════════════════════

    private String explain(Scored s, Ctx c) {
        WeatherContext w = c.weather();
        List<String> parts = new ArrayList<>();

        StringBuilder head = new StringBuilder(String.format(Locale.ROOT, "Feels like %.0f\u00B0C", w.feelsLike()));
        if (w.isRainy()) head.append(", rain likely");
        else if (w.windSpeed() > WINDY_KMH) head.append(", windy");
        parts.add(head.append('.').toString());

        switch (c.mode()) {
            case REQUIRED -> parts.add("It's cold, so your " + name(s.outer()) + " keeps you warm.");
            case OPTIONAL -> parts.add(s.outer() != null
                    ? String.format(Locale.ROOT,
                        "Cool start (%.0f\u00B0C) warming to %.0f\u00B0C, so your %s is easy to take off later.",
                        w.minTemp(), w.maxTemp(), name(s.outer()))
                    : String.format(Locale.ROOT,
                        "It warms up to %.0f\u00B0C, so you can go without a layer.", w.maxTemp()));
            case NONE -> {
                if (w.feelsLike() > HOT_FEELS_LIKE) parts.add("Hot day, so light pieces and no outerwear.");
            }
        }
        if (c.missingOuter()) {
            parts.add("It's cold but no jackets or sweaters are saved; adding one would complete the look.");
        }
        if (w.isRainy() && s.shoes() != null) {
            parts.add("Your " + name(s.shoes())
                    + (rainSuitability(s.shoes()) >= 0.6 ? " handles the rain well." : " is the driest option available."));
        }
        if (Math.abs(avgFormality(s.pieces()) - c.event().formality()) <= 1.0) {
            parts.add("Suits a " + c.event().label() + " day.");
        }

        ClothingItem stale = mostNeglected(s.pieces(), c.today());
        if (stale != null) {
            long days = daysSince(stale, c.today());
            parts.add(days >= 9999
                    ? "You haven't worn your " + name(stale) + " yet."
                    : "You haven't worn your " + name(stale) + " in " + days + " days.");
        }
        return String.join(" ", parts);
    }

    private ClothingItem mostNeglected(List<ClothingItem> pieces, LocalDate today) {
        ClothingItem best = null;
        long bestDays = NEGLECTED_DAYS - 1;
        for (ClothingItem i : pieces) {
            long d = daysSince(i, today);
            if (d > bestDays) {
                bestDays = d;
                best = i;
            }
        }
        return best;
    }

    // ═════════════════════════════════════════════════════════════════
    //  10. SMALL HELPERS
    // ═════════════════════════════════════════════════════════════════

    private record Ctx(WeatherContext weather, Event event, LayerMode mode,
                       LocalDate today, int maxWear, boolean missingOuter) { }

    private record Scored(ClothingItem top, ClothingItem bottom, ClothingItem shoes,
                          ClothingItem outer, double score) {
        List<ClothingItem> pieces() {
            return piecesOf(top, bottom, shoes, outer);
        }
    }

    private static List<ClothingItem> piecesOf(ClothingItem top, ClothingItem bottom,
                                               ClothingItem shoes, ClothingItem outer) {
        List<ClothingItem> l = new ArrayList<>(4);
        l.add(top);
        l.add(bottom);
        if (shoes != null) l.add(shoes);
        if (outer != null) l.add(outer);
        return Collections.unmodifiableList(l);
    }

    private Slot slotOf(ClothingItem i) {
        return SLOT_BY_TYPE.getOrDefault(norm(i.getType()), Slot.UNKNOWN);
    }

    private int formalityOf(ClothingItem i) {
        int f = FORMALITY.getOrDefault(norm(i.getType()), 2);
        String m = norm(i.getPattern());
        if (m.equals("tailored") || m.equals("pleated")) f += 1;
        if (m.equals("graphic") || m.equals("fleece") || m.equals("canvas")) f -= 1;
        return (int) clamp(f, 1, 5);
    }

    private double avgFormality(List<ClothingItem> p) {
        double sum = 0;
        for (ClothingItem i : p) sum += formalityOf(i);
        return sum / p.size();
    }

    private long daysSince(ClothingItem i, LocalDate today) {
        if (i.getLastWornDate() == null) return 9999;
        return Math.max(0, ChronoUnit.DAYS.between(i.getLastWornDate(), today));
    }

    private String name(ClothingItem i) {
        return String.join("/", colorsOf(i)) + " " + norm(i.getType());
    }

    /** "Navy, White" -> [navy, white]. Colour and occasion are stored as comma-separated lists. */
    static List<String> splitList(String raw) {
        List<String> out = new ArrayList<>();
        if (raw == null) return out;
        for (String part : raw.split(",")) {
            String v = norm(part);
            if (!v.isEmpty() && !out.contains(v)) out.add(v);
        }
        return out;
    }

    private static List<String> colorsOf(ClothingItem i) {
        return splitList(i.getColor());
    }

    private static String norm(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT).trim();
    }

    private static double clamp(double v, double lo, double hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
