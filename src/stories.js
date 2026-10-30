// حالات واتساب (ستوري) أوتوماتيك: منتج من منتجات المتجر مع صورتو وسعرو، مرة لـ 3 مرات باليوم بأوقات ثابتة
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { q } from './db.js';
import { getTenant } from './tenants.js';

const FILE = path.join(DATA_DIR, 'stories.json');
let st = {}; try { st = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(st)); } catch {} };
export const SLOTS = { 1: [20], 2: [12, 20], 3: [11, 16, 21] };
const dam = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value])); return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 }; };

export function storyLog(tid) { return (st[tid]?.log || []).slice(-20).reverse(); }

async function imageBuffer(url) {
  if (!url) return null;
  if (url.startsWith('/uploads/')) { const f = path.join(DATA_DIR, 'uploads', path.basename(url)); return fs.existsSync(f) ? fs.readFileSync(f) : null; }
  if (!/^https?:\/\//.test(url)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 50 && buf.length < 8 * 1024 * 1024 ? buf : null;
}
const money = (v, c) => (v == null || v === '' ? '' : `${Number(v)}${c === 'USD' || !c ? '$' : ' ' + c}`);

export async function postStory(tid) {
  const t = getTenant(tid);
  const s = (st[tid] ||= { posted: {}, log: [] });
  const now = Math.floor(Date.now() / 1000);
  const all = q.all("SELECT id, name, price, sale_price, currency, image_url FROM products WHERE tenant_id = ? AND image_url IS NOT NULL AND image_url != '' AND (stock IS NULL OR stock > 0)", tid);
  if (!all.length) throw new Error('ما في منتجات إلها صور. ضيف منتجات بصور أول.');
  const fresh = all.filter(p => !s.posted[p.id] || now - s.posted[p.id] > 10 * 86400);
  const pool = fresh.length ? fresh : all;
  let p = null, image = null;
  for (let i = 0; i < 5 && !image; i++) { p = pool[Math.floor(Math.random() * pool.length)]; image = await imageBuffer(p.image_url); }
  if (!image) throw new Error('ما قدرنا نجيب صورة المنتج');
  const cur = p.currency || t.knowledge?.currency || 'USD';
  const price = p.sale_price && p.price && p.sale_price < p.price ? `🔥 ${money(p.sale_price, cur)} بدل ${money(p.price, cur)}` : money(p.price, cur);
  const caption = [`✨ ${p.name}`, price ? `💰 ${price}` : '', 'للطلب راسلنا هون 👇'].filter(Boolean).join('\n');
  const qr = await import('./whatsapp/baileys.js');
  try {
    const n = await qr.postStatus(tid, { image, caption });
    s.posted[p.id] = now; s.log.push({ ts: now, name: p.name, ok: true, to: n }); s.log = s.log.slice(-50); save();
    console.log(`[stories] tenant ${tid}: posted «${p.name}» to ${n} contacts`);
    return { name: p.name, to: n };
  } catch (e) { s.log.push({ ts: now, name: p.name, ok: false, err: e.message }); s.log = s.log.slice(-50); save(); throw e; }
}

export function startStories(canPost) {
  const tick = async () => {
    const { day, hour } = dam();
    for (const t of q.all("SELECT id, settings FROM tenants WHERE status = 'active'")) {
      let set = {}; try { set = JSON.parse(t.settings || '{}').status_auto || {}; } catch {}
      if (!set.enabled) continue;
      const slots = SLOTS[set.per_day] || SLOTS[1];
      if (!slots.includes(hour)) continue;
      const s = (st[t.id] ||= { posted: {}, log: [] }), key = `${day}:${hour}`;
      if (s.last === key || !canPost(t.id)) continue;
      s.last = key; save();
      await postStory(t.id).catch(e => console.error(`[stories] tenant ${t.id}: ${e.message}`));
    }
  };
  setInterval(() => tick().catch(() => {}), 5 * 60_000).unref?.();
}
