import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPage, classifyUrl, findStudyTypeRow, findStudyTypeRowPosition, gridToRows, gridPageSignature, gridStudyTypes,
  gotoStudyTypeFromInstitute, gotoInstitute, gotoStudyType, findBranchHref, branchesFromTreeHrefs, parsePostbackHref,
  saveNavState, loadNavState, clearNavState,
  parseBranchFromH1, parseStudyTypeFromH1, parseBranchFromBreadcrumb, parseSelectedRowIndex, normalizeBranch,
  parseInstituteId, parseInstituteStudyTypeId, mergeBranchIds, institutePageUrl, studyTypePageUrl, loadBranchIds,
  branchForInstituteId, learnBranchId, loadStudyTypeIds, learnStudyTypeId, studyTypeKey, NAV_BRANCH_IDS_SEED,
} from '../src/core/navigate.js';

const INST_00 = 'https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx?InstituteID=491';
const INST_16 = 'https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx?InstituteID=4159';
const ST_16_600 = 'https://talmud.edu.gov.il/StudyType/StudyTypeDetails.aspx?InstituteStudyTypeID=10269&InstituteID=4159';

test('smoke: כל היצוא הוא פונקציות (import ב-Node לא זרק)', () => {
  for (const fn of [getPage, classifyUrl, findStudyTypeRow, gridToRows, gotoStudyTypeFromInstitute, gotoInstitute, gotoStudyType,
    findBranchHref, parsePostbackHref, saveNavState, loadNavState, clearNavState, learnBranchId, learnStudyTypeId]) {
    assert.equal(typeof fn, 'function');
  }
});

