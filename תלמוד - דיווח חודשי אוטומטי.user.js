// ==UserScript==
// @name         תלמוד - דיווח חודשי אוטומטי
// @namespace    https://talmud.edu.gov.il/
// @version      4.0
// @description  שולח דיווח חודשי אוטומטי לכל הסניפים במערכת תלמוד - עובד עם 1 סניף ועם עשרות סניפים
// @author       מרדכי יאקאב
// @match        https://talmud.edu.gov.il/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'autoReport_v4';

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function waitFor(fn, timeout, interval) {
        timeout = timeout || 10000;
        interval = interval || 200;
        return new Promise(function(resolve, reject) {
            var start = Date.now();
            function check() {
                var r = fn();
                if (r) return resolve(r);
                if (Date.now() - start > timeout) return reject(new Error('timeout'));
                setTimeout(check, interval);
            }
            check();
        });
    }

    function saveState(s) {
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch(e) {}
    }
    function loadState() {
        try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)); } catch(e) { return null; }
    }
    function clearState() {
        try { sessionStorage.removeItem(STORAGE_KEY); } catch(e) {}
    }

    function setStatus(msg, color) {
        var btn = document.getElementById('autoReportBtn');
        if (btn) {
            btn.textContent = msg;
            btn.style.background = color || '#1a6faf';
        }
        console.log('[AutoReport]', msg);
    }

    // איסוף כל הסניפים מהסרגל הצדדי
    function collectBranches() {
        return Array.from(document.querySelectorAll('[id^="ucTalmudSideBar_tvTalmudt"]'))
            .filter(function(el) {
                return el.tagName === 'A' && /^\d+$/.test(el.textContent.trim());
            })
            .map(function(el) {
                var m = el.href.match(/__doPostBack\('([^']+)','([^']*)'\)/);
                if (!m) return null;
                return {
                    num: el.textContent.trim(),
                    target: m[1],
                    arg: decodeURIComponent(m[2].replace(/\\\\/g, '\\'))
                };
            })
            .filter(Boolean);
    }

    // ניווט לסניף
    function navigateToBranch(branch) {
    __doPostBack(branch.target, branch.arg);
    }


    // האם כפתור שליחת דיווח פעיל (לא אפור)
    function isReportEnabled() {
        var btn = document.getElementById('ContentPlaceHolder1_btnReport');
        return btn &&
               btn.getAttribute('disabled') !== 'true' &&
               btn.className.indexOf('disabled') === -1;
    }

    // מעבר ללשונית "מצב תמיכה במוסד" (נדרש לפני שליחת הדיווח)
    function clickSupportTab() {
        var tab = document.getElementById('__tab_ContentPlaceHolder1_tabInstituteDetails_TabInstituteEntitlement');
        if (tab) tab.click();
    }

    // שליחת הדיווח לסניף הנוכחי
    async function sendReport() {
        var btn = document.getElementById('ContentPlaceHolder1_btnReport');
        var href = btn && btn.getAttribute('href');
        if (!href) throw new Error('כפתור שליחה לא נמצא');

        // הפעלה דרך href ישירות - עוקף את ה-onclick הבעייתי של האתר
        eval(href.replace('javascript:', ''));

        // המתן לפופאפ האזהרה עם כפתור "המשך"
        await waitFor(function() {
            var popup = document.getElementById('ucMessagePopUp_pnlMessagePopup');
            var ok = document.getElementById('ucMessagePopUp_btnMOK');
            return popup &&
                   window.getComputedStyle(popup).display !== 'none' &&
                   ok && window.getComputedStyle(ok).display !== 'none';
        }, 10000);
        await sleep(200);

        // לחץ "המשך"
        document.getElementById('ucMessagePopUp_btnMOK').click();

        // המתן לפופאפ ההצלחה עם "אישור" בלבד
        await waitFor(function() {
            var popup = document.getElementById('ucMessagePopUp_pnlMessagePopup');
            var cancel = document.getElementById('ucMessagePopUp_btnMCancel');
            var ok = document.getElementById('ucMessagePopUp_btnMOK');
            return popup &&
                   window.getComputedStyle(popup).display !== 'none' &&
                   cancel && window.getComputedStyle(cancel).display !== 'none' &&
                   (!ok || window.getComputedStyle(ok).display === 'none');
        }, 10000);
        await sleep(200);

        // לחץ "אישור"
        document.getElementById('ucMessagePopUp_btnMCancel').click();

        // המתן לסגירת הפופאפ
        await waitFor(function() {
            var popup = document.getElementById('ucMessagePopUp_pnlMessagePopup');
            return !popup || window.getComputedStyle(popup).display === 'none';
        }, 5000);
        await sleep(400);
    }

    // הלוגיקה הראשית - רצה בכל טעינת עמוד
    async function runOnPageLoad() {
        var state = loadState();
        if (!state || !state.running) return;
        if (window.location.href.indexOf('InstitutesDetails.aspx') === -1) {
            clearState();
            return;
        }

        addButton();
        setStatus('⏳ טוען...', '#e67e22');

        // המתן לטעינת הדף המלאה
        try {
            await waitFor(function() {
                var h1 = document.querySelector('h1');
                var btn = document.getElementById('ContentPlaceHolder1_btnReport');
                return h1 && h1.textContent.trim().length > 3 && btn;
            }, 15000);
        } catch(e) {
            clearState();
            setStatus('❌ תפג הזמן - רענן ונסה שוב', '#c0392b');
            return;
        }

        await sleep(500);

        var branches = state.branches;
        var currentIndex = state.currentIndex;
        var sent = state.sent;
        var skipped = state.skipped;

        // סיום - עברנו על כל הסניפים
        if (currentIndex >= branches.length) {
            clearState();
            var msg = '✅ הסתיים! נשלחו: ' + sent + ' | דולגו: ' + skipped;
            setStatus(msg, '#27ae60');
            document.getElementById('autoReportBtn').disabled = false;
            alert(msg);
            return;
        }

        var branch = branches[currentIndex];

        // בדיקה שהסניף שנטען הוא הסניף הצפוי
        var h1Text = document.querySelector('h1').textContent.trim();
        if (h1Text.indexOf(branch.num) === -1) {
            setStatus('🔄 מנסה שוב סניף ' + branch.num + '...', '#e67e22');
            await sleep(1000);
            navigateToBranch(branch);
            return;
        }

        setStatus('⏳ סניף ' + branch.num + ' (' + (currentIndex + 1) + '/' + branches.length + ')', '#e67e22');

        // אם הכפתור אפור - דלג לסניף הבא
        if (!isReportEnabled()) {
            console.log('[AutoReport] סניף ' + branch.num + ' - אפור, מדלג');
            var next = currentIndex + 1;
            saveState({ running: true, branches: branches, currentIndex: next, sent: sent, skipped: skipped + 1 });
            if (next < branches.length) {
                navigateToBranch(branches[next]);
            } else {
                window.location.reload();
            }
            return;
        }

        // מעבר ללשונית "מצב תמיכה במוסד" (חובה לפני השליחה)
        clickSupportTab();

        // שליחת הדיווח
        try {
            setStatus('📤 שולח סניף ' + branch.num + '...', '#e67e22');
            await sendReport();
            console.log('[AutoReport] סניף ' + branch.num + ' ✅');
            var nextIdx = currentIndex + 1;
            saveState({ running: true, branches: branches, currentIndex: nextIdx, sent: sent + 1, skipped: skipped });
            if (nextIdx < branches.length) {
                navigateToBranch(branches[nextIdx]);
            } else {
                window.location.reload();
            }
        } catch(err) {
            console.error('[AutoReport] שגיאה בסניף ' + branch.num + ':', err);
            setStatus('⚠️ שגיאה בסניף ' + branch.num + ' - ממשיך', '#c0392b');
            await sleep(2000);
            var nextOnErr = currentIndex + 1;
            saveState({ running: true, branches: branches, currentIndex: nextOnErr, sent: sent, skipped: skipped });
            if (nextOnErr < branches.length) {
                navigateToBranch(branches[nextOnErr]);
            } else {
                window.location.reload();
            }
        }
    }

    // לחיצה על הכפתור - התחלת התהליך
    async function startAutoReport() {
        var branches = collectBranches();
        if (!branches.length) {
            alert('לא נמצאו סניפים בדף זה.\nוודא שאתה נמצא בדף פרטי מוסד.');
            return;
        }
        document.getElementById('autoReportBtn').disabled = true;
        setStatus('⏳ מתחיל... (' + branches.length + ' סניפים)', '#e67e22');
        saveState({ running: true, branches: branches, currentIndex: 0, sent: 0, skipped: 0 });
        navigateToBranch(branches[0]);
    }

    // הוספת הכפתור לדף
    function addButton() {
        if (document.getElementById('autoReportBtn')) return;
        var btn = document.createElement('button');
        btn.id = 'autoReportBtn';
        btn.textContent = '▶ דיווח אוטומטי';
        btn.style.cssText = [
            'position:fixed',
            'bottom:20px',
            'left:20px',
            'z-index:99999',
            'background:#1a6faf',
            'color:white',
            'border:none',
            'padding:10px 18px',
            'font-size:15px',
            'font-weight:bold',
            'border-radius:6px',
            'cursor:pointer',
            'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
            'direction:rtl'
        ].join(';');
        btn.addEventListener('click', startAutoReport);
        document.body.appendChild(btn);
    }

    // כניסה ראשית - בכל טעינת עמוד
    window.addEventListener('load', async function() {
        await sleep(800);

        if (window.location.href.indexOf('InstitutesDetails.aspx') === -1) {
            var s = loadState();
            if (s && s.running) clearState();
            return;
        }

        addButton();

        var state = loadState();
        if (state && state.running) {
            runOnPageLoad();
        }
    });

})();