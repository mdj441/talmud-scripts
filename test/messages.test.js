// בדיקות-יחידה לפונקציות הטהורות של כלי ההודעות. כל התעודות בדויות.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGES_ACTION, MESSAGES_TSV_HEADER, MESSAGES_REPORT_HEADER,
  messagesMakeUid, messagesExtractId, messagesNormalizeAction, messagesSuggestAction, messagesParseTable,
  messagesLoadSummary, messagesBuildTsv, messagesBuildReportTsv, messagesBuildReport, messagesIsMessagesUrl,
  messagesIsRunning, messagesRunBulk, messagesScan, messagesRunTable,
  messagesNormId, messagesNormBranch, messagesExtractTransfer, messagesMergeDuplicates, messagesParseRoster, messagesRosterBranches,
  messagesCrossCheck, messagesDecisionCounts, messagesReviewEntries, messagesRowMatchesFilter, messagesShorten,
  messagesFindFilterSelect, messagesActionOutcome,
} from '../src/tools/messages.js';
import { messagesTool } from '../src/tools/messages-ui.js';

const T = '\t';

// נוסחי ההודעות מהאתר החי (30.10.2026), עם שמות ומזהים בדויים.
const LIVE_REQUEST = (name, id, studyType, branch) => `מוסד אחר ביקש להעביר אליו את התלמיד ${name}, בעל ת.ז. ${id} מסוג לימוד ${studyType} בסניף ${branch}. אנא אשר או דחה את המעבר.`;
const LIVE_OUT_DONE = (name, idPhrase) => `מעבר התלמיד ${name}, ${idPhrase} ממוסדך אושר על ידי תהליך אישור אוטומטי.`;
const LIVE_IN = (name, id) => `מעבר התלמיד ${name}, בעל ת.ז. ${id} אל מוסדך אושר על ידי המוסד בו הוא לומד.`;
const TRANSFER_DONE = 'מעבר תלמיד';

// ─── עשן: import ב-Node ─────────────────────────────────────────────────────
test('smoke: המודולים נטענים ב-Node והחוזה של הלשונית שלם', () => {
  for (const fn of [messagesRunBulk, messagesScan, messagesRunTable]) assert.equal(typeof fn, 'function');
  assert.equal(messagesIsRunning(), false);
  assert.equal(messagesTool.id, 'messages');
  // הכרעה ח (1.11.2026): הלשונית בכל דף ('*'); מחוץ לדף ההודעות היא מציעה לעבור אליו. דף הכניסה מסונן ב-main.
  assert.deepEqual(messagesTool.pages, ['*']);
  assert.deepEqual(messagesTool.steps, ['סריקה', 'סקירה', 'ביצוע', 'תוצאות']);
  for (const k of ['hasPendingRun', 'isRunning', 'onStop', 'mount']) assert.equal(typeof messagesTool[k], 'function');
  assert.equal(messagesTool.hasPendingRun(), false);
});

test('messagesIsMessagesUrl: רק דף ההודעות', () => {
  assert.equal(messagesIsMessagesUrl('https://talmud.edu.gov.il/Association/Default.aspx'), true);
  assert.equal(messagesIsMessagesUrl('https://talmud.edu.gov.il/association/default.aspx?x=1'), true);
  assert.equal(messagesIsMessagesUrl('https://talmud.edu.gov.il/Institutes/InstitutesDetails.aspx?InstituteID=491'), false);
  assert.equal(messagesIsMessagesUrl(null), false);
});

// ─── UID ────────────────────────────────────────────────────────────────────
test('messagesMakeUid: דטרמיניסטי, מתחיל ב-M, שונה לקלט שונה', () => {
  const a = messagesMakeUid('בקשת מעבר תלמיד', 'גוף א');
  assert.equal(a, messagesMakeUid('בקשת מעבר תלמיד', 'גוף א'));
  assert.match(a, /^M[0-9a-z]+$/);
  assert.notEqual(a, messagesMakeUid('בקשת מעבר תלמיד', 'גוף ב'));
  assert.notEqual(a, messagesMakeUid('כותרת אחרת', 'גוף א'));
  assert.equal(messagesMakeUid(undefined, undefined), messagesMakeUid('', ''));
});

