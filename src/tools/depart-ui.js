// לשונית "עזיבת תלמידים" — שלד זמני עד שההעברה מהסקריפט הישן תושלם (המיישם מחליף את הקובץ הזה).
export const departTool = {
  id: 'depart',
  title: 'עזיבת תלמידים',
  pages: ['institute'],
  hasPendingRun: () => false,
  isRunning: () => false,
  onStop() {},
  mount(container) {
    container.innerHTML = '<div class="tt-box tt-box-info">הכלי הזה בהעברה לסקריפט המאוחד. בינתיים השתמש בסקריפט הישן.</div>';
  },
};
