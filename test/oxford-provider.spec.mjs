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

test("Oxford parser extracts American audio for verb forms only on verb entries", () => {
  const html = `<!doctype html><div id="entryContent"><div class="entry"><div class="top-g"><div class="webtop-g"><h2 class="h">transact</h2><span class="pos">verb</span></div></div><table class="verb_forms_table"><tr class="verb_form" form="root"><td class="phons_n_am"><span class="sound" data-src-mp3="https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/t/tra/trans/transact__us_1_rr.mp3"></span></td></tr><tr class="verb_form" form="past"><td class="phons_n_am"><span class="sound" data-src-mp3="https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/t/tra/trans/transacted__us_1.mp3"></span></td></tr><tr class="verb_form" form="prespart"><td class="phons_n_am"><span class="sound" data-src-mp3="https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/t/tra/trans/transacting__us_1.mp3"></span></td></tr></table><span class="sn-g"><span class="def">to transact business</span></span></div></div>`
  const result = parseOxfordHtml(html, { sourceUrl: "https://www.oxfordlearnersdictionaries.com/definition/american_english/transact", lookupWord: "transact", partOfSpeech: "verb" })
  assert.equal(result.entries[0].verbFormAudio.verbV1.us.endsWith("transact__us_1_rr.mp3"), true)
  assert.equal(result.entries[0].verbFormAudio.verbV2.us.endsWith("transacted__us_1.mp3"), true)
  assert.equal(result.entries[0].verbFormAudio.verbV4.us.endsWith("transacting__us_1.mp3"), true)
})

test("Oxford parser extracts live Verb Forms audio rows", () => {
  const html = `<!doctype html><div id="entryContent"><div class="entry"><div class="top-g"><div class="webtop-g"><h2 class="h">go</h2><span class="pos">verb</span></div></div><span class="collapse" title="Verb Forms"><span class="unbox" unbox="verbforms"><span class="body"><span class="vp-g" form="thirdps"><span class="vp"><span class="prefix">he / she / it</span> goes</span><div class="pron-g" geo="n_am"><div class="sound" data-src-mp3="https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/g/goe/goes_/goes__us_1.mp3" data-src-ogg="https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron_ogg/g/goe/goes_/goes__us_1.ogg"></div></div></span><span class="vp-g" form="pastpart"><span class="vp"><span class="prefix">past participle</span> gone</span><div class="pron-g" geo="n_am"><div class="sound" data-src-mp3="https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/g/gon/gone_/gone__us_1.mp3" data-src-ogg="https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron_ogg/g/gon/gone_/gone__us_1.ogg"></div></div></span></span></span><span class="sn-g"><span class="def">to move</span></span></div></div>`
  const result = parseOxfordHtml(html, { sourceUrl: "https://www.oxfordlearnersdictionaries.com/definition/american_english/go", lookupWord: "go", partOfSpeech: "verb" })
  assert.equal(result.entries[0].verbForms.verbV5, "goes")
  assert.equal(result.entries[0].verbFormAudio.verbV5.us.endsWith("goes__us_1.mp3"), true)
  assert.equal(result.entries[0].verbFormAudio.verbV5.ogg.endsWith("goes__us_1.ogg"), true)
  assert.equal(result.entries[0].verbForms.verbV3, "gone")
  assert.equal(result.entries[0].verbFormAudio.verbV3.us.endsWith("gone__us_1.mp3"), true)
})

test("Oxford parser extracts text verb forms for fallback use", () => {
  const html = `<!doctype html><div id="entryContent"><div class="entry"><div class="top-g"><div class="webtop-g"><h2 class="h">transact</h2><span class="pos">verb</span></div></div><table class="verb_forms_table"><tr class="verb_form" form="root"><td class="verb_form">transact</td></tr><tr class="verb_form" form="thirdps"><td class="verb_form">transacts</td></tr><tr class="verb_form" form="past"><td class="verb_form">transacted</td></tr><tr class="verb_form" form="pastpart"><td class="verb_form">transacted</td></tr><tr class="verb_form" form="prespart"><td class="verb_form">transacting</td></tr></table><span class="sn-g"><span class="def">to transact business</span></span></div></div>`
  const result = parseOxfordHtml(html, { sourceUrl: "https://www.oxfordlearnersdictionaries.com/definition/american_english/transact", lookupWord: "transact", partOfSpeech: "verb" })
  assert.deepEqual(result.fields.verbForms, { verbInfinitive: "to transact", verbV1: "transact", verbV2: "transacted", verbV3: "transacted", verbV4: "transacting", verbV5: "transacts" })
})

test("Oxford parser falls back from unavailable V3 audio to V2 MP3 and OGG", () => {
  const html = `<!doctype html><div id="entryContent"><div class="entry"><div class="top-g"><div class="webtop-g"><h2 class="h">export</h2><span class="pos">verb</span></div></div><span class="unbox" unbox="verbforms"><span class="vp-g" form="past"><span class="vp"><span class="prefix">past simple</span> exported</span><div class="sound" data-src-mp3="https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/e/exp/exported__us_1.mp3" data-src-ogg="https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron_ogg/e/exp/exported__us_1.ogg"></div></span><span class="vp-g" form="pastpart"><span class="vp"><span class="prefix">past participle</span> exported</span></span></span><span class="sn-g"><span class="def">to send abroad</span></span></div></div>`
  const result = parseOxfordHtml(html, { sourceUrl: "https://www.oxfordlearnersdictionaries.com/definition/american_english/export", lookupWord: "export", partOfSpeech: "verb" })
  assert.equal(result.entries[0].verbFormAudio.verbV3.us.endsWith("exported__us_1.mp3"), true)
  assert.equal(result.entries[0].verbFormAudio.verbV3.ogg.endsWith("exported__us_1.ogg"), true)
})

test("Oxford parser fills only the unavailable V3 audio format from V2", () => {
  const html = `<!doctype html><div id="entryContent"><div class="entry"><div class="top-g"><div class="webtop-g"><h2 class="h">learn</h2><span class="pos">verb</span></div></div><span class="unbox" unbox="verbforms"><span class="vp-g" form="past"><span class="vp"><span class="prefix">past simple</span> learned</span><div class="sound" data-src-mp3="https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/l/lea/learned_/learned__us_1.mp3" data-src-ogg="https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron_ogg/l/lea/learned_/learned__us_1.ogg"></div></span><span class="vp-g" form="pastpart"><span class="vp"><span class="prefix">past participle</span> learnt</span><div class="sound" data-src-mp3="https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/l/lea/learnt_/learnt__us_1.mp3"></div></span></span><span class="sn-g"><span class="def">to acquire knowledge</span></span></div></div>`
  const result = parseOxfordHtml(html, { sourceUrl: "https://www.oxfordlearnersdictionaries.com/definition/american_english/learn", lookupWord: "learn", partOfSpeech: "verb" })
  assert.equal(result.entries[0].verbFormAudio.verbV3.us.endsWith("learnt__us_1.mp3"), true)
  assert.equal(result.entries[0].verbFormAudio.verbV3.ogg.endsWith("learned__us_1.ogg"), true)
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
