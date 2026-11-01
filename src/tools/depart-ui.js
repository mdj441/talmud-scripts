// לשונית "עזיבת תלמידים" בחלונית המאוחדת. הזרימה עצמה ב-depart.js; כאן רק הממשק (שכבת-הבהירות 1.11.2026):
// אזור "למי מדווחים עזיבה" (קלט: טורים סניף · ת.ז., תאריך וסיבת עזיבה, התחל/עצור), אזור "תוצאות" (סיכום, "מה לעשות"
// מתחת לכל שורה, "תקן והרץ שוב"), סרגל-שלבים ושורת-מצב שמחושבים מכל שינוי.
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
import { esc, buttonHtml, buttonsRowHtml, fieldHtml, selectHtml, resultsTableHtml, reportBoxHtml, zoneHtml, tagHtml, flash, setHtml, setText, show, setDisabled, bindDateMask, todayDMY } from '../ui/widgets.js';

const DEPART_P = 'tt-depart';
export const DEPART_STEPS = ['הכנה', 'ריצה', 'תוצאות', 'תיקון והרצה חוזרת'];
let departUi = null;
let departAwaitingErrorConfirm = false;
let departResults = [];
let departTotal = 0;
let departFixMode = false;
let departRunDone = false;

const DEPART_COLUMNS = [
  { key: 'branch', label: 'סניף', center: true, width: '44px' },
  { key: 'identity', label: 'ת.ז.', mono: true },
  { key: 'status', label: 'מה קרה' },
];

function departClassify(r) {
  if (isDepartSuccess(r.status)) return 'ok';
  const key = departStatusKey(r.status);
  if (key === DEPART_STATUS.STOPPED || key === DEPART_STATUS.SKIPPED || key === DEPART_STATUS.NOT_FOUND) return 'warn';
  return 'bad';
}

function departPlural(n, one, many) { return n === 1 ? one : many.replace('N', String(n)); }

function departRenderResults() {
  const zone = $el(`${DEPART_P}-zone-out`);
  if (zone) zone.classList.toggle('tt-zone-dim', !departResults.length);
  setHtml(`${DEPART_P}-results`, resultsTableHtml({ columns: DEPART_COLUMNS, rows: departResults, classify: departClassify, actionKey: 'action' }));
  show(`${DEPART_P}-results`, departResults.length > 0);
  const attention = departResults.filter((r) => !isDepartSuccess(r.status)).length;
  setDisabled(`${DEPART_P}-fix`, attention === 0);
  setText(`${DEPART_P}-fix`, attention ? `תקן והרץ שוב: ${departPlural(attention, 'תלמיד אחד', 'N תלמידים')}` : 'תקן והרץ שוב');
  for (const id of ['tsv', 'csv']) setDisabled(`${DEPART_P}-${id}`, departResults.length === 0);
}

function departRenderErrors(errors, validCount) {
  if (!errors || !errors.length) { show(`${DEPART_P}-errors`, false); setHtml(`${DEPART_P}-errors`, ''); return; }
  const items = errors.slice(0, 25).map((e) => `<li>שורה ${esc(e.line)}: ${esc(e.reason)}</li>`).join('');
  setHtml(`${DEPART_P}-errors`, `<b>${departPlural(errors.length, 'שורה אחת לא תרוץ', 'N שורות לא ירוצו')}</b> (${validCount} מוכנות):<ul>${items}${errors.length > 25 ? `<li>ועוד ${errors.length - 25}</li>` : ''}</ul>`);
  show(`${DEPART_P}-errors`, true);
}

function departRenderReport(report) {
  if (!report) { show(`${DEPART_P}-report`, false); setHtml(`${DEPART_P}-report`, ''); return; }
  const ok = departResults.filter((r) => isDepartSuccess(r.status)).length;
  const warn = departResults.filter((r) => departClassify(r) === 'warn').length;
  const bad = departResults.filter((r) => departClassify(r) === 'bad').length;
  const tags = [ok ? tagHtml({ label: `הצליחו ${ok}`, kind: 'ok' }) : '', warn ? tagHtml({ label: `לבדוק ${warn}`, kind: 'warn' }) : '', bad ? tagHtml({ label: `דורשים טיפול ${bad}`, kind: 'bad' }) : ''].filter(Boolean).join('');
  setHtml(`${DEPART_P}-report`, `<div class="tt-tags">${tags}</div>${reportBoxHtml(report, { idsWarning: false })}`);
  show(`${DEPART_P}-report`, true);
}

