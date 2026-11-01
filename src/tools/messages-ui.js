// לשונית "הודעות" בחלונית המאוחדת. הזרימה ב-messages.js; כאן רק הממשק (שכבת-הבהירות, סבב לשונית ההודעות, 2.11.2026):
// ארבעה שלבים שמחליפים את המסך: סריקה ("סרוק", המצבת, ההסבר) → סקירה (טבלת-הסקירה עם סינון מהיר, פעולות-צובר,
// החלטה לכל שורה, לחיצה על גוף ההודעה פותחת את הנוסח המלא; "בצע לפי הטבלה" חל רק על השורות המוצגות) → ביצוע
// (שורת-ריצה עם "עצור" אדום, הטבלה מוסתרת, התוצאות מצטברות) → תוצאות ("מה קרה" לכל הודעה, "מה לעשות" מתחת לנכשלות,
// "סריקה חדשה"). "מצב גורף" רץ באותה שורת-ריצה ומסתיים באותו שלב-תוצאות. מסלול האקסל נשאר כאופציה מתקפלת בסקירה.
// כפתורים שמוחקים (נקה מצבת, נקה טבלה, סריקה חדשה) דורשים לחיצה שנייה. אין מצב שמור: דף ההודעות עובד ב-postback בלבד.
// הלשונית מופיעה בכל דף; מחוץ לדף ההודעות היא מציעה לעבור אליו. אין גישה ל-document ברמת המודול.

import { $el } from '../core/dom.js';
import { log } from '../core/log.js';
import { copyTextToClipboard } from '../core/csv.js';
import { loadXlsxFile } from './absorb-xlsx.js';
import { esc, buttonHtml, buttonsRowHtml, selectHtml, resultsTableHtml, reportBoxHtml, fitBoxHtml, bindConfirmClick, flash, setHtml, setText, show, setDisabled } from '../ui/widgets.js';
import {
  MESSAGES_ACTION, MESSAGES_ALL_ACTIONS, MESSAGES_RESULT, MESSAGES_TRANSFER_HEADER, MESSAGES_TRANSFER_DONE_HEADER,
  messagesIsMessagesUrl, messagesParseTable, messagesLoadSummary, messagesBuildTsv,
  messagesBuildReportTsv, messagesDownloadXlsx, messagesSetHooks, messagesIsRunning, messagesRequestStop, messagesRunBulk,
  messagesScan, messagesRunTable, messagesGetScanned, messagesGetReportRows,
  messagesMergeDuplicates, messagesParseRoster, messagesCrossCheck, messagesRowDecision, messagesDecisionCounts,
  messagesReviewEntries, messagesRowMatchesFilter, messagesShorten, messagesRunLabel, messagesResultTodo, messagesRunText,
} from './messages.js';

const MP = 'tt-messages';
export const MESSAGES_STEPS = ['סריקה', 'סקירה', 'ביצוע', 'תוצאות'];
const MESSAGES_STAGE_INDEX = { scan: 0, review: 1, run: 2, results: 3 };
const MESSAGES_PAGE_PATH = '/Association/Default.aspx';
let msgUi = null;
let msgMode = 'table';
let msgStage = 'scan'; // scan | review | run | results
let msgPending = []; // מסלול האקסל: הרשומות שנטענו מהטקסט המודבק
let msgResults = [];
let msgReport = null; // דוח "מה נשאר" של הריצה האחרונה (null = אין)
let msgScanned = []; // ההודעות מהסריקה האחרונה (עותק מקומי: "נקה טבלה" / "סריקה חדשה" מרוקנים אותו)
let msgRows = []; // טבלת הסקירה: שורות ממוזגות (אחרי הצלבה)
let msgDecisions = new Map(); // key של שורה → פעולה שנבחרה (ריק = ההצעה)
let msgExpanded = new Set(); // key של שורה שגוף ההודעה שלה פתוח במלואו
let msgRoster = null; // המצבת המודבקת (messagesParseRoster) או null

const MESSAGES_BODY_MAX = 70;
const MESSAGES_REVIEW_COLS = 7;

const MESSAGES_RESULT_COLUMNS = [
  { key: 'uid', label: 'UID', mono: true, width: '84px' },
  { key: 'header', label: 'נושא' },
  { key: 'id', label: 'ת.ז./דרכון', mono: true },
  { key: 'action', label: 'פעולה' },
  { key: 'status', label: 'מה קרה' },
];

function messagesClassify(r) {
  if (r.status === MESSAGES_RESULT.DONE) return 'ok';
  if (r.status === MESSAGES_RESULT.SKIPPED) return 'warn';
  return 'bad';
}

// ─── שלבים ──────────────────────────────────────────────────────────────────

// המצבת נגישה בסריקה ובסקירה: אותו רכיב (עם הטקסט שהודבק) עובר בין שני האזורים.
function messagesPlaceRoster(stage) {
  const box = $el(`${MP}-roster`);
  const host = $el(`${MP}-roster-slot-${stage === 'review' ? 'review' : 'scan'}`);
  if (box && host && box.parentElement !== host) host.appendChild(box);
}

