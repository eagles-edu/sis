// server/student-admin-assignment-template-store.mjs

import { getSharedPrismaClient } from "./prisma-client-factory.mjs"

const FIXED_TIME_ZONE_OFFSET_MINUTES = 7 * 60
const FIXED_TIME_ZONE_OFFSET_MS = FIXED_TIME_ZONE_OFFSET_MINUTES * 60 * 1000

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeDateOrText(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) return ""
    return value.toISOString()
  }
  const text = normalizeText(value)
  if (!text) return ""
  const parsed = new Date(text)
  if (Number.isNaN(parsed.valueOf())) return text
  return parsed.toISOString()
}

function parseDateOrNull(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) return null
    return new Date(value.getTime())
  }

  const text = normalizeText(value)
  if (!text) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [yearText, monthText, dayText] = text.split("-")
    const year = Number.parseInt(yearText, 10)
    const month = Number.parseInt(monthText, 10)
    const day = Number.parseInt(dayText, 10)
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
    const fixedMidnightUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - FIXED_TIME_ZONE_OFFSET_MS
    const date = new Date(fixedMidnightUtc)
    return Number.isNaN(date.valueOf()) ? null : date
  }

  const parsed = new Date(text)
  return Number.isNaN(parsed.valueOf()) ? null : parsed
}

function shiftToFixedTimeZone(value) {
  return new Date(value.getTime() + FIXED_TIME_ZONE_OFFSET_MS)
}

function shiftFromFixedTimeZone(value) {
  return new Date(value.getTime() - FIXED_TIME_ZONE_OFFSET_MS)
}

function startOfDay(value = new Date()) {
  const parsed = parseDateOrNull(value) || new Date()
  const shifted = shiftToFixedTimeZone(parsed)
  shifted.setUTCHours(0, 0, 0, 0)
  return shiftFromFixedTimeZone(shifted)
}

function startOfWeek(value = new Date()) {
  const date = startOfDay(value)
  const shifted = shiftToFixedTimeZone(date)
  const day = shifted.getUTCDay()
  const diffToMonday = (day + 6) % 7
  shifted.setUTCDate(shifted.getUTCDate() - diffToMonday)
  shifted.setUTCHours(0, 0, 0, 0)
  return shiftFromFixedTimeZone(shifted)
}

function endOfWeek(value = new Date()) {
  const date = startOfWeek(value)
  return new Date(date.getTime() + (24 * 60 * 60 * 1000 * 7) - 1)
}

