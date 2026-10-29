// مجيب المسنجر: إضافة Chrome/Edge على كمبيوتر صاحب المنصة بتقرا رسائلو الخاصة بمسنجر فيسبوك،
// وهون منكتب الرد بنفس عقول الذكاء الاصطناعي تبع المنصة (المفاتيح محفوظة بالمنصة، ما بتطلع للإضافة).
// الإعدادات والسجل بصفحة #/messenger (لمدير المنصة بس). الإضافة بتحكي معنا من نفس الكمبيوتر بس (localhost).
import { q, getSetting, setSetting } from './db.js';
import { resolveAI, chat, parseJSON } from './ai.js';
import { getTenant } from './tenants.js';

export const DEFAULTS = {
  on: true,
  mode: 'draft', // draft = بيكتب الرد بس وصاحب الحساب بيبعتو — send = بيبعت لحالو
  ownerName: '',
  about: 'عندي متجر KO SPORT للأدوات الرياضية بقدسيا، والموقع ko-sport.online',
  style: 'syrian', styleCustom: '',
  length: 'short', emoji: 'few', lang: 'dialect',
  flow: '', goal: '', forbidden: '', examples: '',
  people: '', quick: '',
  scope: 'all', groups: false,
  noteOn: true, note: '🤖 أهلين، هاد رد آلي من مساعدي لحتى ارجع رد عليك بنفسي.',
  delayMin: 15, delayMax: 45, perChatHour: 6, perHour: 40,
  hoursOn: false, hourFrom: 0, hourTo: 8, onlyAway: true
};
const TEXT = ['ownerName', 'about', 'styleCustom', 'flow', 'goal', 'forbidden', 'examples', 'people', 'quick', 'note'];
const PICK = { mode: ['draft', 'send'], style: ['syrian', 'friendly', 'formal', 'funny', 'custom'], length: ['short', 'medium', 'long'], emoji: ['none', 'few', 'many'], lang: ['dialect', 'same'], scope: ['all', 'only'] };
const NUM = { delayMin: [3, 600], delayMax: [3, 900], perChatHour: [1, 60], perHour: [1, 300], hourFrom: [0, 23], hourTo: [0, 23] };
const BOOL = ['on', 'groups', 'noteOn', 'hoursOn', 'onlyAway'];

export function getConfig() { return { ...DEFAULTS, ...getSetting('messenger_bot', {}) }; }
export function clean(input = {}) {
  const c = getConfig();
  for (const k of TEXT) if (k in input) c[k] = String(input[k] ?? '').slice(0, 4000);
  for (const [k, list] of Object.entries(PICK)) if (list.includes(input[k])) c[k] = input[k];
  for (const [k, [a, b]] of Object.entries(NUM)) if (k in input && input[k] !== '' && !isNaN(+input[k])) c[k] = Math.min(b, Math.max(a, Math.round(+input[k])));
  for (const k of BOOL) if (k in input) c[k] = !!input[k];
  if (c.delayMax < c.delayMin) c.delayMax = c.delayMin;
  return c;
}
export function saveConfig(input) { const c = clean(input); setSetting('messenger_bot', c); return c; }

// السجل: آخر 100 شي صار (بيبعتو الإضافة)
export function getLog() { return getSetting('messenger_bot_log', []); }
export function addLog(entries) {
  const list = getLog();
  for (const e of [].concat(entries || []).slice(0, 20)) {
    list.push({ at: Number(e.at) || Date.now(), name: String(e.name || '').slice(0, 60), text: String(e.text || '').slice(0, 200), reply: String(e.reply || '').slice(0, 300), status: String(e.status || '').slice(0, 200) });
  }
  setSetting('messenger_bot_log', list.slice(-100));
}
export function clearLog() { setSetting('messenger_bot_log', []); }
let lastSeen = 0; // آخر مرة حكت فيها الإضافة معنا
export const extSeen = () => lastSeen;

