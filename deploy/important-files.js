// الملفات المهمة بس (بدون صور وصوت المحادثات): الهوية/اللوغو + كل صورة بالـ uploads مذكورة بالمنتجات أو الإعدادات أو أي جدول غير الرسائل
// بيطبع مسارات نسبةً لمجلد data — بيستعملو move-from-pc (Mode important)
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const out = new Set();
const walk = (rel) => { const abs = path.join(DATA, rel); if (!fs.existsSync(abs)) return; for (const e of fs.readdirSync(abs, { withFileTypes: true })) { const r = rel + '/' + e.name; if (e.isDirectory()) walk(r); else out.add(r); } };
walk('brand');
const db = new DatabaseSync(path.join(DATA, 'raddad.db'));
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('messages','sqlite_sequence')").all().map(r => r.name);
const re = /uploads\/([^"'\s?#)<>\\]+)/g;
const scan = s => { for (const m of String(s).matchAll(re)) { let n; try { n = decodeURIComponent(m[1]); } catch { n = m[1]; } n = path.basename(n); if (fs.existsSync(path.join(DATA, 'uploads', n))) out.add('uploads/' + n); } };
for (const t of tables) for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) for (const v of Object.values(row)) if (typeof v === 'string' && v.includes('uploads/')) scan(v);
for (const f of fs.readdirSync(DATA)) if (f.endsWith('.json')) try { scan(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch {}
const txt = [...out].join('\n') + '\n';
console.error(`files: ${out.size} (data: ${DATA})`);
if (process.argv[2]) fs.writeFileSync(process.argv[2], txt); else process.stdout.write(txt);
