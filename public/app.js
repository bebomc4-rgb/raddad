// ردّاد — لوحة التحكم (بدون مكتبات، تشتغل على الموبايل والكمبيوتر)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

let ME = null;          // بيانات المستخدم والمتجر
let INFO = null;        // معلومات المنصة العامة
let ES = null;          // البث المباشر
const live = { onMessage: null, onWA: null };

// ===== أيقونات =====
const I = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  chat: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z"/>',
  bag: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  send: '<path d="M21 3L3 11l7 3 3 7z"/>',
  back: '<path d="M9 6l6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>'
};
const icon = (n, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${I[n]}</svg>`;

// ===== اتصال بالسيرفر =====
async function api(path, { method = 'GET', body } = {}) {
  if (method !== 'GET' && body === undefined) body = {}; // السيرفر بيطلب JSON بكل طلب بيغيّر شي
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && path !== '/api/auth/login') { ME = null; if (!location.hash.startsWith('#/login')) go('#/login'); }
  if (!res.ok) throw new Error(data.error || `خطأ (${res.status})`);
  return data;
}

function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3200);
}
const fail = e => toast(e.message || String(e), true);

async function busy(btn, fn) {
  const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '…';
  try { return await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; btn.innerHTML = old; }
}

function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'number') o[el.name] = el.value === '' ? '' : Number(el.value);
    else o[el.name] = el.value;
  }
  return o;
}

const fmtTime = ts => {
  const d = new Date(ts * 1000), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'مبارح';
  return d.toLocaleDateString('ar', { day: 'numeric', month: 'short' });
};
const fmtDay = ts => new Date(ts * 1000).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' });
const initial = s => (String(s || '').trim()[0] || '؟').toUpperCase();
const contactName = c => c.name || (c.phone ? '+' + c.phone : 'عميل');

// ===== التنقل =====
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
window.addEventListener('hashchange', route);

const NAV = [
  { h: '#/', t: 'الرئيسية', i: 'home' },
  { h: '#/inbox', t: 'المحادثات', i: 'chat', badge: () => ME?.counts.needs_human ? [ME.counts.needs_human, 'amber'] : ME?.counts.unread ? [ME.counts.unread, ''] : null },
  { h: '#/orders', t: 'الطلبات', i: 'bag', badge: () => ME?.counts.new_orders ? [ME.counts.new_orders, ''] : null },
  { h: '#/products', t: 'المنتجات', i: 'box' },
  { h: '#/quick', t: 'إضافة بالصور والصوت', i: 'mic' },
  { h: '#/auto', t: 'تعديل تلقائي من مجلد', i: 'spark' },
  { h: '#/studio', t: 'استوديو Gemini', i: 'spark' },
  { h: '#/batch', t: 'تعديل صور جماعي', i: 'spark' },
  { g: 'الوكيل الذكي' },
  { h: '#/agent', t: 'شخصية الوكيل والمعرفة', i: 'bot' },
  { h: '#/learn', t: 'علّم الوكيل أسلوبك', i: 'spark' },
  { h: '#/playground', t: 'جرّب الوكيل', i: 'play' },
  { h: '/meta', t: 'الرد على التعليقات', i: 'chat' },
  { h: '#/messenger', t: 'مجيب المسنجر', i: 'chat', super: true },
  { g: 'الإعدادات' },
  { h: '#/connect', t: 'ربط واتساب', i: 'link' },
  { h: '#/ai', t: 'الذكاء الاصطناعي', i: 'spark' },
  { h: '#/link', t: 'رابط الموقع العام', i: 'link', super: true },
  { h: '#/billing', t: 'الاشتراك', i: 'card' },
  { h: '#/s', t: 'صفحتي', i: 'user' },
  { h: '#/account', t: 'حسابي', i: 'user' },
  { h: '#/admin', t: 'إدارة المنصة', i: 'shield', super: true }
];
const TABS = [
  { h: '#/', t: 'الرئيسية', i: 'home' },
  { h: '#/inbox', t: 'المحادثات', i: 'chat' },
  { h: '#/orders', t: 'الطلبات', i: 'bag' },
  { h: '#/products', t: 'المنتجات', i: 'box' },
  { h: '#/more', t: 'المزيد', i: 'more' }
];

function shell(active, content) {
  const b = ME.brand;
  const nav = NAV.filter(n => !n.super || ME.user.is_super).map(n => {
    if (n.g) return `<div class="group">${n.g}</div>`;
    const bd = n.badge?.();
    return `<a class="item ${active === n.h ? 'on' : ''}" href="${n.h}">${icon(n.i)}<span>${n.t}</span>${bd ? `<span class="count ${bd[1]}">${bd[0]}</span>` : ''}</a>`;
  }).join('');
  const tabs = TABS.map(t => {
    const on = active === t.h || (t.h === '#/more' && !TABS.some(x => x.h === active));
    const dot = (t.h === '#/inbox' && ME.counts.needs_human) || (t.h === '#/orders' && ME.counts.new_orders);
    return `<a class="${on ? 'on' : ''}" href="${t.h}">${icon(t.i)}<span>${t.t}</span>${dot ? '<i class="dot"></i>' : ''}</a>`;
  }).join('');
  app.innerHTML = `
    <div class="shell">
      <nav class="nav" aria-label="القائمة">
        <div class="brand"><div class="seal">K</div><div><b>${esc(b.name)}</b><small class="muted">${esc(ME.tenant.name)}</small></div></div>
        ${nav}
        <div class="foot muted">${esc(ME.user.email)}</div>
      </nav>
      <main class="main">${subBanner()}${content}</main>
      <nav class="tabbar" aria-label="التبويبات">${tabs}</nav>
    </div>`;
}

function subBanner() {
  const t = ME.tenant, g = ME.gate;
  if (g && !g.ok) return `<a class="subbar bad" href="#/billing">${esc(g.message)}</a>`;
  if (g?.code === 'trial') {
    const left = g.ends_at - Date.now() / 1000;
    return `<div class="subbar">التجربة المجانية بتنتهي بعد ${left > 86400 ? Math.ceil(left / 86400) + ' يوم' : Math.max(1, Math.ceil(left / 3600)) + ' ساعة'}</div>`;
  }
  if (t.plan_id === 'free' || !t.plan_expires_at) return '';
  const left = t.plan_expires_at - Date.now() / 1000;
  if (left > 3 * 86400) return '';
  return `<a class="subbar ${left <= 0 ? 'bad' : ''}" href="#/billing">${left <= 0 ? 'اشتراكك منتهي والوكيل موقوف عن الرد. جدّد الآن' : `اشتراكك بينتهي بعد ${Math.ceil(left / 86400)} يوم. جدّد حتى ما يوقف الوكيل`}</a>`;
}

function mobileTop() {
  return `<div class="mobile-top"><div class="seal">K</div><b>${esc(ME.tenant.name)}</b></div>`;
}

async function refreshMe() {
  ME = await api('/api/me');
  const c = ME.brand.color;
  if (c && c.toLowerCase() !== '#0e7a5a' && c.toLowerCase() !== '#2f5bff') document.documentElement.style.setProperty('--brand', c);
  else document.documentElement.style.removeProperty('--brand');
  return ME;
}

async function route() {
  const hash = location.hash || '#/';
  const [pathPart, qs = ''] = hash.split('?');
  const [, page = '', sub = ''] = pathPart.split('/');
  route.qs = new URLSearchParams(qs);
  if (page === 'login' || page === 'register') return viewAuth(page);
  if (!ME) {
    try { await refreshMe(); startLive(); } catch {
      if (page === '') return viewLanding();
      try { sessionStorage.setItem('next', hash); } catch {}
      return go('#/login');
    }
  }
  live.onMessage = null; live.onWA = null;
  try { route.cleanup?.(); } catch {} route.cleanup = null;
  const views = { '': viewHome, inbox: viewInbox, orders: viewOrders, products: viewProducts, agent: viewAgent, playground: viewPlayground,
    connect: viewConnect, ai: viewAI, quick: viewQuick, studio: viewStudio, auto: viewAuto, link: viewLink, messenger: viewMessenger, batch: viewBatch, learn: viewLearn, billing: viewBilling, s: viewStore, account: viewAccount, admin: viewAdmin, more: viewMore };
  const v = views[page] || viewHome;
  try { await v(sub); } catch (e) { fail(e); }
  window.scrollTo(0, 0);
}

// ===== البث المباشر =====
function startLive() {
  if (ES) ES.close();
  ES = new EventSource('/api/events');
  ES.addEventListener('message', e => {
    const d = JSON.parse(e.data);
    if (d.message.direction === 'in') ME.counts.unread++;
    live.onMessage?.(d);
  });
  ES.addEventListener('order', e => {
    const d = JSON.parse(e.data);
    ME.counts.new_orders++;
    toast(`🛒 طلب جديد #${d.order.id}`);
    updateBadges();
  });
  ES.addEventListener('handoff', () => { ME.counts.needs_human++; toast('🙋 عميل بحاجة لموظف'); updateBadges(); live.onMessage?.({}); });
  ES.addEventListener('wa', e => { ME.wa = JSON.parse(e.data); live.onWA?.(ME.wa); });
  ES.addEventListener('notice', e => toast(JSON.parse(e.data).text));
  ES.addEventListener('agent_error', e => toast('⚠️ ' + JSON.parse(e.data).error, true));
  ES.addEventListener('contact', () => live.onMessage?.({}));
  const skipped = new Map();
  ES.addEventListener('skip', e => {
    const d = JSON.parse(e.data);
    const k = d.contact_id + d.reason;
    if (Date.now() - (skipped.get(k) || 0) < 600_000) return; // مرة كل 10 دقايق لنفس السبب
    skipped.set(k, Date.now());
    toast('🤖 الوكيل ما رد: ' + d.reason);
  });
}
function updateBadges() {
  const active = '#/' + (location.hash.split('/')[1] || '');
  for (const a of $$('.nav a.item')) {
    const n = NAV.find(x => x.h === a.getAttribute('href'));
    const bd = n?.badge?.();
    a.querySelector('.count')?.remove();
    if (bd) a.insertAdjacentHTML('beforeend', `<span class="count ${bd[1]}">${bd[0]}</span>`);
  }
  void active;
}


// ===== الصفحة التسويقية =====
async function viewLanding() {
  if (!INFO) INFO = await api('/api/public/info').catch(() => ({ brand: { name: 'K FAST AI' }, registration_open: true, plans: [] }));
  if (INFO.needs_setup) return go('#/register');
  const b = INFO.brand;
  const feats = [
    ['🤖', 'وكيل مبيعات ذكي', 'بيرد على زبائنك بلهجتهم، بيقترح المنتج المناسب وبيسجّل الطلب كامل.'],
    ['⚡', 'رد فوري 24/7', 'ما بيتأخر ولا بينام. زبونك بياخد جواب بثواني حتى لو إنت نايم.'],
    ['📦', 'منتجاتك بصورة وصوت', 'صوّر المنتج واحكي اسمه وسعره، والوكيل بيضيفه لحاله.'],
    ['🙋', 'تحويل لموظف', 'إذا الزبون زعلان أو الطلب برا صلاحيته، بيحوّله إلك فوراً.'],
    ['🛒', 'طلبات منظمة', 'كل طلب بيوصلك إشعار ومن اللوحة بتتابع حالته.'],
    ['📱', 'تطبيق عالموبايل', 'نزّله على شاشتك الرئيسية وتابع محادثاتك من أي مكان.']
  ].map(([e, t, d]) => `<div class="feat"><span class="em">${e}</span><h3>${t}</h3><p>${d}</p></div>`).join('');
  const plans = (INFO.plans || []).map(p => `
    <div class="price">
      <h3>${esc(p.name)}</h3>
      <div><b class="p">${p.price_monthly ? esc(p.price_monthly) + ' ' + esc(p.currency || '$') : 'مجاناً'}</b>${p.price_monthly ? ' <small class="muted">/ شهر</small>' : ''}</div>
      <ul>
        <li>${esc(p.ai_replies_per_day)} رد ذكي باليوم</li>
        <li>${esc(p.max_products)} منتج</li>
        ${(p.features || []).map(f => `<li>${esc(f)}</li>`).join('')}
      </ul>
      <a class="btn primary" href="#/register">اشترك</a>
    </div>`).join('');
  app.innerHTML = `
    <div class="land">
      <header><div class="wrap">
        <div class="row"><div class="seal">K</div><b>${esc(b.name)}</b></div>
        <button class="theme-btn" id="tg" aria-label="الوضع الليلي">🌓</button>
        <a class="btn" href="#/login">دخول</a>
        ${INFO.registration_open ? '<a class="btn primary" href="#/register">اشترك</a>' : ''}
      </div></header>
      <div class="wrap hero">
        <h1>زبائنك بيسألوا على واتساب، <em>ووكيلك الذكي بيبيع بدالك</em></h1>
        <p>اربط رقم متجرك، ضيف منتجاتك، وخلّي الوكيل يرد، يقترح، ويسجّل الطلبات 24 ساعة.</p>
        <div class="cta">
          ${INFO.registration_open ? '<a class="btn primary lg" href="#/register">اشترك الآن</a>' : ''}
          <button class="btn lg" id="more" type="button">شو بتعمل المنصة؟</button>
        </div>
      </div>
      <section id="features"><div class="wrap"><h2>شو بتعمل المنصة؟</h2><div class="feats">${feats}</div></div></section>
      ${plans ? `<section><div class="wrap"><h2>الباقات</h2><div class="prices">${plans}</div></div></section>` : ''}
      <footer>${esc(b.name)} © ${new Date().getFullYear()}</footer>
    </div>`;
  $('#more').onclick = () => $('#features').scrollIntoView({ behavior: 'smooth' });
  $('#tg').onclick = () => {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    try { localStorage.setItem('theme', dark ? 'light' : 'dark'); } catch {}
    applyTheme();
  };
}

// ===== الدخول والتسجيل =====
async function viewAuth(mode) {
  if (!INFO) INFO = await api('/api/public/info').catch(() => ({ brand: { name: 'ردّاد' }, registration_open: true }));
  if (INFO.needs_setup) mode = 'register';
  const reg = mode === 'register';
  const b = INFO.brand;
  app.innerHTML = `
    <div class="auth">
      <section class="side">
        <div>
          <div class="row"><div class="seal">K</div><b style="font-size:20px">${esc(b.name)}</b></div>
          <h1>زبائنك بيسألوا على واتساب، ووكيلك بيرد ويبيع بدالك.</h1>
          <p>اربط رقم متجرك، ضيف منتجاتك، وخلّي الوكيل الذكي يجاوب بلهجة زبونك، يقترح المنتج المناسب، ويسجّل الطلب كامل.</p>
          <div class="demo" aria-hidden="true">
            <div class="b c">مرحبا، عندكن حذاء رياضي نمرة 43؟</div>
            <div class="b r">أهلين 👋 إي موجود! عنا *Air Zoom* بـ 85$ ومريح كتير للركض، والأسود متوفر بنمرة 43. بتحب ابعتلك صورته؟</div>
            <div class="b c">إي ابعت</div>
          </div>
        </div>
        <small style="opacity:.75">${esc(b.tagline || '')}</small>
      </section>
      <section class="form">
        <form id="f" novalidate>
          <h2>${reg ? (INFO.needs_setup ? 'إعداد المنصة' : 'افتح حساب لمتجرك') : 'أهلاً فيك من جديد'}</h2>
          <p>${reg ? (INFO.needs_setup ? 'أول حساب بيصير مدير المنصة.' : 'مجاناً، وبدون بطاقة.') : 'سجّل دخول لتتابع محادثاتك وطلباتك.'}</p>
          ${reg ? `
            <label class="field"><span>اسم المتجر</span><input type="text" name="business_name" required autocomplete="organization"></label>
            <label class="field"><span>اسمك</span><input type="text" name="name" autocomplete="name"></label>` : ''}
          <label class="field"><span>الإيميل</span><input type="email" name="email" required dir="ltr" autocomplete="email"></label>
          <label class="field"><span>كلمة السر</span><input type="password" name="password" required minlength="8" dir="ltr" autocomplete="${reg ? 'new-password' : 'current-password'}">${reg ? '<small class="muted">8 أحرف أو أكتر</small>' : ''}</label>
          <button class="btn primary" style="width:100%" type="submit">${reg ? 'افتح الحساب' : 'دخول'}</button>
          ${INFO.needs_setup ? '' : `<div class="switchline">${reg ? 'عندك حساب؟ <a href="#/login">سجّل دخول</a>' : (INFO.registration_open ? 'ما عندك حساب؟ <a href="#/register">افتح حساب مجاني</a>' : '')}</div>`}
        </form>
      </section>
    </div>`;
  $('#f').onsubmit = e => {
    e.preventDefault();
    busy(e.submitter, async () => {
      await api(reg ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: formData(e.target) });
      INFO = null;
      await refreshMe(); startLive();
      let next = '#/'; try { next = sessionStorage.getItem('next') || '#/'; sessionStorage.removeItem('next'); } catch {}
      go(next);
    });
  };
}

// ===== الرئيسية =====
async function viewHome() {
  await refreshMe();
  const t = ME.tenant, u = ME.usage, p = ME.plan;
  const ownKey = t.ai_provider !== 'platform' && t.ai_key;
  const pct = ownKey ? 0 : Math.min(100, Math.round(u.ai_replies / Math.max(1, p.ai_replies_per_day) * 100));
  const waOk = ME.wa.status === 'open';
  const k = t.knowledge;
  const steps = [
    { done: waOk, t: 'اربط رقم واتساب المتجر', h: '#/connect', b: 'ربط' },
    { done: ME.counts.products > 0, t: 'ضيف منتجاتك أو استوردها', h: '#/products', b: 'المنتجات' },
    { done: !!(k.about || k.delivery || k.payment), t: 'اكتب معلومات المتجر (التوصيل، الدفع…)', h: '#/agent', b: 'تعبئة' },
    { done: false, t: 'جرّب الوكيل قبل ما يحكي مع زبائنك', h: '#/playground', b: 'تجربة' }
  ];
  const allDone = steps.slice(0, 3).every(s => s.done);
  shell('#/', `
    ${mobileTop()}
    <div class="page">
      <div class="page-head">
        <h1>أهلاً${ME.user.name ? '، ' + esc(ME.user.name) : ''}</h1>
        <div class="actions">
          <label class="switch" title="تشغيل أو إيقاف الرد الآلي لكل الزبائن">
            <input type="checkbox" id="botAll" ${t.bot_enabled ? 'checked' : ''}><span class="track"></span>
            <span id="botLbl">${t.bot_enabled ? 'الوكيل عم يرد' : 'الوكيل موقوف'}</span>
          </label>
        </div>
      </div>

      ${t.settings.test_mode ? `<div class="note warn" style="margin-bottom:14px">🧪 <b>وضع الاختبار شغّال:</b> الوكيل بيرد بس على <span dir="ltr">${esc(String(t.settings.test_numbers || '').trim() || '—')}</span>. <a href="#/agent">غيّر أو أطفيه</a></div>` : ''}
      ${!waOk ? `<div class="note warn" style="margin-bottom:14px">واتساب مو مربوط، فالوكيل ما عم يستقبل رسائل. <a href="#/connect">اربط الرقم هلق</a></div>` : ''}
      ${ME.counts.needs_human ? `<div class="note warn" style="margin-bottom:14px"><b>${ME.counts.needs_human}</b> ${ME.counts.needs_human === 1 ? 'عميل بيستنى' : 'عملاء بيستنوا'} رد من موظف. <a href="#/inbox?f=human">افتح المحادثات</a></div>` : ''}

      <div class="grid stats">
        <div class="panel stat"><b>${u.msgs_in}</b><span>رسالة من الزبائن اليوم</span></div>
        <div class="panel stat"><b>${u.ai_replies}${ownKey ? '' : `<small class="muted" style="font-size:14px"> / ${p.ai_replies_per_day}</small>`}</b><span>${ownKey ? 'رد ذكي اليوم (مفتاحك الخاص — بلا حد)' : 'رد ذكي اليوم'}</span>${ownKey ? '' : `<div class="meter"><i class="${pct > 80 ? 'warn' : ''}" style="width:${pct}%"></i></div>`}</div>
        <div class="panel stat"><b>${u.orders}</b><span>طلب سجّله الوكيل اليوم</span></div>
        <div class="panel stat"><b>${waOk ? '<span class="chip ok">متصل</span>' : '<span class="chip bad">مو متصل</span>'}</b><span>${waOk && ME.wa.phone ? '<span dir="ltr">+' + esc(ME.wa.phone) + '</span>' : 'واتساب'}</span></div>
      </div>

      <div class="grid two" style="margin-top:14px">
        <div class="panel">
          <h2>${allDone ? 'متجرك جاهز' : 'جهّز متجرك'}</h2>
          <p>${allDone ? 'كل شي مضبوط. كل ما تضيف معلومات أكتر، الوكيل بيصير أذكى.' : 'أربع خطوات وبيصير الوكيل يبيع عنك.'}</p>
          <ol class="steps">${steps.map(s => `<li class="${s.done ? 'done' : ''}"><span>${s.t}</span>${s.done ? '' : `<a class="btn small" href="${s.h}">${s.b}</a>`}</li>`).join('')}</ol>
        </div>
        <div class="panel" id="chartP">
          <h2>آخر 14 يوم</h2>
          <p>رسائل الزبائن والطلبات</p>
          <div id="chart" class="muted">…</div>
        </div>
      </div>
    </div>`);
  $('#botAll').onchange = async e => {
    try {
      await api('/api/settings', { method: 'PUT', body: { bot_enabled: e.target.checked } });
      $('#botLbl').textContent = e.target.checked ? 'الوكيل عم يرد' : 'الوكيل موقوف';
      toast(e.target.checked ? 'الوكيل رجع يرد على الزبائن' : 'وقفنا الوكيل. الرسائل بتوصل بس ما حدا بيرد آلياً');
    } catch (err) { e.target.checked = !e.target.checked; fail(err); }
  };
  const st = await api('/api/stats');
  $('#chart').innerHTML = barChart(st.days);
}

function barChart(days) {
  const map = Object.fromEntries(days.map(d => [d.day, d]));
  const list = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    list.push({ day: d, n: map[d]?.msgs_in || 0, o: map[d]?.orders || 0 });
  }
  const max = Math.max(1, ...list.map(x => x.n));
  if (!list.some(x => x.n)) return '<div class="empty" style="padding:24px">لسا ما في رسائل. أول ما يراسلك زبون رح تبين الأرقام هون.</div>';
  const w = 100 / list.length;
  return `<svg viewBox="0 0 300 120" style="width:100%;height:auto" role="img" aria-label="رسم بياني للرسائل">
    ${list.map((x, i) => {
      const h = Math.max(2, x.n / max * 96);
      const xx = 300 - (i + 1) * w * 3 + 3;
      return `<rect x="${xx}" y="${104 - h}" width="${w * 3 - 6}" height="${h}" rx="3" fill="var(--brand)" opacity=".85"><title>${x.day}: ${x.n} رسالة، ${x.o} طلب</title></rect>${x.o ? `<circle cx="${xx + (w * 3 - 6) / 2}" cy="${100 - h}" r="3.5" fill="var(--amber)"/>` : ''}`;
    }).join('')}
    <line x1="0" y1="104.5" x2="300" y2="104.5" stroke="var(--line)"/>
    <text x="298" y="118" font-size="9" fill="var(--muted)" text-anchor="start">قبل 14 يوم</text>
    <text x="2" y="118" font-size="9" fill="var(--muted)" text-anchor="end">اليوم</text>
  </svg><small class="muted">العمود = رسائل الزبائن، النقطة البرتقالية = يوم فيه طلبات</small>`;
}

