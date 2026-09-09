// יומן פעילות משותף — פורט מ"תלמוד - קליטת תלמידים" v3.2 (log:674, copyLog:735).
// טבעת של 500 שורות בזיכרון + מאזין אחד לרינדור בפאנל. maskId חוסם דליפת ת.ז. ללוג
// (global-constraints, "פרטיות"): הלוג ממוסך תמיד — טבלת התוצאות והדוח מציגים מזהה מלא.
// אין גישה ל-document/window ברמת המודול — רק בתוך גופי הפונקציות (import תקין ב-Node).

import { copyTextToClipboard } from './csv.js';

const LOG_MAX_LINES = 500;
const logLines = [];
let logListener = null;

// ת.ז. אמיתית לעולם לא נכתבת ללוג מלאה. מתחת ל-5 תווים אין מה למסך (אין די אנטרופיה
// כדי שהמיסוך יועיל, ומחיקה מלאה רק מקשה על אבחון) — מוחזר כמות שהוא.
export function maskId(id) {
  const s = String(id == null ? '' : id);
  if (s.length < 5) return s;
  return '*'.repeat(s.length - 3) + s.slice(-3);
}

// לטקסט חופשי (הודעות מערכת/ולידציה) שעלול להכיל ת.ז. — ממסך כל רצף של 5+ ספרות.
export function maskIdsInText(text) {
  return String(text == null ? '' : text).replace(/\d{5,}/g, (m) => maskId(m));
}

export function log(msg) {
  const stamp = new Date().toTimeString().slice(0, 8);
  const line = `${stamp} ${msg}`;
  logLines.push(line);
  while (logLines.length > LOG_MAX_LINES) logLines.shift();
  // console רק בדפדפן — כדי ש-node --test יישאר נקי.
  if (typeof document !== 'undefined' && typeof console !== 'undefined') {
    console.log('[TM-Absorb]', msg);
  }
  if (logListener) { try { logListener(line); } catch (e) { /* אצווה לא נתקעת */ } }
  return line;
}

export function getLogText() {
  return logLines.join('\n');
}

export function clearLog() {
  logLines.length = 0;
  if (logListener) { try { logListener(''); } catch (e) { /* אצווה לא נתקעת */ } }
}

// מאזין יחיד (הפאנל). null מנתק.
export function setLogListener(fn) {
  logListener = typeof fn === 'function' ? fn : null;
}

export function copyLog() {
  return copyTextToClipboard(getLogText());
}
