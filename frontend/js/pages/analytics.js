/* ═══════════════════════════════════════════════════════
   AI Wardrobe — Analytics & Insights Page
   ═══════════════════════════════════════════════════════ */

const AnalyticsPage = {
  init() {
    const container = document.getElementById('page-container');
    // If static HTML isn't already present in container, render it
    if (container && !document.getElementById('analytics-stats-grid')) {
      this.render(container);
      return;
    }

    if (window.lucide) {
      lucide.createIcons();
    }

    this.loadAnalyticsData();
  },

  // ₹ with Indian digit grouping (1,25,000). decimals = 0 for totals, 2 for cost-per-wear.
  formatINR(n, decimals = 0) {
    const v = Number(n) || 0;
    return '₹' + v.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  },

  async render(container) {
    container.innerHTML = `
      <div class="analytics-page animate-fade-in">
        <div class="section-header" style="margin-bottom: var(--space-6);">
          <div>
            <h2 class="section-title">Wardrobe Analytics</h2>
            <p class="section-subtitle">Utilization health, cost-per-wear return, and wardrobe rotation statistics</p>
          </div>
        </div>

        <!-- Top Stat Cards -->
        <div class="analytics-stats" id="analytics-stats-grid">
          ${Utils.skeletonCards(4, 'skeleton-card')}
        </div>

        <!-- Main Chart & Meter Sections -->
        <div class="analytics-sections">
          <!-- Circular Utilization Meter -->
          <div class="card analytics-card">
            <div class="section-header">
              <div>
                <h3 class="section-title">Utilization Score</h3>
                <p class="section-subtitle">Percentage of wardrobe active in the last 30 days</p>
              </div>
            </div>
            <div class="utilization-meter" id="analytics-utilization-meter">
              <div class="skeleton" style="width: 160px; height: 160px; border-radius: 50%; margin: 0 auto;"></div>
            </div>
          </div>

          <!-- Category Breakdown Bar Chart -->
          <div class="card analytics-card">
            <div class="section-header">
              <div>
                <h3 class="section-title">Category Distribution</h3>
                <p class="section-subtitle">Balance of tops, bottoms, outerwear, & footwear</p>
              </div>
            </div>
            <div id="analytics-category-chart">
              <div class="skeleton" style="height: 200px; border-radius: var(--radius-md);"></div>
            </div>
          </div>
        </div>

        <!-- Secondary Sections: Most Worn vs Least Worn -->
        <div class="analytics-sections">
          <div class="card analytics-card">
            <div class="section-header">
              <div>
                <h3 class="section-title">Most Worn Staples</h3>
                <p class="section-subtitle">Your highest rotation essentials</p>
              </div>
              <span class="badge badge-olive">High Value</span>
            </div>
            <div id="analytics-most-worn-list">
              <div class="skeleton" style="height: 160px; border-radius: var(--radius-md);"></div>
            </div>
          </div>

          <div class="card analytics-card">
            <div class="section-header">
              <div>
                <h3 class="section-title">Neglected Assets</h3>
                <p class="section-subtitle">Pieces eligible for styling revival or resale</p>
              </div>
              <span class="badge badge-rose">Opportunity</span>
            </div>
            <div id="analytics-least-worn-list">
              <div class="skeleton" style="height: 160px; border-radius: var(--radius-md);"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    if (window.lucide) lucide.createIcons();

    await this.loadAnalyticsData();
  },

  async loadAnalyticsData() {
    try {
      const [statsRes, clothesRes] = await Promise.allSettled([
        API.getWardrobeStats(),
        API.getAllClothes(),
      ]);

      const stats = statsRes.status === 'fulfilled' ? statsRes.value : null;
      const clothes = clothesRes.status === 'fulfilled' ? (clothesRes.value || []) : [];

      this.renderStatCards(stats, clothes);
      this.renderUtilizationMeter(stats);
      this.renderCategoryChart(clothes);
      this.renderItemRankings(stats, clothes);
    } catch (err) {
      console.error('Failed to load analytics:', err);
      Toast.error('Analytics Error', 'Could not load all metrics from the backend.');
    }
  },

  renderStatCards(stats, clothes) {
    const grid = document.getElementById('analytics-stats-grid');
    if (!grid) return;

    const total = stats ? stats.totalItems : clothes.length;
    const rate = stats ? Math.round(stats.utilizationRate) : 0;
    const cpw = stats && stats.averageCostPerWear != null
      ? this.formatINR(stats.averageCostPerWear, 2)
      : this.formatINR(0, 2);
    const totalValue = clothes.reduce((sum, item) => sum + (item.price || 0), 0);

    grid.innerHTML = `
      <div class="card stat-card">
        <div class="stat-icon olive"><i data-lucide="package"></i></div>
        <div class="stat-content">
          <div class="stat-label">Total Pieces</div>
          <div class="stat-value">${total}</div>
          <div class="stat-meta">In your collection</div>
        </div>
      </div>

      <div class="card stat-card">
        <div class="stat-icon amber"><i data-lucide="activity"></i></div>
        <div class="stat-content">
          <div class="stat-label">Utilization Rate</div>
          <div class="stat-value">${rate}%</div>
          <div class="stat-meta">Worn within 30 days</div>
        </div>
      </div>

      <div class="card stat-card">
        <div class="stat-icon sky"><i data-lucide="trending-down"></i></div>
        <div class="stat-content">
          <div class="stat-label">Avg Cost / Wear</div>
          <div class="stat-value">${cpw}</div>
          <div class="stat-meta">Lifetime wardrobe average</div>
        </div>
      </div>

      <div class="card stat-card">
        <div class="stat-icon rose"><i data-lucide="indian-rupee"></i></div>
        <div class="stat-content">
          <div class="stat-label">Wardrobe Value</div>
          <div class="stat-value">${this.formatINR(totalValue)}</div>
          <div class="stat-meta">Total acquisition cost</div>
        </div>
      </div>
    `;

    if (window.lucide) lucide.createIcons();
  },

  renderUtilizationMeter(stats) {
    const container = document.getElementById('analytics-utilization-meter');
    if (!container) return;

    const rate = stats ? Math.min(100, Math.max(0, Math.round(stats.utilizationRate))) : 0;
    const radius = 64;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (rate / 100) * circumference;

    container.innerHTML = `
      <div class="meter-ring">
        <svg viewBox="0 0 160 160">
          <circle class="meter-bg" cx="80" cy="80" r="${radius}"></circle>
          <circle 
            class="meter-fill" 
            cx="80" 
            cy="80" 
            r="${radius}" 
            stroke-dasharray="${circumference}" 
            stroke-dashoffset="${strokeDashoffset}"
          ></circle>
        </svg>
        <div class="meter-text">
          <div class="meter-value">${rate}%</div>
          <div class="meter-label">Utilized</div>
        </div>
      </div>
      <p style="font-size: var(--text-xs); color: var(--text-muted); max-width: 280px; margin: 0 auto;">
        ${rate >= 70 ? 'High efficiency! Your wardrobe rotation is well balanced.' : 'Target >70% active utilization by allowing the outfit generator to prioritize unworn items.'}
      </p>
    `;
  },

  renderCategoryChart(clothes) {
    const container = document.getElementById('analytics-category-chart');
    if (!container) return;

    const counts = { tops: 0, bottoms: 0, outerwear: 0, footwear: 0 };
    clothes.forEach(item => {
      const cat = Utils.getCategoryGroup(item.type);
      if (counts[cat] !== undefined) counts[cat]++;
    });

    const maxCount = Math.max(...Object.values(counts), 1);

    container.innerHTML = `
      <div class="bar-chart">
        ${Object.entries(counts).map(([cat, count]) => {
          const heightPercent = Math.max(8, Math.round((count / maxCount) * 100));
          return `
            <div class="bar-item">
              <span class="bar-value">${count}</span>
              <div class="bar" style="height: ${heightPercent}%;"></div>
              <span class="bar-label">${Utils.capitalize(cat)}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  renderItemRankings(stats, clothes) {
    const mostContainer = document.getElementById('analytics-most-worn-list');
    const leastContainer = document.getElementById('analytics-least-worn-list');

    const mostItems = (stats && stats.mostWorn && stats.mostWorn.length > 0)
      ? stats.mostWorn.slice(0, 3)
      : [...clothes].sort((a, b) => (b.wearCount || 0) - (a.wearCount || 0)).slice(0, 3);

    const leastItems = (stats && stats.leastWorn && stats.leastWorn.length > 0)
      ? stats.leastWorn.slice(0, 3)
      : [...clothes].sort((a, b) => (a.wearCount || 0) - (b.wearCount || 0)).slice(0, 3);

    const renderList = (items, isLeast) => {
      if (!items || items.length === 0) {
        return `<div class="empty-state" style="padding: var(--space-4);"><p>No items to display.</p></div>`;
      }
      return items.map(item => `
        <div class="item-row card-clickable" data-analytics-item-id="${item.id}">
          <div class="item-row-icon">
            ${item.imageUrl && item.imageUrl.startsWith('http') 
              ? `<img src="${Utils.escapeHTML(item.imageUrl)}" alt="${Utils.escapeHTML(item.type)}" />` 
              : `<i data-lucide="shirt"></i>`}
          </div>
          <div class="item-row-info">
            <div class="item-row-name">${Utils.escapeHTML(item.type)}</div>
            <div class="item-row-detail">${Utils.escapeHTML(Utils.formatList(item.color, ' / '))} • Last worn: ${Utils.timeAgo(item.lastWornDate)}</div>
          </div>
          <div class="item-row-badge">
            <span class="badge ${isLeast ? 'badge-rose' : 'badge-olive'}">
              ${item.wearCount || 0} wears
            </span>
          </div>
        </div>
      `).join('');
    };

    if (mostContainer) {
      mostContainer.innerHTML = renderList(mostItems, false);
      mostItems.forEach(item => {
        const el = mostContainer.querySelector(`[data-analytics-item-id="${item.id}"]`);
        if (el) el.addEventListener('click', () => Utils.showClothingDetail(item));
      });
    }

    if (leastContainer) {
      leastContainer.innerHTML = renderList(leastItems, true);
      leastItems.forEach(item => {
        const el = leastContainer.querySelector(`[data-analytics-item-id="${item.id}"]`);
        if (el) el.addEventListener('click', () => Utils.showClothingDetail(item));
      });
    }

    if (window.lucide) lucide.createIcons();
  },
};
window.AnalyticsPage = AnalyticsPage;