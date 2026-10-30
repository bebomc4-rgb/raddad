// رسائل واتساب من رقم المنصة: تنبيهات لصاحب المنصة (طلب دفع جديد) وللمشتركين (تذكير التجديد، تفعيل الاشتراك)
import { q, getSetting } from './db.js';
import { getTenant } from './tenants.js';
import { isActive } from './failover.js';

const digits = s => String(s || '').replace(/\D/g, '');
export function intl(p) {
  let d = digits(p);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '963' + d.slice(1);
  return d;
}
// حساب المنصة: حساب صاحبها (المدير). منو بتطلع الرسائل
export function platformTenant() {
  const r = q.get('SELECT tenant_id FROM users WHERE is_super = 1 ORDER BY id LIMIT 1');
  return r ? getTenant(r.tenant_id) : null;
}
export async function sendFromPlatform(phone, text) {
  const t = platformTenant(), n = intl(phone);
  if (!t || n.length < 9 || !isActive()) return false;
  try {
    const { sendToCustomer } = await import('./whatsapp/index.js');
    await sendToCustomer(t, `${n}@s.whatsapp.net`, { text });
    return true;
  } catch (e) { console.error('[notify] send to', n, e.message); return false; }
}
export const adminPhone = () => getSetting('admin_whatsapp', '0938986875');
export const notifyAdmin = text => sendFromPlatform(adminPhone(), text);
// رقم المشترك: يلي سجّل فيه، وإذا ما في، رقم الواتس المربوط
export function customerPhone(tid) {
  const u = q.get('SELECT phone FROM users WHERE tenant_id = ? AND phone IS NOT NULL ORDER BY id LIMIT 1', tid);
  return u?.phone || getTenant(tid)?.wa_phone || '';
}
export const isPlatform = tid => !!q.get('SELECT 1 FROM users WHERE tenant_id = ? AND is_super = 1', tid);
export function siteLink(path = '') {
  const u = getSetting('public_link', {}).last_url || 'https://k-fast-ai.pages.dev';
  return u.replace(/\/$/, '') + '/next/#' + path;
}
// تذكير المشترك (بس إذا مو حساب المنصة نفسها)
export function remindCustomer(tid, text) {
  if (isPlatform(tid)) return;
  const ph = customerPhone(tid);
  if (ph) sendFromPlatform(ph, text).catch(() => {});
}