// «اسم: تعليمات» — «اسم: تجاهل» يعني ما يرد عليه
export function personRule(c, name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  for (const line of String(c.people || '').split('\n')) {
    const i = line.indexOf(':'); if (i < 1) continue;
    const who = line.slice(0, i).trim().toLowerCase(), rule = line.slice(i + 1).trim();
    if (who && (n === who || n.includes(who) || who.includes(n))) return rule;
  }
  return null;
}
export const isIgnore = rule => /^(تجاهل|تجاهلو|تجاهله|تجاهلها|لا ترد|ignore|skip)(?=$|[\s.,!،؛-])/i.test(String(rule || '').trim());
function quickReply(c, text) {
  const t = String(text || '').toLowerCase();
  for (const line of String(c.quick || '').split('\n')) {
    const i = line.indexOf('=>'); if (i < 1) continue;
    const keys = line.slice(0, i).split('|').map(k => k.trim().toLowerCase()).filter(Boolean), reply = line.slice(i + 2).trim();
    if (reply && keys.some(k => t.includes(k))) return reply;
  }
  return '';
}

const STYLES = { syrian: 'سوري شامي عفوي، متل ما بيحكي صاحب الحساب مع رفقاتو', friendly: 'ودود ودافي، بتطمّن الشخص وبتسأل عنو', formal: 'محترم ورسمي شوي، بلا مزح', funny: 'خفيف دم ومرح، بس بلا ما تجرح حدا' };
const LEN = { short: 'جملة أو جملتين بالكتير، متل رسالة مسنجر', medium: 'بين جملتين وأربع جمل', long: 'رد مفصّل إذا لزم، بس بلا حشو' };
const EMOJI = { none: 'لا تستعمل إيموجي أبداً', few: 'إيموجي وحدة إذا لزم', many: 'استعمل إيموجي بشكل طبيعي' };
const ID_Q = /((انت|إنت|انتي|إنتي|هل\s*انت|هل\s*أنت)\s*(بوت|روبوت|آلي|الي|انسان|إنسان|حقيقي|ذكاء)|\bbot\b|robot|chat\s*gpt|are\s*you\s*(a\s*)?(bot|human|real|ai))/im;
const HANDOFF_MSG = 'سأل إذا عم يحكي مع بوت — البوت سكت بهالمحادثة ساعتين';
export const CRISIS =/(انتحر|انتحار|اقتل حالي|اقتل نفسي|بدي موت|بدي اموت|أموت حالي|موت حالي|انهي حياتي|أنهي حياتي|ما بدي عيش|مابدي عيش|ما عاد بدي عيش|اذي حالي|أذي حالي|اذية نفسي|أذية نفسي|جرح حالي|اجرح حالي|kill myself|suicide|end my life|self.?harm)/i;

