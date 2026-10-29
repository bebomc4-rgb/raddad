// واجهة موحّدة: البوت ما بيهمه إذا الرقم مربوط بـ QR أو بالربط الرسمي
import * as qr from './baileys.js';
import * as cloud from './cloud.js';

export async function sendToCustomer(tenant, jid, { text, image, audio }) {
  if (tenant.wa_provider === 'sim') return { id: 'sim-' + Math.random().toString(36).slice(2) }; // وضع الاختبار
  if (tenant.wa_provider === 'cloud') return cloud.send(tenant, jid, { text, image });
  return qr.send(tenant.id, jid, { text, image, audio });
}

export async function typing(tenant, jid) {
  if (tenant.wa_provider === 'sim') return;
  if (tenant.wa_provider === 'cloud') return; // الربط الرسمي: مؤشر الكتابة مرتبط بقراءة رسالة محددة، منتجاهله
  return qr.typing(tenant.id, jid);
}

export function status(tenant) {
  if (tenant.wa_provider === 'sim') return { provider: 'sim', status: 'open', phone: '963900000000' };
  if (tenant.wa_provider === 'cloud') return cloud.status(tenant);
  return qr.status(tenant.id);
}

// حفظ رقم الزبون بجهات الاتصال (بس للربط بالـ QR)
export async function saveContact(tenant, phone, name, force = false) {
  if (!tenant || tenant.wa_provider === 'sim' || tenant.wa_provider === 'cloud') return false;
  return qr.saveContact(tenant.id, phone, name, force);
}
export function bookName(tenant, phone) { return tenant && tenant.wa_provider !== 'sim' && tenant.wa_provider !== 'cloud' ? qr.bookName(tenant.id, phone) : ''; }
export function realName(tenant, phone) { return tenant ? qr.realName(tenant.id, phone) : ''; }
export async function setRealName(tenant, phone, name, area = '') {
  if (!tenant || tenant.wa_provider === 'sim' || tenant.wa_provider === 'cloud') return false;
  return qr.setRealName(tenant.id, phone, name, area);
}
