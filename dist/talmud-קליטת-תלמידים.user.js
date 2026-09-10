// ==UserScript==
// @name         תלמוד - קליטת תלמידים
// @namespace    https://github.com/mdj441/talmud-scripts
// @version      3.3.0
// @match        https://talmud.edu.gov.il/*
// @grant        none
// @author       מרדכי יאקאב
// ==/UserScript==

(function () {
  'use strict';

// עוזרי DOM כלליים — פורט מ"תלמוד - עזיבת תלמידים" v5 (‏$el:44, sleep:45, waitFor:135, isVisible:279).
// חשוב: אין גישה ל-document/window ברמת המודול — רק בתוך גופי הפונקציות, כדי שהמודול
// יהיה ניתן ל-import ב-Node (בדיקות) בלי סביבת דפדפן.

function $el(id) {
  return document.getElementById(id);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// getClientRects().length, לא offsetParent: ה-ModalPopupExtender מציג את החלונית עם
// position:fixed, ועבורה offsetParent הוא תמיד null גם כשהיא גלויה לגמרי.
// getClientRects() מחזיר תיבות לאלמנטים מעובדים (כולל fixed) וכלום ל-display:none —
// בדיוק האות שאנחנו רוצים.
function isVisible(el) {
  if (!el) return false;
  if (el.getClientRects().length === 0) return false;
  const s = window.getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
}

// בודק predicate בפולינג ומתממש (resolve) עם הערך האמת ברגע שהוא מתקבל.
// בניגוד ל-depart-v5 (שם waitFor פותר true/false ולעולם לא נדחה), כאן timeout נדחה
// (reject) עם Error בשם - הכרעת הבקר למודול הזה, כדי שהקורא יבחין במפורש בין "המתנה
// הצליחה" ל"פג הזמן" דרך catch/then ולא ילך לפרש false כערך legitmate של predicate.
function waitFor(predicate, { timeout = 5000, interval = 30 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function check() {
      let ok;
      try { ok = predicate(); } catch (e) { ok = false; }
      if (ok) return resolve(ok);
      if (Date.now() - t0 >= timeout) {
        return reject(new Error(`waitFor: timeout after ${timeout}ms`));
      }
      setTimeout(check, interval);
    })();
  });
}

// המתנה ל-postback א-סינכרוני של MS AJAX ScriptManager — פורט מ"תלמוד - עזיבת תלמידים"
// v5 (‏getPRM:83, waitPRM:87). מבוסס-event (add_beginRequest/add_endRequest), לא פולינג.
// אין גישה ל-Sys/window ברמת המודול — רק בתוך גופי הפונקציות (import תקין גם ב-Node).

function getPRM() {
  try {
    return Sys.WebForms.PageRequestManager.getInstance();
  } catch (e) {
    return null;
  }
}

// שינוי סמנטי מכוון מול depart-v5 (שם waitPRM נדחה/reject בשגיאת postback): כאן
// לעולם לא נזרק/נדחה — "אצווה לא נתקעת" (global-constraints). תמיד resolve עם
// {ok:true} או {ok:false, reason}, כדי שהקורא ידווח ויימשך לפריט הבא בלי try/catch חוסם.
// ‏`started` (תוספת) = האם נצפה beginRequest בפועל. {ok:true, started:false} פירושו
// "הפעולה לא הפעילה שום בקשה לשרת" — לחיצה שנבלעה, ולא ניווט/עדכון שהצליח. בלעדיו
// אי-אפשר להבחין בין השניים, וזה מקור באגים C1/C4 (ניווט מדומה, חיפוש שלא רץ).
function waitPRM({ startTimeoutMs = 2500, totalTimeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const prm = getPRM();
    if (!prm) { setTimeout(() => resolve({ ok: true, started: false }), 200); return; }

    let started = false, done = false;

    function onBegin() { started = true; clearTimeout(startTimer); }

    function onEnd(s, e) {
      const err = e && e.get_error && e.get_error();
      if (err && e.set_errorHandled) e.set_errorHandled(true);
      finish(err ? { ok: false, reason: 'PRM: ' + (err.message || 'postback error') } : { ok: true });
    }

    function finish(result) {
      if (done) return;
      done = true;
      prm.remove_beginRequest(onBegin);
      prm.remove_endRequest(onEnd);
      clearTimeout(startTimer);
      clearTimeout(totalTimer);
      resolve(Object.assign({ started }, result));
    }

    prm.add_beginRequest(onBegin);
    prm.add_endRequest(onEnd);

    const startTimer = setTimeout(() => {
      if (!started && !prm._isInAsyncPostBack) {
        finish({ ok: true }); // הפעולה שנורתה לא הפעילה postback — ממשיכים
      }
    }, startTimeoutMs);

    const totalTimer = setTimeout(() => {
      // מפסיקים להמתין לתלמיד הזה בלי לזרוק, כדי לא לסכן postback שני מעל אחד שעדיין בטיסה.
      finish({ ok: false, reason: `PRM timeout after ${totalTimeoutMs}ms` });
    }, totalTimeoutMs);
  });
}

// יורה postback עם סדר קשיח (global-constraints, "postback מקוד strict"): רושמים
// את ההמתנה (וה-add_endRequest שבתוכה) *לפני* ש-__doPostBack נקרא, והקריאה עצמה
// נדחית ל-setTimeout(fn, 0) כדי שה-handlers כבר יהיו רשומים כש-PRM מתחיל postback.
function firePostback(target, arg = '', opts) {
  const wait = waitPRM(opts); // (1) registers wait — add_endRequest is wired synchronously inside
  setTimeout(() => { window.__doPostBack(target, arg); }, 0); // (2) deferred, after registration
  return wait;
}

// חלונית ההודעה המשותפת של האתר (ucMessagePopUp) — פורט מ"תלמוד - עזיבת תלמידים" v5
// (‏getMessagePopup:290, hideMessagePopup:303). אותה בקרה משמשת בכל האתר (למשל ולידציה
// "תאריך העזיבה לא יכול להיות לפני תאריך הקליטה..."). לעולם לא לוחצים על "המשך" (btnMOK)
// בשקט — הפעולה היחידה המותרת ל-hide היא ה-ModalPopupExtender.hide()/btnMCancel ("אישור").
// אין גישה ל-document/window ברמת המודול — רק בתוך גופי הפונקציות.


// שמות ה-ID נשמרים כפי שהם ב-depart-v5: btnMOK = "המשך" (אישור-רך), btnMCancel = "אישור"
// (אישור/סגירת שגיאה — למרות השם), btnMNo = "לא".
function readMessagePopup() {
  const panel = $el('ucMessagePopUp_pnlMessagePopup');
  if (!isVisible(panel)) return null;
  const hasContinue = isVisible($el('ucMessagePopUp_btnMOK'));
  const hasOk = isVisible($el('ucMessagePopUp_btnMCancel'));
  const hasNo = isVisible($el('ucMessagePopUp_btnMNo'));
  if (!hasContinue && !hasOk && !hasNo) return null; // פאנל מעובד אך בלי כפתור חי → לא פרומפט אמיתי
  let text = (panel.innerText || panel.textContent || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^\s*הודעה\s*/, '').replace(/\s*(המשך|לא|אישור|ביטול|סגור)\s*$/g, '').trim();
  return { text, hasContinue, hasOkOnly: hasOk && !hasContinue };
}

// סוגר את חלונית ההודעה. מעדיף את ה-ModalPopupExtender (hide() נקי, לא מפעיל שום
// postback צד-שרת). נופל ל-btnMCancel ("אישור") רק אם ה-extender לא זמין. לעולם לא
// לוחץ על btnMOK ("המשך") — זה כפתור אישור-רך ולא כפתור סגירה.
// M-f: ‏btnMCancel הוא postback צד-שרת, ולכן הוא חייב את הסדר הקשיח של
// global-constraints: רושמים waitPRM *לפני* הלחיצה, והלחיצה נדחית ל-setTimeout(0).
// מחזיר {hidden, wait} — `wait` הוא ה-Promise של ה-postback (null כשנסגר ב-extender,
// שאינו postback). ‏waitPRM לעולם לא נדחה.
function hideMessagePopupAsync() {
  try {
    if (typeof window.$find === 'function') {
      const mpe = window.$find('ucMessagePopUp_ModalPopupExtender1');
      if (mpe && typeof mpe.hide === 'function') { mpe.hide(); return { hidden: true, wait: null }; }
    }
  } catch (e) { /* ignore, fall through to button click */ }
  const ok = $el('ucMessagePopUp_btnMCancel');
  if (isVisible(ok)) {
    const wait = waitPRM({ startTimeoutMs: 1500, totalTimeoutMs: 15000 }); // (1) נרשם קודם
    setTimeout(() => { try { ok.click(); } catch (e) { /* אצווה לא נתקעת */ } }, 0); // (2) נדחה
    return { hidden: true, wait };
  }
  return { hidden: false, wait: null };
}

// תאימות: אותה התנהגות, בלי ה-Promise (מי שלא ממתין לתוצאה).
function hideMessagePopup() {
  return hideMessagePopupAsync().hidden;
}

// גרסה גנרית ל-extender כלשהו (ModalPopupExtender / AjaxModalPopup): $find(id).hide(),
// null-safe — מחזיר false אם $find לא זמין או שלא נמצא extender בשם הזה.
function closeModal(extenderId) {
  try {
    if (typeof window.$find !== 'function') return false;
    const ext = window.$find(extenderId);
    if (!ext || typeof ext.hide !== 'function') return false;
    ext.hide();
    return true;
  } catch (e) {
    return false;
  }
}

// יומן פעילות משותף — פורט מ"תלמוד - קליטת תלמידים" v3.2 (log:674, copyLog:735).
// טבעת של 500 שורות בזיכרון + מאזין אחד לרינדור בפאנל. maskId חוסם דליפת ת.ז. ללוג
// (global-constraints, "פרטיות"): הלוג ממוסך תמיד — טבלת התוצאות והדוח מציגים מזהה מלא.
// אין גישה ל-document/window ברמת המודול — רק בתוך גופי הפונקציות (import תקין ב-Node).


const LOG_MAX_LINES = 500;
const logLines = [];
let logListener = null;

// ת.ז. אמיתית לעולם לא נכתבת ללוג מלאה. מתחת ל-5 תווים אין מה למסך (אין די אנטרופיה
// כדי שהמיסוך יועיל, ומחיקה מלאה רק מקשה על אבחון) — מוחזר כמות שהוא.
function maskId(id) {
  const s = String(id == null ? '' : id);
  if (s.length < 5) return s;
  return '*'.repeat(s.length - 3) + s.slice(-3);
}

// לטקסט חופשי (הודעות מערכת/ולידציה) שעלול להכיל ת.ז. — ממסך כל רצף של 5+ ספרות.
function maskIdsInText(text) {
  return String(text == null ? '' : text).replace(/\d{5,}/g, (m) => maskId(m));
}

function log(msg) {
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

function getLogText() {
  return logLines.join('\n');
}

function clearLog() {
  logLines.length = 0;
  if (logListener) { try { logListener(''); } catch (e) { /* אצווה לא נתקעת */ } }
}

// מאזין יחיד (הפאנל). null מנתק.
function setLogListener(fn) {
  logListener = typeof fn === 'function' ? fn : null;
}

function copyLog() {
  return copyTextToClipboard(getLogText());
}

// ייצוא/העתקה — פורט מ"תלמוד - קליטת תלמידים" v3.2 (exportCSV:713, copyLog:735).
// toCsv טהורה (נבדקת ביחידה); downloadText/copyTextToClipboard נוגעות ב-DOM ולכן
// כל הגישה ל-document/window/navigator היא רק בתוך גופי הפונקציות (import תקין ב-Node).

// BOM כדי שאקסל יקרא עברית ב-UTF-8 (בלעדיו "×¢×‘×¨×™×ª").
const CSV_BOM = '﻿';
const CSV_EOL = '\r\n';

// טהורה: מערך-שורות של תאים → טקסט CSV. מצטט רק תאים שדורשים זאת (פסיק / מרכאות /
// שורה חדשה), ומכפיל מרכאות פנימיות — RFC 4180.
function toCsv(rows) {
  if (!Array.isArray(rows)) return '';
  return rows.map((row) => (Array.isArray(row) ? row : [row]).map(csvCell).join(',')).join(CSV_EOL);
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// מוריד טקסט כקובץ (Blob + <a download>). לעולם לא זורק — מחזיר false בכישלון.
function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } }, 1000);
    return true;
  } catch (e) {
    return false;
  }
}

// CSV לאקסל: BOM + ציטוט תקני.
function downloadCsv(filename, rows) {
  return downloadText(filename, CSV_BOM + toCsv(rows), 'text/csv;charset=utf-8');
}

// Promise<boolean> — לעולם לא נדחה. clipboard API ואם הוא חסום — textarea+execCommand.
function copyTextToClipboard(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => csvCopyFallback(text));
    }
  } catch (e) { /* נופלים ל-fallback */ }
  return Promise.resolve(csvCopyFallback(text));
}

function csvCopyFallback(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) {
    return false;
  }
}

