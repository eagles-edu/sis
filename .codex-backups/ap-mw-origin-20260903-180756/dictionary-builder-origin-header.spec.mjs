import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { applyDictionaryBuilderSnapshot } from "../src/modules/admin/library-corpus.mjs"

import {
  DICTIONARY_BUILDER_DATUM_STATUS,
  DICTIONARY_BUILDER_DATUMS,
  DICTIONARY_BUILDER_MANDATORY_DATUM_PROVIDERS,
  DICTIONARY_BUILDER_INITIAL_SERVER_PROVIDERS,
  DICTIONARY_BUILDER_BIC_WEIGHTS,
  DICTIONARY_BUILDER_MANIFEST,
  dictionaryBuilderBicDatumProviderIds,
  buildDictionaryBuilderCitations,
  buildSelectedDictionaryBuilderCitations,
  dictionaryBuilderRoundRobinDatumSourceOrder,
  formatDictionaryBuilderDefinition,
  normalizeProviderPreview,
  previewHtmlAdapter,
  previewGoogleTranslateAdapter,
  previewDictionaryBuilder,
  recordDictionaryBuilderMetrics,
  readDictionaryBuilderSnapshot,
  retryDictionaryBuilderSnapshot,
} from "../src/modules/admin/dictionary-builder.mjs"
import { fetchWithExponentialBackoff } from "../src/modules/admin/provider-http.mjs"

test("Dictionary Builder collects headword audio from every provider POS entry", () => {
  const result = normalizeProviderPreview("britannica", {
    ok: true,
    sourceUrl: "https://example.test/word",
    entries: [
      { headword: "word", partOfSpeech: "verb", audio: { us: "https://media.example.test/verb.mp3" }, senses: [] },
      { headword: "word", partOfSpeech: "noun", audio: { us: "https://media.example.test/noun.mp3" }, senses: [] },
    ],
    fields: {},
  }, { english: "word", partOfSpeech: "noun" })
  assert.equal(result.fields.audio.length, 1)
  assert.equal(result.privateMedia[0].sourceUrl, "https://media.example.test/verb.mp3")
})

test("provider backoff stops immediately when its request is aborted", async () => {
  const controller = new AbortController()
  let calls = 0
  const request = fetchWithExponentialBackoff(async (_url, options) => {
    calls += 1
    await new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })
    })
  }, "https://provider.invalid/entry", { signal: controller.signal })
  controller.abort(new Error("preview timed out"))
  await assert.rejects(request, /preview timed out/)
  assert.equal(calls, 1)
})

test("Dictionary Builder uses the locked BIC weights and hard availability gate", () => {
  assert.deepEqual(DICTIONARY_BUILDER_BIC_WEIGHTS, { completeness: 0.15, quality: 0.40, availability: 0.15, acceptance: 0.30 })
  assert.deepEqual(dictionaryBuilderBicDatumProviderIds("definition", [
    { provider: "ldoce", score: 99, status: "unavailable" },
    { provider: "britannica", score: 98, status: "not_provided" },
    { provider: "cambridge", score: 97, confirmedAvailable: true },
    { provider: "wiktionary", score: 96, confirmedAvailable: false },
  ]), ["cambridge"])
})

test("Dictionary Builder preserves prompt states as paused datum statuses", () => {
  assert.deepEqual(DICTIONARY_BUILDER_DATUM_STATUS.slice(0, 8), ["available", "not_offered", "not_found", "not_provided", "robot_blocked", "cookie_prompt", "robot_prompt", "paused"])
})

test("Dictionary Builder uses mandatory datum sources and a universal top-three BIC cap", () => {
  assert.deepEqual(DICTIONARY_BUILDER_MANDATORY_DATUM_PROVIDERS, {
    vietnamese: ["google_translate"],
    syllabication: ["wordhelp", "ldoce"],
    syllableCount: ["wordhelp"],
    audio: ["britannica"],
    verbFormAudio: ["oxford_ame"],
    verbForms: ["merriam_webster_api"],
    synonymsAntonyms: ["merriam_webster_thesaurus"],
    firstKnownUse: ["merriam_webster_api"],
  })
  const ranked = [
    { provider: "ldoce", score: 99, status: "available" },
    { provider: "oxford_ame", score: 98, status: "available" },
    { provider: "britannica", score: 97, status: "available" },
    { provider: "cambridge", score: 96, status: "available" },
    { provider: "google_translate", score: 95, status: "available" },
  ]
  assert.deepEqual(dictionaryBuilderBicDatumProviderIds("definition", ranked), ["ldoce", "oxford_ame", "britannica"])
  assert.deepEqual(dictionaryBuilderBicDatumProviderIds("audio", ranked), ["britannica", "ldoce", "oxford_ame"])
  assert.deepEqual(dictionaryBuilderBicDatumProviderIds("vietnamese", ranked), ["google_translate"])
  assert.ok(dictionaryBuilderBicDatumProviderIds("definition", ranked).every((provider) => provider !== "google_translate"))
})

