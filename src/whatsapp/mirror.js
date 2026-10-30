// نسخة من واتساب كل حساب (متل واتساب ويب): كل المحادثات والرسائل، القديمة (يلي بيبعتها واتساب وقت الربط) والجديدة
// بقاعدة لحالها (wa-mirror.db) حتى ما تكبر قاعدة المنصة الأساسية
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { emit } from '../events.js';

const db = new DatabaseSync(path.join(DATA_DIR, 'wa-mirror.db'));
db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS chats (
  tenant_id INTEGER NOT NULL, jid TEXT NOT NULL, name TEXT, is_group INTEGER NOT NULL DEFAULT 0,
  last_ts INTEGER NOT NULL DEFAULT 0, last_text TEXT, last_from_me INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, jid));
CREATE INDEX IF NOT EXISTS chats_order ON chats(tenant_id, pinned DESC, last_ts DESC);
CREATE TABLE IF NOT EXISTS msgs (
  tenant_id INTEGER NOT NULL, jid TEXT NOT NULL, id TEXT NOT NULL, from_me INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL,
  sender TEXT, sender_name TEXT, type TEXT NOT NULL, text TEXT, thumb TEXT, meta TEXT, raw TEXT, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, jid, id));
CREATE INDEX IF NOT EXISTS msgs_chat ON msgs(tenant_id, jid, ts DESC);
CREATE TABLE IF NOT EXISTS names (tenant_id INTEGER NOT NULL, jid TEXT NOT NULL, name TEXT, push TEXT, PRIMARY KEY (tenant_id, jid));
CREATE TABLE IF NOT EXISTS flags (tenant_id INTEGER NOT NULL, k TEXT NOT NULL, v TEXT, PRIMARY KEY (tenant_id, k));`);

const q = {
  run: (s, ...a) => db.prepare(s).run(...a),
  get: (s, ...a) => db.prepare(s).get(...a),
  all: (s, ...a) => db.prepare(s).all(...a)
};
const tx = fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

let BJ = null; // BufferJSON من Baileys (لنحفظ مفاتيح الوسائط ونرجع ننزّلها)
export function useBufferJSON(bj) { BJ = bj; }

const SKIP = /@broadcast$|@newsletter$|^status@/;
const num = v => Number(v?.toNumber?.() ?? v?.low ?? v ?? 0);
const b64 = v => { if (!v) return null; try { return Buffer.from(typeof v === 'string' ? Buffer.from(v, 'base64') : v).toString('base64'); } catch { return null; } };

function unwrap(m) {
  for (let i = 0; i < 5 && m; i++) {
    const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessageV2Extension?.message
      || m.documentWithCaptionMessage?.message || m.editedMessage?.message;
    if (!inner) break; m = inner;
  }
  return m;
}

// نوع الرسالة ونصها
export function describe(message) {
  const m = unwrap(message || {});
  if (!m) return null;
  if (m.protocolMessage) return { proto: m.protocolMessage };
  if (m.reactionMessage) return { reaction: m.reactionMessage };
  if (m.conversation) return { type: 'text', text: m.conversation };
  if (m.extendedTextMessage) return { type: 'text', text: m.extendedTextMessage.text || '' };
  if (m.imageMessage) return { type: 'image', text: m.imageMessage.caption || '', thumb: b64(m.imageMessage.jpegThumbnail), media: true, meta: { mime: m.imageMessage.mimetype } };
  if (m.videoMessage) return { type: m.videoMessage.gifPlayback ? 'gif' : 'video', text: m.videoMessage.caption || '', thumb: b64(m.videoMessage.jpegThumbnail), media: true, meta: { mime: m.videoMessage.mimetype, seconds: m.videoMessage.seconds } };
  if (m.audioMessage) return { type: m.audioMessage.ptt ? 'voice' : 'audio', text: '', media: true, meta: { mime: m.audioMessage.mimetype, seconds: m.audioMessage.seconds } };
  if (m.documentMessage) return { type: 'document', text: m.documentMessage.caption || '', thumb: b64(m.documentMessage.jpegThumbnail), media: true, meta: { mime: m.documentMessage.mimetype, file: m.documentMessage.fileName || 'ملف', size: num(m.documentMessage.fileLength) } };
  if (m.stickerMessage) return { type: 'sticker', text: '', media: true, meta: { mime: m.stickerMessage.mimetype || 'image/webp' } };
  if (m.locationMessage || m.liveLocationMessage) { const l = m.locationMessage || m.liveLocationMessage; return { type: 'location', text: l.name || l.address || '', meta: { lat: l.degreesLatitude, lng: l.degreesLongitude } }; }
  if (m.contactMessage) return { type: 'contact', text: m.contactMessage.displayName || 'جهة اتصال', meta: { vcard: String(m.contactMessage.vcard || '').slice(0, 2000) } };
  if (m.contactsArrayMessage) return { type: 'contact', text: (m.contactsArrayMessage.contacts || []).map(c => c.displayName).join('، ') };
  if (m.pollCreationMessage || m.pollCreationMessageV3) { const p = m.pollCreationMessage || m.pollCreationMessageV3; return { type: 'poll', text: p.name || 'تصويت', meta: { options: (p.options || []).map(o => o.optionName) } }; }
  if (m.buttonsResponseMessage) return { type: 'text', text: m.buttonsResponseMessage.selectedDisplayText || '' };
  if (m.listResponseMessage) return { type: 'text', text: m.listResponseMessage.title || '' };
  if (m.templateButtonReplyMessage) return { type: 'text', text: m.templateButtonReplyMessage.selectedDisplayText || '' };
  if (m.callLogMesssage || m.bcallMessage) return { type: 'call', text: 'مكالمة' };
  return null;
}
const PREVIEW = { image: '📷 صورة', video: '🎥 فيديو', gif: 'GIF', voice: '🎤 رسالة صوتية', audio: '🎵 صوت', document: '📄 ملف', sticker: 'ملصق', location: '📍 موقع', contact: '👤 جهة اتصال', poll: '📊 تصويت', call: '📞 مكالمة' };
const preview = d => (d.text ? (d.type !== 'text' && PREVIEW[d.type] ? PREVIEW[d.type].split(' ')[0] + ' ' : '') + d.text : PREVIEW[d.type] || '').slice(0, 160);

// إضافة رسائل (من الربط أو جديدة). resolve(jid, m) بترجع معرّف المحادثة (الرقم إذا عرفناه بدل @lid)
export function add(tenantId, messages, { resolve = j => j, live = false } = {}) {
  if (!messages?.length) return 0;
  let added = 0;
  const touched = new Map();
  tx(() => {
    for (const m of messages) {
      try {
        const rj = m.key?.remoteJid || '';
        if (!rj || SKIP.test(rj) || !m.message) continue;
        const jid = resolve(rj, m) || rj;
        const d = describe(m.message);
        if (!d) continue;
        const ts = num(m.messageTimestamp) || Math.floor(Date.now() / 1000);
        if (d.proto) { // حذف أو تعديل رسالة
          const p = d.proto, target = p.key?.id;
          if (!target) continue;
          if (p.type === 0 || p.type === 'REVOKE') q.run("UPDATE msgs SET deleted = 1, text = '', thumb = NULL WHERE tenant_id = ? AND jid = ? AND id = ?", tenantId, jid, target);
          else if (p.editedMessage) { const e = describe(p.editedMessage); if (e?.text) q.run('UPDATE msgs SET text = ? WHERE tenant_id = ? AND jid = ? AND id = ?', e.text, tenantId, jid, target); }
          continue;
        }
        if (d.reaction) continue;
        const isGroup = jid.endsWith('@g.us');
        const sender = isGroup ? (m.key.participantAlt || m.key.participantPn || m.key.participant || '') : (m.key.fromMe ? '' : jid);
        const raw = d.media && BJ ? JSON.stringify({ key: m.key, message: m.message }, BJ.replacer) : null;
        const r = q.run(`INSERT OR IGNORE INTO msgs (tenant_id, jid, id, from_me, ts, sender, sender_name, type, text, thumb, meta, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          tenantId, jid, String(m.key.id), m.key.fromMe ? 1 : 0, ts, sender || null, m.pushName || null, d.type, d.text || '', d.thumb || null, d.meta ? JSON.stringify(d.meta) : null, raw);
        if (!r.changes) continue;
        added++;
        if (!m.key.fromMe && m.pushName && !isGroup) q.run('INSERT INTO names (tenant_id, jid, push) VALUES (?, ?, ?) ON CONFLICT(tenant_id, jid) DO UPDATE SET push = excluded.push', tenantId, jid, m.pushName);
        const t = touched.get(jid);
        if (!t || ts >= t.ts) touched.set(jid, { ts, text: preview(d), fromMe: m.key.fromMe ? 1 : 0, isGroup, unread: (t?.unread || 0) + (live && !m.key.fromMe ? 1 : 0) });
        else if (live && !m.key.fromMe) t.unread++;
      } catch (e) { /* رسالة غريبة: منتجاهلها */ }
    }
    for (const [jid, t] of touched) {
      q.run(`INSERT INTO chats (tenant_id, jid, is_group, last_ts, last_text, last_from_me, unread) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, jid) DO UPDATE SET
          last_text = CASE WHEN excluded.last_ts >= chats.last_ts THEN excluded.last_text ELSE chats.last_text END,
          last_from_me = CASE WHEN excluded.last_ts >= chats.last_ts THEN excluded.last_from_me ELSE chats.last_from_me END,
          last_ts = MAX(chats.last_ts, excluded.last_ts), unread = chats.unread + excluded.unread`,
        tenantId, jid, t.isGroup ? 1 : 0, t.ts, t.text, t.fromMe, t.unread);
    }
  });
  if (live && touched.size) emit(tenantId, 'wa_msg', { jids: [...touched.keys()] });
  return added;
}

