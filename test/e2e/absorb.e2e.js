// תרחישי הקליטה 9a–9h על סביבת-הדמה. הסקריפט האמיתי (dist/) רץ בכרום אמיתי.
// כל התעודות בדויות. הרצה: npm run test:e2e   (HEADED=1 להצגת הדפדפן)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openSession, runAbsorb, readMockDb, readUserscript, URLS, SITE, ABSORB_SEL, waitForPanel, readResults, readReport, readLog, sleep, evalRetry } from './harness.js';
import { ABSORB_STATUS } from '../../src/tools/absorb-report.js';

const T = '\t';
let browser;
let script;

// זורע אחסון-דפדפן (sessionStorage/localStorage) לפני הדף הנבדק: דף הבית ('other', בלי תור) לא מעלה כלום.
async function seedStorage(page, { session = {}, local = {} } = {}) {
  await page.goto(`${SITE}/`);
  await page.evaluate(({ session: s, local: l }) => {
    for (const [k, v] of Object.entries(s)) sessionStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    for (const [k, v] of Object.entries(l)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, { session, local });
}

function trackNavigations(page) {
  const urls = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) urls.push(f.url()); });
  return urls;
}

const queueTask = (branch, studyType, identity, extra = {}) => Object.assign({ line: 2, branch, studyType, idType: 'tz', identity }, extra);

