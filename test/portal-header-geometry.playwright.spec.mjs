import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";

const ROOT_DIR = process.cwd();

let chromium = null;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  void error;
}

const CHROMIUM_EXECUTABLE_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean);

function resolveChromiumExecutablePath() {
  if (!chromium) return "";
  try {
    const bundledPath = chromium.executablePath();
    if (bundledPath && fs.existsSync(bundledPath)) return bundledPath;
  } catch (error) {
    void error;
  }
  for (const candidatePath of CHROMIUM_EXECUTABLE_CANDIDATES) {
    if (fs.existsSync(candidatePath)) return candidatePath;
  }
  return "";
}

const CHROMIUM_EXECUTABLE_PATH = resolveChromiumExecutablePath();
const CHROMIUM_LAUNCH_OPTIONS = CHROMIUM_EXECUTABLE_PATH
  ? { headless: true, executablePath: CHROMIUM_EXECUTABLE_PATH }
  : { headless: true };

function resolvePlaywrightSkipReason() {
  if (!chromium) return "playwright package is not installed";
  if (!CHROMIUM_EXECUTABLE_PATH) return "playwright browser executable is not installed";
  return false;
}

function createStaticServer(rootDir) {
  return http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname);
    const relativePath = pathname === "/" ? "/index.html" : pathname;
    const targetPath = path.resolve(rootDir, `.${relativePath}`);
    if (!targetPath.startsWith(rootDir)) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }
    fs.readFile(targetPath, (error, buffer) => {
      if (error) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      const ext = path.extname(targetPath).toLowerCase();
      const contentType = ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".js"
            ? "application/javascript; charset=utf-8"
            : ext === ".svg"
              ? "image/svg+xml"
              : ext === ".png"
                ? "image/png"
                : ext === ".ico"
                  ? "image/x-icon"
                  : "application/octet-stream";
      response.writeHead(200, { "content-type": contentType });
      response.end(buffer);
    });
  });
}

function near(value, expected, tolerance, label) {
  assert.ok(
    Math.abs(value - expected) <= tolerance,
    `${label}: expected ${expected}±${tolerance}, got ${value}`
  );
}

function makeMockApiBody(pathname) {
  if (pathname.includes("/api/parent/children")) {
    return { ok: true, items: [] }
  }
  if (pathname.includes("/api/parent/dashboard")) {
    return { ok: true, children: [] }
  }
  if (pathname.includes("/api/parent/auth/me")) {
    return {
      ok: true,
      authenticated: true,
      user: { parentsId: "cmkramer001", role: "parent" },
    }
  }
  if (pathname.includes("/api/student/dashboard")) {
    return { ok: true, child: null }
  }
  if (pathname.includes("/api/student/news-calendar")) {
    return { ok: true, window: {}, calendar: [], items: [], openReport: null }
  }
  if (pathname.includes("/api/student/auth/me")) {
    return {
      ok: true,
      authenticated: true,
      user: { eaglesId: "kramer001", role: "student" },
    }
  }
  return { ok: true }
}

async function preparePortalMocks(page, apiOrigin) {
  await page.addInitScript((origin) => {
    const search = new URLSearchParams(globalThis.window?.location?.search || "")
    window.__SIS_PARENT_API_ORIGIN = origin
    window.__SIS_PARENT_INITIAL_AUTH__ = {
      authenticated: true,
      user: { parentsId: "cmkramer001", role: "parent" },
    }
    window.__SIS_STUDENT_API_ORIGIN = origin
    window.__SIS_STUDENT_INITIAL_AUTH__ =
      search.get("geo") === "login-desktop" ? {
        authenticated: false,
      } : {
        authenticated: true,
        user: { eaglesId: "kramer001", role: "student" },
      }
  }, apiOrigin)

  await page.route("**/api/parent/**", async (route) => {
    const url = new URL(route.request().url())
    const requestOrigin = route.request().headers().origin || apiOrigin
    await route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": requestOrigin,
        "access-control-allow-credentials": "true",
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(makeMockApiBody(url.pathname)),
    })
  })

  await page.route("**/api/student/**", async (route) => {
    const url = new URL(route.request().url())
    const requestOrigin = route.request().headers().origin || apiOrigin
    await route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": requestOrigin,
        "access-control-allow-credentials": "true",
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(makeMockApiBody(url.pathname)),
    })
  })
}

async function waitForMenuButtonVisible(page, selector) {
  await page.waitForFunction((input) => {
    const node = globalThis.document.querySelector(input)
    if (!(node instanceof globalThis.HTMLElement)) return false
    const rect = node.getBoundingClientRect()
    const style = globalThis.getComputedStyle(node)
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    )
  }, selector, { timeout: 10000 })
}

async function measureGeometry(page, url, selectors) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (selectors?.menu) {
    await waitForMenuButtonVisible(page, selectors.menu)
  }
  return await page.evaluate((input) => {
    const readRect = (selector) => {
      const node = globalThis.document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    };
    return {
      viewport: { w: globalThis.window.innerWidth, h: globalThis.window.innerHeight },
      studentAuthState: globalThis.document.documentElement.dataset.studentAuthState || "",
      menu: readRect(input.menu),
      header: readRect(input.header),
      logo: readRect(input.logo),
      container: readRect(input.container),
    };
  }, selectors);
}