// ─── חילוץ ת.ז. ────────────────────────────────────────────────────────────
test('messagesExtractId: ת.ז. בכתיבים שונים', () => {
  assert.equal(messagesExtractId('בקשת מעבר עבור התלמיד ת.ז. 012345678 מסניף 00'), '012345678');
  assert.equal(messagesExtractId('תלמיד ת.ז 23456789 עבר'), '23456789');
  assert.equal(messagesExtractId('תז. 034567890'), '034567890');
});
test('messagesExtractId: הנוסחים מהאתר החי בדיוק: "בעל ת.ז. <9 ספרות>" / "בעל דרכון <אותיות+ספרות>"; סוג-הלימוד והסניף אינם מזהה', () => {
  assert.equal(messagesExtractId(LIVE_REQUEST('ראובן דמה', '012345678', '600', '09')), '012345678');
  assert.equal(messagesExtractId(LIVE_OUT_DONE('שמעון דמה', 'בעל ת.ז. 100200300')), '100200300');
  assert.equal(messagesExtractId(LIVE_OUT_DONE('לוי דמה', 'בעל דרכון cd7654321')), 'CD7654321');
  assert.equal(messagesExtractId(LIVE_IN('יהודה דמה', '200300400')), '200300400');
  assert.equal(messagesExtractId('מוסד אחר ביקש להעביר אליו את התלמיד פלוני דמה מסוג לימוד 600 בסניף 09.'), '', 'בלי מזהה: 600 ו-09 אינם ת.ז.');
});

test('messagesExtractId: דרכון באותיות גדולות; רצף ספרות חשוף; אין', () => {
  assert.equal(messagesExtractId('התלמיד בעל דרכון ab1234567 נקלט'), 'AB1234567');
  assert.equal(messagesExtractId('מספר 045678901 עודכן'), '045678901');
  assert.equal(messagesExtractId('תזכורת: יש להשלים את הדיווח החודשי.'), '');
  assert.equal(messagesExtractId(''), '');
  assert.equal(messagesExtractId(null), '');
});

// ─── פעולות ─────────────────────────────────────────────────────────────────
test('messagesNormalizeAction: כינויים של הישן, אותיות גדולות, לא מוכר → דלג', () => {
  assert.equal(messagesNormalizeAction('אשר'), MESSAGES_ACTION.APPROVE);
  assert.equal(messagesNormalizeAction('APPROVE'), MESSAGES_ACTION.APPROVE);
  assert.equal(messagesNormalizeAction(' אישור מעבר '), MESSAGES_ACTION.APPROVE);
  assert.equal(messagesNormalizeAction('דחייה'), MESSAGES_ACTION.DECLINE);
  assert.equal(messagesNormalizeAction('decline'), MESSAGES_ACTION.DECLINE);
  assert.equal(messagesNormalizeAction('טופל'), MESSAGES_ACTION.HANDLED);
  assert.equal(messagesNormalizeAction('סגור'), MESSAGES_ACTION.HANDLED);
  assert.equal(messagesNormalizeAction('שנה מצב הודעה לטופל'), MESSAGES_ACTION.HANDLED);
  assert.equal(messagesNormalizeAction('skip'), MESSAGES_ACTION.SKIP);
  assert.equal(messagesNormalizeAction(''), MESSAGES_ACTION.SKIP);
  assert.equal(messagesNormalizeAction(undefined), MESSAGES_ACTION.SKIP);
  assert.equal(messagesNormalizeAction('משהו אחר'), MESSAGES_ACTION.SKIP);
});

test('messagesSuggestAction: בקשת מעבר → אישור; "מעבר תלמיד" (אינפורמטיבי) ואחרת → טופל', () => {
  assert.equal(messagesSuggestAction('בקשת מעבר תלמיד'), MESSAGES_ACTION.APPROVE);
  assert.equal(messagesSuggestAction(' בקשת מעבר תלמיד '), MESSAGES_ACTION.APPROVE);
  assert.equal(messagesSuggestAction(TRANSFER_DONE), MESSAGES_ACTION.HANDLED);
  assert.equal(messagesSuggestAction('עדכון פרטי תלמיד'), MESSAGES_ACTION.HANDLED);
  assert.equal(messagesSuggestAction(''), MESSAGES_ACTION.HANDLED);
});

