(() => {
  const STORAGE_KEY = "sis-theme"
  const LEGACY_KEYS = ["sis-theme-admin", "sis-theme-parent", "sis-theme-student"]

  function validTheme(theme) {
    return theme === "dark" || theme === "light"
  }

  function syncColorScheme(theme) {
    document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light"
  }

  function readCachedTheme() {
    try {
      const cached = globalThis.localStorage?.getItem(STORAGE_KEY)
      return validTheme(cached) ? cached : ""
    } catch (error) {
      void error
      return ""
    }
  }

  function migrateCachedLegacyTheme() {
    try {
      let migrated = ""
      for (const key of LEGACY_KEYS) {
        const legacy = globalThis.localStorage?.getItem(key)
        if (!migrated && validTheme(legacy)) migrated = legacy
        globalThis.localStorage?.removeItem(key)
      }
      if (migrated) cacheTheme(migrated)
      return migrated
    } catch (error) {
      void error
    }
    return ""
  }

  function cacheTheme(theme) {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, theme)
    } catch (error) {
      void error
    }
  }

  function announceTheme(theme) {
    try {
      globalThis.dispatchEvent?.(new globalThis.CustomEvent("sis-theme-change", {
        detail: { theme },
      }))
    } catch (error) {
      void error
    }
  }

  function migrateLegacyTheme() {
    const current = globalThis.SIS_PORTAL_PREFERENCES?.get(STORAGE_KEY, "")
    return validTheme(current) ? current : readCachedTheme() || migrateCachedLegacyTheme()
  }

  function initTheme(defaultTheme = "light") {
    const next = readCachedTheme() || migrateLegacyTheme() || (validTheme(defaultTheme) ? defaultTheme : "light")
    document.documentElement.dataset.theme = next
    syncColorScheme(next)
    cacheTheme(next)
    announceTheme(next)
    return next
  }

  function setTheme(theme) {
    const next = validTheme(theme) ? theme : "light"
    document.documentElement.dataset.theme = next
    syncColorScheme(next)
    cacheTheme(next)
    announceTheme(next)
    void globalThis.SIS_PORTAL_PREFERENCES?.save(STORAGE_KEY, next)
    return next
  }

  function getTheme(defaultTheme = "light") {
    const current = document.documentElement.dataset.theme
    if (validTheme(current)) return current
    return initTheme(defaultTheme)
  }

  function toggleTheme(defaultTheme = "light") {
    const current = getTheme(defaultTheme)
    return setTheme(current === "dark" ? "light" : "dark")
  }

  globalThis.SIS_PORTAL_THEME = {
    STORAGE_KEY,
    LEGACY_KEYS,
    validTheme,
    initTheme,
    setTheme,
    getTheme,
    toggleTheme,
  }
})()
