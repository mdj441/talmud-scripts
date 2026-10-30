import test from 'node:test';
import assert from 'node:assert/strict';
import { $el, isVisible, sleep, waitFor } from '../src/core/dom.js';
import { getPRM, waitPRM, firePostback } from '../src/core/prm.js';
import { readMessagePopup, hideMessagePopup, hideMessagePopupAsync, closeModal, classifyPopupText } from '../src/core/popup.js';

// ─── Smoke: import in Node succeeds, no top-level document/window/Sys access ────
test('smoke: כל היצוא הוא פונקציות (import ב-Node לא זרק)', () => {
  for (const fn of [$el, isVisible, sleep, waitFor, getPRM, waitPRM, firePostback,
    readMessagePopup, hideMessagePopup, hideMessagePopupAsync, closeModal]) {
    assert.equal(typeof fn, 'function');
  }
});

// ─── dom.js ──────────────────────────────────────────────────────────────────
test('sleep מתממש (resolve) אחרי הזמן', async () => {
  const t0 = Date.now();
  await sleep(10);
  assert.ok(Date.now() - t0 >= 0);
});

test('waitFor מתממש כש-predicate נהיה אמת', async () => {
  let flag = false;
  setTimeout(() => { flag = true; }, 15);
  const result = await waitFor(() => flag, { timeout: 500, interval: 5 });
  assert.equal(result, true);
});

test('waitFor נדחה (reject) אחרי timeout עם Error', async () => {
  await assert.rejects(
    () => waitFor(() => false, { timeout: 20, interval: 5 }),
    /timeout/i
  );
});

test('isVisible(null) => false', () => {
  assert.equal(isVisible(null), false);
});

// ─── prm.js ──────────────────────────────────────────────────────────────────
test('getPRM() => null כש-Sys לא קיים', () => {
  assert.equal(getPRM(), null);
});

test('firePostback: לא קורא ל-__doPostBack באופן סינכרוני, קורא לו אחרי tick עם הפרמטרים הנכונים, ורושם endRequest handler לפני הקריאה', async () => {
  const calls = [];
  const handlers = { begin: [], end: [] };
  const fakePrm = {
    add_beginRequest: (h) => handlers.begin.push(h),
    add_endRequest: (h) => handlers.end.push(h),
    remove_beginRequest: (h) => { handlers.begin = handlers.begin.filter(x => x !== h); },
    remove_endRequest: (h) => { handlers.end = handlers.end.filter(x => x !== h); },
  };
  const prevSys = globalThis.Sys;
  const prevPostBack = globalThis.__doPostBack;
  const prevWindow = globalThis.window;
  globalThis.Sys = { WebForms: { PageRequestManager: { getInstance: () => fakePrm } } };

  let postbackCalledAt = null;
  let endRequestRegisteredBeforePostback = false;
  globalThis.__doPostBack = (target, arg) => {
    postbackCalledAt = { target, arg };
    endRequestRegisteredBeforePostback = handlers.end.length > 0;
  };
  globalThis.window = globalThis; // prm.js קורא ל-window.__doPostBack

  try {
    const p = firePostback('ctl00$targetX', 'argY', { startTimeoutMs: 20, totalTimeoutMs: 50 });
    // Not called synchronously:
    assert.equal(postbackCalledAt, null);
    assert.equal(handlers.end.length, 1, 'endRequest handler רשום לפני setTimeout(0)');

    // Settle the promise ourselves via the fake endRequest so the test doesn't need the real timers.
    await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(postbackCalledAt, { target: 'ctl00$targetX', arg: 'argY' });
    assert.equal(endRequestRegisteredBeforePostback, true);

    handlers.begin[0]({}, {});
    handlers.end[0]({}, { get_error: () => null, set_errorHandled: () => {} });
    const result = await p;
    assert.equal(result.ok, true);
    // started = האם באמת נצפה beginRequest (C1: "postback שנבלע" חייב להיות מובחן מניווט מלא)
    assert.equal(result.started, true);
  } finally {
    if (prevSys === undefined) delete globalThis.Sys; else globalThis.Sys = prevSys;
    if (prevPostBack === undefined) delete globalThis.__doPostBack; else globalThis.__doPostBack = prevPostBack;
    if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
  }
});

