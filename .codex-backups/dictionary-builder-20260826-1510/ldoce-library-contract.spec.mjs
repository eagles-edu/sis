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
  for (const token of ["libraryLdocePreviewDialog", "libraryOxfordPreviewDialog", "libraryBritannicaPreviewDialog", "libraryMerriamWebsterPreviewDialog", "data-vocabulary-ldoce-preview", "data-vocabulary-oxford-preview", "data-vocabulary-britannica-preview", "data-vocabulary-merriam-webster-preview", "ldoceFormattedDefinition", "showModal", "Destructive Replace Selected", "Destructive Replace All", "Apply LDOCE", "Apply Oxford", "preload = \"none\"", "localLibraryMedia", "protected local Library media", "library-definition-audio", "bindLibraryDefinitionAudio", "ldoce-apply", "oxford-apply", "britannica-apply", "merriam-webster-apply"]) assert.match(workbench, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
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
  assert.match(sharedTheme, /\.library-definition-audio-options\s*\{[\s\S]*?display:\s*flex/)
  assert.match(workbench, /definitionRow\.insertBefore\(audioGroup, textarea\)/)
  assert.match(sharedTheme, /button\.library-audio-play:hover img,[\s\S]*?button\.library-audio-play\.is-playing img[\s\S]*?transform:\s*scale\(1\.1\)/)
  assert.match(speakerUk, /#002786/)
  assert.match(speakerUs, /#e0162b/)
})
