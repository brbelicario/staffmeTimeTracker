const STORAGE_KEY = "smtrackerCbState";
const STATE_VERSION = 2;
const QUEUE_HEARTBEAT_GAP_SECONDS = 4;

const DEFAULT_STATE = {
  version: STATE_VERSION,
  tracking: false,
  autoStartBlocked: false,
  paused: false,
  pausedAt: null,
  pauseReason: null,
  sessionStartedAt: null,
  currentTaskId: null,
  currentTaskStartedAt: null,
  lastObservedTaskId: null,
  completedTasks: 0,
  totalActiveSeconds: 0,
  hourly: {},
  queuePageOpen: false,
  queueTabs: {},
  pageVisible: true,
  lastPageReadyAt: null,
  lastEventAt: null
};

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function normalizeState(raw) {
  const state = { ...cloneDefaultState(), ...(raw || {}) };
  state.hourly = raw && raw.hourly && typeof raw.hourly === "object" ? raw.hourly : {};
  state.queueTabs = raw && raw.queueTabs && typeof raw.queueTabs === "object" ? raw.queueTabs : {};
  state.completedTasks = Number.isFinite(Number(state.completedTasks)) ? Number(state.completedTasks) : 0;
  state.totalActiveSeconds = Number.isFinite(Number(state.totalActiveSeconds)) ? Number(state.totalActiveSeconds) : 0;
  state.autoStartBlocked = Boolean(state.autoStartBlocked);
  if (state.pauseReason !== "queue" && state.pauseReason !== "manual") {
    state.pauseReason = state.paused ? "manual" : null;
  }
  return state;
}

async function readState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const state = normalizeState(result[STORAGE_KEY]);
  const changed = reconcilePersistedState(state, nowSeconds());
  if (changed) await writeState(state);
  return state;
}

async function writeState(state) {
  state.version = STATE_VERSION;
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  return state;
}

function nowSeconds() {
  return Date.now() / 1000;
}

function localHourKey(timestampSeconds) {
  const date = new Date(timestampSeconds * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}-${date.getHours()}`;
}

function hourLabel(timestampSeconds) {
  const date = new Date(timestampSeconds * 1000);
  const hour = date.getHours();
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:00:00 - ${hour12}:59:59 ${suffix}`;
}

function cleanTaskId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text.length > 120) return null;
  return text;
}

function shiftTimeForPause(state, pausedSeconds) {
  if (state.sessionStartedAt !== null && state.sessionStartedAt !== undefined) {
    state.sessionStartedAt += pausedSeconds;
  }
  if (state.currentTaskStartedAt !== null && state.currentTaskStartedAt !== undefined) {
    state.currentTaskStartedAt += pausedSeconds;
  }
}

function clearPause(state) {
  state.paused = false;
  state.pausedAt = null;
  state.pauseReason = null;
}

function pauseForQueueLoss(state, pausedAt) {
  if (!state.tracking || state.paused) return false;
  state.paused = true;
  state.pausedAt = Number.isFinite(Number(pausedAt)) ? Number(pausedAt) : nowSeconds();
  state.pauseReason = "queue";
  return true;
}

function pauseForMissingQueueHeartbeat(state, now) {
  if (!state.tracking || state.paused || !state.queuePageOpen || !state.lastPageReadyAt) return false;
  if (now - state.lastPageReadyAt <= QUEUE_HEARTBEAT_GAP_SECONDS) return false;

  return pauseForQueueLoss(state, state.lastPageReadyAt);
}

function pruneQueueTabs(state, now) {
  const staleAfter = QUEUE_HEARTBEAT_GAP_SECONDS * 2;
  Object.entries(state.queueTabs).forEach(([tabId, lastSeen]) => {
    if (!Number.isFinite(Number(lastSeen)) || now - Number(lastSeen) > staleAfter) delete state.queueTabs[tabId];
  });
}

