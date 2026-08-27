import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { applyLdoceLibraryEntry } from "../src/modules/admin/library-corpus.mjs"

const html = `<span class="dictentry"><div class="Head"><span class="HWD">test</span><span class="POS">verb</span><span class="brefile" data-src-mp3="https://www.ldoceonline.com/media/english/breProns/test.mp3"></span><span class="amefile" data-src-mp3="https://www.ldoceonline.com/media/english/ameProns/test.mp3"></span></div><span class="Inflections">past tested</span><span class="Sense"><span class="sensenum">1</span><span class="GRAM">[T]</span><span class="DEF">to try something</span></span></span>`

test("LDOCE selected Apply updates only selected content and requested audio", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sis-ldoce-apply-"))
  const previousRoot = process.env.SIS_LIBRARY_MEDIA_ROOT
  process.env.SIS_LIBRARY_MEDIA_ROOT = root
  const revisions = []
  const media = []
  const existing = {
    id: "entry-1", english: "test", partOfSpeech: "verb", vietnamese: "kiểm tra", syllabication: "test", syllableCount: 1,
    definition: "old definition", verbTransitivity: null, grammarClassification: null, dictionaryProvider: null, dictionarySourceUrl: null, dictionaryMetadata: null,
    reviewStatus: "approved", createdByName: "fixture", lastEditedByName: "fixture", createdAt: new Date(), updatedAt: new Date(), revisions: [], contributions: [],
    phraseType: null, americanEnglish: null, britishEnglish: null, etymologyType: null, etymology: null, originPath: null, originReferences: null,
    countability: null, nounType: null, nounNumber: null, physicalQuality: null, grammaticalNumber: null, primaryClassification: null, materialUsage: null,
    properNounVariantShift: false, dualCountabilityUsage: null, verbRegularity: null, verbInfinitive: "to test", verbV1: "test", verbV2: "tested", verbV3: "tested", verbV4: "testing", verbV5: "tests", displayVerbForm: null,
    edAdjective: false, ingAdjective: false, awlFamilyHeadword: null, awlQualifyingMember: null, awlMemberForm: null, awlSublist: null,
  }
  const client = {
    libraryEntry: {
      findUnique: async () => existing,
      update: async ({ data }) => ({ ...existing, ...data, revisions: [], contributions: [] }),
    },
    libraryMediaAsset: {
      upsert: async ({ create }) => { media.push({ id: `media-${create.dialect}`, ...create }); return media.at(-1) },
      findMany: async () => media,
    },
    libraryEntryRevision: { create: async ({ data }) => { revisions.push(data); return data } },
    $transaction: async (callback) => callback(client),
  }
  const fetchImpl = async (url) => {
    if (String(url).includes("/dictionary/")) return { ok: true, status: 200, url: "https://www.ldoceonline.com/dictionary/test", headers: new Headers(), text: async () => html }
    return { ok: true, status: 200, url, headers: new Headers({ "content-type": "audio/mpeg" }), arrayBuffer: async () => Buffer.from(`audio:${url}`) }
  }
  try {
    const result = await applyLdoceLibraryEntry("entry-1", { name: "admin", role: "admin" }, { mode: "selected", fields: ["definition"], audio: { uk: true, us: false }, entry: existing }, fetchImpl, client)
    assert.equal(result.ok, true)
    assert.deepEqual(result.appliedFields.sort(), ["definition", "dictionaryMetadata", "dictionaryProvider", "dictionarySourceUrl"].sort())
    assert.equal(result.entry.syllabication, "test")
    assert.equal(result.mediaAssets.length, 1)
    assert.equal(result.mediaAssets[0].dialect, "uk")
    assert.equal(revisions.length, 1)
    assert.equal(revisions[0].action, "ldoce_import")
  } finally {
    if (previousRoot === undefined) delete process.env.SIS_LIBRARY_MEDIA_ROOT
    else process.env.SIS_LIBRARY_MEDIA_ROOT = previousRoot
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("LDOCE destructive Replace All clears supported fields absent from the preview", async () => {
  let current = {
    id: "entry-2", english: "test", partOfSpeech: "verb", vietnamese: "kiểm tra", syllabication: "test", syllableCount: 1,
    definition: "old definition", countability: "countable", verbTransitivity: "intransitive", grammarClassification: { grammarFamily: "old" },
    dictionaryProvider: null, dictionarySourceUrl: null, dictionaryMetadata: null, reviewStatus: "approved", createdByName: "fixture", lastEditedByName: "fixture",
    revisions: [], contributions: [], verbRegularity: "regular", verbInfinitive: "to test", verbV1: "test", verbV2: "tested", verbV3: "tested", verbV4: "testing", verbV5: "tests",
  }
  const revisions = []
  const client = {
    libraryEntry: {
      findUnique: async () => current,
      update: async ({ data }) => { current = { ...current, ...data, revisions: [], contributions: [] }; return current },
    },
    libraryMediaAsset: { findMany: async () => [] },
    libraryEntryRevision: { create: async ({ data }) => { revisions.push(data); return data } },
    $transaction: async (callback) => callback(client),
  }
  const fetchImpl = async (url) => String(url).includes("/dictionary/")
    ? { ok: true, status: 200, url: "https://www.ldoceonline.com/dictionary/test", headers: new Headers(), text: async () => html }
    : { ok: false, status: 404, url, headers: new Headers() }

  const result = await applyLdoceLibraryEntry("entry-2", { name: "admin", role: "admin" }, {
    mode: "replace_all", fields: [], audio: { uk: false, us: false }, entry: current,
  }, fetchImpl, client)

  assert.equal(result.ok, true)
  assert.equal(current.countability, null)
  assert.equal(current.verbTransitivity, "transitive")
  assert.equal(current.grammarClassification.grammarFamily, "ldoce")
  assert.match(current.definition, /to try something/)
  assert.equal(revisions.length, 1)
})

test("LDOCE destructive Replace Selected clears only checked supported fields", async () => {
  let current = {
    id: "entry-3", english: "test", partOfSpeech: "verb", vietnamese: "kiểm tra", syllabication: "test", syllableCount: 1,
    definition: "old definition", countability: "countable", verbTransitivity: "intransitive", grammarClassification: { grammarFamily: "old" },
    dictionaryProvider: null, dictionarySourceUrl: null, dictionaryMetadata: null, reviewStatus: "approved", createdByName: "fixture", lastEditedByName: "fixture",
    revisions: [], contributions: [], verbRegularity: "regular", verbInfinitive: "to test", verbV1: "test", verbV2: "tested", verbV3: "tested", verbV4: "testing", verbV5: "tests",
  }
  const client = {
    libraryEntry: {
      findUnique: async () => current,
      update: async ({ data }) => { current = { ...current, ...data, revisions: [], contributions: [] }; return current },
    },
    libraryMediaAsset: { findMany: async () => [] },
    libraryEntryRevision: { create: async ({ data }) => data },
    $transaction: async (callback) => callback(client),
  }
  const fetchImpl = async (url) => String(url).includes("/dictionary/")
    ? { ok: true, status: 200, url: "https://www.ldoceonline.com/dictionary/test", headers: new Headers(), text: async () => html }
    : { ok: false, status: 404, url, headers: new Headers() }

  await applyLdoceLibraryEntry("entry-3", { name: "admin", role: "admin" }, {
    mode: "replace_selected", fields: ["definition", "countability"], audio: { uk: false, us: false }, entry: current,
  }, fetchImpl, client)

  assert.equal(current.countability, null)
  assert.equal(current.verbTransitivity, "intransitive")
  assert.match(current.definition, /to try something/)
})
