import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { S, saveAbsorbState, loadAbsorbState, absorbResetRun } from '../src/tools/absorb-state.js';
import { absorbSetHooks, absorbStartRun, absorbStop, absorbDiscardSavedQueue, absorbResumeIfPending } from '../src/tools/absorb-flow.js';
import { saveNavState, loadNavState } from '../src/core/navigate.js';
import { RUN_LOCK_KEY, readRunLock } from '../src/core/lock.js';

// הזרימה בלי DOM: מצב (sessionStorage), כוונת-ניווט, נעילת-ריצה, וטקסטי "מה לעשות".
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
const INTENT = { branch: '16', studyType: '600', at: Date.now() };

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

// ─── ממצא 7: כוונת-הניווט נמחקת בכל סיום/עצירה/התחלה/ניקוי ───────────────────
test('absorbDiscardSavedQueue (ממצא 7): מוחק את הכוונה ומשאיר את שאר מצב-הניווט', async () => {
  await withStorages(() => {
    saveNavState({ intent: INTENT, lastInstituteUrl: 'https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx?InstituteID=491' });
    absorbDiscardSavedQueue();
    assert.equal(loadNavState().intent, null);
    assert.ok(loadNavState().lastInstituteUrl);
  });
});

test('absorbStop (ממצא 7): גם בלי ריצה פעילה הכוונה נמחקת', async () => {
  await withStorages(() => {
    saveNavState({ intent: INTENT });
    absorbStop();
    assert.equal(loadNavState().intent, null);
  });
});

test('absorbStartRun → finishRun (ממצא 7 + 5): הכוונה נמחקת והנעילה משוחררת בסיום', async () => {
  await withStorages(async () => {
    saveNavState({ intent: INTENT });
    let done = 0;
    absorbSetHooks({ onDone: () => { done++; } });
    await absorbStartRun([]);
    assert.equal(done, 1);
    assert.equal(loadNavState().intent, null);
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
