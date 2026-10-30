// الرئيسية، ربط واتساب، والحساب
import { state, api, html, raw, ic, n, date, left, eta, phoneFmt, toast, fail, busy, confirmBox, setTheme, themePref, periodName, money, readImage, avatarHTML, displayName } from './core.js';
import { go, loadMe, paintNav, logout } from './app.js';

export function waPill(wa) {
  const st = wa?.status;
  if (st === 'open') return html`<span class="pill ok">مربوط</span>`;
  if (st === 'qr' || st === 'pairing') return html`<span class="pill info live">ناطر المسح</span>`;
  if (st === 'connecting') return html`<span class="pill warn live">عم يتصل</span>`;
  return html`<span class="pill bad">مو مربوط</span>`;
}
export function servicePill(s) {
  if (!s?.owned) return s?.expired ? html`<span class="pill bad">انتهى</span>` : html`<span class="pill plain">مو مشترك</span>`;
  if (s.paused) return html`<span class="pill warn">موقوف</span>`;
  return html`<span class="pill ok">شغّال</span>`;
}
export function responderPill(r) {
  if (!r.unlocked) return html`<span class="pill plain">${ic('lock')} مقفول</span>`;
  if (!r.enabled) return html`<span class="pill plain">مطفي</span>`;
  if (r.replying) return r.paid ? html`<span class="pill ok">شغّال</span>` : html`<span class="pill info">تجربة مجانية</span>`;
  if (r.expired) return html`<span class="pill bad">الاشتراك خلص</span>`;
  if (r.gate?.code === 'ended') return html`<span class="pill bad">خلصت التجربة</span>`;
  if (r.gate?.code === 'used' || r.gate?.code === 'linked') return html`<span class="pill bad">التجربة مستعملة</span>`;
  return html`<span class="pill warn">ما عم يرد</span>`;
}

