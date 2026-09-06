import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const packageJsonPath = path.resolve(process.cwd(), "package.json")
const packageLockPath = path.resolve(process.cwd(), "package-lock.json")

test("mysql2 override uses a Dependabot security-patched version", () => {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"))
  const mysql2Version = packageLock.packages["node_modules/mysql2"].version

  assert.equal(packageJson.overrides.mysql2, "^3.22.0")
  assert.match(mysql2Version, /^3\.(2[2-9]|[3-9]\d)\.\d+$/)
})
