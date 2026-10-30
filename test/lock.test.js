import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_LOCK_KEY, RUN_LOCK_TTL_MS, runLockState, currentTabId, readRunLock, acquireRunLock, refreshRunLock, releaseRunLock,
} from '../src/core/lock.js';

// ממצא 5: שתי לשוניות של תלמו"ד שמריצות במקביל חולקות הקשר צד-שרת (דף תלמיד-חדש נפתח בלי
// פרמטרים). נעילת-ריצה ב-localStorage (משותף ללשוניות) עם רענון תקופתי ותפוגה קצרה.

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

function withStorages(fn) {
  const prev = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  globalThis.localStorage = fakeStorage();
  globalThis.sessionStorage = fakeStorage();
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

// ─── הלוגיקה הטהורה ─────────────────────────────────────────────────────────
test('runLockState: אין נעילה / נעילה פגומה → לא חיה', () => {
  assert.deepEqual(runLockState(null, 'me', 1000), { live: false, mine: false });
  assert.deepEqual(runLockState(undefined, 'me', 1000), { live: false, mine: false });
  assert.deepEqual(runLockState({ tab: 'x' }, 'me', 1000), { live: false, mine: false });
  assert.deepEqual(runLockState({ at: 'לא-מספר', tab: 'x' }, 'me', 1000), { live: false, mine: false });
});

test('runLockState: נעילה טרייה של לשונית אחרת → חיה ולא שלי; שלי → חיה ושלי', () => {
  const now = 1_000_000;
  assert.deepEqual(runLockState({ tab: 'other', at: now - 3000 }, 'me', now, 10000), { live: true, mine: false });
  assert.deepEqual(runLockState({ tab: 'me', at: now - 3000 }, 'me', now, 10000), { live: true, mine: true });
});

test('runLockState: נעילה שפג תוקפה (מעל TTL) → לא חיה, גם אם של לשונית אחרת', () => {
  const now = 1_000_000;
  assert.deepEqual(runLockState({ tab: 'other', at: now - 10001 }, 'me', now, 10000), { live: false, mine: false });
  assert.deepEqual(runLockState({ tab: 'other', at: now - 10000 }, 'me', now, 10000), { live: true, mine: false }, 'בדיוק על הגבול עדיין חיה');
  assert.equal(RUN_LOCK_TTL_MS, 10000);
});

// ─── האחסון ─────────────────────────────────────────────────────────────────
test('currentTabId: מזהה אקראי שנשמר ב-sessionStorage (יציב בתוך הלשונית)', () => {
  withStorages(() => {
    const a = currentTabId();
    assert.ok(a && a.length >= 8);
    assert.equal(currentTabId(), a);
  });
});

test('acquire/refresh/release: רוכשים כשאין נעילה חיה; מסרבים כשיש של לשונית אחרת; משחררים רק את שלנו', () => {
  withStorages(() => {
    const me = currentTabId();
    assert.equal(acquireRunLock(), true);
    assert.equal(readRunLock().tab, me);
    assert.equal(acquireRunLock(), true, 'רכישה חוזרת של שלנו מותרת');
    const at0 = readRunLock().at;
    assert.equal(refreshRunLock(), true);
    assert.ok(readRunLock().at >= at0);
    // לשונית אחרת מחזיקה נעילה חיה
    globalThis.localStorage.setItem(RUN_LOCK_KEY, JSON.stringify({ tab: 'other-tab', at: Date.now() }));
    assert.equal(acquireRunLock(), false);
    assert.equal(refreshRunLock(), false, 'לא מרעננים נעילה של אחר');
    releaseRunLock();
    assert.equal(readRunLock().tab, 'other-tab', 'לא משחררים נעילה של אחר');
    // נעילה ישנה של אחר: ניתנת לרכישה
    globalThis.localStorage.setItem(RUN_LOCK_KEY, JSON.stringify({ tab: 'other-tab', at: Date.now() - 60000 }));
    assert.equal(acquireRunLock(), true);
    releaseRunLock();
    assert.equal(readRunLock(), null);
  });
});

test('בלי localStorage (Node): acquire מצליח ואינו זורק', () => {
  const prev = globalThis.localStorage;
  delete globalThis.localStorage;
  try {
    assert.equal(acquireRunLock(), true);
    assert.equal(readRunLock(), null);
    releaseRunLock();
  } finally { if (prev !== undefined) globalThis.localStorage = prev; }
});
