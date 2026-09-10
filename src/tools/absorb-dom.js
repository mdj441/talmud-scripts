// קליטה — נגיעות ב-DOM של האתר: מזהי הפקדים, כתיבה לשדות בסדר-postback קשיח, חיפוש עם
// עדות-טריות, חלונית ההודעה, מודאל הקליטה, דף תלמיד-חדש. כל postback עובר דרך prm.js.
// אין גישה ל-document/window ברמת המודול.

import { $el, isVisible, sleep } from '../core/dom.js';
import { firePostback, waitPRM } from '../core/prm.js';
import { readMessagePopup, hideMessagePopupAsync } from '../core/popup.js';
import { log, maskId, maskIdsInText } from '../core/log.js';
import { getPage } from '../core/navigate.js';
import { absorbParseCount, absorbParsePostbackFromHref, absorbNormalizeId } from './absorb-report.js';
import { checkStop, sleepCheckStop } from './absorb-state.js';

const BASE = 'ContentPlaceHolder1_tabStudyTypeDetails_StudentList_ucStudentsSearchDetails';
export const ABSORB_IDS = {
  tabContainer: 'ContentPlaceHolder1_tabStudyTypeDetails', // טאב 2 = רשימת תלמידים
  searchInput: `${BASE}_txtStudenPassport`,
  searchBtn: `${BASE}_btnSearch`,
  countLabel: `${BASE}_lblCountSearch`,
  grid: `${BASE}_gvIStudents`, // עמודה 3 = ת.ז./דרכון
  absorbBtn: 'ContentPlaceHolder1_btnStudentAcceptence3',
  modal: `${BASE}_pnlAcceptStudent`,
  idTypeDdl: `${BASE}_ddlPopIdentityType`, // 1=ת.ז. 2=דרכון
  modalId: `${BASE}_txtIdentifier`,
  birthDate: `${BASE}_ctlBirthDate_txtDate`,
  countryDdl: `${BASE}_ddlCountryOfOrigine`,
  startDate: `${BASE}_ctlAcceptanceDate_txtDate`,
  confirmBtn: `${BASE}_LinkButton1`,
  cancelBtn: `${BASE}_LinkButton2`,
};

const NEW_BASE = 'ContentPlaceHolder1_TabsStudent_StudentDetails1_ucStudentDetails';
export const ABSORB_NEW_IDS = {
  firstName: `${NEW_BASE}_txtFirstName`,
  lastName: `${NEW_BASE}_txtLastName`,
  birthDate: `${NEW_BASE}_ctlBirthDate_txtDate`,
  idField: `${NEW_BASE}_txtID`,
  gender: `${NEW_BASE}_ddlGender`,
  familyStatus: `${NEW_BASE}_ddlFamilyStatus`,
  stateHidden: `${NEW_BASE}_hidStudentState`,
  saveBtn: 'ContentPlaceHolder1_btnSave',
};

export const ABSORB_GENDER_LABELS = { '1': 'זכר', '2': 'נקבה' };
export const ABSORB_FAMILY_STATUS_LABELS = { '10': 'רווק', '20': 'נשוי', '30': 'גרוש', '40': 'אלמן' };

const FIELD_WAIT = { startTimeoutMs: 400, totalTimeoutMs: 8000 };
const SELECT_WAIT = { startTimeoutMs: 1000, totalTimeoutMs: 10000 };
const POPUP_HIDE_MS = 5000;
const STALE_ATTR = 'data-absorb-stale';

