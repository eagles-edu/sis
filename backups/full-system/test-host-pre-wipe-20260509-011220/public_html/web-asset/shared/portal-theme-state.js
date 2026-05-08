(() => {
  const STORAGE_KEY = "sis-theme"
  const LEGACY_KEYS = ["sis-theme-admin", "sis-theme-parent", "sis-theme-student"]

  function validTheme(theme) {
    return theme === "dark" || theme === "light"
  }

  function syncColorScheme(theme) {
    document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light"
  }

  function migrateLegacyTheme() {
    try {
      const current = localStorage.getItem(STORAGE_KEY)
      if (validTheme(current)) return current
      for (const key of LEGACY_KEYS) {
        const legacy = localStorage.getItem(key)
        if (!validTheme(legacy)) continue
        localStorage.setItem(STORAGE_KEY, legacy)
        for (const legacyKey of LEGACY_KEYS) localStorage.removeItem(legacyKey)
        return legacy
      }
    } catch {
      return ""
    }
    return ""
  }

  function initTheme(defaultTheme = "light") {
    const next = migrateLegacyTheme() || (validTheme(defaultTheme) ? defaultTheme : "light")
    document.documentElement.dataset.theme = next
    syncColorScheme(next)
    return next
  }

  function setTheme(theme) {
    const next = validTheme(theme) ? theme : "light"
    document.documentElement.dataset.theme = next
    syncColorScheme(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
      for (const legacyKey of LEGACY_KEYS) localStorage.removeItem(legacyKey)
    } catch {
      void 0
    }
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
