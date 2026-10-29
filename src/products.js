// المنتجات: حفظ، بحث ذكي، واستيراد من CSV أو JSON
import { q, tx } from './db.js';
import { normalize, tokens, stem, clamp } from './text.js';

const FIELDS = ['sku', 'name', 'description', 'category', 'price', 'sale_price', 'currency', 'stock', 'options', 'image_url', 'url', 'tags', 'active'];

function clean(p) {
  const o = {};
  for (const f of FIELDS) if (p[f] !== undefined) o[f] = p[f];
  o.name = clamp(o.name || '', 300).trim();
  if (o.description !== undefined) o.description = clamp(o.description, 4000);
  for (const n of ['price', 'sale_price']) if (o[n] !== undefined) o[n] = o[n] === '' || o[n] === null ? null : Number(String(o[n]).replace(/[^\d.]/g, '')) || null;
  if (o.stock !== undefined) o.stock = o.stock === '' || o.stock === null ? null : parseInt(o.stock, 10);
  if (o.active !== undefined) o.active = o.active === false || o.active === 0 || o.active === '0' || o.active === 'false' ? 0 : 1;
  return o;
}

function searchText(p) {
  return normalize([p.name, p.category, p.tags, p.description, p.options, p.sku].filter(Boolean).join(' '))
    .split(' ').map(stem).join(' ');
}

