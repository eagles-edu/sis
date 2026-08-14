import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
const migration = fs.readFileSync(new URL("../prisma/migrations/20260810132000_add_library_corpus/migration.sql", import.meta.url), "utf8")
const cutoverMigration = fs.readFileSync(new URL("../prisma/migrations/20260810134000_add_full_esl_legacy_cutover/migration.sql", import.meta.url), "utf8")
const corpus = fs.readFileSync(new URL("../src/modules/admin/library-corpus.mjs", import.meta.url), "utf8")
const originMigration = fs.readFileSync(new URL("../prisma/migrations/20260814090000_remove_library_redundant_fields_add_origin_metadata/migration.sql", import.meta.url), "utf8")

test("Library uses a dedicated PostgreSQL schema with immutable audit records", () => {
  for (const model of ["LibraryEntry", "LibraryEntryRevision", "LibraryContribution", "LibraryAssignment", "LibraryMigrationPreflight", "LibraryAwlFamily"]) assert.match(schema, new RegExp(`model ${model}[\\s\\S]*?@@schema\\(\\"library\\"\\)`))
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS "library"/)
  assert.match(migration, /FOREIGN KEY \("studentRefId"\) REFERENCES "public"\."Student"/)
  assert.match(migration, /legacy_new_word/)
  assert.match(migration, /legacy_news_vocabulary/)
  assert.match(migration, /jsonb_array_elements/)
  assert.match(corpus, /snapshotJson/)
  assert.match(corpus, /writeRevision/)
  assert.doesNotMatch(schema, /model LibraryDuplicateCase/)
  assert.match(cutoverMigration, /LibraryMigrationPreflight/)
  assert.match(cutoverMigration, /DROP TABLE IF EXISTS "library"\."LibraryDuplicateCase"/)
})

test("Library corpus preserves the required ESL and AWL contracts", () => {
  for (const token of ["pronoun", "determiner", "conjunction", "prepositional", "verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5", "grammarClassification", "nounType", "nounNumber", "both s & p", "awlFamilyHeadword", "awlQualifyingMember", "awlMemberForm", "americanEnglish", "britishEnglish", "syllableCount"]) assert.match(`${schema}\n${corpus}`, new RegExp(token))
  assert.match(corpus, /Merriam-Webster Collegiate is unavailable; no Library data was changed/)
  assert.match(corpus, /pending_review/)
  assert.match(corpus, /normalizedKey: group\.normalizedKey, partOfSpeech: group\.partOfSpeech/)
})

test("legacy cutover groups preflight sources without duplicate cases", () => {
  for (const token of ["createLibraryLegacyPreflight", "cutoverLegacyLibrary", "archivedAt", "archivedLibraryEntryId", "conflictsJson"]) assert.match(corpus, new RegExp(token))
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
    assert.match(result.fields.definition, /Example: give a gift/)
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
