// תרחישי כלי ההודעות על סביבת-הדמה. הסקריפט האמיתי (dist/) רץ בכרום אמיתי. כל התעודות בדויות.
// הרצה: npm run build && node --test "test/e2e/messages.e2e.js"   (HEADED=1 להצגת הדפדפן)
// הדמה (לפי עובדות האתר החי מ-30.10.2026): הסינון בטעינה "הכל"; 10 שורות בעמוד; 14 הודעות "נשלחה" ב-2 עמודים:
// עמוד 1: m01-m08, m13 (זהה ל-m01: אותו UID), m14 (כמו m03 בנוסח "תזכורת": UID שונה, אותה ת.ז.);
// עמוד 2: m15 (בקשת מעבר על 078901234), m16-m18 ("מעבר תלמיד" אינפורמטיבי: ממוסדך ת.ז. / ממוסדך דרכון / אל מוסדך).
// אחרי מיזוג: 12 שורות. בקשות-מעבר: m01, m03, m05, m07, m13, m14, m15 (5 שורות).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openSession, readMockDb, readUserscript, evalRetry, sleep, URLS, SITE } from './harness.js';

const T = '\t';
const SEL = {
  panel: '#tt-panel',
  tab: '#tt-tab-messages',
  root: '#tt-messages-root',
  modeTable: '#tt-messages-mode-table',
  modeBulk: '#tt-messages-mode-bulk',
  bulkRun: '#tt-messages-bulk-run',
  stop: '#tt-messages-stop',
  scan: '#tt-messages-scan',
  scanStatus: '#tt-messages-scan-status',
  scanned: '#tt-messages-scanned',
  summary: '#tt-messages-summary',
  filter: '#tt-messages-filter',
  allTransfers: '#tt-messages-all-transfers',
  allOthers: '#tt-messages-all-others',
  allDone: '#tt-messages-all-done',
  allSkip: '#tt-messages-all-skip',
  runReview: '#tt-messages-run-review',
  rosterSummary: '#tt-messages-roster-summary',
  rosterInput: '#tt-messages-roster-input',
  rosterLoad: '#tt-messages-roster-load',
  rosterStatus: '#tt-messages-roster-status',
  rosterClear: '#tt-messages-roster-clear',
  rosterXlsx: '#tt-messages-roster-xlsx',
  zoneScan: '#tt-messages-zone-scan',
  zoneReview: '#tt-messages-zone-review',
  zoneRun: '#tt-messages-zone-run',
  zoneOut: '#tt-messages-zone-out',
  runtext: '#tt-messages-runtext',
  newScan: '#tt-messages-new-scan',
  clearTable: '#tt-messages-clear-table',
  steps: '#tt-messages-steps',
  excelSummary: '#tt-messages-excel-summary',
  input: '#tt-messages-input',
  load: '#tt-messages-load',
  loadStatus: '#tt-messages-load-status',
  runTable: '#tt-messages-run-table',
  results: '#tt-messages-results',
  report: '#tt-messages-report',
  status: '#tt-messages-status',
  log: '#tt-log',
};

const APPROVE = 'אישור מעבר', DECLINE = 'דחיית מעבר', HANDLED = 'שנה מצב הודעה לטופל', SKIP = 'דלג';
const TRANSFER = 'בקשת מעבר תלמיד', TRANSFER_DONE = 'מעבר תלמיד';
const SENT_IDS = ['m01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm13', 'm14', 'm15', 'm16', 'm17', 'm18'];
const APPROVE_IDS = ['m01', 'm03', 'm05', 'm07', 'm13', 'm14', 'm15'];
const HANDLED_IDS = ['m02', 'm04', 'm06', 'm08', 'm16', 'm17', 'm18'];
const SCAN_TEXT = /נסרקו 14 הודעות מ-2 עמודים \(12 שורות אחרי מיזוג כפילויות\)/;

let browser;
let script;

async function openMessages(page) {
  await page.goto(URLS.messages());
  await page.waitForSelector(SEL.panel, { timeout: 10000 });
  await page.click(SEL.tab);
  await page.waitForSelector(SEL.scan, { timeout: 5000 });
}

async function openBulk(page) {
  await openMessages(page);
  await page.click(SEL.modeBulk);
  await page.waitForSelector(`${SEL.bulkRun}:visible`, { timeout: 5000 });
}

// ממתין לדוח "מה נשאר" (מוצג רק בסיום ריצה). קורא בלולאה עם try/catch.
async function waitForReport(page, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const st = await page.evaluate((s) => {
        const rep = document.querySelector(s.report);
        const status = document.querySelector(s.status);
        return { done: !!rep && !rep.hidden && rep.innerText.trim() !== '', text: rep ? rep.innerText : '', status: status ? status.textContent : '' };
      }, SEL);
      if (st.done) return st;
    } catch (e) { /* ננסה שוב */ }
    await sleep(200);
  }
  throw new Error(`waitForReport: timeout after ${timeoutMs}ms`);
}

async function waitForScan(page, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const txt = await page.evaluate((s) => { const el = document.querySelector(s.scanStatus); return el ? el.textContent : ''; }, SEL);
      if (/נסרקו/.test(txt)) return txt;
    } catch (e) { /* ננסה שוב */ }
    await sleep(150);
  }
  throw new Error('waitForScan: timeout');
}

async function scanAndWait(page) {
  await page.click(SEL.scan);
  return waitForScan(page);
}

// שורות טבלת-התוצאות (tr[data-row]) → מערך של מערכי-תאים (טקסט); התא האחרון (אינדקס 5) הוא שורת "מה לעשות"
// שמתחת לנכשלת (ריק כשאין).
async function readTable(page, sel) {
  return evalRetry(page, (s) => Array.from(document.querySelectorAll(`${s} table tbody tr[data-row]`))
    .map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim());
      const next = tr.nextElementSibling;
      cells.push(next && next.classList.contains('tt-act') ? next.textContent.trim() : '');
      return cells;
    }), sel);
}

