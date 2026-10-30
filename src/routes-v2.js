// نقاط API للواجهة الجديدة (/next): المنتجات المنفصلة، حفظ الأرقام، والإدارة
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';
import { q, getSetting, usageToday } from './db.js';
import { router } from './routes.js';
import { HttpError } from './http.js';
import { rateLimit } from './security.js';
import { getTenant, getPlan, brand, safeJSON, ensureSlug, PERIODS, priceFor, subscriptionExpired } from './tenants.js';
import { trialStatus, trialSeconds } from './trial.js';
import * as wa from './whatsapp/index.js';
import * as qrConn from './whatsapp/baileys.js';
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
  const gate = t.bot_enabled ? trialStatus(t) : { ok: false, code: 'off' };
  return {
    enabled: !!t.bot_enabled, plan_id: t.plan_id, plan_name: plan.name, active_plan: plan.id, paid,
    expires_at: t.plan_expires_at, expired: subscriptionExpired(t), gate,
    replying: !!t.bot_enabled && t.status === 'active' && !subscriptionExpired(t) && gate.ok,
    usage: usageToday(t.id), limit: plan.ai_replies_per_day, trial_seconds: trialSeconds()
  };
}

// ===== عام: كل شي بتحتاجو الصفحة الرئيسية =====
r.get('/api/public/catalog', () => ({
  brand: brand(),
  registration_open: getSetting('registration_open', true),
  plans: plansWithPrices(),
  services: listServices(),
  trial: getSetting('trial', { value: 3, unit: 'days' })
}));

// ===== أنا: ملخص اللوحة الجديدة =====
r.get('/api/v2/me', ctx => {
  auth(ctx);
  const t = ctx.tenant;
  return {
    user: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name, role: ctx.user.role, is_super: !!ctx.user.is_super },
    tenant: { id: t.id, name: t.name, slug: ensureSlug(t), status: t.status, wa_provider: t.wa_provider, wa_phone: t.wa_phone, contacts_prefix: t.settings.contacts_prefix || 'زبون' },
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
r.put('/api/v2/responder', ctx => {
  owner(ctx);
  const on = !!ctx.body.enabled;
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
    shamcash_number: getSetting('shamcash_number', ''), instructions: getSetting('payment_instructions', ''),
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
  q.run('INSERT INTO payment_requests (tenant_id, plan_id, service_id, months, method, status, amount, receipt, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ctx.tenant.id, planId, serviceId, kind === 'service' ? ctx.body.months : months, method === 'shamcash' ? 'شام كاش' : 'تسليم باليد بقدسيا', status, amount, receiptUrl, ph);
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
      (SELECT email FROM users WHERE tenant_id = t.id ORDER BY id LIMIT 1) email,
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
  if (action === 'grant') grantService(id, service_id, parseInt(ctx.body.months, 10) || 0);
  else if (action === 'revoke') revokeService(id, service_id);
  else if (action === 'pause' || action === 'resume') setPaused(id, service_id, action === 'pause');
  else throw new HttpError(400, 'أمر غير معروف');
  if (action === 'grant') setTimeout(() => qrConn.queueHistoryNow(id), 1000);
  return { ok: true, services: servicesFor(id) };
});

r.get('/api/admin/v2/services', ctx => { sup(ctx); return listServices({ all: true }); });
r.put('/api/admin/v2/services', ctx => { sup(ctx); saveServices(ctx.body.services); return listServices({ all: true }); });

r.get('/api/admin/v2/payments', ctx => {
  sup(ctx);
  const names = Object.fromEntries([...q.all('SELECT id, name FROM plans'), ...q.all('SELECT id, name FROM services')].map(x => [x.id, x.name]));
  return q.all(`SELECT p.*, t.name tenant_name, (SELECT email FROM users WHERE tenant_id = t.id ORDER BY id LIMIT 1) email
    FROM payment_requests p JOIN tenants t ON t.id = p.tenant_id ORDER BY (p.status IN ('pending','awaiting_delivery')) DESC, p.id DESC LIMIT 300`)
    .map(p => ({ ...p, name: names[p.service_id || p.plan_id] || p.plan_id }));
});

export { isSuperTenant };
