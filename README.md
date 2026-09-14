# StaffMe Time Tracker

This repository contains the work-hours tracker prototype.

## Public test branch

The current test build is on the public-test branch:

[Open the public test dashboard](https://htmlpreview.github.io/?https://github.com/brbelicario/staffmeTimeTracker/blob/public-test/index.html)

The dashboard includes:

- Email-based local profile setup
- Editable duty hours
- Selectable adherence days
- Automatic coverage-day classification
- Work Hours, InCoverage Hours, and Weekend Hours targets
- Weekly metric cards and daily breakdown
- Same-browser StaffMe hourly data bridge
- Local deduplication and browser storage

The dashboard starts empty. It does not create demo rows. Data appears only after the helper reads the visible StaffMe “Hourly AHT (Last 5 Days)” table and sends those rows to the dashboard.

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
3. Redeploy the `public-test` branch.
4. Log in and refresh StaffMe data once so the captured rows are uploaded.

The endpoint creates its `tracker_profiles` table automatically. It stores a hashed email key, schedule settings, captured hourly rows, and the latest sync time. Because this prototype uses email-only access, anyone who knows the email can request that profile; it should not be treated as secure account authentication.
