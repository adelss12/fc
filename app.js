    document.title = `${APP_INFO.name} - ${APP_INFO.version}`;
/* ============================================================
   التقويم الشخصي
   - الأحداث في localStorage (للسرعة)
   - النسخة في IndexedDB
   ============================================================ */

const LS_USERS   = 'cal_users_v2';
const LS_SESSION = 'cal_session_user_v2';
const LS_EMAIL_SIGNIN = 'cal_email_signin_v1';
const LS_EVTS_BASE = 'cal_events_v2';
const LS_INVITES = 'cal_shared_invites_v1';
const ADMIN_EMAIL = 'iadelss12@gmail.com';
const USER_CATEGORIES = { family:'👨‍👩‍👧‍👦 عائلة', work:'💼 عمل', general:'👤 عام', hidden:'🔒 مخفي' };
function normalizeUserCategory(v){ return USER_CATEGORIES[v] ? v : 'general'; }
function userCategoryLabel(v){ return USER_CATEGORIES[normalizeUserCategory(v)]; }

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBiQR0DdTf_pAbu-vMG-SWr16Z1FlBC4F8",
    authDomain: "calendartest-20650.firebaseapp.com",
    databaseURL: "https://calendartest-20650-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "calendartest-20650",
    storageBucket: "calendartest-20650.firebasestorage.app",
    messagingSenderId: "134189882922",
    appId: "1:134189882922:web:8071bd543e4e221398ed53"


};

let _eventsCache = [];
let _fbReady = false;
let _authReady = false;
let _currentUser = null;
let _fbEventsRef = null;
let _fbListener = null;
let _fbInvitesRef = null;
let _fbInvitesListener = null;
let _sharedEventsCache = {};
let _sharedEventRefs = {};
let _adminDirectoryRef = null;
let _adminDirectoryListener = null;
let _creatingAccount = false;

const $ = id => document.getElementById(id);
const arDays   = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const arMonths = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const hijriMonths = [
  'محرم','صفر','ربيع الأول','ربيع الآخر','جمادى الأولى','جمادى الآخرة',
  'رجب','شعبان','رمضان','شوال','ذو القعدة','ذو الحجة'
];

function toast(msg, type='ok'){
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._tm);
  t._tm = setTimeout(()=>t.classList.remove('show'), 2400);
}
function setSyncStatus(msg, type='ok'){
  const el = $('syncStatus');
  if(!el) return;
  el.textContent = msg;
  el.style.color = type === 'err' ? '#fecaca' : (type === 'warn' ? '#fde68a' : '#e0f2fe');
}

/* مودال تأكيد عام (يستخدم بدلاً من confirm) */
function confirmDialog({title='تأكيد', message='هل أنت متأكد؟', okText='حسناً', cancelText='إلغاء', danger=false}={}){
  return new Promise(resolve=>{
    const modal = $('confirmModal');
    $('confirmTitle').textContent = title;
    $('confirmMsg').textContent   = message;
    const okBtn     = $('confirmOk');
    const cancelBtn = $('confirmCancel');
    okBtn.textContent     = okText;
    cancelBtn.textContent = cancelText;
    okBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');

    const cleanup = ()=>{
      modal.classList.remove('show');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBg);
      document.removeEventListener('keydown', onKey);
    };
    const onOk     = ()=>{ cleanup(); resolve(true); };
    const onCancel = ()=>{ cleanup(); resolve(false); };
    const onBg     = e=>{ if(e.target.id==='confirmModal') onCancel(); };
    const onKey    = e=>{
      if(e.key==='Escape') onCancel();
      else if(e.key==='Enter') onOk();
    };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBg);
    document.addEventListener('keydown', onKey);
    modal.classList.add('show');
  });
}

