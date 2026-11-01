// טעינת רשימת תלמידים מקובץ אקסל (.xlsx/.xls): ממיר את הגיליון לטקסט מופרד-טאבים
// שנכנס ל-parseAbsorbInput (src/tools/absorb-parse.js), כך שיש מסלול פרסור אחד לכל
// המקורות (הדבקה ידנית או קובץ אקסל). אין גישה ל-globalThis.XLSX ברמת המודול: רק
// בתוך גוף loadXlsxFile: כדי שהמודול הזה ייבא נקי גם ב-Node (בדיקות, בלי דפדפן/ספרייה).

function xlsxCellToString(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const day = String(v.getDate()).padStart(2, '0');
    const month = String(v.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${v.getFullYear()}`;
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

// ממיר מטריצת שורות (מ-XLSX.utils.sheet_to_json(ws,{header:1})) לטקסט טאבים\שורות.
// שומר תאים ריקים פנימיים (כדי שמיקום העמודות ישרוד), חותך תאים ריקים בסוף כל שורה,
// ומדלג על שורות שהתרוקנו לגמרי (שורות-זנב שאקסל נוטה להשאיר בסוף גיליון מפורמט).
export function sheetRowsToText(rows) {
  const lines = [];
  for (const row of rows || []) {
    const cells = (row || []).map(xlsxCellToString);
    let end = cells.length;
    while (end > 0 && cells[end - 1] === '') end--;
    const trimmed = cells.slice(0, end);
    if (trimmed.length === 0) continue;
    lines.push(trimmed.join('\t'));
  }
  return lines.join('\n');
}

// קורא קובץ אקסל שנבחר בדפדפן (File) ומחזיר טקסט טאבים של הגיליון הראשון.
// דורש שהספרייה הגלובלית XLSX (SheetJS, נטענת ב-@require מהכותרת) כבר נטענה.
export async function loadXlsxFile(file) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) {
    throw new Error('ספריית SheetJS (XLSX) לא נטענה: בדוק חיבור לאינטרנט ונסה שוב');
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheetName = wb && wb.SheetNames && wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : null;
  if (!ws) {
    throw new Error('לא נמצא גיליון בקובץ האקסל');
  }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  return sheetRowsToText(rows);
}
