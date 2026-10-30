import test from 'node:test';
import assert from 'node:assert/strict';
import { ABSORB_IDS, absorbActivateStudentsTab } from '../src/tools/absorb-dom.js';

// ממצא 9: הפעלת הלשונית "רשימת תלמידים" (set_activeTabIndex) עלולה להפעיל postback. כמו כל
// נגיעה בדף: רושמים waitPRM קודם, קוראים מ-setTimeout(0), וממתינים לסיום לפני החיפוש.

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

async function withTabs(fake, tabs, fn) {
  const prevSys = globalThis.Sys;
  const prevWindow = globalThis.window;
  globalThis.Sys = { WebForms: { PageRequestManager: { getInstance: () => fake.prm } } };
  globalThis.window = { $find: (id) => (id === ABSORB_IDS.tabContainer ? tabs : null) };
  try { return await fn(); } finally {
    if (prevSys === undefined) delete globalThis.Sys; else globalThis.Sys = prevSys;
    if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
  }
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('absorbActivateStudentsTab (ממצא 9): waitPRM נרשם לפני set_activeTabIndex, הקריאה נדחית ל-tick, וממתינים ל-endRequest', async () => {
  const fake = makeFakePrm();
  let setTo = null;
  let endRegisteredBefore = false;
  const tabs = {
    get_activeTabIndex: () => 0,
    set_activeTabIndex: (i) => { setTo = i; endRegisteredBefore = fake.handlers.end.length > 0; },
  };
  await withTabs(fake, tabs, async () => {
    const p = absorbActivateStudentsTab();
    assert.ok(p && typeof p.then === 'function', 'הפונקציה אסינכרונית (מחזירה Promise)');
    assert.equal(setTo, null, 'לא נקרא סינכרונית');
    assert.equal(fake.handlers.end.length, 1, 'endRequest רשום לפני הקריאה');
    await tick(5);
    assert.equal(setTo, 2);
    assert.equal(endRegisteredBefore, true);
    let settled = false;
    p.then(() => { settled = true; });
    await tick(5);
    assert.equal(settled, false, 'ממתינים ל-postback שה-postback-שלו התחיל');
    fake.handlers.begin[0]({}, {});
    fake.handlers.end[0]({}, { get_error: () => null, set_errorHandled: () => {} });
    const res = await p;
    assert.equal(res.ok, true);
    assert.equal(res.started, true);
    assert.equal(fake.handlers.end.length, 0, 'ה-handlers הוסרו');
  });
});

test('absorbActivateStudentsTab (ממצא 9): כבר בלשונית 2 → מסתיים בלי postback', async () => {
  const fake = makeFakePrm();
  let calls = 0;
  const tabs = { get_activeTabIndex: () => 2, set_activeTabIndex: () => { calls++; } };
  await withTabs(fake, tabs, async () => {
    const res = await absorbActivateStudentsTab();
    assert.equal(res.ok, true);
    assert.equal(res.started, false);
    assert.equal(calls, 0);
    assert.equal(fake.handlers.end.length, 0);
  });
});

test('absorbActivateStudentsTab: בלי $find בכלל → לא זורק', async () => {
  const prevWindow = globalThis.window;
  delete globalThis.window;
  try {
    const res = await absorbActivateStudentsTab();
    assert.equal(res.ok, true);
    assert.equal(res.started, false);
  } finally { if (prevWindow !== undefined) globalThis.window = prevWindow; }
});
