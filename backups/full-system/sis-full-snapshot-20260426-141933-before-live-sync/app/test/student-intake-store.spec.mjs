import test from "node:test"
import assert from "node:assert/strict"

process.env.NODE_ENV = "test"
process.env.DATABASE_URL = ""
process.env.STUDENT_INTAKE_STORE_ENABLED = "false"

const { persistStudentIntakeSubmission } = await import(
  "../src/modules/intake/student-intake-store.mjs"
)

test("persistStudentIntakeSubmission returns disabled when the intake store is off", async () => {
  const result = await persistStudentIntakeSubmission({
    sourceFormId: "cf3",
    sourceUrl: "https://example.com/form",
  })

  assert.equal(result.saved, false)
  assert.equal(result.reason, "disabled")
})
