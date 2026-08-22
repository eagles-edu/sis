(() => {
  "use strict"

  if (window.__SIS_PORTAL_PREFERENCES_SINGLETON__) {
    window.SIS_PORTAL_PREFERENCES = window.__SIS_PORTAL_PREFERENCES_SINGLETON__
    return
  }

  const VERSION = 1
  const LOCAL_ONLY_KEYS = new Set(["sis-theme", "sis-theme-admin", "sis-theme-parent", "sis-theme-student"])
  const memory = Object.create(null)
  let loaded = false
  let loadPromise = null

  function endpoint() {
    if (window.__SIS_SETTINGS_PREFERENCES_PATH) return window.__SIS_SETTINGS_PREFERENCES_PATH
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
    || window.__SIS_SETTINGS_INITIAL_AUTH__
    return initialAuth?.authenticated === true
  }

  function safeObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {}
  }

  function validConsentPreference(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    if (Number(value.version) !== Number(window.SIS_PORTAL_THEME?.CONSENT_VERSION || 1)) return false
    if (!((value.supportChat === "granted" || value.supportChat === "denied") &&
      (value.analytics === "granted" || value.analytics === "denied"))) return false
    const updatedAtMs = Date.parse(String(value.updatedAt || ""))
    return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs <= 365 * 24 * 60 * 60 * 1000
  }

  function syncConsentPreference() {
    const theme = window.SIS_PORTAL_THEME
    const key = theme?.CONSENT_STORAGE_KEY || "sis-consent-preferences"
    const preference = memory[key]
    if (!validConsentPreference(preference) || !theme?.writeConsentPreferences) return false
    const saved = theme.writeConsentPreferences(preference.supportChat, preference.analytics, {
      noticeAcknowledgedAt: preference.noticeAcknowledgedAt,
      preserveNoticeAcknowledgement: false,
    })
    theme.applyConsentPreferences?.(saved)
    const panel = document.getElementById("sisConsentPanel")
    if (saved.noticeAcknowledgedAt) {
      panel?.remove()
    } else if (panel) {
      panel.hidden = false
    }
    return true
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
    return Array.from(new Set(keys)).filter((key) => key !== "sis-admin-authenticated" && !LOCAL_ONLY_KEYS.has(key))
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
            syncConsentPreference()
          }
        } catch (error) {
          void error
        }
      }
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

  async function save(key, value, options = {}) {
    memory[key] = value
    if (key === "sis-theme" && (value === "dark" || value === "light")) {
      try { window.localStorage.setItem(key, value) } catch (error) { void error }
      return true
    }
    const path = endpoint()
    if (!path || !isAuthenticated()) return false
    try {
      const response = await fetch(path, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          preferences: { [key]: value },
          migrationVersion: VERSION,
          privacyPreferenceSource: options?.privacyPreferenceSource,
        }),
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
          syncConsentPreference()
        }
      } catch (error) {
        void error
      }
    }
    return memory
  }

  const preferencesApi = Object.freeze({ load, get, save, migrate })
  window.__SIS_PORTAL_PREFERENCES_SINGLETON__ = preferencesApi
  window.SIS_PORTAL_PREFERENCES = preferencesApi

  const initialAuth = window.__SIS_ADMIN_INITIAL_AUTH__
    || window.__SIS_PARENT_INITIAL_AUTH__
    || window.__SIS_STUDENT_INITIAL_AUTH__
    || window.__SIS_SETTINGS_INITIAL_AUTH__
  if (initialAuth?.authenticated) void migrate()
})()
