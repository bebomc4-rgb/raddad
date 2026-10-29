// التعديل التلقائي من مجلد: كل مجلد فرعي = منتج (1 لـ 10 صور).
// بيختار أحسن صورة، بيبعتها لـ Gemini مع البرومبت الثابت والشعارات، وبيحفظ النتيجة لحاله.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q, getSetting, setSetting } from './db.js';
import { DATA_DIR } from './config.js';
import { getTenant } from './tenants.js';
import { resolveAI } from './ai.js';
import { emit } from './events.js';

const IMG = /\.(jpe?g|png|webp)$/i;
export const DEFAULT_PROMPT = `اتخيل انك مصور منتجات ب استديو ابيض ولديك جميع انواع الاضائة والكاميرات والعدسات لتصور منتج ليبدو بدقة عالية و فخم و غني وزاوية تصوير احترافية سنمائية واقعية, اظهر تفاصيل الرسمات في المنتج, اريد صورة واحدة, ضع شعار المنتج اسفل يسار الصورة بشكل صغير , مع وضع اللوغو الخاص بالمتجر اسفل يسار الصورة بشكل صغير وضع خط طولي بين شعاري و شعار المنتج وضعهم جانب بعض اريد شعاري على اليسار ثم الخط ثم شعار المنتج, ,الصورة تستخدم معايير التصميمات العالمية, لاتظهر معدات التصوير و الاضائة في الصورة, صور المنتج من عدة زوايا و اظهر التفاصيل الدقيقية والعامة , لاتضيف اي شيئ على المنتج الاصلي , اجعل المنتج 3d واقعي, اريد خلفية احترافية تليق بالمنتج واريد فقط صورة المنتج قطعة واحدة , الخلفية تكون مثل الهوية البصرية للمنتج و جذابة تخلي الزبون يطلبها فورا, ابعاد الصورة 1:1 , ضع المنتج منتصف الصورة مثل صور امازون وعلي بابا , مع هوية بصرية خاصة بالمنتج واضائة خاصة بالمنتج و مؤثرات بصرية تعكس القوة, الخلفية انت اختار واحدة او اثنتين فقط من : دخان ابيض او اضائة او غبار او ماء او ثلج او شرارة او رياح او سرعة او ضباب او اختفاء, اضائة ملونة.`;

const key = tid => `auto_${tid}`;
export function getAuto(tid) {
  return { folder: '', out: '', prompt: DEFAULT_PROMPT, model: 'gemini-3-pro-image', size: '2K', aspect: '1:1', brand: true, running: false, current: null, ...getSetting(key(tid), {}) };
}
export function setAuto(tid, patch) { const v = { ...getAuto(tid), ...patch }; setSetting(key(tid), v); emit(tid, 'auto', {}); return v; }

async function sharpLib() { try { return (await import('sharp')).default; } catch { return null; } }
async function prep(file, max = 2048) {
  const sharp = await sharpLib();
  if (!sharp) return { mime: file.match(/png$/i) ? 'image/png' : 'image/jpeg', data: fs.readFileSync(file).toString('base64') };
  const buf = await sharp(file).rotate().resize(max, max, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  return { mime: 'image/jpeg', data: buf.toString('base64') };
}
const part = p => ({ inline_data: { mime_type: p.mime, data: p.data } });
function geminiKeys(tenant, paidFirst = true) {
  const list = resolveAI(tenant).filter(p => p.kind === 'gemini' && p.key);
  const paid = p => /مدفوع|paid|pro/i.test(p.name || '');
  return paidFirst ? [...list.filter(paid), ...list.filter(p => !paid(p))] : [...list.filter(p => !paid(p)), ...list.filter(paid)];
}
async function gemini(p, model, body, ms = 240_000) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error?.message || `Gemini (${res.status})`);
  return d;
}

// أحسن صورة: موديل نصي مجاني بيشوف الصور الصغيرة وبيختار رقم
async function pickBest(tenant, files) {
  if (files.length === 1) return 0;
  const thumbs = await Promise.all(files.map(f => prep(f, 384)));
  const parts = [{ text: `هدول ${files.length} صور لنفس المنتج، مرقّمين من 1 لـ ${files.length} بالترتيب. اختار أحسن صورة لنعدّلها لصورة إعلان: المنتج كامل وواضح، حاد، إضاءة منيحة، زاوية بتبيّن الشكل والشعار. رد برقم الصورة بس.` }];
  thumbs.forEach((t, i) => { parts.push({ text: `صورة ${i + 1}:` }); parts.push(part(t)); });
  for (const p of geminiKeys(tenant, false)) {
    try {
      const d = await gemini(p, 'gemini-flash-lite-latest', { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0 } }, 60_000);
      const n = parseInt(((d?.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('')).match(/\d+/)?.[0], 10);
      if (n >= 1 && n <= files.length) return n - 1;
    } catch {}
  }
  // احتياط: أكبر ملف
  let best = 0; files.forEach((f, i) => { if (fs.statSync(f).size > fs.statSync(files[best]).size) best = i; });
  return best;
}

