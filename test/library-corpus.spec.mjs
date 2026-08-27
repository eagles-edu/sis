import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
const migration = fs.readFileSync(new URL("../prisma/migrations/20260810132000_add_library_corpus/migration.sql", import.meta.url), "utf8")
const cutoverMigration = fs.readFileSync(new URL("../prisma/migrations/20260810134000_add_full_esl_legacy_cutover/migration.sql", import.meta.url), "utf8")
const corpus = fs.readFileSync(new URL("../src/modules/admin/library-corpus.mjs", import.meta.url), "utf8")
const capitalizationNormalizer = fs.readFileSync(new URL("../tools/normalize-vocabulary-english-capitalization.mjs", import.meta.url), "utf8")
const originMigration = fs.readFileSync(new URL("../prisma/migrations/20260814090000_remove_library_redundant_fields_add_origin_metadata/migration.sql", import.meta.url), "utf8")

test("Library uses a dedicated PostgreSQL schema with immutable audit records", () => {
  for (const model of ["LibraryEntry", "LibraryEntryRevision", "LibraryContribution", "LibraryContributionRevision", "LibraryLegacySourceArchive", "LibraryAssignment", "LibraryMigrationPreflight", "LibraryAwlFamily"]) assert.match(schema, new RegExp(`model ${model}[\\s\\S]*?@@schema\\(\\"library\\"\\)`))
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS "library"/)
  assert.match(migration, /FOREIGN KEY \("studentRefId"\) REFERENCES "public"\."Student"/)
  assert.match(migration, /legacy_new_word/)
  assert.match(migration, /legacy_news_vocabulary/)
  assert.match(migration, /jsonb_array_elements/)
  assert.match(corpus, /snapshotJson/)
  assert.match(corpus, /writeRevision/)
  assert.doesNotMatch(schema, /model LibraryDuplicateCase/)
  assert.match(schema, /@@unique\(\[\s*normalizedKey,\s*partOfSpeech\s*\]\)/)
  assert.match(schema, /model LibraryContributionRevision/)
  assert.match(schema, /dueAt\s+DateTime\?/)
  assert.match(schema, /canonicalizedAt\s+DateTime\?/)
  assert.match(cutoverMigration, /LibraryMigrationPreflight/)
  assert.match(cutoverMigration, /DROP TABLE IF EXISTS "library"\."LibraryDuplicateCase"/)
})

test("MW Dictionary preview falls back to the Collegiate API after browser access fails", async () => {
  const { previewMerriamWebsterDictionaryEntryWithApiFallback } = await import("../src/modules/admin/library-corpus.mjs")
  const savedKey = process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
  const calls = []
  process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = "test-collegiate"
  try {
    const result = await previewMerriamWebsterDictionaryEntryWithApiFallback(
      { english: "average", partOfSpeech: "noun" },
      async (url) => {
        calls.push(String(url))
        if (String(url).includes("dictionaryapi.com")) return { ok: true, json: async () => [{ hwi: { hw: "average" }, fl: "noun", shortdef: ["a value representing a group"] }] }
        return { ok: false, status: 403, headers: new Headers() }
      },
      async () => ({ ok: false, status: 403, message: "Merriam-Webster is protected by an access challenge; no Library data was changed." }),
    )
    assert.equal(result.ok, true)
    assert.equal(result.fallback, "merriam-webster-collegiate-api")
    assert.equal(result.entries.length, 1)
    assert.match(result.fields.definition, /value representing a group/u)
    assert.equal(calls.some((url) => url.includes("dictionaryapi.com")), true)
  } finally {
    if (savedKey === undefined) delete process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
    else process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = savedKey
  }
})