async function hashPw(pw){
  const enc = new TextEncoder().encode(pw);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function toEnglishDigits(value){
  return String(value || '').replace(/[٠-٩]/g, d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
}
function normalizePhone(phone){
  let v = toEnglishDigits(phone).trim().replace(/[\s\-().]/g, '');
  if(v.startsWith('00')) v = '+' + v.slice(2);
  if(/^05\d{8}$/.test(v)) return '+966' + v.slice(1);
  if(/^5\d{8}$/.test(v)) return '+966' + v;
  if(/^9665\d{8}$/.test(v)) return '+' + v;
  if(/^\+\d{8,15}$/.test(v)) return v;
  return v;
}
function normalizeIdentifier(value){
  const raw = String(value || '').trim();
  if(raw.includes('@')) return raw.toLowerCase();
  return normalizePhone(raw);
}
function isValidEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim().toLowerCase());
}
function isValidPhone(value){
  return /^\+\d{8,15}$/.test(normalizePhone(value));
}
function isValidIdentifier(value){
  const clean = normalizeIdentifier(value);
  return isValidEmail(clean) || isValidPhone(clean);
}
function displayUser(userOrIdentifier){
  if(!userOrIdentifier) return '';
  if(typeof userOrIdentifier === 'string') return userOrIdentifier;
  return userOrIdentifier.displayName || userOrIdentifier.email || '';
}
function isAdminUser(user=_currentUser){
  return String(user?.email || '').trim().toLowerCase() === ADMIN_EMAIL;
}
function userVisibleName(u){
  return String(u?.displayName || u?.name || u?.identifier || 'مستخدم');
}
function userVisibleEmail(u){
  return isAdminUser() ? String(u?.identifier || u?.email || '') : '';
}
function hasFirebaseConfig(){
  const cfg = FIREBASE_CONFIG;
  return !!(cfg && cfg.apiKey && cfg.apiKey !== 'REPLACE_ME' && cfg.authDomain && cfg.authDomain !== 'REPLACE_ME');
}
function identifierKey(identifier){
  return btoa(String(identifier || '')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function firebaseUserToAppUser(fbUser, identifier){
  const clean = normalizeIdentifier(identifier || fbUser.phoneNumber || fbUser.email || '');
  return {
    id:fbUser.uid,
    email:clean,
    displayName:fbUser.displayName || clean,
    loginType:isValidEmail(clean) ? 'email' : 'phone',
    authUid:fbUser.uid,
    createdAt:new Date().toISOString()
  };
}
function safeFilePart(value){
  return String(value || 'user').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'user';
}
function timestampForFile(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}-${String(d.getMinutes()).padStart(2,'0')}-${String(d.getSeconds()).padStart(2,'0')}`;
}
function userEventsKey(){
  if(!_currentUser) return `${LS_EVTS_BASE}_guest`;
  return `${LS_EVTS_BASE}_${_currentUser.id}`;
}
function loadUsers(){
  try{ return JSON.parse(localStorage.getItem(LS_USERS) || '{}') || {}; }
  catch(e){ return {}; }
}
function saveUsers(users){
  localStorage.setItem(LS_USERS, JSON.stringify(users));
}
async function getOrCreateUser(email, displayName=''){
  const clean = normalizeIdentifier(email);
  const name = String(displayName || '').trim();
  const users = loadUsers();
  if(!users[clean]){
    users[clean] = {
      id:(await hashPw(clean)).slice(0,24),
      email:clean,
      displayName:name || clean,
      loginType:isValidEmail(clean) ? 'email' : 'phone',
      createdAt:new Date().toISOString()
    };
    saveUsers(users);
  }else if(name && users[clean].displayName !== name){
    users[clean].displayName = name;
    saveUsers(users);
  }else if(!users[clean].displayName){
    users[clean].displayName = users[clean].email || clean;
    saveUsers(users);
  }
  return users[clean];
}
function setCurrentUser(user){
  _currentUser = user;
  if(user) localStorage.setItem(LS_SESSION, user.email);
  else localStorage.removeItem(LS_SESSION);
}
async function saveFirebaseUserProfile(user, {isNew=false}={}){
  if(!_fbReady || !user) return null;
  const profileRef = firebase.database().ref(`users/${user.id}/profile`);
  let existing = {};
  try{ existing = (await profileRef.once('value')).val() || {}; }catch(e){}
  const admin = isAdminUser(user);
  const approvalStatus = admin ? 'approved' : (isNew ? 'pending' : (existing.approvalStatus || 'approved'));
  const hiddenFromDirectory = admin ? false : Boolean(existing.hiddenFromDirectory);
  const category = admin ? 'general' : (isNew ? 'general' : normalizeUserCategory(existing.category));
  const profile = {
    uid:user.id,
    identifier:user.email,
    displayName:displayUser(user),
    loginType:user.loginType || (isValidEmail(user.email) ? 'email' : 'phone'),
    role:admin ? 'admin' : 'user',
    approvalStatus,
    hiddenFromDirectory,
    category,
    createdAt:existing.createdAt || user.createdAt || new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
  try{
    await profileRef.update(profile);
    await firebase.database().ref(`directory/${identifierKey(user.email)}`).set(profile);
    await firebase.database().ref(`publicDirectory/${user.id}`).set({
      uid:user.id,
      displayName:profile.displayName,
      approvalStatus:profile.approvalStatus,
      hiddenFromDirectory:profile.hiddenFromDirectory,
      category:profile.category,
      updatedAt:profile.updatedAt
    });
    if(profile.approvalStatus === 'approved' && !profile.hiddenFromDirectory){
      const directoryEntry = {
        uid:user.id,
        displayName:profile.displayName,
        category:profile.category,
        role:profile.role,
        updatedAt:profile.updatedAt
      };
      if(admin){
        // المدير يظهر لجميع التصنيفات حتى يستطيع أي مستخدم مشاركة حدث معه.
        await Promise.all(['family','work','general'].map(cat =>
          firebase.database().ref(`groupDirectories/${cat}/${user.id}`).set({
            ...directoryEntry,
            category:cat,
            sourceCategory:'admin'
          })
        ));
      }else{
        await firebase.database().ref(`groupDirectories/${profile.category}/${user.id}`).set(directoryEntry);
      }
    }
    return profile;
  }catch(e){
    console.error('تعذر حفظ ملف المستخدم:', e);
    return profile;
  }
}

async function getUserAccessStatus(user){
  if(isAdminUser(user)) return {allowed:true,status:'approved'};
  try{
    const profile = (await firebase.database().ref(`users/${user.id}/profile`).once('value')).val() || {};
    const status = profile.approvalStatus || 'approved'; // الحسابات القديمة تُعد معتمدة
    return {allowed:status === 'approved', status, profile};
  }catch(e){
    return {allowed:false,status:'error'};
  }
}

function accessStatusMessage(status){
  if(status === 'pending') return 'تم إنشاء الحساب وهو بانتظار موافقة المدير.';
  if(status === 'rejected') return 'لم تتم الموافقة على هذا الحساب. تواصل مع مدير التطبيق.';
  if(status === 'disabled') return 'هذا الحساب معطّل مؤقتًا من مدير التطبيق.';
  if(status === 'deleted') return 'تم حذف بيانات هذا الحساب من التطبيق. تواصل مع المدير.';
  return 'تعذر التحقق من صلاحية الحساب الآن.';
}

function loadInvites(){
  try{ return JSON.parse(localStorage.getItem(LS_INVITES) || '[]') || []; }
  catch(e){ return []; }
}
function saveInvites(invites){
  localStorage.setItem(LS_INVITES, JSON.stringify(invites));
}
function pendingInvitesForCurrentUser(){
  if(!_currentUser) return [];
  return loadInvites().filter(x => (x.toUserId === _currentUser.id || x.toEmail === _currentUser.email) && x.status === 'pending');
}

function roleLabel(role){
  if(role === 'owner') return '👑 مالك';
  if(role === 'editor') return '✏️ مشترك - تعديل';
  if(role === 'viewer') return '👥 مشترك';
  return '👤 خاص';
}
function eventTypeIcon(ev){
  if(ev?.tag === 'sa'){
    if(ev.saGroup === 'school') return '🎓';
    if(ev.saGroup === 'salary') return '💰';
    return ev.title?.startsWith('🌙') ? '🌙' : '🇸🇦';
  }
  if(ev?.isShared || ev?.type === 'sharedRef') return '👥';
  return '📅';
}
function canEditEvent(ev){
  if(!ev || !_currentUser) return false;
  if(!ev.isShared) return true;
  return ev.ownerId === _currentUser.id || ev.sharedRole === 'owner' || ev.sharedRole === 'editor';
}
function canShareEvent(ev){
  if(!ev || !_currentUser) return false;
  return !ev.isShared || ev.ownerId === _currentUser.id || ev.sharedRole === 'owner';
}
function resolveEvent(ev){
  if(!ev || ev.hiddenFromCalendar === true) return null;
  if(ev.type === 'sharedRef' && ev.sharedEventId){
    const shared = _sharedEventsCache[ev.sharedEventId];
    if(shared && shared.deleted) return null;
    if(!shared){
      // عرض نسخة الدعوة المحفوظة محليًا حتى لو لم يصل تحديث الحدث المشترك بعد
      return {
        ...ev,
        id:ev.id,
        localRefId:ev.id,
        isShared:true,
        sharedRole:ev.role || 'viewer',
        sharedFrom:ev.sharedFrom || 'مستخدم آخر'
      };
    }
    const role = shared.roles?.[_currentUser?.id] || ev.role || 'viewer';
    return {
      ...shared,
      id:ev.id,
      localRefId:ev.id,
      sharedEventId:ev.sharedEventId,
      isShared:true,
      sharedRole:role,
      sharedFrom:shared.ownerName || shared.ownerEmail || ev.sharedFrom || 'مستخدم آخر'
    };
  }
  const legacyShared = !!(
    ev.type === 'sharedRef' ||
    ev.sharedEventId ||
    ev.sharedInviteId ||
    ev.sharedFrom ||
    ev.fromUserId ||
    ev.ownerEmail ||
    ev.role === 'viewer' ||
    ev.role === 'editor'
  );
  const ownedByCurrent = !!(ev.ownerId && _currentUser && ev.ownerId === _currentUser.id);
  return {
    ...ev,
    isShared:legacyShared && !ownedByCurrent,
    sharedRole: ev.sharedRole || ev.role || (ownedByCurrent ? 'owner' : (legacyShared ? 'viewer' : undefined)),
    sharedFrom: ev.sharedFrom || ev.fromName || ev.fromEmail || ev.ownerName || ev.ownerEmail || ''
  };
}
function getDisplayEvents(){
  return loadEvents().map(resolveEvent).filter(Boolean);
}
function detachSharedEventListeners(){
  if(!_fbReady) return;
  for(const id of Object.keys(_sharedEventRefs)){
    const rec = _sharedEventRefs[id];
    try{ rec.ref.off('value', rec.listener); }catch(e){}
  }
  _sharedEventRefs = {};
}
function watchSharedEvent(sharedEventId){
  if(!_fbReady || !sharedEventId || _sharedEventRefs[sharedEventId]) return;
  const ref = firebase.database().ref(`sharedEvents/${sharedEventId}`);
  const listener = sn=>{
    const val = sn.val();
    if(val) _sharedEventsCache[sharedEventId] = val;
    else delete _sharedEventsCache[sharedEventId];
    if(typeof refreshAll === 'function') refreshAll();
  };
  _sharedEventRefs[sharedEventId] = {ref, listener};
  ref.on('value', listener);
}
function watchSharedEventsFromLocalRefs(){
  detachSharedEventListeners();
  for(const ev of loadEvents()){
    if(ev && ev.type === 'sharedRef' && ev.sharedEventId) watchSharedEvent(ev.sharedEventId);
  }
}
async function upsertSharedEventFromLocal(ev){
  if(!_fbReady || !_currentUser || !ev || !ev.sharedEventId) return;
  const sharedId = ev.sharedEventId;
  const ref = firebase.database().ref(`sharedEvents/${sharedId}`);
  const sn = await ref.once('value');
  const old = sn.val() || {};
  const roles = old.roles || {};
  roles[_currentUser.id] = 'owner';
  const shared = {
    ...old,
    id:sharedId,
    title:ev.title,
    calType:ev.calType || 'greg',
    date:ev.date,
    ownerId:_currentUser.id,
    ownerEmail:_currentUser.email,
    ownerName:displayUser(_currentUser),
    roles,
    deleted:false,
    updatedAt:new Date().toISOString(),
    createdAt:old.createdAt || ev.createdAt || new Date().toISOString()
  };
  await ref.set(shared);
  _sharedEventsCache[sharedId] = shared;
}
function parseShareRecipients(value){
  const raw = String(value || '').trim();
  if(!raw) return [];
  if(['الكل','all','*'].includes(raw.toLowerCase())){
    return Object.values(loadUsers())
      .map(u => u.email)
      .filter(email => email && (!_currentUser || email !== _currentUser.email));
  }
  return [...new Set(raw.split(/[,\n،;]+/).map(normalizeIdentifier).filter(Boolean))];
}

/* ---- التحويل بين الميلادي والهجري (تقويم أم القرى الرسمي) ---- */
/* يستخدم Intl.DateTimeFormat مع islamic-umalqura، وهو التقويم المعتمد رسمياً
   في المملكة العربية السعودية، ومدعوم في كل المتصفحات الحديثة بما فيها iOS Safari */
function gregToHijri(date){
  try{
    const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura',{
      year:'numeric',month:'numeric',day:'numeric',
      timeZone:'Asia/Riyadh'
    });
    const parts = fmt.formatToParts(date);
    const get = t => parts.find(p=>p.type===t)?.value;
    return { year:parseInt(get('year')), month:parseInt(get('month')), day:parseInt(get('day')) };
  }catch(e){ return null; }
}
function formatHijri(h){ return h ? `${h.day} ${hijriMonths[h.month-1]} ${h.year}هـ` : ''; }

/* تحويل دقيق من هجري (أم القرى) إلى ميلادي
   يستخدم تقريباً سريعاً ثم يعدّل يوماً بيوم بالاعتماد على gregToHijri الذي
   يستخدم أم القرى — فالنتيجة مضمونة الدقة 100% مطابقة لأم القرى */
function hijriToGreg(hy, hm, hd){
  // تخمين أولي: متوسط طول السنة الهجرية = 354.367 يوم، 1 محرم 1 هـ ≈ 16 يوليو 622 م
  const guessMs = Date.UTC(622, 6, 16) + (hy - 1) * 354.367 * 86400000;
  let d = new Date(guessMs);

  // مرحلة 1: اقتراب سريع باستخدام إجمالي الأيام التقريبي
  for(let i=0; i<15; i++){
    const h = gregToHijri(d);
    if(!h) return null;
    const targetDays = (hy * 12 + hm) * 29.530589 + hd;
    const curDays    = (h.year * 12 + h.month) * 29.530589 + h.day;
    const diff = Math.round(targetDays - curDays);
    if(diff === 0) break;
    d = new Date(d.getTime() + diff * 86400000);
  }

  // مرحلة 2: تعديل نهائي يوماً بيوم لضمان التطابق التام
  for(let i=0; i<90; i++){
    const h = gregToHijri(d);
    if(!h) return null;
    if(h.year===hy && h.month===hm && h.day===hd) return d;
    const tooLow = (h.year < hy)
      || (h.year===hy && h.month < hm)
      || (h.year===hy && h.month===hm && h.day < hd);
    d = new Date(d.getTime() + (tooLow ? 1 : -1) * 86400000);
  }
  return d;
}

function dateOnly(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function diffDays(from, to){ return Math.round((dateOnly(to).getTime()-dateOnly(from).getTime())/86400000); }
function diffYMD(a, b){
  a = dateOnly(a); b = dateOnly(b);
  if(a > b){ [a,b]=[b,a]; }
  let y=b.getFullYear()-a.getFullYear(), m=b.getMonth()-a.getMonth(), d=b.getDate()-a.getDate();
  if(d<0){ m--; d += new Date(b.getFullYear(), b.getMonth(), 0).getDate(); }
  if(m<0){ y--; m+=12; }
  return {y,m,d};
}
function fmtYMD(o){
  const p=[];
  if(o.y>0) p.push(`${o.y} سنة`);
  if(o.m>0) p.push(`${o.m} شهر`);
  if(o.d>0 || p.length===0) p.push(`${o.d} يوم`);
  return p.join(' و ');
}
function fmtYMDShort(o){
  // مختصر للعرض على سطر واحد
  if(o.y>0) return `${o.y}س ${o.m}ش ${o.d}ي`;
  if(o.m>0) return `${o.m}ش ${o.d}ي`;
  return `${o.d} ${o.d===1?'يوم':o.d===2?'يومان':'أيام'}`;
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function gregDateToInputValue(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fillHijriControls(){
  const day=$('evHijriDay'), month=$('evHijriMonth'), year=$('evHijriYear');
  if(!day || !month || !year || day.options.length) return;
  for(let d=1; d<=30; d++){
    const o=document.createElement('option'); o.value=d; o.textContent=d; day.appendChild(o);
  }
  hijriMonths.forEach((name, i)=>{
    const o=document.createElement('option'); o.value=i+1; o.textContent=name; month.appendChild(o);
  });
  const curH = gregToHijri(new Date())?.year || 1447;
  for(let y=curH-5; y<=curH+10; y++){
    const o=document.createElement('option'); o.value=y; o.textContent=y + ' هـ'; year.appendChild(o);
  }
}
function setHijriControlsFromDate(date){
  fillHijriControls();
  const h = gregToHijri(date || new Date());
  if(!h) return;
  $('evHijriDay').value = String(h.day);
  $('evHijriMonth').value = String(h.month);
  $('evHijriYear').value = String(h.year);
  updateHijriPreview();
}
function selectedHijriDateToGreg(){
  fillHijriControls();
  const hy = Number($('evHijriYear')?.value);
  const hm = Number($('evHijriMonth')?.value);
  const hd = Number($('evHijriDay')?.value);
  if(!hy || !hm || !hd) return null;
  return hijriToGreg(hy, hm, hd);
}
function updateHijriPreview(){
  const box = $('hijriPreview');
  if(!box) return;
  const g = selectedHijriDateToGreg();
  if(!g){ box.textContent='تعذّر تحويل التاريخ الهجري'; return; }
  box.textContent = `يقابله ميلاديًا: ${g.getDate()} ${arMonths[g.getMonth()]} ${g.getFullYear()} م`;
}
function updateDateMode(){
  const type = $('evCalType')?.value || 'greg';
  const gregLabel = $('gregDateLabel'), hijriLabel = $('hijriDateLabel'), evDate = $('evDate');
  if(type === 'hijri'){
    if(gregLabel) gregLabel.style.display='none';
    if(hijriLabel) hijriLabel.style.display='flex';
    if(evDate) evDate.required = false;
    fillHijriControls();
    if(evDate?.value){
      const [y,m,d]=evDate.value.split('-').map(Number);
      if(y && m && d) setHijriControlsFromDate(new Date(y,m-1,d));
    }else{
      setHijriControlsFromDate(new Date());
    }
  }else{
    if(gregLabel) gregLabel.style.display='flex';
    if(hijriLabel) hijriLabel.style.display='none';
    if(evDate) evDate.required = true;
  }
}

/* ============================================================
   شاشة القفل
   ============================================================ */
let _authMode = 'login';
function setAuthMode(mode){
  _authMode = mode === 'signup' ? 'signup' : 'login';
  const isSignup = _authMode === 'signup';
  const nameRow = $('fullNameRow') || $('fullNameInput')?.closest('.input-row');
  const confirmRow = $('passwordConfirmRow') || $('passwordConfirmInput')?.closest('.input-row');
  if(nameRow) nameRow.style.display = isSignup ? '' : 'none';
  if(confirmRow) confirmRow.style.display = isSignup ? '' : 'none';
  $('lockTitle').textContent = isSignup ? 'إنشاء حساب جديد' : 'التقويم الشخصي';
  $('lockSubtitle').textContent = isSignup ? 'أدخل بياناتك لإنشاء حساب جديد' : 'سجّل دخولك إلى حسابك';
  $('lockBtn').textContent = isSignup ? 'إنشاء الحساب' : 'دخول';
  $('createAccountBtn').textContent = isSignup ? 'لديك حساب؟ تسجيل الدخول' : 'إنشاء حساب جديد';
  $('otpHint').textContent = isSignup ? 'أدخل الاسم الكامل والبريد وكلمة المرور وتأكيدها.' : 'ليس لديك حساب؟ اضغط إنشاء حساب جديد.';
  $('lockErr').textContent = '';
  if(!isSignup){
    if($('fullNameInput')) $('fullNameInput').value = '';
    if($('passwordConfirmInput')) $('passwordConfirmInput').value = '';
  }
}
async function initLock(){
  setAuthMode('login');
  $('lockErr').textContent = '';
  if($('passwordInput')) $('passwordInput').value = '';
  if($('passwordConfirmInput')) $('passwordConfirmInput').value = '';
  if($('fullNameInput')) $('fullNameInput').value = '';
  const lastEmail = localStorage.getItem(LS_SESSION);
  if(lastEmail) $('emailInput').value = lastEmail;
  if(!_fbReady){
    $('otpHint').textContent = 'أضف FIREBASE_CONFIG وفعّل Email/Password حتى يعمل الدخول.';
  }
}
function getLoginFields(){
  const fullName = String($('fullNameInput')?.value || '').trim();
  const email = normalizeIdentifier($('emailInput').value);
  const password = $('passwordInput').value;
  const confirmPassword = $('passwordConfirmInput')?.value || '';
  return { fullName, email, password, confirmPassword };
}
function validateEmailPassword(email, password){
  if(!isValidEmail(email)) return 'أدخل بريدًا إلكترونيًا صحيحًا';
  if(!password || password.length < 6) return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
  return '';
}
function validateNewAccount(fullName, email, password, confirmPassword){
  const base = validateEmailPassword(email, password);
  if(base) return base;
  if(!fullName || fullName.length < 2) return 'أدخل الاسم الكامل لإنشاء الحساب';
  if(password !== confirmPassword) return 'تأكيد كلمة المرور غير متطابق';
  return '';
}
async function signInWithEmailPassword(){
  const err = $('lockErr');
  err.textContent = '';
  if(!_fbReady){ err.textContent = 'Firebase غير مفعّل. تأكد من FIREBASE_CONFIG أولاً.'; return; }
  const { email, password } = getLoginFields();
  const validation = validateEmailPassword(email, password);
  if(validation){ err.textContent = validation; return; }
  try{
    $('lockBtn').disabled = true;
    $('lockBtn').textContent = 'جاري الدخول...';
    const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
    const user = firebaseUserToAppUser(cred.user, email);
    if(user.displayName === user.email){
      const localUser = await getOrCreateUser(user.email);
      user.displayName = localUser.displayName || user.email;
    }
    await saveFirebaseUserProfile(user);
    const access = await getUserAccessStatus(user);
    if(!access.allowed){
      await firebase.auth().signOut().catch(()=>{});
      err.textContent = accessStatusMessage(access.status);
      return;
    }
    await enterApp(user);
    toast('تم تسجيل الدخول','ok');
  }catch(ex){
    if(ex && (ex.code === 'auth/user-not-found' || ex.code === 'auth/invalid-credential')){
      err.textContent = 'الحساب غير موجود أو كلمة المرور غير صحيحة. إذا لم يكن لديك حساب اضغط إنشاء حساب جديد.';
    }else{
      err.textContent = authErrorMessage(ex);
    }
  }finally{
    $('lockBtn').disabled = false;
    $('lockBtn').textContent = 'دخول';
  }
}
async function createAccountWithEmailPassword(){
  const err = $('lockErr');
  err.textContent = '';
  if(!_fbReady){ err.textContent = 'Firebase غير مفعّل. تأكد من FIREBASE_CONFIG أولاً.'; return; }
  const { fullName, email, password, confirmPassword } = getLoginFields();
  const validation = validateNewAccount(fullName, email, password, confirmPassword);
  if(validation){ err.textContent = validation; return; }
  try{
    $('lockBtn').disabled = true;
    $('lockBtn').textContent = 'جاري إنشاء الحساب...';
    _creatingAccount = true;
    const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName:fullName });
    const user = firebaseUserToAppUser(cred.user, email);
    user.displayName = fullName;
    await getOrCreateUser(user.email, fullName);
    const profile = await saveFirebaseUserProfile(user, {isNew:true});
    if(isAdminUser(user)){
      await enterApp(user);
      toast('تم إنشاء حساب المدير والدخول','ok');
    }else{
      await firebase.auth().signOut().catch(()=>{});
      setCurrentUser(null);
      setAuthMode('login');
      err.textContent = 'تم إنشاء الحساب بنجاح، وهو الآن بانتظار موافقة المدير.';
      $('otpHint').textContent = 'سيتمكن المستخدم من الدخول بعد قبول الطلب من حساب المدير.';
    }
  }catch(ex){
    err.textContent = authErrorMessage(ex);
  }finally{
    _creatingAccount = false;
    $('lockBtn').disabled = false;
    $('lockBtn').textContent = _authMode === 'signup' ? 'إنشاء الحساب' : 'دخول';
  }
}
async function sendPasswordReset(){
  const err = $('lockErr');
  err.textContent = '';
  if(!_fbReady){ err.textContent = 'Firebase غير مفعّل. تأكد من FIREBASE_CONFIG أولاً.'; return; }
  const email = normalizeIdentifier($('emailInput').value);
  if(!isValidEmail(email)){ err.textContent = 'اكتب بريدك الإلكتروني أولاً ثم اضغط نسيت كلمة المرور'; return; }
  try{
    $('resetPasswordBtn').disabled = true;
    $('resetPasswordBtn').textContent = 'جاري الإرسال...';
    await firebase.auth().sendPasswordResetEmail(email);
    $('otpHint').textContent = 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك.';
    toast('تم إرسال رابط إعادة التعيين','ok');
  }catch(ex){
    err.textContent = authErrorMessage(ex);
  }finally{
    $('resetPasswordBtn').disabled = false;
    $('resetPasswordBtn').textContent = 'نسيت كلمة المرور؟';
  }
}

$('lockForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(_authMode === 'signup') await createAccountWithEmailPassword();
  else await signInWithEmailPassword();
});
$('createAccountBtn').addEventListener('click', ()=>{
  setAuthMode(_authMode === 'signup' ? 'login' : 'signup');
});
$('resetPasswordBtn').addEventListener('click', sendPasswordReset);

async function enterApp(user){
  const accessInfo = await getUserAccessStatus(user);
  if(accessInfo?.profile) user.category = normalizeUserCategory(accessInfo.profile.category);
  setCurrentUser(user);
  $('currentUserLabel').textContent = displayUser(user) + (isAdminUser(user) ? ' 👑' : '');
  if($('welcomeName')) $('welcomeName').textContent = displayUser(user);
  if($('accountNameLabel')){ $('accountNameLabel').textContent = displayUser(user) + (isAdminUser(user) ? ' 👑 مدير' : ''); $('accountEmailLabel').textContent = user.email || ''; }
  await loadUserData();
  if($('adminUsersBtn')) $('adminUsersBtn').style.display = isAdminUser(user) ? '' : 'none';
  if(isAdminUser(user)) attachAdminDirectoryListener(); else detachAdminDirectoryListener();
  $('lockScreen').style.display='none';
  $('appMain').style.display='';
  $('bottomBar').style.display='flex';
  $('otpHint').textContent='';
  refreshAll();
  refreshBackupList();
  const pendingCount = pendingInvitesForCurrentUser().length;
  if(pendingCount > 0) toast(`لديك ${pendingCount} دعوة حدث واردة`,'ok');
}
function authErrorMessage(ex){
  const code = ex && ex.code;
  if(code === 'auth/email-already-in-use') return 'هذا البريد مسجل مسبقًا. استخدم زر دخول.';
  if(code === 'auth/user-not-found') return 'لا يوجد حساب بهذا البريد. أدخل الاسم الكامل وتأكيد كلمة المرور لإنشاء حساب.';
  if(code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'البريد أو كلمة المرور غير صحيحة.';
  if(code === 'auth/weak-password') return 'كلمة المرور ضعيفة. استخدم 6 أحرف على الأقل.';
  if(code === 'auth/invalid-email') return 'صيغة البريد الإلكتروني غير صحيحة.';
  if(code === 'auth/too-many-requests') return 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.';
  if(code === 'auth/requires-recent-login') return 'للحماية أعد تسجيل الدخول ثم حاول مرة أخرى.';
  if(code === 'auth/unauthorized-domain') return 'النطاق الحالي غير مصرح به في Firebase Authentication.';
  if(code === 'auth/operation-not-allowed') return 'فعّل Email/Password من Firebase Authentication.';
  return (ex && ex.message) ? ex.message : 'تعذر إكمال العملية. راجع إعدادات Firebase وحاول مجدداً.';
}
async function doLogout(){
  const ok = await confirmDialog({
    title:'تسجيل الخروج',
    message:'هل تريد تسجيل الخروج والعودة إلى شاشة تسجيل الدخول؟',
    okText:'تسجيل الخروج',
    danger:false
  });
  if(!ok) return;
  /* انتظر آخر عملية حفظ قبل إنهاء جلسة Firebase */
  try{
    setSyncStatus('☁️ جارٍ التأكد من حفظ مواعيدك...');
    await _pendingEventsSync;
  }catch(e){
    const continueLogout = await confirmDialog({
      title:'تعذرت المزامنة',
      message:'المواعيد محفوظة على هذا الجهاز، لكن تعذر تأكيد رفعها إلى Firebase. هل تريد تسجيل الخروج رغم ذلك؟',
      okText:'خروج رغم ذلك',
      cancelText:'إلغاء',
      danger:true
    });
    if(!continueLogout) return;
  }
  detachFirebaseUserListener();
  detachAdminDirectoryListener();
  if(_fbReady) await firebase.auth().signOut().catch(()=>{});
  setCurrentUser(null);
  _eventsCache = [];
  $('appMain').style.setProperty('display', 'none', 'important');
$('bottomBar').style.display='none';
window.scrollTo(0, 0);
  $('lockScreen').style.display='';
  initLock();
}

function refreshAccountModal(){
  if(!_currentUser) return;
  $('accountNameLabel').textContent = displayUser(_currentUser) + (isAdminUser() ? ' 👑 مدير' : '');
  $('accountEmailLabel').textContent = _currentUser.email || '';
}

$('accountBtn').addEventListener('click', ()=>{
  refreshAccountModal();
  $('accountModal').classList.add('show');
});

$('accountClose').addEventListener('click', ()=> $('accountModal').classList.remove('show'));
$('accountModal').addEventListener('click', e=>{ if(e.target.id==='accountModal') $('accountModal').classList.remove('show'); });



$('settingsBottomBtn').addEventListener('click', ()=>{
  $('settingsModal').classList.add('show');
});

$('settingsClose').addEventListener('click', ()=>{
  $('settingsModal').classList.remove('show');
});
$('settingsBackupBtn').addEventListener('click', ()=>{
  $('settingsModal').classList.remove('show');
  refreshBackupList();
  $('backupModal').classList.add('show');
});
$('settingsModal').addEventListener('click', e=>{
  if(e.target.id === 'settingsModal'){
    $('settingsModal').classList.remove('show');
  }
});
function refreshTimeDistanceEvents(){
  const select1 = $('timeEvent1');
  const select2 = $('timeEvent2');
  if(!select1 || !select2) return;

  const events = getDisplayEvents()
    .filter(Boolean)
    .sort((a,b)=> eventToGregDate(b) - eventToGregDate(a));

  const options = events.map(ev=>{
    return `<option value="${ev.id}">${escapeHtml(ev.title)}</option>`;
  }).join('');

  select1.innerHTML = `<option value="">اختر الحدث الأول</option>${options}`;
  select2.innerHTML = `<option value="">اختر الحدث الثاني</option>${options}`;

  $('timeEvent1Date').textContent = '';
  $('timeEvent2Date').textContent = '';
}

function updateTimeEventDate(selectId, outputId){
  const select = $(selectId);
  const output = $(outputId);
  if(!select || !output) return;

  const ev = getDisplayEvents().find(e => e.id === select.value);
  if(!ev){
    output.textContent = '';
    return;
  }

  const d = eventToGregDate(ev);
  output.textContent = `التاريخ: ${d.getDate()} ${arMonths[d.getMonth()]} ${d.getFullYear()} م`;
}

$('timeEvent1').addEventListener('change', ()=>{
  updateTimeEventDate('timeEvent1', 'timeEvent1Date');
});

$('timeEvent2').addEventListener('change', ()=>{
  updateTimeEventDate('timeEvent2', 'timeEvent2Date');
});

$('timeModeEventsBtn').addEventListener('click', ()=>{
  $('timeModeEventsBtn').classList.add('active');
  $('timeModeDatesBtn').classList.remove('active');
  $('timeEventsSection').style.display = '';
  $('timeDatesSection').style.display = 'none';
  $('timeDistanceResult').textContent = 'اختر حدثين أو تاريخين لحساب المدة.';
});

$('timeModeDatesBtn').addEventListener('click', ()=>{
  $('timeModeDatesBtn').classList.add('active');
  $('timeModeEventsBtn').classList.remove('active');
  $('timeEventsSection').style.display = 'none';
  $('timeDatesSection').style.display = '';
  $('timeDistanceResult').textContent = 'اختر تاريخين لحساب المدة.';
});

$('timeDistanceCalc').addEventListener('click', ()=>{
  const datesMode = $('timeModeDatesBtn').classList.contains('active');

  if(datesMode){
    const v1 = $('timeDate1').value;
    const v2 = $('timeDate2').value;

    if(!v1 || !v2){
      $('timeDistanceResult').textContent = 'اختر التاريخين أولاً.';
      return;
    }

    const [y1,m1,d1] = v1.split('-').map(Number);
    const [y2,m2,d2] = v2.split('-').map(Number);

    const date1 = new Date(y1, m1 - 1, d1);
    const date2 = new Date(y2, m2 - 1, d2);

    $('timeDistanceResult').textContent = fmtYMD(diffYMD(date1, date2));
    return;
  }

  const ev1 = getDisplayEvents().find(e => e.id === $('timeEvent1').value);
  const ev2 = getDisplayEvents().find(e => e.id === $('timeEvent2').value);

  if(!ev1 || !ev2){
    $('timeDistanceResult').textContent = 'اختر الحدثين أولاً.';
    return;
  }

  const d1 = eventToGregDate(ev1);
  const d2 = eventToGregDate(ev2);

  $('timeDistanceResult').textContent = fmtYMD(diffYMD(d1, d2));
});

$('timeDistanceBottomBtn').addEventListener('click', ()=>{
  refreshTimeDistanceEvents();

  $('timeModeEventsBtn').classList.add('active');
  $('timeModeDatesBtn').classList.remove('active');
  $('timeEventsSection').style.display = '';
  $('timeDatesSection').style.display = 'none';

  $('timeDistanceResult').textContent = 'اختر حدثين أو تاريخين لحساب المدة.';
  $('timeDistanceModal').classList.add('show');
});

$('timeDistanceClose').addEventListener('click', ()=>{
  $('timeDistanceModal').classList.remove('show');
});

$('timeDistanceModal').addEventListener('click', e=>{
  if(e.target.id === 'timeDistanceModal'){
    $('timeDistanceModal').classList.remove('show');
  }
});

$('backupClose').addEventListener('click', ()=> $('backupModal').classList.remove('show'));
$('backupModal').addEventListener('click', e=>{ if(e.target.id==='backupModal') $('backupModal').classList.remove('show'); });
$('saClose').addEventListener('click', ()=> $('saModal').classList.remove('show'));
$('saModal').addEventListener('click', e=>{ if(e.target.id==='saModal') $('saModal').classList.remove('show'); });

/* إدارة الحساب */
$('changePwBtn').addEventListener('click', doLogout);
$('editProfileBtn').addEventListener('click', ()=>{
  $('accountModal').classList.remove('show');
  $('profileName').value = displayUser(_currentUser);
  $('profileErr').textContent = '';
  $('profileModal').classList.add('show');
  setTimeout(()=>$('profileName').focus(), 50);
});
$('profileCancel').addEventListener('click', ()=> $('profileModal').classList.remove('show'));
$('profileModal').addEventListener('click', e=>{ if(e.target.id==='profileModal') $('profileModal').classList.remove('show'); });
$('profileSave').addEventListener('click', async ()=>{
  const err = $('profileErr'); err.textContent = '';
  const name = String($('profileName').value || '').trim();
  if(name.length < 2){ err.textContent = 'أدخل اسمًا صحيحًا'; return; }
  if(!_fbReady || !firebase.auth().currentUser || !_currentUser){ err.textContent = 'سجّل الدخول أولاً'; return; }
  try{
    $('profileSave').disabled = true;
    await firebase.auth().currentUser.updateProfile({ displayName:name });
    _currentUser.displayName = name;
    await getOrCreateUser(_currentUser.email, name);
    await saveFirebaseUserProfile(_currentUser);
    $('currentUserLabel').textContent = name;
      if($('welcomeName')) $('welcomeName').textContent = name;
    refreshAccountModal();
    $('profileModal').classList.remove('show');
    toast('تم تحديث الاسم','ok');
  }catch(ex){
    err.textContent = authErrorMessage(ex);
  }finally{
    $('profileSave').disabled = false;
  }
});
$('resetPasswordBtn').addEventListener('click', async ()=>{
  if(!_fbReady || !_currentUser?.email){ toast('سجّل الدخول أولاً','err'); return; }
  try{
    await firebase.auth().sendPasswordResetEmail(_currentUser.email);
    toast('تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك','ok');
  }catch(ex){
    toast(authErrorMessage(ex),'err');
  }
});
$('changePasswordBtn').addEventListener('click', ()=>{
  $('accountModal').classList.remove('show');
  $('pwOld').value=''; $('pwNew').value=''; $('pwNewConfirm').value='';
  $('pwErr').textContent='';
  $('pwModal').classList.add('show');
});
$('pwCancel').addEventListener('click', ()=> $('pwModal').classList.remove('show'));
$('pwModal').addEventListener('click', e=>{ if(e.target.id==='pwModal') $('pwModal').classList.remove('show'); });
$('pwSave').addEventListener('click', async ()=>{
  const err = $('pwErr'); err.textContent = '';
  const oldPw = $('pwOld').value;
  const newPw = $('pwNew').value;
  const confirm = $('pwNewConfirm').value;
  if(!oldPw){ err.textContent = 'أدخل كلمة المرور الحالية'; return; }
  if(!newPw || newPw.length < 6){ err.textContent = 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل'; return; }
  if(newPw !== confirm){ err.textContent = 'تأكيد كلمة المرور غير متطابق'; return; }
  if(!_fbReady || !firebase.auth().currentUser || !_currentUser){ err.textContent = 'سجّل الدخول أولاً'; return; }
  try{
    $('pwSave').disabled = true;
    const credential = firebase.auth.EmailAuthProvider.credential(_currentUser.email, oldPw);
    await firebase.auth().currentUser.reauthenticateWithCredential(credential);
    await firebase.auth().currentUser.updatePassword(newPw);
    $('pwModal').classList.remove('show');
    toast('تم تغيير كلمة المرور','ok');
  }catch(ex){
    err.textContent = authErrorMessage(ex);
  }finally{
    $('pwSave').disabled = false;
  }
});

/* ============================================================
   إدارة الأحداث
   ============================================================ */
function loadEvents(){ return _eventsCache; }

/*
  صيغة تخزين ثابتة للمواعيد داخل Firebase.
  السبب: Firebase قد يعيد المصفوفات ككائنات، خصوصًا بعد الحذف أو وجود فراغات
  بين الفهارس. لذلك نخزن المواعيد داخل items باستخدام id لكل موعد، مع meta
  تبقى موجودة حتى عندما تكون القائمة فارغة.
*/
function normalizeFirebaseEvents(raw){
  if(!raw) return [];
  if(Array.isArray(raw)) return raw.filter(Boolean);
  if(raw.items && typeof raw.items === 'object') return Object.values(raw.items).filter(Boolean);
  if(typeof raw === 'object'){
    return Object.entries(raw)
      .filter(([key]) => key !== '__meta' && key !== 'meta' && key !== 'items')
      .map(([, value]) => value)
      .filter(value => value && typeof value === 'object' && value.id);
  }
  return [];
}
function eventsToFirebasePayload(events){
  const items = {};
  for(const ev of (Array.isArray(events) ? events : [])){
    if(!ev || !ev.id) continue;
    items[ev.id] = ev;
  }
  return {
    __meta:{
      schema:2,
      count:Object.keys(items).length,
      updatedAt:new Date().toISOString()
    },
    items
  };
}
function isSchema2Events(raw){
  return !!(raw && typeof raw === 'object' && raw.__meta && Number(raw.__meta.schema) === 2);
}

let _pendingEventsSync = Promise.resolve();
function saveEvents(arr) {
  _eventsCache = Array.isArray(arr) ? arr.filter(Boolean) : [];
  localStorage.setItem(userEventsKey(), JSON.stringify(_eventsCache));
  if (_fbReady && _currentUser) {
    setSyncStatus('☁️ جاري المزامنة...');
    const ref = firebase.database().ref(`users/${_currentUser.id}/events`);
    const payload = eventsToFirebasePayload(_eventsCache);
    _pendingEventsSync = ref.set(payload)
      .then(()=> setSyncStatus('✅ تمت المزامنة مع Firebase'))
      .catch(err=>{
        console.error('تعذرت مزامنة المواعيد:', err);
        setSyncStatus('⚠️ محفوظ محليًا، تعذّرت المزامنة الآن', 'warn');
        throw err;
      });
    return _pendingEventsSync;
  }
  setSyncStatus('💾 محفوظ محليًا');
  return Promise.resolve();
}

function initFirebase() {
  const cfg = FIREBASE_CONFIG;
  if (!hasFirebaseConfig() || !cfg.databaseURL || cfg.databaseURL === 'REPLACE_ME') return;
  if (typeof firebase === 'undefined') return;
  try {
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    _fbReady = true;
    firebase.auth().onAuthStateChanged(async fbUser=>{
      if(!fbUser || _currentUser || _creatingAccount) return;
      const identifier = fbUser.phoneNumber || fbUser.email || localStorage.getItem(LS_SESSION);
      if(!identifier) return;
      const user = firebaseUserToAppUser(fbUser, identifier);
      await getOrCreateUser(user.email, user.displayName);
      await saveFirebaseUserProfile(user);
      const access = await getUserAccessStatus(user);
      if(!access.allowed){
        await firebase.auth().signOut().catch(()=>{});
        $('lockErr').textContent = accessStatusMessage(access.status);
        return;
      }
      await enterApp(user);
    });
  } catch (e) {}
}
function detachFirebaseUserListener(){
  detachSharedEventListeners();
  if(_fbEventsRef && _fbListener){
    try{ _fbEventsRef.off('value', _fbListener); }catch(e){}
  }
  if(_fbInvitesRef && _fbInvitesListener){
    try{ _fbInvitesRef.off('value', _fbInvitesListener); }catch(e){}
  }
  _fbEventsRef = null;
  _fbListener = null;
  _fbInvitesRef = null;
  _fbInvitesListener = null;
}

function mergeEvents(localEvents, remoteEvents){
  const map = new Map();
  for(const ev of (Array.isArray(localEvents) ? localEvents : [])){
    if(ev && ev.id) map.set(ev.id, ev);
  }
  for(const ev of (Array.isArray(remoteEvents) ? remoteEvents : [])){
    if(!ev || !ev.id) continue;
    const old = map.get(ev.id);
    const oldTime = Date.parse(old?.updatedAt || old?.createdAt || 0) || 0;
    const newTime = Date.parse(ev.updatedAt || ev.createdAt || 0) || 0;
    if(!old || newTime >= oldTime) map.set(ev.id, ev);
  }
  return Array.from(map.values());
}
async function loadUserData(){
  detachFirebaseUserListener();
  try{ _eventsCache = JSON.parse(localStorage.getItem(userEventsKey()) || '[]'); }
  catch(e){ _eventsCache = []; }
  if(!Array.isArray(_eventsCache)) _eventsCache = [];
  if(!_fbReady || !_currentUser) return;

  _fbEventsRef = firebase.database().ref(`users/${_currentUser.id}/events`);
  try{
    setSyncStatus('☁️ جاري تحميل بياناتك من Firebase...');
    const localCopy = _eventsCache.filter(Boolean);
    const sn = await _fbEventsRef.once('value');
    const rawRemote = sn.val();
    const remoteEvents = normalizeFirebaseEvents(rawRemote);

    if(isSchema2Events(rawRemote)){
      /* الصيغة الجديدة صريحة، حتى القائمة الفارغة تعتبر حالة صحيحة */
      _eventsCache = remoteEvents;
    }else if(remoteEvents.length > 0){
      /* ترحيل تلقائي من الصيغ القديمة مع دمج النسخة المحلية */
      _eventsCache = mergeEvents(localCopy, remoteEvents);
      await _fbEventsRef.set(eventsToFirebasePayload(_eventsCache));
    }else if(localCopy.length > 0){
      /* لا توجد نسخة سحابية، فلا نحذف النسخة المحلية؛ نرفعها بدلًا من ذلك */
      _eventsCache = localCopy;
      await _fbEventsRef.set(eventsToFirebasePayload(_eventsCache));
    }else{
      _eventsCache = [];
      await _fbEventsRef.set(eventsToFirebasePayload([]));
    }

    localStorage.setItem(userEventsKey(), JSON.stringify(_eventsCache));
    watchSharedEventsFromLocalRefs();
    setSyncStatus('✅ تمت المزامنة مع Firebase');
    if(typeof refreshAll === 'function') refreshAll();

    _fbListener = sn2=>{
      const raw = sn2.val();
      const incoming = normalizeFirebaseEvents(raw);
      if(isSchema2Events(raw)){
        _eventsCache = incoming;
      }else if(incoming.length > 0){
        _eventsCache = mergeEvents(_eventsCache, incoming);
      }else{
        /* لا نمسح مواعيد محلية بسبب null عابر أو بيانات قديمة غير مفهومة */
        return;
      }
      localStorage.setItem(userEventsKey(), JSON.stringify(_eventsCache));
      watchSharedEventsFromLocalRefs();
      setSyncStatus('✅ تمت المزامنة مع Firebase');
      if(typeof refreshAll === 'function') refreshAll();
    };
    _fbEventsRef.on('value', _fbListener);

    _fbInvitesRef = firebase.database().ref(`users/${_currentUser.id}/invites`);
    const invSn = await _fbInvitesRef.once('value');
    const invVal = invSn.val();
    saveInvites(Object.values(invVal || {}));
    _fbInvitesListener = sn3=>{
      saveInvites(Object.values(sn3.val() || {}));
      if(typeof refreshAll === 'function') refreshAll();
    };
    _fbInvitesRef.on('value', _fbInvitesListener);
  }catch(e){
    console.error('تعذر تحميل المواعيد من Firebase:', e);
    /* عند فشل القراءة، نحافظ على النسخة المحلية ولا نعرض قائمة فارغة */
    setSyncStatus('⚠️ تعذر الاتصال بـ Firebase؛ تم عرض النسخة المحفوظة على الجهاز', 'warn');
    if(typeof refreshAll === 'function') refreshAll();
  }
}

function genId(){ return 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }
function eventToGregDate(ev){
  const [y,m,d] = ev.date.split('-').map(Number);
  return new Date(y, m-1, d);
}

const eventForm = $('eventForm');
eventForm.addEventListener('submit', e=>{
  e.preventDefault();
  const id    = $('eventId').value;
  const title = $('evTitle').value.trim();
  const calT  = $('evCalType').value;
  const dateV = $('evDate').value;
  if(!title){ toast('املأ عنوان الحدث','err'); return; }

  let gregDateStr = dateV;
  if(calT === 'hijri'){
    const g = selectedHijriDateToGreg();
    if(!g){ toast('تعذّر تحويل التاريخ الهجري','err'); return; }
    gregDateStr = gregDateToInputValue(g);
  }else{
    if(!dateV){ toast('اختر التاريخ الميلادي','err'); return; }
  }

  const evts = loadEvents();
  if(id){
    const idx = evts.findIndex(x=>x.id===id);
    if(idx>=0){
      const current = resolveEvent(evts[idx]);
      if(current?.isShared && current.sharedEventId){
        if(!canEditEvent(current)){ toast('ليست لديك صلاحية تعديل هذا الحدث','err'); return; }
        const sharedUpdate = { ...current, title, calType:calT, date:gregDateStr, updatedAt:new Date().toISOString() };
        if(_fbReady) firebase.database().ref(`sharedEvents/${current.sharedEventId}`).update({ title, calType:calT, date:gregDateStr, updatedAt:sharedUpdate.updatedAt }).catch(()=>{});
        _sharedEventsCache[current.sharedEventId] = { ...(_sharedEventsCache[current.sharedEventId]||{}), ...sharedUpdate };
      }else{
        evts[idx] = { ...evts[idx], title, calType:calT, date:gregDateStr, updatedAt:new Date().toISOString() };
        if(evts[idx].sharedEventId) upsertSharedEventFromLocal(evts[idx]).catch(()=>{});
      }
    }
  }else{
    evts.push({ id:genId(), title, calType:calT, date:gregDateStr, ownerId:_currentUser?.id || '', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
  }
  saveEvents(evts);
  closeAddModal();
  refreshAll();
  toast(id ? 'تم تعديل الحدث' : 'تم حفظ الحدث','ok');
});

function resetForm(){
  $('eventId').value=''; $('evTitle').value=''; $('evDate').value='';
  $('evCalType').value='greg';
  fillHijriControls();
  setHijriControlsFromDate(new Date());
  updateDateMode();
  $('formTitle').textContent='إضافة حدث جديد';
  $('saveBtn').textContent='حفظ الحدث';
}
function openAddModal(){
  resetForm();
  $('addModal').classList.add('show');
  setTimeout(()=>$('evTitle').focus(), 50);
}
function closeAddModal(){
  $('addModal').classList.remove('show');
  resetForm();
}
$('openAddBtn').addEventListener('click', openAddModal);
$('addCancelBtn').addEventListener('click', closeAddModal);
$('addModal').addEventListener('click', e=>{
  if(e.target.id === 'addModal') closeAddModal();
});
$('evCalType').addEventListener('change', updateDateMode);
['evHijriDay','evHijriMonth','evHijriYear'].forEach(id=>{
  const el = $(id);
  if(el) el.addEventListener('change', updateHijriPreview);
});
fillHijriControls();

function startEdit(ev){
  ev = resolveEvent(ev) || ev;
  if(!canEditEvent(ev)){ toast('ليست لديك صلاحية تعديل هذا الحدث','err'); return; }
  $('eventId').value = ev.localRefId || ev.id;
  $('evTitle').value = ev.title;
  $('evCalType').value = ev.calType || 'greg';
  $('evDate').value = ev.date;
  fillHijriControls();
  if((ev.calType || 'greg') === 'hijri') setHijriControlsFromDate(eventToGregDate(ev));
  updateDateMode();
  $('formTitle').textContent='تعديل الحدث';
  $('saveBtn').textContent='حفظ التعديلات';
  $('detailModal').classList.remove('show');
  $('addModal').classList.add('show');
  setTimeout(()=>$('evTitle').focus(), 50);
}

/* الحذف بكلمة المرور */
let pendingDeleteId = null;
function askDelete(id){
  pendingDeleteId = id;
  $('delPw').value=''; $('delErr').textContent='';
  const raw = loadEvents().find(x=>x.id===id);
  const ev = resolveEvent(raw);
  const title = $('delModal')?.querySelector('h2');
  const msg = $('delModal')?.querySelector('p');
  if(ev?.isShared && ev.ownerId !== _currentUser?.id){
    if(title) title.textContent = 'إزالة من تقويمي';
    if(msg) msg.textContent = 'سيُزال هذا الموعد من تقويمك فقط، ولن يُحذف عند المرسل أو بقية المشاركين.';
    $('delConfirm').textContent = 'إزالة';
  }else{
    if(title) title.textContent = 'تأكيد الحذف';
    if(msg) msg.textContent = 'سيتم حذف هذا الحدث من حساب المستخدم الحالي فقط.';
    $('delConfirm').textContent = 'حذف';
  }
  $('detailModal').classList.remove('show');
  $('delModal').classList.add('show');
}
$('delCancel').addEventListener('click', ()=>{
  pendingDeleteId=null; $('delModal').classList.remove('show');
});
$('delModal').addEventListener('click', e=>{
  if(e.target.id==='delModal'){ pendingDeleteId=null; $('delModal').classList.remove('show'); }
});
$('delConfirm').addEventListener('click', async ()=>{
  const err=$('delErr'); err.textContent='';
  const raw = loadEvents().find(x=>x.id===pendingDeleteId);
  const ev = resolveEvent(raw);
  if(ev?.isShared){
    if(ev.ownerId === _currentUser?.id || ev.sharedRole === 'owner'){
      if(ev.sharedEventId && _fbReady) await firebase.database().ref(`sharedEvents/${ev.sharedEventId}`).update({deleted:true, updatedAt:new Date().toISOString()}).catch(()=>{});
      await saveEvents(loadEvents().filter(x=>x.id!==pendingDeleteId)).catch(()=>{});
      toast('تم حذف الحدث المشترك','ok');
    }else{
      /* دعم المواعيد المشتركة القديمة والجديدة. بعض المواعيد القديمة لا تحتوي
         sharedEventId أو sharedInviteId، لذلك نستخدم العنوان والتاريخ والمرسل
         كمطابقة احتياطية عند إزالة الموعد من تقويم المستلم فقط. */
      const sharedId = ev.sharedEventId || raw?.sharedEventId || '';
      const inviteId = raw?.sharedInviteId || ev.sharedInviteId || '';
      const legacyTitle = String(ev.title || raw?.title || '').trim();
      const legacyDate = String(ev.date || raw?.date || '').trim();
      const legacySender = String(ev.sharedFrom || raw?.sharedFrom || raw?.fromName || raw?.fromEmail || ev.ownerEmail || raw?.ownerEmail || '').trim();
      const updated = loadEvents().filter(x => {
        if(!x) return false;
        if(x.id === pendingDeleteId) return false;
        if(sharedId && x.sharedEventId === sharedId) return false;
        if(inviteId && x.sharedInviteId === inviteId) return false;
        const xSender = String(x.sharedFrom || x.fromName || x.fromEmail || x.ownerEmail || '').trim();
        const sameLegacyEvent = !sharedId && !inviteId &&
          legacyTitle && legacyDate &&
          String(x.title || '').trim() === legacyTitle &&
          String(x.date || '').trim() === legacyDate &&
          (!legacySender || !xSender || xSender === legacySender);
        if(sameLegacyEvent) return false;
        return true;
      });
      await saveEvents(updated);

      /* نحتفظ بسجل أن المستخدم أزال الدعوة، حتى لا تعود كدعوة معلقة. */
      if(inviteId){
        const invites = loadInvites();
        const inv = invites.find(x => x.id === inviteId);
        if(inv){
          inv.status = 'removed';
          inv.removedAt = new Date().toISOString();
          saveInvites(invites);
          if(_fbReady && _currentUser){
            await firebase.database().ref(`users/${_currentUser.id}/invites/${inviteId}`).set(inv).catch(()=>{});
          }
        }
      }
      toast('تمت إزالة الحدث من تقويمك فقط','ok');
    }
  }else{
    if(raw?.sharedEventId && _fbReady) await firebase.database().ref(`sharedEvents/${raw.sharedEventId}`).update({deleted:true, updatedAt:new Date().toISOString()}).catch(()=>{});
    await saveEvents(loadEvents().filter(x=>x.id!==pendingDeleteId)).catch(()=>{});
    toast('تم حذف الحدث','ok');
  }
  pendingDeleteId=null;
  $('delModal').classList.remove('show');
  refreshAll();
});

/* مودال التفاصيل */
let currentDetailId = null;
function openDetail(ev){
  /* إذا وصل الحدث من القائمة فهو محلول وجاهز للعرض. لا نعيد حله مرة أخرى،
     لأن بعض الأحداث المشتركة القديمة لا تحمل البنية الحديثة كاملة. */
  const sourceEv = ev;
  if(!ev) { toast('تعذر العثور على بيانات الموعد','err'); return; }
  if(!ev.__displayResolved){
    ev = resolveEvent(ev) || ev;
  }
  currentDetailId = ev.localRefId || sourceEv?.localRefId || ev.id || sourceEv?.id;
  if(!currentDetailId){ toast('تعذر تحديد الموعد للحذف','err'); return; }
  const now = new Date();
  const g   = eventToGregDate(ev);
  if(!(g instanceof Date) || Number.isNaN(g.getTime())){
    toast('تاريخ الموعد غير صالح','err');
    return;
  }
  const days = diffDays(now, g);
  const ymd  = diffYMD(now, g);
  const h    = gregToHijri(g);
  const gregStr = `${g.getDate()} ${arMonths[g.getMonth()]} ${g.getFullYear()} م`;
  const hijStr  = h ? formatHijri(h) : '—';
  const dayName = arDays[g.getDay()];

  let countdown;
  if(days === 0)      countdown = '🎯 اليوم هو الموعد';
  else if(days > 0)   countdown = `يتبقى ${fmtYMD(ymd)}`;
  else                countdown = `مضى عليه ${fmtYMD(ymd)}`;

  $('detailTitle').textContent = ev.title;
  const typeText = ev.tag === 'sa' ? '🇸🇦 مناسبة سعودية' : (ev.isShared ? '👥 حدث مشترك' : '📅 حدث شخصي');
  const roleText = ev.isShared ? roleLabel(ev.sharedRole || 'viewer') : (ev.ownerId === _currentUser?.id ? '👑 مالك الحساب' : '👤 مستخدم عادي');
  $('detailBody').innerHTML = `
    <div class="detail-row"><b>النوع</b><span>${typeText}</span></div>
    <div class="detail-row"><b>الصلاحية</b><span>${roleText}</span></div>
    ${ev.isShared ? `<div class="detail-row"><b>المشاركة من</b><span>${escapeHtml(ev.sharedFrom || ev.ownerEmail || '—')}</span></div>` : ''}
    <div class="detail-row"><b>📅 التاريخ الميلادي</b><span>${gregStr}</span></div>
    <div class="detail-row"><b>🌙 التاريخ الهجري</b><span>${hijStr}</span></div>
    <div class="detail-row"><b>اليوم</b><span>${dayName}</span></div>
    <div class="detail-row"><b>نوع الإدخال</b><span>${ev.calType==='hijri'?'هجري':'ميلادي'}</span></div>
    <div class="detail-row"><b>الحالة</b><span>${countdown}</span></div>
  `;
  $('detailEdit').style.display = canEditEvent(ev) ? '' : 'none';
  $('detailShare').style.display = canShareEvent(ev) ? '' : 'none';
  $('detailDelete').textContent = ev.isShared && ev.ownerId !== _currentUser?.id ? 'إزالة من تقويمي' : 'حذف';
  $('detailModal').classList.add('show');
}
$('detailClose').addEventListener('click', ()=> $('detailModal').classList.remove('show'));
$('detailModal').addEventListener('click', e=>{ if(e.target.id==='detailModal') $('detailModal').classList.remove('show'); });
$('detailEdit').addEventListener('click', ()=>{
  const ev = loadEvents().find(x=>x.id===currentDetailId);
  if(ev) startEdit(ev);
});
$('detailDelete').addEventListener('click', ()=>{
  if(currentDetailId) askDelete(currentDetailId);
});
$('detailShare').addEventListener('click', async ()=>{
  const ev = resolveEvent(loadEvents().find(x=>x.id===currentDetailId));
  if(!ev || !_currentUser) return;
  if(!canShareEvent(ev)){ toast('المشاركة متاحة للمالك فقط','err'); return; }
  $('shareErr').textContent = '';
  if($('shareRole')) $('shareRole').value = 'viewer';
  $('detailModal').classList.remove('show');
  $('shareModal').classList.add('show');
  await loadShareUsersList();
});
$('shareCancel').addEventListener('click', ()=> $('shareModal').classList.remove('show'));
$('shareModal').addEventListener('click', e=>{ if(e.target.id==='shareModal') $('shareModal').classList.remove('show'); });
$('shareSelectAll').addEventListener('click', ()=>{
  const boxes = Array.from(document.querySelectorAll('.share-user-check'));
  if(boxes.length === 0) return;
  const shouldCheck = boxes.some(b => !b.checked);
  boxes.forEach(b => b.checked = shouldCheck);
  updateShareSelectionCount();
});
async function loadShareUsersList(){
  const list = $('shareUserList');
  const count = $('shareUserCount');
  list.innerHTML = `<div class="empty" style="padding:14px;font-size:.85rem;">جاري تحميل المستخدمين...</div>`;
  count.textContent = '';
  if(!_fbReady || !_currentUser){
    list.innerHTML = `<div class="empty" style="padding:14px;font-size:.85rem;">المشاركة تحتاج اتصال Firebase.</div>`;
    return;
  }
  try{
    let users = [];
    if(isAdminUser()){
      const sn = await firebase.database().ref('directory').once('value');
      users = Object.values(sn.val() || {}).filter(u => u && u.uid && u.uid !== _currentUser.id && u.approvalStatus === 'approved' && !u.hiddenFromDirectory);
    }else{
      const myCategory = normalizeUserCategory(_currentUser.category);
      const sn = await firebase.database().ref(`groupDirectories/${myCategory}`).once('value');
      users = Object.values(sn.val() || {}).filter(u => u && u.uid && u.uid !== _currentUser.id);
    }
    users.sort((a,b)=>{
      const aAdmin = a.role === 'admin' || String(a.identifier || '').toLowerCase() === ADMIN_EMAIL;
      const bAdmin = b.role === 'admin' || String(b.identifier || '').toLowerCase() === ADMIN_EMAIL;
      if(aAdmin !== bAdmin) return aAdmin ? -1 : 1;
      return userVisibleName(a).localeCompare(userVisibleName(b), 'ar');
    });
    if(users.length === 0){
      list.innerHTML = `<div class="empty" style="padding:14px;font-size:.85rem;">لا يوجد مستخدمون متاحون ضمن تصنيفك الحالي.</div>`;
      count.textContent = '0 مستخدم';
      return;
    }
    list.innerHTML = '';
    for(const u of users){
      const uid = escapeHtml(u.uid);
      const identifier = escapeHtml(u.identifier || '');
      const isAdminEntry = u.role === 'admin' || String(u.identifier || '').toLowerCase() === ADMIN_EMAIL;
      const name = escapeHtml(`${isAdminEntry ? '👑 ' : ''}${userVisibleName(u)}`);
      const visibleEmail = escapeHtml(userVisibleEmail(u));
      const emailLine = visibleEmail ? `<span class="share-user-email">${visibleEmail}</span>` : '';
      const categoryLine = isAdminUser() ? `<span class="category-pill">${escapeHtml(userCategoryLabel(u.category))}</span>` : '';
      const label = document.createElement('label');
      label.className = 'share-user-item';
      label.innerHTML = `
        <input type="checkbox" class="share-user-check" data-uid="${uid}" data-email="${identifier}" data-name="${name}" />
        <span class="share-user-main">
          <span class="share-user-name">${name}${categoryLine}</span>
          ${emailLine}
        </span>
      `;
      label.querySelector('input').addEventListener('change', updateShareSelectionCount);
      list.appendChild(label);
    }
    updateShareSelectionCount();
  }catch(e){
    console.error('فشل تحميل المستخدمين:', e);
    list.innerHTML = `<div class="empty" style="padding:14px;font-size:.85rem;">تعذر تحميل المستخدمين. تأكد من قواعد Firebase الخاصة بالتصنيفات.</div>`;
  }
}
function selectedShareUsers(){
  return Array.from(document.querySelectorAll('.share-user-check:checked')).map(b=>({
    id:b.dataset.uid,
    email:b.dataset.email,
    displayName:b.dataset.name || b.dataset.email
  })).filter(u=>u.id);
}
function updateShareSelectionCount(){
  const total = document.querySelectorAll('.share-user-check').length;
  const selected = document.querySelectorAll('.share-user-check:checked').length;
  if($('shareUserCount')) $('shareUserCount').textContent = `${selected} محدد من ${total}`;
}
async function ensureSharedEventForEvent(rawEv){
  if(!_fbReady || !_currentUser || !rawEv) return null;
  const evts = loadEvents();
  const idx = evts.findIndex(x=>x.id === rawEv.id);
  const sharedId = rawEv.sharedEventId || rawEv.id;
  if(idx >= 0 && !evts[idx].sharedEventId){
    evts[idx] = { ...evts[idx], sharedEventId:sharedId, ownerId:_currentUser.id, sharedRole:'owner', updatedAt:new Date().toISOString() };
    saveEvents(evts);
  }
  const ev = idx >= 0 ? evts[idx] : rawEv;
  await upsertSharedEventFromLocal({ ...ev, sharedEventId:sharedId, ownerId:_currentUser.id });
  watchSharedEvent(sharedId);
  return sharedId;
}

$('shareSend').addEventListener('click', sendCurrentShareInvite);
async function sendCurrentShareInvite(){
  const err = $('shareErr'); err.textContent = '';
  const rawEv = loadEvents().find(x=>x.id===currentDetailId);
  const current = resolveEvent(rawEv);
  if(!current || !_currentUser){ err.textContent = 'تعذر العثور على الحدث'; return; }
  if(!canShareEvent(current)){ err.textContent = 'المشاركة متاحة لمالك الحدث فقط'; return; }
  if(!_fbReady){ err.textContent = 'المشاركة تحتاج اتصال Firebase'; return; }

  const selectedUsers = selectedShareUsers();
  if(selectedUsers.length === 0){
    err.textContent = 'اختر مستخدمًا واحدًا على الأقل لإرسال الدعوة.';
    return;
  }

  const shareRole = $('shareRole')?.value || 'viewer';
  const sharedEventId = current.sharedEventId || await ensureSharedEventForEvent(rawEv);
  if(!sharedEventId){ err.textContent = 'تعذر إنشاء الحدث المشترك'; return; }

  let sent = 0;
  for(const target of selectedUsers){
    if(target.id === _currentUser.id || target.email === _currentUser.email) continue;
    await firebase.database().ref(`sharedEvents/${sharedEventId}/roles/${target.id}`).set(shareRole).catch(()=>{});
    const inv = {
      id:'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2,8),
      fromEmail:_currentUser.email,
      fromUserId:_currentUser.id,
      fromName:displayUser(_currentUser),
      toEmail:target.email,
      toUserId:target.id,
      status:'pending',
      role:shareRole,
      sharedEventId,
      sentAt:new Date().toISOString(),
      event:{ title:current.title, calType:current.calType || 'greg', date:current.date }
    };
    try{
      await firebase.database().ref(`users/${target.id}/invites/${inv.id}`).set(inv);
      sent++;
    }catch(writeErr){
      console.error('فشل إرسال الدعوة:', writeErr);
    }
  }
  if(sent === 0){
    err.textContent = 'لم تُرسل الدعوة. تأكد أن المستخدم الآخر سجل دخولًا مرة واحدة وأن قواعد Realtime Database محدثة.';
    return;
  }
  $('shareModal').classList.remove('show');
  refreshAll();
  toast(`تم إرسال ${sent} دعوة لحدث مشترك`,'ok');
}

/* ============================================================
   إدارة المستخدمين - المدير
   ============================================================ */
let _adminUsersFilter = 'pending';
let _adminUsersCache = [];
function detachAdminDirectoryListener(){
  if(_adminDirectoryRef && _adminDirectoryListener){
    try{ _adminDirectoryRef.off('value', _adminDirectoryListener); }catch(e){}
  }
  _adminDirectoryRef = null;
  _adminDirectoryListener = null;
}
function attachAdminDirectoryListener(){
  detachAdminDirectoryListener();
  if(!_fbReady || !isAdminUser()) return;
  _adminDirectoryRef = firebase.database().ref('directory');
  _adminDirectoryListener = sn=>{
    const users = Object.values(sn.val() || {});
    _adminUsersCache = users;
    const pending = users.filter(u=>u && u.role !== 'admin' && u.approvalStatus === 'pending').length;
    const badge = $('adminPendingBadge');
    const modalBadge = $('adminPendingBadgeModal');
    if(badge){ badge.textContent = pending; badge.style.display = pending ? '' : 'none'; }
    if(modalBadge){ modalBadge.textContent = pending; modalBadge.style.display = pending ? '' : 'none'; }
    if($('adminUsersModal')?.classList.contains('show')) renderAdminUsers(users);
    if(pending && attachAdminDirectoryListener._lastPending !== undefined && pending > attachAdminDirectoryListener._lastPending){
      toast(`لديك ${pending} طلب تسجيل بانتظار الموافقة`,'ok');
    }
    attachAdminDirectoryListener._lastPending = pending;
  };
  _adminDirectoryRef.on('value', _adminDirectoryListener);
}
function adminStatusLabel(status){
  return ({pending:'⏳ بانتظار الموافقة',approved:'✅ معتمد',rejected:'❌ مرفوض',disabled:'⛔ معطّل',deleted:'🗑️ محذوف من التطبيق'})[status] || '✅ معتمد';
}
async function loadAdminUsers(){
  if(!isAdminUser()) return;
  $('adminUsersList').innerHTML = '<div class="empty" style="padding:14px;">جاري تحميل المستخدمين...</div>';
  try{
    const sn = await firebase.database().ref('directory').once('value');
    _adminUsersCache = Object.values(sn.val() || {});
    renderAdminUsers(_adminUsersCache);
  }catch(e){
    $('adminUsersList').innerHTML = '<div class="empty" style="padding:14px;">تعذر تحميل المستخدمين. تحقق من Rules.</div>';
  }
}
function renderAdminUsers(users){
  const list = $('adminUsersList');
  if(!list) return;
  const allUsers=(users || []).filter(u=>u && u.uid);
  renderAdminStats(allUsers);
  let filtered = [...allUsers];
  if(_adminUsersFilter === 'pending'){
  filtered = filtered.filter(
    u => u.role !== 'admin' && u.approvalStatus === 'pending'
  );
}else if(['family', 'work', 'general'].includes(_adminUsersFilter)){
  filtered = filtered.filter(
    u =>
      u.role !== 'admin' &&
      u.approvalStatus === 'approved' &&
      normalizeUserCategory(u.category) === _adminUsersFilter
  );
}
  filtered = filtered.sort((a,b)=>{
    const order={pending:0,approved:1,disabled:2,rejected:3,deleted:4};
    return (order[a.approvalStatus]??1)-(order[b.approvalStatus]??1) || userVisibleName(a).localeCompare(userVisibleName(b),'ar');
  });
  if(!filtered.length){ list.innerHTML=`<div class="empty" style="padding:14px;">${_adminUsersFilter==='pending'?'لا توجد طلبات تسجيل جديدة.':'لا يوجد مستخدمون.'}</div>`; return; }
  list.innerHTML='';
  for(const u of filtered){
    const row=document.createElement('div');
    const admin = String(u.identifier||'').toLowerCase() === ADMIN_EMAIL;
    const status=u.approvalStatus || 'approved';
    const category=admin?'admin':normalizeUserCategory(u.category);
    const hidden=Boolean(u.hiddenFromDirectory) || category==='hidden';
    row.className=`admin-user-item cat-${category}`;
    row.innerHTML=`
      <div class="admin-user-info">
        <div class="admin-user-name">${escapeHtml(userVisibleName(u))}${admin?' 👑':''}</div>
        <div class="admin-user-email">${escapeHtml(u.identifier||'')}</div>
        <div class="admin-user-status">${adminStatusLabel(status)}${hidden?' · 🙈 مخفي من المشاركة':''} · ${escapeHtml(admin?'👑 مدير':userCategoryLabel(category))}</div>
        ${admin?'':`<div class="admin-user-category"><label>التصنيف</label><select class="admin-category-select"><option value="family">👨‍👩‍👧‍👦 عائلة</option><option value="work">💼 عمل</option><option value="general">👤 عام</option><option value="hidden">🔒 مخفي</option></select><span class="saving-note" aria-live="polite"></span></div>`}
      </div>
      <div class="admin-user-actions"></div>`;
    const actions=row.querySelector('.admin-user-actions');
    const categorySelect=row.querySelector('.admin-category-select');
    const savingNote=row.querySelector('.saving-note');
    if(categorySelect){
      categorySelect.value=category;
      categorySelect.addEventListener('change', async ()=>{
        const next=categorySelect.value;
        categorySelect.disabled=true;
        if(savingNote) savingNote.textContent='جاري الحفظ...';
        const success=await setManagedUserState(u,{category:next,hiddenFromDirectory:next==='hidden'},{confirm:false,successMessage:'تم حفظ التصنيف'});
        categorySelect.disabled=false;
        if(savingNote) savingNote.textContent=success?'✅ تم الحفظ':'تعذر الحفظ';
        setTimeout(()=>{if(savingNote) savingNote.textContent='';},1800);
      });
    }
    if(!admin){
      if(status==='pending'){
        addAdminAction(actions,'قبول','btn-primary',()=>setManagedUserState(u,{approvalStatus:'approved',category:categorySelect?.value||category,hiddenFromDirectory:(categorySelect?.value==='hidden')}));
        addAdminAction(actions,'رفض','btn-secondary',()=>setManagedUserState(u,{approvalStatus:'rejected',hiddenFromDirectory:true}));
      }else if(status==='approved'){
        addAdminAction(actions,'تعطيل','btn-warn',()=>setManagedUserState(u,{approvalStatus:'disabled',hiddenFromDirectory:true}));
        addAdminAction(actions,'مسح البيانات','btn-danger',()=>deleteManagedUserData(u));
      }else if(status==='disabled' || status==='rejected'){
        addAdminAction(actions,'إعادة تفعيل','btn-primary',()=>setManagedUserState(u,{approvalStatus:'approved',hiddenFromDirectory:category==='hidden'}));
        addAdminAction(actions,'مسح البيانات','btn-danger',()=>deleteManagedUserData(u));
      }
      const toggle=document.createElement('div');
      toggle.className='admin-share-toggle';
      const checked=!hidden && category!=='hidden' && status==='approved';
      toggle.innerHTML=`<span>يظهر في المشاركة</span><label class="switch"><input type="checkbox" ${checked?'checked':''} ${status!=='approved'||category==='hidden'?'disabled':''}><span class="switch-slider"></span></label>`;
      const input=toggle.querySelector('input');
      input?.addEventListener('change', async ()=>{
        input.disabled=true;
        const success=await setManagedUserState(u,{hiddenFromDirectory:!input.checked},{confirm:false,successMessage:input.checked?'تم إظهار المستخدم في المشاركة':'تم إخفاء المستخدم من المشاركة'});
        if(!success) input.checked=!input.checked;
        input.disabled=status!=='approved'||category==='hidden';
      });
      actions.appendChild(toggle);
    }
    list.appendChild(row);
  }
}
function renderAdminStats(users){
  const box=$('adminStats'); if(!box) return;
  const counts={all:0,family:0,work:0,general:0,pending:0};
  for(const u of users){
    if(String(u.identifier||'').toLowerCase()===ADMIN_EMAIL) continue;
    if(u.approvalStatus==='pending'){counts.pending++;continue;}
    if(u.approvalStatus!=='approved') continue;
    counts.all++;
    const cat=normalizeUserCategory(u.category);
    if(cat==='family') counts.family++;
    else if(cat==='work') counts.work++;
    else if(cat==='general') counts.general++;
  }
  box.innerHTML=`
  <button type="button" class="admin-stat" data-admin-stat-filter="all">
    <strong>${counts.all}</strong>
    <span>👥 المستخدمون</span>
  </button>

  <button type="button" class="admin-stat" data-admin-stat-filter="family">
    <strong>${counts.family}</strong>
    <span>👨‍👩‍👧‍👦 العائلة</span>
  </button>

  <button type="button" class="admin-stat" data-admin-stat-filter="work">
    <strong>${counts.work}</strong>
    <span>💼 العمل</span>
  </button>

  <button type="button" class="admin-stat" data-admin-stat-filter="general">
    <strong>${counts.general}</strong>
    <span>👤 عام</span>
  </button>

  <button type="button" class="admin-stat" data-admin-stat-filter="pending">
    <strong>${counts.pending}</strong>
    <span>⏳ طلبات جديدة</span>
  </button>
`;
box.querySelectorAll('[data-admin-stat-filter]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    _adminUsersFilter = btn.dataset.adminStatFilter;
    renderAdminUsers(users);
  });
});
}
function addAdminAction(box,text,cls,fn){
  const b=document.createElement('button'); b.type='button'; b.className=`btn ${cls}`; b.textContent=text; b.addEventListener('click',fn); box.appendChild(b);
}
async function setManagedUserState(u, changes, options={}){
  if(!isAdminUser() || !u?.uid) return false;
  if(options.confirm !== false){
    const ok = await confirmDialog({title:'تحديث المستخدم',message:`تطبيق الإجراء على ${userVisibleName(u)}؟`,okText:'تأكيد',danger:changes.approvalStatus==='rejected'||changes.approvalStatus==='disabled'});
    if(!ok) return false;
  }
  const payload={...changes,updatedAt:new Date().toISOString()};
  try{
    await firebase.database().ref(`users/${u.uid}/profile`).update(payload);
    if(u.identifier) await firebase.database().ref(`directory/${identifierKey(u.identifier)}`).update(payload);
    await firebase.database().ref(`publicDirectory/${u.uid}`).update({
      displayName:u.displayName || 'مستخدم',
      approvalStatus:changes.approvalStatus || u.approvalStatus || 'approved',
      hiddenFromDirectory:changes.hiddenFromDirectory !== undefined ? changes.hiddenFromDirectory : Boolean(u.hiddenFromDirectory),
      category:changes.category || normalizeUserCategory(u.category),
      updatedAt:payload.updatedAt
    });
    const nextCategory = changes.category || normalizeUserCategory(u.category);
    const nextStatus = changes.approvalStatus || u.approvalStatus || 'approved';
    const nextHidden = changes.hiddenFromDirectory !== undefined ? changes.hiddenFromDirectory : Boolean(u.hiddenFromDirectory);
    for(const cat of ['family','work','general','hidden']) await firebase.database().ref(`groupDirectories/${cat}/${u.uid}`).remove();
    if(nextStatus === 'approved' && !nextHidden && nextCategory !== 'hidden'){
      await firebase.database().ref(`groupDirectories/${nextCategory}/${u.uid}`).set({uid:u.uid,displayName:u.displayName||'مستخدم',category:nextCategory,updatedAt:payload.updatedAt});
    }
    toast(options.successMessage || 'تم تحديث المستخدم وتصنيفه','ok');
    return true;
  }catch(e){ toast('تعذر تحديث المستخدم. تحقق من Rules.','err'); return false; }
}
async function deleteManagedUserData(u){
  if(!isAdminUser() || !u?.uid) return;
  const ok=await confirmDialog({title:'مسح بيانات المستخدم',message:`سيتم مسح أحداث ودعوات ${userVisibleName(u)} ومنعه من دخول التطبيق. حساب Authentication سيظل موجودًا حتى تحذفه من Firebase Console.`,okText:'مسح البيانات',danger:true});
  if(!ok) return;
  const now=new Date().toISOString();
  try{
    await firebase.database().ref(`users/${u.uid}/events`).remove();
    await firebase.database().ref(`users/${u.uid}/invites`).remove();
    await firebase.database().ref(`users/${u.uid}/profile`).update({approvalStatus:'deleted',hiddenFromDirectory:true,updatedAt:now});
    if(u.identifier) await firebase.database().ref(`directory/${identifierKey(u.identifier)}`).update({approvalStatus:'deleted',hiddenFromDirectory:true,updatedAt:now});
    await firebase.database().ref(`publicDirectory/${u.uid}`).update({displayName:u.displayName||'مستخدم',approvalStatus:'deleted',hiddenFromDirectory:true,updatedAt:now});
    for(const cat of ['family','work','general','hidden']) await firebase.database().ref(`groupDirectories/${cat}/${u.uid}`).remove();
    toast('تم مسح بيانات المستخدم ومنع دخوله','ok');
  }catch(e){ toast('تعذر مسح البيانات. تحقق من Rules.','err'); }
}
$('adminUsersBtn').addEventListener('click', async ()=>{
  if(!isAdminUser()) return;
  _adminUsersFilter = 'pending';
  document.querySelectorAll('.admin-tab').forEach(b=>b.classList.toggle('active',b.dataset.adminTab==='pending'));
  $('adminUsersModal').classList.add('show');
  await loadAdminUsers();
});
document.querySelectorAll('.admin-tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    _adminUsersFilter = btn.dataset.adminTab || 'all';
    document.querySelectorAll('.admin-tab').forEach(b=>b.classList.toggle('active',b===btn));
    renderAdminUsers(_adminUsersCache);
  });
});
$('adminUsersClose').addEventListener('click',()=>$('adminUsersModal').classList.remove('show'));
$('adminUsersModal').addEventListener('click',e=>{if(e.target.id==='adminUsersModal') $('adminUsersModal').classList.remove('show');});

/* ============================================================
   العرض
   ============================================================ */
function renderToday(){
  const now = new Date();
  $('todayName').textContent = arDays[now.getDay()];
  $('todayGreg').textContent =
  `${now.getDate()} / ${arMonths[now.getMonth()]} (${now.getMonth() + 1}) / ${now.getFullYear()} م`;
  const h = gregToHijri(now);
  $('todayHijri').textContent = h
  ? `${h.day} / ${hijriMonths[h.month - 1]} (${h.month}) / ${h.year}هـ`
  : '—';
  $('todayHijriDay').textContent = h ? `يوم ${arDays[now.getDay()]}` : '';
}

function openDetailByLocalId(localId, displayedEvent=null){
  try{
    /* الأفضل استخدام نفس الحدث الظاهر في القائمة؛ فهو يحتوي بيانات المشاركة
       بعد دمجها، حتى لو كان المرجع المحلي قديمًا أو ناقص الحقول. */
    if(displayedEvent){
      openDetail({ ...displayedEvent, localRefId:localId, __displayResolved:true });
      return;
    }
    const raw = loadEvents().find(x => x && x.id === localId);
    if(!raw){
      toast('تعذر العثور على بيانات الموعد','err');
      return;
    }
    const resolved = resolveEvent(raw) || raw;
    openDetail({ ...resolved, localRefId:localId, __displayResolved:true });
  }catch(ex){
    console.error('openDetailByLocalId failed', ex);
    toast('تعذر فتح تفاصيل الموعد','err');
  }
}

function eventRow(ev){
  const now = new Date();
  const g   = eventToGregDate(ev);
  const days = diffDays(now, g);
  const ymd  = diffYMD(now, g);

  let cardClass='', badgeText='';
  if(days === 0){ cardClass='today-ev'; badgeText='اليوم'; }
  else if(days > 0){
    if(days <= 7) cardClass='urgent';
    badgeText = `بعد ${fmtYMDShort(ymd)}`;
  }else{
    cardClass = 'past';
    badgeText = `قبل ${fmtYMDShort(ymd)}`;
  }

  const div = document.createElement('div');
  div.className = `event-row ${cardClass}`;
  const icon = eventTypeIcon(ev);
  const role = ev.isShared ? `<span class="event-role">${roleLabel(ev.sharedRole || 'viewer')}</span>` : (ev.ownerId === _currentUser?.id ? `<span class="event-role">👑 مالك</span>` : '');
  const localId = ev.localRefId || ev.id;
  div.dataset.eventId = localId || '';
  div.setAttribute('role','button');
  div.setAttribute('tabindex','0');
  div.innerHTML = `
    <div class="event-title"><span class="event-icon">${icon}</span><span class="event-name">${escapeHtml(ev.title)}</span>${role}</div>
    <div class="event-badge">${badgeText}</div>
  `;
  const open = ()=>{
    if(localId) openDetailByLocalId(localId, ev);
    else openDetail({ ...ev, __displayResolved:true });
  };
  div.addEventListener('click', open);
  div.addEventListener('keydown', e=>{
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      open();
    }
  });
  return div;
}

function fillList(id, arr, emptyMsg){
  const box=$(id); box.innerHTML='';
  if(arr.length===0){
    const e=document.createElement('div'); e.className='empty'; e.textContent=emptyMsg;
    box.appendChild(e); return;
  }
  for(const ev of arr) box.appendChild(eventRow(ev));
}

function renderInvites(){
  const card = $('invitesCard');
  const list = $('inviteList');
  const badge = $('inviteCount');
  if(!card || !list || !badge) return;
  const invites = pendingInvitesForCurrentUser();
  badge.textContent = invites.length;
  renderInvites._lastCount = invites.length;
  list.innerHTML = '';
  if(invites.length === 0){
    card.style.display = 'none';
    return;
  }
  card.style.display = '';
  for(const inv of invites){
    const ev = inv.event || {};
    const g = ev.date ? eventToGregDate(ev) : null;
    const dateText = g ? `${g.getDate()} ${arMonths[g.getMonth()]} ${g.getFullYear()}` : '';
    const div = document.createElement('div');
    div.className = 'invite-item';
    div.innerHTML = `
      <div>
        <div class="invite-title">${escapeHtml(ev.title || 'حدث بدون عنوان')}</div>
        <div class="invite-meta">من ${escapeHtml(inv.fromName || (isAdminUser() ? inv.fromEmail : 'مستخدم'))} · ${dateText} · ${roleLabel(inv.role || 'viewer')}</div>
      </div>
      <div class="invite-actions">
        <button class="btn btn-primary" data-act="accept">قبول</button>
        <button class="btn btn-secondary" data-act="reject">رفض</button>
      </div>
    `;
    div.querySelector('[data-act="accept"]').addEventListener('click', ()=> acceptInvite(inv.id));
    div.querySelector('[data-act="reject"]').addEventListener('click', ()=> rejectInvite(inv.id));
    list.appendChild(div);
  }
}

async function acceptInvite(id){
  const invites = loadInvites();
  const inv = invites.find(x => x.id === id && (x.toUserId === _currentUser?.id || x.toEmail === _currentUser?.email));
  if(!inv || inv.status !== 'pending') return;
  const ev = inv.event || {};
  const evts = loadEvents();
  const sharedId = inv.sharedEventId;
  const localId = sharedId ? ('shared_' + sharedId) : ('shared_' + inv.id);
  const exists = evts.some(x => x.id === localId || x.sharedEventId === sharedId || x.sharedInviteId === inv.id);
  if(!exists){
    evts.push({
      id:localId,
      type:'sharedRef',
      title:ev.title || 'حدث مشترك',
      calType:ev.calType || 'greg',
      date:ev.date,
      ownerId:inv.fromUserId || '',
      sharedFrom:inv.fromName || inv.fromEmail || 'مستخدم آخر',
      sharedInviteId:inv.id,
      sharedEventId:sharedId || '',
      role:inv.role || 'viewer',
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    });
  }
  inv.status = 'accepted';
  inv.respondedAt = new Date().toISOString();
  saveInvites(invites);
  saveEvents(evts);
  if(sharedId) watchSharedEvent(sharedId);
  if(_fbReady && _currentUser){
    try{
      /* saveEvents حفظ الأحداث بالفعل بصيغة schema 2؛ لا نكتب المصفوفة القديمة فوقها. */
      await _pendingEventsSync;
      await firebase.database().ref(`users/${_currentUser.id}/invites/${inv.id}`).set(inv);
      if(sharedId){
        await firebase.database().ref(`sharedEvents/${sharedId}/roles/${_currentUser.id}`).set(inv.role || 'viewer').catch(()=>{});
      }
    }catch(e){
      console.error('فشل حفظ الدعوة المقبولة:', e);
      toast('تم الحفظ محليًا، وتعذّرت المزامنة مؤقتًا','err');
      refreshAll();
      return;
    }
  }
  refreshAll();
  toast('تم قبول الدعوة وحفظ الحدث في تقويمك','ok');
}

function rejectInvite(id){
  const invites = loadInvites();
  const inv = invites.find(x => x.id === id && (x.toUserId === _currentUser?.id || x.toEmail === _currentUser?.email));
  if(!inv || inv.status !== 'pending') return;
  inv.status = 'rejected';
  inv.respondedAt = new Date().toISOString();
  saveInvites(invites);
  if(_fbReady && _currentUser) firebase.database().ref(`users/${_currentUser.id}/invites/${inv.id}`).set(inv).catch(()=>{});
  refreshAll();
  toast('تم رفض الدعوة','ok');
}

function renderLists(){
  const evts = getDisplayEvents(), now = new Date();
  const upcoming=[], past=[];
  for(const ev of evts){
    if(diffDays(now, eventToGregDate(ev)) >= 0) upcoming.push(ev); else past.push(ev);
  }
  upcoming.sort((a,b)=> eventToGregDate(a)-eventToGregDate(b));
  past.sort((a,b)=> eventToGregDate(b)-eventToGregDate(a));
  fillList('upcomingList', upcoming, 'لا توجد أحداث قادمة. أضف حدثاً جديداً بالأعلى.');
  fillList('pastList',     past,     'لا توجد أحداث فائتة بعد.');
  fillList('allList',      [...upcoming, ...past], 'لا توجد أحداث محفوظة.');
  const upcomingCount = $('upcomingCount'); if(upcomingCount) upcomingCount.textContent = upcoming.length;
  const pastCount = $('pastCount'); if(pastCount) pastCount.textContent = past.length;
  const allCount = $('allCount'); if(allCount) allCount.textContent = upcoming.length + past.length;
  const stTop = $('statsTop'); if(stTop) stTop.textContent = `${upcoming.length} أحداث قادمة`;
  const stBot = $('statsBottom'); if(stBot) stBot.textContent = `${past.length} أحداث فائتة`;
}
function refreshAll(){ renderToday(); renderLists(); renderInvites(); }

document.querySelectorAll('.tab').forEach(t=>{
  t.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    $(t.dataset.tab + 'Panel').classList.add('active');
  });
});

setInterval(()=>{ renderToday(); renderLists(); }, 60000);
window.addEventListener('storage', e=>{
  if(e.key !== LS_INVITES || !_currentUser) return;
  const before = renderInvites._lastCount || 0;
  renderInvites();
  const now = pendingInvitesForCurrentUser().length;
  renderInvites._lastCount = now;
  if(now > before) toast('وصلتك دعوة حدث جديدة','ok');
});

/* ============================================================
   IndexedDB - النسخ
   ============================================================ */
const DB_NAME = 'CalendarBackupDB';
const DB_VER  = 1;
const STORE   = 'backups';

function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE)){
        db.createObjectStore(STORE, { keyPath:'id', autoIncrement:true });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror   = ()=> reject(req.error);
  });
}
async function dbAdd(record){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,'readwrite');
    const r  = tx.objectStore(STORE).add(record);
    r.onsuccess = ()=> res(r.result);
    r.onerror   = ()=> rej(r.error);
  });
}
async function dbAll(){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,'readonly');
    const r  = tx.objectStore(STORE).getAll();
    r.onsuccess = ()=> res(r.result || []);
    r.onerror   = ()=> rej(r.error);
  });
}
async function dbGet(id){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,'readonly');
    const r  = tx.objectStore(STORE).get(id);
    r.onsuccess = ()=> res(r.result);
    r.onerror   = ()=> rej(r.error);
  });
}
async function dbDelete(id){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,'readwrite');
    const r  = tx.objectStore(STORE).delete(id);
    r.onsuccess = ()=> res(true);
    r.onerror   = ()=> rej(r.error);
  });
}

$('bkCreate').addEventListener('click', async ()=>{
  try{
    if(!_currentUser){ toast('سجّل الدخول أولاً','err'); return; }
    const evts = loadEvents();
    await dbAdd({ userId:_currentUser.id, user:_currentUser.email, email:_currentUser.email, when:new Date().toISOString(), count:evts.length, data:evts });
    refreshBackupList();
    toast(`تم إنشاء نسخة احتياطية (${evts.length} حدث)`,'ok');
  }catch(e){ toast('فشل إنشاء النسخة الاحتياطية','err'); }
});

$('bkExport').addEventListener('click', ()=>{
  if(!_currentUser){ toast('سجّل الدخول أولاً','err'); return; }
  const evts = loadEvents();
  const exportedAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify({
    user:_currentUser.email,
    email:_currentUser.loginType === 'email' ? _currentUser.email : '',
    phone:_currentUser.loginType === 'phone' ? _currentUser.email : '',
    userId:_currentUser.id,
    exportedAt,
    count:evts.length,
    data:evts
  }, null, 2)], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `calendar-${safeFilePart(_currentUser.email)}-${timestampForFile()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('تم تصدير الملف','ok');
});

/* تصدير ملف ICS لتقويم iPhone / Android / Outlook */
function escapeIcs(s){
  return String(s)
    .replace(/\\/g,'\\\\')
    .replace(/;/g,'\\;')
    .replace(/,/g,'\\,')
    .replace(/\r?\n/g,'\\n');
}
function pad2(n){ return String(n).padStart(2,'0'); }
function icsDate(y,m,d){ return `${y}${pad2(m)}${pad2(d)}`; }
function icsStamp(){
  const d = new Date();
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth()+1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}
function buildIcs(evts){
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Personal Calendar//AR//',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:التقويم الشخصي',
    'X-WR-TIMEZONE:Asia/Riyadh'
  ];
  const stamp = icsStamp();
  for(const ev of evts){
    const [y,m,d] = ev.date.split('-').map(Number);
    const start = new Date(y, m-1, d);
    const end   = new Date(y, m-1, d+1);  // ICS all-day: end exclusive (اليوم التالي)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.id}@personal-calendar`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(start.getFullYear(), start.getMonth()+1, start.getDate())}`,
      `DTEND;VALUE=DATE:${icsDate(end.getFullYear(), end.getMonth()+1, end.getDate())}`,
      `SUMMARY:${escapeIcs(ev.title)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
$('bkExportIcs').addEventListener('click', ()=>{
  if(!_currentUser){ toast('سجّل الدخول أولاً','err'); return; }
  const evts = loadEvents();
  if(evts.length === 0){ toast('لا توجد أحداث للتصدير','err'); return; }
  const ics = buildIcs(evts);
  // BOM لضمان قراءة العربية بشكل صحيح في بعض البرامج
  const blob = new Blob(['\uFEFF' + ics], { type:'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `calendar-${safeFilePart(_currentUser.email)}-${timestampForFile()}.ics`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`تم تصدير ${evts.length} حدث لملف ICS`,'ok');
});

$('bkImport').addEventListener('click', ()=> $('bkImportFile').click());
$('bkImportFile').addEventListener('change', async e=>{
  const file = e.target.files[0]; if(!file) return;
  try{
    if(!_currentUser){ toast('سجّل الدخول أولاً','err'); e.target.value=''; return; }
    const text = await file.text();
    const obj  = JSON.parse(text);
    const data = Array.isArray(obj) ? obj : (obj.data || []);
    if(!Array.isArray(data)) throw new Error('صيغة غير صالحة');
    const ok = await confirmDialog({
      title:'استيراد ملف',
      message:`سيتم استبدال أحداثك الحالية بـ ${data.length} حدث من الملف. هل تريد المتابعة؟`,
      okText:'استيراد',
      danger:true
    });
    if(!ok){ e.target.value=''; return; }
    saveEvents(data);
    refreshAll();
    toast(`تم استيراد ${data.length} حدث`,'ok');
  }catch(err){ toast('ملف غير صالح','err'); }
  e.target.value='';
});

async function refreshBackupList(){
  const list = $('backupList');
  list.innerHTML = '';
  try{
    const arr = (await dbAll()).filter(x => !_currentUser || x.userId === _currentUser.id).sort((a,b)=> b.id - a.id);
    if(arr.length===0){
      list.innerHTML = `<div class="empty" style="padding:14px;font-size:.85rem;">لا توجد نسخ احتياطية بعد.</div>`;
      return;
    }
    for(const bk of arr){
      const dt = new Date(bk.when);
      const div = document.createElement('div');
      div.className = 'backup-item';
      div.innerHTML = `
        <div>
          <div>نسخة #${bk.id} — ${bk.count} حدث</div>
          <div class="meta">${dt.toLocaleString('ar')}</div>
        </div>
        <div class="actions">
          <button class="btn btn-secondary" data-act="restore">استعادة</button>
          <button class="btn btn-danger" data-act="del">حذف</button>
        </div>
      `;
      div.querySelector('[data-act="restore"]').addEventListener('click', async ()=>{
        const ok = await confirmDialog({
          title:'استعادة النسخة',
          message:`سيتم استبدال الأحداث الحالية بنسخة #${bk.id}. هل تريد المتابعة؟`,
          okText:'استعادة',
          danger:true
        });
        if(!ok) return;
        const rec = await dbGet(bk.id);
        if(!rec){ toast('النسخة غير موجودة','err'); return; }
        saveEvents(rec.data || []);
        refreshAll();
        refreshBackupList();
        toast(`تمت الاستعادة (${rec.count} حدث)`,'ok');
      });
      div.querySelector('[data-act="del"]').addEventListener('click', async ()=>{
        const ok = await confirmDialog({
          title:'حذف النسخة الاحتياطية',
          message:'هل تريد حذف هذه النسخة الاحتياطية نهائياً؟',
          okText:'حذف',
          danger:true
        });
        if(!ok) return;
        await dbDelete(bk.id);
        refreshBackupList();
        toast('تم حذف النسخة','ok');
      });
      list.appendChild(div);
    }
  }catch(e){
    list.innerHTML = `<div class="empty" style="padding:14px;">تعذّر قراءة قاعدة البيانات.</div>`;
  }
}

