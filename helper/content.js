(() => {
  const STORAGE_KEY = "staffmeHourlyRows";
  const LAST_SYNC_KEY = "staffmeHourlyLastSync";
  const isStaffMePage = location.hostname === "script.google.com";
  const isTrackerPage = location.hostname === "htmlpreview.github.io" || location.hostname === "brbelicario.github.io";

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function headerKey(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function numberValue(value) {
    const number = Number(clean(value).replace(",", ".").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function findHourlyTable() {
    const tables = Array.from(document.querySelectorAll("table"));
    return tables.find((table) => {
      const text = clean(table.innerText).toLowerCase();
      return text.includes("worked hours") &&
        text.includes("total evaluations") &&
        text.includes("time");
    }) || null;
  }

  function readHeaders(table) {
    const row = table.querySelector("thead tr") || table.querySelector("tr");
    if (!row) return [];
    return Array.from(row.querySelectorAll("th,td")).map((cell) => headerKey(cell.innerText));
  }

  function readHourlyRows() {
    const table = findHourlyTable();
    if (!table) return [];

    const headers = readHeaders(table);
    const rows = Array.from(table.querySelectorAll("tbody tr")).length
      ? Array.from(table.querySelectorAll("tbody tr"))
      : Array.from(table.querySelectorAll("tr")).slice(1);

    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll("td,th")).map((cell) => clean(cell.innerText));
      const value = (names, fallback) => {
        const index = names.map(headerKey).map((name) => headers.indexOf(name)).find((index) => index >= 0);
        return index === undefined ? fallback : cells[index];
      };

      return {
        date: value(["date"], ""),
        time: value(["time"], ""),
        agent: value(["agent"], ""),
        workedHours: numberValue(value(["worked hours", "worked"], 0)),
        evaluations: numberValue(value(["total evaluations", "evaluations"], 0)),
        chat: numberValue(value(["chat"], 0)),
        idcheck: numberValue(value(["idcheck", "id check"], 0)),
        stream: numberValue(value(["stream"], 0))
      };
    }).filter((row) => row.date && row.time);
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

  async function saveRows(rows) {
    if (!rows.length) return;
    const current = await chrome.storage.local.get([STORAGE_KEY]);
    const merged = dedupe((current[STORAGE_KEY] || []).concat(rows));
    await chrome.storage.local.set({
      [STORAGE_KEY]: merged,
      [LAST_SYNC_KEY]: new Date().toISOString()
    });
    window.postMessage({
      type: "STAFFME_HELPER_STATUS",
      connected: true,
      rowCount: merged.length
    }, "*");
  }

  async function scanStaffMe() {
    if (!isStaffMePage) return;
    const rows = readHourlyRows();
    if (rows.length) await saveRows(rows);
  }

  if (isStaffMePage) {
    let lastText = "";
    const scan = async () => {
      const table = findHourlyTable();
      const text = table ? clean(table.innerText) : "";
      if (text && text !== lastText) {
        lastText = text;
        await scanStaffMe();
      }
    };

    window.setTimeout(scan, 1500);
    window.setInterval(scan, 2500);
    new MutationObserver(scan).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true
    });
  }

  if (isTrackerPage) {
    window.addEventListener("message", async (event) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type === "STAFFME_REQUEST_DATA") {
        const stored = await chrome.storage.local.get([STORAGE_KEY, LAST_SYNC_KEY]);
        window.postMessage({
          type: "STAFFME_HOURLY_DATA",
          rows: stored[STORAGE_KEY] || [],
          lastSync: stored[LAST_SYNC_KEY] || null
        }, "*");
      }
    });

    window.setTimeout(() => {
      window.postMessage({ type: "STAFFME_REQUEST_DATA" }, "*");
    }, 900);
  }
})();
