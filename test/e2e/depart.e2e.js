// תרחישי העזיבה על סביבת-הדמה: הסקריפט האמיתי (dist/) רץ בכרום אמיתי מול mock/.
// כל התעודות בדויות. הרצה: npm run build && node --test "test/e2e/depart.e2e.js"  (HEADED=1 להצגה)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openSession, readMockDb, readUserscript, evalRetry, waitForPanel, sleep, URLS } from './harness.js';

const T = '\t';
const SEL = {
  panel: '#tt-panel', tab: '#tt-tab-depart', input: '#tt-depart-input', start: '#tt-depart-start', date: '#tt-depart-date',
  reason: '#tt-depart-reason', status: '#tt-depart-status', results: '#tt-depart-results', report: '#tt-depart-report', log: '#tt-log',
};
const DEFAULT_00 = [
  { id: '012345678', idType: '1', first: 'ראובן', last: 'כהן', birth: '01/01/1990' },
  { id: '023456789', idType: '1', first: 'שמעון', last: 'לוי', birth: '02/02/1991' },
];

let browser;
let script;

// ממתין לדוח "מה נשאר" (לא hidden ולא ריק), חוצה ניווטים מלאים.
async function waitForDepartDone(page, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const st = await page.evaluate((s) => {
        const rep = document.querySelector(s.report);
        const status = document.querySelector(s.status);
        return { done: !!rep && !rep.hidden && rep.innerHTML.trim() !== '', status: status ? status.textContent : '' };
      }, SEL);
      if (st.done) return st;
    } catch (e) { /* ניווט באמצע */ }
    await sleep(250);
  }
  throw new Error(`waitForDepartDone: timeout after ${timeoutMs}ms`);
}

async function readDepartResults(page) {
  return evalRetry(page, (s) => Array.from(document.querySelectorAll(`${s.results} table tbody tr`)).map((tr) => {
    const c = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim());
    return { branch: c[0], identity: c[1], status: c[2], detail: tr.getAttribute('title') || '' };
  }), SEL);
}

// textContent ולא innerText: היומן יושב בתוך <details> מקופל, ו-innerText של תוכן מוסתר ריק.
async function readText(page, sel) {
  return evalRetry(page, (q) => { const el = document.querySelector(q); return el ? el.textContent : ''; }, sel);
}

async function runDepart(page, text, { startUrl, date = '', reason = '', timeoutMs = 90000 } = {}) {
  if (startUrl) await page.goto(startUrl);
  await waitForPanel(page, SEL);
  await page.click(SEL.tab);
  await page.fill(SEL.input, text);
  if (date) await page.fill(SEL.date, date);
  if (reason) await page.selectOption(SEL.reason, reason);
  await page.click(SEL.start);
  const done = await waitForDepartDone(page, timeoutMs);
  const results = await readDepartResults(page);
  const report = await readText(page, SEL.report);
  const log = await readText(page, SEL.log);
  return { done, results, report, log };
}

