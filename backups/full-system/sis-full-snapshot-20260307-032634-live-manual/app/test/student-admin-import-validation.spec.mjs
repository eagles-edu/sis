import test from "node:test"
import assert from "node:assert/strict"

import { validateImportRowsForIdentity } from "../server/student-admin-store.mjs"

test("validateImportRowsForIdentity strict mode rejects blank, duplicate, and existing identity keys", () => {
  const result = validateImportRowsForIdentity(
    [
      { eaglesId: "", studentNumber: "" },
      { eaglesId: "ABC001", studentNumber: 101 },
      { eaglesId: "abc001", studentNumber: 102 },
      { eaglesId: "NEW004", studentNumber: 101 },
      { eaglesId: "EXISTING01", studentNumber: 888 },
      { eaglesId: "UNIQUE01", studentNumber: 999 },
    ],
    {
      existingRows: [{ eaglesId: "existing01", studentNumber: 999 }],
      requireExplicitIdentity: true,
    }
  )

  assert.equal(result.requireExplicitIdentity, true)
  assert.equal(result.autoFilledEaglesIds, 0)
  assert.equal(result.autoFilledStudentNumbers, 0)

  const rowNumbers = result.errors.map((entry) => entry.rowNumber)
  assert.deepEqual(rowNumbers, [1, 2, 3, 4, 5, 6])
  assert.match(result.errors[0].message, /eaglesId is required/i)
  assert.match(result.errors[1].message, /duplicate eaglesId/i)
  assert.match(result.errors[3].message, /duplicate studentNumber/i)
  assert.match(result.errors[4].message, /already exists in database/i)
  assert.match(result.errors[5].message, /already exists in database/i)
})

test("validateImportRowsForIdentity strict mode accepts explicit non-conflicting identity keys", () => {
  const inputRows = [
    { eaglesId: "RAY001", studentNumber: 220 },
    { eaglesId: "RAY002", studentNumber: 221 },
  ]

  const result = validateImportRowsForIdentity(inputRows, {
    existingRows: [{ eaglesId: "LEGACY001", studentNumber: 100 }],
    requireExplicitIdentity: true,
  })

  assert.equal(result.requireExplicitIdentity, true)
  assert.equal(result.errors.length, 0)
  assert.deepEqual(result.rows, inputRows)
  assert.equal(result.autoFilledEaglesIds, 0)
  assert.equal(result.autoFilledStudentNumbers, 0)
})

test("validateImportRowsForIdentity compatibility mode retains autofill behavior", () => {
  const result = validateImportRowsForIdentity(
    [
      { eaglesId: "", studentNumber: "" },
      { eaglesId: "", studentNumber: 230 },
    ],
    {
      existingRows: [{ eaglesId: "SIS-000229", studentNumber: 229 }],
      studentNumberStart: 100,
      requireExplicitIdentity: false,
    }
  )

  assert.equal(result.requireExplicitIdentity, false)
  assert.equal(result.errors.length, 0)
  assert.equal(result.autoFilledEaglesIds, 2)
  assert.equal(result.autoFilledStudentNumbers, 1)
  assert.equal(result.rows[0].studentNumber, 231)
  assert.equal(result.rows[0].eaglesId, "SIS-000231")
  assert.equal(result.rows[1].studentNumber, 230)
  assert.equal(result.rows[1].eaglesId, "SIS-000230")
})
