// קליטה — הזרימה: לכל תלמיד (1) להגיע לדף סוג-הלימוד הנכון, (2) חיפוש מקדים, (3) "קליטה" +
// חלונית הודעה, (4) מילוי המודאל, (5) אישור, (6) דף תלמיד-חדש אם צריך, (7) אימות מול הגריד.
// ניווט מלא טוען דף חדש; המצב נשמר ב-sessionStorage וההמשך (resume) קורה אחרי הטעינה.
// אין גישה ל-document/window ברמת המודול.

import { $el, isVisible, sleep, waitFor } from '../core/dom.js';
import { log, maskId } from '../core/log.js';
import { padId9 } from '../core/identity.js';
import { getPage, gotoStudyType, gotoInstitute, normalizeBranch, clearNavIntent } from '../core/navigate.js';
import { acquireRunLock, refreshRunLock, releaseRunLock, RUN_LOCK_REFRESH_MS, RUN_LOCK_BUSY_MESSAGE } from '../core/lock.js';
import {
  ABSORB_STATUS, ABSORB_MAX_QUEUE_AGE_MS, makeAbsorbResult, analyzeGrid, absorbPrecheckDecision,
  absorbShouldRecord, absorbQueueIsStale, buildRemainingReport, manualStudyTypeAction, absorbNormalizeId,
  absorbBranchSourceTrusted,
} from './absorb-report.js';
import {
  S, ABSORB_MAX_LANDINGS, absorbIsStopped, requestAbsorbStop, clearAbsorbStop, absorbStopError, isAbsorbStopError,
  isAbsorbCancelError, absorbNextGeneration, absorbIsCancelled, checkStop, sleepCheckStop,
  saveAbsorbState, loadAbsorbState, clearAbsorbState, absorbBumpLandings, absorbResetLandings, absorbResetRun,
  saveAbsorbLastResults, loadAbsorbLastResults,
} from './absorb-state.js';
import {
  ABSORB_IDS, ABSORB_NEW_IDS, ABSORB_GENDER_LABELS, ABSORB_FAMILY_STATUS_LABELS,
  absorbSetAndWait, absorbSelectOption, absorbFireElement, absorbRunClientValidation, absorbCollectValidationMessages,
  absorbActivateStudentsTab, readAbsorbGridRows, absorbSearch, absorbSearchFailReason, absorbCountGate,
  ABSORB_SEARCH_FAILED_ACTION, ABSORB_GRID_STALE_ACTION, absorbReadAndHidePopup, absorbModalVisible,
  absorbCloseAcceptModal, absorbNewStudentPageMatches, absorbWaitOutcome,
} from './absorb-dom.js';

const STUDENT_TIMEOUT_MS = 60000;
const CONFIRM_BUDGET_MS = 25000;
const SAVE_BUDGET_MS = 30000;
const NAV_WATCHDOG_MS = 12000;
const NAVIGATED = { __navigated: true }; // ניווט מלא נורה — ההמשך אחרי טעינת הדף
const CONTINUE = { __continue: true }; // התוצאה כבר נרשמה — לתלמיד הבא

// ─── טקסטי "מה לעשות" (ממצא 12): תמיד עם "איך", לא רק "מה" ───────────────────
const SUPPORT_URL = 'https://github.com/mdj441/talmud-scripts/issues';
const LOG_ACTION = `לחץ "העתק יומן" (ממוסך) וצרף אותו לדיווח בדף התמיכה של הכלי: ${SUPPORT_URL}`;
const MANUAL_ABSORB_ACTION = 'לחץ "קליטה" בדף סוג-הלימוד, מלא את המזהה (ולדרכון גם תאריך לידה וארץ) ולחץ "אישור"';
function verifyListAction(code, branch) {
  return `ודא ברשימת התלמידים של סוג ${code} בסניף ${branch} שהתלמיד נקלט, ואם אינו שם, קלוט אותו ידנית`;
}
function searchListAction(code, branch) {
  return `חפש את המזהה ברשימת התלמידים של סוג ${code} בסניף ${branch}; אם אינו שם, קלוט ידנית`;
}
function manualRowAction() {
  return `בצע את השורה הזו ידנית באתר (${MANUAL_ABSORB_ACTION}). אם זה חוזר, ${LOG_ACTION}`;
}

// ─── hooks לפאנל ────────────────────────────────────────────────────────────
export function absorbSetHooks(hooks) { S.hooks = hooks || {}; }
export function absorbGetResults() { return S.results.slice(); }
export function absorbIsRunning() { return S.running; }
// "עסוק" = רץ, או שנורה ניווט מלא והריצה ממתינה לטעינת הדף (S.running=false בכוונה, אך אסור להתחיל ריצה חדשה).
export function absorbIsBusy() { return S.running || watchdogTimer !== null; }
function hook(name, ...args) { try { if (S.hooks[name]) S.hooks[name](...args); } catch (e) { /* אצווה לא נתקעת */ } }

// ─── ניווט מלא: האם הדף מתחיל להיפרק, וכלב-שומר אם לא ─────────────────────
let unloadSeen = false;
let unloadWatched = false;
let watchdogTimer = null;

function watchUnload() {
  if (unloadWatched) return;
  try {
    if (typeof window === 'undefined') return;
    unloadWatched = true;
    const mark = () => { unloadSeen = true; clearWatchdog(); };
    window.addEventListener('beforeunload', mark, true);
    window.addEventListener('pagehide', mark, true);
  } catch (e) { /* noop */ }
}

function beginNavigation() {
  watchUnload();
  unloadSeen = false;
  hook('onNavigating');
}

function clearWatchdog() {
  if (watchdogTimer !== null) { try { clearTimeout(watchdogTimer); } catch (e) { /* noop */ } watchdogTimer = null; }
}