function reconcilePersistedState(state, now) {
  let changed = false;
  const beforeTabs = Object.keys(state.queueTabs).length;
  pruneQueueTabs(state, now);
  if (Object.keys(state.queueTabs).length !== beforeTabs) changed = true;

  if (state.queuePageOpen && state.lastPageReadyAt && now - state.lastPageReadyAt > QUEUE_HEARTBEAT_GAP_SECONDS) {
    if (pauseForMissingQueueHeartbeat(state, now)) changed = true;
  }

  // A closed queue can lose its pagehide message when the browser or PC is
  // shutting down. Do not let the persisted session continue across that gap.
  if (!state.queuePageOpen && state.tracking && !state.paused && (state.currentTaskId || state.lastPageReadyAt)) {
    if (pauseForQueueLoss(state, now)) changed = true;
  }

  return changed;
}

function finalizeCurrentTask(state, finishedAt) {
  if (!state.currentTaskId || state.currentTaskStartedAt === null || state.currentTaskStartedAt === undefined) return 0;

  const duration = Math.max(0, finishedAt - state.currentTaskStartedAt);
  const key = localHourKey(finishedAt);
  if (!state.hourly[key]) {
    state.hourly[key] = {
      key,
      label: hourLabel(finishedAt),
      completedTasks: 0,
      totalSeconds: 0
    };
  }

  state.hourly[key].completedTasks += 1;
  state.hourly[key].totalSeconds += duration;
  state.completedTasks += 1;
  state.totalActiveSeconds += duration;
  return duration;
}

async function setTracking(enabled) {
  const state = await readState();
  const now = nowSeconds();

  if (enabled) {
    state.tracking = true;
    state.autoStartBlocked = false;
    clearPause(state);
    state.sessionStartedAt = now;
    state.currentTaskId = cleanTaskId(state.lastObservedTaskId);
    state.currentTaskStartedAt = state.currentTaskId ? now : null;
    state.lastEventAt = now;
  } else {
    state.tracking = false;
    state.autoStartBlocked = true;
    clearPause(state);
    state.lastEventAt = now;
    // The active task is intentionally not finalized here. A new task ID is
    // the boundary that proves the previous task changed/completed.
  }

  return writeState(state);
}

async function setPaused(requestedPaused) {
  const state = await readState();
  if (!state.tracking) return state;

  const now = nowSeconds();
  const shouldPause = Boolean(requestedPaused);

  if (shouldPause && !state.paused) {
    state.paused = true;
    state.pausedAt = now;
    state.pauseReason = "manual";
  } else if (!shouldPause && state.paused) {
    if (state.pauseReason === "queue") return state;
    const pausedSeconds = Math.max(0, now - (state.pausedAt || now));
    shiftTimeForPause(state, pausedSeconds);
    clearPause(state);

    const latestId = cleanTaskId(state.lastObservedTaskId);
    if (latestId && latestId !== state.currentTaskId) {
      state.currentTaskId = latestId;
      state.currentTaskStartedAt = now;
    }
  }

  state.lastEventAt = now;
  return writeState(state);
}

async function observeTask(taskId, sender) {
  const state = await readState();
  const cleanId = cleanTaskId(taskId);
  if (!cleanId) return state;

  const now = nowSeconds();
  pauseForMissingQueueHeartbeat(state, now);
  const tabId = sender && sender.tab && Number.isInteger(sender.tab.id) ? String(sender.tab.id) : null;
  pruneQueueTabs(state, now);
  if (tabId) state.queueTabs[tabId] = now;
  state.lastObservedTaskId = cleanId;
  state.queuePageOpen = true;
  state.lastPageReadyAt = now;

  if (!state.tracking) {
    if (!state.autoStartBlocked) {
      state.tracking = true;
      clearPause(state);
      state.sessionStartedAt = now;
      state.currentTaskId = cleanId;
      state.currentTaskStartedAt = now;
    }
    state.lastEventAt = now;
    return writeState(state);
  }

  if (state.paused && state.pauseReason === "queue") {
    const pausedSeconds = Math.max(0, now - (state.pausedAt || now));
    if (state.currentTaskId && cleanId === state.currentTaskId) {
      shiftTimeForPause(state, pausedSeconds);
    } else {
      // A different task appeared after the queue was closed. The paused
      // task is abandoned rather than counted as a completed task.
      if (state.sessionStartedAt) state.sessionStartedAt += pausedSeconds;
      state.currentTaskId = cleanId;
      state.currentTaskStartedAt = now;
    }
    clearPause(state);
    state.lastEventAt = now;
    return writeState(state);
  }

  if (state.paused) {
    state.lastEventAt = now;
    return writeState(state);
  }

  if (state.sessionStartedAt === null || state.sessionStartedAt === undefined) state.sessionStartedAt = now;

  if (!state.currentTaskId) {
    state.currentTaskId = cleanId;
    state.currentTaskStartedAt = now;
  } else if (cleanId !== state.currentTaskId) {
    finalizeCurrentTask(state, now);
    state.currentTaskId = cleanId;
    state.currentTaskStartedAt = now;
  }

  state.lastEventAt = now;
  return writeState(state);
}

