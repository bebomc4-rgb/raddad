// تعليم الوكيل أسلوب صاحب المتجر من محادثات واتساب الحقيقية
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { q, tx } from './db.js';
import { normalize, tokens, stem, clamp } from './text.js';
import { chat, resolveAI, parseJSON } from './ai.js';

// ===== قراءة ملفات تصدير واتساب =====
const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g;
const AR_NUM = s => s.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
// أمثلة:  23/10/2026, 5:55 am - Ahmad: مرحبا   |   [23/10/2026, 5:55:12 AM] Ahmad: مرحبا   |   ٢٣/١٠/٢٠٢٦، ٥:٥٥ ص - أحمد: مرحبا
const LINE = /^\[?(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4})[,،]?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([APap]\.?\s?[Mm]\.?|ص|م)?\]?\s*(?:[-–]\s*)?([^:]{1,60}?):\s?(.*)$/;
const SKIP = /^(<.*(omitted|محذوف|استبعاد|مرفق).*>|<attached:.*>|this message was deleted|تم حذف هذه الرسالة|you deleted this message|حذفت هذه الرسالة|null|‎?image omitted|‎?video omitted|‎?audio omitted|‎?sticker omitted|<Media omitted>|<تم استبعاد الوسائط>|missed voice call|missed video call|مكالمة صوتية فائتة)$/i;

export function parseExport(raw) {
  const text = AR_NUM(String(raw).replace(BIDI, '')).replace(/\r\n?/g, '\n');
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(LINE);
    if (m) {
      const name = m[4].trim();
      const body = m[5].trim();
      out.push({ name, text: body });
    } else if (out.length && line.trim()) {
      out[out.length - 1].text += '\n' + line.trim(); // تكملة رسالة بعدة أسطر
    }
  }
  return out.filter(x => x.text && !SKIP.test(x.text.trim()) && !/\.(jpg|jpeg|png|webp|opus|mp4|pdf|vcf)\s*\(.*\)$/i.test(x.text));
}