function messagesSetStage(s) {
  msgStage = s;
  const prep = s === 'scan' || s === 'review';
  show(`${MP}-modes`, prep);
  show(`${MP}-bulk`, prep && msgMode === 'bulk');
  show(`${MP}-table`, prep && msgMode === 'table');
  show(`${MP}-zone-scan`, s === 'scan');
  show(`${MP}-zone-review`, s === 'review');
  show(`${MP}-zone-out`, s === 'run' || s === 'results');
  show(`${MP}-out-actions`, s === 'results');
  messagesPlaceRoster(s);
  msgUi.step(MESSAGES_STAGE_INDEX[s] || 0);
}

// השלב כשאין ריצה: תוצאות אם יש דוח, סקירה אם יש טבלה, אחרת סריקה
function messagesIdleStage() {
  if (msgReport || msgResults.length) return 'results';
  return msgRows.length ? 'review' : 'scan';
}

function messagesSetScanStatus(text) {
  setText(`${MP}-scan-status`, text);
  setText(`${MP}-zone-review-note`, text);
}

function messagesSetRunText(text) { setText(`${MP}-runtext`, text); }

// ─── טבלת הסקירה ────────────────────────────────────────────────────────────

function messagesFilterText() {
  const el = $el(`${MP}-filter`);
  return el ? el.value : '';
}

function messagesVisibleRows() {
  const q = messagesFilterText();
  return msgRows.filter((r) => messagesRowMatchesFilter(r, q));
}

function messagesRenderSummary() {
  const el = $el(`${MP}-summary`);
  if (!el) return;
  if (!msgRows.length) { el.textContent = ''; return; }
  const c = messagesDecisionCounts(msgRows, msgDecisions);
  const visible = messagesVisibleRows().length;
  const pending = msgRows.filter((r) => r.pending).length;
  const done = msgRows.filter((r) => r.probablyDone).length;
  el.textContent = `${msgRows.length} שורות${visible !== msgRows.length ? ` (${visible} מוצגות)` : ''} · אישור מעבר=${c.approve} · דחיית מעבר=${c.decline} · טופל=${c.handled} · דלג=${c.skip}${pending ? ` · ממתין=${pending}` : ''}${done ? ` · כנראה בוצע=${done}` : ''}`;
}

// תגי המצבת לבקשת-מעבר: "ממתין" (התלמיד עדיין במצבת: לאשר או לדחות) / "כנראה בוצע" (אינו במצבת).
function messagesRosterTagHtml(r) {
  if (r.pending) return ' <span class="tt-tag tt-tag-count tt-tag-pending" title="התלמיד עדיין במצבת: הבקשה ממתינה לאישור או לדחייה">ממתין</span>';
  if (r.probablyDone) return ' <span class="tt-tag tt-tag-done" title="התלמיד אינו במצבת: כנראה המעבר כבר בוצע">כנראה בוצע</span>';
  return '';
}

// שורת-סקירה + שורת "הנוסח המלא" מתחתיה (מוסתרת עד לחיצה על גוף ההודעה).
function messagesRowHtml(r, i) {
  const decision = messagesRowDecision(r, msgDecisions);
  const dates = r.dates && r.dates.length > 1 ? r.dates.join(', ') : '';
  const roster = r.rosterLabel ? `${esc(r.rosterLabel)}${messagesRosterTagHtml(r)}` : '';
  const uidsTitle = `UID: ${r.uids.join(', ')}`;
  const open = msgExpanded.has(r.key);
  return `<tr class="tt-review-row${r.probablyDone ? ' tt-r-done' : ''}" data-key="${esc(r.key)}" data-uid="${esc(r.uid)}" data-uids="${esc(r.uids.join(','))}" title="${esc(uidsTitle)}">
    <td class="tt-mono">${esc(r.personId)}</td>
    <td>${esc(r.header)}</td>
    <td class="tt-body-cell${open ? ' tt-body-open' : ''}" title="${esc(r.body)}" role="button" aria-expanded="${open ? 'true' : 'false'}">${esc(messagesShorten(r.body, MESSAGES_BODY_MAX))}</td>
    <td class="tt-center"${dates ? ` title="${esc(dates)}"` : ''}>${esc(r.date)}${dates ? ` <span class="tt-muted">+${r.dates.length - 1}</span>` : ''}</td>
    <td class="tt-center tt-count-cell">${r.count > 1 ? `<span class="tt-tag tt-tag-count" title="${esc(`${r.count} הודעות מוזגו לשורה הזו`)}">${r.count}</span>` : '1'}</td>
    <td class="tt-roster-cell">${roster}</td>
    <td>${selectHtml({ id: `${MP}-decision-${i}`, options: MESSAGES_ALL_ACTIONS, value: decision, cls: 'tt-decision' })}</td>
  </tr><tr class="tt-body-full" data-key="${esc(r.key)}"${open ? '' : ' hidden'}><td colspan="${MESSAGES_REVIEW_COLS}">${esc(r.body)}</td></tr>`;
}

