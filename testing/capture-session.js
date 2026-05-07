/**
 * capture-session.js
 *
 * Run this ONCE on your local machine to capture a logged-in session
 * with talmud.edu.gov.il, so the automated tests can reuse your login
 * without ever touching your password.
 *
 * Usage (on your machine):
 *   1. cd into this folder
 *   2. npm install -D playwright
 *      npx playwright install chromium
 *   3. node testing/capture-session.js
 *   4. A Chromium window opens. Log in to talmud.edu.gov.il manually.
 *   5. Once you're fully logged in and see the home page, return to the
 *      terminal and press Enter.
 *   6. The script writes ./storageState.json. Upload that file to the
 *      Claude session (it's already gitignored - DO NOT commit it).
 *
 * The file contains your active session token. Treat it like a password:
 * delete it when done, regenerate when it expires.
 */

const { chromium } = require('playwright');
const readline = require('readline');
const path = require('path');

const BASE_URL = 'https://talmud.edu.gov.il/';
const OUTPUT = path.resolve(__dirname, '..', 'storageState.json');

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(BASE_URL);

  console.log('\n=== A Chromium window has opened. ===');
  console.log('1. Log in to talmud.edu.gov.il in that window.');
  console.log('2. When you are fully logged in (you can see the dashboard),');
  console.log('   come back here and press Enter.\n');

  await waitForEnter('Press Enter once login is complete... ');

  await context.storageState({ path: OUTPUT });
  console.log(`\nSaved session to: ${OUTPUT}`);
  console.log('Now upload that file to the Claude session.');
  console.log('Reminder: do NOT commit storageState.json to git.\n');

  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
