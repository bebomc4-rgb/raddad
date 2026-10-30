// لوحة صاحب المنصة: نظرة عامة، المدفوعات، المشتركين، الأسعار، الإعدادات، التنبيهات، والأدوات الخاصة
import { state, api, html, ic, n, money, periodName, date, dateTime, ago, left, phoneFmt, toast, fail, busy, modal, confirmBox, str } from './core.js';
import { paintNav } from './app.js';

const PST = { pending: ['ناطر', 'warn'], awaiting_delivery: ['ناطر التسليم', 'warn'], approved: ['تفعّل', 'ok'], rejected: ['مرفوض', 'bad'] };
const SVC = { contacts_new: 'أرقام جديدة', contacts_old: 'أرقام قديمة' };

export async function overview(view) {
  view.title('لوحة الإدارة', 'كلشي عن منصتك بلمحة');
  const [o, pays] = await Promise.all([api('/api/admin/v2/overview'), api('/api/admin/v2/payments')]);
  state.adminBadge = o.pending_payments; paintNav();
  const pending = pays.filter(p => ['pending', 'awaiting_delivery'].includes(p.status)).slice(0, 5);
  const tiles = [
    ['المشتركين', o.tenants, `+${n(o.new_week)} هالأسبوع`, 'users', 'blue', '/admin/subscribers'],
    ['دخل آخر 30 يوم', money(o.revenue_30d), 'من الطلبات المؤكدة', 'card', 'gold', '/admin/payments'],
    ['طلبات دفع ناطرة', o.pending_payments, 'بدها تأكيد منك', 'clock', o.pending_payments ? 'gold' : 'green', '/admin/payments'],
    ['أرقام واتساب مربوطة', o.wa_linked, '', 'wa', 'green', '/admin/subscribers'],
    ['المجيب (مدفوع)', o.responder_paid, '', 'bot', 'blue', '/admin/subscribers'],
    ['أرقام جديدة (شغّال)', o.contacts_new, '', 'book', 'violet', '/admin/subscribers'],
    ['أرقام قديمة (مباعة)', o.contacts_old, '', 'history', 'gold', '/admin/subscribers'],
    ['رسائل اليوم', o.msgs_today, `${n(o.ai_today)} رد ذكي`, 'chat', 'blue', '/admin']
  ];
  view.html(html`<div class="stack">
    <div class="grid g4">${tiles.map(([k, v, s, i, c, h]) => html`<a class="card stat" href="#${h}"><span class="row between"><span class="k">${k}</span><span class="ico ${c}" style="width:34px;height:34px">${ic(i)}</span></span><span class="v num">${typeof v === 'number' ? n(v) : v}</span>${s ? html`<span class="tiny faint">${s}</span>` : ''}</a>`)}</div>
    <div class="grid g2">
      <div class="card pad-lg"><div class="card-h"><h3>${ic('clock')} طلبات دفع ناطرة</h3><a class="linkish small" href="#/admin/payments">الكل</a></div>
        ${pending.length ? html`<div class="list">${pending.map(p => html`<a class="item click" href="#/admin/payments"><span class="avatar">${ic('card')}</span><span class="grow"><span class="t">${p.tenant_name}</span><br><span class="s">${p.name} · ${periodName(p.months)} · ${money(p.amount)}</span></span><span class="pill warn">${p.method || ''}</span></a>`)}</div>`
          : html`<div class="empty"><div class="ico">${ic('check')}</div><p>ما في شي ناطر 👌</p></div>`}</div>
      <div class="card pad-lg"><div class="card-h"><h3>${ic('sparkle')} اختصارات</h3></div>
        <div class="list">${[['/admin/prices', 'tag', 'غيّر الأسعار والباقات'], ['/admin/settings', 'sliders', 'رقم شام كاش والتسجيل'], ['/admin/alerts', 'bell', `تنبيهات التجربة${o.trial_alerts ? ` (${o.trial_alerts})` : ''}`], ['/admin/tools', 'tool', 'أدواتي الخاصة (الاستوديو، الصور، الرابط…)']].map(([h, i, t]) => html`<a class="item click" href="#${h}"><span class="ico">${ic(i)}</span><span class="grow t">${t}</span>${ic('fwd')}</a>`)}</div></div>
    </div></div>`);
}

