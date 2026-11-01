// קליטה: החלק הטהור: סטטוסים, ניתוח הגריד, תוצאות (TSV/CSV), דוח "מה נשאר", הכרעות קטנות.
// אין כאן DOM בכלל; הכל נבדק ביחידה (test/absorb-pure.test.js).

import { padId9 } from '../core/identity.js';
import { parsePostbackHref } from '../core/navigate.js';

// הנוסחים (שכבת-הבהירות 1.11.2026): קצרים, בלי מקף ארוך, "לבדוק" = צהוב (לא תקלה), השאר אדום.
export const ABSORB_STATUS = {
  OK: 'נקלט',
  OK_NEW: 'נקלט (תלמיד חדש)',
  EXISTS: 'כבר קיים',
  SAVED_UNVERIFIED: 'נשמר, לבדוק ברשימה',
  VERIFY: 'לבדוק ברשימה', // ממצא 10: ברשימה שורה יחידה עם מזהה אחר: לא הצלחה, המשתמש בודק
  UNVERIFIED: 'לא נמצא ברשימה אחרי הקליטה',
  NOT_COMPLETED: 'הקליטה לא הושלמה',
  BLOCKED: 'נחסם',
  NEW_STUDENT_MISSING: 'תלמיד חדש: חסרים פרטים',
  ERROR: 'שגיאה',
  SKIPPED: 'דולג',
  STOPPED: 'נעצר',
};

const ABSORB_SUCCESS_KEYS = [ABSORB_STATUS.OK, ABSORB_STATUS.OK_NEW, ABSORB_STATUS.EXISTS];
const ABSORB_VERIFY_KEYS = [ABSORB_STATUS.SAVED_UNVERIFIED, ABSORB_STATUS.VERIFY, ABSORB_STATUS.UNVERIFIED];
const ABSORB_STOPPED_KEYS = [ABSORB_STATUS.STOPPED, ABSORB_STATUS.SKIPPED];

// אזהרת "רשום כבר במוסד אחר" של האתר (המקרה השכיח של "נחסם"); משמשת גם את הזרימה וגם את הממשק.
export const OTHER_INSTITUTE_RE = /רשום כבר במוסד אחר/;

// סוג התוצאה לצבע ולתגיות: 'ok' (ירוק) | 'verify' (צהוב, לבדוק) | 'stopped' (צהוב, לא רץ) | 'bad' (אדום, דורש טיפול).
export function absorbResultKind(status) {
  const key = absorbStatusKey(status);
  if (ABSORB_SUCCESS_KEYS.indexOf(key) !== -1) return 'ok';
  if (ABSORB_VERIFY_KEYS.indexOf(key) !== -1) return 'verify';
  if (ABSORB_STOPPED_KEYS.indexOf(key) !== -1) return 'stopped';
  return 'bad';
}

// ספירות לתגיות-הסיכום: נקלטו (נקלט + תלמיד חדש), כבר קיימים, לבדוק, דורשים טיפול, נעצרו.
export function absorbSummarizeKinds(results) {
  const c = { absorbed: 0, exists: 0, verify: 0, bad: 0, stopped: 0 };
  for (const r of Array.isArray(results) ? results : []) {
    const key = absorbStatusKey(r && r.status);
    if (key === ABSORB_STATUS.EXISTS) c.exists++;
    else {
      const k = absorbResultKind(r && r.status);
      if (k === 'ok') c.absorbed++; else c[k]++;
    }
  }
  return c;
}

// "נחסם" / "שגיאה" עם הודעת האתר: הסטטוס מקבל נוסח קצר; ההודעה המלאה נשארת ב"פירוט".
export function absorbShortStatus(kind, text) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (kind === ABSORB_STATUS.BLOCKED && OTHER_INSTITUTE_RE.test(t)) return `${kind}: רשום במוסד אחר`;
  if (!t) return kind;
  const short = t.length > 48 ? t.slice(0, 46).trim() + '…' : t;
  return `${kind}: ${short}`;
}

