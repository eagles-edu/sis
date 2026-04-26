import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const packageJsonPath = path.resolve(process.cwd(), "package.json")
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))

test("html lint script covers admin, hub, parent, and student portals", () => {
  assert.equal(
    packageJson.scripts["lint:html"],
    "html-validate web-asset/admin/student-admin.html web-asset/admin/portal-hub.html web-asset/parent/parent-portal.html web-asset/student/student-portal.html web-asset/student/fi.html",
  )
})
