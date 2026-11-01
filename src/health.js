// صحة السيرفر: الرام، الذاكرة الاحتياطية، المعالج، تأخير الرد — ومتى لازم تكبّر
import fs from 'node:fs';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import path from 'node:path';
import { isActive } from './failover.js';
import { DATA_DIR } from './config.js';

// سجل فترات الضغط: إيمتى بلّش، إيمتى خلص، وأعلى رقم وصلو
const LOG = path.join(DATA_DIR, 'health-log.json');
let episodes = []; try { episodes = JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch {}
const saveLog = () => { try { fs.writeFileSync(LOG, JSON.stringify(episodes.slice(-200))); } catch {} };
let cur = null; // الفترة الحالية إذا في ضغط هلق
export const pressureLog = () => [...episodes].reverse().slice(0, 30);

const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
function mem() {
  try {
    const t = fs.readFileSync('/proc/meminfo', 'utf8'), v = k => Number((t.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')) || [])[1] || 0) * 1024;
    const total = v('MemTotal'), avail = v('MemAvailable'), sT = v('SwapTotal'), sF = v('SwapFree');
    return { total, used: total - avail, swapTotal: sT, swapUsed: sT - sF };
  } catch { const total = os.totalmem(); return { total, used: total - os.freemem(), swapTotal: 0, swapUsed: 0 }; }
}
export async function health() {
  const m = mem(), cores = os.cpus().length || 1, load = os.loadavg()[0];
  let stores = 0; try { stores = (await import('./whatsapp/baileys.js')).openCount(); } catch {}
  const memPct = Math.round((m.used / m.total) * 100), cpuPct = Math.round((load / cores) * 100);
  const lagMs = Math.round((lag.mean || 0) / 1e6) || 0; lag.reset();
  const perStore = stores ? Math.max(40e6, (m.used - 600e6) / stores) : 120e6;
  const room = Math.max(0, Math.floor((m.total * 0.8 - m.used) / perStore));
  let level = 'ok', say = 'السيرفر مرتاح 👌';
  if (memPct >= 80 || cpuPct >= 150 || m.swapUsed > 800e6 || lagMs > 500) { level = 'bad'; say = 'في ضغط! كبّر السيرفر هلق (من لوحة الشركة ← Upgrade).'; }
  else if (memPct >= 65 || cpuPct >= 100 || m.swapUsed > 300e6 || lagMs > 200) { level = 'warn'; say = 'قرّب من الحد، فكّر تكبّر قريباً.'; }
  return { log: pressureLog(), now: cur, level, say, memPct, memUsed: m.used, memTotal: m.total, swapUsed: m.swapUsed, swapTotal: m.swapTotal, cpuPct, cores, lagMs, stores, room, uptime: Math.round(os.uptime()) };
}
// كل دقيقة منسجّل: إذا في ضغط بتنفتح «فترة»، ولما يروح الضغط بتتسكّر ومنحسب قديش طوّلت
// إذا الضغط ضل 6 دقايق → رسالة واتساب إلك (مرة كل 6 ساعات بالكتير)، ولما يخلص رسالة «خلص الضغط بعد كذا دقيقة»
const dmTime = t => new Date(t).toLocaleString('ar-SY', { timeZone: 'Asia/Damascus', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'numeric' });
let lastAlert = 0;
setInterval(async () => {
  if (!isActive()) return;
  try {
    const h = await health(), now = Date.now();
    if (h.level !== 'ok') {
      if (!cur) { cur = { start: now, end: null, level: h.level, peakMem: h.memPct, peakCpu: h.cpuPct, stores: h.stores }; episodes.push(cur); }
      cur.end = now; if (h.level === 'bad') cur.level = 'bad';
      cur.peakMem = Math.max(cur.peakMem, h.memPct); cur.peakCpu = Math.max(cur.peakCpu, h.cpuPct); cur.stores = Math.max(cur.stores, h.stores);
      cur.minutes = Math.round((now - cur.start) / 60000); saveLog();
      if (cur.minutes >= 6 && !cur.alerted && now - lastAlert > 6 * 3600_000) {
        lastAlert = now; cur.alerted = true; saveLog();
        const { notifyAdmin } = await import('./notify.js');
        await notifyAdmin(`⚠️ سيرفر K FAST AI: ${h.say}\nبلّش الضغط الساعة ${dmTime(cur.start)} وصرلو ${cur.minutes} دقيقة\nالرام ${h.memPct}% · المعالج ${h.cpuPct}% · المتاجر ${h.stores}`);
      }
    } else if (cur) {
      const done = cur; cur = null;
      done.end = now; done.minutes = Math.max(1, Math.round((now - done.start) / 60000)); saveLog();
      if (done.alerted) { const { notifyAdmin } = await import('./notify.js'); await notifyAdmin(`✅ خلص الضغط عالسيرفر. بلّش ${dmTime(done.start)} وطوّل ${done.minutes} دقيقة (أعلى رام ${done.peakMem}%).`); }
    }
  } catch {}
}, 60_000).unref();
