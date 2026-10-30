// قارئ نسخة واتساب الاحتياطية (msgstore.db.crypt15) — بيشتغل كامل على جهاز الزبون، والملف ما بيطلع من عندو.
// بيفك التشفير (AES-GCM كـ CTR على دفعات صغيرة)، بيفك الضغط، وبيقرا قاعدة SQLite صفحة صفحة
// بدون ما يحمّل الملف كلو بالذاكرة (مناسب للموبايل). النتيجة: أرقام المحادثات الفردية بس.
// بيشتغل بالمتصفح وبـ Node 22 (للتجربة).

const subtle = globalThis.crypto.subtle;
const CHUNK = 4 * 1024 * 1024; // لازم يكون من مضاعفات 16

export class BackupError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ===== المفتاح =====
export function cleanKey(input) {
  const hex = String(input || '').replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 64) throw new BackupError('key_length', `المفتاح لازم يكون 64 خانة (كتبت ${hex.length})`);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
async function hmac(keyBytes, data) {
  const k = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}
// نفس طريقة واتساب: HKDF بسيط فوق مفتاح الـ 64 رقم مع "backup encryption"
async function deriveKey(root) {
  const prk = await hmac(new Uint8Array(32), root);
  const info = new TextEncoder().encode('backup encryption');
  const msg = new Uint8Array(info.length + 1); msg.set(info); msg[info.length] = 1;
  return (await hmac(prk, msg)).slice(0, 32);
}

// ===== رأس الملف (protobuf صغير فيه الـ IV) =====
function varint(b, o) { let r = 0, s = 0, x; do { x = b[o++]; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80 && o < b.length); return [r, o]; }
function fields(b) {
  const out = []; let o = 0;
  while (o < b.length) {
    let k; [k, o] = varint(b, o); const f = Math.floor(k / 8), t = k & 7;
    if (t === 0) { let v; [v, o] = varint(b, o); out.push([f, t, v]); }
    else if (t === 2) { let l; [l, o] = varint(b, o); out.push([f, t, b.subarray(o, o + l)]); o += l; }
    else if (t === 1) { out.push([f, t, b.subarray(o, o + 8)]); o += 8; }
    else if (t === 5) { out.push([f, t, b.subarray(o, o + 4)]); o += 4; }
    else break;
  }
  return out;
}
function findIV(pb) {
  try { for (const [f, t, v] of fields(pb)) if (t === 2 && f === 3) for (const [f2, t2, v2] of fields(v)) if (f2 === 1 && t2 === 2 && v2.length === 16) return v2; } catch {}
  const walk = (b, d = 0) => { try { for (const [, t, v] of fields(b)) { if (t === 2 && v.length === 16) return v; if (t === 2 && d < 4) { const r = walk(v, d + 1); if (r) return r; } } } catch {} return null; };
  return walk(pb);
}

// ===== AES-GCM كـ CTR (بدون فحص الختم، فحص الصحة بيصير من فك الضغط وقاعدة البيانات) =====
const toBig = b => b.reduce((a, x) => (a << 8n) | BigInt(x), 0n);
const fromBig = (n, len = 16) => { const o = new Uint8Array(len); for (let i = len - 1; i >= 0; i--) { o[i] = Number(n & 0xffn); n >>= 8n; } return o; };
function gfmul(X, Y) {
  const R = 0xE1n << 120n; let Z = 0n, V = Y;
  for (let i = 127n; i >= 0n; i--) { if ((X >> i) & 1n) Z ^= V; V = (V & 1n) ? (V >> 1n) ^ R : V >> 1n; }
  return Z;
}
async function makeCipher(keyBytes, iv) {
  const key = await subtle.importKey('raw', keyBytes, { name: 'AES-CTR' }, false, ['encrypt', 'decrypt']);
  let j0;
  if (iv.length === 12) { j0 = new Uint8Array(16); j0.set(iv); j0[15] = 1; }
  else {
    // J0 = GHASH(H, IV || len): H = AES(K, 0^128)
    const H = toBig(new Uint8Array(await subtle.encrypt({ name: 'AES-CTR', counter: new Uint8Array(16), length: 128 }, key, new Uint8Array(16))));
    let Y = 0n;
    for (let i = 0; i < iv.length; i += 16) { const blk = new Uint8Array(16); blk.set(iv.subarray(i, i + 16)); Y = gfmul(Y ^ toBig(blk), H); }
    Y = gfmul(Y ^ BigInt(iv.length * 8), H);
    j0 = fromBig(Y);
  }
  const base = ((j0[12] << 24) | (j0[13] << 16) | (j0[14] << 8) | j0[15]) >>> 0;
  return async (data, offset) => { // offset = مكان الدفعة جوّا النص المشفّر (من مضاعفات 16)
    const ctr = j0.slice(); const c = (base + 1 + offset / 16) >>> 0;
    ctr[12] = c >>> 24; ctr[13] = (c >>> 16) & 255; ctr[14] = (c >>> 8) & 255; ctr[15] = c & 255;
    return new Uint8Array(await subtle.decrypt({ name: 'AES-CTR', counter: ctr, length: 32 }, key, data));
  };
}