// ===== المحادثات =====
let inboxFilter = '';
async function viewInbox(sub) {
  if (route.qs.get('f') !== null) inboxFilter = route.qs.get('f');
  const openId = Number(sub) || null;
  shell('#/inbox', `
    <div class="inbox ${openId ? 'has-thread' : ''}">
      <section class="list-pane">
        <div class="list-head">
          <h1>المحادثات</h1>
          <input type="search" id="cs" placeholder="ابحث بالاسم أو الرقم">
          <div class="seg" id="cf">
            ${[['', 'الكل'], ['human', 'بحاجة موظف'], ['unread', 'غير مقروءة'], ['paused', 'بعهدتك']].map(([v, t]) => `<button data-f="${v}" class="${inboxFilter === v ? 'on' : ''}">${t}</button>`).join('')}
          </div>
        </div>
        <div class="contacts" id="cl"><div class="loading">…</div></div>
      </section>
      <section class="thread" id="th">${openId ? '<div class="loading">…</div>' : '<div class="thread-empty"><div><h3>اختار محادثة</h3><p>كل رسائل زبائنك وردود الوكيل بتظهر هون لحظة بلحظة.</p></div></div>'}</section>
    </div>`);
  // مخفي بالموبايل لما تكون المحادثة مفتوحة
  if (openId) $('.tabbar')?.classList.add('hidden');

  const loadList = async () => {
    const q = $('#cs')?.value || '';
    const rows = await api(`/api/contacts?filter=${inboxFilter}&q=${encodeURIComponent(q)}`);
    const el = $('#cl'); if (!el) return;
    el.innerHTML = rows.length ? rows.map(c => {
      const paused = c.bot_paused_until > Date.now() / 1000;
      return `<a class="contact ${c.id === openId ? 'on' : ''}" href="#/inbox/${c.id}">
        <div class="avatar ${c.needs_human ? 'human' : ''}">${esc(initial(c.name || c.phone))}</div>
        <div class="meta">
          <div class="top"><b>${esc(contactName(c))}</b><time>${fmtTime(c.last_at)}</time></div>
          <div class="last"><span>${c.needs_human ? '🙋 ' : paused ? '✋ ' : ''}${esc(c.last_message || '')}</span>${c.unread ? `<span class="count">${c.unread}</span>` : ''}</div>
        </div></a>`;
    }).join('') : `<div class="empty"><h3>${inboxFilter ? 'ما في محادثات هون' : 'لسا ما في محادثات'}</h3><p>${inboxFilter ? 'جرّب فلتر تاني.' : 'أول ما يراسل زبون رقمك المربوط، بتظهر محادثته هون.'}</p>${!inboxFilter ? '<a class="btn" href="#/playground">جرّب الوكيل بنفسك</a>' : ''}</div>`;
  };
  $('#cf').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    inboxFilter = b.dataset.f;
    $$('#cf button').forEach(x => x.classList.toggle('on', x === b));
    loadList();
  };
  let tmr; $('#cs').oninput = () => { clearTimeout(tmr); tmr = setTimeout(loadList, 250); };
  if (openId) await openThread(openId, loadList);
  else live.onMessage = () => loadList();
  await loadList();
}

async function openThread(id, loadList) {
  const d = await api(`/api/contacts/${id}/messages`);
  const c = d.contact;
  const th = $('#th');
  const render = () => {
    const paused = c.bot_paused_until > Date.now() / 1000;
    const until = paused && c.bot_paused_until < 4102444800 ? `لحد ${new Date(c.bot_paused_until * 1000).toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit' })}` : '';
    th.innerHTML = `
      <header class="thread-head">
        <a class="btn ghost small" href="#/inbox" aria-label="رجوع">${icon('back')}</a>
        <div class="avatar ${c.needs_human ? 'human' : ''}">${esc(initial(c.name || c.phone))}</div>
        <div class="who"><b>${esc(contactName(c))}</b><small class="muted">${c.phone ? '+' + esc(c.phone) : ''}</small></div>
        <button class="btn ghost small" id="infoBtn" aria-label="معلومات العميل">${icon('info')}</button>
        <label class="takeover ${paused ? 'human' : ''}" title="لما تشغّل هالخيار، الوكيل بيسكت وأنت بترد">
          <span class="switch"><input type="checkbox" id="tk" ${paused ? 'checked' : ''}><span class="track"></span></span>
          <span>${paused ? 'أنا عم رد' : 'الوكيل عم يرد'}<span class="long muted" style="font-weight:400"> ${until}</span></span>
        </label>
      </header>
      ${c.needs_human ? `<div class="thread-banner">🙋 هالعميل طلب موظف أو الوكيل حوّله إلك. رد عليه، وبس تخلص رجّع الوكيل. <button class="btn small" id="resume">رجّع الوكيل</button></div>` : ''}
      <div class="side-info" id="sideInfo">
        <label class="field"><span>اسم العميل</span><input type="text" id="cName" value="${esc(c.name || '')}"></label>
        <label class="field"><span>ملاحظات (الوكيل بيقراها)</span><textarea id="cNotes" rows="2">${esc(c.notes || '')}</textarea></label>
        <button class="btn small" id="saveC">حفظ</button>
        ${d.orders.length ? `<h3 style="margin-top:12px">طلباته</h3>${d.orders.map(o => `<div class="muted">#${o.id} — ${esc(JSON.parse(o.items || '[]').map(i => i.name).join('، '))} — ${statusLabel(o.status)}</div>`).join('')}` : ''}
      </div>
      <div class="msgs" id="msgs"></div>
      <form class="composer" id="comp">
        <textarea name="text" rows="1" placeholder="${paused ? 'اكتب ردك…' : 'إذا كتبت هون، الوكيل بيسكت مع هالعميل لفترة'}" required></textarea>
        <button class="btn primary" type="submit" aria-label="إرسال">${icon('send')}</button>
      </form>`;
    const box = $('#msgs');
    box.innerHTML = renderMsgs(d.messages);
    box.scrollTop = box.scrollHeight;
    $('#infoBtn').onclick = () => $('#sideInfo').classList.toggle('open');
    $('#saveC').onclick = e => busy(e.target, async () => {
      c.name = $('#cName').value; c.notes = $('#cNotes').value;
      await api(`/api/contacts/${c.id}`, { method: 'PUT', body: { name: c.name, notes: c.notes } });
      toast('انحفظت معلومات العميل');
    });
    $('#tk').onchange = async e => {
      try {
        await api(`/api/contacts/${c.id}/${e.target.checked ? 'pause' : 'resume'}`, { method: 'POST', body: {} });
        c.bot_paused_until = e.target.checked ? 4102444800 : 0;
        if (!e.target.checked) { if (c.needs_human) ME.counts.needs_human = Math.max(0, ME.counts.needs_human - 1); c.needs_human = 0; }
        toast(e.target.checked ? 'الوكيل سكت. هالعميل بعهدتك' : 'الوكيل رجع يرد على هالعميل');
        render(); loadList();
      } catch (err) { fail(err); e.target.checked = !e.target.checked; }
    };
    $('#resume') && ($('#resume').onclick = () => { $('#tk').checked = false; $('#tk').onchange({ target: $('#tk') }); });
    const ta = $('#comp textarea');
    ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; };
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 860) { e.preventDefault(); $('#comp').requestSubmit(); } };
    $('#comp').onsubmit = e => {
      e.preventDefault();
      const text = ta.value.trim(); if (!text) return;
      busy(e.submitter, async () => {
        await api(`/api/contacts/${c.id}/send`, { method: 'POST', body: { text } });
        ta.value = ''; ta.style.height = '';
        if (!(c.bot_paused_until > Date.now() / 1000)) { c.bot_paused_until = Date.now() / 1000 + 3600; render(); }
      });
    };
  };
  render();
  live.onMessage = ev => {
    if (ev.message && ev.contact_id === c.id) {
      if (!d.messages.some(m => m.id === ev.message.id)) {
        d.messages.push(ev.message);
        const box = $('#msgs'); if (!box) return;
        const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
        box.innerHTML = renderMsgs(d.messages);
        if (near || ev.message.direction === 'out') box.scrollTop = box.scrollHeight;
      }
    } else if (!ev.message) {
      api(`/api/contacts/${id}/messages`).then(n => { Object.assign(c, n.contact); render(); }).catch(() => {});
    }
    loadList();
  };
}

