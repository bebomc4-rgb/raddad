// فحص قارئ النسخة الاحتياطية الجديد (نفس يلي بيشتغل بمتصفح الزبون) على نسختك الحقيقية. ما بيعدّل ولا بيحفظ شي.
// الاستعمال: node tools/wa-check-backup.mjs "<مجلد النسخة>"   (بالمجلد: msgstore.db.crypt15 + wa-key.txt)
import fs from 'node:fs';
import path from 'node:path';
import { readWhatsAppBackup } from '../public/next/wa-backup.js';

const DIR = process.argv[2] || path.join(process.env.USERPROFILE || '', 'Downloads');
const file = path.join(DIR, 'msgstore.db.crypt15');
let key = '';
for (const f of ['wa-key.txt', 'key.txt']) { try { key = fs.readFileSync(path.join(DIR, f), 'utf8'); break; } catch {} }
if (!fs.existsSync(file)) { console.log('ما لقيت msgstore.db.crypt15 بـ', DIR); process.exit(1); }
if (!key) { console.log('حط المفتاح بملف wa-key.txt بنفس المجلد'); process.exit(1); }
const t0 = Date.now(); let last = -1;
try {
  const res = await readWhatsAppBackup(await fs.openAsBlob(file), key, {
    onProgress: ({ stage, fraction }) => { const p = Math.floor(fraction * 10); if (p !== last) { last = p; process.stdout.write(`\rالجولة ${stage}: ${p * 10}%   `); } }
  });
  console.log(`\n✓ خلص بـ ${((Date.now() - t0) / 1000).toFixed(1)} ثانية: ${res.numbers.length} رقم من ${res.chats} محادثة (منها ${res.hidden} برقم مخفي).`);
} catch (e) { console.log('\n✗', e.message); process.exit(1); }
