// المجيب الذكي: التحكم، المحادثات، الطلبات، المنتجات، الشخصية، والتجربة
import { state, api, html, ic, n, ago, dateTime, date, left, money, initials, phoneFmt, toast, fail, busy, modal, confirmBox, readImage, str } from './core.js';
import { loadMe, refreshMe, paintNav, go } from './app.js';
import { checkout } from './p-billing.js';
import { responderPill } from './p-main.js';

// ===== التحكم =====
export async function overview(view) {
  view.title('المجيب الذكي', 'بيرد على زباينك باللهجة السورية ٢٤ ساعة');
  const paint = async () => {
    const me = await loadMe(); if (!view.alive) return;
    paintNav();
    const r = me.responder, c = me.counts, linked = me.wa?.status === 'open';
    const gateMsg = r.unlocked && r.enabled && !r.replying ? (r.expired ? 'خلص الاشتراك. جدّد ليرجع يرد.' : r.gate?.message || '') : '';
    view.html(html`<div class="stack">
      ${!linked ? html`<div class="banner">${ic('wa')}<span class="grow">واتسابك مو مربوط، فالمجيب ما فيه يرد هلق.</span><a class="btn btn-sm btn-primary" href="#/whatsapp">اربط</a></div>` : ''}
      <div class="card pad-lg glow">
        <div class="row between">
          <span class="row nowrap"><span class="ico lg blue">${ic('bot')}</span><span><h2>${r.enabled ? 'المجيب شغّال' : 'المجيب مطفي'}</h2><span class="muted small">${r.enabled ? 'بيرد على كل زبون بيراسلك' : 'ما عم يرد على حدا'}</span></span></span>
          ${r.unlocked ? html`<label class="switch" style="transform:scale(1.15)"><input type="checkbox" data-toggle ${r.enabled ? 'checked' : ''}><span></span></label>` : html`<span class="pill plain">${ic('lock')} مقفول</span>`}
        </div>
        <div class="row" style="margin-top:16px">${responderPill(r)}
          ${r.paid ? html`<span class="pill plain">${r.plan_name} · لـ ${date(r.expires_at)}</span>` : r.gate?.code === 'trial' ? html`<span class="pill gold plain">${ic('clock')} ${left(r.gate.ends_at)} من التجربة</span>` : ''}</div>
        ${gateMsg ? html`<div class="note warn" style="margin-top:14px">${ic('alert')}<span class="grow">${gateMsg}</span><a class="btn btn-sm btn-primary" href="#" data-buy-bot>اشترك</a></div>` : ''}
        ${!r.unlocked ? html`<div class="note" style="margin-top:14px">${ic('lock')}<span class="grow">المجيب مقفول. اشترك فيه وبيتفعّل عندك.</span><a class="btn btn-sm btn-primary" href="#" data-buy-bot>اشترك</a></div>` : ''}
      </div>
      <div class="grid g4">
        <div class="card stat"><span class="k">ردود اليوم</span><span class="v num">${n(r.usage?.ai_replies)}</span><span class="tiny faint">بلا حدود</span></div>
        <div class="card stat"><span class="k">رسائل اليوم</span><span class="v num">${n((r.usage?.msgs_in || 0) + (r.usage?.msgs_out || 0))}</span></div>
        <a class="card stat" href="#/bot/inbox"><span class="k">مو مقروءة</span><span class="v num">${n(c.unread)}</span><span class="tiny faint">${n(c.needs_human)} بدهن موظف</span></a>
        <a class="card stat" href="#/bot/orders"><span class="k">طلبات جديدة</span><span class="v num">${n(c.new_orders)}</span></a>
      </div>
      <div class="grid g3">
        ${[['/bot/inbox', 'chat', 'blue', 'المحادثات', 'شوف شو عم يحكي مع زباينك، ورد بإيدك'], ['/bot/orders', 'bag', 'gold', 'الطلبات', 'كل طلب أخدو المجيب، مع الاسم والعنوان'],
           ['/bot/products', 'box', 'violet', 'المنتجات', `${n(c.products)} منتج بيعرفهن المجيب`], ['/bot/settings', 'sliders', 'blue', 'شخصية المجيب', 'اسمو، أسلوبو، ومعلومات متجرك'], ['/bot/learn', 'sparkle', 'gold', 'علّم المجيب', 'علّمو أجوبة متجرك، أو خليه يتعلّم من محادثاتك'],
           ['/bot/try', 'play', 'green', 'جرّبو', 'احكي معو متل زبون قبل ما تشغّلو']].map(([h, i, cl, t, s]) => html`<a class="card row nowrap" href="#${h}"><span class="ico ${cl}">${ic(i)}</span><span class="grow"><b>${t}</b><br><span class="small muted">${s}</span></span>${ic('fwd')}</a>`)}
      </div>
    </div>`);
  };
  await paint();
  view.on('click', '[data-buy-bot]', async (e) => {
    e.preventDefault();
    try { const b = await api('/api/v2/billing'); const plan = (b.plans || []).find(x => x.id !== 'free'); if (!plan) throw new Error('ما في باقة للمجيب لسا'); checkout({ kind: 'plan', id: plan.id, months: 1, onDone: () => location.reload() }); } catch (err) { fail(err); }
  });
  view.on('change', '[data-toggle]', async (e, i) => {
    try { await api('/api/v2/responder', { method: 'PUT', body: { enabled: i.checked } }); toast(i.checked ? 'المجيب اشتغل ✓' : 'المجيب انطفى'); await paint(); }
    catch (err) { fail(err); i.checked = !i.checked; }
  });
}

