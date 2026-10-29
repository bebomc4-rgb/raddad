// ko-catalog.js — مجيب KO SPORT بيدوّر على المنتجات بالموقع (ko-sport.pages.dev)
// البوت بيحفظ نسخة من كل منتجات الموقع بالذاكرة وبيحدّثها كل دقيقة،
// فالبحث بيصير فوري (بدون انتظار النت) وأي تعديل بالموقع بيوصل خلال دقيقة.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const KO_STORE = (process.env.KO_STORE_URL || 'https://ko-sport.pages.dev').replace(/\/+$/, '');
export const KO_TENANT_ID = Number(process.env.KO_TENANT_ID || 1);
export const KO_CARDS = 3; // كم منتج بيبعت (كل واحد برسالة لحالو)

// الربط بينطفى ويشتغل من لوحة تحكم الموقع (قسم «المجيب K FAST»). مطفي = المجيب بيرجع لمنتجاتو المحلية متل ما كان
let linked = true;
export function isKoTenant(tenant) { return linked && Number(tenant?.id) === KO_TENANT_ID; }

// ===== نسخة المنتجات من الموقع =====
let cat = null, catAt = 0, loading = null, vocab = new Map();
async function load() {
  const r = await fetch(`${KO_STORE}/api/catalog`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const was = linked; linked = j.store?.bot_link !== false;
  if (was !== linked) console.log(`[ko-catalog] link with website: ${linked ? 'ON' : 'OFF (local products)'}`);
  if (!Array.isArray(j.products) || !j.products.length) throw new Error('no products');
  cat = j.products.filter(p => p && p.name && Number(p.price_usd) > 0).map(p => ({ ...p, _n: arN(p.name), _c: arN((p.collections || [p.category]).join(' ')), _o: arN((p.options || []).join(' ')), _d: arN(String(p.description || '').slice(0, 300)) }));
  catAt = Date.now();
  const v = new Map();
  for (const p of cat) for (const w of (p._n + ' ' + p._c).split(' ')) if (w.length >= 3 && !/^\d+$/.test(w)) v.set(w, (v.get(w) || 0) + 1);
  vocab = v;
  console.log(`[ko-catalog] ${cat.length} products loaded from ${KO_STORE}`);
}
function refresh() {
  if (!loading) loading = load().catch(e => console.error('[ko-catalog] load:', e.message)).finally(() => { loading = null; });
  return loading;
}
// null = ما قدرنا نجيب ولا مرة من الموقع
async function catalog() {
  if (!cat) await refresh();                       // أول مرة منستنى
  else if (Date.now() - catAt > 60_000) refresh(); // بعدين منحدّث بالخلفية بدون ما نأخّر الرد
  return cat;
}
refresh(); setInterval(refresh, 60_000).unref?.();

// ===== البحث (نفس بحث الموقع: عربي/سوري/ماركات) =====
const arN = (t) => String(t || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['بدي', 'عندكن', 'عندكم', 'عندك', 'في', 'شو', 'كم', 'سعر', 'حق', 'قديش', 'اريد', 'بدنا', 'من', 'على', 'مع', 'هل', 'يا', 'لو', 'the', 'a', 'ابغى', 'ممكن', 'اي', 'شي', 'منتج', 'غير', 'غيرها', 'غيره', 'موديلات', 'موديل', 'شوفي', 'شوف', 'فرجيني', 'ورجيني', 'وريني', 'كمان', 'تاني', 'تانيه', 'بتنصحني', 'نصحني', 'احسن', 'اله', 'الها', 'هاد', 'هيدا', 'هي', 'هو', 'انا', 'انت', 'مرحبا', 'اهلين', 'كيفك', 'شكرا', 'يسلمو', 'تمام', 'ok', 'اوك', 'صوره', 'صور', 'صورت', 'بعتلي', 'ابعتلي', 'ابعت', 'بعت', 'كل', 'شوفلي', 'عنا', 'عندو', 'لون', 'الوان', 'مقاس', 'سعره', 'سعرو', 'كم', 'بكم', 'قديه', 'متوفر', 'موجود', 'عندكون', 'انو', 'اني', 'يعني', 'ايه', 'لا', 'طيب', 'خلص', 'اوكي', 'تكرم', 'هيك', 'هلق', 'هلا', 'بس', 'كتير', 'شي', 'وين', 'ليش', 'كيف', 'مين', 'قياس', 'لارج', 'ميديوم', 'سمول', 'xl', 'xxl', 'اعتمدت', 'معتمد', 'اعتمد', 'غالي', 'ارخص', 'رخيص']);
const SYN = { رابر: 'باندج', رابرز: 'باندج', راب: 'باندج', رابز: 'باندج', ورابس: 'باندج', wraps: 'باندج', wrap: 'باندج', باند: 'مطاط', بندات: 'مطاط', ريسيتن: 'مطاط', ريزستنس: 'مطاط', رزستنس: 'مطاط', ريسستنس: 'مطاط', resistance: 'مطاط', band: 'مطاط', شورتات: 'شورت', شورتي: 'شورت', short: 'شورت', shorts: 'شورت', نط: 'قفز', نطه: 'قفز', فينوم: 'venum', venom: 'venum', ايفرلاست: 'everlast', ايفرلست: 'everlast', اديداس: 'adidas', اديدس: 'adidas', نايك: 'nike', نايكي: 'nike', فايرتكس: 'fairtex', هوتزو: 'hotzo', بوكا: 'buka', توينز: 'twins', ريبوك: 'reebok', جوانتي: 'قفاز', جوانتيات: 'قفاز', كلفوف: 'كفوف', كفوفي: 'كفوف', حارس: 'حراسه', غولر: 'حراسه', واقي: 'واقيه', شنطه: 'حقيبه', قناني: 'مطره', اثقال: 'اوزان', دمبل: 'دامبل', دمبلز: 'دامبل', لستك: 'مطاط', لاستيك: 'مطاط', بوكس: 'ملاكمه', ملاكمي: 'ملاكمه', تيشرت: 'كنزه', بلوزه: 'كنزه' };
// ===== تصحيح الأخطاء الإملائية (جوجاتسو ← جوجوتسو) =====
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const strip = (w) => w.replace(/^(وال|بال|لل|ال|و|ب)(?=..)/, '');
function known(t) {
  if (SYN[t] || learned.words[t] || /\d/.test(t) || t.length < 3) return true;
  if (vocab.has(t) || vocab.has(strip(t)) || vocab.has('ال' + t)) return true;
  for (const w of vocab.keys()) if (w.length >= 3 && (w.includes(t) || (t.length >= 4 && t.includes(w) && w.length >= t.length - 2))) return true;
  return false;
}
// بيرجّع لكل كلمة غلط: أقرب كلمات من أسماء المنتجات
function fixWord(t) {
  const max = t.length >= 6 ? 2 : t.length >= 4 ? 1 : 0;
  if (!max) return [];
  let best = 9, c = [];
  for (const [w, f] of vocab) {
    const d = Math.min(lev(t, w), lev(strip(t), strip(w)));
    if (d < best) { best = d; c = [[w, f]]; } else if (d === best) c.push([w, f]);
  }
  if (best > max) return [];
  c.sort((a, b) => b[1] - a[1]);
  // إذا وحدة أشهر بكتير من الباقي منعتبرها هي المقصودة
  if (c.length > 1 && c[0][1] >= 3 * c[1][1]) c = [c[0]];
  return [...new Set(c.map(x => strip(x[0])))].slice(0, 3);
}
export function koSpell(q) {
  const fixes = [], ambiguous = [], unknown = [];
  for (const t of arN(q).split(' ')) {
    if (!t || STOP.has(t) || known(t)) continue;
    const c = fixWord(t);
    if (c.length === 1) fixes.push({ from: t, to: c[0] });
    else if (c.length > 1) ambiguous.push({ from: t, options: c });
    else if (t.length >= 4) unknown.push(t);
  }
  return { fixes, ambiguous, unknown };
}

function scoreAll(list, q, sp = koSpell(q)) {
  const toks = arN(q).split(' ').filter(t => t.length > 1 || /\d/.test(t));
  const keys = toks.filter(t => !STOP.has(t));
  if (!keys.length) return [];
  const alt = new Map([...sp.fixes.map(f => [f.from, [f.to]]), ...sp.ambiguous.map(a => [a.from, a.options])]);
  const T = keys.map(t => [t, ...(SYN[t] && SYN[t] !== t ? [SYN[t]] : []), ...(alt.get(t) || [])]);
  const out = [];
  for (const p of list) {
    let s = 0, hit = 0;
    for (const grp of T) {
      let v = 0;
      for (const t of grp) {
        const stem = t.length > 4 ? t.replace(/^ال/, '').replace(/(ات|ين|ون)$/, '') : t;
        let x = 0;
        if (p._n.includes(t)) x = 4; else if (stem !== t && p._n.includes(stem)) x = 3;
        else if (p._c.includes(t) || (stem !== t && p._c.includes(stem))) x = 2;
        else if (p._o.includes(t)) x = 1.5; else if (p._d.includes(t) || (stem !== t && p._d.includes(stem))) x = 0.8;
        v = Math.max(v, x);
      }
      if (v) hit++; s += v;
    }
    if (!s) continue;
    const full = hit === T.length || (T.length >= 3 && hit >= T.length - 1);
    if (full) s += 3; if (p.in_stock) s += 0.5;
    out.push([s, p, full]);
  }
  return out.sort((a, b) => b[0] - a[0]).map(([, p, full]) => (full ? Object.assign(Object.create(p), { _full: true }) : p));
}

// رقم ثابت لكل منتج (الموديل بيرجّع أرقام المنتجات ليبعت صورها)
const byNum = new Map();
function numId(sid) {
  let h = 2166136261;
  for (const c of String(sid)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return 900000000 + ((h >>> 0) % 90000000);
}
const n = (x) => Number(x).toLocaleString('en-US');

// قطع تقيلة: الشحن ما بيكون علينا أبداً
function isHeavy(p) {
  const t = arN(p.name + ' ' + (p.category || '') + ' ' + (p.collections || []).join(' '));
  if (/(دامبل|دمبل|اوزان|حديد|كيس ملاكمه|كيس|بنش|جهاز|مشايه|اسطوانه|ديسك|طاوله|كيتل|بار اولمبي|بار حديد|مقعد|ستاند|رف )/.test(t)) return true;
  const kg = t.match(/(\d+(?:\.\d+)?)\s*(كيلو|كغ|kg)/); return !!(kg && +kg[1] >= 5);
}
function toLocal(p) {
  const id = numId(p.id);
  const disc = p.old_price_usd && p.old_price_usd > p.price_usd;
  const row = {
    id, sku: p.id, name: p.name, category: p.category || (p.collections || [])[0] || '',
    price: disc ? p.old_price_usd : p.price_usd, sale_price: disc ? p.price_usd : null, currency: '$',
    stock: p.in_stock ? null : 0,
    options: Array.isArray(p.options) ? p.options.join('، ') : (p.options || ''),
    // وصف قصير بالبرومبت = رد أسرع
    description: (disc ? `خصم ${p.discount_percent}%. ` : '') + (p.price_syp ? `بالليرة ${n(p.price_syp)} ل.س. ` : '') + String(p.description || '').replace(/\s+/g, ' ').slice(0, 140) + (isHeavy(p) ? ' | الوزن: تقيل' : ' | الوزن: خفيف'),
    image_url: p.image || '', url: '', // الرابط ما منعطيه للموديل: الكرت بيحطه
    active: 1, _ko: true, _link: p.short || p.url || `${KO_STORE}/p/${encodeURIComponent(p.id)}`,
    _usd: p.price_usd, _old: disc ? p.old_price_usd : null, _syp: p.price_syp || null, _in: !!p.in_stock, _key: arN(p.name), _img: p.image || '', _disc: disc ? Number(p.discount_percent) || 0 : 0, _heavy: isHeavy(p), _spec: arN([p.name, (p.options || []).join(' '), p.description || '', (p.specs || []).join(' ')].join(' ')), _imgs: [...new Set([p.image, ...(p.images || [])].filter(Boolean))].slice(0, 4)
  };
  byNum.set(id, row);
  if (byNum.size > 3000) byNum.delete(byNum.keys().next().value);
  return row;
}

// null = الموقع ما ردّ ولا مرة (يرجع للمحلي)، [] = ما لقى
// exclude: منتجات انبعتت لهالزبون، منحطها بالآخر مشان «شوفلي غيرها» يجيب جديد
export async function koSearch(text, limit = 6, exclude = null) {
  const list = await catalog();
  if (!list) return null;
  let q = String(text || '').slice(0, 300);
  // كلام تعلّمناه من زباين قبل («يلي بحطوها عالرقبة» = «حزام تمرين رقبة»): منبحث بالمعنى
  const lw = arN(q).split(' ').map(t => learned.words[t]).find(v => typeof v === 'string');
  if (lw) q = lw;
  const spell = koSpell(q);
  let res = scoreAll(list, q, spell).filter(p => p.in_stock); // الخالص ما منبعتو ولا منقترحو
  // تنويع: المنتجات المطابقة تماماً بتنخلط كل مرة، فما بيطلع نفس الموديلات كل ما حدا سأل
  { const full = res.filter(p => p._full), rest = res.filter(p => !p._full);
    for (let i = full.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [full[i], full[j]] = [full[j], full[i]]; }
    res = [...full, ...rest]; }
  if (exclude?.size) res = [...res.filter(p => !exclude.has(numId(p.id))), ...res.filter(p => exclude.has(numId(p.id)))];
  const out = res.slice(0, limit).map(p => Object.assign(toLocal(p), { _full: !!p._full }));
  out.spell = spell;
  return out;
}

// ملاحظة للموديل عن الأخطاء الإملائية
export function koSpellNote(spell) {
  if (!spell) return '';
  const l = [];
  for (const f of spell.fixes) l.push(`- الزبون كتب «${f.from}» وغالباً قصدو «${f.to}». افهمها هيك وكمّل عادي (ما تصحّحلو).`);
  for (const a of spell.ambiguous) l.push(`- الزبون كتب «${a.from}» ويمكن قصدو ${a.options.map(o => '«' + o + '»').join(' أو ')}. إذا السياق بيوضّح قصدو كمّل عادي، وإذا لأ اسألو: «قصدك ${a.options.join(' ولا ')}؟».`);
  // كلمات مو موجودة بأسماء المنتجات غالباً حكي عادي (اعتمدت، بحطوها...): الموديل بيفهمها من السياق
  return l.join('\n');
}
export async function koFeatured(limit = 6) {
  const list = await catalog();
  return list ? list.filter(p => p.in_stock).slice(0, limit).map(toLocal) : null;
}
export function koGet(id) { return byNum.get(Number(id)) || null; }

// المنتجات يلي الموديل ذكر اسمها بالرد (إذا نسي يحط أرقامها)
export function koMentioned(reply, products) {
  const r = arN(reply);
  return products.filter(p => p._ko && p._key && r.includes(p._key)).map(p => p.id);
}

// كرت المنتج: الاسم ← السعر ← الرابط (بدون وصف)
export function koCaption(p) {
  let price = `*${p._usd}$*`;
  if (p._old) price = `~${p._old}$~  ` + price;
  if (p._syp) price += `  (${n(p._syp)} ل.س)`;
  return `*${p.name}*\n💰 ${price}${p._in ? '' : '\n❌ خالص حالياً'}\n🛒 ${p._link}`;
}

// تنظيف رد الموديل: بلا روابط وبلا سطور «الرابط:» (الكروت فيها الروابط)
// الموديل أوقات بيقلّد الكروت بالرد أو بيكتب «images: #123» بالنص: منشيلها ومنبعت كروت حقيقية بدالها
export function koIdsInText(t) { return [...String(t || '').matchAll(/(?:^|[^\d])(9\d{8})(?!\d)/g)].map(m => Number(m[1])); }
// كلام جنسي بس بينشال (المسبات العادية والمزح متل «حمار» بتضل)
const BAD = /(^|\s)(طيز|طيزو|طيزك|طييز|طييزو|طييزوو|زب|زبي|كس|كسك|نيك|منيوك|شرموط|شرموطه|عرص|عرصه|قحبه)(\s|$)/;
// كلمة عربية لازق فيها حروف إنكليزي (متل «زبona») = غلط من الموديل وممكن تطلع كلمة بشعة: منصلّحها
function fixGlued(t) {
  const L = '\\u0621-\\u064A', W = { 'زبونة': 'غالية', 'زبونه': 'غالية', 'زبون': 'غالي', 'زبوننا': 'غالينا', 'زبونتنا': 'غاليتنا' };
  return t.replace(/[\u0621-\u064A]+[A-Za-z]+[\u0621-\u064A]*|[A-Za-z]+[\u0621-\u064A]+/g, w => (/^زب/.test(w) ? 'غالية' : w.replace(/[A-Za-z]+/g, '')))
    .replace(new RegExp(`(^|[^${L}])(?:أحلى |احلى )?(زبونتنا|زبوننا|زبونة|زبونه|زبون)(?=[^${L}]|$)`, 'g'), (m, a, w) => a + W[w])
    .replace(new RegExp(`(^|[^${L}])زب(?=[^${L}]|$)`, 'g'), '$1');
}
export function koCleanReply(t, products = []) {
  const names = new Set(products.filter(p => p._key).map(p => p._key));
  return fixGlued(String(t || '').replace(/↩️\s*\(الزبون عم يرد على هالرسالة: «[\s\S]*?»\)/g, '')).replace(/(كي ?او|كاو|كو|ك\.او)\s*(سبورت|سبورتس|سپورت)/g, ' KO SPORT ').split('\n')
    // سطور فيها رقم منتج (9 أرقام) أو شكل «اسم | سعر»: هي قائمة منتجات كتبها الموديل بالغلط، الكروت بتبعتها صح
    .filter(l => !/(^|[^\d])\d{8,10}(?!\d)/.test(l) && !/\|\s*[\d.]+\s*\$/.test(l) && !BAD.test(arN(l)))
    .join('\n').replace(/[:،,]?\s*\b(true|false|null|undefined)\b/gi, '').replace(/😉/gu, '').replace(/[\u064B-\u0652]/g, '').replace(/عيني لك[،,]?\s*/g, '').replace(/(ن|ت)تنقل/g, '$1ختار').replace(/(^|\s)لنقيلي(?=\s|$)/g, '$1لنختارلك').replace(/(^|\s)نقيلي(?=\s|$)/g, '$1نختارلك').replace(/^\s*reply\s*:\s*/i, '')
    .replace(/["']?\b(images?|order|handoff|note)\b["']?\s*:\s*(\[[^\]]*\]|(#\s?\d+[\s,،]*)+|null|true|false)?/gi, '')
    .replace(/#\s?9\d{8}\b/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .split('\n').filter(l => !/[💰🛒]/u.test(l) && !/^\s*(الرابط|رابط|السعر)\s*:?\s*$/.test(l) && !names.has(arN(l.replace(/[*_~]/g, '')))).join('\n')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').replace(/[،,]\s*[،,.]/g, '،').replace(/\s+([،,.؟?!])/g, '$1').replace(/ {2,}/g, ' ').replace(/[،,.\s]+$/, '').trim();
}
// بالمحادثة يلي بيشوفها الموديل: الكرت بينكتب سطر قصير بدل ما يقلّده
export function koHistoryText(body) {
  const b = String(body || '');
  if (!/💰/u.test(b) || !/🛒/u.test(b)) return b;
  return `[انبعت للزبون كرت منتج: ${b.split('\n')[0].replace(/[*_~]/g, '').trim()}]`;
}

// صورة المنتج: منحمّلها ومنحوّلها JPEG (الواتس ما بيحب webp/avif) ومنحفظها، مرة وحدة لكل صورة
const imgCache = new Map();
export async function koImage(url) {
  if (!url) return null;
  if (imgCache.has(url)) return imgCache.get(url);
  try {
    const dir = path.join(DATA_DIR, 'uploads'); fs.mkdirSync(dir, { recursive: true });
    const name = 'ko-' + numId(url) + '.jpg', file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const sharp = (await import('sharp')).default;
      fs.writeFileSync(file, await sharp(buf).rotate().resize(1080, 1080, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer());
    }
    const local = '/uploads/' + name;
    imgCache.set(url, local); if (imgCache.size > 2000) imgCache.delete(imgCache.keys().next().value);
    return local;
  } catch (e) { console.error('[ko-image]', url, e.message); return url; }
}

// هل الزبون عم يسأل عن منتج؟
export const ASKS_PRODUCT = /(عندك|عندكن|عندكم|في عند|في شي|بدي|بدنا|سعر|قديش|بكم|شو في|صور|ورجيني|فرجيني|وريني|شوفي|شوفلي|غير|غيرها|موديل|متوفر|موجود|بتنصح|نصحني|احسن|أحسن|اشتري)/;

// ما منكرر نفس المنتج لنفس الزبون خلال ساعة (منتجات بنفس الاسم بس غير صورة/سعر بتنبعت عادي)
const sentTo = new Map();
export function koSent(contactId) {
  const now = Date.now(), m = sentTo.get(contactId) || new Map();
  for (const [k, t] of m) if (now - t > 24 * 3600_000) m.delete(k); // نفس المنتج ما بيرجع لنفس الزبون خلال يوم
  sentTo.set(contactId, m);
  return new Set(m.keys());
}
export function koFresh(contactId, ids) {
  const seen = koSent(contactId), m = sentTo.get(contactId), out = [];
  for (const id of ids) {
    if (!koGet(id) || seen.has(id) || out.includes(id)) continue;
    out.push(id); m.set(id, Date.now());
  }
  if (sentTo.size > 5000) sentTo.delete(sentTo.keys().next().value);
  return out;
}

// ===== ألوان المنتج من صوره بالموقع =====
// منحلّل كل صورة مرة وحدة (بنتجاهل الخلفية) ومنحفظ النتيجة، مشان المجيب يعرف شو الألوان الموجودة فعلاً
const COLORS_FILE = path.join(DATA_DIR, 'ko-colors.json');
let colorMemo = {}; try { colorMemo = JSON.parse(fs.readFileSync(COLORS_FILE, 'utf8')); } catch {}
let saveT = null;
function saveColors() { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(COLORS_FILE, JSON.stringify(colorMemo)); } catch {} }, 2000); }

export function colorName(r, g, b) {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, v = mx, s = mx ? (mx - mn) / mx : 0;
  if (v < 0.18) return 'أسود';
  if (s < 0.16) return v > 0.85 ? 'أبيض' : v < 0.35 ? 'أسود' : 'رمادي';
  const d = mx - mn; let h = 0;
  if (mx === r / 255) h = ((g - b) / 255 / d) % 6; else if (mx === g / 255) h = (b - r) / 255 / d + 2; else h = (r - g) / 255 / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 12 || h >= 345) return s < 0.45 && v > 0.7 ? 'وردي' : v < 0.45 ? 'خمري' : 'أحمر';
  if (h < 40) return v < 0.6 ? 'بني' : 'برتقالي';
  if (h < 66) return v < 0.55 ? 'بني' : s < 0.55 && v < 0.8 ? 'ذهبي' : 'أصفر';
  if (h < 165) return v < 0.4 ? 'زيتي' : 'أخضر';
  if (h < 200) return 'سماوي';
  if (h < 255) return v < 0.4 ? 'كحلي' : 'أزرق';
  if (h < 290) return 'بنفسجي';
  return 'وردي';
}
// pixels: Uint8 RGB، w×h. بيرجّع الألوان الأساسية (بدون الخلفية)
export function colorsOfPixels(px, w, h) {
  const at = (x, y) => { const i = (y * w + x) * 3; return [px[i], px[i + 1], px[i + 2]]; };
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1), at(w >> 1, 0), at(0, h >> 1)];
  const bg = corners.map(c => c.join(',')), near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 60;
  const count = {}; let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y);
    if (corners.some(k => near(c, k))) continue; // الخلفية
    const name = colorName(...c); count[name] = (count[name] || 0) + 1; n++;
  }
  if (n < w * h * 0.04) return [];
  return Object.entries(count).filter(([, k]) => k / n >= 0.2).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);
}
async function imageColors(url) {
  if (colorMemo[url]) return colorMemo[url];
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(Buffer.from(await r.arrayBuffer())).flatten({ background: '#ffffff' }).resize(48, 48, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = colorsOfPixels(data, info.width, info.height);
  colorMemo[url] = out; saveColors();
  return out;
}
// بيضيف «ألوان الصور» لوصف المنتجات (wait=0: بالخلفية بدون ما يأخّر الرد)
export async function koColors(products, wait = 0) {
  const job = Promise.all(products.filter(p => p?._ko).map(async p => {
    const all = [];
    for (const u of p._imgs || []) { try { all.push(...await imageColors(u)); } catch (e) { console.error('[ko-colors]', e.message); } }
    const set = [...new Set(all)];
    if (set.length && !p._colors) { p._colors = set; p.description += ` | ألوان صور المنتج بالموقع: ${set.join('، ')}`; }
  }));
  if (wait) await Promise.race([job, new Promise(r => setTimeout(r, wait))]);
}
export const ASKS_COLOR = /(لون|الوان|ألوان|اسود|أسود|سودا|احمر|أحمر|حمرا|ازرق|أزرق|زرقا|ابيض|أبيض|بيضا|اخضر|أخضر|خضرا|اصفر|أصفر|زهري|وردي|رمادي|رصاصي|بني|كحلي|بنفسجي|موف|برتقالي|ذهبي|فضي|سماوي)/;

// ===== المقاس/الطول/اللون يلي طلبو الزبون: موجود فعلاً بالمنتج؟ =====
const SIZES = [
  [/(^|\s)(اكس اكس لارج|اكسين لارج|xxl|2xl)(\s|$)/, ['xxl', '2xl']],
  [/(^|\s)(اكس لارج|اكسلارج|xl)(\s|$)/, ['xl']],
  [/(^|\s)(اكس سمول|xs)(\s|$)/, ['xs']],
  [/(^|\s)(لارج|large)(\s|$)/, ['l', 'large', 'لارج']],
  [/(^|\s)(ميديوم|ميديم|مديوم|medium)(\s|$)/, ['m', 'medium', 'ميديوم']],
  [/(^|\s)(سمول|سمال|small)(\s|$)/, ['s', 'small', 'سمول']],
];
const UNITS = { m: 'متر|م|m', kg: 'كيلو|كغ|كغم|kg', oz: 'oz|اونص|اونصه|اونز', cm: 'سم|cm' };
const COLOR_WORDS = { أسود: 'اسود|سودا|سوداء|black', أحمر: 'احمر|حمرا|حمراء|red', أزرق: 'ازرق|زرقا|زرقاء|blue', أبيض: 'ابيض|بيضا|بيضاء|white', أخضر: 'اخضر|خضرا|خضراء|green', أصفر: 'اصفر|صفرا|صفراء|yellow', وردي: 'وردي|زهري|بينك|pink', رمادي: 'رمادي|رصاصي|سكني|grey|gray', بني: 'بني|brown', كحلي: 'كحلي|navy', بنفسجي: 'بنفسجي|موف|purple', برتقالي: 'برتقالي|orange', ذهبي: 'ذهبي|gold', فضي: 'فضي|silver', سماوي: 'سماوي' };
export function koAskedSpec(text) {
  const t = arN(text); if (!t) return null;
  const out = { sizes: [], nums: [], colors: [] };
  let rest = ' ' + t + ' ';
  for (const [re, alts] of SIZES) if (re.test(rest)) { out.sizes.push(alts); rest = rest.replace(re, ' '); }
  if (/(^|\s)(مقاس|قياس|نمره)\s+(l|m|s)(\s|$)/.test(rest)) { const c = rest.match(/(مقاس|قياس|نمره)\s+(l|m|s)/)[2]; out.sizes.push({ l: ['l', 'large'], m: ['m', 'medium'], s: ['s', 'small'] }[c]); }
  const bodyW = /(^|\s)(وزن|وزني|وزنو|وزنه|وزنها|وزنك|انا|عمري)(\s|$)/.test(rest); // «وزني 75 كيلو» = وزن الزبون، مو مواصفة منتج
  for (const [u, re] of Object.entries(UNITS)) if (!(u === 'kg' && bodyW)) for (const m of rest.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${re})(?=\\s|$)`, 'g'))) out.nums.push({ n: m[1], u });
  const shoe = rest.match(/(مقاس|قياس|نمره)\s*(\d{2})(\s|$)/); if (shoe) out.nums.push({ n: shoe[2], u: null });
  for (const [c, re] of Object.entries(COLOR_WORDS)) if (new RegExp(`(^|\\s)(?:ال|بال|بل|ب)?(${re})(\\s|$)`).test(rest)) out.colors.push(c);
  return out.sizes.length || out.nums.length || out.colors.length ? out : null;
}
export function koMatchSpec(p, sp) {
  const t = ' ' + (p._spec || '') + ' ', toks = new Set(t.split(' '));
  for (const alts of sp.sizes) if (!alts.some(a => toks.has(a))) return false;
  for (const { n, u } of sp.nums) {
    const re = u ? new RegExp(`(^|\\s)${n.replace('.', '\\.')}\\s*(${UNITS[u]})(\\s|$)`) : new RegExp(`(^|\\s)${n}(\\s|$)`);
    if (!re.test(t)) return false;
  }
  for (const c of sp.colors) if (!new RegExp(`(^|\\s)(?:ال|بال|بل|ب)?(${COLOR_WORDS[c]})(\\s|$)`).test(t) && !(p._colors || []).includes(c)) return false;
  return true;
}
export function koManagerMsg(sp, girl = false) {
  const what = sp.colors.length && !sp.sizes.length && !sp.nums.length ? 'اللون المطلوب' : sp.colors.length ? 'القياس واللون المطلوبين' : 'القياس المطلوب';
  return girl
    ? `ابعتيلي المنتجات يلي عجبتك، ومدير المبيعات بيتأكدلك من ${what} 🙏\nبيكون متواجد من الساعة 11 الصبح لـ 8 المسا.`
    : `ابعتلي المنتجات يلي عجبتك، ومدير المبيعات بيتأكدلك من ${what} 🙏\nبيكون متواجد من الساعة 11 الصبح لـ 8 المسا.`;
}
export const ASKS_PHOTO = /(صور|صوره|صورت|ورجيني|فرجيني|وريني|فرجيلي|ورجيلي|بدي شوف|وين الصور|ما وصل|ماوصل)/;

// ===== تعلّم ذاتي: لما المجيب يسأل «شو قصدك» والزبون يوضّح، منحفظ المعنى للمرة الجاية =====
const LEARN_FILE = path.join(DATA_DIR, 'ko-learned.json');
let learned = { words: {}, phrases: [] };
try { const j = JSON.parse(fs.readFileSync(LEARN_FILE, 'utf8')); learned = { words: j.words || {}, phrases: j.phrases || [] }; } catch {}
function saveLearned() { try { fs.writeFileSync(LEARN_FILE, JSON.stringify(learned, null, 1)); } catch (e) { console.error('[ko-learn]', e.message); } }
export function koLearn(history, matchedNow) {
  const outs = history.map((m, i) => [m, i]).filter(([m]) => m.direction === 'out');
  const last = outs[outs.length - 1]; if (!last) return;
  const [bot, i] = last;
  if (!/قصدك|ما فهمت|مو واضح|وضحلي|وضّحلي/.test(bot.body || '')) return;
  const before = history.slice(0, i).filter(m => m.direction === 'in').slice(-1)[0]?.body || '';
  const after = history.slice(i + 1).filter(m => m.direction === 'in').map(m => m.body || '').join(' ');
  const q = String(before).trim().slice(0, 140), a = String(after).trim().slice(0, 140);
  if (!q || !a || arN(q) === arN(a)) return;
  if (!learned.phrases.some(x => arN(x.q) === arN(q))) {
    learned.phrases.push({ q, a, at: Date.now() }); if (learned.phrases.length > 200) learned.phrases.shift();
    console.log(`[ko-learn] «${q}» = «${a}»`);
  }
  if (matchedNow) { // الكلمات الغريبة بالسؤال الأول ← كلمات البحث يلي نجحت بالتوضيح
    for (const t of arN(q).split(' ')) if (t.length > 2 && !STOP.has(t) && !known(t)) learned.words[t] = a;
  }
  saveLearned();
}
export function koLearnedNote() {
  const l = learned.phrases.slice(-30);
  return l.length ? 'زباين قبل حكوا هيك ووضّحوا شو قصدهن (افهمها مباشرة بلا ما تسأل):\n' + l.map(x => `- «${x.q}» يعني «${x.a}»`).join('\n') : '';
}

// الكلام بدون كلمات الألوان (لنعرف شو المنتج المطلوب)
export function koStripColors(text) {
  let t = ' ' + arN(text) + ' ';
  for (const re of Object.values(COLOR_WORDS)) t = t.replace(new RegExp(`(^|\\s)(?:ال|بال|بل|ب)?(${re})(?=\\s|$)`, 'g'), ' ');
  return t.replace(/(^|\s)(لون|اللون|الوان|بلون|باللون)(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
}

// ===== قائمة الأقسام بالواتس (ko-menu.js) — الأقسام والمجموعات متل الموقع بالضبط =====
export const KO_SITE = 'https://ko-sport.online';
const GROUP_IC = ['🥊', '🏋️', '⚽', '🎒', '🏃', '🧤', '🎾', '🏊'];
let siteSet = null, siteSetAt = 0;
async function siteSettings() {
  if (siteSet && Date.now() - siteSetAt < 5 * 60_000) return siteSet;
  try {
    const r = await fetch(`${KO_STORE}/api/settings`, { signal: AbortSignal.timeout(15000) });
    if (r.ok) { siteSet = await r.json(); siteSetAt = Date.now(); }
  } catch (e) { console.error('[ko-menu] settings:', e.message); }
  return siteSet;
}
// [{ name, icon, cats: [{ name, label, count, url }] }] — بس الأقسام يلي فيها منتجات متوفرة
export async function koMenuData() {
  const list = await catalog();
  if (!list) return null;
  const D = ((await siteSettings()) || {}).design || {};
  const label = (c) => (D.catLabels || {})[c] || c;
  const slug = (c) => ((D.catMeta || {})[c] || {}).slug || c;
  const count = new Map();
  for (const p of list) if (p.in_stock) for (const c of (p.collections || [p.category])) if (c) count.set(c, (count.get(c) || 0) + 1);
  const mk = (c) => ({ name: c, label: label(c), count: count.get(c) || 0, url: `${KO_SITE}/ar/c/${encodeURIComponent(slug(c))}` });
  const icons = (D.kx || {}).gIcons || {};
  let groups = (D.groups || []).map((g, i) => ({ name: g.name, icon: String(icons[g.name] || GROUP_IC[i % GROUP_IC.length]).slice(0, 4), cats: (g.cats || []).map(mk).filter((c) => c.count) })).filter((g) => g.cats.length);
  const used = new Set(groups.flatMap((g) => g.cats.map((c) => c.name)));
  const rest = [...count.keys()].filter((c) => !used.has(c)).map(mk);
  if (rest.length) groups.push({ name: 'أقسام تانية', icon: '🛍️', cats: rest });
  return groups;
}
// منتجات قسم واحد (المتوفر بس)، صفحة صفحة
export async function koInCategory(catName, offset = 0, limit = 6) {
  const list = await catalog();
  if (!list) return { items: [], total: 0 };
  const all = list.filter((p) => p.in_stock && (p.collections || [p.category]).includes(catName));
  return { items: all.slice(offset, offset + limit).map(toLocal), total: all.length };
}
