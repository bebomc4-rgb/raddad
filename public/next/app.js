// K FAST AI — الهيكل: الراوتر، القائمة الجانبية/السفلية، وتحميل الصفحات
import { state, api, html, raw, setHTML, str, icon, ic, on, connectLive, disconnectLive, toast, fail, modal, setTheme, themePref, initials, esc, avatarHTML, displayName } from './core.js';

const ROUTES = [
  ['/', () => import('./p-public.js').then(m => m.landing), { public: true, bare: true }],
  ['/login', () => import('./p-public.js').then(m => m.login), { public: true, bare: true }],
  ['/register', () => import('./p-public.js').then(m => m.register), { public: true, bare: true }],
  ['/home', () => import('./p-main.js').then(m => m.home)],
  ['/whatsapp', () => import('./p-main.js').then(m => m.whatsapp)],
  ['/whatsapp/settings', () => import('./p-main.js').then(m => m.waSettings)],
  ['/chats', () => import('./p-wa.js').then(m => m.chats)],
  ['/numbers', () => Promise.resolve(() => go('/numbers/new', true))],
  ['/numbers/new', () => import('./p-numbers.js').then(m => m.numbersNew)],
  ['/numbers/old', () => import('./p-numbers.js').then(m => m.numbersOld)],
  ['/numbers/backup', () => import('./p-numbers.js').then(m => m.backup)],
  ['/bot', () => import('./p-bot.js').then(m => m.overview)],
  ['/bot/inbox', () => import('./p-bot.js').then(m => m.inbox)],
  ['/bot/inbox/:id', () => import('./p-bot.js').then(m => m.inbox)],
  ['/bot/orders', () => import('./p-bot.js').then(m => m.orders)],
  ['/bot/products', () => import('./p-bot.js').then(m => m.products)],
  ['/bot/settings', () => import('./p-bot.js').then(m => m.settings)],
  ['/bot/try', () => import('./p-bot.js').then(m => m.tryout)],
  ['/bot/learn', () => import('./p-bot.js').then(m => m.learn)],
  ['/billing', () => import('./p-billing.js').then(m => m.billing)],
  ['/account', () => import('./p-main.js').then(m => m.account)],
  ['/admin', () => import('./p-admin.js').then(m => m.overview), { admin: true }],
  ['/admin/payments', () => import('./p-admin.js').then(m => m.payments), { admin: true }],
  ['/admin/subscribers', () => import('./p-admin.js').then(m => m.subscribers), { admin: true }],
  ['/admin/prices', () => import('./p-admin.js').then(m => m.prices), { admin: true }],
  ['/admin/settings', () => import('./p-admin.js').then(m => m.platform), { admin: true }],
  ['/admin/alerts', () => import('./p-admin.js').then(m => m.alerts), { admin: true }],
  ['/admin/tools', () => import('./p-admin.js').then(m => m.tools), { admin: true }]
].map(([path, load, opt = {}]) => ({ path, load, ...opt, re: new RegExp('^' + path.replace(/:(\w+)/g, '([^/]+)') + '$'), keys: [...path.matchAll(/:(\w+)/g)].map(m => m[1]) }));

