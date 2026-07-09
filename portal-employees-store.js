(function (global) {
  "use strict";

  var LOCAL_KEY = "portal_employees_store";
  var PHOTO_FOCUS_VERSION = "18";
  var apiClient = global.PortalApiClient;
  var DEFAULT_PASSWORD = "work9999";
  var SYNC_INTERVAL_MS = 5000;
  var syncTimer = null;
  var lastSyncedAt = "";

  function parseStore(data) {
    return {
      updated_at: data.updated_at || "",
      employees: Array.isArray(data.employees) ? data.employees : [],
    };
  }

  function loadConfig() {
    return fetch("config.json")
      .then(function (response) {
        if (!response.ok) return {};
        return response.json();
      })
      .catch(function () {
        return {};
      });
  }

  function getAdminPassword(config) {
    return String((config && config.admin_password) || DEFAULT_PASSWORD);
  }

  function readLocalStore() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return null;
      return parseStore(JSON.parse(raw));
    } catch (_error) {
      return null;
    }
  }

  function writeLocalStore(store) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(parseStore(store)));
  }

  function filterSliderEmployees(employees) {
    return (employees || []).filter(function (employee) {
      return (
        employee &&
        String(employee.name || "").trim() &&
        String(employee.id || "").trim()
      );
    });
  }

  function broadcastEmployeesUpdate(store) {
    var parsed = parseStore(store);
    writeLocalStore(parsed);
    var employees = parsed.employees || [];
    document.dispatchEvent(
      new CustomEvent("portal-employees-updated", {
        detail: {
          all: employees,
          slider: filterSliderEmployees(employees),
          updated_at: parsed.updated_at || "",
        },
      })
    );
    return parsed;
  }

  function refreshEmployeeOnSite(employee) {
    var api = photoFocusApi();
    if (!api || !employee) return 0;
    if (api.refreshEmployeePhoto) {
      return api.refreshEmployeePhoto(employee, getEmployeePhotoUrl, document);
    }
    if (api.updateEmployeePhotoFocus) {
      return api.updateEmployeePhotoFocus(employee.id, employee.photo_focus, document);
    }
    return 0;
  }

  function syncEmployeePhotoGlobally(employee, cacheToken) {
    if (!employee || !employee.id) return;
    var api = photoFocusApi();
    if (api && api.syncEmployeeEverywhere) {
      api.syncEmployeeEverywhere(employee, function (item) {
        return getEmployeePhotoUrl(item, cacheToken);
      }, document);
      return;
    }
    refreshEmployeeOnSite(employee);
    if (api && api.notifyPhotoFocusChange) {
      api.notifyPhotoFocusChange(employee.id, employee.photo_focus);
    }
    if (api && api.notifyEmployeePhotoChange) {
      api.notifyEmployeePhotoChange(employee);
    }
  }

  function apiFetch(path, options) {
    if (apiClient && apiClient.apiFetch) {
      return apiClient.apiFetch(path, options);
    }
    return fetch(path, options || {});
  }

  function checkApi() {
    if (apiClient && apiClient.checkApiOnline) {
      return apiClient.checkApiOnline();
    }
    return fetch("/api/health", { method: "GET", cache: "no-store" }).then(function (response) {
      return response.ok;
    });
  }

  function clearStaleClientCache() {
    if (localStorage.getItem("portal_photo_focus_version") === PHOTO_FOCUS_VERSION) return;
    localStorage.removeItem(LOCAL_KEY);
    localStorage.setItem("portal_photo_focus_version", PHOTO_FOCUS_VERSION);
  }

  clearStaleClientCache();

  function loadPublicStore() {
    var fetchPromise = apiClient && apiClient.resolveApiBase
      ? apiClient.resolveApiBase(false).then(function () {
          return apiFetch("/api/employees", { method: "GET", cache: "no-store" });
        })
      : apiFetch("/api/employees", { method: "GET", cache: "no-store" });

    return fetchPromise
      .then(function (response) {
        if (!response.ok) throw new Error("api");
        return response.json();
      })
      .then(function (data) {
        var store = parseStore(data);
        writeLocalStore(store);
        return store;
      })
      .catch(function () {
        var local = readLocalStore();
        if (local && local.employees.length) {
          return local;
        }
        return fetch("data/employees.json", { cache: "no-store" })
          .then(function (response) {
            if (!response.ok) throw new Error("json");
            return response.json();
          })
          .then(function (data) {
            var store = parseStore(data);
            writeLocalStore(store);
            return store;
          });
      })
      .catch(function () {
        return parseStore({ updated_at: "", employees: [] });
      });
  }

  function loadPublicEmployees() {
    return loadPublicStore().then(function (store) {
      return store.employees;
    });
  }

  function getEmployeePhotoUrl(employee, cacheToken) {
    if (!employee || !employee.photo) return "";
    var api = photoFocusApi();
    var rawPhoto = employee.photo;
    if (apiClient && apiClient.resolveAssetUrl) {
      rawPhoto = apiClient.resolveAssetUrl(rawPhoto);
    }
    var url = api && api.encodePhotoSrc ? api.encodePhotoSrc(rawPhoto) : String(rawPhoto);
    var token =
      cacheToken ||
      employee.photo_cache ||
      employee.updated_at ||
      "";
    if (!token) return url;
    var joiner = url.indexOf("?") === -1 ? "?" : "&";
    return url + joiner + "v=" + encodeURIComponent(String(token));
  }

  function photoFocusApi() {
    return global.PortalPhotoFocus || null;
  }

  function normalizePhotoFocus(value) {
    var api = photoFocusApi();
    if (api) return api.normalizePhotoFocus(value);
    return { x: 50, y: 50, scale: 1 };
  }

  function getEmployeePhotoStyle(employee) {
    return "";
  }

  function applyEmployeePhotoFocus(img, employee) {
    if (!img) return;
    var api = photoFocusApi();
    if (!api) return;
    api.applyPhotoFocus(img.parentElement, img, employee && employee.photo_focus);
  }

  function wrapEmployeePhotoMarkup(className, employee, altText, extraClass) {
    var localStore = readLocalStore();
    var photoUrl = getEmployeePhotoUrl(employee, localStore && localStore.updated_at);
    if (!photoUrl) {
      return '<div class="' + className + '" aria-hidden="true"></div>';
    }
    var api = photoFocusApi();
    if (!api) {
      return (
        '<div class="' +
        className +
        ' has-photo" aria-hidden="true">' +
        '<div class="portal-photo-frame">' +
        '<img class="portal-photo-frame__img" src="' +
        String(employee.photo) +
        '" alt="' +
        String(altText || "") +
        '"></div></div>'
      );
    }
    return api.wrapPhotoMarkup(
      className + " has-photo",
      String(photoUrl).replace(/"/g, "&quot;"),
      altText,
      employee.photo_focus,
      extraClass,
      employee.id
    );
  }

  function hydrateEmployeePhotos(root) {
    var api = photoFocusApi();
    if (!api) return;
    api.hydratePhotoFrames(root);
  }

  function stopEmployeesSync() {
    if (syncTimer) {
      window.clearInterval(syncTimer);
      syncTimer = null;
    }
  }

  function startEmployeesSync(onChange, intervalMs) {
    stopEmployeesSync();
    var delay = intervalMs || SYNC_INTERVAL_MS;

    function poll() {
      loadPublicStore().then(function (store) {
        if (!store.updated_at || store.updated_at === lastSyncedAt) return;
        lastSyncedAt = store.updated_at;
        onChange(store);
      });
    }

    return loadPublicStore().then(function (store) {
      lastSyncedAt = store.updated_at || "";
      syncTimer = window.setInterval(poll, delay);
      return store;
    });
  }

  global.PortalEmployeesStore = {
    LOCAL_KEY: LOCAL_KEY,
    DEFAULT_PASSWORD: DEFAULT_PASSWORD,
    SYNC_INTERVAL_MS: SYNC_INTERVAL_MS,
    apiFetch: apiFetch,
    checkApi: checkApi,
    parseStore: parseStore,
    loadConfig: loadConfig,
    getAdminPassword: getAdminPassword,
    readLocalStore: readLocalStore,
    writeLocalStore: writeLocalStore,
    broadcastEmployeesUpdate: broadcastEmployeesUpdate,
    refreshEmployeeOnSite: refreshEmployeeOnSite,
    syncEmployeePhotoGlobally: syncEmployeePhotoGlobally,
    loadPublicStore: loadPublicStore,
    loadPublicEmployees: loadPublicEmployees,
    getEmployeePhotoUrl: getEmployeePhotoUrl,
    normalizePhotoFocus: normalizePhotoFocus,
    getEmployeePhotoStyle: getEmployeePhotoStyle,
    applyEmployeePhotoFocus: applyEmployeePhotoFocus,
    wrapEmployeePhotoMarkup: wrapEmployeePhotoMarkup,
    hydrateEmployeePhotos: hydrateEmployeePhotos,
    updateEmployeePhotoFocus: function (employeeId, focus, root) {
      var api = photoFocusApi();
      if (!api || !api.updateEmployeePhotoFocus) return 0;
      return api.updateEmployeePhotoFocus(employeeId, focus, root);
    },
    ensurePhotoFrameLayout: function (frame, img, focus) {
      var api = photoFocusApi();
      if (!api || !api.ensureFrameLayout) return;
      api.ensureFrameLayout(frame, img, focus, 0);
    },
    startEmployeesSync: startEmployeesSync,
    stopEmployeesSync: stopEmployeesSync,
  };
})(window);