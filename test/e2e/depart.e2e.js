// תרחישי העזיבה על סביבת-הדמה: הסקריפט האמיתי (dist/) רץ בכרום אמיתי מול mock/.
// כל התעודות בדויות. הרצה: npm run build && node --test "test/e2e/depart.e2e.js"  (HEADED=1 להצגה)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openSession, readMockDb, readUserscript, evalRetry, waitForPanel, sleep, URLS, fillPasteBox } from './harness.js';

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
  return evalRetry(page, (s) => Array.from(document.querySelectorAll(`${s.results} table tbody tr[data-row]`)).map((tr) => {
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
  await fillPasteBox(page, SEL.input, text);
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
      // הכרעת בעל-המערכת 1.11.2026 (א): משפט-הסיכום רק בתיבת-המצב; באזור התוצאות תגיות וטבלה
      assert.match(run.done.status, /הסתיים: 1 מתוך 1 הצליחו\. הכול טופל/, run.done.status);
      assert.doesNotMatch(run.report, /הסתיים|הכול טופל/, 'המשפט כפול באזור התוצאות: ' + run.report);
      assert.match(run.report, /הצליחו 1/, 'התגיות נשארות: ' + run.report);
      assert.ok(!consoleLines.some((l) => l.startsWith('PAGEERROR')), consoleLines.filter((l) => l.startsWith('PAGEERROR')).join('\n'));
      // "עזיבה חדשה" (הכרעת 2.11: מחיקת תוצאות דורשת לחיצה שנייה)
      await page.click('#tt-depart-new-run');
      assert.equal(await page.textContent('#tt-depart-new-run'), 'לחץ שוב לרשימה חדשה', 'לחיצה ראשונה רק דורכת (נוסח סבב 5)');
      assert.ok(await page.$('#tt-depart-results table'), 'התוצאות עדיין מוצגות אחרי לחיצה אחת');
      await page.click('#tt-depart-new-run');
      assert.equal(await page.$eval('#tt-depart-zone-in', (el) => el.hidden), false, '"עזיבה חדשה" חוזרת להכנה');
      assert.equal(await page.$('#tt-depart-results table'), null, 'התוצאות נוקו');
      assert.equal(await page.$eval('#tt-depart-start', (b) => b.disabled), true, 'טבלה ריקה: "התחל עזיבה" לא פעיל');
    } finally { await context.close(); }
  });

  test('2 ת.ז. שאינה במוסד → "לא נמצא" עם הוראה בדוח, בלי שינוי במסד', async () => {
    const { context, page } = await session();
    try {
      const run = await runDepart(page, `00${T}099999999`, { startUrl: URLS.institute(491) });
      assert.equal(run.results.length, 1, run.log);
      assert.equal(run.results[0].status, 'לא נמצא', run.log);
      assert.match(run.report, /לבדוק 1/, 'תגית "לבדוק" בסיכום');
      assert.equal(run.results[0].identity, '099999999');
      assert.match(await page.textContent('#tt-depart-results tr.tt-act'), /בדוק שהת.ז. והסניף נכונים/, '"מה לעשות" מתחת לשורה');
      const db = await readMockDb(page);
      assert.ok(db.enrolled['10002'].every((s) => !s.left), 'תלמיד אחר סומן כעוזב');
      // זרימת-התיקון בעזיבה (עד עכשיו כוסתה רק בצילומים): "תקן והרץ שוב" → טבלה רק עם מי שדורש טיפול, "מה קרה / מה לעשות" מתחתיה
      const ids = () => page.$$eval('#tt-depart-grid tr.tt-r-main[data-i] input[data-k="identifier"]', (els) => els.map((e) => e.value).filter(Boolean));
      await page.click('#tt-depart-fix');
      assert.deepEqual(await ids(), ['099999999']);
      assert.equal(await page.$eval('#tt-depart-zone-in-title', (el) => el.textContent.trim()), 'תיקון והרצה חוזרת');
      assert.match(await page.textContent('#tt-depart-grid tr.tt-rowmsg[data-msg="0"]'), /לא נמצא\. בדוק/, '"מה קרה / מה לעשות" מתחת לשורה');
      assert.match(await page.textContent('#tt-depart-start'), /התחל עזיבה חוזרת: תלמיד אחד/);
      assert.equal(await page.$eval('#tt-depart-zone-out', (el) => el.hidden), true, 'בשלב התיקון טבלת-התוצאות לא מוצגת');
      // "התחלה מחדש" (הכרעת 2.11): לחיצה ראשונה דורכת, שנייה מנקה טבלה ותוצאות וחוזרת להכנה
      assert.equal(await page.$eval('#tt-depart-restart', (b) => b.hidden), false);
      await page.click('#tt-depart-restart');
      assert.equal(await page.textContent('#tt-depart-restart'), 'לחץ שוב לרשימה חדשה');
      assert.deepEqual(await ids(), ['099999999'], 'לחיצה אחת לא מוחקת');
      await page.click('#tt-depart-restart');
      assert.equal(await page.$eval('#tt-depart-zone-in-title', (el) => el.textContent.trim()), 'על מי מדווחים עזיבה');
      assert.deepEqual(await ids(), []);
      assert.equal(await page.$('#tt-depart-results table'), null, 'התוצאות נוקו');
      assert.equal(await page.$eval('#tt-depart-restart', (b) => b.hidden), true);
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
      assert.match(run.done.status, /הכול טופל/);
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
      // F2: לחיצת העץ טוענת מחדש את אותה כתובת (של 00); הדף עצמו הוא של סניף 16 (h1)
      assert.match(page.url(), /InstituteID=491/, 'הכתובת לא משתנה בלחיצה בעץ');
      assert.match(await page.textContent('h1'), /סניף 16/, 'הריצה הייתה אמורה להסתיים בדף המוסד של סניף 16');
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
      assert.match(run.report, /דורשים טיפול 1/);
      assert.match(run.results[0].status, /^נחסם/);
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

  test('7 (4.0.2) תור עזיבה + דף ההודעות → תיבת "הריצה נקטעה"; סרגל-השלבים "ריצה (מושהית)"; "בטל" מחזיר ל"הכנה"', async () => {
    const { context, page } = await session();
    try {
      await page.goto(URLS.messages());
      const now = new Date().toISOString();
      await page.evaluate((st) => sessionStorage.setItem('talmud.depart.queue', JSON.stringify(st)), {
        queue: [{ line: 2, branch: '00', idType: 'tz', identity: '023456789' }], results: [], curIdx: 0, startedAt: now, savedAt: now, settings: { leaveDate: '', leaveReason: '1' },
      });
      await page.reload();
      await page.waitForSelector('#tt-depart-stale:not([hidden])', { timeout: 10000 });
      const stepOn = () => page.$eval('#tt-depart-steps .tt-step-on', (el) => el.textContent.trim());
      assert.equal(await stepOn(), 'ריצה (מושהית)');
      await page.click('#tt-depart-stale-clear');
      assert.equal(await stepOn(), 'הכנה');
      assert.deepEqual(await page.$$eval('#tt-depart-steps .tt-step', (els) => els.map((e) => e.textContent.trim())), ['הכנה', 'ריצה', 'תוצאות', 'תיקון והרצה חוזרת']);
    } finally { await context.close(); }
  });
});
