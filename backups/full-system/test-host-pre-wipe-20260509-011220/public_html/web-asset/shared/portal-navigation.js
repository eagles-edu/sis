(() => {
  const root = window.SISPortalNav || (window.SISPortalNav = {});

  function scheduleScroll(destination) {
    if (!destination) return;
    const raf = window.requestAnimationFrame?.bind(window) || ((callback) => window.setTimeout(callback, 0));
    raf(() => {
      raf(() => {
        const target = document.querySelector(destination);
        target?.scrollIntoView({ behavior: "auto", block: "start" });
      });
    });
  }

  root.bindAnchoredNavLinks = function bindAnchoredNavLinks({
    selector = ".side-link",
    getDestination = (link) => link.getAttribute("href") || "",
    onActivate = null,
    onClose = null,
    rootNode = document,
  } = {}) {
    const links = rootNode.querySelectorAll(selector);
    links.forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const destination = getDestination(link) || "";
        if (typeof onActivate === "function") {
          onActivate({ link, destination });
        }
        scheduleScroll(destination);
        if (typeof onClose === "function") {
          onClose({ link, destination });
        }
      });
    });
    return links;
  };
})();
