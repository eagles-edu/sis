import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

// Prisma 7.10.0 pins mysql2@3.15.3, which Dependabot cannot patch without a root override.
const MIN_PATCHED_MYSQL2_VERSION = "3.22.0"

function compareVersions(a, b) {
  const aParts = a.split(".").map(Number)
  const bParts = b.split(".").map(Number)
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

test("root package.json pins a security-patched mysql2 override", () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(testDir, "..")
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))

  const override = packageJson.overrides && packageJson.overrides.mysql2
  assert.ok(override, "package.json overrides.mysql2 is missing")

  const overrideFloor = override.replace(/^[\^~>=]+/, "")
  assert.ok(
    compareVersions(overrideFloor, MIN_PATCHED_MYSQL2_VERSION) >= 0,
    `mysql2 override floor ${overrideFloor} must be >= ${MIN_PATCHED_MYSQL2_VERSION}`
  )
})

test("package-lock.json resolves mysql2 to a security-patched version", () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(testDir, "..")
  const lockFile = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"))

  const entry = lockFile.packages && lockFile.packages["node_modules/mysql2"]
  assert.ok(entry, "package-lock.json is missing the mysql2 install entry")

  assert.ok(
    compareVersions(entry.version, MIN_PATCHED_MYSQL2_VERSION) >= 0,
    `resolved mysql2 ${entry.version} must be >= ${MIN_PATCHED_MYSQL2_VERSION}`
  )
})
