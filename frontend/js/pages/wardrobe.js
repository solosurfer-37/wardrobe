/* ═══════════════════════════════════════════════════════
   AI Wardrobe — Wardrobe Catalog Page
   ═══════════════════════════════════════════════════════ */

const WardrobePage = {
  items: [],
  activeCategory: 'all',
  selectedColor: 'all',
  searchTerm: '',
  sortBy: 'least-worn',

  init() {
    const container = document.getElementById('page-container');
    // If static HTML isn't already present in container, render it
    if (container && !document.getElementById('wardrobe-items-grid')) {
      this.render(container);
      return;
    }

    if (window.lucide) {
      lucide.createIcons();
    }

    this.bindEvents();
    this.fetchItems();
  },

  async render(container) {
    container.innerHTML = `
      <div class="wardrobe-page animate-fade-in">
        <!-- Top Toolbar & Controls -->
        <div class="wardrobe-toolbar">
          <div class="search-container">
            <i data-lucide="search" class="search-icon"></i>
            <input 
              type="text" 
              id="wardrobe-search-input" 
              class="search-input" 
              placeholder="Search by type, color, or pattern..." 
              value="${Utils.escapeHTML(this.searchTerm)}"
            />
          </div>

          <div class="filter-bar">
            <button class="filter-pill ${this.activeCategory === 'all' ? 'active' : ''}" data-category="all">All</button>
            <button class="filter-pill ${this.activeCategory === 'tops' ? 'active' : ''}" data-category="tops">Tops</button>
            <button class="filter-pill ${this.activeCategory === 'bottoms' ? 'active' : ''}" data-category="bottoms">Bottoms</button>
            <button class="filter-pill ${this.activeCategory === 'outerwear' ? 'active' : ''}" data-category="outerwear">Outerwear</button>
            <button class="filter-pill ${this.activeCategory === 'footwear' ? 'active' : ''}" data-category="footwear">Footwear</button>
          </div>

          <div style="display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap;">
            <select id="wardrobe-color-filter" class="select-input" style="height: 40px; padding: 0 var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--border-medium); background: var(--bg-card); font-size: var(--text-sm);">
              <option value="all">All Colors</option>
              ${CONFIG.COLORS.map(c => `<option value="${c}" ${this.selectedColor === c ? 'selected' : ''}>${Utils.capitalize(c)}</option>`).join('')}
            </select>

            <select id="wardrobe-sort" class="select-input" style="height: 40px; padding: 0 var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--border-medium); background: var(--bg-card); font-size: var(--text-sm);">
              <option value="least-worn" ${this.sortBy === 'least-worn' ? 'selected' : ''}>Least Worn First</option>
              <option value="most-worn" ${this.sortBy === 'most-worn' ? 'selected' : ''}>Most Worn First</option>
              <option value="type-asc" ${this.sortBy === 'type-asc' ? 'selected' : ''}>Type (A - Z)</option>
              <option value="price-desc" ${this.sortBy === 'price-desc' ? 'selected' : ''}>Price: High to Low</option>
              <option value="price-asc" ${this.sortBy === 'price-asc' ? 'selected' : ''}>Price: Low to High</option>
            </select>

            <button class="btn btn-primary" id="btn-open-add-clothing" style="height: 40px;">
              <i data-lucide="plus"></i>
              Add Item
            </button>
          </div>
        </div>

        <div class="wardrobe-count" id="wardrobe-items-count">Loading items...</div>

        <!-- Clothing Grid -->
        <div class="wardrobe-grid" id="wardrobe-items-grid">
          ${Utils.skeletonCards(8, 'clothing-card skeleton')}
        </div>
      </div>
    `;

    if (window.lucide) lucide.createIcons();

    this.bindEvents();
    await this.fetchItems();
  },

  bindEvents() {
    // Add Item button
    const addBtn = document.getElementById('btn-open-add-clothing');
    if (addBtn && !addBtn._hasHandler) {
      addBtn._hasHandler = true;
      addBtn.addEventListener('click', () => {
        if (typeof App !== 'undefined' && typeof App.openAddClothing === 'function') { App.openAddClothing(); return; }
        const modal = document.getElementById('add-clothing-modal');
        if (modal) modal.classList.add('active');
      });
    }

    // Category filter pills
    const pills = document.querySelectorAll('.wardrobe-toolbar .filter-pill');
    pills.forEach(pill => {
      if (!pill._hasHandler) {
        pill._hasHandler = true;
        pill.addEventListener('click', (e) => {
          pills.forEach(p => p.classList.remove('active'));
          e.currentTarget.classList.add('active');
          this.activeCategory = e.currentTarget.getAttribute('data-category');
          this.renderFilteredItems();
        });
      }
    });

    // Color filter select
    const colorSelect = document.getElementById('wardrobe-color-filter');
    if (colorSelect && !colorSelect._hasHandler) {
      colorSelect._hasHandler = true;
      colorSelect.addEventListener('change', (e) => {
        this.selectedColor = e.target.value;
        this.renderFilteredItems();
      });
    }

    // Sort select
    const sortSelect = document.getElementById('wardrobe-sort');
    if (sortSelect && !sortSelect._hasHandler) {
      sortSelect._hasHandler = true;
      sortSelect.addEventListener('change', (e) => {
        this.sortBy = e.target.value;
        this.renderFilteredItems();
      });
    }

    // Search input with debounce
    const searchInput = document.getElementById('wardrobe-search-input');
    if (searchInput && !searchInput._hasHandler) {
      searchInput._hasHandler = true;
      searchInput.addEventListener('input', Utils.debounce((e) => {
        this.searchTerm = e.target.value.toLowerCase().trim();
        this.renderFilteredItems();
      }, 200));
    }
  },

  async fetchItems() {
    try {
      this.items = await API.getAllClothes() || [];
      this.renderFilteredItems();
    } catch (err) {
      console.error('Failed to load wardrobe:', err);
      const grid = document.getElementById('wardrobe-items-grid');
      if (grid) {
        grid.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1;">
            <i data-lucide="alert-triangle" class="empty-icon" style="color: var(--color-error);"></i>
            <h4>Could not load wardrobe</h4>
            <p>${Utils.escapeHTML(err.message)}</p>
            <button class="btn btn-outline btn-sm" id="btn-retry-wardrobe" style="margin-top: var(--space-4);">
              <i data-lucide="rotate-cw"></i> Retry
            </button>
          </div>
        `;
        const retryBtn = document.getElementById('btn-retry-wardrobe');
        if (retryBtn) {
          retryBtn.addEventListener('click', () => WardrobePage.fetchItems());
        }
        if (window.lucide) lucide.createIcons();
      }
    }
  },

  renderFilteredItems() {
    const grid = document.getElementById('wardrobe-items-grid');
    const countEl = document.getElementById('wardrobe-items-count');
    if (!grid) return;

    let filtered = [...this.items];

    // Filter by Category
    if (this.activeCategory !== 'all') {
      const allowed = CONFIG.CATEGORIES[this.activeCategory] || [];
      filtered = filtered.filter(item => allowed.includes((item.type || '').toLowerCase()));
    }

    // Filter by Color
    if (this.selectedColor !== 'all') {
      filtered = filtered.filter(item => (item.color || '').toLowerCase() === this.selectedColor.toLowerCase());
    }

    // Filter by Search Query
    if (this.searchTerm) {
      filtered = filtered.filter(item => {
        const type = (item.type || '').toLowerCase();
        const color = (item.color || '').toLowerCase();
        const pattern = (item.pattern || '').toLowerCase();
        return type.includes(this.searchTerm) || color.includes(this.searchTerm) || pattern.includes(this.searchTerm);
      });
    }

    // Sorting
    filtered.sort((a, b) => {
      switch (this.sortBy) {
        case 'least-worn':
          return (a.wearCount || 0) - (b.wearCount || 0);
        case 'most-worn':
          return (b.wearCount || 0) - (a.wearCount || 0);
        case 'type-asc':
          return (a.type || '').localeCompare(b.type || '');
        case 'price-desc':
          return (b.price || 0) - (a.price || 0);
        case 'price-asc':
          return (a.price || 0) - (b.price || 0);
        default:
          return 0;
      }
    });

    if (countEl) {
      countEl.textContent = `Showing ${filtered.length} of ${this.items.length} items`;
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <i data-lucide="package-search" class="empty-icon"></i>
          <h4>No clothing items found</h4>
          <p>Try adjusting your search filters or add a new piece to your collection.</p>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    grid.innerHTML = '';
    filtered.forEach(item => {
      const card = Utils.createClothingCard(item, (clickedItem) => {
        Utils.showClothingDetail(clickedItem);
      });
      grid.appendChild(card);
    });

    if (window.lucide) lucide.createIcons();
  },
};
window.WardrobePage = WardrobePage;