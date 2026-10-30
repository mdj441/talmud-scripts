// בדיקות-יחידה לפונקציות הטהורות של כלי ההודעות. כל התעודות בדויות.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGES_ACTION, MESSAGES_TSV_HEADER, MESSAGES_REPORT_HEADER,
  messagesMakeUid, messagesExtractId, messagesNormalizeAction, messagesSuggestAction, messagesParseTable,
  messagesLoadSummary, messagesBuildTsv, messagesBuildReportTsv, messagesBuildReport, messagesIsMessagesUrl,
  messagesIsRunning, messagesRunBulk, messagesScan, messagesRunTable,
} from '../src/tools/messages.js';
import { messagesTool } from '../src/tools/messages-ui.js';

const T = '\t';

// ─── עשן: import ב-Node ─────────────────────────────────────────────────────
test('smoke: המודולים נטענים ב-Node והחוזה של הלשונית שלם', () => {
  for (const fn of [messagesRunBulk, messagesScan, messagesRunTable]) assert.equal(typeof fn, 'function');
  assert.equal(messagesIsRunning(), false);
  assert.equal(messagesTool.id, 'messages');
  assert.deepEqual(messagesTool.pages, ['other']);
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

test('messagesSuggestAction: בקשת מעבר → אישור; אחרת → טופל', () => {
  assert.equal(messagesSuggestAction('בקשת מעבר תלמיד'), MESSAGES_ACTION.APPROVE);
  assert.equal(messagesSuggestAction(' בקשת מעבר תלמיד '), MESSAGES_ACTION.APPROVE);
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
