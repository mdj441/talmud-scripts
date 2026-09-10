// ==UserScript==
// @name         תלמוד - כלי אוטומציה
// @namespace    https://github.com/mdj441/talmud-scripts
// @version      3.3.2
// @description  קליטה, עזיבה, הודעות ודיווח חודשי לתלמו"ד בסקריפט אחד (v3.3)
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
// זיהוי דף + ניווט לפי עובדות מאומתות מהאתר (בדיקה רטובה 10.9.2026):
//   דף מוסד:      /Institutes/InstitutesDetails.aspx?InstituteID=<id>      h1 "<מוסד> סניף NN"
//   דף סוג-לימוד: /StudyType/StudyTypeDetails.aspx?InstituteStudyTypeID=<x>&InstituteID=<id>
//                 h1 "סוג לימוד 600 - <תיאור>", פירורי-לחם "... > <מוסד> > 16 > (600)<תיאור>"
//   דף תלמיד-חדש: /Students/StudentsDetails.aspx?  עם hidStudentState=-1 ו-txtID ממולא
// הסניף נקרא מהדף עצמו (h1 / פירורי-לחם / כתובת), לא מזיכרון. שתי מפות נלמדות ב-localStorage:
// סניף→InstituteID, ו-(סניף,סוג)→InstituteStudyTypeID — כך ניווט הוא קפיצה ישירה לפי כתובת,
// והגריד/העץ משמשים רק בביקור הראשון. אין גישה ל-document/window ברמת המודול (import תקין ב-Node).


const NAV_KEY = 'talmud.nav';
const BRANCH_IDS_KEY = 'talmud.nav.branchIds';
const STUDY_TYPE_IDS_KEY = 'talmud.nav.studyTypeIds';
const DEFAULT_ORIGIN = 'https://talmud.edu.gov.il';
const NAV_BRANCH_IDS_SEED = { '00': '491', '16': '4159' };

// ─── כתובות ─────────────────────────────────────────────────────────────────

function siteOrigin() {
  try {
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.host) return location.origin;
  } catch (e) { /* Node */ }
  return DEFAULT_ORIGIN;
}

