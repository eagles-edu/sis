#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

import { getSharedPrismaClient } from "../server/prisma-client-factory.mjs"

const DEFAULT_FROM_SCHOOL_YEAR = "2025-2026"
const DEFAULT_TO_SCHOOL_YEAR = "2026-2027"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function isSchoolYearLabel(value) {
  return /^[0-9]{4}-[0-9]{4}$/u.test(normalizeText(value))
}

function parseArgs(argv = []) {
  const args = {
    from: DEFAULT_FROM_SCHOOL_YEAR,
    to: DEFAULT_TO_SCHOOL_YEAR,
    apply: false,
    settingsFile: normalizeText(process.env.STUDENT_ADMIN_UI_SETTINGS_FILE) || "runtime-data/admin-ui-settings.json",
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = normalizeText(argv[index])
    if (!token) continue

    if (token === "--apply") {
      args.apply = true
      continue
    }
    if (token === "--from") {
      args.from = normalizeText(argv[index + 1])
      index += 1
      continue
    }
    if (token === "--to") {
      args.to = normalizeText(argv[index + 1])
      index += 1
      continue
    }
    if (token === "--settings-file") {
      args.settingsFile = normalizeText(argv[index + 1])
      index += 1
      continue
    }
    if (token === "--help" || token === "-h") {
      args.help = true
      continue
    }

    throw new Error(`Unknown argument: ${token}`)
  }

  return args
}

function printHelp() {
  console.log(`Usage: node tools/migrate-school-year-label.mjs [options]

Options:
  --from <YYYY-YYYY>         Source school year label (default: ${DEFAULT_FROM_SCHOOL_YEAR})
  --to <YYYY-YYYY>           Target school year label (default: ${DEFAULT_TO_SCHOOL_YEAR})
  --settings-file <path>     Admin UI settings JSON path (default: runtime-data/admin-ui-settings.json)
  --apply                    Execute updates. Without this flag, dry-run only.
  --help, -h                 Show help

Examples:
  node tools/migrate-school-year-label.mjs
  node tools/migrate-school-year-label.mjs --apply
  node tools/migrate-school-year-label.mjs --from 2025-2026 --to 2026-2027 --apply
`)
}

function resolveSettingsFilePath(value) {
  const text = normalizeText(value)
  if (!text) return ""
  return path.resolve(process.cwd(), text)
}

