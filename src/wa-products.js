// إدارة المنتجات من الواتساب (صاحب المنصة، 10 تشرين التاني 2026)
// صاحب المتجر بيبعت لرقم البوت: صورة + اسم + سعر ← منتج جديد بموقعو. أو «احذف…»، «غيّر سعر… لـ 20»، «خلص…»، «رجع…».
// خدمة باشتراك (wa_products) لأي متجر، ومجانية لمتجر صاحب المنصة (KO SPORT).
// الأمان: ما منبعت شي للموقع. منحضّر «مهمة» برقم عشوائي، ومنقول للموقع رقمها، والموقع بيجيبها منّا من عنوان المنصة الثابت.
import crypto from 'node:crypto';
import { getSetting } from './db.js';
import { hasService } from './services.js';
import { resolveAI, chat, parseJSON } from './ai.js';
import { isKoTenant, KO_STORE } from './ko-catalog.js';
import { adminPhone } from './notify.js';
import { getTenant } from './tenants.js';

const jobs = new Map(); // رقم → { job, at }
const pending = new Map(); // tenant:contact → { kind, job, candidates, at }
const lastAdd = new Map(); // tenant:contact → { id, at } (صور زيادة لنفس المنتج)
setInterval(() => { const n = Date.now(); for (const [k, v] of jobs) if (n - v.at > 3 * 60_000) jobs.delete(k); for (const [k, v] of pending) if (n - v.at > 15 * 60_000) pending.delete(k); for (const [k, v] of lastAdd) if (n - v.at > 10 * 60_000) lastAdd.delete(k); }, 60_000).unref();

const digits = s => String(s || '').replace(/\D/g, '');
const same = (a, b) => { a = digits(a).replace(/^0+/, ''); b = digits(b).replace(/^0+/, ''); return a && b && (a === b || a.endsWith(b.slice(-9)) || b.endsWith(a.slice(-9))); };
const CMD = /^\s*(احذف|حذف|امسح|شيل|الغي|غير|غيّر|عدل|عدّل|سعر|نزّل|نزل|ارفع|خلص|خلّص|نفذ|نفد|مو متوفر|رجع|رجّع|متوفر|ضيف|اضف|أضف|منتج جديد|منتج|حط|حطّ|حطو|حطّو|انقل|نقل)\b/;

export function siteFor(tenant) {
  if (isKoTenant(tenant)) return { site: 'ko', url: (getSetting('ko_products_origin', '') || 'https://ko-sport.online').replace(/\/$/, ''), name: 'KO SPORT' };
  const u = String(tenant.settings.products_site || '').trim().replace(/\/$/, '');
  if (!/^https:\/\/[^/]+$/i.test(u)) return null;
  return { site: u, url: u, name: tenant.name };
}
function ownerOf(tenant, contact) {
  const mine = [contact.phone, String(contact.jid || '').split('@')[0]];
  const owners = [tenant.settings.owner_numbers, tenant.settings.notify_number, isKoTenant(tenant) ? adminPhone() : ''].join(',').split(/[,،;\n]+/).map(digits).filter(n => n.length >= 6);
  return owners.some(o => mine.some(m => same(m, o)));
}

// رقم صاحب متجر مفعّل عندو الخدمة؟ (لنحفظ صورتو حتى لو البوت ما رح يرد عليه)
export function productsOwner(tenantId, phone) {
  try { const tenant = getTenant(tenantId); if (!tenant || !siteFor(tenant) || !(isKoTenant(tenant) || hasService(tenant.id, 'wa_products'))) return false; return ownerOf(tenant, { phone, jid: '' }); } catch { return false; }
}
// قرار سريع (بدون انتظار): هالرسالة إلنا؟
export function productsWants(tenant, contact, { text, mediaUrl }) {
  if (!siteFor(tenant) || !(isKoTenant(tenant) || hasService(tenant.id, 'wa_products')) || !ownerOf(tenant, contact)) return false;
  const key = tenant.id + ':' + contact.id, t = String(text || '').trim();
  if (pending.has(key) && (/^\d{1,2}$/.test(t) || /^(الغي|لا|إلغاء|الغاء)$/.test(t) || (pending.get(key).kind === 'price' && /\d/.test(t)))) return true;
  if (mediaUrl) return /\d/.test(t) || CMD.test(t) || (!t && lastAdd.has(key));
  return CMD.test(t);
}

