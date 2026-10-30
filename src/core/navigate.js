// זיהוי דף + ניווט לפי עובדות מאומתות מהאתר (בדיקה רטובה 10.9.2026):
//   דף מוסד:      /Institutes/InstitutesDetails.aspx?InstituteID=<id>      h1 "<מוסד> סניף NN"
//   דף סוג-לימוד: /StudyType/StudyTypeDetails.aspx?InstituteStudyTypeID=<x>&InstituteID=<id>
//                 h1 "סוג לימוד 600 - <תיאור>", פירורי-לחם "... > <מוסד> > 16 > (600)<תיאור>"
//   דף תלמיד-חדש: /Students/StudentsDetails.aspx?  עם hidStudentState=-1 ו-txtID ממולא
// הסניף נקרא מהדף עצמו (h1 / פירורי-לחם / כתובת), לא מזיכרון. שתי מפות נלמדות ב-localStorage:
// סניף→InstituteID, ו-(סניף,סוג)→InstituteStudyTypeID — כך ניווט הוא קפיצה ישירה לפי כתובת,
// והגריד/העץ משמשים רק בביקור הראשון. אין גישה ל-document/window ברמת המודול (import תקין ב-Node).

import { $el } from './dom.js';
import { firePostback, waitPRM } from './prm.js';
import { log } from './log.js';

const NAV_KEY = 'talmud.nav';
const BRANCH_IDS_KEY = 'talmud.nav.branchIds';
const STUDY_TYPE_IDS_KEY = 'talmud.nav.studyTypeIds';
const DEFAULT_ORIGIN = 'https://talmud.edu.gov.il';
export const NAV_BRANCH_IDS_SEED = { '00': '491', '16': '4159' };
// ממצא ב-2: תקציב לפוסטבק שמנווט (עריכה בגריד, עץ, טאב). כשהתשובה היא pageRedirect אין endRequest,
// ושרת איטי מעבר ל-8 שניות גרם ל-{ok:false} ולסימון התלמיד "שגיאה" רגע לפני שהדף נפרק.
export const NAV_POSTBACK_BUDGET_MS = 25000;

// ─── כתובות ─────────────────────────────────────────────────────────────────

function siteOrigin() {
  try {
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.host) return location.origin;
  } catch (e) { /* Node */ }
  return DEFAULT_ORIGIN;
}