export async function payments(view) {
  view.title('طلبات الدفع', 'أكّد أو ارفض بكبسة', '/admin');
  let filter = 'open';
  const paint = async () => {
    const all = await api('/api/admin/v2/payments'); if (!view.alive) return;
    const open = all.filter(p => ['pending', 'awaiting_delivery'].includes(p.status));
    state.adminBadge = open.length; paintNav();
    const rows = filter === 'open' ? open : all;
    view.html(html`<div class="stack">
      <div class="seg" data-f style="align-self:flex-start"><button data-v="open" class="${filter === 'open' ? 'on' : ''}">الناطرة (${open.length})</button><button data-v="all" class="${filter === 'all' ? 'on' : ''}">الكل</button></div>
      ${rows.length ? html`<div class="grid g2">${rows.map(p => html`<div class="card stack-sm">
        <div class="row between"><span><b>${p.tenant_name}</b><br><span class="tiny faint ltr">${p.email || ''}</span></span><span class="pill ${PST[p.status]?.[1] || ''}">${PST[p.status]?.[0] || p.status}</span></div>
        <div class="row" style="gap:8px"><span class="tag">${p.name}</span><span class="tag">${periodName(p.months)}</span><b class="price" style="font-size:22px;margin-inline-start:auto">${money(p.amount)}</b></div>
        <div class="row small muted">${p.method || ''}${p.phone ? html` · <span class="num">${p.phone}</span>` : ''} · ${dateTime(p.created_at)}</div>
        ${p.receipt ? html`<a href="${p.receipt}" target="_blank" rel="noopener"><img src="${p.receipt}" alt="إيصال" style="max-height:220px;border-radius:12px;border:1px solid var(--border)"></a>` : ''}
        ${['pending', 'awaiting_delivery'].includes(p.status) ? html`<div class="row end"><button class="btn btn-danger btn-sm" data-act="reject" data-id="${p.id}">رفض</button><button class="btn btn-ok" data-act="approve" data-id="${p.id}">${ic('check')} تأكيد وتفعيل</button></div>` : ''}
      </div>`)}</div>` : html`<div class="card"><div class="empty"><div class="ico">${ic('check')}</div><p>${filter === 'open' ? 'ما في طلبات ناطرة' : 'ما في طلبات'}</p></div></div>`}
    </div>`);
  };
  await paint();
  view.on('click', '[data-f] button', (e, b) => { filter = b.dataset.v; paint(); });
  view.on('click', '[data-act]', async (e, b) => {
    const ok = b.dataset.act === 'approve';
    if (!ok && !await confirmBox('رح ينرفض هالطلب.', { ok: 'رفض', danger: true })) return;
    busy(b, async () => { try { await api(`/api/admin/payments/${b.dataset.id}`, { method: 'POST', body: { action: b.dataset.act } }); toast(ok ? 'تفعّل الاشتراك ✓' : 'انرفض'); await paint(); } catch (err) { fail(err); } });
  });
}

