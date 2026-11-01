// לשונית "קליטת תלמידים" בחלונית המאוחדת. הזרימה ב-absorb-flow.js; כאן הממשק (שכבת-הבהירות 1.11.2026):
// שני אזורים, "את מי קולטים" (הטבלה היא כלי-ההזנה היחיד: הדבקה ישירות לתוכה, קובץ אקסל, או מילוי ביד; רשימות-בחירה
// מהנתונים האמיתיים; עמודת "סוג מזהה"; שורת-פרטים לתלמיד חדש; תגיות-מצב שמסננות; הודעה מתחת לכל שורה בעייתית)
// ו"תוצאות" (תגיות-סיכום, "מה לעשות" מתחת לכל שורה, "תקן והרץ שוב"). סרגל-שלבים ושורת-מצב מחושבים מחדש
// מכל שינוי. מסלול-פרסור אחד: הטבלה → טקסט עם כותרת → parseAbsorbInput (כמו הדבקה). אין גישה ל-document ברמת המודול.

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
import { clearAbsorbStop } from './absorb-state.js';
import {
  absorbSetHooks, absorbStartRun, absorbResumeIfPending, absorbStop, absorbHasSavedQueue, absorbGetResults,
  absorbIsBusy, absorbSavedQueueInfo, absorbDiscardSavedQueue, absorbLastResults,
} from './absorb-flow.js';
import {
  esc, buttonHtml, buttonsRowHtml, fieldHtml, resultsTableHtml, tagHtml, zoneHtml, flash, setHtml, setText, show, setDisabled,
  bindDateMask, todayDMY,
} from '../ui/widgets.js';

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
const PASSPORT_WARNING = 'תלמיד עם דרכון חייב להיות מסומן "דרכון". דרכון שנקלט כת.ז. קשה לתקן אחר-כך.';

let ui = null;
let pageRef = null;
let rows = []; // [{ fields: {...}, newOpen }] - מקור-האמת להרצה
let results = [];
let total = 0;
let awaitingErrorConfirm = false;
let fixMode = false; // אחרי "תקן והרץ שוב": השלב "תיקון והרצה חוזרת"
let rowFilter = 'all'; // all | ready | warn | bad (תגיות מעל הטבלה)
let lastValidation = null;

const RESULT_COLUMNS = [
  { key: 'branch', label: 'סניף', center: true, width: '44px' },
  { key: 'studyType', label: 'סוג', center: true, width: '44px' },
  { key: 'identity', label: 'מספר', mono: true },
  { key: 'status', label: 'מה קרה' },
];

function emptyFields() {
  return { branch: '', studyType: '', idType: '', identifier: '', firstName: '', lastName: '', birthDate: '', country: '', gender: '', familyStatus: '' };
}
function emptyRow() { return { fields: emptyFields(), newOpen: false }; }
function rowFrom(fields) { return { fields: Object.assign(emptyFields(), fields || {}), newOpen: false }; }

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
      level = 'bad'; msg = 'סניף לא נמצא בעץ של האתר';
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
          level = 'warn'; msg = 'ת.ז. לא תקינה (ספרת ביקורת). אם זה דרכון: בחר "דרכון" ומלא תאריך לידה וארץ';
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

function validateRows() {
  lastValidation = absorbValidateRows(rows, validationCtx());
  return lastValidation;
}

// ─── תאי הטבלה ─────────────────────────────────────────────────────────────
function cellInput(i, key, value, { list, placeholder = '', mono = false, width, cls = '' } = {}) {
  return `<input type="text" class="tt-input${mono ? ' tt-mono' : ''}${cls ? ' ' + cls : ''}" data-i="${i}" data-k="${key}" value="${esc(value)}"${list ? ` list="${list}"` : ''}
    placeholder="${esc(placeholder)}"${width ? ` style="width:${width}"` : ''} autocomplete="off">`;
}

