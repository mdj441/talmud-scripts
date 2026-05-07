// ==UserScript==
// @name         תלמוד - קליטת תלמידים
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  עיבוד אוטומטי של קליטת תלמידים במערכת תלמוד - talmud.edu.gov.il
// @author       מרדכי יאקאב
// @match        https://talmud.edu.gov.il/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const BASE = 'ContentPlaceHolder1_tabStudyTypeDetails_StudentList_ucStudentsSearchDetails';

  const IDs = {
    tabContainer   : 'ContentPlaceHolder1_tabStudyTypeDetails',
    idField        : `${BASE}_txtStudenPassport`,
    searchBtn      : `${BASE}_btnSearch`,
    countLabel     : `${BASE}_lblCountSearch`,
    grid           : `${BASE}_gvIStudents`,
    absorbBtn      : 'ContentPlaceHolder1_btnStudentAcceptence3',
    modal          : `${BASE}_pnlAcceptStudent`,
    idTypeDropdown : `${BASE}_ddlPopIdentityType`,
    absorbIdField  : `${BASE}_txtIdentifier`,
    birthDateField : `${BASE}_ctlBirthDate_txtDate`,
    countryDropdown: `${BASE}_ddlCountryOfOrigine`,
    startDateField : `${BASE}_ctlAcceptanceDate_txtDate`,
    confirmBtn     : `${BASE}_LinkButton1`,
    cancelBtn      : `${BASE}_LinkButton2`,
    saveBtn        : 'ContentPlaceHolder1_btnSaveTab3',
  };

  const SS_KEY      = 'tmAbsorbScript_v3';
  const STOP_KEY    = 'tmAbsorbScript_v3_stopped';
  const ATTEMPT_KEY = 'tmAbsorbScript_v3_resumeAttempts';
  const STUDENT_TIMEOUT_MS = 60000;

  let queue = [], results = [], curIdx = 0, running = false, stopFlag = false;

  const $el   = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const maskId = id => { const s = String(id); return s.length <= 4 ? '****' : '*'.repeat(s.length - 4) + s.slice(-4); };
  const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // ─── Stop check ──────────────────────────────────────────────────────────────
  function isStopped() {
    if (stopFlag) return true;
    if (sessionStorage.getItem(STOP_KEY) === '1') { stopFlag = true; return true; }
    return false;
  }

  function checkStop(where) {
    if (isStopped()) throw new Error(`__STOPPED__@${where}`);
  }

  async function sleepCheckStop(ms) {
    const step = 100;
    let elapsed = 0;
    while (elapsed < ms) {
      if (isStopped()) throw new Error('__STOPPED__@sleep');
      const wait = Math.min(step, ms - elapsed);
      await sleep(wait);
      elapsed += wait;
    }
  }

  // ─── Date helpers ────────────────────────────────────────────────────────────
  function todayDate() {
    const d = new Date();
    return [String(d.getDate()).padStart(2,'0'), String(d.getMonth()+1).padStart(2,'0'), d.getFullYear()].join('/');
  }

  function getEffectiveStartDate() {
    return ($el('tma-start-date')?.value || '').trim() || todayDate();
  }

  function execHref(id) {
    const el = $el(id);
    if (!el) throw new Error(`Element not found: ${id}`);
    const href = el.getAttribute('href') || '';
    if (href.startsWith('javascript:')) { try { eval(href.replace(/^javascript:/, '')); } catch(e) {} }
    else el.click();
  }

  // ─── PRM wait ────────────────────────────────────────────────────────────────
  function waitPRM({ startTimeoutMs = 2500, totalTimeoutMs = 20000 } = {}) {
    return new Promise((resolve, reject) => {
      let prm;
      try { prm = Sys.WebForms.PageRequestManager.getInstance(); }
      catch(e) { resolve(); return; }
      if (!prm) { resolve(); return; }

      let resolved = false;
      function done(err) {
        if (resolved) return; resolved = true;
        clearTimeout(totalTimer); clearInterval(startPoller); clearInterval(stopPoller);
        try { prm.remove_endRequest(handler); } catch(e) {}
        if (err) reject(err); else resolve();
      }
      function handler(s, e) {
        log(`[PRM] endRequest${e.get_error() ? ' ERROR:'+e.get_error().message : ' OK'}`);
        done(e.get_error() ? new Error('PRM: '+e.get_error().message) : null);
      }
      prm.add_endRequest(handler);

      const totalTimer = setTimeout(() => { log(`[PRM] Timeout after ${totalTimeoutMs}ms`); done(new Error('PRM timeout')); }, totalTimeoutMs);
      const stopPoller = setInterval(() => {
        if (isStopped()) done(new Error('__STOPPED__@PRM'));
      }, 200);

      let started = false;
      const startPoller = setInterval(() => { if (prm._isInAsyncPostBack) { started = true; clearInterval(startPoller); } }, 50);
      setTimeout(() => { if (!started && !prm._isInAsyncPostBack) { log(`[PRM] No postback within ${startTimeoutMs}ms — resolving`); done(null); } }, startTimeoutMs);
    });
  }

  // ─── Country mapping ─────────────────────────────────────────────────────────
  const COUNTRY_MAP = {
    'ארה"ב':'710','ארהב':'710','ארצות הברית':'710','אמריקה':'710',
    'בלגיה':'620',
    'אנגליה':'590','הממלכה המאוחדת':'590',
    'צרפת':'640','קנדה':'700','אוסטרליה':'860','ארגנטינה':'830',
    'דרום אפריקה':'270','ברזיל':'810','מקסיקו':'720',
    'שוויץ':'520','שווייץ':'520',
    'הולנד':'610','גרמניה':'500','איטליה':'670','ספרד':'660',
    'אוסטריה':'510','אוקראינה':'305','רוסיה':'306','אוזבקיסטן':'315',
    'מרוקו':'200','שוודיה':'560','פינלנד':'550','דנמרק':'580',
    'נורבגיה':'570','איסלנד':'581','אירלנד':'600','ניו זילנד':'870',
    'usa':'710','us':'710','america':'710','united states':'710',
    'belgium':'620','uk':'590','england':'590','united kingdom':'590','britain':'590',
    'france':'640','canada':'700','australia':'860','argentina':'830',
    'south africa':'270','brazil':'810','mexico':'720',
    'switzerland':'520','swiss':'520',
    'netherlands':'610','holland':'610','germany':'500','italy':'670','spain':'660',
    'austria':'510','ukraine':'305','russia':'306','uzbekistan':'315',
    'morocco':'200','sweden':'560','finland':'550','denmark':'580',
    'norway':'570','iceland':'581','ireland':'600','new zealand':'870',
  };

  function resolveCountry(input) {
    if (!input) return null;
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) return trimmed;
    return COUNTRY_MAP[trimmed.toLowerCase()] || COUNTRY_MAP[trimmed] || null;
  }

  // ─── Input parsing ───────────────────────────────────────────────────────────
  function parseInput(text) {
    return text.trim().split(/\n/).flatMap(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return [];
      const parts = (line.includes('\t') || line.includes(','))
        ? line.split(/[\t,]+/).map(p => p.trim()).filter(Boolean)
        : line.split(/\s+/);
      if (parts.length < 3) { log(`[Parse] Skipping: "${line}"`); return []; }
      const branch = parts[0].padStart(2,'0'), studyType = parts[1], identity = parts[2];
      if (!identity) return [];
      const isPassport = /[a-zA-Z]/.test(identity);
      let birthDate = '', country = '', countryValue = null;
      if (isPassport) {
        birthDate    = parts[3]?.trim() || '';
        country      = parts.slice(4).join(' ').trim();
        countryValue = resolveCountry(country);
        if (!birthDate)           log(`[Parse] ⚠️ Passport without birthDate: ${maskId(identity)}`);
        if (!country)             log(`[Parse] ⚠️ Passport without country: ${maskId(identity)}`);
        if (country && !countryValue) log(`[Parse] ⚠️ Unknown country "${country}" for ${maskId(identity)}`);
      }
      return [{ branch, studyType, identity, idType: isPassport ? 'passport' : 'tz', birthDate, country, countryValue }];
    });
  }

  // ─── Page info ───────────────────────────────────────────────────────────────
  function getPageInfo() {
    const url = window.location.href;
    const h1  = document.querySelector('h1')?.textContent?.trim() || '';
    const isStudyTypePage = url.includes('StudyTypeDetails.aspx');
    const isInstitutePage = url.includes('InstitutesDetails.aspx');
    const isAssociationPage = url.includes('AssociationsDetails.aspx');
    const stMatch = h1.match(/סוג לימוד\s+(\d+)/);
    const currentStudyType = stMatch ? stMatch[1] : null;
    let currentBranch = null;
    const branchMatch = h1.match(/סניף\s+(\d+)/);
    if (branchMatch) {
      currentBranch = branchMatch[1].padStart(2,'0');
    } else if (isStudyTypePage) {
      for (const link of document.querySelectorAll('.BreadCrumb a,[id*="BreadCrumb"] a,[id*="SiteMap"] a')) {
        const t = link.textContent.trim();
        if (/^\d{1,3}$/.test(t)) { currentBranch = t.padStart(2,'0'); break; }
      }
    }
    return { isStudyTypePage, isInstitutePage, isAssociationPage, currentStudyType, currentBranch };
  }

  // ─── Grid analysis ───────────────────────────────────────────────────────────
  function analyzeGrid(identity) {
    const countText  = $el(IDs.countLabel)?.textContent?.trim() || '';
    const countMatch = countText.match(/נמצאו (\d+)/);
    const count      = countMatch ? parseInt(countMatch[1]) : 0;
    log(`[Grid] "${countText}" → count=${count}`);
    if (count === 0) return { found: false };
    const grid = $el(IDs.grid);
    if (!grid) return { found: false };
    const normalize = s => String(s).replace(/^0+/,'');
    let firstDataId = null;
    for (const row of grid.querySelectorAll('tr')) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;
      const rowId = cells[3]?.textContent?.trim();
      if (!rowId) continue;
      if (!firstDataId) firstDataId = rowId;
      if (normalize(rowId) === normalize(identity)) return { found: true };
    }
    if (count === 1 && firstDataId) { log(`[Grid] Fallback: count=1`); return { found: true }; }
    return { found: false };
  }

  // ─── Dialog handling ─────────────────────────────────────────────────────────
  function detectAndDismissDialog() {
    const candidates = [
      { id:'ContentPlaceHolder1_ucMessagePopUp_btnContinue', type:'warning' },
      { id:'ContentPlaceHolder1_ucMessagePopUp_btnOK',       type:'success' },
      { id:'ucMessagePopUp_btnOK',                           type:'success' },
      { id:'ucMessagePopUp_btnContinue',                     type:'warning' },
      { id:'btnOKMessage',                                   type:'success' },
    ];
    for (const { id, type } of candidates) {
      const btn = $el(id);
      if (btn && window.getComputedStyle(btn).display !== 'none') { log(`[Dialog] ${type} #${id}`); btn.click(); return type; }
    }
    for (const b of document.querySelectorAll('a,button,input[type=button]')) {
      const text = (b.textContent || b.value || '').trim();
      if (text === 'המשך' || text === 'אישור') {
        const parent = b.closest('[style*="display: block"],[style*="display:block"]');
        if (parent) { log(`[Dialog] Fallback "${text}"`); b.click(); return text === 'המשך' ? 'warning' : 'success'; }
      }
    }
    return 'none';
  }

  // ─── Sidebar navigation ──────────────────────────────────────────────────────
  function findSidebarLink(keyInHref) {
    for (const link of document.querySelectorAll('a[id*="tvTalmudt"]')) {
      if ((link.getAttribute('href') || '').includes(keyInHref)) return link;
    }
    return null;
  }

  async function navigateToBranch(branchCode) {
    const padded = branchCode.padStart(2,'0');
    const link   = findSidebarLink(`\\\\${padded}'`);
    if (!link) { log(`[Nav] Branch ${padded} not found`); return false; }
    log(`[Nav] → Branch ${padded}`);
    saveState();
    eval((link.getAttribute('href') || '').replace('javascript:',''));
    return true;
  }

  async function navigateToStudyType(branchCode, studyTypeCode) {
    const padded  = branchCode.padStart(2,'0');
    const keyword = `(${studyTypeCode})`;

    function findSTLink() {
      for (const link of document.querySelectorAll('a[id*="tvTalmudt"]')) {
        const href = link.getAttribute('href') || '';
        if (href.includes(`\\\\${padded}\\\\`) && href.includes(keyword)) return link;
      }
      return findSidebarLink(keyword);
    }

    let stLink = findSTLink();
    if (!stLink) {
      log(`[Nav] Expanding branch ${padded}`);
      for (const l of document.querySelectorAll('a[id*="tvTalmudt"]')) {
        if (l.textContent.trim() === padded) {
          const match = l.id.match(/tvTalmudt(\d+)$/);
          if (match) {
            const toggleLink = $el(`ucTalmudSideBar_tvTalmudn${match[1]}`);
            if (toggleLink) { const h = toggleLink.getAttribute('href')||''; if (h.startsWith('javascript:')) eval(h.replace('javascript:','')); }
          }
          break;
        }
      }
      await sleepCheckStop(3000); stLink = findSTLink();
      if (!stLink) { await sleepCheckStop(2000); stLink = findSTLink(); }
    }
    if (!stLink) { log(`[Nav] StudyType ${studyTypeCode} not found in branch ${padded}`); return false; }
    log(`[Nav] → ST ${studyTypeCode} in branch ${padded}`);
    saveState();
    eval((stLink.getAttribute('href') || '').replace('javascript:',''));
    return true;
  }

  // ─── State save/load ─────────────────────────────────────────────────────────
  function saveState() {
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify({ queue, results, curIdx }));
    } catch(e) { log(`[State] Save error: ${e.message}`); }
  }

  function resumeFromStorage() {
    const saved = sessionStorage.getItem(SS_KEY);
    if (!saved) return false;
    try {
      const state = JSON.parse(saved);
      queue = state.queue||[]; results = state.results||[]; curIdx = state.curIdx||0;
      log(`[Resume] curIdx=${curIdx} queue=${queue.length} results=${results.length}`);
      return true;
    } catch(e) { log(`[Resume] Parse error: ${e.message}`); sessionStorage.removeItem(SS_KEY); return false; }
  }

  // ─── Process one student ─────────────────────────────────────────────────────
  async function processStudent(task) {
    const { branch, studyType, identity, birthDate, country, countryValue, idType } = task;
    log(`\n${'─'.repeat(40)}`);
    log(`▶ branch=${branch} ST=${studyType} id=${maskId(identity)} type=${idType}${birthDate ? ' bdate='+birthDate : ''}${country ? ' country='+country : ''}`);
    updateStatus(`מעבד: סניף ${branch} | סוג ${studyType} | ${identity}`);

    if (idType === 'passport') {
      if (!birthDate)    throw new Error('דרכון ללא תאריך לידה — חובה');
      if (!countryValue) throw new Error(`דרכון ללא ארץ תקפה — קלט: "${country || 'ריק'}"`);
    }

    try {
      checkStop('start');

      // Step 1: tab
      log('[Step 1] Switch to tab רשימת תלמידים');
      const tabCtrl = $find(IDs.tabContainer);
      if (tabCtrl) { tabCtrl.set_activeTabIndex(2); await sleepCheckStop(500); }
      else log('[Step 1] ⚠️ TabContainer not found');

      checkStop('after-tab');

      // Step 2: pre-check duplicate
      log(`[Step 2] Pre-check: ${maskId(identity)}`);
      const idFieldEl = $el(IDs.idField);
      if (idFieldEl) {
        idFieldEl.value = identity;
        idFieldEl.dispatchEvent(new Event('change', { bubbles:true }));
        await sleepCheckStop(200);
        const searchWait = waitPRM({ startTimeoutMs:3000, totalTimeoutMs:20000 });
        $el(IDs.searchBtn)?.click();
        await searchWait; await sleepCheckStop(400);
        if (analyzeGrid(identity).found) { log('[Step 2] Already exists'); return { branch, studyType, identity, status:'כבר קיים ביחידה' }; }
      } else log('[Step 2] ⚠️ No search field');

      checkStop('after-precheck');

      // Step 3: absorb button
      log('[Step 3] Clicking קליטה');
      if (!$el(IDs.absorbBtn)) throw new Error(`כפתור קליטה לא נמצא (${IDs.absorbBtn})`);
      const absorbWait = waitPRM({ startTimeoutMs:3000, totalTimeoutMs:20000 });
      execHref(IDs.absorbBtn);
      await absorbWait; await sleepCheckStop(500);

      checkStop('after-absorb-click');

      // Step 4: modal visible
      const modal = $el(IDs.modal);
      const modalVisible = modal && window.getComputedStyle(modal).display !== 'none';
      log(`[Step 4] Modal visible: ${modalVisible}`);
      if (!modalVisible) throw new Error('מודאל קליטה לא נפתח');

      // Step 5: id type
      const idTypeValue = idType === 'passport' ? '2' : '1';
      const idTypeEl = $el(IDs.idTypeDropdown);
      if (idTypeEl && idTypeEl.value !== idTypeValue) {
        log(`[Step 5] Setting ID type → ${idTypeValue}`);
        idTypeEl.value = idTypeValue;
        idTypeEl.dispatchEvent(new Event('change', { bubbles:true }));
        await waitPRM({ startTimeoutMs:1500, totalTimeoutMs:10000 });
        await sleepCheckStop(300);
      }

      checkStop('after-idtype');

      // Step 6: identity
      log(`[Step 6] Entering identity`);
      const absorbIdEl = $el(IDs.absorbIdField);
      if (!absorbIdEl) throw new Error('שדה זהות במודאל לא נמצא');
      absorbIdEl.value = identity;
      absorbIdEl.dispatchEvent(new Event('change', { bubbles:true }));
      absorbIdEl.dispatchEvent(new Event('blur',   { bubbles:true }));
      await sleepCheckStop(200);

      // Step 7: passport extras
      if (idType === 'passport') {
        log(`[Step 7a] birthDate "${birthDate}"`);
        const birthEl = $el(IDs.birthDateField);
        if (!birthEl) throw new Error('שדה תאריך לידה לא נמצא');
        birthEl.value = birthDate;
        birthEl.dispatchEvent(new Event('change', { bubbles:true }));
        birthEl.dispatchEvent(new Event('blur',   { bubbles:true }));
        await sleepCheckStop(200);

        log(`[Step 7b] country "${country}" (value=${countryValue})`);
        const countryEl = $el(IDs.countryDropdown);
        if (!countryEl) throw new Error('שדה ארץ דרכון לא נמצא');
        const optionExists = Array.from(countryEl.options).some(o => o.value === countryValue);
        if (!optionExists) throw new Error(`ארץ "${country}" (value=${countryValue}) לא נמצאת ברשימה`);
        countryEl.value = countryValue;
        countryEl.dispatchEvent(new Event('change', { bubbles:true }));
        await sleepCheckStop(200);
        if (countryEl.value !== countryValue) throw new Error(`כשל בבחירת ארץ "${country}" — נשאר על "${countryEl.options[countryEl.selectedIndex]?.text}"`);
        log(`[Step 7b] Country confirmed: "${countryEl.options[countryEl.selectedIndex]?.text}"`);
      }

      checkStop('after-fields');

      // Step 8: start date
      const startDate   = getEffectiveStartDate();
      const startDateEl = $el(IDs.startDateField);
      if (startDateEl) {
        if (startDateEl.value !== startDate) {
          log(`[Step 8] startDate "${startDate}"`);
          startDateEl.value = startDate;
          startDateEl.dispatchEvent(new Event('change', { bubbles:true }));
          startDateEl.dispatchEvent(new Event('blur',   { bubbles:true }));
          await sleepCheckStop(200);
        } else log(`[Step 8] startDate already "${startDate}"`);
      } else log('[Step 8] ⚠️ No start date field');

      checkStop('before-confirm');

      // Step 9: confirm
      log('[Step 9] Clicking אישור');
      const confirmEl = $el(IDs.confirmBtn);
      if (!confirmEl) throw new Error('כפתור אישור לא נמצא');
      const confirmHref = confirmEl.getAttribute('href') || '';
      const confirmWait = waitPRM({ startTimeoutMs:3000, totalTimeoutMs:20000 });
      if (confirmHref.startsWith('javascript:')) eval(confirmHref.replace('javascript:',''));
      else confirmEl.click();
      await confirmWait; await sleepCheckStop(500);

      // Step 10: dialogs
      log('[Step 10] Handling dialogs');
      let dialogResult = detectAndDismissDialog();
      log(`[Step 10] Dialog 1: ${dialogResult}`);
      if (dialogResult === 'warning') {
        await waitPRM({ startTimeoutMs:2000, totalTimeoutMs:15000 });
        await sleepCheckStop(500);
        dialogResult = detectAndDismissDialog();
        log(`[Step 10] Dialog 2: ${dialogResult}`);
      }
      if (dialogResult === 'none') {
        await sleepCheckStop(1000);
        dialogResult = detectAndDismissDialog();
        log(`[Step 10] Dialog retry: ${dialogResult}`);
      }
      await sleepCheckStop(400);

      // Step 11: verify
      log('[Step 11] Verifying');
      const modalAfter = $el(IDs.modal);
      const stillOpen  = modalAfter && window.getComputedStyle(modalAfter).display !== 'none';
      if (stillOpen) {
        const errMsgs = [];
        document.querySelectorAll('[id*="lblError"],[id*="lblMessage"],[class*="error"],[class*="validator"]').forEach(el => {
          const txt = el.textContent.trim();
          if (txt && el.offsetParent !== null && window.getComputedStyle(el).display !== 'none') errMsgs.push(txt.substring(0,100));
        });
        const errText = errMsgs.length ? ` (${errMsgs.slice(0,2).join(' | ')})` : '';
        log(`[Step 11] Modal still open${errText}`);
        try { $el(IDs.cancelBtn)?.click(); await sleep(400); } catch(e) {}
        return { branch, studyType, identity, status: `קליטה לא הושלמה${errText}` };
      }

      if (idFieldEl) {
        idFieldEl.value = identity;
        idFieldEl.dispatchEvent(new Event('change', { bubbles:true }));
        await sleepCheckStop(200);
        const verifyWait = waitPRM({ startTimeoutMs:3000, totalTimeoutMs:20000 });
        $el(IDs.searchBtn)?.click();
        await verifyWait; await sleepCheckStop(400);
        const verify = analyzeGrid(identity);
        log(`[Step 11] Grid verify: found=${verify.found}`);
        if (verify.found) { log('▶ RESULT: הצליח'); return { branch, studyType, identity, status:'הצליח' }; }
        else { log('▶ RESULT: לא בגריד'); return { branch, studyType, identity, status:'קליטה לא אומתה (לא בגריד)' }; }
      }
      return { branch, studyType, identity, status:'הצליח (ללא אימות)' };

    } catch(err) {
      if (err.message && err.message.startsWith('__STOPPED__')) throw err;
      log(`▶ ERROR: ${err.message}`);
      try { const m = $el(IDs.modal); if (m && window.getComputedStyle(m).display !== 'none') { $el(IDs.cancelBtn)?.click(); await sleep(400); } } catch(e2) {}
      return { branch, studyType, identity, status: `שגיאה: ${err.message}` };
    }
  }

  // ─── Safe wrapper: timeout + retry ───────────────────────────────────────────
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`תהליך תקוע — חרג מ-${ms/1000} שניות`)), ms);
      const stopPoller = setInterval(() => {
        if (isStopped()) { clearInterval(stopPoller); clearTimeout(timer); reject(new Error('__STOPPED__@timeout')); }
      }, 200);
      promise.then(
        val => { clearTimeout(timer); clearInterval(stopPoller); resolve(val); },
        err => { clearTimeout(timer); clearInterval(stopPoller); reject(err); }
      );
    });
  }

  async function processStudentSafe(task) {
    try {
      log(`[Safe] Attempt 1 for ${maskId(task.identity)}`);
      return await withTimeout(processStudent(task), STUDENT_TIMEOUT_MS);
    } catch(err) {
      if (err.message && err.message.startsWith('__STOPPED__')) throw err;
      log(`[Safe] Attempt 1 failed: ${err.message}`);
      try {
        const m = $el(IDs.modal);
        if (m && window.getComputedStyle(m).display !== 'none') {
          log('[Safe] Closing stuck modal before retry');
          $el(IDs.cancelBtn)?.click();
          await sleep(800);
        }
      } catch(e) {}

      if (isStopped()) throw new Error('__STOPPED__@between-attempts');

      try {
        log(`[Safe] Attempt 2 for ${maskId(task.identity)}`);
        await sleep(1000);
        return await withTimeout(processStudent(task), STUDENT_TIMEOUT_MS);
      } catch(err2) {
        if (err2.message && err2.message.startsWith('__STOPPED__')) throw err2;
        log(`[Safe] Attempt 2 failed: ${err2.message} — skipping`);
        try {
          const m = $el(IDs.modal);
          if (m && window.getComputedStyle(m).display !== 'none') {
            $el(IDs.cancelBtn)?.click();
            await sleep(500);
          }
        } catch(e) {}
        return {
          branch    : task.branch,
          studyType : task.studyType,
          identity  : task.identity,
          status    : `שגיאה (2 ניסיונות): ${err2.message}`
        };
      }
    }
  }

  // ─── Fill remaining queue with reason ────────────────────────────────────────
  function fillRemainingAsNotProcessed(reason) {
    while (curIdx < queue.length) {
      const t = queue[curIdx];
      results.push({
        branch    : t.branch,
        studyType : t.studyType,
        identity  : t.identity,
        status    : reason
      });
      curIdx++;
    }
  }

  // ─── Queue runner ────────────────────────────────────────────────────────────
  async function runQueue() {
    running = true;
    log(`\n${'═'.repeat(40)}`);
    log(`🚀 RUN — ${queue.length} students, idx=${curIdx}, startDate="${getEffectiveStartDate()}"`);

    while (curIdx < queue.length) {
      if (isStopped()) {
        log('⛔ Stopped — filling remaining as לא עובד');
        fillRemainingAsNotProcessed('לא עובד (נעצר)');
        break;
      }

      const task = queue[curIdx];
      updateProgress();

      const pageInfo     = getPageInfo();
      const targetBranch = task.branch.padStart(2,'0');
      const targetST     = String(task.studyType);

      log(`\nQueue [${curIdx+1}/${queue.length}] branch=${targetBranch} ST=${targetST} id=${maskId(task.identity)}`);
      log(`Page: isSTPage=${pageInfo.isStudyTypePage} isInstPage=${pageInfo.isInstitutePage} curBranch=${pageInfo.currentBranch} curST=${pageInfo.currentStudyType}`);

      let navNeeded = false, navResult = true;

      if (pageInfo.isStudyTypePage && pageInfo.currentBranch === targetBranch && pageInfo.currentStudyType === targetST) {
        log('[Nav] ✓ On correct page');
      } else if (pageInfo.isInstitutePage && pageInfo.currentBranch === targetBranch) {
        log(`[Nav] On branch page → ST ${targetST}`); navNeeded = true;
        navResult = await navigateToStudyType(task.branch, task.studyType);
      } else if (pageInfo.isStudyTypePage && pageInfo.currentBranch !== targetBranch) {
        log(`[Nav] Wrong branch → ${targetBranch}`); navNeeded = true;
        navResult = await navigateToBranch(task.branch);
      } else if (pageInfo.isStudyTypePage && pageInfo.currentStudyType !== targetST) {
        log(`[Nav] Same branch, wrong ST → ${targetST}`); navNeeded = true;
        navResult = await navigateToStudyType(task.branch, task.studyType);
      } else {
        log(`[Nav] Not on relevant page → branch ${targetBranch}`); navNeeded = true;
        navResult = await navigateToBranch(task.branch);
      }

      if (isStopped()) {
        log('⛔ Stopped during navigation');
        fillRemainingAsNotProcessed('לא עובד (נעצר)');
        break;
      }

      if (navNeeded && !navResult) {
        const errStatus = (pageInfo.isInstitutePage || pageInfo.isStudyTypePage)
          ? `סוג לימוד ${task.studyType} לא נמצא`
          : `סניף ${task.branch} לא נמצא`;
        results.push({ branch:task.branch, studyType:task.studyType, identity:task.identity, status:errStatus });
        curIdx++; saveState(); renderResultsInPanel(); updateProgress(); continue;
      }

      if (navNeeded && navResult) {
        saveState();
        return; // reload יקרה — resume ימשיך
      }

      try {
        const result = await processStudentSafe(task);
        results.push(result);
        curIdx++;
        saveState();
        updateProgress();
        renderResultsInPanel();
      } catch(stopErr) {
        log(`⛔ Stopped mid-processing: ${stopErr.message}`);
        results.push({
          branch    : task.branch,
          studyType : task.studyType,
          identity  : task.identity,
          status    : 'נעצר באמצע עיבוד'
        });
        curIdx++;
        fillRemainingAsNotProcessed('לא עובד (נעצר)');
        saveState();
        renderResultsInPanel(); updateProgress();
        break;
      }

      await sleep(400);
    }

    running = false;
    sessionStorage.removeItem(SS_KEY);
    sessionStorage.removeItem(STOP_KEY);
    sessionStorage.removeItem(ATTEMPT_KEY);
    stopFlag = false;

    const s = results.reduce((a,r) => {
      const st = r.status || '';
      if (st === 'הצליח' || st === 'הצליח (ללא אימות)') a.ok++;
      else if (st === 'כבר קיים ביחידה') a.already++;
      else if (st.includes('לא נמצא')) a.notFound++;
      else if (st.includes('נעצר') || st.includes('לא עובד')) a.stopped++;
      else a.error++;
      return a;
    }, { ok:0, notFound:0, already:0, error:0, stopped:0 });

    log(`\n${'═'.repeat(40)}`);
    const wasStopped = s.stopped > 0;
    log(wasStopped ? '⛔ נעצר ע"י המשתמש' : '✅ הסתיים!');
    log(`Summary: הצליח=${s.ok} | כבר קיים=${s.already} | לא נמצא=${s.notFound} | שגיאה=${s.error} | לא עובד=${s.stopped}`);
    updateStatus(wasStopped ? `נעצר (${s.ok} נקלטו, ${s.stopped} לא עובדו)` : `הסתיים ✓ (${s.ok} הצליחו)`);
    setButtonsState(false); renderResultsInPanel();
  }

  // ─── Logging ─────────────────────────────────────────────────────────────────
  let logLines = [];
  const MAX_LOG = 500;
  function log(msg) {
    const line = `${new Date().toTimeString().slice(0,8)} ${msg}`;
    console.log('[TM-Absorb]', msg);
    logLines.push(line);
    if (logLines.length > MAX_LOG) logLines.shift();
    const el = $el('tma-log');
    if (el) { el.textContent = logLines.join('\n'); el.scrollTop = el.scrollHeight; }
  }
  function updateStatus(msg)   { const el=$el('tma-status');   if(el) el.textContent=msg; }
  function updateProgress()    { const el=$el('tma-progress'); if(el) el.textContent=`${curIdx} / ${queue.length}`; }
  function setButtonsState(on) { const s=$el('tma-start'); if(s) s.disabled=on; }

  // ─── Results table ───────────────────────────────────────────────────────────
  function renderResultsInPanel() {
    const container = $el('tma-results');
    if (!container) return;
    if (!results.length) { container.innerHTML=''; return; }
    let html = '<table style="width:100%;border-collapse:collapse;font-size:12px">';
    html += `<tr style="background:#0a5c0a;color:#fff;text-align:center">
      <th style="padding:3px 6px">סניף</th><th style="padding:3px 6px">סוג</th>
      <th style="padding:3px 6px">ת.ז./דרכון</th><th style="padding:3px 6px">סטטוס</th></tr>`;
    results.forEach(r => {
      const st   = r.status || '';
      const ok   = st === 'הצליח' || st === 'הצליח (ללא אימות)';
      const skip = st === 'כבר קיים ביחידה' || st.includes('לא נמצא');
      const stopped = st.includes('נעצר') || st.includes('לא עובד');
      const color = ok ? '#0a5c0a' : skip ? '#666' : stopped ? '#a67c00' : '#a00';
      const bg    = ok ? '#f0fff0' : skip ? '#f9f9f9' : stopped ? '#fffbe6' : '#fff5f5';
      html += `<tr style="border-bottom:1px solid #eee;background:${bg}">
        <td style="padding:2px 6px;text-align:center">${escHtml(r.branch)}</td>
        <td style="padding:2px 6px;text-align:center">${escHtml(r.studyType)}</td>
        <td style="padding:2px 6px;direction:ltr;font-family:monospace;font-size:11px">${escHtml(r.identity)}</td>
        <td style="padding:2px 6px;color:${color};font-weight:bold;font-size:11px">${escHtml(st)}</td></tr>`;
    });
    html += '</table>';
    container.innerHTML = html;
  }

  // ─── CSV export ──────────────────────────────────────────────────────────────
  function exportCSV() {
    if (!results.length) { alert('אין תוצאות לייצוא'); return; }
    const rows = [['סניף','סוג לימוד','ת.ז./דרכון','סטטוס'], ...results.map(r=>[r.branch,r.studyType,r.identity,r.status||''])];
    const csv  = '﻿' + rows.map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
    Object.assign(document.createElement('a'),{
      href: URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),
      download: `absorptions_${new Date().toISOString().slice(0,10)}.csv`
    }).click();
    log('[CSV] Exported');
  }

  // ─── Copy log ────────────────────────────────────────────────────────────────
  function copyLog() {
    const text = logLines.join('\n');
    navigator.clipboard.writeText(text).catch(()=>{
      const ta=document.createElement('textarea'); ta.value=text;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }).then(()=>{
      const btn=$el('tma-copy-log');
      if(btn){btn.textContent='✓ הועתק'; setTimeout(()=>{btn.textContent='📋 העתק לוג';},2000);}
    });
    log('[Log] Copied');
  }

  // ─── STOP handler ─────────────────────────────────────────────────────────────
  function handleStop() {
    log('⛔ [Stop] User requested stop');
    stopFlag = true;
    sessionStorage.setItem(STOP_KEY, '1');
    updateStatus('עוצר…');

    try {
      const m = $el(IDs.modal);
      if (m && window.getComputedStyle(m).display !== 'none') {
        $el(IDs.cancelBtn)?.click();
      }
    } catch(e) {}

    if (!running) {
      fillRemainingAsNotProcessed('לא עובד (נעצר)');
      sessionStorage.removeItem(SS_KEY);
      sessionStorage.removeItem(STOP_KEY);
      sessionStorage.removeItem(ATTEMPT_KEY);
      setButtonsState(false);
      renderResultsInPanel();
      updateStatus('נעצר');
      log('⛔ Stopped (was idle)');
    }
  }

  // ─── Create UI ───────────────────────────────────────────────────────────────
  function createUI() {
    if ($el('tma-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'tma-panel';
    panel.style.cssText = `
      position:fixed;top:60px;right:10px;z-index:99999;
      background:#fff;border:2px solid #0a5c0a;border-radius:8px;
      width:430px;font-family:Arial,sans-serif;font-size:13px;
      direction:rtl;box-shadow:0 4px 20px rgba(0,0,0,.35);`;
    panel.innerHTML = `
      <div id="tma-header" style="background:#0a5c0a;color:#fff;padding:8px 12px;
           border-radius:6px 6px 0 0;cursor:move;display:flex;justify-content:space-between;align-items:center;user-select:none">
        <span style="font-weight:bold;font-size:14px">📥 קליטת תלמידים v3.2</span>
        <span id="tma-progress" style="font-size:11px;opacity:.8">0 / 0</span>
        <span id="tma-toggle" style="cursor:pointer;font-size:16px;line-height:1;padding:0 4px">▲</span>
      </div>
      <div id="tma-body" style="padding:10px">
        <div id="tma-status" style="color:#555;font-size:11px;margin-bottom:8px;
             padding:4px 8px;background:#f0f8f0;border-radius:4px">מוכן</div>
        <div style="font-size:10px;color:#777;margin-bottom:5px;direction:ltr;text-align:left;
             background:#f9f9f9;padding:5px 7px;border-radius:3px;border:1px solid #e0e0e0;line-height:1.7">
          <b>ת"ז:</b> &nbsp;&nbsp;<code>סניף סוג ת.ז.</code><br>
          <b>דרכון:</b> <code>סניף סוג דרכון תאריך_לידה ארץ</code><br>
          <span style="color:#aaa">דוגמה: 12 600 AB1234567 15/03/1995 USA</span>
        </div>
        <textarea id="tma-input"
          placeholder="01 300 123456789&#10;12 600 AB1234567 15/03/1995 USA&#10;02 705 987654321"
          style="width:100%;height:100px;box-sizing:border-box;font-size:12px;
                 padding:5px;direction:ltr;resize:vertical;
                 border:1px solid #aaa;border-radius:4px;font-family:monospace"></textarea>
        <div style="display:flex;gap:8px;margin:6px 0;align-items:flex-end">
          <div style="flex:1">
            <label style="font-size:11px;color:#444;display:block;margin-bottom:2px">
              📅 תאריך תחילת לימודים (ריק = היום)
            </label>
            <input id="tma-start-date" type="text" placeholder="${todayDate()}"
              style="width:100%;box-sizing:border-box;font-size:12px;padding:4px;
                     border:1px solid #aaa;border-radius:4px;direction:ltr;font-family:monospace"
              maxlength="10">
          </div>
        </div>
        <div style="display:flex;gap:6px;margin:6px 0">
          <button id="tma-start" style="flex:2;background:#0a5c0a;color:#fff;border:none;
                  padding:8px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px">
            ▶ התחל</button>
          <button id="tma-stop" style="flex:1;background:#922b21;color:#fff;border:none;
                  padding:8px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:bold">
            ⏹ עצור</button>
          <button id="tma-csv" style="flex:1;background:#117a65;color:#fff;border:none;
                  padding:8px;border-radius:4px;cursor:pointer;font-size:13px">
            💾 CSV</button>
        </div>
        <div id="tma-results" style="max-height:170px;overflow-y:auto;margin-bottom:6px;
             border:1px solid #ddd;border-radius:4px;min-height:10px"></div>
        <details id="tma-log-details">
          <summary style="cursor:pointer;font-size:11px;color:#555;padding:3px 0;user-select:none">
            📋 יומן פעילות (לצירוף בדיווח בעיות)</summary>
          <div style="display:flex;gap:4px;margin:4px 0 2px">
            <button id="tma-copy-log" style="flex:1;font-size:11px;padding:3px 6px;
                    background:#555;color:#fff;border:none;border-radius:3px;cursor:pointer">
              📋 העתק לוג</button>
            <button id="tma-clear-log" style="flex:1;font-size:11px;padding:3px 6px;
                    background:#888;color:#fff;border:none;border-radius:3px;cursor:pointer">
              🗑 נקה לוג</button>
          </div>
          <pre id="tma-log" style="max-height:150px;overflow-y:auto;font-size:10px;
               background:#1e1e1e;color:#d4d4d4;padding:8px;margin:0;
               border-radius:4px;white-space:pre-wrap;direction:ltr;
               border:1px solid #333;line-height:1.4"></pre>
        </details>
      </div>
    `;
    document.body.appendChild(panel);

    let drag = null;
    $el('tma-header').addEventListener('mousedown', e => {
      if (e.target.id === 'tma-toggle') return;
      drag = { sx: e.clientX - panel.offsetLeft, sy: e.clientY - panel.offsetTop };
      panel.style.right = 'auto';
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      panel.style.left = (e.clientX - drag.sx) + 'px';
      panel.style.top  = (e.clientY - drag.sy) + 'px';
    });
    document.addEventListener('mouseup', () => { drag = null; });

    $el('tma-toggle').addEventListener('click', () => {
      const body = $el('tma-body'), tog = $el('tma-toggle');
      if (body.style.display === 'none') { body.style.display = ''; tog.textContent = '▲'; }
      else { body.style.display = 'none'; tog.textContent = '▼'; }
    });

    $el('tma-start-date').addEventListener('input', function () {
      let v = this.value.replace(/\D/g, '');
      if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
      if (v.length > 5) v = v.slice(0,5) + '/' + v.slice(5,9);
      this.value = v;
    });

    $el('tma-start').addEventListener('click', async () => {
      if (running) return;
      const text = $el('tma-input').value.trim();
      if (!text) { alert('אנא הדבק רשימת תלמידים'); return; }
      sessionStorage.removeItem(STOP_KEY);
      sessionStorage.removeItem(ATTEMPT_KEY);
      stopFlag = false;
      queue = parseInput(text); results = []; curIdx = 0;
      if (!queue.length) {
        alert('לא נמצאו שורות תקינות\nפורמט ת"ז:    סניף סוג ת.ז.\nפורמט דרכון: סניף סוג דרכון תאריך_לידה ארץ');
        return;
      }
      log(`[Start] Parsed ${queue.length} students`);
      log(`[Start] startDate="${getEffectiveStartDate()}"`);
      setButtonsState(true);
      saveState();
      await runQueue();
    });

    const stopBtn = $el('tma-stop');
    stopBtn.disabled = false;
    stopBtn.addEventListener('click', handleStop, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && running) {
        e.preventDefault();
        handleStop();
      }
    }, true);

    $el('tma-csv').addEventListener('click', exportCSV);
    $el('tma-copy-log').addEventListener('click', copyLog);
    $el('tma-clear-log').addEventListener('click', () => {
      logLines = [];
      const el = $el('tma-log');
      if (el) el.textContent = '';
      log('[Log] Cleared');
    });
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    createUI();
    log(`[Init] v3.2 loaded on ${window.location.href}`);
    log(`[Init] Today: ${todayDate()}`);

    if (sessionStorage.getItem(STOP_KEY) === '1') {
      log('[Init] Stop flag found — clearing state');
      sessionStorage.removeItem(SS_KEY);
      sessionStorage.removeItem(STOP_KEY);
      sessionStorage.removeItem(ATTEMPT_KEY);
      return;
    }

    const resumed = resumeFromStorage();
    if (resumed) {
      log('[Init] Resuming after navigation...');
      $el('tma-input').value = queue.map(t =>
        t.idType === 'passport'
          ? `${t.branch} ${t.studyType} ${t.identity} ${t.birthDate} ${t.country}`.trim()
          : `${t.branch} ${t.studyType} ${t.identity}`
      ).join('\n');
      renderResultsInPanel();
      updateProgress();
      setButtonsState(true);

      const url = window.location.href;
      const isKnownPage = url.includes('StudyTypeDetails.aspx') ||
                          url.includes('InstitutesDetails.aspx') ||
                          url.includes('AssociationsDetails.aspx');

      const attemptsRaw = sessionStorage.getItem(ATTEMPT_KEY);
      let attempts = attemptsRaw ? JSON.parse(attemptsRaw) : { idx: -1, count: 0 };
      if (attempts.idx === curIdx) attempts.count++;
      else attempts = { idx: curIdx, count: 1 };
      sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempts));
      log(`[Init] Resume attempt #${attempts.count} for student idx=${curIdx}`);

      if (attempts.count >= 3 && curIdx < queue.length) {
        const stuckTask = queue[curIdx];
        const pageName = url.split('/').pop().split('?')[0] || 'unknown';
        const reason = !isKnownPage
          ? `שגיאה: ניווט לא צפוי (${pageName})`
          : `שגיאה: תקוע אחרי ${attempts.count} ניסיונות`;
        log(`⚠️ [Init] תלמיד ${maskId(stuckTask.identity)} תקוע — דילוג: ${reason}`);
        results.push({
          branch    : stuckTask.branch,
          studyType : stuckTask.studyType,
          identity  : stuckTask.identity,
          status    : reason
        });
        curIdx++;
        sessionStorage.removeItem(ATTEMPT_KEY);
        saveState();
        renderResultsInPanel();
        updateProgress();
      }

      setTimeout(async () => { await runQueue(); }, 1500);
    } else {
      sessionStorage.removeItem(ATTEMPT_KEY);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 800);
  }
})();