export async function subscribers(view) {
  view.title('المشتركين', '', '/admin');
  let q = '', plans = [];
  const paint = async () => {
    const [rows, pl] = await Promise.all([api('/api/admin/v2/tenants'), plans.length ? plans : api('/api/admin/plans')]); plans = pl;
    if (!view.alive) return;
    const list = rows.filter(t => !q || `${t.name} ${t.email} ${t.wa_phone || ''}`.toLowerCase().includes(q.toLowerCase()));
    view.html(html`<div class="stack">
      <div class="row between"><input class="input" style="max-width:340px" type="search" data-q placeholder="دوّر بالاسم أو الإيميل أو الرقم" value="${q}"><span class="small muted">${n(list.length)} مشترك</span></div>
      <div class="card" style="padding:6px 14px"><div class="table-wrap"><table class="table cards"><thead><tr><th>المشترك</th><th>واتساب</th><th>المجيب</th><th>أرقام جديدة</th><th>أرقام قديمة</th><th>المحفوظ</th><th></th></tr></thead><tbody>
      ${list.map(t => html`<tr>
        <td data-l="المشترك"><b>${t.name}</b>${t.is_super ? html` <span class="pill gold plain">إنت</span>` : ''}${t.status === 'suspended' ? html` <span class="pill bad">موقوف</span>` : ''}<br><span class="tiny faint ltr">${t.email || ''}</span></td>
        <td data-l="واتساب">${t.wa_status === 'open' ? html`<span class="pill ok">${phoneFmt(t.wa_phone)}</span>` : html`<span class="pill plain">${t.wa_status === 'disconnected' ? 'مو مربوط' : t.wa_status}</span>`}</td>
        <td data-l="المجيب">${t.plan_id !== 'free' && t.plan_expires_at > Date.now() / 1000 ? html`<span class="pill ok">${t.plan_id} · ${left(t.plan_expires_at)}</span>` : html`<span class="pill plain">${t.bot_enabled ? 'تجربة/مجاني' : 'مطفي'}</span>`}</td>
        <td data-l="أرقام جديدة">${svcPill(t.services.contacts_new)}</td><td data-l="أرقام قديمة">${svcPill(t.services.contacts_old)}</td>
        <td data-l="المحفوظ"><span class="num">${n(t.contacts.saved)}</span>${t.contacts.pending ? html` <span class="tiny faint">(+${n(t.contacts.pending)})</span>` : ''}</td>
        <td><button class="btn btn-sm" data-manage="${t.id}">إدارة</button></td></tr>`)}</tbody></table></div></div></div>`);
    view.el._rows = rows;
  };
  const svcPill = s => s.owned ? html`<span class="pill ${s.paused ? 'warn' : 'ok'}">${s.forever ? 'دايماً' : left(s.expires_at)}</span>` : s.expired ? html`<span class="pill bad">انتهى</span>` : html`<span class="faint">—</span>`;
  await paint();
  let qt = null;
  view.on('input', '[data-q]', (e, i) => { clearTimeout(qt); qt = setTimeout(() => { q = i.value; paint().then(() => { const x = view.el.querySelector('[data-q]'); x?.focus(); x?.setSelectionRange(x.value.length, x.value.length); }); }, 250); });
  view.on('click', '[data-manage]', (e, b) => manage(view.el._rows.find(t => t.id === Number(b.dataset.manage)), plans, paint));
}
function manage(t, plans, done) {
  modal({
    title: t.name, wide: true,
    body: html`<div class="stack">
      <div class="kv"><dt>الرقم/الإيميل</dt><dd class="ltr">${t.email || '—'}</dd><dt>واتساب</dt><dd>${t.wa_phone ? phoneFmt(t.wa_phone) : 'مو مربوط'}</dd><dt>سجّل</dt><dd>${date(t.created_at)}</dd><dt>ردود ذكية (7 أيام)</dt><dd>${n(t.ai_7d)}</dd></div>
      <div class="divider"></div>
      ${['contacts_new', 'contacts_old'].map(sid => { const s = t.services[sid]; return html`<div class="row between"><span><b>${sid === 'contacts_new' ? 'حفظ كل رقم جديد' : 'حفظ الأرقام القديمة'}</b><br><span class="small muted">${s.owned ? (s.forever ? 'شغّالة دايماً' : `لـ ${date(s.expires_at)}`) + (s.paused ? ' · موقوفة' : '') : 'غير مشترك'}</span></span>
        <span class="row">${sid === 'contacts_new' ? html`<select class="select" style="width:auto;min-height:38px" data-months="${sid}">${[['d1', 'تجربة يوم'], ['d3', 'تجربة 3 أيام'], ['d7', 'تجربة أسبوع'], ...[1, 3, 6, 12].map(m => [String(m), periodName(m)])].map(([v, l]) => html`<option value="${v}" ${v === '1' ? 'selected' : ''}>${l}</option>`)}</select>` : ''}
          <button class="btn btn-sm btn-primary" data-svc="grant" data-sid="${sid}">${s.owned && sid === 'contacts_new' ? 'مدّد' : 'فعّل'}</button>
          ${s.owned ? html`<button class="btn btn-sm btn-danger" data-svc="revoke" data-sid="${sid}">إلغاء</button>` : ''}</span></div>`; })}
      <div class="divider"></div>
      <div class="row between"><span><b>المجيب الذكي</b><br><span class="small muted">${t.plan_id !== 'free' ? `${t.plan_id} لـ ${date(t.plan_expires_at)}` : 'مقفول'}</span></span>
        <span class="row"><select class="select" style="width:auto;min-height:38px" data-plan>${plans.filter(p => p.id !== 'free').map(p => html`<option value="${p.id}" ${p.id === t.plan_id ? 'selected' : ''}>${p.name}</option>`)}</select>
          <select class="select" style="width:auto;min-height:38px" data-plan-months>${[['d1', 'تجربة يوم'], ['d3', 'تجربة 3 أيام'], ['d7', 'تجربة أسبوع'], ...[1, 3, 6, 12].map(m => [String(m), periodName(m)])].map(([v, l]) => html`<option value="${v}" ${v === '1' ? 'selected' : ''}>${l}</option>`)}</select><button class="btn btn-sm btn-primary" data-plan-go>فعّل/مدّد</button></span></div>
      <div class="divider"></div>
      <div class="row between"><span><b>شوف حسابو من جوّا</b><br><span class="small muted">بتفوت كأنك هو: المحادثات، الأرقام، إعدادات الواتساب</span></span>
        <button class="btn btn-sm btn-primary" data-enter>${ic('user')} ادخل كأنّو هو</button></div>
      <div class="divider"></div>
      <div class="row between"><span><b>الحساب</b><br><span class="small muted">${t.status === 'suspended' ? 'موقوف: ما بيشتغل شي' : 'شغّال'}</span></span>
        <button class="btn btn-sm ${t.status === 'suspended' ? 'btn-primary' : 'btn-danger'}" data-status="${t.status === 'suspended' ? 'active' : 'suspended'}">${t.status === 'suspended' ? 'رجّعو' : 'وقّف الحساب'}</button></div>
    </div>`,
    onMount(m, close) {
      const after = async msg => { toast(msg); close(); await done(); };
      m.addEventListener('click', async e => {
        const b = e.target.closest('[data-svc]');
        if (b) {
          if (b.dataset.svc === 'revoke' && !await confirmBox('رح تنلغى الخدمة عن هالمشترك.', { ok: 'إلغاء الخدمة', danger: true })) return;
          const pv = m.querySelector(`[data-months="${b.dataset.sid}"]`)?.value || '0';
          const per = pv.startsWith('d') ? { days: Number(pv.slice(1)) } : { months: Number(pv) };
          busy(b, async () => { try { await api(`/api/admin/v2/tenants/${t.id}/service`, { method: 'POST', body: { service_id: b.dataset.sid, action: b.dataset.svc, ...per } }); await after(b.dataset.svc === 'grant' ? 'تفعّلت ✓' : 'انلغت'); } catch (err) { fail(err); } });
        }
        const pg = e.target.closest('[data-plan-go]');
        if (pg) busy(pg, async () => { try { await api(`/api/admin/tenants/${t.id}`, { method: 'PUT', body: { plan_id: m.querySelector('[data-plan]').value, ...(v => v.startsWith('d') ? { add_days: Number(v.slice(1)) } : { add_months: Number(v) })(m.querySelector('[data-plan-months]').value) } }); await after('تفعّل المجيب ✓'); } catch (err) { fail(err); } });
        const en = e.target.closest('[data-enter]');
        if (en) busy(en, async () => { try { await api(`/api/admin/v2/tenants/${t.id}/enter`, { method: 'POST', body: {} }); location.hash = '#/home'; location.reload(); } catch (err) { fail(err); } });
        const st = e.target.closest('[data-status]');
        if (st) {
          if (st.dataset.status === 'suspended' && !await confirmBox('رح يوقف كلشي عند هالمشترك ويتفك ربط واتسابو مؤقتاً.', { ok: 'وقّف', danger: true })) return;
          busy(st, async () => { try { await api(`/api/admin/tenants/${t.id}`, { method: 'PUT', body: { status: st.dataset.status } }); await after('تمام'); } catch (err) { fail(err); } });
        }
      });
    }
  });
}

