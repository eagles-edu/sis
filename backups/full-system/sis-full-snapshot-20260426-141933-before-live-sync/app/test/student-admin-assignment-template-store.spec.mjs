import test from "node:test"
import assert from "node:assert/strict"

process.env.NODE_ENV = "test"
process.env.STUDENT_ADMIN_STORE_ENABLED = "false"
process.env.DATABASE_URL = ""

import {
  buildAssignmentDashboardSlices,
  deleteAssignmentTemplateById,
  getAssignmentTemplateById,
  importAssignmentTemplates,
  listAssignmentTemplates,
  resetAssignmentTemplateStoreForTests,
  saveAssignmentTemplate,
} from "../src/modules/admin/assignment-templates.mjs"

test.beforeEach(() => {
  resetAssignmentTemplateStoreForTests()
})

test("saveAssignmentTemplate normalizes and round-trips assignment template records", async () => {
  const result = await saveAssignmentTemplate({
    level: "A1 Movers",
    assignmentTitle: "Unit 1",
    assignedAt: "2026-03-09",
    dueAt: "2026-03-12",
    message: "Read, write, and finish the homework.",
    items: [
      { title: "Read the story", url: "https://example.com/read" },
      { title: "Write the answers", done: true },
    ],
  })

  assert.equal(result.created, true)
  assert.match(result.item.id, /a1 movers\|unit 1\|2026-03-09\|2026-03-12/i)
  assert.equal(result.item.assignmentTitle, "Unit 1")
  assert.equal(result.item.level, "A1 Movers")
  assert.equal(result.item.items.length, 2)
  assert.equal(result.item.completed, false)
  assert.equal(result.item.completedAt, "")

  const loaded = await getAssignmentTemplateById(result.item.id)
  assert.equal(loaded?.id, result.item.id)
  assert.equal(loaded?.items.length, 2)
})

test("importAssignmentTemplates upserts by id and keeps list ordering stable", async () => {
  const first = await saveAssignmentTemplate({
    id: "template-1",
    level: "A1 Movers",
    assignmentTitle: "Movers Unit 1",
    assignedAt: "2026-03-09",
    dueAt: "2026-03-12",
    items: [{ title: "Alpha", url: "https://example.com/alpha" }],
  })

  const imported = await importAssignmentTemplates({
    templates: [
      {
        id: first.item.id,
        level: "A1 Movers",
        assignmentTitle: "Movers Unit 1",
        assignedAt: "2026-03-09",
        dueAt: "2026-03-12",
        items: [{ title: "Alpha", url: "https://example.com/alpha" }],
      },
      {
        id: "template-2",
        level: "A2 Flyers",
        assignmentTitle: "Flyers Unit 2",
        assignedAt: "2026-03-10",
        dueAt: "2026-03-15",
        items: [{ title: "Beta", url: "https://example.com/beta" }],
      },
    ],
  })

  assert.equal(imported.total, 2)
  assert.equal(imported.saved, 2)
  assert.equal(imported.items.length, 2)

  const listed = await listAssignmentTemplates({ take: 10 })
  assert.equal(listed.length, 2)
  assert.deepEqual(
    listed.map((entry) => entry.assignmentTitle).sort(),
    ["Flyers Unit 2", "Movers Unit 1"]
  )
})

test("buildAssignmentDashboardSlices returns currentAssignmentMeta and enrollmentOnlyLevels", () => {
  const slices = buildAssignmentDashboardSlices({
    now: new Date("2026-03-10T09:00:00.000Z"),
    assignmentTemplates: [
      {
        id: "meta-1",
        level: "A1 Movers",
        assignmentTitle: "Movers Current",
        assignedAt: "2026-03-09",
        dueAt: "2026-03-12",
        items: [{ title: "Read", url: "https://example.com/read" }],
        updatedAt: "2026-03-10T08:00:00.000Z",
      },
      {
        id: "meta-2",
        level: "A2 Flyers",
        assignmentTitle: "Flyers Current",
        assignedAt: "2026-03-10",
        dueAt: "2026-03-14",
        items: [{ title: "Write", url: "https://example.com/write" }],
        updatedAt: "2026-03-10T08:30:00.000Z",
      },
      {
        id: "meta-3",
        level: "A2 Flyers",
        assignmentTitle: "Flyers Older",
        assignedAt: "2026-03-02",
        dueAt: "2026-03-05",
        items: [{ title: "Old", url: "https://example.com/old" }],
        updatedAt: "2026-03-02T08:00:00.000Z",
      },
    ],
    classEnrollmentAttendance: [
      { level: "A1 Movers", enrolled: 8 },
      { level: "A2 Flyers", enrolled: 6 },
      { level: "A2 KET", enrolled: 4 },
    ],
  })

  assert.deepEqual(
    slices.currentAssignmentMeta.map((entry) => entry.level),
    ["A1 Movers", "A2 Flyers"]
  )
  assert.deepEqual(slices.enrollmentOnlyLevels, ["A2 KET"])
})

test("deleteAssignmentTemplateById removes saved records", async () => {
  const saved = await saveAssignmentTemplate({
    id: "delete-me",
    level: "A1 Movers",
    assignmentTitle: "Delete Me",
    assignedAt: "2026-03-09",
    dueAt: "2026-03-12",
    items: [{ title: "Task", url: "https://example.com/task" }],
  })

  const deleted = await deleteAssignmentTemplateById(saved.item.id)
  assert.equal(deleted.deleted, true)
  assert.equal(deleted.id, saved.item.id)
  const missing = await getAssignmentTemplateById(saved.item.id)
  assert.equal(missing, null)
})
