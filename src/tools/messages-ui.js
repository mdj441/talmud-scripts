// לשונית "הודעות" בחלונית המאוחדת. הזרימה ב-messages.js; כאן רק הממשק: שני מצבים (גורף / לפי טבלה),
// סריקה → טבלה → העתקה/הורדה לאקסל → הדבקה → טעינה → ביצוע, טבלת-תוצאות, דוח "מה נשאר", "העתק דוח".
// הלשונית מופיעה בדפי 'other' (getPage לא מכיר את דף ההודעות); ב-mount בודקים את הכתובת.
// אין גישה ל-document ברמת המודול.

import { $el } from '../core/dom.js';
import { log } from '../core/log.js';
import { copyTextToClipboard } from '../core/csv.js';
import { esc, buttonHtml, buttonsRowHtml, resultsTableHtml, reportBoxHtml, flash, setHtml, setText, show, setDisabled } from '../ui/widgets.js';
import {
  MESSAGES_ALL_ACTIONS, MESSAGES_RESULT, messagesIsMessagesUrl, messagesParseTable, messagesLoadSummary, messagesBuildTsv,
  messagesBuildReportTsv, messagesDownloadXlsx, messagesSetHooks, messagesIsRunning, messagesRequestStop, messagesRunBulk,
  messagesScan, messagesRunTable, messagesGetScanned, messagesGetReportRows,
} from './messages.js';

const MP = 'tt-messages';
let msgUi = null;
let msgMode = 'bulk';
let msgPending = [];
let msgResults = [];

const MESSAGES_SCAN_COLUMNS = [
  { key: 'uid', label: 'UID', mono: true, width: '84px' },
  { key: 'header', label: 'נושא' },
  { key: 'personId', label: 'ת.ז./דרכון', mono: true },
  { key: 'date', label: 'תאריך', center: true },
  { key: 'suggestedAction', label: 'פעולה מוצעת' },
];

const MESSAGES_RESULT_COLUMNS = [
  { key: 'uid', label: 'UID', mono: true, width: '84px' },
  { key: 'header', label: 'נושא' },
  { key: 'id', label: 'ת.ז./דרכון', mono: true },
  { key: 'action', label: 'פעולה' },
  { key: 'status', label: 'סטטוס' },
];

function messagesClassify(r) {
  if (r.status === MESSAGES_RESULT.DONE) return 'ok';
  if (r.status === MESSAGES_RESULT.SKIPPED) return 'warn';
  return 'bad';
}

function messagesRenderScanned(list) {
  const rows = (list || []).map((r) => Object.assign({}, r, { detail: r.body }));
  setHtml(`${MP}-scanned`, resultsTableHtml({ columns: MESSAGES_SCAN_COLUMNS, rows, emptyText: '' }));
}

function messagesRenderResults() {
  const rows = msgResults.map((r) => Object.assign({}, r, { detail: r.body }));
  setHtml(`${MP}-results`, resultsTableHtml({ columns: MESSAGES_RESULT_COLUMNS, rows, classify: messagesClassify }));
}

function messagesRenderReport(report) {
  if (!report) { show(`${MP}-report`, false); setHtml(`${MP}-report`, ''); return; }
  setHtml(`${MP}-report`, reportBoxHtml(report));
  show(`${MP}-report`, true);
}

function messagesSetRunning(on) {
  for (const id of ['bulk-run', 'scan', 'load', 'run-table']) setDisabled(`${MP}-${id}`, !!on);
  if (!on) setDisabled(`${MP}-run-table`, !msgPending.length);
  msgUi.running(!!on);
}

function messagesSetMode(mode) {
  msgMode = mode === 'table' ? 'table' : 'bulk';
  show(`${MP}-bulk`, msgMode === 'bulk');
  show(`${MP}-table`, msgMode === 'table');
  for (const m of ['bulk', 'table']) {
    const b = $el(`${MP}-mode-${m}`);
    if (!b) continue;
    b.classList.toggle('tt-btn-primary', m === msgMode);
    b.classList.toggle('tt-btn-ghost', m !== msgMode);
  }
}

function messagesGuardRun(fn, what) {
  if (messagesIsRunning()) { msgUi.status('יש ריצה פעילה. עצור אותה קודם'); return; }
  Promise.resolve().then(fn).catch((e) => {
    log(`[הודעות] ${what} נכשל: ${e && e.message}`);
    messagesSetRunning(false);
    msgUi.status(`${what} נכשל. בדוק את היומן ונסה שוב`);
  });
}

function messagesStop() {
  if (!messagesIsRunning()) return;
  msgUi.status('עוצר… (אחרי הפעולה הנוכחית)');
  messagesRequestStop();
}

