// לשונית "קליטת תלמידים" בחלונית המאוחדת. הזרימה ב-absorb-flow.js; כאן הממשק (שכבת-הבהירות, סבב 3, 1.11.2026):
// ארבעה שלבים שמחליפים את המסך: הכנה (טבלת-ההזנה המשותפת מ-ui/grid.js: הדבקה מהלוח, רשימות מהנתונים האמיתיים,
// "סוג מזהה", שורת-פרטים לתלמיד חדש, תגיות שמסננות ומיון בכותרות) → ריצה (שורת-ריצה עם "עצור" אדום, התוצאות מצטברות)
// → תוצאות (תגיות שמסננות, "מה לעשות" מתחת לכל שורה, "תקן והרץ שוב", "קליטה חדשה") → תיקון והרצה חוזרת (טבלה רק עם מי
// שדורש טיפול, "מה קרה / מה לעשות" מתחת לכל שורה). שורת-המצב וסרגל-השלבים מחושבים מכל שינוי.
// מסלול-פרסור אחד: הטבלה → טקסט עם כותרת → parseAbsorbInput (כמו הדבקה). אין גישה ל-document ברמת המודול.

import { $el } from '../core/dom.js';
import { log } from '../core/log.js';
import { downloadCsv, copyTextToClipboard } from '../core/csv.js';
import { COUNTRIES } from '../data/countries.js';
import { detectIdType, resolveCountry, isValidIsraeliId, isIsraelCountry } from '../core/identity.js';
import { readBranchesFromTree, gridToRows, gridStudyTypes } from '../core/navigate.js';
import { parseAbsorbInput, absorbTextToFieldRows, absorbFieldRowsToText, ABSORB_FIELD_ORDER } from './absorb-parse.js';
import { loadXlsxFile } from './absorb-xlsx.js';
import {
  ABSORB_TEMPLATE_HEADER, isAbsorbSuccess, absorbStatusKey, absorbResultKind, absorbSummarizeKinds,
  absorbIsOtherInstituteBlock, absorbNormalizeId, buildResultsTsv, buildResultsCsvRows, absorbRowsNeedingAttention,
} from './absorb-report.js';
import { clearAbsorbStop, clearAbsorbLastResults } from './absorb-state.js';
import {
  absorbSetHooks, absorbStartRun, absorbResumeIfPending, absorbStop, absorbHasSavedQueue, absorbGetResults,
  absorbIsBusy, absorbSavedQueueInfo, absorbDiscardSavedQueue, absorbLastResults,
} from './absorb-flow.js';
import {
  esc, buttonHtml, buttonsRowHtml, fieldHtml, resultsTableHtml, tagHtml, zoneHtml, dateFieldHtml, bindDateFields, bindConfirmClick, dmyToIso, flash, setHtml, setText, show, setDisabled,
  bindDateMask, todayDMY,
} from '../ui/widgets.js';
import { createGrid, gridSortRows } from '../ui/grid.js';

const P = 'tt-absorb';
const CONTINUE_KEY = 'tt.absorb.continueOther'; // '0' = בעל-המערכת ביטל את "אשר המשך" (ברירת-המחדל: מסומן, הכרעה ט)
const COUNTRY_NAMES = COUNTRIES.map((c) => c.he).sort((a, b) => a.localeCompare(b, 'he'));
const COUNTRY_BY_VALUE = new Map(COUNTRIES.map((c) => [c.value, c.he]));
// סוגי-לימוד מוכרים (מהאתר, סניף 00) לרשימת-הבחירה כשאין גריד סוגי-לימוד בדף
const COMMON_STUDY_TYPES = ['300', '600', '605', '700', '705', '708', '720', '725', '728'];
const GENDERS = [['', ''], ['זכר', 'זכר'], ['נקבה', 'נקבה']];
const FAMILY = [['', ''], ['רווק', 'רווק'], ['נשוי', 'נשוי'], ['גרוש', 'גרוש'], ['אלמן', 'אלמן']];
const ID_TYPES = [['tz', 'ת.ז.'], ['passport', 'דרכון']];
const NEW_FIELDS = ['firstName', 'lastName', 'gender', 'familyStatus'];
export const ABSORB_STEPS = ['הכנה', 'ריצה', 'תוצאות', 'תיקון והרצה חוזרת'];
const STAGE_INDEX = { prep: 0, run: 1, results: 2, fix: 3 };

let ui = null;
let pageRef = null;
let grid = null;
let stage = 'prep';
let results = [];
let total = 0;
let awaitingErrorConfirm = false;
let resFilter = 'all'; // תגיות התוצאות: all | ok | exists | verify | bad | stopped
let resSort = null;
// ביקורת 2.11: השורות כפי שרצו (עם לידה, ארץ ופרטי תלמיד חדש), כי הטבלה מתרוקנת בסיום הריצה ו"תקן והרץ שוב" /
// "אשר המשך והרץ שוב" בונים ממנה, לא מהתוצאות הדלות
let lastRunRows = [];
let stageBeforeRun = 'prep'; // ריצה שנחסמה (לשונית אחרת) חוזרת לשלב שממנו יצאה
let awaitingErrorFilter = 'all'; // התגית שהייתה פעילה כש"התחל" ביקש אישור על אדומות; החלפת תגית מבטלת את הבקשה

const RESULT_COLUMNS = [
  { key: 'branch', label: 'סניף', center: true, width: '44px' },
  { key: 'studyType', label: 'סוג', center: true, width: '44px' },
  { key: 'identity', label: 'מספר', mono: true },
  { key: 'status', label: 'מה קרה' },
];

function emptyFields() {
  return { branch: '', studyType: '', idType: '', identifier: '', firstName: '', lastName: '', birthDate: '', country: '', gender: '', familyStatus: '' };
}
function newRow() { return { fields: emptyFields(), newOpen: false }; }
function rowFrom(fields) { return { fields: Object.assign(emptyFields(), fields || {}), newOpen: false }; }
function plural(n, one, many) { return n === 1 ? one : many.replace('N', String(n)); }

// ─── רשימות-בחירה: מהדף בלבד (עץ-הצד, גריד סוגי-הלימוד), בלי מפות נלמדות ───────────────
function knownBranches(page) {
  const set = new Set(readBranchesFromTree()); // העץ קיים בדף המוסד ובדף סוג-הלימוד (F2)
  if (page && page.branch) set.add(page.branch);
  return Array.from(set).sort();
}

// סוגי-הלימוד של סניף: ידועים רק כשהדף הוא דף המוסד של אותו סניף (הגריד). אחרת null = לא ידוע (לא מאמתים).
function knownStudyTypesFor(branch, page) {
  if (!(page && page.kind === 'institute' && page.branch && page.branch === branch)) return null;
  try {
    const table = document.querySelector('table[id$="gvStudyType"]');
    if (!table) return null;
    // גריד מחולק לעמודים (ממצא ב-8: פייג'ר כטבלה מקוננת / קישורי Page$): רואים רק חלק מהרשימה, ולכן לא מאמתים לפיה
    if (table.querySelector('table, a[href*="Page$"]')) return null;
    const list = gridStudyTypes(gridToRows(table)).map((st) => st.code);
    return list.length ? list : null;
  } catch (e) { return null; }
}

