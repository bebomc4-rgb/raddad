// بيفك نسخة واتساب (msgstore.db.crypt15) وبيطلّع ملف: كل رقم + أول رسالة وآخر رسالة + عدد الرسائل + مين بلّش
// الاستعمال: node tools/wa-dates.mjs "<مجلد النسخة>"   (بالمجلد: msgstore.db.crypt15 + wa-key.txt)
// ما بيعدّل أي شي عند البوت: بس بيكتب ملف ko-chats-dates.csv بنفس مجلد النسخة
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DIR = process.argv[2] || path.join(process.env.USERPROFILE || '', 'Desktop', 'New folder (15)');
const TENANT = '1';
const LOG = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'data', 'wa-dates.log');
try { fs.writeFileSync(LOG, ''); } catch {}
const say = (...a) => { console.log(...a); try { fs.appendFileSync(LOG, a.join(' ') + '\n'); } catch {} };

const files = fs.readdirSync(DIR).filter(f => /^msgstore.*\.db\.crypt15$/.test(f)).sort((a, b) => (a === 'msgstore.db.crypt15' ? -1 : b === 'msgstore.db.crypt15' ? 1 : a.localeCompare(b)));
if (!files.length) { say('ما لقيت ملف msgstore.db.crypt15 بالمجلد:', DIR); process.exit(1); }
const keyTxt = (() => { for (const f of ['wa-key.txt', 'key.txt']) { try { return fs.readFileSync(path.join(DIR, f), 'utf8'); } catch {} } try { return fs.readFileSync(path.join(DATA, 'wa-key.txt'), 'utf8'); } catch {} return ''; })();
const hex = keyTxt.replace(/[^0-9a-fA-F]/g, '');
if (hex.length !== 64) { say('لازم تحط مفتاح الـ 64 رقم بملف wa-key.txt بنفس مجلد النسخة. (لقيت', hex.length, 'خانة)'); process.exit(1); }
const root = Buffer.from(hex, 'hex');

// مفتاح التشفير من مفتاح الـ 64 رقم (نفس طريقة واتساب)
function derive(rootKey, message, len = 32) {
  const prk = crypto.createHmac('sha256', Buffer.alloc(32)).update(rootKey).digest();
  let data = Buffer.alloc(0), out = Buffer.alloc(0);
  for (let i = 1; out.length < len; i++) { data = crypto.createHmac('sha256', prk).update(data).update(Buffer.from(message)).update(Buffer.from([i])).digest(); out = Buffer.concat([out, data]); }
  return out.subarray(0, len);
}
const KEY = derive(root, 'backup encryption');

function varint(b, o) { let r = 0, s = 0, x; do { x = b[o++]; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80); return [r, o]; }
function fields(b) { const out = []; let o = 0; while (o < b.length) { let k; [k, o] = varint(b, o); const f = Math.floor(k / 8), t = k & 7; if (t === 0) { let v; [v, o] = varint(b, o); out.push([f, t, v]); } else if (t === 2) { let l; [l, o] = varint(b, o); out.push([f, t, b.subarray(o, o + l)]); o += l; } else if (t === 1) { out.push([f, t, b.subarray(o, o + 8)]); o += 8; } else if (t === 5) { out.push([f, t, b.subarray(o, o + 4)]); o += 4; } else throw new Error('protobuf'); } return out; }
function findIV(pb) {
  for (const [f, t, v] of fields(pb)) if (t === 2 && f === 3) for (const [f2, t2, v2] of fields(v)) if (f2 === 1 && t2 === 2 && v2.length === 16) return v2;
  // احتياط: أي حقل طولو 16
  const walk = (b) => { try { for (const [, t, v] of fields(b)) { if (t === 2 && v.length === 16) return v; if (t === 2) { const r = walk(v); if (r) return r; } } } catch {} return null; };
  return walk(pb);
}
function decrypt(file) {
  const buf = fs.readFileSync(file);
  let o = 0; const pbLen = buf[o++]; if (buf[o] === 1) o++;
  const iv = findIV(buf.subarray(o, o + pbLen)); o += pbLen;
  if (!iv) throw new Error('ما لقيت IV بالملف');
  const body = buf.subarray(o);
  for (const tail of [32, 16]) {
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
      d.setAuthTag(body.subarray(body.length - tail, body.length - tail + 16));
      const plain = Buffer.concat([d.update(body.subarray(0, body.length - tail)), d.final()]);
      const db = zlib.inflateSync(plain);
      if (db.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('مو قاعدة بيانات');
      return db;
    } catch (e) { if (tail === 16) throw new Error('المفتاح غلط أو الملف تالف (' + e.message + ')'); }
  }
}


