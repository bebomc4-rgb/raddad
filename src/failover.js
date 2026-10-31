// مين الأساسي ومين الاحتياط (صاحب المتجر، 31 تشرين الأول 2026): **الموبايل هوي الأساسي، والكمبيوتر احتياط**.
// (بتنغيّر من الإعداد primary_device = 'pc' أو 'phone'، أو من متغيّر PRIMARY_DEVICE)
// - الاحتياط بيضل موصول بالواتس وبيسجّل كل شي، بس ما بيرد ولا بيبعت إلا إذا الأساسي وقف.
// - الاحتياط بيسأل الرابط العام «مين شغّال؟» كل ثانيتين. إذا الأساسي ما جاوب مرتين ورا بعض (~5 ثواني) → بيستلم:
//   بيرد على الزباين وبيوجّه الرابط العام لعندو (نفقو جاهز من قبل).
// - أول ما يرجع الأساسي بيوجّه الرابط لعندو → الاحتياط بيرجع يسكت خلال 10 ثواني.
import { getSetting } from './db.js';

export const DEVICE = process.env.DEVICE_NAME || (process.platform === 'android' ? 'phone' : 'pc');
const pickPrimary = () => { if (['pc', 'phone'].includes(process.env.PRIMARY_DEVICE)) return process.env.PRIMARY_DEVICE; try { const v = getSetting('primary_device', 'phone'); return ['pc', 'phone'].includes(v) ? v : 'phone'; } catch { return 'phone'; } };
export const PRIMARY = pickPrimary();
const STANDBY = DEVICE !== PRIMARY && process.env.FAILOVER !== 'off';
let active = !STANDBY, downSince = 0;
export const isActive = () => active;
export const failoverStatus = () => ({ device: DEVICE, primary: PRIMARY, backup: STANDBY, active });
const NAME = { pc: 'PC', phone: 'phone' };

const linkUrl = () => String(process.env.FAILOVER_URL || getSetting('public_link', {}).last_url || '').replace(/\/$/, '');
export async function whoIsLive(ms = 12000) {
  const u = linkUrl(); if (!u) return null;
  try {
    const r = await fetch(u + '/api/whoami?t=' + Date.now(), { signal: AbortSignal.timeout(ms), headers: { 'cache-control': 'no-cache' } });
    const j = r.ok ? await r.json().catch(() => null) : null;
    return j && j.device ? j.device : null;
  } catch { return null; }
}

// على الموبايل: بيراقب الكمبيوتر وبيستلم/بيسلّم
export function startFailover(onChange) {
  if (!STANDBY) return;
  console.log(`[failover] this device (${NAME[DEVICE]}) is the backup: it replies only while the ${NAME[PRIMARY]} is off`);
  // كل ثانيتين منسأل؛ إذا الكمبيوتر ما جاوب مرتين ورا بعض (والموبايل نفسو فيه نت) → الموبايل بيستلم خلال ~5 ثواني
  let busy = false, misses = 0, n = 0;
  const tick = async () => {
    if (busy || (active && ++n % 5)) return; // وهوي شغّال: كل 10 ثواني بيكفي ليعرف إنو الكمبيوتر رجع
    busy = true;
    try {
      const who = await whoIsLive(active ? 8000 : 2500), pcUp = who === PRIMARY;
      if (pcUp) { misses = 0; downSince = 0; if (active) { active = false; console.log(`[failover] ${new Date().toISOString()} the ${NAME[PRIMARY]} (main) is back — the ${NAME[DEVICE]} goes quiet`); onChange(false); } import('./sync.js').then(m => m.pullFromPC(linkUrl())).catch(() => {}); return; }
      if (active) return;
      if (who === DEVICE) { active = true; misses = 0; console.log(`[failover] ${new Date().toISOString()} the link already points to the ${NAME[DEVICE]} — it takes over`); onChange(true); return; }
      if (!(await online())) { misses = 0; return; } // النت عند الموبايل نفسو مقطوع: ما منستلم شي
      downSince ||= Date.now();
      if (++misses >= 2) { active = true; misses = 0; console.log(`[failover] ${new Date().toISOString()} the ${NAME[PRIMARY]} (main) is off — the ${NAME[DEVICE]} takes over`); onChange(true); }
    } finally { busy = false; }
  };
  tick(); setInterval(tick, 2000);
}

// في نت؟ (منسأل Cloudflare نفسها، لأنو الرابط العام كلو عليها)
async function online() {
  try { await fetch('https://www.cloudflare.com/cdn-cgi/trace?t=' + Date.now(), { signal: AbortSignal.timeout(10000) }); return true; }
  catch { return false; }
}

// على الكمبيوتر، كل دقيقتين:
// - إذا لقى الرابط العام موجّه عالموبايل (يعني الكمبيوتر رجع)، بيرجّعو لعندو
// - إذا الرابط ما عم يجاوب أبداً والنت شغّال (النفق المؤقت مات، بيصير بعد ما ينقطع النت ويرجع
//   وبيطلع خطأ 1016 أو 530)، مرتين ورا بعض → بيعمل نفق جديد وبيحدّث الرابط لحالو
export function startPrimaryWatch(republish) {
  if (STANDBY) return;
  let dead = 0;
  setInterval(async () => {
    const who = await whoIsLive();
    if (who) {
      dead = 0;
      if (who !== DEVICE) { console.log(`[failover] ${new Date().toISOString()} the public link points to the backup — taking it back`); republish(); }
      return;
    }
    if (!linkUrl() || !(await online())) return;
    if (++dead < 2) return;
    dead = 0;
    console.log('[failover] the public link is not answering (tunnel died) — starting a new tunnel');
    republish();
  }, 60_000);
}
