import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  evaluateStudentNewsVocabulary,
  isValidStudentNewsSyllabication,
} from "../src/modules/admin/student-news-compliance.mjs"
import {
  normalizeVocabularySyllabication,
  resetVocabularyDictionaryCacheForTest,
  validateVocabularyEntry,
  vocabularyEntryError,
} from "../src/modules/admin/vocabulary-syllabication.mjs"
import { isCheckedNewsReport } from "../src/modules/admin/student-new-words.mjs"

const STUDENT_HTML = fs.readFileSync(new URL("../web-asset/student/student-portal.html", import.meta.url), "utf8")
const STUDENT_JS = fs.readFileSync(new URL("../web-asset/student/student-portal.js", import.meta.url), "utf8")
const SHARED_THEME = fs.readFileSync(new URL("../web-asset/shared/portal-theme.css", import.meta.url), "utf8")
const ACTION_FEEDBACK_JS = fs.readFileSync(new URL("../web-asset/shared/portal-action-feedback.js", import.meta.url), "utf8")
const PARENT_HTML = fs.readFileSync(new URL("../web-asset/parent/parent-portal.html", import.meta.url), "utf8")
const ADMIN_JS = fs.readFileSync(new URL("../web-asset/admin/student-admin.js", import.meta.url), "utf8")
const ADMIN_HTML = fs.readFileSync(new URL("../web-asset/admin/student-admin.html", import.meta.url), "utf8")
const SERVER_ROUTES = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
const NEW_WORDS_MODULE = fs.readFileSync(new URL("../src/modules/admin/student-new-words.mjs", import.meta.url), "utf8")
const NEWS_SUBMISSIONS_MODULE = fs.readFileSync(new URL("../src/modules/admin/student-news-submissions.mjs", import.meta.url), "utf8")

const savedCollegiateKey = process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
const savedLearnersKey = process.env.MERRIAM_WEBSTER_LEARNERS_API_KEY
delete process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
delete process.env.MERRIAM_WEBSTER_LEARNERS_API_KEY
test.after(() => {
  if (savedCollegiateKey) process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = savedCollegiateKey
  if (savedLearnersKey) process.env.MERRIAM_WEBSTER_LEARNERS_API_KEY = savedLearnersKey
})

function completeVocabularyRows(count) {
  const rows = [
    ["apple", "AP-ple"],
    ["banana", "ba-NA-na"],
    ["computer", "com-PU-ter"],
    ["elephant", "EL-e-phant"],
    ["important", "im-POR-tant"],
    ["together", "to-GETH-er"],
  ]
  return Array.from({ length: count }, (_, index) => ({
    partOfSpeech: "noun",
    english: rows[index]?.[0] || "apple",
    vietnamese: `từ ${index + 1}`,
    syllabication: rows[index]?.[1] || "AP-ple",
    definition: `A complete definition for word ${index + 1}.`,
  }))
}

test("student news vocabulary requires five complete rows", async () => {
  assert.equal((await evaluateStudentNewsVocabulary(completeVocabularyRows(4))).passed, false)
  assert.equal((await evaluateStudentNewsVocabulary(completeVocabularyRows(5))).passed, true)
  assert.equal((await evaluateStudentNewsVocabulary(completeVocabularyRows(5))).count, 5)
})

test("student test runtime accepts its same-origin HTTPS API origin", () => {
  assert.match(STUDENT_HTML, /if \(env === "development" && !isLoopback\)/)
  assert.match(STUDENT_HTML, /if \(env === "test" && !isLoopback && parsed\.origin !== window\.location\.origin\)/)
  assert.match(STUDENT_HTML, /if \(env !== "development" && env !== "test" && isLoopback\)/)
})

