// الصفحات العامة: الرئيسية للزوار، الدخول، وإنشاء حساب
import { state, api, html, ic, money, periodName, connectLive, fail, busy, n, modal, str as toHTML } from './core.js';
import { go, loadMe } from './app.js';

const topbar = () => html`<header class="site-top">
  <a class="brand" href="#/"><img src="/icon.svg" alt=""><span><b>K FAST AI</b><small>واتسابك بيشتغل عنك</small></span></a>
  <nav><a href="#/" data-scroll="products">الخدمات</a><a href="#/" data-scroll="how">كيف بتشتغل</a><a href="#/" data-scroll="pricing">الأسعار</a><a href="#/" data-scroll="faq">أسئلة</a></nav>
  <span class="grow"></span>
  <a class="btn btn-ghost btn-sm" href="#/login">دخول</a><a class="btn btn-primary btn-sm" href="#/register">اعمل حساب</a>
</header>`;

const minPrice = obj => { const v = Object.values(obj || {}).filter(x => x != null && x > 0); return v.length ? Math.min(...v) : null; };
const trialText = t => t ? `${t.value} ${t.unit === 'hours' ? (t.value == 1 ? 'ساعة' : 'ساعات') : (t.value == 1 ? 'يوم' : t.value == 2 ? 'يومين' : 'أيام')}` : '';

