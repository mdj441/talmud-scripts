// בדיקות-יחידה לפונקציות הטהורות של כלי העזיבה (node:test, בלי DOM). כל התעודות בדויות.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPART_STATUS, DEPART_IDS, DEPART_REASONS, DEPART_TSV_HEADER, DEPART_CSV_HEADER,
  parseDepartInput, departNormalizeIdentity, analyzeDepartGrid, departParseCount, departSelectRowIndex,
  departParsePostback, departStatusKey, isDepartSuccess, makeDepartResult, buildDepartTsv, buildDepartCsvRows,
  buildDepartReport, summarizeDepartResults, departIsValidDate, departQueueIsStale, departTodayDMY,
  departHasSavedQueue, departIsRunning, departGetResults,
} from '../src/tools/depart.js';

const T = '\t';

// ─── smoke ───────────────────────────────────────────────────────────────────
test('smoke: depart.js נטען ב-Node והיצוא הטהור הוא פונקציות', () => {
  for (const fn of [parseDepartInput, analyzeDepartGrid, buildDepartTsv, buildDepartReport, departParsePostback]) assert.equal(typeof fn, 'function');
  assert.equal(DEPART_IDS.idField, 'ContentPlaceHolder1_tabInstituteDetails_TabPanel1_ucStudentsSearch_txtStudenPassport');
  assert.equal(DEPART_IDS.deptBtn, 'ContentPlaceHolder1_btnStudentDeparture3');
  assert.deepEqual(DEPART_REASONS.map((r) => r.value), ['1', '3', '4', '6', '7']);
});

test('smoke: depart-ui.js נטען ב-Node ומייצא departTool לפי חוזה הלשונית', async () => {
  const mod = await import('../src/tools/depart-ui.js');
  const t = mod.departTool;
  assert.equal(t.id, 'depart');
  assert.deepEqual(t.pages, ['*']); // הכרעה ח2 (1.11.2026): בכל דף
  assert.deepEqual(t.steps, ['הכנה', 'ריצה', 'תוצאות', 'תיקון והרצה חוזרת']);
  for (const k of ['hasPendingRun', 'isRunning', 'onStop', 'mount']) assert.equal(typeof t[k], 'function', k);
});

test('מצב ריצה ב-Node בלי sessionStorage: אין תור שמור, לא רץ, אין תוצאות (בלי לזרוק)', () => {
  assert.equal(departHasSavedQueue(), false);
  assert.equal(departIsRunning(), false);
  assert.deepEqual(departGetResults(), []);
});

// ─── parseDepartInput ────────────────────────────────────────────────────────
test('parseDepartInput: טאבים, ריפוד סניף ות.ז.', () => {
  const r = parseDepartInput(`0${T}12345678\n16${T}023456789`);
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.tasks.map((t) => [t.branch, t.identity]), [['00', '012345678'], ['16', '023456789']]);
  assert.deepEqual(r.tasks.map((t) => t.line), [1, 2]);
});

test('parseDepartInput: רווחים ופסיקים כמפרידים', () => {
  assert.deepEqual(parseDepartInput('5 012345678').tasks.map((t) => [t.branch, t.identity]), [['05', '012345678']]);
  assert.deepEqual(parseDepartInput('05,012345678').tasks.map((t) => [t.branch, t.identity]), [['05', '012345678']]);
});

test('parseDepartInput: שורת כותרת (גם בסדר הפוך) מדולגת וממפה עמודות', () => {
  const r1 = parseDepartInput(`סניף${T}ת.ז.\n00${T}012345678`);
  assert.deepEqual(r1.tasks.map((t) => [t.branch, t.identity]), [['00', '012345678']]);
  const r2 = parseDepartInput(`ת.ז.${T}סניף\n012345678${T}16`);
  assert.deepEqual(r2.tasks.map((t) => [t.branch, t.identity]), [['16', '012345678']]);
});

