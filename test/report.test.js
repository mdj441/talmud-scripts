// דיווח חודשי: בדיקות-יחידה על החלק הטהור (סטטוסים, זיהוי כפתור מנוטרל, סיכום, TSV,
// מונה טעינות, חיווי "נתקע"). אין DOM. הרצה: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_STATUS, REPORT_MAX_LANDINGS, REPORT_STUCK_MS,
  reportIsButtonEnabled, reportSummary, reportBuildTsv, reportMakeResult,
  reportBumpLandings, reportIsStuck, reportNextIndexToRun,
} from '../src/tools/report.js';
import { reportTool } from '../src/tools/report-ui.js';

// ─── חוזה הלשונית ───────────────────────────────────────────────────────────
test('reportTool: חוזה הלשונית (id, title, pages, פונקציות)', () => {
  assert.equal(reportTool.id, 'report');
  assert.equal(typeof reportTool.title, 'string');
  assert.deepEqual(reportTool.pages, ['institute']);
  for (const fn of ['hasPendingRun', 'isRunning', 'onStop', 'mount']) assert.equal(typeof reportTool[fn], 'function', fn);
  // ב-Node אין sessionStorage: הפונקציות לא זורקות ומחזירות false
  assert.equal(reportTool.hasPendingRun(), false);
  assert.equal(reportTool.isRunning(), false);
});

// ─── סטטוסים ────────────────────────────────────────────────────────────────
test('REPORT_STATUS: ארבעה סטטוסים ייחודיים בעברית, בלי מקף ארוך', () => {
  const values = Object.values(REPORT_STATUS);
  assert.equal(new Set(values).size, values.length);
  assert.equal(REPORT_STATUS.SENT, 'נשלח');
  assert.match(REPORT_STATUS.SKIPPED, /^דולג/);
  assert.equal(REPORT_STATUS.ERROR, 'שגיאה');
  assert.equal(REPORT_STATUS.STOPPED, 'נעצר');
  for (const v of values) assert.ok(!v.includes('—'), `מקף ארוך ב-"${v}"`);
});

// ─── reportIsButtonEnabled ──────────────────────────────────────────────────
const fakeBtn = (attrs, className) => ({
  getAttribute: (n) => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null),
  className: className || '',
});

test('reportIsButtonEnabled: כפתור רגיל → פעיל', () => {
  assert.equal(reportIsButtonEnabled(fakeBtn({ href: "javascript:__doPostBack('x','')" }, 'btn')), true);
});

test('reportIsButtonEnabled: disabled="true" (כמו בסקריפט הישן) → מנוטרל', () => {
  assert.equal(reportIsButtonEnabled(fakeBtn({ disabled: 'true' }, 'btn')), false);
});

test('reportIsButtonEnabled: disabled="disabled" ו-disabled="" (ASP.NET) → מנוטרל', () => {
  assert.equal(reportIsButtonEnabled(fakeBtn({ disabled: 'disabled' }, '')), false);
  assert.equal(reportIsButtonEnabled(fakeBtn({ disabled: '' }, '')), false);
});

test('reportIsButtonEnabled: class מכיל disabled (גם aspNetDisabled) → מנוטרל', () => {
  assert.equal(reportIsButtonEnabled(fakeBtn({}, 'btn disabled')), false);
  assert.equal(reportIsButtonEnabled(fakeBtn({}, 'aspNetDisabled')), false);
});

test('reportIsButtonEnabled: null / אובייקט בלי getAttribute → לא פעיל (אין כפתור)', () => {
  assert.equal(reportIsButtonEnabled(null), false);
  assert.equal(reportIsButtonEnabled(undefined), false);
  assert.equal(reportIsButtonEnabled({ disabled: true, className: '' }), false);
  assert.equal(reportIsButtonEnabled({ disabled: false, className: 'btn' }), true);
});

// ─── reportMakeResult ───────────────────────────────────────────────────────
test('reportMakeResult: רשומה אחידה עם ברירות-מחדל ריקות', () => {
  const r = reportMakeResult('05', REPORT_STATUS.SENT);
  assert.deepEqual(r, { branch: '05', status: 'נשלח', detail: '', action: '' });
  const e = reportMakeResult('16', REPORT_STATUS.ERROR, 'סיבה', 'מה לעשות');
  assert.equal(e.detail, 'סיבה');
  assert.equal(e.action, 'מה לעשות');
});

