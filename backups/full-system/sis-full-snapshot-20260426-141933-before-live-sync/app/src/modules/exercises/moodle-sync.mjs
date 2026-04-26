// @ts-check
import crypto from "node:crypto"
const MOODLE_INTEGRATION_SOURCE = "moodle"
const MOODLE_REQUEST_HEADER_SOURCE = "x-sis-source"
const MOODLE_REQUEST_HEADER_TIMESTAMP = "x-sis-timestamp"
const MOODLE_REQUEST_HEADER_SIGNATURE = "x-sis-signature"
const MOODLE_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeHeaderValue(value) {
  return normalizeText(value)
}

function parseTimestampMs(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = Number.parseInt(text, 10)
  if (Number.isFinite(parsed)) return parsed * 1000
  const date = new Date(text)
  if (Number.isNaN(date.valueOf())) return null
  return date.valueOf()
}

function buildSigningInput(timestamp, rawBody) {
  return `${normalizeText(timestamp)}\n${normalizeText(rawBody)}`
}

/**
 * @param {string|number} timestamp
 * @param {string} rawBody
 * @param {string} sharedSecret
 * @returns {string}
 */
export function buildMoodleRequestSignature(timestamp, rawBody, sharedSecret) {
  const secret = normalizeText(sharedSecret)
  if (!secret) return ""

  return crypto
    .createHmac("sha256", secret)
    .update(buildSigningInput(timestamp, rawBody), "utf8")
    .digest("hex")
}

/**
 * @param {{
 *   source?: unknown,
 *   timestamp?: unknown,
 *   signature?: unknown,
 *   rawBody?: unknown,
 *   sharedSecret?: unknown,
 *   now?: number,
 *   maxAgeMs?: number,
 * }} options
 * @returns {{
 *   ok: boolean,
 *   reason: string,
 * }}
 */
export function verifyMoodleRequestSignature(options = {}) {
  const source = normalizeLower(options.source)
  if (source && source !== MOODLE_INTEGRATION_SOURCE) {
    return { ok: false, reason: "unsupported-source" }
  }

  const sharedSecret = normalizeText(options.sharedSecret)
  if (!sharedSecret) {
    return { ok: false, reason: "missing-secret" }
  }

  const rawBody = normalizeText(options.rawBody)
  if (!rawBody) {
    return { ok: false, reason: "missing-body" }
  }

  const timestampText = normalizeHeaderValue(options.timestamp)
  const signatureText = normalizeLower(options.signature)
  if (!timestampText || !signatureText) {
    return { ok: false, reason: "missing-signature" }
  }

  const timestampMs = parseTimestampMs(timestampText)
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: "invalid-timestamp" }
  }

  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
    ? Number(options.maxAgeMs)
    : MOODLE_SIGNATURE_MAX_AGE_MS
  if (Math.abs(now - timestampMs) > maxAgeMs) {
    return { ok: false, reason: "stale-request" }
  }

  const expected = crypto
    .createHmac("sha256", sharedSecret)
    .update(buildSigningInput(timestampText, rawBody), "utf8")
    .digest("hex")

  if (expected !== signatureText) {
    return { ok: false, reason: "invalid-signature" }
  }

  return { ok: true, reason: "" }
}

export {
  MOODLE_INTEGRATION_SOURCE,
  MOODLE_REQUEST_HEADER_SIGNATURE,
  MOODLE_REQUEST_HEADER_SOURCE,
  MOODLE_REQUEST_HEADER_TIMESTAMP,
  MOODLE_SIGNATURE_MAX_AGE_MS,
}
