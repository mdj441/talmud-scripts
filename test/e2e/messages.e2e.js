// תרחישי כלי ההודעות על סביבת-הדמה. הסקריפט האמיתי (dist/) רץ בכרום אמיתי. כל התעודות בדויות.
// הרצה: npm run build && node --test "test/e2e/messages.e2e.js"   (HEADED=1 להצגת הדפדפן)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openSession, readMockDb, readUserscript, evalRetry, sleep, URLS, SITE } from './harness.js';

const T = '\t';
const SEL = {
  panel: '#tt-panel',
  tab: '#tt-tab-messages',
  root: '#tt-messages-root',
  modeTable: '#tt-messages-mode-table',
  bulkRun: '#tt-messages-bulk-run',
  stop: '#tt-messages-stop',
  scan: '#tt-messages-scan',
  scanStatus: '#tt-messages-scan-status',
  scanned: '#tt-messages-scanned',
  input: '#tt-messages-input',
  load: '#tt-messages-load',
  loadStatus: '#tt-messages-load-status',
  runTable: '#tt-messages-run-table',
  results: '#tt-messages-results',
  report: '#tt-messages-report',
  status: '#tt-messages-status',
  log: '#tt-log',
};

let browser;
let script;

async function openMessages(page) {
  await page.goto(URLS.messages());
  await page.waitForSelector(SEL.panel, { timeout: 10000 });
  await page.click(SEL.tab);
  await page.waitForSelector(SEL.bulkRun, { timeout: 5000 });
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

// שורות טבלה → מערך של מערכי-תאים (טקסט).
async function readTable(page, sel) {
  return evalRetry(page, (s) => Array.from(document.querySelectorAll(`${s} table tbody tr`))
    .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim())), sel);
}

async function readLog(page) {
  return evalRetry(page, (s) => { const el = document.querySelector(s.log); return el ? el.textContent : ''; }, SEL);
}

const byId = (db, id) => db.messages.find((m) => m.id === id);
const pageErrors = (lines) => lines.filter((l) => l.startsWith('PAGEERROR')).join('\n');