// ===== المحادثات =====
const who = c => c.name || phoneFmt(c.phone) || 'زبون';
export async function inbox(view) {
  view.title('المحادثات', '', view.params.id ? '/bot/inbox' : '/bot');
  let filter = 'all', q = '', list = [], openId = view.params.id ? Number(view.params.id) : null, thread = null, sending = false;
  const paused = c => c.bot_paused_until > Date.now() / 1000;
  view.html(html`<div class="inbox ${openId ? 'has-thread' : ''}" data-inbox>
    <div class="inbox-list"><div style="padding:12px;border-bottom:1px solid var(--border)" class="stack-sm">
      <input class="input" data-q placeholder="دوّر بالاسم أو الرقم" type="search">
      <div class="seg" data-filter style="align-self:flex-start">${[['all', 'الكل'], ['unread', 'مو مقروءة'], ['human', 'بدهن موظف'], ['paused', 'موقوف']].map(([k, t]) => html`<button data-f="${k}" class="${k === filter ? 'on' : ''}">${t}</button>`)}</div></div>
      <div class="scroll" data-list></div></div>
    <div class="thread" data-thread></div></div>`);
  const listEl = view.el.querySelector('[data-list]'), thEl = view.el.querySelector('[data-thread]'), box = view.el.querySelector('[data-inbox]');
  const drawList = () => {
    listEl.innerHTML = str(list.length ? html`${list.map(c => html`<div class="item ${c.id === openId ? 'on' : ''}" data-open="${c.id}">
      <span class="avatar">${initials(who(c))}</span><span class="grow"><span class="row between nowrap"><span class="t" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${who(c)}</span><span class="tiny faint">${ago(c.last_at)}</span></span>
      <span class="row between nowrap"><span class="s grow">${c.last_message || ''}</span>${c.unread ? html`<span class="pill info plain" style="padding:0 8px">${c.unread}</span>` : ''}${c.needs_human ? html`<span class="pill warn plain" style="padding:0 8px">موظف</span>` : ''}</span></span></div>`)}`
      : html`<div class="empty"><div class="ico">${ic('chat')}</div><p>ما في محادثات${q ? ' بهالبحث' : ' لسا'}.</p></div>`);
  };
  const drawThread = () => {
    box.classList.toggle('has-thread', !!openId);
    if (!openId) { thEl.innerHTML = str(html`<div class="empty" style="margin:auto"><div class="ico">${ic('chat')}</div><p>اختار محادثة من القائمة</p></div>`); return; }
    if (!thread) { thEl.innerHTML = str(html`<div class="empty" style="margin:auto"><div class="progress indet" style="width:160px"><i></i></div></div>`); return; }
    const c = thread.contact;
    thEl.innerHTML = str(html`<div class="thread-h"><a class="btn btn-ghost btn-icon btn-sm" href="#/bot/inbox" data-close-thread aria-label="رجوع">${ic('back')}</a>
        <span class="avatar">${initials(who(c))}</span><span class="grow"><b>${who(c)}</b><br><span class="tiny faint num">${phoneFmt(c.phone)}</span></span>
        ${paused(c) ? html`<button class="btn btn-sm" data-resume>${ic('play')} رجّع المجيب</button>` : html`<button class="btn btn-sm btn-ghost" data-pause>${ic('pause')} وقّف المجيب معو</button>`}</div>
      <div class="thread-b" data-msgs>${thread.messages.map(m => html`<div class="msg ${m.direction === 'in' ? 'in' : 'out'} ${m.sender === 'human' ? 'human' : ''}">${m.media_url && /\.(png|jpe?g|webp|gif)$/i.test(m.media_url) ? html`<img src="${m.media_url}" alt="" loading="lazy">` : ''}${m.body || ''}<span class="meta">${m.direction === 'out' ? (m.sender === 'human' ? 'إنت · ' : 'المجيب · ') : ''}${dateTime(m.created_at)}</span></div>`)}</div>
      ${paused(c) ? html`<div class="note warn" style="margin:0 12px 8px">${ic('pause')}<span>المجيب ساكت مع هالزبون لـ ${dateTime(c.bot_paused_until)}.</span></div>` : ''}
      <form class="thread-f" data-send><textarea class="textarea" name="text" rows="1" placeholder="اكتب رد…" required></textarea><button class="btn btn-primary btn-icon" type="submit" aria-label="إرسال">${ic('send')}</button></form>`);
    const mb = thEl.querySelector('[data-msgs]'); mb.scrollTop = mb.scrollHeight;
  };
  const loadList = async () => { list = await api(`/api/contacts?filter=${filter === 'all' ? '' : filter}&q=${encodeURIComponent(q)}`); if (view.alive) drawList(); };
  const loadThread = async () => { if (!openId) return drawThread(); thread = await api(`/api/contacts/${openId}/messages`); if (view.alive) { drawThread(); const it = list.find(x => x.id === openId); if (it) { it.unread = 0; drawList(); } } };
  await loadList(); drawThread(); if (openId) loadThread().catch(fail);
  let qt = null;
  view.on('input', '[data-q]', (e, i) => { clearTimeout(qt); qt = setTimeout(() => { q = i.value.trim(); loadList().catch(fail); }, 300); });
  view.on('click', '[data-filter] button', (e, b) => { filter = b.dataset.f; view.el.querySelectorAll('[data-filter] button').forEach(x => x.classList.toggle('on', x === b)); loadList().catch(fail); });
  view.on('click', '[data-open]', (e, it) => { openId = Number(it.dataset.open); thread = null; history.replaceState(null, '', `#/bot/inbox/${openId}`); drawList(); drawThread(); loadThread().catch(fail); refreshMe(800); });
  view.on('click', '[data-close-thread]', e => { e.preventDefault(); openId = null; thread = null; history.replaceState(null, '', '#/bot/inbox'); drawThread(); drawList(); });
  view.on('click', '[data-pause]', (e, b) => busy(b, async () => { try { await api(`/api/contacts/${openId}/pause`, { method: 'POST', body: {} }); await loadThread(); toast('المجيب سكت مع هالزبون'); } catch (err) { fail(err); } }));
  view.on('click', '[data-resume]', (e, b) => busy(b, async () => { try { await api(`/api/contacts/${openId}/resume`, { method: 'POST', body: {} }); await loadThread(); toast('رجع المجيب يرد'); } catch (err) { fail(err); } }));
  view.on('keydown', '[data-send] textarea', e => { if (e.key === 'Enter' && !e.shiftKey && !/Android|iPhone/i.test(navigator.userAgent)) { e.preventDefault(); e.target.form.requestSubmit(); } });
  view.on('submit', '[data-send]', async (e, f) => {
    e.preventDefault(); if (sending) return;
    const text = f.text.value.trim(); if (!text) return;
    sending = true;
    await busy(f.querySelector('[type=submit]'), async () => { try { await api(`/api/contacts/${openId}/send`, { method: 'POST', body: { text } }); f.text.value = ''; await loadThread(); } catch (err) { fail(err); } });
    sending = false;
  });
  view.sub('message', d => { if (!view.alive) return; loadList().catch(() => {}); if (openId && (!d?.contact_id || d.contact_id === openId)) loadThread().catch(() => {}); });
  view.sub('contact', () => view.alive && loadList().catch(() => {}));
  view.every(30000, () => loadList().catch(() => {}));
}

