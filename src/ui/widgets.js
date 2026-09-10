// רכיבי-ממשק משותפים לכל הכלים: בוני HTML טהורים (נבדקים ב-Node) + קושרי-אירועים קטנים.
// כל המחלקות עם קידומת tt- (ה-CSS ב-panel.js). אין גישה ל-document ברמת המודול.

import { $el } from '../core/dom.js';
import { getLogText, setLogListener, copyLog, clearLog, log } from '../core/log.js';

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function todayDMY() {
  const d = new Date();
  return [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('/');
}

// כפתור. kind: primary | danger | ghost | subtle. size: normal | small
export function buttonHtml({ id, label, kind = 'ghost', size = 'normal', title = '', disabled = false, attrs = '' }) {
  return `<button type="button" id="${esc(id)}" class="tt-btn tt-btn-${kind}${size === 'small' ? ' tt-btn-sm' : ''}"${title ? ` title="${esc(title)}"` : ''}${disabled ? ' disabled' : ''} ${attrs}>${label}</button>`;
}

export function buttonsRowHtml(buttons, extraClass = '') {
  return `<div class="tt-row ${extraClass}">${buttons.map(buttonHtml).join('')}</div>`;
}

// שדה עם תווית מעל
export function fieldHtml(label, inner, hint = '') {
  return `<label class="tt-field"><span class="tt-field-label">${esc(label)}</span>${inner}${hint ? `<span class="tt-hint">${esc(hint)}</span>` : ''}</label>`;
}

export function selectHtml({ id, options, value = '', placeholder = '', cls = '' }) {
  const opts = (placeholder ? [`<option value="">${esc(placeholder)}</option>`] : [])
    .concat(options.map((o) => {
      const v = typeof o === 'string' ? o : o.value;
      const l = typeof o === 'string' ? o : (o.label == null ? o.value : o.label);
      return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`;
    }));
  return `<select id="${esc(id)}" class="tt-select ${cls}">${opts.join('')}</select>`;
}

// טבלת תוצאות. columns: [{key, label, mono?, center?, width?}]. classify(row) → 'ok' | 'warn' | 'bad' | ''
export function resultsTableHtml({ columns, rows, classify, emptyText = '' }) {
  if (!rows || !rows.length) return emptyText ? `<div class="tt-empty">${esc(emptyText)}</div>` : '';
  const head = columns.map((c) => `<th${c.width ? ` style="width:${c.width}"` : ''}>${esc(c.label)}</th>`).join('');
  const body = rows.map((r) => {
    const cls = classify ? classify(r) : '';
    const cells = columns.map((c) => {
      const v = r[c.key];
      const classes = [c.mono ? 'tt-mono' : '', c.center ? 'tt-center' : '', c.key === 'status' ? 'tt-status-cell' : ''].filter(Boolean).join(' ');
      return `<td class="${classes}">${esc(v)}</td>`;
    }).join('');
    const title = r.detail ? ` title="${esc(r.detail)}"` : '';
    return `<tr class="tt-r-${cls || 'none'}"${title}>${cells}</tr>`;
  }).join('');
  return `<table class="tt-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// תיבת דוח "מה נשאר"
export function reportBoxHtml(report, { idsWarning = true } = {}) {
  if (!report) return '';
  let html = '';
  if (idsWarning) html += `<div class="tt-hint tt-hint-warn">הדוח מכיל מזהים מלאים. לא להדביק אותו בצ'אט או בדיווח-באג; ליומן יש "העתק יומן" ממוסך.</div>`;
  html += `<div class="tt-report-summary">סיכום: ${esc(report.summary || '—')}</div>`;
  if (report.lines && report.lines.length) {
    html += `<div class="tt-report-title">מה נשאר לעשות</div><ol class="tt-report-list">${report.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
  } else {
    html += '<div class="tt-ok">הכול טופל. אין שורות שדורשות טיפול.</div>';
  }
  return html;
}

// היומן המשותף (אחד לכל הכלים)
export function logSectionHtml(id = 'tt-log') {
  return `<details class="tt-log-details" id="${id}-details">
    <summary>יומן פעילות (מזהים ממוסכים, בטוח לשליחה בדיווח)</summary>
    <div class="tt-row tt-row-tight">
      ${buttonHtml({ id: `${id}-copy`, label: 'העתק יומן', kind: 'subtle', size: 'small' })}
      ${buttonHtml({ id: `${id}-clear`, label: 'נקה יומן', kind: 'subtle', size: 'small' })}
    </div>
    <pre id="${id}" class="tt-log"></pre>
  </details>`;
}

export function bindLogSection(id = 'tt-log') {
  const render = () => {
    const el = $el(id);
    if (!el) return;
    el.textContent = getLogText();
    el.scrollTop = el.scrollHeight;
  };
  setLogListener(render);
  render();
  const copy = $el(`${id}-copy`);
  if (copy) copy.addEventListener('click', () => copyLog().then((ok) => flash(`${id}-copy`, ok ? 'הועתק' : 'ההעתקה נכשלה', 'העתק יומן')));
  const clear = $el(`${id}-clear`);
  if (clear) clear.addEventListener('click', () => { clearLog(); log('[יומן] נוקה'); });
}

export function flash(id, tempText, backText, ms = 1800) {
  const btn = $el(id);
  if (!btn) return;
  btn.textContent = tempText;
  setTimeout(() => { const b = $el(id); if (b) b.textContent = backText; }, ms);
}

export function setText(id, text) {
  const el = $el(id);
  if (el) el.textContent = text == null ? '' : String(text);
}

export function setHtml(id, html) {
  const el = $el(id);
  if (el) el.innerHTML = html;
}

export function show(id, on) {
  const el = $el(id);
  if (el) el.hidden = !on;
}

export function setDisabled(id, disabled) {
  const el = $el(id);
  if (el) el.disabled = !!disabled;
}

// מסכת תאריך DD/MM/YYYY בזמן הקלדה
export function bindDateMask(id) {
  const el = $el(id);
  if (!el) return;
  el.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '');
    if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    if (v.length > 5) v = v.slice(0, 5) + '/' + v.slice(5, 9);
    this.value = v;
  });
}
