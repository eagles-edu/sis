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

  function isLoopbackHostname(hostname) {
    const normalized = String(hostname || "").toLowerCase();
    return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
  }

  function resolveDevApiOrigin() {
    const currentOrigin = new URL(window.location.origin);
    const queryOrigin = new URLSearchParams(window.location.search || "").get("apiOrigin");
    const runtimePorts = new Set(["8786", "8787", "8788"]);
    if (queryOrigin) {
      try {
        const parsedOrigin = new URL(queryOrigin, currentOrigin);
        if (isLoopbackHostname(parsedOrigin.hostname) && !runtimePorts.has(parsedOrigin.port)) {
          return "http://127.0.0.1:8788";
        }
        return parsedOrigin.origin;
      } catch {
        return "http://127.0.0.1:8788";
      }
    }
    if (!isLoopbackHostname(currentOrigin.hostname)) return "";
    if (currentOrigin.port === "8788") return currentOrigin.origin;
    if (currentOrigin.port === "8786" || currentOrigin.port === "8787") return "";
    return "http://127.0.0.1:8788";
  }

  function applyApiOriginToPortalLinks(rootNode = document) {
    const apiOrigin = resolveDevApiOrigin();
    if (!apiOrigin) return 0;
    let updated = 0;
    rootNode.querySelectorAll('a[href^="/admin"], a[href^="/parent"], a[href^="/student"]').forEach((link) => {
      const rawHref = link.getAttribute("href");
      if (!rawHref || rawHref.startsWith("//")) return;
      const target = new URL(rawHref, window.location.origin);
      if (target.searchParams.has("apiOrigin")) return;
      target.searchParams.set("apiOrigin", apiOrigin);
      link.setAttribute("href", `${target.pathname}${target.search}${target.hash}`);
      updated += 1;
    });
    return updated;
  }

  root.applyApiOriginToPortalLinks = applyApiOriginToPortalLinks;

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
    root.applyApiOriginToPortalLinks?.(document);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runCopyrightYearUpdate, { once: true });
  } else {
    runCopyrightYearUpdate();
  }
})();