const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const book = readJ('wa-addressbook.json', {}), saved = readJ('wa-saved-contacts.json', {}), names = readJ('ko-names.json', {});
const nameOf = (p) => { const k = TENANT + ':' + p; return book[k] || names[k] || saved[k] || ''; };
const rows = new Map(); // رقم -> {first, last, count, starter}
for (const f of files) {
  say('عم فك:', f, '…');
  let dbBuf; try { dbBuf = decrypt(path.join(DIR, f)); } catch (e) { say('  ✗', e.message); continue; }
  const tmp = path.join(DATA, `_wa_dates_${Date.now()}.db`); fs.writeFileSync(tmp, dbBuf);
  try {
    const db = new DatabaseSync(tmp, { readOnly: true });
    const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    const jidMap = new Map();
    if (has('jid_map')) for (const r of db.prepare('SELECT m.lid_row_id l, j.user u, j.server s FROM jid_map m JOIN jid j ON j._id = m.jid_row_id').all()) if (r.s === 's.whatsapp.net') jidMap.set(r.l, r.u);
    const chats = db.prepare('SELECT c._id cid, j._id jid_id, j.user u, j.server s FROM chat c JOIN jid j ON j._id = c.jid_row_id').all();
    const st = db.prepare('SELECT MIN(timestamp) a, MAX(timestamp) b, COUNT(*) n FROM message WHERE chat_row_id = ? AND timestamp > 0');
    const first = db.prepare('SELECT from_me m FROM message WHERE chat_row_id = ? AND timestamp > 0 ORDER BY timestamp ASC LIMIT 1');
    for (const c of chats) {
      let p = '';
      if (c.s === 's.whatsapp.net') p = c.u; else if (c.s === 'lid') p = jidMap.get(c.jid_id) || ''; else continue;
      p = String(p || '').replace(/\D/g, ''); if (p.length < 8) continue;
      const s = st.get(c.cid); if (!s || !s.n) continue;
      const fm = first.get(c.cid);
      const old = rows.get(p);
      if (!old) rows.set(p, { first: s.a, last: s.b, count: s.n, starter: fm && fm.m ? 'إنت' : 'الزبون' });
      else { if (s.a < old.first) { old.first = s.a; old.starter = fm && fm.m ? 'إنت' : 'الزبون'; } old.last = Math.max(old.last, s.b); old.count += s.n; }
    }
    db.close();
  } catch (e) { say('  ✗ قراءة:', e.message); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
const pad = (n) => String(n).padStart(2, '0');
const day = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const list = [...rows.entries()].sort((a, b) => a[1].first - b[1].first);
const lines = ['الرقم,الاسم,أول رسالة,آخر رسالة,عدد الرسائل,مين بلّش المحادثة'];
for (const [p, r] of list) lines.push([q('+' + p), q(nameOf(p)), q(day(r.first)), q(day(r.last)), r.count, q(r.starter)].join(','));
const OUT = path.join(DIR, 'ko-chats-dates.csv');
fs.writeFileSync(OUT, '﻿' + lines.join('\r\n'), 'utf8');
if (list.length) { const [p, r] = list[0]; say(`أقدم محادثة: +${p} ${nameOf(p) ? '(' + nameOf(p) + ')' : ''} — أول رسالة ${day(r.first)}`); }
say(`✓ خلص: ${list.length} رقم بالملف ${OUT}`);
