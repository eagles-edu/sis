import test from "node:test"
import assert from "node:assert/strict"

import { checkTextWithLanguageTool } from "../src/modules/admin/student-news-language-tool.mjs"

test("normalizes LanguageTool blocking and advisory matches", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, request) => {
    assert.equal(request.method, "POST")
    assert.equal(new URLSearchParams(request.body).get("language"), "en-US")
    return new Response(JSON.stringify({
      matches: [
        {
          offset: 0,
          length: 1,
          message: "Start with a capital letter",
          rule: { id: "UPPERCASE_SENTENCE_START", category: { id: "CASING" } },
          replacements: [{ value: "There" }],
          issueType: "grammar",
        },
        {
          offset: 6,
          length: 4,
          message: "Consider a clearer phrase",
          rule: { id: "STYLE_CLUMSY", category: { id: "STYLE" } },
          replacements: [{ value: "no evidence of" }],
          issueType: "style",
        },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })
  }
  try {
    const result = await checkTextWithLanguageTool("there has no bias.", {
      endpoint: "http://127.0.0.1:8093/v2/check",
    })
    assert.equal(result.matches.length, 2)
    assert.equal(result.blockingIssues[0].ruleId, "UPPERCASE_SENTENCE_START")
    assert.deepEqual(result.advisoryIssues[0].replacements, ["no evidence of"])
    assert.equal(result.advisoryIssues[0].blocking, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("malformed LanguageTool responses fail closed", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ nope: [] }), { status: 200 })
  try {
    await assert.rejects(
      checkTextWithLanguageTool("There is no bias.", { endpoint: "http://127.0.0.1:8093/v2/check" }),
      /invalid response/
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
