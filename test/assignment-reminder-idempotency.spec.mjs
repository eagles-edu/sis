import assert from "node:assert/strict"
import dotenv from "dotenv"
import test from "node:test"

dotenv.config({ path: ".env.dev", override: false })
process.env.NODE_ENV = "test"
process.env.SIS_ENV_FILE = ".env.dev"

test("assignment reminder engagement keeps one stable dispatch across repeated runs", async () => {
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { dispatchAssignmentCreated } = await import("../src/modules/admin/assignment-reminder-dispatcher.mjs")
  const prisma = await getSharedPrismaClient()
  const stamp = Date.now()
  const student = await prisma.student.create({ data: { externalKey: `reminder-${stamp}`, studentNumber: 920000 + Math.floor(Math.random() * 9000), eaglesId: `REMINDER-${stamp}`, email: `reminder-${stamp}@example.test` } })
  const level = `Reminder Test ${stamp}`
  await prisma.studentProfile.create({ data: { studentRefId: student.id, sourceFormId: `reminder-${stamp}`, fullName: "Reminder Test", englishName: "Reminder Test", currentGrade: level, genderSelections: [], languagesAtHome: [], learningDisorders: [], covidShotHistory: [], feverMedicineAllowed: [], sourceUrl: "test" } })
  const template = await prisma.assignmentTemplate.create({ data: { id: `reminder-template-${stamp}`, assignmentTitle: "Stable reminder", exerciseTitle: "Vocabulary", level, itemsJson: [{ url: "https://eagles.edu.vn/student/library.html" }] } })
  let queueIds = []
  try {
    const first = await dispatchAssignmentCreated(template.id, { now: new Date("2026-08-20T12:00:00.000Z") })
    const second = await dispatchAssignmentCreated(template.id, { now: new Date("2026-08-20T12:00:00.000Z") })
    queueIds = [...new Set(first.queueIds || [])]
    assert.equal(first.dispatched, 1)
    assert.equal(second.dispatched, 0)
    assert.equal(await prisma.assignmentReminderDispatch.count({ where: { assignmentTemplateId: template.id } }), 1)
    assert.equal(await prisma.assignmentReminderEngagement.count({ where: { dispatch: { assignmentTemplateId: template.id } } }), 1)
    const engagement = await prisma.assignmentReminderEngagement.findFirst({ where: { dispatch: { assignmentTemplateId: template.id } }, include: { dispatch: true } })
    assert.equal(engagement?.trackingToken.length, 64)
    assert.equal(engagement?.dispatch?.queueId, queueIds[0])
  } finally {
    await prisma.asyncSideEffectJob.deleteMany({ where: { jobType: "announcement-email", dedupeKey: { in: queueIds } } })
    await prisma.assignmentReminderEngagement.deleteMany({ where: { dispatch: { assignmentTemplateId: template.id } } })
    await prisma.assignmentReminderDispatch.deleteMany({ where: { assignmentTemplateId: template.id } })
    for (const queueId of queueIds) await prisma.adminNotificationQueue.deleteMany({ where: { id: queueId } })
    await prisma.assignmentTemplate.delete({ where: { id: template.id } })
    await prisma.studentProfile.delete({ where: { studentRefId: student.id } })
    await prisma.student.delete({ where: { id: student.id } })
  }
})