test("canonical duplicate selection and student deadlines are deterministic", async () => {
  const { libraryContributionDeadline, isStudentLibraryContributionEditable, selectLargestDuplicate, selectReviewQueueRepresentatives, selectContributionsForCanonicalEntry, normalizeActiveLibraryPayload, normalizeLibraryEnum } = await import("../src/modules/admin/library-corpus.mjs")
  const first = { id: "b", submittedAt: "2026-08-01T00:00:00.000Z", payloadJson: { definition: "same length" } }
  const second = { id: "a", submittedAt: "2026-08-01T00:00:00.000Z", payloadJson: { definition: "same length" } }
  assert.equal(selectLargestDuplicate([first, second]).id, "a")
  const exhausted = [
    { id: "exhausted-short", submittedAt: "2026-08-13T04:37:52.000Z", status: "pending_review", payloadJson: { english: "exhausted", partOfSpeech: "noun", definition: "tired" } },
    { id: "exhausted-long", submittedAt: "2026-08-13T04:42:14.000Z", status: "pending_review", payloadJson: { english: "exhausted", partOfSpeech: "noun", definition: "completely used up; drained of strength or resources" } },
    { id: "exhausted-medium", submittedAt: "2026-08-13T04:42:17.000Z", status: "pending_review", payloadJson: { english: "exhausted", partOfSpeech: "noun", definition: "very tired or depleted" } },
    { id: "unique", submittedAt: "2026-08-13T04:43:00.000Z", status: "pending_review", payloadJson: { english: "unique", partOfSpeech: "adjective", definition: "one of a kind" } },
  ]
  assert.deepEqual(selectReviewQueueRepresentatives(exhausted).map((row) => row.id), ["exhausted-long", "unique"])
  assert.deepEqual(selectContributionsForCanonicalEntry([
    { id: "exhausted-1", entryId: "entry-exhausted", status: "pending_review", payloadJson: { english: "exhausted", partOfSpeech: "noun" } },
    { id: "exhausted-2", entryId: "entry-exhausted", status: "legacy_pending_review", payloadJson: { english: "exhausted", partOfSpeech: "noun" } },
    { id: "other-pos", entryId: "entry-exhausted", status: "pending_review", payloadJson: { english: "exhausted", partOfSpeech: "adjective" } },
    { id: "waiting", entryId: "entry-exhausted", status: "awaiting_legacy_canonical", payloadJson: { english: "exhausted", partOfSpeech: "noun" } },
  ], { id: "entry-exhausted", english: "exhausted", partOfSpeech: "noun" }).map((row) => row.id), ["exhausted-1", "exhausted-2", "waiting"])
  assert.equal(libraryContributionDeadline("2026-08-01T00:00:00.000Z").toISOString(), "2026-08-16T00:00:00.000Z")
  assert.equal(isStudentLibraryContributionEditable({ status: "pending_review", dueAt: "2026-01-01T00:00:00.000Z" }, new Date("2026-08-22T00:00:00.000Z")), true)
  assert.equal(isStudentLibraryContributionEditable({ status: "canonicalized", dueAt: "2026-08-30T00:00:00.000Z" }, new Date("2026-08-22T00:00:00.000Z")), true)
  assert.equal(isStudentLibraryContributionEditable({ status: "canonicalized", dueAt: "2026-08-21T00:00:00.000Z" }, new Date("2026-08-22T00:00:00.000Z")), false)
  assert.equal(isStudentLibraryContributionEditable({ status: "legacy_pending_review", dueAt: null }, new Date("2026-08-22T00:00:00.000Z")), true)
  assert.equal(isStudentLibraryContributionEditable({ status: "awaiting_legacy_canonical", dueAt: null }, new Date("2026-08-22T00:00:00.000Z")), true)
  assert.deepEqual(normalizeActiveLibraryPayload({ grammarClassification: null, originReferences: null, definition: null }), { grammarClassification: {}, originReferences: [], definition: "" })
  assert.equal(normalizeLibraryEnum("null"), "")
  assert.equal(normalizeLibraryEnum("countable"), "countable")
})

