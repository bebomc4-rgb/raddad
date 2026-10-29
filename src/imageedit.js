// تعديل الصور بالكلام لصاحب المتجر: بيبعت صورة على واتساب ويكتب "خلي الخلفية بيضا" أو "اعملها إعلان"
// العقل: Cloudflare FLUX.2 (من نفس مفتاح Cloudflare) وإذا ما زبط Gemini
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, config } from './config.js';
import { resolveAI, chat, AIError } from './ai.js';

const CF_EDIT = '@cf/black-forest-labs/flux-2-klein-4b';
const COMFY = (process.env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
const GEMINI_IMAGE = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image'; // نفس موديل موقع Gemini (Nano Banana Pro)

// كلمات بتدل إنو صاحب المتجر بدو تعديل على آخر صورة
export const EDIT_WORDS = /(عدّ?ل|غيّ?ر|خلي|خلّي|حط|ضيف|زيد|شيل|امسح|اعمل|إعمل|سوي|سوّي|صمم|صمّم|إعلان|اعلان|بوستر|خلفية|لون|edit|change|remove|add|make|poster|background)/i;

function cfRunBase(p) {
  const m = String(p.base_url || '').match(/^(https?:\/\/[^/]+\/client\/v4\/accounts\/[a-f0-9]{32})\//i);
  return m ? `${m[1]}/ai/run/` : null;
}

async function loadSharp() {
  try { return (await import('sharp')).default; } catch { return null; }
}

// بنصغّر الصورة لأقل من 512 (شرط الموديل) وبنحسب مقاس النتيجة بنفس النسبة
async function prepare(buf) {
  const sharp = await loadSharp();
  if (!sharp) return { input: buf, mime: 'image/jpeg', w: 1024, h: 1024 };
  const meta = await sharp(buf).metadata();
  const input = await sharp(buf).rotate().resize(500, 500, { fit: 'inside' }).jpeg({ quality: 90 }).toBuffer();
  const ratio = (meta.width || 1) / (meta.height || 1);
  const snap = v => Math.max(256, Math.min(1408, Math.round(v / 16) * 16));
  const w = ratio >= 1 ? 1024 : snap(1024 * ratio), h = ratio >= 1 ? snap(1024 / ratio) : 1024;
  return { input, mime: 'image/jpeg', w, h };
}

// طلب صاحب المتجر بالعربي ← تعليمات إنكليزية واضحة للموديل
async function toPrompt(tenant, request) {
  const system = `You turn a shop owner's request (Arabic, maybe Syrian dialect) into ONE short English instruction for an AI image editor that receives the original photo.
Rules:
- Keep the product exactly the same (shape, logo, details) unless the owner asks to change it.
- If they ask for an ad/poster ("إعلان", "بوستر"): describe a clean professional e-commerce advertisement layout around the product (background, lighting, composition). If they give text (price, name), include it in quotes, and keep it short.
- If they ask for a white/clean background, say: "place the product on a pure white studio background with soft shadow".
- Output only the instruction, no quotes around it, no explanations.`;
  try {
    const { text } = await chat(resolveAI(tenant, { prefer: 'smart' }), { system, messages: [{ role: 'user', content: request }], json: false, temperature: 0.3, maxTokens: 160 });
    return text.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 600) || request;
  } catch { return request; }
}

async function cfEdit(p, prep, prompt) {
  const fd = new FormData();
  fd.append('prompt', prompt);
  fd.append('input_image_0', new Blob([prep.input], { type: prep.mime }), 'in.jpg');
  fd.append('width', String(prep.w));
  fd.append('height', String(prep.h));
  const res = await fetch(cfRunBase(p) + CF_EDIT, { method: 'POST', headers: { Authorization: `Bearer ${p.key}` }, body: fd, signal: AbortSignal.timeout(120_000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.success === false) throw new AIError(d?.errors?.[0]?.message || `Cloudflare (${res.status})`, res.status);
  const b64 = d.result?.image || d.image;
  if (!b64) throw new AIError('Cloudflare ما رجّع صورة', 0);
  return Buffer.from(b64, 'base64');
}

// ===== المحلي: ComfyUI على كرت الشاشة (ببلاش وبلا حدود) =====
async function comfyUp() {
  try { const r = await fetch(COMFY + '/system_stats', { signal: AbortSignal.timeout(2500) }); return r.ok; } catch { return false; }
}
function comfyWorkflow(imageName, prompt) {
  return {
    70: { class_type: 'UNETLoader', inputs: { unet_name: 'flux-2-klein-4b-fp8.safetensors', weight_dtype: 'default' } },
    71: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'flux2', device: 'default' } },
    72: { class_type: 'VAELoader', inputs: { vae_name: 'flux2-vae.safetensors' } },
    76: { class_type: 'LoadImage', inputs: { image: imageName } },
    80: { class_type: 'ImageScaleToTotalPixels', inputs: { image: ['76', 0], upscale_method: 'nearest-exact', megapixels: 1, resolution_steps: 1 } },
    99: { class_type: 'GetImageSize', inputs: { image: ['80', 0] } },
    74: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['71', 0] } },
    82: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['74', 0] } },
    122: { class_type: 'VAEEncode', inputs: { pixels: ['80', 0], vae: ['72', 0] } },
    123: { class_type: 'ReferenceLatent', inputs: { conditioning: ['74', 0], latent: ['122', 0] } },
    121: { class_type: 'ReferenceLatent', inputs: { conditioning: ['82', 0], latent: ['122', 0] } },
    63: { class_type: 'CFGGuider', inputs: { model: ['70', 0], positive: ['123', 0], negative: ['121', 0], cfg: 1 } },
    61: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    62: { class_type: 'Flux2Scheduler', inputs: { steps: 4, width: ['99', 0], height: ['99', 1] } },
    66: { class_type: 'EmptyFlux2LatentImage', inputs: { width: ['99', 0], height: ['99', 1], batch_size: 1 } },
    73: { class_type: 'RandomNoise', inputs: { noise_seed: Math.floor(Math.random() * 1e15) } },
    64: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['73', 0], guider: ['63', 0], sampler: ['61', 0], sigmas: ['62', 0], latent_image: ['66', 0] } },
    65: { class_type: 'VAEDecode', inputs: { samples: ['64', 0], vae: ['72', 0] } },
    9: { class_type: 'SaveImage', inputs: { images: ['65', 0], filename_prefix: 'raddad' } }
  };
}
const QWEN_UNET = 'qwen-image-edit-2511-Q3_K_S.gguf';
function qwenWorkflow(imageName, prompt) {
  return {
    161: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: QWEN_UNET } },
    162: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image', device: 'default' } },
    146: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    41: { class_type: 'LoadImage', inputs: { image: imageName } },
    160: { class_type: 'FluxKontextImageScale', inputs: { image: ['41', 0] } },
    145: { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['161', 0], shift: 3.1 } },
    152: { class_type: 'CFGNorm', inputs: { model: ['145', 0], strength: 1 } },
    153: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['152', 0], lora_name: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors', strength_model: 1 } },
    151: { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['162', 0], vae: ['146', 0], image1: ['160', 0], prompt } },
    149: { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['162', 0], vae: ['146', 0], image1: ['160', 0], prompt: '' } },
    148: { class_type: 'FluxKontextMultiReferenceLatentMethod', inputs: { conditioning: ['151', 0], reference_latents_method: 'index_timestep_zero' } },
    147: { class_type: 'FluxKontextMultiReferenceLatentMethod', inputs: { conditioning: ['149', 0], reference_latents_method: 'index_timestep_zero' } },
    156: { class_type: 'VAEEncode', inputs: { pixels: ['160', 0], vae: ['146', 0] } },
    169: { class_type: 'KSampler', inputs: { model: ['153', 0], seed: Math.floor(Math.random() * 1e15), steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1, positive: ['148', 0], negative: ['147', 0], latent_image: ['156', 0] } },
    158: { class_type: 'VAEDecode', inputs: { samples: ['169', 0], vae: ['146', 0] } },
    9: { class_type: 'SaveImage', inputs: { images: ['158', 0], filename_prefix: 'raddad-hq' } }
  };
}
// هل موديل Qwen (الجودة العالية) منزّل؟
export async function comfyHasQwen() {
  try {
    const r = await fetch(COMFY + '/object_info/UnetLoaderGGUF', { signal: AbortSignal.timeout(4000) }).then(r => r.json());
    const list = r?.UnetLoaderGGUF?.input?.required?.unet_name?.[0] || [];
    return list.includes(QWEN_UNET);
  } catch { return false; }
}

