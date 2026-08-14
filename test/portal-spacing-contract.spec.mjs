import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const sharedTheme = fs.readFileSync(new URL("../web-asset/shared/portal-theme.css", import.meta.url), "utf8")
const sharedButtonRule = sharedTheme.match(/\.portal-button,\na\.portal-button,\nsummary\.portal-button \{([\s\S]*?)\n\}/u)?.[1] || ""

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
  assert.match(sharedTheme, /body\.student-portal-page \.library-pagination\s*\{[\s\S]*?flex-wrap:\s*wrap[\s\S]*?gap:\s*var\(--portal-content-gap\)[\s\S]*?margin-top:\s*var\(--portal-content-gap\)/)
  assert.match(sharedTheme, /body\.student-portal-page \.library-pagination > \.portal-button\s*\{[\s\S]*?min-inline-size:\s*0/)
})
