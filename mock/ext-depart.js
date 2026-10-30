// הרחבת דף-המוסד של סביבת-הדמה: לשונית 3 "תלמידים למוסד" + מודאל העזיבה (ucStudentClose).
// מחקה את מזהי האתר האמיתי כפי שהסקריפט הישן "תלמוד - עזיבת תלמידים" v5 מכיר אותם.
// התלמידים של המוסד = כל ה-enrolled של סוגי-הלימוד של המוסד. תאריך עזיבה בשדה `left`.
// שדות-תרחיש (ברירת-מחדל כאן, לא ב-db.js): departBlocked {id: הודעה} (חסימה ב"אישור"),
// departConfirmPopup: 'confirm' (חלונית "המשך"/"לא" אחרי "אישור"). כל התעודות בדויות.

(function () {
  'use strict';
  const BASE = 'ContentPlaceHolder1_tabInstituteDetails_TabPanel1_ucStudentsSearch';
  const T = 'ctl00$ContentPlaceHolder1$tabInstituteDetails$TabPanel1$ucStudentsSearch';
  const MODAL_ID = `${BASE}_ucStudentClose_DivCloseStudent`;
  const MODAL_EXT = `${BASE}_ucStudentClose_ModalPopupExtender`;
  const DEPT_BTN = 'ContentPlaceHolder1_btnStudentDeparture3';
  const REASONS = [['1', 'הפסקת לימודים'], ['3', 'מעבר בין ישיבות'], ['4', 'מעבר בין יחידות צבאיות'], ['6', 'אחר'], ['7', 'גיוס לצה"ל']];

  let shownList = []; // התלמידים שמוצגים כרגע בגריד (אחרי סינון)
  let selected = null; // אינדקס השורה שנבחרה (מצב "שרת" מדומה)
  let lastQuery = '';
  let pendingDepart = null; // עזיבה שאושרה במודאל וממתינה ל"שמירה"
  let pendingConfirm = null; // עזיבה שממתינה ל"המשך" בחלונית האישור-הרך

  const D = () => window.__mockDb;
  const C = () => window.__mockCommon;
  const esc = (s) => C().esc(s);

  function studentsOf(db, instituteId) {
    const out = [];
    for (const st of D().studyTypesOf(db, instituteId)) {
      for (const s of D().enrolledOf(db, st.id)) out.push(Object.assign({}, s, { stId: st.id, stCode: st.code }));
    }
    return out;
  }

  function gridHtml(students) {
    if (!students.length) return ''; // GridView ריק אינו מרונדר כלל (כמו באתר)
    let html = `<table class="grid" id="${BASE}_gvIStudents"><tr><th></th><th>סדר</th><th>סוג מזהה</th><th>ת.ז. / דרכון</th><th>שם</th><th>שם משפחה</th><th>תאריך לידה</th><th>סוג לימוד</th><th>תאריך קליטה</th><th>תאריך עזיבה</th><th>מצב אישור מעבר</th></tr>`;
    students.forEach((s, i) => {
      const ctl = String(i + 2).padStart(2, '0');
      // תיבת-הסימון: AutoPostBack כמו ב-ASP.NET (עטיפת setTimeout עם גרשים מוברחים)
      const cbClick = `javascript:setTimeout('__doPostBack(\\'${T}$gvIStudents$ctl${ctl}$chkSelect\\',\\'\\')', 0)`;
      html += `<tr onclick="selectedRowStudents('${i}')" style="cursor:pointer">`
        + `<td><input type="checkbox" id="${BASE}_gvIStudents_chkSelect_${i}" onclick="${cbClick}"></td>`
        + `<td>${i + 1}</td><td>${s.idType === '2' ? 'דרכון' : 'תעודת זהות'}</td><td>${esc(s.id)}</td><td>${esc(s.first)}</td><td>${esc(s.last)}</td>`
        + `<td>${esc(s.birth || '')}</td><td>${esc(s.stCode)}</td><td>${esc(s.accepted || '01/09/2025')}</td><td>${esc(s.left || '')}</td><td></td></tr>`;
    });
    return html + '</table>';
  }

  function resultsHtml(students) {
    return `<span id="${BASE}_lblCountSearch">נמצאו ${students.length} רשומות בהתאם לקריטריון החיפוש</span>${gridHtml(students)}`;
  }

  function setDepartEnabled(on) {
    const a = document.getElementById(DEPT_BTN);
    if (!a) return;
    if (on) { a.removeAttribute('disabled'); a.classList.remove('aspNetDisabled'); }
    else { a.setAttribute('disabled', 'disabled'); a.classList.add('aspNetDisabled'); }
  }

  function highlight(n) {
    document.querySelectorAll(`#${BASE}_gvIStudents tr[onclick]`).forEach((tr, i) => tr.classList.toggle('selected', i === Number(n)));
  }

  function renderResults(db, instituteId) {
    const all = studentsOf(db, instituteId);
    shownList = lastQuery ? all.filter((s) => D().norm(s.id) === D().norm(lastQuery)) : all;
    const el = document.getElementById(`${BASE}_upResults`);
    if (el) el.innerHTML = resultsHtml(shownList);
    selected = null;
    setDepartEnabled(false);
  }

  // הפונקציה הגלובלית של האתר (צד-לקוח): מסמנת שורה ומאפשרת את כפתור "עזיבה".
  window.selectedRowStudents = function (n) {
    if (!shownList[Number(n)]) return;
    selected = Number(n);
    highlight(n);
    setDepartEnabled(true);
  };

  function showValidators(dateOk, reasonOk) {
    const v1 = document.getElementById(`${BASE}_ucStudentClose_valLeaveDate`);
    const v2 = document.getElementById(`${BASE}_ucStudentClose_valLeaveReason`);
    if (v1) v1.style.display = dateOk ? 'none' : '';
    if (v2) v2.style.display = reasonOk ? 'none' : '';
  }

  function openModal() {
    document.getElementById(`${BASE}_ucStudentClose_ctlLeaveDate_txtDate`).value = '';
    document.getElementById(`${BASE}_ucStudentClose_ddlLeaveReason`).value = '-1';
    showValidators(true, true);
    window.__mock.components[MODAL_EXT].show();
  }
  function closeModal() { window.__mock.components[MODAL_EXT].hide(); }

  function render(ctx) {
    const { db, instituteId } = ctx;
    db.departBlocked = db.departBlocked || {};
    const panel = document.getElementById(`${ctx.tabId}_TabPanel1`);
    if (!panel) return;
    panel.innerHTML = `
<div style="margin:6px 0">
  חיפוש ת.ז./דרכון: <input type="text" id="${BASE}_txtStudenPassport">
  <input type="submit" class="btn" id="${BASE}_btnSearch" value="חפש" onclick="ShowLoaderPopUp();__doPostBack('${T}$btnSearch','');return false;">
</div>
<div id="${BASE}_upResults"></div>
<div style="margin-top:8px">
  <a id="${DEPT_BTN}" class="btn aspNetDisabled" disabled="disabled" href="javascript:__doPostBack('ctl00$ContentPlaceHolder1$btnStudentDeparture3','')">עזיבה</a>
  <a id="ContentPlaceHolder1_btnSaveTab3" class="btn" href="javascript:__doPostBack('ctl00$ContentPlaceHolder1$btnSaveTab3','')">שמירה</a>
</div>
<div id="${MODAL_ID}" class="AjaxModalpopup" style="display:none;position:fixed;top:100px;left:50%;transform:translateX(-50%);background:#fff;border:2px solid #345;padding:16px 24px;z-index:900;min-width:340px">
  <div style="font-weight:bold;margin-bottom:8px">עזיבת תלמיד</div>
  <div>תאריך עזיבה: <input type="text" id="${BASE}_ucStudentClose_ctlLeaveDate_txtDate"> <span class="validator" id="${BASE}_ucStudentClose_valLeaveDate">תאריך עזיבה הינו חובה</span></div>
  <div>סיבת עזיבה: <select id="${BASE}_ucStudentClose_ddlLeaveReason"><option value="-1">בחירה</option>${REASONS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select> <span class="validator" id="${BASE}_ucStudentClose_valLeaveReason">סיבת עזיבה הינה חובה</span></div>
  <div style="margin-top:10px">
    <a id="${BASE}_ucStudentClose_btnDepartureStudent" class="btn" href="javascript:__doPostBack('${T}$ucStudentClose$btnDepartureStudent','')">אישור</a>
    <a id="${BASE}_ucStudentClose_btnClose" class="btn" href="javascript:__doPostBack('${T}$ucStudentClose$btnClose','')">ביטול</a>
  </div>
</div>`;
    lastQuery = '';
    pendingDepart = null;
    pendingConfirm = null;
    renderResults(db, instituteId);
    window.__mock.components[MODAL_EXT] = window.__mockModal(MODAL_ID);
    // ה-extender של חלונית ההודעה קיים באתר האמיתי; דף-המוסד של הדמה לא רושם אותו, ולכן כאן.
    window.__mock.components['ucMessagePopUp_ModalPopupExtender1'] = window.__mockModal('ucMessagePopUp_pnlMessagePopup');
    // "המשך" בחלונית האישור-הרך (של הדף כולו; דף-המוסד לא מגדיר אחד)
    window.__mock.onContinue = () => {
      if (pendingConfirm) { pendingDepart = pendingConfirm; pendingConfirm = null; D().log(db, `depart ${pendingDepart.id} soft-confirm → continued`); }
    };
  }

  function postback(target, arg, ctx) {
    const { db, instituteId } = ctx;

    if (target === `${T}$btnSearch`) {
      const q = document.getElementById(`${BASE}_txtStudenPassport`).value.trim();
      return { kind: 'async', apply: () => { lastQuery = q; renderResults(db, instituteId); D().log(db, `depart search "${q}" → ${shownList.length}`); } };
    }

    const chk = new RegExp('^' + T.replace(/\$/g, '\\$') + '\\$gvIStudents\\$ctl(\\d+)\\$chkSelect$').exec(target);
    if (chk) {
      const n = Number(chk[1]) - 2;
      return { kind: 'async', apply: () => { if (shownList[n]) { selected = n; highlight(n); setDepartEnabled(true); } } };
    }

    if (target === 'ctl00$ContentPlaceHolder1$btnStudentDeparture3') {
      if (selected === null || !shownList[selected]) return { kind: 'none' }; // הכפתור מנוטרל בלי בחירה
      return { kind: 'async', apply: openModal };
    }

    if (target === `${T}$ucStudentClose$btnClose`) return { kind: 'async', apply: closeModal };

    if (target === `${T}$ucStudentClose$btnDepartureStudent`) {
      const date = document.getElementById(`${BASE}_ucStudentClose_ctlLeaveDate_txtDate`).value.trim();
      const reason = document.getElementById(`${BASE}_ucStudentClose_ddlLeaveReason`).value;
      const student = selected !== null ? shownList[selected] : null;
      if (!student) return { kind: 'async', apply: () => C().showMessage('לא נבחר תלמיד', ['ok']) };
      const dateOk = /^\d{2}\/\d{2}\/\d{4}$/.test(date);
      const reasonOk = !!reason && reason !== '-1';
      if (!dateOk || !reasonOk) {
        return { kind: 'async', apply: () => { showValidators(dateOk, reasonOk); C().showMessage(dateOk ? 'סיבת עזיבה הינה חובה' : 'תאריך עזיבה הינו חובה', ['ok']); } };
      }
      const blocked = db.departBlocked && db.departBlocked[student.id];
      if (blocked) {
        // חסימת שרת: ההודעה עולה, המודאל נשאר פתוח (הסקריפט סוגר אותו ב"ביטול")
        return { kind: 'async', apply: () => { C().showMessage(blocked, ['ok']); D().log(db, `depart ${student.id} → blocked`); } };
      }
      const staged = { id: student.id, stId: student.stId, date, reason };
      if (db.departConfirmPopup === 'confirm') {
        return { kind: 'async', apply: () => { closeModal(); pendingConfirm = staged; C().showMessage('התלמיד מדווח בחודש הנוכחי. האם להמשיך בעזיבה?', ['continue', 'no']); D().log(db, `depart ${student.id} → soft-confirm`); } };
      }
      return { kind: 'async', apply: () => { closeModal(); pendingDepart = staged; D().log(db, `depart ${student.id} → staged ${date}/${reason}`); } };
    }

    if (target === 'ctl00$ContentPlaceHolder1$btnSaveTab3') {
      return { kind: 'async', apply: () => {
        if (pendingDepart) {
          const row = (db.enrolled[pendingDepart.stId] || []).find((s) => D().norm(s.id) === D().norm(pendingDepart.id));
          if (row) { row.left = pendingDepart.date; row.leaveReason = pendingDepart.reason; }
          D().log(db, `depart ${pendingDepart.id} saved left=${pendingDepart.date}`);
          pendingDepart = null;
          ctx.save();
        }
        renderResults(db, instituteId);
        C().showMessage('הצלחה תהליך עידכון תלמיד הצליח', ['ok']);
      } };
    }

    return null;
  }

  window.__mockInstituteExtensions = window.__mockInstituteExtensions || [];
  window.__mockInstituteExtensions.push({ render, postback });
})();