async function comfyEdit(buf, prompt, { quality = 'fast', timeoutMs = 300_000 } = {}) {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type: 'image/jpeg' }), `raddad-${Date.now()}.jpg`);
  fd.append('overwrite', 'true');
  const up = await fetch(COMFY + '/upload/image', { method: 'POST', body: fd }).then(r => r.json());
  const q = await fetch(COMFY + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: quality === 'high' ? qwenWorkflow(up.name, prompt) : comfyWorkflow(up.name, prompt) }) });
  const qd = await q.json().catch(() => ({}));
  if (!q.ok || !qd.prompt_id) throw new AIError('ComfyUI: ' + JSON.stringify(qd.error || qd.node_errors || qd).slice(0, 200), q.status);
  const until = Date.now() + timeoutMs; // أول مرة بيحمّل الموديل، فبنستنى
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 1500));
    const h = await fetch(COMFY + '/history/' + qd.prompt_id).then(r => r.json()).catch(() => ({}));
    const item = h[qd.prompt_id];
    if (!item) continue;
    if (item.status?.status_str === 'error') throw new AIError('ComfyUI فشل بالتعديل', 0);
    const img = Object.values(item.outputs || {}).flatMap(o => o.images || [])[0];
    if (img) {
      const v = await fetch(`${COMFY}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type || 'output'}`);
      return Buffer.from(await v.arrayBuffer());
    }
  }
  throw new AIError('ComfyUI طوّل كتير', 0);
}

