// חלקים משותפים לכל דפי-הדמה: ucMessagePopUp (חלונית ההודעה הכללית של האתר), עץ-הצד (עם ה-postback
// שקובע את ה-session, F2), כותרת עם h1 ופירורי-לחם, ורישום רכיבים ל-$find.

(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // חלונית ההודעה: כפתורים btnMOK="המשך", btnMNo="לא", btnMCancel="אישור" (השמות כמו באתר).
  function messagePopupHtml() {
    return `
<div id="ucMessagePopUp_pnlMessagePopup" class="AjaxModalpopup" style="display:none;position:fixed;top:120px;left:50%;transform:translateX(-50%);
     background:#fff;border:2px solid #345;padding:16px 24px;z-index:1000;min-width:320px;text-align:center">
  <div style="font-weight:bold;margin-bottom:8px">הודעה</div>
  <div id="ucMessagePopUp_lblMessage" style="margin-bottom:12px"></div>
  <input type="button" id="ucMessagePopUp_btnMOK" value="המשך" style="display:none;margin:0 4px">
  <input type="button" id="ucMessagePopUp_btnMNo" value="לא" style="display:none;margin:0 4px">
  <input type="button" id="ucMessagePopUp_btnMCancel" value="אישור" style="display:none;margin:0 4px">
</div>`;
  }

  // מציג הודעה. buttons: מערך מתוך ['continue','no','ok'].
  // ‏kind: 'success' (כמו באתר: טקסט "הצלחה ..." עם "המשך" גלוי), 'info' (רק "אישור"), 'confirm' ("המשך"+"לא").
  function showMessage(text, buttons) {
    const panel = document.getElementById('ucMessagePopUp_pnlMessagePopup');
    document.getElementById('ucMessagePopUp_lblMessage').textContent = text;
    const set = (id, on) => { document.getElementById(id).style.display = on ? '' : 'none'; };
    set('ucMessagePopUp_btnMOK', buttons.includes('continue'));
    set('ucMessagePopUp_btnMNo', buttons.includes('no'));
    set('ucMessagePopUp_btnMCancel', buttons.includes('ok'));
    panel.style.display = 'block';
    if (window.__mockLog) window.__mockLog(`popup shown: "${text}" [${buttons.join(',')}]`);
  }
  function hideMessage() {
    const panel = document.getElementById('ucMessagePopUp_pnlMessagePopup');
    if (panel) panel.style.display = 'none';
  }

  // עץ-הצד (F2): קישור לכל סניף בפורמט __doPostBack של TreeView; קיים בדף המוסד ובדף סוג-הלימוד.
  function treeHtml(db) {
    const name = 'עטרת שלמה';
    const items = Object.entries(db.institutes)
      .sort((a, b) => a[1].branch.localeCompare(b[1].branch))
      .map(([id, inst], i) => `<div class="tree-node"><a id="ucTalmudSideBar_tvTalmudt${i + 1}" href="javascript:__doPostBack('ctl00$ucTalmudSideBar$tvTalmud','s${name}\\\\${inst.branch}')">${esc(inst.branch)}</a></div>`)
      .join('');
    return `<div id="ucTalmudSideBar_tvTalmud" style="float:right;width:160px;border:1px solid #ccc;padding:6px;font-size:13px">
      <div style="font-weight:bold">${esc(name)}</div>${items}</div>`;
  }

  // ה-postback של העץ (F2): קובע את המוסד הנוכחי ב-session (ומאפס את סוג-הלימוד הנוכחי), ואז טעינת-דף
  // מלאה לכתובת שהדף מבקש (דף המוסד: אותה כתובת, הכתובת לא משתנה). מחזיר null כשהיעד אינו העץ.
  function handleTreePostback(db, target, arg, urlAfter) {
    if (target !== 'ctl00$ucTalmudSideBar$tvTalmud') return null;
    // לוכסן אחד בדיוק לפני הסניף, כמו שהדפדפן מפענח את ה-href (`\\NN` בתכונה = `\NN` בריצה).
    // ארגומנט עם שני לוכסנים (פרסור בלי פענוח) נדחה כמו באתר: אין טעינה.
    const mm = /^s[^\\]+\\(\d{2})$/.exec(arg || '');
    if (!mm) return { kind: 'none' };
    const id = window.__mockDb.branchToInstituteId(db, mm[1]);
    if (!id) return { kind: 'async', apply: () => showMessage('סניף לא נמצא', ['ok']) };
    window.__mockDb.setSession(db, { instituteId: id, studyTypeId: null });
    return { kind: 'navigate', url: typeof urlAfter === 'function' ? urlAfter(id) : (urlAfter || (location.pathname + location.search)) };
  }

  // כמו באתר (ממצא 1א): לפני פירורי-הלחם האמיתיים יש SiteMapPath "רגיל" (בית > ...) בלי סניף.
  // ‏ids: {h1, span}: מזהי ה-h1 וה-span הפנימי (באתר: ContentPlaceHolder1_headerInstitutesDetails / lblInsName).
  // h1 ריק (F1/F3: GET ישיר בלי session) מרונדר כ-<h1><span></span></h1>, בדיוק כמו באתר.
  function headerHtml(h1, crumbs, ids) {
    const crumbHtml = (crumbs || []).map((c) => `<span class="crumb">${esc(c)}</span>`).join(' <span class="sep">&gt;</span> ');
    const h1Id = ids && ids.h1 ? ` id="${esc(ids.h1)}"` : '';
    const spanId = ids && ids.span ? ` id="${esc(ids.span)}"` : '';
    return `<span id="ctl00_SiteMapPath1" style="font-size:11px;color:#888">בית &gt; איתור מוסד &gt; פרטי מוסד</span>
      <div id="ucBreadCrumbs" class="breadcrumbs" style="font-size:12px;color:#555;margin-bottom:6px">${crumbHtml}</div>
      <h1${h1Id} style="font-size:20px;margin:0 0 10px"><span${spanId}>${esc(h1)}</span></h1>`;
  }

  // כפתורי חלונית ההודעה: "אישור"/"לא" סוגרים (postback קל). "המשך": הדף מחליט (window.__mock.onContinue).
  function wireMessageButtons() {
    document.getElementById('ucMessagePopUp_btnMCancel').addEventListener('click', () => {
      window.__doPostBack('ctl00$ucMessagePopUp$btnMCancel', '');
    });
    document.getElementById('ucMessagePopUp_btnMNo').addEventListener('click', () => {
      window.__doPostBack('ctl00$ucMessagePopUp$btnMNo', '');
    });
    document.getElementById('ucMessagePopUp_btnMOK').addEventListener('click', () => {
      window.__doPostBack('ctl00$ucMessagePopUp$btnMOK', '');
    });
  }

  // מטפל-ברירת-מחדל לכפתורי ההודעה. הדף קורא לו מתוך postback() לפני הטיפול שלו.
  function handleMessagePostback(target) {
    if (target === 'ctl00$ucMessagePopUp$btnMCancel' || target === 'ctl00$ucMessagePopUp$btnMNo') {
      return { kind: 'async', apply: hideMessage };
    }
    if (target === 'ctl00$ucMessagePopUp$btnMOK') {
      const fn = window.__mock && window.__mock.onContinue;
      return { kind: 'async', apply: () => { hideMessage(); if (fn) fn(); } };
    }
    return null;
  }

  function baseStyle() {
    return `<style>
      body{font-family:Arial,sans-serif;direction:rtl;margin:0;padding:12px;background:#f4f6f8;color:#222}
      .page{background:#fff;border:1px solid #ccd;padding:12px;min-height:400px;margin-right:180px}
      table.grid{border-collapse:collapse;font-size:13px;width:100%} table.grid th,table.grid td{border:1px solid #bbb;padding:3px 6px}
      table.grid th{background:#e8eef5} tr.selected td{background:#ffe9a8}
      .ajax__tab_header{display:flex;gap:4px;border-bottom:2px solid #789;margin:8px 0}
      .ajax__tab_tab{padding:6px 12px;background:#e3e8ee;cursor:pointer;border-radius:4px 4px 0 0}
      .ajax__tab_active{background:#789;color:#fff}
      .AjaxModalpopup{box-shadow:0 4px 20px rgba(0,0,0,.4)}
      .btn{padding:4px 12px;margin:2px}
      .validator{color:#c00;font-size:12px;display:none}
      input[type=text],select{padding:3px;font-size:13px}
    </style>`;
  }

  window.__mockCommon = { esc, messagePopupHtml, showMessage, hideMessage, treeHtml, handleTreePostback, headerHtml, wireMessageButtons, handleMessagePostback, baseStyle };
})();
