(function (global) {
  "use strict";

  var MIN_SCALE = 1;
  var MAX_SCALE = 3;
  var FRAME_RATIO = 1;
  var boundFrames = typeof WeakSet !== "undefined" ? new WeakSet() : null;
  var resizeObserver = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizePhotoFocus(raw) {
    var focus = raw && typeof raw === "object" ? raw : {};
    var x = Number(focus.x);
    var y = Number(focus.y);
    var scale = Number(focus.scale);
    if (Number.isNaN(x)) x = 50;
    if (Number.isNaN(y)) y = 50;
    if (Number.isNaN(scale)) scale = 1;
    return {
      x: Math.round(clamp(x, 0, 100) * 10) / 10,
      y: Math.round(clamp(y, 0, 100) * 10) / 10,
      scale: Math.round(clamp(scale, MIN_SCALE, MAX_SCALE) * 100) / 100,
    };
  }

  function readFocusFromFrame(frame) {
    if (!frame) return normalizePhotoFocus(null);

    var raw = frame.getAttribute("data-photo-focus");
    if (raw) {
      try {
        return normalizePhotoFocus(JSON.parse(raw));
      } catch (_error) {
        /* fallback to split attrs */
      }
    }

    return normalizePhotoFocus({
      x: frame.getAttribute("data-photo-focus-x"),
      y: frame.getAttribute("data-photo-focus-y"),
      scale: frame.getAttribute("data-photo-focus-scale"),
    });
  }

  function writeFocusToFrame(frame, focus) {
    if (!frame) return;
    var normalized = normalizePhotoFocus(focus);
    frame.setAttribute("data-photo-focus-x", String(normalized.x));
    frame.setAttribute("data-photo-focus-y", String(normalized.y));
    frame.setAttribute("data-photo-focus-scale", String(normalized.scale));
    frame.removeAttribute("data-photo-focus");
  }

  function getCoverMetrics(frameWidth, frameHeight, naturalWidth, naturalHeight, scaleMultiplier) {
    var iw = naturalWidth || 1;
    var ih = naturalHeight || 1;
    var baseScale = Math.max(frameWidth / iw, frameHeight / ih);
    var scale = baseScale * scaleMultiplier;
    return {
      width: iw * scale,
      height: ih * scale,
      baseScale: baseScale,
      scale: scale,
    };
  }

  function focusToState(focus, frameWidth, frameHeight, naturalWidth, naturalHeight) {
    var normalized = normalizePhotoFocus(focus);
    var metrics = getCoverMetrics(
      frameWidth,
      frameHeight,
      naturalWidth,
      naturalHeight,
      normalized.scale
    );

    if (!frameWidth || !frameHeight) {
      return { offsetX: 0, offsetY: 0, scale: normalized.scale };
    }

    var left = frameWidth / 2 - (normalized.x / 100) * metrics.width;
    var top = frameHeight / 2 - (normalized.y / 100) * metrics.height;
    return {
      offsetX: left - (frameWidth - metrics.width) / 2,
      offsetY: top - (frameHeight - metrics.height) / 2,
      scale: normalized.scale,
    };
  }

  function stateToFocus(state, frameWidth, frameHeight, naturalWidth, naturalHeight) {
    var metrics = getCoverMetrics(
      frameWidth,
      frameHeight,
      naturalWidth,
      naturalHeight,
      state.scale
    );

    if (!frameWidth || !frameHeight) {
      return normalizePhotoFocus(null);
    }

    var left = (frameWidth - metrics.width) / 2 + state.offsetX;
    var top = (frameHeight - metrics.height) / 2 + state.offsetY;
    return normalizePhotoFocus({
      x: ((frameWidth / 2 - left) / metrics.width) * 100,
      y: ((frameHeight / 2 - top) / metrics.height) * 100,
      scale: state.scale,
    });
  }

  function constrainState(state, frameWidth, frameHeight, naturalWidth, naturalHeight) {
    var metrics = getCoverMetrics(
      frameWidth,
      frameHeight,
      naturalWidth,
      naturalHeight,
      state.scale
    );
    var maxOffsetX = Math.max(0, (metrics.width - frameWidth) / 2);
    var maxOffsetY = Math.max(0, (metrics.height - frameHeight) / 2);
    return {
      offsetX: clamp(state.offsetX, -maxOffsetX, maxOffsetX),
      offsetY: clamp(state.offsetY, -maxOffsetY, maxOffsetY),
      scale: clamp(state.scale, MIN_SCALE, MAX_SCALE),
    };
  }

  function layoutImageWithState(frame, img, state) {
    if (!frame || !img) return;

    var frameWidth = frame.clientWidth;
    var frameHeight = frame.clientHeight;
    var naturalWidth = img.naturalWidth;
    var naturalHeight = img.naturalHeight;

    if (!frameWidth || !frameHeight || !naturalWidth || !naturalHeight) return;

    var safeState = constrainState(
      state,
      frameWidth,
      frameHeight,
      naturalWidth,
      naturalHeight
    );
    var metrics = getCoverMetrics(
      frameWidth,
      frameHeight,
      naturalWidth,
      naturalHeight,
      safeState.scale
    );

    var left = (frameWidth - metrics.width) / 2 + safeState.offsetX;
    var top = (frameHeight - metrics.height) / 2 + safeState.offsetY;

    frame.classList.add("is-layout-ready");

    img.style.position = "absolute";
    img.style.left = left + "px";
    img.style.top = top + "px";
    img.style.width = metrics.width + "px";
    img.style.height = metrics.height + "px";
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.objectFit = "fill";
    img.style.transform = "none";
    img.style.transformOrigin = "";
    img.style.objectPosition = "";
    img.style.pointerEvents = "none";
  }

  function layoutImageWithFocus(frame, img, focus) {
    if (!frame || !img) return;
    var state = focusToState(
      focus,
      frame.clientWidth,
      frame.clientHeight,
      img.naturalWidth,
      img.naturalHeight
    );
    layoutImageWithState(frame, img, state);
  }

  function ensureFrameLayout(frame, img, focus, attempt) {
    if (!frame || !img) return;
    var tries = typeof attempt === "number" ? attempt : 0;
    var normalized = normalizePhotoFocus(focus);

    writeFocusToFrame(frame, normalized);

    if (frame.clientWidth > 0 && frame.clientHeight > 0 && img.naturalWidth > 0) {
      layoutImageWithFocus(frame, img, normalized);
      frame.classList.add("is-layout-ready");
      return;
    }

    if (tries >= 40) return;

    global.requestAnimationFrame(function () {
      ensureFrameLayout(frame, img, normalized, tries + 1);
    });
  }

  function applyPhotoFocus(frame, img, focus) {
    if (!img) return;

    var targetFrame = frame || img.closest("[data-photo-frame]");
    if (!targetFrame) return;

    var normalized = normalizePhotoFocus(focus);

    function render() {
      ensureFrameLayout(targetFrame, img, normalized, 0);
    }

    if (img.complete && img.naturalWidth) {
      render();
      return;
    }

    img.addEventListener("load", render, { once: true });
  }

  function ensureResizeObserver() {
    if (resizeObserver || typeof ResizeObserver === "undefined") return resizeObserver;

    resizeObserver = new ResizeObserver(function (entries) {
      entries.forEach(function (entry) {
        var frame = entry.target;
        var img = frame.querySelector("img");
        if (!img) return;
        layoutImageWithFocus(frame, img, readFocusFromFrame(frame));
      });
    });

    return resizeObserver;
  }

  function bindPhotoFrame(frame) {
    if (!frame || !frame.hasAttribute("data-photo-frame")) return;
    if (boundFrames && boundFrames.has(frame)) return;

    var observer = ensureResizeObserver();
    if (observer) observer.observe(frame);
    if (boundFrames) boundFrames.add(frame);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function encodePhotoSrc(url) {
    var value = String(url || "").trim();
    if (!value || /^(data:|blob:|https?:)/i.test(value)) return value;

    var queryIndex = value.indexOf("?");
    var path = queryIndex === -1 ? value : value.slice(0, queryIndex);
    var query = queryIndex === -1 ? "" : value.slice(queryIndex);

    var encodedPath = path
      .split("/")
      .map(function (segment) {
        if (!segment) return segment;
        try {
          return encodeURIComponent(decodeURIComponent(segment));
        } catch (_error) {
          return encodeURIComponent(segment);
        }
      })
      .join("/");

    return encodedPath + query;
  }

  function normalizePhotoSrc(url) {
    var value = String(url || "").trim();
    if (!value) return "";
    if (/^(data:|blob:)/i.test(value)) return value;
    try {
      return new URL(value, global.location && global.location.origin ? global.location.origin : "http://localhost").pathname;
    } catch (_error) {
      return value.split("?")[0];
    }
  }

  function wrapPhotoMarkup(className, photoUrl, altText, focus, extraClass, employeeId) {
    var normalized = normalizePhotoFocus(focus);
    var alt = escapeHtml(altText || "");
    var url = escapeHtml(encodePhotoSrc(photoUrl || ""));
    var idAttr = employeeId
      ? ' data-employee-id="' + escapeHtml(String(employeeId)) + '"'
      : "";

    return (
      '<div class="' +
      className +
      ' has-photo">' +
      '<div class="portal-photo-frame' +
      (extraClass ? " " + extraClass : "") +
      '" data-photo-frame' +
      idAttr +
      ' data-photo-focus-x="' +
      normalized.x +
      '" data-photo-focus-y="' +
      normalized.y +
      '" data-photo-focus-scale="' +
      normalized.scale +
      '">' +
      '<img class="portal-photo-frame__img" src="' +
      url +
      '" alt="' +
      alt +
      '" decoding="async">' +
      "</div></div>"
    );
  }

  function hydratePhotoFrames(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll("[data-photo-frame]").forEach(function (frame) {
      var img = frame.querySelector("img");
      if (!img) return;
      bindPhotoFrame(frame);
      applyPhotoFocus(frame, img, readFocusFromFrame(frame));
    });
  }

  function resolvePhotoUrl(employee, photoUrlFn) {
    if (!employee) return "";
    if (typeof photoUrlFn === "function") return String(photoUrlFn(employee) || "");
    return String(employee.photo || "");
  }

  function updateEmployeePhotoFocus(employeeId, focus, root) {
    if (!employeeId) return 0;
    var scope = root && root.querySelectorAll ? root : document;
    var normalized = normalizePhotoFocus(focus);
    var targetId = String(employeeId);
    var count = 0;

    scope.querySelectorAll("[data-photo-frame][data-employee-id]").forEach(function (frame) {
      if (frame.getAttribute("data-employee-id") !== targetId) return;
      var img = frame.querySelector("img");
      if (!img) return;
      bindPhotoFrame(frame);
      applyPhotoFocus(frame, img, normalized);
      count += 1;
    });

    return count;
  }

  function refreshEmployeePhoto(employee, photoUrlFn, root) {
    if (!employee || !employee.id) return 0;
    var scope = root && root.querySelectorAll ? root : document;
    var targetId = String(employee.id);
    var photoUrl = resolvePhotoUrl(employee, photoUrlFn);
    var focus = normalizePhotoFocus(employee.photo_focus);
    var count = 0;

    scope.querySelectorAll("[data-photo-frame][data-employee-id]").forEach(function (frame) {
      if (frame.getAttribute("data-employee-id") !== targetId) return;
      var img = frame.querySelector("img");
      if (!img) return;

      bindPhotoFrame(frame);
      writeFocusToFrame(frame, focus);

      function render() {
        ensureFrameLayout(frame, img, focus, 0);
      }

      var nextSrc = encodePhotoSrc(photoUrl);
      var currentSrc = img.getAttribute("src") || "";
      if (nextSrc && normalizePhotoSrc(currentSrc) !== normalizePhotoSrc(nextSrc)) {
        img.addEventListener("load", render, { once: true });
        img.src = nextSrc;
      } else if (img.complete && img.naturalWidth) {
        render();
      } else {
        img.addEventListener("load", render, { once: true });
      }

      count += 1;
    });

    return count;
  }

  function notifyPhotoFocusChange(employeeId, focus) {
    document.dispatchEvent(
      new CustomEvent("portal-photo-focus-updated", {
        detail: {
          employeeId: employeeId,
          photo_focus: normalizePhotoFocus(focus),
        },
      })
    );
  }

  function notifyEmployeePhotoChange(employee) {
    if (!employee || !employee.id) return;
    document.dispatchEvent(
      new CustomEvent("portal-employee-photo-updated", {
        detail: {
          employee: employee,
          employeeId: employee.id,
          photo: String(employee.photo || ""),
          photo_focus: normalizePhotoFocus(employee.photo_focus),
        },
      })
    );
  }

  function syncEmployeeEverywhere(employee, photoUrlFn, root) {
    if (!employee || !employee.id) return 0;
    var scope = root && root.querySelectorAll ? root : document;
    var count = refreshEmployeePhoto(employee, photoUrlFn, scope);
    notifyPhotoFocusChange(employee.id, employee.photo_focus);
    notifyEmployeePhotoChange(employee);
    return count;
  }

  function autoInitPhotoFrames() {
    hydratePhotoFrames(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInitPhotoFrames);
  } else {
    autoInitPhotoFrames();
  }

  global.PortalPhotoFocus = {
    MIN_SCALE: MIN_SCALE,
    MAX_SCALE: MAX_SCALE,
    FRAME_RATIO: FRAME_RATIO,
    normalizePhotoFocus: normalizePhotoFocus,
    readFocusFromFrame: readFocusFromFrame,
    writeFocusToFrame: writeFocusToFrame,
    getCoverMetrics: getCoverMetrics,
    focusToState: focusToState,
    stateToFocus: stateToFocus,
    constrainState: constrainState,
    layoutImageWithState: layoutImageWithState,
    layoutImageWithFocus: layoutImageWithFocus,
    applyPhotoFocus: applyPhotoFocus,
    bindPhotoFrame: bindPhotoFrame,
    wrapPhotoMarkup: wrapPhotoMarkup,
    hydratePhotoFrames: hydratePhotoFrames,
    ensureFrameLayout: ensureFrameLayout,
    updateEmployeePhotoFocus: updateEmployeePhotoFocus,
    refreshEmployeePhoto: refreshEmployeePhoto,
    encodePhotoSrc: encodePhotoSrc,
    normalizePhotoSrc: normalizePhotoSrc,
    notifyPhotoFocusChange: notifyPhotoFocusChange,
    notifyEmployeePhotoChange: notifyEmployeePhotoChange,
    syncEmployeeEverywhere: syncEmployeeEverywhere,
    focusToEditorState: focusToState,
    editorStateToFocus: stateToFocus,
    constrainEditorState: constrainState,
    layoutImageInFrame: layoutImageWithFocus,
  };
})(window);