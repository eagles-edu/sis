import test from "node:test"
import assert from "node:assert/strict"

import { applyImportIdentityDefaults } from "../server/student-admin-store.mjs"

test("applyImportIdentityDefaults auto-fills blank eaglesId and studentNumber for new rows", () => {
  const result = applyImportIdentityDefaults(
    [
      { eaglesId: "", studentNumber: "" },
      { eaglesId: "", studentNumber: 230 },
      { eaglesId: "SIS-000150", studentNumber: "" },
    ],
    {
      existingRows: [
        { eaglesId: "SIS-000120", studentNumber: 120 },
        { eaglesId: "SIS-000150", studentNumber: 150 },
      ],
      studentNumberStart: 100,
    }
  )

  assert.equal(result.autoFilledEaglesIds, 2)
  assert.equal(result.autoFilledStudentNumbers, 1)

  assert.equal(result.rows[0].studentNumber, 231)
  assert.equal(result.rows[0].eaglesId, "SIS-000231")

  assert.equal(result.rows[1].studentNumber, 230)
  assert.equal(result.rows[1].eaglesId, "SIS-000230")

  assert.equal(result.rows[2].eaglesId, "SIS-000150")
  assert.equal(result.rows[2].studentNumber, "")
})

test("applyImportIdentityDefaults keeps explicit eaglesId and allocates missing studentNumber for new explicit ids", () => {
  const result = applyImportIdentityDefaults(
    [{ eaglesId: "CUSTOM-1", studentNumber: "" }],
    {
      existingRows: [],
      studentNumberStart: 100,
    }
  )

  assert.equal(result.autoFilledEaglesIds, 0)
  assert.equal(result.autoFilledStudentNumbers, 1)
  assert.equal(result.rows[0].eaglesId, "CUSTOM-1")
  assert.equal(result.rows[0].studentNumber, 100)
})

test("applyImportIdentityDefaults avoids eaglesId collisions for generated ids", () => {
  const result = applyImportIdentityDefaults(
    [{ eaglesId: "", studentNumber: 100 }],
    {
      existingRows: [{ eaglesId: "SIS-000100", studentNumber: 100 }],
      studentNumberStart: 100,
    }
  )

  assert.equal(result.autoFilledEaglesIds, 1)
  assert.equal(result.autoFilledStudentNumbers, 0)
  assert.equal(result.rows[0].studentNumber, 100)
  assert.equal(result.rows[0].eaglesId, "SIS-000100-2")
})
