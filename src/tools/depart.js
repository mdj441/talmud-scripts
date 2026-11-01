// עזיבת תלמידים: הזרימה + הפונקציות הטהורות. העברה מכנית מ"תלמוד - עזיבת תלמידים" v5.0
// (979 שורות): אותם מזהי-DOM, אותם postbacks, אותו סדר צעדים. הליבה (PRM, חלונית ההודעה,
// ניווט, יומן) משותפת. דף מוסד, לשונית 3 "תלמידים למוסד".
// לכל תלמיד: לשונית 3 → חיפוש → ניתוח הגריד → בחירת שורה → "עזיבה" → מודאל (תאריך + סיבה) →
// "אישור" → חלונית הודעה → "שמירה" → הודעה אחרי שמירה → אימות בחיפוש חוזר.
// רב-סניפי: ניווט מלא לדף המוסד של הסניף, התור ב-sessionStorage, המשך אחרי הטעינה.
// אין גישה ל-document/window/sessionStorage ברמת המודול (import תקין ב-Node).

import { $el, isVisible, sleep, waitFor } from '../core/dom.js';
import { firePostback, waitPRM } from '../core/prm.js';
import { readMessagePopup, hideMessagePopupAsync } from '../core/popup.js';
import { log, maskId, maskIdsInText } from '../core/log.js';
import { padId9 } from '../core/identity.js';
import { getPage, gotoInstitute, normalizeBranch, parsePostbackHref } from '../core/navigate.js';

