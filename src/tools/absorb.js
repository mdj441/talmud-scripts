// זרימת קליטת תלמידים v3.3 — פורט מ"תלמוד - קליטת תלמידים" v3.2
// (analyzeGrid:197, processStudent:314, processStudentSafe:506, runQueue:563), עם:
// ניווט-גריד במקום עץ (navigate.js), טיפול ב-ucMessagePopUp (popup.js), ענף תלמיד-חדש
// (לכידה-03), וריפוד אפסים בשלושת המקומות (חיפוש / מילוי / אימות).
// אין גישה ל-document/window/sessionStorage ברמת המודול — רק בתוך גופי הפונקציות.

import { $el, isVisible, sleep, waitFor } from '../core/dom.js';
import { firePostback, waitPRM } from '../core/prm.js';
import { readMessagePopup, hideMessagePopup } from '../core/popup.js';
import { log, maskId, maskIdsInText } from '../core/log.js';
import { padId9 } from '../core/identity.js';
import { getPage, gotoStudyTypeFromInstitute, gotoBranch, parsePostbackHref } from '../core/navigate.js';

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
const ABSORB_NAVIGATED = { __navigated: true }; // סימן ל-runQueue: הדף נטען מחדש, resume ימשיך

// ─── סטטוסים (קבוצה קטנה וסגורה — הדוח/הטבלה מקבצים לפיה) ───────────────────

