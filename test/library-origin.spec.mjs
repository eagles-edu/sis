import assert from "node:assert/strict"
import test from "node:test"
import { buildOriginReference, extractOriginPath, normalizeOriginReferences, parseEtymonlineParagraph, safeEtymonlineMarkup } from "../src/modules/admin/library-origin.mjs"
import { analyzeLibraryOrigin, createOriginSourceAdapter, parseMerriamWebsterEtymology, parseMerriamWebsterReaderEtymology } from "../src/modules/admin/library-origin-analysis.mjs"

const sample = `<section class="prose lg:prose-lg dark:prose-dark [&amp;_em]:bg-warning/30"><p>"humorous," 1756, from <a title="Etymology" href="/word/fun">fun</a> (n.) + <a href="/word/-y">-y</a> (2). Meaning <em>strange</em>, <strong>odd</strong>. <i class="foreign">funny ha-ha</i>.</p></section>`

test("Etymonline extraction keeps only safe inline editor markup", () => {
  const result = parseEtymonlineParagraph(sample, { word: "funny", retrievedAt: "2026-08-14T00:00:00.000Z" })
  assert.equal(result.paragraph, '"humorous," 1756, from fun (n.) + -y (2). Meaning *strange*, **odd**. *funny ha-ha*.')
  assert.equal(result.originPath, null)
  assert.doesNotMatch(result.paragraph, /<a|href=|class=/u)
  assert.match(result.citation, /https:\/\/www\.etymonline\.com\/search\?q=funny/u)
  assert.equal(result.reference.provider, "Etymonline")
})

test("origin path extraction is conservative and ordered", () => {
  assert.equal(extractOriginPath("Borrowed from Latin via Old French into Middle English."), "Latin → Old French → Middle English → English")
  assert.equal(extractOriginPath("from fun (n.) + -y (2)"), "")
  assert.equal(extractOriginPath("A word with no source chain."), "")
})

test("origin references are bounded and deduplicated by exact URL", () => {
  const first = buildOriginReference({ source: "Etymonline", url: "https://www.etymonline.com/search?q=funny", claims: ["etymology"], provider: "Etymonline" })
  const duplicate = buildOriginReference({ source: "Etymonline", url: "https://www.etymonline.com/search?q=funny", claims: ["originPath"], provider: "Etymonline" })
  const normalized = normalizeOriginReferences([first, duplicate, { source: "bad", url: "javascript:alert(1)" }])
  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].url, first.url)
})

test("ET insertion places Etymology after First known use and before Stems and Works Cited", async () => {
  const { insertEtymologyDeterministically } = await import("../src/modules/admin/library-origin.mjs")
  const source = "Definition\n\n**First known use:** 1600\n\n**Stems:**\n- stem\n\nlate Old English *wilde fyr*\n\n**Works Cited:**\n- citation"
  const result = insertEtymologyDeterministically(source, "from Old French via Latin")
  assert.ok(result.indexOf("First known use") < result.indexOf("Etymology"))
  assert.ok(result.indexOf("Etymology") < result.indexOf("Stems"))
  assert.ok(result.indexOf("First known use") < result.indexOf("Stems"))
  assert.ok(result.indexOf("Stems") < result.indexOf("Works Cited"))
  assert.match(result, /\*\*Etymology:\*\*[\s\S]*late Old English \*wilde fyr\*[\s\S]*from Old French via Latin/)
  assert.doesNotMatch(result, /\*\*First known use:\*\* 1600; from Old French via Latin/)
  assert.equal((result.match(/from Old French via Latin/gu) || []).length, 1)
  assert.equal(insertEtymologyDeterministically(result, "from Old French via Latin"), result)
})

test("definition normalization preserves user-entered line breaks", async () => {
  const { normalizeDefinitionText } = await import("../src/modules/admin/library-origin.mjs")
  assert.equal(normalizeDefinitionText("First line\r\n\r\nSecond line\n"), "First line\n\nSecond line\n")
})

const analysisOptions = (etymonline, merriamWebster) => ({
  fetchEtymonlinePreviewImpl: async () => ({ ok: true, paragraph: etymonline }),
  fetchMerriamWebsterEtymologyImpl: async () => ({ ok: true, etymology: merriamWebster }),
})

test("Merriam-Webster origin review extracts only the public etymology section", () => {
  const html = `<main><div class="entry"><p>Definition text must not be used.</p><div class="et"><strong>Etymology</strong><span>Middle English, from Anglo-French discerner, from Latin discernere.</span></div></div></main>`
  assert.equal(parseMerriamWebsterEtymology(html), "Middle English, from Anglo-French discerner, from Latin discernere.")
})

test("Merriam-Webster reader fallback extracts the public Word History etymology", () => {
  const markdown = "# discern\n\n## Word History\n\nEtymology\n\nMiddle English *discernen*, borrowed from Anglo-French *discerner*.\n\n## First Known Use\n\n14th century"
  assert.equal(parseMerriamWebsterReaderEtymology(markdown), "Middle English *discernen*, borrowed from Anglo-French *discerner*.")
})

test("standalone origin analysis accepts code-added source adapters", async () => {
  const source = createOriginSourceAdapter({ id: "project-archive", provider: "Project archive", fetchProse: async () => ({ prose: "coined in English from a documented project term." }) })
  const result = await analyzeLibraryOrigin({ english: "projectword", partOfSpeech: "noun" }, { sourceAdapters: [source] })
  assert.equal(result.determination.type, "derived")
  assert.equal(result.sources[0].id, "project-archive")
})

test("standalone origin analysis classifies a donor-language route without changing entry data", async () => {
  const entry = { english: "discern", partOfSpeech: "verb", etymologyType: "", etymology: "" }
  const result = await analyzeLibraryOrigin(entry, analysisOptions(
    "late 14c., from Old French discerner, directly from Latin discernere.",
    "Middle English, borrowed from Anglo-French discerner, from Latin discernere.",
  ))
  assert.equal(result.advisory, true)
  assert.equal(result.determination.type, "borrowed")
  assert.equal(result.determination.confidenceLevel, "CL-A (high)")
  assert.equal(result.topCandidates.length, 3)
  assert.equal(entry.etymologyType, "")
  assert.equal(entry.etymology, "")
  assert.equal(result.sources.length, 2)
})

test("standalone origin analysis distinguishes English affixation from older root ancestry", async () => {
  const result = await analyzeLibraryOrigin({ english: "unhappy", partOfSpeech: "adjective" }, analysisOptions(
    "from un- + happy.",
    "formed from un- and happy.",
  ))
  assert.equal(result.determination.type, "derived")
  assert.equal(result.determination.confidenceLevel, "CL-B (good)")
})

test("standalone origin analysis requests a stem only when prose leaves an apparent affix unresolved", async () => {
  const result = await analyzeLibraryOrigin({ english: "reframe", partOfSpeech: "verb" }, analysisOptions("A verb of uncertain history.", ""))
  assert.equal(result.requiresStem, true)
  assert.match(result.stemPrompt, /base or stem/u)
  assert.ok(result.missingInfo.some((item) => /exact word/u.test(item)))
})
