// نقاط API للواجهة الجديدة (/next): المنتجات المنفصلة، حفظ الأرقام، والإدارة
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';
import { q, tx, getSetting, usageToday } from './db.js';
import { hashPassword, verifyPassword, createSession, userFromToken } from './security.js';
import { DEFAULT_SETTINGS, DEFAULT_KNOWLEDGE } from './tenants.js';
import { clamp } from './text.js';
import { router } from './routes.js';
import { HttpError } from './http.js';
import { rateLimit } from './security.js';
import { getTenant, getPlan, brand, safeJSON, ensureSlug, PERIODS, priceFor, subscriptionExpired } from './tenants.js';
import { trialStatus, trialSeconds } from './trial.js';
import * as wa from './whatsapp/index.js';
import * as qrConn from './whatsapp/baileys.js';
import { oldWindow } from './services.js';
import { listServices, servicesFor, serviceExists, priceForService, grantService, revokeService, setPaused, saveServices, hasService, SERVICE_PERIODS, isSuperTenant } from './services.js';

const r = router;
const need = (cond, status, msg) => { if (!cond) throw new HttpError(status, msg); };
const auth = ctx => need(ctx.user, 401, 'سجّل دخول أول');
const owner = ctx => { auth(ctx); need(ctx.user.role === 'owner' || ctx.user.is_super, 403, 'ما عندك صلاحية'); };
const sup = ctx => { auth(ctx); need(ctx.user.is_super, 403, 'هالقسم لمدير المنصة بس'); };
const now = () => Math.floor(Date.now() / 1000);

const plansWithPrices = () => q.all('SELECT * FROM plans WHERE is_public = 1 ORDER BY sort').map(p => ({
  id: p.id, name: p.name, currency: p.currency, ai_replies_per_day: p.ai_replies_per_day, max_products: p.max_products,
  features: safeJSON(p.features, []), prices: Object.fromEntries(PERIODS.map(m => [m, priceFor(p.id, m)]))
}));

// حالة المجيب: ما منحسب التجربة إلا إذا شغّلو (حتى ما تنحرق تجربة يلي بدو حفظ الأرقام بس)
function responderState(t) {
  const plan = getPlan(t);
  const paid = t.plan_id !== 'free' && !subscriptionExpired(t);
  const gate = trialStatus(t);
  const unlocked = paid || isSuperTenant(t.id) || gate.code === 'trial';
  return {
    enabled: !!t.bot_enabled, unlocked, plan_id: t.plan_id, plan_name: plan.name, active_plan: plan.id, paid,
    expires_at: t.plan_expires_at, expired: subscriptionExpired(t), gate,
    replying: !!t.bot_enabled && t.status === 'active' && !subscriptionExpired(t) && gate.ok,
    usage: usageToday(t.id), limit: null, trial_seconds: trialSeconds()
  };
}

// ===== عام: كل شي بتحتاجو الصفحة الرئيسية =====
r.get('/api/public/catalog', () => ({
  brand: brand(),
  registration_open: getSetting('registration_open', true),
  plans: plansWithPrices(),
  services: listServices(),
  trial: getSetting('auto_trial', false) ? getSetting('trial', { value: 3, unit: 'days' }) : null
}));

