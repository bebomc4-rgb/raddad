// كلمات السر، الجلسات، وتشفير المفاتيح الحساسة
import crypto from 'node:crypto';
import { config } from './config.js';
import { q } from './db.js';

const KEY = crypto.createHash('sha256').update('raddad-enc:' + config.secret).digest();

export function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
export function decrypt(blob) {
  if (!blob) return null;
  try {
    const [iv, tag, data] = blob.split('.').map(s => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch { return null; }
}
export function maskKey(k) {
  if (!k) return '';
  return k.length <= 8 ? '••••' : k.slice(0, 4) + '••••' + k.slice(-4);
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [, salt, hash] = stored.split('$');
    const h = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(h, Buffer.from(hash, 'base64'));
  } catch { return false; }
}

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const SESSION_DAYS = 30;

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  q.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    sha(token), userId, Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400);
  return token;
}
export function destroySession(token) {
  if (token) q.run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
}
export function userFromToken(token) {
  if (!token) return null;
  const row = q.get(`SELECT u.id, u.tenant_id, u.email, u.name, u.role, u.is_super, s.expires_at
                     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha(token));
  if (!row) return null;
  if (row.expires_at < Date.now() / 1000) { destroySession(token); return null; }
  return row;
}
setInterval(() => q.run('DELETE FROM sessions WHERE expires_at < unixepoch()'), 3600_000).unref();

// حد بسيط لعدد المحاولات (ضد تخمين كلمات السر)
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, reset: now + windowMs };
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
  b.n++;
  buckets.set(key, b);
  return b.n <= max;
}
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (n > b.reset) buckets.delete(k); }, 600_000).unref();
