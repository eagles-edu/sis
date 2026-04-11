import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

import yaml from "js-yaml"

const workflowPath = path.resolve(process.cwd(), ".github/workflows/eslint.yml")

const workflow = yaml.load(fs.readFileSync(workflowPath, "utf8"))

test("eslint workflow uses the repo ESLint toolchain and flat config", () => {
  assert.equal(workflow.name, "ESLint")
  assert.deepEqual(workflow.on.push.branches, ["split"])
  assert.deepEqual(workflow.on.pull_request.branches, ["split"])

  const steps = workflow.jobs.eslint.steps
  assert.equal(steps[0].uses, "actions/checkout@v5")
  assert.match(steps[1].run, /npm ci/)
  assert.match(steps[2].run, /npm install --no-save --package-lock=false @microsoft\/eslint-formatter-sarif@3\.1\.0/)
  assert.match(steps[3].run, /--config eslint\.config\.mjs/)
  assert.match(steps[3].run, /--format @microsoft\/eslint-formatter-sarif/)
  assert.equal(steps[3]["continue-on-error"], true)
  assert.equal(steps[4].uses, "github/codeql-action/upload-sarif@v3")
})
