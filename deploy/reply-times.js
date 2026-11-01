// قديش عم ياخد المجيب ليرد؟ (آخر 40 رسالة من الزباين) — عالسيرفر:  node /opt/raddad/deploy/reply-times.js
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(new URL('../data/raddad.db', import.meta.url).pathname, { readOnly: true });
const ins = db.prepare(`SELECT m.id, m.tenant_id, m.contact_id, m.body, m.created_at, c.phone FROM messages m JOIN contacts c ON c.id = m.contact_id
  WHERE m.direction = 'in' AND m.created_at > unixepoch() - 6*3600 ORDER BY m.id DESC LIMIT 40`).all();
const nextOut = db.prepare(`SELECT created_at, sender FROM messages WHERE contact_id = ? AND id > ? AND direction = 'out' ORDER BY id LIMIT 1`);
const t = s => new Date((s + 3 * 3600) * 1000).toISOString().slice(11, 19);
for (const m of ins.reverse()) {
  const o = nextOut.get(m.contact_id, m.id);
  const wait = o ? `${o.created_at - m.created_at} ثانية (${o.sender})` : 'ما في رد';
  console.log(`${t(m.created_at)}  متجر ${m.tenant_id}  ${m.phone || ''}  «${String(m.body || '[صورة/صوت]').slice(0, 25).replace(/\s+/g, ' ')}»  ← ${wait}`);
}
