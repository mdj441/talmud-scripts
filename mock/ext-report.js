// הרחבת דף-המוסד של סביבת-הדמה לכלי "דיווח חודשי": לשונית 2 "מצב תמיכה" עם הכפתור
// ContentPlaceHolder1_btnReport (LinkButton עם href של __doPostBack, כמו באתר).
// סניף שכבר דווח (db.reported[instituteId] === true): הכפתור מקבל disabled="true" ו-class disabled.
// postback של הכפתור → חלונית אזהרה עם "המשך"/"לא"; "המשך" → db.reported = true + חלונית הצלחה ("אישור").
// זריעה מתרחיש: scenario.reported = { '4159': true }.

(function () {
  'use strict';

  const BTN_ID = 'ContentPlaceHolder1_btnReport';
  const BTN_TARGET = 'ctl00$ContentPlaceHolder1$btnReport';
  const CONFIRM_TEXT = 'שים לב: הדיווח החודשי יישלח לסניף. להמשיך?';
  const SUCCESS_TEXT = 'הצלחה: הדיווח נשלח';
  const ALREADY_TEXT = 'הדיווח לחודש זה כבר נשלח';

  // הסניף שממתין לאישור "המשך" (נקבע ב-postback של הכפתור, נצרך ב-onContinue)
  let pending = null; // { db, instituteId }

  function reportedOf(db) {
    db.reported = db.reported || {};
    return db.reported;
  }

  function markButtonDisabled(el) {
    if (!el) return;
    el.setAttribute('disabled', 'true');
    if (!/\bdisabled\b/.test(el.className)) el.className = (el.className + ' disabled').trim();
  }

  function render(ctx) {
    const C = window.__mockCommon;
    const panel = document.getElementById(`${ctx.tabId}_TabInstituteEntitlement`);
    if (!panel) return;
    const reported = reportedOf(ctx.db)[String(ctx.instituteId)] === true;
    panel.innerHTML = `
      <p>מצב תמיכה במוסד · סניף ${C.esc(ctx.inst.branch)}</p>
      <a id="${BTN_ID}" class="btn${reported ? ' disabled' : ''}"${reported ? ' disabled="true"' : ''}
         href="javascript:__doPostBack('${BTN_TARGET}','')">שליחת דיווח חודשי</a>
      <span id="mock-report-hint" style="font-size:12px;color:#666;margin-right:8px">${reported ? 'הדיווח לחודש זה כבר נשלח' : ''}</span>`;
    wrapOnContinue();
  }

  // "המשך" הוא של הדף כולו (window.__mock.onContinue): עוטפים את הקודם ומטפלים רק בחלונית שלנו.
  function wrapOnContinue() {
    const m = window.__mock;
    if (!m || m.__reportContinueWrapped) return;
    m.__reportContinueWrapped = true;
    const prev = m.onContinue;
    m.onContinue = function () {
      const label = document.getElementById('ucMessagePopUp_lblMessage');
      const ours = !!pending && !!label && label.textContent === CONFIRM_TEXT;
      if (!ours) return typeof prev === 'function' ? prev.apply(this, arguments) : undefined;
      const { db, instituteId } = pending;
      pending = null;
      reportedOf(db)[instituteId] = true;
      window.__mockDb.log(db, `monthly report sent for institute ${instituteId}`);
      window.__mockDb.save(db);
      markButtonDisabled(document.getElementById(BTN_ID));
      const hint = document.getElementById('mock-report-hint');
      if (hint) hint.textContent = 'הדיווח לחודש זה כבר נשלח';
      window.__mockCommon.showMessage(SUCCESS_TEXT, ['ok']);
      return undefined;
    };
  }

  function postback(target, arg, ctx) {
    if (target !== BTN_TARGET) return null;
    const C = window.__mockCommon;
    const id = String(ctx.instituteId);
    if (reportedOf(ctx.db)[id] === true) {
      // האתר לא היה מגיע לכאן (הכפתור מנוטרל); רשת-ביטחון בדמה
      return { kind: 'async', apply: () => C.showMessage(ALREADY_TEXT, ['ok']) };
    }
    pending = { db: ctx.db, instituteId: id };
    return { kind: 'async', apply: () => C.showMessage(CONFIRM_TEXT, ['continue', 'no']) };
  }

  window.__mockInstituteExtensions = window.__mockInstituteExtensions || [];
  window.__mockInstituteExtensions.push({ render, postback });
})();
