import assert from "node:assert/strict"
import test from "node:test"

import {
  DICTIONARY_BUILDER_DATUMS,
  DICTIONARY_BUILDER_BIC_WEIGHTS,
  DICTIONARY_BUILDER_MANIFEST,
  dictionaryBuilderBicDatumProviderIds,
  buildDictionaryBuilderCitations,
  dictionaryBuilderRoundRobinDatumSourceOrder,
  formatDictionaryBuilderDefinition,
  normalizeProviderPreview,
  previewHtmlAdapter,
  previewGoogleTranslateAdapter,
  previewDictionaryBuilder,
  readDictionaryBuilderSnapshot,
  retryDictionaryBuilderSnapshot,
} from "../src/modules/admin/dictionary-builder.mjs"

test("Dictionary Builder uses the locked BIC weights and hard availability gate", () => {
  assert.deepEqual(DICTIONARY_BUILDER_BIC_WEIGHTS, { completeness: 0.15, quality: 0.40, availability: 0.15, acceptance: 0.30 })
  assert.deepEqual(dictionaryBuilderBicDatumProviderIds("definition", [
    { provider: "ldoce", score: 99, status: "unavailable" },
    { provider: "britannica", score: 98, status: "not_provided" },
    { provider: "cambridge", score: 97, confirmedAvailable: true },
    { provider: "wiktionary", score: 96, confirmedAvailable: false },
  ]), ["cambridge"])
})

test("Dictionary Builder preserves mandatory source ordering without fallback substitution", () => {
  assert.deepEqual(dictionaryBuilderBicDatumProviderIds("syllabication", [
    { provider: "wordhelp", score: 0, status: "robot_blocked" },
    { provider: "merriam_webster", score: 99, status: "available" },
    { provider: "oxford_ame", score: 98, status: "available" },
  ]), ["merriam_webster"])
  assert.deepEqual(dictionaryBuilderBicDatumProviderIds("synonymsAntonyms", [
    { provider: "merriam_webster_thesaurus", score: 0, status: "not_found" },
    { provider: "britannica", score: 99, status: "available" },
  ]), ["britannica"])
})

test("Dictionary Builder V1.5 exposes all twelve availability-aware source adapters", () => {
  assert.equal(DICTIONARY_BUILDER_MANIFEST.length, 12)
  assert.deepEqual(DICTIONARY_BUILDER_MANIFEST.map((source) => source.label), ["LD", "OA", "OB", "BR", "MW", "AP", "ET", "WK", "CA", "TH", "WH", "GT"])
  assert.deepEqual(DICTIONARY_BUILDER_MANIFEST.filter((source) => source.capabilities.syllabication).map((source) => source.id), ["ldoce", "oxford_ame", "oxford_bre", "britannica", "merriam_webster", "merriam_webster_api", "wiktionary", "cambridge", "wordhelp"])
  const citations = buildDictionaryBuilderCitations("commend", "2026-08-26T00:00:00.000Z")
  assert.equal(citations.length, 12)
  assert.match(citations[0].citation, /Retrieved 2026-08-26/)
})

test("Dictionary Builder exposes normalized provider values under their matching tab datum", () => {
  const preview = normalizeProviderPreview(
    "britannica",
    {
      ok: true,
      sourceUrl: "https://www.britannica.com/dictionary/commend",
      fields: {
        definition: "to praise",
        dictionaryMetadata: {
          additionalSections: {
            stems: ["commend", "commended"],
            synonyms: ["praise"],
            antonyms: ["criticize"],
          },
        },
      },
      entries: [{
        headword: "commend",
        partOfSpeech: "verb",
        hyphenation: "com-mend",
        inflections: ["to commend", "commend", "commended", "commended", "commending", "commends"],
        senses: [{ number: "1", definition: "to praise", examples: [{ text: "They commended her work." }] }],
      }],
    },
    { english: "commend", partOfSpeech: "verb" },
  )
  assert.equal(preview.fields.syllabication, "com-mend")
  assert.equal(preview.fields.verbForms.verbV2, "commended")
  assert.equal(preview.fields.stems, "commend\ncommended")
  assert.match(preview.fields.synonymsAntonyms, /Synonyms:\npraise/)
  assert.match(preview.fields.synonymsAntonyms, /Antonyms:\ncriticize/)
  assert.equal(preview.fields.examples, "They commended her work.")
  for (const datum of ["syllabication", "stems", "synonymsAntonyms", "examples"]) assert.equal(preview.datumStatus[datum].status, "available")
  assert.equal(preview.datumStatus.verbForms.status, "not_offered")
})