// معلومات المحادثات (الاسم، غير مقروء، مؤرشفة، مثبتة)
export function setChats(tenantId, chats, resolve = j => j) {
  if (!chats?.length) return;
  tx(() => {
    for (const c of chats) {
      const raw = c.id || ''; if (!raw || SKIP.test(raw)) continue;
      const jid = resolve(raw, c) || raw;
      q.run(`INSERT INTO chats (tenant_id, jid, name, is_group, last_ts, unread, archived, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, jid) DO UPDATE SET name = COALESCE(excluded.name, chats.name), unread = CASE WHEN ? THEN excluded.unread ELSE chats.unread END,
          archived = CASE WHEN ? THEN excluded.archived ELSE chats.archived END, pinned = CASE WHEN ? THEN excluded.pinned ELSE chats.pinned END,
          last_ts = MAX(chats.last_ts, excluded.last_ts)`,
        tenantId, jid, c.name || c.subject || null, jid.endsWith('@g.us') ? 1 : 0, num(c.conversationTimestamp || c.lastMessageRecvTimestamp), Number(c.unreadCount || 0),
        c.archived ? 1 : 0, c.pinned ? 1 : 0, c.unreadCount !== undefined ? 1 : 0, c.archived !== undefined ? 1 : 0, c.pinned !== undefined ? 1 : 0);
    }
  });
}
// أسماء جهات الاتصال المحفوظة بالموبايل
export function setNames(tenantId, contacts, resolve = j => j) {
  if (!contacts?.length) return;
  tx(() => {
    for (const c of contacts) {
      const raw = c.id || ''; if (!raw || SKIP.test(raw)) continue;
      const jid = resolve(raw, c) || raw;
      const name = c.name || null, push = c.notify || c.verifiedName || null;
      if (!name && !push) continue;
      q.run(`INSERT INTO names (tenant_id, jid, name, push) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, jid) DO UPDATE SET
        name = COALESCE(excluded.name, names.name), push = COALESCE(excluded.push, names.push)`, tenantId, jid, name, push);
    }
  });
}
export function setGroups(tenantId, groups) {
  tx(() => { for (const g of Object.values(groups || {})) if (g?.id && g.subject) q.run(`INSERT INTO chats (tenant_id, jid, name, is_group) VALUES (?, ?, ?, 1) ON CONFLICT(tenant_id, jid) DO UPDATE SET name = excluded.name`, tenantId, g.id, g.subject); });
}

