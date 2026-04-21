import test from "node:test"
import assert from "node:assert/strict"

import {
  MOODLE_INTEGRATION_SOURCE,
  MOODLE_SIGNATURE_MAX_AGE_MS,
  buildMoodleRequestSignature,
  verifyMoodleRequestSignature,
} from "../src/modules/exercises/moodle-sync.mjs"

test("buildMoodleRequestSignature signs the raw body with the timestamp", () => {
  const timestamp = "1713355200"
  const rawBody = JSON.stringify({
    eaglesId: "moodle-user-1",
    sourceSystem: MOODLE_INTEGRATION_SOURCE,
    sourceAttemptId: "attempt-1",
  })

  const signature = buildMoodleRequestSignature(timestamp, rawBody, "shared-secret")

  assert.match(signature, /^[a-f0-9]{64}$/)
  const verification = verifyMoodleRequestSignature({
    source: MOODLE_INTEGRATION_SOURCE,
    timestamp,
    signature,
    rawBody,
    sharedSecret: "shared-secret",
    now: Number(timestamp) * 1000,
    maxAgeMs: MOODLE_SIGNATURE_MAX_AGE_MS,
  })
  assert.equal(verification.ok, true)
})

test("verifyMoodleRequestSignature rejects stale requests", () => {
  const timestamp = "1713355200"
  const rawBody = JSON.stringify({ eaglesId: "moodle-user-1" })
  const signature = buildMoodleRequestSignature(timestamp, rawBody, "shared-secret")

  const verification = verifyMoodleRequestSignature({
    source: MOODLE_INTEGRATION_SOURCE,
    timestamp,
    signature,
    rawBody,
    sharedSecret: "shared-secret",
    now: (Number(timestamp) * 1000) + MOODLE_SIGNATURE_MAX_AGE_MS + 1,
    maxAgeMs: MOODLE_SIGNATURE_MAX_AGE_MS,
  })

  assert.equal(verification.ok, false)
  assert.equal(verification.reason, "stale-request")
})

test("verifyMoodleRequestSignature rejects invalid signatures", () => {
  const verification = verifyMoodleRequestSignature({
    source: MOODLE_INTEGRATION_SOURCE,
    timestamp: "1713355200",
    signature: "deadbeef",
    rawBody: JSON.stringify({ eaglesId: "moodle-user-1" }),
    sharedSecret: "shared-secret",
    now: 1713355200 * 1000,
    maxAgeMs: MOODLE_SIGNATURE_MAX_AGE_MS,
  })

  assert.equal(verification.ok, false)
  assert.equal(verification.reason, "invalid-signature")
})