// ─── פרסור הטבלה המודבקת ────────────────────────────────────────────────────
test('messagesParseTable: טאבים עם כותרת מלאה (כמו "העתק לאקסל")', () => {
  const text = [
    MESSAGES_TSV_HEADER.join(T),
    ['M1abc', 'בקשת מעבר תלמיד', '012345678', '01/09/2026', 'גוף עם רווחים', 'דחיית מעבר'].join(T),
    ['M2def', 'הודעה כללית', '', '02/09/2026', 'גוף', ''].join(T),
    ['M3ghi', 'עדכון', '023456789', '02/09/2026', 'גוף', 'טופל'].join(T),
  ].join('\n');
  const r = messagesParseTable(text);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.entries.map((e) => [e.uid, e.action]), [
    ['M1abc', MESSAGES_ACTION.DECLINE], ['M2def', MESSAGES_ACTION.SKIP], ['M3ghi', MESSAGES_ACTION.HANDLED],
  ]);
  assert.deepEqual(r.counts, { approve: 0, decline: 1, handled: 1, skip: 1 });
  assert.equal(messagesLoadSummary(r), 'נטענו 3: אישור=0, דחיה=1, טופל=1, דילוג=1');
});

test('messagesParseTable: סדר עמודות שונה, שורות ריקות, UID כפול (האחרון מנצח)', () => {
  const text = `פעולה${T}הערה${T}UID\n\nאשר${T}x${T}M1\n${T}${T}M2\nדחה${T}y${T}M1\n`;
  const r = messagesParseTable(text);
  assert.equal(r.ok, true);
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries.find((e) => e.uid === 'M1').action, MESSAGES_ACTION.DECLINE);
  assert.equal(r.entries.find((e) => e.uid === 'M2').action, MESSAGES_ACTION.SKIP);
  assert.deepEqual(r.counts, { approve: 0, decline: 1, handled: 0, skip: 1 });
});

test('messagesParseTable: פסיקים בלי כותרת (UID ראשון, פעולה אחרונה)', () => {
  const r = messagesParseTable('M1abc,אישור\nM2def,דלג\nM3ghi');
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.entries.map((e) => e.action), [MESSAGES_ACTION.APPROVE, MESSAGES_ACTION.SKIP, MESSAGES_ACTION.SKIP]);
});

test('messagesParseTable: חסרה עמודה / ריק / רק כותרת → ok:false עם סיבה', () => {
  assert.equal(messagesParseTable('').ok, false);
  assert.match(messagesParseTable('   \n').reason, /ריקה/);
  const noAction = messagesParseTable(`UID${T}נושא\nM1${T}x`);
  assert.equal(noAction.ok, false);
  assert.match(noAction.reason, /UID|פעולה/);
  const onlyHeader = messagesParseTable(`UID${T}פעולה`);
  assert.equal(onlyHeader.ok, false);
  assert.match(onlyHeader.reason, /שורה אחת/);
  const noUids = messagesParseTable(`UID${T}פעולה\n${T}אשר`);
  assert.equal(noUids.ok, false);
});

// ─── TSV ────────────────────────────────────────────────────────────────────
test('messagesBuildTsv: כותרת + שורה לכל הודעה, גוף משוטח, פעולה ברירת-מחדל "דלג"', () => {
  const tsv = messagesBuildTsv([
    { uid: 'M1', header: 'נושא', personId: '012345678', date: '01/09/2026', body: 'שורה 1\nשורה\t2', suggestedAction: MESSAGES_ACTION.APPROVE },
    { uid: 'M2', header: 'אחר', personId: '', date: '', body: '' },
  ]);
  const lines = tsv.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], MESSAGES_TSV_HEADER.join(T));
  assert.equal(lines[1], ['M1', 'נושא', '012345678', '01/09/2026', 'שורה 1 שורה 2', MESSAGES_ACTION.APPROVE].join(T));
  assert.equal(lines[2], ['M2', 'אחר', '', '', '', MESSAGES_ACTION.SKIP].join(T));
  assert.equal(messagesBuildTsv([]).split('\n').length, 1);
});

test('messagesBuildTsv → messagesParseTable: סבב שלם (העתק, ערוך, הדבק)', () => {
  const tsv = messagesBuildTsv([{ uid: 'M9', header: 'בקשת מעבר תלמיד', personId: '012345678', date: '', body: 'גוף', suggestedAction: MESSAGES_ACTION.APPROVE }]);
  const edited = tsv.replace(MESSAGES_ACTION.APPROVE, 'דחה');
  const r = messagesParseTable(edited);
  assert.equal(r.ok, true);
  assert.deepEqual(r.entries.map((e) => [e.uid, e.action]), [['M9', MESSAGES_ACTION.DECLINE]]);
});