export function saveProduct(tenantId, data, id = null) {
  const p = clean(data);
  if (!p.name) throw new Error('اسم المنتج مطلوب');
  if (id) {
    const cur = q.get('SELECT * FROM products WHERE id = ? AND tenant_id = ?', id, tenantId);
    if (!cur) throw new Error('المنتج غير موجود');
    const m = { ...cur, ...p };
    m.search = searchText(m);
    const cols = [...FIELDS, 'search'];
    q.run(`UPDATE products SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?`,
      ...cols.map(c => m[c] ?? null), id, tenantId);
    return id;
  }
  p.search = searchText(p);
  const cols = Object.keys(p);
  const r = q.run(`INSERT INTO products (tenant_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
    tenantId, ...cols.map(c => p[c] ?? null));
  return Number(r.lastInsertRowid);
}

// بحث بسيط وسريع بنقاط: الاسم أهم من الوصف
export function searchProducts(tenantId, text, limit = 10) {
  const words = [...new Set(tokens(text).map(stem))].filter(w => w.length > 1).slice(0, 12);
  const all = q.all('SELECT * FROM products WHERE tenant_id = ? AND active = 1', tenantId);
  if (!words.length) return [];
  const scored = [];
  for (const p of all) {
    const name = ' ' + normalize(p.name).split(' ').map(stem).join(' ') + ' ';
    const cat = normalize(p.category || '');
    let score = 0;
    for (const w of words) {
      if (name.includes(' ' + w + ' ')) score += 6;
      else if (name.includes(w)) score += 4;
      if (cat.includes(w)) score += 3;
      if (p.search?.includes(w)) score += 1;
      if (p.sku && normalize(p.sku) === w) score += 10;
    }
    if (score > 0) scored.push([score, p]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(x => x[1]);
}

export function catalogSummary(tenantId) {
  const cats = q.all(`SELECT COALESCE(NULLIF(category,''),'بدون تصنيف') c, COUNT(*) n, MIN(COALESCE(sale_price, price)) mn, MAX(COALESCE(sale_price, price)) mx
                      FROM products WHERE tenant_id = ? AND active = 1 GROUP BY c ORDER BY n DESC LIMIT 40`, tenantId);
  const total = q.get('SELECT COUNT(*) n FROM products WHERE tenant_id = ? AND active = 1', tenantId).n;
  return { total, cats };
}

export function featuredProducts(tenantId, limit = 6) {
  return q.all('SELECT * FROM products WHERE tenant_id = ? AND active = 1 ORDER BY updated_at DESC LIMIT ?', tenantId, limit);
}

// ===== الاستيراد =====
const ALIASES = {
  name: ['name', 'title', 'product', 'product_name', 'الاسم', 'اسم المنتج', 'المنتج'],
  description: ['description', 'desc', 'body', 'body_html', 'الوصف', 'وصف'],
  category: ['category', 'type', 'product_type', 'collection', 'التصنيف', 'الفئة', 'القسم'],
  price: ['price', 'regular_price', 'variant_price', 'السعر'],
  sale_price: ['sale_price', 'compare_price', 'discount_price', 'سعر الخصم', 'السعر بعد الخصم'],
  sku: ['sku', 'code', 'id', 'الكود', 'رمز'],
  stock: ['stock', 'quantity', 'qty', 'inventory', 'الكمية', 'المخزون'],
  options: ['options', 'sizes', 'variants', 'colors', 'المقاسات', 'الخيارات', 'الألوان'],
  image_url: ['image', 'image_url', 'image src', 'images', 'img', 'photo', 'الصورة', 'صورة'],
  url: ['url', 'link', 'permalink', 'الرابط'],
  tags: ['tags', 'keywords', 'الكلمات', 'وسوم'],
  currency: ['currency', 'العملة']
};

function mapRow(row) {
  const lower = {};
  for (const [k, v] of Object.entries(row)) lower[String(k).trim().toLowerCase()] = v;
  const out = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    for (const n of names) {
      let v = lower[n];
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v = field === 'image_url' ? (typeof v[0] === 'object' ? v[0]?.src || v[0]?.url : v[0]) : v.map(x => typeof x === 'object' ? (x.name || x.title || x.value || JSON.stringify(x)) : x).join('، ');
      else if (typeof v === 'object') v = v.src || v.url || v.name || v.value || JSON.stringify(v);
      out[field] = v;
      break;
    }
  }
  if (typeof out.image_url === 'string' && out.image_url.includes(',') && !out.image_url.startsWith('data:'))
    out.image_url = out.image_url.split(',')[0].trim();
  if (typeof out.description === 'string') out.description = out.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return out;
}

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(x => x.trim()));
  if (!head) return [];
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export function importProducts(tenantId, rows, { replace = false, maxProducts = Infinity } = {}) {
  if (!Array.isArray(rows)) {
    // يدعم {products:[...]} أو {data:[...]} أو أي مصفوفة جوات الكائن
    rows = rows?.products || rows?.data || rows?.items || Object.values(rows || {}).find(Array.isArray) || [];
  }
  const mapped = rows.map(mapRow).filter(r => r.name);
  let added = 0, skipped = 0;
  tx(() => {
    if (replace) q.run('DELETE FROM products WHERE tenant_id = ?', tenantId);
    let count = q.get('SELECT COUNT(*) n FROM products WHERE tenant_id = ?', tenantId).n;
    for (const r of mapped) {
      if (count >= maxProducts) { skipped++; continue; }
      const existing = r.sku ? q.get('SELECT id FROM products WHERE tenant_id = ? AND sku = ?', tenantId, String(r.sku)) : null;
      saveProduct(tenantId, { ...r, sku: r.sku != null ? String(r.sku) : null }, existing?.id || null);
      if (!existing) { added++; count++; }
    }
  });
  return { found: rows.length, valid: mapped.length, added, updated: mapped.length - added - skipped, skipped };
}

export function productForAI(p, currency) {
  const price = p.sale_price && p.price && p.sale_price < p.price
    ? `${p.sale_price} ${p.currency || currency} (بدل ${p.price})`
    : (p.price != null ? `${p.price} ${p.currency || currency}` : 'السعر عند الطلب');
  const parts = [`#${p.id} | ${p.name} | ${price}`];
  if (p.category) parts.push(`التصنيف: ${p.category}`);
  if (p.options) parts.push(`الخيارات: ${p.options}`);
  if (p.stock != null) parts.push(p.stock > 0 ? `متوفر (${p.stock})` : 'نفد من المخزون');
  if (p.description) parts.push(`الوصف: ${clamp(p.description, 300)}`);
  if (p.url) parts.push(`الرابط: ${p.url}`);
  parts.push(p.image_url ? 'له صورة' : 'بدون صورة');
  return parts.join(' | ');
}
