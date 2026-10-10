/* ═══════════════════════════════════════════════════════
   AI Wardrobe — Main Application Bootstrap (Multi-Page Architecture)
   ═══════════════════════════════════════════════════════ */

const App = {
  init() {
    Toast.init();

    this.initSidebar();
    this.initModals();
    this.initAddClothingForm();
    this.highlightActiveNav();

    this.initCurrentPage();

    if (window.lucide) {
      lucide.createIcons();
    }
  },

  getCurrentPageKey() {
    if (document.body && document.body.dataset && document.body.dataset.page) {
      return document.body.dataset.page;
    }
    const path = window.location.pathname.toLowerCase();
    if (path.endsWith('wardrobe.html')) return 'wardrobe';
    if (path.endsWith('outfits.html')) return 'outfits';
    if (path.endsWith('analytics.html')) return 'analytics';
    if (path.endsWith('settings.html')) return 'settings';
    return 'dashboard';
  },

  highlightActiveNav() {
    const currentPage = this.getCurrentPageKey();
    const navItems = document.querySelectorAll('#sidebar-nav .nav-item');
    navItems.forEach(item => {
      const page = item.getAttribute('data-page');
      if (page === currentPage) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  },

  /**
   * Glass header: scroll state + mobile full-screen menu
   */
  initSidebar() {
    const shell  = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    const close  = document.getElementById('sidebar-close');
    if (!shell || !toggle) return;

    const mq = window.matchMedia('(max-width: 980px)');

    const setMenu = (open) => {
      shell.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    };

    const onScroll = () => shell.classList.toggle('is-scrolled', window.scrollY > 16);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    toggle.addEventListener('click', () => setMenu(!shell.classList.contains('open')));
    if (close) close.addEventListener('click', () => setMenu(false));

    document.querySelectorAll('#sidebar-nav .nav-item').forEach(link =>
      link.addEventListener('click', () => setMenu(false))
    );

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && shell.classList.contains('open')) setMenu(false);
    });

    mq.addEventListener('change', (e) => { if (!e.matches) setMenu(false); });
  },

  /**
   * Global Modals (backdrop clicks and ESC key)
   */
  initModals() {
    const addModal = document.getElementById('add-clothing-modal');
    const detailModal = document.getElementById('clothing-detail-modal');
    const topbarAddBtn = document.getElementById('btn-add-clothing-topbar');
    const closeAddBtn = document.getElementById('modal-close-add');
    const cancelAddBtn = document.getElementById('btn-cancel-add');
    const closeDetailBtn = document.getElementById('modal-close-detail');

    // Open add modal ("+" in the header, or "Add Item" on the wardrobe page):
    // always starts at the Upload Image step
    App.openAddClothing = () => {
      if (!addModal) return;
      if (App.addClothing && App.addClothing.isSaving()) {
        addModal.classList.add('active');   // a save is still running: show it, don't wipe it
        return;
      }
      const form = document.getElementById('add-clothing-form');
      if (form) form.reset();
      addModal.classList.add('active');
    };
    if (topbarAddBtn && addModal) {
      topbarAddBtn.addEventListener('click', () => App.openAddClothing());
    }

    // Close add modal buttons (blocked while a save is in flight, so it can't be duplicated)
    const closeAdd = () => {
      if (!addModal || !addModal.classList.contains('active')) return;
      if (App.addClothing && App.addClothing.isSaving()) {
        Toast.info('Saving…', 'Please wait until the item has been saved.');
        return;
      }
      addModal.classList.remove('active');
    };
    if (closeAddBtn) closeAddBtn.addEventListener('click', closeAdd);
    if (cancelAddBtn) cancelAddBtn.addEventListener('click', closeAdd);

    // Close detail modal
    const closeDetail = () => {
      if (detailModal) detailModal.classList.remove('active');
    };
    if (closeDetailBtn) closeDetailBtn.addEventListener('click', closeDetail);

    // Click outside modal container to close
    if (addModal) {
      addModal.addEventListener('click', (e) => { if (e.target === addModal) closeAdd(); });
    }
    if (detailModal) {
      detailModal.addEventListener('click', (e) => { if (e.target === detailModal) closeDetail(); });
    }

    // ESC key dismisses active modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAdd();
        closeDetail();
      }
    });
  },

  /**
   * Add Clothing flow
   *   1. Upload Image (only Upload + Close are shown)
   *   2. AI recognition (one request) fills Type / Color / Pattern, per garment when the photo
   *      shows a whole outfit; unsure values stay empty and everything stays editable
   *   3. Optional Beautify: one product image per garment (T-shirt, trousers, shoes, ...);
   *      the original photo is always kept
   *   4. The user ticks which image(s) to add; each ticked garment is its own item with its own
   *      details. Season, Occasion, Brand, Rating and Price are entered by the user.
   *   5. Add to Wardrobe: each item is saved through API.addClothingItem (image uploaded first,
   *      rolled back if the insert fails); items already added are never added again
   */
  initAddClothingForm() {
    const form = document.getElementById('add-clothing-form');
    if (!form) return;

    const $ = (id) => document.getElementById(id);
    const submitBtn = $('btn-submit-add');
    const addModal = $('add-clothing-modal');
    const fileInput = $('clothing-image-file');
    const uploadArea = $('clothing-image-upload-area');
    const uploadError = $('clothing-image-error');
    const preparing = $('clothing-image-preparing');
    const stageUpload = $('add-stage-upload');
    const stageDetails = $('add-stage-details');
    const cardsEl = $('add-image-cards');
    const previewImg = $('clothing-image-preview');
    const optionOriginal = $('add-option-original');
    const beautifyBtn = $('btn-beautify');
    const revertBtn = $('btn-revert-original');
    const regenerateBtn = $('btn-regenerate-beautify');
    const replaceBtn = $('btn-replace-clothing-image');
    const removeImageBtn = $('btn-remove-clothing-image');
    const beautifyProgress = $('beautify-progress');
    const beautifyProgressText = $('beautify-progress-text');
    const beautifyNote = $('beautify-note');
    const tabsEl = $('add-item-tabs');
    const analysisStatus = $('ai-analysis-status');
    const typeEl = $('clothing-type');
    const colorEl = $('clothing-color');
    const patternEl = $('clothing-pattern');
    const occasionEl = $('clothing-occasion');
    const ratingEl = $('clothing-rating');
    const brandEl = $('clothing-brand');
    const priceEl = $('clothing-price');
    const imageUrlEl = $('clothing-image');
    const seasonInputs = () => Array.from(form.querySelectorAll('input[name="clothing-season"]'));

    /**
     * Colour and occasion are multi-select chip groups. Each group gets `value` (comma-separated,
     * e.g. "navy,white") and `disabled`, so the rest of the form treats it like a single field.
     */
    const makeMultiField = (groupEl) => {
      if (!groupEl || groupEl.tagName === 'SELECT') return groupEl;
      const boxes = () => Array.from(groupEl.querySelectorAll('input[type="checkbox"]'));
      // Keep the order the user picked in: the first colour is the item's main colour.
      let order = [];
      groupEl.addEventListener('change', (e) => {
        const b = e.target;
        if (!b || b.type !== 'checkbox') return;
        order = order.filter(v => v !== b.value);
        if (b.checked) order.push(b.value);
      });
      Object.defineProperty(groupEl, 'value', {
        configurable: true,
        get: () => {
          const checked = boxes().filter(b => b.checked).map(b => b.value);
          return [...order.filter(v => checked.includes(v)), ...checked.filter(v => !order.includes(v))].join(',');
        },
        set: (v) => {
          const allowed = boxes().map(b => b.value);
          order = String(v || '').toLowerCase().split(',').map(x => x.trim()).filter(x => x && allowed.includes(x));
          boxes().forEach(b => { b.checked = order.includes(b.value); });
        },
      });
      Object.defineProperty(groupEl, 'disabled', {
        configurable: true,
        get: () => boxes().every(b => b.disabled),
        set: (d) => boxes().forEach(b => { b.disabled = !!d; }),
      });
      groupEl.querySelectorAll('.chip-swatch[data-color]').forEach(sw => {
        sw.style.background = Utils.getColorCSS(sw.dataset.color);
      });
      return groupEl;
    };
    makeMultiField(colorEl);
    makeMultiField(occasionEl);

    const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const AI_FIELDS = [
      { key: 'type', aiKey: 'category', el: typeEl, badge: $('ai-badge-type'), label: 'type' },
      { key: 'color', aiKey: 'color', el: colorEl, badge: $('ai-badge-color'), label: 'colour' },
      { key: 'pattern', aiKey: 'pattern', el: patternEl, badge: $('ai-badge-pattern'), label: 'pattern' },
    ];
    const TEXT_FIELDS = { type: typeEl, color: colorEl, pattern: patternEl, occasion: occasionEl,
      rating: ratingEl, brand: brandEl, price: priceEl, imageUrl: imageUrlEl };
    const groupOfType = (t) => (window.ClothingBeautify && ClothingBeautify.TYPE_TO_GROUP[t]) || null;

    /**
     * Shrinks a photo before upload (phone photos are several MB; cards only need ~1280px).
     * Keeps transparency for PNG/WebP, never returns something bigger, and falls back to the
     * original file if the browser cannot decode or re-encode it.
     */
    const compressImage = async (file, maxDim = 1280) => {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        if (scale === 1 && file.size <= 400 * 1024) { if (bitmap.close) bitmap.close(); return file; }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        if (bitmap.close) bitmap.close();
        const keepsAlpha = file.type === 'image/png' || file.type === 'image/webp';
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, keepsAlpha ? 'image/webp' : 'image/jpeg', 0.85));
        if (!blob || blob.size >= file.size) return file;
        const ext = blob.type === 'image/webp' ? 'webp' : (blob.type === 'image/png' ? 'png' : 'jpg');
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.' + ext, { type: blob.type });
      } catch (err) {
        console.warn('Image compression skipped:', err);
        return file;
      }
    };

    // ── State ────────────────────────────────────────────────────────────
    // AI and Beautify results are cached per photo (name+size+date) for the page session, so
    // editing fields, switching items or re-opening the same photo never repeats a request.
    const analysisCache = new Map();
    const extractionCache = new Map();
    const emptyValues = () => ({ type: '', color: '', pattern: '', seasons: [], occasion: '', rating: '', brand: '', price: '', imageUrl: '' });
    const makeItem = (key, label, group, aiGroup) => ({
      key, label, group, aiGroup,
      values: emptyValues(),
      ai: { type: false, color: false, pattern: false },       // filled by AI (badge shown)
      edited: { type: false, color: false, pattern: false },   // changed by the user (AI never overwrites)
      savedId: null,         // added to the wardrobe — never added again
      suggestedType: null,   // type implied by the SAM 3 prompt that found this garment
    });
    const fresh = () => ({
      mode: 'photo',            // 'photo' (garment / outfit photo) or 'receipt' (items read from a receipt)
      receipt: null,            // parsed receipt in receipt mode
      originalFile: null,       // exact file the user picked — never modified
      originalUrl: null,
      fingerprint: null,
      analysis: null,
      extraction: null,         // { garments: [...] } from ClothingBeautify.extractGarments
      items: new Map([['original', makeItem('original', 'Whole photo', null, null)]]),
      selected: ['original'],   // keys of the images the user wants to add
      activeKey: 'original',    // item whose details the form is showing
      analyzing: false,
      beautifying: false,
      saving: false,
      session: 0,               // bumps on reset/replace so late results are ignored
    });
    let state = fresh();
    let sessionCounter = 0;

    const fingerprintOf = (file) => [file.name, file.size, file.lastModified, file.type].join('|');
    const refreshIcons = () => { if (window.lucide) lucide.createIcons(); };
    const activeItem = () => (state.activeKey ? state.items.get(state.activeKey) : null);
    const pendingSelection = () => state.selected.map(k => state.items.get(k)).filter(it => it && it.savedId == null);
    const itemTitle = (it) => (it.values.type && it.values.type.toLowerCase() !== it.label.toLowerCase())
      ? `${it.label} · ${Utils.capitalize(it.values.type)}` : it.label;

    const setStage = (stage) => {
      form.dataset.stage = stage;
      stageUpload.hidden = stage !== 'upload';
      stageDetails.hidden = stage !== 'details';
    };

    const setAnalysis = (stateName, html) => {
      analysisStatus.dataset.state = stateName;
      analysisStatus.innerHTML = html;
      refreshIcons();
    };

    const setNote = (text, tone = '') => { beautifyNote.textContent = text; beautifyNote.dataset.tone = tone; };

    // ── Form <-> active item ─────────────────────────────────────────────
    const loadForm = () => {
      const it = activeItem();
      const v = it ? it.values : emptyValues();
      Object.entries(TEXT_FIELDS).forEach(([k, el]) => { el.value = v[k] || ''; });
      seasonInputs().forEach(i => { i.checked = v.seasons.includes(i.value); });
      AI_FIELDS.forEach(f => { f.badge.hidden = !(it && it.ai[f.key] && !it.edited[f.key]); });
      const disabled = !it || it.savedId != null;
      [...Object.values(TEXT_FIELDS), ...seasonInputs()].forEach(el => { el.disabled = disabled || state.saving; });
      clearFieldErrors();
      refreshAnalysisStatus();
    };

    const storeField = (key) => {
      const it = activeItem();
      if (!it) return;
      if (key === 'seasons') it.values.seasons = seasonInputs().filter(i => i.checked).map(i => i.value);
      else it.values[key] = TEXT_FIELDS[key].value;
    };

    Object.entries(TEXT_FIELDS).forEach(([key, el]) => {
      const onChange = () => {
        storeField(key);
        el.classList.remove('error');
        const ai = AI_FIELDS.find(f => f.key === key);
        const it = activeItem();
        if (ai && it) { it.edited[key] = true; it.ai[key] = false; ai.badge.hidden = true; }
        if (key === 'type') renderTabs();
        if (ai) refreshAnalysisStatus();
      };
      el.addEventListener('input', onChange);
      el.addEventListener('change', onChange);
    });
    seasonInputs().forEach(i => i.addEventListener('change', () => { storeField('seasons'); $('error-season').textContent = ''; }));

    // ── Rendering ────────────────────────────────────────────────────────
    const renderCards = () => {
      cardsEl.querySelectorAll('.add-garment-card').forEach(el => el.remove());
      optionOriginal.hidden = state.mode === 'receipt';
      if (state.mode === 'receipt') { renderReceiptCards(); bindCardInputs(); return; }
      const original = state.items.get('original');
      optionOriginal.classList.toggle('is-selected', state.selected.includes('original'));
      optionOriginal.classList.toggle('is-saved', original.savedId != null);
      optionOriginal.querySelector('input').checked = state.selected.includes('original');

      const garments = state.extraction ? state.extraction.garments : [];
      garments.forEach(g => {
        const key = 'garment:' + (g.key || g.group);
        const it = state.items.get(key);
        let card;
        if (g.status === 'ok') {
          card = document.createElement('label');
          card.className = 'add-image-option add-garment-card';
          card.dataset.key = key;
          card.title = g.note || '';
          const saved = it && it.savedId != null;
          card.classList.toggle('is-selected', state.selected.includes(key));
          card.classList.toggle('is-saved', saved);
          card.innerHTML = `
            <input type="checkbox" class="add-image-select" value="${key}" ${state.selected.includes(key) ? 'checked' : ''} ${saved ? 'disabled' : ''} />
            <img src="${g.url}" alt="Extracted ${Utils.escapeHTML(g.name.toLowerCase())}" />
            <span class="add-image-caption">${Utils.escapeHTML(g.name)}${saved ? ' · Added ✓' : ''}</span>`;
        } else {
          card = document.createElement('div');
          card.className = 'add-image-option add-garment-card is-failed';
          card.dataset.key = key;
          card.innerHTML = `
            <span class="add-image-failed"><i data-lucide="alert-triangle"></i><span>${Utils.escapeHTML(g.reason || 'Could not be isolated reliably.')}</span></span>
            <span class="add-image-caption">${Utils.escapeHTML(g.name)} — not extracted</span>`;
        }
        cardsEl.insertBefore(card, beautifyProgress);
      });
      bindCardInputs();
    };

    const renderTabs = () => {
      const items = state.selected.map(k => state.items.get(k)).filter(Boolean);
      const showTabs = items.length > 1 || (items.length === 1 && items[0].key !== 'original');
      tabsEl.hidden = !showTabs;
      if (!showTabs) { tabsEl.innerHTML = ''; return; }
      tabsEl.innerHTML = items.map(it => `
        <button type="button" role="tab" class="add-item-tab${it.key === state.activeKey ? ' is-active' : ''}${it._invalid ? ' is-invalid' : ''}${it.savedId != null ? ' is-saved' : ''}"
          data-key="${it.key}" aria-selected="${it.key === state.activeKey}">${Utils.escapeHTML(itemTitle(it))}${it.savedId != null ? ' ✓' : ''}</button>`).join('')
        + (items.length > 1 ? `<button type="button" class="link-button add-copy-shared" id="btn-copy-shared">Use this Season &amp; Occasion for all</button>` : '');
      tabsEl.querySelectorAll('.add-item-tab').forEach(btn => btn.addEventListener('click', () => {
        if (state.saving) return;
        state.activeKey = btn.dataset.key;
        loadForm(); renderTabs();
      }));
      const copy = $('btn-copy-shared');
      if (copy) copy.addEventListener('click', () => {
        const src = activeItem();
        if (!src) return;
        items.forEach(it => { if (it.savedId == null) { it.values.seasons = [...src.values.seasons]; it.values.occasion = src.values.occasion; } });
        Toast.info('Copied', 'Season and occasion applied to every selected item.');
      });
    };

    /** Enables/disables every control from the current state. */
    const syncControls = () => {
      const busy = state.saving;
      const n = pendingSelection().length;
      submitBtn.disabled = busy || state.analyzing || state.beautifying;
      beautifyBtn.disabled = busy || state.beautifying;
      regenerateBtn.disabled = busy || state.beautifying;
      revertBtn.disabled = busy || state.beautifying;
      replaceBtn.disabled = busy || state.beautifying;
      removeImageBtn.disabled = busy || state.beautifying;
      uploadArea.disabled = busy;
      const cancel = $('btn-cancel-add');
      if (cancel) cancel.disabled = busy;
      cardsEl.querySelectorAll('.add-image-select').forEach(cb => {
        const it = state.items.get(cb.value);
        cb.disabled = busy || state.beautifying || (it && it.savedId != null);
      });

      const hasExtraction = !!state.extraction;
      const receiptMode = state.mode === 'receipt';
      replaceBtn.hidden = receiptMode;
      removeImageBtn.hidden = false;
      removeImageBtn.textContent = receiptMode ? 'Start over' : 'Remove';
      const receiptFill = document.querySelector('.receipt-fill');
      if (receiptFill) receiptFill.hidden = receiptMode;
      beautifyBtn.hidden = hasExtraction || receiptMode;
      regenerateBtn.hidden = !hasExtraction || receiptMode;
      revertBtn.hidden = !hasExtraction || receiptMode || (state.selected.length === 1 && state.selected[0] === 'original');
      beautifyProgress.hidden = !state.beautifying;

      if (state.beautifying) beautifyBtn.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i> Extracting…`;
      else beautifyBtn.innerHTML = `<i data-lucide="sparkles"></i> Beautify`;
      if (!busy) submitBtn.innerHTML = `<i data-lucide="plus"></i> ${n > 1 ? `Add ${n} items to Wardrobe` : 'Add to Wardrobe'}`;
      refreshIcons();
    };

    const setSubmitLabel = (label) => {
      submitBtn.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i> ${label}`;
      refreshIcons();
    };

    const renderAll = () => { renderCards(); renderTabs(); loadForm(); syncControls(); };

    // ── Selecting images ─────────────────────────────────────────────────
    const select = (key, checked) => {
      const it = state.items.get(key);
      if (!it || it.savedId != null) return;
      let sel = state.selected.filter(k => k !== key);
      if (checked) {
        // The whole photo and individual garments are alternatives: adding both would
        // put the same clothes in the wardrobe twice.
        sel = key === 'original' ? ['original'] : sel.filter(k => k !== 'original').concat(key);
      }
      state.selected = sel;
      if (!state.selected.includes(state.activeKey)) {
        state.activeKey = checked ? key : (pendingSelection()[0] ? pendingSelection()[0].key : null);
      }
      if (checked) state.activeKey = key;
      renderAll();
    };

    function bindCardInputs() {
      cardsEl.querySelectorAll('.add-image-select').forEach(cb => {
        if (cb._bound) return;
        cb._bound = true;
        cb.addEventListener('change', () => select(cb.value, cb.checked));
      });
    }

    // ── Reset ────────────────────────────────────────────────────────────
    const clearFieldErrors = () => {
      ['error-type', 'error-color', 'error-season', 'error-occasion', 'error-price'].forEach(id => {
        const el = $(id); if (el) el.textContent = '';
      });
      form.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
    };

    /** Back to step 1. Cached AI/Beautify results are kept for the page session. */
    const resetAll = () => {
      if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
      state = fresh();
      state.session = ++sessionCounter;
      fileInput.value = '';
      previewImg.removeAttribute('src');
      setNote('');
      uploadError.textContent = '';
      preparing.hidden = true;
      preparing.innerHTML = '<i data-lucide="loader-2" class="animate-spin"></i> Preparing image…';
      uploadArea.hidden = false;
      if (scanReceiptBtn) scanReceiptBtn.hidden = false;
      setAnalysis('idle', '');
      setStage('upload');
      renderAll();
    };

    // ── Step 1: pick & validate the image ────────────────────────────────
    const acceptFile = async (file) => {
      uploadError.textContent = '';
      const extension = (file.name.split('.').pop() || '').toLowerCase();
      if (!allowedTypes.includes(file.type) && !['jpg', 'jpeg', 'png', 'webp'].includes(extension)) {
        uploadError.textContent = 'Choose a JPG, JPEG, PNG, or WEBP image.';
        return false;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        uploadError.textContent = 'Image must be 10 MB or smaller.';
        return false;
      }
      uploadArea.hidden = true;
      preparing.hidden = false;
      try {
        // Make sure the browser can actually decode it before moving on.
        const bitmap = await createImageBitmap(file);
        if (bitmap.close) bitmap.close();
      } catch (err) {
        preparing.hidden = true;
        uploadArea.hidden = false;
        uploadError.textContent = 'This image could not be read. Try a different photo.';
        return false;
      }
      preparing.hidden = true;
      return true;
    };

    const startWithFile = async (file) => {
      if (!(await acceptFile(file))) return;
      if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);

      // A new photo keeps what the user typed for the whole-photo item, but its AI values and any
      // garments from the previous photo are dropped.
      const original = state.items.get('original');
      const keep = original.savedId == null ? original : makeItem('original', 'Whole photo', null, null);
      AI_FIELDS.forEach(f => { if (keep.ai[f.key] && !keep.edited[f.key]) keep.values[f.key] = ''; keep.ai[f.key] = false; });

      state.session = ++sessionCounter;
      state.originalFile = file;
      state.originalUrl = URL.createObjectURL(file);
      state.fingerprint = fingerprintOf(file);
      state.analysis = null;
      state.extraction = null;
      state.items = new Map([['original', keep]]);
      state.selected = ['original'];
      state.activeKey = 'original';
      previewImg.src = state.originalUrl;
      setNote('');

      const cached = extractionCache.get(state.fingerprint);
      if (cached) applyExtraction(cached);
      setStage('details');
      renderAll();
      runAnalysis();
    };

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      startWithFile(file);
    });
    uploadArea.addEventListener('click', () => { if (!state.saving) fileInput.click(); });
    replaceBtn.addEventListener('click', () => fileInput.click());
    removeImageBtn.addEventListener('click', () => {
      const original = state.items.get('original');
      const keepValues = original.savedId == null ? { ...original.values, seasons: [...original.values.seasons] } : null;
      const keepEdited = { ...original.edited };
      resetAll();
      if (keepValues) {   // removing the photo keeps what the user typed
        const it = state.items.get('original');
        it.values = keepValues;
        AI_FIELDS.forEach(f => { it.edited[f.key] = keepEdited[f.key] || !!keepValues[f.key]; });
        loadForm();
      }
    });

    // ── Receipt mode: catalogue items straight from a receipt ───────────
    const scanReceiptBtn = $('btn-scan-receipt');
    const receiptStartInput = document.createElement('input');
    receiptStartInput.type = 'file';
    receiptStartInput.accept = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
    receiptStartInput.hidden = true;
    form.appendChild(receiptStartInput);
    const itemPhotoInput = document.createElement('input');
    itemPhotoInput.type = 'file';
    itemPhotoInput.accept = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
    itemPhotoInput.hidden = true;
    form.appendChild(itemPhotoInput);
    const receiptParseCache = new Map();
    let photoTargetKey = null;

    /** Reads the receipt (one Gemini request per receipt, cached) and switches the form to receipt mode. */
    const startWithReceipt = async (file, { detected = false } = {}) => {
      uploadError.textContent = '';
      if (file.size > MAX_IMAGE_SIZE) { uploadError.textContent = 'Receipt image must be 10 MB or smaller.'; return; }
      setStage('upload');
      uploadArea.hidden = true;
      if (scanReceiptBtn) scanReceiptBtn.hidden = true;
      preparing.hidden = false;
      preparing.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i> ${detected ? 'This looks like a receipt — reading it…' : 'Reading receipt…'}`;
      refreshIcons();
      const session = ++sessionCounter;
      state.session = session;
      let r;
      try {
        const key = fingerprintOf(file);
        r = receiptParseCache.get(key) || await API.parseReceipt(await compressImage(file, 1600));
        receiptParseCache.set(key, r);
      } catch (err) {
        if (session !== state.session) return;
        preparing.hidden = true;
        uploadArea.hidden = false;
        if (scanReceiptBtn) scanReceiptBtn.hidden = false;
        uploadError.textContent = `${err.unavailable ? 'Receipt reading is unavailable' : 'Could not read the receipt'}: ${err.message || ''}`;
        return;
      }
      if (session !== state.session) return;
      preparing.hidden = true;

      if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
      const next = fresh();
      next.session = session;
      next.mode = 'receipt';
      next.receipt = r;
      next.items = new Map();
      const lines = (r.items && r.items.length) ? r.items : [{ name: 'Item', price: r.total, category: null, color: null }];
      lines.forEach((line, i) => {
        const it = makeItem(`receipt:${i}`, (line.name || 'Item').slice(0, 28), null, null);
        if (line.category && Array.from(typeEl.options).some(o => o.value === line.category)) { it.values.type = line.category; it.edited.type = true; }
        if (line.color) { it.values.color = line.color; it.edited.color = true; }
        if (line.price != null) it.values.price = String(line.price);
        if (r.store) it.values.brand = r.store;
        it.file = null; it.photoUrl = null;
        next.items.set(it.key, it);
      });
      next.selected = [...next.items.keys()];
      next.activeKey = next.selected[0];
      state = next;

      const n = next.items.size;
      setNote(`Read from the receipt${r.store ? ` (${r.store}${r.date ? ', ' + r.date : ''})` : ''}: ${n} clothing item${n > 1 ? 's' : ''}. ` +
        'Untick anything you don\'t want to add. A photo is optional — tap "Add photo" on a card.', 'info');
      setAnalysis('done', `<i data-lucide="receipt"></i> Filled from your receipt: brand${lines.some(l => l.price != null) ? ', price' : ''}` +
        `${lines.some(l => l.category) ? ', type' : ''}${lines.some(l => l.color) ? ', colour' : ''} where printed. Please add season and occasion.`);
      setStage('details');
      renderAll();
    };

    function renderReceiptCards() {
      state.items.forEach((it) => {
        const card = document.createElement('label');
        card.className = 'add-image-option add-garment-card add-receipt-card';
        card.dataset.key = it.key;
        const sel = state.selected.includes(it.key), saved = it.savedId != null;
        card.classList.toggle('is-selected', sel);
        card.classList.toggle('is-saved', saved);
        card.innerHTML = `
          <input type="checkbox" class="add-image-select" value="${it.key}" ${sel ? 'checked' : ''} ${saved ? 'disabled' : ''} />
          ${it.photoUrl
            ? `<img src="${it.photoUrl}" alt="${Utils.escapeHTML(it.label)}" />`
            : `<span class="add-image-failed add-receipt-nophoto"><i data-lucide="receipt"></i><span>No photo yet</span></span>`}
          ${saved ? '' : `<button type="button" class="link-button add-item-photo" data-photo-for="${it.key}">${it.photoUrl ? 'Change photo' : 'Add photo'}</button>`}
          <span class="add-image-caption">${Utils.escapeHTML(it.label)}${saved ? ' · Added ✓' : ''}</span>`;
        cardsEl.insertBefore(card, beautifyProgress);
      });
      cardsEl.querySelectorAll('[data-photo-for]').forEach(btn => btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (state.saving) return;
        photoTargetKey = btn.dataset.photoFor;
        itemPhotoInput.click();
      }));
      refreshIcons();
    }

    /** Optional photo for a receipt item; the AI then fills only what the receipt did not say. */
    itemPhotoInput.addEventListener('change', async () => {
      const file = itemPhotoInput.files && itemPhotoInput.files[0];
      itemPhotoInput.value = '';
      const it = state.items.get(photoTargetKey);
      if (!file || !it) return;
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if ((!allowedTypes.includes(file.type) && !['jpg', 'jpeg', 'png', 'webp'].includes(ext)) || file.size > MAX_IMAGE_SIZE) {
        Toast.error('Invalid image', 'Choose a JPG, PNG or WEBP image no larger than 10 MB.');
        return;
      }
      if (it.photoUrl) URL.revokeObjectURL(it.photoUrl);
      it.file = file;
      it.photoUrl = URL.createObjectURL(file);
      state.activeKey = it.key;
      renderAll();
      const session = state.session;
      try {
        const fp = fingerprintOf(file);
        const a = analysisCache.get(fp) || await API.analyzeClothingImage(await compressImage(file, 768));
        analysisCache.set(fp, a);
        if (session !== state.session || a.imageKind === 'receipt') return;
        it.photoAnalysis = a;
        applyAiToItem(it);
        loadForm(); renderTabs();
      } catch (err) {
        console.warn('AI recognition for the item photo failed:', err);
      }
    });

    if (scanReceiptBtn) scanReceiptBtn.addEventListener('click', () => { if (!state.saving) receiptStartInput.click(); });
    receiptStartInput.addEventListener('change', () => {
      const file = receiptStartInput.files && receiptStartInput.files[0];
      receiptStartInput.value = '';
      if (file) startWithReceipt(file);
    });

    // ── Step 2: AI recognition (category, colour, pattern only) ─────────
    /** The AI values that belong to an item: whole photo → main garment; garment → its group. */
    const aiValuesFor = (it) => {
      if (it.photoAnalysis) return it.photoAnalysis;   // photo added to a receipt item
      const a = state.analysis;
      if (!a) return null;
      if (it.key === 'original') return a;
      const g = (a.garments || []).find(x => x.group === it.aiGroup);
      if (!g) return null;
      // Drop a category that contradicts what the segmentation found (e.g. "jeans" for a skirt).
      const category = g.category && groupOfType(g.category) === it.group ? g.category : null;
      return { ...g, category };
    };

    const applyAiToItem = (it) => {
      const v = { ...(aiValuesFor(it) || {}) };
      // A garment SAM 3 found as e.g. "jacket" is a jacket, even if the photo-level AI saw a shirt.
      if (it.suggestedType && Array.from(typeEl.options).some(o => o.value === it.suggestedType)) v.category = it.suggestedType;
      // No AI colour (AI off, or unsure): use the colour measured from the garment's own pixels.
      if (!v.color && it.measuredColor) v.color = it.measuredColor;
      const missing = [];
      AI_FIELDS.forEach(f => {
        const value = v ? v[f.aiKey] : null;
        if (it.edited[f.key] || it.values[f.key]) return;   // never overwrite the user's choice
        const allowed = f.el.tagName === 'SELECT' ? Array.from(f.el.options).map(o => o.value)
          : (f.el.tagName === 'DIV' ? Array.from(f.el.querySelectorAll('input')).map(i => i.value) : null);
        if (!value || (allowed && !allowed.includes(value))) {
          missing.push(f.label);
          return;
        }
        it.values[f.key] = value;
        it.ai[f.key] = true;
      });
      return missing;
    };

    /** Status line for the item being edited (whole photo, or one extracted garment). */
    const describeAnalysis = () => {
      const a = state.analysis;
      const it = activeItem() || state.items.get('original');
      const whose = it.key === 'original' ? '' : ` for the ${Utils.escapeHTML(it.label.toLowerCase())}`;
      const found = AI_FIELDS.filter(f => it.ai[f.key] && !it.edited[f.key]).map(f => Utils.escapeHTML(Utils.formatList(it.values[f.key], ' / ')));
      const missing = AI_FIELDS.filter(f => !it.values[f.key]).map(f => f.label);
      let html = found.length
        ? `<i data-lucide="sparkles"></i> AI detected${whose}: <strong>${found.join(' · ')}</strong>. Check and correct if needed.`
        : `<i data-lucide="info"></i> AI did not fill in the details${whose}.`;
      if (missing.length) html += ` ${found.length ? 'Not sure about' : 'Please choose the'} ${missing.join(' and ')}${found.length ? ` — please choose ${missing.length > 1 ? 'them' : 'it'}.` : ' yourself.'}`;
      const many = (a.garments || []).length > 1;
      if (many && !state.extraction) {
        html += ` <strong>${a.garments.length} garments</strong> are visible — use <em>Beautify</em> to add them as separate items.`;
      }
      return html;
    };
    const refreshAnalysisStatus = () => {
      if (state.analysis && analysisStatus.dataset.state === 'done') setAnalysis('done', describeAnalysis());
    };

    const applyAnalysis = () => {
      state.items.forEach(it => { if (it.savedId == null) applyAiToItem(it); });
      analysisStatus.dataset.state = 'done';
      loadForm(); renderTabs();   // loadForm refreshes the status line
    };

    const runAnalysis = async () => {
      const session = state.session;
      const fp = state.fingerprint;
      if (analysisCache.has(fp) && analysisCache.get(fp).imageKind === 'receipt') {
        startWithReceipt(state.originalFile, { detected: true });
        return;
      }
      if (analysisCache.has(fp)) {
        state.analysis = analysisCache.get(fp);
        applyAnalysis();
        return;
      }
      state.analyzing = true;
      syncControls();
      setAnalysis('loading', `<i data-lucide="loader-2" class="animate-spin"></i> Analysing clothing…`);
      try {
        const small = await compressImage(state.originalFile, 768);
        const result = await API.analyzeClothingImage(small);
        analysisCache.set(fp, result);
        if (session !== state.session) return;
        if (result.imageKind === 'receipt') {
          // Uploaded a receipt through "Upload Image": read it instead of treating it as clothing.
          state.analyzing = false;
          startWithReceipt(state.originalFile, { detected: true });
          return;
        }
        state.analysis = result;
        applyAnalysis();
      } catch (err) {
        if (session !== state.session) return;
        console.warn('AI recognition failed:', err);
        const msg = Utils.escapeHTML(err.message || 'AI recognition failed.');
        setAnalysis(err.unavailable ? 'unavailable' : 'error',
          `<i data-lucide="alert-circle"></i> ${err.unavailable ? 'AI recognition unavailable' : 'AI recognition failed'}: ${msg} ` +
          `Please fill in the details manually.` +
          (err.unavailable ? '' : ` <button type="button" class="link-button" id="btn-retry-analysis">Try again</button>`));
        const retry = $('btn-retry-analysis');
        if (retry) retry.addEventListener('click', () => runAnalysis());
      } finally {
        if (session === state.session) {
          state.analyzing = false;
          syncControls();
        }
      }
    };

    // ── Step 3: Beautify = extract each garment (one image per garment) ──
    /** Creates/updates one item per successfully extracted garment (keeps what the user typed). */
    function applyExtraction(extraction) {
      state.extraction = extraction;
      const okGroups = new Set();
      extraction.garments.forEach(g => {
        if (g.status !== 'ok') return;
        const key = 'garment:' + (g.key || g.group);
        okGroups.add(key);
        let it = state.items.get(key);
        if (!it) {
          it = makeItem(key, g.name, g.group, g.aiGroup);
          it.suggestedType = g.suggestedType || null;
          it.measuredColor = g.measuredColor || null;
          state.items.set(key, it);
          applyAiToItem(it);
        }
        it.file = g.file;
      });
      // A regenerate that no longer finds a garment removes it (unless it was already added).
      Array.from(state.items.keys()).forEach(k => {
        const it = state.items.get(k);
        if (k !== 'original' && !okGroups.has(k) && it.savedId == null) {
          state.items.delete(k);
          state.selected = state.selected.filter(s => s !== k);
        }
      });
      if (!state.selected.includes(state.activeKey)) state.activeKey = state.selected[0] || null;

      const ok = extraction.garments.filter(g => g.status === 'ok');
      const failed = extraction.garments.filter(g => g.status !== 'ok');
      const how = extraction.engine === 'sam3'
        ? 'Outlined with SAM 3'
        : 'Cut out with the on-device clothing model' + (extraction.fallbackReason ? ` (${extraction.fallbackReason})` : '');
      let note = ok.length
        ? `Extracted ${ok.length} garment${ok.length > 1 ? 's' : ''} (${ok.map(g => g.name.toLowerCase()).join(', ')}). ` +
          `Tick the ones to add — each becomes its own wardrobe item. ${how}; pixels are copied unchanged from your photo, and parts hidden by arms, hair or other clothes stay missing.`
        : 'No garment could be isolated reliably, so nothing was extracted. You can still add the original photo.';
      if (failed.length) note += ` Not extracted: ${failed.map(g => g.name.toLowerCase()).join(', ')} (see the cards).`;
      setNote(note, ok.length ? 'info' : 'error');
    }

    const runBeautify = async ({ force = false } = {}) => {
      if (state.beautifying || !state.originalFile) return;
      const fp = state.fingerprint;
      if (!force && extractionCache.has(fp)) {
        applyExtraction(extractionCache.get(fp));
        renderAll();
        return;
      }
      if (typeof ClothingBeautify === 'undefined') {
        setNote('Beautify is not available on this page.', 'error');
        return;
      }

      const session = state.session;
      state.beautifying = true;
      beautifyProgressText.textContent = 'Extracting garments…';
      setNote('');
      syncControls();
      try {
        const result = await ClothingBeautify.extractGarments(state.originalFile, {
          onProgress: (msg) => { if (session === state.session) beautifyProgressText.textContent = msg; },
        });
        const old = extractionCache.get(fp);
        if (old) old.garments.forEach(g => { if (g.url) URL.revokeObjectURL(g.url); });
        const extraction = {
          engine: result.engine, fallbackReason: result.fallbackReason,
          garments: result.garments.map(g => ({ ...g, url: g.blob ? URL.createObjectURL(g.blob) : null })),
        };
        extractionCache.set(fp, extraction);
        if (session !== state.session) return;
        applyExtraction(extraction);
      } catch (err) {
        if (session !== state.session) return;
        console.warn('Beautify failed:', err);
        setNote((err && err.message ? err.message : 'Beautify failed.') + ' Your original photo is unchanged.', 'error');
      } finally {
        if (session === state.session) {
          state.beautifying = false;
          renderAll();
        }
      }
    };

    beautifyBtn.addEventListener('click', () => runBeautify());
    regenerateBtn.addEventListener('click', () => runBeautify({ force: true }));
    revertBtn.addEventListener('click', () => select('original', true));
    bindCardInputs();

    // ── Receipt: fill brand / price (and type / colour if empty) from a receipt photo ──
    const receiptBtn = $('btn-receipt-fill');
    const receiptInput = $('receipt-file');
    const receiptLines = $('receipt-lines');
    const receiptCache = new Map();
    let lastReceipt = null;

    const renderReceipt = (r) => {
      lastReceipt = r;
      if (!r.items || !r.items.length) {
        receiptLines.innerHTML = `<span class="receipt-msg">No clothing lines could be read on this receipt${r.store ? ` from ${Utils.escapeHTML(r.store)}` : ''}.</span>`;
        return;
      }
      const money = (n) => n == null ? '—' : (r.currency && r.currency !== 'INR' ? `${r.currency} ` : '₹') + Number(n).toLocaleString('en-IN');
      receiptLines.innerHTML = `<span class="receipt-msg">${r.store ? `<strong>${Utils.escapeHTML(r.store)}</strong> · ` : ''}Pick the line for this item:</span>` +
        r.items.map((line, i) => `<button type="button" class="chip-option receipt-line" data-line="${i}">${Utils.escapeHTML(line.name)} <strong>${money(line.price)}</strong></button>`).join('');
      receiptLines.querySelectorAll('.receipt-line').forEach(btn => btn.addEventListener('click', () => {
        const it = activeItem();
        if (!it || it.savedId != null) return;
        const line = lastReceipt.items[Number(btn.dataset.line)];
        if (line.price != null) it.values.price = String(line.price);
        if (lastReceipt.store && !it.values.brand) it.values.brand = lastReceipt.store;
        if (line.category && !it.values.type && Array.from(typeEl.options).some(o => o.value === line.category)) { it.values.type = line.category; it.edited.type = true; }
        if (line.color && !it.values.color) { it.values.color = line.color; it.edited.color = true; }
        receiptLines.querySelectorAll('.receipt-line').forEach(b => b.classList.toggle('is-picked', b === btn));
        loadForm(); renderTabs();
      }));
    };

    if (receiptBtn && receiptInput) {
      receiptBtn.addEventListener('click', () => { if (!state.saving) receiptInput.click(); });
      receiptInput.addEventListener('change', async () => {
        const file = receiptInput.files && receiptInput.files[0];
        receiptInput.value = '';
        if (!file) return;
        if (file.size > MAX_IMAGE_SIZE) { receiptLines.innerHTML = '<span class="receipt-msg is-error">Receipt image must be 10 MB or smaller.</span>'; return; }
        const key = fingerprintOf(file);
        if (receiptCache.has(key)) { renderReceipt(receiptCache.get(key)); return; }
        receiptBtn.disabled = true;
        receiptLines.innerHTML = '<span class="receipt-msg"><i data-lucide="loader-2" class="animate-spin"></i> Reading receipt…</span>';
        refreshIcons();
        try {
          const r = await API.parseReceipt(await compressImage(file, 1600));
          receiptCache.set(key, r);
          renderReceipt(r);
        } catch (err) {
          receiptLines.innerHTML = `<span class="receipt-msg is-error">${err.unavailable ? 'Receipt reading is unavailable' : 'Could not read the receipt'}: ${Utils.escapeHTML(err.message || '')} You can type the price and brand instead.</span>`;
        } finally {
          receiptBtn.disabled = false;
          refreshIcons();
        }
      });
      form.addEventListener('reset', () => { receiptLines.innerHTML = ''; lastReceipt = null; });
    }

    // ── Validation ───────────────────────────────────────────────────────
    const showFieldError = (id, el, message) => {
      const span = $(id);
      if (span) span.textContent = message;
      if (el) el.classList.add('error');
    };

    const itemProblems = (it) => {
      const v = it.values, p = [];
      if (!v.type) p.push(['error-type', typeEl, 'Select a type.']);
      if (!v.color) p.push(['error-color', colorEl, 'Select at least one colour.']);
      if (!v.seasons.length) p.push(['error-season', null, 'Select at least one season.']);
      if (!v.occasion) p.push(['error-occasion', occasionEl, 'Select at least one occasion.']);
      const price = String(v.price || '').trim();
      if (price && (!Number.isFinite(Number(price)) || Number(price) < 0)) p.push(['error-price', priceEl, 'Enter a price of 0 or more.']);
      return p;
    };

    // ── Step 5: save ─────────────────────────────────────────────────────
    async function refreshCurrentPage() {
      const currentPage = App.getCurrentPageKey();
      if (currentPage === 'wardrobe' && window.WardrobePage && typeof WardrobePage.fetchItems === 'function') {
        await WardrobePage.fetchItems();
      } else if (currentPage === 'dashboard' && window.DashboardPage && typeof DashboardPage.loadDashboardData === 'function') {
        await DashboardPage.loadDashboardData();
      } else if (currentPage === 'analytics' && window.AnalyticsPage && typeof AnalyticsPage.loadAnalyticsData === 'function') {
        await AnalyticsPage.loadAnalyticsData();
      }
    }

    const toItemData = (v) => {
      const pattern = (v.pattern || '').trim();
      const brand = (v.brand || '').trim();
      const price = String(v.price || '').trim();
      const data = {
        type: v.type,
        color: v.color,
        pattern: pattern || null,
        imageUrl: (v.imageUrl || '').trim(),
        price: price ? Number(price) : 0.0,
        season: v.seasons.join(','),
        occasion: v.occasion,
        brand: brand || null,
        wearCount: 0,
        lastWornDate: null,
      };
      if (v.rating) data.rating = Number(v.rating);
      return data;
    };

    /**
     * Saves one item through the Supabase API: the image is uploaded first and rolled back if the
     * insert fails, so a failure never leaves a half-saved item behind.
     */
    const saveItem = async (it, compressedOriginal) => {
      if (state.mode === 'receipt') {
        const photo = it.file ? await compressImage(it.file) : null;
        const created = await API.addClothingItem(toItemData(it.values), photo, null);
        if (!created || created.id == null) throw new Error('The item could not be saved. Please try again.');
        it.savedId = created.id;
        return;
      }
      const isGarment = it.key !== 'original';
      const finalFile = isGarment ? it.file : compressedOriginal;
      const originalForUpload = isGarment ? compressedOriginal : null;
      const created = await API.addClothingItem(toItemData(it.values), finalFile, originalForUpload);
      if (!created || created.id == null) throw new Error('The item could not be saved. Please try again.');
      it.savedId = created.id;
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.saving || state.analyzing || state.beautifying) return;   // no double submits

      clearFieldErrors();
      state.items.forEach(it => { it._invalid = false; });
      const todo = pendingSelection();
      if (state.mode !== 'receipt' && !state.originalFile) { Toast.error('Missing details', 'Upload an image first.'); return; }
      if (!todo.length) { Toast.error('Nothing selected', 'Tick at least one image to add to your wardrobe.'); return; }

      const invalid = todo.filter(it => itemProblems(it).length);
      if (invalid.length) {
        invalid.forEach(it => { it._invalid = true; });
        state.activeKey = invalid[0].key;
        loadForm();
        itemProblems(invalid[0]).forEach(([id, el, msg]) => showFieldError(id, el, msg));
        renderTabs();
        Toast.error('Missing details', todo.length > 1
          ? `Please complete the highlighted fields for: ${invalid.map(itemTitle).join(', ')}.`
          : 'Please complete the highlighted fields.');
        return;
      }

      state.saving = true;
      loadForm();
      syncControls();
      const session = state.session;
      const added = [];
      try {
        setSubmitLabel('Preparing image…');
        // Extracted garment PNGs are uploaded as-is; the original is compressed like before.
        const compressedOriginal = state.originalFile ? await compressImage(state.originalFile) : null;
        for (let i = 0; i < todo.length; i++) {
          const it = todo[i];
          setSubmitLabel(todo.length > 1 ? `Saving ${i + 1} of ${todo.length}…` : 'Saving…');
          await saveItem(it, compressedOriginal);
          added.push(it);
        }

        Toast.success(added.length > 1 ? `${added.length} Pieces Added` : 'Piece Added',
          added.map(it => `${Utils.formatList(it.values.color, ' / ')} ${Utils.capitalize(it.values.type)}`).join(', ') + ' added to your wardrobe.');
        state.saving = false;
        if (addModal) addModal.classList.remove('active');
        form.reset();
        await refreshCurrentPage();
      } catch (err) {
        console.error('Failed to add clothing item:', err);
        const remaining = pendingSelection();
        const prefix = added.length ? `${added.length} of ${todo.length} items were added. ` : '';
        Toast.error('Save Failed', `${prefix}${err.message || 'Could not save clothing item.'} ` +
          'Nothing was half-saved — your details are kept, press Add to Wardrobe to try again.');
        // Items already added drop out of the selection so a retry cannot add them twice.
        state.selected = state.selected.filter(k => state.items.get(k).savedId == null);
        if (!state.selected.includes(state.activeKey)) state.activeKey = remaining[0] ? remaining[0].key : null;
        if (added.length) await refreshCurrentPage();
      } finally {
        if (session === state.session || state.saving) {
          state.saving = false;
          renderAll();
        }
      }
    });

    // Reset whenever the form is reset, including opening a fresh Add Item modal.
    form.addEventListener('reset', () => setTimeout(resetAll, 0));

    App.addClothing = {
      isSaving: () => state.saving,
      _state: () => state,   // for debugging/tests
    };
    resetAll();
  },

  /**
   * Initializes the page-specific component based on current page
   */
  initCurrentPage() {
    const pageKey = this.getCurrentPageKey();

    switch (pageKey) {
      case 'dashboard':
        if (window.DashboardPage && typeof DashboardPage.init === 'function') {
          DashboardPage.init();
        }
        break;
      case 'wardrobe':
        if (window.WardrobePage && typeof WardrobePage.init === 'function') {
          WardrobePage.init();
        }
        break;
      case 'outfits':
        if (window.OutfitsPage && typeof OutfitsPage.init === 'function') {
          OutfitsPage.init();
        }
        break;
      case 'analytics':
        if (window.AnalyticsPage && typeof AnalyticsPage.init === 'function') {
          AnalyticsPage.init();
        }
        break;
      case 'settings':
        if (window.SettingsPage && typeof SettingsPage.init === 'function') {
          SettingsPage.init();
        }
        break;
      default:
        break;
    }
  },
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});