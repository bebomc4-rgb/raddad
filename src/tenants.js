// المشتركين: إعدادات الوكيل، المعرفة، الخطة والحدود
import { q, usageToday, getSetting } from './db.js';

export const DEFAULT_SETTINGS = {
  agent_name: 'سارة',
  tone: 'ودود ومحترف',
  dialect: 'سورية شامية',
  emoji: true,
  chatty: true,               // بيفتح سيرة وبيمزح بلطف
  understand_media: true,     // بيسمع الرسائل الصوتية وبيشوف الصور
  goal: 'بيع المنتجات وأخذ الطلب كامل (الاسم، الرقم، العنوان، المقاس/اللون)',
  greeting: '',
  extra_instructions: '',
  reply_delay_sec: 4,        // تجميع رسائل العميل قبل الرد = رسائل أقل
  typing_indicator: true,
  send_images: true,
  max_images: 2,
  human_takeover_minutes: 60, // لما ترد أنت من موبايلك، البوت بيسكت هالمدة لهالعميل
  handoff_keywords: 'موظف، انسان، مدير، شكوى',
  ignore_numbers: '',
  notify_number: '',          // رقم صاحب المتجر لإشعارات الطلبات
  owner_numbers: '',          // أرقام صاحب المتجر: بيبعت منها صور وبيطلب تعديلها
  notify_orders: true,
  bot_schedule: 'always',     // always | off_hours (بس لما الموظفين مو موجودين) | work_hours
  work_from: '09:00',
  work_to: '17:00',
  timezone_offset: 3,
  style_profile: '',          // ملخص أسلوب صاحب المتجر (بيتعبّى من التحليل أو يدوي)
  use_examples: true,         // يستخدم أمثلة من ردودك الحقيقية
  learn_from_replies: true,   // يتعلّم لحاله من كل رد بتردّه أنت
  learn_from_history: true,   // يقرا آخر محادثاتك لما تربط الرقم أول مرة
  test_mode: false,           // وضع الاختبار: البوت بيرد بس على أرقام محددة
  test_numbers: '',
  gemini_prompts: ['', '', ''], // 3 برومبتات ثابتة لكل منتج
  contacts_prefix: 'زبون',     // اسم الرقم المحفوظ: «زبون 1234»
  site_url: '',                // موقع الزبون (منسحب منو المنتجات)
  site_sync: false,            // تحديث المنتجات من الموقع كل 6 ساعات
  status_auto: { enabled: false, per_day: 1 } // حالات واتساب أوتوماتيك
};

export const DEFAULT_KNOWLEDGE = {
  business_name: '',
  business_type: 'متجر أونلاين',
  about: '',
  currency: 'USD',
  delivery: '',
  payment: '',
  returns: '',
  location: '',
  hours: '',
  contact: '',
  website: '',
  faq: ''
};

export function getTenant(id) {
  const t = q.get('SELECT * FROM tenants WHERE id = ?', id);
  if (!t) return null;
  t.settings = { ...DEFAULT_SETTINGS, ...safeJSON(t.settings) };
  t.knowledge = { ...DEFAULT_KNOWLEDGE, ...safeJSON(t.knowledge) };
  return t;
}

export function getPlan(tenant) {
  let planId = tenant.plan_id;
  if (planId !== 'free' && tenant.plan_expires_at && tenant.plan_expires_at < Date.now() / 1000) planId = 'free';
  return q.get('SELECT * FROM plans WHERE id = ?', planId) || q.get("SELECT * FROM plans WHERE id = 'free'");
}

// اسم المتجر بالرابط (بيدعم العربي)، بيتثبّت أول مرة وما بيتغيّر
export function ensureSlug(t) {
  if (t.slug) return t.slug;
  const base = String(t.name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'store';
  const slug = q.get('SELECT 1 FROM tenants WHERE slug = ?', base) ? `${base}-${t.id}` : base;
  q.run('UPDATE tenants SET slug = ? WHERE id = ?', slug, t.id);
  t.slug = slug;
  return slug;
}

export const PERIODS = [1, 3, 6, 12];
export const periodDays = m => (m === 12 ? 365 : m * 30);
// السعر المحدد من الإدارة لهالمدة، وإلا السعر الشهري × عدد الأشهر
export function priceFor(planId, months) {
  const row = q.get('SELECT price FROM plan_prices WHERE plan_id = ? AND months = ?', planId, months);
  if (row) return row.price;
  return (q.get('SELECT price_monthly FROM plans WHERE id = ?', planId)?.price_monthly || 0) * months;
}
// الاشتراك المدفوع انتهى؟ (البوت بيوقف لحد التجديد)
export function subscriptionExpired(t) {
  return t.plan_id !== 'free' && !!t.plan_expires_at && t.plan_expires_at < Date.now() / 1000;
}

// هل بيقدر يستخدم الذكاء الاصطناعي هلق؟
export function aiAllowance(tenant) {
  const plan = getPlan(tenant);
  const usage = usageToday(tenant.id);
  const ownKey = tenant.ai_provider !== 'platform' && tenant.ai_key_enc && plan.allow_own_key;
  if (ownKey) return { ok: true, ownKey: true, plan, usage };
  // ردود بلا حدود لكل المشتركين (قرار صاحب المنصة)
  return { ok: true, ownKey: false, plan, usage, limit: Infinity };
}

export function safeJSON(s, fb = {}) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(s) ?? fb; } catch { return fb; }
}

export function brand() {
  return getSetting('brand', { name: 'ردّاد', tagline: 'وكيل مبيعات ذكي على واتساب', color: '#0E7A5A' });
}
