import test from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"

process.env.NODE_ENV = "test"
process.env.DATABASE_URL = ""
process.env.STUDENT_ADMIN_STORE_ENABLED = "false"

import {
  findAdminUserForLogin,
  hasAdminUsersConfigured,
  verifyScryptPassword,
} from "../src/modules/admin/users.mjs"

function makeScryptHash(password, saltHex) {
  const digestHex = crypto
    .scryptSync(password, Buffer.from(saltHex, "hex"), 64)
    .toString("hex")
  return `scrypt$${saltHex}$${digestHex}`
}

test("verifyScryptPassword accepts valid scrypt hashes and rejects bad values", () => {
  const hash = makeScryptHash("correct horse battery staple", "00112233445566778899aabbccddeeff")
  assert.equal(verifyScryptPassword("correct horse battery staple", hash), true)
  assert.equal(verifyScryptPassword("wrong password", hash), false)
  assert.equal(verifyScryptPassword("correct horse battery staple", "not-a-valid-hash"), false)
})

test("admin user store reports disabled state for database-backed lookups", async () => {
  await assert.rejects(() => hasAdminUsersConfigured(), (error) => error?.statusCode === 503)
  await assert.rejects(() => findAdminUserForLogin("admin"), (error) => error?.statusCode === 503)
})
