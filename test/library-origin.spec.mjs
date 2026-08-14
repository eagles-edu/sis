import assert from "node:assert/strict"
import test from "node:test"
import { buildOriginReference, extractOriginPath, normalizeOriginReferences, parseEtymonlineParagraph, safeEtymonlineMarkup } from "../src/modules/admin/library-origin.mjs"

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