// ===== دفق الصفحات: فك تشفير → فك ضغط → صفحات SQLite بالترتيب =====
async function readHeader(file) {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (head.length < 64) throw new BackupError('not_backup', 'هاد مو ملف نسخة واتساب');
  let o = 0; const pbLen = head[o++]; if (head[o] === 1) o++;
  const iv = findIV(head.subarray(o, o + pbLen));
  if (!iv) throw new BackupError('not_backup', 'هاد مو ملف نسخة واتساب (msgstore.db.crypt15)');
  return { iv, bodyStart: o + pbLen };
}

// onPage(pageNo, bytes) → بترجع true لتوقيف القراءة. onBytes(نسبة) للتقدّم
// tail = قديش بايت بآخر الملف مو من النص المشفّر: 32 (ختم GCM + MD5) أو 16 (ختم GCM بس)
async function streamPages(file, decryptAt, bodyStart, tail, { onPage, onProgress, signal }) {
  const end = file.size - tail;
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  let stop = false, writeErr = null;
  const pump = (async () => {
    try {
      for (let off = bodyStart, rel = 0; off < end && !stop; off += CHUNK, rel += CHUNK) {
        if (signal?.aborted) throw new BackupError('aborted', 'انلغت');
        const buf = new Uint8Array(await file.slice(off, Math.min(end, off + CHUNK)).arrayBuffer());
        const plain = await decryptAt(buf, rel);
        if (rel === 0 && plain[0] !== 0x78) throw new BackupError('bad_key', 'المفتاح مو مطابق لهالنسخة');
        await writer.write(plain);
        onProgress?.(Math.min(1, (off + buf.length - bodyStart) / (end - bodyStart)));
      }
      if (!stop) await writer.close();
    } catch (e) { writeErr = e; try { await writer.abort(e); } catch {} }
  })();

  let pageSize = 0, pageNo = 0, pending = new Uint8Array(0), total = 0, dbPages = 0, usable = 0;
  try {
    while (true) {
      let r;
      try { r = await reader.read(); }
      catch (e) { // بيانات زيادة بعد نهاية الضغط (ختم MD5): طبيعي إذا وصلنا لآخر القاعدة
        if (pageSize && (dbPages ? pageNo >= dbPages : !pending.length)) break;
        if (writeErr) throw writeErr;
        if (!total) throw new BackupError('bad_key', 'المفتاح مو مطابق لهالنسخة');
        throw new BackupError('corrupt', 'الملف ناقص أو خربان: ' + (e.message || e));
      }
      if (r.done) break;
      let data = r.value; total += data.length;
      if (pending.length) { const m = new Uint8Array(pending.length + data.length); m.set(pending); m.set(data, pending.length); data = m; }
      let p = 0;
      if (!pageSize) {
        if (data.length < 100) { pending = data; continue; }
        if (new TextDecoder().decode(data.subarray(0, 15)) !== 'SQLite format 3') throw new BackupError('bad_key', 'المفتاح مو مطابق لهالنسخة');
        const ps = (data[16] << 8) | data[17]; pageSize = ps === 1 ? 65536 : ps; usable = pageSize - data[20];
        if (pageSize < 512 || pageSize & (pageSize - 1)) throw new BackupError('corrupt', 'قاعدة البيانات جوّا النسخة غريبة');
        dbPages = ((data[28] << 24) | (data[29] << 16) | (data[30] << 8) | data[31]) >>> 0;
      }
      while (data.length - p >= pageSize) {
        pageNo++;
        if (onPage(pageNo, data.subarray(p, p + pageSize), usable)) { stop = true; break; }
        p += pageSize;
      }
      pending = data.slice(p);
      if (stop) break;
    }
  } finally {
    stop = true;
    try { await reader.cancel(); } catch {}
    await pump.catch(() => {});
  }
  if (writeErr && writeErr.code === 'bad_key') throw writeErr;
  if (writeErr && writeErr.code === 'aborted') throw writeErr;
  if (!pageNo) throw new BackupError('bad_key', 'المفتاح مو مطابق لهالنسخة');
  return { pageSize, pages: pageNo, dbPages };
}