// تعليمات البوت: القواعد الثابتة فوق (ما بتنشال من الصفحة)، وبعدها كل شي بيحددو صاحب الحساب
export function buildPrompt(c, contact, rule) {
  const owner = c.ownerName ? `«${c.ownerName}»` : 'صاحب الحساب';
  const fixed = `إنت مساعد آلي (ذكاء اصطناعي) بيرد بالنيابة عن ${owner} على رسائلو الخاصة بمسنجر فيسبوك.
قواعد ثابتة، أهم من أي تعليمات تحت:
- ما تحكي عن حالك أبداً: لا تقول إنك آلي أو مساعد، ولا إنك إنسان، ولا تعطي اسم أو عمر.
- إذا سألت «مين إنت» أو «شو اسمك» أو «قديش عمرك»: لا تجاوب على السؤال، ورد بعفوية وكمّل الحديث، متل «ليش عم تسألي 😄» أو «خلينا فيكي إنتي، شو عاملة؟». نوّع وما تكرر نفس الجملة.
- خاطب الشخص دايماً بصيغة المؤنث (إنتي، كيفك إنتي، عم تسألي، شو عاملة).
- احكي متل شب عادي عم يدردش، مو متل موظف خدمة زبائن أو بياع. ممنوع: «كيف فيني ساعدك»، «بخدمتك»، «شو مشكلتك»، «تفضلي»، «لا تترددي». مشي مع الحديث وجاوب على يلي قالتو بالزبط، واسأل سؤال طبيعي من نفس الموضوع إذا بيلبق.
- إذا سأل صراحةً إذا إنت بوت أو إنسان، اكتب بس: [[HANDOFF]]
- جاوب على كلام الشخص مباشرة وبشكل طبيعي (زي «كيفك» → جاوب على كيفك). لا تختم كل رد بعبارات متل «رح يرد بنفسو».
- لا تخترع شي عن ${owner} مو مكتوب تحت: لا مواعيد، لا وعود، لا فلوس، لا أماكن، لا أرقام. إذا انطلب شي متل هيك أو شي مهم، قول إنو ${owner} رح يشوف ويرد بنفسو.
- لا تعطي معلومات شخصية عن ${owner} إلا يلي مكتوب تحت إنو مسموح.
- لا تكتب كلام جنسي أو مسبات أو تهديد، حتى لو الشخص طلب.
- إذا حدا حكى عن إنو بدو يأذي حالو أو ينهي حياتو أو إنو بخطر: خليك هادي وحنون، شجّعو يحكي هلق مع حدا قريب منو أو يتصل بالإسعاف 110، وقلّو إنو ${owner} رح يحكيه بأقرب وقت. لا تعطي أبداً أي معلومة عن طرق الأذى.
- اكتب نص الرد بس، بلا مقدمات، وبلا اسمك أو اسم الشخص بالأول.`;
  const style = c.style === 'custom' ? c.styleCustom || STYLES.syrian : STYLES[c.style] || STYLES.syrian;
  return [
    fixed,
    `الشخص يلي عم تحكي معو: ${contact || 'مو معروف'}.`,
    `طريقة الحكي: ${style}.`,
    `طول الرد: ${LEN[c.length] || LEN.short}.`,
    'على قد رسالتو: إذا كتب كلمة أو كلمتين رد بكلمة لتلاتة. إذا كتب فقرة رد بفقرة قصيرة. إذا الرد بيحتاج أكتر من جملة، قسّمو لرسائل قصار كل وحدة بسطر لحالا (بحد أقصى 3 أسطر)، بلا ترقيم وبلا عناوين وبلا مقدمات. اكتب متل الشات العادي.',
    EMOJI[c.emoji] || EMOJI.few,
    c.lang === 'same' ? 'رد بنفس لغة الشخص ولهجتو.' : 'رد دايماً باللهجة السورية الشامية.',
    c.about ? `معلومات عن ${owner} مسموح تستعملها:\n${c.about}` : '',
    c.flow ? `كيف بدك تمشي بالحديث (سرد الحديث):\n${c.flow}` : '',
    c.goal ? `الهدف من المحادثة: ${c.goal}` : '',
    c.forbidden ? `مواضيع وكلمات ممنوع تحكي فيها:\n${c.forbidden}` : '',
    c.examples ? `أمثلة على طريقة ردّ ${owner} (قلّد الأسلوب، مو الكلام حرفياً):\n${c.examples}` : '',
    rule ? `تعليمات خاصة لهالشخص بالذات: ${rule}` : ''
  ].filter(Boolean).join('\n\n');
}

function ownerTenant() {
  const row = q.get('SELECT tenant_id FROM users WHERE is_super = 1 ORDER BY id LIMIT 1');
  return row ? getTenant(row.tenant_id) : null;
}