function cellSelect(i, key, value, options, { width } = {}) {
  const opts = options.slice();
  if (value !== '' && !opts.some(([v]) => v === value)) opts.push([value, value]);
  return `<select class="tt-select" data-i="${i}" data-k="${key}"${width ? ` style="width:${width}"` : ''}>${opts.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

// סניף: רשימה מהעץ כשיש; בלי עץ (דף אחר) תא טקסט
function branchCell(i, value) {
  const branches = knownBranches(pageRef);
  if (!branches.length) return cellInput(i, 'branch', value, { list: `${P}-dl-branches`, placeholder: 'סניף', mono: true, width: '56px' });
  return cellSelect(i, 'branch', value, [['', '']].concat(branches.map((b) => [b, b])), { width: '58px' });
}

function rowHtml(i, r) {
  const f = r.fields;
  const blank = rowIsBlank(r);
  const eff = absorbEffectiveIdType(f);
  const passport = eff === 'passport';
  const needBirth = passport || rowHasNewFields(r) || r.newOpen;
  const newOn = rowHasNewFields(r);
  const subOpen = !blank && (r.newOpen || newOn);
  return `<tr class="tt-r-main" data-i="${i}">
    <td class="tt-rownum">${blank ? '' : i + 1}</td>
    <td>${branchCell(i, f.branch)}</td>
    <td>${cellInput(i, 'studyType', f.studyType, { list: `${P}-dl-studytypes`, placeholder: 'סוג', mono: true, width: '56px' })}</td>
    <td>${cellSelect(i, 'idType', blank ? 'tz' : eff, ID_TYPES, { width: '66px' })}</td>
    <td>${cellInput(i, 'identifier', f.identifier, { placeholder: 'מספר', mono: true, width: '100px' })}</td>
    <td class="tt-cell-birth${needBirth ? '' : ' tt-cell-off'}">${cellInput(i, 'birthDate', f.birthDate, { placeholder: needBirth ? 'יום/חודש/שנה' : '', mono: true, width: '90px' })}</td>
    <td class="tt-cell-country${passport ? '' : ' tt-cell-off'}">${cellInput(i, 'country', f.country, { list: `${P}-dl-countries`, placeholder: passport ? 'בחר ארץ' : '', width: '96px' })}</td>
    <td class="tt-cell-new">${blank ? '' : `<button type="button" class="tt-btn tt-btn-subtle tt-btn-sm tt-newbtn${newOn ? ' tt-newbtn-on' : ''}" data-newbtn="${i}" title="פרטים לתלמיד שהאתר לא מכיר: שם, משפחה, מגדר, מצב משפחתי">${newOn ? '✓ פרטים' : 'פרטים'}</button>`}</td>
    <td class="tt-cell-del">${blank ? '' : `<button type="button" class="tt-btn tt-btn-subtle tt-btn-sm" data-del="${i}" title="מחק שורה">×</button>`}</td>
  </tr>
  <tr class="tt-sub" data-sub="${i}"${subOpen ? '' : ' hidden'}><td colspan="9"><div class="tt-sub-row">
    <span>פרטי תלמיד חדש:</span>
    <span>שם פרטי</span>${cellInput(i, 'firstName', f.firstName, { width: '84px' })}
    <span>שם משפחה</span>${cellInput(i, 'lastName', f.lastName, { width: '84px' })}
    <span>מגדר</span>${cellSelect(i, 'gender', f.gender, GENDERS)}
    <span>מצב משפחתי</span>${cellSelect(i, 'familyStatus', f.familyStatus, FAMILY)}
    <button type="button" class="tt-btn tt-btn-subtle tt-btn-sm" data-newclear="${i}" title="מוחק את פרטי התלמיד החדש וסוגר את השורה">הסר</button>
  </div></td></tr>
  <tr class="tt-rowmsg" data-msg="${i}" hidden><td colspan="9"></td></tr>`;
}

function rowVisible(i, iss, blank) {
  if (rowFilter === 'all') return true;
  if (blank) return false;
  const level = iss ? iss.level : '';
  if (rowFilter === 'bad') return level === 'bad';
  if (rowFilter === 'warn') return level === 'warn';
  return level === '';
}

// אימות + סימון שורות + תגיות + שורת-מצב, בלי לבנות מחדש את השדות (השדה שבפוקוס נשאר בפוקוס).
function refreshMarks() {
  const v = validateRows();
  let filledIdx = -1;
  rows.forEach((r, i) => {
    const tr = document.querySelector(`#${P}-grid tr.tt-r-main[data-i="${i}"]`);
    const sub = document.querySelector(`#${P}-grid tr.tt-sub[data-sub="${i}"]`);
    const msg = document.querySelector(`#${P}-grid tr.tt-rowmsg[data-msg="${i}"]`);
    if (!tr) return;
    const f = r.fields;
    const blank = rowIsBlank(r);
    if (!blank) filledIdx++;
    const iss = blank ? null : v.issues[filledIdx];
    const level = iss ? iss.level : '';
    const eff = absorbEffectiveIdType(f);
    const passport = eff === 'passport';
    const newOn = rowHasNewFields(r);
    const needBirth = passport || newOn || r.newOpen;
    for (const el of [tr, msg]) { if (el) { el.classList.toggle('tt-r-bad', level === 'bad'); el.classList.toggle('tt-r-warn', level === 'warn'); } }
    if (msg) { msg.hidden = !iss || !iss.msg; msg.firstElementChild.textContent = iss ? iss.msg : ''; }
    if (sub) sub.hidden = blank || !(r.newOpen || newOn);
    const num = tr.querySelector('.tt-rownum'); if (num) num.textContent = blank ? '' : String(i + 1);
    const type = tr.querySelector('select[data-k="idType"]'); if (type && type.value !== (blank ? 'tz' : eff)) type.value = blank ? 'tz' : eff;
    const birth = tr.querySelector('.tt-cell-birth'); if (birth) { birth.classList.toggle('tt-cell-off', !needBirth); const inp = birth.querySelector('input'); if (inp) { inp.placeholder = needBirth ? 'יום/חודש/שנה' : ''; inp.classList.toggle('tt-need', passport && !String(f.birthDate || '').trim()); } }
    const country = tr.querySelector('.tt-cell-country'); if (country) { country.classList.toggle('tt-cell-off', !passport); const inp = country.querySelector('input'); if (inp) { inp.placeholder = passport ? 'בחר ארץ' : ''; inp.classList.toggle('tt-need', passport && !String(f.country || '').trim()); } }
    const nb = tr.querySelector('.tt-newbtn'); if (nb) { nb.classList.toggle('tt-newbtn-on', newOn); nb.textContent = newOn ? '✓ פרטים' : 'פרטים'; }
    if (sub) {
      // תלמיד חדש: שדות-חובה ריקים מסומנים (שם פרטי, שם משפחה; הלידה בשורה הראשית)
      const open = r.newOpen || newOn;
      for (const k of ['firstName', 'lastName']) { const inp = sub.querySelector(`input[data-k="${k}"]`); if (inp) inp.classList.toggle('tt-need', open && !String(f[k] || '').trim()); }
    }
    const visible = rowVisible(i, iss, blank);
    tr.hidden = !visible;
    if (msg && !visible) msg.hidden = true;
    if (sub && !visible) sub.hidden = true;
  });
  renderTags(v);
  refreshStartButton(v);
  refreshStatus(v);
  return v;
}

