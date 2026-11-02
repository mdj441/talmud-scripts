// טבלת-הזנה משותפת לקליטה ולעזיבה (סבב 3 של שכבת-הבהירות, 1.11.2026): שורה לכל תלמיד, תאים לפי הגדרת-עמודות,
// הדבקה מהלוח ("הדבק מאקסל" קורא ישר מהלוח; תיבה קטנה רק אם הלוח נחסם), הדבקה בתא (Ctrl+V), תגיות-מצב שמסננות
// (הכל / מוכנות / אזהרות / לא ירוצו), מיון בלחיצה על כותרת, הודעה מתחת לכל שורה (אדום = לא ירוץ, צהוב = אזהרה),
// ומצב "תיקון" (בלי שורה ריקה, בלי הדבקה, עם "מה קרה / מה לעשות" מתחת לכל שורה). האימות עצמו מגיע מהכלי (validate).
// אין גישה ל-document ברמת המודול.

import { $el } from '../core/dom.js';
import { esc, buttonHtml, tagHtml, dateFieldHtml } from './widgets.js';

export const GRID_FILTERS = ['all', 'ready', 'warn', 'bad'];

// טהורה: האם שורה מסומנת-למסנן. level: '' | 'warn' | 'bad'.
export function gridRowMatchesFilter(filter, level, blank) {
  if (filter === 'all') return true;
  if (blank) return false;
  if (filter === 'bad') return level === 'bad';
  if (filter === 'warn') return level === 'warn';
  return level === '';
}

// טהורה: השוואה למיון (מספרים כמספרים, אחרת לפי אלף-בית עברי); ריק תמיד בסוף.
export function gridCompare(a, b) {
  const sa = String(a == null ? '' : a).trim();
  const sb = String(b == null ? '' : b).trim();
  if (!sa && !sb) return 0;
  if (!sa) return 1;
  if (!sb) return -1;
  if (/^\d+$/.test(sa) && /^\d+$/.test(sb)) return Number(sa) - Number(sb);
  return sa.localeCompare(sb, 'he');
}

// טהורה: ממיינת מערך-שורות לפי ערך (מחזירה מערך חדש; יציב).
export function gridSortRows(rows, valueOf, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  return rows.map((r, i) => ({ r, i })).sort((x, y) => (sign * gridCompare(valueOf(x.r), valueOf(y.r))) || (x.i - y.i)).map((x) => x.r);
}