// נלכד מ-ddlCountryOfOrigine של האתר החי, 2026-09-09.
const COUNTRIES = [
  { value: '710', he: 'ארצות הברית' },
  { value: '620', he: 'בלגיה' },
  { value: '590', he: 'הממלכה המאוחדת' },
  { value: '640', he: 'צרפת' },
  { value: '700', he: 'קנדה' },
  { value: '317', he: 'אבחזיסטאן' },
  { value: '254', he: 'אוגנדה' },
  { value: '315', he: 'אוזבקיסטן' },
  { value: '510', he: 'אוסטריה' },
  { value: '860', he: 'אוסטרליה' },
  { value: '305', he: 'אוקראינה' },
  { value: '820', he: 'אורגוואי' },
  { value: '741', he: 'אזור תעלת פנמה' },
  { value: '311', he: 'אזרביג\'אן' },
  { value: '670', he: 'איטליה' },
  { value: '885', he: 'איי גילברט ואליס' },
  { value: '738', he: 'איי הבתולה' },
  { value: '884', he: 'איי ווליס ופוטונה' },
  { value: '739', he: 'איי טורקס וקייקוס' },
  { value: '864', he: 'איי נורפולק' },
  { value: '289', he: 'איי סיישל' },
  { value: '832', he: 'איי פאלקלנד' },
  { value: '888', he: 'איי פיגי' },
  { value: '278', he: 'איי קומורו' },
  { value: '887', he: 'איי קוק' },
  { value: '733', he: 'איי קיימן' },
  { value: '219', he: 'איי קייפ וורדה' },
  { value: '861', he: 'איי שלמה הבריטיים' },
  { value: '130', he: 'אינדונזיה' },
  { value: '581', he: 'איסלנד' },
  { value: '691', he: 'אירופה לא ידוע' },
  { value: '600', he: 'אירלנד' },
  { value: '90', he: 'אירן' },
  { value: '724', he: 'אל סלבדור' },
  { value: '440', he: 'אלבניה' },
  { value: '210', he: 'אלגיריה' },
  { value: '852', he: 'אמריקה לא ידוע' },
  { value: '281', he: 'אנגולה' },
  { value: '662', he: 'אנדורה' },
  { value: '758', he: 'אנטיגואה וברבודה' },
  { value: '303', he: 'אסטוניה' },
  { value: '190', he: 'אסיה לא ידוע' },
  { value: '100', he: 'אפגניסטן' },
  { value: '290', he: 'אפריקה לא ידוע' },
  { value: '780', he: 'אקואדור' },
  { value: '830', he: 'ארגנטינה' },
  { value: '249', he: 'אריתראה' },
  { value: '9', he: 'ארמניה' },
  { value: '250', he: 'אתיופיה' },
  { value: '905', he: 'בדרך לארץ' },
  { value: '735', he: 'בהמס' },
  { value: '115', he: 'בוטן' },
  { value: '271', he: 'בוטסואנה' },
  { value: '420', he: 'בולגריה' },
  { value: '800', he: 'בוליביה' },
  { value: '413', he: 'בוסניה הרצגובינה' },
  { value: '285', he: 'בורונדי' },
  { value: '217', he: 'בורקינה פאסו' },
  { value: '61', he: 'בחריין' },
  { value: '304', he: 'בילורוסיה' },
  { value: '906', he: 'בלב ים' },
  { value: '269', he: 'בליז' },
  { value: '116', he: 'בנגלדש' },
  { value: '214', he: 'בנין )דהומי(' },
  { value: '732', he: 'ברבדוס' },
  { value: '134', he: 'ברוניי' },
  { value: '810', he: 'ברזיל' },
  { value: '300', he: 'ברית המועצות' },
  { value: '731', he: 'ברמודה' },
  { value: '216', he: 'גאנה' },
  { value: '287', he: 'גבון' },
  { value: '757', he: 'גואדאלופ' },
  { value: '135', he: 'גואם' },
  { value: '726', he: 'גווטאמלה' },
  { value: '812', he: 'גויאנה' },
  { value: '811', he: 'גויאנה הצרפתית' },
  { value: '251', he: 'גיבוטי' },
  { value: '661', he: 'גיברלטר' },
  { value: '207', he: 'גינאה' },
  { value: '206', he: 'גינאה ביסאו' },
  { value: '865', he: 'גינאה החדשה' },
  { value: '288', he: 'גינאה המשוונית' },
  { value: '205', he: 'גמביה' },
  { value: '737', he: 'גמייקה' },
  { value: '308', he: 'גרוזיה' },
  { value: '500', he: 'גרמניה' },
  { value: '502', he: 'גרמניה המזרחית' },
  { value: '501', he: 'גרמניה המערבית' },
  { value: '753', he: 'גרנדה' },
  { value: '751', he: 'דומיניקה' },
  { value: '580', he: 'דנמרק' },
  { value: '850', he: 'דרום אמריקה' },
  { value: '270', he: 'דרום אפריקה' },
  { value: '736', he: 'האיטי' },
  { value: '863', he: 'האיים ההברדיים' },
  { value: '762', he: 'האנטילים ההולנדים' },
  { value: '110', he: 'הודו' },
  { value: '610', he: 'הולנד' },
  { value: '141', he: 'הונג קונג' },
  { value: '540', he: 'הונגריה' },
  { value: '725', he: 'הונדורס' },
  { value: '734', he: 'הרפ הדומיניקנית' },
  { value: '125', he: 'ויטנאם' },
  { value: '126', he: 'ויטנאם הדרומית' },
  { value: '760', he: 'ונצואלה' },
  { value: '672', he: 'ותיקן' },
  { value: '283', he: 'זאיר' },
  { value: '259', he: 'זימבאבווה' },
  { value: '261', he: 'זמביה' },
  { value: '218', he: 'חוף השנהב' },
  { value: '314', he: 'טג\'יקיסטאן' },
  { value: '215', he: 'טוגו' },
  { value: '881', he: 'טונגה' },
  { value: '133', he: 'טיוואן' },
  { value: '132', he: 'טימור הפורטוגלית' },
  { value: '201', he: 'טנגר' },
  { value: '255', he: 'טנזניה' },
  { value: '761', he: 'טרינידד וטובגו' },
  { value: '910', he: 'יהודה ושומרון' },
  { value: '410', he: 'יוגוסלביה' },
  { value: '430', he: 'יוון' },
  { value: '160', he: 'יפן' },
  { value: '40', he: 'ירדן' },
  { value: '51', he: 'כווית' },
  { value: '64', he: 'כמר א ע מ' },
  { value: '990', he: 'לא ידוע' },
  { value: '901', he: 'לא מוגדר' },
  { value: '0', he: 'לא רשום' },
  { value: '8', he: 'לא רשום )בוטל(' },
  { value: '124', he: 'לאוס' },
  { value: '30', he: 'לבנון' },
  { value: '230', he: 'לוב' },
  { value: '630', he: 'לוכסמבורג' },
  { value: '302', he: 'לטביה' },
  { value: '209', he: 'ליבריה' },
  { value: '301', he: 'ליטא' },
  { value: '521', he: 'ליכטנשטיין' },
  { value: '272', he: 'לסוטו' },
  { value: '203', he: 'מאוריטניה' },
  { value: '276', he: 'מאוריציוס' },
  { value: '212', he: 'מאלי' },
  { value: '275', he: 'מדגסקר' },
  { value: '262', he: 'מוזמביק' },
  { value: '307', he: 'מולדובה' },
  { value: '150', he: 'מונגוליה' },
  { value: '752', he: 'מונסרת' },
  { value: '641', he: 'מונקו' },
  { value: '120', he: 'מיאנמר )בורמה(' },
  { value: '263', he: 'מלאווי' },
  { value: '117', he: 'מלדיבים' },
  { value: '127', he: 'מלזיה' },
  { value: '673', he: 'מלטה' },
  { value: '240', he: 'מצרים' },
  { value: '142', he: 'מקאו' },
  { value: '414', he: 'מקדוניה' },
  { value: '720', he: 'מקסיקו' },
  { value: '200', he: 'מרוקו' },
  { value: '202', he: 'מרוקו הספרדית' },
  { value: '756', he: 'מרטיניק' },
  { value: '750', he: 'מרכז אמריקה' },
  { value: '886', he: 'נאורו' },
  { value: '570', he: 'נורבגיה' },
  { value: '211', he: 'ניגר' },
  { value: '213', he: 'ניגריה' },
  { value: '870', he: 'ניו זילנד' },
  { value: '721', he: 'ניקרגואה' },
  { value: '274', he: 'נמיביה' },
  { value: '114', he: 'נפאל' },
  { value: '245', he: 'סאו טומה ופרינציפה' },
  { value: '241', he: 'סודן' },
  { value: '273', he: 'סווזילנד' },
  { value: '252', he: 'סומליה' },
  { value: '20', he: 'סוריה' },
  { value: '813', he: 'סורינם' },
  { value: '277', he: 'סט הלנה' },
  { value: '754', he: 'סט וינסנט' },
  { value: '755', he: 'סט. לוציה' },
  { value: '208', he: 'סיירה ליאונה' },
  { value: '140', he: 'סין' },
  { value: '122', he: 'סינגפור' },
  { value: '113', he: 'סיקים' },
  { value: '411', he: 'סלובניה' },
  { value: '532', he: 'סלובקיה' },
  { value: '882', he: 'סמואה' },
  { value: '883', he: 'סמואה המערבית' },
  { value: '671', he: 'סן מרינו' },
  { value: '204', he: 'סנגל' },
  { value: '660', he: 'ספרד' },
  { value: '415', he: 'סרביה' },
  { value: '112', he: 'סרי לנקה )צילון(' },
  { value: '80', he: 'עדן' },
  { value: '62', he: 'עומן' },
  { value: '50', he: 'עירק' },
  { value: '60', he: 'ערב הסעודית' },
  { value: '866', he: 'פאפואה' },
  { value: '310', he: 'פולין' },
  { value: '889', he: 'פולינזיה הצרפתית' },
  { value: '711', he: 'פורטו ריקו' },
  { value: '650', he: 'פורטוגל' },
  { value: '131', he: 'פיליפינים' },
  { value: '550', he: 'פינלנד' },
  { value: '740', he: 'פנמה' },
  { value: '111', he: 'פקיסטן' },
  { value: '831', he: 'פרגוואי' },
  { value: '790', he: 'פרו' },
  { value: '242', he: 'צאד' },
  { value: '840', he: 'צ\'ילה' },
  { value: '530', he: 'צכוסלובקיה' },
  { value: '531', he: 'צכיה' },
  { value: '730', he: 'קובה' },
  { value: '770', he: 'קולומביה' },
  { value: '286', he: 'קונגו' },
  { value: '723', he: 'קוסטה ריקה' },
  { value: '151', he: 'קוריאה' },
  { value: '153', he: 'קוריאה הדרומית' },
  { value: '152', he: 'קוריאה הצפונית' },
  { value: '312', he: 'קזחסטאן' },
  { value: '63', he: 'קטר' },
  { value: '316', he: 'קירג\'זסטאן' },
  { value: '862', he: 'קלדוניה החדשה' },
  { value: '123', he: 'קמבודיה' },
  { value: '244', he: 'קמרון' },
  { value: '253', he: 'קניה' },
  { value: '10', he: 'קפריסין' },
  { value: '412', he: 'קרואטיה' },
  { value: '279', he: 'ראוניון' },
  { value: '284', he: 'רואנדה' },
  { value: '260', he: 'רודזיה' },
  { value: '400', he: 'רומניה' },
  { value: '306', he: 'רוסיה' },
  { value: '920', he: 'רמת הגולן' },
  { value: '243', he: 'רפ מרכז אפריקנית' },
  { value: '930', he: 'רצועת עזה וסיני' },
  { value: '880', he: 'שאר ארצות אוקיאניה' },
  { value: '690', he: 'שאר ארצות אירופה' },
  { value: '180', he: 'שאר ארצות אסיה' },
  { value: '280', he: 'שאר ארצות אפריקה' },
  { value: '666', he: 'שגוי הסבה' },
  { value: '560', he: 'שוודיה' },
  { value: '520', he: 'שוויץ' },
  { value: '121', he: 'תאילנד' },
  { value: '220', he: 'תוניסיה' },
  { value: '15', he: 'תורכיה' },
  { value: '313', he: 'תורכמניסטאן' },
  { value: '70', he: 'תימן' },
  { value: '71', he: 'תימן הדמוקרטית' },
];


function padId9(raw) {
  const s = String(raw).trim();
  return /^\d+$/.test(s) && s.length < 9 ? s.padStart(9, '0') : s;
}
const PREFIX = /^(דרכון|passport|tz|ת\.?ז\.?)\s*[:=]\s*(.+)$/i;
function detectIdType(raw) {
  const s = String(raw).trim();
  const m = s.match(PREFIX);
  if (m) {
    const kind = /דרכון|passport/i.test(m[1]) ? 'passport' : 'tz';
    const val = m[2].trim();
    return kind === 'passport'
      ? { type: 'passport', identifier: val.toUpperCase() }
      : { type: 'tz', identifier: padId9(val.replace(/\D/g, '')) };
  }
  if (/[a-zA-Z]/.test(s)) return { type: 'passport', identifier: s.toUpperCase() };
  return { type: 'tz', identifier: padId9(s.replace(/\D/g, '')) };
}

// מרכאות עוטפות: ASCII " ' · גרשיים ״ (U+05F4) · גרש ׳ (U+05F3) · מסולסלות “ ” ‘ ’ (U+201C U+201D U+2018 U+2019)
const WRAP_QUOTES = /^[\u0022\u0027\u05F4\u05F3\u201C\u201D\u2018\u2019]+|[\u0022\u0027\u05F4\u05F3\u201C\u201D\u2018\u2019]+$/g;

const byName = new Map(COUNTRIES.map(c => [c.he, c.value]));
function resolveCountry(input) {
  if (input == null) return null;
  const s = String(input)
    .trim()
    .replace(WRAP_QUOTES, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;
  if (byName.has(s)) return byName.get(s);
  const hit = COUNTRIES.find(c => c.he.startsWith(s) || s.startsWith(c.he));
  return hit ? hit.value : null;
}

// זיהוי דף + ניווט אמין לסוג-לימוד דרך גריד "סוגי לימוד למוסד" (לא עץ-הצד השבור).
// לכידה-01 (דף מוסד), לכידה-02 (דף סוג-לימוד), לכידה-03 (דף תלמיד-חדש) — סעיפים מצוינים בהערות.
// אין גישה ל-document/window/sessionStorage ברמת המודול — רק בתוך גופי הפונקציות (import תקין ב-Node).


const NAV_KEY = 'talmud.absorb.nav';

// ─── sessionStorage: מצב-ניווט (לכידה-02 §1 — סניף לא ידוע בדף סוג-לימוד) ───

function saveNavState(obj) {
  try { sessionStorage.setItem(NAV_KEY, JSON.stringify(obj)); } catch (e) { /* אצווה לא נתקעת */ }
}

// תמיד מחזיר אובייקט, לעולם לא זורק (חסר / JSON פגום / sessionStorage לא קיים => {}).
function loadNavState() {
  try {
    const raw = sessionStorage.getItem(NAV_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

function clearNavState() {
  try { sessionStorage.removeItem(NAV_KEY); } catch (e) { /* אצווה לא נתקעת */ }
}

// ─── זיהוי דף ────────────────────────────────────────────────────────────────

// טהורה: מיון ראשוני לפי URL בלבד ("מועמד" — newStudent עדיין דורש אימות hidStudentState ב-getPage).
function classifyUrl(url) {
  if (typeof url !== 'string') return 'other';
  if (url.includes('InstitutesDetails.aspx')) return 'institute';
  if (url.includes('StudyTypeDetails.aspx')) return 'studyType';
  if (url.includes('Students/StudentsDetails.aspx')) return 'newStudent';
  return 'other';
}

function getPage() {
  const url = (typeof location !== 'undefined' && location.href) || '';
  const kind0 = classifyUrl(url);

  if (kind0 === 'institute') {
    // לכידה-01 §5: זיהוי סניף מ-h1 "<מוסד> סניף NN"; נופל חזרה למצב שמור אם ה-h1 לא נמצא/לא תואם.
    const h1 = typeof document !== 'undefined' ? document.querySelector('h1') : null;
    const m = h1 && /סניף\s*(\d+)/.exec(h1.textContent || '');
    const branch = m ? String(m[1]).padStart(2, '0') : (loadNavState().currentBranch || null);
    return { kind: 'institute', branch, studyType: null, url };
  }

  if (kind0 === 'studyType') {
    // לכידה-02 §1: אין מספר סניף בדף הזה כלל (לא ב-h1, לא ב-breadcrumb) — המקור היחיד: sessionStorage.
    const branch = loadNavState().currentBranch || null;
    // לכידה-02 §1: h1 = "סוג לימוד 600 - כולל אברכים יום שלם" — הקוד המספרי הראשון אחרי "סוג לימוד".
    const h1 = typeof document !== 'undefined' ? document.querySelector('h1') : null;
    const m = h1 && /סוג לימוד\s*(\d+)/.exec(h1.textContent || '');
    const studyType = m ? m[1] : null;
    return { kind: 'studyType', branch, studyType, url };
  }

  if (kind0 === 'newStudent') {
    // לכידה-03 §1/§2: אותו URL גם לבאג-הניווט מהעץ (דף ריק) וגם לתלמיד-חדש אמיתי —
    // ההבחנה היחידה המתועדת: SD~hidStudentState == -1 (SD~ = ContentPlaceHolder1_TabsStudent_
    // StudentDetails1_ucStudentDetails_, לכידה-03 §2).
    const hid = $el('ContentPlaceHolder1_TabsStudent_StudentDetails1_ucStudentDetails_hidStudentState');
    const isNewStudent = !!hid && String(hid.value).trim() === '-1';
    if (isNewStudent) {
      return { kind: 'newStudent', branch: loadNavState().currentBranch || null, studyType: null, url };
    }
    return { kind: 'other', branch: null, studyType: null, url };
  }

  return { kind: 'other', branch: null, studyType: null, url };
}

// ─── גריד "סוגי לימוד למוסד" (gvStudyType) — לכידה-02 §2 ────────────────────

// טהורה, ללא DOM. `rows`: מערך של מערכי-תאים (מחרוזות, לא בהכרח trimmed).
// סמנטיקת האינדקס המוחזר — הכרעה מפורשת (הבקר, סעיף 2 בהנחיה):
//   האינדקס יחסי ל**שורות-נתונים בלבד** (0-based), אחרי דילוג על שורות-כותרת
//   (td[0] שאינו מספרי, למשל "קוד סוג לימודים"). כותרת לא נספרת ולא משפיעה על האינדקס.
//   זה בדיוק מה ש-selectedRowStudyType(rowIndex) מצפה לו על הדף החי (לכידה-02 §2:
//   "שורה = onclick=selectedRowStudyType('N')", N הוא אינדקס שורת-הנתונים בעמוד הנוכחי) —
//   הקוד שקורא לפונקציה הזו (gotoStudyTypeFromInstitute) חייב להעביר את האינדקס
//   הזה כמות-שהוא ל-window.selectedRowStudyType, בלי לחבר/לחסר בשביל הכותרת.
function findStudyTypeRow(rows, code) {
  if (!Array.isArray(rows)) return -1;
  const target = String(code).trim();
  let dataIndex = -1;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const first = String(row[0] ?? '').trim();
    if (!/^\d+$/.test(first)) continue; // שורת-כותרת (או שורת-פייג'ר) — מדולגת, לא נספרת
    dataIndex++;
    if (first === target) return dataIndex;
  }
  return -1;
}

// DOM-touching, לא נבדק ביחידה: ממיר <table> ל-מערך-שורות של טקסטי-תאים (trimmed).
function gridToRows(table) {
  if (!table || typeof table.querySelectorAll !== 'function') return [];
  return Array.from(table.querySelectorAll('tr')).map(
    (tr) => Array.from(tr.querySelectorAll('td,th')).map((cell) => (cell.textContent || '').trim())
  );
}

// NEEDS_CONTEXT (לבדיקה רטובה, Task 9): לכידה-01/02 לא מתעדות את מנגנון-ההפעלה המדויק
// של הטאב ("$find(...).set_activeTabIndex(1)" מול פשוט הקלקה על כותרת הטאב), ולא את ה-ID
// המלא של ה-TabContainer. מנחת-הבטיחות כאן: איתור כותרת הטאב לפי הטקסט שלה ("סוגי לימוד
// למוסד", לכידה-01 §5) תחת מוסכמת-ה-CSS הסטנדרטית של AjaxControlToolkit
// (ajax__tab_header/ajax__tab_tab) או role="tab" גנרי; אם לכותרת יש href בפורמט
// __doPostBack יורים אותו דרך firePostback (עומד ב"כל postback דרך firePostback"), אחרת
// מניחים מעבר-טאב צד-לקוח טהור (כל הפאנלים כבר ב-DOM) ורק ממתינים "טיק" (sleep) לעדכון.
async function activateStudyTypeTab() {
  try {
    if (typeof document === 'undefined') return { ok: false, reason: 'אין document (סביבת בדיקה?)' };
    const headers = Array.from(document.querySelectorAll('.ajax__tab_header a, .ajax__tab_tab, [role="tab"]'));
    const tab = headers.find((el) => (el.textContent || '').includes('סוגי לימוד למוסד'));
    if (!tab) return { ok: false, reason: 'לא נמצא טאב "סוגי לימוד למוסד" בעמוד המוסד' };

    const href = typeof tab.getAttribute === 'function' ? tab.getAttribute('href') : null;
    const parsed = href ? parsePostbackHref(href) : null;
    if (parsed) return firePostback(parsed.target, parsed.arg);

    tab.click();
    await sleep(50);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'שגיאה בהפעלת טאב סוגי הלימוד: ' + (e && e.message) };
  }
}

// NEEDS_CONTEXT (Task 9): ה-ID המלא של gvStudyType לא מופיע בלכידה (רק סיומת
// "...InsStudyTypes_ucStudyTypeSearch_gvStudyType") — לכן איתור לפי סיומת ID, לא ID מדויק.
// NEEDS_CONTEXT (Task 9): פורמט קישורי הפייג'ר (Page$Next / Page$<n> — מוסכמת GridView
// סטנדרטית) לא מאומת מול הדף החי; הלולאה חסומה גם ע"י תקרה קשיחה כדי שלעולם לא תיתקע.
async function gotoStudyTypeFromInstitute(code) {
  const tab = await activateStudyTypeTab();
  if (!tab.ok) return tab;

  const maxPageFlips = 25; // תקרת-ביטחון: לא לסמוך על כך שמספר קישורי-הפייג'ר קבוע (Next/Prev)
  for (let flip = 0; flip <= maxPageFlips; flip++) {
    const table = typeof document !== 'undefined' ? document.querySelector('table[id$="gvStudyType"]') : null;
    if (!table) return { ok: false, reason: 'לא נמצא גריד סוגי הלימוד (gvStudyType) בעמוד' };

    const rows = gridToRows(table);
    const rowIndex = findStudyTypeRow(rows, code);

    if (rowIndex !== -1) {
      if (typeof window === 'undefined' || typeof window.selectedRowStudyType !== 'function') {
        return { ok: false, reason: 'selectedRowStudyType אינה זמינה בעמוד' };
      }
      try {
        window.selectedRowStudyType(rowIndex);
      } catch (e) {
        return { ok: false, reason: 'שגיאה בבחירת שורת סוג הלימוד: ' + (e && e.message) };
      }
      return firePostback('ctl00$ContentPlaceHolder1$btnUpdateStudyType');
    }

    const pagerAnchors = Array.from(table.querySelectorAll('tr:last-child a'));
    const next = pagerAnchors
      .map((a) => parsePostbackHref(a.getAttribute('href') || ''))
      .find((p) => p && /Page\$(Next|\d+)/.test(p.arg));

    if (!next) return { ok: false, reason: `סוג לימוד ${code} לא נמצא בגריד` };

    const res = await firePostback(next.target, next.arg);
    if (!res.ok) return res;
  }

  return { ok: false, reason: `סוג לימוד ${code} לא נמצא בגריד (חריגה ממספר הדפים המותר)` };
}

// ─── עץ הסניפים (tvTalmud) — לכידה-01 §1: "זה כן עובד — רק סוגי-הלימוד שבורים" ─

// טהורה: href של צומת-סניף מסתיים ב-\<קוד דו-ספרתי>' (backslash+קוד+גרש-סוגר),
// לפני ה-')' הסוגר של קריאת ה-__doPostBack. צומת-ילד (סוג-לימוד) ממשיך אחרי הקוד
// ולכן לא תואם (ראו דוגמה בטסט: \00\(720)כולל...).
function findBranchHref(hrefs, code) {
  if (!Array.isArray(hrefs)) return -1;
  const suffix = '\\' + String(code).trim().padStart(2, '0') + "'";
  for (let i = 0; i < hrefs.length; i++) {
    const h = hrefs[i];
    if (typeof h !== 'string') continue;
    const trimmed = h.trim().replace(/\)+;?$/, '');
    if (trimmed.endsWith(suffix)) return i;
  }
  return -1;
}

// טהורה: מפרק href בפורמט javascript:__doPostBack('target','arg') ל-{target, arg}.
// ה-arg עשוי להכיל backslash ועברית (לא תווים מיוחדים ל-regex כאן) — לא נזרק על תוכן לא-צפוי.
function parsePostbackHref(href) {
  if (typeof href !== 'string') return null;
  const m = /^(?:javascript:)?__doPostBack\('([^']*)'\s*,\s*'([^']*)'\)\s*;?$/.exec(href.trim());
  if (!m) return null;
  return { target: m[1], arg: m[2] };
}

// NEEDS_CONTEXT (Task 9): ה-ID/סלקטור המדויק של מיכל עץ-הסניפים tvTalmud לא מלא בלכידה
// (הסופיקס בלבד מאומת: ...ucTalmudSideBar_tvTalmud) — איתור לפי סיומת ID.
// חשוב: זה גורם ל-navigate מלא (לא PRM/async) — ה-Promise עלול לעולם לא להתממש כי
// הדף עצמו נטען-מחדש. **הקורא חייב לשמור את מצב ההמשך (resume state) שלו *לפני* הקריאה
// לפונקציה הזו, לא אחריה** — אין הבטחה ש-then/await אחריה ירוצו.
async function gotoBranch(code) {
  if (typeof document === 'undefined') return { ok: false, reason: 'אין document (סביבת בדיקה?)' };
  const padded = String(code).trim().padStart(2, '0');
  const tree = document.querySelector('[id$="tvTalmud"]');
  if (!tree) return { ok: false, reason: 'לא נמצא עץ הסניפים (tvTalmud)' };

  const anchors = Array.from(tree.querySelectorAll('a'));
  const hrefs = anchors.map((a) => a.getAttribute('href') || '');
  const idx = findBranchHref(hrefs, padded);
  if (idx === -1) return { ok: false, reason: `סניף ${padded} לא נמצא בעץ הצד` };

  const parsed = parsePostbackHref(hrefs[idx]);
  if (!parsed) return { ok: false, reason: 'קישור הסניף לא בפורמט __doPostBack צפוי' };

  saveNavState({ ...loadNavState(), currentBranch: padded });
  return firePostback(parsed.target, parsed.arg);
}


// מרכאות עוטפות: ASCII " ' · גרשיים ״ (U+05F4) · גרש ׳ (U+05F3) · מסולסלות “ ” ‘ ’
const ABSORB_WRAP_QUOTES = /^["'״׳“”‘’]+|["'״׳“”‘’]+$/g;

const HEADER_ALIASES = {
  branch: ['סניף'],
  studyType: ['סוג לימוד', 'סוג'],
  identifier: ['ת.ז./דרכון', 'ת.ז.', 'תז', 'דרכון', 'מזהה'],
  birthDate: ['תאריך לידה', 'לידה'],
  country: ['ארץ', 'ארץ דרכון'],
  firstName: ['שם פרטי', 'שם'],
  lastName: ['שם משפחה', 'משפחה'],
  gender: ['מגדר'],
  familyStatus: ['מצב משפחתי', 'מצב'],
};
const FIELD_LABELS = { branch: 'סניף', studyType: 'סוג לימוד', identifier: 'מזהה' };
const FAMILY_STATUS_MAP = {
  'רווק': '10', 'רווקה': '10', 'נשוי': '20', 'נשואה': '20',
  'גרוש': '30', 'גרושה': '30', 'אלמן': '40', 'אלמנה': '40',
};
const DATE_PATTERNS = [
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: 'ymd' }, // ISO
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: 'dmy' },
  { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: 'dmy' },
  { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: 'dmy' },
];

