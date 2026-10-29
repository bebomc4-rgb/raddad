// رابط عام ثابت ببلاش: cloudflared (رابط مؤقت trycloudflare) + Worker على workers.dev بيحوّل لعنده
// كل ما يتغيّر الرابط المؤقت، منحدّث الـ Worker لحاله
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './config.js';
import { getSetting, setSetting } from './db.js';
import { decrypt } from './security.js';

const WIN = process.platform === 'win32';
const BIN = WIN ? path.join(ROOT, 'bin', 'cloudflared.exe') : 'cloudflared'; // على الموبايل (Termux) أو لينكس: cloudflared المنزّل بـ pkg
const DL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
export const status = { state: 'off', target: null, publicUrl: null, error: null };
let child = null;

function cfg() { return getSetting('public_link', {}); }

async function ensureBinary() {
  if (!WIN) return; // (pkg install cloudflared)
  if (fs.existsSync(BIN) && fs.statSync(BIN).size > 1e6) return;
  status.state = 'downloading';
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  const res = await fetch(DL, { redirect: 'follow' });
  if (!res.ok) throw new Error('ما قدرت نزّل cloudflared (' + res.status + ')');
  fs.writeFileSync(BIN + '.tmp', Buffer.from(await res.arrayBuffer()));
  fs.renameSync(BIN + '.tmp', BIN);
}

const WORKER = target => `const P = {
  async fetch(req, env, ctx) {
    // ملفات ثابتة (عليها رقم نسخة، أو صور /uploads/): منحفظها بـ Cloudflare، فما بتنطلب من الكمبيوتر إلا مرة وحدة
    const pu = new URL(req.url);
    const edge = req.method === 'GET' && (pu.searchParams.has('v') || pu.pathname.startsWith('/uploads/')) ? caches.default : null;
    if (edge) { const hit = await edge.match(req.url); if (hit) return hit; }
    const res = await P.pass(req);
    if (edge && res.status === 200 && /public/.test(res.headers.get('cache-control') || '')) ctx.waitUntil(edge.put(req.url, res.clone()));
    return res;
  },
  async pass(req) {
    const u = new URL(req.url); const t = new URL(${JSON.stringify(target)});
    const host = u.host; u.protocol = 'https:'; u.hostname = t.hostname; u.port = '';
    const h = new Headers(req.headers); h.delete('host'); h.set('x-forwarded-host', host); h.set('x-forwarded-proto', 'https');
    const init = { method: req.method, headers: h, redirect: 'manual' };
    if (!['GET', 'HEAD'].includes(req.method)) init.body = req.body;
    try { return await fetch(u.toString(), init); }
    catch (e) { return new Response('المنصة عم تعيد التشغيل… جرّب بعد ثواني', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
  }
};
export default P;`;

async function cfApi(token, method, url, body, headers = {}) {
  const res = await fetch('https://api.cloudflare.com/client/v4' + url, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, body });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.success === false) throw new Error(d?.errors?.[0]?.message || `Cloudflare ${res.status}`);
  return d.result;
}

async function publish(target) {
  const c = cfg(); const token = c.token_enc ? decrypt(c.token_enc).trim() : '';
  if (!token || !c.account) throw new Error('حط Account ID ومفتاح Workers بالإعدادات');
  const name = (c.name || 'kfastai').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const fd = new FormData();
  fd.append('metadata', new Blob([JSON.stringify({ main_module: 'worker.js', compatibility_date: '2025-01-01' })], { type: 'application/json' }));
  fd.append('worker.js', new Blob([WORKER(target)], { type: 'application/javascript+module' }), 'worker.js');
  let sub = null;
  try { sub = (await cfApi(token, 'GET', `/accounts/${c.account}/workers/subdomain`)).subdomain; } catch {}
  if (!sub) { // أول مرة: منعمل اسم للحساب على workers.dev
    sub = name + '-' + Math.random().toString(36).slice(2, 6);
    await cfApi(token, 'PUT', `/accounts/${c.account}/workers/subdomain`, JSON.stringify({ subdomain: sub }), { 'Content-Type': 'application/json' });
  }
  await cfApi(token, 'PUT', `/accounts/${c.account}/workers/scripts/${name}`, fd);
  await cfApi(token, 'POST', `/accounts/${c.account}/workers/scripts/${name}/subdomain`, JSON.stringify({ enabled: true }), { 'Content-Type': 'application/json' });
  const workersUrl = `https://${name}.${sub}.workers.dev`;
  status.workersUrl = workersUrl; status.publicUrl = workersUrl;
  // رابط أقصر: NAME.pages.dev (Cloudflare Pages + _worker.js بيحوّل لنفس المكان)
  let pagesUrl = null;
  if (c.pages !== false) {
    try { pagesUrl = await publishPages(token, c.account, name, target); status.publicUrl = pagesUrl; status.pagesError = null; }
    catch (e) { status.pagesError = e.message; console.error('[link] pages:', e.message); }
  }
  const hosts = [workersUrl, pagesUrl].filter(Boolean).map(u => new URL(u).host);
  setSetting('public_link', { ...cfg(), last_url: status.publicUrl, hosts });
  console.log(`[link] public link: ${status.publicUrl}${pagesUrl ? ' + ' + workersUrl : ''} → ${target}`);
}

async function publishPages(token, acc, name, target) {
  let proj;
  try { proj = await cfApi(token, 'GET', `/accounts/${acc}/pages/projects/${name}`); }
  catch { proj = await cfApi(token, 'POST', `/accounts/${acc}/pages/projects`, JSON.stringify({ name, production_branch: 'main' }), { 'Content-Type': 'application/json' }); }
  const fd = new FormData();
  fd.append('manifest', '{}');
  fd.append('branch', 'main');
  fd.append('_worker.js', new Blob([WORKER(target)], { type: 'application/javascript+module' }), '_worker.js');
  await cfApi(token, 'POST', `/accounts/${acc}/pages/projects/${name}/deployments`, fd);
  return 'https://' + (proj.subdomain || `${name}.pages.dev`);
}

export async function startTunnel(port) {
  const c = cfg();
  if (!c.enabled) { status.state = 'off'; return; }
  try { await ensureBinary(); } catch (e) { status.state = 'error'; status.error = e.message; return; }
  stopTunnel();
  status.state = 'starting'; status.error = null;
  const me = child = spawn(BIN, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { windowsHide: true });
  const onData = async buf => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== status.target && child === me) {
      status.target = m[0]; status.state = 'publishing';
      try { await publish(m[0]); status.state = 'on'; } catch (e) { status.state = 'error'; status.error = e.message; console.error('[link]', e.message); }
    }
  };
  me.stdout.on('data', onData); me.stderr.on('data', onData);
  // بس إذا النفق الحالي وقف لحالو منعيد تشغيله (مو القديم يلي سكّرناه نحنا)
  me.on('exit', code => { if (child === me) { child = null; console.error('[link] cloudflared stopped', code); status.state = 'restarting'; setTimeout(() => { if (!child) startTunnel(port); }, 10000); } });
}
export function stopTunnel() { if (child) { const c = child; child = null; status.state = 'off'; c.kill(); } }
