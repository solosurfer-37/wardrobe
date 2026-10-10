/* ═══════════════════════════════════════════════════════
   AI Wardrobe — Configuration
   ═══════════════════════════════════════════════════════ */

const CONFIG = {
  // Backend API base URL — change to match your Spring Boot server
  API_BASE_URL: 'http://localhost:8080',

  // Clothing categories from the backend OutfitRecommendationService
  CATEGORIES: {
    tops: ['shirt', 't-shirt', 'blouse', 'top'],
    outerwear: ['jacket', 'sweater', 'hoodie'],
    bottoms: ['pants', 'jeans', 'shorts', 'skirt', 'trousers'],
    footwear: ['shoes', 'sneakers', 'boots', 'sandals', 'loafers'],
  },

  // All valid types (flattened)
  ALL_TYPES: [
    'shirt', 't-shirt', 'blouse', 'top',
    'jacket', 'sweater', 'hoodie',
    'pants', 'jeans', 'shorts', 'skirt', 'trousers',
    'shoes', 'sneakers', 'boots', 'sandals', 'loafers',
  ],

  // Colors supported (from backend data seeder and color compatibility graph)
  COLORS: [
    'white', 'black', 'blue', 'red', 'green', 'navy',
    'gray', 'brown', 'beige', 'pink', 'yellow', 'orange', 'purple',
  ],

  // CSS color map for rendering color dots
  COLOR_MAP: {
    white: '#FFFFFF', black: '#2C2C2C', blue: '#4A7BC7',
    red: '#C75050', green: '#5E8C61', navy: '#2C3E6B',
    gray: '#8A8A8A', brown: '#8B6F47', beige: '#D4C9B8',
    pink: '#D4839E', yellow: '#D4B83E', orange: '#D49A3E',
    purple: '#8B6BAE',
  },

  // Add to Wardrobe → Beautify: one product image per garment (garment segmentation, not
  // just background removal). Garment pixels are always copied unchanged from the photo.
  BEAUTIFY: {
    // 'auto': SAM 3 via the backend (needs ROBOFLOW_API_KEY there), else the on-device model.
    // 'sam3': SAM 3 only. 'local': on-device model only (no server call).
    ENGINE: 'auto',
    LIBRARY_URL: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js',
    MODEL_ID: 'Xenova/segformer_b0_clothes',
    DTYPE: 'fp32',        // full precision (~15 MB); 'q8' is smaller but gives blotchier masks
    REFINE: true,         // second, finer pass on a crop around the person
    WORKING_SIZE: 1280,   // longest side used for segmentation
    OUTPUT_SIZE: 1024,    // longest side of the beautified square image
  },

  // Default location (New Delhi, as per backend defaults)
  DEFAULT_LATITUDE: 28.6139,
  DEFAULT_LONGITUDE: 77.2090,
};

// Freeze config to prevent accidental mutation
Object.freeze(CONFIG);
Object.freeze(CONFIG.CATEGORIES);
Object.freeze(CONFIG.ALL_TYPES);
Object.freeze(CONFIG.COLORS);
Object.freeze(CONFIG.COLOR_MAP);
Object.freeze(CONFIG.BEAUTIFY);