const pad2 = (n) => String(n).padStart(2, '0');
const splitLines = (text) => String(text).split(/\r\n|\r|\n/);

function normalizeHeaderCell(s) {
  let t = String(s).trim().replace(/\s+/g, ' ').replace(ABSORB_WRAP_QUOTES, '');
  if (t.endsWith('.')) t = t.slice(0, -1);
  return t.toLowerCase();
}

const HEADER_LOOKUP = new Map();
for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
  for (const alias of aliases) HEADER_LOOKUP.set(normalizeHeaderCell(alias), field);
}

const isPurelyNumericCell = (cell) => /^\d+$/.test(String(cell ?? '').trim().replace(ABSORB_WRAP_QUOTES, ''));

function detectDelimiter(text) {
  if (text.includes('\t')) return 'tab';
  if (text.includes(',')) return 'comma';
  return 'whitespace';
}

function splitCells(line, delimiter) {
  let cells;
  if (delimiter === 'tab') cells = line.split('\t');
  else if (delimiter === 'comma') cells = line.split(',');
  else cells = line.trim().split(/\s+/).filter((c) => c !== '');
  return cells.map((c) => c.trim());
}

function buildColumnMap(headerCells) {
  const map = {};
  headerCells.forEach((cell, idx) => {
    const field = HEADER_LOOKUP.get(normalizeHeaderCell(cell));
    if (field && !(field in map)) map[field] = idx;
  });
  return map;
}

function normalizeDate(raw) {
  if (raw === undefined) return { value: undefined, error: null };
  const s = raw.trim();
  if (s === '') return { value: undefined, error: null };
  for (const { re, order } of DATE_PATTERNS) {
    const m = s.match(re);
    if (!m) continue;
    const [, a, b, c] = m;
    const [d, mo, y] = order === 'ymd' ? [c, b, a] : [a, b, c];
    return { value: `${pad2(d)}/${pad2(mo)}/${y}`, error: null };
  }
  return { value: undefined, error: `תאריך לא תקין: ${raw}` };
}

function mapGender(raw) {
  const s = raw.trim();
  if (s === '1' || s === '2') return { value: s, error: null };
  if (s === 'זכר') return { value: '1', error: null };
  if (s === 'נקבה') return { value: '2', error: null };
  return { value: undefined, error: `מגדר לא ידוע: ${raw}` };
}

function mapFamilyStatus(raw) {
  const s = raw.trim();
  if (['10', '20', '30', '40'].includes(s)) return { value: s, error: null };
  if (s in FAMILY_STATUS_MAP) return { value: FAMILY_STATUS_MAP[s], error: null };
  return { value: undefined, error: `מצב משפחתי לא ידוע: ${raw}` };
}

function rowToTask({ cells, lineNo, raw, columnMap }) {
  const err = (reason) => ({ error: { line: lineNo, text: raw, reason } });
  let branch, studyType, identity;
  let birthDateRaw, countryRaw, firstNameRaw, lastNameRaw, genderRaw, statusRaw;

  if (columnMap) {
    const get = (f) => (f in columnMap ? (cells[columnMap[f]] ?? '').trim() : undefined);
    branch = get('branch') ?? '';
    studyType = get('studyType') ?? '';
    identity = get('identifier') ?? '';
    birthDateRaw = get('birthDate');
    countryRaw = get('country');
    firstNameRaw = get('firstName');
    lastNameRaw = get('lastName');
    genderRaw = get('gender');
    statusRaw = get('familyStatus');
  } else {
    branch = (cells[0] ?? '').trim();
    studyType = (cells[1] ?? '').trim();
    identity = (cells[2] ?? '').trim();
  }

  if (!branch || !studyType || !identity) return err('חסרים שדות חובה: סניף/סוג לימוד/מזהה');
  if (!/^\d+$/.test(branch)) return err(`סניף לא מספרי: ${branch}`);
  if (!/^\d+$/.test(studyType)) return err(`סוג לימוד לא מספרי: ${studyType}`);

  const idInfo = detectIdType(identity);

  if (!columnMap) {
    const rest = cells.slice(3).map((c) => (c ?? '').trim());
    if (idInfo.type === 'passport') {
      birthDateRaw = rest.length >= 1 ? rest[0] : undefined;
      countryRaw = rest.length >= 2 ? rest[1] : undefined;
    } else if (cells.length === 4 || cells.length === 5) {
      return err('מספר עמודות לא צפוי');
    } else if (cells.length >= 6) {
      firstNameRaw = rest[0];
      lastNameRaw = rest[1];
      birthDateRaw = rest.length >= 3 ? rest[2] : undefined;
      genderRaw = rest.length >= 4 ? rest[3] : undefined;
      statusRaw = rest.length >= 5 ? rest[4] : undefined;
    }
  }

  const dateResult = normalizeDate(birthDateRaw);
  if (dateResult.error) return err(dateResult.error);

  let countryValue;
  if (countryRaw === undefined) countryValue = undefined;
  else if (countryRaw === '') countryValue = null;
  else {
    const resolved = resolveCountry(countryRaw);
    if (resolved === null) return err(`ארץ לא מוכרת: ${countryRaw}`);
    countryValue = resolved;
  }

  let genderValue;
  if (genderRaw !== undefined && genderRaw !== '') {
    const g = mapGender(genderRaw);
    if (g.error) return err(g.error);
    genderValue = g.value;
  }
  let statusValue;
  if (statusRaw !== undefined && statusRaw !== '') {
    const s = mapFamilyStatus(statusRaw);
    if (s.error) return err(s.error);
    statusValue = s.value;
  }

  let newStudent;
  if (firstNameRaw && lastNameRaw) {
    newStudent = { firstName: firstNameRaw, lastName: lastNameRaw };
    if (dateResult.value !== undefined) newStudent.birthDate = dateResult.value;
    if (genderValue !== undefined) newStudent.gender = genderValue;
    if (statusValue !== undefined) newStudent.familyStatus = statusValue;
  }

  const task = {
    line: lineNo, branch: branch.padStart(2, '0'), studyType,
    idType: idInfo.type, identity: idInfo.identifier,
    birthDate: dateResult.value, country: countryRaw, countryValue,
  };
  if (newStudent) task.newStudent = newStudent;
  return { task };
}

function maybeHeader(rawLines, delimiter) {
  const none = { headerLineIndex: -1, columnMap: null, missingRequiredLabels: [] };
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const cells = splitCells(rawLines[i], delimiter);
    if (isPurelyNumericCell(cells[0])) return none;
    const columnMap = buildColumnMap(cells);
    const missingRequiredLabels = ['branch', 'studyType', 'identifier']
      .filter((f) => !(f in columnMap))
      .map((f) => FIELD_LABELS[f]);
    return { headerLineIndex: i, columnMap, missingRequiredLabels };
  }
  return none;
}

function parseAbsorbInput(text) {
  const rawLines = splitLines(text);
  const delimiter = detectDelimiter(text);
  const { headerLineIndex, columnMap, missingRequiredLabels } = maybeHeader(rawLines, delimiter);
  const tasks = [];
  const errors = [];

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const raw = rawLines[i];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (i === headerLineIndex) continue;

    const cells = splitCells(raw, delimiter);
    if (columnMap && missingRequiredLabels.length > 0) {
      errors.push({ line: lineNo, text: raw, reason: `בכותרת חסרים שדות חובה: ${missingRequiredLabels.join('/')}` });
      continue;
    }

    const result = rowToTask({ cells, lineNo, raw, columnMap });
    if (result.error) errors.push(result.error);
    else tasks.push(result.task);
  }

  return { tasks, errors };
}

// זרימת קליטת תלמידים v3.3 — פורט מ"תלמוד - קליטת תלמידים" v3.2
// (analyzeGrid:197, processStudent:314, processStudentSafe:506, runQueue:563), עם:
// ניווט-גריד במקום עץ (navigate.js), טיפול ב-ucMessagePopUp (popup.js), ענף תלמיד-חדש
// (לכידה-03), וריפוד אפסים בשלושת המקומות (חיפוש / מילוי / אימות).
// אין גישה ל-document/window/sessionStorage ברמת המודול — רק בתוך גופי הפונקציות.


// ─── מזהי DOM (לכידה-02 §3 — מאומתים; לכידה-03 §2/§3 — דף תלמיד חדש) ────────

const ABSORB_BASE = 'ContentPlaceHolder1_tabStudyTypeDetails_StudentList_ucStudentsSearchDetails';

const ABSORB_IDS = {
  tabContainer: 'ContentPlaceHolder1_tabStudyTypeDetails', // לכידה-02 §1: טאב 2 = רשימת תלמידים
  searchInput: `${ABSORB_BASE}_txtStudenPassport`,
  searchBtn: `${ABSORB_BASE}_btnSearch`,
  countLabel: `${ABSORB_BASE}_lblCountSearch`,
  grid: `${ABSORB_BASE}_gvIStudents`, // לכידה-01 §4: עמודה 3 = ת.ז./דרכון
  absorbBtn: 'ContentPlaceHolder1_btnStudentAcceptence3',
  modal: `${ABSORB_BASE}_pnlAcceptStudent`,
  idTypeDdl: `${ABSORB_BASE}_ddlPopIdentityType`, // לכידה-01 §6: 1=ת.ז. 2=דרכון
  modalId: `${ABSORB_BASE}_txtIdentifier`,
  birthDate: `${ABSORB_BASE}_ctlBirthDate_txtDate`,
  countryDdl: `${ABSORB_BASE}_ddlCountryOfOrigine`,
  startDate: `${ABSORB_BASE}_ctlAcceptanceDate_txtDate`,
  confirmBtn: `${ABSORB_BASE}_LinkButton1`, // WebForm_DoPostBackWithOptions (עם ולידטורים)
  cancelBtn: `${ABSORB_BASE}_LinkButton2`,
};

// לכידה-03 §2: SD~ = ContentPlaceHolder1_TabsStudent_StudentDetails1_ucStudentDetails_
const ABSORB_NEW_BASE = 'ContentPlaceHolder1_TabsStudent_StudentDetails1_ucStudentDetails';

const ABSORB_NEW_IDS = {
  firstName: `${ABSORB_NEW_BASE}_txtFirstName`,
  lastName: `${ABSORB_NEW_BASE}_txtLastName`,
  birthDate: `${ABSORB_NEW_BASE}_ctlBirthDate_txtDate`,
  idField: `${ABSORB_NEW_BASE}_txtID`,
  gender: `${ABSORB_NEW_BASE}_ddlGender`,
  familyStatus: `${ABSORB_NEW_BASE}_ddlFamilyStatus`,
  saveBtn: 'ContentPlaceHolder1_btnSave', // לכידה-03 §2: כפתור השמירה היחיד, אין ביטול
};

const ABSORB_QUEUE_KEY = 'talmud.absorb.queue';
const ABSORB_STOP_KEY = 'talmud.absorb.stop';
const ABSORB_ATTEMPT_KEY = 'talmud.absorb.attempts';
const ABSORB_STUDENT_TIMEOUT_MS = 60000; // v3.2: STUDENT_TIMEOUT_MS
const ABSORB_MAX_RESUME_ATTEMPTS = 4;
const ABSORB_STOP_PREFIX = '__STOPPED__@';
const ABSORB_CANCEL_PREFIX = '__CANCELLED__@'; // ניסיון שהוחלף (timeout+retry) — נהרג בגבול-השלב הבא
const ABSORB_NAVIGATED = { __navigated: true }; // סימן ל-runQueue: הדף נטען מחדש, resume ימשיך
const ABSORB_CONTINUE = { __continue: true }; // התוצאה כבר נרשמה — להמשיך לתלמיד הבא בלי לרשום שוב
const ABSORB_GRID_STALE_ATTR = 'data-absorb-stale'; // סימון גריד ישן לפני חיפוש (C4)
// תקציבי ה-postback (I3): ההמתנה לתוצאה חייבת להיות לפחות כמו התקציב, אחרת יורים
// חיפוש-אימות מעל postback שעדיין בטיסה — MS AJAX מבטל אותו בצד-לקוח והשרת ממשיך.
const ABSORB_CONFIRM_BUDGET_MS = 25000; // LinkButton1 (אישור הקליטה)
const ABSORB_SAVE_BUDGET_MS = 30000; // btnSave (שמירת תלמיד חדש)
const ABSORB_OUTCOME_GRACE_MS = 2000; // מרווח מעל התקציב — ל-waitPRM להספיק להיסגר בעצמו
const ABSORB_NAV_EVIDENCE_MS = 8000; // כמה להמתין לעדות ניווט (טעינה מלאה) לפני שמכריזים כישלון
const ABSORB_MAX_QUEUE_AGE_MS = 30 * 60 * 1000; // M5: מעל זה — אין resume אוטומטי

