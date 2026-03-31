#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

import {
  evaluateStudentNewsCompliance,
  listStudentNewsReportsForReview,
  mergeStudentNewsReviewNoteWithCompliance,
  reviewStudentNewsReport,
  updateStudentNewsValidationIssues,
} from "../server/student-admin-store.mjs"

const DEFAULT_TAKE = 200
const DEFAULT_REVIEWED_BY = "system:news-validation-audit"
const DEFAULT_STATUSES = ["submitted", "revision-requested"]

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeDomain(value) {
  const token = normalizeLower(value)
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/[#?].*$/, "")
    .replace(/^www\./, "")
    .trim()
  if (!token) return ""
  if (!token.includes(".")) return ""
  if (!/^[a-z0-9.-]+$/i.test(token)) return ""
  return token
}

function parseArgs(argv = []) {
  const args = {
    apply: false,
    take: DEFAULT_TAKE,
    reviewedBy: DEFAULT_REVIEWED_BY,
    statuses: [...DEFAULT_STATUSES],
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = normalizeText(argv[index])
    if (!token) continue
    if (token === "--apply") {
      args.apply = true
      continue
    }
    if (token === "--take") {
      index += 1
      const parsed = Number.parseInt(String(argv[index]), 10)
      if (!Number.isFinite(parsed) || parsed < 1) throw new Error("--take requires a positive integer")
      args.take = Math.min(parsed, 500)
      continue
    }
    if (token === "--reviewed-by") {
      index += 1
      const reviewer = normalizeText(argv[index])
      if (!reviewer) throw new Error("--reviewed-by requires a value")
      args.reviewedBy = reviewer
      continue
    }
    if (token === "--statuses") {
      index += 1
      const raw = normalizeText(argv[index])
      if (!raw) throw new Error("--statuses requires comma-separated values")
      const statuses = raw
        .split(",")
        .map((entry) => normalizeLower(entry))
        .filter(Boolean)
      args.statuses = statuses.length ? statuses : [...DEFAULT_STATUSES]
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
  console.log(`Usage: node tools/news-validation-audit.mjs [options]

Options:
  --apply                 Apply revision-requested review updates (default: dry-run)
  --take N                Max items to evaluate (default: ${DEFAULT_TAKE})
  --statuses a,b          Comma list: submitted,revision-requested,approved (default: ${DEFAULT_STATUSES.join(",")})
  --reviewed-by USER      Reviewed-by username for apply mode (default: ${DEFAULT_REVIEWED_BY})
  --help, -h              Show help

Examples:
  node tools/news-validation-audit.mjs
  node tools/news-validation-audit.mjs --apply
  node tools/news-validation-audit.mjs --apply --take 100 --statuses submitted,revision-requested
`)
}

function uiSettingsFilePath() {
  return path.resolve(
    process.cwd(),
    normalizeText(process.env.STUDENT_ADMIN_UI_SETTINGS_FILE) || "runtime-data/admin-ui-settings.json"
  )
}

function readUiSettings() {
  const filePath = uiSettingsFilePath()
  if (!fs.existsSync(filePath)) return {}
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    if (!normalizeText(raw)) return {}
    const parsed = JSON.parse(raw)
    const wrapped =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, "uiSettings")
    const settings = wrapped ? parsed.uiSettings : parsed
    return settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {}
  } catch (error) {
    void error
    return {}
  }
}

function resolveValidationConfigFromUiSettings() {
  const settings = readUiSettings()
  const validation = settings?.newsReportValidation && typeof settings.newsReportValidation === "object"
    ? settings.newsReportValidation
    : {}
  const defaults = validation?.defaultSources && typeof validation.defaultSources === "object"
    ? validation.defaultSources
    : {}
  const allowedDomains = []
  if (defaults.cnn !== false) allowedDomains.push("cnn.com")
  if (defaults.bbc !== false) allowedDomains.push("bbc.com")
  const custom = Array.isArray(validation?.customSources) ? validation.customSources : []
  custom.slice(0, 8).forEach((entry) => {
    if (!entry || typeof entry !== "object") return
    if (entry.enabled !== true) return
    const domain = normalizeDomain(entry.domain)
    if (!domain) return
    allowedDomains.push(domain)
  })
  const unique = Array.from(new Set(allowedDomains))
  return {
    allowedDomains: unique.length ? unique : ["cnn.com", "bbc.com"],
    thresholds: {
      articleTitle: 0.7,
      byline: 0.7,
      articleDateline: 0.7,
      leadSynopsis: 0.5,
    },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const requestedStatuses = new Set(args.statuses.map((entry) => normalizeLower(entry)))
  const validationConfig = resolveValidationConfigFromUiSettings()
  const listed = await listStudentNewsReportsForReview({
    status: "all",
    take: String(args.take),
  })
  const items = (Array.isArray(listed?.items) ? listed.items : [])
    .filter((item) => requestedStatuses.has(normalizeLower(item?.reviewStatus)))
    .filter((item) => normalizeLower(item?.reviewStatus) !== "approved")

  const findings = []
  for (const item of items) {
    const compliance = await evaluateStudentNewsCompliance(item, { validationConfig })
    if (compliance.passed) continue
    const update = updateStudentNewsValidationIssues(item?.validationIssuesJson, compliance)
    const reviewNote = mergeStudentNewsReviewNoteWithCompliance(item?.reviewNote, update.issues)
    findings.push({
      id: normalizeText(item?.id),
      student: normalizeText(item?.student?.eaglesId || item?.studentRefId),
      reportDate: normalizeText(item?.reportDate),
      failedFields: Object.keys(compliance.failedFields || {}),
      reviewNote,
      validationIssuesJson: update.issues,
      revisionTasks: compliance.revisionTasks,
    })
    if (args.apply) {
      await reviewStudentNewsReport(
        normalizeText(item?.id),
        {
          action: "revision-requested",
          reviewNote,
          validationIssuesJson: update.issues,
        },
        {
          reviewedByUsername: args.reviewedBy,
        }
      )
    }
  }

  const summary = {
    checked: items.length,
    failed: findings.length,
    applied: args.apply ? findings.length : 0,
    mode: args.apply ? "apply" : "dry-run",
    allowedDomains: validationConfig.allowedDomains,
  }

  console.log(JSON.stringify({ summary, findings }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error)
  process.exitCode = 1
})
