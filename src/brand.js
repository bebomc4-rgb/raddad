// قالب انستا: بيقص المنتج عن الخلفية، بيحط علامة المتجر (الدراغون) خلفه بشكل خفيف،
// وتحت عاليسار: لوغو المتجر | خط | شعار المنتج — مقاس 4:5 (1080×1350)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

const W = 1080, H = 1350;

async function loadSharp() {
  try { return (await import('sharp')).default; } catch { throw new Error('مكتبة الصور (sharp) مو منزّلة — شغّل windows-update.bat'); }
}

export function brandAssets(tenantId) {
  const dir = path.join(DATA_DIR, 'brand', String(tenantId));
  const logo = path.join(dir, 'logo.png'), mark = path.join(dir, 'mark.png');
  return { logo: fs.existsSync(logo) ? logo : null, mark: fs.existsSync(mark) ? mark : null };
}

// ===== قص المنتج عن الخلفية البيضا (بدون ظله) =====
function dilate(m, w, h, r) {
  const t = new Uint8Array(m.length), o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) { const row = y * w; let run = -1e9;
    for (let x = 0; x < w; x++) { if (m[row + x]) run = x; t[row + x] = x - run <= r ? 1 : 0; }
    run = 1e9; for (let x = w - 1; x >= 0; x--) { if (m[row + x]) run = x; if (run - x <= r) t[row + x] = 1; } }
  for (let x = 0; x < w; x++) { let run = -1e9;
    for (let y = 0; y < h; y++) { if (t[y * w + x]) run = y; o[y * w + x] = y - run <= r ? 1 : 0; }
    run = 1e9; for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) run = y; if (run - y <= r) o[y * w + x] = 1; } }
  return o;
}
const invert = m => m.map(v => v ? 0 : 1);
const erode = (m, w, h, r) => invert(dilate(invert(m), w, h, r));
function floodFromBorder(pass, w, h) { // بيرجع يلي وصلناله من الأطراف
  const seen = new Uint8Array(w * h), q = new Int32Array(w * h); let qh = 0, qt = 0;
  const push = i => { if (pass[i] && !seen[i]) { seen[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (qh < qt) { const i = q[qh++], x = i % w;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < w * (h - 1)) push(i + w); }
  return seen;
}
const fillHoles = (m, w, h) => { const outside = floodFromBorder(invert(m), w, h); return outside.map(v => v ? 0 : 1); };
function largest(m, w, h) {
  const lab = new Int32Array(w * h); let best = 0, bestN = 0, cur = 0; const q = new Int32Array(w * h);
  for (let s = 0; s < m.length; s++) { if (!m[s] || lab[s]) continue; cur++; let qh = 0, qt = 0, n = 0; lab[s] = cur; q[qt++] = s;
    while (qh < qt) { const i = q[qh++], x = i % w; n++;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < m.length && m[j] && !lab[j]) { lab[j] = cur; q[qt++] = j; } }
    if (n > bestN) { bestN = n; best = cur; } }
  return lab.map(v => v === best ? 1 : 0);
}
function productMask(px, w, h) {
  const at = i => [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]];
  const corners = []; for (const [x0, y0] of [[0, 0], [w - 20, 0], [0, h - 20], [w - 20, h - 20]]) for (let y = y0; y < y0 + 20; y++) for (let x = x0; x < x0 + 20; x++) corners.push(at(y * w + x));
  const med = k => corners.map(c => c[k]).sort((a, b) => a - b)[corners.length >> 1];
  const bg = [med(0), med(1), med(2)];
  const near = new Uint8Array(w * h), gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const [r, g, b] = at(i);
    near[i] = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) <= 14 ? 1 : 0;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); gray[i] = (mx > 150 && (mx ? (mx - mn) * 255 / mx : 0) < 25) ? 1 : 0; }
  const fg = invert(floodFromBorder(near, w, h));
  let core = fg.map((v, i) => v && !gray[i] ? 1 : 0);
  core = erode(dilate(core, w, h, 6), w, h, 6);
  core = fillHoles(core, w, h);
  core = dilate(erode(core, w, h, 2), w, h, 2);
  core = largest(core, w, h);
  const bottom = new Int32Array(w).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (core[y * w + x]) bottom[x] = y;
  let prod = fg.map((v, i) => core[i] || (v && (i / w | 0) <= bottom[i % w] - 2) ? 1 : 0);
  prod = dilate(erode(prod, w, h, 2), w, h, 2);
  prod = largest(fillHoles(prod, w, h), w, h);
  return prod;
}

