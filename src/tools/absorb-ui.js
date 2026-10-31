// לשונית "קליטת תלמידים" בחלונית המאוחדת. הזרימה ב-absorb-flow.js; כאן הממשק:
// טבלת-הזנה (שורה לתלמיד, בחירה מרשימות: סניף, סוג לימוד, ארץ; שדות לפי סוג המזהה), הדבקה מאקסל
// שממלאת את הטבלה, טעינת/הורדת אקסל, אימות לכל שורה, התחל/עצור, תוצאות, דוח "מה נשאר".
// מסלול-פרסור אחד: הטבלה → טקסט עם כותרת → parseAbsorbInput (כמו הדבקה). אין גישה ל-document ברמת המודול.

import { $el } from '../core/dom.js';
import { log } from '../core/log.js';
import { downloadCsv, copyTextToClipboard } from '../core/csv.js';
import { COUNTRIES } from '../data/countries.js';
import { detectIdType } from '../core/identity.js';
import { readBranchesFromTree, gridToRows, gridStudyTypes } from '../core/navigate.js';
import { parseAbsorbInput, absorbTextToFieldRows, absorbFieldRowsToText, ABSORB_FIELD_ORDER } from './absorb-parse.js';
import { loadXlsxFile } from './absorb-xlsx.js';
import { ABSORB_TEMPLATE_HEADER, isAbsorbSuccess, absorbStatusKey, buildResultsTsv, buildResultsCsvRows, absorbRowsNeedingAttention } from './absorb-report.js';
import { clearAbsorbStop } from './absorb-state.js';
import {
  absorbSetHooks, absorbStartRun, absorbResumeIfPending, absorbStop, absorbHasSavedQueue, absorbGetResults,
  absorbIsRunning, absorbIsBusy, absorbSavedQueueInfo, absorbDiscardSavedQueue, absorbLastResults,
} from './absorb-flow.js';
import { esc, buttonHtml, buttonsRowHtml, fieldHtml, resultsTableHtml, reportBoxHtml, flash, setHtml, setText, show, setDisabled, bindDateMask, todayDMY } from '../ui/widgets.js';

const P = 'tt-absorb';
const COUNTRY_NAMES = COUNTRIES.map((c) => c.he).sort((a, b) => a.localeCompare(b, 'he'));
// סוגי-לימוד מוכרים (מהאתר, סניף 00) לרשימת-הבחירה כשאין גריד סוגי-לימוד בדף
const COMMON_STUDY_TYPES = ['300', '600', '605', '700', '705', '708', '720', '725', '728'];
const GENDERS = [['', ''], ['זכר', 'זכר'], ['נקבה', 'נקבה']];
const FAMILY = [['', ''], ['רווק', 'רווק'], ['נשוי', 'נשוי'], ['גרוש', 'גרוש'], ['אלמן', 'אלמן']];

let ui = null;
let rows = []; // [{ fields: {...} }] - מקור-האמת להרצה
let results = [];
let total = 0;
let awaitingErrorConfirm = false;
let showExtra = false; // עמודות תלמיד-חדש (שם, משפחה, מגדר, מצב)

const RESULT_COLUMNS = [
  { key: 'branch', label: 'סניף', center: true, width: '44px' },
  { key: 'studyType', label: 'סוג', center: true, width: '44px' },
  { key: 'identity', label: 'ת.ז./דרכון', mono: true },
  { key: 'status', label: 'סטטוס' },
];

function emptyRow() {
  return { fields: { branch: '', studyType: '', identifier: '', firstName: '', lastName: '', birthDate: '', country: '', gender: '', familyStatus: '' } };
}

// ─── רשימות-בחירה: מהדף בלבד (עץ-הצד, גריד סוגי-הלימוד), בלי מפות נלמדות ───────────────
function knownBranches(page) {
  const set = new Set(readBranchesFromTree()); // העץ קיים בדף המוסד ובדף סוג-הלימוד (F2)
  if (page && page.branch) set.add(page.branch);
  return Array.from(set).sort();
}