test("Dictionary Builder always pulls the locked seven initial sources", () => {
  assert.deepEqual(DICTIONARY_BUILDER_INITIAL_SERVER_PROVIDERS, ["ldoce", "oxford_ame", "merriam_webster_thesaurus", "britannica", "merriam_webster_scrape", "merriam_webster_api", "wordhelp"])
})

test("Dictionary Builder pre-opener excludes the API-only AP source", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "web-asset/admin/library-review-workbench.js"), "utf8")
  assert.match(source, /const INITIAL_SOURCE_GROUP_SIZE = 6/)
  assert.match(source, /const INITIAL_SOURCE_PROVIDER_ORDER = \["ldoce", "oxford_ame", "merriam_webster_thesaurus", "britannica", "merriam_webster_scrape", "wordhelp"\]/)
  assert.doesNotMatch(source, /INITIAL_SOURCE_PROVIDER_ORDER[^\n]*merriam_webster_api/)
  assert.match(source, /AP uses the protected Merriam-Webster API and does not need a browser tab/)
})

test("Dictionary Builder staggers initial provider tab navigation", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "web-asset/admin/library-review-workbench.js"), "utf8")
  assert.match(source, /pendingNavigations\.forEach\(\(\{ tab, sourceUrl \}, index\) => \{[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?tab\.location\.href = sourceUrl[\s\S]*?\}, index \* 1000\)/)
})

test("Dictionary Builder metrics count only available and 404 or not-offered outcomes", async () => {
  const calls = []
  const client = { dictionaryProviderSuitabilityMetric: { upsert: async (args) => calls.push(args) } }
  await recordDictionaryBuilderMetrics(client, {
    sources: [
      { provider: "britannica", datumStatus: { definition: { status: "available" } } },
      { provider: "oxford_ame", datumStatus: { definition: { status: "not_found" } } },
      { provider: "ldoce", datumStatus: { definition: { status: "robot_blocked" } } },
      { provider: "merriam_webster", datumStatus: { definition: { status: "not_offered" } } },
      { provider: "cambridge", datumStatus: { definition: { status: "unavailable" } } },
    ],
  }, [{ provider: "britannica", datum: "definition" }], "noun")
  assert.deepEqual(calls.map((call) => [call.create.provider, call.create.datum]), [["britannica", "definition"], ["oxford_ame", "definition"], ["merriam_webster_scrape", "definition"]])
  assert.deepEqual(calls[0].create, { provider: "britannica", partOfSpeech: "noun", datum: "definition", attemptCount: 1, availableCount: 1, eligibleApplyCount: 1, selectedApplyCount: 1 })
  assert.deepEqual(calls[1].create, { provider: "oxford_ame", partOfSpeech: "noun", datum: "definition", attemptCount: 1, availableCount: 0, eligibleApplyCount: 0, selectedApplyCount: 0 })
  assert.deepEqual(calls[2].create, { provider: "merriam_webster_scrape", partOfSpeech: "noun", datum: "definition", attemptCount: 1, availableCount: 0, eligibleApplyCount: 0, selectedApplyCount: 0 })
})

test("Dictionary Builder records MW HTML and API metrics independently", async () => {
  const calls = []
  const client = { dictionaryProviderSuitabilityMetric: { upsert: async (args) => calls.push(args) } }
  await recordDictionaryBuilderMetrics(client, {
    sources: [
      { provider: "merriam_webster_scrape", datumStatus: { definition: { status: "available" } } },
      { provider: "merriam_webster_api", datumStatus: { definition: { status: "available" } } },
    ],
  }, [{ provider: "merriam_webster_scrape", datum: "definition" }], "noun")
  assert.deepEqual(calls.map((call) => call.create.provider), ["merriam_webster_scrape", "merriam_webster_api"])
  assert.deepEqual(calls.map((call) => call.create.selectedApplyCount), [1, 0])
})

test("Dictionary Builder preserves mandatory source ordering without fallback substitution", () => {
  assert.deepEqual(dictionaryBuilderBicDatumProviderIds("syllabication", [
    { provider: "wordhelp", score: 0, status: "robot_blocked" },
    { provider: "merriam_webster", score: 99, status: "available" },
    { provider: "oxford_ame", score: 98, status: "available" },
  ]), ["wordhelp", "ldoce", "merriam_webster"])
  assert.deepEqual(dictionaryBuilderBicDatumProviderIds("synonymsAntonyms", [
    { provider: "merriam_webster_thesaurus", score: 0, status: "not_found" },
    { provider: "britannica", score: 99, status: "available" },
  ]), ["merriam_webster_thesaurus", "britannica"])
})

