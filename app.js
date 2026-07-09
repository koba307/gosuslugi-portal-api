(function () {
  "use strict";

  const toast = document.getElementById("portal-stub-toast");
  const searchInput = document.getElementById("search-input");
  const searchSend = document.getElementById("search-send");
  const searchForm = document.getElementById("search-form");
  const searchPlaceholder = document.getElementById("search-placeholder");
  const searchInputWrap = document.getElementById("portal-search-input");
  const searchFieldWrap = document.querySelector(".search-input-wrap");
  let toastTimer = null;

  function isVerificationPage() {
    return document.body.classList.contains("portal-verification");
  }

  function openVerificationSearch() {
    if (searchFieldWrap) searchFieldWrap.classList.remove("closed");
    if (searchInputWrap) searchInputWrap.classList.remove("closed");
    if (searchInput) searchInput.focus();
  }

  function applyVerificationSearchMode(el) {
    if (!isVerificationPage() || !window.PortalVerification) return null;
    const mode = el.getAttribute("data-search-mode");
    if (!mode) return null;
    const label = window.PortalVerification.setMode(mode);
    openVerificationSearch();
    return `Режим: ${label}. Введите данные и нажмите «Поиск»`;
  }

  const handlers = {
    logo() {
      return "Главная страница — функция не подключена";
    },
    "role-menu"() {
      return "Выбор роли — используйте выпадающее меню";
    },
    "role-item"(el) {
      const role = el.getAttribute("data-role") || el.textContent.trim();
      return `Роль «${role}» — переключение не подключено`;
    },
    "nav-services"() {
      return "Раздел «Услуги» — в разработке";
    },
    "nav-documents"() {
      return "Раздел «Документы» — в разработке";
    },
    "nav-orders"() {
      return "Раздел «Заявления» — в разработке";
    },
    "nav-payments"() {
      return "Раздел «Платежи» — в разработке";
    },
    "nav-help"() {
      return "Раздел «Помощь» — в разработке";
    },
    "search-open"() {
      searchInput.focus();
      return "Поиск — введите запрос в поле ниже";
    },
    login() {
      return "Вход — авторизация не подключена";
    },
    category(el) {
      document.querySelectorAll(".category").forEach((node) => {
        node.classList.toggle("is-active", node === el);
      });
      const modeMessage = applyVerificationSearchMode(el);
      if (modeMessage) return modeMessage;
      return `Категория «${el.getAttribute("aria-label") || "услуга"}» — содержимое не подключено`;
    },
    digest(el) {
      const modeMessage = applyVerificationSearchMode(el);
      if (modeMessage) return modeMessage;
      const label = el.querySelector(".name")?.textContent?.trim() || "дайджест";
      return `«${label}» — переход не настроен`;
    },
    preset(el) {
      const modeMessage = applyVerificationSearchMode(el);
      if (modeMessage) return modeMessage;
      const label = el.querySelector(".preset__label")?.textContent?.trim() || el.textContent.trim();
      return `Быстрый запрос «${label}» — функция не подключена`;
    },
    banner(el) {
      const title = el.querySelector(".text")?.textContent?.trim() || "баннер";
      const href = el.getAttribute("data-banner-href");
      if (href) {
        return `Баннер «${title.replace(/\s+/g, " ")}» — переход: ${href}`;
      }
      return `Баннер «${title.replace(/\s+/g, " ")}» — ссылка не настроена`;
    },
    employee(el) {
      if (window.PortalVerification && el?.getAttribute("data-employee-id")) {
        const employee = window.PortalVerification.employees.find(
          (item) => item.id === el.getAttribute("data-employee-id")
        );
        if (employee) {
          window.PortalVerification.show(employee);
          return `${employee.name} — ${employee.position}`;
        }
      }
      return "Карточка сотрудника — данные будут добавлены позже";
    },
    service(el) {
      const serviceModes = {
        "verify-main": "all",
        "verify-fio": "fio",
        "verify-position": "position",
        "verify-id": "id",
      };
      if (isVerificationPage() && window.PortalVerification) {
        const key = el.getAttribute("data-service");
        if (serviceModes[key]) {
          const label = window.PortalVerification.setMode(serviceModes[key]);
          openVerificationSearch();
          return `Режим: ${label}. Введите данные и нажмите «Поиск»`;
        }
      }
      const title = el.querySelector(".title, .text-wrapper")?.textContent?.trim() || "сервис";
      return `Сервис «${title.replace(/\s+/g, " ")}» — функция не подключена`;
    },
    "more-info"() {
      return "Больше информации — раздел не подключён";
    },
    footer(el) {
      const labels = {
        account: "Личный кабинет",
        register: "Регистрация",
        help: "Помощь",
        "find-service": "Как найти услугу",
        map: "Карта центров обслуживания",
        partners: "Партнёрам",
      };
      const key = el.dataset.footer || "";
      return `«${labels[key] || "Ссылка"}» — функция не подключена`;
    },
    location() {
      return "Выбор региона — функция не подключена";
    },
    social(el) {
      const network = el.dataset.social || "соцсеть";
      return `Соцсеть «${network}» — ссылка не настроена`;
    },
    search() {
      const query = searchInput.value.trim();
      if (isVerificationPage() && window.PortalVerification) {
        return window.PortalVerification.search(query, window.PortalVerification.getMode());
      }
      if (!query) {
        return "Введите текст запроса";
      }
      if (redirectToGosuslugiSearch(query)) {
        return "";
      }
      return `Поиск «${query}» — ассистент не подключён`;
    },
  };

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2600);
  }

  function resolveStub(el) {
    const stub = el.dataset.stub;
    if (!stub || !handlers[stub]) {
      showToast("Действие пока не настроено");
      return;
    }
    showToast(handlers[stub](el));
  }

  function resolveExternalHref(el) {
    if (!el) return "";
    return el.getAttribute("data-external-href") || el.getAttribute("data-banner-href") || "";
  }

  function buildGosuslugiSearchUrl(query) {
    const params = new URLSearchParams({
      query: query.trim(),
      serviceRecipient: "all",
    });
    return `https://www.gosuslugi.ru/search?${params.toString()}`;
  }

  function redirectToGosuslugiSearch(query) {
    const normalized = query.trim();
    if (!normalized) return false;
    window.location.href = buildGosuslugiSearchUrl(normalized);
    return true;
  }

  document.addEventListener("click", (event) => {
    const usefulTarget = event.target.closest("portal-useful-services [data-external-href]");
    if (usefulTarget) {
      event.preventDefault();
      const href = resolveExternalHref(usefulTarget);
      if (href) {
        window.location.href = href;
      }
      return;
    }

    const sliderTarget = event.target.closest(
      "portal-slider a.banner-main-carousel[data-external-href], portal-slider a.banner-main-carousel[data-banner-href]"
    );
    if (sliderTarget && !sliderTarget.classList.contains("employee-card__link")) {
      event.preventDefault();
      const href = resolveExternalHref(sliderTarget);
      if (href) {
        window.location.href = href;
      }
      return;
    }

    const headerNavTarget = event.target.closest(
      "lib-header-main-links [data-external-href], lib-header-auth [data-external-href]"
    );
    if (headerNavTarget) {
      event.preventDefault();
      const href = resolveExternalHref(headerNavTarget);
      if (href) {
        window.location.href = href;
      }
      return;
    }

    const footerTarget = event.target.closest("#footer-wrapper [data-external-href]");
    if (footerTarget) {
      event.preventDefault();
      const href = resolveExternalHref(footerTarget);
      if (href) {
        window.location.href = href;
      }
      return;
    }

    const catalogTarget = event.target.closest(
      ".main-page-catalog-wrap .category[data-external-href]"
    );
    if (catalogTarget) {
      event.preventDefault();
      const href = resolveExternalHref(catalogTarget);
      if (href) {
        window.location.href = href;
      }
      return;
    }

    const mainSearchTarget = event.target.closest(
      ".main-page-search-wrap .digest[data-external-href], .main-page-search-wrap .plain-button[data-external-href]"
    );
    if (mainSearchTarget && !isVerificationPage()) {
      event.preventDefault();
      const href = resolveExternalHref(mainSearchTarget);
      if (href) {
        window.location.href = href;
      }
      return;
    }

    const navTarget = event.target.closest("[data-nav]");
    if (navTarget) {
      event.preventDefault();
      const href = navTarget.getAttribute("data-nav");
      if (href) {
        window.location.href = href;
      }
      return;
    }

    if (
      event.target.closest("[data-verify-employee]") ||
      event.target.closest(".verification-contact-btn") ||
      event.target.closest(".verification-result-card")
    ) {
      return;
    }

    const employeeTarget = event.target.closest("[data-employee-id]");
    if (employeeTarget && window.PortalVerification) {
      event.preventDefault();
      const employee = window.PortalVerification.employees.find(
        (item) => item.id === employeeTarget.getAttribute("data-employee-id")
      );
      if (employee) {
        window.PortalVerification.show(employee);
        showToast(`${employee.name} — ${employee.position}`);
      }
      return;
    }

    const searchModeTarget = event.target.closest("[data-search-mode]");
    if (searchModeTarget && isVerificationPage()) {
      event.preventDefault();
      const message = applyVerificationSearchMode(searchModeTarget);
      if (message) showToast(message);
      if (searchModeTarget.classList.contains("category")) {
        document.querySelectorAll(".category").forEach((node) => {
          node.classList.toggle("is-active", node === searchModeTarget);
        });
      }
      return;
    }

    const target = event.target.closest("[data-stub]");
    if (!target) return;
    event.preventDefault();
    resolveStub(target);
  });

  if (searchInput && searchSend) {
    const syncSendState = () => {
      const hasValue = Boolean(searchInput.value.trim());
      searchSend.disabled = !hasValue;
      if (searchInputWrap) {
        searchInputWrap.classList.toggle("empty", !hasValue);
      }
      if (searchPlaceholder) {
        searchPlaceholder.classList.toggle("show", !hasValue);
      }
      if (isVerificationPage() && window.PortalVerification && window.PortalVerification.onInput) {
        window.PortalVerification.onInput(
          searchInput.value,
          window.PortalVerification.getMode()
        );
      }
    };
    searchInput.addEventListener("input", syncSendState);
    syncSendState();
  }

  if (searchInput) {
    searchInput.addEventListener("keydown", (event) => {
      if (!isVerificationPage() || !window.PortalVerification) return;

      if (window.PortalVerification.onSearchKeydown) {
        const handled = window.PortalVerification.onSearchKeydown(event);
        if (handled) return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (
          window.PortalVerification.activateSuggestion &&
          window.PortalVerification.activateSuggestion()
        ) {
          return;
        }
        const message = handlers.search();
        if (message) {
          showToast(message);
        }
      }
    });
  }

  if (searchForm) {
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (
        isVerificationPage() &&
        window.PortalVerification &&
        window.PortalVerification.activateSuggestion &&
        window.PortalVerification.activateSuggestion()
      ) {
        return;
      }
      const message = handlers.search();
      if (message) {
        showToast(message);
      }
    });
  }
})();