export async function prices(view) {
  view.title('الأسعار والباقات', 'بيتغيّروا فوراً بالموقع', '/admin');
  const [plans, services] = await Promise.all([api('/api/admin/plans'), api('/api/admin/v2/services')]);
  const P = [1, 3, 6, 12];
  view.html(html`<div class="stack">
    <div class="card pad-lg"><div class="card-h"><h3>${ic('book')} حفظ الأرقام</h3></div>
      <div class="stack">${services.map(s => html`<div class="card flat stack-sm" style="background:var(--surface-2)" data-svc="${s.id}">
        <div class="grid g2"><div class="field"><label>الاسم</label><input class="input" data-k="name" value="${s.name}"></div><div class="field"><label>العملة</label><input class="input" data-k="currency" value="${s.currency}" dir="ltr"></div></div>
        <div class="field"><label>الوصف</label><textarea class="textarea" data-k="description" rows="2">${s.description}</textarea></div>
        <div class="field"><label>المزايا (كل ميزة بسطر)</label><textarea class="textarea" data-k="features" rows="3">${s.features.join('\n')}</textarea></div>
        <div class="field"><label>${s.kind === 'once' ? 'السعر (دفعة وحدة)' : 'السعر حسب المدة'}</label><div class="grid ${s.kind === 'once' ? '' : 'g4'}">${(s.kind === 'once' ? [0] : P).map(m => html`<div class="field"><span class="hint">${periodName(m)}</span><input class="input" data-price="${m}" inputmode="decimal" dir="ltr" value="${s.prices[m] ?? ''}"></div>`)}</div></div>
        <label class="check"><input type="checkbox" data-k="is_public" ${s.is_public ? 'checked' : ''}><span>ظاهرة للزباين</span></label></div>`)}
        <div class="row end"><button class="btn btn-primary" data-save-svc>حفظ أسعار حفظ الأرقام</button></div></div></div>
    <div class="card pad-lg"><div class="card-h"><h3>${ic('bot')} باقات المجيب</h3></div>
      <div class="stack">${plans.map(p => html`<div class="card flat stack-sm" style="background:var(--surface-2)" data-plan="${p.id}">
        <div class="row between"><b>${p.id}</b>${p.id === 'free' ? html`<span class="pill plain">المجانية/التجربة</span>` : ''}</div>
        <div class="grid g3"><div class="field"><label>الاسم</label><input class="input" data-k="name" value="${p.name}"></div><div class="field"><label>ردود باليوم</label><input class="input" data-k="ai_replies_per_day" dir="ltr" value="${p.ai_replies_per_day}"></div><div class="field"><label>أكتر عدد منتجات</label><input class="input" data-k="max_products" dir="ltr" value="${p.max_products}"></div></div>
        ${p.id === 'free' ? '' : html`<div class="grid g4">${P.map(m => html`<div class="field"><span class="hint">${periodName(m)}</span><input class="input" data-price="${m}" inputmode="decimal" dir="ltr" value="${p.prices[m] ?? ''}"></div>`)}</div>`}
        <div class="field"><label>المزايا (كل ميزة بسطر)</label><textarea class="textarea" data-k="features" rows="2">${p.features.join('\n')}</textarea></div>
        <label class="check"><input type="checkbox" data-k="is_public" ${p.is_public ? 'checked' : ''}><span>ظاهرة للزباين</span></label></div>`)}
        <div class="row end"><button class="btn btn-primary" data-save-plans>حفظ باقات المجيب</button></div></div></div>
  </div>`);
  const read = (box, keys) => { const o = {}; for (const k of keys) { const el = box.querySelector(`[data-k="${k}"]`); if (el) o[k] = el.type === 'checkbox' ? el.checked : el.value; } o.prices = Object.fromEntries([...box.querySelectorAll('[data-price]')].map(i => [i.dataset.price, i.value])); return o; };
  view.on('click', '[data-save-svc]', (e, b) => busy(b, async () => {
    try { const list = [...view.el.querySelectorAll('[data-svc]')].map(box => { const o = read(box, ['name', 'currency', 'description', 'features', 'is_public']); o.id = box.dataset.svc; o.features = o.features.split('\n').map(x => x.trim()).filter(Boolean); return o; });
      await api('/api/admin/v2/services', { method: 'PUT', body: { services: list } }); toast('انحفظ ✓'); } catch (err) { fail(err); }
  }));
  view.on('click', '[data-save-plans]', (e, b) => busy(b, async () => {
    try { const list = plans.map(p => { const box = view.el.querySelector(`[data-plan="${p.id}"]`); const o = read(box, ['name', 'ai_replies_per_day', 'max_products', 'features', 'is_public']);
        return { ...p, ...o, features: o.features.split('\n').map(x => x.trim()).filter(Boolean), prices: p.id === 'free' ? {} : o.prices }; });
      await api('/api/admin/plans', { method: 'PUT', body: { plans: list } }); toast('انحفظ ✓'); } catch (err) { fail(err); }
  }));
}

