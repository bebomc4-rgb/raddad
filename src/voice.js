// إضافة منتج بالصوت: الصوت ← نص ← حقول المنتج (اسم، سعر، قياسات…)
import { config } from './config.js';
import { q } from './db.js';
import { resolveAI, chat, parseJSON, AIError } from './ai.js';
import { cfTranscribe } from './media.js';

const STT = {
  groq: { model: 'whisper-large-v3' },
  openai: { model: 'whisper-1' }
};

function extOf(mime = '') {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  return 'webm';
}

async function whisper(p, buf, mime, lang) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime || 'audio/webm' }), 'voice.' + extOf(mime));
  fd.append('model', STT[p.provider].model);
  fd.append('language', lang === 'en' ? 'en' : 'ar');
  fd.append('response_format', 'json');
  fd.append('prompt', 'منتج، سعر، دولار، ليرة، قياس، مقاسات، لون، أسود، أبيض، خصم');
  const res = await fetch(p.base_url.replace(/\/$/, '') + '/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${p.key}` }, body: fd, signal: AbortSignal.timeout(60_000)
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new AIError(d?.error?.message || `فشل تحويل الصوت (${res.status})`, res.status);
  return String(d.text || '').trim();
}

// Gemini بيسمع الصوت مباشرة
async function geminiListen(p, buf, mime, lang) {
  const url = `${(p.base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')}/models/${encodeURIComponent(p.model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [
        { text: 'اكتب حرفياً شو انقال بهالتسجيل الصوتي (عربي، ممكن لهجة سورية). اكتب النص بس، بدون أي شرح.' },
        { inline_data: { mime_type: (mime || 'audio/webm').split(';')[0], data: buf.toString('base64') } }
      ] }],
      generationConfig: { temperature: 0 }
    }),
    signal: AbortSignal.timeout(60_000)
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new AIError(d?.error?.message || `فشل تحويل الصوت (${res.status})`, res.status);
  return (d?.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('').trim();
}

export async function transcribe(tenant, buf, mime, lang = 'ar') {
  if (config.mockAI) return 'حذاء رياضي أسود سعره خمسة وتمانين دولار القياسات من أربعين لخمسة وأربعين';
  let lastErr = null;
  try { const t = await cfTranscribe(tenant, buf, lang); if (t) return t; } catch (e) { lastErr = e; }
  const providers = resolveAI(tenant);
  for (const p of providers) {
    try {
      if (STT[p.provider]) return await whisper(p, buf, mime, lang);
      if (p.kind === 'gemini') return await geminiListen(p, buf, mime, lang);
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  throw new AIError('تحويل الصوت لنص بيحتاج Cloudflare أو Groq أو Gemini أو OpenAI بإعدادات الذكاء الاصطناعي. أو اكتب الوصف بدل الصوت.', 0);
}

export async function extractProduct(tenant, text) {
  const cats = q.all(`SELECT DISTINCT category c FROM products WHERE tenant_id = ? AND category IS NOT NULL AND category != '' LIMIT 40`, tenant.id).map(r => r.c);
  const currency = tenant.knowledge.currency || 'USD';
  if (config.mockAI) {
    const nums = String(text).match(/\d+(\.\d+)?/g) || [];
    return { name: String(text).split(/سعر|بسعر/)[0].trim().slice(0, 80) || 'منتج', price: nums[0] ? Number(nums[0]) : null, options: '', category: cats[0] || '', description: '', tags: '' };
  }
  const system = `أنت مساعد بيرتّب بيانات منتج لمتجر من وصف صوتي حكاه صاحب المتجر (ممكن بلهجة سورية وفيه أخطاء تحويل صوت).
أرجع JSON فقط بهالشكل:
{"name":"","price":null,"sale_price":null,"currency":"","category":"","options":"","stock":null,"description":"","tags":""}
القواعد:
- حوّل الأرقام المكتوبة بالكلام لأرقام: "خمسة وتمانين" = 85، "ميتين وخمسين ألف" = 250000.
- إذا قال "كان بـ X وصار بـ Y" أو "عليه خصم": price = X و sale_price = Y. وإلا sale_price = null.
- currency: إذا ذكر عملة (دولار=USD، ليرة=ل.س، يورو=EUR) وإلا "${currency}".
- options: القياسات والألوان والخيارات بشكل مرتب، مثلاً: "القياسات 40-45 | الألوان: أسود، أبيض".
- category: اختار من هالتصنيفات إذا مناسب: ${cats.length ? cats.join('، ') : '(ما في تصنيفات بعد، اقترح تصنيف قصير مناسب)'}.
- stock: بس إذا ذكر كمية.
- name: اسم واضح ومرتب للمنتج (مع الماركة إذا ذكرها). صحّح أخطاء التحويل الواضحة (مثلاً "نايكي" ← "نايك").
- description: جملة أو جملتين جذابتين **بس من المعلومات يلي انذكرت**، بدون اختراع مواصفات.
- tags: كلمات تانية ممكن يستخدمها الزبائن للبحث عن هالمنتج (مرادفات بالعامية)، مفصولة بفاصلة.
- لا تخترع سعر أو قياس ما انذكر: خليه null أو "".`;
  const { text: out } = await chat(resolveAI(tenant), { system, messages: [{ role: 'user', content: text }], json: true, temperature: 0.2, maxTokens: 500 });
  const d = parseJSON(out);
  if (!d || !d.name) throw new AIError('ما قدرت افهم المنتج من الكلام. جرّب احكي الاسم والسعر بوضوح.', 0);
  return d;
}
