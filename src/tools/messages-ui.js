// לשונית "הודעות" — שלד זמני עד שההעברה מהסקריפט הישן תושלם (המיישם מחליף את הקובץ הזה).
export const messagesTool = {
  id: 'messages',
  title: 'הודעות',
  pages: ['messages'],
  hasPendingRun: () => false,
  isRunning: () => false,
  onStop() {},
  mount(container) {
    container.innerHTML = '<div class="tt-box tt-box-info">הכלי הזה בהעברה לסקריפט המאוחד. בינתיים השתמש בסקריפט הישן.</div>';
  },
};
