import { COUNTRIES } from '../data/countries.js';

export function padId9(raw) {
  const s = String(raw).trim();
  return /^\d+$/.test(s) && s.length < 9 ? s.padStart(9, '0') : s;
}
// ספרת-ביקורת של ת.ז. ישראלית (שכבת-הבהירות 1.11.2026, הכרעה ד): אזהרה בלבד, לא חסימה. מקבל ספרות (עד 9,
// מרופדות באפסים). לא-ספרות או יותר מ-9 ספרות → false. עובד על הפרשי-המשקל 1,2,1,2,… וסכום ספרות-המכפלה.
export function isValidIsraeliId(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!/^\d{1,9}$/.test(s)) return false;
  const d = s.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = Number(d[i]) * (i % 2 === 0 ? 1 : 2);
    if (n > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}

// "ישראל" אינה ארץ-דרכון באתר; מספר ספרתי עם ארץ ישראל הוא ת.ז. (הכרעה 1ב, סבב 2).
export function isIsraelCountry(raw) {
  return /^(ישראל|israel)$/i.test(String(raw == null ? '' : raw).trim());
}

const PREFIX = /^(דרכון|passport|tz|ת\.?ז\.?)\s*[:=]\s*(.+)$/i;
export function detectIdType(raw) {
  const s = String(raw).trim();
  const m = s.match(PREFIX);
  if (m) {
    const kind = /דרכון|passport/i.test(m[1]) ? 'passport' : 'tz';
    const val = m[2].trim();
    return kind === 'passport'
      ? { type: 'passport', identifier: val.toUpperCase() }
      : { type: 'tz', identifier: padId9(val.replace(/\D/g, '')) };
  }
  if (/[a-zA-Z]/.test(s)) return { type: 'passport', identifier: s.toUpperCase() };
  return { type: 'tz', identifier: padId9(s.replace(/\D/g, '')) };
}

// מרכאות עוטפות: ASCII " ' · גרשיים ״ (U+05F4) · גרש ׳ (U+05F3) · מסולסלות “ ” ‘ ’ (U+201C U+201D U+2018 U+2019)
const WRAP_QUOTES = /^[\u0022\u0027\u05F4\u05F3\u201C\u201D\u2018\u2019]+|[\u0022\u0027\u05F4\u05F3\u201C\u201D\u2018\u2019]+$/g;

const byName = new Map(COUNTRIES.map(c => [c.he, c.value]));
// כינויים ושמות באנגלית, כמו בסקריפט הישן (קליטה v3.2, COUNTRY_MAP): הוחזרו 1.11.2026 אחרי השוואת ישן-חדש.
// מפתחות באותיות קטנות; הערכים הם קודי האתר (ddlCountryOfOrigine).
const COUNTRY_ALIASES = {
  'ארה"ב': '710', 'ארה״ב': '710', 'ארהב': '710', 'אמריקה': '710', 'usa': '710', 'us': '710', 'america': '710', 'united states': '710',
  'בלגיה': '620', 'belgium': '620',
  'אנגליה': '590', 'בריטניה': '590', 'uk': '590', 'england': '590', 'united kingdom': '590', 'britain': '590',
  'france': '640', 'canada': '700', 'australia': '860', 'argentina': '830',
  'south africa': '270', 'brazil': '810', 'mexico': '720',
  'שוויץ': '520', 'שווייץ': '520', 'switzerland': '520', 'swiss': '520',
  'netherlands': '610', 'holland': '610', 'germany': '500', 'italy': '670', 'spain': '660',
  'austria': '510', 'ukraine': '305', 'russia': '306', 'uzbekistan': '315',
  'morocco': '200', 'sweden': '560', 'finland': '550', 'denmark': '580',
  'norway': '570', 'iceland': '581', 'ireland': '600', 'new zealand': '870',
};
export function resolveCountry(input) {
  if (input == null) return null;
  const s = String(input)
    .trim()
    .replace(WRAP_QUOTES, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;
  if (byName.has(s)) return byName.get(s);
  const alias = COUNTRY_ALIASES[s.toLowerCase()];
  if (alias) return alias;
  // ‏B3: התאמת-קידומת מותרת רק כשהיא חד-משמעית. הגרסה הקודמת החזירה את ההתאמה
  // ה*ראשונה* וגם התאימה בכיוון ההפוך (s מתחיל בשם ארץ), ולכן "א" → 710 (ארצות
  // הברית) ו"ניגריה הצפונית" → 211 (ניגר): ערך אמיתי, ארץ שגויה, בלי שום סימן
  // (בדיקת קיום-האופציה במודאל לא יכולה לתפוס את זה). דורשים 3+ תווים, כיוון אחד
  // בלבד (שם הארץ מתחיל בקלט), ומועמד יחיד: אחרת null ("ארץ לא מוכרת" בפרסור).
  if (s.length < 3) return null;
  const hits = COUNTRIES.filter(c => c.he.startsWith(s));
  return hits.length === 1 ? hits[0].value : null;
}
