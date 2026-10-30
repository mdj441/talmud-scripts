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
// "עסוק" = רץ, או שנורה ניווט מלא והריצה ממתינה לטעינת הדף (S.running=false בכוונה, אך אסור להתחיל ריצה חדשה).
function absorbIsBusy() { return S.running || watchdogTimer !== null; }
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
// לשונית "קליטת תלמידים" בחלונית המאוחדת. הזרימה ב-absorb-flow.js; כאן הממשק:
// טבלת-הזנה (שורה לתלמיד, בחירה מרשימות: סניף, סוג לימוד, ארץ; שדות לפי סוג המזהה), הדבקה מאקסל
// שממלאת את הטבלה, טעינת/הורדת אקסל, אימות לכל שורה, התחל/עצור, תוצאות, דוח "מה נשאר".
// מסלול-פרסור אחד: הטבלה → טקסט עם כותרת → parseAbsorbInput (כמו הדבקה). אין גישה ל-document ברמת המודול.


const P = 'tt-absorb';
const COUNTRY_NAMES = COUNTRIES.map((c) => c.he).sort((a, b) => a.localeCompare(b, 'he'));
// סוגי-לימוד מוכרים (מהאתר, סניף 00) לרשימת-הבחירה כשעוד לא נלמדו סוגי הסניף
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

// ─── רשימות-בחירה ──────────────────────────────────────────────────────────
function knownBranches(page) {
  const set = new Set(Object.keys(loadBranchIds()));
  if (page && page.kind === 'institute') for (const b of readBranchesFromTree()) set.add(b);
  if (page && page.branch) set.add(page.branch);
  return Array.from(set).sort();
}

