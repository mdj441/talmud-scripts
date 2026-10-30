import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ABSORB_STATUS, ABSORB_TSV_HEADER, ABSORB_CSV_HEADER, ABSORB_TEMPLATE_HEADER,
  analyzeGrid, isAbsorbSuccess, absorbStatusKey,
  buildResultsTsv, buildResultsCsvRows, buildRemainingReport, summarizeAbsorbResults,
  absorbParsePostbackFromHref, absorbParseCount, absorbQueueIsStale, makeAbsorbResult,
  absorbShouldRecord, absorbPrecheckDecision, absorbBranchSourceTrusted, absorbNavTimeoutIsNavigation,
} from '../src/tools/absorb-report.js';
import { maskId, maskIdsInText, log, getLogText, clearLog } from '../src/core/log.js';
import { toCsv } from '../src/core/csv.js';

// כל הת.ז. כאן בדויות (337386692 / 206136871 / 6136871 — דוגמאות התוכנית).

// ─── smoke: import ב-Node בלי DOM ────────────────────────────────────────────
test('smoke: absorb-report.js נטען ב-Node והיצוא הטהור הוא פונקציות', () => {
  for (const fn of [analyzeGrid, isAbsorbSuccess, absorbStatusKey,
    buildResultsTsv, buildRemainingReport, summarizeAbsorbResults]) {
    assert.equal(typeof fn, 'function');
  }
  assert.equal(typeof ABSORB_STATUS, 'object');
  assert.ok(Array.isArray(ABSORB_TSV_HEADER));
  assert.ok(Array.isArray(ABSORB_TEMPLATE_HEADER));
});

