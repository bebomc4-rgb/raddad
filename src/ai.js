// مزوّدي الذكاء الاصطناعي: Gemini + أي مزوّد متوافق مع OpenAI (Groq, OpenRouter, Cerebras, Cloudflare, DeepSeek, OpenAI...)
import fs from 'node:fs';
import path from 'node:path';
import { config, DATA_DIR } from './config.js';
import { getSetting, q } from './db.js';
import { decrypt } from './security.js';

export const PRESETS = {
  groq:       { label: 'Groq (مجاني وسريع جداً)', kind: 'openai_compat', base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  gemini:     { label: 'Google Gemini (مجاني بحدود)', kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-flash-lite-latest', keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { label: 'OpenRouter (نماذج مجانية ومدفوعة)', kind: 'openai_compat', base_url: 'https://openrouter.ai/api/v1', model: 'google/gemma-4-31b-it:free', keyUrl: 'https://openrouter.ai/keys' },
  cerebras:   { label: 'Cerebras (مجاني بحدود)', kind: 'openai_compat', base_url: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b', keyUrl: 'https://cloud.cerebras.ai' },
  cloudflare: { label: 'Cloudflare Workers AI', kind: 'openai_compat', base_url: 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', keyUrl: 'https://dash.cloudflare.com/profile/api-tokens' },
  mistral:    { label: 'Mistral (مجاني للتجربة، عربي منيح)', kind: 'openai_compat', base_url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', keyUrl: 'https://console.mistral.ai/api-keys' },
  zai:        { label: 'Z.ai GLM (صيني، موديل Flash مجاني)', kind: 'openai_compat', base_url: 'https://api.z.ai/api/paas/v4', model: 'glm-4.5-flash', keyUrl: 'https://z.ai/manage-apikey/apikey-list' },
  siliconflow:{ label: 'SiliconFlow (صيني، Qwen مجاني)', kind: 'openai_compat', base_url: 'https://api.siliconflow.com/v1', model: 'Qwen/Qwen3-8B', keyUrl: 'https://cloud.siliconflow.com/account/ak' },
  cohere:     { label: 'Cohere (مفتاح تجربة مجاني)', kind: 'openai_compat', base_url: 'https://api.cohere.ai/compatibility/v1', model: 'command-a-03-2025', keyUrl: 'https://dashboard.cohere.com/api-keys' },
  deepseek:   { label: 'DeepSeek (رخيص جداً)', kind: 'openai_compat', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  openai:     { label: 'OpenAI', kind: 'openai_compat', base_url: 'https://api.openai.com/v1', model: '', keyUrl: 'https://platform.openai.com/api-keys' },
  custom:     { label: 'مزوّد آخر متوافق مع OpenAI', kind: 'openai_compat', base_url: '', model: '' }
};

export class AIError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

// إعدادات الذكاء الاصطناعي الفعلية لمشترك معيّن (مفتاحه، أو مفتاح المنصة)
// كل العقول (الموديلات) بقائمة وحدة. كل عقل إله مستوى: smart (ذكي/كبير) أو fast (سريع/محلي)
export function getBrains() {
  let list = getSetting('ai_brains', null);
  if (!Array.isArray(list)) { // ترحيل من النظام القديم (أساسي + احتياطي)
    const p = getSetting('platform_ai', {});
    list = [];
    if (p.primary?.key_enc) list.push({ id: 'b1', name: nameOf(p.primary.provider, p.primary.model), level: 'smart', enabled: true, ...p.primary });
    if (p.fallback?.key_enc) list.push({ id: 'b2', name: nameOf(p.fallback.provider, p.fallback.model), level: 'fast', enabled: true, ...p.fallback });
  }
  return list;
}
export function nameOf(provider, model) {
  const base = { groq: 'Groq', gemini: 'Gemini', openrouter: 'OpenRouter', cerebras: 'Cerebras', cloudflare: 'Cloudflare', deepseek: 'DeepSeek', openai: 'OpenAI', mistral: 'Mistral', zai: 'GLM', siliconflow: 'SiliconFlow', cohere: 'Cohere' }[provider];
  if (base) return base;
  if (/localhost|127\.0\.0\.1/.test(model || '')) return 'المحلي';
  return 'المحلي';
}

// prefer: 'smart' = سؤال معقد → العقول الذكية أولاً | 'light' = سؤال بسيط → السريعة أولاً
export function resolveAI(tenant, { prefer = 'smart' } = {}) {
  if (config.mockAI) return [{ kind: 'mock', slot: 'mock', name: 'تجريبي' }];
  // متجر صاحب المنصة دايماً بيستخدم صفحة العقول، حتى لو في مفتاح قديم محفوظ عليه
  const isOwner = tenant && q.get('SELECT 1 FROM users WHERE tenant_id = ? AND is_super = 1', tenant.id);
  if (tenant && !isOwner && tenant.ai_provider !== 'platform' && tenant.ai_key_enc) {
    const preset = PRESETS[tenant.ai_provider] || PRESETS.custom;
    return [{
      provider: tenant.ai_provider, slot: 'own', name: 'مفتاح المتجر',
      kind: preset.kind,
      base_url: tenant.ai_base_url || preset.base_url,
      model: (tenant.ai_model || '').trim() || preset.model,
      key: decrypt(tenant.ai_key_enc)
    }];
  }
  const list = getBrains().filter(b => b.enabled !== false && b.key_enc).map(b => {
    const preset = PRESETS[b.provider] || PRESETS.custom;
    return { slot: b.id, name: b.name || nameOf(b.provider), level: b.level || 'smart', provider: b.provider, kind: preset.kind, base_url: b.base_url || preset.base_url, model: (b.model || '').trim() || preset.model, key: decrypt(b.key_enc).trim() };
  });
  // وضع تجربة المحلي: إذا الملف data/local-only.txt فيه on، منستعمل بس العقل المحلي (llama) لكل المتاجر
  try { if (/^\s*on/i.test(fs.readFileSync(path.join(DATA_DIR, 'local-only.txt'), 'utf8'))) { const loc = list.filter(isLocal); if (loc.length) return loc; console.error('[ai] local-only: ما في عقل محلي مفعّل، رجعنا للعادي'); } } catch {}
  if (!getSetting('ai_routing', true)) return list;
  const first = prefer === 'light' ? 'fast' : 'smart';
  let out = [...list.filter(b => b.level === first), ...list.filter(b => b.level !== first)];
  // سؤال بسيط: العقول السحابية السريعة (Gemini…) قبل المحلي لأن المحلي بطيء عالكمبيوتر
  if (prefer === 'light') out = [...out.filter(b => !isLocal(b)), ...out.filter(isLocal)];
  // Gemini المجانية أول شي دايماً (أشطر بالعربي من Cloudflare). المدفوع بيضل بمكانه، والمحلي بالآخر
  out = [...out.filter(isFreeGemini), ...out.filter(b => !isFreeGemini(b))];
  // العقول يلي خلصت حصتها منأجّلها لآخر القائمة لمدة شوي بدل ما نستنّاها كل مرة
  const now = Date.now();
  return [...out.filter(b => !(cooldown.get(b.slot) > now)), ...out.filter(b => cooldown.get(b.slot) > now)];
}
const cooldown = new Map();
let geminiBlockedUntil = 0;
const isLocal = b => /localhost|127\.0\.0\.1|\[::1\]/.test(b.base_url || '');
const isFreeGemini = b => b.kind === 'gemini' && !isLocal(b) && !/مدفوع|paid|\$/i.test(b.name || '');

// استدعاء مع تجربة المزوّد الاحتياطي إذا فشل الأول
export async function chat(providers, { system, messages, json = true, temperature = 0.6, maxTokens = 900 }) {
  if (!providers.length) throw new AIError('ما في مفتاح ذكاء اصطناعي مضبوط. ضيف مفتاح من الإعدادات.', 0);
  let lastErr;
  const gemOff = geminiBlockedUntil > Date.now() && providers.some(p => p.kind !== 'gemini' && p.kind !== 'mock');
  for (const p of providers) {
    // Gemini مسكّر من مكانك (بلا VPN)؟ منفوت عالعقل التاني فوراً بدل ما نجرّب 10 مفاتيح
    if (gemOff && p.kind === 'gemini') continue;
    try {
      let r;
      if (p.kind === 'mock') r = mockReply(messages);
      else if (p.kind === 'gemini') r = await gemini(p, { system, messages, json, temperature, maxTokens });
      else r = await openaiCompat(p, { system, messages, json, temperature, maxTokens });
      return { ...r, via: p.name || p.slot || 'own' };
    } catch (e) {
      lastErr = e; console.error(`[ai] ${p.name || p.provider} failed: ${e.message}`);
      if (p.kind === 'gemini' && /location|not supported|FAILED_PRECONDITION|fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|timeout|aborted|\b403\b/i.test(e.message + ' ' + (e.status || ''))) { geminiBlockedUntil = Date.now() + 15 * 60_000; console.error('[ai] Gemini مو واصل من هون — منستعمل Cloudflare/غيرو لربع ساعة'); if (providers.some(x => x.kind !== 'gemini' && x.kind !== 'mock')) { const rest = providers.filter(x => x.kind !== 'gemini'); return chat(rest, { system, messages, json, temperature, maxTokens }); } }
      if (p.slot) cooldown.set(p.slot, Date.now() + (/حصة|quota|429|rate|limit|رصيد|balance|402/i.test(e.message + ' ' + (e.status || '')) ? 30 : 3) * 60_000);
    }
  }
  throw lastErr;
}

async function openaiCompat(p, { system, messages, json, temperature, maxTokens }) {
  if (!p.base_url || !p.model) throw new AIError('اختر الموديل ورابط المزوّد من الإعدادات', 0);
  const body = {
    model: p.model,
    temperature,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, ...messages]
  };
  if (json) body.response_format = { type: 'json_object' };
  const call = async b => fetch(p.base_url.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}`, 'HTTP-Referer': config.publicUrl || 'https://raddad.local', 'X-Title': 'Raddad' },
    body: JSON.stringify(b),
    signal: AbortSignal.timeout(60_000)
  });
  let res = await call(body);
  if (res.status === 400 && json) { // بعض الموديلات ما بتدعم وضع JSON
    delete body.response_format;
    res = await call(body);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AIError(errMsg(res.status, data?.error?.message || data?.errors?.[0]?.message), res.status);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new AIError('رد فاضي من الذكاء الاصطناعي', 502);
  return { text, usage: data.usage || null };
}

async function gemini(p, { system, messages, json, temperature, maxTokens }) {
  const contents = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += '\n' + m.content; // Gemini بيرفض دورين متتاليين لنفس الطرف
    else contents.push({ role, parts: [{ text: m.content }] });
  }
  if (contents[0]?.role === 'model') contents.unshift({ role: 'user', parts: [{ text: '(بداية المحادثة)' }] });
  const call = (model, extra = {}) => fetch(`${(p.base_url || PRESETS.gemini.base_url).replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}), ...extra }
    }),
    signal: AbortSignal.timeout(60_000)
  });
  let res;
  if (p.upgrade) { // موديل أشطر بلا «تفكير» (أسرع)، وإذا رفض منرجع للموديل العادي
    res = await call(p.upgrade, { thinkingConfig: { thinkingBudget: 0 } });
    if (res.status === 400) res = await call(p.upgrade);
    if ([400, 404, 429].includes(res.status)) res = await call(p.model); // 429: حصة Flash خلصت، Lite إلو حصة لحالو
  } else res = await call(p.model);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AIError(errMsg(res.status, data?.error?.message), res.status);
  const text = data?.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('');
  if (!text) throw new AIError('رد فاضي من Gemini (ممكن انحجب بسبب فلتر الأمان)', 502);
  return { text, usage: data.usageMetadata || null };
}

