#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import readline from "node:readline"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"

import { getSharedPrismaClient } from "../server/prisma-client-factory.mjs"

const DEFAULT_ARCHIVE_ROOT = "backups/school-year-archive"
const DEFAULT_BATCH_SIZE = 500
const DEFAULT_PREVIEW_LIMIT = 25

function printHelp() {
  console.log(`Usage: node tools/school-year-rollover.mjs <command> [options]

Commands:
  archive   Export and purge one school year from active tables
  inspect   List archive runs or preview archived rows

Archive options:
  --school-year <YYYY-YYYY>      Required. Example: 2025-2026
  --start-date <YYYY-MM-DD>      Required. School year start date (inclusive)
  --end-date <YYYY-MM-DD>        Required. School year end date (inclusive)
  --archive-root <dir>           Archive root directory (default: ${DEFAULT_ARCHIVE_ROOT})
  --batch-size <n>               Batch size for export/purge (default: ${DEFAULT_BATCH_SIZE})
  --apply                        Execute archive + purge. Without this flag, dry-run only.
  --exclude-points               Skip StudentPointsAdjustment from rollover scope
  --exclude-notifications        Skip AdminNotificationQueue from rollover scope
  --exclude-parent-profile       Skip ParentProfileSubmissionQueue from rollover scope

Inspect options:
  --archive-root <dir>           Archive root directory (default: ${DEFAULT_ARCHIVE_ROOT})
  --school-year <YYYY-YYYY>      Filter to one school year
  --run <run-id>                 Select one archive run id (example: 20260317-040102Z)
  --dataset <name>               Preview dataset rows for selected run
  --limit <n>                    Max preview rows (default: ${DEFAULT_PREVIEW_LIMIT})
  --match <text>                 Optional text filter for preview rows
  --json                         Force JSON output

Examples:
  node tools/school-year-rollover.mjs archive --school-year 2025-2026 --start-date 2025-02-10 --end-date 2026-02-01
  node tools/school-year-rollover.mjs archive --school-year 2025-2026 --start-date 2025-02-10 --end-date 2026-02-01 --apply
  node tools/school-year-rollover.mjs inspect --school-year 2025-2026
  node tools/school-year-rollover.mjs inspect --school-year 2025-2026 --dataset studentGradeRecord --limit 40
`)
}

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(normalizeText(value), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return parsed
}

export function parseSchoolYearLabel(value) {
  const match = /^([0-9]{4})\s*-\s*([0-9]{4})$/u.exec(normalizeText(value))
  if (!match) return null
  const startYear = Number.parseInt(match[1], 10)
  const endYear = Number.parseInt(match[2], 10)
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || endYear !== startYear + 1) return null
  return `${startYear}-${endYear}`
}

function parseIsoDate(value) {
  const text = normalizeText(value)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return null
  const parsed = new Date(`${text}T00:00:00.000Z`)
  if (Number.isNaN(parsed.valueOf())) return null
  return parsed
}

function toIsoDate(date) {
  const year = String(date.getUTCFullYear())
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function toRunId(date = new Date()) {
  const year = String(date.getUTCFullYear())
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  const hour = String(date.getUTCHours()).padStart(2, "0")
  const minute = String(date.getUTCMinutes()).padStart(2, "0")
  const second = String(date.getUTCSeconds()).padStart(2, "0")
  return `${year}${month}${day}-${hour}${minute}${second}Z`
}

function nowIso() {
  return new Date().toISOString()
}

export function buildArchiveDateRange(startDateText, endDateText) {
  const startDate = parseIsoDate(startDateText)
  if (!startDate) throw new Error("Invalid --start-date. Expected YYYY-MM-DD")

  const endDate = parseIsoDate(endDateText)
  if (!endDate) throw new Error("Invalid --end-date. Expected YYYY-MM-DD")
  if (endDate.valueOf() < startDate.valueOf()) {
    throw new Error("--end-date must be on/after --start-date")
  }

  const endExclusive = new Date(endDate.valueOf())
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)

  return {
    startDate,
    endDate,
    endExclusive,
    startDateText: toIsoDate(startDate),
    endDateText: toIsoDate(endDate),
    endExclusiveDateText: toIsoDate(endExclusive),
  }
}