function renderTable() {
  if (!rows.length || !rowIsBlank(rows[rows.length - 1])) rows.push(emptyRow());
  const head = `<tr><th style="width:22px"></th><th>סניף</th><th>סוג לימוד</th><th>סוג מזהה</th><th>מספר</th><th>תאריך לידה</th><th>ארץ</th><th>תלמיד חדש</th><th style="width:22px"></th></tr>`;
  setHtml(`${P}-grid`, `<table class="tt-grid-input"><thead>${head}</thead><tbody>${rows.map((r, i) => rowHtml(i, r)).join('')}</tbody></table>`);
  return refreshMarks();
}

// ─── תגיות-מצב מעל הטבלה (מסננות) ─────────────────────────────────────────────
function renderTags(v) {
  const c = v.counts;
  if (!c.all) {
    setHtml(`${P}-tags`, `<span class="tt-hint">${results.length ? 'הטבלה התרוקנה בטעינת-הדף. "תקן והרץ שוב" (למטה) מחזיר את מי שדורש טיפול; להרצה חדשה: הדבק מאקסל או מלא שורה.' : 'אין שורות עדיין. הדבק מאקסל (Ctrl+V בתא) או מלא שורה.'}</span>`);
    return;
  }
  const tag = (filter, label, kind, n) => tagHtml({ label: `${label} ${n}`, kind, button: true, filter, active: rowFilter === filter, disabled: filter !== 'all' && n === 0, title: filter === 'all' ? 'כל השורות' : 'הצג רק את השורות האלה' });
  setHtml(`${P}-tags`, `${tag('all', 'הכל', 'info', c.all)}${tag('ready', 'מוכנות', 'ok', c.ready)}${tag('warn', 'אזהרות', 'warn', c.warn)}${tag('bad', 'לא ירוצו', 'bad', c.bad)}
    <span class="tt-tags-spacer"></span>${buttonHtml({ id: `${P}-sort`, label: 'מיין לפי מצב', kind: 'subtle', size: 'small', title: 'השורות האדומות למעלה, אחריהן הצהובות', disabled: !(c.bad || c.warn) })}`);
}

function onTagsClick(e) {
  const t = e.target && e.target.closest ? e.target.closest('[data-filter]') : null;
  if (t) { rowFilter = t.getAttribute('data-filter') || 'all'; refreshMarks(); return; }
  if (e.target && e.target.id === `${P}-sort`) sortByState();
}

function sortByState() {
  const v = validateRows();
  const rank = { bad: 0, warn: 1, '': 2 };
  const filled = v.filled.map((r, i) => ({ r, k: rank[v.issues[i].level], i }));
  filled.sort((a, b) => (a.k - b.k) || (a.i - b.i));
  rows = filled.map((x) => x.r);
  renderTable();
}

// ─── שורת-המצב וסרגל-השלבים: מחושבים מהמצב, אחרי כל שינוי ───────────────────
function currentStep() {
  if (absorbIsBusy()) return 1;
  if (fixMode) return 3;
  if (results.length) return 2;
  return 0;
}

function plural(n, one, many) { return n === 1 ? one : many.replace('N', String(n)); }

function refreshStatus(v) {
  ui.step(currentStep());
  if (absorbIsBusy()) return; // בזמן ריצה הזרימה מדווחת
  const c = v.counts;
  let msg;
  if (!c.all) msg = results.length ? 'הטבלה ריקה. "תקן והרץ שוב" מחזיר אליה את מי שדורש טיפול' : 'אין שורות עדיין. מלא את הטבלה או הדבק מאקסל';
  else {
    // "מוכנים" = מי שירוץ (גם עם אזהרה צהובה); האדומות לא
    const parts = [plural(v.tasks.length, 'תלמיד אחד מוכן', 'N תלמידים מוכנים')];
    if (c.bad) parts.push(plural(c.bad, 'שורה אחת לא תרוץ (אדום)', 'N שורות לא ירוצו (אדום)'));
    if (c.warn) parts.push(plural(c.warn, 'אזהרה אחת (צהוב)', 'N אזהרות (צהוב)'));
    msg = (fixMode ? 'תיקון: ' : '') + parts.join(' · ');
    if (results.length && !fixMode) msg += '. התוצאות למטה הן מהריצה הקודמת';
  }
  ui.status(msg);
  const zoneIn = $el(`${P}-zone-in`); if (zoneIn) zoneIn.classList.remove('tt-zone-dim');
}