// ניווט שהוכרז ולא הביא טעינת דף תוך 12 שניות: אם הדף בכל זאת מתאים למשימה — ממשיכים;
// אחרת התלמיד מקבל "שגיאה" עם הוראה ידנית, והאצווה ממשיכה. לעולם לא קופאים על "ממתין".
function armWatchdog(taskIdx) {
  clearWatchdog();
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    if (unloadSeen || S.running) return;
    const task = S.queue[taskIdx];
    const page = getPage();
    const b = task ? normalizeBranch(task.branch) : null;
    // ממצא 3: גם דף מוסד של הסניף הנכון "מתאים" (העץ רינדר במקום): ממשיכים משם לגריד
    const fits = !!task && ((page.kind === 'studyType' && page.branch === b && page.studyType === String(task.studyType) && absorbBranchSourceTrusted(page.branchSource))
      || (page.kind === 'institute' && page.branch === b));
    if (fits) {
      log('[ניווט] הדף התעדכן בלי טעינה מלאה — ממשיכים במקום');
    } else {
      log(`[ניווט] לא הגיעה טעינת דף תוך ${Math.round(NAV_WATCHDOG_MS / 1000)} שניות — התלמיד מסומן ומדלגים`);
      if (task && absorbShouldRecord(S.lastRecordedIdx, taskIdx)) {
        recordResult(makeAbsorbResult(task, ABSORB_STATUS.ERROR, 'הניווט לדף סוג-הלימוד לא הביא טעינת דף', manualStudyTypeAction(task.branch, task.studyType)), null, taskIdx);
      }
      S.curIdx = Math.max(S.curIdx, taskIdx + 1);
      saveAbsorbState();
    }
    Promise.resolve().then(() => runQueue()).catch((e) => log('[ניווט] המשך במקום נכשל: ' + (e && e.message)));
  }, NAV_WATCHDOG_MS);
}

// ─── שלב 1: הדף הנכון ───────────────────────────────────────────────────────
// ממצא 1ב: המסלול המהיר ("כבר בדף הנכון") מותר רק כשהסניף נקרא מהדף עצמו (פירורי-לחם) או
// אומת בדף המוסד שממנו הגענו (institute). סניף מהמפה/מהכוונה בלבד: מנווטים דרך דף המוסד של
// הסניף (ה-h1 שם מאמת), ומשם לסוג-הלימוד.
async function ensureStudyTypePage(task, gen) {
  const branch = normalizeBranch(task.branch);
  const code = String(task.studyType);
  const page = getPage();
  let viaInstitute = false;
  if (page.kind === 'studyType' && page.studyType === code) {
    if (page.branch === branch && absorbBranchSourceTrusted(page.branchSource)) return { ok: true, navigated: false };
    if (!page.branch) log(`[ניווט] דף סוג-לימוד ${code}, אך הסניף לא ניתן לזיהוי מהדף: מנווטים דרך דף המוסד כדי לוודא`);
    else if (page.branch !== branch) log(`[ניווט] דף סוג-לימוד ${code} של סניף ${page.branch}; צריך סניף ${branch}`);
    else { log(`[ניווט] דף סוג-לימוד ${code}: הסניף ${branch} ידוע רק מ-${page.branchSource}, לא מהדף: מאמתים דרך דף המוסד`); viaInstitute = true; }
  }
  checkStop('before-nav', gen);
  saveAbsorbState();
  beginNavigation();
  const res = viaInstitute ? await gotoInstitute(branch) : await gotoStudyType(branch, code);
  if (absorbIsCancelled(gen)) checkStop('nav-cancelled', gen);
  if (!res || res.ok === false) {
    if (res && res.notFound) {
      return {
        ok: false, reason: res.reason,
        action: `בדוק בדף המוסד של סניף ${branch}, בלשונית "סוגי לימוד למוסד", שסוג ${code} קיים ואינו "סגור". אם הוא קיים, פתח אותו ולחץ "התחל" שוב על השורה הזו`,
      };
    }
    return { ok: false, reason: (res && res.reason) || 'הניווט נכשל', action: manualStudyTypeAction(branch, code) };
  }
  const how = res.method === 'url' ? `כתובת ישירה${res.hop ? ' (קפיצה לדף מוסד ידוע)' : ''}${viaInstitute ? ' (דף המוסד, לאימות הסניף)' : ''}`
    : res.method === 'grid' ? `${res.treeInPlace ? 'עץ הסניפים (במקום) + ' : ''}גריד סוגי-הלימוד בדף המוסד`
      : res.method === 'tree' ? 'עץ הסניפים' : res.method || '?';
  log(`[ניווט] → סניף ${branch} סוג ${code} · ${how}`);
  if (res.status && /סגור/.test(res.status)) log(`[ניווט] שים לב: סוג לימוד ${code} מסומן "${res.status}" בגריד`);
  return { ok: true, navigated: true };
}

// ─── דף תלמיד-חדש ───────────────────────────────────────────────────────────

// יוצאים מדף תלמיד-חדש לדף סוג-הלימוד (הכתובת כבר ידועה — היינו שם).
async function leaveNewStudentPage(task, recorded, gen) {
  if (absorbIsCancelled(gen)) { log('[תלמיד חדש] ניסיון שבוטל — לא יוצאים מהדף'); return CONTINUE; }
  saveAbsorbState();
  beginNavigation();
  const res = await gotoStudyType(task.branch, task.studyType);
  if (res && res.ok !== false) return NAVIGATED;
  log(`[ניווט] היציאה מדף תלמיד-חדש נכשלה: ${res && res.reason}`);
  if (recorded) {
    recorded.detail = [recorded.detail, res && res.reason].filter(Boolean).join(' | ');
    saveAbsorbState();
  }
  return CONTINUE;
}

// הערת חלונית-מידע שנראתה אחרי "שמירה" (ממצא 12: נכנסת ל-detail של התוצאה, לא רק ליומן).
function pendingSaveNote() {
  return (S.pendingSave && S.pendingSave.note) || '';
}