test('messagesBuildReportTsv: כותרת הדוח ושורות', () => {
  const tsv = messagesBuildReportTsv([{ uid: 'M1', id: '012345678', header: 'נושא', action: MESSAGES_ACTION.HANDLED, status: 'בוצע', body: 'גוף' }]);
  const lines = tsv.split('\n');
  assert.equal(lines[0], MESSAGES_REPORT_HEADER.join(T));
  assert.equal(lines[1], ['M1', '012345678', 'נושא', MESSAGES_ACTION.HANDLED, 'בוצע', 'גוף'].join(T));
});

// ─── דוח "מה נשאר" ──────────────────────────────────────────────────────────
test('messagesBuildReport: סיכום, שורות לנכשלים ולא-נמצאים, בלי שורה על מוצלחים', () => {
  const rows = [
    { uid: 'M1', id: '012345678', header: 'בקשת מעבר תלמיד', action: MESSAGES_ACTION.APPROVE, status: 'בוצע' },
    { uid: 'M2', id: '', header: 'הודעה כללית', action: MESSAGES_ACTION.SKIP, status: 'דילוג' },
    { uid: 'M3', id: '023456789', header: 'עדכון', action: MESSAGES_ACTION.DECLINE, status: 'נכשל: האתר הודיע: "לא"' },
  ];
  const r = messagesBuildReport(rows, { notFound: [{ uid: 'M4', action: MESSAGES_ACTION.HANDLED }] });
  assert.equal(r.summary, 'בוצעו=1 · נכשלו=1 · דולגו=1 · לא נמצאו=1');
  assert.equal(r.lines.length, 2);
  assert.match(r.lines[0], /M3/);
  assert.match(r.lines[0], /023456789/);
  assert.match(r.lines[0], /ידנית/);
  assert.match(r.lines[1], /M4/);
  assert.equal(r.stopped, false);
});

test('messagesBuildReport: עצירה מסומנת בסיכום ובשורת הוראה', () => {
  const r = messagesBuildReport([{ uid: 'M1', status: 'בוצע', header: 'x', action: MESSAGES_ACTION.HANDLED }], { stopped: true });
  assert.match(r.summary, /נעצר/);
  assert.equal(r.summary, 'בוצעו=1 · נכשלו=0 · דולגו=0 · נעצר');
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /נעצרה/);
  assert.equal(r.stopped, true);
});

test('messagesBuildReport: ריק → סיכום אפסים בלי שורות', () => {
  const r = messagesBuildReport([], {});
  assert.equal(r.summary, 'בוצעו=0 · נכשלו=0 · דולגו=0');
  assert.deepEqual(r.lines, []);
});

// ─── סקירה בתוך החלונית: מיזוג כפילויות, מצבת, הצלבה ───────────────────────
const msgRow = (over) => Object.assign({ uid: 'M1', header: 'בקשת מעבר תלמיד', personId: '012345678', body: LIVE_REQUEST('ראובן דמה', '012345678', '600', '09'), date: '01/09/2026', count: 1, suggestedAction: MESSAGES_ACTION.APPROVE }, over);

test('messagesNormId / messagesNormBranch: אפסים מובילים, רווחים, אותיות', () => {
  assert.equal(messagesNormId('012345678'), messagesNormId('12345678'));
  assert.equal(messagesNormId(' 0123-45678 '), messagesNormId('12345678'));
  assert.equal(messagesNormId('ab1234567'), 'AB1234567');
  assert.equal(messagesNormId(''), '');
  assert.equal(messagesNormBranch('5'), '05');
  assert.equal(messagesNormBranch(' 16 '), '16');
  assert.equal(messagesNormBranch('סניף 16'), '16');
  assert.equal(messagesNormBranch(''), '');
});

