// @ts-check

import fs from "node:fs/promises"
import path from "node:path"

import { assetSha256 } from "./portal-preference-store.mjs"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"

const MAX_ASSET_BYTES = 2 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(["image/svg+xml", "image/png", "image/jpeg", "image/webp"])

const DEFAULT_PORTAL_ASSETS = [
  { assetKey: "school-logo-default", fileName: "logo.svg", kind: "school-logo", ownerType: "system-config", ownerId: "school" },
  { assetKey: "class-level-eggs-chicks", fileName: "eggs-chicks.svg", kind: "class-level-tile", ownerType: "system-config", ownerId: "level:eggs-and-chicks" },
  { assetKey: "class-level-pre-a1-starters", fileName: "starters.svg", kind: "class-level-tile", ownerType: "system-config", ownerId: "level:pre-a1-starters" },
  { assetKey: "class-level-a1-movers", fileName: "movers.svg", kind: "class-level-tile", ownerType: "system-config", ownerId: "level:a1-movers" },
  { assetKey: "class-level-a2-flyers", fileName: "flyers.svg", kind: "class-level-tile", ownerType: "system-config", ownerId: "level:a2-flyers" },
  { assetKey: "class-level-a2-ket", fileName: "ket.svg", kind: "class-level-tile", ownerType: "system-config", ownerId: "level:a2-ket" },
  { assetKey: "class-level-b1-pet", fileName: "pet.svg", kind: "class-level-tile", ownerType: "system-config", ownerId: "level:b1-pet" },
]

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
    const svgMarkup = svg.replace(/^\s*(?:<\?xml[^>]*>\s*)?(?:<!DOCTYPE[^>]*>\s*)?/i, "")
    if (!/^\s*<svg[\s>]/i.test(svgMarkup) || /<script\b|\bon[a-z]+\s*=|<foreignObject\b|javascript:/i.test(svg)) {
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

/**
 * Seeds only missing built-in SVG assets. Existing DB assets, including
 * administrator replacements, are never overwritten.
 * @param {{ sourceRoot?: string }} [options]
 */
export async function ensureDefaultPortalAssets({ sourceRoot = process.cwd() } = {}) {
  const prisma = await getSharedPrismaClient()
  const imageRoot = path.resolve(sourceRoot, "web-asset", "images")
  const keys = DEFAULT_PORTAL_ASSETS.map(({ assetKey }) => assetKey)
  const existingRows = await prisma.portalAsset.findMany({
    where: { assetKey: { in: keys } },
    select: { assetKey: true },
  })
  const existing = new Set(existingRows.map(({ assetKey }) => assetKey))
  const seeded = []
  const skipped = []
  for (const definition of DEFAULT_PORTAL_ASSETS) {
    if (existing.has(definition.assetKey)) {
      skipped.push(definition.assetKey)
      continue
    }
    const content = await fs.readFile(path.join(imageRoot, definition.fileName))
    const dataUrl = `data:image/svg+xml;base64,${content.toString("base64")}`
    const asset = await savePortalAsset({
      assetKey: definition.assetKey,
      dataUrl,
      kind: definition.kind,
      ownerType: definition.ownerType,
      ownerId: definition.ownerId,
      metadata: { source: "web-asset/images", fileName: definition.fileName, builtIn: true },
    })
    seeded.push(asset.assetKey)
  }
  return { seeded, skipped }
}