describe('קליטת תלמידים — סביבת דמה', () => {
  before(async () => { browser = await launch(); script = readUserscript(); });
  after(async () => { if (browser) await browser.close(); });

  async function session(scenario) {
    return openSession(browser, { scenario, script });
  }

  test('9a תלמיד קיים → "כבר קיים" בלי ניסיון קליטה (מדף המוסד)', async () => {
    const { context, page, consoleLines } = await session();
    try {
      const run = await runAbsorb(page, `00${T}600${T}012345678`, { startUrl: URLS.institute(491) });
      assert.equal(run.results.length, 1, run.log);
      assert.equal(run.results[0].status, 'כבר קיים', run.log);
      const db = await readMockDb(page);
      assert.equal(db.enrolled['10002'].length, 2, 'לא נוספה שורה לגריד');
      assert.ok(!consoleLines.some((l) => l.startsWith('PAGEERROR')), consoleLines.filter((l) => l.startsWith('PAGEERROR')).join('\n'));
    } finally { await context.close(); }
  });

  test('9b ת.ז. קצרה → ריפוד → "כבר קיים"', async () => {
    const { context, page } = await session();
    try {
      const run = await runAbsorb(page, `00${T}600${T}12345678`, { startUrl: URLS.institute(491) });
      assert.equal(run.results[0].status, 'כבר קיים', run.log);
      assert.equal(run.results[0].identity, '012345678');
    } finally { await context.close(); }
  });

  test('9c קליטה אמיתית של תלמיד מוכר → "נקלט" + אימות בגריד', async () => {
    const { context, page } = await session();
    try {
      const run = await runAbsorb(page, `00${T}600${T}034567890`, { startUrl: URLS.institute(491) });
      assert.equal(run.results[0].status, 'נקלט', run.log);
      const db = await readMockDb(page);
      assert.ok(db.enrolled['10002'].some((s) => s.id === '034567890'), 'התלמיד לא נמצא בגריד של הדמה');
    } finally { await context.close(); }
  });

  test('9d דרכון + ארץ לסניף אחר (16) מדף מוסד 00 → "נקלט"', async () => {
    const { context, page } = await session();
    try {
      const run = await runAbsorb(page, `16${T}600${T}AB1234567${T}${T}${T}05/05/1994${T}ארצות הברית`, { startUrl: URLS.institute(491) });
      assert.equal(run.results[0].status, 'נקלט', run.log);
      const db = await readMockDb(page);
      const row = (db.enrolled['10269'] || []).find((s) => s.id === 'AB1234567');
      assert.ok(row, 'הדרכון לא נקלט לסניף 16');
      assert.equal(row.country, '710');
    } finally { await context.close(); }
  });

  test('9e תלמיד חדש עם פרטים → דף תלמיד-חדש → שמירה → "נקלט (תלמיד חדש)"', async () => {
    const { context, page } = await session();
    try {
      const run = await runAbsorb(page, `00${T}600${T}067890123${T}משה${T}כהן${T}10/10/1990`, { startUrl: URLS.institute(491) });
      assert.equal(run.results[0].status, 'נקלט (תלמיד חדש)', run.log);
      const db = await readMockDb(page);
      const row = db.enrolled['10002'].find((s) => s.id === '067890123');
      assert.ok(row, 'התלמיד החדש לא נקלט');
      assert.equal(row.first, 'משה');
    } finally { await context.close(); }
  });

  test('9f תלמיד חדש בלי פרטים → לא שומר, שורת הוראה, ממשיך לתלמיד הבא', async () => {
    const { context, page } = await session();
    try {
      const run = await runAbsorb(page, `00${T}600${T}078901234\n00${T}600${T}045678901`, { startUrl: URLS.institute(491) });
      assert.equal(run.results.length, 2, run.log);
      assert.match(run.results[0].status, /^תלמיד חדש/, run.log);
      assert.equal(run.results[1].status, 'נקלט', run.log);
      const db = await readMockDb(page);
      assert.ok(!db.enrolled['10002'].some((s) => s.id === '078901234'), 'תלמיד חדש נשמר בלי פרטים!');
      assert.equal(db.pendingNewStudent, null, 'דף תלמיד-חדש נשאר "פתוח" בשרת');
    } finally { await context.close(); }
  });

  test('9g סוג לימוד לא קיים → שגיאה ברורה, בלי לולאה', async () => {
    const { context, page } = await session();
    try {
      const run = await runAbsorb(page, `00${T}900${T}034567890`, { startUrl: URLS.institute(491) });
      assert.equal(run.results.length, 1, run.log);
      assert.equal(run.results[0].status, 'שגיאה', run.log);
      assert.match(run.report, /900/);
    } finally { await context.close(); }
  });

  test('9h אצווה רב-סניפית: 00 → 16 → 05 → 00, כולל תלמיד חדש באמצע', async () => {
    const { context, page } = await session();
    try {
      const input = [
        `00${T}600${T}034567890`,
        `16${T}600${T}045678901`,
        `05${T}600${T}089012345${T}דוד${T}לוי${T}01/01/1985`,
        `00${T}300${T}012345678`,
      ].join('\n');
      const run = await runAbsorb(page, input, { startUrl: URLS.studyType(10002, 491), timeoutMs: 150000 });
      assert.equal(run.results.length, 4, run.log);
      assert.deepEqual(run.results.map((r) => r.status), ['נקלט', 'נקלט', 'נקלט (תלמיד חדש)', 'נקלט'], run.log);
    } finally { await context.close(); }
  });
});

