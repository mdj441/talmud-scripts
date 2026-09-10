// תרחישי הקליטה 9a–9h על סביבת-הדמה. הסקריפט האמיתי (dist/) רץ בכרום אמיתי.
// כל התעודות בדויות. הרצה: npm run test:e2e   (HEADED=1 להצגת הדפדפן)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openSession, runAbsorb, readMockDb, readUserscript, URLS } from './harness.js';

const T = '\t';
let browser;
let script;

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
