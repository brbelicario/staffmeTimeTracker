# StaffMe Time Tracker Helper

This is a small Manifest V3 Chrome/Edge helper for the public-test prototype.

## What it does

- Reads the visible StaffMe “Hourly AHT (Last 5 Days)” table after it loads.
- Stores normalized hourly rows in the browser's local extension storage.
- Sends those rows to the tracker dashboard in the same browser.
- Does not read passwords.
- Does not read or send StaffMe cookies or callback tokens.
- Does not create demo rows.

## Test installation

1. Download the public-test branch as a ZIP.
2. Extract the ZIP.
3. Open chrome://extensions or edge://extensions.
4. Turn on Developer mode.
5. Choose Load unpacked.
6. Select the extracted helper folder.
7. Open StaffMe and log in normally with your work email.
8. Wait for the Hourly AHT (Last 5 Days) table to finish loading. It may take 20 seconds to 2 minutes.
9. Leave the StaffMe tab open.
10. Open the public tracker dashboard and enter the same email.
11. If the dashboard says WAITING, click Refresh StaffMe data.

The dashboard remains empty until real rows are received from the StaffMe hourly table. If no rows arrive, check that the StaffMe hourly table is visible and fully loaded, then refresh the dashboard.
