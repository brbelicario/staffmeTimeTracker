(() => {
  const STORAGE_KEY = "staffmeHourlyRows";
  const LAST_SYNC_KEY = "staffmeHourlyLastSync";
  const STATUS_KEY = "staffmeHourlyStatus";
  const CONSENT_KEY = "staffmeHelperConsentV1";

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
  const hasAncestorStaffMeHost = (hosts) => hosts.some((host) => staffMeHosts.has(host));

  const isStaffMePage =
    staffMeHosts.has(location.hostname) ||
    staffMeHosts.has(referrerHost) ||
    hasAncestorStaffMeHost(ancestorHosts);

  const isTrackerPage =
    trackerHosts.has(location.hostname) ||
    trackerHosts.has(referrerHost) ||
    hasAncestorHost(ancestorHosts);

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

  function hasHourlyHeaders(element) {
    const text = clean(element.innerText).toLowerCase();
    return text.includes("worked hours") &&
      text.includes("time") &&
      (text.includes("total evaluations") || text.includes("evaluations"));
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
    const explicit = root.querySelector("thead tr, [role='rowheader']");
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
    const workedIndex = columnIndex(info.headers, ["worked hours", "worked"], 3);
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
    const stored = await chrome.storage.local.get(CONSENT_KEY);
    return stored[CONSENT_KEY] === true;
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
        "<p>SMTracker reads the visible StaffMe hourly table to calculate your work hours. It stores the rows in this browser and makes them available to your SMTracker dashboard when you refresh data.</p>",
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

  async function ensureStaffMeConsent() {
    if (await getStoredConsent()) {
      signalConsentToPageHook();
      return true;
    }

    if (window.top !== window) {
      return new Promise((resolve) => {
        const onChanged = (changes, areaName) => {
          if (areaName !== "local" || !changes[CONSENT_KEY] || changes[CONSENT_KEY].newValue !== true) {
            return;
          }
          chrome.storage.onChanged.removeListener(onChanged);
          signalConsentToPageHook();
          resolve(true);
        };
        chrome.storage.onChanged.addListener(onChanged);
      });
    }

    const allowed = await showConsentPrompt();
    if (!allowed) return false;

    await chrome.storage.local.set({ [CONSENT_KEY]: true });
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

    const current = await chrome.storage.local.get([
      STORAGE_KEY,
      LAST_SYNC_KEY
    ]);
    const merged = dedupe((current[STORAGE_KEY] || []).concat(normalizedRows));
    const now = new Date().toISOString();
    const status = {
      installed: true,
      tableFound: Boolean(tableFound),
      parsedRows: normalizedRows.length,
      storedRows: merged.length,
      source: normalizedRows.length ? "staffme-network" : "staffme-dom",
      scannedAt: now
    };

    await chrome.storage.local.set({
      [STORAGE_KEY]: merged,
      [LAST_SYNC_KEY]: normalizedRows.length ? now : (current[LAST_SYNC_KEY] || null),
      [STATUS_KEY]: status
    });

    postStatus(status);
  }

  async function scanStaffMe(root) {
    await storeRows(readHourlyRows(root), Boolean(root));
  }

  if (isStaffMePage) {
    window.addEventListener("message", async (event) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type !== "STAFFME_NETWORK_ROWS") return;
      await storeRows(event.data.rows || [], true);
    });

    (async () => {
      const allowed = await ensureStaffMeConsent();
      if (!allowed) {
        await chrome.storage.local.set({
          [STATUS_KEY]: {
            installed: true,
            tableFound: false,
            parsedRows: 0,
            storedRows: 0,
            awaitingConsent: true
          }
        });
        return;
      }

      window.postMessage({ type: "STAFFME_REQUEST_NETWORK_DATA" }, "*");

      let lastText = "";
      const scan = async () => {
        const root = findHourlyRoot();
        const text = root ? clean(root.innerText) : "";
        if (text && text !== lastText) {
          lastText = text;
          await scanStaffMe(root);
        }
      };

      window.setTimeout(scan, 1500);
      window.setInterval(scan, 2500);
      new MutationObserver(scan).observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true
      });
    })();
  }

  if (isTrackerPage) {
    window.addEventListener("message", async (event) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type !== "STAFFME_REQUEST_DATA") return;

      const stored = await chrome.storage.local.get([
        STORAGE_KEY,
        LAST_SYNC_KEY,
        STATUS_KEY,
        CONSENT_KEY
      ]);
      const hasConsent = stored[CONSENT_KEY] === true;
      const rows = hasConsent ? (stored[STORAGE_KEY] || []) : [];

      window.postMessage({
        type: "STAFFME_HOURLY_DATA",
        rows,
        lastSync: hasConsent ? (stored[LAST_SYNC_KEY] || null) : null,
        helperStatus: hasConsent
          ? (stored[STATUS_KEY] || {
              installed: true,
              tableFound: false,
              parsedRows: 0,
              storedRows: rows.length
            })
          : {
              installed: true,
              tableFound: false,
              parsedRows: 0,
              storedRows: 0,
              awaitingConsent: true
            }
      }, "*");
    });

    window.setTimeout(() => {
      window.postMessage({ type: "STAFFME_REQUEST_DATA" }, "*");
    }, 900);
  }
})();