const SYS = `إنت مساعد بيدير منتجات متجر من رسائل صاحب المتجر على الواتساب (لهجة سورية). رجّع JSON بس:
{"action":"add|update|delete|none","name":"","query":"","price":null,"newName":"","category":"","inStock":null,"details":"","ask":""}
- add: منتج جديد (غالباً مع صورة). name = اسم المنتج متل ما كتبو، price = الرقم بالدولار. details = وصف قصير للمنتج بالعربي (سطرين لـ 4، بدون مبالغة، بدون إيموجي، بدون أسعار).
- update: تعديل منتج موجود. query = اسم المنتج يلي بدو يعدّلو. price = السعر الجديد إذا ذكرو. inStock=false إذا قال خلص/نفذ/مو متوفر، true إذا قال رجع/متوفر. newName إذا بدو يغيّر الاسم. category إذا بدو يغيّر القسم.
- delete: حذف. query = اسم المنتج.
- none: الرسالة مو أمر منتجات.
إذا add وما في سعر، حط price=null و ask="قديش سعرو؟". لا تخترع سعر ولا اسم.`;

async function parse(tenant, text, imageNote, cats) {
  const content = [text ? 'رسالة صاحب المتجر: ' + text : 'صاحب المتجر بعت صورة بدون كلام', imageNote ? 'وصف الصورة: ' + imageNote : ''].filter(Boolean).join('\n');
  const sys = SYS + (cats.length ? `\nأقسام الموقع (category لازم تكون وحدة منها حرفياً، اختار الأنسب لنوع المنتج متل «حبل قفز» لحبل القفز و«قفازات ملاكمة» لقفاز الملاكمة. إذا ما في قسم مناسب أكيد حط category=""):\n${cats.join('\n')}` : '');
  const r = await chat(resolveAI(tenant, { prefer: 'smart' }), { system: sys, messages: [{ role: 'user', content }], json: true, temperature: 0.2, maxTokens: 700 });
  return parseJSON(r.text || r.reply || r.content || '') || { action: 'none' };
}

const base = () => (getSetting('public_base', '') || 'https://k-fast-ai.pages.dev').replace(/\/$/, '');
async function run(tenant, site, job) {
  const t = crypto.randomBytes(18).toString('base64url');
  jobs.set(t, { job: { ...job, site: site.site, tenant: tenant.id }, at: Date.now() });
  try {
    const r = await fetch(site.url + '/api/bot/job', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t }), signal: AbortSignal.timeout(60_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !j.msg && !j.candidates) return { ok: false, msg: j.error || 'الموقع رفض (' + r.status + ')' };
    return j;
  } catch (e) { return { ok: false, msg: 'ما قدرت وصل للموقع: ' + e.message }; }
  finally { jobs.delete(t); }
}
const catCache = new Map(); // tenant → { cats, at }
async function getCats(tenant, site) {
  const c = catCache.get(tenant.id); if (c && Date.now() - c.at < 10 * 60_000) return c.cats;
  const r = await run(tenant, site, { action: 'cats' });
  const cats = Array.isArray(r.cats) ? r.cats.slice(0, 80) : [];
  if (cats.length) catCache.set(tenant.id, { cats, at: Date.now() });
  return cats;
}
// الموقع بيسحب المهمة من هون (مرة وحدة)
export function takeJob(t) {
  const v = jobs.get(String(t || '')); if (!v) return null;
  jobs.delete(String(t)); return v.job;
}

const money = n => (Number(n) ? Number(n) + '$' : '');
function result(r, job) {
  if (r.candidates?.length) return null;
  if (!r.ok) return '✗ ' + (r.msg || 'ما زبط');
  const p = r.product || {};
  if (job.action === 'add') return `✅ ضفت المنتج عالموقع:\n• الاسم: ${p.name}\n• القسم: ${p.category || '—'}\n• السعر: ${p.price ? money(p.price) : 'بالتواصل'}\n• الصورة الرئيسية: ${r.images ? 'الصورة يلي بعتها' + (r.images > 1 ? ` (+${r.images - 1})` : '') : 'ما في صورة'}${p.details ? '\n• الوصف: ' + p.details : ''}\n${p.url || ''}\n\nبدك تغيّر شي؟ قلّي مثلاً «غيّر سعرو لـ 30» أو «حطّو بقسم …» أو ابعت صور زيادة.`;
  if (job.action === 'addimg') return `✅ انضافت الصورة لـ «${p.name}»`;
  if (job.category) return `✅ نقلت «${p.name}» لقسم «${p.category}»\n${p.url || ''}`;
  if (job.action === 'delete') return `🗑️ انحذف «${p.name}»`;
  return `✅ تعدّل «${p.name}»${job.price != null ? '\nالسعر: ' + money(p.price) : ''}${job.inStock != null ? '\n' + (p.inStock ? 'صار متوفر' : 'صار «خالص»') : ''}\n${p.url || ''}`;
}

