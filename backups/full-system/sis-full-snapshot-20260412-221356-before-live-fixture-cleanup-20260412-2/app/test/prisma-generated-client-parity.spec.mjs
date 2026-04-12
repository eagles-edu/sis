import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8")
}

function extractModelBlock(schemaText, modelName) {
  const modelPattern = new RegExp(`model\\s+${modelName}\\s+\\{([\\s\\S]*?)\\n\\}`)
  const match = schemaText.match(modelPattern)
  return match ? match[1] : ""
}

function assertModelFields(modelName, schemaText, expectedFields) {
  const block = extractModelBlock(schemaText, modelName)
  assert.ok(block, `${modelName} model is missing from schema`)

  expectedFields.forEach((fieldName) => {
    const fieldPattern = new RegExp(`\\n\\s*${fieldName}\\b`)
    assert.match(
      block,
      fieldPattern,
      `${modelName}.${fieldName} is missing from generated Prisma client schema`
    )
  })
}

test("generated Prisma client schema keeps student-news review and validation fields", () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(testDir, "..")

  const canonicalSchemaPath = path.join(repoRoot, "prisma", "schema.prisma")
  const generatedSchemaPath = path.join(repoRoot, "node_modules", ".prisma", "client", "schema.prisma")

  assert.ok(fs.existsSync(canonicalSchemaPath), "canonical Prisma schema is missing")
  assert.ok(
    fs.existsSync(generatedSchemaPath),
    "generated Prisma client schema is missing; run `npm run db:generate`"
  )

  const canonicalSchema = readText(canonicalSchemaPath)
  const generatedSchema = readText(generatedSchemaPath)

  assertModelFields("StudentNewsReport", canonicalSchema, [
    "reviewStatus",
    "reviewNote",
    "validationIssuesJson",
    "reviewedAt",
    "reviewedByUsername",
  ])

  assertModelFields("StudentNewsReport", generatedSchema, [
    "reviewStatus",
    "reviewNote",
    "validationIssuesJson",
    "reviewedAt",
    "reviewedByUsername",
  ])
})
