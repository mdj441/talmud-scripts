// השלד המאוחד: כפתור צף + חלונית אחת עם לשוניות לכלים הרלוונטיים לדף הנוכחי.
// כל כלי נרשם עם registerTool({ id, title, pages, mount, onStop, isRunning, hasPendingRun }).
// ‏mount(container, ui) מרנדר את הלשונית; ui = { status(msg), progress(cur,total), running(bool), open() }.
// Escape → onStop של הלשונית הפעילה (רק כשהיא רצה). אין גישה ל-document ברמת המודול.

import { $el } from '../core/dom.js';
import { log } from '../core/log.js';
import { esc, logSectionHtml, bindLogSection, buttonHtml } from './widgets.js';

export const PANEL_VERSION = '4.0';
const UI_KEY = 'tt.ui';
const tools = [];
let activeToolId = null;

export function registerTool(tool) {
  if (!tool || !tool.id) throw new Error('registerTool: חסר id');
  if (!tools.some((t) => t.id === tool.id)) tools.push(tool);
}

export function registeredTools() { return tools.slice(); }

function loadUiState() {
  try { return JSON.parse(localStorage.getItem(UI_KEY) || 'null') || {}; } catch (e) { return {}; }
}
function saveUiState(patch) {
  try { localStorage.setItem(UI_KEY, JSON.stringify(Object.assign(loadUiState(), patch))); } catch (e) { /* noop */ }
}

