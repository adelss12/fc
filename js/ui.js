/* ============================================================
   التقويم العائلي — الواجهة
   ============================================================ */
'use strict';

const WEEK_SHORT = ['سبت','أحد','إثنين','ثلاثاء','أربعاء','خميس','جمعة']; // يبدأ الأسبوع بالسبت
const ico = (name, cls='') => `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

const UI = {
  view:'list',
  filter:'upcoming',
  query:'',
  month:{ cal:'greg', y:0, m:0, sel:null },
  openSheets:new Set(),
  lastDay:''
};

/* ---------- أدوات عامة ---------- */
function toast(msg, err=false){
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(t._tm);
  t._tm = setTimeout(()=> t.classList.remove('show'), 2600);
}
function errText(e){ return e?.code ? authErrorMessage(e) : (e?.message || 'حدث خطأ غير متوقع. حاول مرة أخرى.'); }
function normalizeAr(s){
  return String(s || '').toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}
function download(name, content, type){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 4000);
}
function firstName(u){ return String(displayUser(u) || '').trim().split(/\s+/)[0] || ''; }

/* ---------- النوافذ ---------- */
function sheet({title, html='', cls='', back=null, footer=''}){
  const d = document.createElement('dialog');
  d.className = `sheet ${cls}`;
  d.innerHTML = `
    <div class="sheet-h"><i class="grip" aria-hidden="true"></i>
      <div class="sheet-t">${back ? `<button type="button" class="icon-btn back-btn" data-back aria-label="رجوع">${ico('chev-right')}</button>` : ''}<h2>${escapeHtml(title)}</h2></div>
      <button type="button" class="icon-btn" data-close aria-label="إغلاق">${ico('close')}</button></div>
    <div class="sheet-b">${html}</div>
    ${footer ? `<div class="sheet-f">${footer}</div>` : ''}`;
  document.body.appendChild(d);
  const api = {
    el:d, body:d.querySelector('.sheet-b'), onClose:null, closed:false,
    close(){
      if(api.closed) return;
      api.closed = true;
      d.classList.add('closing');
      setTimeout(()=>{ try{ d.close(); }catch(e){} d.remove(); UI.openSheets.delete(api); api.onClose?.(); }, 190);
    },
    q(sel){ return d.querySelector(sel); },
    qa(sel){ return d.querySelectorAll(sel); }
  };
  d.querySelector('[data-close]').addEventListener('click', ()=> api.close());
  d.querySelector('[data-back]')?.addEventListener('click', ()=>{ api.close(); setTimeout(back, 200); });
  d.addEventListener('cancel', e=>{ e.preventDefault(); api.close(); });
  d.addEventListener('click', e=>{ if(e.target === d) api.close(); });
  UI.openSheets.add(api);
  d.tabIndex = -1;
  d.showModal();
  d.focus(); // لا نضع التركيز على زر الإغلاق تلقائياً
  return api;
}
function confirmSheet({title, message, ok='تأكيد', danger=false}){
  return new Promise(resolve=>{
    const s = sheet({title, cls:'small', html:`
      <p style="margin:0;color:var(--ink-2)">${escapeHtml(message)}</p>
      <div class="actions">
        <button type="button" class="btn btn-line" data-no>إلغاء</button>
        <button type="button" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-yes>${escapeHtml(ok)}</button>
      </div>`});
    let v = false;
    s.q('[data-yes]').onclick = ()=>{ v = true; s.close(); };
    s.q('[data-no]').onclick = ()=> s.close();
    s.onClose = ()=> resolve(v);
  });
}

/* ---------- منتقي التاريخ (ميلادي / هجري) ---------- */
function datePicker(root, {cal='greg', date=new Date(), onChange=()=>{}}={}){
  const curH = gregToHijri(new Date())?.year || 1448;
  root.classList.add('datepick');
  root.innerHTML = `
    <input type="date" class="input" data-g aria-label="التاريخ الميلادي">
    <div class="hijri-row" data-h>
      <select class="input" data-hd aria-label="اليوم"></select>
      <select class="input" data-hm aria-label="الشهر">${HIJRI_MONTHS.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('')}</select>
      <select class="input" data-hy aria-label="السنة">${Array.from({length:126},(_,i)=>curH+15-i).map(y=>`<option value="${y}">${y}هـ</option>`).join('')}</select>
    </div>
    <div class="conv" data-conv></div>`;
  const g = root.querySelector('[data-g]'), hrow = root.querySelector('[data-h]');
  const hd = root.querySelector('[data-hd]'), hm = root.querySelector('[data-hm]'), hy = root.querySelector('[data-hy]');
  const conv = root.querySelector('[data-conv]');
  let mode = cal;
  function fillDays(keep){
    const len = hijriMonthLength(+hy.value, +hm.value);
    hd.innerHTML = Array.from({length:len},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
    hd.value = String(Math.min(keep || 1, len));
  }
  function setDate(d){
    if(!d) return;
    g.value = ymd(d);
    const h = gregToHijri(d);
    if(h){
      if(![...hy.options].some(o => +o.value === h.year)) hy.insertAdjacentHTML('beforeend', `<option value="${h.year}">${h.year}هـ</option>`);
      hy.value = String(h.year); hm.value = String(h.month); fillDays(h.day);
    }
  }
  function get(){
    if(mode === 'hijri') return hijriToGregClamped(+hy.value, +hm.value, +hd.value);
    return parseYmd(g.value);
  }
  function paint(){
    g.hidden = mode !== 'greg';
    hrow.hidden = mode !== 'hijri';
    const d = get();
    if(!d){ conv.innerHTML = ''; return; }
    if(mode === 'greg'){
      conv.className = 'conv';
      conv.innerHTML = `يوافق <b>${escapeHtml(fmtHijri(gregToHijri(d)))}</b> · ${AR_DAYS[d.getDay()]}`;
    }else{
      conv.className = 'conv g';
      conv.innerHTML = `يوافق <b>${escapeHtml(fmtGreg(d))}م</b> · ${AR_DAYS[d.getDay()]}`;
    }
  }
  g.addEventListener('change', ()=>{ const d = parseYmd(g.value); if(d) setDate(d); paint(); onChange(); });
  [hm, hy].forEach(s => s.addEventListener('change', ()=>{ fillDays(+hd.value); paint(); onChange(); }));
  hd.addEventListener('change', ()=>{ paint(); onChange(); });
  setDate(date || new Date());
  paint();
  return {
    get, getCal:()=> mode,
    setCal(c){ const d = get(); mode = c; if(d) setDate(d); paint(); onChange(); },
    setDate(d){ setDate(d); paint(); }
  };
}
function segBind(seg, onPick){
  seg.addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b || !seg.contains(b)) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    onPick(b);
  });
}

/* ============================================================
   الدخول
   ============================================================ */
let authMode = 'login';
function setAuthMode(m){
  authMode = m;
  const su = m === 'signup';
  $('authTitle').textContent = su ? 'إنشاء حساب جديد' : 'تسجيل الدخول';
  $('nameField').hidden = !su;
  $('confirmField').hidden = !su;
  $('authSubmit').textContent = su ? 'إنشاء الحساب' : 'دخول';
  $('authSwitch').textContent = su ? 'لديّ حساب، تسجيل الدخول' : 'إنشاء حساب جديد';
  $('authReset').hidden = su;
  $('authPassword').autocomplete = su ? 'new-password' : 'current-password';
  setAuthMsg('');
}
function setAuthMsg(t, ok=false){ const m = $('authMsg'); m.textContent = t; m.classList.toggle('ok', ok); }
function showLock(msg=''){
  $('app').hidden = true;
  $('lock').hidden = false;
  const h = gregToHijri(new Date());
  $('lockMoon').innerHTML = moonSvg(h?.day || 1, 72);
  $('lockDate').textContent = `${fmtHijri(h)} · ${fmtGreg(new Date(), true)}م`;
  setAuthMode('login');
  try{ const last = localStorage.getItem(LS_SESSION); if(last && !$('authEmail').value) $('authEmail').value = last; }catch(e){}
  $('authPassword').value = '';
  if(msg) setAuthMsg(msg);
  if(!Store.fbReady) setAuthMsg('تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد فتح الصفحة.');
  hideBoot();
}
function hideBoot(){ const b = $('boot'); if(b && !b.classList.contains('out')){ b.classList.add('out'); setTimeout(()=> b.remove(), 350); } }

$('authForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(!Store.fbReady){ setAuthMsg('تعذر الاتصال بالخادم. تحقق من الإنترنت.'); return; }
  const btn = $('authSubmit');
  btn.disabled = true;
  setAuthMsg('');
  try{
    if(authMode === 'signup'){
      btn.textContent = 'جارٍ إنشاء الحساب…';
      const r = await Auth.signUp($('authName').value, $('authEmail').value, $('authPassword').value, $('authConfirm').value);
      if(r.pending){
        setAuthMode('login');
        setAuthMsg('تم إنشاء حسابك، وهو الآن بانتظار موافقة المدير. ستتمكن من الدخول بعد قبوله.', true);
      }else{
        await enter(r.user);
      }
    }else{
      btn.textContent = 'جارٍ الدخول…';
      const user = await Auth.signIn($('authEmail').value, $('authPassword').value);
      await enter(user);
      toast(`أهلاً ${firstName(user)}`);
    }
  }catch(ex){
    setAuthMsg(errText(ex));
  }finally{
    btn.disabled = false;
    btn.textContent = authMode === 'signup' ? 'إنشاء الحساب' : 'دخول';
  }
});
$('authSwitch').addEventListener('click', ()=> setAuthMode(authMode === 'signup' ? 'login' : 'signup'));
/* نسيت كلمة المرور: يرسل رابطاً إلى البريد، مع مهلة 60 ثانية بين كل إرسال */
let resetWait = 0, resetTimer = null;
$('authReset').addEventListener('click', async ()=>{
  if(resetWait > 0) return;
  const btn = $('authReset');
  if(!$('authEmail').value.trim()){
    setAuthMsg('اكتب بريدك الإلكتروني في الخانة أعلاه، ثم اضغط «نسيت كلمة المرور؟» مرة أخرى.');
    $('authEmail').focus();
    return;
  }
  btn.disabled = true; btn.textContent = 'جارٍ الإرسال…';
  try{
    await Auth.resetPassword($('authEmail').value);
    setAuthMsg('أرسلنا رابط تعيين كلمة مرور جديدة إلى بريدك (إن كان مسجلاً لدينا). افتح الرسالة واضغط الرابط.\nلم تصل خلال دقائق؟ تحقق من مجلد «البريد المزعج / Spam».', true);
    resetWait = 60;
    const tick = ()=>{
      if(resetWait <= 0){ clearInterval(resetTimer); btn.disabled = false; btn.textContent = 'نسيت كلمة المرور؟'; return; }
      btn.textContent = `إعادة الإرسال بعد ${resetWait--} ث`;
    };
    tick(); resetTimer = setInterval(tick, 1000);
  }catch(ex){
    setAuthMsg(errText(ex));
    btn.disabled = false; btn.textContent = 'نسيت كلمة المرور؟';
  }
});

/* صفحة تعيين كلمة المرور الجديدة عند فتح الرابط من البريد */
const AUTH_ACTION = (()=>{
  const q = new URLSearchParams(location.search);
  return q.get('mode') === 'resetPassword' && q.get('oobCode') ? {code:q.get('oobCode')} : null;
})();
function clearActionUrl(){ try{ history.replaceState(null, '', location.pathname); }catch(e){} }
function setResetMsg(t, ok=false){ const m = $('resetMsg'); m.textContent = t; m.classList.toggle('ok', ok); }
async function showResetScreen(){
  showLock();
  $('authForm').hidden = true;
  $('resetForm').hidden = false;
  $('resetSubmit').disabled = true;
  setResetMsg('جارٍ التحقق من الرابط…', true);
  try{
    const email = await Auth.checkResetCode(AUTH_ACTION.code);
    AUTH_ACTION.email = email;
    $('resetEmail').textContent = email;
    setResetMsg('');
    $('resetSubmit').disabled = false;
    $('resetPw').focus();
  }catch(ex){
    setResetMsg(errText(ex));
    $('resetPw').disabled = $('resetConfirm').disabled = true;
  }
}
function backToLogin(email, msg, ok){
  clearActionUrl();
  $('resetForm').hidden = true;
  $('authForm').hidden = false;
  setAuthMode('login');
  if(email) $('authEmail').value = email;
  if(msg) setAuthMsg(msg, ok);
  $(email ? 'authPassword' : 'authEmail').focus();
}
$('resetForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const btn = $('resetSubmit'); btn.disabled = true; btn.textContent = 'جارٍ الحفظ…';
  try{
    await Auth.confirmReset(AUTH_ACTION.code, $('resetPw').value, $('resetConfirm').value);
    $('resetPw').value = $('resetConfirm').value = '';
    backToLogin(AUTH_ACTION.email, 'تم تغيير كلمة المرور بنجاح ✓ سجّل الدخول بكلمة المرور الجديدة.', true);
  }catch(ex){ setResetMsg(errText(ex)); }
  finally{ btn.disabled = false; btn.textContent = 'حفظ كلمة المرور'; }
});
$('resetBack').addEventListener('click', ()=> backToLogin('', ''));
document.querySelectorAll('[data-pw-toggle]').forEach(b => b.addEventListener('click', ()=>{
  const i = $(b.dataset.pwToggle); const show = i.type === 'password';
  i.type = show ? 'text' : 'password'; b.textContent = show ? 'إخفاء' : 'إظهار';
}));

async function enter(user){
  if(UI.entering === user.id) return;
  if(Store.user && Store.user.id === user.id && !$('app').hidden) return;
  UI.entering = user.id;
  try{ await _enter(user); }finally{ UI.entering = null; }
}
async function _enter(user){
  Store.user = user;
  $('lock').hidden = true;
  $('app').hidden = false;
  hideBoot();
  renderHeader();
  await enterAppData(user);
  renderAll();
  const n = pendingInvites().length;
  if(n) toast(n === 1 ? 'وصلتك دعوة موعد جديدة' : `لديك ${n} دعوات مواعيد`);
}

/* ============================================================
   الترويسة
   ============================================================ */
function renderHeader(){
  const now = new Date(), h = gregToHijri(now);
  $('todayMoon').innerHTML = moonSvg(h?.day || 1, 64);
  $('todayHijri').textContent = h ? `${h.day} ${HIJRI_MONTHS[h.month-1]}` : '';
  $('todayGreg').innerHTML = `<span class="hy">${h ? h.year + 'هـ' : ''}</span> · ${fmtGreg(now, true)}م`;
  const hr = now.getHours();
  $('greetText').textContent = `${hr < 12 ? 'صباح الخير' : 'مساء الخير'}${Store.user ? '، ' + firstName(Store.user) : ''}`;
  $('avatarLetter').textContent = (displayUser(Store.user) || '؟').trim().charAt(0);
  const pend = isAdminUser() ? adminPendingCount() : 0;
  $('avatarBadge').hidden = !pend;
  $('avatarBadge').textContent = pend;
}
const SYNC = {
  syncing:['busy','جارٍ المزامنة…'], loading:['busy','جارٍ تحميل مواعيدك…'], ok:['','متزامن مع كل أجهزتك'],
  warn:['warn','محفوظ على الجهاز، تعذرت المزامنة'], local:['','محفوظ على الجهاز'], offline:['warn','غير متصل، تُعرض النسخة المحفوظة']
};
Store.onSync = state=>{
  const [cls, txt] = SYNC[state] || SYNC.ok;
  $('syncBtn').className = 'sync ' + cls;
  $('syncText').textContent = txt;
};

/* ============================================================
   تجهيز المواعيد للعرض
   ============================================================ */
function entries(){
  const today = dateOnly(new Date());
  return getDisplayEvents().map(ev=>{
    const occ = nextOccurrence(ev, today);
    const days = diffDays(today, occ);
    return { ev, occ, days, past: days < 0 };
  });
}
function sortKey(a){ return a.occ.getTime() + (a.ev.time ? (+a.ev.time.slice(0,2)*60 + +a.ev.time.slice(3))*60000 : 0); }
function matchesQuery(ev, q){
  if(!q) return true;
  return normalizeAr(`${ev.title} ${ev.notes || ''} ${ev.sharedFrom || ''}`).includes(q);
}
function kindOf(ev){
  if(ev.tag === 'sa') return 'sa';
  if(ev.isShared) return 'shared';
  return ev.calType === 'hijri' ? 'hijri' : '';
}

function rowHtml(item){
  const {ev, occ, days} = item;
  const k = kindOf(ev);
  let tileN, tileM, other;
  const h = gregToHijri(occ);
  if(ev.calType === 'hijri'){
    tileN = h?.day; tileM = HIJRI_MONTHS[(h?.month || 1)-1];
    other = `${occ.getDate()} ${AR_MONTHS[occ.getMonth()]}${occ.getFullYear() !== new Date().getFullYear() ? ' ' + occ.getFullYear() : ''}`;
  }else{
    tileN = occ.getDate(); tileM = AR_MONTHS[occ.getMonth()];
    other = h ? `${h.day} ${HIJRI_MONTHS[h.month-1]}${occ.getFullYear() !== new Date().getFullYear() ? ' ' + h.year + 'هـ' : ''}` : '';
  }
  const meta = [`<span>${escapeHtml(other)}</span>`];
  if(ev.time) meta.push(`<span>${ico('clock')}${fmtTime(ev.time)}</span>`);
  if(ev.repeat === 'yearly') meta.push(`<span>${ico('repeat')}سنوياً</span>`);
  if(ev.isShared) meta.push(`<span class="shared-from">${ico('users')}${escapeHtml(ev.sharedFrom || 'مشترك')}</span>`);
  if(ev.notes) meta.push(`<span>${ico('note')}</span>`);
  let whenCls = '';
  if(days === 0) whenCls = 'today'; else if(days > 0 && days <= 7) whenCls = 'soon';
  return `<button type="button" class="row ${item.past ? 'past' : ''}" data-id="${escapeHtml(ev.localRefId || ev.id)}" data-occ="${ymd(occ)}">
    <div class="tile ${k}"><b>${tileN}</b><span>${escapeHtml(tileM)}</span></div>
    <div class="row-main"><div class="row-title">${escapeHtml(ev.title)}</div><div class="row-meta">${meta.join('')}</div></div>
    <div class="when ${whenCls}">${relativeLabel(days)}</div>
  </button>`;
}
function groupHtml(title, items, note=''){
  if(!items.length) return '';
  return `<section class="group"><h3 class="group-h">${escapeHtml(title)}${note ? `<small>${escapeHtml(note)}</small>` : ''}</h3>
    <div class="rows">${items.map(rowHtml).join('')}</div></section>`;
}

/* ---------- القائمة ---------- */
function renderList(){
  const q = normalizeAr(UI.query.trim());
  const all = entries().filter(x => matchesQuery(x.ev, q));
  const up = all.filter(x => !x.past).sort((a,b)=> sortKey(a) - sortKey(b));
  const past = all.filter(x => x.past).sort((a,b)=> sortKey(b) - sortKey(a));
  $('cUp').textContent = up.length; $('cPast').textContent = past.length; $('cAll').textContent = all.length;

  const upGroups = items => [
    groupHtml('اليوم', items.filter(x => x.days === 0)),
    groupHtml('خلال أسبوع', items.filter(x => x.days >= 1 && x.days <= 7)),
    groupHtml('خلال شهر', items.filter(x => x.days > 7 && x.days <= 31)),
    groupHtml('لاحقاً', items.filter(x => x.days > 31))
  ].join('');
  const pastGroups = items => {
    const by = new Map();
    for(const x of items){
      const key = `${x.occ.getFullYear()}-${x.occ.getMonth()}`;
      if(!by.has(key)) by.set(key, {t:`${AR_MONTHS[x.occ.getMonth()]} ${x.occ.getFullYear()}`, items:[]});
      by.get(key).items.push(x);
    }
    return [...by.values()].map(g => groupHtml(g.t, g.items)).join('');
  };

  let html = '';
  if(UI.filter === 'upcoming') html = upGroups(up);
  else if(UI.filter === 'past') html = pastGroups(past);
  else html = upGroups(up) + (past.length ? `<h3 class="group-h" style="margin-top:26px">الفائتة</h3>` + pastGroups(past) : '');

  if(!html){
    const msg = q ? 'لا توجد مواعيد تطابق بحثك.'
      : UI.filter === 'past' ? 'لا توجد مواعيد فائتة.'
      : 'لا توجد مواعيد قادمة. أضف أول موعد من زر الإضافة.';
    html = `<div class="empty">${ico(q ? 'search' : 'cal')}<p>${msg}</p>${q || UI.filter === 'past' ? '' : '<button type="button" class="btn btn-primary" data-add>إضافة موعد</button>'}</div>`;
  }
  $('eventList').innerHTML = html;
}
$('eventList').addEventListener('click', e=>{
  const r = e.target.closest('.row');
  if(r) return openDetail(r.dataset.id, parseYmd(r.dataset.occ));
  if(e.target.closest('[data-add]')) openForm();
});
segBind($('filterSeg'), b=>{ UI.filter = b.dataset.filter; renderList(); });
$('searchInput').addEventListener('input', e=>{ UI.query = e.target.value; renderList(); });

/* ---------- الدعوات ---------- */
function renderInvites(){
  const list = pendingInvites();
  const box = $('invites');
  if(!list.length){ box.innerHTML = ''; return; }
  box.innerHTML = `<div class="invites"><h3>${ico('inbox')}${list.length === 1 ? 'دعوة موعد جديدة' : `${list.length} دعوات مواعيد`}</h3>
    ${list.map(inv=>{
      const ev = inv.event || {}, d = parseYmd(ev.date);
      const from = inv.fromName || (isAdminUser() ? inv.fromEmail : 'مستخدم');
      return `<div class="invite" data-inv="${escapeHtml(inv.id)}">
        <div><div class="invite-t">${escapeHtml(ev.title || 'موعد بدون عنوان')}</div>
        <div class="invite-m">من ${escapeHtml(from)}${d ? ' · ' + fmtGreg(d) + ' · ' + fmtHijri(gregToHijri(d)) : ''} · ${roleLabel(inv.role || 'viewer')}</div></div>
        <div class="invite-a"><button type="button" class="btn btn-primary" data-act="accept">قبول</button><button type="button" class="btn btn-line" data-act="reject">رفض</button></div>
      </div>`;
    }).join('')}</div>`;
}
$('invites').addEventListener('click', async e=>{
  const b = e.target.closest('[data-act]'); if(!b) return;
  const id = b.closest('[data-inv]').dataset.inv;
  b.disabled = true;
  try{
    if(b.dataset.act === 'accept'){ await acceptInvite(id); toast('أُضيف الموعد إلى تقويمك'); }
    else{ await rejectInvite(id); toast('تم رفض الدعوة'); }
  }catch(ex){ toast('حُفظ على الجهاز، وتعذرت المزامنة الآن', true); }
  renderAll();
});

/* ---------- العرض الشهري ---------- */
function monthRange(){
  const M = UI.month;
  if(M.cal === 'hijri'){
    const start = hijriToGreg(M.y, M.m, 1);
    const len = hijriMonthLength(M.y, M.m);
    return {start, len, end:addDays(start, len-1)};
  }
  const start = new Date(M.y, M.m, 1);
  const len = new Date(M.y, M.m+1, 0).getDate();
  return {start, len, end:new Date(M.y, M.m, len)};
}
function setMonthFromDate(d, cal=UI.month.cal){
  UI.month.cal = cal;
  if(cal === 'hijri'){ const h = gregToHijri(d); UI.month.y = h.year; UI.month.m = h.month; }
  else{ UI.month.y = d.getFullYear(); UI.month.m = d.getMonth(); }
}
function shiftMonth(n){
  const M = UI.month;
  if(M.cal === 'hijri'){ let m = M.m + n, y = M.y; while(m < 1){ m += 12; y--; } while(m > 12){ m -= 12; y++; } M.y = y; M.m = m; }
  else{ const d = new Date(M.y, M.m + n, 1); M.y = d.getFullYear(); M.m = d.getMonth(); }
  M.sel = null;
  renderMonth();
}
function renderMonth(){
  const M = UI.month;
  const {start, len, end} = monthRange();
  const today = dateOnly(new Date());
  // العنوان
  const t = $('monthTitle').parentElement;
  t.classList.toggle('hijri-mode', M.cal === 'hijri');
  if(M.cal === 'hijri'){
    $('monthTitle').textContent = `${HIJRI_MONTHS[M.m-1]} ${M.y}هـ`;
    const a = AR_MONTHS[start.getMonth()], b = AR_MONTHS[end.getMonth()];
    $('monthSub').textContent = a === b ? `${a} ${end.getFullYear()}م` : `${a} – ${b} ${end.getFullYear()}م`;
  }else{
    $('monthTitle').textContent = `${AR_MONTHS[M.m]} ${M.y}`;
    const ha = gregToHijri(start), hb = gregToHijri(end);
    $('monthSub').textContent = ha.month === hb.month ? `${HIJRI_MONTHS[ha.month-1]} ${hb.year}هـ`
      : `${HIJRI_MONTHS[ha.month-1]} – ${HIJRI_MONTHS[hb.month-1]} ${hb.year}هـ`;
  }
  $('gridWeek').innerHTML = WEEK_SHORT.map(d => `<div>${d}</div>`).join('');
  // المواعيد في الشهر
  const map = new Map();
  for(const ev of getDisplayEvents()){
    for(const o of occurrencesBetween(ev, start, end)){
      const k = ymd(o);
      if(!map.has(k)) map.set(k, []);
      map.get(k).push(ev);
    }
  }
  const lead = (start.getDay() + 1) % 7; // السبت = 0
  let html = '';
  for(let i=0; i<lead; i++) html += `<div class="cell out" aria-hidden="true"></div>`;
  for(let i=0; i<len; i++){
    const d = addDays(start, i), key = ymd(d), h = gregToHijri(d);
    const n = M.cal === 'hijri' ? h.day : d.getDate();
    const s = M.cal === 'hijri' ? d.getDate() : h.day;
    const evs = map.get(key) || [];
    const cls = ['cell'];
    if(d.getDay() === 5 || d.getDay() === 6) cls.push('weekend');
    if(+d === +today) cls.push('today');
    if(M.sel && ymd(M.sel) === key) cls.push('sel');
    const dots = evs.slice(0,3).map(ev => `<i class="${kindOf(ev) === 'sa' ? 'sa' : ev.isShared ? 'shared' : ''}"></i>`).join('');
    const label = `${fmtGreg(d, true)}، ${fmtHijri(h)}${evs.length ? `، ${evs.length} موعد` : ''}`;
    html += `<button type="button" class="${cls.join(' ')}" data-d="${key}" aria-label="${escapeHtml(label)}"><span class="n">${n}</span><span class="s">${s}</span><span class="dots">${dots}</span></button>`;
  }
  const grid = $('monthGrid');
  grid.className = 'grid' + (M.cal === 'hijri' ? ' hijri-mode' : '');
  grid.innerHTML = html;
  renderDayPanel(map);
}
function renderDayPanel(map){
  const M = UI.month, box = $('dayPanel');
  const {start, end} = monthRange();
  let sel = M.sel;
  if(!sel){
    const today = dateOnly(new Date());
    sel = (today >= start && today <= end) ? today : null;
  }
  if(!sel){
    // ملخص الشهر عند عدم اختيار يوم
    const items = [];
    for(const ev of getDisplayEvents()) for(const o of occurrencesBetween(ev, start, end)) items.push({ev, occ:o, days:diffDays(new Date(), o), past:diffDays(new Date(), o) < 0});
    items.sort((a,b)=> sortKey(a) - sortKey(b));
    box.innerHTML = items.length ? groupHtml('مواعيد هذا الشهر', items) : `<div class="empty"><p>لا توجد مواعيد في هذا الشهر.</p></div>`;
    return;
  }
  const evs = (map.get(ymd(sel)) || []).map(ev => ({ev, occ:sel, days:diffDays(new Date(), sel), past:diffDays(new Date(), sel) < 0}));
  evs.sort((a,b)=> sortKey(a) - sortKey(b));
  box.innerHTML = `<h3 class="group-h"><span>${fmtGreg(sel, true)}<br><span class="day-sub">${escapeHtml(fmtHijri(gregToHijri(sel)))}</span></span>
      <button type="button" class="btn btn-soft" data-add-day style="min-height:38px;font-size:14px">${ico('plus')}موعد</button></h3>
    ${evs.length ? `<div class="rows">${evs.map(rowHtml).join('')}</div>` : `<div class="empty" style="padding:20px"><p style="margin:0">لا مواعيد في هذا اليوم.</p></div>`}`;
}
$('monthGrid').addEventListener('click', e=>{
  const c = e.target.closest('.cell[data-d]'); if(!c) return;
  const d = parseYmd(c.dataset.d);
  UI.month.sel = (UI.month.sel && ymd(UI.month.sel) === c.dataset.d) ? null : d;
  renderMonth();
});
$('dayPanel').addEventListener('click', e=>{
  const r = e.target.closest('.row');
  if(r) return openDetail(r.dataset.id, parseYmd(r.dataset.occ));
  if(e.target.closest('[data-add-day]')){
    const d = UI.month.sel || dateOnly(new Date());
    openForm(null, {date:d, cal:UI.month.cal});
  }
});
$('monthPrev').addEventListener('click', ()=> shiftMonth(-1));
$('monthNext').addEventListener('click', ()=> shiftMonth(1));
$('monthToday').addEventListener('click', ()=>{ setMonthFromDate(new Date()); UI.month.sel = null; renderMonth(); });
segBind($('gridCalSeg'), b=>{
  const {start} = monthRange();
  const anchor = UI.month.sel || addDays(start, 14);
  setMonthFromDate(anchor, b.dataset.cal);
  renderMonth();
});
// السحب الأفقي لتغيير الشهر
(()=>{
  let x0 = null, y0 = 0;
  const g = $('monthGrid');
  g.addEventListener('touchstart', e=>{ x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, {passive:true});
  g.addEventListener('touchend', e=>{
    if(x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftMonth(dx > 0 ? 1 : -1); // RTL: السحب لليمين = التالي
  });
})();

/* ---------- التنقل ---------- */
function setView(v){
  UI.view = v;
  $('viewList').hidden = v !== 'list';
  $('viewMonth').hidden = v !== 'month';
  document.querySelectorAll('.tab[data-view]').forEach(t => t.classList.toggle('on', t.dataset.view === v));
  document.querySelector('.today').classList.toggle('compact', v === 'month');
  if(v === 'month') renderMonth();
  window.scrollTo({top:0});
}
document.querySelectorAll('.tab[data-view]').forEach(t => t.addEventListener('click', ()=> setView(t.dataset.view)));
$('addBtn').addEventListener('click', ()=> openForm(null, UI.view === 'month' && UI.month.sel ? {date:UI.month.sel, cal:UI.month.cal} : {}));
$('toolsBtn').addEventListener('click', openTools);
$('accountBtn').addEventListener('click', openAccount);
$('avatarBtn').addEventListener('click', openAccount);
$('syncBtn').addEventListener('click', ()=> toast($('syncText').textContent));

function renderAll(){
  if(!Store.user) return;
  renderHeader();
  renderInvites();
  renderList();
  if(UI.view === 'month') renderMonth();
}
let _raf = 0;
Store.onChange = ()=>{ cancelAnimationFrame(_raf); _raf = requestAnimationFrame(renderAll); };
Store.onAdminDirectory = users=>{
  renderHeader();
  UI.adminRefresh?.(users);
};

/* ============================================================
   نموذج الموعد
   ============================================================ */
function openForm(localId=null, preset={}){
  const ev = localId ? findDisplayEvent(localId) : null;
  if(localId && !ev){ toast('لم يُعثر على الموعد', true); return; }
  if(ev && !canEditEvent(ev)){ toast('ليست لديك صلاحية تعديل هذا الموعد', true); return; }
  const cal = ev ? (ev.calType || 'greg') : (preset.cal || 'greg');
  const s = sheet({title: ev ? 'تعديل الموعد' : 'موعد جديد', back: ev ? ()=> openDetail(localId) : null, html:`
    <form class="stack" data-form novalidate>
      <label class="field"><span>العنوان</span><input type="text" data-title maxlength="120" placeholder="مثال: زيارة الأهل" required></label>
      <div class="field"><span>التاريخ</span>
        <div class="seg" data-calseg><button type="button" data-cal="greg">ميلادي</button><button type="button" data-cal="hijri">هجري</button></div>
        <div data-picker></div>
      </div>
      <div class="card flush">
        <div class="switch-row"><span class="label">${ico('clock')}<span>تحديد وقت<span class="sub">بدون وقت يكون الموعد طوال اليوم</span></span></span>
          <label class="switch"><input type="checkbox" data-timeon aria-label="تحديد وقت"><i></i></label></div>
        <div data-timebox hidden style="padding-bottom:12px"><input type="time" class="input" data-time aria-label="الوقت"></div>
        <div class="switch-row"><span class="label">${ico('repeat')}<span>يتكرر كل سنة<span class="sub" data-repsub></span></span></span>
          <label class="switch"><input type="checkbox" data-repeat aria-label="يتكرر كل سنة"><i></i></label></div>
      </div>
      <label class="field"><span>ملاحظات</span><textarea data-notes maxlength="1000" placeholder="اختياري"></textarea></label>
      <p class="form-msg" data-msg></p>
      <button type="submit" class="btn btn-primary btn-block">${ev ? 'حفظ التعديلات' : 'حفظ الموعد'}</button>
    </form>`});
  const f = s.q('[data-form]');
  const title = s.q('[data-title]'), timeOn = s.q('[data-timeon]'), timeBox = s.q('[data-timebox]'), time = s.q('[data-time]');
  const rep = s.q('[data-repeat]'), repSub = s.q('[data-repsub]'), notes = s.q('[data-notes]');
  const pickerDate = ev ? eventBaseDate(ev) : (preset.date || new Date());
  const picker = datePicker(s.q('[data-picker]'), {cal, date:pickerDate, onChange:()=>{}});
  const paintRep = ()=> repSub.textContent = picker.getCal() === 'hijri' ? 'في نفس اليوم من الشهر الهجري' : 'في نفس اليوم والشهر الميلادي';
  const calSeg = s.q('[data-calseg]');
  calSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.cal === cal));
  segBind(calSeg, b=>{ picker.setCal(b.dataset.cal); paintRep(); });
  paintRep();
  if(ev){
    title.value = ev.title || '';
    if(ev.time){ timeOn.checked = true; timeBox.hidden = false; time.value = ev.time; }
    rep.checked = ev.repeat === 'yearly';
    notes.value = ev.notes || '';
  }
  timeOn.addEventListener('change', ()=>{ timeBox.hidden = !timeOn.checked; if(timeOn.checked && !time.value) time.value = '19:00'; });
  if(!ev) setTimeout(()=> title.focus(), 300);
  f.addEventListener('submit', async e=>{
    e.preventDefault();
    const msg = s.q('[data-msg]');
    const t = title.value.trim();
    if(!t){ msg.textContent = 'اكتب عنوان الموعد.'; title.focus(); return; }
    const d = picker.get();
    if(!d){ msg.textContent = 'اختر تاريخاً صحيحاً.'; return; }
    const data = { title:t, calType:picker.getCal(), date:ymd(d),
      time: timeOn.checked && /^\d{2}:\d{2}$/.test(time.value) ? time.value : '',
      notes: notes.value.trim(), repeat: rep.checked ? 'yearly' : '' };
    try{
      const p = saveEventData(localId, data);
      s.close();
      renderAll();
      toast(localId ? 'تم حفظ التعديلات' : 'تم حفظ الموعد');
      await p;
    }catch(ex){
      if(ex?.message && !s.closed){ msg.textContent = ex.message; }
      else if(ex?.message) toast(ex.message, true);
    }
  });
}

/* ============================================================
   تفاصيل الموعد
   ============================================================ */
function openDetail(localId, occ){
  const ev = findDisplayEvent(localId);
  if(!ev){ toast('لم يُعثر على الموعد', true); return; }
  const today = dateOnly(new Date());
  occ = occ || nextOccurrence(ev, today);
  const base = eventBaseDate(ev);
  const days = diffDays(today, occ);
  const h = gregToHijri(occ);
  const k = kindOf(ev);
  const kindTxt = ev.tag === 'sa' ? 'مناسبة سعودية' : ev.isShared ? 'موعد مشترك' : (ev.calType === 'hijri' ? 'موعد بالتاريخ الهجري' : 'موعد شخصي');
  let rel = days === 0 ? 'اليوم' : `${days > 0 ? 'بعد' : 'مضى'} ${fmtYMD(diffYMD(today, occ))}`;
  const totalNote = Math.abs(days) > 31 ? `<div class="hint">${fmtDays(Math.abs(days))}</div>` : '';
  const ann = ev.repeat === 'yearly' ? anniversaryNumber(ev, occ) : 0;
  const rows = [
    ['الميلادي', `${fmtGreg(occ, true)}م`],
    ['الهجري', fmtHijri(h)],
  ];
  if(ev.time) rows.push(['الوقت', fmtTime(ev.time)]);
  if(ev.repeat === 'yearly'){
    rows.push(['التكرار', ev.calType === 'hijri' ? 'كل سنة هجرية' : 'كل سنة ميلادية']);
    if(+base !== +occ) rows.push(['التاريخ الأصلي', ev.calType === 'hijri' ? fmtHijri(gregToHijri(base)) : `${fmtGreg(base)}م`]);
  }
  rows.push(['أُدخل بالتقويم', ev.calType === 'hijri' ? 'الهجري' : 'الميلادي']);
  if(ev.isShared){
    rows.push(['من', ev.sharedFrom || '—']);
    rows.push(['صلاحيتك', roleLabel(ev.sharedRole || 'viewer')]);
  }else if(ev.sharedEventId){
    rows.push(['المشاركة', 'تشاركه مع آخرين']);
  }
  const canEdit = canEditEvent(ev), canShare = canShareEvent(ev);
  const removeOnly = ev.isShared && ev.ownerId !== Store.user?.id && ev.sharedRole !== 'owner';
  const s = sheet({title:'تفاصيل الموعد', html:`
    <div class="detail-hero">
      <span class="kind ${k}">${kindTxt}</span>
      <h3>${escapeHtml(ev.title)}</h3>
      <div class="rel ${days < 0 ? 'past' : ''}">${rel}</div>
      ${totalNote}
      ${ann > 0 ? `<div class="anniv">تمام ${fmtYears(ann)}</div>` : ''}
    </div>
    <div class="card">${rows.map(([a,b]) => `<div class="kv"><span>${a}</span><span>${escapeHtml(b)}</span></div>`).join('')}
      ${ev.notes ? `<div class="kv note"><span>ملاحظات</span><span>${escapeHtml(ev.notes)}</span></div>` : ''}</div>
    <div class="actions">
      ${canEdit ? `<button type="button" class="btn btn-soft" data-edit>${ico('edit')}تعديل</button>` : ''}
      ${canShare ? `<button type="button" class="btn btn-soft" data-share>${ico('share')}مشاركة</button>` : ''}
    </div>
    <div class="menu">
      <button type="button" class="menu-item" data-ics><span class="mi">${ico('phone')}</span><span class="txt">إضافة إلى تقويم الجوال</span></button>
      <button type="button" class="menu-item danger" data-del><span class="mi red">${ico('trash')}</span><span class="txt">${removeOnly ? 'إزالة من تقويمي' : 'حذف الموعد'}</span></button>
    </div>`});
  s.q('[data-edit]')?.addEventListener('click', ()=>{ s.close(); setTimeout(()=> openForm(localId), 200); });
  s.q('[data-share]')?.addEventListener('click', ()=>{ s.close(); setTimeout(()=> openShare(localId), 200); });
  s.q('[data-ics]').addEventListener('click', ()=>{
    download(`event-${ymd(occ)}.ics`, buildIcs([ev]), 'text/calendar;charset=utf-8');
  });
  s.q('[data-del]').addEventListener('click', async ()=>{
    const ok = await confirmSheet(removeOnly
      ? {title:'إزالة من تقويمي', message:'سيُزال هذا الموعد من تقويمك فقط، ويبقى عند المرسل وبقية المشاركين.', ok:'إزالة', danger:true}
      : {title:'حذف الموعد', message: ev.sharedEventId ? 'سيُحذف الموعد من تقويمك ومن تقويم كل من شاركته معهم.' : 'سيُحذف هذا الموعد نهائياً.', ok:'حذف', danger:true});
    if(!ok) return;
    const r = await deleteEventById(localId);
    s.close();
    renderAll();
    toast(r === 'removed' ? 'أُزيل الموعد من تقويمك' : 'تم حذف الموعد');
  });
}

/* ============================================================
   المشاركة
   ============================================================ */
async function openShare(localId){
  const ev = findDisplayEvent(localId);
  if(!ev) return;
  const s = sheet({title:'مشاركة الموعد', cls:'tall', back:()=> openDetail(localId), footer:`
    <p class="form-msg" data-msg></p>
    <button type="button" class="btn btn-primary btn-block" data-send>إرسال الدعوة</button>`, html:`
    <p class="hint">«${escapeHtml(ev.title)}» — اختر من تريد إرسال الدعوة له. تظهر هنا الحسابات المعتمدة في نفس تصنيفك.</p>
    <div class="field"><span>صلاحية المدعوين</span>
      <div class="seg" data-role><button type="button" class="on" data-r="viewer">مشاهدة فقط</button><button type="button" data-r="editor">مشاهدة وتعديل</button></div></div>
    <div style="display:flex;justify-content:space-between;align-items:center"><span class="hint" data-count></span><button type="button" class="link-btn" data-all>تحديد الكل</button></div>
    <div class="menu" data-list><div class="empty" style="padding:20px"><p style="margin:0">جارٍ تحميل الأسماء…</p></div></div>`});
  let role = 'viewer';
  segBind(s.q('[data-role]'), b=> role = b.dataset.r);
  const list = s.q('[data-list]'), count = s.q('[data-count]');
  const upd = ()=>{ const all = s.qa('input[data-uid]'), on = s.qa('input[data-uid]:checked'); count.textContent = `${on.length} من ${all.length} محدد`; };
  try{
    const users = await loadShareUsers();
    if(!users.length){ list.innerHTML = `<div class="empty" style="padding:20px"><p style="margin:0">لا يوجد أشخاص متاحون للمشاركة ضمن تصنيفك.</p></div>`; }
    else list.innerHTML = users.map(u => `<label class="pick"><input type="checkbox" data-uid="${escapeHtml(u.uid)}" data-email="${escapeHtml(u.identifier || '')}">
      <span class="who">${u._admin ? '👑 ' : ''}${escapeHtml(userVisibleName(u))}${isAdminUser() ? `<small>${escapeHtml(u.identifier || '')} · ${USER_CATEGORIES[normalizeUserCategory(u.category)]}</small>` : ''}</span></label>`).join('');
    upd();
  }catch(ex){ list.innerHTML = `<div class="empty" style="padding:20px"><p style="margin:0">${escapeHtml(errText(ex))}</p></div>`; }
  list.addEventListener('change', upd);
  s.q('[data-all]').addEventListener('click', ()=>{
    const boxes = [...s.qa('input[data-uid]')];
    const v = boxes.some(b => !b.checked);
    boxes.forEach(b => b.checked = v); upd();
  });
  s.q('[data-send]').addEventListener('click', async e=>{
    const btn = e.currentTarget, msg = s.q('[data-msg]');
    const targets = [...s.qa('input[data-uid]:checked')].map(b => ({id:b.dataset.uid, email:b.dataset.email}));
    btn.disabled = true; msg.textContent = '';
    try{
      const n = await sendShareInvites(localId, targets, role);
      s.close(); renderAll();
      toast(n === 1 ? 'أُرسلت الدعوة' : `أُرسلت ${n} دعوات`);
    }catch(ex){ msg.textContent = errText(ex); }
    finally{ btn.disabled = false; }
  });
}

/* ============================================================
   الأدوات
   ============================================================ */
function openTools(){
  const s = sheet({title:'الأدوات', html:`
    <div class="menu">
      <button type="button" class="menu-item" data-t="sa"><span class="mi gold">${ico('flag')}</span><span class="txt">المناسبات السعودية<small>الوطنية والدينية، الدراسة، الرواتب</small></span>${ico('chev-left','chev')}</button>
      <button type="button" class="menu-item" data-t="dist"><span class="mi">${ico('ruler')}</span><span class="txt">حساب المدة بين تاريخين<small>بالسنوات والأشهر والأيام، ميلادي أو هجري</small></span>${ico('chev-left','chev')}</button>
      <button type="button" class="menu-item" data-t="bk"><span class="mi blue">${ico('archive')}</span><span class="txt">النسخ الاحتياطي والاستعادة<small>نسخ على الجهاز، وتنزيل ملف، واستعادة</small></span>${ico('chev-left','chev')}</button>
      <button type="button" class="menu-item" data-t="ics"><span class="mi">${ico('phone')}</span><span class="txt">تصدير إلى تقويم الجوال<small>ملف ICS لتقويم الآيفون أو أندرويد</small></span>${ico('chev-left','chev')}</button>
    </div>`});
  s.body.addEventListener('click', e=>{
    const b = e.target.closest('[data-t]'); if(!b) return;
    const t = b.dataset.t;
    if(t === 'ics') return exportIcsAll();
    s.close();
    setTimeout(()=> ({sa:openSaudi, dist:openDistance, bk:openBackup})[t](), 200);
  });
}
function exportIcsAll(){
  const evts = getDisplayEvents();
  if(!evts.length){ toast('لا توجد مواعيد للتصدير', true); return; }
  download(`calendar-${safeFilePart(Store.user.email)}-${fileStamp()}.ics`, buildIcs(evts), 'text/calendar;charset=utf-8');
  toast(`صُدّر ${evts.length} موعد`);
}

/* ---------- المناسبات السعودية ---------- */
function openSaudi(){
  const s = sheet({title:'المناسبات السعودية', back:openTools, html:`
    <p class="hint">اختر الأقسام ثم أضفها أو أزلها. لا تتأثر مواعيدك الشخصية أو المشتركة.</p>
    <div class="menu" data-opts></div>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-imp>${ico('download')}إضافة المحدد</button>
      <button type="button" class="btn btn-danger" data-rem>${ico('trash')}إزالة المحدد</button>
    </div>`});
  const paint = ()=>{
    const c = saudiCounts();
    const prev = new Set([...s.qa('input[data-g]:checked')].map(x => x.dataset.g));
    const first = !s.q('input[data-g]');
    s.q('[data-opts]').innerHTML = Object.entries(SA_GROUPS).map(([g, v]) => `
      <label class="sa-opt"><input type="checkbox" data-g="${g}" ${first || prev.has(g) ? 'checked' : ''}>
        <span class="t">${v.label}<small>${v.hint}</small></span>
        <span class="count">${c[g] ? `مضاف (${c[g]})` : ''}</span></label>`).join('');
  };
  paint();
  const groups = ()=> [...s.qa('input[data-g]:checked')].map(x => x.dataset.g);
  s.q('[data-imp]').addEventListener('click', ()=>{
    const g = groups(); if(!g.length){ toast('حدد قسماً واحداً على الأقل', true); return; }
    const n = importSaudi(g); paint(); renderAll(); toast(`أُضيف ${n} موعداً`);
  });
  s.q('[data-rem]').addEventListener('click', async ()=>{
    const g = groups(); if(!g.length){ toast('حدد قسماً واحداً على الأقل', true); return; }
    const c = saudiCounts(), n = g.reduce((a,x)=> a + (c[x] || 0), 0);
    if(!n){ toast('لا توجد مناسبات مضافة في الأقسام المحددة', true); return; }
    if(!await confirmSheet({title:'إزالة المناسبات', message:`سيُحذف ${n} موعداً من الأقسام المحددة فقط.`, ok:'إزالة', danger:true})) return;
    const r = removeSaudi(g); paint(); renderAll(); toast(`أُزيل ${r} موعداً`);
  });
}

/* ---------- حساب المدة ---------- */
function openDistance(){
  const evs = getDisplayEvents().sort((a,b)=> eventBaseDate(b) - eventBaseDate(a));
  const opts = evs.map(ev => `<option value="${escapeHtml(ev.localRefId || ev.id)}">${escapeHtml(ev.title)} — ${fmtGreg(eventBaseDate(ev))}</option>`).join('');
  const s = sheet({title:'حساب المدة', back:openTools, html:`
    <div class="seg" data-mode><button type="button" class="on" data-m="dates">بين تاريخين</button><button type="button" data-m="events">بين موعدين</button></div>
    <div class="stack" data-dates>
      <div class="card stack"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><b>من</b>
        <div class="seg seg-sm" data-c1 style="width:150px"><button type="button" class="on" data-cal="greg">ميلادي</button><button type="button" data-cal="hijri">هجري</button></div></div><div data-p1></div></div>
      <div class="card stack"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><b>إلى</b>
        <div class="seg seg-sm" data-c2 style="width:150px"><button type="button" class="on" data-cal="greg">ميلادي</button><button type="button" data-cal="hijri">هجري</button></div></div><div data-p2></div></div>
    </div>
    <div class="stack" data-events hidden>
      <label class="field"><span>الموعد الأول</span><select class="input" data-e1><option value="">اختر موعداً</option>${opts}</select></label>
      <label class="field"><span>الموعد الثاني</span><select class="input" data-e2><option value="">اختر موعداً</option>${opts}</select></label>
    </div>
    <div class="card result" data-res></div>`});
  let mode = 'dates';
  const calc = ()=>{
    let a, b;
    if(mode === 'dates'){ a = p1.get(); b = p2.get(); }
    else{
      const e1 = findDisplayEvent(s.q('[data-e1]').value), e2 = findDisplayEvent(s.q('[data-e2]').value);
      a = e1 && eventBaseDate(e1); b = e2 && eventBaseDate(e2);
    }
    const res = s.q('[data-res]');
    if(!a || !b){ res.innerHTML = `<div class="sub">${mode === 'dates' ? 'اختر التاريخين.' : 'اختر موعدين لحساب المدة بينهما.'}</div>`; return; }
    const n = Math.abs(diffDays(a, b));
    if(n === 0){ res.innerHTML = `<div class="big">نفس اليوم</div>`; return; }
    const w = Math.floor(n/7), r = n % 7;
    res.innerHTML = `<div class="big">${fmtYMD(diffYMD(a, b))}</div>
      <div class="sub">${n.toLocaleString('en')} ${n > 10 ? 'يوماً' : n > 2 ? 'أيام' : n === 2 ? 'يومان' : 'يوم'}${w ? ` · ${fmtWeeks(w)}${r ? ` و${fmtDays(r)}` : ''}` : ''}</div>
      <div class="dir">${fmtGreg(a < b ? a : b)} ← ${fmtGreg(a < b ? b : a)}</div>`;
  };
  const p1 = datePicker(s.q('[data-p1]'), {date:new Date(), onChange:calc});
  const p2 = datePicker(s.q('[data-p2]'), {date:new Date(), onChange:calc});
  segBind(s.q('[data-c1]'), b=> p1.setCal(b.dataset.cal));
  segBind(s.q('[data-c2]'), b=> p2.setCal(b.dataset.cal));
  segBind(s.q('[data-mode]'), b=>{
    mode = b.dataset.m;
    s.q('[data-dates]').hidden = mode !== 'dates';
    s.q('[data-events]').hidden = mode !== 'events';
    calc();
  });
  s.q('[data-e1]').addEventListener('change', calc);
  s.q('[data-e2]').addEventListener('change', calc);
  calc();
}

/* ---------- النسخ الاحتياطي ---------- */
function openBackup(){
  const s = sheet({title:'النسخ الاحتياطي والاستعادة', back:openTools, html:`
    <p class="hint">مواعيدك تُحفظ تلقائياً في السحابة. النسخ هنا للاحتياط الإضافي أو للنقل.</p>
    <div class="menu">
      <button type="button" class="menu-item" data-a="create"><span class="mi">${ico('archive')}</span><span class="txt">إنشاء نسخة على هذا الجهاز<small>تُحفظ داخل المتصفح</small></span></button>
      <button type="button" class="menu-item" data-a="export"><span class="mi">${ico('download')}</span><span class="txt">تنزيل ملف نسخة احتياطية<small>ملف JSON تحتفظ به أينما شئت</small></span></button>
      <button type="button" class="menu-item" data-a="import"><span class="mi gold">${ico('upload')}</span><span class="txt">استعادة من ملف<small>يستبدل مواعيدك الحالية بمحتوى الملف</small></span></button>
    </div>
    <input type="file" accept="application/json,.json" data-file hidden>
    <h3 class="group-h" style="margin:4px 4px -6px">النسخ على هذا الجهاز</h3>
    <div class="menu" data-list></div>`});
  const list = s.q('[data-list]');
  const paint = async ()=>{
    try{
      const arr = await Backup.list();
      list.innerHTML = arr.length ? arr.map(b => `<div class="bk" data-id="${b.id}">
          <div class="bt">${b.count} موعد<small>${new Date(b.when).toLocaleString('ar-SA-u-ca-gregory-nu-latn', {dateStyle:'medium', timeStyle:'short'})}</small></div>
          <button type="button" class="btn btn-soft" data-r>استعادة</button>
          <button type="button" class="btn btn-danger" data-d aria-label="حذف النسخة">${ico('trash')}</button></div>`).join('')
        : `<div class="empty" style="padding:20px"><p style="margin:0">لا توجد نسخ على هذا الجهاز بعد.</p></div>`;
    }catch(e){ list.innerHTML = `<div class="empty" style="padding:20px"><p style="margin:0">تعذرت قراءة النسخ المحفوظة على هذا المتصفح.</p></div>`; }
  };
  paint();
  s.body.addEventListener('click', async e=>{
    const a = e.target.closest('[data-a]')?.dataset.a;
    if(a === 'create'){
      try{ const n = await Backup.create(); paint(); toast(`أُنشئت نسخة (${n} موعد)`); }catch(ex){ toast('تعذر إنشاء النسخة', true); }
    }else if(a === 'export'){
      download(`calendar-${safeFilePart(Store.user.email)}-${fileStamp()}.json`, Backup.exportJson(), 'application/json');
      toast('تم تنزيل الملف');
    }else if(a === 'import'){
      s.q('[data-file]').click();
    }
    const row = e.target.closest('.bk');
    if(row && e.target.closest('[data-r]')){
      const id = +row.dataset.id;
      if(!await confirmSheet({title:'استعادة النسخة', message:'ستُستبدل مواعيدك الحالية بمحتوى هذه النسخة.', ok:'استعادة', danger:true})) return;
      const rec = await Backup.get(id);
      if(!rec){ toast('النسخة غير موجودة', true); return; }
      saveEvents(rec.data || []); renderAll(); toast(`تمت الاستعادة (${rec.count} موعد)`);
    }else if(row && e.target.closest('[data-d]')){
      if(!await confirmSheet({title:'حذف النسخة', message:'ستُحذف هذه النسخة الاحتياطية نهائياً.', ok:'حذف', danger:true})) return;
      await Backup.del(+row.dataset.id); paint(); toast('حُذفت النسخة');
    }
  });
  s.q('[data-file]').addEventListener('change', async e=>{
    const file = e.target.files[0]; e.target.value = '';
    if(!file) return;
    try{
      const data = Backup.parseImport(await file.text());
      if(!await confirmSheet({title:'استعادة من ملف', message:`ستُستبدل مواعيدك الحالية بـ ${data.length} موعد من الملف.`, ok:'استعادة', danger:true})) return;
      saveEvents(data); renderAll(); toast(`استُعيد ${data.length} موعد`);
    }catch(ex){ toast('الملف غير صالح. اختر ملف نسخة احتياطية من هذا التطبيق.', true); }
  });
}

/* ============================================================
   الحساب
   ============================================================ */
function openAccount(){
  const u = Store.user, admin = isAdminUser();
  const pend = admin ? adminPendingCount() : 0;
  const s = sheet({title:'حسابي', html:`
    <div class="card" style="display:flex;align-items:center;gap:14px">
      <div class="avatar" style="width:54px;height:54px;font-size:22px">${escapeHtml((displayUser(u) || '؟').charAt(0))}</div>
      <div style="min-width:0"><div style="font-weight:700;font-size:17px">${escapeHtml(displayUser(u))}</div>
        <div class="hint" style="direction:ltr;text-align:right;word-break:break-all">${escapeHtml(u.email)}</div>
        <div class="hint">${admin ? 'مدير التطبيق' : `تصنيفك: ${USER_CATEGORIES[normalizeUserCategory(u.category)]}`}</div></div>
    </div>
    ${admin ? `<div class="menu"><button type="button" class="menu-item" data-a="admin"><span class="mi gold">${ico('shield')}</span><span class="txt">الإدارة<small>طلبات التسجيل والمستخدمون</small></span>${pend ? `<b class="badge">${pend}</b>` : ''}${ico('chev-left','chev')}</button></div>` : ''}
    <div class="menu">
      <button type="button" class="menu-item" data-a="name"><span class="mi">${ico('edit')}</span><span class="txt">تعديل الاسم</span>${ico('chev-left','chev')}</button>
      <button type="button" class="menu-item" data-a="pw"><span class="mi">${ico('key')}</span><span class="txt">تغيير كلمة المرور</span>${ico('chev-left','chev')}</button>
      <button type="button" class="menu-item" data-a="reset"><span class="mi">${ico('mail')}</span><span class="txt">إرسال رابط إعادة تعيين كلمة المرور</span></button>
    </div>
    <div class="menu"><button type="button" class="menu-item danger" data-a="out"><span class="mi red">${ico('logout')}</span><span class="txt">تسجيل الخروج</span></button></div>
    <p class="hint" style="text-align:center">الإصدار ${APP_VERSION} · <a href="old/" style="color:var(--primary)">فتح النسخة السابقة</a></p>`});
  s.body.addEventListener('click', async e=>{
    const a = e.target.closest('[data-a]')?.dataset.a; if(!a) return;
    if(a === 'reset'){
      try{ await Auth.resetPassword(u.email); toast('أُرسل الرابط إلى بريدك'); }catch(ex){ toast(errText(ex), true); }
      return;
    }
    if(a === 'out'){ s.close(); return logout(); }
    s.close();
    setTimeout(()=> ({admin:openAdmin, name:openName, pw:openPassword})[a](), 200);
  });
}
function openName(){
  const s = sheet({title:'تعديل الاسم', cls:'small', back:openAccount, html:`
    <p class="hint">يظهر اسمك داخل التطبيق وفي الدعوات التي ترسلها.</p>
    <label class="field"><span>الاسم الكامل</span><input type="text" data-n value="${escapeHtml(displayUser(Store.user))}" autocomplete="name"></label>
    <p class="form-msg" data-msg></p>
    <button type="button" class="btn btn-primary btn-block" data-save>حفظ الاسم</button>`});
  s.q('[data-save]').addEventListener('click', async e=>{
    e.currentTarget.disabled = true;
    try{ await Auth.updateName(s.q('[data-n]').value); s.close(); renderAll(); toast('تم حفظ الاسم'); }
    catch(ex){ s.q('[data-msg]').textContent = errText(ex); e.currentTarget.disabled = false; }
  });
}
function openPassword(){
  const s = sheet({title:'تغيير كلمة المرور', cls:'small', back:openAccount, html:`
    <label class="field"><span>كلمة المرور الحالية</span><input type="password" data-o autocomplete="current-password" dir="ltr"></label>
    <label class="field"><span>كلمة المرور الجديدة</span><input type="password" data-n autocomplete="new-password" dir="ltr"></label>
    <label class="field"><span>تأكيد كلمة المرور الجديدة</span><input type="password" data-c autocomplete="new-password" dir="ltr"></label>
    <p class="form-msg" data-msg></p>
    <button type="button" class="btn btn-primary btn-block" data-save>حفظ كلمة المرور</button>`});
  s.q('[data-save]').addEventListener('click', async e=>{
    const btn = e.currentTarget; btn.disabled = true;
    try{ await Auth.changePassword(s.q('[data-o]').value, s.q('[data-n]').value, s.q('[data-c]').value); s.close(); toast('تم تغيير كلمة المرور'); }
    catch(ex){ s.q('[data-msg]').textContent = errText(ex); btn.disabled = false; }
  });
}
async function logout(){
  if(!await confirmSheet({title:'تسجيل الخروج', message:'هل تريد تسجيل الخروج من هذا الجهاز؟', ok:'تسجيل الخروج'})) return;
  try{ Store.onSync('syncing'); await Store.pendingSync; }
  catch(e){
    if(!await confirmSheet({title:'تعذرت المزامنة', message:'مواعيدك محفوظة على هذا الجهاز، لكن تعذر التأكد من رفعها للسحابة. هل تخرج رغم ذلك؟', ok:'الخروج رغم ذلك', danger:true})) return;
  }
  await Auth.signOut();
  [...UI.openSheets].forEach(x => x.close());
  window.scrollTo(0,0);
  showLock();
}

/* ---------- الإدارة ---------- */
function openAdmin(){
  if(!isAdminUser()) return;
  let filter = 'pending';
  const STATUS = {pending:'بانتظار الموافقة', approved:'معتمد', rejected:'مرفوض', disabled:'معطّل', deleted:'محذوف'};
  const s = sheet({title:'الإدارة', cls:'tall', back:openAccount, html:`<div class="chips sticky-chips" data-chips></div><div class="stack" data-list><div class="empty"><p>جارٍ التحميل…</p></div></div>`});
  let users = [];
  const paint = ()=>{
    const real = users.filter(u => u && u.uid);
    const notAdmin = real.filter(u => String(u.identifier || '').toLowerCase() !== ADMIN_EMAIL);
    const appr = notAdmin.filter(u => (u.approvalStatus || 'approved') === 'approved');
    const c = { pending:notAdmin.filter(u => u.approvalStatus === 'pending').length, all:real.length,
      family:appr.filter(u => normalizeUserCategory(u.category) === 'family').length,
      work:appr.filter(u => normalizeUserCategory(u.category) === 'work').length,
      general:appr.filter(u => normalizeUserCategory(u.category) === 'general').length };
    const chip = (k, t) => `<button type="button" class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${t} <b>${c[k]}</b></button>`;
    s.q('[data-chips]').innerHTML = chip('pending','طلبات جديدة') + chip('all','الكل') + chip('family','عائلة') + chip('work','عمل') + chip('general','عام');
    let list = real;
    if(filter === 'pending') list = notAdmin.filter(u => u.approvalStatus === 'pending');
    else if(filter !== 'all') list = appr.filter(u => normalizeUserCategory(u.category) === filter);
    const order = {pending:0, approved:1, disabled:2, rejected:3, deleted:4};
    list.sort((a,b)=> (order[a.approvalStatus] ?? 1) - (order[b.approvalStatus] ?? 1) || userVisibleName(a).localeCompare(userVisibleName(b), 'ar'));
    const box = s.q('[data-list]');
    if(!list.length){ box.innerHTML = `<div class="empty"><p>${filter === 'pending' ? 'لا توجد طلبات تسجيل جديدة.' : 'لا يوجد مستخدمون هنا.'}</p></div>`; return; }
    box.innerHTML = list.map(u=>{
      const adm = String(u.identifier || '').toLowerCase() === ADMIN_EMAIL;
      const st = u.approvalStatus || 'approved', cat = normalizeUserCategory(u.category);
      const hidden = Boolean(u.hiddenFromDirectory) || cat === 'hidden';
      let btns = '';
      if(!adm){
        if(st === 'pending') btns = `<button type="button" class="btn btn-primary" data-x="approve">قبول</button><button type="button" class="btn btn-line" data-x="reject">رفض</button>`;
        else if(st === 'approved') btns = `<button type="button" class="btn btn-line" data-x="disable">تعطيل</button><button type="button" class="btn btn-danger" data-x="wipe">مسح البيانات</button>`;
        else btns = `<button type="button" class="btn btn-soft" data-x="enable">إعادة تفعيل</button><button type="button" class="btn btn-danger" data-x="wipe">مسح البيانات</button>`;
      }
      return `<div class="user-card" data-uid="${escapeHtml(u.uid)}">
        <div class="uh"><div style="min-width:0"><div class="un">${adm ? '👑 ' : ''}${escapeHtml(userVisibleName(u))}</div><div class="ue">${escapeHtml(u.identifier || '')}</div></div>
          <span class="status ${st}">${adm ? 'مدير' : STATUS[st] || 'معتمد'}</span></div>
        ${adm ? '' : `<div class="ua"><select data-cat aria-label="التصنيف">${Object.entries(USER_CATEGORIES).map(([k,v]) => `<option value="${k}" ${k === cat ? 'selected' : ''}>${v}</option>`).join('')}</select>${btns}</div>
        <div class="switch-row" style="min-height:40px;padding:0"><span class="label" style="font-weight:500;font-size:14.5px">يظهر في قائمة المشاركة</span>
          <label class="switch"><input type="checkbox" data-vis ${!hidden && st === 'approved' ? 'checked' : ''} ${st !== 'approved' || cat === 'hidden' ? 'disabled' : ''} aria-label="يظهر في قائمة المشاركة"><i></i></label></div>`}
      </div>`;
    }).join('');
  };
  UI.adminRefresh = list => { users = list; if(!s.closed) paint(); };
  s.onClose = ()=>{ UI.adminRefresh = null; };
  db('directory').once('value').then(sn => { users = Object.values(sn.val() || {}); paint(); })
    .catch(()=>{ s.q('[data-list]').innerHTML = `<div class="empty"><p>تعذر تحميل المستخدمين.</p></div>`; });
  s.body.addEventListener('click', async e=>{
    const f = e.target.closest('[data-f]'); if(f){ filter = f.dataset.f; paint(); s.body.scrollTo({top:0}); return; }
    const x = e.target.closest('[data-x]'); if(!x) return;
    const card = x.closest('[data-uid]'), u = users.find(v => v.uid === card.dataset.uid); if(!u) return;
    const cat = card.querySelector('[data-cat]')?.value || normalizeUserCategory(u.category);
    const act = x.dataset.x;
    const ACTS = {
      approve:[{approvalStatus:'approved', category:cat, hiddenFromDirectory:cat === 'hidden'}, 'قبول', false, 'تم قبول الحساب'],
      reject:[{approvalStatus:'rejected', hiddenFromDirectory:true}, 'رفض', true, 'تم رفض الطلب'],
      disable:[{approvalStatus:'disabled', hiddenFromDirectory:true}, 'تعطيل', true, 'تم تعطيل الحساب'],
      enable:[{approvalStatus:'approved', hiddenFromDirectory:cat === 'hidden'}, 'إعادة تفعيل', false, 'أُعيد تفعيل الحساب']
    };
    try{
      if(act === 'wipe'){
        if(!await confirmSheet({title:'مسح بيانات المستخدم', message:`ستُمسح مواعيد ودعوات ${userVisibleName(u)} ويُمنع من الدخول. حسابه في Firebase Authentication يبقى حتى تحذفه من لوحة Firebase.`, ok:'مسح البيانات', danger:true})) return;
        await deleteManagedUserData(u); toast('مُسحت البيانات ومُنع الدخول');
      }else{
        const [chg, word, danger, done] = ACTS[act];
        if(!await confirmSheet({title:'تأكيد', message:`${word} حساب ${userVisibleName(u)}؟`, ok:word, danger})) return;
        await setManagedUserState(u, chg); toast(done);
      }
    }catch(ex){ toast('تعذر تنفيذ الإجراء. تحقق من صلاحيات قاعدة البيانات.', true); }
  });
  s.body.addEventListener('change', async e=>{
    const card = e.target.closest('[data-uid]'); if(!card) return;
    const u = users.find(v => v.uid === card.dataset.uid); if(!u) return;
    try{
      if(e.target.matches('[data-cat]')){
        const v = e.target.value;
        if(u.approvalStatus === 'pending') return; // يُطبَّق عند القبول
        await setManagedUserState(u, {category:v, hiddenFromDirectory:v === 'hidden'}); toast('تم حفظ التصنيف');
      }else if(e.target.matches('[data-vis]')){
        await setManagedUserState(u, {hiddenFromDirectory:!e.target.checked});
        toast(e.target.checked ? 'يظهر الآن في المشاركة' : 'أُخفي من المشاركة');
      }
    }catch(ex){ toast('تعذر الحفظ', true); }
  });
}

/* ============================================================
   التشغيل
   ============================================================ */
(function start(){
  const h = gregToHijri(new Date());
  $('bootMoon').innerHTML = moonSvg(h?.day || 1, 72);
  setMonthFromDate(new Date(), 'greg');
  let decided = false;
  if(AUTH_ACTION){                       // فُتح التقويم من رابط «إعادة تعيين كلمة المرور»
    initFirebase(()=>{});
    if(Store.fbReady){ firebase.auth().signOut().catch(()=>{}); showResetScreen(); }
    else showLock();
    return;
  }
  initFirebase((user, msg)=>{
    if(user){ decided = true; enter(user).catch(e=>{ console.error(e); showLock(); }); }
    else if(!Store.user){ decided = true; showLock(msg || ''); }
  });
  setTimeout(()=>{ if(!decided && !Store.user) showLock(); }, Store.fbReady ? 6000 : 0);

  // تحديث عند تغيّر اليوم
  UI.lastDay = ymd(new Date());
  setInterval(()=>{
    const d = ymd(new Date());
    if(d !== UI.lastDay){ UI.lastDay = d; renderAll(); }
  }, 60000);
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && ymd(new Date()) !== UI.lastDay){ UI.lastDay = ymd(new Date()); renderAll(); } });
  window.addEventListener('storage', e=>{
    if(e.key !== LS_INVITES || !Store.user) return;
    const before = pendingInvites().length;
    Store.invites = loadInvitesLocal();
    renderAll();
    if(pendingInvites().length > before) toast('وصلتك دعوة موعد جديدة');
  });
})();