async function handleNewStudentPage(task, identity, mk, gen, myIdx) {
  log('[תלמיד חדש] נחתנו בדף תלמיד-חדש');

  // ממצא 4: "שמירה" כטעינה מלאה שחזרה לאותו דף (למשל כשל ולידציה בשרת). לא שומרים שוב: אוספים
  // את מה שהדף אומר, רושמים תוצאה, ויוצאים. בלי זה הדף היה מתמלא ונשמר שוב, עד תקרת הנחיתות.
  if (S.justSaved && absorbNormalizeId(S.justSaved) === absorbNormalizeId(identity)) {
    log('[תלמיד חדש] הדף נטען מחדש אחרי "שמירה": לא שומרים שוב');
    const { pop, blocked } = await absorbReadAndHidePopup('אחרי שמירה (טעינה חוזרת)', gen);
    const errs = absorbCollectValidationMessages();
    const note = [pendingSaveNote(), pop ? pop.text : ''].filter(Boolean).join(' | ');
    S.justSaved = null;
    let res;
    if (errs.length) res = mk(ABSORB_STATUS.ERROR, errs.join(' | '), 'תקן את הפרטים לפי ההודעה והרץ שוב, או השלם ידנית בדף התלמיד');
    else if (blocked) res = mk(`${ABSORB_STATUS.BLOCKED}: ${pop.text}`, pop.text, 'המערכת מבקשת אישור "המשך" בשמירת התלמיד. הסקריפט לא מאשר לבד: פתח את דף התלמיד, קרא את ההודעה והחלט');
    else res = mk(ABSORB_STATUS.SAVED_UNVERIFIED, note || 'דף תלמיד-חדש נטען מחדש אחרי השמירה; לא ידוע אם נשמר', verifyListAction(task.studyType, task.branch));
    if (!recordResult(res, gen, myIdx)) return CONTINUE;
    return leaveNewStudentPage(task, res, gen);
  }

  const ns = task.newStudent || {};
  const birthDate = ns.birthDate || task.birthDate || '';
  const missing = [];
  if (!ns.firstName) missing.push('שם פרטי');
  if (!ns.lastName) missing.push('שם משפחה');
  if (!birthDate) missing.push('תאריך לידה');

  if (missing.length) {
    log(`[תלמיד חדש] חסרים נתונים (${missing.join(', ')}) — לא שומרים`);
    const res = mk(ABSORB_STATUS.NEW_STUDENT_MISSING, `חסר: ${missing.join(', ')}`,
      `התלמיד לא מוכר למערכת. הוסף לשורה שלו את העמודות ${missing.join(', ')} (ואם צריך גם מגדר ומצב משפחתי; ברירת-המחדל: זכר, נשוי) והרץ אותה שוב`);
    if (!recordResult(res, gen, myIdx)) return CONTINUE;
    return leaveNewStudentPage(task, res, gen);
  }

  const first = $el(ABSORB_NEW_IDS.firstName);
  const last = $el(ABSORB_NEW_IDS.lastName);
  const birth = $el(ABSORB_NEW_IDS.birthDate);
  if (!first || !last || !birth) return mk(ABSORB_STATUS.ERROR, 'שדות דף תלמיד-חדש לא נמצאו', 'מלא את פרטי התלמיד החדש ידנית בדף שנפתח ולחץ "שמירה"');

  await absorbSetAndWait(first, ns.firstName);
  await absorbSetAndWait(last, ns.lastName);
  await absorbSetAndWait(birth, birthDate);
  if (ns.gender) {
    const g = $el(ABSORB_NEW_IDS.gender);
    if (g) {
      const r = await absorbSelectOption(g, ns.gender, 'מגדר', ABSORB_GENDER_LABELS[ns.gender]);
      if (!r.ok) return mk(ABSORB_STATUS.ERROR, r.reason, 'תקן את עמודת "מגדר" (זכר/נקבה) והרץ שוב, או בחר ידנית בדף התלמיד ולחץ "שמירה"');
    }
  }
  if (ns.familyStatus) {
    const f = $el(ABSORB_NEW_IDS.familyStatus);
    if (f) {
      const r = await absorbSelectOption(f, ns.familyStatus, 'מצב משפחתי', ABSORB_FAMILY_STATUS_LABELS[ns.familyStatus]);
      if (!r.ok) return mk(ABSORB_STATUS.ERROR, r.reason, 'תקן את עמודת "מצב משפחתי" (רווק/נשוי/גרוש/אלמן) והרץ שוב, או בחר ידנית בדף התלמיד ולחץ "שמירה"');
    }
  }
  await sleepCheckStop(200, gen);
  checkStop('new-student-before-save', gen);

  const saveBtn = $el(ABSORB_NEW_IDS.saveBtn);
  if (!saveBtn) return mk(ABSORB_STATUS.ERROR, 'כפתור "שמירה" לא נמצא בדף תלמיד-חדש', 'שמור ידנית בדף התלמיד');
  const v = absorbRunClientValidation('Validation');
  if (!v.ok) {
    return mk(ABSORB_STATUS.ERROR, 'ולידציה בדף תלמיד-חדש: ' + (v.messages.join(' | ') || 'שדה לא תקין'),
      'תקן בשורה: שם פרטי ושם משפחה באותיות עבריות בלבד, תאריך לידה DD/MM/YYYY וגיל 16 לפחות. הרץ שוב');
  }

  // "שמירה" עלולה לטעון דף אחר. מסמנים לפני, כדי שההמשך ידע לאמת "נקלט (תלמיד חדש)".
  // ממצא 4: pendingSave חי ב-S ונשמר בכל saveAbsorbState עד רישום התוצאה של השורה הזו.
  S.pendingSave = { idx: myIdx, identity, note: '' };
  S.justSaved = identity;
  saveAbsorbState();
  beginNavigation();
  log('[תלמיד חדש] שמירה…');
  const wait = absorbFireElement(saveBtn, { startTimeoutMs: 3000, totalTimeoutMs: SAVE_BUDGET_MS });
  const outcome = await absorbWaitOutcome(wait, SAVE_BUDGET_MS, gen);
  log(`[תלמיד חדש] תוצאת השמירה: ${outcome.kind}`);
  await sleepCheckStop(300, gen);

  const { pop, blocked } = await absorbReadAndHidePopup('אחרי שמירת תלמיד חדש', gen);
  if (pop && pop.text && S.pendingSave) { S.pendingSave.note = pop.text; saveAbsorbState(); } // ממצא 12
  if (blocked) {
    S.justSaved = null;
    S.pendingSave = null;
    saveAbsorbState();
    return mk(`${ABSORB_STATUS.BLOCKED}: ${pop.text}`, pop.text, 'המערכת מבקשת אישור "המשך" בשמירת התלמיד. הסקריפט לא מאשר לבד: פתח את דף התלמיד, קרא את ההודעה והחלט');
  }

  if (getPage().kind === 'newStudent') {
    const errs = absorbCollectValidationMessages();
    if (errs.length) {
      S.justSaved = null;
      S.pendingSave = null;
      saveAbsorbState();
      return mk(ABSORB_STATUS.ERROR, errs.join(' | '), 'תקן את הפרטים לפי ההודעה והרץ שוב, או השלם ידנית בדף התלמיד');
    }
    // נשארנו בדף (עם או בלי הודעת הצלחה) — האמת נמצאת ברשימת התלמידים של סוג-הלימוד.
    log('[תלמיד חדש] נשארנו בדף אחרי השמירה — עוברים לרשימת התלמידים לאימות');
    beginNavigation();
    const res = await gotoStudyType(task.branch, task.studyType);
    if (res && res.ok !== false) return NAVIGATED;
    S.justSaved = null;
    return mk(ABSORB_STATUS.SAVED_UNVERIFIED, [pendingSaveNote(), 'השמירה בוצעה אך לא ניתן היה לחזור לרשימת התלמידים'].filter(Boolean).join(' | '), verifyListAction(task.studyType, task.branch));
  }

  // הדף התחלף בלי טעינה מלאה (נדיר): אם זה דף סוג-הלימוד — מאמתים כאן.
  return verifyAfterNewStudent(task, identity, mk, gen);
}

