// המתנה ל-postback א-סינכרוני של MS AJAX ScriptManager — פורט מ"תלמוד - עזיבת תלמידים"
// v5 (‏getPRM:83, waitPRM:87). מבוסס-event (add_beginRequest/add_endRequest), לא פולינג.
// אין גישה ל-Sys/window ברמת המודול — רק בתוך גופי הפונקציות (import תקין גם ב-Node).

export function getPRM() {
  try {
    return Sys.WebForms.PageRequestManager.getInstance();
  } catch (e) {
    return null;
  }
}

// שינוי סמנטי מכוון מול depart-v5 (שם waitPRM נדחה/reject בשגיאת postback): כאן
// לעולם לא נזרק/נדחה — "אצווה לא נתקעת" (global-constraints). תמיד resolve עם
// {ok:true} או {ok:false, reason}, כדי שהקורא ידווח ויימשך לפריט הבא בלי try/catch חוסם.
// ‏`started` (תוספת) = האם נצפה beginRequest בפועל. {ok:true, started:false} פירושו
// "הפעולה לא הפעילה שום בקשה לשרת" — לחיצה שנבלעה, ולא ניווט/עדכון שהצליח. בלעדיו
// אי-אפשר להבחין בין השניים, וזה מקור באגים C1/C4 (ניווט מדומה, חיפוש שלא רץ).
export function waitPRM({ startTimeoutMs = 2500, totalTimeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const prm = getPRM();
    if (!prm) { setTimeout(() => resolve({ ok: true, started: false }), 200); return; }

    let started = false, done = false;
    // ממצא 8: ירי בקשה כשאחרת בטיסה: MS AJAX מריץ abortPostBack שמרים endRequest (בלי שגיאה) של
    // הבקשה הקודמת *לפני* ה-beginRequest של החדשה. ה-endRequest הראשון אחרי רישום-בזמן-טיסה
    // שייך לקודמת, ולא מסיים את ההמתנה הזו.
    let inFlight = !!prm._isInAsyncPostBack;

    function onBegin() { started = true; inFlight = false; clearTimeout(startTimer); }

    function onEnd(s, e) {
      if (inFlight && !started) { inFlight = false; return; }
      const err = e && e.get_error && e.get_error();
      if (err && e.set_errorHandled) e.set_errorHandled(true);
      finish(err ? { ok: false, reason: 'PRM: ' + (err.message || 'postback error') } : { ok: true });
    }

    function finish(result) {
      if (done) return;
      done = true;
      prm.remove_beginRequest(onBegin);
      prm.remove_endRequest(onEnd);
      clearTimeout(startTimer);
      clearTimeout(totalTimer);
      resolve(Object.assign({ started }, result));
    }

    prm.add_beginRequest(onBegin);
    prm.add_endRequest(onEnd);

    const startTimer = setTimeout(() => {
      if (!started && !prm._isInAsyncPostBack) {
        finish({ ok: true }); // הפעולה שנורתה לא הפעילה postback — ממשיכים
      }
    }, startTimeoutMs);

    const totalTimer = setTimeout(() => {
      // מפסיקים להמתין לתלמיד הזה בלי לזרוק, כדי לא לסכן postback שני מעל אחד שעדיין בטיסה.
      finish({ ok: false, reason: `PRM timeout after ${totalTimeoutMs}ms` });
    }, totalTimeoutMs);
  });
}

// יורה postback עם סדר קשיח (global-constraints, "postback מקוד strict"): רושמים
// את ההמתנה (וה-add_endRequest שבתוכה) *לפני* ש-__doPostBack נקרא, והקריאה עצמה
// נדחית ל-setTimeout(fn, 0) כדי שה-handlers כבר יהיו רשומים כש-PRM מתחיל postback.
export function firePostback(target, arg = '', opts) {
  const wait = waitPRM(opts); // (1) registers wait — add_endRequest is wired synchronously inside
  setTimeout(() => { window.__doPostBack(target, arg); }, 0); // (2) deferred, after registration
  return wait;
}
