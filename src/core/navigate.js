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

import { $el } from './dom.js';
import { firePostback, waitPRM } from './prm.js';
import { log } from './log.js';

const DEFAULT_ORIGIN = 'https://talmud.edu.gov.il';
const INSTITUTES_PAGE_PATH = '/Institutes/InstitutesDetails.aspx';
// ממצא ב-2: תקציב לפוסטבק שמנווט (עריכה בגריד, עץ, לשונית). כשהתשובה היא pageRedirect אין endRequest,
// ושרת איטי מעבר ל-8 שניות גרם ל-{ok:false} ולסימון התלמיד "שגיאה" רגע לפני שהדף נפרק.
export const NAV_POSTBACK_BUDGET_MS = 25000;
// תקציב לתלמיד (4.0.2): הגבול הכולל נגזר מסכום תקציבי-הצעדים ועוד רזרבה להמתנות הקטנות שביניהם. גבול קטן מהסכום (היה
// 60 שניות) סימן בשרת איטי "תהליך תקוע" לפני שצעד כלשהו נכשל, ובלי לומר איזה.
export const STUDENT_RESERVE_MS = 15000;
export function runBudgetMs(stepBudgets, reserveMs) {
  return Object.values(stepBudgets || {}).reduce((total, ms) => total + ms, 0) + reserveMs;
}

// ─── כתובות ─────────────────────────────────────────────────────────────────

function siteOrigin() {
  try {
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.host) return location.origin;
  } catch (e) { /* Node */ }
  return DEFAULT_ORIGIN;
}

// טהורה: InstituteID מה-URL (לא רגיש לרישיות). למידע בלבד: הכתובת אינה קובעת מה מוצג (F1).
export function parseInstituteId(url) {
  if (typeof url !== 'string') return null;
  const m = /[?&]InstituteID=(\d+)(?:&|#|$)/i.exec(url);
  return m ? m[1] : null;
}

// טהורה: InstituteStudyTypeID מה-URL. למידע בלבד.
export function parseInstituteStudyTypeId(url) {
  if (typeof url !== 'string') return null;
  const m = /[?&]InstituteStudyTypeID=(\d+)(?:&|#|$)/i.exec(url);
  return m ? m[1] : null;
}

// דף המוסדות בלי query: ה-session קובע איזה סניף יוצג; המטרה היא רק להגיע לדף שיש בו עץ-צד (F2).
export function institutesPageUrl() {
  return `${siteOrigin()}${INSTITUTES_PAGE_PATH}`;
}

// ─── פרסור טקסטים מהדף (טהור) ───────────────────────────────────────────────

const padBranch2 = (v) => String(v == null ? '' : v).trim().padStart(2, '0');

// "<מוסד> סניף NN" → "NN" (מרופד). אין => null.
export function parseBranchFromH1(text) {
  if (typeof text !== 'string') return null;
  const m = /סניף\s*(\d{1,2})(?!\d)/.exec(text);
  return m ? padBranch2(m[1]) : null;
}

// "סוג לימוד 600 - כולל..." → "600". אין => null.
export function parseStudyTypeFromH1(text) {
  if (typeof text !== 'string') return null;
  const m = /סוג לימוד\s*(\d+)/.exec(text);
  return m ? m[1] : null;
}

// טהורה: "0"/"00"/"7" → "00"/"00"/"07"; קלט לא-תקין → null.
export function normalizeBranch(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d{1,2}$/.test(s) ? s.padStart(2, '0') : null;
}

// ─── זיהוי דף ───────────────────────────────────────────────────────────────

export function classifyUrl(url) {
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
export function getPage() {
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
export function findStudyTypeRow(rows, code) {
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
export function findStudyTypeRowPosition(rows, code) {
  if (!Array.isArray(rows)) return -1;
  const target = String(code).trim();
  for (let i = 0; i < rows.length; i++) {
    if (isStudyTypeDataRow(rows[i]) && String(rows[i][0]).trim() === target) return i;
  }
  return -1;
}

// טהורה: onclick="selectedRowStudyType('N')" → N.
export function parseSelectedRowIndex(onclickText) {
  if (typeof onclickText !== 'string') return null;
  const m = /selectedRowStudyType\s*\(\s*['"]?(\d+)['"]?\s*\)/.exec(onclickText);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// טהורה: חתימת-עמוד (הקודים בעמוד) לגילוי "הפייג'ר לא התקדם".
export function gridPageSignature(rows) {
  if (!Array.isArray(rows)) return '';
  const codes = [];
  for (const row of rows) {
    if (isStudyTypeDataRow(row)) codes.push(String(row[0]).trim());
  }
  return `${codes.length}|${codes.join(',')}`;
}

// טהורה: הקודים ומצב-הזכאות מהגריד (למשל לתפריט הבחירה בפאנל). [{code, desc, status}]
export function gridStudyTypes(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    if (!isStudyTypeDataRow(row)) continue;
    out.push({ code: String(row[0]).trim(), desc: String(row[1] ?? '').trim(), status: String(row[3] ?? '').trim() });
  }
  return out;
}

// מערך של מערכי-תאים לכל tr; לכל שורה דגל selectable (ממצא ב-8): יש onclick עם selectedRowStudyType.
export function gridToRows(table) {
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
export function parsePostbackHref(href) {
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
export async function readStudyTypesFromInstitutePage(opts) {
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
export async function gotoStudyTypeFromInstitute(code, opts) {
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
export function findBranchHref(hrefs, code) {
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
export function branchesFromTreeHrefs(hrefs) {
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

export function readBranchesFromTree() {
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
export async function gotoInstitute(branch) {
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
export async function gotoStudyType(branch, code) {
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
