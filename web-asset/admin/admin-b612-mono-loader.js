(() => {
  "use strict"

  const FONT_STYLESHEET = "/web-asset/fonts/B612Mono/stylesheet.css"
  const STYLE_ID = "sis-admin-b612-mono-styles"
  const root = document.documentElement
  let scheduled = false
  let started = false

  function markFallback() {
    root.dataset.adminMonoFont = "fallback"
  }

  function appendFontStylesheet() {
    const existing = document.getElementById(STYLE_ID)
    if (existing) return Promise.resolve()

    return new Promise((resolve, reject) => {
      const link = document.createElement("link")
      link.id = STYLE_ID
      link.rel = "stylesheet"
      link.href = FONT_STYLESHEET
      link.media = "all"
      link.dataset.adminDeferredAsset = "b612-mono"
      link.fetchPriority = "low"
      link.addEventListener("load", resolve, { once: true })
      link.addEventListener("error", () => reject(new Error("B612 Mono stylesheet failed to load")), { once: true })
      document.head.appendChild(link)
    })
  }

  async function loadB612Mono() {
    if (started) return
    started = true
    try {
      await appendFontStylesheet()
      if (document.fonts?.load) {
        await Promise.all([
          document.fonts.load('400 1em "B612 Mono"'),
          document.fonts.load('700 1em "B612 Mono"'),
          document.fonts.load('italic 400 1em "B612 Mono"'),
          document.fonts.load('italic 700 1em "B612 Mono"'),
        ])
      }
      root.classList.add("admin-b612-mono-loaded")
      root.dataset.adminMonoFont = "b612"
      window.dispatchEvent(new Event("sis-admin-b612-mono-ready"))
    } catch {
      started = false
      markFallback()
    }
  }

  function scheduleFontLoad() {
    if (scheduled) return
    scheduled = true
    const run = () => {
      void loadB612Mono()
    }
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, { timeout: 1500 })
      return
    }
    window.setTimeout(run, 0)
  }

  function waitForAdminBoot() {
    const body = document.body
    if (!body) return
    if (!body.classList.contains("admin-auth-booting")) {
      scheduleFontLoad()
      return
    }

    const observer = new MutationObserver(() => {
      if (document.body?.classList.contains("admin-auth-booting")) return
      observer.disconnect()
      scheduleFontLoad()
    })
    observer.observe(body, { attributeFilter: ["class"], attributes: true })
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForAdminBoot, { once: true })
  } else {
    waitForAdminBoot()
  }
})()