export async function home(view) {
  await paintHome(view);
  view.sub('wa', () => { if (view.alive) paintHome(view).catch(() => {}); });
  view.every(15000, () => { if (state.me?.contacts?.pending) paintHome(view).catch(() => {}); });
}
async function paintHome(view) {
  const me = await loadMe();
  if (!view.alive) return;
  paintNav();
  const { wa, services: sv, responder: r, contacts: cs, counts } = me;
  const linked = wa?.status === 'open';
  const anyService = sv.contacts_new.owned || sv.contacts_old.owned || r.enabled;
  const name = (me.user.name || '').split(' ')[0];
  view.title(`أهلين${name ? ' ' + name : ''} 👋`, me.tenant.name);
  const steps = [
    { done: linked, t: 'اربط واتسابك', s: 'بمسح كود متل واتساب ويب', href: '/whatsapp' },
    { done: anyService, t: 'اختار الخدمة يلي بدك ياها', s: 'حفظ الأرقام أو المجيب أو الاتنين', href: '/billing' },
    { done: cs.saved > 0 || r.replying, t: 'خلص! كلشي بيشتغل لحالو', s: 'تابع الأرقام والمحادثات من هون', href: '/numbers' }
  ];
  const showSteps = steps.some(s => !s.done);
  const trialLeft = r.gate?.code === 'trial' && r.gate.ends_at ? left(r.gate.ends_at) : '';

  view.html(html`<div class="stack">
    ${counts.pending_payments ? html`<div class="banner">${ic('clock')}<span class="grow">عندك طلب دفع ناطر التأكيد. منفعّلك أول ما يتأكد.</span><a class="btn btn-sm" href="#/billing">التفاصيل</a></div>` : ''}
    ${showSteps ? html`<div class="card pad-lg glow">
      <div class="card-h"><h3>${ic('sparkle')} خطوات البداية</h3><span class="pill plain">${steps.filter(s => s.done).length} من ${steps.length}</span></div>
      <div class="list">${steps.map(s => html`<a class="item click" href="#${s.href}">
        <span class="ico ${s.done ? 'green' : ''}">${ic(s.done ? 'check' : 'fwd')}</span>
        <span class="grow"><span class="t" style="${s.done ? 'text-decoration:line-through;opacity:.6' : ''}">${s.t}</span><br><span class="s">${s.s}</span></span>
        ${s.done ? '' : ic('fwd')}</a>`)}</div></div>` : ''}

    <div class="grid g2">
      <div class="card">
        <div class="card-h"><h3><span class="ico" style="color:#25D366">${ic('wa')}</span> واتساب</h3>${waPill(wa)}</div>
        ${linked ? html`<p class="muted">مربوط على الرقم <b class="num">${phoneFmt(wa.phone)}</b></p><p class="small faint" style="margin-top:6px">خلّي موبايلك متصل بالنت مشان توصل الرسائل وينحفظوا الأرقام.</p>`
          : html`<p class="muted">لازم تربط واتسابك لحتى تشتغل الخدمات.</p><a class="btn btn-primary" style="margin-top:14px" href="#/whatsapp">${ic('qr')} اربط هلق</a>`}
      </div>

      <div class="card">
        <div class="card-h"><h3><span class="ico violet">${ic('book')}</span> حفظ الأرقام</h3>${servicePill(sv.contacts_new.owned ? sv.contacts_new : sv.contacts_old)}</div>
        <div class="row between" style="align-items:flex-end"><div class="stat"><span class="big-num num">${n(cs.saved)}</span><span class="k">رقم محفوظ بجهات اتصالك</span></div>
          ${cs.pending ? html`<span class="pill info live">${n(cs.pending)} عم ينحفظوا</span>` : ''}</div>
        ${cs.pending ? html`<div class="progress indet" style="margin-top:14px"><i></i></div><p class="tiny faint" style="margin-top:6px">${eta(cs.pending)}</p>` : ''}
        <a class="btn ${sv.contacts_new.owned || sv.contacts_old.owned ? '' : 'btn-primary'}" style="margin-top:14px" href="#/numbers">${sv.contacts_new.owned || sv.contacts_old.owned ? 'التفاصيل' : 'فعّل حفظ الأرقام'}</a>
      </div>

      <div class="card">
        <div class="card-h"><h3><span class="ico blue">${ic('bot')}</span> المجيب الذكي</h3>${responderPill(r)}</div>
        ${r.enabled ? html`<div class="grid g3" style="gap:10px">
            <div class="stat"><span class="v num">${n(r.usage?.ai_replies)}</span><span class="k">رد اليوم</span></div>
            <div class="stat"><span class="v num">${n(counts.unread)}</span><span class="k">مو مقروءة</span></div>
            <div class="stat"><span class="v num">${n(counts.needs_human)}</span><span class="k">بدهن موظف</span></div></div>
            ${trialLeft ? html`<p class="small muted" style="margin-top:10px">${ic('clock')} التجربة المجانية: ${trialLeft}</p>` : ''}
            <div class="row" style="margin-top:14px"><a class="btn" href="#/bot/inbox">المحادثات</a><a class="btn btn-ghost" href="#/bot">التحكم</a></div>`
          : html`<p class="muted">بيرد على زباينك باللهجة السورية وبياخد الطلبات. مطفي هلق.</p><a class="btn" style="margin-top:14px" href="#/bot">شوف كيف بيشتغل</a>`}
      </div>

      <div class="card">
        <div class="card-h"><h3><span class="ico gold">${ic('card')}</span> اشتراكاتي</h3><a class="linkish small" href="#/billing">إدارة</a></div>
        <div class="list">
          ${[['المجيب الذكي', r.paid ? `${r.plan_name} — لـ ${date(r.expires_at)}` : !r.unlocked ? 'مقفول' : r.enabled ? (trialLeft ? 'تجربة مجانية' : 'غير مشترك') : 'مطفي', r.paid],
             ['حفظ كل رقم جديد', sv.contacts_new.owned ? (sv.contacts_new.forever ? 'شغّال دايماً' : `لـ ${date(sv.contacts_new.expires_at)} (${left(sv.contacts_new.expires_at)})`) : 'غير مشترك', sv.contacts_new.owned],
             ['حفظ كل الأرقام القديمة', sv.contacts_old.owned ? 'مدفوعة ✓' : 'غير مشترك', sv.contacts_old.owned]].map(([t, s, okk]) => html`<div class="item">
            <span class="ico ${okk ? 'green' : ''}">${ic(okk ? 'check' : 'clock')}</span><span class="grow"><span class="t">${t}</span><br><span class="s">${s}</span></span></div>`)}
        </div>
      </div>
    </div>
    ${me.user.is_super ? html`<a class="card row between" href="#/admin" style="text-decoration:none"><span class="row"><span class="ico gold">${ic('shield')}</span><span><b>لوحة الإدارة</b><br><span class="small muted">المشتركين والمدفوعات والأسعار</span></span></span>${ic('fwd')}</a>` : ''}
  </div>`);
}