function refreshStartButton(v) {
  if (awaitingErrorConfirm) return;
  const n = v.tasks.length;
  setText(`${P}-start`, n ? `התחל קליטה: ${plural(n, 'תלמיד אחד', 'N תלמידים')}` : 'התחל קליטה');
}

function resetStartButton() {
  awaitingErrorConfirm = false;
  if (lastValidation) refreshStartButton(lastValidation);
}

// ─── אירועי הטבלה ───────────────────────────────────────────────────────────
function onCellInput(e) {
  const el = e.target;
  if (!el || el.dataset == null || el.dataset.k === undefined) return;
  const i = Number(el.dataset.i);
  if (!rows[i]) return;
  const k = el.dataset.k;
  if (k === 'country' && e.type === 'change') el.value = absorbCanonicalCountry(el.value); // כינוי → השם ברשימה
  rows[i].fields[k] = el.value;
  if (k === 'idType' && rowIsBlank(rows[i])) rows[i].fields.idType = '';
  if (awaitingErrorConfirm) resetStartButton();
  // השורה האחרונה התמלאה → מוסיפים שורה ריקה חדשה בסוף (בלי לבנות מחדש את הקיימות)
  if (i === rows.length - 1 && !rowIsBlank(rows[i])) {
    rows.push(emptyRow());
    const tbody = document.querySelector(`#${P}-grid tbody`);
    if (tbody) tbody.insertAdjacentHTML('beforeend', rowHtml(rows.length - 1, rows[rows.length - 1]));
  }
  refreshMarks();
}

function onGridClick(e) {
  const t = e.target;
  const del = t && t.closest ? t.closest('[data-del]') : null;
  if (del) { rows.splice(Number(del.getAttribute('data-del')), 1); renderTable(); return; }
  const nb = t && t.closest ? t.closest('[data-newbtn]') : null;
  if (nb) {
    const r = rows[Number(nb.getAttribute('data-newbtn'))];
    if (r) { r.newOpen = !(r.newOpen || rowHasNewFields(r)); if (!r.newOpen && !rowHasNewFields(r)) r.newOpen = false; refreshMarks(); const inp = document.querySelector(`#${P}-grid tr.tt-sub[data-sub="${nb.getAttribute('data-newbtn')}"] input[data-k="firstName"]`); if (inp && r.newOpen) inp.focus(); }
    return;
  }
  const nc = t && t.closest ? t.closest('[data-newclear]') : null;
  if (nc) {
    const r = rows[Number(nc.getAttribute('data-newclear'))];
    if (r) { for (const k of NEW_FIELDS) r.fields[k] = ''; r.newOpen = false; renderTable(); }
  }
}

// הדבקה ישירות לתוך הטבלה (סבב 2): טקסט עם כמה תאים/שורות ממלא מהשורה שבה עומדים; טבלה ריקה מתמלאת כולה.
function onGridPaste(e) {
  const cd = e.clipboardData;
  const text = cd ? cd.getData('text/plain') : '';
  if (!text || !/[\t\r\n]/.test(text.trim())) return; // ערך בודד: הדבקה רגילה לתא
  const parsedRows = absorbTextToFieldRows(text).map((r) => rowFrom(r.fields));
  if (!parsedRows.length) return;
  e.preventDefault();
  const target = e.target && e.target.dataset ? Number(e.target.dataset.i) : NaN;
  const allBlank = rows.every(rowIsBlank);
  if (allBlank || Number.isNaN(target)) rows = parsedRows;
  else rows.splice(target, parsedRows.length, ...parsedRows);
  fixMode = false;
  renderTable();
  afterFill('הדבקה', parsedRows.length);
}

let lastInputLogLine = '';
let inputLogTimer = null;
function afterFill(sourceLabel, n, opts) {
  const v = lastValidation || validateRows();
  lastInputLogLine = `[קלט] ${sourceLabel}: ${v.filled.length} שורות · ${v.counts.bad} לא ירוצו · ${v.counts.warn} אזהרות`;
  if (!(opts && opts.quiet)) log(lastInputLogLine);
}

function fillFromText(text, sourceLabel, opts) {
  rows = absorbTextToFieldRows(text).map((r) => rowFrom(r.fields));
  fixMode = false;
  renderTable();
  afterFill(sourceLabel, rows.length, opts);
}

function scheduleInputLog() {
  clearTimeout(inputLogTimer);
  inputLogTimer = setTimeout(() => { if (lastInputLogLine) log(lastInputLogLine); }, 600);
}