test('waitPRM: כששום בקשה לא מתחילה עד ל-startTimeout → {ok:true, started:false} (postback שנבלע)', async () => {
  const handlers = { begin: [], end: [] };
  const fakePrm = {
    add_beginRequest: (h) => handlers.begin.push(h),
    add_endRequest: (h) => handlers.end.push(h),
    remove_beginRequest: (h) => { handlers.begin = handlers.begin.filter(x => x !== h); },
    remove_endRequest: (h) => { handlers.end = handlers.end.filter(x => x !== h); },
  };
  const prevSys = globalThis.Sys;
  globalThis.Sys = { WebForms: { PageRequestManager: { getInstance: () => fakePrm } } };
  try {
    const result = await waitPRM({ startTimeoutMs: 20, totalTimeoutMs: 500 });
    assert.equal(result.ok, true);
    assert.equal(result.started, false, 'לא נצפה beginRequest — הקורא חייב לדעת שלא קרה כלום');
  } finally {
    if (prevSys === undefined) delete globalThis.Sys; else globalThis.Sys = prevSys;
  }
});

test('waitPRM: בלי PRM בכלל → {ok:true, started:false}', async () => {
  const result = await waitPRM({ startTimeoutMs: 20, totalTimeoutMs: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.started, false);
});

// ─── popup.js: btnMCancel הוא postback (M-f) ────────────────────────────────
test('hideMessagePopupAsync: נפילה ל-btnMCancel רושמת waitPRM לפני הלחיצה, והלחיצה נדחית ל-setTimeout(0)', async () => {
  const handlers = { begin: [], end: [] };
  const fakePrm = {
    add_beginRequest: (h) => handlers.begin.push(h),
    add_endRequest: (h) => handlers.end.push(h),
    remove_beginRequest: (h) => { handlers.begin = handlers.begin.filter(x => x !== h); },
    remove_endRequest: (h) => { handlers.end = handlers.end.filter(x => x !== h); },
  };
  let clickedAt = null;
  let endRequestRegisteredBeforeClick = false;
  const btn = {
    getClientRects: () => [{}],
    click: () => { clickedAt = Date.now(); endRequestRegisteredBeforeClick = handlers.end.length > 0; },
  };
  const prevSys = globalThis.Sys;
  const prevDoc = globalThis.document;
  const prevWindow = globalThis.window;
  globalThis.Sys = { WebForms: { PageRequestManager: { getInstance: () => fakePrm } } };
  globalThis.document = { getElementById: (id) => (id === 'ucMessagePopUp_btnMCancel' ? btn : null) };
  globalThis.window = { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) };

  try {
    const res = hideMessagePopupAsync();
    assert.equal(res.hidden, true);
    assert.ok(res.wait && typeof res.wait.then === 'function', 'חייבת לחזור המתנת PRM');
    assert.equal(clickedAt, null, 'הלחיצה לא סינכרונית — נדחית ל-setTimeout(0)');
    assert.equal(handlers.end.length, 1, 'endRequest נרשם לפני הלחיצה');

    await new Promise((r) => setTimeout(r, 5));
    assert.ok(clickedAt, 'הלחיצה קרתה אחרי ה-tick');
    assert.equal(endRequestRegisteredBeforeClick, true);

    handlers.begin[0]({}, {});
    handlers.end[0]({}, { get_error: () => null, set_errorHandled: () => {} });
    const settled = await res.wait;
    assert.equal(settled.ok, true);
    assert.equal(settled.started, true);
  } finally {
    if (prevSys === undefined) delete globalThis.Sys; else globalThis.Sys = prevSys;
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
    if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
  }
});

test('hideMessagePopupAsync: אין כפתור סגירה → {hidden:false, wait:null} (בלי לזרוק)', () => {
  const prevDoc = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    assert.deepEqual(hideMessagePopupAsync(), { hidden: false, wait: null });
    assert.equal(hideMessagePopup(), false);
  } finally {
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
  }
});

