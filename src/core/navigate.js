// זיהוי דף + ניווט אמין לסוג-לימוד דרך גריד "סוגי לימוד למוסד" (לא עץ-הצד השבור).
// לכידה-01 (דף מוסד), לכידה-02 (דף סוג-לימוד), לכידה-03 (דף תלמיד-חדש) — סעיפים מצוינים בהערות.
// אין גישה ל-document/window/sessionStorage ברמת המודול — רק בתוך גופי הפונקציות (import תקין ב-Node).

import { $el, sleep } from './dom.js';
import { firePostback } from './prm.js';

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

// ─── זיהוי דף ────────────────────────────────────────────────────────────────

// טהורה: מיון ראשוני לפי URL בלבד ("מועמד" — newStudent עדיין דורש אימות hidStudentState ב-getPage).
export function classifyUrl(url) {
  if (typeof url !== 'string') return 'other';
  if (url.includes('InstitutesDetails.aspx')) return 'institute';
  if (url.includes('StudyTypeDetails.aspx')) return 'studyType';
  if (url.includes('Students/StudentsDetails.aspx')) return 'newStudent';
  return 'other';
}

export function getPage() {
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

// DOM-touching, לא נבדק ביחידה: ממיר <table> ל-מערך-שורות של טקסטי-תאים (trimmed).
export function gridToRows(table) {
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
export async function gotoStudyTypeFromInstitute(code) {
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

// NEEDS_CONTEXT (Task 9): ה-ID/סלקטור המדויק של מיכל עץ-הסניפים tvTalmud לא מלא בלכידה
// (הסופיקס בלבד מאומת: ...ucTalmudSideBar_tvTalmud) — איתור לפי סיומת ID.
// חשוב: זה גורם ל-navigate מלא (לא PRM/async) — ה-Promise עלול לעולם לא להתממש כי
// הדף עצמו נטען-מחדש. **הקורא חייב לשמור את מצב ההמשך (resume state) שלו *לפני* הקריאה
// לפונקציה הזו, לא אחריה** — אין הבטחה ש-then/await אחריה ירוצו.
export async function gotoBranch(code) {
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