async function updatePageStatus(message, sender) {
  const state = await readState();
  const now = nowSeconds();
  const tabId = sender && sender.tab && Number.isInteger(sender.tab.id) ? String(sender.tab.id) : null;

  if (message.status === "ready") {
    pauseForMissingQueueHeartbeat(state, now);
    pruneQueueTabs(state, now);
    if (tabId) state.queueTabs[tabId] = now;
    state.queuePageOpen = true;
    state.pageVisible = message.visible !== false;
    state.lastPageReadyAt = now;
  } else if (message.status === "visibility") {
    pauseForMissingQueueHeartbeat(state, now);
    pruneQueueTabs(state, now);
    if (tabId) state.queueTabs[tabId] = now;
    state.queuePageOpen = true;
    state.pageVisible = message.visible !== false;
  } else if (message.status === "closed") {
    pruneQueueTabs(state, now);
    if (tabId) delete state.queueTabs[tabId];
    const anotherQueueTabOpen = Object.keys(state.queueTabs).length > 0;
    state.queuePageOpen = anotherQueueTabOpen;
    if (!anotherQueueTabOpen) {
      state.lastPageReadyAt = null;
      state.pageVisible = false;
      pauseForQueueLoss(state, now);
    }
  }
  state.lastEventAt = now;
  return writeState(state);
}

async function resetSession() {
  const state = await readState();
  const tracking = state.tracking;
  const latestId = cleanTaskId(state.lastObservedTaskId);
  const now = nowSeconds();
  const fresh = cloneDefaultState();
  fresh.tracking = tracking;
  fresh.autoStartBlocked = state.autoStartBlocked;
  fresh.pauseReason = null;
  fresh.sessionStartedAt = tracking ? now : null;
  fresh.currentTaskId = tracking ? latestId : null;
  fresh.currentTaskStartedAt = tracking && latestId ? now : null;
  fresh.lastObservedTaskId = latestId;
  fresh.queuePageOpen = state.queuePageOpen;
  fresh.queueTabs = state.queueTabs;
  fresh.pageVisible = state.pageVisible;
  fresh.lastPageReadyAt = state.lastPageReadyAt;
  fresh.lastEventAt = now;
  return writeState(fresh);
}

chrome.runtime.onInstalled.addListener(async () => {
  const state = await readState();
  await writeState(state);
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await readState();
  await writeState(state);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await readState();
  const key = String(tabId);
  const trackedTab = Object.prototype.hasOwnProperty.call(state.queueTabs, key);
  if (!trackedTab && !state.queuePageOpen) return;

  if (trackedTab) delete state.queueTabs[key];
  pruneQueueTabs(state, nowSeconds());
  const anotherQueueTabOpen = Object.keys(state.queueTabs).length > 0;
  state.queuePageOpen = anotherQueueTabOpen;
  if (!anotherQueueTabOpen) {
    state.lastPageReadyAt = null;
    state.pageVisible = false;
    pauseForQueueLoss(state, nowSeconds());
  }
  await writeState(state);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message && message.type) {
      case "GET_STATE":
        return readState();
      case "SET_TRACKING":
        return setTracking(Boolean(message.enabled));
      case "SET_PAUSED":
        return setPaused(Boolean(message.paused));
      case "RESET_SESSION":
        return resetSession();
      case "TASK_SEEN":
        return observeTask(message.taskId, sender);
      case "PAGE_STATUS":
        return updatePageStatus(message, sender);
      default:
        return readState();
    }
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ error: String(error) }));

  return true;
});
