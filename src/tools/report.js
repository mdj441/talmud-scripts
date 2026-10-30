// דיווח חודשי אוטומטי: הזרימה + הפונקציות הטהורות. הועבר מ"תלמוד - דיווח חודשי אוטומטי" v4.0.
// לכל סניף שבעץ-הצד: ניווט לדף המוסד (טעינה מלאה) → אימות שה-h1 מציג את הסניף → כפתור
// btnReport מנוטרל? "דולג (כבר דווח)" → אחרת: לשונית "מצב תמיכה" → postback של הכפתור דרך ה-href
// (בלי eval) → חלונית אזהרה → לחיצה על "המשך" בכוונה (זו פעולת הדיווח עצמה, כמו בישן) →
// חלונית הצלחה → סגירה → "נשלח". המצב ב-sessionStorage (talmud.report.state) והמשך אחרי טעינת דף.
// חדש מול הישן: "עצור" (נכנס לתוקף לפני הסניף הבא), חיווי "אם נתקע, רענן", רשת-ביטחון של 3 טעינות
// לסניף, בלי alert ובלי reload בסוף. אין גישה ל-document/window ברמת המודול.

import { $el, isVisible, sleep, waitFor } from '../core/dom.js';
import { log } from '../core/log.js';
import { waitPRM, firePostback } from '../core/prm.js';
import { readMessagePopup, hideMessagePopupAsync } from '../core/popup.js';
import { getPage, gotoInstitute, readBranchesFromTree, parsePostbackHref } from '../core/navigate.js';

export const REPORT_STATE_KEY = 'talmud.report.state';
export const REPORT_STATUS = {
  SENT: 'נשלח',
  SKIPPED: 'דולג (כבר דווח)',
  ERROR: 'שגיאה',
  STOPPED: 'נעצר',
};
export const REPORT_MAX_LANDINGS = 3; // טעינות-דף לאותו סניף; מעל זה: "שגיאה" והמשך
export const REPORT_STUCK_MS = 20000; // בלי צעד במשך זמן זה: "אם נתקע, רענן את הדף"
export const REPORT_IDS = {
  button: 'ContentPlaceHolder1_btnReport',
  supportTab: '__tab_ContentPlaceHolder1_tabInstituteDetails_TabInstituteEntitlement',
  popupContinue: 'ucMessagePopUp_btnMOK',
};
const REPORT_TSV_HEADER = ['סניף', 'סטטוס', 'פירוט', 'מה לעשות'];
const REPORT_PAGE_WAIT_MS = 15000; // כמו הישן: המתנה ל-h1 ולכפתור
const REPORT_POPUP_WAIT_MS = 10000; // כמו הישן: המתנה לחלונית
const REPORT_NAV_WATCHDOG_MS = 12000; // ניווט שלא הביא טעינת דף

function reportManualAction(branch) {
  return `פתח את דף המוסד של סניף ${branch}, לשונית "מצב תמיכה", ולחץ "שליחת דיווח חודשי" ידנית`;
}

// ─── טהורות ─────────────────────────────────────────────────────────────────

// האם כפתור הדיווח פעיל. הישן: disabled!=="true" וגם class בלי "disabled". כאן קצת רחב יותר:
// כל תכונת disabled (חוץ מ-"false"), ו-class שמכיל disabled בכל רישיות (ASP.NET: aspNetDisabled).
export function reportIsButtonEnabled(btn) {
  if (!btn || typeof btn !== 'object') return false;
  let attr = null;
  if (typeof btn.getAttribute === 'function') attr = btn.getAttribute('disabled');
  else attr = btn.disabled ? 'true' : null;
  if (attr !== null && attr !== undefined && String(attr).trim().toLowerCase() !== 'false') return false;
  const cls = String(btn.className == null ? '' : btn.className).toLowerCase();
  return cls.indexOf('disabled') === -1;
}

export function reportMakeResult(branch, status, detail, action) {
  return { branch: String(branch == null ? '' : branch), status, detail: detail || '', action: action || '' };
}

function reportFlatCell(value) {
  return String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ').trim();
}

