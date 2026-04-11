import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"

import yaml from "js-yaml"

const workflowPath = path.resolve(process.cwd(), ".github/workflows/eslint.yml")
const eslintConfigPath = path.resolve(process.cwd(), "eslint.config.mjs")

const workflow = yaml.load(fs.readFileSync(workflowPath, "utf8"))
const eslintConfig = (await import(pathToFileURL(eslintConfigPath).href)).default

test("eslint workflow uses the repo ESLint toolchain and flat config", () => {
  assert.equal(workflow.name, "ESLint")
  assert.deepEqual(workflow.on.push.branches, ["split"])
  assert.deepEqual(workflow.on.pull_request.branches, ["split"])
  assert.ok(eslintConfig[0].ignores.includes("web-asset/vendor/"))

  const steps = workflow.jobs.eslint.steps
  assert.equal(steps[0].uses, "actions/checkout@v5")
  assert.match(steps[1].run, /npm ci/)
  assert.match(steps[2].run, /npm install --no-save --package-lock=false @microsoft\/eslint-formatter-sarif@3\.1\.0/)
  assert.match(steps[3].run, /--config eslint\.config\.mjs/)
  assert.match(steps[3].run, /\bserver\b/)
  assert.match(steps[3].run, /\btest\b/)
  assert.match(steps[3].run, /\btools\b/)
  assert.match(steps[3].run, /web-asset\/admin/)
  assert.match(steps[3].run, /--format @microsoft\/eslint-formatter-sarif/)
  assert.equal(steps[3]["continue-on-error"], true)
  assert.equal(steps[4].uses, "github/codeql-action/upload-sarif@v3")
})
