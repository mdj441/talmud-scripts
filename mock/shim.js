// סביבת-דמה של תלמו"ד — חיקוי של תשתית ASP.NET Web Forms + MS AJAX שהסקריפטים נשענים עליה.
// נטען בכל דף-דמה לפני סקריפט-הדף. מדמה: Sys.WebForms.PageRequestManager (add/remove_beginRequest,
// add/remove_endRequest, _isInAsyncPostBack), __doPostBack, $find (extenders: show/hide,
// TabContainer: get/set_activeTabIndex), WebForm_DoPostBackWithOptions + ולידטורים (Page_ClientValidate).
//
// כל postback עובר דרך window.__mock.postback(target, arg) שהדף מגדיר. הדף מחזיר:
//   { kind: 'async', apply: () => {...} }  → beginRequest → (השהיה) → apply() → endRequest
//   { kind: 'navigate', url }              → beginRequest לא נורה (ניווט מלא), location.href = url
//   { kind: 'none' }                       → כלום (לחיצה שנבלעה)
// זמן התגובה נשלט ב-window.__mockDelayMs (ברירת-מחדל 120ms) — כמו שרת אמיתי אך מהיר.

(function () {
  'use strict';

  const handlers = { begin: [], end: [] };
  let inAsync = false;

  function fire(list, sender, args) {
    for (const fn of list.slice()) {
      try { fn(sender, args); } catch (e) { console.error('[mock-prm] handler error', e); }
    }
  }

  const endArgs = (error) => ({
    _error: error || null,
    get_error() { return this._error; },
    set_errorHandled(v) { this._handled = !!v; },
    get_dataItems() { return {}; },
  });

  const prm = {
    add_beginRequest(fn) { handlers.begin.push(fn); },
    remove_beginRequest(fn) { handlers.begin = handlers.begin.filter((f) => f !== fn); },
    add_endRequest(fn) { handlers.end.push(fn); },
    remove_endRequest(fn) { handlers.end = handlers.end.filter((f) => f !== fn); },
    get_isInAsyncPostBack() { return inAsync; },
    get _isInAsyncPostBack() { return inAsync; },
    // הפונקציה שהאתר האמיתי מריץ מ-__doPostBack (הולכת על arguments.callee.caller — לא מדומה כאן).
    _doPostBack(target, arg) { return runPostback(target, arg); },
  };

  window.Sys = window.Sys || {};
  window.Sys.WebForms = window.Sys.WebForms || {};
  window.Sys.WebForms.PageRequestManager = { getInstance() { return prm; } };

  const delay = () => (typeof window.__mockDelayMs === 'number' ? window.__mockDelayMs : 120);

  function runPostback(target, arg) {
    const log = window.__mockLog || (() => {});
    if (inAsync) {
      // MS AJAX מבטל בקשה שנייה מעל אחת שבטיסה בצד-לקוח (הראשונה נזרקת). מדמים: השנייה מנצחת.
      log(`postback while in flight: ${target} (previous aborted)`);
    }
    let res;
    try {
      res = window.__mock && typeof window.__mock.postback === 'function'
        ? window.__mock.postback(target, arg)
        : { kind: 'none' };
    } catch (e) {
      console.error('[mock] postback handler threw', e);
      res = { kind: 'error', message: e && e.message };
    }
    if (!res || res.kind === 'none') { log(`postback ignored: ${target}`); return; }

    if (res.kind === 'navigate') {
      log(`postback navigate: ${target} → ${res.url}`);
      // ניווט מלא. ברירת-מחדל: אין beginRequest (כמו submit רגיל). עם redirectFiresBeginRequest (ממצא ב-2,
      // כמו pageRedirect באתר): beginRequest נורה, endRequest לא נורה לעולם, והדף נפרק אחרי redirectDelayMs.
      let db = null;
      try { db = window.__mockDb ? window.__mockDb.load() : null; } catch (e) { db = null; }
      const redirectDelay = db && typeof db.redirectDelayMs === 'number' ? db.redirectDelayMs : Math.max(20, delay() / 2);
      if (db && db.redirectFiresBeginRequest) {
        inAsync = true;
        fire(handlers.begin, prm, { get_postBackElement: () => document.getElementById(target.replace(/\$/g, '_')) });
      }
      setTimeout(() => { window.location.href = res.url; }, redirectDelay);
      return;
    }

    // async (או error): מחזור בקשה מלא
    inAsync = true;
    fire(handlers.begin, prm, { get_postBackElement: () => document.getElementById(target.replace(/\$/g, '_')) });
    setTimeout(() => {
      let error = null;
      try {
        if (res.kind === 'error') error = { message: res.message || 'server error' };
        else if (typeof res.apply === 'function') res.apply();
      } catch (e) {
        error = { message: e && e.message };
      }
      inAsync = false;
      if (window.__mock && typeof window.__mock.afterPostback === 'function') {
        try { window.__mock.afterPostback(target, arg); } catch (e) { /* noop */ }
      }
      fire(handlers.end, prm, endArgs(error));
    }, delay());
  }

  window.__doPostBack = function (target, arg) { runPostback(target, arg || ''); };

  // ─── $find: extenders ו-TabContainers שהדף רושם ב-window.__mock.components ────
  window.$find = function (id) {
    const c = window.__mock && window.__mock.components;
    return (c && c[id]) || null;
  };

  // ModalPopupExtender מדומה: show/hide משנים display של הפאנל (כמו באתר — position:fixed).
  window.__mockModal = function (panelId) {
    return {
      _id: panelId,
      show() { const el = document.getElementById(panelId); if (el) { el.style.display = 'block'; el.setAttribute('data-mock-shown', '1'); } },
      hide() { const el = document.getElementById(panelId); if (el) { el.style.display = 'none'; el.removeAttribute('data-mock-shown'); } },
    };
  };

  // TabContainer מדומה. F4 (מתוקן, 30.10.2026): באתר set_activeTabIndex מפעיל postback א-סינכרוני (UpdatePanel)
  // שבמהלכו $find מחזיר null והפקדים שבלשונית נבנים מחדש. עם opts.postbackTarget הדף מקבל את ה-postback
  // (ארגומנט "activeTabChanged:<i>") ומחיל אותו דרך _commit(i) כשהוא מסתיים; בלי opts: שינוי מיידי בצד-לקוח.
  window.__mockTabs = function (containerId, count, initial, opts) {
    const o = opts || {};
    let active = typeof initial === 'number' ? initial : 0;
    const render = () => {
      const c = document.getElementById(containerId);
      if (!c) return;
      c.querySelectorAll('[data-tab-index]').forEach((el) => {
        const i = Number(el.getAttribute('data-tab-index'));
        el.style.display = i === active ? '' : 'none';
      });
      c.querySelectorAll('[data-tab-header]').forEach((el) => {
        const i = Number(el.getAttribute('data-tab-header'));
        el.classList.toggle('ajax__tab_active', i === active);
      });
    };
    setTimeout(render, 0);
    return {
      get_activeTabIndex() { return active; },
      set_activeTabIndex(i) {
        if (Number(i) === active) return;
        if (o.postbackTarget) { window.__doPostBack(o.postbackTarget, 'activeTabChanged:' + Number(i)); return; }
        active = Number(i); render();
      },
      _commit(i) { active = Number(i); render(); },
      _count: count,
    };
  };

  // ─── ולידטורים (ASP.NET client validation) ─────────────────────────────────
  window.Page_Validators = window.Page_Validators || [];
  window.Page_BlockSubmit = false;
  window.Page_ClientValidate = function (group) {
    let ok = true;
    for (const v of window.Page_Validators) {
      if (group && v.validationgroup && v.validationgroup !== group) continue;
      if (!group && v.validationgroup) continue;
      let valid = true;
      try { valid = typeof v.check === 'function' ? !!v.check() : true; } catch (e) { valid = false; }
      v.isvalid = valid;
      if (v.el) v.el.style.display = valid ? 'none' : '';
      if (!valid) ok = false;
    }
    window.Page_BlockSubmit = !ok;
    return ok;
  };

  window.WebForm_PostBackOptions = function (eventTarget, eventArgument, validation, validationGroup, actionUrl, trackFocus, clientSubmit) {
    return { eventTarget, eventArgument, validation, validationGroup, actionUrl, trackFocus, clientSubmit };
  };
  window.WebForm_DoPostBackWithOptions = function (options) {
    if (options.validation && !window.Page_ClientValidate(options.validationGroup)) return;
    window.__doPostBack(options.eventTarget, options.eventArgument);
  };

  window.ShowLoaderPopUp = function () { /* האתר מציג ספינר */ };
})();
