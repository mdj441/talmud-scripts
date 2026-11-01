// לשונית "דיווח חודשי" בחלונית המאוחדת. הזרימה ב-report.js; כאן רק הממשק (שכבת-הבהירות 1.11.2026): אזור
// "לאילו סניפים מדווחים" (רשימת הסניפים מהעץ, התחל/עצור; בדף בלי עץ: הסבר וכפתור לדף המוסדות), אזור "תוצאות"
// (סניף, מה קרה, פירוט, העתק לאקסל, סיכום), סרגל-שלבים, וחיווי "אם נתקע, רענן את הדף" אחרי 20 שניות בלי צעד.
// אין גישה ל-document ברמת המודול.

import { $el } from '../core/dom.js';
import { log } from '../core/log.js';
import { copyTextToClipboard } from '../core/csv.js';
import { readBranchesFromTree, institutesPageUrl } from '../core/navigate.js';
import { esc, buttonHtml, resultsTableHtml, reportBoxHtml, zoneHtml, fitBoxHtml, flash, setHtml, show, setDisabled } from '../ui/widgets.js';
import {
  REPORT_STATUS, reportSetHooks, reportStart, reportResumeIfPending, reportRequestStop, reportHasPendingRun,
  reportIsRunning, reportGetResults, reportBuildTsv, reportIsStuck, reportLastStepAt,
} from './report.js';

const RP = 'tt-report';
export const REPORT_STEPS = ['הכנה', 'ריצה', 'תוצאות'];
let reportUi = null;
let reportRows = [];
let reportBaseStatus = 'מוכן';
let reportStuckTimer = null;
let reportTotal = 0;
let reportDone = false;

const REPORT_COLUMNS = [
  { key: 'branch', label: 'סניף', center: true, width: '52px' },
  { key: 'status', label: 'מה קרה', width: '130px' },
  { key: 'detail', label: 'פירוט' },
];

function reportClassify(r) {
  if (r.status === REPORT_STATUS.SENT) return 'ok';
  if (r.status === REPORT_STATUS.SKIPPED || r.status === REPORT_STATUS.STOPPED) return 'warn';
  return 'bad';
}

function reportStep() {
  if (reportIsRunning()) return 1;
  if (reportRows.length && reportDone) return 2;
  return 0;
}

function reportRenderRows() {
  const zone = $el(`${RP}-zone-out`);
  if (zone) zone.classList.toggle('tt-zone-dim', !reportRows.length);
  setHtml(`${RP}-results`, resultsTableHtml({ columns: REPORT_COLUMNS, rows: reportRows, classify: reportClassify }));
  show(`${RP}-results`, reportRows.length > 0);
  setDisabled(`${RP}-tsv`, reportRows.length === 0);
}

function reportRenderSummary(summary) {
  if (!summary) { show(`${RP}-report`, false); setHtml(`${RP}-report`, ''); return; }
  setHtml(`${RP}-report`, reportBoxHtml({ summary: summary.summary, lines: summary.lines }, { idsWarning: false }));
  show(`${RP}-report`, true);
}

// שורת הסטטוס: הטקסט הבסיסי + "אם נתקע, רענן את הדף" כשעברו 20 שניות בלי צעד
function reportRenderStatus() {
  if (!reportUi) return;
  let stuck = false;
  try { stuck = reportIsRunning() && reportIsStuck(reportLastStepAt(), Date.now()); } catch (e) { stuck = false; }
  reportUi.status(stuck ? `${reportBaseStatus} · אם נתקע, רענן את הדף` : reportBaseStatus);
  reportUi.step(reportStep());
}

function reportSetStatus(msg) {
  reportBaseStatus = msg;
  reportRenderStatus();
}

function reportSetRunning(on) {
  setDisabled(`${RP}-start`, !!on);
  show(`${RP}-stop`, !!on);
  if (reportUi) { reportUi.running(!!on); reportUi.step(reportStep()); }
  if (on) {
    if (!reportStuckTimer) reportStuckTimer = setInterval(reportRenderStatus, 1000);
  } else if (reportStuckTimer) {
    clearInterval(reportStuckTimer);
    reportStuckTimer = null;
  }
}

async function reportUiStart() {
  if (reportIsRunning()) { reportSetStatus('ריצה כבר פעילה'); return; }
  reportRows = [];
  reportDone = false;
  reportRenderRows();
  reportRenderSummary(null);
  reportSetRunning(true);
  reportSetStatus('מתחיל…');
  const res = await reportStart();
  if (!res.ok) {
    reportSetRunning(false);
    reportSetStatus(res.reason);
  }
}

function reportUiStop() {
  if (!reportIsRunning()) { reportSetStatus('אין ריצה פעילה'); return; }
  reportSetStatus('עוצר… הריצה תיעצר לפני הסניף הבא');
  reportRequestStop();
}

