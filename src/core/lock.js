// נעילת-ריצה בין לשוניות ובין כלים (ממצא 5): ההקשר צד-השרת של תלמו"ד משותף לכל הלשוניות ("המוסד הנוכחי"
// נקבע בלחיצה האחרונה בעץ, לא בכתובת; דף תלמיד-חדש נפתח בלי פרמטרים), ולכן שתי ריצות במקביל משבשות זו
// את זו: גם בשתי לשוניות-דפדפן, וגם שני כלים (למשל קליטה ועזיבה) באותה לשונית. הנעילה ב-localStorage
// (משותף ללשוניות): { tab: מזהה-לשונית, tool: מזהה-הכלי, at: Date.now() }. הכלי הרץ מרענן אותה כל כמה
// שניות; נעילה שלא רועננה RUN_LOCK_TTL_MS נחשבת מתה (לשונית שנסגרה באמצע). מזהה-הלשונית נשמר
// ב-sessionStorage (פר-לשונית). "שלי" = אותה לשונית ואותו כלי. הלוגיקה הטהורה (runLockState) נפרדת. אין DOM כאן.
// סקירה סופית 1.11.2026: עד עכשיו רק הקליטה נעלה; עזיבה, דיווח והודעות רצו בלי נעילה (README הבטיח "ריצה אחת
// בכל פעם" לכל הלשוניות). עכשיו כל ארבעת הכלים עוברים דרך holdRunLock / dropRunLock.

export const RUN_LOCK_KEY = 'talmud.absorb.lock';
export const RUN_LOCK_TTL_MS = 10000;
export const RUN_LOCK_REFRESH_MS = 3000;
const TAB_ID_KEY = 'talmud.tabId';

// שמות הכלים להודעה למשתמש (אותם נוסחים כמו בלשוניות החלונית).
export const RUN_LOCK_TOOL_TITLES = { absorb: 'קליטת תלמידים', depart: 'עזיבת תלמידים', report: 'דיווח חודשי', messages: 'הודעות' };

// טהורה: האם הנעילה חיה (טרייה מ-TTL) והאם היא שלי (אותה לשונית; ואם נרשם כלי, גם אותו כלי).
export function runLockState(lock, tabId, now, ttlMs, tool) {
  const dead = { live: false, mine: false };
  if (!lock || typeof lock !== 'object') return dead;
  const at = typeof lock.at === 'number' ? lock.at : NaN;
  if (Number.isNaN(at)) return dead;
  const ttl = typeof ttlMs === 'number' ? ttlMs : RUN_LOCK_TTL_MS;
  const nowMs = typeof now === 'number' ? now : Date.now();
  if (nowMs - at > ttl) return dead;
  const sameTab = !!tabId && lock.tab === tabId;
  const sameTool = !tool || !lock.tool || lock.tool === tool;
  return { live: true, mine: sameTab && sameTool };
}

// טהורה: ההודעה למשתמש כשנעילה חיה של מישהו אחר חוסמת. מבחינה בין "באותה לשונית" (כלי אחר בחלונית הזו)
// ל"בלשונית אחרת של הדפדפן".
export function runLockBusyMessage(lock, tabId) {
  const title = lock && lock.tool && RUN_LOCK_TOOL_TITLES[lock.tool] ? `"${RUN_LOCK_TOOL_TITLES[lock.tool]}"` : '';
  const what = title ? `ריצה של ${title} פעילה` : 'ריצה פעילה';
  if (lock && tabId && lock.tab === tabId) return `${what} בחלונית הזו. עצור אותה ("עצור" או Escape) או המתן לסיומה`;
  return `${what} בלשונית אחרת של תלמו"ד בדפדפן. עצור אותה שם או המתן לסיומה`;
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// מזהה-לשונית אקראי, יציב בתוך הלשונית (sessionStorage). בלי אחסון: מזהה לזמן-הריצה בלבד.
let memoTabId = null;
export function currentTabId() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      let id = sessionStorage.getItem(TAB_ID_KEY);
      if (!id) { id = randomId(); sessionStorage.setItem(TAB_ID_KEY, id); }
      return id;
    }
  } catch (e) { /* ממשיכים לזיכרון */ }
  if (!memoTabId) memoTabId = randomId();
  return memoTabId;
}

export function readRunLock() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const parsed = JSON.parse(localStorage.getItem(RUN_LOCK_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

function writeRunLock(tool) {
  try {
    if (typeof localStorage === 'undefined') return true; // בלי אחסון משותף אין לשוניות אחרות
    const rec = { tab: currentTabId(), at: Date.now() };
    if (tool) rec.tool = String(tool);
    localStorage.setItem(RUN_LOCK_KEY, JSON.stringify(rec));
    return true;
  } catch (e) {
    return true; // כשל-אחסון לא עוצר ריצה ("אצווה לא נתקעת")
  }
}

// רוכש את הנעילה לכלי. false = מישהו אחר (לשונית אחרת, או כלי אחר באותה לשונית) מחזיק נעילה חיה.
export function acquireRunLock(tool) {
  const st = runLockState(readRunLock(), currentTabId(), undefined, undefined, tool);
  if (st.live && !st.mine) return false;
  return writeRunLock(tool);
}

// מרענן נעילה שלנו. false = הנעילה אינה שלנו (לא נוגעים).
export function refreshRunLock(tool) {
  const st = runLockState(readRunLock(), currentTabId(), undefined, undefined, tool);
  if (st.live && !st.mine) return false;
  return writeRunLock(tool);
}

// משחרר רק נעילה שלנו (אותה לשונית; ואם נרשם כלי, אותו כלי).
export function releaseRunLock(tool) {
  try {
    if (typeof localStorage === 'undefined') return;
    const lock = readRunLock();
    if (lock && lock.tab && lock.tab !== currentTabId()) return;
    if (lock && lock.tool && tool && lock.tool !== tool) return;
    localStorage.removeItem(RUN_LOCK_KEY);
  } catch (e) { /* noop */ }
}

// ─── החזקה עם רענון תקופתי: מה שכל כלי צריך ────────────────────────────────
let holdTimer = null;
let holdTool = null;

function stopHoldTimer() {
  if (holdTimer !== null) { try { clearInterval(holdTimer); } catch (e) { /* noop */ } holdTimer = null; }
  holdTool = null;
}

// רוכש את הנעילה לכלי ומתחיל לרענן אותה. מחזיר {ok:true} או {ok:false, message} עם ההודעה למשתמש.
// הריענון נעצר ב-dropRunLock; טעינת-דף מפילה אותו ממילא, וההמשך אחרי הטעינה רוכש מחדש (אותה לשונית = שלי).
export function holdRunLock(tool) {
  if (!acquireRunLock(tool)) return { ok: false, message: runLockBusyMessage(readRunLock(), currentTabId()) };
  if (holdTimer !== null && holdTool !== tool) stopHoldTimer();
  if (holdTimer === null) {
    holdTool = tool;
    holdTimer = setInterval(() => { refreshRunLock(tool); }, RUN_LOCK_REFRESH_MS);
  }
  return { ok: true };
}

// מפסיק לרענן ומשחרר (רק נעילה שלנו).
export function dropRunLock(tool) {
  stopHoldTimer();
  releaseRunLock(tool);
}

// הודעה כללית (נשמרת לתאימות; ההודעה המדויקת מגיעה מ-holdRunLock).
export const RUN_LOCK_BUSY_MESSAGE = 'ריצה פעילה בלשונית אחרת של תלמו"ד. סגור אותה או המתן';
