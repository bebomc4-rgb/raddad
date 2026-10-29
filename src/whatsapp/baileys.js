// الربط بمسح QR أو كود الربط (غير رسمي — مجاني، بس في خطر حظر الرقم)
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { q } from '../db.js';
import { emit } from '../events.js';
import { phoneFromJid } from '../text.js';
import { getTenant } from '../tenants.js';
import { trialStatus } from '../trial.js';
import { isActive } from '../failover.js';

const sessions = new Map(); // tenantId -> state
let B = null;               // مكتبة Baileys (بتنحمّل وقت الحاجة)

async function lib() {
  if (B) return B;
  let m;
  try { m = await import('baileys'); }
  catch { throw new Error('مكتبة baileys مو منصّبة. شغّل: npm install'); }
  const d = m.default && typeof m.default === 'object' ? m.default : m;
  const pick = n => m[n] ?? d[n];
  const makeWASocket = [m.default?.default, m.makeWASocket, d.makeWASocket, m.default].find(f => typeof f === 'function');
  B = {
    makeWASocket,
    useMultiFileAuthState: pick('useMultiFileAuthState'),
    DisconnectReason: pick('DisconnectReason') || { loggedOut: 401, restartRequired: 515, connectionReplaced: 440, timedOut: 408 },
    fetchLatestBaileysVersion: pick('fetchLatestBaileysVersion'),
    Browsers: pick('Browsers'),
    downloadMediaMessage: pick('downloadMediaMessage')
  };
  return B;
}

const silent = { level: 'silent', trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };
const authDir = id => path.join(DATA_DIR, 'wa-sessions', String(id));
// الرقم مربوط فعلاً إذا ملف الاعتماد فيه هوية الحساب (me)
const hasAuth = id => {
  try { return !!JSON.parse(fs.readFileSync(path.join(authDir(id), 'creds.json'), 'utf8')).me; } catch { return false; }
};

export function status(tenantId) {
  const s = sessions.get(tenantId);
  if (!s) return { provider: 'qr', status: hasAuth(tenantId) ? 'connecting' : 'disconnected' };
  return { provider: 'qr', status: s.status, qr: s.qr || null, code: s.code || null, phone: s.phone || null, error: s.error || null };
}

function setState(tenantId, patch) {
  const s = sessions.get(tenantId);
  if (!s) return;
  Object.assign(s, patch);
  emit(tenantId, 'wa', status(tenantId));
}

