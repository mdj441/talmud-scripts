// כלי "טיפול בהודעות": הזרימה והפונקציות הטהורות. העברה מכנית מ"תלמוד - טיפול בהודעות" v5.0
// (extractIdFromBody:247, makeUID:258, getMessagesOnPage:265, פייג'ר:293-343, ensureSentFilter:345,
// runScan:364, XLSX:409, loadPastedTable:476, runBulkMode:519, runTableMode:585, recordReport:664).
// דף ההודעות: /Association/Default.aspx. כל הפעולות בדף הן postback א-סינכרוני (אין טעינת-דף),
// ולכן אין כאן מצב שמור ב-sessionStorage; דגל-העצירה בזיכרון והלולאות בודקות אותו בכל סבב.
// שינויים מכוונים מול הישן: (1) הסדר הקשיח של הליבה לכל postback (firePostback / waitPRM לפני הירי);
// (2) אחרי כל פעולה מאמתים מול הגריד שההודעה כבר לא "נשלחה", כדי שפעולה שלא נתפסה תסומן "נכשל"
// ולא תיכנס ללולאה על אותה הודעה; (3) קריאת חלונית-ההודעה דרך הליבה, סגירה בלי "המשך", עם שורת-יומן.
// אין גישה ל-document/window ברמת המודול (import תקין ב-Node).

import { $el } from '../core/dom.js';
import { firePostback, waitPRM } from '../core/prm.js';
import { readMessagePopup, hideMessagePopupAsync } from '../core/popup.js';
import { log, maskId, maskIdsInText } from '../core/log.js';
import { downloadText } from '../core/csv.js';
import { parsePostbackHref } from '../core/navigate.js';

// ─── קבועים ─────────────────────────────────────────────────────────────────

export const MESSAGES_ACTION = {
  APPROVE: 'אישור מעבר',
  DECLINE: 'דחיית מעבר',
  HANDLED: 'שנה מצב הודעה לטופל',
  SKIP: 'דלג',
};
export const MESSAGES_ALL_ACTIONS = [MESSAGES_ACTION.APPROVE, MESSAGES_ACTION.DECLINE, MESSAGES_ACTION.HANDLED, MESSAGES_ACTION.SKIP];

// הכינויים של הסקריפט הישן (v5.0 שורות 22-27), כמות שהם.
const MESSAGES_ACTION_ALIASES = {
  'אשר': MESSAGES_ACTION.APPROVE, 'אישור': MESSAGES_ACTION.APPROVE, 'אישור מעבר': MESSAGES_ACTION.APPROVE, 'approve': MESSAGES_ACTION.APPROVE,
  'דחה': MESSAGES_ACTION.DECLINE, 'דחיה': MESSAGES_ACTION.DECLINE, 'דחייה': MESSAGES_ACTION.DECLINE, 'דחיית מעבר': MESSAGES_ACTION.DECLINE, 'decline': MESSAGES_ACTION.DECLINE,
  'טופל': MESSAGES_ACTION.HANDLED, 'טופלה': MESSAGES_ACTION.HANDLED, 'סגור': MESSAGES_ACTION.HANDLED, 'שנה': MESSAGES_ACTION.HANDLED, 'שנה מצב הודעה לטופל': MESSAGES_ACTION.HANDLED,
  'דלג': MESSAGES_ACTION.SKIP, 'skip': MESSAGES_ACTION.SKIP, '': MESSAGES_ACTION.SKIP,
};

export const MESSAGES_POSTBACK_TARGETS = {
  [MESSAGES_ACTION.APPROVE]: 'ctl00$ContentPlaceHolder1$btnTransferApprove',
  [MESSAGES_ACTION.DECLINE]: 'ctl00$ContentPlaceHolder1$btnTransferDecline',
  [MESSAGES_ACTION.HANDLED]: 'ctl00$ContentPlaceHolder1$btnChangeMessageStatus',
};

