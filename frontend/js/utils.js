/* ═══════════════════════════════════════════════════════
   AI Wardrobe — Utility Functions
   ═══════════════════════════════════════════════════════ */

const Utils = {
  /**
   * Get the category group for a clothing type.
   */
  getCategoryGroup(type) {
    const t = (type || '').toLowerCase().trim();
    for (const [group, types] of Object.entries(CONFIG.CATEGORIES)) {
      if (types.includes(t)) return group;
    }
    return 'other';
  },

  /**
   * Get a friendly category label.
   */
  getCategoryLabel(type) {
    const group = this.getCategoryGroup(type);
    return group.charAt(0).toUpperCase() + group.slice(1);
  },

  /**
   * Get CSS background color for a color name.
   */
  getColorCSS(colorName) {
    const first = this.splitList(colorName)[0] || '';
    return CONFIG.COLOR_MAP[first] || '#D4C9B8';
  },

  /** "Navy, white" -> ['navy', 'white']. Colour, occasion and season are comma-separated lists. */
  splitList(value) {
    const out = [];
    String(value || '').split(',').forEach(p => {
      const v = p.trim().toLowerCase();
      if (v && !out.includes(v)) out.push(v);
    });
    return out;
  },

  /** "navy,white" -> "Navy, White" (or with a custom separator). */
  formatList(value, sep = ', ') {
    return this.splitList(value).map(v => this.capitalize(v)).join(sep);
  },

  /** One colour dot per colour of the item. */
  colorDots(value) {
    const cols = this.splitList(value);
    if (!cols.length) return `<span class="color-dot" style="background:#D4C9B8"></span>`;
    return `<span class="color-dots">${cols.map(c =>
      `<span class="color-dot" style="background:${CONFIG.COLOR_MAP[c] || '#D4C9B8'}"></span>`).join('')}</span>`;
  },

  /**
   * Capitalize first letter.
   */
  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  },

  /**
   * Format a price value.
   */
  formatPrice(price) {
    if (price == null || price === 0) return '—';
    return '$' + Number(price).toFixed(2);
  },

  /**
   * Format a date string for display.
   */
  formatDate(dateStr) {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Never';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  },

  /**
   * Time-ago relative string.
   */
  timeAgo(dateStr) {
    if (!dateStr) return 'Never worn';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Never worn';
    const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`;
    if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''} ago`;
    return `${Math.floor(days / 365)} year${Math.floor(days / 365) > 1 ? 's' : ''} ago`;
  },

  /**
   * Create a clothing card element.
   */
  createClothingCard(item, onClick) {
    const card = document.createElement('div');
    card.className = 'card clothing-card card-clickable animate-fade-in-up';
    card.setAttribute('data-id', item.id);

    const imageHTML = item.imageUrl && item.imageUrl.startsWith('http')
      ? `<img src="${this.escapeHTML(item.imageUrl)}" alt="${this.escapeHTML(item.type)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'clothing-placeholder-icon\\'><i data-lucide=\\'shirt\\'></i></div>'; lucide.createIcons();" />`
      : `<div class="clothing-placeholder-icon"><i data-lucide="shirt"></i></div>`;

    card.innerHTML = `
      <div class="clothing-card-image">${imageHTML}</div>
      <div class="clothing-card-info">
        <div class="clothing-card-type">${this.escapeHTML(this.capitalize(item.type))}</div>
        <div class="clothing-card-meta">
          <span class="badge badge-neutral">
            ${this.colorDots(item.color)}
            ${this.escapeHTML(this.formatList(item.color, ' / '))}
          </span>
          ${item.pattern ? `<span class="badge badge-neutral">${this.escapeHTML(this.capitalize(item.pattern))}</span>` : ''}
          <span class="badge badge-olive">${item.wearCount || 0} wears</span>
        </div>
      </div>
    `;

    if (onClick) {
      card.addEventListener('click', () => onClick(item));
    }

    return card;
  },

  /**
   * Show the clothing detail modal.
   */
  showClothingDetail(item) {
    const modal = document.getElementById('clothing-detail-modal');
    const title = document.getElementById('detail-title');
    const body = document.getElementById('detail-body');

    title.textContent = this.capitalize(item.type);

    const imageHTML = item.imageUrl && item.imageUrl.startsWith('http')
      ? `<img src="${this.escapeHTML(item.imageUrl)}" alt="${this.escapeHTML(item.type)}" onerror="this.parentElement.innerHTML='<div class=\\'clothing-placeholder-icon\\'><i data-lucide=\\'shirt\\'></i></div>'; lucide.createIcons();" />`
      : `<div class="clothing-placeholder-icon" style="width:64px;height:64px"><i data-lucide="shirt"></i></div>`;

    body.innerHTML = `
      <div class="detail-image-container">${imageHTML}</div>
      <div class="detail-field">
        <span class="detail-field-label">Type</span>
        <span class="detail-field-value">${this.escapeHTML(item.type)}</span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">Category</span>
        <span class="detail-field-value">${this.getCategoryLabel(item.type)}</span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">${this.splitList(item.color).length > 1 ? 'Colors' : 'Color'}</span>
        <span class="detail-field-value" style="display:flex;align-items:center;gap:8px">
          ${this.colorDots(item.color)}
          ${this.escapeHTML(this.formatList(item.color))}
        </span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">Pattern</span>
        <span class="detail-field-value">${this.escapeHTML(item.pattern || '—')}</span>
      </div>
      ${item.season ? `<div class="detail-field">
        <span class="detail-field-label">Season</span>
        <span class="detail-field-value">${this.escapeHTML(String(item.season).split(',').map(s => this.capitalize(s.trim())).join(', '))}</span>
      </div>` : ''}
      ${item.occasion ? `<div class="detail-field">
        <span class="detail-field-label">Occasion</span>
        <span class="detail-field-value">${this.escapeHTML(this.formatList(item.occasion))}</span>
      </div>` : ''}
      ${item.brand ? `<div class="detail-field">
        <span class="detail-field-label">Brand</span>
        <span class="detail-field-value">${this.escapeHTML(item.brand)}</span>
      </div>` : ''}
      ${Number(item.rating) > 0 ? `<div class="detail-field">
        <span class="detail-field-label">Rating</span>
        <span class="detail-field-value">${Number(item.rating)} / 5</span>
      </div>` : ''}
      <div class="detail-field">
        <span class="detail-field-label">Price</span>
        <span class="detail-field-value">${this.formatPrice(item.price)}</span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">Wear Count</span>
        <span class="detail-field-value">${item.wearCount || 0} times</span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">Last Worn</span>
        <span class="detail-field-value">${this.formatDate(item.lastWornDate)}</span>
      </div>
      <div class="detail-wear">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-mark-worn">
          <i data-lucide="check-circle"></i> Mark as worn today
        </button>
      </div>
    `;

    // Logging wears feeds usage-decay (outfit picks), utilization and cost per wear.
    const wornBtn = body.querySelector('#btn-mark-worn');
    if (wornBtn && typeof API !== 'undefined' && API.logWear) {
      wornBtn.addEventListener('click', async () => {
        wornBtn.disabled = true;
        try {
          const [updated] = await API.logWear([item]);
          Toast.success('Logged', `${this.capitalize(item.type)} marked as worn today (${(updated && updated.wearCount) || (Number(item.wearCount) || 0) + 1} wears).`);
          modal.classList.remove('active');
          if (window.WardrobePage && WardrobePage.fetchItems) WardrobePage.fetchItems();
          else if (window.DashboardPage && DashboardPage.loadDashboardData) DashboardPage.loadDashboardData();
          else if (window.AnalyticsPage && AnalyticsPage.loadAnalyticsData) AnalyticsPage.loadAnalyticsData();
          else if (window.OutfitsPage && OutfitsPage.generateRecommendations) OutfitsPage.generateRecommendations();
        } catch (err) {
          wornBtn.disabled = false;
          Toast.error('Could not log wear', err.message || 'Please try again.');
        }
      });
    }

    modal.classList.add('active');
    lucide.createIcons();
  },

  /**
   * Generate skeleton loading cards.
   */
  skeletonCards(count, className = 'skeleton-card') {
    return Array(count).fill(0).map(() => `<div class="skeleton ${className}"></div>`).join('');
  },

  /**
   * Escape HTML to prevent XSS.
   */
  escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * Debounce function.
   */
  debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },
};