function knownStudyTypes(branch, page) {
  const set = new Set(knownStudyTypesFor(branch || (page && page.branch), page) || []);
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

// ─── סוג המזהה (הכרעות ג, 1ב) ─────────────────────────────────────────────────
// ניחוש: אותיות = דרכון; ספרות + ארץ (שאינה ישראל) = דרכון; אחרת ת.ז. הבחירה הידנית (fields.idType) גוברת.
export function absorbAutoIdType(f) {
  const id = String((f && f.identifier) || '').trim();
  if (!id) return 'tz';
  const det = detectIdType(id);
  if (det.type === 'passport') return 'passport';
  if (/^(tz|ת\.?ז\.?)\s*[:=]/i.test(id)) return 'tz';
  const country = String((f && f.country) || '').trim();
  return country && !isIsraelCountry(country) ? 'passport' : 'tz';
}
export function absorbEffectiveIdType(f) {
  return (f && (f.idType === 'tz' || f.idType === 'passport')) ? f.idType : absorbAutoIdType(f);
}

// הטבלה → טקסט לפרסור: בחירה ידנית ששונה מהניחוש נכתבת כקידומת מפורשת ("דרכון:" / "ת.ז.:") שהפרסור מכיר.
export function absorbRowsToText(list) {
  return absorbFieldRowsToText((list || []).map((r) => {
    const f = Object.assign({}, r.fields);
    const auto = absorbAutoIdType(f);
    const eff = absorbEffectiveIdType(f);
    const bare = String(f.identifier || '').trim();
    if (eff !== auto && bare && !/^(דרכון|passport|tz|ת\.?ז\.?)\s*[:=]/i.test(bare)) {
      f.identifier = (eff === 'passport' ? 'דרכון:' : 'ת.ז.:') + bare;
    }
    return { fields: f };
  }));
}

// שם-ארץ קנוני לתא (כינוי או שם באנגלית → השם ברשימת האתר); לא-מוכר נשאר כמו שהוקלד (ויסומן).
export function absorbCanonicalCountry(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || isIsraelCountry(s)) return s;
  const v = resolveCountry(s);
  return v && COUNTRY_BY_VALUE.has(v) ? COUNTRY_BY_VALUE.get(v) : s;
}

// ─── אימות הטבלה (טהור ככל האפשר; ctx = רשימות ידועות) ─────────────────────────
function rowIsBlank(r) { return ABSORB_FIELD_ORDER.every((k) => !String(r.fields[k] || '').trim()); }
function rowHasNewFields(r) { return NEW_FIELDS.some((k) => String(r.fields[k] || '').trim()); }

// הודעת-פרסור → נוסח לשורה (בלי מספרי-דוגמה, בלי שמות פנימיים)
export function absorbFriendlyError(reason, f) {
  const s = String(reason || '');
  if (/חסרים שדות חובה/.test(s)) {
    const miss = [];
    if (!String(f.branch || '').trim()) miss.push('סניף');
    if (!String(f.studyType || '').trim()) miss.push('סוג לימוד');
    if (!String(f.identifier || '').trim()) miss.push('מספר');
    return `חסר: ${miss.join(', ') || 'סניף, סוג לימוד או מספר'}`;
  }
  if (/סניף לא מספרי/.test(s)) return 'מספר סניף לא תקין. בחר סניף מהרשימה';
  if (/סוג לימוד לא מספרי/.test(s)) return 'סוג לימוד לא תקין (ספרות בלבד)';
  if (/תאריך לא תקין/.test(s)) return 'תאריך לידה לא תקין (יום/חודש/שנה)';
  if (/ארץ לא מוכרת/.test(s)) return 'ארץ לא ברשימה. בחר מהרשימה שנפתחת בתא';
  if (/מגדר לא ידוע/.test(s)) return 'מגדר: זכר או נקבה';
  if (/מצב משפחתי לא ידוע/.test(s)) return 'מצב משפחתי: רווק, נשוי, גרוש או אלמן';
  if (/ישראל אינה ארץ-דרכון/.test(s)) return 'ישראל אינה ארץ-דרכון. אם זו ת.ז., בחר "ת.ז."';
  return s;
}

// לכל שורה מלאה: {level: ''|'warn'|'bad', msg}. ctx: {branches: [..]|null, studyTypesFor(branch) → [..]|null}.
// אדום = לא ירוץ; צהוב = ירוץ עם אזהרה (ספרת-ביקורת, כפילות). מחזיר גם את המשימות שירוצו.
export function absorbValidateRows(list, ctx) {
  const filled = (list || []).filter((r) => !rowIsBlank(r));
  const parsed = parseAbsorbInput(absorbRowsToText(filled));
  const errorByIdx = new Map();
  for (const e of parsed.errors) errorByIdx.set(e.line - 2, e.reason); // מספר השורה בפרסור = אינדקס+2 (הכותרת היא 1)
  const issues = [];
  const seen = new Map();
  const counts = { all: filled.length, ready: 0, warn: 0, bad: 0 };
  filled.forEach((r, i) => {
    const f = r.fields;
    const eff = absorbEffectiveIdType(f);
    let level = '';
    let msg = '';
    const bare = String(f.identifier || '').trim();
    const parseErr = errorByIdx.get(i);
    if (parseErr) { level = 'bad'; msg = absorbFriendlyError(parseErr, f); }
    else if (eff === 'passport' && (!String(f.birthDate || '').trim() || !String(f.country || '').trim())) {
      const miss = [];
      if (!String(f.birthDate || '').trim()) miss.push('תאריך לידה');
      if (!String(f.country || '').trim()) miss.push('ארץ');
      level = 'bad'; msg = `דרכון: חסרים ${miss.join(', ')}`;
    } else if (ctx && Array.isArray(ctx.branches) && ctx.branches.length && !ctx.branches.includes(String(f.branch).trim().padStart(2, '0'))) {
      level = 'bad'; msg = 'סניף לא נמצא ברשימת הסניפים';
    } else {
      const known = ctx && typeof ctx.studyTypesFor === 'function' ? ctx.studyTypesFor(String(f.branch).trim().padStart(2, '0')) : null;
      if (Array.isArray(known) && known.length && !known.includes(String(f.studyType).trim())) { level = 'bad'; msg = 'סוג לימוד לא נמצא בסניף הזה'; }
    }
    if (!level) {
      const key = `${String(f.branch).trim().padStart(2, '0')}|${String(f.studyType).trim()}|${absorbNormalizeId(bare.replace(/^(דרכון|passport|tz|ת\.?ז\.?)\s*[:=]\s*/i, ''))}`;
      if (seen.has(key)) { level = 'warn'; msg = `כפול של שורה ${seen.get(key) + 1}`; }
      else {
        seen.set(key, i);
        const digits = bare.replace(/^(tz|ת\.?ז\.?)\s*[:=]\s*/i, '');
        if (eff === 'tz' && /^\d+$/.test(digits) && !isValidIsraeliId(digits)) {
          level = 'warn'; msg = 'ת.ז. לא תקינה (ספרת ביקורת). אם מדובר בדרכון: בחר "דרכון" ומלא תאריך לידה וארץ';
        }
      }
    }
    issues.push({ level, msg });
    counts[level === 'bad' ? 'bad' : (level === 'warn' ? 'warn' : 'ready')]++;
  });
  const tasks = parsed.tasks.filter((t) => { const iss = issues[t.line - 2]; return !(iss && iss.level === 'bad'); });
  return { filled, issues, tasks, counts };
}

