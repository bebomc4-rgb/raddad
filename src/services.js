// منتجات منفصلة عن المجيب: «حفظ كل رقم جديد» (اشتراك بالمدة) و«حفظ كل الأرقام القديمة» (دفعة وحدة)
// كل زبون بيشترك بالشي يلي بدو ياه بس. متجر صاحب المنصة عندو كلشي دايماً.
import { q, tx } from './db.js';

export const SERVICE_IDS = ['contacts_new', 'contacts_old'];
export const SERVICE_PERIODS = [1, 3, 6, 12];
const now = () => Math.floor(Date.now() / 1000);
const daysFor = m => (m === 12 ? 365 : m * 30);
const safe = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

export const isSuperTenant = tid => !!q.get('SELECT 1 FROM users WHERE tenant_id = ? AND is_super = 1', Number(tid));

export function listServices({ all = false } = {}) {
  const rows = q.all(`SELECT * FROM services ${all ? '' : 'WHERE is_public = 1'} ORDER BY sort`);
  return rows.map(s => ({
    ...s, features: safe(s.features, []), is_public: !!s.is_public,
    prices: Object.fromEntries(q.all('SELECT months, price FROM service_prices WHERE service_id = ? ORDER BY months', s.id).map(p => [p.months, p.price]))
  }));
}
export const serviceExists = id => !!q.get('SELECT 1 FROM services WHERE id = ?', id);
export function priceForService(id, months) {
  const r = q.get('SELECT price FROM service_prices WHERE service_id = ? AND months = ?', id, months);
  return r ? r.price : null;
}

const row = (tid, sid) => q.get('SELECT * FROM tenant_services WHERE tenant_id = ? AND service_id = ?', Number(tid), sid);
const live = r => !!r && (r.expires_at == null || r.expires_at > now());

// هل الخدمة شغّالة لهالزبون هلق؟ (مدفوعة، ما خلصت، ومو موقّفة بإيدو)
export function hasService(tid, sid) {
  const r = row(tid, sid);
  if (r?.paused) return false;
  if (isSuperTenant(tid)) return true;
  return live(r);
}
export const contactsOn = tid => hasService(tid, 'contacts_new') || hasService(tid, 'contacts_old');

// حالة كل الخدمات لهالزبون (للوحة)
export function servicesFor(tid) {
  const sup = isSuperTenant(tid);
  return Object.fromEntries(SERVICE_IDS.map(sid => {
    const r = row(tid, sid);
    const owned = sup || live(r);
    return [sid, {
      owned, active: owned && !r?.paused, paused: !!r?.paused, forever: sup || (r && r.expires_at == null),
      expires_at: sup ? null : (r?.expires_at ?? null), expired: !!r && !live(r) && !sup, activated_at: r?.activated_at ?? null
    }];
  }));
}

// تفعيل/تمديد: months = 0 → للأبد (دفعة وحدة)
export function grantService(tid, sid, months = 0) {
  const s = q.get('SELECT kind FROM services WHERE id = ?', sid);
  if (!s) throw new Error('الخدمة غير موجودة');
  const r = row(tid, sid);
  let exp = null;
  if (s.kind === 'period' && Number(months) > 0) {
    const base = r && r.expires_at && r.expires_at > now() ? r.expires_at : now();
    exp = base + daysFor(Number(months)) * 86400;
  }
  q.run(`INSERT INTO tenant_services (tenant_id, service_id, expires_at, paused, activated_at) VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(tenant_id, service_id) DO UPDATE SET expires_at = excluded.expires_at, paused = 0, warned_for = NULL`,
    Number(tid), sid, exp, now());
  return row(tid, sid);
}
export function revokeService(tid, sid) { q.run('DELETE FROM tenant_services WHERE tenant_id = ? AND service_id = ?', Number(tid), sid); }
// الإيقاف المؤقت بإيد الزبون (حتى لمتجر صاحب المنصة)
export function setPaused(tid, sid, paused) {
  if (row(tid, sid)) q.run('UPDATE tenant_services SET paused = ? WHERE tenant_id = ? AND service_id = ?', paused ? 1 : 0, Number(tid), sid);
  else if (isSuperTenant(tid)) q.run('INSERT INTO tenant_services (tenant_id, service_id, expires_at, paused) VALUES (?, ?, NULL, ?)', Number(tid), sid, paused ? 1 : 0);
}

export function saveServices(list) {
  tx(() => {
    for (const s of list || []) {
      if (!serviceExists(s.id)) continue;
      q.run('UPDATE services SET name = COALESCE(?, name), description = COALESCE(?, description), features = COALESCE(?, features), currency = COALESCE(?, currency), is_public = COALESCE(?, is_public) WHERE id = ?',
        s.name ? String(s.name).slice(0, 60) : null, s.description != null ? String(s.description).slice(0, 400) : null,
        Array.isArray(s.features) ? JSON.stringify(s.features.map(f => String(f).slice(0, 120)).slice(0, 10)) : null,
        s.currency ? String(s.currency).slice(0, 8) : null, s.is_public === undefined ? null : (s.is_public ? 1 : 0), s.id);
      for (const [m, raw] of Object.entries(s.prices || {})) {
        const months = Number(m), price = Number(raw);
        if (!Number.isInteger(months) || months < 0 || months > 24) continue;
        if (raw === '' || raw == null) { q.run('DELETE FROM service_prices WHERE service_id = ? AND months = ?', s.id, months); continue; }
        if (Number.isFinite(price) && price >= 0) q.run('INSERT INTO service_prices (service_id, months, price) VALUES (?, ?, ?) ON CONFLICT(service_id, months) DO UPDATE SET price = excluded.price', s.id, months, price);
      }
    }
  });
}

// تنبيه قبل 3 أيام من نهاية اشتراك «حفظ كل رقم جديد»
export function checkServicesExpiring(notify) {
  const t = now();
  const rows = q.all(`SELECT ts.*, s.name FROM tenant_services ts JOIN services s ON s.id = ts.service_id
    WHERE ts.expires_at BETWEEN ? AND ? AND COALESCE(ts.warned_for, 0) != ts.expires_at`, t, t + 3 * 86400);
  for (const r of rows) {
    q.run('UPDATE tenant_services SET warned_for = ? WHERE tenant_id = ? AND service_id = ?', r.expires_at, r.tenant_id, r.service_id);
    const days = Math.max(1, Math.ceil((r.expires_at - t) / 86400));
    try { notify(r.tenant_id, `⏰ اشتراك «${r.name}» بينتهي بعد ${days} ${days === 1 ? 'يوم' : 'أيام'}. جدّد من صفحة الاشتراكات حتى ما يوقف.`); } catch {}
  }
}