test("WordHelp preserves count and uppercases the stressed syllable", async () => {
  const preview = await previewHtmlAdapter("wordhelp", { english: "language" }, async () => ({
      ok: true,
      status: 200,
      url: "https://www.wordhelp.com/syllables/english/?q=language",
      text: async () => '<main><h2>Syllables in language</h2><ul><li>How many syllables in language? 2 syllables</li><li>Divide language into syllables: lan-guage</li><li>Stressed syllable in language: <b>lan</b>-guage</li></ul></main>',
    }))
  assert.equal(preview.fields.syllableCount, 2)
  assert.equal(preview.fields.syllabication, "LAN-guage")
})

test("WordHelp 429 robot HTML hands off to browser HTML and parses the verified page", async () => {
  let browserCalls = 0
  let fetchCalls = 0
  const preview = await previewHtmlAdapter(
    "wordhelp",
    { english: "many" },
    async () => { fetchCalls += 1; return { ok: false, status: 429, text: async () => "Please verify that you are not a robot" } },
    async () => {
      browserCalls += 1
      return { ok: true, status: 200, url: "https://www.wordhelp.com/syllables/english/?q=many", html: "<main><li>Divide many into syllables: MAN-y</li><li>Stressed syllable in many: MAN</li><li>2 syllables</li></main>" }
    },
  )
  assert.equal(fetchCalls, 3)
  assert.equal(browserCalls, 1)
  assert.equal(preview.status, "available")
  assert.equal(preview.fields.syllabication, "MAN-y")
  assert.equal(preview.fields.syllableCount, 2)
})

test("Dictionary Builder caches a session-bound normalized snapshot without provider URLs", async () => {
  const unavailable = (provider) => async () => ({ provider, status: "unsupported", fields: {}, entries: [], media: [], datumStatus: { definition: { status: "unsupported" } } })
  const fetcher = Object.fromEntries(DICTIONARY_BUILDER_MANIFEST.map((source) => [source.id, unavailable(source.id)]))
  fetcher.ldoce = async () => ({ provider: "ldoce", status: "available", sourceUrl: "https://example.invalid/raw-provider-url", fields: { definition: "1. praise publicly" }, entries: [], media: [], datumStatus: { definition: { status: "available" } } })
  const snapshot = await previewDictionaryBuilder({ id: "entry-1", english: "commend", partOfSpeech: "verb" }, { ownerKey: "session-a", fetcher, rankedSources: [{ provider: "ldoce", score: 99 }, { provider: "britannica", score: 98 }, { provider: "merriam_webster", score: 97 }] })
  assert.equal(snapshot.sources[0].sourceUrl, undefined)
  assert.doesNotMatch(JSON.stringify(snapshot), /raw-provider-url/)
  assert.ok(readDictionaryBuilderSnapshot(snapshot.id, { ownerKey: "session-a", entryId: "entry-1" }))
  assert.equal(readDictionaryBuilderSnapshot(snapshot.id, { ownerKey: "session-b", entryId: "entry-1" }), null)
})