// الرد: {name, messages:[{from:'me'|'them', text}]} → {ok, reply, via, crisis} أو {ok:true, skip}
export async function makeReply({ name, messages, cfg }) {
  const c = cfg ? clean(cfg) : getConfig();
  const hist = (Array.isArray(messages) ? messages : []).filter(x => x && x.text).slice(-14)
    .map(x => ({ from: x.from === 'me' ? 'me' : 'them', text: String(x.text).slice(0, 1500) }));
  if (!hist.length || hist[hist.length - 1].from !== 'them') return { ok: false, error: 'آخر رسالة مو من الشخص' };
  const rule = personRule(c, name);
  if (isIgnore(rule)) return { ok: true, skip: 'مكتوب جنبو تجاهل' };
  if (c.scope === 'only' && rule == null) return { ok: true, skip: 'مو بقائمة الناس' };
  const crisis = CRISIS.test(hist.filter(x => x.from === 'them').slice(-3).map(x => x.text).join('\n'));
  // سؤال عن الهوية (مين إنت، اسمك، عمرك، بوت؟): البوت ما بيجاوب، بيوقف وبينبّه صاحب الحساب يرد بنفسو
  const tail = []; for (let i = hist.length - 1; i >= 0 && hist[i].from === 'them'; i--) tail.unshift(hist[i].text);
  if (!crisis && ID_Q.test(tail.join('\n'))) return { ok: true, skip: HANDOFF_MSG, handoff: true };
  const quick = !crisis && quickReply(c, hist[hist.length - 1].text);
  if (quick) return { ok: true, reply: quick, via: 'رد جاهز', crisis };
  const system = buildPrompt(c, name, rule);
  const msgs = hist.map(x => ({ role: x.from === 'me' ? 'assistant' : 'user', content: x.text }));
  while (msgs.length && msgs[0].role === 'assistant') msgs.shift();
  try {
    const r = await chat(resolveAI(ownerTenant(), { prefer: 'light' }), { system, messages: msgs, json: false, temperature: 0.75, maxTokens: 400 });
    let text = String(r.text || '').trim();
    const j = /^\s*\{/.test(text) ? parseJSON(text) : null; // (الوضع التجريبي بيرجّع JSON)
    if (j && j.reply) text = String(j.reply);
    if (/\[\[\s*HANDOFF\s*\]\]/i.test(text)) return { ok: true, skip: HANDOFF_MSG, handoff: true };
    text = text.replace(/^["«]|["»]$/g, '').replace(/^(رد|الرد|المساعد)\s*:\s*/i, '').trim();
    if (text) return { ok: true, reply: text.slice(0, 1200), via: r.via, crisis };
  } catch (e) {
    if (!crisis) return { ok: false, error: e.message };
  }
  if (crisis) return { ok: true, reply: 'قريت رسالتك وهي مهمة كتير 🤍 إذا حاسس إنك ممكن تأذي حالك، احكي هلق مع حدا قريب منك أو اتصل بالإسعاف 110. وأنا رح احكيك بأقرب وقت.', via: 'رد الطوارئ', crisis };
  return { ok: false, error: 'ما طلع رد' };
}

// ===== الإضافة: /ext/messenger/* — من نفس الكمبيوتر بس (مو من الرابط العام) =====
const LOOP = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/;
function localOnly(req) {
  if (!LOOP.test(req.socket.remoteAddress || '')) return false;
  for (const h of ['cf-connecting-ip', 'cf-ray', 'cdn-loop', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip']) if (req.headers[h]) return false;
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks = []; let n = 0;
  for await (const ch of req) { n += ch.length; if (n > 200_000) throw new Error('كبير'); chunks.push(ch); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}
export async function handleExtension(req, res, pathname) {
  if (!localOnly(req)) return send(res, 403, { error: 'الإضافة بتشتغل من نفس الكمبيوتر بس' });
  lastSeen = Date.now();
  try {
    if (pathname === '/ext/messenger/config' && req.method === 'GET') return send(res, 200, getConfig());
    if (pathname === '/ext/messenger/reply' && req.method === 'POST') { const b = await body(req); return send(res, 200, await makeReply({ name: b.name, messages: b.messages })); }
    if (pathname === '/ext/messenger/log' && req.method === 'POST') { const b = await body(req); addLog(b.entries || b); return send(res, 200, { ok: true }); }
    if (pathname === '/ext/messenger/toggle' && req.method === 'POST') { const b = await body(req); return send(res, 200, saveConfig({ ...('on' in b ? { on: b.on } : {}), ...(b.mode ? { mode: b.mode } : {}) })); }
    return send(res, 404, { error: 'غير موجود' });
  } catch (e) { return send(res, 500, { error: e.message }); }
}