function validationCtx() {
  const branches = knownBranches(pageRef);
  return { branches: branches.length ? branches : null, studyTypesFor: (b) => knownStudyTypesFor(b, pageRef) };
}

// ─── הגדרת הטבלה (ui/grid.js) ───────────────────────────────────────────────
function cellInput(i, key, value, width) {
  return `<input type="text" class="tt-input" data-i="${i}" data-k="${key}" value="${esc(value)}" style="width:${width}" autocomplete="off">`;
}
function cellSelect(i, key, value, options) {
  return `<select class="tt-select" data-i="${i}" data-k="${key}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function gridColumns() {
  const passport = (f) => absorbEffectiveIdType(f) === 'passport';
  const needBirth = (f, row) => passport(f) || rowHasNewFields(row) || !!row.newOpen;
  const branches = knownBranches(pageRef);
  return [
    branches.length
      ? { key: 'branch', label: 'סניף', kind: 'select', width: '58px', options: () => [['', '']].concat(branches.map((b) => [b, b])) }
      : { key: 'branch', label: 'סניף', kind: 'input', width: '56px', mono: true, placeholder: 'סניף', list: `${P}-dl-branches` },
    { key: 'studyType', label: 'סוג לימוד', kind: 'input', width: '54px', mono: true, placeholder: 'סוג', list: `${P}-dl-studytypes` },
    // שורה ריקה: הבחירה הידנית נשמרת (ביקורת 2.11: קודם אופסה ונדרסה, והתיבה קפצה ל"ת.ז.")
    { key: 'idType', label: 'סוג מזהה', kind: 'select', width: '66px', options: () => ID_TYPES, value: (f, row) => (rowIsBlank(row) ? (f.idType || 'tz') : absorbEffectiveIdType(f)), sortValue: (f) => absorbEffectiveIdType(f) },
    { key: 'identifier', label: 'מספר', kind: 'input', width: '96px', mono: true, placeholder: 'מספר' },
    { key: 'birthDate', label: 'תאריך לידה', kind: 'date', width: '86px', placeholder: (f, row) => (needBirth(f, row) ? 'יום/חודש/שנה' : ''), off: (f, row) => !needBirth(f, row), need: (f) => passport(f) && !String(f.birthDate || '').trim(), sortValue: (f) => dmyToIso(f.birthDate) || f.birthDate },
    { key: 'country', label: 'ארץ', kind: 'input', width: '90px', placeholder: (f) => (passport(f) ? 'בחר ארץ' : ''), list: `${P}-dl-countries`, off: (f) => !passport(f), need: (f) => passport(f) && !String(f.country || '').trim() },
  ];
}

function subRowHtml(row, i) {
  const f = row.fields;
  return `<div class="tt-sub-row">
    <span>פרטי תלמיד חדש:</span>
    <span>שם פרטי</span>${cellInput(i, 'firstName', f.firstName, '84px')}
    <span>שם משפחה</span>${cellInput(i, 'lastName', f.lastName, '84px')}
    <span>מגדר</span>${cellSelect(i, 'gender', f.gender, GENDERS)}
    <span>מצב משפחתי</span>${cellSelect(i, 'familyStatus', f.familyStatus, FAMILY)}
  </div>`;
}

// סבב 5 (הכרעה א): תיבת-סימון בעמודת "תלמיד חדש"; סימון פותח את שורת-הפרטים, ביטול סוגר ומוחק אותה
// (כשיש פרטים: ביטול ראשון רק מזהיר, ביטול שני בתוך 6 שניות מוחק)
function rowActions(row, i) {
  const on = row.newOpen || rowHasNewFields(row);
  return `<label class="tt-newcb" title="סמן אם האתר לא מכיר את התלמיד: נפתחת שורה לשם, משפחה, מגדר ומצב משפחתי"><input type="checkbox" data-newcb="${i}"${on ? ' checked' : ''}></label>`;
}

function refreshRow(tr, sub, row) {
  const f = row.fields;
  const newOn = rowHasNewFields(row);
  const open = !!(row.newOpen || newOn);
  const cb = tr.querySelector('input[data-newcb]'); if (cb && cb.checked !== open) cb.checked = open;
  if (sub) {
    for (const k of ['firstName', 'lastName']) { const inp = sub.querySelector(`input[data-k="${k}"]`); if (inp) inp.classList.toggle('tt-need', open && !String(f[k] || '').trim()); }
  }
}

let newClearPending = null; // { i, t }: ביטול-סימון ראשון של שורה עם פרטים

function onGridClick(e, rows) {
  const t = e.target;
  const cb = t && t.closest ? t.closest('input[data-newcb]') : null;
  if (!cb) return false;
  const i = Number(cb.getAttribute('data-newcb'));
  const r = rows[i];
  if (!r) return false;
  if (cb.checked) {
    r.newOpen = true;
    newClearPending = null;
    setTimeout(() => { const inp = document.querySelector(`#${P}-grid tr.tt-sub[data-sub="${i}"] input[data-k="firstName"]`); if (inp) inp.focus(); }, 0);
    return true;
  }
  if (rowHasNewFields(r)) {
    const key = rowKey(r.fields);
    if (newClearPending && newClearPending.key === key && Date.now() - newClearPending.t < 6000) {
      for (const k of NEW_FIELDS) r.fields[k] = '';
      r.newOpen = false;
      newClearPending = null;
      grid.render();
      ui.status('פרטי התלמיד החדש נמחקו');
      return false;
    }
    newClearPending = { key, t: Date.now() };
    grid.refresh(); // מחזיר את התיבה למסומנת (ומרענן את שורת-המצב), ולכן ההודעה נכתבת אחריו
    ui.status('בשורה יש פרטי תלמיד חדש. בטל את הסימון שוב בתוך 6 שניות כדי למחוק אותם');
    return false;
  }
  r.newOpen = false;
  return true;
}

function buildGrid() {
  grid = createGrid({
    id: P,
    inputId: `${P}-input`,
    columns: gridColumns(),
    fieldKeys: ABSORB_FIELD_ORDER,
    actionsLabel: 'תלמיד חדש',
    newRow,
    fromText: (text) => absorbTextToFieldRows(text).map((r) => rowFrom(r.fields)),
    validate: (list) => absorbValidateRows(list, validationCtx()),
    rowActions, subRowHtml, refreshRow,
    subOpen: (row) => !!(row.newOpen || rowHasNewFields(row)),
    onClick: onGridClick,
    onCell: (row, k, el, type) => { if (k === 'country' && type === 'change') el.value = absorbCanonicalCountry(el.value); if (awaitingErrorConfirm) awaitingErrorConfirm = false; },
    onChange: (v) => { refreshStartButton(v); refreshStatus(v); },
    onStatus: (msg) => ui.status(msg),
    onFilled: (label, n) => { const v = grid.validation(); log(`[קלט] ${label}: ${n} שורות · ${v ? v.counts.bad : 0} לא ירוצו · ${v ? v.counts.warn : 0} אזהרות`); },
    emptyText: (mode) => (mode === 'fix' ? 'אין מי שדורש טיפול.' : 'אין שורות עדיין. מלא שורה, הדבק מאקסל או טען קובץ אקסל.'),
  });
}