// ─── classifyUrl ─────────────────────────────────────────────────────────────
test('classifyUrl: מוסד / סוג-לימוד / תלמיד-חדש / אחר / לא-מחרוזת', () => {
  assert.equal(classifyUrl(INST_00), 'institute');
  assert.equal(classifyUrl(ST_16_600), 'studyType');
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

test('parseBranchFromH1: "<מוסד> סניף NN" → מרופד; אין → null', () => {
  assert.equal(parseBranchFromH1('עטרת שלמה סניף 07'), '07');
  assert.equal(parseBranchFromH1('עטרת שלמה סניף 0'), '00');
  assert.equal(parseBranchFromH1('עטרת שלמה סניף 26'), '26');
  assert.equal(parseBranchFromH1('פרטי מוסד'), null);
  assert.equal(parseBranchFromH1(null), null);
});

test('parseStudyTypeFromH1: "סוג לימוד 600 - ..." → "600"', () => {
  assert.equal(parseStudyTypeFromH1('סוג לימוד 600 - כולל אברכים יום שלם'), '600');
  assert.equal(parseStudyTypeFromH1('פרטי סוג לימוד'), null);
});

test('parseBranchFromBreadcrumb: "... > עטרת שלמה > 16 > (600)כולל..." → "16" רק כשהקוד תואם', () => {
  const crumbs = 'בית > איתור עמותות ומוסדות > פרטי עמותה > איתור מוסד > עטרת שלמה > 16 > (600)כולל אברכים יום שלם';
  assert.equal(parseBranchFromBreadcrumb(crumbs, '600'), '16');
  assert.equal(parseBranchFromBreadcrumb(crumbs, '300'), null);
  assert.equal(parseBranchFromBreadcrumb('בית > פרטי מוסד', '600'), null);
  assert.equal(parseBranchFromBreadcrumb(crumbs.replace(/\s*>\s*/g, '\n>\n'), '600'), '16', 'רווחים/שורות בין הפירורים');
  assert.equal(parseBranchFromBreadcrumb('עטרת שלמה > 5 > (600)כולל', '600'), '05');
});

test('normalizeBranch: ריפוד; לא-תקין → null', () => {
  assert.equal(normalizeBranch('7'), '07');
  assert.equal(normalizeBranch(0), '00');
  assert.equal(normalizeBranch('123'), null);
  assert.equal(normalizeBranch(''), null);
});

test('institutePageUrl / studyTypePageUrl: כתובות; id לא-מספרי → null', () => {
  assert.equal(institutePageUrl('491'), INST_00);
  assert.equal(institutePageUrl(undefined), null);
  assert.equal(studyTypePageUrl('10269', '4159'), ST_16_600);
  assert.equal(studyTypePageUrl('10269', undefined), null);
});

test('mergeBranchIds / branchForInstituteId / studyTypeKey', () => {
  const base = { '00': '491' };
  const out = mergeBranchIds(base, '7', '4200');
  assert.deepEqual(out, { '00': '491', '07': '4200' });
  assert.deepEqual(base, { '00': '491' });
  assert.deepEqual(mergeBranchIds(base, 'x', '1'), base);
  assert.equal(branchForInstituteId(out, '4200'), '07');
  assert.equal(branchForInstituteId(out, '9'), null);
  assert.equal(studyTypeKey('7', '600'), '07|600');
  assert.equal(studyTypeKey('7', 'x'), null);
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
  "javascript:__doPostBack('ctl00$ucTalmudSideBar$tvTalmud','sעטרת שלמה\\26')",
];
test('findBranchHref / branchesFromTreeHrefs / parsePostbackHref', () => {
  assert.equal(findBranchHref(hrefs, '00'), 0);
  assert.equal(findBranchHref(hrefs, '7'), 2);
  assert.equal(findBranchHref(hrefs, '26'), 3);
  assert.equal(findBranchHref(hrefs, '99'), -1);
  assert.deepEqual(branchesFromTreeHrefs(hrefs), ['00', '07', '26']);
  assert.deepEqual(parsePostbackHref(hrefs[2]), { target: 'ctl00$ucTalmudSideBar$tvTalmud', arg: 'sעטרת שלמה\\07' });
  assert.equal(parsePostbackHref('javascript:void(0)'), null);
});

// ─── סביבה מדומה: sessionStorage / localStorage / location / document ────────
function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

async function withPage({ url, h1, crumbs, nav, local, tree, hid }, fn) {
  const prev = { document: globalThis.document, location: globalThis.location, sessionStorage: globalThis.sessionStorage, localStorage: globalThis.localStorage, window: globalThis.window };
  globalThis.sessionStorage = fakeStorage(nav ? { 'talmud.nav': JSON.stringify(nav) } : {});
  globalThis.localStorage = fakeStorage(local || {});
  globalThis.location = { href: url, protocol: 'https:', host: 'talmud.edu.gov.il', origin: 'https://talmud.edu.gov.il' };
  const treeAnchors = (tree || []).map((h) => ({ getAttribute: (n) => (n === 'href' ? h : null) }));
  globalThis.document = {
    querySelector: (sel) => {
      if (sel === 'h1') return h1 == null ? null : { textContent: h1 };
      if (/BreadCrumb|breadcrumb|SiteMapPath/.test(sel)) return crumbs == null ? null : { innerText: crumbs, textContent: crumbs };
      if (sel === '[id$="tvTalmud"]') return tree ? { querySelectorAll: () => treeAnchors } : null;
      return null;
    },
    getElementById: (id) => (hid && id in hid ? { value: hid[id] } : null),
    body: { innerText: crumbs || '' },
  };
  globalThis.window = { __doPostBack: () => {} };
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

test('getPage: דף מוסד → סניף מה-h1, InstituteID מהכתובת, המפה לומדת (לא-מחייב), lastInstituteUrl נשמר', async () => {
  await withPage({ url: INST_16, h1: 'עטרת שלמה סניף 16' }, () => {
    const p = getPage();
    assert.equal(p.kind, 'institute');
    assert.equal(p.branch, '16');
    assert.equal(p.branchSource, 'h1');
    assert.equal(p.instituteId, '4159');
    assert.equal(loadNavState().lastInstituteUrl, INST_16);
    assert.equal(loadBranchIds()['16'], '4159');
  });
});

test('getPage: דף מוסד שמציג סניף 16 בכתובת של 00 (רינדור-במקום) → לא לומדים 16→491', async () => {
  await withPage({ url: INST_00, h1: 'עטרת שלמה סניף 16' }, () => {
    const p = getPage();
    assert.equal(p.branch, '16');
    assert.equal(loadBranchIds()['16'], '4159', 'ה-seed נשאר');
    assert.equal(loadBranchIds()['00'], '491');
  });
});

test('getPage: דף מוסד בלי h1 קריא → branch null (לא ממציאים סניף מזיכרון)', async () => {
  await withPage({ url: INST_00, h1: 'פרטי מוסד', nav: { lastInstituteBranch: '26' } }, () => {
    const p = getPage();
    assert.equal(p.branch, null);
    assert.equal(p.branchSource, null);
  });
});

test('getPage: דף סוג-לימוד → סניף מפירורי-הלחם (מחייב), סוג מה-h1, המזהים מהכתובת, שתי המפות לומדות', async () => {
  const crumbs = 'בית > איתור מוסד > עטרת שלמה > 07 > (600)כולל אברכים';
  const url = 'https://talmud.edu.gov.il/StudyType/StudyTypeDetails.aspx?InstituteStudyTypeID=10301&InstituteID=4200';
  await withPage({ url, h1: 'סוג לימוד 600 - כולל אברכים', crumbs, nav: { intent: { branch: '07', studyType: '600' } } }, () => {
    const p = getPage();
    assert.equal(p.kind, 'studyType');
    assert.equal(p.branch, '07');
    assert.equal(p.branchSource, 'breadcrumb');
    assert.equal(p.studyType, '600');
    assert.equal(p.instituteId, '4200');
    assert.equal(p.instituteStudyTypeId, '10301');
    assert.equal(loadBranchIds()['07'], '4200');
    assert.equal(loadStudyTypeIds()['07|600'], '10301');
    assert.equal(loadNavState().intent, null, 'הכוונה נצרכה');
    assert.equal(loadNavState().lastStudyTypeUrl, url);
  });
});

test('getPage: דף סוג-לימוד בלי פירורי-לחם → סניף מהמפה ההפוכה (InstituteID→סניף)', async () => {
  await withPage({ url: ST_16_600, h1: 'סוג לימוד 600 - כולל', crumbs: 'בית > פרטי מוסד' }, () => {
    const p = getPage();
    assert.equal(p.branch, '16');
    assert.equal(p.branchSource, 'map');
    assert.equal(loadStudyTypeIds()['16|600'], '10269');
  });
});

test('getPage: דף סוג-לימוד בלי פירורים ובלי מפה → כוונת-הניווט, רק כשהסוג ב-h1 תואם', async () => {
  const url = 'https://talmud.edu.gov.il/StudyType/StudyTypeDetails.aspx?InstituteStudyTypeID=555&InstituteID=7777';
  await withPage({ url, h1: 'סוג לימוד 300 - ישיבה', crumbs: '', nav: { intent: { branch: '09', studyType: '300' } } }, () => {
    const p = getPage();
    assert.equal(p.branch, '09');
    assert.equal(p.branchSource, 'intent');
    assert.equal(loadBranchIds()['09'], '7777', 'נלמד מהכוונה (הכתובת מהשרת)');
  });
  await withPage({ url, h1: 'סוג לימוד 300 - ישיבה', crumbs: '', nav: { intent: { branch: '09', studyType: '600' } } }, () => {
    const p = getPage();
    assert.equal(p.branch, null, 'כוונה לסוג אחר אינה ראיה');
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

test('learnBranchId: מדף מוסד לא דורס id שממופה לסניף אחר; מדף סוג-לימוד (מחייב) דורס', async () => {
  await withPage({ url: INST_00 }, () => {
    assert.equal(learnBranchId('16', '491', { authoritative: false }), false, '491 שייך ל-00');
    assert.equal(loadBranchIds()['16'], '4159');
    assert.equal(learnBranchId('16', '9999', { authoritative: true }), true);
    assert.equal(loadBranchIds()['16'], '9999');
    assert.equal(learnBranchId('16', '9999', { authoritative: true }), false, 'אין שינוי — לא נכתב');
  });
});

test('loadBranchIds: בלי localStorage → seed; JSON פגום → seed; נלמד ממוזג מעל', async () => {
  await withPage({ url: INST_00, local: { 'talmud.nav.branchIds': '{bad' } }, () => {
    assert.deepEqual(loadBranchIds(), NAV_BRANCH_IDS_SEED);
  });
  await withPage({ url: INST_00, local: { 'talmud.nav.branchIds': JSON.stringify({ '07': '4200' }) } }, () => {
    assert.deepEqual(loadBranchIds(), { '00': '491', '16': '4159', '07': '4200' });
  });
});

test('saveNavState/loadNavState/clearNavState: round-trip; JSON פגום → {}; בלי sessionStorage → {}', async () => {
  await withPage({ url: INST_00 }, () => {
    saveNavState({ intent: { branch: '07', studyType: '600' } });
    assert.deepEqual(loadNavState(), { intent: { branch: '07', studyType: '600' } });
    clearNavState();
    assert.deepEqual(loadNavState(), {});
  });
  await withPage({ url: INST_00, nav: null }, () => {
    globalThis.sessionStorage.setItem('talmud.nav', '{bad');
    assert.deepEqual(loadNavState(), {});
  });
  const prev = globalThis.sessionStorage;
  delete globalThis.sessionStorage;
  try { assert.deepEqual(loadNavState(), {}); } finally { if (prev !== undefined) globalThis.sessionStorage = prev; }
});

// ─── ניווט ──────────────────────────────────────────────────────────────────
test('gotoStudyType: שתי המפות יודעות → קפיצה ישירה לפי כתובת, וכוונה נרשמת', async () => {
  await withPage({ url: INST_00, local: { 'talmud.nav.studyTypeIds': JSON.stringify({ '16|600': '10269' }) } }, async () => {
    const res = await gotoStudyType('16', '600');
    assert.equal(res.ok, true);
    assert.equal(res.method, 'url');
    assert.equal(globalThis.location.href, ST_16_600);
    assert.deepEqual(loadNavState().intent, { branch: '16', studyType: '600' });
  });
});

test('gotoStudyType: הסוג לא ידוע אך הסניף ידוע ואנחנו בדף אחר → לדף המוסד של הסניף לפי כתובת', async () => {
  await withPage({ url: 'https://talmud.edu.gov.il/Students/StudentsDetails.aspx?', h1: null }, async () => {
    const res = await gotoStudyType('16', '600');
    assert.equal(res.ok, true);
    assert.equal(res.method, 'url');
    assert.equal(globalThis.location.href, INST_16);
  });
});

test('gotoInstitute: סניף לא במפה מדף שאינו מוסד → קפיצה לדף-המוסד האחרון הידוע (או seed 00)', async () => {
  await withPage({ url: ST_16_600, h1: 'סוג לימוד 600', nav: { lastInstituteUrl: INST_16 } }, async () => {
    const res = await gotoInstitute('07');
    assert.equal(res.ok, true);
    assert.equal(res.hop, true);
    assert.equal(globalThis.location.href, INST_16);
  });
  await withPage({ url: ST_16_600, h1: 'סוג לימוד 600' }, async () => {
    const res = await gotoInstitute('07');
    assert.equal(res.hop, true);
    assert.equal(globalThis.location.href, INST_00);
  });
});

test('gotoInstitute: סניף לא במפה בדף מוסד → עץ-הצד (postback); סניף שאינו בעץ → notFound', async () => {
  await withPage({ url: INST_00, h1: 'עטרת שלמה סניף 00', tree: hrefs }, async () => {
    let fired = null;
    globalThis.window.__doPostBack = (t, a) => { fired = { t, a }; };
    const p = gotoInstitute('07');
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(fired, { t: 'ctl00$ucTalmudSideBar$tvTalmud', a: 'sעטרת שלמה\\07' });
    const res = await p;
    assert.equal(res.method, 'tree');
    assert.equal(globalThis.location.href, INST_00, 'לא נורה ניווט לפי כתובת');
    const missing = await gotoInstitute('99');
    assert.equal(missing.ok, false);
    assert.equal(missing.notFound, true);
  });
});

test('gotoInstitute: סניף לא-תקין → {ok:false}', async () => {
  await withPage({ url: INST_00 }, async () => {
    assert.equal((await gotoInstitute('abc')).ok, false);
  });
});
