# StaffMe Time Tracker

This repository contains the work-hours tracker prototype.

## Public test branch

The first dashboard prototype is on the `public-test` branch.

It includes:

- Email-based local profile setup
- Editable duty hours
- Selectable adherence days
- Automatic coverage-day classification
- Work Hours, InCoverage Hours, and Weekend Hours targets
- Weekly metric cards and daily breakdown
- Import of hourly JSON rows or the raw `op.exec` response
- Local deduplication and browser storage
- A message receiver for the future same-browser StaffMe helper

The live StaffMe connection is intentionally not included yet. The helper will send only normalized hourly rows using:

```js
window.postMessage({ type: "STAFFME_HOURLY_DATA", rows }, "*");
```

The `main` branch will remain unchanged beyond repository initialization until the public test is approved.