// ממצאי ביקורת-הקוד 10.9.2026 (1, 3, 4, 5, 6, 11): תרחישי-דמה שמוכיחים כל תיקון.
describe('קליטת תלמידים: ממצאי הביקורת', () => {
  let browser3, script3;
  before(async () => { browser3 = await launch(); script3 = readUserscript(); });
  after(async () => { if (browser3) await browser3.close(); });

  async function session(scenario) {
    return openSession(browser3, { scenario, script: script3 });
  }

  test('ממצא 1: בלי סניף בפירורי-הלחם, סניף מהמפה בלבד אינו מספיק: קליטה ל-00 מדף 16/600 עוברת דרך דף המוסד של 00', async () => {
    const { context, page } = await session({ breadcrumbShowsBranch: false });
    try {
      // שתי המפות יודעות את 00/600: בלי התיקון, קפיצה ישירה וקליטה במקום על סמך המפה (מעגלי)
      await seedStorage(page, { local: { 'talmud.nav.studyTypeIds': { '00|600': '10002' } } });
      const urls = trackNavigations(page);
      const run = await runAbsorb(page, `00${T}600${T}034567890`, { startUrl: URLS.studyType(10269, 4159) });
      assert.equal(run.results[0].status, 'נקלט', run.log);
      assert.ok(urls.some((u) => /InstitutesDetails\.aspx\?InstituteID=491/.test(u)), `חובה ביקור בדף המוסד של 00 לאימות הסניף. ביקורים: ${urls.join(' | ')}`);
      assert.match(run.log, /\[institute\]|מאמתים דרך דף המוסד/, 'היומן מתעד את מקור הסניף');
      const db = await readMockDb(page);
      assert.ok(db.enrolled['10002'].some((s) => s.id === '034567890'));
    } finally { await context.close(); }
  });

  test('ממצא 3: קליק-עץ שמרנדר במקום (סניף 05 מדף מוסד 00) → "נקלט" בלי להמתין לכלב-השומר', async () => {
    const { context, page } = await session({ treeNavigates: false });
    try {
      const t0 = Date.now();
      const run = await runAbsorb(page, `05${T}600${T}034567890`, { startUrl: URLS.institute(491) });
      const elapsed = Date.now() - t0;
      assert.equal(run.results[0].status, 'נקלט', run.log);
      assert.ok(!/לא הגיעה טעינת דף/.test(run.log), 'כלב-השומר לא היה אמור להתערב');
      assert.ok(elapsed < 20000, `הריצה ארכה ${elapsed}ms (המתנת כלב-שומר של 12 שניות?)`);
      const db = await readMockDb(page);
      assert.ok((db.enrolled['10301'] || []).some((s) => s.id === '034567890'), 'התלמיד לא נקלט לסניף 05');
    } finally { await context.close(); }
  });

  test('ממצא 4: "שמירה" שטוענת מחדש את דף תלמיד-חדש → שמירה אחת בלבד, סטטוס סביר, בלי לולאה', async () => {
    const { context, page } = await session({ afterSave: 'reload' });
    try {
      const run = await runAbsorb(page, `00${T}600${T}067890123${T}משה${T}כהן${T}10/10/1990`, { startUrl: URLS.institute(491) });
      assert.equal(run.results.length, 1, run.log);
      assert.ok([ABSORB_STATUS.SAVED_UNVERIFIED, ABSORB_STATUS.OK_NEW].includes(run.results[0].status), `סטטוס: ${run.results[0].status}\n${run.log}`);
      const db = await readMockDb(page);
      assert.equal(db.enrolled['10002'].filter((s) => s.id === '067890123').length, 1, 'שמירה כפולה במסד-הדמה');
      assert.ok(!/לולאת ניווט/.test(run.log), 'הגענו לתקרת הנחיתות');
    } finally { await context.close(); }
  });

  test('ממצא 4 + 12: "שמירה" עם חלונית-הצלחה (נשארים בדף) → שמירה אחת, טקסט החלונית בפירוט התוצאה', async () => {
    const { context, page } = await session({ afterSave: 'popup' });
    try {
      const run = await runAbsorb(page, `00${T}600${T}067890123${T}משה${T}כהן${T}10/10/1990`, { startUrl: URLS.institute(491) });
      assert.equal(run.results.length, 1, run.log);
      assert.ok([ABSORB_STATUS.SAVED_UNVERIFIED, ABSORB_STATUS.OK_NEW].includes(run.results[0].status), `סטטוס: ${run.results[0].status}\n${run.log}`);
      assert.match(run.results[0].detail, /הפרטים נשמרו/, `הפירוט: "${run.results[0].detail}"`);
      const db = await readMockDb(page);
      assert.equal(db.enrolled['10002'].filter((s) => s.id === '067890123').length, 1, 'שמירה כפולה במסד-הדמה');
    } finally { await context.close(); }
  });

  test('ממצא 4: "שמירה" שנשארת בדף בלי הודעה → שמירה אחת', async () => {
    const { context, page } = await session({ afterSave: 'stay' });
    try {
      const run = await runAbsorb(page, `00${T}600${T}067890123${T}משה${T}כהן${T}10/10/1990`, { startUrl: URLS.institute(491) });
      assert.equal(run.results.length, 1, run.log);
      assert.ok([ABSORB_STATUS.SAVED_UNVERIFIED, ABSORB_STATUS.OK_NEW].includes(run.results[0].status), `סטטוס: ${run.results[0].status}\n${run.log}`);
      const db = await readMockDb(page);
      assert.equal(db.enrolled['10002'].filter((s) => s.id === '067890123').length, 1, 'שמירה כפולה במסד-הדמה');
    } finally { await context.close(); }
  });

  test('ממצא 5: ריצה בלשונית א\' → "התחל" בלשונית ב\' מסורב עם הודעה, בלי ריצה', async () => {
    const { context, page } = await session();
    try {
      await page.goto(URLS.institute(491));
      await waitForPanel(page);
      await page.fill(ABSORB_SEL.input, [`00${T}600${T}034567890`, `00${T}600${T}045678901`, `00${T}600${T}012345678`].join('\n'));
      await page.click(ABSORB_SEL.start);
      await sleep(800);
      const pageB = await context.newPage();
      await pageB.goto(URLS.institute(491));
      await waitForPanel(pageB);
      await pageB.fill(ABSORB_SEL.input, `00${T}600${T}023456789`);
      await pageB.click(ABSORB_SEL.start);
      await sleep(700);
      const statusB = await pageB.textContent(ABSORB_SEL.status);
      assert.match(statusB, /לשונית אחרת/, `סטטוס בלשונית ב': "${statusB}"`);
      assert.equal((await readResults(pageB)).length, 0, 'לשונית ב\' לא הריצה כלום');
      const { waitForRunDone } = await import('./harness.js');
      await waitForRunDone(page, ABSORB_SEL, 120000);
      const resA = await readResults(page);
      assert.equal(resA.length, 3, await readLog(page));
      await pageB.close();
    } finally { await context.close(); }
  });

  test('ממצא 6: דגל-עצירה + תור שמור בטעינת דף → השארית "נעצר", הטבלה והדוח מוצגים, ושורדים טעינה נוספת', async () => {
    const { context, page } = await session();
    try {
      const done = { line: 2, branch: '00', studyType: '600', idType: 'tz', identity: '012345678', status: 'כבר קיים', detail: '', action: '' };
      await seedStorage(page, { session: {
        'talmud.absorb.queue': { queue: [queueTask('00', '600', '012345678'), queueTask('00', '600', '034567890', { line: 3 })], results: [done], curIdx: 1, startedAt: new Date().toISOString() },
        'talmud.absorb.stop': '1',
      } });
      await page.goto(URLS.institute(491));
      await waitForPanel(page);
      await sleep(1200);
      let res = await readResults(page);
      assert.deepEqual(res.map((r) => r.status), ['כבר קיים', 'נעצר'], await readLog(page));
      let report = await readReport(page);
      assert.match(report, /נעצר/, 'דוח "מה נשאר" מוצג');
      // טעינה נוספת: התוצאות של הריצה האחרונה עדיין מוצגות
      await page.reload();
      await waitForPanel(page);
      await sleep(800);
      res = await readResults(page);
      assert.deepEqual(res.map((r) => r.status), ['כבר קיים', 'נעצר'], 'תמונת-התוצאות האחרונה מוצגת אחרי טעינה');
      report = await readReport(page);
      assert.match(report, /נעצר/);
      const saved = await page.evaluate(() => sessionStorage.getItem('talmud.absorb.queue'));
      assert.equal(saved, null, 'התור נוקה');
    } finally { await context.close(); }
  });

  test('ממצא 11: תור פתוח + דף ההודעות → אין ניווט אוטומטי; תיבת "יש תור פתוח" עם המשך/נקה', async () => {
    const { context, page } = await session();
    try {
      await seedStorage(page, { session: {
        'talmud.absorb.queue': { queue: [queueTask('00', '600', '034567890'), queueTask('00', '600', '045678901', { line: 3 })], results: [], curIdx: 0, startedAt: new Date().toISOString() },
      } });
      const urls = trackNavigations(page);
      await page.goto(URLS.messages());
      await waitForPanel(page);
      await sleep(3000);
      assert.match(page.url(), /Association\/Default\.aspx/, 'הסקריפט ניווט מדף ההודעות');
      assert.equal(urls.filter((u) => !/Association\/Default\.aspx/.test(u)).length, 0, `ניווטים: ${urls.join(' | ')}`);
      const box = await evalRetry(page, () => { const el = document.querySelector('#tt-absorb-stale'); return el && !el.hidden ? el.innerText : ''; });
      assert.match(box, /תור פתוח \(2 שורות\)/, `התיבה: "${box}"`);
      assert.ok(await page.$('#tt-absorb-stale-go'), 'כפתור המשך');
      assert.ok(await page.$('#tt-absorb-stale-clear'), 'כפתור נקה');
      // "נקה" מוחק את התור
      await page.click('#tt-absorb-stale-clear');
      const saved = await page.evaluate(() => sessionStorage.getItem('talmud.absorb.queue'));
      assert.equal(saved, null);
    } finally { await context.close(); }
  });
});

