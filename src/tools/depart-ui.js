// לשונית "עזיבת תלמידים" בחלונית המאוחדת. הזרימה עצמה ב-depart.js; כאן רק הממשק (שכבת-הבהירות, סבב 3, 1.11.2026):
// אותו מבנה כמו בקליטה: טבלת-הזנה משותפת (ui/grid.js; עמודות סניף ומספר), ארבעה שלבים שמחליפים את המסך
// (הכנה → ריצה → תוצאות → תיקון והרצה חוזרת), תגיות שמסננות, "מה לעשות" מתחת לכל שורה, "תקן והרץ שוב", "עזיבה חדשה".
// כל השמות ברמה-עליונה בקידומת depart (סקופ משותף בבאנדל). אין גישה ל-document ברמת המודול.

import { $el } from '../core/dom.js';
import { log } from '../core/log.js';
import { downloadCsv, copyTextToClipboard } from '../core/csv.js';
import { isValidIsraeliId } from '../core/identity.js';
import { readBranchesFromTree } from '../core/navigate.js';
import {
  DEPART_REASONS, DEPART_DEFAULT_REASON, DEPART_STATUS, parseDepartInput, buildDepartTsv, buildDepartCsvRows,
  isDepartSuccess, departStatusKey, departIsValidDate,
  departSetHooks, departStartRun, departResumeIfPending, departStop, departHasSavedQueue, departIsRunning,
  departGetResults, departSavedQueueInfo, departDiscardSavedQueue,
} from './depart.js';
import { esc, buttonHtml, buttonsRowHtml, fieldHtml, selectHtml, resultsTableHtml, zoneHtml, tagHtml, dateFieldHtml, bindDateFields, bindConfirmClick, flash, setHtml, setText, show, setDisabled, bindDateMask, todayDMY } from '../ui/widgets.js';
import { createGrid, gridSortRows } from '../ui/grid.js';
import { loadXlsxFile } from './absorb-xlsx.js';

const DEPART_P = 'tt-depart';
export const DEPART_STEPS = ['הכנה', 'ריצה', 'תוצאות', 'תיקון והרצה חוזרת'];
const DEPART_STAGE_INDEX = { prep: 0, run: 1, results: 2, fix: 3 };
let departUi = null;
let departPage = null;
let departGrid = null;
let departStage = 'prep';
let departAwaitingErrorConfirm = false;
let departResults = [];
let departTotal = 0;
let departResFilter = 'all';
let departResSort = null;
let departStageBeforeRun = 'prep';
let departAwaitingErrorFilter = 'all';

const DEPART_COLUMNS = [
  { key: 'branch', label: 'סניף', center: true, width: '44px' },
  { key: 'identity', label: 'מספר', mono: true },
  { key: 'status', label: 'מה קרה' },
];

function departClassify(r) {
  if (isDepartSuccess(r.status)) return 'ok';
  const key = departStatusKey(r.status);
  if (key === DEPART_STATUS.STOPPED || key === DEPART_STATUS.SKIPPED || key === DEPART_STATUS.NOT_FOUND) return 'warn';
  return 'bad';
}
function departGroup(r) {
  if (isDepartSuccess(r.status)) return 'ok';
  const key = departStatusKey(r.status);
  if (key === DEPART_STATUS.STOPPED || key === DEPART_STATUS.SKIPPED) return 'stopped';
  return departClassify(r) === 'warn' ? 'verify' : 'bad';
}
function departPlural(n, one, many) { return n === 1 ? one : many.replace('N', String(n)); }
function departNewRow() { return { fields: { branch: '', identifier: '' } }; }
function departRowFrom(f) { return { fields: { branch: String(f.branch || ''), identifier: String(f.identifier || '') } }; }
function departRowsToText(rows) { return ['סניף\tת.ז.'].concat(rows.map((r) => `${String(r.fields.branch || '').trim()}\t${String(r.fields.identifier || '').trim()}`)).join('\n'); }

