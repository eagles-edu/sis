import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
const migration = fs.readFileSync(new URL("../prisma/migrations/20260810132000_add_library_corpus/migration.sql", import.meta.url), "utf8")
const cutoverMigration = fs.readFileSync(new URL("../prisma/migrations/20260810134000_add_full_esl_legacy_cutover/migration.sql", import.meta.url), "utf8")
const corpus = fs.readFileSync(new URL("../src/modules/admin/library-corpus.mjs", import.meta.url), "utf8")

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
  for (const token of ["pronoun", "determiner", "conjunction", "phrasal verb", "prepositional", "verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5", "grammarClassification", "nounType", "nounNumber", "both s & p", "awlFamilyHeadword", "awlQualifyingMember", "awlMemberForm", "americanEnglish", "britishEnglish", "syllableCount"]) assert.match(`${schema}\n${corpus}`, new RegExp(token))
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
      def: [{ vd: "transitive verb", sseq: [[[
        "sense", { sn: "1", dt: [["text", "{bc}to make a present of"]], vis: [{ t: "give a gift" }] },
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
    assert.match(result.fields.definition, /give a gift/)
    assert.equal(result.fields.verbInfinitive, "give")
    assert.equal(result.fields.verbV1, "give")
    assert.equal(result.fields.verbV2, "gave")
    assert.equal(result.fields.verbV3, "given")
    assert.equal(result.fields.verbV4, "")
    assert.equal(result.details.entries[0].inflections.length, 2)
    assert.deepEqual(result.details.entries[0].synonyms, ["offer"])
    assert.deepEqual(result.details.entries[0].antonyms, ["take"])
    assert.match(result.details.entries[0].definitions.join(" "), /to make a present of/)
    assert.match(result.details.entries[0].etymology.join(" "), /Middle English given/)
    assert.equal(result.details.entries[0].firstKnownUse, "before 12th century")
    assert.equal(Object.hasOwn(result, "raw"), false)
  } finally {
    if (savedKey === undefined) delete process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
    else process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = savedKey
    globalThis.fetch = savedFetch
  }
})
