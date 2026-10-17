/*
 * خادم صغير لإدارة حسابات التقويم العائلي (Cloudflare Worker)
 * ------------------------------------------------------------
 * حذف حساب من Firebase Authentication يحتاج صلاحية «مدير» لا يجوز وضعها في صفحة الموقع،
 * لذلك يحفظها هذا الخادم سراً (SERVICE_ACCOUNT) ولا يقبل إلا طلبات المدير بعد التحقق من دخوله.
 *
 * الإعداد (مرة واحدة):
 *   1) Firebase ← Project settings ← Service accounts ← Generate new private key  (ملف JSON)
 *   2) Cloudflare ← Workers & Pages ← Create ← Worker ← الصق هذا الملف ← Deploy
 *   3) Worker ← Settings ← Variables and Secrets ← Add ← Secret
 *        الاسم: SERVICE_ACCOUNT    القيمة: محتوى ملف JSON كاملاً
 *
 * الطلبات (POST بصيغة JSON مع الترويسة Authorization: Bearer <idToken للمدير>):
 *   {action:"list"}               ← كل الحسابات
 *   {action:"delete", uid:"..."}  ← حذف حساب نهائياً
 *   {action:"disable", uid, disabled:true|false}
 */

const PROJECT_ID = 'calendartest-20650';
const WEB_API_KEY = 'AIzaSyBiQR0DdTf_pAbu-vMG-SWr16Z1FlBC4F8';   // مفتاح الويب العام نفسه الموجود في التقويم
const ADMIN_EMAIL = 'iadelss12@gmail.com';
const ALLOWED_ORIGINS = ['https://adelss12.github.io'];
const IDT = 'https://identitytoolkit.googleapis.com/v1';

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ ok: true, service: 'fc-accounts' });
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin' }, 403);
    if (!env.SERVICE_ACCOUNT) return json({ error: 'not_configured', message: 'أضف السر SERVICE_ACCOUNT في إعدادات الخادم.' }, 500);

    try {
      // 1) التحقق من أن الطالب هو المدير (Google تتحقق من صحة رمز الدخول)
      const idToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!idToken) return json({ error: 'auth' }, 401);
      const who = await post(`${IDT}/accounts:lookup?key=${WEB_API_KEY}`, { idToken });
      const me = who.users && who.users[0];
      if (!me || String(me.email || '').toLowerCase() !== ADMIN_EMAIL) return json({ error: 'forbidden' }, 403);

      const body = await req.json().catch(() => ({}));
      const token = await accessToken(JSON.parse(env.SERVICE_ACCOUNT));
      const admin = (path, data) => post(`${IDT}/projects/${PROJECT_ID}/${path}`, data, token);

      if (body.action === 'list') {
        const users = [];
        let next = '';
        do {
          const r = await get(`${IDT}/projects/${PROJECT_ID}/accounts:batchGet?maxResults=500${next ? `&nextPageToken=${encodeURIComponent(next)}` : ''}`, token);
          for (const u of r.users || []) users.push({
            uid: u.localId, email: u.email || '', name: u.displayName || '', disabled: !!u.disabled,
            created: Number(u.createdAt || 0), lastLogin: Number(u.lastLoginAt || 0), verified: !!u.emailVerified,
          });
          next = r.nextPageToken || '';
        } while (next);
        return json({ users });
      }

      const uid = String(body.uid || '');
      if (!uid) return json({ error: 'uid' }, 400);
      if (uid === me.localId) return json({ error: 'self', message: 'لا يمكن حذف أو تعطيل حساب المدير.' }, 400);

      if (body.action === 'delete') {
        await admin('accounts:delete', { localId: uid });
        return json({ ok: true });
      }
      if (body.action === 'disable') {
        await admin('accounts:update', { localId: uid, disableUser: !!body.disabled });
        return json({ ok: true });
      }
      return json({ error: 'action' }, 400);
    } catch (e) {
      return json({ error: 'failed', message: String(e.message || e) }, 502);
    }
  },
};

async function post(url, data, token) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return j;
}
async function get(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return j;
}

/* رمز دخول Google من حساب الخدمة (JWT موقّع بـ RS256) — يُحفظ مؤقتاً داخل الخادم */
let cached = { token: '', exp: 0 };
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.exp - 60 > now) return cached.token;
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${b64url(sig)}`,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(j.error_description || 'تعذر الحصول على صلاحية Google — تحقق من ملف SERVICE_ACCOUNT');
  cached = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return cached.token;
}
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
