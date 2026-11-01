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

// סרגל-שלבים (שכבת-הבהירות 1.11.2026): "איפה אוחזים". labels = שמות השלבים; השלב הפעיל נקבע ב-setStep.
export function stepsHtml(id, labels) {
  return `<div class="tt-steps" id="${esc(id)}" aria-label="שלבים">${(labels || []).map((l, i) => `<div class="tt-step" data-step="${i}">${esc(l)}</div>`).join('')}</div>`;
}

// טהורה: אילו מחלקות מקבל כל שלב כשהשלב current פעיל (לפניו: done; הוא: on; אחריו: כלום).
export function stepClasses(count, current) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(i < current ? 'tt-step-done' : (i === current ? 'tt-step-on' : ''));
  return out;
}

export function setStep(id, current) {
  const el = $el(id);
  if (!el) return;
  const steps = Array.from(el.querySelectorAll('.tt-step'));
  const classes = stepClasses(steps.length, current);
  steps.forEach((s, i) => {
    s.classList.toggle('tt-step-done', classes[i] === 'tt-step-done');
    s.classList.toggle('tt-step-on', classes[i] === 'tt-step-on');
    if (classes[i] === 'tt-step-on') s.setAttribute('aria-current', 'step'); else s.removeAttribute('aria-current');
  });
}

