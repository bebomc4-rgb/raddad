// ربط فيسبوك وإنستغرام: رد تلقائي على التعليقات (رد عام + رسالة خاصة) وعلى الرسائل الخاصة
// كل مشترك بيعمل تطبيق Meta خاص فيه وبيلصق App ID + App Secret + توكن من Graph API Explorer
import crypto from 'node:crypto';
import { getSetting, setSetting, bumpUsage } from './db.js';
import { encrypt, decrypt } from './security.js';
import { think } from './agent.js';
import { aiAllowance } from './tenants.js';

const G = 'https://graph.facebook.com/v21.0';
const key = tid => `meta_${tid}`;
const cfgOf = tid => getSetting(key(tid), {});
const save = (tid, patch) => { const c = { ...cfgOf(tid), ...patch }; setSetting(key(tid), c); return c; };
const dmHistory = new Map(); // tid:sender → آخر الرسائل

function log(tid, item) {
  const l = getSetting(`meta_log_${tid}`, []);
  l.unshift({ at: Date.now(), ...item });
  setSetting(`meta_log_${tid}`, l.slice(0, 60));
}

async function graph(method, path, token, params = {}) {
  const u = new URL(G + path);
  let body;
  if (method === 'GET') { for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v); if (token) u.searchParams.set('access_token', token); }
  else body = JSON.stringify({ ...params, access_token: token });
  const res = await fetch(u, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body, signal: AbortSignal.timeout(20000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw new Error(d.error?.message || `Meta ${res.status}`);
  return d;
}

// ===== الإعداد: من توكن المستخدم → توكن صفحة دائم =====
async function connect(tid, { app_id, app_secret, user_token, page_id }) {
  const c = cfgOf(tid);
  const secret = app_secret || (c.app_secret_enc ? decrypt(c.app_secret_enc) : '');
  const appId = app_id || c.app_id;
  if (!appId || !secret) throw new Error('حط App ID و App Secret');
  let pageToken = c.page_token_enc ? decrypt(c.page_token_enc) : '';
  let pages = c.pages || [];
  if (user_token) {
    // توكن طويل (60 يوم) ومنه توكنات صفحات ما بتنتهي
    const long = await graph('GET', '/oauth/access_token', '', { grant_type: 'fb_exchange_token', client_id: appId, client_secret: secret, fb_exchange_token: user_token.trim() }).catch(() => null);
    const ut = long?.access_token || user_token.trim();
    const acc = await graph('GET', '/me/accounts', ut, { fields: 'id,name,access_token,instagram_business_account{id,username}' });
    pages = (acc.data || []).map(p => ({ id: p.id, name: p.name, token_enc: encrypt(p.access_token), ig: p.instagram_business_account || null }));
    if (!pages.length) throw new Error('ما لقيت ولا صفحة فيسبوك. تأكد إنك اخترت الصفحة وأعطيت صلاحية pages_show_list');
  }
  const page = pages.find(p => p.id === (page_id || c.page_id)) || pages[0];
  if (!page) throw new Error('الصق توكن من Graph API Explorer');
  pageToken = decrypt(page.token_enc);
  // اشتراك الصفحة بأحداث التعليقات والرسائل
  await graph('POST', `/${page.id}/subscribed_apps`, pageToken, { subscribed_fields: 'feed,messages' });
  return save(tid, {
    app_id: appId, app_secret_enc: encrypt(secret), pages, page_id: page.id, page_name: page.name,
    page_token_enc: page.token_enc, ig_id: page.ig?.id || null, ig_username: page.ig?.username || null,
    verify_token: c.verify_token || crypto.randomBytes(12).toString('hex'), connected_at: Date.now()
  });
}

// ===== الردود =====
async function aiAnswer(tenant, history) {
  const r = await think(tenant, null, history);
  return (r.reply || '').trim();
}

async function onComment(tenant, c, { platform, commentId, text, fromId, fromName }) {
  const token = decrypt(c.page_token_enc);
  if (!text?.trim()) return;
  const item = { kind: 'comment', platform, from: fromName || fromId, text };
  try {
    const answer = await aiAnswer(tenant, [{ direction: 'in', body: `(تعليق على منشور ${platform === 'ig' ? 'إنستغرام' : 'فيسبوك'}) ${text}` }]);
    // رسالة خاصة للمعلّق (مرة وحدة لكل تعليق، خلال 7 أيام)
    if (c.dm !== false && answer) {
      try { await graph('POST', `/${c.page_id}/messages`, token, { recipient: { comment_id: commentId }, message: { text: answer } }); item.dm = answer; }
      catch (e) { item.dm_error = e.message; }
    }
    // رد عام على التعليق
    const mode = c.public_mode || 'fixed';
    const pub = mode === 'off' ? '' : mode === 'ai' ? answer : (c.public_text || 'أهلين 🌹 بعتنالك التفاصيل عالخاص 📩');
    if (pub) {
      await graph('POST', platform === 'ig' ? `/${commentId}/replies` : `/${commentId}/comments`, token, { message: pub });
      item.public = pub;
    }
  } catch (e) { item.error = e.message; console.error('[meta] comment:', e.message); }
  log(tenant.id, item);
}

async function onDM(tenant, c, { platform, senderId, text }) {
  if (c.dm_reply === false || !text?.trim()) return;
  const token = decrypt(c.page_token_enc);
  const k = `${tenant.id}:${senderId}`;
  const h = (dmHistory.get(k) || []).concat({ direction: 'in', body: text }).slice(-12);
  const item = { kind: 'dm', platform, from: senderId, text };
  try {
    const answer = await aiAnswer(tenant, h);
    if (answer) {
      await graph('POST', `/${c.page_id}/messages`, token, { recipient: { id: senderId }, messaging_type: 'RESPONSE', message: { text: answer } });
      h.push({ direction: 'out', body: answer }); item.reply = answer;
    }
    dmHistory.set(k, h.slice(-12));
  } catch (e) { item.error = e.message; console.error('[meta] dm:', e.message); }
  log(tenant.id, item);
}

async function handleWebhook(tenant, payload) {
  const c = cfgOf(tenant.id);
  if (!c.enabled || !c.page_token_enc) return;
  const own = new Set([c.page_id, c.ig_id].filter(Boolean));
  for (const e of payload.entry || []) {
    for (const ch of e.changes || []) {
      const v = ch.value || {};
      if (payload.object === 'page' && ch.field === 'feed' && v.item === 'comment' && v.verb === 'add' && !own.has(v.from?.id) && c.fb_comments !== false)
        await onComment(tenant, c, { platform: 'fb', commentId: v.comment_id, text: v.message, fromId: v.from?.id, fromName: v.from?.name });
      if (payload.object === 'instagram' && ch.field === 'comments' && !own.has(v.from?.id) && c.ig_comments !== false)
        await onComment(tenant, c, { platform: 'ig', commentId: v.id, text: v.text, fromId: v.from?.id, fromName: v.from?.username });
    }
    for (const m of e.messaging || []) {
      if (!m.message || m.message.is_echo || own.has(m.sender?.id)) continue;
      await onDM(tenant, c, { platform: payload.object === 'instagram' ? 'ig' : 'fb', senderId: m.sender.id, text: m.message.text });
    }
  }
}

// ===== HTTP =====
const send = (res, status, data, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type.startsWith('application/json') ? JSON.stringify(data) : data); };
const readRaw = req => new Promise((ok, bad) => { const ch = []; let n = 0; req.on('data', d => { n += d.length; if (n > 2e6) { req.destroy(); bad(new Error('big')); } else ch.push(d); }); req.on('end', () => ok(Buffer.concat(ch))); req.on('error', bad); });