// ─── B8: ענפי השגיאה/ה-timeout של waitPRM (הם שמזינים את שערי-העדות ב-absorb) ──
function makeFakePrm() {
  const handlers = { begin: [], end: [] };
  return {
    handlers,
    prm: {
      add_beginRequest: (h) => handlers.begin.push(h),
      add_endRequest: (h) => handlers.end.push(h),
      remove_beginRequest: (h) => { handlers.begin = handlers.begin.filter((x) => x !== h); },
      remove_endRequest: (h) => { handlers.end = handlers.end.filter((x) => x !== h); },
    },
  };
}

function withFakePrm(fake, fn) {
  const prevSys = globalThis.Sys;
  globalThis.Sys = { WebForms: { PageRequestManager: { getInstance: () => fake.prm } } };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevSys === undefined) delete globalThis.Sys; else globalThis.Sys = prevSys;
    });
}

test('waitPRM: endRequest עם שגיאה → {ok:false, started:true}, set_errorHandled(true), וה-handlers מוסרים', async () => {
  const fake = makeFakePrm();
  await withFakePrm(fake, async () => {
    const p = waitPRM({ startTimeoutMs: 500, totalTimeoutMs: 2000 });
    assert.equal(fake.handlers.end.length, 1);
    let handled = null;
    fake.handlers.begin[0]({}, {});
    fake.handlers.end[0]({}, {
      get_error: () => new Error('שגיאת שרת'),
      set_errorHandled: (v) => { handled = v; },
    });
    const res = await p;
    assert.equal(res.ok, false, 'שגיאת postback אינה הצלחה');
    assert.equal(res.started, true, 'הבקשה כן התחילה — זה לא "לחיצה שנבלעה"');
    assert.match(res.reason, /PRM/);
    assert.equal(handled, true, 'set_errorHandled(true) — אחרת MS AJAX מקפיץ alert למשתמש');
    assert.equal(fake.handlers.begin.length, 0, 'beginRequest handler הוסר');
    assert.equal(fake.handlers.end.length, 0, 'endRequest handler הוסר');
  });
});

test('waitPRM: התחילה בקשה ולא נסגרה עד totalTimeout → {ok:false, started:true}, וה-handlers מוסרים', async () => {
  const fake = makeFakePrm();
  await withFakePrm(fake, async () => {
    const p = waitPRM({ startTimeoutMs: 20, totalTimeoutMs: 60 });
    fake.handlers.begin[0]({}, {}); // התחילה — startTimeout כבר לא רלוונטי
    const res = await p;
    assert.equal(res.ok, false);
    assert.equal(res.started, true);
    assert.match(res.reason, /timeout/i);
    assert.equal(res.timeout, true, 'ממצא ב-2: הקורא מבחין בין timeout לכשל אחר');
    assert.equal(fake.handlers.begin.length, 0, 'beginRequest handler הוסר');
    assert.equal(fake.handlers.end.length, 0, 'endRequest handler הוסר');
  });
});

test('waitPRM: endRequest בלי שגיאה אחרי begin → {ok:true, started:true} וה-handlers מוסרים', async () => {
  const fake = makeFakePrm();
  await withFakePrm(fake, async () => {
    const p = waitPRM({ startTimeoutMs: 500, totalTimeoutMs: 2000 });
    fake.handlers.begin[0]({}, {});
    fake.handlers.end[0]({}, { get_error: () => null, set_errorHandled: () => {} });
    const res = await p;
    assert.deepEqual(res, { started: true, ok: true });
    assert.equal(fake.handlers.begin.length, 0);
    assert.equal(fake.handlers.end.length, 0);
  });
});