async function verifyAfterNewStudent(task, identity, mk, gen) {
  const page = getPage();
  const note = pendingSaveNote();
  if (page.kind === 'studyType' && page.studyType === String(task.studyType)) {
    await absorbActivateStudentsTab();
    const input = $el(ABSORB_IDS.searchInput);
    const btn = $el(ABSORB_IDS.searchBtn);
    if (input && btn) {
      const search = await absorbSearch(input, btn, identity, gen);
      if (search.executed) {
        const grid = analyzeGrid(readAbsorbGridRows(), identity, absorbCountGate(search));
        if (grid.found) {
          S.justSaved = null;
          return mk(ABSORB_STATUS.OK_NEW, note, '');
        }
        if (grid.singleOther) {
          S.justSaved = null;
          return mk(ABSORB_STATUS.VERIFY, [note, `ברשימה שורה אחת עם מזהה אחר: ${grid.singleOther}`].filter(Boolean).join(' | '), searchListAction(task.studyType, task.branch));
        }
      }
    }
  }
  S.justSaved = null;
  return mk(ABSORB_STATUS.SAVED_UNVERIFIED, [note, 'התלמיד נשמר; הקליטה לא אומתה ברשימה'].filter(Boolean).join(' | '), verifyListAction(task.studyType, task.branch));
}

