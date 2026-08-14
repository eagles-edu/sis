(() => {
  const POS = ["adjective", "noun", "proper noun", "verb", "adverb", "conjunction", "preposition", "determiner", "pronoun", "interjection", "numeral", "phrase", "idiom", "clause"];
  const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const safeUid = (value) => String(value || "shared").replace(/[^A-Za-z0-9_-]/gu, "-");
  const option = (value, label = value) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  const select = (field, label, values, extra = "", rowUid = "shared") => `<label class="vocabulary-pos-control" ${extra}>${escapeHtml(label)}<select name="vocabularyEsl-${escapeHtml(field)}-${safeUid(rowUid)}" data-vocabulary-esl-field="${escapeHtml(field)}"><option value="">Select</option>${values.map((value) => Array.isArray(value) ? option(value[0], value[1]) : option(value)).join("")}</select></label>`;
  const transitivityHelp = `<p class="vocabulary-transitivity-help"><strong>Types of transitivity</strong><br>Intransitive: no object needed; the thought is complete on its own (e.g., The baby sleeps.).<br>Transitive: takes an object; use this general choice when the exact subtype is not yet known.<br>Monotransitive: takes one direct object answering what? or whom? (e.g., She baked a cake.).<br>Ditransitive: takes both an indirect object and a direct object (e.g., He gave Mary a book.).<br>Ambitransitive: can be either transitive or intransitive depending on the sentence (e.g., He reads a book vs. He reads quietly.).</p>`;
  const grammarFields = ["grammarFamily", "grammarSubtype", "grammarDetail", "grammarNumber"];
  const nounTypes = [["common", "Common"], ["proper", "Proper"], ["concrete", "Concrete"], ["abstract", "Abstract"], ["material", "Material"], ["collective", "Collective"], ["compound", "Compound"], ["possessive", "Possessive"]];
  const nounNumbers = [["singular", "Singular"], ["plural", "Plural"], ["singular and plural", "Singular and Plural"]];
  const etymologyTypes = [["native", "Native English"], ["borrowed", "Borrowed / loanword"], ["derived", "Derived / affixed"], ["compound", "Compound"], ["eponym", "Eponym"], ["onomatopoeic", "Onomatopoeic"], ["unknown", "Unknown"]];

  function etymologyHtml(rowUid) {
    const uid = safeUid(rowUid);
    return `<div class="vocabulary-etymology-fields" data-vocabulary-etymology-fields>
      ${select("etymologyType", "Origin type (optional)", etymologyTypes, "", uid)}
      <p class="vocabulary-origin-help">Choose the lexical relationship supported by the authoritative source. <a href="https://www.etymonline.com/" target="_blank" rel="noopener noreferrer">Etymonline</a> is primary; <a href="https://www.merriam-webster.com/" target="_blank" rel="noopener noreferrer">Merriam-Webster</a> is supplemental. This is not Works Cited or provenance; an uncertain origin path stays blank.</p>
      <label class="vocabulary-pos-control">Etymology / word origin (optional)<input name="vocabularyEsl-etymology-${uid}" data-vocabulary-esl-field="etymology" placeholder="Borrowed from French; formed with ..." aria-label="Etymology or word origin, optional"></label>
      <input type="hidden" name="vocabularyOriginPath-${uid}" data-vocabulary-origin-field="originPath">
      <input type="hidden" name="vocabularyOriginReferences-${uid}" data-vocabulary-origin-field="originReferences">
    </div>`;
  }

  function parametersHtml(rowUid, { includeMwFill = false, includeTransitivityTools = false } = {}) {
    const uid = safeUid(rowUid);
    const mwFill = includeMwFill ? `<button type="button" class="portal-button portal-button-alt vocabulary-mw-fill" data-vocabulary-mw-preview title="Fill only fields returned authoritatively by Merriam-Webster." aria-label="Fill Merriam-Webster fields">MW fill</button><p class="small" data-vocabulary-mw-message aria-live="polite"></p><details data-vocabulary-mw-details hidden><summary>View complete MW data</summary><pre data-vocabulary-mw-json></pre></details>` : "";
    const transitivityTools = includeTransitivityTools ? `<div class="vocabulary-transitivity-check"><button type="button" class="portal-button portal-button-alt" data-vocabulary-transitivity-check title="Compare the entered verb forms with the bundled corpus evidence. This check is advisory; saving remains allowed.">Check</button><button type="button" class="portal-button portal-button-alt" data-vocabulary-transitivity-autofill title="Suggest transitivity from the bundled corpus list. Review the suggestion before saving.">Auto-fill</button><p class="small" data-vocabulary-transitivity-message aria-live="polite"></p></div>` : "";
    return `<div class="vocabulary-pos-parameters" data-vocabulary-pos-parameters hidden>
      <div class="vocabulary-pos-controls" data-vocabulary-pos-controls></div>
      <div class="vocabulary-verb-forms" data-vocabulary-verb-forms hidden>
        ${[ ["verbInfinitive", "Infinitive"], ["verbV1", "V1 - present"], ["verbV2", "V2 - past"], ["verbV3", "V3 - past participle"], ["verbV4", "V4 - present participle"], ["verbV5", "V5 - -s/-es form"] ].map(([field, placeholder]) => `<input name="vocabularyEsl-${field}-${uid}" data-vocabulary-esl-field="${field}" placeholder="${placeholder}" aria-label="${placeholder}">`).join("")}
      </div>
      ${mwFill}
      ${transitivityTools}
    </div>`;
  }

  function controlsFor(pos, rowUid) {
    if (pos === "noun") return [
      select("countability", "Countability", ["countable", "uncountable", "both S & P"], "", rowUid),
      select("nounType", "Noun Types", nounTypes, "", rowUid),
      select("nounNumber", "Number", nounNumbers, "", rowUid),
    ].join("");
    if (pos === "verb") return [
      select("displayVerbForm", "Display form", ["infinitive", "v1", "v2", "v3", "v4", "v5"], "", rowUid),
      select("grammarFamily", "Verb type", ["primary", "modal", "action"], "", rowUid),
      select("verbRegularity", "Regularity", ["regular", "irregular"], "", rowUid),
      `${select("verbTransitivity", "Type of transitivity (optional)", [["intransitive", "Intransitive"], ["transitive", "Transitive (general)"], ["monotransitive", "Monotransitive"], ["ditransitive", "Ditransitive"], ["ambitransitive", "Ambitransitive"]], "", rowUid)}${transitivityHelp}`,
    ].join("");
    if (pos === "adjective") return select("grammarSubtype", "Adjective subtype", ["-ed adjective", "-ing adjective"], "", rowUid);
    if (pos === "adverb") return select("grammarSubtype", "Adverb subtype", ["manner", "place", "time", "frequency", "degree", "sentence"], "", rowUid);
    if (pos === "conjunction") return select("grammarSubtype", "Conjunction subtype", ["coordinating", "subordinating", "correlative"], "", rowUid);
    if (pos === "preposition") return select("grammarSubtype", "Preposition subtype", ["simple", "compound", "phrasal"], "", rowUid);
    if (pos === "idiom") return select("grammarSubtype", "Idiom subtype", ["pure idioms", "binomial idioms", "partial idioms", "prepositional/verb-particle idioms"], "", rowUid);
    if (pos === "clause") return select("grammarSubtype", "Clause subtype", ["dependent", "independent"], "", rowUid);
    if (pos === "phrase") return select("grammarFamily", "Phrase group", ["grammatical phrases", "verbal phrases", "special phrases"], "", rowUid);
    if (pos === "pronoun") return select("grammarFamily", "Pronoun subtype", ["personal", "possessive", "reflexive", "intensive", "indefinite", "demonstrative", "interrogative", "relative", "pronominal adjectives", "archaic"], "", rowUid);
    if (pos === "determiner") return select("grammarFamily", "Determiner subtype", ["articles", "possessive", "numbers", "indefinite pronouns"], "", rowUid);
    return "";
  }

  function dependentControls(pos, family, subtype, rowUid) {
    const number = (values = ["singular", "plural", "either singular or plural"]) => select("grammarNumber", "Number", values, "", rowUid);
    if (pos === "phrase") {
      if (family === "grammatical phrases") return select("grammarSubtype", "Phrase subtype", ["noun", "verb", "adjective", "adverb", "prepositional"], "", rowUid);
      if (family === "verbal phrases") return select("grammarSubtype", "Phrase subtype", ["infinitive", "gerund", "participial"], "", rowUid);
      if (family === "special phrases") return select("grammarSubtype", "Phrase subtype", ["absolute", "appositive"], "", rowUid);
    }
    if (pos === "pronoun") {
      if (family === "personal") return `${select("grammarSubtype", "Personal role", ["subject", "object"], "", rowUid)}${subtype ? number(["singular", "plural"]) : ""}`;
      if (family === "possessive") return `${select("grammarSubtype", "Possessive role", ["adjective", "pronoun"], "", rowUid)}${subtype ? number(["singular", "plural"]) : ""}`;
      if (["reflexive", "intensive", "demonstrative"].includes(family)) return number(["singular", "plural"]);
      if (["indefinite", "interrogative", "relative", "archaic"].includes(family)) return number();
      if (family === "pronominal adjectives") {
        const choices = ["possessive adj", "demonstrative", "distributive", "pronominal"];
        const value = subtype;
        const values = ["possessive adj", "demonstrative"].includes(value) ? ["singular", "plural"] : ["singular", "either singular or plural"];
        return `${select("grammarSubtype", "Pronominal subtype", choices, "", rowUid)}${value ? number(values) : ""}`;
      }
    }
    if (pos === "determiner") {
      if (family === "articles") return number(["singular"]);
      if (family === "possessive") return `${select("grammarSubtype", "Possessive role", ["pronouns", "adjectives"], "", rowUid)}${subtype ? number() : ""}`;
      return number();
    }
    return "";
  }

  function sync(row) {
    const pos = String(row?.querySelector('[data-vocabulary-field="partOfSpeech"]')?.value || "").toLowerCase();
    const surface = row?.querySelector("[data-vocabulary-pos-parameters]");
    const controls = row?.querySelector("[data-vocabulary-pos-controls]");
    const forms = row?.querySelector("[data-vocabulary-verb-forms]");
    if (!surface || !controls) return;
    const values = Object.fromEntries(grammarFields.concat(["countability", "nounType", "nounNumber", "verbRegularity", "verbTransitivity", "displayVerbForm"]).map((field) => [field, row.querySelector(`[data-vocabulary-esl-field="${field}"]`)?.value || ""]));
    const rowUid = row?.querySelector('[name^="vocabularyPartOfSpeech-"]')?.name?.replace(/^vocabularyPartOfSpeech-/u, "") || "shared";
    const content = controlsFor(pos, rowUid);
    const hasTools = Boolean(surface.querySelector("[data-vocabulary-mw-preview], [data-vocabulary-transitivity-check], [data-vocabulary-transitivity-autofill]"));
    surface.hidden = !content && !hasTools;
    controls.innerHTML = content + dependentControls(pos, values.grammarFamily, values.grammarSubtype, rowUid);
    forms.hidden = pos !== "verb";
    Object.entries(values).forEach(([field, value]) => { const input = row.querySelector(`[data-vocabulary-esl-field="${field}"]`); if (input) input.value = value; });
    if (pos === "verb" && forms.children.length === 0) forms.innerHTML = parametersHtml("").match(/<div class="vocabulary-verb-forms"[\s\S]*?<\/div>/)?.[0] || "";
  }

  function classification(row) {
    return Object.fromEntries(grammarFields.map((field) => [field, String(row.querySelector(`[data-vocabulary-esl-field="${field}"]`)?.value || "").trim()]).filter(([, value]) => value));
  }

  function originMetadata(row) {
    const path = String(row?.querySelector('[data-vocabulary-origin-field="originPath"]')?.value || "").trim();
    const rawReferences = String(row?.querySelector('[data-vocabulary-origin-field="originReferences"]')?.value || "").trim();
    let originReferences = [];
    if (rawReferences) {
      try { originReferences = JSON.parse(rawReferences); } catch { originReferences = []; }
    }
    return {
      ...(path ? { originPath: path } : {}),
      ...(Array.isArray(originReferences) && originReferences.length ? { originReferences } : {}),
    };
  }

  function hydrate(row, data = {}, { preserveSyllabication = false } = {}) {
    const classificationValue = data.grammarClassification || {};
    sync(row);
    const inputFor = (field) => row.querySelector(`[data-vocabulary-esl-field="${field}"], [data-vocabulary-field="${field}"], [data-vocabulary-origin-field="${field}"]`);
    const set = (field, value) => { const input = inputFor(field); if (input) input.value = String(value || ""); };
    set("partOfSpeech", data.partOfSpeech);
    sync(row);
    set("grammarFamily", classificationValue.grammarFamily);
    sync(row);
    set("grammarSubtype", classificationValue.grammarSubtype);
    sync(row);
    Object.entries({ ...data, ...classificationValue }).forEach(([field, value]) => {
      if (preserveSyllabication && field === "syllabication") return;
      set(field, value);
    });
    const originReferences = Array.isArray(data.originReferences) ? data.originReferences : [];
    const originReferencesInput = row.querySelector('[data-vocabulary-origin-field="originReferences"]');
    if (originReferencesInput) originReferencesInput.value = originReferences.length ? JSON.stringify(originReferences) : "";
    sync(row);
  }

  const lookupUrl = (label, english) => {
    const term = String(english || "")
      .normalize("NFC")
      .replace(/[\u0000-\u001F\u007F]/gu, " ")
      .trim()
      .replace(/[’‘]/gu, "'")
      .replace(/[‐‑‒–—―]/gu, "-")
      .replace(/[^\p{L}\p{N}\s'\-]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (!term) return "";
    const encoded = encodeURIComponent(term);
    if (label === "LD") return `https://www.ldoceonline.com/dictionary/${encoded.replace(/%20/gu, "-")}`;
    if (label === "GT") return `https://translate.google.com/?sl=en&tl=vi&text=${encoded}&op=translate`;
    if (label === "WH") return `https://www.wordhelp.com/syllables/english/?q=${encoded}`;
    if (label === "ET") return `https://www.etymonline.com/search?q=${encoded}`;
    return "";
  };

  function bindLookupButtons(row) {
    row?.querySelectorAll("[data-vocabulary-lookup]").forEach((button) => {
      if (button.dataset.lookupBound === "true") return;
      button.dataset.lookupBound = "true";
      button.addEventListener("click", async () => {
      const label = button.getAttribute("data-vocabulary-lookup");
      const english = row.querySelector('[data-vocabulary-field="english"]')?.value;
      const url = lookupUrl(label, english);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      if (label !== "ET") return;
      const endpoint = button.getAttribute("data-vocabulary-origin-lookup");
      const message = row.querySelector("[data-vocabulary-et-message]");
      if (!endpoint || !String(english || "").trim()) { if (message) message.textContent = "Enter an English word before using ET."; return; }
      if (message) message.textContent = "Loading Etymonline…";
      try {
        const response = await fetch(`${endpoint}?word=${encodeURIComponent(String(english).trim())}`, { credentials: "include", headers: { Accept: "application/json" } });
        const preview = await response.json();
        if (!response.ok || !preview.ok) throw new Error(preview.error || preview.message || "Etymonline is unavailable.");
        const textarea = row.querySelector('[data-vocabulary-field="definition"]');
        const hasFirstUse = /^\*\*First known use:\*\*/imu.test(textarea.value);
        const current = textarea.value.trim();
        const paragraph = String(preview.paragraph || "").trim();
        const alreadyPresent = paragraph && current.includes(paragraph);
        if (paragraph && !alreadyPresent) {
          const citationHeading = /^\*\*Works Cited:\*\*[\t ]*$/imu;
          const citationIndex = current.search(citationHeading);
          let next = current;
          if (hasFirstUse && String(row.querySelector('[data-vocabulary-esl-field="etymology"]')?.value || "").trim()) {
            next = current.replace(/(\*\*First known use:\*\*[^\n]*)/iu, (line) => line.includes(paragraph) ? line : `${line}; ${paragraph}`);
          } else if (citationIndex >= 0) {
            next = `${current.slice(0, citationIndex).trimEnd()}\n\n${paragraph}\n\n${current.slice(citationIndex).trimStart()}`;
          } else {
            next = current ? `${current}\n\n${paragraph}` : paragraph;
          }
          textarea.value = next;
          dispatchDefinitionInput(textarea);
        }
        if (preview.citation && !textarea.value.includes(preview.citation)) {
          const worksCitedHeading = /^\*\*Works Cited:\*\*[\t ]*$/imu;
          const worksCitedIndex = textarea.value.search(worksCitedHeading);
          if (worksCitedIndex >= 0) {
            const relativeEnd = textarea.value.slice(worksCitedIndex).indexOf("\n");
            const insertAt = relativeEnd >= 0 ? worksCitedIndex + relativeEnd + 1 : textarea.value.length;
            textarea.value = `${textarea.value.slice(0, insertAt)}- ${preview.citation}\n${textarea.value.slice(insertAt)}`;
          } else {
            textarea.value = `${textarea.value.trimEnd()}\n\n**Works Cited:**\n- ${preview.citation}`;
          }
          dispatchDefinitionInput(textarea);
        }
        const pathInput = row.querySelector('[data-vocabulary-origin-field="originPath"]');
        if (pathInput && preview.originPath) pathInput.value = preview.originPath;
        const referencesInput = row.querySelector('[data-vocabulary-origin-field="originReferences"]');
        const references = referencesInput?.value ? JSON.parse(referencesInput.value) : [];
        const incoming = preview.reference ? [...references, preview.reference] : references;
        const deduped = [...new Map(incoming.filter((item) => item?.url).map((item) => [item.url, item])).values()];
        if (referencesInput) referencesInput.value = deduped.length ? JSON.stringify(deduped) : "";
        if (message) message.textContent = "ET paragraph and source metadata added.";
      } catch (error) {
        if (message) message.textContent = error.message || "Etymonline is unavailable.";
      }
      });
    });
  }

  function dispatchDefinitionInput(textarea) {
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function formatDefinitionSelection(textarea, prefix, suffix = prefix) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selected = value.slice(start, end);
    const hasOuterMarkers = start >= prefix.length
      && value.slice(start - prefix.length, start) === prefix
      && value.slice(end, end + suffix.length) === suffix;
    if (hasOuterMarkers) {
      textarea.setRangeText(selected, start - prefix.length, end + suffix.length, "select");
      textarea.selectionStart = start - prefix.length;
      textarea.selectionEnd = end - prefix.length;
    } else if (selected) {
      textarea.setRangeText(`${prefix}${selected}${suffix}`, start, end, "select");
      textarea.selectionStart = start + prefix.length;
      textarea.selectionEnd = end + prefix.length;
    } else {
      textarea.setRangeText(`${prefix}${suffix}`, start, end, "end");
      textarea.selectionStart = start + prefix.length;
      textarea.selectionEnd = start + prefix.length;
    }
    dispatchDefinitionInput(textarea);
  }

  function continueDefinitionList(event, textarea) {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (textarea.selectionStart !== textarea.selectionEnd) return;
    const caret = textarea.selectionStart;
    const lineStart = textarea.value.lastIndexOf("\n", caret - 1) + 1;
    const line = textarea.value.slice(lineStart, caret);
    const unordered = line.match(/^(\s*)([-+*])\s+(.*)$/u);
    const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/u);
    const match = unordered || ordered;
    if (!match) return;
    event.preventDefault();
    if (!match[3]) {
      textarea.setRangeText("", lineStart, caret, "end");
    } else {
      const marker = unordered ? `${match[1]}${match[2]} ` : `${match[1]}${Number(match[2]) + 1}. `;
      textarea.setRangeText(`\n${marker}`, caret, caret, "end");
    }
    dispatchDefinitionInput(textarea);
  }

  function bindDefinitionFormatting() {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    document.addEventListener("keydown", (event) => {
      const textarea = event.target?.closest?.('[data-vocabulary-field="definition"]');
      if (!(textarea instanceof HTMLTextAreaElement)) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const key = String(event.key || "").toLowerCase();
        const format = key === "b" ? ["**", "**"] : key === "i" ? ["*", "*"] : key === "u" ? ["[u]", "[/u]"] : null;
        if (format) {
          event.preventDefault();
          formatDefinitionSelection(textarea, format[0], format[1]);
          return;
        }
      }
      continueDefinitionList(event, textarea);
    });
  }

  bindDefinitionFormatting();

  function bindDefinitionAutosize(row) {
    const textarea = row?.querySelector('[data-vocabulary-field="definition"]');
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.max(48, textarea.scrollHeight)}px`;
    };
    textarea.addEventListener("input", resize);
    resize();
  }

  function definitionInlineHtml(value) {
    return escapeHtml(value)
      .replace(/\[u\]([^\n]*?)\[\/u\]/giu, "<u>$1</u>")
      .replace(/\*\*([^\n]*?)\*\*/gu, "<strong>$1</strong>")
      .replace(/__([^\n]*?)__/gu, "<u>$1</u>")
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, "<em>$1</em>");
  }

  function definitionHtml(value) {
    const source = String(value == null ? "" : value).replace(/\r\n?/gu, "\n").trim();
    if (!source) return "No definition yet.";
    const lines = source.split("\n");
    const output = [];
    let listType = "";
    const closeList = () => {
      if (listType) output.push(`</${listType}>`);
      listType = "";
    };
    lines.forEach((line) => {
      if (!line.trim()) {
        closeList();
        output.push("<br>");
        return;
      }
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/u);
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/u);
      const item = ordered || unordered;
      if (item) {
        const nextType = ordered ? "ol" : "ul";
        if (listType && listType !== nextType) closeList();
        if (!listType) {
          listType = nextType;
          output.push(`<${listType}>`);
        }
        output.push(`<li>${definitionInlineHtml(item[1])}</li>`);
        return;
      }
      closeList();
      if (line) {
        output.push(definitionInlineHtml(line), "<br>");
      } else {
        output.push("<br>");
      }
    });
    closeList();
    if (output.at(-1) === "<br>") output.pop();
    return output.join("");
  }

  function definitionSections(value) {
    const sections = { body: [], firstKnownUse: [], stems: [], synonyms: [], antonyms: [], worksCited: [], etymology: [] };
    let section = "body";
    String(value == null ? "" : value).replace(/\r\n?/gu, "\n").split("\n").forEach((line) => {
      const heading = line.match(/^\*\*(First known use|Stems|Synonyms|Antonyms|Works Cited|Etymology):\*\*\s*(.*)$/iu);
      if (heading) {
        section = { "First known use": "firstKnownUse", Stems: "stems", Synonyms: "synonyms", Antonyms: "antonyms", "Works Cited": "worksCited", Etymology: "etymology" }[heading[1]] || "body";
        if (heading[2]) sections[section].push(heading[2]);
        return;
      }
      sections[section]?.push(line);
    });
    return Object.fromEntries(Object.entries(sections).map(([key, lines]) => [key, lines.join("\n").trim()]));
  }

  function referenceCitation(reference) {
    if (reference?.citation) return reference.citation;
    const source = String(reference?.source || "Source").trim();
    const retrieved = String(reference?.retrievedAt || "").slice(0, 10);
    return `${source}. Retrieved ${retrieved || "n.d."}, from ${String(reference?.url || "")}`.trim();
  }

  function entryDefinitionHtml(source, value) {
    const sections = definitionSections(value("definition"));
    const blocks = [];
    if (sections.body) blocks.push(`<div class="new-word-entry-definition-body">${definitionHtml(sections.body)}</div>`);
    const etymology = [sections.etymology, value("etymology")].filter(Boolean).join("\n\n");
    if (etymology || value("originPath")) blocks.push(`<section class="new-word-entry-etymology"><strong>Etymology</strong>${etymology ? `<div>${definitionHtml(etymology)}</div>` : ""}${value("originPath") ? `<div class="new-word-entry-origin-path"><strong>Origin path:</strong> ${escapeHtml(value("originPath"))}</div>` : ""}</section>`);
    if (sections.firstKnownUse) blocks.push(`<section class="new-word-entry-first-use"><strong>First known use</strong><div>${definitionHtml(sections.firstKnownUse)}</div></section>`);
    if (value("partOfSpeech") === "verb" && ["verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5"].some((field) => value(field))) {
      const labels = ["INF", "V1", "V2", "V3", "V4", "V5"];
      blocks.push(`<section class="vocabulary-verb-forms-display"><strong>Verb Forms</strong>${labels.map((label, index) => `<div><strong>${label}</strong>: ${escapeHtml(value(index === 0 ? "verbInfinitive" : `verbV${index}`))}</div>`).join("")}</section>`);
    }
    if (sections.stems) blocks.push(`<section class="new-word-entry-stems"><strong>Stems</strong><div>${definitionHtml(sections.stems)}</div></section>`);
    if (sections.synonyms) blocks.push(`<section class="new-word-entry-synonyms"><strong>Synonyms</strong><div>${definitionHtml(sections.synonyms)}</div></section>`);
    if (sections.antonyms) blocks.push(`<section class="new-word-entry-antonyms"><strong>Antonyms</strong><div>${definitionHtml(sections.antonyms)}</div></section>`);
    const references = Array.isArray(value("originReferences")) ? value("originReferences") : [];
    const cited = [...references.map(referenceCitation), ...(sections.worksCited ? [sections.worksCited] : [])].filter(Boolean);
    if (cited.length) blocks.push(`<section class="vocabulary-origin-references"><strong>Works Cited</strong>${[...new Set(cited)].map((citation) => `<div>${escapeHtml(citation)}</div>`).join("")}</section>`);
    return blocks.join("") || "No definition yet.";
  }

  function editorRowHtml(rowUid, { index = 0, removable = false, actionsHtml = "", includeMwFill = false, includeTransitivityTools = false, originLookupPath = "" } = {}) {
    const uid = safeUid(rowUid);
    const options = POS.map((part) => `<option value="${part}">${part}</option>`).join("");
    const rowActions = removable
      ? `<details class="news-vocabulary-row-menu">
              <summary class="news-vocabulary-row-dots" aria-label="Open vocabulary row actions">⋮</summary>
              <div class="news-vocabulary-row-menu-panel">
                ${actionsHtml}
                <button type="button" class="portal-button portal-button-danger news-vocabulary-remove" title="Remove this vocabulary entry" aria-label="Remove this vocabulary entry">Remove</button>
              </div>
            </details>`
      : '<span class="news-vocabulary-row-dots" aria-hidden="true">⋮</span>';
    return `<div class="news-vocabulary-row" data-news-vocabulary-row="${index}">
          <select name="vocabularyPartOfSpeech-${uid}" data-vocabulary-field="partOfSpeech" aria-label="Part of speech" required><option value="">Select</option>${options}</select>
          <input name="vocabularyEnglish-${uid}" type="text" data-vocabulary-field="english" placeholder="Word/phrase EN" aria-label="Word or phrase in English" autocapitalize="off" required>
          <input name="vocabularyVietnamese-${uid}" type="text" data-vocabulary-field="vietnamese" placeholder="Word/phrase VI" aria-label="Word or phrase in Vietnamese" required>
          <input name="vocabularySyllabication-${uid}" type="text" data-vocabulary-field="syllabication" placeholder="Do: air-strike | Extra: air-con-di-tion-ing" aria-label="Syllabication: keep compounds exact; optionally split multi-syllable compound parts for extra points" required>
          ${etymologyHtml(uid)}
          ${parametersHtml(uid, { includeMwFill, includeTransitivityTools })}
          <div class="news-vocabulary-definition-row">
            <div class="news-vocabulary-lookups" aria-label="Vocabulary lookup links">
              ${["LD", "GT", "WH", "ET"].map((label) => `<button type="button" class="portal-button external-link-turquoise portal-button-external-link-turquoise news-vocabulary-lookup${label === "ET" ? " vocabulary-etymonline-lookup" : ""}" data-vocabulary-lookup="${label}"${label === "ET" ? ` data-vocabulary-origin-lookup="${escapeHtml(originLookupPath)}"` : ""} title="Look up the ${label} field to complete this vocabulary entry" aria-label="Look up the ${label} field">${label}</button>`).join("")}
              <p class="small vocabulary-et-message" data-vocabulary-et-message aria-live="polite"></p>
            </div>
            <textarea name="vocabularyDefinition-${uid}" data-vocabulary-field="definition" rows="1" placeholder="Definition" title="Ctrl+B bold · Ctrl+I italic · Ctrl+U underline · Enter continues - and 1. lists" aria-label="Definition" required></textarea>
            ${rowActions}
          </div>
        </div>`;
  }

  function flatEntryHtml(entry = {}, { index = "", editClass = "vocabulary-flat-edit", editLabel = "Edit", editAttributes = "", entryAttributes = "", extraHtml = "" } = {}) {
    const source = entry && typeof entry === "object" ? entry : {};
    const esl = source.esl && typeof source.esl === "object" ? source.esl : {};
    const classification = source.grammarClassification || esl.grammarClassification || {};
    const value = (field) => source[field] ?? esl[field] ?? classification[field] ?? "";
    const json = escapeHtml(JSON.stringify(source));
    const indexAttribute = index === "" ? "" : ` data-vocabulary-entry-index="${escapeHtml(index)}"`;
    const editButton = editLabel === null ? "" : `<button type="button" class="portal-button portal-button-primary ${escapeHtml(editClass)}" ${editAttributes} title="Edit this vocabulary entry" aria-label="Edit this vocabulary entry">${escapeHtml(editLabel)}</button>`;
    const position = String(value("partOfSpeech") || "").toLowerCase();
    const posMetadataValues = position === "verb"
      ? [value("displayVerbForm") ? String(value("displayVerbForm")).toUpperCase() : "", value("verbRegularity"), value("grammarFamily"), value("verbTransitivity")]
      : position === "noun"
        ? [value("countability"), value("nounType"), value("nounNumber")]
        : [value("grammarFamily"), value("grammarSubtype"), value("grammarDetail"), value("grammarNumber")];
    const posMetadata = posMetadataValues.filter(Boolean).join(" | ");
    return `<article class="vocabulary-flat-entry new-word-entry" data-vocabulary-flat-entry${indexAttribute} data-vocabulary-entry-json="${json}" ${entryAttributes}>
      <div class="vocabulary-flat-entry-head new-word-entry-head">
        <strong>${escapeHtml(value("english") || "New word")}</strong>
        <span class="new-word-entry-pronunciation">/${escapeHtml(value("syllabication"))}/</span>
        <strong class="new-word-entry-part-of-speech">${escapeHtml(value("partOfSpeech"))}</strong>
        ${posMetadata ? `<span class="new-word-entry-pos-details">${escapeHtml(posMetadata)}</span>` : ""}
        <span class="new-word-entry-vietnamese">vi: ${escapeHtml(value("vietnamese"))}</span>
        ${editButton}
      </div>
      <div class="new-word-entry-definition">${entryDefinitionHtml(source, value)}</div>
      ${extraHtml}
    </article>`;
  }

  window.SIS_VOCABULARY_ESL = {
    POS,
    parametersHtml,
    sync,
    hydrate,
    classification,
    originMetadata,
    grammarFields,
    editorRowHtml,
    flatEntryHtml,
    definitionHtml,
    bindLookupButtons,
    bindDefinitionAutosize,
  };
})();
