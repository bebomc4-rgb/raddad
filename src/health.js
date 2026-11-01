// صحة السيرفر: الرام، الذاكرة الاحتياطية، المعالج، تأخير الرد — ومتى لازم تكبّر
import fs from 'node:fs';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { isActive } from './failover.js';

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
  return { level, say, memPct, memUsed: m.used, memTotal: m.total, swapUsed: m.swapUsed, swapTotal: m.swapTotal, cpuPct, cores, lagMs, stores, room, uptime: Math.round(os.uptime()) };
}
// كل دقيقتين؛ إذا الضغط ضل 3 مرات ورا بعض → رسالة واتساب إلك (مرة كل 6 ساعات بالكتير)
let bad = 0, lastAlert = 0;
setInterval(async () => {
  if (!isActive()) return;
  try {
    const h = await health();
    bad = h.level === 'ok' ? 0 : bad + 1;
    if (bad >= 3 && Date.now() - lastAlert > 6 * 3600_000) {
      lastAlert = Date.now();
      const { notifyAdmin } = await import('./notify.js');
      await notifyAdmin(`⚠️ سيرفر K FAST AI: ${h.say}\nالرام ${h.memPct}% · المعالج ${h.cpuPct}% · المتاجر المربوطة ${h.stores}`);
    }
  } catch {}
}, 120_000).unref();
