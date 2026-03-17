import test from "node:test"
import assert from "node:assert/strict"

import {
  buildArchiveDateRange,
  parseCliArgs,
  parseSchoolYearLabel,
} from "../tools/school-year-rollover.mjs"

test("parseSchoolYearLabel accepts one-year span", () => {
  assert.equal(parseSchoolYearLabel("2025-2026"), "2025-2026")
  assert.equal(parseSchoolYearLabel(" 2025 - 2026 "), "2025-2026")
})

test("parseSchoolYearLabel rejects invalid spans", () => {
  assert.equal(parseSchoolYearLabel("2025"), null)
  assert.equal(parseSchoolYearLabel("2025-2025"), null)
  assert.equal(parseSchoolYearLabel("2025-2027"), null)
  assert.equal(parseSchoolYearLabel("abc"), null)
})

test("buildArchiveDateRange returns inclusive window plus exclusive upper bound", () => {
  const range = buildArchiveDateRange("2025-02-10", "2026-02-01")
  assert.equal(range.startDateText, "2025-02-10")
  assert.equal(range.endDateText, "2026-02-01")
  assert.equal(range.endExclusiveDateText, "2026-02-02")
})

test("buildArchiveDateRange rejects reversed dates", () => {
  assert.throws(() => buildArchiveDateRange("2026-02-01", "2025-02-10"), /--end-date must be on\/after --start-date/)
})

test("parseCliArgs returns help command by default", () => {
  const parsed = parseCliArgs([])
  assert.equal(parsed.command, "help")
})

test("parseCliArgs parses archive command options", () => {
  const parsed = parseCliArgs([
    "archive",
    "--school-year",
    "2025-2026",
    "--start-date",
    "2025-02-10",
    "--end-date",
    "2026-02-01",
    "--archive-root",
    "tmp/archive",
    "--batch-size",
    "800",
    "--apply",
    "--exclude-notifications",
    "--json",
  ])

  assert.equal(parsed.command, "archive")
  assert.equal(parsed.schoolYear, "2025-2026")
  assert.equal(parsed.startDate, "2025-02-10")
  assert.equal(parsed.endDate, "2026-02-01")
  assert.equal(parsed.archiveRoot, "tmp/archive")
  assert.equal(parsed.batchSize, 800)
  assert.equal(parsed.apply, true)
  assert.equal(parsed.excludeNotifications, true)
  assert.equal(parsed.json, true)
})

test("parseCliArgs throws for unknown options", () => {
  assert.throws(() => parseCliArgs(["inspect", "--nope"]), /Unknown option: --nope/)
})
