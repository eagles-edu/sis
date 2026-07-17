(() => {
  const normalizeOrigin = (value) => {
    try { return new URL(String(value || ""), window.location.origin).origin } catch { return "" }
  }
  const resolveOrigin = () => normalizeOrigin(new URLSearchParams(window.location.search).get("apiOrigin")) || window.location.origin
  const resolveLabel = (origin) => {
    const url = new URL(origin)
    const label = url.port === "8788" || url.hostname === "127.0.0.1" || url.hostname === "localhost"
      ? "DEV" : url.port === "8786" || url.hostname.startsWith("test.") ? "TEST" : "LIVE"
    return { label, value: `${label} • ${origin}` }
  }
  const sync = () => {
    const { label, value } = resolveLabel(resolveOrigin())
    document.querySelectorAll("[data-environment-prefooter]").forEach((target) => {
      target.dataset.env = label === "DEV" ? "development" : label === "LIVE" ? "production" : "test"
      if (!target.textContent?.trim()) target.textContent = value
    })
  }
  sync()
  document.querySelectorAll("[data-environment-prefooter]").forEach((target) => {
    new MutationObserver(sync).observe(target, { childList: true, characterData: true, subtree: true })
  })
})()
