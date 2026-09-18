# SMTracker by B. Belicario

Manifest V3 Chrome/Edge extension for the SM work-hour tracker and CB compliance task timer.

## What it does

### SM

- Reads the visible SM “Hourly AHT (Last 5 Days)” table after you approve the on-page data-access notice.
- Supports the framed preview page, including random Google-hosted frame subdomains, and standard HTML table/row layouts.
- Stores normalized hourly rows in the browser's local extension storage.
- Makes those rows available to the SMTracker dashboard when the dashboard requests a refresh.
- The dashboard asks new accounts to set contract dates and can link the visible SM worker name, so rows from multiple SM accounts in one browser are kept with the correct tracker account.
- Shows local connection and setup status.

### Local testing tools

- On an SM page or the SMTracker dashboard, open DevTools Console and run `SMTrackerAdmin.open()` to open the local admin menu.
- The menu shows the scan source, frame, parsed rows, stored rows, and consent state.
- It can force a scan, clear the saved SM hourly data, and create/remove separate synthetic test rows.
- Clearing SM hourly data also clears the dashboard account copy; it does not alter the original SM table.
- Synthetic test rows are included in the dashboard only when the menu's test-row option is enabled. They never change the original SM data or CB records.

### CB

- Reads only the visible task ID from the CB compliance queue.
- Shows the compact v1.13-style tracker strip fixed at the top of the webpage viewport, with reserved space so page controls remain visible.
- Calculates Task AHT and current-hour average AHT.
- Pauses when the queue closes or its heartbeat stops.
- Resumes when the same task ID returns.
- Starts a new task without recording the paused task when a different task ID returns.
- Keeps multiple CB queue tabs from pausing each other.

The extension does not read passwords, cookies, authentication tokens, general browsing history, private messages, images, or unrelated page content. It does not create demo rows.

## Privacy

The direct privacy policy is:

https://staffmetimetracker.pages.dev/privacy-policy.html

The SM data-access notice asks for affirmative permission before reading SM hourly data. CB tracking reads only the visible task ID and queue status needed for timing.

## Test installation

1. Download the ZIP and extract it.
2. Open chrome://extensions or edge://extensions.
3. Turn on Developer mode.
4. Choose Load unpacked.
5. Select the extracted folder that contains `manifest.json`.
6. If already installed, click its Reload button.
7. Open the SM page and approve the on-page data-access notice.
8. Open the CB queue and use the compact tracker strip.

The dashboard remains empty until real SM rows are received. The CB timer remains separate from the SM hourly records.