// ===== الطلبات =====
const OST = { new: ['جديد', 'info'], confirmed: ['مؤكد', 'ok'], shipped: ['انشحن', 'gold'], done: ['خلص', 'ok'], cancelled: ['ملغي', 'bad'] };
export async function orders(view) {
  view.title('الطلبات', 'كل طلب أخدو المجيب من زباينك', '/bot');
  let st = '';
  const paint = async () => {
    const rows = await api('/api/orders' + (st ? `?status=${st}` : '')); if (!view.alive) return;
    view.html(html`<div class="stack">
      <div class="seg" data-st style="align-self:flex-start">${[['', 'الكل'], ...Object.entries(OST).map(([k, v]) => [k, v[0]])].map(([k, t]) => html`<button data-s="${k}" class="${k === st ? 'on' : ''}">${t}</button>`)}</div>
      ${rows.length ? html`<div class="grid g2">${rows.map(o => html`<div class="card stack-sm">
        <div class="row between"><span><b>${o.customer_name || 'زبون'}</b> <span class="tiny faint">#${o.id}</span><br><span class="small muted num">${o.customer_phone || ''} · ${dateTime(o.created_at)}</span></span><span class="pill ${OST[o.status]?.[1] || ''}">${OST[o.status]?.[0] || o.status}</span></div>
        <div class="list">${o.items.map(i => html`<div class="item" style="padding:8px 0"><span class="grow"><span class="t">${i.name}</span>${i.options ? html` <span class="tag">${i.options}</span>` : ''}</span><span class="num">×${i.qty}</span>${i.price ? html`<span class="num muted">${money(i.price)}</span>` : ''}</div>`)}</div>
        ${o.address ? html`<p class="small"><span class="muted">العنوان:</span> ${o.address}</p>` : ''}${o.notes ? html`<p class="small"><span class="muted">ملاحظات:</span> ${o.notes}</p>` : ''}
        <div class="row between"><b class="price" style="font-size:22px">${o.total ? money(o.total) : ''}</b>
          <select class="select" style="width:auto;min-height:38px" data-ost="${o.id}">${Object.entries(OST).map(([k, v]) => html`<option value="${k}" ${k === o.status ? 'selected' : ''}>${v[0]}</option>`)}</select></div></div>`)}</div>`
        : html`<div class="card"><div class="empty"><div class="ico">${ic('bag')}</div><h3>ما في طلبات${st ? ' بهالحالة' : ' لسا'}</h3><p>أول ما ياخد المجيب طلب من زبون، بيطلعلك هون وبيوصلك إشعار.</p></div></div>`}
    </div>`);
  };
  await paint();
  view.on('click', '[data-st] button', (e, b) => { st = b.dataset.s; paint().catch(fail); });
  view.on('change', '[data-ost]', async (e, s) => { try { await api(`/api/orders/${s.dataset.ost}`, { method: 'PUT', body: { status: s.value } }); toast('انحفظ'); refreshMe(); await paint(); } catch (err) { fail(err); } });
  view.sub('order', () => view.alive && paint().catch(() => {}));
}