function renderMsgs(msgs) {
  let lastDay = '';
  return msgs.map(m => {
    const day = new Date(m.created_at * 1000).toDateString();
    const sep = day !== lastDay ? `<div class="day">${fmtDay(m.created_at)}</div>` : '';
    lastDay = day;
    const time = new Date(m.created_at * 1000).toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit' });
    const who = m.sender === 'bot' ? `<span class="s">ر</span> الوكيل${m.ai_via ? ' · ' + esc(m.ai_via) : ''}` : m.sender === 'human' ? '<span class="s">أ</span> أنت' : '';
    return `${sep}<div class="bubble ${m.direction} ${m.sender}">${m.media_url ? `<img src="${esc(m.media_url)}" alt="" loading="lazy">` : ''}${waFormat(m.body)}<div class="by">${who}<span>${time}</span></div></div>`;
  }).join('') || '<div class="thread-empty">ما في رسائل</div>';
}
// تنسيق واتساب: *عريض* _مائل_ ~مشطوب~ وروابط
function waFormat(s) {
  return esc(s)
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

// ===== الطلبات =====
const STATUSES = [['new', 'جديد'], ['confirmed', 'مؤكد'], ['shipped', 'بالطريق'], ['done', 'مكتمل'], ['cancelled', 'ملغي']];
const statusLabel = s => (STATUSES.find(x => x[0] === s) || [, s])[1];
let orderFilter = '';
async function viewOrders() {
  const rows = await api('/api/orders' + (orderFilter ? '?status=' + orderFilter : ''));
  const cur = ME.tenant.knowledge.currency || '';
  shell('#/orders', `
    ${mobileTop()}
    <div class="page">
      <div class="page-head"><h1>الطلبات</h1><p>الطلبات يلي سجّلها الوكيل بعد ما أكّد الزبون. غيّر الحالة وانت عم تجهّزها.</p></div>
      <div class="seg" id="of" style="margin-bottom:14px">${[['', 'الكل'], ...STATUSES].map(([v, t]) => `<button data-f="${v}" class="${orderFilter === v ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="panel">
        ${rows.length ? rows.map(o => `
          <div class="order">
            <div>
              <div class="row" style="gap:8px"><b>#${o.id}</b><span class="chip ${o.status === 'new' ? 'warn' : o.status === 'cancelled' ? 'bad' : 'ok'}">${statusLabel(o.status)}</span><small class="muted">${fmtTime(o.created_at)}</small></div>
              <div class="items">${o.items.map(i => `• ${esc(i.name)}${i.options ? ` <span class="muted">(${esc(i.options)})</span>` : ''} × ${i.qty}`).join('<br>')}</div>
              <div class="who">👤 ${esc(o.customer_name || '—')} ${o.customer_phone ? `· <span dir="ltr">+${esc(o.customer_phone)}</span>` : ''}${o.address ? `<br>📍 ${esc(o.address)}` : ''}${o.notes ? `<br>📝 ${esc(o.notes)}` : ''}</div>
            </div>
            <div class="side">
              ${o.total ? `<span class="total">${o.total} ${esc(cur)}</span>` : ''}
              <select data-id="${o.id}" aria-label="حالة الطلب">${STATUSES.map(([v, t]) => `<option value="${v}" ${o.status === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
              ${o.contact_id ? `<a class="btn small" href="#/inbox/${o.contact_id}">المحادثة</a>` : ''}
            </div>
          </div>`).join('') : `<div class="empty"><h3>ما في طلبات ${orderFilter ? 'بهالحالة' : 'لسا'}</h3><p>لما يأكد زبون طلبه بالمحادثة، الوكيل بيسجّله هون وبيبعتلك إشعار.</p></div>`}
      </div>
    </div>`);
  $('#of').onclick = e => { const b = e.target.closest('button'); if (b) { orderFilter = b.dataset.f; viewOrders(); } };
  $$('select[data-id]').forEach(s => s.onchange = async () => {
    try {
      await api(`/api/orders/${s.dataset.id}`, { method: 'PUT', body: { status: s.value } });
      toast(`صار الطلب #${s.dataset.id}: ${statusLabel(s.value)}`);
      ME.counts.new_orders = rows.filter(o => (o.id == s.dataset.id ? s.value : o.status) === 'new').length;
    } catch (e) { fail(e); }
  });
}

// ===== المنتجات =====
let prodQ = '', prodPage = 1;
async function viewProducts() {
  const d = await api(`/api/products?q=${encodeURIComponent(prodQ)}&page=${prodPage}`);
  const cur = ME.tenant.knowledge.currency || '';
  shell('#/products', `
    ${mobileTop()}
    <div class="page">
      <div class="page-head">
        <h1>المنتجات</h1>
        <div class="actions">
          <a class="btn" href="#/quick">${icon('mic')} بالصور والصوت</a>
          <button class="btn" id="imp">استيراد</button>
          <button class="btn primary" id="add">${icon('plus')} منتج</button>
        </div>
        <p>الوكيل بيقرا من هون: الأسماء، الأسعار، المقاسات والصور. كل ما كان الوصف أوضح، كل ما باع أحسن. (${d.total} من ${ME.plan.max_products} بخطتك)</p>
      </div>
      <input type="search" id="ps" placeholder="ابحث بالاسم أو التصنيف أو الكود" value="${esc(prodQ)}" style="margin-bottom:14px">
      ${d.items.length ? `<div class="products">${d.items.map(p => `
        <button class="product ${p.active ? '' : 'off'}" data-id="${p.id}">
          <div class="img" style="${p.image_url ? `background-image:url('${esc(p.image_url)}')` : ''}">${p.image_url ? '' : 'بدون صورة'}</div>
          <div class="body">
            <b>${esc(p.name)}</b>
            <small class="muted">${esc(p.category || '')}${p.stock === 0 ? ' · نفد' : ''}${p.active ? '' : ' · مخفي عن الوكيل'}</small>
            <span class="price">${p.sale_price ? `<span>${p.sale_price} ${esc(p.currency || cur)}</span><s>${p.price ?? ''}</s>` : p.price != null ? `${p.price} ${esc(p.currency || cur)}` : '<small class="muted">بدون سعر</small>'}</span>
          </div>
        </button>`).join('')}</div>
        ${d.total > d.per ? `<div class="row" style="justify-content:center;margin-top:16px">
          <button class="btn" id="prev" ${d.page <= 1 ? 'disabled' : ''}>السابق</button><span class="muted">صفحة ${d.page} من ${Math.ceil(d.total / d.per)}</span>
          <button class="btn" id="next" ${d.page * d.per >= d.total ? 'disabled' : ''}>التالي</button></div>` : ''}
        ${!prodQ ? '<div style="margin-top:24px;text-align:center"><button class="btn danger small" id="delAll">حذف كل المنتجات</button></div>' : ''}`
      : `<div class="panel empty"><h3>${prodQ ? 'ما لقينا شي' : 'ما في منتجات لسا'}</h3><p>${prodQ ? 'جرّب كلمة تانية.' : 'ضيفهن واحد واحد، أو استوردهن دفعة وحدة من ملف Excel/CSV أو من رابط متجرك.'}</p>${prodQ ? '' : '<button class="btn primary" id="imp2">استيراد المنتجات</button>'}</div>`}
    </div>`);
  let t; $('#ps').oninput = e => { clearTimeout(t); t = setTimeout(() => { prodQ = e.target.value; prodPage = 1; viewProducts().then(() => { const s = $('#ps'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }); }, 300); };
  $('#add').onclick = () => productDialog();
  $('#imp').onclick = importDialog;
  $('#imp2') && ($('#imp2').onclick = importDialog);
  $('#prev') && ($('#prev').onclick = () => { prodPage--; viewProducts(); });
  $('#next') && ($('#next').onclick = () => { prodPage++; viewProducts(); });
  $('#delAll') && ($('#delAll').onclick = async () => {
    if (!confirm('أكيد بدك تحذف كل المنتجات؟ ما في رجعة.')) return;
    try { await api('/api/products?confirm=yes', { method: 'DELETE' }); toast('انحذفت كل المنتجات'); viewProducts(); } catch (e) { fail(e); }
  });
  $$('.product').forEach(b => b.onclick = () => productDialog(d.items.find(p => p.id == b.dataset.id)));
}

function dialog(title, body, foot) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div class="dh"><h2>${title}</h2><button class="btn ghost small" data-close aria-label="إغلاق">✕</button></div><div class="db">${body}</div>${foot ? `<div class="df">${foot}</div>` : ''}`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.showModal();
  return dlg;
}

function productDialog(p = {}) {
  const dlg = dialog(p.id ? 'تعديل منتج' : 'منتج جديد', `
    <form id="pf">
      <label class="field"><span>اسم المنتج</span><input type="text" name="name" value="${esc(p.name)}" required></label>
      <div class="form-grid">
        <label class="field"><span>السعر</span><input type="number" step="any" name="price" value="${p.price ?? ''}" dir="ltr"></label>
        <label class="field"><span>سعر بعد الخصم</span><input type="number" step="any" name="sale_price" value="${p.sale_price ?? ''}" dir="ltr"><small class="muted">اتركه فاضي إذا ما في خصم</small></label>
        <label class="field"><span>التصنيف</span><input type="text" name="category" value="${esc(p.category)}" placeholder="أحذية رياضية"></label>
        <label class="field"><span>الكمية بالمخزون</span><input type="number" name="stock" value="${p.stock ?? ''}" dir="ltr"><small class="muted">فاضي = ما بنتابع المخزون</small></label>
      </div>
      <label class="field"><span>المقاسات / الألوان / الخيارات</span><input type="text" name="options" value="${esc(p.options)}" placeholder="المقاسات 40-45، الألوان: أسود، أبيض"></label>
      <label class="field"><span>الوصف</span><textarea name="description" placeholder="المادة، الاستخدام، المميزات… الوكيل بيستخدمه ليقنع الزبون">${esc(p.description)}</textarea></label>
      <label class="field"><span>الصورة</span>
        <div class="row"><input class="grow" type="url" name="image_url" value="${esc(p.image_url)}" placeholder="رابط الصورة" dir="ltr"><label class="btn small">رفع<input type="file" accept="image/*" id="upl" hidden></label></div>
      </label>
      <div class="panel" id="aiImg" style="padding:12px;margin:-4px 0 14px;${p.image_url ? '' : 'display:none'}">
        <div class="row" style="gap:12px;align-items:flex-start;flex-wrap:wrap">
          <img id="aiPrev" src="${esc(p.image_url || '')}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:10px;background:#0001">
          <div class="grow" style="min-width:220px">
            <b>✨ عدّل الصورة بالذكاء</b>
            <div class="row" style="gap:6px;flex-wrap:wrap;margin:8px 0">
              ${['خلفية بيضا نضيفة', 'إضاءة أحلى وألوان أوضح', 'اعملها إعلان احترافي', 'حط المنتج على طاولة خشب'].map(t => `<button type="button" class="btn small" data-ai="${t}">${t}</button>`).join('')}
            </div>
            <div class="row" style="gap:6px"><input class="grow" type="text" id="aiReq" placeholder="أو اكتب شو بدك: غيّر اللون للأحمر، ضيف كتابة خصم 20%…"><button type="button" class="btn primary small" id="aiGo">عدّل</button></div>
            <div class="row" style="gap:6px;margin-top:6px"><small class="muted grow" id="aiNote">التعديل بيصير على الصورة الحالية، وفيك ترجع للأصلية.</small><button type="button" class="btn ghost small" id="aiUndo" hidden>↩ رجّع الأصلية</button></div>
          </div>
        </div>
      </div>
      <div class="form-grid">
        <label class="field"><span>رابط المنتج</span><input type="url" name="url" value="${esc(p.url)}" dir="ltr"></label>
        <label class="field"><span>الكود (SKU)</span><input type="text" name="sku" value="${esc(p.sku)}" dir="ltr"></label>
      </div>
      <label class="field"><span>كلمات بيستخدمها الزبائن</span><input type="text" name="tags" value="${esc(p.tags)}" placeholder="بوط، سبور، جري"><small class="muted">بتساعد الوكيل يلاقي المنتج لما الزبون يسميه بأسماء تانية</small></label>
      <label class="switch"><input type="checkbox" name="active" ${p.active === 0 ? '' : 'checked'}><span class="track"></span>ظاهر للوكيل</label>
    </form>`,
    `${p.id ? '<button class="btn danger" id="pdel">حذف</button>' : ''}<span class="spacer"></span><button class="btn" data-x>إلغاء</button><button class="btn primary" id="psave">حفظ</button>`);
  dlg.querySelector('[data-x]').onclick = () => dlg.close();
  dlg.querySelector('#upl').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = await compressImage(f);
      const r = await api('/api/upload', { method: 'POST', body: { data } });
      dlg.querySelector('[name=image_url]').value = r.url;
      toast('انرفعت الصورة');
      showAi(r.url);
    } catch (err) { fail(err); }
  };
  // تعديل الصورة بالذكاء
  const imgIn = dlg.querySelector('[name=image_url]');
  let aiOrig = null;
  const showAi = url => { dlg.querySelector('#aiImg').style.display = url ? '' : 'none'; dlg.querySelector('#aiPrev').src = url || ''; };
  imgIn.addEventListener('change', () => { aiOrig = null; dlg.querySelector('#aiUndo').hidden = true; showAi(imgIn.value.trim()); });
  const aiRun = async (btn, request) => {
    if (!imgIn.value.trim()) return toast('ارفع صورة أول');
    await busy(btn, async () => {
      dlg.querySelector('#aiNote').textContent = '🎨 عم عدّل… أول مرة ممكن تاخد دقيقة';
      try {
        const r = await api('/api/images/edit', { method: 'POST', body: { url: imgIn.value.trim(), request } });
        if (!aiOrig) aiOrig = imgIn.value.trim();
        imgIn.value = r.url; showAi(r.url);
        dlg.querySelector('#aiUndo').hidden = false;
        dlg.querySelector('#aiNote').textContent = `✓ عدّلها ${r.by}. فيك تكمّل تعديل عليها، أو تحفظ المنتج.`;
      } catch (err) { dlg.querySelector('#aiNote').textContent = '✗ ' + err.message; }
    });
  };
  dlg.querySelectorAll('[data-ai]').forEach(b => b.onclick = () => aiRun(b, b.dataset.ai));
  dlg.querySelector('#aiGo').onclick = e => { const t = dlg.querySelector('#aiReq').value.trim(); if (t) aiRun(e.target, t); };
  dlg.querySelector('#aiReq').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); dlg.querySelector('#aiGo').click(); } };
  dlg.querySelector('#aiUndo').onclick = () => { if (aiOrig) { imgIn.value = aiOrig; showAi(aiOrig); aiOrig = null; dlg.querySelector('#aiUndo').hidden = true; } };

  dlg.querySelector('#psave').onclick = e => busy(e.target, async () => {
    const form = dlg.querySelector('#pf');
    if (!form.reportValidity()) return;
    const body = formData(form);
    await api(p.id ? `/api/products/${p.id}` : '/api/products', { method: p.id ? 'PUT' : 'POST', body });
    dlg.close(); toast('انحفظ المنتج'); viewProducts();
  });
  dlg.querySelector('#pdel') && (dlg.querySelector('#pdel').onclick = e => busy(e.target, async () => {
    if (!confirm('حذف هالمنتج؟')) return;
    await api(`/api/products/${p.id}`, { method: 'DELETE' });
    dlg.close(); toast('انحذف المنتج'); viewProducts();
  }));
}

// تصغير الصورة قبل الرفع (أسرع وأخف)
function compressImage(file, max = 1200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.82));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('ما قدرنا نقرا الصورة'));
    img.src = URL.createObjectURL(file);
  });
}

function importDialog() {
  const dlg = dialog('استيراد المنتجات', `
    <div class="seg" id="it" style="margin-bottom:14px"><button class="on" data-t="file">ملف</button><button data-t="url">رابط</button><button data-t="paste">لصق</button></div>
    <div data-p="file"><label class="field"><span>ملف CSV أو JSON</span><input type="file" id="if" accept=".csv,.json,.txt,text/csv,application/json"><small class="muted">من Excel: احفظ الملف بصيغة CSV UTF-8. الأعمدة المفهومة: الاسم، السعر، التصنيف، الوصف، المقاسات، الصورة، الكمية، الكود (بالعربي أو الإنجليزي).</small></label></div>
    <div data-p="url" class="hidden"><label class="field"><span>رابط ملف المنتجات</span><input type="url" id="iu" dir="ltr" placeholder="https://your-store.com/products.json"><small class="muted">أي رابط بيرجّع JSON أو CSV فيه المنتجات (متل Shopify: /products.json).</small></label></div>
    <div data-p="paste" class="hidden"><label class="field"><span>الصق البيانات (CSV أو JSON)</span><textarea id="ip" rows="7" dir="ltr" placeholder="name,price,category&#10;حذاء رياضي,85,أحذية"></textarea></label></div>
    <label class="switch"><input type="checkbox" id="ir"><span class="track"></span>امسح المنتجات الحالية قبل الاستيراد</label>
    <p class="muted" style="margin-top:10px;font-size:13px">المنتجات يلي إلها نفس الكود (SKU) بتتحدّث بدل ما تتكرر.</p>`,
    `<span class="spacer"></span><button class="btn" data-x>إلغاء</button><button class="btn primary" id="go">استيراد</button>`);
  let tab = 'file';
  dlg.querySelector('[data-x]').onclick = () => dlg.close();
  dlg.querySelector('#it').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    tab = b.dataset.t;
    dlg.querySelectorAll('#it button').forEach(x => x.classList.toggle('on', x === b));
    dlg.querySelectorAll('[data-p]').forEach(x => x.classList.toggle('hidden', x.dataset.p !== tab));
  };
  dlg.querySelector('#go').onclick = e => busy(e.target, async () => {
    const body = { replace: dlg.querySelector('#ir').checked };
    if (tab === 'url') body.url = dlg.querySelector('#iu').value.trim();
    else {
      const text = tab === 'paste' ? dlg.querySelector('#ip').value : await dlg.querySelector('#if').files[0]?.text();
      if (!text) throw new Error('اختار ملف أو الصق بيانات');
      if (/^\s*[[{]/.test(text)) body.json = text; else body.csv = text;
    }
    const r = await api('/api/products/import', { method: 'POST', body });
    dlg.close();
    toast(`تم: ${r.added} جديد، ${r.updated} تحدّث${r.skipped ? `، ${r.skipped} ما انضاف (حد الخطة)` : ''}`);
    prodQ = ''; prodPage = 1; viewProducts();
  });
}

// ===== الوكيل: الشخصية والمعرفة =====
async function viewAgent() {
  await refreshMe();
  const s = ME.tenant.settings, k = ME.tenant.knowledge;
  const f = (name, label, val, opts = {}) => {
    const tag = opts.area ? `<textarea name="${name}" rows="${opts.rows || 3}" placeholder="${esc(opts.ph || '')}">${esc(val)}</textarea>`
      : `<input type="${opts.type || 'text'}" name="${name}" value="${esc(val)}" placeholder="${esc(opts.ph || '')}" ${opts.ltr ? 'dir="ltr"' : ''} ${opts.attrs || ''}>`;
    return `<label class="field"><span>${label}</span>${tag}${opts.hint ? `<small class="muted">${opts.hint}</small>` : ''}</label>`;
  };
  const sw = (name, label, val) => `<label class="switch" style="margin:4px 0 14px"><input type="checkbox" name="${name}" ${val ? 'checked' : ''}><span class="track"></span>${label}</label>`;
  shell('#/agent', `
    ${mobileTop()}
    <div class="page">
      <div class="page-head">
        <h1>شخصية الوكيل والمعرفة</h1>
        <div class="actions"><a class="btn" href="#/playground">جرّب</a><button class="btn primary" id="save1">حفظ</button></div>
        <p>هون بتعلّم الوكيل عن متجرك. كل شي بتكتبه هون، الوكيل بيستخدمه ليجاوب ويبيع. ولا شي من هون بيخترعه من عنده.</p>
      </div>
      <form id="af">
        <section class="panel">
          <h2>معلومات المتجر</h2>
          <p>أهم قسم. الوكيل ما بيعطي معلومة مو مكتوبة هون.</p>
          <div class="form-grid">
            ${f('k.business_name', 'اسم المتجر', k.business_name)}
            ${f('k.business_type', 'نوع النشاط', k.business_type, { ph: 'متجر ملابس رياضية' })}
            ${f('k.currency', 'العملة', k.currency, { ph: 'USD أو ل.س أو $' })}
            ${f('k.website', 'الموقع الإلكتروني', k.website, { ltr: true, type: 'url' })}
          </div>
          ${f('k.about', 'نبذة عن المتجر', k.about, { area: true, ph: 'شو بتبيعوا، شو بيميّزكن، الماركات، الجودة…' })}
          <div class="form-grid">
            ${f('k.delivery', 'التوصيل', k.delivery, { area: true, rows: 3, ph: 'المناطق، المدة، السعر. مثلاً: دمشق 24 ساعة بـ 2$، باقي المحافظات 2-3 أيام بـ 4$' })}
            ${f('k.payment', 'طرق الدفع', k.payment, { area: true, rows: 3, ph: 'كاش عند الاستلام، شام كاش، تحويل…' })}
            ${f('k.returns', 'الاسترجاع والتبديل', k.returns, { area: true, rows: 3, ph: 'تبديل المقاس خلال 3 أيام إذا المنتج بحالته' })}
            ${f('k.hours', 'أوقات العمل', k.hours, { area: true, rows: 3, ph: 'كل يوم من 10 الصبح لـ 10 المسا' })}
            ${f('k.location', 'العنوان / الفروع', k.location, { area: true, rows: 2 })}
            ${f('k.contact', 'طرق تواصل تانية', k.contact, { area: true, rows: 2, ph: 'إنستغرام، رقم أرضي…' })}
          </div>
          ${f('k.faq', 'أسئلة شائعة وأجوبتها', k.faq, { area: true, rows: 6, ph: 'س: المنتجات أصلية؟\nج: إي، كلها أصلية مع ضمان.\n\nس: في تقسيط؟\nج: لا حالياً.' })}
        </section>

        <section class="panel">
          <h2>شخصية الوكيل</h2>
          <p>كيف بيحكي مع زبائنك.</p>
          <div class="form-grid">
            ${f('s.agent_name', 'اسم الوكيل', s.agent_name, { hint: 'بيعرّف عن حاله بهالاسم' })}
            ${f('s.tone', 'الأسلوب', s.tone, { ph: 'ودود ومحترف، مرح، رسمي…' })}
            ${f('s.dialect', 'اللهجة', s.dialect, { ph: 'سورية، نفس لهجة العميل، فصحى…' })}
          </div>
          ${f('s.goal', 'شو هدفه بالمحادثة؟', s.goal, { area: true, rows: 2 })}
          ${f('s.extra_instructions', 'تعليمات خاصة', s.extra_instructions, { area: true, rows: 4, ph: 'مثلاً: إذا الزبون اشترى بأكتر من 100$ قله التوصيل مجاني. لا تحكي عن العروض القديمة.' })}
          ${sw('s.emoji', 'يستخدم إيموجي', s.emoji)}<br>
          ${sw('s.chatty', 'خفيف دم: بيفتح سيرة مع الزبون وبيقول قفشات خفيفة', s.chatty !== false)}
        </section>

        <section class="panel">
          <h2>طريقة الرد</h2>
          <p>إعدادات بتوفّر رسائل وبتخلّي التجربة طبيعية.</p>
          <div class="form-grid">
            ${f('s.reply_delay_sec', 'يستنى قبل ما يرد (ثواني)', s.reply_delay_sec, { type: 'number', ltr: true, attrs: 'min="0" max="30"', hint: 'إذا الزبون بعت كذا رسالة ورا بعض، الوكيل بيجمعهن وبيرد برسالة وحدة' })}
            ${f('s.human_takeover_minutes', 'لما ترد أنت، الوكيل بيسكت (دقائق)', s.human_takeover_minutes, { type: 'number', ltr: true, attrs: 'min="0"', hint: 'لما ترد من موبايلك أو من هون، الوكيل بيوقف مع هالزبون هالمدة' })}
            ${f('s.max_images', 'أقصى عدد صور بالرد', s.max_images, { type: 'number', ltr: true, attrs: 'min="0" max="5"' })}
          </div>
          ${sw('s.send_images', 'يبعت صور المنتجات', s.send_images)}
          ${sw('s.typing_indicator', 'يبيّن "عم يكتب…" قبل الرد', s.typing_indicator)}<br>
          ${sw('s.understand_media', '🎤📷 يسمع الرسائل الصوتية ويشوف الصور يلي بيبعتها الزبون (بيحتاج Cloudflare بإعدادات المنصة)', s.understand_media !== false)}
          ${f('s.handoff_keywords', 'كلمات بتحوّل الزبون لموظف فوراً', s.handoff_keywords, { hint: 'افصل بينهن بفاصلة' })}
        </section>

        <section class="panel" id="testSec">
          <h2>🧪 وضع الاختبار</h2>
          <p>شغّل الوكيل بس على رقم أو كم رقم لتجرّبه. باقي الزبائن ما بيرد عليهن، ورسائلهن بتوصلك عادي.</p>
          ${sw('s.test_mode', 'وضع الاختبار شغّال (الوكيل بيرد بس على الأرقام تحت)', s.test_mode)}
          ${f('s.test_numbers', 'أرقام التجربة', s.test_numbers, { area: true, rows: 2, ph: '963912345678', hint: 'الرقم مع رمز الدولة. إذا أكتر من رقم افصل بينهن بمسافة. أطفي الوضع لما تخلص التجربة ليرد على الكل.' })}
        </section>

        <section class="panel">
          <h2>أوقات الوكيل</h2>
          <p>إذا عندك موظفين بيردوا بالدوام، خلي الوكيل يشتغل برّا الدوام بس.</p>
          <label class="field"><span>متى يرد الوكيل؟</span>
            <select name="s.bot_schedule">
              <option value="always" ${s.bot_schedule === 'always' ? 'selected' : ''}>دائماً، 24 ساعة</option>
              <option value="off_hours" ${s.bot_schedule === 'off_hours' ? 'selected' : ''}>بس برّا أوقات الدوام</option>
              <option value="work_hours" ${s.bot_schedule === 'work_hours' ? 'selected' : ''}>بس بأوقات الدوام</option>
            </select></label>
          <div class="form-grid">
            ${f('s.work_from', 'الدوام من', s.work_from, { type: 'time', ltr: true })}
            ${f('s.work_to', 'لـ', s.work_to, { type: 'time', ltr: true })}
            ${f('s.timezone_offset', 'فرق التوقيت عن غرينتش', s.timezone_offset, { type: 'number', ltr: true, attrs: 'step="0.5"', hint: 'سوريا والأردن: 3' })}
          </div>
        </section>

        <section class="panel">
          <h2>الإشعارات والاستثناءات</h2>
          <p>وين يوصلك خبر الطلبات، ومين ما لازم الوكيل يرد عليه.</p>
          ${f('s.notify_number', 'رقمك الشخصي للإشعارات', s.notify_number, { type: 'tel', ltr: true, ph: '963912345678', hint: 'الوكيل بيبعتلك على هالرقم كل طلب جديد وكل عميل بحاجة موظف. لازم يكون غير رقم المتجر.' })}
          ${f('s.owner_numbers', 'أرقامك لتعديل الصور', s.owner_numbers, { ltr: true, ph: '963938986875', hint: 'ابعت صورة من هالرقم لرقم المتجر واكتب شو بدك (مثلاً: خلي الخلفية بيضا، اعملها إعلان بسعر 25$) وبيرجعلك ياها معدّلة. رقم الإشعارات فوق بينحسب كمان.' })}
          ${sw('s.notify_orders', 'ابعتلي إشعار بكل طلب جديد', s.notify_orders)}
          ${f('s.ignore_numbers', 'أرقام ما يرد عليها الوكيل', s.ignore_numbers, { area: true, rows: 2, ph: '963911111111 963922222222', hint: 'أهلك، موردين، موظفين… افصل بينهن بمسافة' })}
        </section>
        <div style="margin-top:14px"><button class="btn primary" type="submit">حفظ كل شي</button></div>
      </form>
    </div>`);
  const save = btn => busy(btn, async () => {
    const data = formData($('#af'));
    const body = { settings: {}, knowledge: {} };
    for (const [key, v] of Object.entries(data)) {
      const [g, n] = key.split('.');
      (g === 's' ? body.settings : body.knowledge)[n] = v;
    }
    await api('/api/settings', { method: 'PUT', body });
    toast('انحفظ. الوكيل صار يعرف المعلومات الجديدة');
  });
  $('#save1').onclick = e => save(e.target);
  $('#af').onsubmit = e => { e.preventDefault(); save(e.submitter); };
}

// ===== ساحة التجربة =====
let pgMsgs = [];
async function viewPlayground() {
  shell('#/playground', `
    ${mobileTop()}
    <div class="page" style="max-width:1200px">
      <div class="page-head">
        <h1>جرّب الوكيل</h1>
        <div class="actions">${ME.user.is_super ? '<button class="btn" id="stress">🔥 جرّب 10 زباين سوا</button>' : ''}<button class="btn" id="reset">محادثة جديدة</button></div>
        <p>احكي معه كأنك زبون. ما بينبعت شي على واتساب، بس الردود بتنحسب من حصتك اليومية.</p>
      </div>
      <div class="pg">
        <div class="chat">
          <div class="msgs" id="pm"></div>
          <form class="composer" id="pc">
            <textarea name="text" rows="1" placeholder="مثلاً: عندكن حذاء رياضي نمرة 43؟" required></textarea>
            <button class="btn primary" type="submit" aria-label="إرسال">${icon('send')}</button>
          </form>
        </div>
        <aside class="panel why" id="why">
          <h3>شو عم يصير ورا الكواليس</h3>
          <p class="muted">بعد كل رد، بتشوف هون المنتجات يلي الوكيل قراها، وإذا سجّل طلب أو حوّل لموظف.</p>
        </aside>
      </div>
    </div>`);
  const box = $('#pm');
  const draw = (typing = false) => {
    box.innerHTML = (pgMsgs.length ? pgMsgs.map(m => `<div class="bubble ${m.role === 'user' ? 'in' : 'out bot'}">${(m.images || []).map(i => `<img src="${esc(i.image_url)}" alt="${esc(i.name)}">`).join('')}${waFormat(m.content)}${m.role !== 'user' ? `<div class="by"><span class="s">ر</span> الوكيل${m.via ? ' · ' + esc(m.via) : ''}</div>` : ''}</div>`).join('')
      : '<div class="thread-empty"><div><h3>ابدأ المحادثة</h3><p>اكتب متل ما بيكتب زبونك، حتى بأخطاء إملائية.</p></div></div>')
      + (typing ? '<div class="typing"><i></i><i></i><i></i></div>' : '');
    box.scrollTop = box.scrollHeight;
  };
  draw();
  $('#stress') && ($('#stress').onclick = e => busy(e.target, async () => {
    $('#why').innerHTML = '<h3>🔥 10 زباين عم يبعتوا سوا…</h3><p class="muted">استنّى، وطالع الكمبيوتر شو عم يصير.</p>';
    const d = await api('/api/stress', { method: 'POST', body: { n: 10 } });
    const ok = d.runs.filter(x => x.ok).length;
    $('#why').innerHTML = `<h3>النتيجة: ${ok}/${d.n} ردّوا · الكل خلص بـ ${(d.total_ms / 1000).toFixed(1)} ثانية</h3>` + d.runs.map(x =>
      `<div style="border-top:1px solid #0001;padding:6px 0"><b>${esc(x.msg)}</b><br>${x.ok ? `<span class="muted">${(x.ms / 1000).toFixed(1)}ث · ${esc(x.via)}</span><br>${esc(x.reply)}` : `<span style="color:#c33">✗ ${esc(x.error)}</span>`}</div>`).join('');
  }));
  $('#reset').onclick = () => { pgMsgs = []; draw(); $('#why').innerHTML = '<h3>شو عم يصير ورا الكواليس</h3><p class="muted">محادثة جديدة.</p>'; };
  const ta = $('#pc textarea');
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 860) { e.preventDefault(); $('#pc').requestSubmit(); } };
  $('#pc').onsubmit = async e => {
    e.preventDefault();
    const text = ta.value.trim(); if (!text) return;
    ta.value = '';
    pgMsgs.push({ role: 'user', content: text });
    draw(true);
    const btn = e.submitter; btn.disabled = true;
    try {
      const r = await api('/api/playground', { method: 'POST', body: { messages: pgMsgs.map(m => ({ role: m.role, content: m.content })) } });
      pgMsgs.push({ role: 'assistant', content: r.reply, images: r.images, via: r.via });
      $('#why').innerHTML = `
        ${r.via ? `<p style="margin-bottom:10px">${r.route === 'smart' ? '🧠 سؤال معقد' : '⚡ سؤال بسيط'} — جاوب: <b>${esc(r.via)}</b></p>` : ''}
        <h3>المنتجات يلي قراها الوكيل</h3>
        ${r.used_products.length ? `<ul>${r.used_products.map(p => `<li>#${p.id} ${esc(p.name)}</li>`).join('')}</ul>` : '<p class="muted">ولا منتج. ضيف منتجات أو كلمات بحث للمنتج.</p>'}
        ${r.order ? `<div class="note ok" style="margin-bottom:10px"><b>🛒 كان رح يسجّل طلب:</b><br>${esc(r.order.items?.map(i => `${i.name} × ${i.qty || 1}`).join('، ') || '')}<br>${esc(r.order.customer_name || '')} — ${esc(r.order.address || '')}</div>` : ''}
        ${r.handoff ? '<div class="note warn" style="margin-bottom:10px">🙋 كان رح يحوّل لموظف</div>' : ''}
        ${r.customer_name ? `<p>👤 عرف اسم الزبون: ${esc(r.customer_name)}</p>` : ''}
        ${r.note ? `<p>📝 ملاحظة عن الزبون: ${esc(r.note)}</p>` : ''}
        <p class="muted" style="margin-top:10px">الرد مو عاجبك؟ عدّل <a href="#/agent">معلومات المتجر وشخصية الوكيل</a> وجرّب من جديد.</p>`;
    } catch (err) {
      pgMsgs.pop(); ta.value = text; fail(err);
    } finally { btn.disabled = false; draw(); ta.focus(); }
  };
}

// ===== ربط واتساب =====
let connectTab = null;
async function viewConnect() {
  await refreshMe();
  const t = ME.tenant;
  connectTab = connectTab || (t.wa_provider === 'cloud' ? 'cloud' : 'qr');
  const webhook = `${ME.public_url || location.origin}/webhook/wa/${t.id}`;
  shell('#/connect', `
    ${mobileTop()}
    <div class="page" style="max-width:820px">
      <div class="page-head"><h1>ربط واتساب</h1><p>اختار طريقة الربط. فيك تبدّل بينهن بأي وقت بدون ما تخسر المحادثات أو المنتجات.</p></div>
      <div class="seg" id="ct" style="margin-bottom:14px">
        <button data-t="qr" class="${connectTab === 'qr' ? 'on' : ''}">ربط سريع (مجاني)</button>
        <button data-t="cloud" class="${connectTab === 'cloud' ? 'on' : ''}">ربط رسمي من ميتا</button>
      </div>
      <div id="cb"></div>
    </div>`);
  $('#ct').onclick = e => { const b = e.target.closest('button'); if (b) { connectTab = b.dataset.t; viewConnect(); } };
  if (connectTab === 'qr') renderQR(); else renderCloud(webhook);
}

function renderQR() {
  const cb = $('#cb');
  const draw = st => {
    const usingCloud = ME.tenant.wa_provider === 'cloud';
    const s = st.status;
    let body = '';
    if (usingCloud) body = `<div class="note">حالياً شغّال على الربط الرسمي. إذا ربطت هون، بيصير الوكيل يستخدم الربط السريع بداله.</div>`;
    if (s === 'open') body += `
      <div class="note ok"><b>✓ متصل</b> بالرقم <span dir="ltr">+${esc(st.phone || '')}</span>. الوكيل عم يستقبل الرسائل ويرد.</div>
      <p class="muted" style="margin-top:12px">بيضل موبايلك شغّال عادي، وبتوصلك كل الرسائل. لما ترد بنفسك من الموبايل، الوكيل بيسكت مع هالزبون لفترة.</p>
      <button class="btn danger" id="lo" style="margin-top:14px">فصل الرقم</button>`;
    else if (s === 'qr' && st.qr) body += `
      <div class="grid two" style="align-items:center">
        <div class="qr-box" id="qrb"></div>
        <ol class="how">
          <li>افتح واتساب (أو واتساب أعمال) على موبايل المتجر</li>
          <li>اضغط ⋮ أو الإعدادات ← <b>الأجهزة المرتبطة</b></li>
          <li>اضغط <b>ربط جهاز</b> ووجّه الكاميرا على الكود</li>
        </ol>
      </div>
      <p class="muted" style="margin-top:12px">الكود بيتجدد كل شوي لحاله. إذا عم تفتح من نفس الموبايل، استخدم <b>كود الربط</b> بدال الـ QR.</p>`;
    else if (s === 'pairing' && st.code) body += `
      <div class="pair-code">${esc(st.code)}</div>
      <ol class="how">
        <li>افتح واتساب على موبايل المتجر ← <b>الأجهزة المرتبطة</b> ← <b>ربط جهاز</b></li>
        <li>اضغط <b>الربط برقم الهاتف بدلاً من ذلك</b></li>
        <li>اكتب الكود يلي فوق</li>
      </ol>`;
    else if (s === 'connecting') body += `<div class="loading">عم نتصل بواتساب…</div>`;
    else body += `
      ${st.error ? `<div class="note bad" style="margin-bottom:14px">${esc(st.error)}</div>` : ''}
      <div class="note warn" style="margin-bottom:16px">
        <b>اقرا قبل ما تربط:</b> هالطريقة مجانية وبلا حدود رسائل، بس مو رسمية من واتساب. في احتمال واتساب يحظر الرقم، خصوصاً إذا الرقم جديد أو انبعت منه رسائل لكتير ناس ما بيعرفوه.
        انصح تستخدم رقم مخصص للمتجر مو رقمك الشخصي. الوكيل بيرد بس على يلي بيراسلوك، وما بيبعت رسائل جماعية أبداً.
      </div>
      <label class="switch" style="margin-bottom:16px"><input type="checkbox" id="agree"><span class="track"></span>فهمت، وبدي كمّل</label>
      <div class="grid two">
        <div class="panel">
          <h3>مسح كود QR</h3>
          <p class="muted" style="margin-bottom:12px">إذا فاتح اللوحة من الكمبيوتر، ومعك موبايل المتجر.</p>
          <button class="btn primary" id="cq" disabled>اعرض الكود</button>
        </div>
        <div class="panel">
          <h3>كود ربط بالرقم</h3>
          <p class="muted" style="margin-bottom:12px">إذا فاتح اللوحة من نفس موبايل المتجر.</p>
          <div class="row"><input class="grow" type="tel" id="pp" dir="ltr" placeholder="963912345678"><button class="btn primary" id="cp" disabled>اطلب الكود</button></div>
          <small class="muted">الرقم مع رمز الدولة، بدون + أو 00</small>
        </div>
      </div>`;
    cb.innerHTML = `<div class="panel">${body}</div>`;
    if (s === 'qr' && st.qr) {
      if (window.qrcode) { const qr = window.qrcode(0, 'M'); qr.addData(st.qr); qr.make(); $('#qrb').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
      else $('#qrb').innerHTML = '<p class="muted">ما قدرنا نحمّل مولّد الكود. استخدم كود الربط بالرقم.</p>';
    }
    $('#agree') && ($('#agree').onchange = e => { $('#cq').disabled = $('#cp').disabled = !e.target.checked; });
    $('#cq') && ($('#cq').onclick = e => busy(e.target, async () => { draw(await api('/api/wa/connect', { method: 'POST', body: { mode: 'qr' } })); }));
    $('#cp') && ($('#cp').onclick = e => busy(e.target, async () => { draw(await api('/api/wa/connect', { method: 'POST', body: { mode: 'pair', phone: $('#pp').value } })); }));
    $('#lo') && ($('#lo').onclick = e => { if (confirm('فصل الرقم؟ الوكيل رح يوقف يرد.')) busy(e.target, async () => { await api('/api/wa/logout', { method: 'POST', body: {} }); toast('انفصل الرقم'); draw({ status: 'disconnected' }); }); });
  };
  draw(ME.tenant.wa_provider === 'cloud' ? { status: 'disconnected' } : ME.wa);
  live.onWA = st => { if (st.provider === 'qr') draw(st); if (st.status === 'open') toast('✓ اتصل واتساب'); };
}

function renderCloud(webhook) {
  const t = ME.tenant;
  const on = t.wa_provider === 'cloud' && t.cloud_phone_number_id;
  $('#cb').innerHTML = `
    <div class="panel">
      ${on ? `<div class="note ok" style="margin-bottom:14px"><b>✓ الربط الرسمي شغّال</b>${t.wa_phone ? ` على الرقم <span dir="ltr">+${esc(t.wa_phone)}</span>` : ''}.</div>` : ''}
      <h2>الربط الرسمي (WhatsApp Cloud API)</h2>
      <p>آمن ومستقر وما في خطر حظر. ميتا بتعطي أول 1000 رد خدمة بالشهر مجاناً لكل رقم، وبعدها بتدفع لميتا مباشرة حسب دولة الزبون. بيحتاج حساب Meta Business.</p>
      <ol class="how" style="margin-bottom:18px">
        <li>ادخل على <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com</a> واعمل تطبيق من نوع <b>Business</b>، وضيف منتج <b>WhatsApp</b>.</li>
        <li>من <b>WhatsApp ← API Setup</b> ضيف رقم المتجر وانسخ <b>Phone number ID</b>.</li>
        <li>اعمل <b>System User</b> بـ Business Settings وطلّعله توكن دائم بصلاحيات <span dir="ltr">whatsapp_business_messaging</span> و <span dir="ltr">whatsapp_business_management</span>.</li>
        <li>من <b>WhatsApp ← Configuration</b> حط رابط الـ Webhook وتوكن التحقق يلي تحت، واشترك بحقل <b>messages</b>.</li>
      </ol>
      <label class="field"><span>رابط الـ Webhook (Callback URL)</span><div class="copy-line"><code>${esc(webhook)}</code><button class="btn small" data-copy="${esc(webhook)}">نسخ</button></div>
        ${!ME.public_url && location.hostname === 'localhost' ? '<small class="muted">لازم تكون اللوحة على رابط عام (https) حتى ميتا توصله.</small>' : ''}</label>
      <label class="field"><span>توكن التحقق (Verify Token)</span><div class="copy-line"><code>${esc(t.settings.cloud_verify_token || '')}</code><button class="btn small" data-copy="${esc(t.settings.cloud_verify_token || '')}">نسخ</button></div></label>
      <form id="cf2">
        <label class="field"><span>Phone number ID</span><input type="text" name="phone_number_id" dir="ltr" value="${esc(t.cloud_phone_number_id || '')}" required inputmode="numeric"></label>
        <label class="field"><span>Access Token</span><input type="password" name="token" dir="ltr" placeholder="${t.cloud_token ? esc(t.cloud_token) + ' (اتركه فاضي إذا ما بدك تغيّره)' : 'EAAG…'}" autocomplete="off"></label>
        <label class="field"><span>App Secret (اختياري، للأمان)</span><input type="password" name="app_secret" dir="ltr" placeholder="${t.settings.cloud_app_secret ? '•••• محفوظ' : ''}" autocomplete="off"><small class="muted">من App Settings ← Basic. بيتأكد إنو الرسائل جاية فعلاً من ميتا.</small></label>
        <button class="btn primary" type="submit">تحقق وفعّل الربط الرسمي</button>
        ${on ? '<button class="btn" type="button" id="toQR" style="margin-inline-start:8px">رجوع للربط السريع</button>' : ''}
      </form>
    </div>`;
  $$('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('انتسخ'); });
  $('#cf2').onsubmit = e => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api('/api/wa/cloud', { method: 'PUT', body: formData(e.target) });
      toast(`✓ تفعّل الربط الرسمي: ${r.info.verified_name || ''} ${r.info.display_phone_number || ''}`);
      viewConnect();
    });
  };
  $('#toQR') && ($('#toQR').onclick = e => busy(e.target, async () => { await api('/api/wa/provider', { method: 'POST', body: { provider: 'qr' } }); connectTab = 'qr'; viewConnect(); }));
}

// ===== الذكاء الاصطناعي =====
async function viewAI() {
  await refreshMe();
  if (ME.user.is_super) return viewBrains();
  const presets = await api('/api/ai/presets');
  const t = ME.tenant;
  const own = t.ai_provider !== 'platform';
  shell('#/ai', `
    ${mobileTop()}
    <div class="page" style="max-width:820px">
      <div class="page-head"><h1>الذكاء الاصطناعي</h1><p>العقل يلي بيكتب الردود. فيك تستخدم يلي بتوفره المنصة، أو تحط مفتاحك الخاص وتصير الردود بلا حدود يومية.</p></div>
      <form id="aif" class="panel">
        <label class="field"><span>مين بيشغّل الوكيل؟</span>
          <select name="provider" id="prov">
            <option value="platform" ${!own ? 'selected' : ''}>المنصة (${ME.plan.ai_replies_per_day} رد باليوم بخطتك)</option>
            ${Object.entries(presets).map(([k, p]) => `<option value="${k}" ${t.ai_provider === k ? 'selected' : ''}>مفتاحي: ${esc(p.label)}</option>`).join('')}
          </select></label>
        <div id="ownBox" class="${own ? '' : 'hidden'}">
          <div class="note" id="keyHelp" style="margin-bottom:14px"></div>
          <label class="field"><span>مفتاح الـ API</span><input type="password" name="key" dir="ltr" autocomplete="off" placeholder="${t.ai_key ? esc(t.ai_key) + ' (اتركه فاضي إذا ما بدك تغيّره)' : ''}"></label>
          <label class="field"><span>الموديل</span>
            <div class="row"><input class="grow" type="text" name="model" id="model" dir="ltr" value="${esc(t.ai_model || '')}" list="mlist"><button class="btn" type="button" id="lm">جيب الموديلات</button></div>
            <datalist id="mlist"></datalist><small class="muted">اتركه فاضي للموديل الافتراضي. الموديلات الكبيرة (70B وفوق) أذكى بالبيع وبالعربي.</small></label>
          <label class="field" id="baseBox"><span>رابط المزوّد (Base URL)</span><input type="url" name="base_url" dir="ltr" value="${esc(t.ai_base_url || '')}"></label>
        </div>
        <div class="row">
          <button class="btn primary" type="submit">حفظ</button>
          <button class="btn" type="button" id="test">اختبار الاتصال</button>
        </div>
      </form>
      <div class="panel">
        <h2>أي واحد أختار؟</h2>
        <p>كلها فيها خيار مجاني، بس الحدود بتتغيّر كل فترة.</p>
        <ul style="padding-inline-start:18px;margin:0;font-size:14px;display:grid;gap:6px">
          <li><b>Groq:</b> سريع جداً ومجاني بحدود يومية منيحة. بداية ممتازة.</li>
          <li><b>Gemini:</b> ممتاز بالعربي. الحصة المجانية صغيرة، وجوجل بتستخدم بيانات الحصة المجانية لتحسين خدماتها.</li>
          <li><b>OpenRouter:</b> مفتاح واحد لعشرات الموديلات، منها مجانية.</li>
          <li><b>DeepSeek:</b> مدفوع بس رخيص كتير، وذكي.</li>
        </ul>
      </div>
    </div>`);
  const prov = $('#prov');
  const sync = () => {
    const p = presets[prov.value];
    $('#ownBox').classList.toggle('hidden', prov.value === 'platform');
    if (!p) return;
    $('#keyHelp').innerHTML = p.keyUrl ? `طلّع مفتاح من <a href="${p.keyUrl}" target="_blank" rel="noopener">${esc(new URL(p.keyUrl).hostname)}</a> وانسخه هون. المفتاح بينحفظ مشفّر.` : 'حط رابط المزوّد والمفتاح والموديل.';
    $('#model').placeholder = p.model || 'اسم الموديل';
    $('#baseBox').classList.toggle('hidden', !['custom', 'cloudflare'].includes(prov.value) && prov.value !== t.ai_provider);
    $('[name=base_url]').placeholder = p.base_url;
  };
  prov.onchange = sync; sync();
  $('#lm').onclick = e => busy(e.target, async () => {
    const key = $('[name=key]').value;
    const r = await api('/api/ai/models', { method: 'POST', body: { provider: prov.value, base_url: $('[name=base_url]').value, key, use_saved: !key && prov.value === t.ai_provider } });
    $('#mlist').innerHTML = r.models.map(m => `<option value="${esc(m)}">`).join('');
    toast(`لقينا ${r.models.length} موديل. اكبس على خانة الموديل لتختار`);
    $('#model').focus();
  });
  $('#aif').onsubmit = e => {
    e.preventDefault();
    busy(e.submitter, async () => { await api('/api/ai', { method: 'PUT', body: formData(e.target) }); toast('انحفظ'); viewAI(); });
  };
  $('#test').onclick = e => busy(e.target, async () => {
    const r = await api('/api/ai/test', { method: 'POST', body: {} });
    toast(`✓ شغّال (${(r.ms / 1000).toFixed(1)} ثانية): ${r.reply}`);
  });
}

// كل العقول بصفحة وحدة: الترتيب = الأولوية، وكل عقل إما 🧠 ذكي أو ⚡ سريع
async function viewBrains() {
  const [d, presets] = await Promise.all([api('/api/ai/brains'), api('/api/ai/presets')]);
  let list = d.brains;
  const card = (b, i) => `
    <div class="panel brain" data-i="${i}" style="margin-bottom:12px;${b.enabled ? '' : 'opacity:.55'}">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <b style="font-size:17px">${i + 1}. ${b.level === 'fast' ? '⚡' : '🧠'} ${esc(b.name || presets[b.provider]?.label || '')}</b>
        <div class="row" style="gap:6px;align-items:center">
          <label class="switch" title="شغّل / طفّي هالعقل" style="margin:0"><input type="checkbox" data-f="enabled" data-quick="1" ${b.enabled ? 'checked' : ''}><span class="track"></span><b style="min-width:52px;color:${b.enabled ? '#16a34a' : '#dc2626'}">${b.enabled ? 'شغّال' : 'مطفي'}</b></label>
          <button class="btn sm" data-a="up" ${i ? '' : 'disabled'}>▲</button>
          <button class="btn sm" data-a="down" ${i < list.length - 1 ? '' : 'disabled'}>▼</button>
          <button class="btn sm" data-a="test" ${b.id ? '' : 'disabled'}>اختبار</button>
          <button class="btn sm" data-a="del">حذف</button>
        </div>
      </div>
      <div class="form-grid" style="margin-top:10px">
        <label class="field"><span>الاسم (بيبين جنب كل رد)</span><input data-f="name" value="${esc(b.name || '')}"></label>
        <label class="field"><span>المزوّد</span><select data-f="provider">${Object.entries(presets).map(([k, p]) => `<option value="${k}" ${b.provider === k ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
        <label class="field"><span>النوع</span><select data-f="level"><option value="smart" ${b.level !== 'fast' ? 'selected' : ''}>🧠 ذكي (للأسئلة الصعبة)</option><option value="fast" ${b.level === 'fast' ? 'selected' : ''}>⚡ سريع (للأسئلة البسيطة)</option></select></label>
        <label class="field"><span>المفتاح ${presets[b.provider]?.keyUrl ? `· <a href="${presets[b.provider].keyUrl}" target="_blank" rel="noopener">جيب مفتاح</a>` : ''}</span><input type="text" data-f="key" dir="ltr" autocomplete="off" spellcheck="false" value="${esc(b.key || '')}" placeholder="الصق المفتاح"></label>
        <label class="field"><span>الموديل</span><input data-f="model" dir="ltr" value="${esc(b.model)}" placeholder="${esc(presets[b.provider]?.model || '')}"></label>
        <label class="field"><span>Base URL (بس للمحلي و Cloudflare)</span><input data-f="base_url" dir="ltr" value="${esc(b.base_url)}" placeholder="${esc(presets[b.provider]?.base_url || '')}"></label>
      </div>
    </div>`;
  const read = () => { $$('.brain').forEach(el => { const b = list[+el.dataset.i]; el.querySelectorAll('[data-f]').forEach(x => { b[x.dataset.f] = x.type === 'checkbox' ? x.checked : x.value; }); }); };
  const draw = () => {
    shell('#/ai', `
      ${mobileTop()}
      <div class="page" style="max-width:860px">
        <div class="page-head"><h1>الذكاء الاصطناعي</h1><p>كل العقول هون. لما يجي سؤال، الوكيل بيجرّب العقول بالترتيب: إذا واحد فشل أو خلصت حصته بينتقل للي بعده. وكل رد بصندوق الرسائل مكتوب جنبه مين كتبه.</p></div>
        <div class="panel" style="margin-bottom:14px">
          <label class="switch"><input type="checkbox" id="route" ${d.routing !== false ? 'checked' : ''}><span class="track"></span><b>توجيه ذكي</b></label>
          <p class="muted" style="margin-top:6px;font-size:14px">شغّال: السؤال البسيط (سعر، مقاس، تحية) بيروح أول لعقل ⚡ سريع، والصعب (اعتراض، شكوى، نصيحة) لعقل 🧠 ذكي. مطفي: دايماً بالترتيب يلي انت حاطو من فوق لتحت بالضبط (بلا ما يقدّم Gemini).</p>
        </div>
        <div class="panel" style="margin-bottom:14px">
          <b style="font-size:17px">🎤 صوت البوت (Fish Audio)</b>
          <p class="muted" style="margin:6px 0 10px;font-size:14px">لما الزبون يبعت تسجيل صوتي، البوت بيرد بتسجيل بالصوت يلي بتختارو. حط حتى 4 مفاتيح من <a href="https://fish.audio/app/api-keys" target="_blank" rel="noopener">fish.audio/app/api-keys</a>: إذا واحد خلص أو وقف، البوت بيكمّل بيلي بعدو لحالو.</p>
          <div class="form-grid">
            ${[0, 1, 2, 3].map(i => `<label class="field"><span>مفتاح ${i + 1}</span><input class="fishKey" data-k="${i}" dir="ltr" autocomplete="off" spellcheck="false" placeholder="sk-fish-…"></label>`).join('')}
          </div>
          <div id="fishStat" class="panel" style="margin-top:10px;padding:10px;font-size:14px"><span class="muted">عم شوف الاستهلاك…</span></div>
          <label class="switch" style="margin-top:10px"><input type="checkbox" id="fishAlways"><span class="track"></span><b>ابعت تسجيل صوت مع كل رد</b> <span class="muted" style="font-size:13px">(مطفي = بس لما الزبون يبعت صوت)</span></label>
          <div style="margin-top:10px"><b>الصوت المختار:</b> <span id="fishCur" class="muted">الافتراضي</span></div>
          <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">
            <input id="fishQ" placeholder="دوّر على صوت (مثلاً: سوري، رجل، narrator)" style="flex:1;min-width:200px">
            <button class="btn sm" id="fishFind">🔍 دوّر</button>
            <button class="btn sm" id="fishAr">🇸🇾 أصوات عربية</button>
          </div>
          <div id="fishList" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin-top:10px"></div>
          <button class="btn sm" id="fishMore" style="display:none;margin-top:8px">⬇️ أصوات كمان</button>
          <div class="panel" style="margin-top:12px;padding:10px">
            <b>✍️ اكتب وابعت تسجيل صوت</b>
            <textarea id="vText" rows="3" placeholder="اكتب الكلام يلي بدك ياه ينقال بالصوت…" style="width:100%;margin-top:6px"></textarea>
            <div class="row" style="gap:8px;margin-top:6px;flex-wrap:wrap;align-items:center">
              <input id="vPhone" dir="ltr" placeholder="الرقم: 09xxxxxxxx" style="flex:1;min-width:160px">
              <button class="btn sm" id="vPrev">▶️ اسمع قبل</button>
              <button class="btn primary sm" id="vSend">📤 ابعت عالواتس</button>
            </div>
            <audio id="vAudio" controls style="display:none;height:36px;margin-top:6px;width:100%"></audio>
          </div>
          <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
            <button class="btn primary sm" id="fishSave">حفظ الصوت</button>
            <button class="btn sm" id="fishTest">▶️ جرّب صوت البوت</button>
            <audio id="fishAudio" controls style="display:none;height:36px"></audio>
          </div>
        </div>
        <div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <button class="btn sm" id="allOn">✅ شغّل الكل</button>
          <button class="btn sm" id="allOff">⛔ طفّي الكل</button>
          <button class="btn sm" id="addFree">🎁 ضيف كل العقول المجانية</button>
          <span class="muted" style="font-size:14px">للتجربة: طفّي الكل وشغّل عقل واحد بس، وابعت رسالة للبوت. كل زر بينحفظ لحالو فوراً.</span>
        </div>
        <div id="blist">${list.map(card).join('') || '<div class="panel muted">ما في عقول. ضيف واحد.</div>'}</div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn" id="add">+ ضيف عقل</button>
          <button class="btn primary" id="save">حفظ</button>
        </div>
      </div>`);
    $('#add').onclick = () => { read(); list.push({ provider: 'groq', name: '', level: 'smart', enabled: true, model: '', base_url: '' }); draw(); };
    $$('.brain [data-f=provider]').forEach(x => x.onchange = () => { read(); const b = list[+x.closest('.brain').dataset.i]; b.model = ''; b.base_url = ''; if (!b.name) b.name = presets[b.provider]?.label || ''; draw(); });
    $$('.brain [data-a]').forEach(btn => btn.onclick = e => {
      read(); const i = +btn.closest('.brain').dataset.i, a = btn.dataset.a;
      if (a === 'up') [list[i - 1], list[i]] = [list[i], list[i - 1]];
      if (a === 'down') [list[i + 1], list[i]] = [list[i], list[i + 1]];
      if (a === 'del') list.splice(i, 1);
      if (a === 'test') return busy(e.target, async () => { const r = await api('/api/ai/brains/test', { method: 'POST', body: { id: list[i].id } }); toast(`✓ ${list[i].name} شغّال (${(r.ms / 1000).toFixed(1)} ث): ${r.reply}`); });
      draw();
    });
    const quickSave = async (msg) => { await api('/api/ai/brains', { method: 'PUT', body: { routing: $('#route').checked, brains: list } }); toast(msg); viewBrains(); };
    $$('.brain [data-quick]').forEach(x => x.onchange = () => { read(); const b = list[+x.closest('.brain').dataset.i]; quickSave(`${b.name || 'العقل'}: ${b.enabled ? 'شغّال ✅' : 'مطفي ⛔'}`).catch(err => toast(err.message || 'ما انحفظ')); });
    $('#addFree').onclick = () => {
      read();
      const want = ['groq', 'cerebras', 'mistral', 'zai', 'siliconflow', 'cohere'].filter(k => presets[k] && !list.some(b => b.provider === k));
      if (!want.length) return toast('كل العقول المجانية موجودة عندك');
      want.forEach(k => list.push({ provider: k, name: presets[k].label.split(' (')[0], level: 'smart', enabled: false, model: '', base_url: '', key: '' }));
      draw(); toast(`انضافو ${want.length} عقول (مطفيين). حط مفتاح كل واحد، شغّلو، وكبوس حفظ`);
    };
    let fish = { keys: ['', '', '', ''], voice: '', voiceName: '' };
    const fishBody = () => ({ keys: $$('.fishKey').map(x => x.value.trim()), voice: fish.voice, voiceName: fish.voiceName, always: !!$('#fishAlways')?.checked });
    const fishCur = () => { $('#fishCur').textContent = fish.voice ? (fish.voiceName || fish.voice) : 'الافتراضي'; };
    api('/api/voice/fish').then(f => { fish = f; $$('.fishKey').forEach(x => x.value = f.keys?.[+x.dataset.k] || ''); $('#fishAlways') && ($('#fishAlways').checked = !!f.always); fishCur(); }).catch(() => {});
    $('#fishAlways').onchange = async e => { await api('/api/voice/fish', { method: 'PUT', body: fishBody() }); toast(e.target.checked ? 'صار البوت يبعت صوت مع كل رد 🎤' : 'البوت بيبعت صوت بس لما الزبون يبعت صوت'); };
    let fishQ = '', fishPage = 1, fishAll = [];
    const fishCard = (v, i) => `
          <div class="panel" style="padding:10px;${v.id === fish.voice ? 'outline:2px solid #16a34a' : ''}">
            <div class="row" style="gap:8px;align-items:center">${v.cover ? `<img src="${esc(v.cover)}" alt="" loading="lazy" style="width:40px;height:40px;border-radius:50%;object-fit:cover">` : '🎙️'}<b style="font-size:14px">${esc(v.title)}</b></div>
            <div class="muted" style="font-size:12px;margin-top:2px">${esc((v.langs || []).join(', '))}${v.likes ? ' · ❤️ ' + v.likes : ''}</div>
            ${v.sample ? `<audio src="${esc(v.sample)}" controls preload="none" style="width:100%;height:32px;margin-top:6px"></audio>` : '<div class="muted" style="font-size:13px">ما في عينة</div>'}
            <button class="btn sm ${v.id === fish.voice ? 'primary' : ''}" data-pick="${i}" style="margin-top:6px;width:100%">${v.id === fish.voice ? '✅ مختار' : 'اختار هالصوت'}</button>
          </div>`;
    const fishDraw = () => {
      const box = $('#fishList');
      box.innerHTML = fishAll.length ? fishAll.map(fishCard).join('') : '<div class="muted">ما لقيت أصوات. جرّب كلمة تانية.</div>';
      box.querySelectorAll('[data-pick]').forEach(b => b.onclick = async () => {
        const v = fishAll[+b.dataset.pick]; fish.voice = v.id; fish.voiceName = v.title; fishCur();
        await api('/api/voice/fish', { method: 'PUT', body: fishBody() }); toast(`صار صوت البوت: ${v.title} ✅`); fishDraw();
      });
    };
    const fishShow = async (q, more = false) => {
      if (!more) { fishQ = q; fishPage = 1; fishAll = []; $('#fishList').innerHTML = '<div class="muted">عم جيب الأصوات…</div>'; } else fishPage++;
      try {
        if (!more) await api('/api/voice/fish', { method: 'PUT', body: fishBody() });
        const { voices } = await api('/api/voice/fish/voices?page=' + fishPage + (fishQ ? '&q=' + encodeURIComponent(fishQ) : ''));
        const seen = new Set(fishAll.map(v => v.id)); fishAll = fishAll.concat(voices.filter(v => !seen.has(v.id)));
        $('#fishMore').style.display = voices.length >= 20 ? '' : 'none';
        fishDraw();
      } catch (err) { if (!more) $('#fishList').innerHTML = `<div class="muted">${esc(err.message || 'ما زبط')}</div>`; else toast(err.message || 'ما زبط'); }
    };
    const fmtMin = s => s < 60 ? `${Math.round(s)} ثانية` : `${(s / 60).toFixed(1)} دقيقة`;
    const fishStat = async () => {
      const el = $('#fishStat'); if (!el) return;
      try {
        const st = await api('/api/voice/fish/status');
        const free = /free/.test(st.model);
        el.innerHTML = `<b>📊 الاستهلاك</b><br>اليوم: <b>${st.today.n}</b> رسالة صوتية (${fmtMin(st.today.sec)}) · هالشهر: <b>${st.month.n}</b> رسالة (${fmtMin(st.month.sec)})<br>`
          + (free ? '<span style="color:#16a34a">الموديل المجاني (s2.1-pro-free): ما إلو حد دقايق، بس Fish ممكن تبطّئو إذا الاستعمال كتير كتير.</span><br>' : '')
          + (st.keys.length ? st.keys.map(k => `مفتاح ${k.n} (…${esc(k.tail)}): ${k.error ? `<span style="color:#dc2626">${esc(k.error)}</span>` : `رصيد ${k.credit != null ? '$' + esc(String(k.credit)) : '—'}`} · استعمل ${k.used.n} رسالة (${fmtMin(k.used.sec)})${k.resting ? ' · <span style="color:#d97706">مرتاح هلق</span>' : ''}`).join('<br>') : '<span class="muted">ما في مفاتيح لهلق.</span>');
      } catch (err) { el.innerHTML = `<span class="muted">ما قدرت شوف الاستهلاك: ${esc(err.message || '')}</span>`; }
    };
    fishStat();
    // صوت واحد بس يشتغل بنفس الوقت: لما يبلش واحد، الباقي بيوقفو
    document.addEventListener('play', ev => { if (ev.target.tagName === 'AUDIO') $$('audio').forEach(a => { if (a !== ev.target && !a.paused) a.pause(); }); }, true);
    $('#vPrev').onclick = e => busy(e.target, async () => { const r = await api('/api/voice/preview', { method: 'POST', body: { text: $('#vText').value } }); const au = $('#vAudio'); au.src = r.url + '?t=' + Date.now(); au.style.display = ''; au.play().catch(() => {}); });
    $('#vSend').onclick = e => busy(e.target, async () => { const r = await api('/api/voice/send', { method: 'POST', body: { text: $('#vText').value, phone: $('#vPhone').value } }); toast(`انبعت التسجيل لـ +${r.phone} ✅`); });
    $('#fishMore').onclick = e => busy(e.target, () => fishShow(fishQ, true));
    $('#fishFind').onclick = () => fishShow($('#fishQ').value.trim());
    $('#fishQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); fishShow($('#fishQ').value.trim()); } };
    $('#fishAr').onclick = () => fishShow('');
    $('#fishSave').onclick = e => busy(e.target, async () => { await api('/api/voice/fish', { method: 'PUT', body: fishBody() }); toast('انحفظ الصوت ✅ — صار شغّال فوراً'); fishStat(); });
    $('#fishTest').onclick = e => busy(e.target, async () => {
      await api('/api/voice/fish', { method: 'PUT', body: fishBody() });
      const r = await api('/api/voice/fish/test', { method: 'POST', body: {} });
      const au = $('#fishAudio'); au.src = r.url + '?t=' + Date.now(); au.style.display = ''; au.play().catch(() => {});
      toast(`✓ طلع الصوت (${(r.ms / 1000).toFixed(1)} ث)`); fishStat();
    });
    $('#allOn').onclick = () => { read(); list.forEach(b => b.enabled = true); quickSave('كل العقول شغّالة ✅').catch(err => toast(err.message || 'ما انحفظ')); };
    $('#allOff').onclick = () => { read(); list.forEach(b => b.enabled = false); quickSave('كل العقول مطفية ⛔').catch(err => toast(err.message || 'ما انحفظ')); };
    $('#save').onclick = e => busy(e.target, async () => {
      read();
      await api('/api/ai/brains', { method: 'PUT', body: { routing: $('#route').checked, brains: list } });
      toast('انحفظ'); viewBrains();
    });
  };
  draw();
}

// ===== تعديل صور جماعي: بترفع عشرات الصور وبتنام =====
async function viewBatch() {
  let pending = [], bLogo = null, gProducts = [{ name: '', urls: [] }];
  await refreshMe(); let gPrompts = [...(ME.tenant.settings.gemini_prompts || ['', '', ''])];
  const draw = async () => {
    const d = await api('/api/batch');
    const c = s => d.jobs.filter(j => j.status === s).length;
    const st = { queued: '⏳ بالدور', working: '🎨 عم يتعدّل', done: '✅ خلص', error: '✗ ما زبط' };
    const old = $('#bReq')?.value ?? '';
    shell('#/batch', `
      ${mobileTop()}
      <div class="page" style="max-width:980px">
        <div class="page-head"><h1>تعديل صور جماعي</h1><p>ارفع عشرات الصور واكتب شو بدك يعدّل فيهن، وخلّي الكمبيوتر شغّال. بيخلّصهن وحدة وحدة لحاله، حتى وانت نايم.</p></div>
        ${d.hq ? '<div class="note" style="margin-bottom:14px">🧠 موديل الجودة العالية (Qwen) جاهز على الكمبيوتر.</div>' : '<div class="note warn" style="margin-bottom:14px">موديل الجودة العالية (Qwen) لسا مو منزّل، فالتعديل رح يصير بالموديل السريع أو Cloudflare. لتنزيله شغّل <b dir="ltr">C:\\raddad\\deploy\\image-ai-hq-setup.bat</b></div>'}
        <div class="panel" id="gem" style="margin-bottom:14px;border:2px solid #f5c84a">
          <h2 style="margin-top:0">🍌 منتجات Gemini — كذا صورة للمنتج × 3 برومبتات</h2>
          <p class="muted" style="margin-top:0">ارفع 3 أو 4 صور لكل منتج من زوايا مختلفة. Gemini بياخد صور المنتج + لوغو متجرك + الدراغون (محفوظين دايماً)، وبيطلّع صورة لكل برومبت. النتايج بتنحفظ بمجلد لكل منتج: <b dir="ltr">C:\\raddad\\data\\exports</b></p>
          ${[0, 1, 2].map(i => `<label class="field"><span>البرومبت ${i + 1}${i ? ' (اختياري)' : ''}</span><textarea data-gp="${i}" rows="3" placeholder="اكتب البرومبت هون — بينحفظ لحاله">${esc(gPrompts[i] || '')}</textarea></label>`).join('')}
          <div id="gList">${gProducts.map((p, i) => `<div class="panel" style="padding:10px;margin-bottom:8px">
            <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
              <input data-gn="${i}" value="${esc(p.name)}" placeholder="اسم المنتج (مثلاً: خوذة وردية)" style="flex:1;min-width:180px">
              <label class="btn small">📷 صور المنتج<input type="file" accept="image/*" multiple data-gf="${i}" hidden></label>
              ${gProducts.length > 1 ? `<button type="button" class="btn ghost small" data-gx="${i}">حذف</button>` : ''}
            </div>
            <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">${p.urls.map(u => `<img src="${esc(u)}" style="width:64px;height:64px;object-fit:cover;border-radius:8px">`).join('') || '<span class="muted">ما في صور بعد</span>'}</div>
          </div>`).join('')}</div>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <button type="button" class="btn" id="gAdd">+ منتج جديد</button>
            <button type="button" class="btn primary" id="gGo">🍌 ابعت لـ Gemini</button>
          </div>
        </div>
        <div class="panel">
          <label class="btn primary">📷 اختار صور (فيك تختار كتير سوا)<input type="file" accept="image/*" multiple id="bFiles" hidden></label>
          <span class="muted" id="bPicked" style="margin-inline-start:8px">${pending.length ? `جاهز ${pending.length} صورة` : ''}</span>
          <div class="row" style="gap:6px;flex-wrap:wrap;margin:12px 0 8px">
            <button type="button" class="btn small" data-t="صورة منتج احترافية بستوديو: خلفية بيضا نقية ناعمة، إضاءة استوديو فخمة ناعمة مع ظل خفيف تحت المنتج، ألوان غنية وواضحة، حدة عالية للتفاصيل والرسمات والشعار، بدون أي تغيير على شكل المنتج أو ألوانه أو رسماته">📸 تصوير استوديو فخم</button>
            ${['خلفية بيضا نضيفة مع ظل خفيف', 'إضاءة استوديو احترافية وألوان أوضح', 'حط المنتج على أرض ملعب'].map(t => `<button type="button" class="btn small" data-t="${t}">${t}</button>`).join('')}
          </div>
          <textarea id="bReq" rows="2" placeholder="شو بدك يعدّل بكل الصور؟">${esc(old)}</textarea>
          <div class="panel" style="padding:10px;margin-top:10px">
            <label class="switch"><input type="checkbox" id="bBrand" ${d.brand.logo || d.brand.mark ? 'checked' : ''}><span class="track"></span><b>🏷️ قالب انستا 4:5</b> — شعارك تحت عاليسار، والدراغون خلف المنتج</label>
            <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">
              <label class="btn small">شعار المنتج (اختياري)<input type="file" accept="image/*" id="bPLogo" hidden></label>
              <span class="muted" id="bPLogoNote">${bLogo ? '✓ شعار المنتج جاهز' : 'بيطلع بعد الخط جنب شعارك'}</span>
              <span class="spacer"></span>
              <label class="btn ghost small">${d.brand.logo ? '✓' : '+'} شعار متجري<input type="file" accept="image/*" data-brand="logo" hidden></label>
              <label class="btn ghost small">${d.brand.mark ? '✓' : '+'} العلامة المائية<input type="file" accept="image/*" data-brand="mark" hidden></label>
            </div>
          </div>
          <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
            <select id="bQ"><option value="fast">⚡ سريع (FLUX — آمن على الجهاز)</option><option value="high">🧠 جودة عالية Qwen (تقيل، ممكن يعلّق الجهاز)</option><option value="gemini">🍌 Gemini المدفوع (أحسن جودة، ~4 سنت للصورة)</option></select>
            <button class="btn primary" id="bGo">ضيفهن للطابور</button>
          </div>
        </div>
        <div class="panel" style="margin-top:14px">
          <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
            <h2 style="margin:0">الطابور: ${c('done')} خلص · ${c('working') + c('queued')} باقي${c('error') ? ` · ${c('error')} ما زبط` : ''}</h2>
            <div class="row" style="gap:6px">${c('error') ? '<button class="btn small" id="bRetry">أعد يلي ما زبطوا</button>' : ''}${c('done') + c('error') ? '<button class="btn small" id="bClear">امسح الخالصين</button>' : ''}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-top:12px">
            ${d.jobs.map(j => `<div class="panel" style="padding:8px">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
                <img src="${esc(j.src_url)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px">
                ${j.result_url ? `<a href="${esc(j.result_url)}" target="_blank"><img src="${esc(j.result_url)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px"></a>` : '<div style="aspect-ratio:1;border-radius:8px;background:#0001;display:grid;place-items:center">…</div>'}
              </div>
              <div style="font-size:13px;margin-top:6px"><b>${st[j.status]}</b>${j.engine ? ` · ${esc(j.engine)}` : ''}</div>
              <div class="muted" style="font-size:12px">${j.product_name ? `<b>${esc(j.product_name)}</b> · برومبت ${j.prompt_no}` : esc(j.request)}</div>
              ${j.export_path ? `<div class="muted" style="font-size:11px" dir="ltr">${esc(j.export_path)}</div>` : ''}
              ${j.error ? `<div style="font-size:12px;color:#c33">${esc(j.error)}</div>` : ''}
              <div class="row" style="gap:6px;margin-top:6px">${j.result_url ? `<a class="btn small" href="${esc(j.result_url)}" download>تنزيل</a>` : ''}${j.status !== 'working' ? `<button class="btn ghost small" data-del="${j.id}">حذف</button>` : ''}</div>
            </div>`).join('') || '<p class="muted">ما في شي بالطابور.</p>'}
          </div>
        </div>
      </div>`);
    $('#bFiles').onchange = async e => {
      const files = [...e.target.files]; if (!files.length) return;
      $('#bPicked').textContent = `عم ارفع ${files.length} صورة…`;
      for (const f of files) { try { const data = await compressImage(f, 1600); pending.push((await api('/api/upload', { method: 'POST', body: { data } })).url); } catch (err) { fail(err); } $('#bPicked').textContent = `انرفع ${pending.length} من ${files.length}`; }
      $('#bPicked').textContent = `جاهز ${pending.length} صورة — اكتب الطلب واكبس "ضيفهن للطابور"`;
    };
    document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { $('#bReq').value = b.dataset.t; });
    document.querySelectorAll('[data-gp]').forEach(t => { t.oninput = () => { gPrompts[+t.dataset.gp] = t.value; }; t.onchange = () => api('/api/batch/prompts', { method: 'POST', body: { prompts: gPrompts } }).catch(() => {}); });
    document.querySelectorAll('[data-gn]').forEach(t => t.oninput = () => { gProducts[+t.dataset.gn].name = t.value; });
    document.querySelectorAll('[data-gx]').forEach(b => b.onclick = () => { gProducts.splice(+b.dataset.gx, 1); draw(); });
    $('#gAdd').onclick = () => { gProducts.push({ name: '', urls: [] }); draw(); };
    document.querySelectorAll('[data-gf]').forEach(inp => inp.onchange = async e => {
      const p = gProducts[+inp.dataset.gf]; const files = [...e.target.files];
      for (const f of files) { try { p.urls.push((await api('/api/upload', { method: 'POST', body: { data: await compressImage(f, 1600) } })).url); } catch (err) { fail(err); } }
      draw();
    });
    $('#gGo').onclick = e => busy(e.target, async () => {
      const ready = gProducts.filter(p => p.urls.length);
      if (!ready.length) return toast('ارفع صور لمنتج واحد على الأقل');
      if (!gPrompts.some(x => x.trim())) return toast('اكتب برومبت واحد على الأقل');
      const r = await api('/api/batch/products', { method: 'POST', body: { products: ready, prompts: gPrompts } });
      gProducts = [{ name: '', urls: [] }]; toast(`انضافت ${r.added} صورة لـ Gemini`); draw();
    });
    $('#bPLogo').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { bLogo = (await api('/api/upload', { method: 'POST', body: { data: await compressImage(f, 600) } })).url; $('#bPLogoNote').textContent = '✓ شعار المنتج جاهز'; } catch (err) { fail(err); } };
    document.querySelectorAll('[data-brand]').forEach(inp => inp.onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const data = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(f); });
      try { await api('/api/brand', { method: 'POST', body: { kind: inp.dataset.brand, data } }); toast('انحفظ'); draw(); } catch (err) { fail(err); }
    });
    $('#bGo').onclick = e => busy(e.target, async () => {
      if (!pending.length) return toast('اختار صور أول');
      const request = $('#bReq').value.trim(); const brand = $('#bBrand').checked;
      if (!request && !brand) return toast('اكتب شو بدك يعدّل');
      const r = await api('/api/batch', { method: 'POST', body: { urls: pending, request, quality: $('#bQ').value, brand, brand_logo: bLogo } });
      pending = []; $('#bReq').value = ''; toast(`انضافت ${r.added} صورة للطابور`); draw();
    });
    $('#bRetry') && ($('#bRetry').onclick = async () => { await api('/api/batch/retry', { method: 'POST', body: {} }); draw(); });
    $('#bClear') && ($('#bClear').onclick = async () => { await api('/api/batch/clear', { method: 'POST', body: {} }); draw(); });
    document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await api('/api/batch/' + b.dataset.del, { method: 'DELETE' }); draw(); });
  };
  await draw();
  const timer = setInterval(() => { if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) draw().catch(() => {}); }, 15000);
  route.cleanup = () => clearInterval(timer);
}

