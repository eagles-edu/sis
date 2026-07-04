import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()

function read(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), "utf8")
}

function normalizeText(value) {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
}

function extractNavMarkup(source) {
  const navMatch = source.match(/<nav class="menu-groups[^"]*" id="navMenu"[\s\S]*?<\/nav>/)
  assert.ok(navMatch, "expected navMenu markup")
  return navMatch[0]
}

function extractNavMenuSignature(source) {
  const navMarkup = extractNavMarkup(source)
  const topLinks = Array.from(
    navMarkup.matchAll(/<a[^>]*class="menu-link menu-link-top(?: active)?"[^>]*href="([^"]+)"[^>]*data-page-link="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
    ([, href, pageLink, text]) => ({ href, pageLink, text: normalizeText(text) }),
  )
  const groups = Array.from(
    navMarkup.matchAll(
      /<div class="menu-group(?: expanded)?"[^>]*data-menu-group="([^"]+)"[^>]*>[\s\S]*?<button[^>]*class="menu-group-btn"[^>]*>([\s\S]*?)<\/button>[\s\S]*?<div class="menu-group-links">([\s\S]*?)<\/div>\s*<\/div>/g,
    ),
    ([, key, label, body]) => ({
      key,
      label: normalizeText(label),
      links: Array.from(
        body.matchAll(/<a[^>]*href="([^"]+)"[^>]*data-page-link="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
        ([, href, pageLink, text]) => ({ href, pageLink, text: normalizeText(text) }),
      ),
    }),
  )
  return { topLinks, groups }
}

test("standalone admin html files keep the canonical mobile menu signature", () => {
  const expected = extractNavMenuSignature(read("web-asset/admin/student-admin.html"))
  const actualByFile = {
    "web-asset/admin/student-enrollment.html": extractNavMenuSignature(
      read("web-asset/admin/student-enrollment.html"),
    ),
    "web-asset/admin/grades-tabulator.html": extractNavMenuSignature(
      read("web-asset/admin/grades-tabulator.html"),
    ),
    "web-asset/admin/report-card.html": extractNavMenuSignature(
      read("web-asset/admin/report-card.html"),
    ),
  }

  for (const [filePath, actual] of Object.entries(actualByFile)) {
    assert.deepEqual(actual, expected, `${filePath} should match student-admin mobile menu structure`)
  }
})
