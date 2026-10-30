// ردّاد — منصة وكيل مبيعات ذكي على واتساب
import http from 'node:http';
import path from 'node:path';
import { config, ROOT, DATA_DIR } from './src/config.js';
import './src/db.js';

// مكتبة التشفير تبع واتساب بتطبع تفاصيل جلسات طويلة (وفيها مفاتيح) — منخفيها من السجل
const NOISY = /^(Closing session|Closing open session|Removing old closed session|Decrypted message with closed session|Migrating session|Session already closed|Session already open)/;
for (const k of ['log', 'info', 'warn']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { if (typeof a[0] === 'string' && NOISY.test(a[0])) return; orig(...a); };
}
import { router } from './src/routes.js';
import './src/routes-v2.js'; // نقاط الواجهة الجديدة (/next)
import { HttpError, readBody, json, parseCookies, serveFile, fileVersion } from './src/http.js';
import { userFromToken } from './src/security.js';
import { getTenant } from './src/tenants.js';
import { subscribe } from './src/events.js';
import * as cloud from './src/whatsapp/cloud.js';
import { bootAll } from './src/whatsapp/baileys.js';
import { startBatchWorker } from './src/batch.js';
import { startSubscriptionWorker } from './src/subscriptions.js';
import { startAutoWorker } from './src/autofolder.js';
import { startTunnel, stopTunnel } from './src/tunnel.js';
import { isActive, failoverStatus, startFailover, startPrimaryWatch } from './src/failover.js';
import { getSetting } from './src/db.js';

