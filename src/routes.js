// كل نقاط الـ API
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { config, DATA_DIR } from './config.js';
import { q, tx, getSetting, setSetting, usageToday } from './db.js';
import { createRouter, HttpError } from './http.js';
import { hashPassword, verifyPassword, createSession, destroySession, encrypt, decrypt, maskKey, rateLimit } from './security.js';
import { getTenant, getPlan, brand, DEFAULT_SETTINGS, DEFAULT_KNOWLEDGE, safeJSON, ensureSlug, PERIODS, periodDays, priceFor, subscriptionExpired } from './tenants.js';
import { saveProduct, importProducts, parseCSV } from './products.js';
import { PRESETS, listModels, chat, getBrains, nameOf, resolveAI, parseJSON } from './ai.js';
import { playground, resumeBot, pauseBot, sendManual, sendVoiceTo } from './agent.js';
import * as wa from './whatsapp/index.js';
import * as qrConn from './whatsapp/baileys.js';
import * as cloud from './whatsapp/cloud.js';
import { clamp } from './text.js';
import { transcribe, extractProduct } from './voice.js';
import { parseExport, unzipTexts, buildPairs, savePairs, styleStats, clearExamples, analyzeStyle, cleanExamples } from './style.js';
import { bumpUsage } from './db.js';
import { aiAllowance } from './tenants.js';
import { trialStatus, allowNewTrial } from './trial.js';

export const router = createRouter();
const r = router;

// ===== أدوات =====
const need = (cond, status, msg) => { if (!cond) throw new HttpError(status, msg); };
const auth = ctx => need(ctx.user, 401, 'سجّل دخول أول');
const owner = ctx => { auth(ctx); need(ctx.user.role === 'owner' || ctx.user.is_super, 403, 'ما عندك صلاحية'); };
const sup = ctx => { auth(ctx); need(ctx.user.is_super, 403, 'هالقسم لمدير المنصة بس'); };
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');

function publicTenant(t) {
  return {
    id: t.id, name: t.name, plan_id: t.plan_id, plan_expires_at: t.plan_expires_at, status: t.status,
    wa_provider: t.wa_provider, wa_phone: t.wa_phone, bot_enabled: !!t.bot_enabled,
    ai_provider: t.ai_provider, ai_model: t.ai_model, ai_base_url: t.ai_base_url, ai_key: maskKey(decrypt(t.ai_key_enc)),
    cloud_phone_number_id: t.cloud_phone_number_id, cloud_token: maskKey(decrypt(t.cloud_token_enc)),
    settings: { ...t.settings, cloud_app_secret_enc: undefined, cloud_app_secret: t.settings.cloud_app_secret_enc ? '••••' : '' },
    knowledge: t.knowledge
  };
}

// حماية من طلب عناوين داخلية عند الاستيراد من رابط
async function safeFetch(url) {
  let u;
  try { u = new URL(url); } catch { throw new HttpError(400, 'الرابط غير صالح'); }
  need(['http:', 'https:'].includes(u.protocol), 400, 'لازم الرابط يبلش بـ http أو https');
  const { address } = await dns.lookup(u.hostname);
  const priv = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i;
  need(!(net.isIP(address) && priv.test(address)), 400, 'ما مسموح عناوين داخلية');
  const res = await fetch(u, { signal: AbortSignal.timeout(30_000), redirect: 'follow', headers: { 'User-Agent': 'RaddadImporter/1.0' } });
  need(res.ok, 400, `ما قدرنا نجيب الرابط (${res.status})`);
  return res;
}

// ===== عام =====
r.get('/api/public/info', () => ({
  brand: brand(),
  registration_open: getSetting('registration_open', true),
  plans: q.all('SELECT id, name, price_monthly, currency, ai_replies_per_day, max_products, features FROM plans WHERE is_public = 1 ORDER BY sort')
    .map(p => ({ ...p, features: safeJSON(p.features, []) })),
  needs_setup: !q.get('SELECT 1 FROM users LIMIT 1')
}));

r.post('/api/auth/register', ctx => {
  const { business_name, name, email, password } = ctx.body;
  const first = !q.get('SELECT 1 FROM users LIMIT 1');
  need(first || getSetting('registration_open', true), 403, 'التسجيل مسكّر حالياً');
  need(rateLimit('reg:' + ctx.ip, 5, 3600_000), 429, 'محاولات كتير، جرب بعد شوي');
  const em = String(email || '').toLowerCase().trim();
  need(emailOk(em), 400, 'الإيميل غير صحيح');
  need(String(password || '').length >= 8, 400, 'كلمة السر لازم تكون 8 أحرف أو أكتر');
  need(String(business_name || '').trim(), 400, 'اكتب اسم المتجر');
  need(!q.get('SELECT 1 FROM users WHERE email = ?', em), 409, 'هالإيميل مسجّل من قبل');
  const isSuper = first || (config.adminEmail && em === config.adminEmail) ? 1 : 0;
  const userId = tx(() => {
    const t = q.run('INSERT INTO tenants (name, settings, knowledge) VALUES (?, ?, ?)', clamp(business_name, 120).trim(),
      JSON.stringify({ ...DEFAULT_SETTINGS, cloud_verify_token: crypto.randomBytes(12).toString('hex') }),
      JSON.stringify({ ...DEFAULT_KNOWLEDGE, business_name: clamp(business_name, 120).trim() }));
    const u = q.run('INSERT INTO users (tenant_id, email, name, pass_hash, role, is_super) VALUES (?, ?, ?, ?, ?, ?)',
      t.lastInsertRowid, em, clamp(name || '', 80), hashPassword(password), 'owner', isSuper);
    return Number(u.lastInsertRowid);
  });
  ctx.setCookie(createSession(userId));
  return { ok: true };
});

r.post('/api/auth/login', ctx => {
  const em = String(ctx.body.email || '').toLowerCase().trim();
  need(rateLimit('login:' + ctx.ip, 10, 900_000) && rateLimit('login:' + em, 8, 900_000), 429, 'محاولات كتير، استنى ربع ساعة');
  const u = q.get('SELECT * FROM users WHERE email = ?', em);
  need(u && verifyPassword(String(ctx.body.password || ''), u.pass_hash), 401, 'الإيميل أو كلمة السر غلط');
  ctx.setCookie(createSession(u.id));
  return { ok: true };
});

r.post('/api/auth/logout', ctx => { destroySession(ctx.token); ctx.setCookie('', 0); return { ok: true }; });

r.get('/api/me', ctx => {
  auth(ctx);
  const t = ctx.tenant;
  const plan = getPlan(t);
  return {
    user: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name, role: ctx.user.role, is_super: !!ctx.user.is_super },
    tenant: { ...publicTenant(t), slug: ensureSlug(t) },
    plan: { ...plan, features: safeJSON(plan.features, []) },
    usage: usageToday(t.id),
    wa: wa.status(t),
    gate: trialStatus(t),
    brand: brand(),
    counts: {
      products: q.get('SELECT COUNT(*) n FROM products WHERE tenant_id = ?', t.id).n,
      needs_human: q.get('SELECT COUNT(*) n FROM contacts WHERE tenant_id = ? AND needs_human = 1', t.id).n,
      new_orders: q.get("SELECT COUNT(*) n FROM orders WHERE tenant_id = ? AND status = 'new'", t.id).n,
      unread: q.get('SELECT COALESCE(SUM(unread),0) n FROM contacts WHERE tenant_id = ?', t.id).n
    },
    public_url: config.publicUrl
  };
});

// صفحة الزبون الخاصة: بس صاحب الحساب (أو مدير المنصة) بيشوفها
r.get('/api/store', ctx => {
  auth(ctx);
  const row = q.get('SELECT id FROM tenants WHERE slug = ?', String(ctx.query.slug || ''));
  need(row && (row.id === ctx.tenant.id || ctx.user.is_super), 403, 'ما عندك صلاحية تشوف هالصفحة');
  const t = getTenant(row.id);
  const plan = getPlan(t);
  const plans = Object.fromEntries(q.all('SELECT id, name FROM plans').map(p => [p.id, p.name]));
  return {
    slug: ensureSlug(t), name: t.name,
    plan: { id: t.plan_id, name: plans[t.plan_id] || t.plan_id, active_name: plan.name },
    expires_at: t.plan_expires_at, expired: subscriptionExpired(t), gate: trialStatus(t),
    payments: q.all('SELECT id, plan_id, months, method, status, amount, created_at FROM payment_requests WHERE tenant_id = ? ORDER BY id DESC LIMIT 50', t.id)
      .map(p => ({ ...p, plan_name: plans[p.plan_id] || p.plan_id })),
    contacts: q.all('SELECT id, name, phone, last_message, last_at, needs_human FROM contacts WHERE tenant_id = ? ORDER BY last_at DESC LIMIT 30', t.id),
    orders: q.all('SELECT id, customer_name, customer_phone, total, status, created_at FROM orders WHERE tenant_id = ? ORDER BY id DESC LIMIT 30', t.id)
  };
});