test("MW etymology extraction accepts nested etymology payloads", async () => {
  const { previewMerriamWebsterLibraryEntry } = await import("../src/modules/admin/library-corpus.mjs")
  const savedKey = process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
  const savedFetch = globalThis.fetch
  process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = "test-collegiate"
  globalThis.fetch = async () => ({ ok: true, json: async () => [{ hwi: { hw: "give" }, fl: "verb", et: { etymology: [{ text: "Middle English" }, { et_snote: { t: "from Old English" } }] }, shortdef: ["to make a present of"] }] })
  try {
    const result = await previewMerriamWebsterLibraryEntry({ english: "give", partOfSpeech: "verb" })
    assert.equal(result.ok, true)
    assert.equal(result.fields.etymology, "Middle English\nfrom Old English")
  } finally {
    if (savedKey === undefined) delete process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
    else process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = savedKey
    globalThis.fetch = savedFetch
  }
})

test("legacy archive migration precedes the guarded canonical uniqueness migration", () => {
  const archiveMigration = fs.readFileSync(new URL("../prisma/migrations/20260815090000_library_canonical_uniqueness_and_lifecycle/migration.sql", import.meta.url), "utf8")
  const uniquenessMigration = fs.readFileSync(new URL("../prisma/migrations/20260815093000_enforce_library_canonical_uniqueness/migration.sql", import.meta.url), "utf8")
  assert.match(archiveMigration, /LibraryContributionRevision/)
  assert.match(archiveMigration, /LibraryLegacySourceArchive/)
  assert.ok(uniquenessMigration.indexOf("RAISE EXCEPTION") < uniquenessMigration.indexOf("CREATE UNIQUE INDEX \"LibraryEntry_normalizedKey_partOfSpeech_key\""))
  assert.match(uniquenessMigration, /GROUP BY \"normalizedKey\", \"partOfSpeech\"[\s\S]*HAVING COUNT\(\*\) > 1/)
})

test("Library corpus preserves the required ESL and AWL contracts", () => {
  for (const token of ["pronoun", "determiner", "conjunction", "prepositional", "verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5", "grammarClassification", "nounType", "nounNumber", "countable_and_uncountable", "physicalQuality", "grammaticalNumber", "primaryClassification", "materialUsage", "properNounVariantShift", "dualCountabilityUsage", "awlFamilyHeadword", "awlQualifyingMember", "awlMemberForm", "americanEnglish", "britishEnglish", "syllableCount"]) assert.match(`${schema}\n${corpus}`, new RegExp(token))
  assert.match(corpus, /Merriam-Webster Collegiate is unavailable; no Library data was changed/)
  assert.match(corpus, /pending_review/)
  assert.match(corpus, /normalizedKey: group\.normalizedKey, partOfSpeech: group\.partOfSpeech/)
})

test("Library definitions keep up to 50,000 characters through normalization", async () => {
  const { LIBRARY_DEFINITION_MAX_LENGTH, normalizeLibraryDefinition } = await import("../src/modules/admin/library-corpus.mjs")
  const definition = "definition ".repeat(6000)
  assert.equal(LIBRARY_DEFINITION_MAX_LENGTH, 50000)
  assert.equal(normalizeLibraryDefinition(definition).length, 50000)
  assert.equal(normalizeLibraryDefinition(definition.slice(0, 49999)).length, 49999)
  assert.equal(normalizeLibraryDefinition("First line\n\nSecond line\n"), "First line\n\nSecond line\n")
})

test("Library rejects capitals for common entries and requires them for proper nouns", async () => {
  const { updateLibraryEntry } = await import("../src/modules/admin/library-corpus.mjs")
  const { vocabularyEnglishCapitalizationError } = await import("../src/modules/admin/vocabulary-syllabication.mjs")
  assert.equal(vocabularyEnglishCapitalizationError({ english: "Apple", partOfSpeech: "noun" }), "English word/phrase must be lowercase unless it is a proper noun.")
  assert.equal(vocabularyEnglishCapitalizationError({ english: "apple", partOfSpeech: "proper noun" }), "Proper nouns must include a capital letter.")
  assert.equal(vocabularyEnglishCapitalizationError({ english: "London", partOfSpeech: "proper noun" }), "")
  assert.match(corpus, /const capitalizationError = vocabularyEnglishCapitalizationError\(\{ \.\.\.value, english, partOfSpeech \}\)/)
  assert.match(corpus, /const capitalizationError = vocabularyEnglishCapitalizationError\(entry\)/)
  assert.match(corpus, /const capitalizationError = vocabularyEnglishCapitalizationError\(\{ \.\.\.existing, \.\.\.data \}\)/)
  assert.equal(typeof updateLibraryEntry, "function")
})

test("legacy capitalization normalizer is dry-run first, preserves immutable snapshots, and audits Library changes", () => {
  assert.match(capitalizationNormalizer, /const apply = process\.argv\.includes\("--apply"\)/)
  assert.match(capitalizationNormalizer, /immutableAuditSnapshotsPreserved: true/)
  assert.match(capitalizationNormalizer, /Normalization would merge Library entries/)
  assert.match(capitalizationNormalizer, /action: "capitalization_normalized"/)
  assert.match(capitalizationNormalizer, /unresolvedProperNouns/)
})

test("legacy cutover preserves sources while creating provisional A/B review groups", () => {
  for (const token of ["createLibraryLegacyPreflight", "cutoverLegacyLibrary", "libraryLegacySourceArchive", "legacy_library_entry", "legacy_pending_review", "awaiting_legacy_canonical", "pending_canonical_replacement", "archivedAt", "archivedLibraryEntryId", "conflictsJson", "legacy_cutover_provisional"]) assert.match(corpus, new RegExp(token))
  assert.doesNotMatch(corpus, /libraryDuplicateCase/)
})

test("Library queue and assignment engagement retain subject and route", () => {
  for (const token of ["listLibraryReviewQueue", "potentialDuplicate", "listLibraryStudents", "sendLibraryAssignmentEmail", "listLibraryAssignmentEngagement", "subject", "route", "LibraryAssignmentEngagement"]) assert.match(`${schema}\n${corpus}`, new RegExp(token))
})

test("active Library payloads remove redundant metadata but preserve POS-specific controls and origin metadata", () => {
  assert.doesNotMatch(schema, /entryKind\s+String|posSubtype\s+String/)
  assert.doesNotMatch(corpus, /ENTRY_KINDS|POS_SUBTYPES|entryKind|posSubtype/)
  assert.match(schema, /originPath\s+String\?|originReferences\s+Json\?/)
  assert.match(originMigration, /DROP COLUMN "entryKind"/)
  assert.match(originMigration, /DROP COLUMN "posSubtype"/)
  assert.match(originMigration, /ADD COLUMN "originPath"/)
  assert.match(originMigration, /ADD COLUMN "originReferences"/)
  for (const control of ["countability", "nounType", "nounNumber", "verbRegularity", "verbTransitivity", "grammarClassification"]) assert.match(corpus, new RegExp(control))
})

test("MW preview keeps complete normalized entry data and does not expose provider JSON", async () => {
  const { previewMerriamWebsterLibraryEntry } = await import("../src/modules/admin/library-corpus.mjs")
  const savedKey = process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
  const savedFetch = globalThis.fetch
  process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = "test-collegiate"
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => [{
      meta: { id: "give", stems: ["give", "gave"], syns: [["offer"]], ants: [["take"]] },
      hwi: { hw: "give", prs: [{ mw: "ˈgiv", sound: { audio: "give0001" } }] },
      fl: "verb",
      lbs: ["transitive verb"],
      def: [{ vd: "transitive verb", sseq: [[[
        "sense", { sn: "1", dt: [["text", "{bc}to make a present of {it}something{/it} {b}bold clue{/b}"]], vis: [{ t: "give a gift" }] },
      ]]] }],
      shortdef: ["to make a present of"],
      ins: [{ if: "gave", il: "past" }, { if: "given", il: "past participle" }],
      vrs: [{ vl: "also", va: ["giv"] }],
      cxs: [{ cxl: "related to", cxtis: [{ cxt: "gift", cxn: "1" }] }],
      et: [["text", "Middle English {it}given{/it}"], ["et_snote", [["t", "from Old English"]]]],
      date: "before 12th century",
    }],
  })
  try {
    const result = await previewMerriamWebsterLibraryEntry({ english: "give" })
    assert.equal(result.ok, true)
    assert.match(result.fields.definition, /to make a present of/)
    assert.match(result.fields.definition, /1\. to make a present of/)
    assert.match(result.fields.definition, /\*something\*/)
    assert.match(result.fields.definition, /\*\*bold clue\*\*/)
    assert.match(result.fields.definition, /1\. to make a present of \*something\* \*\*bold clue\*\*\n {4}- give a gift/)
    assert.equal(result.fields.verbInfinitive, "to give")
    assert.equal(result.fields.verbV1, "give")
    assert.equal(result.fields.verbV2, "gave")
    assert.equal(result.fields.verbV3, "given")
    assert.equal(result.fields.verbTransitivity, "transitive")
    assert.equal(result.fields.verbRegularity, "irregular")
    assert.equal(result.fields.verbV4, "giving")
    assert.equal(result.fields.verbV5, "gives")
    assert.equal(result.details.entries[0].inflections.length, 2)
    assert.deepEqual(result.details.entries[0].synonyms, ["offer"])
    assert.deepEqual(result.details.entries[0].antonyms, ["take"])
    assert.match(result.details.entries[0].definitions.join(" "), /to make a present of/)
    assert.match(result.details.entries[0].etymology.join(" "), /Middle English given/)
    assert.match(result.fields.etymology, /Middle English given/)
    assert.equal(result.details.entries[0].firstKnownUse, "before 12th century")
    assert.equal(Object.hasOwn(result, "raw"), false)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => [{
        hwi: { hw: "water" },
        fl: "noun",
        lbs: ["count noun"],
        def: [{ sseq: [[["sense", { sn: "1", dt: [["text", "{bc}a liquid"]], vis: [] }]]] }],
        shortdef: ["a liquid"],
      }],
    })
    const nounResult = await previewMerriamWebsterLibraryEntry({ english: "water" })
    assert.equal(nounResult.fields.countability, "countable")
  } finally {
    if (savedKey === undefined) delete process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
    else process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = savedKey
    globalThis.fetch = savedFetch
  }
})

