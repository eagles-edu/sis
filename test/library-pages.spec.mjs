import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import vm from "node:vm"
import { JSDOM } from "jsdom"

const student = fs.readFileSync(new URL("../web-asset/student/library.html", import.meta.url), "utf8")
const admin = fs.readFileSync(new URL("../web-asset/admin/library-admin.html", import.meta.url), "utf8")
const definitions = fs.readFileSync(new URL("../web-asset/admin/library-definitions.html", import.meta.url), "utf8")
const definitionsScript = fs.readFileSync(new URL("../web-asset/admin/library-definitions.js", import.meta.url), "utf8")
const studentPortal = fs.readFileSync(new URL("../web-asset/student/student-portal.html", import.meta.url), "utf8")
const adminPortal = fs.readFileSync(new URL("../web-asset/admin/student-admin.html", import.meta.url), "utf8")
const adminPortalScript = fs.readFileSync(new URL("../web-asset/admin/student-admin.js", import.meta.url), "utf8")
const standaloneAdminNavs = [
  "student-enrollment.html",
  "student-enrollment-IDK.html",
  "grades-tabulator.html",
  "report-card.html",
].map((name) => [name, fs.readFileSync(new URL(`../web-asset/admin/${name}`, import.meta.url), "utf8")])
const routes = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
const libraryCorpus = fs.readFileSync(new URL("../src/modules/admin/library-corpus.mjs", import.meta.url), "utf8")
const portalScript = fs.readFileSync(new URL("../web-asset/student/student-portal.js", import.meta.url), "utf8")
const sharedVocabularyEditor = fs.readFileSync(new URL("../web-asset/shared/vocabulary-esl-editor.js", import.meta.url), "utf8")
const libraryReviewWorkbench = fs.readFileSync(new URL("../web-asset/admin/library-review-workbench.js", import.meta.url), "utf8")
const sharedPortalTheme = fs.readFileSync(new URL("../web-asset/shared/portal-theme.css", import.meta.url), "utf8")
const definitionDocumentation = fs.readFileSync(new URL("../docs/defspace-1.md", import.meta.url), "utf8")
const definitionSpacingSample = fs.readFileSync(new URL("../docs/defspace-1.md", import.meta.url), "utf8").split("==================================================================")[0].replace(/^preferredformat as:\s*/u, "").trim()