function knownStudyTypes(branch, page) {
  const set = new Set();
  if (page && page.kind === 'institute' && (!branch || page.branch === branch)) {
    try {
      const table = document.querySelector('table[id$="gvStudyType"]');
      if (table) for (const st of gridStudyTypes(gridToRows(table))) set.add(st.code);
    } catch (e) { /* לא קריטי */ }
  }
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

// ─── הטבלה ─────────────────────────────────────────────────────────────────
function rowIsBlank(r) { return ABSORB_FIELD_ORDER.every((k) => !String(r.fields[k] || '').trim()); }

function validateRows() {
  const filled = rows.filter((r) => !rowIsBlank(r));
  const parsed = parseAbsorbInput(absorbFieldRowsToText(filled));
  // מספר השורה בפרסור = אינדקס+2 (שורת הכותרת היא 1)
  const errorByIdx = new Map();
  for (const e of parsed.errors) errorByIdx.set(e.line - 2, e.reason);
  return { tasks: parsed.tasks, errors: parsed.errors, errorByIdx, filled };
}

function cellInput(i, key, value, { list, placeholder = '', disabled = false, mono = false, width } = {}) {
  return `<input type="text" class="tt-input${mono ? ' tt-mono' : ''}" data-i="${i}" data-k="${key}" value="${esc(value)}"${list ? ` list="${list}"` : ''}
    placeholder="${esc(placeholder)}"${disabled ? ' disabled' : ''}${width ? ` style="width:${width}"` : ''} autocomplete="off">`;
}

function cellSelect(i, key, value, options) {
  return `<select class="tt-select" data-i="${i}" data-k="${key}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function rowState(r) {
  const f = r.fields;
  const blank = rowIsBlank(r);
  // דרכון: אותיות במזהה, או (31.10.2026) מזהה ספרתי עם ארץ מלאה (דרכון שכולו ספרות; תא הארץ פתוח להקלדה תמיד)
  const passport = !!f.identifier && (detectIdType(f.identifier).type === 'passport' || (!!String(f.country || '').trim() && !/^(tz|ת\.?ז\.?)\s*[:=]/i.test(f.identifier)));
  const needBirth = passport || !!(f.firstName || f.lastName);
  return { blank, passport, needBirth };
}

function rowHtml(i, r, err) {
  const f = r.fields;
  const { blank, passport, needBirth } = rowState(r);
  return `<tr class="${err ? 'tt-r-bad' : ''}" data-i="${i}"${err ? ` title="${esc(err)}"` : ''}>
    <td class="tt-center tt-hint tt-rownum">${blank ? '' : i + 1}</td>
    <td>${cellInput(i, 'branch', f.branch, { list: `${P}-dl-branches`, placeholder: '00', mono: true, width: '52px' })}</td>
    <td>${cellInput(i, 'studyType', f.studyType, { list: `${P}-dl-studytypes`, placeholder: '600', mono: true, width: '60px' })}</td>
    <td class="tt-center tt-hint tt-type-label" style="white-space:nowrap">${blank ? '' : (passport ? 'דרכון' : 'ת.ז.')}</td>
    <td>${cellInput(i, 'identifier', f.identifier, { placeholder: 'ת.ז. או דרכון', mono: true, width: '110px' })}</td>
    <td class="tt-cell-birth${needBirth ? '' : ' tt-cell-off'}">${cellInput(i, 'birthDate', f.birthDate, { placeholder: needBirth ? 'DD/MM/YYYY' : '', mono: true, width: '92px' })}</td>
    <td class="tt-cell-country${passport ? '' : ' tt-cell-off'}">${cellInput(i, 'country', f.country, { list: `${P}-dl-countries`, placeholder: passport ? 'בחר ארץ' : '', width: '110px' })}</td>
    ${showExtra ? `<td>${cellInput(i, 'firstName', f.firstName, { width: '80px' })}</td><td>${cellInput(i, 'lastName', f.lastName, { width: '80px' })}</td>
    <td>${cellSelect(i, 'gender', f.gender, GENDERS)}</td><td>${cellSelect(i, 'familyStatus', f.familyStatus, FAMILY)}</td>` : ''}
    <td class="tt-cell-del">${blank ? '' : `<button type="button" class="tt-btn tt-btn-subtle tt-btn-sm" data-del="${i}" title="מחק שורה">×</button>`}</td>
  </tr>`;
}

// אימות + סיכום + סימון שורות, בלי לבנות מחדש את השדות (השדה שבפוקוס נשאר בפוקוס).
function refreshMarks() {
  const v = validateRows();
  let filledIdx = -1;
  rows.forEach((r, i) => {
    const tr = document.querySelector(`#${P}-grid tr[data-i="${i}"]`);
    if (!tr) return;
    const { blank, passport, needBirth } = rowState(r);
    if (!blank) filledIdx++;
    const err = blank ? '' : (v.errorByIdx.get(filledIdx) || '');
    tr.classList.toggle('tt-r-bad', !!err);
    if (err) tr.setAttribute('title', err); else tr.removeAttribute('title');
    const num = tr.querySelector('.tt-rownum'); if (num) num.textContent = blank ? '' : String(i + 1);
    const type = tr.querySelector('.tt-type-label'); if (type) type.textContent = blank ? '' : (passport ? 'דרכון' : 'ת.ז.');
    const birth = tr.querySelector('.tt-cell-birth'); if (birth) { birth.classList.toggle('tt-cell-off', !needBirth); const inp = birth.querySelector('input'); if (inp) inp.placeholder = needBirth ? 'DD/MM/YYYY' : ''; }
    const country = tr.querySelector('.tt-cell-country'); if (country) { country.classList.toggle('tt-cell-off', !passport); const inp = country.querySelector('input'); if (inp) inp.placeholder = passport ? 'בחר ארץ' : ''; }
    const del = tr.querySelector('.tt-cell-del'); if (del && !blank && !del.firstChild) del.innerHTML = `<button type="button" class="tt-btn tt-btn-subtle tt-btn-sm" data-del="${i}" title="מחק שורה">×</button>`;
  });
  const problems = v.errors.length;
  setText(`${P}-grid-summary`, v.filled.length
    ? `${v.tasks.length} שורות מוכנות להרצה${problems ? ` · ${problems} שורות עם שגיאה (מסומנות באדום; העמד את העכבר על השורה לפירוט)` : ''}`
    : 'אין שורות. הדבק מאקסל, טען קובץ, או מלא שורה בטבלה');
  renderErrors(problems ? v.errors : [], v.tasks.length);
  return v;
}