// cfg: { id, inputId, columns, fieldKeys, newRow(), fromText(text) → rows, validate(filledRows) → {issues, counts, tasks},
//        rowActions?(row, i) → html, subRowHtml?(row, i) → html, subOpen?(row) → bool, onChange(v), onStatus(msg),
//        emptyText(mode) → string, allowDelete? }
// עמודה: { key, label, kind: 'input'|'select'|'date', width, mono, placeholder(f,row)|string, options(f,row) → [[v,l]],
//          value?(f,row) → ערך להצגה (למשל ניחוש), list (datalist id), off?(f,row), need?(f,row), sortable (ברירת-מחדל true) }
export function createGrid(cfg) {
  const id = cfg.id;
  const columns = cfg.columns;
  const st = { rows: [], mode: 'prep', filter: 'all', sort: null, v: null, notes: null, bound: false };

  function isBlank(row) { return (cfg.fieldKeys || columns.map((c) => c.key)).every((k) => !String((row.fields || {})[k] || '').trim()); }
  function filled() { return st.rows.filter((r) => !isBlank(r)); }

  function cellHtml(col, i, row) {
    const f = row.fields;
    const ph = typeof col.placeholder === 'function' ? col.placeholder(f, row) : (col.placeholder || '');
    const off = col.off ? !!col.off(f, row) : false;
    const style = col.width ? ` style="width:${col.width}"` : '';
    let inner;
    if (col.kind === 'select') {
      const opts = (col.options ? col.options(f, row) : []).slice();
      const value = col.value ? col.value(f, row) : String(f[col.key] || '');
      if (value !== '' && !opts.some(([v]) => v === value)) opts.push([value, value]);
      inner = `<select class="tt-select" data-i="${i}" data-k="${col.key}"${style}>${opts.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    } else if (col.kind === 'date') {
      inner = dateFieldHtml({ attrs: `data-i="${i}" data-k="${col.key}"`, value: f[col.key] || '', placeholder: ph, width: col.width, cal: `${i}:${col.key}` });
    } else {
      inner = `<input type="text" class="tt-input${col.mono ? ' tt-mono' : ''}" data-i="${i}" data-k="${col.key}" value="${esc(f[col.key] || '')}"${col.list ? ` list="${col.list}"` : ''} placeholder="${esc(ph)}"${style} autocomplete="off">`;
    }
    return `<td class="tt-cell tt-cell-${col.key}${off ? ' tt-cell-off' : ''}">${inner}</td>`;
  }

  function rowHtml(i, row) {
    const blank = isBlank(row);
    const span = columns.length + 3;
    const sub = cfg.subRowHtml ? cfg.subRowHtml(row, i) : '';
    const open = !blank && cfg.subOpen ? !!cfg.subOpen(row) : false;
    return `<tr class="tt-r-main" data-i="${i}">
      <td class="tt-rownum">${blank ? '' : i + 1}</td>
      ${columns.map((c) => cellHtml(c, i, row)).join('')}
      <td class="tt-cell-actions">${blank || !cfg.rowActions ? '' : cfg.rowActions(row, i)}</td>
      <td class="tt-cell-del">${blank || cfg.allowDelete === false ? '' : `<button type="button" class="tt-btn tt-btn-subtle tt-btn-sm" data-del="${i}" title="הסר שורה">×</button>`}</td>
    </tr>
    ${sub ? `<tr class="tt-sub" data-sub="${i}"${open ? '' : ' hidden'}><td colspan="${span}">${sub}</td></tr>` : ''}
    <tr class="tt-rowmsg" data-msg="${i}" hidden><td colspan="${span}"></td></tr>`;
  }

  function headHtml() {
    const th = (c) => {
      const sortable = c.sortable !== false;
      const arrow = st.sort && st.sort.key === c.key ? (st.sort.dir === 'desc' ? ' ▼' : ' ▲') : '';
      return `<th${sortable ? ` class="tt-th-sort" data-sort="${esc(c.key)}" title="מיון לפי ${esc(c.label)}"` : ''}>${esc(c.label)}${arrow}</th>`;
    };
    return `<tr><th style="width:22px"></th>${columns.map(th).join('')}<th>${esc(cfg.actionsLabel || '')}</th><th style="width:22px"></th></tr>`;
  }

  function render() {
    if (st.mode === 'prep' && (!st.rows.length || !isBlank(st.rows[st.rows.length - 1]))) st.rows.push(cfg.newRow());
    if (st.mode === 'fix') st.rows = st.rows.filter((r) => !isBlank(r));
    const el = $el(`${id}-grid`);
    if (!el) return null;
    el.innerHTML = `<table class="tt-grid-input"><thead>${headHtml()}</thead><tbody>${st.rows.map((r, i) => rowHtml(i, r)).join('')}</tbody></table>`;
    return refresh();
  }

  // אימות + סימון, בלי לבנות מחדש את השדות (הפוקוס נשאר)
  function refresh() {
    const list = filled();
    const v = cfg.validate(list);
    st.v = v;
    // ביקורת 2.11: כשהתגית הפעילה התרוקנה (תיקנו את כל האדומות) חוזרים ל"הכל", אחרת הטבלה נראית ריקה
    if (st.filter !== 'all' && !v.counts[st.filter]) st.filter = 'all';
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    let filledIdx = -1;
    st.rows.forEach((row, i) => {
      const tr = document.querySelector(`#${id}-grid tr.tt-r-main[data-i="${i}"]`);
      if (!tr) return;
      const sub = document.querySelector(`#${id}-grid tr.tt-sub[data-sub="${i}"]`);
      const msg = document.querySelector(`#${id}-grid tr.tt-rowmsg[data-msg="${i}"]`);
      const blank = isBlank(row);
      if (!blank) filledIdx++;
      const iss = blank ? null : v.issues[filledIdx];
      const level = iss ? iss.level : '';
      const note = !blank && st.notes ? st.notes(row) : null;
      const shownLevel = level || (note ? note.kind : '');
      for (const el of [tr, msg]) if (el) { el.classList.toggle('tt-r-bad', shownLevel === 'bad'); el.classList.toggle('tt-r-warn', shownLevel === 'warn'); }
      if (msg) {
        const parts = [];
        if (note && note.text) parts.push(`<span class="tt-note">${esc(note.text)}</span>`);
        if (iss && iss.msg) parts.push(`<span class="tt-note tt-note-${level}">${esc(iss.msg)}</span>`);
        msg.hidden = !parts.length;
        msg.firstElementChild.innerHTML = parts.join('<br>');
      }
      const num = tr.querySelector('.tt-rownum'); if (num) num.textContent = blank ? '' : String(i + 1);
      // שורה שמולאה ידנית (הייתה ריקה): תא-הפעולות וכפתור ההסרה נבנים עכשיו, בלי לבנות את כל הטבלה (סבב 5)
      const act = tr.querySelector('.tt-cell-actions');
      if (act && cfg.rowActions && (act.innerHTML.trim() !== '') !== !blank) act.innerHTML = blank ? '' : cfg.rowActions(row, i);
      const del = tr.querySelector('.tt-cell-del');
      if (del && cfg.allowDelete !== false && (del.innerHTML.trim() !== '') !== !blank) del.innerHTML = blank ? '' : `<button type="button" class="tt-btn tt-btn-subtle tt-btn-sm" data-del="${i}" title="הסר שורה">×</button>`;
      const f = row.fields;
      for (const col of columns) {
        const td = tr.querySelector(`.tt-cell-${col.key}`);
        if (!td) continue;
        if (col.off) td.classList.toggle('tt-cell-off', !!col.off(f, row));
        const inp = td.querySelector('input[data-k], select[data-k]');
        if (!inp) continue;
        if (col.kind === 'select' && col.value) { const want = col.value(f, row); if (inp.value !== want) inp.value = want; }
        if (col.kind !== 'select' && typeof col.placeholder === 'function') inp.placeholder = col.placeholder(f, row);
        if (col.need) inp.classList.toggle('tt-need', !blank && !!col.need(f, row));
      }
      if (sub) sub.hidden = blank || !(cfg.subOpen && cfg.subOpen(row));
      if (cfg.refreshRow) cfg.refreshRow(tr, sub, row, i);
      // 4.0.2: השדות שהודעת האתר מצביעה עליהם נצבעים: התא בשורה הראשית, השדה עצמו בשורת-הפרטים
      const flagged = note && Array.isArray(note.fields) ? note.fields : [];
      for (const scope of [tr, sub]) {
        if (!scope) continue;
        scope.querySelectorAll('[data-k]').forEach((el) => { (el.closest('td.tt-cell') || el).classList.toggle('tt-cell-flag', flagged.includes(el.dataset.k)); });
      }
      // השורה שעורכים עכשיו לא נעלמת באמצע ההקלדה כשהיא מפסיקה להתאים לתגית (ביקורת 2.11)
      const visible = gridRowMatchesFilter(st.filter, level, blank) || !!(active && tr.contains(active));
      tr.hidden = !visible;
      if (msg && !visible) msg.hidden = true;
      if (sub && !visible) sub.hidden = true;
    });
    renderTags(v);
    if (cfg.onChange) cfg.onChange(v);
    return v;
  }

  // התגיות מתעדכנות במקום: לחיצה אמיתית על תגית מורידה קודם את הפוקוס מהתא (change → refresh), ובנייה מחדש של
  // הכפתורים באמצע הלחיצה הייתה מפילה אותה.
  const TAGS = [['all', 'הכל', 'info'], ['ready', 'מוכנות', 'ok'], ['warn', 'אזהרות', 'warn'], ['bad', 'לא ירוצו', 'bad']];
  function renderTags(v) {
    const el = $el(`${id}-tags`);
    if (!el) return;
    const c = v.counts;
    if (!c.all) { el.innerHTML = `<span class="tt-hint">${esc(cfg.emptyText ? cfg.emptyText(st.mode) : '')}</span>`; return; }
    const buttons = Array.from(el.querySelectorAll('button[data-filter]'));
    if (buttons.length !== TAGS.length) {
      el.innerHTML = TAGS.map(([filter, label, kind]) => tagHtml({ label: `${label} ${c[filter]}`, kind, button: true, filter, active: st.filter === filter, disabled: filter !== 'all' && c[filter] === 0, title: filter === 'all' ? 'כל השורות' : 'הצג רק את השורות האלה' })).join('');
      return;
    }
    TAGS.forEach(([filter, label], i) => {
      const b = buttons[i];
      const text = `${label} ${c[filter]}`;
      if (b.textContent !== text) b.textContent = text;
      b.disabled = filter !== 'all' && c[filter] === 0;
      b.classList.toggle('tt-tag-active', st.filter === filter);
    });
  }

  // השורות המלאות שמוצגות עכשיו (לפי התגית): אלה שירוצו
  function visibleFilled() {
    if (st.filter === 'all' || !st.v) return filled();
    const list = filled();
    return list.filter((r, i) => gridRowMatchesFilter(st.filter, st.v.issues[i] ? st.v.issues[i].level : '', false));
  }

  function sortBy(key) {
    const col = columns.find((c) => c.key === key);
    if (!col) return;
    const dir = st.sort && st.sort.key === key && st.sort.dir === 'asc' ? 'desc' : 'asc';
    st.sort = { key, dir };
    const valueOf = (r) => (col.sortValue ? col.sortValue(r.fields, r) : r.fields[key]);
    const sorted = gridSortRows(filled(), valueOf, dir);
    st.rows = sorted;
    render();
  }

  function applyText(text, label) {
    const rows = cfg.fromText(text);
    // ביקורת 2.11: טקסט בלי שורות (תו בודד בתיבה, קובץ ריק, כותרת בלבד) לא מוחק את מה שכבר בטבלה
    if (!rows.length) { if (cfg.onStatus) cfg.onStatus('לא זוהו שורות. בכל שורה צריכים להיות סניף ומספר, מופרדים בטאב או בפסיק'); return false; }
    st.rows = rows;
    st.filter = 'all';
    st.sort = null;
    render();
    // סבב רטוב 1.11.2026: סופרים רק שורות ממולאות (הטבלה מוסיפה שורת-קלט ריקה; היומן אמר "3 שורות" על 2 תלמידים)
    if (cfg.onFilled) cfg.onFilled(label, rows.filter((r) => !isBlank(r)).length);
    return true;
  }

  function showPasteBox(msg) {
    const box = $el(`${id}-pastebox`);
    if (box) box.hidden = false;
    const m = $el(`${id}-pastemsg`);
    if (m) m.textContent = msg || '';
    const ta = $el(cfg.inputId);
    if (ta) { ta.value = ''; ta.focus(); }
  }
  function hidePasteBox() { const box = $el(`${id}-pastebox`); if (box) box.hidden = true; }

  // "הדבק מאקסל": קורא מהלוח; אם הדפדפן חוסם, תיבה קטנה עם הודעה (הכרעת סבב 3)
  async function pasteFromClipboard() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (e) { text = null; }
    if (text === null) { showPasteBox('הדפדפן לא נתן גישה ללוח. אשר את הגישה בסרגל הכתובת, או הדבק כאן (Ctrl+V):'); if (cfg.onStatus) cfg.onStatus('הדפדפן חסם את הקריאה מהלוח. הדבק בתיבה שנפתחה'); return false; }
    if (!String(text).trim()) { showPasteBox('הלוח ריק. העתק באקסל את השורות ולחץ שוב, או הדבק כאן (Ctrl+V):'); if (cfg.onStatus) cfg.onStatus('הלוח ריק. העתק באקסל ונסה שוב'); return false; }
    hidePasteBox();
    applyText(text, 'הדבקה מהלוח');
    return true;
  }

  function onCellInput(e) {
    const el = e.target;
    if (!el || el.dataset == null || el.dataset.k === undefined) return;
    const i = Number(el.dataset.i);
    const row = st.rows[i];
    if (!row) return;
    const k = el.dataset.k;
    if (cfg.onCell) cfg.onCell(row, k, el, e.type);
    row.fields[k] = el.value;
    if (st.mode === 'prep' && i === st.rows.length - 1 && !isBlank(row)) {
      st.rows.push(cfg.newRow());
      const tbody = document.querySelector(`#${id}-grid tbody`);
      if (tbody) tbody.insertAdjacentHTML('beforeend', rowHtml(st.rows.length - 1, st.rows[st.rows.length - 1]));
    }
    refresh();
  }

  function onClick(e) {
    const t = e.target;
    const del = t && t.closest ? t.closest('[data-del]') : null;
    if (del) { st.rows.splice(Number(del.getAttribute('data-del')), 1); render(); return; }
    const th = t && t.closest ? t.closest('th[data-sort]') : null;
    if (th) { sortBy(th.getAttribute('data-sort')); return; }
    if (cfg.onClick && cfg.onClick(e, st.rows) === true) { refresh(); }
  }

  function onPaste(e) {
    if (st.mode !== 'prep') return;
    const cd = e.clipboardData;
    const text = cd ? cd.getData('text/plain') : '';
    if (!text || !/[\t\r\n]/.test(text.trim())) return;
    const parsed = cfg.fromText(text);
    if (!parsed.length) return;
    e.preventDefault();
    const target = e.target && e.target.dataset ? Number(e.target.dataset.i) : NaN;
    if (st.rows.every(isBlank) || Number.isNaN(target)) st.rows = parsed;
    else st.rows.splice(target, parsed.length, ...parsed);
    st.filter = 'all';
    st.sort = null; // ביקורת 2.11: אחרת החץ בכותרת נשאר והשורות החדשות לא ממוינות
    render();
    if (cfg.onFilled) cfg.onFilled('הדבקה', parsed.length);
  }

  function onTagsClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-filter]') : null;
    if (!t) return;
    st.filter = t.getAttribute('data-filter') || 'all';
    refresh();
  }

  function bind() {
    if (st.bound) return;
    const grid = $el(`${id}-grid`);
    if (!grid) return;
    st.bound = true;
    grid.addEventListener('input', onCellInput);
    grid.addEventListener('change', onCellInput);
    grid.addEventListener('click', onClick);
    grid.addEventListener('paste', onPaste);
    const tags = $el(`${id}-tags`);
    if (tags) tags.addEventListener('click', onTagsClick);
    const ta = $el(cfg.inputId);
    // התיבה היא להדבקה בלבד: מגיבים רק לטקסט עם שורה שלמה (טאב או שורה חדשה), לא לכל תו שמוקלד (ביקורת 2.11)
    if (ta) ta.addEventListener('input', function () { const v = String(this.value); if (v.trim() && /[\t\r\n]/.test(v)) { if (applyText(v, 'הדבקה')) { hidePasteBox(); this.value = ''; } } });
  }

  // ה-HTML של תיבת-ההדבקה (מוסתרת כברירת-מחדל): הכלי מניח אותה היכן שהוא רוצה
  function pasteBoxHtml() {
    return `<div id="${id}-pastebox" class="tt-box tt-box-info" hidden><div id="${id}-pastemsg" class="tt-hint" style="margin-bottom:4px"></div>
      <textarea id="${esc(cfg.inputId)}" class="tt-textarea tt-textarea-sm" placeholder="הדבק כאן (Ctrl+V)"></textarea></div>`;
  }

  return {
    bind, render, refresh, sortBy, applyText, pasteFromClipboard, pasteBoxHtml, showPasteBox, hidePasteBox,
    filled, visibleFilled, isBlank,
    rows: () => st.rows,
    setRows(rows) { st.rows = rows; st.filter = 'all'; st.sort = null; },
    setMode(mode) { st.mode = mode; },
    mode: () => st.mode,
    setFilter(f) { st.filter = GRID_FILTERS.includes(f) ? f : 'all'; },
    filter: () => st.filter,
    setNotes(fn) { st.notes = fn; },
    validation: () => st.v,
  };
}