test("student New Words keeps server validation details visible in dark mode", () => {
  assert.match(SHARED_THEME, /\.sis-action-feedback\[data-state="error"\] \{[\s\S]*background: var\(--primary-color\);[\s\S]*color: var\(--secondary-color\);/)
  assert.match(SHARED_THEME, /html\[data-theme="dark"\] \.sis-action-feedback\[data-state="error"\] \{[\s\S]*background: var\(--primary-color\);[\s\S]*color: var\(--secondary-color\);/)
  assert.match(ACTION_FEEDBACK_JS, /response\.clone\(\)\.json\(\)\.catch\(\(\) => null\)\.then\(/)
  assert.match(ACTION_FEEDBACK_JS, /text\(payload\?\.error\) \|\| text\(payload\?\.message\) \|\| `Request failed/)
  assert.equal(vocabularyEntryError({ english: "Word", syllabication: "word" }), "English word/phrase must be lowercase.")
  assert.match(vocabularyEntryError({ english: "word", syllabication: "word-word" }), /exactly one stressed syllable/)
})

test("student news vocabulary minimum is configurable", async () => {
  assert.equal((await evaluateStudentNewsVocabulary(completeVocabularyRows(5), { minimumWords: 6 })).passed, false)
  assert.equal((await evaluateStudentNewsVocabulary(completeVocabularyRows(6), { minimumWords: 6 })).passed, true)
})

test("student news vocabulary reports the offending entry", async () => {
  const result = await evaluateStudentNewsVocabulary([
    {
      partOfSpeech: "phrase",
      english: "in the morning",
      vietnamese: "vào buổi sáng",
      syllabication: "in the morn-ing",
      definition: "During the morning.",
    },
  ])
  assert.equal(result.passed, false)
  assert.match(result.message, /in the morning/)
  assert.equal(result.rowErrors[0].index, 0)
  assert.match(result.rowErrors[0].message, /exactly one stressed syllable/)
})

test("compound vocabulary passes required validation but can earn an extra-points warning", async () => {
  const { evaluateStudentNewsCompliance } = await import("../src/modules/admin/student-news-compliance.mjs")
  const payload = {
    sourceLink: "https://www.bbc.com/news/articles/cy91vrzxn34o",
    articleTitle: "How Pakistan won over Trump to become an unlikely mediator in the Iran war",
    byline: "Caroline Davies",
    articleDateline: "9 hours ago",
    leadSynopsis: "Pakistan became an unlikely mediator.",
    actionActor: "Pakistan",
    actionAffected: "Iran",
    actionWhere: "Iran",
    actionWhat: "Pakistan acted as a mediator.",
    actionWhy: "The parties needed a mediator.",
    biasAssessment: "The article uses neutral wording and presents more than one viewpoint.",
    vocabulary: [{
      partOfSpeech: "noun",
      english: "air-conditioning",
      vietnamese: "điều hòa không khí",
      syllabication: "air-conditioning",
      definition: "A system for cooling air.",
    }],
  }
  const result = await evaluateStudentNewsCompliance(payload, { validationConfig: { vocabularyMinimumWords: 1 } })
  assert.equal(result.failedFields.vocabulary, undefined)
  assert.match(result.warningFields.vocabulary.message, /extra points/)
})

test("air-strike never receives a false syllabication warning", async () => {
  const { evaluateStudentNewsCompliance } = await import("../src/modules/admin/student-news-compliance.mjs")
  const result = await evaluateStudentNewsCompliance({
    sourceLink: "https://www.bbc.com/news/articles/cy91vrzxn34o",
    articleTitle: "How Pakistan won over Trump to become an unlikely mediator in the Iran war",
    byline: "Caroline Davies",
    articleDateline: "9 hours ago",
    leadSynopsis: "Pakistan became an unlikely mediator.",
    actionActor: "Pakistan",
    actionAffected: "Iran",
    actionWhere: "Iran",
    actionWhat: "Pakistan acted as a mediator.",
    actionWhy: "The parties needed a mediator.",
    biasAssessment: "The article presents more than one viewpoint.",
    vocabulary: [{
      partOfSpeech: "noun",
      english: "air-strike",
      vietnamese: "cuộc không kích",
      syllabication: "air-strike",
      definition: "An attack from aircraft.",
    }],
  }, { validationConfig: { vocabularyMinimumWords: 1 } })
  assert.equal(result.warningFields.vocabulary, undefined)
})

test("syllabication rejects partial capitalization and missing stress", () => {
  assert.equal(isValidStudentNewsSyllabication("po-tá-to", "potato"), true)
  assert.equal(isValidStudentNewsSyllabication("po-TA-to", "potato"), true)
  assert.equal(isValidStudentNewsSyllabication("po-ta-to", "potato"), false)
  assert.equal(isValidStudentNewsSyllabication("pO-ta-to", "potato"), false)
  assert.equal(isValidStudentNewsSyllabication("word"), true)
  assert.equal(isValidStudentNewsSyllabication("air strike"), true)
  assert.equal(isValidStudentNewsSyllabication("air-strike", "air-strike"), true)
  assert.equal(isValidStudentNewsSyllabication("in the MÓRN-ing", "in the morning"), true)
  assert.equal(isValidStudentNewsSyllabication("potato"), true)
  assert.equal(isValidStudentNewsSyllabication("in the morn-ing", "in the morning"), false)
})

test("vocabulary guard accepts uppercase or accented stress and preserves canonical accented entry", () => {
  assert.equal(vocabularyEntryError({ english: "commended", syllabication: "com-MEND-ed" }), "")
  assert.equal(vocabularyEntryError({ english: "commended", syllabication: "com-ménd-ed" }), "")
  assert.equal(vocabularyEntryError({ english: "lion", syllabication: "LI-on" }), "")
  assert.equal(vocabularyEntryError({ english: "lion", syllabication: "lí-on" }), "")
  assert.equal(vocabularyEntryError({ english: "lion", syllabication: "li\u0301-on" }), "")
  assert.equal(vocabularyEntryError({ english: "lion", syllabication: "li\u0301‑on" }), "")
  ;["a\u0301-b", "e\u0301-b", "i\u0301-b", "o\u0301-b", "u\u0301-b"].forEach((syllabication) => {
    assert.equal(vocabularyEntryError({ english: "example", syllabication }), "")
  })
  ;["-", "—", "－", "֊", "−", "­"].forEach((separator) => {
    assert.equal(vocabularyEntryError({ english: "lion", syllabication: `lí${separator}on` }), "")
  })
  assert.equal(vocabularyEntryError({ english: "lion", syllabication: "lí‧on" }), "")
  assert.match(vocabularyEntryError({ english: "Commended", syllabication: "com-MEND-ed" }), /lowercase/)
  assert.match(vocabularyEntryError({ english: "commended", syllabication: "com-MEnd-ed" }), /complete stressed syllable/)
  const missingStress = vocabularyEntryError({ english: "commended", syllabication: "com-mend-ed" })
  assert.match(missingStress, /Research it using the provided dictionary links/)
  assert.doesNotMatch(missingStress, /com-MEND-ed/)
  assert.equal(normalizeVocabularySyllabication("com-MEND-ed"), "com-ménd-ed")
  assert.equal(normalizeVocabularySyllabication("com-ménd-ed"), "com-ménd-ed")
  assert.equal(normalizeVocabularySyllabication("con-GRÉS-sion-al"), "con-grés-sion-al")
})

test("New Words persistence keeps canonical accented stress without drift", () => {
  const uppercaseStress = "com-MEND-ed"
  const accentedStress = "com-ménd-ed"
  assert.equal(normalizeVocabularySyllabication(uppercaseStress), accentedStress)
  assert.equal(normalizeVocabularySyllabication(accentedStress), accentedStress)
  assert.equal(normalizeVocabularySyllabication("li\u0301-on"), "lí-on")
  assert.equal(normalizeVocabularySyllabication("li\u0301‑on"), "lí-on")
  assert.equal(normalizeVocabularySyllabication("li\u0301—on"), "lí-on")
  assert.equal(normalizeVocabularySyllabication("li\u0301‧on"), "lí-on")
  assert.match(
    NEW_WORDS_MODULE,
    /syllabication: normalizeVocabularySyllabication\(row\.syllabication\)\.slice\(0, 240\)/,
  )
  assert.match(STUDENT_JS, /function normalizeSyllabication\(value\) \{[\s\S]*\.normalize\("NFC"\)[\s\S]*replace\(\/\[\\p\{Pd\}\\u00AD\\u2027\\u00B7\\u22C5\\u2212\]\/gu, "-"\)/)
  assert.match(STUDENT_JS, /token\.toLocaleLowerCase\("en-US"\)[\s\S]*vowels\[char\]/)
  assert.match(NEW_WORDS_MODULE, /existingByEnglishKey = new Map\(existing\.map\(/)
  assert.match(NEW_WORDS_MODULE, /This English word already exists in your New Words list\./)
  assert.match(NEW_WORDS_MODULE, /Unique constraint failed\.\*englishKey/)
  assert.match(NEW_WORDS_MODULE, /New Words contains a duplicate English word\./)
  assert.match(NEW_WORDS_MODULE, /function isCheckedNewsReport\(report = \{\}\)/)
  assert.match(NEW_WORDS_MODULE, /ineligibleReportIds[\s\S]*studentNewWord\.deleteMany/)
  assert.match(NEW_WORDS_MODULE, /const eligibleReports = reports\.filter\(isCheckedNewsReport\)/)
})

test("New Words promotion accepts only reports that passed Check", () => {
  assert.equal(isCheckedNewsReport({ submissionState: "draft" }), false)
  assert.equal(isCheckedNewsReport({ submissionState: "draft", draftCheckedAt: "2026-08-10T01:00:00Z" }), false)
  assert.equal(isCheckedNewsReport({ submissionState: "ready", mmrPassedAt: "2026-08-10T01:00:00Z" }), true)
  assert.equal(isCheckedNewsReport({ submissionState: "submitted", firstSubmittedAt: "2026-08-10T01:00:00Z" }), true)
})

test("authoritative validator accepts CMU stress and Collegiate written division without revealing a correction", async () => {
  process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = "test-collegiate"
  resetVocabularyDictionaryCacheForTest()
  const calls = []
  const result = await validateVocabularyEntry(
    { english: "commended", syllabication: "com-MEND-ed" },
    {
      fetchImpl: async (url) => {
        calls.push(String(url))
        return {
          ok: true,
          json: async () => [{ hwi: { hw: "com*mend" }, ins: [{ if: "com*mend*ed" }] }],
        }
      },
    },
  )
  assert.deepEqual(result, { message: "", warning: "" })
  assert.equal(calls.length, 1)
  assert.doesNotMatch(JSON.stringify(result), /MEND|com-mend-ed/)
  delete process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
  resetVocabularyDictionaryCacheForTest()
})

test("authoritative validator rejects wrong stress and uses Learner's only after a Collegiate miss", async () => {
  process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY = "test-collegiate"
  process.env.MERRIAM_WEBSTER_LEARNERS_API_KEY = "test-learners"
  resetVocabularyDictionaryCacheForTest()
  const wrongStress = await validateVocabularyEntry({ english: "commended", syllabication: "COM-mend-ed" })
  assert.match(wrongStress.message, /incorrect/)
  assert.doesNotMatch(wrongStress.message, /MEND/)
  const calls = []
  const fallback = await validateVocabularyEntry(
    { english: "apple", syllabication: "AP-ple" },
    {
      fetchImpl: async (url) => {
        calls.push(String(url))
        return { ok: true, json: async () => String(url).includes("/collegiate/") ? [] : [{ hwi: { hw: "ap*ple" } }] }
      },
    },
  )
  assert.deepEqual(fallback, { message: "", warning: "" })
  assert.equal(calls.length, 2)
  assert.match(calls[0], /\/collegiate\//)
  assert.match(calls[1], /\/learners\//)
  delete process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY
  delete process.env.MERRIAM_WEBSTER_LEARNERS_API_KEY
  resetVocabularyDictionaryCacheForTest()
})

test("authoritative validator allows a warning only when Merriam-Webster is unavailable", async () => {
  resetVocabularyDictionaryCacheForTest()
  const result = await validateVocabularyEntry({ english: "apple", syllabication: "AP-ple" })
  assert.equal(result.message, "")
  assert.match(result.warning, /could not be verified/)
})

test("all student vocabulary save and check surfaces run the same client guard", () => {
  assert.match(STUDENT_JS, /function normalizeVocabularyEnglishEntry\(event\)/)
  assert.doesNotMatch(STUDENT_JS, /function normalizeVocabularyEnglishEntry\(event\) \{[\s\S]*data-vocabulary-field="syllabication"[\s\S]*input\.value\s*=\s*normalizeSyllabication\(input\.value\)/)
  assert.match(STUDENT_JS, /function validateVocabularyEntrySurface\(container, onInvalid\)/)
  assert.match(STUDENT_JS, /if \(!row\.english && !row\.syllabication\) return;/)
  assert.equal((STUDENT_JS.match(/validateVocabularyEntrySurface\(field\("newsVocabularyRows"\)/g) || []).length, 2)
  assert.equal((STUDENT_JS.match(/validateVocabularyEntrySurface\(field\("newsWeekSetModalVocabularyRows"\)/g) || []).length, 2)
  assert.match(STUDENT_JS, /validateVocabularyEntrySurface\(field\("newWordsRows"\)/)
  assert.match(STUDENT_JS, /function invalidateNewWordsCache\(\)/)
  assert.match(STUDENT_JS, /invalidateNewWordsCache\(\);[\s\S]*loadDashboard\(\)/)
  // Declaration plus one input listener for News, Week Set, and New Words.
  assert.equal((STUDENT_JS.match(/normalizeVocabularyEnglishEntry\(event\)/g) || []).length, 4)
  assert.match(NEWS_SUBMISSIONS_MODULE, /definition: normalizeText\(row\?\.definition\)/)
  assert.doesNotMatch(NEWS_SUBMISSIONS_MODULE, /definition: clampText\(row\?\.definition, 1000\)/)
})

test("student vocabulary rows provide lookup controls for initial and added rows", () => {
  assert.match(STUDENT_HTML, /Math\.max\(minimum, source\.length\)/)
  assert.match(STUDENT_HTML, /index >= minimum/)
  assert.match(STUDENT_HTML, /bindVocabularyLookupButtons\(row\)/)
  assert.match(STUDENT_HTML, /ldoceonline\.com\/dictionary\//)
  assert.match(STUDENT_HTML, /term\.replace\(\/%20\/gu, "-"\)/)
  assert.match(STUDENT_HTML, /translate\.google\.com\/\?sl=en&tl=vi&text=\$\{term\}/)
  assert.match(STUDENT_HTML, /wordhelp\.com\/syllables\/english\/\?q=\$\{term\}/)
  assert.match(STUDENT_HTML, /encodeURIComponent\(term\)/)
  assert.match(STUDENT_HTML, /normalize\("NFC"\)/)
  assert.match(STUDENT_HTML, /validationConfig\?\.vocabularyMinimumWords/)
  assert.match(STUDENT_HTML, /external-link-turquoise portal-button-external-link-turquoise news-vocabulary-lookup/)
  assert.doesNotMatch(STUDENT_HTML, /news-vocabulary-lookup[^>]*>↗/)
  assert.match(STUDENT_HTML, /rows="1" placeholder="Definition"/)
  assert.match(STUDENT_HTML, /keep compounds exact/)
  assert.match(STUDENT_HTML, /placeholder="Do: air-strike \| Extra: air-con-di-tion-ing"/)
  assert.match(STUDENT_HTML, /news-vocabulary-row-validation-message/)
  assert.match(STUDENT_HTML, /row\.querySelector\(`\[data-vocabulary-field="\$\{fieldKey\}"\]`\)\?\.classList\.add\("is-invalid"\)/)
  assert.match(SHARED_THEME, /news-vocabulary-row \[data-vocabulary-field\]\.is-invalid/)
  assert.match(STUDENT_HTML, /if \(t\(fieldId\) === "vocabulary"\) return document\.getElementById\("newsVocabularyField"\)/)
  assert.match(STUDENT_HTML, /news-vocabulary-row-dots.*>⋮</)
  assert.match(SHARED_THEME, /news-vocabulary-definition-row textarea \{[\s\S]*block-size: 48px/)
  assert.match(SHARED_THEME, /news-vocabulary-row \{[\s\S]*grid-template-columns:\s*max-content minmax\(160px, 1\.25fr\) minmax\(160px, 1\.25fr\) minmax\(180px, 1\.5fr\)/)
  assert.match(SHARED_THEME, /news-vocabulary-row > :is\(input, select, textarea\) \{[\s\S]*min-width: 0/)
  assert.match(STUDENT_HTML, /autoResizeVocabularyDefinition\(textarea\)/)
  assert.match(STUDENT_HTML, /bindVocabularyDefinitionAutosize\(rowEl\)/)
  assert.match(STUDENT_HTML, /portal-button-danger news-vocabulary-remove/)
  assert.match(STUDENT_JS, /function vocabularyEntryError\(row = \{\}\)/)
  assert.match(STUDENT_JS, /showVocabularyEntryErrors\(container\)/)
  assert.doesNotMatch(STUDENT_HTML, /function dictionaryPlural\(/)
})

test("student part-of-speech selectors use a fixed longest-option width", () => {
  assert.match(STUDENT_HTML, /<option value="">POS<\/option>/)
  assert.match(SHARED_THEME, /select\[data-vocabulary-field="partOfSpeech"\][\s\S]*?field-sizing: initial;/)
  assert.match(SHARED_THEME, /select\[data-vocabulary-field="partOfSpeech"\][\s\S]*?inline-size: 12ch;/)
  assert.doesNotMatch(SHARED_THEME, /select\[data-vocabulary-field="partOfSpeech"\][\s\S]*?field-sizing: content;/)
})

test("student Save is draft-only and preserves a prior passing MMR result", () => {
  assert.match(STUDENT_HTML, /if \(saved\?\.item\) applyOpenReport\(saved\.item, \{ preserveExistingValidation: false \}\)/)
  assert.match(STUDENT_HTML, /applyNewsFieldValidationUi\(\{\}, \[\], \{\}, \[\]\)/)
  assert.match(STUDENT_HTML, /setNewsComplianceModalOpen\(false\)/)
  assert.match(STUDENT_JS, /const mmrWasPassed = state\.newsCurrentMmrPassed === true && state\.newsFormDirty !== true/)
  assert.match(STUDENT_JS, /state\.newsCurrentMmrPassed = mmrWasPassed/)
  assert.match(STUDENT_HTML, /setFormStatus\(auto \? "Draft autosaved\." : "Draft saved\. Check when you are ready to run MMR\."\)/)
})

test("student report work survives network interruptions and keeps Submit behind MMR", () => {
  assert.match(STUDENT_JS, /NEWS_LOCAL_DRAFT_PREFIX = "sis\.student\.newsDraft\.v1:/)
  assert.match(STUDENT_JS, /localStorage\.setItem\(key, JSON\.stringify\(\{ savedAt: new Date\(\)\.toISOString\(\), payload: reportPayload\(\) \}\)\)/)
  assert.match(STUDENT_JS, /restoreNewsDraftLocally\(currentReport\)/)
  assert.match(STUDENT_JS, /state\.newsCurrentMmrPassed = false;[\s\S]*updateSubmitAvailability\(\);/)
  assert.match(STUDENT_JS, /const message = showVocabularyEntryErrors\(field\("newsVocabularyRows"\)\);\s*if \(message\) setFormStatus\(`Critical entry issue:/)
  assert.match(STUDENT_JS, /if \(saved\?\.mmrPassed === true && saved\?\.complianceFailed !== true\) clearNewsDraftLocally\(\)/)
})

test("student vocabulary warns immediately when POS and English already exist in the library", () => {
  assert.match(STUDENT_JS, /if \(container !== field\("newWordsRows"\) && state\.newWordsLoaded\)/)
  assert.match(STUDENT_JS, /t\(word\?\.partOfSpeech\)\.toLowerCase\(\) === partOfSpeech/)
  assert.match(STUDENT_JS, /t\(word\?\.english\)\.normalize\("NFC"\)\.toLocaleLowerCase\("en-US"\) === englishKey/)
  assert.match(STUDENT_JS, /Warning: \$\{row\.english\} is already in your New Words library\./)
  assert.match(STUDENT_JS, /if \(!state\.newWordsLoaded\) await loadNewWords\(\)/)
})

test("student consent banner is evaluated for already-authenticated boot sessions", () => {
  assert.equal((STUDENT_JS.match(/showPrivacyConsent\?\.\(\{ locale: "vi", portal: "student" \}\)/g) || []).length, 3)
})

test("student news report dates render Vietnamese text while retaining ISO payload values", () => {
  assert.match(STUDENT_HTML, /id="reportDate" type="text"[^>]*placeholder="dd\/mm\/yy"/)
  assert.match(STUDENT_HTML, /id="newsViewerReportDate" type="text"[^>]*placeholder="dd\/mm\/yy"/)
  assert.match(STUDENT_HTML, /function setPortalReportDateInput\(id, value\)/)
  assert.match(STUDENT_HTML, /el\.dataset\.isoDate = isoDate/)
  assert.match(STUDENT_HTML, /reportDate: t\(field\("reportDate"\)\?\.dataset\?\.isoDate/)
  assert.match(STUDENT_HTML, /formatPortalDate\(openDate\)/)
})

test("student news week-set reports retain vocabulary when calendar items are normalized", () => {
  assert.match(STUDENT_JS, /function normalizeNewsReportItem\(entry = \{\}\) \{[\s\S]*?vocabulary: Array\.isArray\(entry\?\.vocabulary\)/)
  assert.match(STUDENT_JS, /renderVocabularyRows\(field\("newsWeekSetModalVocabularyRows"\), active\?\.vocabulary \|\| \[\]\)/)
})

test("parent and admin vocabulary mirrors contain no student lookup controls", () => {
  assert.match(PARENT_HTML, /id="newsWeekSetModalVocabularyRows"/)
  assert.match(PARENT_HTML, /active\?\.vocabulary/)
  assert.match(PARENT_HTML, /class="new-word-entry"/)
  assert.doesNotMatch(PARENT_HTML, /data-vocabulary-lookup/)
  assert.match(ADMIN_JS, /news-review-vocabulary-definition/)
  assert.match(ADMIN_JS, /class="new-word-entry"/)
  assert.doesNotMatch(ADMIN_JS, /data-vocabulary-lookup/)
})

test("news report fields use numeric labels across read and edit surfaces", () => {
  const expectedStudentLabels = [
    "1. Report Date",
    "2. Source:",
    "3. Paste the full article Title",
    "4. Paste Byline",
    "5. Article Dateline / Publication Date",
    "6. Paste Lead Synopsis",
    "7. Who or what",
    "8. Who or what",
    "9. Where did",
    "10. Describe",
    "11. Why or how",
    "12. Do you suspect",
    "13. Vocabulary",
  ]
  for (const label of expectedStudentLabels) assert.match(STUDENT_HTML, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
  assert.match(PARENT_HTML, /1\. Ngày báo cáo/)
  assert.match(PARENT_HTML, /13\. Từ vựng/)
  assert.match(ADMIN_JS, /1\. Report Date/)
  assert.match(ADMIN_JS, /13\. Vocabulary/)
  assert.match(ADMIN_HTML, /<strong>13\. Vocabulary<\/strong>/)
  assert.doesNotMatch(STUDENT_HTML, /\b(?:I|II|III)\.(?:A|B|C|D|E|F)?\.?\s/)
  assert.doesNotMatch(PARENT_HTML, /\b(?:I|II|III)\.(?:A|B|C|D|E|F)?\.?\s/)
})

test("admin settings expose the dynamic vocabulary minimum", () => {
  const adminHtml = fs.readFileSync(new URL("../web-asset/admin/student-admin.html", import.meta.url), "utf8")
  assert.match(adminHtml, /id="schoolSetupNewsVocabularyMinimum"/)
  assert.match(ADMIN_JS, /vocabularyMinimumWords/)
  assert.match(ADMIN_JS, /schoolSetupNewsVocabularyMinimum/)
})

test("student New Words page exposes editable, sortable, paginated vocabulary", () => {
  assert.match(STUDENT_HTML, /data-page-target="new-words">New Words<\/a>/)
  assert.match(STUDENT_HTML, /id="newWordsPageCard"/)
  assert.match(STUDENT_HTML, /id="newWordsSort"/)
  assert.match(STUDENT_HTML, /value="random"/)
  assert.match(STUDENT_HTML, /id="newWordsPageSize"/)
  assert.match(STUDENT_HTML, /id="newWordsAddOneBtn"/)
  assert.match(STUDENT_HTML, /id="newWordsAddFiveBtn"/)
  assert.doesNotMatch(STUDENT_HTML, /new-word-entry-menu/)
  assert.match(STUDENT_HTML, /vocabularyRowHtml\(index, true, "new-word"\)/)
  assert.match(STUDENT_HTML, /class="portal-button portal-button-affirm new-word-save"[^>]*>Save<\/button>/)
  assert.match(STUDENT_HTML, /class="portal-button portal-button-warning new-word-close"[^>]*>Close<\/button>/)
  assert.match(STUDENT_HTML, /class="portal-button portal-button-danger news-vocabulary-remove"[^>]*>Remove<\/button>/)
  assert.match(STUDENT_HTML, /querySelector\("\.new-word-save"\)/)
  assert.match(STUDENT_HTML, /querySelector\("\.new-word-close"\)/)
  assert.match(STUDENT_HTML, /id="newNewsFormBtn"/)
  assert.match(STUDENT_HTML, /id="newNewsFormConfirmModal"/)
  assert.match(STUDENT_HTML, /id="checkBtn" class="portal-button portal-button-info"[^>]*title="Kiểm tra từng trường bắt buộc/)
  assert.match(STUDENT_HTML, /id="saveDraftBtn" class="portal-button portal-button-affirm"[^>]*Save/)
  assert.match(STUDENT_HTML, /STUDENT_NEWS_REPORTS_PATH\}\/draft/)
  assert.match(STUDENT_HTML, /}, 80000\)/)
  assert.match(STUDENT_HTML, /Save never runs MMR/)
  assert.match(STUDENT_HTML, /Intl\.DateTimeFormat\("vi-VN"/)
  assert.match(STUDENT_HTML, /second: "2-digit"/)
  assert.match(STUDENT_HTML, /pick\("second"\)\} \+07/)
  assert.doesNotMatch(STUDENT_HTML, /url: `#news-\$\{date\}`/)
  assert.match(STUDENT_HTML, /function studentNewsCalendarLookbackDays\(/)
  assert.match(STUDENT_HTML, /Math\.max\(49, quarterToDateDays\)/)
  assert.match(STUDENT_HTML, /id="submitBtn" class="portal-button portal-button-primary"[^>]*title="Nộp báo cáo tin tức sau khi/)
  assert.match(STUDENT_HTML, /id="newNewsFormSaveBtn"[^>]*portal-button-affirm/)
  assert.match(STUDENT_HTML, /id="newNewsFormIgnoreBtn"[^>]*portal-button-danger/)
  assert.match(STUDENT_HTML, /state\.newsFormDirty = true/)
  assert.match(STUDENT_HTML, /await checkReport\(\);\s*clearNewsReportForm\(\)/)
  assert.match(STUDENT_HTML, /if \(saved\?\.complianceFailed === true\)[\s\S]*?clearNewsReportForm\(\);[\s\S]*?await Promise\.all\(\[loadDashboard\(\), loadCalendar\(\)\]\)/)
  assert.match(STUDENT_HTML, /state\.activeView === "news" \?[\s\S]*?viewTarget === "news" :[\s\S]*?viewTarget === "home" && pageTarget === state\.activePage/)
  assert.match(SHARED_THEME, /html:not\(\[data-theme="dark"\]\) :where\(body\.student-portal-page, body\.admin-portal-page, body\.parent-portal-page\) \.new-word-entry-head > strong\.new-word-entry-part-of-speech \{\s*color: #212121!important;\s*font-size: 1\.28rem!important;\s*font-weight: 800!important;/)
  assert.match(SHARED_THEME, /html\[data-theme="dark"\] :where\(body\.student-portal-page, body\.admin-portal-page, body\.parent-portal-page\) \.new-word-entry-head > strong\.new-word-entry-part-of-speech \{\s*color: #fbffff!important;\s*font-size: 1\.28rem!important;\s*font-weight: 800!important;/)
  assert.match(STUDENT_HTML, /<details class="panel new-words-intro">/)
  assert.doesNotMatch(STUDENT_HTML, /new-words-intro" open/)
  assert.match(STUDENT_HTML, /class="new-words-intro-illustration"[\s\S]*water_ripples_one/)
  assert.equal((STUDENT_HTML.match(/<details class="panel student-new-words-instructions">/g) || []).length, 2)
  assert.equal((STUDENT_HTML.match(/data-new-words-lightbox\s+title/g) || []).length, 3)
  assert.match(STUDENT_HTML, /id="newWordsImageLightbox"[\s\S]*id="newWordsImageLightboxCloseBtn"/)
  assert.match(STUDENT_HTML, /For a monosyllabic word[\s\S]*keep the spaces between words[\s\S]*air-strike[\s\S]*MÓRN-ing[\s\S]*air-con-di-tion-ing/)
  assert.match(SHARED_THEME, /student-new-words-instructions-body[\s\S]*background: #f5f9ff/)
  assert.match(SHARED_THEME, /html\[data-theme="dark"\][\s\S]*student-new-words-instructions-body[\s\S]*background: #303a48/)
  assert.match(SHARED_THEME, /student-new-words-lightbox-dialog[\s\S]*background: #fbffff/)
  assert.match(SHARED_THEME, /html\[data-theme="dark"\][\s\S]*student-new-words-lightbox-dialog[\s\S]*background: #202936/)
  assert.match(SHARED_THEME, /new-words-intro-illustration[\s\S]*color: #B50010[\s\S]*max-width: 100px/)
  assert.match(SHARED_THEME, /html\[data-theme="dark"\] body\.student-portal-page \.new-words-intro-body \.new-words-intro-illustration[\s\S]*color: #EDB144/)
  assert.match(STUDENT_HTML, /STUDENT_NEW_WORDS_PATH/)
  assert.match(STUDENT_HTML, /saveNewWords\(\)/)
  assert.match(STUDENT_HTML, /new-words-add-actions[\s\S]*id="newWordsAddOneBtn"[\s\S]*id="newWordsAddFiveBtn"/)
  assert.match(STUDENT_HTML, /new-words-save-actions[\s\S]*id="newWordsSaveBtn"/)
  assert.match(STUDENT_HTML, /new-word-entry-pronunciation/)
  assert.doesNotMatch(STUDENT_HTML, /dictionaryPlural\(word\.english, word\.partOfSpeech\)/)
  assert.match(STUDENT_HTML, /dictionaryDefinition\(word\.definition\)/)
  assert.match(STUDENT_JS, /function dictionaryDefinition\(definition\) \{\s*return t\(definition\) \|\| "No definition yet\.";\s*\}/)
  assert.doesNotMatch(STUDENT_JS, /return \/\^\\d\+\\\.\\s\/u\.test\(value\) \? value : `1\. \$\{value\}`/)
  assert.match(STUDENT_HTML, /new-word-entry-vietnamese/)
  assert.equal((STUDENT_HTML.match(/class="new-words-intro-illustration"/g) || []).length, 3)
  assert.match(STUDENT_HTML, /water_ripples_modal/)
  assert.match(STUDENT_HTML, /water_ripples_news/)
  assert.match(STUDENT_HTML, /portal-button-primary new-word-edit/)
  assert.match(STUDENT_HTML, /newsVocabularyRows" class="news-vocabulary-rows vocabulary-edit-surface"/)
  assert.match(STUDENT_HTML, /addNewsVocabularyRowBtn" type="button" class="portal-button portal-button-affirm"/)
  assert.match(SHARED_THEME, /new-word-entry-head \.new-word-edit[\s\S]*--portal-button-min-block: 36px/)
  assert.match(SHARED_THEME, /new-words-intro[\s\S]*background: var\(--portal-surface-panel\)/)
  assert.match(SHARED_THEME, /new-word-entry \{[\s\S]*background: var\(--portal-surface-panel\)/)
  assert.match(SHARED_THEME, /new-word-entry-head strong \{[\s\S]*color: #B50010/)
  assert.match(SHARED_THEME, /html\[data-theme="dark"\] body\.student-portal-page \.new-word-entry-head strong,[\s\S]*color: #EDB144/)
  assert.match(SERVER_ROUTES, /STUDENT_NEW_WORDS_PATH/)
  assert.match(SERVER_ROUTES, /saveStudentNewWords\(studentRefId, payload\?\.items\)/)
  assert.match(NEW_WORDS_MODULE, /studentNewWord\.findMany/)
  assert.match(NEW_WORDS_MODULE, /new Map\(\)/)
  assert.match(NEW_WORDS_MODULE, /FIXED_TIME_ZONE_OFFSET_MS/)
  assert.match(NEW_WORDS_MODULE, /sourceReportDate: localDateKey\(row\.sourceReportDate\)/)
  assert.match(NEW_WORDS_MODULE, /normalizeVocabularySyllabication\(row\.syllabication\)/)
  assert.match(NEWS_SUBMISSIONS_MODULE, /syllabication: normalizeSyllabication\(/)
  assert.match(NEWS_SUBMISSIONS_MODULE, /definition: normalizeText\(row\?\.definition\)/)
  assert.match(STUDENT_JS, /function normalizeVocabularyEnglishEntry\(event\)/)
  assert.match(STUDENT_JS, /field\("newWordsRows"\)\?\.addEventListener\("input", \(event\) => \{\s*normalizeVocabularyEnglishEntry\(event\);/)
  assert.doesNotMatch(STUDENT_HTML, /syllableCount\s*===\s*1[\s\S]*?normalizeSyllabication/)
  assert.match(SHARED_THEME, /new-word-entry-definition[\s\S]*padding-inline-start: 18px/)
})

test("new form persistence protects edits made before a report date exists", () => {
  const dirtyFunction =
    STUDENT_HTML.match(
      /function markNewsDraftDirty\(\) \{[\s\S]*?\n\s*\}/,
    )?.[0] || ""
  assert.match(dirtyFunction, /state\.newsFormDirty = true/)
  assert.doesNotMatch(dirtyFunction, /reportDate/)
  assert.match(STUDENT_HTML, /newNewsFormBtn[\s\S]*requestNewNewsReportForm\(\)/)
  assert.match(STUDENT_HTML, /newNewsFormConfirmModalOpen = true/)
})