export const MESSAGES_IDS = {
  grid: 'ContentPlaceHolder1_GVMessages',
  pager: 'ContentPlaceHolder1_GPager_pager',
  hidRowId: 'ContentPlaceHolder1_HidMessageRowID',
};

export const MESSAGES_TRANSFER_HEADER = 'בקשת מעבר תלמיד';
export const MESSAGES_STATUS_SENT = 'נשלחה';
export const MESSAGES_STATUS_HANDLED = 'טופלה';
export const MESSAGES_TSV_HEADER = ['UID', 'נושא', 'ת.ז./דרכון', 'תאריך', 'גוף ההודעה', 'פעולה'];
export const MESSAGES_REPORT_HEADER = ['UID', 'ת.ז./דרכון', 'נושא', 'פעולה', 'סטטוס', 'גוף ההודעה'];
export const MESSAGES_RESULT = { DONE: 'בוצע', SKIPPED: 'דילוג', FAILED_PREFIX: 'נכשל: ' };

const MESSAGES_URL_MARK = /Association\/Default\.aspx/i;
const MESSAGES_MAX_LOOPS = 5000;
const MESSAGES_MAX_EMPTY_PAGES = 30;
const MESSAGES_MAX_SCAN_PAGES = 300;

// ─── טהורות ─────────────────────────────────────────────────────────────────

export function messagesIsMessagesUrl(url) {
  return typeof url === 'string' && MESSAGES_URL_MARK.test(url);
}