// סיכום "נשלחו X, דולגו Y, שגיאות Z" (+ "נעצרו W" כשיש) ושורות "מה נשאר" לשגיאות ולנעצרים.
export function reportSummary(results) {
  const list = Array.isArray(results) ? results.filter((r) => r && typeof r === 'object') : [];
  const count = (status) => list.filter((r) => r.status === status).length;
  const sent = count(REPORT_STATUS.SENT);
  const skipped = count(REPORT_STATUS.SKIPPED);
  const errors = count(REPORT_STATUS.ERROR);
  const stopped = count(REPORT_STATUS.STOPPED);
  let summary = `נשלחו ${sent}, דולגו ${skipped}, שגיאות ${errors}`;
  if (stopped) summary += `, נעצרו ${stopped}`;
  const lines = list
    .filter((r) => r.status === REPORT_STATUS.ERROR || r.status === REPORT_STATUS.STOPPED)
    .map((r) => [`סניף ${r.branch}`, r.status, r.detail, r.action].map(reportFlatCell).filter(Boolean).join(' · '));
  return { sent, skipped, errors, stopped, total: list.length, summary, lines };
}

// TSV להדבקה באקסל (עם כותרת).
export function reportBuildTsv(results) {
  const lines = [REPORT_TSV_HEADER.join('\t')];
  for (const r of Array.isArray(results) ? results : []) {
    if (!r) continue;
    lines.push([r.branch, r.status, r.detail, r.action].map(reportFlatCell).join('\t'));
  }
  return lines.join('\n');
}

// מונה טעינות לסניף הנוכחי: {idx, count}. סניף אחר מאפס.
export function reportBumpLandings(rec, idx) {
  const same = rec && typeof rec === 'object' && rec.idx === idx;
  return { idx, count: same ? (Number(rec.count) || 0) + 1 : 1 };
}

// האם עבר יותר מדי זמן מאז הצעד האחרון.
export function reportIsStuck(lastStepAt, now, thresholdMs) {
  const t = typeof lastStepAt === 'number' ? lastStepAt : Number(lastStepAt);
  if (!lastStepAt || !Number.isFinite(t)) return false;
  const n = typeof now === 'number' ? now : Date.now();
  const th = typeof thresholdMs === 'number' ? thresholdMs : REPORT_STUCK_MS;
  return n - t > th;
}

// האינדקס הבא לביצוע מתוך מצב שמור; -1 כשאין (סיום או מצב לא תקין).
export function reportNextIndexToRun(state) {
  if (!state || !Array.isArray(state.branches) || !state.branches.length) return -1;
  const idx = Number.isFinite(Number(state.curIdx)) ? Math.max(0, Math.floor(Number(state.curIdx))) : 0;
  return idx < state.branches.length ? idx : -1;
}

// טקסט הודעה שנראה ככישלון (אחרי "המשך"). הישן סימן "נשלח" בלי לקרוא; כאן קוראים כדי לא לשקר.
export function reportPopupLooksLikeFailure(text) {
  return /שגיאה|נכשל|לא הצליח|לא ניתן|לא בוצע/.test(String(text == null ? '' : text));
}

// ─── מצב חי + sessionStorage ────────────────────────────────────────────────

export const reportLive = { running: false, stop: false, hooks: {}, lastStepAt: null, lastResults: [] };

export function reportSetHooks(hooks) { reportLive.hooks = hooks || {}; }
function reportHook(name, ...args) { try { if (reportLive.hooks[name]) reportLive.hooks[name](...args); } catch (e) { /* אצווה לא נתקעת */ } }

export function reportLoadState() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(REPORT_STATE_KEY) || 'null');
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.branches) ? parsed : null;
  } catch (e) {
    return null;
  }
}

// שומר; דגל העצירה שכבר נשמר (מהלשונית או מטעינה אחרת) לעולם לא נדרס.
export function reportSaveState(state) {
  try {
    const stored = reportLoadState();
    if (stored && stored.stop === true) state.stop = true;
    sessionStorage.setItem(REPORT_STATE_KEY, JSON.stringify(state));
  } catch (e) { log('[דיווח] שמירת המצב נכשלה: ' + (e && e.message)); }
}

export function reportClearState() {
  try { sessionStorage.removeItem(REPORT_STATE_KEY); } catch (e) { /* אצווה לא נתקעת */ }
}