test("Dictionary Builder retries only the challenged provider in its existing snapshot", async () => {
  const calls = []
  const fetcher = Object.fromEntries(DICTIONARY_BUILDER_MANIFEST.map((source) => [source.id, async () => ({ provider: source.id, status: "unsupported", fields: {}, entries: [], media: [], datumStatus: {} })]))
  fetcher.ldoce = async () => {
    calls.push("ldoce")
    const challenged = calls.length === 1
    return {
      provider: "ldoce",
      status: challenged ? "robot_blocked" : "available",
      sourceUrl: "https://www.ldoceonline.com/dictionary/commend",
      fields: challenged ? {} : { definition: "to praise" },
      entries: [],
      media: [],
      datumStatus: { definition: { status: challenged ? "robot_blocked" : "available" } },
    }
  }
  const snapshot = await previewDictionaryBuilder(
    { id: "entry-retry", english: "commend", partOfSpeech: "verb" },
    { ownerKey: "session-retry", fetcher, rankedSources: [{ provider: "ldoce", score: 99 }] },
  )
  assert.equal(snapshot.sources.find((source) => source.provider === "ldoce")?.status, "robot_blocked")
  const retried = await retryDictionaryBuilderSnapshot(snapshot.id, { id: "entry-retry", english: "commend", partOfSpeech: "verb" }, { ownerKey: "session-retry", provider: "ldoce", fetcher })
  assert.equal(retried.sources.find((source) => source.provider === "ldoce")?.status, "available")
  assert.equal(retried.sources.find((source) => source.provider === "ldoce")?.fields.definition, "to praise")
  assert.deepEqual(calls, ["ldoce", "ldoce"])
  assert.equal(await retryDictionaryBuilderSnapshot(snapshot.id, { id: "other-entry" }, { ownerKey: "session-retry", provider: "ldoce", fetcher }), null)
})

test("Dictionary Builder first pass uses two Definition Proper sources, MW API, TH, GT, and WH", async () => {
  const calls = []
  const available = (provider) => async () => {
    calls.push(provider)
    return {
      provider,
      status: "available",
      fields: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, `${provider}-${datum}`])),
      entries: [],
      media: [],
      datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: "available" }])),
    }
  }
  const fetcher = Object.fromEntries(DICTIONARY_BUILDER_MANIFEST.map((source) => [source.id, available(source.id)]))
  const snapshot = await previewDictionaryBuilder(
    { id: "entry-2", english: "commend", partOfSpeech: "verb" },
    { ownerKey: "session-a", fetcher, rankedSources: [{ provider: "ldoce", score: 99 }, { provider: "britannica", score: 98 }, { provider: "merriam_webster", score: 97 }] },
  )
  assert.deepEqual(snapshot.sourceOrder, ["ldoce", "britannica", "merriam_webster", "merriam_webster_thesaurus", "google_translate", "wordhelp", "oxford_ame", "oxford_bre"])
  assert.deepEqual(calls, snapshot.sourceOrder)
  assert.equal(snapshot.sources.length, 8)
})

test("Dictionary Builder queries the complete ranked datum set without fallback substitution", async () => {
  const calls = []
  const unavailable = (provider) => async () => {
    calls.push(provider)
    return { provider, status: "unsupported", fields: {}, entries: [], media: [], datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: "not_offered" }])) }
  }
  const fetcher = Object.fromEntries(DICTIONARY_BUILDER_MANIFEST.map((source) => [source.id, unavailable(source.id)]))
  fetcher.ldoce = async () => { calls.push("ldoce"); return { provider: "ldoce", status: "available", fields: { definition: "to praise" }, entries: [], media: [], datumStatus: { definition: { status: "available" } } } }
  fetcher.britannica = async () => { calls.push("britannica"); return { provider: "britannica", status: "available", fields: { examples: "Britannica example" }, entries: [], media: [], datumStatus: { examples: { status: "available" } } } }
  fetcher.cambridge = async () => { calls.push("cambridge"); return { provider: "cambridge", status: "available", fields: { examples: "Cambridge example" }, entries: [], media: [], datumStatus: { examples: { status: "available" } } } }
  const rankedExamples = [{ provider: "britannica", score: 99 }, { provider: "cambridge", score: 98 }, { provider: "oxford_ame", score: 97 }]
  const snapshot = await previewDictionaryBuilder(
    { id: "entry-ranked", english: "commend", partOfSpeech: "verb" },
    { ownerKey: "session-ranked", fetcher, rankedSources: [{ provider: "ldoce", score: 99 }], rankedSourcesByDatum: { examples: rankedExamples } },
  )
  assert.deepEqual(snapshot.datumSourceOrder.examples, ["britannica", "cambridge", "oxford_ame"])
  assert.deepEqual(snapshot.bicTopThreeByDatum.examples, ["britannica", "cambridge"])
  assert.ok(calls.includes("britannica"))
  assert.ok(calls.includes("cambridge"))
  assert.ok(calls.includes("oxford_ame"))
})