// ─── שלבים ──────────────────────────────────────────────────────────────────
function setStage(s) {
  stage = s;
  show(`${P}-zone-in`, s === 'prep' || s === 'fix');
  show(`${P}-zone-run`, s === 'run');
  show(`${P}-zone-out`, s === 'run' || s === 'results');
  show(`${P}-prep-only`, s === 'prep');
  show(`${P}-fix-only`, s === 'fix');
  show(`${P}-back`, s === 'fix');
  show(`${P}-restart`, s === 'fix');
  show(`${P}-clear`, s === 'prep' && grid.filled().length > 0);
  show(`${P}-out-actions`, s === 'results');
  setText(`${P}-zone-in-title`, s === 'fix' ? 'תיקון והרצה חוזרת' : 'את מי קולטים');
  grid.setMode(s === 'fix' ? 'fix' : 'prep');
  ui.step(STAGE_INDEX[s] || 0);
}

// ─── שורת-המצב וכפתור "התחל": מחושבים מהמצב, אחרי כל שינוי ─────────────────
function refreshStatus(v) {
  ui.step(STAGE_INDEX[stage] || 0);
  if (absorbIsBusy() || stage === 'run' || stage === 'results') return; // הזרימה / הסיכום מדווחים
  const all = v.counts.all;
  let msg;
  if (!all) msg = stage === 'fix' ? 'אין מי שדורש טיפול. "חזרה לתוצאות" או "רשימה חדשה"' : 'אין שורות עדיין. מלא שורה, הדבק מאקסל או טען קובץ אקסל';
  else {
    // כשתגית-סינון פעילה, המספרים הם של המוצגים (אלה שירוצו)
    const filtered = grid.filter() !== 'all';
    const rv = filtered ? runnable() : v;
    const c = rv.counts;
    const parts = [];
    if (filtered) parts.push(`מוצגים ${c.all} מתוך ${all}`);
    parts.push(plural(rv.tasks.length, 'תלמיד אחד מוכן', 'N תלמידים מוכנים')); // "מוכנים" = מי שירוץ (גם עם אזהרה)
    if (c.bad) parts.push(plural(c.bad, 'שורה אחת לא תרוץ (אדום)', 'N שורות לא ירוצו (אדום)'));
    if (c.warn) parts.push(plural(c.warn, 'אזהרה אחת (צהוב)', 'N אזהרות (צהוב)'));
    msg = (stage === 'fix' ? 'תיקון: ' : '') + parts.join(' · ');
    if (stage === 'fix') {
      const missing = grid.filled().filter((r) => r.newOpen && !rowHasNewFields(r)).length;
      if (missing) msg += `. ${plural(missing, 'תלמיד אחד ממתין להשלמה', 'N תלמידים ממתינים להשלמה')}: שם פרטי, שם משפחה ותאריך לידה`;
    }
  }
  ui.status(msg);
}

function runnable() {
  const list = grid.visibleFilled();
  return absorbValidateRows(list, validationCtx());
}

function refreshStartButton() {
  show(`${P}-clear`, stage === 'prep' && grid.filled().length > 0);
  if (awaitingErrorConfirm && grid.filter() !== awaitingErrorFilter) awaitingErrorConfirm = false; // החלפת תגית = בקשה חדשה
  if (awaitingErrorConfirm) return;
  const v = runnable();
  const n = v.tasks.length;
  const shownNote = grid.filter() !== 'all' ? ' (המוצגים)' : '';
  const verb = stage === 'fix' ? 'התחל קליטה חוזרת' : 'התחל קליטה';
  setText(`${P}-start`, n ? `${verb}: ${plural(n, 'תלמיד אחד', 'N תלמידים')}${shownNote}` : verb);
  // הכרעת 2.11: אין מי שירוץ (טבלה ריקה, רק אדומות, או תגית שמציגה רק אדומות) → הכפתור לא פעיל, לא רק בלי מספר
  const idle = n === 0 && !absorbIsBusy() && stage !== 'run';
  setDisabled(`${P}-start`, idle || absorbIsBusy() || stage === 'run');
  const btn = $el(`${P}-start`);
  if (btn) btn.title = idle ? (v.filled.length ? 'אין מי שירוץ: תקן את השורות האדומות, או בחר תגית אחרת' : 'אין שורות בטבלה') : '';
}

// "נקה" (הכרעת 2.11): מרוקן את טבלת-ההכנה אחרי לחיצה שנייה ("כן, נקה"); התוצאות לא נוגעות
function clearTable() {
  grid.setRows([]);
  grid.setNotes(null);
  grid.hidePasteBox();
  awaitingErrorConfirm = false;
  grid.render();
  ui.status('הטבלה נוקתה. מלא שורה, הדבק מאקסל או טען קובץ אקסל');
  log('[קלט] הטבלה נוקתה');
}

// ─── תוצאות: תגיות שמסננות, מיון, "מה לעשות" מתחת לכל שורה ───────────────────
function classify(r) {
  const k = absorbResultKind(r.status);
  return k === 'ok' ? 'ok' : (k === 'bad' ? 'bad' : 'warn');
}
function resultGroup(r) {
  const key = absorbStatusKey(r.status);
  if (key === 'כבר קיים') return 'exists';
  const k = absorbResultKind(r.status);
  return k === 'ok' ? 'ok' : k; // ok | verify | bad | stopped
}
function displayedResults() {
  let list = resFilter === 'all' ? results.slice() : results.filter((r) => resultGroup(r) === resFilter);
  if (resSort) list = gridSortRows(list, (r) => r[resSort.key], resSort.dir);
  return list;
}
function continueChecked() { const el = $el(`${P}-continue-other`); return !!(el && el.checked); }

function renderResults() {
  const list = displayedResults();
  const cols = RESULT_COLUMNS.map((c) => Object.assign({}, c, { label: c.label + (resSort && resSort.key === c.key ? (resSort.dir === 'desc' ? ' ▼' : ' ▲') : '') }));
  setHtml(`${P}-results`, resultsTableHtml({ columns: cols, rows: list, classify, actionKey: 'action', sortable: true, emptyText: results.length ? 'אין תוצאות בסינון הזה' : '' }));
  show(`${P}-results`, results.length > 0);
  const attention = list.filter((r) => !isAbsorbSuccess(r.status)).length;
  setDisabled(`${P}-keep-attention`, attention === 0);
  setText(`${P}-keep-attention`, attention ? `תקן והרץ שוב: ${plural(attention, 'תלמיד אחד', 'N תלמידים')}${resFilter !== 'all' ? ' (המוצגים)' : ''}` : 'תקן והרץ שוב');
  const ka = $el(`${P}-keep-attention`); if (ka) ka.title = attention ? 'פותח טבלה רק עם מי שדורש טיפול, כדי להשלים ולהתחיל שוב' : (results.length ? 'אין בין המוצגים מי שדורש טיפול' : '');
  const blocked = list.filter(absorbIsOtherInstituteBlock).length;
  const showContinue = blocked > 0 && !continueChecked() && !absorbIsBusy();
  show(`${P}-continue-rerun`, showContinue);
  if (showContinue) setText(`${P}-continue-rerun`, `סמן "אשר המשך" והרץ שוב ${plural(blocked, 'תלמיד אחד שנחסם', 'N תלמידים שנחסמו')}`);
  for (const id of ['tsv', 'csv']) setDisabled(`${P}-${id}`, results.length === 0);
}