test("student Library is a protected physical page with shared chrome and student chat", () => {
  assert.match(student, /body class="student-portal-page"/)
  assert.match(student, /portal-theme\.min\.css/)
  assert.match(student, /student-portal\.min\.css/)
  assert.match(student, /import svgIcon from "\/web-asset\/icons\/web-component\/svg-icon\.js"/)
  assert.match(student, /<svg-icon name="theme-moon"[^>]*id="studentThemeToggleIcon"/)
  assert.match(student, /themeIcon\.setAttribute\("name", isDark \? "theme-sun" : "theme-moon"\)/)
  assert.match(student, /class="content topbar"/)
  assert.match(student, /<footer class="hub-footer portal-login-footer"/)
  assert.match(student, /initPrivacyConsent\?\.\(\{ locale: "vi", portal: "student" \}\)/)
  assert.match(studentPortal, /href="\/student\/library\.html"[^>]*>Library/)
  assert.match(routes, /const STUDENT_LIBRARY_PAGE_PATH = `\$\{STUDENT_PORTAL_PAGE_PATH\}\/library\.html`/)
  assert.match(student, /id="libraryFilters"/)
  assert.match(student, /id="libraryMyWords"[^>]*type="checkbox"/)
  assert.match(student, /myWords: document\.getElementById\("libraryMyWords"\)\.checked \? "true" : ""/)
  assert.match(student, /libraryFilters.*addEventListener\("submit"/s)
  assert.match(student, /class="library-results"/)
  assert.match(student, /id="libraryPage">1 of 1</)
  assert.match(student, /flatEntryHtml\(entry, \{ accordion: true, editLabel:/)
  assert.match(student, /libraryPageSize/)
  assert.match(student, /Math\.ceil\(libraryTotal \/ libraryPageSize\)/)
  assert.match(sharedVocabularyEditor, /accordion = false/)
  assert.match(sharedVocabularyEditor, /<details class="library-entry-accordion"/)
  assert.doesNotMatch(student, /<style>/)
  assert.match(student, /createdByName/)
  assert.match(student, /__SIS_STUDENT_API_PREFIX/)
  assert.match(routes, /const STUDENT_LIBRARY_API_PATH = `\$\{STUDENT_API_PREFIX\}\/library`/)
})

test("New Words and News vocabulary use the same full ESL row payload without student MW fill", () => {
  for (const token of ["VOCABULARY_ESL_FIELDS", "verbInfinitive", "verbV5", "grammarClassification", "readVocabularyRows", "syncVocabularyEslRow", "SIS_VOCABULARY_ESL"]) assert.match(portalScript, new RegExp(token))
  assert.doesNotMatch(portalScript, /data-vocabulary-mw-preview|mw-preview/)
  for (const token of ["countable", "uncountable", "countable_and_uncountable", "physicalQuality", "grammaticalNumber", "primaryClassification", "materialUsage", "properNounVariantShift", "dualCountabilityUsage", "1. Countability", "2. Quality", "3. Number", "4. Classification", "Common", "Proper", "Concrete", "Abstract", "Material", "Collective", "Compound", "Possessive", "primary", "modal", "action", "intransitive", "transitive", "monotransitive", "ditransitive", "ambitransitive", "Types of transitivity", "optional", "etymologyType", "Etymology / word origin", "vocabulary-verb-forms", "hydrate", "name=\"vocabularyPartOfSpeech-", "flatEntryHtml", "definitionHtml", "<strong>", "<em>", "<u>"]) assert.match(sharedVocabularyEditor, new RegExp(token))
  assert.match(sharedVocabularyEditor, /function nounState/)
  assert.match(portalScript, /VOCABULARY_ESL_FIELDS = \[[^\]]*physicalQuality[^\]]*dualCountabilityUsage/)
  for (const surface of ["newWordsRows", "newsVocabularyRows", "newsWeekSetModalVocabularyRows"]) assert.match(studentPortal, new RegExp(surface))
  assert.match(sharedVocabularyEditor, /const renderList = \(start, indentation\) =>/)
  assert.match(sharedVocabularyEditor, /const alphabetic = line\.match/)
  assert.match(sharedVocabularyEditor, /indent nested items/)
  for (const label of ["LD", "OA", "OB", "BR", "MW", "ET", "WK", "CA", "TH", "WH", "GT"]) assert.match(sharedVocabularyEditor, new RegExp(`\\\"${label}\\\"`))
  assert.match(sharedVocabularyEditor, /includeMwFill = false/)
  assert.match(sharedVocabularyEditor, /\"CA\"/)
  assert.doesNotMatch(sharedVocabularyEditor, /\"GL\"/)
  assert.match(sharedVocabularyEditor, /lookupButtons = null/)
  assert.match(sharedVocabularyEditor, /\["LD", "OA", "OB", "BR", "MW", "AP", "ET", "WK", "CA", "TH", "WH", "GT"\]/)
  assert.match(sharedVocabularyEditor, /portal-button-blue-action/)
  assert.match(portalScript, /lookupButtons: \["LD", "OA", "OB", "BR", "MW", "AP", "ET", "WK", "CA", "TH", "WH", "GT"\]/)
  assert.match(sharedVocabularyEditor, /Cambridge English Dictionary/)
  assert.match(sharedVocabularyEditor, /Oxford Learner's Dictionaries British English/)
  assert.match(sharedVocabularyEditor, /Merriam-Webster API verb forms/)
  assert.doesNotMatch(sharedVocabularyEditor, /<strong>(?:First known use|Etymology):<\/strong>/)
  assert.doesNotMatch(libraryCorpus, /`\*\*(?:First known use|Etymology):\*\*`/)
  assert.doesNotMatch(studentPortal, /data-vocabulary-origin-analysis|origin-analysis/)
  assert.match(sharedVocabularyEditor, /const output = \[`<\$\{listType\}\$\{typeAttribute\}>`\]/)
  assert.doesNotMatch(routes, /STUDENT_LIBRARY_API_PATH\}\/mw-preview/)
  assert.match(student, /vocabulary-esl-editor\.js/)
  assert.match(student, /entry\.isContribution === true \|\| entry\.studentCanEdit === true/)
  assert.match(student, /entry\.isContribution === true[\s\S]*?contributionId: entry\.contributionId/)
  assert.match(libraryCorpus, /isStudentLibraryContributionEditable/)
  assert.match(libraryCorpus, /Students may edit only their own Library contribution/)
  assert.match(studentPortal, /id="newWordsRefreshBtn"/)
  assert.match(portalScript, /function refreshNewWords\(/)
})

test("Student Library saves the complete shared editor payload without dropping legacy fields", () => {
  const dom = new JSDOM("<!doctype html><body></body>")
  const context = { window: dom.window, document: dom.window.document, Event: dom.window.Event, HTMLTextAreaElement: dom.window.HTMLTextAreaElement }
  vm.runInNewContext(sharedVocabularyEditor, context)
  const row = dom.window.document.createElement("div")
  row.innerHTML = context.window.SIS_VOCABULARY_ESL.editorRowHtml("library-save")
  const existing = {
    partOfSpeech: "noun", english: "apple", vietnamese: "quả táo", syllabication: "AP-ple", definition: "A round fruit.",
    nounType: "common", nounNumber: "singular", countability: "countable", physicalQuality: "concrete", grammaticalNumber: "singular", primaryClassification: "common",
    etymologyType: "borrowed", etymology: "From Old English.", originPath: "Old English → English", originReferences: [{ source: "Etymonline", url: "https://www.etymonline.com/word/apple" }],
  }
  context.window.SIS_VOCABULARY_ESL.hydrate(row, existing)
  row.querySelector('[data-vocabulary-field="vietnamese"]').value = "táo"
  const payload = context.window.SIS_VOCABULARY_ESL.readEditorEntry(row, existing)
  assert.equal(payload.vietnamese, "táo")
  assert.equal(payload.nounType, "common")
  assert.equal(payload.nounNumber, "singular")
  assert.equal(payload.etymology, "From Old English.")
  assert.deepEqual(JSON.parse(JSON.stringify(payload.originReferences)), existing.originReferences)
  assert.match(student, /readEditorEntry\(row, entry\)/)
  dom.window.close()
})

test("admin Library is a protected physical page under Administration without chat", () => {
  assert.match(admin, /body class="admin-portal-page page library-admin-page"/)
  assert.match(admin, /<button id="floatingMenuBtn"[\s\S]*?<div id="menuBackdrop"[\s\S]*?<div class="wrap">[\s\S]*?<aside class="panel app-sidebar"[\s\S]*?<\/aside>[\s\S]*?<div class="header-bar portal-login-header"[\s\S]*?<main id="appMain"/)
  assert.match(admin, /<main id="appMain"[\s\S]*?<\/main>\s*<section class="content portal-prefooter"[\s\S]*?<footer class="hub-footer"/)
  assert.doesNotMatch(admin, /<div class="app-shell">/)
  assert.match(sharedPortalTheme, /body\.admin-portal-page\.library-admin-page \.wrap\s*\{[\s\S]*?display:\s*grid;[\s\S]*?padding:\s*18px;[\s\S]*?width:\s*min\(100%, 1440px\)/)
  assert.match(admin, /portal-theme\.min\.css/)
  assert.doesNotMatch(admin, /admin-portal-theme\.min\.css/)
  assert.match(admin, /import svgIcon from "\/web-asset\/icons\/web-component\/svg-icon\.js"/)
  assert.match(admin, /<svg-icon name="theme-moon"[^>]*id="adminThemeToggleIcon"/)
  assert.match(admin, /themeIcon\.setAttribute\("name", isDark \? "theme-sun" : "theme-moon"\)/)
  assert.match(admin, /class="content topbar"/)
  assert.match(admin, /<footer class="hub-footer"/)
  assert.doesNotMatch(admin, /initPrivacyConsent|conversation-widget/i)
  assert.match(admin, /Library assignment engagement|Brevo queue/)
  assert.match(admin, /data-library-section="library"/)
  assert.match(admin, /href="\/admin\/library\/manage"/)
  assert.match(admin, /href="\/admin\/library\/engagement"/)
  assert.match(admin, />Preflight<|>Cutover<|>Assign<|>Email</)
  assert.match(adminPortal, /data-menu-group="library"[\s\S]*href="\/admin\/library"[\s\S]*href="\/admin\/library\/manage"[\s\S]*href="\/admin\/library\/engagement"/)
  assert.match(adminPortal, /data-library-nav="library"[\s\S]*data-library-nav="manage"[\s\S]*data-library-nav="engagement"/)
  assert.match(adminPortalScript, /\[data-page-link\]:not\(\.hidden\), \[data-library-nav\]:not\(\.hidden\)/)
  assert.match(routes, /const ADMIN_LIBRARY_PAGE_PATH = `\$\{ADMIN_PAGE_PATH\}\/library`/)
  assert.match(routes, /const ADMIN_LIBRARY_MANAGE_PAGE_PATH = `\$\{ADMIN_LIBRARY_PAGE_PATH\}\/manage`/)
  assert.match(routes, /const ADMIN_LIBRARY_ENGAGEMENT_PAGE_PATH = `\$\{ADMIN_LIBRARY_PAGE_PATH\}\/engagement`/)
  assert.doesNotMatch(routes, /LEGACY_ADMIN_LIBRARY_(PAGE|MANAGE_PAGE|ENGAGEMENT_PAGE)_PATH/)
  assert.doesNotMatch(admin, /library-(admin|manage|engagement)\.html/)
  assert.doesNotMatch(routes, /cleanQuery\.delete\("apiOrigin"\)/)
  assert.doesNotMatch(routes, /removeApiOrigin/)
  assert.match(routes, /if \(apiOrigin\) next\.searchParams\.set\("apiOrigin", apiOrigin\)/)
  assert.match(routes, /next\.searchParams\.set\("next", `\$\{pathname\}\$\{url\.search\}`\)/)
  assert.match(admin, /id="libraryAdminFilters"/)
  assert.match(admin, /id="libraryAdminPagination"/)
  assert.match(admin, /id="libraryAdminAddOneBtn"[^>]*>Add Word<\/button>/)
  assert.match(admin, /id="libraryAdminAddFiveBtn"[^>]*>Add Five<\/button>/)
  assert.match(admin, /libraryAdminNewWordsRows/)
  assert.match(admin, /function addLibraryNewWords\(count = 1\)/)
  assert.match(admin, /function submitLibraryNewWords\(\)/)
  assert.match(admin, /let entries = new Map\(\); let approvedPage = 1/)
  assert.match(admin, /page: String\(approvedPage\), pageSize: "100"/)
  assert.match(admin, /function renderApprovedPagination\(total, pageSize\)/)
  assert.match(admin, /let repairingLegacyRender = false/)
  assert.match(admin, /firstEntry && !firstEntry\.dataset\.libraryEntryId/)
  assert.match(admin, /summary\.textContent = window\.SIS_VOCABULARY_ESL\.flatEntrySummaryText\(entry\)/)
  assert.match(admin, /shared\/vocabulary-esl-editor\.js/)
  assert.match(admin, /class="panel library-review-workspace"[\s\S]*data-surface-role="panel"/)
  assert.match(admin, /data-surface-role="card" data-vocabulary-editor/)
  assert.match(admin, /editorRowHtml\(`review-\$\{slot\}`, \{ includeDictionaryBuilder: true, includeTransitivityTools: true, includeOriginAnalysis: true, originLookupPath:/)
  assert.match(admin, /const SHARED_FIELDS = new Set\(\["english"[\s\S]*"definition"[\s\S]*"etymologyType", "etymology"/)
  assert.match(admin, /data-review-sidebar-toggle/)
  assert.match(admin, /editorRowHtml\(`library-\$\{entry\.id\}`/)
  assert.match(admin, /library-review-advanced-fields/)
  assert.match(admin, /const fields = \["english", "americanEnglish", "britishEnglish", "partOfSpeech", "phraseType", "vietnamese", "syllabication", "syllableCount", "definition", "etymologyType", "etymology"\]/)
  assert.match(admin, /data-vocabulary-field=\"partOfSpeech\".*window\.SIS_VOCABULARY_ESL\.sync\(row\)/s)
  assert.match(admin, /flatEntryHtml\(entry, \{ editClass: "library-admin-flat-edit"/)
  assert.match(admin, /let entries = new Map\(\);[\s\S]*?const flatHtml = \(entry\) => window\.SIS_VOCABULARY_ESL\.flatEntryHtml[\s\S]*?function enhanceAccordions\(\) \{[\s\S]*?async function loadApproved\(\)/)
  assert.match(admin, /data-library-entry-id=/)
  assert.match(admin, /data-approved-edit=/)
  assert.match(admin, /Saving here updates this entry as the approved canonical version immediately/)
  assert.match(admin, /json\(`\/entries\/\$\{encodeURIComponent\(entry\.id\)\}`, \{ method: "PUT"/)
  assert.match(admin, /message\.textContent = saved\.canonicalizedContributions \?[\s\S]*?"Canonical Library entry saved\."/)
  assert.match(admin, /saved\.canonicalizedContributions/)
  assert.match(libraryCorpus, /selectContributionsForCanonicalEntry/)
  assert.match(libraryCorpus, /canonicalized_by_admin_edit/)
  assert.match(libraryCorpus, /canonicalEntryForContribution\(tx, submitted, actor, \{ allowIncomplete: true \}\)/)
  assert.match(libraryCorpus, /const sourceEntryIds = new Set\(\[contribution\.entryId, canonicalContribution\.entryId\]/)
  assert.match(admin, /selectedQueueItem = null; await loadQueue\(\{ selectFirst: false \}\); renderSavedCanonical\(saved\.entry/)
  assert.match(admin, /json\(`\/entries\/\$\{encodeURIComponent\(entry\.id\)\}`, \{ method: "PUT"/)
  assert.doesNotMatch(admin, /window\.location\.assign\(`\$\{location\.origin\}\/admin\/library\/manage/)
  assert.match(admin, /editAttributes: `data-approved-edit="\$\{esc\(entry\.id\)\}"`/)
  assert.doesNotMatch(sharedVocabularyEditor, /model\.legacyPending \? ""/)
  assert.match(admin, /function groupFor\(item\) \{ const group = item\?\.duplicateGroup\?\.length \? \[item, \.\.\.item\.duplicateGroup\.filter/)
  assert.doesNotMatch(admin, /Provisional edit submitted to the approval queue/)
  assert.match(admin, /aria-controls="appSidebarNav"/)
  assert.match(admin, /body\.classList\.toggle\("menu-open", open\)/)
  assert.match(admin, /data-vocabulary-field="partOfSpeech"/)
  assert.match(admin, /item\.legacyReview \? " <span class=\\"chip chip-warn\\">Legacy<\/span>"/)
  assert.match(sharedPortalTheme, /body\.admin-portal-page \.chip\s*\{[\s\S]*?background:\s*#e2edff/)
  assert.match(sharedPortalTheme, /body\.admin-portal-page \.chip-warn\s*\{[\s\S]*?background:\s*#ffe9c7/)
  assert.doesNotMatch(admin, /Ed Adjective|Ing Adjective/)
  assert.doesNotMatch(admin, /AWL:|awlFamilyHeadword|awlSublist/)
  assert.doesNotMatch(student, /Academic sublist|libraryAwl|AWL family/)
  assert.match(sharedPortalTheme, /body\.admin-portal-page \.library-review-field select,[\s\S]*width: auto/)
  assert.match(sharedPortalTheme, /body\.admin-portal-page \.vocabulary-pos-control select,[\s\S]*max-inline-size: 27\.5ch/)
  assert.match(sharedPortalTheme, /body\.admin-portal-page \.wrap > \.portal-login-header[\s\S]*inline-size: calc\(100% - 32px\)/)
  assert.match(sharedPortalTheme, /body\.student-portal-page \.wrap > \.portal-login-header[\s\S]*inline-size: calc\(100% - 32px\)/)
  assert.match(sharedPortalTheme, /body\.parent-portal-page \.wrap > \.portal-login-header[\s\S]*inline-size: calc\(100% - 32px\)/)
  assert.match(sharedPortalTheme, /body\.admin-portal-page \.wrap > \.portal-login-header,[\s\S]*body\.student-portal-page \.wrap > \.portal-login-header,[\s\S]*body\.parent-portal-page \.wrap > \.portal-login-header[\s\S]*inline-size: 100%/)
  for (const token of ["data-entry-review-docs", "AGENTS.md", "docs/sop.md", "docs/history.md", "History (HX)"]) assert.match(libraryReviewWorkbench, new RegExp(token.replace(/[().]/g, "\\$&")))
  assert.match(admin, /Run legacy preflight/)
  assert.doesNotMatch(admin, /Open duplicate cases/)
  assert.match(admin, /data-mw-preview/)
  assert.match(routes, /getLibraryEntry\(decodeURIComponent\(mwPreviewMatch\[1\]\)\)/)
  assert.match(routes, /previewMerriamWebsterLibraryEntry\(entry\)/)
  assert.match(admin, /library-review-workbench\.js/)
  assert.doesNotMatch(admin, /classList\.toggle\("open"/)
  assert.match(admin, /parentElement\?\.classList\.toggle\("expanded", expanded\)/)
  for (const token of ["Full flattened review", "Largest dupe", "Legacy source", "open_review", "New canonical", "Horizontal split", "Vertical split", "Lock pane scroll", "Save canonical", "Assign merge", "data-review-field", "data-vocabulary-field", "data-canonical-select"]) assert.match(admin, new RegExp(token))
  assert.match(sharedVocabularyEditor, /<span class="chip chip-warn">Legacy<\/span>/)
  assert.match(admin, /selectedQueueItem = refreshed \|\| \(selectFirst \? queueItems\[0\] : null\) \|\| null/)
  assert.match(libraryReviewWorkbench, /is-sidebar-collapsed/)
  assert.match(libraryReviewWorkbench, /MW returned no etymology section for this part of speech/)
  assert.match(libraryReviewWorkbench, /Supported dropdown choices/)
  assert.doesNotMatch(admin, /data-review-pane-collapse/)
  assert.match(libraryReviewWorkbench, /data-review-sidebar-toggle/)
  assert.match(admin, /library-review-sidebar-body/)
  assert.match(sharedPortalTheme, /library-review-shell\.is-sidebar-collapsed/)
  assert.match(sharedPortalTheme, /\.library-admin-entry summary\s*\{[\s\S]*?background:\s*#CDE0FF/)
  assert.match(sharedPortalTheme, /html\[data-theme="dark"\] \.library-admin-entry summary\s*\{[\s\S]*?background:\s*#212121/)
  assert.match(sharedPortalTheme, /\.library-review-list\s*\{[\s\S]*?background:\s*var\(--portal-surface-panel\)/)
  assert.match(sharedPortalTheme, /\.library-review-item\s*\{[\s\S]*?background:\s*#CDE0FF !important[\s\S]*?color:\s*#173962 !important/)
  assert.match(sharedPortalTheme, /html\[data-theme="dark"\] \.library-review-item\s*\{[\s\S]*?background:\s*#212121 !important[\s\S]*?color:\s*var\(--portal-text\) !important/)
  assert.doesNotMatch(sharedPortalTheme, /\.library-admin-entry summary,\s*\.library-review-list\s*\{[\s\S]*?background:/)
  assert.match(admin, /portal-button-blue-action[\s\S]*data-mw-preview/)
  assert.match(admin, /portal-button-blue-action[\s\S]*data-library-assign/)
  assert.match(admin, /portal-button-blue-action[\s\S]*data-review-assign-merge/)
  assert.match(sharedVocabularyEditor, /portal-button-blue-action vocabulary-mw-fill/)
  assert.match(sharedVocabularyEditor, /portal-button-blue-action" data-vocabulary-transitivity-check/)
  assert.match(sharedVocabularyEditor, /portal-button-blue-action" data-vocabulary-transitivity-autofill/)
  assert.doesNotMatch(admin, /portal-button-alt/)
  assert.doesNotMatch(libraryReviewWorkbench, /portal-button-alt/)
  assert.match(libraryReviewWorkbench, /is-different/)
  assert.match(libraryReviewWorkbench, /MutationObserver/)
  assert.match(routes, /const ADMIN_LIBRARY_API_PATH = `\$\{ADMIN_API_PREFIX\}\/library`/)
  assert.match(routes, /checkLibraryEntryVerbTransitivity\(payload\)/)
  assert.match(sharedVocabularyEditor, /data-vocabulary-transitivity-check/)
  assert.match(sharedVocabularyEditor, /data-vocabulary-transitivity-autofill/)
  assert.match(routes, /autoFillLibraryEntryVerbTransitivity\(payload\)/)
  assert.match(libraryReviewWorkbench, /\["verb", pane\.querySelector\('\[data-vocabulary-field="english"\]'\)\?\.value \|\| ""\]/)
  assert.match(libraryReviewWorkbench, /transitivity-autofill/)
  assert.match(libraryReviewWorkbench, /Merriam-Webster complete data/)
  assert.match(admin, /function bindSharedEditorRow\(pane\)/)
  assert.match(admin, /sharedEditorBound === "true"/)
  assert.match(admin, /window\.SIS_VOCABULARY_ESL\?\.sync\(row\)/)
  assert.match(admin, /window\.SIS_VOCABULARY_ESL\?\.bindLookupButtons\(pane\)/)
  assert.match(admin, /window\.SIS_VOCABULARY_ESL\?\.bindDefinitionAutosize\(pane\)/)
  assert.match(sharedVocabularyEditor, /data-vocabulary-mw-details/)
  assert.match(sharedVocabularyEditor, /data-vocabulary-mw-message/)
  assert.match(sharedVocabularyEditor, /preserveSyllabication = false/)
  assert.match(sharedVocabularyEditor, /lookupBound === "true"/)
  assert.match(sharedVocabularyEditor, /const POS = \[[\s\S]*"proper noun"[\s\S]*"numeral"/)
  assert.match(sharedVocabularyEditor, /const hasTools = Boolean\(surface\.querySelector\(/)
  assert.match(libraryReviewWorkbench, /preserveSyllabication: true/)
  assert.match(libraryReviewWorkbench, /const mwEtymology = \(data = \{\}\)/)
  assert.match(libraryReviewWorkbench, /\.\.\.current, \.\.\.nonEmptyMwFields, \.\.\.\(etymology \? \{ etymology \} : \{\}\)/)
  assert.match(libraryReviewWorkbench, /window\.SIS_VOCABULARY_ESL\?\.hydrate\(pane, merged, \{ preserveSyllabication: true \}\)/)
  assert.match(libraryReviewWorkbench, /window\.SIS_VOCABULARY_ESL\?\.hydrate\(pane, data\.entry, \{ preserveSyllabication: true \}\)/)
  assert.match(sharedVocabularyEditor, /data-vocabulary-verb-forms[\s\S]*verbInfinitive[\s\S]*verbV1[\s\S]*verbV2[\s\S]*verbV3[\s\S]*verbV4[\s\S]*verbV5/)
  assert.match(sharedVocabularyEditor, /maxlength="50000"/)
  assert.match(sharedVocabularyEditor, /function normalizeSyllabication\(value\)[\s\S]*replace\(\/\\p\{Z\}\+\/gu, " "\)[\s\S]*input\.value = normalizeSyllabication\(input\.value\)/)
  assert.match(sharedVocabularyEditor, /function canonicalizeSyllabication\(value\)[\s\S]*syllabicationVowels/)
  assert.match(adminPortal, /id="newsReviewVocabularySyllabication"[^>]*data-vocabulary-field="syllabication"/)
  assert.match(sharedPortalTheme, /body\.admin-portal-page \.news-vocabulary-row \{[\s\S]*display: grid/)
  assert.match(sharedPortalTheme, /data-vocabulary-lookup="MW"|news-vocabulary-lookup\[data-vocabulary-lookup="MW"\]/)
  assert.match(sharedPortalTheme, /#newsWeekSetModal \.portal-modal-dialog[\s\S]*min\(1080px/)
  assert.match(sharedPortalTheme, /#newsReviewViewerModal \.queue-modal-card[\s\S]*min\(1180px/)
  assert.match(routes, /submitLibraryContribution\(null, normalizeText\(session\?\.username\), payload\)/)
})

test("admin Library Definitions uses the complete shared header", () => {
  assert.match(definitions, /<svg-icon name="theme-moon"[^>]*id="adminThemeToggleIcon"/)
  assert.match(definitions, /class="text-zoom-controls" role="toolbar" aria-label="Global text size controls"/)
  assert.match(definitions, /id="adminTextZoomDownBtn"/)
  assert.match(definitions, /id="adminTextZoomUpBtn"/)
  assert.match(definitions, /id="adminTextZoomResetBtn"/)
  assert.match(definitionsScript, /themeIcon\?\.setAttribute\("name", dark \? "theme-sun" : "theme-moon"\)/)
  assert.match(definitionsScript, /adminTextZoomDownBtn/)
  assert.match(definitionsScript, /adminTextZoomUpBtn/)
  assert.match(definitionsScript, /adminTextZoomResetBtn/)
})

test("admin Library editor uses the shared New Words row renderer", () => {
  assert.match(portalScript, /vocabularyEsl\?\.editorRowHtml\(rowUid/)
  assert.match(sharedVocabularyEditor, /function editorRowHtml\(rowUid/)
  for (const token of ["news-vocabulary-row", "news-vocabulary-lookups", "vocabularyDefinition-", "includeMwFill", "includeTransitivityTools", "includeOriginAnalysis", "vocabulary-source-actions", "portal-button-amber-info", "data-vocabulary-origin-analysis", "data-vocabulary-field"]) assert.match(sharedVocabularyEditor, new RegExp(token))
  assert.match(sharedVocabularyEditor, /data-vocabulary-lookup="\$\{key\}"/)
  assert.match(sharedVocabularyEditor, /const sourceMessages = `<div class="vocabulary-source-messages">[\s\S]*?data-vocabulary-dictionary-builder-message/)
  assert.match(sharedVocabularyEditor, /const sourceActions = [\s\S]*?\? `\$\{sourceMessages\}<div class="vocabulary-source-actions">\$\{dictionaryBuilder\}\$\{mwFill\}\$\{merriamWebsterFill\}\$\{britannicaFill\}/)
  assert.match(sharedVocabularyEditor, /data-vocabulary-dictionary-builder/)
  assert.match(sharedVocabularyEditor, /data-vocabulary-dictionary-builder title="Build one availability-aware, source-attributed Dictionary preview before applying selected data\." aria-label="Open Dictionary Builder definition preview">Definition<\/button>/)
  assert.match(sharedVocabularyEditor, /\["LD", "OA", "OB", "BR", "MW", "AP", "ET", "WK", "CA", "TH", "WH", "GT"\]/)
  assert.doesNotMatch(sharedVocabularyEditor, /data-dictionary-builder-source-matrix/)
  assert.doesNotMatch(admin, /lookupButtons: \[\]/)
  assert.match(sharedVocabularyEditor, /Britannica Dictionary/)
  assert.match(routes, /ADMIN_LIBRARY_ORIGIN_ANALYSIS_PATH_RE/)
  assert.match(libraryReviewWorkbench, /Origin review is ready\. No entry fields were changed\./)
  assert.match(sharedPortalTheme, /body\.admin-portal-page \.vocabulary-source-actions\s*\{[\s\S]*display:\s*flex[\s\S]*gap:\s*var\(--portal-button-gap\)/)
  assert.match(sharedPortalTheme, /body\.admin-portal-page \.vocabulary-transitivity-check\s*\{[\s\S]*display:\s*flex[\s\S]*gap:\s*var\(--portal-button-gap\)/)
  assert.match(sharedVocabularyEditor, /data-vocabulary-transitivity-check[\s\S]*data-vocabulary-transitivity-autofill[\s\S]*data-vocabulary-transitivity-message/)
  for (const [label, radius] of [["LD", "var\\(--radius-2\\) 0 0 0"], ["OB", "0 var\\(--radius-2\\) 0 0"], ["TH", "0 0 0 var\\(--radius-2\\)"], ["GT", "0 0 var\\(--radius-2\\) 0"]]) {
    assert.match(sharedPortalTheme, new RegExp(`data-vocabulary-lookup="${label}"\\]\\s*\\{[\\s\\S]*?border-radius:\\s*${radius}`))
  }
})

test("every shared vocabulary editor preserves typed stress case until save", () => {
  const listeners = []
  const context = { window: {}, document: { addEventListener: (type, handler) => listeners.push([type, handler]) } }
  vm.runInNewContext(sharedVocabularyEditor, context)
  const input = {
    value: "de-VO-ted",
    matches(selector) {
      return selector === '[data-vocabulary-field="syllabication"]'
    },
  }
  listeners.find(([type]) => type === "input")[1]({ target: input })
  assert.equal(input.value, "de-VO-ted")
  assert.equal(context.window.SIS_VOCABULARY_ESL.normalizeSyllabication("com-MEND-ed"), "com-MEND-ed")
  assert.equal(context.window.SIS_VOCABULARY_ESL.normalizeSyllabication("con-GRÉS-sion-al"), "con-GRÉS-sion-al")
  assert.equal(context.window.SIS_VOCABULARY_ESL.canonicalizeSyllabication("com-MEND-ed"), "com-ménd-ed")
  assert.equal(context.window.SIS_VOCABULARY_ESL.canonicalizeSyllabication("con-GRÉS-sion-al"), "con-GRÉS-sion-al")
  assert.match(adminPortal, /newsReviewVocabularySyllabication[\s\S]*data-vocabulary-field="syllabication"/)
})

test("noun subtype guards keep the shared editor matrix valid", () => {
  const dom = new JSDOM("<!doctype html><body></body>")
  const context = { window: dom.window, document: dom.window.document, console }
  vm.runInNewContext(sharedVocabularyEditor, context)
  const row = dom.window.document.createElement("div")
  row.innerHTML = context.window.SIS_VOCABULARY_ESL.editorRowHtml("noun-guard")
  dom.window.document.body.append(row.firstElementChild)
  const editor = dom.window.document.body.firstElementChild
  const field = (name) => editor.querySelector(`[data-vocabulary-esl-field="${name}"]`)
  const set = (name, value) => {
    const input = field(name)
    input.value = value
    context.window.SIS_VOCABULARY_ESL.sync(editor)
  }
  const optionFor = (name, value) => [...field(name).options].find((option) => option.value === value)

  editor.querySelector('[data-vocabulary-field="partOfSpeech"]').value = "noun"
  context.window.SIS_VOCABULARY_ESL.sync(editor)
  set("countability", "uncountable")
  assert.equal(field("grammaticalNumber").value, "singular")
  assert.equal(optionFor("grammaticalNumber", "plural").disabled, true)
  assert.equal(optionFor("grammaticalNumber", "singular_and_plural").disabled, true)
  assert.equal(optionFor("primaryClassification", "proper").disabled, true)
  assert.equal(optionFor("primaryClassification", "collective").disabled, true)

  set("countability", "countable")
  set("physicalQuality", "abstract")
  assert.equal(optionFor("primaryClassification", "proper").disabled, true)
  assert.equal(optionFor("primaryClassification", "collective").disabled, true)
  assert.equal(optionFor("primaryClassification", "compound").disabled, false)

  set("physicalQuality", "material")
  assert.equal(field("materialUsage").value, "mass")
  assert.equal(field("countability").value, "uncountable")
  assert.equal(optionFor("grammaticalNumber", "plural").disabled, true)
  assert.equal(optionFor("primaryClassification", "compound").disabled, true)
  set("materialUsage", "variety")
  assert.equal(field("countability").value, "countable")
  assert.equal(field("grammaticalNumber").value, "plural")

  set("physicalQuality", "concrete")
  set("primaryClassification", "proper")
  assert.equal(field("grammaticalNumber").value, "singular")
  assert.equal(optionFor("grammaticalNumber", "plural").disabled, true)
  field("properNounVariantShift").checked = true
  context.window.SIS_VOCABULARY_ESL.sync(editor)
  assert.equal(optionFor("grammaticalNumber", "plural").disabled, false)

  set("countability", "countable_and_uncountable")
  assert.equal(field("grammaticalNumber").value, "singular_and_plural")
  assert.equal(optionFor("grammaticalNumber", "singular").disabled, false)
  assert.equal(optionFor("grammaticalNumber", "plural").disabled, true)
  assert.ok(field("dualCountabilityUsage"))
})

test("all Library and vocabulary editor surfaces resync every shared POS field", () => {
  const currentSelector = /\[data-vocabulary-field="partOfSpeech"\], \[data-vocabulary-esl-field\]/g
  for (const [name, source] of [["student Library", student], ["admin Library", admin], ["student portal script", portalScript]]) {
    assert.ok((source.match(currentSelector) || []).length > 0, `${name} must resync shared fields`)
    assert.doesNotMatch(source, /\[data-vocabulary-field="partOfSpeech"\], \[data-vocabulary-esl-field="grammarFamily"\], \[data-vocabulary-esl-field="grammarSubtype"\]/, `${name} retains the narrow POS-only resync guard`)
  }
  assert.doesNotMatch(studentPortal, /\[data-vocabulary-field="partOfSpeech"\], \[data-vocabulary-esl-field="grammarFamily"\], \[data-vocabulary-esl-field="grammarSubtype"\]/)
  for (const field of ["physicalQuality", "grammaticalNumber", "primaryClassification", "materialUsage", "properNounVariantShift", "dualCountabilityUsage"]) {
    assert.match(admin, new RegExp(`\\"${field}\\"`), `admin Library must keep ${field} in the shared editor`)
  }
})

test("admin Library edits remain approved and use the approved-edit revision action", () => {
  assert.match(libraryCorpus, /data: \{ \.\.\.data, reviewStatus: "approved", lastEditedByName: clamp\(actor\.name\) \}/)
  assert.match(libraryCorpus, /writeRevision\(tx, updated, "approved_edit", actor\.name, actor\.role \|\| "admin"\)/)
  assert.match(libraryCorpus, /export function selectReviewQueueRepresentatives\(rows = \[\]\)/)
  assert.match(libraryCorpus, /const queueContributions = selectReviewQueueRepresentatives\(contributions\)/)
})

test("Library saves canonicalize stress after the editor preserves typed capitalization", () => {
  assert.match(libraryCorpus, /import \{ normalizeVocabularySyllabication, vocabularyEnglishCapitalizationError \} from "\.\/vocabulary-syllabication\.mjs"/)
  assert.match(libraryCorpus, /syllabication: normalizeVocabularySyllabication\(value\.syllabication\)/)
  assert.match(libraryCorpus, /syllabication: normalizeVocabularySyllabication\(rawEntry\.syllabication\)/)
  assert.match(admin, /field === "syllabication"\) value = window\.SIS_VOCABULARY_ESL\.canonicalizeSyllabication\(value\)/)
  assert.match(student, /readEditorEntry\(row, entry\)/)
  assert.match(sharedVocabularyEditor, /syllabication: canonicalizeSyllabication\(fieldValue\("syllabication"\)\?\.value \|\| ""\)/)
})

test("all standalone admin navigation shells expose the Library child menu", () => {
  for (const [name, html] of standaloneAdminNavs) {
    assert.match(html, /data-menu-group="admin"[\s\S]*data-menu-group="library"/i, name)
    assert.match(html, /data-library-nav="library"[\s\S]*data-library-nav="manage"[\s\S]*data-library-nav="engagement"/i, name)
    assert.match(html, /href="\/admin\/library"/i, name)
    assert.match(html, /href="\/admin\/library\/manage"/i, name)
    assert.match(html, /href="\/admin\/library\/engagement"/i, name)
  }
})

test("flattened vocabulary preserves New Words geometry and formats safe definition markup", () => {
  const context = { window: {}, document: {} }
  vm.runInNewContext(sharedVocabularyEditor, context)
  const html = context.window.SIS_VOCABULARY_ESL.flatEntryHtml({
    english: "sample",
    partOfSpeech: "noun",
    syllabication: "sam-ple",
    vietnamese: "mẫu",
    definition: "A **bold** line\n\n1. *First*\n2. [u]Second[/u]\n- Third",
  })
  assert.match(html, /class="[^"]*\bnew-word-entry\b/)
  assert.match(html, /class="new-word-entry-definition"/)
  assert.match(html, /A <strong>bold<\/strong> line/)
  assert.match(html, /<ol><li><em>First<\/em><\/li><li><u>Second<\/u><\/li><\/ol>/)
  assert.match(html, /<ul><li>Third<\/li><\/ul>/)
  const flattenedChairDefinitions = context.window.SIS_VOCABULARY_ESL.definitionHtml(
    "1. to preside as chairperson of chaired a commission\n\n1. to install in office\n\n1. to carry on the shoulders in acclaim We chaired you through the market-place …",
  )
  assert.equal((flattenedChairDefinitions.match(/<ol>/gu) || []).length, 1)
  assert.equal((flattenedChairDefinitions.match(/<li>/gu) || []).length, 3)
  assert.match(flattenedChairDefinitions, /to preside as chairperson[\s\S]*to install in office[\s\S]*to carry on the shoulders/)
  assert.equal(context.window.SIS_VOCABULARY_ESL.definitionHtml("A\nB"), "<p>A<br>B</p>")
  const synonymsAntonymsTable = context.window.SIS_VOCABULARY_ESL.definitionHtml("| **Synonyms** | **Antonyms** |\n|--------------|--------------|\n| praise | criticize |\n| applaud |  |")
  assert.equal(synonymsAntonymsTable, '<div class="definition-markdown-table-wrap"><table class="definition-markdown-table"><thead><tr><th><strong>Synonyms</strong></th><th><strong>Antonyms</strong></th></tr></thead><tbody><tr><td>praise</td><td>criticize</td></tr><tr><td>applaud</td><td></td></tr></tbody></table></div>')
  assert.equal(
    context.window.SIS_VOCABULARY_ESL.definitionHtml("**First known use:** 12th century\n\n**Etymology:** mid-12c., a wondrous work of God"),
    "<p><strong>First known use</strong><br>12th century</p><p><strong>Etymology</strong><br>mid-12c., a wondrous work of God</p>",
  )
  assert.equal(context.window.SIS_VOCABULARY_ESL.normalizeDefinitionText("A\r\n\r\nB\n"), "A\n\nB\n")
  assert.equal(context.window.SIS_VOCABULARY_ESL.definitionHtml("A\n\n- B"), "<p>A</p><ul><li>B</li></ul>")
  const nestedExampleHtml = context.window.SIS_VOCABULARY_ESL.definitionHtml(
    "1. a group or set of 10\n    - It isn't to be done in a day of course, nor yet in a century, nor in a decade of centuries.\n\nsuch as",
  )
  assert.match(nestedExampleHtml, /<ol><li>a group or set of 10<ul><li>It isn&#39;t to be done in a day of course, nor yet in a century, nor in a decade of centuries\.<\/li><\/ul><\/li><\/ol><p>such as<\/p>/)
  const ldoceDictionaryHtml = context.window.SIS_VOCABULARY_ESL.definitionHtml(
    "1. *transitive*, CHAIR — to preside over a meeting\n    - She chaired the meeting.\n2. *intransitive*, CHAIR — to act as chairperson\n    - He agreed to chair.",
  )
  assert.match(ldoceDictionaryHtml, /<ol><li><em>transitive<\/em>, CHAIR — to preside over a meeting<ul><li>She chaired the meeting\.<\/li><\/ul><\/li><li><em>intransitive<\/em>, CHAIR — to act as chairperson<ul><li>He agreed to chair\.<\/li><\/ul><\/li><\/ol>/)
  const preferredHtml = context.window.SIS_VOCABULARY_ESL.definitionHtml(definitionSpacingSample)
  assert.match(preferredHtml, /<ol><li>to resound with echoes<\/li><li>to produce an echo<ol type="a">/)
  assert.match(preferredHtml, /<ol type="a"><li>repeat, imitate<ul><li>children echoing their teacher&#39;s words<\/li><\/ul>/)
  assert.match(preferredHtml, /<strong>Etymology<\/strong>/)
  assert.match(context.window.SIS_VOCABULARY_ESL.flatEntryHtml({ partOfSpeech: "noun", definition: "**Etymology**\nFrom Latin\n\n**Works Cited**\n- Source" }), /new-word-entry-etymology/)
  assert.match(
    context.window.SIS_VOCABULARY_ESL.flatEntryHtml({ partOfSpeech: "noun", etymologyType: "borrowed", etymology: "1530s, from Latin exhaurire" }),
    /<section class="new-word-entry-etymology"><strong>Etymology<\/strong><div><p><em>borrowed\/loanword<\/em>; 1530s, from Latin exhaurire<\/p><\/div><\/section>/,
  )
  assert.match(
    context.window.SIS_VOCABULARY_ESL.flatEntryHtml({ partOfSpeech: "noun", definition: "**First known use:** 12th century\n\n**Etymology:** From Latin" }),
    /<section class="new-word-entry-first-use"><strong>First known use<\/strong><div><p>12th century<\/p><\/div><\/section><section class="new-word-entry-etymology"><strong>Etymology<\/strong><div><p>From Latin<\/p><\/div><\/section>/,
  )
  const preferredEntryHtml = context.window.SIS_VOCABULARY_ESL.flatEntryHtml({
    partOfSpeech: "verb",
    definition: definitionSpacingSample,
    originReferences: [{ citation: "Online Etymology Dictionary. (n.d.). *echo*. Retrieved 2026-08-15, from https://www.etymonline.com/search?q=echo" }],
  })
  assert.equal((preferredEntryHtml.match(/<li>Online Etymology Dictionary/g) || []).length, 1)
  assert.match(sharedVocabularyEditor, /Ctrl\+B bold.*Ctrl\+I italic.*Ctrl\+U underline/)
  assert.match(definitionDocumentation, /Press Shift\+Enter to make a plain line break without automatic list continuation/)
  assert.match(definitionDocumentation, /type `- ` .*unordered list/)
  assert.match(sharedPortalTheme, /\.new-word-entry-definition \{[\s\S]*display: flow-root;[\s\S]*white-space: normal;/)
  assert.match(sharedPortalTheme, /\.new-word-entry-definition li \{[\s\S]*margin-block: var\(--portal-definition-item-gap\);/)
  assert.match(sharedPortalTheme, /\.new-word-entry-definition > section > strong \{[\s\S]*margin-block-end: var\(--portal-definition-item-gap\);/)
  assert.doesNotMatch(html, /<script|onerror=|javascript:/i)
})

test("definition keyboard rules preserve new lines and support ordered and unordered lists", () => {
  const dom = new JSDOM("<!doctype html><body></body>")
  const context = {
    window: dom.window,
    document: dom.window.document,
    console,
    Event: dom.window.Event,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  }
  vm.runInNewContext(sharedVocabularyEditor, context)
  const textarea = dom.window.document.createElement("textarea")
  textarea.setAttribute("data-vocabulary-field", "definition")
  dom.window.document.body.append(textarea)

  textarea.value = "1. first"
  textarea.selectionStart = textarea.selectionEnd = textarea.value.length
  const orderedEnter = new dom.window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" })
  textarea.dispatchEvent(orderedEnter)
  assert.equal(orderedEnter.defaultPrevented, true)
  assert.equal(textarea.value, "1. first\n2. ")

  textarea.value = "inline text"
  textarea.selectionStart = textarea.selectionEnd = textarea.value.length
  const shiftEnter = new dom.window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", shiftKey: true })
  textarea.dispatchEvent(shiftEnter)
  assert.equal(shiftEnter.defaultPrevented, false)
  assert.match(context.window.SIS_VOCABULARY_ESL.definitionHtml("inline text\n- list item"), /<p>inline text<\/p><ul><li>list item<\/li><\/ul>/)
  assert.equal(context.window.SIS_VOCABULARY_ESL.normalizeDefinitionText("inline\r\n\nlist\n"), "inline\n\nlist\n")
})

test("definition paste preserves clipboard emphasis, lists, indentation, and paragraph breaks", () => {
  const dom = new JSDOM("<!doctype html><body></body>")
  const context = {
    window: dom.window,
    document: dom.window.document,
    console,
    Event: dom.window.Event,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  }
  vm.runInNewContext(sharedVocabularyEditor, context)
  const textarea = dom.window.document.createElement("textarea")
  textarea.setAttribute("data-vocabulary-field", "definition")
  dom.window.document.body.append(textarea)
  textarea.value = "Existing\n"
  textarea.selectionStart = textarea.selectionEnd = textarea.value.length
  const paste = new dom.window.Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(paste, "clipboardData", {
    value: {
      getData(type) {
        if (type === "text/html") return "<p><strong>bold</strong> and <em>italic</em></p><p>next</p><ul><li>one<ul><li><u>nested</u></li></ul></li></ul><ol><li>first</li><li>second</li></ol>"
        if (type === "text/plain") return "bold and italic\nnext\none\n  nested\nfirst\nsecond"
        return ""
      },
    },
  })
  textarea.dispatchEvent(paste)
  assert.equal(paste.defaultPrevented, true)
  assert.equal(textarea.value, "Existing\n**bold** and *italic*\n\nnext\n\n- one\n    - [u]nested[/u]\n\n1. first\n2. second")
  assert.equal(
    context.window.SIS_VOCABULARY_ESL.htmlToDefinitionText('<p><span style="font-weight:700">styled</span></p><ol type="a"><li>alpha</li><li>beta</li></ol>'),
    "**styled**\n\na. alpha\nb. beta",
  )
  assert.equal(context.window.SIS_VOCABULARY_ESL.htmlToDefinitionText("", "A\r\n\r\nB\n"), "A\n\nB\n")
})

test("unheaded Etymonline prose after Stems is restored to Etymology after First known use and before Stems", () => {
  const context = { window: {}, document: {} }
  vm.runInNewContext(sharedVocabularyEditor, context)
  const html = context.window.SIS_VOCABULARY_ESL.flatEntryHtml({
    english: "wildfire",
    partOfSpeech: "noun",
    definition: "**First known use:** 12th century\n\n**Stems:**\n- wildfire\n- wildfires\n\nlate Old English *wilde fyr* \"destructive fire, raging conflagration\" (perhaps originally one caused by lightning); also \"erysipelas, spreading skin disease;\" see wild (adj.) + fire (n.).",
  })
  const order = ["new-word-entry-etymology", "new-word-entry-first-use", "new-word-entry-stems"].map((className) => html.indexOf(`class="${className}"`))
  assert.ok(order.every((index) => index >= 0), "all restored definition sections must render")
  assert.ok(order[1] < order[0] && order[0] < order[2], "First known use must precede Etymology, then Stems")
  assert.match(html, /<section class="new-word-entry-etymology">[\s\S]*late Old English <em>wilde fyr<\/em>[\s\S]*<\/section>/)
  assert.doesNotMatch(html, /new-word-entry-stems[\s\S]*late Old English \*wilde fyr\*/)
  const inserted = context.window.SIS_VOCABULARY_ESL.insertEtymologyDeterministically(
    "**First known use:** 12th century\n\n**Stems:**\n- wildfire\n- wildfires\n\nlate Old English *wilde fyr*",
    "from Old French via Latin",
  )
  assert.ok(inserted.indexOf("**First known use**") < inserted.indexOf("**Etymology**"))
  assert.ok(inserted.indexOf("**Etymology**") < inserted.indexOf("**Stems:**"))
  assert.doesNotMatch(inserted, /\*\*(?:First known use|Etymology):\*\*/)
  const insertedBeforeWorksCited = context.window.SIS_VOCABULARY_ESL.insertEtymologyDeterministically(
    "A definition paragraph.\n\n**Works Cited:**\n- Source",
    "from Middle English",
  )
  assert.match(insertedBeforeWorksCited, /\*\*Etymology\*\*\nfrom Middle English/)
  assert.ok(insertedBeforeWorksCited.indexOf("**Etymology**") < insertedBeforeWorksCited.indexOf("**Works Cited:**"))
  const insertedIntoBlankDefinition = context.window.SIS_VOCABULARY_ESL.insertEtymologyDeterministically(
    "",
    "from Middle English",
  )
  assert.equal(insertedIntoBlankDefinition, "**Etymology**\nfrom Middle English")
  const insertedIntoPlainDefinition = context.window.SIS_VOCABULARY_ESL.insertEtymologyDeterministically(
    "A definition paragraph.",
    "from Middle English",
  )
  assert.match(insertedIntoPlainDefinition, /A definition paragraph\.\n\n\*\*Etymology\*\*\nfrom Middle English/)
  const existingUnheadedEtymology = context.window.SIS_VOCABULARY_ESL.insertEtymologyDeterministically(
    "A definition from Middle English",
    "from Middle English",
  )
  assert.equal((existingUnheadedEtymology.match(/\*\*Etymology\*\*/gu) || []).length, 1)
  const verbHtml = context.window.SIS_VOCABULARY_ESL.flatEntryHtml({
    english: "threaten",
    partOfSpeech: "verb",
    definition: "**First known use:** 13th century\n\n**Etymology:** from Old French\n\n**Stems:**\n- threaten\n\n**Works Cited:**\n- Source",
    verbInfinitive: "to threaten",
    verbV1: "threaten",
    verbV2: "threatened",
    verbV3: "threatened",
    verbV4: "threatening",
    verbV5: "threatens",
  })
  const verbOrder = ["new-word-entry-first-use", "new-word-entry-etymology", "vocabulary-verb-forms-display", "new-word-entry-stems", "vocabulary-origin-references"].map((className) => verbHtml.indexOf(`class="${className}"`))
  assert.ok(verbOrder.every((index) => index >= 0), "verb entry sections must render")
  assert.ok(verbOrder.every((index, position) => position === 0 || verbOrder[position - 1] < index), "verb forms must remain between Etymology and Stems")
})

test("flattened vocabulary keeps the established header format for every POS", () => {
  const context = { window: {}, document: {} }
  vm.runInNewContext(sharedVocabularyEditor, context)
  const cases = [
    [{ english: "threaten", partOfSpeech: "verb", syllabication: "thréat-en", vietnamese: "hăm dọa", displayVerbForm: "v1", verbRegularity: "regular", grammarFamily: "action", verbTransitivity: "ambitransitive" }, "threaten.*?thréat-en.*?verb.*?V1.*?\\|.*?vi: hăm dọa.*?\\|.*?regular, action, ambitransitive"],
    [{ english: "decade", partOfSpeech: "noun", syllabication: "déc-ade", vietnamese: "thập kỷ", countability: "countable", physicalQuality: "abstract", grammaticalNumber: "singular", primaryClassification: "common" }, "decade.*?déc-ade.*?noun.*?countable.*?\\|.*?vi: thập kỷ.*?\\|.*?abstract, singular, common"],
    [{ english: "language", partOfSpeech: "noun", syllabication: "lán-guage", vietnamese: "ngôn ngữ", countability: "countable", nounNumber: "singular", nounType: "common" }, "language.*?lán-guage.*?noun.*?countable.*?\\|.*?vi: ngôn ngữ.*?\\|.*?singular, common"],
    [{ english: "funny", partOfSpeech: "adjective", syllabication: "fún-ny", vietnamese: "buồn cười" }, "funny.*?fún-ny.*?adjective.*?\\|.*?vi: buồn cười.*?\\|"],
    [{ english: "however", partOfSpeech: "conjunction", syllabication: "how-év-er", vietnamese: "nhung", grammarSubtype: "subordinate" }, "however.*?how-év-er.*?conjunction.*?subordinate.*?\\|.*?vi: nhung.*?\\|"],
    [{ english: "quickly", partOfSpeech: "adverb", syllabication: "quick-ly", vietnamese: "nhanh", grammarSubtype: "manner", grammarNumber: "singular" }, "quickly.*?quick-ly.*?adverb.*?manner.*?\\|.*?vi: nhanh.*?\\|.*?singular"],
    [{ english: "under", partOfSpeech: "preposition", syllabication: "un-der", vietnamese: "dưới", grammarSubtype: "simple" }, "under.*?un-der.*?preposition.*?simple.*?\\|.*?vi: dưới.*?\\|"],
    [{ english: "the", partOfSpeech: "determiner", syllabication: "the", vietnamese: "cái", grammarFamily: "articles", grammarNumber: "singular" }, "the.*?the.*?determiner.*?articles.*?\\|.*?vi: cái.*?\\|.*?singular"],
    [{ english: "she", partOfSpeech: "pronoun", syllabication: "she", vietnamese: "cô ấy", grammarFamily: "personal", grammarSubtype: "subject", grammarNumber: "singular" }, "she.*?she.*?pronoun.*?personal.*?\\|.*?vi: cô ấy.*?\\|.*?subject, singular"],
    [{ english: "wow", partOfSpeech: "interjection", syllabication: "wow", vietnamese: "ồ", grammarSubtype: "emphatic" }, "wow.*?wow.*?interjection.*?emphatic.*?\\|.*?vi: ồ.*?\\|"],
    [{ english: "three", partOfSpeech: "numeral", syllabication: "three", vietnamese: "ba" }, "three.*?three.*?numeral.*?\\|.*?vi: ba.*?\\|"],
    [{ english: "break down", partOfSpeech: "phrase", syllabication: "break-down", vietnamese: "suy sụp", grammarFamily: "verbal phrases", grammarSubtype: "phrasal" }, "break down.*?break-down.*?phrase.*?verbal phrases.*?\\|.*?vi: suy sụp.*?\\|.*?phrasal"],
    [{ english: "break a leg", partOfSpeech: "idiom", syllabication: "break-a-leg", vietnamese: "chúc may mắn", grammarSubtype: "pure idioms" }, "break a leg.*?break-a-leg.*?idiom.*?pure idioms.*?\\|.*?vi: chúc may mắn.*?\\|"],
    [{ english: "because", partOfSpeech: "clause", syllabication: "be-cause", vietnamese: "bởi vì", grammarSubtype: "dependent" }, "because.*?be-cause.*?clause.*?dependent.*?\\|.*?vi: bởi vì.*?\\|"],
    [{ english: "London", partOfSpeech: "proper noun", syllabication: "Lon-don", vietnamese: "Luân Đôn", countability: "countable", physicalQuality: "concrete", grammaticalNumber: "singular", primaryClassification: "proper" }, "London.*?Lon-don.*?proper noun.*?countable.*?\\|.*?vi: Luân Đôn.*?\\|.*?concrete, singular, proper"],
  ]
  for (const [entry, pattern] of cases) {
    const html = context.window.SIS_VOCABULARY_ESL.flatEntryHtml(entry)
    assert.match(html, new RegExp(pattern, "s"), entry.partOfSpeech)
    assert.match(context.window.SIS_VOCABULARY_ESL.flatEntrySummaryText(entry), new RegExp(pattern, "s"), `${entry.partOfSpeech} summary`)
    assert.equal((html.match(/class="vocabulary-flat-entry-separator"/g) || []).length, 2, entry.partOfSpeech)
  }
})

test("flattened headers ignore object metadata and keep noun traits together", () => {
  const context = { window: {}, document: {} }
  vm.runInNewContext(sharedVocabularyEditor, context)
  const html = context.window.SIS_VOCABULARY_ESL.flatEntryHtml({
    english: "Accountable.",
    partOfSpeech: "noun",
    syllabication: "ac-COUNT-a-ble",
    vietnamese: "chịu trách nhiệm",
    primaryClassification: {},
    physicalQuality: "abstract",
    grammaticalNumber: "singular",
    countability: "countable",
  })
  assert.doesNotMatch(html, /\[object Object\]/)
  assert.match(html, /abstract, singular/)
  assert.match(sharedPortalTheme, /\.new-word-entry-pos-details \{[\s\S]*white-space: nowrap;/)
  assert.match(sharedPortalTheme, /@media \(min-width: 901px\)[\s\S]*\.new-word-entry-head \{[\s\S]*flex-wrap: nowrap;/)
})