test('smoke: main.js (נקודת הכניסה המאוחדת) נטען ב-Node בלי לגעת ב-DOM', async () => {
  const mod = await import('../src/main.js');
  assert.equal(typeof mod.initTalmudTools, 'function');
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

// ממצא 10: "התאמה לפי שורה יחידה" מותרת רק כשהתא מכיל את ספרות המזהה (אחרי נרמול), למשל
// תא עם תוספת ("ID 337386692"). שורה יחידה עם מזהה *אחר* אינה הצלחה: {found:false, singleOther}.
test('analyzeGrid (ממצא 10): fallback לשורה יחידה רק כשהתא מכיל את ספרות המזהה', () => {
  const rows = [['', '1', 'תעודת זהות', 'ID 337386692', 'משה', 'כהן']];
  assert.deepEqual(analyzeGrid(rows, '337386692', 1), { found: true, matchType: 'single-row-fallback' });
  assert.deepEqual(analyzeGrid(rows, '337386692'), { found: true, matchType: 'single-row-fallback' });
});

test('analyzeGrid (ממצא 10): שורה יחידה עם מזהה אחר → לא נמצא, עם המזהה שבתא ב-singleOther', () => {
  const rows = [['', '1', 'תעודת זהות', '000000123', 'משה', 'כהן']];
  assert.deepEqual(analyzeGrid(rows, '337386692', 1), { found: false, matchType: null, singleOther: '000000123' });
  assert.deepEqual(analyzeGrid(rows, '337386692', null), { found: false, matchType: null, singleOther: '000000123' });
  assert.deepEqual(analyzeGrid(rows, '337386692'), { found: false, matchType: null, singleOther: '000000123' });
  // עם count=2+ אין fallback וגם אין singleOther (הגריד לא תואם את התווית)
  assert.deepEqual(analyzeGrid(rows, '337386692', 2), { found: false, matchType: null });
});

test('ABSORB_STATUS.VERIFY (ממצא 10): "לאמת ידנית" קיים ואינו הצלחה', () => {
  assert.equal(ABSORB_STATUS.VERIFY, 'לאמת ידנית');
  assert.equal(isAbsorbSuccess(ABSORB_STATUS.VERIFY), false);
});

test('absorbBranchSourceTrusted (F3): רק התווית lblInstituteBranchNumber (label) מספיקה לקליטה במקום', () => {
  assert.equal(absorbBranchSourceTrusted('label'), true);
  assert.equal(absorbBranchSourceTrusted('breadcrumb'), false, 'פירורי-הלחם מטעים (סניף מהכתובת)');
  assert.equal(absorbBranchSourceTrusted('h1'), false, 'בדף סוג-לימוד ה-h1 הוא הקוד, לא הסניף');
  assert.equal(absorbBranchSourceTrusted('institute'), false);
  assert.equal(absorbBranchSourceTrusted('map'), false);
  assert.equal(absorbBranchSourceTrusted('intent'), false);
  assert.equal(absorbBranchSourceTrusted(null), false);
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
    ['', '1', 'תעודת זהות', 'ID 337386692', 'משה', 'כהן'],
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
test('log/getLogText/clearLog: טבעת של 400 שורות (נשמרת ב-sessionStorage כשיש)', () => {
  clearLog();
  for (let i = 0; i < 520; i++) log('שורה ' + i);
  const lines = getLogText().split('\n');
  assert.equal(lines.length, 400);
  assert.ok(lines[lines.length - 1].includes('שורה 519'));
  // 520 נרשמו, 400 נשמרו → השורה הראשונה שנותרה היא "שורה 120".
  assert.ok(lines[0].endsWith('שורה 120'), `שורה ראשונה לא צפויה: ${lines[0]}`);
  assert.ok(!getLogText().includes('שורה 19\n'), 'שורות ישנות היו אמורות ליפול מהטבעת');
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

// ─── buildResultsCsvRows (כותרת + פירוט) ─────────────────────────────────────
test('buildResultsCsvRows: כותרת + שורה אחת עם עמודת פירוט', () => {
  const rows = buildResultsCsvRows([RESULTS[1]]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ABSORB_CSV_HEADER);
  assert.deepEqual(rows[0], ['סניף', 'סוג לימוד', 'ת.ז./דרכון', 'סטטוס', 'פירוט', 'מה לעשות']);
  assert.deepEqual(rows[1], ['02', '720', '337386692', 'שגיאה', 'כפתור קליטה לא נמצא', 'בצע ידנית באתר']);
});

test('buildResultsCsvRows: בלי תוצאות = כותרת בלבד; detail/action חסרים = תא ריק', () => {
  assert.deepEqual(buildResultsCsvRows([]), [ABSORB_CSV_HEADER]);
  const rows = buildResultsCsvRows([{ branch: '01', studyType: '600', identity: '006136871', status: 'נקלט' }]);
  assert.deepEqual(rows[1], ['01', '600', '006136871', 'נקלט', '', '']);
});

// ─── absorbParsePostbackFromHref (אם נשבר — הוולידציה לא רצה, C1/I5) ─────────
test('absorbParsePostbackFromHref: WebForm_DoPostBackWithOptions → target + קבוצת ולידציה', () => {
  const href = 'javascript:WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions("ctl00$ContentPlaceHolder1$x$LinkButton1", "", true, "grpX", "", false, true))';
  assert.deepEqual(absorbParsePostbackFromHref(href), {
    target: 'ctl00$ContentPlaceHolder1$x$LinkButton1', arg: '', group: 'grpX', validate: true,
  });
});

test('absorbParsePostbackFromHref: __doPostBack ישיר → בלי קבוצה ובלי ולידציה', () => {
  assert.deepEqual(absorbParsePostbackFromHref("javascript:__doPostBack('ctl00$ContentPlaceHolder1$btnX','arg1')"), {
    target: 'ctl00$ContentPlaceHolder1$btnX', arg: 'arg1', group: '', validate: false,
  });
});

test('absorbParsePostbackFromHref: href שאינו postback → null', () => {
  assert.equal(absorbParsePostbackFromHref('#'), null);
  assert.equal(absorbParsePostbackFromHref('https://talmud.edu.gov.il/x.aspx'), null);
  assert.equal(absorbParsePostbackFromHref(''), null);
  assert.equal(absorbParsePostbackFromHref(null), null);
  assert.equal(absorbParsePostbackFromHref(undefined), null);
});

// ─── absorbParseCount (עדות שהחיפוש באמת רץ — C4; בלי fallback רופף — M-c) ──
test('absorbParseCount: "נמצאו N" → N, כולל 0', () => {
  assert.equal(absorbParseCount('נמצאו 3 רשומות'), 3);
  assert.equal(absorbParseCount('נמצאו 0 רשומות'), 0);
  assert.equal(absorbParseCount('נמצאו  12  רשומות'), 12);
});

test('absorbParseCount: תווית ריקה/חסרה → null (אין עדות שהחיפוש רץ)', () => {
  assert.equal(absorbParseCount(''), null);
  assert.equal(absorbParseCount(null), null);
  assert.equal(absorbParseCount(undefined), null);
  assert.equal(absorbParseCount('רשומות'), null);
});

test('absorbParseCount: ספרה בלי "נמצאו" → null (לא לוקחים כל מספר בטקסט)', () => {
  assert.equal(absorbParseCount('5 רשומות'), null);
  assert.equal(absorbParseCount('סה"כ: 7'), null);
  assert.equal(absorbParseCount('עמוד 1 מתוך 3'), null);
  assert.equal(absorbParseCount('נמצאו 4 רשומות'), 4);
});

// ─── makeAbsorbResult (מקור אחד לרשומת התוצאה — M2) ─────────────────────────
test('makeAbsorbResult: ת.ז. מרופדת ל-9, detail/action ריקים כברירת מחדל', () => {
  assert.deepEqual(makeAbsorbResult({ line: 3, branch: '01', studyType: '600', idType: 'tz', identity: '6136871' }, ABSORB_STATUS.OK), {
    line: 3, branch: '01', studyType: '600', idType: 'tz', identity: '006136871',
    status: 'נקלט', detail: '', action: '',
  });
});

test('makeAbsorbResult: דרכון לא מרופד; detail/action עוברים כמו שהם', () => {
  assert.deepEqual(makeAbsorbResult({ line: 7, branch: '12', studyType: '720', idType: 'passport', identity: ' AB1234567 ' }, ABSORB_STATUS.ERROR, 'פירוט', 'מה לעשות'), {
    line: 7, branch: '12', studyType: '720', idType: 'passport', identity: 'AB1234567',
    status: 'שגיאה', detail: 'פירוט', action: 'מה לעשות',
  });
});

// ─── absorbQueueIsStale (אין resume אוטומטי לתור ישן — M5) ──────────────────
test('absorbQueueIsStale: מתחת לגיל המרבי = לא ישן, מעליו = ישן', () => {
  const t0 = '2026-09-10T10:00:00.000Z';
  const base = Date.parse(t0);
  const halfHour = 30 * 60 * 1000;
  assert.equal(absorbQueueIsStale(t0, base + 29 * 60 * 1000, halfHour), false);
  assert.equal(absorbQueueIsStale(t0, base + halfHour, halfHour), false);
  assert.equal(absorbQueueIsStale(t0, base + 31 * 60 * 1000, halfHour), true);
});

test('absorbQueueIsStale: חותמת חסרה/פגומה = לא ישן (לא חוסמים המשך)', () => {
  assert.equal(absorbQueueIsStale(null, Date.now(), 1000), false);
  assert.equal(absorbQueueIsStale('', Date.now(), 1000), false);
  assert.equal(absorbQueueIsStale('לא-תאריך', Date.now(), 1000), false);
});

// ─── maskIdsInText (פרטיות: ת.ז. בתוך משפט חופשי) ───────────────────────────
test('maskIdsInText: ממסך רצף של 5+ ספרות בתוך טקסט עברי, משאיר מספרים קצרים', () => {
  assert.equal(maskIdsInText('התלמיד 337386692 קיים במוסד אחר'), 'התלמיד ******692 קיים במוסד אחר');
  assert.equal(maskIdsInText('סניף 01 סוג לימוד 600 — אין שינוי'), 'סניף 01 סוג לימוד 600 — אין שינוי');
  assert.equal(maskIdsInText('קוד 12345 וקוד 1234'), 'קוד **345 וקוד 1234');
  assert.equal(maskIdsInText(null), '');
});

// ─── analyzeGrid עם ספירה (שער הספירה של v3.2 — ממצא #4) ────────────────────
test('analyzeGrid: count=0 → לא נמצא, גם כששורה תואמת עדיין בגריד (גריד ישן)', () => {
  assert.deepEqual(analyzeGrid(GRID_TWO, '006136871', 0), { found: false, matchType: null });
  const single = [['', '1', 'תעודת זהות', '000000123', 'משה', 'כהן']];
  assert.deepEqual(analyzeGrid(single, '337386692', 0), { found: false, matchType: null });
});

test('analyzeGrid: count=0 חוסם גם התאמה מדויקת בשורה יחידה (שער v3.2 — מכוון)', () => {
  // מתועד בכוונה: כשהתווית אומרת "נמצאו 0" הגריד אינו מקור-אמת (הוא עלול להיות ישן),
  // ולכן גם שורה תואמת בדיוק לא נספרת. מחיר: התאמה אמיתית בגריד מרוענן עם תווית 0
  // תיקרא "לא נמצא" — ההתנהגות של v3.2, ונשמרת עד לאימות מול הדף החי.
  const single = [['', '1', 'תעודת זהות', '006136871', 'משה', 'כהן']];
  assert.deepEqual(analyzeGrid(single, '006136871', 0), { found: false, matchType: null });
  assert.deepEqual(analyzeGrid(single, '6136871', 0), { found: false, matchType: null });
});

test('analyzeGrid: count=1 → fallback לשורה יחידה מותר (כשהתא מכיל את המזהה)', () => {
  const single = [['', '1', 'תעודת זהות', '337386692 ', 'משה', 'כהן']];
  assert.deepEqual(analyzeGrid(single, '337386692', 1), { found: true, matchType: 'exact' });
  const prefixed = [['', '1', 'תעודת זהות', 'ID 337386692', 'משה', 'כהן']];
  assert.deepEqual(analyzeGrid(prefixed, '337386692', 1), { found: true, matchType: 'single-row-fallback' });
});

test('analyzeGrid: count=2+ → רק התאמה מדויקת, בלי fallback', () => {
  const single = [['', '1', 'תעודת זהות', 'ID 337386692', 'משה', 'כהן']];
  assert.deepEqual(analyzeGrid(single, '337386692', 2), { found: false, matchType: null });
  assert.deepEqual(analyzeGrid(GRID_TWO, '006136871', 2), { found: true, matchType: 'exact' });
});

test('analyzeGrid: count=null/undefined → התנהגות תואמת-אחורה (fallback מותר כשהתא מכיל את המזהה)', () => {
  const single = [['', '1', 'תעודת זהות', 'ID 337386692', 'משה', 'כהן']];
  assert.deepEqual(analyzeGrid(single, '337386692', null), { found: true, matchType: 'single-row-fallback' });
  assert.deepEqual(analyzeGrid(single, '337386692', undefined), { found: true, matchType: 'single-row-fallback' });
  assert.deepEqual(analyzeGrid(single, '337386692'), { found: true, matchType: 'single-row-fallback' });
});

// ─── absorbShouldRecord (רישום אידמפוטנטי לכל שורה בתור — ממצא #5) ───────────
test('absorbShouldRecord: שורה חדשה נרשמת, אותה שורה פעם שנייה לא', () => {
  assert.equal(absorbShouldRecord(-1, 0), true);
  assert.equal(absorbShouldRecord(3, 4), true);
  assert.equal(absorbShouldRecord(3, 3), false);
  assert.equal(absorbShouldRecord(3, 2), false);
});

test('absorbShouldRecord: אינדקס לא-חוקי לא נרשם; lastIdx חסר = הכול חדש', () => {
  assert.equal(absorbShouldRecord(-1, -1), false);
  assert.equal(absorbShouldRecord(0, null), false);
  assert.equal(absorbShouldRecord(0, 'x'), false);
  assert.equal(absorbShouldRecord(null, 0), true);
  assert.equal(absorbShouldRecord(undefined, 5), true);
});

// ─── absorbNavStateRestore (שחזור מצב-ניווט אחרי ניווט שנכשל — ממצא #1) ──────
test('absorbPrecheckDecision: חיפוש שרץ והגריד התרענן → ניתוח הגריד', () => {
  assert.equal(absorbPrecheckDecision({ executed: true, refreshed: true, count: 0 }), 'analyze');
  assert.equal(absorbPrecheckDecision({ executed: true, refreshed: true, count: 1 }), 'analyze');
  assert.equal(absorbPrecheckDecision({ executed: true, refreshed: true, count: 3 }), 'analyze');
  assert.equal(absorbPrecheckDecision({ executed: true, refreshed: true, count: null }), 'analyze');
});

test('absorbPrecheckDecision: תווית טרייה "נמצאו 0" בלי ריענון גריד → ניתוח (תוצאה ריקה לגיטימית)', () => {
  assert.equal(absorbPrecheckDecision({ executed: true, refreshed: false, countFresh: true, count: 0 }), 'analyze');
});

// ‏A2: זה ה-state הנפוץ ביותר — חיפוש שלא מצא כלום *לא* מרנדר גריד כלל. בלי עד-טריות
// על תווית-הספירה, "נמצאו 0" ישן של התלמיד הקודם היה מכריע "לא נמצא" ולוחץ "קליטה".
test('absorbPrecheckDecision: תווית ישנה שאומרת 0 (בלי עדות טריות) → שגיאה, לא "קליטה"', () => {
  assert.equal(absorbPrecheckDecision({ executed: true, refreshed: false, countFresh: false, count: 0 }), 'error');
  assert.equal(absorbPrecheckDecision({ executed: true, refreshed: false, count: 0 }), 'error');
});

test('absorbPrecheckDecision: תווית טרייה עם 1+ תוצאות אך הגריד לא התרענן → ניסיון חוזר, לא "לא נמצא"', () => {
  assert.equal(absorbPrecheckDecision({ executed: true, refreshed: false, countFresh: true, count: 1 }), 'retry');
  assert.equal(absorbPrecheckDecision({ executed: true, refreshed: false, countFresh: true, count: 7 }), 'retry');
});

test('absorbPrecheckDecision: תווית ישנה עם 1+ תוצאות → שגיאה (אין ממה להסיק)', () => {
  assert.equal(absorbPrecheckDecision({ executed: true, refreshed: false, countFresh: false, count: 1 }), 'error');
});

test('absorbPrecheckDecision: אין עדות שהחיפוש רץ → שגיאה (לא לוחצים "קליטה")', () => {
  assert.equal(absorbPrecheckDecision({ executed: false, refreshed: false, countFresh: true, count: 1 }), 'error');
  assert.equal(absorbPrecheckDecision({ executed: false, refreshed: true, countFresh: true, count: 0 }), 'error');
  assert.equal(absorbPrecheckDecision({ executed: true, refreshed: false, countFresh: true, count: null }), 'error');
  assert.equal(absorbPrecheckDecision(null), 'error');
  assert.equal(absorbPrecheckDecision(undefined), 'error');
  assert.equal(absorbPrecheckDecision('x'), 'error');
});

// ─── W1/W2: אמון בסניף השמור לפי provenance (בדיקה רטובה 10.9.2026) ──────────
// בדף סוג-לימוד אין סניף ב-DOM. הסניף השמור נסמך רק כשנקרא מ-h1 של דף מוסד בטאב הזה
// ושום ניווט לא דרס אותו ('h1'). 'pending' = gotoBranch כתב לפני ירי שאולי נבלע (F2).
// ─── ממצא ב-3 (ביקורת שנייה): ספירה 1+ אך אף תא לא זוהה כמזהה → הרשימה לא קריאה, לא "לא נמצא" ──
test('analyzeGrid (ממצא ב-3): count>=1 ו-0 שורות-מזהה → {found:false, unreadable:true}; count=0/null → כמו קודם', () => {
  const shifted = [['', '1', 'תעודת זהות', 'משה', '337386692', 'כהן']]; // עמודה 3 אינה המזהה
  assert.deepEqual(analyzeGrid(shifted, '337386692', 1), { found: false, matchType: null, unreadable: true });
  assert.deepEqual(analyzeGrid([], '337386692', 2), { found: false, matchType: null, unreadable: true });
  assert.deepEqual(analyzeGrid(shifted, '337386692', 0), { found: false, matchType: null });
  assert.deepEqual(analyzeGrid(shifted, '337386692', null), { found: false, matchType: null });
  assert.deepEqual(analyzeGrid(shifted, '337386692'), { found: false, matchType: null });
  // יש שורת-מזהה אחת (אחרת): לא "לא קריא" אלא singleOther כמו קודם
  const other = [['', '1', 'תעודת זהות', '000000123', 'משה', 'כהן']];
  assert.deepEqual(analyzeGrid(other, '337386692', 1), { found: false, matchType: null, singleOther: '000000123' });
});

// ─── ממצא ב-2: פוסטבק מנווט שפג זמנו אחרי שהדף התחיל להיפרק הוא ניווט, לא כשל ──────────
test('absorbNavTimeoutIsNavigation (ממצא ב-2): רק timeout עם unloadSeen; כשל אחר או בלי פריקה → false', () => {
  assert.equal(absorbNavTimeoutIsNavigation({ ok: false, timeout: true, reason: 'PRM timeout after 25000ms' }, true), true);
  assert.equal(absorbNavTimeoutIsNavigation({ ok: false, timeout: true }, false), false);
  assert.equal(absorbNavTimeoutIsNavigation({ ok: false, reason: 'PRM: server error' }, true), false);
  assert.equal(absorbNavTimeoutIsNavigation({ ok: true }, true), false);
  assert.equal(absorbNavTimeoutIsNavigation(null, true), false);
});
