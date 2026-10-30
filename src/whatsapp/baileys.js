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
import { hasService, contactsOn } from '../services.js';
import * as M from './mirror.js';

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
    downloadMediaMessage: pick('downloadMediaMessage'),
    BufferJSON: pick('BufferJSON')
  };
  if (B.BufferJSON) M.useBufferJSON(B.BufferJSON);
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
    logger: makeSyncLogger(tenantId), // بس رسائل مزامنة جهات الاتصال (لنعرف ليش الواتس ما بيطبّق الحفظ)
    printQRInTerminal: false,
    markOnlineOnConnect: false,   // حتى يضل موبايلك يوصله إشعارات
    syncFullHistory: true,        // لما تربط من جديد: الواتس بيبعت كل المحادثات القديمة (مشان نحفظ كل الأرقام)
    // (جرّبنا «macOS Desktop» مشان المحادثات القديمة: واتساب رفضو بخطأ 428. هاد يلي شغّال، ومع syncFullHistory بيجيب القديم)
    browser: Browsers?.ubuntu ? Browsers.ubuntu('Chrome') : ['Ubuntu', 'Chrome', '22.04.4'],
    ...(version ? { version } : {}),
    getMessage: async () => undefined
  });
  s.sock = sock;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('contacts.upsert', (list) => noteContacts(tenantId, list));
  sock.ev.on('contacts.update', (list) => noteContacts(tenantId, (list || []).filter(c => c.name)));
  // نسخة واتساب ويب: الأسماء والمحادثات
  sock.ev.on('contacts.upsert', async list => { try { M.setNames(tenantId, list, await mirrorResolver(tenantId, sock, list)); } catch (e) { console.error('[mirror] names', e.message); } });
  sock.ev.on('contacts.update', async list => { try { M.setNames(tenantId, list, await mirrorResolver(tenantId, sock, list)); } catch {} });
  sock.ev.on('chats.upsert', async list => { try { M.setChats(tenantId, list, await mirrorResolver(tenantId, sock, list)); } catch (e) { console.error('[mirror] chats', e.message); } });
  sock.ev.on('chats.update', async list => { try { M.setChats(tenantId, list, await mirrorResolver(tenantId, sock, list)); emit(tenantId, 'wa_msg', {}); } catch {} });
  sock.ev.on('groups.update', list => { try { M.setGroups(tenantId, Object.fromEntries((list || []).filter(g => g.id && g.subject).map(g => [g.id, g]))); } catch {} });
  // مراقبة ردّ الواتس على حفظ جهات الاتصال: Baileys ما بيفحص الخطأ يلي بيجي جوّا <collection>، فمنفحصو نحنا
  sock.ws?.on?.('frame', (fr) => {
    try {
      if (fr?.tag !== 'iq' || !Array.isArray(fr.content)) return;
      const sync = fr.content.find(c => c?.tag === 'sync'); if (!sync || !Array.isArray(sync.content)) return;
      for (const col of sync.content) {
        if (col?.tag !== 'collection' || col.attrs?.name !== 'critical_unblock_low') continue;
        const kids = Array.isArray(col.content) ? col.content : [];
        const err = kids.find(c => c?.tag === 'error');
        if ((s.syncLog = (s.syncLog || 0) + 1) <= 15) console.log(`[wa] tenant ${tenantId}: contacts sync reply ${JSON.stringify(col.attrs)} [${kids.map(c => c?.tag).join(',')}]`);
        if (col.attrs.type === 'error' || err) {
          s.lastSyncErr = { code: err?.attrs?.code || '', text: err?.attrs?.text || 'error' };
          console.error(`[wa] tenant ${tenantId}: WhatsApp REJECTED a contacts change: ${s.lastSyncErr.code} ${s.lastSyncErr.text}`);
        }
      }
    } catch {}
  });

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
      setTimeout(() => sock.groupFetchAllParticipating().then(g => M.setGroups(tenantId, g)).catch(() => {}), 30000); // أسماء الكروبات
      clearInterval(s.lidTimer); s.lidTimer = setInterval(() => resolveLids(tenantId).catch(() => {}), 15 * 60_000);
      // كل 10 دقايق: أي رقم بقاعدة الزباين ما انحفظ بجهات الاتصال بيرجع ينضاف للطابور
      clearInterval(s.saveTimer); s.saveTimer = setInterval(() => queueAllKnown(tenantId), 10 * 60_000);
      setTimeout(() => bookResync(tenantId, sock, state).catch(e => console.error('[wa] address book sync', e.message)), 20000); // منجيب أسماء جهات اتصالك كلها من الواتس
      setTimeout(() => auditContacts(tenantId).catch(e => console.error('[wa] audit', e.message)), 45000); // فحص عند الطلب بس
      clearInterval(s.auditTimer); s.auditTimer = setInterval(() => { auditContacts(tenantId).catch(e => console.error('[wa] audit', e.message)); resaveFromFile(tenantId); }, 30_000); // ملفات الطلب بتتفحص كل 30 ثانية
      setTimeout(() => queueAllKnown(tenantId), 90000); // بعد ما يخلص مزامنة الواتس، منحفظ كل الأرقام يلي راسلت قبل
      { const tt = getTenant(tenantId); if (tt?.bot_enabled) trialStatus(tt); } // بيسجّل الرقم للتجربة بس إذا المجيب شغّال (يلي بدو حفظ الأرقام بس ما بتنحرق تجربتو)
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
    // نسخة واتساب ويب: كل المحادثات القديمة يلي بعتها واتساب
    try {
      const resolve = await mirrorResolver(tenantId, sock, [...(messages || []), ...(chats || []), ...(contacts || [])]);
      M.setNames(tenantId, contacts || [], resolve); M.setChats(tenantId, chats || [], resolve);
      const n = M.add(tenantId, messages || [], { resolve });
      if (n) { console.log(`[mirror] tenant ${tenantId}: saved ${n} old messages from ${(chats || []).length} chats`); emit(tenantId, 'wa_msg', {}); }
    } catch (e) { console.error('[mirror] history', e.message); }
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
      if (bookReady(tenantId) && hasService(tenantId, 'contacts_old')) queueContacts(tenantId, list); // الأرقام القديمة: بس لمشتركين «حفظ الأرقام القديمة»
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
    try { M.add(tenantId, messages || [], { resolve: await mirrorResolver(tenantId, sock, messages || []), live: true }); } catch (e) { console.error('[mirror] live', e.message); }
    if (type !== 'notify') {
      // رسائل وصلت لما النت كان قاطع (append): البوت ما بيرد عليها، بس أرقامها لازم تنحفظ بجهات الاتصال
      const found = [];
      for (const m of messages || []) {
        try {
          const jid = m.key?.remoteJid || '';
          if (!jid || /@g\.us$|@broadcast$|@newsletter$|^status@/.test(jid)) continue;
          const alt = m.key.remoteJidAlt || m.key.senderPn || m.key.participantPn || null;
          let ph = phoneFromJid(jid.endsWith('@s.whatsapp.net') ? jid : alt || '');
          if (!ph && /@lid$/.test(jid)) {
            try { const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid); if (pn && /@s\.whatsapp\.net$/.test(pn)) ph = phoneFromJid(pn); } catch {}
            if (!ph) rememberLid(tenantId, jid);
          }
          if (ph) found.push({ phone: ph });
        } catch {}
      }
      if (found.length && hasService(tenantId, 'contacts_new')) queueContacts(tenantId, found);
      return;
    }
    const { handleInbound, isBotSent, botWillHandle } = await import('../agent.js');
    for (const m of messages) {
      try {
        const jid = m.key?.remoteJid || '';
        if (!jid || /@g\.us$|@broadcast$|@newsletter$|^status@/.test(jid)) continue;
        if (!m.message) { if (m.messageStubType) console.log(`[wa] tenant ${tenantId}: could not decrypt a message from ${jid} (WhatsApp will resend it)`); continue; }
        if (m.key.fromMe && isBotSent(m.key.id)) continue;
        let { text, mediaNote, quote } = extract(m.message, !m.key.fromMe);
        const alt = m.key.remoteJidAlt || m.key.senderPn || m.key.participantPn || null;
        let phone = phoneFromJid(jid.endsWith('@s.whatsapp.net') ? jid : alt || '');
        // رسالة جاية بمعرّف @lid وما وصل معا رقم: منحاول نحوّلو لرقم هون، وإذا ما قدرنا منحطّو بقائمة الانتظار لـ resolveLids
        if (!phone && /@lid$/.test(jid)) {
          try { const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid); if (pn && /@s\.whatsapp\.net$/.test(pn)) phone = phoneFromJid(pn); } catch {}
          if (!phone) rememberLid(tenantId, jid);
        }
        // تفاعل (❤️👍) أو رسالة فاضية: البوت ما بيرد عليها، بس الرقم لازم ينحفظ
        if (!text && !mediaNote) { if (phone && hasService(tenantId, 'contacts_new')) saveContact(tenantId, phone, '').catch(() => {}); continue; }
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
          if (hasService(tenantId, 'contacts_new')) (now && now !== before ? saveContact(tenantId, phone, now, true) : saveContact(tenantId, phone, '')).catch(() => {});
        }
        // إنت يلي بعتت أول (من الموبايل): الرقم لازم ينحفظ كمان
        if (m.key.fromMe && phone && hasService(tenantId, 'contacts_new')) saveContact(tenantId, phone, '').catch(() => {});
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
const KO_TENANT = Number(process.env.KO_TENANT_ID || 1); // متجر Ko Sport: إلو تعلّم الأسماء الحقيقية من المحادثات
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
// دمج لمرة وحدة: إذا في ملف wa-contacts-merge.json منضيف يلي ناقص منو للمحفوظ ولدفتر العناوين (ما منغيّر شي موجود) ومنعلّمو خلص
try {
  const MF = path.join(DATA_DIR, 'wa-contacts-merge.json');
  if (fs.existsSync(MF)) {
    const mg = JSON.parse(fs.readFileSync(MF, 'utf8')); let a = 0, b = 0;
    for (const [k, v] of Object.entries(mg.saved || {})) if (!saved[k]) { saved[k] = v; a++; }
    for (const [k, v] of Object.entries(mg.book || {})) if (!book[k]) { book[k] = v; b++; }
    fs.writeFileSync(SAVED_FILE, JSON.stringify(saved)); fs.writeFileSync(BOOK_FILE, JSON.stringify(book));
    fs.renameSync(MF, MF + '.done');
    console.log(`[wa] merged contacts: ${a} saved, ${b} address book`);
  }
} catch (e) { console.error('[wa] merge contacts', e.message); }
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
  if (!contactsOn(tenantId) || typeof sock.resyncAppState !== 'function') return;
  const flag = bookFlag(tenantId);
  if (bookReady(tenantId) && fs.existsSync(flag)) return;
  const before = Object.keys(book).filter(k => k.startsWith(tenantId + ':')).length;
  console.log(`[wa] tenant ${tenantId}: fetching your saved contact names from WhatsApp…`);
  await state.keys.set({ 'app-state-sync-version': { critical_unblock_low: null } }); // من الصفر = نسخة كاملة
  await sock.resyncAppState(['critical_unblock_low'], true);
  await new Promise(r => setTimeout(r, 4000));
  const after = Object.keys(book).filter(k => k.startsWith(tenantId + ':')).length;
  console.log(`[wa] tenant ${tenantId}: address book now has ${after} saved names (was ${before})`);
  try { fs.writeFileSync(flag, new Date().toISOString()); } catch {} // وصل دفتر العناوين (حتى لو فيه أسماء قليلة)
  setTimeout(() => queueAllKnown(tenantId), 5000);
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
  if (found.length) { rememberHistory(tenantId, found); if (bookReady(tenantId) && contactsOn(tenantId)) queueContacts(tenantId, found); }
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
const bookFlag = tenantId => path.join(DATA_DIR, `wa-book-synced-${tenantId}.txt`);
const bookReady = (tenantId) => fs.existsSync(bookFlag(tenantId)) || Object.keys(book).filter(k => k.startsWith(tenantId + ':')).length >= 10;
const isPlaceholder = (n) => /^زبون \d{4}$/.test(String(n || '').trim());
// الاسم يلي البوت بيحطو للرقم: «<البادئة> 1234». البادئة بيختارها الزبون (الافتراضي «زبون»)
const prefixOf = tenantId => { try { return String(getTenant(tenantId)?.settings?.contacts_prefix || 'زبون').replace(/[\d\n\r]/g, '').trim().slice(0, 24) || 'زبون'; } catch { return 'زبون'; } };
const escRe = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isPh = (tenantId, n) => isPlaceholder(n) || new RegExp('^' + escRe(prefixOf(tenantId)) + ' \\d{4}$').test(String(n || '').trim());
// سجل Baileys بس للرسائل يلي إلها علاقة بمزامنة جهات الاتصال (بحد أقصى 400 سطر لكل تشغيل)
let syncLogN = 0;
const SYNC_KW = /sync|app.?state|snapshot|critical_unblock_low|missing key|blocked|patch/i;
// لكل مشترك سجل خاص (بيبيّن رقم المشترك)، وكشف المفتاح الناقص بيشتغل دايماً
function makeSyncLogger(tenantId) {
  const fn = (lvl) => (o, m) => {
    try {
      const msg = typeof o === 'string' ? o : String(m || '');
      let extra = '';
      if (o && typeof o === 'object') extra = JSON.stringify(o, (k, v) => (k === 'error' && typeof v === 'string') ? v.split('\n').slice(0, 3).join(' | ') : (v && typeof v === 'object' && (v.type === 'Buffer' || v instanceof Uint8Array)) ? '[buf]' : v).slice(0, 700);
      const mk = /failed to find key \\?"([A-Za-z0-9+/=]+)\\?"/.exec(extra + ' ' + msg); if (mk) onMissingKey(tenantId, mk[1]); // دايماً، حتى لو السجل وقف
      if (!SYNC_KW.test(msg + ' ' + extra) || /^(resyncing |synced |.*has more patches)/.test(msg)) return; // الرسائل الروتينية ما منكتبها
      if (syncLogN >= 400) return;
      syncLogN++; console.log(`[baileys:${lvl}] t${tenantId} ${msg} ${extra}`);
    } catch {}
  };
  const L = { level: 'info', trace() {}, debug() {}, info: fn('info'), warn: fn('warn'), error: fn('error'), fatal: fn('fatal'), child() { return L; } };
  return L;
}
// مفتاح مزامنة ناقص: البوت ما معو المفتاح يلي الموبايل عم يشفّر فيه جهات الاتصال، فكل حفظ من البوت بينبني على نسخة غلط والموبايل بيتجاهلو.
// منطلب المفتاح من الموبايل متل ما بيعمل واتساب ويب (Baileys ما فيه هالشي)
const keyAsked = new Map();
const retryAt = new Map();
function onMissingKey(tenantId, keyId) {
  const k = tenantId + ':' + keyId, t = keyAsked.get(k) || 0; if (Date.now() - t < 10 * 60_000) return; keyAsked.set(k, Date.now());
  console.error(`[wa] tenant ${tenantId}: contacts-sync key ${keyId} is missing on the bot — asking the phone for it`);
  setTimeout(() => requestAppStateKeys(tenantId, [keyId]).catch(e => console.error('[wa] key request', e.message)), 3000);
}
export async function requestAppStateKeys(tenantId, ids) {
  const s = sessions.get(tenantId), sock = s?.sock; if (!sock?.relayMessage || s.status !== 'open') return false;
  const m = await import('baileys'); const proto = m.proto ?? m.default?.proto; const norm = m.jidNormalizedUser ?? m.default?.jidNormalizedUser;
  const T = proto?.Message?.ProtocolMessage?.Type?.APP_STATE_SYNC_KEY_REQUEST;
  if (T === undefined) { console.error('[wa] key request: this Baileys has no APP_STATE_SYNC_KEY_REQUEST'); return false; }
  const me = norm ? norm(sock.authState.creds.me.id) : phoneFromJid(sock.authState.creds.me.id) + '@s.whatsapp.net';
  await sock.relayMessage(me, { protocolMessage: { type: T, appStateSyncKeyRequest: { keyIds: ids.map(k => ({ keyId: Buffer.from(k, 'base64') })) } } },
    { additionalAttributes: { category: 'peer', push_priority: 'high_force' }, additionalNodes: [{ tag: 'meta', attrs: { appdata: 'default' } }] });
  console.log(`[wa] tenant ${tenantId}: asked your phone for the missing contacts-sync key ${ids.join(', ')}`);
  return true;
}
// إذا الواتس رفض تغيير: منرجّع نسخة جهات الاتصال من الواتس من الصفر (مرة كل 5 دقايق بالأكتر) لتتصلّح نسخة البوت
let fixAt = 0;
async function fixContactsState(tenantId) {
  const s = sessions.get(tenantId); if (!s?.sock?.resyncAppState || Date.now() - fixAt < 5 * 60_000) return; fixAt = Date.now();
  console.log(`[wa] tenant ${tenantId}: re-syncing contacts state from WhatsApp after a rejection`);
  await s.sock.authState.keys.set({ 'app-state-sync-version': { critical_unblock_low: null } });
  await s.sock.resyncAppState(['critical_unblock_low'], true);
  console.log(`[wa] tenant ${tenantId}: contacts state re-synced`);
}
// فحص: شو موجود فعلاً عند الواتس من جهات الاتصال. بيشتغل مرة وحدة بس إذا في ملف data/contacts-audit-request.txt
// إعادة حفظ أرقام معيّنة: إذا في ملف data/contacts-resave.txt (رقم بكل سطر) منعيد حفظهم بالدور. الأسماء يلي إنت حاططها ما منلمسها
function resaveFromFile(tenantId) {
  const f = path.join(DATA_DIR, 'contacts-resave.txt'); if (Number(tenantId) !== KO_TENANT || !fs.existsSync(f)) return;
  let nums = []; try { nums = fs.readFileSync(f, 'utf8').split(/\s+/).map(x => x.replace(/\D/g, '')).filter(x => x.length >= 8); fs.unlinkSync(f); } catch { return; }
  let n = 0;
  for (const num of nums) { const k = tenantId + ':' + num, bk = book[k], sv = saved[k]; if (bk && !isPlaceholder(bk) && bk !== sv) continue; delete saved[k]; delete book[k]; n++; }
  console.log(`[wa] tenant ${tenantId}: re-saving ${n} numbers from contacts-resave.txt`);
  queueContacts(tenantId, nums.map(p => ({ phone: p })));
}
let auditing = false;
async function auditContacts(tenantId) {
  const req = path.join(DATA_DIR, 'contacts-audit-request.txt'); if (auditing || Number(tenantId) !== KO_TENANT || !fs.existsSync(req)) return;
  auditing = true; try { await auditContactsRun(tenantId, req); } finally { auditing = false; }
}
async function auditContactsRun(tenantId, req) {
  try { fs.unlinkSync(req); } catch {}
  const s = sessions.get(tenantId); if (!s?.sock?.resyncAppState) return;
  const cap = new Map(); const h = (list) => { for (const c of list || []) if (c?.id) cap.set(c.id, c); };
  s.sock.ev.on('contacts.upsert', h);
  console.log(`[wa] tenant ${tenantId}: audit — downloading all contacts from WhatsApp…`);
  try {
    await s.sock.authState.keys.set({ 'app-state-sync-version': { critical_unblock_low: null } });
    await s.sock.resyncAppState(['critical_unblock_low'], true);
    await new Promise(r => setTimeout(r, 8000));
  } finally { s.sock.ev.off('contacts.upsert', h); }
  const onServer = new Map(); let lidIdx = 0, pnIdx = 0, withLid = 0, withPn = 0; const lidExamples = [];
  for (const [id, c] of cap) {
    if (/@lid$/.test(id)) { lidIdx++; if (lidExamples.length < 5) lidExamples.push(c); } else if (/@s\.whatsapp\.net$/.test(id)) pnIdx++;
    if (c.lid) withLid++; if (c.phoneNumber) withPn++;
    const pn = /@s\.whatsapp\.net$/.test(id) ? id : String(c.phoneNumber || '');
    const num = pn.split('@')[0].split(':')[0].replace(/\D/g, ''); if (num) onServer.set(num, c.name || '');
  }
  const mine = Object.entries(saved).filter(([k]) => k.startsWith(tenantId + ':')).map(([k, v]) => [k.slice(String(tenantId).length + 1), v]);
  const missing = mine.filter(([n]) => !onServer.has(n)).map(([n]) => n);
  const placeholdersOnServer = [...onServer.values()].filter(isPlaceholder).length;
  const sample = {}; for (const n of ['963968003483', '963935752989', '963932096770', '963995227855']) sample[n] = onServer.has(n) ? onServer.get(n) : null;
  const out = { at: new Date().toISOString(), serverContacts: cap.size, pnIndexed: pnIdx, lidIndexed: lidIdx, withLid, withPn, placeholdersOnServer, botSaved: mine.length, botSavedMissingOnServer: missing.length, sample, lidExamples, missing };
  fs.writeFileSync(path.join(DATA_DIR, 'contacts-audit.json'), JSON.stringify(out, null, 1));
  console.log(`[wa] tenant ${tenantId}: audit — WhatsApp has ${cap.size} contacts (pn ${pnIdx}, lid ${lidIdx}); bot saved ${mine.length}, missing on WhatsApp ${missing.length}`);
}
export async function saveContact(tenantId, phone, name, force = false) {
  if (!isActive() || !contactsOn(tenantId)) return false;
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
    if (!isPh(tenantId, have) && have !== saved[key]) return true; // اسم انت حاططو: ما منلمسو أبداً (بس منصلّح الأسماء يلي نحنا حطيناها)
    if (isPh(tenantId, have) && !real) return true;
  }
  const full = real || (prefixOf(tenantId) + ' ' + num.slice(-4));
  try {
    s.lastSyncErr = null;
    await s.sock.addOrEditContact(num + '@s.whatsapp.net', { fullName: full, firstName: full.split(' ')[0], saveOnPrimaryAddressbook: true });
    if (s.lastSyncErr) { const e = s.lastSyncErr; s.lastSyncErr = null; fixContactsState(tenantId).catch(() => {}); throw new Error(`WhatsApp rejected it (${e.code} ${e.text})`); }
    saved[key] = full; book[key] = full; for (const mm of bulk.values()) mm.delete(num); /* انحفظ: منشيلو من الطابور */ clearTimeout(savedT); savedT = setTimeout(() => { try { fs.writeFileSync(SAVED_FILE, JSON.stringify(saved)); fs.writeFileSync(BOOK_FILE, JSON.stringify(book)); } catch {} }, 1500);
    console.log(`[wa] tenant ${tenantId}: contact ${num} ${have ? `«${have}» → ` : 'new → '}«${full}»`);
    return true;
  } catch (e) { console.error('[wa] save contact', num, e.message); return false; }
}