// טקסט (הדבקה / קובץ) → שורות-טבלה: סניף ות.ז., עם כותרת או בלי, טאבים / פסיקים / רווחים
export function departTextToRows(text) {
  const lines = String(text || '').split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const out = [];
  lines.forEach((line, i) => {
    const cells = line.includes('\t') ? line.split('\t') : (line.includes(',') ? line.split(',') : line.split(/\s+/));
    const c = cells.map((x) => x.trim());
    if (i === 0 && c[0] && !/^\d+$/.test(c[0]) && /סניף|ת\.?ז|מספר|מזהה|דרכון/.test(line)) return; // כותרת
    out.push(departRowFrom({ branch: c[0] || '', identifier: c[1] || '' }));
  });
  return out;
}

// הודעת-פרסור → נוסח לשורה
export function departFriendlyError(reason, f) {
  const s = String(reason || '');
  if (/חסרים שדות חובה/.test(s)) { const miss = []; if (!String(f.branch || '').trim()) miss.push('סניף'); if (!String(f.identifier || '').trim()) miss.push('מספר'); return `חסר: ${miss.join(', ') || 'סניף או מספר'}`; }
  if (/סניף לא תקין/.test(s)) return 'מספר סניף לא תקין. בחר סניף מהרשימה';
  if (/חסרה ת\.ז\./.test(s)) return 'חסר: מספר';
  if (/ת\.ז\. לא תקינה/.test(s)) return 'מספר לא תקין (ת.ז. 5 עד 9 ספרות, או דרכון באותיות וספרות)';
  return s;
}

// לכל שורה מלאה: {level, msg}; ctx: {branches: [..]|null}. אדום = לא ירוץ; צהוב = ירוץ עם אזהרה.
export function departValidateRows(list, ctx) {
  const filled = (list || []).filter((r) => String(r.fields.branch || '').trim() || String(r.fields.identifier || '').trim());
  const parsed = parseDepartInput(departRowsToText(filled));
  const errorByIdx = new Map();
  for (const e of parsed.errors) errorByIdx.set(e.line - 2, e.reason);
  const issues = [];
  const seen = new Map();
  const counts = { all: filled.length, ready: 0, warn: 0, bad: 0 };
  filled.forEach((r, i) => {
    const f = r.fields;
    let level = '';
    let msg = '';
    const err = errorByIdx.get(i);
    if (err) { level = 'bad'; msg = departFriendlyError(err, f); }
    else if (ctx && Array.isArray(ctx.branches) && ctx.branches.length && !ctx.branches.includes(String(f.branch).trim().padStart(2, '0'))) { level = 'bad'; msg = 'סניף לא נמצא ברשימת הסניפים'; }
    if (!level) {
      const id = String(f.identifier || '').replace(/[\s-]/g, '');
      const key = `${String(f.branch).trim().padStart(2, '0')}|${/^\d+$/.test(id) ? id.replace(/^0+/, '') : id.toUpperCase()}`;
      if (seen.has(key)) { level = 'warn'; msg = `כפול של שורה ${seen.get(key) + 1}`; }
      else { seen.set(key, i); if (/^\d+$/.test(id) && !isValidIsraeliId(id)) { level = 'warn'; msg = 'ת.ז. לא תקינה (ספרת ביקורת). בדוק את המספר'; } }
    }
    issues.push({ level, msg });
    counts[level === 'bad' ? 'bad' : (level === 'warn' ? 'warn' : 'ready')]++;
  });
  const tasks = parsed.tasks.filter((t) => { const iss = issues[t.line - 2]; return !(iss && iss.level === 'bad'); });
  return { filled, issues, tasks, counts };
}

function departKnownBranches() {
  const set = new Set(readBranchesFromTree());
  if (departPage && departPage.branch) set.add(departPage.branch);
  return Array.from(set).sort();
}

