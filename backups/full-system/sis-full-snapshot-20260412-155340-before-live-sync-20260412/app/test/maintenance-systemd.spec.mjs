import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import path from "node:path"

test("maintenance systemd installer renders all unit templates in check-only mode", () => {
  const scriptPath = path.resolve(process.cwd(), "tools/install-maintenance-systemd.sh")
  const output = execFileSync(
    scriptPath,
    [
      "--check-only",
      "--runtime-root",
      "/tmp/sis-runtime",
      "--env-file",
      "/tmp/sis-runtime/.env",
      "--install-dir",
      "/tmp/systemd",
    ],
    { encoding: "utf8" },
  )

  assert.match(output, /sis-incoming-vacuum\.service/)
  assert.match(output, /sis-incoming-vacuum\.timer/)
  assert.match(output, /sis-db-backup\.service/)
  assert.match(output, /sis-db-backup\.timer/)
  assert.match(output, /sis-db-health\.service/)
  assert.match(output, /sis-db-health\.timer/)
  assert.match(output, /WorkingDirectory=\/tmp\/sis-runtime/)
  assert.match(output, /EnvironmentFile=\/tmp\/sis-runtime\/\.env/)
})
