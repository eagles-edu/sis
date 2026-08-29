(() => {
  if (!location.pathname.replace(/\/+$/u, "").endsWith("/library/references")) return

  const root = `${window.__SIS_ADMIN_API_PREFIX || "/api/admin"}/library/reference-catalogs`
  const catalogSelect = document.getElementById("libraryReferenceCatalog")
  const searchInput = document.getElementById("libraryReferenceSearch")
  const subtypeInput = document.getElementById("libraryReferenceSubtype")
  const sortSelect = document.getElementById("libraryReferenceSort")
  const directionSelect = document.getElementById("libraryReferenceDirection")
  const pageSizeSelect = document.getElementById("libraryReferencePageSize")
  const facetFilters = document.getElementById("libraryReferenceFacetFilters")
  const status = document.getElementById("libraryReferenceStatus")
  const rows = document.getElementById("libraryReferenceRows")
  const pagination = document.getElementById("libraryReferencePagination")
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]))
  const label = (value) => String(value).replace(/([A-Z])/gu, " $1").replace(/_/gu, " ").replace(/^./u, (character) => character.toUpperCase())
  let catalogMap = new Map()
  let page = 1
  let lastData = null
  let rendering = false

  const visibleColumns = (catalog) => (catalog?.columns || []).filter((column) => !column.toLowerCase().startsWith("source"))
  const valueFor = (item, column) => column === "term" ? item.term : column === "partOfSpeech" ? item.partOfSpeech : column === "subtype" ? item.subtype : item.dataJson?.[column]

  function renderSortOptions(catalog) {
    sortSelect.innerHTML = visibleColumns(catalog).map((column) => `<option value="${esc(column)}">${esc(label(column))}</option>`).join("")
    sortSelect.value = visibleColumns(catalog).includes("term") ? "term" : visibleColumns(catalog)[0]
  }

  function renderFacetOptions(catalog, facets = {}) {
    const selected = new Map([...facetFilters.querySelectorAll("[data-reference-filter]")].map((select) => [select.dataset.referenceFilter, select.value]))
    const candidates = ["partOfSpeech", "subtype", "familyId", "sublist", "regularity", "headwordPartOfSpeech", "memberPartOfSpeech"]
    facetFilters.innerHTML = candidates.filter((column) => (facets[column] || []).length > 1 && (catalog.columns || []).includes(column)).map((column) => `<label>${esc(label(column))}<select data-reference-filter="${esc(column)}"><option value="">All</option>${facets[column].map((value) => `<option value="${esc(value)}"${selected.get(column) === value ? " selected" : ""}>${esc(value)}</option>`).join("")}</select></label>`).join("")
  }

  function renderTable(data) {
    rendering = true
    const columns = visibleColumns(data.catalog)
    const header = columns.map((column) => `<th scope="col" data-column="${esc(column)}">${esc(label(column))}</th>`).join("")
    const body = (data.items || []).map((item) => `<tr>${columns.map((column) => `<td data-column="${esc(column)}" data-label="${esc(label(column))}">${esc(valueFor(item, column) || "-")}</td>`).join("")}</tr>`).join("")
    rows.innerHTML = `<div class="library-reference-table-meta"><span>${esc(data.catalog.label)}</span><span>${data.total} matching record(s)</span></div><table class="admin-data-table library-reference-table"><thead><tr>${header}</tr></thead><tbody>${body || `<tr><td colspan="${Math.max(1, columns.length)}">No records match.</td></tr>`}</tbody></table>`
    rendering = false
  }

  function renderPagination(data) {
    const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize))
    pagination.hidden = pageCount <= 1
    if (pagination.hidden) return
    pagination.innerHTML = `<button type="button" class="portal-button portal-button-neutral-action" data-reference-page="${Math.max(1, page - 1)}"${page === 1 ? " disabled" : ""}>Previous</button><span aria-live="polite">Page ${page} of ${pageCount} · ${data.total} records</span><button type="button" class="portal-button portal-button-neutral-action" data-reference-page="${Math.min(pageCount, page + 1)}"${page === pageCount ? " disabled" : ""}>Next</button>`
  }

  async function load() {
    const query = new URLSearchParams({ page: String(page), pageSize: pageSizeSelect.value, search: searchInput.value, subtype: subtypeInput.value, sortBy: sortSelect.value, direction: directionSelect.value })
    facetFilters.querySelectorAll("[data-reference-filter]").forEach((select) => { if (select.value) query.set(`filter_${select.dataset.referenceFilter}`, select.value) })
    const response = await fetch(`${root}/${encodeURIComponent(catalogSelect.value)}?${query}`, { credentials: "include" })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || "Unable to load reference list.")
    lastData = data
    renderFacetOptions(data.catalog, data.facets)
    status.textContent = `${data.total} ${data.catalog.label} record(s)`
    renderTable(data)
    renderPagination(data)
  }

  async function initialize() {
    const response = await fetch(root, { credentials: "include" })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || "Unable to load catalogs.")
    catalogMap = new Map(data.items.map((item) => [item.key, item]))
    catalogSelect.innerHTML = data.items.map((item) => `<option value="${esc(item.key)}">${esc(item.label)}</option>`).join("")
    renderSortOptions(data.items[0])
    await load()
  }

  document.getElementById("libraryReferenceFilters")?.addEventListener("submit", (event) => { event.preventDefault(); page = 1; load().catch((error) => { status.textContent = error.message }) })
  catalogSelect?.addEventListener("change", () => { page = 1; renderSortOptions(catalogMap.get(catalogSelect.value)); load().catch((error) => { status.textContent = error.message }) })
  sortSelect?.addEventListener("change", () => { page = 1; load().catch((error) => { status.textContent = error.message }) })
  directionSelect?.addEventListener("change", () => { page = 1; load().catch((error) => { status.textContent = error.message }) })
  pageSizeSelect?.addEventListener("change", () => { page = 1; load().catch((error) => { status.textContent = error.message }) })
  facetFilters?.addEventListener("change", () => { page = 1; load().catch((error) => { status.textContent = error.message }) })
  pagination?.addEventListener("click", (event) => { const button = event.target.closest("[data-reference-page]"); if (!button || button.disabled) return; page = Number(button.dataset.referencePage); load().catch((error) => { status.textContent = error.message }) })
  new MutationObserver(() => { if (!rendering && lastData && !rows.querySelector(".library-reference-table")) renderTable(lastData) }).observe(rows, { childList: true })
  initialize().catch((error) => { status.textContent = error.message })
})()
