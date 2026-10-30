// נעילת-ריצה בין לשוניות (ממצא 5): ההקשר צד-השרת של תלמו"ד משותף לכל הלשוניות (דף תלמיד-חדש
// נפתח בלי פרמטרים), ולכן שתי ריצות במקביל משבשות זו את זו. הנעילה ב-localStorage (משותף ללשוניות):
// { tab: מזהה-לשונית, at: Date.now() }. הלשונית הרצה מרעננת אותה כל כמה שניות; נעילה שלא רועננה
// RUN_LOCK_TTL_MS נחשבת מתה (לשונית שנסגרה באמצע). מזהה-הלשונית נשמר ב-sessionStorage (פר-לשונית).
// הלוגיקה הטהורה (runLockState) נפרדת כדי שגם עזיבה/דיווח יוכלו להשתמש בה. אין DOM כאן.

export const RUN_LOCK_KEY = 'talmud.absorb.lock';
export const RUN_LOCK_TTL_MS = 10000;
export const RUN_LOCK_REFRESH_MS = 3000;
const TAB_ID_KEY = 'talmud.tabId';

// טהורה: האם הנעילה חיה (טרייה מ-TTL) והאם היא של הלשונית הזו.
export function runLockState(lock, tabId, now, ttlMs) {
  const dead = { live: false, mine: false };
  if (!lock || typeof lock !== 'object') return dead;
  const at = typeof lock.at === 'number' ? lock.at : NaN;
  if (Number.isNaN(at)) return dead;
  const ttl = typeof ttlMs === 'number' ? ttlMs : RUN_LOCK_TTL_MS;
  const nowMs = typeof now === 'number' ? now : Date.now();
  if (nowMs - at > ttl) return dead;
  return { live: true, mine: !!tabId && lock.tab === tabId };
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

function writeRunLock() {
  try {
    if (typeof localStorage === 'undefined') return true; // בלי אחסון משותף אין לשוניות אחרות
    localStorage.setItem(RUN_LOCK_KEY, JSON.stringify({ tab: currentTabId(), at: Date.now() }));
    return true;
  } catch (e) {
    return true; // כשל-אחסון לא עוצר ריצה ("אצווה לא נתקעת")
  }
}

// רוכש את הנעילה. false = לשונית אחרת מחזיקה נעילה חיה.
export function acquireRunLock() {
  const st = runLockState(readRunLock(), currentTabId());
  if (st.live && !st.mine) return false;
  return writeRunLock();
}

// מרענן נעילה שלנו. false = הנעילה אינה שלנו (לא נוגעים).
export function refreshRunLock() {
  const st = runLockState(readRunLock(), currentTabId());
  if (st.live && !st.mine) return false;
  return writeRunLock();
}

// משחרר רק נעילה שלנו.
export function releaseRunLock() {
  try {
    if (typeof localStorage === 'undefined') return;
    const lock = readRunLock();
    if (lock && lock.tab && lock.tab !== currentTabId()) return;
    localStorage.removeItem(RUN_LOCK_KEY);
  } catch (e) { /* noop */ }
}

// הודעה למשתמש כשלשונית אחרת רצה.
export const RUN_LOCK_BUSY_MESSAGE = 'ריצה פעילה בלשונית אחרת של תלמו"ד. סגור אותה או המתן';
