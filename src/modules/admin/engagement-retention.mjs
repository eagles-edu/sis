export const ENGAGEMENT_RETENTION_DAYS = 15
export const ENGAGEMENT_RETENTION_MS = ENGAGEMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000

export function engagementRetentionCutoff(now = new Date()) {
  const nowDate = asDate(now) || new Date()
  return new Date(nowDate.getTime() - ENGAGEMENT_RETENTION_MS)
}

function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value
  if (value === undefined || value === null || String(value).trim() === "") return null
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? null : date
}

export function isEngagementVisible({ sentAt = null, completedAt = null, now = new Date() } = {}) {
  const sentDate = asDate(sentAt)
  if (!sentDate) return false
  const completedDate = asDate(completedAt)
  if (!completedDate) return true
  const nowDate = asDate(now) || new Date()
  return completedDate.getTime() >= engagementRetentionCutoff(nowDate).getTime()
}
