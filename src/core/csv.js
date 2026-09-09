// ייצוא/העתקה — פורט מ"תלמוד - קליטת תלמידים" v3.2 (exportCSV:713, copyLog:735).
// toCsv טהורה (נבדקת ביחידה); downloadText/copyTextToClipboard נוגעות ב-DOM ולכן
// כל הגישה ל-document/window/navigator היא רק בתוך גופי הפונקציות (import תקין ב-Node).

// BOM כדי שאקסל יקרא עברית ב-UTF-8 (בלעדיו "×¢×‘×¨×™×ª").
const CSV_BOM = '﻿';
const CSV_EOL = '\r\n';

// טהורה: מערך-שורות של תאים → טקסט CSV. מצטט רק תאים שדורשים זאת (פסיק / מרכאות /
// שורה חדשה), ומכפיל מרכאות פנימיות — RFC 4180.
export function toCsv(rows) {
  if (!Array.isArray(rows)) return '';
  return rows.map((row) => (Array.isArray(row) ? row : [row]).map(csvCell).join(',')).join(CSV_EOL);
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// מוריד טקסט כקובץ (Blob + <a download>). לעולם לא זורק — מחזיר false בכישלון.
export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } }, 1000);
    return true;
  } catch (e) {
    return false;
  }
}

// CSV לאקסל: BOM + ציטוט תקני.
export function downloadCsv(filename, rows) {
  return downloadText(filename, CSV_BOM + toCsv(rows), 'text/csv;charset=utf-8');
}

// Promise<boolean> — לעולם לא נדחה. clipboard API ואם הוא חסום — textarea+execCommand.
export function copyTextToClipboard(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => csvCopyFallback(text));
    }
  } catch (e) { /* נופלים ל-fallback */ }
  return Promise.resolve(csvCopyFallback(text));
}

function csvCopyFallback(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) {
    return false;
  }
}
