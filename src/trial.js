// التجربة المجانية مربوطة برقم الواتساب (مو بالحساب): كل رقم بياخد تجربة مرة وحدة
import { q, getSetting } from './db.js';
import { subscriptionExpired } from './tenants.js';
import { emit } from './events.js';

export const BLOCKED_MSG = 'هاد الرقم استخدم التجربة، اشترك أو تواصل معنا';
const digits = s => String(s || '').replace(/\D/g, '');

export function trialSeconds() {
  const t = getSetting('trial', { value: 3, unit: 'days' });
  return Math.max(1, Number(t.value) || 1) * (t.unit === 'hours' ? 3600 : 86400);
}

function raiseAlert(tenant, phone, reason) {
  if (q.get("SELECT 1 FROM trial_alerts WHERE tenant_id = ? AND phone = ? AND status = 'open'", tenant.id, phone)) return;
  q.run('INSERT INTO trial_alerts (tenant_id, phone, reason) VALUES (?, ?, ?)', tenant.id, phone, reason);
  for (const { tenant_id } of q.all('SELECT DISTINCT tenant_id FROM users WHERE is_super = 1'))
    emit(tenant_id, 'notice', { text: `⚠️ ${tenant.name} ربط رقم ${phone}: ${reason}` });
}

// بيرجع { ok, code, message, ends_at }: code = ok | paid | trial | ended | used | linked
export function trialStatus(t) {
  const ok = { ok: true, code: 'ok' };
  if (q.get('SELECT 1 FROM users WHERE tenant_id = ? AND is_super = 1', t.id)) return ok;
  const phone = digits(t.wa_phone);
  if (!phone) return ok;
  const now = Math.floor(Date.now() / 1000);
  const paid = t.plan_id !== 'free' && !subscriptionExpired(t);
  let row = q.get('SELECT * FROM trial_numbers WHERE phone = ?', phone);
  if (!row) {
    // ما في تجربة تلقائية (قرار صاحب المنصة): كل الميزات مقفولة لحتى المدير يفعّلها أو يعطي تجربة
    if (!getSetting('auto_trial', false)) return paid ? { ok: true, code: 'paid' } : { ok: false, code: 'locked', message: 'المجيب مقفول. بيتفعّل لما تشترك' };
    // رقم جديد: بنسجّله، وإذا مشترك مدفوع بنعتبر التجربة مستهلكة (بدون مدة)
    q.run('INSERT INTO trial_numbers (phone, tenant_id, started_at, ends_at) VALUES (?, ?, ?, ?)', phone, t.id, now, paid ? now : now + trialSeconds());
    row = q.get('SELECT * FROM trial_numbers WHERE phone = ?', phone);
  }
  if (paid) return { ok: true, code: 'paid' };
  if (row.tenant_id !== t.id) {
    const other = q.get("SELECT 1 FROM tenants WHERE id = ? AND status = 'active' AND wa_phone = ?", row.tenant_id, phone);
    raiseAlert(t, phone, other ? 'الرقم مربوط بحساب تاني شغّال' : 'الرقم استخدم التجربة من قبل');
    return { ok: false, code: other ? 'linked' : 'used', message: other ? 'هاد الرقم مربوط بحساب تاني، اشترك أو تواصل معنا' : BLOCKED_MSG };
  }
  if (row.ends_at > now) return { ok: true, code: 'trial', ends_at: row.ends_at };
  return { ok: false, code: 'ended', message: 'انتهت التجربة المجانية، اشترك ليرجع الوكيل يرد' };
}

// "اسمح بتجربة جديدة": الرقم بينسب للحساب الطالب وبتبلّش تجربة من جديد
export function allowNewTrial(alertId) {
  const a = q.get("SELECT * FROM trial_alerts WHERE id = ? AND status = 'open'", alertId);
  if (!a) return false;
  const now = Math.floor(Date.now() / 1000);
  q.run('INSERT INTO trial_numbers (phone, tenant_id, started_at, ends_at) VALUES (?, ?, ?, ?) ON CONFLICT(phone) DO UPDATE SET tenant_id = excluded.tenant_id, started_at = excluded.started_at, ends_at = excluded.ends_at',
    a.phone, a.tenant_id, now, now + trialSeconds());
  q.run("UPDATE trial_alerts SET status = 'allowed' WHERE phone = ? AND status = 'open'", a.phone);
  return true;
}