function datasetDefinitions(options = {}) {
  const definitions = [
    {
      key: "studentAttendance",
      model: "studentAttendance",
      filterMode: "schoolYear",
      description: "Attendance rows for target school year",
      whereDescription: "schoolYear = <target>",
      studentRefFields: ["studentRefId"],
    },
    {
      key: "studentGradeRecord",
      model: "studentGradeRecord",
      filterMode: "schoolYear",
      description: "Grade records for target school year",
      whereDescription: "schoolYear = <target>",
      studentRefFields: ["studentRefId"],
    },
    {
      key: "parentClassReport",
      model: "parentClassReport",
      filterMode: "schoolYear",
      description: "Parent class reports for target school year",
      whereDescription: "schoolYear = <target>",
      studentRefFields: ["studentRefId"],
    },
    {
      key: "exerciseSubmission",
      model: "exerciseSubmission",
      filterMode: "dateRange",
      dateField: "completedAt",
      description: "Exercise submissions completed inside target school-year date window",
      whereDescription: "completedAt >= <startDate> and completedAt < <endExclusive>",
      studentRefFields: ["studentRefId"],
    },
    {
      key: "incomingExerciseResult",
      model: "incomingExerciseResult",
      filterMode: "dateRange",
      dateField: "completedAt",
      description: "Incoming exercise queue results completed inside target school-year date window",
      whereDescription: "completedAt >= <startDate> and completedAt < <endExclusive>",
      studentRefFields: ["matchedStudentRefId"],
    },
    {
      key: "studentNewsReport",
      model: "studentNewsReport",
      filterMode: "dateRange",
      dateField: "reportDate",
      description: "Student news reports whose reportDate is inside target school-year date window",
      whereDescription: "reportDate >= <startDate> and reportDate < <endExclusive>",
      studentRefFields: ["studentRefId"],
    },
  ]

  if (!options.excludePoints) {
    definitions.push({
      key: "studentPointsAdjustment",
      model: "studentPointsAdjustment",
      filterMode: "dateRange",
      dateField: "appliedAt",
      description: "Student points adjustments applied inside target school-year date window",
      whereDescription: "appliedAt >= <startDate> and appliedAt < <endExclusive>",
      studentRefFields: ["studentRefId"],
    })
  }

  if (!options.excludeNotifications) {
    definitions.push({
      key: "adminNotificationQueue",
      model: "adminNotificationQueue",
      filterMode: "dateRange",
      dateField: "createdAt",
      description: "Admin notification queue items created inside target school-year date window",
      whereDescription: "createdAt >= <startDate> and createdAt < <endExclusive>",
      studentRefFields: [],
    })
  }

  if (!options.excludeParentProfile) {
    definitions.push({
      key: "parentProfileSubmissionQueue",
      model: "parentProfileSubmissionQueue",
      filterMode: "submittedOrCreatedRange",
      description: "Parent profile submission queue entries submitted/created inside target school-year date window",
      whereDescription:
        "submittedAt in range OR (submittedAt is null AND createdAt in range)",
      studentRefFields: ["studentRefId"],
    })
  }

  return definitions
}

function buildDatasetWhere(dataset, context) {
  if (dataset.filterMode === "schoolYear") {
    return { schoolYear: context.schoolYear }
  }

  if (dataset.filterMode === "dateRange") {
    return {
      [dataset.dateField]: {
        gte: context.startDate,
        lt: context.endExclusive,
      },
    }
  }

  if (dataset.filterMode === "submittedOrCreatedRange") {
    return {
      OR: [
        {
          submittedAt: {
            gte: context.startDate,
            lt: context.endExclusive,
          },
        },
        {
          AND: [
            { submittedAt: null },
            {
              createdAt: {
                gte: context.startDate,
                lt: context.endExclusive,
              },
            },
          ],
        },
      ],
    }
  }

  throw new Error(`Unsupported dataset filter mode: ${dataset.filterMode}`)
}

function combineWhere(left, right) {
  const leftValue = left && typeof left === "object" ? left : {}
  const rightValue = right && typeof right === "object" ? right : {}
  return { AND: [leftValue, rightValue] }
}

async function ensureDirectory(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true })
}

function writeManifestAtomic(filePath, payload) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  const json = `${JSON.stringify(payload, null, 2)}\n`
  return fsp
    .writeFile(tmpPath, json, "utf8")
    .then(() => fsp.rename(tmpPath, filePath))
    .catch(async (error) => {
      await fsp.unlink(tmpPath).catch(() => {})
      throw error
    })
}