// ===== التعديل التلقائي من مجلد =====
async function viewAuto() {
  const draw = async () => {
    const d = await api('/api/auto'); const c = d.cfg;
    const n = s => d.items.filter(i => i.status === s).length;
    const done = n('done'), err = n('error');
    const st = { done: '✅ خلص', error: '✗ ما زبط', working: '🎨 عم يتعدّل', queued: '⏳' };
    shell('#/auto', `
      ${mobileTop()}
      <div class="page" style="max-width:1000px">
        <div class="page-head"><h1>تعديل تلقائي من مجلد</h1><p>حط كل صور المنتجات بمجلد واحد — المنصة بتتعرّف لحالها على صور كل منتج (أو إذا بدك حط كل منتج بمجلد لحاله). بتختار أحسن صورة لكل منتج، بتعدّلها بـ Gemini بالبرومبت الثابت، وبتحفظها لحالها.</p></div>
        <div class="panel" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;${c.running ? 'border:2px solid #2a9d5c' : ''}">
          <div style="flex:1;min-width:220px">
            <h2 style="margin:0">${c.running && c.grouping ? `🔎 ${esc(c.grouping)}` : c.running ? (c.current ? `🎨 عم يعدّل: <b>${esc(c.current)}</b>` : '▶ شغّال — عم يدوّر عالمنتج الجاي') : '⏸ واقف'}</h2>
            <div class="muted">${done} خلص من ${d.total} منتج${err ? ` · ${err} ما زبط` : ''}${!c.running && c.stopReason ? ` · ${esc(c.stopReason)}` : ''}</div>
          </div>
          ${c.running ? '<button class="btn danger" id="aStop">⏹ إيقاف</button>' : '<button class="btn primary" id="aStart">▶ ابدأ</button>'}
          ${err ? '<button class="btn small" id="aRetry">أعد يلي ما زبطوا</button>' : ''}
        </div>
        <form class="panel" id="aCfg" style="margin-top:14px">
          <div class="form-grid">
            <label class="field"><span>مجلد المنتجات (كل منتج مجلد لحاله)</span><input name="folder" dir="ltr" value="${esc(c.folder)}" placeholder="C:\\KO\\products"><small class="${d.folderOk ? '' : 'muted'}">${c.folder ? (d.folderOk ? (d.total ? `✓ ${d.total} منتج` : d.flat ? `✓ ${d.flat} صورة — بكبسة ابدأ بتعرّف على المنتجات لحالي` : 'ما في صور') : '✗ المجلد مو موجود') : ''}</small></label>
            <label class="field"><span>وين ينحفظوا (اختياري)</span><input name="out" dir="ltr" value="${esc(c.out)}" placeholder="${esc(c.folder ? c.folder + '_edited' : 'C:\\KO\\products_edited')}"></label>
          </div>
          <label class="field"><span>البرومبت الثابت</span><textarea name="prompt" rows="7">${esc(c.prompt)}</textarea></label>
          <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
            <select name="model"><option value="gemini-3-pro-image" ${c.model === 'gemini-3-pro-image' ? 'selected' : ''}>Nano Banana Pro (الأحسن)</option><option value="gemini-3.1-flash-image" ${c.model === 'gemini-3.1-flash-image' ? 'selected' : ''}>Nano Banana 2 (أرخص)</option></select>
            <select name="size">${['1K', '2K', '4K'].map(x => `<option ${c.size === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
            <select name="aspect">${['', '1:1', '4:5', '3:4', '9:16', '16:9'].map(x => `<option value="${x}" ${c.aspect === x ? 'selected' : ''}>${x || 'مقاس تلقائي'}</option>`).join('')}</select>
            <label class="switch"><input type="checkbox" name="brand" ${c.brand ? 'checked' : ''}><span class="track"></span>ابعت لوغو المتجر + الدراغون</label>
            <span class="spacer"></span><button class="btn primary">حفظ الإعدادات</button>
          </div>
        </form>
        ${d.groups.length && d.flat ? `<details class="panel" style="margin-top:14px"><summary><b>المنتجات يلي تعرّفت عليها (${d.groups.length})</b></summary>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${d.groups.map(g => `<span class="chip">${esc(g.name)} · ${g.n} صور</span>`).join('')}</div>
          <button class="btn ghost small" id="aRegroup" style="margin-top:8px">أعد التعرّف على المنتجات</button></details>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:14px">
          ${d.items.map(i => `<div class="panel" style="padding:8px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
              ${i.src_url ? `<img src="${esc(i.src_url)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px">` : '<div></div>'}
              ${i.result_url ? `<a href="${esc(i.result_url)}" target="_blank"><img src="${esc(i.result_url)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px"></a>` : '<div style="aspect-ratio:1;border-radius:8px;background:#0001;display:grid;place-items:center">…</div>'}
            </div>
            <div style="margin-top:6px"><b>${esc(i.product)}</b> · ${st[i.status] || i.status}</div>
            ${i.picked ? `<div class="muted" style="font-size:12px">الصورة المختارة: ${esc(i.picked)}</div>` : ''}
            ${i.error ? `<div style="font-size:12px;color:#c33">${esc(i.error)}</div>` : ''}
            ${i.out_path ? `<div class="muted" style="font-size:11px" dir="ltr">${esc(i.out_path)}</div>` : ''}
            <div class="row" style="gap:6px;margin-top:6px">${i.result_url ? `<a class="btn small" href="${esc(i.result_url)}" download>تنزيل</a>` : ''}${i.status !== 'working' ? `<button class="btn ghost small" data-redo="${esc(i.product)}">أعد تعديله</button>` : ''}</div>
          </div>`).join('') || '<p class="muted">لسا ما تعدّل شي.</p>'}
        </div>
      </div>`);
    $('#aCfg').onsubmit = e => { e.preventDefault(); busy(e.submitter, async () => { await api('/api/auto', { method: 'PUT', body: formData(e.target) }); toast('انحفظ'); draw(); }); };
    $('#aStart') && ($('#aStart').onclick = e => busy(e.target, async () => { await api('/api/auto', { method: 'PUT', body: formData($('#aCfg')) }); await api('/api/auto/start', { method: 'POST' }); toast('بلّش'); draw(); }));
    $('#aStop') && ($('#aStop').onclick = e => busy(e.target, async () => { await api('/api/auto/stop', { method: 'POST' }); toast('وقف — بيكمّل الصورة الحالية بس'); draw(); }));
    $('#aRetry') && ($('#aRetry').onclick = async () => { await api('/api/auto/retry', { method: 'POST' }); draw(); });
    $('#aRegroup') && ($('#aRegroup').onclick = async () => { if (!confirm('أعيد التعرّف على المنتجات من الأول؟')) return; await api('/api/auto/regroup', { method: 'POST' }); draw(); });
    document.querySelectorAll('[data-redo]').forEach(b => b.onclick = async () => { await api('/api/auto/redo', { method: 'POST', body: { product: b.dataset.redo } }); toast('رح ينعاد'); draw(); });
  };
  await draw();
  const timer = setInterval(() => { if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) draw().catch(() => {}); }, 10000);
  route.cleanup = () => clearInterval(timer);
}

// ===== رابط الموقع العام (workers.dev ببلاش) =====
async function viewLink() {
  const stName = { off: '⏸ مطفي', downloading: '⬇️ عم نزّل cloudflared…', starting: '⏳ عم يشغّل النفق…', publishing: '⏳ عم يحدّث الـ Worker…', on: '✅ شغّال', error: '✗ في مشكلة', restarting: '🔄 عم يعيد التشغيل…' };
  const draw = async () => {
    const d = await api('/api/link'); const s = d.status;
    const url = s.publicUrl || d.last_url;
    shell('#/link', `
      ${mobileTop()}
      <div class="page" style="max-width:760px">
        <div class="page-head"><h1>رابط الموقع العام</h1><p>رابط ثابت ببلاش على <b>workers.dev</b> — أي حدا بيفتحه من أي مكان بيوصل لمنصتك على كمبيوترك. الكمبيوتر لازم يضل شغّال.</p></div>
        <div class="panel" style="${s.state === 'on' ? 'border:2px solid #2a9d5c' : ''}">
          <h2 style="margin:0">${stName[s.state] || esc(s.state)}</h2>
          ${url ? `<p style="font-size:18px;margin:10px 0" dir="ltr"><a href="${esc(url)}" target="_blank"><b>${esc(url)}</b></a> <button class="btn small" id="lCopy">نسخ</button></p>` : ''}
          ${s.error ? `<p style="color:#c33">${esc(s.error)}</p>` : ''}
          ${s.pagesError ? `<p class="muted" style="color:#c80">رابط pages.dev ما زبط: ${esc(s.pagesError)}</p>` : ''}
          ${s.target ? `<div class="muted" style="font-size:12px" dir="ltr">→ ${esc(s.target)}</div>` : ''}
        </div>
        <form class="panel" id="lForm" style="margin-top:14px">
          <div class="form-grid">
            <label class="field"><span>Account ID تبع Cloudflare</span><input name="account" dir="ltr" value="${esc(d.account)}" placeholder="f4ade7e1…"></label>
            <label class="field"><span>اسم الرابط</span><input name="name" dir="ltr" value="${esc(d.name)}" placeholder="kfastai"></label>
          </div>
          <label class="field"><span>مفتاح Workers (Edit Cloudflare Workers)</span><input name="token" dir="ltr" value="" placeholder="${d.hasToken ? '✓ محفوظ — اتركه فاضي لتخلّيه' : 'الصق المفتاح هون'}"></label>
          <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
            <label class="switch"><input type="checkbox" name="enabled" ${d.enabled ? 'checked' : ''}><span class="track"></span>شغّل الرابط العام</label>
            <span class="spacer"></span><button class="btn primary">حفظ وتشغيل</button>
          </div>
        </form>
        <div class="panel muted" style="margin-top:14px;font-size:14px">
          <b>كيف تطلّع المفتاح:</b> dash.cloudflare.com/profile/api-tokens ← Create Token ← "Edit Cloudflare Workers" ← Use template ← اختار حسابك ← Continue ← Create Token ← انسخه والصقه فوق.
        </div>
      </div>`);
    $('#lForm').onsubmit = e => { e.preventDefault(); busy(e.submitter, async () => { const f = e.target; await api('/api/link', { method: 'PUT', body: { account: f.account.value, name: f.name.value, token: f.token.value, enabled: f.enabled.checked } }); toast('انحفظ — عم يشغّل'); setTimeout(draw, 1500); }); };
    $('#lCopy') && ($('#lCopy').onclick = () => { navigator.clipboard.writeText(url); toast('انسخ'); });
  };
  await draw();
  const timer = setInterval(() => { if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) draw().catch(() => {}); }, 4000);
  route.cleanup = () => clearInterval(timer);
}

