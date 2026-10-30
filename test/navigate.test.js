import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPage, classifyUrl, findStudyTypeRow, findStudyTypeRowPosition, gridToRows, gridPageSignature, gridStudyTypes,
  gotoStudyTypeFromInstitute, gotoInstitute, gotoStudyType, findBranchHref, branchesFromTreeHrefs, parsePostbackHref,
  parseBranchFromH1, parseStudyTypeFromH1, parseSelectedRowIndex, normalizeBranch,
  parseInstituteId, parseInstituteStudyTypeId, institutesPageUrl, readBranchesFromTree,
} from '../src/core/navigate.js';

// עובדות מהאתר החי (30.10.2026): הדף הולך אחרי ה-session של השרת ולא אחרי הכתובת. הסניף בדף
// המוסד נקרא מה-h1 (או מהתווית "מספר סניף"), בדף סוג-הלימוד רק מהתווית lblInstituteBranchNumber.
// פירורי-הלחם מטעים ואינם מקור. ניווט: עץ-הצד (טעינה מלאה, הכתובת לא משתנה) ואז הגריד.

const INST_00 = 'https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx?InstituteID=491';
const INST_16 = 'https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx?InstituteID=4159';
const ST_16_600 = 'https://talmud.edu.gov.il/StudyType/StudyTypeDetails.aspx?InstituteStudyTypeID=10269&InstituteID=4159';
const ST_NO_QUERY = 'https://talmud.edu.gov.il/StudyType/StudyTypeDetails.aspx';
const HUB = 'https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx';

test('smoke: כל היצוא הוא פונקציות (import ב-Node לא זרק)', () => {
  for (const fn of [getPage, classifyUrl, findStudyTypeRow, gridToRows, gotoStudyTypeFromInstitute, gotoInstitute, gotoStudyType,
    findBranchHref, parsePostbackHref, institutesPageUrl, readBranchesFromTree]) {
    assert.equal(typeof fn, 'function');
  }
});

// ─── classifyUrl ─────────────────────────────────────────────────────────────
test('classifyUrl: מוסד / סוג-לימוד (עם ובלי query) / תלמיד-חדש / אחר / לא-מחרוזת', () => {
  assert.equal(classifyUrl(INST_00), 'institute');
  assert.equal(classifyUrl(HUB), 'institute');
  assert.equal(classifyUrl(ST_16_600), 'studyType');
  assert.equal(classifyUrl(ST_NO_QUERY), 'studyType');
  assert.equal(classifyUrl('https://talmud.edu.gov.il/Students/StudentsDetails.aspx?'), 'newStudent');
  assert.equal(classifyUrl('https://talmud.edu.gov.il/Home/Default.aspx'), 'other');
  assert.equal(classifyUrl(undefined), 'other');
});

// ─── פרסור טהור ─────────────────────────────────────────────────────────────
test('parseInstituteId / parseInstituteStudyTypeId: מהכתובת, לא רגיש לרישיות, null כשאין', () => {
  assert.equal(parseInstituteId(ST_16_600), '4159');
  assert.equal(parseInstituteId('https://x/y.aspx?instituteid=7&a=1'), '7');
  assert.equal(parseInstituteId('https://x/y.aspx?InstituteID=abc'), null);
  assert.equal(parseInstituteId(null), null);
  assert.equal(parseInstituteStudyTypeId(ST_16_600), '10269');
  assert.equal(parseInstituteStudyTypeId(INST_00), null);
});

test('parseBranchFromH1: "<מוסד> סניף NN" → מרופד; ריק/אין → null', () => {
  assert.equal(parseBranchFromH1('עטרת שלמה סניף 07'), '07');
  assert.equal(parseBranchFromH1('עטרת שלמה סניף 0'), '00');
  assert.equal(parseBranchFromH1('עטרת שלמה סניף 26'), '26');
  assert.equal(parseBranchFromH1('פרטי מוסד'), null);
  assert.equal(parseBranchFromH1(''), null);
  assert.equal(parseBranchFromH1(null), null);
});

