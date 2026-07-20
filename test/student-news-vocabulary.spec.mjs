import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  evaluateStudentNewsVocabulary,
  isValidStudentNewsSyllabication,
} from "../src/modules/admin/student-news-compliance.mjs"

const STUDENT_HTML = fs.readFileSync(new URL("../web-asset/student/student-portal.html", import.meta.url), "utf8")
const SHARED_THEME = fs.readFileSync(new URL("../web-asset/shared/portal-theme.css", import.meta.url), "utf8")
const PARENT_HTML = fs.readFileSync(new URL("../web-asset/parent/parent-portal.html", import.meta.url), "utf8")
const ADMIN_JS = fs.readFileSync(new URL("../web-asset/admin/student-admin.js", import.meta.url), "utf8")
const ADMIN_HTML = fs.readFileSync(new URL("../web-asset/admin/student-admin.html", import.meta.url), "utf8")
const SERVER_ROUTES = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
const NEW_WORDS_MODULE = fs.readFileSync(new URL("../src/modules/admin/student-new-words.mjs", import.meta.url), "utf8")
const NEWS_SUBMISSIONS_MODULE = fs.readFileSync(new URL("../src/modules/admin/student-news-submissions.mjs", import.meta.url), "utf8")

function completeVocabularyRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    partOfSpeech: "noun",
    english: `word${index + 1}`,
    vietnamese: `từ ${index + 1}`,
    syllabication: `wo-RD`,
    definition: `A complete definition for word ${index + 1}.`,
  }))
}

test("student news vocabulary requires five complete rows", () => {
  assert.equal(evaluateStudentNewsVocabulary(completeVocabularyRows(4)).passed, false)
  assert.equal(evaluateStudentNewsVocabulary(completeVocabularyRows(5)).passed, true)
  assert.equal(evaluateStudentNewsVocabulary(completeVocabularyRows(5)).count, 5)
})

test("student test runtime accepts its same-origin HTTPS API origin", () => {
  assert.match(STUDENT_HTML, /if \(env === "development" && !isLoopback\)/)
  assert.match(STUDENT_HTML, /if \(env === "test" && !isLoopback && parsed\.origin !== window\.location\.origin\)/)
  assert.match(STUDENT_HTML, /if \(env !== "development" && env !== "test" && isLoopback\)/)
})

test("student news vocabulary minimum is configurable", () => {
  assert.equal(evaluateStudentNewsVocabulary(completeVocabularyRows(5), { minimumWords: 6 }).passed, false)
  assert.equal(evaluateStudentNewsVocabulary(completeVocabularyRows(6), { minimumWords: 6 }).passed, true)
})

test("student news vocabulary reports the offending entry", () => {
  const result = evaluateStudentNewsVocabulary([
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
  assert.match(result.rowErrors[0].message, /do mark one stress/)
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

test("syllabication requires stress only for multisyllabic words inside phrases", () => {
  assert.equal(isValidStudentNewsSyllabication("po-tá-to"), true)
  assert.equal(isValidStudentNewsSyllabication("po-TA-to"), true)
  assert.equal(isValidStudentNewsSyllabication("po-ta-to"), true)
  assert.equal(isValidStudentNewsSyllabication("word"), true)
  assert.equal(isValidStudentNewsSyllabication("air strike"), true)
  assert.equal(isValidStudentNewsSyllabication("air-strike"), true)
  assert.equal(isValidStudentNewsSyllabication("in the MÓRN-ing"), true)
  assert.equal(isValidStudentNewsSyllabication("potato"), true)
  assert.equal(isValidStudentNewsSyllabication("in the morn-ing"), false)
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
  assert.match(STUDENT_HTML, /autoResizeVocabularyDefinition\(textarea\)/)
  assert.match(STUDENT_HTML, /bindVocabularyDefinitionAutosize\(rowEl\)/)
  assert.match(STUDENT_HTML, /portal-button-danger news-vocabulary-remove/)
})

test("student part-of-speech selectors use a fixed longest-option width", () => {
  assert.match(STUDENT_HTML, /<option value="">POS<\/option>/)
  assert.match(SHARED_THEME, /select\[data-vocabulary-field="partOfSpeech"\][\s\S]*?field-sizing: initial;/)
  assert.match(SHARED_THEME, /select\[data-vocabulary-field="partOfSpeech"\][\s\S]*?inline-size: 12ch;/)
  assert.doesNotMatch(SHARED_THEME, /select\[data-vocabulary-field="partOfSpeech"\][\s\S]*?field-sizing: content;/)
})

test("student Save clears stale MMR UI without clearing saved form data", () => {
  assert.match(STUDENT_HTML, /if \(saved\?\.item\) applyOpenReport\(saved\.item, \{ preserveExistingValidation: false \}\)/)
  assert.match(STUDENT_HTML, /applyNewsFieldValidationUi\(\{\}, \[\], \{\}, \[\]\)/)
  assert.match(STUDENT_HTML, /setNewsComplianceModalOpen\(false\)/)
  assert.match(STUDENT_HTML, /setFormStatus\(auto \? "Draft autosaved\." : "Draft saved\. Check when you are ready to run MMR\."\)/)
})

test("student news report dates render Vietnamese text while retaining ISO payload values", () => {
  assert.match(STUDENT_HTML, /id="reportDate" type="text"[^>]*placeholder="dd\/mm\/yy"/)
  assert.match(STUDENT_HTML, /id="newsViewerReportDate" type="text"[^>]*placeholder="dd\/mm\/yy"/)
  assert.match(STUDENT_HTML, /function setPortalReportDateInput\(id, value\)/)
  assert.match(STUDENT_HTML, /el\.dataset\.isoDate = isoDate/)
  assert.match(STUDENT_HTML, /reportDate: t\(field\("reportDate"\)\?\.dataset\?\.isoDate/)
  assert.match(STUDENT_HTML, /formatPortalDate\(openDate\)/)
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
  assert.equal((STUDENT_HTML.match(/data-new-words-lightbox title/g) || []).length, 3)
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
  assert.match(STUDENT_HTML, /dictionaryPlural\(word\.english, word\.partOfSpeech\)/)
  assert.match(STUDENT_HTML, /dictionaryDefinition\(word\.definition\)/)
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
  assert.match(NEW_WORDS_MODULE, /normalizeSyllabication\(row\.syllabication\)/)
  assert.match(NEWS_SUBMISSIONS_MODULE, /syllabication: normalizeSyllabication\(/)
  assert.match(STUDENT_HTML, /function normalizeSyllabication\(value\)/)
  assert.match(STUDENT_HTML, /y: "ý"/)
  assert.match(STUDENT_HTML, /\[áéíóúý\]/)
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
