// חלונית ההודעה המשותפת של האתר (ucMessagePopUp): פורט מ"תלמוד - עזיבת תלמידים" v5
// (‏getMessagePopup:290, hideMessagePopup:303). אותה בקרה משמשת בכל האתר (למשל ולידציה
// "תאריך העזיבה לא יכול להיות לפני תאריך הקליטה..."). לעולם לא לוחצים על "המשך" (btnMOK)
// בשקט: הפעולה היחידה המותרת ל-hide היא ה-ModalPopupExtender.hide()/btnMCancel ("אישור").
// אין גישה ל-document/window ברמת המודול: רק בתוך גופי הפונקציות.

import { $el, isVisible } from './dom.js';
import { waitPRM } from './prm.js';

// ‏W3 (בדיקה רטובה 10.9.2026, F4): סיווג טהור של ההודעה. האתר מציג את הודעת-ההצלחה
// "הצלחה קליטת תלמיד הצליחה" באותה בקרה ועם כפתור "המשך" גלוי: ולכן hasContinue לבדו
// סיווג הצלחה כ"נחסם" ודילג על אימות-הגריד. טקסט הצלחה מנצח את הכפתורים; "לא הצליח" /
// "נכשל" אינם הצלחה (נופלים לסיווג לפי הכפתורים: fail-safe).
//   'success': אינפורמטיבית; הקורא סוגר (hide, לא "המשך") וממשיך לאימות מול הגריד;
//   'confirm': יש "המשך" ואין טקסט הצלחה → בקשת-אישור; לעולם לא נלחצת אוטומטית;
//   'info'   : רק "אישור" (שגיאה/ולידציה); 'unknown': אין מידע.
// ‏1b (סקירת-בטיחות): "הצליח" לבדו רחב מדי (היה מסתיר בקשת-אישור לא-מוכרת כהצלחה). הצלחה = רק
// "הצלחה" בתחילת הטקסט (כותרת ההודעה) או "קליטת תלמיד הצליחה" (גוף ההודעה שנצפה, F4).
export function classifyPopupText(text, flags) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const f = flags && typeof flags === 'object' ? flags : {};
  const negated = /לא\s+הצליח|נכשל/.test(t);
  if (!negated && (/^הצלחה/.test(t) || /קליטת תלמיד הצליחה/.test(t))) return 'success';
  // סבב רטוב 1.11.2026: "שגיאה תקלה בתהליך קליטת תלמיד" מגיעה עם כפתור "המשך" בלבד. זו הודעת-שגיאה של האתר,
  // לא בקשת-אישור: "המשך" שם רק סוגר. בלי הסיווג הזה השורה סומנה "נחסם" עם הוראה מטעה ("האתר מבקש אישור").
  // (עם "אישור" בלבד זו עדיין 'info', כמו קודם: הקורא סוגר וממשיך לפי ההקשר.)
  if (f.hasContinue && (/^(שגיאה|תקלה)/.test(t) || /תקלה בתהליך/.test(t))) return 'error';
  if (f.hasContinue) return 'confirm';
  if (f.hasOkOnly) return 'info';
  return 'unknown';
}

// תווית כפתור (input.value או טקסט): ללוג, כדי שהבדיקה הרטובה תספר מה האתר מציג.
function popupButtonLabel(el) {
  if (!el) return '';
  const raw = el.value || el.textContent || el.innerText || '';
  return String(raw).replace(/\s+/g, ' ').trim();
}