function reportCopyTsv() {
  const rows = reportRows.length ? reportRows : reportGetResults();
  if (!rows.length) { reportSetStatus('אין תוצאות להעתקה'); return; }
  copyTextToClipboard(reportBuildTsv(rows)).then((ok) => {
    flash(`${RP}-tsv`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק תוצאות לאקסל');
    reportSetStatus(ok ? 'התוצאות הועתקו. הדבק באקסל (Ctrl+V)' : 'ההעתקה נחסמה בדפדפן');
  });
}

function reportUiMount(container, panelUi, page) {
  reportUi = panelUi;
  const branches = page && page.kind === 'institute' ? readBranchesFromTree() : [];
  const fits = !!(page && page.kind === 'institute');
  container.innerHTML = `
    ${zoneHtml({ id: `${RP}-zone-in`, title: 'לאילו סניפים מדווחים', inner: `
      <p class="tt-zone-lead">שולח דיווח חודשי לכל הסניפים שבעץ, אחד אחרי השני. סניף שכבר דווח מדולג. "עצור" עוצר לפני הסניף הבא.</p>
      ${fits ? `<div id="${RP}-branches" class="tt-hint">${branches.length ? `נמצאו ${branches.length} סניפים: ${esc(branches.join(', '))}` : 'לא נמצאו סניפים בעץ של הדף הזה'}</div>`
    : fitBoxHtml({ id: `${RP}-fit`, text: 'הדיווח רץ מדף מוסד (שם יש את עץ-הסניפים).', buttonId: `${RP}-goto`, buttonLabel: 'עבור לדף המוסדות' })}
      <div class="tt-row tt-row-wrap">
        ${buttonHtml({ id: `${RP}-start`, label: 'התחל דיווח לכל הסניפים', kind: 'primary', disabled: !branches.length })}
        ${buttonHtml({ id: `${RP}-stop`, label: 'עצור', kind: 'danger', title: 'גם מקש Escape עוצר', attrs: 'hidden' })}
      </div>` })}
    ${zoneHtml({ id: `${RP}-zone-out`, title: 'תוצאות', dim: true, inner: `
      <div id="${RP}-report" class="tt-box tt-box-warn" hidden></div>
      <div class="tt-row tt-row-wrap tt-row-tight">${buttonHtml({ id: `${RP}-tsv`, label: 'העתק תוצאות לאקסל', kind: 'ghost', size: 'small', disabled: true })}</div>
      <div id="${RP}-results" class="tt-scroll" hidden></div>` })}`;

  $el(`${RP}-start`).addEventListener('click', () => {
    Promise.resolve().then(reportUiStart).catch((e) => {
      log('[דיווח] ההרצה נכשלה: ' + (e && e.message));
      reportSetRunning(false);
      reportSetStatus('ההרצה נכשלה. בדוק את היומן ונסה שוב');
    });
  });
  $el(`${RP}-stop`).addEventListener('click', reportUiStop, true);
  $el(`${RP}-tsv`).addEventListener('click', reportCopyTsv);
  const goto = $el(`${RP}-goto`);
  if (goto) goto.addEventListener('click', () => { reportSetStatus('עובר לדף המוסדות…'); location.href = institutesPageUrl(); });

  reportSetHooks({
    onStart: (list, idx) => { reportTotal = list.length; reportSetRunning(true); reportUi.progress(idx, reportTotal); },
    onResume: (state) => {
      reportTotal = state.branches.length;
      reportRows = Array.isArray(state.results) ? state.results.slice() : [];
      reportRenderRows();
      reportSetRunning(true);
      reportUi.progress(reportRows.length, reportTotal);
      reportSetStatus(`ממשיך אחרי טעינת דף: סניף ${reportRows.length + 1} מתוך ${reportTotal}`);
      reportUi.open();
    },
    onProgress: (idx, total, branch) => { reportTotal = total; reportUi.progress(idx, total); reportSetStatus(`סניף ${branch} (${idx + 1} מתוך ${total})`); },
    onNavigating: (branch) => { reportSetStatus(`עובר לדף המוסד של סניף ${branch}… ממתין לטעינה`); },
    onResult: (result, all) => { reportRows = all.slice(); reportRenderRows(); reportUi.progress(all.length, Math.max(reportTotal, all.length)); },
    onDone: (all, summary) => {
      reportRows = all.slice();
      reportDone = true;
      reportRenderRows();
      reportRenderSummary(summary);
      reportSetRunning(false);
      reportUi.progress(all.length, all.length);
      reportSetStatus(`הסתיים. ${summary.summary}`);
    },
  });

  reportRows = reportGetResults();
  reportDone = reportRows.length > 0;
  reportRenderRows();
  if (reportHasPendingRun()) { reportSetStatus('נמצאה ריצה פתוחה. ממשיך…'); reportSetRunning(true); }
  else reportSetStatus(fits ? (branches.length ? 'מוכן. "התחל" מדווח לכל הסניפים שבעץ' : 'אין סניפים בעץ של הדף הזה') : 'הדיווח רץ מדף מוסד');
  Promise.resolve().then(() => reportResumeIfPending()).catch((e) => {
    log('[דיווח] ההמשך נכשל: ' + (e && e.message));
    reportSetRunning(false);
    reportSetStatus('ההמשך אחרי טעינת הדף נכשל. בדוק את היומן');
  });
}

export const reportTool = {
  id: 'report',
  title: 'דיווח חודשי',
  pages: ['*'], // הכרעה ח2: בכל דף; בלי עץ הלשונית מציעה לעבור לדף המוסדות
  fits: (page) => !!(page && page.kind === 'institute'),
  steps: REPORT_STEPS,
  hasPendingRun: reportHasPendingRun,
  isRunning: reportIsRunning,
  onStop: reportUiStop,
  mount: reportUiMount,
};
