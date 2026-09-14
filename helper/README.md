# StaffMe Time Tracker Helper

This is a small Manifest V3 Chrome/Edge helper for the public-test prototype.

## What it does

- Reads the visible StaffMe hourly table after it loads.
- Stores normalized rows in the browser's local extension storage.
- Does not read passwords.
- Does not send StaffMe cookies or callback tokens.
- Responds to the tracker page with the stored hourly rows.

## Test installation

1. Download the `public-test` branch as a ZIP.
2. Extract the ZIP.
3. Open `chrome://extensions` or `edge://extensions`.
4. Turn on Developer mode.
5. Choose Load unpacked.
6. Select the extracted `helper` folder.
7. Open StaffMe and log in normally.
8. Open the public tracker preview in another tab.

The dashboard will receive rows from the helper when the hourly table is visible. If the table is not detected, use the dashboard's manual hourly JSON import while the helper is being refined.
