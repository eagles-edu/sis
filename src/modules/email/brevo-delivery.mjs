// @ts-check

import crypto from "node:crypto"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { recordParentClassReportEvent } from "../admin/parent-report-events.mjs"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function eventDate(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.valueOf()) ? new Date() : date
}

function eventKey(payload, eventType, messageId, recipientEmail, occurredAt) {
  // Brevo may reuse both `id` and `uuid` for every lifecycle callback of one
  // message. The event type and occurrence time are part of the event
  // identity, so a delivery/open/click sequence cannot collapse into one row.
  const explicitId = normalizeText(payload?.uuid || payload?.eventId || payload?.eventUuid)
  const basis = [
    eventType,
    explicitId,
    messageId,
    recipientEmail,
    occurredAt.toISOString(),
    normalizeText(payload?.subject),
    normalizeText(payload?.link),
  ].join("|")
  return crypto.createHash("sha256").update(basis).digest("hex")
}

function eventStatus(eventType) {
  const event = normalizeLower(eventType).replace(/[\s-]+/gu, "_")
  if (event === "delivered") return "delivered"
  if (event === "loaded_by_proxy" || event === "loadedbyproxy" || event === "proxy_open" || event === "proxyopen" || event === "unique_proxy_open" || event === "uniqueproxyopen") return "proxy_loaded"
  if (event === "first_opening" || event === "firstopening") return "first_opened"
  if (event === "unique_opened" || event === "uniqueopened") return "unique_opened"
  if (event === "opened") return "opened"
  if (event === "click" || event === "clicked" || event === "unique_clicked") return "clicked"
  if (event === "soft_bounce" || event === "softbounce" || event === "soft_bounced" || event === "softbounced") return "soft_bounced"
  if (event === "hard_bounce" || event === "hardbounce" || event === "hard_bounced" || event === "hardbounced" || event === "bounced") return "hard_bounced"
  if (event === "error") return "error"
  if (event === "invalid" || event === "invalid_email" || event === "invalidemail") return "invalid"
  if (event === "blocked") return "blocked"
  if (event === "deferred") return "deferred"
  if (event === "complaint" || event === "spam") return "complained"
  if (event === "unsubscribed") return "unsubscribed"
  if (event === "request" || event === "sent") return "sent"
  return "event"
}

function statusTimestampField(status) {
  if (status === "proxy_loaded") return "proxyLoadedAt"
  if (status === "first_opened") return "firstOpenedAt"
  if (status === "unique_opened") return "uniqueOpenedAt"
  if (status === "delivered") return "deliveredAt"
  if (status === "opened") return "openedAt"
  if (status === "clicked") return "clickedAt"
  if (status === "deferred") return "deferredAt"
  if (status === "soft_bounced") return "softBouncedAt"
  if (status === "hard_bounced") return "hardBouncedAt"
  if (status === "error") return "errorAt"
  if (status === "invalid") return "invalidAt"
  if (status === "blocked") return "blockedAt"
  if (status === "complained") return "complainedAt"
  if (status === "unsubscribed") return "unsubscribedAt"
  if (status === "sent") return "sentAt"
  return "lastEventAt"
}

function isDuplicateError(error) {
  return normalizeLower(error?.code) === "p2002"
}

const EVENT_STATUS_RANK = Object.freeze({
  event: 0,
  sent: 10,
  deferred: 20,
  delivered: 30,
  proxy_loaded: 40,
  first_opened: 50,
  unique_opened: 60,
  opened: 70,
  clicked: 80,
  complained: 90,
  unsubscribed: 90,
  soft_bounced: 90,
  hard_bounced: 90,
  error: 90,
  invalid: 90,
  blocked: 90,
})

function eventFieldsForEngagement(status) {
  if (status === "delivered") return ["deliveredAt"]
  if (status === "proxy_loaded") return ["proxyLoadedAt"]
  if (status === "first_opened") return ["firstOpenedAt", "openedAt"]
  if (status === "unique_opened") return ["uniqueOpenedAt", "openedAt"]
  if (status === "opened") return ["openedAt"]
  if (status === "clicked") return ["clickedAt"]
  return []
}

async function updateEngagementFields(model, where, fields, occurredAt) {
  if (!model?.updateMany) return
  for (const field of fields) {
    await model.updateMany({ where: { ...where, [field]: null }, data: { [field]: occurredAt } })
  }
}

