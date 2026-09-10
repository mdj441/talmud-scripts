// לשונית "קליטת תלמידים" בחלונית המאוחדת. הזרימה עצמה ב-absorb-flow.js; כאן רק הממשק:
// קלט (הדבקה/אקסל), שגיאות-פרסור, תאריך תחילת לימודים, התחל/עצור, תוצאות, דוח "מה נשאר".
// אין גישה ל-document ברמת המודול.

import { $el } from '../core/dom.js';
import { log } from '../core/log.js';
import { downloadCsv, copyTextToClipboard } from '../core/csv.js';
import { COUNTRIES } from '../data/countries.js';
import { parseAbsorbInput } from './absorb-parse.js';
import { loadXlsxFile } from './absorb-xlsx.js';
import { ABSORB_TEMPLATE_HEADER, isAbsorbSuccess, absorbStatusKey, buildResultsTsv, buildResultsCsvRows } from './absorb-report.js';
import { clearAbsorbStop } from './absorb-state.js';
import {
  absorbSetHooks, absorbStartRun, absorbResumeIfPending, absorbStop, absorbHasSavedQueue, absorbGetResults,
  absorbIsRunning, absorbSavedQueueInfo, absorbDiscardSavedQueue,
} from './absorb-flow.js';
import { esc, buttonHtml, buttonsRowHtml, fieldHtml, resultsTableHtml, reportBoxHtml, flash, setHtml, setText, show, setDisabled, bindDateMask, todayDMY } from '../ui/widgets.js';

const P = 'tt-absorb';
const countryNames = COUNTRIES.map((c) => c.he).sort((a, b) => a.localeCompare(b, 'he'));
let ui = null;
let awaitingErrorConfirm = false;
let results = [];
let total = 0;

const RESULT_COLUMNS = [
  { key: 'branch', label: 'סניף', center: true, width: '44px' },
  { key: 'studyType', label: 'סוג', center: true, width: '44px' },
  { key: 'identity', label: 'ת.ז./דרכון', mono: true },
  { key: 'status', label: 'סטטוס' },
];

function classify(r) {
  const key = absorbStatusKey(r.status);
  if (isAbsorbSuccess(r.status)) return 'ok';
  if (key === 'נעצר' || key === 'דולג') return 'warn';
  return 'bad';
}

function renderResults() {
  setHtml(`${P}-results`, resultsTableHtml({ columns: RESULT_COLUMNS, rows: results, classify }));
}

function renderErrors(errors, validCount) {
  if (!errors || !errors.length) { show(`${P}-errors`, false); setHtml(`${P}-errors`, ''); return; }
  const items = errors.slice(0, 25).map((e) => `<li>שורה ${esc(e.line)}: ${esc(e.reason)}</li>`).join('');
  setHtml(`${P}-errors`, `<b>${errors.length} שורות לא יורצו</b> (${validCount} תקינות):<ul>${items}${errors.length > 25 ? `<li>ועוד ${errors.length - 25}</li>` : ''}</ul>`);
  show(`${P}-errors`, true);
}

function renderReport(report) {
  if (!report) { show(`${P}-report`, false); setHtml(`${P}-report`, ''); return; }
  setHtml(`${P}-report`, reportBoxHtml(report));
  show(`${P}-report`, true);
}

