// לשונית "עזיבת תלמידים" בחלונית המאוחדת. הזרימה עצמה ב-depart.js; כאן רק הממשק:
// קלט (טורים סניף · ת.ז.), שגיאות-פרסור, תאריך וסיבת עזיבה, התחל/עצור, תוצאות, דוח "מה נשאר".
// כל השמות ברמה-עליונה בקידומת depart (סקופ משותף בבאנדל). אין גישה ל-document ברמת המודול.

import { $el } from '../core/dom.js';
import { log } from '../core/log.js';
import { downloadCsv, copyTextToClipboard } from '../core/csv.js';
import {
  DEPART_REASONS, DEPART_DEFAULT_REASON, DEPART_STATUS, parseDepartInput, buildDepartTsv, buildDepartCsvRows,
  isDepartSuccess, departStatusKey, departIsValidDate,
  departSetHooks, departStartRun, departResumeIfPending, departStop, departHasSavedQueue, departIsRunning,
  departGetResults, departSavedQueueInfo, departDiscardSavedQueue,
} from './depart.js';
import { esc, buttonsRowHtml, fieldHtml, selectHtml, resultsTableHtml, reportBoxHtml, flash, setHtml, setText, show, setDisabled, bindDateMask, todayDMY } from '../ui/widgets.js';

const DEPART_P = 'tt-depart';
let departUi = null;
let departAwaitingErrorConfirm = false;
let departResults = [];
let departTotal = 0;

const DEPART_COLUMNS = [
  { key: 'branch', label: 'סניף', center: true, width: '44px' },
  { key: 'identity', label: 'ת.ז.', mono: true },
  { key: 'status', label: 'סטטוס' },
];

function departClassify(r) {
  if (isDepartSuccess(r.status)) return 'ok';
  const key = departStatusKey(r.status);
  if (key === DEPART_STATUS.STOPPED || key === DEPART_STATUS.SKIPPED || key === DEPART_STATUS.NOT_FOUND) return 'warn';
  return 'bad';
}

function departRenderResults() {
  setHtml(`${DEPART_P}-results`, resultsTableHtml({ columns: DEPART_COLUMNS, rows: departResults, classify: departClassify }));
}

function departRenderErrors(errors, validCount) {
  if (!errors || !errors.length) { show(`${DEPART_P}-errors`, false); setHtml(`${DEPART_P}-errors`, ''); return; }
  const items = errors.slice(0, 25).map((e) => `<li>שורה ${esc(e.line)}: ${esc(e.reason)}</li>`).join('');
  setHtml(`${DEPART_P}-errors`, `<b>${errors.length} שורות לא יורצו</b> (${validCount} תקינות):<ul>${items}${errors.length > 25 ? `<li>ועוד ${errors.length - 25}</li>` : ''}</ul>`);
  show(`${DEPART_P}-errors`, true);
}

function departRenderReport(report) {
  if (!report) { show(`${DEPART_P}-report`, false); setHtml(`${DEPART_P}-report`, ''); return; }
  setHtml(`${DEPART_P}-report`, reportBoxHtml(report));
  show(`${DEPART_P}-report`, true);
}

function departRenderStaleQueue(info) {
  if (!info) { show(`${DEPART_P}-stale`, false); setHtml(`${DEPART_P}-stale`, ''); return; }
  const left = Math.max(0, (info.total || 0) - (info.curIdx || 0));
  const startedMs = Date.parse(info.startedAt);
  const ageMin = Number.isNaN(startedMs) ? null : Math.round((Date.now() - startedMs) / 60000);
  setHtml(`${DEPART_P}-stale`, `<b>נמצא תור עזיבה שמור${ageMin === null ? '' : ` מלפני ${esc(ageMin)} דקות`}</b>: ${esc(left)} שורות טרם עובדו (${esc(info.curIdx || 0)} מתוך ${esc(info.total || 0)} הושלמו). התור ישן מדי להמשך אוטומטי.
    ${buttonsRowHtml([
      { id: `${DEPART_P}-stale-go`, label: 'המשך את התור', kind: 'primary', size: 'small' },
      { id: `${DEPART_P}-stale-clear`, label: 'נקה את התור', kind: 'danger', size: 'small' },
    ])}`);
  show(`${DEPART_P}-stale`, true);
  $el(`${DEPART_P}-stale-go`).addEventListener('click', () => {
    departRenderStaleQueue(null);
    departUi.status('ממשיך את התור השמור…');
    departSetRunning(true);
    Promise.resolve().then(() => departResumeIfPending({ allowStale: true })).catch((e) => { log('[המשך] כשל: ' + (e && e.message)); departSetRunning(false); });
  });
  $el(`${DEPART_P}-stale-clear`).addEventListener('click', () => {
    departDiscardSavedQueue();
    departRenderStaleQueue(null);
    departSetRunning(false);
    departUi.status('התור השמור נמחק. אפשר להתחיל ריצה חדשה');
  });
}

