import crypto from "node:crypto"
import { existsSync } from "node:fs"
import { load } from "cheerio"

import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { previewBritannicaLibraryEntry } from "./britannica-provider.mjs"
import { previewCambridgeLibraryEntry } from "./cambridge-provider.mjs"
import { previewLdoceLibraryEntry } from "./ldoce-provider.mjs"
import { fetchEtymonlinePreview } from "./library-origin.mjs"
import { previewMerriamWebsterLibraryEntry } from "./library-corpus.mjs"
import { previewMerriamWebsterDictionaryEntry } from "./merriam-webster-provider.mjs"
import { previewOxfordBreLibraryEntry, previewOxfordLibraryEntry } from "./oxford-provider.mjs"
import { fetchWithExponentialBackoff } from "./provider-http.mjs"

export const DICTIONARY_BUILDER_VERSION = "1.5"
export const DICTIONARY_BUILDER_DATUM_STATUS = Object.freeze(["available", "not_offered", "not_found", "not_provided", "robot_blocked", "blocked", "malformed", "unavailable", "unsupported", "unselected", "manual", "invalid"])
export const DICTIONARY_BUILDER_DATUMS = Object.freeze(["vietnamese", "syllabication", "syllableCount", "grammarClassification", "audio", "verbFormAudio", "definition", "verbForms", "stems", "synonymsAntonyms", "examples", "firstKnownUse", "originPath", "etymology", "worksCited"])
export const DICTIONARY_BUILDER_SYLLABLE_PROVIDER = "wordhelp"

const TTL_MS = 30 * 60 * 1000
const MAX_SNAPSHOTS = 20
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024
const GOOGLE_TRANSLATE_TIMEOUT_MS = 8000
const snapshots = new Map()
const datumRoundRobinCursors = new Map()
const text = (value) => String(value == null ? "" : value).replace(/\s+/gu, " ").trim()
const lower = (value) => text(value).toLocaleLowerCase("en-US")
const nowDate = () => new Date()
const WORDHELP_BROWSER_TIMEOUT_MS = 30000
const WORDHELP_BROWSER_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
function isWordHelpRobotPrompt(html) {
  return /not a robot|<h1[^>]*>[^<]*robot[^<]*<\/h1>|captcha-card|id=["']solveBtn["']|pow_init|pow_verify/iu.test(String(html || ""))
}

export async function fetchWordHelpBrowserPage(sourceUrl) {
  let browser
  try {
    const { chromium } = await import("playwright")
    const launchOptions = { headless: true, args: ["--no-sandbox"] }
    const executablePath = process.env.WORDHELP_BROWSER_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"
    if (existsSync(executablePath)) launchOptions.executablePath = executablePath
    browser = await chromium.launch(launchOptions)
    const context = await browser.newContext({ userAgent: WORDHELP_BROWSER_USER_AGENT })
    const page = await context.newPage()
    const response = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: WORDHELP_BROWSER_TIMEOUT_MS })
    if (await page.locator("#solveBtn").count()) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: WORDHELP_BROWSER_TIMEOUT_MS }).catch(() => null),
        page.locator("#solveBtn").click(),
      ])
    }
    await page.waitForTimeout(1000)
    const html = await page.content()
    const status = response?.status() || 200
    if (isWordHelpRobotPrompt(html)) return { ok: false, status, robotBlocked: true, url: page.url(), html, message: "WordHelp requires robot verification; open the source page and complete the prompt before retrying." }
    return { ok: true, status, url: page.url(), html }
  } catch (error) {
    return { ok: false, available: false, message: `WordHelp browser access failed: ${error.message}` }
  } finally {
    await browser?.close().catch(() => {})
  }
}

function source(id, label, kind, quality, capabilities, searchUrl) {
  const supported = { ...capabilities }
  if (supported.syllabication && supported.syllableCount === undefined) supported.syllableCount = supported.syllabication
  return Object.freeze({ id, label, kind, quality, capabilities: Object.freeze(supported), searchUrl })
}

export const DICTIONARY_BUILDER_MANIFEST = Object.freeze([
  source("ldoce", "LD", "dictionary", 92, { definition: 96, grammarClassification: 90, examples: 90, audio: 96, verbForms: 75, syllabication: 72, syllableCount: 72 }, (word) => `https://www.ldoceonline.com/dictionary/${encodeURIComponent(word)}`),
  source("oxford_ame", "OA", "dictionary", 91, { definition: 94, grammarClassification: 90, examples: 90, audio: 88, verbForms: 82, verbFormAudio: 88, syllabication: 75 }, (word) => `https://www.oxfordlearnersdictionaries.com/definition/american_english/${encodeURIComponent(word.replace(/\s+/gu, "-"))}?q=${encodeURIComponent(word)}`),
  source("oxford_bre", "OB", "dictionary", 90, { definition: 94, grammarClassification: 90, examples: 90, audio: 88, verbForms: 80, verbFormAudio: 88, syllabication: 75 }, (word) => `https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(word.replace(/\s+/gu, "-"))}?q=${encodeURIComponent(word)}`),
  source("britannica", "BR", "dictionary", 88, { definition: 94, grammarClassification: 86, examples: 88, stems: 76, etymology: 76, firstKnownUse: 78, synonymsAntonyms: 78, syllabication: 70, audio: 70 }, (word) => `https://www.britannica.com/dictionary/${encodeURIComponent(word)}`),
  source("merriam_webster", "MW", "dictionary", 92, { definition: 96, grammarClassification: 88, examples: 88, verbForms: 86, stems: 82, etymology: 88, firstKnownUse: 88, synonymsAntonyms: 72, syllabication: 86, audio: 86 }, (word) => `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`),
  source("merriam_webster_api", "AP", "dictionary", 92, { definition: 96, grammarClassification: 88, verbForms: 86, stems: 82, etymology: 88, firstKnownUse: 88, synonymsAntonyms: 72, syllabication: 86 }, (word) => `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`),
  source("etymonline", "ET", "history", 93, { etymology: 98, originPath: 92, worksCited: 96 }, (word) => `https://www.etymonline.com/search?q=${encodeURIComponent(word)}`),
  source("wiktionary", "WK", "dictionary", 70, { definition: 72, etymology: 76, originPath: 70, synonymsAntonyms: 70, syllabication: 60, firstKnownUse: 60 }, (word) => `https://en.wiktionary.org/w/index.php?search=${encodeURIComponent(word)}`),
  source("cambridge", "CA", "dictionary", 86, { definition: 90, grammarClassification: 84, examples: 84, audio: 85, syllabication: 72 }, (word) => `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word.replace(/\s+/gu, "-"))}`),
  source("merriam_webster_thesaurus", "TH", "thesaurus", 86, { synonymsAntonyms: 96, audio: 60 }, (word) => `https://www.merriam-webster.com/thesaurus/${encodeURIComponent(word)}`),
  source("wordhelp", "WH", "reference", 74, { syllabication: 88, syllableCount: 88, verbForms: 66 }, (word) => `https://www.wordhelp.com/syllables/english/?q=${encodeURIComponent(word)}`),
  source("google_translate", "GT", "translation", 70, { vietnamese: 88 }, (word) => `https://translate.google.com/?sl=en&tl=vi&text=${encodeURIComponent(word)}&op=translate`),
])