function compareKnownLevelOrder(left = "", right = "") {
  return normalizeText(left).localeCompare(normalizeText(right), undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

function normalizeAssignmentItem(source = {}, index = 0) {
  const item = source && typeof source === "object" ? source : {}
  const title = normalizeText(item.title || item.exerciseTitle || item.name || item.label)
  const url = normalizeText(item.url || item.link || item.href || item.exerciseUrl)
  const done = Boolean(item.done || item.completed || item.checked)
  const id = normalizeText(item.id) || `assignment-item-${index + 1}`
  if (!title && !url) return null
  return {
    id,
    title,
    url,
    done,
  }
}

function normalizeAssignmentItems(value = []) {
  const source = Array.isArray(value) ? value : []
  return source
    .map((entry, index) => normalizeAssignmentItem(entry, index))
    .filter(Boolean)
}

function assignmentCompletionFromItems(items = []) {
  const normalized = Array.isArray(items) ? items : []
  const total = normalized.length
  const done = normalized.filter((entry) => entry.done).length
  return {
    total,
    done,
    completed: total > 0 && done >= total,
  }
}

function assignmentTemplateIdFromFields(template = {}) {
  const level = normalizeLower(template.level || "")
  const assignmentTitle = normalizeLower(template.assignmentTitle || template.title || "")
  const assignedAt = normalizeText(template.assignedAt || template.dateAssigned || "")
  const dueAt = normalizeText(template.dueAt || template.dueDate || "")
  const firstItemTitle = normalizeLower(
    Array.isArray(template.items) && template.items.length ?
      template.items[0]?.title || template.items[0]?.exerciseTitle || ""
    : ""
  )
  const exerciseTitle = normalizeLower(template.exerciseTitle || firstItemTitle)
  if (!level && !exerciseTitle && !assignmentTitle && !assignedAt && !dueAt) return ""
  return [level, assignmentTitle || exerciseTitle, assignedAt, dueAt].join("|")
}

function normalizeAssignmentTemplate(source = {}) {
  const template = source && typeof source === "object" ? source : {}
  const rawItems =
    Array.isArray(template.items) ? template.items
    : Array.isArray(template.itemsJson) ? template.itemsJson
    : []
  const assignmentTitle = normalizeText(template.assignmentTitle || template.title) || "Assignment update"
  const assignedAt = normalizeText(template.assignedAt || template.dateAssigned)
  const dueAt = normalizeText(template.dueAt || template.dueDate)
  const exerciseTitle = normalizeText(template.exerciseTitle)
  const level = normalizeText(template.level)
  const eaglesId = normalizeText(template.eaglesId)
  const message = normalizeText(template.message)
  const items = normalizeAssignmentItems(rawItems)
  const normalizedItems =
    items.length ? items
    : exerciseTitle ?
      [
        normalizeAssignmentItem({
          id: assignmentTemplateIdFromFields({
            title: exerciseTitle,
            url: normalizeText(template.exerciseUrl || template.link || template.href),
          }) || `assignment-item-${exerciseTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32) || "1"}`,
          title: exerciseTitle,
          url: normalizeText(template.exerciseUrl || template.link || template.href),
          done: template.completed === true,
        }, 0),
      ].filter(Boolean)
    : []
  const completion = assignmentCompletionFromItems(normalizedItems)
  const completed = template.completed === true || completion.completed
  const completedAt = completed ? normalizeText(template.completedAt || template.completedDate) : ""
  const id =
    normalizeText(template.id) ||
    assignmentTemplateIdFromFields({
      level,
      assignmentTitle,
      exerciseTitle,
      assignedAt,
      dueAt,
      items: normalizedItems,
    })

  return {
    id,
    assignmentTitle,
    exerciseTitle: exerciseTitle || normalizedItems[0]?.title || "",
    assignedAt,
    dueAt,
    level,
    eaglesId,
    message,
    items: normalizedItems,
    completed,
    completedAt,
    createdAt: normalizeDateOrText(template.createdAt),
    updatedAt: normalizeDateOrText(template.updatedAt),
  }
}

function templateSortStamp(template = {}) {
  return (
    parseDateOrNull(template.updatedAt)?.valueOf() ||
    parseDateOrNull(template.assignedAt)?.valueOf() ||
    parseDateOrNull(template.dueAt)?.valueOf() ||
    parseDateOrNull(template.createdAt)?.valueOf() ||
    0
  )
}

function parseAssignmentTemplateFilterLevel(value = "") {
  return normalizeText(value)
}

function parseAssignmentTemplateQuery(value = "") {
  return normalizeText(value)
}

function parseAssignmentTemplateImportPayload(payload = {}) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.templates)) return payload.templates
    if (Array.isArray(payload.items)) return payload.items
    if (Array.isArray(payload.assignmentTemplates)) return payload.assignmentTemplates
  }
  return []
}

function isAssignmentTemplateStoreEnabled() {
  const hasDatabaseUrl = Boolean(normalizeText(process.env.DATABASE_URL))
  const envFlag = normalizeLower(process.env.STUDENT_ADMIN_STORE_ENABLED)
  if (!envFlag) return hasDatabaseUrl
  if (["false", "0", "no"].includes(envFlag)) return false
  if (["true", "1", "yes"].includes(envFlag)) return true
  return hasDatabaseUrl
}

let prismaClientPromise = null
let assignmentTemplateDbDisabled = false
let assignmentTemplateDbWarned = false
const assignmentTemplateMemoryStore = new Map()

function resetMemoryStore() {
  assignmentTemplateMemoryStore.clear()
}

function markAssignmentTemplateDbFallback(error) {
  assignmentTemplateDbDisabled = true
  if (assignmentTemplateDbWarned) return
  assignmentTemplateDbWarned = true
  console.warn(`assignment template store falling back to memory: ${normalizeText(error?.message || error)}`)
}

async function getAssignmentTemplatePrismaClient() {
  if (assignmentTemplateDbDisabled || !isAssignmentTemplateStoreEnabled()) return null
  if (prismaClientPromise) return prismaClientPromise

  prismaClientPromise = (async () => {
    try {
      const prisma = await getSharedPrismaClient()
      if (!prisma || !prisma.assignmentTemplate) {
        markAssignmentTemplateDbFallback(new Error("Prisma assignmentTemplate model unavailable"))
        return null
      }
      return prisma
    } catch (error) {
      markAssignmentTemplateDbFallback(error)
      return null
    }
  })()

  try {
    return await prismaClientPromise
  } catch (error) {
    prismaClientPromise = null
    throw error
  }
}

async function runAssignmentTemplateDbOperation(handler, fallbackHandler) {
  const prisma = await getAssignmentTemplatePrismaClient()
  if (!prisma) return fallbackHandler()

  try {
    return await handler(prisma)
  } catch (error) {
    const code = normalizeText(error?.code)
    const message = normalizeLower(error?.message || error)
    if (
      code === "P2021" ||
      code === "P2022" ||
      message.includes("assignmenttemplate") ||
      message.includes("assignment template")
    ) {
      markAssignmentTemplateDbFallback(error)
      return fallbackHandler()
    }
    throw error
  }
}