export async function handle(req, res, url, pathname, user, tenant, getTenant) {
  // Webhook من Meta: /meta/webhook/:tenantId
  const wh = pathname.match(/^\/meta\/webhook\/(\d+)$/);
  if (wh) {
    const tid = Number(wh[1]); const c = cfgOf(tid);
    if (req.method === 'GET') {
      const p = Object.fromEntries(url.searchParams);
      const ok = p['hub.mode'] === 'subscribe' && c.verify_token && p['hub.verify_token'] === c.verify_token;
      return send(res, ok ? 200 : 403, ok ? p['hub.challenge'] : 'forbidden', 'text/plain'), true;
    }
    if (req.method === 'POST') {
      const raw = await readRaw(req);
      const sig = String(req.headers['x-hub-signature-256'] || '');
      const secret = c.app_secret_enc ? decrypt(c.app_secret_enc) : '';
      const expect = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
      if (!secret || sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return send(res, 403, 'bad signature', 'text/plain'), true;
      send(res, 200, 'ok', 'text/plain');
      let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { return true; }
      const t = getTenant(tid);
      if (t) handleWebhook(t, payload).catch(e => console.error('[meta]', e.message));
      return true;
    }
  }

  // ===== إضافة كروم: بتطلب رد بالذكاء على تعليق (مفتاح الإضافة بدل تسجيل الدخول) =====
  if (pathname === '/meta/ext/reply' && req.method === 'POST') {
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const tid = tok && getSetting('ext_tokens', {})[tok];
    const t = tid && getTenant(tid);
    if (!t) return send(res, 401, { error: 'مفتاح الإضافة غلط — طلّع واحد جديد من صفحة الرد على التعليقات' }), true;
    const allow = aiAllowance(t);
    if (!allow.ok) return send(res, 402, { error: 'خلصت ردود اليوم أو الاشتراك منتهي' }), true;
    let b = {}; try { b = JSON.parse((await readRaw(req)).toString('utf8') || '{}'); } catch {}
    const text = String(b.text || '').slice(0, 1000);
    if (!text.trim()) return send(res, 400, { error: 'تعليق فاضي' }), true;
    const kind = ['dm', 'dm_first'].includes(b.kind) ? b.kind : 'comment';
    let history;
    if (kind === 'dm' && Array.isArray(b.history) && b.history.length)
      history = b.history.slice(-10).map(h => ({ direction: h.me ? 'out' : 'in', body: String(h.text || '').slice(0, 1000) }));
    else if (kind === 'dm_first') history = [{ direction: 'in', body: `(الزبون علّق على منشورك بإنستغرام وهلأ عم تبعتلو أول رسالة خاصة بالتفاصيل) تعليقه: ${text}` }];
    else history = [{ direction: 'in', body: `(تعليق عام على منشور إنستغرام — رد قصير بسطر أو سطرين، وقلّو إنك بعتلو التفاصيل عالخاص، ولا تطلب معلومات شخصية بالتعليق) ${text}` }];
    try {
      const reply = (await aiAnswer(t, history)).slice(0, 900);
      bumpUsage(t.id, 'ai_replies');
      log(t.id, { kind: kind === 'comment' ? 'comment' : 'dm', platform: b.platform === 'fb' ? 'fb' : 'ig', from: String(b.from || '').slice(0, 60), text, [kind === 'comment' ? 'public' : 'dm']: reply, via: 'ext' });
      return send(res, 200, { reply }), true;
    } catch (e) { return send(res, 500, { error: e.message }), true; }
  }

  if (pathname === '/meta' || pathname === '/meta/') return send(res, 200, PAGE, 'text/html; charset=utf-8'), true;

  if (pathname.startsWith('/meta/api/')) {
    if (!user || !tenant) return send(res, 401, { error: 'سجّل دخول أول من الصفحة الرئيسية' }), true;
    if (req.method === 'GET' && pathname === '/meta/api/config') {
      const c = cfgOf(tenant.id);
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const pub = getSetting('public_link', {}).last_url || `https://${host}`;
      return send(res, 200, {
        app_id: c.app_id || '', hasSecret: !!c.app_secret_enc, connected: !!c.page_token_enc, page_name: c.page_name || '', page_id: c.page_id || '',
        pages: (c.pages || []).map(p => ({ id: p.id, name: p.name, ig: p.ig?.username || null })), ig_username: c.ig_username || '',
        enabled: !!c.enabled, dm: c.dm !== false, dm_reply: c.dm_reply !== false, fb_comments: c.fb_comments !== false, ig_comments: c.ig_comments !== false,
        public_mode: c.public_mode || 'fixed', public_text: c.public_text || 'أهلين 🌹 بعتنالك التفاصيل عالخاص 📩',
        webhook_url: `${pub}/meta/webhook/${tenant.id}`, verify_token: c.verify_token || '(بيطلع بعد أول حفظ)',
        ext_token: c.ext_token || '', server: pub,
        log: getSetting(`meta_log_${tenant.id}`, [])
      }), true;
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      if (!(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'JSON' }), true;
      const origin = req.headers.origin;
      if (origin) {
        let oh = ''; try { oh = new URL(origin).host; } catch {}
        const pl = getSetting('public_link', {});
        const allowed = [req.headers.host, req.headers['x-forwarded-host'], ...(pl.hosts || [])];
        if (!allowed.includes(oh)) return send(res, 403, { error: 'مصدر غير مسموح' }), true;
      }
      let b = {}; try { b = JSON.parse((await readRaw(req)).toString('utf8') || '{}'); } catch { return send(res, 400, { error: 'JSON' }), true; }
      try {
        if (pathname === '/meta/api/connect') { await connect(tenant.id, b); return send(res, 200, { ok: true }), true; }
        if (pathname === '/meta/api/settings') {
          const patch = {};
          for (const k of ['enabled', 'dm', 'dm_reply', 'fb_comments', 'ig_comments']) if (b[k] !== undefined) patch[k] = !!b[k];
          if (['fixed', 'ai', 'off'].includes(b.public_mode)) patch.public_mode = b.public_mode;
          if (b.public_text !== undefined) patch.public_text = String(b.public_text).slice(0, 500);
          if (!cfgOf(tenant.id).verify_token) patch.verify_token = crypto.randomBytes(12).toString('hex');
          save(tenant.id, patch); return send(res, 200, { ok: true }), true;
        }
        if (pathname === '/meta/api/ext-token') {
          const c = cfgOf(tenant.id), map = getSetting('ext_tokens', {});
          if (c.ext_token) delete map[c.ext_token];
          const tok = 'kf_' + crypto.randomBytes(18).toString('hex');
          map[tok] = tenant.id; setSetting('ext_tokens', map); save(tenant.id, { ext_token: tok });
          return send(res, 200, { token: tok }), true;
        }
        if (pathname === '/meta/api/test') {
          const answer = await aiAnswer(tenant, [{ direction: 'in', body: `(تعليق على منشور فيسبوك) ${String(b.text || 'قديش السعر؟').slice(0, 500)}` }]);
          return send(res, 200, { answer }), true;
        }
      } catch (e) { return send(res, 400, { error: e.message }), true; }
    }
    return send(res, 404, { error: 'غير موجود' }), true;
  }
  return false;
}

const PAGE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ربط فيسبوك وإنستغرام</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#f5f6fa;--card:#fff;--ink:#16181d;--mut:#6b7280;--line:#e5e7eb;--pri:#2F5BFF;--ok:#16a34a;--bad:#dc2626}
@media(prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--ink:#eef0f4;--mut:#9aa3b2;--line:#262b36}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;line-height:1.6}
.w{max-width:820px;margin:0 auto;padding:16px}h1{font-size:24px;margin:8px 0}h2{font-size:17px;margin:0 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:14px 0}
label{display:block;margin:10px 0 4px;font-weight:600;font-size:14px}input,select,textarea{width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit;font:inherit}
.btn{background:var(--pri);color:#fff;border:0;border-radius:10px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer}.btn.g{background:transparent;color:var(--pri);border:1px solid var(--pri)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.mut{color:var(--mut);font-size:14px}.ok{color:var(--ok)}.bad{color:var(--bad)}
.chk{display:flex;gap:8px;align-items:center;margin:6px 0}.chk input{width:auto}code{direction:ltr;display:inline-block;background:#8881;padding:2px 6px;border-radius:6px;word-break:break-all}
ol li{margin:6px 0}.log{border-top:1px solid var(--line);padding:8px 0;font-size:14px}a{color:var(--pri)}
</style></head><body><div class="w">
<p><a href="/#/">← رجوع للوحة التحكم</a></p>
<h1>ردود فيسبوك وإنستغرام 💬</h1>
<p class="mut">لما حدا يعلّق على منشوراتك، البوت بيرد عالتعليق وبيبعتلو رسالة خاصة بالتفاصيل — وبيكمّل معه بالخاص.</p>
<div id="app">جاري التحميل…</div></div>
<script>
const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(p,b){const r=await fetch(p,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||r.status);return d}
async function draw(){let d;try{d=await api('/meta/api/config')}catch(e){$('#app').innerHTML='<div class="card bad">'+esc(e.message)+' — <a href="/#/">سجّل دخول</a></div>';return}
$('#app').innerHTML=\`
<div class="card"><h2>الحالة</h2>
 \${d.connected?'<p class="ok">✅ مربوط بصفحة <b>'+esc(d.page_name)+'</b>'+(d.ig_username?' وإنستغرام <b>@'+esc(d.ig_username)+'</b>':' (ما في إنستغرام مربوط بالصفحة)')+'</p>':'<p class="bad">✗ لسا مو مربوط</p>'}
 \${d.connected?'<label class="chk"><input type="checkbox" id="en" '+(d.enabled?'checked':'')+'> شغّل الردود التلقائية</label>':''}
</div>
<div class="card" style="border:2px solid var(--pri)"><h2>🧩 إضافة كروم — رد على تعليقات إنستغرام (بدون Meta للمطوّرين)</h2>
<ol class="mut">
 <li><a href="/kfast-extension.zip" download>نزّل الإضافة (zip)</a> وفك الضغط عنها بمجلد.</li>
 <li>بكروم افتح <code>chrome://extensions</code> ← شغّل <b>Developer mode</b> فوق ← <b>Load unpacked</b> ← اختار المجلد.</li>
 <li>اكبس <b>طلّع مفتاح</b> تحت، وانسخه، والصقه بالإضافة (أيقونة K FAST AI فوق) ← فعّل ← حفظ.</li>
 <li>افتح <b>instagram.com</b> مسجّل دخول بحسابك وخلّي التبويب مفتوح.</li>
</ol>
<p class="row"><button class="btn" id="xt">\${d.ext_token?'طلّع مفتاح جديد':'طلّع مفتاح'}</button></p>
\${d.ext_token?'<p>مفتاح الإضافة: <code id="xtv">'+esc(d.ext_token)+'</code> <button class="btn g" id="xc">نسخ</button></p><p class="mut">رابط المنصة: <code>'+esc(d.server)+'</code></p>':''}
<p class="mut">⚠️ هالطريقة مو رسمية من Meta — في خطر يتقيّد الحساب. البوت بيرد ببطء (دقيقة لدقيقتين بين كل رد) وعلى التعليقات الجديدة بس لحتى يقلّ الخطر. جرّبها أول على حساب مو مهم.</p>
</div>
<div class="card"><h2>الطريقة الرسمية (بدها تطبيق Meta — مو متاحة بسوريا حالياً)</h2><h2 style="font-size:15px">1) اعمل تطبيق Meta (مرة وحدة)</h2><ol class="mut">
 <li>افتح <a href="https://developers.facebook.com/apps" target="_blank">developers.facebook.com/apps</a> ← <b>Create App</b> ← اختار <b>Other</b> ثم <b>Business</b>.</li>
 <li>من <b>App settings ← Basic</b> انسخ <b>App ID</b> و <b>App Secret</b> والصقهن تحت.</li>
 <li>ضيف المنتجات: <b>Messenger</b> و <b>Instagram</b> و <b>Webhooks</b>.</li>
 <li>بـ <b>Webhooks</b> اختار <b>Page</b> وبعدين <b>Instagram</b>، ولكل وحدة حط:<br>Callback URL: <code>\${esc(d.webhook_url)}</code><br>Verify token: <code>\${esc(d.verify_token)}</code><br>واشترك بـ: Page ← <b>feed, messages</b> · Instagram ← <b>comments, messages</b></li>
 <li>افتح <a href="https://developers.facebook.com/tools/explorer" target="_blank">Graph API Explorer</a> ← اختار تطبيقك ← <b>User Token</b> ← ضيف الصلاحيات:<br><code>pages_show_list pages_read_engagement pages_manage_engagement pages_manage_metadata pages_messaging instagram_basic instagram_manage_comments instagram_manage_messages business_management</code><br>← <b>Generate Access Token</b> ← اختار صفحتك ← انسخ التوكن والصقه تحت.</li>
</ol>
 <label>App ID</label><input id="aid" dir="ltr" value="\${esc(d.app_id)}">
 <label>App Secret</label><input id="sec" dir="ltr" placeholder="\${d.hasSecret?'✓ محفوظ — اتركه فاضي':''}">
 <label>التوكن من Graph API Explorer</label><input id="tok" dir="ltr" placeholder="\${d.connected?'✓ مربوط — الصق توكن جديد بس إذا بدك تغيّر الصفحة':'EAAG…'}">
 \${d.pages.length>1?'<label>الصفحة</label><select id="pg">'+d.pages.map(p=>'<option value="'+p.id+'" '+(p.id===d.page_id?'selected':'')+'>'+esc(p.name)+(p.ig?' · @'+esc(p.ig):'')+'</option>').join('')+'</select>':''}
 <p class="row"><button class="btn" id="con">ربط</button><span id="cm" class="mut"></span></p>
</div>
<div class="card"><h2>2) كيف يرد</h2>
 <label class="chk"><input type="checkbox" id="fbc" \${d.fb_comments?'checked':''}> رد على تعليقات فيسبوك</label>
 <label class="chk"><input type="checkbox" id="igc" \${d.ig_comments?'checked':''}> رد على تعليقات إنستغرام</label>
 <label class="chk"><input type="checkbox" id="dm" \${d.dm?'checked':''}> ابعت رسالة خاصة للمعلّق بالتفاصيل</label>
 <label class="chk"><input type="checkbox" id="dmr" \${d.dm_reply?'checked':''}> كمّل رد على الرسائل الخاصة (ماسنجر وإنستا)</label>
 <label>الرد العام على التعليق</label>
 <select id="pm"><option value="fixed" \${d.public_mode==='fixed'?'selected':''}>نص ثابت (مستحسن)</option><option value="ai" \${d.public_mode==='ai'?'selected':''}>نفس رد الذكاء</option><option value="off" \${d.public_mode==='off'?'selected':''}>بلا رد عام</option></select>
 <label>النص الثابت</label><input id="pt" value="\${esc(d.public_text)}">
 <p class="row"><button class="btn" id="sv">حفظ</button><span id="sm" class="mut"></span></p>
</div>
<div class="card"><h2>جرّب الرد</h2><div class="row"><input id="tt" style="flex:1" placeholder="اكتب تعليق متل: قديش السعر؟"><button class="btn g" id="tb">جرّب</button></div><p id="tr" class="mut"></p></div>
<div class="card"><h2>آخر الردود</h2>\${d.log.length?d.log.map(l=>'<div class="log"><b>'+(l.platform==='ig'?'📸 إنستا':'📘 فيس')+' · '+(l.kind==='dm'?'رسالة':'تعليق')+'</b> من '+esc(l.from)+' <span class="mut">'+new Date(l.at).toLocaleString('ar')+'</span><br>💬 '+esc(l.text)+(l.public?'<br>↩️ '+esc(l.public):'')+(l.dm?'<br>📩 '+esc(l.dm):'')+(l.reply?'<br>📩 '+esc(l.reply):'')+(l.error||l.dm_error?'<br><span class="bad">✗ '+esc(l.error||l.dm_error)+'</span>':'')+'</div>').join(''):'<p class="mut">لسا ما في شي.</p>'}</div>\`;
$('#con').onclick=async()=>{$('#cm').textContent='عم يربط…';try{await api('/meta/api/connect',{app_id:$('#aid').value.trim(),app_secret:$('#sec').value.trim(),user_token:$('#tok').value.trim(),page_id:$('#pg')?.value});await api('/meta/api/settings',{enabled:true});draw()}catch(e){$('#cm').innerHTML='<span class="bad">'+esc(e.message)+'</span>'}};
$('#sv').onclick=async()=>{try{await api('/meta/api/settings',{fb_comments:$('#fbc').checked,ig_comments:$('#igc').checked,dm:$('#dm').checked,dm_reply:$('#dmr').checked,public_mode:$('#pm').value,public_text:$('#pt').value});$('#sm').textContent='✓ انحفظ'}catch(e){$('#sm').textContent=e.message}};
$('#en')&&($('#en').onchange=async e=>{await api('/meta/api/settings',{enabled:e.target.checked})});
$('#xt').onclick=async()=>{if(d.ext_token&&!confirm('المفتاح القديم رح يوقف. أكيد؟'))return;try{await api('/meta/api/ext-token',{});draw()}catch(e){alert(e.message)}};
$('#xc')&&($('#xc').onclick=()=>{navigator.clipboard.writeText(d.ext_token);$('#xc').textContent='✓ انسخ'});
$('#tb').onclick=async()=>{$('#tr').textContent='عم يفكّر…';try{const r=await api('/meta/api/test',{text:$('#tt').value});$('#tr').textContent='📩 '+r.answer}catch(e){$('#tr').textContent=e.message}};
}
draw();
</script></body></html>`;