// טהורה: InstituteID מה-URL (לא רגיש לרישיות). אין/לא-מספרי => null.
export function parseInstituteId(url) {
  if (typeof url !== 'string') return null;
  const m = /[?&]InstituteID=(\d+)(?:&|#|$)/i.exec(url);
  return m ? m[1] : null;
}

// טהורה: InstituteStudyTypeID מה-URL.
export function parseInstituteStudyTypeId(url) {
  if (typeof url !== 'string') return null;
  const m = /[?&]InstituteStudyTypeID=(\d+)(?:&|#|$)/i.exec(url);
  return m ? m[1] : null;
}

export function institutePageUrl(id) {
  const i = String(id == null ? '' : id).trim();
  return /^\d+$/.test(i) ? `${siteOrigin()}/Institutes/InstitutesDetails.aspx?InstituteID=${i}` : null;
}

export function studyTypePageUrl(studyTypeInstId, instituteId) {
  const s = String(studyTypeInstId == null ? '' : studyTypeInstId).trim();
  const i = String(instituteId == null ? '' : instituteId).trim();
  if (!/^\d+$/.test(s) || !/^\d+$/.test(i)) return null;
  return `${siteOrigin()}/StudyType/StudyTypeDetails.aspx?InstituteStudyTypeID=${s}&InstituteID=${i}`;
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

// פירורי-הלחם של דף סוג-לימוד: "... > <מוסד> > 16 > (600)כולל..." → "16".
// דורש שהקוד בסוגריים יתאים לסוג-הלימוד של הדף (h1), כדי לא לתפוס מספר אחר בטקסט.
export function parseBranchFromBreadcrumb(text, studyType) {
  if (typeof text !== 'string' || !studyType) return null;
  const flat = text.replace(/\s+/g, ' ');
  const re = new RegExp('(\\d{1,2})\\s*[>›»/]\\s*\\(\\s*' + String(studyType).replace(/\D/g, '') + '\\s*\\)');
  const m = re.exec(flat);
  return m ? padBranch2(m[1]) : null;
}

// טהורה: "0"/"00"/"7" → "00"/"00"/"07"; קלט לא-תקין → null.
export function normalizeBranch(v) {
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
export function mergeBranchIds(map, branch, id) {
  const out = Object.assign({}, map && typeof map === 'object' && !Array.isArray(map) ? map : {});
  const b = normalizeBranch(branch);
  const i = String(id == null ? '' : id).trim();
  if (!b || !/^\d+$/.test(i)) return out;
  out[b] = i;
  return out;
}

// seed + נלמד. לעולם לא זורק.
export function loadBranchIds() {
  return Object.assign({}, NAV_BRANCH_IDS_SEED, readJson(BRANCH_IDS_KEY));
}

// טהורה: הסניף שממופה ל-InstituteID (חיפוש הפוך). אין => null.
export function branchForInstituteId(map, id) {
  const i = String(id == null ? '' : id).trim();
  if (!i || !map) return null;
  for (const [b, v] of Object.entries(map)) if (String(v) === i) return b;
  return null;
}

// לומד סניף→InstituteID. ‏authoritative=false (דף מוסד): לא דורס מיפוי קיים (של ה-id לסניף אחר, או
// של הסניף ל-id אחר, כולל seed): קליק-עץ עשוי לרנדר סניף אחר באותה כתובת (ממצא 2: בלי ההגנה
// על ה-seed, "00" נלמד מחדש ל-id של הסניף המוצג וכל ניווט ל-00 נחת שם). ‏authoritative=true
// (דף סוג-לימוד עם פירורי-לחם): הכתובת נוצרה בשרת ומחייבת: דורס. מחזיר true כשנכתב משהו חדש.
export function learnBranchId(branch, id, opts) {
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
    if (cur[b] && cur[b] !== i) {
      log(`[ניווט] סניף ${b} כבר ממופה למוסד ${cur[b]}; לא דורסים מדף המוסד (רק מפירורי-לחם של דף סוג-לימוד)`);
      return false;
    }
  }
  const learned = readJson(BRANCH_IDS_KEY);
  learned[b] = i;
  if (writeJson(BRANCH_IDS_KEY, learned)) { log(`[ניווט] נלמד: סניף ${b} → מוסד ${i}`); return true; }
  return false;
}

// ממצא 2: דף מוסד שה-h1 שלו סותר את המפה (ה-id בכתובת ממופה לסניף אחר): מוחקים את הרשומה
// הנלמדת הסותרת, כדי שמיפוי מורעל לא יהיה דביק. רשומת seed אינה נמחקת (אין מה למחוק).
function forgetContradictingBranch(instituteId, h1Branch) {
  const mapped = branchForInstituteId(loadBranchIds(), instituteId);
  if (!mapped || mapped === h1Branch) return false;
  const learned = readJson(BRANCH_IDS_KEY);
  if (!(mapped in learned)) return false;
  delete learned[mapped];
  if (writeJson(BRANCH_IDS_KEY, learned)) {
    log(`[ניווט] המפה אמרה מוסד ${instituteId} = סניף ${mapped}, אך הדף מציג סניף ${h1Branch}; הרשומה ${mapped}→${instituteId} נמחקה`);
    return true;
  }
  return false;
}

export function loadStudyTypeIds() {
  return readJson(STUDY_TYPE_IDS_KEY);
}

export function studyTypeKey(branch, code) {
  const b = normalizeBranch(branch);
  const c = String(code == null ? '' : code).trim();
  return b && /^\d+$/.test(c) ? `${b}|${c}` : null;
}

// טהורה (ממצא ב-1ב): הרשומה של (סניף|סוג) כ-{id, instituteId}. רשומה ישנה (מחרוזת id בלבד) נקראת
// עם instituteId null; רשומה פגומה או חסרה → null.
export function studyTypeRecord(map, branch, code) {
  const key = studyTypeKey(branch, code);
  const raw = key && map && typeof map === 'object' ? map[key] : null;
  if (!raw) return null;
  if (typeof raw === 'string') return /^\d+$/.test(raw) ? { id: raw, instituteId: null } : null;
  if (typeof raw !== 'object') return null;
  const id = String(raw.id == null ? '' : raw.id).trim();
  if (!/^\d+$/.test(id)) return null;
  const inst = String(raw.instituteId == null ? '' : raw.instituteId).trim();
  return { id, instituteId: /^\d+$/.test(inst) ? inst : null };
}

// ממצא ב-1ב: הרשומה שומרת גם את ה-InstituteID שנצפה בכתובת, כדי שהכתובת הישירה תיבנה ממנו ולא
// ממפת-הסניפים של עכשיו (שעלולה להשתנות בינתיים).
export function learnStudyTypeId(branch, code, id, instituteId) {
  const key = studyTypeKey(branch, code);
  const i = String(id == null ? '' : id).trim();
  if (!key || !/^\d+$/.test(i)) return false;
  const inst = String(instituteId == null ? '' : instituteId).trim();
  const rec = { id: i, instituteId: /^\d+$/.test(inst) ? inst : null };
  const cur = loadStudyTypeIds();
  const prev = studyTypeRecord(cur, branch, code);
  if (prev && prev.id === rec.id && prev.instituteId === rec.instituteId) return false;
  cur[key] = rec;
  if (writeJson(STUDY_TYPE_IDS_KEY, cur)) { log(`[ניווט] נלמד: סניף ${key.split('|')[0]} סוג ${key.split('|')[1]} → ${i} (מוסד ${rec.instituteId || '?'})`); return true; }
  return false;
}

// ממצא ב-1ג: דף סוג-לימוד שהסניף שלו נקרא מהדף: אם רשומה של (סניף אחר|אותו סוג) מצביעה על אותו
// InstituteStudyTypeID, היא מורעלת (נלמדה ממקור לא-מאומת) ונמחקת. מחזיר את מספר הרשומות שנמחקו.
function forgetPoisonedStudyTypeIds(instituteStudyTypeId, branch, code) {
  const id = String(instituteStudyTypeId == null ? '' : instituteStudyTypeId).trim();
  const c = String(code == null ? '' : code).trim();
  if (!id || !c) return 0;
  const cur = loadStudyTypeIds();
  let removed = 0;
  for (const key of Object.keys(cur)) {
    const [b, kc] = key.split('|');
    if (kc !== c || b === branch) continue;
    const rec = studyTypeRecord(cur, b, kc);
    if (!rec || rec.id !== id) continue;
    delete cur[key];
    removed++;
    log(`[ניווט] הרשומה סניף ${b} סוג ${kc} → ${id} סותרת את הדף (מציג סניף ${branch}); נמחקה`);
  }
  if (removed) writeJson(STUDY_TYPE_IDS_KEY, cur);
  return removed;
}

// ─── מצב-ניווט (sessionStorage): כוונת-ניווט + הדפים האחרונים ─────────────

export function saveNavState(obj) {
  try { sessionStorage.setItem(NAV_KEY, JSON.stringify(obj || {})); } catch (e) { /* אצווה לא נתקעת */ }
}

export function loadNavState() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(NAV_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

export function clearNavState() {
  try { sessionStorage.removeItem(NAV_KEY); } catch (e) { /* אצווה לא נתקעת */ }
}

function updateNavState(patch) {
  saveNavState(Object.assign({}, loadNavState(), patch));
}

// ממצא 7: כוונת-ניווט היא רמז קצר-מועד. נמחקת בסיום/עצירה/התחלה/ניקוי-תור, ופגה אחרי 2 דקות.
export const NAV_INTENT_MAX_AGE_MS = 2 * 60 * 1000;

export function clearNavIntent() {
  if (loadNavState().intent) updateNavState({ intent: null });
}

// ממצא 2: "שכח מיפויים": מוחק את שתי המפות הנלמדות (ה-seed בקוד נשאר).
export function forgetNavMaps() {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.removeItem(BRANCH_IDS_KEY);
    localStorage.removeItem(STUDY_TYPE_IDS_KEY);
    log('[ניווט] המיפויים הנלמדים (סניף→מוסד, סוג-לימוד→כתובת) נמחקו לבקשת המשתמש');
    return true;
  } catch (e) {
    return false;
  }
}

// ─── זיהוי דף ───────────────────────────────────────────────────────────────

export function classifyUrl(url) {
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

// ממצא 1א: באתר יש SiteMapPath רגיל ("בית > ...", בלי סניף) ועוד אלמנט שמכיל את הסניף. האלמנט
// הראשון שתואם אינו בהכרח הנכון, ולכן אוספים את *כל* האלמנטים התואמים + 3000 התווים הראשונים
// של ה-body, ומחברים. הפרסור (parseBranchFromBreadcrumb) דורש "NN > (קוד)" ולכן לא יתבלבל מהעודף.
function breadcrumbText() {
  try {
    if (typeof document === 'undefined') return '';
    const parts = [];
    const els = document.querySelectorAll('[id*="BreadCrumb" i], [id*="SiteMapPath" i], .breadcrumbs, .breadcrumb, [class*="breadcrumb" i]');
    for (const el of Array.from(els || [])) {
      const t = (el && (el.innerText || el.textContent)) || '';
      if (t) parts.push(t);
    }
    const body = document.body ? (document.body.innerText || '') : '';
    if (body) parts.push(body.slice(0, 3000));
    return parts.join('\n');
  } catch (e) {
    return '';
  }
}

// ממצא 7: כוונה תקפה רק עם חותמת-זמן טרייה (עד 2 דקות). כוונה בלי חותמת (פורמט ישן) אינה ראיה.
function freshIntent(nav, now) {
  const intent = nav && nav.intent;
  if (!intent || typeof intent !== 'object') return null;
  const at = typeof intent.at === 'number' ? intent.at : NaN;
  if (Number.isNaN(at) || now - at > NAV_INTENT_MAX_AGE_MS || now < at) return null;
  return intent;
}

// מחזיר תמיד אובייקט. ‏branchSource בדף סוג-לימוד, לפי סדר האמון:
//   'breadcrumb' (הדף עצמו, מחייב) → 'institute' (דף המוסד האחרון בלשונית הזו, שה-h1 שלו נקרא,
//   ושה-InstituteID שבכתובתו זהה לזה שבכתובת כאן) → 'map' (המפה הנלמדת, לא מאומת) → 'intent'
//   (רמז בלבד; לא לומדים ממנו, ממצא 1ג) → null. הזרימה סומכת רק על breadcrumb/institute (ממצא 1ב).
// ‏opts.learn=false (ממצא ב-5): קריאה-בלבד, בלי ללמוד ובלי למחוק (אחרי קליק-עץ שמרנדר במקום, ה-h1
// מציג סניף אחר באותה כתובת, ולימוד משם מוחק מיפוי נכון וכותב שגוי). ‏opts.init=true: טעינת-דף מלאה,
// ורק אז דף מוסד שה-h1 שלו סותר את המפה מוחק את הרשומה הסותרת (ממצא 2).
export function getPage(opts) {
  const learn = !(opts && opts.learn === false);
  const init = !!(opts && opts.init);
  const url = (typeof location !== 'undefined' && location.href) || '';
  const kind = classifyUrl(url);

  if (kind === 'institute') {
    const branch = parseBranchFromH1(h1Text());
    const instituteId = parseInstituteId(url);
    if (branch && instituteId && learn) {
      if (init) forgetContradictingBranch(instituteId, branch); // ממצא 2, רק בטעינת-דף מלאה (ממצא ב-5)
      learnBranchId(branch, instituteId, { authoritative: false });
    }
    if (branch && learn) updateNavState({ lastInstituteUrl: url, lastInstituteBranch: branch });
    return { kind, branch, branchSource: branch ? 'h1' : null, instituteId, studyType: null, url };
  }

  if (kind === 'studyType') {
    const studyType = parseStudyTypeFromH1(h1Text());
    const instituteId = parseInstituteId(url);
    const instituteStudyTypeId = parseInstituteStudyTypeId(url);
    const nav = loadNavState();
    let branch = parseBranchFromBreadcrumb(breadcrumbText(), studyType);
    let branchSource = branch ? 'breadcrumb' : null;
    if (!branch && instituteId && nav.lastInstituteBranch && parseInstituteId(nav.lastInstituteUrl || '') === instituteId) {
      branch = normalizeBranch(nav.lastInstituteBranch);
      if (branch) branchSource = 'institute';
    }
    if (!branch && instituteId) {
      branch = branchForInstituteId(loadBranchIds(), instituteId);
      if (branch) branchSource = 'map';
    }
    if (!branch) {
      // כוונת-ניווט: הגענו הנה מדף מוסד של סניף X בבקשה לסוג-לימוד Y, וה-h1 מאשר Y.
      const intent = freshIntent(nav, Date.now());
      if (intent && intent.studyType && studyType && String(intent.studyType) === String(studyType) && normalizeBranch(intent.branch)) {
        branch = normalizeBranch(intent.branch);
        branchSource = 'intent';
      }
    }
    const trusted = branchSource === 'breadcrumb' || branchSource === 'institute' || branchSource === 'map';
    // ממצא ב-1א: רשומת סוג-לימוד רק ממקור שנקרא מהדף (breadcrumb/institute). סניף מהמפה בלבד אינו
    // ראיה: רשומה שנלמדה ממנו הפנתה כל תלמיד של (סניף,סוג) לדף של סניף אחר, 8 נחיתות ו"דולג".
    const verified = branchSource === 'breadcrumb' || branchSource === 'institute';
    if (learn) {
      if (branch && instituteId && trusted) learnBranchId(branch, instituteId, { authoritative: branchSource === 'breadcrumb' });
      if (branch && studyType && instituteStudyTypeId && verified) {
        forgetPoisonedStudyTypeIds(instituteStudyTypeId, branch, studyType); // ממצא ב-1ג
        learnStudyTypeId(branch, studyType, instituteStudyTypeId, instituteId);
      }
      if (branch) updateNavState({ intent: null, lastStudyTypeUrl: url, lastStudyTypeBranch: branch, lastStudyTypeCode: studyType });
    }
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

// ממצא ב-5: קריאה-בלבד של הדף (בלי ללמוד מפות ובלי לעדכן מצב-ניווט).
export function readPage() {
  return getPage({ learn: false });
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

// טהורה: מיקום השורה במערך (כולל כותרת) — כדי לקרוא את ה-<tr> עצמו.
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
export function parsePostbackHref(href) {
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
    const wait = waitPRM({ startTimeoutMs: 600, totalTimeoutMs: NAV_POSTBACK_BUDGET_MS });
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

// מדף המוסד: טאב → שורה בגריד (עם דפדוף) → selectedRowStudyType → postback "עריכה" → ניווט מלא.
export async function gotoStudyTypeFromInstitute(code, opts) {
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
      return { ok: false, reason: `דפדוף הגריד לא התקדם (עמוד ${flip + 1}) — סוג לימוד ${code} לא נמצא` };
    }
  }
}

// ─── עץ הסניפים (tvTalmud) — רק כשהסניף עוד לא במפה ────────────────────────

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

export function readBranchesFromTree() {
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
export async function gotoInstitute(branch) {
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
    const res = await firePostback(parsed.target, parsed.arg, { startTimeoutMs: 1500, totalTimeoutMs: NAV_POSTBACK_BUDGET_MS });
    const out = Object.assign({ method: 'tree', branch: b }, res, { ok: res.ok !== false });
    // ממצא 3: ברטוב נצפה שקליק-עץ הוא postback א-סינכרוני שמרנדר את הסניף *במקום* (אותה כתובת).
    // אם הדף כבר מציג את הסניף המבוקש, אין טעינת דף בדרך: הקורא ממשיך מיד (גריד), בלי כלב-שומר.
    // ממצא ב-5: קוראים את ה-h1 בלי ללמוד: הכתובת עדיין של הסניף הקודם, ולימוד משם מרעיל את המפה.
    if (out.ok) {
      const now = readPage();
      if (now.kind === 'institute' && now.branch === b) out.inPlace = true;
    }
    return out;
  }

  const nav = loadNavState();
  const hop = (nav.lastInstituteUrl && classifyUrl(nav.lastInstituteUrl) === 'institute' ? nav.lastInstituteUrl : null)
    || institutePageUrl(NAV_BRANCH_IDS_SEED['00']);
  return navGoToUrl(hop, { branch: b, hop: true });
}

// ניווט לדף סוג-לימוד. סדר: כתובת ידועה (קפיצה ישירה) → מדף המוסד של הסניף דרך הגריד →
// אחרת לדף המוסד (ומשם, אחרי הטעינה, הגריד). מחזיר {ok, method:'url'|'grid'|'tree'|..., notFound?}.
export async function gotoStudyType(branch, code) {
  const b = normalizeBranch(branch);
  const c = String(code == null ? '' : code).trim();
  if (!b || !/^\d+$/.test(c)) return { ok: false, reason: `סניף/סוג לימוד לא תקינים: ${branch}/${code}` };
  updateNavState({ intent: { branch: b, studyType: c, at: Date.now() } });

  // ממצא ב-1ב: הכתובת הישירה נבנית מה-InstituteID שנשמר ברשומה; רשומה ישנה (בלי מוסד) נופלת למפה.
  const rec = studyTypeRecord(loadStudyTypeIds(), b, c);
  const direct = rec ? studyTypePageUrl(rec.id, rec.instituteId || loadBranchIds()[b]) : null;
  if (direct) return navGoToUrl(direct, { branch: b, studyType: c });

  const page = getPage();
  if (page.kind === 'institute' && page.branch === b) {
    const res = await gotoStudyTypeFromInstitute(c);
    return Object.assign({ branch: b, studyType: c }, res);
  }
  const res = await gotoInstitute(b);
  if (res && res.ok && res.inPlace) {
    // ממצא 3: העץ רינדר את הסניף במקום: ממשיכים מיד לגריד (זו הטעינה המלאה האמיתית)
    const grid = await gotoStudyTypeFromInstitute(c);
    return Object.assign({ branch: b, studyType: c, treeInPlace: true }, grid);
  }
  return Object.assign({ studyType: c }, res);
}
