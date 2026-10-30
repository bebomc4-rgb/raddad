// تجربة قارئ النسخة الاحتياطية على نسخة مزيّفة بنفس شكل واتساب (ما بتلمس أي بيانات حقيقية)
// الاستعمال: node tools/test-wa-backup.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { readWhatsAppBackup } from '../public/next/wa-backup.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wabk-'));
const dbFile = path.join(dir, 'msgstore.db');
const db = new DatabaseSync(dbFile);
db.exec('PRAGMA page_size = 4096; PRAGMA journal_mode = DELETE;');
const chatCols = Array.from({ length: 42 }, (_, i) => `c${i} INTEGER`).join(', ');
db.exec(`
  CREATE TABLE jid (_id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT NOT NULL, server TEXT NOT NULL, agent INTEGER, device INTEGER, type INTEGER, raw_string TEXT);
  CREATE TABLE chat (_id INTEGER PRIMARY KEY AUTOINCREMENT, jid_row_id INTEGER UNIQUE, hidden INTEGER, subject TEXT, created_timestamp INTEGER, ${chatCols});
  CREATE TABLE jid_map (lid_row_id INTEGER PRIMARY KEY, jid_row_id INTEGER, sort_id INTEGER);
  CREATE TABLE message (_id INTEGER PRIMARY KEY AUTOINCREMENT, chat_row_id INTEGER, from_me INTEGER, key_id TEXT, sender_jid_row_id INTEGER, status INTEGER, timestamp INTEGER, text_data TEXT);
  CREATE INDEX message_chat ON message(chat_row_id, timestamp);
`);
// جداول كتير متل واتساب (مشان sqlite_master يصير كذا صفحة)
for (let i = 0; i < 160; i++) db.exec(`CREATE TABLE extra_${i} (_id INTEGER PRIMARY KEY, ${Array.from({ length: 25 }, (_, k) => `some_long_column_name_${k}_${i} TEXT DEFAULT 'x'`).join(', ')}); CREATE INDEX extra_${i}_idx ON extra_${i}(some_long_column_name_1_${i});`);

const rnd = n => Math.floor(Math.random() * n);
const phone = () => '9639' + String(10000000 + rnd(89999999));
const insJ = db.prepare('INSERT INTO jid (user, server, agent, device, type, raw_string) VALUES (?, ?, 0, 0, 0, ?)');
const insC = db.prepare(`INSERT INTO chat (jid_row_id, hidden, subject, created_timestamp) VALUES (?, 0, ?, ?)`);
const insM = db.prepare('INSERT INTO message (chat_row_id, from_me, key_id, sender_jid_row_id, status, timestamp, text_data) VALUES (?, ?, ?, ?, 0, ?, ?)');
const insMap = db.prepare('INSERT INTO jid_map (lid_row_id, jid_row_id, sort_id) VALUES (?, ?, 0)');
db.exec('BEGIN');
const chatsIds = [];
for (let i = 0; i < 6000 * (Number(process.env.SCALE) || 1); i++) {
  const kind = rnd(10);
  if (kind < 6) { // محادثة فردية برقم
    const u = phone(); const j = Number(insJ.run(u, 's.whatsapp.net', u + '@s.whatsapp.net').lastInsertRowid);
    chatsIds.push(Number(insC.run(j, null, Date.now()).lastInsertRowid));
  } else if (kind < 8) { // محادثة برقم مخفي (LID) مع ربط لرقم
    const u = phone(); const pn = Number(insJ.run(u, 's.whatsapp.net', u + '@s.whatsapp.net').lastInsertRowid);
    const lid = Number(insJ.run(String(100000000000000 + rnd(1e9)), 'lid', null).lastInsertRowid);
    if (rnd(5)) insMap.run(lid, pn); // بعضهن بلا ربط
    chatsIds.push(Number(insC.run(lid, null, Date.now()).lastInsertRowid));
  } else if (kind < 9) { // غروب + أعضاء ما إلهن محادثة
    const g = Number(insJ.run('120363' + rnd(1e9), 'g.us', null).lastInsertRowid);
    chatsIds.push(Number(insC.run(g, 'مجموعة '.repeat(1 + rnd(20)), Date.now()).lastInsertRowid));
    for (let k = 0; k < 5; k++) { const u = phone(); insJ.run(u, 's.whatsapp.net', null); }
  } else { // رقم بلا محادثة (حالة/مكالمة)
    const u = phone(); insJ.run(u, 's.whatsapp.net', null);
  }
  for (let k = 0; k < 25; k++) insM.run(chatsIds[rnd(chatsIds.length)] || 1, rnd(2), crypto.randomBytes(8).toString('hex'), null, Date.now(), 'رسالة تجربة '.repeat(1 + rnd(6)));
}
db.exec('COMMIT');
db.exec('DELETE FROM message WHERE _id % 7 = 0'); // صفحات فاضية بقاعدة البيانات (متل الحقيقة)
// الجواب الصحيح بنفس طريقة tools/wa-import.mjs
const map = new Map(db.prepare("SELECT m.lid_row_id l, j.user u, j.server s FROM jid_map m JOIN jid j ON j._id = m.jid_row_id").all().filter(r => r.s === 's.whatsapp.net').map(r => [r.l, r.u]));
const truth = new Set();
for (const c of db.prepare('SELECT j._id id, j.user u, j.server s FROM chat c JOIN jid j ON j._id = c.jid_row_id').all()) {
  const p = c.s === 's.whatsapp.net' ? c.u : c.s === 'lid' ? map.get(c.id) || '' : '';
  if (p && p.length >= 8) truth.add(p);
}
db.close();

