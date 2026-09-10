// הרחבות לדף-המוסד של סביבת-הדמה: כל כלי (עזיבה, דיווח חודשי) רושם כאן את הלשונית שלו.
// כל הרחבה: { render({db, instituteId, inst, tabId}), postback(target, arg, ctx) → תוצאה או null }.
// הקובץ הזה נטען אחרי סקריפט-הדף. הרחבות נוספות: לדחוף ל-window.__mockInstituteExtensions
// *לפני* render — לכן כל הרחבה קוראת ל-window.__mockRerenderInstitute אם הדף כבר רונדר.

(function () {
  'use strict';
  window.__mockInstituteExtensions = window.__mockInstituteExtensions || [];
  // (הרחבות של עזיבה ודיווח חודשי יתווספו כאן על-ידי המיישמים של הכלים האלה)
})();