// ===== مجيب المسنجر: إعدادات إضافة Chrome/Edge يلي بترد على رسائلك الخاصة بفيسبوك (لمدير المنصة بس) =====
async function viewMessenger() {
  if (!ME.user.is_super) return go('#/');
  const d = await api('/api/messenger');
  const c = d.config;
  const sel = (name, list) => `<select name="${name}">${list.map(([v, t]) => `<option value="${v}" ${c[name] === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const ta = (name, ph, rows = 4) => `<textarea name="${name}" rows="${rows}" placeholder="${esc(ph)}">${esc(c[name] || '')}</textarea>`;
  const sw = (name, t) => `<label class="switch" style="margin:4px 0 10px"><input type="checkbox" name="${name}" ${c[name] ? 'checked' : ''}><span class="track"></span>${t}</label>`;
  const num = (name, t, min, max) => `<label class="field"><span>${t}</span><input type="number" name="${name}" min="${min}" max="${max}" value="${esc(c[name])}"></label>`;
  const status = (seen) => !seen ? '<span class="chip">✗ الإضافة ما حكت مع المجيب لسا: ركّبها وافتح المسنجر</span>'
    : Date.now() - seen < 90000 ? '<span class="chip ok">✅ الإضافة متصلة هلق</span>'
    : `<span class="chip">⏸ آخر مرة حكت الإضافة: ${new Date(seen).toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit' })}</span>`;
  const logHtml = (log) => log.length ? log.map(e => `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
      <div><b>${esc(e.name || '؟')}</b> <small class="muted">${new Date(e.at).toLocaleString('ar', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}</small> · <small>${esc(e.status)}</small></div>
      ${e.text ? `<div class="muted" style="font-size:13px">هو: ${esc(e.text)}</div>` : ''}${e.reply ? `<div style="font-size:13px">البوت: ${esc(e.reply)}</div>` : ''}</div>`).join('') : '<p class="muted">لسا ما صار شي</p>';
  shell('#/messenger', `
    ${mobileTop()}
    <div class="page" style="max-width:820px">
      <div class="page-head"><h1>مجيب المسنجر</h1><p>بيرد على رسائلك الخاصة بمسنجر فيسبوك عن طريق إضافة على Chrome أو Edge، بنفس عقول الذكاء الاصطناعي تبع المنصة (ما في مفاتيح بالإضافة). كلشي بينحفظ لحالو.</p></div>
      <div class="panel"><div class="row"><span id="mSeen">${status(d.seen)}</span><span class="spacer"></span><span class="chip" id="mSaved" style="visibility:hidden">انحفظ ✓</span></div></div>
      <form id="mForm">
        <div class="panel">
          <h2 style="margin-top:0">التشغيل</h2>
          ${sw('on', 'المسودات شغّالة')}
          <p class="muted" style="font-size:13px;margin:0">إضافة «مساعد مسودات المسنجر» بتكتب الرد بصندوق الرسالة بس، وإنت بتراجعو وبتبعتو بنفسك. ما بتبعت شي لحالها.</p>
        </div>
        <div class="panel">
          <h2 style="margin-top:0">مين إنت</h2>
          <label class="field"><span>اسمك</span><input type="text" name="ownerName" value="${esc(c.ownerName)}" placeholder="مثلاً: أبو كريم"><small class="muted">البوت بيحكي عنك بهالاسم</small></label>
          <label class="field"><span>شو مسموح البوت يعرف ويحكي عنك</span>${ta('about', 'شغلك، أوقاتك، شو بتحب… أي شي مو مكتوب هون البوت ما بيخترعو')}</label>
        </div>
        <div class="panel">
          <h2 style="margin-top:0">طريقة الرد</h2>
          <div class="form-grid">
            <label class="field"><span>الأسلوب</span>${sel('style', [['syrian', 'سوري عفوي'], ['friendly', 'ودود ودافي'], ['formal', 'محترم ورسمي'], ['funny', 'خفيف دم'], ['custom', 'أسلوب بكتبو أنا']])}</label>
            <label class="field"><span>الطول</span>${sel('length', [['short', 'قصير'], ['medium', 'متوسط'], ['long', 'مفصّل']])}</label>
            <label class="field"><span>الإيموجي</span>${sel('emoji', [['none', 'بلا'], ['few', 'قليل'], ['many', 'كتير']])}</label>
            <label class="field"><span>اللغة</span>${sel('lang', [['dialect', 'شامي دايماً'], ['same', 'بنفس لغة الشخص']])}</label>
          </div>
          <label class="field"><span>أسلوبك بكلماتك (إذا اخترت «أسلوب بكتبو أنا»)</span>${ta('styleCustom', 'مثلاً: بحكي مختصر، بقول «تكرم» و«ع راسي»، وما بحب الرسميات', 3)}</label>
          <label class="field"><span>أمثلة على ردودك</span>${ta('examples', '- هلا والله، كيفك؟\n- تكرم عيونك، بس خلصني شغل بحكيك\n- ههههه لا تآخذني')}<small class="muted">انسخ كم رسالة من ردودك الحقيقية، والبوت بيقلّد أسلوبك</small></label>
        </div>
        <div class="panel">
          <h2 style="margin-top:0">سرد الحديث</h2>
          <label class="field"><span>كيف يمشي بالحديث</span>${ta('flow', '1. رحّب بالشخص وسألو عن حالو.\n2. اسمع شو بدو، واسأل سؤال واحد إذا مو واضح.\n3. إذا موضوع شغل: خد التفاصيل وقلّو إني رح ارجعلو اليوم.\n4. إذا دردشة عادية: كمّل معو بلطف وبجمل قصيرة.\n5. خلّص الحديث بشكل لطيف إذا قال باي.', 6)}</label>
          <label class="field"><span>الهدف من المحادثة</span><input type="text" name="goal" value="${esc(c.goal)}" placeholder="مثلاً: يعرف شو بدو الشخص ويطمّنو إني رح رد عليه"></label>
          <label class="field"><span>مواضيع وكلمات ممنوعة</span>${ta('forbidden', 'السياسة\nالدين\nأسعار ما بعرفها', 3)}</label>
        </div>
        <div class="panel">
          <h2 style="margin-top:0">ناس محددين وردود جاهزة</h2>
          <label class="field"><span>تعليمات لكل شخص</span>${ta('people', 'أمي: تجاهل\nأحمد: رفيقي من زمان، احكي معو بمزح\nسارة: زبونة، احكي معها باحترام')}<small class="muted">كل سطر: الاسم: التعليمات. «تجاهل» يعني ما يرد عليه أبداً</small></label>
          <label class="field"><span>مين يرد عليهم؟</span>${sel('scope', [['all', 'الكل، إلا يلي جنبهم «تجاهل»'], ['only', 'بس الناس المكتوبين فوق']])}</label>
          ${sw('groups', 'يرد كمان بالمجموعات')}
          <label class="field"><span>ردود جاهزة (بلا ذكاء اصطناعي)</span>${ta('quick', 'رقمك|نمرتك => بعتلك ياه بعد شوي\nوينك|وين انت => مشغول شوي، برجعلك', 3)}<small class="muted">كل سطر: الكلمة => الرد. فيك تحط كذا كلمة بينهن |</small></label>
        </div>
        <div class="panel">
          <h2 style="margin-top:0">تنبيه إنو الرد آلي</h2>
          ${sw('noteOn', 'حط هالجملة بأول مسودة لكل شخص (مرة كل 12 ساعة)')}
          <label class="field"><input type="text" name="note" value="${esc(c.note)}"></label>
          <p class="muted" style="font-size:13px;margin:0">إذا حدا سأل إذا عم يحكي مع بوت، ما بتنكتب مسودة وبيطلعلك تنبيه لترد إنت بنفسك. وإذا حدا كتب إنو بدو يأذي حالو، بتطلعلك مسودة لطيفة وتنبيه ⚠️ لتحكي معو بنفسك.</p>
        </div>
        <div class="panel">
          <h2 style="margin-top:0">التوقيت والحدود</h2>
          <div class="form-grid">
            ${num('delayMin', 'يستنى قبل الرد (ثانية) من', 3, 600)}${num('delayMax', 'لـ', 3, 900)}
            ${num('perChatHour', 'أكتر شي ردود لنفس الشخص بالساعة', 1, 60)}${num('perHour', 'أكتر شي ردود بالساعة لكل الناس', 1, 300)}
          </div>
          ${sw('onlyAway', 'لا ترد إذا أنا عم استعمل صفحة المسنجر (دقيقتين)')}<br>
          ${sw('hoursOn', 'يشتغل بس بين ساعة معينة وساعة')}
          <div class="form-grid">${num('hourFrom', 'من الساعة', 0, 23)}${num('hourTo', 'للساعة', 0, 23)}</div>
        </div>
      </form>
      <div class="panel">
        <h2 style="margin-top:0">جرّب البوت</h2>
        <p class="muted" style="font-size:13px">اكتب رسائل متل كأنو حدا بعتلك ياهن (كل سطر رسالة). السطر يلي بيبلش بـ «أنا:» بيعتبر ردك إنت.</p>
        <label class="field"><span>اسم الشخص</span><input type="text" id="mtName" value="أحمد"></label>
        <textarea id="mtMsgs" rows="3">مرحبا كيفك؟ شو عم تعمل؟</textarea>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="mtGo">جرّب</button><button class="btn" id="mtPrompt">شوف التعليمات يلي بتنبعت للبوت</button></div>
        <div id="mtOut" style="white-space:pre-wrap;margin-top:10px;background:var(--sunken);border-radius:var(--radius-s);padding:10px;min-height:40px">…</div>
      </div>
      <div class="panel">
        <div class="row"><h2 style="margin:0">آخر شي صار</h2><span class="spacer"></span><button class="btn small" id="mClear">مسح</button></div>
        <div id="mLog">${logHtml(d.log)}</div>
      </div>
      <div class="panel muted" style="font-size:14px">
        <b>تركيب الإضافة (مرة وحدة):</b>
        <ol style="margin:6px 0 0;padding-inline-start:20px">
          <li>بـ Chrome افتح <b dir="ltr">chrome://extensions</b>، أو بـ Edge افتح <b dir="ltr">edge://extensions</b>.</li>
          <li>شغّل «Developer mode» (بـ Chrome فوق يمين، بـ Edge عاليسار).</li>
          <li>اضغط «Load unpacked» واختار المجلد <b dir="ltr">C:\\raddad\\messenger-draft-extension</b>.</li>
          <li>افتح <b dir="ltr">facebook.com/messages</b> أو <b dir="ltr">messenger.com</b>. المنصة لازم تكون شغّالة على الكمبيوتر.</li>
          <li>لما تجيك رسالة، بتنكتب المسودة بصندوق الكتابة، وإنت بتراجعها وبتبعتها.</li>
        </ol>
      </div>
    </div>`);
  const form = $('#mForm');
  let t = null;
  const save = () => { clearTimeout(t); t = setTimeout(async () => {
    try { await api('/api/messenger', { method: 'PUT', body: formData(form) }); const s = $('#mSaved'); if (s) { s.style.visibility = 'visible'; setTimeout(() => { s.style.visibility = 'hidden'; }, 1200); } } catch (e) { fail(e); }
  }, 500); };
  form.addEventListener('input', save); form.addEventListener('change', save);
  form.onsubmit = e => e.preventDefault();
  const msgs = () => $('#mtMsgs').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => /^أنا\s*:/.test(l) ? { from: 'me', text: l.replace(/^أنا\s*:\s*/, '') } : { from: 'them', text: l });
  $('#mtGo').onclick = () => busy($('#mtGo'), async () => {
    const t0 = Date.now(); $('#mtOut').textContent = 'عم يفكّر…';
    const r = await api('/api/messenger/test', { method: 'POST', body: { name: $('#mtName').value, messages: msgs(), cfg: formData(form) } });
    $('#mtOut').textContent = r.skip ? 'ما رح يرد: ' + r.skip : r.ok ? `${r.reply}\n\n— ${r.via} · ${((Date.now() - t0) / 1000).toFixed(1)} ثانية${r.crisis ? ' · ⚠️ رسالة مهمة: البوت رح يوقف بهالمحادثة ويخبرك' : ''}` : 'ما زبط: ' + r.error;
  });
  $('#mtPrompt').onclick = () => busy($('#mtPrompt'), async () => {
    const r = await api('/api/messenger/prompt', { method: 'POST', body: { name: $('#mtName').value, cfg: formData(form) } });
    $('#mtOut').textContent = r.prompt;
  });
  $('#mClear').onclick = () => busy($('#mClear'), async () => { await api('/api/messenger/clear-log', { method: 'POST' }); $('#mLog').innerHTML = logHtml([]); });
  const timer = setInterval(async () => {
    try { const x = await api('/api/messenger'); const s = $('#mSeen'), l = $('#mLog'); if (s) s.innerHTML = status(x.seen); if (l) l.innerHTML = logHtml(x.log); } catch {}
  }, 10000);
  route.cleanup = () => clearInterval(timer);
}

