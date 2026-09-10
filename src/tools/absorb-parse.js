import { detectIdType, resolveCountry } from '../core/identity.js';

// מרכאות עוטפות: ASCII " ' · גרשיים ״ (U+05F4) · גרש ׳ (U+05F3) · מסולסלות “ ” ‘ ’
const ABSORB_WRAP_QUOTES = /^["'״׳“”‘’]+|["'״׳“”‘’]+$/g;

const HEADER_ALIASES = {
  branch: ['סניף'],
  studyType: ['סוג לימוד', 'סוג'],
  identifier: ['ת.ז./דרכון', 'ת.ז.', 'תז', 'דרכון', 'מזהה'],
  birthDate: ['תאריך לידה', 'לידה'],
  country: ['ארץ', 'ארץ דרכון'],
  firstName: ['שם פרטי', 'שם'],
  lastName: ['שם משפחה', 'משפחה'],
  gender: ['מגדר'],
  familyStatus: ['מצב משפחתי', 'מצב'],
};
const FIELD_LABELS = { branch: 'סניף', studyType: 'סוג לימוד', identifier: 'מזהה' };
const FAMILY_STATUS_MAP = {
  'רווק': '10', 'רווקה': '10', 'נשוי': '20', 'נשואה': '20',
  'גרוש': '30', 'גרושה': '30', 'אלמן': '40', 'אלמנה': '40',
};
const DATE_PATTERNS = [
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: 'ymd' }, // ISO
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: 'dmy' },
  { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: 'dmy' },
  { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: 'dmy' },
];

const pad2 = (n) => String(n).padStart(2, '0');
const splitLines = (text) => String(text).split(/\r\n|\r|\n/);

function normalizeHeaderCell(s) {
  let t = String(s).trim().replace(/\s+/g, ' ').replace(ABSORB_WRAP_QUOTES, '');
  if (t.endsWith('.')) t = t.slice(0, -1);
  return t.toLowerCase();
}

const HEADER_LOOKUP = new Map();
for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
  for (const alias of aliases) HEADER_LOOKUP.set(normalizeHeaderCell(alias), field);
}

const isPurelyNumericCell = (cell) => /^\d+$/.test(String(cell ?? '').trim().replace(ABSORB_WRAP_QUOTES, ''));

function detectDelimiter(text) {
  if (text.includes('\t')) return 'tab';
  if (text.includes(',')) return 'comma';
  return 'whitespace';
}

function splitCells(line, delimiter) {
  let cells;
  if (delimiter === 'tab') cells = line.split('\t');
  else if (delimiter === 'comma') cells = line.split(',');
  else cells = line.trim().split(/\s+/).filter((c) => c !== '');
  return cells.map((c) => c.trim());
}

function buildColumnMap(headerCells) {
  const map = {};
  headerCells.forEach((cell, idx) => {
    const field = HEADER_LOOKUP.get(normalizeHeaderCell(cell));
    if (field && !(field in map)) map[field] = idx;
  });
  return map;
}

function normalizeDate(raw) {
  if (raw === undefined) return { value: undefined, error: null };
  const s = raw.trim();
  if (s === '') return { value: undefined, error: null };
  for (const { re, order } of DATE_PATTERNS) {
    const m = s.match(re);
    if (!m) continue;
    const [, a, b, c] = m;
    const [d, mo, y] = order === 'ymd' ? [c, b, a] : [a, b, c];
    return { value: `${pad2(d)}/${pad2(mo)}/${y}`, error: null };
  }
  return { value: undefined, error: `תאריך לא תקין: ${raw}` };
}

function mapGender(raw) {
  const s = raw.trim();
  if (s === '1' || s === '2') return { value: s, error: null };
  if (s === 'זכר') return { value: '1', error: null };
  if (s === 'נקבה') return { value: '2', error: null };
  return { value: undefined, error: `מגדר לא ידוע: ${raw}` };
}

function mapFamilyStatus(raw) {
  const s = raw.trim();
  if (['10', '20', '30', '40'].includes(s)) return { value: s, error: null };
  if (s in FAMILY_STATUS_MAP) return { value: FAMILY_STATUS_MAP[s], error: null };
  return { value: undefined, error: `מצב משפחתי לא ידוע: ${raw}` };
}