// تشفير بنفس شكل crypt15
const keyHex = crypto.randomBytes(32).toString('hex');
const prk = crypto.createHmac('sha256', Buffer.alloc(32)).update(Buffer.from(keyHex, 'hex')).digest();
const aesKey = crypto.createHmac('sha256', prk).update(Buffer.concat([Buffer.from('backup encryption'), Buffer.from([1])])).digest();
function makeCrypt15(withMd5) {
  const iv = crypto.randomBytes(16);
  const inner = Buffer.concat([Buffer.from([0x0a, 16]), iv]);
  const pb = Buffer.concat([Buffer.from([0x08, 1]), Buffer.from([0x1a, inner.length]), inner, Buffer.from([0x22, 3]), Buffer.from('2.2')]);
  const c = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const enc = Buffer.concat([c.update(zlib.deflateSync(fs.readFileSync(dbFile))), c.final()]);
  const parts = [Buffer.from([pb.length, 1]), pb, enc, c.getAuthTag()];
  if (withMd5) parts.push(crypto.randomBytes(16));
  const f = path.join(dir, withMd5 ? 'a.crypt15' : 'b.crypt15');
  fs.writeFileSync(f, Buffer.concat(parts));
  return f;
}

let fail = 0;
for (const withMd5 of [true, false]) {
  const f = makeCrypt15(withMd5);
  const t0 = Date.now();
  const res = await readWhatsAppBackup(await fs.openAsBlob(f), keyHex.replace(/(.{4})/g, '$1 '), { onProgress: () => {} });
  const got = new Set(res.numbers);
  const missing = [...truth].filter(x => !got.has(x)), extra = [...got].filter(x => !truth.has(x));
  const ok = !missing.length && !extra.length;
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${withMd5 ? 'مع' : 'بدون'} ختم MD5: ${got.size} رقم (المتوقع ${truth.size})، محادثات ${res.chats}، مخفية ${res.hidden}، ${Date.now() - t0}ms، حجم ${(fs.statSync(f).size / 1e6).toFixed(1)}MB${ok ? '' : ` ناقص ${missing.length} زيادة ${extra.length}`}`);
}
try { await readWhatsAppBackup(await fs.openAsBlob(path.join(dir, 'a.crypt15')), crypto.randomBytes(32).toString('hex')); console.log('✗ مفتاح غلط ما انكشف'); fail++; }
catch (e) { console.log(e.code === 'bad_key' ? '✓ مفتاح غلط انكشف' : `✗ مفتاح غلط: ${e.code} ${e.message}`); if (e.code !== 'bad_key') fail++; }
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