function knownStudyTypes(branch, page) {
  const set = new Set();
  const learned = loadStudyTypeIds();
  for (const key of Object.keys(learned)) if (!branch || key.startsWith(`${branch}|`)) set.add(key.split('|')[1]);
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
  const passport = !!f.identifier && detectIdType(f.identifier).type === 'passport';
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

function fillFromText(text, sourceLabel) {
  const parsedRows = absorbTextToFieldRows(text);
  rows = parsedRows.map((r) => ({ fields: r.fields }));
  const anyExtra = rows.some((r) => r.fields.firstName || r.fields.lastName || r.fields.gender || r.fields.familyStatus);
  if (anyExtra) { showExtra = true; const cb = $el(`${P}-extra`); if (cb) cb.checked = true; }
  const v = renderTable();
  ui.status(`${sourceLabel}: ${v.filled.length} שורות נטענו לטבלה${v.errors.length ? `, ${v.errors.length} עם שגיאה` : ''}. בדוק ולחץ "התחל קליטה"`);
  log(`[קלט] ${sourceLabel}: ${v.filled.length} שורות · ${v.errors.length} שגויות`);
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
  await absorbStartRun(v.tasks);
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
        <span>${buttonHtml({ id: `${P}-tsv`, label: 'העתק תוצאות לאקסל', kind: 'ghost', size: 'small' })} ${buttonHtml({ id: `${P}-csv`, label: 'ייצוא CSV', kind: 'ghost', size: 'small' })}</span></div>
      <div id="${P}-results" class="tt-scroll"></div>
    </div>
    <div id="${P}-report" class="tt-box tt-box-warn" hidden></div>`;

  bindDateMask(`${P}-start-date`);
  $el(`${P}-input`).addEventListener('input', function () { fillFromText(this.value, 'הדבקה'); });
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
  $el(`${P}-template`).addEventListener('click', downloadTemplate);
  $el(`${P}-copy-input`).addEventListener('click', copyInputAsTsv);
  $el(`${P}-xlsx`).addEventListener('click', () => $el(`${P}-xlsx-file`).click());
  $el(`${P}-xlsx-file`).addEventListener('change', handleXlsx);

  absorbSetHooks({
    getStartDate: startDate,
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
    onStaleQueue: (info) => { setRunning(false); ui.status('יש תור שמור ישן. בחר "המשך" או "נקה"'); renderStaleQueue(info); ui.open(); },
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

// שלב 1 (ישן 416-427): לשונית 3 "תלמידים למוסד" דרך ה-TabContainer של האתר.
function departActivateStudentsTab() {
  try {
    if (typeof window === 'undefined' || typeof window.$find !== 'function') return false;
    const tabs = window.$find(DEPART_IDS.tabContainer);
    if (!tabs || typeof tabs.set_activeTabIndex !== 'function') { log('[לשונית] TabContainer לא נמצא'); return false; }
    let active = -1;
    try { active = tabs.get_activeTabIndex(); } catch (e) { /* ignore */ }
    if (active !== DEPART_TAB_INDEX) {
      log('[לשונית] מעבר ללשונית "תלמידים למוסד"');
      tabs.set_activeTabIndex(DEPART_TAB_INDEX);
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
  departActivateStudentsTab();
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
  const how = res.method === 'url' ? `כתובת ידועה${res.hop ? ' (קפיצה לדף מוסד ידוע, ומשם העץ)' : ''}` : res.method === 'tree' ? 'עץ הסניפים' : (res.method || '?');
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

  // לשונית "מצב תמיכה" (חובה לפני השליחה, כמו הישן: קליק צד-לקוח)
  const tab = $el(REPORT_IDS.supportTab);
  if (tab) { try { tab.click(); } catch (e) { /* לא קריטי */ } } else log('[דיווח] לשונית "מצב תמיכה" לא נמצאה; מנסים לשלוח בכל זאת');
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

const MESSAGES_TRANSFER_HEADER = 'בקשת מעבר תלמיד';
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

function messagesFindFilterSelect() {
  if (typeof document === 'undefined') return null;
  for (const s of Array.from(document.querySelectorAll('select'))) {
    const texts = Array.from(s.options).map((o) => messagesFlat(o.text));
    if (texts.includes(MESSAGES_STATUS_SENT) && texts.includes(MESSAGES_STATUS_HANDLED)) return s;
  }
  return null;
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

// פעולה אחת (performActionFast של הישן): סגירת חלונית ישנה → HidMessageRowID → postback → סגירת
// חלונית ההצלחה → אימות מול הגריד (מספר המופעים של ההודעה במצב "נשלחה" צריך לרדת).
async function messagesPerformAction(msg, action) {
  const target = MESSAGES_POSTBACK_TARGETS[action];
  if (!target) return { ok: false, reason: 'פעולה לא מוכרת: ' + action };
  await messagesClosePopupIfOpen('לפני הפעולה');
  const hid = $el(MESSAGES_IDS.hidRowId);
  if (!hid) return { ok: false, reason: 'לא נמצא השדה הנסתר של שורת ההודעה (HidMessageRowID)' };
  const countSent = () => messagesReadPage().filter((m) => m.uid === msg.uid && messagesIsSent(m)).length;
  const before = countSent();
  hid.value = String(msg.rowIndex);
  const res = await firePostback(target, '');
  if (!res.ok) return { ok: false, reason: res.reason || 'הפעולה נכשלה בשרת' };
  if (res.started === false) return { ok: false, reason: 'הלחיצה לא הפעילה בקשה לשרת' };
  const popup = await messagesClosePopupIfOpen('אחרי הפעולה');
  if (before > 0 && countSent() >= before) {
    const why = popup && popup.kind !== 'success' ? `האתר הודיע: "${messagesFlat(popup.text)}"` : 'ההודעה עדיין במצב "נשלחה" אחרי הפעולה';
    return { ok: false, reason: why };
  }
  return { ok: true };
}

// ─── מצב גורף ───────────────────────────────────────────────────────────────

async function messagesRunBulk() {
  if (MSG.running) return null;
  messagesBeginRun('bulk');
  const t0 = Date.now();
  log('[הודעות] ▶ מצב גורף: בקשת מעבר → אישור מעבר; אחרת → סמן כטופל');
  await messagesEnsureSentFilter();
  await messagesGotoFirstPage();
  const failed = new Set();
  let processed = 0, skipped = 0, consecutiveEmpty = 0;
  for (let loops = 0; loops < MESSAGES_MAX_LOOPS && !MSG.stop; loops++) {
    await messagesClosePopupIfOpen('בין פעולות');
    const list = messagesReadPage();
    if (!list.length) { log('[הודעות] אין הודעות בעמוד'); break; }
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
  const seen = new Set();
  let pages = 0;
  for (let i = 0; i < MESSAGES_MAX_SCAN_PAGES && !MSG.stop; i++) {
    pages++;
    const list = messagesReadPage();
    log(`[הודעות] עמוד ${messagesCurrentPage()}: ${list.length} הודעות`);
    for (const m of list) {
      if (!messagesIsSent(m)) continue;
      if (seen.has(m.uid)) continue;
      seen.add(m.uid);
      MSG.scanned.push({ uid: m.uid, header: m.header, personId: m.personId, body: m.body, date: m.date, status: m.status, suggestedAction: messagesSuggestAction(m.header) });
    }
    messagesHook('onStatus', `סריקה: ${pages} עמודים, ${MSG.scanned.length} הודעות`);
    messagesHook('onScanProgress', MSG.scanned.slice(), pages);
    const moved = await messagesGotoNextPage();
    if (!moved) break;
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[הודעות] סריקה הסתיימה${MSG.stop ? ' (נעצר)' : ''}: ${MSG.scanned.length} הודעות מ-${pages} עמודים (${dt} שניות)`);
  MSG.running = false;
  const info = { pages, stopped: MSG.stop };
  messagesHook('onScanDone', MSG.scanned.slice(), info);
  return MSG.scanned.slice();
}