function toUploads(tid, file, tag) {
  const name = `${tid}-${tag}-${crypto.randomBytes(6).toString('hex')}${path.extname(file).toLowerCase() || '.jpg'}`;
  fs.copyFileSync(file, path.join(DATA_DIR, 'uploads', name));
  return `/uploads/${name}`;
}

// المجلد فيه مجلدات فرعية (كل منتج لحاله) ← منستخدمها. وإذا كل الصور بمجلد واحد ← الذكاء بيجمّع صور كل منتج سوا
export function listProducts(folder, tid = null) {
  if (!folder || !fs.existsSync(folder)) return [];
  const subs = fs.readdirSync(folder, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_'))
    .map(d => ({ name: d.name, files: fs.readdirSync(path.join(folder, d.name)).filter(f => IMG.test(f)).sort().slice(0, 10).map(f => path.join(folder, d.name, f)) }))
    .filter(p => p.files.length);
  if (subs.length) return subs.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  if (tid == null) return [];
  const g = getAuto(tid).groups;
  if (!g || g.folder !== folder) return [];
  return g.list.map(x => ({ name: x.name, files: x.files.map(f => path.join(folder, f)).filter(f => fs.existsSync(f)) })).filter(p => p.files.length);
}
export function flatImages(folder) {
  if (!folder || !fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).filter(d => d.isFile() && IMG.test(d.name)).map(d => d.name)
    .sort((a, b) => fs.statSync(path.join(folder, a)).mtimeMs - fs.statSync(path.join(folder, b)).mtimeMs || a.localeCompare(b));
}

// تجميع: دفعات من 24 صورة بالترتيب، وكل دفعة بتعرف آخر منتج من الدفعة يلي قبلها
export async function groupFolder(tid, folder, onProgress = () => {}) {
  const tenant = getTenant(tid);
  const files = flatImages(folder);
  const groups = []; const BATCH = 20;
  onProgress(0, files.length, 0);
  for (let start = 0; start < files.length; start += BATCH) {
    const chunk = files.slice(start, start + BATCH);
    const prev = groups[groups.length - 1];
    const parts = [{ text: `بدي جمّع صور منتجات متجر رياضي. كل منتج ممكن يكون إله من 1 لـ 10 صور من زوايا مختلفة، والصور غالباً مرتّبة ورا بعض.
${prev ? `أول صورة (P) هي من آخر منتج بالدفعة الماضية واسمه "${prev.name}". إذا في صور من نفس هالمنتج حطها بمجموعة اسمها "${prev.name}" بالضبط.\n` : ''}رجّع JSON بس بهالشكل: {"groups":[{"name":"اسم قصير ومميّز للمنتج بالعربي (النوع + الماركة + اللون)","images":[أرقام الصور]}]}
كل صورة لازم تكون بمجموعة وحدة بس. الأرقام من 1 لـ ${chunk.length}.` }];
    if (prev) { parts.push({ text: 'P:' }); parts.push(part(await prep(path.join(folder, prev.files[0]), 320))); }
    for (let i = 0; i < chunk.length; i++) { parts.push({ text: `${i + 1}:` }); parts.push(part(await prep(path.join(folder, chunk[i]), 320))); }
    let res = null;
    for (const p of geminiKeys(tenant, false)) {
      try {
        const d = await gemini(p, 'gemini-flash-lite-latest', { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }, 60_000);
        const txt = (d?.candidates?.[0]?.content?.parts || []).filter(x => !x.thought).map(x => x.text || '').join('');
        res = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); if (res?.groups) break;
      } catch (e) { res = null; console.error('[auto] group', p.name, String(e.message).slice(0, 120)); }
    }
    const used = new Set();
    for (const gr of res?.groups || []) {
      const imgs = (gr.images || []).map(n => parseInt(n, 10) - 1).filter(i => i >= 0 && i < chunk.length && !used.has(i));
      imgs.forEach(i => used.add(i));
      if (!imgs.length) continue;
      const name = String(gr.name || 'منتج').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 60) || 'منتج';
      const target = prev && name === prev.name ? prev : groups.find(x => x.name === name && x !== prev) ? null : null;
      if (target) target.files.push(...imgs.map(i => chunk[i]));
      else { let nm = name, k = 2; while (groups.some(x => x.name === nm)) nm = `${name} ${k++}`; groups.push({ name: nm, files: imgs.map(i => chunk[i]) }); }
    }
    // صور ما انحطت بأي مجموعة ← كل وحدة منتج لحالها
    chunk.forEach((f, i) => { if (!used.has(i)) groups.push({ name: path.parse(f).name, files: [f] }); });
    onProgress(Math.min(files.length, start + BATCH), files.length, groups.length);
  }
  groups.forEach(g => { g.files = g.files.slice(0, 10); });
  setAuto(tid, { groups: { folder, list: groups, at: Date.now() }, grouping: null });
  return groups;
}

