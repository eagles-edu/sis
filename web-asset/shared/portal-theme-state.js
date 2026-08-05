(() => {
  const STORAGE_KEY = "sis-theme"
  const LEGACY_KEYS = ["sis-theme-admin", "sis-theme-parent", "sis-theme-student"]
  const CONSENT_STORAGE_KEY = "sis-consent-preferences"
  const CONSENT_VERSION = 1
  const CONSENT_REVIEW_MS = 365 * 24 * 60 * 60 * 1000
  const BREVO_CONVERSATIONS_ID = "6a69c88b5131e8e4fc0cf347"
  const BREVO_CONVERSATIONS_SCRIPT = "https://conversations-widget.brevo.com/brevo-conversations.js"

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
    return readCachedTheme() || migrateCachedLegacyTheme()
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

  function safeStorageRead(key) {
    try {
      return globalThis.localStorage?.getItem(key) || ""
    } catch (error) {
      void error
      return ""
    }
  }

  function safeStorageWrite(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value)
      return true
    } catch (error) {
      void error
      return false
    }
  }

  function validConsentValue(value) {
    return value === "granted" || value === "denied"
  }

  function normalizeConsentPreferences(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    if (Number(value.version) !== CONSENT_VERSION) return null
    if (!validConsentValue(value.supportChat) || !validConsentValue(value.analytics)) return null
    const updatedAtMs = Date.parse(String(value.updatedAt || ""))
    if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > CONSENT_REVIEW_MS) return null
    return {
      version: CONSENT_VERSION,
      supportChat: value.supportChat,
      analytics: value.analytics,
      updatedAt: new Date(updatedAtMs).toISOString(),
    }
  }

  function readConsentPreferences() {
    const raw = safeStorageRead(CONSENT_STORAGE_KEY)
    if (!raw) return null
    try {
      return normalizeConsentPreferences(JSON.parse(raw))
    } catch (error) {
      void error
      return null
    }
  }

  function writeConsentPreferences(supportChat, analytics) {
    const preferences = {
      version: CONSENT_VERSION,
      supportChat: validConsentValue(supportChat) ? supportChat : "denied",
      analytics: validConsentValue(analytics) ? analytics : "denied",
      updatedAt: new Date().toISOString(),
    }
    safeStorageWrite(CONSENT_STORAGE_KEY, JSON.stringify(preferences))
    try {
      globalThis.dispatchEvent?.(new globalThis.CustomEvent("sis-consent-change", { detail: preferences }))
    } catch (error) {
      void error
    }
    return preferences
  }

  function setConsentAttributes(preferences) {
    const root = document.documentElement
    root.dataset.sisSupportChatConsent = preferences?.supportChat || "undecided"
    root.dataset.sisAnalyticsConsent = preferences?.analytics || "undecided"
  }

  function installBrevoConversation() {
    if (globalThis.__SIS_BREVO_CONVERSATION_LOADED__ || globalThis.__SIS_BREVO_CONVERSATION_DISABLED__ || document.querySelector('script[data-sis-consent-integration="brevo"]')) return
    globalThis.BrevoConversationsID = BREVO_CONVERSATIONS_ID
    globalThis.BrevoConversations = globalThis.BrevoConversations || function(...args) {
      ;(globalThis.BrevoConversations.q = globalThis.BrevoConversations.q || []).push(args)
    }
    const script = document.createElement("script")
    script.async = true
    script.src = BREVO_CONVERSATIONS_SCRIPT
    script.dataset.sisConsentIntegration = "brevo"
    script.addEventListener("load", () => {
      globalThis.__SIS_BREVO_CONVERSATION_LOADED__ = true
      installBrevoConversationA11y()
    }, { once: true })
    document.head?.appendChild(script)
  }

  function removeBrevoConversation() {
    globalThis.__SIS_BREVO_CONVERSATION_DISABLED__ = true
    globalThis.__SIS_BREVO_CONVERSATION_LOADED__ = false
    document.querySelectorAll('script[data-sis-consent-integration="brevo"], #brevo-conversations').forEach((node) => node.remove())
    document.querySelectorAll('[id^="brevo-conversations"], [class*="brevo-conversations"]').forEach((node) => node.remove())
  }

  function clearFirstPartyAnalyticsCookies() {
    document.cookie.split(";").map((part) => part.split("=")[0].trim()).filter((name) => /^_ga(?:_|$)|^_gid$|^_gat(?:_|$)/u.test(name)).forEach((name) => {
      document.cookie = `${name}=; Max-Age=0; path=/`
    })
  }

  function setGoogleConsent(mode) {
    if (typeof globalThis.gtag !== "function") return
    const granted = mode === "granted"
    globalThis.gtag("consent", "update", {
      analytics_storage: granted ? "granted" : "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    })
  }

  function installGoogleAnalytics() {
    const measurementId = String(globalThis.__SIS_GA4_MEASUREMENT_ID || "").trim()
    if (!measurementId || globalThis.__SIS_GA4_LOADED__ || globalThis.__SIS_GA4_DISABLED__ || document.querySelector('script[data-sis-consent-integration="analytics"]')) return
    globalThis.dataLayer = globalThis.dataLayer || []
    globalThis.gtag = globalThis.gtag || function(...args) { globalThis.dataLayer.push(args) }
    globalThis.gtag("consent", "default", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      wait_for_update: 500,
    })
    globalThis.gtag("consent", "update", {
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    })
    globalThis.gtag("js", new Date())
    globalThis.gtag("config", measurementId, { anonymize_ip: true })
    const script = document.createElement("script")
    script.async = true
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`
    script.dataset.sisConsentIntegration = "analytics"
    script.addEventListener("load", () => { globalThis.__SIS_GA4_LOADED__ = true }, { once: true })
    document.head?.appendChild(script)
  }

  function removeGoogleAnalytics() {
    globalThis.__SIS_GA4_DISABLED__ = true
    globalThis.__SIS_GA4_LOADED__ = false
    setGoogleConsent("denied")
    document.querySelectorAll('script[data-sis-consent-integration="analytics"]').forEach((node) => node.remove())
    clearFirstPartyAnalyticsCookies()
  }

  function consentCopy(locale) {
    if (locale === "vi") {
      return {
        title: "Quyền riêng tư của bạn",
        description: "Bạn có thể cho phép trò chuyện hỗ trợ Brevo và Google Analytics đo lường việc sử dụng cổng thông tin. Cả hai đều không được tải trước khi bạn đồng ý.",
        chat: "Trò chuyện hỗ trợ Brevo",
        chatDescription: "Cho phép công cụ trò chuyện hỗ trợ của bên thứ ba.",
        analytics: "Google Analytics",
        analyticsDescription: "Cho phép đo lường ẩn danh về việc sử dụng cổng thông tin.",
        acceptAll: "Cho phép tất cả",
        rejectAll: "Từ chối tất cả",
        save: "Lưu lựa chọn",
        manage: "Quản lý quyền riêng tư",
        close: "Đóng",
        saved: "Đã lưu lựa chọn quyền riêng tư.",
      }
    }
    return {
      title: "Your privacy choices",
      description: "You can allow Brevo support chat and Google Analytics to help us provide support and understand portal usage. Neither loads before you choose.",
      chat: "Brevo support chat",
      chatDescription: "Allow the third-party support chat tool.",
      analytics: "Google Analytics",
      analyticsDescription: "Allow anonymous measurement of portal usage.",
      acceptAll: "Accept all",
      rejectAll: "Reject all",
      save: "Save choices",
      manage: "Manage privacy preferences",
      close: "Close",
      saved: "Your privacy choices were saved.",
    }
  }

  function removeConsentUi() {
    document.getElementById("sisConsentPanel")?.remove()
  }

  function renderConsentUi(locale, preferences = null, open = false) {
    const copy = consentCopy(locale)
    removeConsentUi()
    const panel = document.createElement("section")
    panel.id = "sisConsentPanel"
    panel.className = "sis-consent-panel"
    panel.hidden = !open
    panel.setAttribute("aria-labelledby", "sisConsentTitle")
    panel.setAttribute("aria-describedby", "sisConsentDescription")
    panel.innerHTML = `
      <div class="sis-consent-panel__content">
        <h2 id="sisConsentTitle">${copy.title}</h2>
        <p id="sisConsentDescription">${copy.description}</p>
        <div class="sis-consent-options">
          <label class="sis-consent-option"><input type="checkbox" data-sis-consent="supportChat"><span><strong>${copy.chat}</strong><small>${copy.chatDescription}</small></span></label>
          <label class="sis-consent-option"><input type="checkbox" data-sis-consent="analytics"><span><strong>${copy.analytics}</strong><small>${copy.analyticsDescription}</small></span></label>
        </div>
        <div class="sis-consent-panel__actions">
          <button type="button" class="portal-button portal-button-primary" data-sis-consent-action="accept-all">${copy.acceptAll}</button>
          <button type="button" class="portal-button portal-button-info" data-sis-consent-action="reject-all">${copy.rejectAll}</button>
          <button type="button" class="portal-button portal-button-secondary" data-sis-consent-action="save">${copy.save}</button>
          <button type="button" class="portal-button portal-button-immutable-chrome" data-sis-consent-action="close">${copy.close}</button>
        </div>
        <p class="sis-consent-panel__status" role="status" aria-live="polite"></p>
      </div>`
    document.body?.appendChild(panel)
    const saved = preferences || { supportChat: "denied", analytics: "denied" }
    panel.querySelector('[data-sis-consent="supportChat"]').checked = saved.supportChat === "granted"
    panel.querySelector('[data-sis-consent="analytics"]').checked = saved.analytics === "granted"
    panel.addEventListener("click", (event) => {
      const action = event.target.closest("[data-sis-consent-action]")?.dataset.sisConsentAction
      if (!action) return
      if (action === "close") {
        panel.hidden = true
        return
      }
      const next = action === "accept-all"
        ? { supportChat: "granted", analytics: "granted" }
        : action === "reject-all"
          ? { supportChat: "denied", analytics: "denied" }
          : {
              supportChat: panel.querySelector('[data-sis-consent="supportChat"]').checked ? "granted" : "denied",
              analytics: panel.querySelector('[data-sis-consent="analytics"]').checked ? "granted" : "denied",
            }
      const savedPreferences = writeConsentPreferences(next.supportChat, next.analytics)
      applyConsentPreferences(savedPreferences)
      panel.hidden = true
      const status = document.getElementById("sisConsentStatus")
      if (status) status.textContent = copy.saved
    })
    return panel
  }

  function applyConsentPreferences(preferences) {
    setConsentAttributes(preferences)
    if (preferences?.supportChat === "granted") {
      globalThis.__SIS_BREVO_CONVERSATION_DISABLED__ = false
      installBrevoConversation()
    } else {
      removeBrevoConversation()
    }
    if (preferences?.analytics === "granted") {
      globalThis.__SIS_GA4_DISABLED__ = false
      installGoogleAnalytics()
    } else {
      removeGoogleAnalytics()
    }
  }

  function initPrivacyConsent({ locale = "en" } = {}) {
    if (globalThis.__SIS_PRIVACY_CONSENT_INITIALIZED__) return readConsentPreferences()
    globalThis.__SIS_PRIVACY_CONSENT_INITIALIZED__ = true
    const normalizedLocale = locale === "vi" ? "vi" : "en"
    const preferences = readConsentPreferences()
    setConsentAttributes(preferences)
    const panel = renderConsentUi(normalizedLocale, preferences, !preferences)
    const footer = document.querySelector(".portal-login-footer")
    if (footer && !document.getElementById("sisConsentStatus")) {
      const action = document.createElement("p")
      action.className = "hub-footer__action sis-consent-footer-action"
      action.innerHTML = '<button type="button" class="sis-consent-manage" id="sisConsentManage">' + consentCopy(normalizedLocale).manage + '</button><span class="sis-consent-status" id="sisConsentStatus" role="status" aria-live="polite"></span>'
      footer.appendChild(action)
      action.querySelector("button").addEventListener("click", () => {
        panel.hidden = false
        panel.querySelector('[data-sis-consent-action="close"]')?.focus()
      })
    }
    if (preferences) applyConsentPreferences(preferences)
    return preferences
  }

  function installBrevoConversationA11y() {
    if (globalThis.__SIS_BREVO_CONVERSATION_A11Y__) return
    globalThis.__SIS_BREVO_CONVERSATION_A11Y__ = true

    const normalizeFields = () => {
      document.querySelectorAll("textarea.js-chat-textarea").forEach((field, index) => {
        if (!field.id) field.id = `brevoConversationMessage${index ? `-${index + 1}` : ""}`
        if (!field.name) field.name = "message"
        if (field.getAttribute("autocomplete") !== "off") field.setAttribute("autocomplete", "off")
      })
    }

    normalizeFields()
    if (globalThis.MutationObserver && document.documentElement) {
      const observer = new MutationObserver(normalizeFields)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["autocomplete", "id", "name"],
        childList: true,
        subtree: true,
      })
    }
  }

  globalThis.SIS_PORTAL_THEME = {
    STORAGE_KEY,
    LEGACY_KEYS,
    validTheme,
    initTheme,
    setTheme,
    getTheme,
    toggleTheme,
    installBrevoConversationA11y,
    CONSENT_STORAGE_KEY,
    CONSENT_VERSION,
    readConsentPreferences,
    writeConsentPreferences,
    initPrivacyConsent,
    applyConsentPreferences,
  }
})()