const manifestById = new Map(DICTIONARY_BUILDER_MANIFEST.map((item) => [item.id, item]))

export const DICTIONARY_BUILDER_SCORING_POS = Object.freeze(["adjective", "noun", "proper noun", "verb", "adverb", "conjunction", "preposition", "determiner", "pronoun", "interjection", "numeral", "phrase", "idiom", "clause"])
export const DICTIONARY_BUILDER_SCORING_DATUMS = Object.freeze([
  "vietnamese", "syllabication", "syllableCount", "definition", "grammarClassification", "posSpecific", "audio", "stems", "synonymsAntonyms", "examples", "firstKnownUse", "historyOrigin", "worksCited",
])
export const DICTIONARY_BUILDER_SCORING_SOURCES = Object.freeze([
  ["ldoce", "LD", "ldoce"], ["oxford_ame", "OA", "oxford_ame"], ["oxford_bre", "OB", "oxford_bre"], ["britannica", "BR", "britannica"],
  ["merriam_webster_api", "AP", "merriam_webster"], ["merriam_webster_scrape", "MW scrape", "merriam_webster"], ["etymonline", "ET", "etymonline"],
  ["wiktionary", "WK", "wiktionary"], ["cambridge", "CA", "cambridge"], ["merriam_webster_thesaurus", "TH", "merriam_webster_thesaurus"],
  ["wordhelp", "WH", "wordhelp"], ["google_translate", "GT", "google_translate"],
].map(([id, label, provider]) => Object.freeze({ id, label, provider })))
export const DICTIONARY_BUILDER_BIC_WEIGHTS = Object.freeze({ completeness: 0.15, quality: 0.40, availability: 0.15, acceptance: 0.30 })

const scoringSourceById = new Map(DICTIONARY_BUILDER_SCORING_SOURCES.map((item) => [item.id, item]))
const scoringDatumCapability = Object.freeze({ syllableCount: "syllabication", posSpecific: "grammarClassification", historyOrigin: "etymology" })
const scoringDatumForMetric = Object.freeze({ syllableCount: "syllabication", posSpecific: "grammarClassification", historyOrigin: "etymology" })

function scoringBaseProvider(provider) {
  return scoringSourceById.get(text(provider))?.provider || text(provider)
}

function isConfirmedCandidate(item) {
  return Number(item?.score) > 0 && !["manual", "not_provided", "not_found", "unavailable", "robot_blocked", "blocked", "unsupported", "unverified", "invalid"].includes(text(item?.status || item?.availabilityStatus)) && item?.confirmedAvailable !== false
}

function scoringSupports(provider, datum) {
  const source = manifestById.get(scoringBaseProvider(provider))
  const capability = scoringDatumCapability[datum] || datum
  return Boolean(source?.capabilities?.[capability])
}

export function dictionaryBuilderInitialQuality(provider, datum, offerCount, supports, override = null) {
  if (!supports) return 0
  if (override !== null && override !== undefined) return Math.max(0, Math.min(1, Number(override)))
  if (provider === "google_translate") return datum === "vietnamese" ? 0.9 : 0
  if (provider === "wordhelp") return ["syllabication", "syllableCount"].includes(datum) ? 0.75 : 0
  if (provider === "etymonline") return datum === "historyOrigin" ? 0.85 : 0.1
  if (["merriam_webster_api", "merriam_webster_scrape"].includes(provider) && datum === "firstKnownUse") return 0.85
  if (offerCount <= 1) return 0.75
  if (offerCount === 2) return 0.6
  return 0.5
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function settingKey(provider, partOfSpeech, datum) {
  return `${provider}\u0000${partOfSpeech}\u0000${datum}`
}

export async function getDictionaryBuilderScoringMatrix() {
  const client = await getSharedPrismaClient()
  const readAll = (delegate) => delegate?.findMany?.().catch(() => []) || []
  const [providerSettings, datumSettings, metrics] = await Promise.all([
    readAll(client.dictionaryBuilderProviderSetting),
    readAll(client.dictionaryBuilderDatumSetting),
    readAll(client.dictionaryProviderSuitabilityMetric),
  ])
  const providerById = new Map(providerSettings.map((item) => [item.provider, item]))
  const datumByKey = new Map(datumSettings.map((item) => [settingKey(item.provider, item.partOfSpeech, item.datum), item]))
  const metricByKey = new Map(metrics.map((item) => [settingKey(item.provider === "merriam_webster" ? "merriam_webster_api" : item.provider, item.partOfSpeech, item.datum), item]))
  const rows = []
  for (const partOfSpeech of DICTIONARY_BUILDER_SCORING_POS) {
    for (const datum of DICTIONARY_BUILDER_SCORING_DATUMS) {
      const offered = DICTIONARY_BUILDER_SCORING_SOURCES.filter((source) => scoringSupports(source.id, datum) && providerById.get(source.id)?.enabled !== false)
      for (const source of DICTIONARY_BUILDER_SCORING_SOURCES) {
        const providerSetting = providerById.get(source.id)
        const datumSetting = datumByKey.get(settingKey(source.id, partOfSpeech, datum))
        const enabled = providerSetting?.enabled !== false && datumSetting?.enabled !== false
        const supported = enabled && scoringSupports(source.id, datum)
        const metric = metricByKey.get(settingKey(source.id, partOfSpeech, scoringDatumForMetric[datum] || datum))
        const quality = dictionaryBuilderInitialQuality(source.id, datum, offered.length, supported, datumSetting?.qualityOverride)
        const availability = metric?.attemptCount ? metric.availableCount / metric.attemptCount : 0.2
        const acceptance = metric?.eligibleApplyCount ? metric.selectedApplyCount / metric.eligibleApplyCount : 0.2
        const offeredBySource = DICTIONARY_BUILDER_SCORING_DATUMS.filter((candidate) => scoringSupports(source.id, candidate) && providerById.get(source.id)?.enabled !== false).length
        const totalNeeded = DICTIONARY_BUILDER_SCORING_DATUMS.length
        const coverage = offeredBySource / totalNeeded
        const capabilitySource = manifestById.get(scoringBaseProvider(source.id))
        const completeness = supported ? Number((capabilitySource?.capabilities?.[scoringDatumCapability[datum] || datum] / 100).toFixed(2)) : 0
        const score = supported ? (completeness * DICTIONARY_BUILDER_BIC_WEIGHTS.completeness) + (quality * DICTIONARY_BUILDER_BIC_WEIGHTS.quality) + (availability * DICTIONARY_BUILDER_BIC_WEIGHTS.availability) + (acceptance * DICTIONARY_BUILDER_BIC_WEIGHTS.acceptance) : 0
        rows.push({ provider: source.id, label: source.label, partOfSpeech, datum, supported, enabled, qualityOverride: datumSetting?.qualityOverride === null || datumSetting?.qualityOverride === undefined ? null : Number(datumSetting.qualityOverride), completeness, quality: Number(quality.toFixed(2)), availability: Number(availability.toFixed(2)), acceptance: Number(acceptance.toFixed(2)), coverage: Number(coverage.toFixed(2)), score: Number(score.toFixed(2)), attempts: metric?.attemptCount || 0, available: metric?.availableCount || 0, successes: metric?.availableCount || 0, selected: metric?.selectedApplyCount || 0 })
      }
    }
  }
  return { sources: DICTIONARY_BUILDER_SCORING_SOURCES, datums: DICTIONARY_BUILDER_SCORING_DATUMS, partOfSpeech: DICTIONARY_BUILDER_SCORING_POS, rows, providerSettings, datumSettings }
}

export async function updateDictionaryBuilderScoringSettings(payload = {}, actorName = "") {
  const client = await getSharedPrismaClient()
  const providers = Array.isArray(payload.providers) ? payload.providers : []
  const datums = Array.isArray(payload.datums) ? payload.datums : []
  await client.$transaction(async (tx) => {
    for (const item of providers) {
      const provider = text(item?.provider)
      if (!scoringSourceById.has(provider)) continue
      const enabled = item.enabled !== false
      const timeoutMs = Math.max(500, Math.min(60000, Math.round(number(item.timeoutMs, 8000))))
      const maxConcurrentRequests = Math.max(1, Math.min(20, Math.round(number(item.maxConcurrentRequests, 2))))
      const maxRequestsPerMinute = Math.max(1, Math.min(600, Math.round(number(item.maxRequestsPerMinute, 30))))
      const values = { enabled, timeoutMs, maxConcurrentRequests, maxRequestsPerMinute, updatedByName: text(actorName) || null }
      await tx.dictionaryBuilderProviderSetting.upsert({
        where: { provider },
        create: { provider, ...values },
        update: values,
      })
    }
    for (const item of datums) {
      const provider = text(item?.provider); const partOfSpeech = lower(item?.partOfSpeech); const datum = text(item?.datum)
      if (!scoringSourceById.has(provider) || !DICTIONARY_BUILDER_SCORING_POS.includes(partOfSpeech) || !DICTIONARY_BUILDER_SCORING_DATUMS.includes(datum) || !scoringSupports(provider, datum)) continue
      const qualityOverride = item.qualityOverride === null || item.qualityOverride === "" || item.qualityOverride === undefined ? null : Math.max(0.5, Math.min(1, number(item.qualityOverride)))
      await tx.dictionaryBuilderDatumSetting.upsert({ where: { provider_partOfSpeech_datum: { provider, partOfSpeech, datum } }, create: { provider, partOfSpeech, datum, enabled: item.enabled !== false, qualityOverride, updatedByName: text(actorName) || null }, update: { enabled: item.enabled !== false, qualityOverride, updatedByName: text(actorName) || null } })
    }
  })
  return getDictionaryBuilderScoringMatrix()
}

export function dictionaryBuilderSourceLinks(word) {
  const normalized = text(word)
  return DICTIONARY_BUILDER_MANIFEST.map(({ id, label, searchUrl }) => ({ id, label, href: normalized ? searchUrl(normalized) : "" }))
}

function datumStatus(value, supported) {
  if (!supported) return { status: "not_offered" }
  return value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)
    ? { status: "not_provided" }
    : { status: "available" }
}

