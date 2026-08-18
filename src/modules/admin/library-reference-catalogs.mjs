import verbData from "../../../data/verb-regularity.json" with { type: "json" }
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"

export const REFERENCE_CATALOGS = Object.freeze({
  verbs: { label: "Verb forms", columns: ["term", "v1", "v2", "v3", "v4", "v5", "regularity", "sourceUrl"] },
  awl: { label: "Academic Word List", columns: ["term", "qualifyingMember", "sublist", "members", "sourceUrl"] },
  conjunctions: { label: "Conjunctions", columns: ["term", "subtype", "pairedTerm", "sourceUrl"] },
  ed_ing_adjectives: { label: "-ed / -ing adjectives", columns: ["term", "subtype", "pairedTerm", "meaning", "sourceUrl"] },
  pronouns: { label: "Pronouns", columns: ["term", "subtype", "person", "number", "case", "sourceUrl"] },
  figurative_language: { label: "Figurative language", columns: ["term", "subtype", "literalMeaning", "intendedMeaning", "sourceUrl"] },
  noun_types: { label: "Noun types", columns: ["term", "subtype", "description", "sourceUrl"] },
})

const text = (value) => String(value == null ? "" : value).trim()
const lower = (value) => text(value).toLocaleLowerCase("en-US")
const normalizeKey = (value) => lower(value).normalize("NFC").replace(/[’']/gu, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
const catalog = (key) => {
  const value = lower(key)
  if (!REFERENCE_CATALOGS[value]) { const error = new Error("Unsupported reference catalog"); error.statusCode = 404; throw error }
  return value
}
const dataValue = (row, key) => text(row[key] ?? row.data?.[key])

const staticSeeds = {
  conjunctions: [
    ["and", "coordinating"], ["but", "coordinating"], ["for", "coordinating"], ["nor", "coordinating"], ["or", "coordinating"], ["so", "coordinating"], ["yet", "coordinating"],
    ["although", "subordinating"], ["because", "subordinating"], ["before", "subordinating"], ["if", "subordinating"], ["since", "subordinating"], ["though", "subordinating"], ["unless", "subordinating"], ["when", "subordinating"], ["while", "subordinating"],
    ["either ... or", "correlative"], ["neither ... nor", "correlative"], ["not only ... but also", "correlative"], ["both ... and", "correlative"], ["whether ... or", "correlative"],
  ],
  pronouns: [["I", "personal"], ["you", "personal"], ["he", "personal"], ["she", "personal"], ["it", "personal"], ["we", "personal"], ["they", "personal"], ["myself", "reflexive"], ["each other", "reciprocal"], ["this", "demonstrative"], ["who", "interrogative"], ["which", "relative"], ["someone", "indefinite"]],
  noun_types: [["common", "primary_classification"], ["proper", "primary_classification"], ["collective", "primary_classification"], ["compound", "primary_classification"], ["possessive", "primary_classification"], ["concrete", "physical_quality"], ["material", "physical_quality"], ["abstract", "physical_quality"]],
  ed_ing_adjectives: [["annoyed", "ed"], ["annoying", "ing"], ["bored", "ed"], ["boring", "ing"], ["confused", "ed"], ["confusing", "ing"], ["excited", "ed"], ["exciting", "ing"], ["interested", "ed"], ["interesting", "ing"], ["tired", "ed"], ["tiring", "ing"]],
  figurative_language: [["a piece of cake", "idiom"], ["as busy as a bee", "simile"], ["time is a thief", "metaphor"], ["passed away", "euphemism"], ["double meaning", "double_entendre"]],
}
const seedSourceUrls = { ed_ing_adjectives: "https://www.grammar.cl/Notes/Adjectives_ED_ING.htm", conjunctions: "docs/esl/list_of_common_conjunctions.pdf", pronouns: "SIS grammar taxonomy", noun_types: "docs/NOUN-CLASS-PLAN.MD", figurative_language: "SIS curated reference seed" }

function seedRows(key) {
  if (key === "verbs") return verbData.allVerbs.map((base) => {
    const row = verbData.rows.find((candidate) => candidate.base === base)
    return { term: row.base, partOfSpeech: "verb", subtype: row.regularity, data: { v1: row.forms.V1, v2: row.forms.V2, v3: row.forms.V3, v4: row.forms.V4, v5: row.forms.V5, regularity: row.regularity }, sourceLabel: verbData.source }
  })
  return (staticSeeds[key] || []).map(([term, subtype]) => ({ term, subtype, partOfSpeech: key === "pronouns" ? "pronoun" : key === "conjunctions" ? "conjunction" : key === "ed_ing_adjectives" ? "adjective" : "noun", data: { subtype }, sourceLabel: "SIS curated reference seed", sourceUrl: seedSourceUrls[key] || "" }))
}

function normalizeRow(key, row = {}) {
  const term = dataValue(row, "term") || dataValue(row, "english")
  if (!term) { const error = new Error("Each catalog row requires term"); error.statusCode = 400; throw error }
  const subtype = lower(dataValue(row, "subtype"))
  if (key === "figurative_language" && !["idiom", "simile", "metaphor", "euphemism", "double_entendre"].includes(subtype)) { const error = new Error("Figurative-language rows require a valid subtype"); error.statusCode = 400; throw error }
  const allowed = REFERENCE_CATALOGS[key].columns
  const data = Object.fromEntries(allowed.filter((column) => !["term", "sourceUrl"].includes(column)).map((column) => [column, dataValue(row, column)]).filter(([, value]) => value))
  const naturalKey = key === "verbs" ? normalizeKey(term) : `${normalizeKey(term)}|${subtype}`
  return { naturalKey, term, partOfSpeech: lower(dataValue(row, "partOfSpeech")) || null, subtype: subtype || null, dataJson: data, sourceLabel: dataValue(row, "sourceLabel") || null, sourceUrl: dataValue(row, "sourceUrl") || null, editorialStatus: lower(dataValue(row, "editorialStatus")) || "admin", }
}

async function writeRevision(client, entry, action, actorName) {
  return client.libraryReferenceCatalogRevision.create({ data: { entryId: entry.id, action, actorName: text(actorName), snapshotJson: entry } })
}

export async function ensureReferenceCatalogSeed(key) {
  const catalogKey = catalog(key)
  const client = await getSharedPrismaClient()
  if (catalogKey === "awl") {
    const families = await client.libraryAwlFamily.findMany()
    for (const family of families) {
      const value = normalizeRow(catalogKey, { term: family.familyHeadword, subtype: String(family.sublist), qualifyingMember: family.qualifyingMember, sublist: family.sublist, members: Array.isArray(family.membersJson) ? family.membersJson.join("; ") : "", sourceLabel: family.sourceVersion, sourceUrl: "https://www.wgtn.ac.nz/lals/resources/academicwordlist" })
      await client.libraryReferenceCatalogEntry.upsert({ where: { catalogKey_naturalKey: { catalogKey, naturalKey: value.naturalKey } }, update: {}, create: { catalogKey, ...value, createdByName: "AWL seed", lastEditedByName: "AWL seed" } })
    }
    return
  }
  if (catalogKey === "verbs") await client.libraryReferenceCatalogEntry.deleteMany({ where: { catalogKey, createdByName: "Library seed", naturalKey: { contains: "|" } } })
  const rows = seedRows(catalogKey)
  for (const row of rows) {
    const value = normalizeRow(catalogKey, row)
    await client.libraryReferenceCatalogEntry.upsert({ where: { catalogKey_naturalKey: { catalogKey, naturalKey: value.naturalKey } }, update: {}, create: { catalogKey, ...value, createdByName: "Library seed", lastEditedByName: "Library seed" } })
  }
}

export async function listReferenceCatalog(key, query = {}) {
  const catalogKey = catalog(key)
  const client = await getSharedPrismaClient()
  await ensureReferenceCatalogSeed(catalogKey)
  const search = lower(query.search)
  const subtype = lower(query.subtype)
  const page = Math.max(1, Number.parseInt(text(query.page), 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(text(query.pageSize), 10) || 25))
  const sortBy = ["term", "subtype", "createdAt", "updatedAt"].includes(text(query.sortBy)) ? text(query.sortBy) : "term"
  const direction = lower(query.direction) === "desc" ? "desc" : "asc"
  const where = { catalogKey, ...(subtype ? { subtype } : {}), ...(search ? { OR: [{ term: { contains: search, mode: "insensitive" } }, { subtype: { contains: search, mode: "insensitive" } }] } : {}) }
  const [total, items] = await client.$transaction([client.libraryReferenceCatalogEntry.count({ where }), client.libraryReferenceCatalogEntry.findMany({ where, orderBy: [{ [sortBy]: direction }, { term: "asc" }], skip: (page - 1) * pageSize, take: pageSize })])
  return { ok: true, catalog: { key: catalogKey, ...REFERENCE_CATALOGS[catalogKey] }, page, pageSize, total, items }
}

export async function previewReferenceCatalogImport(key, rows = []) {
  const catalogKey = catalog(key)
  const normalized = (Array.isArray(rows) ? rows : []).map((row, index) => ({ index: index + 2, value: normalizeRow(catalogKey, row) }))
  return { ok: true, catalogKey, rows: normalized.length, preview: normalized.map(({ index, value }) => ({ row: index, term: value.term, subtype: value.subtype, naturalKey: value.naturalKey })) }
}

export async function importReferenceCatalog(key, actorName, rows = []) {
  const catalogKey = catalog(key)
  const preview = await previewReferenceCatalogImport(catalogKey, rows)
  const client = await getSharedPrismaClient()
  let created = 0; let updated = 0
  for (let index = 0; index < rows.length; index += 1) {
    const value = normalizeRow(catalogKey, rows[index])
    const existing = await client.libraryReferenceCatalogEntry.findUnique({ where: { catalogKey_naturalKey: { catalogKey, naturalKey: value.naturalKey } } })
    const entry = await client.libraryReferenceCatalogEntry.upsert({ where: { catalogKey_naturalKey: { catalogKey, naturalKey: value.naturalKey } }, update: { ...value, lastEditedByName: text(actorName) }, create: { catalogKey, ...value, createdByName: text(actorName), lastEditedByName: text(actorName) } })
    await writeRevision(client, entry, existing ? "import_updated" : "import_created", actorName)
    if (existing) updated += 1; else created += 1
  }
  return { ...preview, created, updated }
}

export async function exportReferenceCatalog(key) {
  const result = await listReferenceCatalog(key, { pageSize: 100 })
  return result.items.map((entry) => ({ term: entry.term, partOfSpeech: entry.partOfSpeech || "", subtype: entry.subtype || "", ...entry.dataJson, sourceLabel: entry.sourceLabel || "", sourceUrl: entry.sourceUrl || "", editorialStatus: entry.editorialStatus }))
}