// ─── ביצוע לפי טבלה (שלב ב) ──────────────────────────────────────────────────

async function messagesRunTable(entries) {
  if (MSG.running) return null;
  const pending = new Map();
  for (const e of entries || []) if (e && e.uid) pending.set(e.uid, e.action);
  if (!pending.size) { log('[הודעות] אין טבלה טעונה'); return null; }
  messagesBeginRun('table');
  const t0 = Date.now();
  let toDo = 0;
  for (const a of pending.values()) if (a !== MESSAGES_ACTION.SKIP) toDo++;
  log(`[הודעות] ▶ ביצוע לפי טבלה: ${toDo} פעולות מתוך ${pending.size} שורות`);
  await messagesEnsureSentFilter();
  await messagesGotoFirstPage();
  const handled = new Set();
  let processed = 0, failedCount = 0, consecutiveEmpty = 0;
  for (let loops = 0; loops < MESSAGES_MAX_LOOPS && !MSG.stop; loops++) {
    await messagesClosePopupIfOpen('בין פעולות');
    const list = messagesReadPage();
    if (!list.length) break;
    let target = null, targetAction = null;
    for (const m of list) {
      if (handled.has(m.uid)) continue;
      const action = pending.get(m.uid);
      if (!action) continue;
      if (action === MESSAGES_ACTION.SKIP) {
        handled.add(m.uid);
        messagesRecord(m, MESSAGES_ACTION.SKIP, MESSAGES_RESULT.SKIPPED);
        continue;
      }
      target = m;
      targetAction = action;
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
    if (res.ok) {
      processed++;
      messagesRecord(target, targetAction, MESSAGES_RESULT.DONE);
      log(`[הודעות] ✓ ${Date.now() - t1}ms · ${targetAction} · ${maskId(target.personId) || '-'}`);
    } else {
      failedCount++;
      messagesRecord(target, targetAction, MESSAGES_RESULT.FAILED_PREFIX + res.reason);
      log(`[הודעות] ✗ ${res.reason} · ${target.header} · ${maskId(target.personId) || '-'}`);
    }
    messagesHook('onProgress', processed + failedCount, toDo);
  }
  const notFound = [];
  for (const [uid, action] of pending.entries()) if (action !== MESSAGES_ACTION.SKIP && !handled.has(uid)) notFound.push({ uid, action });
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
// לשונית "הודעות" בחלונית המאוחדת. הזרימה ב-messages.js; כאן רק הממשק: שני מצבים (גורף / לפי טבלה),
// סריקה → טבלה → העתקה/הורדה לאקסל → הדבקה → טעינה → ביצוע, טבלת-תוצאות, דוח "מה נשאר", "העתק דוח".
// הלשונית מופיעה בדפי 'other' (getPage לא מכיר את דף ההודעות); ב-mount בודקים את הכתובת.
// אין גישה ל-document ברמת המודול.


const MP = 'tt-messages';
let msgUi = null;
let msgMode = 'bulk';
let msgPending = [];
let msgResults = [];

const MESSAGES_SCAN_COLUMNS = [
  { key: 'uid', label: 'UID', mono: true, width: '84px' },
  { key: 'header', label: 'נושא' },
  { key: 'personId', label: 'ת.ז./דרכון', mono: true },
  { key: 'date', label: 'תאריך', center: true },
  { key: 'suggestedAction', label: 'פעולה מוצעת' },
];

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

function messagesRenderScanned(list) {
  const rows = (list || []).map((r) => Object.assign({}, r, { detail: r.body }));
  setHtml(`${MP}-scanned`, resultsTableHtml({ columns: MESSAGES_SCAN_COLUMNS, rows, emptyText: '' }));
}

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
  for (const id of ['bulk-run', 'scan', 'load', 'run-table']) setDisabled(`${MP}-${id}`, !!on);
  if (!on) setDisabled(`${MP}-run-table`, !msgPending.length);
  msgUi.running(!!on);
}

function messagesSetMode(mode) {
  msgMode = mode === 'table' ? 'table' : 'bulk';
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
    messagesSetMode('table');
    msgUi.status('ההעתקה נחסמה בדפדפן. הדוח הוצג בתיבת הטקסט להעתקה ידנית');
  });
}

