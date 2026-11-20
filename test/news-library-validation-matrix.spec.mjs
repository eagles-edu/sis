import assert from "node:assert/strict"
import test from "node:test"

import { normalizeLibraryEntry, submitLibraryContribution } from "../src/modules/admin/library-corpus.mjs"
import { evaluateStudentNewsMinimumRequirements, evaluateStudentNewsVocabulary } from "../src/modules/admin/student-news-compliance.mjs"
import { checkTextWithLanguageTool } from "../src/modules/admin/student-news-language-tool.mjs"
import { normalizeStudentNewsPayload } from "../src/modules/admin/student-news-submissions.mjs"
import {
  normalizeVocabularySyllabication,
  resetVocabularyDictionaryCacheForTest,
  validateVocabularyEntry,
} from "../src/modules/admin/vocabulary-syllabication.mjs"

const priorCollegiateKey = process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
const priorLearnersKey = process.env.MERRIAM_WEBSTER_LEARNERS_API_KEY
process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = "matrix-collegiate-key"
process.env.MERRIAM_WEBSTER_LEARNERS_API_KEY = "matrix-learners-key"
test.after(() => {
  if (priorCollegiateKey === undefined) delete process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
  else process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = priorCollegiateKey
  if (priorLearnersKey === undefined) delete process.env.MERRIAM_WEBSTER_LEARNERS_API_KEY
  else process.env.MERRIAM_WEBSTER_LEARNERS_API_KEY = priorLearnersKey
  resetVocabularyDictionaryCacheForTest()
})

const NEWS_FIELDS = [
  "sourceLink",
  "articleTitle",
  "byline",
  "articleDateline",
  "leadSynopsis",
  "actionActor",
  "actionAffected",
  "actionWhere",
  "actionWhat",
  "actionWhy",
  "biasAssessment",
  "vocabulary",
]

const completeNewsReport = () => ({
  sourceLink: "https://www.bbc.com/news/articles/matrix-story",
  articleTitle: "Emergency teams open a support center",
  byline: "BBC News",
  articleDateline: "Published today at 9:00 AM ICT (GMT+7).",
  leadSynopsis: "Emergency teams opened a support center after heavy rain affected several neighborhoods.",
  actionActor: "Emergency teams",
  actionAffected: "Residents",
  actionWhere: "Coast City",
  actionWhat: "Emergency teams opened a support center for residents after heavy rain affected the area.",
  actionWhy: "The center opened because flooding damaged homes and interrupted essential services.",
  biasAssessment: "The report relies on officials, so it may omit some residents' experiences.",
  vocabulary: [{
    partOfSpeech: "noun",
    english: "air-strike",
    vietnamese: "cuộc không kích",
    syllabication: "air-strike",
    definition: "An attack made by aircraft.",
  }],
})

const LIBRARY_FIELDS = [
  "english", "americanEnglish", "britishEnglish", "partOfSpeech", "phraseType", "grammarClassification",
  "etymologyType", "etymology", "originPath", "originReferences", "vietnamese", "syllabication", "syllableCount",
  "definition", "countability", "nounType", "nounNumber", "physicalQuality", "grammaticalNumber",
  "primaryClassification", "materialUsage", "properNounVariantShift", "dualCountabilityUsage", "verbRegularity",
  "verbTransitivity", "verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5", "displayVerbForm",
  "edAdjective", "ingAdjective", "awlFamilyHeadword", "awlQualifyingMember", "awlMemberForm", "awlSublist",
  "dictionaryProvider", "dictionarySourceUrl", "dictionaryMetadata",
]

function mockDictionary(divisionBySource = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    const source = String(url).includes("/learners/") ? "learners" : "collegiate"
    calls.push(source)
    const division = divisionBySource[source]
    return new Response(JSON.stringify(division ? [{ hwi: { hw: division } }] : []), { status: 200 })
  }
  return { calls, fetchImpl }
}

test("News reports mark every required field independently and keep the field in the error map", async () => {
  assert.deepEqual(NEWS_FIELDS, Object.keys(completeNewsReport()))
  for (const field of NEWS_FIELDS) {
    const payload = completeNewsReport()
    payload[field] = field === "vocabulary" ? [] : "   "
    const result = await evaluateStudentNewsMinimumRequirements(payload, {
      validationConfig: { vocabularyMinimumWords: 1, grammarEngine: { enabled: false } },
    })
    assert.equal(result.passed, false, `${field} should fail when empty`)
    assert.ok(result.failedFields[field], `${field} should be present in failedFields`)
    assert.ok(result.requiredTasks.some((task) => task.field === field), `${field} should receive a remediation task`)
  }
})

