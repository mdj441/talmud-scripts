// השלד המאוחד: כפתור צף (הלוגו) + מגירה אחת, צמודה לשמאל כברירת-מחדל (ניתן להעביר לימין; הצד נזכר),
// עם לשוניות לכל הכלים. כל כלי נרשם עם registerTool({ id, title, pages, steps, mount, onStop, isRunning, hasPendingRun }).
// ‏mount(container, ui, page) מרנדר את הלשונית; ui = { status(msg), progress(cur,total), running(bool), step(i), open() }.
// Escape → onStop של הלשונית הפעילה (רק כשהיא רצה). אין גישה ל-document ברמת המודול.
//
// עיצוב (30.10.2026, שכבת-הבהירות 1.11.2026): כלי-עבודה שקט בתוך אתר ממשלתי כחול-אפור. משפחת-גופן אחת (של
// המערכת), צבע-הדגשה אחד (ירוק-טורקיז עמוק) לפעולה הראשית, ללשונית הפעילה, לשלב הנוכחי ולפס-ההתקדמות.
// מה שמושך את העין: סרגל-השלבים ושורת-המצב (איפה אוחזים), ואזורי "הכנה" / "תוצאות" המופרדים. כל השאר ממושמע.

import { $el } from '../core/dom.js';
import { log } from '../core/log.js';
import { esc, logSectionHtml, bindLogSection, stepsHtml, setStep } from './widgets.js';
import { LOGO_DATA_URI } from './logo.js';

export const PANEL_VERSION = '4.0';
export const PANEL_WARNING = 'הכלי לוחץ בשבילך באתר. כל פעולה היא באחריותך: בדוק את התוצאות באתר.';
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

// צד המגירה: 'left' (ברירת-המחדל: עץ-הסניפים של האתר יושב מימין) או 'right'. טהורה לבדיקה.
export function panelSide(state) {
  return state && state.side === 'right' ? 'right' : 'left';
}
export function otherSide(side) { return side === 'right' ? 'left' : 'right'; }
export function sideButtonLabel(side) { return side === 'right' ? 'לצד שמאל' : 'לצד ימין'; }

