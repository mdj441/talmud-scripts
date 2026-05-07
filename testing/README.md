# Testing harness for talmud-scripts

Automated end-to-end testing of the userscripts in this repo, using Playwright.
The browser runs headless in the sandbox; your real login session is reused via
a `storageState.json` file that you generate locally.

## One-time setup on your local machine

1. Install Node.js (v18+) if you don't already have it.
2. From the repo root, run:
   ```
   npm install -D playwright
   npx playwright install chromium
   ```
3. Capture a logged-in session:
   ```
   node testing/capture-session.js
   ```
   A Chromium window opens. Log in to talmud.edu.gov.il, then return to the
   terminal and press Enter. The script writes `storageState.json` to the repo
   root.
4. Upload `storageState.json` to the Claude session (drag it into the chat or
   place it at `/home/user/talmud-scripts/storageState.json`).

## Important notes

- **Never commit `storageState.json`.** It's already in `.gitignore`. The file
  contains an active session token equivalent to your password.
- **Sessions expire.** When tests start failing with a redirect to login,
  re-run `capture-session.js` and re-upload.
- **Real data only.** There is no staging environment. Tests run against
  production talmud.edu.gov.il with your real account. Destructive actions
  (POSTs that modify state) are gated and require explicit confirmation per
  run.
