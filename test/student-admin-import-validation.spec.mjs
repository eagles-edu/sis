import test from "node:test"
import assert from "node:assert/strict"

import { validateImportRowsForIdentity } from "../server/student-admin-store.mjs"

test("validateImportRowsForIdentity strict mode rejects blank, duplicate, and immutable identity conflicts", () => {
  const result = validateImportRowsForIdentity(
    [
      { eaglesId: "", studentNumber: "", profile: { fullName: "Row One" } },
      { eaglesId: "ABC001", studentNumber: 101, profile: { fullName: "Row Two" } },
      { eaglesId: "abc001", studentNumber: 102, profile: { fullName: "Row Three" } },
      { eaglesId: "NEW004", studentNumber: 101, profile: { fullName: "Row Four" } },
      { eaglesId: "EXISTING01", studentNumber: 777, profile: { fullName: "Row Five" } },
      { eaglesId: "UNIQUE01", studentNumber: 999, profile: { fullName: "Row Six" } },
    ],
    {
      existingRows: [
        { eaglesId: "existing01", studentNumber: 888 },
        { eaglesId: "existing99", studentNumber: 999 },
      ],
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
  assert.match(result.errors[4].message, /does not match existing eaglesId/i)
  assert.match(result.errors[5].message, /already exists in database/i)
})

test("validateImportRowsForIdentity strict mode accepts explicit non-conflicting identity keys", () => {
  const inputRows = [
    { eaglesId: "RAY001", studentNumber: 220, profile: { fullName: "Ray One" } },
    { eaglesId: "RAY002", studentNumber: 221, profile: { fullName: "Ray Two" } },
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

test("validateImportRowsForIdentity strict mode allows existing eaglesId rows for re-import backfill", () => {
  const result = validateImportRowsForIdentity(
    [
      { eaglesId: "EXISTING01", studentNumber: 888, profile: { fullName: "Keep Number Match" } },
      { eaglesId: "EXISTING02", studentNumber: "", profile: { fullName: "Blank Number Still Allowed" } },
    ],
    {
      existingRows: [
        { eaglesId: "existing01", studentNumber: 888 },
        { eaglesId: "existing02", studentNumber: 889 },
      ],
      requireExplicitIdentity: true,
    }
  )

  assert.equal(result.requireExplicitIdentity, true)
  assert.equal(result.errors.length, 0)
})

test("validateImportRowsForIdentity strict mode allows blank studentNumber when eaglesId is explicit", () => {
  const result = validateImportRowsForIdentity(
    [
      { eaglesId: "RAY101", studentNumber: "", profile: { fullName: "Ray Missing Number" } },
      { eaglesId: "RAY102", studentNumber: 221, profile: { fullName: "Ray With Number" } },
    ],
    {
      existingRows: [{ eaglesId: "LEGACY001", studentNumber: 100 }],
      requireExplicitIdentity: true,
    }
  )

  assert.equal(result.requireExplicitIdentity, true)
  assert.equal(result.errors.length, 0)
})

test("validateImportRowsForIdentity compatibility mode retains autofill behavior", () => {
  const result = validateImportRowsForIdentity(
    [
      { eaglesId: "", studentNumber: "", profile: { fullName: "Compat One" } },
      { eaglesId: "", studentNumber: 230, profile: { fullName: "Compat Two" } },
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

test("validateImportRowsForIdentity does not require fullName when identity keys are valid", () => {
  const result = validateImportRowsForIdentity(
    [
      { eaglesId: "FULL001", studentNumber: 310, profile: { fullName: "" } },
      { eaglesId: "FULL002", studentNumber: 311 },
    ],
    {
      existingRows: [],
      requireExplicitIdentity: true,
    }
  )

  assert.equal(result.errors.length, 0)
})
