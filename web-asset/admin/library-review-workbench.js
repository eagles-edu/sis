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
  const SPEAKER_ICON_PATH = "/web-asset/icons/svg/speaker-red-usa.svg"
  let speakerAnimationId = 0

  const restartSpeakerAnimation = (image) => {
    const iconPath = image?.dataset.iconPath
    if (!iconPath) return
    speakerAnimationId += 1
    image.src = `${iconPath}?animation=${speakerAnimationId}`
  }

  const bindAudioControl = (root, row, dialect, label, sourceUrl, { local = false } = {}) => {
    if (!root || !row || !sourceUrl) return null
    const controlKey = row.dataset.libraryAudioRow || dialect
    const AUDIO_END_ANIMATION_GRACE_MS = 250
    const ICON_ANIMATION_CYCLE_MS = 1000
    let button = row.querySelector("[data-library-audio-trigger]")
    if (!button) {
      button = document.createElement("a")
      button.className = "library-audio-play"
      button.dataset.libraryAudioTrigger = dialect
      button.dataset.libraryAudioKey = controlKey
      button.href = sourceUrl
      button.setAttribute("aria-label", `Play ${label} pronunciation`)
      button.title = `Play ${label} pronunciation`
      const image = document.createElement("img")
      image.src = SPEAKER_ICON_PATH
      image.alt = `${label} speaker`
      image.dataset.iconPath = image.src
      button.append(image)
      row.append(button)
    }
    button.dataset.audioUrl = sourceUrl
    button.href = sourceUrl
    const image = button.querySelector("img")
    let audio = [...root.querySelectorAll("[data-library-preview-audio]")].find((candidate) => candidate.dataset.libraryPreviewAudio === controlKey)
    if (!audio) {
      audio = document.createElement("audio")
      audio.preload = "none"
      audio.hidden = true
      audio.dataset.libraryPreviewAudio = controlKey
      root.append(audio)
    }
    audio.src = sourceUrl
    if (local) audio.dataset.localLibraryMedia = "true"
    else delete audio.dataset.localLibraryMedia
    if (typeof audio.load === "function") audio.load()
    if (button.dataset.audioBound !== "true") {
      button.dataset.audioBound = "true"
      let animationLoopTimer = null
      let animationEndTimer = null
      const stopAnimationLoop = () => {
        if (animationLoopTimer !== null) window.clearInterval(animationLoopTimer)
        if (animationEndTimer !== null) window.clearTimeout(animationEndTimer)
        animationLoopTimer = null
        animationEndTimer = null
        button.classList.remove("is-playing")
      }
      const startAnimationLoop = () => {
        if (animationLoopTimer !== null) window.clearInterval(animationLoopTimer)
        if (animationEndTimer !== null) window.clearTimeout(animationEndTimer)
        animationEndTimer = null
        restartSpeakerAnimation(image)
        animationLoopTimer = window.setInterval(() => restartSpeakerAnimation(image), ICON_ANIMATION_CYCLE_MS)
      }
      const play = () => {
        button.classList.add("is-playing")
        startAnimationLoop()
        audio.currentTime = 0
        try {
          const playback = audio.play()
          if (playback?.catch) playback.catch(() => stopAnimationLoop())
        } catch {
          stopAnimationLoop()
        }
      }
      button.addEventListener("mouseenter", () => { if (animationLoopTimer === null) restartSpeakerAnimation(image) })
      button.addEventListener("focus", () => restartSpeakerAnimation(image))
      button.addEventListener("click", (event) => { event.preventDefault(); play() })
      audio.addEventListener("ended", () => {
        if (animationEndTimer !== null) window.clearTimeout(animationEndTimer)
        animationEndTimer = window.setTimeout(stopAnimationLoop, AUDIO_END_ANIMATION_GRACE_MS)
      })
      audio.addEventListener("pause", () => { if (!audio.ended) stopAnimationLoop() })
      audio.addEventListener("error", stopAnimationLoop)
    }
    return { button, audio }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-library-audio-trigger]")
    if (!button || button.dataset.audioBound === "true") return
    const audioKey = button.dataset.libraryAudioKey
    if (!audioKey) return
    const root = button.closest("[data-vocabulary-flat-entry], [data-review-pane], [data-vocabulary-editor], [data-approved-editor]") || document
    const audio = [...root.querySelectorAll("[data-library-preview-audio]")].find((candidate) => candidate.dataset.libraryPreviewAudio === audioKey)
    if (!audio) return
    event.preventDefault()
    const control = window.SIS_VOCABULARY_ESL?.bindLibraryAudioControl(button, audio)
    control?.play()
  }, true)

  const parseLibraryMediaAssets = (pane) => {
    try {
      const value = JSON.parse(pane?.dataset.libraryMediaAssets || "[]")
      return Array.isArray(value) ? value : []
    } catch {
      return []
    }
  }

  const hydrateLibraryAudio = (pane) => {
    if (!pane) return
    const assets = parseLibraryMediaAssets(pane).filter((asset) => asset?.id && asset.dialect === "us")
    if (!assets.length) return
    assets.forEach((asset) => {
      const slot = asset.slot || "headword"
      const editor = pane.querySelector(`[data-vocabulary-audio-editor="${CSS.escape(slot)}"]`)
      if (!editor) return
      const mediaUrl = `${window.__SIS_ADMIN_API_PREFIX || "/api/admin"}/library/media/${encodeURIComponent(asset.id)}`
      const pathInput = editor.querySelector('[data-vocabulary-audio-field$=".path"]')
      if (pathInput) pathInput.value = mediaUrl
      editor.dataset.libraryAudioRow = `${slot}:${asset.dialect}`
      bindAudioControl(pane, editor, asset.dialect, `${slot} ${asset.dialect.toUpperCase()}`, mediaUrl, { local: true })
    })
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
      const sourceField = input.dataset.reviewField || input.dataset.approvedField || input.dataset.vocabularyField || input.dataset.vocabularyEslField || input.dataset.vocabularyOriginField
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
          const nonEmptyMwFields = Object.fromEntries(Object.entries(data.fields || {}).filter(([field, value]) => !["originReferences", "originPath"].includes(field) && value !== null && value !== undefined && (typeof value !== "string" || value.trim())))
          const merged = { ...current, ...nonEmptyMwFields, ...(etymology ? { etymology } : {}), originPath: current.originPath || "", originReferences: mergedReferences }
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
        hydrateLibraryAudio(pane)
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
    ["audio", "Headword Audio"], ["verbFormAudio", "Verb Form Audio"], ["definition", "Definition Proper"], ["verbForms", "Verb Forms"], ["stems", "Stems"], ["synonymsAntonyms", "Synonyms / Antonyms"], ["examples", "Examples"], ["firstKnownUse", "First known use"], ["originPath", "Origin path"], ["etymology", "Etymology"],
  ]
  const dictionaryBuilderVerbOnlyDatums = new Set(["verbForms", "verbFormAudio"])
  const dictionaryBuilderPreferredProviders = Object.freeze({
    vietnamese: ["google_translate"], syllabication: ["wordhelp", "ldoce"], syllableCount: ["wordhelp"], grammarClassification: ["merriam_webster_api", "merriam_webster_scrape"],
    audio: ["britannica", "ldoce", "oxford_ame"], verbFormAudio: ["oxford_ame", "oxford_bre"], definition: ["britannica", "ldoce", "oxford_ame"], verbForms: ["merriam_webster_api", "oxford_ame"],
    stems: ["merriam_webster_api", "merriam_webster_scrape"], synonymsAntonyms: ["merriam_webster_thesaurus", "merriam_webster_scrape"], examples: ["britannica", "ldoce", "oxford_ame"],
    firstKnownUse: ["merriam_webster_api", "merriam_webster_scrape"], originPath: ["merriam_webster_api", "merriam_webster_scrape"], etymology: ["etymonline", "merriam_webster_api", "wiktionary"],
  })
  const dictionaryBuilderApplyFields = new Set(["vietnamese", "syllabication", "syllableCount", "grammarClassification", "audio", "verbFormAudio", "definition", "verbForms", "stems", "synonymsAntonyms", "examples", "verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5", "etymology", "originPath", "originReferences", "firstKnownUse"])
  const dictionaryBuilderDraftValue = (value) => {
    if (Array.isArray(value)) return value.some(dictionaryBuilderDraftValue)
    if (value && typeof value === "object") return Object.values(value).some(dictionaryBuilderDraftValue)
    return value !== undefined && value !== null && String(value).trim() !== ""
  }
  const applyDictionaryBuilderDraftSelections = (pane, selections, mode, isVerbEntry) => {
    const next = readPayload(pane)
    const changed = []
    const deferred = []
    const write = (field, value) => {
      if (!dictionaryBuilderDraftValue(value)) return false
      if (mode === "fill_missing" && dictionaryBuilderDraftValue(next[field])) return false
      next[field] = value
      changed.push(field)
      return true
    }
    Object.entries(selections).forEach(([field, selection]) => {
      const value = selection?.value
      if (!dictionaryBuilderApplyFields.has(field) || (!isVerbEntry && dictionaryBuilderVerbOnlyDatums.has(field))) return
      if (["audio", "verbFormAudio"].includes(field)) {
        deferred.push(field)
        return
      }
      if (field === "verbForms") {
        let forms = value
        try { forms = typeof value === "string" ? JSON.parse(value) : value } catch { forms = {} }
        Object.entries(forms && typeof forms === "object" && !Array.isArray(forms) ? forms : {}).forEach(([formField, formValue]) => {
          if (["verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5"].includes(formField)) write(formField, formValue)
        })
        return
      }
      if (field === "grammarClassification") {
        let classification = value
        try { classification = typeof value === "string" ? JSON.parse(value) : value } catch { classification = {} }
        if (!classification || typeof classification !== "object" || Array.isArray(classification)) return
        const current = next.grammarClassification && typeof next.grammarClassification === "object" ? next.grammarClassification : {}
        if (mode === "fill_missing" && dictionaryBuilderDraftValue(current)) return
        next.grammarClassification = { ...current, ...classification }
        changed.push(field)
        return
      }
      write(field, value)
    })
    window.SIS_VOCABULARY_ESL?.hydrate(pane, next, { preserveSyllabication: true })
    pane.querySelectorAll("[data-review-field]").forEach((input) => {
      const path = input.dataset.reviewField
      const value = path.split(".").reduce((current, key) => current && typeof current === "object" ? current[key] : "", next)
      if (value === undefined || value === null) return
      if (input.type === "checkbox") input.checked = Boolean(value)
      else input.value = typeof value === "object" ? JSON.stringify(value) : String(value)
    })
    pane.dataset.dictionaryBuilderDraft = JSON.stringify(next)
    return { changed: [...new Set(changed)], deferred: [...new Set(deferred)] }
  }
  const dictionaryBuilderStatusLabel = (status) => ({ not_found: "not found (HTTP 404)", not_provided: "not provided by source", robot_blocked: "cookie/robot prompt; datum paused", cookie_prompt: "cookie prompt; datum paused", robot_prompt: "robot prompt; datum paused", paused: "paused pending source resolution", waiting_for_input: "waiting for input", unavailable: "provider unavailable", not_offered: "not provided by source" }[status] || status)
  const isDictionaryBuilderPromptStatus = (status) => ["robot_blocked", "cookie_prompt", "robot_prompt", "paused", "waiting_for_input"].includes(status)
  const dictionaryBuilderEsc = (value) => String(value == null ? "" : value).replace(/[&<>'"]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character])
  const dictionaryBuilderSourceMatrix = (word) => {
    const encoded = encodeURIComponent(String(word || "").trim())
    const links = [
      ["LD", `https://www.ldoceonline.com/dictionary/${encoded}`], ["OA", `https://www.oxfordlearnersdictionaries.com/definition/american_english/${encoded}`], ["OB", `https://www.oxfordlearnersdictionaries.com/definition/english/${encoded}`], ["BR", `https://www.britannica.com/dictionary/${encoded}`],
      ["MW", `https://www.merriam-webster.com/dictionary/${encoded}`], ["AP", `https://www.merriam-webster.com/dictionary/${encoded}`], ["ET", `https://www.etymonline.com/search?q=${encoded}`], ["WK", `https://en.wiktionary.org/w/index.php?search=${encoded}`],
      ["CA", `https://dictionary.cambridge.org/dictionary/english/${encoded}`], ["TH", `https://www.merriam-webster.com/thesaurus/${encoded}`], ["WH", `https://www.wordhelp.com/syllables/english/?q=${encoded}`], ["GT", `https://translate.google.com/?sl=en&tl=vi&text=${encoded}&op=translate`],
    ]
    return `<div class="news-vocabulary-lookups dictionary-builder-source-matrix" data-dictionary-builder-source-matrix role="group" aria-label="Twelve outbound Dictionary Builder source links">${links.map(([label, href]) => `<a class="portal-button portal-button-blue-action news-vocabulary-lookup dictionary-builder-source-link" data-vocabulary-lookup="${label}" data-dictionary-builder-source-link="${label}" href="${href}" target="_blank" rel="noopener noreferrer" title="Open ${label}; this does not apply data.">${label}</a>`).join("")}</div>`
  }
  const dictionaryBuilderDialog = () => {
    let dialog = document.getElementById("libraryDictionaryBuilderDialog")
    if (!dialog) {
      dialog = document.createElement("dialog")
      dialog.id = "libraryDictionaryBuilderDialog"
      dialog.className = "portal-modal"
      dialog.setAttribute("aria-labelledby", "libraryDictionaryBuilderTitle")
      dialog.innerHTML = `<form method="dialog" class="library-dictionary-builder-form"><header class="library-dictionary-builder-header"><div data-dictionary-builder-source-matrix-slot></div><div class="library-dictionary-builder-header-main"><h2 id="libraryDictionaryBuilderTitle" data-dictionary-builder-tab-heading></h2><p class="small" data-dictionary-builder-section-summary aria-live="polite"></p><p class="small" data-dictionary-builder-message aria-live="polite"></p></div><button type="submit" class="portal-button portal-button-neutral-action" aria-label="Close Dictionary Builder">Close</button></header><details open class="dictionary-builder-acquisition-log"><summary>Acquisition log</summary><pre data-dictionary-builder-log aria-live="polite"></pre></details><div data-dictionary-builder-root></div></form>`
      document.body.append(dialog)
    }
    return dialog
  }
  const hasDictionaryBuilderValue = (value) => {
    if (Array.isArray(value)) return value.some(hasDictionaryBuilderValue)
    if (value && typeof value === "object") return Object.values(value).some(hasDictionaryBuilderValue)
    return value !== undefined && value !== null && String(value).trim() !== ""
  }
  const candidatesForDatum = (snapshot, datum) => {
    const preferred = dictionaryBuilderPreferredProviders[datum] || []
    const sources = (snapshot.sources || []).filter((source) => datum !== "originPath" || preferred.includes(source.provider))
    const order = [...preferred, ...(snapshot.datumSourceOrder?.[datum] || [])].filter((provider, index, providers) => providers.indexOf(provider) === index)
    const ordered = sources.filter((source) => {
      if (datum === "vietnamese" && source.provider !== "google_translate") return false
      const status = source.datumStatus?.[datum]?.status
      return isDictionaryBuilderPromptStatus(status) || (status === "available" && hasDictionaryBuilderValue(source.fields?.[datum]))
    }).sort((left, right) => {
      const leftPosition = order.indexOf(left.provider); const rightPosition = order.indexOf(right.provider)
      return (leftPosition < 0 ? Number.MAX_SAFE_INTEGER : leftPosition) - (rightPosition < 0 ? Number.MAX_SAFE_INTEGER : rightPosition)
    })
    const mandatory = datum === "audio" ? "britannica" : datum === "verbFormAudio" ? "oxford_ame" : datum === "synonymsAntonyms" ? "merriam_webster_thesaurus" : datum === "syllabication" ? "wordhelp" : ""
    const mandatorySource = mandatory ? sources.find((source) => source.provider === mandatory) : null
    const available = ordered.filter((source) => source.datumStatus?.[datum]?.status === "available").slice(0, 3)
    const robotBlocked = ordered.filter((source) => isDictionaryBuilderPromptStatus(source.datumStatus?.[datum]?.status))
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
  const promptProbeTimers = new Map()
  const sourceBrowserTabs = new Map()
  const INITIAL_SOURCE_GROUP_SIZE = 6
  const INITIAL_SOURCE_PROVIDER_ORDER = ["britannica", "ldoce", "wordhelp", "etymonline", "merriam_webster_thesaurus", "oxford_ame"]
  const INITIAL_SOURCE_LED_ORDER = ["britannica", "ldoce", "wordhelp", "etymonline", "merriam_webster_thesaurus", "oxford_ame"]
  const INITIAL_SOURCE_LED_LABELS = Object.freeze({ britannica: "BR", ldoce: "LD", wordhelp: "WH", etymonline: "ET", merriam_webster_thesaurus: "TH", oxford_ame: "OA" })
  const sourceLedOverrides = new WeakMap()
  const dictionaryBuilderPreloadStates = new WeakMap()
  const initialSourceUrl = (provider, word) => {
    const encoded = encodeURIComponent(String(word || "").trim())
    const paths = {
      britannica: `https://www.britannica.com/dictionary/${encoded}`,
      oxford_ame: `https://www.oxfordlearnersdictionaries.com/definition/american_english/${encoded}`,
      ldoce: `https://www.ldoceonline.com/dictionary/${encoded}`,
      wordhelp: `https://www.wordhelp.com/syllables/english/?q=${encoded}`,
      etymonline: `https://www.etymonline.com/search?q=${encoded}`,
      merriam_webster_thesaurus: `https://www.merriam-webster.com/thesaurus/${encoded}`,
      merriam_webster_scrape: `https://www.merriam-webster.com/dictionary/${encoded}`,
      merriam_webster_api: `https://www.merriam-webster.com/dictionary/${encoded}`,
    }
    return paths[provider] || ""
  }
  const providerTabName = (provider) => `sis-dictionary-builder-${provider}`
  const openProviderTabDuringGesture = (provider, sourceUrl = "about:blank") => {
    const target = providerTabName(provider)
    return window.open(sourceUrl, target)
  }
  const reserveInitialSourceTabs = (word) => {
    const reserved = new Map()
    const blocked = []
    INITIAL_SOURCE_PROVIDER_ORDER.forEach((provider) => {
      const existing = sourceBrowserTabs.get(provider)
      if (existing && !existing.closed) { reserved.set(provider, existing); return }
      const tab = openProviderTabDuringGesture(provider, initialSourceUrl(provider, word))
      if (tab) { sourceBrowserTabs.set(provider, tab); reserved.set(provider, tab) }
      else blocked.push(provider)
    })
    return { reserved, blocked, word }
  }
  const navigateInitialSourceTabs = (reservation, sources = []) => {
    const sourceByProvider = new Map(sources.map((source) => [source.provider, source.sourceUrl]).filter(([, sourceUrl]) => sourceUrl))
    const navigations = []
    reservation?.reserved?.forEach((tab, provider) => {
      const sourceUrl = sourceByProvider.get(provider) || initialSourceUrl(provider, reservation.word)
      if (sourceUrl && tab) navigations.push({ tab, sourceUrl })
    })
    navigations.forEach(({ tab, sourceUrl }, index) => {
      window.setTimeout(() => { if (!tab.closed) tab.location.href = sourceUrl }, index * 1000)
    })
  }
  const closeSourceBrowserTabs = () => {
    promptProbeTimers.forEach((timer) => window.clearInterval(timer))
    promptProbeTimers.clear()
    sourceBrowserTabs.forEach((tab) => { if (tab && !tab.closed) tab.close() })
    sourceBrowserTabs.clear()
    robotHandoffTabs.clear()
  }
  const sourceLedOverridesFor = (container) => {
    if (!container) return null
    let overrides = sourceLedOverrides.get(container)
    if (!overrides) {
      overrides = new Map()
      sourceLedOverrides.set(container, overrides)
    }
    return overrides
  }
  const sourceStatusForSnapshot = (provider, snapshot) => {
    if (!snapshot) return "default"
    const source = (snapshot?.sources || []).find((candidate) => candidate.provider === provider || (provider === "merriam_webster_scrape" && candidate.provider === "merriam_webster"))
    const status = source?.status || source?.datumStatus && Object.values(source.datumStatus).find((datum) => datum?.status && datum.status !== "not_offered")?.status
    if (status === "available") return "success"
    if (["waiting_for_input", "manual", "robot_blocked", "cookie_prompt", "robot_prompt", "blocked"].includes(status)) return "popup-blocking"
    if (["not_found", "unavailable", "unsupported", "invalid"].includes(status)) return "not-found"
    return "not-found"
  }
  const sourceStatusForLed = (provider, snapshot, container) => {
    const override = sourceLedOverrides.get(container)?.get(provider)
    return override || sourceStatusForSnapshot(provider, snapshot)
  }
  const renderSourceLeds = (snapshot, container) => {
    if (!container) return
    container.replaceChildren(...INITIAL_SOURCE_LED_ORDER.map((provider) => {
      const led = document.createElement("span")
      const status = sourceStatusForLed(provider, snapshot, container)
      led.className = "dictionary-builder-source-led"
      led.dataset.sourceProvider = provider
      led.dataset.sourceStatus = status
      led.textContent = INITIAL_SOURCE_LED_LABELS[provider]
      led.setAttribute("aria-label", `${INITIAL_SOURCE_LED_LABELS[provider]} status: ${status === "success" ? "ready" : status === "not-found" ? "404, not found, or unavailable" : status === "popup-blocking" ? "awaiting user input" : status === "opening" ? "opening" : "not checked"}`)
      return led
    }))
  }
  const setSourceLedStatus = (provider, status, snapshot, container) => {
    sourceLedOverridesFor(container)?.set(provider, status)
    renderSourceLeds(snapshot, container)
  }
  const clearSourceLedOverrides = (container) => {
    sourceLedOverrides.get(container)?.clear()
  }
  const applySourceSnapshotToLeds = (snapshot, container, blockedProviders = []) => {
    if (!container) return
    const blocked = new Set(blockedProviders)
    INITIAL_SOURCE_LED_ORDER.forEach((provider) => {
      const status = blocked.has(provider) ? "popup-blocking" : sourceStatusForSnapshot(provider, snapshot)
      setSourceLedStatus(provider, status, snapshot, container)
    })
  }
  const reusableDictionaryBuilderPreloadSnapshot = (pane, sourceId, word) => {
    const state = dictionaryBuilderPreloadStates.get(pane)
    return state?.sourceId === sourceId && state.word === word && state.snapshot && sourceBrowserTabs.size === INITIAL_SOURCE_GROUP_SIZE
      ? state.snapshot
      : null
  }
  const previewDictionaryBuilderForEditor = async (pane, container, sourceId, word, blockedProviders) => {
    const previous = dictionaryBuilderPreloadStates.get(pane)
    if (previous?.sourceId === sourceId && previous.word === word && previous.snapshot) return previous.snapshot
    if (previous?.sourceId === sourceId && previous.word === word && previous.promise && !previous.settled) return previous.promise
    const token = Symbol("dictionary-builder-preload")
    const state = { sourceId, word, token, promise: null, snapshot: null }
    dictionaryBuilderPreloadStates.set(pane, state)
    state.promise = (async () => {
      try {
        if (!sourceId) throw new Error("Save the canonical Library entry before preloading source status.")
        const response = await fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/dictionary-builder/preview`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: readPayload(pane) }) })
        const snapshot = await response.json()
        if (!response.ok || !snapshot.ok) throw new Error(snapshot.error || "Dictionary Builder source status is unavailable.")
        if (dictionaryBuilderPreloadStates.get(pane)?.token !== token) return snapshot
        state.snapshot = snapshot
        applySourceSnapshotToLeds(snapshot, container, blockedProviders)
        return snapshot
      } catch (error) {
        if (dictionaryBuilderPreloadStates.get(pane)?.token === token) {
          INITIAL_SOURCE_LED_ORDER.forEach((provider) => setSourceLedStatus(provider, "not-found", null, container))
        }
        throw error
      } finally {
        state.settled = true
      }
    })()
    return state.promise
  }
  const bindEditorSourceStartup = (pane) => {
    const startup = pane?.querySelector("[data-dictionary-builder-open-sources]")
    const container = pane?.querySelector("[data-dictionary-builder-source-leds]")
    if (!startup || startup.dataset.dictionaryBuilderSourcesBound === "true") return
    startup.dataset.dictionaryBuilderSourcesBound = "true"
    renderSourceLeds(null, container)
    startup.addEventListener("click", async () => {
      const word = pane.querySelector('[data-vocabulary-field="english"]')?.value || ""
      const sourceId = pane.dataset.reviewSourceId || pane.dataset.approvedEntryId
      const message = pane.querySelector("[data-vocabulary-dictionary-builder-message]")
      const reusableSnapshot = reusableDictionaryBuilderPreloadSnapshot(pane, sourceId, word)
      if (reusableSnapshot) {
        clearSourceLedOverrides(container)
        applySourceSnapshotToLeds(reusableSnapshot, container)
        if (message) message.textContent = "Source status ready."
        return
      }
      clearSourceLedOverrides(container)
      INITIAL_SOURCE_PROVIDER_ORDER.forEach((provider) => setSourceLedStatus(provider, "opening", null, container))
      const reservation = reserveInitialSourceTabs(word)
      navigateInitialSourceTabs(reservation)
      reservation.blocked.forEach((provider) => setSourceLedStatus(provider, "popup-blocking", null, container))
      startup.disabled = true
      startup.setAttribute("aria-busy", "true")
      if (message) message.textContent = "Preloading source status; LEDs remain amber until each provider resolves."
      try {
        await previewDictionaryBuilderForEditor(pane, container, sourceId, word, reservation.blocked)
        if (message) message.textContent = "Source status ready."
      } catch (error) {
        if (message) message.textContent = error.message || "Source status unavailable."
      } finally {
        startup.disabled = false
        startup.removeAttribute("aria-busy")
      }
    })
  }
  const renderDictionaryBuilder = (snapshot, pane, sourceId, previousSelections = {}, activeTab = "vietnamese", initialReservation = null, { autoRetry = true } = {}) => {
    const dialog = dictionaryBuilderDialog()
    const root = dialog.querySelector("[data-dictionary-builder-root]")
    const sourceMatrixSlot = dialog.querySelector("[data-dictionary-builder-source-matrix-slot]")
    const acquisitionLog = dialog.querySelector("[data-dictionary-builder-log]")
    const word = pane.querySelector('[data-vocabulary-field="english"]')?.value || ""
    const isVerbEntry = String(pane.querySelector('[data-vocabulary-field="partOfSpeech"]')?.value || "").trim().toLowerCase() === "verb"
    const visibleDictionaryBuilderFields = dictionaryBuilderFields.filter(([datum]) => isVerbEntry || !dictionaryBuilderVerbOnlyDatums.has(datum))
    const visibleDictionaryBuilderDatums = new Set(visibleDictionaryBuilderFields.map(([datum]) => datum))
    const selectedTab = visibleDictionaryBuilderDatums.has(activeTab) ? activeTab : visibleDictionaryBuilderFields[0]?.[0] || "vietnamese"
    const tabs = visibleDictionaryBuilderFields.map(([datum, label], index) => `<button type="button" class="dictionary-builder-tab" id="dictionary-builder-tab-${datum}" role="tab" aria-controls="dictionary-builder-panel-${datum}" aria-selected="${datum === selectedTab}" tabindex="${datum === selectedTab ? 0 : -1}" data-dictionary-builder-tab="${datum}"><span class="dictionary-builder-tab-step">${index + 1}</span><span>${dictionaryBuilderEsc(label)}</span></button>`).join("")
    sourceMatrixSlot.innerHTML = dictionaryBuilderSourceMatrix(word)
    const draftOnly = sourceId === "new-canonical"
    if (acquisitionLog) acquisitionLog.textContent = snapshot.acquisitionLog || "No acquisition log was returned."
    root.innerHTML = `<div class="dictionary-builder-tabs" role="tablist" aria-label="Dictionary Builder sections">${tabs}</div><div data-dictionary-builder-panels></div><div class="library-dictionary-preview-actions"><div class="dictionary-builder-source-startup-row"><button type="button" class="portal-button portal-button-blue-action portal-button-compact dictionary-builder-source-startup" data-dictionary-builder-open-sources title="Open the initial source group: BR / AP / LD / WH / ET / TH / OA. AP is API-only and remains closed." aria-label="Open initial source group">Open sources</button><div class="dictionary-builder-source-status-block"><div class="dictionary-builder-source-leds" data-dictionary-builder-source-leds role="group" aria-label="Initial source status LEDs"></div><div class="dictionary-builder-source-led-legend" aria-label="Source LED legend"><span><i data-led-legend="default" aria-hidden="true"></i>Not checked</span><span><i data-led-legend="not-found" aria-hidden="true"></i>404 / unavailable</span><span><i data-led-legend="opening" aria-hidden="true"></i>Opening</span><span><i data-led-legend="popup-blocking" aria-hidden="true"></i>Awaiting input</span><span><i data-led-legend="success" aria-hidden="true"></i>Ready</span></div></div></div><select data-dictionary-builder-mode aria-label="Dictionary Builder apply mode"><option value="fill_missing">Fill missing</option><option value="replace_selected">Replace selected</option><option value="replace_all">Replace all</option></select><button type="button" class="portal-button portal-button-affirm" data-dictionary-builder-apply title="${draftOnly ? "Apply selected data to this editable draft; save the canonical entry to persist it." : "Apply selected Dictionary Builder data to this saved Library entry."}">Apply selected</button></div><div data-dictionary-builder-popup-fallbacks hidden></div>`
    const sourceLedContainer = root.querySelector("[data-dictionary-builder-source-leds]")
    renderSourceLeds(snapshot, sourceLedContainer)
    const panels = root.querySelector("[data-dictionary-builder-panels]")
    const selectedCandidates = Object.fromEntries(Object.entries(structuredClone(previousSelections)).filter(([datum]) => visibleDictionaryBuilderDatums.has(datum)))
    visibleDictionaryBuilderFields.forEach(([datum]) => {
      if (selectedCandidates[datum]) return
      const candidate = candidatesForDatum(snapshot, datum).find((item) => item.datumStatus?.[datum]?.status === "available")
      if (!candidate || !hasDictionaryBuilderValue(candidate.fields?.[datum])) return
      selectedCandidates[datum] = {
        provider: candidate.provider,
        value: typeof candidate.fields[datum] === "object" ? JSON.stringify(candidate.fields[datum]) : String(candidate.fields[datum]),
        status: candidate.datumStatus?.[datum]?.status || "available",
      }
    })
    const showPopupFallbackLinks = (blockedProviders, sourceByProvider) => {
      const fallback = root.querySelector("[data-dictionary-builder-popup-fallbacks]")
      if (!fallback) return
      fallback.replaceChildren()
      if (!blockedProviders.length) { fallback.hidden = true; return }
      fallback.hidden = false
      const label = document.createElement("span")
      label.textContent = "Popup blocked; open manually:"
      fallback.append(label)
      blockedProviders.forEach((provider) => {
        const link = document.createElement("a")
        link.className = "dictionary-builder-candidate-source"
        link.href = sourceByProvider.get(provider)?.sourceUrl || initialSourceUrl(provider, word)
        link.target = "_blank"
        link.rel = "noopener noreferrer"
        link.textContent = provider
        link.title = `Open the ${provider} source page manually; this does not apply data.`
        fallback.append(link)
      })
    }
    const openInitialSourceGroup = () => {
      const sourceByProvider = new Map((snapshot.sources || []).map((source) => [source.provider, source]))
      INITIAL_SOURCE_PROVIDER_ORDER.forEach((provider) => setSourceLedStatus(provider, "opening", snapshot, sourceLedContainer))
      const initialSourceEntries = INITIAL_SOURCE_PROVIDER_ORDER.map((provider) => ({
        provider,
        sourceUrl: sourceByProvider.get(provider)?.sourceUrl || initialSourceUrl(provider, word),
      })).filter(({ sourceUrl }) => sourceUrl)
      let opened = 0
      const pendingNavigations = []
      initialSourceEntries.forEach(({ provider, sourceUrl }) => {
        const existing = sourceBrowserTabs.get(provider)
        if (existing && !existing.closed) { existing.focus?.(); opened += 1; return }
        const tab = openProviderTabDuringGesture(provider, sourceUrl)
        if (tab) {
          sourceBrowserTabs.set(provider, tab)
          pendingNavigations.push({ tab, sourceUrl })
          opened += 1
        }
      })
      pendingNavigations.forEach(({ tab, sourceUrl }) => { tab.location.href = sourceUrl })
      const blockedProviders = initialSourceEntries.filter(({ provider }) => !sourceBrowserTabs.has(provider)).map(({ provider }) => provider)
      blockedProviders.forEach((provider) => setSourceLedStatus(provider, "popup-blocking", snapshot, sourceLedContainer))
      initialSourceEntries.filter(({ provider }) => !blockedProviders.includes(provider)).forEach(({ provider }) => {
        window.setTimeout(() => {
          sourceLedOverrides.get(sourceLedContainer)?.delete(provider)
          renderSourceLeds(snapshot, sourceLedContainer)
        }, 1200)
      })
      showPopupFallbackLinks(blockedProviders, sourceByProvider)
      dialog.querySelector("[data-dictionary-builder-message]").textContent = opened === initialSourceEntries.length
        ? `Initial BR / AP / LD / WH / ET / TH / OA group opened as named tabs in this browser session. AP is API-only and remains closed. Resolve any cookie/robot prompts; affected datums remain paused until Retry provider. Cookies remain in the browser's native cookie jar.`
        : `Opened ${opened} of ${initialSourceEntries.length} initial provider tabs in this browser session; blocked providers: ${blockedProviders.join(", ") || "unknown"}. Use the manual links below. AP is API-only; fallback providers stay closed until needed.`
    }
    root.querySelector("[data-dictionary-builder-open-sources]").addEventListener("click", openInitialSourceGroup)
    if (initialReservation) {
      navigateInitialSourceTabs(initialReservation, snapshot.sources || [])
      const reservationMessage = dialog.querySelector("[data-dictionary-builder-message]")
      if (reservationMessage) reservationMessage.textContent = initialReservation.blocked.length
        ? `Opened ${initialReservation.reserved.size} of ${INITIAL_SOURCE_GROUP_SIZE} initial provider tabs; blocked providers: ${initialReservation.blocked.join(", ")}. Use the manual links below; affected datums remain waiting for input.`
        : `Opened ${initialReservation.reserved.size} of ${INITIAL_SOURCE_GROUP_SIZE} initial provider tabs in order BR / AP / LD / WH / ET / TH / OA. AP is API-only; resolve cookie/robot prompts in those tabs; cookies remain active for this Builder session.`
      showPopupFallbackLinks(initialReservation.blocked, new Map((snapshot.sources || []).map((source) => [source.provider, source])))
    }
    const updateTabSelection = (datum) => {
      const tab = root.querySelector(`[data-dictionary-builder-tab="${datum}"]`)
      tab?.classList.toggle("is-complete", Boolean(selectedCandidates[datum]?.value))
    }
    const hasAvailablePreferredDatum = (currentSnapshot, datum) => (dictionaryBuilderPreferredProviders[datum] || []).some((provider) => {
      const source = (currentSnapshot.sources || []).find((candidate) => candidate.provider === provider)
      const value = source?.fields?.[datum]
      return source?.datumStatus?.[datum]?.status === "available" && hasDictionaryBuilderValue(value)
    })
    const hasAvailableRequiredPreferredDatum = (currentSnapshot, datum) => {
      const requiredProvider = { etymology: "etymonline", synonymsAntonyms: "merriam_webster_thesaurus" }[datum]
      if (!requiredProvider) return hasAvailablePreferredDatum(currentSnapshot, datum)
      const source = (currentSnapshot.sources || []).find((candidate) => candidate.provider === requiredProvider)
      return source?.datumStatus?.[datum]?.status === "available" && hasDictionaryBuilderValue(source.fields?.[datum])
    }
    const retryMissingPreferredDatums = async () => {
      if (sourceId === "new-canonical" || !dialog.open) return
      let refreshed = snapshot
      let changed = false
      const applicableDatums = visibleDictionaryBuilderFields.map(([datum]) => datum)
      for (const datum of applicableDatums) {
        if (hasAvailableRequiredPreferredDatum(refreshed, datum)) continue
        for (const provider of dictionaryBuilderPreferredProviders[datum] || []) {
          if (!dialog.open) return
          try {
            const response = await fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/dictionary-builder/previews/${encodeURIComponent(refreshed.id)}/retry`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, datum, entry: readPayload(pane) }) })
            const next = await response.json()
            if (!response.ok || !next.ok) continue
            refreshed = next
            changed = true
            if (hasAvailableRequiredPreferredDatum(refreshed, datum)) break
          } catch {}
        }
      }
      const currentActiveTab = root.querySelector('[data-dictionary-builder-tab][aria-selected="true"]')?.dataset.dictionaryBuilderTab || activeTab
      if (changed && dialog.open) renderDictionaryBuilder(refreshed, pane, sourceId, structuredClone(selectedCandidates), currentActiveTab, null, { autoRetry: false })
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
      const visibleStatusSources = datum === "synonymsAntonyms"
        ? statusSources.filter((source) => source.datumStatus?.[datum]?.status !== "not_provided")
        : statusSources
      const statuses = visibleStatusSources.map((source) => `${source.provider}: ${dictionaryBuilderStatusLabel(source.datumStatus?.[datum]?.status || "not_offered")}`).join(" · ")
      const robotSource = visibleStatusSources.find((source) => isDictionaryBuilderPromptStatus(source.datumStatus?.[datum]?.status) || isDictionaryBuilderPromptStatus(source.status))
      const sectionSummary = dialog.querySelector("[data-dictionary-builder-section-summary]")
      const datumLabel = visibleDictionaryBuilderFields.find(([key]) => key === datum)?.[1] || datum
      const tabHeading = dialog.querySelector("[data-dictionary-builder-tab-heading]")
      if (tabHeading) tabHeading.textContent = datumLabel
      if (sectionSummary) sectionSummary.textContent = robotSource
        ? `Queried: ${statuses || "no applicable source"}. Cookie/robot prompt required for ${robotSource.provider}; this datum is paused. Resolve it in the opened source tab and leave it open while Builder probes automatically.`
        : `Queried: ${statuses || "no applicable source"}.`
      panels.replaceChildren()
      const section = document.createElement("section")
      section.className = "dictionary-builder-candidates"
      section.id = `dictionary-builder-panel-${datum}`
      section.setAttribute("role", "tabpanel")
      section.setAttribute("aria-labelledby", `dictionary-builder-tab-${datum}`)
      const preferredProviders = dictionaryBuilderPreferredProviders[datum] || []
      const retryPreferred = document.createElement("button")
      retryPreferred.type = "button"
      retryPreferred.className = "portal-button portal-button-blue-action"
      retryPreferred.textContent = "Retry preferred"
      retryPreferred.title = `Wait 5 seconds, then check the saved snapshot first and retry ${preferredProviders.join(", ")} for ${datum}.`
      retryPreferred.setAttribute("aria-label", `Retry preferred sources for ${datum}`)
      retryPreferred.addEventListener("click", async () => {
        retryPreferred.disabled = true
        retryPreferred.textContent = "Waiting..."
        await new Promise((resolve) => window.setTimeout(resolve, 5000))
        let refreshed = snapshot
        try {
          for (const provider of preferredProviders) {
            const response = await fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/dictionary-builder/previews/${encodeURIComponent(snapshot.id)}/retry`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, datum, entry: readPayload(pane) }) })
            const data = await response.json()
            if (response.ok && data.ok) refreshed = data
          }
          renderDictionaryBuilder(refreshed, pane, sourceId, structuredClone(selectedCandidates), datum, null, { autoRetry: false })
        } catch (error) {
          dialog.querySelector("[data-dictionary-builder-message]").textContent = error.message || "Preferred source retry failed."
        } finally {
          retryPreferred.disabled = false
          retryPreferred.textContent = "Retry preferred"
        }
      })
      section.append(retryPreferred)
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
      const relationParts = (value) => {
        const parts = { synonyms: [], antonyms: [] }
        let section = "synonyms"
        String(value == null ? "" : value).split(/\r?\n/u).forEach((line) => {
          const clean = line.trim()
          const heading = clean.replace(/[:*]/gu, "").toLocaleLowerCase("en-US")
          if (heading === "synonyms" || heading === "antonyms") { section = heading; return }
          const item = clean.replace(/^[-*]\s+/u, "").trim()
          if (item) parts[section].push(item)
        })
        return parts
      }
      const relationValue = (fields) => [
        fields.synonyms.trim() ? `Synonyms:\n${fields.synonyms.trim()}` : "",
        fields.antonyms.trim() ? `Antonyms:\n${fields.antonyms.trim()}` : "",
      ].filter(Boolean).join("\n\n")
      const relationInputs = (value, provider, onChange) => {
        const fields = document.createElement("div")
        fields.className = "dictionary-builder-relation-fields"
        const initial = relationParts(value)
        const inputs = {}
        ;[["synonyms", "Synonyms"], ["antonyms", "Antonyms"]].forEach(([key, label]) => {
          const wrapper = document.createElement("label")
          wrapper.textContent = label
          const input = document.createElement("textarea")
          input.dataset.dictionaryBuilderRelation = key
          input.dataset.dictionaryBuilderProvider = provider
          input.placeholder = `Paste ${label.toLocaleLowerCase("en-US")} separated by new lines`
          input.value = initial[key].join("\n")
          input.addEventListener("focus", onChange)
          input.addEventListener("input", onChange)
          wrapper.append(input)
          fields.append(wrapper)
          inputs[key] = input
        })
        return { fields, value: () => relationValue({ synonyms: inputs.synonyms.value, antonyms: inputs.antonyms.value }) }
      }
      candidates.forEach((candidate) => {
        const label = document.createElement("label")
        const candidateStatus = candidate.datumStatus?.[datum]?.status || "available"
        label.className = `dictionary-builder-candidate${isDictionaryBuilderPromptStatus(candidateStatus) ? " dictionary-builder-candidate-robot" : ""}`
        const radio = document.createElement("input")
        radio.type = "radio"
        radio.name = `dictionary-builder-${datum}`
        radio.value = candidate.provider
        radio.checked = selectedCandidates[datum]?.provider === candidate.provider
        const title = document.createElement("strong")
        title.textContent = isDictionaryBuilderPromptStatus(candidateStatus) ? `${candidate.provider} — cookie/robot prompt; paused` : candidate.provider
        if (datum === "audio" || datum === "verbFormAudio") {
          const audioValues = candidate.fields?.[datum]
          const fileNames = datum === "audio"
            ? (Array.isArray(audioValues) ? audioValues.map((item) => item?.fileName).filter(Boolean) : [])
            : (audioValues && typeof audioValues === "object" ? Object.values(audioValues).map((item) => item?.fileName).filter(Boolean) : [])
          const audioStatus = document.createElement("span")
          audioStatus.className = "dictionary-builder-audio-file-status"
          audioStatus.textContent = fileNames.length ? `Live file: ${fileNames.join(", ")}` : "No live file"
          label.append(title, audioStatus)
        } else label.append(title)
        const candidateValue = isDictionaryBuilderPromptStatus(candidateStatus) ? "" : typeof candidate.fields[datum] === "object" ? JSON.stringify(candidate.fields[datum]) : String(candidate.fields[datum] || "")
        label.append(radio)
        if (datum === "synonymsAntonyms") {
          const relation = relationInputs(radio.checked ? selectedCandidates[datum].value : candidateValue, candidate.provider, () => {
            radio.checked = true
            selectedCandidates[datum] = { provider: candidate.provider, value: relation.value(), status: candidateStatus }
            updateTabSelection(datum)
            sizeDictionaryBuilderTextareas(candidateList)
          })
          label.append(relation.fields)
          radio.addEventListener("change", () => { selectedCandidates[datum] = { provider: candidate.provider, value: relation.value(), status: candidateStatus }; updateTabSelection(datum) })
        } else {
          const input = document.createElement("textarea")
          input.value = radio.checked ? selectedCandidates[datum].value : candidateValue
          input.placeholder = isDictionaryBuilderPromptStatus(candidateStatus) ? "Resolve the cookie/robot prompt, then enter the verified value here." : ""
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
          label.append(input)
        }
        const sourceLink = appendSourceLink(label, candidate.provider, candidate.sourceUrl)
        if (isDictionaryBuilderPromptStatus(candidateStatus)) {
          const retry = document.createElement("button")
          retry.type = "button"
          retry.className = "portal-button portal-button-blue-action"
          retry.textContent = "Retry provider"
          retry.title = `Retry ${candidate.provider} after resolving its cookie/robot prompt.`
          retry.setAttribute("aria-label", `Retry ${candidate.provider} after resolving its cookie/robot prompt`)
          const probeKey = `${snapshot.id}:${candidate.provider}:${datum}`
          let retryInFlight = false
          const stopPromptProbe = () => {
            const timer = promptProbeTimers.get(probeKey)
            if (timer) window.clearInterval(timer)
            promptProbeTimers.delete(probeKey)
          }
          const retryProvider = async ({ automatic = false } = {}) => {
            if (retryInFlight) return false
            retryInFlight = true
            if (!automatic) {
              retry.disabled = true
              retry.textContent = "Retrying..."
            }
            try {
              const response = await fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/dictionary-builder/previews/${encodeURIComponent(snapshot.id)}/retry`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: candidate.provider, datum, entry: readPayload(pane) }) })
              const refreshed = await response.json()
              if (!response.ok || !refreshed.ok) throw new Error(refreshed.error || "Provider retry failed.")
              const refreshedSource = refreshed.sources?.find((source) => source.provider === candidate.provider)
              const refreshedStatus = refreshedSource?.datumStatus?.[datum]?.status || refreshedSource?.status
              const refreshedValue = refreshedSource?.fields?.[datum]
              const datumReady = refreshedStatus === "available" && hasDictionaryBuilderValue(refreshedValue)
              if (automatic && !datumReady) return false
              stopPromptProbe()
              renderDictionaryBuilder(refreshed, pane, sourceId, structuredClone(selectedCandidates), datum, null, { autoRetry: false })
              return true
            } catch (error) {
              if (!automatic) {
                retry.disabled = false
                retry.textContent = "Retry provider"
                dialog.querySelector("[data-dictionary-builder-message]").textContent = error.message || "Provider retry failed."
              }
              return false
            } finally {
              retryInFlight = false
              if (!automatic && dialog.querySelector("[data-dictionary-builder-root]")) {
                retry.disabled = false
                retry.textContent = "Retry provider"
              }
            }
          }
          retry.addEventListener("click", async (event) => {
            event.preventDefault()
            event.stopPropagation()
            await retryProvider()
          })
          label.append(retry)
          const openChallengeTab = () => {
            const existing = robotHandoffTabs.get(candidate.provider) || sourceBrowserTabs.get(candidate.provider)
            if (existing && !existing.closed) {
              robotHandoffTabs.set(candidate.provider, existing)
              sourceBrowserTabs.set(candidate.provider, existing)
              existing.focus?.()
            } else {
              const challengeTab = window.open(candidate.sourceUrl, providerTabName(candidate.provider))
              if (!challengeTab) {
                dialog.querySelector("[data-dictionary-builder-message]").textContent = `The ${candidate.provider} source tab was blocked. Open the source link and use Retry provider as the fallback probe.`
                return null
              }
              robotHandoffTabs.set(candidate.provider, challengeTab)
              sourceBrowserTabs.set(candidate.provider, challengeTab)
            }
            dialog.querySelector("[data-dictionary-builder-message]").textContent = `Complete the ${candidate.provider} cookie/robot prompt in the new tab. Leave it open; Builder will probe the live page automatically. Retry provider remains available as a fallback.`
            stopPromptProbe()
            const challengeTab = robotHandoffTabs.get(candidate.provider)
            const probeTimer = window.setInterval(() => {
              if (challengeTab.closed || !dialog.open) {
                stopPromptProbe()
                return
              }
              retryProvider({ automatic: true })
            }, 5000)
            promptProbeTimers.set(probeKey, probeTimer)
            return challengeTab
          }
          sourceLink?.addEventListener("click", (event) => {
            event.preventDefault()
            openChallengeTab()
          })
        }
        candidateList.append(label)
        sizeDictionaryBuilderTextareas(candidateList)
      })
      if (!candidates.length) {
        const sourceLinks = document.createElement("div")
        sourceLinks.className = "dictionary-builder-candidate-source-list"
        visibleStatusSources.filter((source) => source.datumStatus?.[datum]?.status !== "manual").forEach((source) => appendSourceLink(sourceLinks, source.provider, source.sourceUrl))
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
        label.append(radio, title)
        if (datum === "synonymsAntonyms") {
          const relation = relationInputs(selectedCandidates[datum]?.provider === "manual" ? selectedCandidates[datum].value : "", "manual", () => {
            radio.checked = true
            selectedCandidates[datum] = { provider: "manual", value: relation.value() }
            updateTabSelection(datum)
            sizeDictionaryBuilderTextareas(candidateList)
          })
          label.append(relation.fields)
          radio.addEventListener("change", () => { selectedCandidates[datum] = { provider: "manual", value: relation.value() }; updateTabSelection(datum) })
        } else {
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
          label.append(input)
        }
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
      const apply = root.querySelector("[data-dictionary-builder-apply]")
      const message = dialog.querySelector("[data-dictionary-builder-message]")
      apply.disabled = true
      try {
        const selections = {}
        Object.entries(selectedCandidates).forEach(([datum, selection]) => {
          if (!isVerbEntry && dictionaryBuilderVerbOnlyDatums.has(datum)) return
          if (!selection || !selection.provider) return
          if (!dictionaryBuilderApplyFields.has(datum)) return
          let value = selection.value ?? ""
          if (["grammarClassification", "originReferences", "verbForms"].includes(datum)) { try { value = typeof value === "string" ? JSON.parse(value) : value } catch { return } }
          selections[datum] = { provider: selection.provider, value }
        })
        if (draftOnly) {
          const mode = root.querySelector("[data-dictionary-builder-mode]").value
          const draftResult = applyDictionaryBuilderDraftSelections(pane, selections, mode, isVerbEntry)
          pane.dataset.dictionaryBuilderPending = JSON.stringify({ snapshotId: snapshot.id, snapshotEntryId: sourceId, mode, selections })
          const changed = draftResult.changed.length ? `Applied ${draftResult.changed.join(", ")} to the editable draft.` : "No selected fields changed the editable draft."
          const deferred = draftResult.deferred.length ? ` ${draftResult.deferred.join(", ")} selection will be pulled into protected Library media when Save canonical completes.` : ""
          message.textContent = `${changed}${deferred} Save canonical to persist the draft and selected media.`
          return
        }
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
        if (data.entry) {
          window.SIS_VOCABULARY_ESL?.hydrate(pane, data.entry, { preserveSyllabication: true })
        }
        if (Array.isArray(data.mediaAssets)) {
          pane.dataset.libraryMediaAssets = JSON.stringify(data.mediaAssets)
          hydrateLibraryAudio(pane)
        }
        const appliedFields = Array.isArray(data.appliedFields) ? data.appliedFields : []
        message.textContent = appliedFields.length ? `Applied ${appliedFields.join(", ")}.` : "No selected data changed this entry. Choose Replace selected or Replace all to overwrite existing values."
        if (pane) {
          const paneMessage = pane.querySelector("[data-vocabulary-dictionary-builder-message]")
          if (paneMessage) paneMessage.textContent = appliedFields.length ? `Applied ${appliedFields.join(", ")}.` : "Apply completed; no selected fields changed this entry."
        }
        if (!appliedFields.length) return
        closeSourceBrowserTabs()
        if (typeof dialog.close === "function") dialog.close()
      } catch (error) { message.textContent = error.message || "Dictionary Builder Apply failed." } finally { apply.disabled = false }
    })
    show(selectedTab)
    if (autoRetry) {
      const autoRetryTimer = window.setTimeout(() => retryMissingPreferredDatums(), 5000)
      const cancelAutoRetry = () => window.clearTimeout(autoRetryTimer)
      dialog.addEventListener("close", cancelAutoRetry, { once: true })
    }
    const message = dialog.querySelector("[data-dictionary-builder-message]")
    if (draftOnly && message) message.textContent = "Draft mode: Apply updates the editable review form. Save canonical to persist it."
    if (typeof dialog.showModal === "function") dialog.showModal()
    else dialog.setAttribute("open", "")
  }
  const bindDictionaryBuilder = () => {
    document.querySelectorAll("[data-vocabulary-dictionary-builder]").forEach((button) => {
      if (button.dataset.dictionaryBuilderBound === "true") return
      button.dataset.dictionaryBuilderBound = "true"
      const pane = button.closest("[data-review-pane], [data-vocabulary-editor]")
      hydrateLibraryAudio(pane)
      bindEditorSourceStartup(pane)
      const word = pane?.querySelector('[data-vocabulary-field="english"]')?.value || ""
      const encoded = encodeURIComponent(word.trim())
      const sourcePaths = { LD: `https://www.ldoceonline.com/dictionary/${encoded}`, OA: `https://www.oxfordlearnersdictionaries.com/definition/american_english/${encoded}`, OB: `https://www.oxfordlearnersdictionaries.com/definition/english/${encoded}`, BR: `https://www.britannica.com/dictionary/${encoded}`, MW: `https://www.merriam-webster.com/dictionary/${encoded}`, AP: `https://www.merriam-webster.com/dictionary/${encoded}`, ET: `https://www.etymonline.com/search?q=${encoded}`, WK: `https://en.wiktionary.org/w/index.php?search=${encoded}`, CA: `https://dictionary.cambridge.org/dictionary/english/${encoded}`, TH: `https://www.merriam-webster.com/thesaurus/${encoded}`, WH: `https://www.wordhelp.com/dictionary/${encoded}`, GT: `https://translate.google.com/?sl=en&tl=vi&text=${encoded}&op=translate` }
      pane?.querySelectorAll("[data-dictionary-builder-source]").forEach((link) => { link.href = sourcePaths[link.dataset.dictionaryBuilderSource] || link.href })
      button.addEventListener("click", async () => {
        const pane = button.closest("[data-review-pane], [data-vocabulary-editor]")
        const sourceId = pane?.dataset.reviewSourceId || pane?.dataset.approvedEntryId
        const message = pane?.querySelector("[data-vocabulary-dictionary-builder-message]")
        if (!pane || !sourceId) return
        const word = pane.querySelector('[data-vocabulary-field="english"]')?.value || ""
        const initialReservation = { reserved: new Map([...sourceBrowserTabs.entries()].filter(([, tab]) => tab && !tab.closed)), blocked: [], word }
        button.disabled = true
        try {
          if (message) message.textContent = "Building availability-aware preview; no data or audio changes now."
          const response = await fetch(`/api/admin/library/entries/${encodeURIComponent(sourceId)}/dictionary-builder/preview`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: readPayload(pane) }) })
          const snapshot = await response.json()
          if (!response.ok || !snapshot.ok) throw new Error(snapshot.error || "Dictionary Builder preview failed.")
          renderSourceLeds(snapshot, pane.querySelector("[data-dictionary-builder-source-leds]"))
          renderDictionaryBuilder(snapshot, pane, sourceId, {}, "vietnamese", initialReservation.reserved.size ? initialReservation : null)
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