// עובדות 30.10.2026: בבקשת-מעבר מוסד אחר מבקש תלמיד שלנו; "מסוג לימוד NNN בסניף NN" = הסניף וסוג-הלימוד
// הנוכחיים שלו אצלנו (direction 'out'). ב"מעבר תלמיד" האינפורמטיבי: "אל מוסדך" = 'in', "ממוסדך אושר" = 'out-done'.
test('messagesExtractTransfer: "מסוג לימוד NNN בסניף NN" → סניף (2 ספרות), סוג-לימוד, out; "אל מוסדך" → in; "ממוסדך אושר" → out-done; אחר → ריק', () => {
  const empty = { branch: '', studyType: '', direction: '' };
  assert.deepEqual(messagesExtractTransfer(LIVE_REQUEST('ראובן דמה', '012345678', '600', '09')), { branch: '09', studyType: '600', direction: 'out' });
  assert.deepEqual(messagesExtractTransfer(LIVE_REQUEST('ראובן דמה', '012345678', '600', '9')), { branch: '09', studyType: '600', direction: 'out' }, 'סניף בספרה אחת מרופד');
  assert.deepEqual(messagesExtractTransfer(LIVE_REQUEST('ראובן דמה', '012345678', '1200', '16')), { branch: '16', studyType: '1200', direction: 'out' });
  assert.deepEqual(messagesExtractTransfer(LIVE_IN('יהודה דמה', '200300400')), { branch: '', studyType: '', direction: 'in' });
  assert.deepEqual(messagesExtractTransfer(LIVE_OUT_DONE('שמעון דמה', 'בעל ת.ז. 100200300')), { branch: '', studyType: '', direction: 'out-done' });
  assert.deepEqual(messagesExtractTransfer(LIVE_OUT_DONE('לוי דמה', 'בעל דרכון CD7654321')), { branch: '', studyType: '', direction: 'out-done' });
  assert.deepEqual(messagesExtractTransfer('עודכנו פרטי התלמיד'), empty);
  assert.deepEqual(messagesExtractTransfer('בקשת מעבר עבור התלמיד ת.ז. 012345678 מסניף 00 לסניף 16.'), empty, 'נוסח הדמה הישן אינו נתמך עוד');
  assert.deepEqual(messagesExtractTransfer(null), empty);
});

test('messagesMergeDuplicates: אותו נושא + אותה ת.ז. → שורה אחת עם כמות ורשימת UID-ים; הסדר נשמר', () => {
  const list = [
    msgRow({ uid: 'M1', count: 2 }), // אותה הודעה פעמיים בגריד (UID זהה)
    msgRow({ uid: 'M2', header: 'עדכון פרטי תלמיד', personId: '023456789', body: 'עודכן', suggestedAction: MESSAGES_ACTION.HANDLED }),
    msgRow({ uid: 'M3', body: LIVE_REQUEST('ראובן דמה', '012345678', '600', '09') + ' (תזכורת)', date: '03/09/2026' }), // נוסח שונה, אותה ת.ז.
    msgRow({ uid: 'M4', header: 'עדכון פרטי תלמיד', personId: '23456789', body: 'אחר', suggestedAction: MESSAGES_ACTION.HANDLED }), // ת.ז. של M2 בלי אפס מוביל
  ];
  const rows = messagesMergeDuplicates(list);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].uid, 'M1');
  assert.deepEqual(rows[0].uids, ['M1', 'M3']);
  assert.deepEqual(rows[0].items, [{ uid: 'M1', count: 2 }, { uid: 'M3', count: 1 }]);
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].date, '01/09/2026');
  assert.deepEqual(rows[0].dates, ['01/09/2026', '03/09/2026']);
  assert.deepEqual(rows[0].transfer, { branch: '09', studyType: '600', direction: 'out' });
  assert.equal(rows[0].suggestedAction, MESSAGES_ACTION.APPROVE);
  assert.equal(rows[1].uid, 'M2');
  assert.deepEqual(rows[1].uids, ['M2', 'M4']);
  assert.equal(rows[1].count, 2);
});

test('messagesMergeDuplicates: בלי ת.ז. → לפי גוף מנורמל; גוף שונה לא מתמזג; ריק → ריק', () => {
  const list = [
    msgRow({ uid: 'M1', header: 'הודעה כללית', personId: '', body: 'תזכורת:  יש להשלים\nאת הדיווח' }),
    msgRow({ uid: 'M2', header: 'הודעה כללית', personId: '', body: 'תזכורת: יש להשלים את הדיווח ' }),
    msgRow({ uid: 'M3', header: 'הודעה כללית', personId: '', body: 'עדכון גרסה' }),
    msgRow({ uid: 'M4', header: 'נושא אחר', personId: '', body: 'עדכון גרסה' }),
  ];
  const rows = messagesMergeDuplicates(list);
  assert.deepEqual(rows.map((r) => r.uids), [['M1', 'M2'], ['M3'], ['M4']]);
  assert.deepEqual(messagesMergeDuplicates([]), []);
  assert.deepEqual(messagesMergeDuplicates(null), []);
});