function departSetRunning(on) {
  setDisabled(`${DEPART_P}-start`, !!on);
  departUi.running(!!on);
}

function departReadSettings() {
  const dateEl = $el(`${DEPART_P}-date`);
  const reasonEl = $el(`${DEPART_P}-reason`);
  return {
    leaveDate: dateEl ? String(dateEl.value || '').trim() : '',
    leaveReason: reasonEl && reasonEl.value ? String(reasonEl.value) : DEPART_DEFAULT_REASON,
  };
}

function departApplySettings(settings) {
  if (!settings) return;
  const dateEl = $el(`${DEPART_P}-date`);
  if (dateEl && settings.leaveDate !== undefined) dateEl.value = settings.leaveDate || '';
  const reasonEl = $el(`${DEPART_P}-reason`);
  if (reasonEl && settings.leaveReason) reasonEl.value = String(settings.leaveReason);
}

function departResetStartButton() {
  departAwaitingErrorConfirm = false;
  setText(`${DEPART_P}-start`, 'התחל עזיבה');
  departRenderErrors([], 0);
}

async function departStart() {
  if (departIsRunning()) return;
  const text = (($el(`${DEPART_P}-input`) || {}).value || '').trim();
  if (!text) { departUi.status('הדבק רשימה: סניף ות.ז. בכל שורה (טורים מאקסל)'); return; }
  const settings = departReadSettings();
  if (settings.leaveDate && !departIsValidDate(settings.leaveDate)) {
    departUi.status('תאריך העזיבה לא תקין. הפורמט: DD/MM/YYYY, או השאר ריק (= היום)');
    return;
  }
  const parsed = parseDepartInput(text);
  if (parsed.errors.length && !departAwaitingErrorConfirm) {
    departRenderErrors(parsed.errors, parsed.tasks.length);
    departAwaitingErrorConfirm = true;
    setText(`${DEPART_P}-start`, parsed.tasks.length ? `הרץ בכל זאת את ${parsed.tasks.length} התקינות` : 'התחל עזיבה');
    departUi.status(`${parsed.errors.length} שורות בעייתיות. תקן אותן, או לחץ שוב כדי להריץ רק את התקינות`);
    log(`[עזיבה] פרסור: ${parsed.tasks.length} תקינות · ${parsed.errors.length} שגויות`);
    return;
  }
  if (!parsed.tasks.length) { departRenderErrors(parsed.errors, 0); departUi.status('אין שורות תקינות להרצה'); return; }
  departResetStartButton();
  departRenderReport(null);
  departRenderStaleQueue(null);
  departResults = [];
  departRenderResults();
  departSetRunning(true);
  departUi.progress(0, parsed.tasks.length);
  departUi.status(`מריץ עזיבה ל-${parsed.tasks.length} תלמידים…`);
  log(`[עזיבה] התחלה: ${parsed.tasks.length} תלמידים · תאריך "${settings.leaveDate || 'היום'}" · סיבה ${settings.leaveReason}`);
  await departStartRun(parsed.tasks, settings);
}

function departStopClick() {
  departUi.status('עוצר… (מסיים את התלמיד הנוכחי אם כבר התחיל)');
  log('⛔ עצירה לבקשת המשתמש');
  departStop();
  departSetRunning(false);
}

function departCurrentRows() {
  const live = departGetResults();
  return live.length ? live : departResults;
}