// ─── תלמיד יחיד ─────────────────────────────────────────────────────────────
export async function processStudent(task, gen) {
  const myIdx = S.curIdx;
  const identity = task.idType === 'tz' ? padId9(task.identity) : String(task.identity).trim();
  const mk = (status, detail, action) => makeAbsorbResult(task, status, detail, action);
  const branch = normalizeBranch(task.branch);
  const code = String(task.studyType);

  log(`▶ סניף ${branch} · סוג ${code} · ${maskId(identity)} · ${task.idType === 'passport' ? 'דרכון' : 'ת.ז.'}`);
  checkStop('start', gen);

  // נחתנו בדף תלמיד-חדש (אחרי "אישור" במודאל שטען דף חדש)
  if (getPage().kind === 'newStudent') {
    if (absorbNewStudentPageMatches(identity)) return handleNewStudentPage(task, identity, mk, gen, myIdx);
    log('[תלמיד חדש] הדף שייך למזהה אחר — יוצאים ממנו');
    const left = await leaveNewStudentPage(task, null, gen);
    if (left === NAVIGATED) return NAVIGATED;
    return mk(ABSORB_STATUS.ERROR, 'נפתח דף תלמיד-חדש של מזהה אחר ולא ניתן היה לצאת ממנו', manualStudyTypeAction(branch, code));
  }

  if (task.idType === 'passport') {
    if (!task.birthDate) return mk(ABSORB_STATUS.ERROR, 'דרכון ללא תאריך לידה', 'הוסף לשורה עמודת "תאריך לידה" (DD/MM/YYYY) והרץ שוב');
    if (!task.countryValue) return mk(ABSORB_STATUS.ERROR, `ארץ דרכון חסרה או לא מוכרת: "${task.country || 'ריק'}"`, 'כתוב בעמודת "ארץ" שם מהרשימה (כפתור "רשימת ארצות") והרץ שוב');
  }

  // ── שלב 1: הדף הנכון ──
  const nav = await ensureStudyTypePage(task, gen);
  if (!nav.ok) return mk(ABSORB_STATUS.ERROR, nav.reason, nav.action);
  if (nav.navigated) return NAVIGATED;
  checkStop('after-nav', gen);
  await absorbActivateStudentsTab(); // ממצא 9: ממתינים ל-postback של הלשונית לפני החיפוש
  await sleepCheckStop(250, gen);

  // ── שלב 2: חיפוש מקדים ──
  const searchInput = $el(ABSORB_IDS.searchInput);
  const searchBtn = $el(ABSORB_IDS.searchBtn);
  if (!searchInput || !searchBtn) return mk(ABSORB_STATUS.ERROR, 'שדה או כפתור החיפוש ברשימת התלמידים לא נמצאו', 'פתח את הלשונית "רשימת תלמידים" בדף סוג-הלימוד, רענן, והרץ שוב. אם חוזר: ייתכן שאין לך הרשאה לסוג לימוד זה');
  let pre = await absorbSearch(searchInput, searchBtn, identity, gen);
  let decision = absorbPrecheckDecision(pre);
  if (decision === 'retry') {
    log('[חיפוש] התווית מדווחת תוצאות אך הרשימה לא התרעננה — חיפוש חוזר');
    await sleepCheckStop(500, gen);
    pre = await absorbSearch(searchInput, searchBtn, identity, gen);
    decision = absorbPrecheckDecision(pre);
    if (decision === 'retry') return mk(ABSORB_STATUS.ERROR, `החיפוש דיווח ${pre.count} תוצאות אך הרשימה לא התרעננה`, ABSORB_GRID_STALE_ACTION);
  }
  if (decision !== 'analyze') return mk(ABSORB_STATUS.ERROR, absorbSearchFailReason(pre), ABSORB_SEARCH_FAILED_ACTION);

  const justSaved = S.justSaved && absorbNormalizeId(S.justSaved) === absorbNormalizeId(identity);
  const savedNote = justSaved ? pendingSaveNote() : '';
  const preGrid = analyzeGrid(readAbsorbGridRows(), identity, absorbCountGate(pre));
  if (preGrid.found) {
    const via = preGrid.matchType === 'single-row-fallback' ? 'התאמה לפי שורה יחידה ברשימה' : '';
    if (justSaved) { S.justSaved = null; log('[תלמיד חדש] נמצא ברשימה אחרי השמירה → נקלט'); return mk(ABSORB_STATUS.OK_NEW, [savedNote, via].filter(Boolean).join(' | '), ''); }
    log('[קליטה] כבר קיים בסוג הלימוד');
    return mk(ABSORB_STATUS.EXISTS, via, '');
  }
  if (preGrid.singleOther) {
    // ממצא 10: החיפוש החזיר שורה אחת עם מזהה אחר. לא הצלחה ולא "לא נמצא": המשתמש מאמת.
    S.justSaved = null;
    log(`[קליטה] ברשימה שורה אחת עם מזהה אחר (${maskId(preGrid.singleOther)}): לאמת ידנית`);
    return mk(ABSORB_STATUS.VERIFY, [savedNote, `ברשימה שורה אחת עם מזהה אחר: ${preGrid.singleOther}`].filter(Boolean).join(' | '), searchListAction(code, branch));
  }
  if (justSaved) {
    // נשמר בדף תלמיד-חדש אך לא ברשימה — לא קולטים שוב, מדווחים לבדיקה ידנית.
    S.justSaved = null;
    return mk(ABSORB_STATUS.SAVED_UNVERIFIED, [savedNote, 'התלמיד נשמר בדף תלמיד-חדש אך לא נמצא ברשימת התלמידים'].filter(Boolean).join(' | '), verifyListAction(code, branch));
  }
  checkStop('after-precheck', gen);

  // ── שלב 3: "קליטה" ──
  const absorbBtn = $el(ABSORB_IDS.absorbBtn);
  if (!absorbBtn) return mk(ABSORB_STATUS.ERROR, 'כפתור "קליטה" לא נמצא בדף', `בדוק שיש לך הרשאת קליטה לסוג לימוד זה ושאינו "סגור"; אם יש, ${MANUAL_ABSORB_ACTION}`);
  try {
    const click = await absorbFireElement(absorbBtn, { startTimeoutMs: 3000, totalTimeoutMs: 20000 });
    if (!click.ok) log(`[קליטה] postback לא תקין: ${click.reason}`);
    await sleepCheckStop(300, gen);

    let popupDetail = '';
    const afterOpen = await absorbReadAndHidePopup('אחרי "קליטה"', gen);
    if (afterOpen.pop) {
      popupDetail = afterOpen.pop.text;
      if (afterOpen.blocked) return mk(`${ABSORB_STATUS.BLOCKED}: ${popupDetail}`, popupDetail, 'המערכת מבקשת אישור "המשך". הסקריפט לא מאשר לבד: לחץ "קליטה" ידנית, קרא את ההודעה והחלט');
    }
    checkStop('after-absorb-click', gen);

    // ── שלב 4: המודאל ──
    let modalOpen = absorbModalVisible();
    if (!modalOpen) {
      try { await waitFor(() => absorbModalVisible(), { timeout: 4000, interval: 100 }); modalOpen = true; } catch (e) { modalOpen = false; }
    }
    if (!modalOpen) {
      return mk(ABSORB_STATUS.ERROR, popupDetail || 'חלון הקליטה לא נפתח',
        popupDetail ? 'המערכת החזירה הודעה במקום לפתוח את חלון הקליטה. קרא אותה בעמודת "פירוט" וטפל ידנית' : 'לחץ "קליטה" ידנית בדף סוג-הלימוד ובדוק אם מופיעה הודעה');
    }

    const idTypeValue = task.idType === 'passport' ? '2' : '1';
    const ddlType = $el(ABSORB_IDS.idTypeDdl);
    if (ddlType && ddlType.value !== idTypeValue) {
      await absorbSetAndWait(ddlType, idTypeValue, { select: true });
      await sleepCheckStop(150, gen);
    }
    const modalId = $el(ABSORB_IDS.modalId);
    if (!modalId) return mk(ABSORB_STATUS.ERROR, 'שדה המזהה בחלון הקליטה לא נמצא', MANUAL_ABSORB_ACTION);
    await absorbSetAndWait(modalId, identity);
    await sleepCheckStop(120, gen);

    if (task.idType === 'passport') {
      const birthEl = $el(ABSORB_IDS.birthDate);
      if (!birthEl) return mk(ABSORB_STATUS.ERROR, 'שדה תאריך לידה בחלון הקליטה לא נמצא', MANUAL_ABSORB_ACTION);
      await absorbSetAndWait(birthEl, task.birthDate);
      await sleepCheckStop(120, gen);
      const countryEl = $el(ABSORB_IDS.countryDdl);
      if (!countryEl) return mk(ABSORB_STATUS.ERROR, 'שדה ארץ דרכון בחלון הקליטה לא נמצא', MANUAL_ABSORB_ACTION);
      const country = await absorbSelectOption(countryEl, task.countryValue, 'ארץ', task.country);
      if (!country.ok) return mk(ABSORB_STATUS.ERROR, country.reason, 'תקן את עמודת "ארץ" לשם מהרשימה (כפתור "רשימת ארצות") והרץ שוב');
      await sleepCheckStop(150, gen);
    }

    const startDate = startDateFromPanel();
    if (startDate) {
      const startEl = $el(ABSORB_IDS.startDate);
      if (startEl && startEl.value !== startDate) await absorbSetAndWait(startEl, startDate);
    }
    checkStop('after-fields', gen);

    // ── שלב 5: אישור ──
    const confirmBtn = $el(ABSORB_IDS.confirmBtn);
    if (!confirmBtn) return mk(ABSORB_STATUS.ERROR, 'כפתור "אישור" לא נמצא בחלון הקליטה', MANUAL_ABSORB_ACTION);
    const v = absorbRunClientValidation('PopValidation');
    if (!v.ok) return mk(ABSORB_STATUS.ERROR, 'ולידציה בחלון הקליטה: ' + (v.messages.join(' | ') || 'שדה לא תקין'), 'תקן בשורה את המזהה, תאריך הלידה או הארץ לפי ההודעה, והרץ שוב');

    saveAbsorbState(); // "אישור" עלול לטעון דף תלמיד-חדש
    beginNavigation();
    const confirmWait = absorbFireElement(confirmBtn, { startTimeoutMs: 3000, totalTimeoutMs: CONFIRM_BUDGET_MS });
    const outcome = await absorbWaitOutcome(confirmWait, CONFIRM_BUDGET_MS, gen);
    log(`[אישור] תוצאה: ${outcome.kind}`);

    // ── שלב 6: דף תלמיד-חדש באותו מסמך (נדיר; בדרך כלל זו טעינה מלאה שממשיכה ב-resume) ──
    if (getPage().kind === 'newStudent') {
      if (absorbNewStudentPageMatches(identity)) return handleNewStudentPage(task, identity, mk, gen, myIdx);
      const res = mk(ABSORB_STATUS.ERROR, 'נפתח דף תלמיד-חדש של מזהה אחר', searchListAction(code, branch));
      if (!recordResult(res, gen, myIdx)) return CONTINUE;
      return leaveNewStudentPage(task, res, gen);
    }

    // ── שלב 7: הודעה → מודאל → אימות ──
    await sleepCheckStop(300, gen);
    const afterConfirm = await absorbReadAndHidePopup('אחרי אישור', gen);
    if (afterConfirm.pop) {
      if (afterConfirm.blocked) return mk(`${ABSORB_STATUS.BLOCKED}: ${afterConfirm.pop.text}`, afterConfirm.pop.text, 'המערכת מבקשת אישור "המשך" (למשל מעבר בין מוסדות). הסקריפט לא מאשר לבד: בצע את הקליטה ידנית והחלט על ההודעה');
      popupDetail = afterConfirm.pop.text;
    }
    if (absorbModalVisible()) {
      const errs = absorbCollectValidationMessages();
      return mk(ABSORB_STATUS.NOT_COMPLETED, errs.join(' | ') || popupDetail || 'חלון הקליטה נשאר פתוח', 'פתח את חלון הקליטה ידנית, קרא את הודעת השגיאה ותקן את השורה');
    }
    checkStop('before-verify', gen);

    const verifyInput = $el(ABSORB_IDS.searchInput);
    const verifyBtn = $el(ABSORB_IDS.searchBtn);
    if (!verifyInput || !verifyBtn) return mk(ABSORB_STATUS.SAVED_UNVERIFIED, popupDetail || 'שדות החיפוש נעלמו אחרי הקליטה', verifyListAction(code, branch));
    const verify = await absorbSearch(verifyInput, verifyBtn, identity, gen);
    if (!verify.executed) return mk(ABSORB_STATUS.SAVED_UNVERIFIED, absorbSearchFailReason(verify), ABSORB_SEARCH_FAILED_ACTION);
    const found = analyzeGrid(readAbsorbGridRows(), identity, absorbCountGate(verify));
    if (found.found) { log('◀ נקלט'); return mk(ABSORB_STATUS.OK, popupDetail || (found.matchType === 'single-row-fallback' ? 'התאמה לפי שורה יחידה ברשימה' : ''), ''); }
    if (found.singleOther) {
      log(`◀ ברשימה שורה אחת עם מזהה אחר (${maskId(found.singleOther)}): לאמת ידנית`);
      return mk(ABSORB_STATUS.VERIFY, [popupDetail, `ברשימה שורה אחת עם מזהה אחר: ${found.singleOther}`].filter(Boolean).join(' | '), searchListAction(code, branch));
    }
    log('◀ לא אומת ברשימה');
    return mk(ABSORB_STATUS.UNVERIFIED, popupDetail || 'לא נמצא ברשימה אחרי הקליטה', searchListAction(code, branch));
  } finally {
    try {
      if (absorbIsCancelled(gen)) log('[מודאל] ניסיון שבוטל — לא נוגעים בדף');
      else if (absorbModalVisible()) await absorbCloseAcceptModal();
    } catch (e) { /* אצווה לא נתקעת */ }
  }
}