function renderTable() {
  if (!rows.length || !rowIsBlank(rows[rows.length - 1])) rows.push(emptyRow());
  const head = `<tr><th style="width:26px"></th><th>סניף</th><th>סוג לימוד</th><th>סוג מזהה</th><th>ת.ז./דרכון</th>
    <th>תאריך לידה</th><th>ארץ</th>${showExtra ? '<th>שם פרטי</th><th>שם משפחה</th><th>מגדר</th><th>מצב משפחתי</th>' : ''}<th style="width:22px"></th></tr>`;
  setHtml(`${P}-grid`, `<table class="tt-grid-input"><thead>${head}</thead><tbody>${rows.map((r, i) => rowHtml(i, r, '')).join('')}</tbody></table>`);
  return refreshMarks();
}

function onCellInput(e) {
  const el = e.target;
  if (!el || el.dataset == null || el.dataset.k === undefined) return;
  const i = Number(el.dataset.i);
  if (!rows[i]) return;
  rows[i].fields[el.dataset.k] = el.value;
  if (awaitingErrorConfirm) resetStartButton();
  // השורה האחרונה התמלאה → מוסיפים שורה ריקה חדשה בסוף (בלי לבנות מחדש את הקיימות)
  if (i === rows.length - 1 && !rowIsBlank(rows[i])) {
    rows.push(emptyRow());
    const tbody = document.querySelector(`#${P}-grid tbody`);
    if (tbody) tbody.insertAdjacentHTML('beforeend', rowHtml(rows.length - 1, rows[rows.length - 1], ''));
  }
  refreshMarks();
}

