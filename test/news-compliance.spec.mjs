import test from "node:test"
import assert from "node:assert/strict"

import {
  evaluateStudentNewsCompliance,
  mergeStudentNewsReviewNoteWithCompliance,
  updateStudentNewsValidationIssues,
} from "../server/student-admin-store.mjs"

const ARTICLE_HTML = `
<!doctype html>
<html>
  <head>
    <title>Storms hit coast city</title>
  </head>
  <body>
    <div>Published March 1, 2026 at 9:00 AM ICT (Indochina Time GMT+7). Updated March 1, 2026 at 11:00 AM ICT (Indochina Time GMT+7).</div>
    <p>Officials said emergency teams evacuated hundreds of families after rising waters flooded multiple districts near the river.</p>
  </body>
</html>
`

function basePayload(overrides = {}) {
  return {
    sourceLink: "https://www.bbc.com/news/world-123456",
    articleTitle: "Storms hit coast city",
    byline: "bbc",
    articleDateline: "Published March 1, 2026 at 9:00 AM ICT (Indochina Time GMT+7). Updated March 1, 2026 at 11:00 AM ICT (Indochina Time GMT+7).",
    leadSynopsis:
      "Officials said emergency teams evacuated hundreds of families after rising waters flooded multiple districts near the river.",
    actionActor: "Emergency teams",
    actionAffected: "Hundreds of families",
    actionWhere: "Riverside districts in Coast City",
    actionWhat: "Emergency teams evacuated residents after flood levels surged quickly.",
    actionWhy: "Floodwaters rose after heavy overnight rain and emergency dam releases.",
    biasAssessment:
      "The report emphasizes official sources and provides limited resident perspective.",
    ...overrides,
  }
}

