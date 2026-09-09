// עוזרי DOM כלליים — פורט מ"תלמוד - עזיבת תלמידים" v5 (‏$el:44, sleep:45, waitFor:135, isVisible:279).
// חשוב: אין גישה ל-document/window ברמת המודול — רק בתוך גופי הפונקציות, כדי שהמודול
// יהיה ניתן ל-import ב-Node (בדיקות) בלי סביבת דפדפן.

export function $el(id) {
  return document.getElementById(id);
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// getClientRects().length, לא offsetParent: ה-ModalPopupExtender מציג את החלונית עם
// position:fixed, ועבורה offsetParent הוא תמיד null גם כשהיא גלויה לגמרי.
// getClientRects() מחזיר תיבות לאלמנטים מעובדים (כולל fixed) וכלום ל-display:none —
// בדיוק האות שאנחנו רוצים.
export function isVisible(el) {
  if (!el) return false;
  if (el.getClientRects().length === 0) return false;
  const s = window.getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
}

// בודק predicate בפולינג ומתממש (resolve) עם הערך האמת ברגע שהוא מתקבל.
// בניגוד ל-depart-v5 (שם waitFor פותר true/false ולעולם לא נדחה), כאן timeout נדחה
// (reject) עם Error בשם - הכרעת הבקר למודול הזה, כדי שהקורא יבחין במפורש בין "המתנה
// הצליחה" ל"פג הזמן" דרך catch/then ולא ילך לפרש false כערך legitmate של predicate.
export function waitFor(predicate, { timeout = 5000, interval = 30 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function check() {
      let ok;
      try { ok = predicate(); } catch (e) { ok = false; }
      if (ok) return resolve(ok);
      if (Date.now() - t0 >= timeout) {
        return reject(new Error(`waitFor: timeout after ${timeout}ms`));
      }
      setTimeout(check, interval);
    })();
  });
}
