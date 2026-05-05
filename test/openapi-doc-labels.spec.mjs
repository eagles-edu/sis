import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("generated OpenAPI docs do not use label tags as structural wrappers", () => {
  const html = readFileSync("docs/mapping/out/sis-admin.openapi.html", "utf8")
  const labels = html.match(/<label\b/gi) ?? []

  assert.equal(
    labels.length,
    0,
    "docs/mapping/out/sis-admin.openapi.html should not contain nonform label wrappers"
  )
})
