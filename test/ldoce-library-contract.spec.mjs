import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
const migration = fs.readFileSync(new URL("../prisma/migrations/20260824070000_add_library_dictionary_media/migration.sql", import.meta.url), "utf8")
const routes = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
const corpus = fs.readFileSync(new URL("../src/modules/admin/library-corpus.mjs", import.meta.url), "utf8")
const editor = fs.readFileSync(new URL("../web-asset/shared/vocabulary-esl-editor.js", import.meta.url), "utf8")
const adminLibrary = fs.readFileSync(new URL("../web-asset/admin/library-admin.html", import.meta.url), "utf8")
const workbench = fs.readFileSync(new URL("../web-asset/admin/library-review-workbench.js", import.meta.url), "utf8")
const sharedTheme = fs.readFileSync(new URL("../web-asset/shared/portal-theme.css", import.meta.url), "utf8")
const speakerUk = fs.readFileSync(new URL("../web-asset/icons/svg/speaker-blue-uk.svg", import.meta.url), "utf8")
const speakerUs = fs.readFileSync(new URL("../web-asset/icons/svg/speaker-red-usa.svg", import.meta.url), "utf8")

test("dictionary scraper integrations preserve protected media and audit contracts", () => {
  assert.match(schema, /model LibraryMediaAsset[\s\S]*?@@schema\("library"\)/)
  for (const field of ["dictionaryProvider", "dictionarySourceUrl", "dictionaryMetadata", "mediaAssets"]) assert.match(schema, new RegExp(field))
  for (const token of ["LibraryMediaAsset_entryId_provider_dialect_key", "sha256", "storagePath", "ON DELETE RESTRICT"]) assert.match(migration, new RegExp(token))
  for (const token of ["ldoce-preview", "ldoce-apply", "oxford-preview", "oxford-apply", "britannica-preview", "britannica-apply", "merriam-webster-preview", "merriam-webster-apply", "previewMerriamWebsterDictionaryEntryWithApiFallback", "ADMIN_LIBRARY_MEDIA_PATH_RE", "normalizeRoleName(session?.role) !== \"admin\"", "Accept-Ranges", "Content-Range"]) assert.match(routes, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
  for (const token of ["previewLdoceLibraryEntry", "applyLdoceLibraryEntry", "previewOxfordLibraryEntry", "applyOxfordLibraryEntry", "previewBritannicaLibraryEntry", "applyBritannicaLibraryEntry", "previewMerriamWebsterDictionaryEntry", "previewMerriamWebsterDictionaryEntryWithApiFallback", "fetchMerriamWebsterBrowserPage", "applyMerriamWebsterDictionaryLibraryEntry", "mediaAssets", "ldoce_import", "oxford_import", "britannica_import", "merriam_webster_import", "fill_missing", "replace_selected", "replace_all", "LDOCE_APPLY_FIELDS"]) assert.match(corpus, new RegExp(token))
  assert.match(editor, /includeLdoce/)
  assert.match(editor, /includeOxford/)
  assert.match(editor, /includeBritannica/)
  assert.match(editor, /includeMerriamWebster/)
  assert.match(adminLibrary, /data-library-media-assets=/)
  assert.match(adminLibrary, /includeDictionaryBuilder: true/)
  assert.doesNotMatch(adminLibrary, /includeLdoce: true|includeOxford: true|includeBritannica: true|includeMerriamWebster: true/)
  for (const token of ["dictionary-builder/preview", "dictionary-builder/previews", "applyDictionaryBuilderSnapshot", "previewDictionaryBuilder", "readDictionaryBuilderSnapshot"]) assert.match(routes, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
  assert.match(routes, /sourceId === "new-canonical" \? null : await getLibraryEntry\(sourceId\)/)
  assert.match(routes, /entryId === "new-canonical".*statusCode = 409/)
  for (const token of ["DictionaryProviderSuitabilityMetric", "attemptCount", "availableCount", "selectedApplyCount"]) assert.match(schema, new RegExp(token))
  for (const token of ["data-vocabulary-dictionary-builder", "safe-rule"]) assert.match(editor, new RegExp(token))
  assert.doesNotMatch(editor, /data-dictionary-builder-source-matrix/)
  for (const token of ["libraryLdocePreviewDialog", "libraryOxfordPreviewDialog", "libraryBritannicaPreviewDialog", "libraryMerriamWebsterPreviewDialog", "data-vocabulary-ldoce-preview", "data-vocabulary-oxford-preview", "data-vocabulary-britannica-preview", "data-vocabulary-merriam-webster-preview", "ldoceFormattedDefinition", "showModal", "Destructive Replace Selected", "Destructive Replace All", "Apply LDOCE", "Apply Oxford", "preload = \"none\"", "localLibraryMedia", "protected local Library media", "ldoce-apply", "oxford-apply", "britannica-apply", "merriam-webster-apply", "dictionaryBuilderSourceMatrix", "library-dictionary-builder-header", "Dictionary Builder", "data-dictionary-builder-section-summary", "data-dictionary-builder-source-matrix-slot", "dictionary-builder-tab-step", "dictionary-builder-candidate-list", "is-complete", "role=\"tablist\""]) assert.match(workbench, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
  assert.match(workbench, /news-vocabulary-lookups dictionary-builder-source-matrix/)
  assert.match(workbench, /portal-button-blue-action news-vocabulary-lookup dictionary-builder-source-link/)
  assert.match(workbench, /data-vocabulary-lookup="\$\{label\}"/)
  assert.match(workbench, /datum === "vietnamese" && source\.provider !== "google_translate"/)
  assert.match(workbench, /const statusSourceIds = datum === "vietnamese"/)
  assert.match(workbench, /snapshot\.datumSourceOrder\?\.\[datum\] \|\| \[\]/)
  assert.match(workbench, /const canApply = sourceId !== "new-canonical"/)
  assert.match(workbench, /Save the canonical Library entry before applying Dictionary Builder data\./)
  assert.match(workbench, /wordhelp\.com\/syllables\/english\/\?q=/)
  assert.match(workbench, /const status = source\.datumStatus\?\.\[datum\]\?\.status/)
  assert.match(workbench, /status === "robot_blocked" \|\| \(status === "available" && source\.fields\?\.\[datum\] !== undefined\)/)
  assert.match(workbench, /const mandatory = datum === "synonymsAntonyms" \? "merriam_webster_thesaurus" : datum === "syllabication" \? "wordhelp"/)
  assert.match(workbench, /const robotBlocked = ordered\.filter\(\(source\) => source\.datumStatus\?\.\[datum\]\?\.status === "robot_blocked"\)/)
  assert.doesNotMatch(workbench, /library-definition-audio|bindLibraryDefinitionAudio/)
  assert.match(sharedTheme, /#libraryDictionaryBuilderDialog\s*\{[\s\S]*?block-size:\s*fit-content[\s\S]*?inline-size:\s*min\(1440px/)
  assert.match(sharedTheme, /#libraryDictionaryBuilderDialog\s*\{[\s\S]*?resize:\s*both/)
  assert.match(sharedTheme, /\.dictionary-builder-source-matrix\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-columns:\s*repeat\(3, 38px\)[\s\S]*?grid-template-rows:\s*repeat\(4, 38px\)/)
  assert.match(sharedTheme, /\.dictionary-builder-tab\.is-complete\s+\.dictionary-builder-tab-step[\s\S]*?portal-status-good-bg/)
  assert.match(sharedTheme, /\.dictionary-builder-candidate-list\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(sharedTheme, /\.dictionary-builder-candidate textarea\s*\{[\s\S]*?align-self:\s*start[\s\S]*?font-size:\s*1\.1rem[\s\S]*?min-block-size:\s*54px[\s\S]*?resize:\s*both[\s\S]*?vertical-align:\s*top/)
  assert.match(workbench, /Use WordHelp plus the two other BIC sources named in the queried list/)
  assert.match(workbench, /sizeDictionaryBuilderTextarea/)
  assert.match(workbench, /window\.requestAnimationFrame\(applySize\)/)
  assert.match(workbench, /data-dictionary-builder-tab-heading/)
  assert.match(workbench, /dictionary-builder-candidate-manual/)
  assert.match(workbench, /if \(candidateList\.childElementCount\) section\.append\(candidateList\)/)
  assert.match(corpus, /const manualSelection = provider === "manual"/)
  assert.match(sharedTheme, /\.library-dictionary-preview-actions select\s*\{[\s\S]*?font-size:\s*1\.1rem[\s\S]*?min-block-size:\s*52px/)
  assert.doesNotMatch(editor, /data-vocabulary-ldoce-details/)
  assert.match(routes, /sanitizeLdocePreview\(await previewLdoceLibraryEntry\(entry\)\)/)
})

test("dictionary MP3 controls keep the requested speaker icons and playback wiring", () => {
  for (const token of [
    "/web-asset/icons/svg/speaker-blue-uk.svg",
    "/web-asset/icons/svg/speaker-red-usa.svg",
    "data-library-audio-trigger",
    "data-library-preview-audio",
    "mouseenter",
    "audio.play()",
    "is-playing",
  ]) assert.match(workbench, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
  assert.match(sharedTheme, /\.library-audio-row\s*\{[\s\S]*?min-block-size:\s*48px/)
  assert.match(sharedTheme, /button\.library-audio-play:hover img,[\s\S]*?button\.library-audio-play\.is-playing img[\s\S]*?transform:\s*scale\(1\.1\)/)
  assert.match(speakerUk, /#002786/)
  assert.match(speakerUs, /#e0162b/)
})

test("empty admin vocabulary status messages do not create blank layout rows", () => {
  assert.match(sharedTheme, /body\.admin-portal-page \.vocabulary-pos-parameters p\[aria-live="polite"\]:empty\s*\{\s*display:\s*none;\s*\}/)
})
