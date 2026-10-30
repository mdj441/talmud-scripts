// לשונית "דיווח חודשי" בחלונית המאוחדת. הזרימה ב-report.js; כאן רק הממשק: רשימת הסניפים שנמצאו,
// התחל/עצור, טבלת תוצאות (סניף, סטטוס, פירוט), "העתק לאקסל", סיכום "מה נשאר", וחיווי
// "אם נתקע, רענן את הדף" אחרי 20 שניות בלי צעד. אין גישה ל-document ברמת המודול.

import { $el } from '../core/dom.js';
import { log } from '../core/log.js';
import { copyTextToClipboard } from '../core/csv.js';
import { readBranchesFromTree } from '../core/navigate.js';
import { esc, buttonsRowHtml, resultsTableHtml, reportBoxHtml, flash, setHtml, show, setDisabled } from '../ui/widgets.js';
import {
  REPORT_STATUS, reportSetHooks, reportStart, reportResumeIfPending, reportRequestStop, reportHasPendingRun,
  reportIsRunning, reportGetResults, reportBuildTsv, reportIsStuck, reportLastStepAt,
} from './report.js';

const RP = 'tt-report';
let reportUi = null;
let reportRows = [];
let reportBaseStatus = 'מוכן';
let reportStuckTimer = null;
let reportTotal = 0;

const REPORT_COLUMNS = [
  { key: 'branch', label: 'סניף', center: true, width: '52px' },
  { key: 'status', label: 'סטטוס', width: '130px' },
  { key: 'detail', label: 'פירוט' },
];

function reportClassify(r) {
  if (r.status === REPORT_STATUS.SENT) return 'ok';
  if (r.status === REPORT_STATUS.SKIPPED || r.status === REPORT_STATUS.STOPPED) return 'warn';
  return 'bad';
}

function reportRenderRows() {
  setHtml(`${RP}-results`, resultsTableHtml({ columns: REPORT_COLUMNS, rows: reportRows, classify: reportClassify }));
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
}

function reportSetStatus(msg) {
  reportBaseStatus = msg;
  reportRenderStatus();
}

function reportSetRunning(on) {
  setDisabled(`${RP}-start`, !!on);
  if (reportUi) reportUi.running(!!on);
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
    flash(`${RP}-tsv`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק לאקסל');
    reportSetStatus(ok ? 'התוצאות הועתקו. הדבק באקסל (Ctrl+V)' : 'ההעתקה נחסמה בדפדפן');
  });
}

function reportUiMount(container, panelUi, page) {
  reportUi = panelUi;
  const branches = page && page.kind === 'institute' ? readBranchesFromTree() : [];
  container.innerHTML = `
    <div class="tt-box tt-box-info">
      שולח דיווח חודשי לכל הסניפים שבעץ-הצד, סניף אחרי סניף. סניף שכפתור הדיווח שלו מנוטרל (כבר דווח) מדולג.
      הריצה עוברת בין דפי-מוסד; "עצור" נכנס לתוקף לפני הסניף הבא, לא באמצע שליחה.
    </div>
    <div id="${RP}-branches" class="tt-hint">${branches.length ? `נמצאו ${branches.length} סניפים: ${esc(branches.join(', '))}` : 'לא נמצאו סניפים בעץ-הצד של הדף הזה'}</div>
    ${buttonsRowHtml([
      { id: `${RP}-start`, label: 'התחל דיווח לכל הסניפים', kind: 'primary', disabled: !branches.length },
      { id: `${RP}-stop`, label: 'עצור', kind: 'danger', title: 'גם מקש Escape עוצר' },
    ])}
    ${buttonsRowHtml([
      { id: `${RP}-tsv`, label: 'העתק לאקסל', kind: 'ghost', size: 'small' },
    ])}
    <div id="${RP}-results" class="tt-scroll"></div>
    <div id="${RP}-report" class="tt-box tt-box-warn" hidden></div>`;

  $el(`${RP}-start`).addEventListener('click', () => {
    Promise.resolve().then(reportUiStart).catch((e) => {
      log('[דיווח] ההרצה נכשלה: ' + (e && e.message));
      reportSetRunning(false);
      reportSetStatus('ההרצה נכשלה. בדוק את היומן ונסה שוב');
    });
  });
  $el(`${RP}-stop`).addEventListener('click', reportUiStop, true);
  $el(`${RP}-tsv`).addEventListener('click', reportCopyTsv);

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
    onProgress: (idx, total, branch) => { reportTotal = total; reportUi.progress(idx, total); reportSetStatus(`סניף ${branch} (${idx + 1}/${total})`); },
    onNavigating: (branch) => { reportSetStatus(`ממתין לטעינת דף המוסד של סניף ${branch}…`); },
    onResult: (result, all) => { reportRows = all.slice(); reportRenderRows(); reportUi.progress(all.length, Math.max(reportTotal, all.length)); },
    onDone: (all, summary) => {
      reportRows = all.slice();
      reportRenderRows();
      reportRenderSummary(summary);
      reportSetRunning(false);
      reportUi.progress(all.length, all.length);
      reportSetStatus(`הסתיים. ${summary.summary}`);
    },
  });

  reportRows = reportGetResults();
  reportRenderRows();
  if (reportHasPendingRun()) { reportSetStatus('נמצאה ריצה פתוחה. ממשיך…'); reportSetRunning(true); }
  Promise.resolve().then(() => reportResumeIfPending()).catch((e) => {
    log('[דיווח] ההמשך נכשל: ' + (e && e.message));
    reportSetRunning(false);
    reportSetStatus('ההמשך אחרי טעינת הדף נכשל. בדוק את היומן');
  });
}

export const reportTool = {
  id: 'report',
  title: 'דיווח חודשי',
  pages: ['institute'],
  hasPendingRun: reportHasPendingRun,
  isRunning: reportIsRunning,
  onStop: reportUiStop,
  mount: reportUiMount,
};