function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, '') || '/');
  const [p, qs] = h.split('?');
  return { path: p.replace(/\/+$/, '') || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export const go = (path, replace = false) => { const h = '#' + path; if (replace) location.replace(h); else location.hash = h; };

export async function loadMe() {
  try { state.me = await api('/api/v2/me', { quiet: true }); } catch (e) { if (e.status === 401) state.me = null; else throw e; }
  return state.me;
}

// ===== القائمة =====
function navItems(me) {
  const c = me.counts || {}, bot = me.responder || {};
  const items = [
    { group: null, links: [
      { href: '/home', label: 'الرئيسية', icon: 'home' },
      { href: '/whatsapp', label: 'ربط واتساب', icon: 'wa', dot: me.wa?.status !== 'open' } ] },
    { group: 'الخدمات', links: [
      { href: '/chats', label: 'واتساب', icon: 'wa' },
      { href: '/bot', label: 'المجيب الذكي', icon: 'bot', badge: (c.unread || 0) + (c.needs_human || 0) || 0 },
      { href: '/numbers/new', label: 'حفظ كل رقم جديد', icon: 'book' },
      { href: '/numbers/old', label: 'الأرقام القديمة', icon: 'history' } ] },
    { group: 'حسابي', links: [
      { href: '/billing', label: 'مدفوعاتي', icon: 'card', badge: c.pending_payments ? '•' : 0 },
      { href: '/account', label: 'الملف الشخصي', icon: 'user' } ] }
  ];
  if (me.user.is_super) items.push({ group: 'الإدارة', links: [
    { href: '/admin', label: 'نظرة عامة', icon: 'chart' },
    { href: '/admin/payments', label: 'طلبات الدفع', icon: 'shield', badge: state.adminBadge || 0 },
    { href: '/admin/subscribers', label: 'المشتركين', icon: 'users' },
    { href: '/admin/prices', label: 'الأسعار والباقات', icon: 'tag' },
    { href: '/admin/settings', label: 'إعدادات المنصة', icon: 'sliders' },
    { href: '/admin/alerts', label: 'تنبيهات التجربة', icon: 'bell' },
    { href: '/admin/tools', label: 'أدواتي الخاصة', icon: 'tool' } ] });
  return items;
}
let HREFS = [];
const best = path => HREFS.filter(h => h === path || (h !== '/home' && path.startsWith(h + '/'))).sort((a, b) => b.length - a.length)[0];
const active = (href, path) => best(path) === href;
const badge = b => (b ? `<span class="badge">${b === '•' ? '' : esc(b > 99 ? '99+' : b)}</span>` : '');

function renderSide(me, path) {
  HREFS = navItems(me).flatMap(g => g.links.map(l => l.href));
  const groups = navItems(me).map(g => `${g.group ? `<div class="nav-group">${esc(g.group)}</div>` : ''}${g.links.map(l => {
    const on = active(l.href, path);
    const subs = l.subs && path.startsWith(l.href) ? l.subs.map(s => `<a class="sub ${s.href === path || path.startsWith(s.href + '/') ? 'on' : ''}" href="#${s.href}">${esc(s.label)}${badge(s.badge)}</a>`).join('') : '';
    return `<a class="${on ? 'on' : ''}" href="#${l.href}">${icon(l.icon)}<span>${esc(l.label)}</span>${l.dot ? '<span class="dot" style="margin-inline-start:auto;background:var(--warn)"></span>' : badge(l.badge)}</a>${subs}`;
  }).join('')}`).join('');
  return `<aside class="side">
    <a class="brand" href="#/home"><img src="/icon.svg" alt=""><span><b>K FAST AI</b><small>واتسابك بيشتغل عنك</small></span></a>
    <nav class="nav">${groups}</nav>
    <div class="side-foot"><a class="row grow" href="#/account" style="gap:10px;min-width:0" title="الملف الشخصي">${avatarHTML(me)}
      <span class="grow" style="min-width:0"><b style="display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(displayName(me))}</b><span class="tiny faint">الملف الشخصي</span></span></a>
      <button class="btn btn-ghost btn-icon btn-sm" data-theme-toggle title="الوضع الليلي/النهاري">${icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-logout-now title="تسجيل الخروج">${icon('out')}</button></div>
  </aside>`;
}
function renderTabs(me, path) {
  const c = me.counts || {};
  const tabs = [
    { href: '/home', label: 'الرئيسية', icon: 'home' },
    { href: '/numbers/new', label: 'الأرقام', icon: 'book', base: '/numbers' },
    { href: '/bot', label: 'المجيب', icon: 'bot', badge: (c.unread || 0) + (c.needs_human || 0) },
    me.user.is_super ? { href: '/admin', label: 'الإدارة', icon: 'shield', badge: state.adminBadge || 0 } : { href: '/billing', label: 'اشتراكاتي', icon: 'card' },
    { href: '#more', label: 'المزيد', icon: 'grid' }
  ];
  return `<nav class="tabbar">${tabs.map(t => `<a href="${t.href === '#more' ? '#' : '#' + t.href}" ${t.href === '#more' ? 'data-more' : ''} class="${t.href !== '#more' && (path === t.href || path.startsWith((t.base || t.href) + '/') || (t.href !== '/home' && path === t.base)) ? 'on' : ''}">${icon(t.icon)}<span>${esc(t.label)}</span>${t.badge ? `<span class="badge">${t.badge > 99 ? '99+' : t.badge}</span>` : ''}</a>`).join('')}</nav>`;
}
function openMore() {
  const me = state.me; if (!me) return;
  const links = navItems(me).flatMap(g => g.links.flatMap(l => [l, ...(l.subs || []).map(s => ({ ...s, icon: l.icon }))]));
  const theme = themePref();
  modal({
    title: 'كل الأقسام',
    body: html`<div class="more-grid">${links.map(l => html`<a href="#${l.href}" data-close>${ic(l.icon)}<span>${l.label}</span></a>`)}</div>
      <div class="divider" style="margin:18px 0"></div>
      <div class="row between"><span class="lbl">شكل الواجهة</span><div class="seg" data-theme-seg>${[['auto', 'تلقائي'], ['dark', 'ليلي'], ['light', 'نهاري']].map(([k, t]) => html`<button data-t="${k}" class="${theme === k ? 'on' : ''}">${t}</button>`)}</div></div>
      <div style="margin-top:16px"><button class="btn btn-danger btn-block" data-logout>${ic('out')} تسجيل خروج</button></div>`,
    onMount(m, close) {
      m.querySelectorAll('[data-close]').forEach(a => a.addEventListener('click', close));
      m.querySelectorAll('[data-theme-seg] button').forEach(b => b.onclick = () => { setTheme(b.dataset.t); m.querySelectorAll('[data-theme-seg] button').forEach(x => x.classList.toggle('on', x === b)); });
      m.querySelector('[data-logout]').onclick = () => { close(); logout(); };
    }
  });
}
function openUserMenu() {
  const me = state.me; if (!me) return;
  modal({
    title: 'حسابي',
    body: html`<div class="row" style="gap:14px;margin-bottom:16px">${raw(avatarHTML(me, 'lg'))}<span><b style="font-size:17px">${displayName(me)}</b><br><span class="small muted ltr">${(me.user.phone || me.user.email || '') === displayName(me) ? '' : (me.user.phone || me.user.email || '')}</span></span></div>
      <div class="stack" style="gap:10px"><a class="btn btn-block" href="#/account" data-close>${ic('user')} الملف الشخصي</a>
      <button class="btn btn-danger btn-block" data-logout>${ic('out')} تسجيل الخروج</button></div>`,
    onMount(m, close) {
      m.querySelectorAll('[data-close]').forEach(a => a.addEventListener('click', close));
      m.querySelector('[data-logout]').onclick = () => { close(); logout(); };
    }
  });
}
export async function logout() {
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch {}
  state.me = null; disconnectLive(); go('/login');
}

// ===== الصفحة الحالية =====
let current = null, renderSeq = 0;
function makeView(main, route, params, query) {
  const cleanups = [];
  const el = main.querySelector('.content') || main.querySelector('.bare-in');
  const v = {
    el, params, query, route: route.path, alive: true,
    title(t, sub = '', back = '') {
      const tb = main.querySelector('.topbar');
      if (!tb) return;
      tb.innerHTML = `${back ? `<a class="btn btn-ghost btn-icon back" href="#${back}" aria-label="رجوع">${icon('back')}</a>` : ''}<div class="grow"><h1>${esc(t)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div><div class="row nowrap" data-actions></div><button class="me-btn" data-user-menu aria-label="حسابي">${avatarHTML(state.me)}</button>`;
      document.title = `${t} — K FAST AI`;
    },
    actions(t) { const a = main.querySelector('[data-actions]'); if (a) a.innerHTML = str(t); return a; },
    html(t) { setHTML(el, t); el.classList.remove('page-in'); void el.offsetWidth; el.classList.add('page-in'); return el; },
    on(type, sel, fn) {
      const h = e => { const t = e.target.closest?.(sel); if (t && main.contains(t)) fn(e, t); };
      main.addEventListener(type, h); cleanups.push(() => main.removeEventListener(type, h));
    },
    sub(type, fn) { cleanups.push(on(type, fn)); },
    every(ms, fn) { const id = setInterval(() => { if (v.alive) fn(); }, ms); cleanups.push(() => clearInterval(id)); },
    cleanup(fn) { cleanups.push(fn); },
    destroy() { v.alive = false; cleanups.splice(0).forEach(f => { try { f(); } catch {} }); }
  };
  return v;
}

async function router() {
  const seq = ++renderSeq;
  const { path, query } = parseHash();
  let route = ROUTES.find(r => r.re.test(path));
  if (!route) { go(state.me ? '/home' : '/', true); return; }
  const params = Object.fromEntries(route.keys.map((k, i) => [k, path.match(route.re)[i + 1]]));
  if (state.me === null && !route.public) { await loadMe().catch(() => {}); }
  if (seq !== renderSeq) return;
  if (!route.public && !state.me) { go('/login?next=' + encodeURIComponent(path), true); return; }
  if (state.me && (path === '/' || path === '/login' || path === '/register') && !query.stay) { go(query.next || '/home', true); return; }
  if (route.admin && !state.me.user.is_super) { go('/home', true); return; }

  current?.destroy();
  const app = document.getElementById('app');
  document.body.classList.toggle('app', !route.bare);
  let main;
  if (route.bare) { app.innerHTML = '<main class="bare"><div class="bare-in"></div></main>'; main = app.firstElementChild; }
  else {
    if (!app.querySelector('.shell')) app.innerHTML = '<div class="shell"><div data-side></div><main class="main"><header class="topbar"></header><div data-imp></div><div data-subnav></div><div class="content"></div></main><div data-tabs></div></div>';
    paintNav(path);
    main = app.querySelector('.main');
    main.querySelector('.content').className = 'content';
  }
  const view = makeView(main, route, params, query);
  current = view;
  if (!route.bare) { view.title(''); view.html(html`<div class="stack"><div class="skel" style="height:120px"></div><div class="grid g2"><div class="skel" style="height:160px"></div><div class="skel" style="height:160px"></div></div></div>`); }
  try {
    const page = await route.load();
    if (seq !== renderSeq) return;
    await page(view);
  } catch (e) {
    if (seq !== renderSeq || !view.alive) return;
    console.error(e);
    if (e.status === 401) return;
    view.html(html`<div class="card"><div class="empty"><div class="ico">${ic('alert')}</div><h3>ما قدرنا نفتح الصفحة</h3><p>${e.message || 'صار خطأ'}</p><button class="btn btn-primary" data-retry>جرّب كمان مرة</button></div></div>`);
    view.on('click', '[data-retry]', () => router());
  }
  window.scrollTo({ top: 0 });
}

export function paintNav(path = parseHash().path) {
  const app = document.getElementById('app'), me = state.me;
  if (!me || !app.querySelector('.shell')) return;
  app.querySelector('[data-side]').innerHTML = renderSide(me, path);
  app.querySelector('[data-tabs]').innerHTML = renderTabs(me, path);
  const sn = app.querySelector('[data-subnav]');
  if (sn) {
    const BOT = [['/bot', 'التشغيل والاشتراك'], ['/bot/inbox', 'المحادثات'], ['/bot/orders', 'الطلبات'], ['/bot/products', 'المنتجات'], ['/bot/settings', 'الشخصية'], ['/bot/learn', 'علّم المجيب'], ['/bot/try', 'جرّبو']];
    const cur = BOT.filter(([h]) => path === h || path.startsWith(h + '/')).sort((a, b) => b[0].length - a[0].length)[0]?.[0];
    sn.innerHTML = path === '/bot' || path.startsWith('/bot/') ? `<nav class="subnav">${BOT.map(([h, t]) => `<a href="#${h}" class="${h === cur ? 'on' : ''}">${esc(t)}</a>`).join('')}</nav>` : '';
  }
  const imp = app.querySelector('[data-imp]');
  if (imp) imp.innerHTML = me.impersonating ? `<div class="imp-bar">${icon('user')}<span class="grow">إنت داخل على حساب <b>${esc(me.tenant.name)}</b></span><button class="btn btn-sm" data-back-admin>ارجع لحسابي</button></div>` : '';
}

// تحديث خفيف لملخص الحساب (العدادات والحالة) بدون ما نعيد الصفحة
let meT = null;
export function refreshMe(delay = 400) {
  clearTimeout(meT);
  meT = setTimeout(async () => { if (!state.me) return; try { await loadMe(); paintNav(); } catch {} }, delay);
}

// ===== أحداث عامة =====
document.addEventListener('click', e => {
  if (e.target.closest('[data-more]')) { e.preventDefault(); openMore(); }
  if (e.target.closest('[data-user-menu]')) { e.preventDefault(); openUserMenu(); }
  if (e.target.closest('[data-logout-now]')) { e.preventDefault(); logout(); }
  if (e.target.closest('[data-back-admin]')) { e.preventDefault(); api('/api/v2/back-to-admin', { method: 'POST', body: {} }).then(() => { location.hash = '#/admin/subscribers'; location.reload(); }).catch(fail); }
  const tt = e.target.closest('[data-theme-toggle]');
  if (tt) { const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; setTheme(next); tt.innerHTML = icon(next === 'light' ? 'moon' : 'sun'); }
});
window.addEventListener('hashchange', router);
on('wa', d => { if (state.me) { state.me.wa = d; paintNav(); } });
on('message', () => refreshMe(1500));
on('contact', () => refreshMe(1500));
on('order', d => { toast('🛒 وصل طلب جديد' + (d?.order?.customer_name ? ` من ${d.order.customer_name}` : ''), 'info'); refreshMe(); });
on('handoff', () => { toast('🙋 في زبون طالب يحكي مع موظف', 'info'); refreshMe(); });
on('notice', d => d?.text && toast(d.text, 'info', 6000));

(async function boot() {
  setTheme(themePref());
  try { await loadMe(); } catch {}
  if (state.me) connectLive();
  if (state.me?.user.is_super) api('/api/admin/v2/overview').then(o => { state.adminBadge = o.pending_payments; paintNav(); }).catch(() => {});
  router();
})();
export { router };