async function syncEngagementsFromEvent(prisma, delivery, status, occurredAt) {
  const metadata = delivery?.metadataJson && typeof delivery.metadataJson === "object" ? delivery.metadataJson : {}
  const fields = eventFieldsForEngagement(status)
  if (!fields.length) return
  const libraryToken = normalizeText(metadata.libraryAssignmentToken)
  const reminderToken = normalizeText(metadata.reminderEngagementToken)
  const profileInvitationId = normalizeText(metadata.profileInvitationId || metadata.invitationId)
  await updateEngagementFields(prisma?.libraryAssignmentEngagement, { trackingToken: libraryToken }, fields, occurredAt)
  await updateEngagementFields(prisma?.assignmentReminderEngagement, { trackingToken: reminderToken }, fields, occurredAt)
  await updateEngagementFields(prisma?.parentProfileInvitation, { id: profileInvitationId }, fields, occurredAt)
}

async function markEngagementsSent(prisma, delivery, metadata, batchId) {
  const sentAt = delivery?.sentAt || new Date()
  const queueId = normalizeText(batchId)
  const libraryToken = normalizeText(metadata.libraryAssignmentToken)
  const reminderToken = normalizeText(metadata.reminderEngagementToken)
  const profileInvitationId = normalizeText(metadata.profileInvitationId || metadata.invitationId)
  if (libraryToken) {
    await prisma?.libraryAssignmentEngagement?.updateMany?.({ where: { trackingToken: libraryToken, sentAt: null }, data: { sentAt, ...(queueId ? { queueId } : {}) } })
  }
  if (reminderToken) {
    await prisma?.assignmentReminderEngagement?.updateMany?.({ where: { trackingToken: reminderToken, sentAt: null }, data: { sentAt } })
  }
  if (profileInvitationId) {
    await prisma?.parentProfileInvitation?.updateMany?.({ where: { id: profileInvitationId, sentAt: null }, data: { sentAt, ...(queueId ? { batchId: queueId } : {}) } })
  }
}

/**
 * @param {{
 *   messageId?: unknown,
 *   batchId?: unknown,
 *   recipientEmail?: unknown,
 *   reportId?: unknown,
 *   queueType?: unknown,
 *   subject?: unknown,
 *   metadata?: unknown,
 * }} payload
 */
export async function recordBrevoEmailDelivery(payload = {}) {
  const messageId = normalizeText(payload.messageId)
  const recipientEmail = normalizeLower(payload.recipientEmail)
  if (!messageId || !recipientEmail) return null
  const prisma = await getSharedPrismaClient()
  if (!prisma?.brevoEmailDelivery?.upsert) return null
  const delivery = await prisma.brevoEmailDelivery.upsert({
    where: {
      providerMessageId_recipientEmail: {
        providerMessageId: messageId,
        recipientEmail,
      },
    },
    update: {
      reportId: normalizeText(payload.reportId) || undefined,
      batchId: normalizeText(payload.batchId) || undefined,
      queueType: normalizeText(payload.queueType) || undefined,
      subject: normalizeText(payload.subject) || undefined,
      metadataJson: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : undefined,
    },
    create: {
      providerMessageId: messageId,
      batchId: normalizeText(payload.batchId) || null,
      recipientEmail,
      reportId: normalizeText(payload.reportId) || null,
      queueType: normalizeText(payload.queueType) || null,
      subject: normalizeText(payload.subject) || null,
      status: "sent",
      queuedAt: new Date(),
      sentAt: new Date(),
      metadataJson: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : null,
    },
  })
  const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}
  if (Object.keys(metadata).length) {
    await markEngagementsSent(prisma, delivery, metadata, payload.batchId)
    const events = prisma.brevoEmailWebhookEvent?.findMany
      ? await prisma.brevoEmailWebhookEvent.findMany({ where: { providerMessageId: messageId, recipientEmail }, orderBy: { eventAt: "asc" } })
      : []
    for (const event of events) await syncEngagementsFromEvent(prisma, delivery, eventStatus(event.eventType), event.eventAt)
  }
  return delivery
}

export async function recordBrevoEmailDeliverySafely(payload = {}) {
  try {
    return await recordBrevoEmailDelivery(payload)
  } catch (error) {
    console.warn(`Brevo delivery correlation persistence failed: ${normalizeText(error?.message || error)}`)
    return null
  }
}

