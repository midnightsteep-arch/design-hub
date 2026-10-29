// Pixel-art maths: integer-scale fitting (device-pixel aware) and client-side image checks.

// Device pixels per art pixel for integer zoom k. One zoom step is round(dpr) device pixels, so on
// DPR 1 and 2 "k×" is exactly k CSS pixels per texel, and on fractional DPR (1.25, 1.5) every texel is
// still a whole number of physical pixels — blocks stay uniform instead of alternating 1 px / 2 px.
export function unitPx(dpr) { return Math.max(1, Math.round(dpr || 1)); }
export function devMultiple(k, dpr) { return k * unitPx(dpr); }

// Largest integer zoom that fits the box. Returns {k, w, h, down, pct}.
export function fitScale(nw, nh, boxW, boxH, dpr = 1, maxK = 64) {
  if (!nw || !nh || !boxW || !boxH) return null;
  let best = 0;
  for (let k = 1; k <= maxK; k++) {
    const m = devMultiple(k, dpr);
    if (nw * m / dpr <= boxW + 0.01 && nh * m / dpr <= boxH + 0.01) best = k; else break;
  }
  if (best >= 1) {
    const m = devMultiple(best, dpr);
    return { k: best, w: nw * m / dpr, h: nh * m / dpr, down: false };
  }
  const s = Math.min(boxW / nw, boxH / nh);
  // round the downscaled size to whole device pixels
  const w = Math.max(1, Math.floor(nw * s * dpr)) / dpr;
  const h = Math.max(1, Math.floor(nh * s * dpr)) / dpr;
  return { k: s, w, h, down: true, pct: Math.max(1, Math.round(s * 100)) };
}

export function sizeAt(nw, nh, k, dpr = 1) {
  const m = devMultiple(k, dpr);
  return { w: nw * m / dpr, h: nh * m / dpr };
}

// ---------------------------------------------------------------- natural-size cache
const dims = new Map();
export function knownDims(src) { return dims.get(src) || null; }
export function rememberDims(src, w, h) { if (src && w && h) dims.set(src, { w, h }); }

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { rememberDims(src, img.naturalWidth, img.naturalHeight); resolve(img); };
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

// ---------------------------------------------------------------- analysis
function gcd(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }

export function analyzePixels(data, w, h) {
  let semi = 0;
  let opaque = 0;
  const colors = new Set();
  const CAP = 4097;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a !== 0 && a !== 255) semi++;
    if (a > 0) {
      opaque++;
      if (colors.size < CAP) colors.add(((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | a) >>> 0);
    }
  }
  // uniform k×k block detection: gcd of all colour-change positions along rows and columns
  const same = (p, q) => {
    const ap = data[p + 3], aq = data[q + 3];
    if (ap === 0 && aq === 0) return true;
    return data[p] === data[q] && data[p + 1] === data[q + 1] && data[p + 2] === data[q + 2] && ap === aq;
  };
  let gx = w, gy = h;
  let changes = 0;
  for (let y = 0; y < h && gx > 1; y++) {
    const row = y * w * 4;
    for (let x = 1; x < w; x++) {
      if (!same(row + (x - 1) * 4, row + x * 4)) { gx = gcd(gx, x); changes++; if (gx === 1) break; }
    }
  }
  for (let x = 0; x < w && gy > 1; x++) {
    for (let y = 1; y < h; y++) {
      if (!same(((y - 1) * w + x) * 4, (y * w + x) * 4)) { gy = gcd(gy, y); changes++; if (gy === 1) break; }
    }
  }
  const block = changes ? gcd(gx, gy) : 1;
  return {
    w, h,
    semi,
    binaryAlpha: semi === 0,
    colors: colors.size >= CAP ? CAP - 1 : colors.size,
    colorsCapped: colors.size >= CAP,
    opaque,
    block: block > 1 ? block : 1,
  };
}

const cache = new Map();
export function analyzeImage(src) {
  if (cache.has(src)) return cache.get(src);
  const p = loadImage(src).then((img) => {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (w * h > 4096 * 4096) return { w, h, tooBig: true };
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    return analyzePixels(d, w, h);
  }).catch(() => null);
  cache.set(src, p);
  return p;
}

// Build the pass/warn checks for a replacement image. `settings` = project.settings.pixelArt.
export function pixelChecks(res, { settings, currentDims } = {}) {
  if (!res) return [];
  const out = [];
  if (currentDims && currentDims.w && currentDims.h && (currentDims.w !== res.w || currentDims.h !== res.h)) {
    out.push({ id: 'size', ok: false, label: `${res.w}×${res.h} ≠ ${currentDims.w}×${currentDims.h}`, title: `The replacement is ${res.w}×${res.h} px but the current asset is ${currentDims.w}×${currentDims.h} px.` });
  } else if (currentDims && currentDims.w) {
    out.push({ id: 'size', ok: true, label: `${res.w}×${res.h}`, title: 'Same pixel size as the current asset.' });
  }
  if (!settings || !settings.enabled || res.tooBig) return out;
  out.push(res.binaryAlpha
    ? { id: 'alpha', ok: true, label: 'Alpha 0/255', title: 'Every pixel is fully transparent or fully opaque.' }
    : { id: 'alpha', ok: false, label: `${res.semi} soft-alpha px`, title: `${res.semi} pixels are semi-transparent (pixel art should use only alpha 0 or 255).` });
  const max = settings.maxColors;
  const cLabel = res.colorsCapped ? '4096+ colours' : `${res.colors} colour${res.colors === 1 ? '' : 's'}`;
  if (max) out.push(res.colors <= max
    ? { id: 'colors', ok: true, label: `${cLabel} ≤ ${max}`, title: `Uses ${res.colors} colours (limit ${max}).` }
    : { id: 'colors', ok: false, label: `${cLabel} > ${max}`, title: `Uses ${res.colors} colours; the project limit is ${max}.` });
  else out.push({ id: 'colors', ok: true, info: true, label: cLabel, title: 'Distinct opaque colours.' });
  out.push(res.block > 1
    ? { id: 'upscale', ok: false, label: `Upscaled ${res.block}×?`, title: `The image is made of uniform ${res.block}×${res.block} blocks — it looks like a ${res.block}× upscale of a ${Math.round(res.w / res.block)}×${Math.round(res.h / res.block)} original. Upload the native-size master.` }
    : { id: 'upscale', ok: true, label: 'Native pixels', title: 'No uniform k×k block upscale detected.' });
  return out;
}

// Read width/height of an image Blob (for X-Width / X-Height on upload).
export async function blobDims(blob) {
  if (!blob || !/^image\//.test(blob.type || '')) return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return { w: img.naturalWidth, h: img.naturalHeight };
  } catch (e) { return null; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