// ─── סטטוסים (קבוצה קטנה וסגורה — הדוח/הטבלה מקבצים לפיה) ───────────────────

const ABSORB_STATUS = {
  OK: 'נקלט',
  OK_NEW: 'נקלט (תלמיד חדש)',
  EXISTS: 'כבר קיים',
  SAVED_UNVERIFIED: 'נשמר — לאמת ידנית',
  UNVERIFIED: 'לא אומת בגריד',
  NOT_COMPLETED: 'קליטה לא הושלמה',
  BLOCKED: 'נחסם',
  NEW_STUDENT_MISSING: 'תלמיד חדש — נדרשים שם פרטי, שם משפחה ותאריך לידה',
  ERROR: 'שגיאה',
  SKIPPED: 'דולג',
  STOPPED: 'נעצר',
};

const ABSORB_SUCCESS_KEYS = [ABSORB_STATUS.OK, ABSORB_STATUS.OK_NEW, ABSORB_STATUS.EXISTS];

const ABSORB_TSV_HEADER = ['סניף', 'סוג לימוד', 'ת.ז./דרכון', 'סטטוס', 'מה לעשות'];
const ABSORB_CSV_HEADER = ['סניף', 'סוג לימוד', 'ת.ז./דרכון', 'סטטוס', 'פירוט', 'מה לעשות'];
const ABSORB_TEMPLATE_HEADER = ['סניף', 'סוג לימוד', 'ת.ז./דרכון', 'שם פרטי', 'שם משפחה', 'תאריך לידה', 'ארץ', 'מגדר', 'מצב משפחתי'];

// ─── פונקציות טהורות (נבדקות ביחידה) ────────────────────────────────────────

// "נחסם: <טקסט ההודעה>" → "נחסם". שאר הסטטוסים חוזרים כמו שהם.
function absorbStatusKey(status) {
  const s = String(status == null ? '' : status);
  const i = s.indexOf(':');
  return (i === -1 ? s : s.slice(0, i)).trim();
}

function isAbsorbSuccess(status) {
  return ABSORB_SUCCESS_KEYS.indexOf(absorbStatusKey(status)) !== -1;
}

// ת.ז. → ספרות בלבד בלי אפסים מובילים (כך "6136871" == "006136871");
// דרכון → בלי רווחים/מקפים, רישיות אחידות (לא מרופד).
function absorbNormalizeId(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const compact = s.replace(/[\s-]/g, '');
  if (/^\d+$/.test(compact)) return compact.replace(/^0+/, '') || '0';
  return compact.toUpperCase();
}

// תא-מזהה בגריד: אלפאנומרי באורך 4+. חוסם שורות-כותרת ("ת.ז. / דרכון") ושורות-פייג'ר.
const ABSORB_ID_CELL_RE = /^[0-9A-Za-z][0-9A-Za-z\s-]{3,}$/;

// טהורה. `rows` = מערך של מערכי-תאים (טקסט). עמודה 3 = ת.ז./דרכון (לכידה-01 §4).
// מנרמל את שני הצדדים לפני ההשוואה; שומר על ה-fallback של v3.2 (שורת-נתונים יחידה).
// ‏`count` (אופציונלי) = תווית הספירה של החיפוש, כשער כמו ב-v3.2 (שורות 199-215):
//   ‏0 → "לא נמצא" בלי קשר לשורות שעדיין בגריד (גריד ישן לא ייקרא כתשובה);
//   ‏1 → מותר fallback לשורת-נתונים יחידה; 2+ → רק התאמה מדויקת;
//   null/undefined → התנהגות תואמת-אחורה (fallback מותר, כמו בלי שער).
function analyzeGrid(rows, identity, count) {
  const none = { found: false, matchType: null };
  if (count === 0) return none; // התווית אמרה "0 נמצאו" — אין מה לקרוא מהגריד
  if (!Array.isArray(rows)) return none;
  const target = absorbNormalizeId(identity);
  if (!target) return none;

  let dataRows = 0;
  let exact = false;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const cell = String(row[3] == null ? '' : row[3]).trim();
    if (!ABSORB_ID_CELL_RE.test(cell)) continue;
    dataRows++;
    if (absorbNormalizeId(cell) === target) exact = true;
  }
  if (exact) return { found: true, matchType: 'exact' };
  if (dataRows === 1 && (count == null || count === 1)) return { found: true, matchType: 'single-row-fallback' };
  return none;
}

function absorbFlatCell(value) {
  return String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ').trim();
}

// TSV להדבקה ישירה לאקסל (טאבים + כותרת), 5 עמודות בכל שורה.
function buildResultsTsv(results) {
  const lines = [ABSORB_TSV_HEADER.join('\t')];
  for (const r of Array.isArray(results) ? results : []) {
    lines.push([r.branch, r.studyType, r.identity, r.status, r.action].map(absorbFlatCell).join('\t'));
  }
  return lines.join('\n');
}

// CSV (מערך-שורות ל-toCsv) — כולל עמודת פירוט, שאין לה מקום ב-TSV הקצר.
function buildResultsCsvRows(results) {
  const rows = [ABSORB_CSV_HEADER.slice()];
  for (const r of Array.isArray(results) ? results : []) {
    rows.push([r.branch, r.studyType, r.identity, r.status, r.detail || '', r.action || '']);
  }
  return rows;
}

function summarizeAbsorbResults(results) {
  const counts = {};
  for (const r of Array.isArray(results) ? results : []) {
    const key = absorbStatusKey(r && r.status) || '—';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// דוח "מה נשאר": שורה אופרטיבית לכל תוצאה שאינה הצלחה + סיכום ספירות.
function buildRemainingReport(results) {
  const list = Array.isArray(results) ? results : [];
  const counts = summarizeAbsorbResults(list);
  const lines = list
    .filter((r) => !isAbsorbSuccess(r && r.status))
    .map((r) => [r.branch, r.studyType, r.identity, r.status, r.action || '—'].map(absorbFlatCell).join(' · '));
  const summary = Object.keys(counts).map((k) => `${k}=${counts[k]}`).join(' · ');
  return { lines, summary, counts };
}

// טהורה: תווית הספירה של החיפוש ("נמצאו N רשומות" — v3.2 שורה 199). מחזירה מספר, או
// null כשאין תווית/אין מספר — כלומר "אין עדות שהחיפוש רץ" (C4).
// M-c: אין fallback ל-"כל מספר בטקסט" — הערך הזה משמש כשער ב-analyzeGrid (#4),
// ומספר אקראי מתוך משפט אחר (מספר עמוד, קוד) היה מכריע "נמצא/לא נמצא" בטעות.
function absorbParseCount(text) {
  const m = /נמצאו\s*(\d+)/.exec(String(text == null ? '' : text).trim());
  return m ? parseInt(m[1], 10) : null;
}

// טהורה (#5): רישום תוצאה חייב להיות אידמפוטנטי לכל שורה בתור. אחרי timeout+retry
// הניסיון השני מגיע לשורה שכבר נרשמה; רישום שני היה מקדם את הסמן פעמיים ומדלג על
// התלמיד הבא בשקט (בלי תוצאה ובלי שורה בדוח "מה נשאר").
function absorbShouldRecord(lastRecordedIdx, idx) {
  if (typeof idx !== 'number' || !Number.isFinite(idx) || idx < 0) return false;
  const last = typeof lastRecordedIdx === 'number' && Number.isFinite(lastRecordedIdx) ? lastRecordedIdx : -1;
  return idx > last;
}

// טהורה (#1): מה לשחזר במצב-הניווט אחרי ניווט שנכשל. מצב קודם עם סניף → מוחזר כמות
// שהוא; אין סניף קודם → null, כלומר "לנקות" — כדי שלא יישאר currentBranch שנכתב
// בשביל ניווט שמעולם לא הגיע ליעד (getPage בדף סוג-לימוד קורא ממנו את הסניף).
function absorbNavStateRestore(prev) {
  if (!prev || typeof prev !== 'object' || Array.isArray(prev)) return null;
  return prev.currentBranch ? prev : null;
}

// טהורה (M5): האם תור שמור ישן מדי ל-resume אוטומטי. חותמת חסרה/פגומה → לא ישן
// (לא חוסמים המשך של תור שנשמר בגרסה בלי חותמת).
function absorbQueueIsStale(startedAt, now, maxAgeMs) {
  const t0 = Date.parse(startedAt);
  if (!startedAt || Number.isNaN(t0)) return false;
  const nowMs = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.parse(now));
  if (Number.isNaN(nowMs)) return false;
  const max = typeof maxAgeMs === 'number' ? maxAgeMs : ABSORB_MAX_QUEUE_AGE_MS;
  return nowMs - t0 > max;
}

// טהורה (M2): מקור אחד לרשומת-תוצאה. ריפוד אפסים לת.ז., דרכון כמות-שהוא (מקוצץ רווחים).
function makeAbsorbResult(task, status, detail, action) {
  const t = task || {};
  const identity = t.idType === 'tz' ? padId9(t.identity) : String(t.identity == null ? '' : t.identity).trim();
  return {
    line: t.line, branch: t.branch, studyType: t.studyType, idType: t.idType, identity,
    status, detail: detail || '', action: action || '',
  };
}

// טהורה: href של LinkButton. תומכת גם ב-__doPostBack ישיר וגם ב-WebForm_DoPostBackWithOptions
// (כך נבנים LinkButton1 בקליטה ו-btnSave בתלמיד-חדש — לכידה-02 §3 / לכידה-03 §2).
function absorbParsePostbackFromHref(href) {
  const direct = parsePostbackHref(href);
  if (direct) return { target: direct.target, arg: direct.arg, group: '', validate: false };
  const m = /WebForm_PostBackOptions\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(true|false)\s*,\s*"([^"]*)"/.exec(String(href || ''));
  if (m) return { target: m[1], arg: m[2], group: m[4], validate: m[3] === 'true' };
  return null;
}

// ─── עצירה (sessionStorage — שורד reload; v3.2: STOP_KEY) ───────────────────

function absorbIsStopped() {
  try { return sessionStorage.getItem(ABSORB_STOP_KEY) === '1'; } catch (e) { return false; }
}

function requestAbsorbStop() {
  try { sessionStorage.setItem(ABSORB_STOP_KEY, '1'); } catch (e) { /* אצווה לא נתקעת */ }
  log('⛔ בקשת עצירה');
}

function clearAbsorbStop() {
  try { sessionStorage.removeItem(ABSORB_STOP_KEY); } catch (e) { /* אצווה לא נתקעת */ }
}

function absorbStopError(where) { return new Error(ABSORB_STOP_PREFIX + where); }
function isAbsorbStopError(err) {
  return !!err && typeof err.message === 'string' && err.message.indexOf(ABSORB_STOP_PREFIX) === 0;
}

function absorbCancelError(where) { return new Error(ABSORB_CANCEL_PREFIX + where); }
function isAbsorbCancelError(err) {
  return !!err && typeof err.message === 'string' && err.message.indexOf(ABSORB_CANCEL_PREFIX) === 0;
}

// ─── ביטול ניסיון שהוחלף (C3) ────────────────────────────────────────────────
// ‏absorbWithTimeout רק *מפסיק להמתין* — הניסיון הראשון ממשיך לרוץ ועלול לירות
// postback לתוך דף שהניסיון השני כבר מנהל. כל ניסיון מקבל "דור"; כשמתחיל ניסיון חדש
// (או ריצה/עצירה) הדור עולה, וכל גבול-שלב של הניסיון הישן זורק ומת שם.
let absorbGeneration = 0;

function absorbNextGeneration() { absorbGeneration++; return absorbGeneration; }
function absorbCurrentGeneration() { return absorbGeneration; }

// נקודת-בדיקה בכל גבול-שלב. `gen` (אופציונלי) = דור הניסיון הקורא.
function checkStop(where, gen) {
  if (typeof gen === 'number' && gen !== absorbGeneration) throw absorbCancelError(where);
  if (absorbIsStopped()) throw absorbStopError(where);
}

async function sleepCheckStop(ms, gen) {
  let left = ms;
  while (left > 0) {
    checkStop('sleep', gen);
    const step = Math.min(100, left);
    await sleep(step);
    left -= step;
  }
  checkStop('sleep', gen);
}

// ─── מצב התור (resume אחרי ניווט מלא) ───────────────────────────────────────

let absorbQueue = [];
let absorbResults = [];
let absorbCurIdx = 0;
let absorbRunning = false;
let absorbStartedAt = null;
let absorbHooks = {};
let absorbJustSavedNewStudent = null;
let absorbLastRecordedIdx = -1; // #5: השורה האחרונה שנרשמה לה תוצאה (מונע רישום כפול)

function absorbSetHooks(hooks) { absorbHooks = hooks || {}; }
function absorbGetResults() { return absorbResults.slice(); }
function absorbGetProgress() { return { curIdx: absorbCurIdx, total: absorbQueue.length }; }
function absorbIsRunning() { return absorbRunning; }

function saveAbsorbState(extra) {
  const state = {
    queue: absorbQueue, results: absorbResults, curIdx: absorbCurIdx,
    startedAt: absorbStartedAt || new Date().toISOString(),
  };
  if (extra) Object.assign(state, extra);
  try { sessionStorage.setItem(ABSORB_QUEUE_KEY, JSON.stringify(state)); } catch (e) { log('[מצב] שמירה נכשלה: ' + (e && e.message)); }
}