r.put('/api/account', ctx => {
  auth(ctx);
  const { name, password_current, password_new } = ctx.body;
  if (name !== undefined) q.run('UPDATE users SET name = ? WHERE id = ?', clamp(name, 80), ctx.user.id);
  if (password_new) {
    const u = q.get('SELECT pass_hash FROM users WHERE id = ?', ctx.user.id);
    need(verifyPassword(String(password_current || ''), u.pass_hash), 400, 'كلمة السر الحالية غلط');
    need(String(password_new).length >= 8, 400, 'كلمة السر الجديدة لازم تكون 8 أحرف أو أكتر');
    q.run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(password_new), ctx.user.id);
  }
  return { ok: true };
});

// ===== إعدادات الوكيل والمعرفة =====
r.put('/api/settings', ctx => {
  owner(ctx);
  const t = ctx.tenant;
  const { settings, knowledge, bot_enabled, name } = ctx.body;
  const s = { ...t.settings };
  if (settings) for (const k of Object.keys(DEFAULT_SETTINGS)) if (settings[k] !== undefined) s[k] = typeof settings[k] === 'string' ? clamp(settings[k], 4000) : settings[k];
  const kn = { ...t.knowledge };
  if (knowledge) for (const k of Object.keys(DEFAULT_KNOWLEDGE)) if (knowledge[k] !== undefined) kn[k] = clamp(knowledge[k], k === 'faq' ? 12000 : 3000);
  q.run('UPDATE tenants SET settings = ?, knowledge = ?, bot_enabled = COALESCE(?, bot_enabled), name = COALESCE(?, name) WHERE id = ?',
    JSON.stringify(s), JSON.stringify(kn), bot_enabled === undefined ? null : (bot_enabled ? 1 : 0), name ? clamp(name, 120) : null, t.id);
  return { ok: true, tenant: publicTenant(getTenant(t.id)) };
});

// ===== الذكاء الاصطناعي =====
r.get('/api/ai/presets', ctx => { auth(ctx); return PRESETS; });

r.put('/api/ai', ctx => {
  owner(ctx);
  const { provider, model, base_url, key } = ctx.body;
  need(provider === 'platform' || PRESETS[provider], 400, 'مزوّد غير معروف');
  if (provider !== 'platform') need(getPlan(ctx.tenant).allow_own_key, 403, 'خطتك ما بتسمح بمفتاح خاص');
  const keyEnc = key ? encrypt(String(key).trim()) : (provider === ctx.tenant.ai_provider ? ctx.tenant.ai_key_enc : null);
  if (provider !== 'platform') need(keyEnc, 400, 'حط مفتاح الـ API');
  q.run('UPDATE tenants SET ai_provider = ?, ai_model = ?, ai_base_url = ?, ai_key_enc = ? WHERE id = ?',
    provider, model || null, base_url || null, provider === 'platform' ? null : keyEnc, ctx.tenant.id);
  return { ok: true, tenant: publicTenant(getTenant(ctx.tenant.id)) };
});

r.post('/api/ai/models', async ctx => {
  auth(ctx);
  const { provider, base_url, key, use_saved } = ctx.body;
  let k = key;
  if (!k && use_saved) k = ctx.user.is_super && use_saved !== true ? decrypt(getBrains().find(x => x.id === use_saved)?.key_enc) : decrypt(ctx.tenant.ai_key_enc);
  need(k, 400, 'حط المفتاح أول');
  try { return { models: await listModels({ provider, base_url, key: k }) }; }
  catch (e) { throw new HttpError(400, e.message); }
});

r.post('/api/ai/test', async ctx => {
  owner(ctx);
  const { resolveAI } = await import('./ai.js');
  try {
    const t0 = Date.now();
    const { text } = await chat(resolveAI(ctx.tenant), { system: 'رد بكلمة وحدة: تمام', messages: [{ role: 'user', content: 'اختبار' }], json: false, maxTokens: 20 });
    return { ok: true, reply: text.slice(0, 100), ms: Date.now() - t0 };
  } catch (e) { throw new HttpError(400, e.message); }
});

// ===== صوت Fish Audio (data/fish.json: حتى 4 مفاتيح + الصوت المختار) =====
const FISH_FILE = path.join(DATA_DIR, 'fish.json');
const fishRead = () => {
  try { const j = JSON.parse(fs.readFileSync(FISH_FILE, 'utf8')); return { keys: [0, 1, 2, 3].map(i => String(j.keys?.[i] || '')), voice: String(j.voice || ''), voiceName: String(j.voiceName || ''), always: !!j.always }; } catch {}
  try { const [key = '', voice = ''] = fs.readFileSync(path.join(DATA_DIR, 'fish.txt'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).map(x => x.trim()); const bad = x => !x || /حط|paste|xxx/i.test(x); return { keys: [bad(key) ? '' : key, '', '', ''], voice: bad(voice) ? '' : voice, voiceName: '' }; } catch {}
  return { keys: ['', '', '', ''], voice: '', voiceName: '' };
};
r.get('/api/voice/fish', ctx => { sup(ctx); return fishRead(); });
r.put('/api/voice/fish', ctx => {
  sup(ctx);
  const b = ctx.body || {};
  const keys = (Array.isArray(b.keys) ? b.keys : []).slice(0, 4).map(k => clamp(String(k || '').trim(), 300));
  fs.writeFileSync(FISH_FILE, JSON.stringify({ keys, voice: clamp(String(b.voice || '').trim(), 300), voiceName: clamp(String(b.voiceName || '').trim(), 120), always: !!b.always }, null, 1));
  return { ok: true };
});
r.get('/api/voice/fish/voices', async ctx => {
  sup(ctx);
  try { const { fishVoices } = await import('./tts.js'); return { voices: await fishVoices(String(ctx.query.q || '').slice(0, 60), parseInt(ctx.query.page, 10) || 1) }; }
  catch (e) { throw new HttpError(400, 'ما قدرت جيب الأصوات: ' + e.message); }
});
r.get('/api/voice/fish/status', async ctx => { sup(ctx); const { fishStatus } = await import('./tts.js'); return fishStatus(); });
r.post('/api/voice/send', async ctx => {
  sup(ctx);
  const text = String(ctx.body?.text || '').trim().slice(0, 600), phone = String(ctx.body?.phone || '');
  need(text.length > 1, 400, 'اكتب الكلام يلي بدك ياه ينقال');
  try { return { ok: true, ...(await sendVoiceTo(ctx.tenant, phone, text)) }; }
  catch (e) { throw new HttpError(400, 'ما انبعت: ' + e.message); }
});
r.post('/api/voice/preview', async ctx => {
  sup(ctx);
  const text = String(ctx.body?.text || '').trim().slice(0, 600); need(text.length > 1, 400, 'اكتب الكلام');
  try { const { speak } = await import('./tts.js'); const url = await speak(ctx.tenant, text); if (!url) throw new Error('ما طلع صوت'); return { ok: true, url }; }
  catch (e) { throw new HttpError(400, 'ما زبط الصوت: ' + e.message); }
});
r.post('/api/voice/fish/test', async ctx => {
  sup(ctx);
  const t0 = Date.now();
  try { const { speak } = await import('./tts.js'); const url = await speak(ctx.tenant, String(ctx.body?.text || 'أهلين وسهلين، نوّرت KO SPORT. شو بتحب نساعدك فيه اليوم؟').slice(0, 300)); if (!url) throw new Error('ما طلع صوت'); return { ok: true, url, ms: Date.now() - t0 }; }
  catch (e) { throw new HttpError(400, 'ما زبط الصوت: ' + e.message); }
});

// ===== العقول (كل موديلات المنصة بمكان واحد) =====
r.get('/api/ai/brains', ctx => {
  sup(ctx);
  return { routing: getSetting('ai_routing', true), brains: getBrains().map(x => ({ id: x.id, name: x.name, provider: x.provider, model: x.model || '', base_url: x.base_url || '', level: x.level || 'smart', enabled: x.enabled !== false, key: x.key_enc ? decrypt(x.key_enc) : '' })) };
});
r.put('/api/ai/brains', ctx => {
  sup(ctx);
  const { brains, routing } = ctx.body;
  if (routing !== undefined) setSetting('ai_routing', !!routing);
  if (Array.isArray(brains)) {
    const old = Object.fromEntries(getBrains().map(x => [x.id, x]));
    const out = brains.slice(0, 40).map((x, i) => {
      need(PRESETS[x.provider], 400, 'مزوّد غير معروف');
      const id = x.id && old[x.id] ? x.id : 'b' + Date.now().toString(36) + i;
      const key_enc = x.key ? encrypt(String(x.key).trim()) : old[x.id]?.key_enc || null; // خانة فاضية ما بتمسح مفتاح محفوظ
      return { id, name: clamp(x.name || nameOf(x.provider), 40), provider: x.provider, model: clamp(String(x.model || '').trim(), 200), base_url: clamp(String(x.base_url || '').trim(), 300), level: x.level === 'fast' ? 'fast' : 'smart', enabled: x.enabled !== false, key_enc };
    });
    setSetting('ai_brains', out);
  }
  return { ok: true };
});
r.post('/api/ai/brains/test', async ctx => {
  sup(ctx);
  const x = getBrains().find(b => b.id === ctx.body.id);
  need(x && x.key_enc, 400, 'احفظ العقل مع مفتاحه أول');
  const preset = PRESETS[x.provider] || PRESETS.custom;
  const p = { name: x.name, provider: x.provider, kind: preset.kind, base_url: x.base_url || preset.base_url, model: x.model || preset.model, key: decrypt(x.key_enc) };
  try {
    const t0 = Date.now();
    const { text } = await chat([p], { system: 'رد بجملة قصيرة باللهجة السورية', messages: [{ role: 'user', content: 'مرحبا، كيفك؟' }], json: false, maxTokens: 40 });
    return { ok: true, reply: text.slice(0, 120), ms: Date.now() - t0 };
  } catch (e) { throw new HttpError(400, e.message); }
});

r.post('/api/ai/brains/test-image', async ctx => {
  sup(ctx);
  const x = getBrains().find(b => b.id === ctx.body.id);
  need(x && x.key_enc && x.provider === 'gemini', 400, 'اختار عقل Gemini محفوظ');
  const model = ctx.body.model || 'gemini-2.5-flash-image';
  // صورة صغيرة 8×8 حمرا
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': decrypt(x.key_enc).trim() },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Make this square blue.' }, { inline_data: { mime_type: 'image/png', data: png.toString('base64') } }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
    signal: AbortSignal.timeout(90_000)
  });
  const d = await res.json().catch(() => ({}));
  const gotImage = (d?.candidates?.[0]?.content?.parts || []).some(p => p.inline_data || p.inlineData);
  return { status: res.status, gotImage, error: d?.error?.message?.slice(0, 300) || null };
});

