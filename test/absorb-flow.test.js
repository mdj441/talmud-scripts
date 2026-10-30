import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { S, saveAbsorbState, loadAbsorbState, absorbResetRun } from '../src/tools/absorb-state.js';
import { absorbSetHooks, absorbStartRun, absorbStop, absorbDiscardSavedQueue, absorbResumeIfPending, absorbIsBusy } from '../src/tools/absorb-flow.js';
import { ABSORB_STATUS } from '../src/tools/absorb-report.js';
import { RUN_LOCK_KEY, readRunLock } from '../src/core/lock.js';

// הזרימה בלי DOM: מצב (sessionStorage), נעילת-ריצה, ניווט דרך העץ, וטקסטי "מה לעשות".
// כל התעודות בדויות.

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

async function withStorages(fn) {
  const prev = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  globalThis.localStorage = fakeStorage();
  globalThis.sessionStorage = fakeStorage();
  absorbResetRun();
  absorbSetHooks({});
  try { return await fn(); } finally {
    absorbSetHooks({});
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

const TASK = { line: 2, branch: '00', studyType: '600', idType: 'tz', identity: '034567890' };

// ─── ממצא 4: pendingSave חי במצב השמור עד רישום התוצאה של אותה שורה ─────────
test('saveAbsorbState (ממצא 4): pendingSave נשמר מ-S בכל שמירה, לא רק כשמעבירים extra', async () => {
  await withStorages(() => {
    S.queue = [TASK];
    S.pendingSave = { idx: 0, identity: '034567890' };
    saveAbsorbState();
    assert.deepEqual(loadAbsorbState().pendingSave, { idx: 0, identity: '034567890' });
    absorbResetRun();
    assert.equal(S.pendingSave, null);
    saveAbsorbState();
    assert.equal(loadAbsorbState().pendingSave, null);
  });
});

test('absorbStartRun → finishRun (ממצא 5): הנעילה משוחררת בסיום', async () => {
  await withStorages(async () => {
    let done = 0;
    absorbSetHooks({ onDone: () => { done++; } });
    await absorbStartRun([]);
    assert.equal(done, 1);
    assert.equal(readRunLock(), null, 'הנעילה שוחררה ב-finishRun');
  });
});

// ─── ממצא 5: נעילת-ריצה בין לשוניות ─────────────────────────────────────────
test('absorbStartRun (ממצא 5): נעילה חיה של לשונית אחרת → סירוב, hook onLocked, בלי ריצה', async () => {
  await withStorages(async () => {
    globalThis.localStorage.setItem(RUN_LOCK_KEY, JSON.stringify({ tab: 'other-tab', at: Date.now() }));
    let started = 0; let locked = null;
    absorbSetHooks({ onStart: () => { started++; }, onLocked: (reason) => { locked = reason; } });
    const r = await absorbStartRun([TASK]);
    assert.equal(r, false);
    assert.equal(started, 0, 'לא התחילה ריצה');
    assert.match(String(locked), /לשונית אחרת/);
    assert.equal(readRunLock().tab, 'other-tab', 'הנעילה של האחר לא נדרסה');
    assert.equal(loadAbsorbState(), null, 'לא נשמר תור');
  });
});

test('absorbStartRun (ממצא 5): נעילה ישנה (פגה) של לשונית אחרת אינה חוסמת', async () => {
  await withStorages(async () => {
    globalThis.localStorage.setItem(RUN_LOCK_KEY, JSON.stringify({ tab: 'other-tab', at: Date.now() - 60000 }));
    let started = 0;
    absorbSetHooks({ onStart: () => { started++; } });
    await absorbStartRun([]);
    assert.equal(started, 1);
  });
});

test('absorbResumeIfPending (ממצא 5): נעילה חיה של אחר → סירוב והתור נשאר שמור', async () => {
  const prevLocation = globalThis.location;
  globalThis.location = { href: 'https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx?InstituteID=491', protocol: 'https:', host: 'talmud.edu.gov.il', origin: 'https://talmud.edu.gov.il' };
  try {
    await withStorages(async () => {
      globalThis.sessionStorage.setItem('talmud.absorb.queue', JSON.stringify({ queue: [TASK], results: [], curIdx: 0, startedAt: new Date().toISOString() }));
      globalThis.localStorage.setItem(RUN_LOCK_KEY, JSON.stringify({ tab: 'other-tab', at: Date.now() }));
      let resumed = 0; let locked = null;
      absorbSetHooks({ onResume: () => { resumed++; }, onLocked: (reason) => { locked = reason; } });
      const r = await absorbResumeIfPending();
      assert.equal(r, false);
      assert.equal(resumed, 0);
      assert.match(String(locked), /לשונית אחרת/);
      assert.equal(loadAbsorbState().queue.length, 1, 'התור לא נמחק');
    });
  } finally { if (prevLocation === undefined) delete globalThis.location; else globalThis.location = prevLocation; }
});

test('absorbResumeIfPending (ממצא 11): דף שאינו חלק מהקליטה → לא ממשיכים, hook onStaleQueue עם reason foreign-page', async () => {
  const prevLocation = globalThis.location;
  globalThis.location = { href: 'https://talmud.edu.gov.il/Association/Default.aspx', protocol: 'https:', host: 'talmud.edu.gov.il', origin: 'https://talmud.edu.gov.il' };
  try {
    await withStorages(async () => {
      globalThis.sessionStorage.setItem('talmud.absorb.queue', JSON.stringify({ queue: [TASK, TASK], results: [], curIdx: 0, startedAt: new Date().toISOString() }));
      let resumed = 0; let stale = null;
      absorbSetHooks({ onResume: () => { resumed++; }, onStaleQueue: (info) => { stale = info; } });
      const r = await absorbResumeIfPending();
      assert.equal(r, false);
      assert.equal(resumed, 0);
      assert.equal(stale && stale.reason, 'foreign-page');
      assert.equal(stale.total, 2);
      assert.equal(loadAbsorbState().queue.length, 2, 'התור לא נמחק');
    });
  } finally { if (prevLocation === undefined) delete globalThis.location; else globalThis.location = prevLocation; }
});

// ─── ממצא 12: טקסטי "מה לעשות" אופרטיביים ────────────────────────────────────
test('טקסטי "מה לעשות" (ממצא 12): בלי הוראות חלשות, עם "איך" ועם קישור לדף התמיכה', () => {
  const src = readFileSync(new URL('../src/tools/absorb-flow.js', import.meta.url), 'utf8');
  assert.ok(!/['"`]קלוט ידנית['"`]/.test(src), '"קלוט ידנית" לבד אינה הוראה');
  assert.ok(!/בדוק ידנית מה קרה/.test(src), '"בדוק ידנית מה קרה" אינה הוראה');
  assert.ok(!/העתק את היומן \(מזהים ממוסכים\) ושלח/.test(src), 'לאן לשלוח?');
  assert.ok(!/וצרף את היומן['"`]/.test(src), 'לאן לצרף?');
  assert.ok(src.includes('https://github.com/mdj441/talmud-scripts/issues'), 'קישור לדף התמיכה');
  assert.ok(src.includes('לחץ "העתק יומן"'), 'מפנה לכפתור בשמו');
  const verifyLines = src.split('\n').filter((l) => l.includes('ודא ברשימת התלמידים'));
  assert.ok(verifyLines.length >= 1);
  for (const line of verifyLines) assert.ok(line.includes('קלוט אותו ידנית'), `חסר "ואם אינו שם, קלוט אותו ידנית": ${line.trim()}`);
  assert.ok(src.includes('לחץ "קליטה" בדף סוג-הלימוד'), 'הוראת קליטה ידנית מפורטת');
});

// ─── ביקורת שנייה: דפי-דמה מינימליים (בלי DOM אמיתי) כדי להריץ את הזרימה עד רישום התוצאה ──────
const SITE = 'https://talmud.edu.gov.il';
const INST_00_URL = `${SITE}/Institutes/InstitutesDetails.aspx?InstituteID=491`;
const ST_00_600_URL = `${SITE}/StudyType/StudyTypeDetails.aspx`; // F3: דרך הגריד, בלי query
const ST_16_600_DIRECT = `${SITE}/StudyType/StudyTypeDetails.aspx?InstituteStudyTypeID=10269&InstituteID=4159`;
const TREE_HREFS = ["javascript:__doPostBack('ctl00$ucTalmudSideBar$tvTalmud','sעטרת שלמה\\00')", "javascript:__doPostBack('ctl00$ucTalmudSideBar$tvTalmud','sעטרת שלמה\\16')"];
const ABSORB_BASE = 'ContentPlaceHolder1_tabStudyTypeDetails_StudentList_ucStudentsSearchDetails';
const fakeLocation = (href) => ({ href, protocol: 'https:', host: 'talmud.edu.gov.il', origin: SITE });

function fakePrm() {
  const h = { begin: [], end: [] };
  const prm = {
    _isInAsyncPostBack: false,
    add_beginRequest: (f) => h.begin.push(f),
    add_endRequest: (f) => h.end.push(f),
    remove_beginRequest: (f) => { h.begin = h.begin.filter((x) => x !== f); },
    remove_endRequest: (f) => { h.end = h.end.filter((x) => x !== f); },
  };
  // סבב postback מדומה: beginRequest ואז endRequest בלי שגיאה
  const roundTrip = () => {
    setTimeout(() => { for (const f of h.begin.slice()) f(prm, {}); }, 5);
    setTimeout(() => { for (const f of h.end.slice()) f(prm, { get_error: () => null, set_errorHandled: () => {} }); }, 40);
  };
  return { prm, roundTrip };
}

function swapGlobals(next) {
  const prev = {};
  for (const k of Object.keys(next)) { prev[k] = globalThis[k]; globalThis[k] = next[k]; }
  return () => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } };
}

// דף סוג-לימוד עם h1 "סוג לימוד 600", התווית lblInstituteBranchNumber (F3: מקור הסניף היחיד), פירורי-לחם
// מטעים, חיפוש שמריץ postback מדומה, תווית-ספירה וגריד. התווית והגריד נוצרים מחדש בכל קריאה (כמו אחרי
// postback שהחליף את האלמנטים: עדות-טריות). כפתור "קליטה" במזהה המלא של האתר (F5), נמצא לפי סיומת.
// ‏calls סופר לחיצות; ‏calls.tree = ארגומנט הלחיצה בעץ (אם יש עץ בדף).
async function withStudyTypePage({ gridRows, countText, url = ST_00_600_URL, label = '00', crumbs = 'בית > איתור מוסד > פרטי מוסד > פרטי סוג לימוד', tree = null }, fn) {
  const { prm, roundTrip } = fakePrm();
  const calls = { search: 0, absorb: 0, tree: null };
  const crumbEl = { innerText: crumbs, textContent: crumbs };
  const el = (over) => Object.assign({ value: '', getAttribute: () => null, setAttribute() {}, dispatchEvent() {}, click() {} }, over);
  const grid = () => el({ querySelectorAll: () => gridRows.map((cells) => ({ querySelectorAll: () => cells.map((c) => ({ textContent: c })) })) });
  const absorbBtn = el({ click: () => { calls.absorb++; roundTrip(); } });
  const treeAnchors = (tree || []).map((h) => ({ getAttribute: (n) => (n === 'href' ? h : null) }));
  const byId = {
    [`${ABSORB_BASE}_txtStudenPassport`]: el(),
    [`${ABSORB_BASE}_btnSearch`]: el({ click: () => { calls.search++; roundTrip(); } }),
    [`${ABSORB_BASE}_btnStudentAcceptence3`]: absorbBtn,
  };
  const restore = swapGlobals({
    location: fakeLocation(url),
    window: { addEventListener() {}, __doPostBack(t, a) { if (/tvTalmud/.test(t)) calls.tree = a; roundTrip(); }, Page_Validators: [] },
    Sys: { WebForms: { PageRequestManager: { getInstance: () => prm } } },
    document: {
      querySelector: (sel) => {
        if (sel === 'h1') return { textContent: 'סוג לימוד 600 - כולל אברכים' };
        if (sel === '[id$="lblInstituteBranchNumber"]') return label == null ? null : { textContent: label };
        if (sel === '[id$="btnStudentAcceptence3"]') return absorbBtn;
        if (sel === '[id$="tvTalmud"]') return tree ? { querySelectorAll: () => treeAnchors } : null;
        if (/BreadCrumb|breadcrumb|SiteMapPath/.test(sel)) return crumbEl;
        return null;
      },
      querySelectorAll: (sel) => (/BreadCrumb|breadcrumb|SiteMapPath/.test(sel) ? [crumbEl] : []),
      getElementById: (id) => (id === `${ABSORB_BASE}_lblCountSearch` ? el({ textContent: countText })
        : id === `${ABSORB_BASE}_gvIStudents` ? grid() : (byId[id] || null)),
      body: { innerText: crumbs },
    },
  });
  try { return await fn(calls); } finally { restore(); }
}

// ממשיך תור שמור של תלמיד אחד בדף-הדמה ומחזיר את התוצאה שנרשמה.
async function resumeOne(task, extraState, pageOpts) {
  return withStorages(() => withStudyTypePage(pageOpts, async (calls) => {
    globalThis.sessionStorage.setItem('talmud.absorb.queue', JSON.stringify(Object.assign({ queue: [task], results: [], curIdx: 0, startedAt: new Date().toISOString() }, extraState)));
    let results = null;
    absorbSetHooks({ onDone: (r) => { results = r; } });
    await absorbResumeIfPending();
    return { results, calls };
  }));
}

const GRID_WITH = [['', '1', 'תעודת זהות', '012345678', 'ראובן', 'כהן', '01/01/1990']];
const TASK_00 = { line: 2, branch: '00', studyType: '600', idType: 'tz', identity: '012345678' };

// ─── ממצא ב-7: "התחל" בין beforeunload לפריקה: ניווט שהוכרז נחשב "עסוק" גם אחרי שכלב-השומר נוקה ──
// (הבדיקה הזו ראשונה: watchUnload נרשם פעם אחת לכל המודול, על ה-window הראשון שהוא רואה.)
test('absorbIsBusy (ממצא ב-7): אחרי ניווט מלא ו-beforeunload (כלב-השומר נוקה) עדיין עסוק; absorbStop משחרר', async () => {
  const listeners = {};
  const restore = swapGlobals({
    location: fakeLocation(`${SITE}/Students/StudentsDetails.aspx?`),
    window: { addEventListener: (type, fn) => { listeners[type] = fn; }, __doPostBack() {} },
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { innerText: '' } },
  });
  try {
    await withStorages(async () => {
      await absorbStartRun([TASK_00]); // דף בלי עץ → כתובת דף המוסדות → ניווט מלא → NAVIGATED
      assert.match(globalThis.location.href, /Institutes\/InstitutesDetails\.aspx$/, 'נורה ניווט מלא לדף המוסדות (בלי query)');
      assert.equal(absorbIsBusy(), true, 'ממתינים לטעינה: עסוק');
      assert.equal(typeof listeners.beforeunload, 'function', 'מאזין beforeunload נרשם');
      listeners.beforeunload(); // הדף מתחיל להיפרק: כלב-השומר נוקה
      assert.equal(absorbIsBusy(), true, 'בין beforeunload לפריקה "התחל" חייב להישאר חסום');
      absorbStop();
      assert.equal(absorbIsBusy(), false, 'עצירה משחררת את הדגל');
    });
  } finally { restore(); }
});

// ─── ממצא ב-9: "אישור" שטען מחדש את אותו דף: "נמצא ברשימה" עם pendingConfirm תואם → "נקלט", לא "כבר קיים" ──
test('saveAbsorbState (ממצא ב-9): pendingConfirm נשמר עם המצב ומתאפס ב-absorbResetRun', async () => {
  await withStorages(() => {
    S.queue = [TASK_00];
    S.pendingConfirm = { idx: 0, identity: '012345678' };
    saveAbsorbState();
    assert.deepEqual(loadAbsorbState().pendingConfirm, { idx: 0, identity: '012345678' });
    absorbResetRun();
    assert.equal(S.pendingConfirm, null);
  });
});

test('זרימה (ממצא ב-9): המשך אחרי טעינה עם pendingConfirm תואם והתלמיד ברשימה → "נקלט"; בלי pendingConfirm → "כבר קיים"', async () => {
  const page = { gridRows: GRID_WITH, countText: 'נמצאו 1 רשומות בהתאם לקריטריון החיפוש' };
  const confirmed = await resumeOne(TASK_00, { pendingConfirm: { idx: 0, identity: '012345678' } }, page);
  assert.ok(confirmed.results && confirmed.results.length === 1, 'נרשמה תוצאה');
  assert.equal(confirmed.results[0].status, ABSORB_STATUS.OK, `אחרי "אישור" שטען את הדף: ${confirmed.results[0].status}`);
  assert.equal(confirmed.calls.absorb, 0, 'לא לוחצים "קליטה" שוב');
  assert.equal(loadAbsorbState(), null, 'התור נוקה בסיום');
  const plain = await resumeOne(TASK_00, {}, page);
  assert.equal(plain.results[0].status, ABSORB_STATUS.EXISTS);
});

// ─── ממצא ב-3: ספירה 1+ אך לא נקראו מזהים → "לאמת ידנית", לא לחיצה על "קליטה" ─────────────
test('זרימה (ממצא ב-3): החיפוש המקדים מדווח תוצאה אך עמודת המזהה אינה קריאה → "לאמת ידנית" עם פירוט, בלי "קליטה"', async () => {
  const shifted = [['', '1', 'תעודת זהות', 'ראובן', '012345678', 'כהן']]; // המזהה לא בעמודה 3
  const r = await resumeOne(TASK_00, {}, { gridRows: shifted, countText: 'נמצאו 1 רשומות בהתאם לקריטריון החיפוש' });
  assert.ok(r.results && r.results.length === 1, 'נרשמה תוצאה');
  assert.equal(r.results[0].status, ABSORB_STATUS.VERIFY, `סטטוס: ${r.results[0].status} (${r.results[0].detail})`);
  assert.match(r.results[0].detail, /הרשימה הציגה 1 תוצאות אך לא ניתן לקרוא בה מזהים/);
  assert.equal(r.calls.absorb, 0, 'אסור ללחוץ "קליטה" על תלמיד שאולי כבר ברשימה');
});

// ─── מלכודת F1/F3: דף סוג-לימוד 600 שהגיע אליו ב-GET ישיר עם InstituteID של 16, והתווית אומרת 00 ─────
// (פירורי-הלחם מראים "16" מהכתובת; ה-h1 מלא כי במקרה הזה השרת כן רינדר אותו). שורה בתור לסניף 16/600:
// אסור לקלוט במקום. הזרימה לוחצת בעץ על 16 (טעינת דף) ולא נוגעת ב"קליטה".
test('זרימה (F1/F3): תווית 00 ופירורי-לחם 16 בדף סוג-לימוד 600, שורה ל-16/600 → לחיצה בעץ על 16, בלי "קליטה"', async () => {
  const task16 = { line: 2, branch: '16', studyType: '600', idType: 'tz', identity: '034567890' };
  const page = { gridRows: [], countText: '', url: ST_16_600_DIRECT, label: '00', crumbs: 'בית > איתור מוסד > עטרת שלמה > 16 > (600)כולל', tree: TREE_HREFS };
  await withStorages(() => withStudyTypePage(page, async (calls) => {
    globalThis.sessionStorage.setItem('talmud.absorb.queue', JSON.stringify({ queue: [task16], results: [], curIdx: 0, startedAt: new Date().toISOString() }));
    let done = 0;
    absorbSetHooks({ onDone: () => { done++; } });
    await absorbResumeIfPending();
    assert.equal(calls.absorb, 0, 'אסור ללחוץ "קליטה" בדף של סניף אחר');
    assert.equal(calls.search, 0, 'גם לא מחפשים: הדף אינו הדף הנכון');
    assert.equal(calls.tree, 'sעטרת שלמה\\16', 'נלחץ בעץ על סניף 16');
    assert.equal(done, 0, 'הריצה ממתינה לטעינת הדף');
    assert.equal(absorbIsBusy(), true);
    assert.match(globalThis.location.href, /InstituteStudyTypeID=10269/, 'הכתובת לא שונתה (העץ מנווט, לא כתובת)');
    const st = loadAbsorbState();
    assert.equal(st.curIdx, 0, 'התור נשמר לפני הניווט, השורה עדיין פתוחה');
    absorbStop();
  }));
});

test('זרימה (F3): דף סוג-לימוד 600 שהתווית שלו 00 ושורה ל-00/600 → המסלול המהיר: חיפוש במקום, בלי עץ', async () => {
  const page = { gridRows: GRID_WITH, countText: 'נמצאו 1 רשומות בהתאם לקריטריון החיפוש', tree: TREE_HREFS, crumbs: 'עטרת שלמה > 16 > (600)כולל (מטעה)' };
  const r = await resumeOne(TASK_00, {}, page);
  assert.ok(r.results && r.results.length === 1, 'נרשמה תוצאה');
  assert.equal(r.results[0].status, ABSORB_STATUS.EXISTS);
  assert.equal(r.calls.tree, null, 'לא לוחצים בעץ כשהתווית מאשרת את הסניף');
  assert.ok(r.calls.search >= 1);
});