// תגית-מצב (ספירה). kind: info | ok | warn | bad. ‏button=true → תגית לחיצה (סינון), עם data-filter.
export function tagHtml({ label, kind = 'info', id = '', button = false, filter = '', active = false, disabled = false, title = '' }) {
  const cls = `tt-tag tt-tag-${kind}${active ? ' tt-tag-active' : ''}`;
  if (button) return `<button type="button" class="${cls}"${id ? ` id="${esc(id)}"` : ''} data-filter="${esc(filter)}"${disabled ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;
  return `<span class="${cls}"${id ? ` id="${esc(id)}"` : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span>`;
}

// אזור ("הכנה" / "תוצאות"): כותרת, הערה קטנה, ותוכן. dim=true כשהאזור עוד לא רלוונטי.
export function zoneHtml({ id, title, note = '', inner = '', dim = false, hidden = false }) {
  return `<section class="tt-zone${dim ? ' tt-zone-dim' : ''}" id="${esc(id)}"${hidden ? ' hidden' : ''}>
    <div class="tt-zone-head"><b>${esc(title)}</b><span class="tt-zone-note" id="${esc(id)}-note">${esc(note)}</span></div>${inner}</section>`;
}

// שדה-תאריך (סבב 3): טקסט יום/חודש/שנה + כפתור לוח-שנה שפותח את הלוח של הדפדפן (שדה-תאריך מוסתר). attrs: תכונות
// נוספות לשדה-הטקסט (למשל data-i/data-k בטבלה); cal: מזהה הכפתור (data-cal). bindDateFields מחבר את הלוח לשדה.
export function dateFieldHtml({ id = '', attrs = '', value = '', placeholder = 'יום/חודש/שנה', width = '', cal = '', maxWidth = '' } = {}) {
  const style = width ? ` style="width:${width}"` : (maxWidth ? ` style="max-width:${maxWidth}"` : '');
  return `<span class="tt-date">
    <input type="text" class="tt-input tt-mono"${id ? ` id="${esc(id)}"` : ''} ${attrs} value="${esc(value)}" maxlength="10" placeholder="${esc(placeholder)}"${style} autocomplete="off">
    <input type="date" class="tt-date-native" tabindex="-1" aria-hidden="true">
    <button type="button" class="tt-date-btn" data-cal="${esc(cal || id)}" title="בחירה מלוח-שנה" aria-label="בחירה מלוח-שנה">📅</button>
  </span>`;
}

// טהורה: yyyy-mm-dd (שדה-התאריך של הדפדפן) → dd/mm/yyyy; dd/mm/yyyy → yyyy-mm-dd (לאתחול הלוח)
export function isoToDmy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
export function dmyToIso(dmy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dmy || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// מחבר את כפתורי לוח-השנה בתוך root (האצלה: עובד גם לשדות שנוספים אחר-כך)
export function bindDateFields(root) {
  if (!root || root.__ttDates) return;
  root.__ttDates = true;
  root.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.tt-date-btn') : null;
    if (!btn) return;
    const wrap = btn.closest('.tt-date');
    const text = wrap && wrap.querySelector('input[type="text"]');
    const native = wrap && wrap.querySelector('.tt-date-native');
    if (!native) return;
    native.value = dmyToIso(text ? text.value : '') || '';
    try { if (typeof native.showPicker === 'function') native.showPicker(); else native.click(); } catch (err) { try { native.click(); } catch (e2) { /* noop */ } }
  });
  root.addEventListener('change', (e) => {
    const native = e.target;
    if (!native || !native.classList || !native.classList.contains('tt-date-native')) return;
    const wrap = native.closest('.tt-date');
    const text = wrap && wrap.querySelector('input[type="text"]');
    const dmy = isoToDmy(native.value);
    if (!text || !dmy) return;
    text.value = dmy;
    text.dispatchEvent(new Event('input', { bubbles: true }));
    text.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// הכרעה ח2: תיבה קצרה כשהדף לא מתאים ללשונית, עם כפתור מעבר (אופציונלי).
export function fitBoxHtml({ id, text, buttonId = '', buttonLabel = '' }) {
  return `<div class="tt-box tt-box-info tt-fit" id="${esc(id)}">${esc(text)}${buttonId ? ` <div class="tt-row tt-row-wrap tt-row-tight">${buttonHtml({ id: buttonId, label: buttonLabel, kind: 'primary', size: 'small' })}</div>` : ''}</div>`;
}

// טבלת תוצאות. columns: [{key, label, mono?, center?, width?}]. classify(row) → 'ok' | 'warn' | 'bad' | ''
// ‏actionKey (שכבת-הבהירות): לשורה שאינה 'ok' עם ערך בשדה הזה נוספת שורת "מה לעשות" מתחתיה (tr.tt-act).
// שורות-התוצאה עצמן מסומנות data-row, כדי שקוראים (בדיקות) יספרו רק אותן.
export function resultsTableHtml({ columns, rows, classify, emptyText = '', actionKey = '', sortable = false }) {
  if (!rows || !rows.length) return emptyText ? `<div class="tt-empty">${esc(emptyText)}</div>` : '';
  const head = columns.map((c) => `<th${c.width ? ` style="width:${c.width}"` : ''}${sortable ? ` class="tt-th-sort" data-sort="${esc(c.key)}" title="מיון"` : ''}>${esc(c.label)}</th>`).join('');
  const body = rows.map((r, i) => {
    const cls = classify ? classify(r) : '';
    const cells = columns.map((c) => {
      const v = r[c.key];
      const classes = [c.mono ? 'tt-mono' : '', c.center ? 'tt-center' : '', c.key === 'status' ? 'tt-status-cell' : ''].filter(Boolean).join(' ');
      return `<td class="${classes}">${esc(v)}</td>`;
    }).join('');
    const title = r.detail ? ` title="${esc(r.detail)}"` : '';
    const action = actionKey && cls !== 'ok' && r[actionKey] ? `<tr class="tt-act tt-r-${cls || 'none'}"><td colspan="${columns.length}">${esc(r[actionKey])}</td></tr>` : '';
    return `<tr class="tt-r-${cls || 'none'}" data-row="${i}"${title}>${cells}</tr>${action}`;
  }).join('');
  return `<table class="tt-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// תיבת דוח "מה נשאר"
export function reportBoxHtml(report, { idsWarning = true } = {}) {
  if (!report) return '';
  let html = '';
  if (idsWarning) html += `<div class="tt-hint tt-hint-warn">הדוח מכיל מזהים מלאים. לא להדביק אותו בצ'אט או בדיווח-באג; ליומן יש "העתק יומן" ממוסך.</div>`;
  html += `<div class="tt-report-summary">סיכום: ${esc(report.summary || '-')}</div>`;
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

// כפתור שמוחק (הכרעת 2.11.2026): לחיצה ראשונה "דורכת" אותו (הנוסח הופך ל-"כן, X" והכפתור מאדים), לחיצה שנייה
// בתוך ms מבצעת; בלי לחיצה שנייה הוא חוזר לעצמו. target: מזהה או האלמנט עצמו (לבדיקות). מחזיר disarm().
export function bindConfirmClick(target, { label, confirmLabel, onConfirm, ms = 6000 }) {
  const el = typeof target === 'string' ? $el(target) : target;
  if (!el) return () => {};
  let timer = null;
  const disarm = () => { if (timer === null) return; clearTimeout(timer); timer = null; el.textContent = label; el.classList.remove('tt-btn-armed'); };
  el.addEventListener('click', () => {
    if (timer !== null) { disarm(); onConfirm(); return; }
    el.textContent = confirmLabel;
    el.classList.add('tt-btn-armed');
    timer = setTimeout(disarm, ms);
  });
  return disarm;
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
