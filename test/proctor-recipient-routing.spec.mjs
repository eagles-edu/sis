import test from "node:test"
import assert from "node:assert/strict"

import { parentProctorEmails } from "../src/modules/admin/proctor-recipient-routing.mjs"

test("both parents can be selected as simultaneous email proctors", () => {
  assert.deepEqual(
    parentProctorEmails({
      motherEmail: "mother@example.test",
      maIsHomeworkProctor: "true",
      fatherEmail: "father@example.test",
      baIsHomeworkProctor: "yes",
    }),
    ["mother@example.test", "father@example.test"],
  )
})

test("an explicitly unchecked parent is excluded", () => {
  assert.deepEqual(
    parentProctorEmails({
      motherEmail: "mother@example.test",
      maIsHomeworkProctor: "true",
      fatherEmail: "father@example.test",
      baIsHomeworkProctor: "false",
    }),
    ["mother@example.test"],
  )
})
