import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAbsorbInput } from '../src/tools/absorb-parse.js';

test('פורמט ישן ברווחים: ת.ז. + ריפוד', () => {
  const { tasks } = parseAbsorbInput('01 300 6136871');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].branch, '01'); assert.equal(tasks[0].studyType, '300');
  assert.equal(tasks[0].idType, 'tz'); assert.equal(tasks[0].identity, '006136871');
});
test('פסיקים בלי כותרת: דרכון עם ארץ בעברית', () => {
  const { tasks: [t] } = parseAbsorbInput('12,600,AB1234567,15/03/1995,ארצות הברית');
  assert.equal(t.idType, 'passport'); assert.equal(t.identity, 'AB1234567');
  assert.equal(t.birthDate, '15/03/1995'); assert.equal(t.countryValue, '710');
});
test('הדבקה מאקסל עם כותרת: תלמיד חדש', () => {
  const text = 'סניף\tסוג לימוד\tת.ז./דרכון\tשם פרטי\tשם משפחה\tתאריך לידה\n' +
               '01\t300\t337386692\tישראל\tכהן\t05/05/2005';
  const { tasks: [t] } = parseAbsorbInput(text);
  assert.equal(t.identity, '337386692');
  assert.deepEqual(t.newStudent, { firstName: 'ישראל', lastName: 'כהן', birthDate: '05/05/2005' });
});
test('כותרת בסדר עמודות שונה + מגדר ומצב', () => {
  const text = 'ת.ז.\tשם משפחה\tשם פרטי\tסניף\tסוג\tתאריך לידה\tמגדר\tמצב משפחתי\n' +
               '337386692\tלוי\tלאה\t01\t300\t05/05/2005\tנקבה\tרווקה';
  const { tasks: [t] } = parseAbsorbInput(text);
  assert.equal(t.branch, '01'); assert.equal(t.newStudent.gender, '2');
  assert.equal(t.newStudent.familyStatus, '10');
});
test('תאים ריקים מאקסל לא מקלקלים שורה רגילה', () => {
  const { tasks: [t] } = parseAbsorbInput('סניף\tסוג\tת.ז.\tשם פרטי\tשם משפחה\n01\t300\t6136871\t\t');
  assert.equal(t.identity, '006136871'); assert.equal(t.newStudent, undefined);
});
test('פוזיציונלי: ת.ז. + שם + משפחה + תאריך לידה', () => {
  const { tasks: [t] } = parseAbsorbInput('01,300,337386692,ישראל,כהן,05/05/2005');
  assert.deepEqual(t.newStudent, { firstName: 'ישראל', lastName: 'כהן', birthDate: '05/05/2005' });
});
test('הערה מדולגת; שורה שבורה נכנסת ל-errors ולא זורקת', () => {
  const r = parseAbsorbInput('# הערה\n01 300\n');
  assert.equal(r.tasks.length, 0); assert.equal(r.errors.length, 1); assert.equal(r.errors[0].line, 2);
});

// --- תוספות המבקר (הכרעות מעבר לברייף) ---

test('ארץ לא מוכרת → error עם סיבה', () => {
  const r = parseAbsorbInput('12,600,AB1234567,15/03/1995,נרניה');
  assert.equal(r.tasks.length, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /ארץ לא מוכרת/);
  assert.match(r.errors[0].reason, /נרניה/);
});

test('שורות ריקות/רווחים מדולגות בשקט', () => {
  const r = parseAbsorbInput('01 300 6136871\n\n   \n02 400 7654321');
  assert.equal(r.tasks.length, 2);
  assert.equal(r.errors.length, 0);
  assert.equal(r.tasks[0].line, 1);
  assert.equal(r.tasks[1].line, 4);
});

test('כותרת חסרה עמודת חובה (מזהה) → כל שורות הנתונים ל-errors', () => {
  const text = 'סניף\tסוג לימוד\n01\t300\n02\t400';
  const r = parseAbsorbInput(text);
  assert.equal(r.tasks.length, 0);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0].reason, /מזהה/);
});

test('תאריך ISO מנורמל לפורמט DD/MM/YYYY', () => {
  const { tasks: [t] } = parseAbsorbInput('12,600,AB1234567,1995-03-05,');
  assert.equal(t.birthDate, '05/03/1995');
});

test('סניף "1" (אקסל מוריד אפס מוביל) → מרופד ל-"01"', () => {
  const { tasks: [t] } = parseAbsorbInput('1,300,6136871');
  assert.equal(t.branch, '01');
});

test('תאריך לא תקין → error עם סיבה', () => {
  const r = parseAbsorbInput('12,600,AB1234567,בקרוב,');
  assert.equal(r.tasks.length, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /תאריך לא תקין/);
});

test('שדות חובה חסרים (מזהה ריק) → error', () => {
  const r = parseAbsorbInput('01,300,');
  assert.equal(r.tasks.length, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /חסרים שדות חובה/);
});

test('ת.ז. פוזיציונלי עם 4-5 תאים → error (מספר עמודות לא צפוי)', () => {
  const r = parseAbsorbInput('01,300,6136871,ישראל,כהן');
  assert.equal(r.tasks.length, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /מספר עמודות לא צפוי/);
});

test('קוד מגדר/מצב מספרי עובר כמות שהוא', () => {
  const text = 'ת.ז.\tשם פרטי\tשם משפחה\tסניף\tסוג\tמגדר\tמצב\n337386692\tדני\tלוי\t01\t300\t1\t20';
  const { tasks: [t] } = parseAbsorbInput(text);
  assert.equal(t.newStudent.gender, '1');
  assert.equal(t.newStudent.familyStatus, '20');
});

// ─── W6 (בדיקה רטובה 10.9.2026): סדר-התבנית בלי כותרת, עם תאים ריקים כמו שאקסל מייצא ───
test('W6: דרכון בסדר-התבנית בלי כותרת (שם/משפחה ריקים) → תאריך לידה וארץ נקראים מהמקום הנכון', () => {
  const { tasks, errors } = parseAbsorbInput('16	600	AB1234567			09/11/2002	ארצות הברית');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(tasks[0].idType, 'passport');
  assert.equal(tasks[0].birthDate, '09/11/2002');
  assert.equal(tasks[0].countryValue, '710');
  assert.equal(tasks[0].newStudent, undefined);
});
test('W6: ת.ז. בסדר-התבנית המלא בלי כותרת (9 תאים) → מגדר ומצב במקומם, הארץ לא מתפרשת כמגדר', () => {
  const { tasks, errors } = parseAbsorbInput('00	600	123456782	משה	כהן	10/10/1990		נקבה	רווק');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.deepEqual(tasks[0].newStudent, { firstName: 'משה', lastName: 'כהן', birthDate: '10/10/1990', gender: '2', familyStatus: '10' });
});
test('W6: הפורמט הישן לדרכון (5 תאים) עדיין עובד', () => {
  const { tasks, errors } = parseAbsorbInput('12 600 AB1234567 15/03/1995 צרפת');
  assert.equal(errors.length, 0);
  assert.equal(tasks[0].birthDate, '15/03/1995');
  assert.equal(tasks[0].countryValue, '640');
});
