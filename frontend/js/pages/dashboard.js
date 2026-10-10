/* ═══════════════════════════════════════════════════════
   AI Wardrobe — Dashboard Page
   ═══════════════════════════════════════════════════════ */

const DashboardPage = {
  init() {
    const container = document.getElementById('page-container');
    // If static HTML isn't already present in container, render it
    if (container && !document.getElementById('dashboard-stats-grid')) {
      this.render(container);
      return;
    }

    if (window.lucide) {
      lucide.createIcons();
    }

    // Load data from backend API
    this.loadDashboardData();
  },

  async render(container) {
    container.innerHTML = `
      <div class="dashboard-page animate-fade-in">
        <!-- Hero Banner -->
        <section class="dashboard-welcome">
          <div class="welcome-content">
            <span class="welcome-eyebrow">Smart Wardrobe Intelligence</span>
            <h1 class="welcome-title">Curated Style, Smarter Rotation</h1>
            <p class="welcome-subtitle">
              Maximize your closet's potential with AI-driven weather styling, rotation tracking, and cost-per-wear analytics.
            </p>
            <div class="welcome-actions">
              <a href="outfits.html" class="btn btn-generate">
                <i data-lucide="sparkles"></i>
                Generate Today's Outfit
              </a>
              <a href="wardrobe.html" class="btn btn-wardrobe-link">
                <i data-lucide="shirt"></i>
                View Wardrobe
              </a>
            </div>
          </div>
        </section>

        <!-- Stats Grid (Loading Skeleton) -->
        <div class="dashboard-stats" id="dashboard-stats-grid">
          ${Utils.skeletonCards(4, 'skeleton-card')}
        </div>

        <!-- Two-Column Sections -->
        <div class="dashboard-sections">
          <!-- Underutilized Items -->
          <div class="card dashboard-section-card">
            <div class="section-header">
              <div>
                <h3 class="section-title">Underutilized Pieces</h3>
                <p class="section-subtitle">Items ready for more wear in your rotation</p>
              </div>
              <a href="wardrobe.html" class="btn btn-ghost btn-sm">View All</a>
            </div>
            <div id="dashboard-least-worn-list">
              <div class="skeleton" style="height: 180px; border-radius: var(--radius-md);"></div>
            </div>
          </div>

          <!-- Schedule & Smart Context -->
          <div class="card dashboard-section-card">
            <div class="section-header">
              <div>
                <h3 class="section-title">Today's Schedule & Climate</h3>
                <p class="section-subtitle">Context-aware styling recommendations</p>
              </div>
            </div>
            <div id="dashboard-context-content">
              <div class="skeleton" style="height: 180px; border-radius: var(--radius-md);"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    if (window.lucide) lucide.createIcons();

    // Fetch data asynchronously
    this.loadDashboardData();
  },

  async loadDashboardData() {
    try {
      const [stats, leastWorn, calendar] = await Promise.allSettled([
        API.getWardrobeStats(),
        API.getLeastWornItems(),
        API.getCalendarEvents(),
      ]);

      const statsData = stats.status === 'fulfilled' ? stats.value : null;
      const leastWornData = leastWorn.status === 'fulfilled' ? leastWorn.value : [];
      const calendarData = calendar.status === 'fulfilled' ? calendar.value : null;

      this.renderStats(statsData, leastWornData);
      this.renderLeastWorn(leastWornData);
      this.renderContext(calendarData);
<<<<<<< HEAD
      // "Your Closet, In Numbers" from the same real items (getLeastWornItems returns every item)
      if (window.WardrobeStories) WardrobeStories.update(leastWorn.status === 'fulfilled' ? leastWornData : []);
=======
      if (window.WardrobeStories) WardrobeStories.refresh();
>>>>>>> 5e49c00 (basics)
    } catch (err) {
      console.error('Error loading dashboard:', err);
      Toast.error('Load Error', 'Unable to retrieve all dashboard metrics from the server.');
    }
  },

  renderStats(stats, items) {
    const grid = document.getElementById('dashboard-stats-grid');
    if (!grid) return;

    const totalItems = stats ? stats.totalItems : (items ? items.length : 0);
    const utilizationRate = stats ? `${Math.round(stats.utilizationRate)}%` : '—';
    const hasWears = Array.isArray(items) && items.some(i => (Number(i.wearCount) || 0) > 0);
    const avgCpw = stats && hasWears && stats.averageCostPerWear != null
      ? '₹' + Number(stats.averageCostPerWear).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
    const underutilizedCount = items ? items.filter(i => (i.wearCount || 0) <= 2).length : 0;

    grid.innerHTML = `
      <div class="card stat-card">
        <div class="stat-icon olive">
          <i data-lucide="shirt"></i>
        </div>
        <div class="stat-content">
          <div class="stat-label">Total Wardrobe</div>
          <div class="stat-value">${totalItems}</div>
          <div class="stat-meta">Clothing pieces logged</div>
        </div>
      </div>

      <div class="card stat-card">
        <div class="stat-icon amber">
          <i data-lucide="percent"></i>
        </div>
        <div class="stat-content">
          <div class="stat-label">Utilization Rate</div>
          <div class="stat-value">${utilizationRate}</div>
          <div class="stat-meta">Active pieces worn</div>
        </div>
      </div>

      <div class="card stat-card">
        <div class="stat-icon sky">
          <i data-lucide="indian-rupee"></i>
        </div>
        <div class="stat-content">
          <div class="stat-label">Avg. Cost / Wear</div>
          <div class="stat-value">${avgCpw}</div>
          <div class="stat-meta">Investment efficiency</div>
        </div>
      </div>

      <div class="card stat-card">
        <div class="stat-icon rose">
          <i data-lucide="rotate-ccw"></i>
        </div>
        <div class="stat-content">
          <div class="stat-label">Low Rotation</div>
          <div class="stat-value">${underutilizedCount}</div>
          <div class="stat-meta">Worn 2 times or fewer</div>
        </div>
      </div>
    `;

    if (window.lucide) lucide.createIcons();
  },

  renderLeastWorn(items) {
    const listContainer = document.getElementById('dashboard-least-worn-list');
    if (!listContainer) return;

    if (!items || items.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state" style="padding: var(--space-6) 0;">
          <i data-lucide="inbox" class="empty-icon"></i>
          <h4>No items recorded</h4>
          <p>Add clothing pieces to start tracking wear frequency.</p>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    const topItems = items.slice(0, 4);
    listContainer.innerHTML = topItems.map(item => {
      const img = item.imageUrl && item.imageUrl.startsWith('http')
        ? `<img src="${Utils.escapeHTML(item.imageUrl)}" alt="${Utils.escapeHTML(item.type)}" />`
        : `<i data-lucide="shirt"></i>`;

      return `
        <div class="item-row card-clickable" data-item-id="${item.id}">
          <div class="item-row-icon">${img}</div>
          <div class="item-row-info">
            <div class="item-row-name">${Utils.escapeHTML(item.type)}</div>
            <div class="item-row-detail">${Utils.escapeHTML(Utils.formatList(item.color, ' / '))} • ${item.pattern || 'Solid'}</div>
          </div>
          <div class="item-row-badge">
            <span class="badge ${item.wearCount === 0 ? 'badge-rose' : 'badge-neutral'}">
              ${item.wearCount || 0} wears
            </span>
          </div>
        </div>
      `;
    }).join('');

    // Attach click listeners for item modal
    topItems.forEach(item => {
      const row = listContainer.querySelector(`[data-item-id="${item.id}"]`);
      if (row) {
        row.addEventListener('click', () => Utils.showClothingDetail(item));
      }
    });

    if (window.lucide) lucide.createIcons();
  },

  renderContext(calendar) {
    const contextContainer = document.getElementById('dashboard-context-content');
    if (!contextContainer) return;

    const eventTitle = calendar ? calendar.title || 'General Activity' : 'No meetings scheduled';
    const eventCategory = calendar ? calendar.category || 'Casual' : 'Casual Day';
    const dressCode = calendar ? calendar.dressCode || 'Smart Casual' : 'Smart Casual';
    const eventTime = calendar ? calendar.time || 'All Day' : 'Today';

    contextContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: var(--space-4);">
        <div style="background: var(--bg-secondary); border-radius: var(--radius-lg); padding: var(--space-4); display: flex; align-items: center; gap: var(--space-4);">
          <div style="width: 44px; height: 44px; border-radius: var(--radius-md); background: var(--color-sky-light); color: var(--color-sky); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <i data-lucide="cloud-sun"></i>
          </div>
          <div>
            <div style="font-weight: var(--weight-semibold); font-size: var(--text-sm); color: var(--text-primary);">Weather-Sensitive Algorithm</div>
            <div style="font-size: var(--text-xs); color: var(--text-muted);">Outerwear layers are dynamically recommended when temperature falls below 15°C.</div>
          </div>
        </div>

        <div style="background: var(--bg-secondary); border-radius: var(--radius-lg); padding: var(--space-4); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: var(--space-3);">
            <div style="width: 44px; height: 44px; border-radius: var(--radius-md); background: var(--color-olive-bg); color: var(--color-olive); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <i data-lucide="calendar"></i>
            </div>
            <div>
              <div style="font-weight: var(--weight-semibold); font-size: var(--text-sm); color: var(--text-primary);">${Utils.escapeHTML(eventTitle)}</div>
              <div style="font-size: var(--text-xs); color: var(--text-muted);">${Utils.escapeHTML(eventCategory)} • ${Utils.escapeHTML(eventTime)}</div>
            </div>
          </div>
          <span class="badge badge-amber">${Utils.escapeHTML(dressCode)}</span>
        </div>

        <div style="padding-top: var(--space-2); text-align: center;">
          <a href="outfits.html" class="btn btn-outline btn-sm" style="width: 100%;">
            <i data-lucide="sparkles"></i>
            Run Outfit Recommendation Engine
          </a>
        </div>
      </div>
    `;

    if (window.lucide) lucide.createIcons();
  },
};
window.DashboardPage = DashboardPage;