async function measureMenuState(page, url, selectors) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (selectors?.menu) {
    await waitForMenuButtonVisible(page, selectors.menu)
  }
  await page.evaluate((selector) => {
    const node = globalThis.document.querySelector(selector);
    if (!(node instanceof globalThis.HTMLElement)) {
      throw new Error(`Missing menu button: ${selector}`);
    }
    node.click();
  }, selectors.menu);
  await page.waitForTimeout(240);
  const viewport = page.viewportSize();
  await page.mouse.move((viewport?.width ?? 1280) - 4, (viewport?.height ?? 800) - 4);
  return await page.evaluate((input) => {
    const readRect = (selector) => {
      const node = globalThis.document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    };
    const overlay = globalThis.document.querySelector(input.overlay);
    const overlayStyle = overlay ? globalThis.window.getComputedStyle(overlay) : null;
    return {
      viewport: { w: globalThis.window.innerWidth, h: globalThis.window.innerHeight },
      nav: readRect(input.nav),
      overlay: readRect(input.overlay),
      overlayOpacity: overlayStyle ? overlayStyle.opacity : "",
      overlayBg: overlayStyle ? overlayStyle.backgroundColor : "",
      menuOpen: globalThis.document.body.classList.contains("menu-open"),
    };
  }, selectors);
}

async function measureStudentLoginLayout(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    document.documentElement.dataset.studentAuthState = "unauthenticated";
  });
  await page.waitForTimeout(80);
  return await page.evaluate(() => {
    const readRect = (selector) => {
      const node = globalThis.document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    };
    return {
      viewport: { w: globalThis.window.innerWidth, h: globalThis.window.innerHeight },
      topbar: readRect(".topbar"),
      loginPanel: readRect("#loginPanel"),
      statusStrip: readRect(".status-strip"),
      menu: readRect("#menuBtn"),
    };
  });
}

const skipReason = resolvePlaywrightSkipReason();