function apaCitation(provider, word, url = "", retrievedAt = nowDate()) {
  const sourceItem = manifestById.get(provider)
  const name = sourceItem?.label || provider
  const date = new Date(retrievedAt).toISOString().slice(0, 10)
  return `${name}. (n.d.). *${text(word)}*. Retrieved ${date}, from ${url || `{${provider}_url}`}`
}

export function buildDictionaryBuilderCitations(word, retrievedAt = nowDate()) {
  return DICTIONARY_BUILDER_MANIFEST.map((item) => ({ provider: item.id, citation: apaCitation(item.id, word, item.searchUrl(text(word)), retrievedAt) }))
}

export function formatDictionaryBuilderDefinition(entry, fields = {}, citations = []) {
  const headword = text(entry?.english)
  const partOfSpeech = text(entry?.partOfSpeech)
  const definition = text(fields.definition)
  const listLines = (value) => String(value == null ? "" : value).split(/\r?\n/u).map((line) => text(line).replace(/^[-*]\s*/u, "")).filter(Boolean).map((line) => `  - ${line}`).join("\n")
  const relationRows = (value) => {
    const sections = { synonyms: [], antonyms: [] }
    let section = ""
    for (const line of String(value == null ? "" : value).split(/\r?\n/u)) {
      const normalized = text(line).replace(/[:*]/gu, "").toLocaleLowerCase("en-US")
      if (normalized === "synonyms" || normalized === "antonyms") { section = normalized; continue }
      if (section && text(line)) sections[section].push(text(line).replace(/^[-*]\s*/u, ""))
    }
    return sections
  }
  const lines = [`**${headword}**${partOfSpeech ? ` *${partOfSpeech}*` : ""}`]
  if (definition) lines.push(definition)
  const forms = ["verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5"].map((key) => [key, text(fields[key])]).filter(([, value]) => value)
  if (forms.length) lines.push(`**Verb Forms**\n${forms.map(([key, value]) => `${key.replace("verb", "").replace("Infinitive", "INF")}: ${value}`).join("\n")}`)
  if (fields.stems) lines.push(`**Stems**\n${listLines(fields.stems)}`)
  const relations = relationRows(fields.synonymsAntonyms)
  if (relations.synonyms.length || relations.antonyms.length) {
    const rowCount = Math.max(relations.synonyms.length, relations.antonyms.length)
    const rows = Array.from({ length: rowCount }, (_, index) => `| ${relations.synonyms[index] || ""} | ${relations.antonyms[index] || ""} |`).join("\n")
    lines.push(`| **Synonyms** | **Antonyms** |\n|--------------|--------------|\n${rows}`)
  }
  if (fields.examples) lines.push(`**Examples of ${headword} in a Sentence** (<= 10 max)\n${listLines(fields.examples)}`)
  if (fields.firstKnownUse) lines.push(`<hr>\n\n**First known use**\n${text(fields.firstKnownUse)}`)
  lines.push(`**Origin path**\n${text(fields.originPath) || "YTBD"}`)
  if (fields.etymology) lines.push(`**Etymology**\n${text(fields.etymology)}`)
  lines.push(`<hr>\n\n**Works Cited**\n${citations.map((item) => item.citation).join("\n")}`)
  return lines.filter(Boolean).join("\n\n")
}

function joinedDatumText(value) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean).join("\n")
  return text(value)
}

function firstDatumValue(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length)) || ""
}

function topSynonymsAntonymsRows(value, rowLimit = 4, wordLimit = 12) {
  const lines = String(value == null ? "" : value).trim().split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  const sections = []
  let current = null
  for (const line of lines) {
    const heading = line.replace(/[:*]/gu, "").trim().toLocaleLowerCase("en-US")
    if (heading === "synonyms" || heading === "antonyms") {
      current = { heading: heading[0].toLocaleUpperCase("en-US") + heading.slice(1), rows: [], wordCount: 0 }
      sections.push(current)
    } else if (current && !current.closed && current.rows.length < rowLimit) {
      const row = line.replace(/^[-*]\s+/u, "").trim()
      const wordCount = row.split(/\s+/u).filter(Boolean).length
      if (current.wordCount + wordCount > wordLimit) {
        current.closed = true
        continue
      }
      current.rows.push(row)
      current.wordCount += wordCount
    }
  }
  return sections.filter((section) => section.rows.length).map((section) => `${section.heading}:\n${section.rows.join("\n")}`).join("\n\n")
}

