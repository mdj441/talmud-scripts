// מנגנון ההרצה של סביבת-הדמה: כרום אמיתי (Playwright, ערוץ chrome של המחשב), כל בקשה
// ל-https://talmud.edu.gov.il/* נענית מקבצי mock/ — כך ה-userscript האמיתי (dist/) רץ בלי
// שינוי, עם הכתובות המוחלטות שלו. אין התחברות, אין תלמידים אמיתיים.
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const MOCK = join(ROOT, 'mock');

export const SITE = 'https://talmud.edu.gov.il';
export const URLS = {
  institute: (id) => `${SITE}/Institutes/InstitutesDetails.aspx?InstituteID=${id}`,
  institutes: () => `${SITE}/Institutes/InstitutesDetails.aspx`, // בלי query: ה-session קובע (F1)
  studyType: (stId, instId) => `${SITE}/StudyType/StudyTypeDetails.aspx?InstituteStudyTypeID=${stId}&InstituteID=${instId}`, // GET ישיר (F3: h1 ריק)
  studyTypeCurrent: () => `${SITE}/StudyType/StudyTypeDetails.aspx`, // דרך הגריד: בלי query (F3)
  newStudent: () => `${SITE}/Students/StudentsDetails.aspx?`,
  messages: () => `${SITE}/Association/Default.aspx`,
};