function errMsg(status, msg) {
  if (status === 401 || status === 403) return 'المفتاح غلط أو ما إله صلاحية';
  if (status === 429) return 'خلصت الحصة المجانية لهلق أو في ضغط — جرّب بعد شوي';
  if (status === 404) return 'اسم الموديل غلط أو ما عاد موجود — اختر موديل تاني';
  return `خطأ من مزوّد الذكاء الاصطناعي (${status})${msg ? ': ' + String(msg).slice(0, 200) : ''}`;
}

export async function listModels({ provider, base_url, key }) {
  const preset = PRESETS[provider] || PRESETS.custom;
  const base = (base_url || preset.base_url).replace(/\/$/, '');
  if (preset.kind === 'gemini') {
    const res = await fetch(`${base}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(20_000) });
    const d = await res.json();
    if (!res.ok) throw new AIError(errMsg(res.status, d?.error?.message), res.status);
    return (d.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name.replace(/^models\//, '')).sort();
  }
  const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new AIError(errMsg(res.status, d?.error?.message), res.status);
  return (d.data || d.result || []).map(m => m.id || m.name).filter(Boolean).sort();
}

// تحويل رد النموذج لـ JSON حتى لو أضاف كلام قبله أو بعده
export function parseJSON(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch {}
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch {} }
  return null;
}

// رد تجريبي (للاختبار بدون مفتاح): MOCK_AI=1
function mockReply(messages) {
  const last = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const order = /بدي اطلب|اطلب|أطلب/.test(last);
  return {
    text: JSON.stringify({
      reply: order ? 'تمام! سجلتلك الطلب 🌟 رح نتواصل معك للتأكيد.' : `أهلاً! وصلني سؤالك: "${last.slice(-80)}" — هاد رد تجريبي.`,
      images: [],
      order: order ? { items: [{ name: 'منتج تجريبي', qty: 1 }], customer_name: 'عميل', address: 'دمشق', total: null, notes: '' } : null,
      handoff: /موظف/.test(last),
      customer_name: null,
      note: null
    }),
    usage: null
  };
}
