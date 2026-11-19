import assert from "node:assert/strict"
import test from "node:test"
import { hashScryptPassword } from "../src/modules/admin/users.mjs"
import {
  resolveStandardParentCredentials,
  resolveStandardStudentCredentials,
  STANDARD_PARENT_LOGIN,
  STANDARD_STUDENT_LOGIN,
} from "./helpers/standard-portal-credentials.mjs"

test("standard student credentials select only mark001", () => {
  const credentials = resolveStandardStudentCredentials({
    STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON: JSON.stringify([
      { eaglesId: "other-student", password: "other-pass", status: "active" },
      { eaglesId: STANDARD_STUDENT_LOGIN, password: "mark-pass", status: "active" },
    ]),
  })

  assert.deepEqual(credentials, { user: STANDARD_STUDENT_LOGIN, pass: "mark-pass" })
})

test("standard parent credentials select only cmmark001", () => {
  const credentials = resolveStandardParentCredentials({
    STUDENT_PARENT_PORTAL_ACCOUNTS_JSON: JSON.stringify([
      { parentsId: "other-parent", password: "other-pass", status: "active" },
      { parentsId: STANDARD_PARENT_LOGIN, password: "parent-pass", status: "active" },
    ]),
  })

  assert.deepEqual(credentials, { user: STANDARD_PARENT_LOGIN, pass: "parent-pass" })
})

test("standard parent credentials verify the environment password against the exact account hash", () => {
  const credentials = resolveStandardParentCredentials({
    STUDENT_PARENT_USER: "another-parent",
    STUDENT_PARENT_PASS: "shared-parent-pass",
    STUDENT_PARENT_PORTAL_ACCOUNTS_JSON: JSON.stringify([
      {
        parentsId: STANDARD_PARENT_LOGIN,
        passwordHash: hashScryptPassword("shared-parent-pass"),
        status: "active",
      },
    ]),
  })

  assert.deepEqual(credentials, { user: STANDARD_PARENT_LOGIN, pass: "shared-parent-pass" })
})

test("standard parent credentials reject a direct password that does not match the exact account hash", () => {
  assert.deepEqual(resolveStandardParentCredentials({
    STUDENT_PARENT_USER: "another-parent",
    STUDENT_PARENT_PASS: "different-parent-pass",
    STUDENT_PARENT_PORTAL_ACCOUNTS_JSON: JSON.stringify([
      {
        parentsId: STANDARD_PARENT_LOGIN,
        passwordHash: hashScryptPassword("shared-parent-pass"),
        status: "active",
      },
    ]),
  }), { user: "", pass: "" })
})

test("standard portal credential resolution fails closed when the named account is absent", () => {
  assert.deepEqual(resolveStandardStudentCredentials({
    STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON: JSON.stringify([
      { eaglesId: "other-student", password: "other-pass", status: "active" },
    ]),
  }), { user: "", pass: "" })
  assert.deepEqual(resolveStandardParentCredentials({
    STUDENT_PARENT_PORTAL_ACCOUNTS_JSON: JSON.stringify([
      { parentsId: "other-parent", password: "other-pass", status: "active" },
    ]),
  }), { user: "", pass: "" })
})

test("standard portal credentials ignore direct credentials for other accounts", () => {
  assert.deepEqual(resolveStandardStudentCredentials({
    STUDENT_STUDENT_USER: "other-student",
    STUDENT_STUDENT_PASS: "other-pass",
  }), { user: "", pass: "" })
  assert.deepEqual(resolveStandardParentCredentials({
    STUDENT_PARENT_USER: "other-parent",
    STUDENT_PARENT_PASS: "other-pass",
  }), { user: "", pass: "" })
})

test("standard portal credentials accept direct env values only for the named accounts", () => {
  assert.deepEqual(resolveStandardStudentCredentials({
    STUDENT_STUDENT_USER: STANDARD_STUDENT_LOGIN,
    STUDENT_STUDENT_PASS: "mark-pass",
  }), { user: STANDARD_STUDENT_LOGIN, pass: "mark-pass" })
  assert.deepEqual(resolveStandardParentCredentials({
    STUDENT_PARENT_USER: STANDARD_PARENT_LOGIN,
    STUDENT_PARENT_PASS: "parent-pass",
  }), { user: STANDARD_PARENT_LOGIN, pass: "parent-pass" })
})