function renderStaleQueue(info) {
  if (!info) { show(`${P}-stale`, false); setHtml(`${P}-stale`, ''); return; }
  const left = Math.max(0, (info.total || 0) - (info.curIdx || 0));
  const startedMs = Date.parse(info.startedAt);
  const ageMin = Number.isNaN(startedMs) ? null : Math.round((Date.now() - startedMs) / 60000);
  setHtml(`${P}-stale`, `<b>נמצא תור שמור${ageMin === null ? '' : ` מלפני ${esc(ageMin)} דקות`}</b>: ${esc(left)} שורות טרם עובדו (${esc(info.curIdx || 0)} מתוך ${esc(info.total || 0)} הושלמו). התור ישן מדי להמשך אוטומטי.
    ${buttonsRowHtml([
      { id: `${P}-stale-go`, label: 'המשך את התור', kind: 'primary', size: 'small' },
      { id: `${P}-stale-clear`, label: 'נקה את התור', kind: 'danger', size: 'small' },
    ])}`);
  show(`${P}-stale`, true);
  $el(`${P}-stale-go`).addEventListener('click', () => {
    renderStaleQueue(null);
    ui.status('ממשיך את התור השמור…');
    setRunning(true);
    Promise.resolve().then(() => absorbResumeIfPending({ allowStale: true })).catch((e) => { log('[המשך] כשל: ' + (e && e.message)); setRunning(false); });
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
  renderErrors([], 0);
}

async function start() {
  if (absorbIsRunning()) return;
  const text = (($el(`${P}-input`) || {}).value || '').trim();
  if (!text) { ui.status('הדבק רשימת תלמידים (טורים מאקסל) או טען קובץ אקסל'); return; }
  const parsed = parseAbsorbInput(text);
  if (parsed.errors.length && !awaitingErrorConfirm) {
    renderErrors(parsed.errors, parsed.tasks.length);
    awaitingErrorConfirm = true;
    setText(`${P}-start`, parsed.tasks.length ? `הרץ בכל זאת את ${parsed.tasks.length} התקינות` : 'התחל קליטה');
    ui.status(`${parsed.errors.length} שורות בעייתיות. תקן אותן, או לחץ שוב כדי להריץ רק את התקינות`);
    log(`[פרסור] ${parsed.tasks.length} תקינות · ${parsed.errors.length} שגויות`);
    return;
  }
  if (!parsed.tasks.length) { renderErrors(parsed.errors, 0); ui.status('אין שורות תקינות להרצה'); return; }
  resetStartButton();
  renderReport(null);
  renderStaleQueue(null);
  results = [];
  renderResults();
  clearAbsorbStop();
  setRunning(true);
  ui.progress(0, parsed.tasks.length);
  ui.status(`מריץ ${parsed.tasks.length} תלמידים…`);
  log(`[התחלה] ${parsed.tasks.length} תלמידים · תאריך תחילת לימודים "${startDate() || '(ברירת המחדל של האתר)'}"`);
  await absorbStartRun(parsed.tasks);
}

function stop() {
  ui.status('עוצר…');
  log('⛔ עצירה לבקשת המשתמש');
  absorbStop();
  setRunning(false);
}

function copyTsv() {
  const rows = absorbGetResults().length ? absorbGetResults() : results;
  if (!rows.length) { ui.status('אין תוצאות להעתקה'); return; }
  copyTextToClipboard(buildResultsTsv(rows)).then((ok) => {
    flash(`${P}-tsv`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק לאקסל');
    ui.status(ok ? 'התוצאות הועתקו. הדבק באקסל (Ctrl+V)' : 'ההעתקה נחסמה בדפדפן. השתמש בייצוא CSV');
  });
}

function exportCsv() {
  const rows = absorbGetResults().length ? absorbGetResults() : results;
  if (!rows.length) { ui.status('אין תוצאות לייצוא'); return; }
  const name = `absorptions_${new Date().toISOString().slice(0, 10)}.csv`;
  ui.status(downloadCsv(name, buildResultsCsvRows(rows)) ? `הורד ${name}` : 'הייצוא נכשל');
}

function downloadTemplate() {
  ui.status(downloadCsv('תבנית-קליטת-תלמידים.csv', [ABSORB_TEMPLATE_HEADER.slice()]) ? 'התבנית הורדה. מלא באקסל, ואז העתק את הטורים לכאן או טען את הקובץ' : 'הורדת התבנית נכשלה');
}

function handleXlsx(ev) {
  const input = ev && ev.target;
  const file = input && input.files && input.files[0];
  if (!file) return;
  ui.status('טוען קובץ אקסל…');
  Promise.resolve().then(() => loadXlsxFile(file)).then((text) => {
    const ta = $el(`${P}-input`);
    if (ta) ta.value = text;
    const n = text ? text.split('\n').length : 0;
    ui.status(`נטענו ${n} שורות מהקובץ. בדוק ולחץ "התחל קליטה"`);
    log(`[אקסל] נטענו ${n} שורות מ"${file.name}"`);
    if (awaitingErrorConfirm) resetStartButton();
  }).catch((e) => {
    ui.status('טעינת האקסל נכשלה: ' + ((e && e.message) || 'שגיאה לא ידועה'));
  }).finally(() => { if (input) input.value = ''; });
}

function renderCountries(filter) {
  const q = String(filter || '').trim();
  const names = q ? countryNames.filter((n) => n.includes(q)) : countryNames;
  setHtml(`${P}-countries-list`, names.length
    ? names.map((n) => `<span class="tt-chip" data-name="${esc(n)}" title="לחץ להעתקה">${esc(n)}</span>`).join('')
    : '<div class="tt-empty">אין ארץ שמתאימה לסינון</div>');
}

function toggleCountries() {
  const box = $el(`${P}-countries-box`);
  if (!box) return;
  const open = box.hidden;
  box.hidden = !open;
  if (!open) return;
  renderCountries(($el(`${P}-countries-filter`) || {}).value);
  try { $el(`${P}-countries-filter`).focus(); } catch (e) { /* לא קריטי */ }
}

function copyCountry(e) {
  const chip = e && e.target && typeof e.target.closest === 'function' ? e.target.closest('.tt-chip') : null;
  if (!chip) return;
  const name = chip.getAttribute('data-name') || '';
  if (!name) return;
  copyTextToClipboard(name).then((ok) => ui.status(ok ? `הועתק: ${name}` : `ההעתקה נחסמה בדפדפן. הקלד: ${name}`));
}

function mount(container, panelUi, page) {
  ui = panelUi;
  container.innerHTML = `
    <div class="tt-box tt-box-info">
      <b>טורים כמו באקסל</b> (טאבים או פסיקים, עם שורת כותרת או בלי): סניף · סוג לימוד · ת.ז./דרכון · שם פרטי · שם משפחה · תאריך לידה · ארץ · מגדר · מצב משפחתי.
      חובה: שלושת הראשונים. דרכון: גם תאריך לידה וארץ. תלמיד שאינו מוכר למערכת: גם שם פרטי, שם משפחה ותאריך לידה.
    </div>
    <textarea id="${P}-input" class="tt-textarea" placeholder="01&#9;300&#9;123456789&#10;12&#9;600&#9;AB1234567&#9;&#9;&#9;15/03/1995&#9;צרפת"></textarea>
    <div id="${P}-errors" class="tt-box tt-box-error" hidden></div>
    <div id="${P}-stale" class="tt-box tt-box-warn" hidden></div>
    <div class="tt-row">
      ${fieldHtml('תאריך תחילת לימודים (ריק = ברירת המחדל של האתר)', `<input id="${P}-start-date" class="tt-input tt-mono" type="text" maxlength="10" placeholder="${todayDMY()}">`)}
    </div>
    ${buttonsRowHtml([
      { id: `${P}-start`, label: 'התחל קליטה', kind: 'primary' },
      { id: `${P}-stop`, label: 'עצור', kind: 'danger', title: 'גם מקש Escape עוצר' },
    ])}
    ${buttonsRowHtml([
      { id: `${P}-tsv`, label: 'העתק לאקסל', kind: 'ghost', size: 'small' },
      { id: `${P}-csv`, label: 'ייצוא CSV', kind: 'ghost', size: 'small' },
      { id: `${P}-template`, label: 'תבנית לאקסל', kind: 'ghost', size: 'small' },
      { id: `${P}-xlsx`, label: 'טען מאקסל', kind: 'ghost', size: 'small' },
      { id: `${P}-countries`, label: 'רשימת ארצות', kind: 'ghost', size: 'small' },
    ])}
    <input id="${P}-xlsx-file" type="file" accept=".xlsx,.xls" hidden>
    <div id="${P}-countries-box" class="tt-box tt-box-info" hidden>
      <input id="${P}-countries-filter" class="tt-input" type="text" placeholder="סינון: הקלד חלק מהשם">
      <div id="${P}-countries-list" class="tt-chips"></div>
      <div class="tt-hint">לחיצה על שם מעתיקה אותו. השמות כפי שהם באתר.</div>
    </div>
    <div id="${P}-results" class="tt-scroll"></div>
    <div id="${P}-report" class="tt-box tt-box-warn" hidden></div>`;

  bindDateMask(`${P}-start-date`);
  $el(`${P}-input`).addEventListener('input', () => { if (awaitingErrorConfirm) resetStartButton(); });
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
  $el(`${P}-template`).addEventListener('click', downloadTemplate);
  $el(`${P}-xlsx`).addEventListener('click', () => $el(`${P}-xlsx-file`).click());
  $el(`${P}-xlsx-file`).addEventListener('change', handleXlsx);
  $el(`${P}-countries`).addEventListener('click', toggleCountries);
  $el(`${P}-countries-filter`).addEventListener('input', function () { renderCountries(this.value); });
  $el(`${P}-countries-list`).addEventListener('click', copyCountry);

  absorbSetHooks({
    getStartDate: startDate,
    onStart: (queue, idx) => { total = queue.length; ui.progress(idx, total); setRunning(true); },
    onResume: (queue, res, idx) => {
      total = queue.length; results = res.slice(); renderResults(); ui.progress(idx, total); setRunning(true);
      ui.status(`ממשיך אחרי טעינת דף: ${idx + 1} מתוך ${total}`);
      ui.open();
    },
    onProgress: (idx, tot, task) => { total = tot; ui.progress(idx, tot); ui.status(`מעבד ${idx + 1}/${tot}: סניף ${task.branch} · סוג ${task.studyType} · ${task.identity}`); },
    onResult: (result, all) => { results = all.slice(); renderResults(); ui.progress(all.length, Math.max(total, all.length)); },
    onNavigating: () => { ui.status('ממתין לטעינת דף…'); },
    onStaleQueue: (info) => { setRunning(false); ui.status('יש תור שמור ישן. בחר "המשך" או "נקה"'); renderStaleQueue(info); ui.open(); },
    onDone: (all, report) => {
      results = all.slice(); renderResults(); renderReport(report); setRunning(false); ui.progress(all.length, all.length);
      ui.status(report.lines.length ? `הסתיים. ${report.lines.length} שורות דורשות טיפול (ראה "מה נשאר")` : 'הסתיים. הכול טופל');
    },
  });

  log(`[קליטה] דף ${page.kind}${page.branch ? ` · סניף ${page.branch} [${page.branchSource || '?'}]` : ''}${page.studyType ? ' · סוג ' + page.studyType : ''}`);
  results = absorbGetResults();
  renderResults();
  const saved = absorbSavedQueueInfo();
  if (absorbHasSavedQueue()) ui.status(saved && saved.stale ? 'נמצא תור שמור ישן. בודק…' : 'נמצא תור פתוח. ממשיך…');
  Promise.resolve().then(() => absorbResumeIfPending()).catch((e) => { log('[המשך] כשל: ' + (e && e.message)); setRunning(false); });
}

export const absorbTool = {
  id: 'absorb',
  title: 'קליטת תלמידים',
  pages: ['institute', 'studyType', 'newStudent'],
  hasPendingRun: absorbHasSavedQueue,
  isRunning: absorbIsRunning,
  onStop: stop,
  mount,
};