// القراية
const phoneOf = jid => (jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : '');
export function listChats(tenantId, { q: search = '', limit = 60, offset = 0, archived = 0 } = {}) {
  const like = '%' + String(search).trim() + '%';
  const rows = q.all(`SELECT c.*, n.name contact_name, n.push FROM chats c LEFT JOIN names n ON n.tenant_id = c.tenant_id AND n.jid = c.jid
    WHERE c.tenant_id = ? AND c.archived = ? AND (c.last_ts > 0 OR c.name IS NOT NULL)
      ${search ? 'AND (c.jid LIKE ? OR c.name LIKE ? OR n.name LIKE ? OR n.push LIKE ? OR c.last_text LIKE ?)' : ''}
    ORDER BY c.pinned DESC, c.last_ts DESC LIMIT ? OFFSET ?`,
    tenantId, archived ? 1 : 0, ...(search ? [like, like, like, like, like] : []), Math.min(200, Number(limit) || 60), Number(offset) || 0);
  return rows.map(r => ({ jid: r.jid, name: r.contact_name || r.name || r.push || '', phone: phoneOf(r.jid), push: r.push || '', is_group: !!r.is_group,
    last_ts: r.last_ts, last_text: r.last_text || '', last_from_me: !!r.last_from_me, unread: r.unread, pinned: !!r.pinned }));
}
export function counts(tenantId) {
  return q.get('SELECT (SELECT COUNT(*) FROM chats WHERE tenant_id = ? AND last_ts > 0) chats, (SELECT COUNT(*) FROM msgs WHERE tenant_id = ?) msgs, (SELECT COUNT(*) FROM chats WHERE tenant_id = ? AND archived = 1) archived, (SELECT MIN(ts) FROM msgs WHERE tenant_id = ?) oldest', tenantId, tenantId, tenantId, tenantId);
}
export function chatInfo(tenantId, jid) {
  const r = q.get('SELECT c.*, n.name contact_name, n.push FROM chats c LEFT JOIN names n ON n.tenant_id = c.tenant_id AND n.jid = c.jid WHERE c.tenant_id = ? AND c.jid = ?', tenantId, jid);
  return r ? { jid, name: r.contact_name || r.name || r.push || '', phone: phoneOf(jid), is_group: !!r.is_group } : { jid, name: '', phone: phoneOf(jid), is_group: jid.endsWith('@g.us') };
}
export function messages(tenantId, jid, { before = 0, limit = 50 } = {}) {
  const rows = q.all(`SELECT id, from_me, ts, sender, sender_name, type, text, thumb, meta, deleted, raw IS NOT NULL has_media FROM msgs
    WHERE tenant_id = ? AND jid = ? ${before ? 'AND ts < ?' : ''} ORDER BY ts DESC, rowid DESC LIMIT ?`, tenantId, jid, ...(before ? [Number(before)] : []), Math.min(200, Number(limit) || 50));
  const nm = new Map(q.all('SELECT jid, name, push FROM names WHERE tenant_id = ?', tenantId).map(r => [r.jid, r.name || r.push]));
  return rows.reverse().map(r => ({ ...r, from_me: !!r.from_me, deleted: !!r.deleted, has_media: !!r.has_media, meta: r.meta ? JSON.parse(r.meta) : null,
    sender_label: r.sender ? (nm.get(r.sender) || r.sender_name || phoneOf(r.sender) || '') : '' }));
}
export function rawMessage(tenantId, jid, id) {
  const r = q.get('SELECT raw, type, meta FROM msgs WHERE tenant_id = ? AND jid = ? AND id = ?', tenantId, jid, id);
  if (!r?.raw || !BJ) return null;
  return { msg: JSON.parse(r.raw, BJ.reviver), type: r.type, meta: r.meta ? JSON.parse(r.meta) : {} };
}
export function markRead(tenantId, jid) { q.run('UPDATE chats SET unread = 0 WHERE tenant_id = ? AND jid = ?', tenantId, jid); }
export const flag = (tenantId, k, v) => v === undefined ? q.get('SELECT v FROM flags WHERE tenant_id = ? AND k = ?', tenantId, k)?.v : q.run('INSERT OR REPLACE INTO flags (tenant_id, k, v) VALUES (?, ?, ?)', tenantId, k, String(v));

