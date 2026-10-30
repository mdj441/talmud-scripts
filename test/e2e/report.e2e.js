// דיווח חודשי: תרחישי e2e על סביבת-הדמה. הסקריפט האמיתי (dist/) רץ בכרום אמיתי; הריצה חוצה
// טעינות-דף (ניווט בין סניפים) וממשיכה אחרי כל טעינה. הרצה: npm run build && node --test "test/e2e/report.e2e.js"
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openSession, readMockDb, readUserscript, URLS, sleep } from './harness.js';

const SEL = {
  panel: '#tt-panel',
  tab: '#tt-tab-report',
  start: '#tt-report-start',
  stop: '#tt-report-stop',
  status: '#tt-report-status',
  results: '#tt-report-results',
  report: '#tt-report-report',
};
const STATE_KEY = 'talmud.report.state';

let browser;
let script;

// evaluate בסבלנות: טעינת דף באמצע משמידה את ההקשר, ואז מנסים שוב.
async function evalPatient(page, fn, arg, timeoutMs = 10000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    try { return await page.evaluate(fn, arg); } catch (e) { last = e; await sleep(150); }
  }
  throw last || new Error('evalPatient: timeout');
}

// ממתין לסיכום (#tt-report-report לא hidden ולא ריק), חוצה ניווטים מלאים.
async function waitForReportDone(page, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const st = await page.evaluate((s) => {
        const rep = document.querySelector(s.report);
        const status = document.querySelector(s.status);
        return {
          done: !!rep && !rep.hidden && rep.innerHTML.trim() !== '',
          reportText: rep ? rep.innerText : '',
          status: status ? status.textContent : '',
        };
      }, SEL);
      if (st.done) return st;
    } catch (e) { /* ניווט באמצע */ }
    await sleep(100);
  }
  throw new Error(`waitForReportDone: timeout after ${timeoutMs}ms`);
}

async function readReportRows(page) {
  return evalPatient(page, (s) => Array.from(document.querySelectorAll(`${s.results} table tbody tr`)).map((tr) => {
    const c = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim());
    return { branch: c[0], status: c[1], detail: c[2] };
  }), SEL);
}

async function waitForRows(page, n, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const count = await page.evaluate((s) => document.querySelectorAll(`${s.results} table tbody tr`).length, SEL);
      if (count >= n) return count;
    } catch (e) { /* ניווט באמצע */ }
    await sleep(100);
  }
  throw new Error(`waitForRows(${n}): timeout`);
}

async function readLog(page) {
  return evalPatient(page, () => { const el = document.querySelector('#tt-log'); return el ? el.textContent : ''; });
}

// דף מוסד → לשונית "דיווח חודשי" → "התחל"
async function startReport(page, url) {
  await page.goto(url);
  await page.waitForSelector(SEL.panel, { timeout: 10000 });
  await page.click(SEL.tab);
  await page.waitForSelector(`${SEL.start}:not([disabled])`, { timeout: 10000 });
  await page.click(SEL.start);
}

