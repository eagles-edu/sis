(() => {
  const normalizedPath = location.pathname.replace(/\/+$/u, "")
  const isManage = normalizedPath.endsWith("/library/manage")
  const isLibrary = normalizedPath.endsWith("/library")
  if (!isManage && !isLibrary) return

  const workspace = document.getElementById("libraryReviewWorkspace")
  const approvedEditor = document.getElementById("libraryApprovedEditor")
  if (!workspace && !approvedEditor) return

  const reviewDocsHtml = `<section class="library-review-docs" data-entry-review-docs aria-label="Entry review documents">
    <div class="section-head"><h3>Entry review documents</h3><p class="small">Use these project contracts while checking every Library entry and recording the review decision.</p></div>
    <div class="library-review-docs__grid">
      <article class="library-review-doc"><h4>Agent contract · AGENTS.md</h4><p>Keep the requested scope literal, reuse shared UI selectors, preserve authoritative data, rebuild generated assets, and verify the authenticated rendered route.</p></article>
      <article class="library-review-doc"><h4>SOP · docs/sop.md</h4><p>Use shared surfaces and tokens, keep dropdowns on the card surface, preserve canonical portal geometry, and test the complete served workflow after edits.</p></article>
      <article class="library-review-doc"><h4>History (HX) · docs/history.md</h4><p>Library is a protected reviewed corpus with visible provenance; student Library includes chat, while admin Library uses the shared chrome without chat.</p></article>
    </div>
  </section>`

  const ensureReviewDocs = (root) => {
    if (!root || root.querySelector("[data-entry-review-docs]")) return
    root.insertAdjacentHTML("beforeend", reviewDocsHtml)
  }

  const readValue = (input) => input.type === "checkbox" ? input.checked : input.value
  const textValue = (value) => String(value == null ? "" : value).trim()

  const mwEtymology = (data = {}) => {
    const direct = textValue(data.fields?.etymology)
    if (direct) return direct
    return (Array.isArray(data.details?.entries) ? data.details.entries : [])
      .flatMap((entry) => Array.isArray(entry?.etymology) ? entry.etymology : [])
      .map(textValue)
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join("\n")
  }

  const bindReviewSidebar = () => {
    const shell = document.querySelector("[data-review-shell]")
    const sidebar = shell?.querySelector("[data-review-sidebar]")
    const button = sidebar?.querySelector("[data-review-sidebar-toggle]")
    if (!shell || !sidebar || !button || button.dataset.collapseBound === "true") return
    button.dataset.collapseBound = "true"
    button.addEventListener("click", () => {
      const collapsed = shell.classList.toggle("is-sidebar-collapsed")
      sidebar.classList.toggle("is-collapsed", collapsed)
      button.setAttribute("aria-expanded", String(!collapsed))
      button.textContent = collapsed ? "Expand" : "Collapse"
    })
  }

  const markDifferences = () => {
    if (!workspace) return
    const versionA = workspace.querySelector('[data-review-pane="a"]')
    const versionB = workspace.querySelector('[data-review-pane="b"]')
    if (!versionA || !versionB) return

    const inputs = (pane) => [...pane.querySelectorAll("[data-review-field], [data-vocabulary-field], [data-vocabulary-esl-field], [data-vocabulary-origin-field]")]
    const key = (input) => input.dataset.reviewField || input.dataset.vocabularyField || input.dataset.vocabularyEslField || input.dataset.vocabularyOriginField
    const marker = (input) => input.closest(".library-review-field, .vocabulary-pos-control") || input
    const valuesB = new Map(inputs(versionB).map((input) => [key(input), readValue(input)]))
    inputs(versionA).forEach((input) => {
      marker(input).classList.toggle("is-different", readValue(input) !== valuesB.get(key(input)))
    })
    const valuesA = new Map(inputs(versionA).map((input) => [key(input), readValue(input)]))
    inputs(versionB).forEach((input) => {
      marker(input).classList.toggle("is-different", readValue(input) !== valuesA.get(key(input)))
    })
  }

  const readPayload = (pane) => {
    const payload = {}
    pane.querySelectorAll("[data-review-field], [data-approved-field], [data-vocabulary-field], [data-vocabulary-esl-field], [data-vocabulary-origin-field]").forEach((input) => {
      const sourceField = input.dataset.reviewField || input.dataset.approvedField || input.dataset.vocabularyField || input.dataset.vocabularyEslField
      if (!sourceField) return
      const field = window.SIS_VOCABULARY_ESL?.grammarFields.includes(sourceField) ? `grammarClassification.${sourceField}` : sourceField
      const parts = field.split(".")
      const last = parts.pop()
      let target = payload
      parts.forEach((part) => { target[part] ||= {}; target = target[part] })
      let value = readValue(input)
      if (field === "originReferences") { try { value = JSON.parse(value || "[]") } catch { value = [] } }
      target[last] = value
    })
    return payload
  }

  const bindMwFill = () => {
    document.querySelectorAll("[data-vocabulary-mw-preview]").forEach((button) => {
      if (button.dataset.mwBound === "true") return
      button.dataset.mwBound = "true"
      button.addEventListener("click", async () => {
        const pane = button.closest("[data-review-pane], [data-vocabulary-editor]")
        const sourceId = pane?.dataset.reviewSourceId || pane?.dataset.approvedEntryId
        const message = pane?.querySelector("[data-vocabulary-mw-message]")
        const details = pane?.querySelector("[data-vocabulary-mw-details]")
        const detailsJson = pane?.querySelector("[data-vocabulary-mw-json]")
        if (!pane || !sourceId) return
        const originalLabel = button.textContent
        button.disabled = true
        button.textContent = "MW…"
        try {
          const response = await fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/mw-preview`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: readPayload(pane) }) })
          const data = await response.json()
          if (!response.ok || !data.ok) throw new Error(data.message || "Merriam-Webster is unavailable; no Library data was changed.")
          const current = readPayload(pane)
          const mergedReferences = [...new Map([...(Array.isArray(current.originReferences) ? current.originReferences : []), ...(Array.isArray(data.fields?.originReferences) ? data.fields.originReferences : [])].filter((item) => item?.url).map((item) => [item.url, item])).values()]
          const etymology = mwEtymology(data)
          const nonEmptyMwFields = Object.fromEntries(Object.entries(data.fields || {}).filter(([field, value]) => field !== "originReferences" && value !== null && value !== undefined && (typeof value !== "string" || value.trim())))
          const merged = { ...current, ...nonEmptyMwFields, ...(etymology ? { etymology } : {}), originPath: current.originPath || data.fields?.originPath || "", originReferences: mergedReferences }
          window.SIS_VOCABULARY_ESL?.hydrate(pane, merged, { preserveSyllabication: true })
          const appliedFields = Object.keys(data.fields || {}).join(", ") || "none"
          button.title = `Filled authoritative Merriam-Webster fields: ${appliedFields}.`
          if (message) message.textContent = `Filled authoritative MW fields: ${appliedFields}.`
          if (detailsJson) detailsJson.textContent = JSON.stringify(data.details || {}, null, 2)
          if (details) details.hidden = false
        } catch (error) {
          button.title = error.message
          if (message) message.textContent = error.message
        } finally {
          button.disabled = false
          button.textContent = originalLabel
        }
      })
    })
  }

  bindReviewSidebar()

  const showMwPreview = (data) => {
    let dialog = document.getElementById("libraryMwPreviewDialog")
    if (!dialog) {
      dialog = document.createElement("dialog")
      dialog.id = "libraryMwPreviewDialog"
      dialog.className = "portal-modal"
      dialog.innerHTML = `<form method="dialog"><div class="portal-modal-header"><h2>Merriam-Webster complete data</h2><button type="submit" class="portal-button portal-button-alt" aria-label="Close Merriam-Webster data">Close</button></div><pre class="library-mw-preview-json"></pre></form>`
      document.body.append(dialog)
    }
    dialog.querySelector(".library-mw-preview-json").textContent = JSON.stringify(data.details || {}, null, 2)
    if (typeof dialog.showModal === "function") dialog.showModal()
    else dialog.setAttribute("open", "")
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-mw-preview]")
    if (!button) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const entryId = button.dataset.mwPreview
    if (!entryId) return
    button.disabled = true
    const originalLabel = button.textContent
    button.textContent = "MW…"
    try {
      const response = await fetch(`/api/admin/library/entries/${encodeURIComponent(entryId)}/mw-preview`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.message || "Merriam-Webster is unavailable; no Library data was changed.")
      showMwPreview(data)
    } catch (error) {
      window.alert(error.message || "Merriam-Webster data is unavailable.")
    } finally {
      button.disabled = false
      button.textContent = originalLabel
    }
  }, true)

  const transitivityPayload = (pane) => Object.fromEntries(
    ["verbTransitivity", "verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5"]
      .map((field) => [field, pane.querySelector(`[data-vocabulary-esl-field="${field}"]`)?.value || ""]),
  )

  const bindTransitivityTools = () => {
    const apiRoot = `${window.__SIS_ADMIN_API_PREFIX || "/api/admin"}/library`
    document.querySelectorAll("[data-vocabulary-transitivity-check], [data-vocabulary-transitivity-autofill]").forEach((button) => {
      if (button.dataset.transitivityBound === "true") return
      button.dataset.transitivityBound = "true"
      button.addEventListener("click", async () => {
        const pane = button.closest("[data-review-pane], [data-vocabulary-editor], [data-news-vocabulary-row]")
        const message = pane?.querySelector("[data-vocabulary-transitivity-message]")
        if (!pane || !message) return
        const autofill = button.matches("[data-vocabulary-transitivity-autofill]")
        const originalLabel = button.textContent
        button.disabled = true
        button.textContent = autofill ? "Filling…" : "Checking…"
        try {
          const response = await fetch(`${apiRoot}/${autofill ? "transitivity-autofill" : "transitivity-check"}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(transitivityPayload(pane)) })
          const data = await response.json()
          if (!response.ok || data.ok === false) throw new Error(data.error || "Transitivity verification is unavailable; saving remains allowed.")
          if (autofill) {
            const input = pane.querySelector('[data-vocabulary-esl-field="verbTransitivity"]')
            if (data.suggestedVerbTransitivity && input) {
              input.value = data.suggestedVerbTransitivity
              input.dispatchEvent(new Event("change", { bubbles: true }))
              message.textContent = data.autofillMessage || `Suggested ${data.suggestedVerbTransitivity}; review it before saving.`
            } else message.textContent = data.autofillMessage || "No bundled classification was found; saving remains allowed."
          } else if (!data.foundForms?.length) message.textContent = "No bundled corpus match; transitivity is optional and saving remains allowed."
          else if (data.matchesExpected === true) message.textContent = `Bundled corpus supports ${data.expected} for ${data.foundForms.join(", ")}. Saving remains allowed.`
          else if (data.matchesExpected === false) message.textContent = `Bundled corpus differs from ${data.expected}; this is advisory and saving remains allowed.`
          else message.textContent = `Bundled corpus checked ${data.foundForms.length} form(s); transitivity is optional and saving remains allowed.`
        } catch (error) {
          message.textContent = error.message || "Transitivity verification is unavailable; saving remains allowed."
        } finally {
          button.disabled = false
          button.textContent = originalLabel
        }
      })
    })
  }

  workspace?.addEventListener("input", markDifferences)
  workspace?.addEventListener("change", markDifferences)
  if (workspace) new MutationObserver(() => { ensureReviewDocs(workspace); markDifferences(); bindMwFill(); bindTransitivityTools(); bindReviewSidebar() }).observe(workspace, { childList: true, subtree: true })
  if (approvedEditor) new MutationObserver(() => { ensureReviewDocs(approvedEditor); bindMwFill(); bindTransitivityTools() }).observe(approvedEditor, { childList: true, subtree: true })
  ensureReviewDocs(workspace)
  ensureReviewDocs(approvedEditor)
  bindMwFill()
  bindTransitivityTools()
  bindReviewSidebar()
})()
