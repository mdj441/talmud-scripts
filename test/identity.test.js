import test from 'node:test';
import assert from 'node:assert/strict';
import { padId9, detectIdType } from '../src/core/identity.js';

test('padId9 מרפד ת.ז. קצרה ל-9', () => {
  assert.equal(padId9('6136871'), '006136871');   // מהצילום: 206136871 היה תקין, זה קצר
  assert.equal(padId9('12345'), '000012345');
});
test('padId9 לא נוגע ב-9 ספרות', () => {
  assert.equal(padId9('206136871'), '206136871');
});
test('detectIdType: ספרות = ת.ז. מרופדת', () => {
  assert.deepEqual(detectIdType('6136871'), { type: 'tz', identifier: '006136871' });
});
test('detectIdType: אות לטינית = דרכון, לא מרופד, uppercase', () => {
  assert.deepEqual(detectIdType('ab1234567'), { type: 'passport', identifier: 'AB1234567' });
});
test('detectIdType: תחביר מפורש דרכון ספרתי', () => {
  assert.deepEqual(detectIdType('דרכון:12345'), { type: 'passport', identifier: '12345' });
  assert.deepEqual(detectIdType('passport:99'), { type: 'passport', identifier: '99' });
});
test('detectIdType: תחביר מפורש ת.ז.', () => {
  assert.deepEqual(detectIdType('tz:12345'), { type: 'tz', identifier: '000012345' });
});