test("News field lengths match the contract and all submitted text is bounded", () => {
  const limits = {
    sourceLink: 2048,
    articleTitle: 240,
    byline: 240,
    articleDateline: 240,
    leadSynopsis: 5000,
    actionActor: 2000,
    actionAffected: 2000,
    actionWhere: 2000,
    actionWhat: 4000,
    actionWhy: 4000,
    biasAssessment: 5000,
  }
  const payload = Object.fromEntries(Object.entries(limits).map(([field, limit]) => [field, "x".repeat(limit + 17)]))
  payload.vocabulary = Array.from({ length: 102 }, (_, index) => ({
    partOfSpeech: "noun",
    english: `word-${index}-` + "x".repeat(250),
    vietnamese: "v".repeat(250),
    syllabication: "s".repeat(250),
    definition: "d".repeat(50_010),
  }))
  const normalized = normalizeStudentNewsPayload(payload)
  for (const [field, limit] of Object.entries(limits)) assert.equal(normalized[field].length, limit, `${field} limit`)
  assert.equal(normalized.vocabulary.length, 100)
  for (const row of normalized.vocabulary) {
    assert.equal(row.english.length, 240)
    assert.equal(row.vietnamese.length, 240)
    assert.equal(row.syllabication.length, 240)
    assert.equal(row.definition.length, 50_010, "definition is preserved instead of silently truncated")
  }
})

test("News vocabulary reports every required row field and precise error ownership", async () => {
  const baseline = completeNewsReport().vocabulary[0]
  const cases = [
    ["partOfSpeech", "partOfSpeech"],
    ["english", "english"],
    ["vietnamese", "vietnamese"],
    ["syllabication", "syllabication"],
    ["definition", "definition"],
  ]
  for (const [field, expectedOwner] of cases) {
    const row = { ...baseline, [field]: "" }
    const result = await evaluateStudentNewsVocabulary([row], { minimumWords: 1 })
    assert.equal(result.passed, false, `${field} must be required for a completed row`)
    assert.ok(result.rowErrors[0].fields.includes(expectedOwner), `${field} should be highlighted`)
  }
  const wrongEnglishCase = await evaluateStudentNewsVocabulary([{ ...baseline, english: "Air-strike" }], { minimumWords: 1 })
  assert.deepEqual(wrongEnglishCase.rowErrors[0].fields, ["english"])
})

