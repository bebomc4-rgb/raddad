// رد بتسجيل صوتي: نص ← صوت (Gemini) ← ملف واتساب صوتي (ogg/opus عن طريق ffmpeg)
// ffmpeg بيتنزّل لحالو أول مرة لمجلد bin (متل cloudflared)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, DATA_DIR } from './config.js';
import { resolveAI } from './ai.js';

const WIN = process.platform === 'win32';
const BIN = path.join(ROOT, 'bin', WIN ? 'ffmpeg.exe' : 'ffmpeg');
const DL = WIN
  ? ['https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64.gz', 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64']
  : ['https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-linux-x64.gz'];
let ffReady = null;

const SYS_FF = WIN ? '' : [process.env.PREFIX && path.join(process.env.PREFIX, 'bin', 'ffmpeg'), '/usr/bin/ffmpeg'].find(f => f && fs.existsSync(f)) || '';
async function ensureFfmpeg() {
  if (SYS_FF) return SYS_FF; // الموبايل/لينكس: ffmpeg المنزّل بـ pkg
  if (fs.existsSync(BIN) && fs.statSync(BIN).size > 5e6) return BIN;
  if (!ffReady) ffReady = (async () => {
    fs.mkdirSync(path.dirname(BIN), { recursive: true });
    // نسخة مضغوطة موجودة بمجلد bin (نزلناها سلفاً): منفكّها وخلصنا، بلا إنترنت
    const LOCAL = path.join(path.dirname(BIN), WIN ? 'ffmpeg-win32-x64.gz' : 'ffmpeg-linux-x64.gz');
    if (fs.existsSync(LOCAL)) {
      try {
        const buf = zlib.gunzipSync(fs.readFileSync(LOCAL));
        if (buf.length > 5e6) { fs.writeFileSync(BIN + '.tmp', buf); if (!WIN) fs.chmodSync(BIN + '.tmp', 0o755); fs.renameSync(BIN + '.tmp', BIN); console.log('[tts] ffmpeg ready (from bin)'); return BIN; }
      } catch (e) { console.error('[tts] local ffmpeg', e.message); }
    }
    let lastErr = null;
    for (const url of DL) {
      try {
        console.log('[tts] downloading ffmpeg (once)…', url);
        const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        let buf = Buffer.from(await r.arrayBuffer());
        if (url.endsWith('.gz')) buf = zlib.gunzipSync(buf);
        if (buf.length < 5e6) throw new Error('file too small');
        fs.writeFileSync(BIN + '.tmp', buf); if (!WIN) fs.chmodSync(BIN + '.tmp', 0o755);
        fs.renameSync(BIN + '.tmp', BIN);
        console.log('[tts] ffmpeg ready');
        return BIN;
      } catch (e) { lastErr = e; console.error('[tts] ffmpeg download', e.message); }
    }
    throw lastErr || new Error('ffmpeg download failed');
  })().finally(() => { ffReady = null; });
  return ffReady;
}

// ===== Piper: صوت مجاني للأبد، شغّال عالكمبيوتر بلا إنترنت وبلا حدود، ونفس الصوت دايماً =====
// صوت «كريم» عربي شامي رجالي. بينزل لحالو أول مرة (برنامج 22 ميغا + صوت 60 ميغا تقريباً)
const PDIR = path.join(path.dirname(BIN), 'piper');
const PEXE = path.join(PDIR, WIN ? 'piper.exe' : 'piper');
const PVOICE = path.join(PDIR, 'voices', 'ar_JO-kareem-medium.onnx');
const PZIP = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/' + (WIN ? 'piper_windows_amd64.zip' : 'piper_linux_x86_64.tar.gz');
const PV_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx';
let piperReady = null;
async function dl(url, file) {
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15 * 60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  fs.writeFileSync(file + '.tmp', Buffer.from(await r.arrayBuffer())); fs.renameSync(file + '.tmp', file);
}
const run = (cmd, args, opts = {}) => new Promise((ok, no) => { const p = spawn(cmd, args, { windowsHide: true, ...opts }); let e = ''; p.stderr?.on('data', d => (e += d)); p.on('error', no); p.on('close', c => (c === 0 ? ok() : no(new Error(`${path.basename(cmd)} ${c}: ${e.slice(0, 200)}`)))); });
async function ensurePiper() {
  if (fs.existsSync(PEXE) && fs.existsSync(PVOICE) && fs.existsSync(PVOICE + '.json')) return true;
  if (!piperReady) piperReady = (async () => {
    fs.mkdirSync(path.join(PDIR, 'voices'), { recursive: true });
    // حزمة جاهزة بمجلد bin\piper-pkg (نزّلناها سلفاً): منركّب منها بلا إنترنت
    const PKG = path.join(path.dirname(BIN), 'piper-pkg');
    if (fs.existsSync(PKG)) {
      try {
        if (!fs.existsSync(PEXE) && fs.existsSync(path.join(PKG, 'piper.zip'))) await run('tar', ['-xf', path.join(PKG, 'piper.zip'), '-C', path.dirname(BIN)]);
        const parts = fs.readdirSync(PKG).filter(f => /^ar_JO-kareem-medium\.onnx\.part\d+$/.test(f)).sort((a, b) => +a.match(/\d+$/)[0] - +b.match(/\d+$/)[0]);
        if (!fs.existsSync(PVOICE) && parts.length) { fs.writeFileSync(PVOICE + '.tmp', Buffer.concat(parts.map(f => fs.readFileSync(path.join(PKG, f))))); fs.renameSync(PVOICE + '.tmp', PVOICE); }
        if (!fs.existsSync(PVOICE + '.json') && fs.existsSync(path.join(PKG, 'ar_JO-kareem-medium.onnx.json'))) fs.copyFileSync(path.join(PKG, 'ar_JO-kareem-medium.onnx.json'), PVOICE + '.json');
      } catch (e) { console.error('[tts] piper package', e.message); }
    }
    if (!fs.existsSync(PEXE)) {
      console.log('[tts] downloading Piper (once)…');
      const arc = path.join(path.dirname(BIN), WIN ? 'piper.zip' : 'piper.tgz');
      await dl(PZIP, arc);
      await run('tar', ['-xf', arc, '-C', path.dirname(BIN)]); // ويندوز 10/11 فيه tar وبيفك zip
      try { fs.unlinkSync(arc); } catch {}
    }
    if (!fs.existsSync(PVOICE)) { console.log('[tts] downloading the Arabic voice (once)…'); await dl(PV_URL, PVOICE); }
    if (!fs.existsSync(PVOICE + '.json')) await dl(PV_URL + '.json', PVOICE + '.json');
    console.log('[tts] Piper ready');
    return true;
  })().finally(() => { piperReady = null; });
  return piperReady;
}
function piperSpeak(text) {
  return new Promise((resolve, reject) => {
    const p = spawn(PEXE, ['--model', PVOICE, '--output_raw', '--length_scale', '1.12', '--sentence_silence', '0.25', '--noise_scale', '0.5'], { windowsHide: true, cwd: PDIR });
    const out = []; let err = '';
    const kill = setTimeout(() => { try { p.kill(); } catch {} reject(new Error('piper timeout')); }, 20_000);
    p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => (err += d));
    p.on('error', e => { clearTimeout(kill); reject(e); });
    p.on('close', c => { clearTimeout(kill); const pcm = Buffer.concat(out); c === 0 && pcm.length > 2000 ? resolve({ pcm, rate: (() => { try { return JSON.parse(fs.readFileSync(PVOICE + '.json', 'utf8')).audio.sample_rate || 22050; } catch { return 22050; } })() }) : reject(new Error('piper: ' + err.slice(-200))); });
    p.stdin.on('error', () => {}); p.stdin.end(text + '\n', 'utf8');
  });
}

