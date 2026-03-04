import fs from "node:fs"
import path from "node:path"
import xlsx from "xlsx"

const FORMFIELDS_SCHEMA_FILE = "docs/students/formfields (2026).xlsx"
const SOURCE_UPLOAD_FILE = "docs/students/current_matches_amalgamated.xlsx"
const ORDERED_OUTPUT_FILE = "docs/students/current_matches_amalgamated.canonical-ready.xlsx"
const IMPORT_READY_OUTPUT_FILE = "docs/students/current_matches_amalgamated.import-ready.xlsx"
const AUDIT_OUTPUT_FILE = "docs/students/current_matches_amalgamated.canonical-audit.json"
const BLANK_TEMPLATE_OUTPUT = "schemas/student-import-template.xlsx"
const FILLED_TEMPLATE_OUTPUT = "docs/students/student-import-template.filled-example.xlsx"
const STUDENT_NUMBER_FLOOR = 100

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeHeader(value) {
  return normalizeText(value).toLowerCase()
}

function normalizePositiveInteger(value) {
  const parsed = Number.parseInt(normalizeText(value), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return parsed
}

function ensureDirectoryForFile(filePath) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
}

function buildEaglesIdFromNumber(studentNumber) {
  const parsed = normalizePositiveInteger(studentNumber)
  if (!parsed) return ""
  return `SIS-${String(parsed).padStart(6, "0")}`
}

function readWorkbookRows(filePath) {
  const workbook = xlsx.readFile(filePath)
  const firstSheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheetName]
  const headerRow = (xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    raw: false,
  })[0] || []).map((entry) => normalizeText(entry))
  const rows = xlsx.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  })
  return {
    firstSheetName,
    headerRow,
    rows,
  }
}

function readSchemaHeaders(schemaFile) {
  const { headerRow } = readWorkbookRows(schemaFile)
  const cleaned = headerRow.map((entry) => normalizeText(entry)).filter(Boolean)
  if (!cleaned.length) throw new Error(`Schema workbook has no headers: ${schemaFile}`)
  if (normalizeHeader(cleaned[0]) === "database/field name") return cleaned.slice(1)
  return cleaned
}

function buildHeaderAliasMap(schemaHeaders) {
  const map = Object.fromEntries(
    schemaHeaders.map((header) => [header, [header]])
  )

  const pushAlias = (header, ...aliases) => {
    if (!map[header]) map[header] = [header]
    aliases.forEach((alias) => {
      if (!alias) return
      if (!map[header].includes(alias)) map[header].push(alias)
    })
  }

  pushAlias("studentPhoto", "photoUrl", "unnamed1")
  pushAlias("languagesHome", "whichLanguagesAreSpokenAtHome")

  return map
}

function rowValueByAliases(row, aliases = []) {
  const aliasSet = new Set(aliases.map((entry) => normalizeHeader(entry)))
  for (const [key, value] of Object.entries(row || {})) {
    if (!aliasSet.has(normalizeHeader(key))) continue
    if (typeof value === "string") return value.trim()
    return value
  }
  return ""
}

function buildOrderedRows(rows, schemaHeaders, aliasMap) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const next = {}
      schemaHeaders.forEach((header) => {
        next[header] = rowValueByAliases(row, aliasMap[header] || [header])
      })
      return next
    })
    .filter((row) => schemaHeaders.some((header) => normalizeText(row[header])))
}

function ensureUniqueEaglesId(baseId, usedKeys) {
  const normalizedBase = normalizeText(baseId)
  if (!normalizedBase) return ""
  let candidate = normalizedBase
  let suffix = 2
  while (usedKeys.has(normalizeHeader(candidate))) {
    candidate = `${normalizedBase}-${suffix}`
    suffix += 1
  }
  return candidate
}