function messagesMount(container, panelUi, page) {
  msgUi = panelUi;
  const url = (page && page.url) || (typeof location !== 'undefined' ? location.href : '');
  if (!messagesIsMessagesUrl(url)) {
    container.innerHTML = '<div class="tt-box tt-box-info">הכלי עובד בדף ההודעות בלבד.</div>';
    return;
  }
  container.innerHTML = `
    <div class="tt-row">
      ${buttonHtml({ id: `${MP}-mode-bulk`, label: 'מצב גורף', kind: 'primary' })}
      ${buttonHtml({ id: `${MP}-mode-table`, label: 'לפי טבלה', kind: 'ghost' })}
    </div>
    <div id="${MP}-bulk">
      <div class="tt-box tt-box-warn">
        עובר על <b>כל ההודעות</b> במצב "נשלחה", בכל העמודים:
        <ul>
          <li>"${esc('בקשת מעבר תלמיד')}": <b>אישור מעבר</b></li>
          <li>כל הודעה אחרת: <b>שנה מצב הודעה לטופל</b></li>
        </ul>
        "דחיית מעבר" לא נלחץ אוטומטית. לדחייה השתמש ב"לפי טבלה".
      </div>
      ${buttonsRowHtml([{ id: `${MP}-bulk-run`, label: 'הפעל מצב גורף', kind: 'primary' }])}
    </div>
    <div id="${MP}-table" hidden>
      <div class="tt-box tt-box-info">
        <b>שלב א</b>: "סרוק" עובר על כל ההודעות במצב "נשלחה" ובונה טבלה; "העתק לאקסל" או "הורד אקסל".
        <b>שלב ב</b>: ערוך באקסל את עמודת "פעולה" (${esc(MESSAGES_ALL_ACTIONS.join(' / '))}), הדבק כאן, "טען" ואז "בצע".
        אל תשנה את עמודת UID.
      </div>
      ${buttonsRowHtml([
        { id: `${MP}-scan`, label: 'סרוק', kind: 'primary' },
        { id: `${MP}-copy-tsv`, label: 'העתק לאקסל', kind: 'ghost' },
        { id: `${MP}-xlsx`, label: 'הורד אקסל', kind: 'ghost' },
      ])}
      <div id="${MP}-scan-status" class="tt-hint">לא בוצעה סריקה.</div>
      <div id="${MP}-scanned" class="tt-scroll"></div>
      <textarea id="${MP}-input" class="tt-textarea" placeholder="UID&#9;נושא&#9;ת.ז./דרכון&#9;תאריך&#9;גוף ההודעה&#9;פעולה"></textarea>
      ${buttonsRowHtml([
        { id: `${MP}-load`, label: 'טען', kind: 'ghost' },
        { id: `${MP}-run-table`, label: 'בצע', kind: 'primary', disabled: true },
      ])}
      <div id="${MP}-load-status" class="tt-hint">טבלה לא טעונה.</div>
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
      msgUi.status(mode === 'scan' ? 'סורק…' : mode === 'bulk' ? 'מצב גורף רץ…' : 'מבצע לפי טבלה…');
    },
    onStatus: (msg) => msgUi.status(msg),
    onProgress: (cur, total) => msgUi.progress(cur, total),
    onResult: (row, all) => { msgResults = all; messagesRenderResults(); },
    onScanProgress: (list, pages) => setText(`${MP}-scan-status`, `סריקה: ${pages} עמודים, ${list.length} הודעות עד כה…`),
    onScanDone: (list, info) => {
      messagesRenderScanned(list);
      setText(`${MP}-scan-status`, `✓ נסרקו ${list.length} הודעות מ-${info.pages} עמודים${info.stopped ? ' (נעצר)' : ''}.`);
      messagesSetRunning(false);
      msgUi.status(list.length ? `נסרקו ${list.length} הודעות. "העתק לאקסל" או "הורד אקסל", ערוך את עמודת "פעולה" והדבק חזרה` : 'לא נמצאו הודעות במצב "נשלחה"');
    },
    onDone: (rows, report) => {
      msgResults = rows;
      messagesRenderResults();
      messagesRenderReport(report);
      messagesSetRunning(false);
      msgUi.progress(0, 0);
      msgUi.status(`${report.stopped ? 'נעצר' : 'הסתיים'}. ${report.summary}${report.lines.length ? ' (ראה "מה נשאר")' : ''}`);
    },
  });

  messagesSetMode(msgMode);
  msgResults = messagesGetReportRows();
  messagesRenderResults();
  messagesRenderScanned(messagesGetScanned());
  log('[הודעות] דף ההודעות זוהה');
  msgUi.status('מוכן. בחר מצב: גורף או לפי טבלה');
}

const messagesTool = {
  id: 'messages',
  title: 'הודעות',
  pages: ['other'],
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
