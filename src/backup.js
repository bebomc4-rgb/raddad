// نسخة احتياطية يومية لبيانات المجيب على GitHub (مستودع خاص bebomc4-rgb/raddad-backup) — صاحب المتجر، 1 تشرين التاني 2026
// - كل يوم الساعة 4 الصبح بتوقيت دمشق (وأول ما يشتغل السيرفر إذا آخر نسخة أقدم من يوم)
// - بتنحفظ آخر 7 أيام، كل يوم ملف YYYY-MM-DD.tgz (القاعدة + الإعدادات + الحسابات + الأسماء). المستودع ما بيكبر (منرفع نسخة وحدة فوق القديمة)
// - ما فيها ربط الواتساب (wa-sessions) ولا الصور: إذا رجّعت النسخة بتربط الواتس من جديد بكود، وصور KO من الموقع
// - السيرفر بيعمل مفتاح خاص فيه (data/backup-key)، وصاحب المتجر بيضيف المفتاح العام كـ Deploy key مع صلاحية كتابة
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA_DIR } from './config.js';
import { db } from './db.js';

const REPO = 'git@github.com:bebomc4-rgb/raddad-backup.git';
const KEEP = 7;
const KDIR = path.join(DATA_DIR, 'backup-key'), KEY = path.join(KDIR, 'id_ed25519');
const WORK = path.join(DATA_DIR, 'backup-repo');
const STATUS = path.join(DATA_DIR, 'backup-status.json');
const SKIP = new Set(['wa-sessions', 'uploads', 'auto-src', 'auto-out', 'backups', 'backup-key', 'backup-repo', 'exports', 'raddad.db', 'raddad.db-wal', 'raddad.db-shm']);

export function backupKey() {
  try {
    if (!fs.existsSync(KEY)) { fs.mkdirSync(KDIR, { recursive: true, mode: 0o700 }); execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'k-fast-ai-server-backup', '-f', KEY], { stdio: 'ignore' }); }
    return fs.readFileSync(KEY + '.pub', 'utf8').trim();
  } catch (e) { return 'error: ' + e.message; }
}
export function backupStatus() { try { return JSON.parse(fs.readFileSync(STATUS, 'utf8')); } catch { return {}; } }
const setStatus = o => { try { fs.writeFileSync(STATUS, JSON.stringify({ ...backupStatus(), ...o })); } catch {} };

let running = false;
export async function runBackup() {
  if (running) return; running = true;
  const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  try {
    backupKey();
    fs.mkdirSync(WORK, { recursive: true });
    const tmp = path.join(DATA_DIR, '.backup-tmp'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
    db.exec(`VACUUM INTO '${path.join(tmp, 'raddad.db').replace(/'/g, "''")}'`); // نسخة متماسكة من القاعدة وهي شغّالة
    const items = fs.readdirSync(DATA_DIR).filter(f => !SKIP.has(f) && !f.startsWith('.') && !/\.log$|^backup-|^auto-test|\.pid$|\.tgz$/.test(f));
    const out = path.join(WORK, `${day}.tgz`);
    execFileSync('tar', ['czf', out, '-C', tmp, 'raddad.db', '-C', DATA_DIR, ...items], { stdio: 'ignore' });
    fs.rmSync(tmp, { recursive: true, force: true });
    const files = fs.readdirSync(WORK).filter(f => /^\d{4}-\d{2}-\d{2}\.tgz$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.rmSync(path.join(WORK, f));
    fs.writeFileSync(path.join(WORK, 'README.md'), `# نسخة احتياطية لبيانات K FAST AI\n\nآخر ${KEEP} أيام. كل ملف = مجلد data (بدون ربط الواتساب والصور).\nللإرجاع: فك الملف جوّا /opt/raddad/data عالسيرفر، وبعدين اربط الواتساب من لوحة التحكم.\n`);
    const env = { ...process.env, GIT_SSH_COMMAND: `ssh -i ${KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${path.join(KDIR, 'known_hosts')}` };
    const g = (...a) => execFileSync('git', ['-C', WORK, ...a], { env, stdio: 'pipe', timeout: 10 * 60_000 });
    fs.rmSync(path.join(WORK, '.git'), { recursive: true, force: true });
    g('init', '-q', '-b', 'main'); g('-c', 'user.name=k-fast-ai', '-c', 'user.email=backup@k-fast-ai', 'add', '-A');
    g('-c', 'user.name=k-fast-ai', '-c', 'user.email=backup@k-fast-ai', 'commit', '-q', '-m', `backup ${day}`);
    g('push', '-q', '-f', REPO, 'main');
    const size = Math.round(fs.statSync(out).size / 1048576 * 10) / 10;
    setStatus({ ok: true, at: new Date().toISOString(), day, size_mb: size, error: null });
    console.log(`[backup] ${day}: saved to GitHub (${size} MB, last ${KEEP} days kept)`);
  } catch (e) {
    const msg = String(e.stderr || e.message || e).slice(0, 300);
    setStatus({ ok: false, failed_at: new Date().toISOString(), error: msg });
    console.error('[backup] failed:', msg);
  } finally { running = false; }
}

export function startBackups() {
  backupKey();
  let first = true;
  const tick = () => {
    const st = backupStatus(), last = st.ok && st.at ? Date.parse(st.at) : 0;
    const hour = new Date(Date.now() + 3 * 3600_000).getUTCHours();
    const failedRecently = !first && st.failed_at && Date.now() - Date.parse(st.failed_at) < 30 * 60_000;
    if ((Date.now() - last > 24 * 3600_000 || (hour === 4 && Date.now() - last > 20 * 3600_000)) && !failedRecently) runBackup();
    first = false;
  };
  setTimeout(tick, 2 * 60_000);
  setInterval(tick, 15 * 60_000).unref();
}
