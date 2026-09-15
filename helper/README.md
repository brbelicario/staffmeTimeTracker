# SMTracker by B. Belicario

This is a small Manifest V3 Chrome/Edge helper for the public-test prototype. It is an independent tool and is not made by, sponsored by, or affiliated with StaffMe.

## What it does

- Reads the visible StaffMe “Hourly AHT (Last 5 Days)” table after you approve the on-page data-access notice.
- Supports the framed preview page and standard HTML table/row layouts.
- Stores normalized hourly rows in the browser's local extension storage.
- Makes those rows available to the SMTracker dashboard when the dashboard requests a refresh.
- Shows diagnostic status when the dashboard requests data.
- Does not read passwords, cookies, authentication tokens, general browsing history, or unrelated page content.
- Does not create demo rows.

## Privacy

The direct privacy policy is:

https://staffmetimetracker.pages.dev/privacy-policy.html

The extension asks for affirmative permission before reading StaffMe hourly data. If permission is declined, it does not scan the StaffMe table or parse StaffMe network responses. The permission can be granted later by reloading StaffMe.

## Test installation

1. Download the public-test branch as a ZIP.
2. Extract it.
3. Open chrome://extensions or edge://extensions.
4. Turn on Developer mode.
5. Choose Load unpacked.
6. Select the extracted helper folder.
7. If the helper was already installed, click its Reload button after downloading the new ZIP.
8. Open StaffMe and log in normally with your work email.
9. When the SMTracker data-access notice appears, review the privacy policy and choose Allow and continue.
10. Wait for the Hourly AHT (Last 5 Days) table to finish loading. It may take 20 seconds to 2 minutes.
11. Leave the StaffMe tab open.
12. Open the public tracker dashboard and enter the same email.
13. Click Refresh data, or leave the dashboard's optional auto-refresh enabled.

The dashboard remains empty until real rows are received from the StaffMe hourly table. If the dashboard reports that the table was detected but no rows were parsed, send that message to the developer; it identifies a page-layout mismatch rather than a missing login.