function messagesRenderReview() {
  const box = $el(`${MP}-scanned`);
  if (!box) return;
  if (!msgRows.length) { box.innerHTML = ''; messagesRenderSummary(); messagesRefreshRunButton(); messagesSetReviewEnabled(); return; }
  const head = ['ת.ז./דרכון', 'נושא', 'גוף ההודעה', 'תאריך', 'כמות', 'במצבת', 'החלטה'].map((h) => `<th>${esc(h)}</th>`).join('');
  box.innerHTML = `<table class="tt-table tt-review-table"><thead><tr>${head}</tr></thead><tbody>${msgRows.map(messagesRowHtml).join('')}</tbody></table>`;
  box.querySelectorAll('select.tt-decision').forEach((sel) => {
    sel.addEventListener('change', () => {
      const tr = sel.closest('tr');
      if (!tr) return;
      msgDecisions.set(tr.getAttribute('data-key'), sel.value);
      messagesRenderSummary();
    });
  });
  messagesApplyFilter();
  messagesSetReviewEnabled();
}

// לחיצה על גוף ההודעה פותחת/סוגרת את הנוסח המלא מתחת לשורה (האצלה: הטבלה נבנית מחדש בכל רענון).
function messagesOnReviewClick(e) {
  const td = e.target && e.target.closest ? e.target.closest('td.tt-body-cell') : null;
  if (!td) return;
  const tr = td.closest('tr.tt-review-row');
  const key = tr ? tr.getAttribute('data-key') : '';
  if (!key) return;
  if (msgExpanded.has(key)) msgExpanded.delete(key); else msgExpanded.add(key);
  const open = msgExpanded.has(key);
  td.classList.toggle('tt-body-open', open);
  td.setAttribute('aria-expanded', open ? 'true' : 'false');
  const full = tr.nextElementSibling;
  if (full && full.classList.contains('tt-body-full')) full.hidden = !open;
}

function messagesApplyFilter() {
  const box = $el(`${MP}-scanned`);
  if (!box) return;
  const byKey = new Map(msgRows.map((r) => [r.key, r]));
  const q = messagesFilterText();
  box.querySelectorAll('tr.tt-review-row').forEach((tr) => {
    const key = tr.getAttribute('data-key');
    const r = byKey.get(key);
    const on = !!(r && messagesRowMatchesFilter(r, q));
    tr.hidden = !on;
    const full = tr.nextElementSibling;
    if (full && full.classList.contains('tt-body-full')) full.hidden = !on || !msgExpanded.has(key);
  });
  messagesRenderSummary();
  messagesRefreshRunButton();
  messagesSetReviewEnabled();
}

// "בצע לפי הטבלה: N" / "N (המוצגות)": הביצוע חל רק על השורות המוצגות
function messagesRefreshRunButton() {
  const visible = messagesVisibleRows().length;
  const filter = messagesFilterText();
  setText(`${MP}-run-review`, messagesRunLabel(visible, msgRows.length, filter));
  const btn = $el(`${MP}-run-review`);
  if (!btn) return;
  btn.title = !msgRows.length ? 'אין טבלה. לחץ "סרוק" קודם'
    : (!visible ? 'אין שורות מוצגות. נקה את הסינון המהיר' : (String(filter).trim() ? 'מבצע רק את השורות המוצגות' : 'מבצע את כל השורות בטבלה'));
}

function messagesSetReviewEnabled() {
  const on = msgRows.length > 0 && !messagesIsRunning();
  for (const id of ['all-transfers', 'all-others', 'all-done', 'all-skip', 'clear-table']) setDisabled(`${MP}-${id}`, !on);
  setDisabled(`${MP}-run-review`, !on || messagesVisibleRows().length === 0);
}

// פעולת-צובר על השורות המוצגות (אחרי הסינון). pick(row) → פעולה או null (לא לגעת).
function messagesBulkDecide(pick, what) {
  if (!msgRows.length) { msgUi.status('אין טבלה. לחץ "סרוק" קודם'); return; }
  let n = 0;
  for (const r of messagesVisibleRows()) {
    const a = pick(r);
    if (!a) continue;
    msgDecisions.set(r.key, a);
    n++;
  }
  messagesRenderReview();
  msgUi.status(`${what}: עודכנו ${n} שורות`);
}

// בונה את שורות הסקירה מהסריקה האחרונה + המצבת, ושומר החלטות שכבר נבחרו (לפי key).
function messagesRebuildRows() {
  const merged = messagesMergeDuplicates(msgScanned);
  msgRows = messagesCrossCheck(merged, msgRoster);
  // ממצא ב-10: "כנראה בוצע" הוא רמז לבדיקה; ההחלטה שנבחרה נשמרת, ורק הכפתור "כל 'כנראה בוצע': סמן כטופל" מחיל
  const keep = new Map();
  for (const r of msgRows) if (msgDecisions.has(r.key)) keep.set(r.key, msgDecisions.get(r.key));
  msgDecisions = keep;
  messagesRenderReview();
}

const MESSAGES_DONE_HINT = (n) => `${n} בקשות-מעבר על תלמידים שאינם במצבת מסומנות "כנראה בוצע" (רמז לבדיקה; "כל 'כנראה בוצע': סמן כטופל" מחיל)`;

// ─── המצבת ──────────────────────────────────────────────────────────────────

