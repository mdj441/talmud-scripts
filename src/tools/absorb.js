// זרימת קליטת תלמידים v3.3 — פורט מ"תלמוד - קליטת תלמידים" v3.2
// (analyzeGrid:197, processStudent:314, processStudentSafe:506, runQueue:563), עם:
// ניווט-גריד במקום עץ (navigate.js), טיפול ב-ucMessagePopUp (popup.js), ענף תלמיד-חדש
// (לכידה-03), וריפוד אפסים בשלושת המקומות (חיפוש / מילוי / אימות).
// אין גישה ל-document/window/sessionStorage ברמת המודול — רק בתוך גופי הפונקציות.

import { $el, isVisible, sleep, waitFor } from '../core/dom.js';
import { firePostback, waitPRM } from '../core/prm.js';
import { readMessagePopup, hideMessagePopupAsync } from '../core/popup.js';
import { log, maskId, maskIdsInText } from '../core/log.js';
import { padId9 } from '../core/identity.js';
import { getPage, gotoStudyTypeFromInstitute, gotoBranch, parsePostbackHref } from '../core/navigate.js';
import { clearNavState, loadNavState, saveNavState } from '../core/navigate.js';

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

// ‏B4: תוויות להודעות — הקודים מגיעים מ-absorb-parse (מגדר 1/2, מצב משפחתי 10/20/30/40).
const ABSORB_GENDER_LABELS = { '1': 'זכר', '2': 'נקבה' };
const ABSORB_FAMILY_STATUS_LABELS = { '10': 'רווק', '20': 'נשוי', '30': 'גרוש', '40': 'אלמן' };

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
const ABSORB_POPUP_HIDE_MS = 5000; // M-e: תקרה להמתנה לסגירת חלונית ההודעה (postback קל)
export const ABSORB_MAX_QUEUE_AGE_MS = 30 * 60 * 1000; // M5: מעל זה — אין resume אוטומטי

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
// ‏`count` (אופציונלי) = תווית הספירה של החיפוש, כשער כמו ב-v3.2 (שורות 199-215):
//   ‏0 → "לא נמצא" בלי קשר לשורות שעדיין בגריד (גריד ישן לא ייקרא כתשובה);
//   ‏1 → מותר fallback לשורת-נתונים יחידה; 2+ → רק התאמה מדויקת;
//   null/undefined → התנהגות תואמת-אחורה (fallback מותר, כמו בלי שער).
export function analyzeGrid(rows, identity, count) {
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

// טהורה: תווית הספירה של החיפוש ("נמצאו N רשומות" — v3.2 שורה 199). מחזירה מספר, או
// null כשאין תווית/אין מספר — כלומר "אין עדות שהחיפוש רץ" (C4).
// M-c: אין fallback ל-"כל מספר בטקסט" — הערך הזה משמש כשער ב-analyzeGrid (#4),
// ומספר אקראי מתוך משפט אחר (מספר עמוד, קוד) היה מכריע "נמצא/לא נמצא" בטעות.
export function absorbParseCount(text) {
  const m = /נמצאו\s*(\d+)/.exec(String(text == null ? '' : text).trim());
  return m ? parseInt(m[1], 10) : null;
}

// טהורה (#1b + A2): מה לעשות עם תוצאת החיפוש *המקדים*. דווקא שם "לא נמצא" גורר לחיצת
// "קליטה", ולכן אסור להסיק אותו מחיפוש שלא רץ, מגריד שלא התרענן, ואף לא מתווית-ספירה
// שנשארה מהתלמיד הקודם:
//   ‏executed=false                       → אין עדות שהחיפוש רץ (כולל res.ok=false) → 'error';
//   ‏refreshed=true                       → אזור-התוצאות נבנה מחדש (תווית+גריד) → 'analyze';
//   ‏countFresh!==true                    → אין עדות שהתווית שייכת לחיפוש הזה → 'error';
//   ‏countFresh && count===0              → התווית התרעננה ואמרה 0 → תוצאה ריקה לגיטימית;
//   ‏countFresh && count>=1 && !refreshed → התווית מדווחת תוצאות אך הגריד ישן → 'retry';
//   ‏count==null                          → אין מספר לקרוא → 'error'.
// ‏A2 (למה countFresh הכרחי): גריד של GridView עם אפס שורות **אינו מרונדר כלל**, ולכן
// "אין גריד" אינו יכול לשמש עדות. בלי עד-טריות על lblCountSearch (שתמיד מרונדר),
// "נמצאו 0" ישן היה מכריע "לא נמצא" ולוחץ "קליטה" לתלמיד שאולי כבר קיים.
// אתרי האימות (אחרי קליטה / אחרי שמירת תלמיד חדש) אינם משתמשים בזה: שם "לא נמצא"
// מייצר לכל היותר שורת "לא אומת בגריד", ולא פעולה נוספת באתר.
export function absorbPrecheckDecision(res) {
  if (!res || typeof res !== 'object' || Array.isArray(res)) return 'error';
  if (!res.executed) return 'error';
  if (res.refreshed) return 'analyze';
  if (res.countFresh !== true) return 'error';
  if (res.count === 0) return 'analyze';
  if (typeof res.count === 'number' && Number.isFinite(res.count) && res.count >= 1) return 'retry';
  return 'error';
}

// טהורה (#5): רישום תוצאה חייב להיות אידמפוטנטי לכל שורה בתור. אחרי timeout+retry
// הניסיון השני מגיע לשורה שכבר נרשמה; רישום שני היה מקדם את הסמן פעמיים ומדלג על
// התלמיד הבא בשקט (בלי תוצאה ובלי שורה בדוח "מה נשאר").
export function absorbShouldRecord(lastRecordedIdx, idx) {
  if (typeof idx !== 'number' || !Number.isFinite(idx) || idx < 0) return false;
  const last = typeof lastRecordedIdx === 'number' && Number.isFinite(lastRecordedIdx) ? lastRecordedIdx : -1;
  return idx > last;
}

// טהורה (#1): מה לשחזר במצב-הניווט אחרי ניווט שנכשל. מצב קודם עם סניף → מוחזר כמות
// שהוא; אין סניף קודם → null, כלומר "לנקות" — כדי שלא יישאר currentBranch שנכתב
// בשביל ניווט שמעולם לא הגיע ליעד (getPage בדף סוג-לימוד קורא ממנו את הסניף).
export function absorbNavStateRestore(prev) {
  if (!prev || typeof prev !== 'object' || Array.isArray(prev)) return null;
  return prev.currentBranch ? prev : null;
}

// טהורה (M5): האם תור שמור ישן מדי ל-resume אוטומטי. חותמת חסרה/פגומה → לא ישן
// (לא חוסמים המשך של תור שנשמר בגרסה בלי חותמת).
export function absorbQueueIsStale(startedAt, now, maxAgeMs) {
  const t0 = Date.parse(startedAt);
  if (!startedAt || Number.isNaN(t0)) return false;
  const nowMs = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.parse(now));
  if (Number.isNaN(nowMs)) return false;
  const max = typeof maxAgeMs === 'number' ? maxAgeMs : ABSORB_MAX_QUEUE_AGE_MS;
  return nowMs - t0 > max;
}