// הסיכום (תגיות שמסננות + משפט) מוצג כשהריצה הסתיימה; בזמן ריצה התוצאות מצטברות בלי סיכום.
function renderReport(report, at) {
  if (!report) { show(`${P}-report`, false); setHtml(`${P}-report`, ''); setText(`${P}-zone-out-note`, ''); return; }
  const when = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date(); // ביקורת 2.11: אחרי טעינת-דף, שעת הריצה ולא שעת הטעינה
  const c = absorbSummarizeKinds(results);
  const ok = c.absorbed + c.exists;
  const tag = (filter, label, n, kind) => (n ? tagHtml({ label: `${label} ${n}`, kind, button: true, filter, active: resFilter === filter }) : '');
  const tags = tagHtml({ label: `הכל ${results.length}`, kind: 'info', button: true, filter: 'all', active: resFilter === 'all' })
    + tag('ok', 'נקלטו', c.absorbed, 'ok') + tag('exists', 'כבר קיימים', c.exists, 'ok') + tag('verify', 'לבדוק', c.verify, 'warn')
    + tag('bad', 'דורשים טיפול', c.bad, 'bad') + tag('stopped', 'לא רצו', c.stopped, 'warn');
  const sentence = report.stopped || c.stopped
    ? `נעצר. ${plural(c.stopped, 'תלמיד אחד לא רץ', 'N תלמידים לא רצו')}`
    : `הסתיים: ${ok} מתוך ${results.length} הצליחו.${c.bad || c.verify ? ` ${plural(c.bad + c.verify, 'תלמיד אחד דורש טיפול', 'N תלמידים דורשים טיפול')}` : ' הכול טופל'}`;
  setHtml(`${P}-report`, `<div class="tt-tags" id="${P}-rtags">${tags}</div><div class="tt-report-summary">${esc(sentence)}</div>`);
  show(`${P}-report`, true);
  setText(`${P}-zone-out-note`, `ריצה מ-${when.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`);
}

function onReportClick(e) {
  const t = e.target && e.target.closest ? e.target.closest('[data-filter]') : null;
  if (!t) return;
  resFilter = t.getAttribute('data-filter') || 'all';
  t.parentElement.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('tt-tag-active', b === t));
  renderResults();
}
function onResultsClick(e) {
  const th = e.target && e.target.closest ? e.target.closest('th[data-sort]') : null;
  if (!th) return;
  const key = th.getAttribute('data-sort');
  resSort = { key, dir: resSort && resSort.key === key && resSort.dir === 'asc' ? 'desc' : 'asc' };
  renderResults();
}

// תיבת "הריצה נקטעה": תור ישן (מעל 30 דקות) או דף זר (ממצא 11). "המשך" מכריח המשך; "בטל" מסמן את השאר "נעצר".
function renderStaleQueue(info) {
  if (!info) { show(`${P}-stale`, false); setHtml(`${P}-stale`, ''); return; }
  const done = info.curIdx || 0;
  const startedMs = Date.parse(info.startedAt);
  const ageMin = Number.isNaN(startedMs) ? null : Math.round((Date.now() - startedMs) / 60000);
  const why = info.reason === 'foreign-page'
    ? 'הדף הזה אינו חלק מהקליטה, ולכן הכלי לא ממשיך לבד. "המשך" יעבור לדף סוג-הלימוד של התלמיד הבא.'
    : 'עבר זמן רב, ולכן הכלי לא ממשיך לבד.';
  setHtml(`${P}-stale`, `<b>הריצה נקטעה</b> (למשל החיבור לאתר פג) אחרי ${esc(done)} מתוך ${esc(info.total || 0)} תלמידים${ageMin === null ? '' : `, לפני ${esc(ageMin)} דקות`}. ${esc(why)}
    ${buttonsRowHtml([
      { id: `${P}-stale-go`, label: 'המשך מהתלמיד הבא', kind: 'primary', size: 'small' },
      { id: `${P}-stale-clear`, label: 'בטל את השאר', kind: 'danger', size: 'small' },
    ], 'tt-row-wrap')}`);
  show(`${P}-stale`, true);
  $el(`${P}-stale-go`).addEventListener('click', () => {
    renderStaleQueue(null);
    ui.status('ממשיך את הריצה שנקטעה…');
    setRunning(true);
    Promise.resolve().then(() => absorbResumeIfPending({ force: true })).then((ran) => { if (ran === false && !absorbIsBusy()) setRunning(false); })
      .catch((e) => { log('[המשך] כשל: ' + (e && e.message)); setRunning(false); });
  });
  $el(`${P}-stale-clear`).addEventListener('click', () => {
    absorbDiscardSavedQueue();
    renderStaleQueue(null);
    setRunning(false);
    ui.status('הריצה שנקטעה בוטלה. אפשר להתחיל ריצה חדשה');
    grid.refresh();
  });
}

function setRunning(on) {
  setDisabled(`${P}-start`, !!on);
  if (on) { if (stage !== 'run') stageBeforeRun = stage; setStage('run'); }
  else if (stage === 'run') setStage(results.length ? 'results' : (stageBeforeRun === 'fix' ? 'fix' : 'prep'));
  ui.running(!!on);
  if (!on) refreshStartButton();
}

function startDate() {
  const el = $el(`${P}-start-date`);
  return el ? String(el.value || '').trim() : '';
}

// ─── פעולות ─────────────────────────────────────────────────────────────────
async function start() {
  if (absorbIsBusy()) { ui.status('ריצה כבר פעילה. לעצור אותה: "עצור" או Escape'); return; }
  if (absorbHasSavedQueue()) { ui.status('יש ריצה שנקטעה וממתינה. לחץ "המשך" או "בטל" למעלה'); return; }
  grid.refresh();
  const v = runnable();
  if (!v.filled.length) { ui.status(grid.filter() !== 'all' ? 'אין שורות בסינון הזה. לחץ "הכל"' : 'אין שורות להרצה. "הדבק מאקסל" או מלא שורה בטבלה'); return; }
  if (v.counts.bad && !awaitingErrorConfirm) {
    awaitingErrorConfirm = true;
    awaitingErrorFilter = grid.filter();
    setText(`${P}-start`, v.tasks.length ? `לחץ שוב להתחלה בלי ${plural(v.counts.bad, 'השורה האדומה', 'N השורות האדומות')}` : 'התחל קליטה');
    ui.status(`${plural(v.counts.bad, 'שורה אחת לא תרוץ', 'N שורות לא ירוצו')} (אדום). תקן אותן, או לחץ שוב על הכפתור כדי להתחיל בלי האדומות`);
    return;
  }
  if (!v.tasks.length) { ui.status('אין תלמידים שיכולים לרוץ. תקן את השורות האדומות'); return; }
  awaitingErrorConfirm = false;
  lastRunRows = grid.filled();
  renderReport(null);
  renderStaleQueue(null);
  results = [];
  resFilter = 'all';
  resSort = null;
  renderResults();
  clearAbsorbStop();
  total = v.tasks.length;
  setRunText(`${plural(total, 'תלמיד אחד בריצה', 'N תלמידים בריצה')}`);
  setRunning(true);
  ui.progress(0, v.tasks.length);
  ui.status(`מתחיל: ${plural(v.tasks.length, 'תלמיד אחד', 'N תלמידים')}…`);
  log(`[התחלה] ${v.tasks.length} תלמידים · תאריך קליטה "${startDate() || '(היום)'}"`);
  const started = await absorbStartRun(v.tasks);
  if (started === false) setRunning(false); // ממצא 5: לשונית אחרת רצה; ההודעה הוצגה דרך onLocked
}