// ===== استوديو Gemini: واجهة متل موقع Gemini =====
const studio = { msgs: [], att: [], aspect: '4:5', size: '2K', model: 'gemini-3-pro-image' };
async function viewStudio() {
  const brandImgs = await api('/api/studio/brand').catch(() => []);
  const draw = () => {
    shell('#/studio', `
      ${mobileTop()}
      <div class="page" style="max-width:900px;display:flex;flex-direction:column;min-height:calc(100vh - 40px)">
        <div class="page-head" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h1 style="margin:0">🍌 استوديو Gemini</h1>
          <button class="btn ghost small" id="sNew">محادثة جديدة</button></div>
        <div id="sMsgs" style="flex:1;display:flex;flex-direction:column;gap:12px;padding:8px 0">
          ${studio.msgs.map(m => `<div style="align-self:${m.role === 'user' ? 'flex-start' : 'flex-end'};max-width:92%" class="panel">
            ${(m.images || []).length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${m.images.map(u => `<a href="${esc(u)}" target="_blank"><img src="${esc(u)}" style="max-width:${m.role === 'model' ? '420px' : '110px'};width:100%;border-radius:10px"></a>`).join('')}</div>` : ''}
            ${m.text ? `<div style="white-space:pre-wrap;margin-top:6px">${esc(m.text)}</div>` : ''}
            ${m.role === 'model' && (m.images || []).length ? `<div class="row" style="gap:6px;margin-top:8px">${m.images.map(u => `<a class="btn small" href="${esc(u)}" download>تنزيل</a>`).join('')}<span class="muted" style="font-size:12px">انحفظت بـ C:\\raddad\\data\\exports\\studio</span></div>` : ''}
          </div>`).join('') || '<div class="muted" style="text-align:center;margin-top:40px">ارفع صور المنتج وشعاراتك، اكتب البرومبت متل ما بتكتبه بـ Gemini، واكبس إرسال.<br>بتقدر تكمّل تعديل بنفس المحادثة.</div>'}
          ${studio.busy ? '<div class="panel" style="align-self:flex-end">🍌 Gemini عم يشتغل… (دقيقة أو دقيقتين)</div>' : ''}
        </div>
        <div class="panel" style="position:sticky;bottom:8px">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${studio.att.map((u, i) => `<div style="position:relative"><img src="${esc(u)}" style="width:64px;height:64px;object-fit:cover;border-radius:8px"><button data-rm="${i}" style="position:absolute;top:-6px;inset-inline-end:-6px;border-radius:50%;border:0;background:#c33;color:#fff;width:20px;height:20px;cursor:pointer">×</button></div>`).join('')}</div>
          <textarea id="sText" rows="3" placeholder="اكتب البرومبت…" style="width:100%">${esc(studio.draft || '')}</textarea>
          <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">
            <label class="btn small">📎 صور<input type="file" accept="image/*" multiple id="sFiles" hidden></label>
            ${brandImgs.map(b => `<button type="button" class="btn ghost small" data-brand="${esc(b.url)}">+ ${esc(b.label)}</button>`).join('')}
            <select id="sAspect">${['', '1:1', '4:5', '3:4', '9:16', '16:9'].map(a => `<option value="${a}" ${studio.aspect === a ? 'selected' : ''}>${a || 'مقاس تلقائي'}</option>`).join('')}</select>
            <select id="sSize">${['1K', '2K', '4K'].map(a => `<option ${studio.size === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
            <select id="sModel"><option value="gemini-3-pro-image" ${studio.model === 'gemini-3-pro-image' ? 'selected' : ''}>Nano Banana Pro (الأحسن)</option><option value="gemini-3.1-flash-image" ${studio.model === 'gemini-3.1-flash-image' ? 'selected' : ''}>Nano Banana 2 (أسرع وأرخص)</option></select>
            <span class="spacer"></span>
            <button class="btn primary" id="sSend" ${studio.busy ? 'disabled' : ''}>إرسال</button>
          </div>
        </div>
      </div>`);
    const box = $('#sMsgs'); box.lastElementChild?.scrollIntoView({ block: 'end' });
    $('#sText').oninput = e => { studio.draft = e.target.value; };
    $('#sAspect').onchange = e => { studio.aspect = e.target.value; };
    $('#sSize').onchange = e => { studio.size = e.target.value; };
    $('#sModel').onchange = e => { studio.model = e.target.value; };
    $('#sNew').onclick = () => { if (confirm('تبلّش محادثة جديدة؟')) { studio.msgs = []; studio.att = []; draw(); } };
    document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { studio.att.splice(+b.dataset.rm, 1); draw(); });
    document.querySelectorAll('[data-brand]').forEach(b => b.onclick = () => { if (!studio.att.includes(b.dataset.brand)) studio.att.push(b.dataset.brand); draw(); });
    $('#sFiles').onchange = async e => { for (const f of [...e.target.files]) { try { studio.att.push((await api('/api/upload', { method: 'POST', body: { data: await compressImage(f, 2048) } })).url); } catch (err) { fail(err); } } draw(); };
    $('#sSend').onclick = async () => {
      const text = ($('#sText').value || '').trim(); if (!text && !studio.att.length) return toast('اكتب شي أو ارفع صورة');
      const history = studio.msgs.slice(); const images = studio.att.slice();
      studio.msgs.push({ role: 'user', text, images }); studio.att = []; studio.draft = ''; studio.busy = true; draw();
      try { const r = await api('/api/studio', { method: 'POST', body: { history, text, images, aspect: studio.aspect, size: studio.size, model: studio.model } }); studio.msgs.push({ role: 'model', text: r.text, images: r.images }); }
      catch (err) { studio.msgs.push({ role: 'model', text: '✗ ' + err.message }); }
      studio.busy = false; if (location.hash.startsWith('#/studio')) draw();
    };
  };
  draw();
}

// ===== الاشتراك =====
const PERIOD_NAMES = { 1: 'شهر', 3: '3 شهور', 6: '6 شهور', 12: 'سنة' };
const PAY_CHIP = { pending: ['warn', 'قيد المراجعة'], awaiting_delivery: ['warn', 'بانتظار التسليم'], approved: ['ok', 'مفعّل'], rejected: ['bad', 'مرفوض'] };
const fileData = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });

async function viewBilling() {
  const b = await api('/api/billing');
  const head = b.current === 'free' ? 'كل الخطط فيها ردود بلا حدود إذا حطيت مفتاح ذكاء اصطناعي خاص فيك.'
    : b.expired ? 'اشتراكك منتهي والوكيل موقوف عن الرد لحد ما تجدّد.'
    : `اشتراكك بينتهي ${new Date(b.expires_at * 1000).toLocaleDateString('ar')} (باقي ${Math.max(0, Math.ceil((b.expires_at - Date.now() / 1000) / 86400))} يوم).`;
  const renewable = b.plans.find(p => p.id === b.current && p.id !== 'free');
  shell('#/billing', `
    ${mobileTop()}
    <div class="page">
      <div class="page-head"><h1>الاشتراك</h1><p>${head}</p>${renewable ? `<div class="actions"><button class="btn primary" data-plan="${renewable.id}">تجديد</button></div>` : ''}</div>
      <div class="plans">${b.plans.map(p => `
        <div class="plan ${p.id === b.current ? 'current' : ''}">
          <div class="row"><h2>${esc(p.name)}</h2>${p.id === b.current ? '<span class="chip ok">خطتك</span>' : ''}</div>
          <div class="price">${p.price_monthly ? `${p.prices[1]}<small> ${esc(p.currency)} / شهر</small>` : 'مجاناً'}</div>
          <ul>${p.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
          ${p.id !== b.current && p.price_monthly ? `<button class="btn primary" data-plan="${p.id}">اشترك</button>` : ''}
        </div>`).join('')}</div>
      ${b.requests.length ? `<div class="panel" style="margin-top:14px"><h2>سجل دفعاتك</h2><table class="list"><tbody>${b.requests.map(r => `<tr><td>${esc(b.plans.find(p => p.id === r.plan_id)?.name || r.plan_id)} × ${PERIOD_NAMES[r.months] || r.months + ' شهر'}${r.amount ? ` — ${r.amount}` : ''}<br><small class="muted">${esc(r.method || '')}</small></td><td>${fmtTime(r.created_at)}</td><td><span class="chip ${PAY_CHIP[r.status][0]}">${PAY_CHIP[r.status][1]}</span></td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>`);
  $$('[data-plan]').forEach(btn => btn.onclick = () => {
    const p = b.plans.find(x => x.id === btn.dataset.plan);
    const dlg = dialog(`الاشتراك بخطة ${esc(p.name)}`, `
      <form id="pr">
        <label class="field"><span>المدة</span><select name="months">${[1, 3, 6, 12].map(n => `<option value="${n}">${PERIOD_NAMES[n]} — ${p.prices[n]} ${esc(p.currency)}</option>`).join('')}</select></label>
        <div class="seg" id="pm" style="margin-bottom:12px"><button type="button" data-m="shamcash" class="on">شام كاش</button><button type="button" data-m="hand">تسليم باليد بقدسيا</button></div>
        <div id="m-shamcash">
          <div class="note" style="margin-bottom:12px">حوّل المبلغ على شام كاش رقم: <b dir="ltr">${esc(b.shamcash_number || 'تواصل مع الإدارة للرقم')}</b>${b.instructions ? `<div style="white-space:pre-wrap;margin-top:6px">${esc(b.instructions)}</div>` : ''}</div>
          <label class="field"><span>صورة الإيصال</span><input type="file" name="receipt" accept="image/png,image/jpeg,image/webp"></label>
        </div>
        <div id="m-hand" class="hidden">
          <div class="note" style="margin-bottom:12px">الدفع واستلام الاشتراك باليد بقدسيا. اكتب رقمك وبنتواصل معك للتسليم.</div>
          <label class="field"><span>رقم موبايلك</span><input type="tel" name="phone" dir="ltr" placeholder="09xxxxxxxx"></label>
        </div>
      </form>`, `<span class="spacer"></span><button class="btn" data-x>إلغاء</button><button class="btn primary" id="send">أرسل الطلب</button>`);
    let method = 'shamcash';
    dlg.querySelector('#pm').onclick = e => {
      const m = e.target.dataset?.m; if (!m) return;
      method = m;
      dlg.querySelectorAll('#pm button').forEach(x => x.classList.toggle('on', x === e.target));
      dlg.querySelector('#m-shamcash').classList.toggle('hidden', m !== 'shamcash');
      dlg.querySelector('#m-hand').classList.toggle('hidden', m !== 'hand');
    };
    dlg.querySelector('[data-x]').onclick = () => dlg.close();
    dlg.querySelector('#send').onclick = e => busy(e.target, async () => {
      const f = dlg.querySelector('#pr');
      const body = { plan_id: p.id, months: f.months.value, method };
      if (method === 'shamcash') {
        if (!f.receipt.files[0]) throw new Error('ارفع صورة الإيصال');
        body.receipt = await fileData(f.receipt.files[0]);
      } else body.phone = f.phone.value;
      await api('/api/billing/request', { method: 'POST', body });
      dlg.close(); toast(method === 'hand' ? 'وصل طلبك. بانتظار التسليم' : 'وصل طلبك. رح نفعّل الاشتراك بعد التأكد من الإيصال'); viewBilling();
    });
  });
}


// ===== صفحة الزبون الخاصة =====
async function viewStore(slug) {
  await refreshMe();
  if (!slug) return go('#/s/' + encodeURIComponent(ME.tenant.slug));
  slug = decodeURIComponent(slug);
  let d;
  try { d = await api('/api/store?slug=' + encodeURIComponent(slug)); } catch (e) {
    return shell('#/s', `${mobileTop()}<div class="page"><div class="empty">${esc(e.message)}</div></div>`);
  }
  const left = d.expires_at ? Math.ceil((d.expires_at - Date.now() / 1000) / 86400) : null;
  const state = d.plan.id === 'free'
    ? (d.gate.ok ? ['ok', d.gate.code === 'trial' ? 'تجربة مجانية' : 'مجانية'] : ['bad', 'موقوف'])
    : d.expired ? ['bad', 'منتهي'] : ['ok', 'فعّال'];
  const ends = d.plan.id === 'free' ? (d.gate.ends_at ? new Date(d.gate.ends_at * 1000).toLocaleString('ar') : null) : (d.expires_at ? new Date(d.expires_at * 1000).toLocaleDateString('ar') : null);
  shell('#/s', `
    ${mobileTop()}
    <div class="page">
      <div class="page-head"><h1>${esc(d.name)}</h1><p dir="ltr" class="muted">${esc(location.origin)}/#/s/${esc(d.slug)}</p></div>
      <div class="panel">
        <div class="row"><h2>حالة الاشتراك</h2><span class="chip ${state[0]}">${state[1]}</span></div>
        <p style="margin:8px 0">الباقة: <b>${esc(d.plan.name)}</b>${ends ? ` — ${d.expired ? 'انتهى' : 'بينتهي'} ${ends}` : ''}</p>
        ${!d.gate.ok ? `<p class="muted">${esc(d.gate.message)}</p>` : ''}
        ${left !== null && d.plan.id !== 'free' ? `<p class="muted">${d.expired ? 'منتهي' : `باقي ${left} يوم`}</p>` : ''}
        <a class="btn primary" href="#/billing" style="margin-top:10px">${d.plan.id === 'free' ? 'اشترك' : 'تجديد الاشتراك'}</a>
      </div>
      <div class="panel"><h2>سجل الدفعات</h2>${d.payments.length ? `<table class="list"><tbody>${d.payments.map(p => `<tr><td>${esc(p.plan_name)} × ${PERIOD_NAMES[p.months] || p.months}${p.amount ? ` — ${p.amount}` : ''}<br><small class="muted">${esc(p.method || '')}</small></td><td>${fmtTime(p.created_at)}</td><td><span class="chip ${PAY_CHIP[p.status][0]}">${PAY_CHIP[p.status][1]}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty">ما في دفعات</div>'}</div>
      <div class="panel"><div class="row"><h2>آخر المحادثات</h2><a href="#/inbox" style="margin-inline-start:auto">الكل</a></div>${d.contacts.length ? `<table class="list"><tbody>${d.contacts.map(c => `<tr><td>${esc(contactName(c))}${c.needs_human ? ' 🙋' : ''}<br><small class="muted">${esc((c.last_message || '').slice(0, 80))}</small></td><td>${fmtTime(c.last_at)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">ما في محادثات</div>'}</div>
      <div class="panel"><div class="row"><h2>آخر الطلبات</h2><a href="#/orders" style="margin-inline-start:auto">الكل</a></div>${d.orders.length ? `<table class="list"><tbody>${d.orders.map(o => `<tr><td>#${o.id} ${esc(o.customer_name || '')}<br><small class="muted" dir="ltr">${esc(o.customer_phone || '')}</small></td><td>${o.total ?? ''}</td><td>${fmtTime(o.created_at)}</td><td><span class="chip">${esc(o.status)}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty">ما في طلبات</div>'}</div>
    </div>`);
}

// ===== حسابي =====
async function viewAccount() {
  shell('#/account', `
    ${mobileTop()}
    <div class="page" style="max-width:640px">
      <div class="page-head"><h1>حسابي</h1></div>
      <form class="panel" id="acc">
        <label class="field"><span>اسم المتجر</span><input type="text" name="store" value="${esc(ME.tenant.name)}"></label>
        <label class="field"><span>اسمك</span><input type="text" name="name" value="${esc(ME.user.name || '')}"></label>
        <label class="field"><span>الإيميل</span><input type="email" value="${esc(ME.user.email)}" disabled dir="ltr"></label>
        <h3 style="margin:8px 0 10px">تغيير كلمة السر</h3>
        <label class="field"><span>كلمة السر الحالية</span><input type="password" name="password_current" dir="ltr" autocomplete="current-password"></label>
        <label class="field"><span>كلمة السر الجديدة</span><input type="password" name="password_new" dir="ltr" autocomplete="new-password" minlength="8"></label>
        <button class="btn primary" type="submit">حفظ</button>
      </form>
      <div class="panel">
        <h2>المظهر</h2>
        <div class="seg" id="theme" style="margin-top:10px">${[['', 'تلقائي'], ['light', 'فاتح'], ['dark', 'غامق']].map(([v, t]) => `<button data-v="${v}" class="${(localStorage.getItem('theme') || '') === v ? 'on' : ''}">${t}</button>`).join('')}</div>
      </div>
      <div class="panel">
        <h2>نزّل التطبيق على موبايلك</h2>
        <p>من المتصفح: <b>أندرويد</b> ← ⋮ ← «تثبيت التطبيق». <b>آيفون</b> (Safari) ← زر المشاركة ← «إضافة للشاشة الرئيسية».</p>
        <button class="btn" id="inst" ${window.__installPrompt ? '' : 'hidden'}>ثبّت هلق</button>
      </div>
      <button class="btn danger" id="out" style="margin-top:14px">${icon('out')} تسجيل خروج</button>
    </div>`);
  $('#acc').onsubmit = e => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const d = formData(e.target);
      await api('/api/account', { method: 'PUT', body: { name: d.name, password_current: d.password_current, password_new: d.password_new } });
      if (d.store && d.store !== ME.tenant.name) await api('/api/settings', { method: 'PUT', body: { name: d.store } });
      toast('انحفظ'); await refreshMe(); viewAccount();
    });
  };
  $('#theme').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    try { b.dataset.v ? localStorage.setItem('theme', b.dataset.v) : localStorage.removeItem('theme'); } catch {}
    applyTheme(); $$('#theme button').forEach(x => x.classList.toggle('on', x === b));
  };
  $('#inst').onclick = () => window.__installPrompt?.prompt();
  $('#out').onclick = async () => { await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {}); ME = null; ES?.close(); go('#/login'); };
}

// ===== المزيد (موبايل) =====
async function viewMore() {
  const items = NAV.filter(n => n.h && !TABS.some(t => t.h === n.h) && (!n.super || ME.user.is_super));
  shell('#/more', `${mobileTop()}<div class="page"><h1 style="margin-bottom:10px">المزيد</h1><div class="more-list">${items.map(n => `<a href="${n.h}">${icon(n.i)}${n.t}</a>`).join('')}</div></div>`);
}

// ===== إدارة المنصة =====
let adminTab = 'tenants';
async function viewAdmin() {
  if (!ME.user.is_super) return go('#/');
  shell('#/admin', `
    ${mobileTop()}
    <div class="page">
      <div class="page-head"><h1>إدارة المنصة</h1><p>المشتركين، الخطط، الدفعات، وإعدادات المنصة العامة.</p></div>
      <div class="grid stats" id="ov"></div>
      <div class="seg" id="at" style="margin:16px 0">${[['tenants', 'المشتركين'], ['payments', 'الدفعات'], ['trials', 'التجارب'], ['plans', 'الخطط'], ['settings', 'الإعدادات']].map(([v, t]) => `<button data-t="${v}" class="${adminTab === v ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div id="ab"></div>
    </div>`);
  api('/api/admin/overview').then(o => {
    $('#ov').innerHTML = [[o.tenants, 'مشترك'], [o.active_today, 'نشط اليوم'], [o.msgs_today, 'رسالة اليوم'], [o.ai_today, 'رد ذكي اليوم'], [o.pending_payments, 'دفعة بانتظارك'], [o.trial_alerts, 'تنبيه تجربة']]
      .map(([n, t]) => `<div class="panel stat"><b>${n}</b><span>${t}</span></div>`).join('');
  }).catch(fail);
  $('#at').onclick = e => { const b = e.target.closest('button'); if (b) { adminTab = b.dataset.t; $$('#at button').forEach(x => x.classList.toggle('on', x === b)); adminBody(); } };
  adminBody();
}

async function adminBody() {
  const ab = $('#ab');
  ab.innerHTML = '<div class="loading">…</div>';
  if (adminTab === 'tenants') {
    const [rows, plans] = await Promise.all([api('/api/admin/tenants'), api('/api/admin/plans')]);
    ab.innerHTML = `<div class="panel scroll-x"><table class="list"><thead><tr><th>المتجر</th><th>واتساب</th><th>الخطة</th><th>تنتهي</th><th>ردود 7 أيام</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${rows.map(t => `<tr data-id="${t.id}">
        <td><b>${esc(t.name)}</b><br><small class="muted" dir="ltr">${esc(t.email || '')}</small></td>
        <td><span class="chip ${t.wa_status === 'open' ? 'ok' : 'bad'}">${t.wa_provider === 'cloud' ? 'رسمي' : 'QR'}</span>${t.wa_phone ? `<br><small dir="ltr">+${esc(t.wa_phone)}</small>` : ''}</td>
        <td><select data-k="plan_id">${plans.map(p => `<option value="${p.id}" ${p.id === t.plan_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td>
        <td><small>${t.plan_expires_at ? new Date(t.plan_expires_at * 1000).toLocaleDateString('ar') : '—'}</small><br><button class="btn small" data-add>+ شهر</button></td>
        <td>${t.ai_7d}${t.ai_provider !== 'platform' ? ' <small class="muted">(مفتاحه)</small>' : ''}</td>
        <td><select data-k="status"><option value="active" ${t.status === 'active' ? 'selected' : ''}>فعّال</option><option value="suspended" ${t.status === 'suspended' ? 'selected' : ''}>موقوف</option></select></td>
        <td><small class="muted">${t.products} منتج</small></td>
      </tr>`).join('')}</tbody></table></div>`;
    $$('#ab tr[data-id]').forEach(tr => {
      const id = tr.dataset.id;
      tr.querySelectorAll('select[data-k]').forEach(s => s.onchange = async () => {
        try { await api(`/api/admin/tenants/${id}`, { method: 'PUT', body: { [s.dataset.k]: s.value } }); toast('انحفظ'); } catch (e) { fail(e); }
      });
      tr.querySelector('[data-add]').onclick = e => busy(e.target, async () => { await api(`/api/admin/tenants/${id}`, { method: 'PUT', body: { add_months: 1 } }); toast('انضاف شهر'); adminBody(); });
    });
  }
  if (adminTab === 'payments') {
    const rows = await api('/api/admin/payments');
    ab.innerHTML = `<div class="panel scroll-x">${rows.length ? `<table class="list"><thead><tr><th>المتجر</th><th>الخطة والمبلغ</th><th>الطريقة والتفاصيل</th><th>التاريخ</th><th></th></tr></thead><tbody>
      ${rows.map(p => `<tr><td>${esc(p.tenant_name)}</td><td>${esc(p.plan_id)} × ${PERIOD_NAMES[p.months] || p.months}${p.amount ? `<br><small class="muted">${p.amount}</small>` : ''}</td><td>${esc(p.method)}${p.receipt ? `<br><a href="${esc(p.receipt)}" target="_blank" rel="noopener">عرض الإيصال</a>` : ''}${p.phone ? `<br><span dir="ltr">${esc(p.phone)}</span>` : ''}<br><small class="muted">${esc(p.reference || '')}</small></td><td>${fmtTime(p.created_at)}</td>
        <td>${['pending', 'awaiting_delivery'].includes(p.status) ? `<div class="row"><button class="btn small primary" data-pay="${p.id}" data-a="approve">تفعيل</button><button class="btn small" data-pay="${p.id}" data-a="reject">رفض</button></div>` : `<span class="chip ${PAY_CHIP[p.status][0]}">${PAY_CHIP[p.status][1]}</span>`}${p.status === 'awaiting_delivery' ? '<br><small class="muted">بانتظار التسليم</small>' : ''}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">ما في طلبات دفع</div>'}</div>`;
    $$('[data-pay]').forEach(b => b.onclick = () => busy(b, async () => { await api(`/api/admin/payments/${b.dataset.pay}`, { method: 'POST', body: { action: b.dataset.a } }); toast('تم'); adminBody(); }));
  }
  if (adminTab === 'trials') {
    const rows = await api('/api/admin/trial-alerts');
    ab.innerHTML = `<div class="panel scroll-x">${rows.length ? `<table class="list"><thead><tr><th>المتجر</th><th>الرقم</th><th>السبب</th><th>التاريخ</th><th></th></tr></thead><tbody>
      ${rows.map(a => `<tr><td>${esc(a.tenant_name)}</td><td dir="ltr">+${esc(a.phone)}</td><td>${esc(a.reason)}</td><td>${fmtTime(a.created_at)}</td>
        <td>${a.status === 'open' ? `<div class="row"><button class="btn small primary" data-ta="${a.id}" data-a="allow">اسمح بتجربة جديدة</button><button class="btn small" data-ta="${a.id}" data-a="dismiss">تجاهل</button></div>` : `<span class="chip ${a.status === 'allowed' ? 'ok' : 'bad'}">${a.status === 'allowed' ? 'انسمح' : 'متجاهَل'}</span>`}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">ما في تنبيهات تجربة</div>'}</div>`;
    $$('[data-ta]').forEach(b => b.onclick = () => busy(b, async () => { await api(`/api/admin/trial-alerts/${b.dataset.ta}`, { method: 'POST', body: { action: b.dataset.a } }); toast('تم'); adminBody(); }));
  }
  if (adminTab === 'plans') {
    const plans = await api('/api/admin/plans');
    const row = p => `<div class="panel" data-plan>
      <div class="form-grid">
        <label class="field"><span>الرمز (إنجليزي)</span><input type="text" data-f="id" value="${esc(p.id)}" dir="ltr" ${p.id === 'free' ? 'readonly' : ''}></label>
        <label class="field"><span>الاسم</span><input type="text" data-f="name" value="${esc(p.name)}"></label>
        <label class="field"><span>السعر الشهري</span><input type="number" data-f="price_monthly" value="${p.price_monthly}" dir="ltr"></label>
        <label class="field"><span>العملة</span><input type="text" data-f="currency" value="${esc(p.currency)}" dir="ltr"></label>
        <label class="field"><span>ردود ذكية باليوم (من المنصة)</span><input type="number" data-f="ai_replies_per_day" value="${p.ai_replies_per_day}" dir="ltr"></label>
        <label class="field"><span>أقصى عدد منتجات</span><input type="number" data-f="max_products" value="${p.max_products}" dir="ltr"></label>
      </div>
      <div class="form-grid">${[[1, 'شهر'], [3, '3 شهور'], [6, '6 شهور'], [12, 'سنة']].map(([m, t]) => `<label class="field"><span>سعر ${t}</span><input type="number" data-pm="${m}" value="${p.prices?.[m] ?? ''}" dir="ltr"></label>`).join('')}</div>
      <label class="field"><span>المميزات (سطر لكل ميزة)</span><textarea data-f="features" rows="3">${esc(p.features.join('\n'))}</textarea></label>
      <div class="row">
        <label class="switch"><input type="checkbox" data-f="allow_own_key" ${p.allow_own_key ? 'checked' : ''}><span class="track"></span>مفتاح خاص</label>
        <label class="switch"><input type="checkbox" data-f="allow_cloud_api" ${p.allow_cloud_api ? 'checked' : ''}><span class="track"></span>ربط رسمي</label>
        <label class="switch"><input type="checkbox" data-f="is_public" ${p.is_public ? 'checked' : ''}><span class="track"></span>ظاهرة للمشتركين</label>
        ${p.id !== 'free' ? '<button class="btn small danger" data-rm style="margin-inline-start:auto">إزالة</button>' : ''}
      </div></div>`;
    ab.innerHTML = `<div id="pl">${plans.map(row).join('')}</div><div class="row" style="margin-top:14px"><button class="btn" id="addp">${icon('plus')} خطة</button><button class="btn primary" id="savep">حفظ الخطط</button></div>
      <p class="muted" style="margin-top:8px;font-size:13px">إزالة خطة من هون بتخفيها بس. المشتركين عليها بيضلوا عليها.</p>`;
    const bindRm = () => $$('[data-rm]').forEach(b => b.onclick = () => { const el = b.closest('[data-plan]'); el.querySelector('[data-f=is_public]').checked = false; el.style.opacity = .5; });
    bindRm();
    $('#addp').onclick = () => { $('#pl').insertAdjacentHTML('beforeend', row({ id: 'plan' + Date.now().toString().slice(-4), name: 'خطة جديدة', price_monthly: 10, currency: 'USD', ai_replies_per_day: 1000, max_products: 1000, allow_own_key: 1, allow_cloud_api: 1, is_public: 1, features: [] })); bindRm(); };
    $('#savep').onclick = e => busy(e.target, async () => {
      const list = $$('[data-plan]').map(el => {
        const o = {};
        el.querySelectorAll('[data-f]').forEach(i => { o[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value; });
        o.features = o.features.split('\n').map(s => s.trim()).filter(Boolean);
        o.prices = {}; el.querySelectorAll('[data-pm]').forEach(i => { o.prices[i.dataset.pm] = i.value; });
        return o;
      });
      await api('/api/admin/plans', { method: 'PUT', body: { plans: list } });
      toast('انحفظت الخطط'); adminBody();
    });
  }
  if (adminTab === 'settings') {
    const s = await api('/api/admin/settings');
    ab.innerHTML = `
      <div class="note" style="margin-bottom:14px">🧠 كل إعدادات الذكاء الاصطناعي صارت بصفحة وحدة: <a href="#/ai">الذكاء الاصطناعي</a></div>
      <form class="panel" id="psf" style="margin-top:14px">
        <h2>الهوية والتسجيل</h2>
        <div class="form-grid">
          <label class="field"><span>اسم المنصة</span><input type="text" name="bname" value="${esc(s.brand.name)}"></label>
          <label class="field"><span>الشعار النصي</span><input type="text" name="btag" value="${esc(s.brand.tagline || '')}"></label>
          <label class="field"><span>اللون الأساسي</span><input type="color" name="bcolor" value="${esc(s.brand.color || '#0E7A5A')}" style="height:40px;width:80px;padding:2px"></label>
        </div>
        <label class="switch" style="margin-bottom:14px"><input type="checkbox" name="reg" ${s.registration_open ? 'checked' : ''}><span class="track"></span>التسجيل مفتوح لمتاجر جديدة</label>
        <div class="form-grid">
          <label class="field"><span>مدة التجربة المجانية</span><input type="number" name="tv" min="1" dir="ltr" value="${s.trial.value}"></label>
          <label class="field"><span>الوحدة</span><select name="tu"><option value="days" ${s.trial.unit === 'days' ? 'selected' : ''}>أيام</option><option value="hours" ${s.trial.unit === 'hours' ? 'selected' : ''}>ساعات</option></select></label>
        </div>
        <label class="field"><span>رقم شام كاش (بيظهر للزبون وقت الدفع)</span><input type="text" name="sham" dir="ltr" value="${esc(s.shamcash_number)}"></label>
        <label class="field"><span>تعليمات الدفع (بتظهر للمشترك لما يطلب ترقية)</span><textarea name="pay" rows="4" placeholder="حوّل المبلغ على شام كاش رقم… واكتب رقم العملية">${esc(s.payment_instructions)}</textarea></label>
      </form>
      <button class="btn primary" id="sas" style="margin-top:14px">حفظ الإعدادات</button>`;
    $('#sas').onclick = e => busy(e.target, async () => {
      const f = formData($('#psf'));
      await api('/api/admin/settings', { method: 'PUT', body: { brand: { name: f.bname, tagline: f.btag, color: f.bcolor }, registration_open: f.reg, payment_instructions: f.pay, shamcash_number: f.sham, trial: { value: f.tv, unit: f.tu } } });
      toast('انحفظت إعدادات المنصة'); await refreshMe(); adminBody();
    });
  }
}

// ===== البداية =====
function applyTheme() {
  let t = ''; try { t = localStorage.getItem('theme') || ''; } catch {}
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
applyTheme();
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__installPrompt = e; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
route();

// ===== إضافة منتجات بالصور والصوت =====
const quick = { items: [], current: -1, stream: null, rec: null, chunks: [], timer: null, started: 0, lang: (() => { try { return localStorage.getItem('voiceLang') || 'ar'; } catch { return 'ar'; } })() };
let qid = 0;

async function viewQuick() {
  const canMic = !!(window.isSecureContext && ((window.SpeechRecognition || window.webkitSpeechRecognition) || (navigator.mediaDevices?.getUserMedia && window.MediaRecorder)));
  shell('#/quick', `
    ${mobileTop()}
    <div class="page" style="max-width:900px">
      <div class="page-head">
        <h1>إضافة بالصور والصوت</h1>
        <p>اختار صور منتجاتك، وعلى كل صورة اكبس المايك واحكي: الاسم، السعر، القياسات والألوان. المنتج بيتسجّل لحاله.</p>
      </div>
      ${canMic ? '' : '<div class="note warn" style="margin-bottom:14px">المايك بيشتغل بس على رابط https أو على الجوال نفسه (127.0.0.1). هلق فيك تكتب الوصف بدل الصوت.</div>'}
      <div class="row" style="margin-bottom:14px">
        <label class="btn primary">${icon('camera')} صوّر منتج<input type="file" accept="image/*" capture="environment" id="qcam" hidden></label>
        <label class="btn">${icon('image')} اختار صور<input type="file" accept="image/*" multiple id="qpick" hidden></label>
        <span class="muted" id="qcount"></span>
      </div>
      <div id="qstage"></div>
      <div class="qgrid" id="qgrid"></div>
    </div>`);
  const addFiles = async files => {
    for (const f of files) {
      const it = { id: ++qid, status: 'pending', image: null, product: null, error: null, transcript: '' };
      quick.items.push(it);
      try { it.image = await compressImage(f, 1000); } catch { it.status = 'error'; it.error = 'ما قدرنا نقرا الصورة'; }
    }
    if (quick.current < 0 || quick.items[quick.current]?.status !== 'pending') quick.current = quick.items.findIndex(x => x.status === 'pending');
    drawQuick(canMic);
  };
  $('#qcam').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
  $('#qpick').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
  route.cleanup = () => { stopRecording(true); quick.stream?.getTracks().forEach(t => t.stop()); quick.stream = null; };
  drawQuick(canMic);
}

function drawQuick(canMic) {
  const grid = $('#qgrid'), stage = $('#qstage');
  if (!grid) return;
  const done = quick.items.filter(x => x.status === 'saved').length;
  $('#qcount').textContent = quick.items.length ? `${done} من ${quick.items.length} انسجلوا` : '';
  const cur = quick.items[quick.current];
  const cur$ = ME.tenant.knowledge.currency || '';
  if (!quick.items.length) {
    stage.innerHTML = `<div class="panel empty"><h3>ابدأ بصورة</h3><p>صوّر المنتج أو اختار صور من المعرض، فيك تختار كذا صورة دفعة وحدة.</p>
      <p style="margin-top:10px">مثال على الحكي: <b>"حذاء نايك اير زوم، سعره 85 دولار، القياسات من 40 لـ 45، أسود وأبيض"</b></p></div>`;
  } else if (cur && cur.status === 'pending') {
    const recording = !!quick.rec;
    stage.innerHTML = `
      <div class="panel qstage">
        <img src="${cur.image}" alt="">
        <div class="qside">
          <h2>الصورة ${quick.current + 1}</h2>
          <p class="muted">${recording ? 'عم سجّل… احكي الاسم والسعر والقياسات، وبس تخلص اكبس وقّف.' : 'اكبس المايك واحكي عن هالمنتج.'}</p>
          ${canMic ? `<div class="seg" id="qlang" aria-label="لغة الحكي">
              <button data-l="ar" class="${quick.lang === 'ar' ? 'on' : ''}" ${recording ? 'disabled' : ''}>🎤 عربي</button>
              <button data-l="en" class="${quick.lang === 'en' ? 'on' : ''}" ${recording ? 'disabled' : ''}>🎤 English</button>
            </div>` : ''}
          ${canMic ? `<button class="mic ${recording ? 'on' : ''}" id="qmic" aria-label="${recording ? 'وقّف التسجيل' : 'ابدأ التسجيل'}">${icon(recording ? 'stop' : 'mic')}</button>
            <div class="qtime" id="qtime">${recording ? '0:00' : ''}</div>
            <div class="qlive" id="qlive">${recording ? esc(quick.liveText || '') : ''}</div>` : ''}
          <details ${canMic ? '' : 'open'}><summary>أو اكتب الوصف</summary>
            <textarea id="qtext" rows="3" placeholder="حذاء نايك اير زوم، 85 دولار، قياسات 40-45"></textarea>
            <button class="btn small primary" id="qsend" style="margin-top:6px">سجّل المنتج</button>
          </details>
          <button class="btn ghost small" id="qskip">تخطّي هالصورة</button>
        </div>
      </div>`;
    $('#qmic') && ($('#qmic').onclick = () => quick.rec ? stopRecording() : startRecording(canMic));
    $('#qlang') && ($('#qlang').onclick = e => {
      const b = e.target.closest('button'); if (!b || quick.rec) return;
      quick.lang = b.dataset.l;
      try { localStorage.setItem('voiceLang', quick.lang); } catch {}
      drawQuick(canMic);
    });
    $('#qsend').onclick = () => { const t = $('#qtext').value.trim(); if (t) submitQuick(cur, { text: t }, canMic); };
    $('#qskip').onclick = () => { cur.status = 'skipped'; nextQuick(canMic); };
  } else {
    const pend = quick.items.some(x => x.status === 'pending');
    const working = quick.items.some(x => x.status === 'working');
    stage.innerHTML = `<div class="panel" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:200px"><h2>${working ? 'عم نسجّل آخر المنتجات…' : pend ? 'اختار صورة' : 'خلصنا ✓'}</h2>
      <p class="muted">${working ? 'استنى ثواني.' : `انسجل ${done} منتج. فيك تكبس على أي منتج لتعدّله، أو تضيف صور جديدة.`}</p></div>
      ${!working && done ? '<a class="btn primary" href="#/products">شوف المنتجات</a>' : ''}</div>`;
  }
  grid.innerHTML = quick.items.map((it, i) => {
    const p = it.product;
    const label = it.status === 'saved' ? `<b>${esc(p.name)}</b><span>${p.sale_price ?? p.price ?? ''} ${p.price != null ? esc(p.currency || cur$) : ''}</span>`
      : it.status === 'working' ? '<span>عم يسجّل…</span>'
      : it.status === 'error' ? `<span class="err">${esc(it.error)}</span>`
      : it.status === 'skipped' ? '<span>متخطّاة</span>' : `<span>${i === quick.current ? 'هلق' : 'بالانتظار'}</span>`;
    return `<button class="qitem ${it.status} ${i === quick.current && it.status === 'pending' ? 'cur' : ''}" data-i="${i}">
      ${it.image ? `<img src="${it.image}" alt="">` : ''}<div class="qlabel">${it.status === 'saved' ? '✓ ' : ''}${label}</div></button>`;
  }).join('');
  $$('.qitem').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.i), it = quick.items[i];
    if (it.status === 'saved') return productDialog(it.product);
    if (it.status === 'working') return;
    if (quick.rec) stopRecording(true);
    if (it.status !== 'pending') { it.status = 'pending'; it.error = null; }
    quick.current = i; drawQuick(canMic);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function nextQuick(canMic) {
  const after = quick.items.findIndex((x, i) => i > quick.current && x.status === 'pending');
  quick.current = after >= 0 ? after : quick.items.findIndex(x => x.status === 'pending');
  drawQuick(canMic);
}

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

function startTimer() {
  clearInterval(quick.timer);
  quick.started = Date.now();
  quick.timer = setInterval(() => {
    const s = Math.floor((Date.now() - quick.started) / 1000);
    const el = $('#qtime'); if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= 45) stopRecording();
  }, 250);
}

// أول خيار: التعرّف على الصوت من المتصفح نفسه (مجاني وما بيحتاج أي مفتاح)
// إذا ما اشتغل، منسجّل الصوت ومنبعته للسيرفر
function startRecording(canMic) {
  if (SpeechRec && !quick.srBroken) return startSpeech(canMic);
  return startMediaRec(canMic);
}

function startSpeech(canMic) {
  const item = quick.items[quick.current];
  const sr = new SpeechRec();
  sr.lang = quick.lang === 'en' ? 'en-US' : 'ar-SY';
  sr.continuous = true;
  sr.interimResults = true;
  let finalText = '', interim = '', stopping = false, failed = null;
  const w = { _cancel: false, stop() { stopping = true; try { sr.stop(); } catch {} } };
  quick.liveText = '';
  sr.onresult = e => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    quick.liveText = (finalText + interim).trim();
    const el = $('#qlive'); if (el) el.textContent = quick.liveText;
  };
  sr.onerror = e => {
    if (['network', 'not-allowed', 'service-not-allowed', 'language-not-supported', 'audio-capture'].includes(e.error)) failed = e.error;
  };
  sr.onend = () => {
    // كروم بيوقف لحاله إذا سكتت شوي، فمنكمّل نسمع لحد ما تكبس وقّف
    if (!stopping && !failed) { try { sr.start(); return; } catch {} }
    clearInterval(quick.timer);
    quick.rec = null;
    if (w._cancel) return drawQuick(canMic);
    const text = (finalText + ' ' + interim).trim();
    if (failed && !text) {
      quick.srBroken = true;
      toast(failed === 'not-allowed' ? 'اسمح للمتصفح يستخدم المايك وجرّب كمان مرة.' : 'التعرّف على الصوت بالمتصفح ما اشتغل هون. اكبس المايك كمان مرة لنجرّب طريقة تانية، أو اكتب الوصف.', true);
      return drawQuick(canMic);
    }
    if (!text) { toast('ما سمعت شي. اكبس المايك واحكي أقرب شوي.', true); return drawQuick(canMic); }
    submitQuick(item, { text }, canMic);
  };
  quick.rec = w;
  try { sr.start(); } catch (e) { quick.rec = null; quick.srBroken = true; return startMediaRec(canMic); }
  startTimer();
  drawQuick(canMic);
}

async function startMediaRec(canMic) {
  try {
    if (!quick.stream) quick.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch { return fail(new Error('ما في صلاحية للمايك. اسمح للمتصفح يستخدم المايك وجرّب مرة تانية.')); }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(quick.stream, type ? { mimeType: type } : undefined);
  quick.chunks = [];
  const item = quick.items[quick.current];
  rec.ondataavailable = e => e.data.size && quick.chunks.push(e.data);
  rec.onstop = async () => {
    clearInterval(quick.timer);
    const cancelled = rec._cancel;
    quick.rec = null;
    if (cancelled) { drawQuick(canMic); return; }
    if (Date.now() - quick.started < 800) { toast('التسجيل قصير كتير، اكبس واحكي', true); drawQuick(canMic); return; }
    const blob = new Blob(quick.chunks, { type: rec.mimeType || type || 'audio/webm' });
    const audio = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    submitQuick(item, { audio, lang: quick.lang }, canMic);
  };
  quick.rec = rec;
  rec.start(250);
  startTimer();
  drawQuick(canMic);
}

function stopRecording(cancel = false) {
  if (!quick.rec) return;
  quick.rec._cancel = cancel;
  try { quick.rec.stop(); } catch {}
}

// بنبعت للسيرفر بالخلفية وبننتقل فوراً للصورة الجاية = أسرع
async function submitQuick(item, { audio, text, lang }, canMic) {
  item.status = 'working';
  nextQuick(canMic);
  try {
    const r = await api('/api/products/voice', { method: 'POST', body: { image: item.image, audio, text, lang } });
    item.status = 'saved'; item.product = r.product; item.transcript = r.transcript;
    ME.counts.products++;
    toast(`✓ ${r.product.name}${r.product.price != null ? ' — ' + (r.product.sale_price ?? r.product.price) : ''}`);
  } catch (e) {
    item.status = 'error'; item.error = e.message;
    toast(e.message, true);
  }
  drawQuick(canMic);
}


// ===== تعليم الوكيل أسلوبك من محادثات واتساب =====
let learnFiles = [];
async function viewLearn() {
  await refreshMe();
  const st = await api('/api/style');
  const s = ME.tenant.settings;
  const src = { import: 'من ملفات المحادثات', live: 'من ردودك الجديدة', history: 'من آخر محادثاتك وقت الربط' };
  shell('#/learn', `
    ${mobileTop()}
    <div class="page" style="max-width:860px">
      <div class="page-head">
        <h1>علّم الوكيل أسلوبك</h1>
        <p>الوكيل بيقرا ردودك الحقيقية على زبائنك، وبيرد متلك: نفس اللهجة، والكلمات، وطريقة الإقناع. الأسعار والتوفّر بيضل ياخدهن من المنتجات بس.</p>
      </div>

      <div class="grid stats" style="margin-bottom:14px">
        <div class="panel stat"><b>${st.total}</b><span>رد حقيقي تعلّمه الوكيل</span></div>
        ${Object.entries(st.by).map(([k, n]) => `<div class="panel stat"><b>${n}</b><span>${src[k] || k}</span></div>`).join('')}
      </div>

      <section class="panel">
        <h2>✍️ شخصية المجيب وتعليماتك</h2>
        <p>اكتب للمجيب بكلامك: كيف يتعامل مع الزباين، شو يحكي وشو ما يحكي، وشو شخصيتو. بس تكبس حفظ، بيقرا وبيقلك شو فهم.</p>
        <textarea id="pi" rows="9" placeholder="مثلاً:\n- إنت بياع ابن بلد وخفيف دم\n- رحّب بـ «أهلين وسهلين»\n- إذا حدا سأل عن التوصيل قلّو…">${esc(s.extra_instructions || '')}</textarea>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="pis">${icon('spark')} حفظ وخلّيه يفهم</button></div>
        <div id="pir" class="panel" style="margin-top:12px;white-space:pre-wrap;display:none;background:var(--soft,#f4f7ff)"></div>
      </section>

      <section class="panel">
        <h2>1. استورد محادثاتك من واتساب</h2>
        <p>اختار المحادثات يلي فيها أحسن ردودك على الزبائن. كل ما زادوا، كل ما صار الوكيل أشبه فيك.</p>
        <ol class="how" style="margin-bottom:14px">
          <li>بواتساب على الموبايل افتح محادثة مع زبون.</li>
          <li>اكبس <b>⋮</b> ← <b>المزيد</b> ← <b>تصدير الدردشة</b> ← <b>بدون وسائط</b>. (بالآيفون: اسم الزبون فوق ← <b>تصدير الدردشة</b>)</li>
          <li>احفظ الملف أو ابعته لحالك، وكرّر لعدة محادثات.</li>
          <li>انقل الملفات للكمبيوتر واختارهن هون، فيك تختار كذا ملف سوا (<b>.txt</b> أو <b>.zip</b>).</li>
        </ol>
        <label class="btn primary">${icon('plus')} اختار ملفات المحادثات<input type="file" id="lf" multiple accept=".txt,.zip,text/plain,application/zip" hidden></label>
        <div id="lpick" style="margin-top:14px"></div>
      </section>

      <section class="panel">
        <h2>2. ملخص أسلوبك</h2>
        <p>الذكاء الاصطناعي بيقرا ردودك وبيكتب وصف لأسلوبك، والوكيل بيمشي عليه. فيك تعدّله بإيدك.</p>
        <textarea id="sp" rows="8" placeholder="مثلاً:\n- بيرحب بـ 'أهلين حبيبي' ويختم بـ 'تكرم عيونك'\n- ردوده قصيرة وما بيكتر إيموجي\n- إذا سأل الزبون عن السعر بيذكره مع ميزة المنتج">${esc(s.style_profile || '')}</textarea>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="an" ${st.total < 5 ? 'disabled title="بدنا 5 ردود على الأقل"' : ''}>${icon('spark')} حلّل أسلوبي تلقائياً</button>
          <button class="btn primary" id="sps">حفظ</button>
        </div>
      </section>

      <section class="panel">
        <h2>3. الإعدادات</h2>
        <label class="switch" style="margin:4px 0 12px"><input type="checkbox" id="ue" ${s.use_examples !== false ? 'checked' : ''}><span class="track"></span>الوكيل يقلّد أسلوبي بالردود</label><br>
        <label class="switch" style="margin:4px 0 12px"><input type="checkbox" id="lr" ${s.learn_from_replies !== false ? 'checked' : ''}><span class="track"></span>يتعلّم لحاله من كل رد بردّه أنا (من الموبايل أو من هون)</label><br>
        <label class="switch" style="margin:4px 0 12px"><input type="checkbox" id="lh" ${s.learn_from_history !== false ? 'checked' : ''}><span class="track"></span>يقرا آخر محادثاتي لما أربط الرقم</label>
      </section>

      ${st.samples.length ? `<section class="panel">
        <h2>آخر يلي تعلّمه</h2>
        ${st.samples.map(x => `<div style="padding:10px 0;border-bottom:1px solid var(--line);font-size:14px">
          <div class="muted">👤 ${esc(x.q).slice(0, 160)}</div><div>🗣️ ${esc(x.a).slice(0, 220)}</div></div>`).join('')}
        <div class="row" style="margin-top:12px;gap:8px"><button class="btn small" id="lcln">🧹 شيل الردود يلي ما إلها فايدة</button><button class="btn danger small" id="lclr">امسح كل يلي تعلّمه</button></div>
      </section>` : ''}
    </div>`);

  const saveFlags = async () => {
    await api('/api/settings', { method: 'PUT', body: { settings: { use_examples: $('#ue').checked, learn_from_replies: $('#lr').checked, learn_from_history: $('#lh').checked } } });
    toast('انحفظ');
  };
  ['#ue', '#lr', '#lh'].forEach(id => $(id).onchange = () => saveFlags().catch(fail));
  $('#sps').onclick = e => busy(e.target, async () => {
    await api('/api/settings', { method: 'PUT', body: { settings: { style_profile: $('#sp').value } } });
    toast('انحفظ ملخص أسلوبك');
  });
  $('#an').onclick = e => busy(e.target, async () => {
    toast('عم يقرا ردودك… ممكن ياخد دقيقة');
    const r = await api('/api/style/analyze', { method: 'POST', body: {} });
    $('#sp').value = r.profile;
    toast('✓ انكتب ملخص أسلوبك وانحفظ. فيك تعدّله.');
  });
  $('#pis').onclick = e => busy(e.target, async () => {
    const box = $('#pir'); box.style.display = 'block'; box.textContent = '🤔 عم يقرا تعليماتك…';
    const r = await api('/api/persona', { method: 'POST', body: { text: $('#pi').value } });
    box.textContent = '🤖 ' + r.reply;
    toast('انحفظت التعليمات');
  });
  $('#lcln') && ($('#lcln').onclick = e => busy(e.target, async () => {
    const r = await api('/api/style/clean', { method: 'POST', body: {} });
    toast(r.removed ? `✓ انشال ${r.removed} رد ما إلو فايدة` : 'كلشي نضيف ✓');
    viewLearn();
  }));
  $('#lclr') && ($('#lclr').onclick = async () => {
    if (!confirm('أكيد بدك تمسح كل الردود يلي تعلّمها الوكيل؟')) return;
    try { await api('/api/style?confirm=yes', { method: 'DELETE' }); toast('انمسحوا'); viewLearn(); } catch (e) { fail(e); }
  });

  $('#lf').onchange = async e => {
    const fs = [...e.target.files];
    e.target.value = '';
    if (!fs.length) return;
    const box = $('#lpick');
    box.innerHTML = '<div class="loading">عم نقرا الملفات…</div>';
    try {
      learnFiles = await Promise.all(fs.map(f => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res({ name: f.name, data: fr.result });
        fr.onerror = () => rej(new Error('ما قدرنا نقرا ' + f.name));
        if (/\.zip$/i.test(f.name)) fr.readAsDataURL(f); else fr.readAsText(f, 'utf-8');
      })));
      const r = await api('/api/style/parse', { method: 'POST', body: { files: learnFiles } });
      box.innerHTML = `
        <div class="note ok" style="margin-bottom:12px">لقينا <b>${r.messages}</b> رسالة بـ <b>${r.chats}</b> محادثة.</div>
        <h3 style="margin-bottom:8px">مين أنت بهالمحادثات؟</h3>
        <div style="display:grid;gap:6px;margin-bottom:12px">
          ${r.participants.map(p => `<label style="display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--line);border-radius:8px;cursor:pointer">
            <input type="radio" name="me" value="${esc(p.name)}" ${p.name === r.guess ? 'checked' : ''}>
            <span><b>${esc(p.name)}</b> <small class="muted">— ${p.messages} رسالة، بـ ${p.files} محادثة</small></span></label>`).join('')}
        </div>
        <p class="muted" style="font-size:13px;margin-bottom:10px">غالباً أنت الاسم الموجود بكل المحادثات. (حطّيناه لحاله، تأكد بس.)</p>
        <button class="btn primary" id="limp">علّم الوكيل من هالمحادثات</button>`;
      $('#limp').onclick = ev => busy(ev.target, async () => {
        const me = box.querySelector('input[name=me]:checked')?.value;
        if (!me) throw new Error('اختار اسمك');
        const res = await api('/api/style/import', { method: 'POST', body: { files: learnFiles, me } });
        learnFiles = [];
        toast(`🧠 تعلّم ${res.added} رد جديد${res.found > res.added ? ` (${res.found - res.added} مكرر)` : ''}`);
        viewLearn();
      });
    } catch (err) { box.innerHTML = ''; fail(err); }
  };
}
