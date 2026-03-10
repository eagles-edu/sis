import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import vm from "node:vm"
import xlsx from "xlsx"

const PROFILE_TAB_IDS = new Set(["profile", "medical", "covid", "submission"])
const LIST_INPUT_TYPES = new Set(["select", "radio", "checkbox"])
const ALLOWED_TOP_LEVEL_KEYS = new Set(["eaglesId", "studentNumber", "email"])
const CANONICAL_WORKBOOK_FILES = [
  "docs/students/eaglesclub-students-import-ready.xlsx",
  "docs/students/eaglesclub-students-import-ready-single.xlsx",
]
const FORM_UNMAPPED_PROFILE_KEYS = new Set([
  "sourceFormId",
  "sourceUrl",
  "requiredValidationOk",
  "rawFormPayload",
  "normalizedFormPayload",
])
const BANNED_IMPORT_ALIAS_SNIPPETS = [
  "\"student_id\"",
  "\"student no\"",
  "\"ma so sinh vien\"",
  "\"child phone\"",
  "\"student name\"",
  "\"mom name\"",
  "\"dad name\"",
  "\"mother emergency phone\"",
  "\"father emergency phone\"",
  "\"zip code\"",
  "\"zipcode\"",
  "\"eagles-id\"",
  "\"student-number\"",
  "\"full-name-student\"",
  "\"class-level\"",
]

function readProfileFormRows() {
  const html = fs.readFileSync("web-asset/admin/student-admin.html", "utf8")
  const marker = "const PROFILE_FORM_FIELD_ROWS = ["
  const markerIndex = html.indexOf(marker)
  assert.ok(markerIndex >= 0, "PROFILE_FORM_FIELD_ROWS marker must exist")

  const openIndex = html.indexOf("[", markerIndex)
  let depth = 0
  let closeIndex = -1
  for (let i = openIndex; i < html.length; i += 1) {
    const ch = html[i]
    if (ch === "[") depth += 1
    if (ch === "]") {
      depth -= 1
      if (depth === 0) {
        closeIndex = i
        break
      }
    }
  }
  assert.ok(closeIndex > openIndex, "PROFILE_FORM_FIELD_ROWS array must close")

  const rows = vm.runInNewContext(html.slice(openIndex, closeIndex + 1))
  assert.ok(Array.isArray(rows), "PROFILE_FORM_FIELD_ROWS must be an array")

  const fields = rows.map((row, index) => ({
    index,
    key: String(row[0] || "").trim(),
    idSuffix: String(row[1] || "").trim(),
    labelVi: String(row[2] || "").trim(),
    labelEn: String(row[3] || "").trim(),
    tabId: String(row[4] || "").trim(),
    sectionVi: String(row[5] || "").trim(),
    inputType: String(row[6] || "").trim(),
    placeholderVi: String(row[7] || "").trim(),
    optionsRaw: String(row[8] || ""),
    profileKey: String(row[9] || "").trim(),
    topLevelKey: String(row[10] || "").trim(),
    width: Number(row[11] || 0),
  }))

  return { html, fields }
}

function readWorkbookKeysFrom(filePath) {
  const workbook = xlsx.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false })
  return (rows[0] || [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((entry) => entry.toLowerCase() !== "database/field name")
}

function resolveCanonicalWorkbookFile() {
  const found = CANONICAL_WORKBOOK_FILES.find((filePath) => fs.existsSync(filePath))
  assert.ok(found, `canonical workbook must exist: ${CANONICAL_WORKBOOK_FILES.join(" or ")}`)
  return found
}

function readWorkbookKeys() {
  return readWorkbookKeysFrom(resolveCanonicalWorkbookFile())
}

function readPrismaModelFieldNames(modelName) {
  const prisma = fs.readFileSync("prisma/schema.prisma", "utf8")
  const pattern = new RegExp(`model\\s+${modelName}\\s*\\{([\\s\\S]*?)\\n\\}`, "m")
  const match = prisma.match(pattern)
  assert.ok(match, `model ${modelName} must exist in prisma/schema.prisma`)

  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("//") && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/)[0])
}

function findDuplicates(values = []) {
  const counts = new Map()
  values.forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1)
  })
  return [...counts.entries()].filter(([, count]) => count > 1)
}

