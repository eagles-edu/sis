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

  function normalizeBrevoIdentity(identity) {
    const next = identity && typeof identity === "object" ? identity : {}
    const eaglesId = String(next.eaglesId || "").trim()
    const parentId = String(next.parentId || "").trim()
    const displayId = eaglesId || parentId
    return {
      firstName: displayId || null,
      notes: displayId || null,
      eaglesId: eaglesId || null,
      parentId: parentId || null,
    }
  }

  function setBrevoIdentity(identity) {
    const next = normalizeBrevoIdentity(identity)
    globalThis.__SIS_BREVO_IDENTITY__ = next
    if (typeof globalThis.BrevoConversations === "function") {
      globalThis.BrevoConversations("updateIntegrationData", next)
    }
    return next
  }

  if (!globalThis.__SIS_BREVO_IDENTITY_LISTENER__) {
    globalThis.__SIS_BREVO_IDENTITY_LISTENER__ = true
    globalThis.addEventListener?.("sis-brevo-identity-change", (event) => {
      setBrevoIdentity(event?.detail)
    })
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
      setBrevoIdentity(globalThis.__SIS_BREVO_IDENTITY__)
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

  function consentPortalKind(portal = "") {
    if (portal === "parent" || portal === "student") return portal
    return window.location?.pathname?.startsWith("/parent") ? "parent" : "student"
  }

  function consentCopy(locale, portal = "") {
    const portalKind = consentPortalKind(portal)
    const portalLabel = portalKind === "parent" ? "cổng phụ huynh" : "cổng học sinh"
    const settingsHref = portalKind === "parent" ? "/parent/settings" : "/student/settings"
    if (locale === "vi") {
      return {
        title: `Quyền riêng tư trên ${portalLabel} Eagles`,
        legalLead: `Để biết thêm thông tin về cách quản lý quyền riêng tư trên ${portalLabel}, vui lòng truy cập`,
        settingsLabel: "Cài đặt",
        privacyLabel: "chính sách quyền riêng tư",
        termsLabel: "các điều khoản và điều kiện",
        settingsHref,
        privacyHref: "https://eagles.edu.vn/lien-he/chinh-sach-bao-mat",
        termsHref: "https://eagles.edu.vn/lien-he/cac-dieu-khoan-va-dieu-kien",
        acceptAll: "Chấp nhận",
        rejectAll: "Từ chối",
        manage: "Quản lý cookie",
        saved: "Đã lưu lựa chọn quyền riêng tư.",
      };
    }
    return {
      title: `Privacy on the Eagles ${portalKind === "parent" ? "Parent" : "Student"} Portal`,
      legalLead: `For more information on managing your privacy on the Eagles ${portalKind === "parent" ? "Parent" : "Student"} Portal, visit`,
      settingsLabel: "Settings",
      privacyLabel: "privacy policy",
      termsLabel: "terms and conditions",
      settingsHref,
      privacyHref: "https://eagles.edu.vn/lien-he/chinh-sach-bao-mat",
      termsHref: "https://eagles.edu.vn/lien-he/cac-dieu-khoan-va-dieu-kien",
      acceptAll: "Accept",
      rejectAll: "Reject",
      manage: "Manage cookies",
      saved: "Your privacy choices were saved.",
    };
  }

  function removeConsentUi() {
    document.getElementById("sisConsentPanel")?.remove()
  }

  function renderConsentUi(locale, preferences = null, open = false, portal = "") {
    const copy = consentCopy(locale, portal)
    removeConsentUi()
    const panel = document.createElement("section")
    panel.id = "sisConsentPanel"
    panel.className = "sis-consent-panel"
    panel.hidden = !open
    panel.setAttribute("aria-label", copy.title)
    panel.innerHTML = `
      <div class="sis-consent-panel__content">
        <span class="sis-consent-panel__info" aria-hidden="true">i</span>
        <div class="sis-consent-panel__message">
          <p class="sis-consent-panel__links">${copy.legalLead} <a href="${copy.settingsHref}">${copy.settingsLabel}</a> ${locale === "vi" ? "để xem" : "to view our"} <a href="${copy.privacyHref}" target="_blank" rel="noreferrer">${copy.privacyLabel}</a> và <a href="${copy.termsHref}" target="_blank" rel="noreferrer">${copy.termsLabel}</a>.</p>
        </div>
        <div class="sis-consent-panel__actions">
          <button type="button" class="portal-button portal-button-privacy-shaded" data-sis-consent-action="accept-all">${copy.acceptAll}</button>
          <button type="button" class="portal-button portal-button-privacy-shaded" data-sis-consent-action="reject-all">${copy.rejectAll}</button>
          <button type="button" class="portal-button portal-button-privacy-shaded" data-sis-consent-action="manage">${copy.manage}</button>
        </div>
        <p class="sis-consent-panel__status" role="status" aria-live="polite"></p>
      </div>`
    document.body?.appendChild(panel)
    panel.addEventListener("click", (event) => {
      const action = event.target.closest("[data-sis-consent-action]")?.dataset.sisConsentAction
      if (!action) return
      if (action === "manage") {
        window.location.assign(copy.settingsHref)
        return
      }
      const next = action === "accept-all"
        ? { supportChat: "granted", analytics: "granted" }
        : action === "reject-all"
          ? { supportChat: "denied", analytics: "denied" }
          : { supportChat: "denied", analytics: "denied" }
      const savedPreferences = writeConsentPreferences(next.supportChat, next.analytics)
      applyConsentPreferences(savedPreferences)
      panel.hidden = true
      const status = panel.querySelector(".sis-consent-panel__status")
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

  function portalAuthState() {
    const dataset = document.documentElement?.dataset || {}
    return dataset.studentAuthState || dataset.parentAuthState || dataset.adminAuthState || ""
  }

  function portalIsAuthenticated() {
    const state = portalAuthState()
    if (state === "authenticated") return true
    if (state === "unauthenticated") return false
    const initialAuth = globalThis.__SIS_ADMIN_INITIAL_AUTH__
      || globalThis.__SIS_PARENT_INITIAL_AUTH__
      || globalThis.__SIS_STUDENT_INITIAL_AUTH__
      || globalThis.__SIS_SETTINGS_INITIAL_AUTH__
    return initialAuth?.authenticated === true
  }

  function initPrivacyConsent({ locale = "en", waitForAuthentication = false, portal = "" } = {}) {
    const normalizedLocale = locale === "vi" ? "vi" : "en"
    const normalizedPortal = consentPortalKind(portal)
    if (waitForAuthentication && !portalIsAuthenticated()) {
      globalThis.__SIS_PRIVACY_CONSENT_LOCALE__ = normalizedLocale
      globalThis.__SIS_PRIVACY_CONSENT_PORTAL__ = normalizedPortal
      return readConsentPreferences()
    }
    if (globalThis.__SIS_PRIVACY_CONSENT_INITIALIZED__) return readConsentPreferences()
    globalThis.__SIS_PRIVACY_CONSENT_INITIALIZED__ = true
    const preferences = readConsentPreferences()
    setConsentAttributes(preferences)
    const panel = renderConsentUi(normalizedLocale, preferences, !preferences, normalizedPortal)
    if (preferences) applyConsentPreferences(preferences)
    return preferences
  }

  function showPrivacyConsent({ locale, portal } = {}) {
    return initPrivacyConsent({
      locale: locale || globalThis.__SIS_PRIVACY_CONSENT_LOCALE__ || "en",
      portal: portal || globalThis.__SIS_PRIVACY_CONSENT_PORTAL__ || "",
    })
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
    showPrivacyConsent,
    applyConsentPreferences,
    setBrevoIdentity,
  }
})()
