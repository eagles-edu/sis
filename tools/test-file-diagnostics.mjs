#!/usr/bin/env node

import { spawnSync } from "node:child_process"

const args = process.argv.slice(2)
if (!args.length || args.includes("--help")) {
  console.error("usage: npm run test:file:diagnose -- test/example.spec.mjs [node-test-options]")
  process.exit(args.includes("--help") ? 0 : 2)
}

const result = spawnSync(process.execPath, ["--test", ...args], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "pipe"],
})

const output = `${result.stdout || ""}${result.stderr || ""}`
process.stdout.write(output)

const failures = []
const lines = output.split(/\r?\n/)
for (let index = 0; index < lines.length; index += 1) {
  const match = lines[index].match(/^not ok \d+ - (.+)$/)
  if (!match) continue

  let location = "location unavailable"
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const locationMatch = lines[cursor].match(/^\s*location: '([^']+)'$/)
    if (locationMatch) {
      location = locationMatch[1]
      break
    }
    if (/^# Subtest: |^not ok \d+ - /.test(lines[cursor])) break
  }
  failures.push({ name: match[1], location })
}

if (failures.length) {
  console.error(`\nFailing subtests (${failures.length}):`)
  for (const failure of failures) {
    console.error(`- ${failure.name} (${failure.location})`)
  }
} else if (result.status === 0) {
  console.error("\nAll subtests in the requested file passed.")
}

process.exit(result.status ?? 1)