function departCopyTsv() {
  const rows = departCurrentRows();
  if (!rows.length) { departUi.status('אין תוצאות להעתקה'); return; }
  copyTextToClipboard(buildDepartTsv(rows)).then((ok) => {
    flash(`${DEPART_P}-tsv`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק לאקסל');
    departUi.status(ok ? 'התוצאות הועתקו. הדבק באקסל (Ctrl+V)' : 'ההעתקה נחסמה בדפדפן. השתמש בייצוא CSV');
  });
}

function departExportCsv() {
  const rows = departCurrentRows();
  if (!rows.length) { departUi.status('אין תוצאות לייצוא'); return; }
  const name = `departures_${new Date().toISOString().slice(0, 10)}.csv`;
  departUi.status(downloadCsv(name, buildDepartCsvRows(rows)) ? `הורד ${name}` : 'הייצוא נכשל');
}

function departMount(container, panelUi, page) {
  departUi = panelUi;
  container.innerHTML = `
    <div class="tt-box tt-box-info">
      <b>טורים כמו באקסל</b> (טאבים, פסיקים או רווחים; שורת כותרת אופציונלית; שורה שמתחילה ב-# מדולגת): סניף · ת.ז.
      התלמיד מחופש בלשונית "תלמידים למוסד" של הסניף; מי שכבר עזב מדווח ולא נוגעים בו.
    </div>
    <textarea id="${DEPART_P}-input" class="tt-textarea" placeholder="00&#9;012345678&#10;16&#9;023456789"></textarea>
    <div id="${DEPART_P}-errors" class="tt-box tt-box-error" hidden></div>
    <div id="${DEPART_P}-stale" class="tt-box tt-box-warn" hidden></div>
    <div class="tt-row">
      ${fieldHtml('תאריך עזיבה (ריק = היום)', `<input id="${DEPART_P}-date" class="tt-input tt-mono" type="text" maxlength="10" placeholder="${todayDMY()}">`)}
      ${fieldHtml('סיבת עזיבה', selectHtml({ id: `${DEPART_P}-reason`, options: DEPART_REASONS, value: DEPART_DEFAULT_REASON }))}
    </div>
    ${buttonsRowHtml([
      { id: `${DEPART_P}-start`, label: 'התחל עזיבה', kind: 'primary' },
      { id: `${DEPART_P}-stop`, label: 'עצור', kind: 'danger', title: 'גם מקש Escape עוצר' },
    ])}
    ${buttonsRowHtml([
      { id: `${DEPART_P}-tsv`, label: 'העתק לאקסל', kind: 'ghost', size: 'small' },
      { id: `${DEPART_P}-csv`, label: 'ייצוא CSV', kind: 'ghost', size: 'small' },
    ])}
    <div id="${DEPART_P}-results" class="tt-scroll"></div>
    <div id="${DEPART_P}-report" class="tt-box tt-box-warn" hidden></div>`;

  bindDateMask(`${DEPART_P}-date`);
  $el(`${DEPART_P}-input`).addEventListener('input', () => { if (departAwaitingErrorConfirm) departResetStartButton(); });
  $el(`${DEPART_P}-start`).addEventListener('click', () => {
    Promise.resolve().then(departStart).catch((e) => {
      log('[עזיבה] ההרצה נכשלה: ' + (e && e.message));
      departSetRunning(false);
      departUi.status('ההרצה נכשלה. בדוק את היומן ונסה שוב');
    });
  });
  $el(`${DEPART_P}-stop`).addEventListener('click', departStopClick, true);
  $el(`${DEPART_P}-tsv`).addEventListener('click', departCopyTsv);
  $el(`${DEPART_P}-csv`).addEventListener('click', departExportCsv);

  departSetHooks({
    onStart: (queue, idx) => { departTotal = queue.length; departUi.progress(idx, departTotal); departSetRunning(true); },
    onResume: (queue, res, idx, settings) => {
      departTotal = queue.length; departResults = res.slice(); departRenderResults(); departUi.progress(idx, departTotal); departSetRunning(true);
      const ta = $el(`${DEPART_P}-input`);
      if (ta) ta.value = queue.map((t) => `${t.branch}\t${t.identity}`).join('\n');
      departApplySettings(settings);
      departUi.status(`ממשיך אחרי טעינת דף: ${idx + 1} מתוך ${departTotal}`);
      departUi.open();
    },
    onProgress: (idx, tot, task) => { departTotal = tot; departUi.progress(idx, tot); departUi.status(`מעבד ${idx + 1}/${tot}: סניף ${task.branch} · ${task.identity}`); },
    onResult: (result, all) => { departResults = all.slice(); departRenderResults(); departUi.progress(all.length, Math.max(departTotal, all.length)); },
    onNavigating: (branch) => { departUi.status(`מנווט לסניף ${branch}… ממתין לטעינת דף`); },
    onStaleQueue: (info) => { departSetRunning(false); departUi.status('יש תור עזיבה שמור ישן. בחר "המשך" או "נקה"'); departRenderStaleQueue(info); departUi.open(); },
    onDone: (all, report) => {
      departResults = all.slice(); departRenderResults(); departRenderReport(report); departSetRunning(false); departUi.progress(all.length, all.length);
      departUi.status(report.lines.length ? `הסתיים. ${report.lines.length} שורות דורשות טיפול (ראה "מה נשאר")` : 'הסתיים. הכול טופל');
    },
  });

  log(`[עזיבה] דף ${page.kind}${page.branch ? ` · סניף ${page.branch} [${page.branchSource || '?'}]` : ''}`);
  departResults = departGetResults();
  departRenderResults();
  const saved = departSavedQueueInfo();
  if (departHasSavedQueue()) departUi.status(saved && saved.stale ? 'נמצא תור עזיבה שמור ישן. בודק…' : 'נמצא תור עזיבה פתוח. ממשיך…');
  Promise.resolve().then(() => departResumeIfPending()).catch((e) => { log('[המשך] כשל: ' + (e && e.message)); departSetRunning(false); });
}

export const departTool = {
  id: 'depart',
  title: 'עזיבת תלמידים',
  pages: ['institute'],
  hasPendingRun: departHasSavedQueue,
  isRunning: departIsRunning,
  onStop: departStopClick,
  mount: departMount,
};
