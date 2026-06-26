// @ts-check

import path from "node:path"

import { getSisConfigSnapshotSync } from "./sis-config-store.mjs"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeSchoolYear(value) {
  const text = normalizeText(value)
  return /^\d{4}-\d{4}$/.test(text) ? text : ""
}

function normalizeIsoDate(value) {
  const text = normalizeText(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ""
}

export function getAdminUiSettingsFilePath() {
  return path.resolve(
    process.cwd(),
    normalizeText(process.env.STUDENT_ADMIN_UI_SETTINGS_FILE) || "runtime-data/admin-ui-settings.json"
  )
}

export function readSchoolSetupSnapshot() {
  const filePath = getAdminUiSettingsFilePath()
  const configSnapshot = getSisConfigSnapshotSync()
  const schoolSetup = configSnapshot?.uiSettings?.schoolSetup && typeof configSnapshot.uiSettings.schoolSetup === "object" ?
    configSnapshot.uiSettings.schoolSetup :
    null
  const configHasMeaningfulSchoolSetup =
    Boolean(normalizeSchoolYear(schoolSetup?.schoolYear)) ||
    Boolean(normalizeIsoDate(schoolSetup?.startDate)) ||
    Boolean(normalizeIsoDate(schoolSetup?.endDate)) ||
    (Array.isArray(schoolSetup?.quarters) && schoolSetup.quarters.length > 0)
  if (configHasMeaningfulSchoolSetup) {
    return {
      filePath,
      schoolYear: normalizeSchoolYear(schoolSetup.schoolYear),
      startDate: normalizeIsoDate(schoolSetup.startDate),
      endDate: normalizeIsoDate(schoolSetup.endDate),
      schoolSetupState: normalizeText(schoolSetup.schoolSetupState) || "missing",
    }
  }
  return {
    filePath,
    schoolYear: "",
    startDate: "",
    endDate: "",
    schoolSetupState: "missing",
  }
}

export function getConfiguredSchoolYear({ required = false } = {}) {
  const snapshot = readSchoolSetupSnapshot()
  const schoolYear = normalizeSchoolYear(snapshot.schoolYear)
  if (schoolYear || !required) return schoolYear
  const error = new Error("School setup is missing a valid schoolYear")
  error.statusCode = 422
  throw error
}

export function getConfiguredSchoolYearStartDate({ fallback = new Date(), required = false } = {}) {
  const snapshot = readSchoolSetupSnapshot()
  const startDate = normalizeIsoDate(snapshot.startDate)
  if (startDate) {
    const parsed = new Date(`${startDate}T00:00:00.000Z`)
    if (!Number.isNaN(parsed.valueOf())) return parsed
  }
  if (required) {
    const error = new Error("School setup is missing a valid startDate")
    error.statusCode = 422
    throw error
  }
  return fallback instanceof Date ? new Date(fallback.getTime()) : new Date()
}
