import { randomUUID } from "node:crypto"
import { getPortalPreferences, savePortalPreferences } from "./portal-preference-store.mjs"

const ALERT_PRINCIPAL_TYPE = "system"
const ALERT_PRINCIPAL_ID = "analytics-opt-out-alerts"
const MAX_ALERTS = 100

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function normalizeAlert(value) {
  const source = safeObject(value)
  const occurredAt = new Date(text(source.occurredAt))
  if (!text(source.id) || !text(source.principalType) || !text(source.principalId) || Number.isNaN(occurredAt.valueOf())) return null
  return {
    id: text(source.id),
    principalType: text(source.principalType),
    principalId: text(source.principalId),
    occurredAt: occurredAt.toISOString(),
  }
}

function readAlerts(payload) {
  return (Array.isArray(safeObject(payload).items) ? safeObject(payload).items : [])
    .map(normalizeAlert)
    .filter(Boolean)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
}

export async function recordAnalyticsOptOutAlert({ principalType, principalId, occurredAt = new Date() } = {}) {
  const type = text(principalType)
  const id = text(principalId)
  const when = new Date(occurredAt)
  if (!type || !id || Number.isNaN(when.valueOf())) return null

  const current = await getPortalPreferences(ALERT_PRINCIPAL_TYPE, ALERT_PRINCIPAL_ID)
  const item = {
    id: randomUUID(),
    principalType: type,
    principalId: id,
    occurredAt: when.toISOString(),
  }
  const items = [item, ...readAlerts(current.preferences)].slice(0, MAX_ALERTS)
  await savePortalPreferences(ALERT_PRINCIPAL_TYPE, ALERT_PRINCIPAL_ID, { items }, {
    migrationVersion: Math.max(1, Number(current.migrationVersion) || 1),
  })
  return item
}

export async function listAnalyticsOptOutAlerts({ take = 20 } = {}) {
  const current = await getPortalPreferences(ALERT_PRINCIPAL_TYPE, ALERT_PRINCIPAL_ID)
  const limit = Math.min(MAX_ALERTS, Math.max(1, Number.parseInt(String(take), 10) || 20))
  return readAlerts(current.preferences).slice(0, limit)
}