// ===== المنتجات =====
export async function products(view) {
  view.title('المنتجات', 'المجيب بيعرف أسعارها وصورها وبيبعتها للزباين', '/bot');
  let q = '', page = 1, items = [], total = 0;
  const load = async (more = false) => {
    const r = await api(`/api/products?q=${encodeURIComponent(q)}&page=${page}`);
    items = more ? items.concat(r.items) : r.items; total = r.total; if (view.alive) draw();
  };
  const draw = () => view.html(html`<div class="stack">
    <div class="row between"><input class="input" style="max-width:360px" data-q type="search" placeholder="دوّر بالاسم أو التصنيف" value="${q}">
      <span class="row"><button class="btn" data-import>${ic('upload')} استيراد</button><button class="btn btn-primary" data-add>${ic('plus')} منتج جديد</button></span></div>
    <span class="small muted">${n(total)} منتج</span>
    ${items.length ? html`<div class="pgrid">${items.map(p => html`<div class="pcard ${p.active ? '' : 'off'}" data-edit="${p.id}">
      <div class="img" style="${p.image_url ? `background-image:url('${encodeURI(p.image_url)}')` : ''}">${p.image_url ? '' : ic('box')}</div>
      <div class="b"><span class="n">${p.name}</span><span class="pr">${p.sale_price ? html`${money(p.sale_price, p.currency || 'USD')} <s class="tiny faint">${money(p.price, p.currency || 'USD')}</s>` : money(p.price, p.currency || 'USD')}</span>${p.category ? html`<span class="tiny faint">${p.category}</span>` : ''}</div></div>`)}</div>
      ${items.length < total ? html`<button class="btn" data-more style="align-self:center">حمّل أكتر</button>` : ''}`
      : html`<div class="card"><div class="empty"><div class="ico">${ic('box')}</div><h3>${q ? 'ما في نتائج' : 'ما في منتجات لسا'}</h3><p>ضيف منتجاتك لحتى يعرف المجيب شو عندك وبقديش.</p><button class="btn btn-primary" data-add>${ic('plus')} ضيف أول منتج</button></div></div>`}
  </div>`);
  await load();
  let qt = null;
  view.on('input', '[data-q]', (e, i) => { clearTimeout(qt); qt = setTimeout(() => { q = i.value.trim(); page = 1; load().catch(fail).then(() => { const x = view.el.querySelector('[data-q]'); x?.focus(); x?.setSelectionRange(x.value.length, x.value.length); }); }, 350); });
  view.on('click', '[data-more]', (e, b) => busy(b, async () => { page++; await load(true); }));
  view.on('click', '[data-add]', () => editProduct(null, () => load()));
  view.on('click', '[data-edit]', (e, c) => editProduct(items.find(p => p.id === Number(c.dataset.edit)), () => load()));
  view.on('click', '[data-import]', () => importProducts(() => load()));
}
function editProduct(p, done) {
  const v = p || { active: 1, currency: 'USD' };
  let img = v.image_url || '';
  modal({
    title: p ? 'تعديل المنتج' : 'منتج جديد', wide: true,
    body: html`<form class="stack" data-pf>
      <div class="row" style="align-items:flex-start;gap:18px">
        <label class="drop" style="width:150px;flex:none;padding:0;overflow:hidden;aspect-ratio:1;display:grid;place-items:center" data-imgbox>${img ? html`<img src="${img}" alt="" style="width:100%;height:100%;object-fit:cover">` : html`<span class="stack-sm" style="align-items:center">${ic('upload')}<span class="small">صورة</span></span>`}<input type="file" accept="image/*" data-img></label>
        <div class="stack grow" style="min-width:240px"><div class="field"><label>الاسم</label><input class="input" name="name" value="${v.name || ''}" required maxlength="300"></div>
          <div class="grid g3"><div class="field"><label>السعر</label><input class="input" name="price" inputmode="decimal" value="${v.price ?? ''}" dir="ltr"></div>
            <div class="field"><label>سعر العرض</label><input class="input" name="sale_price" inputmode="decimal" value="${v.sale_price ?? ''}" dir="ltr"></div>
            <div class="field"><label>العملة</label><select class="select" name="currency">${['USD', 'SYP', 'TRY', 'EUR'].map(c => html`<option ${c === (v.currency || 'USD') ? 'selected' : ''}>${c}</option>`)}</select></div></div></div></div>
      <div class="grid g2"><div class="field"><label>التصنيف</label><input class="input" name="category" value="${v.category || ''}"></div><div class="field"><label>الخيارات (مقاسات، ألوان)</label><input class="input" name="options" value="${v.options || ''}" placeholder="المقاسات 40-45 | الألوان أسود، أبيض"></div></div>
      <div class="field"><label>الوصف</label><textarea class="textarea" name="description" rows="3">${v.description || ''}</textarea></div>
      <div class="grid g2"><div class="field"><label>المخزون</label><input class="input" name="stock" inputmode="numeric" value="${v.stock ?? ''}" dir="ltr"></div><div class="field"><label>رابط المنتج</label><input class="input" name="url" value="${v.url || ''}" dir="ltr"></div></div>
      <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}><span><b>ظاهر للمجيب</b><br><span class="small muted">إذا شلت الصح، المجيب ما بيعرضو على الزباين</span></span></label>
    </form>`,
    foot: html`${p ? html`<button class="btn btn-danger" data-del style="margin-inline-end:auto">${ic('trash')} حذف</button>` : ''}<button class="btn" data-cancel>رجوع</button><button class="btn btn-primary" data-save>حفظ</button>`,
    onMount(m, close) {
      m.querySelector('[data-cancel]').onclick = close;
      m.querySelector('[data-img]').onchange = async e => {
        try { const data = await readImage(e.target.files[0], 1400); const r = await api('/api/upload', { method: 'POST', body: { data } }); img = r.url; m.querySelector('[data-imgbox]').innerHTML = `<img src="${img}" alt="" style="width:100%;height:100%;object-fit:cover"><input type="file" accept="image/*" data-img hidden>`; m.querySelector('[data-img]').onchange = e.target.onchange; } catch (err) { fail(err); }
      };
      m.querySelector('[data-save]').onclick = e => busy(e.currentTarget, async () => {
        const f = m.querySelector('[data-pf]'); if (!f.reportValidity()) return;
        const body = Object.fromEntries(['name', 'price', 'sale_price', 'currency', 'category', 'options', 'description', 'stock', 'url'].map(k => [k, f[k].value]));
        body.active = f.active.checked; body.image_url = img || null;
        try { await api(p ? `/api/products/${p.id}` : '/api/products', { method: p ? 'PUT' : 'POST', body }); close(); toast('انحفظ'); done(); } catch (err) { fail(err); }
      });
      m.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!await confirmBox(`رح ينحذف «${p.name}».`, { ok: 'احذف', danger: true })) return;
        try { await api(`/api/products/${p.id}`, { method: 'DELETE', body: {} }); close(); toast('انحذف'); done(); } catch (err) { fail(err); }
      });
    }
  });
}
function importProducts(done) {
  let mode = 'csv';
  modal({
    title: 'استيراد منتجات',
    body: html`<div class="stack"><div class="seg" data-im><button class="on" data-m="csv">ملف CSV</button><button data-m="url">رابط</button></div><div data-imb></div>
      <label class="check"><input type="checkbox" data-replace><span>امسح المنتجات القديمة قبل الاستيراد</span></label></div>`,
    foot: html`<button class="btn" data-cancel>رجوع</button><button class="btn btn-primary" data-go>استورد</button>`,
    onMount(m, close) {
      let csv = '';
      const paint = () => { m.querySelector('[data-imb]').innerHTML = str(mode === 'csv' ? html`<label class="drop"><span class="stack-sm" style="align-items:center">${ic('file')}<b data-fname>اختار ملف CSV أو Excel محفوظ CSV</b><span class="small muted">أعمدة: name, price, category, description, image_url</span></span><input type="file" accept=".csv,text/csv,.txt" data-csv></label>`
        : html`<div class="field"><label>رابط ملف CSV أو JSON</label><input class="input" data-url dir="ltr" placeholder="https://…"></div>`); };
      paint();
      m.addEventListener('click', e => { const b = e.target.closest('[data-im] button'); if (b) { mode = b.dataset.m; m.querySelectorAll('[data-im] button').forEach(x => x.classList.toggle('on', x === b)); paint(); } });
      m.addEventListener('change', async e => { if (e.target.matches('[data-csv]')) { const f = e.target.files[0]; csv = f ? await f.text() : ''; m.querySelector('[data-fname]').textContent = f?.name || ''; } });
      m.querySelector('[data-cancel]').onclick = close;
      m.querySelector('[data-go]').onclick = e => busy(e.currentTarget, async () => {
        try {
          const body = { replace: m.querySelector('[data-replace]').checked };
          if (mode === 'csv') { if (!csv) throw new Error('اختار ملف أول'); body.csv = csv; } else body.url = m.querySelector('[data-url]').value;
          const r = await api('/api/products/import', { method: 'POST', body });
          close(); toast(`انضاف ${n(r.added)} وتحدّث ${n(r.updated)}`); done();
        } catch (err) { fail(err); }
      });
    }
  });
}

