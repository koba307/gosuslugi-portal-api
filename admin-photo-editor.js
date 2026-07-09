(function (global) {
  "use strict";

  var photoFocus = global.PortalPhotoFocus;
  var editorModal = null;
  var editorCanvas = null;
  var editorImage = null;
  var scaleInput = null;
  var editorState = { offsetX: 0, offsetY: 0, scale: 1 };
  var lastViewport = { width: 0, height: 0 };
  var onSaveCallback = null;
  var dragState = null;
  var imageReady = false;

  function normalizeFocus(raw) {
    return photoFocus ? photoFocus.normalizePhotoFocus(raw) : { x: 50, y: 50, scale: 1 };
  }

  function getViewportSize() {
    if (!editorCanvas) return { width: 0, height: 0 };
    return {
      width: editorCanvas.clientWidth,
      height: editorCanvas.clientHeight,
    };
  }

  function renderEditorImage() {
    if (!editorImage || !imageReady || !photoFocus || !editorCanvas) return;

    var viewport = getViewportSize();
    if (viewport.width > 0 && viewport.height > 0) {
      lastViewport = viewport;
    }
    editorState = photoFocus.constrainState(
      editorState,
      viewport.width,
      viewport.height,
      editorImage.naturalWidth,
      editorImage.naturalHeight
    );
    photoFocus.layoutImageWithState(editorCanvas, editorImage, editorState);
    if (scaleInput) scaleInput.value = String(editorState.scale);
  }

  function resolveViewport() {
    var viewport = getViewportSize();
    if (viewport.width > 0 && viewport.height > 0) {
      lastViewport = viewport;
      return viewport;
    }
    if (lastViewport.width > 0 && lastViewport.height > 0) {
      return lastViewport;
    }
    return viewport;
  }

  function stateToFocus() {
    if (!photoFocus || !editorImage || !editorImage.naturalWidth) {
      return normalizeFocus(null);
    }
    var viewport = resolveViewport();
    return photoFocus.stateToFocus(
      editorState,
      viewport.width,
      viewport.height,
      editorImage.naturalWidth,
      editorImage.naturalHeight
    );
  }

  function setEditorScale(nextScale) {
    if (!photoFocus) return;
    editorState.scale = photoFocus.normalizePhotoFocus({ scale: nextScale }).scale;
    renderEditorImage();
  }

  function ensureEditorModal() {
    if (editorModal) return editorModal;

    editorModal = document.createElement("div");
    editorModal.id = "photo-editor-modal";
    editorModal.className = "admin-photo-editor";
    editorModal.hidden = true;
    editorModal.innerHTML =
      '<div class="admin-photo-editor__screen">' +
      '<div class="admin-photo-editor__topbar">' +
      '<button class="admin-photo-editor__top-btn" type="button" data-photo-editor-cancel>Отмена</button>' +
      '<span class="admin-photo-editor__title">Фото профиля</span>' +
      '<button class="admin-photo-editor__top-btn admin-photo-editor__top-btn--primary" type="button" data-photo-editor-save>Готово</button>' +
      "</div>" +
      '<div class="admin-photo-editor__stage">' +
      '<div class="admin-photo-editor__canvas portal-photo-frame" data-photo-editor-canvas data-photo-frame>' +
      '<img class="portal-photo-frame__img" data-photo-editor-image alt="" draggable="false">' +
      "</div>" +
      '<div class="admin-photo-editor__mask" aria-hidden="true">' +
      '<div class="admin-photo-editor__crop-window"></div>' +
      "</div>" +
      "</div>" +
      '<p class="admin-photo-editor__gesture-hint">Перетащите и увеличьте фото</p>' +
      '<div class="admin-photo-editor__bottom">' +
      '<button class="admin-photo-editor__zoom-btn" type="button" data-photo-editor-zoom-out aria-label="Уменьшить">−</button>' +
      '<input data-photo-editor-scale type="range" min="1" max="3" step="0.01" value="1" aria-label="Масштаб">' +
      '<button class="admin-photo-editor__zoom-btn" type="button" data-photo-editor-zoom-in aria-label="Увеличить">+</button>' +
      "</div>" +
      "</div>";

    document.body.appendChild(editorModal);

    editorCanvas = editorModal.querySelector("[data-photo-editor-canvas]");
    editorImage = editorModal.querySelector("[data-photo-editor-image]");
    scaleInput = editorModal.querySelector("[data-photo-editor-scale]");

    editorModal.addEventListener("click", function (event) {
      if (event.target.closest("[data-photo-editor-cancel]")) {
        closeEditor(false);
      }
      if (event.target.closest("[data-photo-editor-save]")) {
        closeEditor(true);
      }
      if (event.target.closest("[data-photo-editor-zoom-out]")) {
        setEditorScale(editorState.scale - 0.08);
      }
      if (event.target.closest("[data-photo-editor-zoom-in]")) {
        setEditorScale(editorState.scale + 0.08);
      }
    });

    if (scaleInput) {
      scaleInput.addEventListener("input", function () {
        setEditorScale(Number(scaleInput.value));
      });
    }

    editorCanvas.addEventListener("pointerdown", function (event) {
      if (!imageReady) return;
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: editorState.offsetX,
        offsetY: editorState.offsetY,
      };
      editorCanvas.setPointerCapture(event.pointerId);
      editorCanvas.classList.add("is-dragging");
      event.preventDefault();
    });

    editorCanvas.addEventListener("pointermove", function (event) {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      editorState.offsetX = dragState.offsetX + (event.clientX - dragState.startX);
      editorState.offsetY = dragState.offsetY + (event.clientY - dragState.startY);
      renderEditorImage();
    });

    function endDrag(event) {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      dragState = null;
      editorCanvas.classList.remove("is-dragging");
      try {
        editorCanvas.releasePointerCapture(event.pointerId);
      } catch (_error) {
        /* ignore */
      }
    }

    editorCanvas.addEventListener("pointerup", endDrag);
    editorCanvas.addEventListener("pointercancel", endDrag);

    editorCanvas.addEventListener(
      "wheel",
      function (event) {
        if (!imageReady) return;
        event.preventDefault();
        setEditorScale(editorState.scale + (event.deltaY > 0 ? -0.06 : 0.06));
      },
      { passive: false }
    );

    window.addEventListener("resize", function () {
      if (!editorModal || editorModal.hidden || !imageReady || !photoFocus) return;
      var viewport = getViewportSize();
      var focus = photoFocus.stateToFocus(
        editorState,
        viewport.width,
        viewport.height,
        editorImage.naturalWidth,
        editorImage.naturalHeight
      );
      editorState = photoFocus.focusToState(
        focus,
        viewport.width,
        viewport.height,
        editorImage.naturalWidth,
        editorImage.naturalHeight
      );
      renderEditorImage();
    });

    return editorModal;
  }

  function closeEditor(save) {
    if (!editorModal) return;

    var savedFocus = null;
    if (save && onSaveCallback && imageReady) {
      savedFocus = normalizeFocus(stateToFocus());
    }

    editorModal.hidden = true;
    document.body.classList.remove("admin-photo-editor-open");
    dragState = null;
    imageReady = false;

    if (save && onSaveCallback && savedFocus) {
      onSaveCallback(savedFocus);
    }

    onSaveCallback = null;
  }

  function openEditor(options) {
    var opts = options || {};
    if (!opts.src) return Promise.reject(new Error("Нет изображения для редактирования"));
    if (!photoFocus) return Promise.reject(new Error("Модуль выравнивания не загружен"));

    ensureEditorModal();
    onSaveCallback = typeof opts.onSave === "function" ? opts.onSave : null;
    imageReady = false;

    editorImage.onload = function () {
      imageReady = true;
      global.requestAnimationFrame(function () {
        if (!editorImage || !photoFocus) return;
        var viewport = resolveViewport();
        editorState = photoFocus.focusToState(
          normalizeFocus(opts.focus),
          viewport.width,
          viewport.height,
          editorImage.naturalWidth,
          editorImage.naturalHeight
        );
        renderEditorImage();
      });
    };

    editorImage.onerror = function () {
      imageReady = false;
    };

    editorImage.src = opts.src;
    editorModal.hidden = false;
    document.body.classList.add("admin-photo-editor-open");

    return Promise.resolve();
  }

  global.AdminPhotoEditor = {
    normalizeFocus: normalizeFocus,
    open: openEditor,
  };
})(window);