// שכבת-הבהירות (1.11.2026): בדיקות-יחידה לחלקים הטהורים של המעטפת, הטבלה והסטטוסים.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidIsraeliId, isIsraelCountry } from '../src/core/identity.js';
import { parseAbsorbInput } from '../src/tools/absorb-parse.js';
import { ABSORB_STATUS, absorbResultKind, absorbSummarizeKinds, absorbShortStatus, absorbIsOtherInstituteBlock, isAbsorbSuccess } from '../src/tools/absorb-report.js';
import { absorbAutoIdType, absorbEffectiveIdType, absorbRowsToText, absorbValidateRows, absorbFriendlyError, absorbCanonicalCountry, ABSORB_STEPS } from '../src/tools/absorb-ui.js';
import { stepClasses, stepsHtml, tagHtml, resultsTableHtml, zoneHtml, fitBoxHtml } from '../src/ui/widgets.js';
import { panelSide, otherSide, sideButtonLabel, initialTabFor, PANEL_WARNING, PANEL_CSS } from '../src/ui/panel.js';
import { messagesTool } from '../src/tools/messages-ui.js';
import { departTool } from '../src/tools/depart-ui.js';
import { reportTool } from '../src/tools/report-ui.js';
import { absorbTool } from '../src/tools/absorb-ui.js';

test('initialTabFor: הלשונית הראשונה לפי התאמה לדף; הנזכרת גוברת כשהיא מתאימה', () => {
  const list = [absorbTool, departTool, reportTool, messagesTool];
  const inst = { kind: 'institute', url: 'https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx' };
  const msgs = { kind: 'other', url: 'https://talmud.edu.gov.il/Association/Default.aspx' };
  const home = { kind: 'other', url: 'https://talmud.edu.gov.il/' };
  assert.equal(initialTabFor(list, inst, null), 'absorb');
  assert.equal(initialTabFor(list, inst, 'report'), 'report', 'הנזכרת מתאימה לדף מוסד');
  assert.equal(initialTabFor(list, msgs, 'report'), 'messages', 'בדף ההודעות: הודעות, גם כשנזכרה אחרת');
  assert.equal(initialTabFor(list, home, 'depart'), 'depart', 'בדף שאף לשונית לא מתאימה לו: הנזכרת');
  assert.equal(initialTabFor(list, home, null), 'absorb');
});
import { LOGO_DATA_URI } from '../src/ui/logo.js';

const row = (fields) => ({ fields: Object.assign({ branch: '', studyType: '', idType: '', identifier: '', firstName: '', lastName: '', birthDate: '', country: '', gender: '', familyStatus: '' }, fields) });

// ─── ספרת-ביקורת (הכרעה ד) ─────────────────────────────────────────────────
test('isValidIsraeliId: ספרת-ביקורת תקינה / שגויה, ריפוד אפסים, לא-ספרות', () => {
  assert.equal(isValidIsraeliId('123456782'), true);
  assert.equal(isValidIsraeliId('123456789'), false);
  assert.equal(isValidIsraeliId('012345678'), isValidIsraeliId('12345678'), 'ריפוד אפסים לא משנה');
  assert.equal(isValidIsraeliId('AB1234567'), false);
  assert.equal(isValidIsraeliId(''), false);
  assert.equal(isValidIsraeliId('1234567890'), false, 'עשר ספרות אינן ת.ז.');
});

test('isIsraelCountry: "ישראל" / "Israel" בלבד', () => {
  assert.equal(isIsraelCountry('ישראל'), true);
  assert.equal(isIsraelCountry(' israel '), true);
  assert.equal(isIsraelCountry('צרפת'), false);
  assert.equal(isIsraelCountry(''), false);
});

// ─── הפרסור: ישראל אינה ארץ-דרכון (הכרעה 1ב, סבב 2) ───────────────────────
test('parseAbsorbInput: מספר ספרתי + ארץ "ישראל" = ת.ז. (הארץ מתעלמת); דרכון + ישראל = שגיאה', () => {
  const r = parseAbsorbInput('סניף\tסוג לימוד\tת.ז./דרכון\tארץ\n16\t600\t317528398\tישראל');
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(r.tasks[0].idType, 'tz');
  assert.equal(r.tasks[0].identity, '317528398');
  assert.equal(r.tasks[0].countryValue, undefined);
  const bad = parseAbsorbInput('סניף\tסוג לימוד\tת.ז./דרכון\tתאריך לידה\tארץ\n16\t600\tAB1234567\t01/01/2000\tישראל');
  assert.equal(bad.tasks.length, 0);
  assert.match(bad.errors[0].reason, /ישראל אינה ארץ-דרכון/);
});

