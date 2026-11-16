import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import dotenv from "dotenv"
import test from "node:test"

dotenv.config({ path: ".env.test", override: true })
process.env.NODE_ENV = "test"
process.env.SIS_ENV_FILE = ".env.test"
process.env.DOTENV_CONFIG_PATH = ".env.test"

function syntheticStudentNumber(stamp) {
  return 900000 + (Number.parseInt(stamp.replaceAll("-", "").slice(0, 8), 16) % 100000)
}

function libraryQueueId(assignmentId) {
  return `library-assignment-${createHash("sha256").update(assignmentId).digest("hex").slice(0, 40)}`
}

test("Library assignment email queueing is stable and idempotent", async () => {
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { sendLibraryAssignmentEmail } = await import("../src/modules/admin/library-corpus.mjs")
  const prisma = await getSharedPrismaClient()
  const stamp = randomUUID()
  const recipientEmail = `library-assignment-${stamp}@example.invalid`
  let studentId = ""
  let assignmentId = ""
  let queueId = ""

  try {
    const student = await prisma.student.create({
      data: {
        externalKey: `library-assignment-${stamp}`,
        studentNumber: syntheticStudentNumber(stamp),
        eaglesId: `LIBRARY-${stamp}`,
        email: recipientEmail,
      },
      select: { id: true },
    })
    studentId = student.id
    const assignment = await prisma.libraryAssignment.create({
      data: { studentRefId: studentId, taskType: "new_entry", assignedByName: "synthetic idempotency test" },
      select: { id: true },
    })
    assignmentId = assignment.id
    queueId = libraryQueueId(assignmentId)

    const first = await sendLibraryAssignmentEmail(assignmentId, { name: "synthetic-idempotency-test" })
    const second = await sendLibraryAssignmentEmail(assignmentId, { name: "synthetic-idempotency-test" })
    assert.equal(first.ok, true)
    assert.equal(first.duplicate, undefined)
    assert.equal(second.ok, true)
    assert.equal(second.duplicate, true)
    assert.equal(second.queueId, first.queueId)
    assert.equal(second.engagement.id, first.engagement.id)
    assert.equal(first.queueId, queueId)
    assert.equal(await prisma.libraryAssignmentEngagement.count({ where: { assignmentId } }), 1)
    assert.equal(await prisma.adminNotificationQueue.count({ where: { id: queueId } }), 1)
  } finally {
    const cleanupErrors = []
    const attempt = async (operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (assignmentId) {
      await attempt(() => prisma.libraryAssignmentEngagement.deleteMany({ where: { assignmentId } }))
      await attempt(() => prisma.adminNotificationQueue.deleteMany({ where: { id: queueId } }))
      await attempt(() => prisma.asyncSideEffectJob.deleteMany({ where: { jobType: "announcement-email", dedupeKey: queueId } }))
      await attempt(() => prisma.libraryAssignment.deleteMany({ where: { id: assignmentId } }))
    }
    if (studentId) await attempt(() => prisma.student.deleteMany({ where: { id: studentId } }))
    await attempt(() => prisma.$disconnect())
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic Library assignment cleanup failed")
  }
})
