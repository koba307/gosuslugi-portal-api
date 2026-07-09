(function () {
  "use strict";

  var TOKEN_KEY = "portal_admin_token";
  var PHOTO_FOCUS_VERSION = "19";
  var employees = [];
  var editingId = null;
  var updatedAt = "";

  var loginView = document.getElementById("login-view");
  var appView = document.getElementById("app-view");
  var loginForm = document.getElementById("login-form");
  var loginPassword = document.getElementById("login-password");
  var loginApiUrl = document.getElementById("login-api-url");
  var loginApiField = document.getElementById("login-api-field");
  var loginSubmitBtn = loginForm.querySelector('button[type="submit"]');
  var logoutBtn = document.getElementById("logout-btn");
  var listSearch = document.getElementById("list-search");
  var tableBody = document.getElementById("employees-table-body");
  var cardsContainer = document.getElementById("employees-cards");
  var emptyState = document.getElementById("employees-empty");
  var addEmployeeBtn = document.getElementById("add-employee-btn");
  var publishSiteBtn = document.getElementById("publish-site-btn");
  var employeeModal = document.getElementById("employee-modal");
  var employeeForm = document.getElementById("employee-form");
  var modalTitle = document.getElementById("modal-title");
  var modalCloseBtn = document.getElementById("modal-close-btn");
  var deleteEmployeeBtn = document.getElementById("delete-employee-btn");
  var saveEmployeeBtn = document.getElementById("save-employee-btn");
  var photoInput = document.getElementById("field-photo");
  var photoPreview = document.getElementById("photo-preview");
  var photoPreviewFrame = document.getElementById("photo-preview-frame");
  var photoPreviewImg = document.getElementById("photo-preview-img");
  var photoFocusApi = window.PortalPhotoFocus;
  var removePhotoBtn = document.getElementById("remove-photo-btn");
  var photoEditor = window.AdminPhotoEditor;
  var toast = document.getElementById("admin-toast");
  var statsEl = document.getElementById("admin-stats");
  var modeEl = document.getElementById("admin-mode");
  var toastTimer = null;
  var pendingPhotoFile = null;
  var removePhoto = false;
  var currentPhotoUrl = "";
  var pendingPhotoFocus = { x: 50, y: 50, scale: 1 };
  var pendingPhotoPreviewUrl = "";
  var focusXInput = document.getElementById("field-focus-x");
  var focusYInput = document.getElementById("field-focus-y");
  var focusScaleInput = document.getElementById("field-focus-scale");

  var store = window.PortalEmployeesStore;
  var MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  var SITE_OFFLINE_MESSAGE =
    "Сервер не отвечает. Запустите start.bat или: python portal_api.py 8780";
  var SITE_STATIC_MESSAGE =
    "На порту 8780 запущен сервер без API (http.server). Закройте лишние окна Python и запустите start.bat";
  var SITE_REMOTE_MESSAGE =
    "Укажите URL API (туннель) в поле входа и запустите portal_api.py через start.bat или expose-api.ps1";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  function showToast(message, isError) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("is-error", Boolean(isError));
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 3200);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setLoading(button, loading, text) {
    if (!button) return;
    button.disabled = loading;
    if (text) button.textContent = text;
  }

  function formatUpdatedAt(value) {
    if (!value) return "";
    return value.replace("T", " ").replace("+00:00", " UTC");
  }

  function updateStats() {
    if (!statsEl) return;
    var suffix = updatedAt ? " · синхронизировано " + formatUpdatedAt(updatedAt) : "";
    statsEl.textContent = employees.length + " сотрудник(ов)" + suffix;
  }

  function updateModeLabel() {
    if (!modeEl) return;
    var apiBase =
      window.PortalApiClient && window.PortalApiClient.getApiBase
        ? window.PortalApiClient.getApiBase()
        : "";
    modeEl.textContent = apiBase
      ? "Режим: удалённый API (" + apiBase + ") · сайт обновляется без передеплоя"
      : "Режим: локальный API · изменения сразу доступны на сайте";
    modeEl.classList.remove("admin-mode--local");
  }

  function resolveApiError(error) {
    if (error && error.message === "remote-host") {
      return new Error(SITE_REMOTE_MESSAGE);
    }
    if (error && error.message === "static-server") {
      return new Error(SITE_STATIC_MESSAGE);
    }
    if (error && error.message) {
      return error;
    }
    return new Error(SITE_OFFLINE_MESSAGE);
  }

  function ensureApiOnline() {
    return store
      .checkApi()
      .then(function (online) {
        if (!online) {
          throw new Error(SITE_OFFLINE_MESSAGE);
        }
        return true;
      })
      .catch(function (error) {
        throw resolveApiError(error);
      });
  }

  function apiRequest(path, options) {
    var opts = options || {};
    var headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    var token = getToken();
    if (token) {
      headers.Authorization = "Bearer " + token;
    }

    var request = store && store.apiFetch ? store.apiFetch(path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    }) : fetch(path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });

    return request
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (!response.ok) {
              var error = new Error(data.error || "Ошибка сервера (" + response.status + ")");
              error.status = response.status;
              throw error;
            }
            return data;
          });
      })
      .catch(function (error) {
        if (error.status) throw error;
        throw resolveApiError(error);
      });
  }

  function normalizeEmployee(raw) {
    var rating = Number(raw.rating);
    if (Number.isNaN(rating)) rating = 0;
    rating = Math.max(0, Math.min(5, rating));

    var id = String(raw.id || "").trim();
    var name = String(raw.name || "").trim();
    var position = String(raw.position || "").trim();

    if (!id) throw new Error("Табельный номер обязателен");
    if (!name) throw new Error("ФИО обязательно");
    if (!position) throw new Error("Должность обязательна");

    return {
      id: id,
      name: name,
      position: position,
      department: String(raw.department || "").trim(),
      hired: String(raw.hired || "").trim(),
      rating: Math.round(rating * 10) / 10,
      notes: String(raw.notes || "").trim(),
      photo: String(raw.photo || "").trim(),
      photo_focus: normalizePhotoFocus(raw.photo_focus),
      personal_code: normalizePersonalCode(raw.personal_code, true),
    };
  }

  function normalizePhotoFocus(value) {
    if (photoEditor && photoEditor.normalizeFocus) {
      return photoEditor.normalizeFocus(value);
    }
    if (store && store.normalizePhotoFocus) {
      return store.normalizePhotoFocus(value);
    }
    return { x: 50, y: 50, scale: 1 };
  }

  function syncPhotoFocusOnFrame(frame, focus) {
    if (!frame || !photoFocusApi) return;
    var normalized = normalizePhotoFocus(focus);
    photoFocusApi.writeFocusToFrame(frame, normalized);
    photoFocusApi.bindPhotoFrame(frame);
    var img = frame.querySelector("img");
    if (!img) return;

    function render() {
      photoFocusApi.applyPhotoFocus(frame, img, normalized);
    }

    if (img.complete && img.naturalWidth) {
      render();
      return;
    }

    img.addEventListener("load", render, { once: true });
  }

  function renderTablePhotoCell(employee) {
    var photoUrl = getPhotoUrl(employee);
    if (!photoUrl) {
      return '<span class="admin-table-photo admin-table-photo--empty" aria-hidden="true"></span>';
    }
    if (photoFocusApi) {
      return photoFocusApi.wrapPhotoMarkup(
        "admin-table-photo-wrap",
        escapeHtml(photoUrl),
        "",
        employee.photo_focus,
        "",
        employee.id
      );
    }
    return (
      '<div class="admin-table-photo-wrap has-photo">' +
      '<div class="portal-photo-frame admin-table-photo">' +
      '<img class="portal-photo-frame__img" src="' +
      escapeHtml(photoUrl) +
      '" alt=""></div></div>'
    );
  }

  function savePhotoFocusApi(employeeId, focus) {
    var path = "/api/employees/" + encodeURIComponent(employeeId) + "/photo-focus";
    var body = { photo_focus: normalizePhotoFocus(focus) };
    return apiRequest(path, { method: "POST", body: body }).catch(function (error) {
      if (error && error.status === 405) {
        return apiRequest(path, { method: "PATCH", body: body });
      }
      throw error;
    });
  }

  function photoFocusEquals(a, b) {
    var left = normalizePhotoFocus(a);
    var right = normalizePhotoFocus(b);
    return left.x === right.x && left.y === right.y && left.scale === right.scale;
  }

  function syncEmployeeGlobally(employee, cacheToken) {
    if (!employee || !store) return;
    if (store.syncEmployeePhotoGlobally) {
      store.syncEmployeePhotoGlobally(employee, cacheToken || updatedAt);
    }
    if (store.broadcastEmployeesUpdate) {
      store.broadcastEmployeesUpdate({ employees: employees, updated_at: updatedAt });
    }
    if (store.hydrateEmployeePhotos) {
      store.hydrateEmployeePhotos(document);
    }
  }

  function applyPhotoFocusEverywhere(employeeId, focus, employee) {
    var normalized = normalizePhotoFocus(focus);
    var target =
      employee ||
      employees.find(function (item) {
        return item.id === employeeId;
      });
    if (target) {
      target.photo_focus = normalized;
      syncEmployeeGlobally(target);
    }
    if (photoPreviewFrame) {
      if (employeeId) {
        photoPreviewFrame.setAttribute("data-employee-id", employeeId);
      }
      syncPhotoFocusOnFrame(photoPreviewFrame, normalized);
    }
    if (photoFocusApi && photoFocusApi.notifyPhotoFocusChange) {
      photoFocusApi.notifyPhotoFocusChange(employeeId, normalized);
    }
  }

  function persistPhotoFocus(employeeId, focus) {
    var normalizedFocus = normalizePhotoFocus(focus);
    pendingPhotoFocus = normalizedFocus;
    return savePhotoFocusApi(employeeId, normalizedFocus).then(function (result) {
      var index = employees.findIndex(function (item) {
        return item.id === employeeId;
      });
      if (index !== -1 && result.employee) {
        employees[index] = result.employee;
      }
      if (result.updated_at) {
        updatedAt = result.updated_at;
      }
      var savedFocus =
        result.employee && result.employee.photo_focus
          ? result.employee.photo_focus
          : normalizedFocus;
      pendingPhotoFocus = normalizePhotoFocus(savedFocus);
      applyPhotoFocusEverywhere(employeeId, savedFocus, result.employee);
      updatePhotoPreview();
      renderTable();
      return result.employee;
    });
  }

  function clearStaleClientCache() {
    if (localStorage.getItem("portal_photo_focus_version") === PHOTO_FOCUS_VERSION) return;
    localStorage.removeItem(store.LOCAL_KEY);
    localStorage.setItem("portal_photo_focus_version", PHOTO_FOCUS_VERSION);
  }

  function revokePhotoPreviewUrl() {
    if (pendingPhotoPreviewUrl && pendingPhotoPreviewUrl.indexOf("blob:") === 0) {
      URL.revokeObjectURL(pendingPhotoPreviewUrl);
    }
    pendingPhotoPreviewUrl = "";
  }

  function getEditablePhotoSrc() {
    if (pendingPhotoPreviewUrl) return pendingPhotoPreviewUrl;
    if (pendingPhotoFile) return URL.createObjectURL(pendingPhotoFile);
    if (!removePhoto && currentPhotoUrl) return currentPhotoUrl;
    return "";
  }

  function normalizePersonalCode(value, allowEmpty) {
    var code = String(value || "").replace(/\D/g, "").slice(0, 6);
    if (!code) {
      if (allowEmpty) return "";
      throw new Error("Персональный код должен содержать 6 цифр");
    }
    if (code.length !== 6) {
      throw new Error("Персональный код должен содержать 6 цифр");
    }
    return code;
  }

  function syncFocusFieldsFromPending() {
    if (!focusXInput || !focusYInput || !focusScaleInput) return;
    var focus = normalizePhotoFocus(pendingPhotoFocus);
    focusXInput.value = String(focus.x);
    focusYInput.value = String(focus.y);
    focusScaleInput.value = String(focus.scale);
  }

  function readFocusFieldsToPending() {
    if (!focusXInput || !focusYInput || !focusScaleInput) return pendingPhotoFocus;
    pendingPhotoFocus = normalizePhotoFocus({
      x: focusXInput.value,
      y: focusYInput.value,
      scale: focusScaleInput.value,
    });
    return pendingPhotoFocus;
  }

  function resolvePhotoPathFromForm(existing) {
    if (removePhoto) return "";
    if (pendingPhotoFile) return existing && existing.photo ? existing.photo : "";
    if (existing && existing.photo) return existing.photo;
    return "";
  }

  function getPhotoUrl(employee) {
    if (!employee || !employee.photo) return "";
    return store && store.getEmployeePhotoUrl
      ? store.getEmployeePhotoUrl(employee, updatedAt)
      : employee.photo;
  }

  function resetPhotoState(photoUrl, photoFocus) {
    revokePhotoPreviewUrl();
    pendingPhotoFile = null;
    removePhoto = false;
    currentPhotoUrl = photoUrl || "";
    pendingPhotoFocus = normalizePhotoFocus(photoFocus);
    if (photoInput) photoInput.value = "";
    syncFocusFieldsFromPending();
    updatePhotoPreview();
  }

  function updatePhotoPreview() {
    var previewUrl = "";
    if (pendingPhotoPreviewUrl) {
      previewUrl = pendingPhotoPreviewUrl;
    } else if (pendingPhotoFile) {
      previewUrl = URL.createObjectURL(pendingPhotoFile);
      pendingPhotoPreviewUrl = previewUrl;
    } else if (!removePhoto && currentPhotoUrl) {
      previewUrl = currentPhotoUrl;
    }

    if (!photoPreview || !photoPreviewImg) return;

    if (previewUrl) {
      var encodedPreview = photoFocusApi && photoFocusApi.encodePhotoSrc
        ? photoFocusApi.encodePhotoSrc(previewUrl)
        : previewUrl;
      if (editingId && photoPreviewFrame) {
        photoPreviewFrame.setAttribute("data-employee-id", editingId);
      }
      var currentPreviewSrc = photoPreviewImg.getAttribute("src") || "";
      var previewChanged =
        !photoFocusApi ||
        !photoFocusApi.normalizePhotoSrc ||
        photoFocusApi.normalizePhotoSrc(currentPreviewSrc) !==
          photoFocusApi.normalizePhotoSrc(encodedPreview);
      if (previewChanged) {
        photoPreviewImg.src = encodedPreview;
      } else if (photoFocusApi) {
        photoFocusApi.ensureFrameLayout(
          photoPreviewFrame,
          photoPreviewImg,
          pendingPhotoFocus,
          0
        );
      }
      readFocusFieldsToPending();
      syncPhotoFocusOnFrame(photoPreviewFrame, pendingPhotoFocus);
      photoPreview.hidden = false;
      photoPreview.removeAttribute("aria-hidden");
      if (removePhotoBtn) removePhotoBtn.hidden = false;
      return;
    }

    photoPreviewImg.removeAttribute("src");
    photoPreviewImg.removeAttribute("style");
    photoPreview.hidden = true;
    photoPreview.setAttribute("aria-hidden", "true");
    if (removePhotoBtn) removePhotoBtn.hidden = true;
  }

  function openPhotoEditor(src) {
    if (!photoEditor || !src) return;
    photoEditor.open({
      src: src,
      focus: pendingPhotoFocus,
      onSave: function (focus) {
        pendingPhotoFocus = normalizePhotoFocus(focus);
        syncFocusFieldsFromPending();
        updatePhotoPreview();
        if (editingId) {
          persistPhotoFocus(editingId, pendingPhotoFocus)
            .then(function () {
              showToast("Положение фото сохранено везде");
            })
            .catch(function (error) {
              showToast(error.message, true);
            });
          return;
        }
        showToast("Положение задано. Нажмите «Сохранить» в анкете");
      },
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("Не удалось прочитать файл"));
      };
      reader.readAsDataURL(file);
    });
  }

  function validatePhotoFile(file) {
    if (!file) return null;
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) {
      throw new Error("Допустимы только JPEG, PNG, WebP и GIF");
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new Error("Файл слишком большой (максимум 5 МБ)");
    }
    return file;
  }

  function uploadPhotoApi(id, dataUrl, focus) {
    return apiRequest("/api/employees/" + encodeURIComponent(id) + "/photo", {
      method: "POST",
      body: {
        image: dataUrl,
        photo_focus: normalizePhotoFocus(focus),
      },
    });
  }

  function deletePhotoApi(id) {
    return apiRequest("/api/employees/" + encodeURIComponent(id) + "/photo", {
      method: "DELETE",
    });
  }

  function applyPhotoChanges(employeeId) {
    if (removePhoto) {
      return deletePhotoApi(employeeId).then(loadEmployees);
    }

    if (pendingPhotoFile) {
      return readFileAsDataUrl(pendingPhotoFile).then(function (dataUrl) {
        return uploadPhotoApi(employeeId, dataUrl, pendingPhotoFocus).then(function (result) {
          if (result && result.employee) {
            if (result.updated_at) {
              updatedAt = result.updated_at;
            }
            var index = employees.findIndex(function (item) {
              return item.id === employeeId;
            });
            if (index !== -1) {
              employees[index] = result.employee;
            } else {
              employees.push(result.employee);
            }
            if (result.employee.photo) {
              currentPhotoUrl = getPhotoUrl(result.employee);
              pendingPhotoFocus = normalizePhotoFocus(result.employee.photo_focus);
              updatePhotoPreview();
            }
            syncEmployeeGlobally(result.employee, result.updated_at || updatedAt);
          }
          return loadEmployees();
        });
      });
    }

    var existing = employees.find(function (item) {
      return item.id === employeeId;
    });
    if (
      existing &&
      existing.photo &&
      !photoFocusEquals(existing.photo_focus, pendingPhotoFocus)
    ) {
      return persistPhotoFocus(employeeId, pendingPhotoFocus);
    }

    return Promise.resolve();
  }

  function showLogin() {
    loginView.hidden = false;
    appView.hidden = true;
  }

  function showApp() {
    loginView.hidden = true;
    appView.hidden = false;
  }

  function normalizeQuery(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function getFilteredEmployees() {
    var query = normalizeQuery(listSearch.value);
    if (!query) return employees.slice();
    return employees.filter(function (employee) {
      return (
        normalizeQuery(employee.id).indexOf(query) !== -1 ||
        normalizeQuery(employee.name).indexOf(query) !== -1 ||
        normalizeQuery(employee.position).indexOf(query) !== -1 ||
        normalizeQuery(employee.department).indexOf(query) !== -1
      );
    });
  }

  function renderCardPhoto(employee) {
    var photoUrl = getPhotoUrl(employee);
    if (!photoUrl) {
      return '<span class="admin-employee-card__photo--empty" aria-hidden="true"></span>';
    }
    if (photoFocusApi) {
      return (
        '<div class="admin-employee-card__photo">' +
        photoFocusApi.wrapPhotoMarkup(
          "admin-table-photo-wrap",
          escapeHtml(photoUrl),
          "",
          employee.photo_focus,
          "",
          employee.id
        ) +
        "</div>"
      );
    }
    return (
      '<div class="admin-employee-card__photo">' +
      '<div class="portal-photo-frame admin-table-photo">' +
      '<img class="portal-photo-frame__img" src="' +
      escapeHtml(photoUrl) +
      '" alt=""></div></div>'
    );
  }

  function renderCards(rows) {
    if (!cardsContainer) return;
    if (!rows.length) {
      cardsContainer.innerHTML = "";
      return;
    }

    cardsContainer.innerHTML = rows
      .map(function (employee) {
        var rating = Number(employee.rating || 0).toFixed(1).replace(".", ",");
        return (
          '<article class="admin-employee-card">' +
          renderCardPhoto(employee) +
          '<div class="admin-employee-card__body">' +
          '<p class="admin-employee-card__name">' + escapeHtml(employee.name) + "</p>" +
          '<p class="admin-employee-card__meta">' + escapeHtml(employee.position) + "</p>" +
          '<div class="admin-employee-card__details">' +
          '<span class="admin-employee-card__tag">№ ' + escapeHtml(employee.id) + "</span>" +
          (employee.department
            ? '<span class="admin-employee-card__tag">' + escapeHtml(employee.department) + "</span>"
            : "") +
          '<span class="admin-employee-card__tag admin-employee-card__tag--rating">' + rating + "</span>" +
          (employee.personal_code
            ? '<span class="admin-employee-card__tag">Код ' + escapeHtml(employee.personal_code) + "</span>"
            : "") +
          "</div></div>" +
          '<button class="admin-btn admin-btn--ghost admin-btn--sm" type="button" data-edit-id="' +
          escapeHtml(employee.id) +
          '">Изменить</button>' +
          "</article>"
        );
      })
      .join("");

    if (store && store.hydrateEmployeePhotos) {
      store.hydrateEmployeePhotos(cardsContainer);
      window.requestAnimationFrame(function () {
        store.hydrateEmployeePhotos(cardsContainer);
      });
    }
  }

  function renderTable() {
    var rows = getFilteredEmployees();
    if (!rows.length) {
      if (tableBody) tableBody.innerHTML = "";
      renderCards([]);
      emptyState.hidden = employees.length > 0;
      return;
    }

    emptyState.hidden = true;

    if (tableBody) {
      tableBody.innerHTML = rows
        .map(function (employee) {
          var photoCell = renderTablePhotoCell(employee);

          return (
            "<tr>" +
            "<td>" + photoCell + "</td>" +
            "<td>" + escapeHtml(employee.id) + "</td>" +
            "<td>" + escapeHtml(employee.name) + "</td>" +
            "<td>" + escapeHtml(employee.position) + "</td>" +
            "<td>" + escapeHtml(employee.department || "—") + "</td>" +
            '<td><span class="admin-rating">' + Number(employee.rating || 0).toFixed(1).replace(".", ",") + "</span></td>" +
            "<td>" + escapeHtml(employee.personal_code || "—") + "</td>" +
            '<td><button class="admin-btn admin-btn--ghost admin-btn--sm" type="button" data-edit-id="' + escapeHtml(employee.id) + '">Изменить</button></td>' +
            "</tr>"
          );
        })
        .join("");

      if (store && store.hydrateEmployeePhotos) {
        store.hydrateEmployeePhotos(tableBody);
        window.requestAnimationFrame(function () {
          store.hydrateEmployeePhotos(tableBody);
        });
      }
    }

    renderCards(rows);
  }

  function publishSiteApi() {
    return apiRequest("/api/admin/publish-site", { method: "POST" });
  }

  function loadEmployees() {
    return apiRequest("/api/employees/all").then(function (data) {
      employees = data.employees || [];
      updatedAt = data.updated_at || "";
      if (store.broadcastEmployeesUpdate) {
        store.broadcastEmployeesUpdate(data);
      } else {
        store.writeLocalStore(data);
      }
      renderTable();
      updateStats();
      if (store.hydrateEmployeePhotos) {
        store.hydrateEmployeePhotos(document);
      }
      return employees;
    });
  }

  function openModal(employee, isNew) {
    if (!isNew && employee && employee.id) {
      var fresh = employees.find(function (item) {
        return item.id === employee.id;
      });
      if (fresh) employee = fresh;
    }

    editingId = isNew ? null : employee.id;
    modalTitle.textContent = isNew ? "Новый сотрудник" : "Редактирование анкеты";
    deleteEmployeeBtn.hidden = isNew;

    employeeForm.id.value = employee.id || "";
    employeeForm.id.disabled = false;
    employeeForm.name.value = employee.name || "";
    employeeForm.position.value = employee.position || "";
    employeeForm.department.value = employee.department || "";
    employeeForm.hired.value = employee.hired || "";
    employeeForm.rating.value = employee.rating != null ? employee.rating : "";
    employeeForm.notes.value = employee.notes || "";
    if (employeeForm.personal_code) {
      employeeForm.personal_code.value = employee.personal_code || "";
    }
    resetPhotoState(getPhotoUrl(employee) || employee.photo || "", employee.photo_focus);
    if (photoPreviewFrame) {
      if (editingId) {
        photoPreviewFrame.setAttribute("data-employee-id", editingId);
      } else {
        photoPreviewFrame.removeAttribute("data-employee-id");
      }
    }

    employeeModal.hidden = false;
    employeeForm.name.focus();
    window.requestAnimationFrame(function () {
      if (photoPreviewFrame && photoPreviewImg && photoPreviewImg.src) {
        syncPhotoFocusOnFrame(photoPreviewFrame, pendingPhotoFocus);
      }
    });
  }

  function closeModal() {
    employeeModal.hidden = true;
    editingId = null;
    employeeForm.reset();
    employeeForm.id.disabled = false;
    revokePhotoPreviewUrl();
    resetPhotoState("");
  }

  function collectFormData() {
    var existing = editingId
      ? employees.find(function (item) {
          return item.id === editingId;
        })
      : null;

    readFocusFieldsToPending();

    return normalizeEmployee({
      id: employeeForm.id.value,
      name: employeeForm.name.value,
      position: employeeForm.position.value,
      department: employeeForm.department.value,
      hired: employeeForm.hired.value,
      rating: employeeForm.rating.value === "" ? 0 : employeeForm.rating.value,
      notes: employeeForm.notes.value,
      photo: resolvePhotoPathFromForm(existing),
      photo_focus: removePhoto ? normalizePhotoFocus(null) : pendingPhotoFocus,
      personal_code: employeeForm.personal_code ? employeeForm.personal_code.value : "",
    });
  }

  function createEmployeeApi(payload) {
    return apiRequest("/api/employees", { method: "POST", body: payload });
  }

  function updateEmployeeApi(id, payload) {
    return apiRequest("/api/employees/" + encodeURIComponent(id), { method: "PUT", body: payload });
  }

  function deleteEmployeeApi(id) {
    return apiRequest("/api/employees/" + encodeURIComponent(id), { method: "DELETE" });
  }

  function isRemoteAdminHost() {
    var host = String(window.location.hostname || "").toLowerCase();
    return host && host !== "localhost" && host !== "127.0.0.1";
  }

  function applyLoginApiUrl() {
    var client = window.PortalApiClient;
    if (!client || !client.setApiBaseOverride) return Promise.resolve();
    var value = loginApiUrl ? String(loginApiUrl.value || "").trim() : "";
    if (!value && isRemoteAdminHost()) {
      return Promise.reject(new Error(SITE_REMOTE_MESSAGE));
    }
    if (value) {
      client.setApiBaseOverride(value);
    }
    return client.resolveApiBase(true);
  }

  function login(password) {
    return applyLoginApiUrl().then(function () {
      return ensureApiOnline();
    }).then(function () {
      return apiRequest("/api/admin/login", {
        method: "POST",
        body: { password: password },
      }).then(function (data) {
        setToken(data.token);
      });
    });
  }

  function bootApp() {
    if (!getToken()) {
      showLogin();
      return Promise.reject(new Error("no token"));
    }

    return ensureApiOnline()
      .then(function () {
        showApp();
        return (window.PortalApiClient && window.PortalApiClient.resolveApiBase
          ? window.PortalApiClient.resolveApiBase(false)
          : Promise.resolve()
        ).then(function () {
          updateModeLabel();
          return loadEmployees();
        });
      })
      .catch(function (error) {
        setToken("");
        showLogin();
        throw error;
      });
  }

  if (loginApiField && isRemoteAdminHost()) {
    loginApiField.hidden = false;
    var client = window.PortalApiClient;
    if (client && loginApiUrl) {
      var savedApi = client.getApiBaseOverride ? client.getApiBaseOverride() : "";
      if (!savedApi && client.getConfiguredApiBase) {
        savedApi = client.getConfiguredApiBase();
      }
      if (savedApi) loginApiUrl.value = savedApi;
    }
  }

  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var password = loginPassword.value;
    setLoading(loginSubmitBtn, true, "Вход…");

    login(password)
      .then(function () {
        loginPassword.value = "";
        showApp();
        return (window.PortalApiClient && window.PortalApiClient.resolveApiBase
          ? window.PortalApiClient.resolveApiBase(false)
          : Promise.resolve()
        ).then(function () {
          updateModeLabel();
          return loadEmployees();
        });
      })
      .then(function () {
        showToast("Вход выполнен. Данные синхронизируются с сайтом автоматически");
      })
      .catch(function (error) {
        showToast(error.message, true);
      })
      .finally(function () {
        setLoading(loginSubmitBtn, false, "Войти");
      });
  });

  logoutBtn.addEventListener("click", function () {
    apiRequest("/api/admin/logout", { method: "POST" }).catch(function () {
      /* ignore */
    });
    setToken("");
    showLogin();
  });

  listSearch.addEventListener("input", renderTable);

  addEmployeeBtn.addEventListener("click", function () {
    openModal({}, true);
  });

  if (publishSiteBtn) {
    publishSiteBtn.addEventListener("click", function () {
      setLoading(publishSiteBtn, true, "Публикация…");

      publishSiteApi()
        .then(function (result) {
          updatedAt = result.updated_at || updatedAt;
          return loadEmployees().then(function () {
            return result;
          });
        })
        .then(function (result) {
          var parts = [];
          if (typeof result.published === "number") {
            parts.push("на сайте " + result.published + " из " + (result.total || employees.length));
          }
          if (typeof result.codes_generated === "number" && result.codes_generated > 0) {
            parts.push("кодов сгенерировано " + result.codes_generated);
          }
          showToast(
            parts.length
              ? "Сотрудники опубликованы: " + parts.join(", ")
              : "Все сотрудники уже на сайте"
          );
        })
        .catch(function (error) {
          showToast(error.message, true);
        })
        .finally(function () {
          setLoading(publishSiteBtn, false, "Опубликовать на сайт");
        });
    });
  }

  modalCloseBtn.addEventListener("click", closeModal);
  employeeModal.addEventListener("click", function (event) {
    if (event.target === employeeModal) closeModal();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !employeeModal.hidden) closeModal();
  });

  function handleEditClick(event) {
    var button = event.target.closest("[data-edit-id]");
    if (!button) return;
    var employee = employees.find(function (item) {
      return item.id === button.getAttribute("data-edit-id");
    });
    if (employee) openModal(employee, false);
  }

  if (tableBody) {
    tableBody.addEventListener("click", handleEditClick);
  }

  if (cardsContainer) {
    cardsContainer.addEventListener("click", handleEditClick);
  }

  employeeForm.addEventListener("submit", function (event) {
    event.preventDefault();
    setLoading(saveEmployeeBtn, true, "Сохранение…");

    var payload;
    try {
      payload = collectFormData();
    } catch (error) {
      showToast(error.message, true);
      setLoading(saveEmployeeBtn, false, "Сохранить");
      return;
    }

    var previousId = editingId;
    var request = editingId
      ? updateEmployeeApi(editingId, payload).then(loadEmployees)
      : createEmployeeApi(payload).then(loadEmployees);

    request
      .then(function () {
        return applyPhotoChanges(payload.id);
      })
      .then(function () {
        if (previousId && previousId !== payload.id && store.syncEmployeePhotoGlobally) {
          var saved = employees.find(function (item) {
            return item.id === payload.id;
          });
          if (saved) store.syncEmployeePhotoGlobally(saved, updatedAt);
        }
        closeModal();
        showToast(previousId ? "Анкета обновлена и опубликована на сайте" : "Сотрудник добавлен и опубликован на сайте");
      })
      .catch(function (error) {
        showToast(error.message, true);
      })
      .finally(function () {
        setLoading(saveEmployeeBtn, false, "Сохранить");
      });
  });

  var personalCodeInput = document.getElementById("field-personal-code");
  if (personalCodeInput) {
    personalCodeInput.addEventListener("input", function () {
      personalCodeInput.value = personalCodeInput.value.replace(/\D/g, "").slice(0, 6);
    });
  }

  if (photoInput) {
    photoInput.addEventListener("change", function () {
      var file = photoInput.files && photoInput.files[0];
      if (!file) return;
      try {
        pendingPhotoFile = validatePhotoFile(file);
        removePhoto = false;
        pendingPhotoFocus = normalizePhotoFocus(null);
        revokePhotoPreviewUrl();
        updatePhotoPreview();
        openPhotoEditor(getEditablePhotoSrc());
      } catch (error) {
        photoInput.value = "";
        pendingPhotoFile = null;
        showToast(error.message, true);
      }
    });
  }

  if (removePhotoBtn) {
    removePhotoBtn.addEventListener("click", function () {
      revokePhotoPreviewUrl();
      pendingPhotoFile = null;
      removePhoto = true;
      pendingPhotoFocus = normalizePhotoFocus(null);
      if (photoInput) photoInput.value = "";
      syncFocusFieldsFromPending();
      updatePhotoPreview();
    });
  }

  [focusXInput, focusYInput, focusScaleInput].forEach(function (input) {
    if (!input) return;
    input.addEventListener("input", function () {
      readFocusFieldsToPending();
      if (photoPreviewFrame && photoPreviewImg && photoPreviewImg.src) {
        syncPhotoFocusOnFrame(photoPreviewFrame, pendingPhotoFocus);
      }
    });
  });

  if (photoPreview) {
    photoPreview.addEventListener("click", function () {
      var src = getEditablePhotoSrc();
      if (!src) {
        showToast("Сначала загрузите фотографию", true);
        return;
      }
      openPhotoEditor(src);
    });
  }

  deleteEmployeeBtn.addEventListener("click", function () {
    if (!editingId) return;
    if (!window.confirm("Удалить анкету сотрудника «" + employeeForm.name.value + "»?")) return;

    deleteEmployeeApi(editingId)
      .then(loadEmployees)
      .then(function () {
        closeModal();
        showToast("Сотрудник удалён с сайта");
      })
      .catch(function (error) {
        showToast(error.message, true);
      });
  });

  clearStaleClientCache();

  ensureApiOnline()
    .then(function () {
      if (getToken()) {
        return bootApp();
      }
      showLogin();
    })
    .catch(function () {
      showLogin();
      showToast(SITE_OFFLINE_MESSAGE, true);
    });
})();