export async function platform(view) {
  view.title('إعدادات المنصة', '', '/admin');
  const s = await api('/api/admin/settings');
  view.html(html`<form class="stack" data-f style="max-width:820px">
    <div class="card pad-lg stack"><h3>${ic('card')} الدفع</h3>
      <div class="field"><label>رقم شام كاش تبعك</label><input class="input" name="shamcash_number" value="${s.shamcash_number}" dir="ltr"><span class="hint">بيبيّن للزبون لما يختار شام كاش. إذا فاضي، بيبيّن بس الدفع باليد.</span></div>
      <div class="field"><label>تعليمات الدفع (اختياري)</label><textarea class="textarea" name="payment_instructions" rows="3">${s.payment_instructions}</textarea></div></div>
    <div class="card pad-lg stack"><h3>${ic('lock')} الميزات والتجربة</h3>
      <p class="muted">كل حساب جديد بيكون مقفول. إنت بتفعّل الميزات لكل مشترك، وبتعطيه تجربة مجانية إذا بدك، من «المشتركين» ← «إدارة».</p>
      <input type="hidden" name="trial_value" value="${s.trial.value}"><input type="hidden" name="trial_unit" value="${s.trial.unit}"></div>
    <div class="card pad-lg stack"><h3>${ic('user')} التسجيل والعلامة</h3>
      <label class="check"><input type="checkbox" name="registration_open" ${s.registration_open ? 'checked' : ''}><span><b>التسجيل مفتوح</b><br><span class="small muted">إذا سكّرتو، ما حدا جديد بيقدر يعمل حساب</span></span></label>
      <div class="grid g2"><div class="field"><label>اسم المنصة</label><input class="input" name="brand_name" value="${s.brand.name}"></div><div class="field"><label>اللون</label><input class="input" type="color" name="brand_color" value="${s.brand.color}" style="padding:4px;min-height:46px"></div></div>
      <div class="field"><label>الشعار النصي</label><input class="input" name="brand_tagline" value="${s.brand.tagline}"></div></div>
    <div class="row end"><button class="btn btn-primary btn-lg" type="submit">حفظ</button></div></form>`);
  view.on('submit', '[data-f]', async (e, f) => {
    e.preventDefault();
    await busy(f.querySelector('[type=submit]'), async () => {
      try {
        await api('/api/admin/settings', { method: 'PUT', body: { shamcash_number: f.shamcash_number.value, payment_instructions: f.payment_instructions.value, registration_open: f.registration_open.checked,
          trial: { value: Number(f.trial_value.value), unit: f.trial_unit.value }, brand: { name: f.brand_name.value, color: f.brand_color.value, tagline: f.brand_tagline.value } } });
        toast('انحفظ ✓');
      } catch (err) { fail(err); }
    });
  });
}