test("MW preview selects the requested POS, preserves full metadata, and never fills provider syllabication", async () => {
  const { previewMerriamWebsterLibraryEntry } = await import("../src/modules/admin/library-corpus.mjs")
  const savedKey = process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
  const savedFetch = globalThis.fetch
  process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = "test-collegiate"
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => [
      { hwi: { hw: "record" }, fl: "noun", meta: { stems: ["record", "records"], syns: [["log"]], ants: [["erase"]] }, shortdef: ["a written account"] },
      { hwi: { hw: "record" }, fl: "verb", meta: { stems: ["record", "recorded"], syns: [["document"]], ants: [["forget"]] }, def: [{ sseq: [[[
        "sense", { sn: "1", dt: [["text", "{bc}{it}to set down in writing{/it}"]], vis: [] },
      ]]] }], shortdef: ["to set down"], date: "1597" },
    ],
  })
  try {
    const result = await previewMerriamWebsterLibraryEntry({ english: "record", partOfSpeech: "verb" })
    assert.equal(result.ok, true)
    assert.equal(result.fields.partOfSpeech, "verb")
    assert.equal(Object.hasOwn(result.fields, "syllabication"), false)
    assert.match(result.fields.definition, /to set down in writing/)
    assert.match(result.fields.definition, /\*\*Stems:\*\*/)
    assert.match(result.fields.definition, /- recorded/)
    assert.match(result.fields.definition, /\*\*Synonyms:\*\*/)
    assert.match(result.fields.definition, /- document/)
    assert.match(result.fields.definition, /\*\*Antonyms:\*\*/)
    assert.match(result.fields.definition, /- forget/)
    assert.equal(result.details.entryCount, 2)
    assert.equal(result.details.selectedEntryCount, 1)
    assert.equal(result.details.entries[0].partOfSpeech, "noun")
    assert.equal(result.details.entries[1].partOfSpeech, "verb")
  } finally {
    if (savedKey === undefined) delete process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
    else process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = savedKey
    globalThis.fetch = savedFetch
  }
})