test('parseDepartInput: שורות ריקות ו-# מדולגות; שורות שגויות נאספות עם סיבה', () => {
  const r = parseDepartInput(`# הערה\n\n00${T}012345678\nabc${T}012345678\n00${T}12\n00`);
  assert.equal(r.tasks.length, 1);
  assert.equal(r.errors.length, 3);
  assert.match(r.errors[0].reason, /סניף לא תקין/);
  assert.match(r.errors[1].reason, /ת\.ז\. לא תקינה/);
  assert.match(r.errors[2].reason, /חסרים שדות חובה/);
  assert.deepEqual(r.errors.map((e) => e.line), [4, 5, 6]);
});

test('parseDepartInput: דרכון נשמר באותיות גדולות; מרכאות עוטפות מנוקות', () => {
  const r = parseDepartInput(`00${T}ab1234567\n"16"${T}"023456789"`);
  assert.deepEqual(r.tasks.map((t) => t.identity), ['AB1234567', '023456789']);
  assert.equal(r.tasks[1].branch, '16');
});

test('parseDepartInput: קלט ריק → בלי משימות ובלי שגיאות', () => {
  assert.deepEqual(parseDepartInput(''), { tasks: [], errors: [] });
  assert.deepEqual(parseDepartInput(null), { tasks: [], errors: [] });
});

test('departNormalizeIdentity: ריפוד, רווחים ומקפים, שגיאות', () => {
  assert.equal(departNormalizeIdentity('12345678').value, '012345678');
  assert.equal(departNormalizeIdentity('012-345-678').value, '012345678');
  assert.ok(departNormalizeIdentity('1234').error);
  assert.ok(departNormalizeIdentity('0123456789').error);
  assert.ok(departNormalizeIdentity('').error);
});

// ─── analyzeDepartGrid (11 עמודות: ת.ז. באינדקס 3, תאריך עזיבה באינדקס 9) ─────
const ROW = (id, left) => ['', '1', 'תעודת זהות', id, 'ראובן', 'כהן', '01/01/1990', '600', '01/09/2025', left, ''];
const GRID = [ROW('012345678', ''), ROW('023456789', '15/05/2026')];

test('analyzeDepartGrid: נמצא ולא עזב', () => {
  assert.deepEqual(analyzeDepartGrid(GRID, '012345678', 2), { found: true, departed: false, departDate: '', matchType: 'exact' });
});

test('analyzeDepartGrid: נמצא וכבר עזב, עם התאריך', () => {
  const r = analyzeDepartGrid(GRID, '023456789', 2);
  assert.equal(r.found, true);
  assert.equal(r.departed, true);
  assert.equal(r.departDate, '15/05/2026');
});

test('analyzeDepartGrid: ריפוד שונה בקלט ובגריד = התאמה מדויקת', () => {
  assert.equal(analyzeDepartGrid(GRID, '12345678', 2).matchType, 'exact');
});

test('analyzeDepartGrid: count=0 → לא נמצא גם אם הגריד הישן עוד בדף', () => {
  assert.equal(analyzeDepartGrid(GRID, '012345678', 0).found, false);
});

test('analyzeDepartGrid: count=1 ובלי התאמה → השורה היחידה (כמו בישן)', () => {
  const r = analyzeDepartGrid([ROW('000000123', '')], '099999999', 1);
  assert.deepEqual(r, { found: true, departed: false, departDate: '', matchType: 'single-row-fallback' });
});

test('analyzeDepartGrid: בלי תווית ספירה (null) ושתי שורות → רק התאמה מדויקת', () => {
  assert.equal(analyzeDepartGrid(GRID, '099999999', null).found, false);
  assert.equal(analyzeDepartGrid(GRID, '023456789', null).departed, true);
});