// ─── תוצאות / סיכום / תור שמור ──────────────────────────────────────────────
function classify(r) {
  const k = absorbResultKind(r.status);
  return k === 'ok' ? 'ok' : (k === 'bad' ? 'bad' : 'warn');
}

function continueChecked() { const el = $el(`${P}-continue-other`); return !!(el && el.checked); }

function renderResults() {
  const zone = $el(`${P}-zone-out`);
  if (zone) zone.classList.toggle('tt-zone-dim', !results.length);
  setHtml(`${P}-results`, resultsTableHtml({ columns: RESULT_COLUMNS, rows: results, classify, actionKey: 'action' }));
  show(`${P}-results`, results.length > 0);
  const attention = results.filter((r) => !isAbsorbSuccess(r.status)).length;
  setDisabled(`${P}-keep-attention`, attention === 0);
  setText(`${P}-keep-attention`, attention ? `תקן והרץ שוב: ${plural(attention, 'תלמיד אחד', 'N תלמידים')}` : 'תקן והרץ שוב');
  const blocked = results.filter(absorbIsOtherInstituteBlock).length;
  const showContinue = blocked > 0 && !continueChecked() && !absorbIsBusy();
  show(`${P}-continue-rerun`, showContinue);
  if (showContinue) setText(`${P}-continue-rerun`, `סמן "אשר המשך" והרץ שוב ${plural(blocked, 'תלמיד אחד שנחסם', 'N תלמידים שנחסמו')}`);
  for (const id of ['tsv', 'csv']) setDisabled(`${P}-${id}`, results.length === 0);
}

// הסיכום (תגיות + משפט) מוצג כשהריצה הסתיימה; בזמן ריצה התוצאות מצטברות בלי סיכום.
function renderReport(report) {
  if (!report) { show(`${P}-report`, false); setHtml(`${P}-report`, ''); setText(`${P}-zone-out-note`, ''); return; }
  const c = absorbSummarizeKinds(results);
  const ok = c.absorbed + c.exists;
  const tags = [
    c.absorbed ? tagHtml({ label: `נקלטו ${c.absorbed}`, kind: 'ok' }) : '',
    c.exists ? tagHtml({ label: `כבר קיימים ${c.exists}`, kind: 'ok' }) : '',
    c.verify ? tagHtml({ label: `לבדוק ${c.verify}`, kind: 'warn' }) : '',
    c.bad ? tagHtml({ label: `דורשים טיפול ${c.bad}`, kind: 'bad' }) : '',
    c.stopped ? tagHtml({ label: `לא רצו ${c.stopped}`, kind: 'warn' }) : '',
  ].filter(Boolean).join('');
  const sentence = report.stopped || c.stopped
    ? `נעצר. ${plural(c.stopped, 'תלמיד אחד לא רץ', 'N תלמידים לא רצו')}`
    : `הסתיים: ${ok} מתוך ${results.length} הצליחו.${c.bad || c.verify ? ` ${plural(c.bad + c.verify, 'תלמיד אחד דורש טיפול', 'N תלמידים דורשים טיפול')}` : ' הכול טופל'}`;
  setHtml(`${P}-report`, `<div class="tt-tags">${tags}</div><div class="tt-report-summary">${esc(sentence)}</div>`);
  show(`${P}-report`, true);
  setText(`${P}-zone-out-note`, `ריצה מ-${new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`);
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
    refreshMarks();
  });
}

function setRunning(on) {
  setDisabled(`${P}-start`, !!on);
  show(`${P}-stop`, !!on);
  const zoneIn = $el(`${P}-zone-in`); if (zoneIn) zoneIn.classList.toggle('tt-zone-dim', !!on);
  const grid = $el(`${P}-grid`); if (grid) grid.style.pointerEvents = on ? 'none' : '';
  ui.running(!!on);
  ui.step(currentStep());
  if (!on && lastValidation) refreshStatusKeep();
}

// אחרי ריצה שורת-המצב של הזרימה ("הסתיים...") נשארת; השינוי הבא בטבלה מחשב אותה מחדש.
function refreshStatusKeep() { ui.step(currentStep()); }

function startDate() {
  const el = $el(`${P}-start-date`);
  return el ? String(el.value || '').trim() : '';
}