function departBuildGrid() {
  const branches = departKnownBranches();
  departGrid = createGrid({
    id: DEPART_P,
    inputId: `${DEPART_P}-input`,
    columns: [
      branches.length
        ? { key: 'branch', label: 'סניף', kind: 'select', width: '70px', options: () => [['', '']].concat(branches.map((b) => [b, b])) }
        : { key: 'branch', label: 'סניף', kind: 'input', width: '70px', mono: true, placeholder: 'סניף' },
      { key: 'identifier', label: 'מספר (ת.ז. או דרכון)', kind: 'input', width: '150px', mono: true, placeholder: 'מספר' },
    ],
    fieldKeys: ['branch', 'identifier'],
    newRow: departNewRow,
    fromText: departTextToRows,
    validate: (list) => departValidateRows(list, { branches: branches.length ? branches : null }),
    onCell: () => { if (departAwaitingErrorConfirm) departAwaitingErrorConfirm = false; },
    onChange: (v) => { departRefreshStartButton(); departRefreshStatus(v); },
    onStatus: (msg) => departUi.status(msg),
    onFilled: (label, n) => { const v = departGrid.validation(); log(`[עזיבה] ${label}: ${n} שורות · ${v ? v.counts.bad : 0} לא ירוצו · ${v ? v.counts.warn : 0} אזהרות`); },
    emptyText: (mode) => (mode === 'fix' ? 'אין מי שדורש טיפול.' : 'אין שורות עדיין. מלא שורה (סניף ומספר), הדבק מאקסל או טען קובץ אקסל.'),
  });
}

function departSetStage(s) {
  departStage = s;
  show(`${DEPART_P}-zone-in`, s === 'prep' || s === 'fix');
  show(`${DEPART_P}-zone-run`, s === 'run');
  show(`${DEPART_P}-zone-out`, s === 'run' || s === 'results');
  show(`${DEPART_P}-prep-only`, s === 'prep');
  show(`${DEPART_P}-fix-only`, s === 'fix');
  show(`${DEPART_P}-back`, s === 'fix');
  show(`${DEPART_P}-restart`, s === 'fix');
  show(`${DEPART_P}-clear`, s === 'prep' && departGrid.filled().length > 0);
  show(`${DEPART_P}-out-actions`, s === 'results');
  setText(`${DEPART_P}-zone-in-title`, s === 'fix' ? 'תיקון והרצה חוזרת' : 'על מי מדווחים עזיבה');
  departGrid.setMode(s === 'fix' ? 'fix' : 'prep');
  departUi.step(DEPART_STAGE_INDEX[s] || 0);
}

function departRunnable() { return departValidateRows(departGrid.visibleFilled(), { branches: departKnownBranches().length ? departKnownBranches() : null }); }

function departRefreshStartButton() {
  show(`${DEPART_P}-clear`, departStage === 'prep' && departGrid.filled().length > 0);
  if (departAwaitingErrorConfirm && departGrid.filter() !== departAwaitingErrorFilter) departAwaitingErrorConfirm = false;
  if (departAwaitingErrorConfirm) return;
  const v = departRunnable();
  const n = v.tasks.length;
  const verb = departStage === 'fix' ? 'התחל עזיבה חוזרת' : 'התחל עזיבה';
  setText(`${DEPART_P}-start`, n ? `${verb}: ${departPlural(n, 'תלמיד אחד', 'N תלמידים')}${departGrid.filter() !== 'all' ? ' (המוצגים)' : ''}` : verb);
  // הכרעת 2.11: אין מי שירוץ → הכפתור לא פעיל (כמו בקליטה)
  const idle = n === 0 && !departIsRunning() && departStage !== 'run';
  setDisabled(`${DEPART_P}-start`, idle || departIsRunning() || departStage === 'run');
  const btn = $el(`${DEPART_P}-start`);
  if (btn) btn.title = idle ? (v.filled.length ? 'אין מי שירוץ: תקן את השורות האדומות, או בחר תגית אחרת' : 'אין שורות בטבלה') : '';
}

function departClearTable() {
  departGrid.setRows([]);
  departGrid.setNotes(null);
  departGrid.hidePasteBox();
  departAwaitingErrorConfirm = false;
  departGrid.render();
  departUi.status('הטבלה נוקתה. מלא שורה (סניף ומספר), הדבק מאקסל או טען קובץ אקסל');
  log('[עזיבה] הטבלה נוקתה');
}