async function readResultsHeader(page) {
  return evalRetry(page, (s) => Array.from(document.querySelectorAll(`${s.results} table thead th`)).map((th) => th.textContent.trim()), SEL);
}

// טבלת הסקירה: [{uid, uids, id, header, body, bodyFull, bodyOpen, fullShown, date, count, roster, done, decision, hidden}]
async function readReview(page) {
  return evalRetry(page, (s) => Array.from(document.querySelectorAll(`${s.scanned} table tbody tr.tt-review-row`)).map((tr) => {
    const td = Array.from(tr.querySelectorAll('td'));
    const sel = tr.querySelector('select');
    const full = tr.nextElementSibling && tr.nextElementSibling.classList.contains('tt-body-full') ? tr.nextElementSibling : null;
    return {
      uid: tr.getAttribute('data-uid'), uids: (tr.getAttribute('data-uids') || '').split(',').filter(Boolean),
      id: td[0].textContent.trim(), header: td[1].textContent.trim(), body: td[2].textContent.trim(), bodyFull: td[2].getAttribute('title') || '',
      bodyOpen: td[2].getAttribute('aria-expanded') === 'true', fullShown: !!full && !full.hidden, fullText: full ? full.textContent.trim() : '',
      date: td[3].textContent.trim(), count: td[4].textContent.trim(), roster: td[5].textContent.trim(),
      done: !!tr.querySelector('.tt-tag-done'), pending: !!tr.querySelector('.tt-tag-pending'), decision: sel ? sel.value : '', hidden: tr.hidden,
    };
  }), SEL);
}

// מה מוצג על המסך (שלבים שמחליפים את המסך): נמדד לפי getClientRects, כך שגם hidden על אב נספר.
async function readStage(page) {
  return evalRetry(page, (s) => {
    const shown = (sel) => { const el = document.querySelector(sel); return !!el && el.getClientRects().length > 0; };
    const step = document.querySelector(`${s.steps} .tt-step-on`);
    return {
      scan: shown(s.zoneScan), review: shown(s.zoneReview), run: shown(s.zoneRun), out: shown(s.zoneOut),
      stop: shown(s.stop), newScan: shown(s.newScan), modes: shown(s.modeTable),
      step: step ? step.textContent.trim() : '', runtext: (document.querySelector(s.runtext) || {}).textContent || '',
    };
  }, SEL);
}

async function buttonState(page, sel) {
  return evalRetry(page, (q) => { const b = document.querySelector(q); return b ? { label: b.textContent.trim(), disabled: b.disabled, armed: b.classList.contains('tt-btn-armed') } : null; }, sel);
}

async function readText(page, sel) {
  return evalRetry(page, (s) => { const el = document.querySelector(s); return el ? el.textContent : ''; }, sel);
}

async function readLog(page) { return readText(page, SEL.log); }

async function setDecision(page, uid, action) {
  await page.selectOption(`${SEL.scanned} tr[data-uid="${uid}"] select`, action);
}

const byId = (db, id) => db.messages.find((m) => m.id === id);
const pageErrors = (lines) => lines.filter((l) => l.startsWith('PAGEERROR')).join('\n');

