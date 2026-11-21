import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import test from "node:test"
import { applyKeepaliveTestEnvironment, readKeepaliveTestEnvironment } from "../tools/keepalive-test-environment.mjs"

process.env.NODE_ENV = "test"
process.env.SIS_ENV_FILE = ".env.test"
process.env.DOTENV_CONFIG_PATH = ".env.test"
const RUNTIME = readKeepaliveTestEnvironment()
applyKeepaliveTestEnvironment(RUNTIME)
process.env.STUDENT_ADMIN_NOTIFY_QUEUE_BACKEND = "memory"
process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND = "memory"

function syntheticStudentNumber(stamp) {
  return 900000 + (Number.parseInt(stamp.replaceAll("-", "").slice(0, 8), 16) % 100000)
}

function reminderQueueId(dispatchKey) {
  return `assignment-reminder-${createHash("sha256").update(dispatchKey).digest("hex").slice(0, 40)}`
}

test("assignment reminder engagement keeps one stable dispatch across repeated runs", async () => {
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { dispatchAssignmentCreated } = await import("../src/modules/admin/assignment-reminder-dispatcher.mjs")
  const prisma = await getSharedPrismaClient()
  const stamp = randomUUID()
  const recipient = `reminder-${stamp}@example.invalid`
  const level = `Reminder Test ${stamp}`
  const templateId = `reminder-template-${stamp}`
  let studentId = ""
  let templateCreated = false
  let expectedQueueId = ""
  const queueIds = new Set()

  try {
    const student = await prisma.student.create({
      data: {
        externalKey: `reminder-${stamp}`,
        studentNumber: syntheticStudentNumber(stamp),
        eaglesId: `REMINDER-${stamp}`,
        email: recipient,
      },
      select: { id: true },
    })
    studentId = student.id
    await prisma.studentProfile.create({
      data: {
        studentRefId: studentId,
        sourceFormId: `reminder-${stamp}`,
        fullName: "Synthetic Reminder Student",
        englishName: "Synthetic Reminder Student",
        currentGrade: level,
        genderSelections: [],
        languagesAtHome: [],
        learningDisorders: [],
        covidShotHistory: [],
        feverMedicineAllowed: [],
        sourceUrl: "test",
      },
    })
    await prisma.assignmentTemplate.create({
      data: {
        id: templateId,
        assignmentTitle: "Stable reminder",
        exerciseTitle: "Vocabulary",
        level,
        itemsJson: [{ url: "https://eagles.edu.vn/student/library.html" }],
      },
    })
    templateCreated = true

    const now = new Date("2026-08-20T12:00:00.000Z")
    const first = await dispatchAssignmentCreated(templateId, { now })
    const second = await dispatchAssignmentCreated(templateId, { now })
    for (const queueId of [...(first.queueIds || []), ...(second.queueIds || [])]) queueIds.add(queueId)
    assert.equal(first.dispatched, 1)
    assert.equal(second.dispatched, 0)
    assert.equal(await prisma.assignmentReminderDispatch.count({ where: { assignmentTemplateId: templateId } }), 1)
    assert.equal(await prisma.assignmentReminderEngagement.count({ where: { dispatch: { assignmentTemplateId: templateId } } }), 1)
    const engagement = await prisma.assignmentReminderEngagement.findFirst({
      where: { dispatch: { assignmentTemplateId: templateId } },
      include: { dispatch: true },
    })
    const dispatchKey = [templateId, studentId, "student", "assignment-created", "2026-08-20", recipient].join(":")
    expectedQueueId = reminderQueueId(dispatchKey)
    assert.equal(engagement?.trackingToken.length, 64)
    assert.equal(engagement?.dispatch?.queueId, expectedQueueId)
    queueIds.add(expectedQueueId)

    const { listQueuedAnnouncements } = await import("../src/modules/admin/notification-queue.mjs")
    const queued = await listQueuedAnnouncements({ queueType: "announcement", take: 20 })
    const syntheticQueue = queued.items.find((entry) => entry.id === expectedQueueId)
    assert.deepEqual(syntheticQueue?.recipients, [recipient])
    assert.match(syntheticQueue?.recipients[0] || "", /@example\.invalid$/u)

    const { claimAsyncSideEffectJobs } = await import("../src/modules/async/side-effect-jobs.mjs")
    const claimedJobs = await claimAsyncSideEffectJobs({
      jobTypes: ["announcement-email"],
      take: 20,
      workerId: `synthetic-isolation-${stamp}`,
    })
    const syntheticJob = claimedJobs.find((job) => job.dedupeKey === expectedQueueId)
    assert.deepEqual(syntheticJob?.payloadJson?.announcementPayload?.recipients, [recipient])
  } finally {
    const cleanupErrors = []
    const attempt = async (operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (templateCreated) {
      const dispatches = await prisma.assignmentReminderDispatch.findMany({
        where: { assignmentTemplateId: templateId },
        select: { queueId: true },
      }).catch((error) => {
        cleanupErrors.push(error)
        return []
      })
      for (const dispatch of dispatches) if (dispatch.queueId) queueIds.add(dispatch.queueId)
      const ids = [...queueIds]
      if (ids.length) {
        await attempt(() => prisma.asyncSideEffectJob.deleteMany({ where: { jobType: "announcement-email", dedupeKey: { in: ids } } }))
        await attempt(() => prisma.adminNotificationQueue.deleteMany({ where: { id: { in: ids } } }))
      }
      await attempt(() => prisma.assignmentReminderEngagement.deleteMany({ where: { dispatch: { assignmentTemplateId: templateId } } }))
      await attempt(() => prisma.assignmentReminderDispatch.deleteMany({ where: { assignmentTemplateId: templateId } }))
      await attempt(() => prisma.assignmentTemplate.deleteMany({ where: { id: templateId } }))
    }
    if (studentId) {
      await attempt(() => prisma.studentProfile.deleteMany({ where: { studentRefId: studentId } }))
      await attempt(() => prisma.student.deleteMany({ where: { id: studentId } }))
    }
    await attempt(async () => {
      const [studentsRemaining, templatesRemaining, dispatchesRemaining, engagementsRemaining, queueRowsRemaining, databaseJobsRemaining] = await Promise.all([
        studentId ? prisma.student.count({ where: { id: studentId } }) : 0,
        prisma.assignmentTemplate.count({ where: { id: templateId } }),
        prisma.assignmentReminderDispatch.count({ where: { assignmentTemplateId: templateId } }),
        prisma.assignmentReminderEngagement.count({ where: { dispatch: { assignmentTemplateId: templateId } } }),
        queueIds.size ? prisma.adminNotificationQueue.count({ where: { id: { in: [...queueIds] } } }) : 0,
        queueIds.size ? prisma.asyncSideEffectJob.count({ where: { jobType: "announcement-email", dedupeKey: { in: [...queueIds] } } }) : 0,
      ])
      const remaining = studentsRemaining + templatesRemaining + dispatchesRemaining + engagementsRemaining + queueRowsRemaining + databaseJobsRemaining
      if (remaining) throw new Error(`Synthetic assignment reminder cleanup left ${remaining} database records`)
    })
    await attempt(() => prisma.$disconnect())
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic assignment reminder cleanup failed")
  }
})