test("Syllable / Stress uses WordHelp and MW API only", async () => {
  const calls = []
  const sourceWithNoSyllabication = (provider) => async () => {
    calls.push(provider)
    return {
      provider,
      status: "available",
      fields: { definition: `${provider} definition` },
      entries: [],
      media: [],
      datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: datum === "syllabication" ? "unavailable" : "available" }])),
    }
  }
  const fetcher = Object.fromEntries(DICTIONARY_BUILDER_MANIFEST.map((source) => [source.id, sourceWithNoSyllabication(source.id)]))
  fetcher.wordhelp = async () => {
    calls.push("wordhelp")
    return { provider: "wordhelp", status: "manual", fields: {}, entries: [], media: [], datumStatus: { syllabication: { status: "manual" } } }
  }
  const rankedSyllabicationSources = [
    { provider: "merriam_webster", score: 90 }, { provider: "oxford_ame", score: 88 }, { provider: "ldoce", score: 86 }, { provider: "britannica", score: 82 },
    { provider: "oxford_bre", score: 78 }, { provider: "wordhelp", score: 75 }, { provider: "wiktionary", score: 70 }, { provider: "cambridge", score: 65 },
  ]
  assert.deepEqual(dictionaryBuilderRoundRobinDatumSourceOrder("syllabication", rankedSyllabicationSources, 1), ["oxford_ame", "ldoce", "merriam_webster", "britannica", "oxford_bre", "wordhelp", "wiktionary", "cambridge"])
  assert.deepEqual(dictionaryBuilderBicDatumProviderIds("syllabication", rankedSyllabicationSources), ["wordhelp", "merriam_webster"])
  const snapshot = await previewDictionaryBuilder(
    { id: "entry-3", english: "commend", partOfSpeech: "verb" },
    {
      ownerKey: "session-a",
      fetcher,
      rankedSources: [{ provider: "ldoce", score: 99 }, { provider: "britannica", score: 98 }, { provider: "merriam_webster", score: 97 }],
      rankedSourcesByDatum: { syllabication: rankedSyllabicationSources },
      datumRoundRobinOffsets: { syllabication: 1 },
    },
  )
  assert.deepEqual(snapshot.datumSourceOrder.syllabication, ["wordhelp", "merriam_webster"])
  assert.equal(new Set(snapshot.datumSourceOrder.syllabication).size, 2)
  for (const provider of ["wordhelp", "merriam_webster"]) assert.ok(calls.includes(provider))
  for (const provider of ["wordhelp", "merriam_webster"]) assert.equal(calls.filter((called) => called === provider).length, 1)
  assert.equal(snapshot.sources.find((source) => source.provider === "wordhelp")?.datumStatus?.syllabication?.status, "manual")
})

test("Verb Forms requires MW API first and falls back to OA then OB", async () => {
  const fetcher = {
    merriam_webster_api: async () => ({ provider: "merriam_webster_api", status: "available", fields: {}, datumStatus: { verbForms: { status: "not_provided" } } }),
    oxford_ame: async () => ({ provider: "oxford_ame", status: "available", fields: { verbForms: { verbV1: "commend" } }, datumStatus: { verbForms: { status: "available" } } }),
    oxford_bre: async () => ({ provider: "oxford_bre", status: "available", fields: { verbForms: { verbV1: "commend" } }, datumStatus: { verbForms: { status: "available" } } }),
  }
  const snapshot = await previewDictionaryBuilder({ id: "entry-verb-fallback", english: "commend", partOfSpeech: "verb" }, { ownerKey: "session-verb-fallback", fetcher, rankedSources: [{ provider: "ldoce", score: 99 }] })
  assert.deepEqual(snapshot.datumSourceOrder.verbForms, ["merriam_webster_api", "oxford_ame", "oxford_bre"])
})