function messagesLoadRoster(source) {
  const text = (($el(`${MP}-roster-input`) || {}).value || '');
  const parsed = messagesParseRoster(text);
  if (!parsed.ok) {
    msgRoster = null;
    setText(`${MP}-roster-status`, `✗ ${parsed.reason}`);
    msgUi.status(parsed.reason);
    log(`[הודעות] טעינת מצבת: ${parsed.reason}`);
    messagesRebuildRows();
    return;
  }
  msgRoster = parsed;
  const txt = `✓ נטענה מצבת${source ? ` מ${source}` : ''}: ${parsed.count} שורות${parsed.ignored ? ` (${parsed.ignored} שורות בלי ת.ז. דולגו)` : ''}`;
  setText(`${MP}-roster-status`, txt);
  log(`[הודעות] ${txt}`);
  messagesRebuildRows();
  const done = msgRows.filter((r) => r.probablyDone).length;
  const pending = msgRows.filter((r) => r.pending).length;
  msgUi.status(msgRows.length ? `${txt}. ${done ? MESSAGES_DONE_HINT(done) : 'אין בקשות-מעבר על תלמידים שאינם במצבת'}${pending ? `; ${pending} ממתינות לאישור או לדחייה` : ''}` : `${txt}. לחץ "סרוק" כדי להצליב`);
}

// "טען קובץ אקסל": הגיליון הראשון הופך לטקסט טאבים (כמו הדבקה) ונטען כמצבת.
function messagesRosterXlsx(ev) {
  const input = ev && ev.target;
  const file = input && input.files && input.files[0];
  if (!file) return;
  msgUi.status('טוען קובץ אקסל…');
  Promise.resolve().then(() => loadXlsxFile(file)).then((text) => {
    const ta = $el(`${MP}-roster-input`);
    if (ta) ta.value = text;
    const det = $el(`${MP}-roster`);
    if (det) det.open = true;
    messagesLoadRoster(`קובץ "${file.name}"`);
  }).catch((e) => {
    msgUi.status('טעינת האקסל נכשלה: ' + ((e && e.message) || 'שגיאה לא ידועה'));
  }).finally(() => { if (input) input.value = ''; });
}

// "נקה מצבת" (אחרי לחיצה שנייה): מוחק את הטקסט ואת ההצלבה
function messagesClearRoster() {
  msgRoster = null;
  const ta = $el(`${MP}-roster-input`);
  if (ta) ta.value = '';
  setText(`${MP}-roster-status`, 'אין מצבת טעונה.');
  messagesRebuildRows();
  msgUi.status('המצבת נוקתה');
  log('[הודעות] המצבת נוקתה');
}

// ─── ביצוע לפי הטבלה: רק השורות המוצגות ────────────────────────────────────

function messagesRunReview() {
  const rows = messagesVisibleRows();
  const entries = messagesReviewEntries(rows, msgDecisions);
  if (!entries.length) { msgUi.status(msgRows.length ? 'אין שורות מוצגות. נקה את הסינון המהיר' : 'אין טבלה. לחץ "סרוק" קודם'); return; }
  const c = messagesDecisionCounts(rows, msgDecisions);
  const shown = rows.length !== msgRows.length ? ` מתוך ${msgRows.length} (המוצגות)` : '';
  log(`[הודעות] בצע לפי הטבלה: ${rows.length} שורות${shown} (${entries.length} הודעות): אישור=${c.approve}, דחיה=${c.decline}, טופל=${c.handled}, דילוג=${c.skip}`);
  messagesGuardRun(() => messagesRunTable(entries), 'הביצוע לפי הטבלה');
}

// "נקה טבלה" (אחרי לחיצה שנייה): מרוקן את טבלת-הסקירה וחוזר לסריקה; התוצאות לא נוגעות
function messagesClearTable() {
  msgScanned = [];
  msgRows = [];
  msgDecisions = new Map();
  msgExpanded = new Set();
  const f = $el(`${MP}-filter`);
  if (f) f.value = '';
  messagesRenderReview();
  messagesSetScanStatus('הטבלה נוקתה. לחץ "סרוק" לסריקה חדשה.');
  messagesSetStage('scan');
  msgUi.status('הטבלה נוקתה. "סרוק" אוסף את ההודעות הפתוחות מחדש');
  log('[הודעות] טבלת הסקירה נוקתה');
}

// "סריקה חדשה" (אחרי לחיצה שנייה): מנקה תוצאות וטבלה וחוזר לסריקה
function messagesNewScan() {
  msgResults = [];
  msgReport = null;
  msgScanned = [];
  msgRows = [];
  msgDecisions = new Map();
  msgExpanded = new Set();
  const f = $el(`${MP}-filter`);
  if (f) f.value = '';
  messagesRenderResults();
  messagesRenderReport(null);
  messagesRenderReview();
  messagesSetScanStatus('לא בוצעה סריקה.');
  messagesSetStage('scan');
  msgUi.progress(0, 0);
  msgUi.status('מוכן לסריקה חדשה. "סרוק" אוסף את כל ההודעות הפתוחות לטבלה אחת');
  log('[הודעות] סריקה חדשה: התוצאות והטבלה נוקו');
}

// ─── תוצאות, ריצה, מצב ──────────────────────────────────────────────────────