export const PANEL_CSS = `
#tt-fab{position:fixed;bottom:18px;right:18px;z-index:99998;width:46px;height:46px;border-radius:50%;border:none;
  background:#2f6b8f;color:#fff;font-size:20px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center}
#tt-fab:hover{background:#255878}
#tt-fab .tt-badge{position:absolute;top:-4px;right:-4px;background:#c0392b;color:#fff;font-size:10px;border-radius:9px;padding:1px 5px;font-family:Arial,sans-serif;display:none}
#tt-fab.tt-running .tt-badge{display:block}
#tt-panel{position:fixed;top:56px;right:14px;z-index:99999;width:560px;max-width:calc(100vw - 28px);max-height:calc(100vh - 72px);
  display:flex;flex-direction:column;background:#fff;color:#1f2933;border:1px solid #cfd8e3;border-radius:10px;
  box-shadow:0 8px 28px rgba(0,0,0,.28);font-family:"Segoe UI",Arial,sans-serif;font-size:13px;direction:rtl;line-height:1.45}
#tt-panel[hidden]{display:none}
#tt-panel *{box-sizing:border-box}
.tt-head{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#2f6b8f;color:#fff;border-radius:10px 10px 0 0;cursor:move;user-select:none}
.tt-head .tt-title{font-weight:700;font-size:14px;flex:1}
.tt-head .tt-ver{font-size:11px;opacity:.75}
.tt-head .tt-x{background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0 4px;line-height:1}
.tt-tabs{display:flex;gap:2px;padding:6px 10px 0;background:#f2f6f9;border-bottom:1px solid #dbe4ec}
.tt-tab{border:1px solid transparent;border-bottom:none;background:transparent;padding:6px 12px;border-radius:7px 7px 0 0;cursor:pointer;font-size:13px;color:#3e5566}
.tt-tab:hover{background:#e7eef4}
.tt-tab.tt-tab-active{background:#fff;border-color:#dbe4ec;color:#1f2933;font-weight:600;margin-bottom:-1px}
.tt-tab .tt-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#c0392b;margin-inline-start:6px;vertical-align:middle}
.tt-body{padding:10px 12px 12px;overflow:auto}
.tt-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.tt-status{flex:1;font-size:12px;color:#334e68;background:#f2f6f9;border-radius:6px;padding:5px 9px;min-height:26px}
.tt-progress{font-size:12px;color:#627d98;white-space:nowrap}
.tt-row{display:flex;gap:6px;margin:6px 0;flex-wrap:wrap;align-items:center}
.tt-row-tight{margin:4px 0 2px}
.tt-row > .tt-btn{flex:1 1 auto}
.tt-btn{border:1px solid #cfd8e3;background:#fff;color:#1f2933;padding:7px 10px;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit}
.tt-btn:hover{background:#f2f6f9}
.tt-btn:disabled{opacity:.5;cursor:default}
.tt-btn-primary{background:#2f6b8f;border-color:#2f6b8f;color:#fff;font-weight:600}
.tt-btn-primary:hover{background:#255878}
.tt-btn-danger{background:#fff;border-color:#c0392b;color:#c0392b;font-weight:600}
.tt-btn-danger:hover{background:#fdf1ef}
.tt-btn-ghost{background:#fff}
.tt-btn-subtle{background:#f2f6f9;border-color:#e1e8ef;color:#3e5566}
.tt-btn-sm{padding:4px 8px;font-size:12px}
.tt-field{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#3e5566;flex:1}
.tt-field-label{font-weight:600}
.tt-hint{font-size:11px;color:#627d98}
.tt-hint-warn{color:#8a5a00}
.tt-input,.tt-select,.tt-textarea{border:1px solid #cfd8e3;border-radius:6px;padding:6px 8px;font-size:13px;font-family:inherit;background:#fff;color:#1f2933;width:100%}
.tt-input:focus,.tt-select:focus,.tt-textarea:focus{outline:2px solid #9cc3dc;outline-offset:0;border-color:#2f6b8f}
.tt-textarea{min-height:90px;resize:vertical;direction:ltr;font-family:Consolas,monospace;font-size:12px}
.tt-mono{direction:ltr;font-family:Consolas,monospace;font-size:12px;text-align:left}
.tt-center{text-align:center}
.tt-box{border:1px solid #dbe4ec;border-radius:7px;padding:8px 10px;margin:6px 0;font-size:12px;background:#fafcfd}
.tt-box-warn{background:#fff8e6;border-color:#eadba6;color:#5a4a00}
.tt-box-error{background:#fdf1ef;border-color:#f0c4bd;color:#7a1f16}
.tt-box-info{background:#eef5fa;border-color:#cfe0ec;color:#24455c}
.tt-box ul,.tt-box ol{margin:4px 0 0;padding-inline-start:18px}
.tt-table{width:100%;border-collapse:collapse;font-size:12px;margin:4px 0}
.tt-table th{background:#f2f6f9;color:#334e68;font-weight:600;padding:5px 6px;text-align:right;border-bottom:1px solid #dbe4ec;position:sticky;top:0}
.tt-table td{padding:4px 6px;border-bottom:1px solid #eef2f6;vertical-align:middle}
.tt-table tr.tt-r-ok td.tt-status-cell{color:#1e7145;font-weight:600}
.tt-table tr.tt-r-warn td.tt-status-cell{color:#8a5a00;font-weight:600}
.tt-table tr.tt-r-bad td.tt-status-cell{color:#a2261a;font-weight:600}
.tt-table tr.tt-r-ok{background:#f3faf5}.tt-table tr.tt-r-warn{background:#fffaf0}.tt-table tr.tt-r-bad{background:#fdf5f4}
.tt-scroll{max-height:220px;overflow:auto;border:1px solid #e1e8ef;border-radius:7px}
.tt-empty{color:#829ab1;font-size:12px;padding:6px}
.tt-report-summary{font-weight:600;margin:4px 0}
.tt-report-title{font-weight:600;margin-top:6px}
.tt-report-list{margin:4px 0 0;padding-inline-start:18px}
.tt-report-list li{margin-bottom:3px}
.tt-ok{color:#1e7145}
.tt-log-details{margin-top:8px}
.tt-log-details summary{cursor:pointer;font-size:12px;color:#627d98;user-select:none}
.tt-log{max-height:160px;overflow:auto;background:#1e1e1e;color:#d4d4d4;padding:8px;border-radius:6px;font-size:11px;white-space:pre-wrap;direction:ltr;text-align:left;margin:4px 0 0;font-family:Consolas,monospace}
.tt-chips{display:flex;flex-wrap:wrap;gap:4px;max-height:140px;overflow:auto;padding:4px 0}
.tt-chip{border:1px solid #cfe0ec;border-radius:12px;padding:1px 8px;background:#fff;cursor:pointer;font-size:12px}
.tt-chip:hover{background:#eef5fa}
.tt-grid-input{width:100%;border-collapse:collapse;font-size:12px}
.tt-grid-input th{background:#f2f6f9;font-weight:600;padding:4px 5px;text-align:right;border-bottom:1px solid #dbe4ec;white-space:nowrap}
.tt-grid-input td{padding:2px 3px;border-bottom:1px solid #eef2f6}
.tt-grid-input .tt-input,.tt-grid-input .tt-select{padding:4px 6px;font-size:12px;min-width:0}
.tt-grid-input tr.tt-r-bad td{background:#fdf5f4}
.tt-cell-off{background:#f7f9fb}
`;

