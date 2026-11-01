// תאריכים בפורמט האתר (DD/MM/YYYY): מקור אחד לקליטה, לעזיבה ולחלונית (סקירה סופית 1.11.2026: שלושה עותקים
// זהים אוחדו לכאן; השמות הישנים נשארו כעטיפות דקות). טהור, בלי DOM.

export function dateTodayDMY() {
  const d = new Date();
  return [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('/');
}

// תאריך DD/MM/YYYY תקין: חודש 1 עד 12, יום לפי החודש, שנה 1900 עד 2200.
export function dateIsValidDMY(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return false;
  const d = Number(m[1]); const mo = Number(m[2]); const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || y < 1900 || y > 2200) return false;
  return d <= new Date(y, mo, 0).getDate();
}
