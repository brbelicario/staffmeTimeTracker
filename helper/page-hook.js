(() => {
  if (window.__staffMeTimeTrackerNetworkHook) return;
  window.__staffMeTimeTrackerNetworkHook = true;

  let lastRows = [];

  function clean(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\\s+/g, " ")
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
      workedHours: numberValue(propertyValue(value, ["workedHours", "worked hours", "worked", "hours"])),
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
    const stripped = trimmed.replace(/^\\)\\]\\}',?\\s*/, "");
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
    const unique = uniqueRows(rows);
    if (!unique.length) return;
    lastRows = unique;
    window.postMessage({
      type: "STAFFME_NETWORK_ROWS",
      rows: unique
    }, "*");
  }

  function inspectText(text) {
    const rows = [];
    parseJsonCandidates(text).forEach((parsed) => collectRows(parsed, rows));
    emitRows(rows);
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function(...args) {
      return originalFetch.apply(this, args).then((response) => {
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
    this.__staffMeTrackerUrl = String(url || "");
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener("load", function() {
      try {
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
    if (event.data.type === "STAFFME_REQUEST_NETWORK_DATA" && lastRows.length) {
      window.postMessage({
        type: "STAFFME_NETWORK_ROWS",
        rows: lastRows
      }, "*");
    }
  });
})();