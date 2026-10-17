/* ============================================================
   التقويم العائلي — طبقة البيانات
   مهم: مسارات Firebase وصيغة التخزين مطابقة تماماً للإصدار السابق
   حتى يعمل الإصداران على نفس البيانات دون أي فقد.
   ============================================================ */
'use strict';

const APP_VERSION = '21.2.2';
const LS_USERS   = 'cal_users_v2';
const LS_SESSION = 'cal_session_user_v2';
const LS_EVTS_BASE = 'cal_events_v2';
const LS_INVITES = 'cal_shared_invites_v1';
const ADMIN_EMAIL = 'iadelss12@gmail.com';
// رابط خادم إدارة الحسابات (Cloudflare Worker — انظر worker/accounts-worker.js). فارغ = غير مُعدّ بعد
const ACCOUNTS_API = 'https://fc-accounts.iadelss12.workers.dev/';
const USER_CATEGORIES = { family:'عائلة', work:'عمل', general:'عام', hidden:'مخفي' };

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBiQR0DdTf_pAbu-vMG-SWr16Z1FlBC4F8",
  authDomain: "calendartest-20650.firebaseapp.com",
  databaseURL: "https://calendartest-20650-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "calendartest-20650",
  storageBucket: "calendartest-20650.firebasestorage.app",
  messagingSenderId: "134189882922",
  appId: "1:134189882922:web:8071bd543e4e221398ed53"
};

const Store = {
  fbReady:false,
  user:null,
  events:[],
  invites:[],
  shared:{},
  creatingAccount:false,
  pendingSync:Promise.resolve(),
  onChange(){},              // تُستبدل من الواجهة
  onSync(){},                // (msg, type)
  onAdminDirectory(){},      // (users)
  _refs:{ events:null, eventsL:null, invites:null, invitesL:null, shared:{}, admin:null, adminL:null }
};

function db(path){ return firebase.database().ref(path); }
function nowIso(){ return new Date().toISOString(); }
function genId(){ return 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }

/* ---------- المعرفات والمستخدم ---------- */
function normalizePhone(phone){
  let v = toEnglishDigits(phone).trim().replace(/[\s\-().]/g, '');
  if(v.startsWith('00')) v = '+' + v.slice(2);
  if(/^05\d{8}$/.test(v)) return '+966' + v.slice(1);
  if(/^5\d{8}$/.test(v)) return '+966' + v;
  if(/^9665\d{8}$/.test(v)) return '+' + v;
  return v;
}
function normalizeIdentifier(v){
  const raw = String(v || '').trim();
  return raw.includes('@') ? raw.toLowerCase() : normalizePhone(raw);
}
function isValidEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim().toLowerCase()); }
function identifierKey(id){ return btoa(String(id || '')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function normalizeUserCategory(v){ return USER_CATEGORIES[v] ? v : 'general'; }
function displayUser(u){ if(!u) return ''; if(typeof u === 'string') return u; return u.displayName || u.email || ''; }
function isAdminUser(u=Store.user){ return String(u?.email || '').trim().toLowerCase() === ADMIN_EMAIL; }
function userVisibleName(u){ return String(u?.displayName || u?.name || u?.identifier || 'مستخدم'); }
async function hashPw(pw){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function firebaseUserToAppUser(fbUser, identifier){
  const clean = normalizeIdentifier(identifier || fbUser.phoneNumber || fbUser.email || '');
  return { id:fbUser.uid, email:clean, displayName:fbUser.displayName || clean,
           loginType:isValidEmail(clean) ? 'email' : 'phone', authUid:fbUser.uid, createdAt:nowIso() };
}
function loadUsers(){ try{ return JSON.parse(localStorage.getItem(LS_USERS) || '{}') || {}; }catch(e){ return {}; } }
function saveUsers(u){ try{ localStorage.setItem(LS_USERS, JSON.stringify(u)); }catch(e){} }
async function getOrCreateUser(email, displayName=''){
  const clean = normalizeIdentifier(email), name = String(displayName || '').trim();
  const users = loadUsers();
  if(!users[clean]){
    users[clean] = { id:(await hashPw(clean)).slice(0,24), email:clean, displayName:name || clean,
                     loginType:isValidEmail(clean) ? 'email' : 'phone', createdAt:nowIso() };
  }else if(name && users[clean].displayName !== name){
    users[clean].displayName = name;
  }else if(!users[clean].displayName){
    users[clean].displayName = users[clean].email || clean;
  }
  saveUsers(users);
  return users[clean];
}
function setCurrentUser(u){
  Store.user = u;
  try{ if(u) localStorage.setItem(LS_SESSION, u.email); }catch(e){}
}
function eventsKey(){ return `${LS_EVTS_BASE}_${Store.user ? Store.user.id : 'guest'}`; }

/* ---------- ملف المستخدم والموافقة ---------- */
async function saveFirebaseUserProfile(user, {isNew=false}={}){
  if(!Store.fbReady || !user) return null;
  const profileRef = db(`users/${user.id}/profile`);
  let existing = {};
  try{ existing = (await profileRef.once('value')).val() || {}; }catch(e){}
  const admin = isAdminUser(user);
  const profile = {
    uid:user.id,
    identifier:user.email,
    displayName:displayUser(user),
    loginType:user.loginType || (isValidEmail(user.email) ? 'email' : 'phone'),
    role:admin ? 'admin' : 'user',
    approvalStatus: admin ? 'approved' : (isNew ? 'pending' : (existing.approvalStatus || 'approved')),
    hiddenFromDirectory: admin ? false : Boolean(existing.hiddenFromDirectory),
    category: admin ? 'general' : (isNew ? 'general' : normalizeUserCategory(existing.category)),
    createdAt:existing.createdAt || user.createdAt || nowIso(),
    updatedAt:nowIso()
  };
  try{
    await profileRef.update(profile);
    await db(`directory/${identifierKey(user.email)}`).set(profile);
    await db(`publicDirectory/${user.id}`).set({
      uid:user.id, displayName:profile.displayName, approvalStatus:profile.approvalStatus,
      hiddenFromDirectory:profile.hiddenFromDirectory, category:profile.category, updatedAt:profile.updatedAt
    });
    if(profile.approvalStatus === 'approved' && !profile.hiddenFromDirectory){
      const entry = { uid:user.id, displayName:profile.displayName, category:profile.category, role:profile.role, updatedAt:profile.updatedAt };
      if(admin){
        // المدير يظهر في كل التصنيفات حتى يستطيع الجميع مشاركته
        await Promise.all(['family','work','general'].map(cat =>
          db(`groupDirectories/${cat}/${user.id}`).set({ ...entry, category:cat, sourceCategory:'admin' })));
      }else{
        await db(`groupDirectories/${profile.category}/${user.id}`).set(entry);
      }
    }
  }catch(e){ console.error('تعذر حفظ ملف المستخدم:', e); }
  return profile;
}
async function getUserAccessStatus(user){
  if(isAdminUser(user)) return {allowed:true, status:'approved'};
  try{
    const profile = (await db(`users/${user.id}/profile`).once('value')).val() || {};
    const status = profile.approvalStatus || 'approved'; // الحسابات القديمة تُعد معتمدة
    return {allowed:status === 'approved', status, profile};
  }catch(e){ return {allowed:false, status:'error'}; }
}
function accessStatusMessage(status){
  return ({
    pending:'حسابك بانتظار موافقة المدير. ستتمكن من الدخول بعد قبوله.',
    rejected:'لم تتم الموافقة على هذا الحساب. تواصل مع مدير التطبيق.',
    disabled:'هذا الحساب معطّل مؤقتاً من مدير التطبيق.',
    deleted:'تم حذف بيانات هذا الحساب من التطبيق. تواصل مع المدير.'
  })[status] || 'تعذر التحقق من صلاحية الحساب الآن. حاول مرة أخرى.';
}
function authErrorMessage(ex){
  return ({
    'auth/email-already-in-use':'هذا البريد مسجل مسبقاً. استخدم تسجيل الدخول.',
    'auth/user-not-found':'لا يوجد حساب بهذا البريد.',
    'auth/wrong-password':'البريد أو كلمة المرور غير صحيحة.',
    'auth/invalid-credential':'البريد أو كلمة المرور غير صحيحة.',
    'auth/weak-password':'كلمة المرور ضعيفة. استخدم 6 أحرف على الأقل.',
    'auth/invalid-email':'صيغة البريد الإلكتروني غير صحيحة.',
    'auth/too-many-requests':'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.',
    'auth/requires-recent-login':'للحماية سجّل الدخول من جديد ثم أعد المحاولة.',
    'auth/network-request-failed':'لا يوجد اتصال بالإنترنت. تحقق من الشبكة.',
    'auth/unauthorized-domain':'هذا النطاق غير مصرح به في Firebase Authentication.',
    'auth/operation-not-allowed':'فعّل Email/Password من Firebase Authentication.',
    'auth/expired-action-code':'انتهت صلاحية رابط إعادة التعيين. اطلب رابطاً جديداً من «نسيت كلمة المرور؟».',
    'auth/invalid-action-code':'الرابط غير صالح أو استُخدم من قبل. اطلب رابطاً جديداً من «نسيت كلمة المرور؟».',
    'auth/user-disabled':'هذا الحساب موقوف. تواصل مع المدير.',
    'auth/missing-email':'اكتب بريدك الإلكتروني أولاً.'
  })[ex?.code] || ex?.message || 'تعذر إكمال العملية. حاول مرة أخرى.';
}

/* ---------- الدخول والحساب ---------- */
const Auth = {
  async signIn(email, password){
    email = normalizeIdentifier(email);
    if(!isValidEmail(email)) throw {code:'auth/invalid-email'};
    if(!password || password.length < 6) throw {message:'كلمة المرور 6 أحرف على الأقل.'};
    const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
    const user = firebaseUserToAppUser(cred.user, email);
    if(user.displayName === user.email){
      const local = await getOrCreateUser(user.email);
      user.displayName = local.displayName || user.email;
    }
    await saveFirebaseUserProfile(user);
    const access = await getUserAccessStatus(user);
    if(!access.allowed){
      await firebase.auth().signOut().catch(()=>{});
      throw {message:accessStatusMessage(access.status)};
    }
    return user;
  },
  async signUp(fullName, email, password, confirm){
    email = normalizeIdentifier(email);
    fullName = String(fullName || '').trim();
    if(fullName.length < 2) throw {message:'اكتب اسمك الكامل.'};
    if(!isValidEmail(email)) throw {code:'auth/invalid-email'};
    if(!password || password.length < 6) throw {code:'auth/weak-password'};
    if(password !== confirm) throw {message:'تأكيد كلمة المرور غير مطابق.'};
    Store.creatingAccount = true;
    try{
      const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName:fullName });
      const user = firebaseUserToAppUser(cred.user, email);
      user.displayName = fullName;
      await getOrCreateUser(user.email, fullName);
      await saveFirebaseUserProfile(user, {isNew:true});
      if(isAdminUser(user)) return {user, pending:false};
      await firebase.auth().signOut().catch(()=>{});
      return {user:null, pending:true};
    }finally{ Store.creatingAccount = false; }
  },
  async resetPassword(email){
    email = normalizeIdentifier(email);
    if(!isValidEmail(email)) throw {message:'اكتب بريدك الإلكتروني في الخانة أعلاه أولاً، ثم اضغط «نسيت كلمة المرور؟».'};
    firebase.auth().languageCode = 'ar';                       // رسالة البريد بالعربية
    const url = location.origin + location.pathname;            // زر «متابعة» في الرسالة يعيد إلى التقويم
    try{ await firebase.auth().sendPasswordResetEmail(email, {url, handleCodeInApp:false}); }
    catch(ex){
      if(/continue-uri|unauthorized-domain/.test(ex?.code || '')) await firebase.auth().sendPasswordResetEmail(email);
      else throw ex;
    }
  },
  /* فتح رابط إعادة التعيين داخل التقويم نفسه (?mode=resetPassword&oobCode=...) */
  async checkResetCode(code){
    firebase.auth().languageCode = 'ar';
    return firebase.auth().verifyPasswordResetCode(code);      // يعيد البريد صاحب الرابط
  },
  async confirmReset(code, pw, confirm){
    if(!pw || pw.length < 6) throw {code:'auth/weak-password'};
    if(pw !== confirm) throw {message:'تأكيد كلمة المرور غير مطابق.'};
    await firebase.auth().confirmPasswordReset(code, pw);
  },
  async updateName(name){
    name = String(name || '').trim();
    if(name.length < 2) throw {message:'اكتب اسماً صحيحاً.'};
    await firebase.auth().currentUser.updateProfile({ displayName:name });
    Store.user.displayName = name;
    await getOrCreateUser(Store.user.email, name);
    await saveFirebaseUserProfile(Store.user);
  },
  async changePassword(oldPw, newPw, confirm){
    if(!oldPw) throw {message:'اكتب كلمة المرور الحالية.'};
    if(!newPw || newPw.length < 6) throw {code:'auth/weak-password'};
    if(newPw !== confirm) throw {message:'تأكيد كلمة المرور غير مطابق.'};
    const cred = firebase.auth.EmailAuthProvider.credential(Store.user.email, oldPw);
    await firebase.auth().currentUser.reauthenticateWithCredential(cred);
    await firebase.auth().currentUser.updatePassword(newPw);
  },
  async signOut(){
    detachUserListeners();
    detachAdminListener();
    if(Store.fbReady) await firebase.auth().signOut().catch(()=>{});
    Store.user = null;
    Store.events = [];
    Store.invites = [];
    Store.shared = {};
  }
};

async function enterAppData(user){
  const access = await getUserAccessStatus(user);
  if(access?.profile) user.category = normalizeUserCategory(access.profile.category);
  setCurrentUser(user);
  await loadUserData();
  if(isAdminUser(user)) attachAdminListener();
}

/* ---------- صيغة المواعيد في Firebase (schema 2) ---------- */
function normalizeFirebaseEvents(raw){
  if(!raw) return [];
  if(Array.isArray(raw)) return raw.filter(Boolean);
  if(raw.items && typeof raw.items === 'object') return Object.values(raw.items).filter(Boolean);
  if(typeof raw === 'object'){
    return Object.entries(raw)
      .filter(([k]) => k !== '__meta' && k !== 'meta' && k !== 'items')
      .map(([,v]) => v)
      .filter(v => v && typeof v === 'object' && v.id);
  }
  return [];
}
function eventsToFirebasePayload(events){
  const items = {};
  for(const ev of (events || [])) if(ev && ev.id) items[ev.id] = ev;
  return { __meta:{ schema:2, count:Object.keys(items).length, updatedAt:nowIso() }, items };
}
function isSchema2Events(raw){ return !!(raw && typeof raw === 'object' && raw.__meta && Number(raw.__meta.schema) === 2); }
function mergeEvents(local, remote){
  const map = new Map();
  for(const ev of (local || [])) if(ev && ev.id) map.set(ev.id, ev);
  for(const ev of (remote || [])){
    if(!ev || !ev.id) continue;
    const old = map.get(ev.id);
    const ot = Date.parse(old?.updatedAt || old?.createdAt || 0) || 0;
    const nt = Date.parse(ev.updatedAt || ev.createdAt || 0) || 0;
    if(!old || nt >= ot) map.set(ev.id, ev);
  }
  return Array.from(map.values());
}
/* Firebase لا يقبل undefined */
function cleanObj(o){
  const out = {};
  for(const [k,v] of Object.entries(o)) if(v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
}

function saveEvents(arr){
  Store.events = (Array.isArray(arr) ? arr : []).filter(Boolean);
  try{ localStorage.setItem(eventsKey(), JSON.stringify(Store.events)); }catch(e){}
  if(Store.fbReady && Store.user){
    Store.onSync('syncing');
    Store.pendingSync = db(`users/${Store.user.id}/events`).set(eventsToFirebasePayload(Store.events))
      .then(()=> Store.onSync('ok'))
      .catch(err=>{ console.error('تعذرت المزامنة:', err); Store.onSync('warn'); throw err; });
    Store.pendingSync.catch(()=>{});
    return Store.pendingSync;
  }
  Store.onSync('local');
  return Promise.resolve();
}

function loadInvitesLocal(){ try{ return JSON.parse(localStorage.getItem(LS_INVITES) || '[]') || []; }catch(e){ return []; } }
function saveInvitesLocal(list){ Store.invites = list; try{ localStorage.setItem(LS_INVITES, JSON.stringify(list)); }catch(e){} }

function detachUserListeners(){
  const r = Store._refs;
  for(const id of Object.keys(r.shared)){ try{ r.shared[id].ref.off('value', r.shared[id].fn); }catch(e){} }
  r.shared = {};
  if(r.events && r.eventsL) try{ r.events.off('value', r.eventsL); }catch(e){}
  if(r.invites && r.invitesL) try{ r.invites.off('value', r.invitesL); }catch(e){}
  r.events = r.eventsL = r.invites = r.invitesL = null;
}

async function loadUserData(){
  detachUserListeners();
  try{ Store.events = JSON.parse(localStorage.getItem(eventsKey()) || '[]'); }catch(e){ Store.events = []; }
  if(!Array.isArray(Store.events)) Store.events = [];
  Store.invites = loadInvitesLocal();
  Store.onChange();   // عرض فوري للنسخة المحفوظة على الجهاز
  if(!Store.fbReady || !Store.user) return;
  const r = Store._refs;
  r.events = db(`users/${Store.user.id}/events`);
  try{
    Store.onSync('loading');
    const local = Store.events.filter(Boolean);
    const raw = (await r.events.once('value')).val();
    const remote = normalizeFirebaseEvents(raw);
    if(isSchema2Events(raw)){
      Store.events = remote;
    }else if(remote.length){
      Store.events = mergeEvents(local, remote);
      await r.events.set(eventsToFirebasePayload(Store.events));
    }else if(local.length){
      Store.events = local;   // لا نحذف النسخة المحلية؛ نرفعها
      await r.events.set(eventsToFirebasePayload(Store.events));
    }else{
      Store.events = [];
      await r.events.set(eventsToFirebasePayload([]));
    }
    try{ localStorage.setItem(eventsKey(), JSON.stringify(Store.events)); }catch(e){}
    watchSharedFromLocal();
    Store.onSync('ok');
    Store.onChange();

    r.eventsL = sn=>{
      const raw2 = sn.val(), incoming = normalizeFirebaseEvents(raw2);
      if(isSchema2Events(raw2)) Store.events = incoming;
      else if(incoming.length) Store.events = mergeEvents(Store.events, incoming);
      else return; // لا نمسح المواعيد بسبب قيمة فارغة عابرة
      try{ localStorage.setItem(eventsKey(), JSON.stringify(Store.events)); }catch(e){}
      watchSharedFromLocal();
      Store.onSync('ok');
      Store.onChange();
    };
    r.events.on('value', r.eventsL);

    r.invites = db(`users/${Store.user.id}/invites`);
    saveInvitesLocal(Object.values((await r.invites.once('value')).val() || {}));
    r.invitesL = sn=>{ saveInvitesLocal(Object.values(sn.val() || {})); Store.onChange('invites'); };
    r.invites.on('value', r.invitesL);
  }catch(e){
    console.error('تعذر تحميل المواعيد:', e);
    Store.onSync('offline');
    Store.onChange();
  }
}

function initFirebase(onAutoLogin){
  if(typeof firebase === 'undefined') return;
  try{
    if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    Store.fbReady = true;
    firebase.auth().onAuthStateChanged(async fbUser=>{
      if(!fbUser || Store.user || Store.creatingAccount){ if(!fbUser) onAutoLogin(null); return; }
      let identifier = fbUser.phoneNumber || fbUser.email;
      try{ identifier = identifier || localStorage.getItem(LS_SESSION); }catch(e){}
      if(!identifier){ onAutoLogin(null); return; }
      const user = firebaseUserToAppUser(fbUser, identifier);
      await getOrCreateUser(user.email, user.displayName);
      await saveFirebaseUserProfile(user);
      const access = await getUserAccessStatus(user);
      if(!access.allowed){
        await firebase.auth().signOut().catch(()=>{});
        onAutoLogin(null, accessStatusMessage(access.status));
        return;
      }
      onAutoLogin(user);
    });
  }catch(e){ console.error(e); }
}

/* ---------- المواعيد المشتركة ---------- */
function watchSharedEvent(id){
  if(!Store.fbReady || !id || Store._refs.shared[id]) return;
  const ref = db(`sharedEvents/${id}`);
  const fn = sn=>{
    const v = sn.val();
    if(v) Store.shared[id] = v; else delete Store.shared[id];
    Store.onChange();
  };
  Store._refs.shared[id] = {ref, fn};
  ref.on('value', fn);
}
function watchSharedFromLocal(){
  const wanted = new Set(Store.events.filter(e => e && e.type === 'sharedRef' && e.sharedEventId).map(e => e.sharedEventId));
  for(const id of Object.keys(Store._refs.shared)){
    if(!wanted.has(id)){ const r = Store._refs.shared[id]; try{ r.ref.off('value', r.fn); }catch(e){} delete Store._refs.shared[id]; }
  }
  wanted.forEach(watchSharedEvent);
}
const EXTRA_FIELDS = ['time','notes','repeat'];
function pickExtras(ev){ const o = {}; for(const k of EXTRA_FIELDS) if(ev[k]) o[k] = ev[k]; return o; }

function resolveEvent(ev){
  if(!ev || ev.hiddenFromCalendar === true) return null;
  if(ev.type === 'sharedRef' && ev.sharedEventId){
    const shared = Store.shared[ev.sharedEventId];
    if(shared && shared.deleted) return null;
    if(!shared){
      return { ...ev, localRefId:ev.id, isShared:true, sharedRole:ev.role || 'viewer', sharedFrom:ev.sharedFrom || 'مستخدم آخر' };
    }
    return {
      ...shared, id:ev.id, localRefId:ev.id, sharedEventId:ev.sharedEventId, isShared:true,
      sharedRole: shared.roles?.[Store.user?.id] || ev.role || 'viewer',
      sharedFrom: shared.ownerName || shared.ownerEmail || ev.sharedFrom || 'مستخدم آخر'
    };
  }
  const legacyShared = !!(ev.type === 'sharedRef' || ev.sharedEventId || ev.sharedInviteId || ev.sharedFrom ||
    ev.fromUserId || ev.ownerEmail || ev.role === 'viewer' || ev.role === 'editor');
  const mine = !!(ev.ownerId && Store.user && ev.ownerId === Store.user.id);
  return {
    ...ev,
    localRefId:ev.id,
    isShared: legacyShared && !mine,
    sharedRole: ev.sharedRole || ev.role || (mine ? 'owner' : (legacyShared ? 'viewer' : undefined)),
    sharedFrom: ev.sharedFrom || ev.fromName || ev.fromEmail || ev.ownerName || ev.ownerEmail || ''
  };
}
function getDisplayEvents(){ return Store.events.map(resolveEvent).filter(e => e && eventBaseDate(e)); }
function findDisplayEvent(localId){ const raw = Store.events.find(x => x && x.id === localId); return raw ? resolveEvent(raw) : null; }
function canEditEvent(ev){
  if(!ev || !Store.user) return false;
  if(!ev.isShared) return true;
  return ev.ownerId === Store.user.id || ev.sharedRole === 'owner' || ev.sharedRole === 'editor';
}
function canShareEvent(ev){
  if(!ev || !Store.user) return false;
  return !ev.isShared || ev.ownerId === Store.user.id || ev.sharedRole === 'owner';
}
function roleLabel(role){
  return ({owner:'مالك', editor:'مشترك · تعديل', viewer:'مشترك · مشاهدة'})[role] || 'خاص';
}

async function upsertSharedEventFromLocal(ev){
  if(!Store.fbReady || !Store.user || !ev?.sharedEventId) return;
  const ref = db(`sharedEvents/${ev.sharedEventId}`);
  const old = (await ref.once('value')).val() || {};
  const roles = old.roles || {};
  roles[Store.user.id] = 'owner';
  const shared = {
    ...old, id:ev.sharedEventId, title:ev.title, calType:ev.calType || 'greg', date:ev.date,
    ownerId:Store.user.id, ownerEmail:Store.user.email, ownerName:displayUser(Store.user),
    roles, deleted:false, updatedAt:nowIso(), createdAt:old.createdAt || ev.createdAt || nowIso()
  };
  for(const k of EXTRA_FIELDS){ if(ev[k]) shared[k] = ev[k]; else delete shared[k]; }
  await ref.set(shared);
  Store.shared[ev.sharedEventId] = shared;
}
async function ensureSharedEventForEvent(raw){
  if(!Store.fbReady || !Store.user || !raw) return null;
  const evts = Store.events.slice();
  const idx = evts.findIndex(x => x.id === raw.id);
  const sharedId = raw.sharedEventId || raw.id;
  if(idx >= 0 && !evts[idx].sharedEventId){
    evts[idx] = { ...evts[idx], sharedEventId:sharedId, ownerId:Store.user.id, sharedRole:'owner', updatedAt:nowIso() };
    saveEvents(evts);
  }
  const ev = idx >= 0 ? evts[idx] : raw;
  await upsertSharedEventFromLocal({ ...ev, sharedEventId:sharedId, ownerId:Store.user.id });
  watchSharedEvent(sharedId);
  return sharedId;
}

/* ---------- حفظ وحذف ---------- */
/* data: {title, calType, date, time, notes, repeat} */
function saveEventData(localId, data){
  const now = nowIso();
  const fields = { title:data.title, calType:data.calType, date:data.date };
  const extras = { time:data.time || '', notes:data.notes || '', repeat:data.repeat || '' };
  const evts = Store.events.slice();
  if(localId){
    const idx = evts.findIndex(x => x.id === localId);
    if(idx < 0) throw {message:'لم يُعثر على الموعد.'};
    const current = resolveEvent(evts[idx]);
    if(current?.isShared && current.sharedEventId){
      if(!canEditEvent(current)) throw {message:'ليست لديك صلاحية تعديل هذا الموعد.'};
      const upd = { ...fields, updatedAt:now };
      for(const k of EXTRA_FIELDS) upd[k] = extras[k] || null; // null يحذف الحقل في Firebase
      if(Store.fbReady) db(`sharedEvents/${current.sharedEventId}`).update(upd).catch(()=>{});
      const merged = { ...(Store.shared[current.sharedEventId] || {}), ...fields, updatedAt:now };
      for(const k of EXTRA_FIELDS){ if(extras[k]) merged[k] = extras[k]; else delete merged[k]; }
      Store.shared[current.sharedEventId] = merged;
      Store.onChange();
      return Promise.resolve();
    }
    const next = { ...evts[idx], ...fields, updatedAt:now };
    for(const k of EXTRA_FIELDS){ if(extras[k]) next[k] = extras[k]; else delete next[k]; }
    evts[idx] = next;
    if(next.sharedEventId) upsertSharedEventFromLocal(next).catch(()=>{});
  }else{
    evts.push(cleanObj({ id:genId(), ...fields, ...extras, ownerId:Store.user?.id || '', createdAt:now, updatedAt:now }));
  }
  return saveEvents(evts);
}

async function deleteEventById(localId){
  const raw = Store.events.find(x => x.id === localId);
  const ev = resolveEvent(raw);
  if(!raw) return 'none';
  const markDeleted = id => (id && Store.fbReady) ? db(`sharedEvents/${id}`).update({deleted:true, updatedAt:nowIso()}).catch(()=>{}) : null;
  if(ev?.isShared){
    if(ev.ownerId === Store.user?.id || ev.sharedRole === 'owner'){
      await markDeleted(ev.sharedEventId);
      await saveEvents(Store.events.filter(x => x.id !== localId)).catch(()=>{});
      return 'deleted';
    }
    // إزالة من تقويم المستلم فقط (مع دعم الصيغ القديمة)
    const sharedId = ev.sharedEventId || raw.sharedEventId || '';
    const inviteId = raw.sharedInviteId || ev.sharedInviteId || '';
    const lTitle = String(ev.title || raw.title || '').trim();
    const lDate = String(ev.date || raw.date || '').trim();
    const lSender = String(ev.sharedFrom || raw.sharedFrom || raw.fromName || raw.fromEmail || ev.ownerEmail || raw.ownerEmail || '').trim();
    const updated = Store.events.filter(x=>{
      if(!x || x.id === localId) return false;
      if(sharedId && x.sharedEventId === sharedId) return false;
      if(inviteId && x.sharedInviteId === inviteId) return false;
      const xs = String(x.sharedFrom || x.fromName || x.fromEmail || x.ownerEmail || '').trim();
      const sameLegacy = !sharedId && !inviteId && lTitle && lDate &&
        String(x.title || '').trim() === lTitle && String(x.date || '').trim() === lDate && (!lSender || !xs || xs === lSender);
      return !sameLegacy;
    });
    await saveEvents(updated).catch(()=>{});
    if(inviteId){
      const invites = Store.invites.slice();
      const inv = invites.find(x => x.id === inviteId);
      if(inv){
        inv.status = 'removed'; inv.removedAt = nowIso();
        saveInvitesLocal(invites);
        if(Store.fbReady && Store.user) await db(`users/${Store.user.id}/invites/${inviteId}`).set(inv).catch(()=>{});
      }
    }
    return 'removed';
  }
  await markDeleted(raw.sharedEventId);
  await saveEvents(Store.events.filter(x => x.id !== localId)).catch(()=>{});
  return 'deleted';
}

/* ---------- الدعوات ---------- */
function pendingInvites(){
  if(!Store.user) return [];
  return Store.invites.filter(x => (x.toUserId === Store.user.id || x.toEmail === Store.user.email) && x.status === 'pending');
}
async function acceptInvite(id){
  const invites = Store.invites.slice();
  const inv = invites.find(x => x.id === id && (x.toUserId === Store.user?.id || x.toEmail === Store.user?.email));
  if(!inv || inv.status !== 'pending') return;
  const ev = inv.event || {};
  const evts = Store.events.slice();
  const sharedId = inv.sharedEventId;
  const localId = 'shared_' + (sharedId || inv.id);
  if(!evts.some(x => x.id === localId || (sharedId && x.sharedEventId === sharedId) || x.sharedInviteId === inv.id)){
    evts.push(cleanObj({
      id:localId, type:'sharedRef', title:ev.title || 'موعد مشترك', calType:ev.calType || 'greg', date:ev.date,
      ...pickExtras(ev),
      ownerId:inv.fromUserId || '', sharedFrom:inv.fromName || inv.fromEmail || 'مستخدم آخر',
      sharedInviteId:inv.id, sharedEventId:sharedId || '', role:inv.role || 'viewer',
      createdAt:nowIso(), updatedAt:nowIso()
    }));
  }
  inv.status = 'accepted'; inv.respondedAt = nowIso();
  saveInvitesLocal(invites);
  saveEvents(evts);
  if(sharedId) watchSharedEvent(sharedId);
  if(Store.fbReady && Store.user){
    try{ await Store.pendingSync; }catch(e){}
    await db(`users/${Store.user.id}/invites/${inv.id}`).set(inv);
    if(sharedId) await db(`sharedEvents/${sharedId}/roles/${Store.user.id}`).set(inv.role || 'viewer').catch(()=>{});
  }
}
async function rejectInvite(id){
  const invites = Store.invites.slice();
  const inv = invites.find(x => x.id === id && (x.toUserId === Store.user?.id || x.toEmail === Store.user?.email));
  if(!inv || inv.status !== 'pending') return;
  inv.status = 'rejected'; inv.respondedAt = nowIso();
  saveInvitesLocal(invites);
  if(Store.fbReady && Store.user) await db(`users/${Store.user.id}/invites/${inv.id}`).set(inv).catch(()=>{});
}

async function loadShareUsers(){
  if(!Store.fbReady || !Store.user) throw {message:'المشاركة تحتاج اتصالاً بالإنترنت.'};
  let users;
  if(isAdminUser()){
    const sn = await db('directory').once('value');
    users = Object.values(sn.val() || {}).filter(u => u && u.uid && u.uid !== Store.user.id && u.approvalStatus === 'approved' && !u.hiddenFromDirectory);
  }else{
    const sn = await db(`groupDirectories/${normalizeUserCategory(Store.user.category)}`).once('value');
    users = Object.values(sn.val() || {}).filter(u => u && u.uid && u.uid !== Store.user.id);
  }
  const isAdm = u => u.role === 'admin' || String(u.identifier || '').toLowerCase() === ADMIN_EMAIL;
  users.forEach(u => u._admin = isAdm(u));
  users.sort((a,b)=> (a._admin !== b._admin) ? (a._admin ? -1 : 1) : userVisibleName(a).localeCompare(userVisibleName(b), 'ar'));
  return users;
}
async function sendShareInvites(localId, targets, role){
  const raw = Store.events.find(x => x.id === localId);
  const current = resolveEvent(raw);
  if(!current || !Store.user) throw {message:'لم يُعثر على الموعد.'};
  if(!canShareEvent(current)) throw {message:'المشاركة متاحة لمالك الموعد فقط.'};
  if(!Store.fbReady) throw {message:'المشاركة تحتاج اتصالاً بالإنترنت.'};
  if(!targets.length) throw {message:'اختر شخصاً واحداً على الأقل.'};
  const sharedEventId = current.sharedEventId || await ensureSharedEventForEvent(raw);
  if(!sharedEventId) throw {message:'تعذر تجهيز الموعد للمشاركة.'};
  let sent = 0;
  for(const t of targets){
    if(t.id === Store.user.id) continue;
    await db(`sharedEvents/${sharedEventId}/roles/${t.id}`).set(role).catch(()=>{});
    const inv = {
      id:'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2,8),
      fromEmail:Store.user.email, fromUserId:Store.user.id, fromName:displayUser(Store.user),
      toEmail:t.email, toUserId:t.id, status:'pending', role, sharedEventId, sentAt:nowIso(),
      event:{ title:current.title, calType:current.calType || 'greg', date:current.date, ...pickExtras(current) }
    };
    try{ await db(`users/${t.id}/invites/${inv.id}`).set(inv); sent++; }catch(e){ console.error('فشل إرسال الدعوة:', e); }
  }
  if(!sent) throw {message:'لم تُرسل الدعوة. تأكد أن الشخص سجّل دخوله مرة واحدة على الأقل.'};
  return sent;
}

/* ---------- الإدارة ---------- */
let _adminCache = [];
function attachAdminListener(){
  detachAdminListener();
  if(!Store.fbReady || !isAdminUser()) return;
  const r = Store._refs;
  r.admin = db('directory');
  r.adminL = sn=>{ _adminCache = Object.values(sn.val() || {}); Store.onAdminDirectory(_adminCache); };
  r.admin.on('value', r.adminL);
}
function detachAdminListener(){
  const r = Store._refs;
  if(r.admin && r.adminL) try{ r.admin.off('value', r.adminL); }catch(e){}
  r.admin = r.adminL = null;
}
function adminPendingCount(){ return _adminCache.filter(u => u && u.role !== 'admin' && u.approvalStatus === 'pending').length; }
async function setManagedUserState(u, changes){
  if(!isAdminUser() || !u?.uid) return false;
  const payload = { ...changes, updatedAt:nowIso() };
  await db(`users/${u.uid}/profile`).update(payload);
  if(u.identifier) await db(`directory/${identifierKey(u.identifier)}`).update(payload);
  const nextCat = changes.category || normalizeUserCategory(u.category);
  const nextStatus = changes.approvalStatus || u.approvalStatus || 'approved';
  const nextHidden = changes.hiddenFromDirectory !== undefined ? changes.hiddenFromDirectory : Boolean(u.hiddenFromDirectory);
  await db(`publicDirectory/${u.uid}`).update({
    displayName:u.displayName || 'مستخدم', approvalStatus:nextStatus, hiddenFromDirectory:nextHidden, category:nextCat, updatedAt:payload.updatedAt
  });
  for(const cat of ['family','work','general','hidden']) await db(`groupDirectories/${cat}/${u.uid}`).remove();
  if(nextStatus === 'approved' && !nextHidden && nextCat !== 'hidden'){
    await db(`groupDirectories/${nextCat}/${u.uid}`).set({uid:u.uid, displayName:u.displayName || 'مستخدم', category:nextCat, updatedAt:payload.updatedAt});
  }
  return true;
}
async function deleteManagedUserData(u){
  if(!isAdminUser() || !u?.uid) return false;
  const now = nowIso();
  await db(`users/${u.uid}/events`).remove();
  await db(`users/${u.uid}/invites`).remove();
  await db(`users/${u.uid}/profile`).update({approvalStatus:'deleted', hiddenFromDirectory:true, updatedAt:now});
  if(u.identifier) await db(`directory/${identifierKey(u.identifier)}`).update({approvalStatus:'deleted', hiddenFromDirectory:true, updatedAt:now});
  await db(`publicDirectory/${u.uid}`).update({displayName:u.displayName || 'مستخدم', approvalStatus:'deleted', hiddenFromDirectory:true, updatedAt:now});
  for(const cat of ['family','work','general','hidden']) await db(`groupDirectories/${cat}/${u.uid}`).remove();
  return true;
}

/* ---------- حسابات الدخول (Firebase Authentication) عبر الخادم ---------- */
const Accounts = {
  ready(){ return Boolean(ACCOUNTS_API); },
  async call(body){
    if(!isAdminUser() || !firebase.auth().currentUser) throw {message:'هذه الصفحة للمدير فقط.'};
    const idToken = await firebase.auth().currentUser.getIdToken();
    let r;
    try{
      r = await fetch(ACCOUNTS_API, {method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${idToken}`}, body:JSON.stringify(body)});
    }catch(e){ throw {message:'تعذر الاتصال بخادم الحسابات. تحقق من الإنترنت.'}; }
    const j = await r.json().catch(()=> ({}));
    if(!r.ok) throw {message:j.message || ({forbidden:'هذا الإجراء للمدير فقط.', not_configured:'الخادم يحتاج السر SERVICE_ACCOUNT.'})[j.error] || `تعذر تنفيذ الطلب (${r.status}).`};
    return j;
  },
  list(){ return this.call({action:'list'}).then(j => j.users || []); },
  disable(uid, disabled){ return this.call({action:'disable', uid, disabled}); },
  async remove(user, dirEntry){
    await this.call({action:'delete', uid:user.uid});
    // تنظيف بياناته من قاعدة البيانات (إن سمحت الصلاحيات)
    const quiet = async path => { try{ await db(path).remove(); }catch(e){} };
    await quiet(`users/${user.uid}`);
    await quiet(`publicDirectory/${user.uid}`);
    for(const cat of ['family','work','general','hidden']) await quiet(`groupDirectories/${cat}/${user.uid}`);
    const ident = dirEntry?.identifier || user.email;
    if(ident) await quiet(`directory/${identifierKey(ident)}`);
  }
};

/* ---------- النسخ الاحتياطي (نفس قاعدة البيانات السابقة) ---------- */
const Backup = {
  DB:'CalendarBackupDB', STORE:'backups',
  open(){
    return new Promise((res, rej)=>{
      const req = indexedDB.open(this.DB, 1);
      req.onupgradeneeded = e=>{ const d = e.target.result; if(!d.objectStoreNames.contains(this.STORE)) d.createObjectStore(this.STORE, {keyPath:'id', autoIncrement:true}); };
      req.onsuccess = ()=> res(req.result);
      req.onerror = ()=> rej(req.error);
    });
  },
  async tx(mode, fn){
    const d = await this.open();
    return new Promise((res, rej)=>{
      const r = fn(d.transaction(this.STORE, mode).objectStore(this.STORE));
      r.onsuccess = ()=> res(r.result);
      r.onerror = ()=> rej(r.error);
    });
  },
  add(rec){ return this.tx('readwrite', s => s.add(rec)); },
  all(){ return this.tx('readonly', s => s.getAll()); },
  get(id){ return this.tx('readonly', s => s.get(id)); },
  del(id){ return this.tx('readwrite', s => s.delete(id)); },
  async create(){
    const evts = Store.events;
    await this.add({ userId:Store.user.id, user:Store.user.email, email:Store.user.email, when:nowIso(), count:evts.length, data:evts });
    return evts.length;
  },
  async list(){
    return (await this.all()).filter(x => !Store.user || x.userId === Store.user.id).sort((a,b)=> b.id - a.id);
  },
  exportJson(){
    const evts = Store.events, u = Store.user;
    return JSON.stringify({
      user:u.email, email:u.loginType === 'email' ? u.email : '', phone:u.loginType === 'phone' ? u.email : '',
      userId:u.id, exportedAt:nowIso(), count:evts.length, data:evts
    }, null, 2);
  },
  parseImport(text){
    const obj = JSON.parse(text);
    const data = Array.isArray(obj) ? obj : (obj.data || []);
    if(!Array.isArray(data)) throw new Error('bad');
    return data.filter(e => e && e.id && e.date);
  }
};

function fileStamp(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}`;
}
function safeFilePart(v){ return String(v || 'user').replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'') || 'user'; }

/* ---------- ملف ICS لتقويم الجوال ---------- */
function buildIcs(evts){
  const esc = s => String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
  const d0 = new Date();
  const stamp = `${d0.getUTCFullYear()}${pad2(d0.getUTCMonth()+1)}${pad2(d0.getUTCDate())}T${pad2(d0.getUTCHours())}${pad2(d0.getUTCMinutes())}${pad2(d0.getUTCSeconds())}Z`;
  const dStr = d => `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Family Calendar//AR//','CALSCALE:GREGORIAN','METHOD:PUBLISH',
                 'X-WR-CALNAME:التقويم العائلي','X-WR-TIMEZONE:Asia/Riyadh'];
  const pushOne = (ev, date, uidSuffix, rrule) => {
    lines.push('BEGIN:VEVENT', `UID:${ev.id}${uidSuffix}@personal-calendar`, `DTSTAMP:${stamp}`);
    if(ev.time && /^\d{2}:\d{2}$/.test(ev.time)){
      const [h,m] = ev.time.split(':');
      const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), +h + 1, +m);
      lines.push(`DTSTART;TZID=Asia/Riyadh:${dStr(date)}T${h}${m}00`,
                 `DTEND;TZID=Asia/Riyadh:${dStr(end)}T${pad2(end.getHours())}${pad2(end.getMinutes())}00`);
    }else{
      lines.push(`DTSTART;VALUE=DATE:${dStr(date)}`, `DTEND;VALUE=DATE:${dStr(addDays(date,1))}`, 'TRANSP:TRANSPARENT');
    }
    if(rrule) lines.push(rrule);
    lines.push(`SUMMARY:${esc(ev.title)}`);
    if(ev.notes) lines.push(`DESCRIPTION:${esc(ev.notes)}`);
    lines.push('END:VEVENT');
  };
  for(const ev of evts){
    const base = eventBaseDate(ev);
    if(!base) continue;
    if(ev.repeat === 'yearly' && ev.calType === 'hijri'){
      // تقويم الجوال لا يدعم التكرار الهجري؛ نصدّر الخمس سنوات القادمة
      const bh = gregToHijri(base), th = gregToHijri(new Date());
      for(let i=0, hy=Math.max(bh.year, th.year); i<5; i++, hy++){
        const g = occurrenceInHijriYear(bh, hy);
        if(g) pushOne(ev, g, `-${hy}`, '');
      }
    }else{
      pushOne(ev, base, '', ev.repeat === 'yearly' ? 'RRULE:FREQ=YEARLY' : '');
    }
  }
  lines.push('END:VCALENDAR');
  return '\uFEFF' + lines.join('\r\n');
}

/* ---------- المناسبات السعودية (نفس المعرفات السابقة) ---------- */
const SA_GREG = [
  { md:'02-22', title:'يوم التأسيس السعودي' },
  { md:'03-11', title:'يوم العلم السعودي' },
  { md:'09-23', title:'اليوم الوطني السعودي' }
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
  { md:'12-13', title:'عيد الأضحى المبارك — اليوم الرابع' }
];
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
  { date:'2027-06-24', title:'بداية إجازة نهاية العام الدراسي' }
];
const SA_SALARY_2026 = ['2026-01-27','2026-02-26','2026-03-26','2026-04-27','2026-05-24','2026-06-28',
                        '2026-07-27','2026-08-27','2026-09-27','2026-10-27','2026-11-26','2026-12-27'];
const SA_GROUPS = {
  national:{ label:'المناسبات الوطنية والدينية', hint:'يوم التأسيس، يوم العلم، اليوم الوطني، رأس السنة، رمضان، عرفة، والعيدان' },
  school:{ label:'التقويم الدراسي للمدارس', hint:'العام الدراسي 1448-1449هـ وإجازاته' },
  salary:{ label:'مواعيد الرواتب الحكومية', hint:'مواعيد صرف 2026م' }
};
function buildSaudi(group){
  const created = nowIso();
  if(group === 'national'){
    const out = [], today = new Date(), gY = today.getFullYear(), hY = gregToHijri(today)?.year || 1448;
    for(const it of SA_GREG){
      out.push({ id:`sa_${gY}_${it.md}`, title:`🇸🇦 ${it.title}`, calType:'greg', date:`${gY}-${it.md}`, tag:'sa', saGroup:'national', createdAt:created });
    }
    for(const it of SA_HIJRI){
      const [hm, hd] = it.md.split('-').map(Number);
      const g = hijriToGregClamped(hY, hm, hd);
      if(g) out.push({ id:`sa_h${hY}_${it.md}`, title:`🌙 ${it.title}`, calType:'hijri', date:ymd(g), tag:'sa', saGroup:'national', createdAt:created });
    }
    return out;
  }
  if(group === 'school'){
    return SA_SCHOOL_2026_2027.map((it,i)=>({ id:`sa_school_1448_1449_${i+1}`, title:`🎓 ${it.title}`, calType:'greg', date:it.date, tag:'sa', saGroup:'school', createdAt:created }));
  }
  if(group === 'salary'){
    return SA_SALARY_2026.map((date,i)=>({ id:`sa_salary_2026_${pad2(i+1)}`, title:`💰 موعد صرف الراتب — ${AR_MONTHS[i]} 2026`, calType:'greg', date, tag:'sa', saGroup:'salary', createdAt:created }));
  }
  return [];
}
function saGroupOf(ev){ return ev?.tag === 'sa' ? (ev.saGroup || 'national') : ''; }
function saudiCounts(){
  const c = {national:0, school:0, salary:0};
  for(const ev of Store.events) if(ev?.tag === 'sa') c[saGroupOf(ev)] = (c[saGroupOf(ev)] || 0) + 1;
  return c;
}
function importSaudi(groups){
  const remaining = Store.events.filter(ev => ev?.tag !== 'sa' || !groups.includes(saGroupOf(ev)));
  const added = groups.flatMap(buildSaudi);
  saveEvents([...remaining, ...added]);
  return added.length;
}
function removeSaudi(groups){
  const before = Store.events.length;
  saveEvents(Store.events.filter(ev => !(ev?.tag === 'sa' && groups.includes(saGroupOf(ev)))));
  return before - Store.events.length;
}
