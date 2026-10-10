/* ═══════════════════════════════════════════════════════
   AI Wardrobe — API Service Layer (Supabase)
   Same method names as before, so pages need no change.
   Needs: window.sb (supabase client, from auth.js)
   ═══════════════════════════════════════════════════════ */

const DB = {
  _uid: null,

  /** logged-in user ka users.id (bigint) */
  async userId() {
    if (this._uid) return this._uid;
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not logged in');
    const { data, error } = await sb
      .from('users').select('id').eq('auth_user_id', user.id).single();
    if (error) throw new Error('User profile not found: ' + error.message);
    this._uid = data.id;
    return this._uid;
  },

  /** DB row -> frontend shape (camelCase) */
  toItem(r) {
    return {
      id: r.id,
      type: r.type || r.category || '',
      color: r.color || '',
      pattern: r.pattern || 'solid',
      imageUrl: r.image_url || '',
      price: Number(r.price) || 0,
      wearCount: r.wear_count || 0,
      lastWornDate: r.last_worn_date || null,
      name: r.name || '',
      brand: r.brand || '',
      season: r.season || '',
      occasion: r.occasion || '',
      rating: r.rating,
    };
  },

  /** frontend shape -> DB row */
    toRow(i) {
    const row = {};
    if (i.type !== undefined) row.type = i.type;
    if (i.color !== undefined) row.color = i.color;
    if (i.pattern !== undefined) row.pattern = i.pattern;
    if (i.imageUrl !== undefined) row.image_url = i.imageUrl;
    if (i.price !== undefined) row.price = Number(i.price) || 0;
    if (i.wearCount !== undefined) row.wear_count = i.wearCount;
    if (i.lastWornDate !== undefined) row.last_worn_date = i.lastWornDate;
    if (i.name !== undefined) row.name = i.name;
    if (i.brand !== undefined) row.brand = i.brand;
    if (i.season !== undefined) row.season = i.season;
    if (i.occasion !== undefined) row.occasion = i.occasion;
    if (i.rating !== undefined) row.rating = i.rating === '' || i.rating === null ? null : Number(i.rating);
    return row;
  },
};

/* ── Pure logic (pehle LocalStore me tha), ab items array pe chalta hai ── */
const Logic = {
  stats(items) {
    if (!items.length) {
      return { totalItems: 0, utilizationRate: 0, averageCostPerWear: 0, mostWorn: [], leastWorn: [] };
    }
    const cutoff = Date.now() - 30 * 86400000;
    const active = items.filter(i => i.lastWornDate && new Date(i.lastWornDate).getTime() >= cutoff);
    const totalCost = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
    const totalWears = items.reduce((s, i) => s + (Number(i.wearCount) || 0), 0);
    return {
      totalItems: items.length,
      utilizationRate: (active.length / items.length) * 100,
      averageCostPerWear: totalWears > 0 ? totalCost / totalWears : totalCost,
      mostWorn: [...items].sort((a, b) => b.wearCount - a.wearCount).slice(0, 3),
      leastWorn: [...items].sort((a, b) => a.wearCount - b.wearCount).slice(0, 3),
    };
  },

  recommend(items) {
    const G = {
      tops: ['shirt', 't-shirt', 'blouse', 'top'],
      bottoms: ['pants', 'jeans', 'shorts', 'skirt', 'trousers'],
      shoes: ['shoes', 'sneakers', 'boots', 'sandals', 'loafers'],
      outer: ['jacket', 'sweater', 'hoodie'],
    };
    const clash = [
      ['red', 'green'], ['red', 'orange'], ['red', 'pink'], ['orange', 'pink'],
      ['brown', 'black'], ['navy', 'black'], ['green', 'orange'], ['purple', 'red'],
      ['yellow', 'green'], ['brown', 'gray'],
    ];
    const isClash = (c1, c2) => {
      const a = (c1 || '').toLowerCase().trim(), b = (c2 || '').toLowerCase().trim();
      return clash.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
    };
    const limit = Date.now() - 2 * 86400000;
    const ok = i => !i.lastWornDate || new Date(i.lastWornDate).getTime() < limit;
    const pick = g => items.filter(i => G[g].includes((i.type || '').toLowerCase()) && ok(i));

    const tops = pick('tops'), bottoms = pick('bottoms'), shoes = pick('shoes'), outers = pick('outer');
    const combos = [];
    for (const t of tops) for (const b of bottoms) for (const s of shoes) {
      if (isClash(t.color, b.color) || isClash(t.color, s.color) || isClash(b.color, s.color)) continue;
      const out = outers.find(o => !isClash(o.color, t.color) && !isClash(o.color, b.color) && !isClash(o.color, s.color));
      combos.push({
        top: t, bottom: b, footwear: s, outerwear: out || null,
        totalWearCount: t.wearCount + b.wearCount + s.wearCount + (out ? out.wearCount : 0),
      });
    }
    return combos.sort((a, b) => a.totalWearCount - b.totalWearCount).slice(0, 3);
  },
};

