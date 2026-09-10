// זיהוי דף + ניווט אמין לסוג-לימוד דרך גריד "סוגי לימוד למוסד" (לא עץ-הצד השבור).
// לכידה-01 (דף מוסד), לכידה-02 (דף סוג-לימוד), לכידה-03 (דף תלמיד-חדש) — סעיפים מצוינים בהערות.
// אין גישה ל-document/window/sessionStorage ברמת המודול — רק בתוך גופי הפונקציות (import תקין ב-Node).

import { $el } from './dom.js';
import { firePostback, waitPRM } from './prm.js';
import { log } from './log.js';

const NAV_KEY = 'talmud.absorb.nav';

// ─── sessionStorage: מצב-ניווט (לכידה-02 §1 — סניף לא ידוע בדף סוג-לימוד) ───

export function saveNavState(obj) {
  try { sessionStorage.setItem(NAV_KEY, JSON.stringify(obj)); } catch (e) { /* אצווה לא נתקעת */ }
}

// תמיד מחזיר אובייקט, לעולם לא זורק (חסר / JSON פגום / sessionStorage לא קיים => {}).
export function loadNavState() {
  try {
    const raw = sessionStorage.getItem(NAV_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

export function clearNavState() {
  try { sessionStorage.removeItem(NAV_KEY); } catch (e) { /* אצווה לא נתקעת */ }
}

// ─── W4: מפת סניף→InstituteID (localStorage — נלמדת לצמיתות, לא לפי-טאב) ─────
// F1 (בדיקה רטובה 10.9.2026): לכל סניף דף-מוסד משלו,
// Institutes/InstitutesDetails.aspx?InstituteID=<id> (‏00→491, 16→4159). ניווט לסניף
// מוכר = location.href ישיר — עוקף את עץ-הצד (F2: לא אמין מדף סוג-לימוד, ולא מנווט
// כלל מדף תלמיד-חדש). המפה נלמדת אוטומטית ב-getPage: דף מוסד עם h1 "סניף NN" +
// InstituteID ב-URL. ה-seed הוא רק נקודת-פתיחה; מה שנלמד דורס אותו.
const NAV_BRANCH_IDS_KEY = 'talmud.absorb.branchIds';
export const NAV_BRANCH_IDS_SEED = { '00': '491', '16': '4159' };
const NAV_INSTITUTE_PAGE = 'https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx?InstituteID=';

// טהורה: InstituteID מה-URL (לא רגיש לרישיות — ASP.NET לא מבחין). אין/לא-מספרי => null.
export function parseInstituteId(url) {
  if (typeof url !== 'string') return null;
  const m = /[?&]InstituteID=(\d+)(?:&|#|$)/i.exec(url);
  return m ? m[1] : null;
}

// טהורה: מפה חדשה עם הזוג (סניף מרופד לשתי ספרות → id כמחרוזת). קלט לא-תקין => עותק זהה.
export function mergeBranchIds(map, branch, id) {
  const out = Object.assign({}, map && typeof map === 'object' && !Array.isArray(map) ? map : {});
  const b = String(branch == null ? '' : branch).trim();
  const i = String(id == null ? '' : id).trim();
  if (!/^\d{1,2}$/.test(b) || !/^\d+$/.test(i)) return out;
  out[b.padStart(2, '0')] = i;
  return out;
}

// טהורה (I1): מפה חדשה בלי הסניף (מחיקת מיפוי שגוי). סניף לא-תקין/לא-קיים => עותק זהה.
export function forgetBranchId(map, branch) {
  const out = Object.assign({}, map && typeof map === 'object' && !Array.isArray(map) ? map : {});
  const b = String(branch == null ? '' : branch).trim();
  if (/^[0-9]{1,2}$/.test(b)) delete out[b.padStart(2, '0')];
  return out;
}

// טהורה: URL דף-המוסד של InstituteID. id לא-מספרי => null (לא יורים ניווט ל-"undefined").
export function institutePageUrl(id) {
  const i = String(id == null ? '' : id).trim();
  return /^\d+$/.test(i) ? NAV_INSTITUTE_PAGE + i : null;
}

// מה שנלמד בלבד (בלי seed); localStorage חסר/פגום => {}. לעולם לא זורק.
function loadLearnedBranchIds() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(NAV_BRANCH_IDS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch (e) { /* אצווה לא נתקעת */ }
  return {};
}

// תמיד מחזיר מפה (seed + מה שנלמד); localStorage חסר/פגום => seed בלבד. לעולם לא זורק.
export function loadBranchIds() {
  return Object.assign({}, NAV_BRANCH_IDS_SEED, loadLearnedBranchIds());
}

// ‏I1: מוחק מיפוי שנלמד (ה-seed אינו נמחק — עובדה מהבדיקה הרטובה). מחזיר true רק כשהסניף
// באמת נעלם מהמפה הממוזגת.
function unlearnBranchId(branch) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(NAV_BRANCH_IDS_KEY, JSON.stringify(forgetBranchId(loadLearnedBranchIds(), branch)));
    return loadBranchIds()[String(branch).padStart(2, '0')] === undefined;
  } catch (e) {
    return false;
  }
}

// לומד זוג אחד. כותב רק כשמשהו באמת השתנה (getPage נקרא בפולינג). מחזיר true כשנכתב.
export function learnBranchId(branch, id) {
  try {
    const cur = loadBranchIds();
    const next = mergeBranchIds(cur, branch, id);
    const key = String(branch == null ? '' : branch).trim().padStart(2, '0');
    if (!next[key] || next[key] === cur[key]) return false;
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(NAV_BRANCH_IDS_KEY, JSON.stringify(next));
    return true;
  } catch (e) {
    return false;
  }
}

// ‏W1+W4: דף מוסד עם h1 קריא הוא האמת — נרשמת ל-nav state עם provenance 'h1' (ומחליפה
// כל 'pending' של ניווט קודם), יחד עם URL/InstituteID של הדף, והמפה לומדת את הזוג.
// כותב רק כשמשהו השתנה — getPage נקרא בפולינג (חתימת-דף) ואין טעם לכתוב כל 200ms.
function navRememberInstitutePage(nav, branch, url) {
  const instituteId = parseInstituteId(url);
  // ‏I1 ריפוי-עצמי: gotoBranch(NN) ניווט ל-URL שהמפה הבטיחה ל-NN, ונחתנו על דף של סניף אחר →
  // המיפוי NN→id שגוי (נלמד פעם מרינדור-במקום) ונמחק; אחרת כל ניווט ל-NN היה נכשל לנצח (דולג).
  if (nav.branchSource === 'pending' && nav.currentBranch && nav.currentBranch !== branch && instituteId
      && loadBranchIds()[nav.currentBranch] === instituteId && unlearnBranchId(nav.currentBranch)) {
    log(`[ניווט] מיפוי סניף ${nav.currentBranch} → InstituteID שגוי נמחק`);
  }
  if (nav.currentBranch !== branch || nav.branchSource !== 'h1' || nav.instituteUrl !== url || nav.instituteId !== instituteId) {
    saveNavState(Object.assign({}, nav, { currentBranch: branch, branchSource: 'h1', instituteId, instituteUrl: url }));
  }
  // ‏I1: לומדים רק כשה-URL באמת השתנה מדף-המוסד האחרון. קליק-עץ שמרנדר את הדף במקום (POST לאותו
  // URL: h1 "סניף 16", URL עדיין InstituteID=491) אסור שילמד 16→491. נחיתה ראשונה
  // (instituteUrl לא מוגדר) עדיין לומדת.
  if (instituteId && url !== nav.instituteUrl) learnBranchId(branch, instituteId);
}

// ─── זיהוי דף ────────────────────────────────────────────────────────────────

// טהורה: מיון ראשוני לפי URL בלבד ("מועמד" — newStudent עדיין דורש אימות hidStudentState ב-getPage).
export function classifyUrl(url) {
  if (typeof url !== 'string') return 'other';
  if (url.includes('InstitutesDetails.aspx')) return 'institute';
  if (url.includes('StudyTypeDetails.aspx')) return 'studyType';
  if (url.includes('Students/StudentsDetails.aspx')) return 'newStudent';
  return 'other';
}

// טהורה (A1): מספר הסניף מתוך טקסט ה-h1 של דף המוסד ("<מוסד> סניף NN", לכידה-01 §5),
// מרופד לשתי ספרות. אין התאמה / קלט לא-מחרוזת => null.
export function parseBranchFromH1(text) {
  if (typeof text !== 'string') return null;
  const m = /סניף\s*(\d+)/.exec(text);
  return m ? String(m[1]).padStart(2, '0') : null;
}

// ‏A1: ‏`branchSource` אומר מאין הגיע `branch`:
//   'h1'     — נקרא מה-h1 של דף המוסד = אמת מאומתת מול הדף שמולנו;
//   'stored' — הגיע מ-sessionStorage (הצהרה של ניווט קודם, לא ראיה על הדף הנוכחי);
//   null     — אין סניף כלל.
// הקורא שמחליט "אנחנו בסניף הנכון" חייב לדרוש 'h1'; 'stored' עלול להיות של סניף אחר
// לגמרי (ניווט שנבלע, ניווט ידני של המשתמש) והתלמיד ייקלט לסניף השגוי בלי שום סימן.
// ‏W1: ‏`navSource` = ה-provenance הרשום ב-nav state עצמו ('h1' | 'pending' | null):
//   'h1'      — הסניף השמור נקרא מ-h1 של דף מוסד בטאב הזה, ושום ניווט לא דרס אותו מאז;
//   'pending' — gotoBranch כתב אותו לפני ירי ניווט שטרם אומת (ואולי נבלע) — לא לסמוך;
//   null      — מצב ישן/ריק. בדף סוג-לימוד/תלמיד-חדש `branch` הוא תמיד 'stored' מבחינת
//   הדף, ורק navSource==='h1' מצדיק מסלול-מהיר (absorb.js, absorbStoredBranchTrusted).
export function getPage() {
  const url = (typeof location !== 'undefined' && location.href) || '';
  const kind0 = classifyUrl(url);

  if (kind0 === 'institute') {
    // לכידה-01 §5: זיהוי סניף מ-h1 "<מוסד> סניף NN"; נופל חזרה למצב שמור אם ה-h1 לא נמצא/לא תואם.
    const h1 = typeof document !== 'undefined' ? document.querySelector('h1') : null;
    const fromH1 = parseBranchFromH1((h1 && h1.textContent) || '');
    const nav = loadNavState();
    const stored = nav.currentBranch || null;
    const branch = fromH1 || stored;
    const branchSource = fromH1 ? 'h1' : (stored ? 'stored' : null);
    if (fromH1) navRememberInstitutePage(nav, fromH1, url); // W1+W4: אמת מה-h1 → nav state + מפה
    const navSource = fromH1 ? 'h1' : (nav.branchSource || null);
    return { kind: 'institute', branch, branchSource, navSource, studyType: null, url };
  }

  if (kind0 === 'studyType') {
    // לכידה-02 §1: אין מספר סניף בדף הזה כלל (לא ב-h1, לא ב-breadcrumb) — המקור היחיד: sessionStorage.
    const nav = loadNavState();
    const branch = nav.currentBranch || null;
    // לכידה-02 §1: h1 = "סוג לימוד 600 - כולל אברכים יום שלם" — הקוד המספרי הראשון אחרי "סוג לימוד".
    const h1 = typeof document !== 'undefined' ? document.querySelector('h1') : null;
    const m = h1 && /סוג לימוד\s*(\d+)/.exec(h1.textContent || '');
    const studyType = m ? m[1] : null;
    return { kind: 'studyType', branch, branchSource: branch ? 'stored' : null, navSource: nav.branchSource || null, studyType, url };
  }

  if (kind0 === 'newStudent') {
    // לכידה-03 §1/§2: אותו URL גם לבאג-הניווט מהעץ (דף ריק) וגם לתלמיד-חדש אמיתי —
    // ההבחנה היחידה המתועדת: SD~hidStudentState == -1 (SD~ = ContentPlaceHolder1_TabsStudent_
    // StudentDetails1_ucStudentDetails_, לכידה-03 §2).
    const hid = $el('ContentPlaceHolder1_TabsStudent_StudentDetails1_ucStudentDetails_hidStudentState');
    const isNewStudent = !!hid && String(hid.value).trim() === '-1';
    if (isNewStudent) {
      const nav = loadNavState();
      const branch = nav.currentBranch || null;
      return { kind: 'newStudent', branch, branchSource: branch ? 'stored' : null, navSource: nav.branchSource || null, studyType: null, url };
    }
    return { kind: 'other', branch: null, branchSource: null, navSource: null, studyType: null, url };
  }

  return { kind: 'other', branch: null, branchSource: null, navSource: null, studyType: null, url };
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
export function findStudyTypeRow(rows, code) {
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

// טהורה (B5): מיקום השורה **במערך** (כולל שורות-כותרת/פייג'ר), להבדיל מ-findStudyTypeRow
// שמחזיר את אינדקס שורת-הנתונים. ‏gridToRows ממפה tr אחד לכל איבר, ולכן המיקום הזה הוא
// גם האינדקס של ה-<tr> המתאים — כך אפשר לקרוא את ה-onclick של השורה עצמה.
export function findStudyTypeRowPosition(rows, code) {
  if (!Array.isArray(rows)) return -1;
  const target = String(code).trim();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const first = String(row[0] ?? '').trim();
    if (!/^\d+$/.test(first)) continue;
    if (first === target) return i;
  }
  return -1;
}

// טהורה (B5): האינדקס שהדף עצמו מצהיר עליו — onclick="selectedRowStudyType('N')"
// (לכידה-02 §2). עדיף על ספירה שלנו: הוא בדיוק מה ש-hidStudyTypeID יקבל.
export function parseSelectedRowIndex(onclickText) {
  if (typeof onclickText !== 'string') return null;
  const m = /selectedRowStudyType\s*\(\s*['"]?(\d+)['"]?\s*\)/.exec(onclickText);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// טהורה (B5): חתימת-עמוד לגילוי "הפייג'ר לא התקדם". התא הראשון של כל שורת-נתונים
// (הקוד) + מספרן — אם אלה זהים אחרי דפדוף, לא עברנו עמוד ואין טעם להמשיך.
export function gridPageSignature(rows) {
  if (!Array.isArray(rows)) return '';
  const codes = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const first = String(row[0] ?? '').trim();
    if (/^\d+$/.test(first)) codes.push(first);
  }
  return `${codes.length}|${codes.join(',')}`;
}

// DOM-touching, לא נבדק ביחידה: ממיר <table> ל-מערך-שורות של טקסטי-תאים (trimmed).
export function gridToRows(table) {
  if (!table || typeof table.querySelectorAll !== 'function') return [];
  return Array.from(table.querySelectorAll('tr')).map(
    (tr) => Array.from(tr.querySelectorAll('td,th')).map((cell) => (cell.textContent || '').trim())
  );
}

// NEEDS_CONTEXT (לבדיקה רטובה, Task 9): לכידה-01/02 לא מתעדות את מנגנון-ההפעלה המדויק
// של הטאב ("$find(...).set_activeTabIndex(1)" מול פשוט הקלקה על כותרת הטאב), ולא את ה-ID
// המלא של ה-TabContainer. מנחת-הבטיחות כאן: איתור כותרת הטאב לפי הטקסט שלה תחת
// מוסכמת-ה-CSS הסטנדרטית של AjaxControlToolkit (ajax__tab_header/ajax__tab_tab) או
// role="tab" גנרי; אם לכותרת יש href בפורמט __doPostBack יורים אותו דרך firePostback.
// ‏B6: הלכידות חלוקות על הסיומת ("סוגי לימוד למוסד" מול "סוגי לימוד") — מתאימים לפי
// הקידומת המשותפת, ומעדיפים כותרת שמתחילה ב"סוגי לימוד" על פני כזו שרק מכילה אותו.
// ‏B2: גם לחיצה "צד-לקוח" עוברת בסדר הקשיח — waitPRM נרשם *לפני*, הלחיצה ב-setTimeout(0);
// מעבר-טאב שאינו postback פשוט יחזיר started=false מהר, וזה בסדר גמור.
const STUDY_TYPE_TAB_LABEL = 'סוגי לימוד';

function tabText(el) {
  return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
}

async function activateStudyTypeTab() {
  try {
    if (typeof document === 'undefined') return { ok: false, reason: 'אין document (סביבת בדיקה?)' };
    const headers = Array.from(document.querySelectorAll('.ajax__tab_header a, .ajax__tab_tab, [role="tab"]'));
    const tab = headers.find((el) => tabText(el).startsWith(STUDY_TYPE_TAB_LABEL))
      || headers.find((el) => tabText(el).includes(STUDY_TYPE_TAB_LABEL));
    if (!tab) return { ok: false, reason: 'לא נמצא טאב "סוגי לימוד למוסד" בעמוד המוסד' };

    const href = typeof tab.getAttribute === 'function' ? tab.getAttribute('href') : null;
    const parsed = href ? parsePostbackHref(href) : null;
    if (parsed) return firePostback(parsed.target, parsed.arg);

    const wait = waitPRM({ startTimeoutMs: 800, totalTimeoutMs: 8000 }); // (1) נרשם קודם
    setTimeout(() => { try { tab.click(); } catch (e) { /* אצווה לא נתקעת */ } }, 0); // (2) נדחה
    const res = await wait;
    if (res && res.ok === false) {
      return { ok: false, reason: 'מעבר לטאב סוגי הלימוד נכשל: ' + (res.reason || 'postback לא הושלם') };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'שגיאה בהפעלת טאב סוגי הלימוד: ' + (e && e.message) };
  }
}

// NEEDS_CONTEXT (Task 9): ה-ID המלא של gvStudyType לא מופיע בלכידה (רק סיומת
// "...InsStudyTypes_ucStudyTypeSearch_gvStudyType") — לכן איתור לפי סיומת ID, לא ID מדויק.
// NEEDS_CONTEXT (Task 9): פורמט קישורי הפייג'ר (Page$Next / Page$<n> — מוסכמת GridView
// סטנדרטית) לא מאומת מול הדף החי; הלולאה חסומה גם ע"י תקרה קשיחה כדי שלעולם לא תיתקע.
// ‏B5: ‏`opts.shouldAbort` (אופציונלי) — פרדיקט שנבדק לפני כל דפדוף. הקורא (absorb.js)
// מעביר "הדור שלי כבר לא הנוכחי, או שהמשתמש ביקש לעצור"; אנחנו לא זורקים אלא מחזירים
// ‏{ok:false, aborted:true} — הקורא ימות בגבול-השלב שלו (checkStop) ולא באמצע לולאה כאן.
const STUDY_TYPE_MAX_PAGE_FLIPS = 25; // תקרת-ביטחון: לכל היותר 25 דפדופים (26 קריאות גריד)

export async function gotoStudyTypeFromInstitute(code, opts) {
  const shouldAbort = opts && typeof opts.shouldAbort === 'function' ? opts.shouldAbort : null;
  const aborted = (where) => ({ ok: false, aborted: true, reason: `הניווט לסוג הלימוד בוטל (${where})` });

  const tab = await activateStudyTypeTab();
  if (!tab.ok) return tab;
  if (shouldAbort && shouldAbort()) return aborted('אחרי הפעלת הטאב');

  for (let flip = 0; ; flip++) {
    const table = typeof document !== 'undefined' ? document.querySelector('table[id$="gvStudyType"]') : null;
    if (!table) return { ok: false, reason: 'לא נמצא גריד סוגי הלימוד (gvStudyType) בעמוד' };

    const rows = gridToRows(table);
    const position = findStudyTypeRowPosition(rows, code);

    if (position !== -1) {
      if (typeof window === 'undefined' || typeof window.selectedRowStudyType !== 'function') {
        return { ok: false, reason: 'selectedRowStudyType אינה זמינה בעמוד' };
      }
      // ‏B5(c): קודם כול האינדקס שהשורה עצמה מצהירה עליו (onclick), ורק אם אין — הספירה שלנו.
      const tr = Array.from(table.querySelectorAll('tr'))[position] || null;
      const onclick = (tr && typeof tr.getAttribute === 'function' && tr.getAttribute('onclick')) || '';
      const fromAttr = parseSelectedRowIndex(onclick);
      const rowIndex = fromAttr === null ? findStudyTypeRow(rows, code) : fromAttr;
      if (rowIndex === -1) return { ok: false, reason: `סוג לימוד ${code} לא נמצא בגריד` };
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
    if (flip >= STUDY_TYPE_MAX_PAGE_FLIPS) {
      return { ok: false, reason: `סוג לימוד ${code} לא נמצא בגריד (חריגה ממספר הדפים המותר)` };
    }
    if (shouldAbort && shouldAbort()) return aborted(`לפני דפדוף ${flip + 1}`);

    const signatureBefore = gridPageSignature(rows);
    const res = await firePostback(next.target, next.arg);
    if (!res.ok) return res;

    // ‏B5(b): גילוי אי-התקדמות — אם אותו עמוד בדיוק חזר, הדפדוף לא עבד (קישור פייג'ר
    // שנבלע/פורמט לא צפוי) והמשך הלולאה רק ישרוף postbacks על אותו עמוד.
    const tableAfter = typeof document !== 'undefined' ? document.querySelector('table[id$="gvStudyType"]') : null;
    if (tableAfter && gridPageSignature(gridToRows(tableAfter)) === signatureBefore) {
      return { ok: false, reason: `דפדוף הגריד לא התקדם (עמוד ${flip + 1}) — סוג לימוד ${code} לא נמצא` };
    }
  }
}

// ─── עץ הסניפים (tvTalmud) — לכידה-01 §1: "זה כן עובד — רק סוגי-הלימוד שבורים" ─

// טהורה: href של צומת-סניף מסתיים ב-\<קוד דו-ספרתי>' (backslash+קוד+גרש-סוגר),
// לפני ה-')' הסוגר של קריאת ה-__doPostBack. צומת-ילד (סוג-לימוד) ממשיך אחרי הקוד
// ולכן לא תואם (ראו דוגמה בטסט: \00\(720)כולל...).
export function findBranchHref(hrefs, code) {
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
export function parsePostbackHref(href) {
  if (typeof href !== 'string') return null;
  const m = /^(?:javascript:)?__doPostBack\('([^']*)'\s*,\s*'([^']*)'\)\s*;?$/.exec(href.trim());
  if (!m) return null;
  return { target: m[1], arg: m[2] };
}

// ניווט לסניף. שרשרת-המפלט (W4, בדיקה רטובה 10.9.2026 — F1/F2):
//   1. הסניף במפה (branchIds) → location.href לדף-המוסד שלו. ניווט מלא, אמין מכל דף.
//      מחזיר {ok:true, started:true, method:'url'} מיד אחרי הירי — הדף מתחיל להיפרק.
//   2. לא במפה, אבל אנחנו בדף מוסד → קליק בעץ-הצד (postback; הוכח ב-v3.2 *מדף המוסד*).
//      NEEDS_CONTEXT: הסלקטור של tvTalmud לפי סיומת ID בלבד (...ucTalmudSideBar_tvTalmud).
//   3. לא במפה ולא בדף מוסד (סוג-לימוד / תלמיד-חדש — שם העץ לא מנווט, F2) → קופצים (hop)
//      לדף-המוסד האחרון הידוע (nav.instituteUrl; ואם אין — seed של סניף 00). שם ה-resume
//      יקרא שוב ל-gotoBranch ויעשה את שלב 2. מחזיר {…, method:'url', hop:true}.
// בכל המסלולים nav state נכתב עם branchSource:'pending' *לפני* הירי. ההצהרה הזו אינה
// אמת עד שדף-מוסד עם h1 תואם מחליף אותה ב-'h1' (getPage); הקורא משחזר את המצב הקודם
// אם הניווט לא קרה, ומסלול-מהיר לעולם לא צורך 'pending'.
// חשוב: ניווט מלא (לא PRM/async) — ה-Promise עלול לעולם לא להתממש כי הדף נטען-מחדש.
// **הקורא חייב לשמור את מצב ההמשך (resume state) שלו *לפני* הקריאה, לא אחריה.**
export async function gotoBranch(code) {
  if (typeof document === 'undefined') return { ok: false, reason: 'אין document (סביבת בדיקה?)' };
  const padded = String(code).trim().padStart(2, '0');
  const nav = loadNavState();
  const pending = Object.assign({}, nav, { currentBranch: padded, branchSource: 'pending' });
  const url = (typeof location !== 'undefined' && location.href) || '';

  // (1) סניף מוכר → URL ישיר
  const target = institutePageUrl(loadBranchIds()[padded]);
  if (target) {
    saveNavState(pending);
    return navGoToUrl(target, { method: 'url' });
  }

  // (2) דף מוסד → עץ-הצד (v3.2)
  if (classifyUrl(url) === 'institute') {
    const tree = document.querySelector('[id$="tvTalmud"]');
    if (!tree) return { ok: false, reason: 'לא נמצא עץ הסניפים (tvTalmud)' };
    const anchors = Array.from(tree.querySelectorAll('a'));
    const hrefs = anchors.map((a) => a.getAttribute('href') || '');
    const idx = findBranchHref(hrefs, padded);
    if (idx === -1) return { ok: false, reason: `סניף ${padded} לא נמצא בעץ הצד` };
    const parsed = parsePostbackHref(hrefs[idx]);
    if (!parsed) return { ok: false, reason: 'קישור הסניף לא בפורמט __doPostBack צפוי' };
    saveNavState(pending);
    const res = await firePostback(parsed.target, parsed.arg);
    return Object.assign({ method: 'tree' }, res);
  }

  // (3) דף אחר → קפיצה לדף-מוסד ידוע, ומשם שלב 2 ב-resume
  const lastInstitute = nav.instituteUrl && classifyUrl(nav.instituteUrl) === 'institute' ? nav.instituteUrl : null;
  const hop = lastInstitute || institutePageUrl(NAV_BRANCH_IDS_SEED['00']);
  saveNavState(pending);
  return navGoToUrl(hop, { method: 'url', hop: true });
}

// ניווט מלא לפי URL. לא postback — אין PRM להמתין לו; הדף מתחיל להיפרק מיד (beforeunload/
// pagehide, שהקורא מאזין להם). כישלון (location לא זמין / חריגה) => {ok:false}, כדי שהקורא
// ישחזר את nav state ולא יחכה לטעינה שלא תבוא.
function navGoToUrl(target, extra) {
  try {
    if (typeof location === 'undefined') return { ok: false, reason: 'אין location (סביבת בדיקה?)' };
    location.href = target;
    return Object.assign({ ok: true, started: true, via: target }, extra || {});
  } catch (e) {
    return { ok: false, reason: 'ניווט לפי URL נכשל: ' + (e && e.message) };
  }
}