export function normalizeProviderPreview(provider, preview, entry) {
  const sourceItem = manifestById.get(provider)
  const offered = sourceItem?.capabilities || {}
  if (!preview?.ok) {
    const message = text(preview?.message)
    const robotBlocked = preview?.status === "robot_blocked" || /access challenge|robot verification|verify you are human|captcha|checking your browser/iu.test(message)
    const status = preview?.status === "not_found" ? "not_found" : robotBlocked ? "robot_blocked" : preview?.available === false ? "unavailable" : "unsupported"
    return { provider, status, message: message || `${sourceItem?.label || provider} did not offer a matching entry.`, sourceUrl: text(preview?.sourceUrl), fields: {}, datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: offered[datum] ? status : "not_offered" }])), media: [] }
  }
  const fields = { ...(preview.fields || {}) }
  const dictionaryMetadata = fields.dictionaryMetadata && typeof fields.dictionaryMetadata === "object" ? fields.dictionaryMetadata : {}
  const additionalSections = dictionaryMetadata.additionalSections && typeof dictionaryMetadata.additionalSections === "object" ? dictionaryMetadata.additionalSections : {}
  delete fields.dictionaryMetadata
  delete fields.dictionarySourceUrl
  const entries = Array.isArray(preview.entries) ? preview.entries : []
  const primary = entries.find((item) => lower(item?.partOfSpeech) === lower(entry?.partOfSpeech)) || entries[0] || {}
  const labels = [...new Set([...(Array.isArray(primary?.labels) ? primary.labels : []), ...(Array.isArray(primary?.grammarLabels) ? primary.grammarLabels : []), ...(Array.isArray(primary?.tags) ? primary.tags : [])].map((item) => lower(item)).filter(Boolean))]
  const labelValue = (choices) => choices.find((choice) => labels.includes(choice)) || ""
  const mappedClassification = { ...(fields.grammarClassification && typeof fields.grammarClassification === "object" ? fields.grammarClassification : {}) }
  if (lower(entry?.partOfSpeech) === "noun" || lower(entry?.partOfSpeech) === "proper noun") {
    const countability = labelValue(["countable", "uncountable", "countable and uncountable"])
    const quality = labelValue(["concrete", "material", "abstract"])
    const classification = labelValue(["common", "proper", "collective", "compound", "possessive"])
    if (countability) fields.countability = countability
    if (quality) fields.physicalQuality = quality
    if (classification) fields.primaryClassification = classification
  }
  const subtypeChoices = {
    conjunction: ["coordinating", "subordinating", "correlative"],
    preposition: ["simple", "compound", "phrasal"],
    pronoun: ["personal", "possessive", "reflexive", "reciprocal", "intensive", "indefinite", "demonstrative", "interrogative", "relative", "pronominal adjectives", "archaic"],
    determiner: ["articles", "possessive", "numbers", "indefinite pronouns", "demonstrative", "distributive", "quantifier", "interrogative", "relative", "ordinal", "cardinal"],
    adverb: ["manner", "place", "time", "frequency", "degree", "sentence"],
  }
  const subtypeMatches = subtypeChoices[lower(entry?.partOfSpeech)]?.filter((choice) => labels.includes(choice)) || []
  if (subtypeMatches.length) mappedClassification.grammarSubtypes = subtypeMatches
  if (subtypeMatches.length && !mappedClassification.grammarSubtype) mappedClassification.grammarSubtype = subtypeMatches[0]
  if (lower(entry?.partOfSpeech) === "verb") {
    const regularity = labelValue(["regular", "irregular"])
    const transitivity = labelValue(["intransitive", "transitive", "monotransitive", "ditransitive", "ambitransitive"])
    const verbType = labelValue(["primary", "modal", "action"])
    if (regularity) fields.verbRegularity = regularity
    if (transitivity) fields.verbTransitivity = transitivity === "transitive" ? "transitive" : transitivity
    if (verbType) mappedClassification.grammarFamily = verbType
  }
  if (Object.keys(mappedClassification).length) fields.grammarClassification = mappedClassification
  const inflections = Array.isArray(primary?.inflections) ? primary.inflections.map((item) => text(typeof item === "object" ? item.form : item)).filter(Boolean) : []
  const providedForms = fields.verbForms && typeof fields.verbForms === "object" && !Array.isArray(fields.verbForms) ? fields.verbForms : {}
  const forms = ["verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5"].reduce((result, key, index) => ({ ...result, [key]: providedForms[key] || fields[key] || inflections[index] || "" }), {})
  const audio = ["us", "uk"].flatMap((dialect) => primary?.audio?.[dialect] ? [{ dialect, available: true }] : [])
  const verbFormAudio = primary?.verbFormAudio && typeof primary.verbFormAudio === "object" ? primary.verbFormAudio : {}
  const privateMedia = [
    ...audio.flatMap(({ dialect }) => [{ dialect, slot: "headword", sourceUrl: primary.audio[dialect] }]),
    ...Object.entries(verbFormAudio).flatMap(([slot, values]) => values?.us ? [{ dialect: "us", slot, sourceUrl: values.us }] : []),
  ]
  const audioValue = audio.length || Object.keys(verbFormAudio).length ? [...audio, ...Object.keys(verbFormAudio).map((slot) => ({ dialect: "us", slot, available: true }))] : []
  const examples = entries.flatMap((item) => Array.isArray(item?.senses) ? item.senses.flatMap((sense) => Array.isArray(sense?.examples) ? sense.examples.map((example) => text(typeof example === "object" ? example.text : example)).filter(Boolean) : []) : [])
  const synonyms = firstDatumValue(fields.synonyms, dictionaryMetadata.synonyms, additionalSections.synonyms)
  const antonyms = firstDatumValue(fields.antonyms, dictionaryMetadata.antonyms, additionalSections.antonyms)
  const rawSynonymsAntonyms = firstDatumValue(
    fields.synonymsAntonyms,
    [joinedDatumText(synonyms) ? `Synonyms:\n${joinedDatumText(synonyms)}` : "", joinedDatumText(antonyms) ? `Antonyms:\n${joinedDatumText(antonyms)}` : ""].filter(Boolean).join("\n\n"),
  )
  const synonymsAntonyms = provider === "merriam_webster_thesaurus" ? topSynonymsAntonymsRows(rawSynonymsAntonyms) : rawSynonymsAntonyms
  const normalizedFields = {
    ...fields,
    syllabication: firstDatumValue(fields.syllabication, primary?.hyphenation, primary?.syllabication),
    verbForms: Object.values(forms).some(Boolean) ? forms : "",
    stems: firstDatumValue(joinedDatumText(fields.stems), joinedDatumText(additionalSections.stems)),
    synonymsAntonyms: synonymsAntonyms,
    examples: firstDatumValue(joinedDatumText(fields.examples), joinedDatumText(examples)),
    firstKnownUse: firstDatumValue(joinedDatumText(fields.firstKnownUse), joinedDatumText(dictionaryMetadata.firstKnownUse)),
    originPath: firstDatumValue(joinedDatumText(fields.originPath), joinedDatumText(dictionaryMetadata.originPath)),
    etymology: firstDatumValue(joinedDatumText(fields.etymology), joinedDatumText(dictionaryMetadata.etymology)),
  }
  normalizedFields.syllableCount = normalizedFields.syllabication ? normalizedFields.syllabication.split(/[-‐‑‒–—]/u).map((part) => text(part)).filter(Boolean).length : ""
  const values = {
    grammarClassification: normalizedFields.grammarClassification,
    audio: audioValue.filter((item) => item.slot === undefined || item.slot === "headword"),
    verbFormAudio,
    definition: normalizedFields.definition,
    verbForms: normalizedFields.verbForms,
    stems: normalizedFields.stems,
    synonymsAntonyms: normalizedFields.synonymsAntonyms,
    examples: normalizedFields.examples,
    syllabication: normalizedFields.syllabication,
    syllableCount: normalizedFields.syllableCount,
    firstKnownUse: normalizedFields.firstKnownUse,
    originPath: normalizedFields.originPath,
    etymology: normalizedFields.etymology,
    worksCited: apaCitation(provider, entry?.english, preview.sourceUrl),
  }
  const headwordAudio = audioValue.filter((item) => item.slot === undefined || item.slot === "headword")
  return { provider, status: "available", message: "", sourceUrl: text(preview.sourceUrl), fields: { ...normalizedFields, audio: headwordAudio, verbFormAudio }, entries: entries.map((item) => ({ headword: text(item.headword), partOfSpeech: text(item.partOfSpeech), senses: Array.isArray(item.senses) ? item.senses.map((sense) => ({ number: text(sense.number), definition: text(sense.definition), examples: (sense.examples || []).map((example) => text(typeof example === "object" ? example.text : example)).filter(Boolean) })) : [] })), datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, datumStatus(values[datum], offered[datum])])), media: headwordAudio, privateMedia }
}

