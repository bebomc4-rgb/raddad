// الكمبيوتر هوي الأساسي والموبايل احتياط (صاحب المتجر، 29 تشرين الأول 2026):
// - الموبايل بيضل موصول بالواتس (كجهاز مربوط لحالو) وبيسجّل كل الرسائل، بس ما بيرد ولا بيبعت شي إلا إذا الكمبيوتر وقف.
// - كل 30 ثانية الموبايل بيسأل الرابط العام «مين شغّال؟». إذا الكمبيوتر ما جاوب دقيقة ونص → الموبايل بيستلم:
//   بيرد على الزباين وبيوجّه الرابط العام لعندو.
// - أول ما يرجع الكمبيوتر بيوجّه الرابط لعندو (وكل دقيقتين بيتأكد إنو الرابط إلو) → الموبايل بيرجع يسكت.
import { getSetting } from './db.js';

export const DEVICE = process.env.DEVICE_NAME || (process.platform === 'android' ? 'phone' : 'pc');
const STANDBY = DEVICE !== 'pc' && process.env.FAILOVER !== 'off';
let active = !STANDBY, downSince = 0;
export const isActive = () => active;
export const failoverStatus = () => ({ device: DEVICE, backup: STANDBY, active });

const linkUrl = () => String(process.env.FAILOVER_URL || getSetting('public_link', {}).last_url || '').replace(/\/$/, '');
async function whoIsLive() {
  const u = linkUrl(); if (!u) return null;
  try {
    const r = await fetch(u + '/api/whoami?t=' + Date.now(), { signal: AbortSignal.timeout(12000), headers: { 'cache-control': 'no-cache' } });
    const j = r.ok ? await r.json().catch(() => null) : null;
    return j && j.device ? j.device : null;
  } catch { return null; }
}

// على الموبايل: بيراقب الكمبيوتر وبيستلم/بيسلّم
export function startFailover(onChange) {
  if (!STANDBY) return;
  console.log('[failover] this device is the backup: it replies only while the PC is off');
  const tick = async () => {
    const pcUp = (await whoIsLive()) === 'pc';
    if (pcUp) { downSince = 0; if (active) { active = false; console.log('[failover] PC is back — the phone goes quiet'); onChange(false); } return; }
    downSince ||= Date.now();
    if (!active && Date.now() - downSince >= 90_000) { active = true; console.log('[failover] PC is off — the phone takes over'); onChange(true); }
  };
  tick(); setInterval(tick, 30_000);
}

// على الكمبيوتر: إذا لقى الرابط العام موجّه عالموبايل (يعني الكمبيوتر رجع)، بيرجّعو لعندو
export function startPrimaryWatch(republish) {
  if (STANDBY) return;
  setInterval(async () => {
    const who = await whoIsLive();
    if (who && who !== 'pc') { console.log('[failover] the public link points to the backup — taking it back'); republish(); }
  }, 120_000);
}
