// @ts-check

function text(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function lower(value) {
  return text(value).toLowerCase()
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower(value))
}

function isTrue(value) {
  return ["1", "true", "yes", "on", "y", "có", "co", "si", "sí"].includes(lower(value))
}

/**
 * The profile form historically stored these flags in rawFormPayload. Read
 * that copy as well until every existing profile has been migrated.
 */
function proctorValue(profile, field) {
  const direct = profile?.[field]
  if (text(direct)) return direct
  const raw = profile?.rawFormPayload && typeof profile.rawFormPayload === "object"
    ? profile.rawFormPayload
    : {}
  return raw[field]
}

/** @param {Record<string, unknown>} profile */
export function parentProctorEmails(profile = {}) {
  const candidates = [
    [profile.motherEmail, proctorValue(profile, "maIsHomeworkProctor")],
    [profile.fatherEmail, proctorValue(profile, "baIsHomeworkProctor")],
  ]
  const hasExplicitSelection = candidates.some(([, flag]) => text(flag))
  const selected = candidates.filter(([, flag]) => !hasExplicitSelection || isTrue(flag))
  return Array.from(new Set(selected.map(([address]) => lower(address)).filter(isEmail)))
}

export function studentProctorSelectionIsExplicit(profile = {}) {
  return ["maIsHomeworkProctor", "baIsHomeworkProctor"]
    .some((field) => text(proctorValue(profile, field)))
}
