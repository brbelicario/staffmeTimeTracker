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