async function streamRowsToGzipNdjson(filePath, rows) {
  await ensureDirectory(path.dirname(filePath))

  const output = fs.createWriteStream(filePath)
  const gzip = zlib.createGzip({ level: 9 })
  const lineHash = crypto.createHash("sha256")

  const donePromise = new Promise((resolve, reject) => {
    output.on("finish", resolve)
    output.on("error", reject)
    gzip.on("error", reject)
  })

  gzip.pipe(output)

  for (let index = 0; index < rows.length; index += 1) {
    const line = `${JSON.stringify(rows[index])}\n`
    lineHash.update(line)
    if (!gzip.write(line, "utf8")) {
      await new Promise((resolve) => gzip.once("drain", resolve))
    }
  }

  gzip.end()
  await donePromise

  const stat = await fsp.stat(filePath)
  return {
    lineSha256: lineHash.digest("hex"),
    fileSizeBytes: stat.size,
  }
}

async function readDatasetRows(prismaModel, where, batchSize) {
  const rows = []
  let lastId = ""

  while (true) {
    const cursorWhere = lastId ? combineWhere(where, { id: { gt: lastId } }) : where
    const batch = await prismaModel.findMany({
      where: cursorWhere,
      orderBy: { id: "asc" },
      take: batchSize,
    })

    if (!batch.length) break

    rows.push(...batch)
    lastId = normalizeText(batch[batch.length - 1]?.id)
    if (!lastId) break
    if (batch.length < batchSize) break
  }

  return rows
}

function collectStudentRefs(rows, studentRefFields = []) {
  const refs = new Set()
  if (!Array.isArray(studentRefFields) || !studentRefFields.length) return refs

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    for (let fieldIndex = 0; fieldIndex < studentRefFields.length; fieldIndex += 1) {
      const field = studentRefFields[fieldIndex]
      const refId = normalizeText(row?.[field])
      if (refId) refs.add(refId)
    }
  }

  return refs
}

async function archiveDatasets({ prisma, datasets, context, archiveDir, batchSize, apply }) {
  const datasetSummaries = []
  const allStudentRefs = new Set()

  for (let index = 0; index < datasets.length; index += 1) {
    const dataset = datasets[index]
    const prismaModel = prisma?.[dataset.model]
    if (!prismaModel?.count || !prismaModel?.findMany) {
      throw new Error(`Prisma model delegate unavailable: ${dataset.model}`)
    }

    const where = buildDatasetWhere(dataset, context)
    const totalRows = await prismaModel.count({ where })
    const summary = {
      key: dataset.key,
      model: dataset.model,
      description: dataset.description,
      whereDescription: dataset.whereDescription,
      where,
      rowCount: totalRows,
      archivedFile: "",
      archivedFileSizeBytes: 0,
      lineSha256: "",
      firstId: "",
      lastId: "",
      purgedCount: 0,
      remainingCount: totalRows,
    }

    if (!apply || totalRows === 0) {
      datasetSummaries.push(summary)
      continue
    }

    const rows = await readDatasetRows(prismaModel, where, batchSize)
    if (rows.length !== totalRows) {
      throw new Error(
        `Export read count mismatch for ${dataset.key}: counted ${totalRows}, read ${rows.length}`
      )
    }

    const archiveFile = `${dataset.key}.ndjson.gz`
    const archivePath = path.join(archiveDir, archiveFile)
    const { fileSizeBytes, lineSha256 } = await streamRowsToGzipNdjson(archivePath, rows)

    summary.archivedFile = archiveFile
    summary.archivedFileSizeBytes = fileSizeBytes
    summary.lineSha256 = lineSha256
    summary.firstId = normalizeText(rows[0]?.id)
    summary.lastId = normalizeText(rows[rows.length - 1]?.id)

    const refs = collectStudentRefs(rows, dataset.studentRefFields)
    refs.forEach((value) => allStudentRefs.add(value))

    datasetSummaries.push(summary)
  }

  return {
    datasetSummaries,
    allStudentRefs,
  }
}

