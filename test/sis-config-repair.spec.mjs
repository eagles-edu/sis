import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import test from "node:test"

const cronScriptPath = path.resolve(process.cwd(), "tools/install-sis-config-cron.sh")
const repairScriptPath = path.resolve(process.cwd(), "tools/sis-config-repair.mjs")

test("install-sis-config-cron.sh check-only output includes an explicit node binary path", () => {
  const output = execFileSync(cronScriptPath, ["--check-only"], {
    encoding: "utf8",
  })

  assert.match(output, /cd .*sis && DOTENV_CONFIG_PATH=.* \/.*node -r dotenv\/config tools\/sis-config-repair\.mjs >> .*sis-config-repair-cron\.log 2>&1 # sis-config-repair/)
})

test("install-sis-config-cron.sh reports an error when node cannot be resolved", () => {
  const bashPath = execFileSync("which", ["bash"], { encoding: "utf8" }).trim()
  const dirnamePath = execFileSync("which", ["dirname"], { encoding: "utf8" }).trim()
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "sis-config-repair-bin-"))
  fs.symlinkSync(bashPath, path.join(binDir, "bash"))
  fs.symlinkSync(dirnamePath, path.join(binDir, "dirname"))

  const env = { ...process.env, PATH: binDir }
  delete env.SIS_NODE_BIN

  let error
  try {
    execFileSync(
      "bash",
      [cronScriptPath, "--check-only"],
      {
        env,
        encoding: "utf8",
      },
    )
    assert.fail("Expected the cron installer to fail when node is not available")
  } catch (err) {
    error = err
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true })
  }

  assert.ok(error)
  assert.equal(error.status, 1)
  assert.match(error.stderr.toString(), /node binary not found/)
})

test("sis-config-repair.mjs logs an ISO timestamp prefix on successful sync", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sis-config-repair-"))
  const sisConfigPath = path.join(tempDir, "SIS_CONFIG.json")
  fs.writeFileSync(
    sisConfigPath,
    JSON.stringify(
      {
        uiSettings: {
          schoolSetup: {
            schoolYear: "2026-2027",
            startDate: "2026-02-21",
            endDate: "2027-01-24",
            quarters: [
              { quarter: "q1", startDate: "2026-02-21", endDate: "2026-05-15" },
            ],
            schoolSetupState: "ok",
          },
        },
        runtime: {
          databaseUrl: "postgresql://user:pass@localhost:5432/sis",
        },
        newsReports: {
          weeklyMinimumReports: 5,
          autoApproveEnabled: true,
          autoApproveDelayHours: 16,
        },
        updatedAt: "2026-05-01T00:00:00.000Z",
        updatedBy: "test",
      },
      null,
      2,
    ),
    "utf8",
  )

  try {
    const env = {
      ...process.env,
      NODE_ENV: "development",
      SIS_CONFIG_FILE: sisConfigPath,
      DATABASE_URL: "postgresql://user:pass@localhost:5432/sis",
    }
    const output = execFileSync(process.execPath, [repairScriptPath], {
      env,
      encoding: "utf8",
      timeout: 10000,
    })

    assert.match(output, /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[sis-config-repair\] synced /m)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