describe('דיווח חודשי: סביבת דמה', () => {
  before(async () => { browser = await launch(); script = readUserscript(); });
  after(async () => { if (browser) await browser.close(); });

  test('1. שלושה סניפים, 16 כבר דווח → 00 נשלח, 05 נשלח, 16 דולג; המסד מסומן; הריצה חוצה טעינות-דף', async () => {
    const { context, page, consoleLines } = await openSession(browser, { scenario: { reported: { '4159': true } }, script });
    try {
      await startReport(page, URLS.institute(491));
      const done = await waitForReportDone(page);
      const rows = await readReportRows(page);
      const logText = await readLog(page);
      assert.deepEqual(rows.map((r) => [r.branch, r.status]), [['00', 'נשלח'], ['05', 'נשלח'], ['16', 'דולג (כבר דווח)']], logText);
      assert.match(done.reportText, /נשלחו 2, דולגו 1, שגיאות 0/);
      assert.match(done.reportText, /הכול טופל/);
      assert.match(done.status, /הסתיים/);

      const db = await readMockDb(page);
      assert.equal(db.reported['491'], true, 'סניף 00 (491) לא סומן כדווח');
      assert.equal(db.reported['4200'], true, 'סניף 05 (4200) לא סומן כדווח');
      assert.equal(db.reported['4159'], true, 'סניף 16 (4159) היה אמור להישאר מסומן');
      assert.equal(db.log.filter((l) => /monthly report sent/.test(l)).length, 2, db.log.join('\n'));

      // חצה טעינות-דף: התחלנו ב-491 וסיימנו בדף של סניף 16 (4159)
      assert.match(page.url(), /InstituteID=4159/);
      assert.match(logText, /לוחצים "המשך"/, 'שורת-יומן על לחיצת "המשך" חסרה');
      assert.match(logText, /\[המשך\] סניף 2\/3/, 'ההמשך אחרי טעינת דף לא נרשם ביומן');
      // המצב השמור נוקה בסיום
      assert.equal(await evalPatient(page, (k) => sessionStorage.getItem(k), STATE_KEY), null);
      const errors = consoleLines.filter((l) => l.startsWith('PAGEERROR'));
      assert.equal(errors.length, 0, errors.join('\n'));
    } finally { await context.close(); }
  });

  test('2. עצירה אחרי הסניף הראשון → 00 נשלח, 05 ו-16 "נעצר"; הסיכום מוצג; המסד לא נגע ב-05', async () => {
    const { context, page } = await openSession(browser, { script });
    try {
      await startReport(page, URLS.institute(491));
      await waitForRows(page, 1);
      // דגל העצירה במצב השמור (כמו שכפתור "עצור" עושה), עמיד גם כשהדף באמצע טעינה
      const flagged = await evalPatient(page, (k) => {
        const st = JSON.parse(sessionStorage.getItem(k) || 'null');
        if (!st) return false;
        st.stop = true;
        sessionStorage.setItem(k, JSON.stringify(st));
        return true;
      }, STATE_KEY);
      assert.equal(flagged, true, 'לא נמצא מצב שמור לסמן בו עצירה');
      try { await page.click(SEL.stop, { timeout: 1500 }); } catch (e) { /* הדף באמצע טעינה: הדגל כבר נשמר */ }

      const done = await waitForReportDone(page);
      const rows = await readReportRows(page);
      const logText = await readLog(page);
      assert.deepEqual(rows.map((r) => [r.branch, r.status]), [['00', 'נשלח'], ['05', 'נעצר'], ['16', 'נעצר']], logText);
      assert.match(done.reportText, /נשלחו 1, דולגו 0, שגיאות 0, נעצרו 2/);
      assert.match(done.reportText, /סניף 05/);
      assert.match(done.reportText, /סניף 16/);

      const db = await readMockDb(page);
      assert.equal(db.reported['491'], true);
      assert.notEqual(db.reported['4200'], true, 'סניף 05 נשלח למרות העצירה');
      assert.notEqual(db.reported['4159'], true, 'סניף 16 נשלח למרות העצירה');
      assert.equal(await evalPatient(page, (k) => sessionStorage.getItem(k), STATE_KEY), null);
    } finally { await context.close(); }
  });

  test('3. כל הסניפים כבר דווחו → שלושה "דולג", בלי שליחה', async () => {
    const { context, page } = await openSession(browser, { scenario: { reported: { '491': true, '4200': true, '4159': true } }, script });
    try {
      await startReport(page, URLS.institute(491));
      const done = await waitForReportDone(page);
      const rows = await readReportRows(page);
      assert.deepEqual(rows.map((r) => r.status), ['דולג (כבר דווח)', 'דולג (כבר דווח)', 'דולג (כבר דווח)']);
      assert.match(done.reportText, /נשלחו 0, דולגו 3, שגיאות 0/);
      const db = await readMockDb(page);
      assert.equal(db.log.filter((l) => /monthly report sent/.test(l)).length, 0, 'נשלח דיווח לסניף שכבר דווח');
    } finally { await context.close(); }
  });

  test('4. התחלה מדף של סניף 16: הסדר נשאר 00, 05, 16 (ניווט הלוך וחזור) והכל נשלח', async () => {
    const { context, page } = await openSession(browser, { script });
    try {
      await startReport(page, URLS.institute(4159));
      const done = await waitForReportDone(page, 120000);
      const rows = await readReportRows(page);
      const logText = await readLog(page);
      assert.deepEqual(rows.map((r) => [r.branch, r.status]), [['00', 'נשלח'], ['05', 'נשלח'], ['16', 'נשלח']], logText);
      assert.match(done.reportText, /נשלחו 3, דולגו 0, שגיאות 0/);
      const db = await readMockDb(page);
      assert.deepEqual([db.reported['491'], db.reported['4200'], db.reported['4159']], [true, true, true]);
    } finally { await context.close(); }
  });
});
