(() => {
  const theme = globalThis.SIS_PORTAL_THEME
  if (!theme) return

  const locale = globalThis.__SIS_SETTINGS_LOCALE === "vi" ? "vi" : "en"
  const settingsHomePath = globalThis.__SIS_SETTINGS_HOME_PATH || "/student"
  const portalKind = settingsHomePath.startsWith("/parent") ? "parent" : "student"
  const portalLabel = portalKind === "parent" ? (locale === "vi" ? "cổng phụ huynh" : "parent portal") : (locale === "vi" ? "cổng học sinh" : "student portal")
  const privacySettingsHref = portalKind === "parent" ? "/parent/settings" : "/student/settings"
  const copy = locale === "vi"
    ? {
        brand: "CÂU LẠC BỘ THE EAGLES",
        settings: "Cài đặt",
        description: "Quản lý quyền riêng tư và tùy chọn giao diện của bạn.",
        privacy: "Quyền riêng tư",
        optional: "Dịch vụ tùy chọn",
        privacyDescription: "Chọn các dịch vụ tùy chọn được phép hoạt động trên cổng thông tin này.",
        privacyLinks: `Để biết thêm thông tin về cách quản lý quyền riêng tư trên ${portalLabel}, hãy xem <a href="${privacySettingsHref}">Cài đặt</a>, <a href="https://eagles.edu.vn/lien-he/chinh-sach-bao-mat" target="_blank" rel="noreferrer">chính sách quyền riêng tư</a> và <a href="https://eagles.edu.vn/lien-he/cac-dieu-khoan-va-dieu-kien" target="_blank" rel="noreferrer">các điều khoản và điều kiện</a>.`,
        essential: "Hoạt động thiết yếu của cổng thông tin",
        essentialDescription: "Cần thiết cho đăng nhập, bảo mật và hoạt động cơ bản của cổng thông tin. Luôn hoạt động.",
        essentialStatus: "Luôn hoạt động",
        chat: "Hỗ trợ trò chuyện",
        chatDescription: "Nhận hỗ trợ từ đội ngũ Eagles Club.",
        analytics: "Phân tích ẩn danh",
        analyticsDescription: "Giúp chúng tôi cải thiện cổng thông tin.",
        save: "Lưu thay đổi",
        necessary: "Chỉ cần thiết",
        future: "Cài đặt khác",
        futureDescription: "Bạn có thể bổ sung các tùy chọn khác tại đây sau này.",
        back: "Quay lại",
        homeAria: "Về cổng phụ huynh",
        saved: "Đã lưu cài đặt quyền riêng tư.",
        savedLocal: "Đã lưu trên thiết bị; chưa đồng bộ được với tài khoản.",
        themeDark: "Chuyển sang giao diện tối",
        themeLight: "Chuyển sang giao diện sáng",
        themeTitle: "Tùy chọn giao diện",
        themeDescription: "Chọn giao diện phù hợp nhất với bạn.",
        darkMode: "Giao diện tối",
        darkModeDescription: "Sử dụng bảng màu tối hơn trên toàn bộ cổng thông tin.",
        on: "BẬT",
        off: "TẮT",
      }
    : {
        brand: "THE EAGLES CLUB",
        settings: "Settings",
        description: "Manage your privacy and theme preferences in one place.",
        privacy: "Privacy",
        optional: "Optional services",
        privacyDescription: "Choose which optional services are allowed on this portal.",
        privacyLinks: `Manage privacy choices for this ${portalLabel} in <a href="${privacySettingsHref}">Settings</a>. Read our <a href="https://eagles.edu.vn/lien-he/chinh-sach-bao-mat" target="_blank" rel="noreferrer">privacy policy</a> and <a href="https://eagles.edu.vn/lien-he/cac-dieu-khoan-va-dieu-kien" target="_blank" rel="noreferrer">terms and conditions</a>.`,
        essential: "Essential portal operation",
        essentialDescription: "Required for sign-in, security, and basic portal operation. Always active.",
        essentialStatus: "Always active",
        chat: "Support chat",
        chatDescription: "Get help from the Eagles Club team.",
        analytics: "Anonymous analytics",
        analyticsDescription: "Help us improve the portal.",
        save: "Save changes",
        necessary: "Only necessary",
        future: "More settings",
        futureDescription: "Additional portal settings can be added here later.",
        back: "Back",
        homeAria: "Go to student home",
        saved: "Privacy settings saved.",
        savedLocal: "Saved on this device; account sync is unavailable.",
        themeDark: "Switch to dark mode",
        themeLight: "Switch to light mode",
        themeTitle: "Theme preferences",
        themeDescription: "Choose the appearance that works best for you.",
        darkMode: "Dark mode",
        darkModeDescription: "Use a darker color palette across the portal.",
        on: "ON",
        off: "OFF",
      }

  const initialize = async () => {
    const preferenceStore = globalThis.SIS_PORTAL_PREFERENCES
    await preferenceStore?.load?.()
    await preferenceStore?.migrate?.()

  const text = (selector, value) => {
    const node = document.querySelector(selector)
    if (node) node.textContent = value
  }

  text("[data-settings-brand-title]", copy.brand)
  text("[data-settings-kicker]", copy.settings)
  text("[data-settings-title]", copy.settings)
  text("[data-settings-description]", copy.description)
  text("[data-privacy-title]", copy.privacy)
  text("[data-optional-label]", copy.optional)
  text("[data-privacy-description]", copy.privacyDescription)
  const privacyLinks = document.querySelector("[data-privacy-links]")
  if (privacyLinks) privacyLinks.innerHTML = copy.privacyLinks
  text("[data-essential-title]", copy.essential)
  text("[data-essential-description]", copy.essentialDescription)
  text("[data-essential-status]", copy.essentialStatus)
  text("[data-chat-title]", copy.chat)
  text("[data-chat-description]", copy.chatDescription)
  text("[data-analytics-title]", copy.analytics)
  text("[data-analytics-description]", copy.analyticsDescription)
  text("[data-save-settings]", copy.save)
  text("[data-save-necessary]", copy.necessary)
  text("[data-future-title]", copy.future)
  text("[data-future-description]", copy.futureDescription)
  text("[data-theme-title]", copy.themeTitle)
  text("[data-theme-description]", copy.themeDescription)
  text("[data-dark-mode-title]", copy.darkMode)
  text("[data-dark-mode-description]", copy.darkModeDescription)
  text("[data-essential-status]", copy.on)
  text("[data-back-top]", locale === "vi" ? "Về đầu trang" : "Back to top")

  document.querySelectorAll("[data-settings-home-link]").forEach((link) => {
    link.setAttribute("href", globalThis.__SIS_SETTINGS_HOME_PATH || "/")
    link.setAttribute("aria-label", copy.homeAria)
  })
  text(".portal-button[data-settings-home-link]", copy.back)
  document.documentElement.lang = locale === "vi" ? "vi" : "en"
  document.title = copy.settings

  const textZoomKey = `sis.${portalKind}Portal.textZoomPct`
  const textZoomDefault = 100
  const textZoomMin = 80
  const textZoomMax = 140
  const textZoomStep = 5
  const clampTextZoom = (value) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return textZoomDefault
    return Math.min(textZoomMax, Math.max(textZoomMin, Math.round(parsed)))
  }
  let currentTextZoom = textZoomDefault
  const applyTextZoom = (value) => {
    const next = clampTextZoom(value)
    currentTextZoom = next
    document.documentElement.style.setProperty("--portal-text-zoom", String(next / 100))
    void preferenceStore?.save?.(textZoomKey, String(next))
  }
  const storedTextZoom = preferenceStore?.get?.(textZoomKey, textZoomDefault)
  applyTextZoom(storedTextZoom)
  document.getElementById("studentTextZoomDownBtn")?.addEventListener("click", () => {
    applyTextZoom(currentTextZoom - textZoomStep)
  })
  document.getElementById("studentTextZoomUpBtn")?.addEventListener("click", () => {
    applyTextZoom(currentTextZoom + textZoomStep)
  })
  document.getElementById("studentTextZoomResetBtn")?.addEventListener("click", () => {
    applyTextZoom(textZoomDefault)
  })
  document.getElementById("menuBtn")?.addEventListener("click", () => {
    window.location.assign(settingsHomePath)
  })

  const themeButton = document.getElementById("settingsThemeToggle")
  const themeIcon = document.getElementById("settingsThemeToggleIcon")
  const themePreference = document.querySelector("[data-theme-preference]")
  const themeStatus = document.querySelector('[data-switch-state="theme"]')
  const syncSwitchState = (input, status, isOn) => {
    if (!input || !status) return
    const on = Boolean(isOn)
    input.checked = on
    status.textContent = on ? copy.on : copy.off
    status.classList.toggle("settings-switch-state--on", on)
    status.classList.toggle("settings-switch-state--off", !on)
    input.closest(".settings-option")?.classList.toggle("settings-option--on", on)
  }
  const syncThemeToggle = (nextTheme) => {
    const isDark = nextTheme === "dark"
    themeButton?.setAttribute("aria-pressed", String(isDark))
    themeButton?.setAttribute("aria-label", isDark ? copy.themeLight : copy.themeDark)
    themeButton?.setAttribute("title", isDark ? copy.themeLight : copy.themeDark)
    if (themeIcon) themeIcon.setAttribute("name", isDark ? "theme-sun" : "theme-moon")
    syncSwitchState(themePreference, themeStatus, isDark)
  }
  syncThemeToggle(theme.getTheme("light"))
  globalThis.addEventListener?.("sis-theme-change", (event) => syncThemeToggle(event.detail?.theme))
  themeButton?.addEventListener("click", () => theme.toggleTheme("light"))
  themePreference?.addEventListener("change", () => theme.setTheme(themePreference.checked ? "dark" : "light"))

  const remotePreferences = preferenceStore?.get?.(theme.CONSENT_STORAGE_KEY)
  const preferences = remotePreferences?.version === theme.CONSENT_VERSION &&
      (remotePreferences.supportChat === "granted" || remotePreferences.supportChat === "denied") &&
      (remotePreferences.analytics === "granted" || remotePreferences.analytics === "denied")
    ? remotePreferences
    : theme.readConsentPreferences?.() || {
    supportChat: "denied",
    analytics: "denied",
  }
  if (remotePreferences?.version === theme.CONSENT_VERSION) {
    const localPreferences = theme.writeConsentPreferences(preferences.supportChat, preferences.analytics)
    theme.applyConsentPreferences(localPreferences)
  }
  const supportChat = document.querySelector('[data-settings-consent="supportChat"]')
  const analytics = document.querySelector('[data-settings-consent="analytics"]')
  const supportChatStatus = document.querySelector('[data-switch-state="supportChat"]')
  const analyticsStatus = document.querySelector('[data-switch-state="analytics"]')
  const status = document.querySelector("[data-settings-status]")
  const syncConsentSwitches = () => {
    syncSwitchState(supportChat, supportChatStatus, supportChat?.checked)
    syncSwitchState(analytics, analyticsStatus, analytics?.checked)
  }
  if (supportChat) supportChat.checked = preferences.supportChat === "granted"
  if (analytics) analytics.checked = preferences.analytics === "granted"
  syncConsentSwitches()
  supportChat?.addEventListener("change", syncConsentSwitches)
  analytics?.addEventListener("change", syncConsentSwitches)

  async function saveSettings(supportChatValue, analyticsValue) {
    const saved = theme.writeConsentPreferences(supportChatValue, analyticsValue)
    theme.applyConsentPreferences(saved)
    const remoteSaved = await preferenceStore?.save?.(theme.CONSENT_STORAGE_KEY, saved)
    if (status) status.textContent = remoteSaved === false ? copy.savedLocal : copy.saved
  }

  document.getElementById("settingsPrivacyForm")?.addEventListener("submit", (event) => {
    event.preventDefault()
    void saveSettings(supportChat?.checked ? "granted" : "denied", analytics?.checked ? "granted" : "denied")
  })
  document.querySelector("[data-save-necessary]")?.addEventListener("click", () => {
    if (supportChat) supportChat.checked = false
    if (analytics) analytics.checked = false
    syncConsentSwitches()
    void saveSettings("denied", "denied")
  })
  }

  void initialize()
})()