test("Oxford irregular verb previews preserve every returned form", () => {
  const preview = normalizeProviderPreview("oxford_ame", {
    ok: true,
    sourceUrl: "https://www.oxfordlearnersdictionaries.com/definition/american_english/go",
    fields: { verbForms: { verbInfinitive: "to go", verbV1: "go", verbV2: "went", verbV3: "gone", verbV4: "going", verbV5: "goes" } },
  }, { english: "go", partOfSpeech: "verb" })
  assert.deepEqual(preview.fields.verbForms, { verbInfinitive: "to go", verbV1: "go", verbV2: "went", verbV3: "gone", verbV4: "going", verbV5: "goes" })
})

test("Dictionary Builder excludes zero-score fallbacks and limits First known use to MW variants and WK", () => {
  assert.deepEqual(
    dictionaryBuilderBicDatumProviderIds("definition", [{ provider: "ldoce", score: 82 }, { provider: "britannica", score: 0 }, { provider: "merriam_webster", score: -1 }]),
    ["ldoce"],
  )
  assert.deepEqual(
    dictionaryBuilderBicDatumProviderIds("firstKnownUse", [{ provider: "britannica", score: 99 }, { provider: "merriam_webster_api", score: 85 }, { provider: "merriam_webster_scrape", score: 84 }, { provider: "wiktionary", score: 70 }]),
    ["merriam_webster_api", "merriam_webster_scrape", "wiktionary"],
  )
  assert.deepEqual(
    dictionaryBuilderBicDatumProviderIds("synonymsAntonyms", [{ provider: "britannica", score: 99 }, { provider: "merriam_webster_thesaurus", score: 1 }]),
    ["merriam_webster_thesaurus", "britannica"],
  )
  const notProvided = normalizeProviderPreview("merriam_webster_thesaurus", { ok: true, fields: {}, sourceUrl: "https://example.test/thesaurus/missing" }, { english: "missing", partOfSpeech: "noun" })
  assert.equal(notProvided.datumStatus.synonymsAntonyms.status, "not_provided")
  const notFound = normalizeProviderPreview("merriam_webster_thesaurus", { ok: false, status: "not_found", message: "HTTP 404" }, { english: "missing", partOfSpeech: "noun" })
  assert.equal(notFound.status, "not_found")
  assert.equal(notFound.datumStatus.synonymsAntonyms.status, "not_found")
  const robotBlocked = normalizeProviderPreview("wordhelp", { ok: false, status: "robot_blocked", message: "WordHelp requires robot verification; open the source page and complete the prompt before retrying.", sourceUrl: "https://www.wordhelp.com/syllables/english/?q=language" }, { english: "language", partOfSpeech: "noun" })
  assert.equal(robotBlocked.status, "robot_blocked")
  assert.equal(robotBlocked.datumStatus.syllabication.status, "robot_blocked")
})

test("Synonyms / Antonyms excludes not-provided Britannica while keeping MW API rows", () => {
  const preview = normalizeProviderPreview("merriam_webster", {
    ok: true,
    sourceUrl: "https://api.dictionaryapi.com/v3/references/collegiate/json/commend",
    fields: { synonymsAntonyms: "Synonyms:\npraise\napplaud\ncommend\nesteem\nlaud\n\nAntonyms:\nblame\ncriticize\ncondemn\nreject\ndisparage" },
  }, { english: "commend", partOfSpeech: "verb" })
  assert.match(preview.fields.synonymsAntonyms, /laud\n/u)
  assert.match(preview.fields.synonymsAntonyms, /disparage\n?$/u)
  assert.deepEqual(dictionaryBuilderBicDatumProviderIds("synonymsAntonyms", [
    { provider: "britannica", score: 99, status: "not_provided" },
    { provider: "merriam_webster_api", score: 98, status: "available" },
    { provider: "merriam_webster_thesaurus", score: 97, status: "unavailable" },
  ]), ["merriam_webster_api"])
})