// ===== شخصية المجيب =====
const TABS = [['persona', 'الشخصية'], ['store', 'معلومات المتجر'], ['flow', 'الأوقات والتحويل'], ['adv', 'متقدم']];
export async function settings(view) {
  view.title('شخصية المجيب', 'كيف بيحكي، وشو بيعرف عن متجرك', '/bot');
  const d = await api('/api/v2/bot-settings');
  const s = { ...d.settings }, k = { ...d.knowledge };
  let tab = 'persona', dirty = false;
  const inp = (key, label, opt = {}) => html`<div class="field"><label>${label}</label>${opt.area ? html`<textarea class="textarea" data-s="${key}" rows="${opt.rows || 3}" placeholder="${opt.ph || ''}">${s[key] ?? ''}</textarea>` : html`<input class="input" data-s="${key}" value="${s[key] ?? ''}" placeholder="${opt.ph || ''}" ${opt.ltr ? 'dir=ltr' : ''} ${opt.type ? `type=${opt.type}` : ''}>`}${opt.hint ? html`<span class="hint">${opt.hint}</span>` : ''}</div>`;
  const kin = (key, label, opt = {}) => html`<div class="field"><label>${label}</label>${opt.area ? html`<textarea class="textarea" data-k="${key}" rows="${opt.rows || 3}" placeholder="${opt.ph || ''}">${k[key] ?? ''}</textarea>` : html`<input class="input" data-k="${key}" value="${k[key] ?? ''}" placeholder="${opt.ph || ''}">`}</div>`;
  const tog = (key, label, sub = '') => html`<label class="item" style="cursor:pointer"><span class="grow"><span class="t">${label}</span>${sub ? html`<br><span class="s" style="white-space:normal">${sub}</span>` : ''}</span><span class="switch"><input type="checkbox" data-b="${key}" ${s[key] ? 'checked' : ''}><span></span></span></label>`;
  const draw = () => {
    let body;
    if (tab === 'persona') body = html`<div class="stack"><div class="grid g2">${inp('agent_name', 'اسم المجيب', { ph: 'سارة' })}${inp('tone', 'الأسلوب', { ph: 'ودود ومحترف' })}</div>
      ${inp('goal', 'شو هدفو؟', { area: true, rows: 2 })}${inp('greeting', 'رسالة الترحيب (اختياري)', { area: true, rows: 2, ph: 'أهلين بك بـ…' })}
      ${inp('extra_instructions', 'تعليمات إضافية', { area: true, rows: 4, ph: 'مثلاً: ما تعطي خصم بدون ما تسألني' })}
      <div class="list">${tog('emoji', 'يستعمل إيموجي')}${tog('chatty', 'دمّو خفيف', 'بيفتح سيرة وبيمزح بلطف')}${tog('understand_media', 'بيسمع الصوت وبيشوف الصور')}${tog('send_images', 'بيبعت صور المنتجات')}</div></div>`;
    else if (tab === 'store') body = html`<div class="stack"><div class="grid g2">${kin('business_name', 'اسم المتجر')}${kin('business_type', 'نوع الشغل')}</div>${kin('about', 'عن متجرك', { area: true })}
      <div class="grid g2">${kin('delivery', 'التوصيل والشحن', { area: true, rows: 2 })}${kin('payment', 'طرق الدفع', { area: true, rows: 2 })}</div>
      <div class="grid g2">${kin('location', 'العنوان', { area: true, rows: 2 })}${kin('hours', 'أوقات الدوام', { area: true, rows: 2 })}</div>
      <div class="grid g2">${kin('returns', 'الاسترجاع والتبديل', { area: true, rows: 2 })}${kin('contact', 'أرقام التواصل', { area: true, rows: 2 })}</div>
      ${kin('website', 'الموقع')}${kin('faq', 'أسئلة وأجوبة بتتكرر', { area: true, rows: 6, ph: 'س: في توصيل لحلب؟\nج: إي، بيوصل بيومين' })}</div>`;
    else if (tab === 'flow') body = html`<div class="stack">
      <div class="field"><label>إيمت بيرد؟</label><div class="seg" data-sched>${[['always', 'دايماً'], ['off_hours', 'بس برّا الدوام'], ['work_hours', 'بس وقت الدوام']].map(([v, t]) => html`<button data-v="${v}" class="${s.bot_schedule === v ? 'on' : ''}">${t}</button>`)}</div></div>
      <div class="grid g2">${inp('work_from', 'الدوام من', { type: 'time', ltr: true })}${inp('work_to', 'لـ', { type: 'time', ltr: true })}</div>
      ${inp('human_takeover_minutes', 'لما ترد إنت، بيسكت كم دقيقة؟', { ltr: true, hint: 'مع نفس الزبون بس' })}
      ${inp('handoff_keywords', 'كلمات بتحوّل لموظف', { hint: 'مفصولة بفاصلة' })}
      <div class="grid g2">${inp('notify_number', 'رقمك للإشعارات', { ltr: true, ph: '9639…' })}${inp('owner_numbers', 'أرقامك (صاحب المتجر)', { ltr: true })}</div>
      <div class="list">${tog('notify_orders', 'ابعتلي كل طلب على واتساب')}${tog('typing_indicator', 'بيبيّن «عم يكتب…»')}</div></div>`;
    else body = html`<div class="stack"><div class="list">${tog('test_mode', 'وضع الاختبار', 'بيرد بس على الأرقام يلي تحت')}${tog('use_examples', 'بيتعلّم من ردودك القديمة')}${tog('learn_from_replies', 'بيتعلّم من كل رد بتردّه')}${tog('learn_from_history', 'بيقرا آخر محادثاتك لما تربط')}</div>
      ${inp('test_numbers', 'أرقام الاختبار', { ltr: true })}${inp('ignore_numbers', 'أرقام ما بيرد عليها', { ltr: true })}
      <div class="grid g2">${inp('reply_delay_sec', 'بيستنى قبل الرد (ثواني)', { ltr: true, hint: 'لحتى يجمّع رسائل الزبون' })}${inp('max_images', 'أكتر عدد صور بالرد', { ltr: true })}</div></div>`;
    view.html(html`<div class="stack"><div class="seg" data-tabs style="align-self:flex-start">${TABS.map(([v, t]) => html`<button data-t="${v}" class="${tab === v ? 'on' : ''}">${t}</button>`)}</div>
      <div class="card pad-lg">${body}</div>
      <div class="row end" style="position:sticky;bottom:calc(var(--tabbar) + 14px);z-index:5"><button class="btn btn-primary btn-lg" data-save ${dirty ? '' : 'disabled'}>${ic('check')} حفظ التغييرات</button></div></div>`);
  };
  draw();
  const mark = () => { dirty = true; const b = view.el.querySelector('[data-save]'); if (b) b.disabled = false; };
  view.on('click', '[data-tabs] button', (e, b) => { tab = b.dataset.t; draw(); });
  view.on('input', '[data-s]', (e, i) => { s[i.dataset.s] = i.value; mark(); });
  view.on('input', '[data-k]', (e, i) => { k[i.dataset.k] = i.value; mark(); });
  view.on('change', '[data-b]', (e, i) => { s[i.dataset.b] = i.checked; mark(); });
  view.on('click', '[data-sched] button', (e, b) => { s.bot_schedule = b.dataset.v; view.el.querySelectorAll('[data-sched] button').forEach(x => x.classList.toggle('on', x === b)); mark(); });
  view.on('click', '[data-save]', (e, b) => busy(b, async () => {
    try {
      const num = x => (x === '' || x == null ? x : Number(x));
      const out = { ...s, human_takeover_minutes: num(s.human_takeover_minutes), reply_delay_sec: num(s.reply_delay_sec), max_images: num(s.max_images) };
      await api('/api/settings', { method: 'PUT', body: { settings: out, knowledge: k } }); dirty = false; toast('انحفظ ✓'); draw();
    } catch (err) { fail(err); }
  }));
  const warn = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn); view.cleanup(() => window.removeEventListener('beforeunload', warn));
}

