(function () {
  "use strict";

  if (window.top !== window) return;
  if (window.__smtrackerCbLoaded) return;
  window.__smtrackerCbLoaded = true;

  const state = {
    data: null,
    minimized: false,
    lastDetectedId: null,
    lastUrl: location.href,
    pageVisible: document.visibilityState === "visible",
    lastPageStatusAt: 0,
    scanInProgress: false,
    layoutPending: false
  };

  const spacer = document.createElement("div");
  spacer.id = "smtracker-cb-spacer";
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.display = "block";
  spacer.style.width = "100%";
  spacer.style.height = "54px";
  spacer.style.margin = "0";
  spacer.style.padding = "0";
  spacer.style.border = "0";
  spacer.style.boxSizing = "border-box";
  spacer.style.background = "transparent";
  spacer.style.flex = "0 0 auto";
  spacer.style.pointerEvents = "none";

  const host = document.createElement("div");
  host.id = "smtracker-cb-host";
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "0";
  host.style.right = "0";
  host.style.display = "block";
  host.style.width = "auto";
  host.style.height = "54px";
  host.style.margin = "0";
  host.style.padding = "4px 0";
  host.style.boxSizing = "border-box";
  host.style.background = "transparent";
  host.style.overflow = "visible";
  host.style.flex = "0 0 auto";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";

  function mountHostAtTop() {
    if (!document.body) return false;
    if (spacer.parentElement !== document.body || document.body.firstElementChild !== spacer) {
      document.body.insertBefore(spacer, document.body.firstChild);
    }
    if (host.parentElement !== document.body) {
      document.body.insertBefore(host, spacer.nextSibling);
    } else if (spacer.nextElementSibling !== host) {
      document.body.insertBefore(host, spacer.nextSibling);
    }
    return true;
  }

  if (!mountHostAtTop()) document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .panel {
        width: max-content;
        max-width: calc(100vw - 10px);
        margin: 0 auto;
        color: #f0f6fc;
        background: rgba(13, 17, 23, 0.96);
        border: 1px solid #30363d;
        border-radius: 7px;
        box-shadow: 0 5px 18px rgba(0, 0, 0, 0.36);
        font-family: "Segoe UI", Arial, sans-serif;
        font-size: 13px;
        line-height: 1.25;
        overflow: hidden;
        pointer-events: auto;
        backdrop-filter: blur(8px);
      }
      .panel.minimized { width: 44px; }
      .compact-row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 46px;
        padding: 6px 7px;
        background: #161b22;
        white-space: nowrap;
        overflow: hidden;
      }
      .brand { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; min-width: 0; }
      .brand-name { font-size: 12px; font-weight: 800; letter-spacing: .1px; white-space: nowrap; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #8b949e; flex: 0 0 auto; }
      .dot.on { background: #56e39f; box-shadow: 0 0 7px #56e39f; }
      .dot.paused { background: #f59e0b; box-shadow: 0 0 7px #f59e0b; }
      .task-block {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 132px;
        max-width: 160px;
        padding: 5px 7px;
        border-left: 1px solid #30363d;
      }
      .task-id {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #56e39f;
        font-family: Consolas, monospace;
        font-size: 12px;
        font-weight: 800;
      }
      .compact-metrics {
        display: flex;
        align-items: center;
        justify-content: space-around;
        gap: 11px;
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
      }
      .compact-metric { display: flex; align-items: baseline; gap: 4px; min-width: 0; }
      .metric-icon { font-size: 12px; line-height: 1; }
      .metric-label { color: #8b949e; font-size: 9px; font-weight: 700; }
      .metric-value {
        color: #f0f6fc;
        font-family: Consolas, monospace;
        font-size: 12px;
        font-weight: 800;
        white-space: nowrap;
      }
      .metric-value.blue { color: #58a6ff; }
      .metric-value.green { color: #56e39f; }
      .metric-value.amber { color: #f59e0b; }
      .compact-actions { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
      button {
        border: 0;
        border-radius: 6px;
        color: #f0f6fc;
        background: #374151;
        width: 28px;
        height: 28px;
        padding: 0;
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
      }
      button:hover { filter: brightness(1.18); }
      button.primary { background: #1f6feb; }
      button.danger { background: #da3633; }
      button.warning { background: #9a6700; }
      button:disabled { opacity: .45; cursor: not-allowed; filter: none; }
      .history { margin: 0 7px 7px; max-height: 190px; overflow: auto; border-top: 1px solid #30363d; padding-top: 7px; }
      .history-title { color: #8b949e; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 5px; }
      .history-row { display: flex; justify-content: space-between; gap: 10px; padding: 5px 7px; border-radius: 5px; background: #161b22; margin-bottom: 3px; }
      .history-label { color: #c9d1d9; }
      .history-value { color: #58a6ff; font-family: Consolas, monospace; white-space: nowrap; }
      .panel.minimized .task-block,
      .panel.minimized .compact-metrics,
      .panel.minimized .brand,
      .panel.minimized .compact-actions > :not(#minimize-button) { display: none; }
      .panel.minimized .compact-row { justify-content: center; min-height: 36px; padding: 4px; }
      .panel.minimized .compact-actions { margin-left: 0; }
      @media (max-width: 650px) {
        .panel { width: calc(100vw - 8px); max-width: none; }
        .brand-name { max-width: 94px; overflow: hidden; text-overflow: ellipsis; }
        .task-block { min-width: 92px; max-width: 112px; }
        .compact-metrics { justify-content: flex-start; gap: 8px; }
        .metric-label { display: none; }
        .metric-icon { display: none; }
        .metric-value { font-size: 11px; }
      }
    </style>
    <div class="panel" id="panel">
      <div class="compact-row">
        <div class="brand" title="SMTracker · CB">
          <span class="brand-name">SMTracker</span>
        </div>
        <div class="compact-actions" id="compact-actions">
          <button class="primary" id="tracking-button" title="Start tracking" aria-label="Start tracking">▶</button>
          <button id="pause-button" title="Pause" aria-label="Pause" disabled>Ⅱ</button>
          <button id="reset-button" title="Reset records" aria-label="Reset records">↻</button>
        </div>
        <div class="task-block" id="task-block" title="Current task ID">
          <span class="dot" id="dot"></span>
          <span class="task-id" id="task-id">—</span>
        </div>
        <div class="compact-metrics" id="compact-metrics">
          <div class="compact-metric" title="Time until the next hour reset">
            <span class="metric-icon">⌛</span><span class="metric-label">Next hr</span><span class="metric-value blue" id="next-hour">60:00</span>
          </div>
          <div class="compact-metric" title="Session elapsed">
            <span class="metric-icon">◷</span><span class="metric-label">Session</span><span class="metric-value" id="session">00:00:00</span>
          </div>
          <div class="compact-metric" title="Current task AHT">
            <span class="metric-icon">⏱</span><span class="metric-label">Task AHT</span><span class="metric-value amber" id="task-timer">0.0s</span>
          </div>
          <div class="compact-metric" title="Current-hour average handling time">
            <span class="metric-icon">◉</span><span class="metric-label">Hr Avg AHT</span><span class="metric-value blue" id="aht">—</span>
          </div>
        </div>
        <div class="compact-actions">
          <button id="history-button" title="Hourly history" aria-label="Hourly history">⌄</button>
          <button class="icon" id="minimize-button" title="Minimize" aria-label="Minimize">−</button>
        </div>
      </div>
      <div class="history" id="history" hidden></div>
    </div>
  `;

  const elements = {
    panel: shadow.getElementById("panel"),
    dot: shadow.getElementById("dot"),
    taskId: shadow.getElementById("task-id"),
    taskTimer: shadow.getElementById("task-timer"),
    nextHour: shadow.getElementById("next-hour"),
    aht: shadow.getElementById("aht"),
    session: shadow.getElementById("session"),
    trackingButton: shadow.getElementById("tracking-button"),
    pauseButton: shadow.getElementById("pause-button"),
    historyButton: shadow.getElementById("history-button"),
    resetButton: shadow.getElementById("reset-button"),
    minimizeButton: shadow.getElementById("minimize-button"),
    history: shadow.getElementById("history")
  };

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(response || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function formatDuration(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const whole = Math.floor(value);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    if (minutes > 0) return `${minutes}m ${String(secs).padStart(2, "0")}s`;
    return `${secs}s`;
  }

  function formatSeconds(seconds) {
    return `${Math.max(0, Number(seconds) || 0).toFixed(1)}s`;
  }

  function formatAht(seconds, count) {
    if (!count) return "—";
    return formatSeconds(seconds / count);
  }

  function formatNextHourCountdown(timestampMs = Date.now()) {
    const date = new Date(timestampMs);
    const elapsed = date.getMinutes() * 60 + date.getSeconds();
    const remaining = 3600 - elapsed;
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function localHourKey(timestampMs = Date.now()) {
    const date = new Date(timestampMs);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}-${date.getHours()}`;
  }

  function layoutOverlay() {
    if (!mountHostAtTop()) return;

    const panelRect = elements.panel.getBoundingClientRect();
    const verticalPadding = 4;
    const totalHeight = Math.ceil(panelRect.height) + verticalPadding * 2;
    host.style.position = "fixed";
    host.style.top = "0";
    host.style.left = "0";
    host.style.right = "0";
    host.style.width = "auto";
    host.style.transform = "none";
    host.style.height = `${totalHeight}px`;
    host.style.padding = `${verticalPadding}px 0`;
    spacer.style.height = `${totalHeight}px`;
  }

  function scheduleLayout() {
    if (state.layoutPending) return;
    state.layoutPending = true;
    window.requestAnimationFrame(() => {
      state.layoutPending = false;
      layoutOverlay();
    });
  }

  function renderHistory(hourly) {
    const rows = Object.values(hourly || {})
      .sort((a, b) => String(b.key).localeCompare(String(a.key)))
      .map((item) => `
        <div class="history-row">
          <span class="history-label"></span>
          <span class="history-value"></span>
        </div>
      `);

    elements.history.innerHTML = rows.length
      ? `<div class="history-title">Hourly records</div>${rows.join("")}`
      : `<div class="history-title">No completed tasks yet</div>`;

    const rowElements = elements.history.querySelectorAll(".history-row");
    const items = Object.values(hourly || {})
      .sort((a, b) => String(b.key).localeCompare(String(a.key)));
    rowElements.forEach((row, index) => {
      const item = items[index];
      row.children[0].textContent = `${item.label} · ${item.completedTasks} tasks`;
      row.children[1].textContent = `Avg ${formatAht(item.totalSeconds, item.completedTasks)}`;
    });
  }

  function render() {
    const data = state.data;
    if (!data) return;

    const now = Date.now() / 1000;
    const timingNow = data.paused && data.pausedAt ? data.pausedAt : now;
    const activeTaskSeconds = data.tracking && data.currentTaskStartedAt
      ? Math.max(0, timingNow - data.currentTaskStartedAt)
      : 0;
    const sessionSeconds = data.tracking && data.sessionStartedAt
      ? Math.max(0, timingNow - data.sessionStartedAt)
      : 0;
    const currentHour = data.hourly && data.hourly[localHourKey()];
    elements.taskId.textContent = data.currentTaskId || data.lastObservedTaskId || "—";
    elements.taskTimer.textContent = formatSeconds(activeTaskSeconds);
    elements.nextHour.textContent = formatNextHourCountdown();
    elements.aht.textContent = formatAht(
      currentHour && currentHour.totalSeconds,
      currentHour && currentHour.completedTasks
    );
    elements.session.textContent = (() => {
      const total = Math.floor(sessionSeconds);
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    })();

    elements.trackingButton.textContent = data.tracking ? "■" : "▶";
    elements.trackingButton.className = data.tracking ? "danger" : "primary";
    elements.trackingButton.title = data.tracking ? "Stop tracking" : "Start tracking";
    elements.trackingButton.setAttribute("aria-label", elements.trackingButton.title);
    elements.pauseButton.textContent = data.paused ? "▶" : "Ⅱ";
    elements.pauseButton.className = data.paused ? "warning" : "";
    elements.pauseButton.title = data.pauseReason === "queue"
      ? "Waiting for the queue task ID to reconnect"
      : data.paused ? "Resume" : "Pause";
    elements.pauseButton.setAttribute("aria-label", elements.pauseButton.title);
    elements.pauseButton.disabled = !data.tracking || data.pauseReason === "queue";

    elements.dot.className = data.paused ? "dot paused" : data.tracking ? "dot on" : "dot";
    elements.dot.title = data.paused ? "CB paused" : data.tracking ? "CB tracking" : "CB ready";

    if (!elements.history.hidden) renderHistory(data.hourly);
    scheduleLayout();
  }

  function extractTaskId() {
    const selectors = [
      '[data-testid="task-id"]',
      '[data-testid="queue-item-id"]',
      '[class*="queue-id"]',
      '[class*="task-id"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const text = (element.textContent || "").trim();
      const labeled = text.match(/task\s*id\s*[:#-]?\s*([A-Za-z0-9_-]{3,})/i);
      const numeric = text.match(/\b\d{4,}\b/);
      if (labeled) return labeled[1];
      if (numeric) return numeric[0];
      if (/^[A-Za-z0-9_-]{3,}$/.test(text)) return text;
    }

    const urlMatch = location.href.match(/[?&/](?:id|task_id|case_id|item)[=/]([A-Za-z0-9_-]{3,})/i);
    return urlMatch ? urlMatch[1] : null;
  }

  async function reportPageStatus(force = false) {
    state.pageVisible = document.visibilityState === "visible";
    const now = Date.now();
    if (!force && now - state.lastPageStatusAt < 1000) return;
    state.lastPageStatusAt = now;
    await send({ type: "PAGE_STATUS", status: "ready", visible: state.pageVisible });
  }

  async function scanAndReport() {
    if (state.scanInProgress) return;
    state.scanInProgress = true;
    try {
      if (location.href !== state.lastUrl) {
        state.lastUrl = location.href;
        state.lastDetectedId = null;
      }

      await reportPageStatus();
      const taskId = extractTaskId();
      if (taskId && taskId !== state.lastDetectedId) {
        state.lastDetectedId = taskId;
        await send({ type: "TASK_SEEN", taskId });
      }
    } finally {
      state.scanInProgress = false;
    }
  }

  shadow.getElementById("tracking-button").addEventListener("click", async () => {
    const enabled = !(state.data && state.data.tracking);
    const response = await send({ type: "SET_TRACKING", enabled });
    if (response) state.data = response;
    render();
    if (enabled) await scanAndReport();
  });

  shadow.getElementById("pause-button").addEventListener("click", async () => {
    if (!state.data || !state.data.tracking) return;
    const response = await send({ type: "SET_PAUSED", paused: !state.data.paused });
    if (response) state.data = response;
    render();
  });

  shadow.getElementById("reset-button").addEventListener("click", async () => {
    if (!confirm("Reset CB task and hourly records?")) return;
    const response = await send({ type: "RESET_SESSION" });
    if (response) state.data = response;
    render();
  });

  shadow.getElementById("history-button").addEventListener("click", () => {
    elements.history.hidden = !elements.history.hidden;
    elements.historyButton.textContent = elements.history.hidden ? "⌄" : "⌃";
    if (!elements.history.hidden && state.data) renderHistory(state.data.hourly);
    scheduleLayout();
  });

  shadow.getElementById("minimize-button").addEventListener("click", () => {
    state.minimized = !state.minimized;
    elements.panel.classList.toggle("minimized", state.minimized);
    elements.minimizeButton.textContent = state.minimized ? "+" : "−";
    elements.minimizeButton.title = state.minimized ? "Expand" : "Minimize";
    scheduleLayout();
  });

  window.addEventListener("resize", scheduleLayout, { passive: true });
  document.addEventListener("scroll", scheduleLayout, { passive: true, capture: true });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleLayout, { passive: true });

  document.addEventListener("visibilitychange", async () => {
    state.pageVisible = document.visibilityState === "visible";
    state.lastPageStatusAt = Date.now();
    await send({ type: "PAGE_STATUS", status: "visibility", visible: state.pageVisible });
    render();
  });

  window.addEventListener("pagehide", () => {
    send({ type: "PAGE_STATUS", status: "closed" });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.smtrackerCbState) return;
    state.data = changes.smtrackerCbState.newValue;
    render();
  });

  send({ type: "GET_STATE" }).then((response) => {
    if (response) state.data = response;
    render();
    scanAndReport();
  });

  setInterval(() => {
    render();
    scanAndReport();
  }, 1000);

  new MutationObserver(() => {
    scheduleLayout();
    scanAndReport();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();
