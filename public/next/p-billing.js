// الاشتراكات والدفع: كل خدمة لحالها، والدفع بشام كاش أو كاش باليد
import { api, html, ic, money, periodName, date, left, dateTime, toast, fail, busy, modal, copy, readImage, str } from './core.js';
import { loadMe, refreshMe } from './app.js';

const STATUS = {
  pending: html`<span class="pill warn">ناطر التأكيد</span>`, awaiting_delivery: html`<span class="pill warn">ناطر التسليم</span>`,
  approved: html`<span class="pill ok">تفعّل ✓</span>`, rejected: html`<span class="pill bad">مرفوض</span>`
};

let cache = null;
async function billingData() { cache = await api('/api/v2/billing'); return cache; }

// نافذة الدفع (بتنفتح من أي صفحة)
const waLink = (num, text) => `https://wa.me/${('963' + String(num || '').replace(/\D/g, '').replace(/^(00963|963|0)/, ''))}?text=${encodeURIComponent(text)}`;
export async function checkout({ kind, id, months, onDone }) {
  const b = cache || await billingData();
  let item, price, cur = 'USD', title;
  if (kind === 'service') {
    item = b.services.find(s => s.id === id); if (!item) return fail(new Error('الخدمة مو موجودة'));
    if (item.kind === 'once') months = 0; price = item.prices[months]; cur = item.currency; title = item.name;
  } else {
    item = b.plans.find(p => p.id === id); if (!item) return fail(new Error('الباقة مو موجودة'));
    price = item.prices[months]; cur = item.currency; title = 'المجيب الذكي';
  }
  // كل المدد يلي إلها سعر (شهر، 3، 6، سنة): الزبون بيختار
  const periods = Object.keys(item.prices || {}).map(Number).filter(m => m > 0 && item.prices[m] != null).sort((a, b2) => a - b2);
  if (price == null && periods.length) { months = periods[0]; price = item.prices[months]; }
  if (price == null) return fail(new Error('سعر هالمدة لسا ما انحدد. تواصل معنا.'));
  let method = b.shamcash_number ? 'shamcash' : 'hand', receipt = null;
  modal({
    title: 'تأكيد الاشتراك',
    body: html`<div class="stack">
      ${periods.length > 1 ? html`<div class="field"><label>المدة</label><div class="choices period-pick" data-periods>${periods.map(m => html`<button type="button" class="choice ${m === months ? 'on' : ''}" data-p="${m}"><div class="t">${periodName(m)}</div><div class="small muted">${money(item.prices[m], cur)}${m > 1 && item.prices[1] ? html` · ${money(Math.round(item.prices[m] / m * 100) / 100, cur)} بالشهر` : ''}</div></button>`)}</div></div>` : ''}
      <div class="card flat" style="background:var(--surface-2)" data-sum></div>
      <div class="field"><label>طريقة الدفع</label><div class="choices" data-methods>
        ${b.shamcash_number ? html`<button type="button" class="choice ${method === 'shamcash' ? 'on' : ''}" data-m="shamcash"><div class="t">شام كاش</div><div class="small muted">بتحوّل وبتبعت صورة التحويل</div></button>` : ''}
        <button type="button" class="choice ${method === 'hand' ? 'on' : ''}" data-m="hand"><div class="t">كاش بالمركز</div><div class="small muted">${b.cash_address || 'دمشق - قدسيا - خلف البلدية'}</div></button></div></div>
      <div data-method-body></div>
      ${b.instructions ? html`<div class="note info">${ic('info')}<span style="white-space:pre-wrap">${b.instructions}</span></div>` : ''}
    </div>`,
    foot: html`<button class="btn" data-cancel>رجوع</button><button class="btn btn-primary" data-send>أرسل الطلب</button>`,
    onMount(m, close) {
      const mb = m.querySelector('[data-method-body]');
      const sum = () => { m.querySelector('[data-sum]').innerHTML = str(html`<div class="row between"><span><b>${title}</b><br><span class="small muted">${periodName(months)}</span></span><span class="price">${money(price, cur)}</span></div>`); };
      sum();
      m.addEventListener('click', e => { const pp = e.target.closest('[data-periods] .choice'); if (!pp) return; months = Number(pp.dataset.p); price = item.prices[months]; m.querySelectorAll('[data-periods] .choice').forEach(c => c.classList.toggle('on', c === pp)); sum(); paint(); });
      const paint = () => {
        m.querySelectorAll('[data-methods] .choice').forEach(c => c.classList.toggle('on', c.dataset.m === method));
        mb.innerHTML = str(method === 'shamcash' ? html`<div class="stack-sm">
          ${b.shamcash_qr ? html`<div class="sc-qr"><img src="${b.shamcash_qr}" alt="باركود شام كاش"><span class="small muted">امسح الباركود من تطبيق شام كاش</span></div>` : ''}
          <ol class="howto"><li><span>حوّل <b>${money(price, cur)}</b>${b.shamcash_name ? html` لـ <b>${b.shamcash_name}</b>` : ''}، بمسح الباركود أو بنسخ الكود:<br><b class="num sc-code" dir="ltr">${b.shamcash_number}</b> <button type="button" class="btn btn-sm btn-ghost" data-copy="${b.shamcash_number}">${ic('copy')} نسخ</button></span></li>
            <li><span>ابعت صورة التحويل على واتساب رقمنا <b class="num" dir="ltr">${b.receipts_whatsapp}</b></span></li>
            <li><span>اكبس «أرسل الطلب»، ومنفعّلك أول ما نتأكد</span></li></ol>
          <a class="btn btn-ok btn-block" target="_blank" rel="noopener" href="${waLink(b.receipts_whatsapp, `مرحبا، حوّلت ${money(price, cur)} على شام كاش لاشتراك «${title}». هي صورة التحويل:`)}">${ic('wa')} ابعت صورة التحويل على واتساب</a></div>`
          : html`<div class="stack-sm"><div class="note info">${ic('pin')}<span>بتدفع <b>${money(price, cur)}</b> كاش بمركزنا: <b>${b.cash_address || 'دمشق - قدسيا - خلف البلدية'}</b>. ومنفعّلك أول ما نستلم.</span></div>
            <div class="field"><label>رقم موبايلك لنتواصل معك</label><input class="input" data-phone inputmode="tel" dir="ltr" placeholder="09xxxxxxxx"></div></div>`);
      };
      paint();
      m.addEventListener('click', e => {
        const c = e.target.closest('[data-methods] .choice'); if (c) { method = c.dataset.m; paint(); }
        const cp = e.target.closest('[data-copy]'); if (cp) { e.preventDefault(); copy(cp.dataset.copy); }
      });
      m.addEventListener('change', async e => {
        if (e.target.type !== 'file') return;
        try { receipt = await readImage(e.target.files[0]); paint(); } catch (err) { fail(err); }
      });
      m.addEventListener('dragover', e => { const d = e.target.closest('[data-drop]'); if (d) { e.preventDefault(); d.classList.add('over'); } });
      m.addEventListener('drop', async e => { const d = e.target.closest('[data-drop]'); if (!d) return; e.preventDefault(); try { receipt = await readImage(e.dataTransfer.files[0]); paint(); } catch (err) { fail(err); } });
      m.querySelector('[data-cancel]').onclick = close;
      m.querySelector('[data-send]').onclick = e => busy(e.currentTarget, async () => {
        try {
          const phone = m.querySelector('[data-phone]')?.value;
          await api('/api/v2/billing/request', { method: 'POST', body: { kind, id, months, method, receipt, phone } });
          close(); toast(method === 'shamcash' ? 'وصل طلبك ✓ لا تنسى تبعت صورة التحويل على واتساب' : 'وصل طلبك ✓ منفعّلك أول ما نستلم'); refreshMe(); onDone?.();
        } catch (err) { fail(err); }
      });
    }
  });
}