function messagesRenderResults() {
  const rows = msgResults.map((r) => Object.assign({}, r, { detail: r.body, todo: messagesResultTodo(r) }));
  setHtml(`${MP}-results`, resultsTableHtml({ columns: MESSAGES_RESULT_COLUMNS, rows, classify: messagesClassify, actionKey: 'todo' }));
  setDisabled(`${MP}-copy-report`, !msgResults.length);
}

function messagesRenderReport(report) {
  if (!report) { show(`${MP}-report`, false); setHtml(`${MP}-report`, ''); setText(`${MP}-zone-out-note`, ''); return; }
  setHtml(`${MP}-report`, reportBoxHtml(report));
  show(`${MP}-report`, true);
  setText(`${MP}-zone-out-note`, `ריצה מ-${new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`);
}

// בזמן ריצה: שורת-הריצה עם "עצור" מוצגת (רק אז), הכפתורים שמתחילים או מוחקים כבויים
function messagesSetRunning(on) {
  for (const id of ['bulk-run', 'scan', 'load', 'run-table', 'roster-load', 'roster-xlsx', 'roster-clear', 'new-scan', 'clear-table']) setDisabled(`${MP}-${id}`, !!on);
  if (!on) setDisabled(`${MP}-run-table`, !msgPending.length);
  show(`${MP}-zone-run`, !!on);
  messagesSetReviewEnabled();
  msgUi.running(!!on);
}

function messagesSetMode(mode) {
  msgMode = mode === 'bulk' ? 'bulk' : 'table';
  for (const m of ['bulk', 'table']) {
    const b = $el(`${MP}-mode-${m}`);
    if (!b) continue;
    b.classList.toggle('tt-btn-primary', m === msgMode);
    b.classList.toggle('tt-btn-ghost', m !== msgMode);
  }
  messagesSetStage(msgStage);
}

function messagesGuardRun(fn, what) {
  if (messagesIsRunning()) { msgUi.status('יש ריצה פעילה. עצור אותה קודם'); return; }
  Promise.resolve().then(fn).catch((e) => {
    log(`[הודעות] ${what} נכשל: ${e && e.message}`);
    messagesSetRunning(false);
    if (msgStage === 'run') messagesSetStage(messagesIdleStage());
    msgUi.status(`${what} נכשל. בדוק את היומן ונסה שוב`);
  });
}

function messagesStop() {
  if (!messagesIsRunning()) return;
  msgUi.status('עוצר… (אחרי הפעולה הנוכחית)');
  messagesRequestStop();
}

// ─── מסלול האקסל (אופציה) ───────────────────────────────────────────────────

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
    const det = $el(`${MP}-excel`);
    if (det) det.open = true;
    msgUi.status('ההעתקה נחסמה בדפדפן. הדוח הוכנס לתיבת הטקסט של "דרך אקסל" (בשלב הסקירה) להעתקה ידנית');
  });
}

// ─── mount ──────────────────────────────────────────────────────────────────

