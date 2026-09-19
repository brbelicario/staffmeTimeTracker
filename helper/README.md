# SMTracker by B. Belicario

Manifest V3 Chrome/Edge extension for the SM work-hour tracker and CB compliance task timer.

## What it does

### Beta Tracker

- Reads the visible StaffMe Beta Tracker “Hourly AHT (Last 5 Days)” table after you approve the on-page data-access notice.
- Supports the framed preview page, including random Google-hosted frame subdomains, and standard HTML table/row layouts.
- Stores normalized hourly rows in separate local buckets for each detected Beta Tracker identity.
- Makes only the identity-matching bucket available when the SMTracker dashboard requests a refresh.
- Shows the detected StaffMe Beta Tracker identity and blocks rows when a table has no Agent name or contains multiple identities.
- The dashboard asks new accounts to set contract dates and can link the visible Beta Tracker identity, so rows from multiple Beta Tracker accounts in one browser cannot be mixed into the wrong Time Tracker account.
- Changing or removing the linked Beta Tracker identity clears only the extension's saved Beta Tracker cache; existing Time Tracker hourly rows and other account data remain unchanged. Explicitly linked identities are retained so preserved historical rows can continue syncing safely.
- Notifies the Time Tracker dashboard as soon as usable Beta Tracker data is detected, so first-time identity linking does not require a manual dashboard refresh.
- Shows local connection, setup, and identity status.

### Local testing tools

- On the Beta Tracker page or the Time Tracker dashboard, open DevTools Console and run `SMTrackerAdmin.open()` to open the local admin menu.
- The menu shows the scan source, frame, parsed rows, stored rows, detected worker identity, stored identities, and consent state.
- It can force a scan, clear the saved Beta Tracker hourly data, and create/remove separate synthetic test rows.
- Clearing Beta Tracker hourly data also clears the dashboard account copy after the dashboard creates a recovery point; it does not alter the original Beta Tracker table.
- Synthetic test rows are included in the dashboard only when the menu's test-row option is enabled. They never change the original Beta Tracker data or CB records.

### CB

- Reads only the visible task ID from the CB compliance queue.
- Shows the compact v1.13-style tracker strip fixed at the top of the webpage viewport, with reserved space so page controls remain visible.
- Starts tracking automatically when the first valid task ID appears; the Start button remains available after a manual stop.
- Calculates Task AHT and current-hour average AHT.
- Pauses when the queue closes or its heartbeat stops.
- Resumes when the same task ID returns.
- Starts a new task without recording the paused task when a different task ID returns.
- Keeps multiple CB queue tabs from pausing each other.

The extension does not read passwords, cookies, authentication tokens, general browsing history, private messages, images, or unrelated page content. It does not create demo rows.

## Privacy

The direct privacy policy is:

https://staffmetimetracker.pages.dev/privacy-policy.html

The Beta Tracker data-access notice asks for affirmative permission before reading Beta Tracker hourly data. CB tracking reads only the visible task ID and queue status needed for timing.

## Test installation

1. Download the ZIP and extract it.
2. Open chrome://extensions or edge://extensions.
3. Turn on Developer mode.
4. Choose Load unpacked.
5. Select the extracted folder that contains `manifest.json`.
6. If already installed, click its Reload button.
7. Open the Beta Tracker page and approve the on-page data-access notice.
8. Open the CB queue and use the compact tracker strip.

The dashboard remains empty until real Beta Tracker rows are received. The CB timer remains separate from the Beta Tracker hourly records.
