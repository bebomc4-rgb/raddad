// ربط موقع الزبون: منسحب المنتجات (الاسم، السعر، الصورة، الرابط) من موقعو لحالها، وبتتحدّث كل 6 ساعات إذا بدو
// بيدعم: Shopify، WooCommerce، وأي رابط JSON أو CSV فيه منتجات
import dns from 'node:dns/promises';
import net from 'node:net';
import { q } from './db.js';
import { importProducts } from './products.js';
import { getTenant, getPlan } from './tenants.js';

const PRIV = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i;
async function get(url) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('لازم الرابط يبلّش بـ http أو https');
  const { address } = await dns.lookup(u.hostname);
  if (net.isIP(address) && PRIV.test(address)) throw new Error('ما مسموح عناوين داخلية');
  const res = await fetch(u, { signal: AbortSignal.timeout(30_000), redirect: 'follow', headers: { 'User-Agent': 'KFastAI-Sync/1.0', Accept: 'application/json,text/csv,*/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);

function fromShopify(list, origin) {
  return list.map(p => {
    const v = (p.variants || [])[0] || {};
    const price = Number(v.price), was = Number(v.compare_at_price);
    return { name: p.title, price: was > price ? was : price, sale_price: was > price ? price : null, image_url: (p.images || [])[0]?.src || p.image?.src || null,
      url: p.handle ? `${origin}/products/${p.handle}` : null, description: strip(p.body_html), category: p.product_type || null, sku: String(v.sku || p.id || '') || null,
      options: (p.options || []).filter(o => o.name !== 'Title').map(o => `${o.name}: ${(o.values || []).join('/')}`).join('، ') || null };
  });
}
function fromWoo(list) {
  return list.map(p => {
    const pr = p.prices || {}, unit = Number(pr.currency_minor_unit ?? 2), div = 10 ** unit;
    const reg = Number(pr.regular_price) / div, cur = Number(pr.price) / div;
    return { name: strip(p.name), price: reg > cur ? reg : cur, sale_price: reg > cur ? cur : null, image_url: (p.images || [])[0]?.src || null, url: p.permalink || null,
      description: strip(p.short_description || p.description), category: (p.categories || []).map(c => c.name).join('، ') || null, sku: String(p.sku || p.id || '') || null, currency: pr.currency_code || null };
  });
}

export async function syncSite(tenantId, url) {
  url = String(url || '').trim();
  if (!url) throw new Error('حط رابط موقعك');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const origin = new URL(url).origin;
  const tries = [url, `${origin}/products.json?limit=250`, `${origin}/wp-json/wc/store/v1/products?per_page=100`, `${origin}/wp-json/wc/store/products?per_page=100`];
  const errors = [];
  for (const t of [...new Set(tries)]) {
    try {
      const res = await get(t);
      const text = await res.text();
      let rows = null;
      if ((res.headers.get('content-type') || '').includes('json') || /^\s*[[{]/.test(text)) {
        const j = JSON.parse(text);
        if (Array.isArray(j?.products) && j.products[0]?.variants) rows = fromShopify(j.products, origin);
        else if (Array.isArray(j) && j[0]?.prices) rows = fromWoo(j);
        else rows = Array.isArray(j) ? j : j?.products || j?.data || j?.items || Object.values(j || {}).find(Array.isArray) || null;
      } else if (/,|;/.test(text.split('\n')[0] || '') && !/<html/i.test(text.slice(0, 500))) {
        const { parseCSV } = await import('./products.js');
        rows = parseCSV(text);
      }
      if (!rows?.length) { errors.push(`${t}: ما في منتجات`); continue; }
      const r = importProducts(tenantId, rows, { maxProducts: getPlan(getTenant(tenantId)).max_products });
      if (!r.valid) { errors.push(`${t}: ما فهمنا المنتجات`); continue; }
      return { ...r, source: t };
    } catch (e) { errors.push(`${t}: ${e.message}`); }
  }
  console.error(`[site] tenant ${tenantId}: ${errors.join(' | ')}`);
  throw new Error('ما قدرنا نقرا المنتجات من هالموقع. بيشتغل مع Shopify وWooCommerce، أو حط رابط ملف منتجات (JSON أو CSV).');
}

// كل 6 ساعات: يلي فعّل «حدّث لحالو»
export function startSiteSync() {
  const tick = async () => {
    for (const t of q.all("SELECT id, settings FROM tenants WHERE status = 'active'")) {
      let s = {}; try { s = JSON.parse(t.settings || '{}'); } catch {}
      if (!s.site_sync || !s.site_url) continue;
      try { const r = await syncSite(t.id, s.site_url); console.log(`[site] tenant ${t.id}: ${r.added} new, ${r.updated} updated from ${r.source}`); }
      catch (e) { console.error(`[site] tenant ${t.id}: ${e.message}`); }
    }
  };
  setTimeout(tick, 5 * 60_000).unref?.();
  setInterval(tick, 6 * 3600_000).unref?.();
}
export const _adapters = { fromShopify, fromWoo };
