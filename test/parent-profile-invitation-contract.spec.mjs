import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const invitations = fs.readFileSync(path.resolve(rootDir, "src/modules/admin/parent-profile-invitations.mjs"), "utf8")
const routes = fs.readFileSync(path.resolve(rootDir, "server/student-admin-routes.mjs"), "utf8")

test("parent invitation emails use a tracker-safe route and one-click activation", () => {
  assert.match(invitations, /function invitationUrl\(token\) \{ return `\$\{publicOrigin\(\)\}\/parent\/profile-invitations\/\$\{encodeURIComponent\(token\)\}` \}/)
  assert.doesNotMatch(invitations, /Activation code|activationCode/)
  assert.match(routes, /next\.searchParams\.set\("activate", decodeURIComponent\(invitationLinkMatch\[1\]\)\)/)
  assert.match(routes, /PARENT_ACTIVATION_RECOVERY_PATH/)
})