// האם תוצאת "נחסם" היא אזהרת "רשום במוסד אחר" (שמסומנת "אשר המשך" פותרת).
export function absorbIsOtherInstituteBlock(result) {
  return !!result && absorbStatusKey(result.status) === ABSORB_STATUS.BLOCKED && OTHER_INSTITUTE_RE.test(String(result.detail || result.status || ''));
}

export const ABSORB_TSV_HEADER = ['סניף', 'סוג לימוד', 'ת.ז./דרכון', 'סטטוס', 'מה לעשות'];
export const ABSORB_CSV_HEADER = ['סניף', 'סוג לימוד', 'ת.ז./דרכון', 'סטטוס', 'פירוט', 'מה לעשות'];
export const ABSORB_TEMPLATE_HEADER = ['סניף', 'סוג לימוד', 'ת.ז./דרכון', 'שם פרטי', 'שם משפחה', 'תאריך לידה', 'ארץ', 'מגדר', 'מצב משפחתי'];
export const ABSORB_MAX_QUEUE_AGE_MS = 30 * 60 * 1000; // מעל זה: אין המשך אוטומטי של תור שמור

// "נחסם: <טקסט>" → "נחסם".
export function absorbStatusKey(status) {
  const s = String(status == null ? '' : status);
  const i = s.indexOf(':');
  return (i === -1 ? s : s.slice(0, i)).trim();
}

export function isAbsorbSuccess(status) {
  return ABSORB_SUCCESS_KEYS.indexOf(absorbStatusKey(status)) !== -1;
}

// ת.ז. → ספרות בלי אפסים מובילים ("6136871" == "006136871"); דרכון → בלי רווחים/מקפים, רישיות אחידות.
export function absorbNormalizeId(raw) {
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
export function analyzeGrid(rows, identity, count) {
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

export function buildResultsTsv(results) {
  const lines = [ABSORB_TSV_HEADER.join('\t')];
  for (const r of Array.isArray(results) ? results : []) {
    lines.push([r.branch, r.studyType, r.identity, r.status, r.action].map(flatCell).join('\t'));
  }
  return lines.join('\n');
}

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
    const key = absorbStatusKey(r && r.status) || '-';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// דוח "מה נשאר": שורה אופרטיבית לכל תוצאה שאינה הצלחה + סיכום.
// טהורה (31.10.2026, זרימת-התיקון): אילו שורות-טבלה דורשות טיפול לפי תוצאות הריצה האחרונה: כל שורה
// שהתוצאה שלה (אותו סניף, סוג-לימוד ומזהה) אינה הצלחה. שורה בלי תוצאה (לא רצה) נשארת. מחזירה
// {rows, needsExtra}: needsExtra = יש "תלמיד חדש" שדורש שם/משפחה/תאריך לידה (לפתוח את העמודות).
export function absorbRowsNeedingAttention(rows, results) {
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

export function buildRemainingReport(results) {
  const list = Array.isArray(results) ? results : [];
  const counts = summarizeAbsorbResults(list);
  const lines = list
    .filter((r) => !isAbsorbSuccess(r && r.status))
    .map((r) => [r.branch, r.studyType, r.identity, r.status, r.action || '-'].map(flatCell).join(' · '));
  const summary = Object.keys(counts).map((k) => `${k}=${counts[k]}`).join(' · ');
  return { lines, summary, counts };
}

// "נמצאו N רשומות" → N; אין → null (אין עדות שהחיפוש רץ).
export function absorbParseCount(text) {
  const m = /נמצאו\s*(\d+)/.exec(String(text == null ? '' : text).trim());
  return m ? parseInt(m[1], 10) : null;
}

// מה לעשות עם תוצאת החיפוש המקדים (שם "לא נמצא" גורר לחיצת "קליטה", ולכן דורש עדות):
//   executed=false → 'error'; refreshed → 'analyze'; תווית לא-טרייה → 'error';
//   תווית טרייה 0 → 'analyze'; תווית טרייה 1+ בלי גריד טרי → 'retry'; אחרת 'error'.
export function absorbPrecheckDecision(res) {
  if (!res || typeof res !== 'object' || Array.isArray(res)) return 'error';
  if (!res.executed) return 'error';
  if (res.refreshed) return 'analyze';
  if (res.countFresh !== true) return 'error';
  if (res.count === 0) return 'analyze';
  if (typeof res.count === 'number' && Number.isFinite(res.count) && res.count >= 1) return 'retry';
  return 'error';
}

// רישום תוצאה אידמפוטנטי לכל שורה בתור.
export function absorbShouldRecord(lastRecordedIdx, idx) {
  if (typeof idx !== 'number' || !Number.isFinite(idx) || idx < 0) return false;
  const last = typeof lastRecordedIdx === 'number' && Number.isFinite(lastRecordedIdx) ? lastRecordedIdx : -1;
  return idx > last;
}

export function absorbQueueIsStale(startedAt, now, maxAgeMs) {
  const t0 = Date.parse(startedAt);
  if (!startedAt || Number.isNaN(t0)) return false;
  const nowMs = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.parse(now));
  if (Number.isNaN(nowMs)) return false;
  const max = typeof maxAgeMs === 'number' ? maxAgeMs : ABSORB_MAX_QUEUE_AGE_MS;
  return nowMs - t0 > max;
}

// מקור אחד לרשומת-תוצאה. ריפוד אפסים לת.ז., דרכון כמות-שהוא.
export function makeAbsorbResult(task, status, detail, action) {
  const t = task || {};
  const identity = t.idType === 'tz' ? padId9(t.identity) : String(t.identity == null ? '' : t.identity).trim();
  return {
    line: t.line, branch: t.branch, studyType: t.studyType, idType: t.idType, identity,
    status, detail: detail || '', action: action || '',
  };
}

// href של LinkButton: __doPostBack ישיר או WebForm_DoPostBackWithOptions (עם קבוצת ולידציה).
export function absorbParsePostbackFromHref(href) {
  const direct = parsePostbackHref(href);
  if (direct) return { target: direct.target, arg: direct.arg, group: '', validate: false };
  const m = /WebForm_PostBackOptions\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(true|false)\s*,\s*"([^"]*)"/.exec(String(href || ''));
  if (m) return { target: m[1], arg: m[2], group: m[4], validate: m[3] === 'true' };
  return null;
}