// ─── מזהי הפקדים (כמו בסקריפט הישן, שורות 15-29) ─────────────────────────────
const DEPART_BASE = 'ContentPlaceHolder1_tabInstituteDetails_TabPanel1_ucStudentsSearch';
export const DEPART_IDS = {
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
export const DEPART_TAB_INDEX = 3;

export const DEPART_REASONS = [
  { value: '1', label: 'הפסקת לימודים' },
  { value: '3', label: 'מעבר בין ישיבות' },
  { value: '4', label: 'מעבר בין יחידות צבאיות' },
  { value: '6', label: 'אחר' },
  { value: '7', label: 'גיוס לצה"ל' },
];
export const DEPART_DEFAULT_REASON = '1';

// ─── סטטוסים (כמו בישן; "דולג" ו"סניף לא נמצא" חדשים לרשת-הביטחון) ───────────
export const DEPART_STATUS = {
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

export const DEPART_TSV_HEADER = ['סניף', 'ת.ז.', 'סטטוס', 'מה לעשות'];
export const DEPART_CSV_HEADER = ['סניף', 'ת.ז.', 'סטטוס', 'פירוט', 'מה לעשות'];

// הוראות אופרטיביות לדוח "מה נשאר"
export const DEPART_ACTIONS = {
  notFound: 'בדוק שהת.ז. והסניף נכונים. אם התלמיד רשום בסניף אחר, הרץ אותו עם הסניף הנכון',
  blocked: 'פתח את דף המוסד, לשונית "תלמידים למוסד", חפש את התלמיד ולחץ "עזיבה" ידנית. קרא את ההודעה של האתר והחלט',
  unverified: 'חפש את התלמיד בלשונית "תלמידים למוסד" ובדוק את עמודת "תאריך עזיבה". אם היא ריקה, בצע את העזיבה ידנית',
  error: 'בצע את העזיבה ידנית באתר. אם זה חוזר, העתק את היומן (מזהים ממוסכים) ושלח',
  stopped: 'הרץ שוב את השורות שנותרו',
  searchFailed: 'רענן את דף המוסד, ודא שהלשונית "תלמידים למוסד" נפתחת, והרץ שוב את השורה',
};

export function departManualBranchAction(branch) {
  return `פתח ידנית את דף המוסד של סניף ${branch} (בעץ הסניפים בצד) והרץ שוב את השורה`;
}

// "נחסם: טקסט" → "נחסם"; "כבר בוצעה עזיבה (תאריך)" → "כבר בוצעה עזיבה"
export function departStatusKey(status) {
  const s = String(status == null ? '' : status);
  const cut = s.search(/:|\s\(/);
  return (cut === -1 ? s : s.slice(0, cut)).trim();
}

// "הצליח" ו"כבר בוצעה עזיבה" = אין מה לעשות (לא נכנסים לדוח "מה נשאר")
export function isDepartSuccess(status) {
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
export function departNormalizeIdentity(raw) {
  const s = String(raw == null ? '' : raw).replace(/[\s-]/g, '');
  if (!s) return { value: '', error: 'חסרה ת.ז.' };
  if (/^\d+$/.test(s)) {
    if (s.length < 5 || s.length > 9) return { value: '', error: `ת.ז. לא תקינה: ${raw}` };
    return { value: padId9(s), error: null };
  }
  if (/^[A-Za-z0-9]{4,20}$/.test(s)) return { value: s.toUpperCase(), error: null };
  return { value: '', error: `ת.ז. לא תקינה: ${raw}` };
}

export function parseDepartInput(text) {
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
export function departIsValidDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return false;
  const d = Number(m[1]); const mo = Number(m[2]); const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || y < 1900 || y > 2200) return false;
  return d <= new Date(y, mo, 0).getDate();
}

export function departTodayDMY() {
  const d = new Date();
  return [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('/');
}

// ─── ניתוח הגריד (פורט של analyzeGrid הישן, שורות 183-218) ───────────────────
// rows = שורות-תאים (td בלבד; שורת הכותרת עם th יוצאת ריקה ונדחית ב-length<10).
// count = "נמצאו N": 0 → לא נמצא; 1 → מותר fallback לשורת-הנתונים הראשונה (כמו בישן);
// null → אין תווית: התאמה מדויקת, ו-fallback רק כשיש שורת-נתונים אחת בלבד.
export function departParseCount(text) {
  const m = /נמצאו\s*(\d+)/.exec(String(text == null ? '' : text));
  return m ? parseInt(m[1], 10) : null;
}

const departNormId = (s) => String(s == null ? '' : s).trim().replace(/^0+/, '').toUpperCase();

export function analyzeDepartGrid(rows, identity, count) {
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
export function departSelectRowIndex(onclickText) {
  if (typeof onclickText !== 'string') return null;
  const m = /selectedRowStudents\s*\(\s*['"]?(\d+)['"]?\s*\)/.exec(onclickText);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// href/onclick → {target, arg, group, validate}. תומך ב-__doPostBack ישיר, בעטיפת setTimeout
// של תיבת-סימון (`setTimeout('__doPostBack(\'x\',\'\')', 0)`) וב-WebForm_DoPostBackWithOptions.
export function departParsePostback(text) {
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
export function makeDepartResult(task, status, detail, action) {
  const t = task || {};
  return { line: t.line, branch: t.branch, identity: t.identity, status, detail: detail || '', action: action || '' };
}

const departFlat = (v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();

export function buildDepartTsv(results) {
  const lines = [DEPART_TSV_HEADER.join('\t')];
  for (const r of Array.isArray(results) ? results : []) {
    lines.push([r.branch, r.identity, r.status, r.action].map(departFlat).join('\t'));
  }
  return lines.join('\n');
}

export function buildDepartCsvRows(results) {
  const rows = [DEPART_CSV_HEADER.slice()];
  for (const r of Array.isArray(results) ? results : []) rows.push([r.branch, r.identity, r.status, r.detail || '', r.action || '']);
  return rows;
}

export function summarizeDepartResults(results) {
  const counts = {};
  for (const r of Array.isArray(results) ? results : []) {
    const key = departStatusKey(r && r.status) || '?';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function buildDepartReport(results) {
  const list = Array.isArray(results) ? results : [];
  const counts = summarizeDepartResults(list);
  const lines = list
    .filter((r) => !isDepartSuccess(r && r.status))
    .map((r) => [r.branch, r.identity, r.status, r.action || 'אין הוראה'].map(departFlat).join(' · '));
  const summary = Object.keys(counts).map((k) => `${k}=${counts[k]}`).join(' · ');
  return { lines, summary, counts };
}

export function departQueueIsStale(startedAt, now, maxAgeMs) {
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
export const DEPART_MAX_LANDINGS = 6; // טעינות-דף לתלמיד אחד; מעל זה "דולג"
export const DEPART_MAX_QUEUE_AGE_MS = 30 * 60 * 1000; // תור שמור ישן מזה לא ממשיך לבד
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

export function departSetHooks(hooks) { DEPART_S.hooks = hooks || {}; }
export function departGetResults() { return DEPART_S.results.slice(); }
export function departIsRunning() { return DEPART_S.running; }
export function departGetSettings() { return Object.assign({}, DEPART_S.settings); }
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
    savedAt: new Date().toISOString(), // הפעילות האחרונה (סבב רטוב 1.11.2026): "ישן" ו"לפני N דקות" נמדדים ממנה
  };
  try { sessionStorage.setItem(DEPART_QUEUE_KEY, JSON.stringify(state)); } catch (e) { log('[עזיבה] שמירת המצב נכשלה: ' + (e && e.message)); }
}
// הפעילות האחרונה של התור השמור (savedAt), ובלי savedAt (מצב ישן) תחילת הריצה.
export function departQueueLastActivity(state) {
  if (!state || typeof state !== 'object') return null;
  return state.savedAt || state.startedAt || null;
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

export async function departStartRun(tasks, settings) {
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

export function departHasSavedQueue() {
  const st = departLoadState();
  return !!(st && Array.isArray(st.queue) && st.queue.length && (st.curIdx || 0) < st.queue.length);
}

export function departSavedQueueInfo() {
  const st = departLoadState();
  if (!st || !Array.isArray(st.queue) || !st.queue.length) return null;
  return { total: st.queue.length, curIdx: st.curIdx || 0, startedAt: st.startedAt || null, lastAt: departQueueLastActivity(st), stale: departQueueIsStale(departQueueLastActivity(st), Date.now(), DEPART_MAX_QUEUE_AGE_MS) };
}

export function departDiscardSavedQueue() {
  departResetRun();
  departClearState();
  departClearStop();
  log('[עזיבה] התור השמור נמחק לבקשת המשתמש');
  return true;
}

// בטעינת דף: תור שמור → ממשיכים (אחרי שה-MS AJAX מסיים לאתחל). תור ישן (>30 דק') ממשיך
// רק אחרי "המשך" בפאנל. רשת-ביטחון: מעל DEPART_MAX_LANDINGS טעינות לתלמיד → "דולג".
export async function departResumeIfPending(opts) {
  if (DEPART_S.running) return false;
  const allowStale = !!(opts && opts.allowStale);
  const st = departLoadState();
  if (!st || !Array.isArray(st.queue) || !st.queue.length) return false;

  if (departIsStopped()) { log('[המשך] דגל עצירה - מנקים מצב'); departClearState(); departClearStop(); return false; }
  if (!allowStale && departQueueIsStale(departQueueLastActivity(st), Date.now(), DEPART_MAX_QUEUE_AGE_MS)) {
    log(`[המשך] תור עזיבה שמור, פעילות אחרונה ${departQueueLastActivity(st)}, ישן מ-${Math.round(DEPART_MAX_QUEUE_AGE_MS / 60000)} דקות - לא ממשיכים אוטומטית`);
    departHook('onStaleQueue', { total: st.queue.length, curIdx: st.curIdx || 0, startedAt: st.startedAt || null, lastAt: departQueueLastActivity(st), stale: true });
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
export function departStop() {
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