function ensureStyle() {
  if ($el('tt-style')) return;
  const style = document.createElement('style');
  style.id = 'tt-style';
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

function toolsForPage(pageKind) {
  return tools.filter((t) => {
    const fits = Array.isArray(t.pages) && t.pages.includes(pageKind);
    let pending = false;
    try { pending = !!(t.hasPendingRun && t.hasPendingRun()); } catch (e) { pending = false; }
    return fits || pending;
  });
}

function toolById(id) { return tools.find((t) => t.id === id) || null; }

function makeUi(tool) {
  return {
    status(msg) { const el = $el(`tt-${tool.id}-status`); if (el) el.textContent = msg == null ? '' : String(msg); },
    progress(cur, total) { const el = $el(`tt-${tool.id}-progress`); if (el) el.textContent = total ? `${cur} / ${total}` : ''; },
    running(on) {
      const fab = $el('tt-fab');
      if (fab) fab.classList.toggle('tt-running', !!on);
      const tab = $el(`tt-tab-${tool.id}`);
      if (tab) { const dot = tab.querySelector('.tt-dot'); if (dot) dot.hidden = !on; }
    },
    open() { openPanel(true); activateTab(tool.id); },
  };
}

function openPanel(on) {
  const panel = $el('tt-panel');
  if (!panel) return;
  panel.hidden = !on;
  saveUiState({ open: !!on });
}

function activateTab(id) {
  activeToolId = id;
  for (const t of tools) {
    const tab = $el(`tt-tab-${t.id}`);
    const pane = $el(`tt-pane-${t.id}`);
    if (tab) tab.classList.toggle('tt-tab-active', t.id === id);
    if (pane) pane.hidden = t.id !== id;
  }
  saveUiState({ tab: id });
}

export function activeTool() { return toolById(activeToolId); }

// בונה את הכפתור הצף והחלונית לדף הנוכחי. מחזיר את רשימת הכלים שנטענו (ריק = אין מה להציג).
export function mountPanel(page) {
  if (typeof document === 'undefined' || !document.body) return [];
  if ($el('tt-panel')) return []; // מופע אחר כבר מנהל את הדף
  const list = toolsForPage(page.kind);
  if (!list.length) return [];
  ensureStyle();

  const state = loadUiState();
  const pending = list.find((t) => { try { return t.hasPendingRun && t.hasPendingRun(); } catch (e) { return false; } });
  const initialTab = (pending && pending.id) || (list.some((t) => t.id === state.tab) ? state.tab : list[0].id);
  const initiallyOpen = pending ? true : state.open !== false;

  const fab = document.createElement('button');
  fab.id = 'tt-fab';
  fab.type = 'button';
  fab.title = 'כלי תלמו"ד';
  fab.innerHTML = '🎓<span class="tt-badge">רץ</span>';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'tt-panel';
  panel.hidden = !initiallyOpen;
  panel.innerHTML = `
    <div class="tt-head" id="tt-head">
      <span class="tt-title">כלי תלמו"ד</span>
      <span class="tt-ver">גרסה ${esc(PANEL_VERSION)}</span>
      <button type="button" class="tt-x" id="tt-close" title="סגור (הכפתור הצף פותח שוב)">×</button>
    </div>
    <div class="tt-tabs" id="tt-tabs">
      ${list.map((t) => `<button type="button" class="tt-tab" id="tt-tab-${esc(t.id)}">${esc(t.title)}<span class="tt-dot" hidden></span></button>`).join('')}
    </div>
    <div class="tt-body">
      ${list.map((t) => `<div id="tt-pane-${esc(t.id)}" hidden>
        <div class="tt-toolbar"><div class="tt-status" id="tt-${esc(t.id)}-status">מוכן</div><div class="tt-progress" id="tt-${esc(t.id)}-progress"></div></div>
        <div id="tt-${esc(t.id)}-root"></div>
      </div>`).join('')}
      ${logSectionHtml('tt-log')}
    </div>`;
  document.body.appendChild(panel);

  fab.addEventListener('click', () => openPanel(panel.hidden));
  $el('tt-close').addEventListener('click', () => openPanel(false));
  for (const t of list) $el(`tt-tab-${t.id}`).addEventListener('click', () => activateTab(t.id));

  // גרירה בכותרת
  let drag = null;
  $el('tt-head').addEventListener('mousedown', (e) => {
    if (e.target.id === 'tt-close') return;
    drag = { sx: e.clientX - panel.offsetLeft, sy: e.clientY - panel.offsetTop };
    panel.style.right = 'auto';
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    panel.style.left = (e.clientX - drag.sx) + 'px';
    panel.style.top = (e.clientY - drag.sy) + 'px';
  });
  document.addEventListener('mouseup', () => { drag = null; });

  // Escape → עצור בלשונית הפעילה (רק כשהיא רצה)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const t = activeTool();
    let running = false;
    try { running = !!(t && t.isRunning && t.isRunning()); } catch (err) { running = false; }
    if (!t || !running || typeof t.onStop !== 'function') return;
    e.preventDefault();
    t.onStop();
  }, true);

  bindLogSection('tt-log');
  activateTab(initialTab);

  for (const t of list) {
    try {
      t.mount($el(`tt-${t.id}-root`), makeUi(t), page);
    } catch (e) {
      log(`[ממשק] הלשונית "${t.title}" לא נטענה: ${e && e.message}`);
      const root = $el(`tt-${t.id}-root`);
      if (root) root.innerHTML = `<div class="tt-box tt-box-error">הלשונית לא נטענה: ${esc(e && e.message)}</div>`;
    }
  }
  if (pending) openPanel(true);
  return list;
}
