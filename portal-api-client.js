(function (global) {
  "use strict";

  var API_BASE_OVERRIDE_KEY = "portal_api_base_url";
  var configCache = null;
  var configPromise = null;
  var apiBaseResolved = null;
  var apiReadyPromise = null;

  function normalizeApiBase(base) {
    return String(base || "").replace(/\/+$/, "");
  }

  function isLocalPortalHost() {
    var host = String(global.location && global.location.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  }

  function loadConfig() {
    if (configPromise) return configPromise;
    configPromise = fetch("config.json", { method: "GET", cache: "no-store" })
      .then(function (response) {
        if (!response.ok) return {};
        return response.json();
      })
      .catch(function () {
        return {};
      })
      .then(function (data) {
        configCache = data && typeof data === "object" ? data : {};
        return configCache;
      });
    return configPromise;
  }

  function getConfig() {
    return configCache || {};
  }

  function getApiBaseOverride() {
    try {
      return normalizeApiBase(localStorage.getItem(API_BASE_OVERRIDE_KEY) || "");
    } catch (_error) {
      return "";
    }
  }

  function setApiBaseOverride(base) {
    var normalized = normalizeApiBase(base);
    try {
      if (normalized) {
        localStorage.setItem(API_BASE_OVERRIDE_KEY, normalized);
      } else {
        localStorage.removeItem(API_BASE_OVERRIDE_KEY);
      }
    } catch (_error) {
      /* ignore */
    }
    apiBaseResolved = null;
    apiReadyPromise = null;
    return normalized;
  }

  function getConfiguredApiBase() {
    return getApiBaseOverride() || normalizeApiBase(getConfig().api_base_url);
  }

  function probeApiBase(base) {
    var url = (base || "") + "/api/health";
    return fetch(url, { method: "GET", cache: "no-store", mode: "cors" })
      .then(function (response) {
        if (response.status === 404) throw new Error("static-server");
        if (!response.ok) throw new Error("api unavailable");
        return response.json();
      })
      .then(function (data) {
        if (data && data.ok && data.service === "portal") {
          return base || "";
        }
        throw new Error("api unavailable");
      });
  }

  function buildApiCandidates() {
    var seen = {};
    var list = [];
    function push(base) {
      var normalized = normalizeApiBase(base);
      if (seen[normalized]) return;
      seen[normalized] = true;
      list.push(normalized);
    }

    push(getConfiguredApiBase());
    push("");
    if (isLocalPortalHost()) {
      push("http://127.0.0.1:8780");
      push("http://localhost:8780");
    }
    return list;
  }

  function resolveApiBase(force) {
    if (!force && apiBaseResolved !== null) {
      return Promise.resolve(apiBaseResolved);
    }

    return loadConfig().then(function () {
      var candidates = buildApiCandidates();
      var index = 0;

      function tryNext() {
        if (index >= candidates.length) {
          apiBaseResolved = getConfiguredApiBase();
          return apiBaseResolved;
        }
        var candidate = candidates[index];
        index += 1;
        return probeApiBase(candidate)
          .then(function (base) {
            apiBaseResolved = base;
            return base;
          })
          .catch(function () {
            return tryNext();
          });
      }

      return tryNext();
    });
  }

  function ensureApiReady(force) {
    if (!force && apiReadyPromise) return apiReadyPromise;
    apiReadyPromise = resolveApiBase(force).then(function (base) {
      return probeApiBase(base).then(function () {
        return true;
      });
    });
    return apiReadyPromise.catch(function () {
      apiReadyPromise = null;
      throw new Error("api unavailable");
    });
  }

  function getApiBase() {
    if (apiBaseResolved !== null) return apiBaseResolved;
    return getConfiguredApiBase();
  }

  function apiUrl(path) {
    var target = String(path || "");
    if (!target) return getApiBase();
    if (/^https?:\/\//i.test(target)) return target;
    var base = getApiBase();
    if (target.charAt(0) !== "/") target = "/" + target;
    return (base || "") + target;
  }

  function resolveAssetUrl(path) {
    var value = String(path || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value) || value.indexOf("data:") === 0) return value;
    var base = getApiBase();
    if (!base) return value;
    if (value.charAt(0) !== "/") value = "/" + value;
    return base + value;
  }

  function apiFetch(path, options) {
    return resolveApiBase(false).then(function () {
      return fetch(apiUrl(path), options || {});
    });
  }

  function checkApiOnline() {
    return resolveApiBase(false)
      .then(function (base) {
        return probeApiBase(base).then(function () {
          return true;
        });
      })
      .catch(function (error) {
        if (error && error.message === "static-server") {
          if (!isLocalPortalHost() && !getConfiguredApiBase()) {
            throw new Error("remote-host");
          }
          throw new Error("static-server");
        }
        throw error;
      });
  }

  global.PortalApiClient = {
    API_BASE_OVERRIDE_KEY: API_BASE_OVERRIDE_KEY,
    loadConfig: loadConfig,
    getConfig: getConfig,
    getApiBaseOverride: getApiBaseOverride,
    setApiBaseOverride: setApiBaseOverride,
    getConfiguredApiBase: getConfiguredApiBase,
    resolveApiBase: resolveApiBase,
    ensureApiReady: ensureApiReady,
    getApiBase: getApiBase,
    apiUrl: apiUrl,
    apiFetch: apiFetch,
    resolveAssetUrl: resolveAssetUrl,
    checkApiOnline: checkApiOnline,
    isLocalPortalHost: isLocalPortalHost,
  };
})(window);