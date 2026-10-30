// واتساب جوّا الموقع: متل واتساب ويب بالزبط (المحادثات، الرسائل، الصور، الصوت، والإرسال)
import { state, api, html, raw, ic, icon, esc, toast, fail, readImage, phoneFmt, initials, date, on } from './core.js';

const two = n => String(n).padStart(2, '0');
const hm = ts => { const d = new Date(ts * 1000); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
function dayLabel(ts) {
  const d = new Date(ts * 1000), now = new Date();
  const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  return diff === 0 ? 'اليوم' : diff === 1 ? 'مبارح' : date(ts);
}
const listTime = ts => { if (!ts) return ''; const l = dayLabel(ts); return l === 'اليوم' ? hm(ts) : l; };
const title = c => c.name || (c.phone ? phoneFmt(c.phone) : c.is_group ? 'مجموعة' : c.jid.split('@')[0]);
const linkify = t => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
const avatar = c => c.is_group ? `<span class="avatar wa-av">${'👥'}</span>` : `<span class="avatar wa-av">${esc(initials(c.name && !/^[\d\s+]+$/.test(c.name) ? c.name : '؟'))}</span>`;
const dur = s => s ? `${Math.floor(s / 60)}:${two(s % 60)}` : '';

export async function chats(view) {
  view.title('واتساب', 'كل محادثاتك متل واتساب ويب');
  view.el.classList.add('flush');
  let list = [], counts = {}, search = '', archived = false, cur = null, msgs = [], more = true, loading = false, offset = 0, listMore = true;
  view.html(html`<div class="wa">
    <aside class="wa-list">
      <div class="wa-search"><input class="input" type="search" placeholder="دوّر على اسم أو رقم أو رسالة" data-q></div>
      <div class="wa-tabs"><button class="on" data-arch="0">المحادثات</button><button data-arch="1">المؤرشفة</button></div>
      <div class="wa-items" data-items></div>
    </aside>
    <section class="wa-chat" data-chat><div class="wa-empty">${ic('wa')}<h3>اختار محادثة</h3><p class="muted small" data-stats></p></div></section>
  </div>`);
  const $ = s => view.el.querySelector(s);
  const wrap = () => view.el.querySelector('.wa');

  const paintList = () => {
    const box = $('[data-items]'); if (!box) return;
    if (!list.length) { box.innerHTML = `<div class="wa-none">${search ? 'ما في نتائج' : (counts.chats ? 'ما في محادثات هون' : 'لسا ما وصلت محادثات. إذا ربطت الواتس جديد، المحادثات القديمة بتوصل خلال دقايق.')}</div>`; return; }
    box.innerHTML = list.map(c => `<button class="wa-item ${cur?.jid === c.jid ? 'on' : ''}" data-jid="${esc(c.jid)}">${avatar(c)}
      <span class="wa-mid"><span class="wa-row"><b>${esc(title(c))}</b><small class="${c.unread ? 'hot' : ''}">${listTime(c.last_ts)}</small></span>
      <span class="wa-row"><span class="wa-last">${c.last_from_me ? '✓ ' : ''}${esc(c.last_text || '')}</span>${c.pinned ? '<span class="wa-pin">📌</span>' : ''}${c.unread ? `<span class="wa-badge">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}</span></span></button>`).join('')
      + (listMore ? '<button class="btn btn-ghost btn-block btn-sm" data-list-more>حمّل أكتر</button>' : '');
  };
  const loadList = async (append = false) => {
    try {
      if (!append) offset = 0;
      const r = await api(`/api/v2/wa/chats?q=${encodeURIComponent(search)}&archived=${archived ? 1 : 0}&offset=${offset}&limit=60`);
      if (!view.alive) return;
      counts = r.counts || {};
      list = append ? list.concat(r.chats) : r.chats; listMore = r.chats.length === 60; offset = list.length;
      paintList();
      const st = $('[data-stats]'); if (st) st.textContent = counts.chats ? `${counts.chats.toLocaleString('en-US')} محادثة · ${counts.msgs.toLocaleString('en-US')} رسالة${counts.oldest ? ` · من ${date(counts.oldest)}` : ''}` : '';
    } catch (err) { fail(err); }
  };

  const bubble = (m, c) => {
    if (m.deleted) return `<div class="wa-b ${m.from_me ? 'me' : ''} del"><i>🚫 انحذفت هالرسالة</i><span class="wa-t">${hm(m.ts)}</span></div>`;
    const who = c.is_group && !m.from_me && m.sender_label ? `<div class="wa-who">${esc(m.sender_label)}</div>` : '';
    let body = '';
    const id = esc(m.id);
    if (m.type === 'image' || m.type === 'sticker') body = `<button class="wa-img ${m.type}" data-media="${id}" data-kind="img">${m.thumb ? `<img src="data:image/jpeg;base64,${m.thumb}" alt="">` : `<span class="wa-ph">${m.type === 'sticker' ? 'ملصق' : '📷 صورة'}<br><small>اكبس لتشوفها</small></span>`}</button>`;
    else if (m.type === 'video' || m.type === 'gif') body = `<button class="wa-img" data-media="${id}" data-kind="video">${m.thumb ? `<img src="data:image/jpeg;base64,${m.thumb}" alt="">` : '<span class="wa-ph">🎥 فيديو</span>'}<span class="wa-play">▶</span></button>`;
    else if (m.type === 'voice' || m.type === 'audio') body = `<button class="btn btn-sm wa-audio" data-media="${id}" data-kind="audio">▶ ${m.type === 'voice' ? 'رسالة صوتية' : 'صوت'} ${dur(m.meta?.seconds)}</button>`;
    else if (m.type === 'document') body = `<button class="btn btn-sm wa-doc" data-media="${id}" data-kind="doc">📄 ${esc(m.meta?.file || 'ملف')}</button>`;
    else if (m.type === 'location') body = `<a class="wa-loc" target="_blank" rel="noopener" href="https://maps.google.com/?q=${m.meta?.lat},${m.meta?.lng}">📍 ${esc(m.text || 'موقع')}</a>`;
    else if (m.type === 'contact') body = `<div>👤 ${esc(m.text)}</div>`;
    else if (m.type === 'poll') body = `<div>📊 <b>${esc(m.text)}</b><br>${(m.meta?.options || []).map(o => '• ' + esc(o)).join('<br>')}</div>`;
    else if (m.type === 'call') body = `<div>📞 مكالمة</div>`;
    const cap = m.text && !['location', 'contact', 'poll'].includes(m.type) ? `<div class="wa-txt">${linkify(m.text)}</div>` : '';
    return `<div class="wa-b ${m.from_me ? 'me' : ''}">${who}${body}${cap}<span class="wa-t">${hm(m.ts)}${m.from_me ? ' ✓' : ''}</span></div>`;
  };
  const paintMsgs = (keepScroll = false) => {
    const box = $('[data-msgs]'); if (!box || !cur) return;
    const before = box.scrollHeight - box.scrollTop;
    let html2 = more ? '<button class="btn btn-sm wa-older" data-older>رسائل أقدم</button>' : (msgs.length ? '<div class="wa-day">بداية المحادثة المحفوظة</div>' : '');
    let lastDay = '';
    for (const m of msgs) { const d = dayLabel(m.ts); if (d !== lastDay) { html2 += `<div class="wa-day">${d}</div>`; lastDay = d; } html2 += bubble(m, cur); }
    if (!msgs.length) html2 += '<div class="wa-day">ما في رسائل محفوظة بهالمحادثة لسا</div>';
    box.innerHTML = html2;
    box.scrollTop = keepScroll ? box.scrollHeight - before : box.scrollHeight;
  };
  const openChat = async jid => {
    cur = list.find(c => c.jid === jid) || { jid, name: '', phone: '', is_group: jid.endsWith('@g.us') };
    wrap().classList.add('show-chat'); paintList();
    $('[data-chat]').innerHTML = `<header class="wa-head"><button class="btn btn-ghost btn-icon wa-back" data-back aria-label="رجوع">${icon('back')}</button>${avatar(cur)}
      <span class="grow"><b>${esc(title(cur))}</b><br><small class="muted ltr">${cur.phone ? esc(phoneFmt(cur.phone)) : cur.is_group ? 'مجموعة' : ''}</small></span></header>
      <div class="wa-msgs" data-msgs><div class="wa-day">عم يحمّل…</div></div>
      <form class="wa-compose" data-send><label class="btn btn-ghost btn-icon" title="ابعت صورة">${icon('camera')}<input type="file" accept="image/*" data-img hidden></label>
        <textarea class="input" name="t" rows="1" placeholder="اكتب رسالة" dir="auto"></textarea><button class="btn btn-primary btn-icon" type="submit" aria-label="ابعت">${icon('send')}</button></form>`;
    try {
      const r = await api(`/api/v2/wa/messages?jid=${encodeURIComponent(jid)}&limit=50`);
      if (!view.alive || cur?.jid !== jid) return;
      cur = { ...cur, ...r.chat, name: r.chat.name || cur.name }; msgs = r.messages; more = msgs.length === 50; paintMsgs();
      if (list.find(c => c.jid === jid)?.unread) { api('/api/v2/wa/read', { method: 'POST', body: { jid } }).catch(() => {}); const c = list.find(c => c.jid === jid); if (c) c.unread = 0; paintList(); }
    } catch (err) { fail(err); }
  };
  const refreshChat = async () => {
    if (!cur) return;
    try {
      const r = await api(`/api/v2/wa/messages?jid=${encodeURIComponent(cur.jid)}&limit=50`);
      if (!view.alive) return;
      const known = new Set(msgs.map(m => m.id)); const fresh = r.messages.filter(m => !known.has(m.id));
      if (fresh.length) { msgs = msgs.concat(fresh).sort((a, b) => a.ts - b.ts); const box = $('[data-msgs]'); const atEnd = box && box.scrollHeight - box.scrollTop - box.clientHeight < 120; paintMsgs(!atEnd); if (atEnd) box.scrollTop = box.scrollHeight; }
    } catch {}
  };

  await loadList();
  if (view.query.jid) openChat(view.query.jid);

  let qt = null;
  view.on('input', '[data-q]', (e, i) => { clearTimeout(qt); qt = setTimeout(() => { search = i.value.trim(); loadList(); }, 300); });
  view.on('click', '[data-arch]', (e, b) => { archived = b.dataset.arch === '1'; view.el.querySelectorAll('[data-arch]').forEach(x => x.classList.toggle('on', x === b)); loadList(); });
  view.on('click', '[data-list-more]', () => loadList(true));
  view.on('click', '[data-jid]', (e, b) => openChat(b.dataset.jid));
  view.on('click', '[data-back]', () => { wrap().classList.remove('show-chat'); cur = null; paintList(); });
  view.on('click', '[data-older]', async (e, b) => {
    if (loading || !cur || !msgs.length) return; loading = true; b.textContent = 'عم يحمّل…';
    try { const r = await api(`/api/v2/wa/messages?jid=${encodeURIComponent(cur.jid)}&before=${msgs[0].ts}&limit=50`); msgs = r.messages.concat(msgs); more = r.messages.length === 50; paintMsgs(true); }
    catch (err) { fail(err); } finally { loading = false; }
  });
  view.on('click', '[data-media]', async (e, b) => {
    if (b.dataset.busy) return; b.dataset.busy = '1';
    const kind = b.dataset.kind, old = b.innerHTML;
    if (kind !== 'img' && kind !== 'video') b.textContent = 'عم ينزّل…';
    try {
      const { url } = await api('/api/v2/wa/media', { method: 'POST', body: { jid: cur.jid, id: b.dataset.media } });
      if (kind === 'img') b.outerHTML = `<a class="wa-img full" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt=""></a>`;
      else if (kind === 'video') b.outerHTML = `<video class="wa-video" src="${url}" controls autoplay playsinline></video>`;
      else if (kind === 'audio') b.outerHTML = `<audio class="wa-aud" src="${url}" controls autoplay></audio>`;
      else { b.innerHTML = old; delete b.dataset.busy; window.open(url, '_blank', 'noopener'); }
    } catch (err) { b.innerHTML = old; delete b.dataset.busy; fail(err); }
  });
  const send = async (body, form) => {
    try { await api('/api/v2/wa/send', { method: 'POST', body: { jid: cur.jid, ...body } }); if (form) form.t.value = ''; setTimeout(refreshChat, 900); setTimeout(() => loadList(), 1500); }
    catch (err) { fail(err); }
  };
  view.on('submit', '[data-send]', (e, f) => { e.preventDefault(); const t = f.t.value.trim(); if (t && cur) send({ text: t }, f); });
  view.on('keydown', '[data-send] textarea', (e, t) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); t.form.requestSubmit(); } });
  view.on('change', '[data-img]', async (e, inp) => { const f = inp.files?.[0]; if (!f || !cur) return; try { const image = await readImage(f, 1600); toast('عم تنبعت الصورة…', 'info'); await send({ image, text: $('[data-send]')?.t.value.trim() || '' }, $('[data-send]')); } catch (err) { fail(err); } inp.value = ''; });

  let rt = null;
  view.sub('wa_msg', d => { clearTimeout(rt); rt = setTimeout(() => { loadList(); if (cur && (!d?.jids || d.jids.includes(cur.jid))) refreshChat(); }, 600); });
  view.every(30000, () => loadList());
}