// ─── פעולות ─────────────────────────────────────────────────────────────────
async function start() {
  if (absorbIsBusy()) { ui.status('ריצה כבר פעילה. לעצור אותה: "עצור" או Escape'); return; }
  if (absorbHasSavedQueue()) { ui.status('יש ריצה שנקטעה וממתינה. לחץ "המשך" או "בטל" למעלה'); return; }
  const v = refreshMarks();
  if (!v.filled.length) { ui.status('אין שורות להרצה. הדבק מאקסל, טען קובץ, או מלא שורה בטבלה'); return; }
  if (v.counts.bad && !awaitingErrorConfirm) {
    awaitingErrorConfirm = true;
    setText(`${P}-start`, v.tasks.length ? `כן, התחל בלי ${plural(v.counts.bad, 'השורה האדומה', 'N השורות האדומות')}` : 'התחל קליטה');
    ui.status(`${plural(v.counts.bad, 'שורה אחת לא תרוץ', 'N שורות לא ירוצו')} (אדום). תקן אותן, או לחץ שוב כדי להתחיל בלי האדומות`);
    rowFilter = 'bad';
    refreshMarksKeepButton();
    return;
  }
  if (!v.tasks.length) { ui.status('אין תלמידים שיכולים לרוץ. תקן את השורות האדומות'); return; }
  awaitingErrorConfirm = false;
  fixMode = false;
  rowFilter = 'all';
  renderReport(null);
  renderStaleQueue(null);
  results = [];
  renderResults();
  clearAbsorbStop();
  setRunning(true);
  ui.progress(0, v.tasks.length);
  ui.status(`מתחיל: ${plural(v.tasks.length, 'תלמיד אחד', 'N תלמידים')}…`);
  log(`[התחלה] ${v.tasks.length} תלמידים · תאריך קליטה "${startDate() || '(היום)'}"`);
  const started = await absorbStartRun(v.tasks);
  if (started === false) setRunning(false); // ממצא 5: לשונית אחרת רצה; ההודעה הוצגה דרך onLocked
}

// כמו refreshMarks אבל בלי לדרוס את תווית-האישור של "התחל"
function refreshMarksKeepButton() { const keep = awaitingErrorConfirm; refreshMarks(); awaitingErrorConfirm = keep; }

function stop() {
  ui.status('עוצר…');
  log('⛔ עצירה לבקשת המשתמש');
  absorbStop();
  setRunning(false);
}

// זרימת-התיקון: משאיר בטבלה רק את מי שדורש טיפול, פותח שורת-פרטים למי שהאתר אמר עליו "תלמיד חדש", וגולל לטבלה.
// כשהטבלה ריקה (אחרי טעינות-דף) בונה אותה מהתוצאות (סבב רטוב 1.11.2026).
function fixAndRerun() {
  const source = rows.some((r) => !rowIsBlank(r))
    ? rows
    : results.map((r) => rowFrom({ branch: r.branch || '', studyType: r.studyType || '', identifier: r.identity || '', idType: r.idType === 'passport' ? 'passport' : '' }));
  const { rows: kept } = absorbRowsNeedingAttention(source, results);
  const byKey = new Map(results.map((r) => [`${String(r.branch || '').trim().padStart(2, '0')}|${String(r.studyType || '').trim()}|${absorbNormalizeId(r.identity)}`, r]));
  rows = kept.map((r) => {
    const f = Object.assign(emptyFields(), r.fields);
    const row = { fields: f, newOpen: !!r.newOpen };
    const res = byKey.get(`${String(f.branch || '').trim().padStart(2, '0')}|${String(f.studyType || '').trim()}|${absorbNormalizeId(f.identifier)}`);
    if (res && absorbStatusKey(res.status).startsWith('תלמיד חדש')) row.newOpen = true;
    return row;
  });
  fixMode = rows.length > 0;
  rowFilter = 'all';
  awaitingErrorConfirm = false;
  renderTable();
  const n = rows.filter((r) => !rowIsBlank(r)).length;
  const missing = rows.filter((r) => r.newOpen && !rowHasNewFields(r)).length;
  ui.status(n
    ? (missing ? `תיקון: ${plural(missing, 'תלמיד אחד ממתין להשלמה', 'N תלמידים ממתינים להשלמה')}: שם פרטי, שם משפחה ותאריך לידה. אחר-כך "התחל קליטה"` : `תיקון: ${plural(n, 'תלמיד אחד בטבלה', 'N תלמידים בטבלה')}. תקן לפי "מה לעשות" בתוצאות ולחץ "התחל קליטה"`)
    : 'אין מי שדורש טיפול');
  log(`[קלט] תקן והרץ שוב: ${n} תלמידים בטבלה`);
  const grid = $el(`${P}-grid`);
  if (grid && grid.scrollIntoView) { try { grid.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* noop */ } }
}

