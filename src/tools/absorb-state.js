// קליטה: מצב הריצה: התור (sessionStorage, שורד טעינת-דף), דגל עצירה, "דורות" של ניסיונות,
// ומונה נחיתות לכל תלמיד (רשת-ביטחון נגד לולאת ניווט). אין DOM כאן.

import { sleep } from '../core/dom.js';
import { log } from '../core/log.js';

const QUEUE_KEY = 'talmud.absorb.queue';
const STOP_KEY = 'talmud.absorb.stop';
const LANDINGS_KEY = 'talmud.absorb.landings';
const LAST_RESULTS_KEY = 'talmud.absorb.lastResults';
const STOP_PREFIX = '__STOPPED__@';
const CANCEL_PREFIX = '__CANCELLED__@';

// מסלול לגיטימי ארוך ביותר לתלמיד אחד: קפיצה לדף-מוסד ידוע → עץ לסניף → גריד לסוג-לימוד →
// דף תלמיד-חדש → חזרה לסוג-הלימוד = 5 טעינות. מעל 8 = לולאה.
export const ABSORB_MAX_LANDINGS = 8;

// המצב החי של הריצה (מודול אחד, אובייקט אחד: הזרימה והפאנל קוראים ממנו).
export const S = {
  queue: [],
  results: [],
  curIdx: 0,
  running: false,
  startedAt: null,
  hooks: {},
  lastRecordedIdx: -1, // השורה האחרונה שנרשמה לה תוצאה (מונע רישום כפול)
  justSaved: null, // מזהה של תלמיד-חדש שנשמר זה עתה (לאימות אחרי הטעינה)
  // ממצא 4: {idx, identity} של שמירה בדף תלמיד-חדש. נשמר עם המצב בכל שמירה (לא רק ברגע השמירה),
  // כדי ש-justSaved ישרוד גם נחיתה שנייה; נמחק ברישום התוצאה של אותה שורה.
  pendingSave: null,
  // ממצא ב-9: {idx, identity} של "אישור" במודאל שנלחץ. אם "אישור" הוא טעינה מלאה של אותו דף, ההמשך
  // מוצא את התלמיד ברשימה ומדווח "נקלט" (לא "כבר קיים"). נשמר עם המצב; נמחק ברישום התוצאה.
  pendingConfirm: null,
  // סבב רטוב 31.10.2026: בעל-המערכת סימן בפאנל "אשר המשך": על אזהרת "תלמיד זה רשום כבר במוסד אחר"
  // לוחצים "המשך" (מעבר בין מוסדות). נקבע בהתחלת הריצה ונשמר עם המצב (הריצה שורדת טעינות-דף).
  continueOtherInstitute: false,
  generation: 0,
};

// ─── עצירה ──────────────────────────────────────────────────────────────────

export function absorbIsStopped() {
  try { return sessionStorage.getItem(STOP_KEY) === '1'; } catch (e) { return false; }
}
export function requestAbsorbStop() {
  try { sessionStorage.setItem(STOP_KEY, '1'); } catch (e) { /* אצווה לא נתקעת */ }
  log('⛔ בקשת עצירה');
}
export function clearAbsorbStop() {
  try { sessionStorage.removeItem(STOP_KEY); } catch (e) { /* אצווה לא נתקעת */ }
}

export function absorbStopError(where) { return new Error(STOP_PREFIX + where); }
export function isAbsorbStopError(err) {
  return !!err && typeof err.message === 'string' && err.message.indexOf(STOP_PREFIX) === 0;
}
export function absorbCancelError(where) { return new Error(CANCEL_PREFIX + where); }
export function isAbsorbCancelError(err) {
  return !!err && typeof err.message === 'string' && err.message.indexOf(CANCEL_PREFIX) === 0;
}

// ─── דורות: ניסיון שהוחלף (timeout+retry) או שבוטל מת בגבול-השלב הבא ולא נוגע בדף ─
export function absorbNextGeneration() { S.generation++; return S.generation; }
export function absorbCurrentGeneration() { return S.generation; }
export function absorbIsCancelled(gen) { return typeof gen === 'number' && gen !== S.generation; }

export function checkStop(where, gen) {
  if (absorbIsCancelled(gen)) throw absorbCancelError(where);
  if (absorbIsStopped()) throw absorbStopError(where);
}

export async function sleepCheckStop(ms, gen) {
  let left = ms;
  while (left > 0) {
    checkStop('sleep', gen);
    const step = Math.min(100, left);
    await sleep(step);
    left -= step;
  }
  checkStop('sleep', gen);
}

// ─── התור ב-sessionStorage ──────────────────────────────────────────────────

export function saveAbsorbState(extra) {
  const state = {
    queue: S.queue, results: S.results, curIdx: S.curIdx,
    startedAt: S.startedAt || new Date().toISOString(),
    pendingSave: S.pendingSave || null,
    pendingConfirm: S.pendingConfirm || null,
    continueOtherInstitute: !!S.continueOtherInstitute,
  };
  if (extra) Object.assign(state, extra);
  try { sessionStorage.setItem(QUEUE_KEY, JSON.stringify(state)); } catch (e) { log('[מצב] שמירה נכשלה: ' + (e && e.message)); }
}

export function loadAbsorbState() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

export function clearAbsorbState() {
  try {
    sessionStorage.removeItem(QUEUE_KEY);
    sessionStorage.removeItem(LANDINGS_KEY);
  } catch (e) { /* אצווה לא נתקעת */ }
}

// ממצא 6: תמונת-התוצאות של הריצה האחרונה (sessionStorage, שורדת טעינת-דף): הלשונית מציגה אותה
// באתחול כשאין ריצה/תור, כך ש"עצור" בזמן טעינה לא מעלים את הטבלה והדוח.
export function saveAbsorbLastResults(results, report) {
  try {
    sessionStorage.setItem(LAST_RESULTS_KEY, JSON.stringify({ results: Array.isArray(results) ? results : [], report: report || null, at: new Date().toISOString() }));
  } catch (e) { /* אצווה לא נתקעת */ }
}

// "קליטה חדשה" (סבב 3): מוחקת את תמונת-התוצאות כדי שטעינת-דף לא תחזיר אותה
export function clearAbsorbLastResults() {
  try { sessionStorage.removeItem(LAST_RESULTS_KEY); } catch (e) { /* noop */ }
}

export function loadAbsorbLastResults() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(LAST_RESULTS_KEY) || 'null');
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.results) ? parsed : null;
  } catch (e) {
    return null;
  }
}

// מונה טעינות-דף (נחיתות) לתלמיד הנוכחי. מחזיר את המספר אחרי ההגדלה.
export function absorbBumpLandings(idx) {
  let rec = { idx: -1, count: 0 };
  try {
    const raw = sessionStorage.getItem(LANDINGS_KEY);
    if (raw) rec = JSON.parse(raw) || rec;
  } catch (e) { /* ברירת מחדל */ }
  rec = rec.idx === idx ? { idx, count: (rec.count || 0) + 1 } : { idx, count: 1 };
  try { sessionStorage.setItem(LANDINGS_KEY, JSON.stringify(rec)); } catch (e) { /* noop */ }
  return rec.count;
}

export function absorbResetLandings() {
  try { sessionStorage.removeItem(LANDINGS_KEY); } catch (e) { /* noop */ }
}

export function absorbResetRun() {
  S.queue = [];
  S.results = [];
  S.curIdx = 0;
  S.running = false;
  S.startedAt = null;
  S.lastRecordedIdx = -1;
  S.justSaved = null;
  S.pendingSave = null;
  S.pendingConfirm = null;
  S.continueOtherInstitute = false;
}