function onGridClick(e) {
  const del = e.target && e.target.closest ? e.target.closest('[data-del]') : null;
  if (!del) return;
  rows.splice(Number(del.getAttribute('data-del')), 1);
  renderTable();
}

let lastInputLogLine = '';
let inputLogTimer = null;
function fillFromText(text, sourceLabel, opts) {
  const parsedRows = absorbTextToFieldRows(text);
  rows = parsedRows.map((r) => ({ fields: r.fields }));
  const anyExtra = rows.some((r) => r.fields.firstName || r.fields.lastName || r.fields.gender || r.fields.familyStatus);
  if (anyExtra) { showExtra = true; const cb = $el(`${P}-extra`); if (cb) cb.checked = true; }
  const v = renderTable();
  ui.status(`${sourceLabel}: ${v.filled.length} שורות נטענו לטבלה${v.errors.length ? `, ${v.errors.length} עם שגיאה` : ''}. בדוק ולחץ "התחל קליטה"`);
  lastInputLogLine = `[קלט] ${sourceLabel}: ${v.filled.length} שורות · ${v.errors.length} שגויות`;
  if (!(opts && opts.quiet)) log(lastInputLogLine);
}

function scheduleInputLog() {
  clearTimeout(inputLogTimer);
  inputLogTimer = setTimeout(() => { if (lastInputLogLine) log(lastInputLogLine); }, 600);
}

// ─── תוצאות / דוח / תור שמור ────────────────────────────────────────────────
function classify(r) {
  const key = absorbStatusKey(r.status);
  if (isAbsorbSuccess(r.status)) return 'ok';
  if (key === 'נעצר' || key === 'דולג') return 'warn';
  return 'bad';
}

function renderResults() {
  setHtml(`${P}-results`, resultsTableHtml({ columns: RESULT_COLUMNS, rows: results, classify }));
  show(`${P}-results-wrap`, results.length > 0);
  const attention = results.filter((r) => !isAbsorbSuccess(r.status)).length;
  setDisabled(`${P}-keep-attention`, attention === 0);
  setText(`${P}-keep-attention`, attention ? `השאר בטבלה רק ${attention} שורות שדורשות טיפול` : 'השאר בטבלה רק שורות שדורשות טיפול');
}

// זרימת-התיקון (31.10.2026): אחרי ריצה, הטבלה עדיין מציגה את כל השורות. הכפתור משאיר רק את אלה שלא הצליחו
// (לפי התוצאות), פותח את עמודות תלמיד-חדש כשצריך, ובעל-המערכת משלים/מתקן ולוחץ "התחל קליטה" שוב.
function keepRowsNeedingAttention() {
  // סבב רטוב 1.11.2026: ריצה שנגמרה אחרי טעינת-דף משאירה טבלה ריקה בדף האחרון (השורות לא שורדות טעינה).
  // אז בונים את השורות מהתוצאות עצמן (סניף, סוג, מזהה); את שאר הפרטים בעל-המערכת ממילא משלים.
  const source = rows.some((r) => !rowIsBlank(r))
    ? rows
    : results.map((r) => ({ fields: { branch: r.branch || '', studyType: r.studyType || '', identifier: r.identity || '', firstName: '', lastName: '', birthDate: '', country: '', gender: '', familyStatus: '' } }));
  const { rows: kept, needsExtra } = absorbRowsNeedingAttention(source, results);
  rows = kept.map((r) => ({ fields: Object.assign({}, r.fields) }));
  if (needsExtra) { showExtra = true; const cb = $el(`${P}-extra`); if (cb) cb.checked = true; }
  renderTable();
  ui.status(rows.filter((r) => !rowIsBlank(r)).length
    ? `${rows.filter((r) => !rowIsBlank(r)).length} שורות בטבלה. השלם או תקן לפי עמודת "מה לעשות" בתוצאות, ולחץ "התחל קליטה"`
    : 'אין שורות שדורשות טיפול');
  log(`[קלט] נשארו בטבלה ${rows.filter((r) => !rowIsBlank(r)).length} שורות שדורשות טיפול`);
}