// ─── ממצא 8: ירי בקשה כשאחרת בטיסה. MS AJAX מריץ abortPostBack שמרים endRequest (בלי שגיאה)
// של הבקשה הקודמת *לפני* ה-beginRequest של החדשה. ה-handler כבר רשום, ובלי ההגנה הוא היה
// מסיים מיד עם {ok:true, started:false} על בקשה שאינה שלנו.
test('waitPRM (ממצא 8): endRequest של בקשה שהייתה בטיסה ברגע הרישום לא מסיים את ההמתנה', async () => {
  const fake = makeFakePrm();
  fake.prm._isInAsyncPostBack = true;
  await withFakePrm(fake, async () => {
    let settled = null;
    const p = waitPRM({ startTimeoutMs: 300, totalTimeoutMs: 2000 }).then((r) => { settled = r; return r; });
    fake.handlers.end[0]({}, { get_error: () => null, set_errorHandled: () => {} }); // סיום הבקשה הקודמת
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(settled, null, 'endRequest של הבקשה הקודמת אינו שלנו');
    assert.equal(fake.handlers.end.length, 1, 'ה-handler עדיין רשום');
    fake.prm._isInAsyncPostBack = false;
    fake.handlers.begin[0]({}, {});
    fake.handlers.end[0]({}, { get_error: () => null, set_errorHandled: () => {} });
    const res = await p;
    assert.deepEqual(res, { started: true, ok: true });
  });
});

test('waitPRM (ממצא 8): הבקשה הקודמת הסתיימה ושלנו לא התחילה עד startTimeout → {ok:true, started:false}', async () => {
  const fake = makeFakePrm();
  fake.prm._isInAsyncPostBack = true;
  await withFakePrm(fake, async () => {
    const p = waitPRM({ startTimeoutMs: 30, totalTimeoutMs: 2000 });
    fake.prm._isInAsyncPostBack = false;
    fake.handlers.end[0]({}, { get_error: () => null, set_errorHandled: () => {} });
    const res = await p;
    assert.deepEqual(res, { started: false, ok: true });
    assert.equal(fake.handlers.end.length, 0, 'ה-handlers הוסרו');
  });
});

// ─── W3: הודעת-הצלחה היא אינפורמטיבית, לא בקשת-אישור (בדיקה רטובה 10.9.2026, F4) ──
// האתר הציג אחרי אישור-קליטה מוצלח את ucMessagePopUp עם "הצלחה קליטת תלמיד הצליחה" ועם
// כפתור "המשך" גלוי; hasContinue=true סיווג אותה "נחסם" ודילג על אימות-הגריד.
test('classifyPopupText: מתחיל ב"הצלחה" / "קליטת תלמיד הצליחה" → success, גם כשיש כפתור "המשך"', () => {
  assert.equal(classifyPopupText('הצלחה קליטת תלמיד הצליחה', { hasContinue: true, hasOkOnly: false }), 'success');
  assert.equal(classifyPopupText('קליטת תלמיד הצליחה', { hasContinue: false, hasOkOnly: true }), 'success');
  assert.equal(classifyPopupText('  הצלחה  ', {}), 'success');
});
// ‏1b (סקירת-בטיחות): "הצליח" לבדו רחב מדי — רק שני הניסוחים שנצפו/צפויים הם הצלחה. ניסוח
// אחר לא מוסתר כהצלחה; נופל לסיווג לפי הכפתורים (fail-safe: "המשך" לא-מוכר → נחסם, לא נלחץ).
test('classifyPopupText (1b): "הצליח" בטקסט אחר אינו הצלחה — נופל לסיווג לפי הכפתורים', () => {
  assert.equal(classifyPopupText('העדכון הצליח. להמשיך?', { hasContinue: true }), 'confirm', 'בקשת-אישור לא-מוכרת לעולם לא מוסתרת');
  assert.equal(classifyPopupText('קליטת התלמיד הצליחה', { hasContinue: false, hasOkOnly: true }), 'info', 'ניסוח שונה מזה שנצפה באתר — לא מנחשים');
  assert.equal(classifyPopupText('הודעת הצלחה', {}), 'unknown');
});
test('classifyPopupText: "לא הצליח" / "נכשל" אינו הצלחה — נופל לסיווג לפי הכפתורים', () => {
  assert.equal(classifyPopupText('קליטת התלמיד לא הצליחה', { hasContinue: false, hasOkOnly: true }), 'info');
  assert.equal(classifyPopupText('הפעולה לא הצליחה — להמשיך?', { hasContinue: true }), 'confirm');
  assert.equal(classifyPopupText('הצלחה חלקית: השמירה נכשלה', { hasContinue: false, hasOkOnly: true }), 'info');
});
test('classifyPopupText: כפתור "המשך" בטקסט אחר → confirm (לעולם לא נלחץ אוטומטית)', () => {
  assert.equal(classifyPopupText('התלמיד לומד במוסד אחר. להמשיך?', { hasContinue: true, hasOkOnly: false }), 'confirm');
});
test('classifyPopupText: רק "אישור" → info; בלי כפתורים / בלי טקסט → unknown', () => {
  assert.equal(classifyPopupText('שגיאה: תאריך לא תקין', { hasContinue: false, hasOkOnly: true }), 'info');
  assert.equal(classifyPopupText('', {}), 'unknown');
  assert.equal(classifyPopupText(null, null), 'unknown');
  assert.equal(classifyPopupText('טקסט', undefined), 'unknown');
});

