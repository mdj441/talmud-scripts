import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPage, classifyUrl, findStudyTypeRow, gridToRows,
  gotoStudyTypeFromInstitute, gotoBranch, findBranchHref, parsePostbackHref,
  saveNavState, loadNavState, clearNavState,
  parseBranchFromH1, parseSelectedRowIndex, findStudyTypeRowPosition, gridPageSignature,
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

// ─── A1: parseBranchFromH1 + branchSource (טהורה + getPage) ─────────────────
// לכידה-01 §5: h1 של דף המוסד = "<מוסד> סניף NN". כשה-h1 לא נקרא, getPage נופל
// למצב השמור — ואז אסור להתייחס לסניף כאל אמת מאומתת (ממצא A1).
test('parseBranchFromH1: מחלץ ומרפד מספר סניף מה-h1', () => {
  assert.equal(parseBranchFromH1('עטרת שלמה סניף 7'), '07');
  assert.equal(parseBranchFromH1('עטרת שלמה סניף 26'), '26');
  assert.equal(parseBranchFromH1('  עטרת שלמה   סניף  00  '), '00');
});
test('parseBranchFromH1: אין התאמה => null', () => {
  assert.equal(parseBranchFromH1('פרטי מוסד'), null);
  assert.equal(parseBranchFromH1(''), null);
  assert.equal(parseBranchFromH1(null), null);
  assert.equal(parseBranchFromH1(undefined), null);
});

function withFakePage({ url, h1, nav }, fn) {
  const prevDoc = globalThis.document;
  const prevLoc = globalThis.location;
  const prevSession = globalThis.sessionStorage;
  globalThis.sessionStorage = makeFakeSessionStorage(
    nav ? { 'talmud.absorb.nav': JSON.stringify(nav) } : {}
  );
  globalThis.location = { href: url };
  globalThis.document = {
    querySelector: (sel) => (sel === 'h1' && h1 !== null && h1 !== undefined ? { textContent: h1 } : null),
    getElementById: () => null,
  };
  try {
    return fn();
  } finally {
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
    if (prevLoc === undefined) delete globalThis.location; else globalThis.location = prevLoc;
    if (prevSession === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = prevSession;
  }
}

test('getPage: דף מוסד עם h1 תקין => branchSource "h1"', () => {
  const page = withFakePage({
    url: 'https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx?InstituteID=491',
    h1: 'עטרת שלמה סניף 07',
    nav: { currentBranch: '26' },
  }, getPage);
  assert.equal(page.kind, 'institute');
  assert.equal(page.branch, '07');
  assert.equal(page.branchSource, 'h1');
});

test('getPage: דף מוסד בלי h1 קריא => branch מהמצב השמור, אך branchSource "stored" (לא אמת מאומתת)', () => {
  const page = withFakePage({
    url: 'https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx?InstituteID=491',
    h1: 'פרטי מוסד',
    nav: { currentBranch: '26' },
  }, getPage);
  assert.equal(page.kind, 'institute');
  assert.equal(page.branch, '26');
  assert.equal(page.branchSource, 'stored');
});

test('getPage: דף מוסד בלי h1 ובלי מצב שמור => branch null, branchSource null', () => {
  const page = withFakePage({
    url: 'https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx?InstituteID=491',
    h1: null,
    nav: null,
  }, getPage);
  assert.equal(page.branch, null);
  assert.equal(page.branchSource, null);
});

test('getPage: דף סוג-לימוד => הסניף תמיד "stored" (אין סניף ב-DOM, לכידה-02 §1)', () => {
  const page = withFakePage({
    url: 'https://talmud.edu.gov.il/StudyType/StudyTypeDetails.aspx',
    h1: 'סוג לימוד 600 - כולל אברכים יום שלם',
    nav: { currentBranch: '00' },
  }, getPage);
  assert.equal(page.kind, 'studyType');
  assert.equal(page.branch, '00');
  assert.equal(page.studyType, '600');
  assert.equal(page.branchSource, 'stored');
});

// ─── B5: parseSelectedRowIndex (טהורה) — לכידה-02 §2 ────────────────────────
test('parseSelectedRowIndex: onclick עם גרשיים / בלי / עם javascript: => מספר', () => {
  assert.equal(parseSelectedRowIndex("selectedRowStudyType('3')"), 3);
  assert.equal(parseSelectedRowIndex('selectedRowStudyType("12");'), 12);
  assert.equal(parseSelectedRowIndex('selectedRowStudyType(0)'), 0);
  assert.equal(parseSelectedRowIndex("javascript:selectedRowStudyType( '7' );return false;"), 7);
});
test('parseSelectedRowIndex: טקסט שאינו הקריאה הזו => null', () => {
  assert.equal(parseSelectedRowIndex('doSomethingElse(3)'), null);
  assert.equal(parseSelectedRowIndex('selectedRowStudyType()'), null);
  assert.equal(parseSelectedRowIndex(''), null);
  assert.equal(parseSelectedRowIndex(null), null);
  assert.equal(parseSelectedRowIndex(undefined), null);
});

// ─── B5: מיקום השורה + חתימת-עמוד (טהורות) ─────────────────────────────────
test('findStudyTypeRowPosition: מיקום במערך (כולל שורת כותרת), לא אינדקס-נתונים', () => {
  const rows = [header, ...dataRows];
  assert.equal(findStudyTypeRowPosition(rows, '300'), 1);
  assert.equal(findStudyTypeRowPosition(rows, '605'), 3);
  assert.equal(findStudyTypeRowPosition(rows, '999'), -1);
  assert.equal(findStudyTypeRowPosition('לא מערך', '300'), -1);
});

test('gridPageSignature: משתנה בין עמודים, יציב לאותו עמוד', () => {
  const page1 = [header, ...dataRows];
  const page2 = [header, ['728', 'ישיבה קטנה', '45', 'זכאי', '3', '3', '01/01/2020']];
  assert.equal(gridPageSignature(page1), gridPageSignature([header, ...dataRows]));
  assert.notEqual(gridPageSignature(page1), gridPageSignature(page2));
  assert.equal(gridPageSignature([]), gridPageSignature([]));
});
