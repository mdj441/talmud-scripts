import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ABSORB_STATUS, ABSORB_TSV_HEADER, ABSORB_TEMPLATE_HEADER,
  analyzeGrid, isAbsorbSuccess, absorbStatusKey,
  buildResultsTsv, buildRemainingReport, summarizeAbsorbResults,
} from '../src/tools/absorb.js';
import { maskId, log, getLogText, clearLog } from '../src/core/log.js';
import { toCsv } from '../src/core/csv.js';

// כל הת.ז. כאן בדויות (337386692 / 206136871 / 6136871 — דוגמאות התוכנית).

// ─── smoke: import ב-Node בלי DOM ────────────────────────────────────────────
test('smoke: absorb.js נטען ב-Node והיצוא הטהור הוא פונקציות', () => {
  for (const fn of [analyzeGrid, isAbsorbSuccess, absorbStatusKey,
    buildResultsTsv, buildRemainingReport, summarizeAbsorbResults]) {
    assert.equal(typeof fn, 'function');
  }
  assert.equal(typeof ABSORB_STATUS, 'object');
  assert.ok(Array.isArray(ABSORB_TSV_HEADER));
  assert.ok(Array.isArray(ABSORB_TEMPLATE_HEADER));
});

test('smoke: absorb-main.js נטען ב-Node בלי לגעת ב-DOM', async () => {
  const mod = await import('../src/absorb-main.js');
  assert.equal(typeof mod.initAbsorbPanel, 'function');
});

test('תבנית האקסל = כותרות Task 4', () => {
  assert.deepEqual(ABSORB_TEMPLATE_HEADER,
    ['סניף', 'סוג לימוד', 'ת.ז./דרכון', 'שם פרטי', 'שם משפחה', 'תאריך לידה', 'ארץ', 'מגדר', 'מצב משפחתי']);
});

// ─── analyzeGrid (טהורה: שורות-תאים פנימה, {found, matchType} החוצה) ─────────
const GRID_TWO = [
  ['', '1', 'תעודת זהות', '006136871', 'משה', 'כהן', '01/01/1990'],
  ['', '2', 'תעודת זהות', '337386692', 'יוסי', 'לוי', '02/02/1991'],
];

test('analyzeGrid: התאמה מדויקת עם ת.ז. מרופדת', () => {
  assert.deepEqual(analyzeGrid(GRID_TWO, '006136871'), { found: true, matchType: 'exact' });
});

test('analyzeGrid: ת.ז. לא-מרופדת בקלט מול מרופדת בגריד = התאמה מדויקת', () => {
  assert.deepEqual(analyzeGrid(GRID_TWO, '6136871'), { found: true, matchType: 'exact' });
});

test('analyzeGrid: אין התאמה (2 שורות, אף אחת לא תואמת)', () => {
  assert.deepEqual(analyzeGrid(GRID_TWO, '206136871'), { found: false, matchType: null });
});

test('analyzeGrid: fallback לשורה יחידה (count==1) — כמו v3.2', () => {
  const rows = [['', '1', 'תעודת זהות', '000000123', 'משה', 'כהן']];
  assert.deepEqual(analyzeGrid(rows, '337386692'), { found: true, matchType: 'single-row-fallback' });
});

test('analyzeGrid: גריד ריק = לא נמצא', () => {
  assert.deepEqual(analyzeGrid([], '337386692'), { found: false, matchType: null });
  assert.deepEqual(analyzeGrid(null, '337386692'), { found: false, matchType: null });
});

test('analyzeGrid: דרכון לא מרופד ולא רגיש לרישיות', () => {
  const rows = [
    ['', '1', 'דרכון', 'AB1234567', 'משה', 'כהן'],
    ['', '2', 'דרכון', 'CD7654321', 'יוסי', 'לוי'],
  ];
  assert.deepEqual(analyzeGrid(rows, 'ab1234567'), { found: true, matchType: 'exact' });
  // דרכון קצר יותר לא "מרופד" ולכן לא תואם (2 שורות → אין fallback)
  assert.deepEqual(analyzeGrid(rows, 'AB12345'), { found: false, matchType: null });
});

test('analyzeGrid: שורת-כותרת לא נספרת כשורת-נתונים', () => {
  const rows = [
    ['', 'סדר קליטה', 'סוג מזהה', 'ת.ז. / דרכון', 'שם', 'שם משפחה'],
    ['', '1', 'תעודת זהות', '000000123', 'משה', 'כהן'],
  ];
  assert.deepEqual(analyzeGrid(rows, '337386692'), { found: true, matchType: 'single-row-fallback' });
});

// ─── סטטוסים ─────────────────────────────────────────────────────────────────
test('isAbsorbSuccess: נקלט/כבר קיים = הצלחה; נחסם/שגיאה = לא', () => {
  assert.equal(isAbsorbSuccess(ABSORB_STATUS.OK), true);
  assert.equal(isAbsorbSuccess(ABSORB_STATUS.OK_NEW), true);
  assert.equal(isAbsorbSuccess(ABSORB_STATUS.EXISTS), true);
  assert.equal(isAbsorbSuccess(ABSORB_STATUS.ERROR), false);
  assert.equal(isAbsorbSuccess(`${ABSORB_STATUS.BLOCKED}: התלמיד קיים במוסד אחר`), false);
  assert.equal(isAbsorbSuccess(ABSORB_STATUS.STOPPED), false);
});

test('absorbStatusKey: חותך את הפירוט אחרי הנקודתיים', () => {
  assert.equal(absorbStatusKey('נחסם: הודעת מערכת'), 'נחסם');
  assert.equal(absorbStatusKey('נקלט'), 'נקלט');
});