// כתיבה לשדה = פוטנציאלית postback (AutoPostBack). רושמים המתנה קודם, כותבים מ-setTimeout(0).
export function absorbSetAndWait(el, value, opts) {
  const o = opts || {};
  const wait = waitPRM(o.opts || (o.select ? SELECT_WAIT : FIELD_WAIT));
  setTimeout(() => {
    try {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (!o.select) el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (e) {
      log('[שדה] כתיבה נכשלה: ' + (e && e.message));
    }
  }, 0);
  return wait;
}

// בחירה ב-<select> עם אימות שהאופציה קיימת לפני, ושהערך נתפס אחרי.
export async function absorbSelectOption(el, value, label, display) {
  const shown = display || value;
  const options = Array.from((el && el.options) || []);
  if (!options.some((o) => o.value === value)) {
    return { ok: false, reason: `הערך "${shown}" בעמודת "${label}" (קוד ${value}) לא קיים ברשימת האתר` };
  }
  await absorbSetAndWait(el, value, { select: true });
  if (el.value !== value) return { ok: false, reason: `בחירת "${shown}" בעמודת "${label}" נכשלה` };
  return { ok: true };
}

// לחיצה על פקד: postback דרך ה-href אם יש, אחרת click נדחה אחרי רישום ההמתנה.
export function absorbFireElement(el, opts) {
  const href = (el && typeof el.getAttribute === 'function' && el.getAttribute('href')) || '';
  const pb = absorbParsePostbackFromHref(href);
  if (pb && pb.target) return firePostback(pb.target, pb.arg, opts);
  const wait = waitPRM(opts);
  setTimeout(() => {
    try { el.click(); } catch (e) { log('[postback] כשל בלחיצה: ' + (e && e.message)); }
  }, 0);
  return wait;
}

// ולידטורי צד-לקוח של קבוצה (במקום WebForm_DoPostBackWithOptions שעוקפים).
export function absorbRunClientValidation(group) {
  try {
    if (typeof window === 'undefined' || typeof window.Page_ClientValidate !== 'function') return { ok: true, messages: [] };
    if (window.Page_ClientValidate(group || '')) return { ok: true, messages: [] };
    try { window.Page_BlockSubmit = false; } catch (e) { /* noop */ }
    return { ok: false, messages: absorbCollectValidationMessages(group) };
  } catch (e) {
    return { ok: true, messages: [] };
  }
}

export function absorbCollectValidationMessages(group) {
  const out = [];
  try {
    const validators = (typeof window !== 'undefined' && window.Page_Validators) || [];
    for (const v of validators) {
      if (!v || v.isvalid !== false) continue;
      if (group && v.validationgroup && v.validationgroup !== group) continue;
      const txt = String(v.errormessage || v.textContent || '').trim();
      if (txt) out.push(txt.slice(0, 120));
    }
  } catch (e) { /* ממשיכים לסריקת ה-DOM */ }
  if (!out.length) {
    try {
      const nodes = document.querySelectorAll('[id*="lblError"],[id*="lblMessage"],[class*="error"],[class*="validator"]');
      for (const el of Array.from(nodes)) {
        const txt = (el.textContent || '').trim();
        if (txt && isVisible(el)) out.push(txt.slice(0, 120));
      }
    } catch (e) { /* אין מה להוסיף */ }
  }
  return out.slice(0, 3);
}

// טאב 2 "רשימת תלמידים" בדף סוג-הלימוד.
export function absorbActivateStudentsTab() {
  try {
    if (typeof window === 'undefined' || typeof window.$find !== 'function') return false;
    const tabs = window.$find(ABSORB_IDS.tabContainer);
    if (tabs && typeof tabs.set_activeTabIndex === 'function' && tabs.get_activeTabIndex() !== 2) {
      tabs.set_activeTabIndex(2);
      return true;
    }
  } catch (e) { /* הפקדים בדרך כלל כבר ב-DOM */ }
  return false;
}

// ─── חיפוש עם עדות-טריות: מסמנים את אזור-התוצאות "ישן" לפני, postback מחליף את האלמנטים ─
function markStale(el) {
  try { if (el && typeof el.setAttribute === 'function') el.setAttribute(STALE_ATTR, '1'); } catch (e) { /* noop */ }
}
function isStale(el) {
  try { return !!(el && typeof el.getAttribute === 'function' && el.getAttribute(STALE_ATTR) === '1'); } catch (e) { return false; }
}

export function readAbsorbGridRows() {
  const grid = $el(ABSORB_IDS.grid);
  if (!grid || typeof grid.querySelectorAll !== 'function' || isStale(grid)) return [];
  return Array.from(grid.querySelectorAll('tr')).map(
    (tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim())
  );
}

function readCountText() {
  const el = $el(ABSORB_IDS.countLabel);
  return el ? (el.textContent || '').trim() : '';
}

function searchFreshness() {
  const countEl = $el(ABSORB_IDS.countLabel);
  const gridEl = $el(ABSORB_IDS.grid);
  const countFresh = !!countEl && !isStale(countEl);
  const gridFresh = !!gridEl && !isStale(gridEl);
  return { countFresh, gridFresh, refreshed: countFresh && (gridEl ? gridFresh : true) };
}

async function searchOnce(input, btn, value, gen) {
  markStale($el(ABSORB_IDS.grid));
  markStale($el(ABSORB_IDS.countLabel));
  await absorbSetAndWait(input, value);
  await sleepCheckStop(120, gen);
  const res = await absorbFireElement(btn, { startTimeoutMs: 3000, totalTimeoutMs: 20000 });
  await sleepCheckStop(250, gen);
  const countText = readCountText();
  const count = absorbParseCount(countText);
  const started = !!(res && res.started);
  const ok = !!(res && res.ok);
  const fresh = searchFreshness();
  const executed = started && ok && (fresh.countFresh || fresh.gridFresh);
  log(`[חיפוש] ${maskId(value)} → ${countText || '(ללא תווית ספירה)'} · started=${started} ok=${ok} countFresh=${fresh.countFresh} gridFresh=${fresh.gridFresh}`);
  return { ok, started, executed, refreshed: fresh.refreshed, countFresh: fresh.countFresh, countText, count, reason: res && res.reason };
}

// חיפוש עם ניסיון-חוזר אחד כשאין עדות שהוא רץ.
export async function absorbSearch(input, btn, value, gen) {
  let res = await searchOnce(input, btn, value, gen);
  if (res.executed) return res;
  log('[חיפוש] אין עדות שהחיפוש רץ — ניסיון נוסף');
  await sleepCheckStop(500, gen);
  res = await searchOnce(input, btn, value, gen);
  if (!res.executed) log('[חיפוש] גם הניסיון השני לא הופעל');
  return res;
}

export const ABSORB_SEARCH_FAILED_ACTION = 'החיפוש ברשימת התלמידים לא הופעל. רענן את הדף, ודא שהלשונית "רשימת תלמידים" נפתחת, והרץ שוב את השורה';
export const ABSORB_GRID_STALE_ACTION = 'החיפוש לא רענן את הרשימה. חפש את המזהה ידנית ברשימת התלמידים: אם קיים, אין מה לעשות; אם לא, הרץ שוב את השורה';

export function absorbSearchFailReason(res) {
  if (!res) return 'החיפוש לא הופעל';
  if (!res.started) return 'לחיצת החיפוש לא הפעילה בקשה לשרת' + (res.reason ? ` (${res.reason})` : '');
  if (!res.ok) return 'החיפוש נכשל או פג-זמן בשרת' + (res.reason ? ` (${res.reason})` : '');
  if (res.countFresh === false) return 'תווית הספירה לא התרעננה — מה שמוצג אינו תוצאת החיפוש הזה';
  return 'החיפוש רץ אך תוצאותיו לא התעדכנו בדף';
}

export function absorbCountGate(res) {
  return res && res.countFresh ? res.count : null;
}

// ─── חלונית ההודעה ──────────────────────────────────────────────────────────

export async function absorbHidePopup(gen) {
  const hide = hideMessagePopupAsync();
  if (hide && hide.wait) {
    await Promise.race([hide.wait, sleep(POPUP_HIDE_MS)]);
    await sleepCheckStop(150, gen);
  }
  if (hide && !hide.hidden) log('[הודעה] לא נמצאה דרך לסגור את החלונית בלי ללחוץ "המשך" — ממשיכים');
  return hide;
}

export function absorbLogPopup(where, pop) {
  const buttons = Array.isArray(pop.buttons) ? pop.buttons.join(', ') : '';
  log(`[הודעה] ${where}: ${maskIdsInText(pop.text)} · סוג=${pop.kind || '?'} · כפתורים=[${buttons}]`);
}

// קורא חלונית אם יש, סוגר אותה, ומחזיר {pop, blocked} — blocked = בקשת-אישור ("המשך" שאינו הצלחה).
export async function absorbReadAndHidePopup(where, gen) {
  const pop = readMessagePopup();
  if (!pop) return { pop: null, blocked: false };
  absorbLogPopup(where, pop);
  await absorbHidePopup(gen);
  const blocked = !!pop.hasContinue && pop.kind !== 'success';
  if (pop.kind === 'success') log('[הודעה] הודעת-הצלחה — ממשיכים לאימות בגריד');
  await sleepCheckStop(200, gen);
  return { pop, blocked };
}

// ─── מודאל הקליטה ───────────────────────────────────────────────────────────

export function absorbModalVisible() {
  return isVisible($el(ABSORB_IDS.modal));
}

export async function absorbCloseAcceptModal() {
  try {
    const cancel = $el(ABSORB_IDS.cancelBtn);
    if (!cancel || !absorbModalVisible()) return false;
    await absorbFireElement(cancel, { startTimeoutMs: 1500, totalTimeoutMs: 15000 });
    await sleep(250);
    return true;
  } catch (e) {
    log('[מודאל] סגירת חלון הקליטה נכשלה: ' + (e && e.message));
    return false;
  }
}

// ─── דף תלמיד-חדש ───────────────────────────────────────────────────────────

export function absorbNewStudentPageMatches(identity) {
  const el = $el(ABSORB_NEW_IDS.idField);
  const val = el ? String(el.value || '').trim() : '';
  return !!val && absorbNormalizeId(val) === absorbNormalizeId(identity);
}

// ממתין לסיום ה-postback (או לתקציב). ניווט מלא מפרק את הדף — הריצה ממשיכה אחרי הטעינה.
export async function absorbWaitOutcome(prmWait, budgetMs, gen) {
  let prmResult = null;
  prmWait.then((r) => { prmResult = r || { ok: true }; });
  const kindBefore = getPage().kind;
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs + 2000) {
    checkStop('outcome-wait', gen);
    if (prmResult) { await sleep(250); return { kind: 'prm', result: prmResult }; }
    if (getPage().kind !== kindBefore) return { kind: 'pageChanged' };
    await sleep(150);
  }
  return { kind: 'timeout' };
}