async function previewEtymonlineAdapter(entry) {
  try {
    const preview = await fetchEtymonlinePreview(entry?.english)
    const fields = { etymology: preview.paragraph || "", originPath: preview.originPath || "", originReferences: preview.reference ? [preview.reference] : {} }
    return normalizeProviderPreview("etymonline", { ok: true, fields, sourceUrl: preview.sourceUrl }, entry)
  } catch (error) {
    return normalizeProviderPreview("etymonline", { ok: false, available: false, message: text(error.message) }, entry)
  }
}

function decodeGoogleTranslateHtml(value) {
  return text(String(value || "")
    .replace(/<[^>]*>/gu, "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">"))
}

export async function previewGoogleTranslateAdapter(entry, { fetchImpl = fetch } = {}) {
  const provider = "google_translate"
  const item = manifestById.get(provider)
  const word = text(entry?.english)
  const datumStatus = (status) => Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: datum === "vietnamese" ? status : "not_offered" }]))
  if (!word || typeof fetchImpl !== "function") return { provider, status: "unavailable", message: "Google Translate requires an English headword.", sourceUrl: item.searchUrl(word), fields: {}, entries: [], media: [], datumStatus: datumStatus("unavailable") }
  const requestUrl = new URL("https://translate.google.com/m")
  requestUrl.searchParams.set("sl", "en")
  requestUrl.searchParams.set("tl", "vi")
  requestUrl.searchParams.set("q", word)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GOOGLE_TRANSLATE_TIMEOUT_MS)
  try {
    const response = await fetchWithExponentialBackoff(fetchImpl, requestUrl, { headers: { accept: "text/html", "user-agent": "SIS Dictionary Builder/1.5" }, redirect: "follow", signal: controller.signal })
    if (!response?.ok) throw new Error(`Google Translate returned HTTP ${response?.status || 0}`)
    const html = await response.text()
    const match = html.match(/<div\s+class=["']result-container["'][^>]*>([\s\S]*?)<\/div>/iu)
    const vietnamese = decodeGoogleTranslateHtml(match?.[1])
    if (!vietnamese) throw new Error("Google Translate returned no Vietnamese translation")
    return { provider, status: "available", message: "", sourceUrl: item.searchUrl(word), fields: { vietnamese }, entries: [], media: [], datumStatus: datumStatus("available") }
  } catch (error) {
    return { provider, status: "unavailable", message: text(error.message) || "Google Translate is unavailable.", sourceUrl: item.searchUrl(word), fields: {}, entries: [], media: [], datumStatus: datumStatus("unavailable") }
  } finally {
    clearTimeout(timeout)
  }
}

async function previewPassiveAdapter(provider, entry) {
  const item = manifestById.get(provider)
  return { provider, status: "manual", message: `${item.label} is a manual lookup until its compliant server adapter is available.`, sourceUrl: item.searchUrl(text(entry?.english)), fields: {}, entries: [], media: [], datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: item.capabilities[datum] ? "manual" : "not_offered" }])) }
}

export async function previewHtmlAdapter(provider, entry, fetchImpl = fetch, browserFetchImpl = fetchWordHelpBrowserPage) {
  const item = manifestById.get(provider)
  const word = text(entry?.english)
  if (!word) return { provider, status: "unavailable", message: "An English word is required.", sourceUrl: item.searchUrl(""), fields: {}, entries: [], media: [], datumStatus: {} }
  const sourceUrl = item.searchUrl(word)
  try {
    let response = await fetchWithExponentialBackoff(fetchImpl, sourceUrl, { headers: { Accept: "text/html", "User-Agent": "SIS-admin-Dictionary-Builder/1.0" }, redirect: "follow" })
    if (!response.ok) {
      if (provider === "wordhelp" && response.status === 429) {
        const challengeHtml = await response.text().catch(() => "")
        if (isWordHelpRobotPrompt(challengeHtml)) {
          response = await browserFetchImpl(sourceUrl)
          if (!response?.ok) return { provider, status: response?.robotBlocked ? "robot_blocked" : "unavailable", message: response?.message || `${item.label} browser access failed`, sourceUrl, fields: {}, entries: [], media: [], datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: item.capabilities[datum] ? response?.robotBlocked ? "robot_blocked" : "unavailable" : "not_offered" }])) }
        } else {
          throw new Error(`HTTP ${response.status}`)
        }
      }
      if (response.status === 404) return { provider, status: "not_found", message: `${item.label} returned HTTP 404; no matching entry was provided.`, sourceUrl, fields: {}, entries: [], media: [], datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: item.capabilities[datum] ? "not_found" : "not_offered" }])) }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
    }
    const html = typeof response.html === "string" ? response.html : await response.text()
    const $ = load(html)
    const body = text($("main, article, #content, body").first().text())
    if (!body) throw new Error("No usable source content")
    const robotPrompt = provider === "wordhelp"
      ? isWordHelpRobotPrompt(html)
      : /just a moment|enable javascript and cookies|cf-chl-|challenge-platform|access denied|verify you are human|checking your browser|robot verification|captcha|not a robot/iu.test(body)
    if (robotPrompt) {
      return { provider, status: "robot_blocked", message: `${item.label} requires robot verification; open the source page and complete the prompt before retrying.`, sourceUrl: response.url || sourceUrl, fields: {}, entries: [], media: [], datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: item.capabilities[datum] ? "robot_blocked" : "not_offered" }])) }
    }
    const wordHelpBody = provider === "wordhelp" ? body : ""
    const rawSyllabication = provider === "wordhelp"
      ? $("li").filter((_, node) => /divide .* into syllables/iu.test(text($(node).text()))).first().text().match(/[A-Za-z]+(?:[-‧·][A-Za-z]+)+/u)?.[0]
        || text($(".syllables, .syllable, [class*=syllab], main").first().text()).match(/[A-Za-z]+(?:[-‧·][A-Za-z]+)+/u)?.[0]
        || wordHelpBody.match(/[A-Za-z]+(?:[-‧·][A-Za-z]+)+/u)?.[0]
        || ""
      : ""
    const stressedSyllable = provider === "wordhelp"
      ? $("li").filter((_, node) => /stressed syllable in/iu.test(text($(node).text()))).first().find("strong, b, em, i").first().text().trim()
      : ""
    const syllabication = rawSyllabication && stressedSyllable
      ? rawSyllabication.split(/[-‧·]/u).map((part) => part.toLocaleLowerCase("en-US") === stressedSyllable.toLocaleLowerCase("en-US") ? stressedSyllable.toLocaleUpperCase("en-US") : part).join("-")
      : rawSyllabication
    const syllableCount = provider === "wordhelp" ? Number(wordHelpBody.match(/\b(\d+)\s+syllables?\b/iu)?.[1] || (syllabication ? syllabication.split(/[-‧·]/u).length : 0)) : 0
    const definition = provider === "merriam_webster_thesaurus" ? body : text($(".definition, .def, .dtText, .sense, main").first().text()) || body
    const fields = {}
    if (["wiktionary", "merriam_webster_thesaurus"].includes(provider)) fields.definition = definition
    if (provider === "merriam_webster_thesaurus") {
      const relationRows = (selectors) => $(selectors).map((_, node) => text($(node).text())).get().filter(Boolean)
      const synonyms = relationRows("[class*='synonym'] li, [data-synonym]")
      const antonyms = relationRows("[class*='antonym'] li, [data-antonym]")
      fields.synonymsAntonyms = topSynonymsAntonymsRows([
        synonyms.length ? `Synonyms:\n${synonyms.join("\n")}` : "",
        antonyms.length ? `Antonyms:\n${antonyms.join("\n")}` : "",
      ].filter(Boolean).join("\n\n"))
    }
    if (provider === "wordhelp") { fields.syllabication = syllabication; fields.syllableCount = syllableCount }
    const datumStatus = Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: fields[datum] ? "available" : item.capabilities[datum] ? "not_provided" : "not_offered" }]))
    return { provider, status: "available", sourceUrl: response.url || sourceUrl, fields, entries: [], media: [], datumStatus }
  } catch (error) {
    return { provider, status: "unavailable", message: `${item.label} unavailable: ${error.message}`, sourceUrl, fields: {}, entries: [], media: [], datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: item.capabilities[datum] ? "unavailable" : "not_offered" }])) }
  }
}