export function reportHasPendingRun() {
  const st = reportLoadState();
  return !!(st && st.running && reportNextIndexToRun(st) !== -1);
}

// "רץ" גם כשממתינים לטעינת דף (כדי ש-Escape/"עצור" יעבדו באמצע ניווט).
export function reportIsRunning() {
  return reportLive.running || reportHasPendingRun();
}

export function reportGetResults() {
  const st = reportLoadState();
  if (st && Array.isArray(st.results)) return st.results.slice();
  return reportLive.lastResults.slice();
}

export function reportLastStepAt() {
  if (reportLive.lastStepAt) return reportLive.lastStepAt;
  const st = reportLoadState();
  return st && st.lastStepAt ? st.lastStepAt : null;
}

function reportTouch(state) {
  state.lastStepAt = Date.now();
  reportLive.lastStepAt = state.lastStepAt;
}

function reportStopRequested(state) {
  if (reportLive.stop || (state && state.stop === true)) return true;
  const stored = reportLoadState();
  return !!(stored && stored.stop === true);
}

// "עצור": מסמן דגל במצב השמור. הריצה נעצרת לפני הסניף הבא (לא באמצע שליחה).
// אם אין ריצה חיה בדף הזה אך יש מצב שמור (למשל טעינה שלא הגיעה): מסיימים כאן.
export function reportRequestStop() {
  reportLive.stop = true;
  log('⛔ בקשת עצירה: הריצה תיעצר לפני הסניף הבא');
  const st = reportLoadState();
  if (st) { st.stop = true; reportSaveState(st); }
  if (!reportLive.running && st && st.running) {
    reportFillRemaining(st);
    reportFinish(st);
  }
}

// ─── רישום תוצאות וסיום ─────────────────────────────────────────────────────

function reportRecord(state, idx, result) {
  state.results = Array.isArray(state.results) ? state.results : [];
  state.results.push(result);
  state.curIdx = idx + 1;
  state.landings = null;
  state.pendingSend = null;
  reportTouch(state);
  reportSaveState(state);
  log(`◀ סניף ${result.branch}: ${result.status}${result.detail ? ' · ' + result.detail : ''}`);
  reportHook('onResult', result, state.results.slice());
}

function reportFillRemaining(state) {
  state.results = Array.isArray(state.results) ? state.results : [];
  let idx = reportNextIndexToRun(state);
  while (idx !== -1) {
    state.results.push(reportMakeResult(state.branches[idx], REPORT_STATUS.STOPPED, 'נעצר לפני השליחה', 'הרץ שוב; סניפים שכבר דווחו ידולגו אוטומטית'));
    state.curIdx = idx + 1;
    idx = reportNextIndexToRun(state);
  }
  reportSaveState(state);
}

function reportFinish(state) {
  reportLive.running = false;
  reportLive.stop = false;
  reportLive.lastResults = Array.isArray(state.results) ? state.results.slice() : [];
  reportClearState();
  const summary = reportSummary(reportLive.lastResults);
  log(`═══ סיום דיווח חודשי · ${summary.summary}`);
  reportHook('onDone', reportLive.lastResults.slice(), summary);
}

// ─── צעדים מול הדף ──────────────────────────────────────────────────────────

async function reportWaitPopup(predicate) {
  try {
    return await waitFor(() => {
      const pop = readMessagePopup();
      if (!pop) return false;
      return predicate && !predicate(pop) ? false : pop;
    }, { timeout: REPORT_POPUP_WAIT_MS, interval: 100 });
  } catch (e) {
    return null;
  }
}

async function reportHidePopup() {
  const hid = hideMessagePopupAsync();
  if (hid.wait) await hid.wait;
  try { await waitFor(() => !readMessagePopup(), { timeout: 5000, interval: 100 }); } catch (e) { /* ממשיכים */ }
  await sleep(400); // כמו הישן
}

function reportOnRightPage(branch) {
  const page = getPage();
  return page.kind === 'institute' && page.branch === branch;
}

