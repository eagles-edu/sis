import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import { DICTIONARY_BUILDER_SCORING_DATUMS, DICTIONARY_BUILDER_SCORING_SOURCES, dictionaryBuilderInitialQuality } from "../src/modules/admin/dictionary-builder.mjs"
import { parseCambridgeHtml } from "../src/modules/admin/cambridge-provider.mjs"

test("Dictionary Builder scoring defines twelve independently scored sources and automatic scarcity quality", () => {
  assert.equal(DICTIONARY_BUILDER_SCORING_SOURCES.length, 12)
  assert.ok(DICTIONARY_BUILDER_SCORING_DATUMS.includes("stems"))
  assert.ok(DICTIONARY_BUILDER_SCORING_DATUMS.includes("synonymsAntonyms"))
  assert.ok(!DICTIONARY_BUILDER_SCORING_DATUMS.includes("recentExamples"))
  assert.match(fs.readFileSync("src/modules/admin/dictionary-builder.mjs", "utf8"), /source\("merriam_webster_thesaurus"[^\n]*synonymsAntonyms/u)
  assert.match(fs.readFileSync("src/modules/admin/dictionary-builder.mjs", "utf8"), /source\("merriam_webster"[^\n]*stems/u)
  assert.doesNotMatch(fs.readFileSync("src/modules/admin/dictionary-builder.mjs", "utf8"), /recentExamples/u)
  assert.equal(dictionaryBuilderInitialQuality("ldoce", "definition", 1, true), 0.75)
  assert.equal(dictionaryBuilderInitialQuality("ldoce", "definition", 2, true), 0.6)
  assert.equal(dictionaryBuilderInitialQuality("ldoce", "definition", 3, true), 0.5)
  assert.equal(dictionaryBuilderInitialQuality("google_translate", "vietnamese", 1, true), 0.9)
  assert.equal(dictionaryBuilderInitialQuality("wordhelp", "syllabication", 1, true), 0.75)
  assert.equal(dictionaryBuilderInitialQuality("etymonline", "historyOrigin", 1, true), 0.85)
  assert.equal(dictionaryBuilderInitialQuality("merriam_webster_api", "firstKnownUse", 3, true), 0.85)
  assert.equal(dictionaryBuilderInitialQuality("ldoce", "vietnamese", 0, false), 0)
})

test("Google sources cannot score for Syllable / Stress", () => {
  const source = fs.readFileSync("src/modules/admin/dictionary-builder.mjs", "utf8")
  assert.doesNotMatch(source, /google_translate[^\n]*syllabication/u)
  assert.doesNotMatch(source, /google_definitions/u)
})

test("Definitions page is a standalone Library administration surface with protected matrix and XLSX routes", () => {
  const routes = fs.readFileSync("server/student-admin-routes.mjs", "utf8")
  const page = fs.readFileSync("web-asset/admin/library-definitions.html", "utf8")
  const client = fs.readFileSync("web-asset/admin/library-definitions.js", "utf8")
  assert.match(routes, /ADMIN_LIBRARY_DEFINITIONS_PAGE_PATH/)
  assert.match(routes, /ADMIN_LIBRARY_DEFINITIONS_MATRIX_PATH/)
  assert.match(routes, /ADMIN_LIBRARY_DEFINITIONS_EXPORT_PATH/)
  assert.match(routes, /dictionary-builder\/previews\/\(\[\^\/\]\+\)\/retry/)
  assert.match(routes, /assertCanManageSettings\(rolePolicy\)/)
  assert.match(page, /library-definitions\.min\.js/)
  assert.match(page, /Current suitability matrix/)
  assert.match(client, /matrix\.xlsx/)
})

test("Builder renders every datum with a manual path and POS dropdowns", () => {
  const workbench = fs.readFileSync("web-asset/admin/library-review-workbench.js", "utf8")
  const shared = fs.readFileSync("web-asset/shared/vocabulary-esl-editor.js", "utf8")
  assert.match(workbench, /\["syllableCount", "Number of syllables"\]/)
  assert.match(workbench, /Enter \$\{datumLabel\} \(blank is allowed\)/)
  assert.match(workbench, /dictionary-builder-pos-controls/)
  assert.match(workbench, /posControlsHtml/, "Builder reuses the shared POS dropdown renderer")
  assert.match(workbench, /Object\.entries\(controlValues\)[\s\S]*control\.value = String\(value \?\? ""\)/, "Manual POS selections are restored after dependent controls rerender")
  assert.match(shared, /function posControlsHtml\(pos, rowUid, values = \{\}\)/, "Shared form POS dropdown renderer is present")
  assert.match(shared, /window\.SIS_VOCABULARY_ESL = \{[\s\S]*posControlsHtml,/, "Shared POS dropdown renderer is exported")
  assert.match(workbench, /datum === "synonymsAntonyms"[\s\S]*merriam_webster_thesaurus/, "MW Thesaurus is the first Synonyms / Antonyms candidate")
  assert.doesNotMatch(workbench, /Recent Examples/u)
  assert.match(workbench, /not_found: "not found \(HTTP 404\)"/, "HTTP 404 status has a distinct user-facing label")
  assert.match(workbench, /not_provided: "not provided by source"/, "Not-provided status has a distinct user-facing label")
  assert.match(workbench, /robot_blocked: "cookie\/robot prompt; datum paused"/, "Robot-blocked status has a distinct user-facing label")
  assert.match(workbench, /unavailable: "provider unavailable"/, "Provider-unavailable status has a distinct user-facing label")
  assert.match(workbench, /Resolve any cookie\/robot prompts[\s\S]*Retry provider/, "Robot prompts remain visible in the Builder header while the run continues")
  assert.match(workbench, /isDictionaryBuilderPromptStatus\(candidateStatus\)[\s\S]*dictionary-builder-candidate-robot/, "Robot-blocked sources remain visible as resolvable candidates")
  assert.match(workbench, /Complete the robot verification for \$\{unresolvedRobotDatum\[1\]\.provider\}[\s\S]*before applying/, "Robot-blocked candidates require a verified value before Apply")
  assert.match(workbench, /Retry provider[\s\S]*dictionary-builder\/previews\/[\s\S]*\/retry[\s\S]*renderDictionaryBuilder\(refreshed/, "Robot-blocked candidates can be retried after the prompt")
  assert.match(workbench, /window\.open\(candidate\.sourceUrl, providerTabName\(candidate\.provider\)\)[\s\S]*Leave it open[\s\S]*setInterval[\s\S]*retryProvider\(\{ automatic: true \}\)/, "Robot-blocked sources stay open while Builder probes automatically")
  assert.match(workbench, /renderDictionaryBuilder\(refreshed, pane, sourceId, structuredClone\(selectedCandidates\), datum/, "Provider retry preserves candidate selections and the active datum")
  assert.match(workbench, /source tab was blocked[\s\S]*Retry provider/, "Popup blocking retains an explicit retry path")
  assert.match(workbench, /if \(response\.status === 404\)[\s\S]*rebuilding it with the current selections[\s\S]*refreshedSnapshot\.id/, "Apply refreshes a stale in-memory preview once")
  assert.match(workbench, /sizeDictionaryBuilderTextareas/)
  assert.match(workbench, /View source page/)
  assert.match(workbench, /target = "_blank"/)
})

test("Cambridge parser returns pronunciation stress and syllabication", () => {
  const parsed = parseCambridgeHtml('<div class="entry-body__el"><div class="pos-header"><span class="dpos-h_hw"><span class="hw">commend</span></span><span class="pos dpos">verb</span><span class="us dpron-i"><span class="pron"><span class="ipa">kəˈmend</span></span></span></div><div class="def-block"><div class="def">to praise</div></div></div>', { sourceUrl: "https://dictionary.cambridge.org/dictionary/english/commend", lookupWord: "commend", partOfSpeech: "verb" })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.entries[0].hyphenation, "kə-MEND")
  assert.match(parsed.entries[0].pronunciation.us, /ˈmend/)
})
