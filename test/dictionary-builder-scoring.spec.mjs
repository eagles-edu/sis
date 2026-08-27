import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import { DICTIONARY_BUILDER_SCORING_SOURCES, dictionaryBuilderInitialQuality } from "../src/modules/admin/dictionary-builder.mjs"
import { parseCambridgeHtml } from "../src/modules/admin/cambridge-provider.mjs"

test("Dictionary Builder scoring defines thirteen independently scored sources and automatic scarcity quality", () => {
  assert.equal(DICTIONARY_BUILDER_SCORING_SOURCES.length, 13)
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
  assert.doesNotMatch(source, /google_definitions[^\n]*syllabication/u)
})

test("Definitions page is a standalone Library administration surface with protected matrix and XLSX routes", () => {
  const routes = fs.readFileSync("server/student-admin-routes.mjs", "utf8")
  const page = fs.readFileSync("web-asset/admin/library-definitions.html", "utf8")
  const client = fs.readFileSync("web-asset/admin/library-definitions.js", "utf8")
  assert.match(routes, /ADMIN_LIBRARY_DEFINITIONS_PAGE_PATH/)
  assert.match(routes, /ADMIN_LIBRARY_DEFINITIONS_MATRIX_PATH/)
  assert.match(routes, /ADMIN_LIBRARY_DEFINITIONS_EXPORT_PATH/)
  assert.match(routes, /assertCanManageSettings\(rolePolicy\)/)
  assert.match(page, /library-definitions\.min\.js/)
  assert.match(page, /Current suitability matrix/)
  assert.match(client, /matrix\.xlsx/)
})

test("Builder renders every datum with a manual path and POS dropdowns", () => {
  const workbench = fs.readFileSync("web-asset/admin/library-review-workbench.js", "utf8")
  assert.match(workbench, /\["syllableCount", "Number of syllables"\]/)
  assert.match(workbench, /Enter \$\{datumLabel\} \(blank is allowed\)/)
  assert.match(workbench, /dictionary-builder-pos-controls/)
  assert.match(workbench, /grammarFamily/, "POS family dropdown is present")
  assert.match(workbench, /monotransitive/, "verb class choices are present")
  assert.match(workbench, /coordinating/, "conjunction class choices are present")
  assert.match(workbench, /pronominal adjectives/, "pronoun class choices are present")
  assert.match(workbench, /sizeDictionaryBuilderTextareas/)
  assert.match(workbench, /structuredInput/)
  assert.match(workbench, /View source page/)
  assert.match(workbench, /target = "_blank"/)
})

test("Cambridge parser returns pronunciation stress and syllabication", () => {
  const parsed = parseCambridgeHtml('<div class="entry-body__el"><div class="pos-header"><span class="dpos-h_hw"><span class="hw">commend</span></span><span class="pos dpos">verb</span><span class="us dpron-i"><span class="pron"><span class="ipa">kəˈmend</span></span></span></div><div class="def-block"><div class="def">to praise</div></div></div>', { sourceUrl: "https://dictionary.cambridge.org/dictionary/english/commend", lookupWord: "commend", partOfSpeech: "verb" })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.entries[0].hyphenation, "kə-MEND")
  assert.match(parsed.entries[0].pronunciation.us, /ˈmend/)
})
