(function () {
  "use strict";

  function initRoleMenu() {
    var selectRole = document.querySelector("lib-header-select-role .select-role.header");
    if (!selectRole) return;

    var openBtn = selectRole.querySelector(".open-menu");
    var closeBtn = selectRole.querySelector(".close-menu");
    var label = openBtn && openBtn.querySelector(".link-plain");
    var roleItems = selectRole.querySelectorAll("[data-role]");

    function setOpen(open) {
      selectRole.classList.toggle("opened", open);
      if (openBtn) openBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }

    if (openBtn) {
      openBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(!selectRole.classList.contains("opened"));
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      });
    }

    roleItems.forEach(function (item) {
      item.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        var role = item.getAttribute("data-role");
        if (label && role) label.textContent = role;
        if (openBtn) {
          openBtn.setAttribute(
            "aria-label",
            "Выбор роли. Выбрано " + role + ". Всплывающее меню"
          );
        }
        setOpen(false);
      });
    });

    document.addEventListener("click", function (event) {
      if (!selectRole.contains(event.target)) setOpen(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setOpen(false);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRoleMenu);
  } else {
    initRoleMenu();
  }
})();