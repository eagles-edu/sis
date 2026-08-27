import assert from "node:assert/strict"
import test from "node:test"

import {
  DICTIONARY_BUILDER_DATUMS,
  DICTIONARY_BUILDER_MANIFEST,
  dictionaryBuilderBicDatumProviderIds,
  buildDictionaryBuilderCitations,
  dictionaryBuilderRoundRobinDatumSourceOrder,
  formatDictionaryBuilderDefinition,
  normalizeProviderPreview,
  previewGoogleTranslateAdapter,
  previewDictionaryBuilder,
  readDictionaryBuilderSnapshot,
} from "../src/modules/admin/dictionary-builder.mjs"

test("Dictionary Builder V1.5 exposes all twelve availability-aware source adapters", () => {
  assert.equal(DICTIONARY_BUILDER_MANIFEST.length, 12)
  assert.deepEqual(DICTIONARY_BUILDER_MANIFEST.map((source) => source.label), ["LD", "OA", "OB", "BR", "MW", "ET", "WK", "CA", "TH", "WH", "GT", "GL"])
  assert.deepEqual(DICTIONARY_BUILDER_MANIFEST.filter((source) => source.capabilities.syllabication).map((source) => source.id), ["ldoce", "oxford_ame", "oxford_bre", "britannica", "merriam_webster", "wiktionary", "cambridge", "wordhelp"])
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
            recentExamples: ["They commended her work."],
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
  for (const datum of ["syllabication", "stems", "synonymsAntonyms", "examples", "recentExamples"]) assert.equal(preview.datumStatus[datum].status, "available")
  assert.equal(preview.datumStatus.verbForms.status, "not_offered")
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

test("Dictionary Builder first pass uses two Definition Proper sources, MW API, GT, and WH", async () => {
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
  assert.deepEqual(snapshot.sourceOrder, ["britannica", "ldoce", "merriam_webster", "google_translate", "wordhelp"])
  assert.deepEqual(calls, snapshot.sourceOrder)
  assert.equal(snapshot.sources.length, 5)
})

test("Syllable / Stress uses WordHelp plus two matrix-eligible BIC providers", async () => {
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
  assert.deepEqual(dictionaryBuilderBicDatumProviderIds("syllabication", rankedSyllabicationSources), ["wordhelp", "merriam_webster", "oxford_ame"])
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
  assert.deepEqual(snapshot.datumSourceOrder.syllabication, ["wordhelp", "merriam_webster", "oxford_ame"])
  for (const provider of ["wordhelp", "merriam_webster", "oxford_ame"]) assert.ok(calls.includes(provider))
  assert.equal(snapshot.sources.find((source) => source.provider === "wordhelp")?.datumStatus?.syllabication?.status, "manual")
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
  const definition = formatDictionaryBuilderDefinition({ english: "commend", partOfSpeech: "verb" }, { definition: "1. to praise publicly" }, buildDictionaryBuilderCitations("commend", "2026-08-26T00:00:00.000Z"))
  assert.match(definition, /<hr>/)
  assert.match(definition, /\*\*Origin path\*\*\nYTBD/)
  assert.equal((definition.match(/Retrieved 2026-08-26/g) || []).length, 12)
})