const PAGES = {
  '/Institutes/InstitutesDetails.aspx': 'institute.html',
  '/StudyType/StudyTypeDetails.aspx': 'studytype.html',
  '/Students/StudentsDetails.aspx': 'student.html',
  '/Association/Default.aspx': 'messages.html',
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

// מפת הבקשות → קבצים. מיוצאת כדי ששרת-הדמה הידני (mock/serve.mjs) ישתמש באותה מפה.
export function resolveMockFile(pathname) {
  if (pathname.startsWith('/mock/')) {
    const rel = pathname.slice('/mock/'.length).replace(/\.\./g, '');
    const file = join(MOCK, rel);
    return existsSync(file) ? file : null;
  }
  const page = PAGES[pathname];
  if (page) {
    const file = join(MOCK, 'pages', page);
    return existsSync(file) ? file : null;
  }
  if (pathname === '/' || pathname === '') return join(MOCK, 'pages', 'home.html');
  return null;
}

export function mimeFor(file) {
  const ext = file.slice(file.lastIndexOf('.'));
  return MIME[ext] || 'application/octet-stream';
}

export async function launch() {
  return chromium.launch({ channel: 'chrome', headless: !process.env.HEADED });
}

export function readUserscript(name = 'talmud-tools.user.js') {
  return readFileSync(join(ROOT, 'dist', name), 'utf8');
}

// פותח הקשר חדש (localStorage/sessionStorage נקיים → מסד-הדמה נזרע מחדש מהתרחיש).
// ‏scenario: דריסות לתרחיש-ברירת-המחדל של mock/db.js. ‏script: מקור ה-userscript להזרקה.
// ברירת-המחדל של ה-session כאן: המשתמש כבר לחץ בעץ על סניף 00 (491), כמו ברוב הכניסות לאתר; תרחיש
// שרוצה "בלי session" (h1 ריק, F1) מעביר session: { instituteId: null, studyTypeId: null }.
export const DEFAULT_SESSION = { instituteId: '491', studyTypeId: null };
export async function openSession(browser, { scenario = {}, script = null, delayMs = 80 } = {}) {
  scenario = Object.assign({ session: Object.assign({}, DEFAULT_SESSION) }, scenario);
  const context = await browser.newContext({ locale: 'he-IL', viewport: { width: 1400, height: 900 } });
  await context.route(`${SITE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const file = resolveMockFile(url.pathname);
    if (!file) return route.fulfill({ status: 404, contentType: 'text/plain', body: `mock: no route for ${url.pathname}` });
    return route.fulfill({ status: 200, contentType: mimeFor(file), body: readFileSync(file) });
  });
  await context.addInitScript({ content: `window.__mockScenario = ${JSON.stringify(scenario)}; window.__mockDelayMs = ${delayMs};` });
  if (script) await context.addInitScript({ content: script });
  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(m.text()));
  page.on('pageerror', (e) => consoleLines.push('PAGEERROR ' + e.message));
  return { context, page, consoleLines };
}

export async function readMockDb(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('mock.talmud.db') || 'null'));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// מריץ evaluate בסבלנות — ניווט מלא באמצע הריצה משמיד את ההקשר, ואז מנסים שוב.
export async function evalRetry(page, fn, arg, { timeoutMs = 5000 } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    try { return await page.evaluate(fn, arg); } catch (e) { last = e; await sleep(150); }
  }
  throw last || new Error('evalRetry timeout');
}

// ─── קליטה: סלקטורים של הפאנל (מרוכזים כאן — משתנים פעם אחת כשהפאנל משתנה) ───
export const ABSORB_SEL = {
  panel: '#tt-panel',
  input: '#tt-absorb-input',
  start: '#tt-absorb-start',
  stop: '#tt-absorb-stop',
  startDate: '#tt-absorb-start-date',
  status: '#tt-absorb-status',
  results: '#tt-absorb-results',
  report: '#tt-absorb-report',
  log: '#tt-log',
};

export async function waitForPanel(page, sel = ABSORB_SEL, timeoutMs = 10000) {
  await page.waitForSelector(sel.panel, { timeout: timeoutMs });
}

// ממתין לסיום ריצה (דוח "מה נשאר" מוצג), חוצה ניווטים מלאים.
export async function waitForRunDone(page, sel = ABSORB_SEL, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const st = await page.evaluate((s) => {
        const rep = document.querySelector(s.report);
        const status = document.querySelector(s.status);
        return { done: !!rep && !rep.hidden && rep.innerHTML.trim() !== '', status: status ? status.textContent : '' };
      }, sel);
      if (st.done) return st;
    } catch (e) { /* ניווט באמצע */ }
    await sleep(250);
  }
  throw new Error(`waitForRunDone: timeout after ${timeoutMs}ms`);
}

// שורות-התוצאה מסומנות data-row; שורת "מה לעשות" (tr.tt-act) שמתחת לשורה שדורשת טיפול נקראת כ-action.
export async function readResults(page, sel = ABSORB_SEL) {
  return evalRetry(page, (s) => {
    const rows = Array.from(document.querySelectorAll(`${s.results} table tbody tr[data-row]`));
    return rows.map((tr) => {
      const c = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim());
      const next = tr.nextElementSibling;
      const action = next && next.classList.contains('tt-act') ? next.textContent.trim() : '';
      return { branch: c[0], studyType: c[1], identity: c[2], status: c[3], detail: tr.getAttribute('title') || '', action };
    });
  }, sel);
}

export async function readLog(page, sel = ABSORB_SEL) {
  return evalRetry(page, (s) => { const el = document.querySelector(s.log); return el ? el.textContent : ''; }, sel);
}

export async function readReport(page, sel = ABSORB_SEL) {
  return evalRetry(page, (s) => { const el = document.querySelector(s.report); return el ? el.innerText : ''; }, sel);
}

// זרימה שלמה: הדבקה → התחל → המתנה לסיום → תוצאות. continueOther=false מבטל את "אשר המשך" (מסומן כברירת-מחדל, הכרעה ט).
export async function runAbsorb(page, text, { startUrl, startDate = '', sel = ABSORB_SEL, timeoutMs = 90000, continueOther } = {}) {
  if (startUrl) await page.goto(startUrl);
  await waitForPanel(page, sel);
  if (continueOther === false) await page.uncheck('#tt-absorb-continue-other');
  await page.fill(sel.input, text);
  if (startDate) await page.fill(sel.startDate, startDate);
  await page.click(sel.start);
  const done = await waitForRunDone(page, sel, timeoutMs);
  const results = await readResults(page, sel);
  const report = await readReport(page, sel);
  const log = await readLog(page, sel);
  return { done, results, report, log };
}