// ===== أنا: ملخص اللوحة الجديدة =====
// ===== الحساب برقم الموبايل السوري =====
// بيقبل 09xxxxxxxx أو 9xxxxxxxx أو +963 / 00963، وبالأرقام العربية كمان → 9639xxxxxxxx
export function syPhone(v) {
  let d = String(v || '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('963')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return /^9\d{8}$/.test(d) ? '963' + d : null;
}
const localPhone = p => (p ? '0' + String(p).slice(3) : '');
const PHONE_MAIL = '@phone.kfast'; // عمود الإيميل إجباري بالقاعدة: حسابات الموبايل بتاخد إيميل داخلي ما بيبين
function userOut(u) {
  const x = q.get('SELECT phone, avatar FROM users WHERE id = ?', u.id) || {};
  return { id: u.id, email: String(u.email || '').endsWith(PHONE_MAIL) ? '' : u.email, phone: localPhone(x.phone), avatar: x.avatar || '', name: u.name, role: u.role, is_super: !!u.is_super };
}

r.post('/api/v2/auth/register', ctx => {
  const b = ctx.body;
  const first = !q.get('SELECT 1 FROM users LIMIT 1');
  need(first || getSetting('registration_open', true), 403, 'التسجيل مسكّر حالياً');
  need(rateLimit('reg:' + ctx.ip, 5, 3600_000), 429, 'محاولات كتير، جرّب بعد شوي');
  const fullName = clamp(String(b.name || ''), 80).trim().replace(/\s+/g, ' ');
  need(fullName.split(' ').filter(w => w.length > 1).length >= 3, 400, 'اكتب اسمك الثلاثي (الاسم، اسم الأب، الكنية)');
  const shopName = clamp(String(b.business_name || ''), 120).trim();
  need(shopName.length >= 2, 400, 'اكتب اسم الشركة أو المتجر');
  const phone = syPhone(b.phone);
  need(phone, 400, 'اكتب رقم موبايل سوري صحيح، متل 0912345678');
  const pw = String(b.password || '');
  need(pw.length >= 8, 400, 'كلمة السر لازم تكون 8 أحرف أو أكتر');
  need(pw === String(b.password2 || ''), 400, 'كلمة السر والتأكيد مو متل بعض');
  need(!q.get('SELECT 1 FROM users WHERE phone = ?', phone), 409, 'هالرقم إلو حساب من قبل، ادخل فيه');
  const userId = tx(() => {
    const t = q.run('INSERT INTO tenants (name, settings, knowledge) VALUES (?, ?, ?)', shopName,
      JSON.stringify({ ...DEFAULT_SETTINGS, cloud_verify_token: crypto.randomBytes(12).toString('hex') }),
      JSON.stringify({ ...DEFAULT_KNOWLEDGE, business_name: shopName }));
    const u = q.run('INSERT INTO users (tenant_id, email, phone, name, pass_hash, role, is_super) VALUES (?, ?, ?, ?, ?, ?, ?)',
      t.lastInsertRowid, phone + PHONE_MAIL, phone, fullName, hashPassword(pw), 'owner', first ? 1 : 0);
    if (!first) q.run('UPDATE tenants SET bot_enabled = 0 WHERE id = ?', t.lastInsertRowid);
    return Number(u.lastInsertRowid);
  });
  ctx.setCookie(createSession(userId));
  return { ok: true };
});

// دخول بالرقم (أو بالإيميل للحسابات القديمة متل حساب المدير)
r.post('/api/v2/auth/login', ctx => {
  const id = String(ctx.body.login || '').trim();
  const phone = id.includes('@') ? null : syPhone(id);
  const key = phone || id.toLowerCase();
  need(rateLimit('login:' + ctx.ip, 10, 900_000) && rateLimit('login:' + key, 8, 900_000), 429, 'محاولات كتير، استنى ربع ساعة');
  const u = phone ? q.get('SELECT * FROM users WHERE phone = ?', phone) : q.get('SELECT * FROM users WHERE email = ?', key);
  need(u && verifyPassword(String(ctx.body.password || ''), u.pass_hash), 401, 'الرقم أو كلمة السر غلط');
  ctx.setCookie(createSession(u.id));
  return { ok: true };
});

// الملف الشخصي: الاسم، الصورة، الرقم، كلمة السر
r.put('/api/v2/profile', ctx => {
  auth(ctx);
  const b = ctx.body, uid = ctx.user.id;
  if (b.name !== undefined) q.run('UPDATE users SET name = ? WHERE id = ?', clamp(String(b.name), 80).trim(), uid);
  if (b.avatar !== undefined) {
    const a = String(b.avatar || '');
    need(!a || (/^\/uploads\/[\w.-]+$/.test(a) && fs.existsSync(path.join(DATA_DIR, 'uploads', path.basename(a)))), 400, 'الصورة مو موجودة');
    q.run('UPDATE users SET avatar = ? WHERE id = ?', a || null, uid);
  }
  if (b.phone !== undefined && String(b.phone).trim()) {
    const p = syPhone(b.phone);
    need(p, 400, 'اكتب رقم موبايل سوري صحيح، متل 0912345678');
    need(!q.get('SELECT 1 FROM users WHERE phone = ? AND id != ?', p, uid), 409, 'هالرقم مستعمل بحساب تاني');
    q.run('UPDATE users SET phone = ? WHERE id = ?', p, uid);
  }
  if (b.password_new) {
    const u = q.get('SELECT pass_hash FROM users WHERE id = ?', uid);
    need(verifyPassword(String(b.password_current || ''), u.pass_hash), 400, 'كلمة السر الحالية غلط');
    need(String(b.password_new).length >= 8, 400, 'كلمة السر الجديدة لازم تكون 8 أحرف أو أكتر');
    need(String(b.password_new) === String(b.password_new2 || ''), 400, 'كلمة السر الجديدة والتأكيد مو متل بعض');
    q.run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(String(b.password_new)), uid);
  }
  return { ok: true, user: userOut(ctx.user) };
});

