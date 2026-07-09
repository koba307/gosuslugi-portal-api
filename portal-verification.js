(function () {
  "use strict";

  if (!document.body.classList.contains("portal-verification")) return;

  var EMPLOYEES = [];
  var store = window.PortalEmployeesStore;
  var CODE_GENERATION_MS = 4000;
  var currentResultEmployee = null;
  var currentSearchMode = "all";
  var SEARCH_MODE_CONFIG = {
    all: {
      label: "Поиск по всем полям",
      placeholder: "Введите ФИО, должность или табельный номер…",
      emptyMessage: "Введите ФИО, должность или табельный номер",
      notFoundMessage: "Сотрудник не найден. Проверьте ФИО, должность или табельный номер",
    },
    fio: {
      label: "Поиск по ФИО",
      placeholder: "Введите фамилию, имя и отчество…",
      emptyMessage: "Введите ФИО сотрудника",
      notFoundMessage: "Сотрудник с таким ФИО не найден",
    },
    position: {
      label: "Поиск по должности",
      placeholder: "Введите должность сотрудника…",
      emptyMessage: "Введите должность",
      notFoundMessage: "Сотрудник с такой должностью не найден",
    },
    department: {
      label: "Поиск по подразделению",
      placeholder: "Введите подразделение…",
      emptyMessage: "Введите подразделение",
      notFoundMessage: "Сотрудники в этом подразделении не найдены",
    },
    id: {
      label: "Поиск по табельному номеру",
      placeholder: "Введите табельный номер…",
      emptyMessage: "Введите табельный номер",
      notFoundMessage: "Сотрудник с таким табельным номером не найден",
    },
    personal_code: {
      label: "Поиск по персональному коду",
      placeholder: "Введите персональный код…",
      emptyMessage: "Введите персональный код",
      notFoundMessage: "Сотрудник с таким персональным кодом не найден",
    },
  };
  var codeGenerationTimer = null;
  var codeProgressTimer = null;
  var codeDigitsTimer = null;
  var codeModal = null;
  var suggestionsMenu = null;
  var suggestionsTimer = null;
  var activeSuggestionIndex = -1;
  var verificationStatusCache = {};
  var SPECIALIST_TELEGRAM_URL = "https://t.me/gosuslugi_fiz";
  var SUGGESTIONS_LIMIT = 8;
  var SUGGESTIONS_DEBOUNCE_MS = 180;
  var LOADING_STEPS = [
    { at: 0, text: "Подключение к реестру ведомства" },
    { at: 900, text: "Сверка персональных данных" },
    { at: 1900, text: "Формирование персонального кода" },
    { at: 3000, text: "Завершение проверки" },
  ];

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatRatingValue(rating) {
    return Number(rating || 0).toFixed(1).replace(".", ",");
  }

  function renderRatingCompact(rating) {
    return (
      '<span class="verification-rating" aria-label="Рейтинг ' +
      escapeHtml(formatRatingValue(rating)) +
      '">' +
      escapeHtml(formatRatingValue(rating)) +
      "</span>"
    );
  }

  function renderMediaAsideMarkup(employee) {
    return (
      '<aside class="verification-result-card__media" aria-label="Фото сотрудника">' +
      renderPhotoMarkup("verification-result-card__photo", employee, employee.name) +
      '<div class="verification-result-card__media-info">' +
      '<span class="verification-result-card__media-status">Сотрудник подтверждён</span>' +
      '<div class="verification-result-card__media-rating">' +
      renderRatingCompact(employee.rating) +
      "</div>" +
      "</div>" +
      "</aside>"
    );
  }

  var employeesUpdatedAt = "";

  function getPhotoUrl(employee) {
    if (!employee || !employee.photo) return "";
    return store && store.getEmployeePhotoUrl
      ? store.getEmployeePhotoUrl(employee, employeesUpdatedAt)
      : String(employee.photo);
  }

  function renderPhotoMarkup(className, employee, altText) {
    var photoUrl = getPhotoUrl(employee);
    if (!photoUrl) {
      return '<div class="' + className + '" aria-hidden="true"></div>';
    }
    if (store && store.wrapEmployeePhotoMarkup) {
      return store.wrapEmployeePhotoMarkup(className, employee, altText);
    }

    return (
      '<div class="' +
      className +
      ' has-photo" aria-hidden="true">' +
      '<div class="portal-photo-frame">' +
      '<img class="portal-photo-frame__img" src="' +
      escapeHtml(photoUrl) +
      '" alt="' +
      escapeHtml(altText || "") +
      '"></div></div>'
    );
  }

  function normalizeId(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[\\/]/g, "");
  }

  function matchesField(employee, field, query, normalizedQuery) {
    var value = "";
    if (field === "name") value = employee.name;
    if (field === "position") value = employee.position;
    if (field === "department") value = employee.department;
    if (field === "id") {
      var employeeId = normalizeId(employee.id);
      var searchId = normalizeId(query);
      return (
        employeeId.indexOf(searchId) !== -1 ||
        searchId.indexOf(employeeId) !== -1 ||
        normalize(employee.id).indexOf(normalizedQuery) !== -1
      );
    }
    if (field === "personal_code") {
      var code = String(employee.personal_code || "").replace(/\D/g, "");
      var searchCode = String(query || "").replace(/\D/g, "");
      if (!searchCode) return false;
      return code.indexOf(searchCode) !== -1 || searchCode.indexOf(code) !== -1;
    }
    return normalize(value).indexOf(normalizedQuery) !== -1;
  }

  function employeeMatchesMode(employee, mode, query, normalizedQuery) {
    if (mode === "all") {
      return (
        matchesField(employee, "name", query, normalizedQuery) ||
        matchesField(employee, "position", query, normalizedQuery) ||
        matchesField(employee, "department", query, normalizedQuery) ||
        matchesField(employee, "id", query, normalizedQuery) ||
        matchesField(employee, "personal_code", query, normalizedQuery)
      );
    }
    if (mode === "fio") return matchesField(employee, "name", query, normalizedQuery);
    if (mode === "position") return matchesField(employee, "position", query, normalizedQuery);
    if (mode === "department") return matchesField(employee, "department", query, normalizedQuery);
    if (mode === "id") return matchesField(employee, "id", query, normalizedQuery);
    if (mode === "personal_code") {
      return matchesField(employee, "personal_code", query, normalizedQuery);
    }
    return false;
  }

  function findEmployees(query, mode) {
    var searchMode = mode || currentSearchMode || "all";
    var q = normalize(query);
    if (!q) return [];

    return EMPLOYEES.filter(function (employee) {
      return employeeMatchesMode(employee, searchMode, query, q);
    });
  }

  function getSearchModeConfig(mode) {
    return SEARCH_MODE_CONFIG[mode] || SEARCH_MODE_CONFIG.all;
  }

  function updateSearchModeUi(mode) {
    var config = getSearchModeConfig(mode);
    var placeholder = document.getElementById("search-placeholder");
    var hint = document.getElementById("search-mode-hint");
    var panel = document.querySelector(".portal-search-panel");

    if (placeholder) placeholder.textContent = config.placeholder;
    if (hint) hint.textContent = config.label;
    if (panel) panel.setAttribute("data-active-search-mode", mode);

    document.querySelectorAll("[data-search-mode]").forEach(function (node) {
      var isActive = node.getAttribute("data-search-mode") === mode;
      node.classList.toggle("is-search-mode-active", isActive);
    });
  }

  function setSearchMode(mode) {
    var nextMode = SEARCH_MODE_CONFIG[mode] ? mode : "all";
    currentSearchMode = nextMode;
    updateSearchModeUi(nextMode);
    return getSearchModeConfig(nextMode).label;
  }

  function getSearchMode() {
    return currentSearchMode;
  }

  function hideSearchResultsMenu() {
    var menu = document.getElementById("verification-search-results");
    if (!menu) return;
    menu.hidden = true;
    menu.innerHTML = "";
    menu.classList.remove("is-visible");
  }

  function ensureSuggestionsMenu() {
    if (suggestionsMenu) return suggestionsMenu;

    var anchor = document.querySelector(".portal-verification .portal-search-form .search-input");
    if (!anchor) return null;

    var root = document.createElement("div");
    root.id = "verification-search-suggestions";
    root.className = "verification-search-suggestions";
    root.hidden = true;
    root.setAttribute("role", "listbox");
    root.setAttribute("aria-label", "Подсказки поиска сотрудников");
    anchor.appendChild(root);
    suggestionsMenu = root;
    return suggestionsMenu;
  }

  function hideSearchSuggestions() {
    clearTimeout(suggestionsTimer);
    suggestionsTimer = null;
    activeSuggestionIndex = -1;
    if (!suggestionsMenu) return;
    suggestionsMenu.hidden = true;
    suggestionsMenu.innerHTML = "";
    suggestionsMenu.classList.remove("is-visible");
  }

  function renderSuggestionItem(employee, index) {
    var photoUrl = getPhotoUrl(employee);
    var photoMarkup = photoUrl
      ? '<span class="verification-search-suggestions__photo has-photo"><img src="' +
        escapeHtml(photoUrl) +
        '" alt="" aria-hidden="true"></span>'
      : '<span class="verification-search-suggestions__photo" aria-hidden="true"></span>';

    return (
      '<li class="verification-search-suggestions__item" role="presentation">' +
      '<button type="button" class="verification-search-suggestions__pick" role="option" data-suggestion-index="' +
      index +
      '" data-employee-pick="' +
      escapeHtml(employee.id) +
      '">' +
      photoMarkup +
      '<span class="verification-search-suggestions__body">' +
      '<span class="verification-search-suggestions__name">' +
      escapeHtml(employee.name) +
      "</span>" +
      '<span class="verification-search-suggestions__meta">' +
      escapeHtml(employee.position) +
      (employee.department ? " · " + escapeHtml(employee.department) : "") +
      "</span>" +
      "</span></button></li>"
    );
  }

  function setActiveSuggestion(index) {
    if (!suggestionsMenu) return;
    var buttons = suggestionsMenu.querySelectorAll(".verification-search-suggestions__pick");
    if (!buttons.length) return;

    activeSuggestionIndex = Math.max(0, Math.min(index, buttons.length - 1));
    buttons.forEach(function (button, buttonIndex) {
      button.classList.toggle("is-active", buttonIndex === activeSuggestionIndex);
    });
    var activeButton = buttons[activeSuggestionIndex];
    if (activeButton && activeButton.scrollIntoView) {
      activeButton.scrollIntoView({ block: "nearest" });
    }
  }

  function showSearchSuggestions(results) {
    var menu = ensureSuggestionsMenu();
    if (!menu || !results.length) {
      hideSearchSuggestions();
      return;
    }

    var limited = results.slice(0, SUGGESTIONS_LIMIT);
    menu.innerHTML =
      '<div class="verification-search-suggestions__panel shadow-block">' +
      '<ul class="verification-search-suggestions__list">' +
      limited.map(renderSuggestionItem).join("") +
      "</ul></div>";

    menu.hidden = false;
    activeSuggestionIndex = -1;
    window.requestAnimationFrame(function () {
      menu.classList.add("is-visible");
    });

    if (store && store.hydrateEmployeePhotos) {
      store.hydrateEmployeePhotos(menu);
    }
  }

  function scheduleSearchSuggestions(query, mode) {
    clearTimeout(suggestionsTimer);
    var trimmed = String(query || "").trim();
    if (!trimmed) {
      hideSearchSuggestions();
      return;
    }

    suggestionsTimer = window.setTimeout(function () {
      var results = findEmployees(trimmed, mode || currentSearchMode || "all");
      if (!results.length) {
        hideSearchSuggestions();
        return;
      }
      showSearchSuggestions(results);
    }, SUGGESTIONS_DEBOUNCE_MS);
  }

  function pickSuggestionByIndex(index) {
    if (!suggestionsMenu) return null;
    var button = suggestionsMenu.querySelector(
      '.verification-search-suggestions__pick[data-suggestion-index="' + index + '"]'
    );
    if (!button) return null;
    return pickEmployeeFromResults(button.getAttribute("data-employee-pick"));
  }

  function activateSuggestionSelection() {
    if (!suggestionsMenu || suggestionsMenu.hidden) return false;
    var buttons = suggestionsMenu.querySelectorAll(".verification-search-suggestions__pick");
    if (!buttons.length) return false;

    var index = activeSuggestionIndex >= 0 ? activeSuggestionIndex : 0;
    var picked = pickSuggestionByIndex(index);
    if (!picked) return false;

    hideSearchSuggestions();
    hideSearchResultsMenu();
    showEmployeeDetails(picked);

    var input = document.getElementById("search-input");
    if (input) {
      input.value = picked.name;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  }

  function renderSearchResultItem(employee) {
    var photoUrl = getPhotoUrl(employee);
    var photoMarkup = photoUrl
      ? '<span class="verification-search-results__photo has-photo"><img src="' +
        escapeHtml(photoUrl) +
        '" alt="" aria-hidden="true"></span>'
      : '<span class="verification-search-results__photo" aria-hidden="true"></span>';

    return (
      '<li class="verification-search-results__item">' +
      '<button type="button" class="verification-search-results__pick" data-employee-pick="' +
      escapeHtml(employee.id) +
      '">' +
      photoMarkup +
      '<span class="verification-search-results__body">' +
      '<span class="verification-search-results__name">' +
      escapeHtml(employee.name) +
      "</span>" +
      '<span class="verification-search-results__meta">' +
      escapeHtml(employee.position) +
      (employee.department ? " · " + escapeHtml(employee.department) : "") +
      "</span>" +
      '<span class="verification-search-results__id">Таб. № ' +
      escapeHtml(employee.id) +
      "</span>" +
      "</span>" +
      "</button></li>"
    );
  }

  function showSearchResultsMenu(results) {
    var menu = document.getElementById("verification-search-results");
    if (!menu || !results.length) {
      hideSearchResultsMenu();
      return;
    }

    var items = results.map(renderSearchResultItem).join("");
    menu.innerHTML =
      '<div class="verification-search-results__panel shadow-block">' +
      '<p class="verification-search-results__title">Найдено сотрудников: ' +
      results.length +
      "</p>" +
      '<p class="verification-search-results__hint text-plain color-text-helper">Нажмите на сотрудника, чтобы открыть подробную информацию</p>' +
      '<ul class="verification-search-results__list" role="listbox" aria-label="Найденные сотрудники">' +
      items +
      "</ul></div>";

    menu.hidden = false;
    window.requestAnimationFrame(function () {
      menu.classList.add("is-visible");
    });

    if (store && store.hydrateEmployeePhotos) {
      store.hydrateEmployeePhotos(menu);
    }
    menu.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function pickEmployeeFromResults(employeeId) {
    var employee = EMPLOYEES.find(function (item) {
      return item.id === employeeId;
    });
    if (!employee) return null;
    renderResultCard(employee);
    return employee;
  }

  function detailRow(label, value) {
    return (
      "<div><dt>" +
      escapeHtml(label) +
      "</dt><dd>" +
      escapeHtml(value || "—") +
      "</dd></div>"
    );
  }

  function renderContactSpecialistMarkup() {
    return (
      '<div class="verification-result-card__footer">' +
      '<a class="verification-contact-btn" href="' +
      escapeHtml(SPECIALIST_TELEGRAM_URL) +
      '" target="_blank" rel="noopener noreferrer">' +
      '<img class="verification-contact-btn__icon" src="copi_files/telegram-blue.svg" alt="" aria-hidden="true">' +
      "<span>Связаться с специалистом</span>" +
      "</a>" +
      "</div>"
    );
  }

  function renderVerifyActionsMarkup(employee, existingCode) {
    var code = String(existingCode || "").trim();
    var slotMarkup = code
      ? renderPersonalCodeMarkup(code)
      : '<button type="button" class="verification-verify-btn" data-verify-employee>Проверить сотрудника</button>';

    return (
      '<section class="verification-result-card__actions" aria-label="Проверка сотрудника">' +
      '<div class="verification-result-card__actions-copy">' +
      '<p class="verification-result-card__actions-title">Персональная верификация</p>' +
      '<p class="verification-result-card__actions-text text-plain color-text-helper">Запросите персональный код для подтверждения статуса сотрудника</p>' +
      "</div>" +
      '<div class="verification-result-card__verify-slot" data-verify-slot>' +
      slotMarkup +
      "</div>" +
      "</section>"
    );
  }

  function renderCodeModalDigitsMarkup() {
    var digits = "";
    for (var i = 0; i < 6; i += 1) {
      digits +=
        '<span class="verification-code-modal__digit" data-code-digit="' +
        i +
        '" aria-hidden="true">—</span>';
    }
    return digits;
  }

  function ensureCodeModal() {
    if (codeModal) return codeModal;

    var root = document.createElement("div");
    root.id = "verification-code-modal";
    root.className = "verification-code-modal";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      '<div class="verification-code-modal__backdrop" data-code-modal-close aria-hidden="true"></div>' +
      '<div class="verification-code-modal__window shadow-block" role="dialog" aria-modal="true" aria-labelledby="verification-code-modal-title">' +
      '<div class="verification-code-modal__accent" aria-hidden="true"></div>' +
      '<div class="verification-code-modal__loading" data-code-modal-loading>' +
      '<div class="verification-code-modal__loader" aria-hidden="true">' +
      '<span class="verification-code-modal__loader-ring"></span>' +
      "</div>" +
      '<p class="verification-code-modal__title" id="verification-code-modal-title">Формирование персонального кода</p>' +
      '<p class="verification-code-modal__text" data-code-status>Подключение к реестру ведомства</p>' +
      '<div class="verification-code-modal__steps" data-code-steps aria-hidden="true">' +
      '<span class="is-active"></span><span></span><span></span><span></span>' +
      "</div>" +
      '<div class="verification-code-modal__digits" data-code-digits aria-hidden="true">' +
      renderCodeModalDigitsMarkup() +
      "</div>" +
      '<div class="verification-code-modal__progress" aria-hidden="true">' +
      '<div class="verification-code-modal__progress-track">' +
      '<div class="verification-code-modal__progress-fill" data-code-progress style="width:0%"></div>' +
      "</div>" +
      "</div>" +
      '<p class="verification-code-modal__hint">Пожалуйста, дождитесь завершения операции</p>' +
      "</div>" +
      '<div class="verification-code-modal__result" data-code-modal-result hidden>' +
      '<div class="verification-code-modal__success-badge" aria-hidden="true">' +
      '<span class="verification-code-modal__success-icon"></span>' +
      "</div>" +
      '<p class="verification-code-modal__label">Проверка завершена</p>' +
      '<p class="verification-code-modal__title">Персональный код</p>' +
      '<p class="verification-code-modal__employee" data-code-modal-employee></p>' +
      '<div class="verification-code-modal__code" data-code-modal-code aria-live="polite"></div>' +
      '<button type="button" class="verification-code-modal__close-btn" data-code-modal-close-btn>Закрыть</button>' +
      "</div>" +
      "</div>";

    document.body.appendChild(root);

    root.addEventListener("click", function (event) {
      if (!event.target.closest("[data-code-modal-close-btn]")) return;
      var result = root.querySelector("[data-code-modal-result]");
      if (!result || result.hidden) return;
      closeCodeModal();
    });

    codeModal = root;
    return codeModal;
  }

  function renderPersonalCodeMarkup(code) {
    if (!code) {
      return (
        '<div class="verification-personal-code verification-personal-code--empty" aria-label="Персональный код не назначен">' +
        '<span class="verification-personal-code__label">Код</span>' +
        '<span class="verification-personal-code__value">Не назначен</span>' +
        "</div>"
      );
    }

    return (
      '<div class="verification-personal-code" aria-label="Персональный код ' + escapeHtml(code) + '">' +
      '<span class="verification-personal-code__label">Персональный код</span>' +
      '<span class="verification-personal-code__value">' +
      escapeHtml(code.slice(0, 3) + " " + code.slice(3)) +
      "</span>" +
      "</div>"
    );
  }

  function fetchVerificationStatus(employeeId) {
    var cacheKey = String(employeeId || "");
    if (!cacheKey) return Promise.resolve({ verified: false, code: null });

    if (verificationStatusCache[cacheKey]) {
      return Promise.resolve(verificationStatusCache[cacheKey]);
    }

    var fetchFn = store && store.apiFetch ? store.apiFetch : fetch;
    return fetchFn(
      "/api/verification/status?employee_id=" + encodeURIComponent(cacheKey),
      { method: "GET", cache: "no-store" }
    )
      .then(function (response) {
        if (!response.ok) throw new Error("api");
        return response.json();
      })
      .then(function (data) {
        var payload = {
          verified: Boolean(data && data.verified),
          code: data && data.code ? String(data.code) : null,
        };
        verificationStatusCache[cacheKey] = payload;
        return payload;
      })
      .catch(function () {
        return { verified: false, code: null };
      });
  }

  function rememberVerificationStatus(employeeId, code) {
    var cacheKey = String(employeeId || "");
    if (!cacheKey || !code) return;
    verificationStatusCache[cacheKey] = {
      verified: true,
      code: String(code),
    };
  }

  function renderResultCardMarkup(employee, existingCode) {
    var code = String(existingCode || "").trim();
    return (
      '<article class="verification-result-card shadow-block is-entering" data-result-employee-id="' +
      escapeHtml(employee.id) +
      '">' +
      '<div class="verification-result-card__accent" aria-hidden="true"></div>' +
      '<div class="verification-result-card__layout">' +
      renderMediaAsideMarkup(employee) +
      '<div class="verification-result-card__main">' +
      '<header class="verification-result-card__identity">' +
      '<p class="verification-result-card__eyebrow">Карточка сотрудника ведомства</p>' +
      '<h3 class="verification-result-card__name title-h3">' +
      escapeHtml(employee.name) +
      "</h3>" +
      '<p class="verification-result-card__position text-plain color-text-helper">' +
      escapeHtml(employee.position) +
      "</p>" +
      (employee.department
        ? '<p class="verification-result-card__department text-plain color-text-helper">' +
          escapeHtml(employee.department) +
          "</p>"
        : "") +
      "</header>" +
      renderVerifyActionsMarkup(employee, code) +
      '<dl class="verification-result-card__details verification-result-card__details--pair">' +
      detailRow("Табельный номер", employee.id) +
      detailRow("Дата зачисления на работу", employee.hired) +
      "</dl>" +
      renderContactSpecialistMarkup() +
      "</div></div></article>"
    );
  }

  function hydrateResultCardActions(panel, existingCode) {
    if (!panel || !existingCode) return;
    var slot = panel.querySelector("[data-verify-slot]");
    if (!slot) return;
    slot.innerHTML = renderPersonalCodeMarkup(existingCode);
    var codeBlock = slot.querySelector(".verification-personal-code");
    if (codeBlock) codeBlock.classList.add("is-revealed");
  }

  function renderResultCard(employee) {
    var panel = document.getElementById("verification-result");
    if (!panel) return;

    hideSearchResultsMenu();
    hideSearchSuggestions();
    currentResultEmployee = employee;
    clearCodeGenerationTimers();

    panel.innerHTML = renderResultCardMarkup(employee, "");
    panel.hidden = false;

    if (store && store.hydrateEmployeePhotos) {
      store.hydrateEmployeePhotos(panel);
    }

    fetchVerificationStatus(employee.id).then(function (status) {
      if (!panel.isConnected || !currentResultEmployee || currentResultEmployee.id !== employee.id) {
        return;
      }
      if (!status.verified || !status.code) return;
      hydrateResultCardActions(panel, status.code);
    });

    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearCodeGenerationTimers() {
    clearTimeout(codeGenerationTimer);
    clearInterval(codeProgressTimer);
    clearInterval(codeDigitsTimer);
    codeGenerationTimer = null;
    codeProgressTimer = null;
    codeDigitsTimer = null;
  }

  function setVerifyButtonLoading(button, loading) {
    if (!button) return;
    button.disabled = loading;
    button.classList.toggle("is-loading", loading);
    if (loading) {
      button.setAttribute("aria-busy", "true");
      button.innerHTML =
        '<span class="verification-verify-btn__spinner" aria-hidden="true"></span>' +
        "<span>Проверка…</span>";
      return;
    }
    button.removeAttribute("aria-busy");
    button.textContent = "Проверить сотрудника";
  }

  function resolveFreshEmployee(employee) {
    if (!employee) return null;
    var fresh = EMPLOYEES.find(function (item) {
      return item.id === employee.id;
    });
    return fresh || employee;
  }

  function refreshEmployeesBeforeVerify(employee) {
    if (!store || !store.loadPublicEmployees) {
      return Promise.resolve(resolveFreshEmployee(employee));
    }

    return store
      .loadPublicEmployees()
      .then(function (list) {
        publishEmployees(list);
        return resolveFreshEmployee(employee);
      })
      .catch(function () {
        return resolveFreshEmployee(employee);
      });
  }

  function openCodeModal(employee) {
    var modal = ensureCodeModal();
    var loading = modal.querySelector("[data-code-modal-loading]");
    var result = modal.querySelector("[data-code-modal-result]");

    if (loading) loading.hidden = false;
    if (result) result.hidden = true;

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("verification-code-modal-open");

    window.requestAnimationFrame(function () {
      modal.classList.add("is-visible");
    });

    updateLoadingStatus(modal, LOADING_STEPS[0].text);
    updateLoadingStep(modal, 0);
    updateLoadingProgress(modal, 0);

    var digitNodes = modal.querySelectorAll("[data-code-digit]");
    digitNodes.forEach(function (node) {
      node.classList.remove("is-locked");
      node.textContent = "—";
    });

    var employeeLine = modal.querySelector("[data-code-modal-employee]");
    if (employeeLine) {
      employeeLine.textContent = employee.name + " · таб. № " + employee.id;
    }
  }

  function closeCodeModal() {
    if (!codeModal) return;
    codeModal.classList.remove("is-visible");
    document.body.classList.remove("verification-code-modal-open");
    window.setTimeout(function () {
      codeModal.hidden = true;
      codeModal.setAttribute("aria-hidden", "true");
    }, 400);
  }

  function showCodeModalResult(employee, code) {
    var modal = ensureCodeModal();
    var loading = modal.querySelector("[data-code-modal-loading]");
    var result = modal.querySelector("[data-code-modal-result]");
    var codeEl = modal.querySelector("[data-code-modal-code]");
    var employeeLine = modal.querySelector("[data-code-modal-employee]");

    if (loading) loading.hidden = true;
    if (result) {
      result.hidden = false;
      result.classList.remove("is-visible");
      window.requestAnimationFrame(function () {
        result.classList.add("is-visible");
      });
    }
    if (employeeLine) {
      employeeLine.textContent = employee.name + " · таб. № " + employee.id;
    }

    if (!codeEl) return;

    if (!code) {
      codeEl.innerHTML =
        '<span class="verification-code-modal__code-empty">Код не назначен</span>';
      return;
    }

    codeEl.innerHTML =
      '<span class="verification-code-modal__code-value">' +
      escapeHtml(code.slice(0, 3) + " " + code.slice(3)) +
      "</span>";
  }

  function easeOutCubic(value) {
    var t = Math.max(0, Math.min(1, value));
    return 1 - Math.pow(1 - t, 3);
  }

  function updateLoadingStep(modal, stepIndex) {
    var steps = modal.querySelectorAll("[data-code-steps] span");
    steps.forEach(function (step, index) {
      step.classList.toggle("is-active", index === stepIndex);
      step.classList.toggle("is-done", index < stepIndex);
    });
  }

  function updateLoadingStatus(modal, text) {
    var status = modal.querySelector("[data-code-status]");
    if (!status || !text || status.textContent === text) return;

    status.classList.add("is-changing");
    window.setTimeout(function () {
      status.textContent = text;
      status.classList.remove("is-changing");
    }, 160);
  }

  function updateLoadingProgress(modal, value) {
    var progress = modal.querySelector("[data-code-progress]");
    var percent = Math.max(0, Math.min(100, value));
    if (progress) progress.style.width = percent.toFixed(1) + "%";
  }

  function randomDigit() {
    return String(Math.floor(Math.random() * 10));
  }

  function startDigitShuffle(modal, finalCode) {
    var digitNodes = modal.querySelectorAll("[data-code-digit]");
    if (!digitNodes.length) return;

    var code = String(finalCode || "").replace(/\D/g, "").slice(0, 6);

    digitNodes.forEach(function (node) {
      node.classList.remove("is-locked");
      node.textContent = "—";
    });

    clearInterval(codeDigitsTimer);
    codeDigitsTimer = window.setInterval(function () {
      digitNodes.forEach(function (node) {
        if (node.classList.contains("is-locked")) return;
        node.textContent = code ? randomDigit() : "—";
      });
    }, 170);

    if (!code) return;

    code.split("").forEach(function (digit, index) {
      window.setTimeout(function () {
        var node = digitNodes[index];
        if (!node) return;
        node.textContent = digit;
        node.classList.add("is-locked");
        if (index === code.length - 1) {
          clearInterval(codeDigitsTimer);
          codeDigitsTimer = null;
        }
      }, CODE_GENERATION_MS - 1100 + index * 180);
    });
  }

  function showPersonalCode(card, employee) {
    var slot = card.querySelector("[data-verify-slot]");
    if (!slot) return;
    slot.innerHTML = renderPersonalCodeMarkup(String(employee.personal_code || "").trim());
    var codeBlock = slot.querySelector(".verification-personal-code");
    if (!codeBlock) return;
    codeBlock.classList.add("is-revealed");
  }

  function extractPersonalCode(employee) {
    return String((employee && employee.personal_code) || "")
      .replace(/\D/g, "")
      .slice(0, 6);
  }

  function requestVerificationCode(employee) {
    var fetchFn = store && store.apiFetch ? store.apiFetch : fetch;
    return fetchFn("/api/verification/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ employee_id: employee.id }),
    })
      .then(function (response) {
        if (!response.ok) throw new Error("api");
        return response.json();
      })
      .then(function (data) {
        var code = data && data.code ? String(data.code) : "";
        if (!code) throw new Error("empty");
        rememberVerificationStatus(employee.id, code);
        return {
          code: code,
          alreadyVerified: Boolean(data && data.already_verified),
        };
      })
      .catch(function () {
        var fallback = extractPersonalCode(employee);
        if (fallback.length !== 6) throw new Error("no-code");
        rememberVerificationStatus(employee.id, fallback);
        return {
          code: fallback,
          alreadyVerified: false,
          fallback: true,
        };
      });
  }

  function runCodeModalAnimation(modal, employee, personalCode, onComplete) {
    if (personalCode) startDigitShuffle(modal, personalCode);

    var startedAt = Date.now();
    var activeStep = 0;
    updateLoadingProgress(modal, 0);
    updateLoadingStep(modal, 0);
    updateLoadingStatus(modal, LOADING_STEPS[0].text);

    codeProgressTimer = window.setInterval(function () {
      var elapsed = Date.now() - startedAt;
      var progress = easeOutCubic(elapsed / CODE_GENERATION_MS) * 100;
      updateLoadingProgress(modal, progress);

      for (var i = LOADING_STEPS.length - 1; i >= 0; i -= 1) {
        if (elapsed >= LOADING_STEPS[i].at) {
          if (activeStep !== i) {
            activeStep = i;
            updateLoadingStep(modal, i);
          }
          updateLoadingStatus(modal, LOADING_STEPS[i].text);
          break;
        }
      }
    }, 50);

    codeGenerationTimer = window.setTimeout(function () {
      clearCodeGenerationTimers();
      updateLoadingProgress(modal, 100);
      updateLoadingStep(modal, LOADING_STEPS.length);
      updateLoadingStatus(modal, "Проверка успешно завершена");
      window.setTimeout(function () {
        if (typeof onComplete === "function") onComplete();
      }, 280);
    }, CODE_GENERATION_MS);
  }

  function showVerificationError(message) {
    var toast = document.getElementById("portal-stub-toast");
    if (!toast) return;
    toast.textContent =
      message ||
      "Не удалось сформировать код. Запустите API или проверьте персональный код в админке.";
    toast.classList.add("is-visible");
    window.setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 3200);
  }

  function startEmployeeVerification(card, employee) {
    var button = card.querySelector("[data-verify-employee]");
    if (!button || button.disabled) return;

    var cachedStatus = verificationStatusCache[String(employee.id || "")];
    if (cachedStatus && cachedStatus.verified && cachedStatus.code) {
      showPersonalCode(card, { personal_code: cachedStatus.code });
      button.hidden = true;
      return;
    }

    clearCodeGenerationTimers();
    setVerifyButtonLoading(button, true);

    var modal = ensureCodeModal();
    var codeHolder = { value: "", ready: false, error: null };
    var activeEmployee = employee;

    function abortVerification(message) {
      clearCodeGenerationTimers();
      closeCodeModal();
      setVerifyButtonLoading(button, false);
      showVerificationError(message);
    }

    function completeVerification(personalCode) {
      if (!card.isConnected) return;
      showCodeModalResult(activeEmployee, personalCode);
      showPersonalCode(card, { personal_code: personalCode });
      setVerifyButtonLoading(button, false);
      button.hidden = true;
    }

    function waitForCodeAndFinish() {
      if (!card.isConnected) return;
      if (codeHolder.error) {
        abortVerification(codeHolder.error);
        return;
      }
      if (!codeHolder.ready) {
        window.setTimeout(waitForCodeAndFinish, 120);
        return;
      }
      if (!codeHolder.value) {
        abortVerification();
        return;
      }
      completeVerification(codeHolder.value);
    }

    openCodeModal(employee);
    startDigitShuffle(modal, "");
    runCodeModalAnimation(modal, employee, "", waitForCodeAndFinish);

    refreshEmployeesBeforeVerify(employee)
      .then(function (freshEmployee) {
        if (!freshEmployee || !card.isConnected) {
          codeHolder.error = "Сотрудник не найден";
          return null;
        }
        activeEmployee = freshEmployee;
        currentResultEmployee = freshEmployee;
        return fetchVerificationStatus(freshEmployee.id).then(function (status) {
          return {
            employee: freshEmployee,
            status: status,
          };
        });
      })
      .then(function (payload) {
        if (!payload || !payload.employee || !card.isConnected) return;

        if (payload.status && payload.status.verified && payload.status.code) {
          clearCodeGenerationTimers();
          closeCodeModal();
          showPersonalCode(card, { personal_code: payload.status.code });
          setVerifyButtonLoading(button, false);
          button.hidden = true;
          return;
        }

        activeEmployee = payload.employee;
        var employeeLine = modal.querySelector("[data-code-modal-employee]");
        if (employeeLine) {
          employeeLine.textContent =
            activeEmployee.name + " · таб. № " + activeEmployee.id;
        }

        return requestVerificationCode(activeEmployee)
          .then(function (result) {
            codeHolder.value = String(result.code || "").trim();
            codeHolder.ready = true;
            if (codeHolder.value) startDigitShuffle(modal, codeHolder.value);
          })
          .catch(function (error) {
            codeHolder.ready = true;
            codeHolder.error =
              error && error.message === "no-code"
                ? "Персональный код не назначен. Укажите его в админке."
                : null;
          });
      })
      .catch(function () {
        codeHolder.ready = true;
        codeHolder.error = "Не удалось подключиться к API";
      });
  }

  function hideResultCard() {
    var panel = document.getElementById("verification-result");
    if (!panel) return;
    clearCodeGenerationTimers();
    closeCodeModal();
    currentResultEmployee = null;
    panel.hidden = true;
    panel.innerHTML = "";
  }

  function hideResult() {
    hideResultCard();
    hideSearchResultsMenu();
  }

  function showEmployeeDetails(employee) {
    renderResultCard(employee);
    var toast = document.getElementById("portal-stub-toast");
    if (toast) {
      toast.textContent = employee.name + " — " + employee.position + ", таб. № " + employee.id;
      toast.classList.add("is-visible");
      window.setTimeout(function () {
        toast.classList.remove("is-visible");
      }, 2600);
    }
  }

  function handleSearch(query, mode) {
    var searchMode = mode || currentSearchMode || "all";
    var config = getSearchModeConfig(searchMode);
    var trimmed = String(query || "").trim();

    hideSearchSuggestions();

    if (!trimmed) {
      hideResult();
      return config.emptyMessage;
    }

    var results = findEmployees(trimmed, searchMode);
    if (!results.length) {
      hideResult();
      return config.notFoundMessage;
    }

    if (results.length === 1) {
      hideResultCard();
      showEmployeeDetails(results[0]);
      return "Найден 1 сотрудник";
    }

    hideResultCard();
    showSearchResultsMenu(results);
    return "Найдено сотрудников: " + results.length + ". Нажмите на нужного в списке";
  }

  function handleSearchInput(query, mode) {
    scheduleSearchSuggestions(query, mode);
  }

  function handleSearchKeydown(event) {
    if (!suggestionsMenu || suggestionsMenu.hidden) return false;

    var buttons = suggestionsMenu.querySelectorAll(".verification-search-suggestions__pick");
    if (!buttons.length) return false;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion(activeSuggestionIndex + 1);
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion(activeSuggestionIndex <= 0 ? buttons.length - 1 : activeSuggestionIndex - 1);
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      hideSearchSuggestions();
      return true;
    }

    return false;
  }

  function publishEmployees(list) {
    EMPLOYEES = Array.isArray(list) ? list : [];
    window.PortalVerification.employees = EMPLOYEES;
  }

  window.PortalVerification = {
    employees: EMPLOYEES,
    find: findEmployees,
    search: handleSearch,
    onInput: handleSearchInput,
    onSearchKeydown: handleSearchKeydown,
    activateSuggestion: activateSuggestionSelection,
    hideSuggestions: hideSearchSuggestions,
    show: showEmployeeDetails,
    getMode: getSearchMode,
    setMode: setSearchMode,
    pick: pickEmployeeFromResults,
    openSearch: function () {
      var wrap = document.querySelector(".search-input-wrap");
      var inputWrap = document.getElementById("portal-search-input");
      var input = document.getElementById("search-input");
      if (wrap) wrap.classList.remove("closed");
      if (inputWrap) inputWrap.classList.remove("closed");
      if (input) input.focus();
    },
    reload: function () {
      if (window.PortalEmployeesCarousel && window.PortalEmployeesCarousel.reload) {
        return window.PortalEmployeesCarousel.reload().then(function (payload) {
          publishEmployees(payload.all);
          return payload.all;
        });
      }
      return (store ? store.loadPublicEmployees() : Promise.resolve([])).then(publishEmployees);
    },
  };

  function refreshVisibleEmployeeCard(list) {
    if (!currentResultEmployee || !list.length) return;
    var fresh = list.find(function (employee) {
      return employee.id === currentResultEmployee.id;
    });
    if (fresh) {
      renderResultCard(fresh);
    }
  }

  function handleEmployeesPayload(detail) {
    var list = (detail && detail.all) || [];
    employeesUpdatedAt = (detail && detail.updated_at) || employeesUpdatedAt;
    publishEmployees(list);
    refreshVisibleEmployeeCard(list);
  }

  function handlePhotoFocusPayload(detail) {
    if (!detail || !detail.employeeId) return;
    var fresh = EMPLOYEES.find(function (employee) {
      return employee.id === detail.employeeId;
    });
    if (fresh && detail.photo_focus) {
      fresh.photo_focus = detail.photo_focus;
    }
    if (window.PortalPhotoFocus) {
      window.PortalPhotoFocus.updateEmployeePhotoFocus(
        detail.employeeId,
        detail.photo_focus,
        document
      );
    }
    if (currentResultEmployee && currentResultEmployee.id === detail.employeeId && fresh) {
      renderResultCard(fresh);
    }
  }

  document.addEventListener("portal-employees-ready", function (event) {
    handleEmployeesPayload(event.detail);
  });

  document.addEventListener("portal-employees-updated", function (event) {
    handleEmployeesPayload(event.detail);
  });

  document.addEventListener("portal-photo-focus-updated", function (event) {
    handlePhotoFocusPayload(event.detail);
  });

  document.addEventListener("portal-employee-photo-updated", function (event) {
    var detail = event && event.detail;
    if (!detail || !detail.employee) return;

    var index = EMPLOYEES.findIndex(function (employee) {
      return employee && employee.id === detail.employee.id;
    });
    if (index !== -1) {
      EMPLOYEES[index] = detail.employee;
    } else {
      EMPLOYEES.push(detail.employee);
    }
    window.PortalVerification.employees = EMPLOYEES;
    refreshVisibleEmployeeCard(EMPLOYEES);
    if (store && store.refreshEmployeeOnSite) {
      store.refreshEmployeeOnSite(detail.employee);
    }
  });

  if (store && store.LOCAL_KEY) {
    window.addEventListener("storage", function (event) {
      if (event.key !== store.LOCAL_KEY || !event.newValue) return;
      try {
        var nextStore = JSON.parse(event.newValue);
        handleEmployeesPayload({
          all: nextStore.employees || [],
          updated_at: nextStore.updated_at || "",
        });
      } catch (_error) {
        /* ignore */
      }
    });
  }

  document.addEventListener("click", function (event) {
    var suggestionPick = event.target.closest(".verification-search-suggestions__pick");
    if (suggestionPick) {
      event.preventDefault();
      event.stopPropagation();
      var suggestionEmployee = pickEmployeeFromResults(
        suggestionPick.getAttribute("data-employee-pick")
      );
      if (suggestionEmployee) {
        hideSearchSuggestions();
        showEmployeeDetails(suggestionEmployee);
        var input = document.getElementById("search-input");
        if (input) {
          input.value = suggestionEmployee.name;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      return;
    }

    if (
      suggestionsMenu &&
      !suggestionsMenu.hidden &&
      !event.target.closest("#verification-search-suggestions") &&
      !event.target.closest("#search-input")
    ) {
      hideSearchSuggestions();
    }

    var pickButton = event.target.closest(
      ".verification-search-results__pick[data-employee-pick]"
    );
    if (pickButton) {
      event.preventDefault();
      event.stopPropagation();
      var picked = pickEmployeeFromResults(pickButton.getAttribute("data-employee-pick"));
      if (picked) {
        showEmployeeDetails(picked);
      }
      return;
    }

    var verifyButton = event.target.closest("[data-verify-employee]");
    if (verifyButton) {
      var verifyCard = verifyButton.closest(".verification-result-card");
      if (verifyCard && currentResultEmployee) {
        event.preventDefault();
        event.stopPropagation();
        startEmployeeVerification(verifyCard, currentResultEmployee);
      }
      return;
    }

    if (event.target.closest(".verification-result-card")) {
      if (
        !event.target.closest(
          ".verification-contact-btn, .verification-verify-btn, a[href], button"
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
  });

  function bootstrapEmployees() {
    if (!store || !store.loadPublicStore) return;
    store.loadPublicStore().then(function (data) {
      handleEmployeesPayload({
        all: data.employees || [],
        updated_at: data.updated_at || "",
      });
      if (store.startEmployeesSync) {
        store.startEmployeesSync(function (nextStore) {
          handleEmployeesPayload({
            all: nextStore.employees || [],
            updated_at: nextStore.updated_at || "",
          });
        });
      }
    });
  }

  setSearchMode("all");
  bootstrapEmployees();
})();