function mapAssignmentTemplateRow(row = {}) {
  return normalizeAssignmentTemplate({
    id: row.id,
    assignmentTitle: row.assignmentTitle,
    exerciseTitle: row.exerciseTitle,
    assignedAt: row.assignedAt,
    dueAt: row.dueAt,
    level: row.level,
    eaglesId: row.eaglesId,
    message: row.message,
    itemsJson: row.itemsJson || row.items,
    items: row.items || row.itemsJson,
    completed: row.completed,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

function normalizeAssignmentTemplateListOrder(items = []) {
  return [...items].sort((left, right) => {
    const stampCompare = templateSortStamp(right) - templateSortStamp(left)
    if (stampCompare !== 0) return stampCompare
    return compareKnownLevelOrder(left.level, right.level) || normalizeText(left.id).localeCompare(normalizeText(right.id))
  })
}

function normalizeAssignmentTemplateLevelOrder(items = []) {
  return [...items].sort((left, right) => {
    const levelCompare = compareKnownLevelOrder(left.level, right.level)
    if (levelCompare !== 0) return levelCompare
    return normalizeText(left.id).localeCompare(normalizeText(right.id))
  })
}

function currentWeekTemplateTouchesWeek(template = {}, now = new Date()) {
  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)
  const assignedAt = parseDateOrNull(template.assignedAt)
  const dueAt = parseDateOrNull(template.dueAt)
  const assignedHits = assignedAt && assignedAt >= weekStart && assignedAt <= weekEnd
  const dueHits = dueAt && dueAt >= weekStart && dueAt <= weekEnd
  return Boolean(assignedHits || dueHits)
}

export function buildAssignmentDashboardSlices({
  assignmentTemplates = [],
  classEnrollmentAttendance = [],
  now = new Date(),
} = {}) {
  const sourceTemplates = Array.isArray(assignmentTemplates) ? assignmentTemplates : []
  const currentWeekByLevel = new Map()

  sourceTemplates.forEach((entry) => {
    const template = normalizeAssignmentTemplate(entry)
    const level = normalizeText(template.level)
    if (!level) return
    if (!currentWeekTemplateTouchesWeek(template, now)) return

    const current = currentWeekByLevel.get(level)
    if (!current || templateSortStamp(template) >= templateSortStamp(current)) {
      currentWeekByLevel.set(level, template)
    }
  })

  const currentAssignmentMeta = normalizeAssignmentTemplateLevelOrder(Array.from(currentWeekByLevel.values()))
  const currentAssignmentLevels = new Set(
    currentAssignmentMeta.map((entry) => normalizeText(entry.level)).filter(Boolean)
  )
  const enrollmentOnlyLevels = normalizeAssignmentTemplateLevelOrder(
    (Array.isArray(classEnrollmentAttendance) ? classEnrollmentAttendance : [])
      .map((entry) => ({
        level: normalizeText(entry?.level),
        enrolled: Number.parseInt(String(entry?.enrolled || 0), 10) || 0,
      }))
      .filter((entry) => entry.level && entry.enrolled > 0 && !currentAssignmentLevels.has(entry.level))
      .map((entry) => ({ level: entry.level }))
  ).map((entry) => entry.level)

  return {
    currentAssignmentMeta,
    enrollmentOnlyLevels,
  }
}

export async function listAssignmentTemplates({
  query = "",
  level = "",
  take = 250,
  currentWeek = false,
  now = new Date(),
} = {}) {
  const queryText = parseAssignmentTemplateQuery(query)
  const levelText = parseAssignmentTemplateFilterLevel(level)
  const limit = Math.max(1, Math.min(Number.parseInt(String(take), 10) || 250, 1000))

  const items = await runAssignmentTemplateDbOperation(
    async (prisma) => {
      const where = {}
      if (levelText) {
        where.level = {
          equals: levelText,
          mode: "insensitive",
        }
      }
      if (queryText) {
        where.OR = [
          { assignmentTitle: { contains: queryText, mode: "insensitive" } },
          { exerciseTitle: { contains: queryText, mode: "insensitive" } },
          { level: { contains: queryText, mode: "insensitive" } },
          { eaglesId: { contains: queryText, mode: "insensitive" } },
          { message: { contains: queryText, mode: "insensitive" } },
        ]
      }

      const rows = await prisma.assignmentTemplate.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      })

      return rows.map((row) => mapAssignmentTemplateRow(row))
    },
    async () => normalizeAssignmentTemplateListOrder(Array.from(assignmentTemplateMemoryStore.values()).map((row) => mapAssignmentTemplateRow(row)))
  )

  const filtered = currentWeek
    ? items.filter((entry) => currentWeekTemplateTouchesWeek(entry, now))
    : items

  return normalizeAssignmentTemplateListOrder(filtered).slice(0, limit)
}