function setRunText(text) { setText(`${P}-runtext`, text); }

function stop() {
  ui.status('עוצר…');
  log('⛔ עצירה לבקשת המשתמש');
  absorbStop();
  setRunning(false);
}

function resultKey(r) { return `${String(r.branch || '').trim().padStart(2, '0')}|${String(r.studyType || '').trim()}|${absorbNormalizeId(r.identity)}`; }
function rowKey(f) { return `${String(f.branch || '').trim().padStart(2, '0')}|${String(f.studyType || '').trim()}|${absorbNormalizeId(f.identifier)}`; }

// זרימת-התיקון (סבב 3): טבלה רק עם מי שדורש טיפול מבין המוצגים, "מה קרה / מה לעשות" מתחת לכל שורה, שורת-פרטים פתוחה
// למי שהאתר אמר עליו "תלמיד חדש". הטבלה נבנית מהשורות הקיימות (אם יש) או מהתוצאות (אחרי טעינות-דף).
function fixAndRerun() {
  const attention = displayedResults().filter((r) => !isAbsorbSuccess(r.status));
  if (!attention.length) return;
  const byKey = new Map(attention.map((r) => [resultKey(r), r]));
  const existing = grid.filled().length ? grid.filled() : lastRunRows; // ביקורת 2.11: הטבלה ריקה אחרי הריצה; השורות שרצו נשמרו
  const source = existing.length
    ? absorbRowsNeedingAttention(existing, results).rows.filter((r) => byKey.has(rowKey(r.fields)))
    : attention.map((r) => rowFrom({ branch: r.branch || '', studyType: r.studyType || '', identifier: r.identity || '', idType: r.idType === 'passport' ? 'passport' : '' }));
  const rows = source.map((r) => {
    const row = { fields: Object.assign(emptyFields(), r.fields), newOpen: !!r.newOpen };
    const res = byKey.get(rowKey(row.fields));
    if (res && absorbStatusKey(res.status).startsWith('תלמיד חדש')) row.newOpen = true;
    return row;
  });
  grid.setRows(rows);
  grid.setNotes((row) => {
    const res = byKey.get(rowKey(row.fields));
    if (!res) return null;
    return { kind: classify(res) === 'bad' ? 'bad' : 'warn', text: `${res.status}. ${res.action || ''}`.trim() };
  });
  awaitingErrorConfirm = false;
  setStage('fix');
  grid.render();
  log(`[קלט] תקן והרץ שוב: ${rows.length} תלמידים בטבלה`);
  const zone = $el(`${P}-zone-in`);
  if (zone && zone.scrollIntoView) { try { zone.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* noop */ } }
}

function backToResults() {
  grid.setRows([]);
  grid.setNotes(null);
  awaitingErrorConfirm = false;
  setStage('results');
  ui.status('חזרה לתוצאות הריצה האחרונה');
}

// "קליטה חדשה": מנקה תוצאות וטבלה וחוזר להכנה
function newRun() {
  results = [];
  resFilter = 'all';
  resSort = null;
  lastRunRows = [];
  clearAbsorbLastResults();
  renderReport(null);
  renderResults();
  grid.setRows([]);
  grid.setNotes(null);
  awaitingErrorConfirm = false;
  setStage('prep');
  grid.render();
  ui.status('רשימה חדשה: הטבלה והתוצאות נוקו. מלא שורה, הדבק מאקסל או טען קובץ אקסל');
  log('[קלט] רשימה חדשה: הטבלה והתוצאות נוקו');
}

// הכרעה ט: "נחסם: רשום במוסד אחר" בלי "אשר המשך" → לחיצה אחת מסמנת ומריצה שוב רק את מי שנחסם.
function continueAndRerun() {
  const cb = $el(`${P}-continue-other`);
  if (cb) { cb.checked = true; saveContinue(true); }
  const blocked = displayedResults().filter(absorbIsOtherInstituteBlock);
  if (!blocked.length) return;
  // ביקורת 2.11: השורה כפי שרצה (עם לידה וארץ לדרכון), אחרת מהתוצאה
  const prevByKey = new Map(lastRunRows.map((r) => [rowKey(r.fields), r]));
  grid.setRows(blocked.map((r) => {
    const prev = prevByKey.get(resultKey(r));
    return prev ? { fields: Object.assign(emptyFields(), prev.fields), newOpen: !!prev.newOpen } : rowFrom({ branch: r.branch || '', studyType: r.studyType || '', identifier: r.identity || '', idType: r.idType === 'passport' ? 'passport' : '' });
  }));
  grid.setNotes(null);
  setStage('fix');
  grid.render();
  log(`[קלט] "אשר המשך" סומן; מריצים שוב ${blocked.length} שנחסמו`);
  Promise.resolve().then(start).catch((e) => { log('[התחלה] ההרצה נכשלה: ' + (e && e.message)); setRunning(false); });
}

function saveContinue(on) { try { localStorage.setItem(CONTINUE_KEY, on ? '1' : '0'); } catch (e) { /* noop */ } }
function loadContinue() { try { return localStorage.getItem(CONTINUE_KEY) !== '0'; } catch (e) { return true; } }

