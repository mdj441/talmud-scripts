// ==UserScript==
// @name         תלמוד - כלי אוטומציה
// @namespace    https://github.com/mdj441/talmud-scripts
// @version      4.0.0
// @description  קליטה, עזיבה, הודעות ודיווח חודשי לתלמו"ד בסקריפט אחד (v4.0)
// @author       מרדכי יאקאב
// @match        https://talmud.edu.gov.il/*
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @run-at       document-idle
// @updateURL    https://github.com/mdj441/talmud-scripts/raw/refs/heads/main/dist/talmud-tools.user.js
// @downloadURL  https://github.com/mdj441/talmud-scripts/raw/refs/heads/main/dist/talmud-tools.user.js
// @supportURL   https://github.com/mdj441/talmud-scripts/issues
// ==/UserScript==

(function () {
  'use strict';

// ─── src/core/dom.js ───
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

// ─── src/core/prm.js ───
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
    // ממצא 8: ירי בקשה כשאחרת בטיסה: MS AJAX מריץ abortPostBack שמרים endRequest (בלי שגיאה) של
    // הבקשה הקודמת *לפני* ה-beginRequest של החדשה. ה-endRequest הראשון אחרי רישום-בזמן-טיסה
    // שייך לקודמת, ולא מסיים את ההמתנה הזו.
    let inFlight = !!prm._isInAsyncPostBack;

    function onBegin() { started = true; inFlight = false; clearTimeout(startTimer); }

    function onEnd(s, e) {
      if (inFlight && !started) { inFlight = false; return; }
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
      // ‏timeout:true (ממצא ב-2): הקורא מבחין בין "פג הזמן" (אולי pageRedirect בלי endRequest) לכשל אחר.
      finish({ ok: false, timeout: true, reason: `PRM timeout after ${totalTimeoutMs}ms` });
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

// ─── src/core/csv.js ───
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

// ─── src/core/log.js ───
// יומן פעילות משותף. טבעת של 400 שורות שנשמרת ב-sessionStorage אחרי כל שורה — כך היומן
// שורד טעינות-דף (ניווט מלא) ומציג את כל הריצה, לא רק את הטעינה האחרונה (W7, בדיקה רטובה
// 10.9.2026). maskId חוסם דליפת ת.ז. ליומן: היומן ממוסך תמיד; הטבלה והדוח מציגים מזהה מלא.
// אין גישה ל-document/window ברמת המודול — רק בתוך גופי הפונקציות (import תקין ב-Node).


const LOG_MAX_LINES = 400;
const LOG_KEY = 'talmud.log';
const logLines = [];
let logListener = null;
let restored = false;

// ת.ז. אמיתית לעולם לא נכתבת ליומן מלאה. מתחת ל-5 תווים אין מה למסך — מוחזר כמות שהוא.
function maskId(id) {
  const s = String(id == null ? '' : id);
  if (s.length < 5) return s;
  return '*'.repeat(s.length - 3) + s.slice(-3);
}

// לטקסט חופשי שעלול להכיל ת.ז. — ממסך כל רצף של 5+ ספרות.
function maskIdsInText(text) {
  return String(text == null ? '' : text).replace(/\d{5,}/g, (m) => maskId(m));
}

function persist() {
  try { sessionStorage.setItem(LOG_KEY, JSON.stringify(logLines)); } catch (e) { /* אצווה לא נתקעת */ }
}

// טוען את היומן של הטעינות הקודמות (נקרא פעם אחת באתחול הפאנל). מחזיר כמה שורות נטענו.
function restoreLog() {
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

function log(msg) {
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

function getLogText() {
  return logLines.join('\n');
}

function clearLog() {
  restored = true; // ניקוי מפורש — אין מה לשחזר
  logLines.length = 0;
  persist();
  if (logListener) { try { logListener(''); } catch (e) { /* אצווה לא נתקעת */ } }
}

// מאזין יחיד (הפאנל). null מנתק.
function setLogListener(fn) {
  logListener = typeof fn === 'function' ? fn : null;
}

function copyLog() {
  return copyTextToClipboard(getLogText());
}

// ─── src/core/navigate.js ───
// זיהוי דף + ניווט לפי עובדות שנמדדו באתר החי (סבב רטוב 30.10.2026):
//   F1 דף מוסד:      /Institutes/InstitutesDetails.aspx[?InstituteID=<id>]. התוכן הולך אחרי ה-session של השרת
//                    ("המוסד הנוכחי", שנקבע בלחיצה האחרונה בעץ-הצד), *לא* אחרי הכתובת. GET ישיר בלי לחיצה
//                    קודמת: h1 ריק. מקור-האמת לסניף: h1 "<מוסד> סניף NN", ואם ריק: התווית "מספר סניף".
//                    פירורי-הלחם מציגים את הסניף *מהכתובת* ולכן מטעים: לא מקור.
//   F2 עץ-הצד:       [id$=tvTalmud] קיים בדף המוסד ובדף סוג-הלימוד. לחיצה = טעינת-דף מלאה, הכתובת לא משתנה,
//                    והנתונים של הסניף שנלחץ. זה הניווט היחיד לסניף.
//   F3 דף סוג-לימוד: דרך הגריד הכתובת /StudyType/StudyTypeDetails.aspx בלי query; h1 "סוג לימוד NNN - <תיאור>";
//                    הסניף *רק* ב-span[id$=lblInstituteBranchNumber] (ה-session). GET ישיר עם query: h1 ריק,
//                    פירורי-לחם עם סניף הכתובת (מטעה), התווית עם סניף ה-session.
//   F4 הגריד:        לשונית "סוגי לימוד למוסד" (postback א-סינכרוני: הגריד והכפתור נבנים מחדש; ממתינים לו),
//                    שורה tr[onclick=selectedRowStudyType(i)], ואז btnUpdateStudyType → טעינה מלאה לדף סוג-הלימוד.
// אין מפות נלמדות ואין כתובות ישירות: כל ניווט לסניף עובר דרך העץ, וכל ניווט לסוג-לימוד דרך הגריד.
// אין גישה ל-document/window ברמת המודול (import תקין ב-Node).


const DEFAULT_ORIGIN = 'https://talmud.edu.gov.il';
const INSTITUTES_PAGE_PATH = '/Institutes/InstitutesDetails.aspx';
// ממצא ב-2: תקציב לפוסטבק שמנווט (עריכה בגריד, עץ, לשונית). כשהתשובה היא pageRedirect אין endRequest,
// ושרת איטי מעבר ל-8 שניות גרם ל-{ok:false} ולסימון התלמיד "שגיאה" רגע לפני שהדף נפרק.
const NAV_POSTBACK_BUDGET_MS = 25000;

// ─── כתובות ─────────────────────────────────────────────────────────────────

function siteOrigin() {
  try {
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.host) return location.origin;
  } catch (e) { /* Node */ }
  return DEFAULT_ORIGIN;
}

// טהורה: InstituteID מה-URL (לא רגיש לרישיות). למידע בלבד: הכתובת אינה קובעת מה מוצג (F1).
function parseInstituteId(url) {
  if (typeof url !== 'string') return null;
  const m = /[?&]InstituteID=(\d+)(?:&|#|$)/i.exec(url);
  return m ? m[1] : null;
}

// טהורה: InstituteStudyTypeID מה-URL. למידע בלבד.
function parseInstituteStudyTypeId(url) {
  if (typeof url !== 'string') return null;
  const m = /[?&]InstituteStudyTypeID=(\d+)(?:&|#|$)/i.exec(url);
  return m ? m[1] : null;
}

// דף המוסדות בלי query: ה-session קובע איזה סניף יוצג; המטרה היא רק להגיע לדף שיש בו עץ-צד (F2).
function institutesPageUrl() {
  return `${siteOrigin()}${INSTITUTES_PAGE_PATH}`;
}

// ─── פרסור טקסטים מהדף (טהור) ───────────────────────────────────────────────

const padBranch2 = (v) => String(v == null ? '' : v).trim().padStart(2, '0');

// "<מוסד> סניף NN" → "NN" (מרופד). אין => null.
function parseBranchFromH1(text) {
  if (typeof text !== 'string') return null;
  const m = /סניף\s*(\d{1,2})(?!\d)/.exec(text);
  return m ? padBranch2(m[1]) : null;
}

// "סוג לימוד 600 - כולל..." → "600". אין => null.
function parseStudyTypeFromH1(text) {
  if (typeof text !== 'string') return null;
  const m = /סוג לימוד\s*(\d+)/.exec(text);
  return m ? m[1] : null;
}

// טהורה: "0"/"00"/"7" → "00"/"00"/"07"; קלט לא-תקין → null.
function normalizeBranch(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d{1,2}$/.test(s) ? s.padStart(2, '0') : null;
}

// ─── זיהוי דף ───────────────────────────────────────────────────────────────

function classifyUrl(url) {
  if (typeof url !== 'string') return 'other';
  if (/InstitutesDetails\.aspx/i.test(url)) return 'institute';
  if (/StudyTypeDetails\.aspx/i.test(url)) return 'studyType';
  if (/Students\/StudentsDetails\.aspx/i.test(url)) return 'newStudent';
  return 'other';
}

function navH1Text() {
  try {
    const h1 = typeof document !== 'undefined' ? document.querySelector('h1') : null;
    return (h1 && h1.textContent) || '';
  } catch (e) {
    return '';
  }
}

// טקסט של span לפי סיומת-מזהה (ASP.NET מוסיף קידומות: הסיומת יציבה). אין => ''.
function navLabelText(idSuffix) {
  try {
    const el = typeof document !== 'undefined' ? document.querySelector(`[id$="${idSuffix}"]`) : null;
    return el ? String(el.textContent || '').trim() : '';
  } catch (e) {
    return '';
  }
}

// מחזיר תמיד אובייקט. ‏branchSource: 'h1' | 'label' | null.
//   דף מוסד:      הסניף מה-h1; אם ריק, מהתווית (lblInsBranchNumber / lblInstituteBranchNumber). פירורי-הלחם: לא.
//   דף סוג-לימוד: הסניף *רק* מהתווית lblInstituteBranchNumber; הקוד מה-h1. h1 ריק ⇒ studyType null
//                 (דף לא-מזוהה: חובה לנווט). InstituteID/InstituteStudyTypeID מהכתובת: למידע בלבד.
function getPage() {
  const url = (typeof location !== 'undefined' && location.href) || '';
  const kind = classifyUrl(url);

  if (kind === 'institute') {
    const fromH1 = parseBranchFromH1(navH1Text());
    const fromLabel = fromH1 ? null : (normalizeBranch(navLabelText('lblInsBranchNumber')) || normalizeBranch(navLabelText('lblInstituteBranchNumber')));
    const branch = fromH1 || fromLabel || null;
    return { kind, branch, branchSource: fromH1 ? 'h1' : (fromLabel ? 'label' : null), instituteId: parseInstituteId(url), studyType: null, url };
  }

  if (kind === 'studyType') {
    const studyType = parseStudyTypeFromH1(navH1Text());
    const branch = normalizeBranch(navLabelText('lblInstituteBranchNumber'));
    return {
      kind, branch, branchSource: branch ? 'label' : null,
      instituteId: parseInstituteId(url), instituteStudyTypeId: parseInstituteStudyTypeId(url), studyType, url,
    };
  }

  if (kind === 'newStudent') {
    const hid = $el('ContentPlaceHolder1_TabsStudent_StudentDetails1_ucStudentDetails_hidStudentState');
    const isNew = !!hid && String(hid.value).trim() === '-1';
    if (isNew) {
      const idEl = $el('ContentPlaceHolder1_TabsStudent_StudentDetails1_ucStudentDetails_txtID');
      return { kind, branch: null, branchSource: null, identity: idEl ? String(idEl.value || '').trim() : '', studyType: null, url };
    }
    return { kind: 'other', branch: null, branchSource: null, studyType: null, url };
  }

  return { kind: 'other', branch: null, branchSource: null, studyType: null, url };
}

// ─── גריד "סוגי לימוד למוסד" (gvStudyType) ──────────────────────────────────

// ממצא ב-8: שורת-נתונים בגריד = tr עם onclick של selectedRowStudyType. שורות הפייג'ר (טבלה מקוננת
// בתוך הגריד, כמו ב-GridView אמיתי) מכילות תאים "1","2" שעוברים את בדיקת-הספרות, ולכן gridToRows
// מסמן כל שורה ב-selectable, והפונקציות הטהורות מדלגות על selectable===false. מערך רגיל (בלי הדגל,
// למשל בבדיקות) נחשב שורת-נתונים.
function isStudyTypeDataRow(row) {
  if (!Array.isArray(row) || row.selectable === false) return false;
  return /^\d+$/.test(String(row[0] ?? '').trim());
}

// טהורה: אינדקס שורת-נתונים (0-based, בלי כותרת/פייג'ר) של הקוד. אין => -1.
function findStudyTypeRow(rows, code) {
  if (!Array.isArray(rows)) return -1;
  const target = String(code).trim();
  let dataIndex = -1;
  for (const row of rows) {
    if (!isStudyTypeDataRow(row)) continue;
    dataIndex++;
    if (String(row[0]).trim() === target) return dataIndex;
  }
  return -1;
}

// טהורה: מיקום השורה במערך (כולל כותרת): כדי לקרוא את ה-<tr> עצמו.
function findStudyTypeRowPosition(rows, code) {
  if (!Array.isArray(rows)) return -1;
  const target = String(code).trim();
  for (let i = 0; i < rows.length; i++) {
    if (isStudyTypeDataRow(rows[i]) && String(rows[i][0]).trim() === target) return i;
  }
  return -1;
}

// טהורה: onclick="selectedRowStudyType('N')" → N.
function parseSelectedRowIndex(onclickText) {
  if (typeof onclickText !== 'string') return null;
  const m = /selectedRowStudyType\s*\(\s*['"]?(\d+)['"]?\s*\)/.exec(onclickText);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// טהורה: חתימת-עמוד (הקודים בעמוד) לגילוי "הפייג'ר לא התקדם".
function gridPageSignature(rows) {
  if (!Array.isArray(rows)) return '';
  const codes = [];
  for (const row of rows) {
    if (isStudyTypeDataRow(row)) codes.push(String(row[0]).trim());
  }
  return `${codes.length}|${codes.join(',')}`;
}

// טהורה: הקודים ומצב-הזכאות מהגריד (למשל לתפריט הבחירה בפאנל). [{code, desc, status}]
function gridStudyTypes(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    if (!isStudyTypeDataRow(row)) continue;
    out.push({ code: String(row[0]).trim(), desc: String(row[1] ?? '').trim(), status: String(row[3] ?? '').trim() });
  }
  return out;
}

// מערך של מערכי-תאים לכל tr; לכל שורה דגל selectable (ממצא ב-8): יש onclick עם selectedRowStudyType.
function gridToRows(table) {
  if (!table || typeof table.querySelectorAll !== 'function') return [];
  return Array.from(table.querySelectorAll('tr')).map((tr) => {
    const row = Array.from(tr.querySelectorAll('td,th')).map((cell) => (cell.textContent || '').trim());
    const onclick = (typeof tr.getAttribute === 'function' && tr.getAttribute('onclick')) || '';
    row.selectable = /selectedRowStudyType/.test(String(onclick));
    return row;
  });
}

// טהורה: href בפורמט javascript:__doPostBack('target','arg') → {target, arg}.
// הערכים הם מחרוזות-JS בתוך התכונה, ולכן מפענחים את תווי-הבריחה שלהן כמו שהדפדפן עושה בלחיצה:
// צומת-העץ כתוב `'sעטרת שלמה\\16'` ובריצה הוא `sעטרת שלמה\16`. בלי הפענוח האתר מקבל שני לוכסנים
// ומתעלם (ממצא סבב רטוב חלק 2, 31.10.2026: "לא הגיעה טעינת דף תוך 12 שניות").
const unescapeJsString = (s) => s.replace(/\\(.)/g, '$1');
function parsePostbackHref(href) {
  if (typeof href !== 'string') return null;
  const m = /^(?:javascript:)?__doPostBack\('([^']*)'\s*,\s*'([^']*)'\)\s*;?$/.exec(href.trim());
  if (!m) return null;
  return { target: unescapeJsString(m[1]), arg: unescapeJsString(m[2]) };
}

const INSTITUTE_TAB_CONTAINER = 'ContentPlaceHolder1_tabInstituteDetails';
const STUDY_TYPE_TAB_INDEX = 1;
const STUDY_TYPE_TAB_LABEL = 'סוגי לימוד';
const STUDY_TYPE_MAX_PAGE_FLIPS = 25;

function tabText(el) {
  return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
}

// לשונית "סוגי לימוד למוסד" בדף המוסד. F4 (מתוקן): set_activeTabIndex(1) מפעיל postback א-סינכרוני
// (UpdatePanel) שבמהלכו הגריד והכפתור "עריכה" נעלמים ונבנים מחדש; ירי מיד אחריו נבלע. לכן כמו כל
// נגיעה בדף: רושמים waitPRM, קוראים מ-setTimeout(0), וממתינים לסיום. רק אחר-כך קוראים את הגריד.
// סדר הניסיון: TabContainer דרך $find; בלעדיו, הכותרת לפי טקסט (postback אם יש href, אחרת click).
async function activateStudyTypeTab() {
  try {
    if (typeof document === 'undefined') return { ok: false, reason: 'אין document' };
    let tabs = null;
    try { if (typeof window !== 'undefined' && typeof window.$find === 'function') tabs = window.$find(INSTITUTE_TAB_CONTAINER); } catch (e) { tabs = null; }
    if (tabs && typeof tabs.set_activeTabIndex === 'function') {
      let active = null;
      try { active = typeof tabs.get_activeTabIndex === 'function' ? tabs.get_activeTabIndex() : null; } catch (e) { active = null; }
      if (active === STUDY_TYPE_TAB_INDEX) return { ok: true, started: false };
      const wait = waitPRM({ startTimeoutMs: 1500, totalTimeoutMs: NAV_POSTBACK_BUDGET_MS });
      setTimeout(() => { try { tabs.set_activeTabIndex(STUDY_TYPE_TAB_INDEX); } catch (e) { log('[לשונית] הפעלת "סוגי לימוד למוסד" נכשלה: ' + (e && e.message)); } }, 0);
      const res = await wait;
      if (res && res.ok === false) return { ok: false, reason: 'מעבר ללשונית סוגי הלימוד נכשל: ' + (res.reason || '') };
      return { ok: true, started: !!(res && res.started) };
    }
    const headers = Array.from(document.querySelectorAll('.ajax__tab_header a, .ajax__tab_tab, [role="tab"]'));
    const tab = headers.find((el) => tabText(el).startsWith(STUDY_TYPE_TAB_LABEL))
      || headers.find((el) => tabText(el).includes(STUDY_TYPE_TAB_LABEL));
    if (!tab) return { ok: false, reason: 'לא נמצאה הלשונית "סוגי לימוד למוסד" בדף המוסד' };
    const href = typeof tab.getAttribute === 'function' ? tab.getAttribute('href') : null;
    const parsed = href ? parsePostbackHref(href) : null;
    if (parsed) return firePostback(parsed.target, parsed.arg, { startTimeoutMs: 1500, totalTimeoutMs: NAV_POSTBACK_BUDGET_MS });
    const wait = waitPRM({ startTimeoutMs: 1500, totalTimeoutMs: NAV_POSTBACK_BUDGET_MS });
    setTimeout(() => { try { tab.click(); } catch (e) { /* אצווה לא נתקעת */ } }, 0);
    const res = await wait;
    if (res && res.ok === false) return { ok: false, reason: 'מעבר ללשונית סוגי הלימוד נכשל: ' + (res.reason || '') };
    return { ok: true, started: !!(res && res.started) };
  } catch (e) {
    return { ok: false, reason: 'שגיאה בהפעלת לשונית סוגי הלימוד: ' + (e && e.message) };
  }
}

function studyTypeGridEl() {
  return typeof document !== 'undefined' ? document.querySelector('table[id$="gvStudyType"]') : null;
}

// קורא את כל סוגי-הלימוד של הסניף מהגריד (מדפדף לפי הצורך). מחזיר {ok, list:[{code,desc,status}]}.
async function readStudyTypesFromInstitutePage(opts) {
  const shouldAbort = opts && typeof opts.shouldAbort === 'function' ? opts.shouldAbort : () => false;
  const tab = await activateStudyTypeTab();
  if (!tab.ok) return tab;
  const list = [];
  for (let flip = 0; flip <= STUDY_TYPE_MAX_PAGE_FLIPS; flip++) {
    const table = studyTypeGridEl();
    if (!table) return { ok: false, reason: 'לא נמצא גריד סוגי הלימוד (gvStudyType) בדף המוסד' };
    const rows = gridToRows(table);
    for (const st of gridStudyTypes(rows)) if (!list.some((x) => x.code === st.code)) list.push(st);
    const next = Array.from(table.querySelectorAll('tr:last-child a'))
      .map((a) => parsePostbackHref(a.getAttribute('href') || ''))
      .find((p) => p && /Page\$(Next|\d+)/.test(p.arg) && (p.arg === 'Page$Next' || parseInt(p.arg.slice(5), 10) === flip + 2));
    if (!next || shouldAbort()) break;
    const before = gridPageSignature(rows);
    const res = await firePostback(next.target, next.arg);
    if (!res.ok) break;
    const after = studyTypeGridEl();
    if (!after || gridPageSignature(gridToRows(after)) === before) break;
  }
  return { ok: true, list };
}

// מדף המוסד (F4): לשונית (והמתנה ל-postback שלה) → שורה בגריד המרוענן (עם דפדוף) → selectedRowStudyType →
// postback "עריכה" → טעינה מלאה לדף סוג-הלימוד. מחזיר {ok, method:'grid', status} או {ok:false, notFound?, reason}.
async function gotoStudyTypeFromInstitute(code, opts) {
  const shouldAbort = opts && typeof opts.shouldAbort === 'function' ? opts.shouldAbort : null;
  const aborted = (where) => ({ ok: false, aborted: true, reason: `הניווט לסוג הלימוד בוטל (${where})` });

  const tab = await activateStudyTypeTab();
  if (!tab.ok) return tab;
  if (shouldAbort && shouldAbort()) return aborted('אחרי הפעלת הלשונית');

  for (let flip = 0; ; flip++) {
    const table = studyTypeGridEl(); // נקרא מחדש אחרי כל postback: הגריד נבנה מחדש (F4)
    if (!table) return { ok: false, reason: 'לא נמצא גריד סוגי הלימוד (gvStudyType) בדף המוסד' };
    const rows = gridToRows(table);
    const position = findStudyTypeRowPosition(rows, code);

    if (position !== -1) {
      if (typeof window === 'undefined' || typeof window.selectedRowStudyType !== 'function') {
        return { ok: false, reason: 'הפונקציה selectedRowStudyType אינה זמינה בדף המוסד' };
      }
      const tr = Array.from(table.querySelectorAll('tr'))[position] || null;
      const onclick = (tr && typeof tr.getAttribute === 'function' && tr.getAttribute('onclick')) || '';
      const fromAttr = parseSelectedRowIndex(onclick);
      const rowIndex = fromAttr === null ? findStudyTypeRow(rows, code) : fromAttr;
      if (rowIndex === -1) return { ok: false, notFound: true, reason: `סוג לימוד ${code} לא נמצא בגריד` };
      const status = String(rows[position][3] || '').trim();
      try { window.selectedRowStudyType(rowIndex); } catch (e) {
        return { ok: false, reason: 'שגיאה בבחירת שורת סוג הלימוד: ' + (e && e.message) };
      }
      // היומן נכתב לפני הירי: "עריכה" היא טעינת דף מלאה, לפעמים לפני שההמתנה מסתיימת
      log(`[ניווט] גריד סוגי-הלימוד: שורה ${code}${status ? ` (${status})` : ''} → "עריכה" (טעינת דף)`);
      const res = await firePostback('ctl00$ContentPlaceHolder1$btnUpdateStudyType', '', { startTimeoutMs: 1500, totalTimeoutMs: NAV_POSTBACK_BUDGET_MS });
      return Object.assign({ method: 'grid', status }, res, { ok: res.ok !== false });
    }

    const next = Array.from(table.querySelectorAll('tr:last-child a'))
      .map((a) => parsePostbackHref(a.getAttribute('href') || ''))
      .find((p) => p && /Page\$(Next|\d+)/.test(p.arg));
    if (!next) return { ok: false, notFound: true, reason: `סוג לימוד ${code} לא נמצא בגריד סוגי-הלימוד של הסניף` };
    if (flip >= STUDY_TYPE_MAX_PAGE_FLIPS) return { ok: false, notFound: true, reason: `סוג לימוד ${code} לא נמצא (חריגה ממספר הדפים)` };
    if (shouldAbort && shouldAbort()) return aborted(`לפני דפדוף ${flip + 1}`);

    const before = gridPageSignature(rows);
    const res = await firePostback(next.target, next.arg);
    if (!res.ok) return res;
    const after = studyTypeGridEl();
    if (after && gridPageSignature(gridToRows(after)) === before) {
      return { ok: false, reason: `דפדוף הגריד לא התקדם (עמוד ${flip + 1}): סוג לימוד ${code} לא נמצא` };
    }
  }
}

// ─── עץ הסניפים (tvTalmud): הניווט היחיד לסניף (F2) ────────────────────────

// טהורה: אינדקס ה-href של צומת-הסניף (מסתיים ב-\NN').
function findBranchHref(hrefs, code) {
  if (!Array.isArray(hrefs)) return -1;
  const suffix = '\\' + padBranch2(code) + "'";
  for (let i = 0; i < hrefs.length; i++) {
    const h = hrefs[i];
    if (typeof h !== 'string') continue;
    if (h.trim().replace(/\)+;?$/, '').endsWith(suffix)) return i;
  }
  return -1;
}

// טהורה: הסניפים שמופיעים בעץ.
function branchesFromTreeHrefs(hrefs) {
  const out = [];
  for (const h of Array.isArray(hrefs) ? hrefs : []) {
    const m = typeof h === 'string' ? /\\(\d{2})'\)/.exec(h) : null;
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out.sort();
}

function navTreeEl() {
  try {
    return typeof document !== 'undefined' ? document.querySelector('[id$="tvTalmud"]') : null;
  } catch (e) {
    return null;
  }
}

function readBranchesFromTree() {
  try {
    const tree = navTreeEl();
    if (!tree) return [];
    return branchesFromTreeHrefs(Array.from(tree.querySelectorAll('a')).map((a) => a.getAttribute('href') || ''));
  } catch (e) {
    return [];
  }
}

function navGoToUrl(target, extra) {
  try {
    if (typeof location === 'undefined') return { ok: false, reason: 'אין location' };
    location.href = target;
    return Object.assign({ ok: true, method: 'url', via: target }, extra || {});
  } catch (e) {
    return { ok: false, reason: 'ניווט לפי כתובת נכשל: ' + (e && e.message) };
  }
}

// ניווט לדף המוסד של סניף. יש עץ בדף (מוסד, סוג-לימוד) → postback של צומת הסניף: טעינת-דף מלאה באותה
// כתובת (F2); הקורא מתייחס ל-{ok:true, method:'tree'} כניווט מלא. אין עץ (תלמיד-חדש / אחר) → כתובת
// דף המוסדות בלי query (ה-session קובע מה יוצג; המטרה רק להגיע לדף עם עץ), ואחרי הטעינה ההמשך לוחץ בעץ.
// ניווט מלא: הדף נפרק, ה-Promise עלול לא להתממש: הקורא שומר את מצבו *לפני*.
async function gotoInstitute(branch) {
  const b = normalizeBranch(branch);
  if (!b) return { ok: false, reason: `סניף לא תקין: ${branch}` };
  const tree = navTreeEl();
  if (!tree) {
    log(`[ניווט] אין עץ-צד בדף הזה: עוברים לדף המוסדות, ומשם העץ לסניף ${b}`);
    return navGoToUrl(institutesPageUrl(), { branch: b, hop: true });
  }

  const hrefs = Array.from(tree.querySelectorAll('a')).map((a) => a.getAttribute('href') || '');
  const idx = findBranchHref(hrefs, b);
  if (idx === -1) return { ok: false, notFound: true, reason: `סניף ${b} לא נמצא בעץ הסניפים` };
  const parsed = parsePostbackHref(hrefs[idx]);
  if (!parsed) return { ok: false, reason: 'קישור הסניף בעץ אינו בפורמט הצפוי' };
  // היומן נכתב לפני הירי: הדף נפרק (F2) לפעמים לפני שההמתנה מסתיימת
  log(`[ניווט] לוחצים בעץ-הצד על סניף ${b} (טעינת דף; הכתובת לא משתנה)`);
  const res = await firePostback(parsed.target, parsed.arg, { startTimeoutMs: 1500, totalTimeoutMs: NAV_POSTBACK_BUDGET_MS });
  return Object.assign({ method: 'tree', branch: b }, res, { ok: res.ok !== false });
}

// ניווט לדף סוג-לימוד. דף מוסד שה-h1 שלו הוא הסניף המבוקש → הגריד (F4); אחרת קודם לסניף (gotoInstitute:
// עץ, או כתובת דף המוסדות), ואחרי הטעינה ההמשך יגיע לכאן שוב. מחזיר {ok, method:'grid'|'tree'|'url', notFound?}.
async function gotoStudyType(branch, code) {
  const b = normalizeBranch(branch);
  const c = String(code == null ? '' : code).trim();
  if (!b || !/^\d+$/.test(c)) return { ok: false, reason: `סניף/סוג לימוד לא תקינים: ${branch}/${code}` };

  const page = getPage();
  if (page.kind === 'institute' && page.branch === b && page.branchSource === 'h1') {
    const res = await gotoStudyTypeFromInstitute(c);
    return Object.assign({ branch: b, studyType: c }, res);
  }
  const res = await gotoInstitute(b);
  return Object.assign({ studyType: c }, res);
}

// ─── src/ui/widgets.js ───
// רכיבי-ממשק משותפים לכל הכלים: בוני HTML טהורים (נבדקים ב-Node) + קושרי-אירועים קטנים.
// כל המחלקות עם קידומת tt- (ה-CSS ב-panel.js). אין גישה ל-document ברמת המודול.


function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function todayDMY() {
  const d = new Date();
  return [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('/');
}

// כפתור. kind: primary | danger | ghost | subtle. size: normal | small
function buttonHtml({ id, label, kind = 'ghost', size = 'normal', title = '', disabled = false, attrs = '' }) {
  return `<button type="button" id="${esc(id)}" class="tt-btn tt-btn-${kind}${size === 'small' ? ' tt-btn-sm' : ''}"${title ? ` title="${esc(title)}"` : ''}${disabled ? ' disabled' : ''} ${attrs}>${label}</button>`;
}

function buttonsRowHtml(buttons, extraClass = '') {
  return `<div class="tt-row ${extraClass}">${buttons.map(buttonHtml).join('')}</div>`;
}

// שדה עם תווית מעל
function fieldHtml(label, inner, hint = '') {
  return `<label class="tt-field"><span class="tt-field-label">${esc(label)}</span>${inner}${hint ? `<span class="tt-hint">${esc(hint)}</span>` : ''}</label>`;
}

function selectHtml({ id, options, value = '', placeholder = '', cls = '' }) {
  const opts = (placeholder ? [`<option value="">${esc(placeholder)}</option>`] : [])
    .concat(options.map((o) => {
      const v = typeof o === 'string' ? o : o.value;
      const l = typeof o === 'string' ? o : (o.label == null ? o.value : o.label);
      return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`;
    }));
  return `<select id="${esc(id)}" class="tt-select ${cls}">${opts.join('')}</select>`;
}

// טבלת תוצאות. columns: [{key, label, mono?, center?, width?}]. classify(row) → 'ok' | 'warn' | 'bad' | ''
function resultsTableHtml({ columns, rows, classify, emptyText = '' }) {
  if (!rows || !rows.length) return emptyText ? `<div class="tt-empty">${esc(emptyText)}</div>` : '';
  const head = columns.map((c) => `<th${c.width ? ` style="width:${c.width}"` : ''}>${esc(c.label)}</th>`).join('');
  const body = rows.map((r) => {
    const cls = classify ? classify(r) : '';
    const cells = columns.map((c) => {
      const v = r[c.key];
      const classes = [c.mono ? 'tt-mono' : '', c.center ? 'tt-center' : '', c.key === 'status' ? 'tt-status-cell' : ''].filter(Boolean).join(' ');
      return `<td class="${classes}">${esc(v)}</td>`;
    }).join('');
    const title = r.detail ? ` title="${esc(r.detail)}"` : '';
    return `<tr class="tt-r-${cls || 'none'}"${title}>${cells}</tr>`;
  }).join('');
  return `<table class="tt-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// תיבת דוח "מה נשאר"
function reportBoxHtml(report, { idsWarning = true } = {}) {
  if (!report) return '';
  let html = '';
  if (idsWarning) html += `<div class="tt-hint tt-hint-warn">הדוח מכיל מזהים מלאים. לא להדביק אותו בצ'אט או בדיווח-באג; ליומן יש "העתק יומן" ממוסך.</div>`;
  html += `<div class="tt-report-summary">סיכום: ${esc(report.summary || '—')}</div>`;
  if (report.lines && report.lines.length) {
    html += `<div class="tt-report-title">מה נשאר לעשות</div><ol class="tt-report-list">${report.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
  } else {
    html += '<div class="tt-ok">הכול טופל. אין שורות שדורשות טיפול.</div>';
  }
  return html;
}

// היומן המשותף (אחד לכל הכלים)
function logSectionHtml(id = 'tt-log') {
  return `<details class="tt-log-details" id="${id}-details">
    <summary>יומן פעילות (מזהים ממוסכים, בטוח לשליחה בדיווח)</summary>
    <div class="tt-row tt-row-tight">
      ${buttonHtml({ id: `${id}-copy`, label: 'העתק יומן', kind: 'subtle', size: 'small' })}
      ${buttonHtml({ id: `${id}-clear`, label: 'נקה יומן', kind: 'subtle', size: 'small' })}
    </div>
    <pre id="${id}" class="tt-log"></pre>
  </details>`;
}

function bindLogSection(id = 'tt-log') {
  const render = () => {
    const el = $el(id);
    if (!el) return;
    el.textContent = getLogText();
    el.scrollTop = el.scrollHeight;
  };
  setLogListener(render);
  render();
  const copy = $el(`${id}-copy`);
  if (copy) copy.addEventListener('click', () => copyLog().then((ok) => flash(`${id}-copy`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק יומן')));
  const clear = $el(`${id}-clear`);
  if (clear) clear.addEventListener('click', () => { clearLog(); log('[יומן] נוקה'); });
}

function flash(id, tempText, backText, ms = 1800) {
  const btn = $el(id);
  if (!btn) return;
  btn.textContent = tempText;
  setTimeout(() => { const b = $el(id); if (b) b.textContent = backText; }, ms);
}

function setText(id, text) {
  const el = $el(id);
  if (el) el.textContent = text == null ? '' : String(text);
}

function setHtml(id, html) {
  const el = $el(id);
  if (el) el.innerHTML = html;
}

function show(id, on) {
  const el = $el(id);
  if (el) el.hidden = !on;
}

function setDisabled(id, disabled) {
  const el = $el(id);
  if (el) el.disabled = !!disabled;
}

// מסכת תאריך DD/MM/YYYY בזמן הקלדה
function bindDateMask(id) {
  const el = $el(id);
  if (!el) return;
  el.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '');
    if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    if (v.length > 5) v = v.slice(0, 5) + '/' + v.slice(5, 9);
    this.value = v;
  });
}

// ─── src/ui/panel.js ───
// השלד המאוחד: כפתור צף + מגירה אחת (צמודה לקצה הימני) עם לשוניות לכלים הרלוונטיים לדף הנוכחי.
// כל כלי נרשם עם registerTool({ id, title, pages, mount, onStop, isRunning, hasPendingRun }).
// ‏mount(container, ui) מרנדר את הלשונית; ui = { status(msg), progress(cur,total), running(bool), open() }.
// Escape → onStop של הלשונית הפעילה (רק כשהיא רצה). אין גישה ל-document ברמת המודול.
//
// עיצוב (30.10.2026): כלי-עבודה שקט בתוך אתר ממשלתי כחול-אפור. משפחת-גופן אחת (של המערכת, בלי טעינה
// מהרשת), צבע-הדגשה אחד (ירוק-טורקיז עמוק, שונה מכחול האתר) לפעולה הראשית, ללשונית הפעילה ולפס-ההתקדמות.
// פס-ההתקדמות הדק מתחת לשורת-המצב הוא האלמנט היחיד שמושך את העין; כל השאר ממושמע.


const PANEL_VERSION = '4.0';
const UI_KEY = 'tt.ui';
const tools = [];
let activeToolId = null;

function registerTool(tool) {
  if (!tool || !tool.id) throw new Error('registerTool: חסר id');
  if (!tools.some((t) => t.id === tool.id)) tools.push(tool);
}

function registeredTools() { return tools.slice(); }

function loadUiState() {
  try { return JSON.parse(localStorage.getItem(UI_KEY) || 'null') || {}; } catch (e) { return {}; }
}
function saveUiState(patch) {
  try { localStorage.setItem(UI_KEY, JSON.stringify(Object.assign(loadUiState(), patch))); } catch (e) { /* noop */ }
}

const PANEL_CSS = `
#tt-panel,#tt-fab{
  --tt-ink:#1b2a33;--tt-ink-2:#4a5a66;--tt-muted:#7a8891;--tt-paper:#fbfaf7;--tt-field:#ffffff;--tt-line:#d9dfe3;--tt-line-2:#eceff2;
  --tt-accent:#0f6b5c;--tt-accent-2:#0b5447;--tt-accent-soft:#e3f0ec;
  --tt-ok:#1e6b45;--tt-ok-bg:#edf7f0;--tt-warn:#8a5a00;--tt-warn-bg:#fff6df;--tt-bad:#a2261a;--tt-bad-bg:#fcefed;--tt-info:#24455c;--tt-info-bg:#eef3f7;
  --tt-font:"Segoe UI","Arial Hebrew",Arial,sans-serif;
}
#tt-fab{position:fixed;bottom:22px;right:22px;z-index:99998;width:42px;height:42px;border-radius:50%;border:0;cursor:pointer;
  background:var(--tt-ink);color:#fff;font:700 18px/1 var(--tt-font);display:flex;align-items:center;justify-content:center;
  box-shadow:0 2px 10px rgba(27,42,51,.28)}
#tt-fab:hover{background:#2b3f4b}
#tt-fab:focus-visible{outline:2px solid var(--tt-accent);outline-offset:3px}
#tt-fab .tt-badge{position:absolute;inset:-4px;border-radius:50%;border:2px solid var(--tt-accent);display:none;pointer-events:none}
#tt-fab.tt-running .tt-badge{display:block;animation:tt-pulse 1.6s ease-in-out infinite}
@keyframes tt-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(1.12)}}
@media (prefers-reduced-motion:reduce){#tt-fab.tt-running .tt-badge{animation:none}}

#tt-panel{position:fixed;top:0;right:0;bottom:0;z-index:99999;width:600px;max-width:100vw;display:flex;flex-direction:column;
  background:var(--tt-paper);color:var(--tt-ink);border-left:1px solid var(--tt-line);box-shadow:-10px 0 30px rgba(27,42,51,.14);
  font:13px/1.5 var(--tt-font);direction:rtl;font-variant-numeric:tabular-nums}
#tt-panel.tt-panel-wide{width:820px}
#tt-panel[hidden]{display:none}
#tt-panel *{box-sizing:border-box}
#tt-panel :focus-visible{outline:2px solid var(--tt-accent);outline-offset:1px}

.tt-head{display:flex;align-items:baseline;gap:10px;padding:14px 18px 8px;user-select:none}
.tt-head .tt-title{font-weight:700;font-size:16px;flex:1;letter-spacing:-.01em}
.tt-head .tt-ver{font-size:11px;color:var(--tt-muted)}
.tt-head .tt-x{background:transparent;border:0;color:var(--tt-ink-2);font:400 20px/1 var(--tt-font);cursor:pointer;padding:0 2px;align-self:center}
.tt-head .tt-x:hover{color:var(--tt-ink)}

.tt-tabs{display:flex;gap:18px;padding:0 18px;border-bottom:1px solid var(--tt-line)}
.tt-tab{border:0;background:transparent;padding:7px 0 9px;cursor:pointer;font:inherit;font-size:13px;color:var(--tt-ink-2);
  border-bottom:2px solid transparent;margin-bottom:-1px}
.tt-tab:hover{color:var(--tt-ink)}
.tt-tab.tt-tab-active{color:var(--tt-ink);font-weight:600;border-bottom-color:var(--tt-accent)}
.tt-tab .tt-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--tt-accent);margin-inline-start:6px;vertical-align:middle}
.tt-tab .tt-dot[hidden]{display:none}

.tt-body{padding:0 18px 18px;overflow:auto;flex:1}
.tt-strip{position:sticky;top:0;z-index:2;background:var(--tt-paper);margin:0 -18px 10px;padding:10px 18px 0}
.tt-strip-row{display:flex;align-items:baseline;gap:12px;min-height:22px}
.tt-status{flex:1;font-size:13px;color:var(--tt-ink)}
.tt-progress{font-size:12px;color:var(--tt-muted);white-space:nowrap}
.tt-bar{height:2px;background:var(--tt-line-2);margin-top:8px;overflow:hidden}
.tt-bar i{display:block;height:100%;width:100%;background:var(--tt-accent);transform:scaleX(0);transform-origin:right;transition:transform .25s ease}
@media (prefers-reduced-motion:reduce){.tt-bar i{transition:none}}

.tt-row{display:flex;gap:8px;margin:8px 0;flex-wrap:wrap;align-items:center}
.tt-row-tight{margin:4px 0 2px}
.tt-row > .tt-btn{flex:1 1 auto}
.tt-btn{border:1px solid var(--tt-line);background:var(--tt-field);color:var(--tt-ink);padding:7px 12px;border-radius:6px;cursor:pointer;font:inherit;font-size:13px}
.tt-btn:hover{border-color:#b9c3ca;background:#f6f7f8}
.tt-btn:disabled{opacity:.45;cursor:default}
.tt-btn-primary{background:var(--tt-accent);border-color:var(--tt-accent);color:#fff;font-weight:600}
.tt-btn-primary:hover{background:var(--tt-accent-2);border-color:var(--tt-accent-2)}
.tt-btn-danger{background:var(--tt-field);border-color:var(--tt-bad);color:var(--tt-bad);font-weight:600}
.tt-btn-danger:hover{background:var(--tt-bad-bg)}
.tt-btn-ghost{background:var(--tt-field)}
.tt-btn-subtle{background:transparent;border-color:transparent;color:var(--tt-accent);text-decoration:underline;text-underline-offset:3px;text-decoration-color:rgba(15,107,92,.35)}
.tt-btn-subtle:hover{background:var(--tt-accent-soft);border-color:transparent;text-decoration-color:var(--tt-accent)}
.tt-btn-sm{padding:3px 8px;font-size:12px}

.tt-field{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--tt-ink-2);flex:1}
.tt-field-label{font-weight:600}
.tt-hint{font-size:12px;color:var(--tt-muted)}
.tt-hint-warn{color:var(--tt-warn)}
.tt-input,.tt-select,.tt-textarea{border:1px solid var(--tt-line);border-radius:6px;padding:6px 8px;font:inherit;font-size:13px;background:var(--tt-field);color:var(--tt-ink);width:100%}
.tt-input:focus,.tt-select:focus,.tt-textarea:focus{outline:2px solid var(--tt-accent);outline-offset:0;border-color:var(--tt-accent)}
.tt-input::placeholder,.tt-textarea::placeholder{color:#a3adb4}
.tt-textarea{min-height:88px;resize:vertical;direction:ltr;text-align:left;font-size:12.5px}
.tt-textarea-sm{min-height:60px}
.tt-mono{direction:ltr;text-align:left;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.tt-center{text-align:center}

.tt-box{border:1px solid var(--tt-line);background:var(--tt-field);padding:8px 12px;margin:8px 0;font-size:12.5px;border-radius:6px}
.tt-box-warn{background:var(--tt-warn-bg);border-color:#ead9a8;color:#4f3600}
.tt-box-error{background:var(--tt-bad-bg);border-color:#efc3bb;color:#6b1911}
.tt-box-info{background:var(--tt-info-bg);border-color:#cfdbe4;color:var(--tt-info)}
.tt-box ul,.tt-box ol{margin:4px 0 0;padding-inline-start:18px}
.tt-section{margin:8px 0;border-top:1px solid var(--tt-line-2);padding:4px 0 2px}
.tt-section summary{cursor:pointer;font-size:12px;color:var(--tt-ink-2);user-select:none;padding:4px 0}
.tt-section summary:hover{color:var(--tt-ink)}
.tt-section[open] summary{margin-bottom:4px}

.tt-table{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0;background:var(--tt-field)}
.tt-table th{color:var(--tt-ink-2);font-weight:600;padding:6px 8px;text-align:right;border-bottom:1px solid var(--tt-line);position:sticky;top:0;background:var(--tt-field)}
.tt-table td{padding:5px 8px;border-bottom:1px solid var(--tt-line-2);vertical-align:middle}
.tt-table td.tt-status-cell{font-weight:600;white-space:nowrap}
.tt-table td.tt-status-cell::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;margin-inline-end:6px;background:var(--tt-line);vertical-align:1px}
.tt-table tr.tt-r-ok td.tt-status-cell{color:var(--tt-ok)}.tt-table tr.tt-r-ok td.tt-status-cell::before{background:var(--tt-ok)}
.tt-table tr.tt-r-warn td.tt-status-cell{color:var(--tt-warn)}.tt-table tr.tt-r-warn td.tt-status-cell::before{background:var(--tt-warn)}
.tt-table tr.tt-r-bad td.tt-status-cell{color:var(--tt-bad)}.tt-table tr.tt-r-bad td.tt-status-cell::before{background:var(--tt-bad)}
.tt-scroll{max-height:240px;overflow:auto;border:1px solid var(--tt-line);border-radius:6px;background:var(--tt-field)}
.tt-scroll-tall{max-height:340px}
.tt-empty{color:var(--tt-muted);font-size:12px;padding:6px}
.tt-report-summary{font-weight:600;margin:4px 0}
.tt-report-title{font-weight:600;margin-top:8px}
.tt-report-list{margin:4px 0 0;padding-inline-start:18px}
.tt-report-list li{margin-bottom:4px}
.tt-ok{color:var(--tt-ok)}
.tt-muted{color:var(--tt-muted);font-size:11px}
.tt-summary{font-size:12px;color:var(--tt-ink-2);margin:2px 0 4px;min-height:16px}
.tt-tag{display:inline-block;border-radius:3px;padding:0 6px;font-size:11px;font-weight:600;line-height:18px}
.tt-tag-done{background:var(--tt-warn-bg);color:var(--tt-warn)}
.tt-tag-count{background:var(--tt-info-bg);color:var(--tt-info)}

.tt-log-details{margin-top:14px;border-top:1px solid var(--tt-line-2);padding-top:6px}
.tt-log-details summary{cursor:pointer;font-size:12px;color:var(--tt-muted);user-select:none}
.tt-log-details summary:hover{color:var(--tt-ink-2)}
.tt-log{max-height:180px;overflow:auto;background:#1f2a31;color:#d8dee3;padding:8px 10px;border-radius:6px;font:11.5px/1.5 Consolas,"Courier New",monospace;white-space:pre-wrap;direction:ltr;text-align:left;margin:4px 0 0}
.tt-chips{display:flex;flex-wrap:wrap;gap:4px;max-height:140px;overflow:auto;padding:4px 0}
.tt-chip{border:1px solid var(--tt-line);border-radius:12px;padding:1px 8px;background:var(--tt-field);cursor:pointer;font-size:12px}
.tt-chip:hover{background:var(--tt-accent-soft);border-color:var(--tt-accent)}

.tt-grid-input{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--tt-field)}
.tt-grid-input th{color:var(--tt-ink-2);font-weight:600;padding:5px 5px;text-align:right;border-bottom:1px solid var(--tt-line);white-space:nowrap}
.tt-grid-input td{padding:3px 3px;border-bottom:1px solid var(--tt-line-2)}
.tt-grid-input .tt-input,.tt-grid-input .tt-select{padding:4px 6px;font-size:12.5px;min-width:0}
.tt-grid-input tr.tt-r-bad td{background:var(--tt-bad-bg)}
.tt-cell-off{background:#f4f5f6}
.tt-cell-off .tt-input{background:transparent;border-color:transparent}

.tt-review-tools .tt-filter{flex:2 1 160px;width:auto;direction:rtl}
.tt-review-tools > .tt-btn{flex:0 1 auto}
.tt-review-table td{white-space:nowrap}
.tt-review-table td.tt-body-cell{max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tt-ink-2)}
.tt-review-table .tt-select.tt-decision{padding:3px 4px;font-size:12px;width:auto;min-width:118px}
.tt-review-table tr.tt-r-done{background:var(--tt-warn-bg)}
.tt-review-table td.tt-roster-cell{font-size:11px;color:var(--tt-ink-2);white-space:normal;min-width:70px}

.tt-foot{padding:8px 18px;border-top:1px solid var(--tt-line);font-size:11px;color:var(--tt-muted);display:flex;gap:12px;align-items:center}
.tt-foot a{color:var(--tt-accent);text-decoration:none}
.tt-foot a:hover{text-decoration:underline}
.tt-foot .tt-kbd{border:1px solid var(--tt-line);border-radius:3px;padding:0 4px;font-size:10px;background:var(--tt-field)}
`;

function ensureStyle() {
  if ($el('tt-style')) return;
  const style = document.createElement('style');
  style.id = 'tt-style';
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

// כלי מתאים לדף לפי סוג הדף (pages) או לפי בדיקת-כתובת משלו (matches(page)); כלי עם תור פתוח מוצג בכל מקרה.
function toolsForPage(page) {
  const pageKind = page && page.kind;
  return tools.filter((t) => {
    let fits = Array.isArray(t.pages) && t.pages.includes(pageKind);
    if (!fits && typeof t.matches === 'function') { try { fits = !!t.matches(page); } catch (e) { fits = false; } }
    let pending = false;
    try { pending = !!(t.hasPendingRun && t.hasPendingRun()); } catch (e) { pending = false; }
    return fits || pending;
  });
}

function toolById(id) { return tools.find((t) => t.id === id) || null; }

function makeUi(tool) {
  return {
    status(msg) { const el = $el(`tt-${tool.id}-status`); if (el) el.textContent = msg == null ? '' : String(msg); },
    progress(cur, total) {
      const el = $el(`tt-${tool.id}-progress`);
      if (el) el.textContent = total ? `${cur} מתוך ${total}` : '';
      const bar = $el(`tt-${tool.id}-bar`);
      if (bar) bar.style.transform = `scaleX(${total ? Math.max(0, Math.min(1, cur / total)) : 0})`;
    },
    running(on) {
      const fab = $el('tt-fab');
      if (fab) fab.classList.toggle('tt-running', !!on);
      const tab = $el(`tt-tab-${tool.id}`);
      if (tab) { const dot = tab.querySelector('.tt-dot'); if (dot) dot.hidden = !on; }
    },
    open() { openPanel(true); activateTab(tool.id); },
  };
}

function openPanel(on) {
  const panel = $el('tt-panel');
  if (!panel) return;
  panel.hidden = !on;
  saveUiState({ open: !!on });
}

function activateTab(id) {
  activeToolId = id;
  for (const t of tools) {
    const tab = $el(`tt-tab-${t.id}`);
    const pane = $el(`tt-pane-${t.id}`);
    if (tab) tab.classList.toggle('tt-tab-active', t.id === id);
    if (pane) pane.hidden = t.id !== id;
  }
  saveUiState({ tab: id });
}

function activeTool() { return toolById(activeToolId); }

// בונה את הכפתור הצף והמגירה לדף הנוכחי. מחזיר את רשימת הכלים שנטענו (ריק = אין מה להציג).
function mountPanel(page) {
  if (typeof document === 'undefined' || !document.body) return [];
  if ($el('tt-panel')) return []; // מופע אחר כבר מנהל את הדף
  const list = toolsForPage(page);
  if (!list.length) return [];
  ensureStyle();

  const state = loadUiState();
  const pending = list.find((t) => { try { return t.hasPendingRun && t.hasPendingRun(); } catch (e) { return false; } });
  const initialTab = (pending && pending.id) || (list.some((t) => t.id === state.tab) ? state.tab : list[0].id);
  const initiallyOpen = pending ? true : state.open !== false;

  const fab = document.createElement('button');
  fab.id = 'tt-fab';
  fab.type = 'button';
  fab.title = 'כלי תלמו"ד: פתיחה וסגירה של החלונית';
  fab.setAttribute('aria-label', 'כלי תלמו"ד');
  fab.innerHTML = 'ת<span class="tt-badge"></span>';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'tt-panel';
  panel.hidden = !initiallyOpen;
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'כלי תלמו"ד');
  panel.innerHTML = `
    <div class="tt-head" id="tt-head">
      <span class="tt-title">כלי תלמו"ד</span>
      <span class="tt-ver">גרסה ${esc(PANEL_VERSION)}</span>
      <button type="button" class="tt-x" id="tt-close" title="סגירה (הכפתור הצף פותח שוב)" aria-label="סגירה">×</button>
    </div>
    <div class="tt-tabs" id="tt-tabs" role="tablist">
      ${list.map((t) => `<button type="button" role="tab" class="tt-tab" id="tt-tab-${esc(t.id)}">${esc(t.title)}<span class="tt-dot" hidden></span></button>`).join('')}
    </div>
    <div class="tt-body">
      ${list.map((t) => `<div id="tt-pane-${esc(t.id)}" hidden>
        <div class="tt-strip">
          <div class="tt-strip-row"><div class="tt-status" id="tt-${esc(t.id)}-status" aria-live="polite">מוכן</div><div class="tt-progress" id="tt-${esc(t.id)}-progress"></div></div>
          <div class="tt-bar"><i id="tt-${esc(t.id)}-bar"></i></div>
        </div>
        <div id="tt-${esc(t.id)}-root"></div>
      </div>`).join('')}
      ${logSectionHtml('tt-log')}
    </div>
    <div class="tt-foot">
      <span><span class="tt-kbd">Esc</span> עוצר את הריצה הפעילה</span>
      <a href="https://github.com/mdj441/talmud-scripts#readme" target="_blank" rel="noopener">הוראות</a>
      <a href="https://github.com/mdj441/talmud-scripts/issues" target="_blank" rel="noopener">דיווח על בעיה</a>
    </div>`;
  document.body.appendChild(panel);

  fab.addEventListener('click', () => openPanel(panel.hidden));
  $el('tt-close').addEventListener('click', () => openPanel(false));
  for (const t of list) $el(`tt-tab-${t.id}`).addEventListener('click', () => activateTab(t.id));

  // Escape → עצור בלשונית הפעילה (רק כשהיא רצה)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const t = activeTool();
    let running = false;
    try { running = !!(t && t.isRunning && t.isRunning()); } catch (err) { running = false; }
    if (!t || !running || typeof t.onStop !== 'function') return;
    e.preventDefault();
    t.onStop();
  }, true);

  bindLogSection('tt-log');
  activateTab(initialTab);

  for (const t of list) {
    try {
      t.mount($el(`tt-${t.id}-root`), makeUi(t), page);
    } catch (e) {
      log(`[ממשק] הלשונית "${t.title}" לא נטענה: ${e && e.message}`);
      const root = $el(`tt-${t.id}-root`);
      if (root) root.innerHTML = `<div class="tt-box tt-box-error">הלשונית לא נטענה: ${esc(e && e.message)}</div>`;
    }
  }
  if (pending) openPanel(true);
  return list;
}

// ─── src/data/countries.js ───
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

// ─── src/core/identity.js ───

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
  // ‏B3: התאמת-קידומת מותרת רק כשהיא חד-משמעית. הגרסה הקודמת החזירה את ההתאמה
  // ה*ראשונה* וגם התאימה בכיוון ההפוך (s מתחיל בשם ארץ), ולכן "א" → 710 (ארצות
  // הברית) ו"ניגריה הצפונית" → 211 (ניגר) — ערך אמיתי, ארץ שגויה, בלי שום סימן
  // (בדיקת קיום-האופציה במודאל לא יכולה לתפוס את זה). דורשים 3+ תווים, כיוון אחד
  // בלבד (שם הארץ מתחיל בקלט), ומועמד יחיד — אחרת null ("ארץ לא מוכרת" בפרסור).
  if (s.length < 3) return null;
  const hits = COUNTRIES.filter(c => c.he.startsWith(s));
  return hits.length === 1 ? hits[0].value : null;
}

// ─── src/tools/absorb-parse.js ───

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

// שדות גולמיים של שורה (בלי אימות) - משותף לפרסור ולטבלת-ההזנה בממשק, כדי שיהיה מסלול-מיפוי אחד.
// בלי כותרת: 3 תאים = בסיס; 4-5 תאים = הפורמט הישן לדרכון (תאריך לידה, ארץ); 6+ תאים = סדר-התבנית
// (שם פרטי, שם משפחה, תאריך לידה, ארץ, מגדר, מצב משפחתי) - גם עם תאים ריקים כמו שאקסל מייצא (W6).
function absorbCellsToFields(cells, columnMap) {
  const f = { branch: '', studyType: '', identifier: '', firstName: '', lastName: '', birthDate: '', country: '', gender: '', familyStatus: '' };
  const cell = (i) => (cells[i] ?? '').trim();
  if (columnMap) {
    for (const k of Object.keys(f)) if (k in columnMap) f[k] = cell(columnMap[k]);
    return f;
  }
  f.branch = cell(0); f.studyType = cell(1); f.identifier = cell(2);
  const rest = cells.slice(3).map((c) => (c ?? '').trim());
  if (cells.length >= 6) {
    [f.firstName, f.lastName, f.birthDate, f.country, f.gender, f.familyStatus] = [0, 1, 2, 3, 4, 5].map((i) => rest[i] || '');
  } else if (cells.length >= 4 && detectIdType(f.identifier).type === 'passport') {
    f.birthDate = rest[0] || ''; f.country = rest[1] || '';
  } else if (cells.length >= 4) {
    // ת.ז. עם 4-5 תאים: הפורמט הישן לדרכון (תאריך, ארץ) - נשמר כדי שהאימות ידווח "מספר עמודות לא צפוי"
    f.birthDate = rest[0] || ''; f.country = rest[1] || '';
    f._unexpectedColumns = true;
  }
  return f;
}

// כל השורות של הטקסט כשדות גולמיים (לטבלת-ההזנה): [{ lineNo, fields }]. שורות ריקות/הערות מדולגות.
function absorbTextToFieldRows(text) {
  const rawLines = splitLines(text || '');
  const delimiter = detectDelimiter(text || '');
  const { headerLineIndex, columnMap } = maybeHeader(rawLines, delimiter);
  const out = [];
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (trimmed === '' || trimmed.startsWith('#') || i === headerLineIndex) continue;
    out.push({ lineNo: i + 1, fields: absorbCellsToFields(splitCells(rawLines[i], delimiter), columnMap) });
  }
  return out;
}

// שורות-שדות → טקסט עם כותרת (סדר-התבנית) - הקלט היחיד לפרסור, גם מהטבלה.
const ABSORB_FIELD_ORDER = ['branch', 'studyType', 'identifier', 'firstName', 'lastName', 'birthDate', 'country', 'gender', 'familyStatus'];
const ABSORB_FIELD_HEADERS = ['סניף', 'סוג לימוד', 'ת.ז./דרכון', 'שם פרטי', 'שם משפחה', 'תאריך לידה', 'ארץ', 'מגדר', 'מצב משפחתי'];
function absorbFieldRowsToText(rows) {
  const lines = [ABSORB_FIELD_HEADERS.join('\t')];
  for (const r of rows || []) {
    const f = r && r.fields ? r.fields : (r || {});
    lines.push(ABSORB_FIELD_ORDER.map((k) => String(f[k] ?? '').replace(/[\t\r\n]+/g, ' ').trim()).join('\t'));
  }
  return lines.join('\n');
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
    // בלי שורת-כותרת: 3 תאים = בסיס; 4–5 תאים = הפורמט הישן לדרכון (תאריך לידה, ארץ);
    // 6+ תאים = סדר-התבנית (שם פרטי, שם משפחה, תאריך לידה, ארץ, מגדר, מצב משפחתי) —
    // כך העתקה מהתבנית של האקסל עובדת גם בלי הכותרת וגם עם תאים ריקים (W6).
    const rest = cells.slice(3).map((c) => (c ?? '').trim());
    const opt = (i) => (rest.length > i && rest[i] !== '' ? rest[i] : undefined);
    if (cells.length >= 6) {
      firstNameRaw = opt(0);
      lastNameRaw = opt(1);
      birthDateRaw = opt(2);
      countryRaw = opt(3);
      genderRaw = opt(4);
      statusRaw = opt(5);
    } else if (idInfo.type === 'passport' || cells.length === 4 || cells.length === 5) {
      // 4-5 תאים = (תאריך לידה, ארץ): דרכון עם אותיות, או דרכון שכולו ספרות שהארץ מכריעה עליו (למטה)
      birthDateRaw = opt(0);
      countryRaw = opt(1);
    }
  }

  // דרכון שכולו ספרות (31.10.2026): אי-אפשר להבדיל ממספר ת.ז. לפי הספרות, ולכן הארץ מכריעה. מזהה ספרתי עם
  // ארץ = דרכון (בלי ריפוד לתשע ספרות). קידומת מפורשת "ת.ז.:" גוברת. בלי ארץ ובלי אותיות: ת.ז.
  let idType = idInfo.type;
  let identityNorm = idInfo.identifier;
  const explicitTz = /^(tz|ת\.?ז\.?)\s*[:=]/i.test(identity);
  // בלי כותרת הארץ חייבת להיות מוכרת (אחרת "01,300,ת.ז.,ישראל,כהן" היה נקרא כדרכון); עם כותרת, עמודת "ארץ" מלאה מספיקה.
  const countryDecides = !!countryRaw && !explicitTz && (columnMap ? true : resolveCountry(countryRaw) !== null);
  if (idType === 'tz' && countryDecides) {
    idType = 'passport';
    identityNorm = identity.replace(/^(דרכון|passport)\s*[:=]\s*/i, '').trim().toUpperCase();
  } else if (idType === 'tz' && !columnMap && (cells.length === 4 || cells.length === 5)) {
    return err('מספר עמודות לא צפוי (לדרכון שכולו ספרות צריך ארץ בעמודה החמישית; לת.ז. עם פרטי תלמיד חדש צריך שם פרטי, שם משפחה ותאריך לידה)');
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
    idType, identity: identityNorm,
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
    // סבב רטוב 31.10.2026: שורה ראשונה בלי אף כותרת מוכרת (למשל תו זר לפני הסניף: "a02 600 …") אינה
    // כותרת. בלי זה כל השורות נעלמו בשקט ("0 שורות · 0 שגויות"). עכשיו היא שורת-נתונים → שגיאה מפורשת.
    if (Object.keys(columnMap).length === 0) return none;
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

// ─── src/tools/absorb-xlsx.js ───
// טעינת רשימת תלמידים מקובץ אקסל (.xlsx/.xls) — ממיר את הגיליון לטקסט מופרד-טאבים
// שנכנס ל-parseAbsorbInput (src/tools/absorb-parse.js), כך שיש מסלול פרסור אחד לכל
// המקורות (הדבקה ידנית או קובץ אקסל). אין גישה ל-globalThis.XLSX ברמת המודול — רק
// בתוך גוף loadXlsxFile — כדי שהמודול הזה ייבא נקי גם ב-Node (בדיקות, בלי דפדפן/ספרייה).

function xlsxCellToString(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const day = String(v.getDate()).padStart(2, '0');
    const month = String(v.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${v.getFullYear()}`;
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

// ממיר מטריצת שורות (מ-XLSX.utils.sheet_to_json(ws,{header:1})) לטקסט טאבים\שורות.
// שומר תאים ריקים פנימיים (כדי שמיקום העמודות ישרוד), חותך תאים ריקים בסוף כל שורה,
// ומדלג על שורות שהתרוקנו לגמרי (שורות-זנב שאקסל נוטה להשאיר בסוף גיליון מפורמט).
function sheetRowsToText(rows) {
  const lines = [];
  for (const row of rows || []) {
    const cells = (row || []).map(xlsxCellToString);
    let end = cells.length;
    while (end > 0 && cells[end - 1] === '') end--;
    const trimmed = cells.slice(0, end);
    if (trimmed.length === 0) continue;
    lines.push(trimmed.join('\t'));
  }
  return lines.join('\n');
}

// קורא קובץ אקסל שנבחר בדפדפן (File) ומחזיר טקסט טאבים של הגיליון הראשון.
// דורש שהספרייה הגלובלית XLSX (SheetJS, נטענת ב-@require מהכותרת) כבר נטענה.
async function loadXlsxFile(file) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) {
    throw new Error('ספריית SheetJS (XLSX) לא נטענה — בדוק חיבור לאינטרנט ונסה שוב');
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheetName = wb && wb.SheetNames && wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : null;
  if (!ws) {
    throw new Error('לא נמצא גיליון בקובץ האקסל');
  }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  return sheetRowsToText(rows);
}

// ─── src/tools/absorb-report.js ───
// קליטה — החלק הטהור: סטטוסים, ניתוח הגריד, תוצאות (TSV/CSV), דוח "מה נשאר", הכרעות קטנות.
// אין כאן DOM בכלל; הכל נבדק ביחידה (test/absorb-pure.test.js).


const ABSORB_STATUS = {
  OK: 'נקלט',
  OK_NEW: 'נקלט (תלמיד חדש)',
  EXISTS: 'כבר קיים',
  SAVED_UNVERIFIED: 'נשמר — לאמת ידנית',
  VERIFY: 'לאמת ידנית', // ממצא 10: ברשימה שורה יחידה עם מזהה אחר: לא הצלחה, המשתמש מאמת
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
const ABSORB_MAX_QUEUE_AGE_MS = 30 * 60 * 1000; // מעל זה — אין המשך אוטומטי של תור שמור

// "נחסם: <טקסט>" → "נחסם".
function absorbStatusKey(status) {
  const s = String(status == null ? '' : status);
  const i = s.indexOf(':');
  return (i === -1 ? s : s.slice(0, i)).trim();
}

function isAbsorbSuccess(status) {
  return ABSORB_SUCCESS_KEYS.indexOf(absorbStatusKey(status)) !== -1;
}

// ת.ז. → ספרות בלי אפסים מובילים ("6136871" == "006136871"); דרכון → בלי רווחים/מקפים, רישיות אחידות.
function absorbNormalizeId(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const compact = s.replace(/[\s-]/g, '');
  if (/^\d+$/.test(compact)) return compact.replace(/^0+/, '') || '0';
  return compact.toUpperCase();
}

const ABSORB_ID_CELL_RE = /^[0-9A-Za-z][0-9A-Za-z\s-]{3,}$/;

// טהורה. `rows` = שורות-תאים; עמודה 3 = ת.ז./דרכון. `count` = תווית הספירה כשער:
// 0 → "לא נמצא" תמיד; 1 → מותר fallback לשורת-נתונים יחידה; 2+ → רק התאמה מדויקת; null → בלי שער.
// ממצא 10: ה-fallback מותר רק כשהתא מכיל את ספרות המזהה (אחרי נרמול). שורה יחידה עם מזהה *אחר*
// אינה הצלחה: {found:false, singleOther:<התא>}, והזרימה מדווחת "לאמת ידנית".
// ממצא ב-3: התווית אומרת 1+ אך אף תא לא זוהה כמזהה (למשל עמודה 3 אינה עמודת המזהה): הרשימה לא
// קריאה, {found:false, unreadable:true}, והזרימה לא לוחצת "קליטה" על תלמיד שאולי כבר ברשימה.
function analyzeGrid(rows, identity, count) {
  const none = { found: false, matchType: null };
  if (count === 0) return none;
  if (!Array.isArray(rows)) return none;
  const target = absorbNormalizeId(identity);
  if (!target) return none;
  let dataRows = 0;
  let exact = false;
  let lastCell = '';
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const cell = String(row[3] == null ? '' : row[3]).trim();
    if (!ABSORB_ID_CELL_RE.test(cell)) continue;
    dataRows++;
    lastCell = cell;
    if (absorbNormalizeId(cell) === target) exact = true;
  }
  if (exact) return { found: true, matchType: 'exact' };
  if (dataRows === 0 && typeof count === 'number' && count >= 1) return { found: false, matchType: null, unreadable: true };
  if (dataRows === 1 && (count == null || count === 1)) {
    if (absorbNormalizeId(lastCell).includes(target)) return { found: true, matchType: 'single-row-fallback' };
    return { found: false, matchType: null, singleOther: lastCell };
  }
  return none;
}

function flatCell(value) {
  return String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ').trim();
}

function buildResultsTsv(results) {
  const lines = [ABSORB_TSV_HEADER.join('\t')];
  for (const r of Array.isArray(results) ? results : []) {
    lines.push([r.branch, r.studyType, r.identity, r.status, r.action].map(flatCell).join('\t'));
  }
  return lines.join('\n');
}

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

// דוח "מה נשאר": שורה אופרטיבית לכל תוצאה שאינה הצלחה + סיכום.
// טהורה (31.10.2026, זרימת-התיקון): אילו שורות-טבלה דורשות טיפול לפי תוצאות הריצה האחרונה — כל שורה
// שהתוצאה שלה (אותו סניף, סוג-לימוד ומזהה) אינה הצלחה. שורה בלי תוצאה (לא רצה) נשארת. מחזירה
// {rows, needsExtra}: needsExtra = יש "תלמיד חדש" שדורש שם/משפחה/תאריך לידה (לפתוח את העמודות).
function absorbRowsNeedingAttention(rows, results) {
  const key = (branch, studyType, identity) => `${String(branch || '').trim().padStart(2, '0')}|${String(studyType || '').trim()}|${absorbNormalizeId(identity)}`;
  const byKey = new Map();
  for (const r of results || []) byKey.set(key(r.branch, r.studyType, r.identity), r);
  const kept = [];
  let needsExtra = false;
  for (const row of rows || []) {
    const f = row && row.fields ? row.fields : {};
    if (!String(f.identifier || '').trim()) continue;
    const res = byKey.get(key(f.branch, f.studyType, f.identifier));
    if (res && isAbsorbSuccess(res.status)) continue;
    if (res && absorbStatusKey(res.status).startsWith('תלמיד חדש')) needsExtra = true;
    kept.push(row);
  }
  return { rows: kept, needsExtra };
}

function buildRemainingReport(results) {
  const list = Array.isArray(results) ? results : [];
  const counts = summarizeAbsorbResults(list);
  const lines = list
    .filter((r) => !isAbsorbSuccess(r && r.status))
    .map((r) => [r.branch, r.studyType, r.identity, r.status, r.action || '—'].map(flatCell).join(' · '));
  const summary = Object.keys(counts).map((k) => `${k}=${counts[k]}`).join(' · ');
  return { lines, summary, counts };
}

// "נמצאו N רשומות" → N; אין → null (אין עדות שהחיפוש רץ).
function absorbParseCount(text) {
  const m = /נמצאו\s*(\d+)/.exec(String(text == null ? '' : text).trim());
  return m ? parseInt(m[1], 10) : null;
}

// מה לעשות עם תוצאת החיפוש המקדים (שם "לא נמצא" גורר לחיצת "קליטה", ולכן דורש עדות):
//   executed=false → 'error'; refreshed → 'analyze'; תווית לא-טרייה → 'error';
//   תווית טרייה 0 → 'analyze'; תווית טרייה 1+ בלי גריד טרי → 'retry'; אחרת 'error'.
function absorbPrecheckDecision(res) {
  if (!res || typeof res !== 'object' || Array.isArray(res)) return 'error';
  if (!res.executed) return 'error';
  if (res.refreshed) return 'analyze';
  if (res.countFresh !== true) return 'error';
  if (res.count === 0) return 'analyze';
  if (typeof res.count === 'number' && Number.isFinite(res.count) && res.count >= 1) return 'retry';
  return 'error';
}

// רישום תוצאה אידמפוטנטי לכל שורה בתור.
function absorbShouldRecord(lastRecordedIdx, idx) {
  if (typeof idx !== 'number' || !Number.isFinite(idx) || idx < 0) return false;
  const last = typeof lastRecordedIdx === 'number' && Number.isFinite(lastRecordedIdx) ? lastRecordedIdx : -1;
  return idx > last;
}

function absorbQueueIsStale(startedAt, now, maxAgeMs) {
  const t0 = Date.parse(startedAt);
  if (!startedAt || Number.isNaN(t0)) return false;
  const nowMs = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.parse(now));
  if (Number.isNaN(nowMs)) return false;
  const max = typeof maxAgeMs === 'number' ? maxAgeMs : ABSORB_MAX_QUEUE_AGE_MS;
  return nowMs - t0 > max;
}

// מקור אחד לרשומת-תוצאה. ריפוד אפסים לת.ז., דרכון כמות-שהוא.
function makeAbsorbResult(task, status, detail, action) {
  const t = task || {};
  const identity = t.idType === 'tz' ? padId9(t.identity) : String(t.identity == null ? '' : t.identity).trim();
  return {
    line: t.line, branch: t.branch, studyType: t.studyType, idType: t.idType, identity,
    status, detail: detail || '', action: action || '',
  };
}

// href של LinkButton: __doPostBack ישיר או WebForm_DoPostBackWithOptions (עם קבוצת ולידציה).
function absorbParsePostbackFromHref(href) {
  const direct = parsePostbackHref(href);
  if (direct) return { target: direct.target, arg: direct.arg, group: '', validate: false };
  const m = /WebForm_PostBackOptions\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(true|false)\s*,\s*"([^"]*)"/.exec(String(href || ''));
  if (m) return { target: m[1], arg: m[2], group: m[4], validate: m[3] === 'true' };
  return null;
}

// F3 (30.10.2026): בדף סוג-לימוד הסניף נקרא *רק* מהתווית lblInstituteBranchNumber ('label'). פירורי-לחם,
// כתובת, מפה או כוונה אינם מקור, ולכן רק 'label' מספיק כדי לקלוט במקום.
function absorbBranchSourceTrusted(source) {
  return source === 'label';
}

// ממצא ב-2: פוסטבק מנווט שפג זמנו (pageRedirect בלי endRequest) אחרי שהדף כבר התחיל להיפרק
// (beforeunload/pagehide) הוא טעינת-דף בדרך, לא כשל: ההמשך אחרי הטעינה, בלי לסמן "שגיאה".
function absorbNavTimeoutIsNavigation(res, unloadSeen) {
  return !!(res && typeof res === 'object' && res.ok === false && res.timeout === true && unloadSeen === true);
}

// ממצא ב-3: פירוט לרשימה שלא ניתן לקרוא בה מזהים.
function absorbUnreadableGridDetail(count) {
  return `הרשימה הציגה ${count} תוצאות אך לא ניתן לקרוא בה מזהים`;
}

// הוראה אופרטיבית לניווט ידני לסוג-לימוד (משותפת לכמה סטטוסים).
function manualStudyTypeAction(branch, code) {
  return `פתח את דף המוסד של סניף ${branch}, לחץ על הלשונית "סוגי לימוד למוסד", לחץ על השורה של סוג ${code} ואז על "עריכה". כשדף סוג-הלימוד פתוח, הרץ שוב את השורה הזו`;
}

// ─── src/tools/absorb-state.js ───
// קליטה — מצב הריצה: התור (sessionStorage, שורד טעינת-דף), דגל עצירה, "דורות" של ניסיונות,
// ומונה נחיתות לכל תלמיד (רשת-ביטחון נגד לולאת ניווט). אין DOM כאן.


const QUEUE_KEY = 'talmud.absorb.queue';
const STOP_KEY = 'talmud.absorb.stop';
const LANDINGS_KEY = 'talmud.absorb.landings';
const LAST_RESULTS_KEY = 'talmud.absorb.lastResults';
const STOP_PREFIX = '__STOPPED__@';
const CANCEL_PREFIX = '__CANCELLED__@';

// מסלול לגיטימי ארוך ביותר לתלמיד אחד: קפיצה לדף-מוסד ידוע → עץ לסניף → גריד לסוג-לימוד →
// דף תלמיד-חדש → חזרה לסוג-הלימוד = 5 טעינות. מעל 8 = לולאה.
const ABSORB_MAX_LANDINGS = 8;

// המצב החי של הריצה (מודול אחד, אובייקט אחד — הזרימה והפאנל קוראים ממנו).
const S = {
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
  // סבב רטוב 31.10.2026: בעל-המערכת סימן בפאנל "אשר המשך" — על אזהרת "תלמיד זה רשום כבר במוסד אחר"
  // לוחצים "המשך" (מעבר בין מוסדות). נקבע בהתחלת הריצה ונשמר עם המצב (הריצה שורדת טעינות-דף).
  continueOtherInstitute: false,
  generation: 0,
};

// ─── עצירה ──────────────────────────────────────────────────────────────────

function absorbIsStopped() {
  try { return sessionStorage.getItem(STOP_KEY) === '1'; } catch (e) { return false; }
}
function requestAbsorbStop() {
  try { sessionStorage.setItem(STOP_KEY, '1'); } catch (e) { /* אצווה לא נתקעת */ }
  log('⛔ בקשת עצירה');
}
function clearAbsorbStop() {
  try { sessionStorage.removeItem(STOP_KEY); } catch (e) { /* אצווה לא נתקעת */ }
}

function absorbStopError(where) { return new Error(STOP_PREFIX + where); }
function isAbsorbStopError(err) {
  return !!err && typeof err.message === 'string' && err.message.indexOf(STOP_PREFIX) === 0;
}
function absorbCancelError(where) { return new Error(CANCEL_PREFIX + where); }
function isAbsorbCancelError(err) {
  return !!err && typeof err.message === 'string' && err.message.indexOf(CANCEL_PREFIX) === 0;
}

// ─── דורות: ניסיון שהוחלף (timeout+retry) או שבוטל מת בגבול-השלב הבא ולא נוגע בדף ─
function absorbNextGeneration() { S.generation++; return S.generation; }
function absorbCurrentGeneration() { return S.generation; }
function absorbIsCancelled(gen) { return typeof gen === 'number' && gen !== S.generation; }

function checkStop(where, gen) {
  if (absorbIsCancelled(gen)) throw absorbCancelError(where);
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

// ─── התור ב-sessionStorage ──────────────────────────────────────────────────

function saveAbsorbState(extra) {
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

function loadAbsorbState() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

function clearAbsorbState() {
  try {
    sessionStorage.removeItem(QUEUE_KEY);
    sessionStorage.removeItem(LANDINGS_KEY);
  } catch (e) { /* אצווה לא נתקעת */ }
}

// ממצא 6: תמונת-התוצאות של הריצה האחרונה (sessionStorage, שורדת טעינת-דף): הלשונית מציגה אותה
// באתחול כשאין ריצה/תור, כך ש"עצור" בזמן טעינה לא מעלים את הטבלה והדוח.
function saveAbsorbLastResults(results, report) {
  try {
    sessionStorage.setItem(LAST_RESULTS_KEY, JSON.stringify({ results: Array.isArray(results) ? results : [], report: report || null, at: new Date().toISOString() }));
  } catch (e) { /* אצווה לא נתקעת */ }
}

function loadAbsorbLastResults() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(LAST_RESULTS_KEY) || 'null');
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.results) ? parsed : null;
  } catch (e) {
    return null;
  }
}

// מונה טעינות-דף (נחיתות) לתלמיד הנוכחי. מחזיר את המספר אחרי ההגדלה.
function absorbBumpLandings(idx) {
  let rec = { idx: -1, count: 0 };
  try {
    const raw = sessionStorage.getItem(LANDINGS_KEY);
    if (raw) rec = JSON.parse(raw) || rec;
  } catch (e) { /* ברירת מחדל */ }
  rec = rec.idx === idx ? { idx, count: (rec.count || 0) + 1 } : { idx, count: 1 };
  try { sessionStorage.setItem(LANDINGS_KEY, JSON.stringify(rec)); } catch (e) { /* noop */ }
  return rec.count;
}

function absorbResetLandings() {
  try { sessionStorage.removeItem(LANDINGS_KEY); } catch (e) { /* noop */ }
}

function absorbResetRun() {
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

// ─── src/core/lock.js ───
// נעילת-ריצה בין לשוניות (ממצא 5): ההקשר צד-השרת של תלמו"ד משותף לכל הלשוניות (דף תלמיד-חדש
// נפתח בלי פרמטרים), ולכן שתי ריצות במקביל משבשות זו את זו. הנעילה ב-localStorage (משותף ללשוניות):
// { tab: מזהה-לשונית, at: Date.now() }. הלשונית הרצה מרעננת אותה כל כמה שניות; נעילה שלא רועננה
// RUN_LOCK_TTL_MS נחשבת מתה (לשונית שנסגרה באמצע). מזהה-הלשונית נשמר ב-sessionStorage (פר-לשונית).
// הלוגיקה הטהורה (runLockState) נפרדת כדי שגם עזיבה/דיווח יוכלו להשתמש בה. אין DOM כאן.

const RUN_LOCK_KEY = 'talmud.absorb.lock';
const RUN_LOCK_TTL_MS = 10000;
const RUN_LOCK_REFRESH_MS = 3000;
const TAB_ID_KEY = 'talmud.tabId';

// טהורה: האם הנעילה חיה (טרייה מ-TTL) והאם היא של הלשונית הזו.
function runLockState(lock, tabId, now, ttlMs) {
  const dead = { live: false, mine: false };
  if (!lock || typeof lock !== 'object') return dead;
  const at = typeof lock.at === 'number' ? lock.at : NaN;
  if (Number.isNaN(at)) return dead;
  const ttl = typeof ttlMs === 'number' ? ttlMs : RUN_LOCK_TTL_MS;
  const nowMs = typeof now === 'number' ? now : Date.now();
  if (nowMs - at > ttl) return dead;
  return { live: true, mine: !!tabId && lock.tab === tabId };
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// מזהה-לשונית אקראי, יציב בתוך הלשונית (sessionStorage). בלי אחסון: מזהה לזמן-הריצה בלבד.
let memoTabId = null;
function currentTabId() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      let id = sessionStorage.getItem(TAB_ID_KEY);
      if (!id) { id = randomId(); sessionStorage.setItem(TAB_ID_KEY, id); }
      return id;
    }
  } catch (e) { /* ממשיכים לזיכרון */ }
  if (!memoTabId) memoTabId = randomId();
  return memoTabId;
}

function readRunLock() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const parsed = JSON.parse(localStorage.getItem(RUN_LOCK_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

function writeRunLock() {
  try {
    if (typeof localStorage === 'undefined') return true; // בלי אחסון משותף אין לשוניות אחרות
    localStorage.setItem(RUN_LOCK_KEY, JSON.stringify({ tab: currentTabId(), at: Date.now() }));
    return true;
  } catch (e) {
    return true; // כשל-אחסון לא עוצר ריצה ("אצווה לא נתקעת")
  }
}

// רוכש את הנעילה. false = לשונית אחרת מחזיקה נעילה חיה.
function acquireRunLock() {
  const st = runLockState(readRunLock(), currentTabId());
  if (st.live && !st.mine) return false;
  return writeRunLock();
}

// מרענן נעילה שלנו. false = הנעילה אינה שלנו (לא נוגעים).
function refreshRunLock() {
  const st = runLockState(readRunLock(), currentTabId());
  if (st.live && !st.mine) return false;
  return writeRunLock();
}

// משחרר רק נעילה שלנו.
function releaseRunLock() {
  try {
    if (typeof localStorage === 'undefined') return;
    const lock = readRunLock();
    if (lock && lock.tab && lock.tab !== currentTabId()) return;
    localStorage.removeItem(RUN_LOCK_KEY);
  } catch (e) { /* noop */ }
}

// הודעה למשתמש כשלשונית אחרת רצה.
const RUN_LOCK_BUSY_MESSAGE = 'ריצה פעילה בלשונית אחרת של תלמו"ד. סגור אותה או המתן';

// ─── src/core/popup.js ───
// חלונית ההודעה המשותפת של האתר (ucMessagePopUp) — פורט מ"תלמוד - עזיבת תלמידים" v5
// (‏getMessagePopup:290, hideMessagePopup:303). אותה בקרה משמשת בכל האתר (למשל ולידציה
// "תאריך העזיבה לא יכול להיות לפני תאריך הקליטה..."). לעולם לא לוחצים על "המשך" (btnMOK)
// בשקט — הפעולה היחידה המותרת ל-hide היא ה-ModalPopupExtender.hide()/btnMCancel ("אישור").
// אין גישה ל-document/window ברמת המודול — רק בתוך גופי הפונקציות.


// ‏W3 (בדיקה רטובה 10.9.2026, F4): סיווג טהור של ההודעה. האתר מציג את הודעת-ההצלחה
// "הצלחה קליטת תלמיד הצליחה" באותה בקרה ועם כפתור "המשך" גלוי — ולכן hasContinue לבדו
// סיווג הצלחה כ"נחסם" ודילג על אימות-הגריד. טקסט הצלחה מנצח את הכפתורים; "לא הצליח" /
// "נכשל" אינם הצלחה (נופלים לסיווג לפי הכפתורים — fail-safe).
//   'success' — אינפורמטיבית; הקורא סוגר (hide, לא "המשך") וממשיך לאימות מול הגריד;
//   'confirm' — יש "המשך" ואין טקסט הצלחה → בקשת-אישור; לעולם לא נלחצת אוטומטית;
//   'info'    — רק "אישור" (שגיאה/ולידציה); 'unknown' — אין מידע.
// ‏1b (סקירת-בטיחות): "הצליח" לבדו רחב מדי (היה מסתיר בקשת-אישור לא-מוכרת כהצלחה). הצלחה = רק
// "הצלחה" בתחילת הטקסט (כותרת ההודעה) או "קליטת תלמיד הצליחה" (גוף ההודעה שנצפה, F4).
function classifyPopupText(text, flags) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const f = flags && typeof flags === 'object' ? flags : {};
  const negated = /לא\s+הצליח|נכשל/.test(t);
  if (!negated && (/^הצלחה/.test(t) || /קליטת תלמיד הצליחה/.test(t))) return 'success';
  if (f.hasContinue) return 'confirm';
  if (f.hasOkOnly) return 'info';
  return 'unknown';
}

// תווית כפתור (input.value או טקסט) — ללוג, כדי שהבדיקה הרטובה תספר מה האתר מציג.
function popupButtonLabel(el) {
  if (!el) return '';
  const raw = el.value || el.textContent || el.innerText || '';
  return String(raw).replace(/\s+/g, ' ').trim();
}

// שמות ה-ID נשמרים כפי שהם ב-depart-v5: btnMOK = "המשך" (אישור-רך), btnMCancel = "אישור"
// (אישור/סגירת שגיאה — למרות השם), btnMNo = "לא".
// מחזיר { text, hasContinue, hasOkOnly, kind, buttons } — ‏kind לפי classifyPopupText,
// ‏buttons = תוויות הכפתורים הגלויים (בסדר: המשך, לא, אישור). הדגלים הגולמיים נשמרים —
// הקורא מחליט "נחסם" רק כש-hasContinue && kind!=='success'.
function readMessagePopup() {
  const panel = $el('ucMessagePopUp_pnlMessagePopup');
  if (!isVisible(panel)) return null;
  const btnContinue = $el('ucMessagePopUp_btnMOK');
  const btnOk = $el('ucMessagePopUp_btnMCancel');
  const btnNo = $el('ucMessagePopUp_btnMNo');
  const hasContinue = isVisible(btnContinue);
  const hasOk = isVisible(btnOk);
  const hasNo = isVisible(btnNo);
  if (!hasContinue && !hasOk && !hasNo) return null; // פאנל מעובד אך בלי כפתור חי → לא פרומפט אמיתי
  let text = (panel.innerText || panel.textContent || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^\s*הודעה\s*/, '').trim();
  // תוויות הכפתורים נכללות ב-innerText של הפאנל — מקלפים אותן מהסוף, כמה שיש (עד 4).
  for (let i = 0; i < 4; i++) {
    const stripped = text.replace(/\s*(המשך|לא|אישור|ביטול|סגור)\s*$/, '').trim();
    if (stripped === text) break;
    text = stripped;
  }
  const buttons = [];
  if (hasContinue) buttons.push(popupButtonLabel(btnContinue) || 'המשך');
  if (hasNo) buttons.push(popupButtonLabel(btnNo) || 'לא');
  if (hasOk) buttons.push(popupButtonLabel(btnOk) || 'אישור');
  const hasOkOnly = hasOk && !hasContinue;
  return { text, hasContinue, hasOkOnly, kind: classifyPopupText(text, { hasContinue, hasOkOnly }), buttons };
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

// לוחץ "המשך" (btnMOK). לא נקרא לעולם מעצמו: רק מזרימה שבעל-המערכת סימן בה במפורש שהוא מאשר
// (למשל "אשר המשך" בלשונית הקליטה, סבב רטוב 31.10.2026: אזהרת "תלמיד זה רשום כבר במוסד אחר").
// postback צד-שרת: waitPRM נרשם *לפני*, והלחיצה נדחית ל-setTimeout(0). מחזיר {pressed, wait}.
function pressMessagePopupContinueAsync() {
  const btn = $el('ucMessagePopUp_btnMOK');
  if (!isVisible(btn)) return { pressed: false, wait: null };
  const wait = waitPRM({ startTimeoutMs: 1500, totalTimeoutMs: 15000 }); // (1) נרשם קודם
  setTimeout(() => { try { btn.click(); } catch (e) { /* אצווה לא נתקעת */ } }, 0); // (2) נדחה
  return { pressed: true, wait };
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

// ─── src/tools/absorb-dom.js ───
// קליטה — נגיעות ב-DOM של האתר: מזהי הפקדים, כתיבה לשדות בסדר-postback קשיח, חיפוש עם
// עדות-טריות, חלונית ההודעה, מודאל הקליטה, דף תלמיד-חדש. כל postback עובר דרך prm.js.
// אין גישה ל-document/window ברמת המודול.


const BASE = 'ContentPlaceHolder1_tabStudyTypeDetails_StudentList_ucStudentsSearchDetails';
const ABSORB_IDS = {
  tabContainer: 'ContentPlaceHolder1_tabStudyTypeDetails', // טאב 2 = רשימת תלמידים
  searchInput: `${BASE}_txtStudenPassport`,
  searchBtn: `${BASE}_btnSearch`,
  countLabel: `${BASE}_lblCountSearch`,
  grid: `${BASE}_gvIStudents`, // עמודה 3 = ת.ז./דרכון
  absorbBtnSuffix: 'btnStudentAcceptence3', // F5: המזהה המלא הוא ${BASE}_btnStudentAcceptence3; מחפשים לפי סיומת
  modal: `${BASE}_pnlAcceptStudent`,
  idTypeDdl: `${BASE}_ddlPopIdentityType`, // 1=ת.ז. 2=דרכון
  modalId: `${BASE}_txtIdentifier`,
  birthDate: `${BASE}_ctlBirthDate_txtDate`,
  countryDdl: `${BASE}_ddlCountryOfOrigine`,
  startDate: `${BASE}_ctlAcceptanceDate_txtDate`,
  confirmBtn: `${BASE}_LinkButton1`,
  cancelBtn: `${BASE}_LinkButton2`,
};

const NEW_BASE = 'ContentPlaceHolder1_TabsStudent_StudentDetails1_ucStudentDetails';
const ABSORB_NEW_IDS = {
  firstName: `${NEW_BASE}_txtFirstName`,
  lastName: `${NEW_BASE}_txtLastName`,
  birthDate: `${NEW_BASE}_ctlBirthDate_txtDate`,
  idField: `${NEW_BASE}_txtID`,
  gender: `${NEW_BASE}_ddlGender`,
  familyStatus: `${NEW_BASE}_ddlFamilyStatus`,
  stateHidden: `${NEW_BASE}_hidStudentState`,
  saveBtn: 'ContentPlaceHolder1_btnSave',
};

const ABSORB_GENDER_LABELS = { '1': 'זכר', '2': 'נקבה' };
const ABSORB_FAMILY_STATUS_LABELS = { '10': 'רווק', '20': 'נשוי', '30': 'גרוש', '40': 'אלמן' };

// F5 (30.10.2026): כפתור "קליטה" הוא a#ContentPlaceHolder1_tabStudyTypeDetails_StudentList_ucStudentsSearchDetails_btnStudentAcceptence3,
// לא ContentPlaceHolder1_btnStudentAcceptence3 כפי שהיה בקוד (באג). הסיומת יציבה: מחפשים לפיה.
function absorbButtonEl() {
  try {
    return typeof document !== 'undefined' ? document.querySelector(`[id$="${ABSORB_IDS.absorbBtnSuffix}"]`) : null;
  } catch (e) {
    return null;
  }
}

const FIELD_WAIT = { startTimeoutMs: 400, totalTimeoutMs: 8000 };
const SELECT_WAIT = { startTimeoutMs: 1000, totalTimeoutMs: 10000 };
const POPUP_HIDE_MS = 5000;
const STALE_ATTR = 'data-absorb-stale';

// כתיבה לשדה = פוטנציאלית postback (AutoPostBack). רושמים המתנה קודם, כותבים מ-setTimeout(0).
function absorbSetAndWait(el, value, opts) {
  const o = opts || {};
  const wait = waitPRM(o.opts || (o.select ? SELECT_WAIT : FIELD_WAIT));
  setTimeout(() => {
    try {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (!o.select) el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (e) {
      log('[שדה] כתיבה נכשלה: ' + (e && e.message));
    }
  }, 0);
  return wait;
}

// בחירה ב-<select> עם אימות שהאופציה קיימת לפני, ושהערך נתפס אחרי.
async function absorbSelectOption(el, value, label, display) {
  const shown = display || value;
  const options = Array.from((el && el.options) || []);
  if (!options.some((o) => o.value === value)) {
    return { ok: false, reason: `הערך "${shown}" בעמודת "${label}" (קוד ${value}) לא קיים ברשימת האתר` };
  }
  await absorbSetAndWait(el, value, { select: true });
  if (el.value !== value) return { ok: false, reason: `בחירת "${shown}" בעמודת "${label}" נכשלה` };
  return { ok: true };
}

// לחיצה על פקד: postback דרך ה-href אם יש, אחרת click נדחה אחרי רישום ההמתנה.
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

// ולידטורי צד-לקוח של קבוצה (במקום WebForm_DoPostBackWithOptions שעוקפים).
function absorbRunClientValidation(group) {
  try {
    if (typeof window === 'undefined' || typeof window.Page_ClientValidate !== 'function') return { ok: true, messages: [] };
    if (window.Page_ClientValidate(group || '')) return { ok: true, messages: [] };
    try { window.Page_BlockSubmit = false; } catch (e) { /* noop */ }
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

// לשונית 2 "רשימת תלמידים" בדף סוג-הלימוד. ממצא 9 + F4 (מתוקן): החלפת לשונית היא postback א-סינכרוני
// (UpdatePanel) שבמהלכו הפקדים נבנים מחדש, ולכן כמו כל נגיעה בדף: רושמים waitPRM, קוראים מ-setTimeout(0),
// וממתינים לסיום; הקורא קורא את הפקדים (שדה החיפוש, הכפתור, הגריד) מחדש רק אחרי שההמתנה הסתיימה.
// מחזיר תמיד {ok, started}; לא זורק.
function absorbActivateStudentsTab() {
  let tabs = null;
  try {
    if (typeof window !== 'undefined' && typeof window.$find === 'function') tabs = window.$find(ABSORB_IDS.tabContainer);
  } catch (e) { tabs = null; }
  try {
    if (!tabs || typeof tabs.set_activeTabIndex !== 'function' || tabs.get_activeTabIndex() === 2) {
      return Promise.resolve({ ok: true, started: false }); // הפקדים בדרך כלל כבר ב-DOM
    }
  } catch (e) {
    return Promise.resolve({ ok: true, started: false });
  }
  const wait = waitPRM({ startTimeoutMs: 600, totalTimeoutMs: NAV_POSTBACK_BUDGET_MS }); // ממצא ב-2
  setTimeout(() => {
    try { tabs.set_activeTabIndex(2); } catch (e) { log('[לשונית] הפעלת "רשימת תלמידים" נכשלה: ' + (e && e.message)); }
  }, 0);
  return wait;
}

// ─── חיפוש עם עדות-טריות: מסמנים את אזור-התוצאות "ישן" לפני, postback מחליף את האלמנטים ─
function markStale(el) {
  try { if (el && typeof el.setAttribute === 'function') el.setAttribute(STALE_ATTR, '1'); } catch (e) { /* noop */ }
}
function isStale(el) {
  try { return !!(el && typeof el.getAttribute === 'function' && el.getAttribute(STALE_ATTR) === '1'); } catch (e) { return false; }
}

function readAbsorbGridRows() {
  const grid = $el(ABSORB_IDS.grid);
  if (!grid || typeof grid.querySelectorAll !== 'function' || isStale(grid)) return [];
  return Array.from(grid.querySelectorAll('tr')).map(
    (tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim())
  );
}

function readCountText() {
  const el = $el(ABSORB_IDS.countLabel);
  return el ? (el.textContent || '').trim() : '';
}

function searchFreshness() {
  const countEl = $el(ABSORB_IDS.countLabel);
  const gridEl = $el(ABSORB_IDS.grid);
  const countFresh = !!countEl && !isStale(countEl);
  const gridFresh = !!gridEl && !isStale(gridEl);
  return { countFresh, gridFresh, refreshed: countFresh && (gridEl ? gridFresh : true) };
}

async function searchOnce(input, btn, value, gen) {
  markStale($el(ABSORB_IDS.grid));
  markStale($el(ABSORB_IDS.countLabel));
  await absorbSetAndWait(input, value);
  await sleepCheckStop(120, gen);
  const res = await absorbFireElement(btn, { startTimeoutMs: 3000, totalTimeoutMs: 20000 });
  await sleepCheckStop(250, gen);
  const countText = readCountText();
  const count = absorbParseCount(countText);
  const started = !!(res && res.started);
  const ok = !!(res && res.ok);
  const fresh = searchFreshness();
  const executed = started && ok && (fresh.countFresh || fresh.gridFresh);
  log(`[חיפוש] ${maskId(value)} → ${countText || '(ללא תווית ספירה)'} · started=${started} ok=${ok} countFresh=${fresh.countFresh} gridFresh=${fresh.gridFresh}`);
  return { ok, started, executed, refreshed: fresh.refreshed, countFresh: fresh.countFresh, countText, count, reason: res && res.reason };
}

// חיפוש עם ניסיון-חוזר אחד כשאין עדות שהוא רץ.
async function absorbSearch(input, btn, value, gen) {
  let res = await searchOnce(input, btn, value, gen);
  if (res.executed) return res;
  log('[חיפוש] אין עדות שהחיפוש רץ — ניסיון נוסף');
  await sleepCheckStop(500, gen);
  res = await searchOnce(input, btn, value, gen);
  if (!res.executed) log('[חיפוש] גם הניסיון השני לא הופעל');
  return res;
}

const ABSORB_SEARCH_FAILED_ACTION = 'החיפוש ברשימת התלמידים לא הופעל. רענן את הדף, ודא שהלשונית "רשימת תלמידים" נפתחת, והרץ שוב את השורה';
const ABSORB_GRID_STALE_ACTION = 'החיפוש לא רענן את הרשימה. חפש את המזהה ידנית ברשימת התלמידים: אם קיים, אין מה לעשות; אם לא, הרץ שוב את השורה';

function absorbSearchFailReason(res) {
  if (!res) return 'החיפוש לא הופעל';
  if (!res.started) return 'לחיצת החיפוש לא הפעילה בקשה לשרת' + (res.reason ? ` (${res.reason})` : '');
  if (!res.ok) return 'החיפוש נכשל או פג-זמן בשרת' + (res.reason ? ` (${res.reason})` : '');
  if (res.countFresh === false) return 'תווית הספירה לא התרעננה — מה שמוצג אינו תוצאת החיפוש הזה';
  return 'החיפוש רץ אך תוצאותיו לא התעדכנו בדף';
}

function absorbCountGate(res) {
  return res && res.countFresh ? res.count : null;
}

// ─── חלונית ההודעה ──────────────────────────────────────────────────────────

async function absorbHidePopup(gen) {
  const hide = hideMessagePopupAsync();
  if (hide && hide.wait) {
    await Promise.race([hide.wait, sleep(POPUP_HIDE_MS)]);
    await sleepCheckStop(150, gen);
  }
  if (hide && !hide.hidden) log('[הודעה] לא נמצאה דרך לסגור את החלונית בלי ללחוץ "המשך" — ממשיכים');
  return hide;
}

function absorbLogPopup(where, pop) {
  const buttons = Array.isArray(pop.buttons) ? pop.buttons.join(', ') : '';
  log(`[הודעה] ${where}: ${maskIdsInText(pop.text)} · סוג=${pop.kind || '?'} · כפתורים=[${buttons}]`);
}

// קורא חלונית אם יש, סוגר אותה, ומחזיר {pop, blocked} — blocked = בקשת-אישור ("המשך" שאינו הצלחה).
async function absorbReadAndHidePopup(where, gen) {
  const pop = readMessagePopup();
  if (!pop) return { pop: null, blocked: false };
  absorbLogPopup(where, pop);
  await absorbHidePopup(gen);
  const blocked = !!pop.hasContinue && pop.kind !== 'success';
  if (pop.kind === 'success') log('[הודעה] הודעת-הצלחה — ממשיכים לאימות בגריד');
  await sleepCheckStop(200, gen);
  return { pop, blocked };
}

// ─── מודאל הקליטה ───────────────────────────────────────────────────────────

function absorbModalVisible() {
  return isVisible($el(ABSORB_IDS.modal));
}

async function absorbCloseAcceptModal() {
  try {
    const cancel = $el(ABSORB_IDS.cancelBtn);
    if (!cancel || !absorbModalVisible()) return false;
    await absorbFireElement(cancel, { startTimeoutMs: 1500, totalTimeoutMs: 15000 });
    await sleep(250);
    return true;
  } catch (e) {
    log('[מודאל] סגירת חלון הקליטה נכשלה: ' + (e && e.message));
    return false;
  }
}

// ─── דף תלמיד-חדש ───────────────────────────────────────────────────────────

function absorbNewStudentPageMatches(identity) {
  const el = $el(ABSORB_NEW_IDS.idField);
  const val = el ? String(el.value || '').trim() : '';
  return !!val && absorbNormalizeId(val) === absorbNormalizeId(identity);
}

// ממתין לסיום ה-postback (או לתקציב). ניווט מלא מפרק את הדף — הריצה ממשיכה אחרי הטעינה.
async function absorbWaitOutcome(prmWait, budgetMs, gen) {
  let prmResult = null;
  prmWait.then((r) => { prmResult = r || { ok: true }; });
  const kindBefore = getPage().kind;
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs + 2000) {
    checkStop('outcome-wait', gen);
    if (prmResult) { await sleep(250); return { kind: 'prm', result: prmResult }; }
    if (getPage().kind !== kindBefore) return { kind: 'pageChanged' };
    await sleep(150);
  }
  return { kind: 'timeout' };
}

// ─── src/tools/absorb-flow.js ───
// קליטה — הזרימה: לכל תלמיד (1) להגיע לדף סוג-הלימוד הנכון, (2) חיפוש מקדים, (3) "קליטה" +
// חלונית הודעה, (4) מילוי המודאל, (5) אישור, (6) דף תלמיד-חדש אם צריך, (7) אימות מול הגריד.
// ניווט מלא טוען דף חדש; המצב נשמר ב-sessionStorage וההמשך (resume) קורה אחרי הטעינה.
// אין גישה ל-document/window ברמת המודול.


const STUDENT_TIMEOUT_MS = 60000;
const CONFIRM_BUDGET_MS = 25000;
const SAVE_BUDGET_MS = 30000;
const NAV_WATCHDOG_MS = 12000;
const NAVIGATED = { __navigated: true }; // ניווט מלא נורה — ההמשך אחרי טעינת הדף
const CONTINUE = { __continue: true }; // התוצאה כבר נרשמה — לתלמיד הבא

// ─── טקסטי "מה לעשות" (ממצא 12): תמיד עם "איך", לא רק "מה" ───────────────────
const SUPPORT_URL = 'https://github.com/mdj441/talmud-scripts/issues';
const LOG_ACTION = `לחץ "העתק יומן" (ממוסך) וצרף אותו לדיווח בדף התמיכה של הכלי: ${SUPPORT_URL}`;
const MANUAL_ABSORB_ACTION = 'לחץ "קליטה" בדף סוג-הלימוד, מלא את המזהה (ולדרכון גם תאריך לידה וארץ) ולחץ "אישור"';
function verifyListAction(code, branch) {
  return `ודא ברשימת התלמידים של סוג ${code} בסניף ${branch} שהתלמיד נקלט, ואם אינו שם, קלוט אותו ידנית`;
}
function searchListAction(code, branch) {
  return `חפש את המזהה ברשימת התלמידים של סוג ${code} בסניף ${branch}; אם אינו שם, קלוט ידנית`;
}
function manualRowAction() {
  return `בצע את השורה הזו ידנית באתר (${MANUAL_ABSORB_ACTION}). אם זה חוזר, ${LOG_ACTION}`;
}

// ─── hooks לפאנל ────────────────────────────────────────────────────────────
function absorbSetHooks(hooks) { S.hooks = hooks || {}; }
function absorbGetResults() { return S.results.slice(); }
function absorbIsRunning() { return S.running; }
// "עסוק" = רץ, או שנורה ניווט מלא והריצה ממתינה לטעינת הדף (S.running=false בכוונה, אך אסור להתחיל ריצה חדשה).
// ממצא ב-7: ‏navigating נשאר דלוק גם אחרי ש-beforeunload ניקה את כלב-השומר, כדי ש"התחל" בחלון הזה לא
// ידרוס את התור השמור. נכבה ב-runQueue / finishRun / absorbStop / ניקוי התור.
function absorbIsBusy() { return S.running || watchdogTimer !== null || navigating; }
function hook(name, ...args) { try { if (S.hooks[name]) S.hooks[name](...args); } catch (e) { /* אצווה לא נתקעת */ } }

// ─── ניווט מלא: האם הדף מתחיל להיפרק, וכלב-שומר אם לא ─────────────────────
let unloadSeen = false;
let unloadWatched = false;
let watchdogTimer = null;
let navigating = false;

function watchUnload() {
  if (unloadWatched) return;
  try {
    if (typeof window === 'undefined') return;
    unloadWatched = true;
    const mark = () => { unloadSeen = true; clearWatchdog(); };
    window.addEventListener('beforeunload', mark, true);
    window.addEventListener('pagehide', mark, true);
  } catch (e) { /* noop */ }
}

function beginNavigation() {
  watchUnload();
  unloadSeen = false;
  navigating = true;
  hook('onNavigating');
}

function clearWatchdog() {
  if (watchdogTimer !== null) { try { clearTimeout(watchdogTimer); } catch (e) { /* noop */ } watchdogTimer = null; }
}

// ניווט שהוכרז ולא הביא טעינת דף תוך 12 שניות: אם הדף בכל זאת מתאים למשימה — ממשיכים;
// אחרת התלמיד מקבל "שגיאה" עם הוראה ידנית, והאצווה ממשיכה. לעולם לא קופאים על "ממתין".
function armWatchdog(taskIdx) {
  clearWatchdog();
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    if (unloadSeen || S.running) return;
    const task = S.queue[taskIdx];
    const page = getPage();
    const b = task ? normalizeBranch(task.branch) : null;
    // דף סוג-הלימוד הנכון (התווית = הסניף, ה-h1 = הקוד), או דף מוסד שה-h1 שלו הוא הסניף (משם הגריד): "מתאים"
    const fits = !!task && ((page.kind === 'studyType' && page.branch === b && page.studyType === String(task.studyType) && absorbBranchSourceTrusted(page.branchSource))
      || (page.kind === 'institute' && page.branch === b && page.branchSource === 'h1'));
    if (fits) {
      log('[ניווט] הדף התעדכן בלי טעינה מלאה — ממשיכים במקום');
    } else {
      log(`[ניווט] לא הגיעה טעינת דף תוך ${Math.round(NAV_WATCHDOG_MS / 1000)} שניות — התלמיד מסומן ומדלגים`);
      if (task && absorbShouldRecord(S.lastRecordedIdx, taskIdx)) {
        recordResult(makeAbsorbResult(task, ABSORB_STATUS.ERROR, 'הניווט לדף סוג-הלימוד לא הביא טעינת דף', manualStudyTypeAction(task.branch, task.studyType)), null, taskIdx);
      }
      S.curIdx = Math.max(S.curIdx, taskIdx + 1);
      saveAbsorbState();
    }
    Promise.resolve().then(() => runQueue()).catch((e) => log('[ניווט] המשך במקום נכשל: ' + (e && e.message)));
  }, NAV_WATCHDOG_MS);
}

// ─── שלב 1: הדף הנכון ───────────────────────────────────────────────────────
// עובדות F1/F3: המסלול המהיר ("כבר בדף הנכון") מותר רק כשזה דף סוג-לימוד שהתווית lblInstituteBranchNumber
// שלו היא הסניף המבוקש וה-h1 שלו הוא הקוד המבוקש. h1 ריק (GET ישיר), תווית של סניף אחר, או דף מוסד:
// מנווטים דרך העץ והגריד (gotoStudyType), כמו המשתמש באתר. אין כתובות ישירות ואין מפות.
async function ensureStudyTypePage(task, gen) {
  const branch = normalizeBranch(task.branch);
  const code = String(task.studyType);
  const page = getPage();
  if (page.kind === 'studyType') {
    if (page.studyType === code && page.branch === branch && absorbBranchSourceTrusted(page.branchSource)) return { ok: true, navigated: false };
    if (!page.studyType) log('[ניווט] דף סוג-לימוד בלי כותרת (h1 ריק: כניסה ישירה לפי כתובת): לא מזוהה, מנווטים דרך העץ והגריד');
    else if (page.studyType !== code) log(`[ניווט] דף סוג-לימוד ${page.studyType}; צריך סוג ${code} בסניף ${branch}`);
    else if (!page.branch) log(`[ניווט] דף סוג-לימוד ${code}, אך הסניף לא ניתן לזיהוי מהתווית: מנווטים דרך העץ כדי לוודא`);
    else log(`[ניווט] דף סוג-לימוד ${code} של סניף ${page.branch} (לפי התווית); צריך סניף ${branch}`);
  }
  checkStop('before-nav', gen);
  saveAbsorbState();
  beginNavigation();
  const res = await gotoStudyType(branch, code);
  if (absorbIsCancelled(gen)) checkStop('nav-cancelled', gen);
  if (absorbNavTimeoutIsNavigation(res, unloadSeen)) {
    // ממצא ב-2: pageRedirect בלי endRequest: הזמן פג אחרי שהדף התחיל להיפרק. זו טעינת דף, לא כשל.
    log('[ניווט] הפוסטבק המנווט פג-זמן אחרי שהדף התחיל להיפרק: ממתינים לטעינה');
    return { ok: true, navigated: true };
  }
  if (!res || res.ok === false) {
    if (res && res.notFound) {
      return {
        ok: false, reason: res.reason,
        action: /בעץ/.test(String(res.reason || ''))
          ? `בדוק שסניף ${branch} מופיע בעץ-הצד של האתר. אם הוא קיים, פתח אותו ולחץ "התחל" שוב על השורה הזו`
          : `בדוק בדף המוסד של סניף ${branch}, בלשונית "סוגי לימוד למוסד", שסוג ${code} קיים ואינו "סגור". אם הוא קיים, פתח אותו ולחץ "התחל" שוב על השורה הזו`,
      };
    }
    return { ok: false, reason: (res && res.reason) || 'הניווט נכשל', action: manualStudyTypeAction(branch, code) };
  }
  const how = res.method === 'url' ? 'מעבר לדף המוסדות (אין עץ בדף הזה; משם העץ והגריד)'
    : res.method === 'grid' ? 'גריד סוגי-הלימוד בדף המוסד'
      : res.method === 'tree' ? 'עץ הסניפים (טעינת דף; משם הגריד)' : res.method || '?';
  log(`[ניווט] → סניף ${branch} סוג ${code} · ${how}`);
  if (res.status && /סגור/.test(res.status)) log(`[ניווט] שים לב: סוג לימוד ${code} מסומן "${res.status}" בגריד`);
  return { ok: true, navigated: true };
}

// ─── דף תלמיד-חדש ───────────────────────────────────────────────────────────

// יוצאים מדף תלמיד-חדש לדף סוג-הלימוד: דרך העץ אם יש בדף, אחרת דרך דף המוסדות (ומשם העץ והגריד אחרי הטעינה).
async function leaveNewStudentPage(task, recorded, gen) {
  if (absorbIsCancelled(gen)) { log('[תלמיד חדש] ניסיון שבוטל — לא יוצאים מהדף'); return CONTINUE; }
  saveAbsorbState();
  beginNavigation();
  const res = await gotoStudyType(task.branch, task.studyType);
  if (res && res.ok !== false) return NAVIGATED;
  log(`[ניווט] היציאה מדף תלמיד-חדש נכשלה: ${res && res.reason}`);
  if (recorded) {
    recorded.detail = [recorded.detail, res && res.reason].filter(Boolean).join(' | ');
    saveAbsorbState();
  }
  return CONTINUE;
}

// הערת חלונית-מידע שנראתה אחרי "שמירה" (ממצא 12: נכנסת ל-detail של התוצאה, לא רק ליומן).
function pendingSaveNote() {
  return (S.pendingSave && S.pendingSave.note) || '';
}

async function handleNewStudentPage(task, identity, mk, gen, myIdx) {
  log('[תלמיד חדש] נחתנו בדף תלמיד-חדש');

  // ממצא 4: "שמירה" כטעינה מלאה שחזרה לאותו דף (למשל כשל ולידציה בשרת). לא שומרים שוב: אוספים
  // את מה שהדף אומר, רושמים תוצאה, ויוצאים. בלי זה הדף היה מתמלא ונשמר שוב, עד תקרת הנחיתות.
  if (S.justSaved && absorbNormalizeId(S.justSaved) === absorbNormalizeId(identity)) {
    log('[תלמיד חדש] הדף נטען מחדש אחרי "שמירה": לא שומרים שוב');
    const { pop, blocked } = await absorbReadAndHidePopup('אחרי שמירה (טעינה חוזרת)', gen);
    const errs = absorbCollectValidationMessages();
    const note = [pendingSaveNote(), pop ? pop.text : ''].filter(Boolean).join(' | ');
    S.justSaved = null;
    let res;
    if (errs.length) res = mk(ABSORB_STATUS.ERROR, errs.join(' | '), 'תקן את הפרטים לפי ההודעה והרץ שוב, או השלם ידנית בדף התלמיד');
    else if (blocked) res = mk(`${ABSORB_STATUS.BLOCKED}: ${pop.text}`, pop.text, 'המערכת מבקשת אישור "המשך" בשמירת התלמיד. הסקריפט לא מאשר לבד: פתח את דף התלמיד, קרא את ההודעה והחלט');
    else res = mk(ABSORB_STATUS.SAVED_UNVERIFIED, note || 'דף תלמיד-חדש נטען מחדש אחרי השמירה; לא ידוע אם נשמר', verifyListAction(task.studyType, task.branch));
    if (!recordResult(res, gen, myIdx)) return CONTINUE;
    return leaveNewStudentPage(task, res, gen);
  }

  const ns = task.newStudent || {};
  const birthDate = ns.birthDate || task.birthDate || '';
  const missing = [];
  if (!ns.firstName) missing.push('שם פרטי');
  if (!ns.lastName) missing.push('שם משפחה');
  if (!birthDate) missing.push('תאריך לידה');

  if (missing.length) {
    log(`[תלמיד חדש] חסרים נתונים (${missing.join(', ')}) — לא שומרים`);
    const res = mk(ABSORB_STATUS.NEW_STUDENT_MISSING, `חסר: ${missing.join(', ')}`,
      `התלמיד לא מוכר למערכת. הוסף לשורה שלו את העמודות ${missing.join(', ')} (ואם צריך גם מגדר ומצב משפחתי; ברירת-המחדל: זכר, נשוי) והרץ אותה שוב`);
    if (!recordResult(res, gen, myIdx)) return CONTINUE;
    return leaveNewStudentPage(task, res, gen);
  }

  const first = $el(ABSORB_NEW_IDS.firstName);
  const last = $el(ABSORB_NEW_IDS.lastName);
  const birth = $el(ABSORB_NEW_IDS.birthDate);
  if (!first || !last || !birth) return mk(ABSORB_STATUS.ERROR, 'שדות דף תלמיד-חדש לא נמצאו', 'מלא את פרטי התלמיד החדש ידנית בדף שנפתח ולחץ "שמירה"');

  await absorbSetAndWait(first, ns.firstName);
  await absorbSetAndWait(last, ns.lastName);
  await absorbSetAndWait(birth, birthDate);
  if (ns.gender) {
    const g = $el(ABSORB_NEW_IDS.gender);
    if (g) {
      const r = await absorbSelectOption(g, ns.gender, 'מגדר', ABSORB_GENDER_LABELS[ns.gender]);
      if (!r.ok) return mk(ABSORB_STATUS.ERROR, r.reason, 'תקן את עמודת "מגדר" (זכר/נקבה) והרץ שוב, או בחר ידנית בדף התלמיד ולחץ "שמירה"');
    }
  }
  if (ns.familyStatus) {
    const f = $el(ABSORB_NEW_IDS.familyStatus);
    if (f) {
      const r = await absorbSelectOption(f, ns.familyStatus, 'מצב משפחתי', ABSORB_FAMILY_STATUS_LABELS[ns.familyStatus]);
      if (!r.ok) return mk(ABSORB_STATUS.ERROR, r.reason, 'תקן את עמודת "מצב משפחתי" (רווק/נשוי/גרוש/אלמן) והרץ שוב, או בחר ידנית בדף התלמיד ולחץ "שמירה"');
    }
  }
  await sleepCheckStop(200, gen);
  checkStop('new-student-before-save', gen);

  const saveBtn = $el(ABSORB_NEW_IDS.saveBtn);
  if (!saveBtn) return mk(ABSORB_STATUS.ERROR, 'כפתור "שמירה" לא נמצא בדף תלמיד-חדש', 'שמור ידנית בדף התלמיד');
  const v = absorbRunClientValidation('Validation');
  if (!v.ok) {
    return mk(ABSORB_STATUS.ERROR, 'ולידציה בדף תלמיד-חדש: ' + (v.messages.join(' | ') || 'שדה לא תקין'),
      'תקן בשורה: שם פרטי ושם משפחה באותיות עבריות בלבד, תאריך לידה DD/MM/YYYY וגיל 16 לפחות. הרץ שוב');
  }

  // "שמירה" עלולה לטעון דף אחר. מסמנים לפני, כדי שההמשך ידע לאמת "נקלט (תלמיד חדש)".
  // ממצא 4: pendingSave חי ב-S ונשמר בכל saveAbsorbState עד רישום התוצאה של השורה הזו.
  S.pendingSave = { idx: myIdx, identity, note: '' };
  S.justSaved = identity;
  saveAbsorbState();
  beginNavigation();
  log('[תלמיד חדש] שמירה…');
  const wait = absorbFireElement(saveBtn, { startTimeoutMs: 3000, totalTimeoutMs: SAVE_BUDGET_MS });
  const outcome = await absorbWaitOutcome(wait, SAVE_BUDGET_MS, gen);
  log(`[תלמיד חדש] תוצאת השמירה: ${outcome.kind}`);
  await sleepCheckStop(300, gen);

  const { pop, blocked } = await absorbReadAndHidePopup('אחרי שמירת תלמיד חדש', gen);
  if (pop && pop.text && S.pendingSave) { S.pendingSave.note = pop.text; saveAbsorbState(); } // ממצא 12
  if (blocked) {
    S.justSaved = null;
    S.pendingSave = null;
    saveAbsorbState();
    return mk(`${ABSORB_STATUS.BLOCKED}: ${pop.text}`, pop.text, 'המערכת מבקשת אישור "המשך" בשמירת התלמיד. הסקריפט לא מאשר לבד: פתח את דף התלמיד, קרא את ההודעה והחלט');
  }

  // ממצא ב-6: לפי הכתובת, לא לפי getPage: "שמירה" שנשארת באותו מסמך משנה את hidStudentState מ--1
  // ל-1, ואז getPage מסווג 'other' והתלמיד היה מקבל "נשמר - לאמת ידנית" במקום מעבר לרשימה ואימות.
  const hrefNow = (typeof location !== 'undefined' && location.href) || '';
  if (classifyUrl(hrefNow) === 'newStudent') {
    const errs = absorbCollectValidationMessages();
    if (errs.length) {
      S.justSaved = null;
      S.pendingSave = null;
      saveAbsorbState();
      return mk(ABSORB_STATUS.ERROR, errs.join(' | '), 'תקן את הפרטים לפי ההודעה והרץ שוב, או השלם ידנית בדף התלמיד');
    }
    // נשארנו בדף (עם או בלי הודעת הצלחה) — האמת נמצאת ברשימת התלמידים של סוג-הלימוד.
    log('[תלמיד חדש] נשארנו בדף אחרי השמירה — עוברים לרשימת התלמידים לאימות');
    beginNavigation();
    const res = await gotoStudyType(task.branch, task.studyType);
    if (res && res.ok !== false) return NAVIGATED;
    S.justSaved = null;
    return mk(ABSORB_STATUS.SAVED_UNVERIFIED, [pendingSaveNote(), 'השמירה בוצעה אך לא ניתן היה לחזור לרשימת התלמידים'].filter(Boolean).join(' | '), verifyListAction(task.studyType, task.branch));
  }

  // הדף התחלף בלי טעינה מלאה (נדיר): אם זה דף סוג-הלימוד — מאמתים כאן.
  return verifyAfterNewStudent(task, identity, mk, gen);
}

async function verifyAfterNewStudent(task, identity, mk, gen) {
  const page = getPage();
  const note = pendingSaveNote();
  if (page.kind === 'studyType' && page.studyType === String(task.studyType)) {
    await absorbActivateStudentsTab();
    const input = $el(ABSORB_IDS.searchInput);
    const btn = $el(ABSORB_IDS.searchBtn);
    if (input && btn) {
      const search = await absorbSearch(input, btn, identity, gen);
      if (search.executed) {
        const grid = analyzeGrid(readAbsorbGridRows(), identity, absorbCountGate(search));
        if (grid.found) {
          S.justSaved = null;
          return mk(ABSORB_STATUS.OK_NEW, note, '');
        }
        if (grid.unreadable) {
          S.justSaved = null;
          return mk(ABSORB_STATUS.VERIFY, [note, absorbUnreadableGridDetail(search.count)].filter(Boolean).join(' | '), searchListAction(task.studyType, task.branch));
        }
        if (grid.singleOther) {
          S.justSaved = null;
          return mk(ABSORB_STATUS.VERIFY, [note, `ברשימה שורה אחת עם מזהה אחר: ${grid.singleOther}`].filter(Boolean).join(' | '), searchListAction(task.studyType, task.branch));
        }
      }
    }
  }
  S.justSaved = null;
  return mk(ABSORB_STATUS.SAVED_UNVERIFIED, [note, 'התלמיד נשמר; הקליטה לא אומתה ברשימה'].filter(Boolean).join(' | '), verifyListAction(task.studyType, task.branch));
}

// ─── תלמיד יחיד ─────────────────────────────────────────────────────────────
async function processStudent(task, gen) {
  const myIdx = S.curIdx;
  const identity = task.idType === 'tz' ? padId9(task.identity) : String(task.identity).trim();
  const mk = (status, detail, action) => makeAbsorbResult(task, status, detail, action);
  const branch = normalizeBranch(task.branch);
  const code = String(task.studyType);

  log(`▶ סניף ${branch} · סוג ${code} · ${maskId(identity)} · ${task.idType === 'passport' ? 'דרכון' : 'ת.ז.'}`);
  checkStop('start', gen);

  // נחתנו בדף תלמיד-חדש (אחרי "אישור" במודאל שטען דף חדש)
  if (getPage().kind === 'newStudent') {
    if (absorbNewStudentPageMatches(identity)) return handleNewStudentPage(task, identity, mk, gen, myIdx);
    log('[תלמיד חדש] הדף שייך למזהה אחר — יוצאים ממנו');
    const left = await leaveNewStudentPage(task, null, gen);
    if (left === NAVIGATED) return NAVIGATED;
    return mk(ABSORB_STATUS.ERROR, 'נפתח דף תלמיד-חדש של מזהה אחר ולא ניתן היה לצאת ממנו', manualStudyTypeAction(branch, code));
  }

  if (task.idType === 'passport') {
    if (!task.birthDate) return mk(ABSORB_STATUS.ERROR, 'דרכון ללא תאריך לידה', 'הוסף לשורה עמודת "תאריך לידה" (DD/MM/YYYY) והרץ שוב');
    if (!task.countryValue) return mk(ABSORB_STATUS.ERROR, `ארץ דרכון חסרה או לא מוכרת: "${task.country || 'ריק'}"`, 'כתוב בעמודת "ארץ" שם מהרשימה (כפתור "רשימת ארצות") והרץ שוב');
  }

  // ── שלב 1: הדף הנכון ──
  const nav = await ensureStudyTypePage(task, gen);
  if (!nav.ok) return mk(ABSORB_STATUS.ERROR, nav.reason, nav.action);
  if (nav.navigated) return NAVIGATED;
  checkStop('after-nav', gen);
  await absorbActivateStudentsTab(); // ממצא 9: ממתינים ל-postback של הלשונית לפני החיפוש
  await sleepCheckStop(250, gen);

  // ── שלב 2: חיפוש מקדים ──
  const searchInput = $el(ABSORB_IDS.searchInput);
  const searchBtn = $el(ABSORB_IDS.searchBtn);
  if (!searchInput || !searchBtn) return mk(ABSORB_STATUS.ERROR, 'שדה או כפתור החיפוש ברשימת התלמידים לא נמצאו', 'פתח את הלשונית "רשימת תלמידים" בדף סוג-הלימוד, רענן, והרץ שוב. אם חוזר: ייתכן שאין לך הרשאה לסוג לימוד זה');
  let pre = await absorbSearch(searchInput, searchBtn, identity, gen);
  let decision = absorbPrecheckDecision(pre);
  if (decision === 'retry') {
    log('[חיפוש] התווית מדווחת תוצאות אך הרשימה לא התרעננה — חיפוש חוזר');
    await sleepCheckStop(500, gen);
    pre = await absorbSearch(searchInput, searchBtn, identity, gen);
    decision = absorbPrecheckDecision(pre);
    if (decision === 'retry') return mk(ABSORB_STATUS.ERROR, `החיפוש דיווח ${pre.count} תוצאות אך הרשימה לא התרעננה`, ABSORB_GRID_STALE_ACTION);
  }
  if (decision !== 'analyze') return mk(ABSORB_STATUS.ERROR, absorbSearchFailReason(pre), ABSORB_SEARCH_FAILED_ACTION);

  const justSaved = S.justSaved && absorbNormalizeId(S.justSaved) === absorbNormalizeId(identity);
  const savedNote = justSaved ? pendingSaveNote() : '';
  // ממצא ב-9: "אישור" שנלחץ לשורה הזו והביא טעינה מלאה של אותו דף: "נמצא ברשימה" = נקלט, לא "כבר קיים".
  const justConfirmed = !!(S.pendingConfirm && S.pendingConfirm.idx === myIdx && absorbNormalizeId(S.pendingConfirm.identity) === absorbNormalizeId(identity));
  const preGrid = analyzeGrid(readAbsorbGridRows(), identity, absorbCountGate(pre));
  if (preGrid.found) {
    const via = preGrid.matchType === 'single-row-fallback' ? 'התאמה לפי שורה יחידה ברשימה' : '';
    if (justSaved) { S.justSaved = null; log('[תלמיד חדש] נמצא ברשימה אחרי השמירה → נקלט'); return mk(ABSORB_STATUS.OK_NEW, [savedNote, via].filter(Boolean).join(' | '), ''); }
    if (justConfirmed) { log('[אישור] הדף נטען מחדש אחרי "אישור" והתלמיד ברשימה → נקלט'); return mk(ABSORB_STATUS.OK, ['אומת ברשימה אחרי טעינת הדף', via].filter(Boolean).join(' | '), ''); }
    log('[קליטה] כבר קיים בסוג הלימוד');
    return mk(ABSORB_STATUS.EXISTS, via, '');
  }
  if (preGrid.unreadable) {
    // ממצא ב-3: התווית מדווחת תוצאות אך לא נקראו מזהים: לא לוחצים "קליטה" על תלמיד שאולי ברשימה.
    S.justSaved = null;
    log(`[חיפוש] התווית מדווחת ${pre.count} תוצאות אך לא נקראו מזהים ברשימה: לאמת ידנית`);
    return mk(ABSORB_STATUS.VERIFY, [savedNote, absorbUnreadableGridDetail(pre.count)].filter(Boolean).join(' | '), searchListAction(code, branch));
  }
  if (preGrid.singleOther) {
    // ממצא 10: החיפוש החזיר שורה אחת עם מזהה אחר. לא הצלחה ולא "לא נמצא": המשתמש מאמת.
    S.justSaved = null;
    log(`[קליטה] ברשימה שורה אחת עם מזהה אחר (${maskId(preGrid.singleOther)}): לאמת ידנית`);
    return mk(ABSORB_STATUS.VERIFY, [savedNote, `ברשימה שורה אחת עם מזהה אחר: ${preGrid.singleOther}`].filter(Boolean).join(' | '), searchListAction(code, branch));
  }
  if (justSaved) {
    // נשמר בדף תלמיד-חדש אך לא ברשימה — לא קולטים שוב, מדווחים לבדיקה ידנית.
    S.justSaved = null;
    return mk(ABSORB_STATUS.SAVED_UNVERIFIED, [savedNote, 'התלמיד נשמר בדף תלמיד-חדש אך לא נמצא ברשימת התלמידים'].filter(Boolean).join(' | '), verifyListAction(code, branch));
  }
  checkStop('after-precheck', gen);

  // ── שלב 3: "קליטה" ──
  const absorbBtn = absorbButtonEl(); // F5: לפי סיומת btnStudentAcceptence3, לא לפי מזהה מלא
  if (!absorbBtn) return mk(ABSORB_STATUS.ERROR, 'כפתור "קליטה" לא נמצא בדף', `בדוק שיש לך הרשאת קליטה לסוג לימוד זה ושאינו "סגור"; אם יש, ${MANUAL_ABSORB_ACTION}`);
  try {
    const click = await absorbFireElement(absorbBtn, { startTimeoutMs: 3000, totalTimeoutMs: 20000 });
    if (!click.ok) log(`[קליטה] postback לא תקין: ${click.reason}`);
    await sleepCheckStop(300, gen);

    let popupDetail = '';
    const afterOpen = await absorbReadAndHidePopup('אחרי "קליטה"', gen);
    if (afterOpen.pop) {
      popupDetail = afterOpen.pop.text;
      if (afterOpen.blocked) return mk(`${ABSORB_STATUS.BLOCKED}: ${popupDetail}`, popupDetail, 'המערכת מבקשת אישור "המשך". הסקריפט לא מאשר לבד: לחץ "קליטה" ידנית, קרא את ההודעה והחלט');
    }
    checkStop('after-absorb-click', gen);

    // ── שלב 4: המודאל ──
    let modalOpen = absorbModalVisible();
    if (!modalOpen) {
      try { await waitFor(() => absorbModalVisible(), { timeout: 4000, interval: 100 }); modalOpen = true; } catch (e) { modalOpen = false; }
    }
    if (!modalOpen) {
      return mk(ABSORB_STATUS.ERROR, popupDetail || 'חלון הקליטה לא נפתח',
        popupDetail ? 'המערכת החזירה הודעה במקום לפתוח את חלון הקליטה. קרא אותה בעמודת "פירוט" וטפל ידנית' : 'לחץ "קליטה" ידנית בדף סוג-הלימוד ובדוק אם מופיעה הודעה');
    }

    const idTypeValue = task.idType === 'passport' ? '2' : '1';
    const ddlType = $el(ABSORB_IDS.idTypeDdl);
    if (ddlType && ddlType.value !== idTypeValue) {
      await absorbSetAndWait(ddlType, idTypeValue, { select: true });
      await sleepCheckStop(150, gen);
    }
    const modalId = $el(ABSORB_IDS.modalId);
    if (!modalId) return mk(ABSORB_STATUS.ERROR, 'שדה המזהה בחלון הקליטה לא נמצא', MANUAL_ABSORB_ACTION);
    await absorbSetAndWait(modalId, identity);
    await sleepCheckStop(120, gen);

    if (task.idType === 'passport') {
      const birthEl = $el(ABSORB_IDS.birthDate);
      if (!birthEl) return mk(ABSORB_STATUS.ERROR, 'שדה תאריך לידה בחלון הקליטה לא נמצא', MANUAL_ABSORB_ACTION);
      await absorbSetAndWait(birthEl, task.birthDate);
      await sleepCheckStop(120, gen);
      const countryEl = $el(ABSORB_IDS.countryDdl);
      if (!countryEl) return mk(ABSORB_STATUS.ERROR, 'שדה ארץ דרכון בחלון הקליטה לא נמצא', MANUAL_ABSORB_ACTION);
      const country = await absorbSelectOption(countryEl, task.countryValue, 'ארץ', task.country);
      if (!country.ok) return mk(ABSORB_STATUS.ERROR, country.reason, 'תקן את עמודת "ארץ" לשם מהרשימה (כפתור "רשימת ארצות") והרץ שוב');
      await sleepCheckStop(150, gen);
    }

    const startDate = startDateFromPanel();
    if (startDate) {
      const startEl = $el(ABSORB_IDS.startDate);
      if (startEl && startEl.value !== startDate) await absorbSetAndWait(startEl, startDate);
    }
    // סבב רטוב 31.10.2026: האתר דורש תאריך קליטה >= היום (cvalAcceptanceDate). היומן מספר מה נשלח בפועל.
    try { const d = $el(ABSORB_IDS.startDate); if (d) log(`[מודאל] תאריך תחילת לימודים בחלון: "${d.value || ''}"`); } catch (e) { /* יומן בלבד */ }
    checkStop('after-fields', gen);

    // ── שלב 5: אישור ──
    const confirmBtn = $el(ABSORB_IDS.confirmBtn);
    if (!confirmBtn) return mk(ABSORB_STATUS.ERROR, 'כפתור "אישור" לא נמצא בחלון הקליטה', MANUAL_ABSORB_ACTION);
    const v = absorbRunClientValidation('PopValidation');
    if (!v.ok) return mk(ABSORB_STATUS.ERROR, 'ולידציה בחלון הקליטה: ' + (v.messages.join(' | ') || 'שדה לא תקין'), 'תקן בשורה את המזהה, תאריך הלידה או הארץ לפי ההודעה, והרץ שוב');

    // "אישור" עלול לטעון דף תלמיד-חדש, או (ממצא ב-9) לטעון מחדש את אותו דף: מסמנים לפני.
    S.pendingConfirm = { idx: myIdx, identity };
    saveAbsorbState();
    beginNavigation();
    const confirmWait = absorbFireElement(confirmBtn, { startTimeoutMs: 3000, totalTimeoutMs: CONFIRM_BUDGET_MS });
    const outcome = await absorbWaitOutcome(confirmWait, CONFIRM_BUDGET_MS, gen);
    log(`[אישור] תוצאה: ${outcome.kind}`);

    // ── שלב 6: דף תלמיד-חדש באותו מסמך (נדיר; בדרך כלל זו טעינה מלאה שממשיכה ב-resume) ──
    if (getPage().kind === 'newStudent') {
      if (absorbNewStudentPageMatches(identity)) return handleNewStudentPage(task, identity, mk, gen, myIdx);
      const res = mk(ABSORB_STATUS.ERROR, 'נפתח דף תלמיד-חדש של מזהה אחר', searchListAction(code, branch));
      if (!recordResult(res, gen, myIdx)) return CONTINUE;
      return leaveNewStudentPage(task, res, gen);
    }

    // ── שלב 7: הודעה → מודאל → אימות ──
    await sleepCheckStop(300, gen);
    const afterConfirm = await absorbAfterConfirmPopup(gen);
    if (afterConfirm.pop) {
      if (afterConfirm.blocked) return mk(`${ABSORB_STATUS.BLOCKED}: ${afterConfirm.pop.text}`, afterConfirm.pop.text, 'המערכת מבקשת אישור "המשך" (למשל מעבר בין מוסדות). הסקריפט לא מאשר לבד: בצע את הקליטה ידנית והחלט על ההודעה');
      popupDetail = afterConfirm.pop.text;
    }
    if (absorbModalVisible()) {
      const errs = absorbCollectValidationMessages();
      return mk(ABSORB_STATUS.NOT_COMPLETED, errs.join(' | ') || popupDetail || 'חלון הקליטה נשאר פתוח', 'פתח את חלון הקליטה ידנית, קרא את הודעת השגיאה ותקן את השורה');
    }
    checkStop('before-verify', gen);

    const verifyInput = $el(ABSORB_IDS.searchInput);
    const verifyBtn = $el(ABSORB_IDS.searchBtn);
    if (!verifyInput || !verifyBtn) return mk(ABSORB_STATUS.SAVED_UNVERIFIED, popupDetail || 'שדות החיפוש נעלמו אחרי הקליטה', verifyListAction(code, branch));
    const verify = await absorbSearch(verifyInput, verifyBtn, identity, gen);
    if (!verify.executed) return mk(ABSORB_STATUS.SAVED_UNVERIFIED, absorbSearchFailReason(verify), ABSORB_SEARCH_FAILED_ACTION);
    const found = analyzeGrid(readAbsorbGridRows(), identity, absorbCountGate(verify));
    if (found.found) { log('◀ נקלט'); return mk(ABSORB_STATUS.OK, popupDetail || (found.matchType === 'single-row-fallback' ? 'התאמה לפי שורה יחידה ברשימה' : ''), ''); }
    if (found.unreadable) {
      log(`◀ הרשימה מדווחת ${verify.count} תוצאות אך לא נקראו מזהים: לאמת ידנית`);
      return mk(ABSORB_STATUS.VERIFY, [popupDetail, absorbUnreadableGridDetail(verify.count)].filter(Boolean).join(' | '), searchListAction(code, branch));
    }
    if (found.singleOther) {
      log(`◀ ברשימה שורה אחת עם מזהה אחר (${maskId(found.singleOther)}): לאמת ידנית`);
      return mk(ABSORB_STATUS.VERIFY, [popupDetail, `ברשימה שורה אחת עם מזהה אחר: ${found.singleOther}`].filter(Boolean).join(' | '), searchListAction(code, branch));
    }
    log('◀ לא אומת ברשימה');
    return mk(ABSORB_STATUS.UNVERIFIED, popupDetail || 'לא נמצא ברשימה אחרי הקליטה', searchListAction(code, branch));
  } finally {
    try {
      // סבב רטוב 31.10.2026: "עצור" אחרי שה-postback של "קליטה" כבר יצא משאיר את חלון הקליטה פתוח
      // (עם רקע שחוסם את הדף, כולל העץ). סגירה ב"ביטול" היא בטוחה: שום דבר לא נשלח. שאר הדף: לא נוגעים.
      if (absorbIsCancelled(gen)) {
        if (absorbModalVisible()) { log('[מודאל] ניסיון שבוטל — סוגרים את חלון הקליטה ב"ביטול", לא נוגעים בשאר הדף'); await absorbCloseAcceptModal(); }
        else log('[מודאל] ניסיון שבוטל — לא נוגעים בדף');
      } else if (absorbModalVisible()) await absorbCloseAcceptModal();
    } catch (e) { /* אצווה לא נתקעת */ }
  }
}

function startDateFromPanel() {
  try { const v = S.hooks.getStartDate ? S.hooks.getStartDate() : ''; return v ? String(v).trim() : ''; } catch (e) { return ''; }
}

function continueOtherInstituteFromPanel() {
  try { return !!(S.hooks.getContinueOtherInstitute && S.hooks.getContinueOtherInstitute()); } catch (e) { return false; }
}

// ─── חלונית ההודעה אחרי "אישור" (סבב רטוב 31.10.2026) ────────────────────────
// האתר מזהיר על תלמיד "רשום כבר במוסד אחר" ומבקש "המשך" (= מעבר בין מוסדות; לימודיו שם מסתיימים).
// ברירת-המחדל נשארת: לא מאשרים לבד → "נחסם". רק כשבעל-המערכת סימן בפאנל "אשר המשך" בתחילת הריצה,
// לוחצים "המשך", ממתינים ל-postback, וקוראים את ההודעה הבאה (באתר: "הצלחה מעבר תלמיד הצליח").
// כל חלונית אחרת עם "המשך" (טקסט שונה) נשארת "נחסם" גם כשהאפשרות מסומנת.
const OTHER_INSTITUTE_RE = /רשום כבר במוסד אחר/;
async function absorbAfterConfirmPopup(gen) {
  const pop = readMessagePopup();
  if (!pop) return { pop: null, blocked: false };
  const confirmKind = !!pop.hasContinue && pop.kind !== 'success';
  if (!(confirmKind && S.continueOtherInstitute && OTHER_INSTITUTE_RE.test(pop.text))) {
    return absorbReadAndHidePopup('אחרי אישור', gen);
  }
  log(`[הודעה] אחרי אישור: ${pop.text} · סוג=${pop.kind} · כפתורים=[${(pop.buttons || []).join(', ')}]`);
  log('[המשך] "אשר המשך" מסומן בפאנל: לוחצים "המשך" (מעבר בין מוסדות; לימודיו במוסד האחר מסתיימים)');
  const pressed = pressMessagePopupContinueAsync();
  if (!pressed.pressed) { log('[המשך] כפתור "המשך" לא נמצא — נשאר "נחסם"'); return { pop, blocked: true }; }
  if (pressed.wait) await pressed.wait;
  await sleepCheckStop(300, gen);
  const after = await absorbReadAndHidePopup('אחרי המשך', gen);
  if (after.pop && after.pop.kind !== 'success') return { pop: after.pop, blocked: !!after.blocked };
  return { pop: after.pop || pop, blocked: false, continued: true };
}

// ─── timeout + ניסיון חוזר אחד ──────────────────────────────────────────────
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const clearAll = () => { clearTimeout(timer); clearInterval(poller); };
    const timer = setTimeout(() => { clearAll(); reject(new Error(`תהליך תקוע — חרג מ-${Math.round(ms / 1000)} שניות`)); }, ms);
    const poller = setInterval(() => { if (absorbIsStopped()) { clearAll(); reject(absorbStopError('timeout-poller')); } }, 200);
    promise.then((val) => { clearAll(); resolve(val); }, (err) => { clearAll(); reject(err); });
  });
}

async function processStudentSafe(task) {
  const myIdx = S.curIdx;
  const errResult = (detail) => makeAbsorbResult(task, ABSORB_STATUS.ERROR, detail, manualRowAction());
  try {
    return await withTimeout(processStudent(task, absorbNextGeneration()), STUDENT_TIMEOUT_MS);
  } catch (err) {
    if (isAbsorbStopError(err)) throw err;
    absorbNextGeneration();
    log(`[ניסיון 1] ${isAbsorbCancelError(err) ? 'בוטל' : 'נכשל'}: ${err && err.message}`);
    await absorbCloseAcceptModal();
    if (absorbIsStopped()) throw absorbStopError('between-attempts');
    if (!absorbShouldRecord(S.lastRecordedIdx, myIdx)) { log('[ניסיון 2] לא נדרש — התוצאה לשורה הזו כבר נרשמה'); return CONTINUE; }
    try {
      await sleep(1000);
      log(`[ניסיון 2] ${maskId(task.identity)}`);
      return await withTimeout(processStudent(task, absorbNextGeneration()), STUDENT_TIMEOUT_MS);
    } catch (err2) {
      if (isAbsorbStopError(err2)) throw err2;
      log(`[ניסיון 2] ${isAbsorbCancelError(err2) ? 'בוטל' : 'נכשל'}: ${err2 && err2.message} — מדלגים`);
      await absorbCloseAcceptModal();
      if (!absorbShouldRecord(S.lastRecordedIdx, myIdx)) return CONTINUE;
      return errResult(`2 ניסיונות: ${err2 && err2.message}`);
    }
  }
}

// ─── התור ───────────────────────────────────────────────────────────────────
function recordResult(result, gen, idx) {
  const at = typeof idx === 'number' ? idx : S.curIdx;
  if (absorbIsCancelled(gen)) { log('[תוצאה] ניסיון שבוטל ניסה לרשום תוצאה — מתעלמים'); return false; }
  if (!absorbShouldRecord(S.lastRecordedIdx, at)) { log(`[תוצאה] לשורה ${at + 1} כבר נרשמה תוצאה`); return false; }
  S.lastRecordedIdx = at;
  S.results.push(result);
  S.curIdx = Math.max(S.curIdx, at + 1);
  if (S.pendingSave && S.pendingSave.idx === at) S.pendingSave = null; // ממצא 4: השמירה נסגרה עם השורה
  if (S.pendingConfirm && S.pendingConfirm.idx === at) S.pendingConfirm = null; // ממצא ב-9
  absorbResetLandings();
  saveAbsorbState();
  hook('onResult', result, S.results);
  return true;
}

// ─── נעילת-ריצה בין לשוניות (ממצא 5) ────────────────────────────────────────
let lockTimer = null;

function startLockRefresh() {
  if (lockTimer !== null) return;
  lockTimer = setInterval(() => { refreshRunLock(); }, RUN_LOCK_REFRESH_MS);
}

function stopLockRefresh() {
  if (lockTimer !== null) { try { clearInterval(lockTimer); } catch (e) { /* noop */ } lockTimer = null; }
}

// false = לשונית אחרת של תלמו"ד רצה עכשיו. הפאנל מציג את ההודעה (hook onLocked).
function takeRunLock(where) {
  if (acquireRunLock()) { startLockRefresh(); return true; }
  log(`[נעילה] ${where}: ${RUN_LOCK_BUSY_MESSAGE}`);
  hook('onLocked', RUN_LOCK_BUSY_MESSAGE);
  return false;
}

function dropRunLock() {
  stopLockRefresh();
  releaseRunLock();
}

function fillRemaining(status, detail, action) {
  while (S.curIdx < S.queue.length) {
    S.results.push(makeAbsorbResult(S.queue[S.curIdx], status, detail, action));
    S.curIdx++;
  }
  S.lastRecordedIdx = S.curIdx - 1;
  saveAbsorbState();
}

function finishRun() {
  S.running = false;
  navigating = false;
  clearAbsorbState();
  clearAbsorbStop();
  dropRunLock(); // ממצא 5
  const report = buildRemainingReport(S.results);
  saveAbsorbLastResults(S.results, report); // ממצא 6: תמונת-תוצאות אחרונה שורדת טעינת-דף
  log(`═══ סיום · ${report.summary}`);
  hook('onDone', S.results, report);
}

async function runQueue() {
  S.running = true;
  navigating = false;
  clearWatchdog();
  watchUnload();
  startLockRefresh();
  log(`🚀 ריצה — ${S.queue.length} תלמידים, מתחילים בשורה ${S.curIdx + 1}`);
  hook('onStart', S.queue, S.curIdx);

  while (S.curIdx < S.queue.length) {
    if (absorbIsStopped()) {
      log('⛔ נעצר — ממלאים את שארית התור');
      fillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
      break;
    }
    const taskIdx = S.curIdx;
    const task = S.queue[taskIdx];
    hook('onProgress', taskIdx, S.queue.length, task);

    let result;
    try {
      result = await processStudentSafe(task);
    } catch (stopErr) {
      log(`⛔ נעצר באמצע עיבוד: ${stopErr && stopErr.message}`);
      recordResult(makeAbsorbResult(task, ABSORB_STATUS.STOPPED, 'נעצר באמצע עיבוד', 'בדוק את מצב התלמיד באתר והרץ שוב את השורה'), null, taskIdx);
      fillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
      break;
    }

    if (result === NAVIGATED || (result && result.__navigated)) {
      S.running = false;
      log('… טעינת דף — ההמשך אחרי הטעינה');
      armWatchdog(taskIdx);
      return;
    }
    if (result === CONTINUE || (result && result.__continue)) {
      if (S.curIdx <= taskIdx) {
        recordResult(makeAbsorbResult(task, ABSORB_STATUS.ERROR, 'לא נרשמה תוצאה לשורה הזו', manualRowAction()), null, taskIdx);
      }
      S.curIdx = Math.max(S.curIdx, taskIdx + 1);
      saveAbsorbState();
      await sleep(250);
      continue;
    }
    recordResult(result, null, taskIdx);
    await sleep(250);
  }
  finishRun();
}

// מחזיר false כשלשונית אחרת רצה (ממצא 5); אחרת את ה-Promise של הריצה.
async function absorbStartRun(tasks) {
  if (!takeRunLock('התחלה')) return false;
  clearAbsorbStop();
  absorbNextGeneration();
  clearWatchdog();
  absorbResetRun();
  absorbResetLandings();
  S.queue = Array.isArray(tasks) ? tasks.slice() : [];
  S.startedAt = new Date().toISOString();
  S.continueOtherInstitute = continueOtherInstituteFromPanel();
  if (S.continueOtherInstitute) log('[התחלה] "אשר המשך" מסומן: אזהרת "רשום כבר במוסד אחר" תאושר אוטומטית');
  saveAbsorbState();
  return runQueue();
}

// ממצא 6: תמונת-התוצאות של הריצה האחרונה (לתצוגה באתחול הלשונית). null כשאין.
function absorbLastResults() {
  return loadAbsorbLastResults();
}

function absorbHasSavedQueue() {
  const st = loadAbsorbState();
  return !!(st && Array.isArray(st.queue) && st.queue.length && (st.curIdx || 0) < st.queue.length);
}

function absorbSavedQueueInfo() {
  const st = loadAbsorbState();
  if (!st || !Array.isArray(st.queue) || !st.queue.length) return null;
  return { total: st.queue.length, curIdx: st.curIdx || 0, startedAt: st.startedAt || null, stale: absorbQueueIsStale(st.startedAt, Date.now(), ABSORB_MAX_QUEUE_AGE_MS) };
}

function absorbDiscardSavedQueue() {
  absorbNextGeneration();
  clearWatchdog();
  navigating = false;
  absorbResetRun();
  clearAbsorbState();
  clearAbsorbStop();
  dropRunLock();
  log('[המשך] התור השמור נמחק לבקשת המשתמש');
  return true;
}

// ממצא 11: ההמשך האוטומטי שייך לדפי הקליטה בלבד. דף אחר (למשל ההודעות), או דף תלמיד-חדש של
// מזהה אחר (המשתמש פתח ידנית), אינם מקום להשתלט עליו: הפאנל מציג "יש תור פתוח" ומחכה ללחיצה.
function absorbForeignPage(page, task) {
  if (!page || page.kind === 'other') return true;
  if (page.kind === 'newStudent') {
    const identity = task ? (task.idType === 'tz' ? padId9(task.identity) : String(task.identity || '').trim()) : '';
    return !identity || !absorbNewStudentPageMatches(identity);
  }
  return false;
}

// בטעינת דף: אם יש תור שמור, ממשיכים. תור ישן (>30 דק') או דף זר ממשיכים רק אחרי "המשך" בפאנל
// (opts.force; ‏allowStale נשמר כשם ישן). ‏false = לא התחילה ריצה כאן.
async function absorbResumeIfPending(opts) {
  if (S.running) return false;
  const force = !!(opts && (opts.force || opts.allowStale));
  const st = loadAbsorbState();
  if (!st || !Array.isArray(st.queue) || !st.queue.length) return false;

  if (absorbIsStopped()) {
    // ממצא 6: "עצור" נלחץ בזמן טעינת-דף. לא מנקים בשקט: השארית מסומנת "נעצר" והתוצאות מוצגות.
    log('[המשך] דגל עצירה אחרי טעינת דף: מסיימים את הריצה עם "נעצר"');
    S.queue = st.queue;
    S.results = Array.isArray(st.results) ? st.results : [];
    S.curIdx = st.curIdx || 0;
    S.lastRecordedIdx = S.curIdx - 1;
    S.startedAt = st.startedAt || null;
    fillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
    finishRun();
    return false;
  }

  const info = { total: st.queue.length, curIdx: st.curIdx || 0, startedAt: st.startedAt || null, stale: false, reason: '' };
  if (!force && absorbQueueIsStale(st.startedAt, Date.now(), ABSORB_MAX_QUEUE_AGE_MS)) {
    log(`[המשך] תור שמור מ-${st.startedAt} ישן מ-${Math.round(ABSORB_MAX_QUEUE_AGE_MS / 60000)} דקות — לא ממשיכים אוטומטית`);
    hook('onStaleQueue', Object.assign(info, { stale: true, reason: 'stale' }));
    return false;
  }
  if (!force && absorbForeignPage(getPage(), st.queue[st.curIdx || 0])) {
    log('[המשך] הדף הזה אינו חלק מהקליטה: לא ממשיכים אוטומטית; "המשך" בפאנל ינווט');
    hook('onStaleQueue', Object.assign(info, { reason: 'foreign-page' }));
    return false;
  }
  if (!takeRunLock('המשך')) return false; // ממצא 5: התור נשאר שמור; ינסה שוב בטעינה הבאה או ב"המשך"

  S.queue = st.queue;
  S.results = Array.isArray(st.results) ? st.results : [];
  S.curIdx = st.curIdx || 0;
  S.lastRecordedIdx = S.curIdx - 1;
  S.startedAt = st.startedAt || null;
  S.pendingSave = st.pendingSave && typeof st.pendingSave === 'object' ? st.pendingSave : null;
  // ממצא ב-9: סמן "אישור נלחץ" שייך לשורה הנוכחית בלבד
  S.pendingConfirm = st.pendingConfirm && typeof st.pendingConfirm === 'object' && st.pendingConfirm.idx === S.curIdx ? st.pendingConfirm : null;
  if (S.pendingConfirm) log('[המשך] "אישור" נלחץ לפני הטעינה: אם התלמיד ברשימה, זה "נקלט"');
  S.continueOtherInstitute = !!st.continueOtherInstitute;
  if (S.curIdx >= S.queue.length) { finishRun(); return false; }

  if (S.pendingSave && S.pendingSave.idx === S.curIdx) {
    S.justSaved = S.pendingSave.identity;
    log('[המשך] תלמיד חדש נשמר לפני הטעינה — נאמת ברשימה');
    saveAbsorbState();
  } else {
    S.pendingSave = null;
  }

  const landings = absorbBumpLandings(S.curIdx);
  log(`[המשך] שורה ${S.curIdx + 1}/${S.queue.length} · טעינה ${landings} · דף ${getPage().kind}`);
  if (landings > ABSORB_MAX_LANDINGS) {
    const stuck = S.queue[S.curIdx];
    log(`⚠️ תלמיד ${maskId(stuck.identity)} — ${landings} טעינות דף בלי סיום; מדלגים`);
    recordResult(makeAbsorbResult(stuck, ABSORB_STATUS.SKIPPED, `לולאת ניווט: ${landings} טעינות דף ללא התקדמות`, manualStudyTypeAction(stuck.branch, stuck.studyType)));
    if (S.curIdx >= S.queue.length) { finishRun(); return false; }
  }

  hook('onResume', S.queue, S.results, S.curIdx);
  S.running = true; // לפני ההמתנה — שלחיצת "התחל" בשנייה הזו לא תפתח ריצה מקבילה
  try {
    await sleep(900); // MS AJAX מסיים לאתחל
    await runQueue();
  } catch (e) {
    S.running = false;
    throw e;
  }
  return true;
}

function absorbStop() {
  requestAbsorbStop();
  absorbNextGeneration();
  clearWatchdog();
  navigating = false;
  if (!S.running) {
    if (S.queue.length && S.curIdx < S.queue.length) {
      fillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
      finishRun();
    } else {
      clearAbsorbState();
      clearAbsorbStop();
      dropRunLock();
    }
  }
}

// ─── src/tools/absorb-ui.js ───
// לשונית "קליטת תלמידים" בחלונית המאוחדת. הזרימה ב-absorb-flow.js; כאן הממשק:
// טבלת-הזנה (שורה לתלמיד, בחירה מרשימות: סניף, סוג לימוד, ארץ; שדות לפי סוג המזהה), הדבקה מאקסל
// שממלאת את הטבלה, טעינת/הורדת אקסל, אימות לכל שורה, התחל/עצור, תוצאות, דוח "מה נשאר".
// מסלול-פרסור אחד: הטבלה → טקסט עם כותרת → parseAbsorbInput (כמו הדבקה). אין גישה ל-document ברמת המודול.


const P = 'tt-absorb';
const COUNTRY_NAMES = COUNTRIES.map((c) => c.he).sort((a, b) => a.localeCompare(b, 'he'));
// סוגי-לימוד מוכרים (מהאתר, סניף 00) לרשימת-הבחירה כשאין גריד סוגי-לימוד בדף
const COMMON_STUDY_TYPES = ['300', '600', '605', '700', '705', '708', '720', '725', '728'];
const GENDERS = [['', ''], ['זכר', 'זכר'], ['נקבה', 'נקבה']];
const FAMILY = [['', ''], ['רווק', 'רווק'], ['נשוי', 'נשוי'], ['גרוש', 'גרוש'], ['אלמן', 'אלמן']];

let ui = null;
let rows = []; // [{ fields: {...} }] - מקור-האמת להרצה
let results = [];
let total = 0;
let awaitingErrorConfirm = false;
let showExtra = false; // עמודות תלמיד-חדש (שם, משפחה, מגדר, מצב)

const RESULT_COLUMNS = [
  { key: 'branch', label: 'סניף', center: true, width: '44px' },
  { key: 'studyType', label: 'סוג', center: true, width: '44px' },
  { key: 'identity', label: 'ת.ז./דרכון', mono: true },
  { key: 'status', label: 'סטטוס' },
];

function emptyRow() {
  return { fields: { branch: '', studyType: '', identifier: '', firstName: '', lastName: '', birthDate: '', country: '', gender: '', familyStatus: '' } };
}

// ─── רשימות-בחירה: מהדף בלבד (עץ-הצד, גריד סוגי-הלימוד), בלי מפות נלמדות ───────────────
function knownBranches(page) {
  const set = new Set(readBranchesFromTree()); // העץ קיים בדף המוסד ובדף סוג-הלימוד (F2)
  if (page && page.branch) set.add(page.branch);
  return Array.from(set).sort();
}

function knownStudyTypes(branch, page) {
  const set = new Set();
  if (page && page.kind === 'institute' && (!branch || page.branch === branch)) {
    try {
      const table = document.querySelector('table[id$="gvStudyType"]');
      if (table) for (const st of gridStudyTypes(gridToRows(table))) set.add(st.code);
    } catch (e) { /* לא קריטי */ }
  }
  if (page && page.studyType && (!branch || page.branch === branch)) set.add(page.studyType);
  if (!set.size) for (const c of COMMON_STUDY_TYPES) set.add(c);
  return Array.from(set).sort((a, b) => Number(a) - Number(b));
}

function datalistsHtml(page) {
  const opt = (v) => `<option value="${esc(v)}"></option>`;
  return `<datalist id="${P}-dl-branches">${knownBranches(page).map(opt).join('')}</datalist>
    <datalist id="${P}-dl-studytypes">${knownStudyTypes(null, page).map(opt).join('')}</datalist>
    <datalist id="${P}-dl-countries">${COUNTRY_NAMES.map(opt).join('')}</datalist>`;
}

// ─── הטבלה ─────────────────────────────────────────────────────────────────
function rowIsBlank(r) { return ABSORB_FIELD_ORDER.every((k) => !String(r.fields[k] || '').trim()); }

function validateRows() {
  const filled = rows.filter((r) => !rowIsBlank(r));
  const parsed = parseAbsorbInput(absorbFieldRowsToText(filled));
  // מספר השורה בפרסור = אינדקס+2 (שורת הכותרת היא 1)
  const errorByIdx = new Map();
  for (const e of parsed.errors) errorByIdx.set(e.line - 2, e.reason);
  return { tasks: parsed.tasks, errors: parsed.errors, errorByIdx, filled };
}

function cellInput(i, key, value, { list, placeholder = '', disabled = false, mono = false, width } = {}) {
  return `<input type="text" class="tt-input${mono ? ' tt-mono' : ''}" data-i="${i}" data-k="${key}" value="${esc(value)}"${list ? ` list="${list}"` : ''}
    placeholder="${esc(placeholder)}"${disabled ? ' disabled' : ''}${width ? ` style="width:${width}"` : ''} autocomplete="off">`;
}

function cellSelect(i, key, value, options) {
  return `<select class="tt-select" data-i="${i}" data-k="${key}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function rowState(r) {
  const f = r.fields;
  const blank = rowIsBlank(r);
  // דרכון: אותיות במזהה, או (31.10.2026) מזהה ספרתי עם ארץ מלאה (דרכון שכולו ספרות; תא הארץ פתוח להקלדה תמיד)
  const passport = !!f.identifier && (detectIdType(f.identifier).type === 'passport' || (!!String(f.country || '').trim() && !/^(tz|ת\.?ז\.?)\s*[:=]/i.test(f.identifier)));
  const needBirth = passport || !!(f.firstName || f.lastName);
  return { blank, passport, needBirth };
}

function rowHtml(i, r, err) {
  const f = r.fields;
  const { blank, passport, needBirth } = rowState(r);
  return `<tr class="${err ? 'tt-r-bad' : ''}" data-i="${i}"${err ? ` title="${esc(err)}"` : ''}>
    <td class="tt-center tt-hint tt-rownum">${blank ? '' : i + 1}</td>
    <td>${cellInput(i, 'branch', f.branch, { list: `${P}-dl-branches`, placeholder: '00', mono: true, width: '52px' })}</td>
    <td>${cellInput(i, 'studyType', f.studyType, { list: `${P}-dl-studytypes`, placeholder: '600', mono: true, width: '60px' })}</td>
    <td class="tt-center tt-hint tt-type-label" style="white-space:nowrap">${blank ? '' : (passport ? 'דרכון' : 'ת.ז.')}</td>
    <td>${cellInput(i, 'identifier', f.identifier, { placeholder: 'ת.ז. או דרכון', mono: true, width: '110px' })}</td>
    <td class="tt-cell-birth${needBirth ? '' : ' tt-cell-off'}">${cellInput(i, 'birthDate', f.birthDate, { placeholder: needBirth ? 'DD/MM/YYYY' : '', mono: true, width: '92px' })}</td>
    <td class="tt-cell-country${passport ? '' : ' tt-cell-off'}">${cellInput(i, 'country', f.country, { list: `${P}-dl-countries`, placeholder: passport ? 'בחר ארץ' : '', width: '110px' })}</td>
    ${showExtra ? `<td>${cellInput(i, 'firstName', f.firstName, { width: '80px' })}</td><td>${cellInput(i, 'lastName', f.lastName, { width: '80px' })}</td>
    <td>${cellSelect(i, 'gender', f.gender, GENDERS)}</td><td>${cellSelect(i, 'familyStatus', f.familyStatus, FAMILY)}</td>` : ''}
    <td class="tt-cell-del">${blank ? '' : `<button type="button" class="tt-btn tt-btn-subtle tt-btn-sm" data-del="${i}" title="מחק שורה">×</button>`}</td>
  </tr>`;
}

// אימות + סיכום + סימון שורות, בלי לבנות מחדש את השדות (השדה שבפוקוס נשאר בפוקוס).
function refreshMarks() {
  const v = validateRows();
  let filledIdx = -1;
  rows.forEach((r, i) => {
    const tr = document.querySelector(`#${P}-grid tr[data-i="${i}"]`);
    if (!tr) return;
    const { blank, passport, needBirth } = rowState(r);
    if (!blank) filledIdx++;
    const err = blank ? '' : (v.errorByIdx.get(filledIdx) || '');
    tr.classList.toggle('tt-r-bad', !!err);
    if (err) tr.setAttribute('title', err); else tr.removeAttribute('title');
    const num = tr.querySelector('.tt-rownum'); if (num) num.textContent = blank ? '' : String(i + 1);
    const type = tr.querySelector('.tt-type-label'); if (type) type.textContent = blank ? '' : (passport ? 'דרכון' : 'ת.ז.');
    const birth = tr.querySelector('.tt-cell-birth'); if (birth) { birth.classList.toggle('tt-cell-off', !needBirth); const inp = birth.querySelector('input'); if (inp) inp.placeholder = needBirth ? 'DD/MM/YYYY' : ''; }
    const country = tr.querySelector('.tt-cell-country'); if (country) { country.classList.toggle('tt-cell-off', !passport); const inp = country.querySelector('input'); if (inp) inp.placeholder = passport ? 'בחר ארץ' : ''; }
    const del = tr.querySelector('.tt-cell-del'); if (del && !blank && !del.firstChild) del.innerHTML = `<button type="button" class="tt-btn tt-btn-subtle tt-btn-sm" data-del="${i}" title="מחק שורה">×</button>`;
  });
  const problems = v.errors.length;
  setText(`${P}-grid-summary`, v.filled.length
    ? `${v.tasks.length} שורות מוכנות להרצה${problems ? ` · ${problems} שורות עם שגיאה (מסומנות באדום; העמד את העכבר על השורה לפירוט)` : ''}`
    : 'אין שורות. הדבק מאקסל, טען קובץ, או מלא שורה בטבלה');
  renderErrors(problems ? v.errors : [], v.tasks.length);
  return v;
}

function renderTable() {
  if (!rows.length || !rowIsBlank(rows[rows.length - 1])) rows.push(emptyRow());
  const head = `<tr><th style="width:26px"></th><th>סניף</th><th>סוג לימוד</th><th>סוג מזהה</th><th>ת.ז./דרכון</th>
    <th>תאריך לידה</th><th>ארץ</th>${showExtra ? '<th>שם פרטי</th><th>שם משפחה</th><th>מגדר</th><th>מצב משפחתי</th>' : ''}<th style="width:22px"></th></tr>`;
  setHtml(`${P}-grid`, `<table class="tt-grid-input"><thead>${head}</thead><tbody>${rows.map((r, i) => rowHtml(i, r, '')).join('')}</tbody></table>`);
  return refreshMarks();
}

function onCellInput(e) {
  const el = e.target;
  if (!el || el.dataset == null || el.dataset.k === undefined) return;
  const i = Number(el.dataset.i);
  if (!rows[i]) return;
  rows[i].fields[el.dataset.k] = el.value;
  if (awaitingErrorConfirm) resetStartButton();
  // השורה האחרונה התמלאה → מוסיפים שורה ריקה חדשה בסוף (בלי לבנות מחדש את הקיימות)
  if (i === rows.length - 1 && !rowIsBlank(rows[i])) {
    rows.push(emptyRow());
    const tbody = document.querySelector(`#${P}-grid tbody`);
    if (tbody) tbody.insertAdjacentHTML('beforeend', rowHtml(rows.length - 1, rows[rows.length - 1], ''));
  }
  refreshMarks();
}

function onGridClick(e) {
  const del = e.target && e.target.closest ? e.target.closest('[data-del]') : null;
  if (!del) return;
  rows.splice(Number(del.getAttribute('data-del')), 1);
  renderTable();
}

let lastInputLogLine = '';
let inputLogTimer = null;
function fillFromText(text, sourceLabel, opts) {
  const parsedRows = absorbTextToFieldRows(text);
  rows = parsedRows.map((r) => ({ fields: r.fields }));
  const anyExtra = rows.some((r) => r.fields.firstName || r.fields.lastName || r.fields.gender || r.fields.familyStatus);
  if (anyExtra) { showExtra = true; const cb = $el(`${P}-extra`); if (cb) cb.checked = true; }
  const v = renderTable();
  ui.status(`${sourceLabel}: ${v.filled.length} שורות נטענו לטבלה${v.errors.length ? `, ${v.errors.length} עם שגיאה` : ''}. בדוק ולחץ "התחל קליטה"`);
  lastInputLogLine = `[קלט] ${sourceLabel}: ${v.filled.length} שורות · ${v.errors.length} שגויות`;
  if (!(opts && opts.quiet)) log(lastInputLogLine);
}

function scheduleInputLog() {
  clearTimeout(inputLogTimer);
  inputLogTimer = setTimeout(() => { if (lastInputLogLine) log(lastInputLogLine); }, 600);
}

// ─── תוצאות / דוח / תור שמור ────────────────────────────────────────────────
function classify(r) {
  const key = absorbStatusKey(r.status);
  if (isAbsorbSuccess(r.status)) return 'ok';
  if (key === 'נעצר' || key === 'דולג') return 'warn';
  return 'bad';
}

function renderResults() {
  setHtml(`${P}-results`, resultsTableHtml({ columns: RESULT_COLUMNS, rows: results, classify }));
  show(`${P}-results-wrap`, results.length > 0);
  const attention = results.filter((r) => !isAbsorbSuccess(r.status)).length;
  setDisabled(`${P}-keep-attention`, attention === 0);
  setText(`${P}-keep-attention`, attention ? `השאר בטבלה רק ${attention} שורות שדורשות טיפול` : 'השאר בטבלה רק שורות שדורשות טיפול');
}

// זרימת-התיקון (31.10.2026): אחרי ריצה, הטבלה עדיין מציגה את כל השורות. הכפתור משאיר רק את אלה שלא הצליחו
// (לפי התוצאות), פותח את עמודות תלמיד-חדש כשצריך, ובעל-המערכת משלים/מתקן ולוחץ "התחל קליטה" שוב.
function keepRowsNeedingAttention() {
  const { rows: kept, needsExtra } = absorbRowsNeedingAttention(rows, results);
  rows = kept.map((r) => ({ fields: Object.assign({}, r.fields) }));
  if (needsExtra) { showExtra = true; const cb = $el(`${P}-extra`); if (cb) cb.checked = true; }
  renderTable();
  ui.status(rows.filter((r) => !rowIsBlank(r)).length
    ? `${rows.filter((r) => !rowIsBlank(r)).length} שורות בטבלה. השלם או תקן לפי עמודת "מה לעשות" בתוצאות, ולחץ "התחל קליטה"`
    : 'אין שורות שדורשות טיפול');
  log(`[קלט] נשארו בטבלה ${rows.filter((r) => !rowIsBlank(r)).length} שורות שדורשות טיפול`);
}

function renderErrors(errors, validCount) {
  if (!errors || !errors.length) { show(`${P}-errors`, false); setHtml(`${P}-errors`, ''); return; }
  const items = errors.slice(0, 25).map((e) => `<li>שורה ${esc(e.line - 1)}: ${esc(e.reason)}</li>`).join('');
  setHtml(`${P}-errors`, `<b>${errors.length} שורות לא יורצו</b> (${validCount} תקינות):<ul>${items}${errors.length > 25 ? `<li>ועוד ${errors.length - 25}</li>` : ''}</ul>`);
  show(`${P}-errors`, true);
}

function renderReport(report) {
  if (!report) { show(`${P}-report`, false); setHtml(`${P}-report`, ''); return; }
  setHtml(`${P}-report`, reportBoxHtml(report));
  show(`${P}-report`, true);
}

// תיבת "תור פתוח": ישן (ממצא ישן) או דף זר (ממצא 11). "המשך" מכריח המשך; "נקה" מוחק.
function renderStaleQueue(info) {
  if (!info) { show(`${P}-stale`, false); setHtml(`${P}-stale`, ''); return; }
  const left = Math.max(0, (info.total || 0) - (info.curIdx || 0));
  const startedMs = Date.parse(info.startedAt);
  const ageMin = Number.isNaN(startedMs) ? null : Math.round((Date.now() - startedMs) / 60000);
  const why = info.reason === 'foreign-page'
    ? 'הדף הזה אינו חלק מהקליטה, ולכן לא ממשיכים לבד. "המשך" ינווט לדף סוג-הלימוד של השורה הבאה.'
    : 'התור ישן מדי להמשך אוטומטי.';
  setHtml(`${P}-stale`, `<b>יש תור פתוח (${esc(left)} שורות)${ageMin === null ? '' : `, מלפני ${esc(ageMin)} דקות`}</b>: ${esc(info.curIdx || 0)} מתוך ${esc(info.total || 0)} הושלמו. ${why}
    ${buttonsRowHtml([
      { id: `${P}-stale-go`, label: 'המשך את התור', kind: 'primary', size: 'small' },
      { id: `${P}-stale-clear`, label: 'נקה את התור', kind: 'danger', size: 'small' },
    ])}`);
  show(`${P}-stale`, true);
  $el(`${P}-stale-go`).addEventListener('click', () => {
    renderStaleQueue(null);
    ui.status('ממשיך את התור השמור…');
    setRunning(true);
    Promise.resolve().then(() => absorbResumeIfPending({ force: true })).then((ran) => { if (ran === false && !absorbIsBusy()) setRunning(false); })
      .catch((e) => { log('[המשך] כשל: ' + (e && e.message)); setRunning(false); });
  });
  $el(`${P}-stale-clear`).addEventListener('click', () => {
    absorbDiscardSavedQueue();
    renderStaleQueue(null);
    setRunning(false);
    ui.status('התור השמור נמחק. אפשר להתחיל ריצה חדשה');
  });
}

function setRunning(on) {
  setDisabled(`${P}-start`, !!on);
  ui.running(!!on);
}

function startDate() {
  const el = $el(`${P}-start-date`);
  return el ? String(el.value || '').trim() : '';
}

function resetStartButton() {
  awaitingErrorConfirm = false;
  setText(`${P}-start`, 'התחל קליטה');
}

// ─── פעולות ─────────────────────────────────────────────────────────────────
async function start() {
  if (absorbIsBusy()) { ui.status('ריצה כבר פעילה. לעצור אותה: "עצור" או Escape'); return; }
  if (absorbHasSavedQueue()) { ui.status('יש תור שמור שממתין להמשך. לחץ "המשך" או "נקה" למעלה, או "עצור"'); return; }
  const v = renderTable();
  if (!v.filled.length) { ui.status('אין שורות להרצה. הדבק מאקסל, טען קובץ, או מלא שורה בטבלה'); return; }
  if (v.errors.length && !awaitingErrorConfirm) {
    awaitingErrorConfirm = true;
    setText(`${P}-start`, v.tasks.length ? `הרץ בכל זאת את ${v.tasks.length} התקינות` : 'התחל קליטה');
    ui.status(`${v.errors.length} שורות בעייתיות (מסומנות באדום). תקן אותן, או לחץ שוב כדי להריץ רק את התקינות`);
    return;
  }
  if (!v.tasks.length) { ui.status('אין שורות תקינות להרצה'); return; }
  resetStartButton();
  renderReport(null);
  renderStaleQueue(null);
  results = [];
  renderResults();
  clearAbsorbStop();
  setRunning(true);
  ui.progress(0, v.tasks.length);
  ui.status(`מריץ ${v.tasks.length} תלמידים…`);
  log(`[התחלה] ${v.tasks.length} תלמידים · תאריך תחילת לימודים "${startDate() || '(ברירת המחדל של האתר)'}"`);
  const started = await absorbStartRun(v.tasks);
  if (started === false) setRunning(false); // ממצא 5: לשונית אחרת רצה; ההודעה הוצגה דרך onLocked
}

function stop() {
  ui.status('עוצר…');
  log('⛔ עצירה לבקשת המשתמש');
  absorbStop();
  setRunning(false);
}

function copyTsv() {
  const list = absorbGetResults().length ? absorbGetResults() : results;
  if (!list.length) { ui.status('אין תוצאות להעתקה'); return; }
  copyTextToClipboard(buildResultsTsv(list)).then((ok) => {
    flash(`${P}-tsv`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק תוצאות לאקסל');
    ui.status(ok ? 'התוצאות הועתקו. הדבק באקסל (Ctrl+V)' : 'ההעתקה נחסמה בדפדפן. השתמש בייצוא CSV');
  });
}

function exportCsv() {
  const list = absorbGetResults().length ? absorbGetResults() : results;
  if (!list.length) { ui.status('אין תוצאות לייצוא'); return; }
  const name = `absorptions_${new Date().toISOString().slice(0, 10)}.csv`;
  ui.status(downloadCsv(name, buildResultsCsvRows(list)) ? `הורד ${name}` : 'הייצוא נכשל');
}

function downloadTemplate() {
  ui.status(downloadCsv('תבנית-קליטת-תלמידים.csv', [ABSORB_TEMPLATE_HEADER.slice()]) ? 'התבנית הורדה. מלא באקסל, ואז הדבק את הטורים כאן או טען את הקובץ' : 'הורדת התבנית נכשלה');
}

function handleXlsx(ev) {
  const input = ev && ev.target;
  const file = input && input.files && input.files[0];
  if (!file) return;
  ui.status('טוען קובץ אקסל…');
  Promise.resolve().then(() => loadXlsxFile(file)).then((text) => {
    const ta = $el(`${P}-input`);
    if (ta) ta.value = text;
    fillFromText(text, `קובץ "${file.name}"`);
  }).catch((e) => {
    ui.status('טעינת האקסל נכשלה: ' + ((e && e.message) || 'שגיאה לא ידועה'));
  }).finally(() => { if (input) input.value = ''; });
}

function copyInputAsTsv() {
  const filled = rows.filter((r) => !rowIsBlank(r));
  if (!filled.length) { ui.status('הטבלה ריקה'); return; }
  copyTextToClipboard(absorbFieldRowsToText(filled)).then((ok) => {
    flash(`${P}-copy-input`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק את הטבלה לאקסל');
  });
}

// ─── mount ──────────────────────────────────────────────────────────────────
function mount(container, panelUi, page) {
  ui = panelUi;
  container.innerHTML = `
    ${datalistsHtml(page)}
    <details class="tt-paste" ${rows.length ? '' : 'open'}>
      <summary class="tt-hint" style="cursor:pointer">הדבקה מאקסל (טורים: סניף, סוג לימוד, ת.ז./דרכון, שם פרטי, שם משפחה, תאריך לידה, ארץ, מגדר, מצב משפחתי; עם כותרת או בלי)</summary>
      <textarea id="${P}-input" class="tt-textarea" placeholder="01&#9;300&#9;123456789&#10;12&#9;600&#9;AB1234567&#9;&#9;&#9;15/03/1995&#9;צרפת"></textarea>
      ${buttonsRowHtml([
        { id: `${P}-xlsx`, label: 'טען קובץ אקסל', kind: 'ghost', size: 'small' },
        { id: `${P}-template`, label: 'הורד תבנית לאקסל', kind: 'ghost', size: 'small' },
        { id: `${P}-copy-input`, label: 'העתק את הטבלה לאקסל', kind: 'ghost', size: 'small' },
      ])}
      <input id="${P}-xlsx-file" type="file" accept=".xlsx,.xls" hidden>
    </details>
    <div class="tt-row" style="justify-content:space-between">
      <span id="${P}-grid-summary" class="tt-hint"></span>
      <label class="tt-hint" style="cursor:pointer"><input type="checkbox" id="${P}-extra"${showExtra ? ' checked' : ''}> עמודות תלמיד חדש (שם, משפחה, מגדר, מצב)</label>
    </div>
    <label class="tt-hint" style="cursor:pointer;display:block;margin:2px 0 6px" title="האתר מזהיר כשהתלמיד רשום במוסד אחר ומבקש אישור. בלי הסימון השורה מסומנת &quot;נחסם&quot; ואתה מחליט ידנית."><input type="checkbox" id="${P}-continue-other"> אשר "המשך" כשהאתר מזהיר שהתלמיד רשום במוסד אחר (לימודיו שם יסתיימו מהיום)</label>
    <div id="${P}-grid" class="tt-scroll" style="max-height:260px"></div>
    <div id="${P}-errors" class="tt-box tt-box-error" hidden></div>
    <div id="${P}-stale" class="tt-box tt-box-warn" hidden></div>
    <div class="tt-row">
      ${fieldHtml('תאריך תחילת לימודים (ריק = ברירת המחדל של האתר)', `<input id="${P}-start-date" class="tt-input tt-mono" type="text" maxlength="10" placeholder="${todayDMY()}" style="max-width:140px">`)}
    </div>
    ${buttonsRowHtml([
      { id: `${P}-start`, label: 'התחל קליטה', kind: 'primary' },
      { id: `${P}-stop`, label: 'עצור', kind: 'danger', title: 'גם מקש Escape עוצר' },
    ])}
    <div id="${P}-results-wrap" hidden>
      <div class="tt-row" style="justify-content:space-between"><b>תוצאות</b>
        <span>${buttonHtml({ id: `${P}-keep-attention`, label: 'השאר בטבלה רק שורות שדורשות טיפול', kind: 'ghost', size: 'small', disabled: true, title: 'מסיר מהטבלה את השורות שהצליחו; משלימים פרטים ומריצים שוב' })} ${buttonHtml({ id: `${P}-tsv`, label: 'העתק תוצאות לאקסל', kind: 'ghost', size: 'small' })} ${buttonHtml({ id: `${P}-csv`, label: 'ייצוא CSV', kind: 'ghost', size: 'small' })}</span></div>
      <div id="${P}-results" class="tt-scroll"></div>
    </div>
    <div id="${P}-report" class="tt-box tt-box-warn" hidden></div>`;

  bindDateMask(`${P}-start-date`);
  // הטבלה מתעדכנת בכל הקשה; שורת היומן "[קלט] הדבקה" נכתבת פעם אחת אחרי שההקלדה נרגעה (סבב רטוב 31.10.2026:
  // 20 שורות-יומן על שתי שורות שהוקלדו).
  $el(`${P}-input`).addEventListener('input', function () { fillFromText(this.value, 'הדבקה', { quiet: true }); scheduleInputLog(); });
  const grid = $el(`${P}-grid`);
  grid.addEventListener('input', onCellInput);
  grid.addEventListener('change', onCellInput);
  grid.addEventListener('click', onGridClick);
  $el(`${P}-extra`).addEventListener('change', function () { showExtra = this.checked; renderTable(); });
  $el(`${P}-start`).addEventListener('click', () => {
    Promise.resolve().then(start).catch((e) => {
      log('[התחלה] ההרצה נכשלה: ' + (e && e.message));
      setRunning(false);
      ui.status('ההרצה נכשלה. בדוק את היומן ונסה שוב');
    });
  });
  $el(`${P}-stop`).addEventListener('click', stop, true);
  $el(`${P}-tsv`).addEventListener('click', copyTsv);
  $el(`${P}-csv`).addEventListener('click', exportCsv);
  $el(`${P}-keep-attention`).addEventListener('click', keepRowsNeedingAttention);
  $el(`${P}-template`).addEventListener('click', downloadTemplate);
  $el(`${P}-copy-input`).addEventListener('click', copyInputAsTsv);
  $el(`${P}-xlsx`).addEventListener('click', () => $el(`${P}-xlsx-file`).click());
  $el(`${P}-xlsx-file`).addEventListener('change', handleXlsx);

  absorbSetHooks({
    getStartDate: startDate,
    getContinueOtherInstitute: () => { const el = $el(`${P}-continue-other`); return !!(el && el.checked); },
    onStart: (queue, idx) => { total = queue.length; ui.progress(idx, total); setRunning(true); },
    onResume: (queue, res, idx) => {
      total = queue.length; results = res.slice(); renderResults(); ui.progress(idx, total); setRunning(true);
      // הטבלה מציגה את התור שרץ
      rows = queue.map((t) => ({ fields: {
        branch: t.branch, studyType: t.studyType, identifier: t.identity, firstName: (t.newStudent || {}).firstName || '', lastName: (t.newStudent || {}).lastName || '',
        birthDate: t.birthDate || '', country: t.country || '', gender: '', familyStatus: '',
      } }));
      renderTable();
      ui.status(`ממשיך אחרי טעינת דף: ${idx + 1} מתוך ${total}`);
      ui.open();
    },
    onProgress: (idx, tot, task) => { total = tot; ui.progress(idx, tot); ui.status(`מעבד ${idx + 1}/${tot}: סניף ${task.branch} · סוג ${task.studyType} · ${task.identity}`); },
    onResult: (result, all) => { results = all.slice(); renderResults(); ui.progress(all.length, Math.max(total, all.length)); },
    onNavigating: () => { ui.status('ממתין לטעינת דף…'); },
    onStaleQueue: (info) => {
      setRunning(false);
      ui.status(info && info.reason === 'foreign-page' ? 'יש תור פתוח, אך הדף הזה אינו חלק מהקליטה. בחר "המשך" או "נקה"' : 'יש תור שמור ישן. בחר "המשך" או "נקה"');
      renderStaleQueue(info);
      ui.open();
    },
    onLocked: (msg) => { setRunning(false); ui.status(msg); ui.open(); },
    onDone: (all, report) => {
      results = all.slice(); renderResults(); renderReport(report); setRunning(false); ui.progress(all.length, all.length);
      ui.status(report.lines.length ? `הסתיים. ${report.lines.length} שורות דורשות טיפול (ראה "מה נשאר")` : 'הסתיים. הכול טופל');
    },
  });

  log(`[קליטה] דף ${page.kind}${page.branch ? ` · סניף ${page.branch} [${page.branchSource || '?'}]` : ''}${page.studyType ? ' · סוג ' + page.studyType : ''}`);
  renderTable();
  results = absorbGetResults();
  renderResults();
  const saved = absorbSavedQueueInfo();
  if (absorbHasSavedQueue()) ui.status(saved && saved.stale ? 'נמצא תור שמור ישן. בודק…' : 'נמצא תור פתוח. ממשיך…');
  else if (!results.length) {
    // ממצא 6: הריצה האחרונה הסתיימה בזמן טעינת-דף (למשל "עצור"): מציגים את התוצאות והדוח שלה
    const last = absorbLastResults();
    if (last && last.results.length) {
      results = last.results.slice();
      renderResults();
      renderReport(last.report);
      ui.status(`תוצאות הריצה האחרונה (${results.length} שורות)`);
    }
  }
  Promise.resolve().then(() => absorbResumeIfPending()).catch((e) => { log('[המשך] כשל: ' + (e && e.message)); setRunning(false); });
}

const absorbTool = {
  id: 'absorb',
  title: 'קליטת תלמידים',
  pages: ['institute', 'studyType', 'newStudent'],
  hasPendingRun: absorbHasSavedQueue,
  isRunning: absorbIsBusy,
  onStop: stop,
  mount,
};

// ─── src/tools/depart.js ───
// עזיבת תלמידים: הזרימה + הפונקציות הטהורות. העברה מכנית מ"תלמוד - עזיבת תלמידים" v5.0
// (979 שורות): אותם מזהי-DOM, אותם postbacks, אותו סדר צעדים. הליבה (PRM, חלונית ההודעה,
// ניווט, יומן) משותפת. דף מוסד, לשונית 3 "תלמידים למוסד".
// לכל תלמיד: לשונית 3 → חיפוש → ניתוח הגריד → בחירת שורה → "עזיבה" → מודאל (תאריך + סיבה) →
// "אישור" → חלונית הודעה → "שמירה" → הודעה אחרי שמירה → אימות בחיפוש חוזר.
// רב-סניפי: ניווט מלא לדף המוסד של הסניף, התור ב-sessionStorage, המשך אחרי הטעינה.
// אין גישה ל-document/window/sessionStorage ברמת המודול (import תקין ב-Node).


// ─── מזהי הפקדים (כמו בסקריפט הישן, שורות 15-29) ─────────────────────────────
const DEPART_BASE = 'ContentPlaceHolder1_tabInstituteDetails_TabPanel1_ucStudentsSearch';
const DEPART_IDS = {
  tabContainer: 'ContentPlaceHolder1_tabInstituteDetails', // לשונית 3 = "תלמידים למוסד"
  idField: `${DEPART_BASE}_txtStudenPassport`,
  searchBtn: `${DEPART_BASE}_btnSearch`,
  countLabel: `${DEPART_BASE}_lblCountSearch`,
  grid: `${DEPART_BASE}_gvIStudents`, // 11 עמודות: ת.ז. באינדקס 3, תאריך עזיבה באינדקס 9
  deptBtn: 'ContentPlaceHolder1_btnStudentDeparture3',
  saveBtn: 'ContentPlaceHolder1_btnSaveTab3',
  modal: `${DEPART_BASE}_ucStudentClose_DivCloseStudent`,
  dateField: `${DEPART_BASE}_ucStudentClose_ctlLeaveDate_txtDate`,
  reasonDropdown: `${DEPART_BASE}_ucStudentClose_ddlLeaveReason`,
  confirmBtn: `${DEPART_BASE}_ucStudentClose_btnDepartureStudent`,
  cancelBtn: `${DEPART_BASE}_ucStudentClose_btnClose`,
};
const DEPART_TAB_INDEX = 3;

const DEPART_REASONS = [
  { value: '1', label: 'הפסקת לימודים' },
  { value: '3', label: 'מעבר בין ישיבות' },
  { value: '4', label: 'מעבר בין יחידות צבאיות' },
  { value: '6', label: 'אחר' },
  { value: '7', label: 'גיוס לצה"ל' },
];
const DEPART_DEFAULT_REASON = '1';

// ─── סטטוסים (כמו בישן; "דולג" ו"סניף לא נמצא" חדשים לרשת-הביטחון) ───────────
const DEPART_STATUS = {
  OK: 'הצליח',
  NOT_FOUND: 'לא נמצא',
  ALREADY: 'כבר בוצעה עזיבה', // בפועל: "כבר בוצעה עזיבה (DD/MM/YYYY)"
  BLOCKED: 'נחסם', // בפועל: "נחסם: <טקסט ההודעה>"
  UNVERIFIED: 'עזיבה בוצעה אך לא אומתה',
  BRANCH_NOT_FOUND: 'סניף לא נמצא',
  ERROR: 'שגיאה',
  SKIPPED: 'דולג',
  STOPPED: 'נעצר',
};

const DEPART_TSV_HEADER = ['סניף', 'ת.ז.', 'סטטוס', 'מה לעשות'];
const DEPART_CSV_HEADER = ['סניף', 'ת.ז.', 'סטטוס', 'פירוט', 'מה לעשות'];

// הוראות אופרטיביות לדוח "מה נשאר"
const DEPART_ACTIONS = {
  notFound: 'בדוק שהת.ז. והסניף נכונים. אם התלמיד רשום בסניף אחר, הרץ אותו עם הסניף הנכון',
  blocked: 'פתח את דף המוסד, לשונית "תלמידים למוסד", חפש את התלמיד ולחץ "עזיבה" ידנית. קרא את ההודעה של האתר והחלט',
  unverified: 'חפש את התלמיד בלשונית "תלמידים למוסד" ובדוק את עמודת "תאריך עזיבה". אם היא ריקה, בצע את העזיבה ידנית',
  error: 'בצע את העזיבה ידנית באתר. אם זה חוזר, העתק את היומן (מזהים ממוסכים) ושלח',
  stopped: 'הרץ שוב את השורות שנותרו',
  searchFailed: 'רענן את דף המוסד, ודא שהלשונית "תלמידים למוסד" נפתחת, והרץ שוב את השורה',
};

function departManualBranchAction(branch) {
  return `פתח ידנית את דף המוסד של סניף ${branch} (בעץ הסניפים בצד) והרץ שוב את השורה`;
}

// "נחסם: טקסט" → "נחסם"; "כבר בוצעה עזיבה (תאריך)" → "כבר בוצעה עזיבה"
function departStatusKey(status) {
  const s = String(status == null ? '' : status);
  const cut = s.search(/:|\s\(/);
  return (cut === -1 ? s : s.slice(0, cut)).trim();
}

// "הצליח" ו"כבר בוצעה עזיבה" = אין מה לעשות (לא נכנסים לדוח "מה נשאר")
function isDepartSuccess(status) {
  const k = departStatusKey(status);
  return k === DEPART_STATUS.OK || k === DEPART_STATUS.ALREADY;
}

// ─── קלט: טורים "סניף" "ת.ז." (טאבים / פסיקים / רווחים; שורת כותרת אופציונלית; # מדולג) ─
const DEPART_WRAP_QUOTES = /^["'״׳“”‘’]+|["'״׳“”‘’]+$/g;
const DEPART_HEADER_BRANCH = /^סניף$/;
const DEPART_HEADER_ID = /^(ת\.?ז\.?(\/דרכון)?|תז|מזהה|דרכון|ת\.ז\. ?\/ ?דרכון)$/;

function departSplitCells(line, delimiter) {
  let cells;
  if (delimiter === 'tab') cells = line.split('\t');
  else if (delimiter === 'comma') cells = line.split(',');
  else cells = line.trim().split(/\s+/).filter((c) => c !== '');
  return cells.map((c) => String(c).trim().replace(DEPART_WRAP_QUOTES, '').trim());
}

function departHeaderMap(cells) {
  const map = { branch: -1, identity: -1 };
  cells.forEach((c, i) => {
    const t = c.replace(/\s+/g, ' ').toLowerCase();
    if (map.branch === -1 && DEPART_HEADER_BRANCH.test(t)) map.branch = i;
    else if (map.identity === -1 && DEPART_HEADER_ID.test(t)) map.identity = i;
  });
  return map.branch !== -1 || map.identity !== -1 ? map : null;
}

// ת.ז.: ספרות (5-9) → ריפוד ל-9; דרכון: אותיות+ספרות (4-20) → אותיות גדולות; אחרת שגיאה.
function departNormalizeIdentity(raw) {
  const s = String(raw == null ? '' : raw).replace(/[\s-]/g, '');
  if (!s) return { value: '', error: 'חסרה ת.ז.' };
  if (/^\d+$/.test(s)) {
    if (s.length < 5 || s.length > 9) return { value: '', error: `ת.ז. לא תקינה: ${raw}` };
    return { value: padId9(s), error: null };
  }
  if (/^[A-Za-z0-9]{4,20}$/.test(s)) return { value: s.toUpperCase(), error: null };
  return { value: '', error: `ת.ז. לא תקינה: ${raw}` };
}

function parseDepartInput(text) {
  const src = String(text == null ? '' : text);
  const rawLines = src.split(/\r\n|\r|\n/);
  const delimiter = src.includes('\t') ? 'tab' : (src.includes(',') ? 'comma' : 'whitespace');
  const tasks = [];
  const errors = [];
  let headerMap = null;
  let sawContent = false;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const lineNo = i + 1;
    const cells = departSplitCells(raw, delimiter);

    if (!sawContent) {
      sawContent = true;
      if (!/^\d+$/.test(cells[0] || '')) {
        const map = departHeaderMap(cells);
        if (map) { headerMap = map; continue; }
      }
    }

    const bi = headerMap && headerMap.branch !== -1 ? headerMap.branch : 0;
    const ii = headerMap && headerMap.identity !== -1 ? headerMap.identity : 1;
    const branchRaw = cells[bi] || '';
    const idRaw = cells[ii] || '';
    if (!branchRaw || !idRaw) { errors.push({ line: lineNo, text: raw, reason: 'חסרים שדות חובה: סניף / ת.ז.' }); continue; }
    const branch = normalizeBranch(branchRaw);
    if (!branch) { errors.push({ line: lineNo, text: raw, reason: `סניף לא תקין: ${branchRaw}` }); continue; }
    const id = departNormalizeIdentity(idRaw);
    if (id.error) { errors.push({ line: lineNo, text: raw, reason: id.error }); continue; }
    tasks.push({ line: lineNo, branch, identity: id.value });
  }
  return { tasks, errors };
}

// ─── תאריך DD/MM/YYYY ─────────────────────────────────────────────────────────
function departIsValidDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return false;
  const d = Number(m[1]); const mo = Number(m[2]); const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || y < 1900 || y > 2200) return false;
  return d <= new Date(y, mo, 0).getDate();
}

function departTodayDMY() {
  const d = new Date();
  return [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('/');
}

// ─── ניתוח הגריד (פורט של analyzeGrid הישן, שורות 183-218) ───────────────────
// rows = שורות-תאים (td בלבד; שורת הכותרת עם th יוצאת ריקה ונדחית ב-length<10).
// count = "נמצאו N": 0 → לא נמצא; 1 → מותר fallback לשורת-הנתונים הראשונה (כמו בישן);
// null → אין תווית: התאמה מדויקת, ו-fallback רק כשיש שורת-נתונים אחת בלבד.
function departParseCount(text) {
  const m = /נמצאו\s*(\d+)/.exec(String(text == null ? '' : text));
  return m ? parseInt(m[1], 10) : null;
}

const departNormId = (s) => String(s == null ? '' : s).trim().replace(/^0+/, '').toUpperCase();

function analyzeDepartGrid(rows, identity, count) {
  const none = { found: false, departed: false, departDate: '', matchType: null };
  if (count === 0) return none;
  if (!Array.isArray(rows)) return none;
  const target = departNormId(identity);
  if (!target) return none;
  let firstDataRow = null;
  let dataRows = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 10) continue;
    const rowId = String(row[3] == null ? '' : row[3]).trim();
    if (!rowId) continue;
    dataRows++;
    const departDate = String(row[9] == null ? '' : row[9]).trim();
    if (!firstDataRow) firstDataRow = { rowId, departDate };
    if (departNormId(rowId) === target) return { found: true, departed: !!departDate, departDate, matchType: 'exact' };
  }
  // count=1 ובלי התאמה (למשל ריפוד שונה) → השורה היחידה, כמו בישן
  if (firstDataRow && (count === 1 || (count == null && dataRows === 1))) {
    return { found: true, departed: !!firstDataRow.departDate, departDate: firstDataRow.departDate, matchType: 'single-row-fallback' };
  }
  return none;
}

// onclick="selectedRowStudents('N')" → N
function departSelectRowIndex(onclickText) {
  if (typeof onclickText !== 'string') return null;
  const m = /selectedRowStudents\s*\(\s*['"]?(\d+)['"]?\s*\)/.exec(onclickText);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// href/onclick → {target, arg, group, validate}. תומך ב-__doPostBack ישיר, בעטיפת setTimeout
// של תיבת-סימון (`setTimeout('__doPostBack(\'x\',\'\')', 0)`) וב-WebForm_DoPostBackWithOptions.
function departParsePostback(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const direct = parsePostbackHref(text);
  if (direct) return { target: direct.target, arg: direct.arg, group: '', validate: false };
  const wrapped = /__doPostBack\(\s*(?:\\)?'([^'\\]*)(?:\\)?'\s*,\s*(?:\\)?'([^'\\]*)(?:\\)?'\s*\)/.exec(text);
  if (wrapped) return { target: wrapped[1], arg: wrapped[2], group: '', validate: false };
  const opts = /WebForm_PostBackOptions\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(true|false)\s*,\s*"([^"]*)"/.exec(text);
  if (opts) return { target: opts[1], arg: opts[2], group: opts[4], validate: opts[3] === 'true' };
  return null;
}

// ─── תוצאות: TSV / CSV / דוח "מה נשאר" ───────────────────────────────────────
function makeDepartResult(task, status, detail, action) {
  const t = task || {};
  return { line: t.line, branch: t.branch, identity: t.identity, status, detail: detail || '', action: action || '' };
}

const departFlat = (v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();

function buildDepartTsv(results) {
  const lines = [DEPART_TSV_HEADER.join('\t')];
  for (const r of Array.isArray(results) ? results : []) {
    lines.push([r.branch, r.identity, r.status, r.action].map(departFlat).join('\t'));
  }
  return lines.join('\n');
}

function buildDepartCsvRows(results) {
  const rows = [DEPART_CSV_HEADER.slice()];
  for (const r of Array.isArray(results) ? results : []) rows.push([r.branch, r.identity, r.status, r.detail || '', r.action || '']);
  return rows;
}

function summarizeDepartResults(results) {
  const counts = {};
  for (const r of Array.isArray(results) ? results : []) {
    const key = departStatusKey(r && r.status) || '?';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function buildDepartReport(results) {
  const list = Array.isArray(results) ? results : [];
  const counts = summarizeDepartResults(list);
  const lines = list
    .filter((r) => !isDepartSuccess(r && r.status))
    .map((r) => [r.branch, r.identity, r.status, r.action || 'אין הוראה'].map(departFlat).join(' · '));
  const summary = Object.keys(counts).map((k) => `${k}=${counts[k]}`).join(' · ');
  return { lines, summary, counts };
}

function departQueueIsStale(startedAt, now, maxAgeMs) {
  const t0 = Date.parse(startedAt);
  if (!startedAt || Number.isNaN(t0)) return false;
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  if (Number.isNaN(nowMs)) return false;
  return nowMs - t0 > (typeof maxAgeMs === 'number' ? maxAgeMs : DEPART_MAX_QUEUE_AGE_MS);
}

// ═══ מצב הריצה (sessionStorage: שורד טעינת-דף) ═══════════════════════════════
const DEPART_QUEUE_KEY = 'talmud.depart.queue';
const DEPART_STOP_KEY = 'talmud.depart.stop';
const DEPART_LANDINGS_KEY = 'talmud.depart.landings';
const DEPART_STOP_PREFIX = '__DEPART_STOPPED__@';
const DEPART_MAX_LANDINGS = 6; // טעינות-דף לתלמיד אחד; מעל זה "דולג"
const DEPART_MAX_QUEUE_AGE_MS = 30 * 60 * 1000; // תור שמור ישן מזה לא ממשיך לבד
const DEPART_STUDENT_TIMEOUT_MS = 60000;
const DEPART_NAV_WAIT_MS = 12000;
const DEPART_POPUP_HIDE_MS = 5000;
const DEPART_FIELD_WAIT = { startTimeoutMs: 400, totalTimeoutMs: 8000 };
const DEPART_SELECT_WAIT = { startTimeoutMs: 1000, totalTimeoutMs: 10000 };
const DEPART_NAVIGATED = { __navigated: true };

const DEPART_S = {
  queue: [], results: [], curIdx: 0, running: false, startedAt: null,
  settings: { leaveDate: '', leaveReason: DEPART_DEFAULT_REASON },
  hooks: {},
};

function departSetHooks(hooks) { DEPART_S.hooks = hooks || {}; }
function departGetResults() { return DEPART_S.results.slice(); }
function departIsRunning() { return DEPART_S.running; }
function departGetSettings() { return Object.assign({}, DEPART_S.settings); }
function departHook(name, ...args) { try { if (DEPART_S.hooks[name]) DEPART_S.hooks[name](...args); } catch (e) { /* אצווה לא נתקעת */ } }

function departIsStopped() { try { return sessionStorage.getItem(DEPART_STOP_KEY) === '1'; } catch (e) { return false; } }
function departSetStop() { try { sessionStorage.setItem(DEPART_STOP_KEY, '1'); } catch (e) { /* noop */ } }
function departClearStop() { try { sessionStorage.removeItem(DEPART_STOP_KEY); } catch (e) { /* noop */ } }
function departStopError(where) { return new Error(DEPART_STOP_PREFIX + where); }
function departIsStopError(err) { return !!err && typeof err.message === 'string' && err.message.indexOf(DEPART_STOP_PREFIX) === 0; }
function departCheckStop(where) { if (departIsStopped()) throw departStopError(where); }

function departSaveState() {
  const state = {
    queue: DEPART_S.queue, results: DEPART_S.results, curIdx: DEPART_S.curIdx,
    startedAt: DEPART_S.startedAt || new Date().toISOString(), settings: DEPART_S.settings,
  };
  try { sessionStorage.setItem(DEPART_QUEUE_KEY, JSON.stringify(state)); } catch (e) { log('[עזיבה] שמירת המצב נכשלה: ' + (e && e.message)); }
}
function departLoadState() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DEPART_QUEUE_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) { return null; }
}
function departClearState() {
  try { sessionStorage.removeItem(DEPART_QUEUE_KEY); sessionStorage.removeItem(DEPART_LANDINGS_KEY); } catch (e) { /* noop */ }
}
function departBumpLandings(idx) {
  let rec = { idx: -1, count: 0 };
  try { const raw = sessionStorage.getItem(DEPART_LANDINGS_KEY); if (raw) rec = JSON.parse(raw) || rec; } catch (e) { /* ברירת מחדל */ }
  rec = rec.idx === idx ? { idx, count: (rec.count || 0) + 1 } : { idx, count: 1 };
  try { sessionStorage.setItem(DEPART_LANDINGS_KEY, JSON.stringify(rec)); } catch (e) { /* noop */ }
  return rec.count;
}
function departResetLandings() { try { sessionStorage.removeItem(DEPART_LANDINGS_KEY); } catch (e) { /* noop */ } }

function departResetRun() {
  DEPART_S.queue = []; DEPART_S.results = []; DEPART_S.curIdx = 0; DEPART_S.running = false; DEPART_S.startedAt = null;
}

// ─── ניווט מלא: האם הדף מתחיל להיפרק ─────────────────────────────────────────
let departUnloadSeen = false;
let departUnloadWatched = false;
function departWatchUnload() {
  if (departUnloadWatched || typeof window === 'undefined') return;
  departUnloadWatched = true;
  const mark = () => { departUnloadSeen = true; };
  try { window.addEventListener('beforeunload', mark, true); window.addEventListener('pagehide', mark, true); } catch (e) { /* noop */ }
}

// ═══ נגיעות ב-DOM (סדר postback קשיח: המתנה נרשמת לפני, הירי נדחה ל-setTimeout(0)) ═══

// לחיצה על פקד: postback דרך ה-href/onclick אם יש (בלי eval), אחרת קליק נדחה.
function departFireElement(el, opts) {
  const href = (el && typeof el.getAttribute === 'function' && el.getAttribute('href')) || '';
  const pb = departParsePostback(href);
  if (pb && pb.target) {
    if (pb.validate && typeof window !== 'undefined' && typeof window.Page_ClientValidate === 'function') {
      let valid = true;
      try { valid = !!window.Page_ClientValidate(pb.group || ''); } catch (e) { valid = true; }
      if (!valid) {
        try { window.Page_BlockSubmit = false; } catch (e) { /* noop */ }
        return Promise.resolve({ ok: false, started: false, validationFailed: true, reason: 'ולידציה צד-לקוח נכשלה' });
      }
    }
    return firePostback(pb.target, pb.arg, opts);
  }
  const wait = waitPRM(opts);
  setTimeout(() => { try { el.click(); } catch (e) { log('[postback] כשל בלחיצה: ' + (e && e.message)); } }, 0);
  return wait;
}

// כתיבה לשדה = פוטנציאלית postback (AutoPostBack): רושמים המתנה קודם, כותבים מ-setTimeout(0).
function departSetAndWait(el, value, opts) {
  const o = opts || {};
  const wait = waitPRM(o.select ? DEPART_SELECT_WAIT : DEPART_FIELD_WAIT);
  setTimeout(() => {
    try {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) { log('[שדה] כתיבה נכשלה: ' + (e && e.message)); }
  }, 0);
  return wait;
}

// שלב 1 (ישן 416-427): לשונית 3 "תלמידים למוסד" דרך ה-TabContainer של האתר. F4 (30.10.2026): שינוי לשונית
// ב-tabInstituteDetails הוא postback א-סינכרוני שבמהלכו הפקדים נבנים מחדש, ולכן רושמים waitPRM, מפעילים
// מ-setTimeout(0), וממתינים לסיום לפני שנוגעים בשדות. מחזיר Promise<boolean> (האם הופעל מעבר).
async function departActivateStudentsTab() {
  try {
    if (typeof window === 'undefined' || typeof window.$find !== 'function') return false;
    const tabs = window.$find(DEPART_IDS.tabContainer);
    if (!tabs || typeof tabs.set_activeTabIndex !== 'function') { log('[לשונית] TabContainer לא נמצא'); return false; }
    let active = -1;
    try { active = tabs.get_activeTabIndex(); } catch (e) { /* ignore */ }
    if (active !== DEPART_TAB_INDEX) {
      log('[לשונית] מעבר ללשונית "תלמידים למוסד"');
      const wait = waitPRM({ startTimeoutMs: 1500, totalTimeoutMs: 25000 });
      setTimeout(() => { try { tabs.set_activeTabIndex(DEPART_TAB_INDEX); } catch (e) { log('[לשונית] שגיאה במעבר לשונית: ' + (e && e.message)); } }, 0);
      const res = await wait;
      if (res && res.ok === false) log(`[לשונית] ה-postback של הלשונית נכשל: ${res.reason}`);
      return true;
    }
  } catch (e) { log('[לשונית] שגיאה במעבר לשונית: ' + (e && e.message)); }
  return false;
}

async function departWaitTabReady() {
  try {
    await waitFor(() => isVisible($el(DEPART_IDS.idField)), { timeout: 3000, interval: 50 });
    return true;
  } catch (e) { return isVisible($el(DEPART_IDS.idField)); }
}

function departReadGridRows() {
  const grid = $el(DEPART_IDS.grid);
  if (!grid || typeof grid.querySelectorAll !== 'function') return [];
  return Array.from(grid.querySelectorAll('tr')).map(
    (tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim())
  );
}

// שלב 2 (ישן searchFor 160-180): מילוי, חיפוש, והמתנה עד שהגריד באמת התרענן (endRequest
// עלול להקדים את החלפת ה-DOM של ה-UpdatePanel). מבטלים את תוקף התווית לפני, כמו בישן.
async function departSearch(identity) {
  const input = $el(DEPART_IDS.idField);
  const btn = $el(DEPART_IDS.searchBtn);
  if (!input || !btn) return { executed: false, count: null, countText: '', reason: 'שדה או כפתור החיפוש לא נמצאו' };
  const oldGrid = $el(DEPART_IDS.grid);
  const cl = $el(DEPART_IDS.countLabel);
  if (cl) cl.textContent = '';
  await departSetAndWait(input, identity);
  const res = await departFireElement(btn, { startTimeoutMs: 3000, totalTimeoutMs: 20000 });
  let settled = true;
  try {
    await waitFor(() => {
      const grid = $el(DEPART_IDS.grid);
      const cnt = (($el(DEPART_IDS.countLabel) || {}).textContent || '').trim();
      return (grid && grid !== oldGrid) || cnt !== '';
    }, { timeout: 6000, interval: 50 });
  } catch (e) {
    settled = false;
    log('[חיפוש] הגריד לא התרענן תוך 6 שניות - מנתחים בכל זאת');
  }
  const countText = (($el(DEPART_IDS.countLabel) || {}).textContent || '').trim();
  const count = departParseCount(countText);
  const started = !!(res && res.started);
  const ok = !res || res.ok !== false;
  const executed = ok && (started || settled);
  log(`[חיפוש] ${maskId(identity)} → "${countText || 'ללא תווית ספירה'}" · started=${started} ok=${ok} refreshed=${settled}`);
  return { executed, started, ok, settled, count, countText, reason: res && res.reason };
}

function departSearchFailReason(res) {
  if (!res) return 'החיפוש לא הופעל';
  if (res.reason && !res.executed && res.count == null && !res.started && !res.settled && !res.ok) return 'החיפוש נכשל: ' + res.reason;
  if (!res.ok) return 'החיפוש נכשל או פג-זמן בשרת' + (res.reason ? ` (${res.reason})` : '');
  if (!res.started && !res.settled) return 'לחיצת החיפוש לא הפעילה בקשה לשרת והרשימה לא התרעננה';
  return res.reason || 'החיפוש לא הופעל';
}

// שלב 4 (ישן selectFirstActiveRow 221-272): שורת-הנתונים הראשונה → selectedRowStudents(N)
// (הפונקציה של האתר, בלי eval) → תיבת-הסימון (postback שמאפשר את "עזיבה" בצד השרת) →
// המתנה שהכפתור יתאפשר, עם גיבוי של קריאה ישירה. אם עדיין מנוטרל: ממשיכים בכל זאת (כמו בישן).
async function departSelectFirstActiveRow() {
  const grid = $el(DEPART_IDS.grid);
  if (!grid) return { ok: false, reason: 'הגריד לא נמצא' };
  let dataRow = null;
  for (const tr of Array.from(grid.querySelectorAll('tr'))) {
    const cells = tr.querySelectorAll('td');
    if (cells.length >= 10 && ((cells[3].textContent || '').trim())) { dataRow = tr; break; }
  }
  if (!dataRow) return { ok: false, reason: 'לא נמצאה שורת-נתונים בגריד' };

  const trOnclick = dataRow.getAttribute('onclick') || '';
  const rowIndex = departSelectRowIndex(trOnclick);
  log(`[שורה] onclick="${trOnclick}" → אינדקס ${rowIndex === null ? '?' : rowIndex}`);
  const callSelect = () => {
    if (rowIndex !== null && typeof window !== 'undefined' && typeof window.selectedRowStudents === 'function') {
      try { window.selectedRowStudents(rowIndex); return true; } catch (e) { log('[שורה] selectedRowStudents נכשלה: ' + (e && e.message)); }
    }
    return false;
  };
  if (!callSelect()) { try { dataRow.click(); } catch (e) { log('[שורה] קליק על השורה נכשל: ' + (e && e.message)); } }

  const cb = dataRow.querySelector('input[type="checkbox"]');
  if (!cb) return { ok: false, reason: 'תיבת הסימון בשורה לא נמצאה' };
  const cbPb = departParsePostback(cb.getAttribute('onclick') || '');
  if (cbPb && cbPb.target) {
    cb.checked = true;
    await firePostback(cbPb.target, cbPb.arg, { startTimeoutMs: 2000, totalTimeoutMs: 12000 });
  } else if (!cb.checked) {
    const wait = waitPRM({ startTimeoutMs: 2000, totalTimeoutMs: 12000 });
    setTimeout(() => { try { cb.click(); } catch (e) { /* אצווה לא נתקעת */ } }, 0);
    await wait;
  }

  const btnEnabled = () => { const b = $el(DEPART_IDS.deptBtn); return !!b && !b.getAttribute('disabled'); };
  try { await waitFor(btnEnabled, { timeout: 2000, interval: 50 }); } catch (e) { /* בודקים למטה */ }
  if (!btnEnabled()) {
    log('[שורה] כפתור "עזיבה" עדיין מנוטרל - גיבוי: selectedRowStudents ישירות');
    callSelect();
    try { await waitFor(btnEnabled, { timeout: 2000, interval: 50 }); } catch (e) { /* noop */ }
    if (!btnEnabled()) log('[שורה] כפתור "עזיבה" עדיין מנוטרל - ממשיכים בכל זאת (כמו בישן)');
  }
  return { ok: true, rowIndex };
}

function departModalVisible() { return isVisible($el(DEPART_IDS.modal)); }

// סגירת מודאל העזיבה (אחרי חסימה) כדי שהתלמיד הבא יתחיל מהרשימה, לא ממודאל חצי-פתוח.
async function departCloseModalIfOpen() {
  try {
    if (!departModalVisible()) return false;
    const cancel = $el(DEPART_IDS.cancelBtn);
    if (!cancel) return false;
    await departFireElement(cancel, { startTimeoutMs: 800, totalTimeoutMs: 8000 });
    await sleep(200);
    return true;
  } catch (e) { log('[מודאל] סגירת חלון העזיבה נכשלה: ' + (e && e.message)); return false; }
}

async function departReadPopupAfter(ms) {
  try { await waitFor(() => !!readMessagePopup(), { timeout: ms, interval: 60 }); } catch (e) { /* אין חלונית */ }
  return readMessagePopup();
}

// סוגר את חלונית ההודעה בלי "המשך" (extender, ואם אין: "אישור").
async function departHidePopup() {
  const hide = hideMessagePopupAsync();
  if (hide && hide.wait) await Promise.race([hide.wait, sleep(DEPART_POPUP_HIDE_MS)]);
  if (hide && !hide.hidden) log('[הודעה] לא נמצאה דרך לסגור את החלונית בלי "המשך" - ממשיכים');
  await sleep(150);
  return hide;
}

// הכוונה המפורשת של הסקריפט הישן (v5.0 שלב 8, שורות 509-515): אחרי "אישור" במודאל העזיבה,
// חלונית "המשך"/"לא" היא אישור-רך ולוחצים "המשך". זה המקום היחיד בכלי שבו btnMOK נלחץ.
async function departClickContinue(popup) {
  const buttons = Array.isArray(popup.buttons) ? popup.buttons.join(', ') : '';
  log(`[אישור] חלונית אישור-רך: "${maskIdsInText(popup.text)}" · כפתורים=[${buttons}] → לוחצים "המשך" (כמו הסקריפט הישן)`);
  const btn = $el('ucMessagePopUp_btnMOK');
  if (!btn) { log('[אישור] כפתור "המשך" לא נמצא'); return { ok: false }; }
  const wait = waitPRM({ startTimeoutMs: 1500, totalTimeoutMs: 15000 });
  setTimeout(() => { try { btn.click(); } catch (e) { log('[אישור] לחיצת "המשך" נכשלה: ' + (e && e.message)); } }, 0);
  const res = await wait;
  await sleep(200);
  return res;
}

// ═══ תלמיד יחיד (ישן processStudent 407-549, אותו סדר צעדים) ═══════════════════
async function departProcessStudent(task) {
  const identity = task.identity;
  const mk = (status, detail, action) => makeDepartResult(task, status, detail, action);
  log(`▶ סניף ${task.branch} · ${maskId(identity)}`);
  departCheckStop('start');

  // שלב 1: לשונית 3
  await departActivateStudentsTab();
  if (!(await departWaitTabReady())) {
    return mk(DEPART_STATUS.ERROR, 'שדה החיפוש בלשונית "תלמידים למוסד" לא נמצא', DEPART_ACTIONS.searchFailed);
  }

  // שלב 2: חיפוש
  const search = await departSearch(identity);
  if (!search.executed) return mk(DEPART_STATUS.ERROR, departSearchFailReason(search), DEPART_ACTIONS.searchFailed);

  // שלב 3: ניתוח הגריד
  const analysis = analyzeDepartGrid(departReadGridRows(), identity, search.count);
  log(`[גריד] found=${analysis.found} departed=${analysis.departed} date="${analysis.departDate}"${analysis.matchType === 'single-row-fallback' ? ' (שורה יחידה)' : ''}`);
  if (!analysis.found) return mk(DEPART_STATUS.NOT_FOUND, search.countText, DEPART_ACTIONS.notFound);
  if (analysis.departed) return mk(`${DEPART_STATUS.ALREADY} (${analysis.departDate})`, '', '');

  // נקודת-עצירה לפני החלק ההרסני (כמו בישן)
  departCheckStop('before-depart');

  // שלב 4: בחירת השורה
  const sel = await departSelectFirstActiveRow();
  if (!sel.ok) return mk(DEPART_STATUS.ERROR, sel.reason, DEPART_ACTIONS.error);

  // שלב 5: "עזיבה" (postback דרך ה-href, בלי eval)
  const deptBtn = $el(DEPART_IDS.deptBtn);
  if (!deptBtn) return mk(DEPART_STATUS.ERROR, 'כפתור "עזיבה" לא נמצא', DEPART_ACTIONS.error);
  const dres = await departFireElement(deptBtn, { startTimeoutMs: 3000, totalTimeoutMs: 20000 });
  if (dres && dres.ok === false) log(`[עזיבה] postback לא תקין: ${dres.reason}`);

  // שלב 6: המודאל נפתח?
  let opened = departModalVisible();
  if (!opened) {
    try { await waitFor(departModalVisible, { timeout: 4000, interval: 100 }); opened = true; } catch (e) { opened = false; }
  }
  log(`[מודאל] גלוי: ${opened}`);
  if (!opened) {
    const pop = readMessagePopup();
    if (pop) {
      log(`[עזיבה] הודעה במקום מודאל: "${maskIdsInText(pop.text)}"`);
      await departHidePopup();
      return mk(`${DEPART_STATUS.BLOCKED}: ${pop.text || 'הודעת מערכת'}`, pop.text, DEPART_ACTIONS.blocked);
    }
    return mk(DEPART_STATUS.ERROR, 'חלון העזיבה לא נפתח', 'לחץ "עזיבה" ידנית בלשונית "תלמידים למוסד" ובדוק אם מופיעה הודעה');
  }

  try {
    // שלב 7: תאריך + סיבה
    const leaveDate = DEPART_S.settings.leaveDate || departTodayDMY();
    const leaveReason = DEPART_S.settings.leaveReason || DEPART_DEFAULT_REASON;
    const dateEl = $el(DEPART_IDS.dateField);
    if (!dateEl) return mk(DEPART_STATUS.ERROR, 'שדה תאריך העזיבה במודאל לא נמצא', DEPART_ACTIONS.error);
    await departSetAndWait(dateEl, leaveDate);
    const reasonEl = $el(DEPART_IDS.reasonDropdown);
    let reasonText = '';
    if (reasonEl) {
      const has = Array.from(reasonEl.options || []).some((o) => o.value === leaveReason);
      if (!has) return mk(DEPART_STATUS.ERROR, `סיבת העזיבה ${leaveReason} לא קיימת ברשימת האתר`, 'בחר סיבת עזיבה אחרת מהרשימה והרץ שוב');
      await departSetAndWait(reasonEl, leaveReason, { select: true });
      reasonText = (reasonEl.options[reasonEl.selectedIndex] || {}).text || '';
    }
    log(`[מודאל] תאריך="${dateEl.value}" סיבה=${leaveReason} ("${reasonText}")`);

    // שלב 8: "אישור"
    const confirmEl = $el(DEPART_IDS.confirmBtn);
    if (!confirmEl) return mk(DEPART_STATUS.ERROR, 'כפתור "אישור" במודאל לא נמצא', DEPART_ACTIONS.error);
    const cres = await departFireElement(confirmEl, { startTimeoutMs: 3000, totalTimeoutMs: 20000 });
    if (cres && cres.validationFailed) return mk(DEPART_STATUS.ERROR, 'ולידציה בחלון העזיבה נכשלה (תאריך או סיבה)', 'בדוק את תאריך העזיבה (DD/MM/YYYY) ואת הסיבה והרץ שוב');
    await sleep(300);

    // שלב 8ב: חלונית ההודעה אחרי "אישור"
    const popup = await departReadPopupAfter(1200);
    let softConfirm = '';
    if (popup && !popup.hasContinue) {
      // רק "אישור": חסימה/ולידציה. מציגים למשתמש ומדלגים; לעולם לא לוחצים "המשך".
      log(`[אישור] נחסם: "${maskIdsInText(popup.text)}"`);
      await departHidePopup();
      await departCloseModalIfOpen();
      return mk(`${DEPART_STATUS.BLOCKED}: ${popup.text || 'הודעת מערכת'}`, popup.text, DEPART_ACTIONS.blocked);
    }
    if (popup && popup.hasContinue) {
      softConfirm = popup.text;
      await departClickContinue(popup);
    }

    // שלב 9: "שמירה"
    const saveEl = $el(DEPART_IDS.saveBtn);
    if (!saveEl) return mk(DEPART_STATUS.ERROR, 'כפתור "שמירה" לא נמצא', DEPART_ACTIONS.unverified);
    log(`[שמירה] class="${saveEl.className}" disabled=${saveEl.getAttribute('disabled')}`);
    const sres = await departFireElement(saveEl, { startTimeoutMs: 3000, totalTimeoutMs: 20000 });
    if (sres && sres.ok === false) log(`[שמירה] postback לא תקין: ${sres.reason}`);
    await sleep(300);

    // הודעה אחרי שמירה: "הצלחה תהליך עידכון תלמיד הצליח" = אינפורמטיבי; אחרת נחסם. סוגרים בלי "המשך".
    const savePopup = await departReadPopupAfter(800);
    let saveBlocked = '';
    if (savePopup) {
      log(`[שמירה] הודעה: "${maskIdsInText(savePopup.text)}" · סוג=${savePopup.kind}`);
      await departHidePopup();
      if (savePopup.kind !== 'success' && savePopup.text && !/הצל/.test(savePopup.text)) saveBlocked = savePopup.text;
    }

    // שלב 10: אימות. מקור האמת: תאריך עזיבה בגריד אחרי חיפוש חוזר.
    const verify = await departSearch(identity);
    const v = verify.executed ? analyzeDepartGrid(departReadGridRows(), identity, verify.count) : { found: false, departed: false, departDate: '' };
    log(`[אימות] departed=${v.departed} date="${v.departDate}"`);
    if (v.departed) { log('◀ הצליח'); return mk(DEPART_STATUS.OK, softConfirm ? `אושר "המשך": ${softConfirm}` : '', ''); }
    if (saveBlocked) return mk(`${DEPART_STATUS.BLOCKED}: ${saveBlocked}`, saveBlocked, DEPART_ACTIONS.blocked);
    return mk(DEPART_STATUS.UNVERIFIED, verify.executed ? (softConfirm || '') : departSearchFailReason(verify), DEPART_ACTIONS.unverified);
  } finally {
    try { if (departModalVisible()) await departCloseModalIfOpen(); } catch (e) { /* אצווה לא נתקעת */ }
  }
}

function departWithTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`תהליך תקוע: חרג מ-${Math.round(ms / 1000)} שניות`)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

async function departProcessStudentSafe(task) {
  try {
    return await departWithTimeout(departProcessStudent(task), DEPART_STUDENT_TIMEOUT_MS);
  } catch (err) {
    if (departIsStopError(err)) throw err;
    log(`▶ שגיאה: ${err && err.message}`);
    try { const pop = readMessagePopup(); if (pop) await departHidePopup(); } catch (e) { /* noop */ }
    try { await departCloseModalIfOpen(); } catch (e) { /* noop */ }
    return makeDepartResult(task, `${DEPART_STATUS.ERROR}: ${err && err.message}`, err && err.message, DEPART_ACTIONS.error);
  }
}

// ═══ הסניף הנכון: דף המוסד של task.branch (הסניף נקרא מה-h1 של הדף, לא מזיכרון) ═══
// מחזיר {ok:true} כשאנחנו בדף הנכון; {navigated:true} כשהדף נטען מחדש (ההמשך אחרי הטעינה);
// {ok:false, status, detail, action} כשאי-אפשר להגיע.
async function departEnsureBranch(task) {
  const branch = normalizeBranch(task.branch);
  const page = getPage();
  if (page.kind === 'institute' && page.branch === branch) return { ok: true };
  log(`[ניווט] דף ${page.kind}${page.branch ? ` · סניף ${page.branch}` : ''} → צריך דף מוסד של סניף ${branch}`);
  departCheckStop('before-nav');
  departSaveState();
  departUnloadSeen = false;
  departHook('onNavigating', branch);
  const res = await gotoInstitute(branch);
  if (!res || res.ok === false) {
    if (res && res.notFound) return { ok: false, status: DEPART_STATUS.BRANCH_NOT_FOUND, detail: res.reason, action: 'בדוק את מספר הסניף. אם הוא קיים, פתח את דף המוסד שלו ידנית והרץ שוב את השורה' };
    return { ok: false, status: DEPART_STATUS.ERROR, detail: (res && res.reason) || 'הניווט לסניף נכשל', action: departManualBranchAction(branch) };
  }
  const how = res.method === 'url' ? 'מעבר לדף המוסדות (אין עץ בדף הזה; משם העץ)' : res.method === 'tree' ? 'עץ הסניפים (טעינת דף)' : (res.method || '?');
  log(`[ניווט] → סניף ${branch} · ${how}`);
  // ממתינים לטעינת-דף (הדף נפרק) או לרינדור-במקום של הסניף הנכון; לא קופאים על "ממתין".
  const t0 = Date.now();
  while (Date.now() - t0 < DEPART_NAV_WAIT_MS) {
    if (departUnloadSeen) return { navigated: true };
    const p = getPage();
    if (p.kind === 'institute' && p.branch === branch) { log('[ניווט] הדף התעדכן בלי טעינה מלאה - ממשיכים במקום'); return { ok: true }; }
    await sleep(150);
  }
  return { ok: false, status: DEPART_STATUS.ERROR, detail: `הניווט לסניף ${branch} לא הביא טעינת דף תוך ${Math.round(DEPART_NAV_WAIT_MS / 1000)} שניות`, action: departManualBranchAction(branch) };
}

// ═══ התור ═══════════════════════════════════════════════════════════════════
function departRecordResult(result, idx) {
  DEPART_S.results.push(result);
  DEPART_S.curIdx = Math.max(DEPART_S.curIdx, idx + 1);
  departResetLandings();
  departSaveState();
  departHook('onResult', result, DEPART_S.results);
}

function departFillRemaining(status, detail, action) {
  while (DEPART_S.curIdx < DEPART_S.queue.length) {
    DEPART_S.results.push(makeDepartResult(DEPART_S.queue[DEPART_S.curIdx], status, detail, action));
    DEPART_S.curIdx++;
  }
  departSaveState();
}

function departFinishRun() {
  DEPART_S.running = false;
  departClearState();
  departClearStop();
  const report = buildDepartReport(DEPART_S.results);
  log(`═══ סיום עזיבה · ${report.summary}`);
  departHook('onDone', DEPART_S.results, report);
}

function departReasonLabel(value) {
  const r = DEPART_REASONS.find((x) => x.value === String(value));
  return r ? r.label : String(value);
}

async function departRunQueue() {
  DEPART_S.running = true;
  departWatchUnload();
  const st = DEPART_S.settings;
  log(`🚀 עזיבה: ${DEPART_S.queue.length} תלמידים, מתחילים בשורה ${DEPART_S.curIdx + 1} · תאריך "${st.leaveDate || 'היום'}" · סיבה ${st.leaveReason} (${departReasonLabel(st.leaveReason)})`);
  departHook('onStart', DEPART_S.queue, DEPART_S.curIdx);

  while (DEPART_S.curIdx < DEPART_S.queue.length) {
    if (departIsStopped()) {
      log('⛔ נעצר - ממלאים את שארית התור');
      departFillRemaining(DEPART_STATUS.STOPPED, 'לא עובד (נעצר)', DEPART_ACTIONS.stopped);
      break;
    }
    const idx = DEPART_S.curIdx;
    const task = DEPART_S.queue[idx];
    departHook('onProgress', idx, DEPART_S.queue.length, task);

    let result;
    try {
      const nav = await departEnsureBranch(task);
      if (nav.navigated) {
        DEPART_S.running = false;
        log('… טעינת דף - ההמשך אחרי הטעינה');
        return DEPART_NAVIGATED;
      }
      if (!nav.ok) result = makeDepartResult(task, nav.status, nav.detail, nav.action);
      else result = await departProcessStudentSafe(task);
    } catch (err) {
      if (departIsStopError(err)) {
        log(`⛔ נעצר לפני החלק ההרסני: ${err.message}`);
        departRecordResult(makeDepartResult(task, DEPART_STATUS.STOPPED, 'לא עובד (נעצר)', DEPART_ACTIONS.stopped), idx);
        departFillRemaining(DEPART_STATUS.STOPPED, 'לא עובד (נעצר)', DEPART_ACTIONS.stopped);
        break;
      }
      result = makeDepartResult(task, `${DEPART_STATUS.ERROR}: ${err && err.message}`, err && err.message, DEPART_ACTIONS.error);
    }
    departRecordResult(result, idx);
    await sleep(150);
  }
  departFinishRun();
  return null;
}

async function departStartRun(tasks, settings) {
  departClearStop();
  departResetRun();
  departResetLandings();
  DEPART_S.queue = Array.isArray(tasks) ? tasks.slice() : [];
  DEPART_S.settings = {
    leaveDate: settings && settings.leaveDate ? String(settings.leaveDate).trim() : '',
    leaveReason: settings && settings.leaveReason ? String(settings.leaveReason) : DEPART_DEFAULT_REASON,
  };
  DEPART_S.startedAt = new Date().toISOString();
  departSaveState();
  return departRunQueue();
}

function departHasSavedQueue() {
  const st = departLoadState();
  return !!(st && Array.isArray(st.queue) && st.queue.length && (st.curIdx || 0) < st.queue.length);
}

function departSavedQueueInfo() {
  const st = departLoadState();
  if (!st || !Array.isArray(st.queue) || !st.queue.length) return null;
  return { total: st.queue.length, curIdx: st.curIdx || 0, startedAt: st.startedAt || null, stale: departQueueIsStale(st.startedAt, Date.now(), DEPART_MAX_QUEUE_AGE_MS) };
}

function departDiscardSavedQueue() {
  departResetRun();
  departClearState();
  departClearStop();
  log('[עזיבה] התור השמור נמחק לבקשת המשתמש');
  return true;
}

// בטעינת דף: תור שמור → ממשיכים (אחרי שה-MS AJAX מסיים לאתחל). תור ישן (>30 דק') ממשיך
// רק אחרי "המשך" בפאנל. רשת-ביטחון: מעל DEPART_MAX_LANDINGS טעינות לתלמיד → "דולג".
async function departResumeIfPending(opts) {
  if (DEPART_S.running) return false;
  const allowStale = !!(opts && opts.allowStale);
  const st = departLoadState();
  if (!st || !Array.isArray(st.queue) || !st.queue.length) return false;

  if (departIsStopped()) { log('[המשך] דגל עצירה - מנקים מצב'); departClearState(); departClearStop(); return false; }
  if (!allowStale && departQueueIsStale(st.startedAt, Date.now(), DEPART_MAX_QUEUE_AGE_MS)) {
    log(`[המשך] תור עזיבה שמור מ-${st.startedAt} ישן מ-${Math.round(DEPART_MAX_QUEUE_AGE_MS / 60000)} דקות - לא ממשיכים אוטומטית`);
    departHook('onStaleQueue', { total: st.queue.length, curIdx: st.curIdx || 0, startedAt: st.startedAt || null, stale: true });
    return false;
  }

  DEPART_S.queue = st.queue;
  DEPART_S.results = Array.isArray(st.results) ? st.results : [];
  DEPART_S.curIdx = st.curIdx || 0;
  DEPART_S.startedAt = st.startedAt || null;
  DEPART_S.settings = Object.assign({ leaveDate: '', leaveReason: DEPART_DEFAULT_REASON }, st.settings || {});
  if (DEPART_S.curIdx >= DEPART_S.queue.length) { departFinishRun(); return false; }

  const landings = departBumpLandings(DEPART_S.curIdx);
  log(`[המשך] שורה ${DEPART_S.curIdx + 1}/${DEPART_S.queue.length} · טעינה ${landings} · דף ${getPage().kind}`);
  if (landings > DEPART_MAX_LANDINGS) {
    const stuck = DEPART_S.queue[DEPART_S.curIdx];
    log(`⚠️ תלמיד ${maskId(stuck.identity)}: ${landings} טעינות דף בלי סיום - מדלגים`);
    departRecordResult(makeDepartResult(stuck, DEPART_STATUS.SKIPPED, `לולאת ניווט: ${landings} טעינות דף ללא התקדמות`, departManualBranchAction(stuck.branch)), DEPART_S.curIdx);
    if (DEPART_S.curIdx >= DEPART_S.queue.length) { departFinishRun(); return false; }
  }

  departHook('onResume', DEPART_S.queue, DEPART_S.results, DEPART_S.curIdx, DEPART_S.settings);
  DEPART_S.running = true; // לפני ההמתנה, שלחיצת "התחל" בשנייה הזו לא תפתח ריצה מקבילה
  try {
    await sleep(900);
    await departRunQueue();
  } catch (e) {
    DEPART_S.running = false;
    throw e;
  }
  return true;
}

// עצירה: הדגל נשמר ב-sessionStorage (שורד טעינת-דף). כשלא רצים (למשל בהמתנה לטעינה) -
// סוגרים את הריצה מיד; כשרצים - הלולאה עוצרת בנקודת-הבדיקה הבאה, לפני החלק ההרסני.
function departStop() {
  departSetStop();
  log('⛔ בקשת עצירה (עזיבה)');
  if (!DEPART_S.running) {
    if (DEPART_S.queue.length && DEPART_S.curIdx < DEPART_S.queue.length) {
      departFillRemaining(DEPART_STATUS.STOPPED, 'לא עובד (נעצר)', DEPART_ACTIONS.stopped);
      departFinishRun();
    } else {
      departClearState();
      departClearStop();
    }
  }
}

// ─── src/tools/depart-ui.js ───
// לשונית "עזיבת תלמידים" בחלונית המאוחדת. הזרימה עצמה ב-depart.js; כאן רק הממשק:
// קלט (טורים סניף · ת.ז.), שגיאות-פרסור, תאריך וסיבת עזיבה, התחל/עצור, תוצאות, דוח "מה נשאר".
// כל השמות ברמה-עליונה בקידומת depart (סקופ משותף בבאנדל). אין גישה ל-document ברמת המודול.


const DEPART_P = 'tt-depart';
let departUi = null;
let departAwaitingErrorConfirm = false;
let departResults = [];
let departTotal = 0;

const DEPART_COLUMNS = [
  { key: 'branch', label: 'סניף', center: true, width: '44px' },
  { key: 'identity', label: 'ת.ז.', mono: true },
  { key: 'status', label: 'סטטוס' },
];

function departClassify(r) {
  if (isDepartSuccess(r.status)) return 'ok';
  const key = departStatusKey(r.status);
  if (key === DEPART_STATUS.STOPPED || key === DEPART_STATUS.SKIPPED || key === DEPART_STATUS.NOT_FOUND) return 'warn';
  return 'bad';
}

function departRenderResults() {
  setHtml(`${DEPART_P}-results`, resultsTableHtml({ columns: DEPART_COLUMNS, rows: departResults, classify: departClassify }));
}

function departRenderErrors(errors, validCount) {
  if (!errors || !errors.length) { show(`${DEPART_P}-errors`, false); setHtml(`${DEPART_P}-errors`, ''); return; }
  const items = errors.slice(0, 25).map((e) => `<li>שורה ${esc(e.line)}: ${esc(e.reason)}</li>`).join('');
  setHtml(`${DEPART_P}-errors`, `<b>${errors.length} שורות לא יורצו</b> (${validCount} תקינות):<ul>${items}${errors.length > 25 ? `<li>ועוד ${errors.length - 25}</li>` : ''}</ul>`);
  show(`${DEPART_P}-errors`, true);
}

function departRenderReport(report) {
  if (!report) { show(`${DEPART_P}-report`, false); setHtml(`${DEPART_P}-report`, ''); return; }
  setHtml(`${DEPART_P}-report`, reportBoxHtml(report));
  show(`${DEPART_P}-report`, true);
}

function departRenderStaleQueue(info) {
  if (!info) { show(`${DEPART_P}-stale`, false); setHtml(`${DEPART_P}-stale`, ''); return; }
  const left = Math.max(0, (info.total || 0) - (info.curIdx || 0));
  const startedMs = Date.parse(info.startedAt);
  const ageMin = Number.isNaN(startedMs) ? null : Math.round((Date.now() - startedMs) / 60000);
  setHtml(`${DEPART_P}-stale`, `<b>נמצא תור עזיבה שמור${ageMin === null ? '' : ` מלפני ${esc(ageMin)} דקות`}</b>: ${esc(left)} שורות טרם עובדו (${esc(info.curIdx || 0)} מתוך ${esc(info.total || 0)} הושלמו). התור ישן מדי להמשך אוטומטי.
    ${buttonsRowHtml([
      { id: `${DEPART_P}-stale-go`, label: 'המשך את התור', kind: 'primary', size: 'small' },
      { id: `${DEPART_P}-stale-clear`, label: 'נקה את התור', kind: 'danger', size: 'small' },
    ])}`);
  show(`${DEPART_P}-stale`, true);
  $el(`${DEPART_P}-stale-go`).addEventListener('click', () => {
    departRenderStaleQueue(null);
    departUi.status('ממשיך את התור השמור…');
    departSetRunning(true);
    Promise.resolve().then(() => departResumeIfPending({ allowStale: true })).catch((e) => { log('[המשך] כשל: ' + (e && e.message)); departSetRunning(false); });
  });
  $el(`${DEPART_P}-stale-clear`).addEventListener('click', () => {
    departDiscardSavedQueue();
    departRenderStaleQueue(null);
    departSetRunning(false);
    departUi.status('התור השמור נמחק. אפשר להתחיל ריצה חדשה');
  });
}

function departSetRunning(on) {
  setDisabled(`${DEPART_P}-start`, !!on);
  departUi.running(!!on);
}

function departReadSettings() {
  const dateEl = $el(`${DEPART_P}-date`);
  const reasonEl = $el(`${DEPART_P}-reason`);
  return {
    leaveDate: dateEl ? String(dateEl.value || '').trim() : '',
    leaveReason: reasonEl && reasonEl.value ? String(reasonEl.value) : DEPART_DEFAULT_REASON,
  };
}

function departApplySettings(settings) {
  if (!settings) return;
  const dateEl = $el(`${DEPART_P}-date`);
  if (dateEl && settings.leaveDate !== undefined) dateEl.value = settings.leaveDate || '';
  const reasonEl = $el(`${DEPART_P}-reason`);
  if (reasonEl && settings.leaveReason) reasonEl.value = String(settings.leaveReason);
}

function departResetStartButton() {
  departAwaitingErrorConfirm = false;
  setText(`${DEPART_P}-start`, 'התחל עזיבה');
  departRenderErrors([], 0);
}

async function departStart() {
  if (departIsRunning()) return;
  const text = (($el(`${DEPART_P}-input`) || {}).value || '').trim();
  if (!text) { departUi.status('הדבק רשימה: סניף ות.ז. בכל שורה (טורים מאקסל)'); return; }
  const settings = departReadSettings();
  if (settings.leaveDate && !departIsValidDate(settings.leaveDate)) {
    departUi.status('תאריך העזיבה לא תקין. הפורמט: DD/MM/YYYY, או השאר ריק (= היום)');
    return;
  }
  const parsed = parseDepartInput(text);
  if (parsed.errors.length && !departAwaitingErrorConfirm) {
    departRenderErrors(parsed.errors, parsed.tasks.length);
    departAwaitingErrorConfirm = true;
    setText(`${DEPART_P}-start`, parsed.tasks.length ? `הרץ בכל זאת את ${parsed.tasks.length} התקינות` : 'התחל עזיבה');
    departUi.status(`${parsed.errors.length} שורות בעייתיות. תקן אותן, או לחץ שוב כדי להריץ רק את התקינות`);
    log(`[עזיבה] פרסור: ${parsed.tasks.length} תקינות · ${parsed.errors.length} שגויות`);
    return;
  }
  if (!parsed.tasks.length) { departRenderErrors(parsed.errors, 0); departUi.status('אין שורות תקינות להרצה'); return; }
  departResetStartButton();
  departRenderReport(null);
  departRenderStaleQueue(null);
  departResults = [];
  departRenderResults();
  departSetRunning(true);
  departUi.progress(0, parsed.tasks.length);
  departUi.status(`מריץ עזיבה ל-${parsed.tasks.length} תלמידים…`);
  log(`[עזיבה] התחלה: ${parsed.tasks.length} תלמידים · תאריך "${settings.leaveDate || 'היום'}" · סיבה ${settings.leaveReason}`);
  await departStartRun(parsed.tasks, settings);
}

function departStopClick() {
  departUi.status('עוצר… (מסיים את התלמיד הנוכחי אם כבר התחיל)');
  log('⛔ עצירה לבקשת המשתמש');
  departStop();
  departSetRunning(false);
}

function departCurrentRows() {
  const live = departGetResults();
  return live.length ? live : departResults;
}

function departCopyTsv() {
  const rows = departCurrentRows();
  if (!rows.length) { departUi.status('אין תוצאות להעתקה'); return; }
  copyTextToClipboard(buildDepartTsv(rows)).then((ok) => {
    flash(`${DEPART_P}-tsv`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק לאקסל');
    departUi.status(ok ? 'התוצאות הועתקו. הדבק באקסל (Ctrl+V)' : 'ההעתקה נחסמה בדפדפן. השתמש בייצוא CSV');
  });
}

function departExportCsv() {
  const rows = departCurrentRows();
  if (!rows.length) { departUi.status('אין תוצאות לייצוא'); return; }
  const name = `departures_${new Date().toISOString().slice(0, 10)}.csv`;
  departUi.status(downloadCsv(name, buildDepartCsvRows(rows)) ? `הורד ${name}` : 'הייצוא נכשל');
}

function departMount(container, panelUi, page) {
  departUi = panelUi;
  container.innerHTML = `
    <div class="tt-box tt-box-info">
      <b>טורים כמו באקסל</b> (טאבים, פסיקים או רווחים; שורת כותרת אופציונלית; שורה שמתחילה ב-# מדולגת): סניף · ת.ז.
      התלמיד מחופש בלשונית "תלמידים למוסד" של הסניף; מי שכבר עזב מדווח ולא נוגעים בו.
    </div>
    <textarea id="${DEPART_P}-input" class="tt-textarea" placeholder="00&#9;012345678&#10;16&#9;023456789"></textarea>
    <div id="${DEPART_P}-errors" class="tt-box tt-box-error" hidden></div>
    <div id="${DEPART_P}-stale" class="tt-box tt-box-warn" hidden></div>
    <div class="tt-row">
      ${fieldHtml('תאריך עזיבה (ריק = היום)', `<input id="${DEPART_P}-date" class="tt-input tt-mono" type="text" maxlength="10" placeholder="${todayDMY()}">`)}
      ${fieldHtml('סיבת עזיבה', selectHtml({ id: `${DEPART_P}-reason`, options: DEPART_REASONS, value: DEPART_DEFAULT_REASON }))}
    </div>
    ${buttonsRowHtml([
      { id: `${DEPART_P}-start`, label: 'התחל עזיבה', kind: 'primary' },
      { id: `${DEPART_P}-stop`, label: 'עצור', kind: 'danger', title: 'גם מקש Escape עוצר' },
    ])}
    ${buttonsRowHtml([
      { id: `${DEPART_P}-tsv`, label: 'העתק לאקסל', kind: 'ghost', size: 'small' },
      { id: `${DEPART_P}-csv`, label: 'ייצוא CSV', kind: 'ghost', size: 'small' },
    ])}
    <div id="${DEPART_P}-results" class="tt-scroll"></div>
    <div id="${DEPART_P}-report" class="tt-box tt-box-warn" hidden></div>`;

  bindDateMask(`${DEPART_P}-date`);
  $el(`${DEPART_P}-input`).addEventListener('input', () => { if (departAwaitingErrorConfirm) departResetStartButton(); });
  $el(`${DEPART_P}-start`).addEventListener('click', () => {
    Promise.resolve().then(departStart).catch((e) => {
      log('[עזיבה] ההרצה נכשלה: ' + (e && e.message));
      departSetRunning(false);
      departUi.status('ההרצה נכשלה. בדוק את היומן ונסה שוב');
    });
  });
  $el(`${DEPART_P}-stop`).addEventListener('click', departStopClick, true);
  $el(`${DEPART_P}-tsv`).addEventListener('click', departCopyTsv);
  $el(`${DEPART_P}-csv`).addEventListener('click', departExportCsv);

  departSetHooks({
    onStart: (queue, idx) => { departTotal = queue.length; departUi.progress(idx, departTotal); departSetRunning(true); },
    onResume: (queue, res, idx, settings) => {
      departTotal = queue.length; departResults = res.slice(); departRenderResults(); departUi.progress(idx, departTotal); departSetRunning(true);
      const ta = $el(`${DEPART_P}-input`);
      if (ta) ta.value = queue.map((t) => `${t.branch}\t${t.identity}`).join('\n');
      departApplySettings(settings);
      departUi.status(`ממשיך אחרי טעינת דף: ${idx + 1} מתוך ${departTotal}`);
      departUi.open();
    },
    onProgress: (idx, tot, task) => { departTotal = tot; departUi.progress(idx, tot); departUi.status(`מעבד ${idx + 1}/${tot}: סניף ${task.branch} · ${task.identity}`); },
    onResult: (result, all) => { departResults = all.slice(); departRenderResults(); departUi.progress(all.length, Math.max(departTotal, all.length)); },
    onNavigating: (branch) => { departUi.status(`מנווט לסניף ${branch}… ממתין לטעינת דף`); },
    onStaleQueue: (info) => { departSetRunning(false); departUi.status('יש תור עזיבה שמור ישן. בחר "המשך" או "נקה"'); departRenderStaleQueue(info); departUi.open(); },
    onDone: (all, report) => {
      departResults = all.slice(); departRenderResults(); departRenderReport(report); departSetRunning(false); departUi.progress(all.length, all.length);
      departUi.status(report.lines.length ? `הסתיים. ${report.lines.length} שורות דורשות טיפול (ראה "מה נשאר")` : 'הסתיים. הכול טופל');
    },
  });

  log(`[עזיבה] דף ${page.kind}${page.branch ? ` · סניף ${page.branch} [${page.branchSource || '?'}]` : ''}`);
  departResults = departGetResults();
  departRenderResults();
  const saved = departSavedQueueInfo();
  if (departHasSavedQueue()) departUi.status(saved && saved.stale ? 'נמצא תור עזיבה שמור ישן. בודק…' : 'נמצא תור עזיבה פתוח. ממשיך…');
  Promise.resolve().then(() => departResumeIfPending()).catch((e) => { log('[המשך] כשל: ' + (e && e.message)); departSetRunning(false); });
}

const departTool = {
  id: 'depart',
  title: 'עזיבת תלמידים',
  pages: ['institute'],
  hasPendingRun: departHasSavedQueue,
  isRunning: departIsRunning,
  onStop: departStopClick,
  mount: departMount,
};

// ─── src/tools/report.js ───
// דיווח חודשי אוטומטי: הזרימה + הפונקציות הטהורות. הועבר מ"תלמוד - דיווח חודשי אוטומטי" v4.0.
// לכל סניף שבעץ-הצד: ניווט לדף המוסד (טעינה מלאה) → אימות שה-h1 מציג את הסניף → כפתור
// btnReport מנוטרל? "דולג (כבר דווח)" → אחרת: לשונית "מצב תמיכה" → postback של הכפתור דרך ה-href
// (בלי eval) → חלונית אזהרה → לחיצה על "המשך" בכוונה (זו פעולת הדיווח עצמה, כמו בישן) →
// חלונית הצלחה → סגירה → "נשלח". המצב ב-sessionStorage (talmud.report.state) והמשך אחרי טעינת דף.
// חדש מול הישן: "עצור" (נכנס לתוקף לפני הסניף הבא), חיווי "אם נתקע, רענן", רשת-ביטחון של 3 טעינות
// לסניף, בלי alert ובלי reload בסוף. אין גישה ל-document/window ברמת המודול.


const REPORT_STATE_KEY = 'talmud.report.state';
const REPORT_STATUS = {
  SENT: 'נשלח',
  SKIPPED: 'דולג (כבר דווח)',
  ERROR: 'שגיאה',
  STOPPED: 'נעצר',
};
const REPORT_MAX_LANDINGS = 3; // טעינות-דף לאותו סניף; מעל זה: "שגיאה" והמשך
const REPORT_STUCK_MS = 20000; // בלי צעד במשך זמן זה: "אם נתקע, רענן את הדף"
const REPORT_IDS = {
  button: 'ContentPlaceHolder1_btnReport',
  supportTab: '__tab_ContentPlaceHolder1_tabInstituteDetails_TabInstituteEntitlement',
  popupContinue: 'ucMessagePopUp_btnMOK',
};
const REPORT_TSV_HEADER = ['סניף', 'סטטוס', 'פירוט', 'מה לעשות'];
const REPORT_PAGE_WAIT_MS = 15000; // כמו הישן: המתנה ל-h1 ולכפתור
const REPORT_POPUP_WAIT_MS = 10000; // כמו הישן: המתנה לחלונית
const REPORT_NAV_WATCHDOG_MS = 12000; // ניווט שלא הביא טעינת דף

function reportManualAction(branch) {
  return `פתח את דף המוסד של סניף ${branch}, לשונית "מצב תמיכה", ולחץ "שליחת דיווח חודשי" ידנית`;
}

// ─── טהורות ─────────────────────────────────────────────────────────────────

// האם כפתור הדיווח פעיל. הישן: disabled!=="true" וגם class בלי "disabled". כאן קצת רחב יותר:
// כל תכונת disabled (חוץ מ-"false"), ו-class שמכיל disabled בכל רישיות (ASP.NET: aspNetDisabled).
function reportIsButtonEnabled(btn) {
  if (!btn || typeof btn !== 'object') return false;
  let attr = null;
  if (typeof btn.getAttribute === 'function') attr = btn.getAttribute('disabled');
  else attr = btn.disabled ? 'true' : null;
  if (attr !== null && attr !== undefined && String(attr).trim().toLowerCase() !== 'false') return false;
  const cls = String(btn.className == null ? '' : btn.className).toLowerCase();
  return cls.indexOf('disabled') === -1;
}

function reportMakeResult(branch, status, detail, action) {
  return { branch: String(branch == null ? '' : branch), status, detail: detail || '', action: action || '' };
}

function reportFlatCell(value) {
  return String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ').trim();
}

// סיכום "נשלחו X, דולגו Y, שגיאות Z" (+ "נעצרו W" כשיש) ושורות "מה נשאר" לשגיאות ולנעצרים.
function reportSummary(results) {
  const list = Array.isArray(results) ? results.filter((r) => r && typeof r === 'object') : [];
  const count = (status) => list.filter((r) => r.status === status).length;
  const sent = count(REPORT_STATUS.SENT);
  const skipped = count(REPORT_STATUS.SKIPPED);
  const errors = count(REPORT_STATUS.ERROR);
  const stopped = count(REPORT_STATUS.STOPPED);
  let summary = `נשלחו ${sent}, דולגו ${skipped}, שגיאות ${errors}`;
  if (stopped) summary += `, נעצרו ${stopped}`;
  const lines = list
    .filter((r) => r.status === REPORT_STATUS.ERROR || r.status === REPORT_STATUS.STOPPED)
    .map((r) => [`סניף ${r.branch}`, r.status, r.detail, r.action].map(reportFlatCell).filter(Boolean).join(' · '));
  return { sent, skipped, errors, stopped, total: list.length, summary, lines };
}

// TSV להדבקה באקסל (עם כותרת).
function reportBuildTsv(results) {
  const lines = [REPORT_TSV_HEADER.join('\t')];
  for (const r of Array.isArray(results) ? results : []) {
    if (!r) continue;
    lines.push([r.branch, r.status, r.detail, r.action].map(reportFlatCell).join('\t'));
  }
  return lines.join('\n');
}

// מונה טעינות לסניף הנוכחי: {idx, count}. סניף אחר מאפס.
function reportBumpLandings(rec, idx) {
  const same = rec && typeof rec === 'object' && rec.idx === idx;
  return { idx, count: same ? (Number(rec.count) || 0) + 1 : 1 };
}

// האם עבר יותר מדי זמן מאז הצעד האחרון.
function reportIsStuck(lastStepAt, now, thresholdMs) {
  const t = typeof lastStepAt === 'number' ? lastStepAt : Number(lastStepAt);
  if (!lastStepAt || !Number.isFinite(t)) return false;
  const n = typeof now === 'number' ? now : Date.now();
  const th = typeof thresholdMs === 'number' ? thresholdMs : REPORT_STUCK_MS;
  return n - t > th;
}

// האינדקס הבא לביצוע מתוך מצב שמור; -1 כשאין (סיום או מצב לא תקין).
function reportNextIndexToRun(state) {
  if (!state || !Array.isArray(state.branches) || !state.branches.length) return -1;
  const idx = Number.isFinite(Number(state.curIdx)) ? Math.max(0, Math.floor(Number(state.curIdx))) : 0;
  return idx < state.branches.length ? idx : -1;
}

// טקסט הודעה שנראה ככישלון (אחרי "המשך"). הישן סימן "נשלח" בלי לקרוא; כאן קוראים כדי לא לשקר.
function reportPopupLooksLikeFailure(text) {
  return /שגיאה|נכשל|לא הצליח|לא ניתן|לא בוצע/.test(String(text == null ? '' : text));
}

// ─── מצב חי + sessionStorage ────────────────────────────────────────────────

const reportLive = { running: false, stop: false, hooks: {}, lastStepAt: null, lastResults: [] };

function reportSetHooks(hooks) { reportLive.hooks = hooks || {}; }
function reportHook(name, ...args) { try { if (reportLive.hooks[name]) reportLive.hooks[name](...args); } catch (e) { /* אצווה לא נתקעת */ } }

function reportLoadState() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(REPORT_STATE_KEY) || 'null');
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.branches) ? parsed : null;
  } catch (e) {
    return null;
  }
}

// שומר; דגל העצירה שכבר נשמר (מהלשונית או מטעינה אחרת) לעולם לא נדרס.
function reportSaveState(state) {
  try {
    const stored = reportLoadState();
    if (stored && stored.stop === true) state.stop = true;
    sessionStorage.setItem(REPORT_STATE_KEY, JSON.stringify(state));
  } catch (e) { log('[דיווח] שמירת המצב נכשלה: ' + (e && e.message)); }
}

function reportClearState() {
  try { sessionStorage.removeItem(REPORT_STATE_KEY); } catch (e) { /* אצווה לא נתקעת */ }
}

function reportHasPendingRun() {
  const st = reportLoadState();
  return !!(st && st.running && reportNextIndexToRun(st) !== -1);
}

// "רץ" גם כשממתינים לטעינת דף (כדי ש-Escape/"עצור" יעבדו באמצע ניווט).
function reportIsRunning() {
  return reportLive.running || reportHasPendingRun();
}

function reportGetResults() {
  const st = reportLoadState();
  if (st && Array.isArray(st.results)) return st.results.slice();
  return reportLive.lastResults.slice();
}

function reportLastStepAt() {
  if (reportLive.lastStepAt) return reportLive.lastStepAt;
  const st = reportLoadState();
  return st && st.lastStepAt ? st.lastStepAt : null;
}

function reportTouch(state) {
  state.lastStepAt = Date.now();
  reportLive.lastStepAt = state.lastStepAt;
}

function reportStopRequested(state) {
  if (reportLive.stop || (state && state.stop === true)) return true;
  const stored = reportLoadState();
  return !!(stored && stored.stop === true);
}

// "עצור": מסמן דגל במצב השמור. הריצה נעצרת לפני הסניף הבא (לא באמצע שליחה).
// אם אין ריצה חיה בדף הזה אך יש מצב שמור (למשל טעינה שלא הגיעה): מסיימים כאן.
function reportRequestStop() {
  reportLive.stop = true;
  log('⛔ בקשת עצירה: הריצה תיעצר לפני הסניף הבא');
  const st = reportLoadState();
  if (st) { st.stop = true; reportSaveState(st); }
  if (!reportLive.running && st && st.running) {
    reportFillRemaining(st);
    reportFinish(st);
  }
}

// ─── רישום תוצאות וסיום ─────────────────────────────────────────────────────

function reportRecord(state, idx, result) {
  state.results = Array.isArray(state.results) ? state.results : [];
  state.results.push(result);
  state.curIdx = idx + 1;
  state.landings = null;
  state.pendingSend = null;
  reportTouch(state);
  reportSaveState(state);
  log(`◀ סניף ${result.branch}: ${result.status}${result.detail ? ' · ' + result.detail : ''}`);
  reportHook('onResult', result, state.results.slice());
}

function reportFillRemaining(state) {
  state.results = Array.isArray(state.results) ? state.results : [];
  let idx = reportNextIndexToRun(state);
  while (idx !== -1) {
    state.results.push(reportMakeResult(state.branches[idx], REPORT_STATUS.STOPPED, 'נעצר לפני השליחה', 'הרץ שוב; סניפים שכבר דווחו ידולגו אוטומטית'));
    state.curIdx = idx + 1;
    idx = reportNextIndexToRun(state);
  }
  reportSaveState(state);
}

function reportFinish(state) {
  reportLive.running = false;
  reportLive.stop = false;
  reportLive.lastResults = Array.isArray(state.results) ? state.results.slice() : [];
  reportClearState();
  const summary = reportSummary(reportLive.lastResults);
  log(`═══ סיום דיווח חודשי · ${summary.summary}`);
  reportHook('onDone', reportLive.lastResults.slice(), summary);
}

// ─── צעדים מול הדף ──────────────────────────────────────────────────────────

async function reportWaitPopup(predicate) {
  try {
    return await waitFor(() => {
      const pop = readMessagePopup();
      if (!pop) return false;
      return predicate && !predicate(pop) ? false : pop;
    }, { timeout: REPORT_POPUP_WAIT_MS, interval: 100 });
  } catch (e) {
    return null;
  }
}

async function reportHidePopup() {
  const hid = hideMessagePopupAsync();
  if (hid.wait) await hid.wait;
  try { await waitFor(() => !readMessagePopup(), { timeout: 5000, interval: 100 }); } catch (e) { /* ממשיכים */ }
  await sleep(400); // כמו הישן
}

function reportOnRightPage(branch) {
  const page = getPage();
  return page.kind === 'institute' && page.branch === branch;
}

// ניווט לסניף. טעינה מלאה הורגת את ההקשר (ההמשך ב-mount); רינדור-במקום ממשיך כאן.
// מחזיר null כשהדף מתאים, או תוצאת-שגיאה.
async function reportEnsureBranchPage(state, idx, branch) {
  if (reportOnRightPage(branch)) return null;
  const landings = reportBumpLandings(state.landings, idx);
  state.landings = landings;
  if (landings.count > REPORT_MAX_LANDINGS) {
    return reportMakeResult(branch, REPORT_STATUS.ERROR, `הדף לא הגיע לסניף ${branch} אחרי ${REPORT_MAX_LANDINGS} טעינות`, reportManualAction(branch));
  }
  reportTouch(state);
  reportSaveState(state);
  reportHook('onNavigating', branch);
  log(`[ניווט] → סניף ${branch} (טעינה ${landings.count}/${REPORT_MAX_LANDINGS})`);
  const res = await gotoInstitute(branch);
  if (!res || res.ok === false) {
    if (res && res.notFound) return reportMakeResult(branch, REPORT_STATUS.ERROR, res.reason, `ודא שסניף ${branch} מופיע בעץ-הצד, ושלח ידנית`);
    return reportMakeResult(branch, REPORT_STATUS.ERROR, (res && res.reason) || 'הניווט נכשל', reportManualAction(branch));
  }
  const t0 = Date.now();
  while (Date.now() - t0 < REPORT_NAV_WATCHDOG_MS) {
    await sleep(200);
    if (reportOnRightPage(branch)) { log('[ניווט] הדף התעדכן בלי טעינה מלאה: ממשיכים במקום'); return null; }
  }
  return reportMakeResult(branch, REPORT_STATUS.ERROR, `הניווט לסניף ${branch} לא הביא טעינת דף תוך ${Math.round(REPORT_NAV_WATCHDOG_MS / 1000)} שניות`, reportManualAction(branch));
}

async function reportFireButton(btn) {
  const pb = parsePostbackHref(btn.getAttribute('href') || '');
  const opts = { startTimeoutMs: 3000, totalTimeoutMs: 20000 };
  if (pb) return firePostback(pb.target, pb.arg, opts);
  const wait = waitPRM(opts); // (1) נרשם קודם
  setTimeout(() => { try { btn.click(); } catch (e) { log('[דיווח] לחיצה על הכפתור נכשלה: ' + (e && e.message)); } }, 0); // (2) נדחה
  return wait;
}

// סניף אחד. מחזיר תוצאה. ניווט שמביא טעינה מלאה לא חוזר (הדף נפרק).
async function reportProcessBranch(state, idx, branch) {
  const mk = (status, detail, action) => reportMakeResult(branch, status, detail, action);

  const navFail = await reportEnsureBranchPage(state, idx, branch);
  if (navFail) return navFail;

  // כמו הישן: המתנה לכפתור (ה-h1 כבר אומת), ואז שנייה חצי להתייצבות
  let btn = null;
  try { btn = await waitFor(() => $el(REPORT_IDS.button), { timeout: REPORT_PAGE_WAIT_MS, interval: 200 }); } catch (e) { btn = null; }
  if (!btn) return mk(REPORT_STATUS.ERROR, 'כפתור "שליחת דיווח חודשי" לא נמצא בדף המוסד', `בדוק שבדף המוסד של סניף ${branch} יש לשונית "מצב תמיכה" עם כפתור הדיווח, ושלח ידנית`);
  await sleep(500);

  // "המשך" נלחץ ואז הדף נטען מחדש: האמת בכפתור
  if (state.pendingSend && state.pendingSend.idx === idx) {
    state.pendingSend = null;
    if (!reportIsButtonEnabled(btn)) { log('[דיווח] אחרי "המשך" הדף נטען מחדש והכפתור מנוטרל → נשלח'); return mk(REPORT_STATUS.SENT, 'אומת אחרי טעינת הדף: כפתור הדיווח מנוטרל'); }
    return mk(REPORT_STATUS.ERROR, 'נלחץ "המשך" אך אחרי טעינת הדף כפתור הדיווח עדיין פעיל', `בדוק בדף המוסד של סניף ${branch} אם הדיווח נשלח; אם לא, שלח ידנית`);
  }

  if (!reportIsButtonEnabled(btn)) {
    log(`[דיווח] סניף ${branch}: כפתור הדיווח מנוטרל, כבר דווח`);
    return mk(REPORT_STATUS.SKIPPED, 'כפתור הדיווח מנוטרל');
  }
  if (reportStopRequested(state)) return mk(REPORT_STATUS.STOPPED, 'נעצר לפני השליחה', 'הרץ שוב; סניפים שכבר דווחו ידולגו אוטומטית');

  // לשונית "מצב תמיכה" (חובה לפני השליחה, כמו הישן: קליק צד-לקוח). F4 (30.10.2026): שינוי לשונית
  // ב-tabInstituteDetails הוא postback א-סינכרוני: רושמים waitPRM, לוחצים מ-setTimeout(0), וממתינים לסיום.
  const tab = $el(REPORT_IDS.supportTab);
  if (tab) {
    const tabWait = waitPRM({ startTimeoutMs: 1500, totalTimeoutMs: 25000 });
    setTimeout(() => { try { tab.click(); } catch (e) { /* לא קריטי */ } }, 0);
    await tabWait;
  } else log('[דיווח] לשונית "מצב תמיכה" לא נמצאה; מנסים לשלוח בכל זאת');
  await sleep(300);
  reportTouch(state);
  reportSaveState(state);

  // postback של הכפתור דרך ה-href (הישן: eval; כאן parsePostbackHref + firePostback)
  log(`[דיווח] סניף ${branch}: לוחצים "שליחת דיווח חודשי"`);
  const fired = await reportFireButton(btn);
  if (fired && fired.ok === false) log(`[דיווח] postback הכפתור: ${fired.reason}`);

  // חלונית האזהרה עם "המשך"
  const confirm = await reportWaitPopup();
  if (!confirm) return mk(REPORT_STATUS.ERROR, 'לא הופיעה חלונית אחרי לחיצה על "שליחת דיווח חודשי"', reportManualAction(branch));
  log(`[הודעה] "${confirm.text}" [${confirm.buttons.join(', ')}]`);
  if (!confirm.hasContinue) {
    await reportHidePopup();
    if (confirm.kind === 'success') return mk(REPORT_STATUS.SENT, confirm.text);
    return mk(REPORT_STATUS.ERROR, confirm.text || 'האתר החזיר הודעה בלי "המשך"', reportManualAction(branch));
  }

  // לחיצה על "המשך" בכוונה: זו פעולת הדיווח עצמה (הסקריפט הישן v4.0 עושה זאת, שורה 110).
  await sleep(200);
  const contBtn = $el(REPORT_IDS.popupContinue);
  if (!isVisible(contBtn)) return mk(REPORT_STATUS.ERROR, 'כפתור "המשך" בחלונית לא זמין', reportManualAction(branch));
  state.pendingSend = { idx, branch };
  reportTouch(state);
  reportSaveState(state); // "המשך" עלול לטעון דף מחדש; ההמשך יאמת לפי הכפתור
  log(`[דיווח] סניף ${branch}: לוחצים "המשך" (אישור שליחת הדיווח)`);
  const contWait = waitPRM({ startTimeoutMs: 3000, totalTimeoutMs: 20000 }); // (1) נרשם קודם
  setTimeout(() => { try { contBtn.click(); } catch (e) { log('[דיווח] לחיצת "המשך" נכשלה: ' + (e && e.message)); } }, 0); // (2) נדחה
  const contRes = await contWait;
  if (contRes && contRes.ok === false) log(`[דיווח] postback של "המשך": ${contRes.reason}`);

  // חלונית ההצלחה ("אישור" בלבד): ממתינים לחלונית שאינה חלונית האזהרה
  const done = await reportWaitPopup((pop) => pop.text !== confirm.text || !pop.hasContinue);
  state.pendingSend = null;
  if (!done) {
    return mk(REPORT_STATUS.ERROR, 'לא הופיעה הודעת הצלחה תוך 10 שניות אחרי "המשך"', `בדוק בדף המוסד של סניף ${branch} אם כפתור הדיווח הפך מנוטרל (סימן שנשלח); אם לא, שלח ידנית`);
  }
  log(`[הודעה] "${done.text}" [${done.buttons.join(', ')}]`);
  if (done.hasContinue && done.kind !== 'success') {
    // בקשת-אישור נוספת שאינה מוכרת: לא לוחצים לבד
    return mk(REPORT_STATUS.ERROR, `המערכת מבקשת אישור נוסף: "${done.text}"`, `פתח את דף המוסד של סניף ${branch}, קרא את ההודעה והחלט ידנית`);
  }
  await sleep(200);
  await reportHidePopup();
  if (done.kind !== 'success' && reportPopupLooksLikeFailure(done.text)) {
    return mk(REPORT_STATUS.ERROR, done.text, reportManualAction(branch));
  }
  return mk(REPORT_STATUS.SENT, done.text);
}

// ─── הלולאה ─────────────────────────────────────────────────────────────────

// מריץ סניף אחרי סניף מתוך המצב השמור. ניווט מלא פורק את הדף; ההמשך ב-reportResumeIfPending.
async function reportRunLoop() {
  const state = reportLoadState();
  if (!state || !state.running) { reportLive.running = false; return false; }
  reportLive.running = true;
  reportHook('onStart', state.branches.slice(), reportNextIndexToRun(state));
  for (;;) {
    const idx = reportNextIndexToRun(state);
    if (idx === -1) { reportFinish(state); return true; }
    if (reportStopRequested(state)) {
      log('⛔ נעצר: הסניפים שנותרו מסומנים "נעצר"');
      reportFillRemaining(state);
      reportFinish(state);
      return true;
    }
    const branch = state.branches[idx];
    reportHook('onProgress', idx, state.branches.length, branch);
    let result;
    try {
      result = await reportProcessBranch(state, idx, branch);
    } catch (e) {
      log(`[דיווח] תקלה בסניף ${branch}: ${e && e.message}`);
      result = reportMakeResult(branch, REPORT_STATUS.ERROR, `תקלה: ${(e && e.message) || 'לא ידועה'}`, reportManualAction(branch));
    }
    reportRecord(state, idx, result);
    await sleep(400);
  }
}

// "התחל": אוסף את הסניפים מעץ-הצד ומתחיל. מחזיר {ok, count} או {ok:false, reason}.
async function reportStart() {
  if (reportIsRunning()) return { ok: false, reason: 'ריצה כבר פעילה' };
  const branches = readBranchesFromTree();
  if (!branches.length) return { ok: false, reason: 'לא נמצאו סניפים בעץ-הצד. ודא שאתה בדף פרטי מוסד' };
  reportLive.stop = false;
  reportLive.lastResults = [];
  const state = {
    running: true, branches, curIdx: 0, results: [], stop: false, landings: null, pendingSend: null,
    startedAt: new Date().toISOString(), lastStepAt: Date.now(),
  };
  reportClearState(); // דגל עצירה ישן לא ייקלט לתוך הריצה החדשה
  reportSaveState(state);
  reportLive.lastStepAt = state.lastStepAt;
  log(`🚀 דיווח חודשי: ${branches.length} סניפים (${branches.join(', ')})`);
  await reportRunLoop();
  return { ok: true, count: branches.length };
}

// בטעינת דף: אם יש מצב שמור, ממשיכים (כמו הישן: המתנה ל-h1, ואז הצעד הבא).
async function reportResumeIfPending() {
  if (reportLive.running) return false;
  const state = reportLoadState();
  if (!state || !state.running) return false;
  if (reportNextIndexToRun(state) === -1) { reportFinish(state); return true; }
  if (reportStopRequested(state)) {
    log('⛔ דגל עצירה במצב השמור: הסניפים שנותרו מסומנים "נעצר"');
    reportFillRemaining(state);
    reportFinish(state);
    return true;
  }
  reportLive.running = true; // לפני ההמתנה, כדי ש"התחל" לא יפתח ריצה מקבילה
  reportLive.lastStepAt = state.lastStepAt || Date.now();
  reportHook('onResume', state);
  try {
    await waitFor(() => {
      const h1 = document.querySelector('h1');
      return !!(h1 && String(h1.textContent || '').trim().length > 3);
    }, { timeout: REPORT_PAGE_WAIT_MS, interval: 200 });
  } catch (e) { /* הצעד עצמו ינווט או ידווח שגיאה */ }
  await sleep(900); // MS AJAX מסיים לאתחל
  log(`[המשך] סניף ${reportNextIndexToRun(state) + 1}/${state.branches.length} · דף ${getPage().kind}`);
  return reportRunLoop();
}

// ─── src/tools/report-ui.js ───
// לשונית "דיווח חודשי" בחלונית המאוחדת. הזרימה ב-report.js; כאן רק הממשק: רשימת הסניפים שנמצאו,
// התחל/עצור, טבלת תוצאות (סניף, סטטוס, פירוט), "העתק לאקסל", סיכום "מה נשאר", וחיווי
// "אם נתקע, רענן את הדף" אחרי 20 שניות בלי צעד. אין גישה ל-document ברמת המודול.


const RP = 'tt-report';
let reportUi = null;
let reportRows = [];
let reportBaseStatus = 'מוכן';
let reportStuckTimer = null;
let reportTotal = 0;

const REPORT_COLUMNS = [
  { key: 'branch', label: 'סניף', center: true, width: '52px' },
  { key: 'status', label: 'סטטוס', width: '130px' },
  { key: 'detail', label: 'פירוט' },
];

function reportClassify(r) {
  if (r.status === REPORT_STATUS.SENT) return 'ok';
  if (r.status === REPORT_STATUS.SKIPPED || r.status === REPORT_STATUS.STOPPED) return 'warn';
  return 'bad';
}

function reportRenderRows() {
  setHtml(`${RP}-results`, resultsTableHtml({ columns: REPORT_COLUMNS, rows: reportRows, classify: reportClassify }));
}

function reportRenderSummary(summary) {
  if (!summary) { show(`${RP}-report`, false); setHtml(`${RP}-report`, ''); return; }
  setHtml(`${RP}-report`, reportBoxHtml({ summary: summary.summary, lines: summary.lines }, { idsWarning: false }));
  show(`${RP}-report`, true);
}

// שורת הסטטוס: הטקסט הבסיסי + "אם נתקע, רענן את הדף" כשעברו 20 שניות בלי צעד
function reportRenderStatus() {
  if (!reportUi) return;
  let stuck = false;
  try { stuck = reportIsRunning() && reportIsStuck(reportLastStepAt(), Date.now()); } catch (e) { stuck = false; }
  reportUi.status(stuck ? `${reportBaseStatus} · אם נתקע, רענן את הדף` : reportBaseStatus);
}

function reportSetStatus(msg) {
  reportBaseStatus = msg;
  reportRenderStatus();
}

function reportSetRunning(on) {
  setDisabled(`${RP}-start`, !!on);
  if (reportUi) reportUi.running(!!on);
  if (on) {
    if (!reportStuckTimer) reportStuckTimer = setInterval(reportRenderStatus, 1000);
  } else if (reportStuckTimer) {
    clearInterval(reportStuckTimer);
    reportStuckTimer = null;
  }
}

async function reportUiStart() {
  if (reportIsRunning()) { reportSetStatus('ריצה כבר פעילה'); return; }
  reportRows = [];
  reportRenderRows();
  reportRenderSummary(null);
  reportSetRunning(true);
  reportSetStatus('מתחיל…');
  const res = await reportStart();
  if (!res.ok) {
    reportSetRunning(false);
    reportSetStatus(res.reason);
  }
}

function reportUiStop() {
  if (!reportIsRunning()) { reportSetStatus('אין ריצה פעילה'); return; }
  reportSetStatus('עוצר… הריצה תיעצר לפני הסניף הבא');
  reportRequestStop();
}

function reportCopyTsv() {
  const rows = reportRows.length ? reportRows : reportGetResults();
  if (!rows.length) { reportSetStatus('אין תוצאות להעתקה'); return; }
  copyTextToClipboard(reportBuildTsv(rows)).then((ok) => {
    flash(`${RP}-tsv`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק לאקסל');
    reportSetStatus(ok ? 'התוצאות הועתקו. הדבק באקסל (Ctrl+V)' : 'ההעתקה נחסמה בדפדפן');
  });
}

function reportUiMount(container, panelUi, page) {
  reportUi = panelUi;
  const branches = page && page.kind === 'institute' ? readBranchesFromTree() : [];
  container.innerHTML = `
    <div class="tt-box tt-box-info">
      שולח דיווח חודשי לכל הסניפים שבעץ-הצד, סניף אחרי סניף. סניף שכפתור הדיווח שלו מנוטרל (כבר דווח) מדולג.
      הריצה עוברת בין דפי-מוסד; "עצור" נכנס לתוקף לפני הסניף הבא, לא באמצע שליחה.
    </div>
    <div id="${RP}-branches" class="tt-hint">${branches.length ? `נמצאו ${branches.length} סניפים: ${esc(branches.join(', '))}` : 'לא נמצאו סניפים בעץ-הצד של הדף הזה'}</div>
    ${buttonsRowHtml([
      { id: `${RP}-start`, label: 'התחל דיווח לכל הסניפים', kind: 'primary', disabled: !branches.length },
      { id: `${RP}-stop`, label: 'עצור', kind: 'danger', title: 'גם מקש Escape עוצר' },
    ])}
    ${buttonsRowHtml([
      { id: `${RP}-tsv`, label: 'העתק לאקסל', kind: 'ghost', size: 'small' },
    ])}
    <div id="${RP}-results" class="tt-scroll"></div>
    <div id="${RP}-report" class="tt-box tt-box-warn" hidden></div>`;

  $el(`${RP}-start`).addEventListener('click', () => {
    Promise.resolve().then(reportUiStart).catch((e) => {
      log('[דיווח] ההרצה נכשלה: ' + (e && e.message));
      reportSetRunning(false);
      reportSetStatus('ההרצה נכשלה. בדוק את היומן ונסה שוב');
    });
  });
  $el(`${RP}-stop`).addEventListener('click', reportUiStop, true);
  $el(`${RP}-tsv`).addEventListener('click', reportCopyTsv);

  reportSetHooks({
    onStart: (list, idx) => { reportTotal = list.length; reportSetRunning(true); reportUi.progress(idx, reportTotal); },
    onResume: (state) => {
      reportTotal = state.branches.length;
      reportRows = Array.isArray(state.results) ? state.results.slice() : [];
      reportRenderRows();
      reportSetRunning(true);
      reportUi.progress(reportRows.length, reportTotal);
      reportSetStatus(`ממשיך אחרי טעינת דף: סניף ${reportRows.length + 1} מתוך ${reportTotal}`);
      reportUi.open();
    },
    onProgress: (idx, total, branch) => { reportTotal = total; reportUi.progress(idx, total); reportSetStatus(`סניף ${branch} (${idx + 1}/${total})`); },
    onNavigating: (branch) => { reportSetStatus(`ממתין לטעינת דף המוסד של סניף ${branch}…`); },
    onResult: (result, all) => { reportRows = all.slice(); reportRenderRows(); reportUi.progress(all.length, Math.max(reportTotal, all.length)); },
    onDone: (all, summary) => {
      reportRows = all.slice();
      reportRenderRows();
      reportRenderSummary(summary);
      reportSetRunning(false);
      reportUi.progress(all.length, all.length);
      reportSetStatus(`הסתיים. ${summary.summary}`);
    },
  });

  reportRows = reportGetResults();
  reportRenderRows();
  if (reportHasPendingRun()) { reportSetStatus('נמצאה ריצה פתוחה. ממשיך…'); reportSetRunning(true); }
  Promise.resolve().then(() => reportResumeIfPending()).catch((e) => {
    log('[דיווח] ההמשך נכשל: ' + (e && e.message));
    reportSetRunning(false);
    reportSetStatus('ההמשך אחרי טעינת הדף נכשל. בדוק את היומן');
  });
}

const reportTool = {
  id: 'report',
  title: 'דיווח חודשי',
  pages: ['institute'],
  hasPendingRun: reportHasPendingRun,
  isRunning: reportIsRunning,
  onStop: reportUiStop,
  mount: reportUiMount,
};

// ─── src/tools/messages.js ───
// כלי "טיפול בהודעות": הזרימה והפונקציות הטהורות. העברה מכנית מ"תלמוד - טיפול בהודעות" v5.0
// (extractIdFromBody:247, makeUID:258, getMessagesOnPage:265, פייג'ר:293-343, ensureSentFilter:345,
// runScan:364, XLSX:409, loadPastedTable:476, runBulkMode:519, runTableMode:585, recordReport:664).
// דף ההודעות: /Association/Default.aspx. כל הפעולות בדף הן postback א-סינכרוני (אין טעינת-דף),
// ולכן אין כאן מצב שמור ב-sessionStorage; דגל-העצירה בזיכרון והלולאות בודקות אותו בכל סבב.
// שינויים מכוונים מול הישן: (1) הסדר הקשיח של הליבה לכל postback (firePostback / waitPRM לפני הירי);
// (2) אחרי כל פעולה מאמתים מול הגריד שההודעה כבר לא "נשלחה", כדי שפעולה שלא נתפסה תסומן "נכשל"
// ולא תיכנס ללולאה על אותה הודעה; (3) קריאת חלונית-ההודעה דרך הליבה, סגירה בלי "המשך", עם שורת-יומן.
// אין גישה ל-document/window ברמת המודול (import תקין ב-Node).


// ─── קבועים ─────────────────────────────────────────────────────────────────

const MESSAGES_ACTION = {
  APPROVE: 'אישור מעבר',
  DECLINE: 'דחיית מעבר',
  HANDLED: 'שנה מצב הודעה לטופל',
  SKIP: 'דלג',
};
const MESSAGES_ALL_ACTIONS = [MESSAGES_ACTION.APPROVE, MESSAGES_ACTION.DECLINE, MESSAGES_ACTION.HANDLED, MESSAGES_ACTION.SKIP];

// הכינויים של הסקריפט הישן (v5.0 שורות 22-27), כמות שהם.
const MESSAGES_ACTION_ALIASES = {
  'אשר': MESSAGES_ACTION.APPROVE, 'אישור': MESSAGES_ACTION.APPROVE, 'אישור מעבר': MESSAGES_ACTION.APPROVE, 'approve': MESSAGES_ACTION.APPROVE,
  'דחה': MESSAGES_ACTION.DECLINE, 'דחיה': MESSAGES_ACTION.DECLINE, 'דחייה': MESSAGES_ACTION.DECLINE, 'דחיית מעבר': MESSAGES_ACTION.DECLINE, 'decline': MESSAGES_ACTION.DECLINE,
  'טופל': MESSAGES_ACTION.HANDLED, 'טופלה': MESSAGES_ACTION.HANDLED, 'סגור': MESSAGES_ACTION.HANDLED, 'שנה': MESSAGES_ACTION.HANDLED, 'שנה מצב הודעה לטופל': MESSAGES_ACTION.HANDLED,
  'דלג': MESSAGES_ACTION.SKIP, 'skip': MESSAGES_ACTION.SKIP, '': MESSAGES_ACTION.SKIP,
};

const MESSAGES_POSTBACK_TARGETS = {
  [MESSAGES_ACTION.APPROVE]: 'ctl00$ContentPlaceHolder1$btnTransferApprove',
  [MESSAGES_ACTION.DECLINE]: 'ctl00$ContentPlaceHolder1$btnTransferDecline',
  [MESSAGES_ACTION.HANDLED]: 'ctl00$ContentPlaceHolder1$btnChangeMessageStatus',
};

const MESSAGES_IDS = {
  grid: 'ContentPlaceHolder1_GVMessages',
  pager: 'ContentPlaceHolder1_GPager_pager',
  hidRowId: 'ContentPlaceHolder1_HidMessageRowID',
};

// נושאי ההודעות מהאתר החי (30.10.2026). "בקשת מעבר תלמיד": מוסד אחר ביקש להעביר אליו תלמיד שלנו, ועלינו
// לאשר או לדחות. "מעבר תלמיד": אינפורמטיבי (מעבר ממוסדנו / אל מוסדנו אושר), רק לסמן כטופל.
const MESSAGES_TRANSFER_HEADER = 'בקשת מעבר תלמיד';
const MESSAGES_TRANSFER_DONE_HEADER = 'מעבר תלמיד';
const MESSAGES_STATUS_SENT = 'נשלחה';
const MESSAGES_STATUS_HANDLED = 'טופלה';
const MESSAGES_TSV_HEADER = ['UID', 'נושא', 'ת.ז./דרכון', 'תאריך', 'גוף ההודעה', 'פעולה'];
const MESSAGES_REPORT_HEADER = ['UID', 'ת.ז./דרכון', 'נושא', 'פעולה', 'סטטוס', 'גוף ההודעה'];
const MESSAGES_RESULT = { DONE: 'בוצע', SKIPPED: 'דילוג', FAILED_PREFIX: 'נכשל: ' };

const MESSAGES_URL_MARK = /Association\/Default\.aspx/i;
const MESSAGES_MAX_LOOPS = 5000;
const MESSAGES_MAX_EMPTY_PAGES = 30;
const MESSAGES_MAX_SCAN_PAGES = 300;

// ─── טהורות ─────────────────────────────────────────────────────────────────

function messagesIsMessagesUrl(url) {
  return typeof url === 'string' && MESSAGES_URL_MARK.test(url);
}

function messagesFlat(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

// זהה ל-makeUID של הישן: hash של כותרת+גוף, 'M' + base36.
function messagesMakeUid(header, body) {
  const s = (header || '') + '|' + (body || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return 'M' + (h >>> 0).toString(36);
}

// זהה ל-extractIdFromBody של הישן: "ת.ז. 012345678" → ת.ז.; "דרכון AB12345" → דרכון (אותיות גדולות);
// אחרת רצף של 8-9 ספרות; אין → ''.
function messagesExtractId(body) {
  const b = String(body == null ? '' : body);
  if (!b) return '';
  let m = b.match(/ת\.?\s*ז\.?\s*\.?\s*([0-9]{7,9})/);
  if (m) return m[1];
  m = b.match(/דרכון\s+([A-Za-z0-9]{5,12})/);
  if (m) return m[1].toUpperCase();
  m = b.match(/\b([0-9]{8,9})\b/);
  if (m) return m[1] || '';
  return '';
}

// כינוי → פעולה קנונית. לא מוכר / ריק → "דלג" (כמו בישן).
function messagesNormalizeAction(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return MESSAGES_ACTION_ALIASES[s.toLowerCase()] || MESSAGES_ACTION_ALIASES[s] || MESSAGES_ACTION.SKIP;
}

// הפעולה שהמצב הגורף מבצע: בקשת מעבר → אישור מעבר; כל השאר → סמן כטופל.
function messagesSuggestAction(header) {
  return messagesFlat(header) === MESSAGES_TRANSFER_HEADER ? MESSAGES_ACTION.APPROVE : MESSAGES_ACTION.HANDLED;
}

function messagesActionCountKey(action) {
  if (action === MESSAGES_ACTION.APPROVE) return 'approve';
  if (action === MESSAGES_ACTION.DECLINE) return 'decline';
  if (action === MESSAGES_ACTION.HANDLED) return 'handled';
  return 'skip';
}

// פרסור הטבלה המודבקת (שלב ב): טאבים (מאקסל) או פסיקים. שורת כותרת עם עמודות UID ו"פעולה" (בכל
// סדר), או בלי כותרת כשהעמודה הראשונה היא UID (M...) והפעולה בעמודה האחרונה. UID כפול: השורה
// האחרונה מנצחת (כמו Map בישן). מחזיר {ok, reason, entries:[{uid, action, line}], counts}.
function messagesParseTable(text) {
  const raw = String(text == null ? '' : text);
  const counts = { approve: 0, decline: 0, handled: 0, skip: 0 };
  const fail = (reason) => ({ ok: false, reason, entries: [], counts });
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return fail('תיבת הטקסט ריקה');
  const delim = raw.includes('\t') ? '\t' : ',';
  const split = (l) => l.split(delim).map((c) => c.trim());
  const head = split(lines[0]);
  let uidIdx = head.findIndex((h) => /uid|מזהה/i.test(h));
  let actionIdx = head.findIndex((h) => /פעולה|action/i.test(h));
  let first = 1;
  if (uidIdx === -1 && actionIdx === -1 && /^M[0-9a-z]+$/.test(head[0] || '')) {
    uidIdx = 0; actionIdx = -1; first = 0; // בלי כותרת: UID ראשון, פעולה אחרונה
  } else if (uidIdx === -1 || actionIdx === -1) {
    return fail('חסרה עמודת UID או "פעולה" בשורת הכותרת');
  }
  if (lines.length <= first) return fail('צריך כותרת + שורה אחת לפחות');
  const map = new Map();
  for (let i = first; i < lines.length; i++) {
    const cells = split(lines[i]);
    const uid = cells[uidIdx] || '';
    if (!uid) continue;
    const aIdx = actionIdx === -1 ? cells.length - 1 : actionIdx;
    const actionRaw = aIdx === uidIdx ? '' : (cells[aIdx] || '');
    map.set(uid, { uid, action: messagesNormalizeAction(actionRaw), line: i + 1 });
  }
  const entries = Array.from(map.values());
  for (const e of entries) counts[messagesActionCountKey(e.action)]++;
  if (!entries.length) return fail('לא נמצאו שורות עם UID');
  return { ok: true, reason: '', entries, counts };
}

function messagesLoadSummary(parsed) {
  const c = parsed.counts;
  return `נטענו ${parsed.entries.length}: אישור=${c.approve}, דחיה=${c.decline}, טופל=${c.handled}, דילוג=${c.skip}`;
}

function messagesTsvCell(v) {
  return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();
}

// טבלת ההודעות הסרוקות כ-TSV עם כותרת (להדבקה באקסל; העמודה האחרונה "פעולה" נערכת שם).
function messagesBuildTsv(list) {
  const lines = [MESSAGES_TSV_HEADER.join('\t')];
  for (const r of list || []) {
    lines.push([r.uid, r.header, r.personId, r.date, messagesFlat(r.body), r.suggestedAction || MESSAGES_ACTION.SKIP].map(messagesTsvCell).join('\t'));
  }
  return lines.join('\n');
}

// דוח הביצוע כ-TSV עם כותרת (העתק דוח).
function messagesBuildReportTsv(rows) {
  const lines = [MESSAGES_REPORT_HEADER.join('\t')];
  for (const r of rows || []) lines.push([r.uid, r.id, r.header, r.action, r.status, r.body].map(messagesTsvCell).join('\t'));
  return lines.join('\n');
}

// דוח "מה נשאר": סיכום + שורה אופרטיבית לכל הודעה שלא הצליחה / לא נמצאה, ושורה על עצירה.
function messagesBuildReport(rows, opts) {
  const o = opts || {};
  const counts = { done: 0, failed: 0, skipped: 0 };
  const lines = [];
  for (const r of rows || []) {
    if (r.status === MESSAGES_RESULT.DONE) counts.done++;
    else if (r.status === MESSAGES_RESULT.SKIPPED) counts.skipped++;
    else {
      counts.failed++;
      lines.push(`הודעה ${r.uid} "${r.header}"${r.id ? ` (${r.id})` : ''}: ${r.status}. טפל בה ידנית בדף ההודעות`);
    }
  }
  const notFound = Array.isArray(o.notFound) ? o.notFound : [];
  for (const nf of notFound) {
    lines.push(`UID ${nf.uid} (${nf.action}): לא נמצא בהודעות במצב "נשלחה". אולי כבר טופל; סרוק מחדש ובדוק`);
  }
  if (o.stopped) lines.push('הריצה נעצרה לבקשתך. הודעות שטרם טופלו נשארו במצב "נשלחה"; הפעל שוב כדי להמשיך');
  let summary = `בוצעו=${counts.done} · נכשלו=${counts.failed} · דולגו=${counts.skipped}`;
  if (notFound.length) summary += ` · לא נמצאו=${notFound.length}`;
  if (o.stopped) summary += ' · נעצר';
  return { summary, lines, counts, stopped: !!o.stopped, notFound: notFound.length };
}

// ─── סקירה בתוך החלונית: נרמול, מיזוג כפילויות, מצבת והצלבה ───────────────────

// ת.ז. לנרמול-השוואה: אקסל מוחק אפסים מובילים, ולכן מספרי מזהה מושווים בלי אפסים מובילים;
// דרכון באותיות גדולות; רווחים ומקפים נזרקים.
function messagesNormId(s) {
  const c = String(s == null ? '' : s).replace(/[\s-]/g, '');
  if (!c) return '';
  return /^\d+$/.test(c) ? (c.replace(/^0+/, '') || '0') : c.toUpperCase();
}

// סניף לנרמול: "5" / " 16 " / "סניף 16" → "05" / "16"; לא-מספרי → כמו שהוא; ריק → ''.
function messagesNormBranch(s) {
  const c = messagesFlat(s);
  const m = /(\d{1,3})/.exec(c);
  if (!m) return c;
  return m[1].padStart(2, '0');
}

// פרטי המעבר מגוף ההודעה, לפי הנוסחים מהאתר החי (30.10.2026):
// בקשת-מעבר: "...מסוג לימוד NNN בסניף NN. אנא אשר או דחה את המעבר." → {branch:'NN' (2 ספרות), studyType:'NNN',
//   direction:'out'}: הסניף וסוג-הלימוד הנוכחיים של התלמיד אצלנו (מוסד אחר מבקש לקחת אותו).
// "מעבר תלמיד" אינפורמטיבי: "...אל מוסדך אושר..." → direction 'in'; "...ממוסדך אושר..." → 'out-done'; בלי סניף.
// אחר → הכול ריק.
function messagesExtractTransfer(body) {
  const b = messagesFlat(body);
  const out = { branch: '', studyType: '', direction: '' };
  if (!b) return out;
  const m = /מסוג\s+לימוד\s*:?\s*(\d{1,5})\s+בסניף\s*:?\s*(\d{1,3})/.exec(b);
  if (m) return { branch: messagesNormBranch(m[2]), studyType: m[1], direction: 'out' };
  if (/אל\s+מוסדך/.test(b)) out.direction = 'in';
  else if (/ממוסדך/.test(b)) out.direction = 'out-done';
  return out;
}

function messagesNormBody(body) {
  return messagesFlat(body).toLowerCase();
}

// מיזוג כפילויות: אותו נושא + אותה ת.ז. (מנורמלת), או אותו נושא + אותו גוף מנורמל כשאין ת.ז.,
// מתמזגים לשורה אחת. items: [{uid, count}] (count = מופעים של אותו UID בגריד), uids, count כולל,
// date הראשון + dates, transfer מהגוף, suggestedAction כמו הראשון. הסדר לפי המופע הראשון.
function messagesMergeDuplicates(list) {
  const map = new Map();
  for (const r of list || []) {
    if (!r) continue;
    const header = messagesFlat(r.header);
    const id = messagesNormId(r.personId);
    const key = id ? `id|${header}|${id}` : `body|${header}|${messagesNormBody(r.body)}`;
    const count = Number(r.count) > 0 ? Number(r.count) : 1;
    const ex = map.get(key);
    if (ex) {
      ex.items.push({ uid: r.uid, count });
      ex.uids.push(r.uid);
      ex.count += count;
      if (r.date && !ex.dates.includes(r.date)) ex.dates.push(r.date);
      continue;
    }
    map.set(key, {
      key, uid: r.uid, uids: [r.uid], items: [{ uid: r.uid, count }], count,
      header, personId: r.personId || '', body: messagesFlat(r.body), date: r.date || '', dates: r.date ? [r.date] : [],
      transfer: messagesExtractTransfer(r.body),
      suggestedAction: r.suggestedAction || messagesSuggestAction(header),
      rosterLabel: '', rosterBranches: [], pending: false, probablyDone: false,
    });
  }
  return Array.from(map.values());
}

const messagesLooksLikeId = (c) => /^[A-Za-z]{0,3}\d{5,12}$/.test(String(c || '').replace(/[\s-]/g, ''));
const messagesLooksLikeBranch = (c) => /^(סניף\s*)?\d{1,3}$/.test(messagesFlat(c));

// פרסור המצבת המודבקת מאקסל: עמודות סניף ות.ז./דרכון, טאבים או פסיקים, עם כותרת (העמודות מזוהות
// לפי שמן) או בלי (סניף ראשון, ת.ז. שנייה; אם הסדר הפוך מזהים לפי הצורה). שורה בלי ת.ז. תקינה
// נספרת ב-ignored ומדלגים. מחזיר {ok, reason, byId: Map(ת.ז. מנורמלת → [סניפים]), count, ignored}.
function messagesParseRoster(text) {
  const raw = String(text == null ? '' : text);
  const byId = new Map();
  const fail = (reason) => ({ ok: false, reason, byId, count: 0, ignored: 0 });
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return fail('תיבת המצבת ריקה');
  const delim = raw.includes('\t') ? '\t' : ',';
  const split = (l) => l.split(delim).map((c) => c.trim());
  const head = split(lines[0]);
  let branchIdx = head.findIndex((h) => /סניף|branch/i.test(h));
  let idIdx = head.findIndex((h) => /ת\.?\s*ז|דרכון|מזהה|תעודה|זהות|\bid\b|passport/i.test(h));
  let first = 1;
  if (branchIdx === -1 && idIdx === -1) {
    if (head.some(messagesLooksLikeId)) { first = 0; } // אין כותרת
    branchIdx = -1; idIdx = -1;
  }
  let count = 0, ignored = 0;
  for (let i = first; i < lines.length; i++) {
    const cells = split(lines[i]);
    let idCell, branchCell;
    if (idIdx !== -1) {
      idCell = cells[idIdx];
      branchCell = branchIdx !== -1 ? cells[branchIdx] : '';
    } else {
      // בלי כותרת: סניף ראשון ות.ז. שנייה; אם הראשון נראה כת.ז. והשני כסניף, הפוך.
      const a = cells[0] || '', b = cells[1] || '';
      if (messagesLooksLikeId(a) && !messagesLooksLikeId(b)) { idCell = a; branchCell = b; } else { branchCell = a; idCell = b; }
      if (!messagesLooksLikeId(idCell)) {
        const alt = cells.find(messagesLooksLikeId);
        if (alt) { idCell = alt; branchCell = cells.find((c) => c !== alt && messagesLooksLikeBranch(c)) || branchCell; }
      }
    }
    const id = messagesNormId(idCell);
    if (!id || !messagesLooksLikeId(idCell)) { ignored++; continue; }
    const branch = messagesNormBranch(branchCell);
    const arr = byId.get(id) || [];
    if (!arr.includes(branch)) arr.push(branch);
    byId.set(id, arr);
    count++;
  }
  if (!count) return fail('לא נמצאו שורות עם ת.ז./דרכון במצבת');
  return { ok: true, reason: '', byId, count, ignored };
}

// הסניפים שבהם התלמיד נמצא במצבת (ריק = לא במצבת). roster: הפלט של messagesParseRoster.
function messagesRosterBranches(roster, personId) {
  if (!roster || !roster.byId) return [];
  return (roster.byId.get(messagesNormId(personId)) || []).slice();
}

// הצלבה מול המצבת: לכל שורה עם ת.ז. "סניף NN" / "לא במצבת"; בלי ת.ז. → ''. עובדות 30.10.2026: בבקשת-מעבר
// מוסד אחר מבקש תלמיד שלנו, ולכן: התלמיד במצבת (בכל סניף) → הבקשה עדיין רלוונטית, pending (תג "ממתין":
// לאשר או לדחות); אינו במצבת → כבר לא אצלנו, probablyDone (תג "כנראה בוצע"). שניהם רמז לבדיקה בלבד:
// ההצעה לא משתנה מעצמה (ממצא ב-10); הכפתור "כל 'כנראה בוצע': סמן כטופל" בלשונית מחיל. "מעבר תלמיד"
// האינפורמטיבי וכל נושא אחר: עמודת המצבת בלבד, בלי תג. roster=null → עמודה ריקה. מחזיר מערך חדש.
function messagesCrossCheck(rows, roster) {
  return (rows || []).map((r) => {
    const out = Object.assign({}, r, { rosterLabel: '', rosterBranches: [], pending: false, probablyDone: false, suggestedAction: messagesSuggestAction(r.header) });
    if (!roster || !roster.byId || !r.personId) return out;
    const branches = messagesRosterBranches(roster, r.personId);
    out.rosterBranches = branches;
    out.rosterLabel = branches.length ? branches.map((b) => `סניף ${b}`).join(', ') : 'לא במצבת';
    if (messagesFlat(r.header) === MESSAGES_TRANSFER_HEADER) {
      if (branches.length) out.pending = true;
      else out.probablyDone = true;
    }
    return out;
  });
}

// ההחלטה של שורה: מה שנבחר ב-decisions (Map key → פעולה), אחרת ההצעה.
function messagesRowDecision(row, decisions) {
  const d = decisions && decisions.get ? decisions.get(row.key) : undefined;
  return d || row.suggestedAction || MESSAGES_ACTION.SKIP;
}

function messagesDecisionCounts(rows, decisions) {
  const counts = { approve: 0, decline: 0, handled: 0, skip: 0 };
  for (const r of rows || []) counts[messagesActionCountKey(messagesRowDecision(r, decisions))]++;
  return counts;
}

// רשומות ל-messagesRunTable מטבלת הסקירה: ההחלטה של שורה ממוזגת חלה על כל ה-UID-ים שלה, עם count
// (מופעים של אותו UID בגריד) כדי שהביצוע יטפל בכל המופעים.
function messagesReviewEntries(rows, decisions) {
  const out = [];
  for (const r of rows || []) {
    const action = messagesRowDecision(r, decisions);
    for (const it of r.items || [{ uid: r.uid, count: 1 }]) out.push({ uid: it.uid, action, count: it.count });
  }
  return out;
}

function messagesRowMatchesFilter(row, text) {
  const q = messagesFlat(text).toLowerCase();
  if (!q) return true;
  const hay = [row.personId, row.header, row.body, row.rosterLabel].map((v) => messagesFlat(v).toLowerCase()).join(' ');
  return hay.includes(q);
}

function messagesShorten(text, max) {
  const s = messagesFlat(text);
  const n = Number(max) > 1 ? Number(max) : 60;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ─── מצב הריצה + hooks לפאנל ─────────────────────────────────────────────────

const MSG = {
  running: false,
  stop: false,
  mode: null, // 'bulk' | 'scan' | 'table'
  scanned: [],
  report: [],
  lastReport: null,
  hooks: {},
};

function messagesSetHooks(hooks) { MSG.hooks = hooks || {}; }
function messagesIsRunning() { return MSG.running; }
function messagesGetScanned() { return MSG.scanned.slice(); }
function messagesGetReportRows() { return MSG.report.slice(); }
function messagesRequestStop() {
  if (!MSG.running) return false;
  MSG.stop = true;
  log('⛔ [הודעות] בקשת עצירה; הריצה תיעצר אחרי הפעולה הנוכחית');
  return true;
}

function messagesHook(name, ...args) {
  try { if (MSG.hooks[name]) MSG.hooks[name](...args); } catch (e) { /* אצווה לא נתקעת */ }
}

function messagesBeginRun(mode) {
  MSG.running = true;
  MSG.stop = false;
  MSG.mode = mode;
  if (mode !== 'scan') MSG.report = [];
  messagesHook('onStart', mode);
}

function messagesFinishRun(opts) {
  const report = messagesBuildReport(MSG.report, opts);
  MSG.lastReport = report;
  MSG.running = false;
  messagesHook('onDone', MSG.report.slice(), report, MSG.mode);
  return report;
}

function messagesRecord(m, action, status) {
  const row = { uid: m.uid || '', id: m.personId || '', header: m.header || '', action: action || '', status, body: messagesFlat(m.body), date: m.date || '' };
  MSG.report.push(row);
  messagesHook('onResult', row, MSG.report.slice());
}

// ─── קריאת הגריד (getMessagesOnPage של הישן) ─────────────────────────────────

function messagesReadPage() {
  const grid = $el(MESSAGES_IDS.grid);
  if (!grid) return [];
  const out = [];
  for (const tr of Array.from(grid.querySelectorAll('tr'))) {
    const m = /selectedRowSearch\(\s*'?(\d+)'?\s*\)/.exec(tr.getAttribute('onclick') || '');
    if (!m) continue;
    const idx = m[1];
    const hdBody = $el(`${MESSAGES_IDS.grid}_hdID_${idx}`);
    const hdHeader = $el(`${MESSAGES_IDS.grid}_hidMessageHeader_${idx}`);
    const body = hdBody ? hdBody.value : '';
    const header = hdHeader ? hdHeader.value : '';
    const cell = (i) => (tr.cells && tr.cells[i] ? messagesFlat(tr.cells[i].innerText || tr.cells[i].textContent) : '');
    out.push({ rowIndex: idx, header, body, status: cell(3), date: cell(4), personId: messagesExtractId(body), uid: messagesMakeUid(header, body) });
  }
  return out;
}

const messagesIsSent = (m) => !m.status || m.status === MESSAGES_STATUS_SENT;

function messagesPageSignature(list) {
  return list.map((m) => m.uid + ':' + m.status).join('|');
}

// ─── פייג'ר (« ‹ › ») ───────────────────────────────────────────────────────

function messagesPagerLinks() {
  const links = { next: null, first: null, prev: null, last: null };
  const pager = $el(MESSAGES_IDS.pager);
  if (!pager) return links;
  for (const a of Array.from(pager.querySelectorAll('a'))) {
    const t = messagesFlat(a.innerText || a.textContent);
    if (t === '›') links.next = a;
    else if (t === '»') links.last = a;
    else if (t === '«') links.first = a;
    else if (t === '‹') links.prev = a;
  }
  return links;
}

function messagesCurrentPage() {
  const pager = $el(MESSAGES_IDS.pager);
  if (!pager) return 1;
  for (const s of Array.from(pager.querySelectorAll('span'))) {
    const t = messagesFlat(s.innerText || s.textContent);
    if (/^\d+$/.test(t)) return parseInt(t, 10);
  }
  return 1;
}

// לחיצה על קישור-פייג'ר: postback לפי ה-href (סדר קשיח), אחרת קליק עם המתנה. מחזיר true רק אם
// העמוד אכן השתנה (מספר או תוכן), כדי שלולאה לא תסתובב על פייג'ר שלא מתקדם.
async function messagesClickPager(a) {
  if (!a) return false;
  const before = messagesCurrentPage() + '#' + messagesPageSignature(messagesReadPage());
  const parsed = parsePostbackHref(a.getAttribute('href') || '');
  let res;
  if (parsed) {
    res = await firePostback(parsed.target, parsed.arg);
  } else {
    const wait = waitPRM();
    setTimeout(() => { try { a.click(); } catch (e) { /* אצווה לא נתקעת */ } }, 0);
    res = await wait;
  }
  if (!res.ok) { log(`[הודעות] דפדוף נכשל: ${res.reason || ''}`); return false; }
  const after = messagesCurrentPage() + '#' + messagesPageSignature(messagesReadPage());
  if (after === before) { log('[הודעות] הדפדוף לא שינה את העמוד'); return false; }
  return true;
}

async function messagesGotoFirstPage() {
  const { first, prev } = messagesPagerLinks();
  const target = first || prev;
  if (!target) return true;
  return messagesClickPager(target);
}

async function messagesGotoNextPage() {
  const { next } = messagesPagerLinks();
  if (!next) return false;
  return messagesClickPager(next);
}

// ─── סינון "נשלחה" ──────────────────────────────────────────────────────────

// ממצא ב-11: מעדיפים את ה-select שה-id שלו מכיל ddlMessageStatus (כמו באתר ובסקריפט הישן), ורק
// אחרת את הראשון שהאופציות שלו כוללות "נשלחה" ו"טופלה". מספר המועמדים נרשם ליומן.
function messagesFindFilterSelect() {
  if (typeof document === 'undefined') return null;
  const all = Array.from(document.querySelectorAll('select'));
  const byId = all.filter((s) => /ddlMessageStatus/i.test(String(s.id || '')));
  const byOptions = all.filter((s) => {
    const texts = Array.from(s.options || []).map((o) => messagesFlat(o.text));
    return texts.includes(MESSAGES_STATUS_SENT) && texts.includes(MESSAGES_STATUS_HANDLED);
  });
  log(`[הודעות] תיבות-סינון מועמדות: ${byId.length} לפי מזהה ddlMessageStatus, ${byOptions.length} לפי אופציות (נשלחה/טופלה)`);
  return byId[0] || byOptions[0] || null;
}

async function messagesEnsureSentFilter() {
  const s = messagesFindFilterSelect();
  if (!s) { log('[הודעות] לא נמצאה תיבת-סינון מצב (נשלחה/טופלה); ממשיכים עם הסינון הנוכחי'); return { ok: true, found: false }; }
  const opt = Array.from(s.options).find((o) => messagesFlat(o.text) === MESSAGES_STATUS_SENT);
  const want = opt ? opt.value : '1';
  if (s.value === want) return { ok: true, found: true, changed: false };
  log('[הודעות] משנה סינון ל"נשלחה"');
  const wait = waitPRM(); // (1) נרשם קודם
  setTimeout(() => { // (2) נדחה
    try { s.value = want; s.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* אצווה לא נתקעת */ }
  }, 0);
  const res = await wait;
  if (!res.ok) log(`[הודעות] שינוי הסינון נכשל: ${res.reason || ''}`);
  return { ok: res.ok !== false, found: true, changed: true };
}

// ─── חלונית ההודעה והפעולה עצמה ──────────────────────────────────────────

// קורא את החלונית (אם גלויה), רושם ביומן (ממוסך) וסוגר בלי "המשך". מחזיר את מה שנקרא או null.
async function messagesClosePopupIfOpen(where) {
  const popup = readMessagePopup();
  if (!popup) return null;
  log(`[הודעות] חלונית ${where} (${popup.kind}): "${maskIdsInText(popup.text)}" [${popup.buttons.join(', ')}]`);
  if (popup.kind === 'confirm') log('[הודעות] שים לב: האתר ביקש אישור ("המשך"). לא נלחץ אוטומטית; החלונית נסגרת והתוצאה נבדקת מול הגריד');
  const { hidden, wait } = hideMessagePopupAsync();
  if (wait) await wait;
  if (!hidden) log('[הודעות] לא הצלחתי לסגור את החלונית');
  return popup;
}

// טהורה (ממצא ב-4): הכרעת תוצאת הפעולה. אותו עמוד: מספר המופעים של ההודעה במצב "נשלחה" צריך
// לרדת. העמוד השתנה (האתר חזר לעמוד אחר אחרי הפעולה): הגריד המוצג אינו ראיה; הצלחה רק עם
// חלונית-הצלחה, אחרת "נכשל: הגריד חזר לעמוד אחר אחרי הפעולה" (עם הודעת האתר אם הייתה).
function messagesActionOutcome({ before, after, pageBefore, pageAfter, popup }) {
  const siteSaid = popup && popup.kind !== 'success' && popup.text ? `האתר הודיע: "${messagesFlat(popup.text)}"` : '';
  if (pageBefore !== pageAfter) {
    if (popup && popup.kind === 'success') return { ok: true, pageChanged: true };
    return { ok: false, reason: ['הגריד חזר לעמוד אחר אחרי הפעולה', siteSaid].filter(Boolean).join('; ') };
  }
  if (before > 0 && after >= before) return { ok: false, reason: siteSaid || 'ההודעה עדיין במצב "נשלחה" אחרי הפעולה' };
  return { ok: true };
}

// פעולה אחת (performActionFast של הישן): סגירת חלונית ישנה → HidMessageRowID → postback → סגירת
// חלונית ההצלחה → אימות מול הגריד (messagesActionOutcome).
async function messagesPerformAction(msg, action) {
  const target = MESSAGES_POSTBACK_TARGETS[action];
  if (!target) return { ok: false, reason: 'פעולה לא מוכרת: ' + action };
  await messagesClosePopupIfOpen('לפני הפעולה');
  const hid = $el(MESSAGES_IDS.hidRowId);
  if (!hid) return { ok: false, reason: 'לא נמצא השדה הנסתר של שורת ההודעה (HidMessageRowID)' };
  const countSent = () => messagesReadPage().filter((m) => m.uid === msg.uid && messagesIsSent(m)).length;
  const before = countSent();
  const pageBefore = messagesCurrentPage();
  hid.value = String(msg.rowIndex);
  const res = await firePostback(target, '');
  if (!res.ok) return { ok: false, reason: res.reason || 'הפעולה נכשלה בשרת' };
  if (res.started === false) return { ok: false, reason: 'הלחיצה לא הפעילה בקשה לשרת' };
  const popup = await messagesClosePopupIfOpen('אחרי הפעולה');
  const pageAfter = messagesCurrentPage();
  if (pageAfter !== pageBefore) log(`[הודעות] הגריד עבר מעמוד ${pageBefore} לעמוד ${pageAfter} אחרי הפעולה`);
  return messagesActionOutcome({ before, after: countSent(), pageBefore, pageAfter, popup });
}

// ממצא ב-4: הודעה שקיבלה פעולה שלא ניתן היה לאמת מול הגריד (העמוד השתנה) ועדיין "נשלחה" בסבב הבא:
// לא מבצעים שוב (גם במצב הגורף). מחזיר רשומת-כישלון לדוח.
const MESSAGES_REPEAT_REASON = 'ההודעה עדיין במצב "נשלחה" אחרי פעולה שדווחה כהצלחה; לא מבצעים שוב';

// ─── מצב גורף ───────────────────────────────────────────────────────────────

async function messagesRunBulk() {
  if (MSG.running) return null;
  messagesBeginRun('bulk');
  const t0 = Date.now();
  log('[הודעות] ▶ מצב גורף: בקשת מעבר → אישור מעבר; אחרת → סמן כטופל');
  await messagesEnsureSentFilter();
  await messagesGotoFirstPage();
  const failed = new Set();
  const attempted = new Set(); // ממצא ב-4: UID-ים שקיבלו פעולה בלי אימות מול הגריד (העמוד השתנה)
  let processed = 0, skipped = 0, consecutiveEmpty = 0;
  for (let loops = 0; loops < MESSAGES_MAX_LOOPS && !MSG.stop; loops++) {
    await messagesClosePopupIfOpen('בין פעולות');
    const list = messagesReadPage();
    if (!list.length) { log('[הודעות] אין הודעות בעמוד'); break; }
    const repeat = list.find((m) => messagesIsSent(m) && !failed.has(m.uid) && attempted.has(m.uid));
    if (repeat) {
      skipped++;
      failed.add(repeat.uid);
      messagesRecord(repeat, messagesSuggestAction(repeat.header), MESSAGES_RESULT.FAILED_PREFIX + MESSAGES_REPEAT_REASON);
      log(`[הודעות] ✗ ${MESSAGES_REPEAT_REASON} · ${repeat.header} · ${maskId(repeat.personId) || '-'}`);
      continue;
    }
    const target = list.find((m) => messagesIsSent(m) && !failed.has(m.uid));
    if (!target) {
      consecutiveEmpty++;
      if (consecutiveEmpty > MESSAGES_MAX_EMPTY_PAGES) { log('[הודעות] עצירת בטיחות: יותר מדי עמודים בלי הודעה לטיפול'); break; }
      const moved = await messagesGotoNextPage();
      if (!moved) break;
      continue;
    }
    consecutiveEmpty = 0;
    const action = messagesSuggestAction(target.header);
    messagesHook('onStatus', `טופלו ${processed}${skipped ? ` (נכשלו ${skipped})` : ''} · מטפל: ${action} · ${target.header}`);
    const t1 = Date.now();
    const res = await messagesPerformAction(target, action);
    if (res.ok && res.pageChanged) attempted.add(target.uid);
    if (res.ok) {
      processed++;
      messagesRecord(target, action, MESSAGES_RESULT.DONE);
      log(`[הודעות] ✓ ${Date.now() - t1}ms · ${action} · ${maskId(target.personId) || '-'} · ${target.header}`);
    } else {
      skipped++;
      failed.add(target.uid);
      messagesRecord(target, action, MESSAGES_RESULT.FAILED_PREFIX + res.reason);
      log(`[הודעות] ✗ ${res.reason} · ${target.header} · ${maskId(target.personId) || '-'}`);
    }
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[הודעות] מצב גורף הסתיים${MSG.stop ? ' (נעצר)' : ''}: בוצעו ${processed}, נכשלו ${skipped} (${dt} שניות)`);
  return messagesFinishRun({ stopped: MSG.stop });
}

// ─── סריקה (שלב א) ──────────────────────────────────────────────────────────

async function messagesScan() {
  if (MSG.running) return null;
  messagesBeginRun('scan');
  MSG.scanned = [];
  const t0 = Date.now();
  log('[הודעות] סריקה: מתחיל');
  await messagesEnsureSentFilter();
  await messagesGotoFirstPage();
  // אותה הודעה (אותו UID = אותה כותרת + אותו גוף) יכולה להופיע כמה פעמים בגריד; נספרת ב-count של
  // השורה הסרוקה, כדי שהביצוע יטפל בכל המופעים. בין עמודים אין קריאה כפולה: הפייג'ר מאומת שהתקדם.
  const seen = new Map();
  let pages = 0, total = 0;
  for (let i = 0; i < MESSAGES_MAX_SCAN_PAGES && !MSG.stop; i++) {
    pages++;
    const list = messagesReadPage();
    log(`[הודעות] עמוד ${messagesCurrentPage()}: ${list.length} הודעות`);
    for (const m of list) {
      if (!messagesIsSent(m)) continue;
      total++;
      const ex = seen.get(m.uid);
      if (ex) { ex.count++; continue; }
      const row = { uid: m.uid, header: m.header, personId: m.personId, body: m.body, date: m.date, status: m.status, count: 1, suggestedAction: messagesSuggestAction(m.header) };
      seen.set(m.uid, row);
      MSG.scanned.push(row);
    }
    messagesHook('onStatus', `סריקה: ${pages} עמודים, ${total} הודעות`);
    messagesHook('onScanProgress', MSG.scanned.slice(), pages, total);
    const moved = await messagesGotoNextPage();
    if (!moved) break;
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[הודעות] סריקה הסתיימה${MSG.stop ? ' (נעצר)' : ''}: ${total} הודעות (${MSG.scanned.length} שונות) מ-${pages} עמודים (${dt} שניות)`);
  MSG.running = false;
  const info = { pages, total, stopped: MSG.stop };
  messagesHook('onScanDone', MSG.scanned.slice(), info);
  return MSG.scanned.slice();
}

// ─── ביצוע לפי טבלה (שלב ב) ──────────────────────────────────────────────────

// entries: [{uid, action, count?}]. count = כמה מופעים של ה-UID לטפל (מהסריקה); בלי count (מסלול
// האקסל) מטפלים בכל מופע שנמצא במצב "נשלחה". כישלון על UID עוצר את הטיפול בו (לא מנסים שוב).
async function messagesRunTable(entries) {
  if (MSG.running) return null;
  const pending = new Map();
  for (const e of entries || []) {
    if (!e || !e.uid) continue;
    const left = Number(e.count) > 0 ? Number(e.count) : Infinity;
    pending.set(e.uid, { action: e.action, left });
  }
  if (!pending.size) { log('[הודעות] אין טבלה טעונה'); return null; }
  messagesBeginRun('table');
  const t0 = Date.now();
  let toDo = 0;
  for (const p of pending.values()) if (p.action !== MESSAGES_ACTION.SKIP) toDo += Number.isFinite(p.left) ? p.left : 1;
  log(`[הודעות] ▶ ביצוע לפי טבלה: ${toDo} פעולות מתוך ${pending.size} שורות`);
  await messagesEnsureSentFilter();
  await messagesGotoFirstPage();
  const handled = new Set(); // UID-ים שנרשמו בדוח לפחות פעם אחת
  const attempted = new Set(); // ממצא ב-4: UID-ים שקיבלו פעולה בלי אימות מול הגריד (העמוד השתנה)
  let processed = 0, failedCount = 0, consecutiveEmpty = 0;
  for (let loops = 0; loops < MESSAGES_MAX_LOOPS && !MSG.stop; loops++) {
    await messagesClosePopupIfOpen('בין פעולות');
    const list = messagesReadPage();
    if (!list.length) break;
    let target = null, targetAction = null;
    for (const m of list) {
      const p = pending.get(m.uid);
      if (!p || p.left <= 0) continue;
      if (p.action === MESSAGES_ACTION.SKIP) {
        p.left = 0;
        handled.add(m.uid);
        messagesRecord(m, MESSAGES_ACTION.SKIP, MESSAGES_RESULT.SKIPPED);
        continue;
      }
      if (!messagesIsSent(m)) continue;
      if (attempted.has(m.uid)) {
        p.left = 0;
        failedCount++;
        messagesRecord(m, p.action, MESSAGES_RESULT.FAILED_PREFIX + MESSAGES_REPEAT_REASON);
        log(`[הודעות] ✗ ${MESSAGES_REPEAT_REASON} · ${m.header} · ${maskId(m.personId) || '-'}`);
        continue;
      }
      target = m;
      targetAction = p.action;
      break;
    }
    if (!target) {
      consecutiveEmpty++;
      if (consecutiveEmpty > MESSAGES_MAX_EMPTY_PAGES) { log('[הודעות] עצירת בטיחות: יותר מדי עמודים בלי הודעה מהטבלה'); break; }
      const moved = await messagesGotoNextPage();
      if (!moved) break;
      continue;
    }
    consecutiveEmpty = 0;
    messagesHook('onStatus', `מבצע ${processed + failedCount + 1}/${toDo}: ${targetAction} · ${target.header}`);
    messagesHook('onProgress', processed + failedCount, toDo);
    const t1 = Date.now();
    const res = await messagesPerformAction(target, targetAction);
    handled.add(target.uid);
    if (res.ok && res.pageChanged) attempted.add(target.uid);
    const p = pending.get(target.uid);
    if (res.ok) {
      processed++;
      p.left--;
      messagesRecord(target, targetAction, MESSAGES_RESULT.DONE);
      log(`[הודעות] ✓ ${Date.now() - t1}ms · ${targetAction} · ${maskId(target.personId) || '-'}`);
    } else {
      failedCount++;
      p.left = 0;
      messagesRecord(target, targetAction, MESSAGES_RESULT.FAILED_PREFIX + res.reason);
      log(`[הודעות] ✗ ${res.reason} · ${target.header} · ${maskId(target.personId) || '-'}`);
    }
    messagesHook('onProgress', processed + failedCount, toDo);
  }
  const notFound = [];
  for (const [uid, p] of pending.entries()) if (p.action !== MESSAGES_ACTION.SKIP && !handled.has(uid)) notFound.push({ uid, action: p.action });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[הודעות] ביצוע לפי טבלה הסתיים${MSG.stop ? ' (נעצר)' : ''}: בוצעו ${processed}, נכשלו ${failedCount}, לא נמצאו ${notFound.length} (${dt} שניות)`);
  return messagesFinishRun({ stopped: MSG.stop, notFound: MSG.stop ? [] : notFound });
}

// ─── הורדת אקסל (XLSX אם הספרייה נטענה, אחרת TSV) ───────────────────────────

function messagesDownloadXlsx(list) {
  if (!list || !list.length) return { ok: false, reason: 'אין נתונים' };
  const rows = [MESSAGES_TSV_HEADER.slice()];
  for (const r of list) rows.push([r.uid, r.header || '', r.personId || '', r.date || '', messagesFlat(r.body), r.suggestedAction || MESSAGES_ACTION.SKIP]);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const XLSX = globalThis.XLSX;
  if (XLSX && XLSX.utils && typeof XLSX.writeFile === 'function') {
    try {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 70 }, { wch: 22 }];
      ws['!views'] = [{ RTL: true }];
      ws['!dataValidation'] = [{
        sqref: `F2:F${rows.length}`, type: 'list', formula1: `"${MESSAGES_ALL_ACTIONS.join(',')}"`,
        allowBlank: true, showErrorMessage: true, errorTitle: 'ערך לא חוקי', error: `מותר: ${MESSAGES_ALL_ACTIONS.join(', ')}`,
      }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'הודעות');
      const help = XLSX.utils.aoa_to_sheet([['פעולות אפשריות:'], ...MESSAGES_ALL_ACTIONS.map((a) => [a]), [], ['אל תשנה את עמודת UID']]);
      help['!views'] = [{ RTL: true }];
      help['!cols'] = [{ wch: 60 }];
      XLSX.utils.book_append_sheet(wb, help, 'עזרה');
      XLSX.writeFile(wb, `הודעות_${stamp}.xlsx`);
      log(`[הודעות] הורד אקסל: ${list.length} שורות`);
      return { ok: true, format: 'xlsx' };
    } catch (e) {
      log(`[הודעות] יצירת אקסל נכשלה (${e && e.message}); מוריד TSV במקום`);
    }
  }
  const ok = downloadText(`הודעות_${stamp}.tsv`, '\uFEFF' + messagesBuildTsv(list), 'text/tab-separated-values;charset=utf-8');
  if (ok) log(`[הודעות] הורד TSV: ${list.length} שורות`);
  return { ok, format: 'tsv' };
}

// ─── src/tools/messages-ui.js ───
// לשונית "הודעות" בחלונית המאוחדת. הזרימה ב-messages.js; כאן רק הממשק. שני מצבים:
// "סקירה" (ברירת-המחדל): סרוק → טבלת-סקירה בתוך החלונית (כפילויות ממוזגות, החלטה לכל שורה, הצלבה
// מול מצבת מודבקת, פעולות-צובר, סינון) → "בצע לפי הטבלה". מסלול האקסל (העתק/הורד/הדבק/טען/בצע)
// נשאר כאופציה מתקפלת. "מצב גורף": כמו קודם. טבלת-תוצאות, דוח "מה נשאר", "העתק דוח".
// הלשונית מופיעה בדפי 'other' (getPage לא מכיר את דף ההודעות); ב-mount בודקים את הכתובת.
// אין גישה ל-document ברמת המודול.


const MP = 'tt-messages';
let msgUi = null;
let msgMode = 'table';
let msgPending = []; // מסלול האקסל: הרשומות שנטענו מהטקסט המודבק
let msgResults = [];
let msgRows = []; // טבלת הסקירה: שורות ממוזגות (אחרי הצלבה)
let msgDecisions = new Map(); // key של שורה → פעולה שנבחרה (ריק = ההצעה)
let msgRoster = null; // המצבת המודבקת (messagesParseRoster) או null

const MESSAGES_BODY_MAX = 70;

const MESSAGES_RESULT_COLUMNS = [
  { key: 'uid', label: 'UID', mono: true, width: '84px' },
  { key: 'header', label: 'נושא' },
  { key: 'id', label: 'ת.ז./דרכון', mono: true },
  { key: 'action', label: 'פעולה' },
  { key: 'status', label: 'סטטוס' },
];

function messagesClassify(r) {
  if (r.status === MESSAGES_RESULT.DONE) return 'ok';
  if (r.status === MESSAGES_RESULT.SKIPPED) return 'warn';
  return 'bad';
}

// ─── טבלת הסקירה ────────────────────────────────────────────────────────────

function messagesFilterText() {
  const el = $el(`${MP}-filter`);
  return el ? el.value : '';
}

function messagesVisibleRows() {
  const q = messagesFilterText();
  return msgRows.filter((r) => messagesRowMatchesFilter(r, q));
}

function messagesRenderSummary() {
  const el = $el(`${MP}-summary`);
  if (!el) return;
  if (!msgRows.length) { el.textContent = ''; return; }
  const c = messagesDecisionCounts(msgRows, msgDecisions);
  const visible = messagesVisibleRows().length;
  const pending = msgRows.filter((r) => r.pending).length;
  const done = msgRows.filter((r) => r.probablyDone).length;
  el.textContent = `${msgRows.length} שורות${visible !== msgRows.length ? ` (${visible} מוצגות)` : ''} · אישור מעבר=${c.approve} · דחיית מעבר=${c.decline} · טופל=${c.handled} · דלג=${c.skip}${pending ? ` · ממתין=${pending}` : ''}${done ? ` · כנראה בוצע=${done}` : ''}`;
}

// תגי המצבת לבקשת-מעבר: "ממתין" (התלמיד עדיין במצבת: לאשר או לדחות) / "כנראה בוצע" (אינו במצבת).
function messagesRosterTagHtml(r) {
  if (r.pending) return ' <span class="tt-tag tt-tag-count tt-tag-pending" title="התלמיד עדיין במצבת: הבקשה ממתינה לאישור או לדחייה">ממתין</span>';
  if (r.probablyDone) return ' <span class="tt-tag tt-tag-done" title="התלמיד אינו במצבת: כנראה המעבר כבר בוצע">כנראה בוצע</span>';
  return '';
}

function messagesRowHtml(r, i) {
  const decision = messagesRowDecision(r, msgDecisions);
  const dates = r.dates && r.dates.length > 1 ? r.dates.join(', ') : '';
  const roster = r.rosterLabel ? `${esc(r.rosterLabel)}${messagesRosterTagHtml(r)}` : '';
  const uidsTitle = `UID: ${r.uids.join(', ')}`;
  return `<tr class="tt-review-row${r.probablyDone ? ' tt-r-done' : ''}" data-key="${esc(r.key)}" data-uid="${esc(r.uid)}" data-uids="${esc(r.uids.join(','))}" title="${esc(uidsTitle)}">
    <td class="tt-mono">${esc(r.personId)}</td>
    <td>${esc(r.header)}</td>
    <td class="tt-body-cell" title="${esc(r.body)}">${esc(messagesShorten(r.body, MESSAGES_BODY_MAX))}</td>
    <td class="tt-center"${dates ? ` title="${esc(dates)}"` : ''}>${esc(r.date)}${dates ? ` <span class="tt-muted">+${r.dates.length - 1}</span>` : ''}</td>
    <td class="tt-center tt-count-cell">${r.count > 1 ? `<span class="tt-tag tt-tag-count" title="${esc(`${r.count} הודעות מוזגו לשורה הזו`)}">${r.count}</span>` : '1'}</td>
    <td class="tt-roster-cell">${roster}</td>
    <td>${selectHtml({ id: `${MP}-decision-${i}`, options: MESSAGES_ALL_ACTIONS, value: decision, cls: 'tt-decision' })}</td>
  </tr>`;
}

function messagesRenderReview() {
  const box = $el(`${MP}-scanned`);
  if (!box) return;
  if (!msgRows.length) { box.innerHTML = ''; messagesRenderSummary(); messagesSetReviewEnabled(); return; }
  const head = ['ת.ז./דרכון', 'נושא', 'גוף ההודעה', 'תאריך', 'כמות', 'במצבת', 'החלטה'].map((h) => `<th>${esc(h)}</th>`).join('');
  box.innerHTML = `<table class="tt-table tt-review-table"><thead><tr>${head}</tr></thead><tbody>${msgRows.map(messagesRowHtml).join('')}</tbody></table>`;
  box.querySelectorAll('select.tt-decision').forEach((sel) => {
    sel.addEventListener('change', () => {
      const tr = sel.closest('tr');
      if (!tr) return;
      msgDecisions.set(tr.getAttribute('data-key'), sel.value);
      messagesRenderSummary();
    });
  });
  messagesApplyFilter();
  messagesSetReviewEnabled();
}

function messagesApplyFilter() {
  const box = $el(`${MP}-scanned`);
  if (!box) return;
  const byKey = new Map(msgRows.map((r) => [r.key, r]));
  const q = messagesFilterText();
  box.querySelectorAll('tr.tt-review-row').forEach((tr) => {
    const r = byKey.get(tr.getAttribute('data-key'));
    tr.hidden = !(r && messagesRowMatchesFilter(r, q));
  });
  messagesRenderSummary();
}

function messagesSetReviewEnabled() {
  const on = msgRows.length > 0 && !messagesIsRunning();
  for (const id of ['run-review', 'all-transfers', 'all-others', 'all-done', 'all-skip']) setDisabled(`${MP}-${id}`, !on);
}

// פעולת-צובר על השורות המוצגות (אחרי הסינון). pick(row) → פעולה או null (לא לגעת).
function messagesBulkDecide(pick, what) {
  if (!msgRows.length) { msgUi.status('אין טבלה. לחץ "סרוק" קודם'); return; }
  let n = 0;
  for (const r of messagesVisibleRows()) {
    const a = pick(r);
    if (!a) continue;
    msgDecisions.set(r.key, a);
    n++;
  }
  messagesRenderReview();
  msgUi.status(`${what}: עודכנו ${n} שורות`);
}

// בונה את שורות הסקירה מהסריקה האחרונה + המצבת, ושומר החלטות שכבר נבחרו (לפי key).
function messagesRebuildRows() {
  const merged = messagesMergeDuplicates(messagesGetScanned());
  msgRows = messagesCrossCheck(merged, msgRoster);
  // ממצא ב-10: "כנראה בוצע" הוא רמז לבדיקה; ההחלטה שנבחרה נשמרת, ורק הכפתור "כל 'כנראה בוצע': סמן כטופל" מחיל
  const keep = new Map();
  for (const r of msgRows) if (msgDecisions.has(r.key)) keep.set(r.key, msgDecisions.get(r.key));
  msgDecisions = keep;
  messagesRenderReview();
}

const MESSAGES_DONE_HINT = (n) => `${n} בקשות-מעבר על תלמידים שאינם במצבת מסומנות "כנראה בוצע" (רמז לבדיקה; "כל 'כנראה בוצע': סמן כטופל" מחיל)`;

function messagesLoadRoster() {
  const text = (($el(`${MP}-roster-input`) || {}).value || '');
  const parsed = messagesParseRoster(text);
  if (!parsed.ok) {
    msgRoster = null;
    setText(`${MP}-roster-status`, `✗ ${parsed.reason}`);
    msgUi.status(parsed.reason);
    log(`[הודעות] טעינת מצבת: ${parsed.reason}`);
    messagesRebuildRows();
    return;
  }
  msgRoster = parsed;
  const txt = `✓ נטענה מצבת: ${parsed.count} שורות${parsed.ignored ? ` (${parsed.ignored} שורות בלי ת.ז. דולגו)` : ''}`;
  setText(`${MP}-roster-status`, txt);
  log(`[הודעות] ${txt}`);
  messagesRebuildRows();
  const done = msgRows.filter((r) => r.probablyDone).length;
  const pending = msgRows.filter((r) => r.pending).length;
  msgUi.status(msgRows.length ? `${txt}. ${done ? MESSAGES_DONE_HINT(done) : 'אין בקשות-מעבר על תלמידים שאינם במצבת'}${pending ? `; ${pending} ממתינות לאישור או לדחייה` : ''}` : `${txt}. לחץ "סרוק" כדי להצליב`);
}

function messagesClearRoster() {
  msgRoster = null;
  const ta = $el(`${MP}-roster-input`);
  if (ta) ta.value = '';
  setText(`${MP}-roster-status`, 'אין מצבת טעונה.');
  messagesRebuildRows();
  msgUi.status('המצבת נוקתה');
}

function messagesRunReview() {
  const entries = messagesReviewEntries(msgRows, msgDecisions);
  if (!entries.length) { msgUi.status('אין טבלה. לחץ "סרוק" קודם'); return; }
  const c = messagesDecisionCounts(msgRows, msgDecisions);
  log(`[הודעות] בצע לפי הטבלה: ${msgRows.length} שורות (${entries.length} הודעות): אישור=${c.approve}, דחיה=${c.decline}, טופל=${c.handled}, דילוג=${c.skip}`);
  messagesGuardRun(() => messagesRunTable(entries), 'הביצוע לפי הטבלה');
}

// ─── שאר הממשק ──────────────────────────────────────────────────────────────

function messagesRenderResults() {
  const rows = msgResults.map((r) => Object.assign({}, r, { detail: r.body }));
  setHtml(`${MP}-results`, resultsTableHtml({ columns: MESSAGES_RESULT_COLUMNS, rows, classify: messagesClassify }));
}

function messagesRenderReport(report) {
  if (!report) { show(`${MP}-report`, false); setHtml(`${MP}-report`, ''); return; }
  setHtml(`${MP}-report`, reportBoxHtml(report));
  show(`${MP}-report`, true);
}

function messagesSetRunning(on) {
  for (const id of ['bulk-run', 'scan', 'load', 'run-table', 'roster-load']) setDisabled(`${MP}-${id}`, !!on);
  if (!on) setDisabled(`${MP}-run-table`, !msgPending.length);
  messagesSetReviewEnabled();
  msgUi.running(!!on);
}

function messagesSetMode(mode) {
  msgMode = mode === 'bulk' ? 'bulk' : 'table';
  show(`${MP}-bulk`, msgMode === 'bulk');
  show(`${MP}-table`, msgMode === 'table');
  for (const m of ['bulk', 'table']) {
    const b = $el(`${MP}-mode-${m}`);
    if (!b) continue;
    b.classList.toggle('tt-btn-primary', m === msgMode);
    b.classList.toggle('tt-btn-ghost', m !== msgMode);
  }
}

function messagesGuardRun(fn, what) {
  if (messagesIsRunning()) { msgUi.status('יש ריצה פעילה. עצור אותה קודם'); return; }
  Promise.resolve().then(fn).catch((e) => {
    log(`[הודעות] ${what} נכשל: ${e && e.message}`);
    messagesSetRunning(false);
    msgUi.status(`${what} נכשל. בדוק את היומן ונסה שוב`);
  });
}

function messagesStop() {
  if (!messagesIsRunning()) return;
  msgUi.status('עוצר… (אחרי הפעולה הנוכחית)');
  messagesRequestStop();
}

function messagesLoadTable() {
  const text = (($el(`${MP}-input`) || {}).value || '');
  const parsed = messagesParseTable(text);
  if (!parsed.ok) {
    msgPending = [];
    setText(`${MP}-load-status`, `✗ ${parsed.reason}`);
    setDisabled(`${MP}-run-table`, true);
    msgUi.status(parsed.reason);
    log(`[הודעות] טעינת טבלה: ${parsed.reason}`);
    return;
  }
  msgPending = parsed.entries;
  const summary = messagesLoadSummary(parsed);
  setText(`${MP}-load-status`, `✓ ${summary}`);
  setDisabled(`${MP}-run-table`, false);
  msgUi.status(`${summary}. לחץ "בצע"`);
  log(`[הודעות] ${summary}`);
}

function messagesCopyTsv() {
  const list = messagesGetScanned();
  if (!list.length) { msgUi.status('אין הודעות סרוקות להעתקה. לחץ "סרוק" קודם'); return; }
  copyTextToClipboard(messagesBuildTsv(list)).then((ok) => {
    flash(`${MP}-copy-tsv`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק לאקסל');
    msgUi.status(ok ? `הועתקו ${list.length} הודעות. הדבק באקסל (Ctrl+V), ערוך את עמודת "פעולה" והדבק חזרה` : 'ההעתקה נחסמה בדפדפן. השתמש ב"הורד אקסל"');
  });
}

function messagesDownload() {
  const list = messagesGetScanned();
  if (!list.length) { msgUi.status('אין הודעות סרוקות להורדה. לחץ "סרוק" קודם'); return; }
  const res = messagesDownloadXlsx(list);
  msgUi.status(res.ok ? `הורד קובץ ${res.format === 'xlsx' ? 'אקסל' : 'TSV'} עם ${list.length} הודעות` : `ההורדה נכשלה: ${res.reason || ''}`);
}

function messagesCopyReport() {
  const rows = messagesGetReportRows();
  if (!rows.length) { msgUi.status('אין דוח להעתקה'); return; }
  const text = messagesBuildReportTsv(rows);
  copyTextToClipboard(text).then((ok) => {
    flash(`${MP}-copy-report`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק דוח');
    if (ok) { msgUi.status(`הועתקו ${rows.length} שורות דוח`); return; }
    const ta = $el(`${MP}-input`);
    if (ta) ta.value = text;
    const det = $el(`${MP}-excel`);
    if (det) det.open = true;
    messagesSetMode('table');
    msgUi.status('ההעתקה נחסמה בדפדפן. הדוח הוצג בתיבת הטקסט (אזור האקסל) להעתקה ידנית');
  });
}

function messagesMount(container, panelUi, page) {
  msgUi = panelUi;
  const url = (page && page.url) || (typeof location !== 'undefined' ? location.href : '');
  if (!messagesIsMessagesUrl(url)) {
    container.innerHTML = '<div class="tt-box tt-box-info">הכלי עובד בדף ההודעות בלבד.</div>';
    return;
  }
  const panel = $el('tt-panel');
  if (panel) panel.classList.add('tt-panel-wide'); // טבלת הסקירה רחבה; בדף ההודעות זו הלשונית היחידה
  container.innerHTML = `
    <div class="tt-row">
      ${buttonHtml({ id: `${MP}-mode-table`, label: 'סקירה', kind: 'primary' })}
      ${buttonHtml({ id: `${MP}-mode-bulk`, label: 'מצב גורף', kind: 'ghost' })}
    </div>
    <div id="${MP}-bulk" hidden>
      <div class="tt-box tt-box-warn">
        עובר על <b>כל ההודעות</b> במצב "נשלחה", בכל העמודים, בלי סקירה:
        <ul>
          <li>"${esc(MESSAGES_TRANSFER_HEADER)}" (מוסד אחר מבקש תלמיד שלנו): <b>אישור מעבר</b></li>
          <li>כל הודעה אחרת (כולל "${esc(MESSAGES_TRANSFER_DONE_HEADER)}" האינפורמטיבית): <b>שנה מצב הודעה לטופל</b></li>
        </ul>
        "דחיית מעבר" לא נלחץ אוטומטית. לדחייה או להצלבה מול המצבת השתמש ב"סקירה".
      </div>
      ${buttonsRowHtml([{ id: `${MP}-bulk-run`, label: 'הפעל מצב גורף', kind: 'primary' }])}
    </div>
    <div id="${MP}-table">
      <div class="tt-box tt-box-info">
        "סרוק" אוסף את כל ההודעות במצב "נשלחה" לטבלה אחת (כפילויות ממוזגות). בחר החלטה לכל שורה
        (ברירת-המחדל: בקשת מעבר → אישור, אחרת → טופל), ואז "בצע לפי הטבלה". "דלג" לא נוגע בהודעה.
        בקשת מעבר = מוסד אחר מבקש תלמיד שלנו. הדבקת מצבת מאקסל מסמנת על כל בקשה: "ממתין" כשהתלמיד עדיין
        במצבת (לאשר או לדחות), "כנראה בוצע" כשאינו במצבת. זה רמז לבדיקה, ההחלטה לא משתנה מעצמה;
        "כל 'כנראה בוצע': סמן כטופל" מחיל אותה.
      </div>
      ${buttonsRowHtml([{ id: `${MP}-scan`, label: 'סרוק', kind: 'primary' }])}
      <div id="${MP}-scan-status" class="tt-hint">לא בוצעה סריקה.</div>
      <details class="tt-section" id="${MP}-roster">
        <summary id="${MP}-roster-summary">מצבת להצלבה (הדבקה מאקסל: סניף, ת.ז./דרכון)</summary>
        <textarea id="${MP}-roster-input" class="tt-textarea tt-textarea-sm" placeholder="סניף&#9;ת.ז./דרכון&#10;16&#9;012345678"></textarea>
        ${buttonsRowHtml([
          { id: `${MP}-roster-load`, label: 'טען מצבת', kind: 'primary', size: 'small' },
          { id: `${MP}-roster-clear`, label: 'נקה מצבת', kind: 'subtle', size: 'small' },
        ])}
        <div id="${MP}-roster-status" class="tt-hint">אין מצבת טעונה.</div>
      </details>
      <div class="tt-row tt-review-tools">
        <input id="${MP}-filter" class="tt-input tt-filter" type="search" placeholder="סינון מהיר: ת.ז. / נושא / גוף">
        ${buttonHtml({ id: `${MP}-all-transfers`, label: 'כל בקשות המעבר: אישור', kind: 'ghost', size: 'small', disabled: true, title: 'על השורות המוצגות' })}
        ${buttonHtml({ id: `${MP}-all-others`, label: 'כל השאר: טופל', kind: 'ghost', size: 'small', disabled: true, title: 'על השורות המוצגות' })}
        ${buttonHtml({ id: `${MP}-all-done`, label: "כל 'כנראה בוצע': סמן כטופל", kind: 'ghost', size: 'small', disabled: true, title: 'על השורות המוצגות שמסומנות "כנראה בוצע" לפי המצבת (בקשת-מעבר על תלמיד שאינו במצבת)' })}
        ${buttonHtml({ id: `${MP}-all-skip`, label: 'הכל: דלג', kind: 'ghost', size: 'small', disabled: true, title: 'על השורות המוצגות' })}
      </div>
      <div id="${MP}-scanned" class="tt-scroll tt-scroll-tall"></div>
      <div id="${MP}-summary" class="tt-summary"></div>
      ${buttonsRowHtml([{ id: `${MP}-run-review`, label: 'בצע לפי הטבלה', kind: 'primary', disabled: true }])}
      <details class="tt-section" id="${MP}-excel">
        <summary id="${MP}-excel-summary">דרך אקסל (אופציה): העתק / הורד, ערוך, הדבק, טען, בצע</summary>
        <div class="tt-hint">ערוך באקסל את עמודת "פעולה" (${esc(MESSAGES_ALL_ACTIONS.join(' / '))}), הדבק כאן, "טען" ואז "בצע". אל תשנה את עמודת UID.</div>
        ${buttonsRowHtml([
          { id: `${MP}-copy-tsv`, label: 'העתק לאקסל', kind: 'ghost', size: 'small' },
          { id: `${MP}-xlsx`, label: 'הורד אקסל', kind: 'ghost', size: 'small' },
        ])}
        <textarea id="${MP}-input" class="tt-textarea" placeholder="UID&#9;נושא&#9;ת.ז./דרכון&#9;תאריך&#9;גוף ההודעה&#9;פעולה"></textarea>
        ${buttonsRowHtml([
          { id: `${MP}-load`, label: 'טען', kind: 'ghost', size: 'small' },
          { id: `${MP}-run-table`, label: 'בצע', kind: 'primary', size: 'small', disabled: true },
        ])}
        <div id="${MP}-load-status" class="tt-hint">טבלה לא טעונה.</div>
      </details>
    </div>
    ${buttonsRowHtml([
      { id: `${MP}-stop`, label: 'עצור', kind: 'danger', title: 'גם מקש Escape עוצר' },
      { id: `${MP}-copy-report`, label: 'העתק דוח', kind: 'ghost', size: 'small' },
    ])}
    <div id="${MP}-results" class="tt-scroll"></div>
    <div id="${MP}-report" class="tt-box tt-box-warn" hidden></div>`;

  $el(`${MP}-mode-bulk`).addEventListener('click', () => messagesSetMode('bulk'));
  $el(`${MP}-mode-table`).addEventListener('click', () => messagesSetMode('table'));
  $el(`${MP}-bulk-run`).addEventListener('click', () => messagesGuardRun(messagesRunBulk, 'מצב גורף'));
  $el(`${MP}-scan`).addEventListener('click', () => messagesGuardRun(messagesScan, 'הסריקה'));
  $el(`${MP}-roster-load`).addEventListener('click', messagesLoadRoster);
  $el(`${MP}-roster-clear`).addEventListener('click', messagesClearRoster);
  $el(`${MP}-filter`).addEventListener('input', messagesApplyFilter);
  $el(`${MP}-all-transfers`).addEventListener('click', () => messagesBulkDecide((r) => (r.header === MESSAGES_TRANSFER_HEADER ? MESSAGES_ACTION.APPROVE : null), 'כל בקשות המעבר: אישור'));
  $el(`${MP}-all-others`).addEventListener('click', () => messagesBulkDecide((r) => (r.header !== MESSAGES_TRANSFER_HEADER ? MESSAGES_ACTION.HANDLED : null), 'כל השאר: טופל'));
  $el(`${MP}-all-done`).addEventListener('click', () => messagesBulkDecide((r) => (r.probablyDone ? MESSAGES_ACTION.HANDLED : null), "כל 'כנראה בוצע': סמן כטופל"));
  $el(`${MP}-all-skip`).addEventListener('click', () => messagesBulkDecide(() => MESSAGES_ACTION.SKIP, 'הכל: דלג'));
  $el(`${MP}-run-review`).addEventListener('click', messagesRunReview);
  $el(`${MP}-copy-tsv`).addEventListener('click', messagesCopyTsv);
  $el(`${MP}-xlsx`).addEventListener('click', messagesDownload);
  $el(`${MP}-load`).addEventListener('click', messagesLoadTable);
  $el(`${MP}-run-table`).addEventListener('click', () => messagesGuardRun(() => messagesRunTable(msgPending), 'הביצוע לפי טבלה'));
  $el(`${MP}-stop`).addEventListener('click', messagesStop, true);
  $el(`${MP}-copy-report`).addEventListener('click', messagesCopyReport);

  messagesSetHooks({
    onStart: (mode) => {
      messagesSetRunning(true);
      if (mode !== 'scan') { msgResults = []; messagesRenderResults(); messagesRenderReport(null); }
      msgUi.progress(0, 0);
      msgUi.status(mode === 'scan' ? 'סורק…' : mode === 'bulk' ? 'מצב גורף רץ…' : 'מבצע לפי הטבלה…');
    },
    onStatus: (msg) => msgUi.status(msg),
    onProgress: (cur, total) => msgUi.progress(cur, total),
    onResult: (row, all) => { msgResults = all; messagesRenderResults(); },
    onScanProgress: (list, pages, total) => setText(`${MP}-scan-status`, `סריקה: ${pages} עמודים, ${total} הודעות עד כה…`),
    onScanDone: (list, info) => {
      msgDecisions = new Map(); // סריקה חדשה: ההחלטות מתחילות מההצעות
      messagesRebuildRows();
      const merged = msgRows.length;
      setText(`${MP}-scan-status`, `✓ נסרקו ${info.total} הודעות מ-${info.pages} עמודים${merged < info.total ? ` (${merged} שורות אחרי מיזוג כפילויות)` : ''}${info.stopped ? ' (נעצר)' : ''}.`);
      messagesSetRunning(false);
      const done = msgRows.filter((r) => r.probablyDone).length;
      msgUi.status(merged
        ? `${merged} שורות לסקירה. עבור על עמודת "החלטה" ואז "בצע לפי הטבלה"${done ? ` (${MESSAGES_DONE_HINT(done)})` : ''}`
        : 'לא נמצאו הודעות במצב "נשלחה"');
    },
    onDone: (rows, report) => {
      msgResults = rows;
      messagesRenderResults();
      messagesRenderReport(report);
      messagesSetRunning(false);
      msgUi.progress(0, 0);
      msgUi.status(`${report.stopped ? 'נעצר' : 'הסתיים'}. ${report.summary}${report.lines.length ? ' (ראה "מה נשאר")' : ''}. סרוק שוב לרענון הטבלה`);
    },
  });

  messagesSetMode(msgMode);
  msgResults = messagesGetReportRows();
  messagesRenderResults();
  messagesRebuildRows();
  log('[הודעות] דף ההודעות זוהה');
  msgUi.status('מוכן. "סרוק" לטבלת סקירה, או "מצב גורף"');
}

const messagesTool = {
  id: 'messages',
  title: 'הודעות',
  pages: [], // רק דף ההודעות, לפי הכתובת (לא כל דף "אחר" באתר; נצפה ברטוב 30.10: החלונית צצה גם בדף הכניסה)
  matches: (page) => messagesIsMessagesUrl((page && page.url) || (typeof location !== 'undefined' ? location.href : '')),
  hasPendingRun: () => false,
  isRunning: messagesIsRunning,
  onStop: messagesStop,
  mount: messagesMount,
};

// ─── src/main.js ───
// נקודת הכניסה של הסקריפט המאוחד "תלמוד - כלי אוטומציה": מזהה את הדף ומעלה את החלונית עם
// הכלים הרלוונטיים (קליטה, עזיבה, דיווח חודשי בדף מוסד; קליטה בדף סוג-לימוד; הודעות בדף ההודעות).
// כל כלי חי במודול משלו; כאן רק הרישום והאתחול. אין גישה ל-document ברמת המודול (חוץ מהאתחול בסוף).


registerTool(absorbTool);
registerTool(departTool);
registerTool(reportTool);
registerTool(messagesTool);

function initTalmudTools() {
  // דף הכניסה (LogIn.aspx, גם אחרי פקיעת session): אין מה להציג שם (נצפה ברטוב 30.10)
  if (typeof location !== 'undefined' && /\/LogIn\.aspx/i.test(location.pathname || '')) return false;
  const page = getPage();
  const mounted = mountPanel(page);
  if (!mounted.length) return false;
  restoreLog();
  log(`[init] כלי תלמו"ד ${PANEL_VERSION} · דף ${page.kind} · לשוניות: ${mounted.map((t) => t.title).join(', ')}`);
  return true;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initTalmudTools(); });
  } else {
    setTimeout(() => { initTalmudTools(); }, 600);
  }
}

})();