// ===== جرّبو =====
export async function tryout(view) {
  view.title('جرّب المجيب', 'احكي معو متل زبون. ما بيوصل شي على واتساب.', '/bot');
  const convo = [];
  view.html(html`<div class="inbox has-thread" style="grid-template-columns:1fr;max-width:820px;margin:auto"><div class="thread">
    <div class="thread-h"><span class="avatar">${ic('bot')}</span><span class="grow"><b>المجيب</b><br><span class="tiny faint">تجربة</span></span><button class="btn btn-sm btn-ghost" data-reset>${ic('refresh')} من جديد</button></div>
    <div class="thread-b" data-msgs><div class="empty" style="margin:auto"><div class="ico">${ic('chat')}</div><p>اكتب متل ما بيكتبلك زبون، مثلاً: «مرحبا شو عندكن؟»</p></div></div>
    <form class="thread-f" data-send><textarea class="textarea" name="text" rows="1" placeholder="اكتب رسالة…" required></textarea><button class="btn btn-primary btn-icon" type="submit">${ic('send')}</button></form></div></div>`);
  const mb = view.el.querySelector('[data-msgs]');
  const draw = (typing = false) => {
    mb.innerHTML = str(html`${convo.map(m => html`<div class="msg ${m.role === 'user' ? 'in' : 'out'}">${(m.images || []).map(p => html`<img src="${p.image_url}" alt="">`)}${m.content}${m.via ? html`<span class="meta">${m.via}</span>` : ''}</div>`)}${typing ? html`<div class="msg out" style="opacity:.7">…</div>` : ''}`);
    mb.scrollTop = mb.scrollHeight;
  };
  view.on('click', '[data-reset]', () => { convo.length = 0; draw(); });
  view.on('keydown', '[data-send] textarea', e => { if (e.key === 'Enter' && !e.shiftKey && !/Android|iPhone/i.test(navigator.userAgent)) { e.preventDefault(); e.target.form.requestSubmit(); } });
  view.on('submit', '[data-send]', async (e, f) => {
    e.preventDefault(); const text = f.text.value.trim(); if (!text) return;
    convo.push({ role: 'user', content: text }); f.text.value = ''; draw(true);
    try { const r = await api('/api/playground', { method: 'POST', body: { messages: convo.map(({ role, content }) => ({ role, content })) } }); convo.push({ role: 'assistant', content: r.reply, images: r.images, via: r.order ? '🛒 سجّل طلب' : '' }); }
    catch (err) { convo.pop(); fail(err); }
    draw();
  });
}

