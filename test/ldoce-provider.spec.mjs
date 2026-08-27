import assert from "node:assert/strict"
import test from "node:test"

import { parseLdoceHtml, previewLdoceLibraryEntry, sanitizeLdocePreview } from "../src/modules/admin/ldoce-provider.mjs"

const fixture = `<!doctype html><span class="dictentry"><div class="frequent Head"><span class="HWD">test</span><span class="HYPHENATION">test</span><span class="HOMNUM">1</span><span class="PronCodes"><span class="PRON">/test/</span><span class="AMEVARPRON">/tɛst/</span></span><span class="brefile" data-src-mp3="https://www.ldoceonline.com/media/english/breProns/test.mp3"></span><span class="amefile" data-src-mp3="https://www.ldoceonline.com/media/english/ameProns/test.mp3"></span><span class="POS">verb</span></div><div class="Inflections">past tested</div><span class="Sense"><span class="sensenum">1</span><span class="GRAM">[T]</span><span class="DEF">to try something</span><span class="EXAMPLE">Test the microphone <span class="speaker exafile" data-src-mp3="https://www.ldoceonline.com/media/english/exaProns/test-example.mp3"></span></span></span><span class="Crossref"><a>test out</a></span></span><span class="dictentry"><div class="Head"><span class="HWD">test</span><span class="HOMNUM">2</span><span class="POS">noun</span></div><span class="Sense"><span class="sensenum">1</span><span class="GRAM">[C]</span><span class="DEF">an examination</span></span></span>`

test("LDOCE parser normalizes entries, senses, grammar, cross-references, and UK/US audio", () => {
  const result = parseLdoceHtml(fixture, { sourceUrl: "https://www.ldoceonline.com/dictionary/test", lookupWord: "test" })
  assert.equal(result.ok, true)
  assert.equal(result.entries.length, 2)
  assert.equal(result.entries[0].homonym, "1")
  assert.equal(result.entries[0].hyphenation, "test")
  assert.equal(result.entries[0].pronunciation.uk, "/test/")
  assert.equal(result.entries[0].pronunciation.us, "/tɛst/")
  assert.equal(result.entries[0].audio.uk.endsWith("/test.mp3"), true)
  assert.equal(result.entries[0].audio.us.endsWith("/test.mp3"), true)
  assert.deepEqual(result.entries[0].inflections, ["past tested"])
  assert.deepEqual(result.entries[0].relatedTopics, ["test out"])
  assert.equal(result.entries[0].senses[0].examples[0].audioUrl.endsWith("test-example.mp3"), true)
  assert.equal(result.fields.verbTransitivity, "transitive")
  assert.match(result.fields.definition, /1\. \*transitive\* — to try something/)
  assert.match(result.fields.definition, /\n {3}- Test the microphone/u)
  assert.match(result.fields.definition, /Test the microphone\n\n1\. \*countable\* — an examination/u)
  assert.equal(result.fields.grammarClassification.grammarSubtype, "transitive, countable")
  assert.match(result.fields.grammarClassification.grammarDetail, /transitive/)
  assert.equal(Object.hasOwn(result, "raw"), false)
  const nounResult = parseLdoceHtml(fixture, { sourceUrl: "https://www.ldoceonline.com/dictionary/test", lookupWord: "test", partOfSpeech: "noun" })
  assert.deepEqual(nounResult.entries.map((entry) => entry.partOfSpeech), ["verb", "noun"])
  assert.deepEqual(nounResult.selectedEntries.map((entry) => entry.partOfSpeech), ["noun"])
  assert.match(nounResult.fields.definition, /to try something[\s\S]*an examination/u)
  assert.equal(nounResult.fields.countability, "countable")
  assert.equal(Object.hasOwn(nounResult.fields, "verbTransitivity"), false)
})

