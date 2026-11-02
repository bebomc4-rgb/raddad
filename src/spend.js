// مصروف Gemini المدفوع (صاحب المنصة، 2 تشرين التاني 2026): Google ما بيعطي الرصيد بمفتاح الـ API،
// فمنحسب نحنا كل صورة بتطلع بسعرها الرسمي، ومنطرحها من آخر رصيد كتبو صاحب المنصة (من صفحة Billing بـ AI Studio).
import { getSetting, setSetting } from './db.js';

// السعر الرسمي لكل صورة (ai.google.dev، تشرين الأول 2026)
const PRICE = {
  'gemini-nano-banana-2.1': { '1K': 0.0336, '2K': 0.0504, '4K': 0.0756 },
  'gemini-3.1-flash-lite-image': { '1K': 0.0336, '2K': 0.0336, '4K': 0.0336 },
  'gemini-3.1-flash-image': { '1K': 0.067, '2K': 0.101, '4K': 0.151 },
  'gemini-3-pro-image': { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
  'gemini-2.5-flash-image': { '1K': 0.039, '2K': 0.039, '4K': 0.039 }
};
export const imagePrice = (model, size = '1K') => {
  const m = PRICE[String(model || '').replace(/-preview$/, '')] || PRICE['gemini-3-pro-image'];
  return m[['1K', '2K', '4K'].includes(size) ? size : '1K'];
};
const KEY = 'ai_spend';
const get = () => getSetting(KEY, null) || { balance: null, balance_at: null, since: 0, log: [] };
const day = t => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);

// صورة طلعت بمفتاح مدفوع
export function recordImage(model, size, keyName = '', what = '') {
  if (!/مدفوع|paid|pro/i.test(keyName || '')) return; // المفاتيح المجانية ما بتكلّف
  try {
    const s = get(), cost = imagePrice(model, size), at = Date.now();
    s.since = Math.round(((s.since || 0) + cost) * 10000) / 10000;
    s.log = [{ at, model, size, cost, what: String(what || '').slice(0, 60) }, ...(s.log || [])].slice(0, 2000);
    setSetting(KEY, s);
  } catch (e) { console.error('[spend]', e.message); }
}
export function setBalance(amount) {
  const s = get(); s.balance = Math.round(Number(amount) * 100) / 100; s.balance_at = Date.now(); s.since = 0;
  setSetting(KEY, s); return summary();
}
export function summary() {
  const s = get(), now = Date.now(), today = day(now), month = today.slice(0, 7);
  const sum = f => Math.round((s.log || []).filter(f).reduce((a, x) => a + x.cost, 0) * 100) / 100;
  const left = s.balance == null ? null : Math.round((s.balance - (s.since || 0)) * 100) / 100;
  const perImg = imagePrice('gemini-nano-banana-2.1', '1K');
  return {
    balance: s.balance, balance_at: s.balance_at, spent_since: Math.round((s.since || 0) * 100) / 100, left,
    today: sum(x => day(x.at) === today), month: sum(x => day(x.at).slice(0, 7) === month),
    images_today: (s.log || []).filter(x => day(x.at) === today).length,
    images_left: left == null ? null : Math.max(0, Math.floor(left / perImg)),
    recent: (s.log || []).slice(0, 15)
  };
}