async function geminiEdit(p, buf, mime, prompt, { aspect = null } = {}) {
  const url = `${(p.base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')}/models/${GEMINI_IMAGE}:generateContent`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: buf.toString('base64') } }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], ...(aspect ? { imageConfig: { aspectRatio: aspect } } : {}) } }),
    signal: AbortSignal.timeout(120_000)
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new AIError(d?.error?.message || `Gemini (${res.status})`, res.status);
  const part = (d?.candidates?.[0]?.content?.parts || []).find(x => x.inline_data || x.inlineData);
  const data = part?.inline_data?.data || part?.inlineData?.data;
  if (!data) throw new AIError('Gemini ما رجّع صورة', 0);
  return Buffer.from(data, 'base64');
}

// المدخل: مسار صورة محفوظة (/uploads/..) + طلب بالعربي ← المخرج: مسار الصورة الجديدة
export async function editImage(tenant, imageUrl, request, { quality = 'fast' } = {}) {
  const file = path.join(DATA_DIR, 'uploads', path.basename(imageUrl));
  const buf = fs.readFileSync(file);
  if (config.mockAI) return { url: imageUrl, by: 'تجريبي', prompt: request };
  // Gemini المدفوع: بيفهم العربي، فمنبعتله كلامك متل ما هو
  if (quality === 'gemini') {
    let lastErr = null;
    for (const p of geminiForImages(tenant)) {
      try {
        const out = await geminiEdit(p, buf, 'image/jpeg', request, { aspect: '4:5' });
        const name = `${tenant.id}-gemini-${crypto.randomBytes(8).toString('hex')}.png`;
        fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), out);
        return { url: `/uploads/${name}`, by: 'Gemini (' + (p.name || 'Gemini') + ')', prompt: request };
      } catch (e) { lastErr = e; console.error('[image] gemini', p.name, e.message); }
    }
    throw lastErr ? new AIError(/quota|billing/i.test(lastErr.message) ? 'Gemini رفض: لازم مفتاح Gemini فيه دفع مفعّل (المجاني ما بيعدّل صور)' : lastErr.message, 0) : new AIError('ما في مفتاح Gemini بصفحة الذكاء الاصطناعي', 0);
  }
  const prompt = await toPrompt(tenant, request);
  const providers = resolveAI(tenant);
  let out = null, by = null, lastErr = null;
  if (await comfyUp()) {
    if (quality === 'high' && await comfyHasQwen()) {
      try { out = await comfyEdit(buf, prompt, { quality: 'high', timeoutMs: 40 * 60_000 }); by = 'المحلي (Qwen جودة عالية)'; } catch (e) { lastErr = e; console.error('[image] local qwen', e.message); }
    }
    if (!out) try { out = await comfyEdit(buf, prompt, { timeoutMs: quality === 'high' ? 20 * 60_000 : 300_000 }); by = 'المحلي (FLUX)'; } catch (e) { lastErr = e; console.error('[image] local', e.message); }
  }
  const prep = out ? null : await prepare(buf);
  if (!out) for (const p of providers.filter(p => p.provider === 'cloudflare' && cfRunBase(p) && p.key)) {
    try { out = await cfEdit(p, prep, prompt); by = 'Cloudflare FLUX'; break; } catch (e) { lastErr = e; console.error('[image] cloudflare', e.message); }
  }
  if (!out) for (const p of providers.filter(p => p.kind === 'gemini' && p.key)) {
    try { out = await geminiEdit(p, buf, 'image/jpeg', prompt); by = 'Gemini'; break; } catch (e) { lastErr = e; console.error('[image] gemini', e.message); }
  }
  if (!out) throw lastErr || new AIError('تعديل الصور بدو المحلي (ComfyUI) شغّال، أو Cloudflare بصفحة الذكاء الاصطناعي', 0);
  const name = `${tenant.id}-edit-${crypto.randomBytes(8).toString('hex')}.png`;
  fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), out);
  return { url: `/uploads/${name}`, by, prompt };
}

