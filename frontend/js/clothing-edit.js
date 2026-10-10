/* Clothing detail modal: Edit mode (type, color, pattern, brand, season, occasion, price, rating) */
(function () {
  if (typeof Utils === 'undefined' || typeof Utils.showClothingDetail !== 'function') {
  console.warn('[clothing-edit] Utils nahi mila. Script order check kar.');
  return;
}
  const orig = Utils.showClothingDetail.bind(Utils);
  const esc = s => Utils.escapeHTML(String(s ?? ''));
  const opts = (list, cur) => list.map(v =>
    `<option value="${v}" ${v === cur ? 'selected' : ''}>${Utils.capitalize(v)}</option>`).join('');

  async function refresh() {
    const page = App.getCurrentPageKey();
    if (page === 'wardrobe' && window.WardrobePage) await WardrobePage.fetchItems();
    else if (page === 'dashboard' && window.DashboardPage) await DashboardPage.loadDashboardData();
    else if (page === 'analytics' && window.AnalyticsPage) await AnalyticsPage.loadAnalyticsData();
  }

  function showForm(item) {
    const body = document.getElementById('detail-body');
    const field = (label, inner) =>
      `<div class="form-group" style="margin-bottom:12px"><label style="font-size:12px">${label}</label>${inner}</div>`;
    const input = (id, val, type = 'text', extra = '') =>
      `<input id="${id}" type="${type}" value="${esc(val)}" ${extra} style="width:100%">`;

    body.innerHTML = `
      ${field('Type', `<select id="edit-type" style="width:100%">${opts(CONFIG.ALL_TYPES, (item.type || '').toLowerCase())}</select>`)}
      ${field('Color', `<select id="edit-color" style="width:100%">${opts(CONFIG.COLORS, (item.color || '').toLowerCase())}</select>`)}
      ${field('Pattern', input('edit-pattern', item.pattern))}
      ${field('Brand', input('edit-brand', item.brand))}
      ${field('Season (comma separated)', input('edit-season', item.season, 'text', 'placeholder="summer, winter"'))}
      ${field('Occasion', input('edit-occasion', item.occasion))}
      ${field('Price', input('edit-price', item.price, 'number', 'min="0" step="0.01"'))}
      ${field('Rating (0-5)', input('edit-rating', item.rating ?? '', 'number', 'min="0" max="5" step="0.5"'))}
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-primary" id="edit-save" type="button">Save changes</button>
        <button class="btn btn-outline" id="edit-cancel" type="button">Cancel</button>
      </div>`;

    document.getElementById('edit-cancel').onclick = () => orig(item) || addButton(item);
    document.getElementById('edit-save').onclick = async (e) => {
      const btn = e.currentTarget;
      const v = id => document.getElementById(id).value.trim();
      const updates = {
        type: v('edit-type'),
        color: v('edit-color'),
        pattern: v('edit-pattern') || 'solid',
        brand: v('edit-brand'),
        season: v('edit-season'),
        occasion: v('edit-occasion'),
        price: Number(v('edit-price')) || 0,
        rating: v('edit-rating') === '' ? null : Number(v('edit-rating')),
      };
      btn.disabled = true; btn.textContent = 'Saving...';
      try {
        await API.updateClothingItem(item.id, updates);
        Toast.success('Updated', 'Clothing details saved.');
        document.getElementById('clothing-detail-modal').classList.remove('active');
        await refresh();
      } catch (err) {
        Toast.error('Update Failed', err.message);
        btn.disabled = false; btn.textContent = 'Save changes';
      }
    };
  }

  function addButton(item) {
    const body = document.getElementById('detail-body');
    if (!body || body.querySelector('#btn-edit-item')) return;
    const b = document.createElement('button');
    b.id = 'btn-edit-item';
    b.className = 'btn btn-outline';
    b.type = 'button';
    b.style.marginTop = '16px';
    b.innerHTML = '<i data-lucide="pencil"></i> Edit details';
    b.onclick = () => showForm(item);
    body.appendChild(b);
    if (window.lucide) lucide.createIcons();
  }

  Utils.showClothingDetail = function (item) {
    orig(item);
    addButton(item);
  };
  console.log('[clothing-edit] ready');
})();