async function archiveStudentSnapshot({ prisma, archiveDir, studentRefIds }) {
  const refIds = Array.from(studentRefIds)
  if (!refIds.length) {
    return {
      rowCount: 0,
      archivedFile: "",
      archivedFileSizeBytes: 0,
      lineSha256: "",
      firstId: "",
      lastId: "",
    }
  }

  const rows = await prisma.student.findMany({
    where: {
      id: {
        in: refIds,
      },
    },
    select: {
      id: true,
      externalKey: true,
      eaglesId: true,
      studentNumber: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      profile: {
        select: {
          fullName: true,
          englishName: true,
          schoolName: true,
          currentGrade: true,
          currentSchoolGrade: true,
        },
      },
    },
    orderBy: [{ eaglesId: "asc" }, { id: "asc" }],
  })

  const archiveFile = "studentSnapshot.ndjson.gz"
  const archivePath = path.join(archiveDir, archiveFile)
  const { fileSizeBytes, lineSha256 } = await streamRowsToGzipNdjson(archivePath, rows)

  return {
    rowCount: rows.length,
    archivedFile: archiveFile,
    archivedFileSizeBytes: fileSizeBytes,
    lineSha256,
    firstId: normalizeText(rows[0]?.id),
    lastId: normalizeText(rows[rows.length - 1]?.id),
  }
}

async function purgeDatasetRows(prismaModel, where, batchSize) {
  let deletedCount = 0

  while (true) {
    const batch = await prismaModel.findMany({
      where,
      select: { id: true },
      orderBy: { id: "asc" },
      take: batchSize,
    })

    if (!batch.length) break

    const ids = batch
      .map((entry) => normalizeText(entry?.id))
      .filter((value) => Boolean(value))

    if (!ids.length) break

    const deleted = await prismaModel.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    })

    deletedCount += Number.parseInt(String(deleted?.count || 0), 10) || 0
    if (batch.length < batchSize) break
  }

  return deletedCount
}

async function purgeArchivedDatasets({ prisma, datasets, context, batchSize, datasetSummaries }) {
  for (let index = 0; index < datasets.length; index += 1) {
    const dataset = datasets[index]
    const summary = datasetSummaries[index]
    if (!summary || summary.rowCount < 1) continue

    const prismaModel = prisma?.[dataset.model]
    if (!prismaModel?.deleteMany || !prismaModel?.count || !prismaModel?.findMany) {
      throw new Error(`Prisma model delegate unavailable for purge: ${dataset.model}`)
    }

    const where = buildDatasetWhere(dataset, context)
    const purgedCount = await purgeDatasetRows(prismaModel, where, batchSize)
    const remainingCount = await prismaModel.count({ where })

    summary.purgedCount = purgedCount
    summary.remainingCount = remainingCount
  }
}

function filterManifestRows(rows, { schoolYear = "", run = "" } = {}) {
  const targetYear = parseSchoolYearLabel(schoolYear) || ""
  const targetRun = normalizeText(run)

  return rows.filter((row) => {
    const yearMatched = !targetYear || normalizeText(row?.schoolYear) === targetYear
    if (!yearMatched) return false
    if (!targetRun) return true
    return normalizeText(row?.runId) === targetRun
  })
}

async function listArchiveManifests(archiveRoot) {
  const root = path.resolve(archiveRoot)
  const manifests = []

  const years = await fsp.readdir(root, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return []
    throw error
  })

  for (let yearIndex = 0; yearIndex < years.length; yearIndex += 1) {
    const yearDir = years[yearIndex]
    if (!yearDir.isDirectory()) continue

    const yearPath = path.join(root, yearDir.name)
    const runs = await fsp.readdir(yearPath, { withFileTypes: true }).catch(() => [])

    for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
      const runDir = runs[runIndex]
      if (!runDir.isDirectory()) continue

      const runPath = path.join(yearPath, runDir.name)
      const manifestPath = path.join(runPath, "manifest.json")
      const manifestText = await fsp.readFile(manifestPath, "utf8").catch(() => "")
      if (!manifestText) continue

      try {
        const manifest = JSON.parse(manifestText)
        manifests.push({
          ...manifest,
          archivePath: runPath,
          manifestPath,
        })
      } catch {
        manifests.push({
          schoolYear: yearDir.name,
          runId: runDir.name,
          createdAt: "",
          status: "invalid-manifest",
          datasets: [],
          archivePath: runPath,
          manifestPath,
        })
      }
    }
  }

  manifests.sort((left, right) => {
    const leftTs = Date.parse(left?.createdAt || "") || 0
    const rightTs = Date.parse(right?.createdAt || "") || 0
    if (leftTs !== rightTs) return rightTs - leftTs
    return normalizeText(right?.runId).localeCompare(normalizeText(left?.runId))
  })

  return manifests
}

