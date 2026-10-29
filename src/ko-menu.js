// ko-menu.js — قائمة أقسام KO SPORT بالواتس، بدون ذكاء اصطناعي (فوري وببلاش):
//   الزبون بيكتب «ko» (أو «القائمة») ← المجموعات بأرقام ← بيبعت رقم ← أقسام المجموعة ← بيبعت رقم ← صور القسم (ألبوم)
//   «كمان» = صور تانية من نفس القسم، «0» = رجوع، وأي سؤال تاني بيروح للمجيب الذكي عادي.
import { koMenuData, koInCategory, koImage, koCaption, koFresh } from './ko-catalog.js';

const state = new Map(); // contactId → { level: 'groups'|'cats'|'shown', gi, cat, offset, at }
const TTL = 30 * 60_000;
const PER_PAGE = 6;
const norm = (t) => String(t || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[️⃣]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْـ]/g, '')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const MENU = /^(ko|كو|كي او|k o)$|^(ال)?(قائمه|قايمه|اقسام|منيو|كتالوج|كاتالوج)( لو سمحت| من فضلك)?$|^menu$|^(بدي|ابعتلي|ورجيني|فرجيني|وريني) (ال)?(قائمه|قايمه|اقسام|منيو|كتالوج)$|^شو (في )?(عندكن|عندكم|عندك)$/;
const MORE = /^(كمان|غيرهن|غيرن|غيرها|غيرهم|المزيد|التالي|التاليه|بعدهن|more)$/;
const BACK = /^(0|رجوع|ارجع|رجعني)$/;
const NUMS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const num = (i) => (i < 10 ? NUMS[i] : `*${i + 1}.*`);

export function koMenuReset(contactId) { state.delete(contactId); }

// تذكير صغير تحت رد المجيب: «اكتب ko» — أول رد للزبون، وبعدين مرة كل 24 ساعة (مو بكل رسالة)
const HINT = '💡 ابعتلي *ko* وبتطلعلك كل أقسام المحل، بتختار القسم وببعتلك صورو.';
const hinted = new Map(); // contactId → آخر مرة انبعت فيها التذكير
export function koMenuHint(contactId) {
  const now = Date.now(), last = hinted.get(contactId) || 0;
  if (now - last < 24 * 3600_000) return '';
  if (state.has(contactId)) return ''; // عم يستعمل القائمة هلق
  hinted.set(contactId, now);
  if (hinted.size > 5000) hinted.delete(hinted.keys().next().value);
  return HINT;
}

// true = انبعت رد من القائمة (لا تسأل الذكاء الاصطناعي)
export async function koMenu(contact, text, send) {
  const t = norm(text);
  if (!t || t.length > 40) return false;
  const now = Date.now();
  let s = state.get(contact.id);
  if (s && now - s.at > TTL) { state.delete(contact.id); s = null; }
  const isMenu = MENU.test(t);
  if (!isMenu && !s) return false;
  const groups = await koMenuData();
  if (!groups || !groups.length) return false;

  const pick = (list, labelOf) => {
    if (/^\d{1,2}$/.test(t)) { const n = +t; return n >= 1 && n <= list.length ? list[n - 1] : null; }
    return list.find((x) => norm(labelOf(x)) === t) || (t.length >= 3 ? list.find((x) => norm(labelOf(x)).includes(t)) : null) || null;
  };
  const showGroups = async () => {
    if (groups.length === 1) return showCats(0);
    state.set(contact.id, { level: 'groups', at: now });
    await send(`أهلين فيك بـ *KO SPORT* 👋\nابعتلي رقم القسم يلي بدك ياه:\n\n${groups.map((g, i) => `${num(i)} ${g.icon} ${g.name}`).join('\n')}`);
    return true;
  };
  const showCats = async (gi) => {
    const g = groups[gi];
    state.set(contact.id, { level: 'cats', gi, at: now });
    await send(`${g.icon} *${g.name}*\nابعتلي رقم يلي بدك تشوف صورو:\n\n${g.cats.map((c, i) => `${num(i)} ${c.label}`).join('\n')}${groups.length > 1 ? '\n\n0️⃣ رجوع للأقسام' : ''}`);
    return true;
  };
  const showProducts = async (gi, c, offset) => {
    const { items, total } = await koInCategory(c.name, offset, PER_PAGE);
    if (!items.length) { await send(`ما في موديلات تانية هلق بـ ${c.label} 🙏 اكتب *ko* لترجع للأقسام.`); return true; }
    if (!offset) await send(`هي موديلات *${c.label}* 👇`);
    for (const p of items) {
      try { await send(koCaption(p), (await koImage(p.image_url)) || undefined); }
      catch (e) { console.error('[ko-menu] card', e.message); try { await send(koCaption(p)); } catch {} }
    }
    koFresh(contact.id, items.map((p) => p.id));
    const left = total - offset - items.length;
    state.set(contact.id, { level: 'shown', gi, cat: c, offset: offset + items.length, at: now });
    await send(`${left > 0 ? `في كمان ${left} موديل، اكتب *كمان* لتشوفهن.\n` : ''}كل موديلات ${c.label} عالموقع:\n${c.url}\n\nعجبك شي؟ ابعتلي اسمو 👌 أو اكتب *ko* لترجع للأقسام.`);
    return true;
  };

  if (isMenu) return showGroups();
  if (BACK.test(t)) return s.level === 'shown' ? showCats(s.gi) : showGroups();
  if (s.level === 'shown') {
    if (MORE.test(t)) return showProducts(s.gi, s.cat, s.offset);
    return false; // سؤال عن منتج بعد الصور: المجيب الذكي بيكمّل (والقائمة بتضل محفوظة لـ «كمان» و«0»)
  }
  const found = s.level === 'groups' ? pick(groups, (x) => x.name) : pick(groups[s.gi].cats, (x) => x.label);
  if (found) return s.level === 'groups' ? showCats(groups.indexOf(found)) : showProducts(s.gi, found, 0);
  if (/^\d{1,2}$/.test(t)) { await send(`هالرقم مو موجود بالقائمة 🙏 ابعتلي رقم من الأرقام يلي فوق.`); return true; }
  state.delete(contact.id); // كتب شي تاني: المجيب الذكي بيرد
  return false;
}