// ===== علّم المجيب =====
const fileToDataURL = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error('ما قدرت اقرا الملف')); r.readAsDataURL(f); });
export async function learn(view) {
  view.title('علّم المجيب', 'كل شي بتعلّمو ياه بيستعملو بالرد على زباينك', '/bot');
  let tab = 'manual', editing = null, chatFiles = null;
  const draw = async () => {
    const d = await api('/api/v2/learn'); if (!view.alive) return;
    const items = d.items.filter(x => tab === 'manual' ? x.source === 'manual' : x.source !== 'manual');
    view.html(html`<div class="stack" style="max-width:900px">
      <div class="card pad-lg glow">
        <div class="row nowrap"><span class="ico lg gold">${ic('sparkle')}</span><span class="grow"><h2>علّمو متل ما بتعلّم موظف جديد</h2>
          <span class="muted small">اكتب سؤال بيسألو الزبون والجواب الصح، والمجيب بيرد بنفس الطريقة لما حدا يسأل شي متلو. يلي بتعلّمو إنت إلو الأولوية.</span></span></div>
        <div class="grid g3" style="margin-top:16px">
          <div class="card stat flat"><span class="k">علّمتو إنت</span><span class="v num">${n(d.manual)}</span></div>
          <div class="card stat flat"><span class="k">تعلّمو من محادثاتك</span><span class="v num">${n(d.total - d.manual)}</span></div>
          <div class="card stat flat"><span class="k">أسلوبك</span><span class="v" style="font-size:16px">${d.style_profile ? 'محفوظ ✓' : 'لسا'}</span></div>
        </div>
      </div>

      <div class="card pad-lg">
        <div class="card-h"><h3>${ic('chat')} ${editing ? 'عدّل الجواب' : 'علّمو جواب جديد'}</h3></div>
        <form class="stack" data-teach>
          <div class="field"><label>شو بيسأل الزبون؟</label><textarea class="textarea" name="q" rows="2" required maxlength="600" placeholder="متل: في توصيل لحلب؟ / قديش سعر الكرة؟ / وين محلكن؟">${editing?.q || ''}</textarea></div>
          <div class="field"><label>شو لازم يرد المجيب؟</label><textarea class="textarea" name="a" rows="3" required maxlength="1500" placeholder="اكتب الجواب متل ما بتكتبو إنت للزبون">${editing?.a || ''}</textarea></div>
          <div class="row end">${editing ? html`<button type="button" class="btn btn-ghost" data-cancel>إلغاء</button>` : ''}<button class="btn btn-primary" type="submit">${ic('check')} ${editing ? 'احفظ' : 'علّمو'}</button></div>
        </form>
      </div>

      <div class="card pad-lg">
        <div class="row between" style="margin-bottom:12px"><h3>${ic('book')} يلي بيعرفو</h3>
          <div class="seg" data-tabs><button data-t="manual" class="${tab === 'manual' ? 'on' : ''}">علّمتو إنت</button><button data-t="chats" class="${tab === 'chats' ? 'on' : ''}">من محادثاتك</button></div></div>
        ${items.length ? html`<div class="list">${items.slice(0, 150).map(x => html`<div class="item" style="align-items:flex-start">
            <span class="grow" style="min-width:0"><b class="small">🙋 ${x.q}</b><br><span class="small muted">🤖 ${x.a}</span></span>
            <span class="row nowrap">${x.source === 'manual' ? html`<button class="btn btn-ghost btn-icon btn-sm" data-edit="${x.id}" title="عدّل">${ic('edit')}</button>` : ''}<button class="btn btn-ghost btn-icon btn-sm" data-del="${x.id}" title="احذف">${ic('trash')}</button></span></div>`)}</div>`
          : html`<div class="empty"><p class="muted">${tab === 'manual' ? 'لسا ما علّمتو شي. ابدأ بأكتر 5 أسئلة بيسألوها زباينك.' : 'لسا ما تعلّم من محادثاتك. ارفع محادثات من تحت.'}</p></div>`}
      </div>

      <div class="card pad-lg stack">
        <div class="card-h"><h3>${ic('upload')} خليه يتعلّم من محادثاتك القديمة</h3></div>
        <p class="small muted">من واتساب: افتح محادثة مع زبون ← النقاط التلات ← المزيد ← تصدير الدردشة ← بدون وسائط. ارفع الملفات هون (txt أو zip)، والمجيب بيتعلّم كيف بترد وبأي أسلوب.</p>
        <label class="btn">${ic('upload')} اختار ملفات المحادثات<input type="file" accept=".txt,.zip,text/plain,application/zip" multiple data-chats hidden></label>
        <div data-chat-step></div>
        ${d.total >= 5 ? html`<div class="row between"><span class="small muted">${d.style_profile ? 'فيك تعيد تحليل أسلوبك بعد ما تضيف محادثات جديدة.' : 'خلّي المجيب يحلّل أسلوبك ويقلّدو.'}</span><button class="btn btn-sm" data-analyze>${ic('sparkle')} حلّل أسلوبي</button></div>` : ''}
      </div>

      <div class="card pad-lg">
        <div class="card-h"><h3>${ic('mic')} الصوت والصور</h3></div>
        <label class="check"><input type="checkbox" data-media ${d.understand_media ? 'checked' : ''}><span><b>بيفهم الرسائل الصوتية والصور</b><br>
          <span class="small muted">إذا الزبون بعت تسجيل صوت، المجيب بيسمعو وبيرد عليه. وإذا بعت صورة، بيشوف شو فيها وبيرد بطريقة تسويقية وبيقترح أشبه منتج عندك.</span></span></label>
      </div>

      <a class="card row nowrap" href="#/bot/try"><span class="ico green">${ic('play')}</span><span class="grow"><b>جرّب يلي علّمتو</b><br><span class="small muted">احكي معو متل زبون وشوف كيف بيرد</span></span>${ic('fwd')}</a>
    </div>`);
  };
  await draw();
  view.on('click', '[data-tabs] button', (e, b) => { tab = b.dataset.t; draw(); });
  view.on('submit', '[data-teach]', async (e, f) => {
    e.preventDefault();
    await busy(f.querySelector('[type=submit]'), async () => {
      try { await api('/api/v2/learn', { method: 'POST', body: { q: f.q.value, a: f.a.value, id: editing?.id } }); toast(editing ? 'انحفظ ✓' : 'تعلّمها ✓'); editing = null; tab = 'manual'; await draw(); }
      catch (err) { fail(err); }
    });
  });
  view.on('click', '[data-cancel]', () => { editing = null; draw(); });
  view.on('click', '[data-edit]', async (e, b) => {
    const d = await api('/api/v2/learn'); editing = d.items.find(x => x.id === Number(b.dataset.edit)) || null; await draw();
    view.el.querySelector('[data-teach] textarea')?.focus(); window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  view.on('click', '[data-del]', async (e, b) => {
    if (!await confirmBox('رح ينسى هالجواب.', { ok: 'احذف', danger: true })) return;
    try { await api(`/api/v2/learn/${b.dataset.del}`, { method: 'DELETE', body: {} }); toast('انحذف'); await draw(); } catch (err) { fail(err); }
  });
  view.on('change', '[data-media]', async (e, i) => {
    try { await api('/api/settings', { method: 'PUT', body: { settings: { understand_media: i.checked } } }); toast(i.checked ? 'صار يفهم الصوت والصور ✓' : 'انطفى فهم الصوت والصور'); } catch (err) { fail(err); i.checked = !i.checked; }
  });
  view.on('change', '[data-chats]', async (e, inp) => {
    const box = view.el.querySelector('[data-chat-step]');
    try {
      const list = [...inp.files].slice(0, 200);
      if (!list.length) return;
      box.innerHTML = '<p class="small muted">عم اقرا الملفات…</p>';
      chatFiles = await Promise.all(list.map(async f => ({ name: f.name, data: await fileToDataURL(f) })));
      const r = await api('/api/style/parse', { method: 'POST', body: { files: chatFiles } });
      box.innerHTML = str(html`<div class="note" style="flex-direction:column;align-items:stretch;gap:10px"><span>لقيت ${n(r.messages)} رسالة بـ ${n(r.chats)} محادثة. مين إنت بهالمحادثات؟</span>
        <select class="select" data-me>${r.participants.map(p => html`<option value="${p.name}" ${p.name === r.guess ? 'selected' : ''}>${p.name} (${n(p.messages)} رسالة)</option>`)}</select>
        <button class="btn btn-primary" data-import>${ic('check')} تعلّم من ردودي</button></div>`);
    } catch (err) { box.innerHTML = ''; fail(err); }
  });
  view.on('click', '[data-import]', (e, b) => busy(b, async () => {
    try {
      const r = await api('/api/style/import', { method: 'POST', body: { me: view.el.querySelector('[data-me]').value, files: chatFiles } });
      toast(`تعلّم ${n(r.added)} رد جديد من محادثاتك ✓`); chatFiles = null; tab = 'chats'; await draw();
    } catch (err) { fail(err); }
  }));
  view.on('click', '[data-analyze]', (e, b) => busy(b, async () => {
    try { await api('/api/style/analyze', { method: 'POST', body: {} }); toast('حلّل أسلوبك وصار يقلّدو ✓'); await draw(); } catch (err) { fail(err); }
  }));
}