export async function start(tenantId, { pairPhone = null } = {}) {
  const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await lib();
  const prev = sessions.get(tenantId);
  if (prev?.sock) { try { prev.stopped = true; prev.sock.end(undefined); } catch {} }

  const s = { status: 'connecting', qr: null, code: null, phone: null, error: null, retries: prev?.retries || 0, stopped: false, pairPhone, everOpen: false, qrCount: 0 };
  sessions.set(tenantId, s);
  emit(tenantId, 'wa', status(tenantId));

  fs.mkdirSync(authDir(tenantId), { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir(tenantId));
  let version;
  try {
    // جلب آخر نسخة من بروتوكول واتساب، بس ما منستنى أكتر من 6 ثواني
    version = (await Promise.race([fetchLatestBaileysVersion?.(), new Promise(r => setTimeout(() => r(null), 6000))]))?.version;
  } catch {}
  console.log(`[wa] tenant ${tenantId}: connecting${version ? ' (wa v' + version.join('.') + ')' : ''}${pairPhone ? ' with pairing code' : ' with QR'}`);

  const sock = makeWASocket({
    auth: state,
    logger: silent,
    printQRInTerminal: false,
    markOnlineOnConnect: false,   // حتى يضل موبايلك يوصله إشعارات
    syncFullHistory: true,        // لما تربط من جديد: الواتس بيبعت كل المحادثات القديمة (مشان نحفظ كل الأرقام)
    browser: Browsers?.ubuntu ? Browsers.ubuntu('Chrome') : ['Ubuntu', 'Chrome', '22.04.4'],
    ...(version ? { version } : {}),
    getMessage: async () => undefined
  });
  s.sock = sock;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('contacts.upsert', (list) => noteContacts(tenantId, list));
  sock.ev.on('contacts.update', (list) => noteContacts(tenantId, (list || []).filter(c => c.name)));

  sock.ev.on('connection.update', async u => {
    if (s.stopped) return;
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      s.qrCount++;
      if (s.pairPhone && !sock.authState.creds.registered && !s.code) {
        try {
          const code = await sock.requestPairingCode(s.pairPhone.replace(/\D/g, ''));
          setState(tenantId, { status: 'pairing', code: code?.match(/.{1,4}/g)?.join('-') || code, qr: null });
        } catch (e) { setState(tenantId, { status: 'error', error: 'ما قدرنا نطلب كود الربط: ' + e.message }); }
      } else if (!s.pairPhone) {
        setState(tenantId, { status: 'qr', qr });
      }
    }
    if (connection === 'open') {
      const phone = phoneFromJid(sock.user?.id) || null;
      s.retries = 0; s.everOpen = true;
      setState(tenantId, { status: 'open', qr: null, code: null, phone, error: null });
      q.run("UPDATE tenants SET wa_phone = ?, wa_provider = 'qr' WHERE id = ?", phone, tenantId);
      console.log(`[wa] tenant ${tenantId} connected as ${phone}`);
      clearInterval(s.lidTimer); s.lidTimer = setInterval(() => resolveLids(tenantId).catch(() => {}), 15 * 60_000);
      setTimeout(() => bookResync(tenantId, sock, state).catch(e => console.error('[wa] address book sync', e.message)), 20000); // منجيب أسماء جهات اتصالك كلها من الواتس
      setTimeout(() => queueAllKnown(tenantId), 90000); // بعد ما يخلص مزامنة الواتس، منحفظ كل الأرقام يلي راسلت قبل
      trialStatus(getTenant(tenantId)); // بيسجّل الرقم أو بيطلّع تنبيه للإدارة إذا استخدم التجربة
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const why = lastDisconnect?.error?.message || '';
      console.log(`[wa] tenant ${tenantId}: closed code=${code ?? '-'} qrShown=${s.qrCount} ${why}`);
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync(authDir(tenantId), { recursive: true, force: true });
        setState(tenantId, { status: 'disconnected', qr: null, code: null, phone: null, error: 'انقطع الربط من الموبايل — اربط من جديد' });
        q.run('UPDATE tenants SET wa_phone = NULL WHERE id = ?', tenantId);
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        setState(tenantId, { status: 'disconnected', error: 'نفس الرقم انفتح بمكان تاني (سيرفر تاني؟)' });
        return;
      }
      // ما مسح الكود وانتهت مهلة الـ QR → منوقف وما منضل نعيد
      if (!s.everOpen && !state.creds?.me && code !== DisconnectReason.restartRequired) {
        let error = 'انتهت مهلة الربط، اضغط ربط من جديد';
        if (code === 405) error = 'واتساب رفض الاتصال (405). غالباً لازم تحديث مكتبة الربط.';
        else if (code === 403) error = 'واتساب رفض هالرقم (403). ممكن يكون محظور أو مقيّد.';
        else if (!s.qrCount) error = `ما قدرنا نوصل لسيرفرات واتساب${code ? ' (' + code + ')' : ''}. تأكد من النت وجرّب كمان مرة.${why ? ' [' + why.slice(0, 80) + ']' : ''}`;
        setState(tenantId, { status: 'disconnected', qr: null, code: null, error });
        return;
      }
      const wait = code === DisconnectReason.restartRequired ? 500 : Math.min(300_000, 3000 * 2 ** s.retries);
      s.retries++;
      setState(tenantId, { status: 'connecting', qr: null });
      setTimeout(() => { if (!s.stopped) start(tenantId, { pairPhone: null }).catch(e => setState(tenantId, { status: 'error', error: e.message })); }, wait);
    }
  });

  // لما يرتبط الرقم، واتساب بيبعت آخر المحادثات: منتعلّم منها أسلوب صاحب المتجر
  sock.ev.on('messaging-history.set', async ({ messages, chats, contacts }) => {
    // كل أرقام المحادثات القديمة بتنحفظ بجهات الاتصال
    try {
      noteContacts(tenantId, (contacts || []).filter(c => c.name));
      const nm = new Map((contacts || []).map(c => [c.id, c.notify || c.name || c.verifiedName || '']));
      const list = [];
      const pnOf = (...ids) => { for (const x of ids) { const v = String(x || ''); if (/@s\.whatsapp\.net$/.test(v)) return phoneFromJid(v); } return ''; };
      const lidMap = sock.signalRepository?.lidMapping;
      const lidPn = async (lid) => { try { const pn = lidMap?.getPNForLID ? await lidMap.getPNForLID(lid) : null; return pn && /@s\.whatsapp\.net$/.test(pn) ? phoneFromJid(pn) : ''; } catch { return ''; } };
      const phoneFor = async (...ids) => { const p = pnOf(...ids); if (p) return p; const lid = ids.find(x => /@lid$/.test(String(x || ''))); if (!lid) return ''; const r = await lidPn(lid); if (!r) rememberLid(tenantId, lid); return r; };
      let lidHits = 0;
      for (const c of [...(chats || []), ...(contacts || [])]) { if (/@g\.us$|@broadcast$|@newsletter$/.test(c.id || '')) continue; const p = await phoneFor(c.id, c.pnJid, c.phoneNumber, c.lidJid); if (p) { list.push({ phone: p }); if (/@lid$/.test(c.id || '')) lidHits++; } }
      for (const m of messages || []) {
        const rj = m.key?.remoteJid || ''; if (/@g\.us$|@broadcast$|@newsletter$|^status@/.test(rj)) continue;
        const p = await phoneFor(rj, m.key?.remoteJidAlt, m.key?.senderPn); if (!p) continue;
        list.push({ phone: p });
        if (m.key?.fromMe) continue;
        const t0 = m.message?.conversation || m.message?.extendedTextMessage?.text || m.message?.imageMessage?.caption || '';
        if (t0) { keepText(tenantId, p, t0); learnName(tenantId, p, t0); }
      }
      if (lidHits) console.log(`[wa] tenant ${tenantId}: ${lidHits} archived/hidden chats matched to numbers`);
      rememberHistory(tenantId, list);
      if (bookReady(tenantId)) queueContacts(tenantId, list);
    } catch (e) { console.error('[wa] history contacts', e.message); }
    try {
      if (!messages?.length) return;
      const { getTenant } = await import('../tenants.js');
      const t = getTenant(tenantId);
      if (!t || t.settings.learn_from_history === false) return;
      const { buildPairs, savePairs } = await import('../style.js');
      const byChat = new Map();
      for (const m of messages) {
        const jid = m.key?.remoteJid || '';
        if (!m.message || !jid || /@g\.us$|@broadcast$|@newsletter$|^status@/.test(jid)) continue;
        const { text } = extract(m.message);
        if (!text) continue;
        const raw = m.messageTimestamp;
        const ts = Number(raw?.toNumber?.() ?? raw?.low ?? raw ?? 0);
        if (!byChat.has(jid)) byChat.set(jid, []);
        byChat.get(jid).push({ me: !!m.key.fromMe, text, ts });
      }
      let pairs = [];
      for (const list of byChat.values()) { list.sort((a, b) => a.ts - b.ts); pairs = pairs.concat(buildPairs(list)); }
      if (!pairs.length) return;
      const n = savePairs(tenantId, pairs, 'history');
      if (n) {
        console.log(`[wa] tenant ${tenantId}: learned ${n} reply examples from chat history`);
        emit(tenantId, 'notice', { text: `🧠 الوكيل تعلّم ${n} رد من محادثاتك القديمة` });
      }
    } catch (e) { console.error('[wa] history', e.message); }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const { handleInbound, isBotSent, botWillHandle } = await import('../agent.js');
    for (const m of messages) {
      try {
        const jid = m.key?.remoteJid || '';
        if (!jid || /@g\.us$|@broadcast$|@newsletter$|^status@/.test(jid)) continue;
        if (!m.message) { if (m.messageStubType) console.log(`[wa] tenant ${tenantId}: could not decrypt a message from ${jid} (WhatsApp will resend it)`); continue; }
        if (m.key.fromMe && isBotSent(m.key.id)) continue;
        let { text, mediaNote, quote } = extract(m.message, !m.key.fromMe);
        if (!text && !mediaNote) continue;
        const alt = m.key.remoteJidAlt || m.key.senderPn || m.key.participantPn || null;
        const phone = phoneFromJid(jid.endsWith('@s.whatsapp.net') ? jid : alt || '');
        // بس الأرقام يلي البوت رح يرد عليها: منعلّمها مقروءة ومنحلّل صوتها وصورها. الباقي بيضل متل ما هو (مو مقروء) لترد إنت
        const mine = !m.key.fromMe && botWillHandle(tenantId, { jid, phone });
        if (mine) sock.readMessages([m.key]).catch(() => {});
        // الوكيل بيسمع الصوت وبيشوف الصور
        let mediaUrl = null;
        if (mine) {
          const r = await understandMedia(tenantId, sock, m).catch(e => { console.error('[wa] media', e.message); return null; });
          if (r) { mediaNote = (quote && !text ? quote + ' ' : '') + r.note; mediaUrl = r.url || null; }
        }
        // مع كل رسالة: الرقم بينحفظ، ومنفتّش بالمحادثة كلها عن اسمو. إذا لقينا اسم (أو أطول/أكمل) منحدّث جهة الاتصال فوراً
        if (!m.key.fromMe && phone) {
          const key = tenantId + ':' + phone, before = realNames[key] || '';
          if (Number(tenantId) === KO_TENANT) { learnInfo(tenantId, phone, chatInfo(tenantId, phone, text)); rescanChat(tenantId, phone); }
          const now = realNames[key] || '';
          if (now !== before) { keepNames(); console.log(`[wa] tenant ${tenantId}: name for ${phone}: «${now}»`); }
          (now && now !== before ? saveContact(tenantId, phone, now, true) : saveContact(tenantId, phone, '')).catch(() => {});
        }
        console.log(`[wa] tenant ${tenantId}: ${m.key.fromMe ? 'you replied to' : 'message from'} ${phone || jid}: ${(text || mediaNote || '').slice(0, 60).replace(/\n/g, ' ')}`);
        handleInbound(tenantId, { jid, phone, name: m.pushName || null, text, mediaNote, mediaUrl, waId: m.key.id, fromMe: !!m.key.fromMe });
      } catch (e) { console.error('[wa] inbound', e.message); }
    }
  });
  return status(tenantId);
}