function previewWordHelpAdapter(entry) {
  const provider = "wordhelp"
  const item = manifestById.get(provider)
  const word = text(entry?.english)
  const syllabicationStatus = word ? "manual" : "unavailable"
  return {
    provider,
    status: syllabicationStatus,
    message: word ? "WordHelp is the manual syllable/stress lookup in the datum review rotation." : "WordHelp requires an English headword.",
    sourceUrl: item.searchUrl(word),
    fields: {},
    entries: [],
    media: [],
    datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: ["syllabication", "syllableCount"].includes(datum) ? syllabicationStatus : "not_offered" }])),
  }
}

const adapters = Object.freeze({
  ldoce: async (entry) => normalizeProviderPreview("ldoce", await previewLdoceLibraryEntry(entry), entry),
  oxford_ame: async (entry) => normalizeProviderPreview("oxford_ame", await previewOxfordLibraryEntry(entry), entry),
  oxford_bre: async (entry) => normalizeProviderPreview("oxford_bre", await previewOxfordBreLibraryEntry(entry), entry),
  britannica: async (entry) => normalizeProviderPreview("britannica", await previewBritannicaLibraryEntry(entry), entry),
  merriam_webster_api: async (entry) => ({ ...normalizeProviderPreview("merriam_webster", await previewMerriamWebsterLibraryEntry(entry), entry), provider: "merriam_webster_api" }),
  merriam_webster_scrape: async (entry) => ({ ...normalizeProviderPreview("merriam_webster", await previewMerriamWebsterDictionaryEntry(entry), entry), provider: "merriam_webster_scrape" }),
  etymonline: previewEtymonlineAdapter,
  wiktionary: (entry) => previewHtmlAdapter("wiktionary", entry),
  cambridge: async (entry) => normalizeProviderPreview("cambridge", await previewCambridgeLibraryEntry(entry), entry),
  merriam_webster_thesaurus: (entry) => previewHtmlAdapter("merriam_webster_thesaurus", entry),
  wordhelp: (entry) => previewHtmlAdapter("wordhelp", entry),
  google_translate: previewGoogleTranslateAdapter,
})

async function metricScore(client, provider, partOfSpeech, datum) {
  const item = manifestById.get(provider)
  const capability = scoringDatumCapability[datum] || datum
  const completeness = item?.capabilities?.[capability] ? Number(item.capabilities[capability]) / 100 : 0
  const quality = item?.capabilities?.[capability] ? Number(item.quality || 0) / 100 : 0
  const metric = await client.dictionaryProviderSuitabilityMetric.findUnique({ where: { provider_partOfSpeech_datum: { provider, partOfSpeech: lower(partOfSpeech) || "any", datum } } }).catch(() => null)
  const observed = metric?.attemptCount ? Math.round((metric.availableCount / metric.attemptCount) * 100) : 50
  const selected = metric?.eligibleApplyCount ? Math.round((metric.selectedApplyCount / metric.eligibleApplyCount) * 100) : 50
  const availability = observed / 100
  const acceptance = selected / 100
  const score = (completeness * DICTIONARY_BUILDER_BIC_WEIGHTS.completeness) + (quality * DICTIONARY_BUILDER_BIC_WEIGHTS.quality) + (availability * DICTIONARY_BUILDER_BIC_WEIGHTS.availability) + (acceptance * DICTIONARY_BUILDER_BIC_WEIGHTS.acceptance)
  return { provider, datum, score: Math.round(score * 100), components: { completeness: Math.round(completeness * 100), quality: Math.round(quality * 100), availability: observed, acceptance: selected } }
}

export async function dictionaryBuilderRankSources(partOfSpeech, datum = "definition") {
  const client = await getSharedPrismaClient()
  const rows = await Promise.all(DICTIONARY_BUILDER_MANIFEST.filter((item) => item.kind === "dictionary").map((item) => metricScore(client, item.id, partOfSpeech, datum)))
  return rows.sort((left, right) => right.score - left.score || left.provider.localeCompare(right.provider))
}

export async function dictionaryBuilderRankDatumSources(partOfSpeech, datum) {
  const matrix = await getDictionaryBuilderScoringMatrix()
  const scoringDatum = datum === "syllabication" ? "syllabication" : datum
  return matrix.rows
    .filter((row) => row.partOfSpeech === lower(partOfSpeech) && row.datum === scoringDatum && row.supported && Number(row.score) > 0)
    .map((row) => ({ provider: row.provider, score: Math.round(row.score * 100), confirmedAvailable: row.available > 0, components: { completeness: row.completeness, quality: row.quality, availability: row.availability, acceptance: row.acceptance, coverage: row.coverage } }))
    .sort((left, right) => right.score - left.score || left.provider.localeCompare(right.provider))
}