test('analyzeDepartGrid: שורת כותרת / שורות קצרות / גריד ריק נדחות', () => {
  const rows = [[], ['', 'סדר', 'סוג'], ROW('012345678', '')];
  assert.equal(analyzeDepartGrid(rows, '012345678', 1).found, true);
  assert.equal(analyzeDepartGrid([], '012345678', 1).found, false);
  assert.equal(analyzeDepartGrid(null, '012345678', 1).found, false);
});

test('departParseCount: "נמצאו N" → N; אין → null', () => {
  assert.equal(departParseCount('נמצאו 3 רשומות בהתאם לקריטריון החיפוש'), 3);
  assert.equal(departParseCount('נמצאו 0 רשומות'), 0);
  assert.equal(departParseCount(''), null);
  assert.equal(departParseCount(null), null);
});

test('departSelectRowIndex: onclick של שורה → אינדקס', () => {
  assert.equal(departSelectRowIndex("selectedRowStudents('3')"), 3);
  assert.equal(departSelectRowIndex('selectedRowStudents(0)'), 0);
  assert.equal(departSelectRowIndex('somethingElse()'), null);
  assert.equal(departSelectRowIndex(null), null);
});

// ─── departParsePostback: href/onclick בלי eval ──────────────────────────────
test('departParsePostback: __doPostBack ישיר ב-href', () => {
  assert.deepEqual(departParsePostback("javascript:__doPostBack('ctl00$ContentPlaceHolder1$btnStudentDeparture3','')"),
    { target: 'ctl00$ContentPlaceHolder1$btnStudentDeparture3', arg: '', group: '', validate: false });
});

test('departParsePostback: עטיפת setTimeout של תיבת-סימון עם גרשים מוברחים', () => {
  const onclick = "javascript:setTimeout('__doPostBack(\\'ctl00$a$gvIStudents$ctl02$chkSelect\\',\\'\\')', 0)";
  assert.deepEqual(departParsePostback(onclick), { target: 'ctl00$a$gvIStudents$ctl02$chkSelect', arg: '', group: '', validate: false });
});

test('departParsePostback: WebForm_DoPostBackWithOptions → קבוצת ולידציה', () => {
  const href = 'javascript:WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions("ctl00$x$btnDepartureStudent", "", true, "CloseStudent", "", false, true))';
  assert.deepEqual(departParsePostback(href), { target: 'ctl00$x$btnDepartureStudent', arg: '', group: 'CloseStudent', validate: true });
});

test('departParsePostback: לא postback → null', () => {
  assert.equal(departParsePostback('#'), null);
  assert.equal(departParsePostback(''), null);
  assert.equal(departParsePostback(undefined), null);
});

// ─── סטטוסים, תוצאות, דוח ────────────────────────────────────────────────────
test('departStatusKey / isDepartSuccess', () => {
  assert.equal(departStatusKey('נחסם: תאריך העזיבה לא יכול להיות לפני תאריך הקליטה'), 'נחסם');
  assert.equal(departStatusKey('כבר בוצעה עזיבה (15/05/2026)'), 'כבר בוצעה עזיבה');
  assert.equal(departStatusKey('הצליח'), 'הצליח');
  assert.equal(isDepartSuccess('הצליח'), true);
  assert.equal(isDepartSuccess('כבר בוצעה עזיבה (15/05/2026)'), true);
  assert.equal(isDepartSuccess('לא נמצא'), false);
  assert.equal(isDepartSuccess('נחסם: x'), false);
  assert.equal(isDepartSuccess(DEPART_STATUS.UNVERIFIED), false);
});

const RESULTS = [
  makeDepartResult({ line: 1, branch: '00', identity: '012345678' }, 'הצליח', '', ''),
  makeDepartResult({ line: 2, branch: '16', identity: '023456789' }, 'לא נמצא', 'נמצאו 0 רשומות', 'בדוק את הסניף'),
  makeDepartResult({ line: 3, branch: '00', identity: '034567890' }, 'כבר בוצעה עזיבה (15/05/2026)', '', ''),
  makeDepartResult({ line: 4, branch: '00', identity: '045678901' }, 'נחסם: הודעת מערכת', 'הודעת מערכת', 'טפל ידנית'),
];