test('messagesParseRoster: טאבים עם כותרת, פסיקים בלי כותרת, אפסים מובילים שאקסל מחק, שורות-זבל מדולגות', () => {
  const r1 = messagesParseRoster(`סניף${T}ת.ז./דרכון\n16${T}78901234\n05${T}012345678\n16${T}ab1234567\n${T}\nסניף 16${T}\n`);
  assert.equal(r1.ok, true, r1.reason);
  assert.equal(r1.count, 3);
  assert.deepEqual(messagesRosterBranches(r1, '078901234'), ['16']);
  assert.deepEqual(messagesRosterBranches(r1, '12345678'), ['05']);
  assert.deepEqual(messagesRosterBranches(r1, 'AB1234567'), ['16']);
  assert.deepEqual(messagesRosterBranches(r1, '099999999'), []);
  assert.equal(r1.ignored, 1, 'שורה עם סניף בלי ת.ז.');

  const r2 = messagesParseRoster('5,012345678\n16,012345678\n16,023456789');
  assert.equal(r2.ok, true, r2.reason);
  assert.deepEqual(messagesRosterBranches(r2, '012345678'), ['05', '16'], 'תלמיד בשני סניפים');
  assert.equal(r2.count, 3);
});

test('messagesParseRoster: עמודות הפוכות (ת.ז. ואז סניף) מזוהות לפי הכותרת; ריק → ok:false', () => {
  const r = messagesParseRoster(`ת.ז.${T}שם${T}סניף\n012345678${T}ראובן${T}16`);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(messagesRosterBranches(r, '012345678'), ['16']);
  assert.equal(messagesParseRoster('').ok, false);
  assert.match(messagesParseRoster('   ').reason, /ריק/);
  const only = messagesParseRoster(`סניף${T}ת.ז.`);
  assert.equal(only.ok, false);
});

// עובדות 30.10.2026: בבקשת-מעבר מוסד אחר מבקש תלמיד שלנו. תלמיד שעדיין במצבת (בכל סניף) → הבקשה עדיין
// רלוונטית: "ממתין" (לאשר או לדחות). תלמיד שאינו במצבת → כבר לא אצלנו: "כנראה בוצע" (רמז; ההצעה לא משתנה,
// הכפתור "כל 'כנראה בוצע': סמן כטופל" מחיל). "מעבר תלמיד" האינפורמטיבי: טופל, עמודת המצבת לפי המצבת, בלי תג.
test('messagesCrossCheck: בקשת-מעבר שהתלמיד במצבת → "סניף NN" + ממתין; לא במצבת → "כנראה בוצע"; ההצעה נשארת "אישור מעבר"; "מעבר תלמיד" → טופל בלי תג', () => {
  const roster = messagesParseRoster(`סניף${T}ת.ז.\n16${T}78901234\n05${T}012345678\n16${T}AB1234567\n9${T}100200300`);
  const rows = messagesMergeDuplicates([
    msgRow({ uid: 'M1', personId: '078901234', body: LIVE_REQUEST('דן דמה', '078901234', '600', '05') }), // במצבת בסניף 16 (לא הסניף שבגוף): עדיין אצלנו
    msgRow({ uid: 'M2' }), // 012345678 במצבת בסניף 05
    msgRow({ uid: 'M3', personId: '034567890', body: LIVE_REQUEST('גד דמה', '034567890', '600', '09') }), // לא במצבת: כנראה כבר עבר
    msgRow({ uid: 'M4', header: 'עדכון פרטי תלמיד', personId: '023456789', body: 'עודכן', suggestedAction: MESSAGES_ACTION.HANDLED }),
    msgRow({ uid: 'M5', header: 'הודעה כללית', personId: '', body: 'תזכורת', suggestedAction: MESSAGES_ACTION.HANDLED }),
    msgRow({ uid: 'M6', header: 'אישור קליטה', personId: 'AB1234567', body: 'נקלט', suggestedAction: MESSAGES_ACTION.HANDLED }),
    msgRow({ uid: 'M7', header: TRANSFER_DONE, personId: '100200300', body: LIVE_OUT_DONE('שמעון דמה', 'בעל ת.ז. 100200300'), suggestedAction: MESSAGES_ACTION.HANDLED }),
    msgRow({ uid: 'M8', header: TRANSFER_DONE, personId: '200300400', body: LIVE_IN('יהודה דמה', '200300400'), suggestedAction: MESSAGES_ACTION.HANDLED }),
  ]);
  const out = messagesCrossCheck(rows, roster);
  assert.equal(out.length, 8);
  const tags = (r) => [r.pending, r.probablyDone];
  assert.equal(out[0].rosterLabel, 'סניף 16');
  assert.deepEqual(tags(out[0]), [true, false], 'במצבת (בכל סניף) → ממתין');
  assert.equal(out[0].suggestedAction, MESSAGES_ACTION.APPROVE);
  assert.equal(out[1].rosterLabel, 'סניף 05');
  assert.deepEqual(tags(out[1]), [true, false]);
  assert.equal(out[1].suggestedAction, MESSAGES_ACTION.APPROVE);
  assert.equal(out[2].rosterLabel, 'לא במצבת');
  assert.deepEqual(tags(out[2]), [false, true], 'בקשת-מעבר על תלמיד שאינו במצבת → כנראה בוצע');
  assert.equal(out[2].suggestedAction, MESSAGES_ACTION.APPROVE, 'ההחלטה לא משתנה מעצמה; הכפתור "כל \'כנראה בוצע\': סמן כטופל" מחיל');
  assert.equal(out[3].rosterLabel, 'לא במצבת');
  assert.deepEqual(tags(out[3]), [false, false], 'לא בקשת-מעבר: בלי תג');
  assert.equal(out[4].rosterLabel, '', 'בלי ת.ז.: עמודה ריקה');
  assert.deepEqual(tags(out[4]), [false, false]);
  assert.equal(out[5].rosterLabel, 'סניף 16');
  assert.deepEqual(tags(out[5]), [false, false]);
  assert.equal(out[6].rosterLabel, 'סניף 09', 'מעבר תלמיד (ממוסדך): לפי המצבת, סניף מרופד');
  assert.deepEqual(tags(out[6]), [false, false]);
  assert.equal(out[6].suggestedAction, MESSAGES_ACTION.HANDLED);
  assert.equal(out[7].rosterLabel, 'לא במצבת', 'מעבר תלמיד (אל מוסדך): לפי המצבת');
  assert.deepEqual(tags(out[7]), [false, false]);
  assert.equal(out[7].suggestedAction, MESSAGES_ACTION.HANDLED);
  // בלי מצבת: העמודה ריקה, בלי תגים, וההצעה לא משתנה
  const none = messagesCrossCheck(rows, null);
  assert.ok(none.every((r) => r.rosterLabel === '' && !r.pending && !r.probablyDone));
  assert.equal(none[0].suggestedAction, MESSAGES_ACTION.APPROVE);
  assert.notEqual(none, rows, 'מחזיר מערך חדש');
});

