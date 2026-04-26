import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const jsBeautifyConfigPath = path.resolve(process.cwd(), ".jsbeautifyrc")
const adminHtmlPath = path.resolve(process.cwd(), "web-asset/admin/student-admin.html")

const jsBeautifyConfig = JSON.parse(await fs.readFile(jsBeautifyConfigPath, "utf8"))
const adminHtml = await fs.readFile(adminHtmlPath, "utf8")

test("jsbeautify config keeps HTML attributes compact by default", () => {
  assert.equal(jsBeautifyConfig.html.wrap_attributes, "auto")
})

test("admin menu group tags stay compact in student-admin.html", () => {
  assert.match(adminHtml, /<div class="menu-group" data-menu-group="tracking">/)
  assert.match(adminHtml, /<div class="menu-group" data-menu-group="support">/)
  assert.match(adminHtml, /<div class="menu-group" data-menu-group="admin">/)
})