async function processOne(tid, cfg, prod) {
  const tenant = getTenant(tid);
  q.run("INSERT INTO auto_items (tenant_id, product, status) VALUES (?, ?, 'working') ON CONFLICT(tenant_id, product) DO UPDATE SET status = 'working', error = NULL, updated_at = unixepoch()", tid, prod.name);
  setAuto(tid, { current: prod.name });
  const bi = await pickBest(tenant, prod.files);
  const srcUrl = toUploads(tid, prod.files[bi], 'src');
  q.run('UPDATE auto_items SET src_url = ?, picked = ? WHERE tenant_id = ? AND product = ?', srcUrl, path.basename(prod.files[bi]), tid, prod.name);
  const parts = [part(await prep(prod.files[bi]))];
  if (cfg.brand) {
    const dir = path.join(DATA_DIR, 'brand', String(tid));
    for (const f of ['logo.png', 'mark-src.png']) if (fs.existsSync(path.join(dir, f))) parts.push(part({ mime: 'image/png', data: fs.readFileSync(path.join(dir, f)).toString('base64') }));
  }
  parts.push({ text: cfg.prompt || DEFAULT_PROMPT });
  const body = { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { ...(cfg.aspect ? { aspectRatio: cfg.aspect } : {}), imageSize: cfg.size || '2K' } } };
  let lastErr = 'ما في مفتاح Gemini مدفوع';
  for (const p of geminiKeys(tenant)) {
    try {
      const d = await gemini(p, cfg.model || 'gemini-3-pro-image', body);
      const ps = d?.candidates?.[0]?.content?.parts || [];
      const img = ps.find(x => !x.thought && (x.inline_data || x.inlineData));
      if (!img) { lastErr = 'Gemini ما رجّع صورة (' + (d?.candidates?.[0]?.finishReason || d?.promptFeedback?.blockReason || '') + ')'; continue; }
      const buf = Buffer.from((img.inline_data || img.inlineData).data, 'base64');
      const out = cfg.out || (cfg.folder.replace(/[\\/]+$/, '') + '_edited');
      fs.mkdirSync(out, { recursive: true });
      const outFile = path.join(out, `${prod.name}.png`);
      fs.writeFileSync(outFile, buf);
      const resUrl = toUploads(tid, outFile, 'auto');
      q.run("UPDATE auto_items SET status = 'done', result_url = ?, out_path = ?, by = ?, updated_at = unixepoch() WHERE tenant_id = ? AND product = ?", resUrl, outFile, p.name, tid, prod.name);
      console.log(`[auto] ${prod.name} done (${p.name})`);
      return;
    } catch (e) { lastErr = e.message; }
  }
  q.run("UPDATE auto_items SET status = 'error', error = ?, updated_at = unixepoch() WHERE tenant_id = ? AND product = ?", String(lastErr).slice(0, 300), tid, prod.name);
  console.error(`[auto] ${prod.name}: ${lastErr}`);
  if (/quota|billing|exceeded|credit/i.test(lastErr)) setAuto(tid, { running: false, current: null, stopReason: 'الرصيد أو الحصة خلصت: ' + String(lastErr).slice(0, 120) });
}

let busy = false;
async function tick() {
  if (busy) return;
  const rows = q.all("SELECT key FROM platform_settings WHERE key LIKE 'auto_%'");
  for (const r of rows) {
    const tid = Number(r.key.slice(5)); const cfg = getAuto(tid);
    if (!cfg.running) continue;
    const done = new Set(q.all("SELECT product FROM auto_items WHERE tenant_id = ? AND status IN ('done','error')", tid).map(x => x.product));
    let prods = listProducts(cfg.folder, tid);
    if (!prods.length && flatImages(cfg.folder).length) { // كل الصور بمجلد واحد ← منجمّعهن أول مرة
      busy = true;
      try { setAuto(tid, { current: null, grouping: 'عم اتعرّف على المنتجات…' });
        await groupFolder(tid, cfg.folder, (d, t, g) => setAuto(tid, { grouping: `عم اتعرّف على المنتجات: ${d} من ${t} صورة · ${g} منتج لهلق` })); }
      catch (e) { setAuto(tid, { running: false, grouping: null, stopReason: 'ما قدرت جمّع الصور: ' + e.message }); }
      finally { busy = false; }
      return;
    }
    const next = prods.find(p => !done.has(p.name));
    if (!next) { setAuto(tid, { running: false, current: null, stopReason: 'خلصت كل المنتجات ✅' }); continue; }
    busy = true;
    try { await processOne(tid, cfg, next); } catch (e) { console.error('[auto]', e.message); }
    finally { busy = false; const c = getAuto(tid); setAuto(tid, { current: null, running: c.running }); emit(tid, 'auto', {}); }
    return;
  }
}
export function startAutoWorker() {
  q.run("UPDATE auto_items SET status = 'queued' WHERE status = 'working'");
  setInterval(tick, 8000);
}
