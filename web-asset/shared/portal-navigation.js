(() => {
  const root = window.SISPortalNav || (window.SISPortalNav = {});

  function scrollElementIntoView(target, options = {}) {
    if (!target) return false;
    const element =
      typeof target === "string" ? document.querySelector(target) : target;
    if (!element || typeof element.scrollIntoView !== "function") return false;
    const raf = window.requestAnimationFrame?.bind(window) || ((callback) => window.setTimeout(callback, 0));
    raf(() => {
      raf(() => {
        element.scrollIntoView({
          behavior: options.behavior || "auto",
          block: options.block || "start",
          inline: options.inline || "nearest",
        });
      });
    });
    return true;
  }

  root.scrollElementIntoView = scrollElementIntoView;

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
        const destination = getDestination(link) || "";
        if (!destination.startsWith("#")) return;
        event.preventDefault();
        if (typeof onActivate === "function") {
          onActivate({ link, destination });
        }
        if (typeof onClose === "function") {
          onClose({ link, destination });
        }
      });
    });
    return links;
  };

  root.scrollPageTop = function scrollPageTop(options = {}) {
    const raf = window.requestAnimationFrame?.bind(window) || ((callback) => window.setTimeout(callback, 0));
    raf(() => {
      window.scrollTo({
        behavior: options.behavior || "auto",
        left: 0,
        top: 0,
      });
    });
  };

  root.updateCopyrightYears = function updateCopyrightYears(rootNode = document) {
    const year = new Date().getFullYear();
    rootNode.querySelectorAll("[data-copyright-year]").forEach((el) => {
      const start = Number.parseInt(el.getAttribute("data-start"), 10);
      el.textContent = Number.isFinite(start) && start < year ? `${start}–${year}` : String(year);
    });
  };

  const runCopyrightYearUpdate = () => {
    root.updateCopyrightYears?.(document);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runCopyrightYearUpdate, { once: true });
  } else {
    runCopyrightYearUpdate();
  }
})();
