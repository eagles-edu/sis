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
  const explicitId = normalizeText(payload?.id || payload?.eventId)
  const basis = explicitId || [eventType, messageId, recipientEmail, occurredAt.toISOString(), normalizeText(payload?.subject)].join("|")
  return crypto.createHash("sha256").update(basis).digest("hex")
}

function eventStatus(eventType) {
  const event = normalizeLower(eventType).replace(/[\s-]+/gu, "_")
  if (event === "delivered") return "delivered"
  if (event === "opened" || event === "first_opening" || event === "firstopening" || event === "unique_opened" || event === "uniqueopened" || event === "proxy_open" || event === "proxyopen" || event === "unique_proxy_open" || event === "uniqueproxyopen") return "opened"
  if (event === "click" || event === "clicked" || event === "unique_clicked") return "clicked"
  if (event === "hard_bounce" || event === "hardbounce" || event === "soft_bounce" || event === "softbounce" || event === "bounced") return "bounced"
  if (event === "blocked" || event === "invalid" || event === "invalid_email" || event === "invalidemail" || event === "error") return "blocked"
  if (event === "deferred") return "deferred"
  if (event === "complaint" || event === "spam") return "complained"
  if (event === "unsubscribed") return "unsubscribed"
  if (event === "request" || event === "sent") return "sent"
  return "event"
}

function statusTimestampField(status) {
  if (status === "delivered") return "deliveredAt"
  if (status === "opened") return "openedAt"
  if (status === "clicked") return "clickedAt"
  if (status === "deferred") return "deferredAt"
  if (status === "bounced") return "bouncedAt"
  if (status === "blocked") return "blockedAt"
  if (status === "complained") return "complainedAt"
  if (status === "unsubscribed") return "unsubscribedAt"
  if (status === "sent") return "sentAt"
  return "lastEventAt"
}

function isDuplicateError(error) {
  return normalizeLower(error?.code) === "p2002"
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
  return prisma.brevoEmailDelivery.upsert({
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
      sentAt: new Date(),
      metadataJson: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : null,
    },
  })
}

export async function recordBrevoEmailDeliverySafely(payload = {}) {
  try {
    return await recordBrevoEmailDelivery(payload)
  } catch (error) {
    console.warn(`Brevo delivery correlation persistence failed: ${normalizeText(error?.message || error)}`)
    return null
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
  const occurredAt = eventDate(payload.ts_event ? Number(payload.ts_event) * 1000 : payload.date || payload.timestamp)
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
    updatedDelivery = await prisma.brevoEmailDelivery.update({
      where: { id: delivery.id },
      data: {
        status,
        lastEventAt: occurredAt,
        [timestampField]: occurredAt,
      },
    })
    await prisma.brevoEmailWebhookEvent.update({
      where: { id: storedEvent.id },
      data: { deliveryId: delivery.id, processedAt: new Date() },
    })
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
