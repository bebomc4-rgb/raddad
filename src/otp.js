// كود تأكيد رقم الزبون لمتجر KO SPORT: الموقع بيطلب، والمنصة بتبعت الكود على الواتساب من رقمها.
// ما في أي مفتاح سري مشترك: الموقع بيوقّع الطلب بمفتاحه الخاص، ونحنا منتحقق بالمفتاح العام يلي بينشره الموقع نفسه.
import crypto from 'node:crypto';
import { getSetting } from './db.js';
import { sendFromPlatform, intl } from './notify.js';
import { rateLimit } from './security.js';
import { HttpError } from './http.js';

const need = (c, s, m) => { if (!c) throw new HttpError(s, m); };
const origin = () => String(getSetting('ko_otp_origin', 'https://ko-sport.online')).replace(/\/$/, '');
let key = null, keyAt = 0;
async function pubKey(force) {
  if (key && !force && Date.now() - keyAt < 3600_000) return key;
  const r = await fetch(origin() + '/api/acct/otp-key', { signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  key = crypto.createPublicKey({ key: j.jwk, format: 'jwk' }); keyAt = Date.now();
  return key;
}
const seen = new Map();
setInterval(() => { const n = Date.now(); for (const [k, t] of seen) if (n - t > 300_000) seen.delete(k); }, 300_000).unref();

async function verify(str, sig) {
  const data = Buffer.from(str), s = Buffer.from(String(sig || ''), 'base64url');
  const ok = async force => crypto.verify('sha256', data, { key: await pubKey(force), dsaEncoding: 'ieee-p1363' }, s);
  return (await ok(false)) || (await ok(true));
}
function fresh(ts, nonce) {
  need(/^[A-Za-z0-9_-]{8,40}$/.test(nonce || ''), 400, 'طلب ناقص');
  need(Math.abs(Date.now() - Number(ts)) < 120_000, 400, 'انتهى وقت الطلب');
  need(!seen.has(nonce), 409, 'مكرر');
}

// «سجّل بالواتساب»: الموقع بيفتح رمز (KO-XXXXXX)، الزبون بيبعتو من واتسابو لرقم المتجر، فمنعرف رقمو أكيد
const open = new Map(); // رمز → { at, phone }
const early = new Map(); // رمز وصل بالواتساب قبل ما الموقع يلحق يفتحو (ثواني) → { at, phone }
setInterval(() => { const n = Date.now(); for (const [k, v] of open) if (n - v.at > 20 * 60_000) open.delete(k); for (const [k, v] of early) if (n - v.at > 2 * 60_000) early.delete(k); }, 60_000).unref();
export async function koOpen(body) {
  const { t, ts, nonce, sig } = body || {};
  need(/^[A-Z0-9]{6}$/.test(t || ''), 400, 'رمز غلط'); fresh(ts, nonce);
  need(await verify(`open|${t}|${ts}|${nonce}`, sig), 403, 'توقيع غلط');
  seen.set(nonce, Date.now());
  need(open.size < 5000, 429, 'كتير');
  if (!open.has(t)) open.set(t, { at: Date.now(), phone: early.get(t)?.phone || '' });
  early.delete(t);
  return { ok: true };
}
export async function koClaim(body) {
  const { t, ts, nonce, sig } = body || {};
  need(/^[A-Z0-9]{6}$/.test(t || ''), 400, 'رمز غلط'); fresh(ts, nonce);
  need(await verify(`claim|${t}|${ts}|${nonce}`, sig), 403, 'توقيع غلط');
  seen.set(nonce, Date.now());
  const o = open.get(t);
  return { ok: true, known: !!o, phone: o?.phone || '' };
}
// من رسائل الواتساب الواصلة لرقم المتجر: إذا فيها رمز مفتوح، منسجّل رقم المرسل. بيرجع true إذا الرسالة كانت رمز تأكيد
export function waClaim(text, phone) {
  const m = String(text || '').toUpperCase().match(/KO-([A-Z0-9]{6})\b/);
  if (!m || !phone) return false;
  const o = open.get(m[1]);
  if (!o) { if (early.size < 2000 && /تأكيد حسابي|دخول لحسابي/.test(String(text))) { early.set(m[1], { at: Date.now(), phone }); return true; } return false; }
  if (!o.phone) o.phone = phone;
  return true;
}

export async function koOtp(body) {
  const { phone, code, ts, nonce, sig } = body || {};
  need(/^09\d{8}$/.test(phone || '') && /^\d{6}$/.test(code || '') && /^[A-Za-z0-9_-]{8,40}$/.test(nonce || '') && sig, 400, 'طلب ناقص');
  need(Math.abs(Date.now() - Number(ts)) < 120_000, 400, 'انتهى وقت الطلب');
  need(!seen.has(nonce), 409, 'مكرر');
  const data = Buffer.from(`${phone}|${code}|${ts}|${nonce}`), s = Buffer.from(String(sig), 'base64url');
  const ok = async force => crypto.verify('sha256', data, { key: await pubKey(force), dsaEncoding: 'ieee-p1363' }, s);
  need((await ok(false)) || (await ok(true)), 403, 'توقيع غلط');
  seen.set(nonce, Date.now());
  need(rateLimit('koOtp:' + phone, 5, 3600_000), 429, 'كتير');
  const sent = await sendFromPlatform(intl(phone), `كود تأكيد حسابك بمتجر KO SPORT:\n*${code}*\n\nاكتبو بالموقع لتكمّل التسجيل. صالح لـ 10 دقايق، لا تعطيه لحدا.`);
  need(sent, 503, 'الواتساب مو متصل هلق');
  return { ok: true };
}