// ===== Gemini: كذا صورة لنفس المنتج + شعار المتجر + الدراغون ← صورة وحدة 4:5 =====
export async function geminiProduct(tenant, urls, prompt) {
  const parts = [{ text: prompt }];
  const img = f => ({ inline_data: { mime_type: f.endsWith('.png') ? 'image/png' : 'image/jpeg', data: fs.readFileSync(f).toString('base64') } });
  parts.push({ text: `\n\nصور المنتج الحقيقي من زوايا مختلفة (${urls.length} صور) — هاد نفس المنتج، لا تغيّر فيه شي، وطلّع شعار المنتج من هالصور:` });
  for (const u of urls.slice(0, 8)) parts.push(img(path.join(DATA_DIR, 'uploads', path.basename(u))));
  const bdir = path.join(DATA_DIR, 'brand', String(tenant.id));
  const logo = path.join(bdir, 'logo.png'), mark = fs.existsSync(path.join(bdir, 'mark-src.png')) ? path.join(bdir, 'mark-src.png') : path.join(bdir, 'mark.png');
  if (fs.existsSync(logo)) { parts.push({ text: '\nهاد لوغو متجري (Ko Sport) — استخدمه حرفياً بدون تغيير:' }); parts.push(img(logo)); }
  if (fs.existsSync(mark)) { parts.push({ text: '\nهاد شعار الدراغون (العلامة المائية) — حطه خلف المنتج بشكل خفيف:' }); parts.push(img(mark)); }
  let lastErr = null;
  for (const p of geminiForImages(tenant)) {
    try {
      const url = `${(p.base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')}/models/${GEMINI_IMAGE}:generateContent`;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '4:5', imageSize: '2K' } } }),
        signal: AbortSignal.timeout(180_000) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new AIError(d?.error?.message || `Gemini (${res.status})`, res.status);
      const part = (d?.candidates?.[0]?.content?.parts || []).find(x => x.inline_data || x.inlineData);
      const data = part?.inline_data?.data || part?.inlineData?.data;
      if (!data) {
        const txt = (d?.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join(' ').trim();
        const why = d?.candidates?.[0]?.finishReason || d?.promptFeedback?.blockReason || '';
        console.error('[image] gemini no image:', why, txt.slice(0, 300));
        throw new AIError(`Gemini ما رجّع صورة (${why}) ${txt.slice(0, 160)}`, 0);
      }
      const name = `${tenant.id}-gemini-${crypto.randomBytes(8).toString('hex')}.png`;
      fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), Buffer.from(data, 'base64'));
      return { url: `/uploads/${name}`, by: 'Gemini (' + (p.name || 'Gemini') + ')' };
    } catch (e) { lastErr = e; console.error('[image] gemini', p.name, e.message); }
  }
  throw lastErr ? new AIError(/quota|billing|exceeded/i.test(lastErr.message) ? 'Gemini رفض: لازم مفتاح Gemini فيه دفع مفعّل (المجاني ما بيعدّل صور)' : lastErr.message, 0) : new AIError('ما في مفتاح Gemini بصفحة الذكاء الاصطناعي', 0);
}

// للصور: المفاتيح المدفوعة أول (المجانية ما بتعدّل صور)
function geminiForImages(tenant) {
  const list = resolveAI(tenant).filter(p => p.kind === 'gemini' && p.key);
  const paid = p => /مدفوع|paid|pro/i.test(p.name || '');
  return [...list.filter(paid), ...list.filter(p => !paid(p))];
}