// حفظ كل الأرقام الموجودة (المحادثات القديمة + كل يلي راسل قبل) بالدور، رقم كل 2.5 ثانية مشان ما ينزعج الواتس
const bulk = new Map(); // tenantId -> Map(num -> name)
let bulkTimer = null;
export function queueContacts(tenantId, list) {
  const m = bulk.get(tenantId) || new Map(); let n = 0; const pre = prefixOf(tenantId);
  for (const { phone, name } of list) { const num = String(phone || '').replace(/\D/g, ''); const bk = bookName(tenantId, num); if (num.length >= 8 && !m.has(num) && (() => { const k = tenantId + ':' + num, sv = saved[k], rn = realNames[k], want = rn || (pre + ' ' + num.slice(-4)); if (!bk) return true; if (isPh(tenantId, bk)) return !!rn && bk !== rn; return bk === sv && sv !== want; })()) { m.set(num, name || ''); n++; } }
  bulk.set(tenantId, m);
  if (n) console.log(`[wa] tenant ${tenantId}: ${n} numbers queued to save in contacts`);
  if (!bulkTimer) bulkTimer = setInterval(async () => {
    let busy = false;
    for (const [tid, mm] of bulk) {
      if (mm.size && !contactsOn(tid)) { mm.clear(); continue; } // الخدمة انلغت أو انوقفت: منفضّي الطابور فوراً
      const st = sessions.get(tid); if (!mm.size || st?.status !== 'open') continue;
      const [num, name] = mm.entries().next().value; mm.delete(num); busy = true;
      await saveContact(tid, num, name).catch(() => {});
    }
    if (!busy && [...bulk.values()].every(x => !x.size)) { clearInterval(bulkTimer); bulkTimer = null; }
  }, 2500);
  return n;
}
function queueAllKnown(tenantId) {
  const wantNew = hasService(tenantId, 'contacts_new'), wantOld = hasService(tenantId, 'contacts_old');
  if (!wantNew && !wantOld) return;
  resolveLids(tenantId).catch(() => {});
  if (!bookReady(tenantId)) { // ما وصل دفتر العناوين لهلق: منرجع نطلبو (مرة كل ساعة بالأكتر)
    const s = sessions.get(tenantId), k = 'book:' + tenantId;
    if (s?.sock && s.status === 'open' && Date.now() - (retryAt.get(k) || 0) > 3600_000) { retryAt.set(k, Date.now()); bookResync(tenantId, s.sock, { keys: s.sock.authState.keys }).catch(e => console.error('[wa] address book sync', e.message)); }
    return;
  }
  try {
    if (Number(tenantId) === KO_TENANT) {
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
    }
    // 2) كل الأرقام بالدور: بالاسم الحقيقي إذا منعرفو، وغير هيك «زبون XXXX». ويلي انحفظ «زبون» وهلق عرفنا اسمو بيتحدّث
    // الجديدة: كل يلي راسل من وقت الربط. القديمة: محادثات الربط + النسخة الاحتياطية
    const list = (wantNew ? q.all('SELECT phone FROM contacts WHERE tenant_id = ? AND phone IS NOT NULL', tenantId).map(c => ({ phone: c.phone })) : [])
      .concat(wantOld ? (histNums[tenantId] || []).map(p => ({ phone: p })) : []);
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

// ===== حفظ الأرقام كمنتج للمشتركين =====
// أرقام هالمشترك: قديش انحفظ، قديش ناطر بالطابور، قديش رقم قديم وصل من الربط
export function contactsStats(tenantId) {
  const pre = tenantId + ':'; let savedN = 0;
  for (const k in saved) if (k.startsWith(pre)) savedN++;
  return { saved: savedN, pending: contactsOn(tenantId) ? (bulk.get(tenantId)?.size || 0) : 0, history: (histNums[tenantId] || []).length, book_ready: bookReady(tenantId), hidden_unknown: (histLids[tenantId] || []).length };
}
// أرقام من النسخة الاحتياطية (انفكّت على جهاز الزبون وإجت الأرقام بس): منضيفها للقديمة ومنحطها بالطابور
export function importNumbers(tenantId, nums) {
  const list = [...new Set((nums || []).map(x => String(x).replace(/\D/g, '')).filter(x => x.length >= 9 && x.length <= 15))].map(p => ({ phone: p }));
  rememberHistory(tenantId, list);
  const open = sessions.get(tenantId)?.status === 'open';
  const queued = open && bookReady(tenantId) && hasService(tenantId, 'contacts_old') ? queueContacts(tenantId, list) : 0;
  return { found: list.length, queued, waiting: !open };
}
// «احفظ الأرقام القديمة هلق» (بعد ما يشترك، بدون ما يستنى الدورة الجاية)
export function queueHistoryNow(tenantId) { queueAllKnown(tenantId); return contactsStats(tenantId); }

// ===== إعدادات حساب الواتساب نفسو (من الجهاز المربوط): الاسم، النبذة، الصورة، الخصوصية، معلومات البزنس =====
function liveSock(tenantId) {
  const s = sessions.get(tenantId);
  if (!s?.sock || s.status !== 'open') throw new Error('واتساب مو مربوط هلّق. اربطو أول.');
  return s.sock;
}
const selfJid = sock => String(sock.user?.id || '').replace(/:\d+@/, '@');
const PRIVACY = {
  last: ['updateLastSeenPrivacy', ['all', 'contacts', 'contact_blacklist', 'none']],
  online: ['updateOnlinePrivacy', ['all', 'match_last_seen']],
  profile: ['updateProfilePicturePrivacy', ['all', 'contacts', 'contact_blacklist', 'none']],
  status: ['updateStatusPrivacy', ['all', 'contacts', 'contact_blacklist', 'none']],
  readreceipts: ['updateReadReceiptsPrivacy', ['all', 'none']],
  groupadd: ['updateGroupsAddPrivacy', ['all', 'contacts', 'contact_blacklist']],
  calladd: ['updateCallPrivacy', ['all', 'known']]
};
export async function waProfile(tenantId) {
  const sock = liveSock(tenantId), jid = selfJid(sock);
  const [privacy, st, picture, biz] = await Promise.all([
    sock.fetchPrivacySettings(true).catch(() => ({})),
    sock.fetchStatus(jid).catch(() => null),
    sock.profilePictureUrl(jid, 'image').catch(() => null),
    sock.getBusinessProfile(jid).catch(() => null)
  ]);
  const about = st?.[0]?.status?.status ?? (typeof st?.[0]?.status === 'string' ? st[0].status : '');
  return {
    phone: jid.split('@')[0], name: sock.user?.name || sock.authState?.creds?.me?.name || '', about: about || '', picture: picture || null,
    privacy: Object.fromEntries(Object.keys(PRIVACY).map(k => [k, privacy?.[k] ?? null])),
    business: biz ? { description: biz.description || '', address: biz.address || '', email: biz.email || '', website: biz.website?.[0] || '', category: biz.category || '' } : null
  };
}
export async function waUpdate(tenantId, b = {}) {
  const sock = liveSock(tenantId), jid = selfJid(sock);
  if (typeof b.name === 'string' && b.name.trim()) await sock.updateProfileName(b.name.trim().slice(0, 25));
  if (typeof b.about === 'string') await sock.updateProfileStatus(b.about.slice(0, 139));
  if (b.remove_picture) await sock.removeProfilePicture(jid);
  else if (typeof b.picture === 'string' && b.picture.startsWith('data:image/')) await sock.updateProfilePicture(jid, Buffer.from(b.picture.split(',')[1] || '', 'base64'));
  for (const [k, v] of Object.entries(b.privacy || {})) {
    const p = PRIVACY[k]; if (!p || !p[1].includes(v)) continue;
    await sock[p[0]](v);
  }
  if (b.business && typeof sock.updateBussinesProfile === 'function') {
    const x = b.business, args = {};
    for (const f of ['description', 'address', 'email']) if (typeof x[f] === 'string') args[f] = x[f].slice(0, 500);
    if (typeof x.website === 'string') args.websites = x.website.trim() ? [x.website.trim().slice(0, 200)] : [];
    await sock.updateBussinesProfile(args);
  }
  return waProfile(tenantId);
}

// ===== نسخة واتساب ويب =====
// @lid → رقم (إذا عرفناه)، حتى ما تنقسم محادثة الشخص لاتنين
const lidCache = new Map();
async function mirrorResolver(tenantId, sock, items) {
  const pnOf = v => { const x = String(v || ''); return /@s\.whatsapp\.net$/.test(x) ? x.replace(/:\d+@/, '@') : ''; };
  const note = (lid, pn) => { lid = String(lid || ''); pn = pnOf(pn); if (/@lid$/.test(lid) && pn) lidCache.set(tenantId + ':' + lid, pn); };
  const lids = new Set();
  for (const x of items || []) {
    const k = x?.key;
    if (k) { note(k.remoteJid, k.remoteJidAlt || k.senderPn); note(k.participant, k.participantAlt || k.participantPn); for (const v of [k.remoteJid, k.participant]) if (/@lid$/.test(v || '')) lids.add(v); }
    if (x?.id) { note(x.id, x.pnJid || x.phoneNumber); note(x.lidJid || x.lid, x.id); if (/@lid$/.test(x.id)) lids.add(x.id); }
  }
  const map = sock.signalRepository?.lidMapping;
  for (const lid of lids) {
    if (lidCache.has(tenantId + ':' + lid) || !map?.getPNForLID) continue;
    try { note(lid, await map.getPNForLID(lid)); } catch {}
  }
  return jid => { jid = String(jid || ''); return /@lid$/.test(jid) ? (lidCache.get(tenantId + ':' + jid) || jid) : jid.replace(/:\d+@/, '@'); };
}
// تنزيل صورة/فيديو/صوت/ملف من رسالة محفوظة (بيحفظها بمجلد uploads باسم ما بينحزر)
export async function mirrorMedia(tenantId, jid, id) {
  const r = M.rawMessage(tenantId, jid, id);
  if (!r) throw new Error('ما في وسائط بهالرسالة');
  const crypto = await import('node:crypto');
  const extOf = mime => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'application/pdf': 'pdf' })[String(mime || '').split(';')[0].trim()] || (r.type === 'voice' ? 'ogg' : r.type === 'image' ? 'jpg' : r.type === 'video' || r.type === 'gif' ? 'mp4' : r.type === 'sticker' ? 'webp' : 'bin');
  const name = `${tenantId}-wa-${crypto.createHash('sha256').update(tenantId + '|' + jid + '|' + id + '|' + (process.env.SESSION_SECRET || 'kf')).digest('hex').slice(0, 24)}.${extOf(r.meta?.mime)}`;
  const file = path.join(DATA_DIR, 'uploads', name);
  if (fs.existsSync(file)) return '/uploads/' + name;
  const s = sessions.get(tenantId);
  if (!s?.sock || s.status !== 'open') throw new Error('واتساب مو مربوط هلّق، فما فينا ننزّل الملف');
  const { downloadMediaMessage } = await lib();
  const buf = await downloadMediaMessage(r.msg, 'buffer', {}, { logger: silent, reuploadRequest: s.sock.updateMediaMessage });
  if (!buf?.length) throw new Error('ما قدرنا ننزّل الملف (يمكن انمسح من موبايل صاحبو)');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return '/uploads/' + name;
}
export async function mirrorSend(tenantId, jid, { text, image }) {
  const s = sessions.get(tenantId);
  if (!s?.sock || s.status !== 'open') throw new Error('واتساب مو مربوط هلّق');
  if (image) return s.sock.sendMessage(jid, { image: Buffer.from(String(image).split(',')[1] || '', 'base64'), caption: text || undefined });
  return s.sock.sendMessage(jid, { text });
}
export async function mirrorRead(tenantId, jid) {
  M.markRead(tenantId, jid);
  const s = sessions.get(tenantId);
  if (!s?.sock || s.status !== 'open') return;
  const last = M.messages(tenantId, jid, { limit: 1 }).filter(m => !m.from_me);
  if (last.length) s.sock.readMessages([{ remoteJid: jid, id: last[0].id, fromMe: false, ...(jid.endsWith('@g.us') && last[0].sender ? { participant: last[0].sender } : {}) }]).catch(() => {});
}