function messagesLoadTable() {
  const text = (($el(`${MP}-input`) || {}).value || '');
  const parsed = messagesParseTable(text);
  if (!parsed.ok) {
    msgPending = [];
    setText(`${MP}-load-status`, `✗ ${parsed.reason}`);
    setDisabled(`${MP}-run-table`, true);
    msgUi.status(parsed.reason);
    log(`[הודעות] טעינת טבלה: ${parsed.reason}`);
    return;
  }
  msgPending = parsed.entries;
  const summary = messagesLoadSummary(parsed);
  setText(`${MP}-load-status`, `✓ ${summary}`);
  setDisabled(`${MP}-run-table`, false);
  msgUi.status(`${summary}. לחץ "בצע"`);
  log(`[הודעות] ${summary}`);
}

function messagesCopyTsv() {
  const list = messagesGetScanned();
  if (!list.length) { msgUi.status('אין הודעות סרוקות להעתקה. לחץ "סרוק" קודם'); return; }
  copyTextToClipboard(messagesBuildTsv(list)).then((ok) => {
    flash(`${MP}-copy-tsv`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק לאקסל');
    msgUi.status(ok ? `הועתקו ${list.length} הודעות. הדבק באקסל (Ctrl+V), ערוך את עמודת "פעולה" והדבק חזרה` : 'ההעתקה נחסמה בדפדפן. השתמש ב"הורד אקסל"');
  });
}

function messagesDownload() {
  const list = messagesGetScanned();
  if (!list.length) { msgUi.status('אין הודעות סרוקות להורדה. לחץ "סרוק" קודם'); return; }
  const res = messagesDownloadXlsx(list);
  msgUi.status(res.ok ? `הורד קובץ ${res.format === 'xlsx' ? 'אקסל' : 'TSV'} עם ${list.length} הודעות` : `ההורדה נכשלה: ${res.reason || ''}`);
}

function messagesCopyReport() {
  const rows = messagesGetReportRows();
  if (!rows.length) { msgUi.status('אין דוח להעתקה'); return; }
  const text = messagesBuildReportTsv(rows);
  copyTextToClipboard(text).then((ok) => {
    flash(`${MP}-copy-report`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק דוח');
    if (ok) { msgUi.status(`הועתקו ${rows.length} שורות דוח`); return; }
    const ta = $el(`${MP}-input`);
    if (ta) ta.value = text;
    messagesSetMode('table');
    msgUi.status('ההעתקה נחסמה בדפדפן. הדוח הוצג בתיבת הטקסט להעתקה ידנית');
  });
}

function messagesMount(container, panelUi, page) {
  msgUi = panelUi;
  const url = (page && page.url) || (typeof location !== 'undefined' ? location.href : '');
  if (!messagesIsMessagesUrl(url)) {
    container.innerHTML = '<div class="tt-box tt-box-info">הכלי עובד בדף ההודעות בלבד.</div>';
    return;
  }
  container.innerHTML = `
    <div class="tt-row">
      ${buttonHtml({ id: `${MP}-mode-bulk`, label: 'מצב גורף', kind: 'primary' })}
      ${buttonHtml({ id: `${MP}-mode-table`, label: 'לפי טבלה', kind: 'ghost' })}
    </div>
    <div id="${MP}-bulk">
      <div class="tt-box tt-box-warn">
        עובר על <b>כל ההודעות</b> במצב "נשלחה", בכל העמודים:
        <ul>
          <li>"${esc('בקשת מעבר תלמיד')}": <b>אישור מעבר</b></li>
          <li>כל הודעה אחרת: <b>שנה מצב הודעה לטופל</b></li>
        </ul>
        "דחיית מעבר" לא נלחץ אוטומטית. לדחייה השתמש ב"לפי טבלה".
      </div>
      ${buttonsRowHtml([{ id: `${MP}-bulk-run`, label: 'הפעל מצב גורף', kind: 'primary' }])}
    </div>
    <div id="${MP}-table" hidden>
      <div class="tt-box tt-box-info">
        <b>שלב א</b>: "סרוק" עובר על כל ההודעות במצב "נשלחה" ובונה טבלה; "העתק לאקסל" או "הורד אקסל".
        <b>שלב ב</b>: ערוך באקסל את עמודת "פעולה" (${esc(MESSAGES_ALL_ACTIONS.join(' / '))}), הדבק כאן, "טען" ואז "בצע".
        אל תשנה את עמודת UID.
      </div>
      ${buttonsRowHtml([
        { id: `${MP}-scan`, label: 'סרוק', kind: 'primary' },
        { id: `${MP}-copy-tsv`, label: 'העתק לאקסל', kind: 'ghost' },
        { id: `${MP}-xlsx`, label: 'הורד אקסל', kind: 'ghost' },
      ])}
      <div id="${MP}-scan-status" class="tt-hint">לא בוצעה סריקה.</div>
      <div id="${MP}-scanned" class="tt-scroll"></div>
      <textarea id="${MP}-input" class="tt-textarea" placeholder="UID&#9;נושא&#9;ת.ז./דרכון&#9;תאריך&#9;גוף ההודעה&#9;פעולה"></textarea>
      ${buttonsRowHtml([
        { id: `${MP}-load`, label: 'טען', kind: 'ghost' },
        { id: `${MP}-run-table`, label: 'בצע', kind: 'primary', disabled: true },
      ])}
      <div id="${MP}-load-status" class="tt-hint">טבלה לא טעונה.</div>
    </div>
    ${buttonsRowHtml([
      { id: `${MP}-stop`, label: 'עצור', kind: 'danger', title: 'גם מקש Escape עוצר' },
      { id: `${MP}-copy-report`, label: 'העתק דוח', kind: 'ghost', size: 'small' },
    ])}
    <div id="${MP}-results" class="tt-scroll"></div>
    <div id="${MP}-report" class="tt-box tt-box-warn" hidden></div>`;

  $el(`${MP}-mode-bulk`).addEventListener('click', () => messagesSetMode('bulk'));
  $el(`${MP}-mode-table`).addEventListener('click', () => messagesSetMode('table'));
  $el(`${MP}-bulk-run`).addEventListener('click', () => messagesGuardRun(messagesRunBulk, 'מצב גורף'));
  $el(`${MP}-scan`).addEventListener('click', () => messagesGuardRun(messagesScan, 'הסריקה'));
  $el(`${MP}-copy-tsv`).addEventListener('click', messagesCopyTsv);
  $el(`${MP}-xlsx`).addEventListener('click', messagesDownload);
  $el(`${MP}-load`).addEventListener('click', messagesLoadTable);
  $el(`${MP}-run-table`).addEventListener('click', () => messagesGuardRun(() => messagesRunTable(msgPending), 'הביצוע לפי טבלה'));
  $el(`${MP}-stop`).addEventListener('click', messagesStop, true);
  $el(`${MP}-copy-report`).addEventListener('click', messagesCopyReport);

  messagesSetHooks({
    onStart: (mode) => {
      messagesSetRunning(true);
      if (mode !== 'scan') { msgResults = []; messagesRenderResults(); messagesRenderReport(null); }
      msgUi.progress(0, 0);
      msgUi.status(mode === 'scan' ? 'סורק…' : mode === 'bulk' ? 'מצב גורף רץ…' : 'מבצע לפי טבלה…');
    },
    onStatus: (msg) => msgUi.status(msg),
    onProgress: (cur, total) => msgUi.progress(cur, total),
    onResult: (row, all) => { msgResults = all; messagesRenderResults(); },
    onScanProgress: (list, pages) => setText(`${MP}-scan-status`, `סריקה: ${pages} עמודים, ${list.length} הודעות עד כה…`),
    onScanDone: (list, info) => {
      messagesRenderScanned(list);
      setText(`${MP}-scan-status`, `✓ נסרקו ${list.length} הודעות מ-${info.pages} עמודים${info.stopped ? ' (נעצר)' : ''}.`);
      messagesSetRunning(false);
      msgUi.status(list.length ? `נסרקו ${list.length} הודעות. "העתק לאקסל" או "הורד אקסל", ערוך את עמודת "פעולה" והדבק חזרה` : 'לא נמצאו הודעות במצב "נשלחה"');
    },
    onDone: (rows, report) => {
      msgResults = rows;
      messagesRenderResults();
      messagesRenderReport(report);
      messagesSetRunning(false);
      msgUi.progress(0, 0);
      msgUi.status(`${report.stopped ? 'נעצר' : 'הסתיים'}. ${report.summary}${report.lines.length ? ' (ראה "מה נשאר")' : ''}`);
    },
  });

  messagesSetMode(msgMode);
  msgResults = messagesGetReportRows();
  messagesRenderResults();
  messagesRenderScanned(messagesGetScanned());
  log('[הודעות] דף ההודעות זוהה');
  msgUi.status('מוכן. בחר מצב: גורף או לפי טבלה');
}

export const messagesTool = {
  id: 'messages',
  title: 'הודעות',
  pages: ['other'],
  hasPendingRun: () => false,
  isRunning: messagesIsRunning,
  onStop: messagesStop,
  mount: messagesMount,
};
