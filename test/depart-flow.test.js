// סקירה סופית 1.11.2026: זרימת העזיבה בלי DOM: דורות (ניסיון שפג זמנו מת בנקודת-הבדיקה הבאה), "עצור" בזמן
// טעינת-דף לא מעלים תוצאות, ודף זר לא נתפס אוטומטית (כמו ממצאים 6 ו-11 בקליטה). כל התעודות בדויות.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPART_STATUS, DEPART_ACTIONS, departSetHooks, departResumeIfPending, departHasSavedQueue, departForeignPage,
  departRunAttempt, departCheckStop, departNextGeneration, departCurrentGeneration, departIsCancelled, departIsCancelError,
  makeDepartResult,
} from '../src/tools/depart.js';
import { readRunLock } from '../src/core/lock.js';

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
  departSetHooks({});
  try { return await fn(); } finally {
    departSetHooks({});
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUEUE = [{ line: 1, branch: '00', identity: '012345678' }, { line: 2, branch: '00', identity: '023456789' }, { line: 3, branch: '16', identity: '034567890' }];
function savedState(extra) {
  return Object.assign({
    queue: QUEUE, results: [makeDepartResult(QUEUE[0], DEPART_STATUS.OK, '', '')], curIdx: 1,
    startedAt: new Date().toISOString(), savedAt: new Date().toISOString(), settings: { leaveDate: '', leaveReason: '1' },
  }, extra || {});
}

// ─── דורות ──────────────────────────────────────────────────────────────────
test('departCheckStop: דור ישן זורק שגיאת-ביטול; הדור הנוכחי עובר', () => {
  const gen = departNextGeneration();
  assert.doesNotThrow(() => departCheckStop('x', gen));
  departNextGeneration();
  assert.equal(departIsCancelled(gen), true);
  assert.throws(() => departCheckStop('late', gen), (e) => departIsCancelError(e));
  assert.doesNotThrow(() => departCheckStop('x', departCurrentGeneration()));
  assert.doesNotThrow(() => departCheckStop('queue-level'), 'בלי דור (רמת התור) בודקים רק את דגל העצירה');
});

test('departRunAttempt: timeout → "שגיאה: תהליך תקוע", הדור מתקדם, והניסיון הישן לא נוגע בדף אחרי שחזר', async () => {
  await withStorages(async () => {
    let touched = false;
    const task = QUEUE[0];
    const res = await departRunAttempt(task, async (t, gen) => {
      await sleep(80);
      departCheckStop('before-save', gen); // נקודת-הבדיקה הבאה אחרי שה-timeout חלף
      touched = true;
      return makeDepartResult(t, DEPART_STATUS.OK, '', '');
    }, 20);
    assert.match(res.status, /^שגיאה: תהליך תקוע/);
    assert.equal(res.action, DEPART_ACTIONS.error);
    await sleep(150);
    assert.equal(touched, false, 'הניסיון שפג זמנו נעצר בנקודת-הבדיקה ולא המשיך לצעד ההרסני');
  });
});

test('departRunAttempt: ניסיון שמסתיים בזמן מחזיר את התוצאה שלו כמות שהיא', async () => {
  await withStorages(async () => {
    const res = await departRunAttempt(QUEUE[1], async (t, gen) => { departCheckStop('start', gen); return makeDepartResult(t, DEPART_STATUS.OK, 'ok', ''); }, 500);
    assert.equal(res.status, DEPART_STATUS.OK);
    assert.equal(res.detail, 'ok');
  });
});

// ─── "עצור" בזמן טעינת-דף (כמו ממצא 6 בקליטה) ───────────────────────────────
test('departResumeIfPending עם דגל-עצירה: השארית "נעצר", onDone עם כל התוצאות (לא נמחקות בשקט), המצב נוקה', async () => {
  await withStorages(async () => {
    globalThis.sessionStorage.setItem('talmud.depart.queue', JSON.stringify(savedState()));
    globalThis.sessionStorage.setItem('talmud.depart.stop', '1');
    let done = null; let started = 0;
    departSetHooks({ onDone: (all) => { done = all; }, onStart: () => { started++; } });
    const r = await departResumeIfPending();
    assert.equal(r, false);
    assert.equal(started, 0, 'לא רצים אחרי "עצור"');
    assert.ok(done, 'onDone נקרא: התוצאות מוצגות');
    assert.deepEqual(done.map((x) => x.status), [DEPART_STATUS.OK, DEPART_STATUS.STOPPED, DEPART_STATUS.STOPPED]);
    assert.equal(done[1].action, DEPART_ACTIONS.stopped);
    assert.equal(departHasSavedQueue(), false, 'התור נוקה');
    assert.equal(globalThis.sessionStorage.getItem('talmud.depart.stop'), null, 'דגל העצירה נוקה');
    assert.equal(readRunLock(), null);
  });
});

// ─── דף זר (כמו ממצא 11 בקליטה) ─────────────────────────────────────────────
test('departForeignPage: דף אחר / תלמיד-חדש = זר; דף מוסד / סוג-לימוד = לא', () => {
  assert.equal(departForeignPage({ kind: 'other' }), true);
  assert.equal(departForeignPage({ kind: 'newStudent' }), true);
  assert.equal(departForeignPage(null), true);
  assert.equal(departForeignPage({ kind: 'institute' }), false);
  assert.equal(departForeignPage({ kind: 'studyType' }), false);
});

test('departResumeIfPending בדף זר (ב-Node אין דף): לא רצים, hook onStaleQueue עם reason=foreign-page, התור נשאר', async () => {
  await withStorages(async () => {
    globalThis.sessionStorage.setItem('talmud.depart.queue', JSON.stringify(savedState()));
    let stale = null; let started = 0;
    departSetHooks({ onStaleQueue: (info) => { stale = info; }, onStart: () => { started++; } });
    const r = await departResumeIfPending();
    assert.equal(r, false);
    assert.equal(started, 0, 'לא משתלטים על דף זר');
    assert.ok(stale);
    assert.equal(stale.reason, 'foreign-page');
    assert.equal(stale.stale, false);
    assert.equal(stale.curIdx, 1);
    assert.equal(stale.total, 3);
    assert.equal(departHasSavedQueue(), true, 'התור נשאר ל"המשך"');
  });
});

test('departResumeIfPending: תור ישן (מעל 30 דקות) → onStaleQueue עם reason=stale, לפני בדיקת הדף', async () => {
  await withStorages(async () => {
    const old = new Date(Date.now() - 40 * 60000).toISOString();
    globalThis.sessionStorage.setItem('talmud.depart.queue', JSON.stringify(savedState({ startedAt: old, savedAt: old })));
    let stale = null;
    departSetHooks({ onStaleQueue: (info) => { stale = info; } });
    assert.equal(await departResumeIfPending(), false);
    assert.equal(stale && stale.reason, 'stale');
    assert.equal(stale && stale.stale, true);
  });
});