function applyIdentityFixes(rows, floor = STUDENT_NUMBER_FLOOR) {
  const dataRows = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : []

  const rowsMissingEaglesIdBefore = []
  const rowsMissingStudentNumberBefore = []
  const rowsMovedLegacyIdFromStudentNumber = []

  dataRows.forEach((row, index) => {
    const eaglesId = normalizeText(row["eaglesId"])
    const studentNumberText = normalizeText(row["studentNumber"])

    if (!eaglesId) rowsMissingEaglesIdBefore.push(index + 2)
    if (!studentNumberText) rowsMissingStudentNumberBefore.push(index + 2)

    if (!eaglesId && studentNumberText && !normalizePositiveInteger(studentNumberText)) {
      row["eaglesId"] = studentNumberText
      row["studentNumber"] = ""
      rowsMovedLegacyIdFromStudentNumber.push(index + 2)
    }
  })

  const usedNumbers = new Set(
    dataRows
      .map((row) => normalizePositiveInteger(row["studentNumber"]))
      .filter((value) => Number.isInteger(value) && value > 0)
  )
  let nextStudentNumber = Math.max(floor - 1, ...(usedNumbers.size ? [...usedNumbers] : [0]))

  const rowsWithAutoFilledStudentNumber = []
  dataRows.forEach((row, index) => {
    const current = normalizeText(row["studentNumber"])
    if (current) return
    do {
      nextStudentNumber += 1
    } while (usedNumbers.has(nextStudentNumber))
    usedNumbers.add(nextStudentNumber)
    row["studentNumber"] = String(nextStudentNumber)
    rowsWithAutoFilledStudentNumber.push(index + 2)
  })

  const usedEaglesIdKeys = new Set(
    dataRows
      .map((row) => normalizeHeader(row["eaglesId"]))
      .filter(Boolean)
  )
  const rowsWithAutoFilledEaglesId = []

  dataRows.forEach((row, index) => {
    const existing = normalizeText(row["eaglesId"])
    if (existing) return

    const studentNumber = normalizePositiveInteger(row["studentNumber"])
    const fallback = studentNumber
      ? buildEaglesIdFromNumber(studentNumber)
      : `SIS-IMPORT-${String(index + 1).padStart(6, "0")}`
    const generated = ensureUniqueEaglesId(fallback, usedEaglesIdKeys)

    row["eaglesId"] = generated
    usedEaglesIdKeys.add(normalizeHeader(generated))
    rowsWithAutoFilledEaglesId.push(index + 2)
  })

  const rowsMissingEaglesIdAfter = []
  const rowsMissingStudentNumberAfter = []
  dataRows.forEach((row, index) => {
    if (!normalizeText(row["eaglesId"])) rowsMissingEaglesIdAfter.push(index + 2)
    if (!normalizeText(row["studentNumber"])) rowsMissingStudentNumberAfter.push(index + 2)
  })

  return {
    rows: dataRows,
    rowsMissingEaglesIdBefore,
    rowsMissingStudentNumberBefore,
    rowsMissingEaglesIdAfter,
    rowsMissingStudentNumberAfter,
    rowsMovedLegacyIdFromStudentNumber,
    rowsWithAutoFilledEaglesId,
    rowsWithAutoFilledStudentNumber,
  }
}

function writeWorkbookFromRows(filePath, sheetName, rows, headers) {
  ensureDirectoryForFile(filePath)
  const workbook = xlsx.utils.book_new()
  const worksheet = xlsx.utils.json_to_sheet(rows, { header: headers })
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName)
  xlsx.writeFile(workbook, filePath)
}

function writeBlankTemplate(filePath, schemaHeaders) {
  ensureDirectoryForFile(filePath)
  const workbook = xlsx.utils.book_new()
  const worksheet = xlsx.utils.aoa_to_sheet([schemaHeaders])
  xlsx.utils.book_append_sheet(workbook, worksheet, "Students_Template")
  xlsx.writeFile(workbook, filePath)
}

function writeFilledExampleTemplate(filePath, schemaHeaders) {
  const baseRows = [
    {
      "fullNameStudent": "Nguyen Anh Minh",
      "englishName": "Minh Nguyen",
      "studentNumber": "226",
      "eaglesId": "minh001",
      "studentPhone": "0900000226",
      "studentEmail": "student226@example.com",
      "classLevel": "Eggs & Chicks",
      "studentSchool": "Eagles Primary",
      "studentCurrentGrade": "Grade 4",
      "fullNameMother": "Le Thi Lan",
      "mothersPhone": "0901226226",
      "fullNameFather": "Nguyen Van Hai",
      "fathersPhone": "0901333226",
      "streetAddress": "123 Tran Hung Dao",
      "wardDistrict": "Ward 1, District 1",
      city: "HCMC",
      "postCode": "700000",
    },
    {
      "fullNameStudent": "Tran Gia Bao",
      "englishName": "Bao Tran",
      "studentNumber": "227",
      "eaglesId": "bao001",
      "studentPhone": "0900000227",
      "studentEmail": "student227@example.com",
      "classLevel": "Pre-A1 Starters",
      "studentSchool": "Eagles Primary",
      "studentCurrentGrade": "Grade 5",
      "fullNameMother": "Pham Thi Hoa",
      "mothersPhone": "0901226227",
      "fullNameFather": "Tran Quoc Dat",
      "fathersPhone": "0901333227",
      "streetAddress": "45 Nguyen Hue",
      "wardDistrict": "Ben Nghe, District 1",
      city: "HCMC",
      "postCode": "700000",
    },
  ]

  const rows = baseRows.map((row) => {
    const ordered = {}
    schemaHeaders.forEach((header) => {
      ordered[header] = header in row ? row[header] : ""
    })
    return ordered
  })

  writeWorkbookFromRows(filePath, "Students_Example", rows, schemaHeaders)
}