test("MW preview retries an inflected verb with its lemma before rejecting the verb POS", async () => {
  const { previewMerriamWebsterLibraryEntry } = await import("../src/modules/admin/library-corpus.mjs")
  const savedKey = process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
  const savedFetch = globalThis.fetch
  process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = "test-collegiate"
  const queries = []
  globalThis.fetch = async (url) => {
    const query = decodeURIComponent(String(url).split("/json/")[1].split("?")[0])
    queries.push(query)
    if (query === "exhausted") return { ok: true, json: async () => [{ hwi: { hw: "exhausted" }, fl: "adjective", shortdef: ["very tired"] }] }
    return { ok: true, json: async () => [{ hwi: { hw: "exhaust" }, fl: "verb", ins: [{ if: "exhausted", il: "past" }, { if: "exhausted", il: "past participle" }, { if: "exhausting", il: "present participle" }, { if: "exhausts", il: "third person singular" }], shortdef: ["to use up"] }] }
  }
  try {
    const result = await previewMerriamWebsterLibraryEntry({ english: "exhausted", partOfSpeech: "verb" })
    assert.equal(result.ok, true)
    assert.deepEqual(queries.slice(0, 2), ["exhausted", "exhaust"])
    assert.equal(result.details.lookupQuery, "exhaust")
    assert.equal(result.fields.verbInfinitive, "to exhaust")
    assert.equal(result.fields.verbV1, "exhaust")
    assert.equal(result.fields.verbV2, "exhausted")
    assert.equal(result.fields.verbV3, "exhausted")
    assert.equal(result.fields.verbV4, "exhausting")
    assert.equal(result.fields.verbV5, "exhausts")
  } finally {
    if (savedKey === undefined) delete process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
    else process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = savedKey
    globalThis.fetch = savedFetch
  }
})