describe('קליטת תלמידים — טבלת ההזנה', () => {
  let browser2, script2;
  before(async () => { browser2 = await launch(); script2 = readUserscript(); });
  after(async () => { if (browser2) await browser2.close(); });

  test('מילוי ידני של שורה בטבלה (בלי הדבקה) → הרצה → "נקלט"; שורה ריקה חדשה נוספת מעצמה', async () => {
    const { context, page } = await openSession(browser2, { script: script2 });
    try {
      await page.goto(URLS.institute(491));
      await page.waitForSelector('#tt-panel');
      const cell = (i, k) => `#tt-absorb-grid input[data-i="${i}"][data-k="${k}"]`;
      await page.fill(cell(0, 'branch'), '00');
      await page.fill(cell(0, 'studyType'), '600');
      await page.fill(cell(0, 'identifier'), '034567890');
      await page.waitForSelector(cell(1, 'branch'));
      const typeLabel = await page.textContent('#tt-absorb-grid tr[data-i="0"] .tt-type-label');
      assert.equal(typeLabel.trim(), 'ת.ז.');
      const summary = await page.textContent('#tt-absorb-grid-summary');
      assert.match(summary, /1 שורות מוכנות/);
      await page.click('#tt-absorb-start');
      const { waitForRunDone, readResults } = await import('./harness.js');
      await waitForRunDone(page);
      const res = await readResults(page);
      assert.equal(res.length, 1);
      assert.equal(res[0].status, 'נקלט');
    } finally { await context.close(); }
  });

  test('דרכון בטבלה פותח תאריך לידה וארץ; ארץ לא מוכרת מסומנת כשגיאה עם הסבר', async () => {
    const { context, page } = await openSession(browser2, { script: script2 });
    try {
      await page.goto(URLS.institute(491));
      await page.waitForSelector('#tt-panel');
      const cell = (i, k) => `#tt-absorb-grid input[data-i="${i}"][data-k="${k}"]`;
      await page.fill(cell(0, 'branch'), '16');
      await page.fill(cell(0, 'studyType'), '600');
      await page.fill(cell(0, 'identifier'), 'AB1234567');
      await page.fill(cell(0, 'birthDate'), '05/05/1994');
      await page.fill(cell(0, 'country'), 'אוסטר');
      const typeLabel = await page.textContent('#tt-absorb-grid tr[data-i="0"] .tt-type-label');
      assert.equal(typeLabel.trim(), 'דרכון');
      const countryOff = await page.$eval('#tt-absorb-grid tr[data-i="0"] .tt-cell-country', (td) => td.classList.contains('tt-cell-off'));
      assert.equal(countryOff, false, 'עמודת הארץ פעילה לדרכון');
      const title = await page.getAttribute('#tt-absorb-grid tr[data-i="0"]', 'title');
      assert.match(title || '', /ארץ לא מוכרת/);
      await page.fill(cell(0, 'country'), 'אוסטריה');
      const title2 = await page.getAttribute('#tt-absorb-grid tr[data-i="0"]', 'title');
      assert.equal(title2, null);
    } finally { await context.close(); }
  });
});