export async function alerts(view) {
  view.title('تنبيهات التجربة', 'رقم استعمل التجربة قبل أو مربوط بحساب تاني', '/admin');
  const paint = async () => {
    const rows = await api('/api/admin/trial-alerts'); if (!view.alive) return;
    view.html(rows.length ? html`<div class="card" style="padding:6px 16px"><div class="list">${rows.map(a => html`<div class="item"><span class="ico ${a.status === 'open' ? 'gold' : ''}">${ic('bell')}</span>
      <span class="grow"><span class="t">${a.tenant_name}</span> <span class="num small">${phoneFmt(a.phone)}</span><br><span class="s">${a.reason} · ${ago(a.created_at)}</span></span>
      ${a.status === 'open' ? html`<span class="row"><button class="btn btn-sm" data-a="dismiss" data-id="${a.id}">تجاهل</button><button class="btn btn-sm btn-primary" data-a="allow" data-id="${a.id}">اسمح بتجربة جديدة</button></span>` : html`<span class="pill plain">${a.status === 'allowed' ? 'انسمح' : 'تجاهلت'}</span>`}</div>`)}</div></div>`
      : html`<div class="card"><div class="empty"><div class="ico">${ic('bell')}</div><p>ما في تنبيهات</p></div></div>`);
  };
  await paint();
  view.on('click', '[data-a]', (e, b) => busy(b, async () => { try { await api(`/api/admin/trial-alerts/${b.dataset.id}`, { method: 'POST', body: { action: b.dataset.a } }); toast('تمام'); await paint(); } catch (err) { fail(err); } }));
}

