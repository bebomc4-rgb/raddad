// أساسيات الواجهة: قوالب آمنة، API، رسائل، نوافذ، أيقونات، وتنسيق
export const state = { me: null, catalog: null, route: null };

// ===== قوالب HTML آمنة =====
const RAW = Symbol('raw');
export const raw = s => ({ [RAW]: String(s ?? '') });
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const val = v => v == null || v === false ? '' : Array.isArray(v) ? v.map(val).join('') : typeof v === 'object' && RAW in v ? v[RAW] : esc(v);
export function html(strings, ...vals) { let o = ''; strings.forEach((s, i) => { o += s; if (i < vals.length) o += val(vals[i]); }); return raw(o); }
export const str = t => (t && typeof t === 'object' && RAW in t ? t[RAW] : esc(t));
export function setHTML(el, t) { el.innerHTML = str(t); return el; }

// ===== API =====
export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
export async function api(path, { method = 'GET', body, quiet = false } = {}) {
  let res;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch { throw new ApiError('ما في اتصال بالسيرفر. تأكد من النت وجرّب كمان مرة.', 0); }
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) {
    const e = new ApiError(data?.error || (res.status >= 500 ? 'صار خطأ بالسيرفر، جرّب بعد شوي' : 'صار خطأ، جرّب كمان مرة'), res.status);
    if (res.status === 401 && !quiet) { state.me = null; if (!/^#\/(login|register)?$/.test(location.hash)) location.hash = '#/login'; }
    throw e;
  }
  return data;
}

// ===== باص أحداث بسيط + بث مباشر من السيرفر =====
const subs = new Map();
export function on(type, fn) { if (!subs.has(type)) subs.set(type, new Set()); subs.get(type).add(fn); return () => subs.get(type)?.delete(fn); }
export function emit(type, data) { for (const fn of subs.get(type) || []) { try { fn(data); } catch (e) { console.error(e); } } }
let ES = null;
export function connectLive() {
  if (ES) return;
  try {
    ES = new EventSource('/api/events');
    for (const t of ['wa', 'message', 'contact', 'order', 'notice', 'handoff', 'agent_error']) ES.addEventListener(t, e => { let d = {}; try { d = JSON.parse(e.data); } catch {} emit(t, d); });
  } catch {}
}
export function disconnectLive() { try { ES?.close(); } catch {} ES = null; }

// ===== رسائل قصيرة =====
export function toast(msg, type = 'ok', ms = 3600) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = (type === 'bad' ? icon('alert') : type === 'info' ? icon('info') : icon('check')) + `<span>${esc(msg)}</span>`;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}
export const fail = e => toast(e?.message || String(e), 'bad', 5200);

