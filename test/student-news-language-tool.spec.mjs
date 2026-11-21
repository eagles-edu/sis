import test from "node:test"
import assert from "node:assert/strict"

import { checkTextWithLanguageTool } from "../src/modules/admin/student-news-language-tool.mjs"

test("normalizes LanguageTool blocking and advisory matches", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, request) => {
    assert.equal(request.method, "POST")
    assert.equal(new URLSearchParams(request.body).get("language"), "en-US")
    assert.equal(new URLSearchParams(request.body).get("enabledRules"), "ARTICLE_MISSING")
    return new Response(JSON.stringify({
      matches: [
        {
          offset: 0,
          length: 1,
          message: "Start with a capital letter",
          rule: { id: "UPPERCASE_SENTENCE_START", category: { id: "CASING" } },
          replacements: [{ value: "There" }],
          context: { text: "RAW_PROVIDER_CONTEXT_SENTINEL" },
          providerCredential: "RAW_PROVIDER_CREDENTIAL_SENTINEL",
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
    assert.doesNotMatch(JSON.stringify(result), /RAW_PROVIDER_CONTEXT_SENTINEL|RAW_PROVIDER_CREDENTIAL_SENTINEL/u)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("does not reject an article that follows a possessive determiner", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, request) => {
    const text = new URLSearchParams(request.body).get("text") || ""
    const offset = text.indexOf("diplomatic role")
    return new Response(JSON.stringify({
      matches: [{
        offset,
        length: "diplomatic role".length,
        message: "The article might be missing before the noun.",
        rule: { id: "ARTICLE_MISSING", category: { id: "GRAMMAR" } },
        replacements: [{ value: "a diplomatic role" }],
        issueType: "grammar",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } })
  }
  try {
    const possessive = await checkTextWithLanguageTool(
      "The report emphasizes Pakistan's diplomatic role and includes the wider conflict context.",
      { endpoint: "http://127.0.0.1:8093/v2/check" },
    )
    assert.deepEqual(possessive.matches, [])
    assert.deepEqual(possessive.blockingIssues, [])

    const missingArticle = await checkTextWithLanguageTool(
      "The report emphasizes diplomatic role and includes the wider conflict context.",
      { endpoint: "http://127.0.0.1:8093/v2/check" },
    )
    assert.equal(missingArticle.blockingIssues.length, 1)
    assert.equal(missingArticle.blockingIssues[0].ruleId, "ARTICLE_MISSING")
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

test("LanguageTool rate limits and service failures reject the online check", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response("rate limited", { status: 429 })
  try {
    await assert.rejects(
      checkTextWithLanguageTool("There is no bias.", { endpoint: "http://127.0.0.1:8093/v2/check" }),
      /HTTP 429/u,
    )
    globalThis.fetch = async () => { throw new Error("connection refused") }
    await assert.rejects(
      checkTextWithLanguageTool("There is no bias.", { endpoint: "http://127.0.0.1:8093/v2/check" }),
      /connection refused/u,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("LanguageTool request timeout aborts and rejects the required check", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, request) => new Promise((_resolve, reject) => {
    request.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
  })
  try {
    await assert.rejects(
      checkTextWithLanguageTool("There is no bias.", {
        endpoint: "http://127.0.0.1:8093/v2/check",
        timeoutMs: 1000,
      }),
      { name: "AbortError" },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
