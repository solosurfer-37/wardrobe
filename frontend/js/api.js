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
    // Details entered in the Add to Wardrobe form (existing columns)
    if (i.brand !== undefined) row.brand = i.brand;
    if (i.season !== undefined) row.season = i.season;
    if (i.occasion !== undefined) row.occasion = i.occasion;
    if (i.rating !== undefined) row.rating = i.rating;
    if (i.originalImagePath !== undefined) row.original_image_path = i.originalImagePath;
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
    // Items can have several colours ("navy,white"): main colours decide, a shared colour never clashes.
    const cols = (c) => String(c || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
    const isClash = (c1, c2) => {
      const ca = cols(c1), cb = cols(c2);
      if (!ca.length || !cb.length || ca.some(c => cb.includes(c))) return false;
      const a = ca[0], b = cb[0];
      return clash.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
    };
    const limit = Date.now() - 2 * 86400000;
    const ok = i => !i.lastWornDate || new Date(i.lastWornDate).getTime() < limit;
    const pick = g => items.filter(i => G[g].includes((i.type || '').toLowerCase()) && ok(i));

    const tops = pick('tops'), bottoms = pick('bottoms'), shoes = pick('shoes'), outers = pick('outer');
    const combos = [];
    const shoeOpts = shoes.length ? shoes : [null];   // shoes are optional
    for (const t of tops) for (const b of bottoms) for (const s of shoeOpts) {
      const sc = s ? s.color : null;
      if (isClash(t.color, b.color) || isClash(t.color, sc) || isClash(b.color, sc)) continue;
      const out = outers.find(o => !isClash(o.color, t.color) && !isClash(o.color, b.color) && !isClash(o.color, sc));
      combos.push({
        top: t, bottom: b, footwear: s, outerwear: out || null,
        totalWearCount: t.wearCount + b.wearCount + (s ? s.wearCount : 0) + (out ? out.wearCount : 0),
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
  /**
   * Smart outfit engine (Spring backend): the logged-in user's own items are sent along, and the
   * backend adds live weather, today's season and the dress code from `event` (calendar / picker),
   * then ranks outfits with the colour graph and usage-decay.
   * Falls back to the simple in-browser picker if the backend is not reachable.
   * Resolves to { engine: 'smart'|'basic', outfits, weather?, event?, season?, seasonFiltered?, fallbackReason? }
   */
  async getOutfitRecommendations(latitude, longitude, event = null) {
    const items = await this.getAllClothes();
    const today = new Date();
    const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    try {
      const res = await this._json('/api/outfits/recommend', {
        method: 'POST',
        body: JSON.stringify({ latitude, longitude, event, date: localDate, items }),
      }, 20000);
      return { ...res, engine: 'smart', itemCount: items.length };
    } catch (err) {
      console.warn('Smart outfit engine unavailable, using the basic picker:', err);
      return { engine: 'basic', outfits: Logic.recommend(items), fallbackReason: err.message, itemCount: items.length };
    }
  },

  /** Records that these items were worn today (feeds usage-decay, utilization and cost per wear). */
  async logWear(items) {
    const today = new Date();
    const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const updated = [];
    for (const item of items) {
      updated.push(await this.updateClothingItem(item.id, { wearCount: (Number(item.wearCount) || 0) + 1, lastWornDate: localDate }));
    }
    return updated;
  },

  // ═══════ Analytics ═══════
  async getWardrobeStats() {
    return Logic.stats(await this.getAllClothes());
  },

  // ═══════ Calendar (iCal link, read by the backend) ═══════
  calendarLink() {
    return localStorage.getItem('wardrobe_calendar_ics') || '';
  },

  setCalendarLink(url) {
    if (url) localStorage.setItem('wardrobe_calendar_ics', url.trim());
    else localStorage.removeItem('wardrobe_calendar_ics');
  },

  /** Today's events from the connected calendar: { events, suggestedEvent, title } or null if none connected. */
  async getTodayCalendar() {
    const ics = this.calendarLink();
    if (!ics) return null;
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const params = new URLSearchParams({ ics, date: localDate, tzOffset: String(-now.getTimezoneOffset()) });
    return this._json(`/api/calendar/today?${params}`, { method: 'GET' }, 20000);
  },

  /** Dashboard card: the most important event today, or the sample event when no calendar is connected. */
  async getCalendarEvents() {
    if (this.calendarLink()) {
      try {
        const t = await this.getTodayCalendar();
        if (!t || !t.events.length) return { title: 'No events today', category: 'Free day', dressCode: 'Casual', time: '', source: 'calendar' };
        const main = t.events.find(e => e.summary === t.title) || t.events[0];
        const label = { casual: 'Casual', college: 'Smart Casual', party: 'Party', work: 'Business', formal: 'Formal' }[t.suggestedEvent] || 'Casual';
        return { title: main.summary, category: `${t.events.length} event${t.events.length > 1 ? 's' : ''} today`, dressCode: label,
          time: main.allDay ? 'All day' : main.start, source: 'calendar' };
      } catch (err) {
        console.warn('Calendar unavailable:', err);
      }
    }
    return (typeof DUMMY_DATA !== 'undefined' && DUMMY_DATA.calendar) ? { ...DUMMY_DATA.calendar, source: 'sample' } : null;
  },

  // ═══════ Receipts ═══════
  /** Reads a receipt photo (Gemini): { store, date, currency, total, items: [{ name, price, category, color }] } */
  async parseReceipt(file) {
    return this._postImage('/api/ocr/parse-receipt', file, 45000);
  },

  /** JSON request to the Spring backend with a timeout; errors carry status / unavailable. */
  async _json(path, options, timeoutMs) {
    const baseUrl = localStorage.getItem('wardrobe_api_url') || CONFIG.API_BASE_URL;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        signal: controller ? controller.signal : undefined,
      });
    } catch (error) {
      const err = new Error(error && error.name === 'AbortError' ? 'The server took too long.' : 'Backend not reachable at ' + baseUrl + '.');
      err.isNetworkError = true; err.unavailable = true;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response.ok) {
      let body = {};
      try { body = await response.json(); } catch (_) {}
      const err = new Error(body.error || body.message || `Request failed (${response.status})`);
      err.status = response.status;
      err.unavailable = [503, 404, 405].includes(response.status);
      throw err;
    }
    return response.json();
  },
};