describe('עזיבת תלמידים - סביבת דמה', () => {
  before(async () => { browser = await launch(); script = readUserscript(); });
  after(async () => { if (browser) await browser.close(); });

  async function session(scenario) { return openSession(browser, { scenario, script }); }

  test('1 תלמיד קיים בסניף 00 → "הצליח", ותאריך העזיבה נשמר במסד-הדמה', async () => {
    const { context, page, consoleLines } = await session();
    try {
      const run = await runDepart(page, `00${T}012345678`, { startUrl: URLS.institute(491), date: '01/09/2026', reason: '3' });
      assert.equal(run.results.length, 1, run.log);
      assert.equal(run.results[0].status, 'הצליח', run.log);
      assert.equal(run.results[0].identity, '012345678');
      const db = await readMockDb(page);
      const row = db.enrolled['10002'].find((s) => s.id === '012345678');
      assert.equal(row.left, '01/09/2026', 'תאריך העזיבה לא נשמר');
      assert.equal(row.leaveReason, '3', 'סיבת העזיבה לא נשמרה');
      assert.match(run.report, /הכול טופל/);
      assert.ok(!consoleLines.some((l) => l.startsWith('PAGEERROR')), consoleLines.filter((l) => l.startsWith('PAGEERROR')).join('\n'));
    } finally { await context.close(); }
  });

  test('2 ת.ז. שאינה במוסד → "לא נמצא" עם הוראה בדוח, בלי שינוי במסד', async () => {
    const { context, page } = await session();
    try {
      const run = await runDepart(page, `00${T}099999999`, { startUrl: URLS.institute(491) });
      assert.equal(run.results.length, 1, run.log);
      assert.equal(run.results[0].status, 'לא נמצא', run.log);
      assert.match(run.report, /099999999/);
      assert.match(run.report, /לא נמצא/);
      const db = await readMockDb(page);
      assert.ok(db.enrolled['10002'].every((s) => !s.left), 'תלמיד אחר סומן כעוזב');
    } finally { await context.close(); }
  });

  test('3 תלמיד שכבר עזב → "כבר בוצעה עזיבה (תאריך)" בלי לגעת בו', async () => {
    const seeded = [Object.assign({}, DEFAULT_00[0], { left: '15/05/2026' }), DEFAULT_00[1]];
    const { context, page } = await session({ enrolled: { '10002': seeded } });
    try {
      const run = await runDepart(page, `00${T}012345678`, { startUrl: URLS.institute(491), date: '01/09/2026' });
      assert.equal(run.results.length, 1, run.log);
      assert.equal(run.results[0].status, 'כבר בוצעה עזיבה (15/05/2026)', run.log);
      const db = await readMockDb(page);
      assert.equal(db.enrolled['10002'][0].left, '15/05/2026', 'תאריך העזיבה המקורי שונה');
      assert.match(run.report, /הכול טופל/);
    } finally { await context.close(); }
  });

  test('4 שתי שורות בשני סניפים (00 ואז 16) מדף מוסד 00 → שתיהן "הצליח" אחרי ניווט מלא והמשך', async () => {
    const scenario = { enrolled: { '10002': DEFAULT_00, '10269': [{ id: '045678901', idType: '1', first: 'יהודה', last: 'פרץ', birth: '04/04/1993' }] } };
    const { context, page, consoleLines } = await session(scenario);
    try {
      const run = await runDepart(page, `00${T}012345678\n16${T}045678901`, { startUrl: URLS.institute(491), date: '01/09/2026', timeoutMs: 120000 });
      assert.equal(run.results.length, 2, run.log);
      assert.deepEqual(run.results.map((r) => r.status), ['הצליח', 'הצליח'], run.log);
      assert.deepEqual(run.results.map((r) => r.branch), ['00', '16']);
      assert.match(page.url(), /InstituteID=4159/, 'הריצה הייתה אמורה להסתיים בדף המוסד של סניף 16');
      const db = await readMockDb(page);
      assert.equal(db.enrolled['10002'].find((s) => s.id === '012345678').left, '01/09/2026');
      assert.equal(db.enrolled['10269'].find((s) => s.id === '045678901').left, '01/09/2026');
      assert.match(run.log, /ממשיך|המשך/, 'לא נראה המשך אחרי טעינת דף ביומן');
      assert.ok(!consoleLines.some((l) => l.startsWith('PAGEERROR')), consoleLines.filter((l) => l.startsWith('PAGEERROR')).join('\n'));
      const pending = await page.evaluate(() => sessionStorage.getItem('talmud.depart.queue'));
      assert.equal(pending, null, 'התור השמור לא נוקה בסיום');
    } finally { await context.close(); }
  });

  test('5 חסימת שרת ב"אישור" → "נחסם: <הודעה>", המודאל נסגר, המסד לא השתנה, ממשיכים לתלמיד הבא', async () => {
    const { context, page } = await session({ departBlocked: { '012345678': 'תאריך העזיבה לא יכול להיות לפני תאריך הקליטה' } });
    try {
      const run = await runDepart(page, `00${T}012345678\n00${T}023456789`, { startUrl: URLS.institute(491), date: '01/09/2026' });
      assert.equal(run.results.length, 2, run.log);
      assert.equal(run.results[0].status, 'נחסם: תאריך העזיבה לא יכול להיות לפני תאריך הקליטה', run.log);
      assert.equal(run.results[1].status, 'הצליח', run.log);
      const db = await readMockDb(page);
      assert.ok(!db.enrolled['10002'].find((s) => s.id === '012345678').left, 'תלמיד חסום סומן כעוזב');
      assert.equal(db.enrolled['10002'].find((s) => s.id === '023456789').left, '01/09/2026');
      const modalShown = await page.evaluate(() => {
        const m = document.getElementById('ContentPlaceHolder1_tabInstituteDetails_TabPanel1_ucStudentsSearch_ucStudentClose_DivCloseStudent');
        return m ? getComputedStyle(m).display !== 'none' : null;
      });
      assert.equal(modalShown, false, 'מודאל העזיבה נשאר פתוח');
      assert.match(run.report, /נחסם/);
      assert.ok(!run.log.includes('012345678'), 'ת.ז. מלאה ביומן');
    } finally { await context.close(); }
  });

  test('6 אישור-רך ("המשך"/"לא") אחרי "אישור" → לוחצים "המשך" בכוונה (כמו הישן), שורת-יומן, "הצליח"', async () => {
    const { context, page } = await session({ departConfirmPopup: 'confirm' });
    try {
      const run = await runDepart(page, `00${T}023456789`, { startUrl: URLS.institute(491), date: '01/09/2026' });
      assert.equal(run.results.length, 1, run.log);
      assert.equal(run.results[0].status, 'הצליח', run.log);
      assert.match(run.log, /לוחצים "המשך"/, 'חסרה שורת-יומן על לחיצת "המשך"');
      const db = await readMockDb(page);
      assert.equal(db.enrolled['10002'].find((s) => s.id === '023456789').left, '01/09/2026');
    } finally { await context.close(); }
  });
});
