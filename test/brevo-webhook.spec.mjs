import assert from "node:assert/strict"
import dotenv from "dotenv"
import test from "node:test"

dotenv.config({ path: ".env.dev", override: false })
process.env.NODE_ENV = "test"
process.env.SIS_ENV_FILE = ".env.dev"
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

test("Brevo webhook rejects unauthenticated requests and idempotently updates delivery status", async () => {
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { startExerciseMailer } = await import("../server/exercise-mailer.mjs")
  const { closeStudentAdminRuntimeResources } = await import("../server/student-admin-routes.mjs")
  const prisma = await getSharedPrismaClient()
  const messageId = `<webhook-test-${Date.now()}@brevo.test>`
  const recipientEmail = `webhook-${Date.now()}@example.test`
  await prisma.brevoEmailDelivery.create({
    data: {
      providerMessageId: messageId,
      recipientEmail,
      subject: "Webhook test",
      status: "sent",
      queuedAt: new Date(),
      sentAt: new Date(),
    },
  })

  const server = await startExerciseMailer({ transporter: mockTransporter(), port: 0 })
  await new Promise((resolve) => server.once("listening", resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
  const webhookPath = "/api/webhooks/brevo/transactional"
  try {
    const unauthorized = await fetch(`${origin}${webhookPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "delivered", "message-id": messageId, email: recipientEmail }),
    })
    assert.equal(unauthorized.status, 401)

    const payload = {
      event: "delivered",
      id: 2103186,
      uuid: `webhook-event-${Date.now()}-delivered`,
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
          uuid: `webhook-event-${Date.now()}-${event}`,
          "message-id": messageId,
          email: recipientEmail,
          ts: Math.floor(Date.now() / 1000) + timeline.indexOf(timeline.find((entry) => entry[0] === event)),
          subject: "Webhook test",
        }),
      })
      assert.equal(response.status, 200)
      const updated = await prisma.brevoEmailDelivery.findUnique({
        where: { providerMessageId_recipientEmail: { providerMessageId: messageId, recipientEmail } },
      })
      assert.ok(updated?.[field], `${event} should set ${field}`)
    }
    assert.equal(await prisma.brevoEmailWebhookEvent.count({ where: { providerMessageId: messageId } }), timeline.length + 1)
  } finally {
    await prisma.brevoEmailWebhookEvent.deleteMany({ where: { providerMessageId: messageId } })
    await prisma.brevoEmailDelivery.deleteMany({ where: { providerMessageId: messageId } })
    server.closeAllConnections?.()
    server.closeIdleConnections?.()
    await new Promise((resolve) => server.close(resolve))
    await closeStudentAdminRuntimeResources()
  }
})