function startDateFromPanel() {
  try { const v = S.hooks.getStartDate ? S.hooks.getStartDate() : ''; return v ? String(v).trim() : ''; } catch (e) { return ''; }
}

// ─── timeout + ניסיון חוזר אחד ──────────────────────────────────────────────
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const clearAll = () => { clearTimeout(timer); clearInterval(poller); };
    const timer = setTimeout(() => { clearAll(); reject(new Error(`תהליך תקוע — חרג מ-${Math.round(ms / 1000)} שניות`)); }, ms);
    const poller = setInterval(() => { if (absorbIsStopped()) { clearAll(); reject(absorbStopError('timeout-poller')); } }, 200);
    promise.then((val) => { clearAll(); resolve(val); }, (err) => { clearAll(); reject(err); });
  });
}

export async function processStudentSafe(task) {
  const myIdx = S.curIdx;
  const errResult = (detail) => makeAbsorbResult(task, ABSORB_STATUS.ERROR, detail, manualRowAction());
  try {
    return await withTimeout(processStudent(task, absorbNextGeneration()), STUDENT_TIMEOUT_MS);
  } catch (err) {
    if (isAbsorbStopError(err)) throw err;
    absorbNextGeneration();
    log(`[ניסיון 1] ${isAbsorbCancelError(err) ? 'בוטל' : 'נכשל'}: ${err && err.message}`);
    await absorbCloseAcceptModal();
    if (absorbIsStopped()) throw absorbStopError('between-attempts');
    if (!absorbShouldRecord(S.lastRecordedIdx, myIdx)) { log('[ניסיון 2] לא נדרש — התוצאה לשורה הזו כבר נרשמה'); return CONTINUE; }
    try {
      await sleep(1000);
      log(`[ניסיון 2] ${maskId(task.identity)}`);
      return await withTimeout(processStudent(task, absorbNextGeneration()), STUDENT_TIMEOUT_MS);
    } catch (err2) {
      if (isAbsorbStopError(err2)) throw err2;
      log(`[ניסיון 2] ${isAbsorbCancelError(err2) ? 'בוטל' : 'נכשל'}: ${err2 && err2.message} — מדלגים`);
      await absorbCloseAcceptModal();
      if (!absorbShouldRecord(S.lastRecordedIdx, myIdx)) return CONTINUE;
      return errResult(`2 ניסיונות: ${err2 && err2.message}`);
    }
  }
}