// הכרעה ט: "נחסם: רשום במוסד אחר" בלי "אשר המשך" → לחיצה אחת מסמנת ומריצה שוב רק את מי שנחסם.
function continueAndRerun() {
  const cb = $el(`${P}-continue-other`);
  if (cb) { cb.checked = true; saveContinue(true); }
  const blocked = results.filter(absorbIsOtherInstituteBlock);
  if (!blocked.length) return;
  rows = blocked.map((r) => rowFrom({ branch: r.branch || '', studyType: r.studyType || '', identifier: r.identity || '', idType: r.idType === 'passport' ? 'passport' : '' }));
  fixMode = true;
  renderTable();
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
  ui.status(downloadCsv('תבנית-קליטת-תלמידים.csv', [ABSORB_TEMPLATE_HEADER.slice()]) ? 'התבנית הורדה. מלא באקסל, ואז הדבק לטבלה או טען את הקובץ' : 'הורדת התבנית נכשלה');
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
const ABSORB_PAGES = ['institute', 'studyType', 'newStudent'];

function mount(container, panelUi, page) {
  ui = panelUi;
  pageRef = page;
  const fits = !!(page && ABSORB_PAGES.includes(page.kind));
  const last = absorbLastResults();
  const pasteOpen = !rows.some((r) => !rowIsBlank(r)) && !absorbGetResults().length && !(last && last.results && last.results.length);
  container.innerHTML = `
    ${datalistsHtml(page)}
    ${zoneHtml({ id: `${P}-zone-in`, title: 'את מי קולטים', inner: `
      <p class="tt-zone-lead">כאן קולטים כמה תלמידים בבת אחת: ממלאים בטבלה, או מדביקים מאקסל ישר לתוכה, או טוענים קובץ. בודקים, ולוחצים "התחל קליטה".${fits ? '' : ' אפשר להתחיל גם מכאן: הכלי יעבור בעצמו לדף המוסד הנכון.'}</p>
      <div class="tt-box tt-box-warn" style="margin:4px 0 6px">${esc(PASSPORT_WARNING)}</div>
      <div class="tt-tags" id="${P}-tags"></div>
      <div class="tt-row tt-row-wrap tt-row-tight">
        ${buttonHtml({ id: `${P}-paste-btn`, label: 'הדבק מאקסל', kind: 'ghost', size: 'small', title: 'פותח תיבה להדבקה. אפשר גם לעמוד בתא בטבלה וללחוץ Ctrl+V' })}
        ${buttonHtml({ id: `${P}-xlsx`, label: 'טען קובץ אקסל', kind: 'ghost', size: 'small' })}
        ${buttonHtml({ id: `${P}-template`, label: 'הורד תבנית', kind: 'ghost', size: 'small' })}
        ${buttonHtml({ id: `${P}-copy-input`, label: 'העתק את הטבלה לאקסל', kind: 'ghost', size: 'small' })}
        <span class="tt-hint">או: עמוד בתא ולחץ Ctrl+V</span>
      </div>
      <input id="${P}-xlsx-file" type="file" accept=".xlsx,.xls" hidden>
      <details class="tt-section" id="${P}-paste"${pasteOpen ? ' open' : ''}>
        <summary>תיבת הדבקה (טורים: סניף, סוג לימוד, מספר, שם פרטי, שם משפחה, תאריך לידה, ארץ, מגדר, מצב משפחתי; עם כותרת או בלי)</summary>
        <textarea id="${P}-input" class="tt-textarea tt-textarea-sm" placeholder="01&#9;300&#9;123456789&#10;12&#9;600&#9;AB1234567&#9;&#9;&#9;15/03/1995&#9;צרפת"></textarea>
      </details>
      <div id="${P}-grid" class="tt-scroll" style="max-height:300px"></div>
      <div id="${P}-stale" class="tt-box tt-box-warn" hidden></div>
      <div class="tt-row tt-row-wrap">
        ${fieldHtml('תאריך קליטה (ריק = היום)', `<input id="${P}-start-date" class="tt-input tt-mono" type="text" maxlength="10" placeholder="${todayDMY()}" style="max-width:130px">`)}
        <label class="tt-check" title="האתר מזהיר כשהתלמיד רשום במוסד אחר ומבקש אישור. מסומן: הכלי מאשר; לא מסומן: השורה מסומנת &quot;נחסם&quot; ואתה מחליט"><input type="checkbox" id="${P}-continue-other"${loadContinue() ? ' checked' : ''}> תלמיד שרשום במוסד אחר: אשר "המשך" (לימודיו שם יסתיימו היום)</label>
      </div>
      <div class="tt-row tt-row-wrap">
        ${buttonHtml({ id: `${P}-start`, label: 'התחל קליטה', kind: 'primary' })}
        ${buttonHtml({ id: `${P}-stop`, label: 'עצור', kind: 'danger', title: 'גם מקש Escape עוצר', attrs: 'hidden' })}
        <span class="tt-legend"><i style="background:var(--tt-bad)"></i>לא ירוץ עד שיתוקן <i style="background:var(--tt-warn);margin-inline-start:8px"></i>אזהרה, ירוץ</span>
      </div>` })}
    ${zoneHtml({ id: `${P}-zone-out`, title: 'תוצאות', dim: true, inner: `
      <div id="${P}-report" hidden></div>
      <div class="tt-row tt-row-wrap tt-row-tight">
        ${buttonHtml({ id: `${P}-keep-attention`, label: 'תקן והרץ שוב', kind: 'primary', size: 'small', disabled: true, title: 'משאיר בטבלה רק את מי שדורש טיפול, כדי להשלים ולהתחיל שוב' })}
        ${buttonHtml({ id: `${P}-continue-rerun`, label: 'סמן "אשר המשך" והרץ שוב', kind: 'ghost', size: 'small', attrs: 'hidden' })}
        ${buttonHtml({ id: `${P}-tsv`, label: 'העתק תוצאות לאקסל', kind: 'ghost', size: 'small', disabled: true, title: 'מכיל מזהים מלאים: לא להדביק בצ\'אט או בדיווח-באג' })}
        ${buttonHtml({ id: `${P}-csv`, label: 'הורד קובץ', kind: 'ghost', size: 'small', disabled: true, title: 'קובץ CSV עם כל העמודות, כולל "פירוט". מכיל מזהים מלאים' })}
      </div>
      <div id="${P}-results" class="tt-scroll" hidden></div>` })}`;

  bindDateMask(`${P}-start-date`);
  // הטבלה מתעדכנת בכל הקשה; שורת היומן "[קלט] הדבקה" נכתבת פעם אחת אחרי שההקלדה נרגעה (סבב רטוב 31.10.2026)
  $el(`${P}-input`).addEventListener('input', function () { fillFromText(this.value, 'הדבקה', { quiet: true }); scheduleInputLog(); });
  $el(`${P}-paste-btn`).addEventListener('click', () => { const d = $el(`${P}-paste`); if (d) { d.open = true; } const ta = $el(`${P}-input`); if (ta) ta.focus(); });
  const grid = $el(`${P}-grid`);
  grid.addEventListener('input', onCellInput);
  grid.addEventListener('change', onCellInput);
  grid.addEventListener('click', onGridClick);
  grid.addEventListener('paste', onGridPaste);
  $el(`${P}-tags`).addEventListener('click', onTagsClick);
  $el(`${P}-continue-other`).addEventListener('change', function () { saveContinue(this.checked); renderResults(); });
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
  $el(`${P}-keep-attention`).addEventListener('click', fixAndRerun);
  $el(`${P}-continue-rerun`).addEventListener('click', continueAndRerun);
  $el(`${P}-template`).addEventListener('click', downloadTemplate);
  $el(`${P}-copy-input`).addEventListener('click', copyInputAsTsv);
  $el(`${P}-xlsx`).addEventListener('click', () => $el(`${P}-xlsx-file`).click());
  $el(`${P}-xlsx-file`).addEventListener('change', handleXlsx);

  absorbSetHooks({
    getStartDate: startDate,
    getContinueOtherInstitute: continueChecked,
    onStart: (queue, idx) => { total = queue.length; ui.progress(idx, total); setRunning(true); },
    onResume: (queue, res, idx) => {
      total = queue.length; results = res.slice(); renderResults(); ui.progress(idx, total); setRunning(true);
      // הטבלה מציגה את התור שרץ
      rows = queue.map((t) => rowFrom({
        branch: t.branch, studyType: t.studyType, identifier: t.identity, idType: t.idType === 'passport' ? 'passport' : '',
        firstName: (t.newStudent || {}).firstName || '', lastName: (t.newStudent || {}).lastName || '',
        birthDate: t.birthDate || '', country: t.country || '',
      }));
      renderTable();
      setRunning(true);
      ui.status(`ממשיך אחרי טעינת דף: ${idx + 1} מתוך ${total}`);
      ui.open();
    },
    onProgress: (idx, tot, task) => { total = tot; ui.progress(idx, tot); ui.status(`מעבד ${idx + 1} מתוך ${tot}: סניף ${task.branch} · סוג ${task.studyType} · ${task.idType === 'passport' ? 'דרכון' : 'ת.ז.'}`); },
    onResult: (result, all) => { results = all.slice(); renderResults(); ui.progress(all.length, Math.max(total, all.length)); },
    onNavigating: () => { ui.status('עובר לדף הנכון באתר… ממתין לטעינה'); },
    onStaleQueue: (info) => {
      setRunning(false);
      ui.status(info && info.reason === 'foreign-page' ? 'יש ריצה שנקטעה, אך הדף הזה אינו חלק מהקליטה. בחר "המשך" או "בטל"' : 'יש ריצה שנקטעה. בחר "המשך" או "בטל"');
      renderStaleQueue(info);
      ui.open();
    },
    onLocked: (msg) => { setRunning(false); ui.status(msg); ui.open(); },
    onDone: (all, report) => {
      results = all.slice(); fixMode = false; renderResults(); renderReport(report); setRunning(false); ui.progress(all.length, all.length);
      const c = absorbSummarizeKinds(results);
      ui.status(c.stopped ? `נעצר. ${plural(c.stopped, 'תלמיד אחד לא רץ', 'N תלמידים לא רצו')}. "תקן והרץ שוב" מריץ את מי שנותר`
        : (c.bad || c.verify ? `הסתיים: ${c.absorbed + c.exists} מתוך ${results.length} הצליחו. ${plural(c.bad + c.verify, 'תלמיד אחד דורש טיפול', 'N תלמידים דורשים טיפול')}: ראה "מה לעשות" בתוצאות` : `הסתיים: ${results.length} מתוך ${results.length} הצליחו. הכול טופל`));
    },
  });

  log(`[קליטה] דף ${page.kind}${page.branch ? ` · סניף ${page.branch} [${page.branchSource || '?'}]` : ''}${page.studyType ? ' · סוג ' + page.studyType : ''}`);
  renderTable();
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
      renderReport(last.report);
      ui.step(currentStep());
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
