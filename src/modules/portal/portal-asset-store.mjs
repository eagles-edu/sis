// @ts-check

import { assetSha256 } from "./portal-preference-store.mjs"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"

const MAX_ASSET_BYTES = 2 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(["image/svg+xml", "image/png", "image/jpeg", "image/webp"])

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function assetError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode })
}

function decodeDataUrl(value) {
  const raw = text(value)
  const match = raw.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
  if (!match) throw assetError("Asset must be a data URL")
  const mimeType = text(match[1]).toLowerCase()
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw assetError("Unsupported asset MIME type")
  const isBase64 = Boolean(match[2])
  const content = isBase64 ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8")
  if (!content.length || content.length > MAX_ASSET_BYTES) throw assetError("Asset exceeds the allowed size")
  if (mimeType === "image/svg+xml") {
    const svg = content.toString("utf8")
    if (!/^\s*<svg[\s>]/i.test(svg) || /<script\b|\bon[a-z]+\s*=|<foreignObject\b|javascript:/i.test(svg)) {
      throw assetError("SVG contains unsafe markup")
    }
  }
  return { mimeType, content, isAnimated: mimeType === "image/svg+xml" && /<animate(?:Transform|Motion)?\b/i.test(content.toString("utf8")) }
}

export async function savePortalAsset(input = {}) {
  const assetKey = text(input.assetKey)
  const kind = text(input.kind) || "portal"
  const ownerType = text(input.ownerType) || null
  const ownerId = text(input.ownerId) || null
  if (!assetKey) throw assetError("Asset key is required")
  const decoded = decodeDataUrl(input.dataUrl)
  const prisma = await getSharedPrismaClient()
  const row = await prisma.portalAsset.upsert({
    where: { assetKey },
    create: {
      assetKey, kind, ownerType, ownerId, mimeType: decoded.mimeType,
      contentText: decoded.mimeType === "image/svg+xml" ? decoded.content.toString("utf8") : null,
      contentBytes: decoded.mimeType === "image/svg+xml" ? null : decoded.content,
      isAnimated: decoded.isAnimated,
      sha256: assetSha256(decoded.content),
      metadataJson: input.metadata && typeof input.metadata === "object" ? input.metadata : undefined,
    },
    update: {
      kind, ownerType, ownerId, mimeType: decoded.mimeType,
      contentText: decoded.mimeType === "image/svg+xml" ? decoded.content.toString("utf8") : null,
      contentBytes: decoded.mimeType === "image/svg+xml" ? null : decoded.content,
      isAnimated: decoded.isAnimated,
      sha256: assetSha256(decoded.content),
      metadataJson: input.metadata && typeof input.metadata === "object" ? input.metadata : undefined,
    },
  })
  return { id: row.id, assetKey: row.assetKey, kind: row.kind, mimeType: row.mimeType, isAnimated: row.isAnimated, sha256: row.sha256, updatedAt: row.updatedAt.toISOString() }
}

export async function readPortalAsset(assetKey) {
  const prisma = await getSharedPrismaClient()
  const row = await prisma.portalAsset.findUnique({ where: { assetKey: text(assetKey) } })
  if (!row) return null
  const content = row.contentText ? Buffer.from(row.contentText, "utf8") : Buffer.from(row.contentBytes || [])
  return { ...row, content }
}