// ─── התור ───────────────────────────────────────────────────────────────────
function recordResult(result, gen, idx) {
  const at = typeof idx === 'number' ? idx : S.curIdx;
  if (absorbIsCancelled(gen)) { log('[תוצאה] ניסיון שבוטל ניסה לרשום תוצאה — מתעלמים'); return false; }
  if (!absorbShouldRecord(S.lastRecordedIdx, at)) { log(`[תוצאה] לשורה ${at + 1} כבר נרשמה תוצאה`); return false; }
  S.lastRecordedIdx = at;
  S.results.push(result);
  S.curIdx = Math.max(S.curIdx, at + 1);
  if (S.pendingSave && S.pendingSave.idx === at) S.pendingSave = null; // ממצא 4: השמירה נסגרה עם השורה
  absorbResetLandings();
  saveAbsorbState();
  hook('onResult', result, S.results);
  return true;
}

// ─── נעילת-ריצה בין לשוניות (ממצא 5) ────────────────────────────────────────
let lockTimer = null;

function startLockRefresh() {
  if (lockTimer !== null) return;
  lockTimer = setInterval(() => { refreshRunLock(); }, RUN_LOCK_REFRESH_MS);
}

function stopLockRefresh() {
  if (lockTimer !== null) { try { clearInterval(lockTimer); } catch (e) { /* noop */ } lockTimer = null; }
}

// false = לשונית אחרת של תלמו"ד רצה עכשיו. הפאנל מציג את ההודעה (hook onLocked).
function takeRunLock(where) {
  if (acquireRunLock()) { startLockRefresh(); return true; }
  log(`[נעילה] ${where}: ${RUN_LOCK_BUSY_MESSAGE}`);
  hook('onLocked', RUN_LOCK_BUSY_MESSAGE);
  return false;
}

function dropRunLock() {
  stopLockRefresh();
  releaseRunLock();
}

function fillRemaining(status, detail, action) {
  while (S.curIdx < S.queue.length) {
    S.results.push(makeAbsorbResult(S.queue[S.curIdx], status, detail, action));
    S.curIdx++;
  }
  S.lastRecordedIdx = S.curIdx - 1;
  saveAbsorbState();
}

function finishRun() {
  S.running = false;
  clearAbsorbState();
  clearAbsorbStop();
  clearNavIntent(); // ממצא 7
  dropRunLock(); // ממצא 5
  const report = buildRemainingReport(S.results);
  saveAbsorbLastResults(S.results, report); // ממצא 6: תמונת-תוצאות אחרונה שורדת טעינת-דף
  log(`═══ סיום · ${report.summary}`);
  hook('onDone', S.results, report);
}

export async function runQueue() {
  S.running = true;
  clearWatchdog();
  watchUnload();
  startLockRefresh();
  log(`🚀 ריצה — ${S.queue.length} תלמידים, מתחילים בשורה ${S.curIdx + 1}`);
  hook('onStart', S.queue, S.curIdx);

  while (S.curIdx < S.queue.length) {
    if (absorbIsStopped()) {
      log('⛔ נעצר — ממלאים את שארית התור');
      fillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
      break;
    }
    const taskIdx = S.curIdx;
    const task = S.queue[taskIdx];
    hook('onProgress', taskIdx, S.queue.length, task);

    let result;
    try {
      result = await processStudentSafe(task);
    } catch (stopErr) {
      log(`⛔ נעצר באמצע עיבוד: ${stopErr && stopErr.message}`);
      recordResult(makeAbsorbResult(task, ABSORB_STATUS.STOPPED, 'נעצר באמצע עיבוד', 'בדוק את מצב התלמיד באתר והרץ שוב את השורה'), null, taskIdx);
      fillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
      break;
    }

    if (result === NAVIGATED || (result && result.__navigated)) {
      S.running = false;
      log('… טעינת דף — ההמשך אחרי הטעינה');
      armWatchdog(taskIdx);
      return;
    }
    if (result === CONTINUE || (result && result.__continue)) {
      if (S.curIdx <= taskIdx) {
        recordResult(makeAbsorbResult(task, ABSORB_STATUS.ERROR, 'לא נרשמה תוצאה לשורה הזו', manualRowAction()), null, taskIdx);
      }
      S.curIdx = Math.max(S.curIdx, taskIdx + 1);
      saveAbsorbState();
      await sleep(250);
      continue;
    }
    recordResult(result, null, taskIdx);
    await sleep(250);
  }
  finishRun();
}

// מחזיר false כשלשונית אחרת רצה (ממצא 5); אחרת את ה-Promise של הריצה.
export async function absorbStartRun(tasks) {
  if (!takeRunLock('התחלה')) return false;
  clearAbsorbStop();
  clearNavIntent(); // ממצא 7: כוונה ישנה מריצה קודמת אינה ראיה
  absorbNextGeneration();
  clearWatchdog();
  absorbResetRun();
  absorbResetLandings();
  S.queue = Array.isArray(tasks) ? tasks.slice() : [];
  S.startedAt = new Date().toISOString();
  saveAbsorbState();
  return runQueue();
}

// ממצא 6: תמונת-התוצאות של הריצה האחרונה (לתצוגה באתחול הלשונית). null כשאין.
export function absorbLastResults() {
  return loadAbsorbLastResults();
}