function departRefreshStatus(v) {
  departUi.step(DEPART_STAGE_INDEX[departStage] || 0);
  if (departIsRunning() || departStage === 'run' || departStage === 'results') return;
  const all = v.counts.all;
  if (!all) { departUi.status(departStage === 'fix' ? 'אין מי שדורש טיפול. "חזרה לתוצאות" או "רשימה חדשה"' : 'אין שורות עדיין. מלא שורה (סניף ומספר), הדבק מאקסל או טען קובץ אקסל'); return; }
  const filtered = departGrid.filter() !== 'all';
  const rv = filtered ? departRunnable() : v;
  const c = rv.counts;
  const parts = [];
  if (filtered) parts.push(`מוצגים ${c.all} מתוך ${all}`);
  parts.push(departPlural(rv.tasks.length, 'תלמיד אחד מוכן', 'N תלמידים מוכנים'));
  if (c.bad) parts.push(departPlural(c.bad, 'שורה אחת לא תרוץ (אדום)', 'N שורות לא ירוצו (אדום)'));
  if (c.warn) parts.push(departPlural(c.warn, 'אזהרה אחת (צהוב)', 'N אזהרות (צהוב)'));
  departUi.status((departStage === 'fix' ? 'תיקון: ' : '') + parts.join(' · '));
}

// ─── תוצאות ───────────────────────────────────────────────────────────────────
function departDisplayed() {
  let list = departResFilter === 'all' ? departResults.slice() : departResults.filter((r) => departGroup(r) === departResFilter);
  if (departResSort) list = gridSortRows(list, (r) => r[departResSort.key], departResSort.dir);
  return list;
}

function departRenderResults() {
  const list = departDisplayed();
  const cols = DEPART_COLUMNS.map((c) => Object.assign({}, c, { label: c.label + (departResSort && departResSort.key === c.key ? (departResSort.dir === 'desc' ? ' ▼' : ' ▲') : '') }));
  setHtml(`${DEPART_P}-results`, resultsTableHtml({ columns: cols, rows: list, classify: departClassify, actionKey: 'action', sortable: true, emptyText: departResults.length ? 'אין תוצאות בסינון הזה' : '' }));
  show(`${DEPART_P}-results`, departResults.length > 0);
  const attention = list.filter((r) => !isDepartSuccess(r.status)).length;
  setDisabled(`${DEPART_P}-fix`, attention === 0);
  setText(`${DEPART_P}-fix`, attention ? `תקן והרץ שוב: ${departPlural(attention, 'תלמיד אחד', 'N תלמידים')}${departResFilter !== 'all' ? ' (המוצגים)' : ''}` : 'תקן והרץ שוב');
  const fx = $el(`${DEPART_P}-fix`); if (fx) fx.title = attention ? 'פותח טבלה רק עם מי שדורש טיפול' : (departResults.length ? 'אין בין המוצגים מי שדורש טיפול' : '');
  for (const id of ['tsv', 'csv']) setDisabled(`${DEPART_P}-${id}`, departResults.length === 0);
}

function departRenderReport(report) {
  if (!report) { show(`${DEPART_P}-report`, false); setHtml(`${DEPART_P}-report`, ''); return; }
  const ok = departResults.filter((r) => isDepartSuccess(r.status)).length;
  const verify = departResults.filter((r) => departGroup(r) === 'verify').length;
  const bad = departResults.filter((r) => departGroup(r) === 'bad').length;
  const stopped = departResults.filter((r) => departGroup(r) === 'stopped').length;
  const tag = (filter, label, n, kind) => (n ? tagHtml({ label: `${label} ${n}`, kind, button: true, filter, active: departResFilter === filter }) : '');
  const tags = tagHtml({ label: `הכל ${departResults.length}`, kind: 'info', button: true, filter: 'all', active: departResFilter === 'all' })
    + tag('ok', 'הצליחו', ok, 'ok') + tag('verify', 'לבדוק', verify, 'warn') + tag('bad', 'דורשים טיפול', bad, 'bad') + tag('stopped', 'לא רצו', stopped, 'warn');
  // הכרעת בעל-המערכת 1.11.2026 (א): משפט "הסתיים: X מתוך Y" נאמר פעם אחת, בתיבת-המצב; כאן רק התגיות (פירוט + סינון) והטבלה
  setHtml(`${DEPART_P}-report`, `<div class="tt-tags" id="${DEPART_P}-rtags">${tags}</div>`);
  show(`${DEPART_P}-report`, true);
}

function departOnReportClick(e) {
  const t = e.target && e.target.closest ? e.target.closest('[data-filter]') : null;
  if (!t) return;
  departResFilter = t.getAttribute('data-filter') || 'all';
  t.parentElement.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('tt-tag-active', b === t));
  departRenderResults();
}
function departOnResultsClick(e) {
  const th = e.target && e.target.closest ? e.target.closest('th[data-sort]') : null;
  if (!th) return;
  const key = th.getAttribute('data-sort');
  departResSort = { key, dir: departResSort && departResSort.key === key && departResSort.dir === 'asc' ? 'desc' : 'asc' };
  departRenderResults();
}

