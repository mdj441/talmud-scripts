// פאנל קליטת תלמידים v3.3 — פורט מהפאנל של v3.2 (createUI:764, init:903) עם תוספות:
// תצוגת שגיאות-פרסור לפני ריצה, "העתק לאקסל" (TSV), "תבנית לאקסל", דוח "מה נשאר" בסיום,
// עצירה בכפתור וב-Escape, ו-resume אוטומטי אחרי ניווט מלא.
// אין גישה ל-document/window ברמת המודול — init רץ רק כשיש document (בסוף הקובץ).

import { $el } from './core/dom.js';
import { log, getLogText, clearLog, setLogListener, copyLog } from './core/log.js';
import { downloadCsv, copyTextToClipboard } from './core/csv.js';
import { getPage } from './core/navigate.js';
import { parseAbsorbInput } from './tools/absorb-parse.js';
import { loadXlsxFile } from './tools/absorb-xlsx.js';
import { ABSORB_TEMPLATE_HEADER, isAbsorbSuccess, absorbStatusKey, buildResultsTsv, buildResultsCsvRows } from './tools/absorb.js';
import { absorbSetHooks, absorbStartRun, absorbResumeIfPending, absorbStop, absorbHasSavedQueue, absorbGetResults, absorbIsRunning, clearAbsorbStop } from './tools/absorb.js';
import { absorbSavedQueueInfo, absorbDiscardSavedQueue } from './tools/absorb.js';

const PANEL_VERSION = '3.3';
let panelAwaitingErrorConfirm = false;
let panelResults = [];
let panelTotal = 0;

function panelEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function panelToday() {
  const d = new Date();
  return [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('/');
}

function panelSetStatus(msg) {
  const el = $el('tma3-status');
  if (el) el.textContent = msg;
}

function panelSetProgress(cur, total) {
  const el = $el('tma3-progress');
  if (el) el.textContent = `${cur} / ${total}`;
}

function panelSetRunning(on) {
  const start = $el('tma3-start');
  if (start) start.disabled = !!on;
}

function panelFlash(id, tempText, backText) {
  const btn = $el(id);
  if (!btn) return;
  btn.textContent = tempText;
  setTimeout(() => { const b = $el(id); if (b) b.textContent = backText; }, 2000);
}

// ─── רינדור ─────────────────────────────────────────────────────────────────

function panelRenderErrors(errors, validCount) {
  const box = $el('tma3-errors');
  if (!box) return;
  if (!errors || !errors.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  let html = `<div style="font-weight:bold;margin-bottom:4px">⚠️ ${errors.length} שורות לא יורצו (${validCount} תקינות):</div>`;
  html += '<ul style="margin:0;padding-inline-start:18px">';
  for (const e of errors.slice(0, 25)) {
    html += `<li>שורה ${panelEsc(e.line)}: ${panelEsc(e.reason)}</li>`;
  }
  if (errors.length > 25) html += `<li>… ועוד ${errors.length - 25}</li>`;
  html += '</ul>';
  box.innerHTML = html;
  box.style.display = 'block';
}

// המזהה המלא מוצג בטבלה ובדוח (צורך תפעולי) — בלוג הוא תמיד ממוסך.
function panelRenderResults() {
  const container = $el('tma3-results');
  if (!container) return;
  if (!panelResults.length) { container.innerHTML = ''; return; }
  let html = '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += `<tr style="background:#0a5c0a;color:#fff;text-align:center">
    <th style="padding:3px 6px">סניף</th><th style="padding:3px 6px">סוג</th>
    <th style="padding:3px 6px">ת.ז./דרכון</th><th style="padding:3px 6px">סטטוס</th></tr>`;
  for (const r of panelResults) {
    const status = r.status || '';
    const key = absorbStatusKey(status);
    const ok = isAbsorbSuccess(status);
    const stopped = key === 'נעצר' || key === 'דולג';
    const color = ok ? '#0a5c0a' : stopped ? '#a67c00' : '#a00';
    const bg = ok ? '#f0fff0' : stopped ? '#fffbe6' : '#fff5f5';
    const title = r.detail ? ` title="${panelEsc(r.detail)}"` : '';
    html += `<tr style="border-bottom:1px solid #eee;background:${bg}"${title}>
      <td style="padding:2px 6px;text-align:center">${panelEsc(r.branch)}</td>
      <td style="padding:2px 6px;text-align:center">${panelEsc(r.studyType)}</td>
      <td style="padding:2px 6px;direction:ltr;font-family:monospace;font-size:11px">${panelEsc(r.identity)}</td>
      <td style="padding:2px 6px;color:${color};font-weight:bold;font-size:11px">${panelEsc(status)}</td></tr>`;
  }
  html += '</table>';
  container.innerHTML = html;
}

// M5: תור שמור ישן לא ממשיך מעצמו — מציגים אותו עם "המשך"/"נקה", בלי שום פעולה אוטומטית.
function panelRenderStaleQueue(info) {
  const box = $el('tma3-stale');
  if (!box) return;
  if (!info) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const left = Math.max(0, (info.total || 0) - (info.curIdx || 0));
  const startedMs = Date.parse(info.startedAt);
  const ageMin = Number.isNaN(startedMs) ? null : Math.round((Date.now() - startedMs) / 60000);
  box.innerHTML = `
    <div style="font-weight:bold;margin-bottom:4px">⏸ נמצא תור שמור${ageMin === null ? '' : ` מלפני ${panelEsc(ageMin)} דקות`}</div>
    <div style="margin-bottom:6px">${panelEsc(left)} שורות טרם עובדו (${panelEsc(info.curIdx || 0)} מתוך ${panelEsc(info.total || 0)} הושלמו).
      התור ישן מדי כדי להמשיך אוטומטית — בחר מה לעשות.</div>
    <div style="display:flex;gap:6px">
      <button id="tma3-stale-go" style="flex:1;background:#0a5c0a;color:#fff;border:none;
              padding:5px;border-radius:4px;cursor:pointer;font-size:12px">▶ המשך</button>
      <button id="tma3-stale-clear" style="flex:1;background:#922b21;color:#fff;border:none;
              padding:5px;border-radius:4px;cursor:pointer;font-size:12px">🗑 נקה</button>
    </div>`;
  box.style.display = 'block';
  const go = $el('tma3-stale-go');
  if (go) {
    go.addEventListener('click', () => {
      panelRenderStaleQueue(null);
      panelSetStatus('ממשיך את התור השמור…');
      panelSetRunning(true);
      Promise.resolve()
        .then(() => absorbResumeIfPending({ allowStale: true }))
        .catch((e) => { log('[resume] כשל: ' + (e && e.message)); panelSetRunning(false); });
    });
  }
  const clear = $el('tma3-stale-clear');
  if (clear) {
    clear.addEventListener('click', () => {
      absorbDiscardSavedQueue();
      panelRenderStaleQueue(null);
      panelSetRunning(false);
      panelSetStatus('התור השמור נמחק — אפשר להתחיל ריצה חדשה');
    });
  }
}

function panelRenderReport(report) {
  const box = $el('tma3-report');
  if (!box) return;
  if (!report) { box.style.display = 'none'; box.innerHTML = ''; return; }
  let html = `<div style="font-weight:bold;margin-bottom:4px">📊 סיכום: ${panelEsc(report.summary || '—')}</div>`;
  if (report.lines.length) {
    html += '<div style="font-weight:bold;margin:6px 0 3px">מה נשאר לעשות:</div><ul style="margin:0;padding-inline-start:18px">';
    for (const line of report.lines) html += `<li style="margin-bottom:2px">${panelEsc(line)}</li>`;
    html += '</ul>';
  } else {
    html += '<div>הכול טופל — אין שורות שדורשות טיפול ✓</div>';
  }
  box.innerHTML = html;
  box.style.display = 'block';
}

// ─── פעולות ─────────────────────────────────────────────────────────────────

async function panelStart() {
  if (absorbIsRunning()) return;
  const input = $el('tma3-input');
  const text = ((input && input.value) || '').trim();
  if (!text) { panelSetStatus('הדבק רשימת תלמידים (אפשר להעתיק טורים ישירות מאקסל)'); return; }

  const parsed = parseAbsorbInput(text);
  if (parsed.errors.length && !panelAwaitingErrorConfirm) {
    panelRenderErrors(parsed.errors, parsed.tasks.length);
    panelAwaitingErrorConfirm = true;
    const btn = $el('tma3-start');
    if (btn) btn.textContent = parsed.tasks.length ? `▶ המשך בכל זאת (${parsed.tasks.length})` : '▶ התחל';
    panelSetStatus(`${parsed.errors.length} שורות בעייתיות — תקן, או לחץ שוב כדי להריץ רק את התקינות`);
    log(`[פרסור] ${parsed.tasks.length} תקינות · ${parsed.errors.length} שגויות`);
    return;
  }

  if (!parsed.tasks.length) {
    panelRenderErrors(parsed.errors, 0);
    panelSetStatus('אין שורות תקינות להרצה');
    return;
  }

  panelAwaitingErrorConfirm = false;
  const btn = $el('tma3-start');
  if (btn) btn.textContent = '▶ התחל';
  panelRenderReport(null);
  panelRenderStaleQueue(null);
  panelResults = [];
  panelRenderResults();
  clearAbsorbStop();
  panelSetRunning(true);
  panelSetProgress(0, parsed.tasks.length);
  panelSetStatus(`מריץ ${parsed.tasks.length} תלמידים…`);
  log(`[התחלה] ${parsed.tasks.length} תלמידים · תאריך תחילת לימודים "${panelStartDate() || '(ברירת מחדל של האתר)'}"`);
  await absorbStartRun(parsed.tasks);
}

function panelStartDate() {
  const el = $el('tma3-start-date');
  return el ? String(el.value || '').trim() : '';
}

function panelCopyTsv() {
  const results = absorbGetResults();
  const rows = results.length ? results : panelResults;
  if (!rows.length) { panelSetStatus('אין תוצאות להעתקה'); return; }
  copyTextToClipboard(buildResultsTsv(rows)).then((ok) => {
    panelFlash('tma3-tsv', ok ? '✓ הועתק' : '✗ העתקה נכשלה', '📋 העתק לאקסל');
    panelSetStatus(ok ? 'התוצאות הועתקו — הדבק באקסל (Ctrl+V)' : 'ההעתקה נחסמה בדפדפן; השתמש בייצוא CSV');
  });
}

function panelExportCsv() {
  const results = absorbGetResults();
  const rows = results.length ? results : panelResults;
  if (!rows.length) { panelSetStatus('אין תוצאות לייצוא'); return; }
  const name = `absorptions_${new Date().toISOString().slice(0, 10)}.csv`;
  const ok = downloadCsv(name, buildResultsCsvRows(rows));
  panelSetStatus(ok ? `הורד ${name}` : 'הייצוא נכשל');
  log('[CSV] ייצוא תוצאות');
}

function panelDownloadTemplate() {
  const ok = downloadCsv('תבנית-קליטת-תלמידים.csv', [ABSORB_TEMPLATE_HEADER.slice()]);
  panelSetStatus(ok ? 'הורדה תבנית לאקסל — מלא ושמור, ואז העתק את הטורים לכאן' : 'הורדת התבנית נכשלה');
  log('[תבנית] הורדה');
}

// טעינת קובץ אקסל: ממלאת את ה-textarea ותו לא — המשתמש עדיין לוחץ "התחל" בעצמו
// (מסלול פרסור אחד: xlsx → טקסט טאבים → parseAbsorbInput, כמו הדבקה ידנית).
function panelHandleXlsxFile(ev) {
  const input = ev && ev.target;
  const file = input && input.files && input.files[0];
  if (!file) return;
  const fileName = file.name;
  panelSetStatus('טוען קובץ אקסל…');
  Promise.resolve()
    .then(() => loadXlsxFile(file))
    .then((text) => {
      const ta = $el('tma3-input');
      if (ta) ta.value = text;
      const lineCount = text ? text.split('\n').length : 0;
      panelSetStatus(`נטענו ${lineCount} שורות מהקובץ — בדוק ולחץ התחל`);
      log(`[אקסל] נטענו ${lineCount} שורות מ"${fileName}"`);
      if (panelAwaitingErrorConfirm) {
        panelAwaitingErrorConfirm = false;
        const btn = $el('tma3-start');
        if (btn) btn.textContent = '▶ התחל';
        panelRenderErrors([], 0);
      }
    })
    .catch((e) => {
      const msg = (e && e.message) || 'שגיאה לא ידועה';
      panelSetStatus('טעינת האקסל נכשלה: ' + msg);
      log('[אקסל] כשל: ' + msg);
    })
    .finally(() => { if (input) input.value = ''; });
}

function panelHandleStop() {
  panelSetStatus('עוצר…');
  log('⛔ עצירה לבקשת המשתמש');
  absorbStop();
  panelSetRunning(false);
}

// ─── בניית הפאנל (נראות v3.2) ───────────────────────────────────────────────

// ‏A3: מחזירה true רק כשהפאנל **הזה** נוצר עכשיו. פאנל שכבר קיים = מופע אחר של v3.3
// שכבר מנהל את הדף; המשך האתחול (hooks, resume) היה נותן שני מנהלים לאותו תור.
// כל ה-ids/מזהי-האלמנטים כאן ממורחבים ב-tma3- כדי שלא יתנגשו עם סקריפט v3.2 הישן
// (‏tma-…), שעשוי להיות מותקן במקביל עד שהבדיקה הרטובה תעבור.
function panelCreateUI() {
  if ($el('tma3-panel')) return false;
  if (typeof document === 'undefined' || !document.body) return false;
  const panel = document.createElement('div');
  panel.id = 'tma3-panel';
  panel.style.cssText = `
    position:fixed;top:60px;right:10px;z-index:99999;
    background:#fff;border:2px solid #0a5c0a;border-radius:8px;
    width:440px;font-family:Arial,sans-serif;font-size:13px;
    direction:rtl;box-shadow:0 4px 20px rgba(0,0,0,.35);`;
  panel.innerHTML = `
    <div id="tma3-header" style="background:#0a5c0a;color:#fff;padding:8px 12px;
         border-radius:6px 6px 0 0;cursor:move;display:flex;justify-content:space-between;align-items:center;user-select:none">
      <span style="font-weight:bold;font-size:14px">📥 קליטת תלמידים v${PANEL_VERSION}</span>
      <span id="tma3-progress" style="font-size:11px;opacity:.8">0 / 0</span>
      <span id="tma3-toggle" style="cursor:pointer;font-size:16px;line-height:1;padding:0 4px">▲</span>
    </div>
    <div id="tma3-body" style="padding:10px">
      <div id="tma3-status" style="color:#555;font-size:11px;margin-bottom:8px;
           padding:4px 8px;background:#f0f8f0;border-radius:4px">מוכן</div>
      <div style="font-size:10px;color:#777;margin-bottom:5px;
           background:#f9f9f9;padding:5px 7px;border-radius:3px;border:1px solid #e0e0e0;line-height:1.7">
        <b>טורים מאקסל</b> (טאבים או פסיקים, עם שורת כותרת או בלי):<br>
        <code style="direction:ltr;display:inline-block">סניף | סוג לימוד | ת.ז./דרכון | שם פרטי | שם משפחה | תאריך לידה | ארץ | מגדר | מצב משפחתי</code><br>
        <span style="color:#aaa">חובה: 3 הראשונים. דרכון — גם תאריך לידה + ארץ. תלמיד חדש — גם שם פרטי, שם משפחה ות.לידה.</span>
      </div>
      <textarea id="tma3-input"
        placeholder="01&#9;300&#9;123456789&#10;12&#9;600&#9;AB1234567&#9;&#9;&#9;15/03/1995&#9;צרפת"
        style="width:100%;height:100px;box-sizing:border-box;font-size:12px;
               padding:5px;direction:ltr;resize:vertical;
               border:1px solid #aaa;border-radius:4px;font-family:monospace"></textarea>
      <div id="tma3-errors" style="display:none;font-size:11px;color:#8a1f11;background:#fff5f5;
           border:1px solid #f0c0c0;border-radius:4px;padding:5px 7px;margin:6px 0;max-height:110px;overflow-y:auto"></div>
      <div id="tma3-stale" style="display:none;font-size:11px;color:#5a4a00;background:#fffbe6;
           border:1px solid #e8d9a0;border-radius:4px;padding:6px 8px;margin:6px 0"></div>
      <div style="display:flex;gap:8px;margin:6px 0;align-items:flex-end">
        <div style="flex:1">
          <label style="font-size:11px;color:#444;display:block;margin-bottom:2px">
            📅 תאריך תחילת לימודים (ריק = ברירת המחדל של האתר)
          </label>
          <input id="tma3-start-date" type="text" placeholder="${panelToday()}"
            style="width:100%;box-sizing:border-box;font-size:12px;padding:4px;
                   border:1px solid #aaa;border-radius:4px;direction:ltr;font-family:monospace"
            maxlength="10">
        </div>
      </div>
      <div style="display:flex;gap:6px;margin:6px 0">
        <button id="tma3-start" style="flex:2;background:#0a5c0a;color:#fff;border:none;
                padding:8px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px">
          ▶ התחל</button>
        <button id="tma3-stop" style="flex:1;background:#922b21;color:#fff;border:none;
                padding:8px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:bold">
          ⏹ עצור</button>
      </div>
      <div style="display:flex;gap:6px;margin:6px 0">
        <button id="tma3-tsv" style="flex:1;background:#1f618d;color:#fff;border:none;
                padding:6px;border-radius:4px;cursor:pointer;font-size:12px">📋 העתק לאקסל</button>
        <button id="tma3-csv" style="flex:1;background:#117a65;color:#fff;border:none;
                padding:6px;border-radius:4px;cursor:pointer;font-size:12px">💾 ייצוא CSV</button>
        <button id="tma3-template" style="flex:1;background:#6c3483;color:#fff;border:none;
                padding:6px;border-radius:4px;cursor:pointer;font-size:12px">📄 תבנית לאקסל</button>
        <button id="tma3-xlsx" style="flex:1;background:#b9770e;color:#fff;border:none;
                padding:6px;border-radius:4px;cursor:pointer;font-size:12px">📥 טען מאקסל</button>
        <input id="tma3-xlsx-file" type="file" accept=".xlsx,.xls" style="display:none">
      </div>
      <div id="tma3-results" style="max-height:170px;overflow-y:auto;margin-bottom:6px;
           border:1px solid #ddd;border-radius:4px;min-height:10px"></div>
      <div id="tma3-report" style="display:none;font-size:11px;color:#333;background:#fffdf5;
           border:1px solid #e8d9a0;border-radius:4px;padding:6px 8px;margin-bottom:6px;max-height:160px;overflow-y:auto"></div>
      <details id="tma3-log-details">
        <summary style="cursor:pointer;font-size:11px;color:#555;padding:3px 0;user-select:none">
          📋 יומן פעילות (מזהים ממוסכים — בטוח לצרף בדיווח בעיות)</summary>
        <div style="display:flex;gap:4px;margin:4px 0 2px">
          <button id="tma3-copy-log" style="flex:1;font-size:11px;padding:3px 6px;
                  background:#555;color:#fff;border:none;border-radius:3px;cursor:pointer">📋 העתק לוג</button>
          <button id="tma3-clear-log" style="flex:1;font-size:11px;padding:3px 6px;
                  background:#888;color:#fff;border:none;border-radius:3px;cursor:pointer">🗑 נקה לוג</button>
        </div>
        <pre id="tma3-log" style="max-height:150px;overflow-y:auto;font-size:10px;
             background:#1e1e1e;color:#d4d4d4;padding:8px;margin:0;
             border-radius:4px;white-space:pre-wrap;direction:ltr;
             border:1px solid #333;line-height:1.4"></pre>
      </details>
    </div>`;
  document.body.appendChild(panel);

  let drag = null;
  $el('tma3-header').addEventListener('mousedown', (e) => {
    if (e.target.id === 'tma3-toggle') return;
    drag = { sx: e.clientX - panel.offsetLeft, sy: e.clientY - panel.offsetTop };
    panel.style.right = 'auto';
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    panel.style.left = (e.clientX - drag.sx) + 'px';
    panel.style.top = (e.clientY - drag.sy) + 'px';
  });
  document.addEventListener('mouseup', () => { drag = null; });

  $el('tma3-toggle').addEventListener('click', () => {
    const body = $el('tma3-body');
    const tog = $el('tma3-toggle');
    if (body.style.display === 'none') { body.style.display = ''; tog.textContent = '▲'; }
    else { body.style.display = 'none'; tog.textContent = '▼'; }
  });

  $el('tma3-start-date').addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '');
    if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    if (v.length > 5) v = v.slice(0, 5) + '/' + v.slice(5, 9);
    this.value = v;
  });

  $el('tma3-input').addEventListener('input', () => {
    if (!panelAwaitingErrorConfirm) return;
    panelAwaitingErrorConfirm = false;
    const b = $el('tma3-start');
    if (b) b.textContent = '▶ התחל';
    panelRenderErrors([], 0);
  });

  // M-e: ‏panelStart היא async — בלי catch, כשל בהרצה היה נעלם כ-unhandled rejection
  // וכפתור "התחל" היה נשאר מנוטרל לנצח (הפאנל תקוע בלי דרך חזרה).
  $el('tma3-start').addEventListener('click', () => {
    Promise.resolve()
      .then(() => panelStart())
      .catch((e) => {
        log('[התחלה] ההרצה נכשלה: ' + (e && e.message));
        panelSetRunning(false);
        panelSetStatus('ההרצה נכשלה — בדוק את הלוג ונסה שוב');
      });
  });
  $el('tma3-stop').addEventListener('click', panelHandleStop, true);
  $el('tma3-tsv').addEventListener('click', panelCopyTsv);
  $el('tma3-csv').addEventListener('click', panelExportCsv);
  $el('tma3-template').addEventListener('click', panelDownloadTemplate);
  $el('tma3-xlsx').addEventListener('click', () => { const f = $el('tma3-xlsx-file'); if (f) f.click(); });
  $el('tma3-xlsx-file').addEventListener('change', panelHandleXlsxFile);
  $el('tma3-copy-log').addEventListener('click', () => {
    copyLog().then((ok) => panelFlash('tma3-copy-log', ok ? '✓ הועתק' : '✗ נכשל', '📋 העתק לוג'));
  });
  $el('tma3-clear-log').addEventListener('click', () => {
    clearLog();
    log('[לוג] נוקה');
  });

  // עצירה גם ב-Escape (global-constraints: "תמיד עצור זמין — כפתור + Escape")
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!absorbIsRunning() && !absorbHasSavedQueue()) return;
    e.preventDefault();
    panelHandleStop();
  }, true);

  setLogListener(() => {
    const el = $el('tma3-log');
    if (!el) return;
    el.textContent = getLogText();
    el.scrollTop = el.scrollHeight;
  });
  return true;
}

// ─── אתחול ──────────────────────────────────────────────────────────────────

export function initAbsorbPanel() {
  const page = getPage();
  const resumable = absorbHasSavedQueue();
  const savedInfo = absorbSavedQueueInfo();
  // הפאנל עולה בדפי מוסד / סוג-לימוד / תלמיד-חדש. חריג מכוון: גם בדף לא-מוכר כשיש
  // תור שמור — אחרת אצווה שנחתה בדף לא-צפוי נתקעת בלי שום ממשק (global-constraints).
  if (page.kind === 'other' && !resumable) return false;

  // ‏A3: בלי פאנל אין ממשק — אין "עצור" ואין Escape (שניהם נקשרים בתוך panelCreateUI).
  // רישום hooks והפעלת resume במצב כזה היו מריצים אצווה שאי-אפשר לעצור, ובמקרה של
  // שני מופעים מותקנים — גם דורסים את ה-hooks של המופע שכן מנהל את הדף. יוצאים.
  let created = false;
  try {
    created = panelCreateUI() === true;
  } catch (e) {
    log('[init] בניית הפאנל נכשלה: ' + (e && e.message));
  }
  if (!created || !$el('tma3-panel')) {
    log('[init] הפאנל לא נוצר (כבר קיים מופע אחר?) — לא נרשמים hooks ולא ממשיכים תור');
    return false;
  }

  absorbSetHooks({
    getStartDate: panelStartDate,
    onStart: (queue, idx) => { panelTotal = queue.length; panelSetProgress(idx, panelTotal); panelSetRunning(true); },
    onResume: (queue, results, idx) => {
      panelTotal = queue.length;
      panelResults = results.slice();
      panelRenderResults();
      panelSetProgress(idx, panelTotal);
      panelSetRunning(true);
      panelSetStatus(`ממשיך אחרי ניווט — ${idx + 1} מתוך ${panelTotal}`);
    },
    onProgress: (idx, total, task) => {
      panelTotal = total;
      panelSetProgress(idx, total);
      panelSetStatus(`מעבד ${idx + 1}/${total}: סניף ${task.branch} · סוג ${task.studyType} · ${task.identity}`);
    },
    onResult: (result, all) => {
      panelResults = all.slice();
      panelRenderResults();
      panelSetProgress(all.length, Math.max(panelTotal, all.length));
    },
    // B1: הוכרז ניווט מלא — הריצה ממתינה לטעינת הדף (ויש כלב-שומר אם היא לא תגיע).
    onNavigating: () => { panelSetStatus('ממתין לטעינת דף…'); },
    // M5: תור ישן — לא ממשיכים אוטומטית, נותנים למשתמש "המשך"/"נקה".
    onStaleQueue: (info) => {
      panelSetRunning(false);
      panelSetStatus('יש תור שמור ישן — בחר "המשך" או "נקה"');
      panelRenderStaleQueue(info);
    },
    onDone: (results, report) => {
      panelResults = results.slice();
      panelRenderResults();
      panelRenderReport(report);
      panelSetRunning(false);
      panelSetProgress(results.length, results.length);
      const left = report.lines.length;
      panelSetStatus(left ? `הסתיים — ${left} שורות דורשות טיפול (ראה "מה נשאר")` : 'הסתיים ✓ הכול טופל');
    },
  });

  log(`[init] קליטת תלמידים v${PANEL_VERSION} · דף ${page.kind}${page.branch ? ' · סניף ' + page.branch : ''}${page.studyType ? ' · סוג ' + page.studyType : ''}`);

  panelResults = absorbGetResults();
  panelRenderResults();

  if (resumable && savedInfo && savedInfo.stale) panelSetStatus('נמצא תור שמור ישן — בודק…');
  else if (resumable) panelSetStatus('נמצא תור פתוח — ממשיך…');
  // גם כשאין תור פתוח: הקריאה מנקה מצב שמור שנותר מריצה שהסתיימה (לא זורקת בלי מצב).
  Promise.resolve()
    .then(() => absorbResumeIfPending())
    .catch((e) => { log('[resume] כשל: ' + (e && e.message)); panelSetRunning(false); });
  return true;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initAbsorbPanel(); });
  } else {
    setTimeout(() => { initAbsorbPanel(); }, 800);
  }
}