// المدخل: صورة (بعد التعديل) + شعار المنتج اختياري ← المخرج: مسار صورة البوست
export async function brandImage(tenant, imageUrl, { productLogoUrl = null } = {}) {
  const tenantId = typeof tenant === 'object' ? tenant.id : tenant;
  const sharp = await loadSharp();
  const assets = brandAssets(tenantId);
  const file = path.join(DATA_DIR, 'uploads', path.basename(imageUrl));
  const { data: px, info } = await sharp(file).removeAlpha().resize(1100, 1100, { fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const m = productMask(px, w, h);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) { const x = i % w, y = i / w | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0) throw new Error('ما قدرت لاقي المنتج بالصورة — جرّب صورة بخلفية فاتحة');
  const pad = 60;
  const box = { left: Math.max(0, x0 - pad), top: Math.max(0, y0 - pad) }; box.width = Math.min(w, x1 + pad + 50) - box.left; box.height = Math.min(h, y1 + pad + 50) - box.top;
  const areaW = W - 120, areaH = H - 320;
  const s = Math.min(areaW / box.width, areaH / box.height);
  const tw = Math.round(box.width * s), th = Math.round(box.height * s);
  const px0 = Math.round((W - tw) / 2), py0 = Math.round(70 + (areaH - th) / 2);

  const photo = await sharp(px, { raw: { width: w, height: h, channels: 3 } }).extract(box).resize(tw, th, { kernel: 'lanczos3' }).png().toBuffer();
  // نبني المنتج المقصوص بكسل بكسل (RGB + شفافية من القناع)
  const rgb = await sharp(photo).removeAlpha().raw().toBuffer();
  const maskBuf = Buffer.from(m.map(v => v * 255));
  const al = await sharp(maskBuf, { raw: { width: w, height: h, channels: 1 } }).extract(box).resize(tw, th, { kernel: 'cubic' }).blur(1.2).extractChannel(0).raw().toBuffer();
  const rgba = Buffer.alloc(tw * th * 4);
  for (let i = 0; i < tw * th; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = al[i] ?? 0; }
  const product = await sharp(rgba, { raw: { width: tw, height: th, channels: 4 } }).png().toBuffer();

  const layers = [];
  if (assets.mark) { // الدراغون خلف المنتج
    const mw = Math.round(W * 0.8);
    const { data: md, info: mi } = await sharp(assets.mark).ensureAlpha().resize({ width: mw }).raw().toBuffer({ resolveWithObject: true });
    let amax = 1; for (let i = 3; i < md.length; i += 4) if (md[i] > amax) amax = md[i];
    for (let i = 0; i < md.length; i += 4) { md[i] = md[i + 1] = md[i + 2] = 30; md[i + 3] = Math.round(md[i + 3] / amax * 34); } // شفافية ~13%
    const mk = await sharp(md, { raw: { width: mi.width, height: mi.height, channels: 4 } }).png().toBuffer();
    const mh = (await sharp(mk).metadata()).height;
    layers.push({ input: mk, left: Math.round((W - mw) / 2), top: Math.max(0, Math.round(py0 + (th - mh) / 2)) });
  }
  // ظل المنتج فوق العلامة (ضرب) وبعدين المنتج نفسه
  const shadowLayer = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite([{ input: photo, left: px0, top: py0 }]).png().toBuffer();
  let base = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite(layers).png().toBuffer();
  base = await sharp(base).composite([{ input: shadowLayer, blend: 'multiply' }, { input: product, left: px0, top: py0 }]).png().toBuffer();

  // التذييل: لوغو المتجر | خط | شعار المنتج
  const foot = [], lh = 62, fx = 56, fy = H - 56 - lh; let cx = fx;
  if (assets.logo) { const lg = await sharp(assets.logo).resize({ height: lh }).png().toBuffer(); const lw = (await sharp(lg).metadata()).width; foot.push({ input: lg, left: cx, top: fy }); cx += lw + 20; }
  if (productLogoUrl) {
    const pf = path.join(DATA_DIR, 'uploads', path.basename(productLogoUrl));
    if (fs.existsSync(pf)) {
      if (assets.logo) { foot.push({ input: Buffer.from(`<svg width="3" height="${lh - 12}"><rect width="3" height="${lh - 12}" fill="#a0a0a0"/></svg>`), left: cx, top: fy + 6 }); cx += 23; }
      const pl = await sharp(pf).resize({ height: lh, width: 220, fit: 'inside' }).png().toBuffer();
      foot.push({ input: pl, left: cx, top: fy });
    }
  }
  if (foot.length) base = await sharp(base).composite(foot).png().toBuffer();
  const name = `${tenantId}-post-${crypto.randomBytes(8).toString('hex')}.jpg`;
  await sharp(base).jpeg({ quality: 93 }).toFile(path.join(DATA_DIR, 'uploads', name));
  return { url: `/uploads/${name}` };
}

// حفظ لوغو المتجر أو العلامة المائية (الدراغون) من صفحة الطابور
export async function saveBrandAsset(tenantId, kind, buf) {
  const sharp = await loadSharp();
  const dir = path.join(DATA_DIR, 'brand', String(tenantId));
  fs.mkdirSync(dir, { recursive: true });
  if (kind === 'logo') { await sharp(buf).resize({ height: 300, withoutEnlargement: true }).png().toFile(path.join(dir, 'logo.png')); return; }
  await sharp(buf).resize({ width: 900, withoutEnlargement: true }).png().toFile(path.join(dir, 'mark-src.png')); // نسخة نضيفة لـ Gemini
  // العلامة: الخطوط الغامقة بتصير شفافة وخفيفة، والأبيض بيختفي
  const { data, info } = await sharp(buf).resize({ width: 900, withoutEnlargement: true }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const dark = 255 - data[i * info.channels];
    const a = dark < 40 ? 0 : Math.min(255, (dark - 40) * 1.3);
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 20; out[i * 4 + 3] = Math.round(a * 0.10);
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().png().toFile(path.join(dir, 'mark.png'));
}