/* ============================================================
   المناسبات السعودية (وسم: tag === 'sa')
   ============================================================ */
const SA_GREG = [
  { md:'02-22', title:'يوم التأسيس السعودي' },
  { md:'03-11', title:'يوم العلم السعودي' },
  { md:'09-23', title:'اليوم الوطني السعودي' },
];
const SA_HIJRI = [
  { md:'01-01', title:'رأس السنة الهجرية' },
  { md:'09-01', title:'بداية شهر رمضان المبارك' },
  { md:'10-01', title:'عيد الفطر المبارك — اليوم الأول' },
  { md:'10-02', title:'عيد الفطر المبارك — اليوم الثاني' },
  { md:'10-03', title:'عيد الفطر المبارك — اليوم الثالث' },
  { md:'12-09', title:'يوم عرفة' },
  { md:'12-10', title:'عيد الأضحى المبارك — اليوم الأول' },
  { md:'12-11', title:'عيد الأضحى المبارك — اليوم الثاني' },
  { md:'12-12', title:'عيد الأضحى المبارك — اليوم الثالث' },
  { md:'12-13', title:'عيد الأضحى المبارك — اليوم الرابع' },
];

/* التقويم الدراسي للتعليم العام 1448-1449هـ / 2026-2027م
   مخصص للتقويم العام (غير تقاويم الجامعات).
   التواريخ التالية تحفظ كأحداث سعودية مستقلة يمكن حذفها دون المساس بالأحداث الشخصية. */