// ===== ربط واتساب =====
function qrImg(text) {
  try { const q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createDataURL(6, 2); } catch { return ''; }
}
export async function whatsapp(view) {
  view.title('ربط واتساب', 'متل واتساب ويب بالزبط');
  let mode = 'qr', wa = (await loadMe()).wa;
  const draw = () => {
    const st = wa?.status;
    const welcome = view.query.welcome && st !== 'open';
    let main;
    if (st === 'open') {
      main = html`<div class="card pad-lg stack" style="align-items:center;text-align:center">
        <div class="wa-big">${ic('wa')}</div><h2>واتسابك مربوط ✓</h2>
        <p class="muted">الرقم: <b class="num">${phoneFmt(wa.phone)}</b></p>
        <div class="note info" style="text-align:start">${ic('info')}<span>خلّي موبايلك متصل بالنت. إذا انطفى موبايلك فترة طويلة، بيضل الربط بس الرسائل بتتأخر.</span></div>
        <div class="row" style="justify-content:center"><a class="btn btn-primary" href="#/numbers">${ic('book')} حفظ الأرقام</a><a class="btn" href="#/bot">${ic('bot')} المجيب</a></div>
        <button class="btn btn-danger btn-sm" data-logout-wa>فك الربط</button></div>`;
    } else if (st === 'qr' && wa.qr) {
      const src = qrImg(wa.qr);
      main = html`<div class="grid g2" style="align-items:center">
        <div class="qr-box">${src ? html`<img src="${src}" alt="كود الربط">` : html`<p class="muted">حدّث الصفحة لحتى يطلع الكود</p>`}</div>
        <div class="stack"><h2>امسح الكود من موبايلك</h2>
          <ol class="howto"><li><span>افتح <b>واتساب</b> على موبايلك</span></li>
            <li><span>اضغط <kbd>⋮</kbd> (أندرويد) أو <kbd>الإعدادات</kbd> (آيفون)، وبعدين <kbd>الأجهزة المرتبطة</kbd></span></li>
            <li><span>اضغط <kbd>ربط جهاز</kbd> ووجّه الكاميرا عالكود</span></li></ol>
          <p class="small faint">الكود بيتجدد لحالو كل شوي. ما زبط؟ <button class="linkish" data-mode="pair">اربط بكود من 8 أحرف</button></p></div></div>`;
    } else if (st === 'pairing' && wa.code) {
      main = html`<div class="stack" style="max-width:560px;margin:auto">
        <div class="pair-code" dir="ltr">${wa.code}</div>
        <ol class="howto"><li><span>افتح <b>واتساب</b> ← <kbd>الأجهزة المرتبطة</kbd> ← <kbd>ربط جهاز</kbd></span></li>
          <li><span>اضغط تحت <kbd>الربط برقم الهاتف بدلاً من ذلك</kbd></span></li><li><span>اكتب الكود يلي فوق</span></li></ol></div>`;
    } else if (st === 'connecting') {
      main = html`<div class="empty"><div class="progress indet" style="width:220px"><i></i></div><h3>عم نتصل بواتساب…</h3><p>لحظات بس.</p></div>`;
    } else {
      main = html`<div class="stack">
        ${wa?.error ? html`<div class="note bad">${ic('alert')}<span>${wa.error}</span></div>` : ''}
        <div class="seg" style="align-self:center"><button data-mode="qr" class="${mode === 'qr' ? 'on' : ''}">${ic('qr')} بمسح كود</button><button data-mode="pair" class="${mode === 'pair' ? 'on' : ''}">${ic('phone')} بكود رقمي</button></div>
        ${mode === 'qr' ? html`<div class="stack" style="align-items:center;text-align:center">
            <div class="wa-big">${ic('qr')}</div><h2>اربط بمسح الكود</h2><p class="muted" style="max-width:460px">الأسهل إذا فاتح الموقع من الكمبيوتر: بيطلعلك كود، وبتمسحو من واتساب على موبايلك.</p>
            <button class="btn btn-primary btn-lg" data-connect="qr">${ic('qr')} طلّعلي الكود</button></div>`
          : html`<form class="stack" style="max-width:460px;margin:auto;width:100%" data-pair>
            <div style="text-align:center" class="stack-sm"><div class="wa-big" style="margin:auto">${ic('phone')}</div><h2>اربط من نفس الموبايل</h2><p class="muted">إذا ما عندك غير الموبايل: بنطلعلك كود من 8 أحرف بتكتبو بواتساب.</p></div>
            <div class="field"><label for="ph">رقم الواتساب مع رمز الدولة</label><input class="input" id="ph" name="phone" inputmode="numeric" dir="ltr" placeholder="963933123456" required><span class="hint">بدون + وبدون الصفر الأول. مثلاً 0933123456 بيصير 963933123456</span></div>
            <button class="btn btn-primary btn-lg" type="submit">طلّعلي الكود</button></form>`}
      </div>`;
    }
    view.html(html`<div class="stack">
      ${welcome ? html`<div class="note ok">${ic('sparkle')}<span><b>أهلين فيك!</b> خطوة وحدة وبتخلص: اربط واتسابك، وبعدين اختار الخدمة.</span></div>` : ''}
      <div class="card pad-lg">${main}</div>
      ${st !== 'open' ? html`<div class="note">${ic('lock')}<span>الربط متل واتساب ويب: ما منشوف كلمة سرك ولا منقدر نحذف شي من موبايلك. وفيك تفك الربط بأي وقت من «الأجهزة المرتبطة».</span></div>` : ''}
    </div>`);
  };
  draw();
  const refresh = async () => { try { wa = await api('/api/wa/status'); if (state.me) state.me.wa = wa; draw(); paintNav(); } catch {} };
  view.sub('wa', d => { wa = d; draw(); });
  view.every(4000, () => { if (['qr', 'pairing', 'connecting'].includes(wa?.status)) refresh(); });
  view.on('click', '[data-mode]', (e, b) => { mode = b.dataset.mode; if (wa?.status === 'qr' || wa?.status === 'pairing') wa = { status: 'disconnected' }; draw(); });
  view.on('click', '[data-connect]', async (e, b) => busy(b, async () => {
    try { wa = await api('/api/wa/connect', { method: 'POST', body: { mode: 'qr' } }); draw(); setTimeout(refresh, 1500); } catch (err) { fail(err); }
  }));
  view.on('submit', '[data-pair]', async (e, f) => {
    e.preventDefault();
    await busy(f.querySelector('[type=submit]'), async () => {
      try { wa = await api('/api/wa/connect', { method: 'POST', body: { mode: 'pair', phone: f.phone.value } }); draw(); setTimeout(refresh, 1500); } catch (err) { fail(err); }
    });
  });
  view.on('click', '[data-logout-wa]', async (e, b) => {
    if (!await confirmBox('رح ينفك ربط واتسابك، والأرقام ما عاد تنحفظ والمجيب ما عاد يرد لحتى تربط من جديد.', { ok: 'فك الربط', danger: true })) return;
    busy(b, async () => { try { await api('/api/wa/logout', { method: 'POST', body: {} }); wa = { status: 'disconnected' }; draw(); paintNav(); toast('انفك الربط'); } catch (err) { fail(err); } });
  });
}

