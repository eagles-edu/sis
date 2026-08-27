import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"

export const LIBRARY_MEDIA_MAX_BYTES = 5 * 1024 * 1024
const AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/x-mpeg"])
const AUDIO_PROVIDER_HOSTNAMES = new Map([
  ["ldoce", new Set(["ldoceonline.com", "www.ldoceonline.com"])],
  ["oxford", new Set(["oxfordlearnersdictionaries.com", "www.oxfordlearnersdictionaries.com"])],
])

function text(value) { return String(value == null ? "" : value).trim() }

function mediaError(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }) }

export function libraryMediaRoot() {
  const configured = text(process.env.SIS_LIBRARY_MEDIA_ROOT)
  if (configured) return path.resolve(configured)
  const environment = text(process.env.NODE_ENV).toLowerCase() || "development"
  return path.resolve(process.cwd(), "..", "sis-library-media", environment)
}

export function validateLdoceAudioUrl(sourceUrl) {
  return validateLibraryAudioUrl(sourceUrl, "ldoce")
}

export function validateLibraryAudioUrl(sourceUrl, provider = "ldoce") {
  let parsed
  try { parsed = new URL(sourceUrl) } catch { throw mediaError("Audio source URL is invalid") }
  const hostnames = AUDIO_PROVIDER_HOSTNAMES.get(text(provider).toLowerCase())
  if (parsed.protocol !== "https:" || !hostnames?.has(parsed.hostname.toLowerCase())) throw mediaError("Audio source host is not allowed")
  return parsed.toString()
}

async function boundedBytes(response) {
  const contentLength = Number.parseInt(response.headers.get("content-length") || "0", 10)
  if (contentLength > LIBRARY_MEDIA_MAX_BYTES) throw mediaError("Audio exceeds the permitted size")
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > LIBRARY_MEDIA_MAX_BYTES) throw mediaError("Audio exceeds the permitted size")
    return buffer
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > LIBRARY_MEDIA_MAX_BYTES) throw mediaError("Audio exceeds the permitted size")
      chunks.push(Buffer.from(next.value))
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks)
}

export async function fetchLibraryAudio({ sourceUrl, provider = "ldoce", fetchImpl = fetch }) {
  const sourceProvider = text(provider).toLowerCase() || "ldoce"
  const url = validateLibraryAudioUrl(sourceUrl, sourceProvider)
  let response
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "audio/mpeg", "User-Agent": `SIS-admin-${sourceProvider.toUpperCase()}-audio/1.0` },
      redirect: "follow",
    })
  } catch (error) {
    throw mediaError(`Audio source is unavailable; ${error.message}`, 503)
  }
  if (!response.ok) throw mediaError(`Audio source is unavailable (HTTP ${response.status || 503})`, 503)
  const finalUrl = response.url ? validateLibraryAudioUrl(response.url, sourceProvider) : url
  const mimeType = text(response.headers.get("content-type")).split(";", 1)[0].toLowerCase()
  if (!AUDIO_MIME_TYPES.has(mimeType)) throw mediaError("Audio source did not return an MP3", 502)
  const content = await boundedBytes(response)
  if (!content.length) throw mediaError("Audio source returned an empty file", 502)
  return { sourceUrl: finalUrl, mimeType: "audio/mpeg", byteLength: content.length, content }
}

export async function downloadLibraryAudio({ sourceUrl, entryId, dialect, provider = "ldoce", fetchImpl = fetch }) {
  const sourceProvider = text(provider).toLowerCase() || "ldoce"
  const fetched = await fetchLibraryAudio({ sourceUrl, provider: sourceProvider, fetchImpl })
  const { content } = fetched
  const sha256 = crypto.createHash("sha256").update(content).digest("hex")
  const storagePath = path.posix.join(sourceProvider, `${sha256}.mp3`)
  const root = libraryMediaRoot()
  const finalPath = path.resolve(root, storagePath)
  const relativeRoot = `${root}${path.sep}`
  if (!finalPath.startsWith(relativeRoot)) throw mediaError("Audio storage path is invalid", 500)
  await fs.mkdir(path.dirname(finalPath), { recursive: true })
  const temporaryPath = `${finalPath}.tmp-${crypto.randomBytes(8).toString("hex")}`
  await fs.writeFile(temporaryPath, content, { flag: "wx", mode: 0o600 })
  return { entryId: text(entryId), provider: sourceProvider, dialect: text(dialect), sourceUrl: fetched.sourceUrl, storagePath, finalPath, temporaryPath, mimeType: fetched.mimeType, byteLength: fetched.byteLength, sha256 }
}

export async function finalizeLibraryAudio(download) {
  const existing = await fs.stat(download.finalPath).catch(() => null)
  if (existing?.isFile()) {
    await fs.rm(download.temporaryPath, { force: true })
    return { ...download, createdFile: false }
  }
  await fs.rename(download.temporaryPath, download.finalPath)
  return { ...download, createdFile: true }
}

export async function discardLibraryAudio(download) {
  if (!download) return
  await fs.rm(download.temporaryPath, { force: true }).catch(() => {})
}

export async function removeLibraryAudio(download) {
  if (!download?.finalPath) return
  await fs.rm(download.finalPath, { force: true }).catch(() => {})
}

export async function upsertLibraryMediaAsset(client, download, actor = {}) {
  return client.libraryMediaAsset.upsert({
    where: { entryId_provider_dialect: { entryId: download.entryId, provider: download.provider, dialect: download.dialect } },
    create: { entryId: download.entryId, provider: download.provider, dialect: download.dialect, sourceUrl: download.sourceUrl, storagePath: download.storagePath, mimeType: download.mimeType, byteLength: download.byteLength, sha256: download.sha256, actorName: text(actor.name), actorRole: text(actor.role) || "admin" },
    update: { sourceUrl: download.sourceUrl, storagePath: download.storagePath, mimeType: download.mimeType, byteLength: download.byteLength, sha256: download.sha256, actorName: text(actor.name), actorRole: text(actor.role) || "admin" },
  })
}

export async function getLibraryMediaAsset(id, client = null) {
  const prisma = client || await getSharedPrismaClient()
  const row = await prisma.libraryMediaAsset.findUnique({ where: { id: text(id) } })
  if (!row) return null
  const root = libraryMediaRoot()
  const filePath = path.resolve(root, row.storagePath)
  if (!filePath.startsWith(`${root}${path.sep}`)) throw mediaError("Stored media path is invalid", 500)
  return { ...row, filePath }
}

export async function libraryMediaManifest(client = null) {
  const prisma = client || await getSharedPrismaClient()
  const rows = await prisma.libraryMediaAsset.findMany({ orderBy: [{ provider: "asc" }, { dialect: "asc" }, { createdAt: "asc" }] })
  return rows.map((row) => ({ id: row.id, entryId: row.entryId, provider: row.provider, dialect: row.dialect, storagePath: row.storagePath, mimeType: row.mimeType, byteLength: row.byteLength, sha256: row.sha256, sourceUrl: row.sourceUrl, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }))
}