function withFakePopupDom(els, fn) {
  const prevDoc = globalThis.document;
  const prevWindow = globalThis.window;
  globalThis.document = { getElementById: (id) => els[id] || null };
  globalThis.window = { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) };
  try {
    return fn();
  } finally {
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
    if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
  }
}
const popupShown = () => [{}];
const popupHidden = () => [];

test('readMessagePopup: מחזיר kind ו-buttons (תוויות הכפתורים הגלויים, בלי מזהים) — F4', () => {
  const els = {
    ucMessagePopUp_pnlMessagePopup: { getClientRects: popupShown, innerText: 'הודעה הצלחה קליטת תלמיד הצליחה המשך' },
    ucMessagePopUp_btnMOK: { getClientRects: popupShown, value: 'המשך' },
    ucMessagePopUp_btnMCancel: { getClientRects: popupHidden, value: 'אישור' },
    ucMessagePopUp_btnMNo: { getClientRects: popupHidden, value: 'לא' },
  };
  withFakePopupDom(els, () => {
    const pop = readMessagePopup();
    assert.equal(pop.kind, 'success');
    assert.equal(pop.hasContinue, true, 'הדגל הגולמי נשמר — הקורא מחליט לפי kind');
    assert.equal(pop.text, 'הצלחה קליטת תלמיד הצליחה');
    assert.deepEqual(pop.buttons, ['המשך']);
  });
});

test('readMessagePopup: "המשך"+"לא" עם טקסט שאינו הצלחה → confirm, שני הכפתורים ברשימה, הטקסט נקי מתוויות', () => {
  const els = {
    ucMessagePopUp_pnlMessagePopup: { getClientRects: popupShown, innerText: 'הודעה התלמיד לומד במוסד אחר. להמשיך? המשך לא' },
    ucMessagePopUp_btnMOK: { getClientRects: popupShown, textContent: ' המשך ' },
    ucMessagePopUp_btnMCancel: { getClientRects: popupHidden },
    ucMessagePopUp_btnMNo: { getClientRects: popupShown, value: 'לא' },
  };
  withFakePopupDom(els, () => {
    const pop = readMessagePopup();
    assert.equal(pop.kind, 'confirm');
    assert.equal(pop.text, 'התלמיד לומד במוסד אחר. להמשיך?');
    assert.deepEqual(pop.buttons, ['המשך', 'לא']);
  });
});

test('readMessagePopup: רק "אישור" → info; חלונית לא גלויה → null', () => {
  const els = {
    ucMessagePopUp_pnlMessagePopup: { getClientRects: popupShown, innerText: 'שגיאה: תאריך לא תקין אישור' },
    ucMessagePopUp_btnMOK: { getClientRects: popupHidden },
    ucMessagePopUp_btnMCancel: { getClientRects: popupShown, value: 'אישור' },
    ucMessagePopUp_btnMNo: { getClientRects: popupHidden },
  };
  withFakePopupDom(els, () => {
    const pop = readMessagePopup();
    assert.equal(pop.kind, 'info');
    assert.equal(pop.hasOkOnly, true);
    assert.deepEqual(pop.buttons, ['אישור']);
  });
  withFakePopupDom({ ucMessagePopUp_pnlMessagePopup: { getClientRects: popupHidden } }, () => {
    assert.equal(readMessagePopup(), null);
  });
});
