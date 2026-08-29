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
  const SPEAKER_ICON_PATHS = Object.freeze({
    uk: "/web-asset/icons/svg/speaker-blue-uk.svg",
    us: "/web-asset/icons/svg/speaker-red-usa.svg",
  })
  let speakerAnimationId = 0

  const restartSpeakerAnimation = (image) => {
    const iconPath = image?.dataset.iconPath
    if (!iconPath) return
    speakerAnimationId += 1
    image.src = `${iconPath}?animation=${speakerAnimationId}`
  }

  const bindAudioControl = (root, row, dialect, label, sourceUrl, { local = false } = {}) => {
    if (!root || !row || !sourceUrl) return null
    let button = row.querySelector(`[data-library-audio-trigger="${dialect}"]`)
    if (!button) {
      button = document.createElement("button")
      button.type = "button"
      button.className = "library-audio-play"
      button.dataset.libraryAudioTrigger = dialect
      button.setAttribute("aria-label", `Play ${label} pronunciation`)
      button.title = `Play ${label} pronunciation`
      const image = document.createElement("img")
      image.src = SPEAKER_ICON_PATHS[dialect] || SPEAKER_ICON_PATHS.us
      image.alt = `${label} speaker`
      image.dataset.iconPath = image.src
      button.append(image)
      row.append(button)
    }
    button.dataset.audioUrl = sourceUrl
    const image = button.querySelector("img")
    let audio = root.querySelector(`[data-library-preview-audio="${dialect}"]`)
    if (!audio) {
      audio = document.createElement("audio")
      audio.preload = "none"
      audio.hidden = true
      audio.dataset.libraryPreviewAudio = dialect
      root.append(audio)
    }
    audio.src = sourceUrl
    if (local) audio.dataset.localLibraryMedia = "true"
    else delete audio.dataset.localLibraryMedia
    if (typeof audio.load === "function") audio.load()
    if (button.dataset.audioBound !== "true") {
      button.dataset.audioBound = "true"
      const play = () => {
        restartSpeakerAnimation(image)
        button.classList.add("is-playing")
        audio.currentTime = 0
        try {
          const playback = audio.play()
          if (playback?.catch) playback.catch(() => button.classList.remove("is-playing"))
        } catch {
          button.classList.remove("is-playing")
        }
      }
      button.addEventListener("mouseenter", () => restartSpeakerAnimation(image))
      button.addEventListener("focus", () => restartSpeakerAnimation(image))
      button.addEventListener("click", play)
      audio.addEventListener("ended", () => button.classList.remove("is-playing"))
      audio.addEventListener("pause", () => button.classList.remove("is-playing"))
      audio.addEventListener("error", () => button.classList.remove("is-playing"))
    }
    return { button, audio }
  }

  const parseLibraryMediaAssets = (pane) => {
    try {
      const value = JSON.parse(pane?.dataset.libraryMediaAssets || "[]")
      return Array.isArray(value) ? value : []
    } catch {
      return []
    }
  }

  const etymologyValues = (value) => {
    if (Array.isArray(value)) return value.flatMap(etymologyValues)
    if (value && typeof value === "object") return Object.values(value).flatMap(etymologyValues)
    return [value]
  }

  const mwEtymology = (data = {}) => {
    return [data.fields?.etymology, ...(Array.isArray(data.details?.entries) ? data.details.entries : []).flatMap((entry) => etymologyValues(entry?.etymology))]
      .flatMap(etymologyValues)
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
          const appliedFields = Object.keys(nonEmptyMwFields).join(", ") || "none"
          button.title = `Filled authoritative Merriam-Webster fields: ${appliedFields}.`
          const etymologyMessage = etymology ? "" : current.etymology ? " MW returned no etymology section for this part of speech; the existing value was preserved." : " MW returned no etymology section for this part of speech."
          if (message) message.textContent = `Filled authoritative MW fields: ${appliedFields}.${etymologyMessage}`
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

  const ldoceFieldLabels = {
    definition: "Definition and examples",
    countability: "Noun countability",
    verbTransitivity: "Verb transitivity",
    grammarClassification: "LDOCE grammar labels",
  }

  const dictionaryPreviewConfig = (provider) => ({
    ldoce: {
      label: "LDOCE", title: "LDOCE dictionary preview", dialogId: "libraryLdocePreviewDialog", formClass: "library-ldoce-preview-form", rootAttribute: "data-vocabulary-ldoce-preview-root", fieldAttribute: "data-ldoce-field", modeAttribute: "data-ldoce-mode", audioAttribute: "data-ldoce-audio", fieldLabels: ldoceFieldLabels, audioDialects: [["us", "US"]], previewPath: "ldoce-preview", applyPath: "ldoce-apply",
    },
    oxford: {
      label: "Oxford", title: "Oxford Learner's Dictionaries American English preview", dialogId: "libraryOxfordPreviewDialog", formClass: "library-oxford-preview-form", rootAttribute: "data-vocabulary-oxford-preview-root", fieldAttribute: "data-oxford-field", modeAttribute: "data-oxford-mode", audioAttribute: "data-oxford-audio", fieldLabels: { definition: "Definition and examples", countability: "Noun countability", verbTransitivity: "Verb transitivity", grammarClassification: "Oxford grammar labels" }, audioDialects: [["us", "US"]], previewPath: "oxford-preview", applyPath: "oxford-apply",
    },
    britannica: {
      label: "Britannica", title: "Britannica Dictionary preview", dialogId: "libraryBritannicaPreviewDialog", formClass: "library-britannica-preview-form", rootAttribute: "data-vocabulary-britannica-preview-root", fieldAttribute: "data-britannica-field", modeAttribute: "data-britannica-mode", audioAttribute: "data-britannica-audio", fieldLabels: { definition: "Definitions, examples, phrases, and collocations", etymology: "Etymology and history", originReferences: "APA source citation", countability: "Noun countability", nounNumber: "Noun number", verbTransitivity: "Verb transitivity", grammarClassification: "Britannica subtypes" }, audioDialects: [], previewPath: "britannica-preview", applyPath: "britannica-apply",
    },
    "merriam-webster": {
      label: "MW", title: "Merriam-Webster.com Dictionary preview", dialogId: "libraryMerriamWebsterPreviewDialog", formClass: "library-merriam-webster-preview-form", rootAttribute: "data-vocabulary-merriam-webster-preview-root", fieldAttribute: "data-merriam-webster-field", modeAttribute: "data-merriam-webster-mode", audioAttribute: "data-merriam-webster-audio", fieldLabels: { definition: "Definitions, examples, phrases, and collocations", etymology: "Etymology and history", originReferences: "APA source citation", countability: "Noun countability", nounNumber: "Noun number", verbTransitivity: "Verb transitivity", grammarClassification: "Merriam-Webster subtypes" }, audioDialects: [], previewPath: "merriam-webster-preview", applyPath: "merriam-webster-apply",
    },
  }[provider] || {})

  const dictionaryPreviewDialog = (provider) => {
    const config = dictionaryPreviewConfig(provider)
    let dialog = document.getElementById(config.dialogId)
    if (!dialog) {
      dialog = document.createElement("dialog")
      dialog.id = config.dialogId
      dialog.innerHTML = `<form method="dialog" class="${config.formClass}"><div class="portal-modal-header"><h2>${config.title}</h2><button type="submit" class="portal-button portal-button-neutral-action" aria-label="Close ${config.label} preview">Close</button></div><div class="library-dictionary-preview-root" ${config.rootAttribute}></div></form>`
      dialog.addEventListener("cancel", (event) => event.preventDefault())
      document.body.append(dialog)
    }
    return dialog
  }

  const renderDictionaryPreview = (pane, data, sourceId, provider) => {
    const config = dictionaryPreviewConfig(provider)
    const dialog = dictionaryPreviewDialog(provider)
    const root = dialog.querySelector(`[${config.rootAttribute}]`)
    if (!root) return
    root.replaceChildren()
    const summary = document.createElement("p")
    summary.className = "small"
    summary.textContent = `${data.lookupWord} · ${data.entries?.length || 0} ${config.label} entry(s). Preview only; no Library fields or local audio have been saved.`
    root.append(summary)
    const audio = document.createElement("fieldset")
    const audioLegend = document.createElement("legend")
    audioLegend.textContent = "Headword audio (preview; stored locally on Apply)"
    audio.append(audioLegend)
    const audioRows = document.createElement("div")
    audioRows.className = "library-audio-options"
    config.audioDialects.forEach(([dialect, label]) => {
      const available = data.entries?.some((entry) => entry.audio?.[dialect])
      const audioRow = document.createElement("div")
      audioRow.className = "library-audio-row"
      audioRow.dataset.libraryAudioRow = dialect
      const fieldLabel = document.createElement("label")
      const input = document.createElement("input")
      input.type = "checkbox"
      input.checked = Boolean(available)
      input.disabled = !available
      input.setAttribute(config.audioAttribute, dialect)
      fieldLabel.append(input, document.createTextNode(` ${label} MP3${available ? " available for local storage" : " unavailable"}`))
      audioRow.append(fieldLabel)
      audioRows.append(audioRow)
    })
    audio.append(audioRows)
    root.append(audio)
    const formattedDefinition = document.createElement("section")
    formattedDefinition.className = "new-word-entry-definition"
    if (provider === "ldoce") formattedDefinition.dataset.ldoceFormattedDefinition = "true"
    const formattedDefinitionTitle = document.createElement("h4")
    formattedDefinitionTitle.textContent = "Dictionary preview"
    const formattedDefinitionBody = document.createElement("div")
    formattedDefinitionBody.className = "new-word-entry-definition-body"
    formattedDefinitionBody.innerHTML = window.SIS_VOCABULARY_ESL?.definitionHtml(data.fields?.definition || "") || "No definition yet."
    formattedDefinition.append(formattedDefinitionTitle, formattedDefinitionBody)
    root.append(formattedDefinition)
    const modeLabel = document.createElement("label")
    modeLabel.textContent = "Apply mode"
    const mode = document.createElement("select")
    mode.setAttribute(config.modeAttribute, "true")
    ;[["fill_missing", "Fill missing"], ["selected", "Selected fields"], ["replace_selected", "Destructive Replace Selected"], ["replace_all", "Destructive Replace All"]].forEach(([value, label]) => {
      const option = document.createElement("option")
      option.value = value
      option.textContent = label
      mode.append(option)
    })
    modeLabel.append(mode)
    root.append(modeLabel)
    const fields = document.createElement("fieldset")
    const legend = document.createElement("legend")
    legend.textContent = "Fields"
    fields.append(legend)
    Object.entries(config.fieldLabels).filter(([field]) => Object.hasOwn(data.fields || {}, field)).forEach(([field, label]) => {
      const fieldLabel = document.createElement("label")
      const input = document.createElement("input")
      input.type = "checkbox"
      input.checked = true
      input.setAttribute(config.fieldAttribute, field)
      fieldLabel.append(input, document.createTextNode(` ${label}`))
      fields.append(fieldLabel)
    })
    root.append(fields)
    const apply = document.createElement("button")
    apply.type = "button"
    apply.className = "portal-button portal-button-affirm"
    apply.textContent = provider === "ldoce" ? "Apply LDOCE" : provider === "oxford" ? "Apply Oxford" : provider === "britannica" ? "Apply BR" : "Apply MW"
    const updateModeControls = () => {
      const destructive = mode.value === "replace_selected" || mode.value === "replace_all"
      root.querySelectorAll(`[${config.fieldAttribute}]`).forEach((input) => {
        input.disabled = mode.value === "replace_all"
        if (mode.value === "replace_all") input.checked = true
      })
      apply.title = mode.value === "replace_all"
        ? `Destructively replace every ${config.label}-supported field, clearing supported fields with no ${config.label} value, and download selected headword audio.`
        : mode.value === "replace_selected"
          ? `Destructively replace only the checked ${config.label} fields, clearing checked fields with no ${config.label} value.`
        : `Apply only the selected ${config.label} fields and download selected headword audio.`
    }
    mode.addEventListener("change", updateModeControls)
    updateModeControls()
    apply.addEventListener("click", async () => {
      const message = pane.querySelector(`[data-vocabulary-${provider}-message]`)
      apply.disabled = true
      try {
        const selected = [...root.querySelectorAll(`[${config.fieldAttribute}]:checked`)].map((input) => input.getAttribute(config.fieldAttribute))
        const selectedAudio = Object.fromEntries([...root.querySelectorAll(`[${config.audioAttribute}]`)].map((input) => [input.getAttribute(config.audioAttribute), input.checked]))
        const response = await fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/${config.applyPath}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: mode.value, fields: selected, audio: selectedAudio, entry: readPayload(pane) }) })
        const result = await response.json()
        if (!response.ok || !result.ok) throw new Error(result.error || result.message || `${config.label} Apply failed; no Library data was changed.`)
        window.SIS_VOCABULARY_ESL?.hydrate(pane, result.entry, { preserveSyllabication: true })
        const applied = result.appliedFields?.join(", ") || "no content fields"
        if (message) message.textContent = `${config.label} applied: ${applied}. Selected audio is now served through protected local Library media.`
        const mediaAssets = Array.isArray(result.mediaAssets) ? result.mediaAssets : []
        pane.dataset.libraryMediaAssets = JSON.stringify(mediaAssets)
      } catch (error) {
        const message = pane.querySelector(`[data-vocabulary-${provider}-message]`)
        if (message) message.textContent = error.message || `${config.label} Apply failed; no Library data was changed.`
      } finally {
        apply.disabled = false
      }
    })
    root.append(apply)
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal()
      else dialog.setAttribute("open", "")
    }
  }

  const renderLdocePreview = (pane, data, sourceId) => renderDictionaryPreview(pane, data, sourceId, "ldoce")
  const renderOxfordPreview = (pane, data, sourceId) => renderDictionaryPreview(pane, data, sourceId, "oxford")
  const renderBritannicaPreview = (pane, data, sourceId) => renderDictionaryPreview(pane, data, sourceId, "britannica")
  const renderMerriamWebsterPreview = (pane, data, sourceId) => renderDictionaryPreview(pane, data, sourceId, "merriam-webster")

  const bindDictionaryPreview = (provider) => {
    const config = dictionaryPreviewConfig(provider)
    document.querySelectorAll(`[data-vocabulary-${provider}-preview]`).forEach((button) => {
      if (button.dataset.dictionaryPreviewBound === "true") return
      button.dataset.dictionaryPreviewBound = "true"
      button.addEventListener("click", async () => {
        const pane = button.closest("[data-review-pane], [data-vocabulary-editor]")
        const sourceId = pane?.dataset.reviewSourceId || pane?.dataset.approvedEntryId
        const message = pane?.querySelector(`[data-vocabulary-${provider}-message]`)
        if (!pane || !sourceId) return
        const originalLabel = button.textContent
        button.disabled = true
        button.textContent = `${config.label}…`
        if (message) message.textContent = `Retrieving ${config.label} preview; no fields or audio will be changed.`
        try {
          const response = await fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/${config.previewPath}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: readPayload(pane) }) })
          const data = await response.json()
          if (!response.ok || !data.ok) throw new Error(data.error || data.message || `${config.label} is unavailable; no Library data was changed.`)
          if (provider === "ldoce") renderLdocePreview(pane, data, sourceId)
          else if (provider === "oxford") renderOxfordPreview(pane, data, sourceId)
          else if (provider === "britannica") renderBritannicaPreview(pane, data, sourceId)
          else renderMerriamWebsterPreview(pane, data, sourceId)
          if (message) message.textContent = `${config.label} preview ready. Choose fields and Apply explicitly.`
        } catch (error) {
          if (message) message.textContent = error.message || `${config.label} is unavailable; no Library data was changed.`
        } finally {
          button.disabled = false
          button.textContent = originalLabel
        }
      })
    })
  }

  const bindLdoce = () => bindDictionaryPreview("ldoce")
  const bindOxford = () => bindDictionaryPreview("oxford")
  const bindBritannica = () => bindDictionaryPreview("britannica")
  const bindMerriamWebster = () => bindDictionaryPreview("merriam-webster")

  const dictionaryBuilderFields = [
    ["vietnamese", "Vietnamese"], ["syllabication", "Syllable / Stress"], ["syllableCount", "Number of syllables"], ["grammarClassification", "POS Classification"],
    ["audio", "Headword Audio"], ["verbFormAudio", "Verb Form Audio"], ["definition", "Definition Proper"], ["verbForms", "Verb Forms"], ["stems", "Stems"], ["synonymsAntonyms", "Synonyms / Antonyms"], ["examples", "Examples"], ["firstKnownUse", "First known use"], ["originPath", "Origin path"], ["etymology", "Etymology"], ["worksCited", "Works Cited"],
  ]
  const dictionaryBuilderApplyFields = new Set(["vietnamese", "syllabication", "syllableCount", "grammarClassification", "audio", "verbFormAudio", "definition", "verbForms", "stems", "synonymsAntonyms", "examples", "verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5", "etymology", "originPath", "originReferences", "firstKnownUse", "worksCited"])
  const dictionaryBuilderStatusLabel = (status) => ({ not_found: "not found (HTTP 404)", not_provided: "not provided by source", robot_blocked: "robot verification required; run remains active", unavailable: "provider unavailable", not_offered: "not provided by source" }[status] || status)
  const dictionaryBuilderEsc = (value) => String(value == null ? "" : value).replace(/[&<>'"]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character])
  const dictionaryBuilderSourceMatrix = (word) => {
    const encoded = encodeURIComponent(String(word || "").trim())
    const links = [
      ["LD", `https://www.ldoceonline.com/dictionary/${encoded}`], ["OA", `https://www.oxfordlearnersdictionaries.com/definition/american_english/${encoded}`], ["OB", `https://www.oxfordlearnersdictionaries.com/definition/english/${encoded}`], ["BR", `https://www.britannica.com/dictionary/${encoded}`],
      ["MW", `https://www.merriam-webster.com/dictionary/${encoded}`], ["AP", `https://www.merriam-webster.com/dictionary/${encoded}`], ["ET", `https://www.etymonline.com/search?q=${encoded}`], ["WK", `https://en.wiktionary.org/w/index.php?search=${encoded}`],
      ["CA", `https://dictionary.cambridge.org/dictionary/english/${encoded}`], ["TH", `https://www.merriam-webster.com/thesaurus/${encoded}`], ["WH", `https://www.wordhelp.com/syllables/english/?q=${encoded}`], ["GT", `https://translate.google.com/?sl=en&tl=vi&text=${encoded}&op=translate`],
    ]
    return `<div class="news-vocabulary-lookups dictionary-builder-source-matrix" data-dictionary-builder-source-matrix role="group" aria-label="Twelve outbound Dictionary Builder source links">${links.map(([label, href]) => `<a class="portal-button portal-button-blue-action news-vocabulary-lookup dictionary-builder-source-link" data-vocabulary-lookup="${label}" href="${href}" target="_blank" rel="noopener noreferrer" title="Open ${label}; this does not apply data.">${label}</a>`).join("")}</div>`
  }
  const dictionaryBuilderDialog = () => {
    let dialog = document.getElementById("libraryDictionaryBuilderDialog")
    if (!dialog) {
      dialog = document.createElement("dialog")
      dialog.id = "libraryDictionaryBuilderDialog"
      dialog.className = "portal-modal"
      dialog.setAttribute("aria-labelledby", "libraryDictionaryBuilderTitle")
      dialog.innerHTML = `<form method="dialog" class="library-dictionary-builder-form"><header class="library-dictionary-builder-header"><div data-dictionary-builder-source-matrix-slot></div><div class="library-dictionary-builder-header-main"><h2 id="libraryDictionaryBuilderTitle" data-dictionary-builder-tab-heading></h2><p class="small" data-dictionary-builder-section-summary aria-live="polite"></p><p class="small" data-dictionary-builder-message aria-live="polite"></p></div><button type="submit" class="portal-button portal-button-neutral-action" aria-label="Close Dictionary Builder">Close</button></header><div data-dictionary-builder-root></div></form>`
      document.body.append(dialog)
    }
    return dialog
  }
  const candidatesForDatum = (snapshot, datum) => {
    const sources = snapshot.sources || []
    const order = snapshot.datumSourceOrder?.[datum] || []
    const ordered = sources.filter((source) => {
      if (datum === "vietnamese" && source.provider !== "google_translate") return false
      const status = source.datumStatus?.[datum]?.status
      return status === "robot_blocked" || (status === "available" && source.fields?.[datum] !== undefined)
    }).sort((left, right) => {
      const leftPosition = order.indexOf(left.provider); const rightPosition = order.indexOf(right.provider)
      return (leftPosition < 0 ? Number.MAX_SAFE_INTEGER : leftPosition) - (rightPosition < 0 ? Number.MAX_SAFE_INTEGER : rightPosition)
    })
    const mandatory = datum === "synonymsAntonyms" ? "merriam_webster_thesaurus" : datum === "syllabication" ? "wordhelp" : ""
    const mandatorySource = mandatory ? sources.find((source) => source.provider === mandatory) : null
    const available = ordered.filter((source) => source.datumStatus?.[datum]?.status === "available").slice(0, 3)
    const robotBlocked = ordered.filter((source) => source.datumStatus?.[datum]?.status === "robot_blocked")
    return [ ...(mandatorySource && ordered.includes(mandatorySource) ? [mandatorySource] : []), ...available.filter((source) => source.provider !== mandatory), ...robotBlocked.filter((source) => source.provider !== mandatory) ].filter((source, index, list) => list.indexOf(source) === index)
  }
  const sizeDictionaryBuilderTextarea = (textarea) => {
    if (!(textarea instanceof HTMLTextAreaElement)) return
    textarea.style.blockSize = "auto"
    textarea.style.blockSize = `${Math.max(textarea.scrollHeight, 54)}px`
  }
  const sizeDictionaryBuilderTextareas = (container) => {
    const applySize = () => {
      const textareas = [...container.querySelectorAll("textarea")]
      textareas.forEach((textarea) => { textarea.style.blockSize = "auto" })
      const largest = Math.max(54, ...textareas.map((textarea) => textarea.scrollHeight))
      textareas.forEach((textarea) => { textarea.style.blockSize = `${largest}px` })
    }
    applySize()
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(applySize)
  }
  const robotHandoffTabs = new Map()
  const renderDictionaryBuilder = (snapshot, pane, sourceId, previousSelections = {}, activeTab = "vietnamese") => {
    const dialog = dictionaryBuilderDialog()
    const root = dialog.querySelector("[data-dictionary-builder-root]")
    const sourceMatrixSlot = dialog.querySelector("[data-dictionary-builder-source-matrix-slot]")
    const word = pane.querySelector('[data-vocabulary-field="english"]')?.value || ""
    const tabs = dictionaryBuilderFields.map(([datum, label], index) => `<button type="button" class="dictionary-builder-tab" id="dictionary-builder-tab-${datum}" role="tab" aria-controls="dictionary-builder-panel-${datum}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-dictionary-builder-tab="${datum}"><span class="dictionary-builder-tab-step">${index + 1}</span><span>${dictionaryBuilderEsc(label)}</span></button>`).join("")
    sourceMatrixSlot.innerHTML = dictionaryBuilderSourceMatrix(word)
    const canApply = sourceId !== "new-canonical"
    root.innerHTML = `<div class="dictionary-builder-tabs" role="tablist" aria-label="Dictionary Builder sections">${tabs}</div><div data-dictionary-builder-panels></div><div class="library-dictionary-preview-actions"><select data-dictionary-builder-mode aria-label="Dictionary Builder apply mode"${canApply ? "" : " disabled"}><option value="fill_missing">Fill missing</option><option value="replace_selected">Replace selected</option><option value="replace_all">Replace all</option></select><button type="button" class="portal-button portal-button-affirm" data-dictionary-builder-apply${canApply ? "" : " disabled title=\"Save the canonical Library entry before applying Dictionary Builder data.\""}>Apply selected</button></div>`
    const panels = root.querySelector("[data-dictionary-builder-panels]")
    const selectedCandidates = structuredClone(previousSelections)
    const updateTabSelection = (datum) => {
      const tab = root.querySelector(`[data-dictionary-builder-tab="${datum}"]`)
      tab?.classList.toggle("is-complete", Boolean(selectedCandidates[datum]?.value))
    }
    const show = (datum, focus = false) => {
      root.querySelectorAll("[data-dictionary-builder-tab]").forEach((button) => {
        const active = button.dataset.dictionaryBuilderTab === datum
        button.setAttribute("aria-selected", String(active))
        button.tabIndex = active ? 0 : -1
        if (active && focus) button.focus()
      })
      const candidates = candidatesForDatum(snapshot, datum)
      const statusSourceIds = datum === "vietnamese"
        ? ["google_translate"]
        : (snapshot.datumSourceOrder?.[datum] || [])
      const sourceById = new Map((snapshot.sources || []).map((source) => [source.provider, source]))
      const statusSources = statusSourceIds.length
        ? statusSourceIds.map((provider) => sourceById.get(provider)).filter(Boolean)
        : (snapshot.sources || []).filter((source) => source.datumStatus?.[datum]?.status !== "not_offered")
      const statuses = statusSources.map((source) => `${source.provider}: ${dictionaryBuilderStatusLabel(source.datumStatus?.[datum]?.status || "not_offered")}`).join(" · ")
      const robotSource = statusSources.find((source) => source.datumStatus?.[datum]?.status === "robot_blocked" || source.status === "robot_blocked")
      const sectionSummary = dialog.querySelector("[data-dictionary-builder-section-summary]")
      const datumLabel = dictionaryBuilderFields.find(([key]) => key === datum)?.[1] || datum
      const tabHeading = dialog.querySelector("[data-dictionary-builder-tab-heading]")
      if (tabHeading) tabHeading.textContent = datumLabel
      if (sectionSummary) sectionSummary.textContent = robotSource
        ? `Queried: ${statuses || "no applicable source"}. Robot prompt required for ${robotSource.provider}; the run remains active. Complete the prompt in the opened source tab, then close it to retry.`
        : `Queried: ${statuses || "no applicable source"}.`
      panels.replaceChildren()
      const section = document.createElement("section")
      section.className = "dictionary-builder-candidates"
      section.id = `dictionary-builder-panel-${datum}`
      section.setAttribute("role", "tabpanel")
      section.setAttribute("aria-labelledby", `dictionary-builder-tab-${datum}`)
      if (!candidates.length) {
        const unavailable = document.createElement("p")
        unavailable.className = "small"
        unavailable.textContent = datum === "syllabication"
          ? "No automatic candidate. Use WordHelp plus the two other BIC sources named in the queried list, then enter the verified value below."
          : "No automatic candidate. Enter a source-verified manual value below."
        section.append(unavailable)
      }
      const candidateList = document.createElement("div")
      candidateList.className = "dictionary-builder-candidate-list"
      const appendSourceLink = (container, provider, sourceUrl) => {
        if (!sourceUrl) return null
        const link = document.createElement("a")
        link.className = "dictionary-builder-candidate-source"
        link.href = sourceUrl
        link.target = "_blank"
        link.rel = "noopener noreferrer"
        link.textContent = "View source page"
        link.title = `View the ${provider} source page in a new tab; this does not apply data.`
        container.append(link)
        return link
      }
      candidates.forEach((candidate) => {
        const label = document.createElement("label")
        const candidateStatus = candidate.datumStatus?.[datum]?.status || "available"
        label.className = `dictionary-builder-candidate${candidateStatus === "robot_blocked" ? " dictionary-builder-candidate-robot" : ""}`
        const radio = document.createElement("input")
        radio.type = "radio"
        radio.name = `dictionary-builder-${datum}`
        radio.value = candidate.provider
        radio.checked = selectedCandidates[datum]?.provider === candidate.provider
        const title = document.createElement("strong")
        title.textContent = candidateStatus === "robot_blocked" ? `${candidate.provider} — robot verification required` : candidate.provider
        const input = document.createElement("textarea")
        const candidateValue = candidateStatus === "robot_blocked" ? "" : typeof candidate.fields[datum] === "object" ? JSON.stringify(candidate.fields[datum]) : String(candidate.fields[datum] || "")
        input.value = radio.checked ? selectedCandidates[datum].value : candidateValue
        input.placeholder = candidateStatus === "robot_blocked" ? "Complete the robot prompt, then enter the verified value here." : ""
        input.dataset.dictionaryBuilderCandidateValue = datum
        input.dataset.dictionaryBuilderProvider = candidate.provider
        const saveCandidate = () => {
          if (!radio.checked) return
          selectedCandidates[datum] = { provider: candidate.provider, value: input.value, status: candidateStatus }
          updateTabSelection(datum)
        }
        input.addEventListener("focus", () => { radio.checked = true; saveCandidate() })
        input.addEventListener("input", () => { saveCandidate(); sizeDictionaryBuilderTextareas(candidateList) })
        radio.addEventListener("change", saveCandidate)
        label.append(radio, title)
        const sourceLink = appendSourceLink(label, candidate.provider, candidate.sourceUrl)
        if (candidateStatus === "robot_blocked") {
          const retry = document.createElement("button")
          retry.type = "button"
          retry.className = "portal-button portal-button-blue-action"
          retry.textContent = "Retry provider"
          retry.title = `Retry ${candidate.provider} after completing its robot-verification prompt.`
          retry.setAttribute("aria-label", `Retry ${candidate.provider} after completing its robot-verification prompt`)
          const retryProvider = async () => {
            retry.disabled = true
            retry.textContent = "Retrying..."
            try {
              const response = await fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/dictionary-builder/previews/${encodeURIComponent(snapshot.id)}/retry`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: candidate.provider, entry: readPayload(pane) }) })
              const refreshed = await response.json()
              if (!response.ok || !refreshed.ok) throw new Error(refreshed.error || "Provider retry failed.")
              renderDictionaryBuilder(refreshed, pane, sourceId, selectedCandidates, datum)
            } catch (error) {
              retry.disabled = false
              retry.textContent = "Retry provider"
              dialog.querySelector("[data-dictionary-builder-message]").textContent = error.message || "Provider retry failed."
            }
          }
          retry.addEventListener("click", async (event) => {
            event.preventDefault()
            event.stopPropagation()
            await retryProvider()
          })
          label.append(retry)
          const openChallengeTab = () => {
            const existing = robotHandoffTabs.get(candidate.provider)
            if (existing && !existing.closed) {
              existing.focus?.()
              return existing
            }
            const challengeTab = window.open(candidate.sourceUrl, "_blank")
            if (!challengeTab) {
              dialog.querySelector("[data-dictionary-builder-message]").textContent = `The ${candidate.provider} source tab was blocked. Open the source link, complete the prompt, close the tab, then choose Retry provider.`
              return null
            }
            robotHandoffTabs.set(candidate.provider, challengeTab)
            dialog.querySelector("[data-dictionary-builder-message]").textContent = `Complete the ${candidate.provider} robot check in the new tab. Close that tab when finished; Builder will retry the scrape automatically.`
            const watchTab = window.setInterval(() => {
              if (!challengeTab.closed) return
              window.clearInterval(watchTab)
              robotHandoffTabs.delete(candidate.provider)
              retryProvider()
            }, 500)
            return challengeTab
          }
          sourceLink?.addEventListener("click", (event) => {
            event.preventDefault()
            openChallengeTab()
          })
          window.setTimeout(() => openChallengeTab(), 0)
        }
        label.append(input)
        candidateList.append(label)
        sizeDictionaryBuilderTextareas(candidateList)
      })
      if (!candidates.length) {
        const sourceLinks = document.createElement("div")
        sourceLinks.className = "dictionary-builder-candidate-source-list"
        statusSources.filter((source) => source.datumStatus?.[datum]?.status !== "manual").forEach((source) => appendSourceLink(sourceLinks, source.provider, source.sourceUrl))
        if (sourceLinks.childElementCount) section.append(sourceLinks)
      }
      if (datum === "grammarClassification") {
        const label = document.createElement("label")
        label.className = "dictionary-builder-candidate dictionary-builder-candidate-manual"
        const radio = document.createElement("input")
        radio.type = "radio"
        radio.name = `dictionary-builder-${datum}`
        radio.value = "manual"
        const title = document.createElement("strong")
        title.textContent = "Manual POS classes"
        const partOfSpeech = String(pane.querySelector('[data-vocabulary-field="partOfSpeech"]')?.value || "").trim().toLowerCase()
        const previous = selectedCandidates[datum]?.provider === "manual" ? selectedCandidates[datum].value : ""
        let values = {}
        try { values = previous ? JSON.parse(previous) : {} } catch { values = {} }
        const controls = document.createElement("div")
        controls.className = "dictionary-builder-pos-controls"
        const syncManualControls = () => {
          const classification = Object.fromEntries([...controls.querySelectorAll("select, input[data-vocabulary-esl-field]")]
            .map((item) => [item.dataset.vocabularyEslField, item.type === "checkbox" ? item.checked : item.multiple ? Array.from(item.selectedOptions).map((option) => option.value).filter(Boolean) : item.value])
            .filter(([, value]) => value !== "" && value !== false))
          selectedCandidates[datum] = { provider: "manual", value: JSON.stringify(classification) }
          updateTabSelection(datum)
        }
        const renderManualControls = (controlValues = {}) => {
          controls.innerHTML = window.SIS_VOCABULARY_ESL?.posControlsHtml?.(partOfSpeech, `dictionary-builder-${datum}`, controlValues) || ""
          Object.entries(controlValues).forEach(([field, value]) => {
            const control = controls.querySelector(`[data-vocabulary-esl-field="${field}"]`)
            if (!control) return
            if (control.type === "checkbox") control.checked = Boolean(value)
            else if (control.multiple) Array.from(control.options).forEach((option) => { option.selected = Array.isArray(value) && value.includes(option.value) })
            else control.value = String(value ?? "")
          })
          controls.querySelectorAll("select, input[data-vocabulary-esl-field]").forEach((control) => {
            control.addEventListener("focus", () => { radio.checked = true })
            control.addEventListener("change", () => {
              radio.checked = true
              syncManualControls()
              const nextValues = Object.fromEntries([...controls.querySelectorAll("select, input[data-vocabulary-esl-field]")].map((item) => [item.dataset.vocabularyEslField, item.type === "checkbox" ? item.checked : item.multiple ? Array.from(item.selectedOptions).map((option) => option.value).filter(Boolean) : item.value]))
              renderManualControls(nextValues)
            })
          })
        }
        renderManualControls(values)
        radio.addEventListener("change", syncManualControls)
        label.append(radio, title, controls)
        candidateList.append(label)
        sizeDictionaryBuilderTextareas(candidateList)
      } else {
        const label = document.createElement("label")
        label.className = "dictionary-builder-candidate dictionary-builder-candidate-manual"
        const radio = document.createElement("input")
        radio.type = "radio"
        radio.name = `dictionary-builder-${datum}`
        radio.value = "manual"
        const title = document.createElement("strong")
        title.textContent = "Manual"
        const input = document.createElement("textarea")
        input.placeholder = `Enter ${datumLabel} (blank is allowed)`
        input.dataset.dictionaryBuilderCandidateValue = datum
        input.dataset.dictionaryBuilderProvider = "manual"
        const saveCandidate = () => {
          if (!radio.checked) return
          selectedCandidates[datum] = { provider: "manual", value: input.value }
          updateTabSelection(datum)
        }
        input.addEventListener("focus", () => { radio.checked = true; saveCandidate() })
        input.addEventListener("input", () => { saveCandidate(); sizeDictionaryBuilderTextareas(candidateList) })
        radio.addEventListener("change", saveCandidate)
        label.append(radio, title, input)
        candidateList.append(label)
        sizeDictionaryBuilderTextareas(candidateList)
      }
      if (candidateList.childElementCount) section.append(candidateList)
      panels.append(section)
    }
    const tabButtons = [...root.querySelectorAll("[data-dictionary-builder-tab]")]
    tabButtons.forEach((button, index) => {
      button.addEventListener("click", () => show(button.dataset.dictionaryBuilderTab))
      button.addEventListener("keydown", (event) => {
        const movement = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, Home: -index, End: tabButtons.length - index - 1 }[event.key]
        if (movement === undefined) return
        event.preventDefault()
        const next = (index + movement + tabButtons.length) % tabButtons.length
        show(tabButtons[next].dataset.dictionaryBuilderTab, true)
      })
    })
    root.querySelector("[data-dictionary-builder-apply]").addEventListener("click", async () => {
      const selections = {}
      Object.entries(selectedCandidates).forEach(([datum, selection]) => {
        if (!dictionaryBuilderApplyFields.has(datum)) return
        let value = selection.value || ""
        if (["grammarClassification", "originReferences", "verbForms"].includes(datum)) { try { value = JSON.parse(value) } catch { return } }
        selections[datum] = { provider: selection.provider, value }
      })
      const unresolvedRobotDatum = Object.entries(selectedCandidates).find(([, selection]) => selection.status === "robot_blocked" && !String(selection.value || "").trim())
      if (unresolvedRobotDatum) {
        dialog.querySelector("[data-dictionary-builder-message]").textContent = `Complete the robot verification for ${unresolvedRobotDatum[1].provider}, then enter the verified ${unresolvedRobotDatum[0]} value before applying.`
        return
      }
      const apply = root.querySelector("[data-dictionary-builder-apply]")
      const message = dialog.querySelector("[data-dictionary-builder-message]")
      apply.disabled = true
      try {
        const requestBody = { mode: root.querySelector("[data-dictionary-builder-mode]").value, selections }
        const applySnapshot = (snapshotId) => fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/dictionary-builder/previews/${encodeURIComponent(snapshotId)}/apply`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) })
        let response = await applySnapshot(snapshot.id)
        if (response.status === 404) {
          if (message) message.textContent = "Preview expired after a runtime restart; rebuilding it with the current selections."
          const previewResponse = await fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/dictionary-builder/preview`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: readPayload(pane) }) })
          const refreshedSnapshot = await previewResponse.json()
          if (!previewResponse.ok || !refreshedSnapshot.ok) throw new Error(refreshedSnapshot.error || "Dictionary Builder preview refresh failed.")
          response = await applySnapshot(refreshedSnapshot.id)
        }
        const data = await response.json()
        if (!response.ok || !data.ok) throw new Error(data.error || "Dictionary Builder Apply failed.")
        message.textContent = data.appliedFields?.length ? `Applied ${data.appliedFields.join(", ")}.` : "No selected data changed this entry."
        if (typeof dialog.close === "function") dialog.close()
      } catch (error) { message.textContent = error.message || "Dictionary Builder Apply failed." } finally { apply.disabled = false }
    })
    show(activeTab)
    if (!canApply) {
      const message = dialog.querySelector("[data-dictionary-builder-message]")
      if (message) message.textContent = "Preview is available for the unsaved canonical draft. Save the canonical Library entry before applying data."
    }
    if (typeof dialog.showModal === "function") dialog.showModal()
    else dialog.setAttribute("open", "")
  }
  const bindDictionaryBuilder = () => {
    document.querySelectorAll("[data-vocabulary-dictionary-builder]").forEach((button) => {
      if (button.dataset.dictionaryBuilderBound === "true") return
      button.dataset.dictionaryBuilderBound = "true"
      const pane = button.closest("[data-review-pane], [data-vocabulary-editor]")
      const word = pane?.querySelector('[data-vocabulary-field="english"]')?.value || ""
      const encoded = encodeURIComponent(word.trim())
      const sourcePaths = { LD: `https://www.ldoceonline.com/dictionary/${encoded}`, OA: `https://www.oxfordlearnersdictionaries.com/definition/american_english/${encoded}`, OB: `https://www.oxfordlearnersdictionaries.com/definition/english/${encoded}`, BR: `https://www.britannica.com/dictionary/${encoded}`, MW: `https://www.merriam-webster.com/dictionary/${encoded}`, AP: `https://www.merriam-webster.com/dictionary/${encoded}`, ET: `https://www.etymonline.com/search?q=${encoded}`, WK: `https://en.wiktionary.org/w/index.php?search=${encoded}`, CA: `https://dictionary.cambridge.org/dictionary/english/${encoded}`, TH: `https://www.merriam-webster.com/thesaurus/${encoded}`, WH: `https://www.wordhelp.com/dictionary/${encoded}`, GT: `https://translate.google.com/?sl=en&tl=vi&text=${encoded}&op=translate` }
      pane?.querySelectorAll("[data-dictionary-builder-source]").forEach((link) => { link.href = sourcePaths[link.dataset.dictionaryBuilderSource] || link.href })
      button.addEventListener("click", async () => {
        const pane = button.closest("[data-review-pane], [data-vocabulary-editor]")
        const sourceId = pane?.dataset.reviewSourceId || pane?.dataset.approvedEntryId
        const message = pane?.querySelector("[data-vocabulary-dictionary-builder-message]")
        if (!pane || !sourceId) return
        button.disabled = true
        try {
          if (message) message.textContent = "Building availability-aware preview; no data or audio changes now."
          const response = await fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/dictionary-builder/preview`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: readPayload(pane) }) })
          const snapshot = await response.json()
          if (!response.ok || !snapshot.ok) throw new Error(snapshot.error || "Dictionary Builder preview failed.")
          renderDictionaryBuilder(snapshot, pane, sourceId)
          if (message) message.textContent = "Dictionary Builder preview ready."
        } catch (error) { if (message) message.textContent = error.message || "Dictionary Builder preview failed." } finally { button.disabled = false }
      })
    })
  }

  const appendOriginList = (root, title, items) => {
    if (!items?.length) return
    const section = document.createElement("section")
    const heading = document.createElement("h3")
    const list = document.createElement("ul")
    heading.textContent = title
    items.forEach((item) => {
      const line = document.createElement("li")
      line.textContent = item
      list.append(line)
    })
    section.append(heading, list)
    root.append(section)
  }

  const showOriginAnalysis = (data, pane) => {
    let dialog = document.getElementById("libraryOriginAnalysisDialog")
    if (!dialog) {
      dialog = document.createElement("dialog")
      dialog.id = "libraryOriginAnalysisDialog"
      dialog.className = "portal-modal"
      dialog.innerHTML = `<form method="dialog"><div class="portal-modal-header"><h2>Origin review</h2><button type="submit" class="portal-button portal-button-neutral-action" aria-label="Close origin review">Close</button></div><div class="library-origin-analysis-result"></div></form>`
      document.body.append(dialog)
    }
    const root = dialog.querySelector(".library-origin-analysis-result")
    root.replaceChildren()
    const advisory = document.createElement("p")
    advisory.className = "small"
    advisory.textContent = "Advisory only. This review does not alter Origin type, Etymology, or any saved entry field."
    const determination = document.createElement("section")
    const title = document.createElement("h3")
    const detail = document.createElement("p")
    title.textContent = `Suggested: ${data.determination?.label || "Unknown"} - ${data.determination?.confidenceLevel || "CL-D (insufficient)"}`
    detail.textContent = data.determination?.reason || "No reliable determination was returned."
    determination.append(title, detail)
    root.append(advisory, determination)
    const candidates = (data.topCandidates || []).map((item) => `${item.label} - ${item.confidenceLevel}: ${item.reason}`)
    appendOriginList(root, "Supported dropdown choices", candidates)
    appendOriginList(root, "Caveats", data.caveats || [])
    appendOriginList(root, "Missing information to search", data.missingInfo || [])
    const sources = document.createElement("section")
    const sourcesHeading = document.createElement("h3")
    sourcesHeading.textContent = "Source sections reviewed"
    sources.append(sourcesHeading)
    ;(data.sources || []).forEach((source) => {
      const item = document.createElement("article")
      const heading = document.createElement("h4")
      const message = document.createElement("p")
      heading.textContent = source.provider
      message.textContent = source.excerpt || source.message || "No etymology section returned."
      item.append(heading, message)
      ;(source.contextSections || []).forEach((context) => {
        const contextHeading = document.createElement("h5")
        const contextList = document.createElement("ul")
        contextHeading.textContent = `${context.title} (context only)`
        ;(context.items || []).forEach((value) => {
          const line = document.createElement("li")
          line.textContent = value
          contextList.append(line)
        })
        item.append(contextHeading, contextList)
      })
      sources.append(item)
    })
    root.append(sources)
    if (data.requiresStem) {
      const stemSection = document.createElement("section")
      const label = document.createElement("label")
      const input = document.createElement("input")
      const button = document.createElement("button")
      const prompt = document.createElement("p")
      label.textContent = "Possible base or stem"
      input.type = "text"
      input.maxLength = 200
      input.setAttribute("aria-label", "Possible base or stem for origin review")
      button.type = "button"
      button.className = "portal-button portal-button-blue-action"
      button.textContent = "Review stem"
      prompt.className = "small"
      prompt.textContent = data.stemPrompt
      button.addEventListener("click", () => requestOriginAnalysis(pane, input.value))
      label.append(input)
      stemSection.append(label, prompt, button)
      root.append(stemSection)
    }
    if (typeof dialog.showModal === "function") dialog.showModal()
    else dialog.setAttribute("open", "")
  }

  const requestOriginAnalysis = async (pane, stem = "") => {
    const button = pane?.querySelector("[data-vocabulary-origin-analysis]")
    const message = pane?.querySelector("[data-vocabulary-origin-analysis-message]")
    const sourceId = pane?.dataset.reviewSourceId || pane?.dataset.approvedEntryId
    const english = textValue(pane?.querySelector('[data-vocabulary-field="english"]')?.value)
    if (!pane || !button || !sourceId) return
    if (!english) { if (message) message.textContent = "Enter an English word or phrase before reviewing origin."; return }
    const originalLabel = button.textContent
    button.disabled = true
    button.textContent = "Reviewing..."
    if (message) message.textContent = "Retrieving Etymonline, Merriam-Webster, and Wiktionary etymology sections..."
    try {
      const response = await fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/origin-analysis`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry: readPayload(pane), stem }),
      })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.message || "Origin analysis is unavailable.")
      showOriginAnalysis(data, pane)
      if (message) message.textContent = "Origin review is ready. No entry fields were changed."
    } catch (error) {
      if (message) message.textContent = error.message || "Origin analysis is unavailable."
    } finally {
      button.disabled = false
      button.textContent = originalLabel
    }
  }

  const bindOriginAnalysis = () => {
    document.querySelectorAll("[data-vocabulary-origin-analysis]").forEach((button) => {
      if (button.dataset.originAnalysisBound === "true") return
      button.dataset.originAnalysisBound = "true"
      button.addEventListener("click", () => requestOriginAnalysis(button.closest("[data-review-pane], [data-vocabulary-editor]")))
    })
  }

  bindReviewSidebar()

  const showMwPreview = (data) => {
    let dialog = document.getElementById("libraryMwPreviewDialog")
    if (!dialog) {
      dialog = document.createElement("dialog")
      dialog.id = "libraryMwPreviewDialog"
      dialog.className = "portal-modal"
      dialog.innerHTML = `<form method="dialog"><div class="portal-modal-header"><h2>Merriam-Webster complete data</h2><button type="submit" class="portal-button portal-button-neutral-action" aria-label="Close Merriam-Webster data">Close</button></div><pre class="library-mw-preview-json"></pre></form>`
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

  const transitivityPayload = (pane) => Object.fromEntries([
    ["verb", pane.querySelector('[data-vocabulary-field="english"]')?.value || ""],
    ...["verbTransitivity", "verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5"]
      .map((field) => [field, pane.querySelector(`[data-vocabulary-esl-field="${field}"]`)?.value || ""]),
  ])

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
            } else message.textContent = data.autofillMessage || "No corpus match; saving remains allowed."
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
  if (workspace) new MutationObserver(() => { ensureReviewDocs(workspace); markDifferences(); bindMwFill(); bindLdoce(); bindOxford(); bindBritannica(); bindMerriamWebster(); bindDictionaryBuilder(); bindOriginAnalysis(); bindTransitivityTools(); bindReviewSidebar() }).observe(workspace, { childList: true, subtree: true })
  if (approvedEditor) new MutationObserver(() => { ensureReviewDocs(approvedEditor); bindMwFill(); bindLdoce(); bindOxford(); bindBritannica(); bindMerriamWebster(); bindDictionaryBuilder(); bindOriginAnalysis(); bindTransitivityTools() }).observe(approvedEditor, { childList: true, subtree: true })
  ensureReviewDocs(workspace)
  ensureReviewDocs(approvedEditor)
  bindMwFill()
  bindLdoce()
  bindOxford()
  bindBritannica()
  bindMerriamWebster()
  bindDictionaryBuilder()
  bindOriginAnalysis()
  bindTransitivityTools()
  bindReviewSidebar()
})()