async function previewArchivedDatasetRows(datasetPath, { limit, match }) {
  const rows = []
  const needle = normalizeText(match)

  const source = fs.createReadStream(datasetPath)
  const gunzip = zlib.createGunzip()
  const input = source.pipe(gunzip)
  const rl = readline.createInterface({ input, crlfDelay: Infinity })

  for await (const line of rl) {
    const text = normalizeText(line)
    if (!text) continue
    if (needle && !text.includes(needle)) continue
    try {
      rows.push(JSON.parse(text))
    } catch {
      rows.push({ parseError: true, raw: text })
    }
    if (rows.length >= limit) break
  }

  rl.close()
  source.destroy()

  return rows
}

export function parseCliArgs(argv = []) {
  const tokens = Array.isArray(argv) ? [...argv] : []
  const firstToken = normalizeLower(tokens[0])

  if (!firstToken || firstToken === "--help" || firstToken === "-h" || firstToken === "help") {
    return {
      command: "help",
      schoolYear: "",
      startDate: "",
      endDate: "",
      archiveRoot: DEFAULT_ARCHIVE_ROOT,
      batchSize: DEFAULT_BATCH_SIZE,
      apply: false,
      excludePoints: false,
      excludeNotifications: false,
      excludeParentProfile: false,
      run: "",
      dataset: "",
      limit: DEFAULT_PREVIEW_LIMIT,
      match: "",
      json: false,
    }
  }

  const command = firstToken
  if (!["archive", "inspect"].includes(command)) {
    throw new Error(`Unknown command: ${tokens[0]}`)
  }

  const parsed = {
    command,
    schoolYear: "",
    startDate: "",
    endDate: "",
    archiveRoot: DEFAULT_ARCHIVE_ROOT,
    batchSize: DEFAULT_BATCH_SIZE,
    apply: false,
    excludePoints: false,
    excludeNotifications: false,
    excludeParentProfile: false,
    run: "",
    dataset: "",
    limit: DEFAULT_PREVIEW_LIMIT,
    match: "",
    json: false,
  }

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    const next = tokens[index + 1]

    if (token === "--school-year") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --school-year")
      parsed.schoolYear = next
      index += 1
      continue
    }

    if (token === "--start-date") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --start-date")
      parsed.startDate = next
      index += 1
      continue
    }

    if (token === "--end-date") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --end-date")
      parsed.endDate = next
      index += 1
      continue
    }

    if (token === "--archive-root") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --archive-root")
      parsed.archiveRoot = next
      index += 1
      continue
    }

    if (token === "--batch-size") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --batch-size")
      parsed.batchSize = toPositiveInt(next, DEFAULT_BATCH_SIZE)
      index += 1
      continue
    }

    if (token === "--run") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --run")
      parsed.run = next
      index += 1
      continue
    }

    if (token === "--dataset") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --dataset")
      parsed.dataset = next
      index += 1
      continue
    }

    if (token === "--limit") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --limit")
      parsed.limit = toPositiveInt(next, DEFAULT_PREVIEW_LIMIT)
      index += 1
      continue
    }

    if (token === "--match") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --match")
      parsed.match = next
      index += 1
      continue
    }

    if (token === "--apply") {
      parsed.apply = true
      continue
    }

    if (token === "--exclude-points") {
      parsed.excludePoints = true
      continue
    }

    if (token === "--exclude-notifications") {
      parsed.excludeNotifications = true
      continue
    }

    if (token === "--exclude-parent-profile") {
      parsed.excludeParentProfile = true
      continue
    }

    if (token === "--json") {
      parsed.json = true
      continue
    }

    if (token === "--help" || token === "-h") {
      parsed.command = "help"
      continue
    }

    throw new Error(`Unknown option: ${token}`)
  }

  return parsed
}

function assertArchiveArgs(args) {
  const schoolYear = parseSchoolYearLabel(args.schoolYear)
  if (!schoolYear) throw new Error("--school-year must be formatted as YYYY-YYYY and span exactly one year")

  const dateRange = buildArchiveDateRange(args.startDate, args.endDate)

  return {
    schoolYear,
    ...dateRange,
  }
}