// F3 (30.10.2026): בדף סוג-לימוד הסניף נקרא *רק* מהתווית lblInstituteBranchNumber ('label'). פירורי-לחם,
// כתובת, מפה או כוונה אינם מקור, ולכן רק 'label' מספיק כדי לקלוט במקום.
export function absorbBranchSourceTrusted(source) {
  return source === 'label';
}

// ממצא ב-2: פוסטבק מנווט שפג זמנו (pageRedirect בלי endRequest) אחרי שהדף כבר התחיל להיפרק
// (beforeunload/pagehide) הוא טעינת-דף בדרך, לא כשל: ההמשך אחרי הטעינה, בלי לסמן "שגיאה".
export function absorbNavTimeoutIsNavigation(res, unloadSeen) {
  return !!(res && typeof res === 'object' && res.ok === false && res.timeout === true && unloadSeen === true);
}

// ממצא ב-3: פירוט לרשימה שלא ניתן לקרוא בה מזהים.
export function absorbUnreadableGridDetail(count) {
  return `הרשימה הציגה ${count} תוצאות אך לא ניתן לקרוא בה מזהים`;
}

// הוראה אופרטיבית לניווט ידני לסוג-לימוד (משותפת לכמה סטטוסים).
export function manualStudyTypeAction(branch, code) {
  return `פתח את דף המוסד של סניף ${branch}, לחץ על הלשונית "סוגי לימוד למוסד", לחץ על השורה של סוג ${code} ואז על "עריכה". כשדף סוג-הלימוד פתוח, לחץ "תקן והרץ שוב" והתחל`;
}
