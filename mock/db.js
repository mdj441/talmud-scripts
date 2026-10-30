// "השרת" של סביבת-הדמה: מצב משותף בין דפים (localStorage תחת מפתח אחד), עם זריעה מתרחיש.
// התרחיש מוזרק על-ידי ההרצה (window.__mockScenario) או נלקח מברירת-המחדל למטה.
// כל התעודות בדויות. אין כאן שום נתון אמיתי.

(function () {
  'use strict';

  const KEY = 'mock.talmud.db';

  // ברירת-מחדל: מוסד "עטרת שלמה", סניפים 00 (491) ו-16 (4159), סוגי לימוד לכל סניף.
  function defaultScenario() {
    return {
      institutes: {
        '491': { branch: '00', name: 'עטרת שלמה' },
        '4159': { branch: '16', name: 'עטרת שלמה' },
        '4200': { branch: '05', name: 'עטרת שלמה' },
      },
      // InstituteStudyTypeID → { instituteId, code, desc, status }
      studyTypes: {
        '10001': { instituteId: '491', code: '300', desc: 'ישיבה גבוהה בנים', status: 'זכאי' },
        '10002': { instituteId: '491', code: '600', desc: 'כולל אברכים יום שלם', status: 'זכאי' },
        '10003': { instituteId: '491', code: '605', desc: 'כולל אברכים יום שלם ב', status: 'זכאי' },
        '10004': { instituteId: '491', code: '700', desc: 'כולל חצי יום בוקר', status: 'זכאי' },
        '10005': { instituteId: '491', code: '705', desc: 'כולל חצי יום בוקר ב', status: 'זכאי' },
        '10006': { instituteId: '491', code: '708', desc: 'כולל חצי יום בוקר ג', status: 'זכאי' },
        '10007': { instituteId: '491', code: '720', desc: 'כולל חצי יום אחה"צ', status: 'זכאי' },
        '10008': { instituteId: '491', code: '725', desc: 'כולל חצי יום אחה"צ ב', status: 'זכאי' },
        '10009': { instituteId: '491', code: '728', desc: 'כולל חצי יום אחה"צ ג', status: 'סגור' }, // עמוד 2 בגריד
        '10269': { instituteId: '4159', code: '600', desc: 'כולל אברכים יום שלם', status: 'זכאי' },
        '10270': { instituteId: '4159', code: '300', desc: 'ישיבה גבוהה בנים', status: 'זכאי' },
        '10301': { instituteId: '4200', code: '600', desc: 'כולל אברכים יום שלם', status: 'זכאי' },
      },
      // תלמידים שכבר בסוג-לימוד: InstituteStudyTypeID → [{ id, idType, first, last, birth }]
      enrolled: {
        '10002': [
          { id: '012345678', idType: '1', first: 'ראובן', last: 'כהן', birth: '01/01/1990' },
          { id: '023456789', idType: '1', first: 'שמעון', last: 'לוי', birth: '02/02/1991' },
        ],
      },
      // תלמידים שהמערכת מכירה (ניתן לקלוט ישירות): id → פרטים
      known: {
        '034567890': { first: 'לוי', last: 'ישראלי', birth: '03/03/1992' },
        '045678901': { first: 'יהודה', last: 'פרץ', birth: '04/04/1993' },
        'AB1234567': { first: 'דן', last: 'גולד', birth: '05/05/1994', passport: true },
      },
      // מזהים שמפעילים הודעת-אישור ("המשך"/"לא") — למשל מעבר בין מוסדות. הסקריפט לא מאשר לבד.
      blocked: {
        '056789012': 'התלמיד לומד במוסד אחר. האם לבצע מעבר בין מוסדות?',
      },
      // התנהגות אחרי "שמירה" בדף תלמיד חדש: 'studyType' (חזרה לדף סוג-הלימוד) | 'stay' | 'popup' |
      // 'reload' (טעינה מלאה של אותו דף במצב תלמיד-חדש, ממצא 4)
      afterSave: 'studyType',
      // האם קליק בעץ-הצד מנווט לכתובת של הסניף (false = מרנדר במקום עם אותה כתובת)
      treeNavigates: true,
      // האם פירורי-הלחם בדף סוג-לימוד מציגים את מספר הסניף
      breadcrumbShowsBranch: true,
      // ממצא ב-2: פוסטבק מנווט (עריכה בגריד, עץ) נורה כ-pageRedirect: beginRequest בלי endRequest,
      // והדף נפרק אחרי redirectDelayMs (ברירת-מחדל: חצי מ-__mockDelayMs)
      redirectFiresBeginRequest: false,
      redirectDelayMs: null,
      // ממצא ב-3: גריד התלמידים עם עמודה נוספת לפני המזהה (עמודה 3 אינה עמודת המזהה)
      gridIdColumnShifted: false,
      // ממצא ב-4 (דף ההודעות): אחרי פעולה הגריד חוזר לעמוד 1; הודעות ב-messagesStuck מקבלות חלונית-הצלחה
      // אך נשארות "נשלחה" (פעולה שלא נתפסה בשרת)
      messagesResetPageAfterAction: false,
      messagesStuck: [],
      pendingNewStudent: null, // { id, idType, studyTypeInstId, birth, country }
      log: [],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* zero */ }
    const seed = Object.assign(defaultScenario(), window.__mockScenario || {});
    save(seed);
    return seed;
  }

  function save(db) {
    localStorage.setItem(KEY, JSON.stringify(db));
  }

  function reset() { localStorage.removeItem(KEY); }

  const pad9 = (s) => (/^\d+$/.test(s) && s.length < 9 ? s.padStart(9, '0') : s);
  const norm = (s) => {
    const c = String(s || '').replace(/[\s-]/g, '');
    return /^\d+$/.test(c) ? c.replace(/^0+/, '') || '0' : c.toUpperCase();
  };

  // מדווח ל-window.__mockLog אם קיים, ורושם ב-DB (ל-Playwright לקרוא אחר-כך)
  function log(db, msg) {
    db.log = db.log || [];
    db.log.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
    if (db.log.length > 300) db.log.shift();
    if (window.__mockLog) window.__mockLog(msg);
  }

  function instituteOf(db, id) { return db.institutes[String(id)] || null; }
  function branchToInstituteId(db, branch) {
    const b = String(branch).padStart(2, '0');
    for (const [id, inst] of Object.entries(db.institutes)) if (inst.branch === b) return id;
    return null;
  }
  function studyTypesOf(db, instituteId) {
    return Object.entries(db.studyTypes)
      .filter(([, st]) => st.instituteId === String(instituteId))
      .map(([id, st]) => Object.assign({ id }, st))
      .sort((a, b) => Number(a.code) - Number(b.code));
  }
  function enrolledOf(db, stId) { return db.enrolled[String(stId)] || []; }
  function findEnrolled(db, stId, identity) {
    const t = norm(identity);
    return enrolledOf(db, stId).filter((s) => norm(s.id) === t);
  }
  function enroll(db, stId, student) {
    db.enrolled[String(stId)] = db.enrolled[String(stId)] || [];
    db.enrolled[String(stId)].push(student);
  }

  function query(name) {
    const m = new RegExp('[?&]' + name + '=([^&#]*)', 'i').exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  window.__mockDb = { KEY, load, save, reset, pad9, norm, log, instituteOf, branchToInstituteId, studyTypesOf, enrolledOf, findEnrolled, enroll, query, defaultScenario };
})();
