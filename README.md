# 👔 AI_Wardrobe: Dynamic Digital Closet & Intelligent Outfit Re-Mixer

![Spring Boot](https://img.shields.io/badge/Spring_Boot-4.1.1-6DB33F?style=for-the-badge&logo=spring)
![Java](https://img.shields.io/badge/Java-21-ED8B00?style=for-the-badge&logo=openjdk)
![H2 Database](https://img.shields.io/badge/H2-In_Memory-00A9E0?style=for-the-badge)

Welcome to **AI_Wardrobe** — an intelligent backend designed to optimize personal style, maximize wardrobe utilization, and compute cost-per-wear metrics. Built as an API-first hackathon submission.

---

## 🛑 The Problem & 💡 The Solution

**The Problem:** The average consumer wears only 20% of their wardrobe 80% of the time. This leads to "closet fatigue," wasted money, and perfectly good clothing sitting unworn.

**The Solution:** AI_Wardrobe is an intelligent API that tracks clothing inventory and dynamically remixes outfits. It ensures every item in a user's closet is utilized by combining recency filtering, weather awareness, and color theory to surface the perfect outfit for any given day.

---

## 🏗 System Architecture & Tech Stack

Designed with enterprise-grade modularity in mind, the system strictly adheres to the **"Thin-Controller, Fat-Service"** design pattern. Controllers strictly handle HTTP routing and validation, while pure business logic is encapsulated in the service layer.

* **Framework:** Spring Boot 4.1.1 (Java 21)
* **Data Layer:** Spring Data JPA
* **Database:** H2 In-Memory Database (Ideal for rapid hackathon testing & MVP prototyping)
* **Error Handling:** Global `@RestControllerAdvice` for consistent JSON error responses
* **External Integrations:** Free public APIs (Open-Meteo) using `RestTemplate`

---

## 🧠 Core Algorithms

The brain of the application lives in the `OutfitRecommendationService`, utilizing three primary decision drivers:

1. **Usage-Decay Scoring**
   * The system aggregates the `wearCount` of potential item combinations. 
   * **Lowest score wins**: Combinations with the lowest cumulative wear count are recommended first, ensuring neglected clothing is brought to the top of the pile.

2. **3-Way Color Compatibility Graph**
   * A symmetric adjacency matrix prevents outfit clashing (e.g., no red with green).
   * It checks all relational edges simultaneously: Top ↔ Bottom, Top ↔ Footwear, and Bottom ↔ Footwear.

3. **Weather-Aware Layering & Graceful Degradation**
   * Integrates dynamically with the **Open-Meteo API**.
   * If the temperature drops below `15°C`, the algorithm dynamically shifts from 3-way combinations to 4-way layered combinations, adding an Outerwear slot (e.g., a jacket or sweater) and expanding the compatibility graph to 6 edges.
   * **Graceful Degradation:** If the external weather API fails, the system safely defaults to a 20°C warm-weather assumption, ensuring outfit generation is never blocked.

---

## 🔌 API Endpoints

### 👕 Wardrobe Inventory (`/api/clothes`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/clothes` | Upload a new clothing item |
| `GET` | `/api/clothes` | Retrieve all items in the closet |
| `GET` | `/api/clothes/least-worn` | Retrieve items sorted by `wearCount` ascending |
| `POST` | `/api/clothes/{id}/upload-image` | Store the item's final image (and optional `original`) in Supabase Storage |
| `GET` | `/api/clothes/{id}/image` | Redirects to a fresh signed URL for the stored image (used by wardrobe cards) |

### ✨ AI Recommendations (`/api/outfits`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/outfits/recommend` | **Used by the app.** Body `{ latitude, longitude, event, date, items }` — the logged-in user's wardrobe from Supabase. Runs the OutfitEngine with live Open-Meteo weather, the dress code (calendar or picker), today's season, the colour graph and usage-decay. Returns `{ outfits, weather, event, season, seasonFiltered }`. |
| `GET` | `/api/outfits/recommend` | Legacy demo: same engine on the first user in the database. |

### 📊 Analytics Dashboard (`/api/analytics`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/analytics/wardrobe-stats` | Returns total items, 30-day utilization rate, top/bottom worn items, and average Cost-Per-Wear (CPW). |

### 🔮 Smart Integrations Mock (`/api/..`)
*These endpoints demonstrate the system's extended architecture for judges.*
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/vision/analyze-image` | Mocks Computer Vision ML tagging & categorization |
| `POST` | `/api/vision/analyze-image` | **Real** AI recognition (Gemini) of category, primary colour and pattern for the Add to Wardrobe modal. Needs `GEMINI_API_KEY`; unsure values come back as `null` |

### 📸 Add to Wardrobe flow
1. **Upload Image** → the photo is checked in the browser.
2. **AI recognition** (backend, Gemini, **one request per photo**) pre-fills Type, Color and Pattern — for the main garment and for each garment in an outfit photo. Season, Occasion, Brand, Rating and Price are always entered by the user.
3. **Beautify** splits the photo into **one product image per garment**:
   - **SAM 3 via Roboflow** (backend, `POST /api/vision/segment-garments`, needs `ROBOFLOW_API_KEY`): text prompts such as "jacket", "t-shirt", "jeans", "shoes" return a separate outline per garment, so a jacket and the shirt under it become separate items and flat-lay photos work too. Left and right shoes are merged into one pair.
   - **Fallback**: if SAM 3 is not configured, the backend is not running or the quota is used up, an on-device clothing-segmentation model (Transformers.js + `Xenova/segformer_b0_clothes`) is used automatically.
   - Either way the garment is cut out of the original pixels (never redrawn), and the original photo is always kept.
4. The user ticks which images to add — the whole photo or individual garments (never both, to avoid duplicates). Each ticked garment is its own item with its own details, edited via tabs.
5. **Add to Wardrobe** saves each item through Supabase (`API.addClothingItem`): image (and original photo) uploaded to the `clothes` bucket first, rolled back if the insert fails. Items already added are never added again on retry.

### 👗 Daily outfits (Outfits page)
- **Dress code**: chips (Casual / College / Work / Party / Formal) or **Auto**, which reads today's events from the connected calendar ("Client meeting" → Work, "Wedding" → Formal).
- **Smart engine**: the backend's OutfitEngine ranks top × bottom × shoes (+ outerwear when needed) by warmth, rain, wind, layering, fabric, formality and **usage-decay**, skips items worn in the last 2 days, and explains each pick. If the backend is offline, a basic in-browser picker is used and labelled as such.
- **Wear tracking**: "Wear this look today" (outfit cards) and "Mark as worn today" (item details) update wear count and last-worn date, feeding usage-decay, utilization and cost-per-wear.

### 🧾 Receipts & colour
- **Receipt → details**: in the Add form, "Fill price & brand from a receipt" reads the receipt (Gemini) and lets the user pick the matching line.
- **Colour extraction**: each extracted garment's dominant colour is measured from its own pixels (Lab colour space) and used whenever the AI cannot name the colour.

Configuration (`.env`, backend only): `GEMINI_API_KEY` (free key from Google AI Studio), optional `GEMINI_MODEL` (default `gemini-flash-latest`) and `VISION_MIN_CONFIDENCE` (default `0.6`); `ROBOFLOW_API_KEY` (free tier at app.roboflow.com) for SAM 3. Without keys the modal still works: manual entry, and the on-device model for Beautify. The frontend reaches the backend at `CONFIG.API_BASE_URL` (default `http://localhost:8080`).
| `GET` | `/api/ocr/parse-receipt` | Mocks automated receipt parsing via OCR |
| `POST` | `/api/ocr/parse-receipt` | **Real** receipt reading (Gemini): store, date, total and clothing lines with prices — fills brand/price in the Add form |
| `GET` | `/api/calendar/today-events` | Mocks Calendar integration for event-driven dress codes |
| `GET` | `/api/calendar/today?ics=…&date=…&tzOffset=…` | **Real** calendar: today's events from the user's private iCal link (Google / Outlook / iCloud) and the dress code they imply |

---

## 🚀 How to Run Local

Since this project utilizes an H2 In-Memory database and includes a `DataSeeder` that automatically populates dummy users and clothing, getting started is zero-configuration!

1. Clone the repository.
2. Open your terminal in the project root.
3. Run the following command:

```bash
./mvnw spring-boot:run
```

The server will boot up on `http://localhost:8080`. 

**Pro Tip:** Because the `DataSeeder` runs automatically, you can immediately hit the `GET /api/analytics/wardrobe-stats` and `GET /api/outfits/recommend` endpoints to see the algorithms in action!
