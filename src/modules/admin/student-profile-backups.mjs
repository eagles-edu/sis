// @ts-check

import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

const DEFAULT_PROFILE_BACKUP_DIR = "/home/eagles/dockerz/backups/profile-history"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function backupDirectory() {
  return normalizeText(process.env.SIS_PROFILE_BACKUP_DIR) || DEFAULT_PROFILE_BACKUP_DIR
}

function isSensitiveKey(key) {
  const normalized = normalizeText(key).toLowerCase().replace(/[^a-z0-9]/g, "")
  return normalized === "password" || normalized === "passwordhash" || normalized === "passphrase"
}

/**
 * Remove credentials from an object before it leaves the application process.
 * @param {unknown} value
 * @returns {unknown}
 */
export function sanitizeStudentProfileBackup(value) {
  if (Array.isArray(value)) return value.map((entry) => sanitizeStudentProfileBackup(entry))
  if (!value || typeof value !== "object") return value
  const output = {}
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue
    output[key] = sanitizeStudentProfileBackup(entry)
  }
  return output
}

/**
 * Write an immutable, credential-free snapshot before or after an admin profile edit.
 * The pre-save snapshot is required for the edit to proceed; callers should fail closed
 * if this function rejects.
 * @param {{ studentRefId?: unknown, action: string, phase: string, actorUsername?: unknown, actorRole?: unknown, data?: unknown }} input
 * @returns {Promise<{ path: string, checksumSha256: string }>}
 */
export async function writeStudentProfileBackupSnapshot(input = {}) {
  const studentRefId = normalizeText(input.studentRefId) || "new-student"
  const now = new Date()
  const timestamp = now.toISOString().replace(/[-:.]/g, "").replace(/Z$/, "Z")
  const directory = path.resolve(backupDirectory())
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  await fs.chmod(directory, 0o700)

  const snapshot = {
    schemaVersion: 1,
    capturedAt: now.toISOString(),
    timezone: "Asia/Ho_Chi_Minh",
    studentRefId,
    action: normalizeText(input.action),
    phase: normalizeText(input.phase),
    actor: {
      username: normalizeText(input.actorUsername) || "unknown",
      role: normalizeText(input.actorRole) || "unknown",
    },
    data: sanitizeStudentProfileBackup(input.data),
  }
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`
  const checksumSha256 = crypto.createHash("sha256").update(serialized).digest("hex")
  const safeStudentRefId = studentRefId.replace(/[^a-zA-Z0-9._-]/g, "_")
  const filePath = path.join(directory, `${timestamp}-${safeStudentRefId}-${normalizeText(input.phase) || "snapshot"}-${crypto.randomUUID()}.json`)
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" })
  await fs.rename(temporaryPath, filePath)
  await fs.chmod(filePath, 0o600)
  return { path: filePath, checksumSha256 }
}