// שמות ה-ID נשמרים כפי שהם ב-depart-v5: btnMOK = "המשך" (אישור-רך), btnMCancel = "אישור"
// (אישור/סגירת שגיאה: למרות השם), btnMNo = "לא".
// מחזיר { text, hasContinue, hasOkOnly, kind, buttons }: ‏kind לפי classifyPopupText,
// ‏buttons = תוויות הכפתורים הגלויים (בסדר: המשך, לא, אישור). הדגלים הגולמיים נשמרים:
// הקורא מחליט "נחסם" רק כש-hasContinue && kind!=='success'.
export function readMessagePopup() {
  const panel = $el('ucMessagePopUp_pnlMessagePopup');
  if (!isVisible(panel)) return null;
  const btnContinue = $el('ucMessagePopUp_btnMOK');
  const btnOk = $el('ucMessagePopUp_btnMCancel');
  const btnNo = $el('ucMessagePopUp_btnMNo');
  const hasContinue = isVisible(btnContinue);
  const hasOk = isVisible(btnOk);
  const hasNo = isVisible(btnNo);
  if (!hasContinue && !hasOk && !hasNo) return null; // פאנל מעובד אך בלי כפתור חי → לא פרומפט אמיתי
  let text = (panel.innerText || panel.textContent || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^\s*הודעה\s*/, '').trim();
  // תוויות הכפתורים נכללות ב-innerText של הפאנל: מקלפים אותן מהסוף, כמה שיש (עד 4).
  for (let i = 0; i < 4; i++) {
    const stripped = text.replace(/\s*(המשך|לא|אישור|ביטול|סגור)\s*$/, '').trim();
    if (stripped === text) break;
    text = stripped;
  }
  const buttons = [];
  if (hasContinue) buttons.push(popupButtonLabel(btnContinue) || 'המשך');
  if (hasNo) buttons.push(popupButtonLabel(btnNo) || 'לא');
  if (hasOk) buttons.push(popupButtonLabel(btnOk) || 'אישור');
  const hasOkOnly = hasOk && !hasContinue;
  return { text, hasContinue, hasOkOnly, kind: classifyPopupText(text, { hasContinue, hasOkOnly }), buttons };
}

// סוגר את חלונית ההודעה. מעדיף את ה-ModalPopupExtender (hide() נקי, לא מפעיל שום
// postback צד-שרת). נופל ל-btnMCancel ("אישור") רק אם ה-extender לא זמין. לעולם לא
// לוחץ על btnMOK ("המשך"): זה כפתור אישור-רך ולא כפתור סגירה.
// M-f: ‏btnMCancel הוא postback צד-שרת, ולכן הוא חייב את הסדר הקשיח של
// global-constraints: רושמים waitPRM *לפני* הלחיצה, והלחיצה נדחית ל-setTimeout(0).
// מחזיר {hidden, wait}: `wait` הוא ה-Promise של ה-postback (null כשנסגר ב-extender,
// שאינו postback). ‏waitPRM לעולם לא נדחה.
export function hideMessagePopupAsync() {
  try {
    if (typeof window.$find === 'function') {
      const mpe = window.$find('ucMessagePopUp_ModalPopupExtender1');
      if (mpe && typeof mpe.hide === 'function') { mpe.hide(); return { hidden: true, wait: null }; }
    }
  } catch (e) { /* ignore, fall through to button click */ }
  const ok = $el('ucMessagePopUp_btnMCancel');
  if (isVisible(ok)) {
    const wait = waitPRM({ startTimeoutMs: 1500, totalTimeoutMs: 15000 }); // (1) נרשם קודם
    setTimeout(() => { try { ok.click(); } catch (e) { /* אצווה לא נתקעת */ } }, 0); // (2) נדחה
    return { hidden: true, wait };
  }
  return { hidden: false, wait: null };
}

// לוחץ "המשך" (btnMOK). לא נקרא לעולם מעצמו: רק מזרימה שבעל-המערכת סימן בה במפורש שהוא מאשר
// (למשל "אשר המשך" בלשונית הקליטה, סבב רטוב 31.10.2026: אזהרת "תלמיד זה רשום כבר במוסד אחר").
// postback צד-שרת: waitPRM נרשם *לפני*, והלחיצה נדחית ל-setTimeout(0). מחזיר {pressed, wait}.
export function pressMessagePopupContinueAsync() {
  const btn = $el('ucMessagePopUp_btnMOK');
  if (!isVisible(btn)) return { pressed: false, wait: null };
  const wait = waitPRM({ startTimeoutMs: 1500, totalTimeoutMs: 15000 }); // (1) נרשם קודם
  setTimeout(() => { try { btn.click(); } catch (e) { /* אצווה לא נתקעת */ } }, 0); // (2) נדחה
  return { pressed: true, wait };
}

// תאימות: אותה התנהגות, בלי ה-Promise (מי שלא ממתין לתוצאה).
export function hideMessagePopup() {
  return hideMessagePopupAsync().hidden;
}

// גרסה גנרית ל-extender כלשהו (ModalPopupExtender / AjaxModalPopup): $find(id).hide(),
// null-safe: מחזיר false אם $find לא זמין או שלא נמצא extender בשם הזה.
export function closeModal(extenderId) {
  try {
    if (typeof window.$find !== 'function') return false;
    const ext = window.$find(extenderId);
    if (!ext || typeof ext.hide !== 'function') return false;
    ext.hide();
    return true;
  } catch (e) {
    return false;
  }
}
