/* ============================================================
   التقويم العائلي — النواة: التواريخ والتحويل والتكرار
   ============================================================ */
'use strict';

const $ = id => document.getElementById(id);
const AR_DAYS = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const HIJRI_MONTHS = ['محرم','صفر','ربيع الأول','ربيع الآخر','جمادى الأولى','جمادى الآخرة','رجب','شعبان','رمضان','شوال','ذو القعدة','ذو الحجة'];
const DAY_MS = 86400000;

function pad2(n){ return String(n).padStart(2,'0'); }
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function toEnglishDigits(v){
  return String(v || '').replace(/[٠-٩]/g, d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
}

/* ---------- الميلادي ---------- */
function dateOnly(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n){ return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function ymd(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function parseYmd(s){
  const [y,m,d] = String(s || '').split('-').map(Number);
  if(!y || !m || !d) return null;
  return new Date(y, m-1, d);
}
function diffDays(from, to){ return Math.round((dateOnly(to) - dateOnly(from)) / DAY_MS); }
function diffYMD(a, b){
  a = dateOnly(a); b = dateOnly(b);
  if(a > b) [a,b] = [b,a];
  let y = b.getFullYear()-a.getFullYear(), m = b.getMonth()-a.getMonth(), d = b.getDate()-a.getDate();
  if(d < 0){ m--; d += new Date(b.getFullYear(), b.getMonth(), 0).getDate(); }
  if(m < 0){ y--; m += 12; }
  return {y, m, d};
}
function arCount(n, one, two, few, many){
  if(n === 1) return one;
  if(n === 2) return two;
  if(n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}
function fmtYears(n){ return arCount(n,'سنة','سنتان','سنوات','سنة'); }
function fmtMonths(n){ return arCount(n,'شهر','شهران','أشهر','شهراً'); }
function fmtDays(n){ return arCount(n,'يوم','يومان','أيام','يوماً'); }
function fmtWeeks(n){ return arCount(n,'أسبوع','أسبوعان','أسابيع','أسبوعاً'); }
function fmtYMD(o){
  const p = [];
  if(o.y) p.push(fmtYears(o.y));
  if(o.m) p.push(fmtMonths(o.m));
  if(o.d || !p.length) p.push(fmtDays(o.d));
  return p.join(' و');
}
function fmtGreg(d, withDay=false){
  return `${withDay ? AR_DAYS[d.getDay()] + ' ' : ''}${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/* ---------- الهجري (أم القرى) ---------- */
const _hijriFmt = (()=>{
  try{
    return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura',{year:'numeric',month:'numeric',day:'numeric',timeZone:'Asia/Riyadh'});
  }catch(e){ return null; }
})();
const _g2h = new Map();
function gregToHijri(date){
  if(!_hijriFmt || !(date instanceof Date) || isNaN(date)) return null;
  // منتصف النهار لتفادي أي انزياح في المنطقة الزمنية
  const key = ymd(date);
  if(_g2h.has(key)) return _g2h.get(key);
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const parts = _hijriFmt.formatToParts(noon);
  const get = t => parseInt(parts.find(p=>p.type===t)?.value, 10);
  const h = {year:get('year'), month:get('month'), day:get('day')};
  _g2h.set(key, h);
  return h;
}
function hijriCompare(a, b){ return (a.year-b.year) || (a.month-b.month) || (a.day-b.day); }
const _h2g = new Map();
/* يعيد التاريخ الميلادي المطابق تماماً، أو null إن لم يوجد اليوم (مثل 30 في شهر من 29 يوماً) */
function hijriToGreg(hy, hm, hd){
  const key = `${hy}-${hm}-${hd}`;
  if(_h2g.has(key)) return _h2g.get(key);
  const target = {year:hy, month:hm, day:hd};
  // تخمين أولي: 1 محرم 1هـ = 19 يوليو 622م تقريباً، والشهر القمري 29.530589 يوماً
  const est = ((hy-1)*12 + (hm-1)) * 29.530589 + (hd-1);
  const g0 = new Date(Date.UTC(622,6,19) + est*DAY_MS);
  let d = new Date(g0.getUTCFullYear(), g0.getUTCMonth(), g0.getUTCDate());
  const seen = new Set();
  let result = null;
  for(let i=0; i<60; i++){
    const h = gregToHijri(d);
    if(!h) break;
    const c = hijriCompare(h, target);
    if(c === 0){ result = d; break; }
    const key2 = d.getTime();
    if(seen.has(key2)) break;          // تذبذب = اليوم غير موجود (مثل 30 في شهر ناقص)
    seen.add(key2);
    const delta = ((target.year-h.year)*12 + (target.month-h.month))*29.53 + (target.day-h.day);
    let step = Math.round(delta);
    if(step === 0) step = c < 0 ? 1 : -1;
    d = addDays(d, step);
  }
  _h2g.set(key, result);
  return result;
}
function hijriMonthLength(hy, hm){
  return hijriToGreg(hy, hm, 30) ? 30 : 29;
}
/* تحويل مع ضبط اليوم لآخر الشهر إن لزم (30 → 29) */
function hijriToGregClamped(hy, hm, hd){
  return hijriToGreg(hy, hm, Math.min(hd, hijriMonthLength(hy, hm)));
}
function fmtHijri(h, short=false){
  if(!h) return '';
  return `${h.day} ${HIJRI_MONTHS[h.month-1]} ${h.year}${short ? '' : 'هـ'}`;
}

/* ---------- الموعد: التاريخ والتكرار ---------- */
function eventBaseDate(ev){ return parseYmd(ev?.date); }

/* تاريخ وقوع الموعد في سنة معينة (للتكرار السنوي) */
function occurrenceInGregYear(base, gy){
  const m = base.getMonth(), d = base.getDate();
  const last = new Date(gy, m+1, 0).getDate();
  return new Date(gy, m, Math.min(d, last));
}
function occurrenceInHijriYear(baseH, hy){
  return hijriToGregClamped(hy, baseH.month, baseH.day);
}

/* أقرب وقوع للموعد من تاريخ معين (اليوم أو بعده) */
function nextOccurrence(ev, from=new Date()){
  const base = eventBaseDate(ev);
  if(!base) return null;
  const today = dateOnly(from);
  if(ev.repeat !== 'yearly' || base >= today) return base;
  if(ev.calType === 'hijri'){
    const bh = gregToHijri(base), th = gregToHijri(today);
    if(!bh || !th) return base;
    for(let hy = th.year; hy <= th.year + 1; hy++){
      const g = occurrenceInHijriYear(bh, hy);
      if(g && g >= today) return g;
    }
    return base;
  }
  for(let gy = today.getFullYear(); gy <= today.getFullYear() + 1; gy++){
    const g = occurrenceInGregYear(base, gy);
    if(g >= today) return g;
  }
  return base;
}
/* كل مرات وقوع الموعد بين تاريخين (للعرض الشهري) */
function occurrencesBetween(ev, start, end){
  const base = eventBaseDate(ev);
  if(!base) return [];
  if(ev.repeat !== 'yearly') return (base >= start && base <= end) ? [base] : [];
  const out = [];
  if(ev.calType === 'hijri'){
    const bh = gregToHijri(base), sh = gregToHijri(start), eh = gregToHijri(end);
    if(!bh || !sh || !eh) return out;
    for(let hy = sh.year; hy <= eh.year; hy++){
      if(hy < bh.year) continue;
      const g = occurrenceInHijriYear(bh, hy);
      if(g && g >= start && g <= end && g >= base) out.push(g);
    }
  }else{
    for(let gy = start.getFullYear(); gy <= end.getFullYear(); gy++){
      if(gy < base.getFullYear()) continue;
      const g = occurrenceInGregYear(base, gy);
      if(g >= start && g <= end) out.push(g);
    }
  }
  return out;
}
/* رقم الذكرى (كم سنة مرت على الأصل عند الوقوع) */
function anniversaryNumber(ev, occ){
  const base = eventBaseDate(ev);
  if(!base || ev.repeat !== 'yearly') return 0;
  if(ev.calType === 'hijri'){
    const a = gregToHijri(base), b = gregToHijri(occ);
    return a && b ? b.year - a.year : 0;
  }
  return occ.getFullYear() - base.getFullYear();
}

/* ---------- الوقت ---------- */
function fmtTime(t){
  if(!t || !/^\d{2}:\d{2}$/.test(t)) return '';
  let [h, m] = t.split(':').map(Number);
  const suffix = h < 12 ? 'ص' : 'م';
  h = h % 12 || 12;
  return `${h}:${pad2(m)} ${suffix}`;
}

/* ---------- نص العدّ ---------- */
function relativeLabel(days){
  if(days === 0) return 'اليوم';
  if(days === 1) return 'غداً';
  if(days === -1) return 'أمس';
  const n = Math.abs(days);
  let txt;
  if(n < 14) txt = fmtDays(n);
  else if(n < 60) txt = fmtWeeks(Math.round(n/7));
  else if(n < 730) txt = fmtMonths(Math.round(n/30.44));
  else txt = fmtYears(Math.round(n/365.25));
  return days > 0 ? `بعد ${txt}` : `قبل ${txt}`;
}

/* ---------- طور القمر لليوم الهجري (0 محاق → 0.5 بدر → 1) ---------- */
function moonPhaseFraction(hijriDay){
  // انحياز بسيط حتى يبقى الهلال مرئياً في أول الشهر وآخره
  const f = Math.min(Math.max((hijriDay - 0.5) / 29.53, 0), 1);
  return 0.06 + f * 0.88;
}
function moonSvg(hijriDay, size=56){
  const f = moonPhaseFraction(hijriDay);
  const r = 24, cx = 28, cy = 28;
  // الجزء المضيء: نصف دائرة + قوس إهليلجي
  const waxing = f <= 0.5;
  const k = Math.cos(f * 2 * Math.PI); // 1 محاق، -1 بدر
  const rx = Math.abs(k) * r;
  const lit = waxing ? 1 : 0;
  // في نصف الكرة الشمالي: الهلال المتزايد مضيء من اليمين
  const sweepOuter = waxing ? 1 : 0;
  const sweepInner = (k > 0) === waxing ? 0 : 1;
  const path = `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${sweepOuter} ${cx} ${cy + r} A ${rx} ${r} 0 0 ${sweepInner} ${cx} ${cy - r} Z`;
  void lit;
  return `<svg viewBox="0 0 56 56" width="${size}" height="${size}" aria-hidden="true" class="moon">
    <circle cx="${cx}" cy="${cy}" r="${r}" class="moon-dark"/>
    <path d="${path}" class="moon-lit"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" class="moon-ring" fill="none"/>
  </svg>`;
}
