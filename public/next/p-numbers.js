// حفظ الأرقام: الجديدة لحالها، والقديمة لحالها (من الربط ومن النسخة الاحتياطية)
import { api, html, ic, n, date, left, eta, ago, toast, fail, busy, confirmBox, str } from './core.js';
import { loadMe, refreshMe, go } from './app.js';
import { checkout } from './p-billing.js';
import { servicePill } from './p-main.js';

export async function numbers(view) {
  view.title('حفظ الأرقام', 'كل زبون بيراسلك بينحفظ بجهات اتصالك لحالو');
  let prefixDraft = null;
  const paint = async () => {
    const d = await api('/api/csync/status'); if (!view.alive) return;
    const { services: sv, stats: st, wa } = d;
    const linked = wa.status === 'open';
    const prefix = prefixDraft ?? d.prefix;
    const sNew = sv.contacts_new, sOld = sv.contacts_old;
    view.html(html`<div class="stack">
      ${!linked ? html`<div class="banner">${ic('wa')}<span class="grow">واتسابك مو مربوط. الأرقام بتبلّش تنحفظ أول ما تربطو.</span><a class="btn btn-sm btn-primary" href="#/whatsapp">اربط هلق</a></div>` : ''}

      <div class="card pad-lg glow">
        <div class="row between" style="align-items:flex-end">
          <div class="stat"><span class="k">محفوظين بجهات اتصالك</span><span class="big-num num">${n(st.saved)}</span></div>
          ${st.pending ? html`<div class="stack-sm" style="min-width:220px;flex:1;max-width:360px"><div class="row between small"><span class="pill info live">عم ينحفظوا</span><b class="num">${n(st.pending)} باقي</b></div><div class="progress indet"><i></i></div><span class="tiny faint">${eta(st.pending)}. بيكمّل لحالو حتى لو سكّرت الصفحة.</span></div>`
            : st.saved ? html`<span class="pill ok">كلو محفوظ ✓</span>` : ''}
        </div>
        ${linked && !st.book_ready && (sNew.owned || sOld.owned) ? html`<div class="note info" style="margin-top:16px">${ic('info')}<span>عم نجيب جهات اتصالك من واتساب أول (مرة وحدة)، مشان ما نكرر أي رقم محفوظ عندك. بياخد دقايق.</span></div>` : ''}
      </div>

      <div class="grid g2">
        <div class="card pad-lg stack">
          <div class="row between"><span class="row nowrap"><span class="ico lg violet">${ic('book')}</span><span><h3>كل رقم جديد</h3><span class="small muted">بينحفظ أول ما يبعتلك</span></span></span>${servicePill(sNew)}</div>
          ${sNew.owned ? html`
            <div class="row between"><span><b>${sNew.paused ? 'موقوف هلق' : 'شغّال'}</b><br><span class="small muted">${sNew.forever ? 'بدون انتهاء' : `لـ ${date(sNew.expires_at)} — ${left(sNew.expires_at)}`}</span></span>
              <label class="switch" title="تشغيل/إيقاف"><input type="checkbox" data-pause="contacts_new" ${sNew.paused ? '' : 'checked'}><span></span></label></div>
            ${sNew.forever ? '' : html`<button class="btn btn-sm" data-buy-new>جدّد الاشتراك</button>`}`
          : html`<ul class="ticks"><li>أي زبون بيراسلك أول مرة، بينحفظ بنفس اللحظة</li><li>حتى لو تفاعل برمز، أو إنت بعتّلو أول</li><li>حتى لو وصلت رسالتو والنت مقطوع</li></ul>
            <button class="btn btn-primary" data-buy-new>${ic('zap')} اشترك</button>`}
        </div>

        <div class="card pad-lg stack ${sOld.owned ? '' : 'premium'}">
          <div class="row between"><span class="row nowrap"><span class="ico lg gold">${ic('history')}</span><span><h3>كل الأرقام القديمة</h3><span class="small muted">دفعة وحدة، من سنين لهلق</span></span></span>${sOld.owned ? html`<span class="pill ok">مدفوعة</span>` : html`<span class="pill gold plain">${ic('crown')} دفعة وحدة</span>`}</div>
          ${st.history ? html`<div class="row between"><span class="small muted">أرقام قديمة جاهزة عنا</span><b class="num">${n(st.history)}</b></div>` : ''}
          <div class="list">
            <div class="item"><span class="ico">${ic('link')}</span><span class="grow"><span class="t">من ربط الواتس</span><br><span class="s">أوتوماتيك: واتساب بيبعت محادثاتك وقت الربط</span></span>
              ${sOld.owned && st.history ? html`<button class="btn btn-sm" data-link-now>احفظ الجاهزين</button>` : ''}</div>
            <div class="item"><span class="ico gold">${ic('key')}</span><span class="grow"><span class="t">من النسخة الاحتياطية</span><br><span class="s">كل الأرقام من أول ما فتحت واتساب</span></span>
              <a class="btn btn-sm ${sOld.owned ? 'btn-gold' : ''}" href="#/numbers/backup">${sOld.owned ? 'ابدأ' : 'شوف كم رقم عندك'}</a></div>
          </div>
          ${sOld.owned ? '' : html`<button class="btn btn-gold" data-buy-old>${ic('crown')} اشترك بدفعة وحدة</button>`}
        </div>
      </div>

      <div class="grid g2">
        <div class="card pad-lg stack">
          <h3>${ic('edit')} اسم الرقم المحفوظ</h3>
          <div class="field"><label for="pf">الكلمة قبل الرقم</label>
            <div class="input-group"><input class="input" id="pf" data-prefix value="${prefix}" maxlength="24"><button class="btn" data-save-prefix>حفظ</button></div>
            <span class="hint">بيبيّن هيك: <b data-preview>${(prefix || 'زبون').trim()} 4821</b></span></div>
          <p class="small faint">إذا كتب الزبون اسمو بالمحادثة، ممكن نحفظو باسمو الحقيقي. والأسماء يلي حاططها إنت ما منلمسها أبداً.</p>
        </div>
        <div class="card pad-lg stack">
          <h3>${ic('info')} كيف بيشتغل</h3>
          <ul class="ticks"><li>بنحفظ بالدور، رقم كل ثانيتين ونص، مشان ما ينزعج واتساب</li><li>الرقم المحفوظ عندك من قبل ما منكرّرو</li><li>لازم يضل موبايلك متصل بالنت مشان تنزل الأسماء عليه</li><li>إذا ما بيّن الاسم بواتساب: «دردشة جديدة» ← ⋮ ← «تحديث»</li></ul>
        </div>
      </div>

      ${d.imports.length ? html`<div class="card pad-lg"><h3 style="margin-bottom:8px">${ic('history')} آخر العمليات</h3><div class="list">${d.imports.map(i => html`<div class="item"><span class="ico ${i.source === 'backup' ? 'gold' : ''}">${ic(i.source === 'backup' ? 'key' : 'link')}</span>
        <span class="grow"><span class="t">${i.source === 'backup' ? 'من النسخة الاحتياطية' : 'من ربط الواتس'}</span><br><span class="s">${n(i.found)} رقم · ${ago(i.created_at)}</span></span></div>`)}</div></div>` : ''}
    </div>`);
  };
  await paint();
  view.every(12000, () => paint().catch(() => {}));
  view.on('input', '[data-prefix]', (e, i) => { prefixDraft = i.value; const p = view.el.querySelector('[data-preview]'); if (p) p.textContent = `${i.value.replace(/\d/g, '').trim() || 'زبون'} 4821`; });
  view.on('click', '[data-save-prefix]', (e, b) => busy(b, async () => {
    try { await api('/api/csync/settings', { method: 'PUT', body: { prefix: view.el.querySelector('[data-prefix]').value } }); prefixDraft = null; toast('انحفظ'); await paint(); } catch (err) { fail(err); }
  }));
  view.on('change', '[data-pause]', async (e, i) => {
    try { await api('/api/csync/settings', { method: 'PUT', body: { pause: { service_id: i.dataset.pause, paused: !i.checked } } }); toast(i.checked ? 'تشغّل' : 'توقّف'); refreshMe(); await paint(); } catch (err) { fail(err); i.checked = !i.checked; }
  });
  view.on('click', '[data-link-now]', (e, b) => busy(b, async () => {
    try { const r = await api('/api/csync/link-now', { method: 'POST', body: {} }); toast(r.stats.pending ? `بلّشنا: ${n(r.stats.pending)} رقم بالطابور` : 'كلهن محفوظين من قبل ✓'); await paint(); } catch (err) { fail(err); }
  }));
  view.on('click', '[data-buy-new]', () => checkout({ kind: 'service', id: 'contacts_new', months: 1, onDone: paint }));
  view.on('click', '[data-buy-old]', () => checkout({ kind: 'service', id: 'contacts_old', months: 0, onDone: paint }));
}

