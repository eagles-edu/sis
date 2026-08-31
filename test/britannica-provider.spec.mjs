import assert from "node:assert/strict"
import test from "node:test"

import { parseBritannicaHtml, previewBritannicaLibraryEntry, sanitizeBritannicaPreview } from "../src/modules/admin/britannica-provider.mjs"

const fixture = `<!doctype html><main><section data-dictionary-entry><h2 class="headword">average</h2><span class="part-of-speech">noun</span><div class="sense"><span class="num">1</span><span class="subtype">countable</span><span class="definition">a single value representing a group</span><span class="example">The class average was high.</span></div><div class="sense"><span class="num">2</span><span class="subtype">uncountable</span><span class="definition">the usual level</span></div></section><section data-dictionary-entry><h2 class="headword">average</h2><span class="part-of-speech">verb</span><div class="sense"><span class="num">1</span><span class="subtype">transitive</span><span class="definition">to find the mean</span><span class="example">Average the scores.</span></div></section><div class="synonyms"><li>mean</li><li>norm</li></div><div class="collocations"><li>above average</li></div><div class="idioms"><li>on average</li></div><div class="phrases"><li>average out</li></div><div class="etymology">From Italian avaria through French avarie.</div><div class="first-known-use">1746</div></main>`

const realBritannicaShapeFixture = `<!doctype html><main><div class="entry"><div class="hw_d"><span class="hw_txt">threaten</span><span class="fl">verb</span></div><div class="sblocks"><div class="sblock_c"><div class="sense"><span class="snum">1</span><span class="gram">transitive</span><span class="def_text">to say that you will cause harm</span><ul><li class="vi">They threatened the shopkeeper.</li></ul></div><div class="sense"><span class="snum">2</span><span class="gram">intransitive</span><span class="def_text">to be likely to cause harm</span></div></div></div></div><div class="synonyms"><ul><li>menace</li></ul></div><div class="antonyms"><ul><li>protect</li></ul></div><div class="more-examples"><ul><li>She threatened to leave.</li></ul></div><div class="recent-examples-on-the-web"><ul><li>The storm threatens the coast.</li></ul></div></main>`

test("Britannica parser preserves all POS, subtype, content sections, and APA citation", () => {
  const result = parseBritannicaHtml(fixture, { sourceUrl: "https://www.britannica.com/dictionary/average", lookupWord: "average" })
  assert.equal(result.ok, true)
  assert.equal(result.provider, "britannica")
  assert.equal(result.entries.length, 2)
  assert.match(result.fields.definition, /class average was high\.\n\n2\. \*uncountable\*/u)
  assert.match(result.fields.definition, /\n {3}- Average the scores\./u)
  assert.match(result.fields.definition, /\*\*Synonyms:\*\*\n- mean\n- norm/u)
  assert.match(result.fields.definition, /\*\*Collocations:\*\*\n- above average/u)
  assert.match(result.fields.definition, /\*\*Idioms:\*\*\n- on average/u)
  assert.match(result.fields.definition, /\*\*Phrases:\*\*\n- average out/u)
  assert.equal(result.fields.countability, "countable_and_uncountable")
  assert.equal(result.fields.verbTransitivity, "transitive")
  assert.equal(result.fields.etymology, "From Italian avaria through French avarie.")
  assert.match(result.fields.originReferences[0].citation, /Britannica Dictionary\. \(n\.d\.\)\. \*average\*/u)
})

test("Britannica parser extracts the live dictionary HTML shape", () => {
  const result = parseBritannicaHtml(realBritannicaShapeFixture, { sourceUrl: "https://www.britannica.com/dictionary/threaten", lookupWord: "threaten" })
  assert.equal(result.ok, true)
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].headword, "threaten")
  assert.equal(result.entries[0].partOfSpeech, "verb")
  assert.equal(result.entries[0].senses.length, 2)
  assert.match(result.fields.definition, /1\. \*transitive\* — to say that you will cause harm/u)
  assert.match(result.fields.definition, /- They threatened the shopkeeper\./u)
  assert.match(result.fields.definition, /\*\*Antonyms:\*\*\n- protect/u)
  assert.match(result.fields.definition, /\*\*More Examples:\*\*\n- She threatened to leave\./u)
  assert.doesNotMatch(result.fields.definition, /Recent Examples on the Web/u)
})

