// נקודת הכניסה של הסקריפט המאוחד "תלמוד - כלי אוטומציה": מזהה את הדף ומעלה את החלונית עם
// הכלים הרלוונטיים (קליטה, עזיבה, דיווח חודשי בדף מוסד; קליטה בדף סוג-לימוד; הודעות בדף ההודעות).
// כל כלי חי במודול משלו; כאן רק הרישום והאתחול. אין גישה ל-document ברמת המודול (חוץ מהאתחול בסוף).

import { getPage } from './core/navigate.js';
import { log, restoreLog } from './core/log.js';
import { registerTool, mountPanel, PANEL_VERSION } from './ui/panel.js';
import { absorbTool } from './tools/absorb-ui.js';
import { departTool } from './tools/depart-ui.js';
import { reportTool } from './tools/report-ui.js';
import { messagesTool } from './tools/messages-ui.js';

registerTool(absorbTool);
registerTool(departTool);
registerTool(reportTool);
registerTool(messagesTool);

export function initTalmudTools() {
  const page = getPage({ init: true }); // טעינת-דף מלאה: כאן מותר למחוק רשומת-סניף סותרת (ממצא ב-5)
  const mounted = mountPanel(page);
  if (!mounted.length) return false;
  restoreLog();
  log(`[init] כלי תלמו"ד ${PANEL_VERSION} · דף ${page.kind} · לשוניות: ${mounted.map((t) => t.title).join(', ')}`);
  return true;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initTalmudTools(); });
  } else {
    setTimeout(() => { initTalmudTools(); }, 600);
  }
}