export const PANEL_CSS = `
#tt-panel,#tt-fab{
  --tt-ink:#1b2a33;--tt-ink-2:#4a5a66;--tt-muted:#7a8891;--tt-paper:#fbfaf7;--tt-field:#ffffff;--tt-line:#d9dfe3;--tt-line-2:#eceff2;
  --tt-accent:#0f6b5c;--tt-accent-2:#0b5447;--tt-accent-soft:#e3f0ec;
  --tt-ok:#1e6b45;--tt-ok-bg:#edf7f0;--tt-warn:#8a5a00;--tt-warn-bg:#fff6df;--tt-bad:#a2261a;--tt-bad-bg:#fcefed;--tt-info:#24455c;--tt-info-bg:#eef3f7;
  --tt-font:"Segoe UI","Arial Hebrew",Arial,sans-serif;
}
#tt-fab{position:fixed;bottom:22px;left:22px;z-index:99998;width:46px;height:46px;border-radius:50%;border:0;cursor:pointer;padding:0;
  background:var(--tt-ink);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 12px rgba(27,42,51,.3)}
#tt-fab.tt-side-right{left:auto;right:22px}
#tt-fab img{width:38px;height:38px;border-radius:50%;display:block}
#tt-fab:hover{background:#2b3f4b}
#tt-fab:focus-visible{outline:2px solid var(--tt-accent);outline-offset:3px}
#tt-fab .tt-badge{position:absolute;inset:-4px;border-radius:50%;border:2px solid var(--tt-accent);display:none;pointer-events:none}
#tt-fab.tt-running .tt-badge{display:block;animation:tt-pulse 1.6s ease-in-out infinite}
@keyframes tt-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(1.12)}}
@media (prefers-reduced-motion:reduce){#tt-fab.tt-running .tt-badge{animation:none}}

#tt-panel{position:fixed;top:0;left:0;bottom:0;z-index:99999;width:690px;max-width:100vw;display:flex;flex-direction:column;
  background:var(--tt-paper);color:var(--tt-ink);border-right:1px solid var(--tt-line);box-shadow:10px 0 30px rgba(27,42,51,.14);
  font:13px/1.5 var(--tt-font);direction:rtl;font-variant-numeric:tabular-nums}
#tt-panel.tt-side-right{left:auto;right:0;border-right:0;border-left:1px solid var(--tt-line);box-shadow:-10px 0 30px rgba(27,42,51,.14)}
#tt-panel.tt-panel-wide{width:820px}
#tt-panel[hidden]{display:none}
#tt-panel *{box-sizing:border-box}
#tt-panel :focus-visible{outline:2px solid var(--tt-accent);outline-offset:1px}

.tt-head{display:flex;align-items:center;gap:10px;padding:10px 16px 6px;user-select:none}
.tt-head .tt-logo{width:28px;height:28px;border-radius:50%;display:block;flex:none}
.tt-head .tt-title{font-weight:700;font-size:16px;flex:1;letter-spacing:-.01em}
.tt-head .tt-ver{font-size:11px;color:var(--tt-muted)}
.tt-head .tt-side{border:1px solid var(--tt-line);background:var(--tt-field);color:var(--tt-ink-2);border-radius:6px;font:inherit;font-size:12px;padding:3px 8px;cursor:pointer}
.tt-head .tt-side:hover{border-color:#b9c3ca;color:var(--tt-ink)}
.tt-head .tt-x{background:transparent;border:0;color:var(--tt-ink-2);font:400 20px/1 var(--tt-font);cursor:pointer;padding:0 2px}
.tt-head .tt-x:hover{color:var(--tt-ink)}
.tt-warnline{margin:0 16px 8px;padding:5px 10px;border-radius:6px;background:var(--tt-warn-bg);border:1px solid #ead9a8;color:#4f3600;font-size:12px}

.tt-tabs{display:flex;gap:18px;padding:0 16px;border-bottom:1px solid var(--tt-line)}
.tt-tab{border:0;background:transparent;padding:7px 0 9px;cursor:pointer;font:inherit;font-size:13px;color:var(--tt-ink-2);
  border-bottom:2px solid transparent;margin-bottom:-1px}
.tt-tab:hover{color:var(--tt-ink)}
.tt-tab.tt-tab-active{color:var(--tt-ink);font-weight:600;border-bottom-color:var(--tt-accent)}
.tt-tab .tt-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--tt-accent);margin-inline-start:6px;vertical-align:middle}
.tt-tab .tt-dot[hidden]{display:none}

.tt-body{padding:0 16px 18px;overflow:auto;flex:1}
.tt-strip{position:sticky;top:0;z-index:2;background:var(--tt-paper);margin:0 -16px 10px;padding:8px 16px 0}
.tt-steps{display:flex;margin:0 0 6px;counter-reset:tt-s}
.tt-step{flex:1;position:relative;text-align:center;font-size:12px;color:var(--tt-muted);padding:2px 0 0}
.tt-step::before{counter-increment:tt-s;content:counter(tt-s);position:relative;z-index:1;display:block;width:20px;height:20px;line-height:18px;border-radius:50%;
  border:1px solid var(--tt-line);background:var(--tt-field);margin:0 auto 2px;font-weight:600;font-size:11px}
.tt-step::after{content:"";position:absolute;top:10px;right:50%;width:100%;height:1px;background:var(--tt-line)}
.tt-step:first-child::after{display:none}
.tt-step-on{color:var(--tt-accent);font-weight:700}
.tt-step-on::before{background:var(--tt-accent);border-color:var(--tt-accent);color:#fff}
.tt-step-done{color:var(--tt-ink-2)}
.tt-step-done::before{content:"✓";background:var(--tt-accent-soft);border-color:var(--tt-accent);color:var(--tt-accent)}
.tt-strip-row{display:flex;align-items:baseline;gap:12px;min-height:22px}
.tt-status{flex:1;font-size:13px;color:var(--tt-ink)}
.tt-progress{font-size:12px;color:var(--tt-muted);white-space:nowrap}
.tt-bar{height:2px;background:var(--tt-line-2);margin-top:6px;overflow:hidden}
.tt-bar i{display:block;height:100%;width:100%;background:var(--tt-accent);transform:scaleX(0);transform-origin:right;transition:transform .25s ease}
@media (prefers-reduced-motion:reduce){.tt-bar i{transition:none}}

.tt-zone{border:1px solid var(--tt-line);border-radius:8px;background:var(--tt-field);margin:8px 0;padding:8px 12px 10px}
.tt-zone-dim{opacity:.55}
.tt-zone-head{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.tt-zone-head b{font-size:13.5px}
.tt-zone-head .tt-zone-note{font-size:12px;color:var(--tt-muted);flex:1}
.tt-zone-lead{font-size:12.5px;color:var(--tt-ink-2);margin:0 0 6px}
.tt-fit{margin:10px 0}

.tt-row{display:flex;gap:8px;margin:8px 0;flex-wrap:wrap;align-items:center}
.tt-row-tight{margin:4px 0 2px}
.tt-row-between{justify-content:space-between}
.tt-row > .tt-btn{flex:1 1 auto}
.tt-row-wrap > .tt-btn{flex:0 1 auto}
.tt-btn{border:1px solid var(--tt-line);background:var(--tt-field);color:var(--tt-ink);padding:7px 12px;border-radius:6px;cursor:pointer;font:inherit;font-size:13px}
.tt-btn:hover{border-color:#b9c3ca;background:#f6f7f8}
.tt-btn:disabled{opacity:.45;cursor:default}
.tt-btn-primary{background:var(--tt-accent);border-color:var(--tt-accent);color:#fff;font-weight:600}
.tt-btn-primary:hover{background:var(--tt-accent-2);border-color:var(--tt-accent-2)}
.tt-btn-danger{background:var(--tt-field);border-color:var(--tt-bad);color:var(--tt-bad);font-weight:600}
.tt-btn-danger:hover{background:var(--tt-bad-bg)}
.tt-btn-ghost{background:var(--tt-field)}
.tt-btn-subtle{background:transparent;border-color:transparent;color:var(--tt-accent);text-decoration:underline;text-underline-offset:3px;text-decoration-color:rgba(15,107,92,.35)}
.tt-btn-subtle:hover{background:var(--tt-accent-soft);border-color:transparent;text-decoration-color:var(--tt-accent)}
.tt-btn-sm{padding:3px 8px;font-size:12px}
.tt-btn[hidden]{display:none}
.tt-btn.tt-btn-armed{color:var(--tt-bad);border-color:var(--tt-bad);text-decoration-color:var(--tt-bad);font-weight:600}
.tt-btn-stop{background:var(--tt-bad);border-color:var(--tt-bad);color:#fff;font-weight:700;font-size:14px;padding:9px 22px}
.tt-btn-stop:hover{background:#86190f;border-color:#86190f}
.tt-runline{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid #efc3bb;border-radius:8px;background:#fff;margin:8px 0}
.tt-runline[hidden]{display:none}
.tt-runline .tt-runtext{flex:1;font-weight:600}
.tt-cell-off .tt-date-btn{visibility:hidden}
.tt-date{display:inline-flex;align-items:center;gap:2px;position:relative}
.tt-date .tt-date-native{position:absolute;inset-inline-start:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;padding:0;margin:0}
.tt-date .tt-date-btn{border:1px solid var(--tt-line);background:var(--tt-field);border-radius:6px;padding:2px 5px;cursor:pointer;font-size:13px;line-height:1}
.tt-date .tt-date-btn:hover{border-color:#b9c3ca;background:#f6f7f8}
.tt-grid-input .tt-date .tt-date-btn{padding:2px 4px;font-size:12px}
th.tt-th-sort{cursor:pointer;user-select:none}
th.tt-th-sort:hover{color:var(--tt-ink)}
.tt-note{display:inline-block}
.tt-note-bad{color:var(--tt-bad)}
.tt-note-warn{color:var(--tt-warn)}

.tt-field{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--tt-ink-2);flex:1}
.tt-field-label{font-weight:600}
.tt-hint{font-size:12px;color:var(--tt-muted)}
.tt-hint-warn{color:var(--tt-warn)}
.tt-legend{font-size:11.5px;color:var(--tt-muted)}
.tt-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-inline-end:4px;vertical-align:-1px}
.tt-input,.tt-select,.tt-textarea{border:1px solid var(--tt-line);border-radius:6px;padding:6px 8px;font:inherit;font-size:13px;background:var(--tt-field);color:var(--tt-ink);width:100%}
.tt-input:focus,.tt-select:focus,.tt-textarea:focus{outline:2px solid var(--tt-accent);outline-offset:0;border-color:var(--tt-accent)}
.tt-input::placeholder,.tt-textarea::placeholder{color:#a3adb4}
.tt-textarea{min-height:88px;resize:vertical;direction:ltr;text-align:left;font-size:12.5px}
.tt-textarea-sm{min-height:60px}
.tt-mono{direction:ltr;text-align:left;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.tt-center{text-align:center}
.tt-check{display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer}
.tt-check input{margin:0}

.tt-box{border:1px solid var(--tt-line);background:var(--tt-field);padding:8px 12px;margin:8px 0;font-size:12.5px;border-radius:6px}
.tt-box-warn{background:var(--tt-warn-bg);border-color:#ead9a8;color:#4f3600}
.tt-box-error{background:var(--tt-bad-bg);border-color:#efc3bb;color:#6b1911}
.tt-box-info{background:var(--tt-info-bg);border-color:#cfdbe4;color:var(--tt-info)}
.tt-box ul,.tt-box ol{margin:4px 0 0;padding-inline-start:18px}
.tt-section{margin:8px 0;border-top:1px solid var(--tt-line-2);padding:4px 0 2px}
.tt-section summary{cursor:pointer;font-size:12px;color:var(--tt-ink-2);user-select:none;padding:4px 0}
.tt-section summary:hover{color:var(--tt-ink)}
.tt-section[open] summary{margin-bottom:4px}

.tt-tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0}
.tt-tag{display:inline-block;border-radius:12px;padding:0 9px;font-size:12px;font-weight:600;line-height:20px;border:1px solid transparent;font-family:inherit}
.tt-tag-info{background:var(--tt-info-bg);color:var(--tt-info)}
.tt-tag-ok{background:var(--tt-ok-bg);color:var(--tt-ok)}
.tt-tag-warn{background:var(--tt-warn-bg);color:var(--tt-warn)}
.tt-tag-bad{background:var(--tt-bad-bg);color:var(--tt-bad)}
.tt-tag-done{background:var(--tt-warn-bg);color:var(--tt-warn)}
.tt-tag-count{background:var(--tt-info-bg);color:var(--tt-info)}
button.tt-tag{cursor:pointer}
button.tt-tag:hover{border-color:currentColor}
button.tt-tag.tt-tag-active{border-color:currentColor;box-shadow:inset 0 0 0 1px currentColor}
button.tt-tag:disabled{opacity:.5;cursor:default}
.tt-tags .tt-tags-spacer{flex:1}

.tt-table{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0;background:var(--tt-field)}
.tt-table th{color:var(--tt-ink-2);font-weight:600;padding:6px 8px;text-align:right;border-bottom:1px solid var(--tt-line);position:sticky;top:0;background:var(--tt-field)}
.tt-table td{padding:5px 8px;border-bottom:1px solid var(--tt-line-2);vertical-align:middle}
.tt-table td.tt-status-cell{font-weight:600;white-space:nowrap}
.tt-table td.tt-status-cell::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;margin-inline-end:6px;background:var(--tt-line);vertical-align:1px}
.tt-table tr.tt-r-ok td.tt-status-cell{color:var(--tt-ok)}.tt-table tr.tt-r-ok td.tt-status-cell::before{background:var(--tt-ok)}
.tt-table tr.tt-r-warn td.tt-status-cell{color:var(--tt-warn)}.tt-table tr.tt-r-warn td.tt-status-cell::before{background:var(--tt-warn)}
.tt-table tr.tt-r-bad td.tt-status-cell{color:var(--tt-bad)}.tt-table tr.tt-r-bad td.tt-status-cell::before{background:var(--tt-bad)}
.tt-table tr.tt-r-bad td,.tt-table tr.tt-r-warn td{border-bottom-color:transparent}
.tt-table tr.tt-act td{padding:0 8px 7px 24px;font-size:12px;color:var(--tt-ink-2);border-bottom:1px solid var(--tt-line-2);white-space:normal;line-height:1.45}
.tt-table tr.tt-act td::before{content:"←";color:var(--tt-muted);margin-inline-end:6px}
.tt-scroll{max-height:240px;overflow:auto;border:1px solid var(--tt-line);border-radius:6px;background:var(--tt-field)}
.tt-scroll-tall{max-height:340px}
.tt-empty{color:var(--tt-muted);font-size:12px;padding:6px}
.tt-report-summary{font-weight:600;margin:4px 0}
.tt-report-title{font-weight:600;margin-top:8px}
.tt-report-list{margin:4px 0 0;padding-inline-start:18px}
.tt-report-list li{margin-bottom:4px}
.tt-ok{color:var(--tt-ok)}
.tt-muted{color:var(--tt-muted);font-size:11px}
.tt-summary{font-size:12px;color:var(--tt-ink-2);margin:2px 0 4px;min-height:16px}

.tt-log-details{margin-top:14px;border-top:1px solid var(--tt-line-2);padding-top:6px}
.tt-log-details summary{cursor:pointer;font-size:12px;color:var(--tt-muted);user-select:none}
.tt-log-details summary:hover{color:var(--tt-ink-2)}
.tt-log{max-height:180px;overflow:auto;background:#1f2a31;color:#d8dee3;padding:8px 10px;border-radius:6px;font:11.5px/1.5 Consolas,"Courier New",monospace;white-space:pre-wrap;direction:ltr;text-align:left;margin:4px 0 0}

.tt-grid-input{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--tt-field)}
.tt-grid-input th{color:var(--tt-ink-2);font-weight:600;padding:6px 4px;text-align:right;border-bottom:1px solid var(--tt-line);white-space:nowrap;position:sticky;top:0;background:var(--tt-field);z-index:1}
.tt-grid-input td{padding:5px 2px;vertical-align:middle}
.tt-grid-input tr.tt-r-main td{border-top:1px solid var(--tt-line-2)}
.tt-grid-input tr.tt-r-main:first-child td{border-top:0}
.tt-grid-input .tt-input,.tt-grid-input .tt-select{padding:4px 6px;font-size:12.5px;min-width:0}
.tt-grid-input .tt-select{padding-inline-end:2px}
.tt-grid-input tr.tt-r-bad td{background:var(--tt-bad-bg)}
.tt-grid-input tr.tt-r-warn td{background:var(--tt-warn-bg)}
.tt-grid-input tr.tt-rowmsg td{padding:0 30px 6px 6px;font-size:11.5px;line-height:1.45;color:var(--tt-ink-2)}
.tt-grid-input tr.tt-rowmsg.tt-r-bad td{color:var(--tt-bad)}
.tt-grid-input tr.tt-rowmsg.tt-r-warn td{color:var(--tt-warn)}
.tt-grid-input tr.tt-sub td{background:#f4f7f6;padding:5px 24px 7px 6px;border-bottom:1px solid var(--tt-line-2)}
.tt-grid-input tr.tt-sub .tt-sub-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--tt-ink-2);max-width:540px}
.tt-grid-input tr.tt-sub .tt-sub-row .tt-input,.tt-grid-input tr.tt-sub .tt-sub-row .tt-select{width:auto}
.tt-grid-input tr[hidden]{display:none}
.tt-grid-input .tt-rownum{color:var(--tt-muted);font-size:11px;text-align:center;width:22px}
.tt-cell-off{background:#f4f5f6}
.tt-cell-off .tt-input{background:transparent;border-color:transparent}
.tt-input.tt-need{border-color:var(--tt-bad);background:#fff}
.tt-grid-input .tt-newbtn{white-space:nowrap}
.tt-grid-input .tt-newbtn.tt-newbtn-on{color:var(--tt-ok);text-decoration:none;font-weight:600}

.tt-review-tools .tt-filter{flex:2 1 160px;width:auto;direction:rtl}
.tt-review-tools > .tt-btn{flex:0 1 auto}
.tt-review-table td{white-space:nowrap}
.tt-review-table td.tt-body-cell{max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tt-ink-2)}
.tt-review-table .tt-select.tt-decision{padding:3px 4px;font-size:12px;width:auto;min-width:118px}
.tt-review-table tr.tt-r-done{background:var(--tt-warn-bg)}
.tt-review-table td.tt-roster-cell{font-size:11px;color:var(--tt-ink-2);white-space:normal;min-width:70px}

.tt-foot{padding:8px 16px;border-top:1px solid var(--tt-line);font-size:11px;color:var(--tt-muted);display:flex;gap:12px;align-items:center}
.tt-foot a{color:var(--tt-accent);text-decoration:none}
.tt-foot a:hover{text-decoration:underline}
.tt-foot .tt-kbd{border:1px solid var(--tt-line);border-radius:3px;padding:0 4px;font-size:10px;background:var(--tt-field)}
`;

