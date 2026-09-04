import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import { parseMerriamWebsterHtml, previewMerriamWebsterDictionaryEntry, sanitizeMerriamWebsterPreview } from "../src/modules/admin/merriam-webster-provider.mjs"

const fixture = `<!doctype html><main><section class="entry-word-section-container"><h2 class="hword">average</h2><span class="fl">noun</span><div class="sense"><span class="sn">1</span><span class="sgram">count noun</span><span class="dtText">: a value that represents a group</span><span class="vis">The average was high.</span></div><div class="sense"><span class="sn">2</span><span class="sgram">noncount noun</span><span class="dtText">: the usual level</span></div></section><section class="entry-word-section-container"><h2 class="hword">average</h2><span class="fl">verb</span><div class="sense"><span class="sn">1</span><span class="vd">transitive verb</span><span class="dtText">: to find the mean</span><span class="vis">Average the scores.</span></div></section><section class="word-history"><div class="et">from Middle French avarie</div></section><div class="first-known-use">1746</div><div class="synonyms"><li>mean</li></div><div class="collocations"><li>average cost</li></div><div class="idioms"><li>on average</li></div><div class="phrases"><li>average out</li></div></main>`

test("Merriam-Webster parser preserves all POS, subtype, content sections, and APA citation", () => {
  const result = parseMerriamWebsterHtml(fixture, { sourceUrl: "https://www.merriam-webster.com/dictionary/average", lookupWord: "average" })
  assert.equal(result.ok, true)
  assert.equal(result.provider, "merriam-webster")
  assert.equal(result.entries.length, 2)
  assert.match(result.fields.definition, /average was high\.\n\n2\. \*noncount noun\*/u)
  assert.match(result.fields.definition, /\n {3}- Average the scores\./u)
  assert.match(result.fields.definition, /\*\*Synonyms:\*\*\n- mean/u)
  assert.match(result.fields.definition, /\*\*Collocations:\*\*\n- average cost/u)
  assert.match(result.fields.definition, /\*\*Idioms:\*\*\n- on average/u)
  assert.match(result.fields.definition, /\*\*Phrases:\*\*\n- average out/u)
  assert.equal(result.fields.countability, "countable_and_uncountable")
  assert.equal(result.fields.verbTransitivity, "transitive")
  assert.equal(result.fields.etymology, "from Middle French avarie")
  assert.match(result.fields.originReferences[0].citation, /Merriam-Webster\.com Dictionary\. \(n\.d\.\)\. \*average\*/u)
})

test("Merriam-Webster parser extracts an MP3 from the pronunciation help anchor", () => {
  const result = parseMerriamWebsterHtml(`<!doctype html><main><section class="entry-word-section-container"><h2 class="hword">dispute</h2><span class="fl">verb</span><div class="ld_a_box_pron"><a href="https://media.merriam-webster.com/audio/prons/en/us/mp3/d/disput09.mp3">Click here to listen</a></div><div class="sense"><span class="dtText">: to disagree</span></div></section></main>`, { sourceUrl: "https://www.merriam-webster.com/dictionary/dispute", lookupWord: "dispute" })
  assert.equal(result.entries[0].audio.us, "https://media.merriam-webster.com/audio/prons/en/us/mp3/d/disput09.mp3")
})

test("Merriam-Webster parser accepts the Word History etymology section", () => {
  const html = fs.readFileSync(new URL("../docs/mw-etym-1.html", import.meta.url), "utf8")
  const result = parseMerriamWebsterHtml(html, { sourceUrl: "https://www.merriam-webster.com/dictionary/chair", lookupWord: "chair" })
  assert.equal(result.ok, true)
  assert.equal(result.entries.length, 0)
  assert.match(result.fields.etymology, /Middle English chaiere/u)
  assert.equal(result.fields.originReferences.length, 1)
})

test("Merriam-Webster preview is non-mutating and redacts metadata", async () => {
  const response = { ok: true, status: 200, url: "https://www.merriam-webster.com/dictionary/average", headers: new Headers(), text: async () => fixture }
  const preview = await previewMerriamWebsterDictionaryEntry({ english: "average" }, async () => response)
  assert.equal(preview.ok, true)
  assert.equal(Object.hasOwn(sanitizeMerriamWebsterPreview(preview).fields, "dictionaryMetadata"), false)
})

test("Merriam-Webster preview uses a standard browser-rendered page after a server-side 403", async () => {
  let browserFallbackCalls = 0
  const preview = await previewMerriamWebsterDictionaryEntry(
    { english: "average" },
    async () => ({ ok: false, status: 403, headers: new Headers() }),
    async (sourceUrl) => {
      browserFallbackCalls += 1
      return { ok: true, status: 200, url: sourceUrl, html: fixture }
    },
  )
  assert.equal(browserFallbackCalls, 1)
  assert.equal(preview.ok, true)
  assert.equal(preview.provider, "merriam-webster")
  assert.match(preview.fields.definition, /average was high/u)
})

test("Merriam-Webster preview remains fail-closed when the browser-rendered page is challenged", async () => {
  const preview = await previewMerriamWebsterDictionaryEntry(
    { english: "average" },
    async () => ({ ok: true, status: 200, url: "https://www.merriam-webster.com/dictionary/average", headers: new Headers(), text: async () => "<title>Just a moment...</title>" }),
    async () => ({ ok: false, status: 403, message: "Merriam-Webster is protected by an access challenge; no Library data was changed." }),
  )
  assert.equal(preview.ok, false)
  assert.match(preview.message, /no Library data was changed/u)
})