export async function billing(view) {
  view.title('الاشتراكات والدفع', 'كل خدمة لحالها، وبتدفع بس على يلي بدك ياه');
  let tab = ['responder', 'contacts_new', 'contacts_old'].includes(view.query.tab) ? view.query.tab : 'responder', months = 1;
  const paint = async () => {
    const b = await billingData(); if (!view.alive) return;
    const r = b.responder, sv = b.mine;
    const svc = id => b.services.find(s => s.id === id) || { prices: {}, features: [] };
    const paid = b.plans.filter(p => p.id !== 'free');
    const mineRows = [
      { t: 'المجيب الذكي', ic: 'bot', cls: 'blue', s: r.paid ? `${r.plan_name} — لـ ${date(r.expires_at)} (${left(r.expires_at)})` : r.expired ? 'خلص الاشتراك' : r.gate?.code === 'trial' ? 'تجربة مجانية' : 'غير مشترك', ok: r.paid, tab: 'responder' },
      { t: svc('contacts_new').name, ic: 'book', cls: 'violet', s: sv.contacts_new.owned ? (sv.contacts_new.forever ? 'شغّال دايماً' : `لـ ${date(sv.contacts_new.expires_at)} (${left(sv.contacts_new.expires_at)})`) : sv.contacts_new.expired ? 'خلص الاشتراك' : 'غير مشترك', ok: sv.contacts_new.owned, tab: 'contacts_new' },
      { t: svc('contacts_old').name, ic: 'history', cls: 'gold', s: sv.contacts_old.owned ? 'مدفوعة ✓ (للأبد)' : 'غير مشترك', ok: sv.contacts_old.owned, tab: 'contacts_old', once: true }
    ];
    let body;
    if (tab === 'responder') {
      body = html`<div class="row" style="margin-bottom:14px"><div class="seg" data-months>${[1, 3, 6, 12].map(m => html`<button data-m="${m}" class="${m === months ? 'on' : ''}">${periodName(m)}</button>`)}</div></div>
        <div class="grid ${paid.length >= 3 ? 'g3' : 'g2'}">${paid.map((p, i) => html`<div class="card product ${i === 1 ? 'glow' : ''}">
          <div class="row between"><h3>${p.name}</h3>${r.paid && r.plan_id === p.id ? html`<span class="pill ok">باقتك</span>` : ''}</div>
          <div><span class="price">${money(p.prices[months], p.currency)}</span> <small class="muted">/ ${periodName(months)}</small></div>
          <ul>${(p.features?.length ? p.features : ['ردود بلا حدود', `حتى ${p.max_products.toLocaleString('en-US')} منتج`]).slice(0, 5).map(f => html`<li>${f}</li>`)}</ul>
          <button class="btn btn-primary btn-block" style="margin-top:auto" data-buy="plan" data-id="${p.id}" ${p.prices[months] == null ? 'disabled' : ''}>${r.paid && r.plan_id === p.id ? 'جدّد' : 'اشترك'}</button></div>`)}</div>`;
    } else {
      const s = svc(tab), entries = Object.entries(s.prices || {}).filter(([, v]) => v != null);
      const owned = sv[tab]?.owned;
      body = html`<div class="card ${s.kind === 'once' ? 'premium' : ''}" style="margin-bottom:14px"><div class="row"><span class="ico lg ${s.kind === 'once' ? 'gold' : 'violet'}">${ic(s.kind === 'once' ? 'history' : 'book')}</span><span class="grow"><b>${s.name}</b><br><span class="small muted">${s.description}</span></span></div>
          <ul class="ticks" style="margin-top:14px">${(s.features || []).map(f => html`<li>${f}</li>`)}</ul></div>
        ${s.kind === 'once' && owned ? html`<div class="note ok">${ic('check')}<span>هالخدمة مدفوعة عندك للأبد. روح على <a class="linkish" href="#/numbers">حفظ الأرقام</a> لتستعملها.</span></div>`
          : html`<div class="grid ${entries.length >= 4 ? 'g4' : entries.length > 1 ? 'g3' : ''}" style="${entries.length === 1 ? 'max-width:380px' : ''}">${entries.map(([m, v]) => html`<div class="card product">
            <h3>${s.kind === 'once' ? 'دفعة وحدة' : periodName(Number(m))}</h3><div><span class="price">${money(v, s.currency)}</span></div>
            ${s.kind === 'period' && Number(m) > 1 ? html`<span class="tiny muted">يعني ${money(v / Number(m), s.currency)} بالشهر</span>` : ''}
            <button class="btn ${s.kind === 'once' ? 'btn-gold' : 'btn-primary'} btn-block" style="margin-top:auto" data-buy="service" data-id="${s.id}" data-months="${m}">${owned ? 'جدّد' : 'اشترك'}</button></div>`)}</div>`}`;
    }
    view.html(html`<div class="stack">
      <div class="card pad-lg"><div class="card-h"><h3>${ic('card')} اشتراكاتي</h3></div>
        <div class="list">${mineRows.map(x => html`<div class="item"><span class="ico ${x.ok ? 'green' : x.cls}">${ic(x.ok ? 'check' : x.ic)}</span><span class="grow"><span class="t">${x.t}</span><br><span class="s">${x.s}</span></span>
          ${x.once && x.ok ? '' : html`<button class="btn btn-sm ${x.ok ? '' : 'btn-primary'}" data-tab-go="${x.tab}">${x.ok ? 'جدّد' : 'اشترك'}</button>`}</div>`)}</div></div>
      <div class="card pad-lg" data-shop>
        <div class="card-h"><h3>${ic('sparkle')} اشترك أو جدّد</h3></div>
        <div class="seg" style="margin-bottom:18px" data-tabs><button data-t="responder" class="${tab === 'responder' ? 'on' : ''}">المجيب الذكي</button><button data-t="contacts_new" class="${tab === 'contacts_new' ? 'on' : ''}">حفظ كل رقم جديد</button><button data-t="contacts_old" class="${tab === 'contacts_old' ? 'on' : ''}">الأرقام القديمة</button></div>
        ${body}
      </div>
      <div class="card pad-lg"><div class="card-h"><h3>${ic('history')} طلباتي</h3></div>
        ${b.requests.length ? html`<div class="list">${b.requests.map(p => html`<div class="item">
          ${p.receipt ? html`<a href="${p.receipt}" target="_blank" rel="noopener"><img class="receipt-thumb" src="${p.receipt}" alt="إيصال"></a>` : html`<span class="ico">${ic('card')}</span>`}
          <span class="grow"><span class="t">${p.name}</span> <span class="tag">${periodName(p.months)}</span><br><span class="s">${money(p.amount)} · ${p.method || ''} · ${dateTime(p.created_at)}</span></span>${STATUS[p.status] || html`<span class="pill">${p.status}</span>`}</div>`)}</div>`
          : html`<div class="empty"><div class="ico">${ic('card')}</div><p>ما في طلبات لسا.</p></div>`}
      </div>
    </div>`);
  };
  await paint();
  view.on('click', '[data-tabs] button', (e, b) => { tab = b.dataset.t; paint(); });
  view.on('click', '[data-tab-go]', (e, b) => { tab = b.dataset.tabGo; paint().then(() => view.el.querySelector('[data-shop]')?.scrollIntoView({ behavior: 'smooth' })); });
  view.on('click', '[data-months] button', (e, b) => { months = Number(b.dataset.m); paint(); });
  view.on('click', '[data-buy]', (e, b) => checkout({ kind: b.dataset.buy, id: b.dataset.id, months: b.dataset.buy === 'plan' ? months : Number(b.dataset.months), onDone: paint }));
  if (view.query.buy) { const [kind, id, m] = view.query.buy.split(':'); checkout({ kind, id, months: Number(m || (kind === 'plan' ? 1 : 0)), onDone: paint }); }
}
