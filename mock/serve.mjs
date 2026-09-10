// שרת-דמה ידני: node mock/serve.mjs  →  http://localhost:8787/Institutes/InstitutesDetails.aspx?InstituteID=491
// לצפייה בסביבת-הדמה בדפדפן רגיל. הסקריפט המאוחד (dist/) מוזרק לכל דף אם קיים, כך שאפשר
// "לשחק" בו ידנית בלי תלמו"ד אמיתי. הכתובות בסקריפט יחסיות למקור (origin) ולכן עובדות גם כאן.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveMockFile, mimeFor } from '../test/e2e/harness.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const DIST = process.env.MOCK_SCRIPT || join(ROOT, 'dist', 'talmud-tools.user.js');

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/dist.user.js') {
    if (!existsSync(DIST)) { res.writeHead(404); return res.end('no dist'); }
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    return res.end(readFileSync(DIST));
  }
  const file = resolveMockFile(url.pathname);
  if (!file) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(`no route: ${url.pathname}`); }
  let body = readFileSync(file);
  if (file.endsWith('.html') && existsSync(DIST)) {
    body = body.toString('utf8').replace('</body>', '<script src="/dist.user.js"></script></body>');
  }
  res.writeHead(200, { 'content-type': mimeFor(file) });
  res.end(body);
});

server.listen(PORT, () => {
  console.log(`mock talmud: http://localhost:${PORT}/Institutes/InstitutesDetails.aspx?InstituteID=491`);
  console.log(existsSync(DIST) ? `injecting ${DIST}` : 'no userscript injected (build first)');
});
