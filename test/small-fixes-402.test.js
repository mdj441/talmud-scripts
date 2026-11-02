// גרסה 4.0.2: ארבעת הפריטים הקטנים (החלק הטהור). התרחישים החיים ב-test/e2e. הרצה: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as navigate from '../src/core/navigate.js';
import * as absorbFlow from '../src/tools/absorb-flow.js';
import * as depart from '../src/tools/depart.js';
import * as report from '../src/tools/report.js';
import * as absorbReport from '../src/tools/absorb-report.js';
import * as widgets from '../src/ui/widgets.js';

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// ─── פריט 1: תקציב לתלמיד ───────────────────────────────────────────────────
test('runBudgetMs: סכום תקציבי-הצעדים + רזרבה', () => {
  assert.equal(navigate.runBudgetMs({ a: 1000, b: 2000 }, 500), 3500);
  assert.equal(navigate.runBudgetMs({}, 500), 500);
});

test('קליטה: הגבול לתלמיד נגזר מהצעדים (ניווט 25 + לשונית 25 + חיפוש 20 + "קליטה" 20 + אישור 25 + אימות 20) ועוד רזרבה', () => {
  const steps = absorbFlow.ABSORB_STEP_BUDGETS_MS;
  assert.deepEqual(steps, { nav: 25000, tab: 25000, search: 20000, absorbClick: 20000, confirm: 25000, verify: 20000 });
  assert.equal(absorbFlow.ABSORB_STUDENT_TIMEOUT_MS, sum(steps) + navigate.STUDENT_RESERVE_MS);
  assert.ok(navigate.STUDENT_RESERVE_MS > 0, 'יש רזרבה');
});

test('עזיבה: אותו מנגנון; כל צעד שרץ בתוך הניסיון נספר', () => {
  const steps = depart.DEPART_STEP_BUDGETS_MS;
  assert.deepEqual(steps, { tab: 25000, search: 20000, selectRow: 12000, departClick: 20000, confirm: 20000, softContinue: 15000, save: 20000, verify: 20000 });
  assert.equal(depart.DEPART_STUDENT_TIMEOUT_MS, sum(steps) + navigate.STUDENT_RESERVE_MS);
});

// ─── פריט 2: דיווח מדף זר ───────────────────────────────────────────────────
test('reportForeignPage: הדיווח לא משתלט על דף שאינו חלק ממנו (כמו בעזיבה)', () => {
  assert.equal(report.reportForeignPage({ kind: 'other' }), true, 'דף ההודעות');
  assert.equal(report.reportForeignPage({ kind: 'newStudent' }), true);
  assert.equal(report.reportForeignPage(null), true);
  assert.equal(report.reportForeignPage({ kind: 'institute', branch: '05' }), false);
  assert.equal(report.reportForeignPage({ kind: 'institute', branch: null }), false, 'דף מוסד בלי h1: משם העץ');
  assert.equal(report.reportForeignPage({ kind: 'studyType' }), false, 'יש בו עץ');
});

// ─── פריט 3: הודעת האתר → שדה ───────────────────────────────────────────────
test('absorbFieldsFromMessage: נוסחים אמיתיים של האתר והזרימה מצביעים על השדה', () => {
  const f = absorbReport.absorbFieldsFromMessage;
  assert.deepEqual(f('ולידציה בחלון הקליטה: ארץ דרכון הינו חובה'), ['country']);
  assert.deepEqual(f('ארץ דרכון חסרה או לא מוכרת: "קזבלנקה"'), ['country']);
  assert.deepEqual(f('הערך "קזבלנקה" בעמודת "ארץ" (קוד 1) לא קיים ברשימת האתר'), ['country']);
  assert.deepEqual(f('תאריך לידה הינו חובה'), ['birthDate']);
  assert.deepEqual(f('דרכון ללא תאריך לידה'), ['birthDate']);
  assert.deepEqual(f('ולידציה בדף תלמיד-חדש: גיל התלמיד חייב להיות 16 לפחות'), ['birthDate']);
  assert.deepEqual(f('שם פרטי הינו חובה'), ['firstName']);
  assert.deepEqual(f('שם משפחה הינו חובה'), ['lastName']);
  assert.deepEqual(f('אותיות בעברית בלבד'), ['firstName', 'lastName'], 'אותו נוסח לשני השדות באתר');
  assert.deepEqual(f('חסר: שם פרטי, שם משפחה, תאריך לידה'), ['birthDate', 'firstName', 'lastName']);
  assert.deepEqual(f('ת.ז/דרכון הינו חובה'), ['identifier']);
  assert.deepEqual(f('ולידציה בחלון הקליטה: מספר זהות לא חוקי'), ['idType', 'identifier'], 'מספר לא חוקי: או המספר שגוי, או שזה דרכון שסומן ת.ז.');
  assert.deepEqual(f('יש לבחור סוג מזהה'), ['idType']);
});

test('absorbFieldsFromMessage: הודעה שלא מצביעה על שדה בשורה לא צובעת', () => {
  const f = absorbReport.absorbFieldsFromMessage;
  for (const text of [
    '', null, undefined,
    'שגיאה תקלה בתהליך קליטת תלמיד',
    'אין אפשרות לבחור תאריך קטן מהיום!', // תאריך הקליטה בחלונית, לא שדה בשורה
    'אזהרה תלמיד זה רשום כבר במוסד אחר. אם לתלמיד קיימים לימודים של בוקר, אחה"צ, שירות אזרחי או יום שלם - הם יסתיימו החל מרגע זה',
    'ברשימה שורה אחת עם מזהה אחר: 123',
    'נפתח דף תלמיד-חדש של מזהה אחר',
    'הרשימה הציגה 3 תוצאות אך לא ניתן לקרוא בה מזהים',
    'תהליך תקוע: חרג מ-150 שניות',
  ]) assert.deepEqual(f(text), [], String(text));
});

// ─── פריט 4: "ריצה (מושהית)" ────────────────────────────────────────────────
test('stepLabel: שלב מושהה מקבל את התווית, השאר בלי שינוי', () => {
  assert.equal(widgets.stepLabel('ריצה', true), 'ריצה (מושהית)');
  assert.equal(widgets.stepLabel('ריצה', false), 'ריצה');
  assert.equal(widgets.stepLabel('הכנה', false), 'הכנה');
});