// ניווט לסניף. טעינה מלאה הורגת את ההקשר (ההמשך ב-mount); רינדור-במקום ממשיך כאן.
// מחזיר null כשהדף מתאים, או תוצאת-שגיאה.
async function reportEnsureBranchPage(state, idx, branch) {
  if (reportOnRightPage(branch)) return null;
  const landings = reportBumpLandings(state.landings, idx);
  state.landings = landings;
  if (landings.count > REPORT_MAX_LANDINGS) {
    return reportMakeResult(branch, REPORT_STATUS.ERROR, `הדף לא הגיע לסניף ${branch} אחרי ${REPORT_MAX_LANDINGS} טעינות`, reportManualAction(branch));
  }
  reportTouch(state);
  reportSaveState(state);
  reportHook('onNavigating', branch);
  log(`[ניווט] → סניף ${branch} (טעינה ${landings.count}/${REPORT_MAX_LANDINGS})`);
  const res = await gotoInstitute(branch);
  if (!res || res.ok === false) {
    if (res && res.notFound) return reportMakeResult(branch, REPORT_STATUS.ERROR, res.reason, `ודא שסניף ${branch} מופיע בעץ-הצד, ושלח ידנית`);
    return reportMakeResult(branch, REPORT_STATUS.ERROR, (res && res.reason) || 'הניווט נכשל', reportManualAction(branch));
  }
  const t0 = Date.now();
  while (Date.now() - t0 < REPORT_NAV_WATCHDOG_MS) {
    await sleep(200);
    if (reportOnRightPage(branch)) { log('[ניווט] הדף התעדכן בלי טעינה מלאה: ממשיכים במקום'); return null; }
  }
  return reportMakeResult(branch, REPORT_STATUS.ERROR, `הניווט לסניף ${branch} לא הביא טעינת דף תוך ${Math.round(REPORT_NAV_WATCHDOG_MS / 1000)} שניות`, reportManualAction(branch));
}

async function reportFireButton(btn) {
  const pb = parsePostbackHref(btn.getAttribute('href') || '');
  const opts = { startTimeoutMs: 3000, totalTimeoutMs: 20000 };
  if (pb) return firePostback(pb.target, pb.arg, opts);
  const wait = waitPRM(opts); // (1) נרשם קודם
  setTimeout(() => { try { btn.click(); } catch (e) { log('[דיווח] לחיצה על הכפתור נכשלה: ' + (e && e.message)); } }, 0); // (2) נדחה
  return wait;
}