// ─── סטטוסים: סוג, סיכום, קיצור ─────────────────────────────────────────────
test('absorbResultKind + absorbSummarizeKinds: ירוק / לבדוק / נעצר / דורש טיפול', () => {
  assert.equal(absorbResultKind(ABSORB_STATUS.OK), 'ok');
  assert.equal(absorbResultKind(ABSORB_STATUS.EXISTS), 'ok');
  assert.equal(absorbResultKind(ABSORB_STATUS.VERIFY), 'verify');
  assert.equal(absorbResultKind(ABSORB_STATUS.SAVED_UNVERIFIED), 'verify');
  assert.equal(absorbResultKind(ABSORB_STATUS.STOPPED), 'stopped');
  assert.equal(absorbResultKind('נחסם: רשום במוסד אחר'), 'bad');
  assert.equal(absorbResultKind(ABSORB_STATUS.NEW_STUDENT_MISSING), 'bad');
  assert.equal(isAbsorbSuccess(ABSORB_STATUS.NEW_STUDENT_MISSING), false);
  const c = absorbSummarizeKinds([{ status: 'נקלט' }, { status: 'נקלט (תלמיד חדש)' }, { status: 'כבר קיים' }, { status: 'לבדוק ברשימה' }, { status: 'שגיאה: x' }, { status: 'נעצר' }]);
  assert.deepEqual(c, { absorbed: 2, exists: 1, verify: 1, bad: 1, stopped: 1 });
});

test('absorbShortStatus: "רשום במוסד אחר" מקבל נוסח קבוע; הודעה ארוכה מתקצרת; הודעה ריקה = הסטטוס בלבד', () => {
  const warn = 'אזהרה תלמיד זה רשום כבר במוסד אחר. אם לתלמיד קיימים לימודים של בוקר, אחה"צ, שירות אזרחי או יום שלם - הם יסתיימו';
  assert.equal(absorbShortStatus(ABSORB_STATUS.BLOCKED, warn), 'נחסם: רשום במוסד אחר');
  const long = absorbShortStatus(ABSORB_STATUS.ERROR, 'שגיאה תקלה בתהליך קליטת תלמיד, פרטים נוספים בהמשך ההודעה הארוכה הזאת');
  assert.ok(long.startsWith('שגיאה: '));
  assert.ok(long.length <= 'שגיאה: '.length + 48);
  assert.equal(absorbShortStatus(ABSORB_STATUS.ERROR, ''), 'שגיאה');
  assert.equal(absorbIsOtherInstituteBlock({ status: 'נחסם: רשום במוסד אחר', detail: warn }), true);
  assert.equal(absorbIsOtherInstituteBlock({ status: 'נחסם: משהו אחר', detail: 'משהו אחר' }), false);
  assert.equal(absorbIsOtherInstituteBlock({ status: 'נקלט', detail: warn }), false);
});

// ─── סוג המזהה בטבלה (הכרעה ג) ─────────────────────────────────────────────
test('absorbAutoIdType: אותיות = דרכון; ספרות + ארץ (לא ישראל) = דרכון; אחרת ת.ז.; הבחירה הידנית גוברת', () => {
  assert.equal(absorbAutoIdType({ identifier: 'AB1234567' }), 'passport');
  assert.equal(absorbAutoIdType({ identifier: '317528398', country: 'ארצות הברית' }), 'passport');
  assert.equal(absorbAutoIdType({ identifier: '317528398', country: 'ישראל' }), 'tz');
  assert.equal(absorbAutoIdType({ identifier: '317528398' }), 'tz');
  assert.equal(absorbAutoIdType({ identifier: 'ת.ז.:317528398', country: 'צרפת' }), 'tz');
  assert.equal(absorbAutoIdType({ identifier: '' }), 'tz');
  assert.equal(absorbEffectiveIdType({ identifier: '317528398', idType: 'passport' }), 'passport');
  assert.equal(absorbEffectiveIdType({ identifier: 'AB1', idType: 'tz' }), 'tz');
  assert.equal(absorbEffectiveIdType({ identifier: 'AB1', idType: '' }), 'passport');
});