const SA_SCHOOL_2026_2027 = [
  { date:'2026-08-23', title:'بداية العام الدراسي 1448-1449هـ' },
  { date:'2026-11-20', title:'بداية إجازة الخريف' },
  { date:'2026-11-29', title:'العودة للدراسة بعد إجازة الخريف' },
  { date:'2027-01-08', title:'بداية إجازة منتصف العام الدراسي' },
  { date:'2027-01-17', title:'العودة للدراسة بعد إجازة منتصف العام' },
  { date:'2027-02-26', title:'بداية إجازة عيد الفطر للمدارس' },
  { date:'2027-03-14', title:'العودة للدراسة بعد إجازة عيد الفطر' },
  { date:'2027-05-07', title:'بداية إجازة عيد الأضحى للمدارس' },
  { date:'2027-05-23', title:'العودة للدراسة بعد إجازة عيد الأضحى' },
  { date:'2027-06-24', title:'بداية إجازة نهاية العام الدراسي' },
];

/* مواعيد صرف الرواتب الحكومية الرسمية المنشورة لعام 2026م. */
const SA_SALARY_2026 = [
  '2026-01-27','2026-02-26','2026-03-26','2026-04-27',
  '2026-05-24','2026-06-28','2026-07-27','2026-08-27',
  '2026-09-27','2026-10-27','2026-11-26','2026-12-27'
];