test('parseStudyTypeFromH1: "סוג לימוד 600 - ..." → "600"; ריק → null', () => {
  assert.equal(parseStudyTypeFromH1('סוג לימוד 600 - כולל אברכים יום שלם'), '600');
  assert.equal(parseStudyTypeFromH1('פרטי סוג לימוד'), null);
  assert.equal(parseStudyTypeFromH1(''), null);
});

test('normalizeBranch: ריפוד; לא-תקין → null', () => {
  assert.equal(normalizeBranch('7'), '07');
  assert.equal(normalizeBranch(0), '00');
  assert.equal(normalizeBranch(' 16 '), '16');
  assert.equal(normalizeBranch('123'), null);
  assert.equal(normalizeBranch(''), null);
});

test('institutesPageUrl: דף המוסדות בלי query (ה-session קובע מה יוצג)', () => {
  assert.equal(institutesPageUrl(), HUB);
});

// ─── גריד סוגי-לימוד (טהור) ─────────────────────────────────────────────────
const header = ['קוד סוג לימודים', 'תיאור', 'שעות שבועיות', 'מצב זכאות', 'מס\' מדווחים', 'מס\' נתמכים', 'תאריך הכרה'];
const dataRows = [
  ['300', 'ישיבה גבוהה בנים', '45', 'זכאי', '10', '8', '01/01/2020'],
  ['600', 'כולל אברכים יום שלם', '40', 'זכאי', '5', '5', '01/01/2020'],
  ['605', 'כולל אברכים יום שלם ב', '40', 'סגור', '0', '0', '01/01/2020'],
];

test('findStudyTypeRow: אינדקס יחסי לשורות-נתונים (כותרת לא נספרת); לא נמצא → -1', () => {
  const rows = [header, ...dataRows];
  assert.equal(findStudyTypeRow(rows, '300'), 0);
  assert.equal(findStudyTypeRow(rows, '  605  '), 2);
  assert.equal(findStudyTypeRow(rows, '999'), -1);
  assert.equal(findStudyTypeRow([header], '300'), -1);
});

test('findStudyTypeRowPosition: מיקום במערך כולל כותרת', () => {
  assert.equal(findStudyTypeRowPosition([header, ...dataRows], '600'), 2);
});

test('gridStudyTypes: קוד/תיאור/מצב לכל שורת-נתונים', () => {
  assert.deepEqual(gridStudyTypes([header, ...dataRows]).map((s) => s.code + ':' + s.status), ['300:זכאי', '600:זכאי', '605:סגור']);
});

test('parseSelectedRowIndex / gridPageSignature', () => {
  assert.equal(parseSelectedRowIndex("selectedRowStudyType('3')"), 3);
  assert.equal(parseSelectedRowIndex('javascript:selectedRowStudyType(0)'), 0);
  assert.equal(parseSelectedRowIndex('foo()'), null);
  const a = gridPageSignature([header, ...dataRows]);
  assert.equal(a, gridPageSignature([header, ...dataRows]));
  assert.notEqual(a, gridPageSignature([header, dataRows[0]]));
});

// ─── עץ ─────────────────────────────────────────────────────────────────────
const hrefs = [
  "javascript:__doPostBack('ctl00$ucTalmudSideBar$tvTalmud','sעטרת שלמה\\00')",
  "javascript:__doPostBack('ctl00$ucTalmudSideBar$tvTalmud','sעטרת שלמה\\00\\(720)כולל')",
  "javascript:__doPostBack('ctl00$ucTalmudSideBar$tvTalmud','sעטרת שלמה\\07')",
  "javascript:__doPostBack('ctl00$ucTalmudSideBar$tvTalmud','sעטרת שלמה\\16')",
  "javascript:__doPostBack('ctl00$ucTalmudSideBar$tvTalmud','sעטרת שלמה\\26')",
];
test('findBranchHref / branchesFromTreeHrefs / parsePostbackHref', () => {
  assert.equal(findBranchHref(hrefs, '00'), 0);
  assert.equal(findBranchHref(hrefs, '7'), 2);
  assert.equal(findBranchHref(hrefs, '26'), 4);
  assert.equal(findBranchHref(hrefs, '99'), -1);
  assert.deepEqual(branchesFromTreeHrefs(hrefs), ['00', '07', '16', '26']);
  assert.deepEqual(parsePostbackHref(hrefs[2]), { target: 'ctl00$ucTalmudSideBar$tvTalmud', arg: 'sעטרת שלמה\\07' });
  assert.equal(parsePostbackHref('javascript:void(0)'), null);
});

