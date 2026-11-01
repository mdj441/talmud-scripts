// לשונית "הודעות" בחלונית המאוחדת. הזרימה ב-messages.js; כאן רק הממשק. שני מצבים:
// "סקירה" (ברירת-המחדל): סרוק → טבלת-סקירה בתוך החלונית (כפילויות ממוזגות, החלטה לכל שורה, הצלבה
// מול מצבת מודבקת, פעולות-צובר, סינון) → "בצע לפי הטבלה". מסלול האקסל (העתק/הורד/הדבק/טען/בצע)
// נשאר כאופציה מתקפלת. "מצב גורף": כמו קודם. טבלת-תוצאות, דוח "מה נשאר", "העתק דוח".
// הלשונית מופיעה בדפי 'other' (getPage לא מכיר את דף ההודעות); ב-mount בודקים את הכתובת.
// אין גישה ל-document ברמת המודול.

import { $el } from '../core/dom.js';
import { log } from '../core/log.js';
import { copyTextToClipboard } from '../core/csv.js';
import { esc, buttonHtml, buttonsRowHtml, selectHtml, resultsTableHtml, reportBoxHtml, fitBoxHtml, flash, setHtml, setText, show, setDisabled } from '../ui/widgets.js';
import {
  MESSAGES_ACTION, MESSAGES_ALL_ACTIONS, MESSAGES_RESULT, MESSAGES_TRANSFER_HEADER, MESSAGES_TRANSFER_DONE_HEADER,
  messagesIsMessagesUrl, messagesParseTable, messagesLoadSummary, messagesBuildTsv,
  messagesBuildReportTsv, messagesDownloadXlsx, messagesSetHooks, messagesIsRunning, messagesRequestStop, messagesRunBulk,
  messagesScan, messagesRunTable, messagesGetScanned, messagesGetReportRows,
  messagesMergeDuplicates, messagesParseRoster, messagesCrossCheck, messagesRowDecision, messagesDecisionCounts,
  messagesReviewEntries, messagesRowMatchesFilter, messagesShorten,
} from './messages.js';

const MP = 'tt-messages';
export const MESSAGES_STEPS = ['סריקה', 'סקירה', 'ביצוע', 'תוצאות'];
const MESSAGES_PAGE_PATH = '/Association/Default.aspx';
let msgUi = null;
let msgMode = 'table';
let msgPending = []; // מסלול האקסל: הרשומות שנטענו מהטקסט המודבק
let msgResults = [];
let msgRows = []; // טבלת הסקירה: שורות ממוזגות (אחרי הצלבה)
let msgDecisions = new Map(); // key של שורה → פעולה שנבחרה (ריק = ההצעה)
let msgRoster = null; // המצבת המודבקת (messagesParseRoster) או null

const MESSAGES_BODY_MAX = 70;

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

function messagesRowHtml(r, i) {
  const decision = messagesRowDecision(r, msgDecisions);
  const dates = r.dates && r.dates.length > 1 ? r.dates.join(', ') : '';
  const roster = r.rosterLabel ? `${esc(r.rosterLabel)}${messagesRosterTagHtml(r)}` : '';
  const uidsTitle = `UID: ${r.uids.join(', ')}`;
  return `<tr class="tt-review-row${r.probablyDone ? ' tt-r-done' : ''}" data-key="${esc(r.key)}" data-uid="${esc(r.uid)}" data-uids="${esc(r.uids.join(','))}" title="${esc(uidsTitle)}">
    <td class="tt-mono">${esc(r.personId)}</td>
    <td>${esc(r.header)}</td>
    <td class="tt-body-cell" title="${esc(r.body)}">${esc(messagesShorten(r.body, MESSAGES_BODY_MAX))}</td>
    <td class="tt-center"${dates ? ` title="${esc(dates)}"` : ''}>${esc(r.date)}${dates ? ` <span class="tt-muted">+${r.dates.length - 1}</span>` : ''}</td>
    <td class="tt-center tt-count-cell">${r.count > 1 ? `<span class="tt-tag tt-tag-count" title="${esc(`${r.count} הודעות מוזגו לשורה הזו`)}">${r.count}</span>` : '1'}</td>
    <td class="tt-roster-cell">${roster}</td>
    <td>${selectHtml({ id: `${MP}-decision-${i}`, options: MESSAGES_ALL_ACTIONS, value: decision, cls: 'tt-decision' })}</td>
  </tr>`;
}