export function absorbHasSavedQueue() {
  const st = loadAbsorbState();
  return !!(st && Array.isArray(st.queue) && st.queue.length && (st.curIdx || 0) < st.queue.length);
}

export function absorbSavedQueueInfo() {
  const st = loadAbsorbState();
  if (!st || !Array.isArray(st.queue) || !st.queue.length) return null;
  return { total: st.queue.length, curIdx: st.curIdx || 0, startedAt: st.startedAt || null, stale: absorbQueueIsStale(st.startedAt, Date.now(), ABSORB_MAX_QUEUE_AGE_MS) };
}

export function absorbDiscardSavedQueue() {
  absorbNextGeneration();
  clearWatchdog();
  absorbResetRun();
  clearAbsorbState();
  clearAbsorbStop();
  clearNavIntent(); // ממצא 7
  dropRunLock();
  log('[המשך] התור השמור נמחק לבקשת המשתמש');
  return true;
}

// ממצא 11: ההמשך האוטומטי שייך לדפי הקליטה בלבד. דף אחר (למשל ההודעות), או דף תלמיד-חדש של
// מזהה אחר (המשתמש פתח ידנית), אינם מקום להשתלט עליו: הפאנל מציג "יש תור פתוח" ומחכה ללחיצה.
function absorbForeignPage(page, task) {
  if (!page || page.kind === 'other') return true;
  if (page.kind === 'newStudent') {
    const identity = task ? (task.idType === 'tz' ? padId9(task.identity) : String(task.identity || '').trim()) : '';
    return !identity || !absorbNewStudentPageMatches(identity);
  }
  return false;
}

// בטעינת דף: אם יש תור שמור, ממשיכים. תור ישן (>30 דק') או דף זר ממשיכים רק אחרי "המשך" בפאנל
// (opts.force; ‏allowStale נשמר כשם ישן). ‏false = לא התחילה ריצה כאן.
export async function absorbResumeIfPending(opts) {
  if (S.running) return false;
  const force = !!(opts && (opts.force || opts.allowStale));
  const st = loadAbsorbState();
  if (!st || !Array.isArray(st.queue) || !st.queue.length) return false;

  if (absorbIsStopped()) {
    // ממצא 6: "עצור" נלחץ בזמן טעינת-דף. לא מנקים בשקט: השארית מסומנת "נעצר" והתוצאות מוצגות.
    log('[המשך] דגל עצירה אחרי טעינת דף: מסיימים את הריצה עם "נעצר"');
    S.queue = st.queue;
    S.results = Array.isArray(st.results) ? st.results : [];
    S.curIdx = st.curIdx || 0;
    S.lastRecordedIdx = S.curIdx - 1;
    S.startedAt = st.startedAt || null;
    fillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
    finishRun();
    return false;
  }

  const info = { total: st.queue.length, curIdx: st.curIdx || 0, startedAt: st.startedAt || null, stale: false, reason: '' };
  if (!force && absorbQueueIsStale(st.startedAt, Date.now(), ABSORB_MAX_QUEUE_AGE_MS)) {
    log(`[המשך] תור שמור מ-${st.startedAt} ישן מ-${Math.round(ABSORB_MAX_QUEUE_AGE_MS / 60000)} דקות — לא ממשיכים אוטומטית`);
    hook('onStaleQueue', Object.assign(info, { stale: true, reason: 'stale' }));
    return false;
  }
  if (!force && absorbForeignPage(getPage(), st.queue[st.curIdx || 0])) {
    log('[המשך] הדף הזה אינו חלק מהקליטה: לא ממשיכים אוטומטית; "המשך" בפאנל ינווט');
    hook('onStaleQueue', Object.assign(info, { reason: 'foreign-page' }));
    return false;
  }
  if (!takeRunLock('המשך')) return false; // ממצא 5: התור נשאר שמור; ינסה שוב בטעינה הבאה או ב"המשך"

  S.queue = st.queue;
  S.results = Array.isArray(st.results) ? st.results : [];
  S.curIdx = st.curIdx || 0;
  S.lastRecordedIdx = S.curIdx - 1;
  S.startedAt = st.startedAt || null;
  S.pendingSave = st.pendingSave && typeof st.pendingSave === 'object' ? st.pendingSave : null;
  if (S.curIdx >= S.queue.length) { finishRun(); return false; }

  if (S.pendingSave && S.pendingSave.idx === S.curIdx) {
    S.justSaved = S.pendingSave.identity;
    log('[המשך] תלמיד חדש נשמר לפני הטעינה — נאמת ברשימה');
    saveAbsorbState();
  } else {
    S.pendingSave = null;
  }

  const landings = absorbBumpLandings(S.curIdx);
  log(`[המשך] שורה ${S.curIdx + 1}/${S.queue.length} · טעינה ${landings} · דף ${getPage().kind}`);
  if (landings > ABSORB_MAX_LANDINGS) {
    const stuck = S.queue[S.curIdx];
    log(`⚠️ תלמיד ${maskId(stuck.identity)} — ${landings} טעינות דף בלי סיום; מדלגים`);
    recordResult(makeAbsorbResult(stuck, ABSORB_STATUS.SKIPPED, `לולאת ניווט: ${landings} טעינות דף ללא התקדמות`, manualStudyTypeAction(stuck.branch, stuck.studyType)));
    if (S.curIdx >= S.queue.length) { finishRun(); return false; }
  }

  hook('onResume', S.queue, S.results, S.curIdx);
  S.running = true; // לפני ההמתנה — שלחיצת "התחל" בשנייה הזו לא תפתח ריצה מקבילה
  try {
    await sleep(900); // MS AJAX מסיים לאתחל
    await runQueue();
  } catch (e) {
    S.running = false;
    throw e;
  }
  return true;
}

export function absorbStop() {
  requestAbsorbStop();
  absorbNextGeneration();
  clearWatchdog();
  clearNavIntent(); // ממצא 7
  if (!S.running) {
    if (S.queue.length && S.curIdx < S.queue.length) {
      fillRemaining(ABSORB_STATUS.STOPPED, 'לא עובד (נעצר)', 'הרץ שוב את השורות שנותרו');
      finishRun();
    } else {
      clearAbsorbState();
      clearAbsorbStop();
      dropRunLock();
    }
  }
}