// ─── סביבה מדומה: location / document / window ──────────────────────────────
// ‏h1: טקסט ה-h1 (null = אין h1, '' = h1 ריק כמו ב-GET ישיר באתר). ‏insLabel: span lblInsBranchNumber (דף מוסד).
// ‏stLabel: span lblInstituteBranchNumber (דף סוג-לימוד). ‏crumbs: טקסט פירורי-הלחם (מטעה: חייב להתעלם).
// ‏tree: hrefs של עץ-הצד (אין = אין עץ בדף). ‏st = מצב משתנה (st.h1) לבדיקות שמשנות את הדף.
async function withPage({ url, h1, insLabel, stLabel, crumbs, tree, hid, tabs }, fn) {
  const prev = { document: globalThis.document, location: globalThis.location, window: globalThis.window };
  globalThis.location = { href: url, protocol: 'https:', host: 'talmud.edu.gov.il', origin: 'https://talmud.edu.gov.il' };
  const treeAnchors = (tree || []).map((h) => ({ getAttribute: (n) => (n === 'href' ? h : null) }));
  const crumbEl = crumbs == null ? null : { innerText: crumbs, textContent: crumbs };
  const st = { h1, insLabel, stLabel };
  const span = (v) => (v == null ? null : { textContent: v, innerText: v });
  globalThis.document = {
    querySelector: (sel) => {
      if (sel === 'h1') return st.h1 == null ? null : { textContent: st.h1 };
      if (sel === '[id$="lblInsBranchNumber"]') return span(st.insLabel);
      if (sel === '[id$="lblInstituteBranchNumber"]') return span(st.stLabel);
      if (/BreadCrumb|breadcrumb|SiteMapPath/.test(sel)) return crumbEl;
      if (sel === '[id$="tvTalmud"]') return tree ? { querySelectorAll: () => treeAnchors } : null;
      return null;
    },
    querySelectorAll: (sel) => (/BreadCrumb|breadcrumb|SiteMapPath/.test(sel) && crumbEl ? [crumbEl] : []),
    getElementById: (id) => (hid && id in hid ? { value: hid[id] } : null),
    body: { innerText: crumbs || '' },
  };
  globalThis.window = { __doPostBack: () => {}, $find: (id) => (tabs && tabs[id]) || null };
  try { return await fn(st); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

// ─── זיהוי דף: דף מוסד ──────────────────────────────────────────────────────
test('getPage (F1): דף מוסד → הסניף מה-h1 (branchSource h1), לא מהכתובת ולא מפירורי-הלחם', async () => {
  // הכתובת אומרת 4159 (סניף 16) ופירורי-הלחם "16", אך ה-session הציג את 00: ה-h1 קובע
  await withPage({ url: INST_16, h1: 'עטרת שלמה סניף 00', insLabel: '00', crumbs: 'בית > עטרת שלמה > 16' }, () => {
    const p = getPage();
    assert.equal(p.kind, 'institute');
    assert.equal(p.branch, '00');
    assert.equal(p.branchSource, 'h1');
    assert.equal(p.instituteId, '4159', 'ה-InstituteID מהכתובת נשמר למידע בלבד');
    assert.equal(p.studyType, null);
  });
});

test('getPage (F1): דף מוסד עם h1 ריק → הסניף מהתווית "מספר סניף" (branchSource label)', async () => {
  await withPage({ url: INST_16, h1: '', insLabel: '16' }, () => {
    const p = getPage();
    assert.equal(p.branch, '16');
    assert.equal(p.branchSource, 'label');
  });
  await withPage({ url: HUB, h1: '', stLabel: '05' }, () => {
    const p = getPage();
    assert.equal(p.branch, '05', 'גם lblInstituteBranchNumber מתקבל בדף המוסד');
    assert.equal(p.branchSource, 'label');
  });
});

test('getPage (F1): דף מוסד בלי h1 ובלי תווית (GET ישיר בלי session) → branch null; פירורי-הלחם לא עוזרים', async () => {
  await withPage({ url: INST_16, h1: '', insLabel: '', crumbs: 'בית > עטרת שלמה > 16' }, () => {
    const p = getPage();
    assert.equal(p.kind, 'institute');
    assert.equal(p.branch, null);
    assert.equal(p.branchSource, null);
  });
  await withPage({ url: INST_00, h1: 'פרטי מוסד' }, () => {
    assert.equal(getPage().branch, null);
  });
});

// ─── זיהוי דף: דף סוג-לימוד ─────────────────────────────────────────────────
test('getPage (F3): דף סוג-לימוד דרך הגריד (בלי query) → סוג מה-h1, סניף רק מהתווית lblInstituteBranchNumber', async () => {
  await withPage({ url: ST_NO_QUERY, h1: 'סוג לימוד 600 - כולל אברכים יום שלם', stLabel: '00', crumbs: 'בית > איתור מוסד > פרטי מוסד > פרטי סוג לימוד' }, () => {
    const p = getPage();
    assert.equal(p.kind, 'studyType');
    assert.equal(p.studyType, '600');
    assert.equal(p.branch, '00');
    assert.equal(p.branchSource, 'label');
    assert.equal(p.instituteId, null);
    assert.equal(p.instituteStudyTypeId, null);
  });
});

test('getPage (F3): GET ישיר לדף סוג-לימוד עם query → h1 ריק ⇒ studyType null; הסניף מהתווית (session), לא מפירורי-הלחם (כתובת)', async () => {
  await withPage({ url: ST_16_600, h1: '', stLabel: '00', crumbs: 'בית > איתור מוסד > עטרת שלמה > 16 > (600)כולל אברכים' }, () => {
    const p = getPage();
    assert.equal(p.kind, 'studyType');
    assert.equal(p.studyType, null, 'h1 ריק: הדף לא מזוהה, חובה לנווט');
    assert.equal(p.branch, '00', 'התווית (session) ולא "16" מפירורי-הלחם');
    assert.equal(p.branchSource, 'label');
    assert.equal(p.instituteId, '4159');
    assert.equal(p.instituteStudyTypeId, '10269');
  });
});

test('getPage: דף סוג-לימוד בלי תווית → branch null גם כשפירורי-הלחם מראים סניף; lblInsBranchNumber אינו מקור כאן', async () => {
  await withPage({ url: ST_NO_QUERY, h1: 'סוג לימוד 600 - כולל', insLabel: '16', crumbs: 'עטרת שלמה > 16 > (600)כולל' }, () => {
    const p = getPage();
    assert.equal(p.studyType, '600');
    assert.equal(p.branch, null);
    assert.equal(p.branchSource, null);
  });
});

test('getPage: דף תלמיד-חדש → רק עם hidStudentState=-1, עם המזהה שבשדה; אחרת other', async () => {
  const url = 'https://talmud.edu.gov.il/Students/StudentsDetails.aspx?';
  const SD = 'ContentPlaceHolder1_TabsStudent_StudentDetails1_ucStudentDetails';
  await withPage({ url, hid: { [`${SD}_hidStudentState`]: '-1', [`${SD}_txtID`]: '012345678' } }, () => {
    const p = getPage();
    assert.equal(p.kind, 'newStudent');
    assert.equal(p.identity, '012345678');
  });
  await withPage({ url, hid: { [`${SD}_hidStudentState`]: '' } }, () => {
    assert.equal(getPage().kind, 'other');
  });
});

test('readBranchesFromTree: מהעץ שבדף; בלי עץ → []', async () => {
  await withPage({ url: ST_NO_QUERY, tree: hrefs }, () => {
    assert.deepEqual(readBranchesFromTree(), ['00', '07', '16', '26']);
  });
  await withPage({ url: ST_NO_QUERY }, () => {
    assert.deepEqual(readBranchesFromTree(), []);
  });
});

// ─── ניווט: עץ-הצד ─────────────────────────────────────────────────────────
test('gotoInstitute (F2): יש עץ בדף → postback של צומת הסניף, method tree, הכתובת לא משתנה', async () => {
  await withPage({ url: INST_00, h1: 'עטרת שלמה סניף 00', tree: hrefs }, async () => {
    let fired = null;
    globalThis.window.__doPostBack = (t, a) => { fired = { t, a }; };
    const p = gotoInstitute('16');
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(fired, { t: 'ctl00$ucTalmudSideBar$tvTalmud', a: 'sעטרת שלמה\\16' });
    const res = await p;
    assert.equal(res.ok, true);
    assert.equal(res.method, 'tree');
    assert.equal(res.branch, '16');
    assert.equal(globalThis.location.href, INST_00, 'לא נורה ניווט לפי כתובת');
  });
});

test('gotoInstitute (F2): העץ קיים גם בדף סוג-לימוד → postback משם, בלי כתובת ישירה', async () => {
  await withPage({ url: ST_16_600, h1: '', stLabel: '00', tree: hrefs }, async () => {
    let fired = null;
    globalThis.window.__doPostBack = (t, a) => { fired = { t, a }; };
    const res = await gotoInstitute('16');
    assert.equal(res.method, 'tree');
    assert.equal(fired && fired.a, 'sעטרת שלמה\\16');
    assert.equal(globalThis.location.href, ST_16_600);
  });
});

test('gotoInstitute: סניף שאינו בעץ → notFound; סניף לא-תקין → ok:false', async () => {
  await withPage({ url: INST_00, h1: 'עטרת שלמה סניף 00', tree: hrefs }, async () => {
    const missing = await gotoInstitute('99');
    assert.equal(missing.ok, false);
    assert.equal(missing.notFound, true);
    assert.equal((await gotoInstitute('abc')).ok, false);
  });
});

test('gotoInstitute: אין עץ בדף (תלמיד-חדש / אחר) → location.href לדף המוסדות בלי query (ה-session קובע), hop', async () => {
  await withPage({ url: 'https://talmud.edu.gov.il/Students/StudentsDetails.aspx?', h1: null }, async () => {
    const res = await gotoInstitute('16');
    assert.equal(res.ok, true);
    assert.equal(res.method, 'url');
    assert.equal(res.hop, true);
    assert.equal(globalThis.location.href, HUB);
  });
});

// ─── ניווט: גריד ────────────────────────────────────────────────────────────
test('gotoStudyType (F4): דף מוסד שה-h1 שלו הוא הסניף המבוקש → הגריד (לא העץ)', async () => {
  await withPage({ url: INST_00, h1: 'עטרת שלמה סניף 00', tree: hrefs }, async () => {
    let treeFired = false;
    globalThis.window.__doPostBack = (t) => { if (/tvTalmud/.test(t)) treeFired = true; };
    const res = await gotoStudyType('00', '600');
    assert.equal(treeFired, false, 'לא לוחצים בעץ כשכבר בדף המוסד הנכון');
    assert.equal(res.ok, false, 'בדף המדומה אין לשונית/גריד: הגריד נכשל, אך זה המסלול הנכון');
    assert.match(res.reason, /לשונית|טאב|גריד/);
  });
});

test('gotoStudyType (F1): דף מוסד של סניף אחר (הכתובת של 16, ה-h1 של 00) → העץ ל-16, לא הגריד', async () => {
  await withPage({ url: INST_16, h1: 'עטרת שלמה סניף 00', tree: hrefs }, async () => {
    let fired = null;
    globalThis.window.__doPostBack = (t, a) => { fired = { t, a }; };
    const res = await gotoStudyType('16', '600');
    assert.equal(res.method, 'tree');
    assert.equal(fired && fired.a, 'sעטרת שלמה\\16');
    assert.equal(res.studyType, '600');
  });
});

test('gotoStudyType: דף מוסד עם h1 ריק ותווית של הסניף המבוקש → בכל זאת העץ (רק h1 מאשר לגריד)', async () => {
  await withPage({ url: INST_16, h1: '', insLabel: '16', tree: hrefs }, async () => {
    const res = await gotoStudyType('16', '600');
    assert.equal(res.method, 'tree');
  });
});

test('gotoStudyType (מלכודת F1/F3): דף סוג-לימוד 600 שהתווית שלו 00 ומבקשים 16/600 → העץ ל-16; בלי כתובת ישירה', async () => {
  await withPage({ url: ST_16_600, h1: 'סוג לימוד 600 - כולל', stLabel: '00', crumbs: 'עטרת שלמה > 16 > (600)כולל', tree: hrefs }, async () => {
    let fired = null;
    globalThis.window.__doPostBack = (t, a) => { fired = { t, a }; };
    const res = await gotoStudyType('16', '600');
    assert.equal(res.method, 'tree');
    assert.equal(fired && fired.a, 'sעטרת שלמה\\16');
    assert.equal(globalThis.location.href, ST_16_600, 'הכתובת לא השתנתה');
  });
});

test('gotoStudyType: דף בלי עץ (תלמיד-חדש) → לדף המוסדות לפי כתובת (ומשם, אחרי הטעינה, העץ והגריד)', async () => {
  await withPage({ url: 'https://talmud.edu.gov.il/Students/StudentsDetails.aspx?', h1: null }, async () => {
    const res = await gotoStudyType('16', '600');
    assert.equal(res.ok, true);
    assert.equal(res.method, 'url');
    assert.equal(globalThis.location.href, HUB);
  });
});

test('gotoStudyType: סניף/סוג לא-תקינים → ok:false בלי לגעת בדף', async () => {
  await withPage({ url: INST_00, h1: 'עטרת שלמה סניף 00', tree: hrefs }, async () => {
    assert.equal((await gotoStudyType('abc', '600')).ok, false);
    assert.equal((await gotoStudyType('00', 'x')).ok, false);
    assert.equal(globalThis.location.href, INST_00);
  });
});

// ─── F4 (תיקון): הפעלת הלשונית היא postback א-סינכרוני; הגריד והכפתור נבנים מחדש אחריו ─────
// ‏tabs: TabContainer מדומה; ‏set_activeTabIndex מריץ "postback" שמחליף את הגריד. הגריד נקרא רק אחרי
// שההמתנה הסתיימה, ו-btnUpdateStudyType נורה רק אחרי selectedRowStudyType על הגריד המרוענן.
function fakeGrid(rowsSpec) {
  const trs = rowsSpec.map(([cells, onclick]) => ({
    getAttribute: (n) => (n === 'onclick' ? onclick || null : null),
    querySelectorAll: (sel) => (sel === 'td,th' ? cells.map((c) => ({ textContent: c })) : []),
  }));
  return { querySelectorAll: (sel) => (sel === 'tr' ? trs : (sel === 'tr:last-child a' ? [] : [])) };
}

test('gotoStudyTypeFromInstitute (F4 מתוקן): לשונית → המתנה ל-postback → גריד מרוענן → selectedRowStudyType → עריכה', async () => {
  const TAB = 'ContentPlaceHolder1_tabInstituteDetails';
  const events = [];
  let gridEl = null; // לפני הפעלת הלשונית אין גריד בדף
  let activeTab = 0;
  const prm = (() => {
    const h = { begin: [], end: [] };
    const obj = {
      _isInAsyncPostBack: false,
      add_beginRequest: (f) => h.begin.push(f), add_endRequest: (f) => h.end.push(f),
      remove_beginRequest: (f) => { h.begin = h.begin.filter((x) => x !== f); }, remove_endRequest: (f) => { h.end = h.end.filter((x) => x !== f); },
      roundTrip(apply) {
        obj._isInAsyncPostBack = true;
        setTimeout(() => { for (const f of h.begin.slice()) f(obj, {}); }, 5);
        setTimeout(() => { apply(); obj._isInAsyncPostBack = false; for (const f of h.end.slice()) f(obj, { get_error: () => null, set_errorHandled() {} }); }, 40);
      },
    };
    return obj;
  })();
  const tabs = { [TAB]: {
    get_activeTabIndex: () => activeTab,
    set_activeTabIndex: (i) => {
      events.push(`tab:${i}`);
      // כמו באתר: postback א-סינכרוני; הגריד מופיע רק אחרי שהוא מסתיים
      prm.roundTrip(() => { activeTab = Number(i); gridEl = fakeGrid([[['קוד', 'תיאור', 'שעות', 'מצב']], [['300', 'ישיבה', '45', 'זכאי'], "selectedRowStudyType('0')"], [['600', 'כולל', '40', 'זכאי'], "selectedRowStudyType('1')"]]); });
    },
  } };
  const prevSys = globalThis.Sys;
  globalThis.Sys = { WebForms: { PageRequestManager: { getInstance: () => prm } } };
  try {
    await withPage({ url: INST_00, h1: 'עטרת שלמה סניף 00', tabs }, async () => {
      globalThis.document.querySelector = ((orig) => (sel) => (sel === 'table[id$="gvStudyType"]' ? gridEl : orig(sel)))(globalThis.document.querySelector);
      globalThis.window.selectedRowStudyType = (n) => { events.push(`select:${n}`); };
      globalThis.window.__doPostBack = (t) => { events.push(`postback:${t}`); prm.roundTrip(() => {}); };
      const res = await gotoStudyTypeFromInstitute('600');
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(res.method, 'grid');
      assert.equal(res.status, 'זכאי');
      assert.deepEqual(events, ['tab:1', 'select:1', 'postback:ctl00$ContentPlaceHolder1$btnUpdateStudyType'], 'הסדר: לשונית, המתנה, בחירה בגריד המרוענן, עריכה');
    });
  } finally { if (prevSys === undefined) delete globalThis.Sys; else globalThis.Sys = prevSys; }
});

test('gotoStudyTypeFromInstitute: סוג שאינו בגריד → notFound עם הקוד בהודעה', async () => {
  const TAB = 'ContentPlaceHolder1_tabInstituteDetails';
  const gridEl = fakeGrid([[['קוד', 'תיאור', 'שעות', 'מצב']], [['300', 'ישיבה', '45', 'זכאי'], "selectedRowStudyType('0')"]]);
  const tabs = { [TAB]: { get_activeTabIndex: () => 1, set_activeTabIndex() {} } };
  await withPage({ url: INST_00, h1: 'עטרת שלמה סניף 00', tabs }, async () => {
    globalThis.document.querySelector = ((orig) => (sel) => (sel === 'table[id$="gvStudyType"]' ? gridEl : orig(sel)))(globalThis.document.querySelector);
    globalThis.window.selectedRowStudyType = () => {};
    const res = await gotoStudyTypeFromInstitute('900');
    assert.equal(res.ok, false);
    assert.equal(res.notFound, true);
    assert.match(res.reason, /900/);
  });
});

// ─── ממצא ב-8: שורות הפייג'ר של gvStudyType (טבלה מקוננת כמו ב-GridView) אינן שורות-נתונים ──
function fakeTable(trs) {
  const mk = (cells, onclick) => ({
    getAttribute: (n) => (n === 'onclick' ? onclick : null),
    querySelectorAll: () => cells.map((c) => ({ textContent: c })),
  });
  const list = trs.map(([cells, onclick]) => mk(cells, onclick || null));
  return { querySelectorAll: (sel) => (sel === 'tr' ? list : []) };
}

test('gridToRows (ממצא ב-8): דגל selectable לפי onclick עם selectedRowStudyType; תאי פייג\'ר "1","2" לא נספרים כקודים', () => {
  const table = fakeTable([
    [header],
    [dataRows[0], "selectedRowStudyType('0')"],
    [dataRows[1], "selectedRowStudyType('1')"],
    [['12', '1', '2']], // ה-tr החיצוני של הפייג'ר: התא שלו מכיל את הטבלה המקוננת
    [['1']], // tr מקונן של הפייג'ר
    [['2']],
  ]);
  const rows = gridToRows(table);
  assert.equal(rows.length, 6);
  assert.equal(rows[1].selectable, true);
  assert.equal(rows[3].selectable, false);
  assert.equal(rows[5].selectable, false);
  assert.deepEqual(gridStudyTypes(rows).map((s) => s.code), ['300', '600']);
  assert.equal(findStudyTypeRow(rows, '2'), -1, 'תא פייג\'ר "2" אינו קוד');
  assert.equal(findStudyTypeRow(rows, '600'), 1);
  assert.equal(findStudyTypeRowPosition(rows, '12'), -1);
  assert.equal(findStudyTypeRowPosition(rows, '600'), 2);
  assert.equal(gridPageSignature(rows), '2|300,600');
  // מערכים רגילים (בלי דגל) נשארים שורות-נתונים: תאימות לבדיקות ולקוד הקיים
  assert.equal(findStudyTypeRow([header, ...dataRows], '605'), 2);
});