test('absorbRowsToText: בחירה ידנית ששונה מהניחוש נכתבת כקידומת שהפרסור מכיר', () => {
  const text = absorbRowsToText([
    row({ branch: '16', studyType: '600', identifier: '317528398', idType: 'passport', birthDate: '12/11/2004' }), // בלי ארץ הניחוש היה ת.ז.
    row({ branch: '16', studyType: '600', identifier: '012345678', idType: 'tz', country: 'צרפת' }),
    row({ branch: '16', studyType: '600', identifier: 'AB1234567', birthDate: '01/01/2000', country: 'צרפת' }),
  ]);
  const lines = text.split('\n');
  assert.ok(lines[1].includes('\tדרכון:317528398\t'), lines[1]);
  assert.ok(lines[2].includes('\tת.ז.:012345678\t'), lines[2]);
  assert.ok(lines[3].includes('\tAB1234567\t'), 'בלי קידומת כשהבחירה שווה לניחוש');
  const parsed = parseAbsorbInput(text);
  assert.equal(parsed.errors.length, 0, JSON.stringify(parsed.errors));
  assert.deepEqual(parsed.tasks.map((t) => t.idType), ['passport', 'tz', 'passport']);
  assert.equal(parsed.tasks[0].identity, '317528398');
});

// ─── אימות הטבלה: אדום לא ירוץ, צהוב ירוץ ─────────────────────────────────
test('absorbValidateRows: דרכון חסר לידה/ארץ = אדום; ספרת-ביקורת שגויה = צהוב ורץ; שורה כפולה = צהוב; סניף/סוג לא ברשימה = אדום', () => {
  const ctx = { branches: ['00', '16'], studyTypesFor: (b) => (b === '00' ? ['600', '700'] : null) };
  const v = absorbValidateRows([
    row({ branch: '16', studyType: '600', identifier: 'AB1234567' }),                       // 0 דרכון בלי לידה וארץ
    row({ branch: '16', studyType: '600', identifier: '123456789' }),                       // 1 ספרת-ביקורת שגויה
    row({ branch: '16', studyType: '600', identifier: '123456789' }),                       // 2 כפול של 1
    row({ branch: '05', studyType: '600', identifier: '123456782' }),                       // 3 סניף לא בעץ
    row({ branch: '00', studyType: '900', identifier: '123456782' }),                       // 4 סוג לא בסניף 00
    row({ branch: '00', studyType: '600', identifier: '123456782' }),                       // 5 תקין
    row({ branch: 'ab', studyType: '600', identifier: '123456782' }),                       // 6 שגיאת-פרסור
    row({}),                                                                               // ריקה: לא נספרת
  ], ctx);
  assert.equal(v.filled.length, 7);
  assert.deepEqual(v.issues.map((i) => i.level), ['bad', 'warn', 'warn', 'bad', 'bad', '', 'bad']);
  assert.match(v.issues[0].msg, /דרכון: חסרים תאריך לידה, ארץ/);
  assert.match(v.issues[1].msg, /ספרת ביקורת/);
  assert.match(v.issues[2].msg, /כפול של שורה 2/);
  assert.match(v.issues[3].msg, /סניף לא נמצא ברשימת הסניפים/);
  assert.match(v.issues[4].msg, /סוג לימוד לא נמצא בסניף/);
  assert.match(v.issues[6].msg, /מספר סניף לא תקין/);
  assert.deepEqual(v.counts, { all: 7, ready: 1, warn: 2, bad: 4 });
  // המשימות שירוצו: רק מי שאינו אדום (צהוב רץ)
  assert.deepEqual(v.tasks.map((t) => t.line - 2), [1, 2, 5]);
});

test('absorbValidateRows: בלי רשימות ידועות (דף בלי עץ) לא מסמנים סניף או סוג', () => {
  const v = absorbValidateRows([row({ branch: '27', studyType: '999', identifier: '123456782' })], { branches: null, studyTypesFor: () => null });
  assert.deepEqual(v.issues.map((i) => i.level), ['']);
  assert.equal(v.tasks.length, 1);
});

