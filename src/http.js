// راوتر HTTP صغير بدون مكتبات
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

export function createRouter() {
  const routes = [];
  const add = method => (pattern, ...handlers) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handlers });
  };
  return {
    get: add('GET'), post: add('POST'), put: add('PUT'), del: add('DELETE'),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = pathname.match(r.re);
        if (m) return { handlers: r.handlers, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      }
      return null;
    }
  };
}

export function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'الملف كبير كتير')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ضغط الردود: الكمبيوتر بيرفع أقل بـ 5-10 مرات عبر الرابط العام = لوحة أسرع بكتير
function pickEnc(res) {
  const ae = String(res.req?.headers?.['accept-encoding'] || '');
  return /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null;
}
function compress(buf, enc) {
  return enc === 'br'
    ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } })
    : zlib.gzipSync(buf, { level: 6 });
}

export function json(res, status, data, headers = {}) {
  let body = Buffer.from(JSON.stringify(data));
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...headers };
  const enc = body.length > 1024 ? pickEnc(res) : null;
  if (enc) { body = compress(body, enc); h['Content-Encoding'] = enc; }
  h['Content-Length'] = body.length;
  res.writeHead(status, h);
  res.end(body);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon'
};

const TEXT = /\.(html|js|css|json|webmanifest|svg)$/i;
const memo = new Map(); // ملفات البرنامج مضغوطة جاهزة بالذاكرة (بتتحدّث لحالها إذا الملف تغيّر)

// رقم نسخة قصير للملف: بيتغيّر بس لما الملف يتغيّر
export function fileVersion(file) {
  try { const st = fs.statSync(file); return crypto.createHash('sha1').update(st.mtimeMs + ':' + st.size).digest('hex').slice(0, 10); } catch { return '0'; }
}

export function serveFile(res, file, { cache = 'no-cache', transform = null } = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const base = { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' };
    if (!TEXT.test(file) || st.size > 8 * 1024 * 1024) { // صور وملفات كبيرة: متل ما هي
      res.writeHead(200, { ...base, 'Content-Length': st.size });
      fs.createReadStream(file).pipe(res);
      return;
    }
    const key = file + (transform ? '#t' : ''), stamp = st.mtimeMs + ':' + st.size;
    let m = memo.get(key);
    if (!m || m.stamp !== stamp || transform) {
      let raw = fs.readFileSync(file);
      if (transform) raw = Buffer.from(transform(raw.toString('utf8')));
      m = { stamp, raw, etag: '"' + crypto.createHash('sha1').update(raw).digest('base64').slice(0, 16) + '"', enc: {} };
      memo.set(key, m);
    }
    const h = { ...base, ETag: m.etag, Vary: 'Accept-Encoding' };
    if (res.req?.headers?.['if-none-match'] === m.etag) { res.writeHead(304, h); res.end(); return; }
    const enc = m.raw.length > 512 ? pickEnc(res) : null;
    let body = m.raw;
    if (enc) { body = m.enc[enc] || (m.enc[enc] = compress(m.raw, enc)); h['Content-Encoding'] = enc; }
    h['Content-Length'] = body.length;
    res.writeHead(200, h);
    res.end(res.req?.method === 'HEAD' ? undefined : body);
  });
}