// סניף אחד. מחזיר תוצאה. ניווט שמביא טעינה מלאה לא חוזר (הדף נפרק).
async function reportProcessBranch(state, idx, branch) {
  const mk = (status, detail, action) => reportMakeResult(branch, status, detail, action);

  const navFail = await reportEnsureBranchPage(state, idx, branch);
  if (navFail) return navFail;

  // כמו הישן: המתנה לכפתור (ה-h1 כבר אומת), ואז שנייה חצי להתייצבות
  let btn = null;
  try { btn = await waitFor(() => $el(REPORT_IDS.button), { timeout: REPORT_PAGE_WAIT_MS, interval: 200 }); } catch (e) { btn = null; }
  if (!btn) return mk(REPORT_STATUS.ERROR, 'כפתור "שליחת דיווח חודשי" לא נמצא בדף המוסד', `בדוק שבדף המוסד של סניף ${branch} יש לשונית "מצב תמיכה" עם כפתור הדיווח, ושלח ידנית`);
  await sleep(500);

  // "המשך" נלחץ ואז הדף נטען מחדש: האמת בכפתור
  if (state.pendingSend && state.pendingSend.idx === idx) {
    state.pendingSend = null;
    if (!reportIsButtonEnabled(btn)) { log('[דיווח] אחרי "המשך" הדף נטען מחדש והכפתור מנוטרל → נשלח'); return mk(REPORT_STATUS.SENT, 'אומת אחרי טעינת הדף: כפתור הדיווח מנוטרל'); }
    return mk(REPORT_STATUS.ERROR, 'נלחץ "המשך" אך אחרי טעינת הדף כפתור הדיווח עדיין פעיל', `בדוק בדף המוסד של סניף ${branch} אם הדיווח נשלח; אם לא, שלח ידנית`);
  }

  if (!reportIsButtonEnabled(btn)) {
    log(`[דיווח] סניף ${branch}: כפתור הדיווח מנוטרל, כבר דווח`);
    return mk(REPORT_STATUS.SKIPPED, 'כפתור הדיווח מנוטרל');
  }
  if (reportStopRequested(state)) return mk(REPORT_STATUS.STOPPED, 'נעצר לפני השליחה', 'הרץ שוב; סניפים שכבר דווחו ידולגו אוטומטית');

  // לשונית "מצב תמיכה" (חובה לפני השליחה, כמו הישן: קליק צד-לקוח)
  const tab = $el(REPORT_IDS.supportTab);
  if (tab) { try { tab.click(); } catch (e) { /* לא קריטי */ } } else log('[דיווח] לשונית "מצב תמיכה" לא נמצאה; מנסים לשלוח בכל זאת');
  await sleep(300);
  reportTouch(state);
  reportSaveState(state);

  // postback של הכפתור דרך ה-href (הישן: eval; כאן parsePostbackHref + firePostback)
  log(`[דיווח] סניף ${branch}: לוחצים "שליחת דיווח חודשי"`);
  const fired = await reportFireButton(btn);
  if (fired && fired.ok === false) log(`[דיווח] postback הכפתור: ${fired.reason}`);

  // חלונית האזהרה עם "המשך"
  const confirm = await reportWaitPopup();
  if (!confirm) return mk(REPORT_STATUS.ERROR, 'לא הופיעה חלונית אחרי לחיצה על "שליחת דיווח חודשי"', reportManualAction(branch));
  log(`[הודעה] "${confirm.text}" [${confirm.buttons.join(', ')}]`);
  if (!confirm.hasContinue) {
    await reportHidePopup();
    if (confirm.kind === 'success') return mk(REPORT_STATUS.SENT, confirm.text);
    return mk(REPORT_STATUS.ERROR, confirm.text || 'האתר החזיר הודעה בלי "המשך"', reportManualAction(branch));
  }

  // לחיצה על "המשך" בכוונה: זו פעולת הדיווח עצמה (הסקריפט הישן v4.0 עושה זאת, שורה 110).
  await sleep(200);
  const contBtn = $el(REPORT_IDS.popupContinue);
  if (!isVisible(contBtn)) return mk(REPORT_STATUS.ERROR, 'כפתור "המשך" בחלונית לא זמין', reportManualAction(branch));
  state.pendingSend = { idx, branch };
  reportTouch(state);
  reportSaveState(state); // "המשך" עלול לטעון דף מחדש; ההמשך יאמת לפי הכפתור
  log(`[דיווח] סניף ${branch}: לוחצים "המשך" (אישור שליחת הדיווח)`);
  const contWait = waitPRM({ startTimeoutMs: 3000, totalTimeoutMs: 20000 }); // (1) נרשם קודם
  setTimeout(() => { try { contBtn.click(); } catch (e) { log('[דיווח] לחיצת "המשך" נכשלה: ' + (e && e.message)); } }, 0); // (2) נדחה
  const contRes = await contWait;
  if (contRes && contRes.ok === false) log(`[דיווח] postback של "המשך": ${contRes.reason}`);

  // חלונית ההצלחה ("אישור" בלבד): ממתינים לחלונית שאינה חלונית האזהרה
  const done = await reportWaitPopup((pop) => pop.text !== confirm.text || !pop.hasContinue);
  state.pendingSend = null;
  if (!done) {
    return mk(REPORT_STATUS.ERROR, 'לא הופיעה הודעת הצלחה תוך 10 שניות אחרי "המשך"', `בדוק בדף המוסד של סניף ${branch} אם כפתור הדיווח הפך מנוטרל (סימן שנשלח); אם לא, שלח ידנית`);
  }
  log(`[הודעה] "${done.text}" [${done.buttons.join(', ')}]`);
  if (done.hasContinue && done.kind !== 'success') {
    // בקשת-אישור נוספת שאינה מוכרת: לא לוחצים לבד
    return mk(REPORT_STATUS.ERROR, `המערכת מבקשת אישור נוסף: "${done.text}"`, `פתח את דף המוסד של סניף ${branch}, קרא את ההודעה והחלט ידנית`);
  }
  await sleep(200);
  await reportHidePopup();
  if (done.kind !== 'success' && reportPopupLooksLikeFailure(done.text)) {
    return mk(REPORT_STATUS.ERROR, done.text, reportManualAction(branch));
  }
  return mk(REPORT_STATUS.SENT, done.text);
}