r.get('/api/v2/me', ctx => {
  auth(ctx);
  const t = ctx.tenant;
  return {
    user: userOut(ctx.user),
    impersonating: (() => { const tok = readCookie(ctx, 'raddad_back'); const a = tok ? userFromToken(tok) : null; return a && a.is_super && a.id !== ctx.user.id ? { admin: a.name || 'المدير' } : null; })(),
    tenant: { id: t.id, name: t.name, slug: ensureSlug(t), status: t.status, wa_provider: t.wa_provider, wa_phone: t.wa_phone, contacts_prefix: t.settings.contacts_prefix || 'زبون', site_url: t.settings.site_url || '', site_sync: !!t.settings.site_sync },
    wa: wa.status(t),
    services: servicesFor(t.id),
    responder: responderState(t),
    contacts: qrConn.contactsStats(t.id),
    counts: {
      products: q.get('SELECT COUNT(*) n FROM products WHERE tenant_id = ?', t.id).n,
      needs_human: q.get('SELECT COUNT(*) n FROM contacts WHERE tenant_id = ? AND needs_human = 1', t.id).n,
      new_orders: q.get("SELECT COUNT(*) n FROM orders WHERE tenant_id = ? AND status = 'new'", t.id).n,
      unread: q.get('SELECT COALESCE(SUM(unread),0) n FROM contacts WHERE tenant_id = ?', t.id).n,
      pending_payments: q.get("SELECT COUNT(*) n FROM payment_requests WHERE tenant_id = ? AND status IN ('pending','awaiting_delivery')", t.id).n
    },
    brand: brand()
  };
});

// إعدادات المجيب ومعلومات المتجر (بدون ما نلمس التجربة)
r.get('/api/v2/bot-settings', ctx => {
  auth(ctx);
  const t = ctx.tenant;
  const { cloud_app_secret_enc, cloud_verify_token, ...settings } = t.settings;
  return { settings, knowledge: t.knowledge, name: t.name, bot_enabled: !!t.bot_enabled };
});

// تشغيل/إيقاف المجيب (أول تشغيل بيبلّش التجربة المجانية)
// ===== تعليم المجيب: سؤال ← الجواب الصح (بيستعملها كأمثلة لما زبون يسأل شي مشابه) =====
r.get('/api/v2/learn', ctx => {
  owner(ctx);
  const t = ctx.tenant;
  const rows = q.all("SELECT id, q, a, source, created_at FROM style_examples WHERE tenant_id = ? ORDER BY (source = 'manual') DESC, id DESC LIMIT 300", t.id);
  const by = Object.fromEntries(q.all('SELECT source, COUNT(*) n FROM style_examples WHERE tenant_id = ? GROUP BY source', t.id).map(x => [x.source, x.n]));
  return { items: rows, total: Object.values(by).reduce((a, b) => a + b, 0), manual: by.manual || 0, imported: (by.import || 0), style_profile: t.settings.style_profile || '',
    understand_media: t.settings.understand_media !== false, use_examples: t.settings.use_examples !== false };
});
r.post('/api/v2/learn', async ctx => {
  owner(ctx);
  const qq = String(ctx.body.q || '').trim().slice(0, 600), aa = String(ctx.body.a || '').trim().slice(0, 1500);
  need(qq && aa, 400, 'اكتب سؤال الزبون والجواب الصح');
  const st = await import('./style.js');
  if (ctx.body.id) st.deleteExample(ctx.tenant.id, ctx.body.id);
  st.addManual(ctx.tenant.id, qq, aa);
  return { ok: true };
});
r.del('/api/v2/learn/:id', async ctx => {
  owner(ctx);
  (await import('./style.js')).deleteExample(ctx.tenant.id, ctx.params.id);
  return { ok: true };
});

// ===== إعدادات حساب الواتساب =====
r.get('/api/v2/wa-profile', async ctx => {
  owner(ctx);
  try { return await qrConn.waProfile(ctx.tenant.id); } catch (e) { throw new HttpError(400, e.message); }
});
r.put('/api/v2/wa-profile', async ctx => {
  owner(ctx);
  try { return await qrConn.waUpdate(ctx.tenant.id, ctx.body); } catch (e) { throw new HttpError(400, e.message || 'واتساب رفض التعديل'); }
});