function renderErrors(errors, validCount) {
  if (!errors || !errors.length) { show(`${P}-errors`, false); setHtml(`${P}-errors`, ''); return; }
  const items = errors.slice(0, 25).map((e) => `<li>שורה ${esc(e.line - 1)}: ${esc(e.reason)}</li>`).join('');
  setHtml(`${P}-errors`, `<b>${errors.length} שורות לא יורצו</b> (${validCount} תקינות):<ul>${items}${errors.length > 25 ? `<li>ועוד ${errors.length - 25}</li>` : ''}</ul>`);
  show(`${P}-errors`, true);
}

function renderReport(report) {
  if (!report) { show(`${P}-report`, false); setHtml(`${P}-report`, ''); return; }
  setHtml(`${P}-report`, reportBoxHtml(report));
  show(`${P}-report`, true);
}

// תיבת "תור פתוח": ישן (ממצא ישן) או דף זר (ממצא 11). "המשך" מכריח המשך; "נקה" מוחק.
function renderStaleQueue(info) {
  if (!info) { show(`${P}-stale`, false); setHtml(`${P}-stale`, ''); return; }
  const left = Math.max(0, (info.total || 0) - (info.curIdx || 0));
  const startedMs = Date.parse(info.startedAt);
  const ageMin = Number.isNaN(startedMs) ? null : Math.round((Date.now() - startedMs) / 60000);
  const why = info.reason === 'foreign-page'
    ? 'הדף הזה אינו חלק מהקליטה, ולכן לא ממשיכים לבד. "המשך" ינווט לדף סוג-הלימוד של השורה הבאה.'
    : 'התור ישן מדי להמשך אוטומטי.';
  setHtml(`${P}-stale`, `<b>יש תור פתוח (${esc(left)} שורות)${ageMin === null ? '' : `, מלפני ${esc(ageMin)} דקות`}</b>: ${esc(info.curIdx || 0)} מתוך ${esc(info.total || 0)} הושלמו. ${why}
    ${buttonsRowHtml([
      { id: `${P}-stale-go`, label: 'המשך את התור', kind: 'primary', size: 'small' },
      { id: `${P}-stale-clear`, label: 'נקה את התור', kind: 'danger', size: 'small' },
    ])}`);
  show(`${P}-stale`, true);
  $el(`${P}-stale-go`).addEventListener('click', () => {
    renderStaleQueue(null);
    ui.status('ממשיך את התור השמור…');
    setRunning(true);
    Promise.resolve().then(() => absorbResumeIfPending({ force: true })).then((ran) => { if (ran === false && !absorbIsBusy()) setRunning(false); })
      .catch((e) => { log('[המשך] כשל: ' + (e && e.message)); setRunning(false); });
  });
  $el(`${P}-stale-clear`).addEventListener('click', () => {
    absorbDiscardSavedQueue();
    renderStaleQueue(null);
    setRunning(false);
    ui.status('התור השמור נמחק. אפשר להתחיל ריצה חדשה');
  });
}

function setRunning(on) {
  setDisabled(`${P}-start`, !!on);
  ui.running(!!on);
}

function startDate() {
  const el = $el(`${P}-start-date`);
  return el ? String(el.value || '').trim() : '';
}

function resetStartButton() {
  awaitingErrorConfirm = false;
  setText(`${P}-start`, 'התחל קליטה');
}