// טהורה (M2): מקור אחד לרשומת-תוצאה. ריפוד אפסים לת.ז., דרכון כמות-שהוא (מקוצץ רווחים).
export function makeAbsorbResult(task, status, detail, action) {
  const t = task || {};
  const identity = t.idType === 'tz' ? padId9(t.identity) : String(t.identity == null ? '' : t.identity).trim();
  return {
    line: t.line, branch: t.branch, studyType: t.studyType, idType: t.idType, identity,
    status, detail: detail || '', action: action || '',
  };
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

function absorbCancelError(where) { return new Error(ABSORB_CANCEL_PREFIX + where); }
export function isAbsorbCancelError(err) {
  return !!err && typeof err.message === 'string' && err.message.indexOf(ABSORB_CANCEL_PREFIX) === 0;
}

// ─── ביטול ניסיון שהוחלף (C3) ────────────────────────────────────────────────
// ‏absorbWithTimeout רק *מפסיק להמתין* — הניסיון הראשון ממשיך לרוץ ועלול לירות
// postback לתוך דף שהניסיון השני כבר מנהל. כל ניסיון מקבל "דור"; כשמתחיל ניסיון חדש
// (או ריצה/עצירה) הדור עולה, וכל גבול-שלב של הניסיון הישן זורק ומת שם.
let absorbGeneration = 0;

function absorbNextGeneration() { absorbGeneration++; return absorbGeneration; }
export function absorbCurrentGeneration() { return absorbGeneration; }

// נקודת-בדיקה בכל גבול-שלב. `gen` (אופציונלי) = דור הניסיון הקורא.
export function checkStop(where, gen) {
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

// ‏B2: כתיבה לשדה היא פוטנציאלית postback (AutoPostBack על change). לכן היא כפופה
// לאותו סדר קשיח כמו כל postback (global-constraints): רושמים את ההמתנה **קודם**,
// ורק אז — מ-setTimeout(…,0) — מציבים את הערך ומשגרים את האירועים. מחזיר את ההמתנה;
// שדה שאינו AutoPostBack פשוט יחזיר {ok:true, started:false} אחרי startTimeoutMs.
// ‏opts: { select:true } = <select> (בלי אירוע blur), ‏opts.opts = פרמטרים ל-waitPRM.
const ABSORB_FIELD_WAIT = { startTimeoutMs: 400, totalTimeoutMs: 8000 };
const ABSORB_SELECT_WAIT = { startTimeoutMs: 1200, totalTimeoutMs: 10000 };

function absorbSetAndWait(el, value, opts) {
  const o = opts || {};
  const wait = waitPRM(o.opts || (o.select ? ABSORB_SELECT_WAIT : ABSORB_FIELD_WAIT)); // (1) נרשם קודם
  setTimeout(() => { // (2) נדחה — ה-handlers כבר רשומים כשה-postback (אם יש) מתחיל
    try {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (!o.select) el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (e) {
      log('[שדה] כתיבה נכשלה: ' + (e && e.message)); // אצווה לא נתקעת
    }
  }, 0);
  return wait;
}

// ‏B4: בחירה ב-<select> עם אימות שהאופציה קיימת *ולפני* הכתיבה, ושהערך אכן נתפס
// אחריה. מחזיר {ok:true} או {ok:false, reason} — הקורא מדווח "שגיאה" ולא שומר.
async function absorbSelectOption(el, value, label, display) {
  const shown = display || value;
  const options = Array.from((el && el.options) || []);
  if (!options.some((o) => o.value === value)) {
    return { ok: false, reason: `הערך "${shown}" בעמודת "${label}" (קוד ${value}) לא קיים ברשימת האתר` };
  }
  await absorbSetAndWait(el, value, { select: true });
  if (el.value !== value) {
    return { ok: false, reason: `בחירת "${shown}" בעמודת "${label}" נכשלה` };
  }
  return { ok: true };
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

// C4 + A2: מסמנים את אזור-התוצאות כ"ישן" *לפני* כל חיפוש. postback אמיתי מחליף את
// תוכן ה-UpdatePanel (ואיתו את האלמנטים) — ולכן היעדר הסימון אחרי החיפוש הוא עדות
// שהאזור באמת נבנה מחדש. כל עוד הסימון קיים על הגריד, readAbsorbGridRows מחזיר ריק.
// ‏A2: הסימון חייב להיות גם על lblCountSearch — גריד עם אפס שורות **אינו מרונדר בכלל**
// (המצב הנפוץ ביותר: חיפוש שלא מצא), ואז "אין גריד" נקרא בטעות כ"התרענן" והשומר כובה.
function absorbMarkElStale(el) {
  try {
    if (el && typeof el.setAttribute === 'function') el.setAttribute(ABSORB_GRID_STALE_ATTR, '1');
  } catch (e) { /* אצווה לא נתקעת */ }
}

function absorbElIsStale(el) {
  try {
    return !!(el && typeof el.getAttribute === 'function' && el.getAttribute(ABSORB_GRID_STALE_ATTR) === '1');
  } catch (e) {
    return false;
  }
}

function absorbMarkSearchStale() {
  absorbMarkElStale($el(ABSORB_IDS.grid));
  absorbMarkElStale($el(ABSORB_IDS.countLabel));
}

function absorbGridIsStale() {
  return absorbElIsStale($el(ABSORB_IDS.grid));
}

// עדות-טריות אחרי חיפוש. ‏`refreshed` = מה שאנחנו קוראים עכשיו (תווית + גריד) שייך
// לחיפוש הזה: התווית טרייה, וגם הגריד — אם הוא בכלל מרונדר.
function absorbSearchFreshness() {
  const countEl = $el(ABSORB_IDS.countLabel);
  const gridEl = $el(ABSORB_IDS.grid);
  const countPresent = !!countEl;
  const countFresh = countPresent && !absorbElIsStale(countEl);
  const gridPresent = !!gridEl;
  const gridFresh = gridPresent && !absorbElIsStale(gridEl);
  return {
    countPresent, countFresh, gridPresent, gridFresh,
    refreshed: countFresh && (gridPresent ? gridFresh : true),
  };
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

// ניסיון חיפוש יחיד. מחזיר {ok, started, executed, refreshed, countFresh, countText, count}.
async function absorbSearchOnce(input, btn, value, gen) {
  absorbMarkSearchStale();
  await absorbSetAndWait(input, value); // B2: סדר קשיח גם לכתיבה בשדה
  await sleepCheckStop(150, gen);
  const res = await absorbFireElement(btn, { startTimeoutMs: 3000, totalTimeoutMs: 20000 });
  await sleepCheckStop(350, gen);
  const countText = readAbsorbCount();
  const count = absorbParseCount(countText);
  const started = !!(res && res.started);
  const ok = !!(res && res.ok);
  const fresh = absorbSearchFreshness();
  const refreshed = fresh.refreshed;
  // עדות שהחיפוש באמת רץ (C4): בקשה שהתחילה, הצליחה, ומשהו באזור-התוצאות נבנה מחדש.
  // ‏#4(b): הסימון *לא* מוסר כאן. גריד שלא התרענן נשאר "ישן" ו-readAbsorbGridRows
  // מחזיר עבורו ריק — כך שורה שנשארה מהתלמיד הקודם לא תיקרא כ"כבר קיים" (הפלה שקטה).
  // ‏#1a: גם ok חייב להיות אמת. waitPRM מחזיר {ok:false, started:true} בשגיאת PRM או
  // ב-timeout — MS AJAX לא החיל עדכון, ולכן תווית-הספירה עדיין של התלמיד הקודם;
  // בלי השער הזה חיפוש שנכשל היה נחשב "רץ" ומכריע "לא נמצא" מול גריד ותווית ישנים.
  // ‏A2: "לא תווית טרייה ולא גריד טרי" = אין שום עדות → ניסיון חוזר, ואז "שגיאה".
  const executed = started && ok && (fresh.countFresh || fresh.gridFresh);
  log(`[חיפוש] ${maskId(value)} → ${countText || '(ללא תווית ספירה)'} · started=${started} · ok=${ok} · countFresh=${fresh.countFresh} · gridFresh=${fresh.gridFresh} · refreshed=${refreshed} · executed=${executed}`);
  return {
    ok, started, executed, refreshed, countFresh: fresh.countFresh,
    countText, count, reason: res && res.reason,
  };
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
const ABSORB_GRID_STALE_ACTION = 'החיפוש לא רענן את הגריד — בדוק ידנית אם התלמיד כבר קיים';

function absorbSearchFailReason(res) {
  if (!res) return 'החיפוש לא הופעל';
  if (!res.started) return 'לחיצת החיפוש לא הפעילה בקשה לשרת' + (res.reason ? ` (${res.reason})` : '');
  // ‏#1a: started=true אך ok=false — שגיאת PRM או timeout; השרת לא החזיר עדכון לדף.
  if (!res.ok) return 'החיפוש נכשל או פג-זמן בשרת' + (res.reason ? ` (${res.reason})` : '');
  // ‏A2: התווית שעל המסך נשארה מהחיפוש הקודם — אסור להסיק ממנה "נמצאו 0".
  if (res.countFresh === false) return 'תווית הספירה לא התרעננה — מה שמוצג אינו תוצאת החיפוש הזה' + (res.reason ? ` (${res.reason})` : '');
  return 'החיפוש רץ אך תוצאותיו לא התעדכנו בדף' + (res.reason ? ` (${res.reason})` : '');
}

// ‏A2: תווית-הספירה משמשת כשער ל-analyzeGrid רק כשהיא באמת של החיפוש הזה. תווית ישנה
// → null = "אין שער" (הגריד הטרי לבדו מכריע), ולא מספר שגוי שיפסול התאמה אמיתית.
function absorbCountGate(res) {
  return res && res.countFresh ? res.count : null;
}

// M-f: סגירת חלונית ההודעה + המתנה נכונה. כשהסגירה עברה דרך btnMCancel (postback
// צד-שרת) ממתינים ל-PRM שנרשם לפני הלחיצה, במקום sleep שרירותי שהיה משאיר את
// ה-postback באוויר בזמן שהצעד הבא כבר יורה. extender.hide() אינו postback.
async function absorbHidePopup(gen) {
  const hide = hideMessagePopupAsync();
  if (hide && hide.wait) {
    // M-e: סגירת החלונית היא postback קל — אין סיבה להחזיק את התלמיד עד תקרת ה-15
    // שניות של waitPRM ב-popup.js. ממתינים למוקדם מבין ה-postback לבין התקרה כאן
    // (‏popup.js מחוץ להיקף השינוי, ולכן התקרה נאכפת בצד הקורא). waitPRM לא נדחה.
    await Promise.race([hide.wait, sleep(ABSORB_POPUP_HIDE_MS)]);
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
    // ‏B1: הדף באמת מתחיל להיטען מחדש → אין צורך בכלב-השומר של הניווט.
    const mark = () => { absorbUnloadSeen = true; absorbClearNavWatchdog(); };
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

// ─── B1: כלב-שומר לניווט שהוכרז ולא קרה ─────────────────────────────────────
// ‏runQueue עוצר ומחזיר על ABSORB_NAVIGATED וממתין ל-resume שיגיע עם טעינת הדף. אם
// הפעולה שהוכרזה כניווט מלא מתבררת כ-postback אסינכרוני (NEEDS_CONTEXT על
// ‏btnUpdateStudyType), שום טעינה לא תגיע והריצה קופאת על "מעבד i/N" בלי דוח.
// כאן: אחרי ~15 שניות בלי unload ובלי שינוי בחתימת-הדף — ממשיכים במקום
// (‏absorbResumeIfPending אידמפוטנטי; אם ריצה כבר מתנהלת הוא פשוט מחזיר false).
const ABSORB_NAV_WATCHDOG_MS = 15000;
let absorbNavWatchdogTimer = null;

function absorbClearNavWatchdog() {
  if (absorbNavWatchdogTimer !== null) {
    try { clearTimeout(absorbNavWatchdogTimer); } catch (e) { /* noop */ }
    absorbNavWatchdogTimer = null;
  }
}

function absorbArmNavWatchdog() {
  absorbClearNavWatchdog();
  if (typeof setTimeout !== 'function') return;
  absorbWatchUnload();
  const before = absorbPageSignature();
  try { if (absorbHooks.onNavigating) absorbHooks.onNavigating(); } catch (e) { /* אצווה לא נתקעת */ }
  absorbNavWatchdogTimer = setTimeout(() => {
    absorbNavWatchdogTimer = null;
    if (absorbUnloadSeen) return; // הדף באמת מתחלף — ה-resume יקרה אחרי הטעינה
    if (absorbRunning) return; // מישהו כבר ממשיך
    if (absorbPageSignature() !== before) {
      log('[ניווט] הדף השתנה בלי טעינה מלאה — ממשיכים במקום');
    } else {
      log(`[ניווט] לא הגיעה טעינת דף תוך ${Math.round(ABSORB_NAV_WATCHDOG_MS / 1000)} שניות — ממשיכים במקום`);
    }
    Promise.resolve()
      .then(() => absorbResumeIfPending())
      .catch((e) => log('[ניווט] המשך במקום נכשל: ' + (e && e.message)));
  }, ABSORB_NAV_WATCHDOG_MS);
}

// #1: ניווט שנכשל/נבלע השאיר את מצב-הניווט מצהיר על סניף שמעולם לא הגענו אליו
// (‏gotoBranch כותב currentBranch לפני הירי). בדף סוג-לימוד זה המקור *היחיד* לסניף,
// ולכן המשימה הבאה הייתה "מתאימה" לדף הלא-נכון ונקלטת לסניף שגוי. משחזרים.
// M-c: הלוג נכתב רק כשבאמת שוחזר/נוקה סניף. מצב ריק שנשאר ריק (המקרה הרגיל במשימה
// הראשונה אחרי clearNavState) אינו "שחזור" ואינו ראוי לשורת-לוג מטעה.
function absorbRestoreNavState(prev) {
  const restore = absorbNavStateRestore(prev);
  if (restore) {
    saveNavState(restore);
    log(`[ניווט] הניווט לא אומת — מצב-הניווט שוחזר לסניף ${restore.currentBranch}`);
    return;
  }
  const cur = loadNavState();
  if (cur && cur.currentBranch) {
    clearNavState();
    log('[ניווט] הניווט לא אומת — מצב-הניווט נוקה (לא היה סניף קודם)');
  }
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
async function absorbNavigateToBranch(branch, gen) {
  // ‏#3: ניסיון שהוחלף (timeout+retry) או שבוטל (עצירה/ריצה חדשה) לא נוגע בדף ולא
  // בסטייט: לא saveAbsorbState שידרוס את הסנאפשוט החי, ולא ירי ניווט לתוך דף
  // שהניסיון הפעיל כבר מנהל. מחזיר cancelled כדי שהקורא ימות בגבול-השלב הבא.
  if (typeof gen === 'number' && gen !== absorbCurrentGeneration()) {
    log('[ניווט] ניסיון שבוטל ביקש ניווט — לא נוגעים בדף');
    return { ok: false, cancelled: true, reason: 'הניסיון בוטל (ניסיון חדש כבר רץ)' };
  }
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

  // ‏A1: המסלול המהיר הזה מסתמך על "אנחנו כבר בדף המוסד של הסניף הנכון" — ולכן הוא
  // מותר **רק** כשהסניף נקרא מה-h1 של הדף שמולנו (branchSource==='h1'). ‏branch שהגיע
  // מ-sessionStorage הוא הצהרה של ניווט קודם: אם הוא שגוי (ניווט שנבלע / המשתמש ניווט
  // ידנית), נלחץ "עריכה" בדף המוסד הלא-נכון, ננחת בדף סוג-לימוד שאין בו סניף, נקרא שוב
  // את אותו מצב שמור — והתלמיד ייקלט לסניף השגוי עם "נקלט" ירוק. במקרה כזה נופלים
  // לניווט המלא דרך gotoBranch, שקובע את הסניף מחדש.
  if (page.kind === 'institute' && page.branch === branch && page.branchSource === 'h1') {
    log(`[ניווט] דף מוסד ${branch} → סוג לימוד ${studyType}`);
    // I4: btnUpdateStudyType גורר ניווט מלא ל-StudyTypeDetails.aspx. רושמים את הסניף
    // (הדף הבא לא יודע אותו) ואת מצב ההמשך *לפני* הירי — אחרת ה-resume נוחת בלי סניף,
    // מנווט שוב, ושורף ניסיונות עד "דולג" שקרי.
    const prevNav = loadNavState(); // #1: נלכד לפני הכתיבה, לשחזור אם הניווט לא קרה
    // ‏#2: כאן הסניף הגיע מה-h1 של דף המוסד (navigate.js, branchSource==='h1') — אמת
    // מאומתת מול הדף שמולנו, לא הצהרה של gotoBranch. שחזור שמוחק אותו היה גורר
    // ‏gotoBranch מיותר בטעינה הבאה (ושורף ניסיונות-resume) גם כשהניווט פשוט היה איטי
    // מ-ABSORB_NAV_EVIDENCE_MS. לכן משחזרים את המצב הקודם *עם* הסניף המאומת;
    // מסלול gotoBranch נשאר בשחזור מלא.
    const restoreNav = Object.assign({}, prevNav, { currentBranch: branch });
    saveNavState(restoreNav);
    saveAbsorbState();
    const before = absorbBeginNavigation();
    // ‏B5(a): לולאת הפייג'ר בתוך gotoStudyTypeFromInstitute כפופה למודל-הביטול שלנו —
    // ניסיון שהוחלף (דור ישן) או בקשת-עצירה מפסיקים אותה לפני הדפדוף הבא.
    const res = await gotoStudyTypeFromInstitute(studyType, {
      shouldAbort: () => (typeof gen === 'number' && gen !== absorbCurrentGeneration()) || absorbIsStopped(),
    });
    if (res && res.aborted) checkStop('studytype-aborted', gen); // זורק (ביטול/עצירה) ומת כאן
    if (!res || res.ok === false) {
      absorbRestoreNavState(restoreNav); // #2: לא מוחקים סניף שנקרא מה-h1
      return { ok: false, navigated: false, reason: (res && res.reason) || 'ניווט לסוג הלימוד נכשל' };
    }
    await sleepCheckStop(500, gen);
    const after = getPage();
    if (after.kind === 'studyType' && after.studyType === studyType) return { ok: true, navigated: false };
    const evidence = await absorbNavigationEvidence(res, before, `ניווט לסוג לימוד ${studyType}`);
    if (!evidence.ok) {
      absorbRestoreNavState(restoreNav); // #2: לא מוחקים סניף שנקרא מה-h1
      return { ok: false, navigated: false, reason: evidence.reason, action: ABSORB_NAV_FAIL_ACTION };
    }
    // בקשה אמיתית יצאה אך עוד לא נחתנו — ה-resume אחרי טעינת הדף ימשיך מכאן.
    return { ok: true, navigated: true };
  }

  log(`[ניווט] ניווט מלא לסניף ${branch} (דף נוכחי: ${page.kind})`);
  const nav = await absorbNavigateToBranch(branch, gen);
  if (nav.cancelled) checkStop('nav-cancelled', gen); // #3: ניסיון שבוטל מת כאן
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
async function absorbLeaveNewStudentPage(task, recorded, gen) {
  // ‏#3: ניסיון שבוטל לא יוצא מהדף בעצמו ולא נוגע בשורה שנרשמה — הדף שייך לניסיון
  // הפעיל. מחזיר ABSORB_CONTINUE (הערך שהקוראים כבר יודעים לטפל בו), בלי שום פעולה.
  if (typeof gen === 'number' && gen !== absorbCurrentGeneration()) {
    log('[תלמיד חדש] ניסיון שבוטל — לא יוצאים מהדף');
    return ABSORB_CONTINUE;
  }
  const nav = await absorbNavigateToBranch(String(task.branch).padStart(2, '0'), gen);
  if (nav.ok) return ABSORB_NAVIGATED;
  if (nav.cancelled) return ABSORB_CONTINUE;
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
    // ‏#3: רישום שנדחה (דור ישן) = הניסיון הזה בוטל — אסור להמשיך לנווט מכאן.
    if (!absorbRecordResult(res, gen, myIdx)) return ABSORB_CONTINUE;
    return absorbLeaveNewStudentPage(task, res, gen);
  }

  const first = $el(ABSORB_NEW_IDS.firstName);
  const last = $el(ABSORB_NEW_IDS.lastName);
  const birth = $el(ABSORB_NEW_IDS.birthDate);
  if (!first || !last || !birth) {
    return mk(ABSORB_STATUS.ERROR, 'שדות דף תלמיד-חדש לא נמצאו', 'מלא ושמור ידנית בדף התלמיד החדש');
  }

  await absorbSetAndWait(first, ns.firstName);
  await absorbSetAndWait(last, ns.lastName);
  await absorbSetAndWait(birth, birthDate);
  // ‏B4: מגדר/מצב-משפחתי מקבלים את אותה בדיקת-קיום שהארץ מקבלת. ערך שאינו ברשימת
  // האתר היה נבלע בשקט (‏select מתעלם מערך לא-קיים) והתלמיד היה נשמר עם ברירת-המחדל.
  if (ns.gender) {
    const g = $el(ABSORB_NEW_IDS.gender);
    if (g) {
      const r = await absorbSelectOption(g, ns.gender, 'מגדר', ABSORB_GENDER_LABELS[ns.gender]);
      if (!r.ok) return mk(ABSORB_STATUS.ERROR, r.reason, `תקן את עמודת "מגדר" (זכר/נקבה) או בחר ידנית בדף התלמיד החדש`);
    }
  }
  if (ns.familyStatus) {
    const f = $el(ABSORB_NEW_IDS.familyStatus);
    if (f) {
      const r = await absorbSelectOption(f, ns.familyStatus, 'מצב משפחתי', ABSORB_FAMILY_STATUS_LABELS[ns.familyStatus]);
      if (!r.ok) return mk(ABSORB_STATUS.ERROR, r.reason, `תקן את עמודת "מצב משפחתי" (רווק/נשוי/גרוש/אלמן) או בחר ידנית בדף התלמיד החדש`);
    }
  }
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
      if (analyzeGrid(readAbsorbGridRows(), identity, absorbCountGate(search)).found) return mk(ABSORB_STATUS.OK_NEW, '', '');
    }
  }
  return mk(ABSORB_STATUS.SAVED_UNVERIFIED, 'התלמיד נשמר; הקליטה לא אומתה בגריד',
    'ודא ברשימת התלמידים של סוג הלימוד שהתלמיד נקלט');
}

// ─── עיבוד תלמיד יחיד (7 השלבים של הבריף) ───────────────────────────────────

export async function processStudent(task, gen) {
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
    const nav = await absorbNavigateToBranch(String(task.branch).padStart(2, '0'), gen);
    if (nav.cancelled) checkStop('nav-cancelled', gen); // #3: ניסיון שבוטל מת כאן
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
  let pre = await absorbSearch(searchInput, searchBtn, identity, gen); // ריפוד (2/3)
  // ‏#1b: בחיפוש המקדים "לא נמצא" גורר לחיצת "קליטה", ולכן אסור להסיק אותו מחיפוש
  // שלא רץ (C4) ואף לא מגריד שלא התרענן בזמן שהתווית מדווחת תוצאות (התווית עשויה
  // להיות של התלמיד הקודם). ניסיון חוזר אחד, ואז "שגיאה" מפורשת — לא קליטה שנייה.
  let decision = absorbPrecheckDecision(pre);
  if (decision === 'retry') {
    log('[חיפוש] התווית מדווחת תוצאות אך הגריד לא התרענן — חיפוש מקדים חוזר');
    await sleepCheckStop(500, gen);
    pre = await absorbSearch(searchInput, searchBtn, identity, gen);
    decision = absorbPrecheckDecision(pre);
    if (decision === 'retry') {
      return mk(ABSORB_STATUS.ERROR, `החיפוש דיווח ${pre.count} תוצאות אך הגריד לא התרענן`, ABSORB_GRID_STALE_ACTION);
    }
  }
  // C4: בלי עדות שהחיפוש רץ אסור לקרוא את הגריד — גריד ישן היה נקרא כ"כבר קיים".
  if (decision !== 'analyze') return mk(ABSORB_STATUS.ERROR, absorbSearchFailReason(pre), ABSORB_SEARCH_FAILED_ACTION);

  const preGrid = analyzeGrid(readAbsorbGridRows(), identity, absorbCountGate(pre)); // #4: תווית הספירה היא השער
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
  // I2 + M-b: ה-try מתחיל *לפני* לחיצת "קליטה" — הלחיצה עצמה היא שפותחת את המודאל,
  // וכל יציאה שאחריה (יציאת "נחסם", תוצאת-שגיאה, חריגה או עצירה בתוך absorbHidePopup
  // ‏/ checkStop) חייבת להשאיר את הדף נקי, אחרת התלמיד הבא מתחיל מול מודאל פתוח.
  try {
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
      // ‏B2: ההמתנה נרשמת *לפני* שינוי הערך ושיגור ה-change (לכידה-02 §4: בפועל לא
      // גורר postback — ואז waitPRM פשוט נסגר ב-started=false).
      await absorbSetAndWait(ddlType, idTypeValue, { select: true });
      await sleepCheckStop(200, gen);
    }

    const modalId = $el(ABSORB_IDS.modalId);
    if (!modalId) return mk(ABSORB_STATUS.ERROR, 'שדה המזהה במודאל הקליטה לא נמצא', 'בצע את הקליטה ידנית');
    await absorbSetAndWait(modalId, identity); // ריפוד (3/3)
    await sleepCheckStop(150, gen);

    if (task.idType === 'passport') {
      const birthEl = $el(ABSORB_IDS.birthDate);
      if (!birthEl) return mk(ABSORB_STATUS.ERROR, 'שדה תאריך לידה במודאל לא נמצא', 'בצע את הקליטה ידנית');
      await absorbSetAndWait(birthEl, task.birthDate);
      await sleepCheckStop(150, gen);

      const countryEl = $el(ABSORB_IDS.countryDdl);
      if (!countryEl) return mk(ABSORB_STATUS.ERROR, 'שדה ארץ דרכון במודאל לא נמצא', 'בצע את הקליטה ידנית');
      // ‏B2: אותו עוזר בדיוק כמו מגדר/מצב-משפחתי — בדיקת-קיום, סדר קשיח, ואימות שנתפס.
      const country = await absorbSelectOption(countryEl, task.countryValue, 'ארץ', task.country);
      if (!country.ok) return mk(ABSORB_STATUS.ERROR, country.reason, 'תקן את עמודת "ארץ" לשם ארץ מהרשימה, או בחר ידנית בחלון הקליטה');
      await sleepCheckStop(200, gen);
    }

    const startDate = absorbStartDate();
    if (startDate) {
      const startEl = $el(ABSORB_IDS.startDate);
      if (startEl && startEl.value !== startDate) await absorbSetAndWait(startEl, startDate);
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
      // ‏#3: רישום שנדחה (דור ישן) = הניסיון הזה בוטל — אסור להמשיך לנווט מכאן.
      if (!absorbRecordResult(res, gen, myIdx)) return ABSORB_CONTINUE;
      return await absorbLeaveNewStudentPage(task, res, gen);
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
    const verify = analyzeGrid(readAbsorbGridRows(), identity, absorbCountGate(verifySearch));
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

export async function processStudentSafe(task) {
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

export async function runQueue() {
  absorbRunning = true;
  absorbClearNavWatchdog(); // B1: יש ריצה חיה — אין למי לחכות
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
      absorbArmNavWatchdog(); // B1: אם הטעינה לא תגיע — נמשיך במקום במקום לקפוא
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
      // M-a: רשת-הביטחון עצמה כפופה ל-absorbShouldRecord; אם המונים יצאו מסנכרון היא
      // לא תרשום דבר והלולאה הייתה מסתובבת על אותה שורה כל 300ms. הסמן מתקדם בכל מקרה.
      absorbCurIdx = Math.max(absorbCurIdx, taskIdx + 1);
      saveAbsorbState(); // B7: קידום-הסמן הזה חייב לשרוד reload, אחרת ה-resume חוזר לשורה
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
export async function absorbStartRun(tasks) {
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

export function absorbHasSavedQueue() {
  const st = loadAbsorbState();
  return !!(st && Array.isArray(st.queue) && st.queue.length && (st.curIdx || 0) < st.queue.length);
}

// מידע לפאנל על תור שמור שלא הופעל אוטומטית (M5) — בלי לגעת במצב.
export function absorbSavedQueueInfo() {
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
export function absorbDiscardSavedQueue() {
  absorbNextGeneration();
  absorbClearNavWatchdog(); // B1: אין למה לחכות יותר
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
export async function absorbResumeIfPending(opts) {
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
export function absorbStop() {
  requestAbsorbStop();
  absorbNextGeneration(); // C3: גם ניסיון יתום שעדיין רץ מת כאן
  absorbClearNavWatchdog(); // B1: עצירה מבטלת גם המתנה לטעינת דף
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
