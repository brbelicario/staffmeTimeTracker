# StaffMe Time Tracker

This repository contains the work-hours tracker prototype.

## Public test branch

The current test build is on the public-test branch:

The Cloudflare Pages public test deployment follows this branch.

[Open the public test dashboard](https://htmlpreview.github.io/?https://github.com/brbelicario/staffmeTimeTracker/blob/public-test/index.html)

The dashboard includes:

- Email/password account registration and login
- Optional Google account sign-in
- Editable duty hours
- Selectable adherence days
- Automatic coverage-day classification
- Work Hours, InCoverage Hours, and Weekend Hours targets
- Weekly metric cards and daily breakdown
- Same-browser StaffMe hourly data bridge
- Local deduplication and browser storage
- First-use setup for contract dates, schedule, targets, caps, pay, and optional SM worker identity linking
- Per-worker SM row buckets and identity mismatch blocking so rows from multiple SM accounts in one browser are not sent to the wrong dashboard
- Changing or removing a linked SM identity clears only the extension's saved SM cache; existing dashboard rows, manual hours, contracts, history, and CB records remain intact.
- Data recovery points are created before hourly data is cleared, replaced, or edited; hourly rows can be restored without replacing manual hours, contracts, reports, or CB records.
- Cloud profile revisions reject stale saves from older tabs instead of silently overwriting newer data.

The dashboard starts empty. It does not create demo rows. Data appears only after the helper reads the visible StaffMe “Hourly AHT (Last 5 Days)” table and sends those rows to the dashboard. New accounts are prompted to complete their contract and tracker settings. Each account has its own saved profile and can be used from another device; an optional linked SM worker identity prevents rows from different SM accounts in the same browser from being mixed.

The helper:

- Reads visible hourly table cells only
- Does not read passwords
- Does not read or send cookies or callback tokens
- Stores rows in the browser extension's local storage

The data path is:

StaffMe hourly table → browser helper → local extension storage → public-test dashboard

The main branch will remain unchanged beyond repository initialization until the public test is approved.

## Cloud sync for cross-device viewing

The dashboard keeps a local copy for offline use and also supports a Cloudflare Pages Function at `/api/sync`.

To enable shared retention:

1. Create a Cloudflare D1 database.
2. In the Pages project settings, add a D1 binding with variable name `DB`.
3. Keep the D1 binding available to the Pages Functions; the current project accepts the existing binding name `db`.
4. Redeploy the `public-test` branch.
5. Register or log in, then refresh StaffMe data once so the captured rows are uploaded.

The endpoint creates its `users`, `sessions`, and `tracker_profiles` tables automatically. Passwords are stored as salted PBKDF2 hashes, sessions use secure HTTP-only cookies, and tracker rows are saved under the authenticated account. Email/password login works without Google configuration. Optional Google login additionally requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in Cloudflare Pages variables.


## Automatic USD to PHP rate

Tracker Settings now defaults to an automatic USD to PHP rate. It keeps the last saved rate as a fallback and checks for a newer value about once per hour.

The automatic source is a small Google Apps Script web app backed by a Google Sheet:

1. Create a Google Sheet and put `=GOOGLEFINANCE("CURRENCY:USDPHP")` in cell `A1`.
2. Open **Extensions → Apps Script** and paste this code. Replace the spreadsheet ID and sheet name.
3. Deploy it as a **Web app**, execute as yourself, and allow **Anyone** to access it.
4. In Cloudflare Pages, add a Production variable named `GOOGLE_FINANCE_ENDPOINT` containing the deployed web-app URL.
5. Redeploy the `public-test` branch. Leave the tracker set to **Automatic (Google Finance)**.

```js
const SPREADSHEET_ID = 'PASTE_YOUR_SHEET_ID';
const SHEET_NAME = 'Sheet1';

function doGet() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const rate = Number(sheet.getRange('A1').getValue());
  return ContentService
    .createTextOutput(JSON.stringify({
      rate: rate,
      source: 'Google Finance',
      updatedAt: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Google says currency quotes may be delayed by up to 20 minutes, so the tracker refreshes hourly and keeps the previous valid rate if the endpoint is unavailable.