test('absorbFriendlyError: הודעות-פרסור בשפה פשוטה, בלי מספרי-דוגמה', () => {
  assert.equal(absorbFriendlyError('חסרים שדות חובה: סניף/סוג לימוד/מזהה', { branch: '', studyType: '600', identifier: '' }), 'חסר: סניף, מספר');
  assert.equal(absorbFriendlyError('סניף לא מספרי: ab', {}), 'מספר סניף לא תקין. בחר סניף מהרשימה');
  assert.equal(absorbFriendlyError('תאריך לא תקין: 99/99', {}), 'תאריך לידה לא תקין (יום/חודש/שנה)');
  assert.equal(absorbFriendlyError('ארץ לא מוכרת: קזבלנקה', {}), 'ארץ לא ברשימה. בחר מהרשימה שנפתחת בתא');
  assert.equal(absorbFriendlyError('מגדר לא ידוע: x', {}), 'מגדר: זכר או נקבה');
});

test('absorbCanonicalCountry: כינוי / אנגלית → השם ברשימה; לא-מוכר נשאר; ישראל נשארת', () => {
  assert.equal(absorbCanonicalCountry('ארה"ב'), 'ארצות הברית');
  assert.equal(absorbCanonicalCountry('USA'), 'ארצות הברית');
  assert.equal(absorbCanonicalCountry('צרפת'), 'צרפת');
  assert.equal(absorbCanonicalCountry('קזבלנקה'), 'קזבלנקה');
  assert.equal(absorbCanonicalCountry('ישראל'), 'ישראל');
});

// ─── רכיבי המעטפת ──────────────────────────────────────────────────────────
test('סרגל-שלבים: stepClasses / stepsHtml', () => {
  assert.deepEqual(stepClasses(4, 0), ['tt-step-on', '', '', '']);
  assert.deepEqual(stepClasses(4, 2), ['tt-step-done', 'tt-step-done', 'tt-step-on', '']);
  const html = stepsHtml('x', ABSORB_STEPS);
  assert.deepEqual(ABSORB_STEPS, ['הכנה', 'ריצה', 'תוצאות', 'תיקון והרצה חוזרת']);
  assert.ok(html.includes('data-step="3"') && html.includes('תיקון והרצה חוזרת'));
});

test('תגיות, אזורים, תיבת-התאמה', () => {
  assert.ok(tagHtml({ label: 'לא ירוצו 2', kind: 'bad', button: true, filter: 'bad', active: true }).includes('<button'));
  assert.ok(tagHtml({ label: 'נקלטו 3', kind: 'ok' }).startsWith('<span'));
  assert.ok(zoneHtml({ id: 'z', title: 'תוצאות', dim: true }).includes('tt-zone-dim'));
  const fit = fitBoxHtml({ id: 'f', text: 'הדיווח רץ מדף מוסד.', buttonId: 'f-go', buttonLabel: 'עבור לדף המוסדות' });
  assert.ok(fit.includes('id="f-go"') && fit.includes('עבור לדף המוסדות'));
});

