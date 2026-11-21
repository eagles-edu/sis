import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import { applyKeepaliveTestEnvironment, readKeepaliveTestEnvironment } from "../tools/keepalive-test-environment.mjs"

process.env.NODE_ENV = "test"
process.env.SIS_ENV_FILE = ".env.test"
process.env.DOTENV_CONFIG_PATH = ".env.test"
const RUNTIME = readKeepaliveTestEnvironment()
applyKeepaliveTestEnvironment(RUNTIME)
process.env.BREVO_WEBHOOK_SECRET = "test-webhook-secret"

function mockTransporter() {
  return {
    verify(callback) {
      setImmediate(() => callback(null, true))
    },
    async sendMail() {
      return { messageId: "mock-message-id" }
    },
  }
}

function syntheticStudentNumber(stamp) {
  return 900000 + (Number.parseInt(stamp.replaceAll("-", "").slice(0, 8), 16) % 100000)
}

test("Brevo webhook rejects unauthenticated requests and idempotently updates delivery status", async () => {
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { startExerciseMailer } = await import("../server/exercise-mailer.mjs")
  const { closeStudentAdminRuntimeResources } = await import("../server/student-admin-routes.mjs")
  const { listPerformanceEngagementData } = await import("../src/modules/admin/performance-engagement.mjs")
  const prisma = await getSharedPrismaClient()
  const stamp = randomUUID()
  const messageId = `<webhook-test-${stamp}@brevo.test>`
  const recipientEmail = `webhook-${stamp}@example.invalid`
  const libraryToken = `library-webhook-${stamp}`
  const reminderToken = `reminder-webhook-${stamp}`
  const profileInvitationId = `profile-webhook-${stamp}`
  const queueId = `library-webhook-queue-${stamp}`
  let student = null
  let assignment = null
  let report = null
  let reminderDispatch = null
  let server = null

  try {
    student = await prisma.student.create({
      data: {
        externalKey: `webhook-test-${stamp}`,
        studentNumber: syntheticStudentNumber(stamp),
        eaglesId: `WEBHOOK-${stamp}`,
        email: recipientEmail,
      },
    })
    assignment = await prisma.libraryAssignment.create({
      data: { studentRefId: student.id, taskType: "new_entry", assignedByName: "webhook test" },
    })
    report = await prisma.parentClassReport.create({
      data: {
        studentRefId: student.id,
        className: "A2 KET",
        level: "A2 KET",
        schoolYear: "2026",
        quarter: "q1",
        workflowState: "published",
        metaPayload: { classDate: "2026-08-20", classDay: "Thursday" },
      },
    })
    await prisma.libraryAssignmentEngagement.create({
      data: { assignmentId: assignment.id, recipientEmail, trackingToken: libraryToken, queueId, sentAt: new Date() },
    })
    reminderDispatch = await prisma.assignmentReminderDispatch.create({
      data: {
        dispatchKey: `webhook-${stamp}`,
        assignmentTemplateId: `template-${stamp}`,
        studentRefId: student.id,
        reminderKind: "assignment-created",
        localDate: "2026-08-20",
        status: "queued",
        queueId,
      },
    })
    await prisma.assignmentReminderEngagement.create({
      data: { dispatchId: reminderDispatch.id, audience: "student", recipientEmail, trackingToken: reminderToken, sentAt: new Date() },
    })
    await prisma.parentProfileInvitation.create({
      data: {
        id: profileInvitationId,
        tokenHash: `profile-token-${stamp}`,
        recipientEmail,
        studentRefId: student.id,
        status: "sent",
        batchId: queueId,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    })
    await prisma.brevoEmailDelivery.create({
      data: {
        providerMessageId: messageId,
        batchId: queueId,
        recipientEmail,
        reportId: report.id,
        subject: "Webhook test",
        status: "sent",
        queuedAt: new Date(),
        sentAt: new Date(),
        metadataJson: { libraryAssignmentToken: libraryToken, reminderEngagementToken: reminderToken, profileInvitationId },
      },
    })

    server = await startExerciseMailer({ transporter: mockTransporter(), port: 0 })
    await new Promise((resolve, reject) => {
      server.once("listening", resolve)
      server.once("error", reject)
    })
    const address = server.address()
    const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
    const webhookPath = "/api/webhooks/brevo/transactional"
    const unauthorized = await fetch(`${origin}${webhookPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "delivered", "message-id": messageId, email: recipientEmail }),
    })
    assert.equal(unauthorized.status, 401)

    const payload = {
      event: "delivered",
      id: 2103186,
      uuid: `webhook-event-${stamp}-delivered`,
      "message-id": messageId,
      email: recipientEmail,
      ts_event: Math.floor(Date.now() / 1000),
      subject: "Webhook test",
    }
    const delivered = await fetch(`${origin}${webhookPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-webhook-secret" },
      body: JSON.stringify(payload),
    })
    assert.equal(delivered.status, 200)
    assert.equal((await delivered.json()).status, "delivered")

    const duplicate = await fetch(`${origin}${webhookPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-brevo-webhook-secret": "test-webhook-secret" },
      body: JSON.stringify(payload),
    })
    assert.equal(duplicate.status, 200)
    assert.equal((await duplicate.json()).duplicate, true)

    const delivery = await prisma.brevoEmailDelivery.findUnique({
      where: { providerMessageId_recipientEmail: { providerMessageId: messageId, recipientEmail } },
    })
    assert.equal(delivery?.status, "delivered")
    assert.ok(delivery?.deliveredAt)
    assert.ok(delivery?.queuedAt)
    const deliveredEngagement = await prisma.libraryAssignmentEngagement.findUnique({ where: { trackingToken: libraryToken } })
    assert.ok(deliveredEngagement?.deliveredAt)
    const deliveredReminder = await prisma.assignmentReminderEngagement.findUnique({ where: { trackingToken: reminderToken } })
    assert.ok(deliveredReminder?.deliveredAt)
    const deliveredProfile = await prisma.parentProfileInvitation.findUnique({ where: { id: profileInvitationId } })
    assert.ok(deliveredProfile?.deliveredAt)
    const performance = await listPerformanceEngagementData({ dateFrom: "2026-08-20", dateTo: "2026-08-20" })
    const performanceRow = performance.rows.find((row) => row.reviewed === "student" && row.id === student.eaglesId)
    assert.equal(performanceRow?.emailDelivered, "yes")
    assert.ok(performanceRow?.emailDeliveredAt)

    const sharedLifecycleUuid = `webhook-lifecycle-${stamp}`
    const timeline = [
      ["loaded_by_proxy", "proxyLoadedAt"],
      ["first_opening", "firstOpenedAt"],
      ["unique_opened", "uniqueOpenedAt"],
      ["opened", "openedAt"],
      ["clicked", "clickedAt"],
      ["deferred", "deferredAt"],
      ["error", "errorAt"],
      ["invalid", "invalidAt"],
      ["blocked", "blockedAt"],
      ["soft_bounced", "softBouncedAt"],
      ["hard_bounced", "hardBouncedAt"],
      ["complaint", "complainedAt"],
      ["unsubscribed", "unsubscribedAt"],
    ]
    for (const [event, field] of timeline) {
      const response = await fetch(`${origin}${webhookPath}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-webhook-secret" },
        body: JSON.stringify({
          event,
          id: 2103186,
          uuid: sharedLifecycleUuid,
          "message-id": messageId,
          email: recipientEmail,
          ts: Math.floor(Date.now() / 1000) + timeline.findIndex((entry) => entry[0] === event),
          subject: "Webhook test",
        }),
      })
      assert.equal(response.status, 200)
      const updated = await prisma.brevoEmailDelivery.findUnique({
        where: { providerMessageId_recipientEmail: { providerMessageId: messageId, recipientEmail } },
      })
      assert.ok(updated?.[field], `${event} should set ${field}`)
      const engagement = await prisma.libraryAssignmentEngagement.findUnique({ where: { trackingToken: libraryToken } })
      if (event === "loaded_by_proxy") assert.ok(engagement?.proxyLoadedAt)
      if (event === "first_opening") assert.ok(engagement?.firstOpenedAt)
      if (event === "unique_opened") assert.ok(engagement?.uniqueOpenedAt)
      if (event === "opened") assert.ok(engagement?.openedAt)
      if (event === "clicked") assert.ok(engagement?.clickedAt)
      const reminder = await prisma.assignmentReminderEngagement.findUnique({ where: { trackingToken: reminderToken } })
      const profile = await prisma.parentProfileInvitation.findUnique({ where: { id: profileInvitationId } })
      if (event === "loaded_by_proxy") { assert.ok(reminder?.proxyLoadedAt); assert.ok(profile?.proxyLoadedAt) }
      if (event === "first_opening") { assert.ok(reminder?.firstOpenedAt); assert.ok(profile?.firstOpenedAt) }
      if (event === "unique_opened") { assert.ok(reminder?.uniqueOpenedAt); assert.ok(profile?.uniqueOpenedAt) }
      if (event === "opened") { assert.ok(reminder?.openedAt); assert.ok(profile?.openedAt) }
      if (event === "clicked") { assert.ok(reminder?.clickedAt); assert.ok(profile?.clickedAt) }
    }
    assert.equal(await prisma.brevoEmailWebhookEvent.count({ where: { providerMessageId: messageId } }), timeline.length + 1)
  } finally {
    const cleanupErrors = []
    const attempt = async (operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    await attempt(() => prisma.brevoEmailWebhookEvent.deleteMany({ where: { providerMessageId: messageId } }))
    await attempt(() => prisma.brevoEmailDelivery.deleteMany({ where: { providerMessageId: messageId } }))
    await attempt(() => prisma.libraryAssignmentEngagement.deleteMany({ where: { trackingToken: libraryToken } }))
    await attempt(() => prisma.assignmentReminderEngagement.deleteMany({ where: { trackingToken: reminderToken } }))
    if (reminderDispatch?.id) {
      await attempt(() => prisma.assignmentReminderDispatch.deleteMany({ where: { id: reminderDispatch.id } }))
    }
    await attempt(() => prisma.parentProfileInvitation.deleteMany({ where: { id: profileInvitationId } }))
    if (report?.id) await attempt(() => prisma.parentClassReport.deleteMany({ where: { id: report.id } }))
    await attempt(() => prisma.adminNotificationQueue.deleteMany({ where: { id: queueId } }))
    if (assignment?.id) await attempt(() => prisma.libraryAssignment.deleteMany({ where: { id: assignment.id } }))
    if (server) {
      server.closeAllConnections?.()
      server.closeIdleConnections?.()
      await attempt(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
      await attempt(() => closeStudentAdminRuntimeResources())
    }
    if (student?.id) await attempt(() => prisma.student.deleteMany({ where: { id: student.id } }))
    await attempt(() => prisma.$disconnect())
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic Brevo webhook cleanup failed")
  }
})
