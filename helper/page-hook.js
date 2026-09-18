(() => {
  if (!window.__smtrackerAdminBridgeInstalled) {
    window.__smtrackerAdminBridgeInstalled = true;

    let adminRequestSequence = 0;

    function requestAdmin(action, payload) {
      return new Promise((resolve, reject) => {
        const requestId = `smtracker-admin-${Date.now()}-${adminRequestSequence++}`;
        const onMessage = (event) => {
          if (event.source !== window || !event.data || event.data.type !== "SMTRACKER_ADMIN_RESULT") return;
          if (event.data.requestId !== requestId) return;
          window.removeEventListener("message", onMessage);
          window.clearTimeout(timeoutId);
          if (event.data.ok) resolve(event.data.result);
          else reject(new Error(event.data.error || "SMTracker admin action failed."));
        };
        const timeoutId = window.setTimeout(() => {
          window.removeEventListener("message", onMessage);
          reject(new Error("SMTracker admin tools are not available in this frame."));
        }, 3000);

        window.addEventListener("message", onMessage);
        window.postMessage({
          type: "SMTRACKER_ADMIN_ACTION",
          action,
          payload: payload || null,
          requestId
        }, "*");
      });
    }

    window.SMTrackerAdmin = Object.freeze({
      open() {
        window.postMessage({ type: "SMTRACKER_ADMIN_OPEN" }, "*");
        return "SMTracker admin menu requested.";
      },
      close() {
        window.postMessage({ type: "SMTRACKER_ADMIN_CLOSE" }, "*");
        return "SMTracker admin menu closed.";
      },
      status() {
        return requestAdmin("status");
      },
      forceScan() {
        return requestAdmin("forceScan");
      },
      clearRows() {
        return requestAdmin("clearRows");
      },
      addTestRow(row) {
        return requestAdmin("addTestRow", row);
      },
      removeTestRows() {
        return requestAdmin("removeTestRows");
      }
    });
  }

  // The dashboard only needs the console admin bridge. Keep the SM network
  // hook limited to the actual SM source page.
  if (location.hostname === "staffmetimetracker.pages.dev") {
    if (!window.__smtrackerDashboardClearFallbackInstalled) {
      window.__smtrackerDashboardClearFallbackInstalled = true;

      function dashboardProfileEmail() {
        const elements = [
          document.getElementById("profileEmail"),
          document.getElementById("profileMenuEmail"),
          document.getElementById("profileDropdownEmail")
        ];
        for (const element of elements) {
          const value = String(element && (element.textContent || element.value) || "")
            .trim()
            .toLowerCase();
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value;
        }
        return "";
      }

      async function clearLegacyDashboardCopy() {
        if (window.__smtrackerDashboardClearHandlerInstalled === true) return;

        const email = dashboardProfileEmail();
        if (!email) throw new Error("The current SMTracker account could not be identified.");
        const key = `staffme-tracker:${email}`;
        const raw = window.localStorage.getItem(key);
        if (!raw) throw new Error("The current SMTracker profile was not found.");

        const profile = JSON.parse(raw);
        profile.rows = [];
        profile.source = "waiting";
        profile.lastSync = null;
        profile.hourlyDataClearPending = false;
        window.localStorage.setItem(key, JSON.stringify(profile));

        const response = await window.fetch("/api/sync", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            settings: profile.settings || {},
            rows: [],
            manualEntries: Array.isArray(profile.manualEntries) ? profile.manualEntries : [],
            reportedWeeks: Array.isArray(profile.reportedWeeks) ? profile.reportedWeeks : [],
            contracts: Array.isArray(profile.contracts) ? profile.contracts : [],
            lastSync: null
          })
        });
        if (!response.ok) throw new Error("The SMTracker account copy could not be cleared.");
        window.location.reload();
      }

      window.addEventListener("message", (event) => {
        if (event.source !== window || !event.data || event.data.type !== "SMTRACKER_CLEAR_DASHBOARD_DATA") return;
        clearLegacyDashboardCopy().catch((error) => {
          console.error("[SMTracker]", error);
        });
      });
    }
    return;
  }

  if (window.__staffMeTimeTrackerNetworkHook) return;
  window.__staffMeTimeTrackerNetworkHook = true;

  let lastRows = [];
  let consentGranted = false;

  function clean(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function numberValue(value) {
    const text = clean(value).replace(",", ".").replace(/[^0-9.-]/g, "");
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }

  function propertyValue(object, names) {
    if (!object || typeof object !== "object") return "";
    const keys = Object.keys(object);
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(object, name)) return object[name];
      const wanted = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const key = keys.find((candidate) =>
        candidate.toLowerCase().replace(/[^a-z0-9]/g, "") === wanted
      );
      if (key) return object[key];
    }
    return "";
  }

  function normalizeObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const date = clean(propertyValue(value, ["date"]));
    const time = clean(propertyValue(value, ["time"]));
    if (!date || !time) return null;

    return {
      date,
      time,
      agent: clean(propertyValue(value, ["agent", "name"])),
      workedHours: numberValue(propertyValue(value, ["workedHours", "workHours", "worked hours", "work hours", "hours worked", "worked", "work", "hours"])),
      evaluations: numberValue(propertyValue(value, ["totalEvaluations", "total evaluations", "evaluations"])),
      chat: numberValue(propertyValue(value, ["chat"])),
      idcheck: numberValue(propertyValue(value, ["idcheck", "id check", "idCheck"])),
      stream: numberValue(propertyValue(value, ["stream"]))
    };
  }

  function normalizeArray(value) {
    if (!Array.isArray(value) || value.length < 2) return null;
    const date = clean(value[0]);
    const time = clean(value[1]);
    if (!date || !time || date.length > 40 || time.length > 30) return null;
    if (!/[A-Za-z]{3,}|\d{1,2}[\/-]\d{1,2}/.test(date)) return null;
    if (!/^\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]m)?$/i.test(time)) return null;

    return {
      date,
      time,
      agent: clean(value[2]),
      workedHours: numberValue(value[3]),
      evaluations: numberValue(value[4]),
      chat: numberValue(value[5]),
      idcheck: numberValue(value[6]),
      stream: numberValue(value[7])
    };
  }

  function parseJsonCandidates(text) {
    if (typeof text !== "string") return [];
    const trimmed = text.trim();
    if (!trimmed) return [];

    const candidates = [trimmed];
    const stripped = trimmed.replace(/^\)\]\}',?\s*/, "");
    if (stripped !== trimmed) candidates.push(stripped);

    const bracketPositions = [stripped.indexOf("["), stripped.indexOf("{")]
      .filter((position) => position >= 0)
      .sort((a, b) => a - b);
    if (bracketPositions.length) candidates.push(stripped.slice(bracketPositions[0]));

    const parsed = [];
    for (const candidate of candidates) {
      try {
        parsed.push(JSON.parse(candidate));
      } catch (error) {
        // Google callback responses may include a non-JSON prefix.
      }
    }
    return parsed;
  }

  function collectRows(value, found) {
    if (typeof value === "string") {
      parseJsonCandidates(value).forEach((parsed) => collectRows(parsed, found));
      return;
    }

    const objectRow = normalizeObject(value);
    if (objectRow) {
      found.push(objectRow);
      return;
    }

    const arrayRow = normalizeArray(value);
    if (arrayRow) {
      found.push(arrayRow);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => collectRows(item, found));
    } else if (value && typeof value === "object") {
      Object.values(value).forEach((item) => collectRows(item, found));
    }
  }

  function uniqueRows(rows) {
    const map = new Map();
    rows.forEach((row) => {
      const key = [
        row.date,
        row.time,
        row.agent,
        row.workedHours,
        row.evaluations,
        row.chat,
        row.idcheck,
        row.stream
      ].join("|");
      map.set(key, row);
    });
    return Array.from(map.values());
  }

  function emitRows(rows) {
    if (!consentGranted) return;
    const unique = uniqueRows(rows);
    if (!unique.length) return;
    lastRows = unique;
    window.postMessage({
      type: "STAFFME_NETWORK_ROWS",
      rows: unique
    }, "*");
  }

  function inspectText(text) {
    if (!consentGranted) return;
    const rows = [];
    parseJsonCandidates(text).forEach((parsed) => collectRows(parsed, rows));
    emitRows(rows);
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function(...args) {
      return originalFetch.apply(this, args).then((response) => {
        if (!consentGranted) return response;
        try {
          response.clone().text().then(inspectText).catch(() => {});
        } catch (error) {
          // Ignore unreadable response bodies.
        }
        return response;
      });
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener("load", function() {
      try {
        if (!consentGranted) return;
        if (!this.responseType || this.responseType === "text") {
          inspectText(this.responseText || "");
        }
      } catch (error) {
        // Ignore unreadable response bodies.
      }
    });
    return originalSend.apply(this, args);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === "STAFFME_HELPER_CONSENT_GRANTED") {
      consentGranted = true;
      return;
    }
    if (event.data.type === "STAFFME_REQUEST_NETWORK_DATA" && consentGranted && lastRows.length) {
      window.postMessage({
        type: "STAFFME_NETWORK_ROWS",
        rows: lastRows
      }, "*");
    }
  });
})();