// ===== قراءة SQLite =====
function sqlVarint(b, o) {
  let r = 0n;
  for (let i = 0; i < 8; i++) { const x = b[o + i]; r = (r << 7n) | BigInt(x & 0x7f); if (!(x & 0x80)) return [r, o + i + 1]; }
  return [(r << 8n) | BigInt(b[o + 8]), o + 9];
}
const sv = (b, o) => { const [v, n] = sqlVarint(b, o); return [Number(v), n]; };
const td = new TextDecoder();
function readRecord(p) {
  const out = []; let [hsz, o] = sv(p, 0); const types = [];
  while (o < hsz && o < p.length) { let t; [t, o] = sv(p, o); types.push(t); }
  let d = hsz;
  for (const t of types) {
    if (d > p.length) { out.push(undefined); continue; }
    if (t === 0) out.push(null);
    else if (t >= 1 && t <= 6) {
      const n = [0, 1, 2, 3, 4, 6, 8][t]; let v = 0n;
      for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(p[d + i] ?? 0);
      if (n && (p[d] & 0x80)) v -= 1n << BigInt(n * 8);
      out.push(Number(v)); d += n;
    } else if (t === 7) { out.push(new DataView(p.buffer, p.byteOffset + d, 8).getFloat64(0)); d += 8; }
    else if (t === 8) out.push(0); else if (t === 9) out.push(1);
    else if (t >= 12 && t % 2 === 0) { const n = (t - 12) / 2; out.push(p.subarray(d, d + n)); d += n; }
    else if (t >= 13) { const n = (t - 13) / 2; out.push(td.decode(p.subarray(d, Math.min(p.length, d + n)))); d += n; }
    else out.push(null);
  }
  return out;
}
const hdrOff = no => (no === 1 ? 100 : 0);
function pageType(no, pg) { return pg[hdrOff(no)]; }
function interiorChildren(no, pg) {
  const h = hdrOff(no), n = (pg[h + 3] << 8) | pg[h + 4];
  const kids = [];
  for (let i = 0; i < n; i++) { const cp = (pg[h + 12 + i * 2] << 8) | pg[h + 13 + i * 2]; kids.push(((pg[cp] << 24) | (pg[cp + 1] << 16) | (pg[cp + 2] << 8) | pg[cp + 3]) >>> 0); }
  kids.push(((pg[h + 8] << 24) | (pg[h + 9] << 16) | (pg[h + 10] << 8) | pg[h + 11]) >>> 0);
  return kids;
}
function leafRows(no, pg, usable) {
  const h = hdrOff(no), n = (pg[h + 3] << 8) | pg[h + 4], rows = [];
  const X = usable - 35, M = Math.floor(((usable - 12) * 32) / 255) - 23;
  for (let i = 0; i < n; i++) {
    try {
      let o = (pg[h + 8 + i * 2] << 8) | pg[h + 9 + i * 2];
      let P; [P, o] = sv(pg, o); let rowid; [rowid, o] = sv(pg, o);
      let local = P;
      if (P > X) { const K = M + ((P - M) % (usable - 4)); local = K <= X ? K : M; }
      rows.push([rowid, readRecord(pg.subarray(o, o + local))]);
    } catch {}
  }
  return rows;
}
// أعمدة الجدول من جملة CREATE TABLE (مشان نعرف وين عمود الرقم)
function columnsOf(sql) {
  const s = String(sql || ''); const i = s.indexOf('('); if (i < 0) return [];
  const body = s.slice(i + 1); const cols = []; let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') { if (!depth) { cols.push(cur); break; } depth--; }
    if (ch === ',' && !depth) { cols.push(cur); cur = ''; continue; }
    cur += ch;
  }
  return cols.map(c => c.trim()).filter(c => c && !/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i.test(c))
    .map(c => { const name = c.replace(/^["`\[]?([^"`\]\s]+)["`\]]?.*$/s, '$1'); return { name, ipk: /^\S+\s+INTEGER\s+PRIMARY\s+KEY/i.test(c) }; });
}

