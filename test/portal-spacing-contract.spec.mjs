import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const sharedTheme = fs.readFileSync(new URL("../web-asset/shared/portal-theme.css", import.meta.url), "utf8")
const sharedButtonRule = sharedTheme.match(/\.portal-button,\na\.portal-button,\nsummary\.portal-button \{([\s\S]*?)\n\}/u)?.[1] || ""
const libraryAdmin = fs.readFileSync(new URL("../web-asset/admin/library-admin.html", import.meta.url), "utf8")
const agents = fs.readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8")
const docsIndex = fs.readFileSync(new URL("../docs/CODE-EDITING-DOCS-INDEX.md", import.meta.url), "utf8")

test("portal UI edits retain the indexed review and layout-sanity gates", () => {
  assert.match(agents, /Before every code edit, read `docs\/CODE-EDITING-DOCS-INDEX\.md`/)
  assert.match(agents, /Baseline layout sanity is mandatory across every portal/)
  assert.match(docsIndex, /### Baseline layout sanity gate/)
  assert.match(docsIndex, /authenticated browser at desktop and mobile widths for every affected portal/)
})

test("shared visible controls use standard vertical spacing", () => {
  assert.match(sharedTheme, /--portal-button-block-padding:\s*0\.5rem/)
  assert.match(sharedTheme, /--portal-button-line-height:\s*1\.2/)
  assert.match(sharedButtonRule, /padding:\s*var\(--portal-button-block-padding\)\s+var\(--portal-button-inline-padding\)/)
  assert.doesNotMatch(sharedButtonRule, /padding:\s*0\s+var\(--portal-button-inline-padding\)/)
})

test("Library content and pagination preserve vertical spacing and mobile controls", () => {
  assert.match(sharedTheme, /\.section-head\s*\{[\s\S]*?margin-bottom:\s*var\(--portal-content-gap\)/)
  assert.match(sharedTheme, /body\.student-portal-page \.library-toolbar\s*\{[\s\S]*?gap:\s*var\(--portal-content-gap\)/)
  assert.match(sharedTheme, /body\.student-portal-page \.library-results\s*\{[\s\S]*?gap:\s*var\(--portal-content-gap\)[\s\S]*?margin-top:\s*var\(--portal-content-gap\)/)
  assert.match(sharedTheme, /body\.student-portal-page \.library-pagination\s*\{[\s\S]*?flex-wrap:\s*wrap[\s\S]*?gap:\s*var\(--portal-content-gap\)[\s\S]*?justify-content:\s*center[\s\S]*?margin-block:\s*var\(--portal-content-gap\)[\s\S]*?padding-block:\s*4px/)
  assert.match(sharedTheme, /body\.student-portal-page \.library-pagination > \.portal-button\s*\{[\s\S]*?min-inline-size:\s*0/)
  assert.match(sharedTheme, /body\.admin-portal-page\.library-admin-page \.library-pagination\s*\{[\s\S]*?flex-wrap:\s*wrap[\s\S]*?gap:\s*var\(--portal-content-gap\)[\s\S]*?justify-content:\s*center[\s\S]*?margin-block:\s*var\(--portal-content-gap\)[\s\S]*?padding-block:\s*4px/)
})

test("Library review panes keep headings and editor groups separated", () => {
  assert.match(sharedTheme, /\.library-review-pane\s*\{[\s\S]*?align-content:\s*start;[\s\S]*?display:\s*grid;[\s\S]*?gap:\s*var\(--portal-content-gap\)[\s\S]*?padding:\s*var\(--portal-content-gap\)/)
  assert.match(sharedTheme, /\.library-review-pane > h3\s*\{[\s\S]*?border-block-end:\s*1px solid var\(--portal-border\);[\s\S]*?margin:\s*0;[\s\S]*?padding-block-end:\s*var\(--portal-content-gap\)/)
  assert.match(sharedTheme, /\.library-admin-toolbar\s*\{[\s\S]*?gap:\s*var\(--portal-content-gap\)[\s\S]*?margin-block-end:\s*var\(--portal-content-gap\)/)
  assert.match(sharedTheme, /\.library-admin-results\s*\{[\s\S]*?gap:\s*var\(--portal-content-gap\)[\s\S]*?margin-block-start:\s*var\(--portal-content-gap\)/)
})

test("formatted vocabulary definitions preserve readable flow spacing", () => {
  assert.match(sharedTheme, /--portal-definition-flow-gap:\s*12px;/)
  assert.match(sharedTheme, /\.new-word-entry-definition\s*\{[\s\S]*?line-height:\s*1\.45;/)
  assert.match(sharedTheme, /\.new-word-entry-definition ol,[\s\S]*?\.new-word-entry-definition ul\s*\{[\s\S]*?margin-block:\s*var\(--portal-definition-flow-gap\)/)
  assert.match(sharedTheme, /\.new-word-entry-definition :is\(section, \.new-word-entry-definition-body\)\s*\{[\s\S]*?margin-block:\s*var\(--portal-definition-flow-gap\)/)
  assert.match(sharedTheme, /\.new-word-entry-definition > section > strong\s*\{[\s\S]*?margin-block-end:\s*6px;/)
  assert.match(sharedTheme, /body\.student-portal-page \.news-vocabulary-definition-row textarea\s*\{[\s\S]*?line-height:\s*1\.45;/)
  assert.match(sharedTheme, /body\.admin-portal-page \.library-review-pane \.news-vocabulary-definition-row textarea\s*\{[\s\S]*?line-height:\s*1\.45;/)
})

test("portal content stacks keep the prefooter after main content with a 12px gap", () => {
  assert.match(sharedTheme, /--portal-page-stack-gap:\s*12px;/)
  assert.match(sharedTheme, /body\.admin-portal-page main\.library-admin-main\s*\{[\s\S]*?display:\s*grid;[\s\S]*?gap:\s*var\(--portal-shell-gap\);[\s\S]*?padding:\s*0;/)
  assert.match(libraryAdmin, /<main id="appMain"[\s\S]*?<\/main>\s*<section class="content portal-prefooter"[\s\S]*?<footer class="hub-footer"/)
  assert.doesNotMatch(libraryAdmin, /<main id="appMain"[\s\S]*<section class="content portal-prefooter"[\s\S]*?<\/main>/)
})