export async function getAssignmentTemplateById(templateId = "") {
  const id = normalizeText(templateId)
  if (!id) return null

  return runAssignmentTemplateDbOperation(
    async (prisma) => {
      const row = await prisma.assignmentTemplate.findUnique({ where: { id } })
      return row ? mapAssignmentTemplateRow(row) : null
    },
    async () => {
      const row = assignmentTemplateMemoryStore.get(id)
      return row ? mapAssignmentTemplateRow(row) : null
    }
  )
}

export async function saveAssignmentTemplate(payload = {}, options = {}) {
  const normalized = normalizeAssignmentTemplate(payload)
  const id = normalizeText(options?.templateId || normalized.id)
  if (!id) {
    const error = new Error("assignmentTemplate id is required")
    error.statusCode = 400
    throw error
  }

  const existing = await getAssignmentTemplateById(id)
  const nextTemplate = normalizeAssignmentTemplate({
    ...existing,
    ...normalized,
    id,
  })
  const existingCreatedAt = normalizeDateOrText(existing?.createdAt)
  const nowIso = new Date().toISOString()
  const createdAt = existingCreatedAt || nextTemplate.createdAt || nowIso
  const updatedAt = nowIso

  return runAssignmentTemplateDbOperation(
    async (prisma) => {
      const saved = await prisma.assignmentTemplate.upsert({
        where: { id },
        create: {
          id,
          assignmentTitle: nextTemplate.assignmentTitle,
          exerciseTitle: nextTemplate.exerciseTitle || null,
          assignedAt: nextTemplate.assignedAt || null,
          dueAt: nextTemplate.dueAt || null,
          level: nextTemplate.level || null,
          eaglesId: nextTemplate.eaglesId || null,
          message: nextTemplate.message || null,
          itemsJson: nextTemplate.items,
          completed: Boolean(nextTemplate.completed),
          completedAt: nextTemplate.completedAt || null,
        },
        update: {
          assignmentTitle: nextTemplate.assignmentTitle,
          exerciseTitle: nextTemplate.exerciseTitle || null,
          assignedAt: nextTemplate.assignedAt || null,
          dueAt: nextTemplate.dueAt || null,
          level: nextTemplate.level || null,
          eaglesId: nextTemplate.eaglesId || null,
          message: nextTemplate.message || null,
          itemsJson: nextTemplate.items,
          completed: Boolean(nextTemplate.completed),
          completedAt: nextTemplate.completedAt || null,
        },
      })
      return {
        created: !existing,
        item: mapAssignmentTemplateRow(saved),
      }
    },
    async () => {
      const item = normalizeAssignmentTemplate({
        ...nextTemplate,
        id,
        createdAt,
        updatedAt,
        itemsJson: nextTemplate.items,
      })
      assignmentTemplateMemoryStore.set(id, item)
      return {
        created: !existing,
        item,
      }
    }
  )
}

export async function deleteAssignmentTemplateById(templateId = "") {
  const id = normalizeText(templateId)
  if (!id) {
    const error = new Error("templateId is required")
    error.statusCode = 400
    throw error
  }

  return runAssignmentTemplateDbOperation(
    async (prisma) => {
      const existing = await prisma.assignmentTemplate.findUnique({ where: { id } })
      if (!existing) {
        const error = new Error("Assignment template not found")
        error.statusCode = 404
        throw error
      }
      await prisma.assignmentTemplate.delete({ where: { id } })
      return {
        deleted: true,
        id,
      }
    },
    async () => {
      if (!assignmentTemplateMemoryStore.has(id)) {
        const error = new Error("Assignment template not found")
        error.statusCode = 404
        throw error
      }
      assignmentTemplateMemoryStore.delete(id)
      return {
        deleted: true,
        id,
      }
    }
  )
}

export async function importAssignmentTemplates(payload = {}, options = {}) {
  const templates = parseAssignmentTemplateImportPayload(payload)
  const items = []
  for (let index = 0; index < templates.length; index += 1) {
    const entry = templates[index]
    const saved = await saveAssignmentTemplate(entry, {
      ...options,
      templateId: options?.templateId || normalizeText(entry?.id),
    })
    items.push(saved.item)
  }
  return {
    total: templates.length,
    saved: items.length,
    items: normalizeAssignmentTemplateListOrder(items),
  }
}

export function resetAssignmentTemplateStoreForTests() {
  prismaClientPromise = null
  assignmentTemplateDbDisabled = false
  assignmentTemplateDbWarned = false
  resetMemoryStore()
}
