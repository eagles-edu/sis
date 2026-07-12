import assert from "node:assert/strict"
import fs from "node:fs/promises"
import postcss from "postcss"
import test from "node:test"

import { extractCriticalCss } from "../tools/extract-critical-css.mjs"

const htmlPath = "web-asset/admin/student-admin.html"
const criticalPath = "web-asset/admin/student-admin.critical.css"

test("generated admin critical CSS is parseable and ID-scoped", async () => {
  const html = await fs.readFile(htmlPath, "utf8")
  const css = await fs.readFile(criticalPath, "utf8")
  const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/giu)].map((match) => match[1]))
  const root = postcss.parse(css)
  let ruleCount = 0

  root.walkRules((rule) => {
    ruleCount += 1
    const selectorIds = [...rule.selector.matchAll(/#[A-Za-z_][\w-]*/gu)].map((match) => match[0].slice(1))
    assert.ok(selectorIds.some((id) => ids.has(id)), `critical selector is not tied to an HTML ID: ${rule.selector}`)
  })

  assert.ok(ruleCount > 0)
})

test("extractor keeps source CSS unchanged and preserves complete rule nodes", async () => {
  const html = await fs.readFile(htmlPath, "utf8")
  const source = await fs.readFile("web-asset/admin/student-admin.css", "utf8")
  const result = extractCriticalCss(source, html)
  const sourceRoot = postcss.parse(source)
  const extractedRoot = postcss.parse(result.css)
  const sourceSelectors = new Set()
  sourceRoot.walkRules((rule) => sourceSelectors.add(rule.selector))

  extractedRoot.walkRules((rule) => {
    assert.ok(sourceSelectors.has(rule.selector), `critical selector was not copied as a complete source rule: ${rule.selector}`)
  })
  assert.equal(await fs.readFile("web-asset/admin/student-admin.css", "utf8"), source)
})