test("profile form keys mirror workbook keys exactly in order and uniqueness", () => {
  const { fields } = readProfileFormRows()
  const workbookKeys = readWorkbookKeys()
  const formKeys = fields.map((field) => field.key)

  assert.equal(JSON.stringify(formKeys), JSON.stringify(workbookKeys))
  assert.deepEqual(findDuplicates(formKeys), [])
  formKeys.forEach((key) => {
    assert.match(key, /^[a-z][A-Za-z0-9]*$/, `form key must be camelCase: ${key}`)
  })
  workbookKeys.forEach((key) => {
    assert.match(key, /^[a-z][A-Za-z0-9]*$/, `workbook key must be camelCase: ${key}`)
  })
})

test("canonical workbook keys mirror form keys exactly", () => {
  const canonicalWorkbookKeys = readWorkbookKeys()
  const { fields } = readProfileFormRows()
  const formKeys = fields.map((field) => field.key)

  assert.equal(JSON.stringify(canonicalWorkbookKeys), JSON.stringify(formKeys))
  canonicalWorkbookKeys.forEach((key) => {
    assert.match(key, /^[a-z][A-Za-z0-9]*$/, `canonical workbook key must be camelCase: ${key}`)
  })
})

test("profile form labels, sections, tabs, and list options are symmetrical", () => {
  const { fields } = readProfileFormRows()

  fields.forEach((field) => {
    assert.ok(field.labelVi, `${field.key}: Vietnamese label is required`)
    assert.ok(field.labelEn, `${field.key}: English label is required`)
    assert.ok(field.sectionVi, `${field.key}: section label is required`)
    assert.ok(PROFILE_TAB_IDS.has(field.tabId), `${field.key}: tabId ${field.tabId} is invalid`)
    assert.ok([3, 4, 6, 8, 12].includes(field.width), `${field.key}: width ${field.width} is invalid`)

    if (!LIST_INPUT_TYPES.has(field.inputType)) return

    const options = field.optionsRaw
      .split("|")
      .map((entry) => entry.trim())
      .filter(Boolean)
    assert.ok(options.length > 0, `${field.key}: list input must define options`)

    const lowered = options.map((option) => option.toLowerCase())
    assert.deepEqual(findDuplicates(lowered), [], `${field.key}: options must be unique`)
  })
})

test("profile form mappings align with Prisma schema and canonical naming", () => {
  const { fields } = readProfileFormRows()
  const canonicalWorkbookKeys = readWorkbookKeys()
  const studentFields = readPrismaModelFieldNames("Student")
  const studentProfileFields = readPrismaModelFieldNames("StudentProfile")

  const studentDataFields = studentFields.filter((name) => !["id", "createdAt", "updatedAt"].includes(name))
  const studentProfileDataFields = studentProfileFields.filter(
    (name) => !["id", "studentRefId", "student", "createdAt", "updatedAt"].includes(name)
  )

  studentDataFields.forEach((fieldName) => {
    assert.match(fieldName, /^[a-z][A-Za-z0-9]*$/, `Student.${fieldName} must be camelCase`)
  })
  studentProfileDataFields.forEach((fieldName) => {
    assert.match(fieldName, /^[a-z][A-Za-z0-9]*$/, `StudentProfile.${fieldName} must be camelCase`)
  })

  const mappedProfileKeys = fields.map((field) => field.profileKey).filter(Boolean)
  const mappedTopLevelKeys = fields.map((field) => field.topLevelKey).filter(Boolean)
  const hasNormalizedFormPayloadColumn = studentProfileDataFields.includes("normalizedFormPayload")
  assert.equal(hasNormalizedFormPayloadColumn, true, "StudentProfile.normalizedFormPayload must exist")

  canonicalWorkbookKeys.forEach((key) => {
    const field = fields.find((entry) => entry.key === key)
    assert.ok(field, `canonical workbook key must exist in form config: ${key}`)
    const hasDbMapping = Boolean(field.profileKey || field.topLevelKey || hasNormalizedFormPayloadColumn)
    assert.ok(hasDbMapping, `canonical workbook key must map to DB field(s): ${key}`)
  })

  fields.forEach((field) => {
    assert.match(field.idSuffix, /^[a-z][A-Za-z0-9]*$/, `${field.key}: idSuffix must be camelCase`)
    if (field.profileKey) {
      assert.match(field.profileKey, /^[a-z][A-Za-z0-9]*$/, `${field.key}: profileKey must be camelCase`)
      assert.ok(
        studentProfileDataFields.includes(field.profileKey),
        `${field.key}: profileKey ${field.profileKey} not found in StudentProfile schema`
      )
    }
    if (field.topLevelKey) {
      assert.match(field.topLevelKey, /^[a-z][A-Za-z0-9]*$/, `${field.key}: topLevelKey must be camelCase`)
      assert.ok(ALLOWED_TOP_LEVEL_KEYS.has(field.topLevelKey), `${field.key}: topLevelKey ${field.topLevelKey} is not allowed`)
      assert.ok(studentDataFields.includes(field.topLevelKey), `${field.key}: topLevelKey ${field.topLevelKey} missing in Student schema`)
    }
  })

  const missingProfileMappings = studentProfileDataFields
    .filter((fieldName) => !FORM_UNMAPPED_PROFILE_KEYS.has(fieldName))
    .filter((fieldName) => !mappedProfileKeys.includes(fieldName))
  assert.deepEqual(missingProfileMappings, [])

  assert.deepEqual(findDuplicates(mappedProfileKeys), [])
  assert.deepEqual(findDuplicates(mappedTopLevelKeys), [])
})

