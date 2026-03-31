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
