// תרחישי הקליטה 9a-9h על סביבת-הדמה. הסקריפט האמיתי (dist/) רץ בכרום אמיתי.
// הדמה מדמה את ה-session של האתר (F1-F3): הדף הולך אחרי הלחיצה האחרונה בעץ, לא אחרי הכתובת.
// כל התעודות בדויות. הרצה: npm run test:e2e   (HEADED=1 להצגת הדפדפן)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openSession, runAbsorb, readMockDb, readUserscript, URLS, SITE, ABSORB_SEL, waitForPanel, waitForRunDone, readResults, readReport, readLog, sleep, evalRetry } from './harness.js';

const NO_SESSION = { instituteId: null, studyTypeId: null };
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

  test('31.10.2026: אזהרת "רשום כבר במוסד אחר" בלי "אשר המשך" → "נחסם", בלי "המשך", התלמיד לא נקלט', async () => {
    const { context, page } = await session();
    try {
      const run = await runAbsorb(page, `00${T}600${T}056789012`, { startUrl: URLS.institute(491) });
      assert.match(run.results[0].status, /^נחסם/, run.log);
      const db = await readMockDb(page);
      assert.ok(!(db.log || []).some((l) => /continue 056789012/.test(l)), `נלחץ "המשך" בלי אישור:\n${(db.log || []).join('\n')}`);
      assert.ok(!(db.enrolled['10002'] || []).some((s) => s.id === '056789012'), 'התלמיד נקלט למרות שלא אושר');
    } finally { await context.close(); }
  });

  test('31.10.2026: "אשר המשך" מסומן → "המשך" נלחץ, "הצלחה מעבר תלמיד הצליח", אימות בגריד → "נקלט"', async () => {
    const { context, page } = await session();
    try {
      await page.goto(URLS.institute(491));
      await waitForPanel(page);
      await page.check('#tt-absorb-continue-other');
      await page.fill(ABSORB_SEL.input, `00${T}600${T}056789012`);
      await page.click(ABSORB_SEL.start);
      await waitForRunDone(page);
      const results = await readResults(page);
      const log = await readLog(page);
      assert.equal(results[0].status, 'נקלט', log);
      assert.match(log, /"אשר המשך" מסומן/, 'היומן מספר שההמשך אושר על-ידי בעל-המערכת');
      assert.match(log, /הצלחה מעבר תלמיד הצליח/, 'הודעת האתר אחרי "המשך" ביומן');
      const db = await readMockDb(page);
      assert.ok((db.log || []).some((l) => /continue 056789012 → transferred/.test(l)), (db.log || []).join('\n'));
      assert.ok((db.enrolled['10002'] || []).some((s) => s.id === '056789012'), 'התלמיד לא נקלט בדמה');
    } finally { await context.close(); }
  });

  test('9d דרכון + ארץ לסניף אחר (16) מדף מוסד 00 → "נקלט"; העץ מנווט בלי לשנות את הכתובת (F2)', async () => {
    const { context, page } = await session();
    try {
      const urls = trackNavigations(page);
      const run = await runAbsorb(page, `16${T}600${T}AB1234567${T}${T}${T}05/05/1994${T}ארצות הברית`, { startUrl: URLS.institute(491) });
      assert.equal(run.results[0].status, 'נקלט', run.log);
      assert.ok(!urls.some((u) => /InstituteID=4159/.test(u)), `אסור לנווט לפי כתובת של הסניף; ניווטים: ${urls.join(' | ')}`);
      assert.ok(urls.some((u) => /InstituteID=491/.test(u)), 'לחיצת העץ טענה מחדש את אותה כתובת (של 00)');
      assert.match(run.log, /לוחצים בעץ-הצד על סניף 16/, 'היומן מתעד ניווט דרך העץ');
      assert.match(run.log, /גריד סוגי-הלימוד: שורה 600/, 'ואז דרך הגריד');
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

  // מלכודת F1/F3 (30.10.2026): המשתמש עומד על דף סוג-לימוד שהגיע אליו ב-GET ישיר עם InstituteID של סניף 16,
  // אך ה-session הוא של 00/600: פירורי-הלחם אומרים "16", התווית אומרת "00", ה-h1 ריק, והפקדים עובדים על 00/600.
  // שורה בתור ל-16/600: אסור לקלוט במקום. הסקריפט מנווט דרך העץ ל-16 ואז דרך הגריד, ו"נקלט" מגיע ל-16/600.
  test('F1/F3: דף סוג-לימוד ב-GET ישיר של 16 כש-session=00 → לא קולטים במקום; עץ ל-16, גריד, ונקלט ל-16/600', async () => {
    const { context, page } = await session({ session: { instituteId: '491', studyTypeId: '10002' } });
    try {
      const urls = trackNavigations(page);
      const run = await runAbsorb(page, `16${T}600${T}034567890`, { startUrl: URLS.studyType(10269, 4159) });
      assert.equal(run.results.length, 1, run.log);
      assert.equal(run.results[0].status, 'נקלט', run.log);
      const db = await readMockDb(page);
      assert.ok((db.enrolled['10269'] || []).some((s2) => s2.id === '034567890'), 'התלמיד היה אמור להיקלט לסוג-הלימוד של סניף 16');
      assert.ok(!(db.enrolled['10002'] || []).some((s2) => s2.id === '034567890'), 'נקלט בטעות לסוג-הלימוד של סניף 00 (ה-session)');
      assert.match(run.log, /h1 ריק|לא מזוהה/, 'היומן מתעד שהדף לא זוהה (h1 ריק)');
      assert.match(run.log, /לוחצים בעץ-הצד על סניף 16/, 'הניווט עבר דרך העץ');
      assert.match(run.log, /גריד סוגי-הלימוד: שורה 600/, 'ואז דרך הגריד');
      assert.ok(!/\[חיפוש\][^\n]*\n[^\n]*דף institute/.test(run.log), 'לא חיפשו בדף של סניף 00 לפני הניווט');
      assert.ok(urls.some((u) => /InstitutesDetails\.aspx/.test(u)), `חובה מעבר דרך דף המוסד; ניווטים: ${urls.join(' | ')}`);
      assert.match(page.url(), /StudyTypeDetails\.aspx$/, 'דף סוג-הלימוד דרך הגריד הוא בלי query');
    } finally { await context.close(); }
  });

  test('F1: דף מוסד ב-GET ישיר בלי session (h1 ריק) → הסניף לא מזוהה, ניווט דרך העץ, ונקלט', async () => {
    const { context, page } = await session({ session: NO_SESSION });
    try {
      const urls = trackNavigations(page);
      await page.goto(URLS.institute(4159));
      await waitForPanel(page);
      const h1 = await page.textContent('h1');
      assert.equal(h1.trim(), '', 'בלי session ה-h1 ריק');
      const run = await runAbsorb(page, `00${T}600${T}034567890`);
      assert.equal(run.results[0].status, 'נקלט', run.log);
      assert.match(run.log, /דף institute(?! · סניף)/, 'בטעינה הראשונה אין סניף מזוהה');
      assert.ok(!urls.some((u) => /InstituteID=491/.test(u)), `לא מנווטים לפי כתובת של הסניף; ניווטים: ${urls.join(' | ')}`);
      const db = await readMockDb(page);
      assert.ok(db.enrolled['10002'].some((s2) => s2.id === '034567890'));
    } finally { await context.close(); }
  });

  test('F3: דף סוג-לימוד 00/600 דרך הגריד (בלי query, התווית 00) → קליטה במקום בלי ניווט', async () => {
    const { context, page } = await session({ session: { instituteId: '491', studyTypeId: '10002' } });
    try {
      const urls = trackNavigations(page);
      const run = await runAbsorb(page, `00${T}600${T}034567890`, { startUrl: URLS.studyTypeCurrent() });
      assert.equal(run.results[0].status, 'נקלט', run.log);
      assert.match(run.log, /דף studyType · סניף 00 \[label\] · סוג 600/, run.log);
      assert.equal(urls.filter((u) => !/StudyTypeDetails\.aspx$/.test(u)).length, 0, `לא היה צורך בניווט; ניווטים: ${urls.join(' | ')}`);
      assert.ok(!/בעץ-הצד|גריד סוגי-הלימוד/.test(run.log), 'לא נווט');
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

  // ממצא ב-6: "שמירה" שנשארת באותו מסמך משנה את hidStudentState (-1 → 1); הזרימה מזהה את הדף לפי הכתובת,
  // עוברת לרשימת התלמידים ומאמתת: "נקלט (תלמיד חדש)", לא "נשמר - לאמת ידנית".
  test('ממצא 4 + 12 + ב-6: "שמירה" עם חלונית-הצלחה (נשארים בדף) → שמירה אחת, אימות ברשימה, טקסט החלונית בפירוט', async () => {
    const { context, page } = await session({ afterSave: 'popup' });
    try {
      const run = await runAbsorb(page, `00${T}600${T}067890123${T}משה${T}כהן${T}10/10/1990`, { startUrl: URLS.institute(491) });
      assert.equal(run.results.length, 1, run.log);
      assert.equal(run.results[0].status, ABSORB_STATUS.OK_NEW, `סטטוס: ${run.results[0].status}\n${run.log}`);
      assert.match(run.results[0].detail, /הפרטים נשמרו/, `הפירוט: "${run.results[0].detail}"`);
      const db = await readMockDb(page);
      assert.equal(db.enrolled['10002'].filter((s) => s.id === '067890123').length, 1, 'שמירה כפולה במסד-הדמה');
    } finally { await context.close(); }
  });

  test('ממצא 4 + ב-6: "שמירה" שנשארת בדף בלי הודעה → שמירה אחת ואימות ברשימה: "נקלט (תלמיד חדש)"', async () => {
    const { context, page } = await session({ afterSave: 'stay' });
    try {
      const run = await runAbsorb(page, `00${T}600${T}067890123${T}משה${T}כהן${T}10/10/1990`, { startUrl: URLS.institute(491) });
      assert.equal(run.results.length, 1, run.log);
      assert.equal(run.results[0].status, ABSORB_STATUS.OK_NEW, `סטטוס: ${run.results[0].status}\n${run.log}`);
      const db = await readMockDb(page);
      assert.equal(db.enrolled['10002'].filter((s) => s.id === '067890123').length, 1, 'שמירה כפולה במסד-הדמה');
    } finally { await context.close(); }
  });

  // ─── ביקורת שנייה ───────────────────────────────────────────────────────────
  test('ממצא ב-2: פוסטבק מנווט כ-pageRedirect (beginRequest בלי endRequest) ששרת איטי עונה לו אחרי 9 שניות → "נקלט", לא "שגיאה"', async () => {
    const { context, page } = await session({ redirectFiresBeginRequest: true, redirectDelayMs: 9000 });
    try {
      const run = await runAbsorb(page, `00${T}600${T}034567890`, { startUrl: URLS.institute(491), timeoutMs: 120000 });
      assert.equal(run.results.length, 1, run.log);
      assert.equal(run.results[0].status, 'נקלט', `סטטוס: ${run.results[0].status}\n${run.log}`);
      assert.ok(!/PRM timeout after 8000/.test(run.log), 'תקציב 8 שניות פג לפני שהדף נפרק');
      const db = await readMockDb(page);
      assert.ok(db.enrolled['10002'].some((s) => s.id === '034567890'));
    } finally { await context.close(); }
  });

  test('ממצא ב-3: החיפוש מדווח תוצאה אך עמודת המזהה אינה במקומה → "לאמת ידנית" עם פירוט, בלי "קליטה"', async () => {
    const { context, page } = await session({ gridIdColumnShifted: true });
    try {
      const run = await runAbsorb(page, `00${T}600${T}012345678`, { startUrl: URLS.institute(491) });
      assert.equal(run.results.length, 1, run.log);
      assert.equal(run.results[0].status, ABSORB_STATUS.VERIFY, `סטטוס: ${run.results[0].status}\n${run.log}`);
      assert.match(run.results[0].detail, /הרשימה הציגה 1 תוצאות אך לא ניתן לקרוא בה מזהים/, run.results[0].detail);
      const db = await readMockDb(page);
      assert.equal(db.enrolled['10002'].length, 2, 'לא נוספה שורה');
      assert.ok(!(db.log || []).some((l) => /confirm /.test(l)), `נלחץ "קליטה"/"אישור" על תלמיד שאולי ברשימה:\n${(db.log || []).join('\n')}`);
    } finally { await context.close(); }
  });

  test('ממצא ב-8: הפייג\'ר של gvStudyType (טבלה מקוננת) אינו נקרא כסוגי-לימוד "1"/"12" ברשימת-הבחירה; ניווט לעמוד 2 (728) עובד', async () => {
    const { context, page } = await session();
    try {
      await page.goto(URLS.institute(491));
      await waitForPanel(page);
      const options = await evalRetry(page, () => Array.from(document.querySelectorAll('#tt-absorb-dl-studytypes option')).map((o) => o.value));
      assert.ok(options.includes('300') && options.includes('725'), `הקודים מהגריד: ${options.join(',')}`);
      assert.ok(!options.includes('1') && !options.includes('2') && !options.includes('12'), `תאי הפייג'ר נקראו כקודים: ${options.join(',')}`);
      const run = await runAbsorb(page, `00${T}728${T}034567890`);
      // הגריד דפדף לעמוד 2 ו"עריכה" הביאה לדף סוג-הלימוד 728 (10009, "סגור": הקליטה נחסמת, וזה בסדר כאן)
      assert.match(run.log, /דף studyType · סניף 00 \[label\] · סוג 728/, run.log);
      assert.ok(!/לא נמצא בגריד/.test(run.log), run.log);
      const db = await readMockDb(page);
      assert.equal(db.session.studyTypeId, '10009', 'ה-session של הדמה עבר לסוג-הלימוד 728');
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