function departRenderStaleQueue(info) {
  if (!info) { show(`${DEPART_P}-stale`, false); setHtml(`${DEPART_P}-stale`, ''); return; }
  const done = info.curIdx || 0;
  const startedMs = Date.parse(info.startedAt);
  const ageMin = Number.isNaN(startedMs) ? null : Math.round((Date.now() - startedMs) / 60000);
  setHtml(`${DEPART_P}-stale`, `<b>הריצה נקטעה</b> (למשל החיבור לאתר פג) אחרי ${esc(done)} מתוך ${esc(info.total || 0)} תלמידים${ageMin === null ? '' : `, לפני ${esc(ageMin)} דקות`}. עבר זמן רב, ולכן הכלי לא ממשיך לבד.
    ${buttonsRowHtml([
      { id: `${DEPART_P}-stale-go`, label: 'המשך מהתלמיד הבא', kind: 'primary', size: 'small' },
      { id: `${DEPART_P}-stale-clear`, label: 'בטל את השאר', kind: 'danger', size: 'small' },
    ], 'tt-row-wrap')}`);
  show(`${DEPART_P}-stale`, true);
  $el(`${DEPART_P}-stale-go`).addEventListener('click', () => {
    departRenderStaleQueue(null);
    departUi.status('ממשיך את הריצה שנקטעה…');
    departSetRunning(true);
    Promise.resolve().then(() => departResumeIfPending({ allowStale: true })).catch((e) => { log('[המשך] כשל: ' + (e && e.message)); departSetRunning(false); });
  });
  $el(`${DEPART_P}-stale-clear`).addEventListener('click', () => {
    departDiscardSavedQueue();
    departRenderStaleQueue(null);
    departSetRunning(false);
    departUi.status('הריצה שנקטעה בוטלה. אפשר להתחיל ריצה חדשה');
  });
}

function departStep() {
  if (departIsRunning()) return 1;
  if (departFixMode) return 3;
  if (departResults.length && departRunDone) return 2;
  return 0;
}

// שורת-המצב מהקלט (מחושבת מכל הקשה)
function departRefreshStatus() {
  departUi.step(departStep());
  if (departIsRunning()) return;
  const text = (($el(`${DEPART_P}-input`) || {}).value || '').trim();
  if (!text) { departUi.status(departResults.length ? 'התיבה ריקה. "תקן והרץ שוב" מחזיר אליה את מי שדורש טיפול' : 'אין שורות עדיין. הדבק מאקסל: סניף ות.ז. בכל שורה'); setText(`${DEPART_P}-start`, 'התחל עזיבה'); return; }
  const parsed = parseDepartInput(text);
  const parts = [departPlural(parsed.tasks.length, 'תלמיד אחד מוכן', 'N תלמידים מוכנים')];
  if (parsed.errors.length) parts.push(departPlural(parsed.errors.length, 'שורה אחת לא תרוץ', 'N שורות לא ירוצו'));
  departUi.status((departFixMode ? 'תיקון: ' : '') + parts.join(' · ') + (departResults.length && !departFixMode ? '. התוצאות למטה הן מהריצה הקודמת' : ''));
  if (!departAwaitingErrorConfirm) setText(`${DEPART_P}-start`, parsed.tasks.length ? `התחל עזיבה: ${departPlural(parsed.tasks.length, 'תלמיד אחד', 'N תלמידים')}` : 'התחל עזיבה');
}

function departSetRunning(on) {
  setDisabled(`${DEPART_P}-start`, !!on);
  show(`${DEPART_P}-stop`, !!on);
  const zoneIn = $el(`${DEPART_P}-zone-in`); if (zoneIn) zoneIn.classList.toggle('tt-zone-dim', !!on);
  departUi.running(!!on);
  departUi.step(departStep());
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
  departRenderErrors([], 0);
  departRefreshStatus();
}