function copyTsv() {
  const list = absorbGetResults().length ? absorbGetResults() : results;
  if (!list.length) { ui.status('אין תוצאות להעתקה'); return; }
  copyTextToClipboard(buildResultsTsv(list)).then((ok) => {
    flash(`${P}-tsv`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק תוצאות לאקסל');
    ui.status(ok ? 'התוצאות הועתקו. הדבק באקסל (Ctrl+V)' : 'ההעתקה נחסמה בדפדפן. השתמש ב"הורד קובץ"');
  });
}

function exportCsv() {
  const list = absorbGetResults().length ? absorbGetResults() : results;
  if (!list.length) { ui.status('אין תוצאות להורדה'); return; }
  const name = `absorptions_${new Date().toISOString().slice(0, 10)}.csv`;
  ui.status(downloadCsv(name, buildResultsCsvRows(list)) ? `הורד ${name}` : 'ההורדה נכשלה');
}

function downloadTemplate() {
  ui.status(downloadCsv('תבנית-קליטת-תלמידים.csv', [ABSORB_TEMPLATE_HEADER.slice()]) ? 'התבנית הורדה. מלא באקסל, העתק את השורות ולחץ "הדבק מאקסל", או טען את הקובץ' : 'הורדת התבנית נכשלה');
}

function handleXlsx(ev) {
  const input = ev && ev.target;
  const file = input && input.files && input.files[0];
  if (!file) return;
  ui.status('טוען קובץ אקסל…');
  Promise.resolve().then(() => loadXlsxFile(file)).then((text) => {
    grid.applyText(text, `קובץ "${file.name}"`);
  }).catch((e) => {
    ui.status('טעינת האקסל נכשלה: ' + ((e && e.message) || 'שגיאה לא ידועה'));
  }).finally(() => { if (input) input.value = ''; });
}

function copyInputAsTsv() {
  const filled = grid.filled();
  if (!filled.length) { ui.status('הטבלה ריקה'); return; }
  copyTextToClipboard(absorbFieldRowsToText(filled)).then((ok) => {
    flash(`${P}-copy-input`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק את הטבלה לאקסל');
  });
}

// ─── mount ──────────────────────────────────────────────────────────────────
const ABSORB_PAGES = ['institute', 'studyType', 'newStudent'];

function mount(container, panelUi, page) {
  ui = panelUi;
  pageRef = page;
  buildGrid();
  container.innerHTML = `
    ${datalistsHtml(page)}
    <section class="tt-zone" id="${P}-zone-in">
      <div class="tt-zone-head"><b id="${P}-zone-in-title">את מי קולטים</b><span class="tt-zone-note"></span>
        <span class="tt-zone-actions">${buttonHtml({ id: `${P}-restart`, label: 'רשימה חדשה', kind: 'newlist', size: 'small', title: 'מנקה את הטבלה ואת התוצאות וחוזר להכנה. לחיצה שנייה מאשרת', attrs: 'hidden' })}</span></div>
      <div id="${P}-prep-only">
        <p class="tt-zone-lead">כאן קולטים כמה תלמידים בבת אחת: ממלאים את הטבלה, או מדביקים נתונים מאקסל ("הדבק מאקסל"), או טוענים קובץ אקסל. בודקים, ולוחצים "התחל קליטה".</p>
        <div class="tt-row tt-row-wrap tt-row-tight">
          ${buttonHtml({ id: `${P}-paste-btn`, label: 'הדבק מאקסל', kind: 'primary', size: 'small', title: 'ממלא את הטבלה ממה שהעתקת באקסל' })}
          ${buttonHtml({ id: `${P}-xlsx`, label: 'טען קובץ אקסל', kind: 'ghost', size: 'small' })}
          ${buttonHtml({ id: `${P}-template`, label: 'הורד תבנית', kind: 'ghost', size: 'small' })}
          ${buttonHtml({ id: `${P}-copy-input`, label: 'העתק את הטבלה לאקסל', kind: 'ghost', size: 'small' })}
          ${buttonHtml({ id: `${P}-clear`, label: 'נקה טבלה', kind: 'danger', size: 'small', title: 'מרוקן את הטבלה. לחיצה שנייה מאשרת', attrs: 'hidden' })}
        </div>
        <input id="${P}-xlsx-file" type="file" accept=".xlsx,.xls" hidden>
        ${grid.pasteBoxHtml()}
      </div>
      <div id="${P}-fix-only" hidden><p class="tt-zone-lead">רק מי שדורש טיפול. השלם או תקן לפי ההוראה שמתחת לכל שורה, ולחץ "התחל קליטה חוזרת".</p></div>
      <div class="tt-tags" id="${P}-tags"></div>
      <div id="${P}-grid" class="tt-scroll" style="max-height:320px"></div>
      <div id="${P}-stale" class="tt-box tt-box-warn" hidden></div>
      <div class="tt-row tt-row-wrap">
        <label class="tt-field"><span class="tt-field-label">תאריך קליטה (ריק = היום)</span>${dateFieldHtml({ id: `${P}-start-date`, placeholder: todayDMY(), maxWidth: '130px' })}</label>
        <label class="tt-check" title="האתר מזהיר כשהתלמיד רשום במוסד אחר ומבקש אישור. מסומן: הכלי מאשר; לא מסומן: השורה מסומנת &quot;נחסם&quot; ואתה מחליט"><input type="checkbox" id="${P}-continue-other"${loadContinue() ? ' checked' : ''}> תלמיד שרשום במוסד אחר: אשר "המשך" (לימודיו שם יסתיימו היום)</label>
      </div>
      <div class="tt-row tt-row-wrap">
        ${buttonHtml({ id: `${P}-start`, label: 'התחל קליטה', kind: 'primary' })}
        ${buttonHtml({ id: `${P}-back`, label: 'חזרה לתוצאות', kind: 'ghost', attrs: 'hidden' })}
        <span class="tt-legend"><i style="background:var(--tt-bad)"></i>לא ירוץ עד שיתוקן <i style="background:var(--tt-warn);margin-inline-start:8px"></i>אזהרה, ירוץ</span>
      </div>
    </section>
    <div class="tt-runline" id="${P}-zone-run" hidden><span class="tt-runtext" id="${P}-runtext"></span>${buttonHtml({ id: `${P}-stop`, label: 'עצור', kind: 'stop', title: 'גם מקש Escape עוצר' })}</div>
    ${zoneHtml({ id: `${P}-zone-out`, title: 'תוצאות', hidden: true, actions: buttonHtml({ id: `${P}-new-run`, label: 'רשימה חדשה', kind: 'newlist', size: 'small', title: 'מנקה את הטבלה ואת התוצאות וחוזר להכנה. לחיצה שנייה מאשרת' }), inner: `
      <div id="${P}-report" hidden></div>
      <div class="tt-row tt-row-wrap tt-row-tight" id="${P}-out-actions">
        ${buttonHtml({ id: `${P}-keep-attention`, label: 'תקן והרץ שוב', kind: 'primary', size: 'small', disabled: true, title: 'פותח טבלה רק עם מי שדורש טיפול, כדי להשלים ולהתחיל שוב' })}
        ${buttonHtml({ id: `${P}-continue-rerun`, label: 'סמן "אשר המשך" והרץ שוב', kind: 'ghost', size: 'small', attrs: 'hidden' })}
        ${buttonHtml({ id: `${P}-tsv`, label: 'העתק תוצאות לאקסל', kind: 'ghost', size: 'small', disabled: true, title: 'מכיל מזהים מלאים: לא להדביק בצ\'אט או בדיווח-באג' })}
        ${buttonHtml({ id: `${P}-csv`, label: 'הורד קובץ', kind: 'ghost', size: 'small', disabled: true, title: 'קובץ CSV עם כל העמודות, כולל "פירוט". מכיל מזהים מלאים' })}
      </div>
      <div id="${P}-results" class="tt-scroll" hidden></div>` })}`;

  bindDateMask(`${P}-start-date`);
  bindDateFields(container);
  grid.bind();
  $el(`${P}-paste-btn`).addEventListener('click', () => { grid.pasteFromClipboard(); });
  $el(`${P}-continue-other`).addEventListener('change', function () { saveContinue(this.checked); renderResults(); });
  $el(`${P}-start`).addEventListener('click', () => {
    Promise.resolve().then(start).catch((e) => {
      log('[התחלה] ההרצה נכשלה: ' + (e && e.message));
      setRunning(false);
      ui.status('ההרצה נכשלה. בדוק את היומן ונסה שוב');
    });
  });
  $el(`${P}-back`).addEventListener('click', backToResults);
  $el(`${P}-stop`).addEventListener('click', stop, true);
  $el(`${P}-tsv`).addEventListener('click', copyTsv);
  $el(`${P}-csv`).addEventListener('click', exportCsv);
  $el(`${P}-keep-attention`).addEventListener('click', fixAndRerun);
  $el(`${P}-continue-rerun`).addEventListener('click', continueAndRerun);
  // הכרעת 2.11: מה שמוחק טבלה או תוצאות דורש לחיצה שנייה
  const armNote = (what) => () => { if (stage !== 'results') ui.status(`${what} בלחיצה נוספת על הכפתור (6 שניות)`); };
  bindConfirmClick(`${P}-new-run`, { label: 'רשימה חדשה', confirmLabel: 'לחץ שוב לרשימה חדשה', onConfirm: newRun, onArm: armNote('הטבלה והתוצאות יימחקו'), onDisarm: () => grid.refresh() });
  bindConfirmClick(`${P}-restart`, { label: 'רשימה חדשה', confirmLabel: 'לחץ שוב לרשימה חדשה', onConfirm: newRun, onArm: armNote('הטבלה והתוצאות יימחקו'), onDisarm: () => grid.refresh() });
  bindConfirmClick(`${P}-clear`, { label: 'נקה טבלה', confirmLabel: 'לחץ שוב לניקוי הטבלה', onConfirm: clearTable, onArm: armNote('הטבלה תנוקה'), onDisarm: () => grid.refresh() });
  $el(`${P}-template`).addEventListener('click', downloadTemplate);
  $el(`${P}-copy-input`).addEventListener('click', copyInputAsTsv);
  $el(`${P}-xlsx`).addEventListener('click', () => $el(`${P}-xlsx-file`).click());
  $el(`${P}-xlsx-file`).addEventListener('change', handleXlsx);
  $el(`${P}-report`).addEventListener('click', onReportClick);
  $el(`${P}-results`).addEventListener('click', onResultsClick);

  absorbSetHooks({
    getStartDate: startDate,
    getContinueOtherInstitute: continueChecked,
    onStart: (queue, idx) => { total = queue.length; ui.progress(idx, total); setRunText(plural(total, 'תלמיד אחד בריצה', 'N תלמידים בריצה')); setRunning(true); },
    onResume: (queue, res, idx) => {
      total = queue.length; results = res.slice(); renderResults(); ui.progress(idx, total);
      grid.setRows(queue.map((t) => rowFrom({
        branch: t.branch, studyType: t.studyType, identifier: t.identity, idType: t.idType === 'passport' ? 'passport' : '',
        firstName: (t.newStudent || {}).firstName || '', lastName: (t.newStudent || {}).lastName || '',
        birthDate: t.birthDate || '', country: t.country || '',
      })));
      setRunText(`${plural(total, 'תלמיד אחד בריצה', 'N תלמידים בריצה')} · ממשיך אחרי טעינת דף`);
      setRunning(true);
      ui.status(`ממשיך אחרי טעינת דף: ${idx + 1} מתוך ${total}`);
      ui.open();
    },
    onProgress: (idx, tot, task) => { total = tot; ui.progress(idx, tot); setRunText(`${plural(tot, 'תלמיד אחד בריצה', 'N תלמידים בריצה')} · מעבד ${idx + 1} מתוך ${tot}`); ui.status(`מעבד ${idx + 1} מתוך ${tot}: סניף ${task.branch} · סוג ${task.studyType} · ${task.idType === 'passport' ? 'דרכון' : 'ת.ז.'}`); },
    onResult: (result, all) => { results = all.slice(); renderResults(); ui.progress(all.length, Math.max(total, all.length)); },
    onNavigating: () => { ui.status('עובר לדף הנכון באתר… ממתין לטעינה'); },
    onStaleQueue: (info) => {
      setRunning(false);
      setStage(results.length ? 'results' : 'prep');
      ui.status(info && info.reason === 'foreign-page' ? 'יש ריצה שנקטעה, אך הדף הזה אינו חלק מהקליטה. בחר "המשך" או "בטל"' : 'יש ריצה שנקטעה. בחר "המשך" או "בטל"');
      renderStaleQueue(info);
      ui.open();
    },
    onLocked: (msg) => { setRunning(false); ui.status(msg); setHtml(`${P}-stale`, esc(msg)); show(`${P}-stale`, true); ui.open(); }, // מקרה 22: תיבה צהובה, לא רק שורת-מצב
    onDone: (all, report) => {
      if (grid.filled().length) lastRunRows = grid.filled(); // אחרי טעינת-דף הטבלה נבנתה מהתור (onResume), עם כל השדות
      results = all.slice(); resFilter = 'all'; resSort = null; grid.setRows([]); grid.setNotes(null);
      renderResults(); renderReport(report); setRunning(false); setStage('results'); ui.progress(all.length, all.length);
      const c = absorbSummarizeKinds(results);
      ui.status(c.stopped ? `נעצר. ${plural(c.stopped, 'תלמיד אחד לא רץ', 'N תלמידים לא רצו')}. "תקן והרץ שוב" מריץ את מי שנותר`
        : (c.bad || c.verify ? `הסתיים: ${c.absorbed + c.exists} מתוך ${results.length} הצליחו. ${plural(c.bad + c.verify, 'תלמיד אחד דורש טיפול', 'N תלמידים דורשים טיפול')}: ראה "מה לעשות" בתוצאות` : `הסתיים: ${results.length} מתוך ${results.length} הצליחו. הכול טופל`));
    },
  });

  log(`[קליטה] דף ${page.kind}${page.branch ? ` · סניף ${page.branch} [${page.branchSource || '?'}]` : ''}${page.studyType ? ' · סוג ' + page.studyType : ''}`);
  setStage('prep');
  grid.render();
  results = absorbGetResults();
  renderResults();
  const saved = absorbSavedQueueInfo();
  if (absorbHasSavedQueue()) ui.status(saved && saved.stale ? 'נמצאה ריצה שנקטעה. בודק…' : 'נמצאה ריצה פתוחה. ממשיך…');
  else if (!results.length) {
    // ממצא 6: הריצה האחרונה הסתיימה בזמן טעינת-דף (למשל "עצור"): מציגים את התוצאות והסיכום שלה
    const last = absorbLastResults();
    if (last && last.results.length) {
      results = last.results.slice();
      renderResults();
      renderReport(last.report, last.at);
      setStage('results');
      ui.status(`תוצאות הריצה האחרונה (${results.length} תלמידים)`);
    }
  }
  Promise.resolve().then(() => absorbResumeIfPending()).catch((e) => { log('[המשך] כשל: ' + (e && e.message)); setRunning(false); });
}

export const absorbTool = {
  id: 'absorb',
  title: 'קליטת תלמידים',
  pages: ['*'], // הכרעה ח2: בכל דף; הלשונית אומרת כשהדף לא מתאים
  fits: (page) => !!(page && ABSORB_PAGES.includes(page.kind)),
  steps: ABSORB_STEPS,
  hasPendingRun: absorbHasSavedQueue,
  isRunning: absorbIsBusy,
  onStop: stop,
  mount,
};
