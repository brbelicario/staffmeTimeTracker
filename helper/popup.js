const CB_STORAGE_KEY = "smtrackerCbState";
const SM_STATUS_KEY = "staffmeConnectionStatusV1";
const SM_HOURLY_STATUS_KEY = "staffmeHourlyStatus";
const SM_ROWS_KEY = "staffmeHourlyRows";
const SM_LAST_SYNC_KEY = "staffmeHourlyLastSync";
const SM_TEST_ROWS_KEY = "staffmeHourlyTestRows";
const SM_INCLUDE_TEST_ROWS_KEY = "staffmeHourlyIncludeTestRows";

function send(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function readStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (value) => resolve(value || {}));
  });
}

function removeStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

function formatAge(isoString) {
  if (!isoString) return "not synced yet";
  const ageSeconds = Math.max(0, (Date.now() - new Date(isoString).getTime()) / 1000);
  if (!Number.isFinite(ageSeconds)) return "not synced yet";
  if (ageSeconds < 60) return "synced just now";
  return `synced ${formatDuration(ageSeconds)} ago`;
}

function setStatus(element, text, color) {
  element.textContent = text;
  element.style.color = color;
}

function renderSm(stored) {
  const statusElement = document.getElementById("sm-status");
  const summaryElement = document.getElementById("sm-summary");
  const detailElement = document.getElementById("sm-detail");
  const rows = Array.isArray(stored[SM_ROWS_KEY]) ? stored[SM_ROWS_KEY] : [];
  const status = stored[SM_STATUS_KEY] && typeof stored[SM_STATUS_KEY] === "object"
    ? stored[SM_STATUS_KEY]
    : {};
  const hourlyStatus = stored[SM_HOURLY_STATUS_KEY] && typeof stored[SM_HOURLY_STATUS_KEY] === "object"
    ? stored[SM_HOURLY_STATUS_KEY]
    : {};
  const nowSeconds = Date.now() / 1000;
  const sessions = Array.isArray(status.sessions) ? status.sessions : [];
  const live = sessions.filter((session) =>
    session && nowSeconds - Number(session.lastSeenAt || 0) <= 20
  );
  const smPage = live.find((session) => session.context === "staffme" && session.betaTrackerOpen);
  const scanTime = Date.parse(hourlyStatus.scannedAt || "");
  const recentTableScan = Number.isFinite(scanTime) && Date.now() - scanTime <= 20000;
  const ready = Boolean(smPage && (smPage.ready || (hourlyStatus.tableFound && recentTableScan)));

  if (ready) {
    setStatus(statusElement, "Ready", "#56e39f");
    summaryElement.textContent = `${rows.length} hourly row${rows.length === 1 ? "" : "s"} saved`;
    detailElement.textContent = formatAge(stored[SM_LAST_SYNC_KEY]);
  } else if (smPage) {
    setStatus(statusElement, "Open", "#f59e0b");
    summaryElement.textContent = "SM page is open";
    detailElement.textContent = rows.length
      ? `${rows.length} saved row${rows.length === 1 ? "" : "s"}; waiting for the table`
      : "Waiting for the hourly table to load";
  } else {
    setStatus(statusElement, "Waiting", "#8b949e");
    summaryElement.textContent = "Open the SM tracker page";
    detailElement.textContent = rows.length
      ? `${rows.length} saved row${rows.length === 1 ? "" : "s"}; ${formatAge(stored[SM_LAST_SYNC_KEY])}`
      : "No SM page is currently detected";
  }
}

function renderCb(state) {
  if (!state) return;

  const statusElement = document.getElementById("cb-status");
  const taskElement = document.getElementById("cb-task");
  const summaryElement = document.getElementById("cb-summary");
  const trackingButton = document.getElementById("tracking-button");

  setStatus(
    statusElement,
    state.paused ? "Paused" : state.tracking ? "Tracking" : "Ready",
    state.paused ? "#f59e0b" : state.tracking ? "#56e39f" : "#8b949e"
  );
  taskElement.textContent = state.currentTaskId || state.lastObservedTaskId || "No task ID detected";
  trackingButton.textContent = state.tracking ? "Stop CB tracking" : "Start CB tracking";
  trackingButton.className = state.tracking ? "muted" : "primary";

  const aht = state.completedTasks
    ? formatDuration(state.totalActiveSeconds / state.completedTasks)
    : "—";
  summaryElement.textContent = state.tracking
    ? `${state.paused ? "Paused" : "Active"} · AHT ${aht} · ${state.queuePageOpen ? "Queue detected" : "Waiting for queue"}`
    : "Open the CB queue to begin.";
}

let currentState = null;

async function refresh() {
  const [cbState, stored] = await Promise.all([
    send({ type: "GET_STATE" }),
    readStorage([SM_STATUS_KEY, SM_HOURLY_STATUS_KEY, SM_ROWS_KEY, SM_LAST_SYNC_KEY])
  ]);
  currentState = cbState;
  renderSm(stored);
  renderCb(cbState);
}

document.getElementById("tracking-button").addEventListener("click", async () => {
  const next = await send({
    type: "SET_TRACKING",
    enabled: !(currentState && currentState.tracking)
  });
  if (next) {
    currentState = next;
    renderCb(next);
  }
});

document.getElementById("clear-sm-button").addEventListener("click", async () => {
  if (!confirm("Clear all locally saved SM hourly rows? CB tracking will not be affected.")) return;

  const button = document.getElementById("clear-sm-button");
  button.disabled = true;
  try {
    await removeStorage([
      SM_ROWS_KEY,
      SM_LAST_SYNC_KEY,
      SM_HOURLY_STATUS_KEY,
      SM_TEST_ROWS_KEY,
      SM_INCLUDE_TEST_ROWS_KEY
    ]);
    await refresh();
  } finally {
    button.disabled = false;
  }
});

document.getElementById("open-queue").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://chaturbate.com/compliance/queue/" });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[CB_STORAGE_KEY]) {
    currentState = changes[CB_STORAGE_KEY].newValue;
    renderCb(currentState);
  }
  if (changes[SM_STATUS_KEY] || changes[SM_HOURLY_STATUS_KEY] || changes[SM_ROWS_KEY] || changes[SM_LAST_SYNC_KEY]) {
    refresh();
  }
});

refresh();