function buildSaudiEvents(years=3){
  const out = [];
  const today = new Date();
  const curG  = today.getFullYear();
  const curH  = gregToHijri(today)?.year || 1446;

  for(let i=0; i<years; i++){
    const gY = curG + i;
    for(const it of SA_GREG){
      const [m,d] = it.md.split('-').map(Number);
      out.push({
        id:`sa_${gY}_${it.md}`,
        title:`🇸🇦 ${it.title}`,
        calType:'greg',
        date:`${gY}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
        tag:'sa',
        saGroup:'national',
        createdAt:new Date().toISOString()
      });
    }

    const hY = curH + i;
    for(const it of SA_HIJRI){
      const [hm,hd] = it.md.split('-').map(Number);
      const g = hijriToGreg(hY, hm, hd);
      if(!g) continue;
      const ds = `${g.getFullYear()}-${String(g.getMonth()+1).padStart(2,'0')}-${String(g.getDate()).padStart(2,'0')}`;
      out.push({
        id:`sa_h${hY}_${it.md}`,
        title:`🌙 ${it.title}`,
        calType:'hijri',
        date:ds,
        tag:'sa',
        saGroup:'national',
        createdAt:new Date().toISOString()
      });
    }
  }
  return out;
}

function buildSaudiSchoolEvents(){
  return SA_SCHOOL_2026_2027.map((it, idx)=>({
    id:`sa_school_1448_1449_${idx+1}`,
    title:`🎓 ${it.title}`,
    calType:'greg',
    date:it.date,
    tag:'sa',
    saGroup:'school',
    createdAt:new Date().toISOString()
  }));
}

function buildSaudiSalaryEvents(){
  return SA_SALARY_2026.map((date, idx)=>({
    id:`sa_salary_2026_${String(idx+1).padStart(2,'0')}`,
    title:`💰 موعد صرف الراتب — ${arMonths[idx]} 2026`,
    calType:'greg',
    date,
    tag:'sa',
    saGroup:'salary',
    createdAt:new Date().toISOString()
  }));
}

function saEventGroup(ev){
  if(ev?.tag !== 'sa') return '';
  /* دعم المناسبات القديمة التي كانت تحمل tag:'sa' فقط */
  return ev.saGroup || 'national';
}

function getSaudiSelectedGroups(){
  return ['national','school','salary'].filter(group=>{
    const el = $(`saOpt_${group}`);
    return !!el?.checked;
  });
}

function initSaudiOptionsUI(){
  const modal = $('saModal');
  const actions = modal?.querySelector('.sa-actions');
  if(!modal || !actions || $('saOptionsBox')) return;

  const box = document.createElement('div');
  box.id = 'saOptionsBox';
  box.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin:10px 0 14px;padding:12px;background:var(--card-2);border:1px solid var(--border);border-radius:12px;';
  box.innerHTML = `
    <div style="font-weight:800;color:var(--text);margin-bottom:2px;">اختر ما تريد إضافته أو إزالته</div>

    <label style="display:flex;align-items:center;gap:10px;cursor:pointer;color:var(--text);">
      <input id="saOpt_national" type="checkbox" checked style="width:18px;height:18px;accent-color:var(--accent);">
      <span>🇸🇦 المناسبات الوطنية والدينية</span>
    </label>

    <label style="display:flex;align-items:center;gap:10px;cursor:pointer;color:var(--text);">
      <input id="saOpt_school" type="checkbox" checked style="width:18px;height:18px;accent-color:var(--accent);">
      <span>🎓 التقويم الدراسي للمدارس</span>
    </label>

    <label style="display:flex;align-items:center;gap:10px;cursor:pointer;color:var(--text);">
      <input id="saOpt_salary" type="checkbox" checked style="width:18px;height:18px;accent-color:var(--accent);">
      <span>💰 مواعيد الرواتب الحكومية 2026</span>
    </label>

    <div style="color:var(--muted);font-size:.78rem;line-height:1.7;margin-top:3px;">
      الإضافة والإزالة تطبق فقط على الأقسام المحددة، ولا تؤثر على أحداثك الشخصية أو المشتركة.
    </div>
  `;
  actions.parentNode.insertBefore(box, actions);

  const importBtn = $('saImport');
  const removeBtn = $('saRemove');
  if(importBtn) importBtn.textContent = 'استيراد المحدد';
  if(removeBtn) removeBtn.textContent = 'إزالة المحدد';
}

$('saImport').addEventListener('click', async ()=>{
  const groups = getSaudiSelectedGroups();
  if(!groups.length){
    toast('حدد قسماً واحداً على الأقل للاستيراد','err');
    return;
  }

  const labels = {
    national:'المناسبات الوطنية والدينية',
    school:'التقويم الدراسي',
    salary:'مواعيد الرواتب'
  };

  const ok = await confirmDialog({
    title:'استيراد المناسبات السعودية',
    message:`سيتم تحديث الأقسام المحددة فقط: ${groups.map(g=>labels[g]).join('، ')}. أحداثك الشخصية لن تتأثر.`,
    okText:'استيراد',
    danger:false
  });
  if(!ok) return;

  /* نحذف فقط النسخ السعودية السابقة التابعة للأقسام المحددة،
     ثم نعيد إنشاء تلك الأقسام. الأحداث الشخصية والمشتركة لا تمس. */
  const remaining = loadEvents().filter(ev=>{
    if(ev?.tag !== 'sa') return true;
    return !groups.includes(saEventGroup(ev));
  });

  const imported = [];
  if(groups.includes('national')) imported.push(...buildSaudiEvents(1));
  if(groups.includes('school')) imported.push(...buildSaudiSchoolEvents());
  if(groups.includes('salary')) imported.push(...buildSaudiSalaryEvents());

  saveEvents([...remaining, ...imported]);
  refreshAll();
  toast(`تم استيراد ${imported.length} موعداً من الأقسام المحددة`,'ok');
});

$('saRemove').addEventListener('click', async ()=>{
  const groups = getSaudiSelectedGroups();
  if(!groups.length){
    toast('حدد قسماً واحداً على الأقل للإزالة','err');
    return;
  }

  const selectedEvents = loadEvents().filter(ev =>
    ev?.tag === 'sa' && groups.includes(saEventGroup(ev))
  );
  const count = selectedEvents.length;

  if(count === 0){
    toast('لا توجد مواعيد مستوردة ضمن الأقسام المحددة','err');
    return;
  }

  const ok = await confirmDialog({
    title:'إزالة المناسبات السعودية',
    message:`سيتم حذف ${count} موعداً مستورداً من الأقسام المحددة فقط. أحداثك الشخصية والمشتركة لن تتأثر.`,
    okText:'إزالة',
    danger:true
  });
  if(!ok) return;

  saveEvents(loadEvents().filter(ev =>
    !(ev?.tag === 'sa' && groups.includes(saEventGroup(ev)))
  ));
  refreshAll();
  toast(`تم حذف ${count} موعداً مستورداً`,'ok');
});

initSaudiOptionsUI();

/* بدء التشغيل */
initFirebase();
initLock();