// ===== الدالة الرئيسية =====
// بترجع { numbers: [...], chats, hidden } — numbers = أرقام المحادثات الفردية بدون تكرار
export async function readWhatsAppBackup(file, keyInput, { onProgress, signal } = {}) {
  const root = cleanKey(keyInput);
  if (!file || file.size < 1000) throw new BackupError('not_backup', 'الملف فاضي أو صغير كتير');
  const { iv, bodyStart } = await readHeader(file);
  const decryptAt = await makeCipher(await deriveKey(root), iv);

  // الجولة 1: هيكل القاعدة (الجداول وصفحاتها)
  let interior, schema, tail = 32, p1;
  const pass1 = async t => {
    interior = new Map();             // صفحة داخلية -> صفحات تحتها
    schema = new Map();               // اسم الجدول -> { root, cols }
    const masterPages = new Set([1]); // صفحات جدول sqlite_master
    return streamPages(file, decryptAt, bodyStart, t, {
      signal, onProgress: f => onProgress?.({ stage: 1, fraction: f }),
      onPage(no, pg, usable) {
        const ty = pageType(no, pg);
        if (ty === 0x05) { const kids = interiorChildren(no, pg); interior.set(no, kids); if (masterPages.has(no)) kids.forEach(k => masterPages.add(k)); }
        else if (ty === 0x0D && masterPages.has(no)) {
          for (const [, r] of leafRows(no, pg, usable)) if (r[0] === 'table' && typeof r[1] === 'string' && Number.isInteger(r[3])) schema.set(r[1], { root: r[3], cols: columnsOf(r[4]) });
        }
        return false;
      }
    });
  };
  // أغلب النسخ آخرها ختم + MD5 (32 بايت). إذا ما زبط، منجرّب بختم بس (16)
  try { p1 = await pass1(32); }
  catch (e) { if (e.code !== 'corrupt') throw e; tail = 16; p1 = await pass1(16); }
  const need = ['jid', 'chat', 'jid_map'].filter(n => schema.has(n));
  if (!schema.has('jid') || !schema.has('chat')) throw new BackupError('not_msgstore', 'هالملف ما فيه محادثات واتساب (يمكن مو msgstore)');
  const leafOf = new Map(); // صفحة ورقة -> اسم الجدول
  for (const name of need) {
    const stack = [schema.get(name).root];
    while (stack.length) { const pno = stack.pop(); const kids = interior.get(pno); if (kids) stack.push(...kids); else leafOf.set(pno, name); }
  }
  const maxPage = Math.max(...leafOf.keys());

  // الجولة 2: منقرا صفحات الجداول التلاتة بس، ومنوقف بعد آخر صفحة منحتاجها
  const jids = new Map(), chats = [], lidToPn = new Map(), chatTs = new Map();
  const ci = name => { const cols = schema.get(name)?.cols || []; return n => cols.findIndex(c => c.name.toLowerCase() === n); };
  const J = ci('jid'), C = ci('chat'), JM = ci('jid_map');
  const jUser = J('user') >= 0 ? J('user') : 1, jServer = J('server') >= 0 ? J('server') : 2;
  const cJid = C('jid_row_id') >= 0 ? C('jid_row_id') : 1;
  const cTs = ['created_timestamp', 'sort_timestamp'].map(C).filter(i => i >= 0); // تاريخ المحادثة (لنعرف القديم من الجديد)
  const mLid = JM('lid_row_id') >= 0 ? JM('lid_row_id') : 0, mJid = JM('jid_row_id') >= 0 ? JM('jid_row_id') : 1;
  const ipk = name => (schema.get(name)?.cols || []).findIndex(c => c.ipk);
  const val = (name, row, rowid, idx) => (idx === ipk(name) && row[idx] == null ? rowid : row[idx]);
  await streamPages(file, decryptAt, bodyStart, tail, {
    signal, onProgress: f => onProgress?.({ stage: 2, fraction: Math.min(1, f * (p1.pages / Math.max(1, maxPage))) }),
    onPage(no, pg, usable) {
      const name = leafOf.get(no);
      if (name && pageType(no, pg) === 0x0D) {
        for (const [rowid, r] of leafRows(no, pg, usable)) {
          if (name === 'jid') jids.set(rowid, [r[jUser], r[jServer]]);
          else if (name === 'chat') { const j = val('chat', r, rowid, cJid); if (Number.isInteger(j)) { chats.push(j); const ts = cTs.map(i => Number(r[i]) || 0).filter(v => v > 1e9); if (ts.length) chatTs.set(j, Math.min(...ts)); } }
          else { const l = val('jid_map', r, rowid, mLid), j = val('jid_map', r, rowid, mJid); if (Number.isInteger(l) && Number.isInteger(j)) lidToPn.set(l, j); }
        }
      }
      return no >= maxPage;
    }
  });

  const out = new Set(), dated = new Map(); let hidden = 0, people = 0;
  for (const jr of chats) {
    const j = jids.get(jr); if (!j) continue;
    let [user, server] = j;
    if (server === 'lid') { const pn = jids.get(lidToPn.get(jr)); if (!pn || pn[1] !== 's.whatsapp.net') continue; user = pn[0]; hidden++; }
    else if (server !== 's.whatsapp.net') continue;
    const num = String(user || '').replace(/\D/g, '');
    if (num.length < 8 || num.length > 15) continue;
    people++; out.add(num);
    const t = chatTs.get(jr); if (t) { const s = t > 1e12 ? Math.floor(t / 1000) : t; if (!dated.has(num) || s < dated.get(num)) dated.set(num, s); }
  }
  return { numbers: [...out], dated: [...out].map(n => [n, dated.get(n) || 0]), chats: chats.length, people, hidden };
}
