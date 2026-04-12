import assert from "node:assert/strict"
import test from "node:test"

import { summarizeAttendanceRows } from "../server/attendance-summary.mjs"

test("summarizeAttendanceRows counts tardy as present and keeps lateness buckets separate", () => {
  const result = summarizeAttendanceRows([
    { status: "present" },
    { status: "tardy10", comments: "" },
    { status: "tardy30", comments: "" },
    { status: "late", comments: "45 minutes" },
    { status: "late", comments: "" },
    { status: "absent" },
    { status: "excused" },
  ])

  assert.deepEqual(result, {
    total: 7,
    present: 5,
    absent: 1,
    late: 4,
    tardy10: 2,
    tardy30: 2,
    excused: 1,
  })
})