// ─── reportSummary ──────────────────────────────────────────────────────────
test('reportSummary: ספירה וטקסט "נשלחו X, דולגו Y, שגיאות Z"', () => {
  const results = [
    reportMakeResult('00', REPORT_STATUS.SENT),
    reportMakeResult('05', REPORT_STATUS.SENT),
    reportMakeResult('16', REPORT_STATUS.SKIPPED, 'הכפתור מנוטרל'),
    reportMakeResult('21', REPORT_STATUS.ERROR, 'לא הופיעה חלונית', 'שלח ידנית'),
  ];
  const s = reportSummary(results);
  assert.equal(s.sent, 2);
  assert.equal(s.skipped, 1);
  assert.equal(s.errors, 1);
  assert.equal(s.stopped, 0);
  assert.equal(s.total, 4);
  assert.equal(s.summary, 'נשלחו 2, דולגו 1, שגיאות 1');
  // "מה נשאר": שורה רק לשגיאה (נשלח/דולג לא דורשים טיפול)
  assert.equal(s.lines.length, 1);
  assert.match(s.lines[0], /21/);
  assert.match(s.lines[0], /שלח ידנית/);
});

test('reportSummary: נעצרו מופיעים בסיכום ובשורות "מה נשאר"', () => {
  const s = reportSummary([
    reportMakeResult('00', REPORT_STATUS.SENT),
    reportMakeResult('05', REPORT_STATUS.STOPPED, 'נעצר לפני השליחה', 'הרץ שוב'),
    reportMakeResult('16', REPORT_STATUS.STOPPED, 'נעצר לפני השליחה', 'הרץ שוב'),
  ]);
  assert.equal(s.stopped, 2);
  assert.equal(s.summary, 'נשלחו 1, דולגו 0, שגיאות 0, נעצרו 2');
  assert.equal(s.lines.length, 2);
});

test('reportSummary: קלט ריק / לא-מערך → אפסים בלי לזרוק', () => {
  for (const input of [[], null, undefined, 'x']) {
    const s = reportSummary(input);
    assert.equal(s.total, 0);
    assert.equal(s.summary, 'נשלחו 0, דולגו 0, שגיאות 0');
    assert.deepEqual(s.lines, []);
  }
});

// ─── reportBuildTsv ─────────────────────────────────────────────────────────
test('reportBuildTsv: כותרת + שורה לכל תוצאה, טאבים בתוך תא מוחלפים ברווח', () => {
  const tsv = reportBuildTsv([
    reportMakeResult('00', REPORT_STATUS.SENT, 'הצלחה: הדיווח נשלח'),
    reportMakeResult('16', REPORT_STATUS.ERROR, 'שורה\tעם\nטאבים', 'בדוק'),
  ]);
  const lines = tsv.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'סניף\tסטטוס\tפירוט\tמה לעשות');
  assert.equal(lines[1], '00\tנשלח\tהצלחה: הדיווח נשלח\t');
  assert.equal(lines[2], '16\tשגיאה\tשורה עם טאבים\tבדוק');
});

// ─── reportBumpLandings ─────────────────────────────────────────────────────
test('reportBumpLandings: מונה לאותו סניף עולה, סניף אחר מתחיל מ-1', () => {
  let rec = reportBumpLandings(null, 0);
  assert.deepEqual(rec, { idx: 0, count: 1 });
  rec = reportBumpLandings(rec, 0);
  assert.deepEqual(rec, { idx: 0, count: 2 });
  rec = reportBumpLandings(rec, 1);
  assert.deepEqual(rec, { idx: 1, count: 1 });
  rec = reportBumpLandings({ idx: 'זבל' }, 2);
  assert.deepEqual(rec, { idx: 2, count: 1 });
});

test('REPORT_MAX_LANDINGS = 3 (מעל זה: "שגיאה" והמשך)', () => {
  assert.equal(REPORT_MAX_LANDINGS, 3);
});

// ─── reportIsStuck ──────────────────────────────────────────────────────────
test('reportIsStuck: מעל 20 שניות בלי צעד → נתקע; פחות → לא; בלי חותמת → לא', () => {
  const now = 1_000_000;
  assert.equal(REPORT_STUCK_MS, 20000);
  assert.equal(reportIsStuck(now - 19_000, now), false);
  assert.equal(reportIsStuck(now - 20_001, now), true);
  assert.equal(reportIsStuck(null, now), false);
  assert.equal(reportIsStuck('לא מספר', now), false);
  assert.equal(reportIsStuck(now - 5_000, now, 4_000), true);
});

// ─── reportNextIndexToRun ───────────────────────────────────────────────────
test('reportNextIndexToRun: מצב שמור → האינדקס הבא; מצב לא תקין → -1', () => {
  assert.equal(reportNextIndexToRun({ branches: ['00', '05'], curIdx: 1 }), 1);
  assert.equal(reportNextIndexToRun({ branches: ['00', '05'], curIdx: 2 }), -1);
  assert.equal(reportNextIndexToRun({ branches: [], curIdx: 0 }), -1);
  assert.equal(reportNextIndexToRun(null), -1);
  assert.equal(reportNextIndexToRun({ branches: ['00'], curIdx: 'x' }), 0);
});
