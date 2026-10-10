/* ═══════════════════════════════════════════════════════
   AI Wardrobe — Outfit Recommendation Engine
   ═══════════════════════════════════════════════════════ */

const OutfitsPage = {
  latitude: CONFIG.DEFAULT_LATITUDE,
  longitude: CONFIG.DEFAULT_LONGITUDE,
  recommendations: null,
  result: null,        // last engine response (weather, event, season, engine)
  calendar: null,      // today's calendar events (if a calendar is connected)

  EVENTS: [
    { value: 'auto', label: 'Auto (calendar)' },
    { value: 'casual', label: 'Casual' },
    { value: 'college', label: 'College' },
    { value: 'work', label: 'Work' },
    { value: 'party', label: 'Party' },
    { value: 'formal', label: 'Formal' },
  ],

  selectedEvent() {
    return localStorage.getItem('wardrobe_event') || 'auto';
  },

  init() {
    const savedLat = parseFloat(localStorage.getItem('wardrobe_lat'));
    const savedLon = parseFloat(localStorage.getItem('wardrobe_lon'));
    if (!isNaN(savedLat)) this.latitude = savedLat;
    if (!isNaN(savedLon)) this.longitude = savedLon;

    if (window.lucide) lucide.createIcons();

    // Dynamic render if page-container is empty
    const container = document.getElementById('page-container');
    if (container && !document.getElementById('outfit-results-container')) {
      container.innerHTML = `
        <div class="outfits-page animate-fade-in">
          <div id="outfit-context-bar" class="outfit-context-bar"></div>
          <div class="outfit-results" id="outfit-results-container"></div>
          <div id="outfit-weather-bar" class="outfit-weather-bar" style="display:none;"></div>
        </div>`;
    }

    if (container && !document.getElementById('outfit-context-bar')) {
      const bar = document.createElement('div');
      bar.id = 'outfit-context-bar';
      bar.className = 'outfit-context-bar';
      const results = document.getElementById('outfit-results-container');
      if (results) results.parentNode.insertBefore(bar, results);
    }

    this.generateRecommendations();
  },

  // ── Dress code + calendar ───────────────────────────────────────────
  renderContextBar() {
    const bar = document.getElementById('outfit-context-bar');
    if (!bar) return;
    const sel = this.selectedEvent();
    const link = API.calendarLink();
    const cal = this.calendar;
    let calHTML;
    if (!link) {
      calHTML = `
        <button type="button" class="link-button" id="btn-connect-calendar"><i data-lucide="calendar-plus"></i> Connect your calendar</button>
        <span class="ctx-muted">so today's events pick the dress code automatically</span>
        <div class="ctx-connect" id="ctx-connect" hidden>
          <input type="url" id="ctx-ics-input" placeholder="Paste your calendar's private iCal (.ics) link" />
          <button type="button" class="btn btn-primary btn-sm" id="btn-save-calendar">Save</button>
          <p class="ctx-help">Google Calendar: Settings → your calendar → <em>Secret address in iCal format</em>.
            Outlook: Settings → Calendar → Shared calendars → <em>Publish</em> → ICS. The link is kept in this browser only.</p>
        </div>`;
    } else if (cal && cal.error) {
      calHTML = `<span class="ctx-warn"><i data-lucide="calendar-x"></i> Calendar: ${Utils.escapeHTML(cal.error)}</span>
        <button type="button" class="link-button" id="btn-disconnect-calendar">Disconnect</button>`;
    } else if (cal && cal.events) {
      const list = cal.events.length
        ? cal.events.slice(0, 3).map(e => `${Utils.escapeHTML(e.summary)}${e.allDay ? '' : ` <span class="ctx-muted">${e.start}</span>`}`).join(' · ')
        : 'No events today';
      calHTML = `<span><i data-lucide="calendar-check"></i> Today: ${list}</span>
        <button type="button" class="link-button" id="btn-disconnect-calendar">Disconnect</button>`;
    } else {
      calHTML = `<span class="ctx-muted"><i data-lucide="loader-2" class="animate-spin"></i> Reading your calendar…</span>`;
    }

    bar.innerHTML = `
      <div class="ctx-row">
        <span class="ctx-label">Dress code</span>
        <div class="ctx-chips" role="radiogroup" aria-label="Dress code">
          ${this.EVENTS.map(e => `<button type="button" class="ctx-chip${e.value === sel ? ' is-active' : ''}" data-event="${e.value}" role="radio" aria-checked="${e.value === sel}">${e.label}</button>`).join('')}
        </div>
      </div>
      <div class="ctx-row ctx-calendar">${calHTML}</div>`;

    bar.querySelectorAll('.ctx-chip').forEach(btn => btn.addEventListener('click', () => {
      localStorage.setItem('wardrobe_event', btn.dataset.event);
      this.generateRecommendations();
    }));
    const connect = document.getElementById('btn-connect-calendar');
    if (connect) connect.addEventListener('click', () => { document.getElementById('ctx-connect').hidden = false; document.getElementById('ctx-ics-input').focus(); });
    const save = document.getElementById('btn-save-calendar');
    if (save) save.addEventListener('click', () => {
      const v = document.getElementById('ctx-ics-input').value.trim();
      if (!/^(https?|webcals?):\/\//i.test(v)) { Toast.error('Calendar', 'Paste the full iCal link (starts with https:// or webcal://).'); return; }
      API.setCalendarLink(v);
      localStorage.setItem('wardrobe_event', 'auto');
      Toast.success('Calendar connected', "Today's events now set the dress code.");
      this.generateRecommendations();
    });
    const disconnect = document.getElementById('btn-disconnect-calendar');
    if (disconnect) disconnect.addEventListener('click', () => {
      API.setCalendarLink('');
      this.calendar = null;
      this.generateRecommendations();
    });
    if (window.lucide) lucide.createIcons();
  },

  /** Dress code to send to the engine: the chosen chip, or today's calendar events for "Auto". */
  async resolveEvent() {
    const sel = this.selectedEvent();
    if (API.calendarLink()) {
      try {
        this.calendar = await API.getTodayCalendar();
      } catch (err) {
        this.calendar = { error: err.message || 'could not be read' };
      }
    } else {
      this.calendar = null;
    }
    if (sel !== 'auto') return sel;
    if (this.calendar && this.calendar.title) return this.calendar.title;   // e.g. "Client meeting" → work
    return 'casual';
  },

  // ₹ with Indian digit grouping (1,25,000)
  formatINR(n) {
    return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  },

  async generateRecommendations() {
    const container = document.getElementById('outfit-results-container');
    if (!container) return;

    container.innerHTML = `
      <div class="outfit-results-header">
        <div>
          <h3>Consulting Style Engine...</h3>
          <p class="section-subtitle">Querying weather forecasts, checking wear history, &amp; matching color charts</p>
        </div>
      </div>
      <div class="outfit-skeleton-grid">
        <div class="skeleton outfit-skeleton-card"></div>
        <div class="skeleton outfit-skeleton-card"></div>
        <div class="skeleton outfit-skeleton-card"></div>
      </div>`;

    this.renderContextBar();
    try {
      const event = await this.resolveEvent();
      this.renderContextBar();
      const data = await API.getOutfitRecommendations(this.latitude, this.longitude, event);
      this.result = data;
      this.recommendations = (data && data.outfits) || [];
      this.renderResults();
      this.renderWeatherBar();
    } catch (err) {
      console.error('Failed to generate outfits:', err);
      container.innerHTML = `
        <div class="empty-state">
          <i data-lucide="alert-circle" class="empty-icon" style="color:var(--color-error);"></i>
          <h4>Unable to Generate Outfits</h4>
          <p>${Utils.escapeHTML(err.message)}</p>
          <button class="btn btn-primary btn-sm" id="btn-retry-outfits" style="margin-top:var(--space-4);">
            <i data-lucide="rotate-cw"></i> Try Again
          </button>
        </div>`;
      document.getElementById('btn-retry-outfits')?.addEventListener('click', () => OutfitsPage.generateRecommendations());
      if (window.lucide) lucide.createIcons();
    }
  },

  renderResults() {
    const container = document.getElementById('outfit-results-container');
    if (!container) return;

    if (!this.recommendations || this.recommendations.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i data-lucide="hanger" class="empty-icon"></i>
          ${this.result && this.result.itemCount >= 3 ? `
          <h4>No Outfit Fits Today</h4>
          <p>Your saved tops and bottoms couldn't be combined today. Try another dress code, or add more pieces.</p>
          <p class="section-subtitle" style="margin-top:var(--space-2);">${this.describeContext()}</p>` : `
          <h4>Not Enough Items for Outfits</h4>
          <p>Add at least one top and one bottom to get outfit suggestions. Shoes and outerwear are optional, but they make the outfits more complete.</p>`}
          <a href="wardrobe.html" class="btn btn-primary btn-sm" style="margin-top:var(--space-4);">
            <i data-lucide="plus"></i> Add Items to Wardrobe
          </a>
        </div>`;
      if (window.lucide) lucide.createIcons();
      return;
    }

    container.innerHTML = `
      <div class="outfit-results-header">
        <div>
          <h3>Curated Outfits for Today</h3>
          <p class="section-subtitle">${this.describeContext()}</p>
        </div>
        <span class="badge ${this.result && this.result.engine === 'smart' ? 'badge-olive' : 'badge-amber'}">
          ${this.result && this.result.engine === 'smart' ? 'Smart engine' : 'Basic picker'} · ${this.recommendations.length} look${this.recommendations.length === 1 ? '' : 's'}
        </span>
      </div>
      <div class="outfit-list">
        ${this.recommendations.map((outfit, i) => this.renderOutfitCard(outfit, i)).join('')}
      </div>`;

    container.querySelectorAll('[data-wear-look]').forEach(btn => btn.addEventListener('click', async () => {
      const outfit = this.recommendations[Number(btn.dataset.wearLook)];
      const items = [outfit.top, outfit.bottom, outfit.footwear, outfit.outerwear].filter(Boolean);
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i> Saving…`;
      if (window.lucide) lucide.createIcons();
      try {
        await API.logWear(items);
        Toast.success('Enjoy your outfit!', `Logged ${items.length} items as worn today. Tomorrow's picks will rotate in other pieces.`);
        this.generateRecommendations();
      } catch (err) {
        Toast.error('Could not log wear', err.message || 'Please try again.');
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="check-circle"></i> Wear this look today`;
        if (window.lucide) lucide.createIcons();
      }
    }));

    this.recommendations.forEach(outfit => {
      [outfit.top, outfit.bottom, outfit.footwear, outfit.outerwear].filter(Boolean).forEach(item => {
        container.querySelectorAll(`[data-outfit-item-id="${item.id}"]`).forEach(el => {
          el.addEventListener('click', () => Utils.showClothingDetail(item));
        });
      });
    });

    if (window.lucide) lucide.createIcons();
  },

  /** One line saying what the engine took into account. */
  describeContext() {
    const r = this.result || {};
    if (r.engine !== 'smart') {
      return `Basic picker (colour rules + least-worn first) — the smart engine is offline${r.fallbackReason ? ` (${Utils.escapeHTML(r.fallbackReason.replace(/\.+$/, ''))})` : ''}. Start the backend for weather- and calendar-aware outfits.`;
    }
    const w = r.weather || {};
    const parts = [];
    if (Number.isFinite(w.feelsLike)) parts.push(`feels like ${Math.round(w.feelsLike)}°C`);
    if (w.raining || w.rainChance >= 50) parts.push(`rain ${Math.round(w.rainChance || 0)}%`);
    if (Number.isFinite(w.windSpeed) && w.windSpeed >= 25) parts.push(`windy ${Math.round(w.windSpeed)} km/h`);
    const ev = r.event ? `${Utils.capitalize(r.event)} dress code` : '';
    const cal = this.calendar && this.calendar.title && this.selectedEvent() === 'auto' ? ` from "${Utils.escapeHTML(this.calendar.title)}"` : '';
    const season = r.season ? `${r.season}${r.seasonFiltered ? ' items' : ''}` : '';
    return [parts.join(', '), ev + cal, season, 'least-worn pieces first'].filter(Boolean).join(' · ');
  },

  async renderWeatherBar() {
    const bar = document.getElementById('outfit-weather-bar');
    if (!bar) return;

    // Date & time
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    // Fetch weather from Open-Meteo (free, no key needed)
    let weatherHTML = '';
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${this.latitude}&longitude=${this.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&wind_speed_unit=kmh`;
      const res = await fetch(url);
      const wx = await res.json();
      const c = wx.current;
      const temp = Math.round(c.temperature_2m);
      const hum  = c.relative_humidity_2m;
      const wind = Math.round(c.wind_speed_10m);
      const code = c.weather_code;

      const desc = this._wxDesc(code);
      const icon = this._wxIcon(code);

      weatherHTML = `
        <div class="wx-bar-item"><i data-lucide="${icon}" style="width:18px;height:18px;color:var(--color-olive);"></i> <strong>${temp}°C</strong> <span>${desc}</span></div>
        <div class="wx-bar-sep"></div>
        <div class="wx-bar-item"><i data-lucide="droplets" style="width:16px;height:16px;color:var(--color-sky);"></i> ${hum}% Humidity</div>
        <div class="wx-bar-sep"></div>
        <div class="wx-bar-item"><i data-lucide="wind" style="width:16px;height:16px;color:var(--color-slate);"></i> ${wind} km/h</div>`;
    } catch {
      weatherHTML = `<div class="wx-bar-item"><i data-lucide="cloud-off" style="width:16px;height:16px;"></i> Weather unavailable</div>`;
    }

    bar.style.display = '';
    bar.innerHTML = `
      <div class="wx-bar-left">
        <i data-lucide="calendar" style="width:16px;height:16px;color:var(--color-olive);"></i>
        <span><strong>${dateStr}</strong></span>
        <div class="wx-bar-sep"></div>
        <i data-lucide="clock" style="width:16px;height:16px;color:var(--color-slate);"></i>
        <span>${timeStr}</span>
      </div>
      <div class="wx-bar-right">${weatherHTML}</div>`;

    if (window.lucide) lucide.createIcons();
  },

  _wxDesc(code) {
    if (code === 0) return 'Clear Sky';
    if (code <= 3) return 'Partly Cloudy';
    if (code <= 48) return 'Foggy';
    if (code <= 67) return 'Rainy';
    if (code <= 77) return 'Snowy';
    if (code <= 82) return 'Showers';
    return 'Thunderstorm';
  },

  _wxIcon(code) {
    if (code === 0) return 'sun';
    if (code <= 3) return 'cloud-sun';
    if (code <= 48) return 'cloud-fog';
    if (code <= 67) return 'cloud-rain';
    if (code <= 77) return 'cloud-snow';
    if (code <= 82) return 'cloud-drizzle';
    return 'cloud-lightning';
  },

  renderOutfitCard(outfit, index) {
    const items = [
      { label: 'Top',       item: outfit.top },
      { label: 'Bottom',    item: outfit.bottom },
      ...(outfit.footwear ? [{ label: 'Footwear', item: outfit.footwear }] : []),
      ...(outfit.outerwear ? [{ label: 'Outerwear', item: outfit.outerwear }] : []),
    ];
    const totalCost   = items.reduce((s, i) => s + (i.item.price || 0), 0);
    const hasOuterwear = !!outfit.outerwear;

    return `
      <div class="card outfit-card animate-fade-in-up" style="animation-delay:${index * 100}ms">
        <div class="outfit-card-header">
          <span class="outfit-card-number">Look #${index + 1}</span>
          <span class="badge badge-neutral">
            <i data-lucide="rotate-ccw" style="width:12px;height:12px;margin-right:4px;"></i>
            ${Number.isFinite(Number(outfit.totalWearCount)) ? Number(outfit.totalWearCount) : 0} total wears
          </span>
          ${Number.isFinite(Number(outfit.score)) && outfit.score !== null
            ? `<span class="badge badge-neutral">${Number(outfit.score).toFixed(1)} match score</span>`
            : ''}
        </div>
        <div class="outfit-items-grid">
          ${items.map(({ label, item }) => this.renderOutfitItemSlot(label, item)).join('')}
        </div>
        <div class="outfit-card-footer">
          <span class="badge badge-olive">
            <i data-lucide="indian-rupee" style="width:12px;height:12px;margin-right:2px;"></i>
            Total value: ${this.formatINR(totalCost)}
          </span>
          <span class="badge ${hasOuterwear ? 'badge-sky' : 'badge-amber'}">
            <i data-lucide="${hasOuterwear ? 'layers' : 'sun'}" style="width:12px;height:12px;margin-right:4px;"></i>
            ${hasOuterwear ? 'Layered for the weather' : 'No layer needed'}
          </span>
          <span class="badge badge-neutral">
            <i data-lucide="check" style="width:12px;height:12px;margin-right:4px;"></i>
            Color Balanced
          </span>
        </div>
        ${outfit.reason ? `<p class="outfit-reason"><i data-lucide="sparkles"></i> ${Utils.escapeHTML(outfit.reason)}</p>` : ''}
        <div class="outfit-card-actions">
          <button type="button" class="btn btn-primary btn-sm" data-wear-look="${index}">
            <i data-lucide="check-circle"></i> Wear this look today
          </button>
        </div>
      </div>`;
  },

  renderOutfitItemSlot(label, item) {
    const img = item.imageUrl && item.imageUrl.startsWith('http')
      ? `<img src="${Utils.escapeHTML(item.imageUrl)}" alt="${Utils.escapeHTML(item.type)}" />`
      : `<i data-lucide="shirt"></i>`;
    return `
      <div class="outfit-item card-clickable" data-outfit-item-id="${item.id}">
        <div class="outfit-item-image">${img}</div>
        <div class="outfit-item-info">
          <div class="outfit-item-category">${label}</div>
          <div class="outfit-item-name">${Utils.escapeHTML(item.type)}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
            ${Utils.colorDots(item.color)}
            <span style="font-size:11px;color:var(--text-muted);">${Utils.escapeHTML(Utils.formatList(item.color, ' / '))}</span>
          </div>
        </div>
      </div>`;
  },
};

window.OutfitsPage = OutfitsPage;