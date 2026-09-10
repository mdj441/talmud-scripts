import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetRowsToText, loadXlsxFile } from '../src/tools/absorb-xlsx.js';

// ─── מהבריף, מילה במילה ──────────────────────────────────────────────────────

test('מטריצה → טאבים, תאים ריקים נשמרים, מספרים הופכים למחרוזת', () => {
  const rows = [['סניף','סוג','ת.ז.'], [1, 300, 6136871], ['02','600', 'AB1']];
  assert.equal(sheetRowsToText(rows), 'סניף\tסוג\tת.ז.\n1\t300\t6136871\n02\t600\tAB1');
});

test('תאריך אקסל (Date) מתורגם ל-DD/MM/YYYY', () => {
  const rows = [['סניף','סוג','ת.ז.','תאריך לידה'], ['01','300','337386692', new Date(2005,4,5)]];
  assert.ok(sheetRowsToText(rows).endsWith('05/05/2005'));
});

// ─── תוספות ────────────────────────────────────────────────────────────────

test('null/undefined הופכים לתא ריק', () => {
  const rows = [['01', null, undefined]];
  assert.equal(sheetRowsToText(rows), '01');
  const rows2 = [['01', null, 'x']];
  assert.equal(sheetRowsToText(rows2), '01\t\tx');
});

test('שורה ריקה לגמרי בסוף (שורת-זנב של אקסל) מדולגת', () => {
  const rows = [['01', '300', '123456789'], ['', '', ''], [null, undefined, null]];
  assert.equal(sheetRowsToText(rows), '01\t300\t123456789');
});

test('תא ריק פנימי נשמר כדי שמיקום העמודות ישרוד', () => {
  const rows = [['01', '', '123456789']];
  assert.equal(sheetRowsToText(rows), '01\t\t123456789');
});

test('תאים ריקים בסוף השורה נחתכים (בלי טאבים מיותרים)', () => {
  const rows = [['01', '300', '123456789', '', '', null]];
  assert.equal(sheetRowsToText(rows), '01\t300\t123456789');
});

test('בוליאני הופך ל-true/false', () => {
  const rows = [['01', true, false]];
  assert.equal(sheetRowsToText(rows), '01\ttrue\tfalse');
});

// ─── loadXlsxFile: סמוק — פונקציה, נדחית (לא זורקת) כש-XLSX הגלובלי לא קיים ───

test('loadXlsxFile היא פונקציה', () => {
  assert.equal(typeof loadXlsxFile, 'function');
});

test('loadXlsxFile נדחית (Promise) כש-globalThis.XLSX לא קיים, ולא זורקת סינכרונית', async () => {
  assert.equal(globalThis.XLSX, undefined);
  const fakeFile = { arrayBuffer: async () => new ArrayBuffer(0) };
  let threwSync = false;
  let p;
  try {
    p = loadXlsxFile(fakeFile);
  } catch (e) {
    threwSync = true;
  }
  assert.equal(threwSync, false, 'לא אמורה לזרוק סינכרונית');
  await assert.rejects(p, /XLSX|SheetJS|ספרי/i);
});