const PUBLIC = path.join(ROOT, 'public');
const COOKIE = 'raddad_sid';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  const ip = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  // لوحة المجيب بتنفتح بس جوّا لوحة موقع Ko Sport (وممنوع أي موقع تاني يحطها جوّاته)
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://ko-sport.pages.dev https://*.ko-sport.pages.dev https://ko-sport.online https://*.ko-sport.online");
  res.setHeader('Referrer-Policy', 'same-origin');

  try {
    // ===== Webhook الربط الرسمي من ميتا =====
    const wh = pathname.match(/^\/webhook\/wa\/(\d+)$/);
    if (wh) {
      const tenantId = Number(wh[1]);
      if (req.method === 'GET') {
        const ch = cloud.verifyWebhook(tenantId, Object.fromEntries(url.searchParams));
        res.writeHead(ch ? 200 : 403, { 'Content-Type': 'text/plain' });
        return res.end(ch || 'forbidden');
      }
      if (req.method === 'POST') {
        const raw = await readBody(req, 2 * 1024 * 1024);
        const t = getTenant(tenantId);
        if (!t || !cloud.checkSignature(t, raw, req.headers['x-hub-signature-256'])) { res.writeHead(403); return res.end(); }
        res.writeHead(200); res.end('ok'); // ميتا بدها رد سريع
        let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { return; }
        cloud.handleWebhook(tenantId, payload).catch(e => console.error('[cloud]', e.message));
        return;
      }
    }

    // ===== فيسبوك وإنستغرام (ردود التعليقات) =====
    if (pathname === '/meta' || pathname.startsWith('/meta/')) {
      const M = await import('./src/meta.js');
      const mu = userFromToken(parseCookies(req.headers.cookie)[COOKIE]);
      if (await M.handle(req, res, url, pathname, mu, mu ? getTenant(mu.tenant_id) : null, getTenant)) return;
    }

    // ===== مجيب المسنجر: إضافة الكروم/إيدج من نفس الكمبيوتر بس =====
    if (pathname.startsWith('/ext/messenger/')) {
      const MB = await import('./src/messenger.js');
      return MB.handleExtension(req, res, pathname);
    }

    // مين شغّال هلق (الكمبيوتر ولا الموبايل الاحتياط) — بيسألو الموبايل كل 30 ثانية
    if (pathname === '/api/whoami') return json(res, 200, failoverStatus());

    // ===== API =====
    if (pathname.startsWith('/api/')) {
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[COOKIE];
      const user = userFromToken(token);
      const tenant = user ? getTenant(user.tenant_id) : null;

      if (pathname === '/api/events' && req.method === 'GET') {
        if (!user) return json(res, 401, { error: 'سجّل دخول أول' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 3000\n\n');
        subscribe(user.tenant_id, res);
        return;
      }

      const m = router.match(req.method, pathname);
      if (!m) return json(res, 404, { error: 'غير موجود' });

      // حماية CSRF: الطلبات المعدّلة لازم تكون JSON من نفس الموقع
      let body = {};
      if (req.method !== 'GET') {
        const ct = req.headers['content-type'] || '';
        if (!ct.includes('application/json')) return json(res, 415, { error: 'JSON مطلوب' });
        const origin = req.headers.origin;
        if (origin && !config.dev) {
          let oh = ''; try { oh = new URL(origin).host; } catch {}
          const allowed = [req.headers.host, req.headers['x-forwarded-host']];
          if (config.publicUrl) { try { allowed.push(new URL(config.publicUrl).host); } catch {} }
          try { const pl = getSetting('public_link', {}); allowed.push(...(pl.hosts || [])); if (pl.last_url) allowed.push(new URL(pl.last_url).host); } catch {}
          if (!allowed.includes(oh)) return json(res, 403, { error: 'مصدر غير مسموح' });
        }
        const raw = await readBody(req);
        try { body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { return json(res, 400, { error: 'JSON غير صالح' }); }
      }

      const secure = (req.headers['x-forwarded-proto'] || '').includes('https') || config.publicUrl.startsWith('https');
      const ctx = {
        req, res, ip, user, tenant, token, body, params: m.params, query: Object.fromEntries(url.searchParams),
        setCookie(value, maxAge = 30 * 86400) {
          res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Max-Age=${maxAge}${secure ? '; Secure; SameSite=None; Partitioned' : '; SameSite=Lax'}`); // None: مشان يضل مسجّل دخول جوّا لوحة الموقع (الحماية من CSRF فوق: JSON + نفس المصدر)
        }
      };
      let out;
      for (const h of m.handlers) out = await h(ctx);
      return json(res, 200, out ?? { ok: true });
    }

    // ===== الملفات =====
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (pathname.startsWith('/uploads/')) {
      return serveFile(res, path.join(DATA_DIR, 'uploads', path.basename(pathname)), { cache: 'public, max-age=31536000, immutable' });
    }
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(PUBLIC, safe);
    if (file.startsWith(PUBLIC) && path.extname(file) && !file.endsWith('index.html')) {
      // ملفات البرنامج دايماً بتتأكد من النسخة الجديدة (حتى ما يضل المتصفح على نسخة قديمة بعد التحديث)
      // ملف عليه رقم نسخة (?v=) = ما بيتغيّر أبداً → المتصفح و Cloudflare بيحفظوه وما بيرجعوا يطلبوه من الكمبيوتر
      if (url.searchParams.has('v')) return serveFile(res, file, { cache: 'public, max-age=31536000, immutable' });
      const fresh = /\.(js|css|html|webmanifest)$/.test(safe);
      return serveFile(res, file, { cache: fresh ? 'no-cache' : 'public, max-age=86400' });
    }
    // الواجهة الجديدة (تجربة جنب القديمة): /next
    if (pathname === '/next') { res.writeHead(301, { Location: '/next/' + (url.search || '') }); return res.end(); }
    if (pathname.startsWith('/next/')) {
      const NEXT = path.join(PUBLIC, 'next');
      return serveFile(res, path.join(NEXT, 'index.html'), {
        transform: html => html.replace(/(href|src)="\/next\/([\w./-]+\.(?:css|js))"/g, (m, a, f) => `${a}="/next/${f}?v=${fileVersion(path.join(NEXT, f))}"`)
      });
    }
    // الصفحة الرئيسية: منحط رقم نسخة على app.js و app.css
    return serveFile(res, path.join(PUBLIC, 'index.html'), {
      transform: html => html
        .replace('href="/app.css"', `href="/app.css?v=${fileVersion(path.join(PUBLIC, 'app.css'))}"`)
        .replace('src="/app.js"', `src="/app.js?v=${fileVersion(path.join(PUBLIC, 'app.js'))}"`)
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('[http]', e);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'صار خطأ بالسيرفر' : e.message });
    else try { res.end(); } catch {}
  }
});

server.listen(config.port, config.host, () => {
  console.log(`✅ ردّاد شغّال: http://localhost:${config.port}${config.mockAI ? '  (وضع الذكاء التجريبي MOCK_AI)' : ''}`);
  bootAll().catch(e => console.error('[boot]', e.message));
  startBatchWorker();
  startSubscriptionWorker();
  startAutoWorker();
  // الموبايل الاحتياط ما بيوجّه الرابط العام لعندو إلا لما يستلم (الكمبيوتر وقف)
  if (isActive()) startTunnel(config.port).catch(e => console.error('[link]', e.message));
  startFailover(on => on ? startTunnel(config.port).catch(e => console.error('[link]', e.message)) : stopTunnel());
  startPrimaryWatch(() => startTunnel(config.port).catch(e => console.error('[link]', e.message)));
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('إيقاف...'); server.close(); process.exit(0); });
process.on('unhandledRejection', e => console.error('[unhandled]', e?.message || e));
