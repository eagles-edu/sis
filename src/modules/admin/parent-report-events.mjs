// @ts-check

import crypto from "node:crypto"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function hashIp(value) {
  const text = normalizeText(value)
  if (!text) return ""
  return crypto.createHash("sha256").update(text).digest("hex")
}

/**
 * @param {{
 *   reportId?: unknown,
 *   artifactVersion?: unknown,
 *   eventType?: unknown,
 *   actorType?: unknown,
 *   actorId?: unknown,
 *   recipientEmail?: unknown,
 *   channel?: unknown,
 *   userAgent?: unknown,
 *   ip?: unknown,
 *   metadata?: unknown,
 * }} payload
 */
export async function recordParentClassReportEvent(payload = {}) {
  const reportId = normalizeText(payload.reportId)
  const eventType = normalizeText(payload.eventType)
  if (!reportId || !eventType) return null
  const prisma = await getSharedPrismaClient()
  if (!prisma?.parentClassReportEvent?.create) return null
  return prisma.parentClassReportEvent.create({
    data: {
      reportId,
      artifactVersion:
        payload.artifactVersion === undefined || payload.artifactVersion === null
          ? null
          : Number.parseInt(String(payload.artifactVersion), 10) || null,
      eventType,
      actorType: normalizeText(payload.actorType) || null,
      actorId: normalizeText(payload.actorId) || null,
      recipientEmail: normalizeText(payload.recipientEmail) || null,
      channel: normalizeText(payload.channel) || null,
      userAgent: normalizeText(payload.userAgent) || null,
      ipHash: hashIp(payload.ip) || null,
      metadataJson: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : null,
    },
  })
}
