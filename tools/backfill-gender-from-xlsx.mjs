#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import xlsx from "xlsx"

import { getSharedPrismaClient } from "../server/prisma-client-factory.mjs"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizePositiveInteger(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = Number.parseInt(text, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return parsed
}

function normalizeTextArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  }
  const text = normalizeText(value)
  if (!text) return []
  return text
    .split(/[;,|]/g)
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
}

function dedupeStable(values = []) {
  const seen = new Set()
  const output = []
  for (const value of values) {
    const key = normalizeLower(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(normalizeText(value))
  }
  return output
}

function getValueByAliases(row, aliases = []) {
  const rows = row && typeof row === "object" ? row : {}
  const entries = Object.entries(rows)
  const aliasSet = new Set(aliases.map((alias) => normalizeLower(alias)))
  for (const [key, value] of entries) {
    if (aliasSet.has(normalizeLower(key))) return value
  }
  return ""
}

function parseArgs(argv = []) {
  const args = {
    file: "docs/students/eaglesclub-students-import-ready-single.xlsx",
    sheet: "",
    apply: false,
    limit: 0,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = normalizeText(argv[i])
    if (!token) continue
    if (token === "--apply") {
      args.apply = true
      continue
    }
    if (token === "--file") {
      args.file = normalizeText(argv[i + 1])
      i += 1
      continue
    }
    if (token === "--sheet") {
      args.sheet = normalizeText(argv[i + 1])
      i += 1
      continue
    }
    if (token === "--limit") {
      const parsed = Number.parseInt(normalizeText(argv[i + 1]), 10)
      args.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
      i += 1
      continue
    }
  }

  return args
}

function countRowsWithValue(rows = [], fieldName = "") {
  const key = normalizeText(fieldName)
  if (!key) return 0
  return rows.reduce((total, row) => (normalizeText(row?.[key]) ? total + 1 : total), 0)
}

function countRowsWithIdentityPair(rows = []) {
  return rows.reduce((total, row) => {
    const eaglesId = normalizeText(getValueByAliases(row, ["eaglesId"]))
    const studentNumber = normalizePositiveInteger(getValueByAliases(row, ["studentNumber"]))
    return eaglesId && studentNumber ? total + 1 : total
  }, 0)
}

function normalizeWorkbookRows(rows = []) {
  if (!Array.isArray(rows)) return []
  return rows.filter((row) => {
    if (!row || typeof row !== "object") return false
    return Object.values(row).some((value) => normalizeText(value))
  })
}

function chooseSheet(workbook, preferredSheet = "") {
  const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : []
  if (!sheetNames.length) return { sheetName: "", rows: [] }

  const explicit = normalizeText(preferredSheet)
  if (explicit) {
    const chosen = sheetNames.find((entry) => normalizeLower(entry) === normalizeLower(explicit)) || ""
    if (chosen) {
      const sheetRows = normalizeWorkbookRows(
        xlsx.utils.sheet_to_json(workbook.Sheets[chosen], { defval: "", raw: false })
      )
      return { sheetName: chosen, rows: sheetRows }
    }
  }

  const ranked = sheetNames
    .map((sheetName, index) => {
      const sheetRows = normalizeWorkbookRows(
        xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false })
      )
      const rowCount = sheetRows.length
      const identityPairCount = countRowsWithIdentityPair(sheetRows)
      const studentNumberCount = countRowsWithValue(sheetRows, "studentNumber")
      const eaglesIdCount = countRowsWithValue(sheetRows, "eaglesId")
      const score = identityPairCount * 1000 + studentNumberCount * 20 + eaglesIdCount * 5 + rowCount
      return {
        index,
        sheetName,
        rows: sheetRows,
        score,
        rowCount,
        identityPairCount,
        studentNumberCount,
        eaglesIdCount,
      }
    })
    .filter((entry) => entry.rowCount > 0)

  if (!ranked.length) return { sheetName: sheetNames[0] || "", rows: [] }

  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (right.identityPairCount !== left.identityPairCount) return right.identityPairCount - left.identityPairCount
    if (right.studentNumberCount !== left.studentNumberCount) return right.studentNumberCount - left.studentNumberCount
    if (right.eaglesIdCount !== left.eaglesIdCount) return right.eaglesIdCount - left.eaglesIdCount
    if (right.rowCount !== left.rowCount) return right.rowCount - left.rowCount
    return left.index - right.index
  })

  return { sheetName: ranked[0].sheetName, rows: ranked[0].rows }
}

function normalizeGenderForCompare(values = []) {
  return dedupeStable(values).map((entry) => normalizeLower(entry)).sort()
}