test("News grammar engine maps blocking and advisory results to both grammar fields", async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (_url, options) => {
    const body = new URLSearchParams(options.body)
    requests.push({ language: body.get("language"), enabledRules: body.get("enabledRules"), text: body.get("text") })
    const isWhy = body.get("text") === completeNewsReport().actionWhy
    return new Response(JSON.stringify({ matches: isWhy
      ? [{ offset: 4, length: 6, message: "Grammar error", issueType: "grammar", rule: { id: "GRAMMAR_MATRIX" }, replacements: [{ value: "opened" }] }]
      : [{ offset: 0, length: 3, message: "Style suggestion", issueType: "style", rule: { id: "STYLE_MATRIX", category: { id: "style" } } }] }), { status: 200 })
  }
  try {
    const result = await evaluateStudentNewsMinimumRequirements(completeNewsReport(), {
      validationConfig: { vocabularyMinimumWords: 1, grammarEngine: { enabled: true, endpoint: "http://language-tool.test/v2/check", language: "en-US" } },
    })
    assert.equal(requests.length, 2)
    assert.ok(requests.every((request) => request.language === "en-US" && request.enabledRules === "ARTICLE_MISSING"))
    assert.ok(result.sentenceReports.actionWhy.issues.some((issue) => issue.ruleId === "GRAMMAR_MATRIX"))
    assert.equal(result.sentenceReports.actionWhy.languageToolStatus, "completed")
    assert.ok(result.sentenceReports.biasAssessment.advisoryIssues.some((issue) => issue.ruleId === "STYLE_MATRIX"))
    assert.equal(result.sentenceReports.biasAssessment.issues.length, 0, "style advice is not converted into a blocking grammar issue")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("News grammar engine outages and malformed payloads fail closed with bounded unavailable status", async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const response of [
      new Response("rate limited", { status: 429 }),
      new Response(JSON.stringify({ unexpected: [] }), { status: 200 }),
    ]) {
      globalThis.fetch = async () => response
      await assert.rejects(
        evaluateStudentNewsMinimumRequirements(completeNewsReport(), {
          validationConfig: { vocabularyMinimumWords: 1, grammarEngine: { enabled: true, endpoint: "http://language-tool.test/v2/check" } },
        }),
        (error) => error.statusCode === 503 && error.code === "STUDENT_NEWS_VALIDATION_UNAVAILABLE"
          && error.payload.validation.engines.languageTool === "unavailable",
      )
    }
    globalThis.fetch = async () => { throw new Error("connection reset") }
    await assert.rejects(
      evaluateStudentNewsMinimumRequirements(completeNewsReport(), {
        validationConfig: { vocabularyMinimumWords: 1, grammarEngine: { enabled: true, endpoint: "http://language-tool.test/v2/check" } },
      }),
      { statusCode: 503, code: "STUDENT_NEWS_VALIDATION_UNAVAILABLE" },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("LanguageTool maps valid ranges, filters malformed matches, and skips blank text", async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return new Response(JSON.stringify({ matches: [
      { offset: 2, length: 1, message: "Grammar", rule: { id: "VALID" } },
      { offset: -1, length: 1, message: "Bad offset", rule: { id: "INVALID_OFFSET" } },
      { offset: 0, length: 0, message: "Bad length", rule: { id: "INVALID_LENGTH" } },
      { offset: 0, length: 1, message: "No rule id" },
    ] }), { status: 200 })
  }
  try {
    assert.deepEqual(await checkTextWithLanguageTool("   ", { endpoint: "http://language-tool.test/v2/check" }), { matches: [], blockingIssues: [], advisoryIssues: [] })
    assert.equal(calls, 0)
    const result = await checkTextWithLanguageTool("One sentence.", { endpoint: "http://language-tool.test/v2/check" })
    assert.deepEqual(result.matches.map((match) => match.ruleId), ["VALID"])
    assert.equal(result.matches[0].start, 2)
    assert.equal(result.blockingIssues.length, 1)
    await assert.rejects(checkTextWithLanguageTool("text", {}), /endpoint is not configured/u)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("pronunciation engine covers format, spelling, count, primary stress, unknown words, and provider outcomes", async () => {
  const formatCases = [
    ["", /Add syllabication/u],
    ["AP-ple!", /letters, spaces, and hyphens/u],
    ["Ap-ple", /complete stressed syllable/u],
    ["aP-ple", /complete stressed syllable/u],
    ["AP-le", /spelling must match/u],
    ["apple", /primary stress is incorrect/u],
    ["aP-pLe", /complete stressed syllable/u],
    ["ap-PLE", /primary stress is incorrect/u],
    ["APP-LE", /exactly one stressed syllable/u],
  ]
  for (const [syllabication, message] of formatCases) {
    resetVocabularyDictionaryCacheForTest()
    const result = await validateVocabularyEntry({ english: "apple", syllabication })
    assert.match(result.message, message, `syllabication ${JSON.stringify(syllabication)}`)
  }

  resetVocabularyDictionaryCacheForTest()
  const acceptedLookup = mockDictionary({ collegiate: "ap*ple" })
  assert.deepEqual(await validateVocabularyEntry({ english: "apple", syllabication: "AP-ple" }, { fetchImpl: acceptedLookup.fetchImpl }), { message: "", warning: "" })
  assert.deepEqual(acceptedLookup.calls, ["collegiate"])

  resetVocabularyDictionaryCacheForTest()
  const writtenMismatch = mockDictionary({ collegiate: "a*pple" })
  assert.match((await validateVocabularyEntry({ english: "apple", syllabication: "AP-ple" }, { fetchImpl: writtenMismatch.fetchImpl })).message, /incorrect/u)

  resetVocabularyDictionaryCacheForTest()
  const learnerFallback = mockDictionary({ learners: "ap*ple" })
  assert.deepEqual(await validateVocabularyEntry({ english: "apple", syllabication: "AP-ple" }, { fetchImpl: learnerFallback.fetchImpl }), { message: "", warning: "" })
  assert.deepEqual(learnerFallback.calls, ["collegiate", "learners"])

  resetVocabularyDictionaryCacheForTest()
  const bothMissing = mockDictionary()
  assert.match((await validateVocabularyEntry({ english: "apple", syllabication: "AP-ple" }, { fetchImpl: bothMissing.fetchImpl })).message, /manual dictionary research/u)
  assert.deepEqual(bothMissing.calls, ["collegiate", "learners"])

  resetVocabularyDictionaryCacheForTest()
  const providerDown = await validateVocabularyEntry({ english: "apple", syllabication: "AP-ple" }, { fetchImpl: async () => new Response("unavailable", { status: 429 }) })
  assert.equal(providerDown.message, "")
  assert.match(providerDown.warning, /could not be verified/u)

  resetVocabularyDictionaryCacheForTest()
  const transportDown = await validateVocabularyEntry({ english: "apple", syllabication: "AP-ple" }, { fetchImpl: async () => { throw new Error("network unavailable") } })
  assert.equal(transportDown.message, "")
  assert.match(transportDown.warning, /could not be verified/u)

  resetVocabularyDictionaryCacheForTest()
  const unknown = mockDictionary({ collegiate: "ap*ple" })
  assert.match((await validateVocabularyEntry({ english: "notawordmatrix", syllabication: "not-a-WORD-matrix" }, { fetchImpl: unknown.fetchImpl })).message, /manual dictionary research/u)
  assert.deepEqual(unknown.calls, [])

  resetVocabularyDictionaryCacheForTest()
  const overrideCalls = []
  const overridden = await validateVocabularyEntry({ english: "apple", syllabication: "AP-ple" }, {
    fetchImpl: async () => { throw new Error("dictionary must not run after override") },
    overrideLookup: async (word) => { overrideCalls.push(word); return { syllabication: "AP-ple" } },
  })
  assert.deepEqual(overridden, { message: "", warning: "" })
  assert.deepEqual(overrideCalls, ["apple"])

  resetVocabularyDictionaryCacheForTest()
  const overrideMismatch = await validateVocabularyEntry({ english: "apple", syllabication: "ap-PLE" }, {
    overrideLookup: async () => ({ syllabication: "AP-ple" }),
  })
  assert.match(overrideMismatch.message, /approved school override/u)
  assert.equal(normalizeVocabularySyllabication("dem-o-LI-tion"), "dem-o-lí-tion")
})

test("Library normalizer retains every declared field and applies field-size and type normalization", () => {
  const row = normalizeLibraryEntry({
    english: "air-strike", americanEnglish: " air strike ", britishEnglish: "air-strike", partOfSpeech: "phrase",
    phraseType: "noun", grammarClassification: { grammarFamily: "test-family", grammarSubtypes: ["one", "two"] },
    etymologyType: "compound", etymology: "from air and strike", originPath: "source → modern form",
    originReferences: [{ resource: "Regression Source", url: "https://example.test/entry", retrievedAt: "2026-11-21" }],
    vietnamese: "cuộc không kích", syllabication: "air-strike", definition: "A phrase used for a military attack.",
    countability: "countable", nounType: "compound", nounNumber: "singular", physicalQuality: "concrete",
    grammaticalNumber: "singular", primaryClassification: "common", materialUsage: "", properNounVariantShift: false,
    dualCountabilityUsage: "", verbRegularity: "regular", verbTransitivity: "transitive", verbInfinitive: "to air-strike",
    verbV1: "air-strike", verbV2: "air-struck", verbV3: "air-struck", verbV4: "air-striking", verbV5: "air-strikes",
    displayVerbForm: "v1", edAdjective: true, ingAdjective: false, awlFamilyHeadword: "impact", awlQualifyingMember: "impact",
    awlMemberForm: "impacted", awlSublist: "2", dictionaryProvider: "MW", dictionarySourceUrl: "https://example.test/dict",
    dictionaryMetadata: { audioInputs: { headword: { path: "/media/headword.mp3", fileName: "headword.mp3" } } },
  }, { allowIncomplete: true })
  for (const field of LIBRARY_FIELDS) assert.ok(Object.hasOwn(row, field), `${field} must survive normalization`)
  assert.equal(row.english, "air-strike")
  assert.equal(row.grammarClassification.grammarFamilies[0], "test-family")
  assert.deepEqual(row.grammarClassification.grammarSubtypes, ["one", "two"])
  assert.equal(row.syllableCount, 2)
  assert.equal(row.awlSublist, 2)
  assert.deepEqual(row.dictionaryMetadata.audioInputs.headword, { path: "/media/headword.mp3", fileName: "headword.mp3" })
  assert.equal(row.verbInfinitive, "to air-strike")
  assert.equal(row.edAdjective, true)
  assert.equal(row.ingAdjective, false)
})

test("Library reports each conditional field failure instead of accepting malformed entry combinations", () => {
  const validNoun = {
    english: "air-strike", partOfSpeech: "noun", countability: "countable", physicalQuality: "concrete",
    grammaticalNumber: "singular", primaryClassification: "common",
  }
  const validVerb = {
    english: "air-strike", partOfSpeech: "verb", verbRegularity: "irregular", verbTransitivity: "transitive",
    verbInfinitive: "to air-strike", verbV1: "air-strike", verbV2: "air-struck", verbV3: "air-struck",
    verbV4: "air-striking", verbV5: "air-strikes",
  }
  const cases = [
    [{ partOfSpeech: "noun" }, /English word or phrase is required/u],
    [{ english: "air-strike", partOfSpeech: "made-up" }, /supported part of speech/u],
    [{ english: "Air-strike", partOfSpeech: "phrase" }, /must be lowercase/u],
    [{ english: "Air-strike", partOfSpeech: "proper noun", countability: "countable", physicalQuality: "concrete", grammaticalNumber: "plural", primaryClassification: "proper" }, /Proper nouns require concrete singular/u],
    [{ english: "air-strike", partOfSpeech: "phrase", phraseType: "unsupported" }, /Unsupported phrase type/u],
    [{ english: "air-strike", partOfSpeech: "phrase", etymologyType: "unsupported" }, /Unsupported etymology type/u],
    [{ ...validNoun, countability: "unsupported" }, /complete supported noun-class profile/u],
    [{ english: "air-strike", partOfSpeech: "noun" }, /Nouns require countable, uncountable, or countable and uncountable/u],
    [{ ...validNoun, physicalQuality: "unsupported" }, /complete supported noun-class profile/u],
    [{ ...validNoun, countability: "uncountable", grammaticalNumber: "plural" }, /must be singular/u],
    [{ ...validNoun, countability: "countable_and_uncountable", grammaticalNumber: "singular_and_plural" }, /require a usage classification/u],
    [{ ...validNoun, physicalQuality: "material", materialUsage: "mass" }, /incompatible with its usage/u],
    [{ ...validNoun, physicalQuality: "abstract", primaryClassification: "collective" }, /Collective nouns must be concrete/u],
    [{ ...validNoun, english: "Air-strike", grammaticalNumber: "plural", primaryClassification: "proper" }, /Proper nouns require concrete singular/u],
    [{ ...validVerb, verbV3: "" }, /require infinitive and V1-V5/u],
    [{ ...validVerb, verbRegularity: "sometimes" }, /require regular or irregular/u],
    [{ ...validVerb, verbTransitivity: "ditransitive-ish" }, /Transitivity must be blank/u],
    [{ english: "air-strike", partOfSpeech: "phrase", dictionaryMetadata: { audioInputs: { headword: { path: "relative.mp3" } } } }, /HTTPS URL or an absolute media path/u],
    [{ english: "air-strike", partOfSpeech: "phrase", dictionaryMetadata: { audioInputs: { headword: { path: "/media/headword.wav", fileName: "headword.wav" } } } }, /must be an MP3 file name/u],
  ]
  for (const [payload, expected] of cases) assert.throws(() => normalizeLibraryEntry(payload), expected)
  for (const field of ["verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5"]) {
    const payload = { ...validVerb, [field]: "" }
    assert.throws(() => normalizeLibraryEntry(payload), /require infinitive and V1-V5/u, `${field} is required`)
  }
})

test("direct Library student submission cannot bypass authoritative pronunciation validation", async () => {
  await assert.rejects(
    submitLibraryContribution("synthetic-student-id", "Matrix Tester", {
      entry: {
        partOfSpeech: "noun",
        english: "computer",
        vietnamese: "máy tính",
        syllabication: "COM-put-er",
        definition: "An electronic device for processing data.",
      },
    }),
    (error) => error.statusCode === 400 && /primary stress is incorrect/u.test(error.message),
  )
})
