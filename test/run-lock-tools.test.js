// סקירה סופית 1.11.2026: נעילת-הריצה משותפת לכל ארבעת הכלים ומודעת-לכלי (גם שני כלים באותה לשונית נחסמים).
// עד עכשיו רק הקליטה נעלה; README הבטיח "ריצה אחת בכל פעם" לכל הלשוניות. בלי DOM: כל התעודות בדויות.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_LOCK_KEY, runLockState, runLockBusyMessage, holdRunLock, dropRunLock, readRunLock, currentTabId, acquireRunLock, releaseRunLock,
} from '../src/core/lock.js';
import { departSetHooks, departStartRun, departResumeIfPending, departDiscardSavedQueue, departHasSavedQueue } from '../src/tools/depart.js';
import { reportStart, reportSetHooks } from '../src/tools/report.js';
import { messagesScan, messagesSetHooks, MSG } from '../src/tools/messages.js';
import { absorbSetHooks, absorbStartRun } from '../src/tools/absorb-flow.js';
import { absorbResetRun } from '../src/tools/absorb-state.js';

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
  departSetHooks({}); reportSetHooks({}); messagesSetHooks({}); absorbSetHooks({});
  try { return await fn(); } finally {
    dropRunLock();
    departSetHooks({}); reportSetHooks({}); messagesSetHooks({}); absorbSetHooks({});
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

const otherTabLock = () => globalThis.localStorage.setItem(RUN_LOCK_KEY, JSON.stringify({ tab: 'other-tab', tool: 'absorb', at: Date.now() }));

// ─── הלוגיקה הטהורה: מודעות-לכלי ─────────────────────────────────────────────
test('runLockState: אותה לשונית אך כלי אחר → חיה ולא שלי; אותו כלי → שלי; נעילה ישנה בלי tool → שלי לכל כלי', () => {
  const now = 1_000_000;
  assert.deepEqual(runLockState({ tab: 'me', tool: 'absorb', at: now - 1000 }, 'me', now, 10000, 'depart'), { live: true, mine: false });
  assert.deepEqual(runLockState({ tab: 'me', tool: 'absorb', at: now - 1000 }, 'me', now, 10000, 'absorb'), { live: true, mine: true });
  assert.deepEqual(runLockState({ tab: 'me', at: now - 1000 }, 'me', now, 10000, 'depart'), { live: true, mine: true });
  assert.deepEqual(runLockState({ tab: 'other', tool: 'depart', at: now - 1000 }, 'me', now, 10000, 'depart'), { live: true, mine: false });
});

test('runLockBusyMessage: מבחין בין כלי אחר בחלונית הזו לבין לשונית אחרת של הדפדפן, ונוקב בשם הכלי', () => {
  assert.match(runLockBusyMessage({ tab: 'me', tool: 'depart', at: 1 }, 'me'), /"עזיבת תלמידים".*בחלונית הזו/);
  assert.match(runLockBusyMessage({ tab: 'other', tool: 'report', at: 1 }, 'me'), /"דיווח חודשי".*לשונית אחרת/);
  assert.match(runLockBusyMessage({ tab: 'other', at: 1 }, 'me'), /^ריצה פעילה בלשונית אחרת/);
  assert.ok(!/—/.test(runLockBusyMessage({ tab: 'x', tool: 'messages', at: 1 }, 'me')), 'בלי מקף ארוך');
});

test('acquire/release מודעים לכלי: כלי אחר באותה לשונית מסורב; שחרור רק של אותו כלי', async () => {
  await withStorages(() => {
    assert.equal(acquireRunLock('absorb'), true);
    assert.equal(readRunLock().tool, 'absorb');
    assert.equal(acquireRunLock('depart'), false, 'כלי אחר באותה לשונית נחסם');
    releaseRunLock('depart');
    assert.equal(readRunLock().tool, 'absorb', 'כלי אחר לא משחרר את הנעילה');
    releaseRunLock('absorb');
    assert.equal(readRunLock(), null);
  });
});

test('holdRunLock / dropRunLock: רכישה עם ריענון, סירוב עם הודעה, שחרור', async () => {
  await withStorages(() => {
    const held = holdRunLock('report');
    assert.equal(held.ok, true);
    assert.equal(readRunLock().tab, currentTabId());
    assert.equal(readRunLock().tool, 'report');
    const again = holdRunLock('report');
    assert.equal(again.ok, true, 'אותו כלי רוכש שוב (המשך אחרי טעינת דף)');
    const other = holdRunLock('messages');
    assert.equal(other.ok, false);
    assert.match(other.message, /"דיווח חודשי".*בחלונית הזו/);
    dropRunLock('messages');
    assert.equal(readRunLock().tool, 'report', 'drop של כלי אחר לא משחרר');
    dropRunLock('report');
    assert.equal(readRunLock(), null);
  });
});

// ─── כל כלי מכבד את הנעילה ─────────────────────────────────────────────────
test('עזיבה: נעילה חיה של לשונית אחרת → departStartRun מסורב (false), hook onLocked, בלי onStart ובלי תור', async () => {
  await withStorages(async () => {
    otherTabLock();
    let started = 0; let locked = null;
    departSetHooks({ onStart: () => { started++; }, onLocked: (m) => { locked = m; } });
    const r = await departStartRun([{ line: 1, branch: '00', identity: '012345678' }], {});
    assert.equal(r, false);
    assert.equal(started, 0);
    assert.match(String(locked), /לשונית אחרת/);
    assert.equal(departHasSavedQueue(), false);
    assert.equal(readRunLock().tab, 'other-tab', 'הנעילה של האחר לא נדרסה');
  });
});

test('עזיבה: departResumeIfPending תחת נעילה של אחר → false, התור נשאר שמור, onLocked', async () => {
  await withStorages(async () => {
    globalThis.sessionStorage.setItem('talmud.depart.queue', JSON.stringify({
      queue: [{ line: 1, branch: '00', identity: '012345678' }], results: [], curIdx: 0, startedAt: new Date().toISOString(), savedAt: new Date().toISOString(), settings: {},
    }));
    otherTabLock();
    let locked = null; let started = 0;
    departSetHooks({ onLocked: (m) => { locked = m; }, onStart: () => { started++; } });
    const r = await departResumeIfPending({ force: true });
    assert.equal(r, false);
    assert.equal(started, 0);
    assert.match(String(locked), /לשונית אחרת/);
    assert.equal(departHasSavedQueue(), true, 'התור נשאר לטעינה הבאה');
    departDiscardSavedQueue();
    assert.equal(departHasSavedQueue(), false);
    assert.equal(readRunLock().tab, 'other-tab', 'ביטול התור לא משחרר נעילה של אחר');
  });
});

test('דיווח: reportStart תחת נעילה של אחר → {ok:false, locked:true} עם ההודעה, לפני קריאת העץ', async () => {
  await withStorages(async () => {
    otherTabLock();
    const r = await reportStart();
    assert.equal(r.ok, false);
    assert.equal(r.locked, true);
    assert.match(r.reason, /"קליטת תלמידים".*לשונית אחרת/);
    assert.equal(readRunLock().tab, 'other-tab');
  });
});

test('דיווח: בלי נעילה של אחר, reportStart בלי עץ מחזיר "לא נמצאו סניפים" ומשחרר את הנעילה שלקח', async () => {
  await withStorages(async () => {
    const r = await reportStart();
    assert.equal(r.ok, false);
    assert.match(r.reason, /לא נמצאו סניפים/);
    assert.equal(readRunLock(), null, 'נעילה שנלקחה לרגע שוחררה');
  });
});

test('הודעות: messagesScan תחת נעילה של אחר → null, onLocked, בלי onStart, MSG.running נשאר false', async () => {
  await withStorages(async () => {
    otherTabLock();
    let locked = null; let started = 0;
    messagesSetHooks({ onLocked: (m) => { locked = m; }, onStart: () => { started++; } });
    const r = await messagesScan();
    assert.equal(r, null);
    assert.equal(started, 0);
    assert.equal(MSG.running, false);
    assert.match(String(locked), /לשונית אחרת/);
  });
});

test('קליטה: הנעילה נרשמת עם tool=absorb ומשוחררת בסיום', async () => {
  await withStorages(async () => {
    let seenTool = null;
    absorbSetHooks({ onStart: () => { seenTool = readRunLock() && readRunLock().tool; } });
    await absorbStartRun([]);
    assert.equal(seenTool, 'absorb');
    assert.equal(readRunLock(), null);
  });
});

test('שני כלים באותה לשונית: עזיבה שמחזיקה נעילה חוסמת קליטה עם הודעת "בחלונית הזו"', async () => {
  await withStorages(async () => {
    assert.equal(holdRunLock('depart').ok, true);
    let locked = null; let started = 0;
    absorbSetHooks({ onLocked: (m) => { locked = m; }, onStart: () => { started++; } });
    const r = await absorbStartRun([{ line: 1, branch: '00', studyType: '600', idType: 'tz', identity: '012345678' }]);
    assert.equal(r, false);
    assert.equal(started, 0);
    assert.match(String(locked), /"עזיבת תלמידים".*בחלונית הזו/);
    dropRunLock('depart');
  });
});