// ─── פעולות ─────────────────────────────────────────────────────────────────
async function start() {
  if (absorbIsBusy()) { ui.status('ריצה כבר פעילה. לעצור אותה: "עצור" או Escape'); return; }
  if (absorbHasSavedQueue()) { ui.status('יש תור שמור שממתין להמשך. לחץ "המשך" או "נקה" למעלה, או "עצור"'); return; }
  const v = renderTable();
  if (!v.filled.length) { ui.status('אין שורות להרצה. הדבק מאקסל, טען קובץ, או מלא שורה בטבלה'); return; }
  if (v.errors.length && !awaitingErrorConfirm) {
    awaitingErrorConfirm = true;
    setText(`${P}-start`, v.tasks.length ? `הרץ בכל זאת את ${v.tasks.length} התקינות` : 'התחל קליטה');
    ui.status(`${v.errors.length} שורות בעייתיות (מסומנות באדום). תקן אותן, או לחץ שוב כדי להריץ רק את התקינות`);
    return;
  }
  if (!v.tasks.length) { ui.status('אין שורות תקינות להרצה'); return; }
  resetStartButton();
  renderReport(null);
  renderStaleQueue(null);
  results = [];
  renderResults();
  clearAbsorbStop();
  setRunning(true);
  ui.progress(0, v.tasks.length);
  ui.status(`מריץ ${v.tasks.length} תלמידים…`);
  log(`[התחלה] ${v.tasks.length} תלמידים · תאריך תחילת לימודים "${startDate() || '(ברירת המחדל של האתר)'}"`);
  const started = await absorbStartRun(v.tasks);
  if (started === false) setRunning(false); // ממצא 5: לשונית אחרת רצה; ההודעה הוצגה דרך onLocked
}

function stop() {
  ui.status('עוצר…');
  log('⛔ עצירה לבקשת המשתמש');
  absorbStop();
  setRunning(false);
}