function departRenderStaleQueue(info) {
  if (!info) { show(`${DEPART_P}-stale`, false); setHtml(`${DEPART_P}-stale`, ''); return; }
  const done = info.curIdx || 0;
  const lastMs = Date.parse(info.lastAt || info.startedAt); // סבב רטוב 1.11: מהפעילות האחרונה, לא מתחילת הריצה
  const ageMin = Number.isNaN(lastMs) ? null : Math.round((Date.now() - lastMs) / 60000);
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

function departSetRunning(on) {
  setDisabled(`${DEPART_P}-start`, !!on);
  if (on) { if (departStage !== 'run') departStageBeforeRun = departStage; departSetStage('run'); }
  else if (departStage === 'run') departSetStage(departResults.length ? 'results' : (departStageBeforeRun === 'fix' ? 'fix' : 'prep'));
  departUi.running(!!on);
  if (!on) departRefreshStartButton();
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

async function departStart() {
  if (departIsRunning()) return;
  if (departHasSavedQueue()) { departUi.status('יש ריצה שנקטעה וממתינה. לחץ "המשך" או "בטל" למעלה'); return; }
  const settings = departReadSettings();
  if (settings.leaveDate && !departIsValidDate(settings.leaveDate)) {
    departUi.status('תאריך העזיבה לא תקין. הפורמט: יום/חודש/שנה, או השאר ריק (= היום)');
    return;
  }
  departGrid.refresh();
  const v = departRunnable();
  if (!v.filled.length) { departUi.status(departGrid.filter() !== 'all' ? 'אין שורות בסינון הזה. לחץ "הכל"' : 'אין שורות להרצה. "הדבק מאקסל" או מלא שורה בטבלה'); return; }
  if (v.counts.bad && !departAwaitingErrorConfirm) {
    departAwaitingErrorConfirm = true;
    departAwaitingErrorFilter = departGrid.filter();
    setText(`${DEPART_P}-start`, v.tasks.length ? `לחץ שוב להתחלה בלי ${departPlural(v.counts.bad, 'השורה האדומה', 'N השורות האדומות')}` : 'התחל עזיבה');
    departUi.status(`${departPlural(v.counts.bad, 'שורה אחת לא תרוץ', 'N שורות לא ירוצו')} (אדום). תקן אותן, או לחץ שוב על הכפתור כדי להתחיל בלי האדומות`);
    return;
  }
  if (!v.tasks.length) { departUi.status('אין תלמידים שיכולים לרוץ. תקן את השורות האדומות'); return; }
  departAwaitingErrorConfirm = false;
  departRenderReport(null);
  departRenderStaleQueue(null);
  departResults = [];
  departResFilter = 'all';
  departResSort = null;
  departRenderResults();
  departTotal = v.tasks.length;
  setText(`${DEPART_P}-runtext`, departPlural(departTotal, 'תלמיד אחד בריצה', 'N תלמידים בריצה'));
  departSetRunning(true);
  departUi.progress(0, v.tasks.length);
  departUi.status(`מתחיל: ${departPlural(v.tasks.length, 'תלמיד אחד', 'N תלמידים')}…`);
  log(`[עזיבה] התחלה: ${v.tasks.length} תלמידים · תאריך "${settings.leaveDate || 'היום'}" · סיבה ${settings.leaveReason}`);
  await departStartRun(v.tasks, settings);
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

function departKey(branch, identity) { const id = String(identity || '').replace(/[\s-]/g, ''); return `${String(branch || '').trim().padStart(2, '0')}|${/^\d+$/.test(id) ? id.replace(/^0+/, '') : id.toUpperCase()}`; }

// זרימת-התיקון: טבלה רק עם מי שדורש טיפול מבין המוצגים, "מה קרה / מה לעשות" מתחת לכל שורה
function departFixAndRerun() {
  const attention = departDisplayed().filter((r) => !isDepartSuccess(r.status));
  if (!attention.length) return;
  const byKey = new Map(attention.map((r) => [departKey(r.branch, r.identity), r]));
  departGrid.setRows(attention.map((r) => departRowFrom({ branch: r.branch, identifier: r.identity })));
  departGrid.setNotes((row) => { const res = byKey.get(departKey(row.fields.branch, row.fields.identifier)); return res ? { kind: departClassify(res) === 'bad' ? 'bad' : 'warn', text: `${res.status}. ${res.action || ''}`.trim() } : null; });
  departAwaitingErrorConfirm = false;
  departSetStage('fix');
  departGrid.render();
  log(`[עזיבה] תקן והרץ שוב: ${attention.length} תלמידים בטבלה`);
}

function departBackToResults() { departGrid.setRows([]); departGrid.setNotes(null); departAwaitingErrorConfirm = false; departSetStage('results'); departUi.status('חזרה לתוצאות הריצה האחרונה'); }

function departNewRun() {
  departResults = []; departResFilter = 'all'; departResSort = null;
  departRenderReport(null); departRenderResults();
  departGrid.setRows([]); departGrid.setNotes(null); departAwaitingErrorConfirm = false;
  departSetStage('prep'); departGrid.render();
  departUi.status('רשימה חדשה: הטבלה והתוצאות נוקו. מלא שורה (סניף ומספר), הדבק מאקסל או טען קובץ אקסל');
  log('[עזיבה] רשימה חדשה: הטבלה והתוצאות נוקו');
}

// סבב 5: טעינת קובץ אקסל גם בעזיבה (כמו בקליטה)
function departHandleXlsx(ev) {
  const input = ev && ev.target;
  const file = input && input.files && input.files[0];
  if (!file) return;
  departUi.status('טוען קובץ אקסל…');
  Promise.resolve().then(() => loadXlsxFile(file)).then((text) => {
    departGrid.applyText(text, `קובץ "${file.name}"`);
  }).catch((e) => {
    departUi.status('טעינת האקסל נכשלה: ' + ((e && e.message) || 'שגיאה לא ידועה'));
  }).finally(() => { if (input) input.value = ''; });
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
  departPage = page;
  departBuildGrid();
  container.innerHTML = `
    <section class="tt-zone" id="${DEPART_P}-zone-in">
      <div class="tt-zone-head"><b id="${DEPART_P}-zone-in-title">על מי מדווחים עזיבה</b><span class="tt-zone-note"></span>
        <span class="tt-zone-actions">${buttonHtml({ id: `${DEPART_P}-restart`, label: 'רשימה חדשה', kind: 'newlist', size: 'small', title: 'מנקה את הטבלה ואת התוצאות וחוזר להכנה. לחיצה שנייה מאשרת', attrs: 'hidden' })}</span></div>
      <div id="${DEPART_P}-prep-only">
        <p class="tt-zone-lead">כאן מדווחים עזיבה לכמה תלמידים בבת אחת: ממלאים את הטבלה (סניף ומספר), או מדביקים שתי עמודות מאקסל ("הדבק מאקסל"), או טוענים קובץ אקסל. תלמיד שכבר רשום כעוזב מקבל "כבר בוצעה עזיבה" ולא משתנה.</p>
        <div class="tt-row tt-row-wrap tt-row-tight">
          ${buttonHtml({ id: `${DEPART_P}-paste-btn`, label: 'הדבק מאקסל', kind: 'primary', size: 'small', title: 'ממלא את הטבלה ממה שהעתקת באקסל' })}
          ${buttonHtml({ id: `${DEPART_P}-xlsx`, label: 'טען קובץ אקסל', kind: 'ghost', size: 'small', title: 'שתי עמודות: סניף ומספר' })}
          ${buttonHtml({ id: `${DEPART_P}-clear`, label: 'נקה טבלה', kind: 'danger', size: 'small', title: 'מרוקן את הטבלה. לחיצה שנייה מאשרת', attrs: 'hidden' })}
        </div>
        <input id="${DEPART_P}-xlsx-file" type="file" accept=".xlsx,.xls" hidden>
        ${departGrid.pasteBoxHtml()}
      </div>
      <div id="${DEPART_P}-fix-only" hidden><p class="tt-zone-lead">רק מי שדורש טיפול. תקן לפי ההוראה שמתחת לכל שורה, ולחץ "התחל עזיבה חוזרת".</p></div>
      <div class="tt-tags" id="${DEPART_P}-tags"></div>
      <div id="${DEPART_P}-grid" class="tt-scroll" style="max-height:320px"></div>
      <div id="${DEPART_P}-stale" class="tt-box tt-box-warn" hidden></div>
      <div class="tt-row tt-row-wrap">
        <label class="tt-field"><span class="tt-field-label">תאריך עזיבה (ריק = היום)</span>${dateFieldHtml({ id: `${DEPART_P}-date`, placeholder: todayDMY(), maxWidth: '130px' })}</label>
        ${fieldHtml('סיבת עזיבה', selectHtml({ id: `${DEPART_P}-reason`, options: DEPART_REASONS, value: DEPART_DEFAULT_REASON }))}
      </div>
      <div class="tt-row tt-row-wrap">
        ${buttonHtml({ id: `${DEPART_P}-start`, label: 'התחל עזיבה', kind: 'primary' })}
        ${buttonHtml({ id: `${DEPART_P}-back`, label: 'חזרה לתוצאות', kind: 'ghost', attrs: 'hidden' })}
        <span class="tt-legend"><i style="background:var(--tt-bad)"></i>לא ירוץ עד שיתוקן <i style="background:var(--tt-warn);margin-inline-start:8px"></i>אזהרה, ירוץ</span>
      </div>
    </section>
    <div class="tt-runline" id="${DEPART_P}-zone-run" hidden><span class="tt-runtext" id="${DEPART_P}-runtext"></span>${buttonHtml({ id: `${DEPART_P}-stop`, label: 'עצור', kind: 'stop', title: 'גם מקש Escape עוצר' })}</div>
    ${zoneHtml({ id: `${DEPART_P}-zone-out`, title: 'תוצאות', hidden: true, actions: buttonHtml({ id: `${DEPART_P}-new-run`, label: 'רשימה חדשה', kind: 'newlist', size: 'small', title: 'מנקה את הטבלה ואת התוצאות וחוזר להכנה. לחיצה שנייה מאשרת' }), inner: `
      <div id="${DEPART_P}-report" hidden></div>
      <div class="tt-row tt-row-wrap tt-row-tight" id="${DEPART_P}-out-actions">
        ${buttonHtml({ id: `${DEPART_P}-fix`, label: 'תקן והרץ שוב', kind: 'primary', size: 'small', disabled: true, title: 'פותח טבלה רק עם מי שדורש טיפול' })}
        ${buttonHtml({ id: `${DEPART_P}-tsv`, label: 'העתק תוצאות לאקסל', kind: 'ghost', size: 'small', disabled: true, title: 'מכיל מזהים מלאים: לא להדביק בצ\'אט' })}
        ${buttonHtml({ id: `${DEPART_P}-csv`, label: 'הורד קובץ', kind: 'ghost', size: 'small', disabled: true })}
      </div>
      <div id="${DEPART_P}-results" class="tt-scroll" hidden></div>` })}`;

  bindDateMask(`${DEPART_P}-date`);
  bindDateFields(container);
  departGrid.bind();
  $el(`${DEPART_P}-paste-btn`).addEventListener('click', () => { departGrid.pasteFromClipboard(); });
  $el(`${DEPART_P}-start`).addEventListener('click', () => {
    Promise.resolve().then(departStart).catch((e) => {
      log('[עזיבה] ההרצה נכשלה: ' + (e && e.message));
      departSetRunning(false);
      departUi.status('ההרצה נכשלה. בדוק את היומן ונסה שוב');
    });
  });
  $el(`${DEPART_P}-back`).addEventListener('click', departBackToResults);
  $el(`${DEPART_P}-stop`).addEventListener('click', departStopClick, true);
  $el(`${DEPART_P}-fix`).addEventListener('click', departFixAndRerun);
  // הכרעת 2.11: מה שמוחק טבלה או תוצאות דורש לחיצה שנייה
  const departArmNote = (what) => () => { if (departStage !== 'results') departUi.status(`${what} בלחיצה נוספת על הכפתור (6 שניות)`); };
  bindConfirmClick(`${DEPART_P}-new-run`, { label: 'רשימה חדשה', confirmLabel: 'לחץ שוב לרשימה חדשה', onConfirm: departNewRun, onArm: departArmNote('הטבלה והתוצאות יימחקו'), onDisarm: () => departGrid.refresh() });
  bindConfirmClick(`${DEPART_P}-restart`, { label: 'רשימה חדשה', confirmLabel: 'לחץ שוב לרשימה חדשה', onConfirm: departNewRun, onArm: departArmNote('הטבלה והתוצאות יימחקו'), onDisarm: () => departGrid.refresh() });
  bindConfirmClick(`${DEPART_P}-clear`, { label: 'נקה טבלה', confirmLabel: 'לחץ שוב לניקוי הטבלה', onConfirm: departClearTable, onArm: departArmNote('הטבלה תנוקה'), onDisarm: () => departGrid.refresh() });
  $el(`${DEPART_P}-xlsx`).addEventListener('click', () => $el(`${DEPART_P}-xlsx-file`).click());
  $el(`${DEPART_P}-xlsx-file`).addEventListener('change', departHandleXlsx);
  $el(`${DEPART_P}-tsv`).addEventListener('click', departCopyTsv);
  $el(`${DEPART_P}-csv`).addEventListener('click', departExportCsv);
  $el(`${DEPART_P}-report`).addEventListener('click', departOnReportClick);
  $el(`${DEPART_P}-results`).addEventListener('click', departOnResultsClick);

  departSetHooks({
    onStart: (queue, idx) => { departTotal = queue.length; departUi.progress(idx, departTotal); setText(`${DEPART_P}-runtext`, departPlural(departTotal, 'תלמיד אחד בריצה', 'N תלמידים בריצה')); departSetRunning(true); },
    onResume: (queue, res, idx, settings) => {
      departTotal = queue.length; departResults = res.slice(); departRenderResults(); departUi.progress(idx, departTotal);
      departGrid.setRows(queue.map((t) => departRowFrom({ branch: t.branch, identifier: t.identity })));
      departApplySettings(settings);
      setText(`${DEPART_P}-runtext`, `${departPlural(departTotal, 'תלמיד אחד בריצה', 'N תלמידים בריצה')} · ממשיך אחרי טעינת דף`);
      departSetRunning(true);
      departUi.status(`ממשיך אחרי טעינת דף: ${idx + 1} מתוך ${departTotal}`);
      departUi.open();
    },
    onProgress: (idx, tot, task) => { departTotal = tot; departUi.progress(idx, tot); setText(`${DEPART_P}-runtext`, `${departPlural(tot, 'תלמיד אחד בריצה', 'N תלמידים בריצה')} · מעבד ${idx + 1} מתוך ${tot}`); departUi.status(`מעבד ${idx + 1} מתוך ${tot}: סניף ${task.branch}`); },
    onResult: (result, all) => { departResults = all.slice(); departRenderResults(); departUi.progress(all.length, Math.max(departTotal, all.length)); },
    onNavigating: (branch) => { departUi.status(`עובר לדף המוסד של סניף ${branch}… ממתין לטעינה`); },
    onStaleQueue: (info) => { departSetRunning(false); departSetStage(departResults.length ? 'results' : 'prep'); departUi.status('יש ריצת עזיבה שנקטעה. בחר "המשך" או "בטל"'); departRenderStaleQueue(info); departUi.open(); },
    onDone: (all, report) => {
      departResults = all.slice(); departResFilter = 'all'; departResSort = null; departGrid.setRows([]); departGrid.setNotes(null);
      departRenderResults(); departRenderReport(report); departSetRunning(false); departSetStage('results'); departUi.progress(all.length, all.length);
      const bad = all.filter((r) => !isDepartSuccess(r.status)).length;
      departUi.status(bad ? `הסתיים: ${all.length - bad} מתוך ${all.length} הצליחו. ${departPlural(bad, 'תלמיד אחד דורש טיפול', 'N תלמידים דורשים טיפול')}: ראה "מה לעשות" בתוצאות` : `הסתיים: ${all.length} מתוך ${all.length} הצליחו. הכול טופל`);
    },
  });

  log(`[עזיבה] דף ${page.kind}${page.branch ? ` · סניף ${page.branch} [${page.branchSource || '?'}]` : ''}`);
  departSetStage('prep');
  departGrid.render();
  departResults = departGetResults();
  departRenderResults();
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