/** @returns {Promise<Record<string, unknown>>} */
export async function getBrevoWebhookHealth() {
  const configured = Boolean(normalizeText(process.env.BREVO_WEBHOOK_SECRET))
  if (!configured) {
    return { configured: false, state: "error", lastEventType: "", lastReceivedAt: "", lastProcessedAt: "" }
  }
  try {
    const prisma = await getSharedPrismaClient()
    const event = prisma?.brevoEmailWebhookEvent?.findFirst
      ? await prisma.brevoEmailWebhookEvent.findFirst({
          orderBy: { receivedAt: "desc" },
          select: { eventType: true, receivedAt: true, processedAt: true },
        })
      : null
    if (!event) {
      return { configured: true, state: "pending", lastEventType: "", lastReceivedAt: "", lastProcessedAt: "" }
    }
    return {
      configured: true,
      state: event.processedAt ? "ok" : "error",
      lastEventType: normalizeText(event.eventType),
      lastReceivedAt: event.receivedAt?.toISOString?.() || "",
      lastProcessedAt: event.processedAt?.toISOString?.() || "",
    }
  } catch (error) {
    return {
      configured: true,
      state: "error",
      lastEventType: "",
      lastReceivedAt: "",
      lastProcessedAt: "",
      lastError: normalizeText(error?.message || error),
    }
  }
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {Promise<{ duplicate: boolean, eventId: string, status: string, deliveryId: string }>} 
 */
export async function processBrevoWebhookEvent(payload = {}) {
  const eventType = normalizeLower(payload.event || payload.eventType || payload.type)
  const messageId = normalizeText(payload["message-id"] || payload.messageId || payload.message_id)
  const recipientEmail = normalizeLower(payload.email || payload.recipient)
  const timestamp = payload.ts_event || payload.ts
  const occurredAt = eventDate(timestamp ? Number(timestamp) * 1000 : payload.date || payload.timestamp)
  if (!eventType) throw Object.assign(new Error("Brevo webhook event is required"), { statusCode: 400 })
  if (!messageId) throw Object.assign(new Error("Brevo webhook message-id is required"), { statusCode: 400 })

  const prisma = await getSharedPrismaClient()
  const key = eventKey(payload, eventType, messageId, recipientEmail, occurredAt)
  let storedEvent
  try {
    storedEvent = await prisma.brevoEmailWebhookEvent.create({
      data: {
        eventKey: key,
        providerMessageId: messageId,
        recipientEmail: recipientEmail || null,
        eventType,
        eventAt: occurredAt,
        subject: normalizeText(payload.subject) || null,
        payloadJson: payload,
      },
    })
  } catch (error) {
    if (isDuplicateError(error)) {
      return { duplicate: true, eventId: key, status: eventStatus(eventType), deliveryId: "" }
    }
    throw error
  }

  const status = eventStatus(eventType)
  const delivery = recipientEmail
    ? await prisma.brevoEmailDelivery.findUnique({
        where: { providerMessageId_recipientEmail: { providerMessageId: messageId, recipientEmail } },
      })
    : await prisma.brevoEmailDelivery.findFirst({
        where: { providerMessageId: messageId },
        orderBy: { createdAt: "asc" },
      })
  let updatedDelivery = delivery
  if (delivery) {
    const timestampField = statusTimestampField(status)
    const currentRank = EVENT_STATUS_RANK[normalizeLower(delivery.status)] || 0
    const nextRank = EVENT_STATUS_RANK[status] || 0
    const currentLastEventAt = delivery.lastEventAt ? eventDate(delivery.lastEventAt) : null
    const eventData = {
      status: nextRank >= currentRank ? status : delivery.status,
      lastEventAt: currentLastEventAt && currentLastEventAt > occurredAt ? currentLastEventAt : occurredAt,
      ...(timestampField !== "lastEventAt" ? { [timestampField]: delivery[timestampField] || occurredAt } : {}),
    }
    updatedDelivery = await prisma.brevoEmailDelivery.update({
      where: { id: delivery.id },
      data: eventData,
    })
    await prisma.brevoEmailWebhookEvent.update({
      where: { id: storedEvent.id },
      data: { deliveryId: delivery.id, processedAt: new Date() },
    })
    await syncEngagementsFromEvent(prisma, updatedDelivery, status, occurredAt)
    if (delivery.reportId) {
      await recordParentClassReportEvent({
        reportId: delivery.reportId,
        eventType: `brevo_${status}`,
        actorType: "brevo",
        actorId: messageId,
        recipientEmail,
        channel: "email",
        metadata: { eventType, messageId, webhookEventId: storedEvent.id },
      })
    }
  } else {
    await prisma.brevoEmailWebhookEvent.update({
      where: { id: storedEvent.id },
      data: { processedAt: new Date() },
    })
  }

  return {
    duplicate: false,
    eventId: key,
    status,
    deliveryId: normalizeText(updatedDelivery?.id),
  }
}