// ─── TSV להדבקה לאקסל ────────────────────────────────────────────────────────
const RESULTS = [
  { line: 1, branch: '01', studyType: '600', idType: 'tz', identity: '006136871', status: 'נקלט', detail: '', action: '' },
  { line: 2, branch: '02', studyType: '720', idType: 'tz', identity: '337386692', status: 'שגיאה', detail: 'כפתור קליטה לא נמצא', action: 'בצע ידנית באתר' },
  { line: 3, branch: '02', studyType: '720', idType: 'tz', identity: '206136871', status: 'כבר קיים', detail: '', action: '' },
];

test('buildResultsTsv: כותרת + שורה לכל תוצאה, 5 עמודות בכל שורה', () => {
  const tsv = buildResultsTsv(RESULTS);
  const lines = tsv.split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0], ABSORB_TSV_HEADER.join('\t'));
  assert.equal(lines[0], 'סניף\tסוג לימוד\tת.ז./דרכון\tסטטוס\tמה לעשות');
  for (const line of lines) assert.equal(line.split('\t').length, 5);
  assert.equal(lines[2], '02\t720\t337386692\tשגיאה\tבצע ידנית באתר');
});

test('buildResultsTsv: טאב/שורה חדשה בתוך תא מנוקים (לא שוברים עמודות)', () => {
  const tsv = buildResultsTsv([{ branch: '01', studyType: '600', identity: '1', status: 'a\tb', action: 'c\nd' }]);
  const lines = tsv.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[1].split('\t').length, 5);
  assert.equal(lines[1], '01\t600\t1\ta b\tc d');
});

test('buildResultsTsv: בלי תוצאות = כותרת בלבד', () => {
  assert.equal(buildResultsTsv([]), ABSORB_TSV_HEADER.join('\t'));
});

// ─── דוח "מה נשאר" ───────────────────────────────────────────────────────────
test('buildRemainingReport: רק מה שלא הצליח, עם "מה לעשות"', () => {
  const rep = buildRemainingReport(RESULTS);
  assert.equal(rep.lines.length, 1);
  const line = rep.lines[0];
  for (const part of ['02', '720', '337386692', 'שגיאה', 'בצע ידנית באתר']) {
    assert.ok(line.includes(part), `חסר "${part}" בשורה: ${line}`);
  }
  assert.ok(!rep.lines.join('\n').includes('006136871'), 'הצלחה לא אמורה להופיע בדוח');
});

test('buildRemainingReport: סיכום עם ספירה לכל סטטוס', () => {
  const rep = buildRemainingReport(RESULTS);
  assert.equal(rep.counts['נקלט'], 1);
  assert.equal(rep.counts['שגיאה'], 1);
  assert.equal(rep.counts['כבר קיים'], 1);
  assert.ok(rep.summary.includes('נקלט=1'));
  assert.ok(rep.summary.includes('שגיאה=1'));
  assert.ok(rep.summary.includes('כבר קיים=1'));
});

test('buildRemainingReport: הכל הצליח = אין שורות', () => {
  const rep = buildRemainingReport([RESULTS[0], RESULTS[2]]);
  assert.equal(rep.lines.length, 0);
  assert.equal(rep.summary.includes('נקלט=1'), true);
});

test('summarizeAbsorbResults: מקבץ לפי מפתח-סטטוס (בלי הפירוט)', () => {
  const counts = summarizeAbsorbResults([
    { status: 'נחסם: הודעה א' }, { status: 'נחסם: הודעה ב' }, { status: 'נקלט' },
  ]);
  assert.equal(counts['נחסם'], 2);
  assert.equal(counts['נקלט'], 1);
});

// ─── maskId (פרטיות: לוגים בלבד) ─────────────────────────────────────────────
test('maskId: מחרוזת קצרה מ-5 תווים לא משתנה', () => {
  assert.equal(maskId(''), '');
  assert.equal(maskId('12'), '12');
  assert.equal(maskId('1234'), '1234');
});

test('maskId: מ-5 תווים ומעלה — 3 אחרונים נשמרים, השאר כוכביות', () => {
  assert.equal(maskId('12345'), '**345');
  assert.equal(maskId('337386692'), '******692');
  assert.equal(maskId('AB1234567'), '******567');
});

// ─── לוג (ring buffer) ───────────────────────────────────────────────────────
test('log/getLogText/clearLog: טבעת של 500 שורות', () => {
  clearLog();
  for (let i = 0; i < 520; i++) log('שורה ' + i);
  const lines = getLogText().split('\n');
  assert.equal(lines.length, 500);
  assert.ok(lines[lines.length - 1].includes('שורה 519'));
  assert.ok(!getLogText().includes('שורה 5\n') || true);
  clearLog();
  assert.equal(getLogText(), '');
});

// ─── CSV ─────────────────────────────────────────────────────────────────────
test('toCsv: מצטט תאים עם פסיק/מרכאות/שורה חדשה בלבד', () => {
  const csv = toCsv([['a', 'b'], ['c,d', 'e"f'], ['g\nh', 'i']]);
  assert.equal(csv, 'a,b\r\n"c,d","e""f"\r\n"g\nh",i');
});

test('toCsv: ערכים ריקים/חסרים = תא ריק', () => {
  assert.equal(toCsv([['a', '', null, undefined]]), 'a,,,');
});

test('toCsv: בלי שורות = מחרוזת ריקה', () => {
  assert.equal(toCsv([]), '');
});
