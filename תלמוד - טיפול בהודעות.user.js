// ==UserScript==
// @name         תלמוד - טיפול בהודעות
// @namespace    https://talmud.edu.gov.il/
// @version      5.0
// @description  טיפול מהיר בהודעות - מצב גורף או דו-שלבי (מהיר ב-50x)
// @author       מרדכי יאקאב
// @match        https://talmud.edu.gov.il/Association/Default.aspx*
// @grant        none
// @run-at       document-idle
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// ==/UserScript==

(function () {
    'use strict';

    const ACTION_APPROVE      = 'אישור מעבר';
    const ACTION_DECLINE      = 'דחיית מעבר';
    const ACTION_MARK_HANDLED = 'שנה מצב הודעה לטופל';
    const ACTION_SKIP         = 'דלג';
    const ALL_ACTIONS = [ACTION_APPROVE, ACTION_DECLINE, ACTION_MARK_HANDLED, ACTION_SKIP];

    const ACTION_ALIASES = {
        'אשר': ACTION_APPROVE, 'אישור': ACTION_APPROVE, 'אישור מעבר': ACTION_APPROVE, 'approve': ACTION_APPROVE,
        'דחה': ACTION_DECLINE, 'דחיה': ACTION_DECLINE, 'דחייה': ACTION_DECLINE, 'דחיית מעבר': ACTION_DECLINE, 'decline': ACTION_DECLINE,
        'טופל': ACTION_MARK_HANDLED, 'טופלה': ACTION_MARK_HANDLED, 'סגור': ACTION_MARK_HANDLED, 'שנה': ACTION_MARK_HANDLED, 'שנה מצב הודעה לטופל': ACTION_MARK_HANDLED,
        'דלג': ACTION_SKIP, 'skip': ACTION_SKIP, '': ACTION_SKIP
    };

    const POSTBACK_TARGETS = {
        [ACTION_APPROVE]:      'ctl00$ContentPlaceHolder1$btnTransferApprove',
        [ACTION_DECLINE]:      'ctl00$ContentPlaceHolder1$btnTransferDecline',
        [ACTION_MARK_HANDLED]: 'ctl00$ContentPlaceHolder1$btnChangeMessageStatus'
    };

    const PAGER_ID = 'ContentPlaceHolder1_GPager_pager';
    const GRID_ID  = 'ContentPlaceHolder1_GVMessages';
    const HID_ROW_ID = 'ContentPlaceHolder1_HidMessageRowID';
    const SUCCESS_POPUP_ID = 'ucMessagePopUp_pnlMessagePopup';
    const SUCCESS_MPE_ID   = 'ucMessagePopUp_ModalPopupExtender1';

    let scannedMessages = [];
    let pendingActions  = null;
    let report          = [];

    const maskId = id => { const s = String(id || ''); return !s ? '-' : s.length <= 4 ? '****' : '*'.repeat(s.length - 4) + s.slice(-4); };

    // ==========================================================
    //  ⚡ ה-CORE: postback מהיר עם event-based waiting
    // ==========================================================
    function getPRM() {
        try { return Sys.WebForms.PageRequestManager.getInstance(); } catch(e) { return null; }
    }

    // ממתין לסיום ה-AJAX postback באמצעות event - מיידי, ללא polling
    function waitForPostbackEnd(timeout = 15000) {
        return new Promise((resolve, reject) => {
            const prm = getPRM();
            if (!prm) {
                // fallback - polling קצר
                return setTimeout(resolve, 500);
            }
            let done = false;
            const handler = function(s, e) {
                if (done) return;
                done = true;
                prm.remove_endRequest(handler);
                clearTimeout(timer);
                // בדיקת שגיאה
                if (e && e.get_error && e.get_error()) {
                    e.set_errorHandled(true);
                    return reject(new Error(e.get_error().message || 'postback error'));
                }
                resolve();
            };
            prm.add_endRequest(handler);
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                prm.remove_endRequest(handler);
                resolve(); // לא ניכשל - ננסה להמשיך
            }, timeout);
        });
    }

    // סוגר את פופאפ ההצלחה אם הוא קיים
    function closeSuccessPopup() {
        try {
            if (typeof window.$find === 'function') {
                const mpe = window.$find(SUCCESS_MPE_ID);
                if (mpe && typeof mpe.hide === 'function') {
                    mpe.hide();
                }
            }
        } catch (e) { /* ignore */ }
        // גם הסתרה ידנית של ה-DOM (ליתר ביטחון)
        const popup = document.getElementById(SUCCESS_POPUP_ID);
        if (popup) popup.style.display = 'none';
        const bg = document.getElementById(SUCCESS_MPE_ID + '_backgroundElement');
        if (bg) bg.style.display = 'none';
    }

    function isSuccessPopupVisible() {
        const popup = document.getElementById(SUCCESS_POPUP_ID);
        if (!popup) return false;
        return window.getComputedStyle(popup).display !== 'none';
    }

    // ⚡ פעולה אטומית - postback + סגירת פופאפ + המתנה
    async function performActionFast(rowIndex, action) {
        // 1. סגור פופאפ הצלחה ישן (אם נשאר)
        if (isSuccessPopupVisible()) closeSuccessPopup();

        // 2. הצב את אינדקס השורה
        const hidRow = document.getElementById(HID_ROW_ID);
        if (hidRow) hidRow.value = String(rowIndex);

        const target = POSTBACK_TARGETS[action];
        if (!target) return { ok: false, reason: 'פעולה לא מוכרת' };

        // 3. הפעל postback ובמקביל הירשם לסיום
        const waitPromise = waitForPostbackEnd();
        try {
            window.__doPostBack(target, '');
        } catch (e) {
            return { ok: false, reason: 'postback exception: ' + e.message };
        }
        try {
            await waitPromise;
        } catch (e) {
            return { ok: false, reason: e.message };
        }

        // 4. סגור את פופאפ ההצלחה שצץ (זה מה שמאט הכל!)
        closeSuccessPopup();

        return { ok: true };
    }

    // ==========================================================
    //  UI
    // ==========================================================
    function injectUI() {
        if (document.getElementById('autoMsgPanel')) return;
        const panel = document.createElement('div');
        panel.id = 'autoMsgPanel';
        panel.style.cssText = `
            position:fixed; top:80px; left:10px; z-index:99999;
            background:#fff; border:2px solid #2e7d32; border-radius:8px;
            padding:0; width:440px; font-family:Arial; direction:rtl;
            box-shadow:0 4px 12px rgba(0,0,0,0.2);
        `;
        panel.innerHTML = `
            <div style="background:#2e7d32; color:#fff; padding:8px 10px; display:flex; justify-content:space-between; align-items:center; border-radius:6px 6px 0 0;">
                <span style="font-weight:bold;">⚡ טיפול מהיר בהודעות v5</span>
                <div>
                    <button id="autoMsgStop" style="padding:3px 10px; background:#c62828; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px;">⛔ עצור</button>
                    <button id="autoMsgClose" style="padding:3px 8px; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">×</button>
                </div>
            </div>
            <div style="padding:10px;">
                <div style="display:flex; gap:4px; margin-bottom:10px; border-bottom:2px solid #eee;">
                    <button id="autoMsgTabBulk"  class="autoMsgTab" data-tab="bulk"  style="flex:1; padding:8px; background:#2e7d32; color:#fff; border:none; cursor:pointer; font-weight:bold; border-radius:4px 4px 0 0;">⚡ מצב גורף</button>
                    <button id="autoMsgTabTable" class="autoMsgTab" data-tab="table" style="flex:1; padding:8px; background:#ddd; color:#333; border:none; cursor:pointer; border-radius:4px 4px 0 0;">📋 לפי טבלה</button>
                </div>
                <div id="autoMsgBulkPane" class="autoMsgPane">
                    <div style="font-size:12px; background:#fff8e1; padding:8px; border:1px solid #ffe082; border-radius:4px;">
                        עובר על <b>כל ההודעות</b> במצב "נשלחה":<br>
                        • "בקשת מעבר תלמיד" → <b>אישור מעבר</b><br>
                        • שאר ההודעות → <b>שנה מצב הודעה לטופל</b><br>
                        <span style="color:#c62828;"><b>⚠ "דחיית מעבר" לא יילחץ אוטומטית.</b></span>
                    </div>
                    <button id="autoMsgRunBulk" style="width:100%; margin-top:10px; padding:10px; background:#2e7d32; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:14px;">▶ הפעל מצב גורף</button>
                </div>
                <div id="autoMsgTablePane" class="autoMsgPane" style="display:none;">
                    <div style="font-size:12px; background:#e3f2fd; padding:8px; border:1px solid #90caf9; border-radius:4px; margin-bottom:10px;">
                        <b>שלב א'</b> – סורק ומוריד אקסל. <b>שלב ב'</b> – הדבקה וביצוע.
                    </div>
                    <fieldset style="border:1px solid #1565c0; border-radius:4px; padding:8px; margin-bottom:10px;">
                        <legend style="color:#1565c0; font-weight:bold; padding:0 6px;">שלב א'</legend>
                        <div style="display:flex; gap:6px;">
                            <button id="autoMsgScan" style="flex:1; padding:8px; background:#1565c0; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">🔍 סרוק</button>
                            <button id="autoMsgDownload" style="flex:1; padding:8px; background:#1565c0; color:#fff; border:none; border-radius:4px; cursor:pointer;" disabled>📥 הורד אקסל</button>
                        </div>
                        <div id="autoMsgScanStatus" style="font-size:11px; color:#555; margin-top:6px;">לא בוצעה סריקה.</div>
                    </fieldset>
                    <fieldset style="border:1px solid #6a1b9a; border-radius:4px; padding:8px;">
                        <legend style="color:#6a1b9a; font-weight:bold; padding:0 6px;">שלב ב'</legend>
                        <textarea id="autoMsgInput" rows="4" style="width:100%; box-sizing:border-box; direction:ltr; font-family:monospace; font-size:11px;" placeholder="UID&#9;...&#9;פעולה"></textarea>
                        <div style="display:flex; gap:6px; margin-top:6px;">
                            <button id="autoMsgLoadTable" style="flex:1; padding:8px; background:#6a1b9a; color:#fff; border:none; border-radius:4px; cursor:pointer;">📥 טען</button>
                            <button id="autoMsgRunTable"  style="flex:1; padding:8px; background:#2e7d32; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:bold;" disabled>▶ בצע</button>
                        </div>
                        <div id="autoMsgLoadStatus" style="font-size:11px; color:#555; margin-top:6px;">טבלה לא טעונה.</div>
                    </fieldset>
                </div>
                <div style="margin-top:10px; border-top:1px solid #ddd; padding-top:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <span style="font-weight:bold; font-size:12px;">📜 לוג + דוח</span>
                        <div>
                            <button id="autoMsgCopyReport" style="padding:4px 10px; background:#ef6c00; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px;">📋 העתק דוח</button>
                            <button id="autoMsgClearLog" style="padding:4px 10px; background:#777; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px;">נקה</button>
                        </div>
                    </div>
                    <div id="autoMsgLog" style="max-height:240px; overflow:auto; font-size:11px; background:#f7f7f7; border:1px solid #ddd; padding:6px; border-radius:4px;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('autoMsgClose').onclick = () => panel.remove();
        document.getElementById('autoMsgStop').onclick  = () => { window.__autoMsgStop = true; log('⛔ עצירה...', 'warn'); };
        document.getElementById('autoMsgRunBulk').onclick    = runBulkMode;
        document.getElementById('autoMsgScan').onclick       = runScan;
        document.getElementById('autoMsgDownload').onclick   = downloadScannedXLSX;
        document.getElementById('autoMsgLoadTable').onclick  = loadPastedTable;
        document.getElementById('autoMsgRunTable').onclick   = runTableMode;
        document.getElementById('autoMsgCopyReport').onclick = copyReport;
        document.getElementById('autoMsgClearLog').onclick   = () => { document.getElementById('autoMsgLog').innerHTML = ''; };

        panel.querySelectorAll('.autoMsgTab').forEach(b => {
            b.onclick = () => {
                const tab = b.dataset.tab;
                panel.querySelectorAll('.autoMsgTab').forEach(x => {
                    if (x.dataset.tab === tab) { x.style.background='#2e7d32'; x.style.color='#fff'; x.style.fontWeight='bold'; }
                    else { x.style.background='#ddd'; x.style.color='#333'; x.style.fontWeight='normal'; }
                });
                document.getElementById('autoMsgBulkPane').style.display  = (tab === 'bulk')  ? 'block' : 'none';
                document.getElementById('autoMsgTablePane').style.display = (tab === 'table') ? 'block' : 'none';
            };
        });
    }

    function log(msg, type) {
        const box = document.getElementById('autoMsgLog');
        if (!box) { console.log(msg); return; }
        const d = document.createElement('div');
        const colors = { ok:'#2e7d32', err:'#c62828', warn:'#ef6c00', info:'#0277bd' };
        d.style.color = colors[type] || '#000';
        d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        box.appendChild(d);
        box.scrollTop = box.scrollHeight;
    }

    // ==========================================================
    //  עזר - חילוץ + זיהוי
    // ==========================================================
    function extractIdFromBody(body) {
        if (!body) return '';
        let m = body.match(/ת\.?\s*ז\.?\s*\.?\s*([0-9]{7,9})/);
        if (m) return m[1];
        m = body.match(/דרכון\s+([A-Za-z0-9]{5,12})/);
        if (m) return m[1].toUpperCase();
        m = body.match(/\b([0-9]{8,9})\b/);
        if (m) return m[1] || '';
        return '';
    }

    function makeUID(header, body) {
        const s = (header || '') + '|' + (body || '');
        let h = 0;
        for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        return 'M' + (h >>> 0).toString(36);
    }

    function getMessagesOnPage() {
        const grid = document.getElementById(GRID_ID);
        if (!grid) return [];
        const rows = grid.querySelectorAll('tr');
        const out = [];
        rows.forEach((tr) => {
            const oc = tr.getAttribute('onclick') || '';
            const m = oc.match(/selectedRowSearch\('?(\d+)'?\)/);
            if (!m) return;
            const idx = m[1];
            const hdBody   = document.getElementById(`${GRID_ID}_hdID_${idx}`);
            const hdHeader = document.getElementById(`${GRID_ID}_hidMessageHeader_${idx}`);
            const body   = hdBody ? hdBody.value : '';
            const header = hdHeader ? hdHeader.value : '';
            const status = (tr.cells && tr.cells[3]) ? (tr.cells[3].innerText || '').trim() : '';
            const date   = (tr.cells && tr.cells[4]) ? (tr.cells[4].innerText || '').trim() : '';
            out.push({
                rowIndex: idx, header, body, status, date,
                personId: extractIdFromBody(body),
                uid: makeUID(header, body)
            });
        });
        return out;
    }

    // ==========================================================
    //  פג'ינציה (גם משתמש ב-event waiting)
    // ==========================================================
    function getPagerLinks() {
        const pager = document.getElementById(PAGER_ID);
        if (!pager) return { next: null, first: null, prev: null, last: null };
        let next = null, last = null, first = null, prev = null;
        pager.querySelectorAll('a').forEach(a => {
            const t = a.innerText.trim();
            if (t === '›') next = a;
            else if (t === '»') last = a;
            else if (t === '«') first = a;
            else if (t === '‹') prev = a;
        });
        return { next, first, prev, last };
    }

    function getCurrentPageNumber() {
        const pager = document.getElementById(PAGER_ID);
        if (!pager) return 1;
        for (const s of pager.querySelectorAll('span')) {
            const t = s.innerText.trim();
            if (/^\d+$/.test(t)) return parseInt(t, 10);
        }
        return 1;
    }

    async function clickPagerLink(linkEl) {
        if (!linkEl) return false;
        const waitPromise = waitForPostbackEnd();
        try {
            const m = (linkEl.getAttribute('href') || '').match(/__doPostBack\('([^']+)','([^']*)'\)/);
            if (m) {
                window.__doPostBack(m[1], m[2]);
            } else {
                linkEl.click();
            }
        } catch(e) { linkEl.click(); }
        await waitPromise;
        return true;
    }

    async function gotoFirstPage() {
        const { first, prev } = getPagerLinks();
        const target = first || prev;
        if (!target) return true;
        return await clickPagerLink(target);
    }

    async function goToNextPage() {
        const { next } = getPagerLinks();
        if (!next) return false;
        return await clickPagerLink(next);
    }

    async function ensureSentFilter() {
        for (const s of document.querySelectorAll('select')) {
            const opts = [...s.options].map(o => o.text);
            if (opts.includes('נשלחה') && opts.includes('טופלה')) {
                if (s.value !== '1') {
                    log('🔧 משנה פילטר ל"נשלחה"...', 'info');
                    const wait = waitForPostbackEnd();
                    s.value = '1';
                    s.dispatchEvent(new Event('change', { bubbles: true }));
                    await wait;
                }
                return;
            }
        }
    }

    // ==========================================================
    //  סריקה
    // ==========================================================
    async function runScan() {
        window.__autoMsgStop = false;
        scannedMessages = [];
        const statusDiv = document.getElementById('autoMsgScanStatus');
        statusDiv.textContent = 'סורק...';
        const t0 = Date.now();
        log('🔍 מתחיל סריקה...', 'info');

        await ensureSentFilter();
        await gotoFirstPage();

        const seen = new Set();
        let pageCount = 0, safety = 0;

        while (!window.__autoMsgStop && safety < 300) {
            safety++;
            pageCount++;
            const messages = getMessagesOnPage();
            log(`📄 עמוד ${getCurrentPageNumber()}: ${messages.length} הודעות`, 'info');

            for (const m of messages) {
                if (m.status && m.status !== 'נשלחה') continue;
                if (seen.has(m.uid)) continue;
                seen.add(m.uid);
                scannedMessages.push({
                    uid: m.uid, header: m.header, personId: m.personId,
                    body: m.body, date: m.date, status: m.status,
                    suggestedAction: (m.header === 'בקשת מעבר תלמיד') ? ACTION_APPROVE : ACTION_MARK_HANDLED
                });
            }
            statusDiv.textContent = `סריקה: ${pageCount} עמודים, ${scannedMessages.length} הודעות.`;
            const moved = await goToNextPage();
            if (!moved) break;
        }

        const dt = ((Date.now() - t0)/1000).toFixed(1);
        log(`✓ ${scannedMessages.length} הודעות מ-${pageCount} עמודים (${dt}s).`, 'ok');
        statusDiv.textContent = `✓ נסרקו ${scannedMessages.length} הודעות.`;
        statusDiv.style.color = '#2e7d32';
        document.getElementById('autoMsgDownload').disabled = false;
    }

    // ==========================================================
    //  XLSX
    // ==========================================================
    function downloadScannedXLSX() {
        if (scannedMessages.length === 0) { log('אין נתונים.', 'err'); return; }
        if (typeof XLSX === 'undefined') { downloadScannedTSV(); return; }

        const headers = ['UID', 'נושא', 'ת.ז./דרכון', 'תאריך', 'גוף ההודעה', 'פעולה'];
        const data = [headers];
        scannedMessages.forEach(r => {
            data.push([r.uid, r.header || '', r.personId || '', r.date || '',
                (r.body || '').replace(/\s+/g, ' ').trim(),
                r.suggestedAction || ACTION_SKIP]);
        });

        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = [{wch:12},{wch:22},{wch:14},{wch:12},{wch:70},{wch:22}];
        ws['!views'] = [{ RTL: true }];
        ws['!dataValidation'] = [{
            sqref: `F2:F${data.length}`,
            type: 'list',
            formula1: `"${ALL_ACTIONS.join(',')}"`,
            allowBlank: true,
            showErrorMessage: true,
            errorTitle: 'ערך לא חוקי',
            error: `מותר: ${ALL_ACTIONS.join(', ')}`
        }];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'הודעות');

        const helpData = [
            ['פעולות אפשריות:'], [ACTION_APPROVE], [ACTION_DECLINE],
            [ACTION_MARK_HANDLED], [ACTION_SKIP], [],
            ['אל תשנה את עמודת UID!']
        ];
        const wsHelp = XLSX.utils.aoa_to_sheet(helpData);
        wsHelp['!views'] = [{ RTL: true }];
        wsHelp['!cols'] = [{ wch: 60 }];
        XLSX.utils.book_append_sheet(wb, wsHelp, 'עזרה');

        const stamp = new Date().toISOString().replace(/[:.]/g,'-').substring(0,19);
        try {
            XLSX.writeFile(wb, `הודעות_${stamp}.xlsx`);
            log(`📥 הורד אקסל.`, 'ok');
        } catch (e) {
            downloadScannedTSV();
        }
    }

    function downloadScannedTSV() {
        const headers = ['UID', 'נושא', 'ת.ז./דרכון', 'תאריך', 'גוף ההודעה', 'פעולה'];
        const lines = [headers.join('\t')];
        scannedMessages.forEach(r => {
            lines.push([r.uid, r.header, r.personId, r.date,
                (r.body||'').replace(/[\t\r\n]+/g,' ').trim(),
                r.suggestedAction].join('\t'));
        });
        const blob = new Blob(['﻿'+lines.join('\n')], {type:'text/tab-separated-values;charset=utf-8;'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `messages_${Date.now()}.tsv`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
        log('📥 הורד TSV.', 'ok');
    }

    // ==========================================================
    //  טעינת טבלה
    // ==========================================================
    function loadPastedTable() {
        const text = document.getElementById('autoMsgInput').value;
        const statusDiv = document.getElementById('autoMsgLoadStatus');
        if (!text.trim()) { log('תיבת הטקסט ריקה.', 'err'); return; }
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { log('צריך כותרת + שורה אחת לפחות.', 'err'); return; }

        const headers = lines[0].split(/\t/);
        const uidIdx    = headers.findIndex(h => /uid/i.test(h));
        const actionIdx = headers.findIndex(h => /פעולה|action/i.test(h));

        if (uidIdx === -1 || actionIdx === -1) {
            log('חסרה עמודת UID או "פעולה".', 'err');
            statusDiv.textContent = '✗ חסרה עמודת UID או פעולה.';
            statusDiv.style.color = '#c62828';
            return;
        }

        pendingActions = new Map();
        const counts = { approve:0, decline:0, handled:0, skip:0 };
        for (let i = 1; i < lines.length; i++) {
            const cells = lines[i].split(/\t/);
            const uid = (cells[uidIdx] || '').trim();
            const actionRaw = (cells[actionIdx] || '').trim();
            if (!uid) continue;
            const action = ACTION_ALIASES[actionRaw.toLowerCase()] || ACTION_ALIASES[actionRaw] || ACTION_SKIP;
            pendingActions.set(uid, action);
            if (action === ACTION_APPROVE) counts.approve++;
            else if (action === ACTION_DECLINE) counts.decline++;
            else if (action === ACTION_MARK_HANDLED) counts.handled++;
            else counts.skip++;
        }

        const summary = `נטענו ${pendingActions.size}: אישור=${counts.approve}, דחיה=${counts.decline}, טופל=${counts.handled}, דילוג=${counts.skip}.`;
        log('📋 ' + summary, 'ok');
        statusDiv.textContent = '✓ ' + summary;
        statusDiv.style.color = '#2e7d32';
        document.getElementById('autoMsgRunTable').disabled = (pendingActions.size === 0);
    }

    // ==========================================================
    //  ⚡ ביצוע מהיר - מצב גורף
    // ==========================================================
    async function runBulkMode() {
        window.__autoMsgStop = false;
        report = [];
        const t0 = Date.now();
        log('▶ מצב גורף.', 'info');

        await ensureSentFilter();
        await gotoFirstPage();

        let processed = 0, skipped = 0, safety = 0;
        let consecutiveEmpty = 0;
        const failedUIDs = new Set();

        while (!window.__autoMsgStop && safety < 5000) {
            safety++;

            // וודא שאין פופאפ פתוח שחוסם
            if (isSuccessPopupVisible()) closeSuccessPopup();

            const messages = getMessagesOnPage();
            if (messages.length === 0) { log('אין הודעות.', 'info'); break; }

            let target = null;
            for (const m of messages) {
                if (m.status && m.status !== 'נשלחה') continue;
                if (failedUIDs.has(m.uid)) continue;
                target = m;
                break;
            }

            if (!target) {
                consecutiveEmpty++;
                const moved = await goToNextPage();
                if (!moved) { log('סיום.', 'info'); break; }
                if (consecutiveEmpty > 30) { log('עצירת בטיחות.', 'warn'); break; }
                continue;
            }

            consecutiveEmpty = 0;
            const action = (target.header === 'בקשת מעבר תלמיד')
                ? ACTION_APPROVE : ACTION_MARK_HANDLED;

            const tStart = Date.now();
            const res = await performActionFast(target.rowIndex, action);
            const dur = Date.now() - tStart;

            if (res.ok) {
                processed++;
                recordReport(target, action, 'בוצע');
                log(`⚡ ${dur}ms | ${action} | ${maskId(target.personId)} | ${target.header}`, 'ok');
            } else {
                skipped++;
                failedUIDs.add(target.uid);
                recordReport(target, action, 'נכשל: ' + res.reason);
                log(`✗ ${res.reason}`, 'err');
            }
        }

        const dt = ((Date.now() - t0)/1000).toFixed(1);
        const rate = processed > 0 ? (parseFloat(dt)/processed).toFixed(2) : '?';
        log(`✓ הסתיים. בוצעו: ${processed}, דולגו: ${skipped}. (${dt}s, ${rate}s/פעולה)`, 'ok');
    }

    // ==========================================================
    //  ⚡ ביצוע מהיר - לפי טבלה
    // ==========================================================
    async function runTableMode() {
        if (!pendingActions || pendingActions.size === 0) {
            log('אין טבלה טעונה.', 'err'); return;
        }
        window.__autoMsgStop = false;
        report = [];
        const t0 = Date.now();

        let toDo = 0;
        for (const a of pendingActions.values()) if (a !== ACTION_SKIP) toDo++;
        log(`▶ ביצוע לפי טבלה: ${toDo} פעולות.`, 'info');

        await ensureSentFilter();
        await gotoFirstPage();

        const handledUIDs = new Set();
        let processed = 0, safety = 0;
        let consecutiveEmpty = 0;

        while (!window.__autoMsgStop && safety < 5000) {
            safety++;

            if (isSuccessPopupVisible()) closeSuccessPopup();

            const messages = getMessagesOnPage();
            if (messages.length === 0) break;

            let target = null;
            let targetAction = null;
            for (const m of messages) {
                if (handledUIDs.has(m.uid)) continue;
                const action = pendingActions.get(m.uid);
                if (!action) continue;
                if (action === ACTION_SKIP) {
                    handledUIDs.add(m.uid);
                    recordReport(m, ACTION_SKIP, 'דילוג');
                    continue;
                }
                target = m;
                targetAction = action;
                break;
            }

            if (!target) {
                consecutiveEmpty++;
                const moved = await goToNextPage();
                if (!moved) break;
                if (consecutiveEmpty > 30) { log('עצירת בטיחות.', 'warn'); break; }
                continue;
            }

            consecutiveEmpty = 0;
            const tStart = Date.now();
            const res = await performActionFast(target.rowIndex, targetAction);
            const dur = Date.now() - tStart;

            if (res.ok) {
                processed++;
                handledUIDs.add(target.uid);
                recordReport(target, targetAction, 'בוצע');
                log(`⚡ ${dur}ms | ${targetAction} | ${maskId(target.personId)}`, 'ok');
            } else {
                handledUIDs.add(target.uid);
                recordReport(target, targetAction, 'נכשל: ' + res.reason);
                log(`✗ ${res.reason}`, 'err');
            }
        }

        const remaining = [...pendingActions.entries()]
            .filter(([uid, act]) => act !== ACTION_SKIP && !handledUIDs.has(uid));
        const dt = ((Date.now() - t0)/1000).toFixed(1);
        const rate = processed > 0 ? (parseFloat(dt)/processed).toFixed(2) : '?';
        log(`✓ הסתיים. בוצעו: ${processed}. (${dt}s, ${rate}s/פעולה)`, 'ok');
        if (remaining.length > 0) log(`⚠ ${remaining.length} לא נמצאו.`, 'warn');
    }

    // ==========================================================
    //  דוח
    // ==========================================================
    function recordReport(msg, action, status) {
        report.push({
            uid: msg.uid || '', id: msg.personId || '',
            header: msg.header || '', action: action || '',
            status: status, body: (msg.body || '').replace(/\s+/g, ' ').trim()
        });
    }

    function copyReport() {
        if (report.length === 0) { log('אין דוח.', 'warn'); return; }
        const header = ['UID','ת.ז./דרכון','נושא','פעולה','סטטוס','גוף ההודעה'].join('\t');
        const lines = [header, ...report.map(r =>
            [r.uid, r.id, r.header, r.action, r.status, r.body].join('\t'))];
        const text = lines.join('\n');
        navigator.clipboard.writeText(text).then(
            () => log(`📋 הועתקו ${report.length} שורות.`, 'ok'),
            () => {
                document.getElementById('autoMsgInput').value = text;
                log('הוצג בתיבה להעתקה ידנית.', 'warn');
            }
        );
    }

    // ==========================================================
    //  אתחול
    // ==========================================================
    function init() { injectUI(); }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