// ─── הלולאה ─────────────────────────────────────────────────────────────────

// מריץ סניף אחרי סניף מתוך המצב השמור. ניווט מלא פורק את הדף; ההמשך ב-reportResumeIfPending.
export async function reportRunLoop() {
  const state = reportLoadState();
  if (!state || !state.running) { reportLive.running = false; return false; }
  reportLive.running = true;
  reportHook('onStart', state.branches.slice(), reportNextIndexToRun(state));
  for (;;) {
    const idx = reportNextIndexToRun(state);
    if (idx === -1) { reportFinish(state); return true; }
    if (reportStopRequested(state)) {
      log('⛔ נעצר: הסניפים שנותרו מסומנים "נעצר"');
      reportFillRemaining(state);
      reportFinish(state);
      return true;
    }
    const branch = state.branches[idx];
    reportHook('onProgress', idx, state.branches.length, branch);
    let result;
    try {
      result = await reportProcessBranch(state, idx, branch);
    } catch (e) {
      log(`[דיווח] תקלה בסניף ${branch}: ${e && e.message}`);
      result = reportMakeResult(branch, REPORT_STATUS.ERROR, `תקלה: ${(e && e.message) || 'לא ידועה'}`, reportManualAction(branch));
    }
    reportRecord(state, idx, result);
    await sleep(400);
  }
}

// "התחל": אוסף את הסניפים מעץ-הצד ומתחיל. מחזיר {ok, count} או {ok:false, reason}.
export async function reportStart() {
  if (reportIsRunning()) return { ok: false, reason: 'ריצה כבר פעילה' };
  const branches = readBranchesFromTree();
  if (!branches.length) return { ok: false, reason: 'לא נמצאו סניפים בעץ-הצד. ודא שאתה בדף פרטי מוסד' };
  reportLive.stop = false;
  reportLive.lastResults = [];
  const state = {
    running: true, branches, curIdx: 0, results: [], stop: false, landings: null, pendingSend: null,
    startedAt: new Date().toISOString(), lastStepAt: Date.now(),
  };
  reportClearState(); // דגל עצירה ישן לא ייקלט לתוך הריצה החדשה
  reportSaveState(state);
  reportLive.lastStepAt = state.lastStepAt;
  log(`🚀 דיווח חודשי: ${branches.length} סניפים (${branches.join(', ')})`);
  await reportRunLoop();
  return { ok: true, count: branches.length };
}

// בטעינת דף: אם יש מצב שמור, ממשיכים (כמו הישן: המתנה ל-h1, ואז הצעד הבא).
export async function reportResumeIfPending() {
  if (reportLive.running) return false;
  const state = reportLoadState();
  if (!state || !state.running) return false;
  if (reportNextIndexToRun(state) === -1) { reportFinish(state); return true; }
  if (reportStopRequested(state)) {
    log('⛔ דגל עצירה במצב השמור: הסניפים שנותרו מסומנים "נעצר"');
    reportFillRemaining(state);
    reportFinish(state);
    return true;
  }
  reportLive.running = true; // לפני ההמתנה, כדי ש"התחל" לא יפתח ריצה מקבילה
  reportLive.lastStepAt = state.lastStepAt || Date.now();
  reportHook('onResume', state);
  try {
    await waitFor(() => {
      const h1 = document.querySelector('h1');
      return !!(h1 && String(h1.textContent || '').trim().length > 3);
    }, { timeout: REPORT_PAGE_WAIT_MS, interval: 200 });
  } catch (e) { /* הצעד עצמו ינווט או ידווח שגיאה */ }
  await sleep(900); // MS AJAX מסיים לאתחל
  log(`[המשך] סניף ${reportNextIndexToRun(state) + 1}/${state.branches.length} · דף ${getPage().kind}`);
  return reportRunLoop();
}
