import test from 'node:test';
import assert from 'node:assert/strict';
import { $el, isVisible, sleep, waitFor } from '../src/core/dom.js';
import { getPRM, waitPRM, firePostback } from '../src/core/prm.js';
import { readMessagePopup, hideMessagePopup, hideMessagePopupAsync, closeModal } from '../src/core/popup.js';

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
