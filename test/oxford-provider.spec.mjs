import assert from "node:assert/strict"
import test from "node:test"

import { parseOxfordHtml, previewOxfordLibraryEntry, sanitizeOxfordPreview } from "../src/modules/admin/oxford-provider.mjs"

const fixture = `<!doctype html><div id="entryContent"><div class="entry"><div class="top-g"><div class="webtop-g"><h2 class="h">word</h2><span class="pos">noun</span></div><div class="pron-g"><span class="phon"><span class="name">NAmE</span>/wərd/</span><div class="sound" data-src-mp3="https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/w/wor/word_/word__us_1.mp3"></div></div></div><span class="sn-g"><span class="num">1</span><span class="gram">countable</span><span class="def">a single unit of language</span><span class="x">Do not write more than 200 words.</span></span><span class="sn-g"><span class="num">2</span><span class="gram">countable</span><span class="def">a second collection of words</span><span class="x">The second example is here.</span></span></div></div>`

test("Oxford parser extracts American headword, POS, definitions, grammar, and audio", () => {
  const result = parseOxfordHtml(fixture, { sourceUrl: "https://www.oxfordlearnersdictionaries.com/definition/american_english/word_1", lookupWord: "word" })
  assert.equal(result.ok, true)
  assert.equal(result.provider, "oxford")
  assert.equal(result.entries[0].headword, "word")
  assert.equal(result.entries[0].partOfSpeech, "noun")
  assert.equal(result.entries[0].pronunciation.us, "/wərd/")
  assert.equal(result.entries[0].audio.us.endsWith("word__us_1.mp3"), true)
  assert.equal(result.fields.countability, "countable")
  assert.match(result.fields.definition, /1\. \*countable\* — a single unit of language/u)
  assert.match(result.fields.definition, /\n {3}- Do not write more than 200 words\./u)
  assert.match(result.fields.definition, /200 words\.\n\n2\. \*countable\* — a second collection of words/u)
})

test("Oxford preview is non-mutating and redacts remote media URLs", async () => {
  const response = { ok: true, status: 200, url: "https://www.oxfordlearnersdictionaries.com/definition/american_english/word_1", headers: new Headers(), text: async () => fixture }
  const preview = await previewOxfordLibraryEntry({ english: "word", partOfSpeech: "noun" }, async () => response)
  assert.equal(preview.ok, true)
  const safe = sanitizeOxfordPreview(preview)
  assert.equal(safe.entries[0].audio.us, true)
  assert.equal(Object.hasOwn(safe.entries[0].audio, "url"), false)
  assert.equal(Object.hasOwn(safe.fields, "dictionaryMetadata"), false)
  assert.equal(safe.entries[0].senses[0].examples[0].audioAvailable, false)
})

test("Oxford preview fails closed when the source is unavailable", async () => {
  const preview = await previewOxfordLibraryEntry({ english: "word" }, async () => ({ ok: false, status: 503, headers: new Headers() }))
  assert.equal(preview.ok, false)
  assert.match(preview.message, /no Library data was changed/u)
})