test("MW Thesaurus keeps only the top four rows in each relation category", async () => {
  const result = await previewHtmlAdapter("merriam_webster_thesaurus", { english: "commend" }, async () => ({
    ok: true,
    url: "https://www.merriam-webster.com/thesaurus/commend",
    text: async () => '<main><section class="synonym-list"><ul><li>praise</li><li>applaud</li><li>esteem</li><li>laud</li><li>honor</li></ul></section><section class="antonym-list"><ul><li>blame</li><li>criticize</li><li>condemn</li><li>reject</li><li>disparage</li></ul></section></main>',
  }))
  assert.equal(result.datumStatus.synonymsAntonyms.status, "available")
  assert.equal(result.fields.synonymsAntonyms, "Synonyms:\npraise\napplaud\nesteem\nlaud\n\nAntonyms:\nblame\ncriticize\ncondemn\nreject")

  const wordLimited = await previewHtmlAdapter("merriam_webster_thesaurus", { english: "approve" }, async () => ({
    ok: true,
    url: "https://www.merriam-webster.com/thesaurus/approve",
    text: async () => '<main><section class="synonym-list"><ul><li>one two three four</li><li>five six seven eight</li><li>nine ten eleven twelve</li><li>thirteen</li></ul></section></main>',
  }))
  assert.equal(wordLimited.fields.synonymsAntonyms, "Synonyms:\none two three four\nfive six seven eight\nnine ten eleven twelve")
})

test("Dictionary Builder always sources Vietnamese from the automatic Google Translate adapter", async () => {
  const requests = []
  const result = await previewGoogleTranslateAdapter(
    { english: "commend" },
    { fetchImpl: async (url) => { requests.push(String(url)); return { ok: true, status: 200, text: async () => '<div class="result-container">khen ng\u1ee3i</div>' } } },
  )
  assert.deepEqual(requests, ["https://translate.google.com/m?sl=en&tl=vi&q=commend"])
  assert.equal(result.provider, "google_translate")
  assert.equal(result.fields.vietnamese, "khen ng\u1ee3i")
  assert.equal(result.datumStatus.vietnamese.status, "available")
  assert.equal(result.datumStatus.definition.status, "not_offered")
})

test("Dictionary Builder definition keeps safe rules, YTBD, and twelve dynamic citations", () => {
  const definition = formatDictionaryBuilderDefinition({ english: "commend", partOfSpeech: "verb" }, {
    definition: "1. to praise publicly",
    verbInfinitive: "to commend", verbV1: "commend", verbV2: "commended", verbV3: "commended", verbV4: "commending", verbV5: "commends",
    stems: "commend\ncommended\ncommending\ncommends",
    synonymsAntonyms: "Synonyms:\npraise\napplaud\n\nAntonyms:\ncriticize",
    examples: "The report commended the team for its careful work.",
  }, buildDictionaryBuilderCitations("commend", "2026-08-26T00:00:00.000Z"))
  assert.match(definition, /\*\*Verb Forms\*\*[\s\S]*INF: to commend[\s\S]*V5: commends/u)
  assert.match(definition, /\*\*Stems\*\*[\s\S]*  - commended/u)
  assert.match(definition, /\| \*\*Synonyms\*\* \| \*\*Antonyms\*\*/u)
  assert.match(definition, /\*\*Examples of commend in a Sentence\*\*/u)
  assert.match(definition, /<hr>/)
  assert.match(definition, /\*\*Origin path\*\*\nYTBD/)
  assert.equal((definition.match(/Retrieved 2026-08-26/g) || []).length, 12)
})
