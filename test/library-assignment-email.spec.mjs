import assert from "node:assert/strict"
import dotenv from "dotenv"
import test from "node:test"

dotenv.config({ path: ".env.dev", override: false })
process.env.NODE_ENV = "test"
process.env.SIS_ENV_FILE = ".env.dev"

test("Library assignment email queueing is stable and idempotent", async () => {
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { sendLibraryAssignmentEmail } = await import("../src/modules/admin/library-corpus.mjs")
  const prisma = await getSharedPrismaClient()
  const stamp = Date.now()
  const recipientEmail = `library-assignment-${stamp}@example.test`
  const student = await prisma.student.create({ data: { externalKey: `library-assignment-${stamp}`, studentNumber: 910000 + Math.floor(Math.random() * 9000), eaglesId: `LIBRARY-${stamp}`, email: recipientEmail } })
  const assignment = await prisma.libraryAssignment.create({ data: { studentRefId: student.id, taskType: "new_entry", assignedByName: "idempotency test" } })
  let queueId = ""
  try {
    const first = await sendLibraryAssignmentEmail(assignment.id, { name: "idempotency-test" })
    const second = await sendLibraryAssignmentEmail(assignment.id, { name: "idempotency-test" })
    queueId = first.queueId
    assert.equal(first.ok, true)
    assert.equal(first.duplicate, undefined)
    assert.equal(second.ok, true)
    assert.equal(second.duplicate, true)
    assert.equal(second.queueId, first.queueId)
    assert.equal(second.engagement.id, first.engagement.id)
    assert.equal(await prisma.libraryAssignmentEngagement.count({ where: { assignmentId: assignment.id } }), 1)
    assert.equal(await prisma.adminNotificationQueue.count({ where: { id: first.queueId } }), 1)
  } finally {
    await prisma.libraryAssignmentEngagement.deleteMany({ where: { assignmentId: assignment.id } })
    if (queueId) await prisma.adminNotificationQueue.deleteMany({ where: { id: queueId } })
    await prisma.libraryAssignment.delete({ where: { id: assignment.id } })
    await prisma.student.delete({ where: { id: student.id } })
  }
})