async function departStart() {
  if (departIsRunning()) return;
  const text = (($el(`${DEPART_P}-input`) || {}).value || '').trim();
  if (!text) { departUi.status('הדבק רשימה: סניף ות.ז. בכל שורה (טורים מאקסל)'); return; }
  const settings = departReadSettings();
  if (settings.leaveDate && !departIsValidDate(settings.leaveDate)) {
    departUi.status('תאריך העזיבה לא תקין. הפורמט: יום/חודש/שנה, או השאר ריק (= היום)');
    return;
  }
  const parsed = parseDepartInput(text);
  if (parsed.errors.length && !departAwaitingErrorConfirm) {
    departRenderErrors(parsed.errors, parsed.tasks.length);
    departAwaitingErrorConfirm = true;
    setText(`${DEPART_P}-start`, parsed.tasks.length ? `כן, התחל בלי ${departPlural(parsed.errors.length, 'השורה השגויה', 'N השורות השגויות')}` : 'התחל עזיבה');
    departUi.status(`${departPlural(parsed.errors.length, 'שורה אחת לא תרוץ', 'N שורות לא ירוצו')}. תקן אותן, או לחץ שוב כדי להתחיל בלי השגויות`);
    log(`[עזיבה] פרסור: ${parsed.tasks.length} תקינות · ${parsed.errors.length} שגויות`);
    return;
  }
  if (!parsed.tasks.length) { departRenderErrors(parsed.errors, 0); departUi.status('אין תלמידים שיכולים לרוץ. תקן את השורות השגויות'); return; }
  departAwaitingErrorConfirm = false;
  departRenderErrors([], 0);
  departFixMode = false;
  departRunDone = false;
  departRenderReport(null);
  departRenderStaleQueue(null);
  departResults = [];
  departRenderResults();
  departSetRunning(true);
  departUi.progress(0, parsed.tasks.length);
  departUi.status(`מתחיל: ${departPlural(parsed.tasks.length, 'תלמיד אחד', 'N תלמידים')}…`);
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

// זרימת-התיקון: משאיר בתיבה רק את מי שדורש טיפול
function departFixAndRerun() {
  const left = departCurrentRows().filter((r) => !isDepartSuccess(r.status));
  const ta = $el(`${DEPART_P}-input`);
  if (ta) ta.value = left.map((r) => `${r.branch}\t${r.identity}`).join('\n');
  departFixMode = left.length > 0;
  departAwaitingErrorConfirm = false;
  departRenderErrors([], 0);
  departRefreshStatus();
  if (left.length) departUi.status(`תיקון: ${departPlural(left.length, 'תלמיד אחד בתיבה', 'N תלמידים בתיבה')}. תקן לפי "מה לעשות" בתוצאות ולחץ "התחל עזיבה"`);
  log(`[עזיבה] תקן והרץ שוב: ${left.length} תלמידים בתיבה`);
}

function departCopyTsv() {
  const rows = departCurrentRows();
  if (!rows.length) { departUi.status('אין תוצאות להעתקה'); return; }
  copyTextToClipboard(buildDepartTsv(rows)).then((ok) => {
    flash(`${DEPART_P}-tsv`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק תוצאות לאקסל');
    departUi.status(ok ? 'התוצאות הועתקו. הדבק באקסל (Ctrl+V)' : 'ההעתקה נחסמה בדפדפן. השתמש ב"הורד קובץ"');
  });
}

function departExportCsv() {
  const rows = departCurrentRows();
  if (!rows.length) { departUi.status('אין תוצאות להורדה'); return; }
  const name = `departures_${new Date().toISOString().slice(0, 10)}.csv`;
  departUi.status(downloadCsv(name, buildDepartCsvRows(rows)) ? `הורד ${name}` : 'ההורדה נכשלה');
}

function departMount(container, panelUi, page) {
  departUi = panelUi;
  const fits = !!(page && page.kind === 'institute');
  container.innerHTML = `
    ${zoneHtml({ id: `${DEPART_P}-zone-in`, title: 'למי מדווחים עזיבה', inner: `
      <p class="tt-zone-lead">כאן מדווחים עזיבה לכמה תלמידים בבת אחת: מדביקים מאקסל שתי עמודות, סניף ות.ז. תלמיד שכבר רשום כעוזב מקבל "כבר בוצעה עזיבה" ולא משתנה.${fits ? '' : ' אפשר להתחיל גם מכאן: הכלי יעבור בעצמו לדף המוסד הנכון.'}</p>
      <textarea id="${DEPART_P}-input" class="tt-textarea" placeholder="00&#9;012345678&#10;16&#9;023456789"></textarea>
      <div id="${DEPART_P}-errors" class="tt-box tt-box-error" hidden></div>
      <div id="${DEPART_P}-stale" class="tt-box tt-box-warn" hidden></div>
      <div class="tt-row">
        ${fieldHtml('תאריך עזיבה (ריק = היום)', `<input id="${DEPART_P}-date" class="tt-input tt-mono" type="text" maxlength="10" placeholder="${todayDMY()}">`)}
        ${fieldHtml('סיבת עזיבה', selectHtml({ id: `${DEPART_P}-reason`, options: DEPART_REASONS, value: DEPART_DEFAULT_REASON }))}
      </div>
      <div class="tt-row tt-row-wrap">
        ${buttonHtml({ id: `${DEPART_P}-start`, label: 'התחל עזיבה', kind: 'primary' })}
        ${buttonHtml({ id: `${DEPART_P}-stop`, label: 'עצור', kind: 'danger', title: 'גם מקש Escape עוצר', attrs: 'hidden' })}
      </div>` })}
    ${zoneHtml({ id: `${DEPART_P}-zone-out`, title: 'תוצאות', dim: true, inner: `
      <div id="${DEPART_P}-report" class="tt-box tt-box-warn" hidden></div>
      <div class="tt-row tt-row-wrap tt-row-tight">
        ${buttonHtml({ id: `${DEPART_P}-fix`, label: 'תקן והרץ שוב', kind: 'primary', size: 'small', disabled: true, title: 'משאיר בתיבה רק את מי שדורש טיפול' })}
        ${buttonHtml({ id: `${DEPART_P}-tsv`, label: 'העתק תוצאות לאקסל', kind: 'ghost', size: 'small', disabled: true, title: 'מכיל מזהים מלאים: לא להדביק בצ\'אט' })}
        ${buttonHtml({ id: `${DEPART_P}-csv`, label: 'הורד קובץ', kind: 'ghost', size: 'small', disabled: true })}
      </div>
      <div id="${DEPART_P}-results" class="tt-scroll" hidden></div>` })}`;

  bindDateMask(`${DEPART_P}-date`);
  $el(`${DEPART_P}-input`).addEventListener('input', () => { if (departAwaitingErrorConfirm) departResetStartButton(); else departRefreshStatus(); });
  $el(`${DEPART_P}-start`).addEventListener('click', () => {
    Promise.resolve().then(departStart).catch((e) => {
      log('[עזיבה] ההרצה נכשלה: ' + (e && e.message));
      departSetRunning(false);
      departUi.status('ההרצה נכשלה. בדוק את היומן ונסה שוב');
    });
  });
  $el(`${DEPART_P}-stop`).addEventListener('click', departStopClick, true);
  $el(`${DEPART_P}-fix`).addEventListener('click', departFixAndRerun);
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
    onProgress: (idx, tot, task) => { departTotal = tot; departUi.progress(idx, tot); departUi.status(`מעבד ${idx + 1} מתוך ${tot}: סניף ${task.branch}`); },
    onResult: (result, all) => { departResults = all.slice(); departRenderResults(); departUi.progress(all.length, Math.max(departTotal, all.length)); },
    onNavigating: (branch) => { departUi.status(`עובר לדף המוסד של סניף ${branch}… ממתין לטעינה`); },
    onStaleQueue: (info) => { departSetRunning(false); departUi.status('יש ריצת עזיבה שנקטעה. בחר "המשך" או "בטל"'); departRenderStaleQueue(info); departUi.open(); },
    onDone: (all, report) => {
      departResults = all.slice(); departRunDone = true; departFixMode = false; departRenderResults(); departRenderReport(report); departSetRunning(false); departUi.progress(all.length, all.length);
      const bad = all.filter((r) => !isDepartSuccess(r.status)).length;
      departUi.status(bad ? `הסתיים: ${all.length - bad} מתוך ${all.length} הצליחו. ${departPlural(bad, 'תלמיד אחד דורש טיפול', 'N תלמידים דורשים טיפול')}: ראה "מה לעשות" בתוצאות` : `הסתיים: ${all.length} מתוך ${all.length} הצליחו. הכול טופל`);
    },
  });

  log(`[עזיבה] דף ${page.kind}${page.branch ? ` · סניף ${page.branch} [${page.branchSource || '?'}]` : ''}`);
  departResults = departGetResults();
  departRenderResults();
  departRefreshStatus();
  const saved = departSavedQueueInfo();
  if (departHasSavedQueue()) departUi.status(saved && saved.stale ? 'נמצאה ריצת עזיבה שנקטעה. בודק…' : 'נמצאה ריצת עזיבה פתוחה. ממשיך…');
  Promise.resolve().then(() => departResumeIfPending()).catch((e) => { log('[המשך] כשל: ' + (e && e.message)); departSetRunning(false); });
}

export const departTool = {
  id: 'depart',
  title: 'עזיבת תלמידים',
  pages: ['*'], // הכרעה ח2: בכל דף; הזרימה מנווטת לדף המוסד בעצמה
  fits: (page) => !!(page && page.kind === 'institute'),
  steps: DEPART_STEPS,
  hasPendingRun: departHasSavedQueue,
  isRunning: departIsRunning,
  onStop: departStopClick,
  mount: departMount,
};
