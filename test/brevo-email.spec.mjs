import assert from "node:assert/strict"
import test from "node:test"
import { sendBrevoEmail } from "../src/modules/email/brevo.mjs"

test("Brevo sender posts the normalized SMTP payload and encodes attachments", async () => {
  const previousKey = process.env.BREVO_API_KEY
  const previousFrom = process.env.BREVO_FROM_EMAIL
  const previousFetch = globalThis.fetch
  const requests = []
  process.env.BREVO_API_KEY = "test-key"
  process.env.BREVO_FROM_EMAIL = "admin@example.test"
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ messageId: "<brevo-test-id>" }), { status: 201 })
  }

  try {
    const result = await sendBrevoEmail({
      from: { email: "admin@example.test", name: "Eagles" },
      to: [{ email: "parent@example.test" }],
      subject: "Report",
      text: "Plain text",
      html: "<p>HTML</p>",
      idempotencyKey: "profile-invitation-test-id",
      attachments: [{ filename: "report.pdf", content: Buffer.from("pdf"), contentType: "application/pdf" }],
    })
    assert.deepEqual(result, { messageId: "<brevo-test-id>", provider: "brevo" })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, "https://api.brevo.com/v3/smtp/email")
    assert.equal(requests[0].options.headers["api-key"], "test-key")
    const payload = JSON.parse(requests[0].options.body)
    assert.deepEqual(payload.to, [{ email: "parent@example.test" }])
    assert.equal(payload.attachment[0].content, Buffer.from("pdf").toString("base64"))
    assert.equal(payload.attachment[0].name, "report.pdf")
    assert.deepEqual(payload.headers, { "Idempotency-Key": "profile-invitation-test-id" })
    assert.equal(requests[0].options.headers["idempotency-key"], undefined)
  } finally {
    globalThis.fetch = previousFetch
    if (previousKey === undefined) delete process.env.BREVO_API_KEY
    else process.env.BREVO_API_KEY = previousKey
    if (previousFrom === undefined) delete process.env.BREVO_FROM_EMAIL
    else process.env.BREVO_FROM_EMAIL = previousFrom
  }
})

test("Brevo sender treats a repeated idempotency key as already processed", async () => {
  const previousKey = process.env.BREVO_API_KEY
  const previousFrom = process.env.BREVO_FROM_EMAIL
  const previousFetch = globalThis.fetch
  process.env.BREVO_API_KEY = "test-key"
  process.env.BREVO_FROM_EMAIL = "admin@example.test"
  globalThis.fetch = async () => new Response(JSON.stringify({ code: "duplicate_parameter" }), { status: 400 })

  try {
    const result = await sendBrevoEmail({
      to: [{ email: "parent@example.test" }],
      subject: "Profile",
      html: "<p>Profile</p>",
      idempotencyKey: "profile-invitation-test-id",
    })
    assert.deepEqual(result, { messageId: "", provider: "brevo", duplicate: true })
  } finally {
    globalThis.fetch = previousFetch
    if (previousKey === undefined) delete process.env.BREVO_API_KEY
    else process.env.BREVO_API_KEY = previousKey
    if (previousFrom === undefined) delete process.env.BREVO_FROM_EMAIL
    else process.env.BREVO_FROM_EMAIL = previousFrom
  }
})