function messagesRenderReview() {
  const box = $el(`${MP}-scanned`);
  if (!box) return;
  if (!msgRows.length) { box.innerHTML = ''; messagesRenderSummary(); messagesSetReviewEnabled(); return; }
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

function messagesApplyFilter() {
  const box = $el(`${MP}-scanned`);
  if (!box) return;
  const byKey = new Map(msgRows.map((r) => [r.key, r]));
  const q = messagesFilterText();
  box.querySelectorAll('tr.tt-review-row').forEach((tr) => {
    const r = byKey.get(tr.getAttribute('data-key'));
    tr.hidden = !(r && messagesRowMatchesFilter(r, q));
  });
  messagesRenderSummary();
}

function messagesSetReviewEnabled() {
  const on = msgRows.length > 0 && !messagesIsRunning();
  for (const id of ['run-review', 'all-transfers', 'all-others', 'all-done', 'all-skip']) setDisabled(`${MP}-${id}`, !on);
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
  const merged = messagesMergeDuplicates(messagesGetScanned());
  msgRows = messagesCrossCheck(merged, msgRoster);
  // ממצא ב-10: "כנראה בוצע" הוא רמז לבדיקה; ההחלטה שנבחרה נשמרת, ורק הכפתור "כל 'כנראה בוצע': סמן כטופל" מחיל
  const keep = new Map();
  for (const r of msgRows) if (msgDecisions.has(r.key)) keep.set(r.key, msgDecisions.get(r.key));
  msgDecisions = keep;
  messagesRenderReview();
}

const MESSAGES_DONE_HINT = (n) => `${n} בקשות-מעבר על תלמידים שאינם במצבת מסומנות "כנראה בוצע" (רמז לבדיקה; "כל 'כנראה בוצע': סמן כטופל" מחיל)`;

function messagesLoadRoster() {
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
  const txt = `✓ נטענה מצבת: ${parsed.count} שורות${parsed.ignored ? ` (${parsed.ignored} שורות בלי ת.ז. דולגו)` : ''}`;
  setText(`${MP}-roster-status`, txt);
  log(`[הודעות] ${txt}`);
  messagesRebuildRows();
  const done = msgRows.filter((r) => r.probablyDone).length;
  const pending = msgRows.filter((r) => r.pending).length;
  msgUi.status(msgRows.length ? `${txt}. ${done ? MESSAGES_DONE_HINT(done) : 'אין בקשות-מעבר על תלמידים שאינם במצבת'}${pending ? `; ${pending} ממתינות לאישור או לדחייה` : ''}` : `${txt}. לחץ "סרוק" כדי להצליב`);
}

function messagesClearRoster() {
  msgRoster = null;
  const ta = $el(`${MP}-roster-input`);
  if (ta) ta.value = '';
  setText(`${MP}-roster-status`, 'אין מצבת טעונה.');
  messagesRebuildRows();
  msgUi.status('המצבת נוקתה');
}

function messagesRunReview() {
  const entries = messagesReviewEntries(msgRows, msgDecisions);
  if (!entries.length) { msgUi.status('אין טבלה. לחץ "סרוק" קודם'); return; }
  const c = messagesDecisionCounts(msgRows, msgDecisions);
  log(`[הודעות] בצע לפי הטבלה: ${msgRows.length} שורות (${entries.length} הודעות): אישור=${c.approve}, דחיה=${c.decline}, טופל=${c.handled}, דילוג=${c.skip}`);
  messagesGuardRun(() => messagesRunTable(entries), 'הביצוע לפי הטבלה');
}

// ─── שאר הממשק ──────────────────────────────────────────────────────────────

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
  for (const id of ['bulk-run', 'scan', 'load', 'run-table', 'roster-load']) setDisabled(`${MP}-${id}`, !!on);
  if (!on) setDisabled(`${MP}-run-table`, !msgPending.length);
  messagesSetReviewEnabled();
  msgUi.running(!!on);
}