test("Britannica parser removes live entry ordinals from POS headings", () => {
  const result = parseBritannicaHtml(`<!doctype html><main><div class="entry"><div class="hw_d"><span class="hw_txt">1 retreat</span><span class="fl">noun</span></div><div class="sense"><span class="snum">1</span><span class="def_text">movement away</span></div></div><div class="entry"><div class="hw_d"><span class="hw_txt">2 retreat</span><span class="fl">verb</span></div><div class="sense"><span class="snum">1</span><span class="def_text">to move away</span></div></div></main>`, { sourceUrl: "https://www.britannica.com/dictionary/retreat", lookupWord: "retreat" })
  assert.deepEqual(result.entries.map((entry) => entry.headword), ["retreat", "retreat"])
  assert.match(result.fields.definition, /\*\*retreat\*\* \*noun\*[\s\S]*\*\*retreat\*\* \*verb\*/u)
  assert.doesNotMatch(result.fields.definition, /\*\*1 retreat\*\*|\*\*2 retreat\*\*/u)
})

test("Britannica parser resolves the US popup player to its preferred MP3", () => {
  const result = parseBritannicaHtml(`<!doctype html><main><div class="entry"><div class="hw_d"><span class="hw_txt">transact</span><a class="play_pron" data-lang="en_us" data-dir="t" data-file="transa02"></a><span class="fl">verb</span></div><div class="sense"><span class="def_text">to do business</span></div></div></main>`, { sourceUrl: "https://www.britannica.com/dictionary/transact", lookupWord: "transact" })
  assert.equal(result.entries[0].audio.us, "https://media.merriam-webster.com/audio/prons/en/us/mp3/t/transa02.mp3")
})

test("Britannica parser extracts an MP3 from the pronunciation help anchor", () => {
  const result = parseBritannicaHtml(`<!doctype html><main><div class="entry"><div class="hw_d"><span class="hw_txt">dispute</span><span class="fl">verb</span></div><div class="ld_a_box_pron"><div class="ld_a_box_pron"><span>/dɪˈspjuːt/</span><p class="box_trouble"><a href="https://media.merriam-webster.com/audio/prons/en/us/mp3/d/disput09.mp3">Click here to listen</a></p></div></div><div class="sense"><span class="def_text">to disagree</span></div></div></main>`, { sourceUrl: "https://www.britannica.com/dictionary/dispute", lookupWord: "dispute" })
  assert.equal(result.entries[0].audio.us, "https://media.merriam-webster.com/audio/prons/en/us/mp3/d/disput09.mp3")
})

test("Britannica preview fails closed for an access challenge and redacts metadata", async () => {
  const response = { ok: true, status: 200, url: "https://www.britannica.com/dictionary/average", headers: new Headers(), text: async () => fixture }
  const preview = await previewBritannicaLibraryEntry({ english: "average" }, async () => response)
  assert.equal(preview.ok, true)
  assert.equal(Object.hasOwn(sanitizeBritannicaPreview(preview).fields, "dictionaryMetadata"), false)
  const blocked = await previewBritannicaLibraryEntry({ english: "average" }, async () => ({ ok: true, status: 200, url: response.url, headers: new Headers(), text: async () => "<title>Just a moment...</title>" }), async () => ({ ok: false, status: 403 }))
  assert.equal(blocked.ok, false)
  assert.match(blocked.message, /access challenge/u)
})

test("Britannica preview uses a standard browser-rendered page after a server-side 403", async () => {
  let browserFallbackCalls = 0
  const preview = await previewBritannicaLibraryEntry(
    { english: "average" },
    async () => ({ ok: false, status: 403, headers: new Headers() }),
    async (sourceUrl) => {
      browserFallbackCalls += 1
      return { ok: true, status: 200, url: sourceUrl, html: fixture }
    },
  )
  assert.equal(browserFallbackCalls, 1)
  assert.equal(preview.ok, true)
  assert.equal(preview.provider, "britannica")
  assert.match(preview.fields.definition, /class average was high/u)
})
