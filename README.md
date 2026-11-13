# JobFlow — minimal version

Two pieces only:

1. **Chrome extension** — click it after applying to a job, pick the job title from
   a dropdown (the exact 85 Arbetsförmedlingen occupation titles), fill company/city,
   hit Save. It POSTs to a tiny local server that appends to `server/data/jobs.json`.
2. **Automation script** (`automation/fillReport.js`) — reads `jobs.json` and fills
   Arbetsförmedlingen's activity report for you, field by field, using Playwright.
   You handle BankID login and the final "submit" click yourself.


## Setup

### 1. Local server (extension talks to this)
```bash
cd server
npm install
npm start
```
Leave this running in a terminal. It's just storing JSON on your machine —
nothing leaves your computer.

### 2. Chrome extension
1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" → select the `extension/` folder
4. Pin the JobFlow icon to your toolbar

Now, every time you apply to a job: click the icon, pick the title, fill
company/city, hit Save.

### 3. Filling the report (once a month)
```bash
cd automation
npm install
npx playwright install chromium   # first time only
npm start
```
Follow the terminal prompts:
- A browser opens at arbetsformedlingen.se.
- You log in with BankID and navigate to the activity report's "add job" form.
- Press Enter in the terminal.
- It fills each job, pausing after each row by default so you can check
  before it saves (you can turn this off once you trust it).
- It never clicks the final submit button — that's always you.

## If a field doesn't get filled correctly

### Yrkesroll / Ort autocomplete not picking the right value

The script tries three progressively shorter queries (full title → first word →
4-char prefix) and scans a broad set of dropdown selectors, so it should handle
most AF DOM variations automatically.

If it still falls back to the manual prompt:
1. The browser will have the field pre-filled and the dropdown open — just click
   the correct suggestion and press Enter in the terminal to continue.
2. If this keeps happening, open `automation/fillReport.js`, find the
   `OPTION_SELECTORS` array near the top, and add the CSS selector that actually
   matches AF's dropdown items. Use the browser DevTools element inspector to find
   the right one.

### Other fields (Arbetsgivare, Datum, radio buttons)

The input IDs and radio values are defined inline in `fillOneJob()`. If AF
changes a field's `id` or a radio's `value`, update the matching string there.

## Files

```
jobflow/
  extension/       Chrome extension (popup + title dropdown)
  server/           Tiny local API + data/jobs.json (your saved jobs)
  automation/       Playwright script that fills the AF report
```