function sameGender(left = [], right = []) {
  const leftNormalized = normalizeGenderForCompare(left)
  const rightNormalized = normalizeGenderForCompare(right)
  if (leftNormalized.length !== rightNormalized.length) return false
  for (let i = 0; i < leftNormalized.length; i += 1) {
    if (leftNormalized[i] !== rightNormalized[i]) return false
  }
  return true
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const filePath = path.resolve(process.cwd(), args.file)
  if (!fs.existsSync(filePath)) {
    throw new Error(`XLSX file not found: ${filePath}`)
  }

  const workbook = xlsx.readFile(filePath)
  const selected = chooseSheet(workbook, args.sheet)
  if (!selected.sheetName) {
    throw new Error("No workbook sheet found")
  }

  const sourceRows = Array.isArray(selected.rows) ? selected.rows : []
  const effectiveRows = args.limit > 0 ? sourceRows.slice(0, args.limit) : sourceRows

  const parsedRows = effectiveRows.map((row, index) => {
    const eaglesId = normalizeText(getValueByAliases(row, ["eaglesId"]))
    const studentNumber = normalizePositiveInteger(getValueByAliases(row, ["studentNumber"]))
    const genderSelections = dedupeStable(
      normalizeTextArray(getValueByAliases(row, ["gender", "genderSelections", "sex"]))
    )
    return {
      rowNumber: index + 2,
      eaglesId,
      studentNumber,
      genderSelections,
    }
  })

  const eaglesIds = Array.from(new Set(parsedRows.map((row) => row.eaglesId).filter(Boolean)))
  const prisma = await getSharedPrismaClient()
  const students = await prisma.student.findMany({
    where: {
      eaglesId: { in: eaglesIds },
    },
    select: {
      id: true,
      eaglesId: true,
      studentNumber: true,
      profile: {
        select: {
          studentRefId: true,
          genderSelections: true,
        },
      },
    },
  })

  const studentByEaglesId = new Map(
    students.map((student) => [normalizeLower(student.eaglesId), student])
  )

  const summary = {
    filePath,
    sheetName: selected.sheetName,
    scannedRows: parsedRows.length,
    applyMode: args.apply,
    missingIdentity: 0,
    missingGender: 0,
    studentNotFound: 0,
    identityMismatch: 0,
    profileMissing: 0,
    unchanged: 0,
    updatesPrepared: 0,
    updatesApplied: 0,
  }

  const updates = []
  const mismatchSamples = []
  for (const row of parsedRows) {
    if (!row.eaglesId || !row.studentNumber) {
      summary.missingIdentity += 1
      continue
    }
    if (!row.genderSelections.length) {
      summary.missingGender += 1
      continue
    }

    const student = studentByEaglesId.get(normalizeLower(row.eaglesId))
    if (!student) {
      summary.studentNotFound += 1
      if (mismatchSamples.length < 20) mismatchSamples.push(`row ${row.rowNumber}: no student for eaglesId=${row.eaglesId}`)
      continue
    }

    const dbStudentNumber = normalizePositiveInteger(student.studentNumber)
    if (!dbStudentNumber || dbStudentNumber !== row.studentNumber) {
      summary.identityMismatch += 1
      if (mismatchSamples.length < 20) {
        mismatchSamples.push(
          `row ${row.rowNumber}: identity mismatch eaglesId=${row.eaglesId}, xlsx studentNumber=${row.studentNumber}, db studentNumber=${dbStudentNumber || "n/a"}`
        )
      }
      continue
    }

    if (!student.profile?.studentRefId) {
      summary.profileMissing += 1
      if (mismatchSamples.length < 20) mismatchSamples.push(`row ${row.rowNumber}: profile missing for eaglesId=${row.eaglesId}`)
      continue
    }

    const currentGender = dedupeStable(student.profile.genderSelections || [])
    const nextGender = dedupeStable(row.genderSelections)
    if (sameGender(currentGender, nextGender)) {
      summary.unchanged += 1
      continue
    }

    updates.push({
      studentRefId: student.profile.studentRefId,
      eaglesId: student.eaglesId,
      studentNumber: dbStudentNumber,
      currentGender,
      nextGender,
    })
  }

  summary.updatesPrepared = updates.length

  if (args.apply && updates.length) {
    await prisma.$transaction(
      updates.map((entry) =>
        prisma.studentProfile.update({
          where: { studentRefId: entry.studentRefId },
          data: { genderSelections: entry.nextGender },
        })
      )
    )
    summary.updatesApplied = updates.length
  }

  const report = {
    summary,
    sampleUpdates: updates.slice(0, 20).map((entry) => ({
      eaglesId: entry.eaglesId,
      studentNumber: entry.studentNumber,
      currentGender: entry.currentGender,
      nextGender: entry.nextGender,
    })),
    sampleIssues: mismatchSamples,
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(String(error?.stack || error))
  process.exitCode = 1
})