export async function tools(view) {
  view.title('أدواتي الخاصة', 'بتنفتح من اللوحة القديمة لحتى ننقلها وحدة وحدة', '/admin');
  const T = [['studio', 'sparkle', 'استوديو Gemini للصور'], ['auto', 'refresh', 'تعديل تلقائي من مجلد'], ['batch', 'grid', 'تعديل جماعي (قالب إنستا)'], ['ai', 'bot', 'عقول الذكاء والمفاتيح'],
    ['link', 'globe', 'الرابط العام'], ['messenger', 'chat', 'مجيب المسنجر'], ['learn', 'history', 'تعليم المجيب من محادثاتك'], ['quick', 'zap', 'أدوات سريعة']];
  view.html(html`<div class="stack"><div class="note info">${ic('info')}<span>هالأدوات إلك بس، والزباين ما بيشوفوها. بتنفتح بتبويب جديد من اللوحة القديمة.</span></div>
    <div class="grid g3">${T.map(([h, i, t]) => html`<a class="card row nowrap" href="/#/${h}" target="_blank" rel="noopener"><span class="ico">${ic(i)}</span><span class="grow"><b>${t}</b></span>${ic('ext')}</a>`)}
      <a class="card row nowrap" href="/meta" target="_blank" rel="noopener"><span class="ico">${ic('chat')}</span><span class="grow"><b>ردود التعليقات (فيسبوك/إنستا)</b></span>${ic('ext')}</a></div></div>`);
}