function copyTsv() {
  const list = absorbGetResults().length ? absorbGetResults() : results;
  if (!list.length) { ui.status('אין תוצאות להעתקה'); return; }
  copyTextToClipboard(buildResultsTsv(list)).then((ok) => {
    flash(`${P}-tsv`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק תוצאות לאקסל');
    ui.status(ok ? 'התוצאות הועתקו. הדבק באקסל (Ctrl+V)' : 'ההעתקה נחסמה בדפדפן. השתמש בייצוא CSV');
  });
}

function exportCsv() {
  const list = absorbGetResults().length ? absorbGetResults() : results;
  if (!list.length) { ui.status('אין תוצאות לייצוא'); return; }
  const name = `absorptions_${new Date().toISOString().slice(0, 10)}.csv`;
  ui.status(downloadCsv(name, buildResultsCsvRows(list)) ? `הורד ${name}` : 'הייצוא נכשל');
}

function downloadTemplate() {
  ui.status(downloadCsv('תבנית-קליטת-תלמידים.csv', [ABSORB_TEMPLATE_HEADER.slice()]) ? 'התבנית הורדה. מלא באקסל, ואז הדבק את הטורים כאן או טען את הקובץ' : 'הורדת התבנית נכשלה');
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
function mount(container, panelUi, page) {
  ui = panelUi;
  container.innerHTML = `
    ${datalistsHtml(page)}
    <details class="tt-paste" ${rows.length ? '' : 'open'}>
      <summary class="tt-hint" style="cursor:pointer">הדבקה מאקסל (טורים: סניף, סוג לימוד, ת.ז./דרכון, שם פרטי, שם משפחה, תאריך לידה, ארץ, מגדר, מצב משפחתי; עם כותרת או בלי)</summary>
      <textarea id="${P}-input" class="tt-textarea" placeholder="01&#9;300&#9;123456789&#10;12&#9;600&#9;AB1234567&#9;&#9;&#9;15/03/1995&#9;צרפת"></textarea>
      ${buttonsRowHtml([
        { id: `${P}-xlsx`, label: 'טען קובץ אקסל', kind: 'ghost', size: 'small' },
        { id: `${P}-template`, label: 'הורד תבנית לאקסל', kind: 'ghost', size: 'small' },
        { id: `${P}-copy-input`, label: 'העתק את הטבלה לאקסל', kind: 'ghost', size: 'small' },
      ])}
      <input id="${P}-xlsx-file" type="file" accept=".xlsx,.xls" hidden>
    </details>
    <div class="tt-row" style="justify-content:space-between">
      <span id="${P}-grid-summary" class="tt-hint"></span>
      <label class="tt-hint" style="cursor:pointer"><input type="checkbox" id="${P}-extra"${showExtra ? ' checked' : ''}> עמודות תלמיד חדש (שם, משפחה, מגדר, מצב)</label>
    </div>
    <label class="tt-hint" style="cursor:pointer;display:block;margin:2px 0 6px" title="האתר מזהיר כשהתלמיד רשום במוסד אחר ומבקש אישור. בלי הסימון השורה מסומנת &quot;נחסם&quot; ואתה מחליט ידנית."><input type="checkbox" id="${P}-continue-other"> אשר "המשך" כשהאתר מזהיר שהתלמיד רשום במוסד אחר (לימודיו שם יסתיימו מהיום)</label>
    <div id="${P}-grid" class="tt-scroll" style="max-height:260px"></div>
    <div id="${P}-errors" class="tt-box tt-box-error" hidden></div>
    <div id="${P}-stale" class="tt-box tt-box-warn" hidden></div>
    <div class="tt-row">
      ${fieldHtml('תאריך תחילת לימודים (ריק = ברירת המחדל של האתר)', `<input id="${P}-start-date" class="tt-input tt-mono" type="text" maxlength="10" placeholder="${todayDMY()}" style="max-width:140px">`)}
    </div>
    ${buttonsRowHtml([
      { id: `${P}-start`, label: 'התחל קליטה', kind: 'primary' },
      { id: `${P}-stop`, label: 'עצור', kind: 'danger', title: 'גם מקש Escape עוצר' },
    ])}
    <div id="${P}-results-wrap" hidden>
      <div class="tt-row" style="justify-content:space-between"><b>תוצאות</b>
        <span>${buttonHtml({ id: `${P}-keep-attention`, label: 'השאר בטבלה רק שורות שדורשות טיפול', kind: 'ghost', size: 'small', disabled: true, title: 'מסיר מהטבלה את השורות שהצליחו; משלימים פרטים ומריצים שוב' })} ${buttonHtml({ id: `${P}-tsv`, label: 'העתק תוצאות לאקסל', kind: 'ghost', size: 'small' })} ${buttonHtml({ id: `${P}-csv`, label: 'ייצוא CSV', kind: 'ghost', size: 'small' })}</span></div>
      <div id="${P}-results" class="tt-scroll"></div>
    </div>
    <div id="${P}-report" class="tt-box tt-box-warn" hidden></div>`;

  bindDateMask(`${P}-start-date`);
  // הטבלה מתעדכנת בכל הקשה; שורת היומן "[קלט] הדבקה" נכתבת פעם אחת אחרי שההקלדה נרגעה (סבב רטוב 31.10.2026:
  // 20 שורות-יומן על שתי שורות שהוקלדו).
  $el(`${P}-input`).addEventListener('input', function () { fillFromText(this.value, 'הדבקה', { quiet: true }); scheduleInputLog(); });
  const grid = $el(`${P}-grid`);
  grid.addEventListener('input', onCellInput);
  grid.addEventListener('change', onCellInput);
  grid.addEventListener('click', onGridClick);
  $el(`${P}-extra`).addEventListener('change', function () { showExtra = this.checked; renderTable(); });
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
  $el(`${P}-keep-attention`).addEventListener('click', keepRowsNeedingAttention);
  $el(`${P}-template`).addEventListener('click', downloadTemplate);
  $el(`${P}-copy-input`).addEventListener('click', copyInputAsTsv);
  $el(`${P}-xlsx`).addEventListener('click', () => $el(`${P}-xlsx-file`).click());
  $el(`${P}-xlsx-file`).addEventListener('change', handleXlsx);

  absorbSetHooks({
    getStartDate: startDate,
    getContinueOtherInstitute: () => { const el = $el(`${P}-continue-other`); return !!(el && el.checked); },
    onStart: (queue, idx) => { total = queue.length; ui.progress(idx, total); setRunning(true); },
    onResume: (queue, res, idx) => {
      total = queue.length; results = res.slice(); renderResults(); ui.progress(idx, total); setRunning(true);
      // הטבלה מציגה את התור שרץ
      rows = queue.map((t) => ({ fields: {
        branch: t.branch, studyType: t.studyType, identifier: t.identity, firstName: (t.newStudent || {}).firstName || '', lastName: (t.newStudent || {}).lastName || '',
        birthDate: t.birthDate || '', country: t.country || '', gender: '', familyStatus: '',
      } }));
      renderTable();
      ui.status(`ממשיך אחרי טעינת דף: ${idx + 1} מתוך ${total}`);
      ui.open();
    },
    onProgress: (idx, tot, task) => { total = tot; ui.progress(idx, tot); ui.status(`מעבד ${idx + 1}/${tot}: סניף ${task.branch} · סוג ${task.studyType} · ${task.identity}`); },
    onResult: (result, all) => { results = all.slice(); renderResults(); ui.progress(all.length, Math.max(total, all.length)); },
    onNavigating: () => { ui.status('ממתין לטעינת דף…'); },
    onStaleQueue: (info) => {
      setRunning(false);
      ui.status(info && info.reason === 'foreign-page' ? 'יש תור פתוח, אך הדף הזה אינו חלק מהקליטה. בחר "המשך" או "נקה"' : 'יש תור שמור ישן. בחר "המשך" או "נקה"');
      renderStaleQueue(info);
      ui.open();
    },
    onLocked: (msg) => { setRunning(false); ui.status(msg); ui.open(); },
    onDone: (all, report) => {
      results = all.slice(); renderResults(); renderReport(report); setRunning(false); ui.progress(all.length, all.length);
      ui.status(report.lines.length ? `הסתיים. ${report.lines.length} שורות דורשות טיפול (ראה "מה נשאר")` : 'הסתיים. הכול טופל');
    },
  });

  log(`[קליטה] דף ${page.kind}${page.branch ? ` · סניף ${page.branch} [${page.branchSource || '?'}]` : ''}${page.studyType ? ' · סוג ' + page.studyType : ''}`);
  renderTable();
  results = absorbGetResults();
  renderResults();
  const saved = absorbSavedQueueInfo();
  if (absorbHasSavedQueue()) ui.status(saved && saved.stale ? 'נמצא תור שמור ישן. בודק…' : 'נמצא תור פתוח. ממשיך…');
  else if (!results.length) {
    // ממצא 6: הריצה האחרונה הסתיימה בזמן טעינת-דף (למשל "עצור"): מציגים את התוצאות והדוח שלה
    const last = absorbLastResults();
    if (last && last.results.length) {
      results = last.results.slice();
      renderResults();
      renderReport(last.report);
      ui.status(`תוצאות הריצה האחרונה (${results.length} שורות)`);
    }
  }
  Promise.resolve().then(() => absorbResumeIfPending()).catch((e) => { log('[המשך] כשל: ' + (e && e.message)); setRunning(false); });
}

export const absorbTool = {
  id: 'absorb',
  title: 'קליטת תלמידים',
  pages: ['institute', 'studyType', 'newStudent'],
  hasPendingRun: absorbHasSavedQueue,
  isRunning: absorbIsBusy,
  onStop: stop,
  mount,
};
