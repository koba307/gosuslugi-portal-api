(function () {
  "use strict";

  var DESKTOP_BP = 1216;
  var AUTOPLAY_MS = 4000;
  var SLIDE_MS = 1000;

  function isDesktop() {
    return window.matchMedia("(min-width: " + DESKTOP_BP + "px)").matches;
  }

  function PortalSlider(root) {
    this.root = root;
    this.viewport = root.querySelector(".slider-viewport");
    this.track = root.querySelector("[data-carousel-track]");
    this.prevBtn = root.querySelector("[data-carousel-prev]");
    this.nextBtn = root.querySelector("[data-carousel-next]");
    this.items = [];
    this.index = 0;
    this.timer = null;
    this.busy = false;
    this.autoplayEnabled = true;
    this.onResize = this.onResize.bind(this);
  }

  PortalSlider.prototype.refreshItems = function () {
    this.items = this.track
      ? Array.prototype.slice.call(this.track.querySelectorAll(".banner-wrapper"))
      : [];
  };

  PortalSlider.prototype.getStep = function () {
    if (this.items.length < 2) {
      return this.items[0] ? this.items[0].offsetWidth : 0;
    }
    return this.items[1].offsetLeft - this.items[0].offsetLeft;
  };

  PortalSlider.prototype.freezeTrack = function () {
    if (!this.track) return;
    this.track.style.transition = "none";
  };

  PortalSlider.prototype.releaseTrackStyles = function () {
    if (!this.track) return;
    this.track.classList.remove("is-sliding");
    this.track.style.transition = "";
    this.track.style.transform = "";
    this.track.style.willChange = "";
  };

  PortalSlider.prototype.setTrackOffset = function (offset, animate) {
    if (!this.track) return Promise.resolve();

    var self = this;
    this.track.classList.add("is-sliding");
    this.track.style.willChange = "transform";

    if (!animate) {
      this.freezeTrack();
      this.track.style.transform = "translate3d(" + offset + "px, 0, 0)";
      void this.track.offsetWidth;
      this.track.style.transition = "";
      return Promise.resolve();
    }

    this.freezeTrack();
    this.track.style.transform = "translate3d(0, 0, 0)";
    void this.track.offsetWidth;
    this.track.style.transition = "";
    this.track.style.transform = "translate3d(" + offset + "px, 0, 0)";

    return new Promise(function (resolve) {
      var settled = false;
      var finish = function () {
        if (settled) return;
        settled = true;
        self.track.removeEventListener("transitionend", onEnd);
        resolve();
      };

      var onEnd = function (event) {
        if (event.target !== self.track) return;
        if (event.propertyName !== "transform") return;
        finish();
      };

      self.track.addEventListener("transitionend", onEnd);
      window.setTimeout(finish, SLIDE_MS + 48);
    });
  };

  PortalSlider.prototype.commitTrackOffset = function () {
    if (!this.track) return;
    this.freezeTrack();
    this.track.style.transform = "translate3d(0, 0, 0)";
    void this.track.offsetWidth;
    this.releaseTrackStyles();
  };

  PortalSlider.prototype.syncAccessibility = function () {
    var self = this;
    this.items.forEach(function (item, idx) {
      var link = item.querySelector("a.banner-main-carousel");
      var active = idx === self.index;
      item.toggleAttribute("aria-hidden", !active);
      if (link) {
        link.tabIndex = active ? 0 : -1;
      }
    });
  };

  PortalSlider.prototype.scrollToIndex = function (index, smooth) {
    var target = this.items[index];
    if (!target || !this.track) return;
    this.track.scrollTo({
      left: target.offsetLeft - this.track.offsetLeft,
      behavior: smooth === false ? "auto" : "smooth",
    });
  };

  PortalSlider.prototype.slideNextDesktop = function () {
    var self = this;
    var current = this.items[this.index];
    var step = this.getStep();
    if (!current || !step) return;

    this.busy = true;

    this.setTrackOffset(-step, true).then(function () {
      self.freezeTrack();
      self.track.appendChild(current);
      self.refreshItems();
      self.index = 0;
      self.commitTrackOffset();
      self.syncAccessibility();
      self.busy = false;
    });
  };

  PortalSlider.prototype.slidePrevDesktop = function () {
    var self = this;
    var incoming = this.items[this.items.length - 1];
    var step = this.getStep();
    if (!incoming || !step) return;

    this.busy = true;
    this.freezeTrack();
    this.track.insertBefore(incoming, this.track.firstChild);
    this.refreshItems();
    this.index = 0;
    this.track.classList.add("is-sliding");
    this.track.style.willChange = "transform";
    this.track.style.transform = "translate3d(-" + step + "px, 0, 0)";
    void this.track.offsetWidth;
    this.track.style.transition = "";
    this.track.style.transform = "translate3d(0, 0, 0)";

    new Promise(function (resolve) {
      var settled = false;
      var finish = function () {
        if (settled) return;
        settled = true;
        self.track.removeEventListener("transitionend", onEnd);
        resolve();
      };

      var onEnd = function (event) {
        if (event.target !== self.track) return;
        if (event.propertyName !== "transform") return;
        finish();
      };

      self.track.addEventListener("transitionend", onEnd);
      window.setTimeout(finish, SLIDE_MS + 48);
    }).then(function () {
      self.commitTrackOffset();
      self.syncAccessibility();
      self.busy = false;
    });
  };

  PortalSlider.prototype.slideNext = function () {
    if (!this.items.length || this.busy) return;

    if (isDesktop()) {
      this.slideNextDesktop();
      return;
    }

    this.index = (this.index + 1) % this.items.length;
    this.scrollToIndex(this.index, true);
    this.syncAccessibility();
  };

  PortalSlider.prototype.slidePrev = function () {
    if (!this.items.length || this.busy) return;

    if (isDesktop()) {
      this.slidePrevDesktop();
      return;
    }

    this.index = (this.index - 1 + this.items.length) % this.items.length;
    this.scrollToIndex(this.index, true);
    this.syncAccessibility();
  };

  PortalSlider.prototype.onResize = function () {
    if (!this.track) return;

    this.commitTrackOffset();

    if (isDesktop()) {
      if (this.viewport) {
        this.viewport.style.overflow = "hidden";
      }
      this.track.style.overflow = "visible";
      this.index = 0;
      this.syncAccessibility();
      return;
    }

    if (this.viewport) {
      this.viewport.style.overflow = "";
    }
    this.track.style.overflow = "";
    this.scrollToIndex(this.index, false);
    this.syncAccessibility();
  };

  PortalSlider.prototype.startAutoplay = function () {
    var self = this;
    this.stopAutoplay();
    this.autoplayEnabled = true;
    this.timer = window.setInterval(function () {
      if (!self.autoplayEnabled || self.busy) return;
      self.slideNext();
    }, AUTOPLAY_MS);
  };

  PortalSlider.prototype.stopAutoplay = function () {
    this.autoplayEnabled = false;
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  };

  PortalSlider.prototype.restartAutoplay = function () {
    var self = this;
    this.stopAutoplay();
    window.setTimeout(function () {
      if (!self.root.matches(":hover") && !self.root.contains(document.activeElement)) {
        self.startAutoplay();
      }
    }, AUTOPLAY_MS);
  };

  PortalSlider.prototype.bindDrag = function () {
    if (!this.track) return;

    var self = this;
    var startX = 0;
    var scrollStart = 0;
    var dragging = false;

    this.track.addEventListener(
      "pointerdown",
      function (event) {
        if (isDesktop() || event.button !== 0) return;
        dragging = true;
        startX = event.clientX;
        scrollStart = self.track.scrollLeft;
        self.track.setPointerCapture(event.pointerId);
        self.stopAutoplay();
      },
      { passive: true }
    );

    this.track.addEventListener(
      "pointermove",
      function (event) {
        if (!dragging || isDesktop()) return;
        self.track.scrollLeft = scrollStart - (event.clientX - startX);
      },
      { passive: true }
    );

    var stopDrag = function (event) {
      if (!dragging) return;
      dragging = false;
      try {
        self.track.releasePointerCapture(event.pointerId);
      } catch (_err) {
        /* ignore */
      }

      var nearest = null;
      self.items.forEach(function (item, idx) {
        var distance = Math.abs(item.offsetLeft - self.track.scrollLeft);
        if (!nearest || distance < nearest.distance) {
          nearest = { idx: idx, distance: distance };
        }
      });

      if (nearest) {
        self.index = nearest.idx;
        self.scrollToIndex(self.index, true);
        self.syncAccessibility();
      }
      self.restartAutoplay();
    };

    this.track.addEventListener("pointerup", stopDrag);
    this.track.addEventListener("pointercancel", stopDrag);
  };

  PortalSlider.prototype.bindVisibility = function () {
    if (!("IntersectionObserver" in window)) return;

    var self = this;
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            self.startAutoplay();
          } else {
            self.stopAutoplay();
          }
        });
      },
      { threshold: 0.25 }
    );

    observer.observe(this.root);
  };

  PortalSlider.prototype.bind = function () {
    var self = this;

    if (this.prevBtn) {
      this.prevBtn.addEventListener("click", function (event) {
        event.preventDefault();
        self.stopAutoplay();
        self.slidePrev();
        self.restartAutoplay();
      });
    }

    if (this.nextBtn) {
      this.nextBtn.addEventListener("click", function (event) {
        event.preventDefault();
        self.stopAutoplay();
        self.slideNext();
        self.restartAutoplay();
      });
    }

    this.root.addEventListener("mouseenter", function () {
      self.stopAutoplay();
    });
    this.root.addEventListener("mouseleave", function () {
      self.startAutoplay();
    });
    this.root.addEventListener("focusin", function () {
      self.stopAutoplay();
    });
    this.root.addEventListener("focusout", function (event) {
      if (!self.root.contains(event.relatedTarget)) {
        self.startAutoplay();
      }
    });

    window.addEventListener("resize", this.onResize);
    this.bindDrag();
    this.bindVisibility();
    this.refreshItems();
    this.onResize();
    this.syncAccessibility();
    this.startAutoplay();
  };

  function initUsefulCardsTrack() {
    var track = document.querySelector("[data-useful-track]");
    if (!track) return;

    var startX = 0;
    var scrollStart = 0;
    var dragging = false;

    track.addEventListener(
      "pointerdown",
      function (event) {
        if (isDesktop()) return;
        dragging = true;
        startX = event.clientX;
        scrollStart = track.scrollLeft;
        track.setPointerCapture(event.pointerId);
      },
      { passive: true }
    );

    track.addEventListener(
      "pointermove",
      function (event) {
        if (!dragging || isDesktop()) return;
        track.scrollLeft = scrollStart - (event.clientX - startX);
      },
      { passive: true }
    );

    var stopDrag = function (event) {
      if (!dragging) return;
      dragging = false;
      try {
        track.releasePointerCapture(event.pointerId);
      } catch (_err) {
        /* ignore */
      }
    };

    track.addEventListener("pointerup", stopDrag);
    track.addEventListener("pointercancel", stopDrag);
  }

  var sliders = [];

  function init() {
    sliders = [];
    document.querySelectorAll("[data-portal-carousel]").forEach(function (root) {
      var slider = new PortalSlider(root);
      slider.bind();
      sliders.push(slider);
    });
    initUsefulCardsTrack();
  }

  function refreshEmployeeSliders() {
    sliders.forEach(function (slider) {
      slider.refreshItems();
      if (slider.items.length) {
        slider.index = Math.min(slider.index, slider.items.length - 1);
      } else {
        slider.index = 0;
      }
      slider.onResize();
      slider.syncAccessibility();
    });
  }

  document.addEventListener("portal-employees-updated", refreshEmployeeSliders);

  function boot() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
      return;
    }
    init();
  }

  if (document.querySelector("[data-employees-track]")) {
    document.addEventListener("portal-employees-ready", boot, { once: true });
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();