test(
  "portal headers keep floating-hamburger geometry and mobile wrap-safe header spacing",
  { skip: skipReason },
  async () => {
    const server = createStaticServer(ROOT_DIR);
    let browser = null;
    let page = null;

    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS);
      page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await preparePortalMocks(page, `http://127.0.0.1:${port}`);

      const parentMobile = await measureGeometry(
        page,
        `http://127.0.0.1:${port}/web-asset/parent/parent-portal.html?geo=mobile`,
        { menu: "#parentMenuBtn", header: ".topbar", logo: ".brand-logo-wrap" }
      );
      const studentMobile = await measureGeometry(
        page,
        `http://127.0.0.1:${port}/web-asset/student/student-portal.html?geo=mobile`,
        { menu: "#menuBtn", header: ".topbar", logo: ".brand-logo-wrap" }
      );
      const parentMenuMobile = await measureMenuState(
        page,
        `http://127.0.0.1:${port}/web-asset/parent/parent-portal.html?geo=mobile-menu`,
        { menu: "#parentMenuBtn", nav: "#parentSideNav", overlay: "#parentNavScrim" }
      );
      const studentMenuMobile = await measureMenuState(
        page,
        `http://127.0.0.1:${port}/web-asset/student/student-portal.html?geo=mobile-menu`,
        { menu: "#menuBtn", nav: "#sideNav", overlay: "#navOverlay" }
      );
      for (const [label, geometry] of [["parent-mobile", parentMobile], ["student-mobile", studentMobile]]) {
        assert.ok(geometry.menu, `${label}: missing menu button`);
        assert.ok(geometry.header, `${label}: missing header`);
        assert.ok(geometry.logo, `${label}: missing logo frame`);
        const rightOffset = geometry.viewport.w - (geometry.menu.x + geometry.menu.w);
        near(rightOffset, 12, 2, `${label} menu right offset`);
        near(geometry.header.x, 16, 2, `${label} header x`);
        near(geometry.header.w, geometry.viewport.w - 32, 4, `${label} header width`);
        assert.ok(geometry.header.h <= 120, `${label} header should stay compact on mobile`);
        assert.ok(
          geometry.logo.x >= geometry.header.x + 8 && geometry.logo.x <= geometry.header.x + 96,
          `${label} logo should stay left-aligned inside the header`
        );
      }

      for (const [label, geometry] of [["parent-mobile-menu", parentMenuMobile], ["student-mobile-menu", studentMenuMobile]]) {
        assert.ok(geometry.menuOpen, `${label}: menu-open class should be set`);
        assert.ok(geometry.nav, `${label}: missing side nav rect`);
        assert.ok(geometry.overlay, `${label}: missing overlay rect`);
        assert.ok(geometry.nav.h < geometry.viewport.h, `${label}: side nav should not fill full viewport height`);
        assert.equal(geometry.overlay.w, geometry.viewport.w, `${label}: overlay width should cover viewport`);
        assert.equal(geometry.overlay.h, geometry.viewport.h, `${label}: overlay height should cover viewport`);
        assert.equal(Number(geometry.overlayOpacity), 1, `${label}: transparent click-away overlay should be active`);
        assert.equal(geometry.overlayBg, "rgba(0, 0, 0, 0)", `${label}: page behind drawer should stay visually solid`);
      }

      await page.setViewportSize({ width: 1366, height: 900 });

      const parentDesktop = await measureGeometry(
        page,
        `http://127.0.0.1:${port}/web-asset/parent/parent-portal.html?geo=desktop`,
        { menu: "#parentMenuBtn", header: ".topbar", logo: ".brand-logo-wrap" }
      );
      const studentDesktop = await measureGeometry(
        page,
        `http://127.0.0.1:${port}/web-asset/student/student-portal.html?geo=desktop`,
        { menu: "#menuBtn", header: ".topbar", logo: ".brand-logo-wrap" }
      );

      for (const [label, geometry] of [["parent-desktop", parentDesktop], ["student-desktop", studentDesktop]]) {
        assert.ok(geometry.menu, `${label}: missing menu button`);
        assert.ok(geometry.header, `${label}: missing header`);
        assert.ok(geometry.logo, `${label}: missing logo frame`);
        if (geometry.menu.w > 0 && geometry.menu.h > 0) {
          const rightOffset = geometry.viewport.w - (geometry.menu.x + geometry.menu.w);
          near(rightOffset, 12, 2, `${label} menu right offset`);
        }
        if (label === "student-desktop") {
          assert.ok(geometry.header.h <= 78, `${label} header should stay compact on desktop`);
          continue;
        }
        if (label === "student-desktop" && geometry.studentAuthState !== "authenticated") {
          near(geometry.header.x, 408, 4, `${label} header x`);
          near(geometry.header.w, 550, 4, `${label} header width`);
          assert.ok(geometry.header.h <= 78, `${label} header should stay compact on desktop`);
        } else {
          near(geometry.header.x, 16, 2, `${label} header x`);
          near(geometry.header.w, geometry.viewport.w - 32, 4, `${label} header width`);
          assert.ok(geometry.header.h <= 78, `${label} header should stay compact on desktop`);
        }
      }

      await page.setViewportSize({ width: 1920, height: 900 });
      const parentLarge = await measureGeometry(
        page,
        `http://127.0.0.1:${port}/web-asset/parent/parent-portal.html?geo=large-desktop`,
        { menu: "#parentMenuBtn", header: ".topbar", logo: ".brand-logo-wrap", container: ".portal-main" }
      );
      const studentLarge = await measureGeometry(
        page,
        `http://127.0.0.1:${port}/web-asset/student/student-portal.html?geo=large-desktop`,
        { menu: "#menuBtn", header: ".topbar", logo: ".brand-logo-wrap", container: ".portal-main" }
      );
      for (const [label, geometry] of [["parent-large", parentLarge], ["student-large", studentLarge]]) {
        assert.ok(geometry.menu, `${label}: missing menu button`);
        assert.ok(geometry.container, `${label}: missing content container`);
        near(
          geometry.container.x + geometry.container.w - (geometry.menu.x + geometry.menu.w),
          5,
          2,
          `${label} menu right edge to content right edge`
        );
      }

      // The content-max-width breakpoint must never push the shared hamburger
      // off the viewport. This covers the regression window immediately after
      // the 1440px shell width, on both member portals.
      for (const width of [1441, 1500, 1540]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [label, url, selector] of [
          ["parent-breakpoint", `http://127.0.0.1:${port}/web-asset/parent/parent-portal.html?geo=breakpoint-${width}`, "#parentMenuBtn"],
          ["student-breakpoint", `http://127.0.0.1:${port}/web-asset/student/student-portal.html?geo=breakpoint-${width}`, "#menuBtn"],
        ]) {
          const geometry = await measureGeometry(page, url, { menu: selector });
          assert.ok(geometry.menu, `${label}-${width}: missing menu button`);
          assert.ok(geometry.menu.x >= 0, `${label}-${width}: menu must not start off-screen`);
          assert.ok(
            geometry.menu.x + geometry.menu.w <= geometry.viewport.w,
            `${label}-${width}: menu must remain fully inside the viewport`,
          );
        }
      }

      await page.setViewportSize({ width: 1366, height: 900 });

      const studentLoginDesktop = await measureStudentLoginLayout(
        page,
        `http://127.0.0.1:${port}/web-asset/student/student-portal.html?geo=login-desktop`
      );

      assert.ok(studentLoginDesktop.loginPanel, "student-login-desktop: missing login panel");
      near(studentLoginDesktop.loginPanel.x, 408, 4, "student-login-desktop login panel x");
      assert.ok(
        studentLoginDesktop.loginPanel.w <= 560,
        "student-login-desktop: login panel should stay centered and narrow"
      );
      assert.equal(studentLoginDesktop.menu.w, 0, "student login must not expose a hamburger control");
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
      }
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  }
);
