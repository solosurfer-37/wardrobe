/* ═══════════════════════════════════════════════════════
   AI Wardrobe — Beautify (individual garment extraction)
   ═══════════════════════════════════════════════════════
   Splits the user's original photo into one product-style image per garment
   (e.g. a T-shirt, trousers and shoes become three separate images).

   Method: clothing SEGMENTATION (human parsing) with a SegFormer model run in
   the browser through Transformers.js. The model gives every pixel one label:
   Upper-clothes, Pants, Skirt, Dress, Left/Right-shoe, Face, Hair, Arm, Leg,
   Hat, Bag, Background, ... Each garment is cut out from its own label mask,
   so it is separated from the person (skin, face, hair), from the other
   garments and from the background.

   This is not:
   - garment DETECTION (boxes around garments — a box still contains the
     person and the other clothes),
   - BACKGROUND REMOVAL (keeps the whole person and all clothes together),
   - image GENERATION (redraws the garment, so logos/patterns can change).
   Garment pixels are copied from the original photo unchanged.

   Cost: no API key, no API quota. The model (~15 MB) is downloaded once from
   the Hugging Face Hub and cached by the browser; it runs on the device CPU
   (WebAssembly).

   Each garment gets exactly one processed image per run. A garment that is
   too small or too fragmented to cut out reliably is reported as such and is
   never offered as a successful extraction.
   ═══════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  /**
   * Garment groups the model can isolate, keyed by its labels.
   * Hat, bag, scarf and belt are also labelled by the model, but the wardrobe has no
   * matching types, so they are not extracted.
   */
  const GARMENT_GROUPS = {
    top:   { labels: ['Upper-clothes'], name: 'Top', aiGroup: 'top' },
    dress: { labels: ['Dress'], name: 'Dress', aiGroup: 'dress' },
    pants: { labels: ['Pants'], name: 'Trousers', aiGroup: 'bottom' },
    skirt: { labels: ['Skirt'], name: 'Skirt', aiGroup: 'bottom' },
    shoes: { labels: ['Left-shoe', 'Right-shoe'], name: 'Shoes', aiGroup: 'footwear' },
  };
  const GROUP_ORDER = ['top', 'dress', 'pants', 'skirt', 'shoes'];
  const SKIN_LABELS = ['Face', 'Hair', 'Left-arm', 'Right-arm', 'Left-leg', 'Right-leg'];

  /** Maps the form's Type values to a garment group (used to match AI results and cards). */
  const TYPE_TO_GROUP = {
    'shirt': 'top', 't-shirt': 'top', 'blouse': 'top', 'top': 'top',
    'jacket': 'top', 'sweater': 'top', 'hoodie': 'top',
    'pants': 'pants', 'jeans': 'pants', 'trousers': 'pants', 'shorts': 'pants',
    'skirt': 'skirt',
    'shoes': 'shoes', 'sneakers': 'shoes', 'boots': 'shoes', 'sandals': 'shoes', 'loafers': 'shoes',
  };

  /** Below this share of the photo a label is treated as noise and not reported. */
  const DETECT_MIN = 0.003;
  /** Minimum share of the photo needed for a reliable cut-out (shoes are naturally small). */
  const RELIABLE_MIN = { shoes: 0.006, default: 0.012 };
  /** The two largest connected pieces must hold this share of the garment's pixels. */
  const MIN_MAIN_SHARE = 0.85;

  class BeautifyError extends Error {
    constructor(message) { super(message); this.name = 'BeautifyError'; }
  }

  // ── Pure helpers (no DOM; unit-tested in Node) ─────────────────────────

  /** Merges binary masks (0/255) into one. */
  function mergeMasks(masks, n) {
    const out = new Uint8Array(n);
    for (const m of masks) for (let i = 0; i < n; i++) if (m[i] > 127) out[i] = 1;
    return out;
  }

  /**
   * Splits a 0/1 mask into 4-connected pieces.
   * @returns {{labels: Int32Array, sizes: number[]}}  labels[i] = piece index + 1 (0 = empty)
   */
  function connectedComponents(mask, width, height) {
    const n = width * height;
    const labels = new Int32Array(n);
    const stack = new Int32Array(n);
    const sizes = [];
    for (let start = 0; start < n; start++) {
      if (!mask[start] || labels[start]) continue;
      const id = sizes.length + 1;
      let top = 0, size = 0;
      stack[top++] = start; labels[start] = id;
      while (top) {
        const i = stack[--top]; size++;
        const x = i % width;
        if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = id; stack[top++] = i - 1; }
        if (x < width - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = id; stack[top++] = i + 1; }
        if (i >= width && mask[i - width] && !labels[i - width]) { labels[i - width] = id; stack[top++] = i - width; }
        if (i < n - width && mask[i + width] && !labels[i + width]) { labels[i + width] = id; stack[top++] = i + width; }
      }
      sizes.push(size);
    }
    return { labels, sizes };
  }

  /**
   * Share of the mask's pixels held by its `k` largest 4-connected pieces.
   * A clean garment is one piece (or two for a pair of shoes / a top split by an arm);
   * many scattered pieces usually mean the model mislabelled things.
   */
  function mainComponentShare(mask, width, height, k = 2) {
    const { sizes } = connectedComponents(mask, width, height);
    const total = sizes.reduce((a, b) => a + b, 0);
    if (!total) return { share: 0, pieces: 0 };
    const sorted = [...sizes].sort((a, b) => b - a);
    return { share: sorted.slice(0, k).reduce((a, b) => a + b, 0) / total, pieces: sizes.length };
  }

  /**
   * Removes small detached specks (mislabelled pixels away from the garment) so they do not
   * stretch the crop. Pieces at least `minRatio` of the largest piece are kept (both shoes survive).
   */
  function keepMainPieces(mask, width, height, minRatio = 0.08) {
    const { labels, sizes } = connectedComponents(mask, width, height);
    if (!sizes.length) return { mask, removed: 0 };
    const largest = Math.max(...sizes);
    const keep = sizes.map(sz => sz >= largest * minRatio);
    const out = new Uint8Array(mask.length);
    let removed = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!labels[i]) continue;
      if (keep[labels[i] - 1]) out[i] = 1; else removed++;
    }
    return { mask: out, removed };
  }

  /**
   * Fills holes fully enclosed by the garment (e.g. a print or logo the model gave another label),
   * but never over skin or hair, so a hand resting on a shirt is not painted into the shirt.
   */
  function fillHoles(mask, blocked, width, height) {
    const n = width * height;
    const outside = new Uint8Array(n);
    const stack = new Int32Array(n);
    let top = 0;
    const push = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack[top++] = i; } };
    for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
    while (top) {
      const i = stack[--top], x = i % width;
      if (x > 0) push(i - 1);
      if (x < width - 1) push(i + 1);
      if (i >= width) push(i - width);
      if (i < n - width) push(i + width);
    }
    const out = new Uint8Array(mask);
    let filled = 0;
    for (let i = 0; i < n; i++) if (!mask[i] && !outside[i] && !(blocked && blocked[i])) { out[i] = 1; filled++; }
    return { mask: out, filled };
  }

  /** Number of mask pixels in each (2r+1)² square, via a summed-area table. */
  function boxCounts(mask, width, height, r) {
    const W1 = width + 1;
    const sat = new Int32Array(W1 * (height + 1));
    for (let y = 0; y < height; y++) {
      let row = 0;
      for (let x = 0; x < width; x++) {
        row += mask[y * width + x] ? 1 : 0;
        sat[(y + 1) * W1 + x + 1] = sat[y * W1 + x + 1] + row;
      }
    }
    return (x, y) => {
      const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
      const x1 = Math.min(width, x + r + 1), y1 = Math.min(height, y + r + 1);
      return { n: sat[y1 * W1 + x1] - sat[y0 * W1 + x1] - sat[y1 * W1 + x0] + sat[y0 * W1 + x0], area: (x1 - x0) * (y1 - y0) };
    };
  }

  /**
   * Morphological opening (erode, then dilate) with a (2r+1)² square: trims thin strands and
   * slivers attached to the garment (e.g. the gap between trouser legs labelled as "top")
   * while keeping its overall shape.
   */
  function morphOpen(mask, width, height, r) {
    if (r <= 0) return mask;
    const n = width * height;
    const countA = boxCounts(mask, width, height, r);
    const eroded = new Uint8Array(n);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const c = countA(x, y);
      if (c.n === c.area) eroded[y * width + x] = 1;
    }
    const countB = boxCounts(eroded, width, height, r);
    const out = new Uint8Array(n);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] && countB(x, y).n > 0) out[i] = 1;
    }
    return out;
  }

  /** Bounding box of a 0/1 mask, or null. */
  function maskBBox(mask, width, height) {
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (mask[row + x]) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  /**
   * Decides which garments were found and whether each can be cut out reliably.
   * @param {{label: string, mask: ArrayLike<number>}[]} segments  model output
   * @returns {{group, name, labels, coverage, status: 'ok'|'unreliable', reason?, warning?, mask, bbox}[]}
   */
  function assessGarments(segments, width, height) {
    const n = width * height;
    const results = [];
    const skin = mergeMasks(segments.filter(s => SKIN_LABELS.includes(s.label)).map(s => s.mask), n);
    for (const group of GROUP_ORDER) {
      const def = GARMENT_GROUPS[group];
      const masks = segments.filter(s => def.labels.includes(s.label)).map(s => s.mask);
      if (!masks.length) continue;
      const mask = mergeMasks(masks, n);
      let area = 0;
      for (let i = 0; i < n; i++) area += mask[i];
      const coverage = area / n;
      if (coverage < DETECT_MIN) continue;

      const minReliable = RELIABLE_MIN[group] || RELIABLE_MIN.default;
      const { share, pieces } = mainComponentShare(mask, width, height, 2);
      // Crop and cut out from a cleaned mask: thin strands trimmed, stray specks dropped,
      // enclosed holes filled except over skin/hair.
      const openR = Math.max(1, Math.round(Math.min(width, height) / 300));
      const openedRaw = morphOpen(mask, width, height, openR);
      const opened = openedRaw.some(Boolean) ? openedRaw : mask;   // never trim a garment away entirely
      const cleaned = fillHoles(keepMainPieces(opened, width, height).mask, skin, width, height).mask;
      const bbox = maskBBox(cleaned, width, height);
      const entry = { group, name: def.name, labels: def.labels, coverage, mask: cleaned, bbox, status: 'ok' };

      if (coverage < minReliable) {
        entry.status = 'unreliable';
        entry.reason = `The ${def.name.toLowerCase()} is too small in this photo to cut out cleanly.`;
      } else if (share < MIN_MAIN_SHARE) {
        entry.status = 'unreliable';
        entry.reason = `The ${def.name.toLowerCase()} was found in ${pieces} scattered pieces, so the cut-out would not be accurate.`;
      } else if (bbox.x === 0 || bbox.y === 0 || bbox.x + bbox.w === width || bbox.y + bbox.h === height) {
        entry.warning = 'It touches the edge of the photo, so part of it may be cut off.';
      }
      results.push(entry);
    }
    return results;
  }

  /** Softens a 0/1 mask into 0..255 alpha with a separable box blur. */
  function featherMask(mask, width, height, r) {
    const src = new Uint8ClampedArray(mask.length);
    for (let i = 0; i < mask.length; i++) src[i] = mask[i] ? 255 : 0;
    if (r <= 0) return src;
    const tmp = new Float32Array(src.length);
    const out = new Uint8ClampedArray(src.length);
    const size = r * 2 + 1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[row + Math.min(width - 1, Math.max(0, k))];
      for (let x = 0; x < width; x++) {
        tmp[row + x] = acc / size;
        acc += src[row + Math.min(width - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[Math.min(height - 1, Math.max(0, k)) * width + x];
      for (let y = 0; y < height; y++) {
        out[y * width + x] = Math.round(acc / size);
        acc += tmp[Math.min(height - 1, y + r + 1) * width + x] - tmp[Math.max(0, y - r) * width + x];
      }
    }
    return out;
  }

  /**
   * Square product canvas: garment centred with padding, never upscaled past 1:1
   * and never larger than maxSize.
   */
  function productLayout(bbox, maxSize, paddingRatio) {
    const side = Math.max(bbox.w, bbox.h);
    const padded = Math.ceil(side * (1 + paddingRatio * 2));
    const canvasSize = Math.min(maxSize, padded);
    const scale = Math.min(1, (canvasSize / (1 + paddingRatio * 2)) / side);
    const drawW = Math.round(bbox.w * scale);
    const drawH = Math.round(bbox.h * scale);
    return {
      canvasSize, scale,
      dx: Math.round((canvasSize - drawW) / 2),
      dy: Math.round((canvasSize - drawH) / 2),
      drawW, drawH,
    };
  }

  // ── Browser part ───────────────────────────────────────────────────────

  let segmenterPromise = null;

  function settings() {
    const c = (root.CONFIG && root.CONFIG.BEAUTIFY) || {};
    return {
      libraryUrl: c.LIBRARY_URL || 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js',
      modelId: c.MODEL_ID || 'Xenova/segformer_b0_clothes',
      workingSize: c.WORKING_SIZE || 1280,
      outputSize: c.OUTPUT_SIZE || 1024,
      dtype: c.DTYPE || 'fp32',
      engine: c.ENGINE || 'auto',   // 'auto' = SAM 3 via the backend, falling back to the on-device model
      refine: c.REFINE !== false,
    };
  }

  /** Loads Transformers.js and the segmentation model once per page. */
  function getSegmenter(onProgress) {
    if (!segmenterPromise) {
      const cfg = settings();
      segmenterPromise = (async () => {
        let lib;
        try {
          lib = await import(cfg.libraryUrl);
        } catch (err) {
          throw new BeautifyError('Could not load the image-processing library. Check your internet connection and try again.');
        }
        lib.env.allowLocalModels = false;
        const progress_callback = (p) => {
          if (onProgress && p && p.status === 'progress' && typeof p.progress === 'number') {
            onProgress(`Downloading model (first time only)… ${Math.round(p.progress)}%`);
          }
        };
        // Transformers.js defaults to the 8-bit quantized model in the browser, which makes
        // segmentation masks noticeably blotchier, so the full-precision file is tried first.
        const dtypes = cfg.dtype === 'q8' ? ['q8'] : [cfg.dtype, 'q8'];
        let lastErr;
        for (const dtype of dtypes) {
          try {
            const segmenter = await lib.pipeline('image-segmentation', cfg.modelId, { dtype, progress_callback });
            return { lib, segmenter, dtype };
          } catch (err) {
            lastErr = err;
            console.warn(`Segmentation model (${dtype}) failed to load:`, err);
          }
        }
        throw new BeautifyError('Could not download the clothing-segmentation model. Check your internet connection and try again.');
      })();
      // A failed load must not be cached forever, so the user can retry.
      segmenterPromise.catch(() => { segmenterPromise = null; });
    }
    return segmenterPromise;
  }

  /**
   * Copies `box` of the source into a square canvas (centred, padded with the photo's average
   * border colour), because the model squashes every input to a 512×512 square.
   */
  function squareCanvas(source, box) {
    const side = Math.max(box.w, box.h);
    const c = document.createElement('canvas');
    c.width = c.height = side;
    const ctx = c.getContext('2d');
    ctx.fillStyle = borderColour(source, box);
    ctx.fillRect(0, 0, side, side);
    c._offset = { x: Math.floor((side - box.w) / 2), y: Math.floor((side - box.h) / 2) };
    ctx.drawImage(source, box.x, box.y, box.w, box.h, c._offset.x, c._offset.y, box.w, box.h);
    return c;
  }

  function borderColour(source, box) {
    const d = source.getContext('2d').getImageData(box.x, box.y, box.w, box.h).data;
    let r = 0, g = 0, b = 0, n = 0;
    const add = (x, y) => { const i = (y * box.w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; };
    for (let x = 0; x < box.w; x += 4) { add(x, 0); add(x, box.h - 1); }
    for (let y = 0; y < box.h; y += 4) { add(0, y); add(box.w - 1, y); }
    return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
  }

  /** Runs the model on a square canvas and maps every mask back to full-photo coordinates. */
  async function segmentCanvas(lib, segmenter, square, box, width, height) {
    // Do NOT pass { subtask: 'semantic' }: in Transformers.js 3.8.x an explicit subtask is looked up
    // as a method *name* and then called, which throws "f is not a function". Left unset, the
    // pipeline picks the SegFormer processor's semantic post-processing itself.
    const output = await segmenter(lib.RawImage.fromCanvas(square));
    const side = square.width, off = square._offset;
    const segments = [];
    for (const s of output) {
      if (!s.label || !s.mask || s.mask.width !== side || s.mask.height !== side) continue;
      const full = new Uint8ClampedArray(width * height);
      const m = s.mask.data;
      for (let y = 0; y < box.h; y++) {
        const src = (y + off.y) * side + off.x, dst = (box.y + y) * width + box.x;
        for (let x = 0; x < box.w; x++) full[dst + x] = m[src + x];
      }
      segments.push({ label: s.label, mask: full });
    }
    if (output.length && !segments.length) {
      throw new BeautifyError('The segmentation model returned an unexpected result, so nothing was extracted.');
    }
    return segments;
  }

  /** Box around everything that is not background (the person and their clothes), padded. */
  function personBox(segments, width, height) {
    const fg = mergeMasks(segments.filter(s => s.label !== 'Background').map(s => s.mask), width * height);
    const b = maskBBox(fg, width, height);
    if (!b) return null;
    const pad = Math.round(Math.max(b.w, b.h) * 0.06);
    const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
    return { x, y, w: Math.min(width, b.x + b.w + pad) - x, h: Math.min(height, b.y + b.h + pad) - y };
  }

  /** Decodes the file and draws it (EXIF-rotated) on a canvas no larger than maxDim. */
  async function loadToCanvas(file, maxDim) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (err) {
      throw new BeautifyError('This image could not be read by the browser.');
    }
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    return canvas;
  }

  /** Cuts one garment out of the pristine source canvas and lays it out as a product image. */
  async function renderGarment(source, entry, feather, outputSize, baseName) {
    const width = source.width, height = source.height;
    const alpha = featherMask(entry.mask, width, height, feather);
    // Include the softened edge, which reaches `feather` pixels past the hard mask.
    const hb = entry.bbox;
    const bx = Math.max(0, hb.x - feather), by = Math.max(0, hb.y - feather);
    const bw = Math.min(width, hb.x + hb.w + feather) - bx;
    const bh = Math.min(height, hb.y + hb.h + feather) - by;

    const pixels = source.getContext('2d').getImageData(bx, by, bw, bh);   // original pixels, untouched
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const p = (y * bw + x) * 4 + 3;
        pixels.data[p] = Math.min(pixels.data[p], alpha[(by + y) * width + (bx + x)]);
      }
    }
    const cut = document.createElement('canvas');
    cut.width = bw; cut.height = bh;
    cut.getContext('2d').putImageData(pixels, 0, 0);

    const layout = productLayout({ w: bw, h: bh }, outputSize, 0.08);
    const out = document.createElement('canvas');
    out.width = out.height = layout.canvasSize;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.14)';
    ctx.shadowBlur = Math.round(layout.canvasSize / 40);
    ctx.shadowOffsetY = Math.round(layout.canvasSize / 120);
    ctx.drawImage(cut, 0, 0, bw, bh, layout.dx, layout.dy, layout.drawW, layout.drawH);
    ctx.restore();

    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    if (!blob) throw new BeautifyError('The browser could not create the extracted image.');
    const file = new File([blob], `${baseName}-${entry.group}.png`, { type: 'image/png' });
    return { blob, file };
  }

  /** On-device engine: SegFormer clothing segmentation run in the browser. */
  async function extractLocally(originalFile, source, onProgress) {
    const cfg = settings();
    const width = source.width, height = source.height;

    onProgress('Loading clothing-segmentation model…');
    const { lib, segmenter } = await getSegmenter(onProgress);

    onProgress('Finding the person…');
    let segments = await segmentCanvas(lib, segmenter, squareCanvas(source, { x: 0, y: 0, w: width, h: height }), { x: 0, y: 0, w: width, h: height }, width, height);

    // Second pass on a square crop around the person: the garments then fill much more of the
    // model's 512×512 input, so their masks come out 2–3× finer, and nothing is stretched.
    const person = cfg.refine ? personBox(segments, width, height) : null;
    if (person && person.w * person.h < 0.8 * width * height) {
      onProgress('Finding each garment…');
      segments = await segmentCanvas(lib, segmenter, squareCanvas(source, person), person, width, height);
    }

    const found = assessGarments(segments, width, height);
    if (!found.length) {
      throw new BeautifyError('No garment could be found in this photo, so nothing was extracted. ' +
        'This method works best on a photo of clothes being worn; you can still add the original photo.');
    }

    const feather = Math.max(1, Math.round(Math.min(width, height) / 500));
    const baseName = (originalFile.name || 'clothing').replace(/\.[^.]+$/, '');
    const garments = [];
    for (const entry of found) {
      const g = { key: entry.group, group: entry.group, name: entry.name, aiGroup: GARMENT_GROUPS[entry.group].aiGroup,
        status: entry.status, coverage: entry.coverage };
      if (entry.status === 'ok') {
        onProgress(`Building ${entry.name.toLowerCase()} image…`);
        Object.assign(g, await renderGarment(source, entry, feather, cfg.outputSize, baseName));
        g.note = 'Cut out with clothing segmentation; pixels copied unchanged from your photo. ' +
          'Parts hidden by arms, hair or other clothes stay missing.' + (entry.warning ? ' ' + entry.warning : '');
      } else {
        g.reason = entry.reason;
        g.note = entry.reason + ' It is not offered as an extracted image.';
      }
      garments.push(g);
    }
    return { garments, engine: 'local' };
  }


  // ── SAM 3 engine (Roboflow, via the Spring backend) ──────────────────

  /** The app's API object: a top-level `const API` in api.js, which is not a window property. */
  const appApi = () => (typeof API !== 'undefined' ? API : root.API);

  const FOOTWEAR_PROMPTS = ['shoes', 'sneakers', 'boots', 'sandals'];

  /** Fills SAM 3 polygons into a 0/1 mask of the working canvas size. */
  function rasterisePolygons(polygons, width, height) {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (const poly of polygons) {
      poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    }
    ctx.fill('evenodd');
    const d = ctx.getImageData(0, 0, width, height).data;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] > 127 ? 1 : 0;
    return mask;
  }

  /**
   * Turns SAM 3 detections into garments: each instance is its own garment, except footwear,
   * whose instances (left/right shoe) are merged into one pair. Near-identical outlines from
   * different prompts are de-duplicated, keeping the more confident one.
   * @param {{prompt, type, confidence, mask}[]} detections
   */
  function groupDetections(detections, width, height) {
    const n = width * height;
    const area = (m) => { let a = 0; for (let i = 0; i < n; i++) a += m[i]; return a; };
    const iou = (a, b) => {
      let inter = 0, uni = 0;
      for (let i = 0; i < n; i++) { if (a[i] && b[i]) inter++; if (a[i] || b[i]) uni++; }
      return uni ? inter / uni : 0;
    };

    const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
    const footwear = sorted.filter(d => FOOTWEAR_PROMPTS.includes(d.prompt));
    const garments = [];
    for (const d of sorted.filter(x => !FOOTWEAR_PROMPTS.includes(x.prompt))) {
      if (garments.some(g => iou(g.mask, d.mask) > 0.7)) continue;
      garments.push({ ...d, area: area(d.mask) });
    }
    if (footwear.length) {
      const merged = new Uint8Array(n);
      footwear.forEach(f => { for (let i = 0; i < n; i++) if (f.mask[i]) merged[i] = 1; });
      garments.push({ prompt: footwear[0].prompt, type: footwear[0].type, confidence: footwear[0].confidence, mask: merged, area: area(merged) });
    }
    return garments.filter(g => g.area / n >= DETECT_MIN);
  }

  const capitalise = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const groupForType = (type, prompt) => TYPE_TO_GROUP[type] || (prompt === 'dress' ? 'dress' : 'top');

  async function extractWithSam3(originalFile, source, onProgress) {
    const cfg = settings();
    const width = source.width, height = source.height;
    onProgress('Finding each garment (SAM 3)…');
    const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/jpeg', 0.92));
    const res = await appApi().segmentGarments(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
    const detections = (res.garments || []).map(g => ({
      prompt: g.prompt, type: g.type, confidence: g.confidence,
      mask: rasterisePolygons(g.polygons || [], width, height),
    }));
    const found = groupDetections(detections, width, height)
      .map(g => ({ ...g, bbox: maskBBox(g.mask, width, height) }))
      .filter(g => g.bbox)
      .sort((a, b) => a.bbox.y - b.bbox.y)          // top-to-bottom: jacket, shirt, trousers, shoes
      .slice(0, 8);
    if (!found.length) {
      throw new BeautifyError('SAM 3 found no garment in this photo, so nothing was extracted. You can still add the original photo.');
    }

    const feather = Math.max(1, Math.round(Math.min(width, height) / 600));
    const baseName = (originalFile.name || 'clothing').replace(/\.[^.]+$/, '');
    const seen = {};
    const garments = [];
    for (const g of found) {
      seen[g.prompt] = (seen[g.prompt] || 0) + 1;
      const key = `${g.prompt}-${seen[g.prompt]}`;
      const group = groupForType(g.type, g.prompt);
      const name = capitalise(g.prompt) +
        (seen[g.prompt] > 1 ? ` ${seen[g.prompt]}` : '');
      const mask = keepMainPieces(g.mask, width, height, 0.05).mask;
      const entry = { group: key, mask, bbox: maskBBox(mask, width, height) || g.bbox };
      onProgress(`Building ${name.toLowerCase()} image…`);
      const out = await renderGarment(source, entry, feather, cfg.outputSize, baseName);
      const edge = entry.bbox.x === 0 || entry.bbox.y === 0 || entry.bbox.x + entry.bbox.w === width || entry.bbox.y + entry.bbox.h === height;
      garments.push({
        key, group, name, aiGroup: GARMENT_GROUPS[group].aiGroup, suggestedType: g.type || null,
        status: 'ok', coverage: g.area / (width * height), confidence: g.confidence, ...out,
        note: `Outlined by SAM 3 (${Math.round(g.confidence * 100)}% sure); pixels copied unchanged from your photo.` +
          (edge ? ' It touches the edge of the photo, so part of it may be cut off.' : ''),
      });
    }
    return { garments, engine: 'sam3' };
  }

  /**
   * Splits the ORIGINAL photo into one product image per garment (the photo itself is never modified).
   * Uses SAM 3 through the backend when it is configured, otherwise the on-device model.
   * @returns {Promise<{garments: object[], engine: 'sam3'|'local', fallbackReason?: string}>}
   */
  async function extractGarments(originalFile, options = {}) {
    const { onProgress = () => {} } = options;
    const cfg = settings();
    onProgress('Preparing image…');
    const source = await loadToCanvas(originalFile, cfg.workingSize);

    let fallbackReason = null;
    const api = appApi();
    if (cfg.engine !== 'local' && api && typeof api.segmentGarments === 'function') {
      try {
        return await extractWithSam3(originalFile, source, onProgress);
      } catch (err) {
        if (err instanceof BeautifyError || cfg.engine === 'sam3') throw err;
        // Not configured, backend not running, quota used up or provider error: use the on-device model.
        fallbackReason = err.unavailable ? 'SAM 3 is not set up on the server' : (err.message || 'SAM 3 failed');
        console.warn('SAM 3 unavailable, using the on-device model:', err);
      }
    }
    const result = await extractLocally(originalFile, source, onProgress);
    if (fallbackReason) result.fallbackReason = fallbackReason;
    return result;
  }

  const api = {
    extractGarments, BeautifyError, groupDetections, rasterisePolygons,
    assessGarments, mainComponentShare, keepMainPieces, fillHoles, morphOpen, connectedComponents, maskBBox, mergeMasks, featherMask, productLayout,
    TYPE_TO_GROUP, GARMENT_GROUPS, GROUP_ORDER,
  };
  root.ClothingBeautify = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
