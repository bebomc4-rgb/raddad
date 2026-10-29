// يفك نسخة واتساب (msgstore.db.crypt15) بمفتاح الـ 64 رقم، ويطلّع كل أرقام المحادثات ورسائل الناس (مشان أسماءهن)
// الاستعمال: node tools/wa-import.mjs "<مجلد النسخة>"   (بالمجلد: msgstore.db.crypt15 + wa-key.txt)
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
const LOG = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'data', 'wa-import.log');
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
const hist = readJ('wa-history-numbers.json', {}), texts = readJ('wa-history-texts.json', {});
const numSet = new Set(hist[TENANT] || []); const n0 = numSet.size;
let chatsN = 0, lidN = 0, msgN = 0;

for (const f of files) {
  say('عم فك:', f, '…');
  let dbBuf; try { dbBuf = decrypt(path.join(DIR, f)); } catch (e) { say('  ✗', e.message); continue; }
  const tmp = path.join(DATA, `_wa_tmp_${Date.now()}.db`); fs.writeFileSync(tmp, dbBuf);
  try {
    const db = new DatabaseSync(tmp, { readOnly: true });
    const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    const jidMap = new Map();
    if (has('jid_map')) for (const r of db.prepare('SELECT m.lid_row_id l, j.user u, j.server s FROM jid_map m JOIN jid j ON j._id = m.jid_row_id').all()) if (r.s === 's.whatsapp.net') jidMap.set(r.l, r.u);
    const chats = db.prepare('SELECT c._id cid, j._id jid_id, j.user u, j.server s FROM chat c JOIN jid j ON j._id = c.jid_row_id').all();
    const phoneOf = new Map();
    for (const c of chats) {
      let p = '';
      if (c.s === 's.whatsapp.net') p = c.u; else if (c.s === 'lid') { p = jidMap.get(c.jid_id) || ''; if (p) lidN++; } else continue;
      p = String(p || '').replace(/\D/g, ''); if (p.length < 9) continue;
      phoneOf.set(c.cid, p); numSet.add(p); chatsN++;
    }
    if (has('message')) {
      const q = db.prepare("SELECT text_data t FROM message WHERE chat_row_id = ? AND from_me = 0 AND text_data IS NOT NULL AND text_data != '' ORDER BY timestamp ASC");
      for (const [cid, p] of phoneOf) {
        const all = q.all(cid).map(r => String(r.t).slice(0, 400)); if (!all.length) continue;
        const pick = all.length > 60 ? [...all.slice(0, 40), ...all.slice(-20)] : all;
        const k = TENANT + ':' + p, arr = texts[k] = texts[k] || [];
        for (const t of pick) if (!arr.includes(t) && arr.length < 80) { arr.push(t); msgN++; }
      }
    }
    db.close();
  } catch (e) { say('  ✗ قراءة:', e.message); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
hist[TENANT] = [...numSet];
fs.writeFileSync(path.join(DATA, 'wa-history-numbers.json'), JSON.stringify(hist));
fs.writeFileSync(path.join(DATA, 'wa-history-texts.json'), JSON.stringify(texts));
say(`✓ خلص: ${chatsN} محادثة (منها ${lidN} برقم مخفي)، ${numSet.size - n0} رقم جديد ما كان عند البوت، ${msgN} رسالة لتفتيش الأسماء.`);
say('هلق البوت بيقوم وبيسجّل الأرقام الجديدة وبيلقط الأسماء لحالو.');