function loadAbsorbState() {
  try {
    const raw = sessionStorage.getItem(ABSORB_QUEUE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

function clearAbsorbState() {
  try {
    sessionStorage.removeItem(ABSORB_QUEUE_KEY);
    sessionStorage.removeItem(ABSORB_ATTEMPT_KEY);
  } catch (e) { /* אצווה לא נתקעת */ }
}

// מונה ניסיונות-resume לאותו תלמיד — שומר מפני לולאת ניווט אינסופית (הבאג של v3.2).
function absorbBumpAttempts(idx) {
  let rec = { idx: -1, count: 0 };
  try {
    const raw = sessionStorage.getItem(ABSORB_ATTEMPT_KEY);
    if (raw) rec = JSON.parse(raw) || rec;
  } catch (e) { /* ברירת מחדל */ }
  rec = rec.idx === idx ? { idx, count: (rec.count || 0) + 1 } : { idx, count: 1 };
  try { sessionStorage.setItem(ABSORB_ATTEMPT_KEY, JSON.stringify(rec)); } catch (e) { /* noop */ }
  return rec.count;
}

// ─── עוזרי DOM ──────────────────────────────────────────────────────────────

function absorbSetValue(el, value) {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function absorbSetSelect(el, value) {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// כל postback עובר דרך prm.js: או firePostback (יש target ב-href), או waitPRM שנרשם
// *לפני* לחיצה שנדחית ל-setTimeout(0) — אותו סדר קשיח (global-constraints).
function absorbFireElement(el, opts) {
  const href = (el && typeof el.getAttribute === 'function' && el.getAttribute('href')) || '';
  const pb = absorbParsePostbackFromHref(href);
  if (pb && pb.target) return firePostback(pb.target, pb.arg, opts);
  const wait = waitPRM(opts);
  setTimeout(() => {
    try { el.click(); } catch (e) { log('[postback] כשל בלחיצה: ' + (e && e.message)); }
  }, 0);
  return wait;
}

// מריץ את ולידטורי הצד-לקוח של הקבוצה במקום WebForm_DoPostBackWithOptions (שאותו
// עוקפים כדי לירות דרך firePostback). מחזיר {ok:true} כשאין ולידטורים בדף.
function absorbRunClientValidation(group) {
  try {
    if (typeof window === 'undefined' || typeof window.Page_ClientValidate !== 'function') return { ok: true, messages: [] };
    if (window.Page_ClientValidate(group || '')) return { ok: true, messages: [] };
    // I1: Page_ClientValidate שנכשל משאיר Page_BlockSubmit=true. ASP.NET מנקה את הדגל רק
    // בתוך ValidatorCommonOnSubmit (שביטל את השליחה) — אנחנו עוקפים אותו, ולכן ה-postback
    // *הבא* (סגירת המודאל / החיפוש של התלמיד הבא) היה נבלע בשקט. מנקים בעצמנו.
    try { window.Page_BlockSubmit = false; } catch (e) { /* אצווה לא נתקעת */ }
    return { ok: false, messages: absorbCollectValidationMessages(group) };
  } catch (e) {
    return { ok: true, messages: [] };
  }
}

function absorbCollectValidationMessages(group) {
  const out = [];
  try {
    const validators = (typeof window !== 'undefined' && window.Page_Validators) || [];
    for (const v of validators) {
      if (!v || v.isvalid !== false) continue;
      if (group && v.validationgroup && v.validationgroup !== group) continue;
      const txt = String(v.errormessage || v.textContent || '').trim();
      if (txt) out.push(txt.slice(0, 120));
    }
  } catch (e) { /* ממשיכים לסריקת ה-DOM */ }
  if (!out.length) {
    try {
      const nodes = document.querySelectorAll('[id*="lblError"],[id*="lblMessage"],[class*="error"],[class*="validator"]');
      for (const el of Array.from(nodes)) {
        const txt = (el.textContent || '').trim();
        if (txt && isVisible(el)) out.push(txt.slice(0, 120));
      }
    } catch (e) { /* אין מה להוסיף */ }
  }
  return out.slice(0, 3);
}

// לכידה-02 §1: טאב 2 = "רשימת תלמידים" — שם יושבים החיפוש והגריד.
function absorbActivateStudentsTab() {
  try {
    if (typeof window === 'undefined' || typeof window.$find !== 'function') return false;
    const tabs = window.$find(ABSORB_IDS.tabContainer);
    if (tabs && typeof tabs.set_activeTabIndex === 'function' && tabs.get_activeTabIndex() !== 2) {
      tabs.set_activeTabIndex(2);
      return true;
    }
  } catch (e) { /* לא קריטי — הפקדים בדרך כלל כבר ב-DOM */ }
  return false;
}

// C4: מסמנים את הגריד כ"ישן" *לפני* כל חיפוש. postback אמיתי מחליף את תוכן ה-UpdatePanel
// (ואיתו את אלמנט הגריד) — ולכן היעדר הסימון אחרי החיפוש הוא עדות שהגריד באמת התרענן.
// כל עוד הסימון קיים, readAbsorbGridRows מחזיר גריד ריק: תוצאה ישנה לא תיקרא כתשובה.
function absorbMarkGridStale() {
  try {
    const grid = $el(ABSORB_IDS.grid);
    if (grid && typeof grid.setAttribute === 'function') grid.setAttribute(ABSORB_GRID_STALE_ATTR, '1');
  } catch (e) { /* אצווה לא נתקעת */ }
}

function absorbGridIsStale() {
  try {
    const grid = $el(ABSORB_IDS.grid);
    return !!(grid && typeof grid.getAttribute === 'function' && grid.getAttribute(ABSORB_GRID_STALE_ATTR) === '1');
  } catch (e) {
    return false;
  }
}

function readAbsorbGridRows() {
  const grid = $el(ABSORB_IDS.grid);
  if (!grid || typeof grid.querySelectorAll !== 'function') return [];
  if (absorbGridIsStale()) return []; // הגריד לא התרענן מאז החיפוש הקודם — אין ממה לקרוא
  return Array.from(grid.querySelectorAll('tr')).map(
    (tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim())
  );
}

function readAbsorbCount() {
  const el = $el(ABSORB_IDS.countLabel);
  return el ? (el.textContent || '').trim() : '';
}

// ניסיון חיפוש יחיד. מחזיר {ok, started, executed, countText, count}.
async function absorbSearchOnce(input, btn, value, gen) {
  absorbMarkGridStale();
  absorbSetValue(input, value);
  await sleepCheckStop(150, gen);
  const res = await absorbFireElement(btn, { startTimeoutMs: 3000, totalTimeoutMs: 20000 });
  await sleepCheckStop(350, gen);
  const countText = readAbsorbCount();
  const count = absorbParseCount(countText);
  const started = !!(res && res.started);
  const refreshed = !absorbGridIsStale();
  // עדות שהחיפוש באמת רץ (C4): גם בקשה שהתחילה, וגם תווית-ספירה/גריד מרוענן אחריה.
  // ‏#4(b): הסימון *לא* מוסר כאן. גריד שלא התרענן נשאר "ישן" ו-readAbsorbGridRows
  // מחזיר עבורו ריק — כך שורה שנשארה מהתלמיד הקודם לא תיקרא כ"כבר קיים" (הפלה שקטה).
  // ‏started && !refreshed && count===null = אין עדות בכלל → ניסיון חוזר, ואז "שגיאה".
  const executed = started && (count !== null || refreshed);
  log(`[חיפוש] ${maskId(value)} → ${countText || '(ללא תווית ספירה)'} · started=${started} · refreshed=${refreshed} · executed=${executed}`);
  return { ok: !!(res && res.ok), started, executed, refreshed, countText, count, reason: res && res.reason };
}

// C4: חיפוש עם עדות-ביצוע. לחיצה שנבלעה (started=false) היא כשל בר-ניסיון-חוזר —
// מנסים פעם אחת נוספת, ורק אז מחזירים {executed:false} כדי שהקורא ידווח "שגיאה".
async function absorbSearch(input, btn, value, gen) {
  let res = await absorbSearchOnce(input, btn, value, gen);
  if (res.executed) return res;
  log('[חיפוש] אין עדות שהחיפוש רץ — ניסיון נוסף');
  await sleepCheckStop(500, gen);
  res = await absorbSearchOnce(input, btn, value, gen);
  if (!res.executed) log('[חיפוש] גם הניסיון השני לא הופעל');
  return res;
}

const ABSORB_SEARCH_FAILED_ACTION = 'החיפוש לא הופעל — בדוק את הדף ונסה שוב';

function absorbSearchFailReason(res) {
  if (!res) return 'החיפוש לא הופעל';
  if (!res.started) return 'לחיצת החיפוש לא הפעילה בקשה לשרת' + (res.reason ? ` (${res.reason})` : '');
  return 'החיפוש רץ אך תוצאותיו לא התעדכנו בדף' + (res.reason ? ` (${res.reason})` : '');
}

// M-f: סגירת חלונית ההודעה + המתנה נכונה. כשהסגירה עברה דרך btnMCancel (postback
// צד-שרת) ממתינים ל-PRM שנרשם לפני הלחיצה, במקום sleep שרירותי שהיה משאיר את
// ה-postback באוויר בזמן שהצעד הבא כבר יורה. extender.hide() אינו postback.
async function absorbHidePopup(gen) {
  const hide = hideMessagePopupAsync();
  if (hide && hide.wait) {
    await hide.wait; // waitPRM לעולם לא נדחה (prm.js)
    await sleepCheckStop(150, gen);
  }
  return hide;
}

async function absorbCloseAcceptModal() {
  try {
    const cancel = $el(ABSORB_IDS.cancelBtn);
    if (!cancel || !isVisible($el(ABSORB_IDS.modal))) return false;
    await absorbFireElement(cancel, { startTimeoutMs: 1500, totalTimeoutMs: 15000 });
    await sleep(300);
    return true;
  } catch (e) {
    log('[מודאל] סגירת חלון הקליטה נכשלה: ' + (e && e.message)); // M-d: לא לבלוע בשקט
    return false;
  }
}

function absorbStartDate() {
  try {
    const v = absorbHooks.getStartDate ? absorbHooks.getStartDate() : '';
    return v ? String(v).trim() : '';
  } catch (e) {
    return '';
  }
}

// ─── ניווט (שלב 1) ───────────────────────────────────────────────────────────

const ABSORB_NAV_FAIL_ACTION = 'נווט ידנית לסניף ולחץ התחל מחדש';

// חתימת-דף להשוואת "לפני/אחרי" — כולל ה-URL, כדי לזהות ניווט מלא שכבר קרה.
function absorbPageSignature() {
  const p = getPage();
  return `${p.kind}|${p.branch || ''}|${p.studyType || ''}|${p.url || ''}`;
}

// ניווט מלא (postback רגיל, לא MS AJAX) לא מפעיל beginRequest, ולכן started=false שם
// אינו ראיה לכישלון. הסימן שכן קיים: הדף מתחיל להיפרק. רושמים מאזין פעם אחת.
let absorbUnloadSeen = false;
let absorbUnloadWatched = false;

function absorbWatchUnload() {
  if (absorbUnloadWatched) return;
  try {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    absorbUnloadWatched = true;
    const mark = () => { absorbUnloadSeen = true; };
    // בלי returnValue — מאזין בלבד, לא מציג דיאלוג יציאה למשתמש.
    window.addEventListener('beforeunload', mark, true);
    window.addEventListener('pagehide', mark, true);
    window.addEventListener('unload', mark, true);
  } catch (e) { /* אצווה לא נתקעת */ }
}

// #2: הדגל חייב להתאפס *לפני* כל ניווט. בלי איפוס, pagehide/beforeunload יחיד בחיי
// הדף (למשל חזור/קדימה עם bfcache) הופך כל בדיקת-עדות הבאה ל"הצליח" מיידית → ניווט
// מדומה (ABSORB_NAVIGATED) והריצה ממתינה לטעינת דף שלא תגיע. מחזיר את חתימת-הדף
// שממנה משווים, כדי שהאיפוס והחתימה יילקחו תמיד יחד.
function absorbBeginNavigation() {
  absorbWatchUnload();
  absorbUnloadSeen = false;
  return absorbPageSignature();
}

// #1: ניווט שנכשל/נבלע השאיר את מצב-הניווט מצהיר על סניף שמעולם לא הגענו אליו
// (‏gotoBranch כותב currentBranch לפני הירי). בדף סוג-לימוד זה המקור *היחיד* לסניף,
// ולכן המשימה הבאה הייתה "מתאימה" לדף הלא-נכון ונקלטת לסניף שגוי. משחזרים.
function absorbRestoreNavState(prev) {
  const restore = absorbNavStateRestore(prev);
  if (restore) saveNavState(restore);
  else clearNavState();
  log(`[ניווט] הניווט לא אומת — מצב-הניווט שוחזר ל-${(restore && restore.currentBranch) || '(ריק)'}`);
}

// C1: עדות שהניווט באמת קרה. waitPRM מחזיר {ok:true} גם כששום דבר לא נורה, ולכן
// "ok" לבדו אינו ראיה — דורשים started===true, או שהדף מתחלף/מתחיל להיפרק בפועל.
async function absorbNavigationEvidence(res, signatureBefore, what) {
  if (res && res.ok === false) return { ok: false, reason: res.reason || `${what} נכשל` };
  if (res && res.started === true) return { ok: true };
  const t0 = Date.now();
  while (Date.now() - t0 < ABSORB_NAV_EVIDENCE_MS) {
    if (absorbUnloadSeen) return { ok: true };
    if (absorbPageSignature() !== signatureBefore) return { ok: true };
    await sleep(200);
  }
  return { ok: false, reason: `${what}: לא התחילה בקשה לשרת והדף לא השתנה` };
}

// ניווט מלא: הדף ייטען מחדש ולכן שומרים את מצב ההמשך *לפני* הקריאה (navigate.js §gotoBranch).
// מחזיר {ok:false, reason} גם כשהלחיצה נבלעה — אחרת הקורא היה מדווח "ניווט" ומחכה
// לטעינת דף שלא תגיע (C1: הריצה נתקעת בלי תוצאות ובלי דוח).
async function absorbNavigateToBranch(branch) {
  saveAbsorbState();
  const prevNav = loadNavState(); // #1: נלכד *לפני* ש-gotoBranch כותב currentBranch
  const before = absorbBeginNavigation();
  const res = await gotoBranch(branch);
  const evidence = await absorbNavigationEvidence(res, before, `ניווט לסניף ${branch}`);
  if (!evidence.ok) absorbRestoreNavState(prevNav);
  return evidence;
}

async function absorbEnsureStudyTypePage(task, gen) {
  const branch = String(task.branch).padStart(2, '0');
  const studyType = String(task.studyType);
  const page = getPage();

  if (page.kind === 'studyType' && page.branch === branch && page.studyType === studyType) {
    return { ok: true, navigated: false };
  }

  if (page.kind === 'institute' && page.branch === branch) {
    log(`[ניווט] דף מוסד ${branch} → סוג לימוד ${studyType}`);
    // I4: btnUpdateStudyType גורר ניווט מלא ל-StudyTypeDetails.aspx. רושמים את הסניף
    // (הדף הבא לא יודע אותו) ואת מצב ההמשך *לפני* הירי — אחרת ה-resume נוחת בלי סניף,
    // מנווט שוב, ושורף ניסיונות עד "דולג" שקרי.
    const prevNav = loadNavState(); // #1: נלכד לפני הכתיבה, לשחזור אם הניווט לא קרה
    saveNavState(Object.assign({}, prevNav, { currentBranch: branch }));
    saveAbsorbState();
    const before = absorbBeginNavigation();
    const res = await gotoStudyTypeFromInstitute(studyType);
    if (!res || res.ok === false) {
      absorbRestoreNavState(prevNav);
      return { ok: false, navigated: false, reason: (res && res.reason) || 'ניווט לסוג הלימוד נכשל' };
    }
    await sleepCheckStop(500, gen);
    const after = getPage();
    if (after.kind === 'studyType' && after.studyType === studyType) return { ok: true, navigated: false };
    const evidence = await absorbNavigationEvidence(res, before, `ניווט לסוג לימוד ${studyType}`);
    if (!evidence.ok) {
      absorbRestoreNavState(prevNav);
      return { ok: false, navigated: false, reason: evidence.reason, action: ABSORB_NAV_FAIL_ACTION };
    }
    // בקשה אמיתית יצאה אך עוד לא נחתנו — ה-resume אחרי טעינת הדף ימשיך מכאן.
    return { ok: true, navigated: true };
  }

  log(`[ניווט] ניווט מלא לסניף ${branch} (דף נוכחי: ${page.kind})`);
  const nav = await absorbNavigateToBranch(branch);
  if (!nav.ok) return { ok: false, navigated: false, reason: nav.reason, action: ABSORB_NAV_FAIL_ACTION };
  return { ok: true, navigated: true };
}

// ─── דף תלמיד-חדש (לכידה-03) ────────────────────────────────────────────────

function absorbNewStudentPageMatches(identity) {
  const el = $el(ABSORB_NEW_IDS.idField);
  const val = el ? String(el.value || '').trim() : '';
  if (!val) return false;
  return absorbNormalizeId(val) === absorbNormalizeId(identity);
}

// ממתין ל-endRequest *או* לניווט מלא לדף תלמיד-חדש (לכידה-03 §1) — המוקדם מביניהם.
// I3: ה-timeout כאן חייב להיות לפחות כתקציב ה-postback (25s/30s). המתנה קצרה יותר
// שלחה אותנו לירות חיפוש-אימות מעל postback שעדיין בטיסה — MS AJAX מבטל אותו בצד-לקוח,
// השרת ממשיך, והאימות קורא גריד ישן. M10: waitPRM לעולם לא נדחה — אין ענף reject.
async function absorbWaitConfirmOutcome(prmWait, budgetMs, gen) {
  let prmResult = null;
  prmWait.then((r) => { prmResult = r || { ok: true }; });
  const timeoutMs = (typeof budgetMs === 'number' ? budgetMs : ABSORB_CONFIRM_BUDGET_MS) + ABSORB_OUTCOME_GRACE_MS;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    checkStop('confirm-wait', gen);
    if (getPage().kind === 'newStudent') return { kind: 'newStudent' };
    if (prmResult) {
      await sleep(300);
      if (getPage().kind === 'newStudent') return { kind: 'newStudent' };
      return { kind: 'prm', result: prmResult };
    }
    await sleep(150);
  }
  return { kind: 'timeout' };
}

// יוצאים מדף תלמיד-חדש חזרה לסניף, אחרי שהתוצאה כבר נרשמה. אם הניווט לא באמת קרה
// (C1) — לא מכריזים ABSORB_NAVIGATED (שממתין לטעינה שלא תבוא), אלא מעדכנים את השורה
// שנרשמה וממשיכים לתלמיד הבא.
async function absorbLeaveNewStudentPage(task, recorded) {
  const nav = await absorbNavigateToBranch(String(task.branch).padStart(2, '0'));
  if (nav.ok) return ABSORB_NAVIGATED;
  log(`[ניווט] ${nav.reason}`);
  if (recorded) {
    recorded.detail = [recorded.detail, nav.reason].filter(Boolean).join(' | ');
    recorded.action = ABSORB_NAV_FAIL_ACTION;
    saveAbsorbState();
  }
  return ABSORB_CONTINUE;
}

async function absorbHandleNewStudentPage(task, identity, mk, gen, myIdx) {
  log('[תלמיד חדש] נחתנו בדף תלמיד-חדש');
  const ns = task.newStudent || {};
  const birthDate = ns.birthDate || task.birthDate || '';
  const missing = [];
  if (!ns.firstName) missing.push('שם פרטי');
  if (!ns.lastName) missing.push('שם משפחה');
  if (!birthDate) missing.push('תאריך לידה');

  // אין נתונים מלאים → לא שומרים כלום, יוצאים מהדף וממשיכים לתלמיד הבא.
  if (missing.length) {
    log(`[תלמיד חדש] חסרים נתונים (${missing.join(', ')}) — לא שומרים`);
    const res = mk(ABSORB_STATUS.NEW_STUDENT_MISSING, `חסר: ${missing.join(', ')}`,
      `הוסף לשורה עמודות: ${missing.join(', ')} (וגם מגדר/מצב משפחתי אם ברירות-המחדל זכר/נשוי לא נכונות) והרץ שוב`);
    // נרשם *לפני* הניווט המלא, אחרת ייעלם ב-reload. #5: קשור לשורה של הניסיון הזה,
    // כך שניסיון-חוזר אחרי timeout לא ירשום אותה שורה פעם שנייה.
    absorbRecordResult(res, gen, myIdx);
    return absorbLeaveNewStudentPage(task, res);
  }

  const first = $el(ABSORB_NEW_IDS.firstName);
  const last = $el(ABSORB_NEW_IDS.lastName);
  const birth = $el(ABSORB_NEW_IDS.birthDate);
  if (!first || !last || !birth) {
    return mk(ABSORB_STATUS.ERROR, 'שדות דף תלמיד-חדש לא נמצאו', 'מלא ושמור ידנית בדף התלמיד החדש');
  }

  absorbSetValue(first, ns.firstName);
  absorbSetValue(last, ns.lastName);
  absorbSetValue(birth, birthDate);
  if (ns.gender) { const g = $el(ABSORB_NEW_IDS.gender); if (g) absorbSetSelect(g, ns.gender); }
  if (ns.familyStatus) { const f = $el(ABSORB_NEW_IDS.familyStatus); if (f) absorbSetSelect(f, ns.familyStatus); }
  await sleepCheckStop(200, gen);
  checkStop('new-student-before-save', gen);

  const saveBtn = $el(ABSORB_NEW_IDS.saveBtn);
  if (!saveBtn) return mk(ABSORB_STATUS.ERROR, 'כפתור "שמירה" לא נמצא בדף תלמיד-חדש', 'שמור ידנית');

  const pb = absorbParsePostbackFromHref((saveBtn.getAttribute && saveBtn.getAttribute('href')) || '');
  if (pb && pb.validate) {
    const v = absorbRunClientValidation(pb.group);
    if (!v.ok) {
      return mk(ABSORB_STATUS.ERROR, 'ולידציה בדף תלמיד-חדש: ' + (v.messages.join(' | ') || 'שדה לא תקין'),
        'תקן שם פרטי/משפחה (עברית בלבד) ותאריך לידה (גיל 16+), ושמור ידנית');
    }
  }

  // "שמירה" עלולה לגרור ניווט מלא (לכידה-03 §5 — לא נבדק): מסמנים לפני, כדי שה-resume
  // ידע שהתלמיד הזה נשמר זה עתה ויסווג "כבר קיים" כ"נקלט (תלמיד חדש)".
  saveAbsorbState({ pendingSave: { idx: myIdx, identity } });
  log('[תלמיד חדש] שמירה…');
  const wait = absorbFireElement(saveBtn, { startTimeoutMs: 3000, totalTimeoutMs: ABSORB_SAVE_BUDGET_MS });
  await absorbWaitConfirmOutcome(wait, ABSORB_SAVE_BUDGET_MS, gen);
  await sleepCheckStop(400, gen);

  const pop = readMessagePopup();
  if (pop) {
    log(`[הודעה] אחרי שמירת תלמיד חדש: ${maskIdsInText(pop.text)}`);
    await absorbHidePopup(gen);
    if (pop.hasContinue) {
      return mk(`${ABSORB_STATUS.BLOCKED}: ${pop.text}`, pop.text,
        'המערכת מבקשת אישור "המשך" בשמירת התלמיד — הסקריפט לא מאשר לבד; השלם ידנית');
    }
    await sleepCheckStop(300, gen);
  }

  if (getPage().kind === 'newStudent') {
    const errs = absorbCollectValidationMessages();
    if (errs.length) return mk(ABSORB_STATUS.ERROR, errs.join(' | '), 'תקן את הפרטים בדף התלמיד החדש ושמור ידנית');
    return mk(ABSORB_STATUS.SAVED_UNVERIFIED, 'נשארנו בדף תלמיד-חדש אחרי "שמירה"', 'בדוק בדף התלמיד אם נשמר, והשלם קליטה ידנית');
  }

  // אם חזרנו לדף סוג-לימוד — אימות מול הגריד (מקור-האמת).
  if (getPage().kind === 'studyType') {
    const input = $el(ABSORB_IDS.searchInput);
    const btn = $el(ABSORB_IDS.searchBtn);
    if (input && btn) {
      const search = await absorbSearch(input, btn, identity, gen);
      if (!search.executed) {
        return mk(ABSORB_STATUS.SAVED_UNVERIFIED, absorbSearchFailReason(search), ABSORB_SEARCH_FAILED_ACTION);
      }
      if (analyzeGrid(readAbsorbGridRows(), identity, search.count).found) return mk(ABSORB_STATUS.OK_NEW, '', '');
    }
  }
  return mk(ABSORB_STATUS.SAVED_UNVERIFIED, 'התלמיד נשמר; הקליטה לא אומתה בגריד',
    'ודא ברשימת התלמידים של סוג הלימוד שהתלמיד נקלט');
}

// ─── עיבוד תלמיד יחיד (7 השלבים של הבריף) ───────────────────────────────────

async function processStudent(task, gen) {
  // #5: השורה שהניסיון הזה מטפל בה. הסמן הגלובלי עשוי להתקדם תוך כדי (רישום מוקדם
  // לפני ניווט מלא), ולכן כל רישום נקשר לאינדקס הזה ולא ל-absorbCurIdx של הרגע.
  const myIdx = absorbCurIdx;
  // ריפוד אפסים (1/3): מקור אחד לכל השלושה — חיפוש, מילוי במודאל, אימות בגריד.
  const identity = task.idType === 'tz' ? padId9(task.identity) : String(task.identity).trim();
  const mk = (status, detail, action) => makeAbsorbResult(task, status, detail, action);

  log(`▶ סניף ${task.branch} · סוג ${task.studyType} · ${maskId(identity)} · ${task.idType === 'passport' ? 'דרכון' : 'ת.ז.'}`);
  checkStop('start', gen);

  // נחתנו כבר בדף תלמיד-חדש (resume אחרי ניווט מלא מ-LinkButton1) — לשם ישר.
  if (getPage().kind === 'newStudent') {
    if (absorbNewStudentPageMatches(identity)) return await absorbHandleNewStudentPage(task, identity, mk, gen, myIdx);
    log('[תלמיד חדש] הדף שייך למזהה אחר — יוצאים ממנו');
    const nav = await absorbNavigateToBranch(String(task.branch).padStart(2, '0'));
    if (!nav.ok) return mk(ABSORB_STATUS.ERROR, nav.reason, ABSORB_NAV_FAIL_ACTION);
    return ABSORB_NAVIGATED;
  }

  // דרישות מוקדמות לדרכון — נבדקות לפני כל postback.
  if (task.idType === 'passport') {
    if (!task.birthDate) return mk(ABSORB_STATUS.ERROR, 'דרכון ללא תאריך לידה', 'הוסף עמודת "תאריך לידה" (DD/MM/YYYY) לשורה זו');
    if (!task.countryValue) return mk(ABSORB_STATUS.ERROR, `ארץ דרכון חסרה/לא מוכרת: "${task.country || 'ריק'}"`, 'תקן את עמודת "ארץ" לשם ארץ מהרשימה');
  }

  // ── שלב 1: הדף הנכון ──────────────────────────────────────────────────────
  const nav = await absorbEnsureStudyTypePage(task, gen);
  if (!nav.ok) return mk(ABSORB_STATUS.ERROR, nav.reason, nav.action || 'בדוק שסוג הלימוד קיים בסניף (ושאינו "סגור"), או בצע ידנית');
  if (nav.navigated) return ABSORB_NAVIGATED; // רק אחרי שיש עדות שהניווט באמת התחיל (C1)
  checkStop('after-nav', gen);
  absorbActivateStudentsTab();
  await sleepCheckStop(300, gen);

  // ── שלב 2: חיפוש מקדים + analyzeGrid ─────────────────────────────────────
  const searchInput = $el(ABSORB_IDS.searchInput);
  const searchBtn = $el(ABSORB_IDS.searchBtn);
  if (!searchInput || !searchBtn) {
    return mk(ABSORB_STATUS.ERROR, 'שדה/כפתור החיפוש ברשימת התלמידים לא נמצאו', 'פתח את הטאב "רשימת תלמידים" ורענן; ייתכן שאין הרשאה');
  }
  const pre = await absorbSearch(searchInput, searchBtn, identity, gen); // ריפוד (2/3)
  // C4: בלי עדות שהחיפוש רץ אסור לקרוא את הגריד — גריד ישן היה נקרא כ"כבר קיים".
  if (!pre.executed) return mk(ABSORB_STATUS.ERROR, absorbSearchFailReason(pre), ABSORB_SEARCH_FAILED_ACTION);

  const preGrid = analyzeGrid(readAbsorbGridRows(), identity, pre.count); // #4: תווית הספירה היא השער
  if (preGrid.found) {
    const viaFallback = preGrid.matchType === 'single-row-fallback' ? 'התאמה לפי שורה יחידה בגריד' : '';
    if (absorbJustSavedNewStudent && absorbNormalizeId(absorbJustSavedNewStudent) === absorbNormalizeId(identity)) {
      absorbJustSavedNewStudent = null;
      log('[תלמיד חדש] נמצא בגריד אחרי השמירה → נקלט');
      return mk(ABSORB_STATUS.OK_NEW, viaFallback, '');
    }
    log('[קליטה] כבר קיים בסוג הלימוד');
    return mk(ABSORB_STATUS.EXISTS, viaFallback, '');
  }
  absorbJustSavedNewStudent = null;
  checkStop('after-precheck', gen);

  // ── שלב 3: כפתור "קליטה" + הודעת מערכת ───────────────────────────────────
  const absorbBtn = $el(ABSORB_IDS.absorbBtn);
  if (!absorbBtn) {
    return mk(ABSORB_STATUS.ERROR, `כפתור "קליטה" (${ABSORB_IDS.absorbBtn}) לא נמצא`, 'בדוק הרשאות ומצב זכאות של סוג הלימוד; בצע ידנית');
  }
  const absorbClick = await absorbFireElement(absorbBtn, { startTimeoutMs: 3000, totalTimeoutMs: 20000 });
  if (!absorbClick.ok) log(`[קליטה] postback לא תקין: ${absorbClick.reason}`);
  await sleepCheckStop(400, gen);

  let popupDetail = '';
  const popAfterOpen = readMessagePopup();
  if (popAfterOpen) {
    popupDetail = popAfterOpen.text;
    log(`[הודעה] אחרי "קליטה": ${maskIdsInText(popAfterOpen.text)}`);
    await absorbHidePopup(gen);
    if (popAfterOpen.hasContinue) {
      return mk(`${ABSORB_STATUS.BLOCKED}: ${popAfterOpen.text}`, popAfterOpen.text,
        'המערכת מבקשת אישור "המשך" — הסקריפט לא מאשר לבד. בצע את הקליטה ידנית ובדוק את ההודעה');
    }
    await sleepCheckStop(300, gen);
  }
  checkStop('after-absorb-click', gen);

  // I2: משלב 4 והלאה מודאל הקליטה עשוי להיות פתוח. כל יציאה מכאן — תוצאת-שגיאה,
  // חריגה או עצירה — חייבת להשאיר את הדף נקי, אחרת התלמיד הבא מתחיל מול מודאל פתוח.
  try {
    // ── שלב 4: מודאל הקליטה — מילוי ────────────────────────────────────────
    let modalOpen = isVisible($el(ABSORB_IDS.modal));
    if (!modalOpen) {
      try {
        await waitFor(() => isVisible($el(ABSORB_IDS.modal)), { timeout: 4000, interval: 100 });
        modalOpen = true;
      } catch (e) {
        modalOpen = false;
      }
    }
    if (!modalOpen) {
      return mk(ABSORB_STATUS.ERROR, popupDetail || 'מודאל הקליטה לא נפתח',
        popupDetail ? 'המערכת החזירה הודעה במקום לפתוח את חלון הקליטה — טפל ידנית' : 'פתח את חלון הקליטה ידנית ובדוק הודעת מערכת');
    }

    const idTypeValue = task.idType === 'passport' ? '2' : '1'; // לכידה-01 §6
    const ddlType = $el(ABSORB_IDS.idTypeDdl);
    if (ddlType && ddlType.value !== idTypeValue) {
      absorbSetSelect(ddlType, idTypeValue);
      await waitPRM({ startTimeoutMs: 1200, totalTimeoutMs: 10000 }); // לכידה-02 §4: בפועל לא גורר postback
      await sleepCheckStop(200, gen);
    }

    const modalId = $el(ABSORB_IDS.modalId);
    if (!modalId) return mk(ABSORB_STATUS.ERROR, 'שדה המזהה במודאל הקליטה לא נמצא', 'בצע את הקליטה ידנית');
    absorbSetValue(modalId, identity); // ריפוד (3/3)
    await sleepCheckStop(150, gen);

    if (task.idType === 'passport') {
      const birthEl = $el(ABSORB_IDS.birthDate);
      if (!birthEl) return mk(ABSORB_STATUS.ERROR, 'שדה תאריך לידה במודאל לא נמצא', 'בצע את הקליטה ידנית');
      absorbSetValue(birthEl, task.birthDate);
      await sleepCheckStop(150, gen);

      const countryEl = $el(ABSORB_IDS.countryDdl);
      if (!countryEl) return mk(ABSORB_STATUS.ERROR, 'שדה ארץ דרכון במודאל לא נמצא', 'בצע את הקליטה ידנית');
      const options = Array.from(countryEl.options || []);
      if (!options.some((o) => o.value === task.countryValue)) {
        return mk(ABSORB_STATUS.ERROR, `הארץ "${task.country}" (קוד ${task.countryValue}) לא קיימת ברשימת האתר`, 'תקן את עמודת "ארץ" לשם ארץ מהרשימה');
      }
      absorbSetSelect(countryEl, task.countryValue);
      await sleepCheckStop(200, gen);
      if (countryEl.value !== task.countryValue) {
        return mk(ABSORB_STATUS.ERROR, `בחירת הארץ "${task.country}" נכשלה`, 'בחר את הארץ ידנית בחלון הקליטה');
      }
    }

    const startDate = absorbStartDate();
    if (startDate) {
      const startEl = $el(ABSORB_IDS.startDate);
      if (startEl && startEl.value !== startDate) absorbSetValue(startEl, startDate);
    }
    checkStop('after-fields', gen);

    // ── שלב 5: אישור (LinkButton1) ─────────────────────────────────────────
    const confirmBtn = $el(ABSORB_IDS.confirmBtn);
    if (!confirmBtn) return mk(ABSORB_STATUS.ERROR, 'כפתור אישור (LinkButton1) לא נמצא במודאל', 'בצע את הקליטה ידנית');
    const confirmPb = absorbParsePostbackFromHref(confirmBtn.getAttribute('href') || '');
    if (confirmPb && confirmPb.validate) {
      const v = absorbRunClientValidation(confirmPb.group);
      if (!v.ok) {
        return mk(ABSORB_STATUS.ERROR, 'ולידציה בחלון הקליטה: ' + (v.messages.join(' | ') || 'שדה לא תקין'), 'תקן את הנתונים בשורה (מזהה/תאריך/ארץ) והרץ שוב');
      }
    }

    saveAbsorbState(); // ייתכן ניווט מלא לדף תלמיד-חדש (לכידה-03) — מצב ההמשך נשמר לפני
    const confirmWait = absorbFireElement(confirmBtn, { startTimeoutMs: 3000, totalTimeoutMs: ABSORB_CONFIRM_BUDGET_MS });
    const outcome = await absorbWaitConfirmOutcome(confirmWait, ABSORB_CONFIRM_BUDGET_MS, gen);
    log(`[אישור] תוצאה: ${outcome.kind}`);

    // ── שלב 6: דף תלמיד-חדש? ───────────────────────────────────────────────
    if (outcome.kind === 'newStudent') {
      if (absorbNewStudentPageMatches(identity)) return await absorbHandleNewStudentPage(task, identity, mk, gen, myIdx);
      log('[תלמיד חדש] דף תלמיד-חדש עם מזהה אחר — יוצאים בלי לשמור');
      const res = mk(ABSORB_STATUS.ERROR, 'נחתנו בדף תלמיד-חדש שאינו של המזהה הזה', 'בדוק ידנית מה קרה בקליטה של שורה זו');
      absorbRecordResult(res, gen, myIdx);
      return await absorbLeaveNewStudentPage(task, res);
    }

    // ── שלב 7: הודעת מערכת → מודאל → אימות בגריד ───────────────────────────
    await sleepCheckStop(400, gen);
    const popAfterConfirm = readMessagePopup();
    if (popAfterConfirm) {
      log(`[הודעה] אחרי אישור: ${maskIdsInText(popAfterConfirm.text)}`);
      await absorbHidePopup(gen);
      if (popAfterConfirm.hasContinue) {
        return mk(`${ABSORB_STATUS.BLOCKED}: ${popAfterConfirm.text}`, popAfterConfirm.text,
          'המערכת מבקשת אישור "המשך" (למשל מעבר בין מוסדות) — הסקריפט לא מאשר לבד. השלם ידנית');
      }
      popupDetail = popAfterConfirm.text;
      await sleepCheckStop(300, gen);
    }

    if (isVisible($el(ABSORB_IDS.modal))) {
      const errs = absorbCollectValidationMessages();
      return mk(ABSORB_STATUS.NOT_COMPLETED, errs.join(' | ') || popupDetail || 'חלון הקליטה נשאר פתוח',
        'פתח את חלון הקליטה ידנית, בדוק את הודעת השגיאה והשלם');
    }
    checkStop('before-verify', gen);

    const verifyInput = $el(ABSORB_IDS.searchInput);
    const verifyBtn = $el(ABSORB_IDS.searchBtn);
    if (!verifyInput || !verifyBtn) {
      return mk(ABSORB_STATUS.SAVED_UNVERIFIED, popupDetail || 'שדות החיפוש נעלמו אחרי הקליטה', 'ודא ידנית ברשימת התלמידים שהתלמיד נקלט');
    }
    const verifySearch = await absorbSearch(verifyInput, verifyBtn, identity, gen); // ריפוד באימות
    if (!verifySearch.executed) {
      // C4 (הכיוון ההפוך): בלי חיפוש שרץ, גריד ישן היה נקרא כאישור קליטה.
      return mk(ABSORB_STATUS.SAVED_UNVERIFIED, absorbSearchFailReason(verifySearch), ABSORB_SEARCH_FAILED_ACTION);
    }
    const verify = analyzeGrid(readAbsorbGridRows(), identity, verifySearch.count);
    if (verify.found) {
      log('◀ נקלט');
      return mk(ABSORB_STATUS.OK, popupDetail || (verify.matchType === 'single-row-fallback' ? 'התאמה לפי שורה יחידה בגריד' : ''), '');
    }
    log('◀ לא אומת בגריד');
    return mk(ABSORB_STATUS.UNVERIFIED, popupDetail || 'לא נמצא בגריד אחרי הקליטה', 'בדוק ידנית ברשימת התלמידים; ייתכן שהקליטה נכשלה');
  } finally {
    // I2: המודאל אף פעם לא נשאר פתוח לתלמיד הבא — גם ביציאת-שגיאה וגם בחריגה.
    // ‏#3: אבל ניסיון שכבר בוטל (timeout+retry) לא נוגע בדף בכלל — המודאל שהוא רואה
    // עשוי להיות של הניסיון הפעיל, ולחיצת LinkButton2 שלו הייתה יורה לתוכו.
    try {
      if (typeof gen === 'number' && gen !== absorbCurrentGeneration()) {
        log('[מודאל] ניסיון שבוטל — לא נוגעים בדף');
      } else if (isVisible($el(ABSORB_IDS.modal))) {
        await absorbCloseAcceptModal();
      }
    } catch (e) { /* אצווה לא נתקעת */ }
  }
}

// ─── עטיפה בטוחה: timeout + ניסיון חוזר אחד ─────────────────────────────────

function absorbWithTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    // M1: ה-interval חייב להתנקות גם בענף ה-timeout, אחרת נשאר poller חי לכל תלמיד.
    const clearAll = () => { clearTimeout(timer); clearInterval(stopPoller); };
    const timer = setTimeout(() => {
      clearAll();
      reject(new Error(`תהליך תקוע — חרג מ-${Math.round(ms / 1000)} שניות`));
    }, ms);
    const stopPoller = setInterval(() => {
      if (absorbIsStopped()) { clearAll(); reject(absorbStopError('timeout-poller')); }
    }, 200);
    promise.then(
      (val) => { clearAll(); resolve(val); },
      (err) => { clearAll(); reject(err); }
    );
  });
}

async function processStudentSafe(task) {
  const errResult = (detail) => makeAbsorbResult(task, ABSORB_STATUS.ERROR, detail,
    'בצע את השורה הזו ידנית באתר, וצרף את הלוג אם חוזר');
  const myIdx = absorbCurIdx; // #5: השורה שהעטיפה הזו אחראית לה

  try {
    // C3: כל ניסיון מקבל דור משלו. כשמתחיל ניסיון 2, הדור של ניסיון 1 כבר לא הנוכחי
    // והוא מת בגבול-השלב הבא — במקום לירות postback לתוך דף שניסיון 2 מנהל.
    return await absorbWithTimeout(processStudent(task, absorbNextGeneration()), ABSORB_STUDENT_TIMEOUT_MS);
  } catch (err) {
    if (isAbsorbStopError(err)) throw err;
    absorbNextGeneration(); // הורג את הניסיון היתום *לפני* שאנחנו נוגעים בדף בעצמנו
    // M-b: מבחינים בין ניסיון שבוטל (דור חדש — עצירה/ריצה חדשה) לבין כשל אמיתי.
    log(`[ניסיון 1] ${isAbsorbCancelError(err) ? 'בוטל' : 'נכשל'}: ${err && err.message}`);
    await absorbCloseAcceptModal();
    if (absorbIsStopped()) throw absorbStopError('between-attempts');
    // #5: אם התוצאה לשורה הזו כבר נרשמה (למשל תלמיד-חדש שנרשם לפני הניווט חזרה,
    // וה-timeout תפס אותנו בתוך הניווט) — אסור להריץ אותה שוב: זה היה רושם שורה
    // שנייה, מקדם את הסמן פעמיים ומדלג בשקט על התלמיד הבא.
    if (!absorbShouldRecord(absorbLastRecordedIdx, myIdx)) {
      log('[ניסיון 2] לא נדרש — התוצאה לשורה הזו כבר נרשמה');
      return ABSORB_CONTINUE;
    }
    try {
      await sleep(1000);
      log(`[ניסיון 2] ${maskId(task.identity)}`);
      return await absorbWithTimeout(processStudent(task, absorbNextGeneration()), ABSORB_STUDENT_TIMEOUT_MS);
    } catch (err2) {
      if (isAbsorbStopError(err2)) throw err2;
      log(`[ניסיון 2] ${isAbsorbCancelError(err2) ? 'בוטל' : 'נכשל'}: ${err2 && err2.message} — מדלגים`);
      await absorbCloseAcceptModal();
      if (!absorbShouldRecord(absorbLastRecordedIdx, myIdx)) return ABSORB_CONTINUE;
      return errResult(`2 ניסיונות: ${err2 && err2.message}`);
    }
  }
}

// ─── התור ────────────────────────────────────────────────────────────────────

// #5: רישום תוצאה לשורה `idx` (ברירת מחדל: השורה הנוכחית). מחזיר false — בלי לגעת
// בסמן ובתוצאות — כשהשורה כבר נרשמה (ניסיון שני אחרי timeout) או כשהקורא הוא ניסיון
// שכבר בוטל. בלי זה שורה נרשמה פעמיים, הסמן קפץ פעמיים, והתלמיד הבא נעלם בשקט.
function absorbRecordResult(result, gen, idx) {
  const at = typeof idx === 'number' ? idx : absorbCurIdx;
  if (typeof gen === 'number' && gen !== absorbCurrentGeneration()) {
    log('[תוצאה] ניסיון שבוטל ניסה לרשום תוצאה — מתעלמים');
    return false;
  }
  if (!absorbShouldRecord(absorbLastRecordedIdx, at)) {
    log(`[תוצאה] לשורה ${at + 1} כבר נרשמה תוצאה — לא רושמים פעמיים`);
    return false;
  }
  absorbLastRecordedIdx = at;
  absorbResults.push(result);
  absorbCurIdx = Math.max(absorbCurIdx, at + 1);
  saveAbsorbState();
  try { if (absorbHooks.onResult) absorbHooks.onResult(result, absorbResults); } catch (e) { /* אצווה לא נתקעת */ }
  return true;
}

function absorbFillRemaining(status, detail, action) {
  while (absorbCurIdx < absorbQueue.length) {
    absorbResults.push(makeAbsorbResult(absorbQueue[absorbCurIdx], status, detail, action));
    absorbCurIdx++;
  }
  absorbLastRecordedIdx = absorbCurIdx - 1; // #5: הסמן והשמירה-מפני-כפילות תמיד יחד
  saveAbsorbState();
}

function absorbFinishRun() {
  absorbRunning = false;
  clearAbsorbState();
  clearAbsorbStop();
  const report = buildRemainingReport(absorbResults);
  log(`═══ סיום · ${report.summary}`);
  try { if (absorbHooks.onDone) absorbHooks.onDone(absorbResults, report); } catch (e) { /* אצווה לא נתקעת */ }
}

async function runQueue() {
  absorbRunning = true;
  absorbWatchUnload(); // C1: עדות לניווט מלא (הדף מתחיל להיפרק)
  log(`🚀 ריצה — ${absorbQueue.length} תלמידים, מתחילים באינדקס ${absorbCurIdx}`);
  try { if (absorbHooks.onStart) absorbHooks.onStart(absorbQueue, absorbCurIdx); } catch (e) { /* noop */ }

  while (absorbCurIdx < absorbQueue.length) {
    if (absorbIsStopped()) {
      log('⛔ נעצר — ממלאים את שארית התור');
      absorbFillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
      break;
    }
    const taskIdx = absorbCurIdx; // #5: הסמן עשוי להתקדם בתוך processStudentSafe
    const task = absorbQueue[taskIdx];
    try { if (absorbHooks.onProgress) absorbHooks.onProgress(taskIdx, absorbQueue.length, task); } catch (e) { /* noop */ }

    let result;
    try {
      result = await processStudentSafe(task);
    } catch (stopErr) {
      log(`⛔ נעצר באמצע עיבוד: ${stopErr && stopErr.message}`);
      absorbRecordResult(makeAbsorbResult(task, ABSORB_STATUS.STOPPED, 'נעצר באמצע עיבוד',
        'בדוק את מצב התלמיד באתר והרץ שוב את השורה'), null, taskIdx);
      absorbFillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
      break;
    }

    if (result === ABSORB_NAVIGATED || (result && result.__navigated)) {
      absorbRunning = false;
      log('… ניווט מלא — ההמשך יקרה אחרי טעינת הדף');
      return;
    }
    // התוצאה כבר נרשמה בתוך processStudent (והניווט חזרה נכשל) — ממשיכים בלי לרשום שוב.
    if (result === ABSORB_CONTINUE || (result && result.__continue)) {
      // רשת-ביטחון ("אצווה לא נתקעת"): אם משום מה לא נרשמה תוצאה לשורה הזו, רושמים
      // אחת עכשיו — אחרת הסמן לא מתקדם והלולאה רצה על אותה שורה לנצח.
      if (absorbCurIdx <= taskIdx) {
        absorbRecordResult(makeAbsorbResult(task, ABSORB_STATUS.ERROR, 'לא נרשמה תוצאה לשורה הזו',
          'בצע את השורה הזו ידנית באתר, וצרף את הלוג'), null, taskIdx);
      }
      await sleep(300);
      continue;
    }
    // #5: אם השורה הזו כבר נרשמה (ניסיון קודם) — absorbRecordResult מדלג, והלולאה
    // ממשיכה לשורה הבאה לפי הסמן שכבר התקדם, בלי רישום כפול ובלי דילוג שקט.
    absorbRecordResult(result, null, taskIdx);
    await sleep(300);
  }

  absorbFinishRun();
}

// מתחיל ריצה חדשה מרשימת משימות (Task מ-parseAbsorbInput).
async function absorbStartRun(tasks) {
  clearAbsorbStop();
  absorbNextGeneration(); // C3: כל שריד של ריצה קודמת מת כאן
  // C2: מצב-הניווט השמור (currentBranch) שייך לריצה הקודמת. בדף סוג-לימוד אין מספר
  // סניף בדף עצמו, ולכן סניף ישן + קוד סוג-לימוד שמשותף לכמה סניפים = קליטה לסניף הלא
  // נכון. מנקים, כך שהמשימה הראשונה תקבע את הסניף דרך gotoBranch.
  clearNavState();
  absorbQueue = Array.isArray(tasks) ? tasks.slice() : [];
  absorbResults = [];
  absorbCurIdx = 0;
  absorbLastRecordedIdx = -1;
  absorbStartedAt = new Date().toISOString();
  absorbJustSavedNewStudent = null;
  saveAbsorbState();
  return runQueue();
}

function absorbHasSavedQueue() {
  const st = loadAbsorbState();
  return !!(st && Array.isArray(st.queue) && st.queue.length && (st.curIdx || 0) < st.queue.length);
}

// מידע לפאנל על תור שמור שלא הופעל אוטומטית (M5) — בלי לגעת במצב.
function absorbSavedQueueInfo() {
  const st = loadAbsorbState();
  if (!st || !Array.isArray(st.queue) || !st.queue.length) return null;
  return {
    total: st.queue.length,
    curIdx: st.curIdx || 0,
    startedAt: st.startedAt || null,
    stale: absorbQueueIsStale(st.startedAt, Date.now(), ABSORB_MAX_QUEUE_AGE_MS),
  };
}

// זריקת תור שמור (כפתור "נקה" בפאנל) — בלי שום פעולה באתר.
function absorbDiscardSavedQueue() {
  absorbNextGeneration();
  absorbQueue = [];
  absorbResults = [];
  absorbCurIdx = 0;
  absorbLastRecordedIdx = -1;
  absorbStartedAt = null;
  absorbRunning = false;
  absorbJustSavedNewStudent = null;
  clearAbsorbState();
  clearAbsorbStop();
  log('[resume] התור השמור נמחק לבקשת המשתמש');
  return true;
}

// נקרא בטעינת דף: אם יש תור שמור — ממשיכים ממנו.
// M5: תור ישן מ-ABSORB_MAX_QUEUE_AGE_MS לא ממשיך מעצמו — הפאנל מציג "המשך"/"נקה"
// והמשתמש מכריע (`{ allowStale: true }` = הוא לחץ "המשך").
async function absorbResumeIfPending(opts) {
  if (absorbRunning) return false; // M-a: ריצה כבר מתנהלת — אין resume מקביל
  const allowStale = !!(opts && opts.allowStale);
  const st = loadAbsorbState();
  if (!st || !Array.isArray(st.queue) || !st.queue.length) return false;

  if (absorbIsStopped()) {
    log('[resume] דגל עצירה — מנקים מצב');
    clearAbsorbState();
    clearAbsorbStop();
    return false;
  }

  if (!allowStale && absorbQueueIsStale(st.startedAt, Date.now(), ABSORB_MAX_QUEUE_AGE_MS)) {
    const info = { total: st.queue.length, curIdx: st.curIdx || 0, startedAt: st.startedAt || null, stale: true };
    log(`[resume] תור שמור מ-${st.startedAt} ישן מ-${Math.round(ABSORB_MAX_QUEUE_AGE_MS / 60000)} דקות — לא ממשיכים אוטומטית`);
    try { if (absorbHooks.onStaleQueue) absorbHooks.onStaleQueue(info); } catch (e) { /* אצווה לא נתקעת */ }
    return false;
  }

  absorbQueue = st.queue;
  absorbResults = Array.isArray(st.results) ? st.results : [];
  absorbCurIdx = st.curIdx || 0;
  absorbLastRecordedIdx = absorbCurIdx - 1; // #5: כל מה שלפני הסמן כבר נרשם
  absorbStartedAt = st.startedAt || null;

  if (absorbCurIdx >= absorbQueue.length) {
    absorbFinishRun();
    return false;
  }

  if (st.pendingSave && st.pendingSave.idx === absorbCurIdx) {
    absorbJustSavedNewStudent = st.pendingSave.identity;
    log('[resume] תלמיד חדש נשמר לפני הניווט — נאמת בגריד');
    saveAbsorbState(); // מנקה את הסימון
  }

  const attempts = absorbBumpAttempts(absorbCurIdx);
  log(`[resume] אינדקס ${absorbCurIdx}/${absorbQueue.length} · ניסיון טעינה ${attempts} · דף ${getPage().kind}`);
  if (attempts >= ABSORB_MAX_RESUME_ATTEMPTS) {
    const stuck = absorbQueue[absorbCurIdx];
    log(`⚠️ תלמיד ${maskId(stuck.identity)} תקוע אחרי ${attempts} טעינות — מדלגים`);
    absorbRecordResult(makeAbsorbResult(stuck, ABSORB_STATUS.SKIPPED,
      `לולאת ניווט — ${attempts} טעינות דף ללא התקדמות`,
      'נווט ידנית לסניף/סוג הלימוד ובצע את השורה הזו ידנית'));
    try { sessionStorage.removeItem(ABSORB_ATTEMPT_KEY); } catch (e) { /* noop */ }
    if (absorbCurIdx >= absorbQueue.length) { absorbFinishRun(); return false; }
  }

  try { if (absorbHooks.onResume) absorbHooks.onResume(absorbQueue, absorbResults, absorbCurIdx); } catch (e) { /* noop */ }
  // M4: מסמנים "רץ" *לפני* ההמתנה — אחרת לחיצה על "התחל" בשנייה הזו הייתה פותחת
  // ריצה שנייה במקביל (absorbIsRunning() החזיר false).
  absorbRunning = true;
  try {
    await sleep(1200); // נותנים לדף להתייצב (MS AJAX מסיים לאתחל)
    await runQueue();
  } catch (e) {
    absorbRunning = false;
    throw e;
  }
  return true;
}

// עצירה יזומה (כפתור / Escape). כשלא רצים — מנקה מצב שמור ומסיימת.
function absorbStop() {
  requestAbsorbStop();
  absorbNextGeneration(); // C3: גם ניסיון יתום שעדיין רץ מת כאן
  if (!absorbRunning) {
    if (absorbQueue.length && absorbCurIdx < absorbQueue.length) {
      absorbFillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
      absorbFinishRun();
    } else {
      clearAbsorbState();
      clearAbsorbStop();
    }
  }
}

// פאנל קליטת תלמידים v3.3 — פורט מהפאנל של v3.2 (createUI:764, init:903) עם תוספות:
// תצוגת שגיאות-פרסור לפני ריצה, "העתק לאקסל" (TSV), "תבנית לאקסל", דוח "מה נשאר" בסיום,
// עצירה בכפתור וב-Escape, ו-resume אוטומטי אחרי ניווט מלא.
// אין גישה ל-document/window ברמת המודול — init רץ רק כשיש document (בסוף הקובץ).


const PANEL_VERSION = '3.3';
let panelAwaitingErrorConfirm = false;
let panelResults = [];
let panelTotal = 0;

function panelEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function panelToday() {
  const d = new Date();
  return [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('/');
}

function panelSetStatus(msg) {
  const el = $el('tma-status');
  if (el) el.textContent = msg;
}

function panelSetProgress(cur, total) {
  const el = $el('tma-progress');
  if (el) el.textContent = `${cur} / ${total}`;
}

function panelSetRunning(on) {
  const start = $el('tma-start');
  if (start) start.disabled = !!on;
}

function panelFlash(id, tempText, backText) {
  const btn = $el(id);
  if (!btn) return;
  btn.textContent = tempText;
  setTimeout(() => { const b = $el(id); if (b) b.textContent = backText; }, 2000);
}

// ─── רינדור ─────────────────────────────────────────────────────────────────

function panelRenderErrors(errors, validCount) {
  const box = $el('tma-errors');
  if (!box) return;
  if (!errors || !errors.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  let html = `<div style="font-weight:bold;margin-bottom:4px">⚠️ ${errors.length} שורות לא יורצו (${validCount} תקינות):</div>`;
  html += '<ul style="margin:0;padding-inline-start:18px">';
  for (const e of errors.slice(0, 25)) {
    html += `<li>שורה ${panelEsc(e.line)}: ${panelEsc(e.reason)}</li>`;
  }
  if (errors.length > 25) html += `<li>… ועוד ${errors.length - 25}</li>`;
  html += '</ul>';
  box.innerHTML = html;
  box.style.display = 'block';
}

// המזהה המלא מוצג בטבלה ובדוח (צורך תפעולי) — בלוג הוא תמיד ממוסך.
function panelRenderResults() {
  const container = $el('tma-results');
  if (!container) return;
  if (!panelResults.length) { container.innerHTML = ''; return; }
  let html = '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += `<tr style="background:#0a5c0a;color:#fff;text-align:center">
    <th style="padding:3px 6px">סניף</th><th style="padding:3px 6px">סוג</th>
    <th style="padding:3px 6px">ת.ז./דרכון</th><th style="padding:3px 6px">סטטוס</th></tr>`;
  for (const r of panelResults) {
    const status = r.status || '';
    const key = absorbStatusKey(status);
    const ok = isAbsorbSuccess(status);
    const stopped = key === 'נעצר' || key === 'דולג';
    const color = ok ? '#0a5c0a' : stopped ? '#a67c00' : '#a00';
    const bg = ok ? '#f0fff0' : stopped ? '#fffbe6' : '#fff5f5';
    const title = r.detail ? ` title="${panelEsc(r.detail)}"` : '';
    html += `<tr style="border-bottom:1px solid #eee;background:${bg}"${title}>
      <td style="padding:2px 6px;text-align:center">${panelEsc(r.branch)}</td>
      <td style="padding:2px 6px;text-align:center">${panelEsc(r.studyType)}</td>
      <td style="padding:2px 6px;direction:ltr;font-family:monospace;font-size:11px">${panelEsc(r.identity)}</td>
      <td style="padding:2px 6px;color:${color};font-weight:bold;font-size:11px">${panelEsc(status)}</td></tr>`;
  }
  html += '</table>';
  container.innerHTML = html;
}

// M5: תור שמור ישן לא ממשיך מעצמו — מציגים אותו עם "המשך"/"נקה", בלי שום פעולה אוטומטית.
function panelRenderStaleQueue(info) {
  const box = $el('tma-stale');
  if (!box) return;
  if (!info) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const left = Math.max(0, (info.total || 0) - (info.curIdx || 0));
  const startedMs = Date.parse(info.startedAt);
  const ageMin = Number.isNaN(startedMs) ? null : Math.round((Date.now() - startedMs) / 60000);
  box.innerHTML = `
    <div style="font-weight:bold;margin-bottom:4px">⏸ נמצא תור שמור${ageMin === null ? '' : ` מלפני ${panelEsc(ageMin)} דקות`}</div>
    <div style="margin-bottom:6px">${panelEsc(left)} שורות טרם עובדו (${panelEsc(info.curIdx || 0)} מתוך ${panelEsc(info.total || 0)} הושלמו).
      התור ישן מדי כדי להמשיך אוטומטית — בחר מה לעשות.</div>
    <div style="display:flex;gap:6px">
      <button id="tma-stale-go" style="flex:1;background:#0a5c0a;color:#fff;border:none;
              padding:5px;border-radius:4px;cursor:pointer;font-size:12px">▶ המשך</button>
      <button id="tma-stale-clear" style="flex:1;background:#922b21;color:#fff;border:none;
              padding:5px;border-radius:4px;cursor:pointer;font-size:12px">🗑 נקה</button>
    </div>`;
  box.style.display = 'block';
  const go = $el('tma-stale-go');
  if (go) {
    go.addEventListener('click', () => {
      panelRenderStaleQueue(null);
      panelSetStatus('ממשיך את התור השמור…');
      panelSetRunning(true);
      Promise.resolve()
        .then(() => absorbResumeIfPending({ allowStale: true }))
        .catch((e) => { log('[resume] כשל: ' + (e && e.message)); panelSetRunning(false); });
    });
  }
  const clear = $el('tma-stale-clear');
  if (clear) {
    clear.addEventListener('click', () => {
      absorbDiscardSavedQueue();
      panelRenderStaleQueue(null);
      panelSetRunning(false);
      panelSetStatus('התור השמור נמחק — אפשר להתחיל ריצה חדשה');
    });
  }
}

function panelRenderReport(report) {
  const box = $el('tma-report');
  if (!box) return;
  if (!report) { box.style.display = 'none'; box.innerHTML = ''; return; }
  let html = `<div style="font-weight:bold;margin-bottom:4px">📊 סיכום: ${panelEsc(report.summary || '—')}</div>`;
  if (report.lines.length) {
    html += '<div style="font-weight:bold;margin:6px 0 3px">מה נשאר לעשות:</div><ul style="margin:0;padding-inline-start:18px">';
    for (const line of report.lines) html += `<li style="margin-bottom:2px">${panelEsc(line)}</li>`;
    html += '</ul>';
  } else {
    html += '<div>הכול טופל — אין שורות שדורשות טיפול ✓</div>';
  }
  box.innerHTML = html;
  box.style.display = 'block';
}

// ─── פעולות ─────────────────────────────────────────────────────────────────

async function panelStart() {
  if (absorbIsRunning()) return;
  const input = $el('tma-input');
  const text = ((input && input.value) || '').trim();
  if (!text) { panelSetStatus('הדבק רשימת תלמידים (אפשר להעתיק טורים ישירות מאקסל)'); return; }

  const parsed = parseAbsorbInput(text);
  if (parsed.errors.length && !panelAwaitingErrorConfirm) {
    panelRenderErrors(parsed.errors, parsed.tasks.length);
    panelAwaitingErrorConfirm = true;
    const btn = $el('tma-start');
    if (btn) btn.textContent = parsed.tasks.length ? `▶ המשך בכל זאת (${parsed.tasks.length})` : '▶ התחל';
    panelSetStatus(`${parsed.errors.length} שורות בעייתיות — תקן, או לחץ שוב כדי להריץ רק את התקינות`);
    log(`[פרסור] ${parsed.tasks.length} תקינות · ${parsed.errors.length} שגויות`);
    return;
  }

  if (!parsed.tasks.length) {
    panelRenderErrors(parsed.errors, 0);
    panelSetStatus('אין שורות תקינות להרצה');
    return;
  }

  panelAwaitingErrorConfirm = false;
  const btn = $el('tma-start');
  if (btn) btn.textContent = '▶ התחל';
  panelRenderReport(null);
  panelRenderStaleQueue(null);
  panelResults = [];
  panelRenderResults();
  clearAbsorbStop();
  panelSetRunning(true);
  panelSetProgress(0, parsed.tasks.length);
  panelSetStatus(`מריץ ${parsed.tasks.length} תלמידים…`);
  log(`[התחלה] ${parsed.tasks.length} תלמידים · תאריך תחילת לימודים "${panelStartDate() || '(ברירת מחדל של האתר)'}"`);
  await absorbStartRun(parsed.tasks);
}

function panelStartDate() {
  const el = $el('tma-start-date');
  return el ? String(el.value || '').trim() : '';
}

function panelCopyTsv() {
  const results = absorbGetResults();
  const rows = results.length ? results : panelResults;
  if (!rows.length) { panelSetStatus('אין תוצאות להעתקה'); return; }
  copyTextToClipboard(buildResultsTsv(rows)).then((ok) => {
    panelFlash('tma-tsv', ok ? '✓ הועתק' : '✗ העתקה נכשלה', '📋 העתק לאקסל');
    panelSetStatus(ok ? 'התוצאות הועתקו — הדבק באקסל (Ctrl+V)' : 'ההעתקה נחסמה בדפדפן; השתמש בייצוא CSV');
  });
}

function panelExportCsv() {
  const results = absorbGetResults();
  const rows = results.length ? results : panelResults;
  if (!rows.length) { panelSetStatus('אין תוצאות לייצוא'); return; }
  const name = `absorptions_${new Date().toISOString().slice(0, 10)}.csv`;
  const ok = downloadCsv(name, buildResultsCsvRows(rows));
  panelSetStatus(ok ? `הורד ${name}` : 'הייצוא נכשל');
  log('[CSV] ייצוא תוצאות');
}

function panelDownloadTemplate() {
  const ok = downloadCsv('תבנית-קליטת-תלמידים.csv', [ABSORB_TEMPLATE_HEADER.slice()]);
  panelSetStatus(ok ? 'הורדה תבנית לאקסל — מלא ושמור, ואז העתק את הטורים לכאן' : 'הורדת התבנית נכשלה');
  log('[תבנית] הורדה');
}

function panelHandleStop() {
  panelSetStatus('עוצר…');
  log('⛔ עצירה לבקשת המשתמש');
  absorbStop();
  panelSetRunning(false);
}

// ─── בניית הפאנל (נראות v3.2) ───────────────────────────────────────────────

function panelCreateUI() {
  if ($el('tma-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'tma-panel';
  panel.style.cssText = `
    position:fixed;top:60px;right:10px;z-index:99999;
    background:#fff;border:2px solid #0a5c0a;border-radius:8px;
    width:440px;font-family:Arial,sans-serif;font-size:13px;
    direction:rtl;box-shadow:0 4px 20px rgba(0,0,0,.35);`;
  panel.innerHTML = `
    <div id="tma-header" style="background:#0a5c0a;color:#fff;padding:8px 12px;
         border-radius:6px 6px 0 0;cursor:move;display:flex;justify-content:space-between;align-items:center;user-select:none">
      <span style="font-weight:bold;font-size:14px">📥 קליטת תלמידים v${PANEL_VERSION}</span>
      <span id="tma-progress" style="font-size:11px;opacity:.8">0 / 0</span>
      <span id="tma-toggle" style="cursor:pointer;font-size:16px;line-height:1;padding:0 4px">▲</span>
    </div>
    <div id="tma-body" style="padding:10px">
      <div id="tma-status" style="color:#555;font-size:11px;margin-bottom:8px;
           padding:4px 8px;background:#f0f8f0;border-radius:4px">מוכן</div>
      <div style="font-size:10px;color:#777;margin-bottom:5px;
           background:#f9f9f9;padding:5px 7px;border-radius:3px;border:1px solid #e0e0e0;line-height:1.7">
        <b>טורים מאקסל</b> (טאבים או פסיקים, עם שורת כותרת או בלי):<br>
        <code style="direction:ltr;display:inline-block">סניף | סוג לימוד | ת.ז./דרכון | שם פרטי | שם משפחה | תאריך לידה | ארץ | מגדר | מצב משפחתי</code><br>
        <span style="color:#aaa">חובה: 3 הראשונים. דרכון — גם תאריך לידה + ארץ. תלמיד חדש — גם שם פרטי, שם משפחה ות.לידה.</span>
      </div>
      <textarea id="tma-input"
        placeholder="01&#9;300&#9;123456789&#10;12&#9;600&#9;AB1234567&#9;&#9;&#9;15/03/1995&#9;צרפת"
        style="width:100%;height:100px;box-sizing:border-box;font-size:12px;
               padding:5px;direction:ltr;resize:vertical;
               border:1px solid #aaa;border-radius:4px;font-family:monospace"></textarea>
      <div id="tma-errors" style="display:none;font-size:11px;color:#8a1f11;background:#fff5f5;
           border:1px solid #f0c0c0;border-radius:4px;padding:5px 7px;margin:6px 0;max-height:110px;overflow-y:auto"></div>
      <div id="tma-stale" style="display:none;font-size:11px;color:#5a4a00;background:#fffbe6;
           border:1px solid #e8d9a0;border-radius:4px;padding:6px 8px;margin:6px 0"></div>
      <div style="display:flex;gap:8px;margin:6px 0;align-items:flex-end">
        <div style="flex:1">
          <label style="font-size:11px;color:#444;display:block;margin-bottom:2px">
            📅 תאריך תחילת לימודים (ריק = ברירת המחדל של האתר)
          </label>
          <input id="tma-start-date" type="text" placeholder="${panelToday()}"
            style="width:100%;box-sizing:border-box;font-size:12px;padding:4px;
                   border:1px solid #aaa;border-radius:4px;direction:ltr;font-family:monospace"
            maxlength="10">
        </div>
      </div>
      <div style="display:flex;gap:6px;margin:6px 0">
        <button id="tma-start" style="flex:2;background:#0a5c0a;color:#fff;border:none;
                padding:8px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px">
          ▶ התחל</button>
        <button id="tma-stop" style="flex:1;background:#922b21;color:#fff;border:none;
                padding:8px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:bold">
          ⏹ עצור</button>
      </div>
      <div style="display:flex;gap:6px;margin:6px 0">
        <button id="tma-tsv" style="flex:1;background:#1f618d;color:#fff;border:none;
                padding:6px;border-radius:4px;cursor:pointer;font-size:12px">📋 העתק לאקסל</button>
        <button id="tma-csv" style="flex:1;background:#117a65;color:#fff;border:none;
                padding:6px;border-radius:4px;cursor:pointer;font-size:12px">💾 ייצוא CSV</button>
        <button id="tma-template" style="flex:1;background:#6c3483;color:#fff;border:none;
                padding:6px;border-radius:4px;cursor:pointer;font-size:12px">📄 תבנית לאקסל</button>
      </div>
      <div id="tma-results" style="max-height:170px;overflow-y:auto;margin-bottom:6px;
           border:1px solid #ddd;border-radius:4px;min-height:10px"></div>
      <div id="tma-report" style="display:none;font-size:11px;color:#333;background:#fffdf5;
           border:1px solid #e8d9a0;border-radius:4px;padding:6px 8px;margin-bottom:6px;max-height:160px;overflow-y:auto"></div>
      <details id="tma-log-details">
        <summary style="cursor:pointer;font-size:11px;color:#555;padding:3px 0;user-select:none">
          📋 יומן פעילות (מזהים ממוסכים — בטוח לצרף בדיווח בעיות)</summary>
        <div style="display:flex;gap:4px;margin:4px 0 2px">
          <button id="tma-copy-log" style="flex:1;font-size:11px;padding:3px 6px;
                  background:#555;color:#fff;border:none;border-radius:3px;cursor:pointer">📋 העתק לוג</button>
          <button id="tma-clear-log" style="flex:1;font-size:11px;padding:3px 6px;
                  background:#888;color:#fff;border:none;border-radius:3px;cursor:pointer">🗑 נקה לוג</button>
        </div>
        <pre id="tma-log" style="max-height:150px;overflow-y:auto;font-size:10px;
             background:#1e1e1e;color:#d4d4d4;padding:8px;margin:0;
             border-radius:4px;white-space:pre-wrap;direction:ltr;
             border:1px solid #333;line-height:1.4"></pre>
      </details>
    </div>`;
  document.body.appendChild(panel);

  let drag = null;
  $el('tma-header').addEventListener('mousedown', (e) => {
    if (e.target.id === 'tma-toggle') return;
    drag = { sx: e.clientX - panel.offsetLeft, sy: e.clientY - panel.offsetTop };
    panel.style.right = 'auto';
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    panel.style.left = (e.clientX - drag.sx) + 'px';
    panel.style.top = (e.clientY - drag.sy) + 'px';
  });
  document.addEventListener('mouseup', () => { drag = null; });

  $el('tma-toggle').addEventListener('click', () => {
    const body = $el('tma-body');
    const tog = $el('tma-toggle');
    if (body.style.display === 'none') { body.style.display = ''; tog.textContent = '▲'; }
    else { body.style.display = 'none'; tog.textContent = '▼'; }
  });

  $el('tma-start-date').addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '');
    if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    if (v.length > 5) v = v.slice(0, 5) + '/' + v.slice(5, 9);
    this.value = v;
  });

  $el('tma-input').addEventListener('input', () => {
    if (!panelAwaitingErrorConfirm) return;
    panelAwaitingErrorConfirm = false;
    const b = $el('tma-start');
    if (b) b.textContent = '▶ התחל';
    panelRenderErrors([], 0);
  });

  // M-e: ‏panelStart היא async — בלי catch, כשל בהרצה היה נעלם כ-unhandled rejection
  // וכפתור "התחל" היה נשאר מנוטרל לנצח (הפאנל תקוע בלי דרך חזרה).
  $el('tma-start').addEventListener('click', () => {
    Promise.resolve()
      .then(() => panelStart())
      .catch((e) => {
        log('[התחלה] ההרצה נכשלה: ' + (e && e.message));
        panelSetRunning(false);
        panelSetStatus('ההרצה נכשלה — בדוק את הלוג ונסה שוב');
      });
  });
  $el('tma-stop').addEventListener('click', panelHandleStop, true);
  $el('tma-tsv').addEventListener('click', panelCopyTsv);
  $el('tma-csv').addEventListener('click', panelExportCsv);
  $el('tma-template').addEventListener('click', panelDownloadTemplate);
  $el('tma-copy-log').addEventListener('click', () => {
    copyLog().then((ok) => panelFlash('tma-copy-log', ok ? '✓ הועתק' : '✗ נכשל', '📋 העתק לוג'));
  });
  $el('tma-clear-log').addEventListener('click', () => {
    clearLog();
    log('[לוג] נוקה');
  });

  // עצירה גם ב-Escape (global-constraints: "תמיד עצור זמין — כפתור + Escape")
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!absorbIsRunning() && !absorbHasSavedQueue()) return;
    e.preventDefault();
    panelHandleStop();
  }, true);

  setLogListener(() => {
    const el = $el('tma-log');
    if (!el) return;
    el.textContent = getLogText();
    el.scrollTop = el.scrollHeight;
  });
}

// ─── אתחול ──────────────────────────────────────────────────────────────────

function initAbsorbPanel() {
  const page = getPage();
  const resumable = absorbHasSavedQueue();
  const savedInfo = absorbSavedQueueInfo();
  // הפאנל עולה בדפי מוסד / סוג-לימוד / תלמיד-חדש. חריג מכוון: גם בדף לא-מוכר כשיש
  // תור שמור — אחרת אצווה שנחתה בדף לא-צפוי נתקעת בלי שום ממשק (global-constraints).
  if (page.kind === 'other' && !resumable) return false;

  panelCreateUI();
  absorbSetHooks({
    getStartDate: panelStartDate,
    onStart: (queue, idx) => { panelTotal = queue.length; panelSetProgress(idx, panelTotal); panelSetRunning(true); },
    onResume: (queue, results, idx) => {
      panelTotal = queue.length;
      panelResults = results.slice();
      panelRenderResults();
      panelSetProgress(idx, panelTotal);
      panelSetRunning(true);
      panelSetStatus(`ממשיך אחרי ניווט — ${idx + 1} מתוך ${panelTotal}`);
    },
    onProgress: (idx, total, task) => {
      panelTotal = total;
      panelSetProgress(idx, total);
      panelSetStatus(`מעבד ${idx + 1}/${total}: סניף ${task.branch} · סוג ${task.studyType} · ${task.identity}`);
    },
    onResult: (result, all) => {
      panelResults = all.slice();
      panelRenderResults();
      panelSetProgress(all.length, Math.max(panelTotal, all.length));
    },
    // M5: תור ישן — לא ממשיכים אוטומטית, נותנים למשתמש "המשך"/"נקה".
    onStaleQueue: (info) => {
      panelSetRunning(false);
      panelSetStatus('יש תור שמור ישן — בחר "המשך" או "נקה"');
      panelRenderStaleQueue(info);
    },
    onDone: (results, report) => {
      panelResults = results.slice();
      panelRenderResults();
      panelRenderReport(report);
      panelSetRunning(false);
      panelSetProgress(results.length, results.length);
      const left = report.lines.length;
      panelSetStatus(left ? `הסתיים — ${left} שורות דורשות טיפול (ראה "מה נשאר")` : 'הסתיים ✓ הכול טופל');
    },
  });

  log(`[init] קליטת תלמידים v${PANEL_VERSION} · דף ${page.kind}${page.branch ? ' · סניף ' + page.branch : ''}${page.studyType ? ' · סוג ' + page.studyType : ''}`);

  panelResults = absorbGetResults();
  panelRenderResults();

  if (resumable && savedInfo && savedInfo.stale) panelSetStatus('נמצא תור שמור ישן — בודק…');
  else if (resumable) panelSetStatus('נמצא תור פתוח — ממשיך…');
  // גם כשאין תור פתוח: הקריאה מנקה מצב שמור שנותר מריצה שהסתיימה (לא זורקת בלי מצב).
  Promise.resolve()
    .then(() => absorbResumeIfPending())
    .catch((e) => { log('[resume] כשל: ' + (e && e.message)); panelSetRunning(false); });
  return true;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initAbsorbPanel(); });
  } else {
    setTimeout(() => { initAbsorbPanel(); }, 800);
  }
}

})();
