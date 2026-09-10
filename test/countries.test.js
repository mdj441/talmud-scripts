import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCountry } from '../src/core/identity.js';
import { COUNTRIES } from '../src/data/countries.js';

test('רשימה מלאה נטענה', () => assert.ok(COUNTRIES.length > 200));
test('ארה"ב', () => assert.equal(resolveCountry('ארצות הברית'), '710'));
test('מקסיקו', () => assert.equal(resolveCountry('מקסיקו'), '720'));
test('הממלכה המאוחדת', () => assert.equal(resolveCountry('הממלכה המאוחדת'), '590'));
test('מספר ישיר עובר כמו-שהוא', () => assert.equal(resolveCountry('640'), '640'));
test('לא ידוע → null', () => assert.equal(resolveCountry('אטלנטיס'), null));
test('ריק → null', () => assert.equal(resolveCountry(''), null));
test('מקסיקו עם גרשיים כפולים ASCII', () => assert.equal(resolveCountry('"מקסיקו"'), '720'));
test('ארצות הברית עם גרשיים כפולים עברים', () => assert.equal(resolveCountry('״ארצות הברית״'), '710'));
test('אזרביג\'אן עם גרש פנימי', () => assert.equal(resolveCountry('אזרביג\'אן'), '311'));
test('מקסיקו עם גרשיים כפולים וחללים בחוץ', () => assert.equal(resolveCountry(' "מקסיקו" '), '720'));
test('ארצות הברית עם גרשיים עברים וחללים בחוץ', () => assert.equal(resolveCountry('  ״ארצות הברית״  '), '710'));
test('מקסיקו עם גרשיים חד-גרפיים ASCII', () => assert.equal(resolveCountry("'מקסיקו'"), '720'));
test('מקסיקו עם גרשיים כפולים מעוקלים', () => assert.equal(resolveCountry('\u201Cמקסיקו\u201D'), '720'));
test('מקסיקו עם גרשיים חד-גרפיים מעוקלים', () => assert.equal(resolveCountry('\u2018מקסיקו\u2019'), '720'));
test('מקסיקו עם חללים בתוך הגרשיים', () => assert.equal(resolveCountry('" מקסיקו "'), '720'));
test('רווחים בלבד → null', () => assert.equal(resolveCountry('   '), null));

// ─── B3: קידומת חייבת להיות חד-משמעית (אחרת נבחרת ארץ שגויה בשקט) ──────────
test('קידומת קצרה מדי → null (לא ארה"ב בטעות)', () => {
  assert.equal(resolveCountry('א'), null);
  assert.equal(resolveCountry('אר'), null);
});
test('שם ארוך שאינו ברשימה לא "נבלע" לתוך ארץ קצרה יותר', () => {
  assert.equal(resolveCountry('ניגריה הצפונית'), null); // היה מחזיר 211 (ניגר)
  assert.equal(resolveCountry('גרמניה התיכונה'), null);
});
test('שם מלא מדויק עדיין עובד גם כשהוא קידומת של אחר', () => {
  assert.equal(resolveCountry('קוריאה'), '151');
  assert.equal(resolveCountry('קוריאה הדרומית'), '153');
  assert.equal(resolveCountry('ניגר'), '211');
  assert.equal(resolveCountry('ניגריה'), '213');
  assert.equal(resolveCountry('גרמניה'), '500');
});
test('קידומת חד-משמעית באורך 3+ נפתרת', () => {
  assert.equal(resolveCountry('ארצות'), '710');
  assert.equal(resolveCountry('מקסי'), '720');
});
test('קידומת דו-משמעית → null', () => {
  assert.equal(resolveCountry('אוסטר'), null); // אוסטריה / אוסטרליה
});