describe('טיפול בהודעות: סביבת דמה', () => {
  before(async () => { browser = await launch(); script = readUserscript(); });
  after(async () => { if (browser) await browser.close(); });

  test('1 מצב גורף: 8 "נשלחה" בשני עמודים (מתחיל בסינון "טופלה") → כולן "טופלה"; מעברים approve, אחרות handled', async () => {
    const { context, page, consoleLines } = await openSession(browser, { scenario: { messagesInitialFilter: '2' }, script });
    try {
      await openMessages(page);
      await page.click(SEL.bulkRun);
      const rep = await waitForReport(page);
      const log = await readLog(page);
      assert.match(rep.text, /בוצעו=8/, rep.text + '\n' + log);
      assert.match(rep.text, /נכשלו=0/, rep.text);
      assert.doesNotMatch(rep.text, /נעצר/);
      assert.match(log, /משנה סינון ל"נשלחה"/, 'הסקריפט היה צריך להחליף את הסינון מ"טופלה" ל"נשלחה"');

      const db = await readMockDb(page);
      assert.equal(db.messages.filter((m) => m.status === 'נשלחה').length, 0, 'נשארו הודעות במצב נשלחה');
      for (const id of ['m01', 'm03', 'm05', 'm07']) assert.equal(byId(db, id).handledBy, 'approve', id);
      for (const id of ['m02', 'm04', 'm06', 'm08']) assert.equal(byId(db, id).handledBy, 'handled', id);
      // ההודעות שכבר היו "טופלה" לא נגעו בהן
      assert.equal(byId(db, 'm12').handledBy, 'decline');
      assert.equal(byId(db, 'm09').handledBy, 'approve');

      const rows = await readTable(page, SEL.results);
      assert.equal(rows.length, 8, 'טבלת התוצאות');
      assert.ok(rows.every((r) => r[4] === 'בוצע'), JSON.stringify(rows));
      assert.ok(rows.some((r) => r[2] === '012345678'), 'ת.ז. מלאה בטבלת התוצאות');
      assert.doesNotMatch(log, /012345678/, 'ת.ז. מלאה דלפה ליומן');
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  test('2 לפי טבלה: סריקה → 8 שורות עם ת.ז.; הדבקה (דחייה, דלג, טופל, דחייה-לא-חוקית) → ביצוע ודוח', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script });
    try {
      await openMessages(page);
      await page.click(SEL.modeTable);
      await page.click(SEL.scan);
      const scanTxt = await waitForScan(page);
      assert.match(scanTxt, /נסרקו 8 הודעות מ-2 עמודים/, scanTxt);

      const scanned = await readTable(page, SEL.scanned); // [uid, נושא, ת.ז., תאריך, פעולה מוצעת]
      assert.equal(scanned.length, 8);
      const transfers = scanned.filter((r) => r[1] === 'בקשת מעבר תלמיד');
      assert.equal(transfers.length, 4);
      assert.ok(transfers.every((r) => r[4] === 'אישור מעבר'));
      assert.ok(scanned.filter((r) => r[1] !== 'בקשת מעבר תלמיד').every((r) => r[4] === 'שנה מצב הודעה לטופל'));
      const m01 = scanned.find((r) => r[2] === '012345678');
      const m02 = scanned.find((r) => r[2] === '023456789');
      const m04 = scanned.find((r) => r[1] === 'הודעה כללית');
      const m06 = scanned.find((r) => r[2] === 'AB1234567');
      assert.ok(m01 && m02 && m04 && m06, JSON.stringify(scanned));

      const header = ['UID', 'נושא', 'ת.ז./דרכון', 'תאריך', 'גוף ההודעה', 'פעולה'].join(T);
      const line = (r, action) => [r[0], r[1], r[2], r[3], 'גוף', action].join(T);
      const pasted = [header, line(m01, 'דחיית מעבר'), line(m02, 'דלג'), line(m04, 'טופל'), line(m06, 'דחה')].join('\n');
      await page.fill(SEL.input, pasted);
      await page.click(SEL.load);
      const loadTxt = await evalRetry(page, (s) => document.querySelector(s.loadStatus).textContent, SEL);
      assert.match(loadTxt, /נטענו 4: אישור=0, דחיה=2, טופל=1, דילוג=1/, loadTxt);

      await page.click(SEL.runTable);
      const rep = await waitForReport(page);
      assert.match(rep.text, /בוצעו=2/, rep.text);
      assert.match(rep.text, /נכשלו=1/, rep.text);
      assert.match(rep.text, /דולגו=1/, rep.text);
      assert.match(rep.text, new RegExp(m06[0]), 'שורת "מה נשאר" להודעה שנכשלה');

      const db = await readMockDb(page);
      assert.equal(byId(db, 'm01').status, 'טופלה');
      assert.equal(byId(db, 'm01').handledBy, 'decline');
      assert.equal(byId(db, 'm02').status, 'נשלחה', 'המדולגת צריכה להישאר נשלחה');
      assert.equal(byId(db, 'm02').handledBy, undefined);
      assert.equal(byId(db, 'm04').handledBy, 'handled');
      assert.equal(byId(db, 'm06').status, 'נשלחה', 'דחייה על הודעה שאינה בקשת-מעבר לא אמורה לשנות כלום');
      assert.equal(byId(db, 'm03').status, 'נשלחה', 'הודעה שלא בטבלה לא נוגעים בה');

      const rows = await readTable(page, SEL.results);
      const st = Object.fromEntries(rows.map((r) => [r[0], r[4]]));
      assert.equal(st[m01[0]], 'בוצע');
      assert.equal(st[m02[0]], 'דילוג');
      assert.equal(st[m04[0]], 'בוצע');
      assert.match(st[m06[0]], /^נכשל/);
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  test('3 עצור באמצע ריצה גורפת → הריצה נעצרת, הדוח מציג "נעצר", נשארו "נשלחה"', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script, delayMs: 500 });
    try {
      await openMessages(page);
      await page.click(SEL.bulkRun);
      await sleep(900);
      await page.click(SEL.stop);
      const rep = await waitForReport(page, 30000);
      assert.match(rep.text, /נעצר/, rep.text);
      assert.match(rep.status, /נעצר/, rep.status);
      const db = await readMockDb(page);
      const remaining = db.messages.filter((m) => m.status === 'נשלחה').length;
      const done = db.messages.filter((m) => m.handledAt).length;
      assert.ok(remaining > 0, 'העצירה לא עצרה: כל ההודעות טופלו');
      assert.ok(done >= 1, 'לא בוצעה אף פעולה לפני העצירה');
      assert.ok(remaining + done === 8, `remaining=${remaining} done=${done}`);
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  test('4 דף אחר (לא הודעות): הלשונית מציגה רק "עובד בדף ההודעות בלבד"', async () => {
    const { context, page } = await openSession(browser, { script });
    try {
      await page.goto(`${SITE}/`);
      await page.waitForSelector(SEL.panel, { timeout: 10000 });
      await page.click(SEL.tab);
      const txt = await evalRetry(page, (s) => document.querySelector(s.root).innerText, SEL);
      assert.match(txt, /בדף ההודעות בלבד/);
      const hasButtons = await page.$(SEL.bulkRun);
      assert.equal(hasButtons, null, 'לא אמורים להיות כפתורי-פעולה בדף אחר');
    } finally { await context.close(); }
  });
});