describe('טיפול בהודעות: סביבת דמה', () => {
  before(async () => { browser = await launch(); script = readUserscript(); });
  after(async () => { if (browser) await browser.close(); });

  test('1 מצב גורף: 14 "נשלחה" בשני עמודים (מתחיל בסינון "טופלה") → כולן "טופלה"; בקשות-מעבר approve, "מעבר תלמיד" ואחרות handled', async () => {
    const { context, page, consoleLines } = await openSession(browser, { scenario: { messagesInitialFilter: '2' }, script });
    try {
      await openBulk(page);
      await page.click(SEL.bulkRun);
      const rep = await waitForReport(page);
      const log = await readLog(page);
      assert.match(rep.text, /בוצעו=14/, rep.text + '\n' + log);
      assert.match(rep.text, /נכשלו=0/, rep.text);
      assert.doesNotMatch(rep.text, /נעצר/);
      assert.match(log, /משנה סינון ל"נשלחה"/, 'הסקריפט היה צריך להחליף את הסינון מ"טופלה" ל"נשלחה"');

      const db = await readMockDb(page);
      assert.equal(db.messages.filter((m) => m.status === 'נשלחה').length, 0, 'נשארו הודעות במצב נשלחה');
      for (const id of APPROVE_IDS) assert.equal(byId(db, id).handledBy, 'approve', id);
      for (const id of HANDLED_IDS) assert.equal(byId(db, id).handledBy, 'handled', id);
      // ההודעות שכבר היו "טופלה" לא נגעו בהן
      assert.equal(byId(db, 'm12').handledBy, 'decline');
      assert.equal(byId(db, 'm09').handledBy, 'approve');

      const rows = await readTable(page, SEL.results);
      assert.equal(rows.length, 14, 'טבלת התוצאות');
      assert.ok(rows.every((r) => r[4] === 'בוצע'), JSON.stringify(rows));
      assert.ok(rows.some((r) => r[2] === '012345678'), 'ת.ז. מלאה בטבלת התוצאות');
      assert.doesNotMatch(log, /012345678/, 'ת.ז. מלאה דלפה ליומן');
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  test('2 דרך אקסל: סריקה (מסינון "הכל" בטעינה) → הדבקה (דחייה, דלג, טופל, דחייה-לא-חוקית) → ביצוע; דחייה על UID כפול מטפלת בשני המופעים', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script });
    try {
      await openMessages(page);
      // עובדה M1: בטעינה הסינון הוא "הכל" (value -1); הסריקה חייבת לעבור ל"נשלחה"
      const initialFilter = await evalRetry(page, () => document.getElementById('ContentPlaceHolder1_ddlMessageStatus').value);
      assert.equal(initialFilter, '-1', 'הדמה צריכה להתחיל בסינון "הכל" כמו האתר');
      const scanTxt = await scanAndWait(page);
      assert.match(scanTxt, SCAN_TEXT, scanTxt);
      assert.match(await readLog(page), /משנה סינון ל"נשלחה"/, 'הסריקה צריכה להחליף את הסינון מ"הכל" ל"נשלחה"');
      const filterAfter = await evalRetry(page, () => document.getElementById('ContentPlaceHolder1_ddlMessageStatus').value);
      assert.equal(filterAfter, '1');

      const review = await readReview(page);
      assert.equal(review.length, 12);
      const m01 = review.find((r) => r.id === '012345678');
      const m02 = review.find((r) => r.id === '023456789');
      const m04 = review.find((r) => r.header === 'הודעה כללית');
      const m06 = review.find((r) => r.id === 'AB1234567');
      assert.ok(m01 && m02 && m04 && m06, JSON.stringify(review));

      await page.click(SEL.excelSummary);
      const header = ['UID', 'נושא', 'ת.ז./דרכון', 'תאריך', 'גוף ההודעה', 'פעולה'].join(T);
      const line = (r, action) => [r.uid, r.header, r.id, r.date, 'גוף', action].join(T);
      const pasted = [header, line(m01, 'דחיית מעבר'), line(m02, 'דלג'), line(m04, 'טופל'), line(m06, 'דחה')].join('\n');
      await page.fill(SEL.input, pasted);
      await page.click(SEL.load);
      const loadTxt = await readText(page, SEL.loadStatus);
      assert.match(loadTxt, /נטענו 4: אישור=0, דחיה=2, טופל=1, דילוג=1/, loadTxt);

      await page.click(SEL.runTable);
      const rep = await waitForReport(page);
      assert.match(rep.text, /בוצעו=3/, rep.text); // m01 + m13 (אותו UID) + m04
      assert.match(rep.text, /נכשלו=1/, rep.text);
      assert.match(rep.text, /דולגו=1/, rep.text);
      assert.match(rep.text, new RegExp(m06.uid), 'שורת "מה נשאר" להודעה שנכשלה');

      const db = await readMockDb(page);
      assert.equal(byId(db, 'm01').handledBy, 'decline');
      assert.equal(byId(db, 'm13').handledBy, 'decline', 'המופע השני של אותו UID');
      assert.equal(byId(db, 'm02').status, 'נשלחה', 'המדולגת צריכה להישאר נשלחה');
      assert.equal(byId(db, 'm02').handledBy, undefined);
      assert.equal(byId(db, 'm04').handledBy, 'handled');
      assert.equal(byId(db, 'm06').status, 'נשלחה', 'דחייה על הודעה שאינה בקשת-מעבר לא אמורה לשנות כלום');
      assert.equal(byId(db, 'm03').status, 'נשלחה', 'הודעה שלא בטבלה לא נוגעים בה');
      assert.equal(byId(db, 'm14').status, 'נשלחה');

      const rows = await readTable(page, SEL.results);
      const st = {};
      for (const r of rows) st[r[0]] = (st[r[0]] || []).concat(r[4]);
      assert.deepEqual(st[m01.uid], ['בוצע', 'בוצע']);
      assert.deepEqual(st[m02.uid], ['דילוג']);
      assert.deepEqual(st[m04.uid], ['בוצע']);
      assert.match(st[m06.uid][0], /^נכשל/);
      // הכרעה 4: הכותרת "מה קרה" (לא "סטטוס"); מתחת לנכשלת שורת "מה לעשות"; מתחת לבוצעה ולמדולגת אין
      assert.deepEqual(await readResultsHeader(page), ['UID', 'נושא', 'ת.ז./דרכון', 'פעולה', 'מה קרה']);
      assert.match(rows.find((r) => r[0] === m06.uid)[5], /ידנית בדף ההודעות/);
      assert.equal(rows.find((r) => r[0] === m04.uid)[5], '');
      assert.equal(rows.find((r) => r[0] === m02.uid)[5], '');
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  test('3 עצור באמצע ריצה גורפת → הריצה נעצרת, הדוח מציג "נעצר", נשארו "נשלחה"', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script, delayMs: 500 });
    try {
      await openBulk(page);
      assert.equal((await readStage(page)).stop, false, '"עצור" מוסתר לפני ריצה');
      await page.click(SEL.bulkRun);
      await sleep(900);
      const mid = await readStage(page);
      assert.deepEqual([mid.run, mid.stop, mid.out, mid.modes, mid.step], [true, true, true, false, 'ביצוע'], JSON.stringify(mid));
      assert.match(mid.runtext, /^מצב גורף בביצוע · טופלו \d+$/, mid.runtext);
      await page.click(SEL.stop);
      const rep = await waitForReport(page, 30000);
      assert.match(rep.text, /נעצר/, rep.text);
      assert.match(rep.status, /נעצר/, rep.status);
      const after = await readStage(page);
      assert.deepEqual([after.run, after.stop, after.out, after.newScan, after.step], [false, false, true, true, 'תוצאות'], JSON.stringify(after));
      const db = await readMockDb(page);
      const remaining = db.messages.filter((m) => m.status === 'נשלחה').length;
      const done = db.messages.filter((m) => m.handledAt).length;
      assert.ok(remaining > 0, 'העצירה לא עצרה: כל ההודעות טופלו');
      assert.ok(done >= 1, 'לא בוצעה אף פעולה לפני העצירה');
      assert.ok(remaining + done === SENT_IDS.length, `remaining=${remaining} done=${done}`);
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  test('4 דף אחר (לא הודעות, לא מוסד): החלונית עולה (הכרעה ח2), לשונית ההודעות מציעה לעבור לדף ההודעות, והכפתור מעביר', async () => {
    const { context, page } = await openSession(browser, { script });
    try {
      await page.goto(`${SITE}/`);
      await page.waitForSelector(SEL.panel, { timeout: 5000 });
      assert.ok(await page.$('#tt-fab'), 'הכפתור הצף מוצג בכל דף');
      await page.click(SEL.tab);
      const fit = await page.textContent('#tt-messages-fit');
      assert.match(fit, /דף ההודעות/);
      assert.equal(await page.$(SEL.scan), null, 'בדף אחר אין "סרוק"');
      await page.click('#tt-tab-report');
      assert.ok(await page.$('#tt-report-goto'), 'דיווח בדף בלי רשימת סניפים: "עבור לדף המוסדות"');
      assert.equal(await page.$('#tt-report-zone-in'), null, 'בלי אזור "לאילו סניפים מדווחים"');
      await page.click(SEL.tab);
      await page.click('#tt-messages-goto');
      await page.waitForURL(/Association\/Default\.aspx/, { timeout: 5000 });
      await page.waitForSelector(SEL.scan, { timeout: 5000 });
    } finally { await context.close(); }
  });

  test('5 סקירה: מיזוג כפילויות (UID זהה פעמיים = 2; שני UID-ים עם אותה ת.ז. = 2); "מעבר תלמיד" → טופל → שינוי החלטה בשורה ממוזגת → בצע → שתי ההודעות טופלו', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script });
    try {
      await openMessages(page);
      await scanAndWait(page);
      const review = await readReview(page);
      assert.equal(review.length, 12, JSON.stringify(review));
      const r01 = review.find((r) => r.id === '012345678');
      const r03 = review.find((r) => r.id === '034567890');
      assert.equal(r01.count, '2', 'm01 + m13 (אותו UID)');
      assert.equal(r01.uids.length, 1);
      assert.equal(r03.count, '2', 'm03 + m14 (UID שונה, אותה ת.ז.)');
      assert.equal(r03.uids.length, 2);
      assert.ok(review.filter((r) => r.count !== '1').length === 2, 'רק שתי שורות ממוזגות');
      assert.ok(review.every((r) => r.roster === ''), 'בלי מצבת: עמודת "במצבת" ריקה');
      assert.ok(review.filter((r) => r.header === TRANSFER).every((r) => r.decision === APPROVE));
      assert.ok(review.filter((r) => r.header !== TRANSFER).every((r) => r.decision === HANDLED));
      // עובדה M3: שלושת נוסחי "מעבר תלמיד" האינפורמטיביים נקראים עם המזהה (ת.ז. / דרכון) וברירת-המחדל "טופל"
      const done = review.filter((r) => r.header === TRANSFER_DONE);
      assert.deepEqual(done.map((r) => r.id).sort(), ['100200300', '200300400', 'CD7654321'], JSON.stringify(done));
      assert.ok(r01.bodyFull.includes('012345678'), 'הגוף המלא ב-title');
      assert.ok(r01.bodyFull.includes('מסוג לימוד 600 בסניף 09'), 'הנוסח החי של בקשת-המעבר');
      const summary0 = await readText(page, SEL.summary);
      assert.match(summary0, /12 שורות · אישור מעבר=5 · דחיית מעבר=0 · טופל=7 · דלג=0/, summary0);

      await setDecision(page, r03.uid, DECLINE);
      const summary1 = await readText(page, SEL.summary);
      assert.match(summary1, /אישור מעבר=4 · דחיית מעבר=1/, summary1);

      // הכרעה 3: לפני הביצוע: שלב הסקירה, בלי "עצור"; הכפתור אומר כמה שורות ירוצו
      const before = await readStage(page);
      assert.deepEqual([before.scan, before.review, before.run, before.out, before.stop, before.step], [false, true, false, false, false, 'סקירה'], JSON.stringify(before));
      assert.equal((await buttonState(page, SEL.runReview)).label, 'בצע לפי הטבלה: 12');
      await page.click(SEL.runReview);
      const rep = await waitForReport(page);
      assert.match(rep.text, /בוצעו=14 · נכשלו=0 · דולגו=0/, rep.text + '\n' + (await readLog(page)));
      // אחרי הביצוע: שלב התוצאות בלבד (הטבלה מוסתרת), "עצור" נעלם, "סריקה חדשה" בכותרת
      const after = await readStage(page);
      assert.deepEqual([after.scan, after.review, after.run, after.out, after.stop, after.newScan, after.step], [false, false, false, true, false, true, 'תוצאות'], JSON.stringify(after));

      const db = await readMockDb(page);
      assert.equal(byId(db, 'm03').handledBy, 'decline');
      assert.equal(byId(db, 'm14').handledBy, 'decline', 'ההחלטה חלה על כל ה-UID-ים של השורה הממוזגת');
      assert.equal(byId(db, 'm01').handledBy, 'approve');
      assert.equal(byId(db, 'm13').handledBy, 'approve');
      assert.equal(byId(db, 'm15').handledBy, 'approve', 'בלי מצבת אין "כנראה בוצע"');
      for (const id of HANDLED_IDS) assert.equal(byId(db, id).handledBy, 'handled', id);
      assert.equal(db.messages.filter((m) => m.status === 'נשלחה').length, 0);
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  // עובדות 30.10.2026: בבקשת-מעבר מוסד אחר מבקש תלמיד שלנו. במצבת (בכל סניף) → "ממתין" (לאשר או לדחות);
  // לא במצבת → "כנראה בוצע". ממצא ב-10: שניהם רמז לבדיקה: ההחלטה נשארת "אישור מעבר" עד שלוחצים
  // "כל 'כנראה בוצע': סמן כטופל". "מעבר תלמיד" האינפורמטיבי: עמודת המצבת בלי תג, ברירת-מחדל "טופל".
  test('6 מצבת: בקשת-מעבר במצבת → "סניף NN" + ממתין; לא במצבת → "כנראה בוצע"; התג לא משנה החלטה; "כל \'כנראה בוצע\': סמן כטופל" מחיל; הביצוע מסמן אותה כטופל', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script });
    try {
      await openMessages(page);
      await scanAndWait(page);
      await page.click(SEL.rosterSummary);
      // כמו הדבקה מאקסל: כותרת, טאבים, אפסים מובילים שנמחקו (גם בסניף). 034567890 (m03+m14) אינו במצבת.
      await page.fill(SEL.rosterInput, [
        'סניף' + T + 'ת.ז./דרכון',
        '16' + T + '78901234', // m15
        '05' + T + '12345678', // m01+m13
        '9' + T + '45678901', // m05 (הסניף שבגוף ההודעה הוא 09)
        '16' + T + '056789012', // m07 (בגוף: סניף 05; במצבת: 16. בכל סניף = עדיין אצלנו)
        '16' + T + 'AB1234567', // m06 (אישור קליטה)
        '09' + T + '100200300', // m16 (מעבר תלמיד, ממוסדך)
      ].join('\n'));
      await page.click(SEL.rosterLoad);
      const rosterTxt = await readText(page, SEL.rosterStatus);
      assert.match(rosterTxt, /נטענה מצבת: 6 שורות/, rosterTxt);
      assert.match(await readText(page, SEL.status), /1 בקשות-מעבר .* "כנראה בוצע".*4 ממתינות/, 'שורת-המצב אחרי טעינת המצבת');

      const review = await readReview(page);
      const r15 = review.find((r) => r.id === '078901234');
      const r01 = review.find((r) => r.id === '012345678');
      const r03 = review.find((r) => r.id === '034567890');
      const r05 = review.find((r) => r.id === '045678901');
      const r07 = review.find((r) => r.id === '056789012');
      const r02 = review.find((r) => r.id === '023456789');
      const r04 = review.find((r) => r.header === 'הודעה כללית');
      const r06 = review.find((r) => r.id === 'AB1234567');
      const r16 = review.find((r) => r.id === '100200300');
      const r17 = review.find((r) => r.id === 'CD7654321');
      const pendingOf = (r) => ({ roster: r.roster.replace(/\s*ממתין$/, ''), pending: r.pending, done: r.done });
      assert.deepEqual(pendingOf(r15), { roster: 'סניף 16', pending: true, done: false }, JSON.stringify(r15));
      assert.deepEqual(pendingOf(r01), { roster: 'סניף 05', pending: true, done: false }, JSON.stringify(r01));
      assert.deepEqual(pendingOf(r05), { roster: 'סניף 09', pending: true, done: false }, 'סניף "9" במצבת מרופד ל-09');
      assert.deepEqual(pendingOf(r07), { roster: 'סניף 16', pending: true, done: false }, 'במצבת בסניף אחר מזה שבגוף: עדיין אצלנו → ממתין');
      assert.match(r03.roster, /^לא במצבת/, JSON.stringify(r03));
      assert.equal(r03.done, true, 'בקשת-מעבר על תלמיד שאינו במצבת → כנראה בוצע');
      assert.equal(r03.pending, false);
      assert.equal(r03.decision, APPROVE, 'ממצא ב-10: התג אינו משנה את ההחלטה מעצמו');
      assert.deepEqual(pendingOf(r02), { roster: 'לא במצבת', pending: false, done: false }, 'לא בקשת-מעבר: בלי תג');
      assert.equal(r04.roster, '', 'בלי ת.ז.: עמודה ריקה');
      assert.deepEqual(pendingOf(r06), { roster: 'סניף 16', pending: false, done: false }, 'לא בקשת מעבר');
      assert.deepEqual(pendingOf(r16), { roster: 'סניף 09', pending: false, done: false }, '"מעבר תלמיד": לפי המצבת, בלי תג');
      assert.equal(r16.decision, HANDLED);
      assert.deepEqual(pendingOf(r17), { roster: 'לא במצבת', pending: false, done: false }, '"מעבר תלמיד" עם דרכון שאינו במצבת: בלי תג');
      assert.equal(r17.decision, HANDLED);
      const summaryBefore = await readText(page, SEL.summary);
      assert.match(summaryBefore, /אישור מעבר=5 .* טופל=7 .* ממתין=4 · כנראה בוצע=1/, summaryBefore);

      await page.click(SEL.allDone);
      const after = await readReview(page);
      assert.equal(after.find((r) => r.id === '034567890').decision, HANDLED, 'הכפתור מחיל "סמן כטופל" על המסומנות "כנראה בוצע"');
      assert.ok(after.filter((r) => r.pending).every((r) => r.decision === APPROVE), '"ממתין" לא נגע');
      const summary = await readText(page, SEL.summary);
      assert.match(summary, /אישור מעבר=4 .* טופל=8 .* ממתין=4 · כנראה בוצע=1/, summary);

      await page.click(SEL.runReview);
      const rep = await waitForReport(page);
      assert.match(rep.text, /בוצעו=14 · נכשלו=0/, rep.text);
      const db = await readMockDb(page);
      assert.equal(byId(db, 'm03').handledBy, 'handled', 'הבקשה על תלמיד שאינו במצבת סומנה כטופל, לא אושרה');
      assert.equal(byId(db, 'm14').handledBy, 'handled', 'וגם המופע השני של אותה בקשה (שורה ממוזגת)');
      for (const id of ['m01', 'm05', 'm07', 'm13', 'm15']) assert.equal(byId(db, id).handledBy, 'approve', `${id} ממתין → אושר`);
      for (const id of HANDLED_IDS) assert.equal(byId(db, id).handledBy, 'handled', id);
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  test('7 פעולות-צובר וסינון: הכל דלג → כל בקשות המעבר אישור → סינון + כל השאר טופל על המוצגות → בצע', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script });
    try {
      await openMessages(page);
      await scanAndWait(page);
      await page.click(SEL.allSkip);
      let summary = await readText(page, SEL.summary);
      assert.match(summary, /דלג=12/, summary);
      let review = await readReview(page);
      assert.ok(review.every((r) => r.decision === SKIP));

      await page.click(SEL.allTransfers);
      summary = await readText(page, SEL.summary);
      assert.match(summary, /אישור מעבר=5 .* דלג=7/, summary);

      await page.fill(SEL.filter, '023456789');
      review = await readReview(page);
      assert.deepEqual(review.filter((r) => !r.hidden).map((r) => r.id), ['023456789']);
      summary = await readText(page, SEL.summary);
      assert.match(summary, /\(1 מוצגות\)/, summary);
      await page.click(SEL.allOthers); // רק על השורה המוצגת
      await page.fill(SEL.filter, '');
      review = await readReview(page);
      assert.ok(review.every((r) => !r.hidden));
      summary = await readText(page, SEL.summary);
      assert.match(summary, /אישור מעבר=5 · דחיית מעבר=0 · טופל=1 · דלג=6/, summary);

      await page.click(SEL.runReview);
      const rep = await waitForReport(page);
      assert.match(rep.text, /בוצעו=8 · נכשלו=0 · דולגו=6/, rep.text);
      const db = await readMockDb(page);
      for (const id of APPROVE_IDS) assert.equal(byId(db, id).handledBy, 'approve', id);
      assert.equal(byId(db, 'm02').handledBy, 'handled');
      for (const id of ['m04', 'm06', 'm08', 'm16', 'm17', 'm18']) assert.equal(byId(db, id).status, 'נשלחה', `${id} דולגה`);
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  test('8 Escape באמצע "בצע לפי הטבלה" → נעצר, נשארו "נשלחה"; בזמן הריצה שורת-ריצה עם "עצור" והטבלה מוסתרת; בסוף שלב התוצאות', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script, delayMs: 500 });
    try {
      await openMessages(page);
      await scanAndWait(page);
      await page.click(SEL.runReview);
      await sleep(900);
      const mid = await readStage(page);
      assert.deepEqual([mid.scan, mid.review, mid.run, mid.out, mid.stop, mid.modes, mid.step], [false, false, true, true, true, false, 'ביצוע'], JSON.stringify(mid));
      assert.match(mid.runtext, /^14 הודעות בביצוע · מעבד \d+ מתוך 14$/, mid.runtext);
      await page.keyboard.press('Escape');
      const rep = await waitForReport(page, 30000);
      assert.match(rep.text, /נעצר/, rep.text);
      const db = await readMockDb(page);
      const remaining = db.messages.filter((m) => m.status === 'נשלחה').length;
      const done = db.messages.filter((m) => m.handledAt).length;
      assert.ok(remaining > 0 && done >= 1 && remaining + done === SENT_IDS.length, `remaining=${remaining} done=${done}`);
      const after = await readStage(page);
      assert.deepEqual([after.review, after.run, after.out, after.stop, after.newScan], [false, false, true, false, true], JSON.stringify(after));
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  // ממצא ב-4: האתר חוזר לעמוד 1 אחרי פעולה. (א) m18 (עמוד 2, "מעבר תלמיד" אינפורמטיבי, אינה בקשת-מעבר) עם
  // "דחיית מעבר": האתר מודיע שגיאה ולא משנה כלום; הגריד המוצג (עמוד 1) אינו ראיה → "נכשל: הגריד חזר לעמוד
  // אחר", לא "בוצע". (ב) m15 (עמוד 2) "תקועה": חלונית-הצלחה אך נשארת "נשלחה"; מסלול האקסל בלי כמות → בלי
  // התיקון היא מקבלת פעולה שוב ושוב עד תקרת הלולאה. עם התיקון: פעולה אחת, ובסבב הבא שורת-כישלון בדוח.
  test('9 ממצא ב-4: הגריד חוזר לעמוד 1 אחרי פעולה → פעולה שנכשלה לא מדווחת "בוצע"; הודעה "תקועה" לא מקבלת פעולה פעמיים', async () => {
    const { context, page, consoleLines } = await openSession(browser, { scenario: { messagesResetPageAfterAction: true, messagesStuck: ['m15'] }, script });
    try {
      await openMessages(page);
      await scanAndWait(page);
      const review = await readReview(page);
      const m18 = review.find((r) => r.id === '200300400');
      const m15 = review.find((r) => r.id === '078901234');
      assert.ok(m18 && m15, JSON.stringify(review));
      assert.equal(m18.header, TRANSFER_DONE);
      await page.click(SEL.excelSummary);
      const header = ['UID', 'נושא', 'ת.ז./דרכון', 'תאריך', 'גוף ההודעה', 'פעולה'].join(T);
      const line = (r, action) => [r.uid, r.header, r.id, r.date, 'גוף', action].join(T);
      await page.fill(SEL.input, [header, line(m18, DECLINE), line(m15, APPROVE)].join('\n'));
      await page.click(SEL.load);
      await page.click(SEL.runTable);
      const rep = await waitForReport(page, 60000);
      const log = await readLog(page);
      assert.match(rep.text, /בוצעו=1 · נכשלו=2/, rep.text + '\n' + log);
      const db = await readMockDb(page);
      assert.equal(byId(db, 'm18').status, 'נשלחה');
      assert.equal(byId(db, 'm18').handledBy, undefined);
      assert.equal((db.stuckAttempts || {}).m15, 1, `m15 קיבלה פעולה ${(db.stuckAttempts || {}).m15} פעמים`);
      const rows = await readTable(page, SEL.results);
      const st = {};
      for (const r of rows) st[r[0]] = (st[r[0]] || []).concat(r[4]);
      assert.equal(st[m18.uid].length, 1);
      assert.match(st[m18.uid][0], /^נכשל: הגריד חזר לעמוד אחר אחרי הפעולה/, st[m18.uid][0]);
      assert.match(st[m18.uid][0], /הפעולה אפשרית רק עבור בקשת מעבר/, st[m18.uid][0]);
      assert.deepEqual(st[m15.uid].map((s) => s.replace(/:.*$/, '')), ['בוצע', 'נכשל']);
      assert.match(rep.text, new RegExp(m15.uid), 'שורת "מה נשאר" להודעה התקועה');
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  // הכרעה 1: "בצע לפי הטבלה" חל רק על השורות המוצגות. הכרעה 3+5: "סריקה חדשה" בלחיצה שנייה חוזר לסריקה.
  test('10 סינון → "בצע לפי הטבלה: 1 (המוצגות)" מבצע רק את המוצגת; השאר נשארו "נשלחה"; כלום מוצג → כבוי; "סריקה חדשה" בשתי לחיצות חוזר לסריקה', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script });
    try {
      await openMessages(page);
      const st0 = await readStage(page);
      assert.deepEqual([st0.scan, st0.review, st0.run, st0.out, st0.stop, st0.step], [true, false, false, false, false, 'סריקה'], JSON.stringify(st0));
      await scanAndWait(page);
      assert.deepEqual(await buttonState(page, SEL.runReview), { label: 'בצע לפי הטבלה: 12', disabled: false, armed: false });

      await page.fill(SEL.filter, 'zzz-אין-כזה');
      assert.deepEqual(await buttonState(page, SEL.runReview), { label: 'בצע לפי הטבלה', disabled: true, armed: false }, 'כלום מוצג → כבוי');

      await page.fill(SEL.filter, '023456789'); // רק m02
      const review = await readReview(page);
      assert.deepEqual(review.filter((r) => !r.hidden).map((r) => r.id), ['023456789']);
      assert.deepEqual(await buttonState(page, SEL.runReview), { label: 'בצע לפי הטבלה: 1 (המוצגות)', disabled: false, armed: false });
      await page.click(SEL.runReview);
      const rep = await waitForReport(page);
      assert.match(rep.text, /בוצעו=1 · נכשלו=0 · דולגו=0/, rep.text + '\n' + (await readLog(page)));
      assert.doesNotMatch(rep.text, /לא נמצאו/);

      const db = await readMockDb(page);
      assert.equal(byId(db, 'm02').handledBy, 'handled');
      for (const id of SENT_IDS.filter((x) => x !== 'm02')) assert.equal(byId(db, id).status, 'נשלחה', `${id} לא הייתה מוצגת ולא אמורה להשתנות`);
      const rows = await readTable(page, SEL.results);
      assert.equal(rows.length, 1, 'שורת-תוצאה אחת בלבד');

      // שלב התוצאות: הטבלה מוסתרת, "עצור" מוסתר; "סריקה חדשה" דורש לחיצה שנייה
      const st1 = await readStage(page);
      assert.deepEqual([st1.review, st1.run, st1.out, st1.stop, st1.newScan, st1.step], [false, false, true, false, true, 'תוצאות'], JSON.stringify(st1));
      await page.click(SEL.newScan);
      assert.deepEqual(await buttonState(page, SEL.newScan), { label: 'לחץ שוב לסריקה חדשה', disabled: false, armed: true });
      assert.equal((await readStage(page)).out, true, 'לחיצה ראשונה לא מנקה');
      await page.click(SEL.newScan);
      const st2 = await readStage(page);
      assert.deepEqual([st2.scan, st2.review, st2.out, st2.stop, st2.step], [true, false, false, false, 'סריקה'], JSON.stringify(st2));
      assert.equal((await readTable(page, SEL.results)).length, 0, 'התוצאות נוקו');
      assert.equal((await readReview(page)).length, 0, 'הטבלה נוקתה');
      assert.equal(await readText(page, SEL.scanStatus), 'לא בוצעה סריקה.');
      assert.equal(await evalRetry(page, (s) => document.querySelector(s.filter).value, SEL), '', 'הסינון אופס');
      // סריקה שנייה מוצאת את 13 שנותרו
      const scanTxt = await scanAndWait(page);
      assert.match(scanTxt, /נסרקו 13 הודעות/, scanTxt);
      assert.equal((await readStage(page)).review, true);
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  // הכרעה 2: לחיצה על גוף ההודעה פותחת את הנוסח המלא מתחת לשורה; לחיצה שנייה סוגרת; שינוי החלטה לא נוגע
  test('11 לחיצה על גוף ההודעה פותחת/סוגרת את הנוסח המלא; בחירת החלטה לא משנה; הסינון מסתיר גם את הנוסח הפתוח', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script });
    try {
      await openMessages(page);
      await scanAndWait(page);
      let review = await readReview(page);
      assert.ok(review.every((r) => !r.bodyOpen && !r.fullShown), 'הכול סגור בהתחלה');
      const r01 = review.find((r) => r.id === '012345678');
      assert.ok(r01.body.endsWith('…') && r01.body.length < r01.bodyFull.length, 'הגוף מקוצר בתא');
      const bodySel = `${SEL.scanned} tr[data-uid="${r01.uid}"] td.tt-body-cell`;
      await page.click(bodySel);
      review = await readReview(page);
      const open = review.find((r) => r.id === '012345678');
      assert.equal(open.bodyOpen, true);
      assert.equal(open.fullShown, true);
      assert.equal(open.fullText, open.bodyFull, 'הנוסח המלא כמו ב-title');
      assert.ok(open.fullText.includes('מסוג לימוד 600 בסניף 09'));
      assert.equal(review.filter((r) => r.fullShown).length, 1, 'רק שורה אחת פתוחה');

      await setDecision(page, r01.uid, DECLINE); // בחירת החלטה אינה לחיצה על הגוף
      review = await readReview(page);
      assert.equal(review.find((r) => r.id === '012345678').fullShown, true, 'ההחלטה לא סגרה');
      assert.equal(review.find((r) => r.id === '012345678').decision, DECLINE);

      await page.fill(SEL.filter, '023456789');
      review = await readReview(page);
      assert.equal(review.find((r) => r.id === '012345678').fullShown, false, 'הסינון מסתיר גם את הנוסח המלא');
      await page.fill(SEL.filter, '');
      review = await readReview(page);
      assert.equal(review.find((r) => r.id === '012345678').fullShown, true, 'ביטול הסינון מחזיר אותו פתוח');

      await page.click(bodySel);
      review = await readReview(page);
      assert.equal(review.find((r) => r.id === '012345678').fullShown, false, 'לחיצה שנייה סוגרת');
      assert.equal(review.find((r) => r.id === '012345678').bodyOpen, false);
      // בקשת 2.11: מיון בלחיצה על כותרת (כמו בטבלאות הקליטה); לחיצה שנייה הופכת; ההחלטות נשמרות
      await page.click(`${SEL.scanned} th[data-sort="personId"]`);
      const asc = (await readReview(page)).map((r) => r.id);
      // כמו gridCompare: מספרים כמספרים, ריק תמיד בסוף
      const cmp = (a, b) => (!a && !b ? 0 : (!a ? 1 : (!b ? -1 : (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a.localeCompare(b, 'he')))));
      assert.deepEqual(asc, asc.slice().sort(cmp), 'מיון עולה לפי המספר, ריק בסוף');
      await page.click(`${SEL.scanned} th[data-sort="personId"]`);
      const desc = (await readReview(page)).map((r) => r.id);
      assert.deepEqual(desc, asc.slice().reverse(), 'לחיצה שנייה הופכת את הסדר');
      assert.equal((await readReview(page)).find((r) => r.id === '012345678').decision, DECLINE, 'ההחלטה שנבחרה שרדה את המיון');
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  // הכרעה 5: "נקה מצבת" בשתי לחיצות ("לחץ שוב לניקוי המצבת"); לחיצה אחת לא מוחקת
  test('12 "נקה מצבת": לחיצה ראשונה דורכת ("לחץ שוב לניקוי המצבת"), שנייה מוחקת את המצבת ואת התגים; "נקה טבלה" בשתי לחיצות חוזר לסריקה', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script });
    try {
      await openMessages(page);
      await scanAndWait(page);
      await page.click(SEL.rosterSummary);
      await page.fill(SEL.rosterInput, ['סניף' + T + 'ת.ז./דרכון', '05' + T + '12345678'].join('\n'));
      await page.click(SEL.rosterLoad);
      assert.match(await readText(page, SEL.rosterStatus), /נטענה מצבת: 1 שורות/);
      let review = await readReview(page);
      assert.equal(review.find((r) => r.id === '012345678').pending, true);
      assert.equal(review.filter((r) => r.done).length, 4, 'שאר בקשות-המעבר "כנראה בוצע"');

      await page.click(SEL.rosterClear);
      assert.deepEqual(await buttonState(page, SEL.rosterClear), { label: 'לחץ שוב לניקוי המצבת', disabled: false, armed: true });
      assert.match(await readText(page, SEL.rosterStatus), /נטענה מצבת/, 'לחיצה אחת לא מוחקת');
      assert.equal((await readReview(page)).find((r) => r.id === '012345678').pending, true);
      await page.click(SEL.rosterClear);
      assert.deepEqual(await buttonState(page, SEL.rosterClear), { label: 'נקה מצבת', disabled: false, armed: false });
      assert.equal(await readText(page, SEL.rosterStatus), 'אין מצבת טעונה.');
      assert.equal(await evalRetry(page, (s) => document.querySelector(s.rosterInput).value, SEL), '');
      review = await readReview(page);
      assert.ok(review.every((r) => r.roster === '' && !r.pending && !r.done), 'ההצלבה נעלמה');

      // "נקה טבלה": אותו דפוס; מרוקן את הטבלה וחוזר לסריקה
      await page.click(SEL.clearTable);
      assert.deepEqual(await buttonState(page, SEL.clearTable), { label: 'לחץ שוב לניקוי הטבלה', disabled: false, armed: true });
      assert.equal((await readReview(page)).length, 12, 'לחיצה אחת לא מוחקת');
      await page.click(SEL.clearTable);
      const st = await readStage(page);
      assert.deepEqual([st.scan, st.review, st.step], [true, false, 'סריקה'], JSON.stringify(st));
      assert.equal((await readReview(page)).length, 0);
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });
});