function messagesFlat(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

// זהה ל-makeUID של הישן: hash של כותרת+גוף, 'M' + base36.
export function messagesMakeUid(header, body) {
  const s = (header || '') + '|' + (body || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return 'M' + (h >>> 0).toString(36);
}

// זהה ל-extractIdFromBody של הישן: "ת.ז. 012345678" → ת.ז.; "דרכון AB12345" → דרכון (אותיות גדולות);
// אחרת רצף של 8-9 ספרות; אין → ''.
export function messagesExtractId(body) {
  const b = String(body == null ? '' : body);
  if (!b) return '';
  let m = b.match(/ת\.?\s*ז\.?\s*\.?\s*([0-9]{7,9})/);
  if (m) return m[1];
  m = b.match(/דרכון\s+([A-Za-z0-9]{5,12})/);
  if (m) return m[1].toUpperCase();
  m = b.match(/\b([0-9]{8,9})\b/);
  if (m) return m[1] || '';
  return '';
}

// כינוי → פעולה קנונית. לא מוכר / ריק → "דלג" (כמו בישן).
export function messagesNormalizeAction(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return MESSAGES_ACTION_ALIASES[s.toLowerCase()] || MESSAGES_ACTION_ALIASES[s] || MESSAGES_ACTION.SKIP;
}

// הפעולה שהמצב הגורף מבצע: בקשת מעבר → אישור מעבר; כל השאר → סמן כטופל.
export function messagesSuggestAction(header) {
  return messagesFlat(header) === MESSAGES_TRANSFER_HEADER ? MESSAGES_ACTION.APPROVE : MESSAGES_ACTION.HANDLED;
}

export function messagesActionCountKey(action) {
  if (action === MESSAGES_ACTION.APPROVE) return 'approve';
  if (action === MESSAGES_ACTION.DECLINE) return 'decline';
  if (action === MESSAGES_ACTION.HANDLED) return 'handled';
  return 'skip';
}

// פרסור הטבלה המודבקת (שלב ב): טאבים (מאקסל) או פסיקים. שורת כותרת עם עמודות UID ו"פעולה" (בכל
// סדר), או בלי כותרת כשהעמודה הראשונה היא UID (M...) והפעולה בעמודה האחרונה. UID כפול: השורה
// האחרונה מנצחת (כמו Map בישן). מחזיר {ok, reason, entries:[{uid, action, line}], counts}.
export function messagesParseTable(text) {
  const raw = String(text == null ? '' : text);
  const counts = { approve: 0, decline: 0, handled: 0, skip: 0 };
  const fail = (reason) => ({ ok: false, reason, entries: [], counts });
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return fail('תיבת הטקסט ריקה');
  const delim = raw.includes('\t') ? '\t' : ',';
  const split = (l) => l.split(delim).map((c) => c.trim());
  const head = split(lines[0]);
  let uidIdx = head.findIndex((h) => /uid|מזהה/i.test(h));
  let actionIdx = head.findIndex((h) => /פעולה|action/i.test(h));
  let first = 1;
  if (uidIdx === -1 && actionIdx === -1 && /^M[0-9a-z]+$/.test(head[0] || '')) {
    uidIdx = 0; actionIdx = -1; first = 0; // בלי כותרת: UID ראשון, פעולה אחרונה
  } else if (uidIdx === -1 || actionIdx === -1) {
    return fail('חסרה עמודת UID או "פעולה" בשורת הכותרת');
  }
  if (lines.length <= first) return fail('צריך כותרת + שורה אחת לפחות');
  const map = new Map();
  for (let i = first; i < lines.length; i++) {
    const cells = split(lines[i]);
    const uid = cells[uidIdx] || '';
    if (!uid) continue;
    const aIdx = actionIdx === -1 ? cells.length - 1 : actionIdx;
    const actionRaw = aIdx === uidIdx ? '' : (cells[aIdx] || '');
    map.set(uid, { uid, action: messagesNormalizeAction(actionRaw), line: i + 1 });
  }
  const entries = Array.from(map.values());
  for (const e of entries) counts[messagesActionCountKey(e.action)]++;
  if (!entries.length) return fail('לא נמצאו שורות עם UID');
  return { ok: true, reason: '', entries, counts };
}

export function messagesLoadSummary(parsed) {
  const c = parsed.counts;
  return `נטענו ${parsed.entries.length}: אישור=${c.approve}, דחיה=${c.decline}, טופל=${c.handled}, דילוג=${c.skip}`;
}

function messagesTsvCell(v) {
  return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();
}

// טבלת ההודעות הסרוקות כ-TSV עם כותרת (להדבקה באקסל; העמודה האחרונה "פעולה" נערכת שם).
export function messagesBuildTsv(list) {
  const lines = [MESSAGES_TSV_HEADER.join('\t')];
  for (const r of list || []) {
    lines.push([r.uid, r.header, r.personId, r.date, messagesFlat(r.body), r.suggestedAction || MESSAGES_ACTION.SKIP].map(messagesTsvCell).join('\t'));
  }
  return lines.join('\n');
}

// דוח הביצוע כ-TSV עם כותרת (העתק דוח).
export function messagesBuildReportTsv(rows) {
  const lines = [MESSAGES_REPORT_HEADER.join('\t')];
  for (const r of rows || []) lines.push([r.uid, r.id, r.header, r.action, r.status, r.body].map(messagesTsvCell).join('\t'));
  return lines.join('\n');
}

// דוח "מה נשאר": סיכום + שורה אופרטיבית לכל הודעה שלא הצליחה / לא נמצאה, ושורה על עצירה.
export function messagesBuildReport(rows, opts) {
  const o = opts || {};
  const counts = { done: 0, failed: 0, skipped: 0 };
  const lines = [];
  for (const r of rows || []) {
    if (r.status === MESSAGES_RESULT.DONE) counts.done++;
    else if (r.status === MESSAGES_RESULT.SKIPPED) counts.skipped++;
    else {
      counts.failed++;
      lines.push(`הודעה ${r.uid} "${r.header}"${r.id ? ` (${r.id})` : ''}: ${r.status}. טפל בה ידנית בדף ההודעות`);
    }
  }
  const notFound = Array.isArray(o.notFound) ? o.notFound : [];
  for (const nf of notFound) {
    lines.push(`UID ${nf.uid} (${nf.action}): לא נמצא בהודעות במצב "נשלחה". אולי כבר טופל; סרוק מחדש ובדוק`);
  }
  if (o.stopped) lines.push('הריצה נעצרה לבקשתך. הודעות שטרם טופלו נשארו במצב "נשלחה"; הפעל שוב כדי להמשיך');
  let summary = `בוצעו=${counts.done} · נכשלו=${counts.failed} · דולגו=${counts.skipped}`;
  if (notFound.length) summary += ` · לא נמצאו=${notFound.length}`;
  if (o.stopped) summary += ' · נעצר';
  return { summary, lines, counts, stopped: !!o.stopped, notFound: notFound.length };
}

// ─── מצב הריצה + hooks לפאנל ─────────────────────────────────────────────────

export const MSG = {
  running: false,
  stop: false,
  mode: null, // 'bulk' | 'scan' | 'table'
  scanned: [],
  report: [],
  lastReport: null,
  hooks: {},
};

export function messagesSetHooks(hooks) { MSG.hooks = hooks || {}; }
export function messagesIsRunning() { return MSG.running; }
export function messagesGetScanned() { return MSG.scanned.slice(); }
export function messagesGetReportRows() { return MSG.report.slice(); }
export function messagesRequestStop() {
  if (!MSG.running) return false;
  MSG.stop = true;
  log('⛔ [הודעות] בקשת עצירה; הריצה תיעצר אחרי הפעולה הנוכחית');
  return true;
}

function messagesHook(name, ...args) {
  try { if (MSG.hooks[name]) MSG.hooks[name](...args); } catch (e) { /* אצווה לא נתקעת */ }
}

function messagesBeginRun(mode) {
  MSG.running = true;
  MSG.stop = false;
  MSG.mode = mode;
  if (mode !== 'scan') MSG.report = [];
  messagesHook('onStart', mode);
}

function messagesFinishRun(opts) {
  const report = messagesBuildReport(MSG.report, opts);
  MSG.lastReport = report;
  MSG.running = false;
  messagesHook('onDone', MSG.report.slice(), report, MSG.mode);
  return report;
}

function messagesRecord(m, action, status) {
  const row = { uid: m.uid || '', id: m.personId || '', header: m.header || '', action: action || '', status, body: messagesFlat(m.body), date: m.date || '' };
  MSG.report.push(row);
  messagesHook('onResult', row, MSG.report.slice());
}

// ─── קריאת הגריד (getMessagesOnPage של הישן) ─────────────────────────────────

export function messagesReadPage() {
  const grid = $el(MESSAGES_IDS.grid);
  if (!grid) return [];
  const out = [];
  for (const tr of Array.from(grid.querySelectorAll('tr'))) {
    const m = /selectedRowSearch\(\s*'?(\d+)'?\s*\)/.exec(tr.getAttribute('onclick') || '');
    if (!m) continue;
    const idx = m[1];
    const hdBody = $el(`${MESSAGES_IDS.grid}_hdID_${idx}`);
    const hdHeader = $el(`${MESSAGES_IDS.grid}_hidMessageHeader_${idx}`);
    const body = hdBody ? hdBody.value : '';
    const header = hdHeader ? hdHeader.value : '';
    const cell = (i) => (tr.cells && tr.cells[i] ? messagesFlat(tr.cells[i].innerText || tr.cells[i].textContent) : '');
    out.push({ rowIndex: idx, header, body, status: cell(3), date: cell(4), personId: messagesExtractId(body), uid: messagesMakeUid(header, body) });
  }
  return out;
}

const messagesIsSent = (m) => !m.status || m.status === MESSAGES_STATUS_SENT;

function messagesPageSignature(list) {
  return list.map((m) => m.uid + ':' + m.status).join('|');
}

// ─── פייג'ר (« ‹ › ») ───────────────────────────────────────────────────────

function messagesPagerLinks() {
  const links = { next: null, first: null, prev: null, last: null };
  const pager = $el(MESSAGES_IDS.pager);
  if (!pager) return links;
  for (const a of Array.from(pager.querySelectorAll('a'))) {
    const t = messagesFlat(a.innerText || a.textContent);
    if (t === '›') links.next = a;
    else if (t === '»') links.last = a;
    else if (t === '«') links.first = a;
    else if (t === '‹') links.prev = a;
  }
  return links;
}

export function messagesCurrentPage() {
  const pager = $el(MESSAGES_IDS.pager);
  if (!pager) return 1;
  for (const s of Array.from(pager.querySelectorAll('span'))) {
    const t = messagesFlat(s.innerText || s.textContent);
    if (/^\d+$/.test(t)) return parseInt(t, 10);
  }
  return 1;
}

// לחיצה על קישור-פייג'ר: postback לפי ה-href (סדר קשיח), אחרת קליק עם המתנה. מחזיר true רק אם
// העמוד אכן השתנה (מספר או תוכן), כדי שלולאה לא תסתובב על פייג'ר שלא מתקדם.
async function messagesClickPager(a) {
  if (!a) return false;
  const before = messagesCurrentPage() + '#' + messagesPageSignature(messagesReadPage());
  const parsed = parsePostbackHref(a.getAttribute('href') || '');
  let res;
  if (parsed) {
    res = await firePostback(parsed.target, parsed.arg);
  } else {
    const wait = waitPRM();
    setTimeout(() => { try { a.click(); } catch (e) { /* אצווה לא נתקעת */ } }, 0);
    res = await wait;
  }
  if (!res.ok) { log(`[הודעות] דפדוף נכשל: ${res.reason || ''}`); return false; }
  const after = messagesCurrentPage() + '#' + messagesPageSignature(messagesReadPage());
  if (after === before) { log('[הודעות] הדפדוף לא שינה את העמוד'); return false; }
  return true;
}

async function messagesGotoFirstPage() {
  const { first, prev } = messagesPagerLinks();
  const target = first || prev;
  if (!target) return true;
  return messagesClickPager(target);
}

async function messagesGotoNextPage() {
  const { next } = messagesPagerLinks();
  if (!next) return false;
  return messagesClickPager(next);
}

// ─── סינון "נשלחה" ──────────────────────────────────────────────────────────

export function messagesFindFilterSelect() {
  if (typeof document === 'undefined') return null;
  for (const s of Array.from(document.querySelectorAll('select'))) {
    const texts = Array.from(s.options).map((o) => messagesFlat(o.text));
    if (texts.includes(MESSAGES_STATUS_SENT) && texts.includes(MESSAGES_STATUS_HANDLED)) return s;
  }
  return null;
}

async function messagesEnsureSentFilter() {
  const s = messagesFindFilterSelect();
  if (!s) { log('[הודעות] לא נמצאה תיבת-סינון מצב (נשלחה/טופלה); ממשיכים עם הסינון הנוכחי'); return { ok: true, found: false }; }
  const opt = Array.from(s.options).find((o) => messagesFlat(o.text) === MESSAGES_STATUS_SENT);
  const want = opt ? opt.value : '1';
  if (s.value === want) return { ok: true, found: true, changed: false };
  log('[הודעות] משנה סינון ל"נשלחה"');
  const wait = waitPRM(); // (1) נרשם קודם
  setTimeout(() => { // (2) נדחה
    try { s.value = want; s.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* אצווה לא נתקעת */ }
  }, 0);
  const res = await wait;
  if (!res.ok) log(`[הודעות] שינוי הסינון נכשל: ${res.reason || ''}`);
  return { ok: res.ok !== false, found: true, changed: true };
}

// ─── חלונית ההודעה והפעולה עצמה ──────────────────────────────────────────

// קורא את החלונית (אם גלויה), רושם ביומן (ממוסך) וסוגר בלי "המשך". מחזיר את מה שנקרא או null.
async function messagesClosePopupIfOpen(where) {
  const popup = readMessagePopup();
  if (!popup) return null;
  log(`[הודעות] חלונית ${where} (${popup.kind}): "${maskIdsInText(popup.text)}" [${popup.buttons.join(', ')}]`);
  if (popup.kind === 'confirm') log('[הודעות] שים לב: האתר ביקש אישור ("המשך"). לא נלחץ אוטומטית; החלונית נסגרת והתוצאה נבדקת מול הגריד');
  const { hidden, wait } = hideMessagePopupAsync();
  if (wait) await wait;
  if (!hidden) log('[הודעות] לא הצלחתי לסגור את החלונית');
  return popup;
}

// פעולה אחת (performActionFast של הישן): סגירת חלונית ישנה → HidMessageRowID → postback → סגירת
// חלונית ההצלחה → אימות מול הגריד (מספר המופעים של ההודעה במצב "נשלחה" צריך לרדת).
async function messagesPerformAction(msg, action) {
  const target = MESSAGES_POSTBACK_TARGETS[action];
  if (!target) return { ok: false, reason: 'פעולה לא מוכרת: ' + action };
  await messagesClosePopupIfOpen('לפני הפעולה');
  const hid = $el(MESSAGES_IDS.hidRowId);
  if (!hid) return { ok: false, reason: 'לא נמצא השדה הנסתר של שורת ההודעה (HidMessageRowID)' };
  const countSent = () => messagesReadPage().filter((m) => m.uid === msg.uid && messagesIsSent(m)).length;
  const before = countSent();
  hid.value = String(msg.rowIndex);
  const res = await firePostback(target, '');
  if (!res.ok) return { ok: false, reason: res.reason || 'הפעולה נכשלה בשרת' };
  if (res.started === false) return { ok: false, reason: 'הלחיצה לא הפעילה בקשה לשרת' };
  const popup = await messagesClosePopupIfOpen('אחרי הפעולה');
  if (before > 0 && countSent() >= before) {
    const why = popup && popup.kind !== 'success' ? `האתר הודיע: "${messagesFlat(popup.text)}"` : 'ההודעה עדיין במצב "נשלחה" אחרי הפעולה';
    return { ok: false, reason: why };
  }
  return { ok: true };
}

// ─── מצב גורף ───────────────────────────────────────────────────────────────

export async function messagesRunBulk() {
  if (MSG.running) return null;
  messagesBeginRun('bulk');
  const t0 = Date.now();
  log('[הודעות] ▶ מצב גורף: בקשת מעבר → אישור מעבר; אחרת → סמן כטופל');
  await messagesEnsureSentFilter();
  await messagesGotoFirstPage();
  const failed = new Set();
  let processed = 0, skipped = 0, consecutiveEmpty = 0;
  for (let loops = 0; loops < MESSAGES_MAX_LOOPS && !MSG.stop; loops++) {
    await messagesClosePopupIfOpen('בין פעולות');
    const list = messagesReadPage();
    if (!list.length) { log('[הודעות] אין הודעות בעמוד'); break; }
    const target = list.find((m) => messagesIsSent(m) && !failed.has(m.uid));
    if (!target) {
      consecutiveEmpty++;
      if (consecutiveEmpty > MESSAGES_MAX_EMPTY_PAGES) { log('[הודעות] עצירת בטיחות: יותר מדי עמודים בלי הודעה לטיפול'); break; }
      const moved = await messagesGotoNextPage();
      if (!moved) break;
      continue;
    }
    consecutiveEmpty = 0;
    const action = messagesSuggestAction(target.header);
    messagesHook('onStatus', `טופלו ${processed}${skipped ? ` (נכשלו ${skipped})` : ''} · מטפל: ${action} · ${target.header}`);
    const t1 = Date.now();
    const res = await messagesPerformAction(target, action);
    if (res.ok) {
      processed++;
      messagesRecord(target, action, MESSAGES_RESULT.DONE);
      log(`[הודעות] ✓ ${Date.now() - t1}ms · ${action} · ${maskId(target.personId) || '-'} · ${target.header}`);
    } else {
      skipped++;
      failed.add(target.uid);
      messagesRecord(target, action, MESSAGES_RESULT.FAILED_PREFIX + res.reason);
      log(`[הודעות] ✗ ${res.reason} · ${target.header} · ${maskId(target.personId) || '-'}`);
    }
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[הודעות] מצב גורף הסתיים${MSG.stop ? ' (נעצר)' : ''}: בוצעו ${processed}, נכשלו ${skipped} (${dt} שניות)`);
  return messagesFinishRun({ stopped: MSG.stop });
}

// ─── סריקה (שלב א) ──────────────────────────────────────────────────────────

export async function messagesScan() {
  if (MSG.running) return null;
  messagesBeginRun('scan');
  MSG.scanned = [];
  const t0 = Date.now();
  log('[הודעות] סריקה: מתחיל');
  await messagesEnsureSentFilter();
  await messagesGotoFirstPage();
  const seen = new Set();
  let pages = 0;
  for (let i = 0; i < MESSAGES_MAX_SCAN_PAGES && !MSG.stop; i++) {
    pages++;
    const list = messagesReadPage();
    log(`[הודעות] עמוד ${messagesCurrentPage()}: ${list.length} הודעות`);
    for (const m of list) {
      if (!messagesIsSent(m)) continue;
      if (seen.has(m.uid)) continue;
      seen.add(m.uid);
      MSG.scanned.push({ uid: m.uid, header: m.header, personId: m.personId, body: m.body, date: m.date, status: m.status, suggestedAction: messagesSuggestAction(m.header) });
    }
    messagesHook('onStatus', `סריקה: ${pages} עמודים, ${MSG.scanned.length} הודעות`);
    messagesHook('onScanProgress', MSG.scanned.slice(), pages);
    const moved = await messagesGotoNextPage();
    if (!moved) break;
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[הודעות] סריקה הסתיימה${MSG.stop ? ' (נעצר)' : ''}: ${MSG.scanned.length} הודעות מ-${pages} עמודים (${dt} שניות)`);
  MSG.running = false;
  const info = { pages, stopped: MSG.stop };
  messagesHook('onScanDone', MSG.scanned.slice(), info);
  return MSG.scanned.slice();
}

// ─── ביצוע לפי טבלה (שלב ב) ──────────────────────────────────────────────────

export async function messagesRunTable(entries) {
  if (MSG.running) return null;
  const pending = new Map();
  for (const e of entries || []) if (e && e.uid) pending.set(e.uid, e.action);
  if (!pending.size) { log('[הודעות] אין טבלה טעונה'); return null; }
  messagesBeginRun('table');
  const t0 = Date.now();
  let toDo = 0;
  for (const a of pending.values()) if (a !== MESSAGES_ACTION.SKIP) toDo++;
  log(`[הודעות] ▶ ביצוע לפי טבלה: ${toDo} פעולות מתוך ${pending.size} שורות`);
  await messagesEnsureSentFilter();
  await messagesGotoFirstPage();
  const handled = new Set();
  let processed = 0, failedCount = 0, consecutiveEmpty = 0;
  for (let loops = 0; loops < MESSAGES_MAX_LOOPS && !MSG.stop; loops++) {
    await messagesClosePopupIfOpen('בין פעולות');
    const list = messagesReadPage();
    if (!list.length) break;
    let target = null, targetAction = null;
    for (const m of list) {
      if (handled.has(m.uid)) continue;
      const action = pending.get(m.uid);
      if (!action) continue;
      if (action === MESSAGES_ACTION.SKIP) {
        handled.add(m.uid);
        messagesRecord(m, MESSAGES_ACTION.SKIP, MESSAGES_RESULT.SKIPPED);
        continue;
      }
      target = m;
      targetAction = action;
      break;
    }
    if (!target) {
      consecutiveEmpty++;
      if (consecutiveEmpty > MESSAGES_MAX_EMPTY_PAGES) { log('[הודעות] עצירת בטיחות: יותר מדי עמודים בלי הודעה מהטבלה'); break; }
      const moved = await messagesGotoNextPage();
      if (!moved) break;
      continue;
    }
    consecutiveEmpty = 0;
    messagesHook('onStatus', `מבצע ${processed + failedCount + 1}/${toDo}: ${targetAction} · ${target.header}`);
    messagesHook('onProgress', processed + failedCount, toDo);
    const t1 = Date.now();
    const res = await messagesPerformAction(target, targetAction);
    handled.add(target.uid);
    if (res.ok) {
      processed++;
      messagesRecord(target, targetAction, MESSAGES_RESULT.DONE);
      log(`[הודעות] ✓ ${Date.now() - t1}ms · ${targetAction} · ${maskId(target.personId) || '-'}`);
    } else {
      failedCount++;
      messagesRecord(target, targetAction, MESSAGES_RESULT.FAILED_PREFIX + res.reason);
      log(`[הודעות] ✗ ${res.reason} · ${target.header} · ${maskId(target.personId) || '-'}`);
    }
    messagesHook('onProgress', processed + failedCount, toDo);
  }
  const notFound = [];
  for (const [uid, action] of pending.entries()) if (action !== MESSAGES_ACTION.SKIP && !handled.has(uid)) notFound.push({ uid, action });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[הודעות] ביצוע לפי טבלה הסתיים${MSG.stop ? ' (נעצר)' : ''}: בוצעו ${processed}, נכשלו ${failedCount}, לא נמצאו ${notFound.length} (${dt} שניות)`);
  return messagesFinishRun({ stopped: MSG.stop, notFound: MSG.stop ? [] : notFound });
}

// ─── הורדת אקסל (XLSX אם הספרייה נטענה, אחרת TSV) ───────────────────────────

export function messagesDownloadXlsx(list) {
  if (!list || !list.length) return { ok: false, reason: 'אין נתונים' };
  const rows = [MESSAGES_TSV_HEADER.slice()];
  for (const r of list) rows.push([r.uid, r.header || '', r.personId || '', r.date || '', messagesFlat(r.body), r.suggestedAction || MESSAGES_ACTION.SKIP]);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const XLSX = globalThis.XLSX;
  if (XLSX && XLSX.utils && typeof XLSX.writeFile === 'function') {
    try {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 70 }, { wch: 22 }];
      ws['!views'] = [{ RTL: true }];
      ws['!dataValidation'] = [{
        sqref: `F2:F${rows.length}`, type: 'list', formula1: `"${MESSAGES_ALL_ACTIONS.join(',')}"`,
        allowBlank: true, showErrorMessage: true, errorTitle: 'ערך לא חוקי', error: `מותר: ${MESSAGES_ALL_ACTIONS.join(', ')}`,
      }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'הודעות');
      const help = XLSX.utils.aoa_to_sheet([['פעולות אפשריות:'], ...MESSAGES_ALL_ACTIONS.map((a) => [a]), [], ['אל תשנה את עמודת UID']]);
      help['!views'] = [{ RTL: true }];
      help['!cols'] = [{ wch: 60 }];
      XLSX.utils.book_append_sheet(wb, help, 'עזרה');
      XLSX.writeFile(wb, `הודעות_${stamp}.xlsx`);
      log(`[הודעות] הורד אקסל: ${list.length} שורות`);
      return { ok: true, format: 'xlsx' };
    } catch (e) {
      log(`[הודעות] יצירת אקסל נכשלה (${e && e.message}); מוריד TSV במקום`);
    }
  }
  const ok = downloadText(`הודעות_${stamp}.tsv`, '\uFEFF' + messagesBuildTsv(list), 'text/tab-separated-values;charset=utf-8');
  if (ok) log(`[הודעות] הורד TSV: ${list.length} שורות`);
  return { ok, format: 'tsv' };
}
