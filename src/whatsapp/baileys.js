// الربط بمسح QR أو كود الربط (غير رسمي — مجاني، بس في خطر حظر الرقم)
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ROOT } from '../config.js';
import { q } from '../db.js';
import { emit } from '../events.js';
import { phoneFromJid } from '../text.js';
import { getTenant } from '../tenants.js';
import { trialStatus } from '../trial.js';
import { isActive } from '../failover.js';
import { hasService, contactsOn, oldCutoff } from '../services.js';
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
// 1 تشرين التاني 2026: إعادة تشغيل بنص الكتابة فضّت creds.json (0 بايت) وفصلت الواتس. هلق:
//  - بعد كل حفظ منعمل نسخة سليمة creds.json.bak
//  - إذا creds.json خربان والنسخة سليمة، منرجّعها لحالها قبل ما نفتح الواتس
//  - وقت الإيقاف منستنى آخر حفظ يخلص (stopAll)
const credsOk = f => { try { return !!JSON.parse(fs.readFileSync(f, 'utf8')).me; } catch { return false; } };
function repairCreds(id) {
  const f = path.join(authDir(id), 'creds.json'), b = f + '.bak';
  if (credsOk(f)) return true;
  if (credsOk(b)) { try { fs.copyFileSync(b, f); console.log(`[wa] tenant ${id}: creds.json was broken — restored from the last good copy`); return true; } catch (e) { console.error('[wa] repair creds', e.message); } }
  return false;
}
const hasAuth = id => repairCreds(id);
const pendingSaves = new Set();

export function status(tenantId) {
  const s = sessions.get(tenantId);
  if (!s) return { provider: 'qr', status: hasAuth(tenantId) ? 'connecting' : 'disconnected' };
  return { provider: 'qr', status: s.status, qr: s.qr || null, code: s.code || null, phone: s.phone || null, error: s.error || null };
}

// الإيقاف (تحديث/إعادة تشغيل): منستنى الحفظ يخلص، منسكّر الجلسات بهدوء (بلا ما نعمل logout)
export async function stopAll(ms = 4000) {
  for (const s of sessions.values()) s.stopped = true;
  await Promise.race([Promise.allSettled([...pendingSaves]), new Promise(r => setTimeout(r, ms))]);
  for (const s of sessions.values()) { try { s.sock?.end(undefined); } catch {} }
  await Promise.race([Promise.allSettled([...pendingSaves]), new Promise(r => setTimeout(r, 1500))]);
}

