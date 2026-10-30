// تنبيه انتهاء الاشتراك: قبل 3 أيام باللوحة (إشعار مباشر + شريط) وعلى واتساب، مرة واحدة لكل فترة
import { q } from './db.js';
import { getTenant } from './tenants.js';
import { notifyOwner } from './agent.js';
import { isActive } from './failover.js';
import { checkServicesExpiring } from './services.js';
import { remindCustomer, siteLink } from './notify.js';

const WARN_DAYS = 3;

export function checkExpiring() {
  if (!isActive()) return;
  const now = Math.floor(Date.now() / 1000);
  const rows = q.all(`SELECT id, plan_expires_at FROM tenants WHERE plan_id != 'free' AND status = 'active'
    AND plan_expires_at BETWEEN ? AND ? AND COALESCE(expiry_warned_for, 0) != plan_expires_at`, now, now + WARN_DAYS * 86400);
  for (const r of rows) {
    // بنعلّم أول شي حتى ما يتكرر التنبيه إذا فشل الإرسال
    q.run('UPDATE tenants SET expiry_warned_for = ? WHERE id = ?', r.plan_expires_at, r.id);
    const days = Math.max(1, Math.ceil((r.plan_expires_at - now) / 86400));
    notifyOwner(getTenant(r.id), `⏰ اشتراكك بينتهي بعد ${days} ${days === 1 ? 'يوم' : 'أيام'}. جدّد من صفحة الاشتراك حتى ما يوقف الوكيل عن الرد.`);
    remindCustomer(r.id, `مرحبا 👋\nاشتراكك بـ «المجيب الذكي» بـ K FAST AI بيخلص بعد ${days} ${days === 1 ? 'يوم' : 'أيام'}.\nجدّد من هون حتى ما يوقف: ${siteLink('/bot')}`);
  }
  // نفس الشي لاشتراكات حفظ الأرقام
  checkServicesExpiring((tid, text, name) => { notifyOwner(getTenant(tid), text); remindCustomer(tid, `مرحبا 👋\n${text.replace('⏰ ', '')}\nجدّد من هون: ${siteLink('/numbers/new')}`); });
}

export function startSubscriptionWorker() {
  checkExpiring();
  setInterval(checkExpiring, 3600_000).unref();
}