test('buildDepartTsv: כותרת + שורה לכל תוצאה, 4 עמודות', () => {
  const lines = buildDepartTsv(RESULTS).split('\n');
  assert.equal(lines.length, 5);
  assert.equal(lines[0], DEPART_TSV_HEADER.join('\t'));
  assert.equal(lines[0], 'סניף\tת.ז.\tסטטוס\tמה לעשות');
  for (const l of lines) assert.equal(l.split('\t').length, 4);
  assert.equal(lines[2], '16\t023456789\tלא נמצא\tבדוק את הסניף');
  assert.equal(buildDepartTsv([]), DEPART_TSV_HEADER.join('\t'));
});

test('buildDepartTsv: טאב/שורה חדשה בתוך תא מנוקים', () => {
  const lines = buildDepartTsv([{ branch: '00', identity: '1', status: 'a\tb', action: 'c\nd' }]).split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[1], '00\t1\ta b\tc d');
});

test('buildDepartCsvRows: כותרת + פירוט', () => {
  const rows = buildDepartCsvRows([RESULTS[3]]);
  assert.deepEqual(rows[0], DEPART_CSV_HEADER);
  assert.deepEqual(rows[1], ['00', '045678901', 'נחסם: הודעת מערכת', 'הודעת מערכת', 'טפל ידנית']);
});

test('buildDepartReport: רק מה שלא הצליח (כבר עזב = לא דורש טיפול), עם סיכום', () => {
  const rep = buildDepartReport(RESULTS);
  assert.equal(rep.lines.length, 2);
  assert.ok(rep.lines[0].includes('023456789') && rep.lines[0].includes('לא נמצא') && rep.lines[0].includes('בדוק את הסניף'));
  assert.ok(rep.lines[1].includes('045678901') && rep.lines[1].includes('נחסם'));
  assert.ok(!rep.lines.join('\n').includes('012345678'));
  assert.ok(!rep.lines.join('\n').includes('034567890'));
  assert.equal(rep.counts['הצליח'], 1);
  assert.equal(rep.counts['כבר בוצעה עזיבה'], 1);
  assert.equal(rep.counts['נחסם'], 1);
  assert.ok(rep.summary.includes('לא נמצא=1'));
  assert.ok(!rep.summary.includes('—') && !rep.lines.join('').includes('—'), 'בלי מקף ארוך');
});

test('summarizeDepartResults: מקבץ לפי מפתח-סטטוס', () => {
  assert.deepEqual(summarizeDepartResults([{ status: 'נחסם: א' }, { status: 'נחסם: ב' }, { status: 'הצליח' }]), { 'נחסם': 2, 'הצליח': 1 });
});

// ─── תאריכים ותור ────────────────────────────────────────────────────────────
test('departIsValidDate: DD/MM/YYYY בלבד, עם בדיקת יום בחודש', () => {
  assert.equal(departIsValidDate('01/09/2026'), true);
  assert.equal(departIsValidDate('31/02/2026'), false);
  assert.equal(departIsValidDate('1/9/2026'), false);
  assert.equal(departIsValidDate('2026-09-01'), false);
  assert.equal(departIsValidDate(''), false);
  assert.match(departTodayDMY(), /^\d{2}\/\d{2}\/\d{4}$/);
});

test('departQueueIsStale: מעל 30 דקות = ישן; startedAt חסר = לא ישן', () => {
  const t0 = Date.parse('2026-09-10T10:00:00Z');
  assert.equal(departQueueIsStale('2026-09-10T10:00:00Z', t0 + 31 * 60000), true);
  assert.equal(departQueueIsStale('2026-09-10T10:00:00Z', t0 + 5 * 60000), false);
  assert.equal(departQueueIsStale(null, t0), false);
});