const API = {
  // ═══════ Clothing Items ═══════
  async getAllClothes() {
    const uid = await DB.userId();
    const { data, error } = await sb
      .from('clothing_items').select('*').eq('user_id', uid).order('id', { ascending: false });
    if (error) throw new Error(error.message);
    return data.map(DB.toItem);
  },

  /**
   * Item add karta hai. File di ho to:
   *   1) pehle image upload (fail hui -> item save hi nahi hoga)
   *   2) fir insert (fail hua -> uploaded image delete / rollback)
   * Optional `originalFile`: the untouched photo, stored next to the final image (e.g. when the
   * final image is a garment extracted by Beautify) and saved as original_image_path.
   * Bucket "clothes" (public) chahiye.
   */
  async addClothingItem(item, file = null, originalFile = null) {
    const uid = await DB.userId();
    const uploaded = [];
    let imageUrl = item.imageUrl || '';
    let originalImagePath;
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const extOf = (f) => (f.name.split('.').pop() || 'jpg').toLowerCase();

    try {
      if (file) {
        const path = `${uid}/${stamp}.${extOf(file)}`;
        const { error: upErr } = await sb.storage.from('clothes').upload(path, file);
        if (upErr) throw new Error('Image upload failed: ' + upErr.message);
        uploaded.push(path);
        imageUrl = sb.storage.from('clothes').getPublicUrl(path).data.publicUrl;
      }
      if (originalFile) {
        const path = `${uid}/${stamp}-original.${extOf(originalFile)}`;
        const { error: upErr } = await sb.storage.from('clothes').upload(path, originalFile);
        if (upErr) throw new Error('Original photo upload failed: ' + upErr.message);
        uploaded.push(path);
        originalImagePath = path;
      }
    } catch (err) {
      if (uploaded.length) await sb.storage.from('clothes').remove(uploaded); // rollback
      throw err;
    }

    const row = { ...DB.toRow({ ...item, imageUrl, originalImagePath }), user_id: uid, wear_count: item.wearCount || 0 };
    const { data, error } = await sb.from('clothing_items').insert(row).select().single();

    if (error) {
      if (uploaded.length) await sb.storage.from('clothes').remove(uploaded); // rollback
      throw new Error(error.message);
    }
    return DB.toItem(data);
  },

  /** alias, purane call ke liye */
  async addClothingItemWithImage(item, file) {
    return this.addClothingItem(item, file);
  },

  /** Existing item ki image badalne ke liye */
  async uploadClothingImage(id, file) {
    const uid = await DB.userId();
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${uid}/${id}-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from('clothes').upload(path, file, { upsert: true });
    if (error) throw new Error('Image upload failed: ' + error.message);
    const { data } = sb.storage.from('clothes').getPublicUrl(path);
    const { data: row, error: e2 } = await sb
      .from('clothing_items').update({ image_url: data.publicUrl })
      .eq('id', id).eq('user_id', uid).select().single();
    if (e2) {
      await sb.storage.from('clothes').remove([path]); // rollback
      throw new Error(e2.message);
    }
    return DB.toItem(row);
  },

  async updateClothingItem(id, item) {
    const uid = await DB.userId();
    const { data, error } = await sb
      .from('clothing_items').update(DB.toRow(item)).eq('id', id).eq('user_id', uid).select().single();
    if (error) throw new Error(error.message);
    return DB.toItem(data);
  },

  async deleteClothingItem(id) {
    const uid = await DB.userId();
    const { error } = await sb.from('clothing_items').delete().eq('id', id).eq('user_id', uid);
    if (error) throw new Error(error.message);
    return true;
  },

  async getLeastWornItems() {
    const items = await this.getAllClothes();
    return items.sort((a, b) => a.wearCount - b.wearCount);
  },

  // ═══════ AI (Spring backend: keys stay on the server) ═══════

  /** POSTs an image to the backend; errors carry `status` and `unavailable` (not configured / not running). */
  async _postImage(path, file, timeoutMs) {
    const baseUrl = localStorage.getItem('wardrobe_api_url') || CONFIG.API_BASE_URL;
    const formData = new FormData();
    formData.append('file', file);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, { method: 'POST', body: formData, signal: controller ? controller.signal : undefined });
    } catch (error) {
      const err = new Error(error && error.name === 'AbortError' ? 'The AI service took too long.' : 'Backend not reachable at ' + baseUrl + '.');
      err.isNetworkError = true;
      err.unavailable = true;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response.ok) {
      let body = {};
      try { body = await response.json(); } catch (_) {}
      const err = new Error(body.error || body.message || `AI request failed (${response.status})`);
      err.status = response.status;
      // 503: key not configured on the server; 404/405: backend predates this endpoint.
      err.unavailable = [503, 404, 405].includes(response.status);
      throw err;
    }
    return response.json();
  },

  /**
   * POST /api/vision/analyze-image — AI recognition (Gemini) of category, primary colour and pattern,
   * for the main garment and per garment group. Unsure values come back as null.
   */
  async analyzeClothingImage(file) {
    return this._postImage('/api/vision/analyze-image', file, 30000);
  },

  /**
   * POST /api/vision/segment-garments — individual garment outlines from SAM 3 (Roboflow).
   * Resolves to { engine: 'sam3', garments: [{ prompt, type, confidence, polygons }] }.
   */
  async segmentGarments(file) {
    return this._postImage('/api/vision/segment-garments', file, 60000);
  },

  // ═══════ Outfits ═══════
  async getOutfitRecommendations(latitude, longitude) {
    // lat/lon abhi use nahi (weather ke liye alag se Open-Meteo laga sakte hain)
    return Logic.recommend(await this.getAllClothes());
  },

  // ═══════ Analytics ═══════
  async getWardrobeStats() {
    return Logic.stats(await this.getAllClothes());
  },

  // ═══════ Calendar (mock) ═══════
  async getCalendarEvents() {
    return (typeof DUMMY_DATA !== 'undefined' && DUMMY_DATA.calendar) ? DUMMY_DATA.calendar : null;
  },
};