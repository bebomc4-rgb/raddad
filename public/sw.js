// Service worker: بيخلي التطبيق ينفتح بسرعة وينزل على الشاشة الرئيسية
const CACHE = 'kfast-v25';
const SHELL = ['/', '/app.css', '/app.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhook/')) return;
  // ملفات عليها رقم نسخة (?v=) أو صور: من المحفوظ فوراً (ما بتتغيّر أبداً)
  if (url.searchParams.has('v') || url.pathname.startsWith('/uploads/')) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }))));
    return;
  }
  // الشبكة أولاً، والنسخة المحفوظة إذا ما في نت
  e.respondWith(
    (e.request.mode === 'navigate' ? fetch(e.request) : fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })).then(res => {
      if (res.ok && (SHELL.includes(url.pathname) || url.pathname.startsWith('/uploads/'))) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});
