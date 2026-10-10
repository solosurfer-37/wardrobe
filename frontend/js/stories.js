/* "Your Closet, In Numbers" — computed from the logged-in user's real wardrobe.
   DashboardPage.loadDashboardData() calls WardrobeStories.update(items) every time the
   dashboard data loads (page open, item added, wear logged). No demo numbers. */
window.WardrobeStories = (function () {
  const $ = id => document.getElementById(id);
  const DAY = 86400000;

  function count(el, to, fmt) {
    if (!el) return;
    const t0 = performance.now(), dur = 900;
    (function step(t) {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * e);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const ring = (pct) => { const el = $('st-ring'); if (el) el.style.strokeDashoffset = 163.4 * (1 - Math.min(100, Math.max(0, pct)) / 100); };
  const inr = (v, d = 0) => '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

  /**
   * Same definitions as the Analytics page:
   *  - utilization = share of items worn in the last 30 days
   *  - cost per wear = total price ÷ total wears (only once something has been worn)
   *  - idle = items not worn in the last 30 days
   */
  function fromItems(list) {
    const items = Array.isArray(list) ? list : [];
    const n = items.length;
    const cutoff = Date.now() - 30 * DAY;
    const wornRecently = (i) => i.lastWornDate && new Date(i.lastWornDate).getTime() >= cutoff;
    const value = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
    const wears = items.reduce((s, i) => s + (Number(i.wearCount) || 0), 0);
    const active = items.filter(wornRecently).length;
    return { items: n, value, wears, cpw: wears > 0 ? value / wears : null, util: n ? (active / n) * 100 : 0, idle: n - active };
  }

  function render(d) {
    if (!d.items) {
      // Empty wardrobe: honest zeros and a nudge, no made-up numbers
      setText('st-items', '0');
      setText('st-items-text', 'pieces yet — tap + to add your first one.');
      setText('st-value', inr(0));
      setText('st-value-text', 'invested so far. Prices you add show up here.');
      setText('st-cpw', '—');
      setText('st-cpw-text', 'appears once you log your first wear.');
      setText('st-util', '0%');
      setText('st-util-text', 'of your closet worn this month.');
      ring(0);
      return;
    }

    count($('st-items'), d.items, v => Math.round(v));
    setText('st-items-text', d.idle > 0
      ? `piece${d.items === 1 ? '' : 's'}, and ${d.idle} ${d.idle === 1 ? 'is' : 'are'} waiting for their moment.`
      : `piece${d.items === 1 ? '' : 's'}, and every one was worn this month.`);

    count($('st-value'), d.value, v => inr(Math.round(v)));
    setText('st-value-text', d.value > 0 ? 'in how you show up every day.' : 'Add prices to your items to track this.');

    if (d.cpw == null) {
      setText('st-cpw', '—');
      setText('st-cpw-text', 'Log a wear ("Wear this look" or "Mark as worn") to see this.');
    } else {
      count($('st-cpw'), d.cpw, v => inr(v, 2));
      setText('st-cpw-text', d.cpw > 500
        ? 'wear a few favourites more to bring this down.'
        : 'nice, your pieces are earning their keep.');
    }

    count($('st-util'), d.util, v => Math.round(v) + '%');
    setText('st-util-text', d.util >= 70
      ? 'of what you own this month. Great rotation!'
      : 'of what you own this month. Time to explore the rest.');
    ring(d.util);
  }

  function update(items) {
    render(fromItems(items));
  }

<<<<<<< HEAD
  return { render, fromItems, update };
})();
=======
    async function refresh() {
    try {
      render(fromItems(await API.getAllClothes()));
    } catch (e) {
      render(fromItems([])); // login nahi / error: zero dikhao, fake nahi
    }
  }

  document.addEventListener('DOMContentLoaded', refresh);

  return { render, fromItems, refresh };
})();
>>>>>>> 5e49c00 (basics)