test("Student.eaglesId is non-null in Prisma schema contract", () => {
  const prisma = fs.readFileSync("prisma/schema.prisma", "utf8")
  const studentModelMatch = prisma.match(/model\s+Student\s*\{([\s\S]*?)\n\}/m)
  assert.ok(studentModelMatch, "Student model must exist in prisma/schema.prisma")

  const studentModelBody = studentModelMatch[1]
  const eaglesIdLine = studentModelBody
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("eaglesId "))

  assert.ok(eaglesIdLine, "Student.eaglesId field must exist in prisma/schema.prisma")
  assert.equal(/eaglesId\s+String\?/.test(eaglesIdLine), false, "Student.eaglesId must be non-null (String, not String?)")
  assert.ok(/eaglesId\s+String\b/.test(eaglesIdLine), "Student.eaglesId must be declared as String")
})

test("legacy student-number fallback paths are removed", () => {
  const { html } = readProfileFormRows()
  const storeSource = fs.readFileSync("server/student-admin-store.mjs", "utf8")

  assert.equal(html.includes("entry?.profile?.studentNumber"), false)
  assert.equal(html.includes("parsePositiveInteger(student.studentId)"), false)
  assert.equal(storeSource.includes("parseNumericStudentId"), false)
  assert.equal(storeSource.includes("payload?.profile?.studentNumber"), false)
})

test("student name wiring stays discrete (no cross-field fallback or legacy sort alias)", () => {
  const { html } = readProfileFormRows()

  assert.equal(html.includes('sortField === "studentName"'), false)
  assert.equal(html.includes("if (preferEnglish) return englishName || fullName || \"\""), false)
  assert.equal(html.includes("return fullName || englishName || \"\""), false)
  assert.equal(html.includes("if (selected?.fullName) return selected.fullName"), false)
  assert.match(html, /function topSearchStudentOptionLabel\(student = \{\}\)\s*\{\s*return normalizeText\(student\?\.eaglesId\)/)
})

test("import mapping excludes legacy fuzzy alias keys", () => {
  const storeSource = fs.readFileSync("server/student-admin-store.mjs", "utf8")
  BANNED_IMPORT_ALIAS_SNIPPETS.forEach((snippet) => {
    assert.equal(storeSource.includes(snippet), false, `legacy alias should not appear: ${snippet}`)
  })
})

test("student identity collisions are rejected for create and conflicting import rows", () => {
  const storeSource = fs.readFileSync("server/student-admin-store.mjs", "utf8")
  assert.equal(storeSource.includes('assertWithStatus(!existingByEaglesId, 409, "eaglesId already exists")'), true)
  assert.equal(storeSource.includes('"studentNumber does not match existing eaglesId"'), true)
  assert.equal(storeSource.includes('"studentNumber already exists in database"'), true)
})

test("student identity is immutable on update", () => {
  const { html } = readProfileFormRows()
  const storeSource = fs.readFileSync("server/student-admin-store.mjs", "utf8")
  assert.equal(html.includes('if (!parsePositiveInteger(payload.studentNumber)) throw new Error("studentNumber is required")'), false)
  assert.equal(storeSource.includes('assertWithStatus(Boolean(requestedStudentNumber), 400, "studentNumber is required")'), false)
  assert.equal(storeSource.includes("await resolveNextStudentNumberForClient(client, STUDENT_NUMBER_START)"), true)
  assert.equal(storeSource.includes('"eaglesId is immutable and cannot be changed"'), true)
  assert.equal(storeSource.includes('"studentNumber is immutable and cannot be changed"'), true)
})