// أول مرة: منجيب المحادثات يلي كانت محفوظة عند المجيب من قبل (من وقت ما ربطت)
export function backfill(tenantId, rows) {
  if (flag(tenantId, 'backfill')) return 0;
  let n = 0;
  tx(() => {
    for (const r of rows) {
      if (!r.jid || SKIP.test(r.jid)) continue;
      const id = r.wa_id || 'db-' + r.id;
      const text = r.body || (r.media_url ? '📷 صورة' : '');
      const x = q.run(`INSERT OR IGNORE INTO msgs (tenant_id, jid, id, from_me, ts, type, text) VALUES (?, ?, ?, ?, ?, 'text', ?)`, tenantId, r.jid, id, r.direction === 'out' ? 1 : 0, r.created_at, text);
      if (!x.changes) continue;
      n++;
      q.run(`INSERT INTO chats (tenant_id, jid, last_ts, last_text, last_from_me) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id, jid) DO UPDATE SET
        last_text = CASE WHEN excluded.last_ts >= chats.last_ts THEN excluded.last_text ELSE chats.last_text END,
        last_from_me = CASE WHEN excluded.last_ts >= chats.last_ts THEN excluded.last_from_me ELSE chats.last_from_me END,
        last_ts = MAX(chats.last_ts, excluded.last_ts)`, tenantId, r.jid, r.created_at, text.slice(0, 160), r.direction === 'out' ? 1 : 0);
      if (r.name) q.run('INSERT INTO names (tenant_id, jid, push) VALUES (?, ?, ?) ON CONFLICT(tenant_id, jid) DO UPDATE SET push = COALESCE(names.push, excluded.push)', tenantId, r.jid, r.name);
    }
  });
  flag(tenantId, 'backfill', Date.now());
  return n;
}