export async function productsHandle(tenant, contact, { text, mediaUrl, mediaNote }, reply) {
  const site = siteFor(tenant); if (!site) return;
  const key = tenant.id + ':' + contact.id, t = String(text || '').trim();
  const img = mediaUrl ? base() + mediaUrl : null;
  try {
    // جواب على سؤال سابق
    const pd = pending.get(key);
    if (pd && /^(الغي|لا|إلغاء|الغاء)$/.test(t)) { pending.delete(key); return reply('تمام، لغيت.'); }
    if (pd && pd.kind === 'choose' && /^\d{1,2}$/.test(t)) {
      const c = pd.candidates[Number(t) - 1]; if (!c) return reply('الرقم مو بالقائمة، ابعت رقم من القائمة أو «الغي».');
      pending.delete(key);
      const job = { ...pd.job, id: c.id }, r = await run(tenant, site, job);
      return reply(result(r, job) || '✗ ما زبط');
    }
    if (pd && pd.kind === 'price' && /\d/.test(t) && !CMD.test(t)) {
      pending.delete(key);
      const job = { ...pd.job, price: parseFloat(t.replace(/[^\d.,]/g, '').replace(',', '.')) || 0 };
      const r = await run(tenant, site, job);
      if (r.ok && r.product) lastAdd.set(key, { id: r.product.id, at: Date.now() });
      return reply(result(r, job) || '✗ ما زبط');
    }
    if (pd && pd.kind === 'cat' && /^\d{1,2}$/.test(t)) {
      const c = pd.cats[Number(t) - 1]; if (!c) return reply('الرقم مو بالقائمة، ابعت رقم القسم أو «الغي».');
      pending.delete(key);
      const job = { ...pd.job, category: c };
      if (job.price == null || job.price === '') { pending.set(key, { kind: 'price', job, at: Date.now() }); return reply(`حطّيتو بقسم «${c}». قديش سعر «${job.name}» بالدولار؟`); }
      const r = await run(tenant, site, job);
      if (r.ok && r.product) lastAdd.set(key, { id: r.product.id, at: Date.now() });
      return reply(result(r, job) || '✗ ما زبط');
    }
    // صورة زيادة بدون كلام بعد منتج جديد
    if (img && !t && lastAdd.has(key)) {
      const job = { action: 'addimg', id: lastAdd.get(key).id, images: [img] }, r = await run(tenant, site, job);
      lastAdd.set(key, { ...lastAdd.get(key), at: Date.now() });
      return reply(result(r, job) || '✗ ما زبط');
    }
    const cats = await getCats(tenant, site).catch(() => []);
    const a = await parse(tenant, t, mediaNote ? String(mediaNote).replace(/^📷[^:]*:\s*/, '') : '', cats);
    if (!a || a.action === 'none') return reply('ما فهمت شو بدك تعمل بالمنتج. أمثلة:\n• صورة + «قفاز ملاكمة أحمر 25$»\n• «غيّر سعر حزام أحمر لـ 9»\n• «خلص الشيكر الأسود»\n• «احذف حبل القفز»');
    const job = { action: a.action === 'add' ? 'add' : a.action === 'delete' ? 'delete' : 'update', name: a.name, query: a.query || a.name, price: a.price, newName: a.newName, category: a.category && (!cats.length || cats.includes(a.category)) ? a.category : '', inStock: a.inStock, details: a.action === 'add' ? a.details : '' };
    // «غيّر سعرو / حطّو بقسم…» بعد منتج جديد: بيقصد آخر منتج
    if (job.action === 'update' && !job.query && lastAdd.has(key)) job.id = lastAdd.get(key).id;
    if (job.action === 'add') {
      job.images = img ? [img] : [];
      if (!job.name) return reply('شو اسم المنتج؟ ابعت الصورة مع الاسم والسعر.');
      if (cats.length && !cats.includes(job.category)) {
        pending.set(key, { kind: 'cat', job, cats, at: Date.now() });
        return reply(`ما عرفت بأي قسم حطّ «${job.name}». ابعتلي رقم القسم:\n` + cats.map((c, i) => `${i + 1}. ${c}`).join('\n') + '\n(أو «الغي»)');
      }
      if (job.price == null || job.price === '') { pending.set(key, { kind: 'price', job, at: Date.now() }); return reply(`«${job.name}» — قديش سعرو بالدولار؟`); }
    }
    const r = await run(tenant, site, job);
    if (r.candidates?.length) {
      pending.set(key, { kind: 'choose', job, candidates: r.candidates, at: Date.now() });
      return reply('لقيت أكتر من منتج، ابعتلي رقم يلي بتقصدو:\n' + r.candidates.map((c, i) => `${i + 1}. ${c.name}${c.price ? ' — ' + money(c.price) : ''}`).join('\n') + '\n(أو «الغي»)');
    }
    if (job.action === 'add' && r.ok && r.product) lastAdd.set(key, { id: r.product.id, at: Date.now() });
    return reply(result(r, job));
  } catch (e) {
    console.error('[wa-products]', e.message);
    return reply('✗ صار خطأ: ' + e.message);
  }
}
