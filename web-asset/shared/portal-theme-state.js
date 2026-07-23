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
    const current = globalThis.SIS_PORTAL_PREFERENCES?.get(STORAGE_KEY, "")
    return validTheme(current) ? current : ""
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