test('resultsTableHtml: שורות-תוצאה מסומנות data-row; "מה לעשות" מתחת לשורה שאינה ירוקה בלבד', () => {
  const html = resultsTableHtml({
    columns: [{ key: 'identity', label: 'מספר' }, { key: 'status', label: 'מה קרה' }],
    rows: [{ identity: '1', status: 'נקלט', action: 'לא אמור להופיע' }, { identity: '2', status: 'שגיאה', action: 'תקן ולחץ' }],
    classify: (r) => (r.status === 'נקלט' ? 'ok' : 'bad'),
    actionKey: 'action',
  });
  assert.equal((html.match(/data-row=/g) || []).length, 2);
  assert.equal((html.match(/class="tt-act/g) || []).length, 1);
  assert.ok(html.includes('תקן ולחץ') && !html.includes('לא אמור להופיע'));
});

test('המגירה: צד ברירת-המחדל שמאל, נזכר, הכפתור אומר לאן; אזהרה ולוגו מוטמעים', () => {
  assert.equal(panelSide({}), 'left');
  assert.equal(panelSide({ side: 'right' }), 'right');
  assert.equal(panelSide({ side: 'weird' }), 'left');
  assert.equal(otherSide('left'), 'right');
  assert.equal(sideButtonLabel('left'), 'לצד ימין');
  assert.equal(sideButtonLabel('right'), 'לצד שמאל');
  assert.ok(PANEL_WARNING.includes('באחריותך'));
  assert.ok(!/—/.test(PANEL_WARNING), 'בלי מקף ארוך');
  assert.ok(LOGO_DATA_URI.startsWith('data:image/png;base64,') && LOGO_DATA_URI.length > 3000);
  assert.ok(PANEL_CSS.includes('#tt-panel.tt-side-right') && PANEL_CSS.includes('.tt-steps'));
});

// ─── סבב 3: רכיב-הטבלה המשותף, טבלת העזיבה, לוח-שנה ───────────────────────────
import { gridRowMatchesFilter, gridCompare, gridSortRows } from '../src/ui/grid.js';
import { departValidateRows, departTextToRows, departFriendlyError, DEPART_STEPS } from '../src/tools/depart-ui.js';
import { isoToDmy, dmyToIso, dateFieldHtml } from '../src/ui/widgets.js';

test('grid: סינון לפי תגית ומיון (מספרים כמספרים, ריק בסוף, יציב)', () => {
  assert.equal(gridRowMatchesFilter('all', 'bad', false), true);
  assert.equal(gridRowMatchesFilter('bad', 'bad', false), true);
  assert.equal(gridRowMatchesFilter('bad', '', false), false);
  assert.equal(gridRowMatchesFilter('ready', '', false), true);
  assert.equal(gridRowMatchesFilter('ready', '', true), false, 'שורה ריקה לא מוצגת בסינון');
  assert.ok(gridCompare('9', '10') < 0, 'מספרית');
  assert.ok(gridCompare('', 'a') > 0, 'ריק בסוף');
  const rows = [{ fields: { b: '16' } }, { fields: { b: '00' } }, { fields: { b: '05' } }];
  assert.deepEqual(gridSortRows(rows, (r) => r.fields.b, 'asc').map((r) => r.fields.b), ['00', '05', '16']);
  assert.deepEqual(gridSortRows(rows, (r) => r.fields.b, 'desc').map((r) => r.fields.b), ['16', '05', '00']);
});

test('עזיבה: טקסט → שורות (כותרת מדולגת), אימות (סניף ברשימה, ספרת-ביקורת, כפילות), נוסחים', () => {
  assert.deepEqual(DEPART_STEPS, ['הכנה', 'ריצה', 'תוצאות', 'תיקון והרצה חוזרת']);
  const rows = departTextToRows('סניף\tת.ז.\n00\t012345678\n16\tAB1234567\n\n# הערה\n05 123456782');
  assert.deepEqual(rows.map((r) => [r.fields.branch, r.fields.identifier]), [['00', '012345678'], ['16', 'AB1234567'], ['05', '123456782']]);
  const v = departValidateRows([
    { fields: { branch: '00', identifier: '123456782' } },
    { fields: { branch: '00', identifier: '123456782' } }, // כפול
    { fields: { branch: '00', identifier: '123456789' } }, // ספרת-ביקורת
    { fields: { branch: '27', identifier: '123456782' } }, // לא ברשימה
    { fields: { branch: 'ab', identifier: '123456782' } }, // לא תקין
    { fields: { branch: '', identifier: '' } },
  ], { branches: ['00', '16'] });
  assert.deepEqual(v.issues.map((i) => i.level), ['', 'warn', 'warn', 'bad', 'bad']);
  assert.match(v.issues[1].msg, /כפול של שורה 1/);
  assert.match(v.issues[3].msg, /ברשימת הסניפים/);
  assert.deepEqual(v.tasks.map((t) => t.line - 2), [0, 1, 2]);
  assert.equal(departFriendlyError('חסרים שדות חובה: סניף / ת.ז.', { branch: '00', identifier: '' }), 'חסר: מספר');
});

test('לוח-שנה: המרות תאריך והרכב השדה', () => {
  assert.equal(isoToDmy('2026-11-01'), '01/11/2026');
  assert.equal(dmyToIso('01/11/2026'), '2026-11-01');
  assert.equal(isoToDmy('bad'), '');
  const html = dateFieldHtml({ id: 'd1', placeholder: 'יום/חודש/שנה' });
  assert.ok(html.includes('id="d1"') && html.includes('type="date"') && html.includes('data-cal="d1"'));
});