async function understandMedia(tenantId, sock, m) {
  const { getTenant } = await import('../tenants.js');
  const t = getTenant(tenantId);
  if (!t || t.settings.understand_media === false) return null;
  let msg = m.message;
  for (let i = 0; i < 4; i++) { const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message; if (!inner) break; msg = inner; }
  const audio = msg.audioMessage, image = msg.imageMessage;
  if (!audio && !image) return null;
  if (audio && Number(audio.seconds || 0) > 180) return { note: '[العميل بعت رسالة صوتية طويلة كتير، اطلب منه يكتب أو يختصر بلطف]' };
  const { downloadMediaMessage } = await lib();
  const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: silent, reuploadRequest: sock.updateMediaMessage });
  if (!buf?.length) return null;
  if (audio) {
    const { transcribe } = await import('../voice.js');
    const text = await transcribe(t, buf, audio.mimetype || 'audio/ogg', 'ar').catch(e => { console.error('[wa] voice', e.message); return null; });
    if (!text) return null;
    console.log(`[wa] tenant ${tenantId}: voice note understood: ${text.slice(0, 60)}`);
    return { note: `🎤 (رسالة صوتية من العميل، هاد يلي قاله): ${text}` };
  }
  // صورة: منحفظها لتبين بالمحادثات، ومنوصف شو فيها
  const fsm = await import('node:fs'), pathm = await import('node:path'), cr = await import('node:crypto');
  const ext = (image.mimetype || '').includes('png') ? 'png' : (image.mimetype || '').includes('webp') ? 'webp' : 'jpg';
  const name = `${tenantId}-in-${cr.randomBytes(8).toString('hex')}.${ext}`;
  if (buf.length < 8 * 1024 * 1024) fsm.writeFileSync(pathm.join(DATA_DIR, 'uploads', name), buf);
  const { describeImage } = await import('../media.js');
  const desc = await describeImage(t, buf, image.mimetype).catch(e => { console.error('[wa] vision', e.message); return null; });
  if (desc) console.log(`[wa] tenant ${tenantId}: image understood: ${desc.slice(0, 60)}`);
  return { url: `/uploads/${name}`, note: desc ? `📷 (العميل بعت صورة، وهاد يلي فيها): ${desc}` : '[العميل بعت صورة، وما قدرنا نشوف شو فيها، اسأله عنها بلطف]' };
}