function messagesSetMode(mode) {
  msgMode = mode === 'bulk' ? 'bulk' : 'table';
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
    const det = $el(`${MP}-excel`);
    if (det) det.open = true;
    messagesSetMode('table');
    msgUi.status('ההעתקה נחסמה בדפדפן. הדוח הוצג בתיבת הטקסט (אזור האקסל) להעתקה ידנית');
  });
}

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
    <div class="tt-row">
      ${buttonHtml({ id: `${MP}-mode-table`, label: 'סקירה', kind: 'primary' })}
      ${buttonHtml({ id: `${MP}-mode-bulk`, label: 'מצב גורף', kind: 'ghost' })}
    </div>
    <div id="${MP}-bulk" hidden>
      <div class="tt-box tt-box-warn">
        עובר על <b>כל ההודעות</b> במצב "נשלחה", בכל העמודים, בלי סקירה:
        <ul>
          <li>"${esc(MESSAGES_TRANSFER_HEADER)}" (מוסד אחר מבקש תלמיד שלנו): <b>אישור מעבר</b></li>
          <li>כל הודעה אחרת (כולל "${esc(MESSAGES_TRANSFER_DONE_HEADER)}" האינפורמטיבית): <b>שנה מצב הודעה לטופל</b></li>
        </ul>
        "דחיית מעבר" לא נלחץ אוטומטית. לדחייה או להצלבה מול המצבת השתמש ב"סקירה".
      </div>
      ${buttonsRowHtml([{ id: `${MP}-bulk-run`, label: 'הפעל מצב גורף', kind: 'primary' }])}
    </div>
    <div id="${MP}-table">
      <p class="tt-zone-lead">"סרוק" אוסף את כל ההודעות הפתוחות לטבלה אחת. בוחרים החלטה לכל שורה, ואז "בצע לפי הטבלה".</p>
      <details class="tt-section"><summary>איך זה עובד, בפירוט</summary><div class="tt-box tt-box-info">
        כפילויות ממוזגות לשורה אחת. ברירת-המחדל להחלטה: בקשת מעבר (מוסד אחר מבקש תלמיד שלנו) → אישור מעבר; כל הודעה אחרת → טופל.
        "דלג" לא נוגע בהודעה. הדבקת מצבת מאקסל מסמנת על כל בקשת-מעבר: "ממתין" כשהתלמיד עדיין במצבת (לאשר או לדחות),
        "כנראה בוצע" כשאינו במצבת. זה רמז לבדיקה, ההחלטה לא משתנה מעצמה; "כל 'כנראה בוצע': סמן כטופל" מחיל אותה.
      </div></details>
      ${buttonsRowHtml([{ id: `${MP}-scan`, label: 'סרוק', kind: 'primary' }])}
      <div id="${MP}-scan-status" class="tt-hint">לא בוצעה סריקה.</div>
      <details class="tt-section" id="${MP}-roster">
        <summary id="${MP}-roster-summary">מצבת להצלבה (הדבקה מאקסל: סניף, ת.ז./דרכון)</summary>
        <textarea id="${MP}-roster-input" class="tt-textarea tt-textarea-sm" placeholder="סניף&#9;ת.ז./דרכון&#10;16&#9;012345678"></textarea>
        ${buttonsRowHtml([
          { id: `${MP}-roster-load`, label: 'טען מצבת', kind: 'primary', size: 'small' },
          { id: `${MP}-roster-clear`, label: 'נקה מצבת', kind: 'subtle', size: 'small' },
        ])}
        <div id="${MP}-roster-status" class="tt-hint">אין מצבת טעונה.</div>
      </details>
      <div class="tt-row tt-review-tools">
        <input id="${MP}-filter" class="tt-input tt-filter" type="search" placeholder="סינון מהיר: ת.ז. / נושא / גוף">
        ${buttonHtml({ id: `${MP}-all-transfers`, label: 'כל בקשות המעבר: אישור', kind: 'ghost', size: 'small', disabled: true, title: 'על השורות המוצגות' })}
        ${buttonHtml({ id: `${MP}-all-others`, label: 'כל השאר: טופל', kind: 'ghost', size: 'small', disabled: true, title: 'על השורות המוצגות' })}
        ${buttonHtml({ id: `${MP}-all-done`, label: "כל 'כנראה בוצע': סמן כטופל", kind: 'ghost', size: 'small', disabled: true, title: 'על השורות המוצגות שמסומנות "כנראה בוצע" לפי המצבת (בקשת-מעבר על תלמיד שאינו במצבת)' })}
        ${buttonHtml({ id: `${MP}-all-skip`, label: 'הכל: דלג', kind: 'ghost', size: 'small', disabled: true, title: 'על השורות המוצגות' })}
      </div>
      <div id="${MP}-scanned" class="tt-scroll tt-scroll-tall"></div>
      <div id="${MP}-summary" class="tt-summary"></div>
      ${buttonsRowHtml([{ id: `${MP}-run-review`, label: 'בצע לפי הטבלה', kind: 'primary', disabled: true }])}
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
    </div>
    ${buttonsRowHtml([
      { id: `${MP}-stop`, label: 'עצור', kind: 'stop', title: 'גם מקש Escape עוצר' },
      { id: `${MP}-copy-report`, label: 'העתק דוח', kind: 'ghost', size: 'small' },
    ])}
    <div id="${MP}-results" class="tt-scroll"></div>
    <div id="${MP}-report" class="tt-box tt-box-warn" hidden></div>`;

  $el(`${MP}-mode-bulk`).addEventListener('click', () => messagesSetMode('bulk'));
  $el(`${MP}-mode-table`).addEventListener('click', () => messagesSetMode('table'));
  $el(`${MP}-bulk-run`).addEventListener('click', () => messagesGuardRun(messagesRunBulk, 'מצב גורף'));
  $el(`${MP}-scan`).addEventListener('click', () => messagesGuardRun(messagesScan, 'הסריקה'));
  $el(`${MP}-roster-load`).addEventListener('click', messagesLoadRoster);
  $el(`${MP}-roster-clear`).addEventListener('click', messagesClearRoster);
  $el(`${MP}-filter`).addEventListener('input', messagesApplyFilter);
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

  messagesSetHooks({
    onStart: (mode) => {
      messagesSetRunning(true);
      msgUi.step(mode === 'scan' ? 0 : 2);
      if (mode !== 'scan') { msgResults = []; messagesRenderResults(); messagesRenderReport(null); }
      msgUi.progress(0, 0);
      msgUi.status(mode === 'scan' ? 'סורק…' : mode === 'bulk' ? 'מצב גורף רץ…' : 'מבצע לפי הטבלה…');
    },
    onStatus: (msg) => msgUi.status(msg),
    onProgress: (cur, total) => msgUi.progress(cur, total),
    onResult: (row, all) => { msgResults = all; messagesRenderResults(); },
    onScanProgress: (list, pages, total) => setText(`${MP}-scan-status`, `סריקה: ${pages} עמודים, ${total} הודעות עד כה…`),
    onScanDone: (list, info) => {
      msgDecisions = new Map(); // סריקה חדשה: ההחלטות מתחילות מההצעות
      messagesRebuildRows();
      const merged = msgRows.length;
      setText(`${MP}-scan-status`, `✓ נסרקו ${info.total} הודעות מ-${info.pages} עמודים${merged < info.total ? ` (${merged} שורות אחרי מיזוג כפילויות)` : ''}${info.stopped ? ' (נעצר)' : ''}.`);
      messagesSetRunning(false);
      msgUi.step(merged ? 1 : 0);
      const done = msgRows.filter((r) => r.probablyDone).length;
      msgUi.status(merged
        ? `${merged} שורות לסקירה. עבור על עמודת "החלטה" ואז "בצע לפי הטבלה"${done ? ` (${MESSAGES_DONE_HINT(done)})` : ''}`
        : 'לא נמצאו הודעות במצב "נשלחה"');
    },
    onDone: (rows, report) => {
      msgResults = rows;
      messagesRenderResults();
      messagesRenderReport(report);
      messagesSetRunning(false);
      msgUi.step(3);
      msgUi.progress(0, 0);
      msgUi.status(`${report.stopped ? 'נעצר' : 'הסתיים'}. ${report.summary}${report.lines.length ? ' (ראה "מה נשאר")' : ''}. סרוק שוב לרענון הטבלה`);
    },
  });

  messagesSetMode(msgMode);
  msgResults = messagesGetReportRows();
  messagesRenderResults();
  messagesRebuildRows();
  log('[הודעות] דף ההודעות זוהה');
  msgUi.step(msgRows.length ? 1 : 0);
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
