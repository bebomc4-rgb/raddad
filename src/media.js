// فهم الصوت والصور: الوكيل بيسمع الرسائل الصوتية وبيشوف الصور متل الإنسان
// بيستخدم Cloudflare Workers AI (من نفس المفتاح المجاني)، أو أي مزوّد بيدعم الصور (موديل محلي فيه رؤية، OpenAI…)
import { config } from './config.js';
import { resolveAI, AIError } from './ai.js';
import { clamp } from './text.js';

const CF_WHISPER = '@cf/openai/whisper-large-v3-turbo';
const CF_WHISPER_OLD = '@cf/openai/whisper';
const CF_VISION = '@cf/meta/llama-3.2-11b-vision-instruct';

// رابط تشغيل الموديلات من رابط Cloudflare تبع المنصة: .../accounts/ID/ai/v1 → .../accounts/ID/ai/run/
function cfRunBase(p) {
  const m = String(p.base_url || '').match(/^(https?:\/\/[^/]+\/client\/v4\/accounts\/[a-f0-9]{32})\//i);
  return m ? `${m[1]}/ai/run/` : null;
}
function cloudflareSlots(tenant) {
  return resolveAI(tenant).filter(p => p.provider === 'cloudflare' && cfRunBase(p) && p.key);
}

async function cfRun(p, model, body, isBinary = false) {
  const res = await fetch(cfRunBase(p) + model, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key}`, ...(isBinary ? {} : { 'Content-Type': 'application/json' }) },
    body: isBinary ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000)
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.success === false) {
    const msg = d?.errors?.[0]?.message || `Cloudflare (${res.status})`;
    throw new AIError(msg, res.status);
  }
  return d.result || {};
}

// ===== الصوت ← نص =====
export async function cfTranscribe(tenant, buf, lang = 'ar') {
  const slots = cloudflareSlots(tenant);
  if (!slots.length) return null;
  let lastErr;
  for (const p of slots) {
    try {
      const r = await cfRun(p, CF_WHISPER, { audio: buf.toString('base64'), language: lang, vad_filter: true, initial_prompt: 'محادثة مع متجر: سعر، مقاس، توصيل، طلب' });
      if (r.text != null) return String(r.text).trim();
    } catch (e) { lastErr = e; }
    try {
      const r = await cfRun(p, CF_WHISPER_OLD, buf, true); // النسخة الأقدم بتاخد الصوت مباشرة
      if (r.text != null) return String(r.text).trim();
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return null;
}

// ===== الصورة ← وصف =====
const VISION_PROMPT = `أنت عيون موظف مبيعات بمتجر. الزبون بعت هالصورة على واتساب.
اوصف بالعربي بجملة أو تنتين وبشكل دقيق: شو هالشي (نوع المنتج)، اللون، الماركة أو الشعار إذا ظاهر، أي كتابة أو رقم أو مقاس ظاهر بالصورة.
إذا الصورة لقطة شاشة لطلب أو إيصال أو محادثة، اكتب أهم المعلومات المكتوبة فيها. لا تخترع شي مو ظاهر.`;

export async function describeImage(tenant, buf, mime = 'image/jpeg') {
  if (config.mockAI) return 'حذاء رياضي أبيض عليه شعار نايك';
  const dataUri = `data:${(mime || 'image/jpeg').split(';')[0]};base64,${buf.toString('base64')}`;
  let lastErr;
  // 1) Cloudflare (رؤية مجانية ضمن الحصة)
  for (const p of cloudflareSlots(tenant)) {
    const run = () => cfRun(p, CF_VISION, { messages: [{ role: 'user', content: VISION_PROMPT }], image: dataUri, max_tokens: 200 });
    try {
      const r = await run();
      if (r.response) return clamp(String(r.response).trim(), 600);
    } catch (e) {
      lastErr = e;
      // أول مرة بيطلب الموافقة على ترخيص الموديل
      if (/agree|licen/i.test(e.message)) {
        try { await cfRun(p, CF_VISION, { prompt: 'agree' }); const r = await run(); if (r.response) return clamp(String(r.response).trim(), 600); }
        catch (e2) { lastErr = e2; }
      }
    }
  }
  // 2) أي مزوّد متوافق مع OpenAI وموديله بيدعم الصور (مثلاً موديل محلي فيه رؤية، أو OpenAI)
  for (const p of resolveAI(tenant)) {
    if (p.kind !== 'openai_compat' || p.provider === 'cloudflare') continue;
    try {
      const res = await fetch(p.base_url.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({ model: p.model, max_tokens: 200, temperature: 0.2, messages: [{ role: 'user', content: [
          { type: 'text', text: VISION_PROMPT }, { type: 'image_url', image_url: { url: dataUri } }] }] }),
        signal: AbortSignal.timeout(90_000)
      });
      const d = await res.json().catch(() => ({}));
      const text = d?.choices?.[0]?.message?.content;
      if (res.ok && text) return clamp(String(text).trim(), 600);
      lastErr = new AIError(d?.error?.message || `vision ${res.status}`, res.status);
    } catch (e) { lastErr = e; }
  }
  // 3) Gemini بيشوف الصور
  for (const p of resolveAI(tenant)) {
    if (p.kind !== 'gemini') continue;
    try {
      const url = `${(p.base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')}/models/${encodeURIComponent(p.model)}:generateContent`;
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: VISION_PROMPT }, { inline_data: { mime_type: dataUri.slice(5, dataUri.indexOf(';')), data: buf.toString('base64') } }] }] }),
        signal: AbortSignal.timeout(90_000)
      });
      const d = await res.json().catch(() => ({}));
      const text = (d?.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('');
      if (res.ok && text) return clamp(text.trim(), 600);
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return null;
}
