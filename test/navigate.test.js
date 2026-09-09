import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPage, classifyUrl, findStudyTypeRow, gridToRows,
  gotoStudyTypeFromInstitute, gotoBranch, findBranchHref, parsePostbackHref,
  saveNavState, loadNavState, clearNavState,
} from '../src/core/navigate.js';

// ─── Smoke: import ב-Node לא זרק, כל היצוא פונקציות ─────────────────────────
test('smoke: כל היצוא הוא פונקציות (import ב-Node לא זרק)', () => {
  for (const fn of [getPage, classifyUrl, findStudyTypeRow, gridToRows,
    gotoStudyTypeFromInstitute, gotoBranch, findBranchHref, parsePostbackHref,
    saveNavState, loadNavState, clearNavState]) {
    assert.equal(typeof fn, 'function');
  }
});

// ─── classifyUrl (זיהוי דף לפי URL בלבד, ראו לכידה-01/02/03) ────────────────
test('classifyUrl: דף מוסד', () => {
  assert.equal(
    classifyUrl('https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx?InstituteID=491'),
    'institute'
  );
});
test('classifyUrl: דף סוג-לימוד', () => {
  assert.equal(classifyUrl('https://talmud.edu.gov.il/StudyType/StudyTypeDetails.aspx'), 'studyType');
});
test('classifyUrl: מועמד תלמיד-חדש (לפי URL בלבד — הבדיקה המלאה כוללת hidStudentState ב-getPage)', () => {
  assert.equal(classifyUrl('https://talmud.edu.gov.il/Students/StudentsDetails.aspx?'), 'newStudent');
});
test('classifyUrl: דף אחר', () => {
  assert.equal(classifyUrl('https://talmud.edu.gov.il/Home/Default.aspx'), 'other');
});
test('classifyUrl: קלט לא-מחרוזת => other', () => {
  assert.equal(classifyUrl(undefined), 'other');
});

// ─── findStudyTypeRow (טהורה) — סמנטיקת אינדקס: 0-based בין שורות-נתונים בלבד,
// כותרת (td[0] לא-מספרי) מדולגת ולא נספרת. זה בדיוק מה ש-selectedRowStudyType(i)
// מצפה לו לפי לכידה-02 §2 ("שורה = onclick=selectedRowStudyType('N')").
const header = ['קוד סוג לימודים', 'תיאור', 'שעות שבועיות', 'מצב זכאות', 'מס\' מדווחים', 'מס\' נתמכים', 'תאריך הכרה'];
const dataRows = [
  ['300', 'ישיבה גבוהה בנים', '45', 'זכאי', '10', '8', '01/01/2020'],
  ['600', 'כולל אברכים יום שלם', '40', 'זכאי', '5', '5', '01/01/2020'],
  ['605', 'כולל אברכים יום שלם ב', '40', 'סגור', '0', '0', '01/01/2020'],
];

test('findStudyTypeRow: מוצא שורה תואמת ומחזיר אינדקס יחסי לשורות-נתונים (מדלג על כותרת)', () => {
  const rows = [header, ...dataRows];
  assert.equal(findStudyTypeRow(rows, '300'), 0);
  assert.equal(findStudyTypeRow(rows, '600'), 1);
  assert.equal(findStudyTypeRow(rows, '605'), 2);
});
test('findStudyTypeRow: קוד עם רווחים מסביב', () => {
  const rows = [header, ...dataRows];
  assert.equal(findStudyTypeRow(rows, '  605  '), 2);
});
test('findStudyTypeRow: לא נמצא => -1', () => {
  const rows = [header, ...dataRows];
  assert.equal(findStudyTypeRow(rows, '999'), -1);
});
test('findStudyTypeRow: טבלה בלי שורות-נתונים (רק כותרת) => -1', () => {
  assert.equal(findStudyTypeRow([header], '300'), -1);
});