function buildAudit({
  sourceFile,
  sourceSheet,
  sourceHeaderRow,
  schemaHeaders,
  aliasMap,
  orderedRows,
  identityFixed,
}) {
  const sourceHeaderSet = new Set(sourceHeaderRow.map((entry) => normalizeHeader(entry)).filter(Boolean))
  const schemaLower = schemaHeaders.map((entry) => normalizeHeader(entry))
  const sourceNonEmptyLower = sourceHeaderRow.map((entry) => normalizeHeader(entry)).filter(Boolean)

  const sourceLikelyFieldOrder = sourceNonEmptyLower[0] === normalizeHeader("database/field name")
    ? sourceNonEmptyLower.slice(1)
    : sourceNonEmptyLower
  const exactSchemaOrderMatch =
    sourceLikelyFieldOrder.length >= schemaLower.length
    && schemaLower.every((entry, index) => sourceLikelyFieldOrder[index] === entry)

  const missingSchemaHeadersInSource = schemaHeaders.filter((header) => {
    const aliases = aliasMap[header] || [header]
    return !aliases.some((alias) => sourceHeaderSet.has(normalizeHeader(alias)))
  })

  return {
    generatedAt: new Date().toISOString(),
    schemaWorkbook: FORMFIELDS_SCHEMA_FILE,
    sourceFile,
    sourceSheet,
    sourceColumnCount: sourceHeaderRow.length,
    sourceRowCount: orderedRows.length,
    schemaHeaderCount: schemaHeaders.length,
    schemaHeaders,
    exactSchemaOrderMatch,
    missingSchemaHeadersInSource,
    orderedOutputFile: ORDERED_OUTPUT_FILE,
    orderedOutputRowCount: orderedRows.length,
    importReadyOutputFile: IMPORT_READY_OUTPUT_FILE,
    importReadyOutputRowCount: identityFixed.rows.length,
    rowsMissingEaglesIdBeforeCount: identityFixed.rowsMissingEaglesIdBefore.length,
    rowsMissingEaglesIdBefore: identityFixed.rowsMissingEaglesIdBefore.slice(0, 50),
    rowsMissingStudentNumberBeforeCount: identityFixed.rowsMissingStudentNumberBefore.length,
    rowsMissingStudentNumberBefore: identityFixed.rowsMissingStudentNumberBefore.slice(0, 50),
    rowsMovedLegacyIdFromStudentNumberCount: identityFixed.rowsMovedLegacyIdFromStudentNumber.length,
    rowsMovedLegacyIdFromStudentNumber: identityFixed.rowsMovedLegacyIdFromStudentNumber.slice(0, 50),
    rowsWithAutoFilledEaglesIdCount: identityFixed.rowsWithAutoFilledEaglesId.length,
    rowsWithAutoFilledEaglesId: identityFixed.rowsWithAutoFilledEaglesId.slice(0, 50),
    rowsWithAutoFilledStudentNumberCount: identityFixed.rowsWithAutoFilledStudentNumber.length,
    rowsWithAutoFilledStudentNumber: identityFixed.rowsWithAutoFilledStudentNumber.slice(0, 50),
    rowsMissingEaglesIdAfterCount: identityFixed.rowsMissingEaglesIdAfter.length,
    rowsMissingStudentNumberAfterCount: identityFixed.rowsMissingStudentNumberAfter.length,
  }
}

function main() {
  const schemaHeaders = readSchemaHeaders(FORMFIELDS_SCHEMA_FILE)
  const aliasMap = buildHeaderAliasMap(schemaHeaders)

  const { firstSheetName, headerRow, rows } = readWorkbookRows(SOURCE_UPLOAD_FILE)
  const orderedRows = buildOrderedRows(rows, schemaHeaders, aliasMap)
  const identityFixed = applyIdentityFixes(orderedRows, STUDENT_NUMBER_FLOOR)

  writeBlankTemplate(BLANK_TEMPLATE_OUTPUT, schemaHeaders)
  writeFilledExampleTemplate(FILLED_TEMPLATE_OUTPUT, schemaHeaders)
  writeWorkbookFromRows(ORDERED_OUTPUT_FILE, "Students_Ordered", orderedRows, schemaHeaders)
  writeWorkbookFromRows(IMPORT_READY_OUTPUT_FILE, "Students_ImportReady", identityFixed.rows, schemaHeaders)

  const audit = buildAudit({
    sourceFile: SOURCE_UPLOAD_FILE,
    sourceSheet: firstSheetName,
    sourceHeaderRow: headerRow,
    schemaHeaders,
    aliasMap,
    orderedRows,
    identityFixed,
  })

  ensureDirectoryForFile(AUDIT_OUTPUT_FILE)
  fs.writeFileSync(AUDIT_OUTPUT_FILE, `${JSON.stringify(audit, null, 2)}\n`, "utf8")
  console.log(JSON.stringify(audit, null, 2))
}

main()
