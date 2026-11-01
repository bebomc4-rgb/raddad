// صاحب المتجر (1 تشرين التاني 2026): المجيب صار على السيرفر. الكمبيوتر والموبايل لازم ما يشتغلوا أبداً
// (نفس ربط الواتساب ما بيشتغل بمكانين). هالملف أول شي بينقرا بـ server.js: إذا الجهاز مو السيرفر وفي
// data/moved-to-server أو deploy/server-only → بيوقف هون وما بيشغّل لا واتساب ولا رابط ولا شي.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = process.env.DEVICE_NAME || (process.platform === 'android' ? 'phone' : 'pc');
const DATA = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const off = DEV !== 'server' && (fs.existsSync(path.join(DATA, 'moved-to-server')) || fs.existsSync(path.join(ROOT, 'deploy', 'server-only')));
if (off) {
  console.log(`[off] ${new Date().toISOString()} the bot runs on the server now — this ${DEV} stays off (no WhatsApp, no link)`);
  setInterval(() => {}, 1 << 30); // منضل ساكتين بدل ما نطلع (حلقة إعادة التشغيل كانت رح ترجّعنا كل 3 ثواني)
  await new Promise(() => {});
}
