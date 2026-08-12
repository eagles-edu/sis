(() => {
  const isManage = location.pathname.endsWith("library-manage.html")
  const isLibrary = location.pathname.endsWith("library-admin.html")
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

  const markDifferences = () => {
    if (!workspace) return
    const versionA = workspace.querySelector('[data-review-pane="a"]')
    const versionB = workspace.querySelector('[data-review-pane="b"]')
    if (!versionA || !versionB) return

    const valuesB = new Map([...versionB.querySelectorAll("[data-review-field]")].map((input) => [input.dataset.reviewField, readValue(input)]))
    versionA.querySelectorAll("[data-review-field]").forEach((input) => {
      input.closest(".library-review-field")?.classList.toggle("is-different", readValue(input) !== valuesB.get(input.dataset.reviewField))
    })
    const valuesA = new Map([...versionA.querySelectorAll("[data-review-field]")].map((input) => [input.dataset.reviewField, readValue(input)]))
    versionB.querySelectorAll("[data-review-field]").forEach((input) => {
      input.closest(".library-review-field")?.classList.toggle("is-different", readValue(input) !== valuesA.get(input.dataset.reviewField))
    })
  }

  const readPayload = (pane) => {
    const payload = {}
    pane.querySelectorAll("[data-review-field], [data-approved-field], [data-vocabulary-esl-field]").forEach((input) => {
      const sourceField = input.dataset.reviewField || input.dataset.approvedField || input.dataset.vocabularyEslField
      if (!sourceField) return
      const field = window.SIS_VOCABULARY_ESL?.grammarFields.includes(sourceField) ? `grammarClassification.${sourceField}` : sourceField
      const parts = field.split(".")
      const last = parts.pop()
      let target = payload
      parts.forEach((part) => { target[part] ||= {}; target = target[part] })
      target[last] = readValue(input)
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
        if (!pane || !sourceId) return
        const originalLabel = button.textContent
        button.disabled = true
        button.textContent = "MW…"
        try {
          const response = await fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/mw-preview`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: readPayload(pane) }) })
          const data = await response.json()
          if (!response.ok || !data.ok) throw new Error(data.message || "Merriam-Webster is unavailable; no Library data was changed.")
          window.SIS_VOCABULARY_ESL?.hydrate(pane, { ...readPayload(pane), ...data.fields })
          button.title = `Filled authoritative Merriam-Webster fields: ${Object.keys(data.fields || {}).join(", ") || "none"}.`
        } catch (error) {
          button.title = error.message
        } finally {
          button.disabled = false
          button.textContent = originalLabel
        }
      })
    })
  }

  workspace?.addEventListener("input", markDifferences)
  workspace?.addEventListener("change", markDifferences)
  if (workspace) new MutationObserver(() => { ensureReviewDocs(workspace); markDifferences(); bindMwFill() }).observe(workspace, { childList: true, subtree: true })
  if (approvedEditor) new MutationObserver(() => { ensureReviewDocs(approvedEditor); bindMwFill() }).observe(approvedEditor, { childList: true, subtree: true })
  ensureReviewDocs(workspace)
  ensureReviewDocs(approvedEditor)
  bindMwFill()
})()