test("MW preview maps every supported Library part of speech instead of defaulting to the first return", async () => {
  const { previewMerriamWebsterLibraryEntry } = await import("../src/modules/admin/library-corpus.mjs")
  const savedKey = process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
  const savedFetch = globalThis.fetch
  process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = "test-collegiate"
  const supported = ["adjective", "noun", "proper noun", "verb", "adverb", "conjunction", "preposition", "determiner", "pronoun", "interjection", "numeral", "phrase", "idiom", "clause"]
  globalThis.fetch = async (url) => {
    const word = decodeURIComponent(String(url).split("/json/")[1].split("?")[0])
    const partOfSpeech = word.replace(/^pos-/u, "")
    return { ok: true, json: async () => [{ hwi: { hw: word }, fl: partOfSpeech, shortdef: [`${partOfSpeech} definition`] }] }
  }
  try {
    for (const partOfSpeech of supported) {
      const result = await previewMerriamWebsterLibraryEntry({ english: `pos-${partOfSpeech}`, partOfSpeech })
      assert.equal(result.ok, true, partOfSpeech)
      assert.equal(result.fields.partOfSpeech, partOfSpeech, partOfSpeech)
      assert.equal(result.details.selectedEntryCount, 1, partOfSpeech)
    }
  } finally {
    if (savedKey === undefined) delete process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
    else process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = savedKey
    globalThis.fetch = savedFetch
  }
})
