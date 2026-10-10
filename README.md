# 👔 AI Wardrobe — Smart Digital Closet & Outfit Recommender

![Spring Boot](https://img.shields.io/badge/Spring_Boot-4.1.1-6DB33F?style=for-the-badge&logo=spring)
![Java](https://img.shields.io/badge/Java-21-ED8B00?style=for-the-badge&logo=openjdk)
![Supabase](https://img.shields.io/badge/Supabase-Auth_·_Postgres_·_Storage-3ECF8E?style=for-the-badge&logo=supabase)
![Gemini](https://img.shields.io/badge/Gemini-Vision-4285F4?style=for-the-badge&logo=google)

Photograph your clothes, let AI catalogue them, and get a weather- and
calendar-aware outfit every day that brings forgotten pieces back into rotation.

---

## 🛑 Problem → 💡 Solution

**Problem:** most people wear about 20% of their wardrobe 80% of the time. Good
clothes sit unworn, money is wasted, and getting dressed is a daily decision.

**Solution:** AI Wardrobe turns a photo into a catalogued item in seconds,
tracks what you actually wear, and recommends outfits that suit today's weather
and today's events — favouring the pieces you have neglected.

---

## ✨ Features

### 📸 Add to Wardrobe (upload-first)

1. **Upload a photo** (or **scan a receipt**). Receipts uploaded through the
   normal photo button are detected automatically.
2. **AI recognition** (Gemini, one request per photo) fills **Type, Colour and
   Pattern** — for the main garment and for each garment in an outfit photo.
   Anything the AI is unsure about is left empty; everything stays editable.
3. **Beautify** (optional) turns the photo into **one clean product image per
   garment**:
   - **SAM 3 via Roboflow** separates a jacket from the shirt under it, works on
     flat-lays, and merges left/right shoes into one pair.
   - **Fallback:** an in-browser model (Transformers.js + SegFormer) runs
     automatically when SAM 3 is unavailable.
   - Garments are cut from the original pixels (never redrawn) and the
     **original photo is always kept**.
4. **Pick what to add** — the whole photo or individual garments, each with its
   own details (tabs).
5. You enter **Season, Occasion, Brand, Rating and Price**.
   - **Colour and Occasion are multi-select** (e.g. _Navy + White_, _Work +
     Formal_). The first colour ticked is the item's main colour.
6. **Save safely:** image uploaded first, rolled back if the database insert
   fails; retries never create duplicates.

### 🧾 Receipts

- Gemini reads store, date, total and each clothing line with its price.
- In receipt mode every clothing line becomes an item; in the photo flow "Fill
  price & brand from a receipt" fills the matching item.

### 👗 Daily outfits

- **Smart engine** (backend `OutfitEngine`) builds top × bottom (+ shoes, +
  outerwear when needed) and scores each combination on:
  - warmth vs. today's temperature, rain, wind, fabric and colour tone (live
    **Open-Meteo** weather)
  - **formality and occasion tags** vs. today's dress code (Casual / College /
    Work / Party / Formal)
  - **usage-decay** — long-unworn items score higher; items worn in the last 2
    days are skipped
  - a **colour-clash graph** (multi-colour aware: a shared colour never clashes)
- Every pick comes with a plain-language reason. Shoes and outerwear are
  optional, so outfits work even with only tops and bottoms.
- **Calendar → dress code:** paste your calendar's private iCal link (Google /
  Outlook / iCloud). "Client meeting" → Work, "Wedding" → Formal. Or choose a
  dress code manually.
- **Fallback:** if the backend is offline, a basic in-browser picker is used and
  labelled as such.

### 📊 Wear tracking & analytics

- "Wear this look today" and "Mark as worn today" update wear count and
  last-worn date.
- Dashboard and analytics are computed from **your real data**: item count,
  wardrobe value (₹), cost per wear, 30-day utilisation, idle items, least-worn
  pieces. An empty wardrobe shows honest empty states, not demo numbers.

### 🗂 Wardrobe

- Filter by category, **colour** (matches any of an item's colours) and
  **occasion**; search by type, colour, pattern or occasion; sort by wears, type
  or price.

---

## 🏗 Architecture

```
Browser (GitHub Pages / local)                 Spring Boot backend (localhost:8080 or a host)
┌────────────────────────────────┐            ┌──────────────────────────────────────────────┐
│ Vanilla JS multi-page app      │──REST────▶ │ /api/vision/analyze-image   → Gemini          │
│  • Supabase Auth (login)       │            │ /api/vision/segment-garments→ Roboflow SAM 3  │
│  • Supabase DB + Storage       │            │ /api/ocr/parse-receipt      → Gemini          │
│    (items, images) directly    │            │ /api/outfits/recommend      → OutfitEngine +  │
│  • In-browser fallbacks        │            │                               Open-Meteo      │
└──────────────┬─────────────────┘            │ /api/calendar/today         → iCal parser     │
               │                              └──────────────────────────────────────────────┘
               ▼
        Supabase (Postgres + Storage bucket "clothes")
```

- **Frontend:** HTML/CSS/vanilla JS in `frontend/`. Talks to Supabase directly
  (publishable key only) and to the backend for AI features.
- **Backend:** Spring Boot 4.1.1 / Java 21, thin controllers + services. **All
  secret keys live only in the backend `.env`.**
- **Free services only:** Gemini free tier, Roboflow free tier, Open-Meteo (no
  key), iCal links (no OAuth).

---

## 🚀 Getting started

### Prerequisites

- Java 21 (Maven is bundled via `mvnw`)
- A Supabase project
- Free API keys: [Google AI Studio](https://aistudio.google.com/apikey) (Gemini)
  and [Roboflow](https://app.roboflow.com) → Settings → API Keys (use the
  **private** key; no project needed)

### 1. Supabase setup (once per project)

- **Auth:** enable Email sign-in.
- **Tables:** run `src/main/resources/schema-supabase.sql` in **Supabase → SQL
  Editor**.
- **Storage:** create a **public** bucket named `clothes` and add policies so
  logged-in users can upload, read and delete their own files.
- Put your project URL and **publishable** key in `frontend/js/auth.js` (never
  the secret/service-role key).

### 2. Backend

```bash
cp .env.example .env      # then fill in the values
./mvnw spring-boot:run    # Windows: mvnw spring-boot:run
```

Wait for `Started SmartWardrobeApplication` — the API is on
`http://localhost:8080`.

### 3. Frontend

Open the deployed GitHub Pages site, or serve `frontend/` locally (e.g. VS Code
Live Server). Sign up, then add your first item with **+**.

> After changing Java code, restart the backend with
> `./mvnw clean spring-boot:run`. After changing frontend files, hard-refresh
> (Ctrl+Shift+R).

---

## 🔐 Configuration (`.env`, backend only)

| Variable                                                               | Required    | Purpose                                                                            |
| ---------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `SUPABASE_DB_URL`, `SUPABASE_DB_USER`, `SUPABASE_DB_PASSWORD`          | yes         | Postgres connection (URL must start with `jdbc:`)                                  |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | yes         | Server-side storage access                                                         |
| `GEMINI_API_KEY`                                                       | recommended | Clothing recognition + receipt reading. Empty → details entered manually           |
| `GEMINI_MODEL`                                                         | no          | Default `gemini-flash-latest` (`gemini-flash-lite-latest` for a larger free quota) |
| `ROBOFLOW_API_KEY`                                                     | recommended | SAM 3 garment extraction. Empty → in-browser model                                 |
| `ROBOFLOW_SAM3_MIN_CONFIDENCE`                                         | no          | Default `0.5`                                                                      |

Weather (Open-Meteo) and calendar (iCal link pasted by each user) need no keys.

**Each teammate keeps their own `.env`** — it is git-ignored and never
committed.

### How the deployed site finds the backend

GitHub Pages hosts **only the frontend** and never reads `.env`. The frontend
calls the backend at `CONFIG.API_BASE_URL` in `frontend/js/config.js` (default
`http://localhost:8080`), which can be overridden per browser on the
**Settings** page.

- **Presenting from your own PC:** start the backend locally, then open the
  Pages link in Chrome on the same PC. If Chrome asks to allow access to devices
  on your local network, click **Allow**.
- **For everyone else:** host the backend (e.g. Render), add the `.env` values
  as environment variables in the host's dashboard, and set `API_BASE_URL` to
  the hosted URL.
- Without a reachable backend, login, wardrobe, analytics and saving still work
  (Supabase); AI features fall back to the in-browser versions.

### Free-tier limits (check your dashboards)

- **Roboflow:** 10 credits/month ≈ 20,000 SAM 3 images. One request per
  Beautify.
- **Gemini:** roughly 10 requests/minute and a few hundred per day on Flash
  models, **per Google Cloud project**. One request per photo or receipt;
  results are cached. See your limits at aistudio.google.com/rate-limit.

---

## 🔌 API reference

| Method       | Endpoint                                                                    | Description                                                                                               |
| ------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `POST`       | `/api/vision/analyze-image`                                                 | Gemini: category, colour, pattern (+ per-garment results, and whether the image is clothing or a receipt) |
| `POST`       | `/api/vision/segment-garments`                                              | Roboflow SAM 3: one outline per garment                                                                   |
| `POST`       | `/api/ocr/parse-receipt`                                                    | Gemini: store, date, currency, total, clothing lines                                                      |
| `POST`       | `/api/outfits/recommend`                                                    | Body `{ latitude, longitude, event, date, items }` → `{ outfits, weather, event, season, … }`             |
| `GET`        | `/api/calendar/today?ics=…&date=…&tzOffset=…`                               | Today's events from an iCal link and the dress code they imply                                            |
| `GET`/`POST` | `/api/clothes`, `/api/clothes/least-worn`, `/api/clothes/{id}/upload-image` | Legacy wardrobe endpoints                                                                                 |
| `GET`        | `/api/analytics/wardrobe-stats`                                             | Legacy server-side stats                                                                                  |

---

## 🗄 Data model notes

- `clothing_items.color`, `occasion` and `season` are **comma-separated lists**
  (e.g. `navy,white`, `work,formal`, `spring,summer`). Single values from older
  items still work.
- Images live in the `clothes` bucket; the extracted product image and the
  original photo are both kept.

---

## 🧪 Tests

```bash
./mvnw test
```

Unit tests cover the outfit engine, calendar parsing (time zones, repeats,
exceptions), Gemini request/response handling, SAM 3 parsing and receipt
parsing.

---

## 📁 Project structure

```
├── frontend/                 # The web app (deployed to GitHub Pages)
│   ├── *.html                # Dashboard, wardrobe, outfits, analytics, settings, login
│   ├── css/
│   └── js/
│       ├── auth.js           # Supabase client + login guard
│       ├── api.js            # Supabase data access + backend calls + fallbacks
│       ├── app.js            # Add to Wardrobe flow
│       ├── clothing-beautify.js  # SAM 3 / in-browser garment extraction
│       ├── stories.js        # Dashboard wardrobe summary
│       └── pages/            # Per-page logic
├── src/main/java/com/smartwardrobe/
│   ├── controllers/          # REST endpoints
│   ├── services/             # Gemini, SAM 3, receipts, calendar, weather, outfits
│   ├── engine/OutfitEngine.java
│   └── dto/ · entities/ · config/
├── src/main/resources/       # application.properties, schema-supabase.sql
├── .env.example
└── index.html                # Redirects to frontend/ (for GitHub Pages)
```

---

## ⚠️ Known limitations

- The calendar link is stored in the browser, not the account: paste it again on
  a new device, and click **Disconnect** on shared computers.
- Calendar repeats support daily/weekly rules; monthly/yearly repeats are
  skipped.
- Backend AI endpoints are not authenticated — fine for a demo, but add auth
  before a public launch.
- Free-tier quotas apply; the app falls back gracefully when they run out.

```bash
./mvnw spring-boot:run
```

The server will boot up on `http://localhost:8080`.

**Pro Tip:** Because the `DataSeeder` runs automatically, you can immediately
hit the `GET /api/analytics/wardrobe-stats` and `GET /api/outfits/recommend`
endpoints to see the algorithms in action!