async function withMockedFetch(html, fn) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  try {
    return await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test(
  "evaluateStudentNewsCompliance accepts byline via organization/domain fallback",
  { concurrency: false },
  async () => {
    const result = await withMockedFetch(ARTICLE_HTML, () =>
      evaluateStudentNewsCompliance(basePayload({ byline: "bbc" }), {
        validationConfig: {
          allowedDomains: ["bbc.com", "cnn.com"],
          thresholds: {
            articleTitle: 0.7,
            byline: 0.7,
            articleDateline: 0.7,
            leadSynopsis: 0.5,
          },
        },
      })
    )

    assert.equal(result.passed, true)
    assert.equal(result.failedFields.byline, undefined)
    assert.equal(result.details.byline.organizationFallback, "bbc")
  }
)

test(
  "evaluateStudentNewsCompliance enforces dateline timezone literal with full text and GMT offset",
  { concurrency: false },
  async () => {
    const result = await withMockedFetch(ARTICLE_HTML, () =>
      evaluateStudentNewsCompliance(
        basePayload({
          articleDateline:
            "Published March 1, 2026 at 9:00 AM ICT. Updated March 1, 2026 at 11:00 AM ICT.",
        }),
        {
          validationConfig: {
            allowedDomains: ["bbc.com", "cnn.com"],
            thresholds: {
              articleTitle: 0.7,
              byline: 0.7,
              articleDateline: 0.7,
              leadSynopsis: 0.5,
            },
          },
        }
      )
    )

    assert.equal(Boolean(result.failedFields.articleDateline), true)
  }
)

test(
  "evaluateStudentNewsCompliance applies lead synopsis threshold at 0.50",
  { concurrency: false },
  async () => {
    const result = await withMockedFetch(ARTICLE_HTML, () =>
      evaluateStudentNewsCompliance(
        basePayload({
          leadSynopsis: "This summary talks about sports and does not match the lead paragraph.",
        }),
        {
          validationConfig: {
            allowedDomains: ["bbc.com", "cnn.com"],
            thresholds: {
              articleTitle: 0.7,
              byline: 0.7,
              articleDateline: 0.7,
              leadSynopsis: 0.5,
            },
          },
        }
      )
    )

    assert.equal(Boolean(result.failedFields.leadSynopsis), true)
    assert.equal(result.failedFields.leadSynopsis.threshold, 0.5)
  }
)

test(
  "BBC liveblog fallback supplies title and lead when primary fetch fails",
  { concurrency: false },
  async () => {
    const liveUrl = "https://www.bbc.com/news/live/cje4x38q8xqt"
    const fallbackMarkdown = [
      "Title: BBC Live Test Headline",
      "Published Time: 2026-03-28T01:01:16.818Z",
      "",
      "Markdown Content:",
      "1.   ### BBC Live Fallback Heading",
      "",
      "Lead paragraph goes here with more than forty characters to satisfy similarity scoring.",
    ].join("\n")

    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      if (typeof url === "string" && url.includes("r.jina.ai")) {
        return new Response(fallbackMarkdown, {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      }
      return new Response("", { status: 503 })
    }

    try {
      const result = await evaluateStudentNewsCompliance(
        basePayload({
          sourceLink: liveUrl,
          articleTitle: "BBC Live Test Headline",
          articleDateline: "2026-03-28T01:01:16.818Z",
          leadSynopsis:
            "Lead paragraph goes here with more than forty characters to satisfy similarity scoring.",
        }),
        {
          validationConfig: {
            allowedDomains: ["bbc.com"],
            thresholds: {
              articleTitle: 0.7,
              byline: 0.7,
              articleDateline: 0.7,
              leadSynopsis: 0.5,
            },
          },
        }
      )

      assert.equal(result.passed, true)
      assert.equal(result.details?.metadata?.via, "bbc-live-fallback")
      assert.equal(result.failedFields.sourceLink, undefined)
    } finally {
      globalThis.fetch = originalFetch
    }
  }
)

test(
  "CNN AMP fallback is used when primary fetch is blocked",
  { concurrency: false },
  async () => {
    const cnnUrl = "https://www.cnn.com/2026/03/31/world/example-story/index.html"
    const originalFetch = globalThis.fetch
    const fetchCalls = []

    globalThis.fetch = async (url) => {
      fetchCalls.push(String(url))
      if (typeof url === "string" && url.includes("outputType=amp")) {
        return new Response(ARTICLE_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      }
      return new Response("", { status: 503 })
    }

    try {
      const result = await evaluateStudentNewsCompliance(
        basePayload({
          sourceLink: cnnUrl,
          byline: "cnn",
        }),
        {
          validationConfig: {
            allowedDomains: ["bbc.com", "cnn.com"],
            thresholds: {
              articleTitle: 0.7,
              byline: 0.7,
              articleDateline: 0.7,
              leadSynopsis: 0.5,
            },
          },
        }
      )

      assert.equal(result.passed, true)
      assert.equal(result.failedFields.sourceLink, undefined)
      assert.ok(fetchCalls.some((url) => url.includes("outputType=amp")))
    } finally {
      globalThis.fetch = originalFetch
    }
  }
)

test(
  "BBC proxy fallback prefers full headline and extracts byline/dateline from markdown body",
  { concurrency: false },
  async () => {
    const bbcUrl = "https://www.bbc.com/news/articles/cy91vrzxn34o"
    const proxyMarkdown = [
      "Title: Iran war: How Pakistan became an unlikely mediator",
      "",
      "URL Source: https://www.bbc.com/news/articles/cy91vrzxn34o",
      "",
      "Published Time: 2026-03-31T02:33:18.419Z",
      "",
      "Markdown Content:",
      "# Iran war: How Pakistan became an unlikely mediator",
      "",
      "# How Pakistan won over Trump to become an unlikely mediator in the Iran war",
      "",
      "13 hours ago",
      "",
      "Share Save",
      "",
      "Caroline Davies Pakistan Correspondent",
      "",
      "![Image 1](https://example.com/a.png)![Image 2](https://example.com/b.png)Getty Images",
      "",
      "Pakistan has been making a diplomatic push to position itself as a negotiator in the war",
    ].join("\n")
    const originalFetch = globalThis.fetch
    const fetchCalls = []
    globalThis.fetch = async (url) => {
      fetchCalls.push(String(url))
      if (typeof url === "string" && url.includes("r.jina.ai")) {
        return new Response(proxyMarkdown, {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      }
      return new Response("", { status: 503 })
    }

    try {
      const result = await evaluateStudentNewsCompliance(
        basePayload({
          sourceLink: bbcUrl,
          articleTitle:
            "How Pakistan won over Trump to become an unlikely mediator in the Iran war",
          byline: "Caroline Davies",
          articleDateline: "13 hours ago",
          leadSynopsis:
            "Pakistan has been making a diplomatic push to position itself as a negotiator in the war",
        }),
        {
          validationConfig: {
            allowedDomains: ["bbc.com"],
            thresholds: {
              articleTitle: 0.7,
              byline: 0.7,
              articleDateline: 0.7,
              leadSynopsis: 0.5,
            },
          },
        }
      )

      assert.equal(result.passed, true)
      assert.equal(result.failedFields.articleTitle, undefined)
      assert.equal(result.failedFields.byline, undefined)
      assert.equal(result.failedFields.articleDateline, undefined)
      assert.equal(
        result.details?.metadata?.title,
        "How Pakistan won over Trump to become an unlikely mediator in the Iran war"
      )
      assert.equal(result.details?.metadata?.byline, "Caroline Davies")
      assert.match(result.details?.metadata?.dateline?.combined || "", /\bhours?\s+ago\b/i)
      assert.ok(fetchCalls.some((url) => String(url).includes("r.jina.ai")))
    } finally {
      globalThis.fetch = originalFetch
    }
  }
)

test(
  "relative dateline allows same-day date and updated-today timestamp entries",
  { concurrency: false },
  async () => {
    const bbcUrl = "https://www.bbc.com/news/articles/cy91vrzxn34o"
    const nowIso = new Date().toISOString()
    const proxyMarkdown = [
      "Title: Iran war: How Pakistan became an unlikely mediator",
      "",
      "URL Source: https://www.bbc.com/news/articles/cy91vrzxn34o",
      "",
      `Published Time: ${nowIso}`,
      "",
      "Markdown Content:",
      "# How Pakistan won over Trump to become an unlikely mediator in the Iran war",
      "",
      "13 hours ago",
      "",
      "Caroline Davies Pakistan Correspondent",
      "",
      "Pakistan has been making a diplomatic push to position itself as a negotiator in the war",
    ].join("\n")
    const today = new Date()
    const todayDate = `${String(today.getFullYear()).padStart(4, "0")}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
    const datelineInputs = [todayDate, "Updated today 10:30 AM"]

    for (const datelineInput of datelineInputs) {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async (url) => {
        if (typeof url === "string" && url.includes("r.jina.ai")) {
          return new Response(proxyMarkdown, {
            status: 200,
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
        }
        return new Response("", { status: 503 })
      }

      try {
        const result = await evaluateStudentNewsCompliance(
          basePayload({
            sourceLink: bbcUrl,
            articleTitle:
              "How Pakistan won over Trump to become an unlikely mediator in the Iran war",
            byline: "Caroline Davies",
            articleDateline: datelineInput,
            leadSynopsis:
              "Pakistan has been making a diplomatic push to position itself as a negotiator in the war",
          }),
          {
            validationConfig: {
              allowedDomains: ["bbc.com"],
              thresholds: {
                articleTitle: 0.7,
                byline: 0.7,
                articleDateline: 0.7,
                leadSynopsis: 0.5,
              },
            },
          }
        )

        assert.equal(result.failedFields.articleDateline, undefined)
      } finally {
        globalThis.fetch = originalFetch
      }
    }
  }
)

test(
  "proxy parser ignores pre-content nav noise and accepts updated-relative dateline phrasing",
  { concurrency: false },
  async () => {
    const bbcUrl = "https://www.bbc.com/news/articles/cy91vrzxn34o"
    const proxyMarkdown = [
      "Title: Iran war: How Pakistan became an unlikely mediator",
      "URL Source: https://www.bbc.com/news/articles/cy91vrzxn34o",
      "Published Time: 2026-03-31T02:33:18.419Z",
      "",
      "Home",
      "News",
      "Share Save",
      "",
      "Markdown Content:",
      "# How Pakistan won over Trump to become an unlikely mediator in the Iran war",
      "",
      "Updated 9 hours ago",
      "",
      "By Caroline Davies, Pakistan Correspondent",
      "",
      "Pakistan has been making a diplomatic push to position itself as a negotiator in the war",
    ].join("\n")
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      if (typeof url === "string" && url.includes("r.jina.ai")) {
        return new Response(proxyMarkdown, {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      }
      return new Response("", { status: 503 })
    }
    try {
      const result = await evaluateStudentNewsCompliance(
        basePayload({
          sourceLink: bbcUrl,
          articleTitle:
            "How Pakistan won over Trump to become an unlikely mediator in the Iran war",
          byline: "Caroline Davies",
          articleDateline: "Updated 9 hours ago",
          leadSynopsis:
            "Pakistan has been making a diplomatic push to position itself as a negotiator in the war",
        }),
        {
          validationConfig: {
            allowedDomains: ["bbc.com"],
            thresholds: {
              articleTitle: 0.7,
              byline: 0.7,
              articleDateline: 0.7,
              leadSynopsis: 0.5,
            },
          },
        }
      )
      assert.equal(result.passed, true)
      assert.equal(result.failedFields.articleDateline, undefined)
      assert.equal(result.failedFields.byline, undefined)
      assert.equal(result.details?.metadata?.byline, "Caroline Davies")
      assert.match(result.details?.metadata?.dateline?.combined || "", /\b9\s+hours?\s+ago\b/i)
    } finally {
      globalThis.fetch = originalFetch
    }
  }
)

test(
  "primary html extraction avoids prose byline false positives and hidden-meta updated requirements",
  { concurrency: false },
  async () => {
    const bbcUrl = "https://www.bbc.com/news/articles/cy91vrzxn34o"
    const nowIso = new Date().toISOString()
    const articleTitle = "How Pakistan won over Trump to become an unlikely mediator in the Iran war"
    const html = `
<!doctype html>
<html>
  <head>
    <title>Iran war: How Pakistan became an unlikely mediator</title>
    <meta property="og:title" content="Iran war: How Pakistan became an unlikely mediator" />
    <meta property="article:published_time" content="${nowIso}" />
    <meta property="article:modified_time" content="${nowIso}" />
  </head>
  <body>
    <h1>${articleTitle}</h1>
    <div>9 hours ago</div>
    <p>Pakistan's role as intermediary in this conflict took many by surprise.</p>
    <p>Pakistan has been making a diplomatic push to position itself as a negotiator in the war.</p>
  </body>
</html>
`
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      if (typeof url === "string" && url.includes("r.jina.ai")) {
        return new Response("", { status: 503 })
      }
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    }

    try {
      const result = await evaluateStudentNewsCompliance(
        basePayload({
          sourceLink: bbcUrl,
          articleTitle,
          byline: "bbc",
          articleDateline: "9 hours ago",
          leadSynopsis: "Pakistan's role as intermediary in this conflict took many by surprise.",
        }),
        {
          validationConfig: {
            allowedDomains: ["bbc.com"],
            thresholds: {
              articleTitle: 0.7,
              byline: 0.7,
              articleDateline: 0.7,
              leadSynopsis: 0.5,
            },
          },
        }
      )

      assert.equal(result.passed, true)
      assert.equal(result.failedFields.articleTitle, undefined)
      assert.equal(result.failedFields.byline, undefined)
      assert.equal(result.failedFields.articleDateline, undefined)
      assert.ok(["primary", "bbc-amp"].includes(result.details?.metadata?.via))
      assert.equal(result.details?.metadata?.title, articleTitle)
      assert.equal(result.details?.metadata?.byline, "")
      assert.equal(result.details?.articleDateline?.requiresUpdatedToken, false)
    } finally {
      globalThis.fetch = originalFetch
    }
  }
)

test(
  "ISO datetime dateline metadata accepts same-day date input",
  { concurrency: false },
  async () => {
    const nowIso = new Date().toISOString()
    const todayDate = nowIso.slice(0, 10)
    const html = `
<!doctype html>
<html>
  <head>
    <title>Storms hit coast city</title>
    <meta property="article:published_time" content="${nowIso}" />
    <meta name="author" content="BBC" />
  </head>
  <body>
    <h1>Storms hit coast city</h1>
    <p>Officials said emergency teams evacuated hundreds of families after rising waters flooded multiple districts near the river.</p>
  </body>
</html>
`
    const result = await withMockedFetch(html, () =>
      evaluateStudentNewsCompliance(
        basePayload({
          articleDateline: todayDate,
          byline: "bbc",
        }),
        {
          validationConfig: {
            allowedDomains: ["bbc.com", "cnn.com"],
            thresholds: {
              articleTitle: 0.7,
              byline: 0.7,
              articleDateline: 0.7,
              leadSynopsis: 0.5,
            },
          },
        }
      )
    )

    assert.equal(result.failedFields.articleDateline, undefined)
    assert.ok(result.details?.articleDateline?.targetDateKeys?.includes(todayDate))
  }
)

test("compliance note block keeps manual text and marks fixed fields with required prefix", () => {
  const failed = {
    failedFields: {
      articleTitle: {
        message: "Article title does not closely match source title.",
        score: 0.42,
        threshold: 0.7,
      },
    },
    revisionTasks: [
      {
        field: "articleTitle",
        label: "Article Title",
        criterion: "Headline similarity must be at least 0.70.",
        steps: [
          "Copy the article headline exactly as displayed on the source page.",
        ],
      },
    ],
    config: {
      allowedDomains: ["bbc.com"],
    },
  }
  const first = updateStudentNewsValidationIssues({}, failed)
  const firstNote = mergeStudentNewsReviewNoteWithCompliance("Teacher note stays.", first.issues)
  assert.match(firstNote, /Teacher note stays\./)
  assert.match(firstNote, /\[PENDING\]\[articleTitle\]/)

  const passed = updateStudentNewsValidationIssues(first.issues, {
    failedFields: {},
    revisionTasks: [],
    config: { allowedDomains: ["bbc.com"] },
  })
  const secondNote = mergeStudentNewsReviewNoteWithCompliance(firstNote, passed.issues)
  assert.match(secondNote, /Teacher note stays\./)
  assert.match(secondNote, /\[FIXED\]\[articleTitle\]/)
  assert.match(secondNote, /FIXED PER COMPLIANCE RESOLUTION ON SAVE/)
})
