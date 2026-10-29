// تطبيع النص العربي للبحث: بنوحّد الألف والياء والتاء المربوطة ومنشيل التشكيل
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalize(s = '') {
  return String(s)
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// كلمات شائعة ما إلها قيمة بالبحث
const STOP = new Set(('في من على عن الى الي مع هل شو ايش اي ما لا او و يا بدي بدنا عندكم عندكن عندك ' +
  'ممكن لو سمحت كم قديش اديش شي هاد هذا هذه هيدا هيدي يلي الي انا انت اذا ازا كيف وين متى ليش منشان مشان ' +
  'the a an is are do you have i want for of to and or in on with price how much').split(' '));

export function tokens(s) {
  return normalize(s).split(' ').filter(w => w.length > 1 && !STOP.has(w));
}

// حذف "ال" التعريف لتحسين المطابقة
export function stem(w) {
  if (w.length > 4 && w.startsWith('ال')) w = w.slice(2);
  if (w.length > 4 && (w.startsWith('وال') || w.startsWith('بال') || w.startsWith('لل'))) w = w.slice(w.startsWith('لل') ? 2 : 3);
  if (w.length > 4 && (w.endsWith('ات') || w.endsWith('ين') || w.endsWith('ون'))) w = w.slice(0, -2);
  return w;
}

export function phoneFromJid(jid = '') {
  // معرّفات @lid الجديدة مو أرقام تلفونات، فما منعاملها كرقم
  if (/@lid$/.test(String(jid))) return null;
  const n = String(jid).split('@')[0].split(':')[0];
  return /^\d{6,15}$/.test(n) ? n : null;
}

export function clamp(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) : s;
}
