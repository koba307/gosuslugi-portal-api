(function () {
  var FADE_DURATION_MS = 300;
  var MAIN_PAGE_DURATION_MS = 2000;
  var OTHER_PAGE_DURATION_MS = 1300;

  function getLoaderDuration() {
    var loader = document.getElementById("start-app-loader");
    if (loader && loader.dataset.loaderDuration) {
      var custom = parseInt(loader.dataset.loaderDuration, 10);
      if (!isNaN(custom) && custom > 0) {
        return custom;
      }
    }

    var path = (window.location.pathname || "").toLowerCase();
    var file = path.split("/").pop() || "index.html";
    var isMainPage = !file || file === "index.html";

    return isMainPage ? MAIN_PAGE_DURATION_MS : OTHER_PAGE_DURATION_MS;
  }

  function hideLoader() {
    var loader = document.getElementById("start-app-loader");
    var body = document.body;

    if (!loader) {
      if (body) {
        body.classList.remove("portal-loading");
      }
      return;
    }

    loader.classList.add("is-hiding");
    loader.setAttribute("aria-hidden", "true");

    if (body) {
      body.classList.remove("portal-loading");
    }

    window.setTimeout(function () {
      loader.classList.add("is-hidden");
      if (loader.parentNode) {
        loader.parentNode.removeChild(loader);
      }
    }, FADE_DURATION_MS);
  }

  window.setTimeout(hideLoader, getLoaderDuration());
})();