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

async function measureGeometry(page, url, selectors) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
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
      menu: readRect(input.menu),
      header: readRect(input.header),
      logo: readRect(input.logo),
    };
  }, selectors);
}

async function measureMenuState(page, url, selectors) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.click(selectors.menu);
  await page.waitForTimeout(240);
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

const skipReason = chromium ? false : "playwright package is not installed";

test(
  "portal headers keep floating-hamburger geometry and admin-aligned header spacing",
  { skip: skipReason },
  async () => {
    const server = createStaticServer(ROOT_DIR);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

    try {
      const parentMobile = await measureGeometry(
        page,
        `http://127.0.0.1:${port}/web-asset/parent/parent-portal.html?geo=mobile`,
        { menu: "#parentMenuBtn", header: ".hero", logo: ".brand-logo-wrap" }
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
        near(geometry.header.x, 12, 2, `${label} header x`);
        assert.ok(geometry.header.h <= 92, `${label} header should stay single-line height`);
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
        assert.ok(Number(geometry.overlayOpacity) > 0.9, `${label}: overlay should be visibly shaded`);
        assert.ok(
          geometry.overlayBg.startsWith("rgba(12, 22, 39,"),
          `${label}: overlay color should stay dark scrim`
        );
      }

      await page.setViewportSize({ width: 1366, height: 900 });

      const parentDesktop = await measureGeometry(
        page,
        `http://127.0.0.1:${port}/web-asset/parent/parent-portal.html?geo=desktop`,
        { menu: "#parentMenuBtn", header: ".hero", logo: ".brand-logo-wrap" }
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
        const rightOffset = geometry.viewport.w - (geometry.menu.x + geometry.menu.w);
        near(rightOffset, 12, 2, `${label} menu right offset`);
        near(geometry.header.x, 16, 2, `${label} header x`);
        near(geometry.header.w, geometry.viewport.w - 32, 4, `${label} header width`);
        assert.ok(geometry.header.h <= 78, `${label} header should stay compact on desktop`);
      }
    } finally {
      await page.close();
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  }
);