export const ABSORB_STATUS = {
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

export const ABSORB_TSV_HEADER = ['סניף', 'סוג לימוד', 'ת.ז./דרכון', 'סטטוס', 'מה לעשות'];
export const ABSORB_CSV_HEADER = ['סניף', 'סוג לימוד', 'ת.ז./דרכון', 'סטטוס', 'פירוט', 'מה לעשות'];
export const ABSORB_TEMPLATE_HEADER = ['סניף', 'סוג לימוד', 'ת.ז./דרכון', 'שם פרטי', 'שם משפחה', 'תאריך לידה', 'ארץ', 'מגדר', 'מצב משפחתי'];

// ─── פונקציות טהורות (נבדקות ביחידה) ────────────────────────────────────────

// "נחסם: <טקסט ההודעה>" → "נחסם". שאר הסטטוסים חוזרים כמו שהם.
export function absorbStatusKey(status) {
  const s = String(status == null ? '' : status);
  const i = s.indexOf(':');
  return (i === -1 ? s : s.slice(0, i)).trim();
}

export function isAbsorbSuccess(status) {
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
export function analyzeGrid(rows, identity) {
  const none = { found: false, matchType: null };
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
  if (dataRows === 1) return { found: true, matchType: 'single-row-fallback' };
  return none;
}

function absorbFlatCell(value) {
  return String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ').trim();
}

// TSV להדבקה ישירה לאקסל (טאבים + כותרת), 5 עמודות בכל שורה.
export function buildResultsTsv(results) {
  const lines = [ABSORB_TSV_HEADER.join('\t')];
  for (const r of Array.isArray(results) ? results : []) {
    lines.push([r.branch, r.studyType, r.identity, r.status, r.action].map(absorbFlatCell).join('\t'));
  }
  return lines.join('\n');
}

// CSV (מערך-שורות ל-toCsv) — כולל עמודת פירוט, שאין לה מקום ב-TSV הקצר.
export function buildResultsCsvRows(results) {
  const rows = [ABSORB_CSV_HEADER.slice()];
  for (const r of Array.isArray(results) ? results : []) {
    rows.push([r.branch, r.studyType, r.identity, r.status, r.detail || '', r.action || '']);
  }
  return rows;
}

export function summarizeAbsorbResults(results) {
  const counts = {};
  for (const r of Array.isArray(results) ? results : []) {
    const key = absorbStatusKey(r && r.status) || '—';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// דוח "מה נשאר": שורה אופרטיבית לכל תוצאה שאינה הצלחה + סיכום ספירות.
export function buildRemainingReport(results) {
  const list = Array.isArray(results) ? results : [];
  const counts = summarizeAbsorbResults(list);
  const lines = list
    .filter((r) => !isAbsorbSuccess(r && r.status))
    .map((r) => [r.branch, r.studyType, r.identity, r.status, r.action || '—'].map(absorbFlatCell).join(' · '));
  const summary = Object.keys(counts).map((k) => `${k}=${counts[k]}`).join(' · ');
  return { lines, summary, counts };
}

// טהורה: href של LinkButton. תומכת גם ב-__doPostBack ישיר וגם ב-WebForm_DoPostBackWithOptions
// (כך נבנים LinkButton1 בקליטה ו-btnSave בתלמיד-חדש — לכידה-02 §3 / לכידה-03 §2).
export function absorbParsePostbackFromHref(href) {
  const direct = parsePostbackHref(href);
  if (direct) return { target: direct.target, arg: direct.arg, group: '', validate: false };
  const m = /WebForm_PostBackOptions\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(true|false)\s*,\s*"([^"]*)"/.exec(String(href || ''));
  if (m) return { target: m[1], arg: m[2], group: m[4], validate: m[3] === 'true' };
  return null;
}

// ─── עצירה (sessionStorage — שורד reload; v3.2: STOP_KEY) ───────────────────

export function absorbIsStopped() {
  try { return sessionStorage.getItem(ABSORB_STOP_KEY) === '1'; } catch (e) { return false; }
}

export function requestAbsorbStop() {
  try { sessionStorage.setItem(ABSORB_STOP_KEY, '1'); } catch (e) { /* אצווה לא נתקעת */ }
  log('⛔ בקשת עצירה');
}

export function clearAbsorbStop() {
  try { sessionStorage.removeItem(ABSORB_STOP_KEY); } catch (e) { /* אצווה לא נתקעת */ }
}

function absorbStopError(where) { return new Error(ABSORB_STOP_PREFIX + where); }
function isAbsorbStopError(err) {
  return !!err && typeof err.message === 'string' && err.message.indexOf(ABSORB_STOP_PREFIX) === 0;
}

// נקודת-בדיקה בכל גבול-שלב.
export function checkStop(where) {
  if (absorbIsStopped()) throw absorbStopError(where);
}

async function sleepCheckStop(ms) {
  let left = ms;
  while (left > 0) {
    checkStop('sleep');
    const step = Math.min(100, left);
    await sleep(step);
    left -= step;
  }
  checkStop('sleep');
}

// ─── מצב התור (resume אחרי ניווט מלא) ───────────────────────────────────────

let absorbQueue = [];
let absorbResults = [];
let absorbCurIdx = 0;
let absorbRunning = false;
let absorbStartedAt = null;
let absorbHooks = {};
let absorbJustSavedNewStudent = null;

export function absorbSetHooks(hooks) { absorbHooks = hooks || {}; }
export function absorbGetResults() { return absorbResults.slice(); }
export function absorbGetProgress() { return { curIdx: absorbCurIdx, total: absorbQueue.length }; }
export function absorbIsRunning() { return absorbRunning; }

export function saveAbsorbState(extra) {
  const state = {
    queue: absorbQueue, results: absorbResults, curIdx: absorbCurIdx,
    startedAt: absorbStartedAt || new Date().toISOString(),
  };
  if (extra) Object.assign(state, extra);
  try { sessionStorage.setItem(ABSORB_QUEUE_KEY, JSON.stringify(state)); } catch (e) { log('[מצב] שמירה נכשלה: ' + (e && e.message)); }
}

export function loadAbsorbState() {
  try {
    const raw = sessionStorage.getItem(ABSORB_QUEUE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

export function clearAbsorbState() {
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

function readAbsorbGridRows() {
  const grid = $el(ABSORB_IDS.grid);
  if (!grid || typeof grid.querySelectorAll !== 'function') return [];
  return Array.from(grid.querySelectorAll('tr')).map(
    (tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim())
  );
}

function readAbsorbCount() {
  const el = $el(ABSORB_IDS.countLabel);
  return el ? (el.textContent || '').trim() : '';
}

async function absorbSearch(input, btn, value) {
  absorbSetValue(input, value);
  await sleepCheckStop(150);
  const res = await absorbFireElement(btn, { startTimeoutMs: 3000, totalTimeoutMs: 20000 });
  await sleepCheckStop(350);
  log(`[חיפוש] ${maskId(value)} → ${readAbsorbCount() || '(ללא תווית ספירה)'}`);
  return res;
}

async function absorbCloseAcceptModal() {
  try {
    const cancel = $el(ABSORB_IDS.cancelBtn);
    if (!cancel || !isVisible($el(ABSORB_IDS.modal))) return false;
    await absorbFireElement(cancel, { startTimeoutMs: 1500, totalTimeoutMs: 15000 });
    await sleep(300);
    return true;
  } catch (e) {
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

// ניווט מלא: הדף ייטען מחדש ולכן שומרים את מצב ההמשך *לפני* הקריאה (navigate.js §gotoBranch).
async function absorbNavigateToBranch(branch) {
  saveAbsorbState();
  const res = await gotoBranch(branch);
  if (res && res.ok === false) return { ok: false, reason: res.reason };
  return { ok: true };
}

async function absorbEnsureStudyTypePage(task) {
  const branch = String(task.branch).padStart(2, '0');
  const studyType = String(task.studyType);
  const page = getPage();

  if (page.kind === 'studyType' && page.branch === branch && page.studyType === studyType) {
    return { ok: true, navigated: false };
  }

  if (page.kind === 'institute' && page.branch === branch) {
    log(`[ניווט] דף מוסד ${branch} → סוג לימוד ${studyType}`);
    const res = await gotoStudyTypeFromInstitute(studyType);
    if (!res || !res.ok) return { ok: false, navigated: false, reason: (res && res.reason) || 'ניווט לסוג הלימוד נכשל' };
    await sleepCheckStop(500);
    const after = getPage();
    if (after.kind === 'studyType' && after.studyType === studyType) return { ok: true, navigated: false };
    return { ok: false, navigated: false, reason: `אחרי הניווט לא הגענו לסוג לימוד ${studyType} (דף נוכחי: ${after.kind})` };
  }

  log(`[ניווט] ניווט מלא לסניף ${branch} (דף נוכחי: ${page.kind})`);
  const nav = await absorbNavigateToBranch(branch);
  if (!nav.ok) return { ok: false, navigated: false, reason: nav.reason };
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
async function absorbWaitConfirmOutcome(prmWait, timeoutMs) {
  let prmResult = null;
  prmWait.then((r) => { prmResult = r || { ok: true }; }, () => { prmResult = { ok: false, reason: 'postback' }; });
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    checkStop('confirm-wait');
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

async function absorbHandleNewStudentPage(task, identity, mk) {
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
    absorbRecordResult(res); // נרשם *לפני* הניווט המלא, אחרת ייעלם ב-reload
    await absorbNavigateToBranch(String(task.branch).padStart(2, '0'));
    return ABSORB_NAVIGATED;
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
  await sleepCheckStop(200);
  checkStop('new-student-before-save');

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
  saveAbsorbState({ pendingSave: { idx: absorbCurIdx, identity } });
  log('[תלמיד חדש] שמירה…');
  const wait = absorbFireElement(saveBtn, { startTimeoutMs: 3000, totalTimeoutMs: 30000 });
  await absorbWaitConfirmOutcome(wait, 8000);
  await sleepCheckStop(400);

  const pop = readMessagePopup();
  if (pop) {
    log(`[הודעה] אחרי שמירת תלמיד חדש: ${maskIdsInText(pop.text)}`);
    hideMessagePopup();
    if (pop.hasContinue) {
      return mk(`${ABSORB_STATUS.BLOCKED}: ${pop.text}`, pop.text,
        'המערכת מבקשת אישור "המשך" בשמירת התלמיד — הסקריפט לא מאשר לבד; השלם ידנית');
    }
    await sleepCheckStop(300);
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
      await absorbSearch(input, btn, identity);
      if (analyzeGrid(readAbsorbGridRows(), identity).found) return mk(ABSORB_STATUS.OK_NEW, '', '');
    }
  }
  return mk(ABSORB_STATUS.SAVED_UNVERIFIED, 'התלמיד נשמר; הקליטה לא אומתה בגריד',
    'ודא ברשימת התלמידים של סוג הלימוד שהתלמיד נקלט');
}

// ─── עיבוד תלמיד יחיד (7 השלבים של הבריף) ───────────────────────────────────

export async function processStudent(task) {
  // ריפוד אפסים (1/3): מקור אחד לכל השלושה — חיפוש, מילוי במודאל, אימות בגריד.
  const identity = task.idType === 'tz' ? padId9(task.identity) : String(task.identity).trim();
  const mk = (status, detail, action) => ({
    line: task.line, branch: task.branch, studyType: task.studyType,
    idType: task.idType, identity,
    status, detail: detail || '', action: action || '',
  });

  log(`▶ סניף ${task.branch} · סוג ${task.studyType} · ${maskId(identity)} · ${task.idType === 'passport' ? 'דרכון' : 'ת.ז.'}`);
  checkStop('start');

  // נחתנו כבר בדף תלמיד-חדש (resume אחרי ניווט מלא מ-LinkButton1) — לשם ישר.
  if (getPage().kind === 'newStudent') {
    if (absorbNewStudentPageMatches(identity)) return await absorbHandleNewStudentPage(task, identity, mk);
    log('[תלמיד חדש] הדף שייך למזהה אחר — יוצאים ממנו');
    const nav = await absorbNavigateToBranch(String(task.branch).padStart(2, '0'));
    if (!nav.ok) return mk(ABSORB_STATUS.ERROR, nav.reason, 'נווט ידנית לסניף והרץ שוב');
    return ABSORB_NAVIGATED;
  }

  // דרישות מוקדמות לדרכון — נבדקות לפני כל postback.
  if (task.idType === 'passport') {
    if (!task.birthDate) return mk(ABSORB_STATUS.ERROR, 'דרכון ללא תאריך לידה', 'הוסף עמודת "תאריך לידה" (DD/MM/YYYY) לשורה זו');
    if (!task.countryValue) return mk(ABSORB_STATUS.ERROR, `ארץ דרכון חסרה/לא מוכרת: "${task.country || 'ריק'}"`, 'תקן את עמודת "ארץ" לשם ארץ מהרשימה');
  }

  // ── שלב 1: הדף הנכון ──────────────────────────────────────────────────────
  const nav = await absorbEnsureStudyTypePage(task);
  if (nav.navigated) return ABSORB_NAVIGATED;
  if (!nav.ok) return mk(ABSORB_STATUS.ERROR, nav.reason, 'בדוק שסוג הלימוד קיים בסניף (ושאינו "סגור"), או בצע ידנית');
  checkStop('after-nav');
  absorbActivateStudentsTab();
  await sleepCheckStop(300);

  // ── שלב 2: חיפוש מקדים + analyzeGrid ─────────────────────────────────────
  const searchInput = $el(ABSORB_IDS.searchInput);
  const searchBtn = $el(ABSORB_IDS.searchBtn);
  if (!searchInput || !searchBtn) {
    return mk(ABSORB_STATUS.ERROR, 'שדה/כפתור החיפוש ברשימת התלמידים לא נמצאו', 'פתח את הטאב "רשימת תלמידים" ורענן; ייתכן שאין הרשאה');
  }
  const pre = await absorbSearch(searchInput, searchBtn, identity); // ריפוד (2/3)
  if (!pre.ok) throw new Error('חיפוש מקדים נכשל: ' + pre.reason);

  const preGrid = analyzeGrid(readAbsorbGridRows(), identity);
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
  checkStop('after-precheck');

  // ── שלב 3: כפתור "קליטה" + הודעת מערכת ───────────────────────────────────
  const absorbBtn = $el(ABSORB_IDS.absorbBtn);
  if (!absorbBtn) {
    return mk(ABSORB_STATUS.ERROR, `כפתור "קליטה" (${ABSORB_IDS.absorbBtn}) לא נמצא`, 'בדוק הרשאות ומצב זכאות של סוג הלימוד; בצע ידנית');
  }
  const absorbClick = await absorbFireElement(absorbBtn, { startTimeoutMs: 3000, totalTimeoutMs: 20000 });
  if (!absorbClick.ok) log(`[קליטה] postback לא תקין: ${absorbClick.reason}`);
  await sleepCheckStop(400);

  let popupDetail = '';
  const popAfterOpen = readMessagePopup();
  if (popAfterOpen) {
    popupDetail = popAfterOpen.text;
    log(`[הודעה] אחרי "קליטה": ${maskIdsInText(popAfterOpen.text)}`);
    hideMessagePopup();
    if (popAfterOpen.hasContinue) {
      return mk(`${ABSORB_STATUS.BLOCKED}: ${popAfterOpen.text}`, popAfterOpen.text,
        'המערכת מבקשת אישור "המשך" — הסקריפט לא מאשר לבד. בצע את הקליטה ידנית ובדוק את ההודעה');
    }
    await sleepCheckStop(300);
  }
  checkStop('after-absorb-click');

  // ── שלב 4: מודאל הקליטה — מילוי ──────────────────────────────────────────
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
    await sleepCheckStop(200);
  }

  const modalId = $el(ABSORB_IDS.modalId);
  if (!modalId) return mk(ABSORB_STATUS.ERROR, 'שדה המזהה במודאל הקליטה לא נמצא', 'בצע את הקליטה ידנית');
  absorbSetValue(modalId, identity); // ריפוד (3/3)
  await sleepCheckStop(150);

  if (task.idType === 'passport') {
    const birthEl = $el(ABSORB_IDS.birthDate);
    if (!birthEl) return mk(ABSORB_STATUS.ERROR, 'שדה תאריך לידה במודאל לא נמצא', 'בצע את הקליטה ידנית');
    absorbSetValue(birthEl, task.birthDate);
    await sleepCheckStop(150);

    const countryEl = $el(ABSORB_IDS.countryDdl);
    if (!countryEl) return mk(ABSORB_STATUS.ERROR, 'שדה ארץ דרכון במודאל לא נמצא', 'בצע את הקליטה ידנית');
    const options = Array.from(countryEl.options || []);
    if (!options.some((o) => o.value === task.countryValue)) {
      return mk(ABSORB_STATUS.ERROR, `הארץ "${task.country}" (קוד ${task.countryValue}) לא קיימת ברשימת האתר`, 'תקן את עמודת "ארץ" לשם ארץ מהרשימה');
    }
    absorbSetSelect(countryEl, task.countryValue);
    await sleepCheckStop(200);
    if (countryEl.value !== task.countryValue) {
      return mk(ABSORB_STATUS.ERROR, `בחירת הארץ "${task.country}" נכשלה`, 'בחר את הארץ ידנית בחלון הקליטה');
    }
  }

  const startDate = absorbStartDate();
  if (startDate) {
    const startEl = $el(ABSORB_IDS.startDate);
    if (startEl && startEl.value !== startDate) absorbSetValue(startEl, startDate);
  }
  checkStop('after-fields');

  // ── שלב 5: אישור (LinkButton1) ───────────────────────────────────────────
  const confirmBtn = $el(ABSORB_IDS.confirmBtn);
  if (!confirmBtn) return mk(ABSORB_STATUS.ERROR, 'כפתור אישור (LinkButton1) לא נמצא במודאל', 'בצע את הקליטה ידנית');
  const confirmPb = absorbParsePostbackFromHref(confirmBtn.getAttribute('href') || '');
  if (confirmPb && confirmPb.validate) {
    const v = absorbRunClientValidation(confirmPb.group);
    if (!v.ok) {
      await absorbCloseAcceptModal();
      return mk(ABSORB_STATUS.ERROR, 'ולידציה בחלון הקליטה: ' + (v.messages.join(' | ') || 'שדה לא תקין'), 'תקן את הנתונים בשורה (מזהה/תאריך/ארץ) והרץ שוב');
    }
  }

  saveAbsorbState(); // ייתכן ניווט מלא לדף תלמיד-חדש (לכידה-03) — מצב ההמשך נשמר לפני
  const confirmWait = absorbFireElement(confirmBtn, { startTimeoutMs: 3000, totalTimeoutMs: 25000 });
  const outcome = await absorbWaitConfirmOutcome(confirmWait, 8000);
  log(`[אישור] תוצאה: ${outcome.kind}`);

  // ── שלב 6: דף תלמיד-חדש? ─────────────────────────────────────────────────
  if (outcome.kind === 'newStudent') {
    if (absorbNewStudentPageMatches(identity)) return await absorbHandleNewStudentPage(task, identity, mk);
    log('[תלמיד חדש] דף תלמיד-חדש עם מזהה אחר — יוצאים בלי לשמור');
    const res = mk(ABSORB_STATUS.ERROR, 'נחתנו בדף תלמיד-חדש שאינו של המזהה הזה', 'בדוק ידנית מה קרה בקליטה של שורה זו');
    absorbRecordResult(res);
    await absorbNavigateToBranch(String(task.branch).padStart(2, '0'));
    return ABSORB_NAVIGATED;
  }

  // ── שלב 7: הודעת מערכת → מודאל → אימות בגריד ─────────────────────────────
  await sleepCheckStop(400);
  const popAfterConfirm = readMessagePopup();
  if (popAfterConfirm) {
    log(`[הודעה] אחרי אישור: ${maskIdsInText(popAfterConfirm.text)}`);
    hideMessagePopup();
    if (popAfterConfirm.hasContinue) {
      return mk(`${ABSORB_STATUS.BLOCKED}: ${popAfterConfirm.text}`, popAfterConfirm.text,
        'המערכת מבקשת אישור "המשך" (למשל מעבר בין מוסדות) — הסקריפט לא מאשר לבד. השלם ידנית');
    }
    popupDetail = popAfterConfirm.text;
    await sleepCheckStop(300);
  }

  if (isVisible($el(ABSORB_IDS.modal))) {
    const errs = absorbCollectValidationMessages();
    await absorbCloseAcceptModal();
    return mk(ABSORB_STATUS.NOT_COMPLETED, errs.join(' | ') || popupDetail || 'חלון הקליטה נשאר פתוח',
      'פתח את חלון הקליטה ידנית, בדוק את הודעת השגיאה והשלם');
  }
  checkStop('before-verify');

  const verifyInput = $el(ABSORB_IDS.searchInput);
  const verifyBtn = $el(ABSORB_IDS.searchBtn);
  if (!verifyInput || !verifyBtn) {
    return mk(ABSORB_STATUS.SAVED_UNVERIFIED, popupDetail || 'שדות החיפוש נעלמו אחרי הקליטה', 'ודא ידנית ברשימת התלמידים שהתלמיד נקלט');
  }
  await absorbSearch(verifyInput, verifyBtn, identity); // ריפוד באימות
  const verify = analyzeGrid(readAbsorbGridRows(), identity);
  if (verify.found) {
    log('◀ נקלט');
    return mk(ABSORB_STATUS.OK, popupDetail || (verify.matchType === 'single-row-fallback' ? 'התאמה לפי שורה יחידה בגריד' : ''), '');
  }
  log('◀ לא אומת בגריד');
  return mk(ABSORB_STATUS.UNVERIFIED, popupDetail || 'לא נמצא בגריד אחרי הקליטה', 'בדוק ידנית ברשימת התלמידים; ייתכן שהקליטה נכשלה');
}

// ─── עטיפה בטוחה: timeout + ניסיון חוזר אחד ─────────────────────────────────

function absorbWithTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`תהליך תקוע — חרג מ-${Math.round(ms / 1000)} שניות`)), ms);
    const stopPoller = setInterval(() => {
      if (absorbIsStopped()) { clearInterval(stopPoller); clearTimeout(timer); reject(absorbStopError('timeout-poller')); }
    }, 200);
    promise.then(
      (val) => { clearTimeout(timer); clearInterval(stopPoller); resolve(val); },
      (err) => { clearTimeout(timer); clearInterval(stopPoller); reject(err); }
    );
  });
}

export async function processStudentSafe(task) {
  const errResult = (detail) => ({
    line: task.line, branch: task.branch, studyType: task.studyType,
    idType: task.idType, identity: task.idType === 'tz' ? padId9(task.identity) : task.identity,
    status: ABSORB_STATUS.ERROR, detail,
    action: 'בצע את השורה הזו ידנית באתר, וצרף את הלוג אם חוזר',
  });

  try {
    return await absorbWithTimeout(processStudent(task), ABSORB_STUDENT_TIMEOUT_MS);
  } catch (err) {
    if (isAbsorbStopError(err)) throw err;
    log(`[ניסיון 1] נכשל: ${err && err.message}`);
    await absorbCloseAcceptModal();
    if (absorbIsStopped()) throw absorbStopError('between-attempts');
    try {
      await sleep(1000);
      log(`[ניסיון 2] ${maskId(task.identity)}`);
      return await absorbWithTimeout(processStudent(task), ABSORB_STUDENT_TIMEOUT_MS);
    } catch (err2) {
      if (isAbsorbStopError(err2)) throw err2;
      log(`[ניסיון 2] נכשל: ${err2 && err2.message} — מדלגים`);
      await absorbCloseAcceptModal();
      return errResult(`2 ניסיונות: ${err2 && err2.message}`);
    }
  }
}

// ─── התור ────────────────────────────────────────────────────────────────────

function absorbRecordResult(result) {
  absorbResults.push(result);
  absorbCurIdx++;
  saveAbsorbState();
  try { if (absorbHooks.onResult) absorbHooks.onResult(result, absorbResults); } catch (e) { /* אצווה לא נתקעת */ }
}

function absorbFillRemaining(status, detail, action) {
  while (absorbCurIdx < absorbQueue.length) {
    const t = absorbQueue[absorbCurIdx];
    absorbResults.push({
      line: t.line, branch: t.branch, studyType: t.studyType, idType: t.idType,
      identity: t.idType === 'tz' ? padId9(t.identity) : t.identity,
      status, detail: detail || '', action: action || '',
    });
    absorbCurIdx++;
  }
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

export async function runQueue() {
  absorbRunning = true;
  log(`🚀 ריצה — ${absorbQueue.length} תלמידים, מתחילים באינדקס ${absorbCurIdx}`);
  try { if (absorbHooks.onStart) absorbHooks.onStart(absorbQueue, absorbCurIdx); } catch (e) { /* noop */ }

  while (absorbCurIdx < absorbQueue.length) {
    if (absorbIsStopped()) {
      log('⛔ נעצר — ממלאים את שארית התור');
      absorbFillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
      break;
    }
    const task = absorbQueue[absorbCurIdx];
    try { if (absorbHooks.onProgress) absorbHooks.onProgress(absorbCurIdx, absorbQueue.length, task); } catch (e) { /* noop */ }

    let result;
    try {
      result = await processStudentSafe(task);
    } catch (stopErr) {
      log(`⛔ נעצר באמצע עיבוד: ${stopErr && stopErr.message}`);
      absorbRecordResult({
        line: task.line, branch: task.branch, studyType: task.studyType, idType: task.idType,
        identity: task.idType === 'tz' ? padId9(task.identity) : task.identity,
        status: ABSORB_STATUS.STOPPED, detail: 'נעצר באמצע עיבוד', action: 'בדוק את מצב התלמיד באתר והרץ שוב את השורה',
      });
      absorbFillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
      break;
    }

    if (result === ABSORB_NAVIGATED || (result && result.__navigated)) {
      absorbRunning = false;
      log('… ניווט מלא — ההמשך יקרה אחרי טעינת הדף');
      return;
    }
    absorbRecordResult(result);
    await sleep(300);
  }

  absorbFinishRun();
}

// מתחיל ריצה חדשה מרשימת משימות (Task מ-parseAbsorbInput).
export async function absorbStartRun(tasks) {
  clearAbsorbStop();
  absorbQueue = Array.isArray(tasks) ? tasks.slice() : [];
  absorbResults = [];
  absorbCurIdx = 0;
  absorbStartedAt = new Date().toISOString();
  absorbJustSavedNewStudent = null;
  saveAbsorbState();
  return runQueue();
}

export function absorbHasSavedQueue() {
  const st = loadAbsorbState();
  return !!(st && Array.isArray(st.queue) && st.queue.length && (st.curIdx || 0) < st.queue.length);
}

// נקרא בטעינת דף: אם יש תור שמור — ממשיכים ממנו.
export async function absorbResumeIfPending() {
  const st = loadAbsorbState();
  if (!st || !Array.isArray(st.queue) || !st.queue.length) return false;

  if (absorbIsStopped()) {
    log('[resume] דגל עצירה — מנקים מצב');
    clearAbsorbState();
    clearAbsorbStop();
    return false;
  }

  absorbQueue = st.queue;
  absorbResults = Array.isArray(st.results) ? st.results : [];
  absorbCurIdx = st.curIdx || 0;
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
    absorbRecordResult({
      line: stuck.line, branch: stuck.branch, studyType: stuck.studyType, idType: stuck.idType,
      identity: stuck.idType === 'tz' ? padId9(stuck.identity) : stuck.identity,
      status: ABSORB_STATUS.SKIPPED, detail: `לולאת ניווט — ${attempts} טעינות דף ללא התקדמות`,
      action: 'נווט ידנית לסניף/סוג הלימוד ובצע את השורה הזו ידנית',
    });
    try { sessionStorage.removeItem(ABSORB_ATTEMPT_KEY); } catch (e) { /* noop */ }
    if (absorbCurIdx >= absorbQueue.length) { absorbFinishRun(); return false; }
  }

  try { if (absorbHooks.onResume) absorbHooks.onResume(absorbQueue, absorbResults, absorbCurIdx); } catch (e) { /* noop */ }
  await sleep(1200); // נותנים לדף להתייצב (MS AJAX מסיים לאתחל)
  await runQueue();
  return true;
}

// עצירה יזומה (כפתור / Escape). כשלא רצים — מנקה מצב שמור ומסיימת.
export function absorbStop() {
  requestAbsorbStop();
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