function rowToTask({ cells, lineNo, raw, columnMap }) {
  const err = (reason) => ({ error: { line: lineNo, text: raw, reason } });
  let branch, studyType, identity;
  let birthDateRaw, countryRaw, firstNameRaw, lastNameRaw, genderRaw, statusRaw;

  if (columnMap) {
    const get = (f) => (f in columnMap ? (cells[columnMap[f]] ?? '').trim() : undefined);
    branch = get('branch') ?? '';
    studyType = get('studyType') ?? '';
    identity = get('identifier') ?? '';
    birthDateRaw = get('birthDate');
    countryRaw = get('country');
    firstNameRaw = get('firstName');
    lastNameRaw = get('lastName');
    genderRaw = get('gender');
    statusRaw = get('familyStatus');
  } else {
    branch = (cells[0] ?? '').trim();
    studyType = (cells[1] ?? '').trim();
    identity = (cells[2] ?? '').trim();
  }

  if (!branch || !studyType || !identity) return err('חסרים שדות חובה: סניף/סוג לימוד/מזהה');
  if (!/^\d+$/.test(branch)) return err(`סניף לא מספרי: ${branch}`);
  if (!/^\d+$/.test(studyType)) return err(`סוג לימוד לא מספרי: ${studyType}`);

  const idInfo = detectIdType(identity);

  if (!columnMap) {
    // בלי שורת-כותרת: 3 תאים = בסיס; 4–5 תאים = הפורמט הישן לדרכון (תאריך לידה, ארץ);
    // 6+ תאים = סדר-התבנית (שם פרטי, שם משפחה, תאריך לידה, ארץ, מגדר, מצב משפחתי) —
    // כך העתקה מהתבנית של האקסל עובדת גם בלי הכותרת וגם עם תאים ריקים (W6).
    const rest = cells.slice(3).map((c) => (c ?? '').trim());
    const opt = (i) => (rest.length > i && rest[i] !== '' ? rest[i] : undefined);
    if (cells.length >= 6) {
      firstNameRaw = opt(0);
      lastNameRaw = opt(1);
      birthDateRaw = opt(2);
      countryRaw = opt(3);
      genderRaw = opt(4);
      statusRaw = opt(5);
    } else if (idInfo.type === 'passport') {
      birthDateRaw = opt(0);
      countryRaw = opt(1);
    } else if (cells.length === 4 || cells.length === 5) {
      return err('מספר עמודות לא צפוי (לת.ז. עם פרטי תלמיד חדש צריך גם שם פרטי, שם משפחה ותאריך לידה)');
    }
  }

  const dateResult = normalizeDate(birthDateRaw);
  if (dateResult.error) return err(dateResult.error);

  let countryValue;
  if (countryRaw === undefined) countryValue = undefined;
  else if (countryRaw === '') countryValue = null;
  else {
    const resolved = resolveCountry(countryRaw);
    if (resolved === null) return err(`ארץ לא מוכרת: ${countryRaw}`);
    countryValue = resolved;
  }

  let genderValue;
  if (genderRaw !== undefined && genderRaw !== '') {
    const g = mapGender(genderRaw);
    if (g.error) return err(g.error);
    genderValue = g.value;
  }
  let statusValue;
  if (statusRaw !== undefined && statusRaw !== '') {
    const s = mapFamilyStatus(statusRaw);
    if (s.error) return err(s.error);
    statusValue = s.value;
  }

  let newStudent;
  if (firstNameRaw && lastNameRaw) {
    newStudent = { firstName: firstNameRaw, lastName: lastNameRaw };
    if (dateResult.value !== undefined) newStudent.birthDate = dateResult.value;
    if (genderValue !== undefined) newStudent.gender = genderValue;
    if (statusValue !== undefined) newStudent.familyStatus = statusValue;
  }

  const task = {
    line: lineNo, branch: branch.padStart(2, '0'), studyType,
    idType: idInfo.type, identity: idInfo.identifier,
    birthDate: dateResult.value, country: countryRaw, countryValue,
  };
  if (newStudent) task.newStudent = newStudent;
  return { task };
}

function maybeHeader(rawLines, delimiter) {
  const none = { headerLineIndex: -1, columnMap: null, missingRequiredLabels: [] };
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const cells = splitCells(rawLines[i], delimiter);
    if (isPurelyNumericCell(cells[0])) return none;
    const columnMap = buildColumnMap(cells);
    const missingRequiredLabels = ['branch', 'studyType', 'identifier']
      .filter((f) => !(f in columnMap))
      .map((f) => FIELD_LABELS[f]);
    return { headerLineIndex: i, columnMap, missingRequiredLabels };
  }
  return none;
}

export function parseAbsorbInput(text) {
  const rawLines = splitLines(text);
  const delimiter = detectDelimiter(text);
  const { headerLineIndex, columnMap, missingRequiredLabels } = maybeHeader(rawLines, delimiter);
  const tasks = [];
  const errors = [];

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const raw = rawLines[i];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (i === headerLineIndex) continue;

    const cells = splitCells(raw, delimiter);
    if (columnMap && missingRequiredLabels.length > 0) {
      errors.push({ line: lineNo, text: raw, reason: `בכותרת חסרים שדות חובה: ${missingRequiredLabels.join('/')}` });
      continue;
    }

    const result = rowToTask({ cells, lineNo, raw, columnMap });
    if (result.error) errors.push(result.error);
    else tasks.push(result.task);
  }

  return { tasks, errors };
}
