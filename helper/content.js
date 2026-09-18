(() => {
  const STORAGE_KEY = "staffmeHourlyRows";
  const LAST_SYNC_KEY = "staffmeHourlyLastSync";
  const STATUS_KEY = "staffmeHourlyStatus";
  const PROFILES_KEY = "staffmeHourlyProfilesV1";
  const CONSENT_KEY = "staffmeHelperConsentV1";
  const TEST_ROWS_KEY = "staffmeHourlyTestRows";
  const INCLUDE_TEST_ROWS_KEY = "staffmeHourlyIncludeTestRows";
  const ADMIN_REQUEST_TYPE = "SMTRACKER_ADMIN_ACTION";
  const ADMIN_RESULT_TYPE = "SMTRACKER_ADMIN_RESULT";

  let extensionInvalidated = false;
  let staffMeScanInterval = null;
  let staffMeScanObserver = null;
  let staffMeScanNow = null;
  let adminHost = null;

  function isExtensionContextInvalidated(error) {
    const message = String(error && error.message ? error.message : error || "");
    return /extension context invalidated|context invalidated|receiving end does not exist/i.test(message);
  }

  function stopInvalidatedWork() {
    extensionInvalidated = true;
    staffMeScanNow = null;
    if (staffMeScanInterval !== null) {
      window.clearInterval(staffMeScanInterval);
      staffMeScanInterval = null;
    }
    if (staffMeScanObserver) {
      staffMeScanObserver.disconnect();
      staffMeScanObserver = null;
    }
  }

  function handleExtensionError(error) {
    if (isExtensionContextInvalidated(error)) {
      stopInvalidatedWork();
      return true;
    }
    console.error("[SMTracker]", error);
    return false;
  }

  async function safeStorageGet(keys) {
    if (extensionInvalidated) return null;
    try {
      return await chrome.storage.local.get(keys);
    } catch (error) {
      handleExtensionError(error);
      return null;
    }
  }

  async function safeStorageSet(values) {
    if (extensionInvalidated) return false;
    try {
      await chrome.storage.local.set(values);
      return true;
    } catch (error) {
      handleExtensionError(error);
      return false;
    }
  }

  async function safeStorageRemove(keys) {
    if (extensionInvalidated) return false;
    try {
      await chrome.storage.local.remove(keys);
      return true;
    } catch (error) {
      handleExtensionError(error);
      return false;
    }
  }

  const referrerHost = (() => {
    try {
      return document.referrer ? new URL(document.referrer).hostname : "";
    } catch (error) {
      return "";
    }
  })();

  const ancestorHosts = (() => {
    const hosts = [];
    try {
      Array.from(location.ancestorOrigins || []).forEach((origin) => {
        hosts.push(new URL(origin).hostname);
      });
    } catch (error) {
      // Some frame types do not expose ancestor origins.
    }
    return hosts;
  })();

  const trackerHosts = new Set([
    "staffmetimetracker.pages.dev"
  ]);

  const staffMeHosts = new Set(["script.google.com", "script.googleusercontent.com"]);
  const hasAncestorHost = (hosts) => hosts.some((host) => trackerHosts.has(host));
  const isStaffMeHost = (host) => {
    const normalized = String(host || "").toLowerCase();
    return staffMeHosts.has(normalized) || normalized.endsWith(".script.googleusercontent.com");
  };
  const hasAncestorStaffMeHost = (hosts) => hosts.some(isStaffMeHost);

  const isStaffMePage =
    isStaffMeHost(location.hostname) ||
    isStaffMeHost(referrerHost) ||
    hasAncestorStaffMeHost(ancestorHosts);

  const isTrackerPage =
    trackerHosts.has(location.hostname) ||
    trackerHosts.has(referrerHost) ||
    hasAncestorHost(ancestorHosts);
  const isAdminPage = isStaffMePage || isTrackerPage;

  function clean(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function headerKey(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function numberValue(value) {
    const text = clean(value).replace(",", ".").replace(/[^0-9.-]/g, "");
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }

  function identityKey(value) {
    return clean(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function identityTokens(value) {
    return identityKey(value).split(" ").filter((token) => token.length > 1);
  }

  function identitiesMatch(sourceName, expectedName) {
    const sourceTokens = new Set(identityTokens(sourceName));
    const expectedTokens = identityTokens(expectedName);
    return expectedTokens.length > 0 && expectedTokens.every((token) => sourceTokens.has(token));
  }

  function identityNames(rows) {
    const names = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const name = clean(row && row.agent);
      const key = identityKey(name);
      if (key && !names.has(key)) names.set(key, name);
    });
    return Array.from(names.values());
  }

  function normalizeProfileMap(stored) {
    const profiles = {};
    const addRows = (rows, lastSync) => {
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const name = clean(row && row.agent);
        const key = identityKey(name);
        if (!key || !row || !row.date || !row.time) return;
        if (!profiles[key]) profiles[key] = { identity: name, rows: [], lastSync: null };
        profiles[key].rows.push(row);
        if (lastSync && (!profiles[key].lastSync || new Date(lastSync) > new Date(profiles[key].lastSync))) {
          profiles[key].lastSync = lastSync;
        }
      });
    };

    const saved = stored && stored[PROFILES_KEY];
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      Object.keys(saved).forEach((key) => {
        const profile = saved[key];
        if (!profile || typeof profile !== "object") return;
        const identity = clean(profile.identity || key);
        const normalizedKey = identityKey(identity);
        if (!normalizedKey) return;
        profiles[normalizedKey] = {
          identity,
          rows: dedupe(Array.isArray(profile.rows) ? profile.rows : []),
          lastSync: profile.lastSync || null
        };
      });
    }

    // Migrate the old single shared bucket by splitting it according to the
    // Agent column. This keeps old data usable without mixing identities.
    if (!Object.keys(profiles).length && stored && Array.isArray(stored[STORAGE_KEY])) {
      addRows(stored[STORAGE_KEY], stored[LAST_SYNC_KEY] || null);
      Object.keys(profiles).forEach((key) => {
        profiles[key].rows = dedupe(profiles[key].rows);
      });
    }

    return profiles;
  }

  function profileEntries(profiles) {
    return Object.keys(profiles || {})
      .map((key) => profiles[key])
      .filter((profile) => profile && Array.isArray(profile.rows) && profile.rows.length && profile.identity);
  }

  function profileRowCount(profiles) {
    return profileEntries(profiles).reduce((total, profile) => total + profile.rows.length, 0);
  }

  function selectProfile(profiles, expectedIdentity, activeIdentityKey) {
    const entries = profileEntries(profiles);
    if (!expectedIdentity) {
      if (entries.length === 1) return { profile: entries[0], state: "identified" };
      return { profile: null, state: entries.length > 1 ? "ambiguous" : "none" };
    }

    const matches = entries.filter((profile) => identitiesMatch(profile.identity, expectedIdentity));
    if (matches.length === 1) return { profile: matches[0], state: "matched" };
    if (matches.length > 1) {
      const active = matches.find((profile) => identityKey(profile.identity) === activeIdentityKey);
      return active
        ? { profile: active, state: "matched" }
        : { profile: null, state: "ambiguous" };
    }
    return { profile: null, state: "mismatch" };
  }

  function hasHourlyHeaders(element) {
    const text = clean(element.innerText).toLowerCase();
    const compactText = text.replace(/[^a-z0-9]/g, "");
    const hasHourlyTitle = text.includes("hourly aht");
    const hasWorkedHours = text.includes("worked hours") ||
      text.includes("work hours") ||
      text.includes("hours worked") ||
      text.includes("worked hrs") ||
      text.includes("work hrs") ||
      compactText.includes("workedhours") ||
      compactText.includes("workhours") ||
      compactText.includes("hoursworked") ||
      compactText.includes("workedhrs") ||
      compactText.includes("workhrs");
    const hasEvaluations = text.includes("total evaluations") || text.includes("evaluations");
    return (hasHourlyTitle || hasWorkedHours) &&
      text.includes("time") &&
      (hasEvaluations || hasHourlyTitle);
  }

  function cellsForRow(row) {
    const direct = Array.from(row.children || []).filter((element) => {
      const tag = element.tagName;
      const role = element.getAttribute && element.getAttribute("role");
      return tag === "TD" || tag === "TH" || role === "cell" || role === "gridcell";
    });
    if (direct.length) return direct;

    const descendants = Array.from(row.querySelectorAll(
      "td, th, [role='cell'], [role='gridcell']"
    ));
    if (descendants.length) return descendants;

    return Array.from(row.children || []);
  }

  function rowsForRoot(root) {
    const selectors = [
      "tbody tr",
      "tr",
      "[role='row']"
    ];
    const rows = [];
    const seen = new Set();

    selectors.forEach((selector) => {
      Array.from(root.querySelectorAll(selector)).forEach((row) => {
        if (!seen.has(row) && cellsForRow(row).length >= 2) {
          seen.add(row);
          rows.push(row);
        }
      });
    });

    return rows;
  }

  function findHourlyRoot() {
    // The SM page uses this stable table id. Prefer it because the table is
    // rendered inside the Google-hosted userHtmlFrame iframe and its visible
    // header text can be clipped or renamed by a page update.
    const knownTable = document.querySelector("#attendanceList");
    if (knownTable && (knownTable.matches("table, [role='table']") || rowsForRoot(knownTable).length)) {
      return knownTable;
    }

    const attendancePanel = document.querySelector("#attendancePanel");
    const panelTable = attendancePanel?.querySelector("table, [role='table']");
    if (panelTable) return panelTable;

    const semanticCandidates = Array.from(document.querySelectorAll("table, [role='table']"))
      .filter(hasHourlyHeaders);

    if (semanticCandidates.length) {
      return semanticCandidates.sort((a, b) =>
        clean(a.innerText).length - clean(b.innerText).length
      )[0];
    }

    const panelCandidates = Array.from(document.querySelectorAll("section, article, main, div"))
      .filter((element) => hasHourlyHeaders(element) && rowsForRoot(element).length >= 2);

    if (!panelCandidates.length) return null;

    return panelCandidates.sort((a, b) =>
      clean(a.innerText).length - clean(b.innerText).length
    )[0];
  }

  function headerInfo(root, rows) {
    const explicit = root.querySelector("thead tr, thead [role='row'], [role='rowheader']");
    const possible = explicit || rows.find((row) => {
      const values = cellsForRow(row).map((cell) => headerKey(cell.innerText));
      return values.includes("date") && values.includes("time");
    });
    const headers = possible
      ? cellsForRow(possible).map((cell) => headerKey(cell.innerText))
      : [];
    return { row: possible, headers };
  }

  function columnIndex(headers, names, fallback) {
    const wanted = names.map(headerKey);
    const match = wanted.map((name) => headers.indexOf(name)).find((index) => index >= 0);
    return match === undefined ? fallback : match;
  }

  function readHourlyRows(root) {
    if (!root) return [];

    const rows = rowsForRoot(root);
    const info = headerInfo(root, rows);
    const dateIndex = columnIndex(info.headers, ["date"], 0);
    const timeIndex = columnIndex(info.headers, ["time"], 1);
    const agentIndex = columnIndex(info.headers, ["agent"], 2);
    const workedIndex = columnIndex(info.headers, ["worked hours", "work hours", "hours worked", "worked hrs", "work hrs", "worked", "work"], 3);
    const evaluationsIndex = columnIndex(info.headers, ["total evaluations", "evaluations"], 4);
    const chatIndex = columnIndex(info.headers, ["chat"], 5);
    const idcheckIndex = columnIndex(info.headers, ["idcheck", "id check"], 6);
    const streamIndex = columnIndex(info.headers, ["stream"], 7);

    return rows
      .filter((row) => row !== info.row)
      .map((row) => cellsForRow(row).map((cell) => clean(cell.innerText)))
      .map((cells) => ({
        date: cells[dateIndex] || "",
        time: cells[timeIndex] || "",
        agent: cells[agentIndex] || "",
        workedHours: numberValue(cells[workedIndex]),
        evaluations: numberValue(cells[evaluationsIndex]),
        chat: numberValue(cells[chatIndex]),
        idcheck: numberValue(cells[idcheckIndex]),
        stream: numberValue(cells[streamIndex])
      }))
      .filter((row) => row.date && row.time);
  }

  function rowKey(row) {
    return [
      row.date,
      row.time,
      row.workedHours,
      row.evaluations,
      row.chat,
      row.idcheck,
      row.stream
    ].join("|");
  }

  function dedupe(rows) {
    const map = new Map();
    rows.forEach((row) => map.set(rowKey(row), row));
    return Array.from(map.values());
  }

  function postStatus(status) {
    window.postMessage({
      type: "STAFFME_HELPER_STATUS",
      ...status
    }, "*");
  }


  async function getStoredConsent() {
    const stored = await safeStorageGet(CONSENT_KEY);
    return Boolean(stored && stored[CONSENT_KEY] === true);
  }

  function signalConsentToPageHook() {
    window.postMessage({
      type: "STAFFME_HELPER_CONSENT_GRANTED"
    }, "*");
  }

  function showConsentPrompt() {
    return new Promise((resolve) => {
      const host = document.createElement("div");
      host.id = "smtracker-consent-prompt";
      host.style.position = "fixed";
      host.style.inset = "0";
      host.style.zIndex = "2147483647";

      const shadow = host.attachShadow({ mode: "closed" });
      shadow.innerHTML = [
        "<style>",
        ":host{all:initial;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
        ".backdrop{align-items:center;background:rgba(15,29,52,.42);display:flex;inset:0;justify-content:center;padding:20px;position:fixed}",
        ".dialog{background:#fff;border:1px solid #d8e2ed;border-radius:16px;box-shadow:0 18px 48px rgba(15,29,52,.25);color:#18263f;max-width:480px;padding:24px;width:100%}",
        ".eyebrow{color:#078eae;font-size:11px;font-weight:800;letter-spacing:.12em;margin-bottom:8px;text-transform:uppercase}",
        "h2{font-size:21px;line-height:1.25;margin:0 0 12px}",
        "p{font-size:14px;line-height:1.55;margin:10px 0}",
        ".muted{color:#596a82}",
        "a{color:#087c9c;font-weight:700}",
        ".buttons{display:flex;gap:10px;justify-content:flex-end;margin-top:20px}",
        "button{border:0;border-radius:9px;cursor:pointer;font:600 14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:11px 15px}",
        ".decline{background:#edf2f7;color:#26354d}",
        ".allow{background:#243957;color:#fff}",
        "</style>",
        "<div class='backdrop'>",
        "<section class='dialog' role='dialog' aria-modal='true' aria-labelledby='smtracker-consent-title'>",
        "<div class='eyebrow'>SMTracker by B. Belicario</div>",
        "<h2 id='smtracker-consent-title'>Allow time-tracking data access?</h2>",
        "<p>SMTracker reads the visible SM hourly table to calculate your work hours. It stores the rows in this browser and makes them available to your SMTracker dashboard when you refresh data.</p>",
        "<p class='muted'>It does not read passwords or cookies. Read the <a href='https://staffmetimetracker.pages.dev/privacy-policy.html' target='_blank' rel='noopener'>privacy policy</a> before continuing.</p>",
        "<div class='buttons'>",
        "<button class='decline' type='button' data-action='decline'>Not now</button>",
        "<button class='allow' type='button' data-action='allow'>Allow and continue</button>",
        "</div>",
        "</section>",
        "</div>"
      ].join("");

      const finish = (allowed) => {
        host.remove();
        resolve(allowed);
      };

      shadow.querySelector("[data-action='decline']").addEventListener("click", () => finish(false));
      shadow.querySelector("[data-action='allow']").addEventListener("click", () => finish(true));
      shadow.addEventListener("keydown", (event) => {
        if (event.key === "Escape") finish(false);
      });

      (document.body || document.documentElement).appendChild(host);
      shadow.querySelector("[data-action='allow']").focus();
    });
  }

  function adminDateDefault() {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(new Date());
  }

  function adminTimeDefault() {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date());
  }

  function adminFrameLabel() {
    if (isTrackerPage) return window.top === window ? "Top SMTracker dashboard" : "SMTracker dashboard iframe";
    return window.top === window ? "Top SM page" : "SM page iframe";
  }

  function notifyTrackerDataRefresh(replaceExisting) {
    if (!isTrackerPage || extensionInvalidated) return;
    window.postMessage({
      type: "SMTRACKER_EXTENSION_REFRESH",
      replaceExisting: replaceExisting === true
    }, "*");
  }

  function notifyDashboardDataCleared() {
    if (!isTrackerPage || extensionInvalidated) return;
    window.postMessage({ type: "SMTRACKER_CLEAR_DASHBOARD_DATA" }, "*");
  }

  async function getAdminSnapshot() {
    const stored = await safeStorageGet([
      PROFILES_KEY,
      STORAGE_KEY,
      LAST_SYNC_KEY,
      STATUS_KEY,
      CONSENT_KEY,
      TEST_ROWS_KEY,
      INCLUDE_TEST_ROWS_KEY
    ]);
    if (!stored) return null;

    const profiles = normalizeProfileMap(stored);
    const realRows = profileEntries(profiles).reduce((rows, profile) => rows.concat(profile.rows), []);
    const testRows = Array.isArray(stored[TEST_ROWS_KEY]) ? stored[TEST_ROWS_KEY] : [];
    const includeTestRows = stored[INCLUDE_TEST_ROWS_KEY] === true;
    const status = stored[STATUS_KEY] && typeof stored[STATUS_KEY] === "object"
      ? stored[STATUS_KEY]
      : {};

    return {
      consent: stored[CONSENT_KEY] === true,
      realRows: realRows.length,
      testRows: testRows.length,
      dashboardRows: realRows.length + (includeTestRows ? testRows.length : 0),
      identities: profileEntries(profiles).map((profile) => profile.identity),
      activeIdentity: clean(status.identity),
      identityState: clean(status.identityState) || "none",
      includeTestRows,
      tableFound: Boolean(status.tableFound),
      parsedRows: Number(status.parsedRows) || 0,
      source: clean(status.source) || "—",
      scannedAt: status.scannedAt || null,
      frame: adminFrameLabel()
    };
  }

  function adminStatusTime(value) {
    if (!value) return "Never";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
  }

  function postAdminResult(requestId, result, error) {
    if (!requestId) return;
    window.postMessage({
      type: ADMIN_RESULT_TYPE,
      requestId,
      ok: !error,
      result: result || null,
      error: error ? String(error.message || error) : null
    }, "*");
  }

  async function performAdminAction(action, payload) {
    if (action === "status") {
      return getAdminSnapshot();
    }

    if (action === "forceScan") {
      if (!staffMeScanNow) throw new Error("The SM scanner is not ready in this frame.");
      await staffMeScanNow(true);
      return getAdminSnapshot();
    }

    if (action === "clearRows") {
      const ok = await safeStorageRemove([
        PROFILES_KEY,
        STORAGE_KEY,
        LAST_SYNC_KEY,
        STATUS_KEY,
        TEST_ROWS_KEY,
        INCLUDE_TEST_ROWS_KEY
      ]);
      if (!ok) throw new Error("Could not clear the local SM rows.");
      notifyDashboardDataCleared();
      return getAdminSnapshot();
    }

    if (action === "removeTestRows") {
      const ok = await safeStorageRemove([TEST_ROWS_KEY, INCLUDE_TEST_ROWS_KEY]);
      if (!ok) throw new Error("Could not remove the test rows.");
      notifyTrackerDataRefresh();
      return getAdminSnapshot();
    }

    if (action === "includeTestRows") {
      const ok = await safeStorageSet({
        [INCLUDE_TEST_ROWS_KEY]: Boolean(payload && payload.enabled)
      });
      if (!ok) throw new Error("Could not update test-row display mode.");
      notifyTrackerDataRefresh();
      return getAdminSnapshot();
    }

    if (action === "addTestRow") {
      const date = clean(payload && payload.date);
      const time = clean(payload && payload.time);
      if (!date || !time) throw new Error("Enter both a date and a time.");
      if (!/^\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]m)?$/i.test(time)) {
        throw new Error("Use a time such as 10:00 AM or 22:00.");
      }

      const testRow = {
        date,
        time,
        agent: "SMTracker Test",
        workedHours: numberValue(payload && payload.workedHours),
        evaluations: 0,
        chat: 0,
        idcheck: 0,
        stream: 0,
        test: true
      };
      const stored = await safeStorageGet(TEST_ROWS_KEY);
      if (!stored) throw new Error("Could not read the local test rows.");
      const existing = Array.isArray(stored[TEST_ROWS_KEY]) ? stored[TEST_ROWS_KEY] : [];
      if (existing.some((row) => rowKey(row) === rowKey(testRow))) {
        throw new Error("That test row already exists.");
      }

      const ok = await safeStorageSet({
        [TEST_ROWS_KEY]: existing.concat(testRow),
        [INCLUDE_TEST_ROWS_KEY]: true
      });
      if (!ok) throw new Error("Could not save the test row.");
      notifyTrackerDataRefresh();
      return getAdminSnapshot();
    }

    throw new Error("Unknown SMTracker admin action.");
  }

  async function refreshAdminMenu(message) {
    try {
      if (!adminHost || extensionInvalidated) return;
      const shadow = adminHost.shadowRoot;
      const snapshot = await getAdminSnapshot();
      if (!snapshot || !shadow) return;

      shadow.querySelector("[data-value='realRows']").textContent = String(snapshot.realRows);
      shadow.querySelector("[data-value='testRows']").textContent = String(snapshot.testRows);
      shadow.querySelector("[data-value='dashboardRows']").textContent = String(snapshot.dashboardRows);
      shadow.querySelector("[data-value='consent']").textContent = snapshot.consent ? "Granted" : "Not granted";
      shadow.querySelector("[data-value='table']").textContent = snapshot.tableFound ? "Found" : "Not found";
      shadow.querySelector("[data-value='parsed']").textContent = String(snapshot.parsedRows);
      shadow.querySelector("[data-value='source']").textContent = snapshot.source;
      shadow.querySelector("[data-value='scanned']").textContent = adminStatusTime(snapshot.scannedAt);
      shadow.querySelector("[data-value='identity']").textContent = snapshot.activeIdentity || "—";
      shadow.querySelector("[data-value='identityState']").textContent = snapshot.identityState || "—";
      shadow.querySelector("[data-value='identities']").textContent = snapshot.identities.length ? snapshot.identities.join(", ") : "—";
      shadow.querySelector("[data-value='frame']").textContent = snapshot.frame;
      shadow.querySelector("[data-action='include-test']").checked = snapshot.includeTestRows;

      if (message) {
        const messageElement = shadow.querySelector("[data-role='message']");
        messageElement.textContent = message.text;
        messageElement.className = message.error ? "message error" : "message success";
      }
    } catch (error) {
      handleExtensionError(error);
    }
  }

  function closeAdminMenu() {
    if (!adminHost) return;
    adminHost.remove();
    adminHost = null;
  }

  function showAdminMenu() {
    if (adminHost) {
      refreshAdminMenu();
      return;
    }

    adminHost = document.createElement("div");
    adminHost.id = "smtracker-admin-host";
    adminHost.style.position = "fixed";
    adminHost.style.inset = "0";
    adminHost.style.zIndex = "2147483646";
    adminHost.style.pointerEvents = "none";

    const shadow = adminHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        * { box-sizing: border-box; }
        .wrap { position: fixed; top: 16px; right: 16px; width: min(370px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; pointer-events: auto; }
        .panel { color: #eaf2fb; background: #111820; border: 1px solid #3b4b5f; border-radius: 14px; box-shadow: 0 18px 50px rgba(0,0,0,.35); padding: 16px; }
        .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .title { font-size: 16px; font-weight: 800; }
        .subtitle { color: #91a2b5; font-size: 11px; margin-top: 3px; }
        button { border: 0; border-radius: 8px; color: #f7fbff; background: #304052; cursor: pointer; font: 700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 9px 10px; }
        button:hover { filter: brightness(1.15); }
        button.primary { background: #1f6feb; }
        button.danger { background: #9f302d; }
        button.icon { background: transparent; color: #91a2b5; font-size: 20px; line-height: 1; padding: 0 4px; }
        .notice { color: #b9c7d6; background: #1b2735; border-radius: 8px; font-size: 11px; line-height: 1.4; margin: 14px 0; padding: 9px 10px; }
        .section-title { color: #79c5ff; font-size: 10px; font-weight: 800; letter-spacing: .08em; margin: 14px 0 7px; text-transform: uppercase; }
        .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
        .stat { background: #19222d; border: 1px solid #2b3948; border-radius: 8px; padding: 8px; }
        .stat span { color: #91a2b5; display: block; font-size: 10px; }
        .stat strong { display: block; font: 800 17px Consolas, monospace; margin-top: 3px; }
        dl { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 5px 8px; margin: 0; }
        dt { color: #91a2b5; font-size: 10px; }
        dd { color: #eaf2fb; font: 700 10px Consolas, monospace; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .form { display: grid; grid-template-columns: 1.15fr .85fr .65fr; gap: 7px; }
        label { color: #91a2b5; display: grid; font-size: 10px; gap: 4px; }
        input { min-width: 0; border: 1px solid #3b4b5f; border-radius: 7px; color: #f7fbff; background: #0c1218; font: 700 11px Consolas, monospace; padding: 8px; }
        .check { align-items: center; display: flex; grid-template-columns: none; gap: 7px; margin-top: 10px; }
        .check input { accent-color: #1f6feb; }
        .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 9px; }
        .message { font-size: 10px; line-height: 1.35; min-height: 14px; margin-top: 9px; }
        .message.success { color: #56e39f; }
        .message.error { color: #ff887f; }
        .foot { color: #71849a; font-size: 10px; line-height: 1.35; margin-top: 12px; }
      </style>
      <div class="wrap">
        <section class="panel" role="dialog" aria-label="SMTracker admin tools">
          <div class="header">
            <div><div class="title">SMTracker Admin</div><div class="subtitle">Local testing tools</div></div>
            <button class="icon" data-action="close" title="Close">×</button>
          </div>
          <div class="notice">These tools do not change the original SM data or CB tracking. Clearing SM hourly data also clears the rows saved in this SMTracker account.</div>
          <div class="section-title">Storage</div>
          <div class="stats">
            <div class="stat"><span>Real rows</span><strong data-value="realRows">—</strong></div>
            <div class="stat"><span>Test rows</span><strong data-value="testRows">—</strong></div>
            <div class="stat"><span>Dashboard rows</span><strong data-value="dashboardRows">—</strong></div>
          </div>
          <div class="section-title">Diagnostics</div>
          <dl>
            <dt>Consent</dt><dd data-value="consent">—</dd>
            <dt>Table</dt><dd data-value="table">—</dd>
            <dt>Parsed rows</dt><dd data-value="parsed">—</dd>
            <dt>Source</dt><dd data-value="source">—</dd>
            <dt>Last scan</dt><dd data-value="scanned">—</dd>
            <dt>Detected worker</dt><dd data-value="identity">—</dd>
            <dt>Identity state</dt><dd data-value="identityState">—</dd>
            <dt>Stored identities</dt><dd data-value="identities">—</dd>
            <dt>Frame</dt><dd data-value="frame">—</dd>
          </dl>
          <div class="section-title">Test row</div>
          <div class="form">
            <label>Date<input data-field="date" value="${adminDateDefault()}" autocomplete="off"></label>
            <label>Time<input data-field="time" value="${adminTimeDefault()}" autocomplete="off"></label>
            <label>Work hours<input data-field="workedHours" value="1.00" inputmode="decimal"></label>
          </div>
          <label class="check"><input type="checkbox" data-action="include-test"> Include test rows in dashboard</label>
          <div class="actions">
            <button class="primary" data-action="add-test">Add test row</button>
            <button data-action="remove-tests">Remove test rows</button>
          </div>
          <div class="actions">
            <button data-action="scan">Force SM scan</button>
            <button class="danger" data-action="clear">Clear SM hourly data</button>
          </div>
          <div class="message" data-role="message"></div>
          <div class="foot">Test rows are kept separately and are included in the dashboard only when enabled.</div>
        </section>
      </div>
    `;

    const run = async (action, payload, successText) => {
      try {
        await performAdminAction(action, payload);
        await refreshAdminMenu({ text: successText, error: false });
      } catch (error) {
        await refreshAdminMenu({ text: String(error.message || error), error: true });
      }
    };

    shadow.querySelector("[data-action='close']").addEventListener("click", () => {
      closeAdminMenu();
    });
    shadow.querySelector("[data-action='include-test']").addEventListener("change", (event) => {
      run("includeTestRows", { enabled: event.target.checked }, "Test-row display updated.");
    });
    shadow.querySelector("[data-action='add-test']").addEventListener("click", () => {
      run("addTestRow", {
        date: shadow.querySelector("[data-field='date']").value,
        time: shadow.querySelector("[data-field='time']").value,
        workedHours: shadow.querySelector("[data-field='workedHours']").value
      }, "Test row added.");
    });
    shadow.querySelector("[data-action='remove-tests']").addEventListener("click", () => {
      if (confirm("Remove all SMTracker test rows?")) run("removeTestRows", null, "Test rows removed.");
    });
    shadow.querySelector("[data-action='scan']").addEventListener("click", () => {
      run("forceScan", null, "SM scan completed.");
    });
    shadow.querySelector("[data-action='clear']").addEventListener("click", () => {
      if (confirm("Clear all saved SM hourly data, including test rows?")) run("clearRows", null, "SM hourly data cleared.");
    });

    (document.body || document.documentElement).appendChild(adminHost);
    refreshAdminMenu();
  }

  async function ensureStaffMeConsent() {
    if (await getStoredConsent()) {
      signalConsentToPageHook();
      return true;
    }

    if (extensionInvalidated) return false;

    if (window.top !== window) {
      return new Promise((resolve) => {
        if (extensionInvalidated) {
          resolve(false);
          return;
        }
        const onChanged = (changes, areaName) => {
          if (areaName !== "local" || !changes[CONSENT_KEY] || changes[CONSENT_KEY].newValue !== true) {
            return;
          }
          try {
            chrome.storage.onChanged.removeListener(onChanged);
          } catch (error) {
            handleExtensionError(error);
            resolve(false);
            return;
          }
          signalConsentToPageHook();
          resolve(true);
        };
        try {
          chrome.storage.onChanged.addListener(onChanged);
        } catch (error) {
          handleExtensionError(error);
          resolve(false);
        }
      });
    }

    const allowed = await showConsentPrompt();
    if (!allowed) return false;

    if (!(await safeStorageSet({ [CONSENT_KEY]: true }))) return false;
    signalConsentToPageHook();
    return true;
  }

  async function storeRows(rows, tableFound) {
    if (!(await getStoredConsent())) return;

    const normalizedRows = (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.date && row.time)
      .map((row) => ({
        date: clean(row.date),
        time: clean(row.time),
        agent: clean(row.agent),
        workedHours: numberValue(row.workedHours),
        evaluations: numberValue(row.evaluations),
        chat: numberValue(row.chat),
        idcheck: numberValue(row.idcheck),
        stream: numberValue(row.stream)
      }));

    const current = await safeStorageGet([
      PROFILES_KEY,
      STORAGE_KEY,
      LAST_SYNC_KEY
    ]);
    if (!current) return;
    const now = new Date().toISOString();
    const profiles = normalizeProfileMap(current);
    const names = identityNames(normalizedRows);
    const missingIdentity = normalizedRows.some((row) => !identityKey(row.agent));
    const identityState = missingIdentity ? "missing" : names.length === 0 ? "none" : names.length === 1 ? "identified" : "ambiguous";

    if (!normalizedRows.length || identityState !== "identified") {
      const status = {
        installed: true,
        tableFound: Boolean(tableFound),
        parsedRows: normalizedRows.length,
        storedRows: profileRowCount(profiles),
        source: normalizedRows.length ? "staffme-network" : "staffme-dom",
        scannedAt: now,
        identity: names.length === 1 ? names[0] : "",
        identityKey: names.length === 1 ? identityKey(names[0]) : "",
        identityState,
        observedIdentities: names,
        blocked: Boolean(normalizedRows.length),
        blockedReason: missingIdentity ? "missing-agent" : names.length > 1 ? "multiple-agents" : "no-rows"
      };
      await safeStorageSet({ [STATUS_KEY]: status });
      postStatus(status);
      return;
    }

    const identity = names[0];
    const key = identityKey(identity);
    const existing = profiles[key] || { identity, rows: [], lastSync: null };
    const merged = dedupe(existing.rows.concat(normalizedRows));
    profiles[key] = {
      identity: existing.identity || identity,
      rows: merged,
      lastSync: now
    };
    const status = {
      installed: true,
      tableFound: Boolean(tableFound),
      parsedRows: normalizedRows.length,
      storedRows: profileRowCount(profiles),
      source: normalizedRows.length ? "staffme-network" : "staffme-dom",
      scannedAt: now,
      identity: profiles[key].identity,
      identityKey: key,
      identityState: "identified",
      observedIdentities: profileEntries(profiles).map((profile) => profile.identity),
      blocked: false,
      blockedReason: ""
    };

    if (!(await safeStorageSet({
      [PROFILES_KEY]: profiles,
      [LAST_SYNC_KEY]: normalizedRows.length ? now : (current[LAST_SYNC_KEY] || null),
      [STATUS_KEY]: status
    }))) return;

    await safeStorageRemove([STORAGE_KEY]);

    postStatus(status);
  }

  async function scanStaffMe(root) {
    await storeRows(readHourlyRows(root), Boolean(root));
  }

  if (isAdminPage) {
    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type === "SMTRACKER_ADMIN_OPEN") {
        showAdminMenu();
        return;
      }
      if (event.data.type === "SMTRACKER_ADMIN_CLOSE") {
        closeAdminMenu();
        return;
      }
      if (event.data.type === ADMIN_REQUEST_TYPE) {
        performAdminAction(event.data.action, event.data.payload)
          .then((result) => postAdminResult(event.data.requestId, result, null))
          .catch((error) => {
            handleExtensionError(error);
            postAdminResult(event.data.requestId, null, error);
          });
        return;
      }
      if (event.data.type === "SMTRACKER_CLEAR_LOCAL_SM_ROWS") {
        safeStorageRemove([PROFILES_KEY, STORAGE_KEY, LAST_SYNC_KEY, STATUS_KEY])
          .then((ok) => {
            window.postMessage({
              type: "SMTRACKER_CLEAR_LOCAL_SM_ROWS_RESULT",
              requestId: event.data.requestId || null,
              ok: Boolean(ok),
              error: ok ? null : "Could not clear the local SM rows."
            }, "*");
          })
          .catch((error) => {
            handleExtensionError(error);
            window.postMessage({
              type: "SMTRACKER_CLEAR_LOCAL_SM_ROWS_RESULT",
              requestId: event.data.requestId || null,
              ok: false,
              error: String(error && error.message || error || "Could not clear the local SM rows.")
            }, "*");
          });
        return;
      }
      if (event.data.type !== "STAFFME_NETWORK_ROWS" || !isStaffMePage) return;
      storeRows(event.data.rows || [], true).catch(handleExtensionError);
    });
  }

  if (isStaffMePage) {
    (async () => {
      try {
        const allowed = await ensureStaffMeConsent();
        if (!allowed) {
          if (!extensionInvalidated) {
            await safeStorageSet({
              [STATUS_KEY]: {
                installed: true,
                tableFound: false,
                parsedRows: 0,
                storedRows: 0,
                awaitingConsent: true
              }
            });
          }
          return;
        }

        window.postMessage({ type: "STAFFME_REQUEST_NETWORK_DATA" }, "*");

        let lastSignature = "";
        const scan = async (force = false) => {
          if (extensionInvalidated) return;
          try {
            const root = findHourlyRoot();
            const rows = root ? readHourlyRows(root) : [];
            const signature = root && rows.length
              ? rows.map(rowKey).join("\n")
              : "";
            if (!root || !signature || (!force && signature === lastSignature)) {
              // Keep the last successful signature while the table is briefly
              // empty during a page redraw; do not replace stored rows with none.
              return;
            }
            lastSignature = signature;
            await storeRows(rows, true);
          } catch (error) {
            handleExtensionError(error);
          }
        };

        staffMeScanNow = scan;
        window.setTimeout(() => scan(), 1500);
        staffMeScanInterval = window.setInterval(() => scan(), 2500);
        staffMeScanObserver = new MutationObserver(() => scan());
        staffMeScanObserver.observe(document.documentElement, {
          subtree: true,
          childList: true,
          characterData: true
        });
      } catch (error) {
        handleExtensionError(error);
      }
    })();
  }

  if (isTrackerPage) {
    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type !== "STAFFME_REQUEST_DATA") return;

      (async () => {
        try {
          const stored = await safeStorageGet([
            PROFILES_KEY,
            STORAGE_KEY,
            LAST_SYNC_KEY,
            STATUS_KEY,
            CONSENT_KEY,
            TEST_ROWS_KEY,
            INCLUDE_TEST_ROWS_KEY
          ]);
          if (!stored || extensionInvalidated) return;
          const hasConsent = stored[CONSENT_KEY] === true;
          const profiles = hasConsent ? normalizeProfileMap(stored) : {};
          const storedStatus = stored[STATUS_KEY] && typeof stored[STATUS_KEY] === "object"
            ? stored[STATUS_KEY]
            : {};
          const expectedIdentity = clean(event.data.expectedSmIdentity);
          const availableProfiles = profileEntries(profiles);
          const selection = selectProfile(profiles, expectedIdentity, clean(storedStatus.identityKey));
          const activeIdentity = clean(storedStatus.identity);
          const activeIdentityMismatch = Boolean(expectedIdentity && activeIdentity) && !identitiesMatch(activeIdentity, expectedIdentity);
          const identityMismatch = Boolean(expectedIdentity) && (selection.state !== "matched" || activeIdentityMismatch);
          const identityAmbiguous = selection.state === "ambiguous";
          const realRows = hasConsent && !identityMismatch && !identityAmbiguous && selection.profile
            ? selection.profile.rows
            : [];
          const includeTestRows = hasConsent && stored[INCLUDE_TEST_ROWS_KEY] === true;
          const testRows = includeTestRows && !identityMismatch && !identityAmbiguous && Array.isArray(stored[TEST_ROWS_KEY])
            ? stored[TEST_ROWS_KEY]
            : [];
          const rows = realRows.concat(testRows);
          const observedForDashboard = identityMismatch && activeIdentity
            ? [activeIdentity]
            : availableProfiles.map((profile) => profile.identity);
          const responseStatus = hasConsent
            ? {
                ...storedStatus,
                installed: true,
                storedRows: profileRowCount(profiles),
                realRows: realRows.length,
                testRows: testRows.length,
                testRowsIncluded: testRows.length > 0,
                dashboardIdentity: expectedIdentity,
                identityMatched: !identityMismatch && !identityAmbiguous && Boolean(selection.profile || !expectedIdentity),
                identityMismatch,
                identityAmbiguous,
                availableIdentities: observedForDashboard
              }
            : {
                installed: true,
                tableFound: false,
                parsedRows: 0,
                storedRows: 0,
                awaitingConsent: true,
                dashboardIdentity: expectedIdentity,
                identityMatched: false,
                identityMismatch: false,
                identityAmbiguous: false,
                availableIdentities: []
              };

          await safeStorageSet({ [STATUS_KEY]: responseStatus });

          window.postMessage({
            type: "STAFFME_HOURLY_DATA",
            rows,
            replaceExisting: event.data.replaceExisting === true,
            lastSync: hasConsent
              ? ((selection.profile && selection.profile.lastSync) || stored[LAST_SYNC_KEY] || null)
              : null,
            identityMismatch,
            identityAmbiguous,
            expectedSmIdentity: expectedIdentity,
            observedSmIdentity: storedStatus.identity || "",
            observedIdentities: responseStatus.availableIdentities,
            helperStatus: responseStatus
          }, "*");
        } catch (error) {
          handleExtensionError(error);
        }
      })();
    });

    window.setTimeout(() => {
      window.postMessage({ type: "SMTRACKER_EXTENSION_REFRESH" }, "*");
    }, 900);
  }
})();