// ===== الحساب =====
export async function account(view) {
  const me = await loadMe();
  view.title('الملف الشخصي', me.user.phone || me.user.email || '');
  const theme = themePref();
  view.html(html`<div class="stack" style="max-width:760px">
    <div class="card pad-lg">
      <div class="profile-head">
        <label class="avatar-pick" title="غيّر الصورة">${raw(avatarHTML(me, 'xl'))}<span class="avatar-cam">${ic('camera')}</span><input type="file" accept="image/*" data-avatar hidden></label>
        <div class="grow"><h2 style="margin:0">${displayName(me)}</h2><div class="muted ltr" style="text-align:start">${me.user.phone || me.user.email || ''}</div>
          <div class="row" style="gap:8px;margin-top:10px"><label class="btn btn-sm">${ic('camera')} ${me.user.avatar ? 'غيّر الصورة' : 'حط صورة'}<input type="file" accept="image/*" data-avatar hidden></label>
          ${me.user.avatar ? html`<button class="btn btn-sm btn-ghost" data-avatar-del>شيل الصورة</button>` : ''}</div></div>
      </div>
    </div>
    <div class="card pad-lg">
      <div class="card-h"><h3>${ic('user')} معلوماتك</h3></div>
      <form class="stack" data-info>
        <div class="grid g2"><div class="field"><label>اسمك</label><input class="input" name="name" value="${me.user.name || ''}" maxlength="80" placeholder="متل: أبو محمد"></div>
          <div class="field"><label>اسم المتجر أو الشغل</label><input class="input" name="store" value="${me.tenant.name}" maxlength="120" required></div></div>
        <div class="field"><label>رقم الموبايل (بتدخل فيه)</label><input class="input" name="phone" type="tel" inputmode="tel" value="${me.user.phone || ''}" placeholder="09xxxxxxxx" dir="ltr" ${me.user.phone ? 'required' : ''}></div>
        <div class="row end"><button class="btn btn-primary" type="submit">حفظ</button></div>
      </form>
    </div>
    <div class="card pad-lg">
      <div class="card-h"><h3>${ic('lock')} كلمة السر</h3></div>
      <form class="stack" data-pw>
        <div class="field"><label>الحالية</label><input class="input" type="password" name="cur" autocomplete="current-password" required dir="ltr"></div>
        <div class="grid g2"><div class="field"><label>الجديدة</label><input class="input" type="password" name="neu" autocomplete="new-password" minlength="8" required dir="ltr"></div>
          <div class="field"><label>عيد الجديدة</label><input class="input" type="password" name="neu2" autocomplete="new-password" minlength="8" required dir="ltr"></div></div>
        <div class="row end"><button class="btn" type="submit">غيّر كلمة السر</button></div>
      </form>
    </div>
    <div class="card pad-lg row between">
      <span><b>شكل الواجهة</b><br><span class="small muted">ليلي، نهاري، أو حسب موبايلك</span></span>
      <div class="seg" data-theme-seg>${[['auto', 'تلقائي'], ['dark', 'ليلي'], ['light', 'نهاري']].map(([k, t]) => html`<button data-t="${k}" class="${theme === k ? 'on' : ''}">${t}</button>`)}</div>
    </div>
    ${me.user.is_super ? html`<div class="card row between">
      <span><b>اللوحة القديمة</b><br><span class="small muted">إذا بدك شي ما لقيتو هون لسا</span></span>
      <a class="btn btn-sm" href="/" target="_blank" rel="noopener">${ic('ext')} افتحها</a>
    </div>` : ''}
    <button class="btn btn-danger btn-lg" data-logout>${ic('out')} تسجيل الخروج</button>
  </div>`);
  const saveAvatar = async url => { await api('/api/v2/profile', { method: 'PUT', body: { avatar: url } }); await loadMe(); paintNav(); account(view); };
  view.on('change', '[data-avatar]', async (e, inp) => {
    const file = inp.files?.[0]; if (!file) return;
    try { const data = await readImage(file, 512); const r = await api('/api/upload', { method: 'POST', body: { data } }); await saveAvatar(r.url); toast('انحطّت الصورة'); } catch (err) { fail(err); }
  });
  view.on('click', '[data-avatar-del]', async () => { try { await saveAvatar(''); } catch (err) { fail(err); } });
  view.on('submit', '[data-info]', async (e, f) => {
    e.preventDefault();
    await busy(f.querySelector('[type=submit]'), async () => {
      try {
        await api('/api/v2/profile', { method: 'PUT', body: { name: f.name.value, phone: f.phone.value } });
        if (f.store.value.trim() !== me.tenant.name) await api('/api/settings', { method: 'PUT', body: { name: f.store.value.trim() } });
        await loadMe(); paintNav(); account(view); toast('انحفظ');
      } catch (err) { fail(err); }
    });
  });
  view.on('submit', '[data-pw]', async (e, f) => {
    e.preventDefault();
    if (f.neu.value !== f.neu2.value) { fail(new Error('كلمة السر الجديدة والتأكيد مو متل بعض')); return; }
    await busy(f.querySelector('[type=submit]'), async () => {
      try { await api('/api/v2/profile', { method: 'PUT', body: { password_current: f.cur.value, password_new: f.neu.value, password_new2: f.neu2.value } }); f.reset(); toast('تغيّرت كلمة السر'); } catch (err) { fail(err); }
    });
  });
  view.on('click', '[data-theme-seg] button', (e, b) => { setTheme(b.dataset.t); view.el.querySelectorAll('[data-theme-seg] button').forEach(x => x.classList.toggle('on', x === b)); paintNav(); });
  view.on('click', '[data-logout]', () => logout());
}
export { periodName, money };