// ===== واتساب (متل واتساب ويب) =====
const okJid = j => /^[\w.:-]+@(s\.whatsapp\.net|g\.us|lid)$/.test(String(j || ''));
async function mirrorMod() { return import('./whatsapp/mirror.js'); }
r.get('/api/v2/wa/chats', async ctx => {
  owner(ctx);
  const M = await mirrorMod(), tid = ctx.tenant.id;
  if (!M.flag(tid, 'backfill')) {
    const rows = q.all(`SELECT m.id, m.direction, m.body, m.media_url, m.wa_id, m.created_at, c.jid, c.name FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.tenant_id = ? ORDER BY m.id`, tid);
    M.backfill(tid, rows);
  }
  const x = ctx.query;
  return { chats: M.listChats(tid, { q: x.q || '', offset: x.offset, limit: x.limit, archived: x.archived === '1' }), counts: M.counts(tid), wa: wa.status(ctx.tenant) };
});
r.get('/api/v2/wa/messages', async ctx => {
  owner(ctx);
  const jid = String(ctx.query.jid || ''); need(okJid(jid), 400, 'محادثة غلط');
  const M = await mirrorMod();
  return { chat: M.chatInfo(ctx.tenant.id, jid), messages: M.messages(ctx.tenant.id, jid, { before: ctx.query.before, limit: ctx.query.limit }) };
});
r.post('/api/v2/wa/read', async ctx => {
  owner(ctx); const jid = String(ctx.body.jid || ''); need(okJid(jid), 400, 'محادثة غلط');
  await qrConn.mirrorRead(ctx.tenant.id, jid); return { ok: true };
});
r.post('/api/v2/wa/media', async ctx => {
  owner(ctx); const jid = String(ctx.body.jid || ''); need(okJid(jid), 400, 'محادثة غلط');
  try { return { url: await qrConn.mirrorMedia(ctx.tenant.id, jid, String(ctx.body.id || '')) }; }
  catch (e) { console.error(`[mirror] media t${ctx.tenant.id} ${jid} ${ctx.body.id}: ${e.message}`); throw new HttpError(400, /40[34]|410|gone|not found/i.test(e.message) ? 'هالملف ما عاد موجود عند واتساب ولا على موبايل صاحبو' : e.message); }
});
r.post('/api/v2/wa/send', async ctx => {
  owner(ctx); const jid = String(ctx.body.jid || ''); need(okJid(jid), 400, 'محادثة غلط');
  const text = String(ctx.body.text || '').slice(0, 4000), image = typeof ctx.body.image === 'string' && ctx.body.image.startsWith('data:image/') ? ctx.body.image : null;
  need(text.trim() || image, 400, 'اكتب رسالة');
  try { await qrConn.mirrorSend(ctx.tenant.id, jid, { text, image }); return { ok: true }; } catch (e) { throw new HttpError(400, e.message); }
});