function extract(msg, incoming = false) {
  let m = msg;
  for (let i = 0; i < 4; i++) {
    const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.documentWithCaptionMessage?.message || m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  const text = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption
    || m.buttonsResponseMessage?.selectedDisplayText || m.listResponseMessage?.title || m.templateButtonReplyMessage?.selectedDisplayText || '';
  let mediaNote = null;
  if (m.imageMessage && !m.imageMessage.caption) mediaNote = '[العميل بعت صورة بدون نص]';
  else if (m.audioMessage) mediaNote = '[العميل بعت رسالة صوتية — ما فيك تسمعها، اطلب منه يكتب طلبه بلطف]';
  else if (m.videoMessage && !m.videoMessage.caption) mediaNote = '[العميل بعت فيديو]';
  else if (m.stickerMessage) mediaNote = '[ملصق]';
  else if (m.locationMessage) mediaNote = `[موقع العميل: ${m.locationMessage.degreesLatitude},${m.locationMessage.degreesLongitude}${m.locationMessage.address ? ' — ' + m.locationMessage.address : ''}]`;
  else if (m.contactMessage) mediaNote = `[جهة اتصال: ${m.contactMessage.displayName || ''}]`;
  else if (m.documentMessage && !m.documentMessage.caption) mediaNote = '[ملف]';
  else if (m.reactionMessage) return { text: '', mediaNote: null }; // التفاعلات منتجاهلها
  // الزبون ردّ على رسالة معيّنة (سحبها لليمين): منضيف نص هديك الرسالة ليفهم البوت على شو عم يرد
  let out = text.trim(), quote = '';
  if (incoming) {
    const ci = (m.extendedTextMessage || m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.stickerMessage || {}).contextInfo;
    const qm = ci && ci.quotedMessage;
    if (qm) {
      const qt = (qm.conversation || qm.extendedTextMessage?.text || qm.imageMessage?.caption || qm.videoMessage?.caption || (qm.imageMessage ? '[صورة]' : qm.audioMessage ? '[رسالة صوتية]' : '')).replace(/\s+/g, ' ').trim().slice(0, 300);
      if (qt) { quote = `↩️ (الزبون عم يرد على هالرسالة: «${qt}»)`; if (out) out = quote + ' ' + out; else mediaNote = quote + ' ' + (mediaNote || ''); }
    }
  }
  return { text: out, mediaNote, quote };
}

function mediaSource(url) {
  if (url.startsWith('/uploads/')) return { url: path.join(DATA_DIR, 'uploads', path.basename(url)) };
  return { url };
}

// حفظ رقم الزبون بجهات اتصال الواتس (بالموبايل كمان). مرة وحدة لكل رقم، ومنحدّث الاسم إذا الزبون كتب اسمو الحقيقي
const SAVED_FILE = path.join(DATA_DIR, 'wa-saved-contacts.json');
let saved = {}; try { saved = JSON.parse(fs.readFileSync(SAVED_FILE, 'utf8')); } catch {}
let savedT = null;
const KO_TENANT = Number(process.env.KO_TENANT_ID || 1); // حفظ جهات الاتصال بس لمتجر Ko Sport
// الأسماء الحقيقية يلي الزبون كتبها بالمحادثة أو بطلب (مو اسم الواتس)
const NAMES_FILE = path.join(DATA_DIR, 'ko-names.json');
let realNames = {}; try { realNames = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8')); } catch {}
// تنضيف: أسماء غلط لقطناها قبل (مو أسماء ناس) منشيلها، ومنرجّع رقمها «زبون XXXX» إذا نحنا يلي سجلناه فيها
setTimeout(() => {
  try {
    let bad = 0;
    for (const [k, v] of Object.entries(realNames)) { if (!validName(v)) { const sv = saved[k]; if (sv && !isPlaceholder(sv) && validName(sv)) realNames[k] = sv; else delete realNames[k]; bad++; } }
    if (bad) { fs.writeFileSync(NAMES_FILE, JSON.stringify(realNames)); console.log(`[wa] cleaned ${bad} wrong names`); }
  } catch {}
}, 1000);
const BAD_NAME = /^(بدي|عندك|عندكن|شو|كيف|مرحبا|اهلا|أهلا|تمام|منيح|زبون|حاضر|اي|إي|لا|بس|هون|من|عم|رح|ما|مو|شوي|اليوم|هلق|هلا|بدنا|كان|يا|و|بالله|والله)$/;
const AREAS = ['ريف دمشق', 'دمشق', 'الشام', 'حلب', 'حمص', 'حماة', 'حماه', 'اللاذقية', 'اللادقية', 'طرطوس', 'إدلب', 'ادلب', 'درعا', 'السويداء', 'القنيطرة', 'دير الزور', 'ديرالزور', 'الرقة', 'الحسكة', 'القامشلي', 'جبلة', 'بانياس', 'السلمية', 'سلمية', 'منبج', 'تدمر', 'النبك', 'يبرود', 'الزبداني', 'جرمانا', 'صحنايا', 'قدسيا', 'التل', 'دوما', 'حرستا', 'المزة', 'معضمية', 'الكسوة', 'داريا', 'قطنا', 'مصياف', 'صافيتا', 'شهبا', 'إزرع', 'ازرع', 'الصنمين', 'نوى', 'جاسم', 'البوكمال', 'الميادين', 'عفرين', 'اعزاز', 'الباب'];
const FIRST_NAMES = new Set(["آدم", "آلاء", "آية", "أحمد", "أريج", "أسامة", "أسامه", "أسماء", "أكرم", "أماني", "أمجد", "أمل", "أنس", "أيمن", "أيهم", "أيوب", "إبراهيم", "إسراء", "إسماعيل", "إلياس", "إياد", "إيلي", "إيمان", "إيناس", "إيهاب", "ابراهيم", "احمد", "ادم", "اريج", "اسامة", "اسامه", "اسراء", "اسماء", "اسماعيل", "اكرم", "الاء", "الياس", "اليان", "اماني", "امجد", "امل", "انس", "اياد", "اية", "ايلي", "ايمان", "ايمن", "ايناس", "ايهاب", "ايهم", "ايوب", "باسل", "باسم", "بتول", "براءة", "بشار", "بشرى", "بشير", "بطرس", "بلال", "بنان", "بهاء", "بيان", "تالا", "تامر", "تسنيم", "تقى", "تماضر", "توفيق", "تيسير", "ثائر", "جابر", "جاد", "جبران", "جلال", "جمال", "جمانة", "جمانه", "جميل", "جنا", "جنى", "جهاد", "جواد", "جود", "جورج", "جوري", "جوزيف", "جوني", "حازم", "حافظ", "حامد", "حبيب", "حسام", "حسن", "حسين", "حكمت", "حلا", "حمدي", "حمزة", "حمزه", "حميد", "حنان", "حنين", "حياة", "حيان", "حيدر", "خالد", "خديجة", "خديجه", "خضر", "خطاب", "خلدون", "خليل", "دانا", "دانة", "دانه", "داود", "داوود", "ديانا", "ديب", "ديما", "دينا", "ذياب", "رأفت", "رائد", "راتب", "رافت", "راما", "رامز", "رامي", "رانيا", "رانيه", "ربا", "ربيع", "رجاء", "رحاب", "رزان", "رستم", "رشا", "رشيد", "رضا", "رعد", "رغد", "رنا", "رنيم", "رهف", "رواد", "روان", "رودي", "رولا", "روني", "رياض", "ريان", "ريم", "ريما", "زكريا", "زهراء", "زهرة", "زهره", "زهير", "زياد", "زيد", "زين", "زينب", "سارة", "ساره", "سالم", "سامح", "سامر", "سامي", "سراج", "سعد", "سعود", "سعيد", "سفيان", "سلمان", "سلمى", "سلوى", "سليم", "سليمان", "سماح", "سمر", "سمية", "سمير", "سميه", "سنان", "سهى", "سهيل", "سوسن", "سومر", "سيلا", "سيلين", "شادي", "شاكر", "شام", "شامل", "شربل", "شريف", "شفيق", "شهاب", "شهد", "شيماء", "صابر", "صادق", "صافي", "صالح", "صخر", "صفاء", "صفوان", "صلاح", "صهيب", "ضحى", "ضياء", "طارق", "طلال", "طه", "طوني", "عائشة", "عائشه", "عادل", "عاصم", "عامر", "عبد", "عبدالحميد", "عبدالرحمن", "عبدالرحيم", "عبدالسلام", "عبدالعزيز", "عبدالغني", "عبدالقادر", "عبدالكريم", "عبدالله", "عبود", "عبير", "عثمان", "عدنان", "عدي", "عرفان", "عزام", "عزت", "عزيز", "عزيزة", "عزيزه", "عصام", "عفاف", "علا", "علاء", "علي", "عماد", "عمار", "عمر", "عمران", "عوض", "عيسى", "غادة", "غاده", "غدير", "غزل", "غسان", "غنى", "غياث", "غيث", "فؤاد", "فاتن", "فادي", "فارس", "فاطمة", "فاطمه", "فايز", "فدوى", "فراس", "فرح", "فريد", "فهد", "فواد", "فيصل", "قاسم", "قتيبة", "قتيبه", "قصي", "قيس", "كامل", "كرم", "كريم", "كمال", "كنان", "كندة", "كنده", "كيفورك", "لؤاي", "لؤى", "لؤي", "لارا", "لانا", "لبنى", "لجين", "لما", "لمى", "لميس", "ليال", "ليث", "ليلا", "ليلى", "لين", "لينا", "ليندا", "ليون", "مأمون", "مؤمن", "مؤيد", "ماجد", "مارك", "ماري", "ماريا", "ماريو", "مازن", "مالك", "مامون", "ماهر", "مايا", "مجاهد", "مجد", "مجدولين", "مجدولينا", "مجدي", "محسن", "محمد", "محمدعلي", "محمود", "مدحت", "مراد", "مروان", "مروة", "مروه", "مريم", "مصطفى", "مصعب", "معاذ", "معاز", "معتز", "مفيد", "مقداد", "ملك", "منار", "منذر", "منى", "منير", "مها", "مهدي", "مهند", "مهيب", "موسى", "موفق", "مومن", "ميار", "ميرا", "ميرنا", "ميس", "ميساء", "ميسم", "ميسون", "ميشال", "ميشيل", "نادر", "نادية", "نادين", "ناديه", "نبيل", "نجلاء", "نجوى", "نديم", "نزار", "نزيه", "نسرين", "نسمة", "نسمه", "نصر", "نضال", "نعمان", "نغم", "نهى", "نوار", "نواف", "نوال", "نور", "نورا", "نورس", "نيرمين", "نيكولا", "هادي", "هالة", "هاله", "هاني", "هبة", "هبه", "هدى", "هشام", "هلال", "همام", "هنادي", "هند", "هيا", "هيام", "هيثم", "وئام", "وائل", "وجد", "وجيه", "وحيد", "وسام", "وسيم", "وعد", "وفاء", "ولاء", "وليد", "يارا", "ياسر", "ياسمين", "ياسين", "يامن", "يحيى", "يزن", "يسرى", "يعقوب", "يمان", "يمن", "يوسف", "يونس"]);
const NOT_NAME = /^(بدي|بدنا|عندك|عندكن|شو|كيف|كيفك|مرحبا|مرحباً|اهلا|أهلا|اهلين|السلام|سلام|عليكم|عليكن|تمام|منيح|زبون|حاضر|اي|إي|لا|بس|هون|من|عم|رح|ما|مو|شوي|اليوم|هلق|هلا|كان|يا|و|بالله|والله|الله|يعطيك|العافية|العافيه|شكرا|شكراً|مشكور|طلب|طلبية|الطلب|عنوان|العنوان|شارع|جانب|قرب|بجانب|حارة|حي|بناء|بناية|طابق|محل|المحل|محلنا|مقابل|خلف|جادة|ساحة|دوار|ابعتلي|ابعتو|بعتلي|بعات|ارسل|سعر|السعر|قديش|كم|وين|متى|ليش|حبيبي|اخي|أخي|خيي|استاذ|أستاذ|يسلمو|صباح|مساء|الخير|النور|رقم|الرقم|ورقم|والرقم|رقمي|رقمو|موبايل|هاتف|تلفون|تلفونو|جوال|المحافظة|محافظة|المنطقة|منطقة|المدينة|مدينة|قفاز|قفازات|كفوف|شورت|حزام|مقاس|لون|اسود|أسود|احمر|أحمر|ابيض|أبيض|ازرق|أزرق|دولار|ليرة|كاش|توصيل|شحن|الشحن|القدموس|الهرم|الكرنك|مكتب|فرع|كراج|ok|اوك|ياريت|لو|سمحت|اذا|إذا|ممكن|بليز|please|هاد|هيدا|هي|هو|هاي|مع|ثلاثي|الثلاثي|الكامل|الاسم|اسم|الشركة|شركة|الي|اللي|يلي|تبع|بالضبط|بالتحديد|الماركة|ماركة|سواء|بالطول|مسؤول|مسؤولة|مشتريات|والعنوان|وعنوانو|عنوانو|الصيانة|صيانة|عالم|بهل|هل|مشان|كرمال|كمان|برضو|ف|بعد|قبل|حتى|على|عالم|عند)$/i;
const norm1 = (w) => w.replace(/^أ|^إ|^آ/, 'ا').replace(/ة$/, 'ه');
const isFirst = (w) => FIRST_NAMES.has(w) || FIRST_NAMES.has(norm1(w)) || [...FIRST_NAMES].some(n => norm1(n) === norm1(w));
const nameWords = (line) => String(line || '').replace(/[ً-ْـ]/g, '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
// الاسم: أول كلمة لازم تكون اسم معروف (أو «ابو/أم فلان»)، والباقي كنية/عيلة. منوقف عند أول كلمة مو اسم
function cleanName(ws) {
  ws = ws.filter(Boolean); if (!ws.length) return '';
  let i = 0, out = [];
  if (/^(ابو|أبو|ام|أم)$/.test(ws[0]) && ws[1] && /^\p{Script=Arabic}{3,15}$/u.test(ws[1]) && !NOT_NAME.test(ws[1])) { out = [ws[0], ws[1]]; i = 2; }
  else if (isFirst(ws[0])) { out = [ws[0]]; i = 1; }
  else return '';
  for (; i < ws.length && out.length < 3; i++) {
    const w = ws[i];
    if (!/^\p{Script=Arabic}{2,15}$/u.test(w) || NOT_NAME.test(w) || AREAS.includes(w)) break;
    if (isFirst(w) || w === 'عبد' || /^ال\p{Script=Arabic}{2,}$/u.test(w)) { out.push(w); continue; }
    if (/^(و|ب|ل|ف|ي|ت|ن)/.test(w) && !/^(بكري|بشير|بدر|تركي|تيم|يونس|نجيب|نصر|نوح|ناصر|نعمان|نمر|بيطار|بركات|برهان|بعكر|ترك|نحاس|نابلسي|لطفي|فخري|فاخوري|وهبة|وهبه|وردة)$/.test(w)) break;
    out.push(w);
  }
  if (out.length > 1 && out[out.length - 1] === 'عبد') out.pop();
  return out.join(' ');
}
const areaIn = (t) => { const x = String(t || ''); for (const a of AREAS) if (new RegExp(`(^|[\\s:،,\\-])${a}($|[\\s:،,\\-.])`, 'u').test(x)) return a.replace(/^الشام$/, 'دمشق').replace(/^ادلب$/, 'إدلب').replace(/^حماه$/, 'حماة').replace(/^اللادقية$/, 'اللاذقية').replace(/^ديرالزور$/, 'دير الزور').replace(/^سلمية$/, 'السلمية').replace(/^ازرع$/, 'إزرع'); return ''; };
export function validName(n) { const ws = String(n || '').split(' - ')[0].split(/\s+/); return !!ws[0] && cleanName(ws) === ws.join(' '); }
// اسم الشخص (تنائي أو تلاتي) والمحافظة من رسالتو: «اسمي…»، «الاسم: …»، أو رسالة طلب فيها اسم ورقم ومحافظة
export function infoFromText(t) {
  const x = String(t || '').replace(/[‎‏‪-‮]/g, '').trim(); if (!x || x.length > 600) return { name: '', area: '' };
  const area = areaIn(x); let name = '';
  const lab = x.match(/(?:^|\n)\s*(?:اسمي|إسمي|أسمي)\s*[:：\-]?\s*([^\n\d:]{3,60})/u) || x.match(/(?:^|\n)\s*(?:الاسم الثلاثي|الإسم الثلاثي|الاسم الكامل|الاسم|الإسم|الأسم|اسم)\s*[:：\-]\s*([^\n\d:]{3,60})/u) || x.match(/^(?:معك|معاك|معكم|معكن)\s+([^\n\d]{3,40})/u) || x.match(/(?:^|\n|\s)(?:انا|أنا)\s+([^\n\d]{3,40})/u);
  if (lab) name = cleanName(nameWords(lab[1]));
  if (!name && /(?:\+?963|0)?9\d{8}/.test(x.replace(/[\s\-]/g, ''))) { // رسالة طلب فيها رقم موبايل → سطر بيبلش باسم معروف
    for (const line of x.split(/\n|،|,|-/)) { const nm = cleanName(nameWords(line.replace(/(?:\+?963|0)?9[\d\s]{8,12}/g, ' '))); if (nm) { name = nm; break; } }
  }
  return { name, area };
}
export function nameFromText(t) { return infoFromText(t).name; }
export function realName(tenantId, phone) { return realNames[tenantId + ':' + String(phone || '').replace(/\D/g, '')] || ''; }
let namesT = null;
export async function setRealName(tenantId, phone, name, area = '') {
  const num = String(phone || '').replace(/\D/g, ''), ar = String(area || '').trim().slice(0, 30);
  let nm = String(name || '').trim().slice(0, 40); if (nm && ar && !nm.includes(ar)) nm = `${nm} - ${ar}`; // الاسم مع المنطقة/المحافظة
  if (num.length < 8 || !/[\p{L}]{2,}/u.test(nm)) return false;
  const key = tenantId + ':' + num; if (realNames[key] === nm) return true;
  realNames[key] = nm; clearTimeout(namesT); namesT = setTimeout(() => { try { fs.writeFileSync(NAMES_FILE, JSON.stringify(realNames)); } catch {} }, 1500);
  return saveContact(tenantId, num, nm, true);
}
// ===== دفتر عناوين الواتس (الأسماء المحفوظة عندك) =====
// بيوصل من الواتس مع كل ربط. أي رقم إلو اسم محفوظ ما منقرّبلو أبداً، إلا إذا الاسم «زبون XXXX» يلي نحنا حطيناه
const BOOK_FILE = path.join(DATA_DIR, 'wa-addressbook.json');
let book = {}; try { book = JSON.parse(fs.readFileSync(BOOK_FILE, 'utf8')); } catch {}
let bookT = null, bookSeen = 0;
export function noteContacts(tenantId, list) {
  let n = 0;
  for (const c of list || []) {
    const id = String(c.id || ''), pn = /@s\.whatsapp\.net$/.test(id) ? id : String(c.phoneNumber || '');
    const num = pn.split('@')[0].split(':')[0].replace(/\D/g, ''), nm = String(c.name || '').trim();
    if (num.length >= 8 && nm) { book[tenantId + ':' + num] = nm; n++; }
  }
  if (n) { bookSeen += n; clearTimeout(bookT); bookT = setTimeout(() => { try { fs.writeFileSync(BOOK_FILE, JSON.stringify(book)); } catch {} }, 2000); }
}
// الاسم المحفوظ بجهات اتصالك لهالرقم (أو '' إذا مو محفوظ)
export function bookName(tenantId, phone) {
  const num = String(phone || '').replace(/\D/g, ''); if (num.length < 8) return '';
  if (book[tenantId + ':' + num]) return book[tenantId + ':' + num];
  const k = Object.keys(book).find(x => x.startsWith(tenantId + ':') && x.slice(-9) === num.slice(-9));
  return k ? book[k] : '';
}
// منطلب من الواتس نسخة كاملة من جهات الاتصال (الأسماء المحفوظة عندك) مشان نعرف مين مسجّل ومين لأ
async function bookResync(tenantId, sock, state) {
  if (Number(tenantId) !== KO_TENANT || typeof sock.resyncAppState !== 'function') return;
  const flag = path.join(DATA_DIR, `wa-book-synced-${tenantId}.txt`);
  if (bookReady(tenantId) && fs.existsSync(flag)) return;
  const before = Object.keys(book).filter(k => k.startsWith(tenantId + ':')).length;
  console.log(`[wa] tenant ${tenantId}: fetching your saved contact names from WhatsApp…`);
  await state.keys.set({ 'app-state-sync-version': { critical_unblock_low: null } }); // من الصفر = نسخة كاملة
  await sock.resyncAppState(['critical_unblock_low'], true);
  await new Promise(r => setTimeout(r, 4000));
  const after = Object.keys(book).filter(k => k.startsWith(tenantId + ':')).length;
  console.log(`[wa] tenant ${tenantId}: address book now has ${after} saved names (was ${before})`);
  if (after >= 10) { try { fs.writeFileSync(flag, new Date().toISOString()); } catch {} setTimeout(() => queueAllKnown(tenantId), 5000); }
}
// نصوص رسائل الزباين من المحادثات القديمة (مشان نرجع نفتش فيها عن أسماءهن بأي وقت)
const TEXTS_FILE = path.join(DATA_DIR, 'wa-history-texts.json');
let histTexts = {}; try { histTexts = JSON.parse(fs.readFileSync(TEXTS_FILE, 'utf8')); } catch {}
let textsT = null;
function keepText(tenantId, phone, t) {
  const k = tenantId + ':' + phone, a = histTexts[k] = histTexts[k] || [], v = String(t).slice(0, 400);
  if (a.includes(v) || a.length >= 60) return; a.push(v);
  clearTimeout(textsT); textsT = setTimeout(() => { try { fs.writeFileSync(TEXTS_FILE, JSON.stringify(histTexts)); } catch {} }, 4000);
}
// محادثات جاية برقم مخفي (LID) وما عرفنا رقمها لهلق: منرجع نجرّب بعدين (الواتس بيبعت الربط شوي شوي)
const LIDS_FILE = path.join(DATA_DIR, 'wa-history-lids.json');
let histLids = {}; try { histLids = JSON.parse(fs.readFileSync(LIDS_FILE, 'utf8')); } catch {}
let lidsT = null;
function rememberLid(tenantId, lid) {
  const a = histLids[tenantId] = histLids[tenantId] || []; if (a.includes(lid)) return; a.push(lid);
  clearTimeout(lidsT); lidsT = setTimeout(() => { try { fs.writeFileSync(LIDS_FILE, JSON.stringify(histLids)); } catch {} }, 3000);
}
async function resolveLids(tenantId) {
  const s = sessions.get(tenantId), map = s?.sock?.signalRepository?.lidMapping, a = histLids[tenantId] || [];
  if (!map?.getPNForLID || !a.length) return 0;
  const left = [], found = [];
  for (const lid of a) { let pn = ''; try { pn = await map.getPNForLID(lid); } catch {} if (pn && /@s\.whatsapp\.net$/.test(pn)) found.push({ phone: phoneFromJid(pn) }); else left.push(lid); }
  histLids[tenantId] = left; try { fs.writeFileSync(LIDS_FILE, JSON.stringify(histLids)); } catch {}
  if (found.length) { rememberHistory(tenantId, found); if (bookReady(tenantId)) queueContacts(tenantId, found); }
  console.log(`[wa] tenant ${tenantId}: hidden chats — ${found.length} matched now, ${left.length} still unknown`);
  return found.length;
}
// الاسم يلي كتبو الشخص بنفسو (الأطول/التلاتي بيغلب) + المحافظة
function learnName(tenantId, phone, t) { return learnInfo(tenantId, phone, infoFromText(t)); }
function learnInfo(tenantId, phone, { name, area } = {}) {
  if (!name) return false;
  const key = tenantId + ':' + phone, cur = String(realNames[key] || ''), curName = cur.split(' - ')[0];
  if (curName && curName.split(' ').length >= name.split(' ').length) { if (area && !cur.includes(' - ')) { realNames[key] = `${curName} - ${area}`; return true; } return false; }
  realNames[key] = area ? `${name} - ${area}` : (cur.includes(' - ') ? `${name} - ${cur.split(' - ')[1]}` : name);
  return true;
}
// الاسم من المحادثة كلها (مو بس من رسالة فيها «اسمي…»): جواب على «شو اسمك؟»، «أنا فلان»، ورسائلو القديمة
const ASK_NAME = /(اسمك|إسمك|الاسم|الإسم|اسم حضرتك|اسمكم|اسمكن)/;
function askedName(t) { const ws = nameWords(t); return ws.length && ws.length <= 4 ? cleanName(ws) : ''; }
function chatInfo(tenantId, phone, text) {
  const inf = infoFromText(text); if (inf.name) return inf;
  try {
    const prev = q.get("SELECT m.body FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.tenant_id = ? AND c.phone = ? AND m.direction = 'out' ORDER BY m.id DESC LIMIT 1", tenantId, phone);
    const nm = prev && ASK_NAME.test(prev.body || '') ? askedName(text) : '';
    if (nm) return { name: nm, area: inf.area };
  } catch {}
  return inf;
}
// أول رسالة من رقم ما منعرف اسمو (بهالتشغيلة): منقرا كل رسائلو القديمة مشان نلاقي إذا كتب اسمو قبل
const rescanned = new Set();
function rescanChat(tenantId, phone) {
  const key = tenantId + ':' + phone; if (realNames[key] || rescanned.has(key)) return false; rescanned.add(key);
  let got = false, asked = false;
  try {
    for (const m of q.all("SELECT m.direction d, m.body FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.tenant_id = ? AND c.phone = ? ORDER BY m.id", tenantId, phone)) {
      if (m.d === 'out') { asked = ASK_NAME.test(m.body || ''); continue; }
      if (learnName(tenantId, phone, m.body)) got = true;
      else if (asked && learnInfo(tenantId, phone, { name: askedName(m.body), area: areaIn(m.body) })) got = true;
      asked = false;
    }
  } catch {}
  for (const t of histTexts[key] || []) if (learnName(tenantId, phone, t)) got = true;
  return got;
}
function keepNames() { clearTimeout(namesT); namesT = setTimeout(() => { try { fs.writeFileSync(NAMES_FILE, JSON.stringify(realNames)); } catch {} }, 1500); }
// كل أرقام المحادثات القديمة يلي إجت من الواتس (منحفظها لحتى تصير جهات اتصالك جاهزة)
const HIST_FILE = path.join(DATA_DIR, 'wa-history-numbers.json');
let histNums = {}; try { histNums = JSON.parse(fs.readFileSync(HIST_FILE, 'utf8')); } catch {}
let histT = null;
function rememberHistory(tenantId, list) {
  const set = new Set(histNums[tenantId] || []), n0 = set.size;
  for (const x of list || []) { const p = String(x.phone || '').replace(/\D/g, ''); if (p.length >= 9) set.add(p); }
  if (set.size === n0) return;
  histNums[tenantId] = [...set];
  clearTimeout(histT); histT = setTimeout(() => { try { fs.writeFileSync(HIST_FILE, JSON.stringify(histNums)); } catch {} console.log(`[wa] tenant ${tenantId}: ${set.size} numbers from your old chats`); }, 3000);
}
const bookReady = (tenantId) => Object.keys(book).filter(k => k.startsWith(tenantId + ':')).length >= 10;
const isPlaceholder = (n) => /^زبون \d{4}$/.test(String(n || '').trim());
export async function saveContact(tenantId, phone, name, force = false) {
  if (Number(tenantId) !== KO_TENANT || !isActive()) return false;
  const s = sessions.get(tenantId), num = String(phone || '').replace(/\D/g, '');
  if (!s?.sock?.addOrEditContact || s.status !== 'open' || num.length < 8) return false;
  if (!bookReady(tenantId)) return false; // ما وصلت أسماءك من الواتس لهلق: ما منلمس شي
  // رقم المتجر نفسو وأرقام صاحب المتجر: لا
  try { const t = getTenant(tenantId), own = [phoneFromJid(s.sock.user?.id), ...String(t?.settings?.owner_numbers || '').split(/[,،\s]+/), t?.settings?.notify_number].map(x => String(x || '').replace(/\D/g, '')).filter(Boolean); if (own.some(o => o.endsWith(num.slice(-9)) || num.endsWith(o.slice(-9)))) return false; } catch {}
  const key = tenantId + ':' + num, have = bookName(tenantId, num);
  const nm = String(realNames[key] || (force ? name : '') || '').replace(/[\u200e\u200f]/g, '').trim();
  const real = /[\p{L}]{2,}/u.test(nm) ? nm.slice(0, 60) : '';
  if (have) {
    // محفوظ عندك باسم: ما منغيّرو أبداً. بس إذا الاسم «زبون XXXX» ومنعرف الاسم الحقيقي، منبدّلو
    if (have === real) return true;
    if (!isPlaceholder(have) && have !== saved[key]) return true; // اسم انت حاططو: ما منلمسو أبداً (بس منصلّح الأسماء يلي نحنا حطيناها)
    if (isPlaceholder(have) && !real) return true;
  }
  const full = real || ('زبون ' + num.slice(-4));
  if (!have && saved[key] && saved[key] === full) return true;
  try {
    await s.sock.addOrEditContact(num + '@s.whatsapp.net', { fullName: full, firstName: full.split(' ')[0], saveOnPrimaryAddressbook: true });
    saved[key] = full; book[key] = full; clearTimeout(savedT); savedT = setTimeout(() => { try { fs.writeFileSync(SAVED_FILE, JSON.stringify(saved)); fs.writeFileSync(BOOK_FILE, JSON.stringify(book)); } catch {} }, 1500);
    console.log(`[wa] tenant ${tenantId}: contact ${num} ${have ? `«${have}» → ` : 'new → '}«${full}»`);
    return true;
  } catch (e) { console.error('[wa] save contact', num, e.message); return false; }
}

// حفظ كل الأرقام الموجودة (المحادثات القديمة + كل يلي راسل قبل) بالدور، رقم كل 2.5 ثانية مشان ما ينزعج الواتس
const bulk = new Map(); // tenantId -> Map(num -> name)
let bulkTimer = null;
export function queueContacts(tenantId, list) {
  if (Number(tenantId) !== KO_TENANT) return 0;
  const m = bulk.get(tenantId) || new Map(); let n = 0;
  for (const { phone, name } of list) { const num = String(phone || '').replace(/\D/g, ''); const bk = bookName(tenantId, num); if (num.length >= 8 && !m.has(num) && (() => { const k = tenantId + ':' + num, sv = saved[k], rn = realNames[k], want = rn || ('زبون ' + num.slice(-4)); if (!bk) return !sv || (sv !== want && (isPlaceholder(sv) ? !!rn : true)); if (isPlaceholder(bk)) return !!rn && bk !== rn; return bk === sv && sv !== want; })()) { m.set(num, name || ''); n++; } }
  bulk.set(tenantId, m);
  if (n) console.log(`[wa] tenant ${tenantId}: ${n} numbers queued to save in contacts`);
  if (!bulkTimer) bulkTimer = setInterval(async () => {
    let busy = false;
    for (const [tid, mm] of bulk) {
      const st = sessions.get(tid); if (!mm.size || st?.status !== 'open') continue;
      const [num, name] = mm.entries().next().value; mm.delete(num); busy = true;
      await saveContact(tid, num, name).catch(() => {});
    }
    if (!busy && [...bulk.values()].every(x => !x.size)) { clearInterval(bulkTimer); bulkTimer = null; }
  }, 2500);
  return n;
}
function queueAllKnown(tenantId) {
  if (Number(tenantId) !== KO_TENANT) return;
  resolveLids(tenantId).catch(() => {});
  try {
    // 1) الأسماء من الطلبات القديمة ومن يلي كتبو الزبون بالمحادثات («اسمي…»، «معك…»)
    let found = 0;
    for (const o of q.all("SELECT c.phone, o.customer_name n FROM orders o JOIN contacts c ON c.id = o.contact_id WHERE o.tenant_id = ? AND o.customer_name IS NOT NULL AND o.customer_name != ''", tenantId)) {
      const key = tenantId + ':' + String(o.phone || '').replace(/\D/g, ''); if (o.phone && !realNames[key] && /[\p{L}]{2,}/u.test(o.n)) { realNames[key] = String(o.n).trim().slice(0, 60); found++; }
    }
    for (const m of q.all("SELECT c.phone, m.body FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.tenant_id = ? AND m.direction = 'in' AND (m.body LIKE '%اسمي%' OR m.body LIKE '%إسمي%' OR m.body LIKE '%معك %' OR m.body LIKE '%معاك %' OR m.body LIKE '%الاسم%') ORDER BY m.id", tenantId)) {
      const nm = nameFromText(m.body), key = tenantId + ':' + String(m.phone || '').replace(/\D/g, '');
      if (nm && m.phone && realNames[key] !== nm) { realNames[key] = nm; found++; }
    }
    for (const [k, arr] of Object.entries(histTexts)) { if (!k.startsWith(tenantId + ':')) continue; const ph = k.slice(String(tenantId).length + 1); for (const t of arr) if (learnName(tenantId, ph, t)) found++; }
    for (const m of q.all("SELECT c.phone, m.body FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.tenant_id = ? AND m.direction = 'in' AND c.phone IS NOT NULL ORDER BY m.id", tenantId)) { if (learnName(tenantId, String(m.phone).replace(/\D/g, ''), m.body)) found++; }
    if (found) { try { fs.writeFileSync(NAMES_FILE, JSON.stringify(realNames)); } catch {} console.log(`[wa] tenant ${tenantId}: found ${found} real names in old chats/orders`); }
    // 2) كل الأرقام بالدور: بالاسم الحقيقي إذا منعرفو، وغير هيك «زبون XXXX». ويلي انحفظ «زبون» وهلق عرفنا اسمو بيتحدّث
    const list = q.all('SELECT phone FROM contacts WHERE tenant_id = ? AND phone IS NOT NULL', tenantId).map(c => ({ phone: c.phone })).concat((histNums[tenantId] || []).map(p => ({ phone: p })));
    if (!bookReady(tenantId)) { console.log(`[wa] tenant ${tenantId}: contact names from WhatsApp not received yet — not touching contacts`); return; }
    queueContacts(tenantId, list);
  } catch (e) { console.error('[wa] queue contacts', e.message); }
}

export async function send(tenantId, jid, { text, image, audio }) {
  const s = sessions.get(tenantId);
  if (!s?.sock || s.status !== 'open') throw new Error('واتساب مو مربوط حالياً');
  const content = audio ? { audio: mediaSource(audio), mimetype: 'audio/ogg; codecs=opus', ptt: true } : image ? { image: mediaSource(image), caption: text || undefined } : { text };
  try {
    const r = await s.sock.sendMessage(jid, content);
    return { id: r?.key?.id };
  } catch (e) {
    if ((image || audio) && text) { // إذا الصورة أو الصوت فشل، منبعت النص لحاله
      const r = await s.sock.sendMessage(jid, { text });
      return { id: r?.key?.id };
    }
    throw e;
  }
}

export async function typing(tenantId, jid) {
  const s = sessions.get(tenantId);
  if (s?.status !== 'open') return;
  try { await s.sock.presenceSubscribe(jid); await s.sock.sendPresenceUpdate('composing', jid); } catch {}
}

export async function logout(tenantId) {
  const s = sessions.get(tenantId);
  if (s) {
    s.stopped = true;
    try { if (s.status === 'open') await s.sock.logout(); else s.sock?.end(undefined); } catch {}
  }
  sessions.delete(tenantId);
  fs.rmSync(authDir(tenantId), { recursive: true, force: true });
  q.run('UPDATE tenants SET wa_phone = NULL WHERE id = ?', tenantId);
  emit(tenantId, 'wa', status(tenantId));
}

export function stop(tenantId) {
  const s = sessions.get(tenantId);
  if (s) { s.stopped = true; try { s.sock?.end(undefined); } catch {} }
  sessions.delete(tenantId);
}

// عند تشغيل السيرفر: إعادة وصل كل الأرقام المربوطة سابقاً
export async function bootAll() {
  const rows = q.all("SELECT id FROM tenants WHERE wa_provider = 'qr' AND status = 'active'");
  let n = 0;
  for (const { id } of rows) {
    if (!hasAuth(id)) continue;
    n++;
    start(id).catch(e => console.error(`[wa] boot tenant ${id}:`, e.message));
    await new Promise(r => setTimeout(r, 1500)); // ما منفتح كل الأرقام بنفس اللحظة
  }
  if (n) console.log(`[wa] reconnecting ${n} WhatsApp session(s)`);
}