export function dictionaryBuilderBicDatumProviderIds(datum, rankedSources = []) {
  const eligible = rankedSources
    .filter(isConfirmedCandidate)
    .map((item) => text(item?.provider))
    .filter((provider, index, providers) => index === providers.indexOf(provider) && manifestById.get(scoringBaseProvider(provider))?.capabilities?.[datum])
  if (datum === "firstKnownUse") return eligible.filter((provider) => ["merriam_webster", "merriam_webster_api", "merriam_webster_scrape", "wiktionary"].includes(provider)).slice(0, 3)
  if (datum === "synonymsAntonyms") return [ ...(eligible.includes("merriam_webster_thesaurus") ? ["merriam_webster_thesaurus"] : []), ...eligible.filter((provider) => provider !== "merriam_webster_thesaurus")].filter((provider, index, providers) => manifestById.has(scoringBaseProvider(provider)) && index < 3 && providers.indexOf(provider) === index)
  if (datum !== "syllabication") return eligible.slice(0, 3)
  const independent = eligible.filter((provider) => provider !== DICTIONARY_BUILDER_SYLLABLE_PROVIDER && scoringBaseProvider(provider) === "merriam_webster")
  return [ ...(eligible.includes(DICTIONARY_BUILDER_SYLLABLE_PROVIDER) ? [DICTIONARY_BUILDER_SYLLABLE_PROVIDER] : []), ...independent].filter((provider, index, providers) => manifestById.has(scoringBaseProvider(provider)) && index < 2 && providers.indexOf(provider) === index)
}

function rankedDatumProviderIds(datum, rankedSources = []) {
  return rankedSources
    .filter((item) => Number(item?.score) > 0 && scoringSupports(text(item?.provider), datum))
    .map((item) => text(item.provider))
    .filter((provider, index, providers) => manifestById.has(scoringBaseProvider(provider)) && index === providers.indexOf(provider))
    .slice(0, 3)
}

function currentAvailableDatumProviders(datum, results, rankedSources = []) {
  const ranked = new Map(rankedSources.map((item, index) => [text(item?.provider), index]))
  return results
    .filter((result) => result?.datumStatus?.[datum]?.status === "available" && result?.fields?.[datum] !== undefined)
    .sort((left, right) => (ranked.get(left.provider) ?? Number.MAX_SAFE_INTEGER) - (ranked.get(right.provider) ?? Number.MAX_SAFE_INTEGER))
    .map((result) => result.provider)
    .filter((provider, index, providers) => index === providers.indexOf(provider))
}

export async function dictionaryBuilderBicTopThreeByDatum(partOfSpeech, rankedSourcesByDatum = {}) {
  const table = {}
  for (const datum of DICTIONARY_BUILDER_DATUMS) {
    const ranked = Array.isArray(rankedSourcesByDatum?.[datum]) ? rankedSourcesByDatum[datum] : await dictionaryBuilderRankDatumSources(partOfSpeech, datum)
    table[datum] = dictionaryBuilderBicDatumProviderIds(datum, ranked)
  }
  return table
}

export function dictionaryBuilderRoundRobinDatumSourceOrder(datum, rankedSources = [], rotation = 0) {
  const offered = rankedSources.filter((item) => isConfirmedCandidate(item) && manifestById.get(scoringBaseProvider(text(item?.provider)))?.capabilities?.[datum])
  if (!offered.length) return []
  const highestScore = Number(offered[0].score || 0)
  const scoreBand = offered.filter((item) => Number(item.score || 0) >= highestScore - 5)
  const remaining = offered.filter((item) => !scoreBand.includes(item))
  const start = ((Number(rotation) % scoreBand.length) + scoreBand.length) % scoreBand.length
  return [...scoreBand.slice(start), ...scoreBand.slice(0, start), ...remaining].map((item) => text(item.provider))
}

function dictionaryBuilderAdapter(fetcher, provider) {
  return fetcher[provider] || fetcher[provider === "merriam_webster" ? "merriam_webster_api" : scoringBaseProvider(provider)]
}

function sameDictionaryProvider(left, right) {
  return scoringBaseProvider(left) === scoringBaseProvider(right)
}

function nextDatumRoundRobinOffset(partOfSpeech, datum) {
  const key = `${lower(partOfSpeech) || "any"}\u0000${text(datum)}`
  const offset = datumRoundRobinCursors.get(key) || 0
  datumRoundRobinCursors.set(key, offset + 1)
  return offset
}

function initialDictionaryProperProviders(ranked) {
  const bands = new Map()
  ranked.filter((item) => isConfirmedCandidate(item) && item.provider !== "merriam_webster").forEach((item) => { const key = Math.floor(item.score / 5) * 5; bands.set(key, [...(bands.get(key) || []), item]) })
  return [...bands.keys()].sort((a, b) => b - a).flatMap((key) => bands.get(key).sort((a, b) => a.provider.localeCompare(b.provider))).slice(0, 2).map((item) => item.provider)
}

function cleanCache() {
  const now = Date.now()
  for (const [id, snapshot] of snapshots) if (snapshot.expiresAtMs <= now) snapshots.delete(id)
  while (snapshots.size > MAX_SNAPSHOTS || [...snapshots.values()].reduce((total, snapshot) => total + snapshot.bytes, 0) > MAX_SNAPSHOT_BYTES) snapshots.delete(snapshots.keys().next().value)
}

function publicSnapshot(snapshot) {
  const { ownerKey, bytes, privateSources, ...safe } = snapshot
  return safe
}