function messagesMount(container, panelUi, page) {
  msgUi = panelUi;
  const url = (page && page.url) || (typeof location !== 'undefined' ? location.href : '');
  if (!messagesIsMessagesUrl(url)) {
    // הכרעה ח (1.11.2026): הלשונית מופיעה בכל דף; מחוץ לדף ההודעות היא מסבירה ומציעה לעבור
    container.innerHTML = fitBoxHtml({ id: `${MP}-fit`, text: 'כאן מטפלים בהודעות שנשלחו אליכם (בקשות-מעבר ועדכונים). הכלי עובד מתוך דף ההודעות של האתר.', buttonId: `${MP}-goto`, buttonLabel: 'עבור לדף ההודעות' });
    msgUi.status('הכלי עובד מתוך דף ההודעות');
    $el(`${MP}-goto`).addEventListener('click', () => { msgUi.status('עובר לדף ההודעות…'); location.href = (typeof location !== 'undefined' ? location.origin : '') + MESSAGES_PAGE_PATH; });
    return;
  }
  const panel = $el('tt-panel');
  if (panel) panel.classList.add('tt-panel-wide'); // טבלת הסקירה רחבה; בדף ההודעות זו הלשונית היחידה
  container.innerHTML = `
    <div id="${MP}-modes"><div class="tt-row">
      ${buttonHtml({ id: `${MP}-mode-table`, label: 'סקירה', kind: 'primary' })}
      ${buttonHtml({ id: `${MP}-mode-bulk`, label: 'מצב גורף', kind: 'ghost' })}
    </div></div>
    <div id="${MP}-bulk" hidden>
      <div class="tt-box tt-box-warn">
        עובר על <b>כל ההודעות</b> במצב "נשלחה", בכל העמודים, בלי סקירה:
        <ul>
          <li>"${esc(MESSAGES_TRANSFER_HEADER)}" (מוסד אחר מבקש תלמיד שלנו): <b>אישור מעבר</b></li>
          <li>כל הודעה אחרת (כולל "${esc(MESSAGES_TRANSFER_DONE_HEADER)}" שרק מודיעה על מעבר): <b>שנה מצב הודעה לטופל</b></li>
        </ul>
        "דחיית מעבר" לא נלחץ אוטומטית. לדחייה או להצלבה מול המצבת השתמש ב"סקירה".
      </div>
      ${buttonsRowHtml([{ id: `${MP}-bulk-run`, label: 'הפעל מצב גורף', kind: 'primary' }])}
    </div>
    <div id="${MP}-table">
      <section class="tt-zone" id="${MP}-zone-scan">
        <div class="tt-zone-head"><b>סריקה</b><span class="tt-zone-note" id="${MP}-scan-status">לא בוצעה סריקה.</span></div>
        <p class="tt-zone-lead">"סרוק" אוסף את כל ההודעות הפתוחות לטבלה אחת, ואחר כך בוחרים מה לעשות בכל שורה.</p>
        <details class="tt-section"><summary>איך זה עובד, בפירוט</summary><div class="tt-box tt-box-info">
          כפילויות של אותה הודעה מתמזגות לשורה אחת, והביצוע מטפל בכולן.
          ברירת-המחדל בעמודת "החלטה": בקשת מעבר (מוסד אחר מבקש תלמיד שלנו) מקבלת "אישור מעבר", וכל הודעה אחרת "טופל". "דלג" לא נוגע בהודעה.
          כשהסינון המהיר פעיל, "בצע לפי הטבלה" מבצע רק את השורות המוצגות.
          מצבת שמדביקים מאקסל מסמנת כל בקשת מעבר: "ממתין" כשהתלמיד עדיין במצבת (לאשר או לדחות), "כנראה בוצע" כשאינו במצבת.
          הסימון הוא רמז בלבד וההחלטה לא משתנה מעצמה; הכפתור "כל 'כנראה בוצע': סמן כטופל" מחיל אותה.
        </div></details>
        ${buttonsRowHtml([{ id: `${MP}-scan`, label: 'סרוק', kind: 'primary' }])}
        <div id="${MP}-roster-slot-scan">
          <details class="tt-section" id="${MP}-roster">
            <summary id="${MP}-roster-summary">מצבת להצלבה (הדבקה מאקסל: סניף, ת.ז./דרכון)</summary>
            <textarea id="${MP}-roster-input" class="tt-textarea tt-textarea-sm" placeholder="סניף&#9;ת.ז./דרכון&#10;16&#9;012345678"></textarea>
            <div class="tt-row tt-row-wrap tt-row-tight">
              ${buttonHtml({ id: `${MP}-roster-load`, label: 'טען מצבת', kind: 'primary', size: 'small' })}
              ${buttonHtml({ id: `${MP}-roster-xlsx`, label: 'טען קובץ אקסל', kind: 'ghost', size: 'small', title: 'הגיליון הראשון בקובץ נטען כמצבת' })}
              ${buttonHtml({ id: `${MP}-roster-clear`, label: 'נקה מצבת', kind: 'subtle', size: 'small', title: 'מוחק את המצבת ואת ההצלבה. לחיצה שנייה מאשרת' })}
            </div>
            <input id="${MP}-roster-file" type="file" accept=".xlsx,.xls" hidden>
            <div id="${MP}-roster-status" class="tt-hint">אין מצבת טעונה.</div>
          </details>
        </div>
      </section>
      <section class="tt-zone" id="${MP}-zone-review" hidden>
        <div class="tt-zone-head"><b>סקירה</b><span class="tt-zone-note" id="${MP}-zone-review-note"></span></div>
        <p class="tt-zone-lead">בכל שורה בוחרים בעמודת "החלטה" מה לעשות, ואז "בצע לפי הטבלה". לחיצה על גוף ההודעה פותחת את הנוסח המלא.</p>
        <div id="${MP}-roster-slot-review"></div>
        <div class="tt-row tt-review-tools">
          <input id="${MP}-filter" class="tt-input tt-filter" type="search" placeholder="סינון מהיר: ת.ז. / נושא / גוף">
          ${buttonHtml({ id: `${MP}-all-transfers`, label: 'כל בקשות המעבר: אישור', kind: 'ghost', size: 'small', disabled: true, title: 'על השורות המוצגות' })}
          ${buttonHtml({ id: `${MP}-all-others`, label: 'כל השאר: טופל', kind: 'ghost', size: 'small', disabled: true, title: 'על השורות המוצגות' })}
          ${buttonHtml({ id: `${MP}-all-done`, label: "כל 'כנראה בוצע': סמן כטופל", kind: 'ghost', size: 'small', disabled: true, title: 'על השורות המוצגות שמסומנות "כנראה בוצע" לפי המצבת (בקשת-מעבר על תלמיד שאינו במצבת)' })}
          ${buttonHtml({ id: `${MP}-all-skip`, label: 'הכל: דלג', kind: 'ghost', size: 'small', disabled: true, title: 'על השורות המוצגות' })}
        </div>
        <div id="${MP}-scanned" class="tt-scroll tt-scroll-tall"></div>
        <div id="${MP}-summary" class="tt-summary"></div>
        <div class="tt-row tt-row-wrap">
          ${buttonHtml({ id: `${MP}-run-review`, label: 'בצע לפי הטבלה', kind: 'primary', disabled: true })}
          ${buttonHtml({ id: `${MP}-clear-table`, label: 'נקה טבלה', kind: 'subtle', size: 'small', disabled: true, title: 'מרוקן את הטבלה וחוזר לסריקה. לחיצה שנייה מאשרת' })}
        </div>
        <details class="tt-section" id="${MP}-excel">
          <summary id="${MP}-excel-summary">דרך אקסל (אופציה): העתק / הורד, ערוך, הדבק, טען, בצע</summary>
          <div class="tt-hint">ערוך באקסל את עמודת "פעולה" (${esc(MESSAGES_ALL_ACTIONS.join(' / '))}), הדבק כאן, "טען" ואז "בצע". אל תשנה את עמודת UID.</div>
          ${buttonsRowHtml([
            { id: `${MP}-copy-tsv`, label: 'העתק לאקסל', kind: 'ghost', size: 'small' },
            { id: `${MP}-xlsx`, label: 'הורד אקסל', kind: 'ghost', size: 'small' },
          ])}
          <textarea id="${MP}-input" class="tt-textarea" placeholder="UID&#9;נושא&#9;ת.ז./דרכון&#9;תאריך&#9;גוף ההודעה&#9;פעולה"></textarea>
          ${buttonsRowHtml([
            { id: `${MP}-load`, label: 'טען', kind: 'ghost', size: 'small' },
            { id: `${MP}-run-table`, label: 'בצע', kind: 'primary', size: 'small', disabled: true },
          ])}
          <div id="${MP}-load-status" class="tt-hint">טבלה לא טעונה.</div>
        </details>
      </section>
    </div>
    <div class="tt-runline" id="${MP}-zone-run" hidden><span class="tt-runtext" id="${MP}-runtext"></span>${buttonHtml({ id: `${MP}-stop`, label: 'עצור', kind: 'stop', title: 'גם מקש Escape עוצר' })}</div>
    <section class="tt-zone" id="${MP}-zone-out" hidden>
      <div class="tt-zone-head"><b>תוצאות</b><span class="tt-zone-note" id="${MP}-zone-out-note"></span>
        <div id="${MP}-out-actions" hidden><div class="tt-row tt-row-wrap tt-row-tight">
          ${buttonHtml({ id: `${MP}-new-scan`, label: 'סריקה חדשה', kind: 'primary', size: 'small', title: 'מנקה את התוצאות ואת הטבלה וחוזר לסריקה. לחיצה שנייה מאשרת' })}
          ${buttonHtml({ id: `${MP}-copy-report`, label: 'העתק דוח', kind: 'ghost', size: 'small', disabled: true, title: 'מכיל מזהים מלאים: לא להדביק בצ\'אט או בדיווח-באג' })}
        </div></div>
      </div>
      <p class="tt-zone-lead">מה קרה לכל הודעה. מתחת להודעה שנכשלה כתוב מה לעשות.</p>
      <div id="${MP}-report" class="tt-box tt-box-warn" hidden></div>
      <div id="${MP}-results" class="tt-scroll"></div>
    </section>`;

  $el(`${MP}-mode-bulk`).addEventListener('click', () => messagesSetMode('bulk'));
  $el(`${MP}-mode-table`).addEventListener('click', () => messagesSetMode('table'));
  $el(`${MP}-bulk-run`).addEventListener('click', () => messagesGuardRun(messagesRunBulk, 'מצב גורף'));
  $el(`${MP}-scan`).addEventListener('click', () => messagesGuardRun(messagesScan, 'הסריקה'));
  $el(`${MP}-roster-load`).addEventListener('click', () => messagesLoadRoster(''));
  $el(`${MP}-roster-xlsx`).addEventListener('click', () => $el(`${MP}-roster-file`).click());
  $el(`${MP}-roster-file`).addEventListener('change', messagesRosterXlsx);
  $el(`${MP}-filter`).addEventListener('input', messagesApplyFilter);
  $el(`${MP}-scanned`).addEventListener('click', messagesOnReviewClick);
  $el(`${MP}-all-transfers`).addEventListener('click', () => messagesBulkDecide((r) => (r.header === MESSAGES_TRANSFER_HEADER ? MESSAGES_ACTION.APPROVE : null), 'כל בקשות המעבר: אישור'));
  $el(`${MP}-all-others`).addEventListener('click', () => messagesBulkDecide((r) => (r.header !== MESSAGES_TRANSFER_HEADER ? MESSAGES_ACTION.HANDLED : null), 'כל השאר: טופל'));
  $el(`${MP}-all-done`).addEventListener('click', () => messagesBulkDecide((r) => (r.probablyDone ? MESSAGES_ACTION.HANDLED : null), "כל 'כנראה בוצע': סמן כטופל"));
  $el(`${MP}-all-skip`).addEventListener('click', () => messagesBulkDecide(() => MESSAGES_ACTION.SKIP, 'הכל: דלג'));
  $el(`${MP}-run-review`).addEventListener('click', messagesRunReview);
  $el(`${MP}-copy-tsv`).addEventListener('click', messagesCopyTsv);
  $el(`${MP}-xlsx`).addEventListener('click', messagesDownload);
  $el(`${MP}-load`).addEventListener('click', messagesLoadTable);
  $el(`${MP}-run-table`).addEventListener('click', () => messagesGuardRun(() => messagesRunTable(msgPending), 'הביצוע לפי טבלה'));
  $el(`${MP}-stop`).addEventListener('click', messagesStop, true);
  $el(`${MP}-copy-report`).addEventListener('click', messagesCopyReport);
  // מה שמוחק דורש לחיצה שנייה (הנוסח השני מתחיל ב"לחץ שוב ל…"; בלי לחיצה שנייה חוזר אחרי 6 שניות)
  bindConfirmClick(`${MP}-roster-clear`, { label: 'נקה מצבת', confirmLabel: 'לחץ שוב לניקוי המצבת', onConfirm: messagesClearRoster });
  bindConfirmClick(`${MP}-clear-table`, { label: 'נקה טבלה', confirmLabel: 'לחץ שוב לניקוי הטבלה', onConfirm: messagesClearTable });
  bindConfirmClick(`${MP}-new-scan`, { label: 'סריקה חדשה', confirmLabel: 'לחץ שוב לסריקה חדשה', onConfirm: messagesNewScan });

  messagesSetHooks({
    onStart: (mode) => {
      if (mode !== 'scan') { msgResults = []; msgReport = null; messagesRenderResults(); messagesRenderReport(null); }
      messagesSetRunning(true);
      messagesSetRunText(messagesRunText({ mode }));
      if (mode === 'scan') msgUi.step(0); else messagesSetStage('run');
      msgUi.progress(0, 0);
      msgUi.status(mode === 'scan' ? 'סורק…' : mode === 'bulk' ? 'מצב גורף רץ…' : 'מבצע לפי הטבלה…');
    },
    onStatus: (msg) => msgUi.status(msg),
    onProgress: (cur, total) => { msgUi.progress(cur, total); messagesSetRunText(messagesRunText({ mode: 'table', cur, total })); },
    onResult: (row, all) => {
      msgResults = all;
      messagesRenderResults();
      if (msgMode === 'bulk') messagesSetRunText(messagesRunText({ mode: 'bulk', cur: all.length }));
    },
    onScanProgress: (list, pages, total) => {
      messagesSetScanStatus(`סריקה: ${pages} עמודים, ${total} הודעות עד כה…`);
      messagesSetRunText(messagesRunText({ mode: 'scan', pages, total }));
    },
    onScanDone: (list, info) => {
      msgScanned = list;
      msgDecisions = new Map(); // סריקה חדשה: ההחלטות מתחילות מההצעות
      msgExpanded = new Set();
      messagesRebuildRows();
      const merged = msgRows.length;
      messagesSetScanStatus(`✓ נסרקו ${info.total} הודעות מ-${info.pages} עמודים${merged < info.total ? ` (${merged} שורות אחרי מיזוג כפילויות)` : ''}${info.stopped ? ' (נעצר)' : ''}.`);
      messagesSetRunning(false);
      messagesSetStage(merged ? 'review' : 'scan');
      const done = msgRows.filter((r) => r.probablyDone).length;
      msgUi.status(merged
        ? `${merged} שורות לסקירה. עבור על עמודת "החלטה" ואז "בצע לפי הטבלה"${done ? ` (${MESSAGES_DONE_HINT(done)})` : ''}`
        : 'לא נמצאו הודעות במצב "נשלחה"');
    },
    onDone: (rows, report) => {
      msgResults = rows;
      msgReport = report;
      messagesRenderResults();
      messagesRenderReport(report);
      messagesSetRunning(false);
      messagesSetStage('results');
      msgUi.progress(0, 0);
      msgUi.status(`${report.stopped ? 'נעצר' : 'הסתיים'}. ${report.summary}${report.lines.length ? ' (ראה "מה נשאר")' : ''}. לסבב נוסף: "סריקה חדשה"`);
    },
  });

  msgScanned = messagesGetScanned();
  msgResults = messagesGetReportRows();
  messagesRenderResults();
  messagesRebuildRows();
  log('[הודעות] דף ההודעות זוהה');
  if (messagesIsRunning()) {
    // טעינת-דף באמצע ריצה (לא צפויה בדף ההודעות, שעובד ב-postback): נוחתים באותו שלב-ריצה
    messagesSetMode(msgMode);
    messagesSetRunning(true);
    messagesSetStage('run');
    msgUi.status('ריצה פעילה…');
    return;
  }
  msgStage = messagesIdleStage();
  messagesSetMode(msgMode);
  msgUi.status('מוכן. "סרוק" אוסף את כל ההודעות הפתוחות לטבלה אחת');
}

export const messagesTool = {
  id: 'messages',
  title: 'הודעות',
  pages: ['*'], // הכרעה ח (1.11.2026): בכל דף; מחוץ לדף ההודעות הלשונית מציעה לעבור אליו. דף הכניסה מסונן ב-main.
  fits: (page) => messagesIsMessagesUrl((page && page.url) || (typeof location !== 'undefined' ? location.href : '')),
  steps: MESSAGES_STEPS,
  hasPendingRun: () => false,
  isRunning: messagesIsRunning,
  onStop: messagesStop,
  mount: messagesMount,
};
