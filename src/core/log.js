// יומן פעילות משותף. טבעת של 400 שורות שנשמרת ב-sessionStorage אחרי כל שורה — כך היומן
// שורד טעינות-דף (ניווט מלא) ומציג את כל הריצה, לא רק את הטעינה האחרונה (W7, בדיקה רטובה
// 10.9.2026). maskId חוסם דליפת ת.ז. ליומן: היומן ממוסך תמיד; הטבלה והדוח מציגים מזהה מלא.
// אין גישה ל-document/window ברמת המודול — רק בתוך גופי הפונקציות (import תקין ב-Node).

import { copyTextToClipboard } from './csv.js';

const LOG_MAX_LINES = 400;
const LOG_KEY = 'talmud.log';
const logLines = [];
let logListener = null;
let restored = false;

// ת.ז. אמיתית לעולם לא נכתבת ליומן מלאה. מתחת ל-5 תווים אין מה למסך — מוחזר כמות שהוא.
export function maskId(id) {
  const s = String(id == null ? '' : id);
  if (s.length < 5) return s;
  return '*'.repeat(s.length - 3) + s.slice(-3);
}

// לטקסט חופשי שעלול להכיל ת.ז. — ממסך כל רצף של 5+ ספרות.
export function maskIdsInText(text) {
  return String(text == null ? '' : text).replace(/\d{5,}/g, (m) => maskId(m));
}

function persist() {
  try { sessionStorage.setItem(LOG_KEY, JSON.stringify(logLines)); } catch (e) { /* אצווה לא נתקעת */ }
}

// טוען את היומן של הטעינות הקודמות (נקרא פעם אחת באתחול הפאנל). מחזיר כמה שורות נטענו.
export function restoreLog() {
  if (restored) return 0;
  restored = true;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(LOG_KEY) || 'null');
    if (Array.isArray(parsed)) {
      logLines.unshift(...parsed.filter((l) => typeof l === 'string').slice(-LOG_MAX_LINES));
      while (logLines.length > LOG_MAX_LINES) logLines.shift();
      if (logListener) { try { logListener(''); } catch (e) { /* noop */ } }
      return parsed.length;
    }
  } catch (e) { /* יומן פגום — מתחילים נקי */ }
  return 0;
}

export function log(msg) {
  if (!restored) restoreLog(); // הטעינה הראשונה קודמת לכתיבה הראשונה — אחרת היומן הקודם נדרס
  const stamp = new Date().toTimeString().slice(0, 8);
  const line = `${stamp} ${msg}`;
  logLines.push(line);
  while (logLines.length > LOG_MAX_LINES) logLines.shift();
  if (typeof document !== 'undefined' && typeof console !== 'undefined') console.log('[תלמוד]', msg);
  persist();
  if (logListener) { try { logListener(line); } catch (e) { /* אצווה לא נתקעת */ } }
  return line;
}

export function getLogText() {
  return logLines.join('\n');
}

export function clearLog() {
  restored = true; // ניקוי מפורש — אין מה לשחזר
  logLines.length = 0;
  persist();
  if (logListener) { try { logListener(''); } catch (e) { /* אצווה לא נתקעת */ } }
}

// מאזין יחיד (הפאנל). null מנתק.
export function setLogListener(fn) {
  logListener = typeof fn === 'function' ? fn : null;
}

export function copyLog() {
  return copyTextToClipboard(getLogText());
}
