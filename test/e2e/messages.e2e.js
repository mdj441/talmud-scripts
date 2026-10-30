// תרחישי כלי ההודעות על סביבת-הדמה. הסקריפט האמיתי (dist/) רץ בכרום אמיתי. כל התעודות בדויות.
// הרצה: npm run build && node --test "test/e2e/messages.e2e.js"   (HEADED=1 להצגת הדפדפן)
// הדמה: 11 הודעות "נשלחה" ב-3 עמודים (5 בעמוד): m01-m08, m13 (זהה ל-m01: אותו UID), m14 (כמו m03 בנוסח
// "תזכורת": UID שונה, אותה ת.ז.), m15 (בקשת מעבר על 078901234 לסניף 16). אחרי מיזוג: 9 שורות.
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
const SENT_IDS = ['m01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm13', 'm14', 'm15'];

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

// שורות טבלה → מערך של מערכי-תאים (טקסט).
async function readTable(page, sel) {
  return evalRetry(page, (s) => Array.from(document.querySelectorAll(`${s} table tbody tr`))
    .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim())), sel);
}

// טבלת הסקירה: [{uid, uids, id, header, body, date, count, roster, done, decision, hidden}]
async function readReview(page) {
  return evalRetry(page, (s) => Array.from(document.querySelectorAll(`${s.scanned} table tbody tr`)).map((tr) => {
    const td = Array.from(tr.querySelectorAll('td'));
    const sel = tr.querySelector('select');
    return {
      uid: tr.getAttribute('data-uid'), uids: (tr.getAttribute('data-uids') || '').split(',').filter(Boolean),
      id: td[0].textContent.trim(), header: td[1].textContent.trim(), body: td[2].textContent.trim(), bodyFull: td[2].getAttribute('title') || '',
      date: td[3].textContent.trim(), count: td[4].textContent.trim(), roster: td[5].textContent.trim(),
      done: !!tr.querySelector('.tt-tag-done'), decision: sel ? sel.value : '', hidden: tr.hidden,
    };
  }), SEL);
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

  test('1 מצב גורף: 11 "נשלחה" בשלושה עמודים (מתחיל בסינון "טופלה") → כולן "טופלה"; מעברים approve, אחרות handled', async () => {
    const { context, page, consoleLines } = await openSession(browser, { scenario: { messagesInitialFilter: '2' }, script });
    try {
      await openBulk(page);
      await page.click(SEL.bulkRun);
      const rep = await waitForReport(page);
      const log = await readLog(page);
      assert.match(rep.text, /בוצעו=11/, rep.text + '\n' + log);
      assert.match(rep.text, /נכשלו=0/, rep.text);
      assert.doesNotMatch(rep.text, /נעצר/);
      assert.match(log, /משנה סינון ל"נשלחה"/, 'הסקריפט היה צריך להחליף את הסינון מ"טופלה" ל"נשלחה"');

      const db = await readMockDb(page);
      assert.equal(db.messages.filter((m) => m.status === 'נשלחה').length, 0, 'נשארו הודעות במצב נשלחה');
      for (const id of ['m01', 'm03', 'm05', 'm07', 'm13', 'm14', 'm15']) assert.equal(byId(db, id).handledBy, 'approve', id);
      for (const id of ['m02', 'm04', 'm06', 'm08']) assert.equal(byId(db, id).handledBy, 'handled', id);
      // ההודעות שכבר היו "טופלה" לא נגעו בהן
      assert.equal(byId(db, 'm12').handledBy, 'decline');
      assert.equal(byId(db, 'm09').handledBy, 'approve');

      const rows = await readTable(page, SEL.results);
      assert.equal(rows.length, 11, 'טבלת התוצאות');
      assert.ok(rows.every((r) => r[4] === 'בוצע'), JSON.stringify(rows));
      assert.ok(rows.some((r) => r[2] === '012345678'), 'ת.ז. מלאה בטבלת התוצאות');
      assert.doesNotMatch(log, /012345678/, 'ת.ז. מלאה דלפה ליומן');
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  test('2 דרך אקסל: סריקה → הדבקה (דחייה, דלג, טופל, דחייה-לא-חוקית) → ביצוע; דחייה על UID כפול מטפלת בשני המופעים', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script });
    try {
      await openMessages(page);
      const scanTxt = await scanAndWait(page);
      assert.match(scanTxt, /נסרקו 11 הודעות מ-3 עמודים \(9 שורות אחרי מיזוג כפילויות\)/, scanTxt);

      const review = await readReview(page);
      assert.equal(review.length, 9);
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
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  test('3 עצור באמצע ריצה גורפת → הריצה נעצרת, הדוח מציג "נעצר", נשארו "נשלחה"', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script, delayMs: 500 });
    try {
      await openBulk(page);
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
      assert.ok(remaining + done === SENT_IDS.length, `remaining=${remaining} done=${done}`);
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
      const hasButtons = await page.$(SEL.scan);
      assert.equal(hasButtons, null, 'לא אמורים להיות כפתורי-פעולה בדף אחר');
    } finally { await context.close(); }
  });

  test('5 סקירה: מיזוג כפילויות (UID זהה פעמיים = 2; שני UID-ים עם אותה ת.ז. = 2) → שינוי החלטה בשורה ממוזגת → בצע → שתי ההודעות טופלו', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script });
    try {
      await openMessages(page);
      await scanAndWait(page);
      const review = await readReview(page);
      assert.equal(review.length, 9, JSON.stringify(review));
      const r01 = review.find((r) => r.id === '012345678');
      const r03 = review.find((r) => r.id === '034567890');
      assert.equal(r01.count, '2', 'm01 + m13 (אותו UID)');
      assert.equal(r01.uids.length, 1);
      assert.equal(r03.count, '2', 'm03 + m14 (UID שונה, אותה ת.ז.)');
      assert.equal(r03.uids.length, 2);
      assert.ok(review.filter((r) => r.count !== '1').length === 2, 'רק שתי שורות ממוזגות');
      assert.ok(review.every((r) => r.roster === ''), 'בלי מצבת: עמודת "במצבת" ריקה');
      assert.ok(review.filter((r) => r.header === 'בקשת מעבר תלמיד').every((r) => r.decision === APPROVE));
      assert.ok(review.filter((r) => r.header !== 'בקשת מעבר תלמיד').every((r) => r.decision === HANDLED));
      assert.ok(r01.bodyFull.includes('012345678'), 'הגוף המלא ב-title');
      const summary0 = await readText(page, SEL.summary);
      assert.match(summary0, /9 שורות · אישור מעבר=5 · דחיית מעבר=0 · טופל=4 · דלג=0/, summary0);

      await setDecision(page, r03.uid, DECLINE);
      const summary1 = await readText(page, SEL.summary);
      assert.match(summary1, /אישור מעבר=4 · דחיית מעבר=1/, summary1);

      await page.click(SEL.runReview);
      const rep = await waitForReport(page);
      assert.match(rep.text, /בוצעו=11 · נכשלו=0 · דולגו=0/, rep.text + '\n' + (await readLog(page)));

      const db = await readMockDb(page);
      assert.equal(byId(db, 'm03').handledBy, 'decline');
      assert.equal(byId(db, 'm14').handledBy, 'decline', 'ההחלטה חלה על כל ה-UID-ים של השורה הממוזגת');
      assert.equal(byId(db, 'm01').handledBy, 'approve');
      assert.equal(byId(db, 'm13').handledBy, 'approve');
      assert.equal(byId(db, 'm15').handledBy, 'approve', 'בלי מצבת אין "כבר בוצע"');
      for (const id of ['m02', 'm04', 'm06', 'm08']) assert.equal(byId(db, id).handledBy, 'handled', id);
      assert.equal(db.messages.filter((m) => m.status === 'נשלחה').length, 0);
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  // ממצא ב-10: "כבר בוצע" הוא רמז לבדיקה: ההחלטה נשארת "אישור מעבר" עד שלוחצים "כל 'כבר בוצע': סמן כטופל".
  test('6 מצבת: הדבקה → "במצבת" / "לא במצבת" / ריק; "כבר בוצע" לא משנה את ההחלטה; הכפתור "כל \'כבר בוצע\': סמן כטופל" מחיל; הביצוע לא מאשר אותה', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script });
    try {
      await openMessages(page);
      await scanAndWait(page);
      await page.click(SEL.rosterSummary);
      // כמו הדבקה מאקסל: כותרת, טאבים, אפסים מובילים שנמחקו
      await page.fill(SEL.rosterInput, ['סניף' + T + 'ת.ז./דרכון', '16' + T + '78901234', '05' + T + '12345678', '16' + T + 'AB1234567'].join('\n'));
      await page.click(SEL.rosterLoad);
      const rosterTxt = await readText(page, SEL.rosterStatus);
      assert.match(rosterTxt, /נטענה מצבת: 3 שורות/, rosterTxt);

      const review = await readReview(page);
      const r15 = review.find((r) => r.id === '078901234');
      const r01 = review.find((r) => r.id === '012345678');
      const r02 = review.find((r) => r.id === '023456789');
      const r04 = review.find((r) => r.header === 'הודעה כללית');
      const r06 = review.find((r) => r.id === 'AB1234567');
      assert.match(r15.roster, /סניף 16/, JSON.stringify(r15));
      assert.equal(r15.done, true, 'תלמיד שכבר בסניף-היעד → כבר בוצע');
      assert.equal(r15.decision, APPROVE, 'ממצא ב-10: התג אינו משנה את ההחלטה מעצמו');
      let summaryBefore = await readText(page, SEL.summary);
      assert.match(summaryBefore, /אישור מעבר=5 .* טופל=4 .* כבר בוצע=1/, summaryBefore);
      await page.click(SEL.allDone);
      const r15b = (await readReview(page)).find((r) => r.id === '078901234');
      assert.equal(r15b.decision, HANDLED, 'הכפתור מחיל "סמן כטופל" על המסומנות "כבר בוצע"');
      assert.match(r01.roster, /סניף 05/);
      assert.equal(r01.done, false, 'במצבת בסניף 05, מבקש ל-16 → עדיין לא בוצע');
      assert.equal(r01.decision, APPROVE);
      assert.equal(r02.roster, 'לא במצבת');
      assert.equal(r04.roster, '', 'בלי ת.ז.: עמודה ריקה');
      assert.match(r06.roster, /סניף 16/);
      assert.equal(r06.done, false, 'לא בקשת מעבר');
      const summary = await readText(page, SEL.summary);
      assert.match(summary, /אישור מעבר=4 .* טופל=5 .* כבר בוצע=1/, summary);

      await page.click(SEL.runReview);
      const rep = await waitForReport(page);
      assert.match(rep.text, /בוצעו=11 · נכשלו=0/, rep.text);
      const db = await readMockDb(page);
      assert.equal(byId(db, 'm15').handledBy, 'handled', 'המעבר שכבר בוצע סומן כטופל, לא אושר שוב');
      assert.equal(byId(db, 'm01').handledBy, 'approve');
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
      assert.match(summary, /דלג=9/, summary);
      let review = await readReview(page);
      assert.ok(review.every((r) => r.decision === SKIP));

      await page.click(SEL.allTransfers);
      summary = await readText(page, SEL.summary);
      assert.match(summary, /אישור מעבר=5 .* דלג=4/, summary);

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
      assert.match(summary, /אישור מעבר=5 · דחיית מעבר=0 · טופל=1 · דלג=3/, summary);

      await page.click(SEL.runReview);
      const rep = await waitForReport(page);
      assert.match(rep.text, /בוצעו=8 · נכשלו=0 · דולגו=3/, rep.text);
      const db = await readMockDb(page);
      for (const id of ['m01', 'm03', 'm05', 'm07', 'm13', 'm14', 'm15']) assert.equal(byId(db, id).handledBy, 'approve', id);
      assert.equal(byId(db, 'm02').handledBy, 'handled');
      for (const id of ['m04', 'm06', 'm08']) assert.equal(byId(db, id).status, 'נשלחה', `${id} דולגה`);
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  test('8 Escape באמצע "בצע לפי הטבלה" → נעצר, נשארו "נשלחה", הטבלה נשארת לסבב הבא', async () => {
    const { context, page, consoleLines } = await openSession(browser, { script, delayMs: 500 });
    try {
      await openMessages(page);
      await scanAndWait(page);
      await page.click(SEL.runReview);
      await sleep(900);
      await page.keyboard.press('Escape');
      const rep = await waitForReport(page, 30000);
      assert.match(rep.text, /נעצר/, rep.text);
      const db = await readMockDb(page);
      const remaining = db.messages.filter((m) => m.status === 'נשלחה').length;
      const done = db.messages.filter((m) => m.handledAt).length;
      assert.ok(remaining > 0 && done >= 1 && remaining + done === SENT_IDS.length, `remaining=${remaining} done=${done}`);
      const review = await readReview(page);
      assert.equal(review.length, 9, 'טבלת הסקירה נשארת אחרי עצירה');
      const runEnabled = await evalRetry(page, (s) => !document.querySelector(s.runReview).disabled, SEL);
      assert.equal(runEnabled, true, '"בצע לפי הטבלה" חוזר להיות זמין');
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });

  // ממצא ב-4: האתר חוזר לעמוד 1 אחרי פעולה. (א) m06 (עמוד 2, אינה בקשת-מעבר) עם "דחיית מעבר": האתר מודיע
  // שגיאה ולא משנה כלום; הגריד המוצג (עמוד 1) אינו ראיה → "נכשל: הגריד חזר לעמוד אחר", לא "בוצע".
  // (ב) m15 (עמוד 3) "תקועה": חלונית-הצלחה אך נשארת "נשלחה"; מסלול האקסל בלי כמות → בלי התיקון היא
  // מקבלת פעולה שוב ושוב עד תקרת הלולאה. עם התיקון: פעולה אחת, ובסבב הבא שורת-כישלון בדוח.
  test('9 ממצא ב-4: הגריד חוזר לעמוד 1 אחרי פעולה → פעולה שנכשלה לא מדווחת "בוצע"; הודעה "תקועה" לא מקבלת פעולה פעמיים', async () => {
    const { context, page, consoleLines } = await openSession(browser, { scenario: { messagesResetPageAfterAction: true, messagesStuck: ['m15'] }, script });
    try {
      await openMessages(page);
      await scanAndWait(page);
      const review = await readReview(page);
      const m06 = review.find((r) => r.id === 'AB1234567');
      const m15 = review.find((r) => r.id === '078901234');
      assert.ok(m06 && m15, JSON.stringify(review));
      await page.click(SEL.excelSummary);
      const header = ['UID', 'נושא', 'ת.ז./דרכון', 'תאריך', 'גוף ההודעה', 'פעולה'].join(T);
      const line = (r, action) => [r.uid, r.header, r.id, r.date, 'גוף', action].join(T);
      await page.fill(SEL.input, [header, line(m06, DECLINE), line(m15, APPROVE)].join('\n'));
      await page.click(SEL.load);
      await page.click(SEL.runTable);
      const rep = await waitForReport(page, 60000);
      const log = await readLog(page);
      assert.match(rep.text, /בוצעו=1 · נכשלו=2/, rep.text + '\n' + log);
      const db = await readMockDb(page);
      assert.equal(byId(db, 'm06').status, 'נשלחה');
      assert.equal(byId(db, 'm06').handledBy, undefined);
      assert.equal((db.stuckAttempts || {}).m15, 1, `m15 קיבלה פעולה ${(db.stuckAttempts || {}).m15} פעמים`);
      const rows = await readTable(page, SEL.results);
      const st = {};
      for (const r of rows) st[r[0]] = (st[r[0]] || []).concat(r[4]);
      assert.equal(st[m06.uid].length, 1);
      assert.match(st[m06.uid][0], /^נכשל: הגריד חזר לעמוד אחר אחרי הפעולה/, st[m06.uid][0]);
      assert.match(st[m06.uid][0], /הפעולה אפשרית רק עבור בקשת מעבר/, st[m06.uid][0]);
      assert.deepEqual(st[m15.uid].map((s) => s.replace(/:.*$/, '')), ['בוצע', 'נכשל']);
      assert.match(rep.text, new RegExp(m15.uid), 'שורת "מה נשאר" להודעה התקועה');
      assert.equal(pageErrors(consoleLines), '', pageErrors(consoleLines));
    } finally { await context.close(); }
  });
});