// ===== معالج النسخة الاحتياطية: بيشتغل على جهاز الزبون =====
const PATH = ['الذاكرة الداخلية', 'Android', 'media', 'com.whatsapp', 'WhatsApp', 'Databases', 'msgstore.db.crypt15'];
const fmtKey = v => v.replace(/[^0-9a-fA-F]/g, '').slice(0, 64).replace(/(.{4})(?=.)/g, '$1 ');
export async function backup(view) {
  view.title('الأرقام القديمة من النسخة الاحتياطية', 'كل الأرقام من أول ما فتحت واتساب', '/numbers');
  const me = await loadMe();
  const owned = me.services.contacts_old.owned;
  let step = 1, file = null, key = '', result = null, sent = null, ctrl = null, prog = { stage: 1, fraction: 0 }, err = null;
  const isPhone = /Android|iPhone|iPad/i.test(navigator.userAgent);

  const draw = () => {
    let body;
    if (step === 1) body = html`<div class="row" style="align-items:flex-start;gap:24px">
        <div class="stack grow" style="min-width:260px">
          <div><span class="tag">الخطوة 1 من 3</span><h2 style="margin-top:8px">شغّل النسخة المشفّرة بمفتاح 64 رقم</h2><p class="muted" style="margin-top:6px">هاد بيخلّي نسختك تنفتح بمفتاح إنت بتملكو. منعملها مرة وحدة.</p></div>
          <ol class="howto">
            <li><span>افتح <b>واتساب</b> ← <kbd>⋮</kbd> ← <kbd>الإعدادات</kbd> ← <kbd>الدردشات</kbd> ← <kbd>النسخ الاحتياطي للدردشات</kbd></span></li>
            <li><span>اضغط <kbd>النسخ الاحتياطي المشفّر تماماً</kbd> ← <kbd>تشغيل</kbd></span></li>
            <li><span>اختار <kbd>استخدام مفتاح تشفير مكوّن من 64 رقماً بدلاً من ذلك</kbd> ← <kbd>إنشاء المفتاح</kbd></span></li>
            <li><span><b>انسخ المفتاح</b> أو صوّرو، وخلّيه معك</span></li>
            <li><span>ارجع واضغط <kbd>نسخ احتياطي</kbd> واستنى لحتى يخلص</span></li>
          </ol>
          <p class="tiny faint">بالإنجليزي: Settings › Chats › Chat backup › End-to-end encrypted backup › Turn on › Use 64-digit encryption key instead</p>
          <div class="note warn">${ic('info')}<span>إذا كانت مشغّلة من قبل <b>بكلمة سر</b>: وقّفها وشغّلها من جديد واختار مفتاح الـ 64 رقم. وإذا عندك المفتاح من قبل، كمّل دغري.</span></div>
          <div class="row"><button class="btn btn-primary btn-lg" data-next="2">عملتها، كمّل ${ic('fwd')}</button></div>
        </div>
        <div class="mini-phone" aria-hidden="true"><div class="scr">
          <div class="bar">النسخ الاحتياطي المشفّر تماماً</div>
          <div class="opt">كلمة السر <span>›</span></div><div class="opt hl">مفتاح من 64 رقم <span>✓</span></div>
          <div class="key">a1b2 c3d4 e5f6 0718<br>29ab cdef 1234 5678<br>90ab cdef 1122 3344<br>5566 7788 99aa bbcc</div>
          <div class="opt">نسخ احتياطي ←</div></div></div>
      </div>`;
    else if (step === 2) body = html`<div class="stack">
        <div><span class="tag">الخطوة 2 من 3</span><h2 style="margin-top:8px">اختار ملف النسخة</h2><p class="muted" style="margin-top:6px">${isPhone ? 'من مدير الملفات بموبايلك:' : 'الملف موجود بموبايلك هون:'}</p>
          <div class="path">${PATH.map((p, i) => html`${i ? html`<i>‹</i>` : ''}<span class="tag">${p}</span>`)}</div></div>
        <label class="drop" data-drop>
          ${file ? html`<div class="stack-sm" style="align-items:center"><span class="ico green">${ic('file')}</span><b class="ltr">${file.name}</b><span class="small muted">${(file.size / 1e6).toFixed(1)} ميغا · اضغط لتغيّرو</span></div>`
            : html`<div class="stack-sm" style="align-items:center"><span class="ico gold">${ic('upload')}</span><b>اختار msgstore.db.crypt15</b><span class="small muted">${isPhone ? 'اضغط هون وروح عالمسار يلي فوق' : 'أو اسحبو لهون'}</span></div>`}
          <input type="file" data-file></label>
        ${isPhone ? html`<div class="note info">${ic('info')}<span>إذا ما بيّن مجلد <b>Android</b>: افتح تطبيق <b>Files</b> (ملفات Google)، روح على نفس المسار، وانسخ الملف لـ <b>Download</b>، وبعدين اختارو من هون.</span></div>`
          : html`<div class="note info">${ic('info')}<span>انقل الملف من موبايلك للكمبيوتر بكبل، أو ابعتو لحالك على تيليغرام، وبعدين اختارو من هون.</span></div>`}
        ${err ? html`<div class="note bad">${ic('alert')}<span>${err}</span></div>` : ''}
        <div class="row between"><button class="btn" data-next="1">رجوع</button><button class="btn btn-primary btn-lg" data-next="3" ${file ? '' : 'disabled'}>كمّل ${ic('fwd')}</button></div>
      </div>`;
    else if (step === 3) body = html`<form class="stack" data-keyform>
        <div><span class="tag">الخطوة 3 من 3</span><h2 style="margin-top:8px">الصق المفتاح</h2><p class="muted" style="margin-top:6px">مفتاح الـ 64 رقم يلي طلعلك بواتساب.</p></div>
        <textarea class="textarea mono" data-key rows="3" placeholder="a1b2 c3d4 e5f6 …" autocomplete="off" spellcheck="false" autofocus>${key}</textarea>
        <div class="row between"><span class="lock">${ic('lock')} المفتاح والملف ما بيطلعوا من جهازك. بيوصلنا الأرقام بس.</span><span class="small muted num" data-count>${key.replace(/\s/g, '').length}/64</span></div>
        ${err ? html`<div class="note bad">${ic('alert')}<span>${err}</span></div>` : ''}
        <div class="row between"><button type="button" class="btn" data-next="2">رجوع</button><button class="btn btn-primary btn-lg" type="submit">${ic('search')} اقرا الأرقام</button></div>
      </form>`;
    else if (step === 4) body = html`<div class="stack" style="align-items:center;text-align:center;padding:20px 0">
        <span class="ico lg gold">${ic('key')}</span><h2>${prog.stage === 1 ? 'عم نفك النسخة…' : 'عم نقرا المحادثات…'}</h2>
        <div class="progress" style="width:min(420px,100%)"><i style="width:${Math.round(prog.fraction * 100)}%"></i></div>
        <p class="muted num">${Math.round(prog.fraction * 100)}% · ${prog.stage === 1 ? 'المرحلة 1 من 2' : 'المرحلة 2 من 2'}</p>
        <p class="small faint">خلّي الصفحة مفتوحة. على الموبايل ممكن تاخد دقيقة أو اتنين.</p>
        <button class="btn btn-sm" data-cancel>إلغاء</button></div>`;
    else if (step === 5) body = sent ? html`<div class="stack" style="align-items:center;text-align:center;padding:10px 0">
          <span class="ico lg green">${ic('check')}</span>
          ${sent.owned ? html`<h2>بلّشنا الحفظ ✓</h2><p class="muted">${sent.queued ? `${n(sent.queued)} رقم جديد بالطابور. ${eta(sent.queued)}.` : sent.waiting ? 'رح يبلّشوا أول ما يكون واتسابك مربوط.' : 'كلهن محفوظين عندك من قبل، أو رح يبلّشوا بالدورة الجاية (خلال دقايق).'}</p>
            <p class="small faint">بيكمّل لحالو حتى لو سكّرت الصفحة والكمبيوتر.</p><a class="btn btn-primary" href="#/numbers">تابع التقدّم</a>`
            : html`<h2>الأرقام صارت جاهزة ✓</h2><p class="muted">حفظناهن عندنا. أول ما تشترك بـ «حفظ كل الأرقام القديمة» بيبلّشوا ينحفظوا بجهات اتصالك لحالهن، بدون ما تعيد شي.</p>
            <button class="btn btn-gold btn-lg" data-buy-old>${ic('crown')} اشترك بدفعة وحدة</button>`}
        </div>`
      : html`<div class="stack" style="align-items:center;text-align:center;padding:10px 0">
          <span class="ico lg green">${ic('check')}</span><span class="big-num num">${n(result.numbers.length)}</span>
          <h2>رقم لقيناهن بنسختك</h2><p class="muted">من ${n(result.chats)} محادثة${result.hidden ? `، منهن ${n(result.hidden)} كانت برقم مخفي وعرفنا رقمها` : ''}. الغروبات ما منحسبها.</p>
          <button class="btn btn-primary btn-lg" data-send>${ic('book')} ${owned ? 'احفظهم بجهات اتصالي' : 'جهّزهم لحتى اشترك'}</button>
          <p class="tiny faint">الأرقام يلي محفوظة عندك من قبل ما بتتكرر.</p></div>`;
    view.html(html`<div class="card pad-lg" style="max-width:920px;margin-inline:auto">
      <div class="wizard-steps">${[1, 2, 3, 4].map(i => html`<span class="${Math.min(step, 4) >= i ? 'on' : ''}"></span>`)}</div>${body}</div>
      ${!owned && step < 5 ? html`<p class="small muted" style="text-align:center;margin-top:14px">فيك تجرّب هلق وتشوف كم رقم عندك، والدفع بعدين.</p>` : ''}`);
  };
  draw();

  const run = async () => {
    step = 4; prog = { stage: 1, fraction: 0 }; err = null; draw();
    ctrl = new AbortController();
    try {
      const { readWhatsAppBackup } = await import('./wa-backup.js');
      let last = 0;
      result = await readWhatsAppBackup(file, key, { signal: ctrl.signal, onProgress: p => { prog = p; const now = Date.now(); if (now - last > 250) { last = now; if (view.alive) draw(); } } });
      if (!result.numbers.length) throw Object.assign(new Error('ما لقينا أرقام بهالنسخة. تأكد إنها آخر نسخة.'), { code: 'empty' });
      step = 5; sent = null; draw();
    } catch (e) {
      if (!view.alive) return;
      if (e.code === 'aborted') { step = 3; draw(); return; }
      err = e.message || 'صار خطأ';
      step = e.code === 'not_backup' || e.code === 'not_msgstore' ? 2 : 3;
      if (e.code === 'bad_key') err = 'المفتاح مو مطابق لهالنسخة. تأكد إنك نسخت المفتاح صح، وإنك عملت «نسخ احتياطي» بعد ما شغّلت مفتاح الـ 64 رقم.';
      draw();
    }
  };

  view.on('click', '[data-next]', (e, b) => { step = Number(b.dataset.next); err = null; draw(); });
  view.on('change', '[data-file]', (e, i) => { file = i.files[0] || null; err = null; if (file && !/crypt\d+$/i.test(file.name)) err = 'هالملف اسمو مو متل ملف النسخة (msgstore.db.crypt15). تأكد إنك اخترت الملف الصح.'; draw(); });
  view.on('dragover', '[data-drop]', (e, d) => { e.preventDefault(); d.classList.add('over'); });
  view.on('drop', '[data-drop]', (e) => { e.preventDefault(); file = e.dataTransfer.files[0] || null; err = null; draw(); });
  view.on('input', '[data-key]', (e, t) => {
    const pos = t.selectionStart, before = t.value.length; t.value = fmtKey(t.value); key = t.value;
    try { t.setSelectionRange(pos + (t.value.length - before), pos + (t.value.length - before)); } catch {}
    view.el.querySelector('[data-count]').textContent = `${key.replace(/\s/g, '').length}/64`;
  });
  view.on('submit', '[data-keyform]', e => {
    e.preventDefault();
    if (key.replace(/\s/g, '').length !== 64) { err = 'المفتاح لازم يكون 64 خانة بالزبط'; draw(); return; }
    run();
  });
  view.on('click', '[data-cancel]', () => ctrl?.abort());
  view.on('click', '[data-send]', (e, b) => busy(b, async () => {
    try { sent = await api('/api/csync/import', { method: 'POST', body: { numbers: result.dated || result.numbers } }); refreshMe(); draw(); } catch (err2) { fail(err2); }
  }));
  view.on('click', '[data-buy-old]', () => checkout({ kind: 'service', id: 'contacts_old', months: 0, onDone: () => go('/billing') }));
  view.cleanup(() => ctrl?.abort());
}