// טהורה: InstituteID מה-URL (לא רגיש לרישיות). אין/לא-מספרי => null.
function parseInstituteId(url) {
  if (typeof url !== 'string') return null;
  const m = /[?&]InstituteID=(\d+)(?:&|#|$)/i.exec(url);
  return m ? m[1] : null;
}

// טהורה: InstituteStudyTypeID מה-URL.
function parseInstituteStudyTypeId(url) {
  if (typeof url !== 'string') return null;
  const m = /[?&]InstituteStudyTypeID=(\d+)(?:&|#|$)/i.exec(url);
  return m ? m[1] : null;
}

function institutePageUrl(id) {
  const i = String(id == null ? '' : id).trim();
  return /^\d+$/.test(i) ? `${siteOrigin()}/Institutes/InstitutesDetails.aspx?InstituteID=${i}` : null;
}

function studyTypePageUrl(studyTypeInstId, instituteId) {
  const s = String(studyTypeInstId == null ? '' : studyTypeInstId).trim();
  const i = String(instituteId == null ? '' : instituteId).trim();
  if (!/^\d+$/.test(s) || !/^\d+$/.test(i)) return null;
  return `${siteOrigin()}/StudyType/StudyTypeDetails.aspx?InstituteStudyTypeID=${s}&InstituteID=${i}`;
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

// פירורי-הלחם של דף סוג-לימוד: "... > <מוסד> > 16 > (600)כולל..." → "16".
// דורש שהקוד בסוגריים יתאים לסוג-הלימוד של הדף (h1), כדי לא לתפוס מספר אחר בטקסט.
function parseBranchFromBreadcrumb(text, studyType) {
  if (typeof text !== 'string' || !studyType) return null;
  const flat = text.replace(/\s+/g, ' ');
  const re = new RegExp('(\\d{1,2})\\s*[>›»/]\\s*\\(\\s*' + String(studyType).replace(/\D/g, '') + '\\s*\\)');
  const m = re.exec(flat);
  return m ? padBranch2(m[1]) : null;
}

// טהורה: "0"/"00"/"7" → "00"/"00"/"07"; קלט לא-תקין → null.
function normalizeBranch(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d{1,2}$/.test(s) ? s.padStart(2, '0') : null;
}

// ─── מפות נלמדות (localStorage) ─────────────────────────────────────────────

function readJson(key) {
  try {
    if (typeof localStorage === 'undefined') return {};
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeJson(key, obj) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, JSON.stringify(obj));
    return true;
  } catch (e) {
    return false;
  }
}

// טהורה: מפה חדשה עם הזוג. קלט לא-תקין => עותק זהה.
function mergeBranchIds(map, branch, id) {
  const out = Object.assign({}, map && typeof map === 'object' && !Array.isArray(map) ? map : {});
  const b = normalizeBranch(branch);
  const i = String(id == null ? '' : id).trim();
  if (!b || !/^\d+$/.test(i)) return out;
  out[b] = i;
  return out;
}

// seed + נלמד. לעולם לא זורק.
function loadBranchIds() {
  return Object.assign({}, NAV_BRANCH_IDS_SEED, readJson(BRANCH_IDS_KEY));
}

// טהורה: הסניף שממופה ל-InstituteID (חיפוש הפוך). אין => null.
function branchForInstituteId(map, id) {
  const i = String(id == null ? '' : id).trim();
  if (!i || !map) return null;
  for (const [b, v] of Object.entries(map)) if (String(v) === i) return b;
  return null;
}

// לומד סניף→InstituteID. ‏authoritative=false (דף מוסד): לא דורס מיפוי קיים של ה-id לסניף אחר —
// קליק-עץ עשוי לרנדר סניף אחר באותה כתובת. ‏authoritative=true (דף סוג-לימוד עם פירורי-לחם):
// הכתובת נוצרה בשרת ומחייבת — דורס. מחזיר true כשנכתב משהו חדש.
function learnBranchId(branch, id, opts) {
  const b = normalizeBranch(branch);
  const i = String(id == null ? '' : id).trim();
  if (!b || !/^\d+$/.test(i)) return false;
  const authoritative = !!(opts && opts.authoritative);
  const cur = loadBranchIds();
  if (cur[b] === i) return false;
  if (!authoritative) {
    const owner = branchForInstituteId(cur, i);
    if (owner && owner !== b) {
      log(`[ניווט] InstituteID ${i} כבר ממופה לסניף ${owner}; לא לומדים ${b}→${i} מדף המוסד (אולי רינדור-במקום)`);
      return false;
    }
    if (cur[b] && cur[b] !== i && b in NAV_BRANCH_IDS_SEED === false) {
      // מיפוי קיים לסניף הזה עם id אחר — נלמד מדף מוסד; לא דורסים מדף מוסד, רק מדף סוג-לימוד
      return false;
    }
  }
  const learned = readJson(BRANCH_IDS_KEY);
  learned[b] = i;
  if (writeJson(BRANCH_IDS_KEY, learned)) { log(`[ניווט] נלמד: סניף ${b} → מוסד ${i}`); return true; }
  return false;
}

function loadStudyTypeIds() {
  return readJson(STUDY_TYPE_IDS_KEY);
}

function studyTypeKey(branch, code) {
  const b = normalizeBranch(branch);
  const c = String(code == null ? '' : code).trim();
  return b && /^\d+$/.test(c) ? `${b}|${c}` : null;
}

function learnStudyTypeId(branch, code, id) {
  const key = studyTypeKey(branch, code);
  const i = String(id == null ? '' : id).trim();
  if (!key || !/^\d+$/.test(i)) return false;
  const cur = loadStudyTypeIds();
  if (cur[key] === i) return false;
  cur[key] = i;
  if (writeJson(STUDY_TYPE_IDS_KEY, cur)) { log(`[ניווט] נלמד: סניף ${key.split('|')[0]} סוג ${key.split('|')[1]} → ${i}`); return true; }
  return false;
}

// ─── מצב-ניווט (sessionStorage): כוונת-ניווט + הדפים האחרונים ─────────────

function saveNavState(obj) {
  try { sessionStorage.setItem(NAV_KEY, JSON.stringify(obj || {})); } catch (e) { /* אצווה לא נתקעת */ }
}

function loadNavState() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(NAV_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function clearNavState() {
  try { sessionStorage.removeItem(NAV_KEY); } catch (e) { /* אצווה לא נתקעת */ }
}

function updateNavState(patch) {
  saveNavState(Object.assign({}, loadNavState(), patch));
}

// ─── זיהוי דף ───────────────────────────────────────────────────────────────

function classifyUrl(url) {
  if (typeof url !== 'string') return 'other';
  if (/InstitutesDetails\.aspx/i.test(url)) return 'institute';
  if (/StudyTypeDetails\.aspx/i.test(url)) return 'studyType';
  if (/Students\/StudentsDetails\.aspx/i.test(url)) return 'newStudent';
  return 'other';
}

function h1Text() {
  try {
    const h1 = typeof document !== 'undefined' ? document.querySelector('h1') : null;
    return (h1 && h1.textContent) || '';
  } catch (e) {
    return '';
  }
}

function breadcrumbText() {
  try {
    if (typeof document === 'undefined') return '';
    const el = document.querySelector('[id*="BreadCrumb" i], [id*="SiteMapPath" i], .breadcrumbs, .breadcrumb, [class*="breadcrumb" i]');
    if (el) return el.innerText || el.textContent || '';
    // גיבוי: תחילת הדף (פירורי-הלחם למעלה)
    const body = document.body ? (document.body.innerText || '') : '';
    return body.slice(0, 3000);
  } catch (e) {
    return '';
  }
}

// מחזיר תמיד אובייקט. ‏branchSource בדף סוג-לימוד: 'breadcrumb' | 'map' | 'intent' | null.
function getPage() {
  const url = (typeof location !== 'undefined' && location.href) || '';
  const kind = classifyUrl(url);

  if (kind === 'institute') {
    const branch = parseBranchFromH1(h1Text());
    const instituteId = parseInstituteId(url);
    if (branch && instituteId) learnBranchId(branch, instituteId, { authoritative: false });
    if (branch) updateNavState({ lastInstituteUrl: url, lastInstituteBranch: branch });
    return { kind, branch, branchSource: branch ? 'h1' : null, instituteId, studyType: null, url };
  }

  if (kind === 'studyType') {
    const studyType = parseStudyTypeFromH1(h1Text());
    const instituteId = parseInstituteId(url);
    const instituteStudyTypeId = parseInstituteStudyTypeId(url);
    let branch = parseBranchFromBreadcrumb(breadcrumbText(), studyType);
    let branchSource = branch ? 'breadcrumb' : null;
    if (!branch && instituteId) {
      branch = branchForInstituteId(loadBranchIds(), instituteId);
      if (branch) branchSource = 'map';
    }
    if (!branch) {
      // כוונת-ניווט: הגענו הנה מדף מוסד של סניף X בבקשה לסוג-לימוד Y, וה-h1 מאשר Y.
      const nav = loadNavState();
      const intent = nav.intent;
      if (intent && intent.studyType && studyType && String(intent.studyType) === String(studyType) && normalizeBranch(intent.branch)) {
        branch = normalizeBranch(intent.branch);
        branchSource = 'intent';
      }
    }
    if (branch && instituteId) learnBranchId(branch, instituteId, { authoritative: branchSource === 'breadcrumb' });
    if (branch && studyType && instituteStudyTypeId) learnStudyTypeId(branch, studyType, instituteStudyTypeId);
    if (branch) updateNavState({ intent: null, lastStudyTypeUrl: url, lastStudyTypeBranch: branch, lastStudyTypeCode: studyType });
    return { kind, branch, branchSource, instituteId, instituteStudyTypeId, studyType, url };
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

// טהורה: אינדקס שורת-נתונים (0-based, בלי כותרת/פייג'ר) של הקוד. אין => -1.
function findStudyTypeRow(rows, code) {
  if (!Array.isArray(rows)) return -1;
  const target = String(code).trim();
  let dataIndex = -1;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const first = String(row[0] ?? '').trim();
    if (!/^\d+$/.test(first)) continue;
    dataIndex++;
    if (first === target) return dataIndex;
  }
  return -1;
}

// טהורה: מיקום השורה במערך (כולל כותרת) — כדי לקרוא את ה-<tr> עצמו.
function findStudyTypeRowPosition(rows, code) {
  if (!Array.isArray(rows)) return -1;
  const target = String(code).trim();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const first = String(row[0] ?? '').trim();
    if (/^\d+$/.test(first) && first === target) return i;
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
    if (!Array.isArray(row)) continue;
    const first = String(row[0] ?? '').trim();
    if (/^\d+$/.test(first)) codes.push(first);
  }
  return `${codes.length}|${codes.join(',')}`;
}

// טהורה: הקודים ומצב-הזכאות מהגריד (למשל לתפריט הבחירה בפאנל). [{code, desc, status}]
function gridStudyTypes(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const first = String(row[0] ?? '').trim();
    if (!/^\d+$/.test(first)) continue;
    out.push({ code: first, desc: String(row[1] ?? '').trim(), status: String(row[3] ?? '').trim() });
  }
  return out;
}

function gridToRows(table) {
  if (!table || typeof table.querySelectorAll !== 'function') return [];
  return Array.from(table.querySelectorAll('tr')).map(
    (tr) => Array.from(tr.querySelectorAll('td,th')).map((cell) => (cell.textContent || '').trim())
  );
}

// טהורה: href בפורמט javascript:__doPostBack('target','arg') → {target, arg}.
function parsePostbackHref(href) {
  if (typeof href !== 'string') return null;
  const m = /^(?:javascript:)?__doPostBack\('([^']*)'\s*,\s*'([^']*)'\)\s*;?$/.exec(href.trim());
  if (!m) return null;
  return { target: m[1], arg: m[2] };
}

const STUDY_TYPE_TAB_LABEL = 'סוגי לימוד';
const STUDY_TYPE_MAX_PAGE_FLIPS = 25;

function tabText(el) {
  return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
}

// טאב "סוגי לימוד למוסד" בדף המוסד: כותרת לפי טקסט; postback אם יש href כזה, אחרת קליק צד-לקוח.
async function activateStudyTypeTab() {
  try {
    if (typeof document === 'undefined') return { ok: false, reason: 'אין document' };
    const headers = Array.from(document.querySelectorAll('.ajax__tab_header a, .ajax__tab_tab, [role="tab"]'));
    const tab = headers.find((el) => tabText(el).startsWith(STUDY_TYPE_TAB_LABEL))
      || headers.find((el) => tabText(el).includes(STUDY_TYPE_TAB_LABEL));
    if (!tab) return { ok: false, reason: 'לא נמצא טאב "סוגי לימוד למוסד" בדף המוסד' };
    const href = typeof tab.getAttribute === 'function' ? tab.getAttribute('href') : null;
    const parsed = href ? parsePostbackHref(href) : null;
    if (parsed) return firePostback(parsed.target, parsed.arg);
    const wait = waitPRM({ startTimeoutMs: 600, totalTimeoutMs: 8000 });
    setTimeout(() => { try { tab.click(); } catch (e) { /* אצווה לא נתקעת */ } }, 0);
    const res = await wait;
    if (res && res.ok === false) return { ok: false, reason: 'מעבר לטאב סוגי הלימוד נכשל: ' + (res.reason || '') };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'שגיאה בהפעלת טאב סוגי הלימוד: ' + (e && e.message) };
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

// מדף המוסד: טאב → שורה בגריד (עם דפדוף) → selectedRowStudyType → postback "עריכה" → ניווט מלא.
async function gotoStudyTypeFromInstitute(code, opts) {
  const shouldAbort = opts && typeof opts.shouldAbort === 'function' ? opts.shouldAbort : null;
  const aborted = (where) => ({ ok: false, aborted: true, reason: `הניווט לסוג הלימוד בוטל (${where})` });

  const tab = await activateStudyTypeTab();
  if (!tab.ok) return tab;
  if (shouldAbort && shouldAbort()) return aborted('אחרי הפעלת הטאב');

  for (let flip = 0; ; flip++) {
    const table = studyTypeGridEl();
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
      const res = await firePostback('ctl00$ContentPlaceHolder1$btnUpdateStudyType', '', { startTimeoutMs: 1500, totalTimeoutMs: 8000 });
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
      return { ok: false, reason: `דפדוף הגריד לא התקדם (עמוד ${flip + 1}) — סוג לימוד ${code} לא נמצא` };
    }
  }
}

// ─── עץ הסניפים (tvTalmud) — רק כשהסניף עוד לא במפה ────────────────────────

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

function readBranchesFromTree() {
  try {
    const tree = typeof document !== 'undefined' ? document.querySelector('[id$="tvTalmud"]') : null;
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

// ניווט לדף המוסד של סניף. סדר: כתובת ידועה → עץ-הצד (רק מדף מוסד) → קפיצה לדף-מוסד ידוע ומשם העץ.
// ניווט מלא: הדף נפרק, ה-Promise עלול לא להתממש — הקורא שומר את מצבו *לפני*.
async function gotoInstitute(branch) {
  const b = normalizeBranch(branch);
  if (!b) return { ok: false, reason: `סניף לא תקין: ${branch}` };
  const url = (typeof location !== 'undefined' && location.href) || '';
  const known = institutePageUrl(loadBranchIds()[b]);
  if (known) return navGoToUrl(known, { branch: b });

  if (classifyUrl(url) === 'institute') {
    const tree = typeof document !== 'undefined' ? document.querySelector('[id$="tvTalmud"]') : null;
    if (!tree) return { ok: false, reason: 'לא נמצא עץ הסניפים (tvTalmud) בדף המוסד' };
    const hrefs = Array.from(tree.querySelectorAll('a')).map((a) => a.getAttribute('href') || '');
    const idx = findBranchHref(hrefs, b);
    if (idx === -1) return { ok: false, notFound: true, reason: `סניף ${b} לא נמצא בעץ הסניפים` };
    const parsed = parsePostbackHref(hrefs[idx]);
    if (!parsed) return { ok: false, reason: 'קישור הסניף בעץ אינו בפורמט הצפוי' };
    const res = await firePostback(parsed.target, parsed.arg, { startTimeoutMs: 1500, totalTimeoutMs: 8000 });
    return Object.assign({ method: 'tree', branch: b }, res, { ok: res.ok !== false });
  }

  const nav = loadNavState();
  const hop = (nav.lastInstituteUrl && classifyUrl(nav.lastInstituteUrl) === 'institute' ? nav.lastInstituteUrl : null)
    || institutePageUrl(NAV_BRANCH_IDS_SEED['00']);
  return navGoToUrl(hop, { branch: b, hop: true });
}

// ניווט לדף סוג-לימוד. סדר: כתובת ידועה (קפיצה ישירה) → מדף המוסד של הסניף דרך הגריד →
// אחרת לדף המוסד (ומשם, אחרי הטעינה, הגריד). מחזיר {ok, method:'url'|'grid'|'tree'|..., notFound?}.
async function gotoStudyType(branch, code) {
  const b = normalizeBranch(branch);
  const c = String(code == null ? '' : code).trim();
  if (!b || !/^\d+$/.test(c)) return { ok: false, reason: `סניף/סוג לימוד לא תקינים: ${branch}/${code}` };
  updateNavState({ intent: { branch: b, studyType: c } });

  const direct = studyTypePageUrl(loadStudyTypeIds()[studyTypeKey(b, c)], loadBranchIds()[b]);
  if (direct) return navGoToUrl(direct, { branch: b, studyType: c });

  const page = getPage();
  if (page.kind === 'institute' && page.branch === b) {
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
// השלד המאוחד: כפתור צף + חלונית אחת עם לשוניות לכלים הרלוונטיים לדף הנוכחי.
// כל כלי נרשם עם registerTool({ id, title, pages, mount, onStop, isRunning, hasPendingRun }).
// ‏mount(container, ui) מרנדר את הלשונית; ui = { status(msg), progress(cur,total), running(bool), open() }.
// Escape → onStop של הלשונית הפעילה (רק כשהיא רצה). אין גישה ל-document ברמת המודול.


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
#tt-fab{position:fixed;bottom:18px;right:18px;z-index:99998;width:46px;height:46px;border-radius:50%;border:none;
  background:#2f6b8f;color:#fff;font-size:20px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center}
#tt-fab:hover{background:#255878}
#tt-fab .tt-badge{position:absolute;top:-4px;right:-4px;background:#c0392b;color:#fff;font-size:10px;border-radius:9px;padding:1px 5px;font-family:Arial,sans-serif;display:none}
#tt-fab.tt-running .tt-badge{display:block}
#tt-panel{position:fixed;top:56px;right:14px;z-index:99999;width:560px;max-width:calc(100vw - 28px);max-height:calc(100vh - 72px);
  display:flex;flex-direction:column;background:#fff;color:#1f2933;border:1px solid #cfd8e3;border-radius:10px;
  box-shadow:0 8px 28px rgba(0,0,0,.28);font-family:"Segoe UI",Arial,sans-serif;font-size:13px;direction:rtl;line-height:1.45}
#tt-panel[hidden]{display:none}
#tt-panel *{box-sizing:border-box}
.tt-head{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#2f6b8f;color:#fff;border-radius:10px 10px 0 0;cursor:move;user-select:none}
.tt-head .tt-title{font-weight:700;font-size:14px;flex:1}
.tt-head .tt-ver{font-size:11px;opacity:.75}
.tt-head .tt-x{background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0 4px;line-height:1}
.tt-tabs{display:flex;gap:2px;padding:6px 10px 0;background:#f2f6f9;border-bottom:1px solid #dbe4ec}
.tt-tab{border:1px solid transparent;border-bottom:none;background:transparent;padding:6px 12px;border-radius:7px 7px 0 0;cursor:pointer;font-size:13px;color:#3e5566}
.tt-tab:hover{background:#e7eef4}
.tt-tab.tt-tab-active{background:#fff;border-color:#dbe4ec;color:#1f2933;font-weight:600;margin-bottom:-1px}
.tt-tab .tt-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#c0392b;margin-inline-start:6px;vertical-align:middle}
.tt-body{padding:10px 12px 12px;overflow:auto}
.tt-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.tt-status{flex:1;font-size:12px;color:#334e68;background:#f2f6f9;border-radius:6px;padding:5px 9px;min-height:26px}
.tt-progress{font-size:12px;color:#627d98;white-space:nowrap}
.tt-row{display:flex;gap:6px;margin:6px 0;flex-wrap:wrap;align-items:center}
.tt-row-tight{margin:4px 0 2px}
.tt-row > .tt-btn{flex:1 1 auto}
.tt-btn{border:1px solid #cfd8e3;background:#fff;color:#1f2933;padding:7px 10px;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit}
.tt-btn:hover{background:#f2f6f9}
.tt-btn:disabled{opacity:.5;cursor:default}
.tt-btn-primary{background:#2f6b8f;border-color:#2f6b8f;color:#fff;font-weight:600}
.tt-btn-primary:hover{background:#255878}
.tt-btn-danger{background:#fff;border-color:#c0392b;color:#c0392b;font-weight:600}
.tt-btn-danger:hover{background:#fdf1ef}
.tt-btn-ghost{background:#fff}
.tt-btn-subtle{background:#f2f6f9;border-color:#e1e8ef;color:#3e5566}
.tt-btn-sm{padding:4px 8px;font-size:12px}
.tt-field{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#3e5566;flex:1}
.tt-field-label{font-weight:600}
.tt-hint{font-size:11px;color:#627d98}
.tt-hint-warn{color:#8a5a00}
.tt-input,.tt-select,.tt-textarea{border:1px solid #cfd8e3;border-radius:6px;padding:6px 8px;font-size:13px;font-family:inherit;background:#fff;color:#1f2933;width:100%}
.tt-input:focus,.tt-select:focus,.tt-textarea:focus{outline:2px solid #9cc3dc;outline-offset:0;border-color:#2f6b8f}
.tt-textarea{min-height:90px;resize:vertical;direction:ltr;font-family:Consolas,monospace;font-size:12px}
.tt-mono{direction:ltr;font-family:Consolas,monospace;font-size:12px;text-align:left}
.tt-center{text-align:center}
.tt-box{border:1px solid #dbe4ec;border-radius:7px;padding:8px 10px;margin:6px 0;font-size:12px;background:#fafcfd}
.tt-box-warn{background:#fff8e6;border-color:#eadba6;color:#5a4a00}
.tt-box-error{background:#fdf1ef;border-color:#f0c4bd;color:#7a1f16}
.tt-box-info{background:#eef5fa;border-color:#cfe0ec;color:#24455c}
.tt-box ul,.tt-box ol{margin:4px 0 0;padding-inline-start:18px}
.tt-table{width:100%;border-collapse:collapse;font-size:12px;margin:4px 0}
.tt-table th{background:#f2f6f9;color:#334e68;font-weight:600;padding:5px 6px;text-align:right;border-bottom:1px solid #dbe4ec;position:sticky;top:0}
.tt-table td{padding:4px 6px;border-bottom:1px solid #eef2f6;vertical-align:middle}
.tt-table tr.tt-r-ok td.tt-status-cell{color:#1e7145;font-weight:600}
.tt-table tr.tt-r-warn td.tt-status-cell{color:#8a5a00;font-weight:600}
.tt-table tr.tt-r-bad td.tt-status-cell{color:#a2261a;font-weight:600}
.tt-table tr.tt-r-ok{background:#f3faf5}.tt-table tr.tt-r-warn{background:#fffaf0}.tt-table tr.tt-r-bad{background:#fdf5f4}
.tt-scroll{max-height:220px;overflow:auto;border:1px solid #e1e8ef;border-radius:7px}
.tt-empty{color:#829ab1;font-size:12px;padding:6px}
.tt-report-summary{font-weight:600;margin:4px 0}
.tt-report-title{font-weight:600;margin-top:6px}
.tt-report-list{margin:4px 0 0;padding-inline-start:18px}
.tt-report-list li{margin-bottom:3px}
.tt-ok{color:#1e7145}
.tt-log-details{margin-top:8px}
.tt-log-details summary{cursor:pointer;font-size:12px;color:#627d98;user-select:none}
.tt-log{max-height:160px;overflow:auto;background:#1e1e1e;color:#d4d4d4;padding:8px;border-radius:6px;font-size:11px;white-space:pre-wrap;direction:ltr;text-align:left;margin:4px 0 0;font-family:Consolas,monospace}
.tt-chips{display:flex;flex-wrap:wrap;gap:4px;max-height:140px;overflow:auto;padding:4px 0}
.tt-chip{border:1px solid #cfe0ec;border-radius:12px;padding:1px 8px;background:#fff;cursor:pointer;font-size:12px}
.tt-chip:hover{background:#eef5fa}
.tt-grid-input{width:100%;border-collapse:collapse;font-size:12px}
.tt-grid-input th{background:#f2f6f9;font-weight:600;padding:4px 5px;text-align:right;border-bottom:1px solid #dbe4ec;white-space:nowrap}
.tt-grid-input td{padding:2px 3px;border-bottom:1px solid #eef2f6}
.tt-grid-input .tt-input,.tt-grid-input .tt-select{padding:4px 6px;font-size:12px;min-width:0}
.tt-grid-input tr.tt-r-bad td{background:#fdf5f4}
.tt-cell-off{background:#f7f9fb}
`;

function ensureStyle() {
  if ($el('tt-style')) return;
  const style = document.createElement('style');
  style.id = 'tt-style';
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

function toolsForPage(pageKind) {
  return tools.filter((t) => {
    const fits = Array.isArray(t.pages) && t.pages.includes(pageKind);
    let pending = false;
    try { pending = !!(t.hasPendingRun && t.hasPendingRun()); } catch (e) { pending = false; }
    return fits || pending;
  });
}

function toolById(id) { return tools.find((t) => t.id === id) || null; }

function makeUi(tool) {
  return {
    status(msg) { const el = $el(`tt-${tool.id}-status`); if (el) el.textContent = msg == null ? '' : String(msg); },
    progress(cur, total) { const el = $el(`tt-${tool.id}-progress`); if (el) el.textContent = total ? `${cur} / ${total}` : ''; },
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

// בונה את הכפתור הצף והחלונית לדף הנוכחי. מחזיר את רשימת הכלים שנטענו (ריק = אין מה להציג).
function mountPanel(page) {
  if (typeof document === 'undefined' || !document.body) return [];
  if ($el('tt-panel')) return []; // מופע אחר כבר מנהל את הדף
  const list = toolsForPage(page.kind);
  if (!list.length) return [];
  ensureStyle();

  const state = loadUiState();
  const pending = list.find((t) => { try { return t.hasPendingRun && t.hasPendingRun(); } catch (e) { return false; } });
  const initialTab = (pending && pending.id) || (list.some((t) => t.id === state.tab) ? state.tab : list[0].id);
  const initiallyOpen = pending ? true : state.open !== false;

  const fab = document.createElement('button');
  fab.id = 'tt-fab';
  fab.type = 'button';
  fab.title = 'כלי תלמו"ד';
  fab.innerHTML = '🎓<span class="tt-badge">רץ</span>';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'tt-panel';
  panel.hidden = !initiallyOpen;
  panel.innerHTML = `
    <div class="tt-head" id="tt-head">
      <span class="tt-title">כלי תלמו"ד</span>
      <span class="tt-ver">גרסה ${esc(PANEL_VERSION)}</span>
      <button type="button" class="tt-x" id="tt-close" title="סגור (הכפתור הצף פותח שוב)">×</button>
    </div>
    <div class="tt-tabs" id="tt-tabs">
      ${list.map((t) => `<button type="button" class="tt-tab" id="tt-tab-${esc(t.id)}">${esc(t.title)}<span class="tt-dot" hidden></span></button>`).join('')}
    </div>
    <div class="tt-body">
      ${list.map((t) => `<div id="tt-pane-${esc(t.id)}" hidden>
        <div class="tt-toolbar"><div class="tt-status" id="tt-${esc(t.id)}-status">מוכן</div><div class="tt-progress" id="tt-${esc(t.id)}-progress"></div></div>
        <div id="tt-${esc(t.id)}-root"></div>
      </div>`).join('')}
      ${logSectionHtml('tt-log')}
    </div>`;
  document.body.appendChild(panel);

  fab.addEventListener('click', () => openPanel(panel.hidden));
  $el('tt-close').addEventListener('click', () => openPanel(false));
  for (const t of list) $el(`tt-tab-${t.id}`).addEventListener('click', () => activateTab(t.id));

  // גרירה בכותרת
  let drag = null;
  $el('tt-head').addEventListener('mousedown', (e) => {
    if (e.target.id === 'tt-close') return;
    drag = { sx: e.clientX - panel.offsetLeft, sy: e.clientY - panel.offsetTop };
    panel.style.right = 'auto';
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    panel.style.left = (e.clientX - drag.sx) + 'px';
    panel.style.top = (e.clientY - drag.sy) + 'px';
  });
  document.addEventListener('mouseup', () => { drag = null; });

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
    } else if (idInfo.type === 'passport') {
      birthDateRaw = opt(0);
      countryRaw = opt(1);
    } else if (cells.length === 4 || cells.length === 5) {
      return err('מספר עמודות לא צפוי (לת.ז. עם פרטי תלמיד חדש צריך גם שם פרטי, שם משפחה ותאריך לידה)');
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
function analyzeGrid(rows, identity, count) {
  const none = { found: false, matchType: null };
  if (count === 0) return none;
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
}

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
  absorbBtn: 'ContentPlaceHolder1_btnStudentAcceptence3',
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

// טאב 2 "רשימת תלמידים" בדף סוג-הלימוד.
function absorbActivateStudentsTab() {
  try {
    if (typeof window === 'undefined' || typeof window.$find !== 'function') return false;
    const tabs = window.$find(ABSORB_IDS.tabContainer);
    if (tabs && typeof tabs.set_activeTabIndex === 'function' && tabs.get_activeTabIndex() !== 2) {
      tabs.set_activeTabIndex(2);
      return true;
    }
  } catch (e) { /* הפקדים בדרך כלל כבר ב-DOM */ }
  return false;
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

// ─── hooks לפאנל ────────────────────────────────────────────────────────────
function absorbSetHooks(hooks) { S.hooks = hooks || {}; }
function absorbGetResults() { return S.results.slice(); }
function absorbIsRunning() { return S.running; }
function hook(name, ...args) { try { if (S.hooks[name]) S.hooks[name](...args); } catch (e) { /* אצווה לא נתקעת */ } }

// ─── ניווט מלא: האם הדף מתחיל להיפרק, וכלב-שומר אם לא ─────────────────────
let unloadSeen = false;
let unloadWatched = false;
let watchdogTimer = null;

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
    const fits = task && page.kind === 'studyType' && page.branch === normalizeBranch(task.branch) && page.studyType === String(task.studyType);
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
async function ensureStudyTypePage(task, gen) {
  const branch = normalizeBranch(task.branch);
  const code = String(task.studyType);
  const page = getPage();
  if (page.kind === 'studyType' && page.studyType === code) {
    if (page.branch === branch) return { ok: true, navigated: false };
    if (!page.branch) log(`[ניווט] דף סוג-לימוד ${code}, אך הסניף לא ניתן לזיהוי מהדף — מנווטים כדי לוודא`);
    else log(`[ניווט] דף סוג-לימוד ${code} של סניף ${page.branch}; צריך סניף ${branch}`);
  }
  checkStop('before-nav', gen);
  saveAbsorbState();
  beginNavigation();
  const res = await gotoStudyType(branch, code);
  if (absorbIsCancelled(gen)) checkStop('nav-cancelled', gen);
  if (!res || res.ok === false) {
    if (res && res.notFound) {
      return {
        ok: false, reason: res.reason,
        action: `בדוק בדף המוסד של סניף ${branch}, בלשונית "סוגי לימוד למוסד", שסוג ${code} קיים ואינו "סגור". אם הוא קיים, פתח אותו ולחץ "התחל" שוב על השורה הזו`,
      };
    }
    return { ok: false, reason: (res && res.reason) || 'הניווט נכשל', action: manualStudyTypeAction(branch, code) };
  }
  const how = res.method === 'url' ? `כתובת ישירה${res.hop ? ' (קפיצה לדף מוסד ידוע)' : ''}` : res.method === 'grid' ? 'גריד סוגי-הלימוד בדף המוסד' : res.method === 'tree' ? 'עץ הסניפים' : res.method || '?';
  log(`[ניווט] → סניף ${branch} סוג ${code} · ${how}`);
  if (res.status && /סגור/.test(res.status)) log(`[ניווט] שים לב: סוג לימוד ${code} מסומן "${res.status}" בגריד`);
  return { ok: true, navigated: true };
}

// ─── דף תלמיד-חדש ───────────────────────────────────────────────────────────

// יוצאים מדף תלמיד-חדש לדף סוג-הלימוד (הכתובת כבר ידועה — היינו שם).
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

async function handleNewStudentPage(task, identity, mk, gen, myIdx) {
  log('[תלמיד חדש] נחתנו בדף תלמיד-חדש');
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
  saveAbsorbState({ pendingSave: { idx: myIdx, identity } });
  S.justSaved = identity;
  beginNavigation();
  log('[תלמיד חדש] שמירה…');
  const wait = absorbFireElement(saveBtn, { startTimeoutMs: 3000, totalTimeoutMs: SAVE_BUDGET_MS });
  const outcome = await absorbWaitOutcome(wait, SAVE_BUDGET_MS, gen);
  log(`[תלמיד חדש] תוצאת השמירה: ${outcome.kind}`);
  await sleepCheckStop(300, gen);

  const { pop, blocked } = await absorbReadAndHidePopup('אחרי שמירת תלמיד חדש', gen);
  if (blocked) {
    S.justSaved = null;
    saveAbsorbState();
    return mk(`${ABSORB_STATUS.BLOCKED}: ${pop.text}`, pop.text, 'המערכת מבקשת אישור "המשך" בשמירת התלמיד. הסקריפט לא מאשר לבד: פתח את דף התלמיד, קרא את ההודעה והחלט');
  }

  if (getPage().kind === 'newStudent') {
    const errs = absorbCollectValidationMessages();
    if (errs.length) {
      S.justSaved = null;
      saveAbsorbState();
      return mk(ABSORB_STATUS.ERROR, errs.join(' | '), 'תקן את הפרטים לפי ההודעה והרץ שוב, או השלם ידנית בדף התלמיד');
    }
    // נשארנו בדף (עם או בלי הודעת הצלחה) — האמת נמצאת ברשימת התלמידים של סוג-הלימוד.
    log('[תלמיד חדש] נשארנו בדף אחרי השמירה — עוברים לרשימת התלמידים לאימות');
    beginNavigation();
    const res = await gotoStudyType(task.branch, task.studyType);
    if (res && res.ok !== false) return NAVIGATED;
    S.justSaved = null;
    return mk(ABSORB_STATUS.SAVED_UNVERIFIED, 'השמירה בוצעה אך לא ניתן היה לחזור לרשימת התלמידים', `ודא ברשימת התלמידים של סוג ${task.studyType} בסניף ${task.branch} שהתלמיד נקלט`);
  }

  // הדף התחלף בלי טעינה מלאה (נדיר): אם זה דף סוג-הלימוד — מאמתים כאן.
  return verifyAfterNewStudent(task, identity, mk, gen);
}

async function verifyAfterNewStudent(task, identity, mk, gen) {
  const page = getPage();
  if (page.kind === 'studyType' && page.studyType === String(task.studyType)) {
    absorbActivateStudentsTab();
    const input = $el(ABSORB_IDS.searchInput);
    const btn = $el(ABSORB_IDS.searchBtn);
    if (input && btn) {
      const search = await absorbSearch(input, btn, identity, gen);
      if (search.executed && analyzeGrid(readAbsorbGridRows(), identity, absorbCountGate(search)).found) {
        S.justSaved = null;
        return mk(ABSORB_STATUS.OK_NEW, '', '');
      }
    }
  }
  S.justSaved = null;
  return mk(ABSORB_STATUS.SAVED_UNVERIFIED, 'התלמיד נשמר; הקליטה לא אומתה ברשימה', `ודא ברשימת התלמידים של סוג ${task.studyType} בסניף ${task.branch} שהתלמיד נקלט`);
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
  absorbActivateStudentsTab();
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
  const preGrid = analyzeGrid(readAbsorbGridRows(), identity, absorbCountGate(pre));
  if (preGrid.found) {
    const via = preGrid.matchType === 'single-row-fallback' ? 'התאמה לפי שורה יחידה ברשימה' : '';
    if (justSaved) { S.justSaved = null; log('[תלמיד חדש] נמצא ברשימה אחרי השמירה → נקלט'); return mk(ABSORB_STATUS.OK_NEW, via, ''); }
    log('[קליטה] כבר קיים בסוג הלימוד');
    return mk(ABSORB_STATUS.EXISTS, via, '');
  }
  if (justSaved) {
    // נשמר בדף תלמיד-חדש אך לא ברשימה — לא קולטים שוב, מדווחים לבדיקה ידנית.
    S.justSaved = null;
    return mk(ABSORB_STATUS.SAVED_UNVERIFIED, 'התלמיד נשמר בדף תלמיד-חדש אך לא נמצא ברשימת התלמידים', `בדוק ברשימת התלמידים של סוג ${code} בסניף ${branch}; אם התלמיד לא שם, קלוט אותו ידנית`);
  }
  checkStop('after-precheck', gen);

  // ── שלב 3: "קליטה" ──
  const absorbBtn = $el(ABSORB_IDS.absorbBtn);
  if (!absorbBtn) return mk(ABSORB_STATUS.ERROR, 'כפתור "קליטה" לא נמצא בדף', 'בדוק שיש לך הרשאת קליטה לסוג לימוד זה ושאינו "סגור"; אם יש, קלוט ידנית');
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
    if (!modalId) return mk(ABSORB_STATUS.ERROR, 'שדה המזהה בחלון הקליטה לא נמצא', 'קלוט ידנית');
    await absorbSetAndWait(modalId, identity);
    await sleepCheckStop(120, gen);

    if (task.idType === 'passport') {
      const birthEl = $el(ABSORB_IDS.birthDate);
      if (!birthEl) return mk(ABSORB_STATUS.ERROR, 'שדה תאריך לידה בחלון הקליטה לא נמצא', 'קלוט ידנית');
      await absorbSetAndWait(birthEl, task.birthDate);
      await sleepCheckStop(120, gen);
      const countryEl = $el(ABSORB_IDS.countryDdl);
      if (!countryEl) return mk(ABSORB_STATUS.ERROR, 'שדה ארץ דרכון בחלון הקליטה לא נמצא', 'קלוט ידנית');
      const country = await absorbSelectOption(countryEl, task.countryValue, 'ארץ', task.country);
      if (!country.ok) return mk(ABSORB_STATUS.ERROR, country.reason, 'תקן את עמודת "ארץ" לשם מהרשימה (כפתור "רשימת ארצות") והרץ שוב');
      await sleepCheckStop(150, gen);
    }

    const startDate = startDateFromPanel();
    if (startDate) {
      const startEl = $el(ABSORB_IDS.startDate);
      if (startEl && startEl.value !== startDate) await absorbSetAndWait(startEl, startDate);
    }
    checkStop('after-fields', gen);

    // ── שלב 5: אישור ──
    const confirmBtn = $el(ABSORB_IDS.confirmBtn);
    if (!confirmBtn) return mk(ABSORB_STATUS.ERROR, 'כפתור "אישור" לא נמצא בחלון הקליטה', 'קלוט ידנית');
    const v = absorbRunClientValidation('PopValidation');
    if (!v.ok) return mk(ABSORB_STATUS.ERROR, 'ולידציה בחלון הקליטה: ' + (v.messages.join(' | ') || 'שדה לא תקין'), 'תקן בשורה את המזהה, תאריך הלידה או הארץ לפי ההודעה, והרץ שוב');

    saveAbsorbState(); // "אישור" עלול לטעון דף תלמיד-חדש
    beginNavigation();
    const confirmWait = absorbFireElement(confirmBtn, { startTimeoutMs: 3000, totalTimeoutMs: CONFIRM_BUDGET_MS });
    const outcome = await absorbWaitOutcome(confirmWait, CONFIRM_BUDGET_MS, gen);
    log(`[אישור] תוצאה: ${outcome.kind}`);

    // ── שלב 6: דף תלמיד-חדש באותו מסמך (נדיר; בדרך כלל זו טעינה מלאה שממשיכה ב-resume) ──
    if (getPage().kind === 'newStudent') {
      if (absorbNewStudentPageMatches(identity)) return handleNewStudentPage(task, identity, mk, gen, myIdx);
      const res = mk(ABSORB_STATUS.ERROR, 'נפתח דף תלמיד-חדש של מזהה אחר', 'בדוק ידנית מה קרה בקליטה של שורה זו');
      if (!recordResult(res, gen, myIdx)) return CONTINUE;
      return leaveNewStudentPage(task, res, gen);
    }

    // ── שלב 7: הודעה → מודאל → אימות ──
    await sleepCheckStop(300, gen);
    const afterConfirm = await absorbReadAndHidePopup('אחרי אישור', gen);
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
    if (!verifyInput || !verifyBtn) return mk(ABSORB_STATUS.SAVED_UNVERIFIED, popupDetail || 'שדות החיפוש נעלמו אחרי הקליטה', `ודא ברשימת התלמידים של סוג ${code} שהתלמיד נקלט`);
    const verify = await absorbSearch(verifyInput, verifyBtn, identity, gen);
    if (!verify.executed) return mk(ABSORB_STATUS.SAVED_UNVERIFIED, absorbSearchFailReason(verify), ABSORB_SEARCH_FAILED_ACTION);
    const found = analyzeGrid(readAbsorbGridRows(), identity, absorbCountGate(verify));
    if (found.found) { log('◀ נקלט'); return mk(ABSORB_STATUS.OK, popupDetail || (found.matchType === 'single-row-fallback' ? 'התאמה לפי שורה יחידה ברשימה' : ''), ''); }
    log('◀ לא אומת ברשימה');
    return mk(ABSORB_STATUS.UNVERIFIED, popupDetail || 'לא נמצא ברשימה אחרי הקליטה', `חפש את המזהה ברשימת התלמידים של סוג ${code}; אם אינו שם, קלוט ידנית`);
  } finally {
    try {
      if (absorbIsCancelled(gen)) log('[מודאל] ניסיון שבוטל — לא נוגעים בדף');
      else if (absorbModalVisible()) await absorbCloseAcceptModal();
    } catch (e) { /* אצווה לא נתקעת */ }
  }
}

function startDateFromPanel() {
  try { const v = S.hooks.getStartDate ? S.hooks.getStartDate() : ''; return v ? String(v).trim() : ''; } catch (e) { return ''; }
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
  const errResult = (detail) => makeAbsorbResult(task, ABSORB_STATUS.ERROR, detail, 'בצע את השורה הזו ידנית באתר. אם זה חוזר, העתק את היומן (מזהים ממוסכים) ושלח');
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
  absorbResetLandings();
  saveAbsorbState();
  hook('onResult', result, S.results);
  return true;
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
  clearAbsorbState();
  clearAbsorbStop();
  const report = buildRemainingReport(S.results);
  log(`═══ סיום · ${report.summary}`);
  hook('onDone', S.results, report);
}

async function runQueue() {
  S.running = true;
  clearWatchdog();
  watchUnload();
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
        recordResult(makeAbsorbResult(task, ABSORB_STATUS.ERROR, 'לא נרשמה תוצאה לשורה הזו', 'בצע את השורה הזו ידנית באתר וצרף את היומן'), null, taskIdx);
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

async function absorbStartRun(tasks) {
  clearAbsorbStop();
  absorbNextGeneration();
  clearWatchdog();
  absorbResetRun();
  absorbResetLandings();
  S.queue = Array.isArray(tasks) ? tasks.slice() : [];
  S.startedAt = new Date().toISOString();
  saveAbsorbState();
  return runQueue();
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
  absorbResetRun();
  clearAbsorbState();
  clearAbsorbStop();
  log('[המשך] התור השמור נמחק לבקשת המשתמש');
  return true;
}

// בטעינת דף: אם יש תור שמור — ממשיכים. תור ישן (>30 דק') ממשיך רק אחרי "המשך" בפאנל.
async function absorbResumeIfPending(opts) {
  if (S.running) return false;
  const allowStale = !!(opts && opts.allowStale);
  const st = loadAbsorbState();
  if (!st || !Array.isArray(st.queue) || !st.queue.length) return false;

  if (absorbIsStopped()) { log('[המשך] דגל עצירה — מנקים מצב'); clearAbsorbState(); clearAbsorbStop(); return false; }

  if (!allowStale && absorbQueueIsStale(st.startedAt, Date.now(), ABSORB_MAX_QUEUE_AGE_MS)) {
    log(`[המשך] תור שמור מ-${st.startedAt} ישן מ-${Math.round(ABSORB_MAX_QUEUE_AGE_MS / 60000)} דקות — לא ממשיכים אוטומטית`);
    hook('onStaleQueue', { total: st.queue.length, curIdx: st.curIdx || 0, startedAt: st.startedAt || null, stale: true });
    return false;
  }

  S.queue = st.queue;
  S.results = Array.isArray(st.results) ? st.results : [];
  S.curIdx = st.curIdx || 0;
  S.lastRecordedIdx = S.curIdx - 1;
  S.startedAt = st.startedAt || null;
  if (S.curIdx >= S.queue.length) { finishRun(); return false; }

  if (st.pendingSave && st.pendingSave.idx === S.curIdx) {
    S.justSaved = st.pendingSave.identity;
    log('[המשך] תלמיד חדש נשמר לפני הטעינה — נאמת ברשימה');
    saveAbsorbState();
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
  if (!S.running) {
    if (S.queue.length && S.curIdx < S.queue.length) {
      fillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
      finishRun();
    } else {
      clearAbsorbState();
      clearAbsorbStop();
    }
  }
}

// ─── src/tools/absorb-ui.js ───
// לשונית "קליטת תלמידים" בחלונית המאוחדת. הזרימה עצמה ב-absorb-flow.js; כאן רק הממשק:
// קלט (הדבקה/אקסל), שגיאות-פרסור, תאריך תחילת לימודים, התחל/עצור, תוצאות, דוח "מה נשאר".
// אין גישה ל-document ברמת המודול.


const P = 'tt-absorb';
const countryNames = COUNTRIES.map((c) => c.he).sort((a, b) => a.localeCompare(b, 'he'));
let ui = null;
let awaitingErrorConfirm = false;
let results = [];
let total = 0;

const RESULT_COLUMNS = [
  { key: 'branch', label: 'סניף', center: true, width: '44px' },
  { key: 'studyType', label: 'סוג', center: true, width: '44px' },
  { key: 'identity', label: 'ת.ז./דרכון', mono: true },
  { key: 'status', label: 'סטטוס' },
];

function classify(r) {
  const key = absorbStatusKey(r.status);
  if (isAbsorbSuccess(r.status)) return 'ok';
  if (key === 'נעצר' || key === 'דולג') return 'warn';
  return 'bad';
}

function renderResults() {
  setHtml(`${P}-results`, resultsTableHtml({ columns: RESULT_COLUMNS, rows: results, classify }));
}

function renderErrors(errors, validCount) {
  if (!errors || !errors.length) { show(`${P}-errors`, false); setHtml(`${P}-errors`, ''); return; }
  const items = errors.slice(0, 25).map((e) => `<li>שורה ${esc(e.line)}: ${esc(e.reason)}</li>`).join('');
  setHtml(`${P}-errors`, `<b>${errors.length} שורות לא יורצו</b> (${validCount} תקינות):<ul>${items}${errors.length > 25 ? `<li>ועוד ${errors.length - 25}</li>` : ''}</ul>`);
  show(`${P}-errors`, true);
}

function renderReport(report) {
  if (!report) { show(`${P}-report`, false); setHtml(`${P}-report`, ''); return; }
  setHtml(`${P}-report`, reportBoxHtml(report));
  show(`${P}-report`, true);
}

function renderStaleQueue(info) {
  if (!info) { show(`${P}-stale`, false); setHtml(`${P}-stale`, ''); return; }
  const left = Math.max(0, (info.total || 0) - (info.curIdx || 0));
  const startedMs = Date.parse(info.startedAt);
  const ageMin = Number.isNaN(startedMs) ? null : Math.round((Date.now() - startedMs) / 60000);
  setHtml(`${P}-stale`, `<b>נמצא תור שמור${ageMin === null ? '' : ` מלפני ${esc(ageMin)} דקות`}</b>: ${esc(left)} שורות טרם עובדו (${esc(info.curIdx || 0)} מתוך ${esc(info.total || 0)} הושלמו). התור ישן מדי להמשך אוטומטי.
    ${buttonsRowHtml([
      { id: `${P}-stale-go`, label: 'המשך את התור', kind: 'primary', size: 'small' },
      { id: `${P}-stale-clear`, label: 'נקה את התור', kind: 'danger', size: 'small' },
    ])}`);
  show(`${P}-stale`, true);
  $el(`${P}-stale-go`).addEventListener('click', () => {
    renderStaleQueue(null);
    ui.status('ממשיך את התור השמור…');
    setRunning(true);
    Promise.resolve().then(() => absorbResumeIfPending({ allowStale: true })).catch((e) => { log('[המשך] כשל: ' + (e && e.message)); setRunning(false); });
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
  renderErrors([], 0);
}

async function start() {
  if (absorbIsRunning()) return;
  const text = (($el(`${P}-input`) || {}).value || '').trim();
  if (!text) { ui.status('הדבק רשימת תלמידים (טורים מאקסל) או טען קובץ אקסל'); return; }
  const parsed = parseAbsorbInput(text);
  if (parsed.errors.length && !awaitingErrorConfirm) {
    renderErrors(parsed.errors, parsed.tasks.length);
    awaitingErrorConfirm = true;
    setText(`${P}-start`, parsed.tasks.length ? `הרץ בכל זאת את ${parsed.tasks.length} התקינות` : 'התחל קליטה');
    ui.status(`${parsed.errors.length} שורות בעייתיות. תקן אותן, או לחץ שוב כדי להריץ רק את התקינות`);
    log(`[פרסור] ${parsed.tasks.length} תקינות · ${parsed.errors.length} שגויות`);
    return;
  }
  if (!parsed.tasks.length) { renderErrors(parsed.errors, 0); ui.status('אין שורות תקינות להרצה'); return; }
  resetStartButton();
  renderReport(null);
  renderStaleQueue(null);
  results = [];
  renderResults();
  clearAbsorbStop();
  setRunning(true);
  ui.progress(0, parsed.tasks.length);
  ui.status(`מריץ ${parsed.tasks.length} תלמידים…`);
  log(`[התחלה] ${parsed.tasks.length} תלמידים · תאריך תחילת לימודים "${startDate() || '(ברירת המחדל של האתר)'}"`);
  await absorbStartRun(parsed.tasks);
}

function stop() {
  ui.status('עוצר…');
  log('⛔ עצירה לבקשת המשתמש');
  absorbStop();
  setRunning(false);
}

function copyTsv() {
  const rows = absorbGetResults().length ? absorbGetResults() : results;
  if (!rows.length) { ui.status('אין תוצאות להעתקה'); return; }
  copyTextToClipboard(buildResultsTsv(rows)).then((ok) => {
    flash(`${P}-tsv`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק לאקסל');
    ui.status(ok ? 'התוצאות הועתקו. הדבק באקסל (Ctrl+V)' : 'ההעתקה נחסמה בדפדפן. השתמש בייצוא CSV');
  });
}

function exportCsv() {
  const rows = absorbGetResults().length ? absorbGetResults() : results;
  if (!rows.length) { ui.status('אין תוצאות לייצוא'); return; }
  const name = `absorptions_${new Date().toISOString().slice(0, 10)}.csv`;
  ui.status(downloadCsv(name, buildResultsCsvRows(rows)) ? `הורד ${name}` : 'הייצוא נכשל');
}

function downloadTemplate() {
  ui.status(downloadCsv('תבנית-קליטת-תלמידים.csv', [ABSORB_TEMPLATE_HEADER.slice()]) ? 'התבנית הורדה. מלא באקסל, ואז העתק את הטורים לכאן או טען את הקובץ' : 'הורדת התבנית נכשלה');
}

function handleXlsx(ev) {
  const input = ev && ev.target;
  const file = input && input.files && input.files[0];
  if (!file) return;
  ui.status('טוען קובץ אקסל…');
  Promise.resolve().then(() => loadXlsxFile(file)).then((text) => {
    const ta = $el(`${P}-input`);
    if (ta) ta.value = text;
    const n = text ? text.split('\n').length : 0;
    ui.status(`נטענו ${n} שורות מהקובץ. בדוק ולחץ "התחל קליטה"`);
    log(`[אקסל] נטענו ${n} שורות מ"${file.name}"`);
    if (awaitingErrorConfirm) resetStartButton();
  }).catch((e) => {
    ui.status('טעינת האקסל נכשלה: ' + ((e && e.message) || 'שגיאה לא ידועה'));
  }).finally(() => { if (input) input.value = ''; });
}

function renderCountries(filter) {
  const q = String(filter || '').trim();
  const names = q ? countryNames.filter((n) => n.includes(q)) : countryNames;
  setHtml(`${P}-countries-list`, names.length
    ? names.map((n) => `<span class="tt-chip" data-name="${esc(n)}" title="לחץ להעתקה">${esc(n)}</span>`).join('')
    : '<div class="tt-empty">אין ארץ שמתאימה לסינון</div>');
}

function toggleCountries() {
  const box = $el(`${P}-countries-box`);
  if (!box) return;
  const open = box.hidden;
  box.hidden = !open;
  if (!open) return;
  renderCountries(($el(`${P}-countries-filter`) || {}).value);
  try { $el(`${P}-countries-filter`).focus(); } catch (e) { /* לא קריטי */ }
}

function copyCountry(e) {
  const chip = e && e.target && typeof e.target.closest === 'function' ? e.target.closest('.tt-chip') : null;
  if (!chip) return;
  const name = chip.getAttribute('data-name') || '';
  if (!name) return;
  copyTextToClipboard(name).then((ok) => ui.status(ok ? `הועתק: ${name}` : `ההעתקה נחסמה בדפדפן. הקלד: ${name}`));
}

function mount(container, panelUi, page) {
  ui = panelUi;
  container.innerHTML = `
    <div class="tt-box tt-box-info">
      <b>טורים כמו באקסל</b> (טאבים או פסיקים, עם שורת כותרת או בלי): סניף · סוג לימוד · ת.ז./דרכון · שם פרטי · שם משפחה · תאריך לידה · ארץ · מגדר · מצב משפחתי.
      חובה: שלושת הראשונים. דרכון: גם תאריך לידה וארץ. תלמיד שאינו מוכר למערכת: גם שם פרטי, שם משפחה ותאריך לידה.
    </div>
    <textarea id="${P}-input" class="tt-textarea" placeholder="01&#9;300&#9;123456789&#10;12&#9;600&#9;AB1234567&#9;&#9;&#9;15/03/1995&#9;צרפת"></textarea>
    <div id="${P}-errors" class="tt-box tt-box-error" hidden></div>
    <div id="${P}-stale" class="tt-box tt-box-warn" hidden></div>
    <div class="tt-row">
      ${fieldHtml('תאריך תחילת לימודים (ריק = ברירת המחדל של האתר)', `<input id="${P}-start-date" class="tt-input tt-mono" type="text" maxlength="10" placeholder="${todayDMY()}">`)}
    </div>
    ${buttonsRowHtml([
      { id: `${P}-start`, label: 'התחל קליטה', kind: 'primary' },
      { id: `${P}-stop`, label: 'עצור', kind: 'danger', title: 'גם מקש Escape עוצר' },
    ])}
    ${buttonsRowHtml([
      { id: `${P}-tsv`, label: 'העתק לאקסל', kind: 'ghost', size: 'small' },
      { id: `${P}-csv`, label: 'ייצוא CSV', kind: 'ghost', size: 'small' },
      { id: `${P}-template`, label: 'תבנית לאקסל', kind: 'ghost', size: 'small' },
      { id: `${P}-xlsx`, label: 'טען מאקסל', kind: 'ghost', size: 'small' },
      { id: `${P}-countries`, label: 'רשימת ארצות', kind: 'ghost', size: 'small' },
    ])}
    <input id="${P}-xlsx-file" type="file" accept=".xlsx,.xls" hidden>
    <div id="${P}-countries-box" class="tt-box tt-box-info" hidden>
      <input id="${P}-countries-filter" class="tt-input" type="text" placeholder="סינון: הקלד חלק מהשם">
      <div id="${P}-countries-list" class="tt-chips"></div>
      <div class="tt-hint">לחיצה על שם מעתיקה אותו. השמות כפי שהם באתר.</div>
    </div>
    <div id="${P}-results" class="tt-scroll"></div>
    <div id="${P}-report" class="tt-box tt-box-warn" hidden></div>`;

  bindDateMask(`${P}-start-date`);
  $el(`${P}-input`).addEventListener('input', () => { if (awaitingErrorConfirm) resetStartButton(); });
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
  $el(`${P}-template`).addEventListener('click', downloadTemplate);
  $el(`${P}-xlsx`).addEventListener('click', () => $el(`${P}-xlsx-file`).click());
  $el(`${P}-xlsx-file`).addEventListener('change', handleXlsx);
  $el(`${P}-countries`).addEventListener('click', toggleCountries);
  $el(`${P}-countries-filter`).addEventListener('input', function () { renderCountries(this.value); });
  $el(`${P}-countries-list`).addEventListener('click', copyCountry);

  absorbSetHooks({
    getStartDate: startDate,
    onStart: (queue, idx) => { total = queue.length; ui.progress(idx, total); setRunning(true); },
    onResume: (queue, res, idx) => {
      total = queue.length; results = res.slice(); renderResults(); ui.progress(idx, total); setRunning(true);
      ui.status(`ממשיך אחרי טעינת דף: ${idx + 1} מתוך ${total}`);
      ui.open();
    },
    onProgress: (idx, tot, task) => { total = tot; ui.progress(idx, tot); ui.status(`מעבד ${idx + 1}/${tot}: סניף ${task.branch} · סוג ${task.studyType} · ${task.identity}`); },
    onResult: (result, all) => { results = all.slice(); renderResults(); ui.progress(all.length, Math.max(total, all.length)); },
    onNavigating: () => { ui.status('ממתין לטעינת דף…'); },
    onStaleQueue: (info) => { setRunning(false); ui.status('יש תור שמור ישן. בחר "המשך" או "נקה"'); renderStaleQueue(info); ui.open(); },
    onDone: (all, report) => {
      results = all.slice(); renderResults(); renderReport(report); setRunning(false); ui.progress(all.length, all.length);
      ui.status(report.lines.length ? `הסתיים. ${report.lines.length} שורות דורשות טיפול (ראה "מה נשאר")` : 'הסתיים. הכול טופל');
    },
  });

  log(`[קליטה] דף ${page.kind}${page.branch ? ` · סניף ${page.branch} [${page.branchSource || '?'}]` : ''}${page.studyType ? ' · סוג ' + page.studyType : ''}`);
  results = absorbGetResults();
  renderResults();
  const saved = absorbSavedQueueInfo();
  if (absorbHasSavedQueue()) ui.status(saved && saved.stale ? 'נמצא תור שמור ישן. בודק…' : 'נמצא תור פתוח. ממשיך…');
  Promise.resolve().then(() => absorbResumeIfPending()).catch((e) => { log('[המשך] כשל: ' + (e && e.message)); setRunning(false); });
}

const absorbTool = {
  id: 'absorb',
  title: 'קליטת תלמידים',
  pages: ['institute', 'studyType', 'newStudent'],
  hasPendingRun: absorbHasSavedQueue,
  isRunning: absorbIsRunning,
  onStop: stop,
  mount,
};

// ─── src/tools/depart-ui.js ───
// לשונית "עזיבת תלמידים" — שלד זמני עד שההעברה מהסקריפט הישן תושלם (המיישם מחליף את הקובץ הזה).
const departTool = {
  id: 'depart',
  title: 'עזיבת תלמידים',
  pages: ['institute'],
  hasPendingRun: () => false,
  isRunning: () => false,
  onStop() {},
  mount(container) {
    container.innerHTML = '<div class="tt-box tt-box-info">הכלי הזה בהעברה לסקריפט המאוחד. בינתיים השתמש בסקריפט הישן.</div>';
  },
};

// ─── src/tools/report-ui.js ───
// לשונית "דיווח חודשי" — שלד זמני עד שההעברה מהסקריפט הישן תושלם (המיישם מחליף את הקובץ הזה).
const reportTool = {
  id: 'report',
  title: 'דיווח חודשי',
  pages: ['institute'],
  hasPendingRun: () => false,
  isRunning: () => false,
  onStop() {},
  mount(container) {
    container.innerHTML = '<div class="tt-box tt-box-info">הכלי הזה בהעברה לסקריפט המאוחד. בינתיים השתמש בסקריפט הישן.</div>';
  },
};

// ─── src/tools/messages-ui.js ───
// לשונית "הודעות" — שלד זמני עד שההעברה מהסקריפט הישן תושלם (המיישם מחליף את הקובץ הזה).
const messagesTool = {
  id: 'messages',
  title: 'הודעות',
  pages: ['messages'],
  hasPendingRun: () => false,
  isRunning: () => false,
  onStop() {},
  mount(container) {
    container.innerHTML = '<div class="tt-box tt-box-info">הכלי הזה בהעברה לסקריפט המאוחד. בינתיים השתמש בסקריפט הישן.</div>';
  },
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