// ===== المدير: «ادخل كأنّو هو» ورجعة لحسابو =====
const BACK = 'raddad_back';
function cookieHeader(ctx, name, value, maxAge) {
  const secure = (ctx.req.headers['x-forwarded-proto'] || '').includes('https');
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Max-Age=${maxAge}${secure ? '; Secure; SameSite=None; Partitioned' : '; SameSite=Lax'}`;
}
const readCookie = (ctx, name) => { const m = String(ctx.req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : ''; };
r.post('/api/admin/v2/tenants/:id/enter', ctx => {
  sup(ctx);
  const u = q.get("SELECT id FROM users WHERE tenant_id = ? ORDER BY (role = 'owner') DESC, id LIMIT 1", Number(ctx.params.id));
  need(u, 404, 'ما في مستخدم بهالحساب');
  need(u.id !== ctx.user.id, 400, 'هاد حسابك');
  ctx.res.setHeader('Set-Cookie', [cookieHeader(ctx, 'raddad_sid', createSession(u.id), 12 * 3600), cookieHeader(ctx, BACK, ctx.token, 30 * 86400)]);
  return { ok: true };
});
r.post('/api/v2/back-to-admin', ctx => {
  const tok = readCookie(ctx, BACK);
  const admin = tok ? userFromToken(tok) : null;
  need(admin && admin.is_super, 403, 'ما في حساب مدير ترجعلو');
  ctx.res.setHeader('Set-Cookie', [cookieHeader(ctx, 'raddad_sid', tok, 30 * 86400), cookieHeader(ctx, BACK, '', 0)]);
  return { ok: true };
});

// ===== ربط موقع الزبون =====
r.post('/api/v2/site-sync', async ctx => {
  owner(ctx);
  need(rateLimit('site:' + ctx.tenant.id, 10, 3600_000), 429, 'جرّبت كتير، استنى شوي');
  const url = String(ctx.body.url || '').trim().slice(0, 300), auto = !!ctx.body.auto;
  const { syncSite } = await import('./sitesync.js');
  let res;
  try { res = await syncSite(ctx.tenant.id, url); } catch (e) { throw new HttpError(400, e.message); }
  const t = getTenant(ctx.tenant.id);
  q.run('UPDATE tenants SET settings = ? WHERE id = ?', JSON.stringify({ ...t.settings, site_url: url, site_sync: auto }), t.id);
  return res;
});
r.put('/api/v2/site-sync', ctx => {
  owner(ctx);
  const t = ctx.tenant;
  q.run('UPDATE tenants SET settings = ? WHERE id = ?', JSON.stringify({ ...t.settings, site_sync: !!ctx.body.auto }), t.id);
  return { ok: true };
});

// ===== حالات واتساب أوتوماتيك (جزء من المجيب) =====
r.get('/api/v2/stories', async ctx => {
  owner(ctx);
  const S = await import('./stories.js'), t = ctx.tenant;
  return { settings: { enabled: false, per_day: 1, ...(t.settings.status_auto || {}) }, slots: S.SLOTS, log: S.storyLog(t.id), unlocked: responderState(t).unlocked,
    with_images: q.get("SELECT COUNT(*) n FROM products WHERE tenant_id = ? AND image_url IS NOT NULL AND image_url != ''", t.id).n };
});
r.put('/api/v2/stories', ctx => {
  owner(ctx);
  const t = ctx.tenant, on = !!ctx.body.enabled, per = [1, 2, 3].includes(Number(ctx.body.per_day)) ? Number(ctx.body.per_day) : 1;
  if (on) need(responderState(t).unlocked, 403, 'الحالات جزء من المجيب الذكي. اشترك فيه أول.');
  q.run('UPDATE tenants SET settings = ? WHERE id = ?', JSON.stringify({ ...t.settings, status_auto: { enabled: on, per_day: per } }), t.id);
  return { ok: true };
});
r.post('/api/v2/stories/now', async ctx => {
  owner(ctx);
  need(responderState(ctx.tenant).unlocked, 403, 'الحالات جزء من المجيب الذكي. اشترك فيه أول.');
  need(rateLimit('story:' + ctx.tenant.id, 4, 3600_000), 429, 'نشرت كتير هالساعة. استنى شوي حتى ما ينزعج واتساب.');
  try { return await (await import('./stories.js')).postStory(ctx.tenant.id); } catch (e) { throw new HttpError(400, e.message); }
});
export const responderUnlocked = tid => { const t = getTenant(tid); return !!t && responderState(t).unlocked; };

r.put('/api/v2/responder', ctx => {
  owner(ctx);
  const on = !!ctx.body.enabled;
  if (on) need(responderState(ctx.tenant).unlocked, 403, 'المجيب مقفول. اشترك من صفحة الاشتراكات ليتفعّل');
  q.run('UPDATE tenants SET bot_enabled = ? WHERE id = ?', on ? 1 : 0, ctx.tenant.id);
  return responderState(getTenant(ctx.tenant.id));
});

// ===== الاشتراكات والدفع =====
r.get('/api/v2/billing', ctx => {
  auth(ctx);
  const t = ctx.tenant;
  const names = Object.fromEntries([...q.all('SELECT id, name FROM plans'), ...q.all('SELECT id, name FROM services')].map(x => [x.id, x.name]));
  return {
    plans: plansWithPrices(), services: listServices(), mine: servicesFor(t.id), responder: responderState(t),
    shamcash_number: getSetting('shamcash_number', ''), shamcash_name: getSetting('shamcash_name', ''), shamcash_qr: getSetting('shamcash_qr', ''),
    cash_address: getSetting('cash_address', 'دمشق - قدسيا - خلف البلدية'), receipts_whatsapp: getSetting('receipts_whatsapp', '0938986875'), instructions: getSetting('payment_instructions', ''),
    requests: q.all('SELECT id, plan_id, service_id, months, method, status, amount, receipt, phone, created_at FROM payment_requests WHERE tenant_id = ? ORDER BY id DESC LIMIT 30', t.id)
      .map(p => ({ ...p, name: names[p.service_id || p.plan_id] || p.plan_id }))
  };
});

// طلب اشتراك: kind = plan (المجيب) | service (حفظ الأرقام)
r.post('/api/v2/billing/request', ctx => {
  owner(ctx);
  const { kind, id, method, receipt, phone } = ctx.body;
  const months = parseInt(ctx.body.months, 10);
  let amount, planId, serviceId = null;
  if (kind === 'service') {
    const s = q.get('SELECT * FROM services WHERE id = ? AND is_public = 1', id);
    need(s, 400, 'الخدمة غير موجودة');
    const m = s.kind === 'once' ? 0 : months;
    need(s.kind === 'once' || SERVICE_PERIODS.includes(m), 400, 'المدة غير صحيحة');
    amount = priceForService(s.id, m);
    need(amount != null, 400, 'سعر هالخدمة لسا ما انحدد، تواصل معنا');
    planId = s.id; serviceId = s.id;
    ctx.body.months = m;
  } else {
    need(id !== 'free' && q.get('SELECT 1 FROM plans WHERE id = ? AND is_public = 1', id), 400, 'الباقة غير موجودة');
    need(PERIODS.includes(months), 400, 'المدة غير صحيحة');
    amount = priceFor(id, months); planId = id;
  }
  need(['shamcash', 'hand'].includes(method), 400, 'اختار طريقة الدفع');
  need(rateLimit('pay:' + ctx.tenant.id, 8, 3600_000), 429, 'استنى شوي وجرّب');
  let receiptUrl = null, ph = null, status = 'pending';
  if (method === 'shamcash') { // الإيصال صار ينبعت على واتساب المنصة (مو رفع بالموقع)
    const m = String(receipt || '').match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
    if (m) {
    const buf = Buffer.from(m[2], 'base64');
    need(buf.length < 5 * 1024 * 1024, 400, 'الصورة أكبر من 5 ميغا');
    const name = `${ctx.tenant.id}-rcpt-${crypto.randomBytes(8).toString('hex')}.${m[1].replace('jpeg', 'jpg')}`;
    fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), buf);
    receiptUrl = `/uploads/${name}`;
    }
  } else {
    ph = String(phone || '').replace(/[^\d+]/g, '');
    need(ph.replace(/\D/g, '').length >= 8, 400, 'اكتب رقم موبايلك');
    status = 'awaiting_delivery';
  }
  q.run('INSERT INTO payment_requests (tenant_id, plan_id, service_id, months, method, status, amount, receipt, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ctx.tenant.id, planId, serviceId, kind === 'service' ? ctx.body.months : months, method === 'shamcash' ? 'شام كاش' : 'كاش بالمركز', status, amount, receiptUrl, ph);
  // تنبيه لصاحب المنصة عالواتس
  import('./notify.js').then(N => {
    const what = serviceId ? (q.get('SELECT name FROM services WHERE id = ?', serviceId)?.name || serviceId) : 'المجيب الذكي';
    const m = kind === 'service' ? ctx.body.months : months, per = m ? (m === 1 ? 'شهر' : m === 12 ? 'سنة' : `${m} شهور`) : 'دفعة وحدة';
    N.notifyAdmin(`💳 طلب اشتراك جديد\n${ctx.tenant.name} (${N.customerPhone(ctx.tenant.id) || ph || '—'})\n«${what}» — ${per} — ${amount}$\nالدفع: ${method === 'shamcash' ? 'شام كاش' : 'كاش بالمركز'}\nوافق من هون: ${N.siteLink('/admin/payments')}`);
  }).catch(() => {});
  return { ok: true };
});

// ===== حفظ الأرقام =====
r.get('/api/csync/status', ctx => {
  auth(ctx);
  const t = ctx.tenant;
  return {
    services: servicesFor(t.id), stats: qrConn.contactsStats(t.id), wa: wa.status(t), prefix: t.settings.contacts_prefix || 'زبون',
    imports: q.all('SELECT id, source, found, queued, created_at FROM contact_imports WHERE tenant_id = ? ORDER BY id DESC LIMIT 10', t.id)
  };
});
r.put('/api/csync/settings', ctx => {
  owner(ctx);
  const t = ctx.tenant;
  const { prefix, pause } = ctx.body;
  if (prefix !== undefined) {
    const p = String(prefix || '').replace(/[\d\n\r]/g, '').trim().slice(0, 24);
    need(p.length >= 1, 400, 'اكتب كلمة قبل الرقم، مثلاً «زبون»');
    q.run('UPDATE tenants SET settings = ? WHERE id = ?', JSON.stringify({ ...t.settings, contacts_prefix: p }), t.id);
  }
  if (pause && ['contacts_new', 'contacts_old'].includes(pause.service_id)) setPaused(t.id, pause.service_id, !!pause.paused);
  return { ok: true, services: servicesFor(t.id) };
});
// الأرقام القديمة من النسخة الاحتياطية: الملف انفك على جهاز الزبون، ووصلنا الأرقام بس
r.post('/api/csync/import', ctx => {
  owner(ctx);
  // بتنقبل حتى قبل الاشتراك: بتنحفظ عندنا، وبتبلّش تنحفظ بجهات الاتصال أول ما ينفعّل «حفظ كل الأرقام القديمة»
  need(rateLimit('csimp:' + ctx.tenant.id, 6, 3600_000), 429, 'جرّبت كتير، استنى شوي');
  const w = oldWindow(ctx.tenant.id);
  need(!w.owned || w.open, 403, 'خلصت مهلة الـ 24 ساعة لرفع النسخة الاحتياطية. إذا بدك تعيد، اطلب تفعيل جديد.');
  const nums = Array.isArray(ctx.body.numbers) ? ctx.body.numbers.slice(0, 60000) : [];
  need(nums.length, 400, 'ما في أرقام');
  const out = qrConn.importNumbers(ctx.tenant.id, nums);
  q.run('INSERT INTO contact_imports (tenant_id, source, found, queued) VALUES (?, ?, ?, ?)', ctx.tenant.id, 'backup', out.found, out.queued);
  return { ...out, owned: hasService(ctx.tenant.id, 'contacts_old'), stats: qrConn.contactsStats(ctx.tenant.id) };
});
// الأرقام القديمة يلي إجت وقت ربط الواتس: «احفظهم هلق»
r.post('/api/csync/link-now', ctx => {
  owner(ctx);
  need(hasService(ctx.tenant.id, 'contacts_old') || hasService(ctx.tenant.id, 'contacts_new'), 403, 'اشترك بخدمة حفظ الأرقام أول');
  const before = qrConn.contactsStats(ctx.tenant.id);
  const stats = qrConn.queueHistoryNow(ctx.tenant.id);
  if (hasService(ctx.tenant.id, 'contacts_old') && before.history) q.run('INSERT INTO contact_imports (tenant_id, source, found, queued) VALUES (?, ?, ?, ?)', ctx.tenant.id, 'link', before.history, stats.pending);
  return { ok: true, stats };
});

// ===== مدير المنصة =====
r.get('/api/admin/v2/overview', ctx => {
  sup(ctx);
  const t = now();
  return {
    tenants: q.get('SELECT COUNT(*) n FROM tenants').n,
    new_week: q.get('SELECT COUNT(*) n FROM tenants WHERE created_at > ?', t - 7 * 86400).n,
    responder_paid: q.get("SELECT COUNT(*) n FROM tenants WHERE plan_id != 'free' AND plan_expires_at > ?", t).n,
    contacts_new: q.get('SELECT COUNT(*) n FROM tenant_services WHERE service_id = ? AND (expires_at IS NULL OR expires_at > ?)', 'contacts_new', t).n,
    contacts_old: q.get('SELECT COUNT(*) n FROM tenant_services WHERE service_id = ?', 'contacts_old').n,
    pending_payments: q.get("SELECT COUNT(*) n FROM payment_requests WHERE status IN ('pending','awaiting_delivery')").n,
    trial_alerts: q.get("SELECT COUNT(*) n FROM trial_alerts WHERE status = 'open'").n,
    revenue_30d: q.get("SELECT COALESCE(SUM(amount),0) n FROM payment_requests WHERE status = 'approved' AND created_at > ?", t - 30 * 86400).n,
    msgs_today: q.get("SELECT COALESCE(SUM(msgs_in + msgs_out),0) n FROM usage WHERE day = date('now')").n,
    ai_today: q.get("SELECT COALESCE(SUM(ai_replies),0) n FROM usage WHERE day = date('now')").n,
    wa_linked: q.get("SELECT COUNT(*) n FROM tenants WHERE wa_phone IS NOT NULL AND wa_phone != ''").n
  };
});

r.get('/api/admin/v2/tenants', ctx => {
  sup(ctx);
  return q.all(`SELECT t.id, t.name, t.plan_id, t.plan_expires_at, t.status, t.wa_phone, t.bot_enabled, t.created_at,
      (SELECT CASE WHEN phone IS NOT NULL THEN '0' || substr(phone, 4) ELSE email END FROM users WHERE tenant_id = t.id ORDER BY id LIMIT 1) email,
      (SELECT MAX(is_super) FROM users WHERE tenant_id = t.id) is_super,
      (SELECT COALESCE(SUM(ai_replies),0) FROM usage WHERE tenant_id = t.id AND day >= date('now','-6 days')) ai_7d
    FROM tenants t ORDER BY t.id DESC LIMIT 500`).map(t => {
    const tt = getTenant(t.id);
    return { ...t, is_super: !!t.is_super, wa_status: wa.status(tt).status, services: servicesFor(t.id), contacts: qrConn.contactsStats(t.id) };
  });
});

// تفعيل/إلغاء/تمديد خدمة لمشترك بإيدك
r.post('/api/admin/v2/tenants/:id/service', ctx => {
  sup(ctx);
  const id = Number(ctx.params.id), { service_id, action } = ctx.body;
  need(getTenant(id), 404, 'المشترك غير موجود');
  need(serviceExists(service_id), 400, 'الخدمة غير موجودة');
  if (action === 'grant') grantService(id, service_id, parseInt(ctx.body.months, 10) || 0, parseInt(ctx.body.days, 10) || 0);
  else if (action === 'revoke') revokeService(id, service_id);
  else if (action === 'pause' || action === 'resume') setPaused(id, service_id, action === 'pause');
  else throw new HttpError(400, 'أمر غير معروف');
  if (action === 'grant') setTimeout(() => qrConn.queueHistoryNow(id), 1000);
  return { ok: true, services: servicesFor(id) };
});

r.get('/api/admin/v2/services', ctx => { sup(ctx); return listServices({ all: true }); });
r.put('/api/admin/v2/services', ctx => { sup(ctx); saveServices(ctx.body.services); return listServices({ all: true }); });

// ===== لوحة الأرباح =====
r.get('/api/admin/v2/revenue', async ctx => {
  sup(ctx);
  const N = await import('./notify.js');
  const now = Math.floor(Date.now() / 1000), d = new Date();
  const mStart = Math.floor(new Date(d.getFullYear(), d.getMonth(), 1) / 1000), lStart = Math.floor(new Date(d.getFullYear(), d.getMonth() - 1, 1) / 1000);
  const supers = new Set(q.all('SELECT DISTINCT tenant_id FROM users WHERE is_super = 1').map(r => r.tenant_id));
  const paid = q.all("SELECT p.tenant_id, p.service_id, p.plan_id, p.months, p.amount, p.created_at FROM payment_requests p WHERE p.status = 'approved'");
  const sum = rows => Math.round(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0) * 100) / 100;
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const a = Math.floor(new Date(d.getFullYear(), d.getMonth() - i, 1) / 1000), b = Math.floor(new Date(d.getFullYear(), d.getMonth() - i + 1, 1) / 1000);
    const rows = paid.filter(r => r.created_at >= a && r.created_at < b);
    months.push({ label: `${new Date(a * 1000).getMonth() + 1}/${String(new Date(a * 1000).getFullYear()).slice(2)}`, total: sum(rows), count: rows.length });
  }
  const prod = r => r.service_id || 'responder';
  const names = { responder: 'المجيب الذكي', ...Object.fromEntries(q.all('SELECT id, name FROM services').map(s => [s.id, s.name])) };
  const byProduct = Object.entries(names).map(([id, name]) => { const rows = paid.filter(r => prod(r) === id); return { id, name, total: sum(rows), count: rows.length }; });
  const pend = q.get("SELECT COUNT(*) n, COALESCE(SUM(amount), 0) s FROM payment_requests WHERE status IN ('pending', 'awaiting_delivery')");
  const tname = id => getTenant(id)?.name || '#' + id;
  const respActive = q.all("SELECT id, plan_expires_at FROM tenants WHERE plan_id != 'free' AND plan_expires_at > ? AND status = 'active'", now).filter(t => !supers.has(t.id));
  const svcRows = q.all('SELECT tenant_id, service_id, expires_at FROM tenant_services').filter(r => !supers.has(r.tenant_id));
  const live = r => r.expires_at == null || r.expires_at > now;
  const soon = [], lapsed = [];
  for (const t of q.all("SELECT id, plan_expires_at e FROM tenants WHERE plan_id != 'free' AND plan_expires_at IS NOT NULL")) {
    if (supers.has(t.id)) continue;
    if (t.e > now && t.e <= now + 7 * 86400) soon.push({ tenant_id: t.id, name: tname(t.id), phone: N.customerPhone(t.id), what: names.responder, expires_at: t.e });
    if (t.e <= now && t.e > now - 30 * 86400) lapsed.push({ tenant_id: t.id, name: tname(t.id), phone: N.customerPhone(t.id), what: names.responder, expires_at: t.e });
  }
  for (const r of svcRows) {
    if (r.expires_at == null) continue;
    const row = { tenant_id: r.tenant_id, name: tname(r.tenant_id), phone: N.customerPhone(r.tenant_id), what: names[r.service_id] || r.service_id, expires_at: r.expires_at };
    if (r.expires_at > now && r.expires_at <= now + 7 * 86400) soon.push(row);
    if (r.expires_at <= now && r.expires_at > now - 30 * 86400) lapsed.push(row);
  }
  return {
    total: sum(paid), this_month: sum(paid.filter(r => r.created_at >= mStart)), last_month: sum(paid.filter(r => r.created_at >= lStart && r.created_at < mStart)),
    payments: paid.length, pending: { count: pend.n, amount: pend.s }, months, byProduct,
    active: { responder: respActive.length, contacts_new: svcRows.filter(r => r.service_id === 'contacts_new' && live(r)).length, contacts_old: svcRows.filter(r => r.service_id === 'contacts_old').length },
    accounts: q.all('SELECT id FROM tenants').filter(t => !supers.has(t.id)).length,
    new_accounts: q.all('SELECT id FROM tenants WHERE created_at >= ?', mStart).filter(t => !supers.has(t.id)).length,
    soon: soon.sort((a, b) => a.expires_at - b.expires_at), lapsed: lapsed.sort((a, b) => b.expires_at - a.expires_at)
  };
});

r.get('/api/admin/v2/payments', ctx => {
  sup(ctx);
  const names = Object.fromEntries([...q.all('SELECT id, name FROM plans'), ...q.all('SELECT id, name FROM services')].map(x => [x.id, x.name]));
  return q.all(`SELECT p.*, t.name tenant_name, (SELECT CASE WHEN phone IS NOT NULL THEN '0' || substr(phone, 4) ELSE email END FROM users WHERE tenant_id = t.id ORDER BY id LIMIT 1) email
    FROM payment_requests p JOIN tenants t ON t.id = p.tenant_id ORDER BY (p.status IN ('pending','awaiting_delivery')) DESC, p.id DESC LIMIT 300`)
    .map(p => ({ ...p, name: names[p.service_id || p.plan_id] || p.plan_id }));
});

// كود تأكيد رقم زبون متجر KO SPORT (الطلب موقّع من الموقع)
r.post('/api/otp/ko', async ctx => (await import('./otp.js')).koOtp(ctx.body));

export { isSuperTenant };