// ─── findBranchHref + parsePostbackHref — מודלים על לכידה-01 §1 ────────────
// href אמיתי (מהצילום): __doPostBack('ctl00$ucTalmudSideBar$tvTalmud','sעטרת שלמה\00\(720)כולל...')
// צומת-סניף מזוהה לפי href שמסתיים ב-\<קוד>' (לכידה-01: "זיהוי צומת הסניף").
const branchHrefs = [
  "javascript:__doPostBack('ctl00$ucTalmudSideBar$tvTalmud','sעטרת שלמה\\00')",
  "javascript:__doPostBack('ctl00$ucTalmudSideBar$tvTalmud','sעטרת שלמה\\07')",
  "javascript:__doPostBack('ctl00$ucTalmudSideBar$tvTalmud','sעטרת שלמה\\26')",
  // צומת-ילד (סוג לימוד) תחת סניף 00 — לא אמור להיחשב כהתאמה לסניף 00 כי יש עוד אחרי ה-\00:
  "javascript:__doPostBack('ctl00$ucTalmudSideBar$tvTalmud','sעטרת שלמה\\00\\(720)כולל אברכים אחה\"צ')",
];

test('findBranchHref: מוצא את הסניף הנכון (00/07/26) ולא מתבלבל עם צומת-ילד', () => {
  assert.equal(findBranchHref(branchHrefs, '00'), 0);
  assert.equal(findBranchHref(branchHrefs, '07'), 1);
  assert.equal(findBranchHref(branchHrefs, '26'), 2);
});
test('findBranchHref: מרפד קוד חד-ספרתי (padStart)', () => {
  assert.equal(findBranchHref(branchHrefs, 7), 1);
});
test('findBranchHref: לא נמצא => -1', () => {
  assert.equal(findBranchHref(branchHrefs, '99'), -1);
});

test('parsePostbackHref: מפרק target+arg, כולל backslash ועברית בארגומנט', () => {
  const parsed = parsePostbackHref(branchHrefs[0]);
  assert.deepEqual(parsed, {
    target: 'ctl00$ucTalmudSideBar$tvTalmud',
    arg: 'sעטרת שלמה\\00',
  });
});
test('parsePostbackHref: href שלא בפורמט הצפוי => null', () => {
  assert.equal(parsePostbackHref('javascript:doSomethingElse()'), null);
  assert.equal(parsePostbackHref(''), null);
  assert.equal(parsePostbackHref(null), null);
});

// ─── saveNavState / loadNavState / clearNavState — sessionStorage מדומה ─────
function makeFakeSessionStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

test('loadNavState: מחזיר {} כשאין כלום', () => {
  const prev = globalThis.sessionStorage;
  globalThis.sessionStorage = makeFakeSessionStorage();
  try {
    assert.deepEqual(loadNavState(), {});
  } finally {
    if (prev === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = prev;
  }
});

test('saveNavState/loadNavState: round-trip מדויק (בלי מיזוג)', () => {
  const prev = globalThis.sessionStorage;
  globalThis.sessionStorage = makeFakeSessionStorage();
  try {
    saveNavState({ currentBranch: '07' });
    assert.deepEqual(loadNavState(), { currentBranch: '07' });
    saveNavState({ other: 1 }); // שומר בדיוק את מה שניתן — לא ממזג עם הקודם
    assert.deepEqual(loadNavState(), { other: 1 });
  } finally {
    if (prev === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = prev;
  }
});

test('clearNavState: מנקה, loadNavState חוזר ל-{}', () => {
  const prev = globalThis.sessionStorage;
  globalThis.sessionStorage = makeFakeSessionStorage();
  try {
    saveNavState({ currentBranch: '26' });
    clearNavState();
    assert.deepEqual(loadNavState(), {});
  } finally {
    if (prev === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = prev;
  }
});

test('loadNavState: JSON לא תקין => {} (לא זורק)', () => {
  const prev = globalThis.sessionStorage;
  globalThis.sessionStorage = makeFakeSessionStorage({ 'talmud.absorb.nav': '{not-valid-json' });
  try {
    assert.deepEqual(loadNavState(), {});
  } finally {
    if (prev === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = prev;
  }
});

test('loadNavState: sessionStorage לא קיים בכלל => {} (לא זורק, מודול ניתן ל-import ב-Node)', () => {
  const prev = globalThis.sessionStorage;
  delete globalThis.sessionStorage;
  try {
    assert.deepEqual(loadNavState(), {});
  } finally {
    if (prev !== undefined) globalThis.sessionStorage = prev;
  }
});
