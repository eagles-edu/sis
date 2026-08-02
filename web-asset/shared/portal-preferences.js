(() => {
  "use strict"

  const VERSION = 1
  const memory = Object.create(null)
  let loaded = false
  let loadPromise = null

  function endpoint() {
    if (window.__SIS_ADMIN_PREFERENCES_PATH) return window.__SIS_ADMIN_PREFERENCES_PATH
    if (window.__SIS_PARENT_PREFERENCES_PATH) return window.__SIS_PARENT_PREFERENCES_PATH
    if (window.__SIS_STUDENT_PREFERENCES_PATH) return window.__SIS_STUDENT_PREFERENCES_PATH
    return ""
  }

  function isAuthenticated() {
    const authState = document.documentElement?.dataset || {}
    const stateKey = endpoint().includes("/parent/") ? "parentAuthState"
      : endpoint().includes("/student/") ? "studentAuthState"
      : "adminAuthState"
    if (authState[stateKey] === "authenticated") return true
    if (authState[stateKey] === "unauthenticated") return false
    const initialAuth = window.__SIS_ADMIN_INITIAL_AUTH__
      || window.__SIS_PARENT_INITIAL_AUTH__
      || window.__SIS_STUDENT_INITIAL_AUTH__
    return initialAuth?.authenticated === true
  }

  function safeObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {}
  }

  function applySavedTheme() {
    let cachedTheme = ""
    try { cachedTheme = window.localStorage.getItem("sis-theme") || "" } catch (error) { void error }
    const theme = cachedTheme === "dark" || cachedTheme === "light" ? cachedTheme : memory["sis-theme"]
    if (theme !== "dark" && theme !== "light") return
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    if (!cachedTheme) {
      try { window.localStorage.setItem("sis-theme", theme) } catch (error) { void error }
    }
    try {
      window.dispatchEvent(new CustomEvent("sis-theme-change", { detail: { theme } }))
    } catch (error) { void error }
  }

  function legacyKeys() {
    const keys = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key) keys.push(key)
    }
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index)
      if (key) keys.push(key)
    }
    return Array.from(new Set(keys)).filter((key) => key !== "sis-admin-authenticated")
  }

  async function load() {
    if (loaded) return memory
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      const path = endpoint()
      if (path) {
        try {
          const response = await fetch(path, { credentials: "include", headers: { Accept: "application/json" } })
          if (response.ok) {
            const payload = await response.json()
            Object.assign(memory, safeObject(payload?.preferences))
          }
        } catch (error) {
          void error
        }
      }
      applySavedTheme()
      loaded = true
      return memory
    })().finally(() => {
      loadPromise = null
    })
    return loadPromise
  }

  function get(key, fallback = null) {
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : fallback
  }

  async function save(key, value) {
    memory[key] = value
    if (key === "sis-theme" && (value === "dark" || value === "light")) {
      try { window.localStorage.setItem(key, value) } catch (error) { void error }
    }
    const path = endpoint()
    if (!path || !isAuthenticated()) return false
    try {
      const response = await fetch(path, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ preferences: { [key]: value }, migrationVersion: VERSION }),
      })
      return response.ok
    } catch (error) {
      void error
      return false
    }
  }

  async function migrate() {
    await load()
    const imported = {}
    for (const key of legacyKeys()) {
      let raw = null
      try { raw = window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key) } catch (error) { void error }
      if (raw === null) continue
      let value = raw
      try { value = JSON.parse(raw) } catch (error) { void error }
      if (!Object.prototype.hasOwnProperty.call(memory, key)) {
        memory[key] = value
        imported[key] = value
      }
    }
    if (Object.keys(imported).length && endpoint()) {
      try {
        const response = await fetch(endpoint(), {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ preferences: imported, migrationVersion: VERSION }),
        })
        if (response.ok) {
          for (const key of Object.keys(imported)) {
            try { window.localStorage.removeItem(key); window.sessionStorage.removeItem(key) } catch (error) { void error }
          }
        }
      } catch (error) {
        void error
      }
    }
    return memory
  }

  window.SIS_PORTAL_PREFERENCES = Object.freeze({ load, get, save, migrate })

  const initialAuth = window.__SIS_ADMIN_INITIAL_AUTH__
    || window.__SIS_PARENT_INITIAL_AUTH__
    || window.__SIS_STUDENT_INITIAL_AUTH__
  if (initialAuth?.authenticated) void migrate()
})()