export async function landing(view) {
  const cat = state.catalog || (state.catalog = await api('/api/public/catalog').catch(() => ({ plans: [], services: [] })));
  const paidPlans = (cat.plans || []).filter(p => p.id !== 'free');
  const svc = id => (cat.services || []).find(s => s.id === id) || { prices: {}, features: [] };
  const sNew = svc('contacts_new'), sOld = svc('contacts_old');
  const respFrom = Math.min(...paidPlans.map(p => p.prices?.[1]).filter(x => x > 0), Infinity);
  const products = [
    { id: 'responder', icon: 'bot', cls: 'blue', name: 'المجيب الذكي', desc: 'بيرد على كل زبون بثواني باللهجة السورية، بيعرف منتجاتك وأسعارك، وبياخد الطلب كامل.',
      feats: ['بيحكي بأسلوبك وبيفهم اللهجة', 'ردود بلا حدود', 'بيفهم الرسائل الصوتية وبيرد عليها', 'بيشوف الصور وبيرد بطريقة تسويقية', 'بياخد الاسم والرقم والعنوان ويبعتلك الطلب', 'بيسكت لحالو لما ترد إنت من موبايلك'],
      price: isFinite(respFrom) ? html`<span class="price">${money(respFrom)}</span> <small>بالشهر</small>` : html`<span class="muted">حسب الباقة</span>`,
      extra: cat.trial ? html`<span class="pill gold plain">${ic('sparkle')} تجربة ${trialText(cat.trial)} ببلاش</span>` : '' },
    { id: 'contacts_new', icon: 'book', cls: 'violet', name: sNew.name || 'حفظ كل رقم جديد', desc: sNew.description, feats: sNew.features,
      price: minPrice({ 1: sNew.prices[1] }) != null ? html`<span class="price">${money(sNew.prices[1])}</span> <small>بالشهر</small>` : '' },
    { id: 'contacts_old', icon: 'history', cls: 'gold', name: sOld.name || 'حفظ كل الأرقام القديمة', desc: sOld.description, feats: sOld.features, premium: true,
      price: sOld.prices[0] != null ? html`<span class="price">${money(sOld.prices[0])}</span> <small>دفعة وحدة</small>` : '' }
  ];

  view.html(html`${topbar()}
  <div class="wrap">
    <section class="hero">
      <div>
        <span class="eyebrow">${ic('sparkle')} جديد: حفظ كل أرقامك القديمة من سنين</span>
        <h1>واتسابك <span class="grad-text">بيشتغل عنك</span>،<br>وإنت مرتاح</h1>
        <p class="lead">مجيب ذكي بيرد على زباينك ٢٤ ساعة باللهجة السورية، وحفظ تلقائي لكل رقم بيراسلك. كل خدمة لحالها، وبتدفع بس على يلي بدك ياه.</p>
        <div class="cta"><a class="btn btn-primary btn-lg" href="#/register">اعمل حسابك ${ic('fwd')}</a><a class="btn btn-lg" href="#/" data-scroll="pricing">شوف الأسعار</a></div>
        <div class="trust"><span>${ic('check')} بتربط بمسح QR متل واتساب ويب</span><span>${ic('check')} بتدفع بشام كاش أو كاش</span><span>${ic('check')} بتوقف وقت ما بدك</span></div>
      </div>
      <div class="phone" aria-hidden="true"><div class="phone-screen">
        <div class="phone-bar"><span class="avatar">KO</span><span>متجرك<br><span style="font-weight:400;font-size:11px;opacity:.7">متصل الآن</span></span></div>
        <div class="phone-chat">
          <div class="bub in" style="animation-delay:.2s">مرحبا، عندكن قفازات ملاكمة؟</div>
          <div class="bub out" style="animation-delay:.9s">أهلين وسهلين 🥊 إي عنا! بتحب جلد طبيعي ولا صناعي؟ وكم أونصة؟</div>
          <div class="bub in" style="animation-delay:1.6s">12 أونصة، جلد</div>
          <div class="bub out" style="animation-delay:2.3s">تمام، عنا لونين أسود وأحمر بـ 25$. بتحب ابعتلك الصور؟</div>
          <span class="saved-chip" style="animation-delay:3s">✓ انحفظ بجهات اتصالك: زبون 4821</span>
        </div>
      </div></div>
    </section>

    <section class="section" id="products">
      <div class="section-h"><span class="eyebrow">${ic('grid')} تلات خدمات، كل وحدة لحالها</span><h2>اختار يلي بيلزمك بس</h2><p>إذا بدك حفظ الأرقام بس، المجيب ما بيشتغل ولا بيرد على حدا. وإذا بدك الاتنين، بتشتغل سوا.</p></div>
      <div class="grid g3">${products.map(p => html`<div class="card pad-lg product ${p.premium ? 'premium' : 'glow'}">
        <div class="row between"><div class="ico lg ${p.cls}">${ic(p.icon)}</div>${p.extra || (p.premium ? html`<span class="pill gold plain">${ic('crown')} دفعة وحدة</span>` : '')}</div>
        <h3>${p.name}</h3><p class="muted">${p.desc}</p>
        <ul>${(p.feats || []).map(f => html`<li>${f}</li>`)}</ul>
        <div class="row between" style="margin-top:auto"><div>${p.price}</div><button class="btn ${p.premium ? 'btn-gold' : 'btn-primary'}" data-sub="${p.id}">اشترك</button></div>
      </div>`)}</div>
    </section>

    <section class="section" id="how">
      <div class="section-h"><h2>بتبلّش بأقل من دقيقتين</h2><p>بدون برامج ولا تعقيد. كلشي من موبايلك أو كمبيوترك.</p></div>
      <div class="grid g3 steps3">
        <div class="card"><h3>اعمل حساب</h3><p class="muted" style="margin-top:6px">اسمك واسم متجرك ورقم موبايلك وكلمة سر. خلص.</p></div>
        <div class="card"><h3>اربط واتسابك</h3><p class="muted" style="margin-top:6px">امسح الكود من واتساب ← الأجهزة المرتبطة، متل واتساب ويب بالزبط.</p></div>
        <div class="card"><h3>اختار الخدمة وادفع</h3><p class="muted" style="margin-top:6px">بشام كاش أو كاش بمركزنا بقدسيا، ومنفعّلك بعد التأكيد.</p></div>
      </div>
    </section>

    <section class="section" id="pricing">
      <div class="section-h"><h2>أسعار واضحة</h2><p>كل ما طوّلت المدة، كل ما وفّرت أكتر.</p></div>
      <div class="row" style="justify-content:center;margin-bottom:22px"><div class="seg" data-ptabs>
        <button class="on" data-p="responder">المجيب الذكي</button><button data-p="contacts_new">حفظ كل رقم جديد</button><button data-p="contacts_old">الأرقام القديمة</button></div></div>
      <div data-pbody></div>
    </section>

    <section class="section" id="faq">
      <div class="section-h"><h2>أسئلة بتتكرر</h2></div>
      <div style="max-width:760px;margin:auto">
        <details class="faq" open><summary>كيف بيتربط واتسابي؟</summary><p>متل واتساب ويب بالزبط: بتفتح واتساب ← الأجهزة المرتبطة ← ربط جهاز، وبتمسح الكود يلي بيطلعلك. وإذا ما عندك غير الموبايل، بتطلب كود من 8 أحرف وبتكتبو بواتساب.</p></details>
        <details class="faq"><summary>إذا اشتركت بحفظ الأرقام بس، المجيب رح يرد على زباينِي؟</summary><p>لا. كل خدمة لحالها. المجيب ما بيرد على حدا إلا إذا شغّلتو إنت بإيدك.</p></details>
        <details class="faq"><summary>كيف بتجيبو أرقامي القديمة؟ وبياناتي بأمان؟</summary><p>من نسختك الاحتياطية: بتختار ملف النسخة وبتكتب مفتاحها، والملف بينقرا على جهازك إنت، وما بيوصلنا منو غير الأرقام. بعد الشراء معك 24 ساعة لترفعها.</p></details>
        <details class="faq"><summary>شو الاسم يلي بينحفظ فيه الرقم؟</summary><p>«زبون» وآخر 4 أرقام، مثلاً «زبون 4821»، وفيك تغيّر كلمة «زبون». والأسماء يلي إنت حاططها من قبل ما منلمسها أبداً.</p></details>
        <details class="faq"><summary>كيف بدفع؟</summary><p>شام كاش (بتحوّل وبتبعت صورة التحويل على واتساب 0938986875)، أو كاش بمركزنا: دمشق - قدسيا - خلف البلدية. منأكّد الدفعة ومنفعّلك بأسرع وقت.</p></details>
        <details class="faq"><summary>في شي لازم أعرفو قبل؟</summary><p>الربط غير رسمي، متل كل البرامج يلي بتربط واتساب ويب. واتساب ممكن يقيّد الأرقام يلي بتبعت رسائل مزعجة، لهيك المجيب بيرد على يلي بيراسلك بس، وما بيبعت رسائل جماعية.</p></details>
      </div>
    </section>
    <footer class="footer row between"><span>© ${new Date().getFullYear()} K FAST AI</span><span class="row"><a href="#/login">دخول</a><a href="#/register">حساب جديد</a></span></footer>
  </div>`);

  let tab = 'responder', months = 1;
  const body = view.el.querySelector('[data-pbody]');
  const draw = () => {
    if (tab === 'responder') {
      const p = paidPlans[0] || { prices: {}, currency: 'USD' };
      const entries = Object.entries(p.prices || {}).filter(([m, v]) => Number(m) > 0 && v != null);
      body.innerHTML = toHTML(html`<div class="grid ${entries.length >= 4 ? 'g4' : 'g3'}">${entries.map(([m, v]) => html`<div class="card pad-lg product ${m === '12' ? 'glow' : ''}">
        <h3>${periodName(Number(m))}</h3><div><span class="price">${money(v, p.currency)}</span></div>
        ${Number(m) > 1 ? html`<span class="tiny muted">يعني ${money(Math.round(v / Number(m) * 100) / 100, p.currency)} بالشهر</span>` : ''}
        <ul>${products[0].feats.slice(0, 4).map(f => html`<li>${f}</li>`)}</ul>
        <button class="btn btn-primary btn-block" data-buy="plan:${p.id}:${m}" style="margin-top:auto">اشترك</button></div>`)}</div>`);
    } else {
      const s = tab === 'contacts_new' ? sNew : sOld;
      const entries = Object.entries(s.prices || {}).filter(([, v]) => v != null);
      body.innerHTML = toHTML(html`<div class="grid ${entries.length >= 4 ? 'g4' : entries.length > 1 ? 'g3' : ''}" style="${entries.length === 1 ? 'max-width:420px;margin:auto' : ''}">${entries.map(([m, v]) => html`<div class="card pad-lg product ${s.kind === 'once' ? 'premium' : ''}">
        <h3>${s.kind === 'once' ? 'دفعة وحدة' : periodName(Number(m))}</h3><div><span class="price">${money(v, s.currency)}</span></div>
        ${s.kind === 'period' && Number(m) > 1 && s.prices[1] ? html`<span class="tiny muted">يعني ${money(v / Number(m), s.currency)} بالشهر</span>` : ''}
        <ul>${(s.features || []).slice(0, 4).map(f => html`<li>${f}</li>`)}</ul>
        <button class="btn ${s.kind === 'once' ? 'btn-gold' : 'btn-primary'} btn-block" data-buy="service:${s.id}:${m}" style="margin-top:auto">اشترك</button></div>`)}</div>`);
    }
  };
  draw();
  // «اشترك»: إذا داخل بحسابو منفتحلو الدفع، وإذا لا منعملو حساب ومنكمّل للدفع
  const buy = key => {
    if (state.me) { import('./p-billing.js').then(m => { const [kind, id, mm] = key.split(':'); m.checkout({ kind, id, months: Number(mm) }); }); return; }
    try { localStorage.setItem('kf-buy', key); } catch {}
    go('/register');
  };
  view.on('click', '[data-buy]', (e, b) => buy(b.dataset.buy));
  view.on('click', '[data-sub]', (e, b) => {
    const pid = b.dataset.sub;
    let opts, name, cur;
    if (pid === 'responder') { const p = paidPlans[0]; if (!p) return; name = 'المجيب الذكي'; cur = p.currency; opts = Object.entries(p.prices || {}).filter(([m, v]) => Number(m) > 0 && v).map(([m, v]) => ({ key: `plan:${p.id}:${m}`, m: Number(m), v, per: p.prices[1] })); }
    else { const s = svc(pid); name = s.name; cur = s.currency; opts = Object.entries(s.prices || {}).filter(([, v]) => v != null).map(([m, v]) => ({ key: `service:${pid}:${m}`, m: Number(m), v, per: s.prices[1] })); }
    if (opts.length === 1) return buy(opts[0].key);
    modal({
      title: `اشترك بـ «${name}»`,
      body: html`<div class="stack-sm"><p class="muted">اختار المدة. كل ما طوّلت، كل ما وفّرت.</p><div class="choices period-pick">${opts.map(o => html`<button type="button" class="choice" data-pick="${o.key}"><div class="t">${o.m ? periodName(o.m) : 'دفعة وحدة'}</div><div class="price" style="font-size:24px">${money(o.v, cur)}</div>${o.m > 1 && o.per ? html`<div class="tiny muted">يعني ${money(Math.round(o.v / o.m * 100) / 100, cur)} بالشهر</div>` : ''}</button>`)}</div></div>`,
      onMount(m, close) { m.querySelectorAll('[data-pick]').forEach(x => x.onclick = () => { close(); buy(x.dataset.pick); }); }
    });
  });
  view.on('click', '[data-ptabs] button', (e, b) => { tab = b.dataset.p; view.el.querySelectorAll('[data-ptabs] button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  view.on('click', '[data-months] button', (e, b) => { months = Number(b.dataset.m); draw(); });
  view.on('click', '[data-scroll]', (e, a) => { e.preventDefault(); document.getElementById(a.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}

function authShell(view, form) {
  view.html(html`<div class="auth">
    <div class="auth-art">
      <a class="brand" href="#/"><img src="/icon.svg" alt=""><span><b>K FAST AI</b><small>واتسابك بيشتغل عنك</small></span></a>
      <h1 style="font-size:40px">كل زبون <span class="grad-text">بينرد عليه</span>،<br>وكل رقم <span class="grad-text">بينحفظ</span>.</h1>
      <ul class="ticks" style="max-width:420px"><li>مجيب ذكي باللهجة السورية، ٢٤ ساعة</li><li>حفظ تلقائي لكل رقم جديد بجهات اتصالك</li><li>وكل أرقامك القديمة من سنين، بدفعة وحدة</li></ul>
    </div>
    <div class="auth-form">${form}</div>
  </div>`);
}

export async function login(view) {
  authShell(view, html`<div class="card pad-lg stack">
    <a class="brand" href="#/" style="padding:0"><img src="/icon.svg" alt=""><span><b>K FAST AI</b></span></a>
    <div><h2>أهلين فيك من جديد</h2><p class="muted">ادخل لحسابك لتكمّل.</p></div>
    <form class="stack" data-f>
      <div class="field"><label for="ph">رقم الموبايل</label><input class="input" id="ph" name="login" type="text" inputmode="tel" autocomplete="username" placeholder="09xxxxxxxx" required dir="ltr" autofocus></div>
      <div class="field"><label for="pw">كلمة السر</label><input class="input" id="pw" name="password" type="password" autocomplete="current-password" required dir="ltr"></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">دخول</button>
    </form>
    <p class="small muted" style="text-align:center">ما عندك حساب؟ <a class="linkish" href="#/register">اعمل حساب</a></p>
    <p class="tiny faint" style="text-align:center">نسيت كلمة السر؟ تواصل معنا على واتساب ومنرجّعلك ياها.</p>
  </div>`);
  view.on('submit', '[data-f]', async (e, f) => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]');
    await busy(btn, async () => {
      try {
        await api('/api/v2/auth/login', { method: 'POST', body: { login: f.login.value, password: f.password.value } });
        await loadMe(); connectLive(); go(view.query.next || '/home', true);
      } catch (err) { fail(err); }
    });
  });
}

export async function register(view) {
  authShell(view, html`<div class="card pad-lg stack">
    <a class="brand" href="#/" style="padding:0"><img src="/icon.svg" alt=""><span><b>K FAST AI</b></span></a>
    <div><h2>اعمل حسابك</h2><p class="muted">بعدها بتختار الخدمة يلي بدك ياها وبتشترك فيها.</p></div>
    <form class="stack" data-f>
      <div class="field"><label for="nm">اسمك الثلاثي</label><input class="input" id="nm" name="name" autocomplete="name" required maxlength="80" placeholder="الاسم، اسم الأب، الكنية" autofocus></div>
      <div class="field"><label for="bn">اسم الشركة أو المتجر</label><input class="input" id="bn" name="business_name" autocomplete="organization" required maxlength="120"></div>
      <div class="field"><label for="ph">رقم موبايلك</label><input class="input" id="ph" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="09xxxxxxxx" required dir="ltr"><span class="hint">رقم سوري. بتدخل فيه لحسابك بعدين.</span></div>
      <div class="field"><label for="pw">كلمة السر</label><input class="input" id="pw" name="password" type="password" autocomplete="new-password" minlength="8" required dir="ltr"><span class="hint">8 أحرف أو أكتر</span></div>
      <div class="field"><label for="pw2">عيد كلمة السر</label><input class="input" id="pw2" name="password2" type="password" autocomplete="new-password" minlength="8" required dir="ltr"></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">اعمل الحساب</button>
    </form>
    <p class="small muted" style="text-align:center">عندك حساب؟ <a class="linkish" href="#/login">ادخل</a></p>
  </div>`);
  view.on('submit', '[data-f]', async (e, f) => {
    e.preventDefault();
    await busy(f.querySelector('[type=submit]'), async () => {
      try {
        if (f.password.value !== f.password2.value) { fail(new Error('كلمة السر والتأكيد مو متل بعض')); f.password2.focus(); return; }
        await api('/api/v2/auth/register', { method: 'POST', body: { name: f.name.value, business_name: f.business_name.value, phone: f.phone.value, password: f.password.value, password2: f.password2.value } });
        await loadMe(); connectLive();
        let pend = null; try { pend = localStorage.getItem('kf-buy'); localStorage.removeItem('kf-buy'); } catch {}
        go(pend ? '/billing?buy=' + pend : '/whatsapp?welcome=1', true);
      } catch (err) { fail(err); }
    });
  });
}