// ===== واتساب =====
r.get('/api/wa/status', ctx => { auth(ctx); return wa.status(ctx.tenant); });

r.post('/api/wa/connect', async ctx => {
  owner(ctx);
  need(ctx.tenant.status === 'active', 403, 'الحساب موقوف');
  const { mode, phone } = ctx.body;
  let pairNum = String(phone || '').replace(/\D/g, '').replace(/^00/, '');
  if (mode === 'pair') {
    need(!pairNum.startsWith('0'), 400, 'اكتب الرقم مع رمز الدولة وبدون الصفر الأول. مثلاً 0933123456 بتصير 963933123456');
    pairNum = pairNum.replace(/^(963|962|961|964|966|971|20|90)0/, '$1'); // شيل الصفر بعد رمز الدولة إذا انكتب بالغلط
    need(/^\d{10,15}$/.test(pairNum), 400, 'اكتب رقمك كامل مع رمز الدولة، بدون + أو أصفار بالبداية. مثال: 963933123456');
  }
  q.run("UPDATE tenants SET wa_provider = 'qr' WHERE id = ?", ctx.tenant.id);
  try { return await qrConn.start(ctx.tenant.id, { pairPhone: mode === 'pair' ? pairNum : null }); }
  catch (e) { throw new HttpError(503, e.message); }
});

r.post('/api/wa/logout', async ctx => { owner(ctx); await qrConn.logout(ctx.tenant.id); return { ok: true }; });

r.put('/api/wa/cloud', async ctx => {
  owner(ctx);
  need(getPlan(ctx.tenant).allow_cloud_api, 403, 'الربط الرسمي مو متاح بخطتك');
  const { phone_number_id, token, app_secret } = ctx.body;
  need(/^\d{5,25}$/.test(String(phone_number_id || '')), 400, 'Phone Number ID لازم يكون أرقام');
  const tokenEnc = token ? encrypt(String(token).trim()) : ctx.tenant.cloud_token_enc;
  need(tokenEnc, 400, 'حط التوكن (Access Token)');
  const test = { ...ctx.tenant, cloud_phone_number_id: String(phone_number_id), cloud_token_enc: tokenEnc };
  let info;
  try { info = await cloud.verifyCredentials(test); } catch (e) { throw new HttpError(400, 'ميتا رفضت البيانات: ' + e.message); }
  const s = { ...ctx.tenant.settings };
  if (app_secret) s.cloud_app_secret_enc = encrypt(String(app_secret).trim());
  qrConn.stop(ctx.tenant.id);
  q.run("UPDATE tenants SET wa_provider = 'cloud', cloud_phone_number_id = ?, cloud_token_enc = ?, wa_phone = ?, settings = ? WHERE id = ?",
    String(phone_number_id), tokenEnc, String(info.display_phone_number || '').replace(/\D/g, '') || null, JSON.stringify(s), ctx.tenant.id);
  return { ok: true, info };
});

r.post('/api/wa/provider', ctx => {
  owner(ctx);
  const p = ctx.body.provider;
  need(['qr', 'cloud'].includes(p), 400, 'اختيار غير صحيح');
  q.run('UPDATE tenants SET wa_provider = ? WHERE id = ?', p, ctx.tenant.id);
  if (p === 'cloud') qrConn.stop(ctx.tenant.id);
  return { ok: true };
});