test("Dictionary Builder V1.5 exposes all twelve availability-aware source adapters", () => {
  assert.equal(DICTIONARY_BUILDER_MANIFEST.length, 12)
  assert.deepEqual(DICTIONARY_BUILDER_MANIFEST.map((source) => source.label), ["LD", "OA", "OB", "BR", "MW", "AP", "ET", "WK", "CA", "TH", "WH", "GT"])
  assert.deepEqual(DICTIONARY_BUILDER_MANIFEST.filter((source) => source.capabilities.originPath).map((source) => source.id), ["merriam_webster", "merriam_webster_api", "etymonline", "wiktionary"])
  assert.deepEqual(DICTIONARY_BUILDER_MANIFEST.filter((source) => source.capabilities.syllabication).map((source) => source.id), ["ldoce", "oxford_ame", "oxford_bre", "britannica", "merriam_webster", "merriam_webster_api", "wiktionary", "cambridge", "wordhelp"])
  const citations = buildDictionaryBuilderCitations("commend", "2026-08-26T00:00:00.000Z")
  assert.equal(citations.length, 12)
  assert.deepEqual(citations.map((item) => item.key), ["definition_primary", "definition_related_pos_1", "definition_related_pos_2", "audio_uk", "audio_us", "verb_forms", "stems", "lexical_relations", "sentence_examples", "recent_examples", "first_known_use", "etymology_origin"])
  const selectedCitations = buildSelectedDictionaryBuilderCitations("commend", "2026-08-26T00:00:00.000Z", [{ field: "definition", provider: "britannica", status: "available" }], [{ provider: "britannica", sourceUrl: "https://www.britannica.com/dictionary/commend" }])
  assert.match(selectedCitations.find((item) => item.key === "definition_primary").citation, /Retrieved 2026-08-26/)
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

test("Dictionary Builder preserves Oxford verb-form audio through normalization", () => {
  const preview = normalizeProviderPreview("oxford_ame", {
    ok: true,
    sourceUrl: "https://www.oxfordlearnersdictionaries.com/definition/american_english/transact",
    fields: {
      definition: "to do business",
      verbForms: { verbInfinitive: "to transact", verbV1: "transact" },
      verbFormAudio: { verbV1: { us: "https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/t/tra/trans/transact__us_1.mp3" } },
    },
    entries: [{ headword: "transact", partOfSpeech: "verb", senses: [] }],
  }, { english: "transact", partOfSpeech: "verb" })
  assert.equal(preview.datumStatus.verbFormAudio.status, "available")
  assert.equal(preview.fields.verbFormAudio.verbV1.us, true)
  assert.equal(preview.fields.verbFormAudio.verbV1.fileName, "transact__us_1.mp3")
  assert.doesNotMatch(JSON.stringify(preview.fields), /oxfordlearnersdictionaries\.com/iu)
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

test("Dictionary Builder caches a session-bound normalized snapshot with safe source URLs", async () => {
  const unavailable = (provider) => async () => ({ provider, status: "unsupported", fields: {}, entries: [], media: [], datumStatus: { definition: { status: "unsupported" } } })
  const fetcher = Object.fromEntries(DICTIONARY_BUILDER_MANIFEST.map((source) => [source.id, unavailable(source.id)]))
  fetcher.ldoce = async () => ({ provider: "ldoce", status: "available", sourceUrl: "https://example.invalid/raw-provider-url", fields: { definition: "1. praise publicly" }, entries: [], media: [], datumStatus: { definition: { status: "available" } } })
  const snapshot = await previewDictionaryBuilder({ id: "entry-1", english: "commend", partOfSpeech: "verb" }, { ownerKey: "session-a", fetcher, rankedSources: [{ provider: "ldoce", score: 99 }, { provider: "britannica", score: 98 }, { provider: "merriam_webster", score: 97 }] })
  assert.equal(snapshot.sources[0].sourceUrl, "https://www.ldoceonline.com/dictionary/commend")
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

test("Dictionary Builder first pass uses the locked initial sources plus GT", async () => {
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
  assert.deepEqual(snapshot.sourceOrder.map((provider) => provider === "merriam_webster_scrape" ? "merriam_webster" : provider), ["ldoce", "oxford_ame", "merriam_webster_thesaurus", "britannica", "merriam_webster", "merriam_webster_api", "wordhelp", "google_translate"])
  assert.deepEqual(calls.map((provider) => provider === "merriam_webster" ? "merriam_webster_scrape" : provider), snapshot.sourceOrder)
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

test("Dictionary Builder keeps Britannica as the default audio source while scoring the remaining audio sources", async () => {
  const available = (provider) => async () => ({
    provider,
    status: "available",
    fields: { audio: { us: `https://${provider}.example/audio.mp3` } },
    entries: [],
    media: [],
    datumStatus: { audio: { status: "available" } },
  })
  const fetcher = Object.fromEntries(DICTIONARY_BUILDER_MANIFEST.map((source) => [source.id, available(source.id)]))
  const snapshot = await previewDictionaryBuilder(
    { id: "entry-audio-ranking", english: "dispute", partOfSpeech: "noun" },
    {
      ownerKey: "session-audio-ranking",
      fetcher,
      rankedSources: [{ provider: "ldoce", score: 99 }],
      rankedSourcesByDatum: { audio: [{ provider: "merriam_webster_scrape", score: 99 }, { provider: "cambridge", score: 97 }, { provider: "britannica", score: 70 }] },
    },
  )
  assert.equal(snapshot.datumSourceOrder.audio[0], "britannica")
  assert.deepEqual(snapshot.datumSourceOrder.audio.slice(0, 3), ["britannica", "merriam_webster_scrape", "cambridge"])
  assert.equal(snapshot.bicTopThreeByDatum.audio[0], "britannica")
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
  assert.deepEqual(dictionaryBuilderBicDatumProviderIds("syllabication", rankedSyllabicationSources), ["wordhelp", "ldoce", "merriam_webster"])
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
  assert.deepEqual(snapshot.datumSourceOrder.syllabication, ["wordhelp", "ldoce", "merriam_webster_scrape"])
  assert.equal(new Set(snapshot.datumSourceOrder.syllabication).size, 3)
  for (const provider of ["wordhelp", "ldoce", "merriam_webster"]) assert.ok(calls.includes(provider))
  for (const provider of ["wordhelp", "ldoce", "merriam_webster"]) assert.equal(calls.filter((called) => called === provider).length, 1)
  assert.equal(snapshot.sources.find((source) => source.provider === "wordhelp")?.datumStatus?.syllabication?.status, "manual")
})

test("Verb Forms requires MW API first and falls back to OA then OB", async () => {
  const fetcher = {
    merriam_webster_api: async () => ({ provider: "merriam_webster_api", status: "available", fields: {}, datumStatus: { verbForms: { status: "not_provided" } } }),
    oxford_ame: async () => ({ provider: "oxford_ame", status: "available", fields: { verbForms: { verbV1: "commend" } }, datumStatus: { verbForms: { status: "available" } } }),
    oxford_bre: async () => ({ provider: "oxford_bre", status: "available", fields: { verbForms: { verbV1: "commend" } }, datumStatus: { verbForms: { status: "available" } } }),
  }
  const snapshot = await previewDictionaryBuilder({ id: "entry-verb-fallback", english: "commend", partOfSpeech: "verb" }, { ownerKey: "session-verb-fallback", fetcher, rankedSources: [{ provider: "ldoce", score: 99 }] })
  assert.deepEqual(snapshot.datumSourceOrder.verbForms, ["merriam_webster_api"])
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
  ]), ["merriam_webster_thesaurus", "merriam_webster_api"])
})

test("MW Thesaurus keeps only the top four rows in each relation category", async () => {
  const result = await previewHtmlAdapter("merriam_webster_thesaurus", { english: "commend", partOfSpeech: "verb" }, async () => ({
    ok: true,
    url: "https://www.merriam-webster.com/thesaurus/commend",
    text: async () => '<main><section class="thesaurus-pos"><h2>verb</h2><section class="synonym-list"><ul><li>praise</li><li>applaud</li><li>esteem</li><li>laud</li><li>honor</li></ul></section><section class="antonym-list"><ul><li>blame</li><li>criticize</li><li>condemn</li><li>reject</li><li>disparage</li></ul></section></section></main>',
  }))
  assert.equal(result.datumStatus.synonymsAntonyms.status, "available")
  assert.equal(result.fields.synonymsAntonyms, "Synonyms:\npraise\napplaud\nesteem\nlaud\n\nAntonyms:\nblame\ncriticize\ncondemn\nreject")

  const wordLimited = await previewHtmlAdapter("merriam_webster_thesaurus", { english: "approve", partOfSpeech: "verb" }, async () => ({
    ok: true,
    url: "https://www.merriam-webster.com/thesaurus/approve",
    text: async () => '<main><section class="thesaurus-pos"><h2>verb</h2><section class="synonym-list"><ul><li>one two three four</li><li>five six seven eight</li><li>nine ten eleven twelve</li><li>thirteen</li></ul></section></section></main>',
  }))
  assert.equal(wordLimited.fields.synonymsAntonyms, "Synonyms:\none two three four\nfive six seven eight\nnine ten eleven twelve")
})

test("MW Thesaurus keeps synonyms and antonyms in the headword POS", async () => {
  const result = await previewHtmlAdapter("merriam_webster_thesaurus", { english: "class", partOfSpeech: "noun" }, async () => ({
    ok: true,
    url: "https://www.merriam-webster.com/thesaurus/class",
    text: async () => '<main><section class="thesaurus-pos"><h2>noun</h2><section class="synonym-list"><ul><li>category</li></ul></section><section class="antonym-list"><ul><li>individual</li></ul></section></section><section class="thesaurus-pos"><h2>verb</h2><section class="synonym-list"><ul><li>classify</li></ul></section><section class="antonym-list"><ul><li>mix</li></ul></section></section></main>',
  }))
  assert.equal(result.fields.synonymsAntonyms, "Synonyms:\ncategory\n\nAntonyms:\nindividual")
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

test("Dictionary Builder definition keeps safe rules, YTBD, and claim-keyed citations", () => {
  const definition = formatDictionaryBuilderDefinition({ english: "commend", partOfSpeech: "verb" }, {
    definition: "1. to praise publicly",
    verbInfinitive: "to commend", verbV1: "commend", verbV2: "commended", verbV3: "commended", verbV4: "commending", verbV5: "commends",
    stems: "commend\ncommended\ncommending\ncommends",
    synonymsAntonyms: "Synonyms:\npraise\napplaud\n\nAntonyms:\ncriticize",
    examples: "The report commended the team for its careful work.",
  }, buildSelectedDictionaryBuilderCitations("commend", "2026-08-26T00:00:00.000Z", [
    { field: "definition", provider: "britannica", status: "available" },
    { field: "verbForms", provider: "britannica", status: "available" },
    { field: "stems", provider: "britannica", status: "available" },
    { field: "synonymsAntonyms", provider: "britannica", status: "available" },
    { field: "examples", provider: "britannica", status: "available" },
  ], [{ provider: "britannica", sourceUrl: "https://www.britannica.com/dictionary/commend" }]))
  assert.match(definition, /\*\*Verb Forms\*\*[\s\S]*INF: to commend[\s\S]*V5: commends/u)
  assert.match(definition, /\*\*Stems\*\*[\s\S]* {2}- commended/u)
  assert.match(definition, /\| \*\*Synonyms\*\* \| \*\*Antonyms\*\*/u)
  assert.match(definition, /\*\*Examples of commend in a Sentence\*\*/u)
  assert.match(definition, /<hr>/)
  assert.match(definition, /\*\*Origin path\*\*\nYTBD/)
  assert.equal((definition.match(/Retrieved 2026-08-26/g) || []).length, 1)
  assert.equal((definition.match(/<hr>/g) || []).length, 2)
  assert.equal((definition.match(/\*\*Origin path\*\*/g) || []).length, 1)
})

test("Dictionary Builder normalizes a raw Definition Proper block before ordered assembly", () => {
  const definition = formatDictionaryBuilderDefinition({ english: "commend", partOfSpeech: "verb" }, {
    definition: "**commend** *verb*\n1. to praise publicly\n\n**Origin path**\nLatin > English\n\n**Etymology**\nFrom Latin.",
    verbForms: { verbInfinitive: "to commend", verbV1: "commend" },
    stems: "commend\ncommended",
    firstKnownUse: "14th century",
    originPath: "Latin > English",
    etymology: "From Latin.",
  }, [])
  assert.equal((definition.match(/\*\*Origin path\*\*/g) || []).length, 1)
  assert.equal((definition.match(/\*\*Etymology\*\*/g) || []).length, 1)
  assert.ok(definition.indexOf("**Verb Forms**") < definition.indexOf("**Stems**"))
  assert.ok(definition.indexOf("**Stems**") < definition.indexOf("**First known use**"))
  assert.equal((definition.match(/<hr>/g) || []).length, 2)
})

test("Definition Proper repairs marked section formatting idempotently", () => {
  const definition = formatDictionaryBuilderDefinition({ english: "retreat", partOfSpeech: "verb" }, {
    definition: "to move back\n\n**Verb Forms**\nINF: to retreat\nV1: retreat\nV2: retreated\nV3: retreated\nV4: retreating\nV5: retreats\n\n**Stems**\nretreat\nretreated\nretreater\nretreaters\nretreating\nretreats\n\n| **Synonyms** | **Antonyms** |\n|--------------|--------------|\n| withdrawal | advance |\n\n*Examples of retreat in a Sentence**\n- The forces are now in (full) retreat.\n\n**First known use**\n15th century\n\n**Origin path**\nOld French → Latin → English\n\n**Etymology**\n<hr>\n\nFrom Old French via Latin.\n\nFrom Old French via Latin.",
    etymology: "From Old French via Latin.",
  }, [])
  assert.match(definition, /\*\*Verb Forms\*\*[\s\S]*INF: to retreat[\s\S]*V5: retreats/u)
  assert.match(definition, /\*\*Stems\*\*[\s\S]*retreaters/u)
  assert.match(definition, /\| \*\*Synonyms\*\* \| \*\*Antonyms\*\* \|[\s\S]*\| withdrawal \| advance \|/u)
  assert.match(definition, /\*\*Examples of retreat in a Sentence\*\*/u)
  assert.equal((definition.match(/From Old French via Latin\./gu) || []).length, 1)
  assert.doesNotMatch(definition, /\*\*Etymology\*\*\n<hr>/u)
  assert.equal(formatDictionaryBuilderDefinition({ english: "retreat", partOfSpeech: "verb" }, { definition }, []), definition)
})

test("Definition Proper inserts a normalized verbForms object idempotently", () => {
  const definition = formatDictionaryBuilderDefinition({ english: "go", partOfSpeech: "verb" }, {
    definition: "to move from one place to another",
    verbForms: { verbInfinitive: "to go", verbV1: "go", verbV2: "went", verbV3: "gone", verbV4: "going", verbV5: "goes" },
  }, [])
  assert.match(definition, /\*\*Verb Forms\*\*[\s\S]*INF: to go[\s\S]*V5: goes/u)
  assert.equal(formatDictionaryBuilderDefinition({ english: "go", partOfSpeech: "verb" }, {
    definition: "to move from one place to another",
    verbForms: { verbInfinitive: "to go", verbV1: "go", verbV2: "went", verbV3: "gone", verbV4: "going", verbV5: "goes" },
  }, []), definition)
})

test("Definition Proper embeds authenticated local audio markup at headword and form positions", () => {
  const definition = formatDictionaryBuilderDefinition({ english: "go", partOfSpeech: "verb" }, {
    definition: "to move from one place to another",
    verbForms: { verbInfinitive: "to go", verbV1: "go" },
  }, [], [
    { id: "media-headword", slot: "headword", dialect: "us" },
    { id: "media-v1", slot: "verbV1", dialect: "us" },
  ])
  assert.match(definition, /^<a class="library-audio-play"[\s\S]*data-library-audio-key="headword:us"[\s\S]*<audio[\s\S]*src="\/api\/admin\/library\/media\/media-headword"><\/audio>\n\n\*\*go\*\*/u)
  assert.match(definition, /V1: go <a class="library-audio-play"[\s\S]*data-library-audio-key="verbV1:us"[\s\S]*data-library-preview-audio="verbV1:us"/u)
  assert.doesNotMatch(definition, /https:\/\//u)
  const reapplied = formatDictionaryBuilderDefinition({ english: "go", partOfSpeech: "verb" }, { definition, verbForms: { verbInfinitive: "to go", verbV1: "go" } }, [], [
    { id: "media-headword", slot: "headword", dialect: "us" },
    { id: "media-v1", slot: "verbV1", dialect: "us" },
  ])
  assert.equal((reapplied.match(/data-library-audio-key="headword:us"/gu) || []).length, 1)
  assert.equal((reapplied.match(/data-library-audio-key="verbV1:us"/gu) || []).length, 1)
})

test("Dictionary Builder Apply persists every declared datum and slot-aware audio", async () => {
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sis-dictionary-builder-apply-"))
  const previousMediaRoot = process.env.SIS_LIBRARY_MEDIA_ROOT
  process.env.SIS_LIBRARY_MEDIA_ROOT = mediaRoot
  const previousFetch = globalThis.fetch
  const assets = []
  let current = {
    id: "entry-apply-audio",
    english: "debate",
    partOfSpeech: "verb",
    definition: "",
    vietnamese: "",
    syllabication: "",
    syllableCount: null,
    grammarClassification: {},
    etymology: null,
    originPath: null,
    firstKnownUse: null,
    stems: null,
    synonymsAntonyms: null,
    examples: null,
    dictionaryMetadata: null,
    mediaAssets: [],
  }
  const client = {
    libraryEntry: {
      findUnique: async () => current,
      update: async ({ data }) => { current = { ...current, ...data, mediaAssets: assets }; return current },
    },
    libraryMediaAsset: {
      findMany: async () => assets,
      upsert: async ({ create }) => { assets.push({ id: `asset-${assets.length + 1}`, ...create }); return assets.at(-1) },
    },
    libraryEntryRevision: { create: async () => ({}) },
    dictionaryProviderSuitabilityMetric: { upsert: async () => ({}) },
    $transaction: async (callback) => callback(client),
  }
  const audioUrl = "https://media.merriam-webster.com/audio/prons/en/us/mp3/d/debate001.mp3"
  const formAudio = {
    verbV1: { us: "https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/d/deb/debat/debate__us_1.mp3" },
    verbV2: { us: "https://www.oxfordlearnersdictionaries.com/media/american_english/d/deb/debat/debated__us_1.mp3" },
    verbV3: { us: "https://www.oxfordlearnersdictionaries.com/media/american_english/d/deb/debat/debated__us_1.mp3" },
    verbV4: { us: "https://www.oxfordlearnersdictionaries.com/media/american_english/d/deb/debat/debating__us_1.mp3" },
    verbV5: { us: "https://www.oxfordlearnersdictionaries.com/media/american_english/d/deb/debat/debates__us_1.mp3" },
  }
  const forms = { verbInfinitive: "to debate", verbV1: "debate", verbV2: "debated", verbV3: "debated", verbV4: "debating", verbV5: "debates" }
  const fields = {
    vietnamese: "tranh luận",
    syllabication: "de-BATE",
    syllableCount: 2,
    grammarClassification: { grammarFamily: "action", grammarSubtype: "transitive", grammarDetail: "takes an object", verbRegularity: "regular", verbTransitivity: "transitive" },
    definition: "to discuss a question formally",
    stems: "debated\ndebating\ndebates",
    synonymsAntonyms: "Synonyms:\nargue\ndiscuss\n\nAntonyms:\nagree\naccept",
    examples: "They debated the proposal for an hour.",
    firstKnownUse: "14th century",
    originPath: "Latin -> Old French -> English",
    etymology: "From Latin debattuere.",
    worksCited: "Britannica Dictionary. (n.d.). *debate*.",
  }
  const unsupported = (provider) => ({ provider, status: "unsupported", fields: {}, entries: [], media: [], datumStatus: {} })
  const fetcher = Object.fromEntries(DICTIONARY_BUILDER_MANIFEST.map((item) => [item.id, async () => unsupported(item.id)]))
  fetcher.britannica = async () => ({ provider: "britannica", status: "available", sourceUrl: "https://www.britannica.com/dictionary/debate", fields: { ...fields, audio: [{ dialect: "us", available: true, fileName: "debate001.mp3" }] }, entries: [], privateMedia: [{ dialect: "us", slot: "headword", sourceUrl: audioUrl }], datumStatus: Object.fromEntries([...Object.keys(fields), "audio"].map((datum) => [datum, { status: "available" }])) })
  fetcher.oxford_ame = async () => ({ provider: "oxford_ame", status: "available", sourceUrl: "https://www.oxfordlearnersdictionaries.com/definition/american_english/debate_2", fields: { verbForms: forms, verbFormAudio: formAudio }, entries: [], privateMedia: Object.entries(formAudio).map(([slot, values]) => ({ dialect: "us", slot, sourceUrl: values.us })), datumStatus: { verbForms: { status: "available" }, verbFormAudio: { status: "available" } } })
  const rankedSourcesByDatum = Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, []]))
  Object.keys(fields).forEach((datum) => { rankedSourcesByDatum[datum] = [{ provider: "britannica", score: 99, confirmedAvailable: true }] })
  rankedSourcesByDatum.audio = [{ provider: "britannica", score: 99, confirmedAvailable: true }]
  rankedSourcesByDatum.verbForms = [{ provider: "oxford_ame", score: 99, confirmedAvailable: true }]
  rankedSourcesByDatum.verbFormAudio = [{ provider: "oxford_ame", score: 99, confirmedAvailable: true }]
  try {
    const { previewDictionaryBuilder } = await import("../src/modules/admin/dictionary-builder.mjs")
    const snapshot = await previewDictionaryBuilder(current, { ownerKey: "apply-session", fetcher, rankedSources: [{ provider: "britannica", score: 99 }, { provider: "oxford_ame", score: 98 }], rankedSourcesByDatum })
    globalThis.fetch = async () => new Response(Buffer.from("mp3-audio"), { status: 200, headers: { "content-type": "audio/mpeg" } })
    const result = await applyDictionaryBuilderSnapshot(current.id, { name: "tester", role: "admin" }, {
      snapshotId: snapshot.id,
      selections: {
        vietnamese: { provider: "britannica", value: fields.vietnamese },
        syllabication: { provider: "britannica", value: fields.syllabication },
        syllableCount: { provider: "britannica", value: fields.syllableCount },
        grammarClassification: { provider: "britannica", value: fields.grammarClassification },
        audio: { provider: "britannica", value: JSON.stringify([{ dialect: "us", fileName: "debate001.mp3" }]) },
        verbForms: { provider: "oxford_ame", value: forms },
        verbFormAudio: { provider: "oxford_ame", value: JSON.stringify(formAudio) },
        definition: { provider: "britannica", value: fields.definition },
        stems: { provider: "britannica", value: fields.stems },
        synonymsAntonyms: { provider: "britannica", value: fields.synonymsAntonyms },
        examples: { provider: "britannica", value: fields.examples },
        firstKnownUse: { provider: "britannica", value: fields.firstKnownUse },
        originPath: { provider: "britannica", value: fields.originPath },
        etymology: { provider: "britannica", value: fields.etymology },
        worksCited: { provider: "britannica", value: fields.worksCited },
      },
    }, { ownerKey: "apply-session", clientOverride: client })
    assert.equal(current.vietnamese, fields.vietnamese)
    assert.equal(current.syllabication, "de-báte")
    assert.equal(current.syllableCount, fields.syllableCount)
    assert.deepEqual(current.grammarClassification, { grammarFamily: "action", grammarSubtype: "transitive", grammarDetail: "takes an object", grammarFamilies: ["action"], grammarSubtypes: ["transitive"] })
    assert.equal(current.verbRegularity, "regular")
    assert.equal(current.verbTransitivity, "transitive")
    assert.match(current.definition, /\*\*debate\*\*[\s\S]*to discuss a question formally/u)
    assert.match(current.definition, /\*\*Verb Forms\*\*/u)
    assert.match(current.definition, /\*\*Stems\*\*/u)
    assert.match(current.definition, /\*\*Works Cited\*\*/u)
    assert.match(current.definition, /data-library-audio-key="headword:us"[\s\S]*\/api\/admin\/library\/media\/asset-1/u)
    assert.match(current.definition, /V1: debate[\s\S]*data-library-audio-key="verbV1:us"/u)
    assert.deepEqual(Object.fromEntries(Object.entries(forms).map(([key]) => [key, current[key]])), forms)
    for (const datum of ["stems", "synonymsAntonyms", "examples", "firstKnownUse", "originPath", "etymology", "worksCited"]) assert.equal(current.dictionaryMetadata.claims.filter((claim) => claim.field === datum).length, 1, datum)
    assert.ok(current.dictionaryMetadata.citations.some((citation) => citation.citation.startsWith("Britannica Dictionary")))
    assert.equal(assets.filter((asset) => asset.slot === "headword").length, 1)
    assert.deepEqual(assets.filter((asset) => asset.slot !== "headword").map((asset) => asset.slot).sort(), Object.keys(formAudio).sort())
    assert.deepEqual(result.mediaAssets.filter((asset) => asset.dialect === "us").map((asset) => asset.slot).sort(), ["headword", ...Object.keys(formAudio)].sort())
    assert.ok(result.mediaAssets.every((asset) => asset.id && asset.mimeType === "audio/mpeg" && asset.byteLength > 0 && /^[a-f0-9]{64}$/u.test(asset.sha256)))
    assert.deepEqual(Object.fromEntries(Object.entries(current.dictionaryMetadata.audioInputs).map(([slot, value]) => [slot, value.path])), Object.fromEntries(assets.filter((asset) => asset.dialect === "us").map((asset) => [asset.slot || "headword", `/api/admin/library/media/${encodeURIComponent(asset.id)}`])))
    assert.ok(result.appliedFields.includes("audio"))
    assert.ok(result.appliedFields.includes("verbFormAudio"))
    const appliedDatums = new Set(current.dictionaryMetadata.claims.map((claim) => claim.field === "verbForms" ? "verbForms" : claim.field))
    for (const datum of DICTIONARY_BUILDER_DATUMS) assert.ok(appliedDatums.has(datum) || result.appliedFields.includes(datum), datum)
  } finally {
    globalThis.fetch = previousFetch
    if (previousMediaRoot === undefined) delete process.env.SIS_LIBRARY_MEDIA_ROOT
    else process.env.SIS_LIBRARY_MEDIA_ROOT = previousMediaRoot
    await fs.rm(mediaRoot, { recursive: true, force: true })
  }
})
