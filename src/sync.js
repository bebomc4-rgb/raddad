// مزامنة الموبايل الاحتياط مع الكمبيوتر: الموبايل بياخد من الكمبيوتر آخر المنتجات والإعدادات والتعليمات والحسابات والاشتراكات
// (المحادثات ما بتنتقل: كل جهاز بيسجّل يلي بيوصلو)
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, q, getSetting } from './db.js';

export const syncKey = () => crypto.createHash('sha256').update('raddad-sync:' + config.secret).digest('hex');
const TABLES = ['plans', 'plan_prices', 'services', 'service_prices', 'platform_settings', 'tenants', 'users', 'tenant_services', 'products', 'style_examples'];
const SKIP_SETTINGS = new Set(['public_link']); // كل جهاز إلو نفقو
const has = t => !!q.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", t);

// على الكمبيوتر: كل الجداول يلي بدها تنتقل
export function exportData() {
  const out = {};
  for (const t of TABLES) {
    if (!has(t)) continue;
    let rows = q.all(`SELECT * FROM ${t}`);
    if (t === 'platform_settings') rows = rows.filter(r => !SKIP_SETTINGS.has(r.key));
    out[t] = rows;
  }
  return { at: Math.floor(Date.now() / 1000), tables: out };
}

// على الموبايل: منحدّث أو منضيف كل صف حسب مفتاحو، ومنشيل يلي انحذف بالكمبيوتر
export function importData(data) {
  const stats = {};
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    for (const t of TABLES) {
      const rows = data?.tables?.[t];
      if (!Array.isArray(rows) || !has(t)) continue;
      const info = q.all(`PRAGMA table_info(${t})`);
      const local = new Set(info.map(c => c.name));
      const pk = info.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
      if (!pk.length) continue;
      const cols = Object.keys(rows[0] || {}).filter(c => local.has(c));
      if (rows.length && cols.length) {
        const upd = cols.filter(c => !pk.includes(c));
        const stmt = db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
          ON CONFLICT(${pk.join(', ')}) DO ${upd.length ? 'UPDATE SET ' + upd.map(c => `${c} = excluded.${c}`).join(', ') : 'NOTHING'}`);
        for (const r of rows) stmt.run(...cols.map(c => r[c] ?? null));
      }
      // يلي انحذف بالكمبيوتر
      const keep = new Set(rows.map(r => pk.map(c => String(r[c])).join('\u0001')));
      let removed = 0;
      for (const r of q.all(`SELECT ${pk.join(', ')} FROM ${t}`)) {
        if (t === 'platform_settings' && SKIP_SETTINGS.has(r.key)) continue;
        if (!keep.has(pk.map(c => String(r[c])).join('\u0001'))) { q.run(`DELETE FROM ${t} WHERE ${pk.map(c => `${c} = ?`).join(' AND ')}`, ...pk.map(c => r[c])); removed++; }
      }
      stats[t] = { rows: rows.length, removed };
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { db.exec('PRAGMA foreign_keys = ON'); }
  return stats;
}

// الموبايل بيسحب من الكمبيوتر (عن طريق الرابط العام)
let lastPull = 0;
export async function pullFromPC(linkUrl, { force = false } = {}) {
  if (!linkUrl || (!force && Date.now() - lastPull < 30 * 60_000)) return null;
  lastPull = Date.now();
  try {
    const r = await fetch(linkUrl.replace(/\/$/, '') + '/api/sync/export?t=' + Date.now(), { headers: { 'x-sync-key': syncKey(), 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const stats = importData(await r.json());
    console.log('[sync] took the latest data from the PC:', Object.entries(stats).map(([k, v]) => `${k} ${v.rows}`).join(', '));
    return stats;
  } catch (e) { console.error('[sync] pull from PC failed:', e.message); lastPull = Date.now() - 25 * 60_000; return null; } // منرجع نجرّب بعد 5 دقايق
}
