(function () {
  "use strict";

  var LOCAL_BASE = "copi_files/robot-max/assets/videos/";
  var STATIC_LOOPS = [
    "static-loop-1",
    "static-loop-2",
    "static-loop-3",
    "static-loop-4",
  ];
  var GREET_INTERVAL_MS = 60000;

  function videoUrl(name) {
    return LOCAL_BASE + name + "/_.webm";
  }

  function RobotMaxPlayer(container) {
    this.container = container;
    this.canvas = container.querySelector(".animation-canvas");
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext("2d");
    this.videoA = document.createElement("video");
    this.videoB = document.createElement("video");
    this.activeVideo = null;
    this.pendingVideo = null;
    this.currentAnimation = null;
    this.lastPlayedAnimation = null;
    this.loopIndex = -1;
    this.frameId = 0;
    this.greetTimer = null;
    this.destroyed = false;

    [this.videoA, this.videoB].forEach(function (video) {
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
    });

    this.onEnded = this.onEnded.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    this.renderFrame = this.renderFrame.bind(this);

    document.addEventListener("visibilitychange", this.onVisibility);
    this.init();
  }

  RobotMaxPlayer.prototype.init = function () {
    this.canvas.width = 512;
    this.canvas.height = 512;
    this.play("greet");
    this.startRenderLoop();
    this.scheduleGreet();
  };

  RobotMaxPlayer.prototype.scheduleGreet = function () {
    var self = this;
    if (this.greetTimer) clearInterval(this.greetTimer);
    this.greetTimer = setInterval(function () {
      if (!document.hidden && self.currentAnimation !== "greet") {
        self.play("greet");
      }
    }, GREET_INTERVAL_MS);
  };

  RobotMaxPlayer.prototype.getNextStaticLoop = function () {
    this.loopIndex = (this.loopIndex + 1) % STATIC_LOOPS.length;
    return STATIC_LOOPS[this.loopIndex];
  };

  RobotMaxPlayer.prototype.loadVideo = function (video, name) {
    video.src = videoUrl(name);
    video.load();
  };

  RobotMaxPlayer.prototype.pickInactiveVideo = function () {
    return this.activeVideo === this.videoA ? this.videoB : this.videoA;
  };

  RobotMaxPlayer.prototype.play = function (name) {
    if (this.destroyed || this.currentAnimation === name) return;

    var nextVideo = this.pickInactiveVideo();
    this.pendingVideo = nextVideo;
    this.currentAnimation = name;
    this.lastPlayedAnimation = name;

    nextVideo.removeEventListener("ended", this.onEnded);
    this.loadVideo(nextVideo, name);

    var self = this;
    var startPlayback = function () {
      nextVideo.removeEventListener("canplay", startPlayback);
      if (self.destroyed || self.pendingVideo !== nextVideo) return;

      nextVideo.currentTime = 0;
      var playPromise = nextVideo.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(function () {});
      }

      self.activeVideo = nextVideo;
      self.pendingVideo = null;
      nextVideo.addEventListener("ended", self.onEnded);
    };

    if (nextVideo.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      startPlayback();
    } else {
      nextVideo.addEventListener("canplay", startPlayback);
    }
  };

  RobotMaxPlayer.prototype.onEnded = function () {
    if (this.currentAnimation === "greet") {
      this.play(this.getNextStaticLoop());
      return;
    }

    if (/^static-loop-\d+$/.test(this.currentAnimation)) {
      this.play(this.getNextStaticLoop());
      return;
    }

    if (this.currentAnimation === "wait-start") {
      this.play("wait-loop");
      return;
    }
  };

  RobotMaxPlayer.prototype.startRenderLoop = function () {
    var self = this;
    function tick() {
      self.renderFrame();
      self.frameId = requestAnimationFrame(tick);
    }
    this.frameId = requestAnimationFrame(tick);
  };

  RobotMaxPlayer.prototype.renderFrame = function () {
    var video = this.activeVideo;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
  };

  RobotMaxPlayer.prototype.onVisibility = function () {
    if (!document.hidden && this.activeVideo) {
      var p = this.activeVideo.play();
      if (p && p.catch) p.catch(function () {});
    }
  };

  RobotMaxPlayer.prototype.destroy = function () {
    this.destroyed = true;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    if (this.greetTimer) clearInterval(this.greetTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    [this.videoA, this.videoB].forEach(function (v) {
      v.pause();
      v.removeAttribute("src");
      v.load();
    });
  };

  function init() {
    var mascot = document.querySelector(".search-field rm-mascot.robot-max");
    if (!mascot) return;
    new RobotMaxPlayer(mascot);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();