test('messagesCrossCheck: מצבת שאקסל מחק בה אפסים מובילים ומזהה עם רווחים עדיין מצליבה', () => {
  const roster = messagesParseRoster('5,12345678\n16,78901234');
  const out = messagesCrossCheck(messagesMergeDuplicates([
    msgRow({ uid: 'M1' }), // 012345678
    msgRow({ uid: 'M2', personId: ' 0789-01234 ', body: LIVE_REQUEST('דן דמה', '078901234', '600', '05') }),
  ]), roster);
  assert.equal(out[0].rosterLabel, 'סניף 05');
  assert.equal(out[0].pending, true);
  assert.equal(out[1].rosterLabel, 'סניף 16');
  assert.equal(out[1].pending, true);
});

test('messagesDecisionCounts / messagesReviewEntries: החלטה לכל שורה (ברירת-מחדל: ההצעה), כולל כל ה-UID-ים של שורה ממוזגת', () => {
  const rows = messagesMergeDuplicates([
    msgRow({ uid: 'M1', count: 2 }),
    msgRow({ uid: 'M3', body: 'תזכורת: בעל ת.ז. 012345678 מסוג לימוד 600 בסניף 09' }),
    msgRow({ uid: 'M2', header: 'עדכון פרטי תלמיד', personId: '023456789', body: 'עודכן', suggestedAction: MESSAGES_ACTION.HANDLED }),
    msgRow({ uid: 'M9', header: 'הודעה כללית', personId: '', body: 'תזכורת', suggestedAction: MESSAGES_ACTION.HANDLED }),
  ]);
  const decisions = new Map([[rows[0].key, MESSAGES_ACTION.DECLINE], [rows[2].key, MESSAGES_ACTION.SKIP]]);
  assert.deepEqual(messagesDecisionCounts(rows, decisions), { approve: 0, decline: 1, handled: 1, skip: 1 });
  assert.deepEqual(messagesDecisionCounts(rows, new Map()), { approve: 1, decline: 0, handled: 2, skip: 0 });
  const entries = messagesReviewEntries(rows, decisions);
  assert.deepEqual(entries, [
    { uid: 'M1', action: MESSAGES_ACTION.DECLINE, count: 2 },
    { uid: 'M3', action: MESSAGES_ACTION.DECLINE, count: 1 },
    { uid: 'M2', action: MESSAGES_ACTION.HANDLED, count: 1 },
    { uid: 'M9', action: MESSAGES_ACTION.SKIP, count: 1 },
  ]);
});