// ===== نوافذ =====
export function modal({ title, body, foot, wide = false, onMount, onClose } = {}) {
  const layer = document.getElementById('layer');
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-h"><h3>${str(title)}</h3><button class="btn btn-ghost btn-icon" data-x aria-label="سكّر">${icon('x')}</button></div>
    <div class="modal-b">${str(body)}</div>${foot ? `<div class="modal-f">${str(foot)}</div>` : ''}</div>`;
  layer.appendChild(bd);
  const prev = document.activeElement;
  const close = () => { if (!bd.isConnected) return; bd.remove(); document.removeEventListener('keydown', esc_); onClose?.(); try { prev?.focus(); } catch {} };
  const esc_ = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  bd.addEventListener('mousedown', e => { if (e.target === bd) close(); });
  bd.querySelector('[data-x]').onclick = close;
  const m = bd.querySelector('.modal');
  onMount?.(m, close);
  setTimeout(() => (m.querySelector('[autofocus]') || m.querySelector('input,textarea,select'))?.focus?.(), 60);
  return close;
}
export function confirmBox(text, { ok = 'تأكيد', danger = false, title = 'متأكد؟' } = {}) {
  return new Promise(res => {
    let done = false;
    modal({
      title, body: html`<p class="muted">${text}</p>`,
      foot: html`<button class="btn" data-no>لا، رجوع</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${ok}</button>`,
      onMount(m, close) { m.querySelector('[data-yes]').onclick = () => { done = true; close(); res(true); }; m.querySelector('[data-no]').onclick = () => close(); },
      onClose() { if (!done) res(false); }
    });
  });
}
// زر بيتحول لـ "عم يحمّل" لحد ما تخلص العملية
export async function busy(btn, fn) {
  if (!btn || btn.disabled) return;
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
  try { return await fn(); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
}

// ===== تنسيق =====
const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
export const n = x => Number(x || 0).toLocaleString('en-US');
export function date(ts, withYear = true) { if (!ts) return '—'; const d = new Date(ts * 1000); return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`; }
export function dateTime(ts) { if (!ts) return '—'; const d = new Date(ts * 1000); return `${date(ts, false)}، ${d.toLocaleTimeString('ar-SY-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}`; }
export function ago(ts) {
  if (!ts) return ''; const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return 'هلق'; if (s < 3600) return `قبل ${Math.floor(s / 60)} د`; if (s < 86400) return `قبل ${Math.floor(s / 3600)} س`;
  if (s < 7 * 86400) { const d = Math.floor(s / 86400); return d === 1 ? 'مبارح' : `قبل ${d} أيام`; }
  return date(ts, false);
}
export function left(ts) {
  if (!ts) return ''; const s = ts - Date.now() / 1000;
  if (s <= 0) return 'خلص';
  const d = Math.floor(s / 86400); if (d >= 1) return d === 1 ? 'باقي يوم' : d === 2 ? 'باقي يومين' : d <= 10 ? `باقي ${d} أيام` : `باقي ${d} يوم`;
  const h = Math.ceil(s / 3600); return h <= 1 ? 'باقي أقل من ساعة' : `باقي ${h} ساعات`;
}
export const money = (v, cur = 'USD') => v == null ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}${cur === 'USD' ? '$' : ' ' + cur}`;
export const periodName = m => ({ 0: 'دفعة وحدة', 1: 'شهر', 3: '3 شهور', 6: '6 شهور', 12: 'سنة' }[m] || `${m} شهور`);
export function eta(count, secEach = 2.5) {
  const s = Math.ceil(count * secEach); if (!count) return '';
  if (s < 90) return 'أقل من دقيقتين'; const m = Math.round(s / 60); if (m < 60) return `حوالي ${m} دقيقة`;
  const h = Math.floor(m / 60), r = m % 60; return `حوالي ${h} ساعة${r >= 10 ? ` و${r} دقيقة` : ''}`;
}
export const initials = s => String(s || '؟').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '؟';
// صورة الملف الشخصي (أو أول حروف الاسم إذا ما في صورة)
export const displayName = me => me?.user?.name || me?.tenant?.name || me?.user?.phone || 'حسابي';
export const avatarHTML = (me, cls = '') => {
  const a = me?.user?.avatar;
  if (a) return `<span class="avatar ${cls}"><img src="${esc(a)}" alt=""></span>`;
  const nm = me?.user?.name || me?.tenant?.name || '';
  return `<span class="avatar ${cls}">${nm && !/^[\d\s+]+$/.test(nm) ? esc(initials(nm)) : icon('user')}</span>`;
};
export const phoneFmt = p => { const d = String(p || '').replace(/\D/g, ''); return d ? '+' + d : ''; };

export function copy(text) {
  try { navigator.clipboard.writeText(text); toast('انتسخ'); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast('انتسخ'); }
}
export function readImage(file, maxSide = 1600) {
  return new Promise((res, rej) => {
    if (!file || !/^image\//.test(file.type)) return rej(new Error('لازم تختار صورة'));
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', .85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('ما قدرنا نقرا الصورة')); };
    img.src = url;
  });
}

// ===== الثيم =====
export function setTheme(t) {
  try { localStorage.setItem('kf-theme', t); } catch {}
  const light = t === 'light' || (t === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', light ? '#F4F6FB' : '#070A14');
}
export const themePref = () => { try { return localStorage.getItem('kf-theme') || 'auto'; } catch { return 'auto'; } };

// ===== أيقونات (خطوط بسيطة) =====
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  wa: '<path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.2-4.3A8.5 8.5 0 1 1 20.5 12Z"/><path d="M9 8.6c.2-.5.5-.6.8-.6h.6c.2 0 .4.1.5.4l.8 1.9c.1.2 0 .5-.1.6l-.6.7c.6 1.2 1.6 2.2 2.8 2.8l.7-.6c.2-.1.4-.2.6-.1l1.9.8c.3.1.4.3.4.5v.6c0 .3-.1.6-.6.8-1 .5-2.4.4-3.9-.4a9.3 9.3 0 0 1-3.7-3.7c-.8-1.5-.9-2.9-.4-3.9Z"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v16H6.5A1.5 1.5 0 0 0 5 20.5v-16Z"/><path d="M5 20.5A1.5 1.5 0 0 0 6.5 22H19v-3"/><circle cx="12" cy="9" r="2.3"/><path d="M8.5 15c.5-1.6 1.9-2.6 3.5-2.6s3 1 3.5 2.6"/>',
  bot: '<rect x="4" y="7" width="16" height="12" rx="4"/><path d="M12 3v4"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/><path d="M2 12v3M22 12v3"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20.5l1.3-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 11h7M8.5 14h4"/>',
  bag: '<path d="M5 8h14l-1 12.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20.5L5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  box: '<path d="m3 7.5 9-4.5 9 4.5v9L12 21l-9-4.5v-9Z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5.5 3.5-5.5 3.5v-7Z"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.4 7.5 9.5 4.4-1.1 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.6c2 .7 3.2 2.6 3.5 5.4"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  out: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16 6 12l4-4M6 12h10"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  back: '<path d="m9 6 6 6-6 6"/>',
  fwd: '<path d="m15 6-6 6 6 6"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 20l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8Z"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17.5v.01"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  sparkle: '<path d="M12 3c.5 4.5 3.5 7.5 8 8-4.5.5-7.5 3.5-8 8-.5-4.5-3.5-7.5-8-8 4.5-.5 7.5-3.5 8-8Z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  send: '<path d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z"/><path d="m10 13 4.5-4.5"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z"/>'
};
export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`;
}
export const ic = (name, cls) => raw(icon(name, cls));
