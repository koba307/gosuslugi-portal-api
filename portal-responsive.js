(function (global) {
  "use strict";

  var BP_XS = 480;
  var BP_SM = 768;
  var BP_MD = 1216;

  function isTouchDevice() {
    return "ontouchstart" in global;
  }

  function isPad() {
    if (!isTouchDevice()) return false;
    var portrait = global.matchMedia("(orientation: portrait)").matches;
    return portrait ? global.outerWidth >= BP_SM : global.outerHeight >= BP_SM;
  }

  function getViewportWidth() {
    return (
      Math.min(
        global.innerWidth || 0,
        document.documentElement.clientWidth || 0,
        global.screen && global.screen.width ? global.screen.width : Infinity
      ) || BP_SM
    );
  }

  function getBreakpoint(width) {
    if (width < BP_XS) return "xs";
    if (width < BP_SM) return "sm";
    if (width < BP_MD) return "md";
    return "lg";
  }

  function getDeviceType(width) {
    if (width < BP_SM) return "mobile";
    if (isTouchDevice() && isPad()) return "tablet";
    if (width < BP_MD && isTouchDevice()) return "mobile";
    return width < BP_MD ? "tablet" : "desktop";
  }

  function applyDeviceTypeClasses(deviceType) {
    var root = document.documentElement;
    root.classList.remove(
      "portal-device-mobile",
      "portal-device-tablet",
      "portal-device-desktop"
    );
    root.classList.add("portal-device-" + deviceType);

    document.querySelectorAll(".search-container").forEach(function (node) {
      node.classList.remove(
        "device-type-mobile",
        "device-type-tablet",
        "device-type-desktop",
        "device-type-desk"
      );
      node.classList.add("device-type-" + deviceType);
    });
  }

  function pinCategoriesToStart() {
    document.querySelectorAll(".portal-root .categories").forEach(function (node) {
      node.scrollLeft = 0;
    });
  }

  function updateLayoutMetrics() {
    var root = document.documentElement;
    var width = getViewportWidth();
    var height =
      (global.visualViewport && global.visualViewport.height) || global.innerHeight || 0;
    var bp = getBreakpoint(width);
    var contentPad = width < BP_XS ? 12 : 16;
    var cardWidth = Math.min(176, Math.max(124, Math.round(width * 0.38)));
    var cardPhotoHeight = cardWidth;
    var cardHeight = cardWidth < 152 ? cardWidth + 40 : 196;
    var isMobileLayout = width < BP_SM;
    var isTouch = isTouchDevice();
    var deviceType = getDeviceType(width);

    root.setAttribute("data-portal-bp", bp);
    root.setAttribute("data-portal-device", deviceType);
    root.dataset.portalTouch = isTouch ? "true" : "false";
    applyDeviceTypeClasses(deviceType);

    root.style.setProperty("--portal-vw", width + "px");
    root.style.setProperty("--portal-vh", height + "px");
    root.style.setProperty("--portal-content-pad", contentPad + "px");
    root.style.setProperty(
      "--portal-container-width",
      "min(1216px, calc(100% - " + contentPad * 2 + "px))"
    );
    root.style.setProperty("--portal-card-width", cardWidth + "px");
    root.style.setProperty("--portal-card-height", cardHeight + "px");
    root.style.setProperty("--portal-card-photo-height", cardPhotoHeight + "px");
    root.style.setProperty("--portal-title-size", isMobileLayout ? "20px" : "24px");
    root.style.setProperty(
      "--portal-body-size",
      width < BP_XS ? "14px" : isMobileLayout ? "15px" : "16px"
    );
    root.style.setProperty(
      "--portal-footer-size",
      width < BP_XS ? "13px" : isMobileLayout ? "14px" : "16px"
    );
    root.style.setProperty("--portal-caption-size", width < BP_XS ? "11px" : "12px");
    root.style.setProperty("--portal-social-size", width < BP_XS ? "32px" : "36px");

    if (isMobileLayout) {
      pinCategoriesToStart();
    }
  }

  var resizeTimer = null;

  function scheduleUpdate() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(updateLayoutMetrics, 80);
  }

  updateLayoutMetrics();

  global.addEventListener("resize", scheduleUpdate, { passive: true });
  global.addEventListener("orientationchange", updateLayoutMetrics, { passive: true });
  global.addEventListener("pageshow", updateLayoutMetrics, { passive: true });

  if (global.visualViewport) {
    global.visualViewport.addEventListener("resize", scheduleUpdate, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", pinCategoriesToStart, { once: true });
  } else {
    pinCategoriesToStart();
  }

  global.PortalResponsive = {
    update: updateLayoutMetrics,
    getBreakpoint: function () {
      return document.documentElement.getAttribute("data-portal-bp") || "lg";
    },
    getDeviceType: function () {
      return document.documentElement.getAttribute("data-portal-device") || "desktop";
    },
  };
})(window);