function ensureStyle() {
  if ($el('tt-style')) return;
  const style = document.createElement('style');
  style.id = 'tt-style';
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

// הכרעה ח2 (1.11.2026): החלונית מופיעה בכל דף של האתר (חוץ מדף הכניסה, שמסונן ב-main). כלי עם pages:['*']
// מוצג תמיד; הלשונית עצמה אומרת אם הדף מתאים (fits) ומציעה לעבור. כלי עם רשימת דפים: לפי הדף, או עם תור פתוח.
function toolsForPage(page) {
  const pageKind = page && page.kind;
  return tools.filter((t) => {
    let fits = Array.isArray(t.pages) && (t.pages.includes('*') || t.pages.includes(pageKind));
    if (!fits && typeof t.matches === 'function') { try { fits = !!t.matches(page); } catch (e) { fits = false; } }
    let pending = false;
    try { pending = !!(t.hasPendingRun && t.hasPendingRun()); } catch (e) { pending = false; }
    return fits || pending;
  });
}

function toolById(id) { return tools.find((t) => t.id === id) || null; }

// הלשונית הראשונה שנפתחת: תור פתוח גובר; אחרת הלשונית שנזכרה אם היא מתאימה לדף (fits); אחרת הראשונה שמתאימה;
// אחרת הנזכרה; אחרת הראשונה. טהורה לבדיקה.
export function initialTabFor(list, page, savedId) {
  const fits = (t) => { try { return typeof t.fits === 'function' ? !!t.fits(page) : true; } catch (e) { return false; } };
  const saved = list.find((t) => t.id === savedId);
  if (saved && fits(saved)) return saved.id;
  const fitting = list.find(fits);
  if (fitting) return fitting.id;
  return saved ? saved.id : list[0].id;
}

function makeUi(tool) {
  return {
    status(msg) { const el = $el(`tt-${tool.id}-status`); if (el) el.textContent = msg == null ? '' : String(msg); },
    progress(cur, total) {
      const el = $el(`tt-${tool.id}-progress`);
      if (el) el.textContent = total ? `${cur} מתוך ${total}` : '';
      const bar = $el(`tt-${tool.id}-bar`);
      if (bar) bar.style.transform = `scaleX(${total ? Math.max(0, Math.min(1, cur / total)) : 0})`;
    },
    running(on) {
      const fab = $el('tt-fab');
      if (fab) fab.classList.toggle('tt-running', !!on);
      const tab = $el(`tt-tab-${tool.id}`);
      if (tab) { const dot = tab.querySelector('.tt-dot'); if (dot) dot.hidden = !on; }
    },
    // סרגל-השלבים של הלשונית: i = השלב הנוכחי (0-based); כל מה שלפניו מסומן ✓
    step(i) { setStep(`tt-${tool.id}-steps`, i); },
    open() { openPanel(true); activateTab(tool.id); },
  };
}

function openPanel(on) {
  const panel = $el('tt-panel');
  if (!panel) return;
  panel.hidden = !on;
  const fab = $el('tt-fab');
  if (fab) fab.title = on ? 'סגור את כלי תלמו"ד' : 'פתח את כלי תלמו"ד';
  saveUiState({ open: !!on });
}

function applySide(side) {
  const panel = $el('tt-panel');
  const fab = $el('tt-fab');
  if (panel) panel.classList.toggle('tt-side-right', side === 'right');
  if (fab) fab.classList.toggle('tt-side-right', side === 'right');
  const btn = $el('tt-side');
  if (btn) { btn.textContent = sideButtonLabel(side); btn.title = side === 'right' ? 'מעביר את החלונית לצד שמאל (נזכר)' : 'מעביר את החלונית לצד ימין (נזכר)'; }
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

// בונה את הכפתור הצף והמגירה לדף הנוכחי. מחזיר את רשימת הכלים שנטענו (ריק = אין מה להציג).
export function mountPanel(page) {
  if (typeof document === 'undefined' || !document.body) return [];
  if ($el('tt-panel')) return []; // מופע אחר כבר מנהל את הדף
  const list = toolsForPage(page);
  if (!list.length) return [];
  ensureStyle();

  const state = loadUiState();
  const side = panelSide(state);
  const pending = list.find((t) => { try { return t.hasPendingRun && t.hasPendingRun(); } catch (e) { return false; } });
  const initialTab = (pending && pending.id) || initialTabFor(list, page, state.tab);
  const initiallyOpen = pending ? true : state.open !== false;

  const fab = document.createElement('button');
  fab.id = 'tt-fab';
  fab.type = 'button';
  fab.title = initiallyOpen ? 'סגור את כלי תלמו"ד' : 'פתח את כלי תלמו"ד';
  fab.setAttribute('aria-label', 'כלי תלמו"ד');
  fab.innerHTML = `<img src="${LOGO_DATA_URI}" alt=""><span class="tt-badge"></span>`;
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'tt-panel';
  panel.hidden = !initiallyOpen;
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'כלי תלמו"ד');
  panel.innerHTML = `
    <div class="tt-head" id="tt-head">
      <img class="tt-logo" src="${LOGO_DATA_URI}" alt="">
      <span class="tt-title">כלי תלמו"ד</span>
      <span class="tt-ver">גרסה ${esc(PANEL_VERSION)}</span>
      <button type="button" class="tt-side" id="tt-side"></button>
      <button type="button" class="tt-x" id="tt-close" title="סגירה (הכפתור הצף פותח שוב)" aria-label="סגירה">×</button>
    </div>
    <div class="tt-warnline" id="tt-warnline">${esc(PANEL_WARNING)}</div>
    <div class="tt-tabs" id="tt-tabs" role="tablist">
      ${list.map((t) => `<button type="button" role="tab" class="tt-tab" id="tt-tab-${esc(t.id)}">${esc(t.title)}<span class="tt-dot" hidden></span></button>`).join('')}
    </div>
    <div class="tt-body">
      ${list.map((t) => `<div id="tt-pane-${esc(t.id)}" hidden>
        <div class="tt-strip">
          ${Array.isArray(t.steps) && t.steps.length ? stepsHtml(`tt-${esc(t.id)}-steps`, t.steps) : ''}
          <div class="tt-strip-row"><div class="tt-status" id="tt-${esc(t.id)}-status" aria-live="polite">מוכן</div><div class="tt-progress" id="tt-${esc(t.id)}-progress"></div></div>
          <div class="tt-bar"><i id="tt-${esc(t.id)}-bar"></i></div>
        </div>
        <div id="tt-${esc(t.id)}-root"></div>
      </div>`).join('')}
      ${logSectionHtml('tt-log')}
    </div>
    <div class="tt-foot">
      <span><span class="tt-kbd">Esc</span> עוצר את הריצה הפעילה</span>
      <a href="https://github.com/mdj441/talmud-scripts#readme" target="_blank" rel="noopener">הוראות</a>
      <a href="https://github.com/mdj441/talmud-scripts/issues" target="_blank" rel="noopener">דיווח על בעיה</a>
    </div>`;
  document.body.appendChild(panel);
  applySide(side);

  fab.addEventListener('click', () => openPanel(panel.hidden));
  $el('tt-close').addEventListener('click', () => openPanel(false));
  $el('tt-side').addEventListener('click', () => {
    const next = otherSide(panelSide(loadUiState()));
    saveUiState({ side: next });
    applySide(next);
  });
  for (const t of list) $el(`tt-tab-${t.id}`).addEventListener('click', () => activateTab(t.id));

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
