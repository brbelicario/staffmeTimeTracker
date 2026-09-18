(() => {
  "use strict";

  // Connection state belongs to the top-level tab, not every embedded frame.
  if (window.top !== window) return;

  const STATUS_KEY = "staffmeConnectionStatusV1";
  const HEARTBEAT_MS = 5000;
  const STALE_AFTER_MS = 20000;
  const TRACKER_HOST = "staffmetimetracker.pages.dev";
  const STAFFME_HOSTS = new Set([
    "script.google.com",
    "script.googleusercontent.com"
  ]);
  const STAFFME_BETA_HOST = "script.google.com";
  const STAFFME_BETA_PATH = "/macros/s/AKfycbz-ZTA3IBu5Kmz7Fh7UIIVf9YB6W8qCjJllACUsl_mIh6WIsD8wgkATuP-c6Ust0-dQ/exec";

  const hostname = String(location.hostname || "").toLowerCase();
  const isScriptGoogleusercontentHost = (host) => {
    const normalized = String(host || "").toLowerCase();
    return normalized === "script.googleusercontent.com" ||
      normalized.endsWith(".script.googleusercontent.com");
  };
  const isStaffMeHost = (host) => {
    const normalized = String(host || "").toLowerCase();
    return STAFFME_HOSTS.has(normalized) || isScriptGoogleusercontentHost(normalized);
  };
  const context = hostname === TRACKER_HOST
    ? "dashboard"
    : isStaffMeHost(hostname)
      ? "staffme"
      : null;

  if (!context) return;

  const extensionVersion = (() => {
    try {
      return chrome.runtime.getManifest().version;
    } catch (error) {
      return "unknown";
    }
  })();

  const sessionId = (() => {
    const key = STATUS_KEY + ":session:" + context;
    try {
      const existing = sessionStorage.getItem(key);
      if (existing) return existing;
      const created = context + ":" + Date.now() + ":" + Math.random().toString(36).slice(2);
      sessionStorage.setItem(key, created);
      return created;
    } catch (error) {
      return context + ":" + Date.now() + ":" + Math.random().toString(36).slice(2);
    }
  })();

  function clean(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function isDashboardLoggedIn() {
    if (context !== "dashboard") return false;
    const dashboard = document.getElementById("dashboardView");
    const email = clean(document.getElementById("profileEmail")?.textContent);
    return Boolean(
      dashboard &&
      !dashboard.hidden &&
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    );
  }

  function isBetaTrackerPage() {
    if (context !== "staffme") return false;

    if (
      hostname === STAFFME_BETA_HOST &&
      location.pathname === STAFFME_BETA_PATH
    ) {
      return true;
    }

    // Apps Script can render or redirect through script.googleusercontent.com.
    // The original beta URL in the referrer still identifies the requested app.
    if (isScriptGoogleusercontentHost(hostname)) {
      const referrer = clean(document.referrer);
      return referrer.includes(STAFFME_BETA_HOST + STAFFME_BETA_PATH) ||
        location.href.includes(STAFFME_BETA_PATH);
    }

    return false;
  }

  function getPageDetails() {
    if (context === "dashboard") {
      return {
        loggedIn: isDashboardLoggedIn()
      };
    }

    const bodyText = clean(document.body?.innerText).toLowerCase();
    const betaTrackerOpen = isBetaTrackerPage();
    const tableFound =
      bodyText.includes("hourly aht") ||
      (
        bodyText.includes("worked hours") &&
        bodyText.includes("total evaluations") &&
        bodyText.includes("time")
      );

    return {
      betaTrackerOpen,
      tableFound,
      ready: betaTrackerOpen && tableFound,
      awaitingConsent: Boolean(document.getElementById("smtracker-consent-prompt"))
    };
  }

  async function readState() {
    try {
      const stored = await chrome.storage.local.get(STATUS_KEY);
      const value = stored[STATUS_KEY];
      return value && typeof value === "object"
        ? value
        : { sessions: [] };
    } catch (error) {
      return { sessions: [] };
    }
  }

  function liveSessions(sessions, now) {
    return (Array.isArray(sessions) ? sessions : [])
      .filter((session) => session && typeof session === "object")
      .filter((session) => now - numberValue(session.lastSeenAt) <= STALE_AFTER_MS);
  }

  function newestFirst(a, b) {
    return numberValue(b.lastSeenAt) - numberValue(a.lastSeenAt);
  }

  function summarize(sessions, now) {
    const live = liveSessions(sessions, now);
    const dashboards = live
      .filter((session) => session.context === "dashboard")
      .sort(newestFirst);
    const staffMePages = live
      .filter((session) => session.context === "staffme")
      .sort(newestFirst);
    const betaPages = staffMePages
      .filter((session) => session.betaTrackerOpen)
      .sort(newestFirst);

    const dashboard = dashboards[0] || null;
    const staffMe = staffMePages[0] || null;
    const beta = betaPages[0] || null;
    const scriptOpenedBeforeDashboard = Boolean(
      dashboard &&
      beta &&
      numberValue(beta.firstSeenAt) < numberValue(dashboard.firstSeenAt)
    );

    return {
      installed: true,
      extensionVersion,
      checkedAt: new Date(now).toISOString(),
      dashboard: {
        open: Boolean(dashboard),
        loggedIn: Boolean(dashboard && dashboard.loggedIn),
        firstSeenAt: dashboard ? dashboard.firstSeenAt : null,
        lastSeenAt: dashboard ? dashboard.lastSeenAt : null
      },
      staffMe: {
        open: Boolean(staffMe),
        betaTrackerOpen: Boolean(beta),
        tableFound: Boolean(beta && beta.tableFound),
        ready: Boolean(beta && beta.ready),
        awaitingConsent: Boolean(beta && beta.awaitingConsent),
        firstSeenAt: beta ? beta.firstSeenAt : null,
        lastSeenAt: beta ? beta.lastSeenAt : null,
        url: beta ? beta.url : null
      },
      sequence: {
        dashboardFirstSeenAt: dashboard ? dashboard.firstSeenAt : null,
        staffMeFirstSeenAt: beta ? beta.firstSeenAt : null,
        scriptOpenedBeforeDashboard,
        orderCorrect: dashboard && beta ? !scriptOpenedBeforeDashboard : null
      }
    };
  }

  function publish(summary) {
    const message = {
      type: "STAFFME_CONNECTION_STATUS",
      installed: true,
      extensionVersion,
      connection: summary,
      ...summary
    };
    window.postMessage(message, "*");

    if (!publish.readySent) {
      publish.readySent = true;
      window.postMessage({
        type: "STAFFME_EXTENSION_READY",
        installed: true,
        extensionVersion,
        context,
        checkedAt: summary.checkedAt
      }, "*");
    }
  }
  publish.readySent = false;

  async function publishStoredState() {
    const state = await readState();
    publish(summarize(state.sessions, Date.now()));
  }

  async function recordPresence() {
    const now = Date.now();
    const details = getPageDetails();
    const state = await readState();
    const previousSessions = Array.isArray(state.sessions) ? state.sessions : [];
    const previous = previousSessions.find((session) =>
      session && session.id === sessionId
    );

    const session = {
      id: sessionId,
      context,
      firstSeenAt: previous ? numberValue(previous.firstSeenAt) || now : now,
      lastSeenAt: now,
      url: location.origin + location.pathname,
      loggedIn: context === "dashboard" ? Boolean(details.loggedIn) : false,
      betaTrackerOpen: context === "staffme" ? Boolean(details.betaTrackerOpen) : false,
      tableFound: context === "staffme" ? Boolean(details.tableFound) : false,
      ready: context === "staffme" ? Boolean(details.ready) : false,
      awaitingConsent: context === "staffme" ? Boolean(details.awaitingConsent) : false
    };

    const sessions = previousSessions
      .filter((item) =>
        item &&
        item.id !== sessionId &&
        now - numberValue(item.lastSeenAt) <= STALE_AFTER_MS * 3
      )
      .concat(session);

    try {
      await chrome.storage.local.set({
        [STATUS_KEY]: {
          version: 1,
          extensionVersion,
          updatedAt: now,
          sessions
        }
      });
    } catch (error) {
      publish(summarize(sessions, now));
      return;
    }

    publish(summarize(sessions, now));
  }

  window.setInterval(recordPresence, HEARTBEAT_MS);
  window.addEventListener("visibilitychange", recordPresence);
  window.addEventListener("pageshow", recordPresence);
  recordPresence();

  if (context === "dashboard") {
    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type === "STAFFME_REQUEST_CONNECTION_STATUS") {
        publishStoredState();
      }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[STATUS_KEY]) return;
      publishStoredState();
    });
  }
})();