function readUiSettings(pathname) {
  try {
    if (!fs.existsSync(pathname)) return null
    const raw = fs.readFileSync(pathname, "utf8")
    if (!normalizeText(raw)) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function resolveUiSettingsContainer(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  if (payload.uiSettings && typeof payload.uiSettings === "object" && !Array.isArray(payload.uiSettings)) {
    return payload.uiSettings
  }
  return payload
}

function migrateUiSettingsSchoolYear(payload, from, to) {
  const source = payload && typeof payload === "object" ? payload : null
  if (!source) return { updated: false, payload }

  const container = resolveUiSettingsContainer(source)
  if (!container) return { updated: false, payload }

  const current = normalizeText(container?.schoolSetup?.schoolYear)
  if (current !== from) return { updated: false, payload }

  const nextPayload = JSON.parse(JSON.stringify(source))
  const nextContainer = resolveUiSettingsContainer(nextPayload)
  if (!nextContainer) return { updated: false, payload }
  if (!nextContainer.schoolSetup || typeof nextContainer.schoolSetup !== "object") {
    nextContainer.schoolSetup = {}
  }
  nextContainer.schoolSetup.schoolYear = to
  return {
    updated: true,
    payload: nextPayload,
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const from = normalizeText(args.from)
  const to = normalizeText(args.to)
  if (!isSchoolYearLabel(from)) throw new Error(`Invalid --from school year: ${from || "(empty)"}`)
  if (!isSchoolYearLabel(to)) throw new Error(`Invalid --to school year: ${to || "(empty)"}`)
  if (from === to) throw new Error("--from and --to must differ")

  const prisma = await getSharedPrismaClient()

  const reportRows = await prisma.parentClassReport.findMany({
    where: { schoolYear: from },
    select: {
      id: true,
      studentRefId: true,
      className: true,
      quarter: true,
    },
    orderBy: [{ generatedAt: "desc" }, { createdAt: "desc" }],
  })

  const reportConflictRows = []
  for (let index = 0; index < reportRows.length; index += 1) {
    const row = reportRows[index]
    const conflict = await prisma.parentClassReport.findFirst({
      where: {
        id: { not: row.id },
        studentRefId: row.studentRefId,
        className: row.className,
        quarter: row.quarter,
        schoolYear: to,
      },
      select: { id: true },
    })
    if (conflict?.id) {
      reportConflictRows.push({
        sourceId: row.id,
        conflictId: conflict.id,
        studentRefId: row.studentRefId,
        className: row.className,
        quarter: row.quarter,
      })
    }
  }

  const attendanceCount = await prisma.studentAttendance.count({ where: { schoolYear: from } })
  const gradeCount = await prisma.studentGradeRecord.count({ where: { schoolYear: from } })
  const reportCount = reportRows.length

  const migratableReportRows = reportRows.filter((row) => !reportConflictRows.some((entry) => entry.sourceId === row.id))

  const settingsFilePath = resolveSettingsFilePath(args.settingsFile)
  const uiSettingsPayload = settingsFilePath ? readUiSettings(settingsFilePath) : null
  const uiSettingsMigration = migrateUiSettingsSchoolYear(uiSettingsPayload, from, to)

  const summary = {
    mode: args.apply ? "apply" : "dry-run",
    from,
    to,
    tables: {
      studentAttendance: attendanceCount,
      studentGradeRecord: gradeCount,
      parentClassReport: reportCount,
      parentClassReportMigratable: migratableReportRows.length,
      parentClassReportConflicts: reportConflictRows.length,
    },
    uiSettings: {
      filePath: settingsFilePath || "",
      willUpdate: uiSettingsMigration.updated,
      found: Boolean(uiSettingsPayload),
    },
    conflicts: reportConflictRows,
  }

  if (!args.apply) {
    console.log(JSON.stringify(summary, null, 2))
    await prisma.$disconnect()
    return
  }

  const attendanceResult = await prisma.studentAttendance.updateMany({
    where: { schoolYear: from },
    data: { schoolYear: to },
  })
  const gradeResult = await prisma.studentGradeRecord.updateMany({
    where: { schoolYear: from },
    data: { schoolYear: to },
  })

  let parentUpdated = 0
  for (let index = 0; index < migratableReportRows.length; index += 1) {
    const row = migratableReportRows[index]
    const updatedCount = await prisma.$executeRaw`
      UPDATE "ParentClassReport"
      SET "schoolYear" = ${to}
      WHERE "id" = ${row.id}
    `
    parentUpdated += Number(updatedCount || 0)
  }

  let uiSettingsUpdated = false
  if (settingsFilePath && uiSettingsMigration.updated) {
    fs.mkdirSync(path.dirname(settingsFilePath), { recursive: true })
    fs.writeFileSync(settingsFilePath, `${JSON.stringify(uiSettingsMigration.payload, null, 2)}\n`, "utf8")
    uiSettingsUpdated = true
  }

  const appliedSummary = {
    ...summary,
    applied: {
      studentAttendance: attendanceResult.count,
      studentGradeRecord: gradeResult.count,
      parentClassReport: parentUpdated,
      parentClassReportConflictsSkipped: reportConflictRows.length,
      uiSettingsUpdated,
    },
  }

  console.log(JSON.stringify(appliedSummary, null, 2))
  await prisma.$disconnect()
}

run().catch((error) => {
  const message = normalizeText(error?.message) || "Unknown error"
  console.error(`[school-year-migrate] ${message}`)
  process.exitCode = 1
})
