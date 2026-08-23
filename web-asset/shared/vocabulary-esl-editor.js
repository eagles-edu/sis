(() => {
  const POS = ["adjective", "noun", "proper noun", "verb", "adverb", "conjunction", "preposition", "determiner", "pronoun", "interjection", "numeral", "phrase", "idiom", "clause"];
  const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const safeUid = (value) => String(value || "shared").replace(/[^A-Za-z0-9_-]/gu, "-");
  const option = (value, label = value, attributes = "") => `<option value="${escapeHtml(value)}" ${attributes}>${escapeHtml(label)}</option>`;
  const select = (field, label, values, attributes = "", rowUid = "shared") => `<label class="vocabulary-pos-control">${escapeHtml(label)}<select name="vocabularyEsl-${escapeHtml(field)}-${safeUid(rowUid)}" data-vocabulary-esl-field="${escapeHtml(field)}" ${attributes}><option value="">Select</option>${values.map((value) => Array.isArray(value) ? option(value[0], value[1], value[2] || "") : option(value)).join("")}</select></label>`;
  const transitivityHelp = `<p class="vocabulary-transitivity-help"><strong>Types of transitivity</strong><br>Intransitive: no object needed; the thought is complete on its own (e.g., The baby sleeps.).<br>Transitive: takes an object; use this general choice when the exact subtype is not yet known.<br>Monotransitive: takes one direct object answering what? or whom? (e.g., She baked a cake.).<br>Ditransitive: takes both an indirect object and a direct object (e.g., He gave Mary a book.).<br>Ambitransitive: can be either transitive or intransitive depending on the sentence (e.g., He reads a book vs. He reads quietly.).</p>`;
  const grammarFields = ["grammarFamily", "grammarSubtype", "grammarDetail", "grammarNumber"];
  const nounTypes = [["common", "Common"], ["proper", "Proper"], ["concrete", "Concrete"], ["abstract", "Abstract"], ["material", "Material"], ["collective", "Collective"], ["compound", "Compound"], ["possessive", "Possessive"]];
  const nounNumbers = [["singular", "Singular"], ["plural", "Plural"], ["singular and plural", "Singular and Plural"]];
  const etymologyTypes = [["native", "Native English"], ["borrowed", "Borrowed / loanword"], ["derived", "Derived / affixed"], ["compound", "Compound"], ["eponym", "Eponym"], ["onomatopoeic", "Onomatopoeic"], ["unknown", "Unknown"]];

  function originTypeText(value) {
    const key = String(value == null ? "" : value).trim().toLowerCase();
    const label = etymologyTypes.find(([candidate]) => candidate === key)?.[1] || String(value == null ? "" : value).trim();
    return label.replace(/\s*\/\s*/gu, "/").toLowerCase();
  }
  const syllabicationVowels = { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý" };

  function normalizeSyllabication(value) {
    return String(value == null ? "" : value)
      .trim()
      .normalize("NFC")
      .replace(/[\p{Pd}\u00AD\u2027\u00B7\u22C5\u2212]/gu, "-")
      .replace(/\p{Z}+/gu, " ");
  }

  function normalizeVocabularyEnglishText(value) {
    return String(value == null ? "" : value)
      .normalize("NFC")
      .replace(/\p{Z}+/gu, " ")
      .trim();
  }

  function isProperNounVocabularyEntry(row = {}) {
    const entry = row && typeof row === "object" ? row : {};
    const esl = entry.esl && typeof entry.esl === "object" ? entry.esl : {};
    const partOfSpeech = String(entry.partOfSpeech || "").trim().toLocaleLowerCase("en-US");
    const primaryClassification = String(entry.primaryClassification || esl.primaryClassification || "").trim().toLocaleLowerCase("en-US");
    return partOfSpeech === "proper noun" || primaryClassification === "proper";
  }

  function vocabularyEnglishCapitalizationError(row = {}) {
    const english = normalizeVocabularyEnglishText(row.english);
    if (isProperNounVocabularyEntry(row) && !/\p{Lu}/u.test(english)) return "Proper nouns must include a capital letter.";
    if (!isProperNounVocabularyEntry(row) && /\p{Lu}/u.test(english)) return "English word/phrase must be lowercase unless it is a proper noun.";
    return "";
  }

  function normalizeDefinitionText(value) {
    return String(value == null ? "" : value).replace(/\r\n?/gu, "\n");
  }

  function canonicalizeSyllabication(value) {
    return normalizeSyllabication(value)
      .split(/(\s+|-)/u)
      .map((token) => {
        if (!token || /^\s+$/u.test(token) || token === "-") return token;
        if (/[aeiouy]\p{M}+/iu.test(token.normalize("NFD"))) return token;
        if (!/[A-Z]/u.test(token)) return token;
        const chars = Array.from(token.toLocaleLowerCase("en-US"));
        const vowelIndex = chars.findIndex((char) => syllabicationVowels[char]);
        if (vowelIndex >= 0) chars[vowelIndex] = syllabicationVowels[chars[vowelIndex]];
        return chars.join("");
      })
      .join("");
  }

  if (typeof document?.addEventListener === "function") {
    document.addEventListener("input", (event) => {
      const input = event?.target;
      if (input?.matches?.('[data-vocabulary-field="syllabication"]')) input.value = normalizeSyllabication(input.value);
      if (input?.matches?.('[data-vocabulary-field="english"]')) input.value = normalizeVocabularyEnglishText(input.value);
    });
  }

  function nounState(values = {}) {
    const state = { ...values };
    if (!state.physicalQuality && !state.primaryClassification && !state.grammaticalNumber && !state.materialUsage && !state.countability) return state;
    if (state.physicalQuality === "material") {
      if (state.materialUsage === "variety") Object.assign(state, { countability: state.countability === "countable_and_uncountable" ? "countable_and_uncountable" : "countable", grammaticalNumber: state.countability === "countable_and_uncountable" ? "singular_and_plural" : "plural", primaryClassification: "common" });
      else Object.assign(state, { materialUsage: "mass", countability: "uncountable", grammaticalNumber: "singular", primaryClassification: "common" });
    } else state.materialUsage = "";
    if (state.countability === "uncountable") state.grammaticalNumber = "singular";
    if (state.countability === "countable_and_uncountable") state.grammaticalNumber = "singular_and_plural";
    if (state.countability !== "countable_and_uncountable") state.dualCountabilityUsage = "";
    if (state.primaryClassification === "collective" && (state.countability !== "countable" || state.physicalQuality !== "concrete")) state.primaryClassification = "common";
    if (state.physicalQuality === "abstract" && ["collective", "proper"].includes(state.primaryClassification)) state.primaryClassification = "common";
    if (state.primaryClassification === "proper") {
      if (state.countability !== "countable") state.primaryClassification = "common";
      else {
        state.physicalQuality = "concrete";
        if (!state.properNounVariantShift) state.grammaticalNumber = "singular";
      }
    }
    if (state.primaryClassification === "collective" && state.physicalQuality !== "concrete") state.primaryClassification = "common";
    if (state.primaryClassification === "compound" || state.primaryClassification === "possessive") {
      if (state.physicalQuality === "material") state.primaryClassification = "common";
    }
    return state;
  }

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

  function parametersHtml(rowUid, { includeMwFill = false, includeTransitivityTools = false, includeOriginAnalysis = false } = {}) {
    const uid = safeUid(rowUid);
    const mwFill = includeMwFill ? `<button type="button" class="portal-button portal-button-blue-action vocabulary-mw-fill" data-vocabulary-mw-preview title="Fill only fields returned authoritatively by Merriam-Webster." aria-label="Fill Merriam-Webster fields">MW fill</button>` : "";
    const originAnalysis = includeOriginAnalysis ? `<button type="button" class="portal-button portal-button-amber-info" data-vocabulary-origin-analysis title="Review Etymonline and Merriam-Webster etymology evidence. This advisory review does not change any entry fields.">Origin</button>` : "";
    const sourceActions = mwFill || originAnalysis ? `<div class="vocabulary-source-actions">${mwFill}${originAnalysis}</div><p class="small" data-vocabulary-mw-message aria-live="polite"></p><p class="small" data-vocabulary-origin-analysis-message aria-live="polite"></p><details data-vocabulary-mw-details hidden><summary>View complete MW data</summary><pre data-vocabulary-mw-json></pre></details>` : "";
    const transitivityTools = includeTransitivityTools ? `<div class="vocabulary-transitivity-check"><button type="button" class="portal-button portal-button-blue-action" data-vocabulary-transitivity-check title="Compare the entered verb forms with the bundled corpus evidence. This check is advisory; saving remains allowed.">Check</button><button type="button" class="portal-button portal-button-blue-action" data-vocabulary-transitivity-autofill title="Suggest transitivity from the bundled corpus list. Review the suggestion before saving.">Auto-fill</button><p class="small" data-vocabulary-transitivity-message aria-live="polite"></p></div>` : "";
    return `<div class="vocabulary-pos-parameters" data-vocabulary-pos-parameters hidden>
      <div class="vocabulary-pos-controls" data-vocabulary-pos-controls></div>
      <div class="vocabulary-verb-forms" data-vocabulary-verb-forms hidden>
        ${[ ["verbInfinitive", "Infinitive"], ["verbV1", "V1 - present"], ["verbV2", "V2 - past"], ["verbV3", "V3 - past participle"], ["verbV4", "V4 - present participle"], ["verbV5", "V5 - -s/-es form"] ].map(([field, placeholder]) => `<input name="vocabularyEsl-${field}-${uid}" data-vocabulary-esl-field="${field}" placeholder="${placeholder}" aria-label="${placeholder}">`).join("")}
      </div>
      ${sourceActions}
      ${transitivityTools}
    </div>`;
  }

  function controlsFor(pos, rowUid, values = {}) {
    if (pos === "noun") return [
      select("countability", "1. Countability", [["countable", "Countable"], ["uncountable", "Uncountable"], ["countable_and_uncountable", "Countable and uncountable"]], "", rowUid),
      select("physicalQuality", "2. Quality", [["concrete", "Concrete"], ["material", "Material"], ["abstract", "Abstract"]], "", rowUid),
      select("grammaticalNumber", "3. Number", [
        ["singular", "Singular"],
        ["plural", "Plural", values.countability === "uncountable" || values.countability === "countable_and_uncountable" || (values.physicalQuality === "material" && values.materialUsage !== "variety") || (values.primaryClassification === "proper" && !values.properNounVariantShift) ? "disabled" : ""],
        ["singular_and_plural", "Singular and plural", values.countability !== "countable_and_uncountable" ? "disabled" : ""],
      ], "", rowUid),
      select("primaryClassification", "4. Classification", [
        ["common", "Common"],
        ["proper", "Proper", values.countability !== "countable" || values.physicalQuality !== "concrete" ? "disabled" : ""],
        ["collective", "Collective", values.countability !== "countable" || values.physicalQuality !== "concrete" ? "disabled" : ""],
        ["compound", "Compound", values.physicalQuality === "material" ? "disabled" : ""],
        ["possessive", "Possessive", values.physicalQuality === "material" ? "disabled" : ""],
      ], "", rowUid),
      values.physicalQuality === "material" ? select("materialUsage", "Material usage", [["mass", "Mass substance"], ["variety", "Type or variety"]], "", rowUid) : "",
      values.countability === "countable_and_uncountable" ? select("dualCountabilityUsage", "Dual usage", [["same_sense", "Same sense"], ["different_senses", "Different senses"]], "", rowUid) : "",
      values.primaryClassification === "proper" ? `<label class="vocabulary-pos-control">Proper noun variant<input type="checkbox" data-vocabulary-esl-field="properNounVariantShift" name="vocabularyEsl-properNounVariantShift-${safeUid(rowUid)}">Allow plural variant</label>` : "",
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
    const values = Object.fromEntries(grammarFields.concat(["countability", "nounType", "nounNumber", "physicalQuality", "grammaticalNumber", "primaryClassification", "materialUsage", "dualCountabilityUsage", "verbRegularity", "verbTransitivity", "displayVerbForm"]).map((field) => [field, row.querySelector(`[data-vocabulary-esl-field="${field}"]`)?.value || ""]));
    values.properNounVariantShift = Boolean(row.querySelector('[data-vocabulary-esl-field="properNounVariantShift"]')?.checked);
    const normalizedNoun = pos === "noun" ? nounState(values) : values;
    const rowUid = row?.querySelector('[name^="vocabularyPartOfSpeech-"]')?.name?.replace(/^vocabularyPartOfSpeech-/u, "") || "shared";
    const content = controlsFor(pos, rowUid, normalizedNoun);
    const hasTools = Boolean(surface.querySelector("[data-vocabulary-mw-preview], [data-vocabulary-transitivity-check], [data-vocabulary-transitivity-autofill]"));
    surface.hidden = !content && !hasTools;
    controls.innerHTML = content + dependentControls(pos, values.grammarFamily, values.grammarSubtype, rowUid);
    forms.hidden = pos !== "verb";
    Object.entries(normalizedNoun).forEach(([field, value]) => { const input = row.querySelector(`[data-vocabulary-esl-field="${field}"]`); if (!input) return; if (input.type === "checkbox") input.checked = Boolean(value); else input.value = value; });
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

  const editorEslFields = ["phraseType", "countability", "nounType", "nounNumber", "physicalQuality", "grammaticalNumber", "primaryClassification", "materialUsage", "properNounVariantShift", "dualCountabilityUsage", "verbRegularity", "verbTransitivity", "verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5", "displayVerbForm", "edAdjective", "ingAdjective", "etymologyType", "etymology"];

  function readEditorEntry(row, existing = {}) {
    const fallback = existing && typeof existing === "object" ? { ...existing } : {};
    const fieldValue = (field) => row?.querySelector(`[data-vocabulary-field="${field}"]`);
    const value = {
      ...fallback,
      partOfSpeech: String(fieldValue("partOfSpeech")?.value || "").trim(),
      english: String(fieldValue("english")?.value || "").trim(),
      vietnamese: String(fieldValue("vietnamese")?.value || "").trim(),
      syllabication: canonicalizeSyllabication(fieldValue("syllabication")?.value || ""),
      definition: normalizeDefinitionText(fieldValue("definition")?.value || ""),
    };
    editorEslFields.forEach((field) => {
      const input = row?.querySelector(`[data-vocabulary-esl-field="${field}"]`);
      if (!input) return;
      value[field] = input.type === "checkbox" ? Boolean(input.checked) : String(input.value || "").trim();
    });
    const hasGrammarControls = grammarFields.some((field) => row?.querySelector(`[data-vocabulary-esl-field="${field}"]`));
    if (hasGrammarControls) value.grammarClassification = classification(row);
    const metadata = originMetadata(row);
    if (Object.prototype.hasOwnProperty.call(metadata, "originPath")) value.originPath = metadata.originPath;
    if (Object.prototype.hasOwnProperty.call(metadata, "originReferences")) value.originReferences = metadata.originReferences;
    return value;
  }

  function hydrate(row, data = {}, { preserveSyllabication = false } = {}) {
    const classificationValue = data.grammarClassification || {};
    sync(row);
    const inputFor = (field) => row.querySelector(`[data-vocabulary-esl-field="${field}"], [data-vocabulary-field="${field}"], [data-vocabulary-origin-field="${field}"]`);
    const set = (field, value) => { const input = inputFor(field); if (!input) return; if (input.type === "checkbox") input.checked = Boolean(value); else input.value = String(value || ""); };
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
    if (label === "MW") return `https://www.merriam-webster.com/dictionary/${encoded}`;
    if (label === "TH") return `https://www.merriam-webster.com/thesaurus/${encoded}`;
    if (label === "CA") return `https://dictionary.cambridge.org/dictionary/english/${encoded}`;
    if (label === "CL") return `https://www.learnersdictionary.com/definition/${encoded}`;
    if (label === "GL") return `https://www.google.com/search?q=define+${encoded}`;
    return "";
  };

  const LOOKUP_BUTTONS = Object.freeze({
    LD: { text: "LD", title: "Longman Dictionary", blue: false },
    GT: { text: "GT", title: "Google Translate", blue: false },
    WH: { text: "WH", title: "WordHelp syllables", blue: false },
    ET: { text: "ET", title: "Etymonline", blue: false },
    MW: { text: "MW", title: "Merriam-Webster Collegiate Dictionary", blue: false },
    TH: { text: "TH", title: "Merriam-Webster Thesaurus", blue: false },
    CA: { text: "CA", title: "Cambridge English Dictionary", blue: true },
    CL: { text: "CL", title: "Collegiate to Learner fallback", blue: true },
    GL: { text: "GL", title: "Google definition search", blue: true },
  });

  function insertEtymologyDeterministically(definition, paragraph) {
    const source = normalizeDefinitionText(definition);
    const addition = normalizeDefinitionText(paragraph).trim();
    if (!addition) return source;
    const firstUse = source.match(/^\*\*First known use:?\*\*:?[\t ]*([^\n]*)$/imu);
    const etymology = source.match(/^(\*\*Etymology:?\*\*:?[\t ]*[^\n]*)$/imu);
    if (!firstUse && etymology && source.includes(addition)) return source;
    let next = source;
    if (firstUse) {
      const line = firstUse[0];
      if (line.includes(addition)) return source;
      next = source.replace(line, `${line}\n\n**Etymology** ${addition}`);
    } else {
      if (etymology) next = source.replace(etymology[0], `${etymology[0]}; ${addition}`);
      else {
        const existingAdditionIndex = source.indexOf(addition);
        const nextHeading = source.search(/^\*\*(?:Stems|Synonyms|Antonyms|Works Cited):?\*\*:?/imu);
        if (existingAdditionIndex >= 0) {
          const before = source.slice(0, existingAdditionIndex).trimEnd();
          const after = source.slice(existingAdditionIndex + addition.length).trimStart();
          next = (before ? `${before}\n\n` : "") + `**Etymology** ${addition}` + (after ? `\n\n${after}` : "");
        } else {
          next = nextHeading >= 0 ? `${source.slice(0, nextHeading).trimEnd()}\n\n**Etymology** ${addition}\n\n${source.slice(nextHeading).trimStart()}` : (source ? `${source}\n\n**Etymology** ${addition}` : `**Etymology** ${addition}`);
        }
      }
    }
    const sections = { body: [], "First known use": [], Etymology: [], "Origin path": [], "Verb Forms": [], Stems: [], Synonyms: [], Antonyms: [], "Works Cited": [] };
    const sectionLabels = {
      "first known use": "First known use",
      etymology: "Etymology",
      "origin path": "Origin path",
      "verb forms": "Verb Forms",
      stems: "Stems",
      synonyms: "Synonyms",
      antonyms: "Antonyms",
      "works cited": "Works Cited",
    };
    const stemListItem = /^\s*(?:(?:\d+|[a-z])[.)]|[-+*])\s+/iu;
    let section = "body";
    next.split("\n").forEach((line) => {
      const heading = line.match(/^\*\*(First known use|Etymology|Origin path|Verb Forms|Stems|Synonyms|Antonyms|Works Cited):?\*\*:?[\t ]*(.*)$/iu);
      if (heading) {
        section = sectionLabels[heading[1].toLowerCase()] || "body";
        if (heading[2]) sections[section].push(heading[2]);
        return;
      }
      if (section === "Stems" && line.trim() && !stemListItem.test(line)) section = "Etymology";
      sections[section].push(line);
    });
    return [sections.body.join("\n").trim(), ...["First known use", "Etymology", "Origin path", "Verb Forms", "Stems", "Synonyms", "Antonyms", "Works Cited"].map((heading) => {
      const content = sections[heading].join("\n").trim();
      if (!content) return "";
      return ["First known use", "Etymology"].includes(heading) ? `**${heading}**\n${content}` : `**${heading}:** ${content}`;
    })].filter(Boolean).join("\n\n").trim();
  }

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
        const current = normalizeDefinitionText(textarea.value);
        const paragraph = String(preview.paragraph || "").trim();
        if (paragraph) { textarea.value = insertEtymologyDeterministically(current, paragraph); dispatchDefinitionInput(textarea); }
        if (preview.citation && !textarea.value.includes(preview.citation)) {
          const worksCitedHeading = /^\*\*Works Cited:?\*\*:?[\t ]*$/imu;
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
    const alphabetic = line.match(/^(\s*)([a-z])[.)]\s+(.*)$/iu);
    const match = unordered || ordered || alphabetic;
    if (!match) return;
    event.preventDefault();
    if (!match[3]) {
      textarea.setRangeText("", lineStart, caret, "end");
    } else {
      const marker = unordered
        ? `${match[1]}${match[2]} `
        : ordered
          ? `${match[1]}${Number(match[2]) + 1}. `
          : `${match[1]}${String.fromCharCode(Math.min("z".charCodeAt(0), match[2].toLowerCase().charCodeAt(0) + 1))}. `;
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
    const lines = source.split("\n").flatMap((line) => {
      const section = String(line).match(/^\*\*(First known use|Etymology):?\*\*:?[\t ]+(.+)$/iu);
      return section ? [`**${section[1]}**`, section[2]] : [line];
    });
    const listItemFromLine = (line) => {
      const match = String(line).match(/^([\t ]*)(?:(\d+)[.)]|([a-z])[.)]|[-+*])\s+(.+)$/iu);
      if (!match) return null;
      const indentation = match[1].replace(/\t/gu, "    ").length;
      return {
        indentation,
        listType: match[2] || match[3] ? "ol" : "ul",
        orderedStyle: match[3] ? "a" : "",
        text: match[4],
      };
    };
    const renderList = (start, indentation) => {
      const first = listItemFromLine(lines[start]);
      if (!first) return { html: "", next: start };
      const listType = first.listType;
      const orderedStyle = first.orderedStyle;
      const typeAttribute = orderedStyle ? ' type="a"' : "";
      const isSameList = (item) => item && item.indentation === indentation && item.listType === listType && (!item.orderedStyle || item.orderedStyle === orderedStyle);
      const output = [`<${listType}${typeAttribute}>`];
      let index = start;
      while (index < lines.length) {
        const item = listItemFromLine(lines[index]);
        if (!item) {
          const nextItem = !lines[index].trim() ? listItemFromLine(lines[index + 1]) : null;
          if (isSameList(nextItem)) {
            index += 1;
            continue;
          }
          break;
        }
        if (!isSameList(item)) break;
        output.push(`<li>${definitionInlineHtml(item.text)}`);
        index += 1;
        const nested = index < lines.length ? listItemFromLine(lines[index]) : null;
        if (nested && nested.indentation > indentation) {
          const renderedNested = renderList(index, nested.indentation);
          output.push(renderedNested.html);
          index = renderedNested.next;
        }
        output.push("</li>");
      }
      output.push(`</${listType}>`);
      return { html: output.join(""), next: index };
    };
    const output = [];
    const paragraph = [];
    const flushParagraph = () => {
      if (!paragraph.length) return;
      output.push(`<p>${paragraph.map((line) => definitionInlineHtml(line)).join("<br>")}</p>`);
      paragraph.length = 0;
    };
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        flushParagraph();
        index += 1;
        continue;
      }
      const item = listItemFromLine(line);
      if (item) {
        flushParagraph();
        const renderedList = renderList(index, item.indentation);
        output.push(renderedList.html);
        index = renderedList.next;
        continue;
      }
      paragraph.push(line);
      index += 1;
    }
    flushParagraph();
    return output.join("");
  }

  function definitionSections(value) {
    const sections = { body: [], firstKnownUse: [], stems: [], synonyms: [], antonyms: [], worksCited: [], etymology: [], originPath: [], verbForms: [] };
    const labels = {
      "first known use": "firstKnownUse",
      etymology: "etymology",
      "origin path": "originPath",
      "verb forms": "verbForms",
      stems: "stems",
      synonyms: "synonyms",
      antonyms: "antonyms",
      "works cited": "worksCited",
    };
    const headingFromLine = (line) => {
      const bold = String(line).match(/^\*\*(First known use|Etymology|Origin path|Verb Forms|Stems|Synonyms|Antonyms|Works Cited):?\*\*:?\s*(.*)$/iu);
      if (bold) return { key: labels[bold[1].toLowerCase()], content: bold[2] };
      const plain = String(line).match(/^(First known use|Etymology|Origin path|Verb Forms|Stems|Synonyms|Antonyms|Works Cited)\s*:?[\t ]*$/iu);
      return plain ? { key: labels[plain[1].toLowerCase()], content: "" } : null;
    };
    const stemListItem = /^\s*(?:(?:\d+|[a-z])[.)]|[-+*])\s+/iu;
    let section = "body";
    String(value == null ? "" : value).replace(/\r\n?/gu, "\n").split("\n").forEach((line) => {
      const heading = headingFromLine(line);
      if (heading) {
        section = heading.key || "body";
        if (heading.content) sections[section].push(heading.content);
        return;
      }
      // Stems are list-only. Legacy Etymonline payloads sometimes omit the Etymology heading and append prose after the stems list.
      if (section === "stems" && line.trim() && !stemListItem.test(line)) section = "etymology";
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
    if (sections.firstKnownUse) blocks.push(`<section class="new-word-entry-first-use"><strong>First known use</strong><div>${definitionHtml(sections.firstKnownUse)}</div></section>`);
    const originType = originTypeText(value("etymologyType"));
    const etymologyProse = [sections.etymology, value("etymology")].filter(Boolean).join("\n\n");
    const etymology = [originType ? `*${originType}*` : "", etymologyProse].filter(Boolean).join("; ");
    if (etymology) blocks.push(`<section class="new-word-entry-etymology"><strong>Etymology</strong><div>${definitionHtml(etymology)}</div></section>`);
    const originPath = [sections.originPath, value("originPath")].filter(Boolean).join("\n").trim();
    if (originPath) blocks.push(`<section class="new-word-entry-origin-path"><strong>Origin path</strong><div>${definitionHtml(originPath)}</div></section>`);
    if (value("partOfSpeech") === "verb" && ["verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5"].some((field) => value(field))) {
      const labels = ["INF", "V1", "V2", "V3", "V4", "V5"];
      blocks.push(`<section class="vocabulary-verb-forms-display"><strong>Verb Forms</strong>${labels.map((label, index) => `<div><strong>${label}</strong>: ${escapeHtml(value(index === 0 ? "verbInfinitive" : `verbV${index}`))}</div>`).join("")}</section>`);
    } else if (sections.verbForms) blocks.push(`<section class="vocabulary-verb-forms-display"><strong>Verb Forms</strong><div>${definitionHtml(sections.verbForms)}</div></section>`);
    if (sections.stems) blocks.push(`<section class="new-word-entry-stems"><strong>Stems</strong><div>${definitionHtml(sections.stems)}</div></section>`);
    if (sections.synonyms) blocks.push(`<section class="new-word-entry-synonyms"><strong>Synonyms</strong><div>${definitionHtml(sections.synonyms)}</div></section>`);
    if (sections.antonyms) blocks.push(`<section class="new-word-entry-antonyms"><strong>Antonyms</strong><div>${definitionHtml(sections.antonyms)}</div></section>`);
    const references = Array.isArray(value("originReferences")) ? value("originReferences") : [];
    const cited = [...references.map(referenceCitation), ...String(sections.worksCited || "").split("\n")]
      .map((citation) => String(citation).replace(/^\s*[-+*]\s+/u, "").replace(/\s+<--\s+dupe\s*$/iu, "").trim())
      .filter(Boolean);
    const uniqueCitations = [...new Map(cited.map((citation) => [citation.toLocaleLowerCase().replace(/\s+/gu, " "), citation])).values()];
    if (uniqueCitations.length) blocks.push(`<section class="vocabulary-origin-references"><strong>Works Cited</strong><div><ul>${uniqueCitations.map((citation) => `<li>${definitionInlineHtml(citation)}</li>`).join("")}</ul></div></section>`);
    return blocks.join("") || "No definition yet.";
  }

  function editorRowHtml(rowUid, { index = 0, removable = false, actionsHtml = "", includeMwFill = false, includeTransitivityTools = false, includeOriginAnalysis = false, originLookupPath = "", lookupButtons = null } = {}) {
    const uid = safeUid(rowUid);
    const options = POS.map((part) => `<option value="${part}">${part}</option>`).join("");
    const lookupLabels = Array.isArray(lookupButtons) && lookupButtons.length ? lookupButtons : ["LD", "GT", "WH", "ET", "MW", "TH", "CA", "CL", "GL"];
    const lookupHtml = lookupLabels.map((label) => {
      const key = String(label || "").trim();
      const lookup = LOOKUP_BUTTONS[key];
      if (!lookup) return "";
      const buttonClass = lookup.blue ? "portal-button-blue-action" : "external-link-turquoise portal-button-external-link-turquoise";
      const etymologyClass = key === "ET" ? " vocabulary-etymonline-lookup" : "";
      const originAttribute = key === "ET" ? ` data-vocabulary-origin-lookup="${escapeHtml(originLookupPath)}"` : "";
      return `<button type="button" class="portal-button ${buttonClass} news-vocabulary-lookup${etymologyClass}" data-vocabulary-lookup="${key}"${originAttribute} title="Look up the English word in the ${escapeHtml(lookup.title)}" aria-label="Look up the English word in the ${escapeHtml(lookup.title)}">${escapeHtml(lookup.text)}</button>`;
    }).join("");
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
          ${parametersHtml(uid, { includeMwFill, includeTransitivityTools, includeOriginAnalysis })}
          <div class="news-vocabulary-definition-row">
            <div class="news-vocabulary-lookups" aria-label="Vocabulary lookup links">
              ${lookupHtml}
              <p class="small vocabulary-et-message" data-vocabulary-et-message aria-live="polite"></p>
            </div>
            <textarea name="vocabularyDefinition-${uid}" data-vocabulary-field="definition" rows="1" maxlength="50000" placeholder="Definition" title="Up to 50,000 characters. Ctrl+B bold · Ctrl+I italic · Ctrl+U underline · Enter continues -, a., and 1. lists · indent nested items · **Heading** sections" aria-label="Definition, up to 50,000 characters" required></textarea>
            ${rowActions}
          </div>
        </div>`;
  }

  function flatEntryHeaderModel(entry = {}) {
    const source = entry && typeof entry === "object" ? entry : {};
    const esl = source.esl && typeof source.esl === "object" ? source.esl : {};
    const classification = source.grammarClassification || esl.grammarClassification || {};
    const value = (...fields) => fields
      .map((field) => source[field] ?? esl[field] ?? classification[field])
      .find((candidate) => ["string", "number", "boolean"].includes(typeof candidate) && String(candidate).trim() !== "") ?? "";
    const position = String(value("partOfSpeech") || "").toLowerCase();
    const nounPosition = position === "noun" || position === "proper noun";
    const legacyNounType = String(value("nounType") || "").toLowerCase();
    const physicalQuality = value("physicalQuality") || (["concrete", "abstract", "material"].includes(legacyNounType) ? legacyNounType : "");
    const grammaticalNumber = value("grammaticalNumber", "nounNumber");
    const primaryClassification = value("primaryClassification") || (["common", "proper", "collective", "compound", "possessive"].includes(legacyNounType) ? legacyNounType : "");
    const primaryMetadata = position === "verb"
      ? (value("displayVerbForm") ? String(value("displayVerbForm")).toUpperCase() : "")
      : nounPosition
        ? value("countability")
        : ["phrase", "pronoun", "determiner"].includes(position)
          ? value("grammarFamily")
          : value("grammarSubtype");
    const secondaryMetadataValues = position === "verb"
      ? [value("verbRegularity"), value("grammarFamily"), value("verbTransitivity")]
        : nounPosition
        ? [physicalQuality, grammaticalNumber, primaryClassification]
        : ["phrase", "pronoun", "determiner"].includes(position)
          ? [value("grammarSubtype"), value("grammarDetail"), value("grammarNumber")]
          : [value("grammarFamily"), value("grammarDetail"), value("grammarNumber")];
    return {
      english: value("english") || "New word",
      pronunciation: value("syllabication"),
      partOfSpeech: value("partOfSpeech"),
      primaryMetadata,
      vietnamese: value("vietnamese"),
      secondaryMetadata: secondaryMetadataValues.filter(Boolean).join(", "),
      legacyPending: source.isLegacyPending === true || value("reviewStatus") === "legacy_pending_review",
    };
  }

  function flatEntrySummaryText(entry = {}) {
    const model = flatEntryHeaderModel(entry);
    const primary = [model.english, `/${model.pronunciation}/`, model.partOfSpeech, model.primaryMetadata].filter(Boolean).join(" ");
    return `${primary} | vi: ${model.vietnamese} |${model.secondaryMetadata ? ` ${model.secondaryMetadata}` : ""}`;
  }

  function flatEntryHtml(entry = {}, { index = "", editClass = "vocabulary-flat-edit", editLabel = "Edit", editAttributes = "", entryAttributes = "", extraHtml = "", accordion = false } = {}) {
    const source = entry && typeof entry === "object" ? entry : {};
    const model = flatEntryHeaderModel(source);
    const value = (field) => source[field] ?? (source.esl && typeof source.esl === "object" ? source.esl[field] : undefined) ?? (source.grammarClassification && typeof source.grammarClassification === "object" ? source.grammarClassification[field] : undefined) ?? "";
    const json = escapeHtml(JSON.stringify(source));
    const indexAttribute = index === "" ? "" : ` data-vocabulary-entry-index="${escapeHtml(index)}"`;
    const editButton = editLabel === null ? "" : `<button type="button" class="portal-button portal-button-primary ${escapeHtml(editClass)}" ${editAttributes} title="Edit this vocabulary entry" aria-label="Edit this vocabulary entry">${escapeHtml(editLabel)}</button>`;
    const headerSeparator = `<span class="vocabulary-flat-entry-separator" aria-hidden="true">|</span>`;
    const header = `${accordion && model.legacyPending ? `<span class="vocabulary-flat-entry-status"><span class="chip chip-warn">Legacy</span></span>` : ""}
        <strong>${escapeHtml(model.english)}</strong>
        <span class="new-word-entry-pronunciation">/${escapeHtml(model.pronunciation)}/</span>
        <strong class="new-word-entry-part-of-speech">${escapeHtml(model.partOfSpeech)}</strong>
        ${model.primaryMetadata ? `<span class="vocabulary-flat-entry-subtype">${escapeHtml(model.primaryMetadata)}</span>` : ""}
        ${headerSeparator}
        <span class="new-word-entry-vietnamese">vi: ${escapeHtml(model.vietnamese)}</span>
        ${headerSeparator}
        ${model.secondaryMetadata ? `<span class="new-word-entry-pos-details">${escapeHtml(model.secondaryMetadata)}</span>` : ""}
        ${editButton}`;
    const body = `<div class="new-word-entry-definition">${entryDefinitionHtml(source, value)}</div>${extraHtml}`;
    if (accordion) {
      return `<details class="library-entry-accordion" data-vocabulary-flat-entry${indexAttribute} data-vocabulary-entry-json="${json}" ${entryAttributes}>
        <summary class="new-word-entry-head library-entry-accordion-summary">${header}</summary>
        <div class="library-entry-accordion-body">${body}</div>
      </details>`;
    }
    return `<article class="vocabulary-flat-entry new-word-entry" data-vocabulary-flat-entry${indexAttribute} data-vocabulary-entry-json="${json}" ${entryAttributes}>
      ${model.legacyPending ? `<div class="vocabulary-flat-entry-status"><span class="chip chip-warn">Legacy</span></div>` : ""}
      <div class="vocabulary-flat-entry-head new-word-entry-head">${header}</div>
      ${body}
    </article>`;
  }

  window.SIS_VOCABULARY_ESL = {
    POS,
    normalizeSyllabication,
    normalizeVocabularyEnglishText,
    isProperNounVocabularyEntry,
    vocabularyEnglishCapitalizationError,
    normalizeDefinitionText,
    canonicalizeSyllabication,
    parametersHtml,
    sync,
    hydrate,
    classification,
    originMetadata,
    readEditorEntry,
    grammarFields,
    editorRowHtml,
    flatEntrySummaryText,
    flatEntryHtml,
    definitionHtml,
    insertEtymologyDeterministically,
    bindLookupButtons,
    bindDefinitionAutosize,
  };
})();
