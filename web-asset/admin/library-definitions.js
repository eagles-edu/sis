(() => {
  const api = "/api/admin/library/definitions"
  const status = document.querySelector("#definitionsStatus")
  const sourceFilter = document.querySelector("#definitionsSource")
  const posFilter = document.querySelector("#definitionsPos")
  const matrixBody = document.querySelector("#definitionsMatrixRows")
  const providerControls = document.querySelector("#definitionsProviderControls")
  let matrix = null
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character])
  const request = async (url, options = {}) => {
    const response = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options })
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Request failed (${response.status})`)
    return response.json()
  }
  const selectedRows = () => (matrix?.rows || []).filter((row) => (!sourceFilter.value || row.provider === sourceFilter.value) && (!posFilter.value || row.partOfSpeech === posFilter.value))
  const render = () => {
    if (!matrix) return
    const sourceValue = sourceFilter.value; const posValue = posFilter.value
    sourceFilter.innerHTML = `<option value="">All sources</option>${matrix.sources.map((source) => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.label)}</option>`).join("")}`
    posFilter.innerHTML = `<option value="">All POS</option>${matrix.partOfSpeech.map((partOfSpeech) => `<option value="${escapeHtml(partOfSpeech)}">${escapeHtml(partOfSpeech)}</option>`).join("")}`
    sourceFilter.value = sourceValue; posFilter.value = posValue
    const rows = selectedRows()
    matrixBody.innerHTML = rows.map((row) => `<tr data-provider="${escapeHtml(row.provider)}" data-pos="${escapeHtml(row.partOfSpeech)}" data-datum="${escapeHtml(row.datum)}"><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.partOfSpeech)}</td><td>${escapeHtml(row.datum)}</td><td class="definitions-score">${row.score.toFixed(2)}</td><td>${row.quality.toFixed(2)}</td><td>${row.availability.toFixed(2)}</td><td>${row.acceptance.toFixed(2)}</td><td>${row.coverage.toFixed(2)}</td><td>${row.attempts}</td><td><input type="checkbox" data-datum-setting="enabled" ${row.enabled ? "checked" : ""} ${row.supported ? "" : "disabled"}></td><td><input type="number" min="0.5" max="1" step="0.01" data-datum-setting="qualityOverride" value="${row.qualityOverride ?? ""}" ${row.supported ? "" : "disabled"}></td></tr>`).join("") || "<tr><td colspan=\"11\">No matching scoring rows.</td></tr>"
    const settings = new Map((matrix.providerSettings || []).map((item) => [item.provider, item]))
    providerControls.innerHTML = matrix.sources.map((source) => {
      const setting = settings.get(source.id) || { enabled: true, timeoutMs: 8000, maxConcurrentRequests: 2, maxRequestsPerMinute: 30 }
      return `<section class="card definitions-provider-card" data-provider="${escapeHtml(source.id)}"><h3>${escapeHtml(source.label)}</h3><label><span>Enabled</span><input type="checkbox" data-setting="enabled" ${setting.enabled ? "checked" : ""}></label><label><span>Timeout (ms)</span><input type="number" min="500" max="60000" data-setting="timeoutMs" value="${setting.timeoutMs}"></label><label><span>Concurrency</span><input type="number" min="1" max="20" data-setting="maxConcurrentRequests" value="${setting.maxConcurrentRequests}"></label><label><span>Requests/minute</span><input type="number" min="1" max="600" data-setting="maxRequestsPerMinute" value="${setting.maxRequestsPerMinute}"></label></section>`
    }).join("")
  }
  const load = async () => { status.textContent = "Loading current Dictionary Builder scoring…"; matrix = await request(`${api}/matrix`); render(); status.textContent = "Current score matrix loaded." }
  document.querySelector("#definitionsRefresh").addEventListener("click", () => load().catch((error) => { status.textContent = error.message }))
  document.querySelector("#definitionsExport").addEventListener("click", () => { location.assign(`${api}/matrix.xlsx`) })
  document.querySelector("#definitionsSave").addEventListener("click", async () => {
    const providers = [...providerControls.querySelectorAll("[data-provider]")].map((card) => ({ provider: card.dataset.provider, enabled: card.querySelector('[data-setting="enabled"]').checked, timeoutMs: Number(card.querySelector('[data-setting="timeoutMs"]').value), maxConcurrentRequests: Number(card.querySelector('[data-setting="maxConcurrentRequests"]').value), maxRequestsPerMinute: Number(card.querySelector('[data-setting="maxRequestsPerMinute"]').value) }))
    const datums = [...matrixBody.querySelectorAll("tr[data-provider]")].map((row) => ({ provider: row.dataset.provider, partOfSpeech: row.dataset.pos, datum: row.dataset.datum, enabled: row.querySelector('[data-datum-setting="enabled"]')?.checked, qualityOverride: row.querySelector('[data-datum-setting="qualityOverride"]')?.value || null }))
    try { status.textContent = "Saving provider controls…"; matrix = await request(`${api}/settings`, { method: "PUT", body: JSON.stringify({ providers, datums }) }); render(); status.textContent = "Provider controls saved." } catch (error) { status.textContent = error.message }
  })
  const themeButton = document.querySelector("#adminThemeToggle")
  const themeIcon = document.querySelector("#adminThemeToggleIcon")
  const syncTheme = (theme) => {
    const dark = theme === "dark"
    themeButton?.setAttribute("aria-pressed", String(dark))
    themeButton?.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme")
    themeIcon?.setAttribute("name", dark ? "theme-sun" : "theme-moon")
  }
  window.addEventListener("sis-theme-change", (event) => syncTheme(event.detail?.theme || document.documentElement.dataset.theme))
  themeButton?.addEventListener("click", () => syncTheme(window.SIS_PORTAL_THEME?.toggleTheme?.("light") || "light"))
  syncTheme(window.SIS_PORTAL_THEME?.getTheme?.("light") || "light")
  const zoom = (delta) => {
    const current = Number.parseInt(document.documentElement.dataset.portalTextZoom || "100", 10) || 100
    document.documentElement.dataset.portalTextZoom = String(Math.max(85, Math.min(130, current + delta)))
    document.documentElement.style.fontSize = `${document.documentElement.dataset.portalTextZoom}%`
  }
  document.getElementById("adminTextZoomDownBtn")?.addEventListener("click", () => zoom(-5))
  document.getElementById("adminTextZoomUpBtn")?.addEventListener("click", () => zoom(5))
  document.getElementById("adminTextZoomResetBtn")?.addEventListener("click", () => { document.documentElement.dataset.portalTextZoom = "100"; document.documentElement.style.fontSize = "" })
  sourceFilter.addEventListener("change", render); posFilter.addEventListener("change", render)
  load().catch((error) => { status.textContent = error.message })
})()