// كل الجلسات (للتشخيص)
export function statusAll() { const o = {}; for (const [id, s] of sessions) o[id] = { status: s.status, phone: s.phone || null, error: s.error || null }; return o; }

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
  repairCreds(tenantId);
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
  sock.ev.on('creds.update', (...a) => {
    const p = (async () => {
      await saveCreds(...a);
      const f = path.join(authDir(tenantId), 'creds.json');
      try { const t = fs.readFileSync(f, 'utf8'); if (JSON.parse(t).me) { fs.writeFileSync(f + '.bak.tmp', t); fs.renameSync(f + '.bak.tmp', f + '.bak'); } } catch {}
    })().catch(e => console.error('[wa] save creds', e.message)).finally(() => pendingSaves.delete(p));
    pendingSaves.add(p);
  });
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
      s.openAt = Date.now(); s.lastPull = 0; s.stateDirty = false; // عامل جهات الاتصال بيسحب كل جهات الاتصال من الواتس بعد 25 ثانية، وبعدين بيحفظ
      clearInterval(s.auditTimer); s.auditTimer = setInterval(() => { auditContacts(tenantId).catch(e => console.error('[wa] audit', e.message)); resaveFromFile(tenantId); }, 30_000); // ملفات الطلب بتتفحص كل 30 ثانية
      setTimeout(() => queueAllKnown(tenantId), 90000); // بعد ما يخلص مزامنة الواتس، منحفظ كل الأرقام يلي راسلت قبل
      if (Number(tenantId) === KO_TENANT) setTimeout(() => { try { learnCards(tenantId, M.myTexts(tenantId, selfJids(sock))); } catch (e) { console.error('[wa] cards', e.message); } }, 100000);
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
      const tsOf = v => Number(v?.toNumber?.() ?? v?.low ?? v ?? 0);
      for (const c of [...(chats || []), ...(contacts || [])]) { if (/@g\.us$|@broadcast$|@newsletter$/.test(c.id || '')) continue; const p = await phoneFor(c.id, c.pnJid, c.phoneNumber, c.lidJid); if (p) { list.push({ phone: p }); seen(tenantId, p, tsOf(c.conversationTimestamp || c.lastMessageRecvTimestamp)); if (/@lid$/.test(c.id || '')) lidHits++; } }
      for (const m of messages || []) {
        const rj = m.key?.remoteJid || ''; if (/@g\.us$|@broadcast$|@newsletter$|^status@/.test(rj)) continue;
        if (m.key?.fromMe && Number(tenantId) === KO_TENANT && selfJids(sock).includes(rj.replace(/:\d+@/, '@'))) { const tx = m.message?.conversation || m.message?.extendedTextMessage?.text || ''; if (tx) learnCards(tenantId, [tx]); continue; }
        const p = await phoneFor(rj, m.key?.remoteJidAlt, m.key?.senderPn); if (!p) continue;
        list.push({ phone: p }); seen(tenantId, p, tsOf(m.messageTimestamp));
        if (m.key?.fromMe) continue;
        const t0 = m.message?.conversation || m.message?.extendedTextMessage?.text || m.message?.imageMessage?.caption || '';
        if (t0) { keepText(tenantId, p, t0); learnName(tenantId, p, t0); }
      }
      if (lidHits) console.log(`[wa] tenant ${tenantId}: ${lidHits} archived/hidden chats matched to numbers`);
      rememberHistory(tenantId, list);
      // (الأرقام القديمة صارت من النسخة الاحتياطية بس، قرار صاحب المنصة 30 تشرين الأول)
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
          if (ph) { found.push({ phone: ph }); seen(tenantId, ph, Number(m.messageTimestamp?.toNumber?.() ?? m.messageTimestamp ?? 0) || Math.floor(Date.now() / 1000)); }
          // (ملغى: ما منرد أبداً على رسائل قديمة وصلت والجهاز طافي — كان يبعت «✅» مرة تانية لما يشتغل الكمبيوتر)
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
        if (m.key.fromMe && Number(tenantId) === KO_TENANT && selfJids(sock).includes(jid.replace(/:\d+@/, '@'))) { if (text) learnCards(tenantId, [text]); continue; } // محادثة «أنت»
        const alt = m.key.remoteJidAlt || m.key.senderPn || m.key.participantPn || null;
        let phone = phoneFromJid(jid.endsWith('@s.whatsapp.net') ? jid : alt || '');
        if (phone) seen(tenantId, phone, Number(m.messageTimestamp?.toNumber?.() ?? m.messageTimestamp ?? 0) || Math.floor(Date.now() / 1000));
        // رسالة جاية بمعرّف @lid وما وصل معا رقم: منحاول نحوّلو لرقم هون، وإذا ما قدرنا منحطّو بقائمة الانتظار لـ resolveLids
        if (!phone && /@lid$/.test(jid)) {
          try { const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid); if (pn && /@s\.whatsapp\.net$/.test(pn)) phone = phoneFromJid(pn); } catch {}
          if (!phone) rememberLid(tenantId, jid);
        }
        // «سجّل بالواتساب» بموقع KO SPORT: الزبون بعت رمز التأكيد. منأكّد رقمو ومنردّ عليه، والبوت ما بيرد على هالرسالة
        if (!m.key.fromMe && text && /KO-[A-Z0-9]{6}/i.test(text)) console.log(`[ko-otp] tenant ${tenantId}: WhatsApp message with a code from ${phone || jid} (active=${isActive()}, koTenant=${Number(tenantId) === KO_TENANT})`);
        if (!m.key.fromMe && text && Number(tenantId) === KO_TENANT && /KO-[A-Z0-9]{6}/i.test(text)) {
          const { waClaim, holdForLater } = await import('../otp.js');
          if (!isActive()) continue; // الجهاز التاني هوي يلي بيرد: هون ما منعمل شي
          // رقم مخفي (@lid): واتساب غالباً بيبعت ربط الرقم بعد ثواني، فمنضل نجرّب لحد 20 ثانية قبل ما نطلب من الزبون يكتب رقمو
          if (!phone && /@lid$/.test(jid)) {
            for (let i = 0; i < 20 && !phone; i++) {
              await new Promise(r => setTimeout(r, 1000));
              try { const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid); if (pn && /@s\.whatsapp\.net$/.test(pn)) phone = phoneFromJid(pn); } catch {}
            }
            if (phone) console.log(`[ko-otp] hidden number matched after waiting: ${phone}`);
          }
          // ما زبط: منعلّم الرمز، والموقع بيطلب من الزبون يكتب رقمو ومنبعتلو كود
          if (!phone && waClaim(text, '', true)) {
            sock.readMessages([m.key]).catch(() => {});
            const { markBotSent } = await import('../agent.js').catch(() => ({}));
            const sent = await sock.sendMessage(jid, { text: 'وصلتنا رسالتك 🙏 ارجع لموقع KO SPORT واكتب رقم موبايلك، ومنبعتلك كود التأكيد هون عالواتساب.' }).catch(() => null);
            if (sent?.key?.id && typeof markBotSent === 'function') markBotSent(sent.key.id);
            console.log(`[wa] tenant ${tenantId}: KO code from a hidden number (${jid}): the site asks for the number`);
            continue;
          }
          if (phone && waClaim(text, phone)) {
            sock.readMessages([m.key]).catch(() => {});
            const { markBotSent } = await import('../agent.js').catch(() => ({}));
            const sent = await sock.sendMessage(jid, { text: '✅ تأكّد رقمك. ارجع لموقع KO SPORT، حسابك جاهز وبتقدر تكمّل طلبك 🛒' }).catch(() => null);
            if (sent?.key?.id && typeof markBotSent === 'function') markBotSent(sent.key.id);
            console.log(`[wa] tenant ${tenantId}: KO account confirmed by WhatsApp for ${phone}`);
            // (23/11/2026) منخبّر الموقع فوراً لينعمل الحساب (بالاسم يلي كتبو الزبون) حتى لو ما رجع للموقع. كان الحساب يضيع، والرقم يضل «زبون XXXX»
            { const cm = String(text || '').toUpperCase().match(/KO-([A-Z0-9]{6})\b/); if (cm) setTimeout(() => fetch('https://ko-sport.pages.dev/api/acct/wa-done', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: cm[1] }), signal: AbortSignal.timeout(20000) }).then(r => r.json()).then(j => console.log(`[ko-otp] site account for ${phone}: ${JSON.stringify(j).slice(0, 100)}`)).catch(e => console.error('[ko-otp] wa-done', e.message)), 1500); }
            if (hasService(tenantId, 'contacts_new')) enqueue(tenantId, phone, { delay: 90_000, why: 'ko-code' }); // الموقع بيبعت الاسم الحقيقي خلال ثواني (wa-done)
            continue;
          }
        }
        // تفاعل (❤️👍) أو رسالة فاضية: البوت ما بيرد عليها، بس الرقم لازم ينحفظ
        if (!text && !mediaNote) { if (phone && hasService(tenantId, 'contacts_new')) enqueue(tenantId, phone, { delay: 5 * 60_000, why: 'msg' }); continue; }
        // بس الأرقام يلي البوت رح يرد عليها: منعلّمها مقروءة ومنحلّل صوتها وصورها. الباقي بيضل متل ما هو (مو مقروء) لترد إنت
        const mine = !m.key.fromMe && (botWillHandle(tenantId, { jid, phone }) || (await import('../wa-products.js')).productsOwner(tenantId, phone));
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
          if (hasService(tenantId, 'contacts_new')) { if (now && now !== before) enqueue(tenantId, phone, { name: now, force: 1, why: 'name' }); else enqueue(tenantId, phone, { delay: 5 * 60_000, why: 'msg' }); }
        }
        // إنت يلي بعتت أول (من الموبايل): الرقم لازم ينحفظ كمان
        if (m.key.fromMe && phone && hasService(tenantId, 'contacts_new')) enqueue(tenantId, phone, { delay: 5 * 60_000, why: 'you' });
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
// كتابة آمنة: منكتب بملف مؤقت وبعدين منبدّل (إعادة التشغيل بنص الكتابة كانت تخلّي الملف فاضي = كارثة الأسماء)،
// ومنحتفظ بالنسخة يلي قبلها (.prev). وما منكتب أبداً دفتر فاضي فوق دفتر مليان.
function writeJsonSafe(file, obj) {
  const txt = JSON.stringify(obj);
  try { const old = fs.statSync(file).size; if (txt.length < 50 && old > 1000) return; } catch {}
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, txt);
  try { if (fs.statSync(file).size > 2) fs.copyFileSync(file, file.replace(/\.json$/, '.prev.json')); } catch {}
  fs.renameSync(tmp, file);
}
function readJsonSafe(file) {
  for (const f of [file, file.replace(/\.json$/, '.prev.json')]) { try { const o = JSON.parse(fs.readFileSync(f, 'utf8')); if (o && typeof o === 'object' && Object.keys(o).length) return o; } catch {} }
  return {};
}
const SAVED_FILE = path.join(DATA_DIR, 'wa-saved-contacts.json');
let saved = readJsonSafe(SAVED_FILE);
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
  // الاسم من الذكاء (customer_name) لازم يكون اسم شخص (أول كلمة اسم معروف): مو «مسارات حلب الباب» ولا «القدموس حمص» ولا «لما سألتك»
  if (!validName(nm.split(' - ')[0])) { console.log(`[wa] tenant ${tenantId}: ignored a name that is not a person «${nm}» for ${num}`); return false; }
  const key = tenantId + ':' + num; if (realNames[key] === nm) return true;
  realNames[key] = nm; clearTimeout(namesT); namesT = setTimeout(() => { try { fs.writeFileSync(NAMES_FILE, JSON.stringify(realNames)); } catch {} }, 1500);
  return saveContact(tenantId, num, nm, true);
}
// ===== بطاقات الزباين بمحادثة «أنت» (صاحب المتجر، 11 تشرين التاني 2026) =====
// رسالة فيها سطر اسم ثلاثي + سطر رقم (+ محافظة أو طلب): الرقم بينحفظ بجهات الاتصال بهالاسم
const GOVS = /^(ال)?(دمشق|ريف دمشق|حلب|حمص|حماة|حماه|اللاذقية|لاذقية|طرطوس|إدلب|ادلب|درعا|السويداء|سويداء|القنيطرة|قنيطرة|دير الزور|الحسكة|حسكة|الرقة|رقة)$/;
const dig = (x) => String(x).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
export function parseCard(text) {
  const lines = String(text || '').split(/\n+/).map(l => dig(l).replace(/[\u200e\u200f\u202a-\u202e*_~]/g, '').trim()).filter(Boolean);
  if (lines.length < 2 || lines.length > 25) return null;
  let pi = -1, phone = '';
  for (let i = 0; i < lines.length && pi < 0; i++) {
    const raw = lines[i].replace(/^(رقم(ه|و)?|الرقم|موبايل|الموبايل|هاتف|الهاتف|واتس(اب)?|phone|tel)\s*[:：-]?\s*/i, '');
    const d = raw.replace(/[\s\-().]/g, '');
    if (!/^(\+|00)?\d{9,15}$/.test(d)) continue;
    let n = d.replace(/^\+/, '').replace(/^00/, '');
    if (/^09\d{8}$/.test(n)) n = '963' + n.slice(1); else if (/^9\d{8}$/.test(n)) n = '963' + n; else if (/^9630\d{9}$/.test(n)) n = '963' + n.slice(4);
    if (n.length < 10) continue;
    pi = i; phone = n;
  }
  if (pi < 0) return null;
  const okName = (l) => { const t = l.replace(/^(الاسم( الثلاثي)?|اسم(ه|و)?|name)\s*[:：-]?\s*/i, '').replace(/[،,.:]+$/, '').replace(/\s+/g, ' ').trim(); const w = t.split(' ');
    return /\d/.test(t) || w.length < 2 || w.length > 5 || t.length > 45 || !/^[\p{L}\s'ـ-]+$/u.test(t) || GOVS.test(t) ? '' : t; };
  let name = '';
  for (let i = pi - 1; i >= 0 && !name; i--) name = okName(lines[i]); // السطر يلي فوق الرقم أول شي
  for (let i = 0; i < lines.length && !name; i++) if (i !== pi) name = okName(lines[i]);
  return name ? { phone, name } : null;
}
function learnCards(tenantId, texts) {
  const out = [];
  for (const t of texts || []) { const c = parseCard(t); if (!c) continue; realNames[tenantId + ':' + c.phone] = c.name; out.push(c); }
  if (!out.length) return 0;
  clearTimeout(namesT); namesT = setTimeout(() => { try { fs.writeFileSync(NAMES_FILE, JSON.stringify(realNames)); } catch {} }, 1500);
  queueContacts(tenantId, out);
  console.log(`[wa] tenant ${tenantId}: ${out.length} customer cards from your «You» chat`);
  return out.length;
}
const selfJids = (sock) => { const p = phoneFromJid(sock?.user?.id), l = String(sock?.user?.lid || '').replace(/:\d+@/, '@'); return [p ? p + '@s.whatsapp.net' : '', l].filter(Boolean); };

// أسماء زباين موقع KO SPORT (يلي سجّلو حساب): «الاسم المحافظة» متل ما بيكتبهن صاحب المتجر (مثلاً «مرهف سويداء»).
// بتنحفظ بس للرقم يلي ما إلو اسم أو اسمو «زبون XXXX» — أي اسم حقيقي محفوظ ما بيتغيّر أبداً
// فحص (23/11/2026: «زباين بيسجّلو بالموقع واسمن ما عم ينحفظ»): آخر 40 اسم وصلو من الموقع، لـ /api/diag
const siteLast = [];
export function contactsDiag(tenantId) {
  const pre = tenantId + ':', cnt = (o) => Object.keys(o).filter(k => k.startsWith(pre)).length, s = sessions.get(tenantId), now = Date.now();
  let svc = {}; try { svc = { contacts_new: hasService(tenantId, 'contacts_new'), contacts_old: hasService(tenantId, 'contacts_old'), on: contactsOn(tenantId) }; } catch (e) { svc = { err: e.message }; }
  const Q = Object.entries(cq).filter(([k]) => k.startsWith(pre));
  const queue = { total: Q.length, due: Q.filter(([, it]) => !it.s && !it.u && (it.nb || 0) <= now).length, later: Q.filter(([, it]) => !it.s && !it.u && (it.nb || 0) > now).length, sentWaiting: Q.filter(([, it]) => it.s).length, unconfirmed: Q.filter(([, it]) => it.u).length, errors: Q.filter(([, it]) => it.e).length,
    why: Q.reduce((o, [, it]) => { o[it.w || '?'] = (o[it.w || '?'] || 0) + 1; return o; }, {}), worst: Q.filter(([, it]) => it.e || it.u || (it.t || 0) >= 2).slice(0, 30).map(([k, it]) => ({ ph: k.slice(pre.length), ...it })) };
  let logT = ''; try { logT = fs.readFileSync(path.join(DATA_DIR, 'server.log'), 'utf8'); } catch {}
  const lines = logT ? logT.split('\n') : [];
  const probe = {}; for (const n of PROBE) { const k = pre + n; let db = null; try { db = q.all('SELECT jid, phone, name, last_at FROM contacts WHERE tenant_id = ? AND (phone = ? OR jid LIKE ?)', tenantId, n, '%' + n.slice(-8) + '%'); } catch {} probe[n] = { real: realNames[k] || '', book: book[k] || '', saved: saved[k] || '', lid: !!blid[k], queue: cq[k] || null, db, log: lines.filter(l => l.includes(n.slice(-9))).slice(-15).map(l => l.slice(0, 220)) }; }
  return { svc, active: (() => { try { return isActive(); } catch { return null; } })(), frozen: (() => { try { return frozen(); } catch { return null; } })(), bookReady: bookReady(tenantId), book: cnt(book), saved: cnt(saved), withLid: Object.keys(blid).filter(k => k.startsWith(pre) && blid[k]).length, latinBot: Object.keys(book).filter(k => k.startsWith(pre) && saved[k] === book[k] && /[A-Za-z@_]/.test(book[k])).length, botNoLid: Object.keys(book).filter(k => k.startsWith(pre) && saved[k] === book[k] && !blid[k]).length, realNames: cnt(realNames), queue, stateDirty: !!s?.stateDirty, lastPull: s?.lastPullInfo || null, wa: s?.status || null, lastSyncErr: s?.lastSyncErr || null,
    rejected24h: lines.filter(l => l.includes('REJECTED a contacts change') || l.includes('WhatsApp rejected «')).length, probe,
    site: siteLast.filter(x => x.t === tenantId).map(x => { const k = pre + x.phone; return { at: x.at, ph: x.phone.slice(-4), name: x.name, real: realNames[k] || '', book: book[k] || '', saved: saved[k] || '' }; }) };
}
export function siteNames(tenantId, list) {
  const out = [];
  for (const x of list || []) {
    const num = String(x.phone || '').replace(/\D/g, ''), nm = String(x.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (num.length < 8 || !/[\p{L}]{2,}/u.test(nm)) continue;
    const key = tenantId + ':' + num; realNames[key] = nm; out.push({ phone: num, name: nm });
    if (list.length <= 5) { siteLast.push({ t: tenantId, at: new Date().toISOString(), phone: num, name: nm }); if (siteLast.length > 40) siteLast.shift(); }
  }
  if (!out.length) return 0;
  clearTimeout(namesT); namesT = setTimeout(() => { try { fs.writeFileSync(NAMES_FILE, JSON.stringify(realNames)); } catch {} }, 1500);
  if (hasService(tenantId, 'contacts_new')) queueContacts(tenantId, out);
  return out.length;
}
// ===== دفتر عناوين الواتس (الأسماء المحفوظة عندك) =====
// بيوصل من الواتس مع كل ربط. أي رقم إلو اسم محفوظ ما منقرّبلو أبداً، إلا إذا الاسم «زبون XXXX» يلي نحنا حطيناه
const BOOK_FILE = path.join(DATA_DIR, 'wa-addressbook.json');
let book = readJsonSafe(BOOK_FILE);
// دمج لمرة وحدة: إذا في ملف wa-contacts-merge.json منضيف يلي ناقص منو للمحفوظ ولدفتر العناوين (ما منغيّر شي موجود) ومنعلّمو خلص
try {
  const MF = path.join(DATA_DIR, 'wa-contacts-merge.json');
  if (fs.existsSync(MF)) {
    const mg = JSON.parse(fs.readFileSync(MF, 'utf8')); let a = 0, b = 0;
    for (const [k, v] of Object.entries(mg.saved || {})) if (!saved[k]) { saved[k] = v; a++; }
    for (const [k, v] of Object.entries(mg.book || {})) if (!book[k]) { book[k] = v; b++; }
    writeJsonSafe(SAVED_FILE, saved); writeJsonSafe(BOOK_FILE, book);
    fs.renameSync(MF, MF + '.done');
    console.log(`[wa] merged contacts: ${a} saved, ${b} address book`);
  }
} catch (e) { console.error('[wa] merge contacts', e.message); }
let bookT = null, bookSeen = 0;
// إعادة بناء دفتر العناوين من الصفر (صاحب المتجر حذف جهات اتصال أو رجّعها من ملف):
// منسجّل كل اسم بيوصل خلال المزامنة الكاملة، وبالآخر منشيل من نسخة البوت كل رقم ما عاد محفوظ عندك
const rebuilding = new Map(); // tenantId → Set(keys)
export function noteContacts(tenantId, list) {
  let n = 0, lidN = 0; const fresh = rebuilding.get(String(tenantId));
  for (const c of list || []) {
    const id = String(c.id || ''), pn = /@s\.whatsapp\.net$/.test(id) ? id : String(c.phoneNumber || '');
    const num = pn.split('@')[0].split(':')[0].replace(/\D/g, ''), nm = String(c.name || '').trim();
    if (num.length >= 8 && nm) { book[tenantId + ':' + num] = nm; n++; if (fresh) fresh.add(tenantId + ':' + num); if (c && 'lid' in c) { blid[tenantId + ':' + num] = !!c.lid; lidN++; } }
  }
  if (n) { bookSeen += n; clearTimeout(bookT); bookT = setTimeout(() => { try { writeJsonSafe(BOOK_FILE, book); } catch {} }, 2000); }
  if (lidN) keepBlid();
}
// الاسم المحفوظ بجهات اتصالك لهالرقم (أو '' إذا مو محفوظ)
export function bookName(tenantId, phone) {
  const num = String(phone || '').replace(/\D/g, ''); if (num.length < 8) return '';
  if (book[tenantId + ':' + num]) return book[tenantId + ':' + num];
  const k = Object.keys(book).find(x => x.startsWith(tenantId + ':') && x.slice(-9) === num.slice(-9));
  return k ? book[k] : '';
}
// منطلب من الواتس نسخة كاملة من جهات الاتصال (الأسماء المحفوظة عندك) مشان نعرف مين مسجّل ومين لأ
async function bookResync(tenantId, sock, state, rebuild = false) {
  if (!contactsOn(tenantId) || typeof sock.resyncAppState !== 'function') return;
  const flag = bookFlag(tenantId);
  if (!rebuild && bookReady(tenantId) && fs.existsSync(flag)) return;
  if (rebuild) { const st = new Set(); st.at = Date.now(); rebuilding.set(String(tenantId), st); }
  const before = Object.keys(book).filter(k => k.startsWith(tenantId + ':')).length;
  console.log(`[wa] tenant ${tenantId}: fetching your saved contact names from WhatsApp…`);
  // المزامنة أحياناً بتعلق وما بترجع أبداً: كان الحفظ يوقف للأبد (11 تشرين التاني، 4 أرقام ما انحفظت). هلق حد أقصى دقيقتين
  try {
    await state.keys.set({ 'app-state-sync-version': { critical_unblock_low: null } }); // من الصفر = نسخة كاملة
    await Promise.race([sock.resyncAppState(['critical_unblock_low'], true), new Promise((_, no) => setTimeout(() => no(new Error('resync took too long')), 120_000))]);
    await new Promise(r => setTimeout(r, 4000));
  } catch (e) {
    if (rebuild) rebuilding.delete(String(tenantId));
    console.error(`[wa] tenant ${tenantId}: address book sync failed (${e.message}) — saving goes on with the old list`);
    setTimeout(() => queueAllKnown(tenantId), 5000);
    return;
  }
  const fresh = rebuilding.get(String(tenantId));
  if (fresh) {
    rebuilding.delete(String(tenantId));
    // أمان: إذا وصل عدد قليل كتير (مزامنة ناقصة) ما منشيل شي
    if (fresh.size >= 50 && fresh.size >= before * 0.3) {
      let gone = 0; for (const k of Object.keys(book)) if (k.startsWith(tenantId + ':') && !fresh.has(k)) { delete book[k]; delete saved[k]; gone++; }
      try { writeJsonSafe(BOOK_FILE, book); writeJsonSafe(SAVED_FILE, saved); } catch {}
      console.log(`[wa] tenant ${tenantId}: address book rebuilt — ${fresh.size} saved on your phone, ${gone} not there any more (will be saved again)`);
    } else console.log(`[wa] tenant ${tenantId}: rebuild got only ${fresh.size} names — kept the old list`);
  }
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
  if (found.length) { rememberHistory(tenantId, found); if (bookReady(tenantId) && contactsOn(tenantId)) { if (hasService(tenantId, 'contacts_new')) queueContacts(tenantId, found); } }
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
// الدفتر لازم يكون محمّل فعلاً (مو بس علامة إنو انمزامن مرة): إذا فاضي ما منلمس ولا رقم
const bookReady = (tenantId) => Object.keys(book).filter(k => k.startsWith(tenantId + ':')).length >= 50;
const isPlaceholder = (n) => /^زبون \d{4,}$/.test(String(n || '').trim());
// طلب إعادة بناء الدفتر: ملف deploy/contacts-rebuild بالمستودع (أي تغيير فيه = إعادة بناء مرة وحدة)، وكمان كل 24 ساعة لحالو
const REBUILD_REQ = path.join(process.cwd(), 'deploy', 'contacts-rebuild');
function maybeRebuild(tenantId) {
  if (Number(tenantId) !== KO_TENANT || rebuilding.size) return;
  const s = sessions.get(tenantId); if (!s?.sock || s.status !== 'open') return;
  let want = ''; try { want = fs.readFileSync(REBUILD_REQ, 'utf8').trim(); } catch {}
  const doneF = path.join(DATA_DIR, `wa-book-rebuilt-${tenantId}.txt`); let done = ''; try { done = fs.readFileSync(doneF, 'utf8').trim(); } catch {}
  const [doneReq, doneAt] = done.split('|'); const day = Date.now() - (Number(doneAt) || 0) > 24 * 3600_000;
  if (!(want && want !== doneReq) && !day) return;
  try { fs.writeFileSync(doneF, (want || doneReq || '') + '|' + Date.now()); } catch {}
  console.log(`[wa] tenant ${tenantId}: rebuilding the address book from WhatsApp${want && want !== doneReq ? ' (asked)' : ' (daily)'}`);
  bookResync(tenantId, s.sock, { keys: s.sock.authState.keys }, true).then(() => setTimeout(() => queueAllKnown(tenantId), 5000)).catch(e => { rebuilding.delete(String(tenantId)); console.error('[wa] rebuild', e.message); });
}
// الاسم يلي البوت بيحطو للرقم: «<البادئة> 1234». البادئة بيختارها الزبون (الافتراضي «زبون»)
const prefixOf = tenantId => { try { return String(getTenant(tenantId)?.settings?.contacts_prefix || 'زبون').replace(/[\d\n\r]/g, '').trim().slice(0, 24) || 'زبون'; } catch { return 'زبون'; } };
const escRe = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isPh = (tenantId, n) => isPlaceholder(n) || new RegExp('^' + escRe(prefixOf(tenantId)) + ' \\d{4,}$').test(String(n || '').trim());
// اسم ما بيتشابه مع ولا اسم تاني محفوظ (صاحب المتجر، 11 تشرين التاني 2026):
// «زبون 1234» إذا موجود لرقم تاني ← «زبون 51234» ← «زبون 651234»… واسم حقيقي مكرر لرقم تاني بينضافلو آخر 4 (أو 5، 6…) أرقام
function uniqueName(tenantId, base, num, placeholder) {
  const pre = tenantId + ':', taken = new Set();
  for (const [k, v] of Object.entries(book)) if (k.startsWith(pre) && k !== pre + num && v) taken.add(String(v).trim());
  if (!taken.has(base)) return base;
  for (let L = placeholder ? 5 : 4; L <= num.length; L++) {
    const m = placeholder ? prefixOf(tenantId) + ' ' + num.slice(-L) : base + ' ' + num.slice(-L);
    if (!taken.has(m)) return m;
  }
  return base + ' ' + num;
}
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
async function fixContactsState(tenantId) { const s = sessions.get(tenantId); if (s) s.stateDirty = true; } // العامل بيسحب النسخة كاملة قبل الحفظ الجاي
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
// فحص عند الطلب: ملف data/contacts-audit-request.txt ← العامل بيسحب كل جهات الاتصال من الواتس وبيكتب النتيجة بـ data/contacts-audit.json
async function auditContacts(tenantId) {
  const req = path.join(DATA_DIR, 'contacts-audit-request.txt'); if (Number(tenantId) !== KO_TENANT || !fs.existsSync(req)) return;
  try { fs.unlinkSync(req); } catch {}
  const s = sessions.get(tenantId); if (s) s.lastPull = 0;
}
// طوارئ (31 تشرين الأول): حفظ/تعديل جهات الاتصال موقّف كلياً لحتى صاحب المنصة يرجّع يشغّلو بنفسو.
// ما في أي اسم بيتغيّر طول ما الملف data/contacts-frozen موجود (بينعمل لحالو هلق).
const FROZEN = path.join(DATA_DIR, 'contacts-frozen');
try { if (!fs.existsSync(path.join(DATA_DIR, 'contacts-unfrozen-by-owner'))) fs.writeFileSync(FROZEN, new Date().toISOString()); } catch {}
// صاحب المتجر (1 تشرين التاني 2026): رجّع حفظ الأرقام الجديدة. الملف deploy/contacts-on بـ GitHub بيفكّ التجميد
// (والقاعدة بتضل: اسم محفوظ عندك ما بيتغيّر أبداً، إلا «زبون XXXX» يلي نحنا حطيناه لما الزبون يكتب اسمو)
const CONTACTS_ON = path.join(ROOT, 'deploy', 'contacts-on');
const frozen = () => { try { return fs.existsSync(FROZEN) && !fs.existsSync(CONTACTS_ON); } catch { return true; } };
// إرجاع الأسماء يلي انغيّرت غلط: data/contacts-restore.json = { "1:9639…": "الاسم الأصلي" }.
// بيرجّع كل اسم لجهات الاتصال (حتى والحفظ مجمّد)، رقم كل 3 ثواني، وبعدين بيسمّي الملف .done
const RESTORE = path.join(DATA_DIR, 'contacts-restore.json');
let restoring = false;
// تراجع تلقائي: أي اسم حقيقي السجل بيقول إنو انقلب «زبون XXXX» بيرجع لاسمو (مرة وحدة، من سجل السيرفر نفسو)
try {
  const mark = path.join(DATA_DIR, 'contacts-undo-log.done');
  if (!fs.existsSync(mark)) {
    const log = fs.readFileSync(path.join(DATA_DIR, 'server.log'), 'utf8'), undo = {};
    for (const m of log.matchAll(/\[wa\] tenant (\d+): contact (\d+) «([^»]+)» → «([^»]+)»/g)) {
      const [, tid, num, from, to] = m;
      if (!/^\S+ \d{4}$/.test(from) && /^\S+ \d{4}$/.test(to)) undo[`${tid}:${num}`] = from;
    }
    if (Object.keys(undo).length) {
      let cur = {}; try { cur = JSON.parse(fs.readFileSync(RESTORE, 'utf8')); } catch {}
      fs.writeFileSync(RESTORE, JSON.stringify({ ...cur, ...undo }));
      console.log(`[wa] undo: ${Object.keys(undo).length} saved name(s) that were changed by mistake will be put back`);
    }
    fs.writeFileSync(mark, new Date().toISOString());
  }
} catch (e) { console.error('[wa] undo renames', e.message); }
setInterval(() => {
  if (restoring || !fs.existsSync(RESTORE) || !isActive()) return;
  restoring = true;
  try {
    const list = JSON.parse(fs.readFileSync(RESTORE, 'utf8')); let n = 0;
    for (const [k, name] of Object.entries(list)) { const [tid, num] = k.split(':'); if (num && name && enqueue(Number(tid), num, { name: String(name), force: 2, why: 'restore' })) n++; }
    fs.renameSync(RESTORE, RESTORE + '.done-' + Date.now());
    console.log(`[wa] restore: ${n} names queued`);
  } catch (e) { console.error('[wa] restore', e.message); }
  restoring = false;
}, 30_000).unref();

// =====================================================================================
// ===== حفظ جهات الاتصال المضمون (24/11/2026، صاحب المتجر: «ما بدي ولا رقم ما ينحفظ نهائياً») =====
// السبب الأساسي (من كود Baileys نفسو، appPatch بـ chats.ts): لما الواتس يرفض حفظ (409 conflict، بيصير إذا الموبايل رفع تغيير
// بنفس اللحظة)، Baileys ما بيفحص الرفض وبيسجّل عندو إنو الحفظ صار. من هديك اللحظة كل حفظ جاي بينبني على نسخة غلط من جهات
// الاتصال: السيرفر بيقبلو، بس الموبايل ما بيطبّقو. هيك غيث كان «محفوظ» عالسيرفر وما بيبيّن عالموبايل.
// وكمان الأرقام كانت بطابور بالذاكرة (ومؤقّت 20 دقيقة)، فكل إعادة تشغيل للبوت كانت تضيّعها.
// الحل:
//  1) طابور واحد محفوظ بملف (data/contacts-queue.json) لكل حفظ: ما بيضيع شي إذا البوت رجع اشتغل
//  2) حفظ واحد بالمرة، وأي رفض ← منرجّع نسخة جهات الاتصال كاملة من الواتس (من الصفر) ومنعيد (لحد 3 مرات)
//  3) التأكيد: الموبايل لما يطبّق الحفظ بيرجع يرفع جهة الاتصال ومعها معرّف lid. كل رقم منضل نعيدلو لحتى الموبايل يأكّدو،
//     وكل ساعة منسحب كل جهات الاتصال من الواتس: أي رقم راسلنا ومو محفوظ (أو محفوظ «زبون» ومنعرف اسمو) بيرجع للطابور لحالو
// القاعدة بتضل: أي اسم حقيقي محفوظ ما بيتغيّر أبداً. بيتغيّر بس «زبون XXXX» لما منعرف الاسم الحقيقي
// =====================================================================================
const LID_CHECK = true;
const PROBE = ['963991795623', '963965374561', '201012379611', '963987331027', '963946444567', '963943527267'];
const QUEUE_FILE = path.join(DATA_DIR, 'contacts-queue.json');
const LIDS_BOOK_FILE = path.join(DATA_DIR, 'wa-addressbook-lid.json');
let cq = {}; for (const f of [QUEUE_FILE, QUEUE_FILE + '.prev']) { try { const o = JSON.parse(fs.readFileSync(f, 'utf8')); if (o && typeof o === 'object') { cq = o; break; } } catch {} }
let blid = readJsonSafe(LIDS_BOOK_FILE); // «مشترك:رقم» → true إذا آخر نسخة لجهة الاتصال رفعها الموبايل (معها lid)
let cqT = null, blidT = null;
function keepQueue() { clearTimeout(cqT); cqT = setTimeout(() => { try { const t = JSON.stringify(cq); fs.writeFileSync(QUEUE_FILE + '.tmp', t); try { fs.copyFileSync(QUEUE_FILE, QUEUE_FILE + '.prev'); } catch {} fs.renameSync(QUEUE_FILE + '.tmp', QUEUE_FILE); } catch (e) { console.error('[wa] contacts queue file', e.message); } }, 1000); }
function keepBlid() { clearTimeout(blidT); blidT = setTimeout(() => { try { writeJsonSafe(LIDS_BOOK_FILE, blid); } catch {} }, 3000); }
function keepBook() { clearTimeout(savedT); savedT = setTimeout(() => { try { writeJsonSafe(SAVED_FILE, saved); writeJsonSafe(BOOK_FILE, book); } catch {} }, 1500); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function within(p, ms, what) { let to; const t = new Promise(r => { to = setTimeout(() => r('timeout'), ms); }); const r = await Promise.race([Promise.resolve(p).then(() => 'ok'), t]); clearTimeout(to); if (r === 'timeout') throw new Error(what + ' took too long'); }

// الأسماء الإنكليزية (أو «@abdallah») بتتحوّل لعربي قبل الحفظ (صاحب المتجر 23/11/2026)
const AR_FILE = path.join(DATA_DIR, 'ar-names.json');
const arCache = new Map(Object.entries(readJsonSafe(AR_FILE))); let arT = null;
const latinRaw = (name) => String(name || '').replace(/[@_#.\d]+/g, ' ').replace(/\s+/g, ' ').trim();
async function arName(tenantId, name) {
  const raw = latinRaw(name); if (!/[A-Za-z]{2,}/.test(raw)) return /[\p{Script=Arabic}]{2,}/u.test(raw) ? raw : '';
  if (arCache.has(raw)) return arCache.get(raw);
  let out = '';
  try {
    const { chat, resolveAI } = await import('../ai.js');
    const { text } = await chat(resolveAI(getTenant(tenantId), { prefer: 'smart' }), { system: 'إنت بتحوّل أسماء أشخاص مكتوبة بالحروف الإنكليزية لنفس الاسم بالحروف العربية (متل ما بيكتبو السوري). رجّع الاسم بالعربي بس، بلا أي كلمة تانية. إذا مو اسم شخص رجّع كلمة: لا', messages: [{ role: 'user', content: raw }], json: false, temperature: 0, maxTokens: 40 });
    const t = String(text || '').replace(/["'«»\n]/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^[\p{Script=Arabic}\s]{2,40}$/u.test(t) && t !== 'لا') out = t;
  } catch (e) { console.error('[wa] arName', e.message); return ''; } // خطأ بالاتصال: ما منحفظ النتيجة، منرجع نجرّب
  arCache.set(raw, out); if (out) console.log(`[wa] name «${raw}» → «${out}»`);
  clearTimeout(arT); arT = setTimeout(() => { try { writeJsonSafe(AR_FILE, Object.fromEntries(arCache)); } catch {} }, 2000);
  return out;
}
// الاسم الحقيقي يلي لازم ينحط (أو '' إذا ما منعرفو). الإنكليزي يلي ما زبط تحويلو منعاملو متل ما منعرفو
function realFor(key) {
  const rn = String(realNames[key] || '').replace(/[‎‏]/g, '').trim(); if (!/[\p{L}]{2,}/u.test(rn)) return '';
  if (!/[A-Za-z@_]/.test(rn)) return rn.slice(0, 60);
  const raw = latinRaw(rn); return arCache.has(raw) ? arCache.get(raw) : rn;
}
function isOwnerNum(tenantId, num) {
  try { const s = sessions.get(tenantId), t = getTenant(tenantId), own = [phoneFromJid(s?.sock?.user?.id), ...String(t?.settings?.owner_numbers || '').split(/[,،\s]+/), t?.settings?.notify_number].map(x => String(x || '').replace(/\D/g, '')).filter(x => x.length >= 8); return own.some(o => o.endsWith(num.slice(-9)) || num.endsWith(o.slice(-9))); } catch { return false; }
}
const isChatNum = (tenantId, num) => { try { return !!q.get('SELECT 1 FROM contacts WHERE tenant_id = ? AND phone = ? LIMIT 1', tenantId, num); } catch { return false; } };
// شو ناقص لهالرقم؟ ok | missing (مو محفوظ) | name (محفوظ «زبون» ومنعرف اسمو) | nolid (انحفظ بس الموبايل ما أكّدو)
function verdict(tenantId, num, name, lid, chat) {
  const key = tenantId + ':' + num;
  if (!name) return 'missing';
  if (!isPh(tenantId, name) && saved[key] === name && /[A-Za-z@_]/.test(name)) { const raw = latinRaw(realNames[key] && /[A-Za-z]/.test(realNames[key]) ? realNames[key] : name); if (/[A-Za-z]{2,}/.test(raw) && (!arCache.has(raw) || arCache.get(raw))) return 'name'; } // اسم إنكليزي حطّو البوت: بيتحوّل للعربي
  if (!isPh(tenantId, name)) return LID_CHECK && chat && !lid && saved[key] === name ? 'nolid' : 'ok'; // اسم حقيقي: ما منغيّرو، بس إذا نحنا حاطّينو منتأكد إنو الموبايل أخدو
  const real = realFor(key);
  if (real && !isPh(tenantId, real)) return 'name';
  return LID_CHECK && chat && !lid ? 'nolid' : 'ok';
}
// حط الرقم بالطابور. delay: بعد قديش (مثلاً لنستنّى اسمو من الموقع). force: 1 = الاسم من مصدر موثوق، 2 = تصليح مقصود لاسم غلط
function enqueue(tenantId, phone, { name = '', force = 0, delay = 0, why = '' } = {}) {
  const num = String(phone || '').replace(/\D/g, ''); if (num.length < 8 || num.length > 15) return false;
  const key = tenantId + ':' + num, now = Date.now(), it = cq[key], nb = now + Math.max(0, delay);
  if (!it && !name && !force && !needsWork(tenantId, num)) return true; // محفوظ أصلاً (التأكيد من الموبايل بيتفحص بالسحب)
  if (it) {
    const changed = !!name && name !== it.n;
    if (name) it.n = name;
    if (force > (it.f || 0)) it.f = force;
    if (changed || force === 2) { it.s = 0; it.u = 0; it.t = 0; it.e = ''; it.nb = now; } // اسم جديد: منبعتو هلق
    else if (!it.s && !it.u && nb < (it.nb || 0)) it.nb = nb;
  } else cq[key] = { n: name || '', f: force || 0, nb, t: 0, s: 0, e: '', a: now, w: why };
  keepQueue(); return true;
}
// الرقم بحاجة شغل؟ (من غير تأكيد الموبايل، هاد بيتفحص بالسحب)
function needsWork(tenantId, num) { return verdict(tenantId, num, bookName(tenantId, num), true, false) !== 'ok'; }
export function queueContacts(tenantId, list) {
  let n = 0;
  for (const { phone, name } of list || []) {
    const num = String(phone || '').replace(/\D/g, ''); if (num.length < 8 || isOwnerNum(tenantId, num)) continue;
    const nm = String(name || '').trim();
    if (nm) { if (enqueue(tenantId, num, { name: nm, force: 1, why: 'list' })) n++; }
    else if (needsWork(tenantId, num) && !cq[tenantId + ':' + num]) { if (enqueue(tenantId, num, { why: 'list' })) n++; }
  }
  if (n) console.log(`[wa] tenant ${tenantId}: ${n} numbers queued to save in contacts`);
  return n;
}
// (للتوافق مع الكود القديم) أي «احفظ هالرقم» بيروح عالطابور
export async function saveContact(tenantId, phone, name, force = false, force2 = false) {
  return enqueue(tenantId, phone, { name: force || force2 ? String(name || '') : '', force: force2 ? 2 : force ? 1 : 0, why: 'direct' });
}
// كل تغيير بجهات الاتصال بيمرق من هون: إذا الواتس رفض، منرجّع النسخة كاملة من الواتس ومنعيد (لحد 3 مرات)
async function contactPatch(tid, fn, label) {
  const s = sessions.get(tid);
  for (let i = 1; i <= 3; i++) {
    if (s.stateDirty && !(await pullContacts(tid, 'before ' + label))) throw new Error('could not refresh the contacts state from WhatsApp');
    s.lastSyncErr = null;
    await within(fn(s.sock), 60_000, label);
    await sleep(300);
    if (!s.lastSyncErr) return true;
    const e = s.lastSyncErr; s.lastSyncErr = null; s.stateDirty = true;
    console.error(`[wa] tenant ${tid}: WhatsApp rejected «${label}» (${e.code} ${e.text}) — refreshing the contacts state and trying again (${i}/3)`);
    await sleep(2000 * i);
  }
  throw new Error('WhatsApp rejected it 3 times');
}
// حفظ رقم واحد من الطابور: 'sent' (انبعت، ناطر تأكيد الموبايل) | 'skip' (ما في شي لازم ينعمل) | 'wait' (مو جاهز هلق)
async function saveCore(tid, num, it) {
  const s = sessions.get(tid);
  if (!s?.sock?.addOrEditContact || s.status !== 'open') return 'wait';
  if (isOwnerNum(tid, num)) return 'skip';
  const key = tid + ':' + num, have = bookName(tid, num), force2 = it.f === 2;
  let real = String(realNames[key] || (it.f ? it.n : '') || '').replace(/[‎‏]/g, '').trim();
  real = /[\p{L}]{2,}/u.test(real) ? real.slice(0, 60) : '';
  if (real && /[A-Za-z@_]/.test(real)) { const ar = await arName(tid, real); if (ar) { real = ar; realNames[key] = ar; keepNames(); } else real = ''; }
  const sameReal = (x) => !!real && (x === real || (x.startsWith(real + ' ') && /^\d{4,}$/.test(x.slice(real.length + 1))));
  let full;
  const botOwned = !!have && (saved[key] === have || isPh(tid, have)); // جهة الاتصال حطّها البوت (مو إنت)
  if (have && !isPh(tid, have) && botOwned && /[A-Za-z@_]/.test(have)) { // اسم إنكليزي حطّو البوت: منحوّلو للعربي
    if (!real) { const ar = await arName(tid, realNames[key] && /[A-Za-z]/.test(realNames[key]) ? realNames[key] : have); if (ar) real = ar; }
    if (real && !sameReal(have)) full = uniqueName(tid, real, num, false);
    else if (it.r) full = have;
    else return 'skip';
  } else if (have && !isPh(tid, have)) { // اسم حقيقي محفوظ: ما بيتغيّر أبداً، إلا تصليح مقصود
    if (force2 && real && !sameReal(have)) full = uniqueName(tid, real, num, false);
    else if (it.r && saved[key] === have) full = have; // نفس الاسم، منعيد بعتو لأنو الموبايل ما أكّدو
    else return 'skip';
  } else if (have) { // «زبون XXXX»
    if (real) full = sameReal(have) ? have : uniqueName(tid, real, num, false);
    else if (it.r) full = have;
    else return 'skip';
  } else full = real ? uniqueName(tid, real, num, false) : uniqueName(tid, prefixOf(tid) + ' ' + num.slice(-4), num, true);
  if (full === have && !it.r) return 'skip';
  const jid = num + '@s.whatsapp.net';
  // تعديل ما ثبت 3 مرات، أو جهة اتصال حطّها البوت والموبايل ما أكّدها بعد مرة: منشيلها ومنرجع نحفظها جديدة (الموبايل بيعاملها جديدة)
  if (have && ((full !== have && (it.t || 0) >= 3) || (full === have && botOwned && (it.t || 0) >= 1))) {
    try { await contactPatch(tid, (sock) => sock.removeContact(jid), 'remove ' + num); console.log(`[wa] tenant ${tid}: contact ${num} «${have}» removed to save it again`); await sleep(3000); } catch (e) { console.error(`[wa] tenant ${tid}: remove contact ${num}`, e.message); }
  }
  await contactPatch(tid, (sock) => sock.addOrEditContact(jid, { fullName: full, firstName: full.split(' ')[0], saveOnPrimaryAddressbook: true }), 'save ' + num);
  saved[key] = full; book[key] = full; blid[key] = false; keepBook(); keepBlid();
  console.log(`[wa] tenant ${tid}: contact ${num} ${have ? `«${have}» → ` : 'new → '}«${full}»${it.r ? ' (again: your phone had not confirmed it)' : ''}`);
  return 'sent';
}
function judge(tid, k, it, v, now) {
  if (v === 'ok') { delete cq[k]; return 'ok'; }
  if (v === 'nolid' && (it.t || 0) >= 4) {
    it.s = 0; it.u = (it.u || 0) + 1; it.t = 0; it.r = 1; it.nb = now + (it.u >= 3 ? 7 : 1) * 24 * 3600_000;
    console.error(`[wa] tenant ${tid}: contact ${k.slice(String(tid).length + 1)} sent 4 times but your phone has not confirmed it — trying again ${it.u >= 3 ? 'next week' : 'tomorrow'}`);
    return 'unconfirmed';
  }
  it.s = 0; it.r = v === 'name' ? 0 : 1; it.nb = now; return v;
}
// تأكيد مباشر (كل دقيقة): من الأحداث يلي بتوصل من الواتس لما الموبايل يرفع جهة الاتصال
function verifyLive(tid) {
  const pre = tid + ':', now = Date.now(); let ch = 0;
  for (const [k, it] of Object.entries(cq)) { if (!k.startsWith(pre) || !it.s || now - it.s < 10 * 60_000) continue; judge(tid, k, it, verdict(tid, k.slice(pre.length), book[k] || '', !!blid[k], isChatNum(tid, k.slice(pre.length))), now); ch++; }
  if (ch) keepQueue();
}
// سحب كل جهات الاتصال من الواتس (من الصفر): بيصلّح نسخة البوت، وبيتأكد إنو كل رقم محفوظ فعلاً
async function pullContacts(tid, why) {
  const s = sessions.get(tid); if (!s?.sock?.resyncAppState || s.status !== 'open') return false;
  s.pullTry = Date.now();
  const cap = new Map(); let lidOnly = 0;
  const h = (list) => { for (const c of list || []) { const id = String(c?.id || ''); if (/@lid$/.test(id) && !c?.phoneNumber) { lidOnly++; continue; } const pn = /@s\.whatsapp\.net$/.test(id) ? id : String(c?.phoneNumber || ''); const num = pn.split('@')[0].split(':')[0].replace(/\D/g, ''); if (num.length >= 8) cap.set(num, { n: String(c?.name || '').trim(), l: !!c?.lid }); } };
  s.sock.ev.on('contacts.upsert', h);
  try {
    const keys = s.sock.authState.keys, tx = typeof keys.transaction === 'function' ? (w) => keys.transaction(w, s.sock.authState.creds?.me?.id || 'resync-app-state') : (w) => w();
    await within(tx(async () => { await keys.set({ 'app-state-sync-version': { critical_unblock_low: null } }); await s.sock.resyncAppState(['critical_unblock_low'], true); }), 150_000, 'contacts sync');
    await sleep(4000);
  } catch (e) { console.error(`[wa] tenant ${tid}: pulling contacts from WhatsApp failed (${e.message})`); return false; }
  finally { s.sock.ev.off('contacts.upsert', h); }
  const pre = tid + ':', now = Date.now(), n0 = Object.keys(book).filter(k => k.startsWith(pre)).length;
  if (cap.size < 20 && n0 > 100) { console.error(`[wa] tenant ${tid}: pull got only ${cap.size} contacts (have ${n0}) — ignored`); return false; }
  // دفتر البوت = يلي فعلاً عالواتس
  let gone = 0;
  if (cap.size >= n0 * 0.5) for (const k of Object.keys(book)) if (k.startsWith(pre) && !cap.get(k.slice(pre.length))?.n) { delete book[k]; delete saved[k]; delete blid[k]; gone++; }
  let withLid = 0, phs = 0;
  for (const [num, r] of cap) { if (!r.n) continue; book[pre + num] = r.n; blid[pre + num] = r.l; if (r.l) withLid++; if (isPh(tid, r.n)) phs++; }
  writeJsonSafe(BOOK_FILE, book); writeJsonSafe(SAVED_FILE, saved); keepBlid();
  try { fs.writeFileSync(bookFlag(tid), new Date().toISOString()); } catch {}
  s.stateDirty = false; s.lastPull = Date.now(); s.sentSince = 0; s.pullOk = true;
  // 1) يلي انبعتو: اتأكّدو؟
  const chats = new Set(); try { for (const r of q.all('SELECT DISTINCT phone FROM contacts WHERE tenant_id = ? AND phone IS NOT NULL', tid)) { const d = String(r.phone).replace(/\D/g, ''); if (d.length >= 8) chats.add(d); } } catch {}
  const c = { ok: 0, missing: 0, name: 0, nolid: 0, unconfirmed: 0 }, add = { missing: 0, name: 0, nolid: 0 };
  for (const [k, it] of Object.entries(cq)) {
    if (!k.startsWith(pre) || !it.s || now - it.s < 8 * 60_000) continue;
    const num = k.slice(pre.length), r = cap.get(num); c[judge(tid, k, it, verdict(tid, num, r?.n || '', !!r?.l, chats.has(num)), now)]++;
  }
  // 2) كل رقم راسلنا لازم يكون محفوظ (بالاسم الصح، ومأكّد من الموبايل)
  if (hasService(tid, 'contacts_new')) for (const num of chats) {
    const k = pre + num; if (cq[k] || isOwnerNum(tid, num)) continue;
    const r = cap.get(num), v = verdict(tid, num, r?.n || '', !!r?.l, true); if (v === 'ok') continue;
    cq[k] = { n: '', f: 0, nb: now, t: 0, s: 0, e: '', a: now, w: 'check:' + v, r: v === 'nolid' ? 1 : 0 }; add[v]++;
  }
  if (hasService(tid, 'contacts_new')) for (const k of Object.keys(realNames)) {
    if (!k.startsWith(pre) || cq[k]) continue; const num = k.slice(pre.length); if (num.length < 8 || num.length > 15 || chats.has(num) || isOwnerNum(tid, num) || !realFor(k)) continue;
    const r = cap.get(num), v = verdict(tid, num, r?.n || '', !!r?.l, false); if (v === 'ok') continue;
    cq[k] = { n: '', f: 0, nb: now, t: 0, s: 0, e: '', a: now, w: 'known:' + v, r: 0 }; add[v] = (add[v] || 0) + 1;
  }
  keepQueue();
  const probe = {}; for (const n of PROBE) probe[n] = cap.get(n) || null;
  s.lastPullInfo = { at: new Date().toISOString(), why, records: cap.size, lidOnly, withLid, placeholders: phs, gone, chats: chats.size, checked: c, queued: add, queue: Object.keys(cq).filter(k => k.startsWith(pre)).length, probe };
  try { fs.writeFileSync(path.join(DATA_DIR, 'contacts-audit.json'), JSON.stringify(s.lastPullInfo, null, 1)); } catch {}
  console.log(`[wa] tenant ${tid}: contacts pulled from WhatsApp (${why}): ${cap.size} saved (${withLid} confirmed by your phone); checked ${JSON.stringify(c)}; queued ${JSON.stringify(add)}`);
  return true;
}
// الحفظ الجديد أول شي، وإعادة الإرسال (لرقم انحفظ بس الموبايل ما أكّدو) وحدة كل 10 ثواني بس، لحتى ما نضغط عالواتس
function nextDue(tid, now, allowR) {
  const pre = tid + ':'; let best = null, bt = Infinity, bestR = null, btR = Infinity;
  for (const k in cq) { if (!k.startsWith(pre)) continue; const it = cq[k]; if (it.s) continue; const nb = it.nb || 0; if (nb > now) continue; if (it.r) { if (nb < btR) { bestR = k; btR = nb; } } else if (nb < bt) { best = k; bt = nb; } }
  return best || (allowR ? bestR : null);
}
async function processKey(tid, k) {
  const it = cq[k], num = k.slice(String(tid).length + 1), s = sessions.get(tid), now = Date.now();
  if (it.r) s.lastResend = now;
  try {
    const r = await saveCore(tid, num, it);
    if (r === 'skip') delete cq[k];
    else if (r === 'wait') it.nb = now + 60_000;
    else { it.s = Date.now(); it.t = (it.t || 0) + 1; it.e = ''; it.r = 0; s.sentSince = (s.sentSince || 0) + 1; s.lastSent = Date.now(); }
  } catch (e) {
    it.t = (it.t || 0) + 1; it.e = String(e?.message || e).slice(0, 140); it.s = 0;
    it.nb = now + Math.min(6 * 3600_000, 30_000 * 2 ** Math.min(it.t, 9));
    console.error(`[wa] tenant ${tid}: contact ${num} not saved yet (try ${it.t}): ${it.e}`);
  }
  keepQueue();
}
// العامل: كل 3 ثواني حفظ واحد (لكل المشتركين بالدور)، وسحب كامل عند الحاجة
let cwBusy = false, cwTurn = 0;
async function contactsTick() {
  if (frozen() || !isActive()) return;
  const list = [...sessions.entries()]; if (!list.length) return;
  const now = Date.now();
  for (let j = 0; j < list.length; j++) {
    const [tid, s] = list[(cwTurn + j) % list.length];
    if (s.status !== 'open' || !s.sock?.addOrEditContact || !contactsOn(tid)) continue;
    if (!hasService(tid, 'contacts_new') && !hasService(tid, 'contacts_old')) continue;
    if (!s.openAt) s.openAt = now;
    if (now - s.openAt < 25_000) continue; // اتصال جديد: منستنّى يهدى
    const needPull = !s.lastPull || s.stateDirty || now - s.lastPull > 60 * 60_000 || (s.sentSince > 0 && now - (s.lastSent || 0) > 15 * 60_000 && now - s.lastPull > 15 * 60_000);
    if (needPull && now - (s.pullTry || 0) > 60_000) { cwTurn = (cwTurn + j + 1) % list.length; await pullContacts(tid, s.stateDirty ? 'after a rejection' : !s.lastPull ? 'start' : s.sentSince ? 'check after saving' : 'hourly check'); return; }
    if (!bookReady(tid) && !s.pullOk) continue; // ما منعرف شو محفوظ لهلق: ما منلمس شي
    if (now - (s.verAt || 0) > 60_000) { s.verAt = now; verifyLive(tid); }
    const k = nextDue(tid, now, now - (s.lastResend || 0) > 10_000); if (!k) continue;
    cwTurn = (cwTurn + j + 1) % list.length;
    await processKey(tid, k); return;
  }
}
setInterval(() => { if (cwBusy) return; cwBusy = true; contactsTick().catch(e => console.error('[wa] contacts worker', e.message)).finally(() => { cwBusy = false; }); }, 3000).unref();

function queueAllKnown(tenantId) {
  const wantNew = hasService(tenantId, 'contacts_new'), wantOld = hasService(tenantId, 'contacts_old');
  if (!wantNew && !wantOld) return;
  resolveLids(tenantId).catch(() => {});
  if (!bookReady(tenantId)) { const s = sessions.get(tenantId); if (s) s.lastPull = 0; return; } // ما وصل دفتر العناوين: العامل بيسحبو
  try {
    if (Number(tenantId) === KO_TENANT) {
    // 1) الأسماء من الطلبات القديمة ومن يلي كتبو الزبون بالمحادثات («اسمي…»، «معك…»)
    let found = 0;
    for (const o of q.all("SELECT c.phone, o.customer_name n FROM orders o JOIN contacts c ON c.id = o.contact_id WHERE o.tenant_id = ? AND o.customer_name IS NOT NULL AND o.customer_name != ''", tenantId)) {
      const key = tenantId + ':' + String(o.phone || '').replace(/\D/g, ''); if (o.phone && !realNames[key] && /[\p{L}]{2,}/u.test(o.n) && validName(String(o.n).split(' - ')[0].trim())) { realNames[key] = String(o.n).trim().slice(0, 60); found++; }
    }
    for (const m of q.all("SELECT c.phone, m.body FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.tenant_id = ? AND m.direction = 'in' AND (m.body LIKE '%اسمي%' OR m.body LIKE '%إسمي%' OR m.body LIKE '%معك %' OR m.body LIKE '%معاك %' OR m.body LIKE '%الاسم%') ORDER BY m.id", tenantId)) {
      const nm = nameFromText(m.body), key = tenantId + ':' + String(m.phone || '').replace(/\D/g, '');
      if (nm && m.phone && !realNames[key]) { realNames[key] = nm; found++; }
    }
    for (const [k, arr] of Object.entries(histTexts)) { if (!k.startsWith(tenantId + ':')) continue; const ph = k.slice(String(tenantId).length + 1); for (const t of arr) if (learnName(tenantId, ph, t)) found++; }
    for (const m of q.all("SELECT c.phone, m.body FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.tenant_id = ? AND m.direction = 'in' AND c.phone IS NOT NULL ORDER BY m.id", tenantId)) { if (learnName(tenantId, String(m.phone).replace(/\D/g, ''), m.body)) found++; }
    if (found) { try { fs.writeFileSync(NAMES_FILE, JSON.stringify(realNames)); } catch {} console.log(`[wa] tenant ${tenantId}: found ${found} real names in old chats/orders`); }
    }
    // 2) كل الأرقام يلي بحاجة شغل: بالاسم الحقيقي إذا منعرفو، وغير هيك «زبون XXXX»
    const list = (wantNew ? q.all('SELECT phone FROM contacts WHERE tenant_id = ? AND phone IS NOT NULL', tenantId).map(c => ({ phone: c.phone })) : [])
      .concat(wantOld ? (backupNums[tenantId] || []).filter(p => isOld(tenantId, p)).map(p => ({ phone: p })) : []);
    queueContacts(tenantId, list);
  } catch (e) { console.error('[wa] queue contacts', e.message); }
}

export async function send(tenantId, jid, { text, image, audio, document, fileName, mimetype }) {
  const s = sessions.get(tenantId);
  if (!s?.sock || s.status !== 'open') throw new Error('واتساب مو مربوط حالياً');
  // document: ملف (متل PDF برنامج التمرين من موقع KO SPORT)، بينبعت كملف بينزل عند الزبون
  const content = document ? { document: mediaSource(document), mimetype: mimetype || 'application/pdf', fileName: fileName || 'file.pdf', caption: text || undefined }
    : audio ? { audio: mediaSource(audio), mimetype: 'audio/ogg; codecs=opus', ptt: true } : image ? { image: mediaSource(image), caption: text || undefined } : { text };
  try {
    const r = await s.sock.sendMessage(jid, content);
    return { id: r?.key?.id };
  } catch (e) {
    if ((image || audio || document) && text) { // إذا الصورة أو الصوت أو الملف فشل، منبعت النص لحاله
      const r = await s.sock.sendMessage(jid, { text });
      return { id: r?.key?.id };
    }
    throw e;
  }
}

// رسالة فيها زر «نسخ الكود» (cta_copy). مو رسمي على الرقم العادي، فبتنبعت بس للتجربة أو إذا انفعّلت
export async function sendCopyButton(tenantId, jid, text, code, label = '📋 نسخ الكود') {
  const s = sessions.get(tenantId);
  if (!s?.sock || s.status !== 'open') return false;
  const m = await import('baileys'), d = m.default && typeof m.default === 'object' ? m.default : m;
  const gen = m.generateWAMessageFromContent ?? d.generateWAMessageFromContent;
  if (typeof gen !== 'function') return false;
  const content = { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, interactiveMessage: {
    body: { text }, footer: { text: 'KO SPORT' },
    nativeFlowMessage: { buttons: [{ name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: label, id: String(code), copy_code: String(code) }) }], messageParamsJson: '' },
  } } } };
  const msg = gen(jid, content, { userJid: s.sock.user?.id });
  await s.sock.relayMessage(jid, msg.message, { messageId: msg.key.id, additionalNodes: [{ tag: 'biz', attrs: {}, content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }] }] });
  return true;
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

export const openCount = () => [...sessions.values()].filter(s => s.status === 'open').length;
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
  return { saved: savedN, pending: contactsOn(tenantId) ? Object.entries(cq).filter(([k, it]) => k.startsWith(pre) && !it.u).length : 0, history: (backupNums[tenantId] || []).length, book_ready: bookReady(tenantId), hidden_unknown: (histLids[tenantId] || []).length };
}
// أرقام من النسخة الاحتياطية (انفكّت على جهاز الزبون وإجت الأرقام بس): منضيفها للقديمة ومنحطها بالطابور
export function importNumbers(tenantId, nums) {
  const map = new Map();
  for (const x of nums || []) {
    const [n, t] = Array.isArray(x) ? x : [x, 0];
    const p = String(n || '').replace(/\D/g, ''); if (p.length < 9 || p.length > 15) continue;
    map.set(p, t); if (t) seen(tenantId, p, t);
  }
  const list = [...map.keys()].map(p => ({ phone: p }));
  rememberBackup(tenantId, list);
  const open = sessions.get(tenantId)?.status === 'open';
  const queued = open && bookReady(tenantId) && hasService(tenantId, 'contacts_old') ? queueContacts(tenantId, list.filter(x => isOld(tenantId, x.phone))) : 0;
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

// ===== أول مرة شفنا كل رقم (لتمييز القديم عن الجديد) =====
const FIRST_FILE = path.join(DATA_DIR, 'wa-first-seen.json');
let firstSeen = {}; try { firstSeen = JSON.parse(fs.readFileSync(FIRST_FILE, 'utf8')); } catch {}
let firstT = null;
function seen(tenantId, phone, ts) {
  phone = String(phone || '').replace(/\D/g, ''); ts = Number(ts) || 0;
  if (ts > 1e12) ts = Math.floor(ts / 1000);
  if (phone.length < 8 || ts < 1e9) return;
  const m = firstSeen[tenantId] ||= {};
  if (m[phone] && m[phone] <= ts) return;
  m[phone] = ts;
  clearTimeout(firstT); firstT = setTimeout(() => { try { fs.writeFileSync(FIRST_FILE, JSON.stringify(firstSeen)); } catch {} }, 5000);
}
// الرقم «قديم» إذا في محادثة معو قبل وقت تفعيل «الأرقام القديمة». يلي ما منعرف تاريخو ما بينحسب قديم
function isOld(tenantId, phone) {
  const cut = oldCutoff(tenantId);
  if (cut === Infinity) return true;
  const t = firstSeen[tenantId]?.[String(phone || '').replace(/\D/g, '')];
  return !!t && t < cut;
}
export const isOldNumber = isOld;

// أرقام النسخة الاحتياطية (المصدر الوحيد للأرقام القديمة)
const BACKUP_FILE = path.join(DATA_DIR, 'wa-backup-numbers.json');
let backupNums = {}; try { backupNums = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8')); } catch {}
function rememberBackup(tenantId, list) {
  const set = new Set(backupNums[tenantId] || []);
  for (const x of list || []) set.add(String(x.phone));
  backupNums[tenantId] = [...set];
  try { fs.writeFileSync(BACKUP_FILE, JSON.stringify(backupNums)); } catch (e) { console.error('[wa] backup numbers', e.message); }
}

// ===== حالة واتساب (ستوري): بتبيّن لجهات اتصالك (أحدث 3000 زبون ورقم محفوظ) =====
export async function postStatus(tenantId, { image, caption }) {
  const s = sessions.get(tenantId);
  if (!s?.sock || s.status !== 'open') throw new Error('واتساب مو مربوط هلّق');
  const set = new Set();
  for (const r of q.all('SELECT phone FROM contacts WHERE tenant_id = ? AND phone IS NOT NULL ORDER BY last_at DESC LIMIT 3000', tenantId)) { const d = String(r.phone).replace(/\D/g, ''); if (d.length >= 9) set.add(d + '@s.whatsapp.net'); }
  for (const k of Object.keys(book)) { if (set.size >= 3000) break; if (k.startsWith(tenantId + ':')) set.add(k.slice(String(tenantId).length + 1) + '@s.whatsapp.net'); }
  const me = String(s.sock.user?.id || '').replace(/:\d+@/, '@'); if (me) set.add(me);
  await s.sock.sendMessage('status@broadcast', { image, caption }, { statusJidList: [...set], broadcast: true });
  return set.size;
}

// الجهاز صار هوي الشغّال (الكمبيوتر وقف): رسائل «سجّل بالواتساب» يلي وصلت وهوي ساكت، منأكّدها ومنرد عليها هلق
export async function flushKoLater() { /* ملغى: ما منرد على رسائل قديمة */ }
