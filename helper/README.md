# StaffMe Time Tracker Helper

This is a small Manifest V3 Chrome/Edge helper for the public-test prototype.

## What it does

- Reads the visible StaffMe “Hourly AHT (Last 5 Days)” table after it loads.
- Supports the framed preview page and standard HTML table/row layouts.
- Stores normalized hourly rows in the browser's local extension storage.
- Sends those rows to the tracker dashboard in the same browser.
- Shows diagnostic status when the dashboard requests data.
- Does not read passwords.
- Does not read or send StaffMe cookies or callback tokens.
- Does not create demo rows.

## Test installation

1. Download the public-test branch as a ZIP.
2. Extract it.
3. Open chrome://extensions or edge://extensions.
4. Turn on Developer mode.
5. Choose Load unpacked.
6. Select the extracted helper folder.
7. If the helper was already installed, click its Reload button after downloading the new ZIP.
8. Open StaffMe and log in normally with your work email.
9. Wait for the Hourly AHT (Last 5 Days) table to finish loading. It may take 20 seconds to 2 minutes.
10. Leave the StaffMe tab open.
11. Open the public tracker dashboard and enter the same email.
12. Click Refresh StaffMe data.

The dashboard remains empty until real rows are received from the StaffMe hourly table. If the dashboard reports that the table was detected but no rows were parsed, send that message to the developer; it identifies a page-layout mismatch rather than a missing login.