test('messagesRowMatchesFilter: לפי ת.ז., נושא או גוף; ריק → הכול', () => {
  const row = msgRow({});
  assert.equal(messagesRowMatchesFilter(row, ''), true);
  assert.equal(messagesRowMatchesFilter(row, '12345678'), true);
  assert.equal(messagesRowMatchesFilter(row, 'מעבר'), true);
  assert.equal(messagesRowMatchesFilter(row, 'בסניף 09'), true);
  assert.equal(messagesRowMatchesFilter(row, 'קליטה'), false);
});

test('messagesShorten: קיצור עם שלוש נקודות', () => {
  assert.equal(messagesShorten('אבג', 10), 'אבג');
  assert.equal(messagesShorten('א'.repeat(20), 10), 'א'.repeat(9) + '…');
  assert.equal(messagesShorten(null, 5), '');
});

// ─── ממצא ב-11: תיבת-הסינון נבחרת לפי המזהה ddlMessageStatus, ורק אחרת לפי האופציות ────────
function fakeSelect(id, texts) {
  return { id, options: texts.map((t) => ({ text: t, value: t })) };
}
async function withSelects(selects, fn) {
  const prev = globalThis.document;
  globalThis.document = { querySelectorAll: (sel) => (sel === 'select' ? selects.slice() : []) };
  try { return await fn(); } finally { if (prev === undefined) delete globalThis.document; else globalThis.document = prev; }
}

test('messagesFindFilterSelect (ממצא ב-11): מעדיפה select שה-id שלו מכיל ddlMessageStatus גם כשאחר עם אותן אופציות קודם לו', async () => {
  const decoy = fakeSelect('ContentPlaceHolder1_ddlOther', ['נשלחה', 'טופלה']);
  const real = fakeSelect('ContentPlaceHolder1_ddlMessageStatus', ['נשלחה', 'טופלה']);
  await withSelects([decoy, real], () => { assert.equal(messagesFindFilterSelect(), real); });
  await withSelects([decoy], () => { assert.equal(messagesFindFilterSelect(), decoy, 'בלי מזהה: לפי אופציות'); });
  await withSelects([fakeSelect('x', ['א', 'ב'])], () => { assert.equal(messagesFindFilterSelect(), null); });
});

// ─── ממצא ב-4: אימות הפעולה כשהגריד חזר לעמוד אחר אחרי הפוסטבק ────────────────────────
test('messagesActionOutcome (ממצא ב-4): אותו עמוד → לפי הספירה; עמוד אחר → הצלחה רק עם חלונית-הצלחה', () => {
  const same = { pageBefore: 3, pageAfter: 3 };
  assert.deepEqual(messagesActionOutcome(Object.assign({ before: 1, after: 0, popup: null }, same)), { ok: true });
  assert.equal(messagesActionOutcome(Object.assign({ before: 1, after: 1, popup: null }, same)).ok, false);
  assert.match(messagesActionOutcome(Object.assign({ before: 1, after: 1, popup: { kind: 'info', text: 'לא' } }, same)).reason, /האתר הודיע: "לא"/);
  const moved = { pageBefore: 3, pageAfter: 1, before: 1, after: 0 };
  assert.deepEqual(messagesActionOutcome(Object.assign({ popup: { kind: 'success', text: 'הצלחה' } }, moved)), { ok: true, pageChanged: true });
  const noPopup = messagesActionOutcome(Object.assign({ popup: null }, moved));
  assert.equal(noPopup.ok, false);
  assert.match(noPopup.reason, /^הגריד חזר לעמוד אחר אחרי הפעולה/);
  const errPopup = messagesActionOutcome(Object.assign({ popup: { kind: 'info', text: 'הפעולה אפשרית רק עבור בקשת מעבר' } }, moved));
  assert.equal(errPopup.ok, false);
  assert.match(errPopup.reason, /הגריד חזר לעמוד אחר אחרי הפעולה/);
  assert.match(errPopup.reason, /הפעולה אפשרית רק עבור בקשת מעבר/);
});