// ===== المنتجات =====
r.get('/api/products', ctx => {
  auth(ctx);
  const s = String(ctx.query.q || '').trim();
  const page = Math.max(1, parseInt(ctx.query.page, 10) || 1), per = 50;
  const where = s ? "AND (name LIKE ? OR category LIKE ? OR sku LIKE ?)" : '';
  const args = s ? [`%${s}%`, `%${s}%`, `%${s}%`] : [];
  const total = q.get(`SELECT COUNT(*) n FROM products WHERE tenant_id = ? ${where}`, ctx.tenant.id, ...args).n;
  const items = q.all(`SELECT * FROM products WHERE tenant_id = ? ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ctx.tenant.id, ...args, per, (page - 1) * per);
  return { total, page, per, items };
});

r.post('/api/products', ctx => {
  owner(ctx);
  const plan = getPlan(ctx.tenant);
  const n = q.get('SELECT COUNT(*) n FROM products WHERE tenant_id = ?', ctx.tenant.id).n;
  need(n < plan.max_products, 403, `وصلت للحد الأقصى للمنتجات بخطتك (${plan.max_products})`);
  try { return { id: saveProduct(ctx.tenant.id, ctx.body) }; } catch (e) { throw new HttpError(400, e.message); }
});

r.put('/api/products/:id', ctx => {
  owner(ctx);
  try { return { id: saveProduct(ctx.tenant.id, ctx.body, Number(ctx.params.id)) }; } catch (e) { throw new HttpError(400, e.message); }
});

r.del('/api/products/:id', ctx => {
  owner(ctx);
  q.run('DELETE FROM products WHERE id = ? AND tenant_id = ?', Number(ctx.params.id), ctx.tenant.id);
  return { ok: true };
});

r.del('/api/products', ctx => {
  owner(ctx);
  need(ctx.query.confirm === 'yes', 400, 'تأكيد مطلوب');
  q.run('DELETE FROM products WHERE tenant_id = ?', ctx.tenant.id);
  return { ok: true };
});

r.post('/api/products/import', async ctx => {
  owner(ctx);
  let { csv, json, url, replace } = ctx.body;
  let rows;
  if (url) {
    const res = await safeFetch(url);
    const text = await res.text();
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json') || /^\s*[[{]/.test(text)) json = text; else csv = text;
  }
  if (json) { try { rows = typeof json === 'string' ? JSON.parse(json) : json; } catch { throw new HttpError(400, 'ملف JSON غير صالح'); } }
  else if (csv) rows = parseCSV(String(csv));
  need(rows, 400, 'ما في بيانات');
  return importProducts(ctx.tenant.id, rows, { replace: !!replace, maxProducts: getPlan(ctx.tenant).max_products });
});

// تعديل صورة منتج بالذكاء قبل ما تنحفظ (من صفحة المنتجات)
r.post('/api/images/edit', async ctx => {
  owner(ctx);
  const { url, request } = ctx.body;
  need(request && String(request).trim(), 400, 'اكتب شو بدك تعدّل');
  need(url, 400, 'ارفع صورة أول');
  let local = String(url);
  if (/^https?:\/\//.test(local)) { // صورة من رابط: منحفظها عنا أول
    const res = await fetch(local, { signal: AbortSignal.timeout(20000) }).catch(() => null);
    need(res && res.ok, 400, 'ما قدرت جيب الصورة من الرابط');
    const buf = Buffer.from(await res.arrayBuffer());
    need(buf.length < 10 * 1024 * 1024, 400, 'الصورة كبيرة كتير');
    const name = `${ctx.tenant.id}-src-${crypto.randomBytes(8).toString('hex')}.jpg`;
    fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), buf);
    local = `/uploads/${name}`;
  }
  need(local.startsWith('/uploads/') && fs.existsSync(path.join(DATA_DIR, 'uploads', path.basename(local))), 400, 'الصورة مو موجودة');
  const { editImage } = await import('./imageedit.js');
  try { const r = await editImage(ctx.tenant, local, clamp(String(request), 500)); return { url: r.url, by: r.by }; }
  catch (e) { throw new HttpError(400, e.message); }
});

// ===== تعديل جماعي =====
r.get('/api/batch', async ctx => {
  auth(ctx);
  const jobs = q.all('SELECT * FROM edit_jobs WHERE tenant_id = ? ORDER BY id DESC LIMIT 300', ctx.tenant.id);
  const { comfyHasQwen } = await import('./imageedit.js');
  const { brandAssets } = await import('./brand.js');
  return { jobs, hq: await comfyHasQwen(), brand: brandAssets(ctx.tenant.id) };
});
r.post('/api/batch', ctx => {
  owner(ctx);
  const { urls, request, quality, brand, brand_logo } = ctx.body;
  need(Array.isArray(urls) && urls.length, 400, 'ارفع صور أول');
  need((request && String(request).trim()) || brand, 400, 'اكتب شو بدك يعدّل');
  const ok = urls.filter(u => typeof u === 'string' && u.startsWith('/uploads/') && fs.existsSync(path.join(DATA_DIR, 'uploads', path.basename(u)))).slice(0, 200);
  need(ok.length, 400, 'الصور مو موجودة');
  const bl = typeof brand_logo === 'string' && brand_logo.startsWith('/uploads/') ? brand_logo : null;
  for (const u of ok) q.run('INSERT INTO edit_jobs (tenant_id, src_url, request, quality, brand, brand_logo) VALUES (?, ?, ?, ?, ?, ?)', ctx.tenant.id, u, clamp(String(request || ''), 500), ['high', 'gemini'].includes(quality) ? quality : 'fast', brand ? 1 : 0, bl);
  return { ok: true, added: ok.length };
});
r.del('/api/batch/:id', ctx => {
  owner(ctx);
  q.run("DELETE FROM edit_jobs WHERE id = ? AND tenant_id = ? AND status != 'working'", Number(ctx.params.id), ctx.tenant.id);
  return { ok: true };
});
r.post('/api/brand', async ctx => {
  owner(ctx);
  const { kind, data } = ctx.body;
  need(['logo', 'mark'].includes(kind), 400, 'نوع غلط');
  const m = String(data || '').match(/^data:image\/[a-z+]+;base64,(.+)$/);
  need(m, 400, 'ارفع صورة');
  const { saveBrandAsset } = await import('./brand.js');
  await saveBrandAsset(ctx.tenant.id, kind, Buffer.from(m[1], 'base64'));
  return { ok: true };
});
r.get('/api/brand/:kind', ctx => {
  auth(ctx);
  const f = path.join(DATA_DIR, 'brand', String(ctx.tenant.id), ctx.params.kind === 'mark' ? 'mark.png' : 'logo.png');
  need(fs.existsSync(f), 404, 'غير موجود');
  return { data: 'data:image/png;base64,' + fs.readFileSync(f).toString('base64') };
});
// منتجات Gemini: كل منتج كذا صورة × البرومبتات الثابتة
r.post('/api/batch/products', ctx => {
  owner(ctx);
  const { products, prompts } = ctx.body;
  need(Array.isArray(products) && products.length, 400, 'ضيف منتج واحد على الأقل');
  const ps = (Array.isArray(prompts) ? prompts : []).slice(0, 3).map(x => clamp(String(x || ''), 4000));
  need(ps.some(x => x.trim()), 400, 'اكتب برومبت واحد على الأقل');
  const t = ctx.tenant; const st = { ...t.settings, gemini_prompts: [ps[0] || '', ps[1] || '', ps[2] || ''] };
  q.run('UPDATE tenants SET settings = ? WHERE id = ?', JSON.stringify(st), t.id);
  let added = 0;
  for (const pr of products.slice(0, 100)) {
    const urls = (pr.urls || []).filter(u => typeof u === 'string' && u.startsWith('/uploads/') && fs.existsSync(path.join(DATA_DIR, 'uploads', path.basename(u)))).slice(0, 8);
    if (!urls.length) continue;
    ps.forEach((prompt, i) => { if (!prompt.trim()) return;
      q.run("INSERT INTO edit_jobs (tenant_id, src_url, src_urls, product_name, prompt_no, request, quality) VALUES (?, ?, ?, ?, ?, ?, 'gemini')", t.id, urls[0], JSON.stringify(urls), clamp(String(pr.name || 'منتج'), 80), i + 1, prompt);
      added++; });
  }
  need(added, 400, 'ما في صور');
  return { ok: true, added };
});
r.post('/api/batch/prompts', ctx => {
  owner(ctx);
  const ps = (ctx.body.prompts || []).slice(0, 3).map(x => clamp(String(x || ''), 4000));
  q.run('UPDATE tenants SET settings = ? WHERE id = ?', JSON.stringify({ ...ctx.tenant.settings, gemini_prompts: [ps[0] || '', ps[1] || '', ps[2] || ''] }), ctx.tenant.id);
  return { ok: true };
});

// ===== استوديو Gemini: متل موقع Gemini — الصور والكلام بينبعتوا متل ما هنن بدون أي إضافة =====
r.post('/api/studio', async ctx => {
  owner(ctx);
  const { history = [], text = '', images = [], aspect = '', size = '2K', model = '' } = ctx.body;
  need(String(text).trim() || images.length, 400, 'اكتب شي أو ارفع صورة');
  const { resolveAI } = await import('./ai.js');
  const imgPart = u => { const f = path.join(DATA_DIR, 'uploads', path.basename(String(u))); if (!fs.existsSync(f)) return null;
    return { inline_data: { mime_type: f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg', data: fs.readFileSync(f).toString('base64') } }; };
  const turn = (role, t, imgs) => ({ role, parts: [...(imgs || []).map(imgPart).filter(Boolean), ...(t ? [{ text: String(t) }] : [])] });
  const contents = [...history.slice(-8).map(h => turn(h.role === 'model' ? 'model' : 'user', h.text, h.images)), turn('user', text, images)].filter(c => c.parts.length);
  const mdl = /^[\w.-]+$/.test(model) ? model : 'gemini-3-pro-image';
  const cfg = { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { ...(aspect ? { aspectRatio: aspect } : {}), imageSize: ['1K', '2K', '4K'].includes(size) ? size : '2K' } };
  const keys = resolveAI(ctx.tenant).filter(p => p.kind === 'gemini' && p.key);
  const paid = p => /مدفوع|paid|pro/i.test(p.name || '');
  let lastErr = 'ما في مفتاح Gemini مدفوع بصفحة الذكاء الاصطناعي';
  for (const p of [...keys.filter(paid), ...keys.filter(x => !paid(x))]) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key }, body: JSON.stringify({ contents, generationConfig: cfg }), signal: AbortSignal.timeout(240_000) }).catch(e => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { lastErr = d?.error?.message || `Gemini (${res.status})`; continue; }
    const parts = d?.candidates?.[0]?.content?.parts || [];
    const out = [], dir = path.join(DATA_DIR, 'exports', 'studio'); fs.mkdirSync(dir, { recursive: true });
    for (const x of parts) { const b64 = x.inline_data?.data || x.inlineData?.data; if (!b64 || x.thought) continue;
      const name = `${ctx.tenant.id}-studio-${crypto.randomBytes(6).toString('hex')}.png`;
      fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), Buffer.from(b64, 'base64'));
      fs.copyFileSync(path.join(DATA_DIR, 'uploads', name), path.join(dir, name)); out.push(`/uploads/${name}`); }
    const reply = parts.filter(x => x.text && !x.thought).map(x => x.text).join('\n').trim();
    if (!out.length && !reply) { lastErr = 'Gemini ما رجّع شي (' + (d?.candidates?.[0]?.finishReason || d?.promptFeedback?.blockReason || '') + ')'; continue; }
    return { images: out, text: reply, by: p.name };
  }
  throw new HttpError(400, /quota|billing|exceeded/i.test(lastErr) ? 'Gemini رفض: لازم مفتاح فيه دفع مفعّل' : lastErr);
});
r.get('/api/studio/brand', ctx => {
  auth(ctx);
  const dir = path.join(DATA_DIR, 'brand', String(ctx.tenant.id)); const out = [];
  for (const [f, label] of [['logo.png', 'لوغو المتجر'], ['mark-src.png', 'الدراغون']]) {
    const src = path.join(dir, f); if (!fs.existsSync(src)) continue;
    const name = `${ctx.tenant.id}-brand-${f}`; const dst = path.join(DATA_DIR, 'uploads', name);
    if (!fs.existsSync(dst) || fs.statSync(dst).mtimeMs < fs.statSync(src).mtimeMs) fs.copyFileSync(src, dst);
    out.push({ url: `/uploads/${name}`, label });
  }
  return out;
});

// ===== الرابط العام (workers.dev) =====
r.get('/api/link', async ctx => {
  sup(ctx);
  const T = await import('./tunnel.js');
  const c = getSetting('public_link', {});
  return { enabled: !!c.enabled, account: c.account || '', name: c.name || 'kfastai', hasToken: !!c.token_enc, last_url: c.last_url || '', status: T.status };
});
r.put('/api/link', async ctx => {
  sup(ctx);
  const T = await import('./tunnel.js');
  const b = ctx.body, c = getSetting('public_link', {});
  const n = { ...c };
  if (b.account !== undefined) n.account = String(b.account).trim().replace(/[^a-f0-9]/gi, '');
  if (b.name !== undefined) n.name = String(b.name).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'kfastai';
  if (b.token) n.token_enc = encrypt(String(b.token).trim());
  if (b.enabled !== undefined) n.enabled = !!b.enabled;
  setSetting('public_link', n);
  if (n.enabled) { T.status.target = null; T.startTunnel(config.port); } else T.stopTunnel();
  return { ok: true };
});

// ===== التعديل التلقائي من مجلد =====
r.get('/api/auto', async ctx => {
  auth(ctx);
  const A = await import('./autofolder.js');
  const cfg = A.getAuto(ctx.tenant.id);
  const prods = A.listProducts(cfg.folder, ctx.tenant.id);
  const flat = A.flatImages(cfg.folder).length;
  const items = q.all('SELECT * FROM auto_items WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 500', ctx.tenant.id);
  return { cfg: { ...cfg, groups: undefined }, total: prods.length, flat, groups: prods.map(p => ({ name: p.name, n: p.files.length })), folderOk: !!cfg.folder && fs.existsSync(cfg.folder), items };
});
r.put('/api/auto', async ctx => {
  owner(ctx);
  const A = await import('./autofolder.js');
  const b = ctx.body, patch = {};
  for (const k of ['folder', 'out', 'prompt', 'model', 'size', 'aspect']) if (b[k] !== undefined) patch[k] = clamp(String(b[k]).trim(), 6000);
  if (b.brand !== undefined) patch.brand = !!b.brand;
  return { cfg: A.setAuto(ctx.tenant.id, patch) };
});
r.post('/api/auto/:action', async ctx => {
  owner(ctx);
  const A = await import('./autofolder.js'); const tid = ctx.tenant.id; const a = ctx.params.action;
  if (a === 'start') { const c = A.getAuto(tid); need(c.folder && fs.existsSync(c.folder), 400, 'المجلد مو موجود — تأكد من المسار'); A.setAuto(tid, { running: true, stopReason: null }); }
  else if (a === 'stop') A.setAuto(tid, { running: false, stopReason: 'وقّفتها انت' });
  else if (a === 'retry') q.run("DELETE FROM auto_items WHERE tenant_id = ? AND status = 'error'", tid);
  else if (a === 'redo') q.run('DELETE FROM auto_items WHERE tenant_id = ? AND product = ?', tid, String(ctx.body.product || ''));
  else if (a === 'reset') q.run('DELETE FROM auto_items WHERE tenant_id = ?', tid);
  else if (a === 'regroup') A.setAuto(tid, { groups: null });
  else need(false, 404, 'غير موجود');
  return { ok: true };
});

r.post('/api/batch/clear', ctx => {
  owner(ctx);
  q.run("DELETE FROM edit_jobs WHERE tenant_id = ? AND status IN ('done','error')", ctx.tenant.id);
  return { ok: true };
});
r.post('/api/batch/retry', ctx => {
  owner(ctx);
  q.run("UPDATE edit_jobs SET status = 'queued', error = NULL WHERE tenant_id = ? AND status = 'error'", ctx.tenant.id);
  return { ok: true };
});

r.post('/api/upload', ctx => {
  owner(ctx);
  const { data } = ctx.body;
  const m = String(data || '').match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
  need(m, 400, 'لازم تكون صورة (png, jpg, webp)');
  const buf = Buffer.from(m[2], 'base64');
  need(buf.length < 5 * 1024 * 1024, 400, 'الصورة أكبر من 5 ميغا');
  const name = `${ctx.tenant.id}-${crypto.randomBytes(8).toString('hex')}.${m[1].replace('jpeg', 'jpg')}`;
  fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), buf);
  return { url: `/uploads/${name}` };
});

// إضافة منتج من صورة + وصف بالصوت (أو مكتوب)
function saveDataImage(tenantId, data) {
  const m = String(data || '').match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  need(buf.length < 5 * 1024 * 1024, 400, 'الصورة أكبر من 5 ميغا');
  const name = `${tenantId}-${crypto.randomBytes(8).toString('hex')}.${m[1].replace('jpeg', 'jpg')}`;
  fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), buf);
  return `/uploads/${name}`;
}

r.post('/api/products/voice', async ctx => {
  owner(ctx);
  const t = ctx.tenant;
  const plan = getPlan(t);
  const n = q.get('SELECT COUNT(*) n FROM products WHERE tenant_id = ?', t.id).n;
  need(n < plan.max_products, 403, `وصلت للحد الأقصى للمنتجات بخطتك (${plan.max_products})`);
  const allow = aiAllowance(t);
  need(allow.ok, 429, `وصلت للحد اليومي للذكاء الاصطناعي (${allow.limit}). ضيف مفتاحك الخاص أو ارجع بكرا.`);
  const { image, audio, text, product_id, lang } = ctx.body;
  let transcript = String(text || '').trim();
  if (!transcript) {
    const m = String(audio || '').match(/^data:([^;,]+(?:;[^;,]+)*);base64,(.+)$/);
    need(m, 400, 'سجّل صوت أو اكتب وصف المنتج');
    const buf = Buffer.from(m[2], 'base64');
    need(buf.length > 1500, 400, 'التسجيل قصير كتير، احكي اسم المنتج وسعره');
    need(buf.length < 10 * 1024 * 1024, 400, 'التسجيل طويل كتير');
    try { transcript = await transcribe(t, buf, m[1], lang === 'en' ? 'en' : 'ar'); } catch (e) { throw new HttpError(400, e.message); }
    need(transcript, 400, 'ما سمعت شي واضح. جرّب تحكي أقرب للمايك.');
  }
  let fields;
  try { fields = await extractProduct(t, clamp(transcript, 2000)); } catch (e) { throw new HttpError(400, e.message); }
  bumpUsage(t.id, 'ai_replies');
  const imageUrl = image ? saveDataImage(t.id, image) : null;
  const data = {
    name: fields.name, price: fields.price, sale_price: fields.sale_price, currency: fields.currency || null,
    category: fields.category, options: fields.options, stock: fields.stock, description: fields.description, tags: fields.tags,
    ...(imageUrl ? { image_url: imageUrl } : {})
  };
  let id;
  try { id = saveProduct(t.id, data, product_id ? Number(product_id) : null); } catch (e) { throw new HttpError(400, e.message); }
  return { transcript, product: q.get('SELECT * FROM products WHERE id = ?', id) };
});

// ===== تعليم الوكيل من محادثاتك =====
function readChatFiles(files) {
  need(Array.isArray(files) && files.length, 400, 'اختار ملف محادثة واحد على الأقل');
  need(files.length <= 200, 400, 'أقصى شي 200 ملف بالمرة');
  const chats = [];
  for (const f of files) {
    const data = String(f.data || '');
    if (data.startsWith('data:')) {
      const buf = Buffer.from(data.split(',')[1] || '', 'base64');
      if (buf.readUInt32LE?.(0) === 0x04034b50) for (const t of unzipTexts(buf)) chats.push({ name: f.name + ' / ' + t.name, msgs: parseExport(t.text) });
      else chats.push({ name: f.name, msgs: parseExport(buf.toString('utf8')) });
    } else chats.push({ name: f.name, msgs: parseExport(data) });
  }
  return chats.filter(c => c.msgs.length);
}

r.post('/api/style/parse', ctx => {
  owner(ctx);
  const chats = readChatFiles(ctx.body.files);
  need(chats.length, 400, 'ما لقينا رسائل بالملفات. تأكد إنها ملفات تصدير محادثة من واتساب (.txt أو .zip)');
  const people = new Map();
  for (const c of chats) {
    const seen = new Set();
    for (const m of c.msgs) {
      const p = people.get(m.name) || { name: m.name, files: 0, messages: 0 };
      p.messages++;
      if (!seen.has(m.name)) { p.files++; seen.add(m.name); }
      people.set(m.name, p);
    }
  }
  const list = [...people.values()].sort((a, b) => b.files - a.files || b.messages - a.messages).slice(0, 30);
  return { chats: chats.length, messages: chats.reduce((s, c) => s + c.msgs.length, 0), participants: list, guess: list[0]?.name || null };
});

r.post('/api/style/import', ctx => {
  owner(ctx);
  const me = String(ctx.body.me || '').trim();
  need(me, 400, 'اختار مين أنت بالمحادثات');
  const chats = readChatFiles(ctx.body.files);
  let pairs = [];
  for (const c of chats) {
    if (!c.msgs.some(m => m.name === me)) continue;
    pairs = pairs.concat(buildPairs(c.msgs.map(m => ({ me: m.name === me, text: m.text }))));
  }
  need(pairs.length, 400, 'ما لقينا ردود إلك على زبائن بهالملفات. تأكد إنك اخترت اسمك الصح.');
  const added = savePairs(ctx.tenant.id, pairs, 'import');
  return { found: pairs.length, added, stats: styleStats(ctx.tenant.id) };
});

r.get('/api/style', ctx => { auth(ctx); return styleStats(ctx.tenant.id); });

r.post('/api/style/analyze', async ctx => {
  owner(ctx);
  need(rateLimit('style:' + ctx.tenant.id, 10, 3600_000), 429, 'جرّب بعد شوي');
  let profile;
  try { profile = await analyzeStyle(ctx.tenant); } catch (e) { throw new HttpError(400, e.message); }
  const s = { ...ctx.tenant.settings, style_profile: profile };
  q.run('UPDATE tenants SET settings = ? WHERE id = ?', JSON.stringify(s), ctx.tenant.id);
  return { profile };
});

r.post('/api/style/clean', ctx => {
  owner(ctx);
  return { removed: cleanExamples(ctx.tenant.id), stats: styleStats(ctx.tenant.id) };
});

// شخصية المجيب وتعليمات صاحب المتجر: بتنحفظ، والمجيب بيأكّد إنو فهم
r.post('/api/persona', async ctx => {
  owner(ctx);
  const text = clamp(String(ctx.body.text || ''), 6000);
  const s = { ...ctx.tenant.settings, extra_instructions: text };
  q.run('UPDATE tenants SET settings = ? WHERE id = ?', JSON.stringify(s), ctx.tenant.id);
  if (!text.trim()) return { ok: true, reply: 'تمام، مسحت التعليمات ورجعت لأسلوبي العادي 👌' };
  let reply = 'تمام فهمت 👌 انحفظت تعليماتك ورح امشي عليها من هلق.';
  try {
    const sys = `إنت مجيب واتساب لمتجر. صاحب المتجر كتبلك تعليمات عن شخصيتك وكيف تتعامل مع الزباين.
جاوبو باللهجة السورية: ابدأ بـ «تمام فهمت 👌» وبعدين لخّصلو بـ 3 لـ 6 نقاط قصيرة شو رح تعمل بالزبط حسب كلامو. ما تنصحو وما تناقشو. أرجع JSON: {"reply":"..."}`;
    const { text: out } = await chat(resolveAI(ctx.tenant, { prefer: 'light' }), { system: sys, messages: [{ role: 'user', content: text }], json: true, temperature: 0.3, maxTokens: 500 });
    const d = parseJSON(out);
    if (d && typeof d.reply === 'string' && d.reply.trim()) reply = clamp(d.reply.trim(), 1500);
  } catch (e) { console.error('[persona]', e.message); }
  return { ok: true, reply };
});

r.del('/api/style', ctx => {
  owner(ctx);
  need(ctx.query.confirm === 'yes', 400, 'تأكيد مطلوب');
  clearExamples(ctx.tenant.id);
  return { ok: true };
});

// ===== المحادثات =====
r.get('/api/contacts', ctx => {
  auth(ctx);
  const f = ctx.query.filter;
  const s = String(ctx.query.q || '').trim();
  let where = '';
  if (f === 'human') where = 'AND needs_human = 1';
  else if (f === 'unread') where = 'AND unread > 0';
  else if (f === 'paused') where = 'AND bot_paused_until > unixepoch()';
  const args = s ? [`%${s}%`, `%${s}%`] : [];
  if (s) where += ' AND (name LIKE ? OR phone LIKE ?)';
  return q.all(`SELECT * FROM contacts WHERE tenant_id = ? ${where} ORDER BY last_at DESC LIMIT 200`, ctx.tenant.id, ...args);
});

r.get('/api/contacts/:id/messages', ctx => {
  auth(ctx);
  const c = q.get('SELECT * FROM contacts WHERE id = ? AND tenant_id = ?', Number(ctx.params.id), ctx.tenant.id);
  need(c, 404, 'غير موجود');
  q.run('UPDATE contacts SET unread = 0 WHERE id = ?', c.id);
  const before = Number(ctx.query.before) || 1e15;
  const msgs = q.all('SELECT * FROM (SELECT * FROM messages WHERE contact_id = ? AND id < ? ORDER BY id DESC LIMIT 100) ORDER BY id', c.id, before);
  const orders = q.all('SELECT * FROM orders WHERE contact_id = ? ORDER BY id DESC LIMIT 5', c.id);
  return { contact: { ...c, unread: 0 }, messages: msgs, orders };
});

r.post('/api/contacts/:id/send', async ctx => {
  auth(ctx);
  const text = String(ctx.body.text || '').trim();
  need(text, 400, 'اكتب رسالة');
  try { return await sendManual(ctx.tenant, Number(ctx.params.id), clamp(text, 4000)); }
  catch (e) { throw new HttpError(400, e.message); }
});
r.post('/api/contacts/:id/resume', ctx => { auth(ctx); resumeBot(ctx.tenant.id, Number(ctx.params.id)); return { ok: true }; });
r.post('/api/contacts/:id/pause', ctx => { auth(ctx); pauseBot(ctx.tenant.id, Number(ctx.params.id)); return { ok: true }; });
r.put('/api/contacts/:id', ctx => {
  auth(ctx);
  const { name, notes } = ctx.body;
  q.run('UPDATE contacts SET name = COALESCE(?, name), notes = COALESCE(?, notes) WHERE id = ? AND tenant_id = ?',
    name != null ? clamp(name, 80) : null, notes != null ? clamp(notes, 1000) : null, Number(ctx.params.id), ctx.tenant.id);
  return { ok: true };
});

// ===== الطلبات =====
r.get('/api/orders', ctx => {
  auth(ctx);
  const st = ctx.query.status;
  const rows = st
    ? q.all('SELECT * FROM orders WHERE tenant_id = ? AND status = ? ORDER BY id DESC LIMIT 300', ctx.tenant.id, st)
    : q.all('SELECT * FROM orders WHERE tenant_id = ? ORDER BY id DESC LIMIT 300', ctx.tenant.id);
  return rows.map(o => ({ ...o, items: safeJSON(o.items, []) }));
});
r.put('/api/orders/:id', ctx => {
  auth(ctx);
  const { status, notes, address } = ctx.body;
  if (status) need(['new', 'confirmed', 'shipped', 'done', 'cancelled'].includes(status), 400, 'حالة غير صحيحة');
  q.run('UPDATE orders SET status = COALESCE(?, status), notes = COALESCE(?, notes), address = COALESCE(?, address) WHERE id = ? AND tenant_id = ?',
    status || null, notes ?? null, address ?? null, Number(ctx.params.id), ctx.tenant.id);
  return { ok: true };
});

// ===== الإحصائيات =====
r.get('/api/stats', ctx => {
  auth(ctx);
  const days = q.all("SELECT * FROM usage WHERE tenant_id = ? AND day >= date('now', '-29 days') ORDER BY day", ctx.tenant.id);
  const totals = q.get(`SELECT COUNT(*) contacts FROM contacts WHERE tenant_id = ?`, ctx.tenant.id);
  const orders = q.get(`SELECT COUNT(*) n, COALESCE(SUM(total),0) revenue FROM orders WHERE tenant_id = ? AND status != 'cancelled' AND created_at > unixepoch() - 30*86400`, ctx.tenant.id);
  return { days, contacts: totals.contacts, orders30: orders.n, revenue30: orders.revenue };
});

// ===== تجربة ضغط: 10 زباين بنفس اللحظة (ما بينبعت شي على واتساب) =====
const STRESS_MSGS = ['مرحبا، عندكن أحذية رياضية؟', 'شو أسعار الشنط؟', 'بدي كندرة نايك نمرة 43', 'في توصيل لحلب؟', 'شو أحسن شي عندكن للجري؟',
  'عندكن ترينغات أديداس؟', 'قديش سعر الطاقية؟', 'بدي هدية لابني عمره 12', 'وين محلكن؟', 'في خصم إذا أخدت قطعتين؟'];
r.post('/api/stress', async ctx => {
  sup(ctx);
  const n = Math.min(20, Math.max(1, Number(ctx.body.n) || 10));
  const t0 = Date.now();
  const runs = await Promise.all(Array.from({ length: n }, async (_, i) => {
    const msg = STRESS_MSGS[i % STRESS_MSGS.length], s0 = Date.now();
    try { const r = await playground(ctx.tenant, [{ role: 'user', content: msg }]); return { msg, ok: true, ms: Date.now() - s0, via: r.via || '', reply: r.reply }; }
    catch (e) { return { msg, ok: false, ms: Date.now() - s0, error: e.message }; }
  }));
  return { n, total_ms: Date.now() - t0, runs };
});

// ===== ساحة التجربة =====
r.post('/api/playground', async ctx => {
  auth(ctx);
  const msgs = Array.isArray(ctx.body.messages) ? ctx.body.messages : [];
  need(msgs.length && msgs[msgs.length - 1].role === 'user', 400, 'اكتب رسالة');
  need(rateLimit('pg:' + ctx.tenant.id, 30, 60_000), 429, 'شوي شوي 😅');
  try { return await playground(ctx.tenant, msgs); } catch (e) { throw new HttpError(400, e.message); }
});

// ===== الاشتراك والدفع (يدوي حالياً، جاهز لبوابة دفع لاحقاً) =====
r.get('/api/billing', ctx => {
  auth(ctx);
  const plans = q.all('SELECT * FROM plans WHERE is_public = 1 ORDER BY sort').map(p => ({ ...p, features: safeJSON(p.features, []),
    prices: Object.fromEntries(PERIODS.map(m => [m, priceFor(p.id, m)])) }));
  return {
    plans,
    current: getPlan(ctx.tenant).id,
    expires_at: ctx.tenant.plan_expires_at,
    expired: subscriptionExpired(ctx.tenant),
    instructions: getSetting('payment_instructions', ''),
    shamcash_number: getSetting('shamcash_number', ''),
    requests: q.all('SELECT * FROM payment_requests WHERE tenant_id = ? ORDER BY id DESC LIMIT 20', ctx.tenant.id)
  };
});
r.post('/api/billing/request', ctx => {
  owner(ctx);
  const { plan_id, method, receipt, phone } = ctx.body;
  const months = parseInt(ctx.body.months, 10);
  need(plan_id !== 'free' && q.get('SELECT 1 FROM plans WHERE id = ? AND is_public = 1', plan_id), 400, 'خطة غير موجودة');
  need(PERIODS.includes(months), 400, 'المدة غير صحيحة');
  need(['shamcash', 'hand'].includes(method), 400, 'اختار طريقة الدفع');
  need(rateLimit('pay:' + ctx.tenant.id, 5, 3600_000), 429, 'استنى شوي');
  let receiptUrl = null, ph = null, status = 'pending';
  if (method === 'shamcash') {
    const m = String(receipt || '').match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
    need(m, 400, 'ارفع صورة الإيصال');
    const buf = Buffer.from(m[2], 'base64');
    need(buf.length < 5 * 1024 * 1024, 400, 'الصورة أكبر من 5 ميغا');
    const name = `${ctx.tenant.id}-rcpt-${crypto.randomBytes(8).toString('hex')}.${m[1].replace('jpeg', 'jpg')}`;
    fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), buf);
    receiptUrl = `/uploads/${name}`;
  } else {
    ph = String(phone || '').replace(/[^\d+]/g, '');
    need(ph.replace(/\D/g, '').length >= 8, 400, 'اكتب رقم موبايلك');
    status = 'awaiting_delivery';
  }
  q.run('INSERT INTO payment_requests (tenant_id, plan_id, months, method, status, amount, receipt, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ctx.tenant.id, plan_id, months, method === 'shamcash' ? 'شام كاش' : 'تسليم باليد بقدسيا', status, priceFor(plan_id, months), receiptUrl, ph);
  return { ok: true };
});

// ===== مدير المنصة =====
// ===== مجيب المسنجر (لمدير المنصة بس) =====
r.get('/api/messenger', async ctx => {
  sup(ctx); const M = await import('./messenger.js');
  return { config: M.getConfig(), log: M.getLog().slice(-60).reverse(), seen: M.extSeen() };
});
r.put('/api/messenger', async ctx => { sup(ctx); const M = await import('./messenger.js'); return { config: M.saveConfig(ctx.body || {}) }; });
r.post('/api/messenger/test', async ctx => {
  sup(ctx); const M = await import('./messenger.js'); const b = ctx.body || {};
  return M.makeReply({ name: String(b.name || ''), messages: b.messages, cfg: b.cfg });
});
r.post('/api/messenger/prompt', async ctx => {
  sup(ctx); const M = await import('./messenger.js'); const b = ctx.body || {};
  const c = M.clean(b.cfg || {}), rule = M.personRule(c, b.name);
  return { prompt: M.buildPrompt(c, b.name, M.isIgnore(rule) ? '' : rule) };
});
r.post('/api/messenger/clear-log', async ctx => { sup(ctx); const M = await import('./messenger.js'); M.clearLog(); return { ok: true }; });

r.get('/api/admin/overview', ctx => {
  sup(ctx);
  return {
    tenants: q.get('SELECT COUNT(*) n FROM tenants').n,
    active_today: q.get("SELECT COUNT(DISTINCT tenant_id) n FROM usage WHERE day = date('now')").n,
    ai_today: q.get("SELECT COALESCE(SUM(ai_replies),0) n FROM usage WHERE day = date('now')").n,
    msgs_today: q.get("SELECT COALESCE(SUM(msgs_in + msgs_out),0) n FROM usage WHERE day = date('now')").n,
    trial_alerts: q.get("SELECT COUNT(*) n FROM trial_alerts WHERE status = 'open'").n,
    pending_payments: q.get("SELECT COUNT(*) n FROM payment_requests WHERE status IN ('pending','awaiting_delivery')").n,
    by_plan: q.all('SELECT plan_id, COUNT(*) n FROM tenants GROUP BY plan_id')
  };
});

r.get('/api/admin/tenants', ctx => {
  sup(ctx);
  return q.all(`SELECT t.id, t.name, t.plan_id, t.plan_expires_at, t.status, t.wa_provider, t.wa_phone, t.ai_provider, t.created_at,
      (SELECT email FROM users WHERE tenant_id = t.id ORDER BY id LIMIT 1) email,
      (SELECT COUNT(*) FROM products WHERE tenant_id = t.id) products,
      (SELECT COALESCE(SUM(ai_replies),0) FROM usage WHERE tenant_id = t.id AND day >= date('now','-6 days')) ai_7d
    FROM tenants t ORDER BY t.id DESC`).map(t => ({ ...t, wa_status: wa.status(getTenant(t.id)).status }));
});

r.put('/api/admin/tenants/:id', ctx => {
  sup(ctx);
  const id = Number(ctx.params.id);
  const { plan_id, add_months, plan_expires_at, status } = ctx.body;
  const t = getTenant(id);
  need(t, 404, 'غير موجود');
  if (plan_id) need(q.get('SELECT 1 FROM plans WHERE id = ?', plan_id), 400, 'خطة غير موجودة');
  let exp = plan_expires_at !== undefined ? plan_expires_at : t.plan_expires_at;
  if (add_months) exp = Math.max(exp || 0, Math.floor(Date.now() / 1000)) + Number(add_months) * 30 * 86400;
  q.run('UPDATE tenants SET plan_id = COALESCE(?, plan_id), plan_expires_at = ?, status = COALESCE(?, status) WHERE id = ?',
    plan_id || null, exp || null, ['active', 'suspended'].includes(status) ? status : null, id);
  if (status === 'suspended') qrConn.stop(id);
  return { ok: true };
});

r.get('/api/admin/settings', ctx => {
  sup(ctx);
  return {
    brand: brand(),
    registration_open: getSetting('registration_open', true),
    payment_instructions: getSetting('payment_instructions', ''),
    shamcash_number: getSetting('shamcash_number', ''),
    trial: getSetting('trial', { value: 3, unit: 'days' }),
  };
});

r.put('/api/admin/settings', ctx => {
  sup(ctx);
  const { brand: b, registration_open, payment_instructions, shamcash_number, trial } = ctx.body;
  if (b) setSetting('brand', { name: clamp(b.name || 'ردّاد', 40), tagline: clamp(b.tagline || '', 120), color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#0E7A5A' });
  if (registration_open !== undefined) setSetting('registration_open', !!registration_open);
  if (payment_instructions !== undefined) setSetting('payment_instructions', clamp(payment_instructions, 3000));
  if (trial) {
    need(['days', 'hours'].includes(trial.unit) && Number(trial.value) > 0, 400, 'مدة التجربة غير صحيحة');
    setSetting('trial', { value: Math.min(3650, Number(trial.value)), unit: trial.unit });
  }
  if (shamcash_number !== undefined) setSetting('shamcash_number', clamp(shamcash_number, 40));
  return { ok: true };
});

r.get('/api/admin/plans', ctx => { sup(ctx); return q.all('SELECT * FROM plans ORDER BY sort').map(p => ({ ...p, features: safeJSON(p.features, []), prices: Object.fromEntries(PERIODS.map(m => [m, priceFor(p.id, m)])) })); });
r.put('/api/admin/plans', ctx => {
  sup(ctx);
  const plans = ctx.body.plans;
  need(Array.isArray(plans) && plans.some(p => p.id === 'free'), 400, 'لازم تضل الخطة المجانية (free) موجودة');
  tx(() => {
    for (const [i, p] of plans.entries()) {
      need(/^[a-z0-9_-]{2,30}$/.test(p.id), 400, 'رمز الخطة لازم يكون إنجليزي صغير');
      q.run(`INSERT INTO plans (id, name, price_monthly, currency, ai_replies_per_day, max_products, allow_own_key, allow_cloud_api, is_public, sort, features)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, price_monthly=excluded.price_monthly, currency=excluded.currency,
               ai_replies_per_day=excluded.ai_replies_per_day, max_products=excluded.max_products, allow_own_key=excluded.allow_own_key,
               allow_cloud_api=excluded.allow_cloud_api, is_public=excluded.is_public, sort=excluded.sort, features=excluded.features`,
        p.id, clamp(p.name, 40), Number(p.price_monthly) || 0, clamp(p.currency || 'USD', 8), parseInt(p.ai_replies_per_day, 10) || 0,
        parseInt(p.max_products, 10) || 0, p.allow_own_key ? 1 : 0, p.allow_cloud_api ? 1 : 0, p.is_public ? 1 : 0, i,
        JSON.stringify((p.features || []).map(f => clamp(f, 120)).slice(0, 12)));
      for (const m of PERIODS) {
        const raw = p.prices?.[m], price = Number(raw);
        if (raw !== '' && raw != null && Number.isFinite(price) && price >= 0) q.run('INSERT INTO plan_prices (plan_id, months, price) VALUES (?, ?, ?) ON CONFLICT(plan_id, months) DO UPDATE SET price = excluded.price', p.id, m, price);
      }
    }
  });
  return { ok: true };
});

r.get('/api/admin/trial-alerts', ctx => {
  sup(ctx);
  return q.all(`SELECT a.*, t.name tenant_name FROM trial_alerts a JOIN tenants t ON t.id = a.tenant_id ORDER BY (a.status = 'open') DESC, a.id DESC LIMIT 100`);
});
r.post('/api/admin/trial-alerts/:id', ctx => {
  sup(ctx);
  const id = Number(ctx.params.id);
  if (ctx.body.action === 'allow') need(allowNewTrial(id), 400, 'التنبيه مو معلّق');
  else q.run("UPDATE trial_alerts SET status = 'dismissed' WHERE id = ? AND status = 'open'", id);
  return { ok: true };
});

r.get('/api/admin/payments', ctx => {
  sup(ctx);
  return q.all(`SELECT p.*, t.name tenant_name FROM payment_requests p JOIN tenants t ON t.id = p.tenant_id ORDER BY p.id DESC LIMIT 200`);
});
r.post('/api/admin/payments/:id', ctx => {
  sup(ctx);
  const p = q.get('SELECT * FROM payment_requests WHERE id = ?', Number(ctx.params.id));
  need(p && ['pending', 'awaiting_delivery'].includes(p.status), 400, 'الطلب مو معلّق');
  const approve = ctx.body.action === 'approve';
  tx(() => {
    q.run('UPDATE payment_requests SET status = ? WHERE id = ?', approve ? 'approved' : 'rejected', p.id);
    if (approve) {
      const t = q.get('SELECT plan_id, plan_expires_at FROM tenants WHERE id = ?', p.tenant_id);
      const base = t.plan_id === p.plan_id ? Math.max(t.plan_expires_at || 0, Date.now() / 1000) : Date.now() / 1000;
      q.run('UPDATE tenants SET plan_id = ?, plan_expires_at = ? WHERE id = ?', p.plan_id, Math.floor(base + periodDays(p.months) * 86400), p.tenant_id);
    }
  });
  return { ok: true };
});
