// ==UserScript==
// @name         תלמוד - עזיבת תלמידים
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  עיבוד אוטומטי של עזיבות תלמידים במערכת תלמוד - talmud.edu.gov.il (האצה: המתנה מבוססת-event)
// @author       מרדכי יאקאב
// @match        https://talmud.edu.gov.il/*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  // ─── Element IDs ─────────────────────────────────────────────────────────────
  const BASE = 'ContentPlaceHolder1_tabInstituteDetails_TabPanel1_ucStudentsSearch';
  const IDs = {
    tabContainer  : 'ContentPlaceHolder1_tabInstituteDetails',
    idField       : `${BASE}_txtStudenPassport`,
    searchBtn     : `${BASE}_btnSearch`,
    countLabel    : `${BASE}_lblCountSearch`,
    grid          : `${BASE}_gvIStudents`,
    deptBtn       : 'ContentPlaceHolder1_btnStudentDeparture3',
    saveBtn       : 'ContentPlaceHolder1_btnSaveTab3',
    modal         : `${BASE}_ucStudentClose_DivCloseStudent`,
    dateField     : `${BASE}_ucStudentClose_ctlLeaveDate_txtDate`,
    reasonDropdown: `${BASE}_ucStudentClose_ddlLeaveReason`,
    confirmBtn    : `${BASE}_ucStudentClose_btnDepartureStudent`,
    cancelBtn     : `${BASE}_ucStudentClose_btnClose`,
  };

  // ─── State ───────────────────────────────────────────────────────────────────
  const SS_KEY = 'tmScript_v4';
  let queue      = [];
  let results    = [];
  let curIdx     = 0;
  let running    = false;
  let stopFlag   = false;

  // Default settings (overridden by UI inputs)
  let defaultLeaveDate   = '';   // empty = today
  let defaultLeaveReason = '1';  // 1 = הפסקת לימודים

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const $el   = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function todayDate() {
    const d = new Date();
    return [
      String(d.getDate()).padStart(2,'0'),
      String(d.getMonth()+1).padStart(2,'0'),
      d.getFullYear()
    ].join('/');
  }

  function getEffectiveLeaveDate() {
    const raw = ($el('tm-leave-date')?.value || '').trim();
    if (raw) return raw;
    return todayDate();
  }

  function getEffectiveLeaveReason() {
    return $el('tm-leave-reason')?.value || '1';
  }

  // Execute javascript: href on <a> elements (.click() doesn't run the href JS)
  function execHref(id) {
    const el = $el(id);
    if (!el) throw new Error(`Element not found: ${id}`);
    const href = el.getAttribute('href') || '';
    if (href.startsWith('javascript:')) {
      try { eval(href.replace(/^javascript:/, '')); } catch(e) { /* ignore cosmetic errors */ }
    } else {
      el.click();
    }
  }

  // ─── PRM wait (event-based) ──────────────────────────────────────────────────
  // Waits for an async ScriptManager postback to complete, using add_beginRequest/
  // add_endRequest events instead of polling. Resolves the moment the server replies.
  // If no postback starts within startTimeoutMs (the fired action didn't trigger a
  // postback) → resolves so the flow can continue.
  function getPRM() {
    try { return Sys.WebForms.PageRequestManager.getInstance(); } catch (e) { return null; }
  }

  function waitPRM({ startTimeoutMs = 2500, totalTimeoutMs = 20000 } = {}) {
    return new Promise((resolve, reject) => {
      const prm = getPRM();
      if (!prm) { setTimeout(resolve, 200); return; }

      let started = false, done = false;

      function onBegin() { started = true; clearTimeout(startTimer); }

      function onEnd(s, e) {
        const err = e && e.get_error && e.get_error();
        if (err && e.set_errorHandled) e.set_errorHandled(true);
        finish(err ? new Error('PRM: ' + (err.message || 'postback error')) : null);
      }

      function finish(err) {
        if (done) return;
        done = true;
        prm.remove_beginRequest(onBegin);
        prm.remove_endRequest(onEnd);
        clearTimeout(startTimer);
        clearTimeout(totalTimer);
        if (err) reject(err); else resolve();
      }

      prm.add_beginRequest(onBegin);
      prm.add_endRequest(onEnd);

      const startTimer = setTimeout(() => {
        if (!started && !prm._isInAsyncPostBack) {
          log(`[PRM] No postback started within ${startTimeoutMs}ms — resolving`);
          finish(null);
        }
      }, startTimeoutMs);

      const totalTimer = setTimeout(() => {
        log(`[PRM] Total timeout after ${totalTimeoutMs}ms`);
        // Abort this student cleanly (caught by processStudent) rather than resolving and
        // risking a second postback fired on top of one still in flight.
        finish(new Error('PRM timeout'));
      }, totalTimeoutMs);
    });
  }

  // ─── Condition wait ──────────────────────────────────────────────────────────
  // Polls `predicate` and resolves true the moment it's truthy, or false on timeout.
  // Replaces fixed sleep()s used to wait for DOM/animation to settle — early-exits
  // as soon as the expected state appears instead of always burning a fixed delay.
  function waitFor(predicate, { timeout = 5000, interval = 30 } = {}) {
    return new Promise(resolve => {
      const t0 = Date.now();
      (function check() {
        let ok = false;
        try { ok = predicate(); } catch (e) { ok = false; }
        if (ok) return resolve(true);
        if (Date.now() - t0 >= timeout) return resolve(false);
        setTimeout(check, interval);
      })();
    });
  }

  const modalVisible = () => {
    const m = $el(IDs.modal);
    return !!(m && window.getComputedStyle(m).display !== 'none');
  };

  // ─── Search ──────────────────────────────────────────────────────────────────
  // Fills the ID field, runs the search, and waits until the grid actually re-renders
  // with fresh results. The postback event-wait alone is NOT enough — endRequest can
  // fire a tick before the UpdatePanel swaps the grid DOM, so analyzeGrid would read a
  // stale/old grid and report a false "לא נמצא". We invalidate the old count + capture
  // the old grid node, then wait until either is replaced. This is what the removed
  // fixed sleep(300) was masking — now it's a condition wait that early-exits.
  async function searchFor(identity) {
    const idFieldEl = $el(IDs.idField);
    if (!idFieldEl) throw new Error('ID field not found');
    idFieldEl.value = identity;
    idFieldEl.dispatchEvent(new Event('change', { bubbles: true }));

    const oldGrid = $el(IDs.grid);
    const cl = $el(IDs.countLabel);
    if (cl) cl.textContent = ''; // invalidate so we can detect the fresh render

    const searchWait = waitPRM({ startTimeoutMs: 3000, totalTimeoutMs: 20000 });
    $el(IDs.searchBtn).click();
    await searchWait;

    const settled = await waitFor(() => {
      const grid = $el(IDs.grid);
      const cnt  = ($el(IDs.countLabel)?.textContent || '').trim();
      return (grid && grid !== oldGrid) || cnt !== '';
    }, { timeout: 6000 });
    if (!settled) log('[Search] ⚠️ grid did not refresh within 6s — analyzing anyway');
  }

  // ─── Grid analysis ───────────────────────────────────────────────────────────
  function analyzeGrid(identity) {
    const countText  = $el(IDs.countLabel)?.textContent?.trim() || '';
    const countMatch = countText.match(/נמצאו (\d+)/);
    const count      = countMatch ? parseInt(countMatch[1]) : 0;
    log(`[Grid] countLabel="${countText}" → count=${count}`);

    if (count === 0) return { found: false, departed: false, departDate: '' };

    const grid = $el(IDs.grid);
    if (!grid) return { found: false, departed: false, departDate: '' };

    const normalize = s => String(s).replace(/^0+/, '');
    let firstDataRow = null;

    for (const row of grid.querySelectorAll('tr')) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 10) continue;
      const rowId = cells[3]?.textContent?.trim();
      if (!rowId) continue;
      if (!firstDataRow) firstDataRow = { rowId, departDate: cells[9]?.textContent?.trim() || '' };
      log(`[Grid] row: id=${rowId} departDate="${cells[9]?.textContent?.trim()}"`);
      if (normalize(rowId) === normalize(identity)) {
        const departDate = cells[9]?.textContent?.trim() || '';
        return { found: true, departed: !!departDate, departDate };
      }
    }

    // If count=1 and ID wasn't matched (leading-zero mismatch etc.) — use first data row
    if (count === 1 && firstDataRow) {
      log(`[Grid] Using first row as fallback (count=1): ${JSON.stringify(firstDataRow)}`);
      return { found: true, departed: !!firstDataRow.departDate, departDate: firstDataRow.departDate };
    }

    log(`[Grid] Identity ${identity} not found in current page`);
    return { found: false, departed: false, departDate: '' };
  }

  // ─── Row selection ───────────────────────────────────────────────────────────
  async function selectFirstActiveRow() {
    const grid = $el(IDs.grid);
    if (!grid) throw new Error('Grid not found');

    let dataRow = null;
    for (const row of grid.querySelectorAll('tr')) {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 10 && cells[3]?.textContent?.trim()) {
        dataRow = row;
        break;
      }
    }
    if (!dataRow) throw new Error('No data row found in grid');

    const cb = dataRow.querySelector('input[type="checkbox"]');
    if (!cb) throw new Error('Checkbox not found in row');

    log(`[Row] TR onclick="${dataRow.getAttribute('onclick')}"`);
    log(`[Row] CB onclick="${cb.getAttribute('onclick')}"`);

    // 1. Run TR onclick → selectedRowStudents(N) → highlights row
    const trOnclick = dataRow.getAttribute('onclick');
    if (trOnclick) { try { eval(trOnclick); } catch(e) { log(`[Row] TR onclick eval error: ${e.message}`); } }

    // 2. Check checkbox and fire its onclick → async PRM (enables עזיבה button server-side)
    cb.checked = true;
    const cbOnclick = cb.getAttribute('onclick');
    if (cbOnclick) {
      const prmWait = waitPRM({ startTimeoutMs: 2000, totalTimeoutMs: 12000 });
      try { eval(cbOnclick); } catch(e) { log(`[Row] CB onclick eval error: ${e.message}`); }
      await prmWait;
    }

    // Wait until the עזיבה button becomes enabled (early-exit instead of fixed sleep)
    const btnEnabled = () => !$el(IDs.deptBtn)?.getAttribute('disabled');
    await waitFor(btnEnabled, { timeout: 2000 });

    const deptBtn = $el(IDs.deptBtn);
    log(`[Row] עזיבה btn after select: class="${deptBtn?.className}" disabled=${deptBtn?.getAttribute('disabled')}`);
    if (deptBtn?.getAttribute('disabled')) {
      // Fallback: call selectedRowStudents directly
      const rowMatch = trOnclick?.match(/selectedRowStudents\('?(\d+)'?\)/);
      if (rowMatch && typeof selectedRowStudents === 'function') {
        log(`[Row] Fallback: calling selectedRowStudents(${rowMatch[1]})`);
        selectedRowStudents(rowMatch[1]);
        await waitFor(btnEnabled, { timeout: 2000 });
      }
      if ($el(IDs.deptBtn)?.getAttribute('disabled')) {
        log('[Row] ⚠️ עזיבה button still shows disabled — proceeding anyway');
      }
    }
  }

  // ─── Shared message popup (ucMessagePopUp) ───────────────────────────────────
  // The site's shared message/confirm dialog (same control used on the messages page).
  // After clicking אישור in the departure modal the server may raise it — e.g. the
  // validation block "תאריך העזיבה לא יכול להיות לפני תאריך הקליטה...". We must surface
  // that text to the user and NEVER click its cancel (which silently reverts).
  function isVisible(el) {
    if (!el) return false;
    // NB: do NOT use offsetParent — the ModalPopupExtender shows the popup with
    // position:fixed, for which offsetParent is always null even when fully visible.
    // getClientRects() returns boxes for rendered elements (incl. fixed) and none for
    // display:none, which is exactly the signal we want.
    if (el.getClientRects().length === 0) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  function getMessagePopup() {
    const panel = $el('ucMessagePopUp_pnlMessagePopup');
    if (!isVisible(panel)) return null;
    const hasContinue = isVisible($el('ucMessagePopUp_btnMOK'));   // "המשך" — soft confirm
    const hasOk       = isVisible($el('ucMessagePopUp_btnMCancel')); // "אישור" — acknowledge/error
    const hasNo       = isVisible($el('ucMessagePopUp_btnMNo'));   // "לא"
    // Panel rendered but no live action button → not a real prompt, ignore (avoid false block).
    if (!hasContinue && !hasOk && !hasNo) return null;
    let text = (panel.innerText || panel.textContent || '').replace(/\s+/g, ' ').trim();
    text = text.replace(/^\s*הודעה\s*/, '').replace(/\s*(המשך|לא|אישור|ביטול|סגור)\s*$/g, '').trim();
    return { text, hasContinue, hasOkOnly: hasOk && !hasContinue };
  }

  function hideMessagePopup() {
    try {
      if (typeof window.$find === 'function') {
        const mpe = window.$find('ucMessagePopUp_ModalPopupExtender1');
        if (mpe && typeof mpe.hide === 'function') { mpe.hide(); return; }
      }
    } catch (e) { /* ignore */ }
    const ok = $el('ucMessagePopUp_btnMCancel'); // acknowledge ("אישור") — closes the error
    if (isVisible(ok)) ok.click();
  }

  // Close the departure modal cleanly (used after a blocked departure) so the next
  // student starts from the list, not a half-open modal.
  async function closeDepartureModalIfOpen() {
    if (!modalVisible()) return;
    const cancel = $el(IDs.cancelBtn);
    if (!cancel) return;
    const href = cancel.getAttribute('href') || '';
    const w = waitPRM({ startTimeoutMs: 800, totalTimeoutMs: 8000 });
    if (href.startsWith('javascript:')) { try { eval(href.replace('javascript:', '')); } catch(e){} }
    else cancel.click();
    await w;
  }

  // ─── Page guard ──────────────────────────────────────────────────────────────
  // The whole flow lives on the institute-details page (פרטי מוסד), which has the
  // students tab + search field. On other pages (e.g. StudentsAllSearch.aspx) those
  // elements are absent and trying to branch-navigate trips a site bug. Detect early.
  function onInstitutePage() {
    return !!($el(IDs.idField) || $el(IDs.tabContainer) || $el(IDs.searchBtn));
  }

  // ─── Branch detection ─────────────────────────────────────────────────────────
  function getCurrentBranchCode() {
    // 1. Breadcrumb last numeric link
    const bcLinks = document.querySelectorAll('.BreadCrumb a, [class*="breadcrumb"] a');
    for (const link of bcLinks) {
      const t = link.textContent.trim();
      if (/^\d{1,3}$/.test(t)) { log(`[Branch] Detected via breadcrumb: "${t}"`); return t.padStart(2,'0'); }
    }
    // 2. H1 heading
    const h1 = document.querySelector('h1');
    if (h1) {
      const m = h1.textContent.match(/סניף (\d+)/);
      if (m) { log(`[Branch] Detected via H1: "${m[1]}"`); return m[1].padStart(2,'0'); }
    }
    // 3. "מספר סניף" label next sibling
    document.querySelectorAll('span, td').forEach(el => {
      if (el.textContent.trim() === 'מספר סניף') {
        const next = el.nextElementSibling || el.parentElement?.nextElementSibling;
        const code = next?.textContent?.trim();
        if (code && /^\d{1,3}$/.test(code)) { log(`[Branch] Detected via label: "${code}"`); return code.padStart(2,'0'); }
      }
    });
    log('[Branch] Could not detect current branch');
    return null;
  }

  // ─── Branch navigation (full page reload) ────────────────────────────────────
  async function navigateToBranch(branchCode) {
    const padded = branchCode.padStart(2,'0');
    let targetLink = null;
    document.querySelectorAll('a[href*="tvTalmud"]').forEach(link => {
      const t = link.textContent.trim();
      if (t === padded || t === branchCode) targetLink = link;
    });

    if (!targetLink) {
      log(`[Nav] Branch ${branchCode} not found in sidebar`);
      return false;
    }

    log(`[Nav] Branch ${branchCode} link: ${targetLink.getAttribute('href').substring(0,70)}`);
    sessionStorage.setItem(SS_KEY, JSON.stringify({ queue, results, curIdx }));
    log(`[Nav] State saved (curIdx=${curIdx}), navigating...`);

    const href = targetLink.getAttribute('href');
    if (href?.startsWith('javascript:')) {
      try { eval(href.replace('javascript:', '')); } catch (e) { log(`[Nav] eval error: ${e.message}`); }
    } else {
      targetLink.click();
    }
    return true;
  }

  // ─── Auto-navigation with loop protection ────────────────────────────────────
  // Navigate to a branch's institute page via the sidebar. Tracks attempts per target
  // in sessionStorage so a navigation that never reaches the page (e.g. a site quirk on
  // some pages) gives up after a few tries instead of looping forever on reload.
  const NAV_KEY = 'tmScript_v5_nav';
  function getNav()   { try { return JSON.parse(sessionStorage.getItem(NAV_KEY) || '{}'); } catch (e) { return {}; } }
  function clearNav() { sessionStorage.removeItem(NAV_KEY); }

  async function tryNavigate(branch) {
    const nav = getNav();
    const attempts = (nav.target === branch ? (nav.attempts || 0) : 0) + 1;
    if (attempts > 3) { log(`[Nav] Giving up on branch ${branch} after ${attempts - 1} attempts`); clearNav(); return 'giveup'; }
    sessionStorage.setItem(NAV_KEY, JSON.stringify({ target: branch, attempts }));
    setPhase('start', `🧭 מנווט לסניף ${branch}... (ניסיון ${attempts})`);
    const ok = await navigateToBranch(branch);
    return ok ? 'navigating' : 'notfound';
  }

  // ─── Process one student ──────────────────────────────────────────────────────
  async function processStudent(task) {
    const { branch, identity } = task;
    if (stopFlag) return { branch, identity, status: 'נעצר' };
    log(`\n${'─'.repeat(40)}`);
    log(`▶ STUDENT branch=${branch} identity=${maskId(identity)}`);
    setPhase('running', `⏳ בתהליך ${curIdx + 1}/${queue.length} — סניף ${branch} | ת.ז. ${identity}`);

    try {
      // Step 1: Ensure תלמידים tab (index 3) is active — switch only if needed
      const tabCtrl = $find(IDs.tabContainer);
      if (tabCtrl) {
        let activeIdx = -1;
        try { activeIdx = tabCtrl.get_activeTabIndex(); } catch (e) { /* ignore */ }
        if (activeIdx !== 3) {
          log('[Step 1] Switching to tab 3');
          tabCtrl.set_activeTabIndex(3);
          await waitFor(() => $el(IDs.idField) && window.getComputedStyle($el(IDs.idField)).display !== 'none', { timeout: 3000 });
        }
      } else {
        log('[Step 1] ⚠️ TabControl not found');
      }

      // Step 2: Search for the student (waits for the grid to actually refresh)
      log(`[Step 2] Search identity=${identity}`);
      await searchFor(identity);
      log('[Step 2] Search complete');

      // Step 3: Analyze grid
      log('[Step 3] Analyzing grid');
      const analysis = analyzeGrid(identity);
      log(`[Step 3] Result: found=${analysis.found} departed=${analysis.departed} departDate="${analysis.departDate}"`);

      if (!analysis.found)    return { branch, identity, status: 'לא נמצא' };
      if (analysis.departed)  return { branch, identity, status: `כבר בוצעה עזיבה (${analysis.departDate})` };

      // Stop checkpoint — bail here (before the destructive part) if the user pressed עצור.
      if (stopFlag) { log('[Stop] aborting before departure (user stop)'); return { branch, identity, status: 'נעצר' }; }

      // Step 4: Select row → enables עזיבה button
      log('[Step 4] Selecting row');
      await selectFirstActiveRow();
      log('[Step 4] Row selected');

      // Step 5: Click עזיבה (async — departure modal opens)
      log('[Step 5] Click עזיבה');
      const deptWait = waitPRM({ startTimeoutMs: 3000, totalTimeoutMs: 20000 });
      execHref(IDs.deptBtn);
      await deptWait;

      // Step 6: Wait for modal to open (early-exit instead of fixed sleep)
      const opened = await waitFor(modalVisible, { timeout: 4000 });
      log(`[Step 6] Modal visible: ${opened}`);
      if (!opened) throw new Error('עזיבה modal did not open');

      // Step 7: Fill modal — date and reason
      const leaveDate   = getEffectiveLeaveDate();
      const leaveReason = getEffectiveLeaveReason();
      log(`[Step 7] Setting date="${leaveDate}" reason="${leaveReason}"`);

      const dateEl = $el(IDs.dateField);
      if (dateEl) {
        dateEl.value = leaveDate;
        dateEl.dispatchEvent(new Event('change', { bubbles: true }));
        log(`[Step 7] Date field set to "${dateEl.value}"`);
      }

      const reasonEl = $el(IDs.reasonDropdown);
      if (reasonEl) {
        reasonEl.value = leaveReason;
        reasonEl.dispatchEvent(new Event('change', { bubbles: true }));
        const selectedText = reasonEl.options[reasonEl.selectedIndex]?.text || '';
        log(`[Step 7] Reason set to ${leaveReason} ("${selectedText}")`);
      }

      // Step 8: Click אישור (confirm — async PRM)
      log('[Step 8] Click אישור (confirm departure)');
      const confirmEl = $el(IDs.confirmBtn);
      if (!confirmEl) throw new Error('Confirm button not found');
      log(`[Step 8] Confirm btn href: ${confirmEl.getAttribute('href')?.substring(0,60)}`);

      const confirmHref = confirmEl.getAttribute('href') || '';
      const fireConfirm = () => {
        if (confirmHref.startsWith('javascript:')) eval(confirmHref.replace('javascript:', ''));
        else confirmEl.click();
      };

      const confirmWait = waitPRM({ startTimeoutMs: 3000, totalTimeoutMs: 20000 });
      fireConfirm();
      await confirmWait;

      // Step 8b: The server may raise the shared message popup in the confirm response
      // (e.g. a validation block). Wait briefly for it to appear, then decide.
      // No more modal-display retry dance.
      const popup = (await waitFor(() => !!getMessagePopup(), { timeout: 1200 })) ? getMessagePopup() : null;

      if (popup && !popup.hasContinue) {
        // Pure block/validation (only "אישור" acknowledge) — surface to user & skip.
        log(`[Step 8] ⚠️ נחסם: "${popup.text}"`);
        hideMessagePopup();
        await closeDepartureModalIfOpen();
        return { branch, identity, status: `נחסם: ${popup.text || 'הודעת מערכת'}` };
      }
      if (popup && popup.hasContinue) {
        // Soft confirm ("המשך"/"לא") — proceed with המשך.
        log(`[Step 8] Confirm popup ("${popup.text}") → clicking המשך`);
        const contWait = waitPRM({ startTimeoutMs: 1500, totalTimeoutMs: 15000 });
        $el('ucMessagePopUp_btnMOK').click();
        await contWait;
      }

      // Step 9: Click שמירה (save — async PRM)
      log('[Step 9] Click שמירה');
      const saveBtnEl = $el(IDs.saveBtn);
      log(`[Step 9] Save btn class="${saveBtnEl?.className}" disabled=${saveBtnEl?.getAttribute('disabled')}`);
      const saveWait = waitPRM({ startTimeoutMs: 3000, totalTimeoutMs: 20000 });
      execHref(IDs.saveBtn);
      await saveWait;
      log('[Step 9] Save complete');

      // A message popup may also appear after save — capture text, hide it (never cancel).
      // On success it's "הצלחה תהליך עידכון תלמיד הצליח"; treat that as informational only.
      const savePopup = (await waitFor(() => !!getMessagePopup(), { timeout: 800 })) ? getMessagePopup() : null;
      if (savePopup) { log(`[Step 9] Message after save: "${savePopup.text}"`); hideMessagePopup(); }
      const saveBlocked = savePopup && savePopup.text && !/הצל/.test(savePopup.text);

      // Step 10: Verify — re-search and confirm departure date in grid (source of truth)
      log('[Step 10] Verify departure');
      await searchFor(identity);
      const verify = analyzeGrid(identity);
      log(`[Step 10] Verify: departed=${verify.departed} date="${verify.departDate}"`);

      const status = verify.departed ? 'הצליח'
                   : saveBlocked ? `נחסם: ${savePopup.text}`
                   : 'עזיבה בוצעה אך לא אומתה';
      log(`▶ RESULT: ${status}`);
      return { branch, identity, status };

    } catch (err) {
      log(`▶ ERROR: ${err.message}`);
      log(`  Stack: ${err.stack?.split('\n')[1] || ''}`);
      return { branch, identity, status: `שגיאה: ${err.message}` };
    }
  }

  // ─── Queue runner ─────────────────────────────────────────────────────────────
  async function runQueue() {
    running  = true;
    stopFlag = false;
    log(`\n${'═'.repeat(40)}`);
    log(`🚀 RUN START — ${queue.length} students, leaveDate="${getEffectiveLeaveDate()}" reason="${getEffectiveLeaveReason()}"`);
    setPhase('start', `▶ מתחיל — ${queue.length} תלמידים...`);

    while (curIdx < queue.length && !stopFlag) {
      const task = queue[curIdx];
      updateProgress();

      const onPage        = onInstitutePage();
      const currentBranch = onPage ? getCurrentBranchCode() : null;
      const targetPadded  = task.branch.padStart(2,'0');
      const currentPadded = (currentBranch || '').padStart(2,'0');
      log(`\nQueue [${curIdx+1}/${queue.length}] branch=${targetPadded} id=${task.identity}`);
      log(`Branch check: onPage=${onPage} current="${currentPadded}" target="${targetPadded}"`);

      // Not on the right institute page (or wrong branch) → auto-navigate via the sidebar.
      // tryNavigate guards against an infinite reload loop if the page never changes.
      if (!onPage || currentPadded !== targetPadded) {
        const r = await tryNavigate(task.branch);
        if (r === 'navigating') return; // page reloading; resume continues there
        if (r === 'notfound') {
          results.push({ branch: task.branch, identity: task.identity, status: `סניף ${task.branch} לא נמצא` });
          curIdx++; clearNav(); updateProgress(); renderResultsInPanel();
          continue;
        }
        // 'giveup' — couldn't reach the institute page after several tries
        log('[Nav] Aborting run — could not reach the institute page.');
        setPhase('error', `⚠️ לא הצלחתי להגיע לסניף ${task.branch}. נווט ידנית לסניף בתפריט הצד והרץ שוב.`);
        sessionStorage.removeItem(SS_KEY);
        running = false; setButtonsState(false);
        return;
      }

      clearNav(); // reached the correct branch — reset the nav-attempt guard
      const result = await processStudent(task);
      results.push(result);
      curIdx++;
      updateProgress();
      renderResultsInPanel();
      await sleep(120); // small buffer between students; the next search waits on its own postback
    }

    running = false;
    sessionStorage.removeItem(SS_KEY);
    clearNav();
    const summary = results.reduce((acc, r) => {
      if (r.status === 'הצליח') acc.ok++;
      else if (r.status === 'לא נמצא') acc.notFound++;
      else if (r.status.startsWith('כבר')) acc.already++;
      else if (r.status.startsWith('נחסם')) acc.blocked++;
      else if (r.status === 'נעצר') acc.stopped++;
      else acc.error++;
      return acc;
    }, { ok:0, notFound:0, already:0, blocked:0, stopped:0, error:0 });

    log(`\n${'═'.repeat(40)}`);
    log(stopFlag ? '⛔ Stopped by user' : '✅ All done!');
    log(`Summary: הצליח=${summary.ok} | לא נמצא=${summary.notFound} | כבר עזב=${summary.already} | נחסם=${summary.blocked} | נעצר=${summary.stopped} | שגיאה=${summary.error}`);
    const parts = [`✓ ${summary.ok} הצליחו`];
    if (summary.blocked)  parts.push(`${summary.blocked} נחסמו`);
    if (summary.already)  parts.push(`${summary.already} כבר עזבו`);
    if (summary.notFound) parts.push(`${summary.notFound} לא נמצאו`);
    if (summary.error)    parts.push(`${summary.error} שגיאות`);
    setPhase(stopFlag ? 'stopping' : 'done',
      `${stopFlag ? '⛔ נעצר' : '✅ הסתיים'} — ${parts.join(' | ')}`);
    setButtonsState(false);
    renderResultsInPanel();
  }

  // ─── Resume from sessionStorage ───────────────────────────────────────────────
  function resumeFromStorage() {
    const saved = sessionStorage.getItem(SS_KEY);
    if (!saved) return false;
    try {
      const state = JSON.parse(saved);
      queue   = state.queue   || [];
      results = state.results || [];
      curIdx  = state.curIdx  || 0;
      log(`[Resume] Restored: curIdx=${curIdx} queue=${queue.length} results=${results.length}`);
      return true;
    } catch(e) {
      log(`[Resume] Parse error: ${e.message}`);
      sessionStorage.removeItem(SS_KEY);
      return false;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function maskId(id) {
    const s = String(id);
    return s.length <= 4 ? '****' : '*'.repeat(s.length - 4) + s.slice(-4);
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Logging ─────────────────────────────────────────────────────────────────
  let logLines = [];
  const MAX_LOG = 500;

  function log(msg) {
    const ts = new Date().toTimeString().slice(0,8);
    const line = `${ts} ${msg}`;
    console.log('[TM]', msg);
    logLines.push(line);
    if (logLines.length > MAX_LOG) logLines.shift();
    const el = $el('tm-log');
    if (el) { el.textContent = logLines.join('\n'); el.scrollTop = el.scrollHeight; }
  }

  function updateStatus(msg) {
    const el = $el('tm-status');
    if (el) el.textContent = msg;
  }

  // Prominent, colour-coded phase indicator shown in the panel (not just the log).
  function setPhase(kind, msg) {
    const el = $el('tm-status');
    if (!el) return;
    const styles = {
      idle:     ['#555',    '#f0f4f8'],
      start:    ['#1a5276', '#e6f0fa'],
      running:  ['#1a5276', '#e6f0fa'],
      stopping: ['#9a5b00', '#fff4e0'],
      done:     ['#0a5c0a', '#eaffea'],
      error:    ['#a00',    '#fff0f0'],
    };
    const [fg, bg] = styles[kind] || styles.idle;
    el.style.color = fg;
    el.style.background = bg;
    el.style.fontWeight = kind === 'idle' ? 'normal' : 'bold';
    el.textContent = msg;
  }

  function updateProgress() {
    const el = $el('tm-progress');
    if (el) el.textContent = `${curIdx} / ${queue.length}`;
  }

  function setButtonsState(isRunning) {
    const s = $el('tm-start'), p = $el('tm-stop');
    if (s) s.disabled = isRunning;
    if (p) p.disabled = !isRunning;
  }

  // ─── Results table ────────────────────────────────────────────────────────────
  function renderResultsInPanel() {
    const container = $el('tm-results');
    if (!container) return;
    if (!results.length) { container.innerHTML = ''; return; }
    let html = '<table style="width:100%;border-collapse:collapse;font-size:12px">';
    html += `<tr style="background:#1a5276;color:#fff;text-align:center">
      <th style="padding:3px 6px">סניף</th>
      <th style="padding:3px 6px">ת.ז.</th>
      <th style="padding:3px 6px">סטטוס</th>
    </tr>`;
    results.forEach(r => {
      const ok    = r.status === 'הצליח';
      const skip  = r.status.startsWith('כבר') || r.status === 'לא נמצא' || r.status === 'נעצר';
      const color = ok ? '#0a5c0a' : skip ? '#666' : '#a00';
      const bg    = ok ? '#f0fff0' : skip ? '#f9f9f9' : '#fff5f5';
      html += `<tr style="border-bottom:1px solid #eee;background:${bg}">
        <td style="padding:2px 6px;text-align:center">${escHtml(r.branch)}</td>
        <td style="padding:2px 6px;direction:ltr;font-family:monospace;font-size:11px">${escHtml(r.identity)}</td>
        <td style="padding:2px 6px;color:${color};font-weight:bold;font-size:11px">${escHtml(r.status)}</td>
      </tr>`;
    });
    html += '</table>';
    container.innerHTML = html;
  }

  // ─── CSV export ───────────────────────────────────────────────────────────────
  function exportCSV() {
    if (!results.length) { alert('אין תוצאות לייצוא'); return; }
    const rows = [['סניף','ת.ז.','סטטוס'], ...results.map(r => [r.branch, r.identity, r.status])];
    const csv  = '\uFEFF' + rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a    = Object.assign(document.createElement('a'), {
      href    : URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
      download: `departures_${new Date().toISOString().slice(0,10)}.csv`
    });
    a.click();
    log('[CSV] Exported');
  }

  // ─── Copy log ─────────────────────────────────────────────────────────────────
  function copyLog() {
    const text = logLines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      const btn = $el('tm-copy-log');
      if (btn) { btn.textContent = '✓ הועתק'; setTimeout(() => { btn.textContent = '📋 העתק לוג'; }, 2000); }
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
    log('[Log] Copied to clipboard');
  }

  // ─── Input parsing ─────────────────────────────────────────────────────────────
  function parseInput(text) {
    return text.trim().split(/\n/).flatMap(line => {
      const parts = line.trim().split(/[\t,\s]+/);
      if (parts.length < 2) return [];
      const branch   = parts[0].trim().padStart(2,'0');
      const identity = parts[1].trim();
      return identity ? [{ branch, identity }] : [];
    });
  }

  // ─── Leave reason options ─────────────────────────────────────────────────────
  const REASON_OPTIONS = [
    { value: '1', label: 'הפסקת לימודים' },
    { value: '3', label: 'מעבר בין ישיבות' },
    { value: '4', label: 'מעבר בין יחידות צבאיות' },
    { value: '6', label: 'אחר' },
    { value: '7', label: 'גיוס לצה"ל' },
  ];

  // ─── Create UI ────────────────────────────────────────────────────────────────
  function createUI() {
    if ($el('tm-panel')) return;

    const reasonOptionsHTML = REASON_OPTIONS.map(o =>
      `<option value="${o.value}"${o.value==='1' ? ' selected' : ''}>${o.label}</option>`
    ).join('');

    const panel = document.createElement('div');
    panel.id = 'tm-panel';
    panel.style.cssText = `
      position:fixed; top:60px; right:10px; z-index:99999;
      background:#fff; border:2px solid #1a5276; border-radius:8px;
      width:390px; font-family:Arial,sans-serif; font-size:13px;
      direction:rtl; box-shadow:0 4px 20px rgba(0,0,0,.35);
    `;

    panel.innerHTML = `
      <div id="tm-header" style="background:#1a5276;color:#fff;padding:8px 12px;
           border-radius:6px 6px 0 0;cursor:move;
           display:flex;justify-content:space-between;align-items:center;user-select:none">
        <span style="font-weight:bold;font-size:14px">🎓 עזיבת תלמידים v5.0 ⚡</span>
        <span id="tm-progress" style="font-size:11px;opacity:.8">0 / 0</span>
        <span id="tm-toggle" style="cursor:pointer;font-size:16px;line-height:1;padding:0 4px">▲</span>
      </div>

      <div id="tm-body" style="padding:10px">

        <!-- Status -->
        <div id="tm-status" style="color:#555;font-size:11px;margin-bottom:8px;
             padding:4px 8px;background:#f0f4f8;border-radius:4px">מוכן</div>

        <!-- Input table -->
        <textarea id="tm-input"
          placeholder="הדבק כאן: סניף רווח ת.ז. (שורה לכל תלמיד)&#10;13 326656782&#10;02 206504235"
          style="width:100%;height:85px;box-sizing:border-box;font-size:12px;
                 padding:5px;direction:ltr;resize:vertical;
                 border:1px solid #aaa;border-radius:4px;font-family:monospace"></textarea>

        <!-- Settings row -->
        <div style="display:flex;gap:8px;margin:6px 0;align-items:center;flex-wrap:wrap">
          <div style="flex:1;min-width:120px">
            <label style="font-size:11px;color:#444;display:block;margin-bottom:2px">
              📅 תאריך עזיבה (ריק = היום)
            </label>
            <input id="tm-leave-date" type="text"
              placeholder="${todayDate()}"
              style="width:100%;box-sizing:border-box;font-size:12px;padding:4px;
                     border:1px solid #aaa;border-radius:4px;direction:ltr;font-family:monospace"
              maxlength="10">
          </div>
          <div style="flex:1;min-width:140px">
            <label style="font-size:11px;color:#444;display:block;margin-bottom:2px">
              📌 סיבת עזיבה
            </label>
            <select id="tm-leave-reason"
              style="width:100%;box-sizing:border-box;font-size:12px;padding:4px;
                     border:1px solid #aaa;border-radius:4px">
              ${reasonOptionsHTML}
            </select>
          </div>
        </div>

        <!-- Action buttons -->
        <div style="display:flex;gap:6px;margin:6px 0">
          <button id="tm-start" style="flex:2;background:#1a5276;color:#fff;border:none;
                  padding:8px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px">
            ▶ התחל</button>
          <button id="tm-stop" style="flex:1;background:#922b21;color:#fff;border:none;
                  padding:8px;border-radius:4px;cursor:pointer;font-size:13px" disabled>
            ⏹ עצור</button>
          <button id="tm-csv" style="flex:1;background:#117a65;color:#fff;border:none;
                  padding:8px;border-radius:4px;cursor:pointer;font-size:13px">
            💾 CSV</button>
        </div>

        <!-- Results table -->
        <div id="tm-results" style="max-height:170px;overflow-y:auto;margin-bottom:6px;
             border:1px solid #ddd;border-radius:4px;min-height:10px"></div>

        <!-- Log section -->
        <details id="tm-log-details">
          <summary style="cursor:pointer;font-size:11px;color:#555;padding:3px 0;user-select:none">
            📋 יומן פעילות (לצירוף בדיווח בעיות)</summary>
          <div style="display:flex;gap:4px;margin:4px 0 2px">
            <button id="tm-copy-log" style="flex:1;font-size:11px;padding:3px 6px;
                    background:#555;color:#fff;border:none;border-radius:3px;cursor:pointer">
              📋 העתק לוג</button>
            <button id="tm-clear-log" style="flex:1;font-size:11px;padding:3px 6px;
                    background:#888;color:#fff;border:none;border-radius:3px;cursor:pointer">
              🗑 נקה לוג</button>
          </div>
          <pre id="tm-log" style="max-height:150px;overflow-y:auto;font-size:10px;
               background:#1e1e1e;color:#d4d4d4;padding:8px;margin:0;
               border-radius:4px;white-space:pre-wrap;direction:ltr;
               border:1px solid #333;line-height:1.4"></pre>
        </details>

      </div>
    `;

    document.body.appendChild(panel);

    // ── Drag ──
    const header = $el('tm-header');
    let drag = null;
    header.addEventListener('mousedown', e => {
      drag = { sx: e.clientX - panel.offsetLeft, sy: e.clientY - panel.offsetTop };
      panel.style.right = 'auto';
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      panel.style.left = (e.clientX - drag.sx) + 'px';
      panel.style.top  = (e.clientY - drag.sy) + 'px';
    });
    document.addEventListener('mouseup', () => { drag = null; });

    // ── Toggle collapse ──
    $el('tm-toggle').addEventListener('click', () => {
      const body = $el('tm-body');
      const tog  = $el('tm-toggle');
      if (body.style.display === 'none') { body.style.display = ''; tog.textContent = '▲'; }
      else { body.style.display = 'none'; tog.textContent = '▼'; }
    });

    // ── Date input: auto-format as DD/MM/YYYY ──
    $el('tm-leave-date').addEventListener('input', function() {
      let v = this.value.replace(/\D/g,'');
      if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
      if (v.length > 5) v = v.slice(0,5) + '/' + v.slice(5,9);
      this.value = v;
    });

    // ── Start ──
    $el('tm-start').addEventListener('click', async () => {
      if (running) return;
      const text = $el('tm-input').value.trim();
      if (!text) { alert('אנא הדבק רשימת תלמידים'); return; }
      queue   = parseInput(text);
      results = [];
      curIdx  = 0;
      if (!queue.length) { alert('לא נמצאו שורות תקינות (פורמט: סניף ת.ז.)'); return; }
      log(`[Start] Parsed ${queue.length} students`);
      log(`[Start] leaveDate="${getEffectiveLeaveDate()}" leaveReason="${getEffectiveLeaveReason()}"`);
      setButtonsState(true);
      await runQueue();
    });

    // ── Stop ──
    $el('tm-stop').addEventListener('click', () => {
      stopFlag = true;
      sessionStorage.removeItem(SS_KEY);
      $el('tm-stop').disabled = true;          // immediate visual ack
      setPhase('stopping', '⛔ עוצר... (מסיים את התלמיד הנוכחי)');
      log('[Stop] Stop requested by user');
    });

    // ── CSV ──
    $el('tm-csv').addEventListener('click', exportCSV);

    // ── Copy log ──
    $el('tm-copy-log').addEventListener('click', copyLog);

    // ── Clear log ──
    $el('tm-clear-log').addEventListener('click', () => {
      logLines = [];
      const el = $el('tm-log');
      if (el) el.textContent = '';
      log('[Log] Cleared');
    });
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    createUI();
    log(`[Init] v5.0 (popup-aware) loaded on ${window.location.href}`);
    log(`[Init] Today: ${todayDate()}`);

    const resumed = resumeFromStorage();
    if (resumed) {
      log('[Init] Resuming after branch navigation...');
      $el('tm-input').value = queue.map(t => `${t.branch} ${t.identity}`).join('\n');
      renderResultsInPanel();
      updateProgress();
      setButtonsState(true);
      // Delay to let AjaxControlToolkit and TabContainer fully initialize
      setTimeout(async () => {
        await runQueue();
      }, 1500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 800);
  }

})();