function toCompactSummary(manifest = {}) {
  const datasets = Array.isArray(manifest?.datasets) ? manifest.datasets : []
  return {
    schoolYear: normalizeText(manifest?.schoolYear),
    runId: normalizeText(manifest?.runId),
    createdAt: normalizeText(manifest?.createdAt),
    status: normalizeText(manifest?.status),
    datasets: datasets.map((entry) => ({
      key: normalizeText(entry?.key),
      rowCount: Number.parseInt(String(entry?.rowCount || 0), 10) || 0,
      purgedCount: Number.parseInt(String(entry?.purgedCount || 0), 10) || 0,
      remainingCount: Number.parseInt(String(entry?.remainingCount || 0), 10) || 0,
      archivedFile: normalizeText(entry?.archivedFile),
    })),
    archivePath: normalizeText(manifest?.archivePath),
  }
}

async function runArchiveCommand(args) {
  const archiveRoot = path.resolve(normalizeText(args.archiveRoot) || DEFAULT_ARCHIVE_ROOT)
  const validated = assertArchiveArgs(args)
  const datasets = datasetDefinitions(args)

  const context = {
    schoolYear: validated.schoolYear,
    startDate: validated.startDate,
    endDate: validated.endDate,
    endExclusive: validated.endExclusive,
    startDateText: validated.startDateText,
    endDateText: validated.endDateText,
    endExclusiveDateText: validated.endExclusiveDateText,
  }

  const runId = toRunId(new Date())
  const archiveDir = path.join(archiveRoot, context.schoolYear, runId)
  const manifestPath = path.join(archiveDir, "manifest.json")

  const prisma = await getSharedPrismaClient()

  const manifest = {
    version: 1,
    command: "archive",
    status: args.apply ? "running" : "dry-run",
    createdAt: nowIso(),
    completedAt: "",
    schoolYear: context.schoolYear,
    dateWindow: {
      startDate: context.startDateText,
      endDate: context.endDateText,
      endExclusiveDate: context.endExclusiveDateText,
    },
    options: {
      apply: Boolean(args.apply),
      batchSize: args.batchSize,
      archiveRoot,
      excludePoints: Boolean(args.excludePoints),
      excludeNotifications: Boolean(args.excludeNotifications),
      excludeParentProfile: Boolean(args.excludeParentProfile),
    },
    runId,
    datasets: [],
    studentSnapshot: {
      rowCount: 0,
      archivedFile: "",
      archivedFileSizeBytes: 0,
      lineSha256: "",
      firstId: "",
      lastId: "",
    },
    errors: [],
  }

  try {
    if (args.apply) {
      await ensureDirectory(archiveDir)
    }

    const { datasetSummaries, allStudentRefs } = await archiveDatasets({
      prisma,
      datasets,
      context,
      archiveDir,
      batchSize: args.batchSize,
      apply: args.apply,
    })

    manifest.datasets = datasetSummaries

    if (args.apply) {
      manifest.studentSnapshot = await archiveStudentSnapshot({
        prisma,
        archiveDir,
        studentRefIds: allStudentRefs,
      })

      await writeManifestAtomic(manifestPath, manifest)

      await purgeArchivedDatasets({
        prisma,
        datasets,
        context,
        batchSize: args.batchSize,
        datasetSummaries,
      })

      manifest.status = "archived-and-purged"
      manifest.completedAt = nowIso()
      await writeManifestAtomic(manifestPath, manifest)
    }

    const result = {
      mode: args.apply ? "apply" : "dry-run",
      schoolYear: context.schoolYear,
      dateWindow: manifest.dateWindow,
      runId,
      archiveDir: args.apply ? archiveDir : "",
      datasets: manifest.datasets.map((entry) => ({
        key: entry.key,
        model: entry.model,
        rowCount: entry.rowCount,
        purgedCount: entry.purgedCount,
        remainingCount: entry.remainingCount,
        archivedFile: entry.archivedFile,
        archivedFileSizeBytes: entry.archivedFileSizeBytes,
      })),
      studentSnapshot: manifest.studentSnapshot,
      status: manifest.status,
    }

    return result
  } catch (error) {
    manifest.status = "failed"
    manifest.completedAt = nowIso()
    manifest.errors = [normalizeText(error?.message || error)]

    if (args.apply) {
      await ensureDirectory(path.dirname(manifestPath))
      await writeManifestAtomic(manifestPath, manifest).catch(() => {})
    }

    throw error
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
}

async function runInspectCommand(args) {
  const archiveRoot = path.resolve(normalizeText(args.archiveRoot) || DEFAULT_ARCHIVE_ROOT)
  const manifests = await listArchiveManifests(archiveRoot)
  const filtered = filterManifestRows(manifests, {
    schoolYear: args.schoolYear,
    run: args.run,
  })

  if (!normalizeText(args.dataset)) {
    return {
      command: "inspect",
      archiveRoot,
      totalRuns: filtered.length,
      runs: filtered.map((entry) => toCompactSummary(entry)),
    }
  }

  if (!filtered.length) {
    throw new Error("No archive run found for requested filters")
  }

  const selected = filtered[0]
  const datasetName = normalizeText(args.dataset)
  const dataset = (Array.isArray(selected?.datasets) ? selected.datasets : []).find(
    (entry) => normalizeText(entry?.key) === datasetName
  )
  if (!dataset) {
    throw new Error(`Dataset not found in selected run: ${datasetName}`)
  }

  if (!normalizeText(dataset.archivedFile)) {
    return {
      command: "inspect",
      archiveRoot,
      run: toCompactSummary(selected),
      dataset: datasetName,
      previewRows: [],
      note: "No archived file was generated for this dataset (likely 0 rows at archive time)",
    }
  }

  const datasetPath = path.join(selected.archivePath, dataset.archivedFile)
  const previewRows = await previewArchivedDatasetRows(datasetPath, {
    limit: args.limit,
    match: args.match,
  })

  return {
    command: "inspect",
    archiveRoot,
    run: toCompactSummary(selected),
    dataset: datasetName,
    datasetPath,
    previewLimit: args.limit,
    previewRows,
  }
}

function renderHumanReadable(result) {
  if (!result || typeof result !== "object") {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (normalizeLower(result.command) === "inspect") {
    const runs = Array.isArray(result.runs) ? result.runs : []
    if (!normalizeText(result.dataset)) {
      console.log(`Archive root: ${normalizeText(result.archiveRoot)}`)
      console.log(`Runs: ${runs.length}`)
      runs.forEach((run) => {
        console.log(`- ${run.schoolYear} / ${run.runId} / ${run.status}`)
        const datasets = Array.isArray(run.datasets) ? run.datasets : []
        datasets.forEach((dataset) => {
          console.log(
            `  ${dataset.key}: rows=${dataset.rowCount} purged=${dataset.purgedCount} remaining=${dataset.remainingCount}`
          )
        })
      })
      return
    }
  }

  if (normalizeLower(result.mode) === "apply" || normalizeLower(result.mode) === "dry-run") {
    console.log(`${result.mode.toUpperCase()} school-year rollover`)
    console.log(`School year: ${normalizeText(result.schoolYear)}`)
    const window = result.dateWindow || {}
    console.log(`Date window: ${normalizeText(window.startDate)} to ${normalizeText(window.endDate)} (inclusive)`)
    if (normalizeText(result.archiveDir)) console.log(`Archive: ${normalizeText(result.archiveDir)}`)
    const datasets = Array.isArray(result.datasets) ? result.datasets : []
    datasets.forEach((dataset) => {
      console.log(
        `- ${dataset.key}: rows=${dataset.rowCount} purged=${dataset.purgedCount} remaining=${dataset.remainingCount}`
      )
    })
    return
  }

  console.log(JSON.stringify(result, null, 2))
}

async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv)

  if (args.command === "help") {
    printHelp()
    return
  }

  if (args.command === "archive") {
    const result = await runArchiveCommand(args)
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    renderHumanReadable(result)
    return
  }

  if (args.command === "inspect") {
    const result = await runInspectCommand(args)
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    renderHumanReadable(result)
    return
  }

  throw new Error(`Unknown command: ${args.command}`)
}

const isEntrypoint = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isEntrypoint) {
  main().catch((error) => {
    const message = normalizeText(error?.message || error) || "Unknown error"
    console.error(`school-year-rollover: ${message}`)
    process.exit(1)
  })
}