// فك ملف zip (تصدير آيفون بيطلع zip فيه _chat.txt) بدون مكتبات
export function unzipTexts(buf) {
  const files = [];
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return files;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count && p < buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + elen + clen;
    if (!/\.txt$/i.test(name) || csize > 50 * 1024 * 1024) continue;
    const lnl = buf.readUInt16LE(local + 26), lel = buf.readUInt16LE(local + 28);
    const data = buf.slice(local + 30 + lnl + lel, local + 30 + lnl + lel + csize);
    try { files.push({ name, text: (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8') }); } catch {}
  }
  return files;
}

// ===== تحويل المحادثة لأزواج: سؤال الزبون ← رد صاحب المتجر =====
export function buildPairs(msgs) {
  // دمج الرسائل المتتالية لنفس الطرف
  const blocks = [];
  for (const m of msgs) {
    const last = blocks[blocks.length - 1];
    if (last && last.me === m.me) last.text += '\n' + m.text;
    else blocks.push({ me: m.me, text: m.text });
  }
  const pairs = [];
  for (let i = 1; i < blocks.length; i++) {
    const c = blocks[i - 1], o = blocks[i];
    if (c.me || !o.me) continue;
    const qq = c.text.trim(), aa = o.text.trim();
    if (qq.length < 2 || aa.length < 2) continue;
    pairs.push({ q: clamp(qq, 600), a: clamp(aa, 800) });
  }
  return pairs;
}

const normQ = s => tokens(s).map(stem).join(' ');

// ردود ما بتعلّم شي: رسالة «مو متواجدين» الأوتوماتيكية، رسائل صوت/صور ما انفهمت، ومجاملات قصيرة
const AWAY = /(غير متوفرين|غير متواجدين|مو متواجدين|سنرد عليك|رح نرد عليك|بأقرب وقت|في أسرع وقت|الدوام من|اوقات الدوام|أوقات الدوام|خارج الدوام|auto.?reply)/i;
const MEDIA = /^\s*(\[العميل بعت|🎤|📷|\(رسالة صوتية|\(صورة)/;
export function isJunk(qq, aa) {
  const Q = String(qq || '').trim(), A = String(aa || '').trim();
  if (!Q || !A) return true;
  if (AWAY.test(A) || MEDIA.test(Q) || /العميل بعت رسالة صوتية/.test(Q)) return true;
  if (A.length < 12 && Q.length < 20) return true; // «تكرم» ← «الله يسلمك»
  return false;
}
export function cleanExamples(tenantId) {
  const rows = q.all('SELECT id, q, a FROM style_examples WHERE tenant_id = ?', tenantId);
  const bad = rows.filter(r => isJunk(r.q, r.a)).map(r => r.id);
  // نفس الرد مكرر كتير (غالباً رد جاهز): منخلي أول 3 بس
  const seen = new Map();
  for (const r of rows) { if (bad.includes(r.id)) continue; const k = normalize(r.a).slice(0, 60); const n = (seen.get(k) || 0) + 1; seen.set(k, n); if (n > 3) bad.push(r.id); }
  if (bad.length) tx(() => { for (const id of bad) q.run('DELETE FROM style_examples WHERE id = ?', id); });
  cache.delete(tenantId);
  return bad.length;
}
const cleaned = new Set();
function autoClean(tenantId) { if (cleaned.has(tenantId)) return; cleaned.add(tenantId); try { const n = cleanExamples(tenantId); if (n) console.log(`[learn] tenant ${tenantId}: removed ${n} useless examples`); } catch (e) { console.error('[learn] clean', e.message); } }
const sigOf = (qq, aa) => crypto.createHash('sha1').update(normalize(qq) + '|' + normalize(aa)).digest('hex');
const cache = new Map(); // tenantId -> rows

export function savePairs(tenantId, pairs, source = 'import') {
  let added = 0;
  tx(() => {
    for (const p of pairs) {
      if (isJunk(p.q, p.a)) continue;
      const r = q.run('INSERT OR IGNORE INTO style_examples (tenant_id, q, a, q_norm, sig, source) VALUES (?, ?, ?, ?, ?, ?)',
        tenantId, p.q, p.a, normQ(p.q), sigOf(p.q, p.a), source);
      added += Number(r.changes || 0);
    }
  });
  cache.delete(tenantId);
  return added;
}

// أمثلة شبيهة بسؤال الزبون الحالي
export function similarExamples(tenantId, text, k = 4) {
  autoClean(tenantId);
  let rows = cache.get(tenantId);
  if (!rows) {
    rows = q.all('SELECT id, q, a, q_norm FROM style_examples WHERE tenant_id = ? ORDER BY id DESC LIMIT 20000', tenantId)
      .filter(r => r.a.length >= 12 && r.q.length >= 4 && r.q_norm.split(' ').length >= 2) // منتجاهل المجاملات القصيرة
      .map(r => ({ ...r, set: new Set(r.q_norm.split(' ').filter(Boolean)) }));
    cache.set(tenantId, rows);
  }
  if (!rows.length) return [];
  const words = [...new Set(normQ(text).split(' ').filter(w => w.length > 1))];
  const scored = [];
  if (words.length) {
    for (const r of rows) {
      let s = 0;
      for (const w of words) if (r.set.has(w)) s++;
      if (s) scored.push([s / Math.sqrt(r.set.size + 1), r]);
    }
  }
  scored.sort((a, b) => b[0] - a[0]);
  const picked = [];
  const seenA = new Set();
  for (const [, r] of scored) {
    const key = normalize(r.a).slice(0, 40);
    if (seenA.has(key)) continue; // ما منكرر نفس الرد
    seenA.add(key); picked.push(r);
    if (picked.length >= k) break;
  }
  // منكمّل بأمثلة عشوائية غنية (ردود فيها كلام) ليتعلّم الأسلوب العام
  const rich = rows.filter(r => r.a.length >= 30 && r.a.length <= 400 && !picked.includes(r));
  for (let i = 0; picked.length < Math.min(k, 4) && i < 20 && rich.length; i++) {
    const r = rich[Math.floor(Math.random() * rich.length)];
    if (!picked.includes(r)) picked.push(r);
  }
  return picked.map(r => ({ q: clamp(r.q, 300), a: clamp(r.a, 400) }));
}

export function styleStats(tenantId) {
  autoClean(tenantId);
  const by = Object.fromEntries(q.all('SELECT source, COUNT(*) n FROM style_examples WHERE tenant_id = ? GROUP BY source', tenantId).map(r => [r.source, r.n]));
  const samples = q.all('SELECT id, q, a, source FROM style_examples WHERE tenant_id = ? ORDER BY id DESC LIMIT 6', tenantId);
  return { total: Object.values(by).reduce((a, b) => a + b, 0), by, samples };
}

export function clearExamples(tenantId) {
  q.run('DELETE FROM style_examples WHERE tenant_id = ?', tenantId);
  cache.delete(tenantId);
}

// تحليل الأسلوب: الذكاء الاصطناعي بيقرا عينة ويكتب ملخص بيتبعه الوكيل
export async function analyzeStyle(tenant) {
  const rows = q.all('SELECT q, a FROM style_examples WHERE tenant_id = ? ORDER BY RANDOM() LIMIT 50', tenant.id);
  if (rows.length < 5) throw new Error('بدنا 5 أمثلة على الأقل لنحلل أسلوبك. استورد محادثات أكتر.');
  const sample = rows.map((r, i) => `${i + 1}) الزبون: ${clamp(r.q, 200)}\n   صاحب المتجر: ${clamp(r.a, 300)}`).join('\n');
  const system = `أنت محلل أسلوب كتابة. رح تقرا ردود حقيقية لصاحب متجر على زبائنه بواتساب.
اكتب وصف مختصر لأسلوبه بنقاط (8 لـ 12 نقطة)، بالعربي، ليقلّده موظف جديد. ركّز على:
- اللهجة والكلمات المميزة يلي بيكررها، وطريقة الترحيب والختام.
- طول الردود، واستخدام الإيموجي.
- كيف بيجاوب على السعر، والتوصيل، والمقاسات، والاعتراضات، وكيف بيسكّر البيعة.
- شو ما بيعمل أبداً.
لا تذكر أسعار أو أرقام أو أسماء زبائن. أرجع JSON: {"profile":"النقاط، كل نقطة بسطر يبلش بـ - "}`;
  const { text } = await chat(resolveAI(tenant), { system, messages: [{ role: 'user', content: sample }], json: true, temperature: 0.3, maxTokens: 700 });
  const d = parseJSON(text);
  const profile = String(d?.profile || text || '').trim();
  if (!profile) throw new Error('ما قدرنا نحلل الأسلوب، جرّب مرة تانية');
  return clamp(profile, 2500);
}

// تعلّم من رد صاحب المتجر الحي (من موبايله أو من اللوحة)
export function learnFromLive(tenantId, contactId) {
  const msgs = q.all('SELECT direction, sender, body FROM (SELECT * FROM messages WHERE contact_id = ? ORDER BY id DESC LIMIT 12) ORDER BY id', contactId);
  // آخر رد بشري مع رسائل الزبون يلي قبله مباشرة
  let i = msgs.length - 1;
  if (i < 0 || msgs[i].sender !== 'human') return 0;
  let a = [];
  while (i >= 0 && msgs[i].sender === 'human') a.unshift(msgs[i--].body);
  const qq = [];
  while (i >= 0 && msgs[i].direction === 'in') qq.unshift(msgs[i--].body);
  if (!qq.length) return 0;
  return savePairs(tenantId, [{ q: clamp(qq.join('\n'), 600), a: clamp(a.join('\n'), 800) }], 'live');
}