test("LDOCE pronunciation prefers the stressed pronunciation span over slash delimiters", () => {
  const result = parseLdoceHtml('<span class="dictentry"><div class="Head"><span class="HWD">commend</span><span class="HYPHENATION">com‧mend</span><span class="PronCodes"><span class="neutral span"> /</span><span class="PRON">kəˈmend</span><span class="neutral span">/</span></span><span class="POS">verb</span></div><span class="Sense"><span class="DEF">to praise</span></span></span>', { lookupWord: "commend" })
  assert.equal(result.entries[0].hyphenation, "com‧mend")
  assert.equal(result.entries[0].pronunciation.uk, "kəˈmend")
})

test("LDOCE preview redacts remote audio URLs before browser delivery", () => {
  const result = parseLdoceHtml(fixture, { sourceUrl: "https://www.ldoceonline.com/dictionary/test", lookupWord: "test" })
  const preview = sanitizeLdocePreview(result)
  assert.equal(preview.entries[0].audio.uk, true)
  assert.equal(preview.entries[0].audio.us, true)
  assert.equal(Object.hasOwn(preview.entries[0].audio, "url"), false)
  assert.equal(preview.entries[0].senses[0].examples[0].audioAvailable, true)
  assert.equal(Object.hasOwn(preview.entries[0].senses[0].examples[0], "audioUrl"), false)
  assert.equal(Object.hasOwn(preview.fields, "dictionaryMetadata"), false)
})

test("LDOCE preview is non-mutating and rejects unavailable or oversized responses", async () => {
  const response = (html, extra = {}) => ({ ok: true, status: 200, url: "https://www.ldoceonline.com/dictionary/test", headers: new Headers(extra), text: async () => html })
  const preview = await previewLdoceLibraryEntry({ english: "test" }, async () => response(fixture))
  assert.equal(preview.ok, true)
  const failed = await previewLdoceLibraryEntry({ english: "test" }, async () => ({ ok: false, status: 503, headers: new Headers() }))
  assert.equal(failed.ok, false)
  assert.match(failed.message, /no Library data was changed/)
  const oversized = await previewLdoceLibraryEntry({ english: "test" }, async () => response("x", { "content-length": "3000000" }))
  assert.equal(oversized.ok, false)
  assert.match(oversized.message, /exceeded the permitted size/)
})

test("LDOCE parser fails closed when no dictionary entry is present", () => {
  const result = parseLdoceHtml("<html><body>not found</body></html>", { lookupWord: "missing" })
  assert.equal(result.ok, false)
  assert.match(result.message, /No LDOCE entry was found/)
})

test("LDOCE keeps every selected-POS subtype in the definition but derives only its POS field", () => {
  const verbFixture = `<span class="dictentry"><div class="Head"><span class="HWD">read</span><span class="POS">verb</span></div><span class="Sense"><span class="sensenum">1</span><span class="GRAM">[T]</span><span class="DEF">to look at words and understand them</span></span><span class="Sense"><span class="sensenum">2</span><span class="GRAM">[I]</span><span class="DEF">to have the ability to read</span></span></span>`
  const verb = parseLdoceHtml(verbFixture, { lookupWord: "read", partOfSpeech: "verb" })
  assert.match(verb.fields.definition, /\*transitive\* — to look at words[\s\S]*\*intransitive\* — to have the ability/u)
  assert.equal(verb.fields.verbTransitivity, "ambitransitive")
  assert.equal(Object.hasOwn(verb.fields, "countability"), false)

  const nounFixture = `<span class="dictentry"><div class="Head"><span class="HWD">paper</span><span class="POS">noun</span></div><span class="Sense"><span class="sensenum">1</span><span class="GRAM">[C]</span><span class="DEF">a material used for writing</span></span><span class="Sense"><span class="sensenum">2</span><span class="GRAM">[U]</span><span class="DEF">the material itself</span></span></span>`
  const noun = parseLdoceHtml(nounFixture, { lookupWord: "paper", partOfSpeech: "noun" })
  assert.match(noun.fields.definition, /\*countable\* — a material[\s\S]*\*uncountable\* — the material/u)
  assert.equal(noun.fields.countability, "countable_and_uncountable")
  assert.equal(Object.hasOwn(noun.fields, "verbTransitivity"), false)
})