export async function previewDictionaryBuilder(entry, { ownerKey, fetcher = adapters, rankedSources = null, rankedSourcesByDatum = {}, datumRoundRobinOffsets = {} } = {}) {
  const owner = text(ownerKey)
  if (!owner) throw new Error("Dictionary Builder requires an authenticated session binding")
  const ranked = Array.isArray(rankedSources) ? rankedSources : await dictionaryBuilderRankDatumSources(entry?.partOfSpeech, "definition")
  const selected = [...rankedDatumProviderIds("definition", ranked), "merriam_webster_api", "merriam_webster_thesaurus", "google_translate", DICTIONARY_BUILDER_SYLLABLE_PROVIDER]
    .filter((provider, index, providers) => index === providers.findIndex((candidate) => scoringBaseProvider(candidate) === scoringBaseProvider(provider)))
  const results = await Promise.all(selected.map(async (provider) => {
    const adapter = dictionaryBuilderAdapter(fetcher, provider)
    try { return await adapter(entry) } catch (error) { return { provider, status: "unavailable", message: text(error.message), fields: {}, entries: [], media: [], datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: "unavailable" }])) } }
  }))
  const missing = DICTIONARY_BUILDER_DATUMS.filter((datum) => !results.some((result) => result.datumStatus?.[datum]?.status === "available"))
  const requestedDatums = [...new Set([...missing, "audio", ...(lower(entry?.partOfSpeech) === "verb" ? ["verbFormAudio"] : [])])]
  const datumSourceOrder = {}
  for (const datum of requestedDatums) {
    const rankedForDatum = Array.isArray(rankedSourcesByDatum?.[datum]) ? rankedSourcesByDatum[datum] : await dictionaryBuilderRankDatumSources(entry?.partOfSpeech, datum)
    const rankedOrder = rankedDatumProviderIds(datum, rankedForDatum)
    const sourceOrder = datum === "verbForms"
      ? ["merriam_webster_api", "oxford_ame", "oxford_bre"]
      : datum === "audio"
      ? ["britannica", "merriam_webster_scrape", "oxford_ame", "oxford_bre", "merriam_webster_thesaurus"]
      : datum === "verbFormAudio"
        ? ["oxford_ame", "oxford_bre"]
      : datum === "syllabication"
      ? [DICTIONARY_BUILDER_SYLLABLE_PROVIDER, "merriam_webster_api"]
      : datum === "synonymsAntonyms"
        ? ["merriam_webster_thesaurus", ...rankedOrder.filter((provider) => provider !== "merriam_webster_thesaurus")].slice(0, 3)
      : rankedOrder
    const normalizedSourceOrder = sourceOrder.map((provider) => results.find((result) => sameDictionaryProvider(result.provider, provider))?.provider || provider)
    datumSourceOrder[datum] = normalizedSourceOrder
    for (const provider of normalizedSourceOrder) {
      if (results.some((result) => sameDictionaryProvider(result.provider, provider))) continue
      const adapter = dictionaryBuilderAdapter(fetcher, provider)
      try { results.push(await adapter(entry)) } catch (error) { results.push({ provider, status: "unavailable", message: text(error.message), fields: {}, entries: [], media: [], datumStatus: { [datum]: { status: "unavailable" } } }) }
    }
  }
  const bicTopThreeByDatum = {}
  for (const datum of DICTIONARY_BUILDER_DATUMS) {
    const rankedForDatum = Array.isArray(rankedSourcesByDatum?.[datum]) ? rankedSourcesByDatum[datum] : await dictionaryBuilderRankDatumSources(entry?.partOfSpeech, datum)
    const available = currentAvailableDatumProviders(datum, results, rankedForDatum)
    const mandatory = datum === "syllabication" ? DICTIONARY_BUILDER_SYLLABLE_PROVIDER : datum === "synonymsAntonyms" ? "merriam_webster_thesaurus" : ""
    const candidateLimit = datum === "syllabication" || datum === "verbFormAudio" ? 2 : datum === "audio" ? 5 : 3
    bicTopThreeByDatum[datum] = [ ...(mandatory && available.includes(mandatory) ? [mandatory] : []), ...available.filter((provider) => provider !== mandatory) ].slice(0, candidateLimit)
  }
  const snapshotId = crypto.randomUUID()
  const createdAt = nowDate().toISOString()
  const snapshot = { id: snapshotId, version: DICTIONARY_BUILDER_VERSION, entryId: text(entry?.id), ownerKey: owner, createdAt, expiresAtMs: Date.now() + TTL_MS, sourceOrder: results.map((result) => result.provider), datumSourceOrder, bicTopThreeByDatum, privateSources: results, sources: results.map(({ sourceUrl, privateMedia, ...result }) => result), citations: buildDictionaryBuilderCitations(entry?.english, createdAt), warnings: missing.map((datum) => `No selected source offered ${datum}; apply remains available.`) }
  snapshot.bytes = Buffer.byteLength(JSON.stringify(snapshot))
  snapshots.set(snapshotId, snapshot)
  cleanCache()
  return publicSnapshot(snapshot)
}

export async function retryDictionaryBuilderSnapshot(snapshotId, entry, { ownerKey, provider, fetcher = adapters } = {}) {
  cleanCache()
  const snapshot = snapshots.get(text(snapshotId))
  if (!snapshot || snapshot.ownerKey !== text(ownerKey) || snapshot.entryId !== text(entry?.id)) return null
  const providerId = text(provider)
  const previous = snapshot.privateSources.find((result) => result.provider === providerId)
  if (!previous) return null
  const adapter = dictionaryBuilderAdapter(fetcher, providerId)
  let refreshed
  try {
    refreshed = await adapter(entry)
  } catch (error) {
    refreshed = { provider: providerId, status: "unavailable", message: text(error.message), fields: {}, entries: [], media: [], datumStatus: {} }
  }
  const refreshedSources = snapshot.privateSources.map((result) => result.provider === providerId ? refreshed : result)
  snapshot.privateSources = refreshedSources
  snapshot.sources = refreshedSources.map(({ sourceUrl, privateMedia, ...result }) => result)
  snapshot.sourceOrder = refreshedSources.map((result) => result.provider)
  snapshot.warnings = DICTIONARY_BUILDER_DATUMS
    .filter((datum) => !refreshedSources.some((result) => result.datumStatus?.[datum]?.status === "available"))
    .map((datum) => `No selected source offered ${datum}; apply remains available.`)
  snapshot.bytes = Buffer.byteLength(JSON.stringify(snapshot))
  snapshots.set(snapshot.id, snapshot)
  cleanCache()
  return publicSnapshot(snapshot)
}

export function readDictionaryBuilderSnapshot(snapshotId, { ownerKey, entryId } = {}) {
  cleanCache()
  const snapshot = snapshots.get(text(snapshotId))
  if (!snapshot || snapshot.ownerKey !== text(ownerKey) || snapshot.entryId !== text(entryId)) return null
  return publicSnapshot(snapshot)
}

export function consumeDictionaryBuilderSnapshot(snapshotId, { ownerKey, entryId } = {}) {
  cleanCache()
  const snapshot = snapshots.get(text(snapshotId))
  if (!snapshot || snapshot.ownerKey !== text(ownerKey) || snapshot.entryId !== text(entryId)) return null
  const publicValue = publicSnapshot(snapshot)
  snapshots.delete(text(snapshotId))
  return publicValue
}

export function takeDictionaryBuilderSnapshot(snapshotId, { ownerKey, entryId } = {}) {
  cleanCache()
  const snapshot = snapshots.get(text(snapshotId))
  if (!snapshot || snapshot.ownerKey !== text(ownerKey) || snapshot.entryId !== text(entryId)) return null
  snapshots.delete(text(snapshotId))
  if (!snapshot) return null
  return snapshot
}

export function restoreDictionaryBuilderSnapshot(snapshot) {
  if (!snapshot?.id || !snapshot.ownerKey || !snapshot.entryId) return false
  snapshot.bytes = Buffer.byteLength(JSON.stringify(snapshot))
  snapshots.set(snapshot.id, snapshot)
  cleanCache()
  return snapshots.has(snapshot.id)
}

export async function recordDictionaryBuilderMetrics(client, snapshot, selectedFields, partOfSpeech) {
  const selected = new Set(selectedFields)
  for (const result of snapshot.sources || []) {
    for (const datum of DICTIONARY_BUILDER_DATUMS) {
      const status = result.datumStatus?.[datum]?.status
      const available = status === "available"
      const provider = result.provider === "merriam_webster" ? "merriam_webster_api" : result.provider
      await client.dictionaryProviderSuitabilityMetric.upsert({
        where: { provider_partOfSpeech_datum: { provider, partOfSpeech: lower(partOfSpeech) || "any", datum } },
        create: { provider, partOfSpeech: lower(partOfSpeech) || "any", datum, attemptCount: 1, availableCount: available ? 1 : 0, eligibleApplyCount: available ? 1 : 0, selectedApplyCount: available && selected.has(datum) ? 1 : 0 },
        update: { attemptCount: { increment: 1 }, availableCount: available ? { increment: 1 } : undefined, eligibleApplyCount: available ? { increment: 1 } : undefined, selectedApplyCount: available && selected.has(datum) ? { increment: 1 } : undefined },
      })
    }
  }
}