// Gemini TTS: بيرجّع PCM 16bit mono 24kHz
async function geminiSpeak(p, text, voice) {
  const base = (p.base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  const call = (withTemp) => fetch(`${base}/models/gemini-2.5-flash-preview-tts:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `اقرأ الكلام يلي تحت بالحرف، بصوت رجّال سوري شامي عميق وتخين متل معلّق الأفلام الوثائقية، بنبرة هادية وودودة وواثقة ومقنعة، ببطء خفيف ووضوح، نفس الصوت والنبرة دايماً، بلا مبالغة وبلا تغيير بالكلمات:\n${text}` }] }],
      generationConfig: { ...(withTemp ? { temperature: 0.2 } : {}), responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
    }),
    signal: AbortSignal.timeout(25_000)
  });
  let res = await call(true);
  if (res.status === 400) res = await call(false); // إذا ما قبل «temperature» منجرّب بلاها
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${d?.error?.message || ''}`.slice(0, 200));
  const part = (d?.candidates?.[0]?.content?.parts || []).find(x => x.inlineData?.data);
  if (!part) throw new Error('Gemini TTS: no audio');
  const rate = +((part.inlineData.mimeType || '').match(/rate=(\d+)/) || [])[1] || 24000;
  return { pcm: Buffer.from(part.inlineData.data, 'base64'), rate };
}

function toOgg(ff, pcm, rate, out) {
  return new Promise((resolve, reject) => {
    const p = spawn(ff, ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', '-af', `asetrate=${Math.round(rate * 0.9)},aresample=${rate},atempo=1.111`, '-c:a', 'libopus', '-b:a', '32k', '-ac', '1', '-ar', '48000', '-application', 'voip', out], { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', c => (c === 0 && fs.existsSync(out) ? resolve(out) : reject(new Error('ffmpeg: ' + err.slice(0, 200)))));
    const kill = setTimeout(() => { try { p.kill(); } catch {} reject(new Error('ffmpeg timeout')); }, 15_000);
    p.on('close', () => clearTimeout(kill));
    p.stdin.on('error', () => {});
    p.stdin.end(pcm);
  });
}


// ===== Fish Audio (fish.audio): صوت طبيعي كتير، موديل s2.1-pro-free مجاني =====
// الإعداد بملف data/fish.txt: السطر الأول المفتاح، التاني رقم الصوت (من رابط الصوت fish.audio/m/<الرقم>)
// الإعداد بـ data/fish.json: { keys: [حتى 4 مفاتيح], voice: رقم الصوت, voiceName } (أو الملف القديم fish.txt)
function fishConf() {
  const bad = x => !x || /حط|paste|xxx/i.test(x);
  const vid = v => bad(v) ? '' : String(v).trim().replace(/^.*\/m\//, '').replace(/[/?#\s].*$/, '');
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fish.json'), 'utf8'));
    const keys = (j.keys || []).map(k => String(k || '').trim()).filter(k => !bad(k));
    if (keys.length) return { keys, voice: vid(j.voice), model: j.model || 's2.1-pro-free' };
  } catch {}
  try {
    const [key = '', voice = ''] = fs.readFileSync(path.join(DATA_DIR, 'fish.txt'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).map(x => x.trim());
    if (!bad(key)) return { keys: [key], voice: vid(voice), model: 's2.1-pro-free' };
  } catch {}
  return null;
}
const fishCool = new Map(); // مفتاح خلص رصيدو/انرفض ← منرتاح منو شوي ومنجرّب يلي بعدو
let fishBlockedUntil = 0;
async function fishSpeak(text) {
  const c = fishConf(); if (!c) throw new Error('fish: no key');
  if (fishBlockedUntil > Date.now()) throw new Error('fish: not reachable now');
  let last = null;
  for (const key of c.keys) {
    if ((fishCool.get(key) || 0) > Date.now()) continue;
    let res;
    try {
      res = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'model': c.model },
        body: JSON.stringify({ text, format: 'mp3', mp3_bitrate: 64, latency: 'normal', ...(c.voice ? { reference_id: c.voice } : {}) }),
        signal: AbortSignal.timeout(25_000)
      });
    } catch (e) { fishBlockedUntil = Date.now() + 10 * 60_000; throw e; } // الموقع مو واصل: ما في داعي نجرّب باقي المفاتيح
    if (res.ok) { const buf = Buffer.from(await res.arrayBuffer()); if (buf.length > 1000) { fishUse(key, buf.length * 8 / 64000, text.length); return buf; } last = new Error('fish: no audio'); continue; }
    const t = await res.text().catch(() => '');
    last = new Error(`fish ${res.status}: ${t.slice(0, 150)}`);
    if ([401, 402, 403, 429].includes(res.status)) fishCool.set(key, Date.now() + (res.status === 429 ? 5 : 60) * 60_000);
  }
  throw last || new Error('fish: all keys resting');
}
// عدّاد الاستعمال: كم رسالة صوتية وكم دقيقة (اليوم / هالشهر / لكل مفتاح)
const FISH_USE = path.join(DATA_DIR, 'fish-usage.json');
function fishUse(key, sec, chars) {
  let u = {}; try { u = JSON.parse(fs.readFileSync(FISH_USE, 'utf8')); } catch {}
  const d = new Date().toISOString().slice(0, 10), m = d.slice(0, 7), k = key.slice(-6);
  for (const [bucket, id] of [['day', d], ['month', m], ['key', k]]) { u[bucket] = u[bucket] || {}; const x = u[bucket][id] = u[bucket][id] || { n: 0, sec: 0, chars: 0 }; x.n++; x.sec += sec; x.chars += chars; }
  for (const id of Object.keys(u.day || {}).sort().slice(0, -40)) delete u.day[id];
  try { fs.writeFileSync(FISH_USE, JSON.stringify(u)); } catch {}
}
export async function fishStatus() {
  const c = fishConf(); let u = {}; try { u = JSON.parse(fs.readFileSync(FISH_USE, 'utf8')); } catch {}
  const d = new Date().toISOString().slice(0, 10), m = d.slice(0, 7);
  const keys = await Promise.all((c?.keys || []).map(async (key, i) => {
    const out = { n: i + 1, tail: key.slice(-4), used: u.key?.[key.slice(-6)] || { n: 0, sec: 0, chars: 0 }, resting: (fishCool.get(key) || 0) > Date.now() };
    try { const r = await fetch('https://api.fish.audio/wallet/self/api-credit', { headers: { 'Authorization': 'Bearer ' + key }, signal: AbortSignal.timeout(10_000) }); const j = await r.json().catch(() => ({})); if (r.ok) out.credit = j.credit ?? j.balance ?? null; else out.error = r.status === 401 ? 'المفتاح غلط أو منتهي' : 'خطأ ' + r.status; }
    catch (e) { out.error = 'الموقع مو واصل من هون'; }
    return out;
  }));
  return { model: c?.model || 's2.1-pro-free', today: u.day?.[d] || { n: 0, sec: 0, chars: 0 }, month: u.month?.[m] || { n: 0, sec: 0, chars: 0 }, keys };
}
export async function fishVoices(q = '', page = 1) {
  const c = fishConf();
  const u = new URL('https://api.fish.audio/model');
  u.searchParams.set('page_size', '24'); u.searchParams.set('page_number', String(Math.max(1, Math.min(50, +page || 1)))); u.searchParams.set('sort_by', 'score');
  if (q) u.searchParams.set('title', q); else u.searchParams.set('language', 'ar');
  const res = await fetch(u, { headers: c ? { 'Authorization': 'Bearer ' + c.keys[0] } : {}, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error('fish voices ' + res.status);
  const d = await res.json();
  return (d.items || []).map(m => ({ id: m._id, title: m.title, cover: m.cover_image ? (/^https?:/.test(m.cover_image) ? m.cover_image : 'https://public-platform.r2.fish.audio/' + m.cover_image) : '', sample: (x => !x ? '' : /^https?:/.test(x) ? x : 'https://public-platform.r2.fish.audio/' + x)(m.samples?.[0]?.audio || ''), langs: m.languages || [], likes: m.like_count || 0 }));
}

// ===== صوت مايكروسوفت (Edge) المجاني: «ليث» رجّال سوري طبيعي — أفضل صوت ببلاش =====
export const EDGE_VOICE = 'ar-SY-LaithNeural';
const EDGE_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
let edgeSkew = 0;
function edgeGec() {
  let t = Math.floor(Date.now() / 1000 + edgeSkew) + 11644473600; t -= t % 300;
  return crypto.createHash('sha256').update(`${BigInt(t) * 10000000n}${EDGE_TOKEN}`, 'ascii').digest('hex').toUpperCase();
}
const xmlEsc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
async function edgeSpeak(text, voice = EDGE_VOICE) {
  const { default: WebSocket } = await import('ws');
  const cid = crypto.randomUUID().replace(/-/g, '');
  const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_TOKEN}&Sec-MS-GEC=${edgeGec()}&Sec-MS-GEC-Version=1-130.0.2849.68&ConnectionId=${cid}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: {
      'Pragma': 'no-cache', 'Cache-Control': 'no-cache',
      'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Accept-Language': 'en-US,en;q=0.9', 'Cookie': 'muid=' + crypto.randomBytes(16).toString('hex').toUpperCase() + ';',
    } });
    const chunks = []; let done = false;
    const fin = (err) => { if (done) return; done = true; clearTimeout(kill); try { ws.close(); } catch {} const a = Buffer.concat(chunks); !err && a.length > 1000 ? resolve(a) : reject(err || new Error('edge: no audio')); };
    const kill = setTimeout(() => fin(new Error('edge timeout')), 6000);
    ws.on('unexpected-response', (req, res) => {
      const d = Date.parse(res.headers.date || ''); if (d) edgeSkew = (d - Date.now()) / 1000; // ساعة الجهاز غلط؟ منصلحها للمرة الجاية
      fin(new Error('edge http ' + res.statusCode));
    });
    ws.on('error', e => fin(e));
    ws.on('close', () => fin(chunks.length ? null : new Error('edge closed')));
    ws.on('open', () => {
      const ts = new Date().toString();
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ar-SY'><voice name='${voice}'><prosody pitch='-4Hz' rate='-6%' volume='+0%'>${xmlEsc(text)}</prosody></voice></speak>`;
      ws.send(`X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`);
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const n = data.readUInt16BE(0); const head = data.subarray(2, 2 + n).toString();
        if (/Path:audio/.test(head)) chunks.push(data.subarray(2 + n));
      } else if (/Path:turn\.end/.test(data.toString())) fin(null);
    });
  });
}
// mp3 ← ملف صوت واتساب ogg/opus
function mp3ToOgg(ff, mp3, out) {
  return new Promise((resolve, reject) => {
    const p = spawn(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', out], { windowsHide: true });
    let err = ''; p.stderr.on('data', d => err += d);
    const kill = setTimeout(() => p.kill(), 15000);
    p.on('error', e => { clearTimeout(kill); reject(e); });
    p.on('close', c => { clearTimeout(kill); c === 0 ? resolve(out) : reject(new Error('ffmpeg: ' + err.slice(-200))); });
    p.stdin.on('error', () => {}); p.stdin.end(mp3);
  });
}

// نص الرد ← ملف صوتي جاهز للواتس (/uploads/…ogg) أو null إذا ما زبط
// صوت واحد ثابت لكل الرسائل الصوتية: رجّالي عميق وتخين، هادي وودود
export const VOICE = 'Charon'; // صوت رجالي عميق (متل معلّق وثائقي)
// حد أقصى 25 ثانية للصوت: إذا تأخر أكتر، المجيب بيبعت الرد كتابة وما بيعلق
export function speak(tenant, text, opts = {}) {
  let t; const deadline = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('voice took too long (>55s)')), 55_000); });
  return Promise.race([speakNow(tenant, text, opts), deadline]).finally(() => clearTimeout(t));
}
async function speakNow(tenant, text, { voice = VOICE } = {}) {
  const clean = String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/KO\s*SPORT/gi, 'كي أو سبورت')
    .replace(/[\u064B-\u0650\u0652]/g, '') // بلا تشكيل فصحى، بس الشدّة منخليها (بتساعد باللفظ)
    .replace(/(^|\s)هلأ(?=\s|$)/g, '$1هلّق')
    .replace(/(\d+(?:[.,]\d+)?)\s*\$/g, '$1 دولار').replace(/\$\s*(\d+(?:[.,]\d+)?)/g, '$1 دولار')
    .replace(/ل\.س/g, 'ليرة').replace(/(\d+)\s*%/g, '$1 بالمية').replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/[|•·»«"()\[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 450);
  if (clean.length < 2) return null;
  const ff = await ensureFfmpeg();
  const dir0 = path.join(DATA_DIR, 'uploads'); fs.mkdirSync(dir0, { recursive: true });
  // 0) Fish Audio — أحلى صوت (إذا في مفتاح بـ data/fish.txt)
  if (fishConf()) {
    try {
      const mp3 = await fishSpeak(clean);
      const name = `${tenant.id}-voice-${crypto.randomBytes(6).toString('hex')}.ogg`;
      await mp3ToOgg(ff, mp3, path.join(dir0, name));
      console.log('[tts] voice: fish.audio');
      return '/uploads/' + name;
    } catch (e) { console.error('[tts] fish', e.message); }
  }
  // 1) Gemini المجاني (أحلى صوت) — كل المفاتيح المجانية، كل مرة مفتاحين سوا مشان السرعة
  try { return await geminiOnly(tenant, clean, voice, ff); } catch (e) { console.error('[tts] gemini', e.message); }
  // 2) ليث (Edge) — احتياط
  try {
    const mp3 = await edgeSpeak(clean);
    const name = `${tenant.id}-voice-${crypto.randomBytes(6).toString('hex')}.ogg`;
    await mp3ToOgg(ff, mp3, path.join(dir0, name));
    console.log('[tts] voice: edge Laith');
    return '/uploads/' + name;
  } catch (e) { console.error('[tts] edge', e.message); }
  // الصوت الآلي (Piper) انشال نهائياً: إذا ما زبط Gemini بينبعت الرد كتابة
  throw new Error('no good voice available now');
}
const geminiCool = new Map();
let ttsBlockedUntil = 0; // مفتاح خلصت حصته المجانية ← منرتاح منو كم ساعة
async function geminiOnly(tenant, clean, voice, ff) {
  // ببلاش بس: مفاتيح Gemini المجانية. المدفوع ممنوع للصوت
  const all = resolveAI(tenant).filter(b => b.kind === 'gemini' && !/مدفوع|paid|\$/i.test(b.name || ''));
  const brains = all.filter(b => (geminiCool.get(b.key) || 0) < Date.now());
  if (!brains.length) throw new Error('all free Gemini voice quotas used — try later');
  if (ttsBlockedUntil > Date.now()) throw new Error('Gemini voice not reachable from here now (skip for a while)');
  let lastErr = null;
  for (let i = 0; i < brains.length && i < 4; i += 2) {
    const pair = brains.slice(i, i + 2);
    try {
      const { pcm, rate, b } = await Promise.any(pair.map(b => geminiSpeak(b, clean, voice).then(r => ({ ...r, b })).catch(e => {
        if (/429|quota|RESOURCE_EXHAUSTED/i.test(e.message)) geminiCool.set(b.key, Date.now() + 6 * 3600_000);
        console.error('[tts]', b.name || b.slot, e.message.slice(0, 90)); throw e;
      })));
      const dir = path.join(DATA_DIR, 'uploads'); fs.mkdirSync(dir, { recursive: true });
      const name = `${tenant.id}-voice-${crypto.randomBytes(6).toString('hex')}.ogg`;
      await toOgg(ff, pcm, rate, path.join(dir, name));
      console.log('[tts] voice: gemini', b.name || b.slot);
      return '/uploads/' + name;
    } catch (e) {
      lastErr = e.errors?.[0] || e;
      // كل المحاولات timeout/مسكّر = Gemini مو واصل من هون (بلا VPN): منوقف الصوت ربع ساعة ومنبعت كتابة فوراً
      if ((e.errors || [e]).every(x => /timeout|aborted|fetch failed|location|ENOTFOUND|ECONN/i.test(x?.message || ''))) { ttsBlockedUntil = Date.now() + 15 * 60_000; break; }
    }
  }
  throw lastErr || new Error('ما في مفتاح Gemini للصوت');
}

// منجهّز ffmpeg من أول ما يقوم المجيب (بالخلفية)
setTimeout(() => { ensureFfmpeg().catch(e => console.error('[tts] ffmpeg', e.message)); }, 15000).unref?.();
