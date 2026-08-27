import crypto from "node:crypto"
import { load } from "cheerio"

import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { previewBritannicaLibraryEntry } from "./britannica-provider.mjs"
import { previewCambridgeLibraryEntry } from "./cambridge-provider.mjs"
import { previewLdoceLibraryEntry } from "./ldoce-provider.mjs"
import { fetchEtymonlinePreview } from "./library-origin.mjs"
import { previewMerriamWebsterLibraryEntry } from "./library-corpus.mjs"
import { previewMerriamWebsterDictionaryEntry } from "./merriam-webster-provider.mjs"
import { previewOxfordLibraryEntry } from "./oxford-provider.mjs"

export const DICTIONARY_BUILDER_VERSION = "1.5"
export const DICTIONARY_BUILDER_DATUM_STATUS = Object.freeze(["available", "not_offered", "blocked", "malformed", "unavailable", "unsupported", "unselected", "manual", "invalid"])
export const DICTIONARY_BUILDER_DATUMS = Object.freeze(["vietnamese", "syllabication", "syllableCount", "grammarClassification", "audio", "definition", "verbForms", "stems", "synonymsAntonyms", "examples", "recentExamples", "firstKnownUse", "originPath", "etymology", "worksCited"])
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

function source(id, label, kind, quality, capabilities, searchUrl) {
  const supported = { ...capabilities }
  if (supported.syllabication && supported.syllableCount === undefined) supported.syllableCount = supported.syllabication
  return Object.freeze({ id, label, kind, quality, capabilities: Object.freeze(supported), searchUrl })
}

export const DICTIONARY_BUILDER_MANIFEST = Object.freeze([
  source("ldoce", "LD", "dictionary", 92, { definition: 96, grammarClassification: 90, examples: 90, audio: 96, verbForms: 75, syllabication: 72, syllableCount: 72 }, (word) => `https://www.ldoceonline.com/dictionary/${encodeURIComponent(word)}`),
  source("oxford_ame", "OA", "dictionary", 91, { definition: 94, grammarClassification: 90, examples: 90, audio: 88, syllabication: 75 }, (word) => `https://www.oxfordlearnersdictionaries.com/definition/american_english/${encodeURIComponent(word.replace(/\s+/gu, "-"))}?q=${encodeURIComponent(word)}`),
  source("oxford_bre", "OB", "dictionary", 90, { definition: 94, grammarClassification: 90, examples: 90, audio: 88, syllabication: 75 }, (word) => `https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(word.replace(/\s+/gu, "-"))}?q=${encodeURIComponent(word)}`),
  source("britannica", "BR", "dictionary", 88, { definition: 94, grammarClassification: 86, examples: 88, recentExamples: 84, stems: 76, etymology: 76, firstKnownUse: 78, synonymsAntonyms: 78, syllabication: 70 }, (word) => `https://www.britannica.com/dictionary/${encodeURIComponent(word)}`),
  source("merriam_webster", "MW", "dictionary", 92, { definition: 96, grammarClassification: 88, examples: 88, verbForms: 86, stems: 82, etymology: 88, firstKnownUse: 88, synonymsAntonyms: 72, syllabication: 86 }, (word) => `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`),
  source("etymonline", "ET", "history", 93, { etymology: 98, originPath: 92, worksCited: 96 }, (word) => `https://www.etymonline.com/search?q=${encodeURIComponent(word)}`),
  source("wiktionary", "WK", "dictionary", 70, { definition: 72, etymology: 76, originPath: 70, synonymsAntonyms: 70, syllabication: 60, firstKnownUse: 60 }, (word) => `https://en.wiktionary.org/w/index.php?search=${encodeURIComponent(word)}`),
  source("cambridge", "CA", "dictionary", 86, { definition: 90, grammarClassification: 84, examples: 84, audio: 85, syllabication: 72 }, (word) => `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word.replace(/\s+/gu, "-"))}`),
  source("merriam_webster_thesaurus", "TH", "thesaurus", 86, { synonymsAntonyms: 96 }, (word) => `https://www.merriam-webster.com/thesaurus/${encodeURIComponent(word)}`),
  source("wordhelp", "WH", "reference", 74, { syllabication: 88, syllableCount: 88, verbForms: 66 }, (word) => `https://www.wordhelp.com/syllables/english/?q=${encodeURIComponent(word)}`),
  source("google_translate", "GT", "translation", 70, { vietnamese: 88 }, (word) => `https://translate.google.com/?sl=en&tl=vi&text=${encodeURIComponent(word)}&op=translate`),
  source("google_definitions", "GL", "reference", 68, { definition: 72 }, (word) => `https://www.google.com/search?q=define%3A${encodeURIComponent(word)}`),
])

const manifestById = new Map(DICTIONARY_BUILDER_MANIFEST.map((item) => [item.id, item]))

export const DICTIONARY_BUILDER_SCORING_POS = Object.freeze(["adjective", "noun", "proper noun", "verb", "adverb", "conjunction", "preposition", "determiner", "pronoun", "interjection", "numeral", "phrase", "idiom", "clause"])
export const DICTIONARY_BUILDER_SCORING_DATUMS = Object.freeze([
  "vietnamese", "syllabication", "syllableCount", "definition", "grammarClassification", "posSpecific", "audio", "examples", "firstKnownUse", "historyOrigin", "worksCited",
])
export const DICTIONARY_BUILDER_SCORING_SOURCES = Object.freeze([
  ["ldoce", "LD", "ldoce"], ["oxford_ame", "OA", "oxford_ame"], ["oxford_bre", "OB", "oxford_bre"], ["britannica", "BR", "britannica"],
  ["merriam_webster_api", "MW API", "merriam_webster"], ["merriam_webster_scrape", "MW scrape", "merriam_webster"], ["etymonline", "ET", "etymonline"],
  ["wiktionary", "WK", "wiktionary"], ["cambridge", "CA", "cambridge"], ["merriam_webster_thesaurus", "TH", "merriam_webster_thesaurus"],
  ["wordhelp", "WH", "wordhelp"], ["google_translate", "GT", "google_translate"], ["google_definitions", "GL", "google_definitions"],
].map(([id, label, provider]) => Object.freeze({ id, label, provider })))

const scoringSourceById = new Map(DICTIONARY_BUILDER_SCORING_SOURCES.map((item) => [item.id, item]))
const scoringDatumCapability = Object.freeze({ syllableCount: "syllabication", posSpecific: "grammarClassification", historyOrigin: "etymology" })
const scoringDatumForMetric = Object.freeze({ syllableCount: "syllabication", posSpecific: "grammarClassification", historyOrigin: "etymology" })

function scoringBaseProvider(provider) {
  return scoringSourceById.get(text(provider))?.provider || text(provider)
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
        const score = supported ? (quality + availability + acceptance + coverage) / 4 : 0
        rows.push({ provider: source.id, label: source.label, partOfSpeech, datum, supported, enabled, qualityOverride: datumSetting?.qualityOverride === null || datumSetting?.qualityOverride === undefined ? null : Number(datumSetting.qualityOverride), quality: Number(quality.toFixed(2)), availability: Number(availability.toFixed(2)), acceptance: Number(acceptance.toFixed(2)), coverage: Number(coverage.toFixed(2)), score: Number(score.toFixed(2)), attempts: metric?.attemptCount || 0, available: metric?.availableCount || 0, successes: metric?.availableCount || 0, selected: metric?.selectedApplyCount || 0 })
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
    ? { status: "unavailable" }
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
  const lines = [`**${headword}**${partOfSpeech ? ` *${partOfSpeech}*` : ""}`]
  if (definition) lines.push(definition)
  const forms = ["verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5"].map((key) => [key, text(fields[key])]).filter(([, value]) => value)
  if (forms.length) lines.push(`**Verb Forms**\n${forms.map(([key, value]) => `${key.replace("verb", "").replace("Infinitive", "INF")}: ${value}`).join("\n")}`)
  if (fields.stems) lines.push(`**Stems**\n${text(fields.stems)}`)
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

export function normalizeProviderPreview(provider, preview, entry) {
  const sourceItem = manifestById.get(provider)
  const offered = sourceItem?.capabilities || {}
  if (!preview?.ok) {
    const status = preview?.available === false ? "unavailable" : "unsupported"
    return { provider, status, message: text(preview?.message) || `${sourceItem?.label || provider} did not offer a matching entry.`, sourceUrl: text(preview?.sourceUrl), fields: {}, datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: offered[datum] ? status : "not_offered" }])), media: [] }
  }
  const fields = { ...(preview.fields || {}) }
  const dictionaryMetadata = fields.dictionaryMetadata && typeof fields.dictionaryMetadata === "object" ? fields.dictionaryMetadata : {}
  const additionalSections = dictionaryMetadata.additionalSections && typeof dictionaryMetadata.additionalSections === "object" ? dictionaryMetadata.additionalSections : {}
  delete fields.dictionaryMetadata
  delete fields.dictionarySourceUrl
  const entries = Array.isArray(preview.entries) ? preview.entries : []
  const primary = entries.find((item) => lower(item?.partOfSpeech) === lower(entry?.partOfSpeech)) || entries[0] || {}
  const inflections = Array.isArray(primary?.inflections) ? primary.inflections.map((item) => text(typeof item === "object" ? item.form : item)).filter(Boolean) : []
  const forms = ["verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5"].reduce((result, key, index) => ({ ...result, [key]: fields[key] || inflections[index] || "" }), {})
  const audio = ["uk", "us"].flatMap((dialect) => primary?.audio?.[dialect] ? [{ dialect, available: true }] : [])
  const privateMedia = ["uk", "us"].flatMap((dialect) => primary?.audio?.[dialect] ? [{ dialect, sourceUrl: primary.audio[dialect] }] : [])
  const examples = entries.flatMap((item) => Array.isArray(item?.senses) ? item.senses.flatMap((sense) => Array.isArray(sense?.examples) ? sense.examples.map((example) => text(typeof example === "object" ? example.text : example)).filter(Boolean) : []) : [])
  const synonyms = firstDatumValue(fields.synonyms, dictionaryMetadata.synonyms, additionalSections.synonyms)
  const antonyms = firstDatumValue(fields.antonyms, dictionaryMetadata.antonyms, additionalSections.antonyms)
  const synonymsAntonyms = firstDatumValue(
    fields.synonymsAntonyms,
    [joinedDatumText(synonyms) ? `Synonyms:\n${joinedDatumText(synonyms)}` : "", joinedDatumText(antonyms) ? `Antonyms:\n${joinedDatumText(antonyms)}` : ""].filter(Boolean).join("\n\n"),
  )
  const normalizedFields = {
    ...fields,
    syllabication: firstDatumValue(fields.syllabication, primary?.hyphenation, primary?.syllabication),
    verbForms: Object.values(forms).some(Boolean) ? forms : "",
    stems: firstDatumValue(joinedDatumText(fields.stems), joinedDatumText(additionalSections.stems)),
    synonymsAntonyms,
    examples: firstDatumValue(joinedDatumText(fields.examples), joinedDatumText(examples)),
    recentExamples: firstDatumValue(joinedDatumText(fields.recentExamples), joinedDatumText(additionalSections.recentExamples)),
    firstKnownUse: firstDatumValue(joinedDatumText(fields.firstKnownUse), joinedDatumText(dictionaryMetadata.firstKnownUse)),
    originPath: firstDatumValue(joinedDatumText(fields.originPath), joinedDatumText(dictionaryMetadata.originPath)),
    etymology: firstDatumValue(joinedDatumText(fields.etymology), joinedDatumText(dictionaryMetadata.etymology)),
  }
  normalizedFields.syllableCount = normalizedFields.syllabication ? normalizedFields.syllabication.split(/[-‐‑‒–—]/u).map((part) => text(part)).filter(Boolean).length : ""
  const values = {
    grammarClassification: normalizedFields.grammarClassification,
    audio,
    definition: normalizedFields.definition,
    verbForms: normalizedFields.verbForms,
    stems: normalizedFields.stems,
    synonymsAntonyms: normalizedFields.synonymsAntonyms,
    examples: normalizedFields.examples,
    recentExamples: normalizedFields.recentExamples,
    syllabication: normalizedFields.syllabication,
    syllableCount: normalizedFields.syllableCount,
    firstKnownUse: normalizedFields.firstKnownUse,
    originPath: normalizedFields.originPath,
    etymology: normalizedFields.etymology,
    worksCited: apaCitation(provider, entry?.english, preview.sourceUrl),
  }
  return { provider, status: "available", message: "", sourceUrl: text(preview.sourceUrl), fields: { ...normalizedFields, audio }, entries: entries.map((item) => ({ headword: text(item.headword), partOfSpeech: text(item.partOfSpeech), senses: Array.isArray(item.senses) ? item.senses.map((sense) => ({ number: text(sense.number), definition: text(sense.definition), examples: (sense.examples || []).map((example) => text(typeof example === "object" ? example.text : example)).filter(Boolean) })) : [] })), datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, datumStatus(values[datum], offered[datum])])), media: audio, privateMedia }
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
    const response = await fetchImpl(requestUrl, { headers: { accept: "text/html", "user-agent": "SIS Dictionary Builder/1.5" }, redirect: "follow", signal: controller.signal })
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

async function previewHtmlAdapter(provider, entry) {
  const item = manifestById.get(provider)
  const word = text(entry?.english)
  if (!word) return { provider, status: "unavailable", message: "An English word is required.", sourceUrl: item.searchUrl(""), fields: {}, entries: [], media: [], datumStatus: {} }
  const sourceUrl = item.searchUrl(word)
  try {
    const response = await fetch(sourceUrl, { headers: { Accept: "text/html", "User-Agent": "SIS-admin-Dictionary-Builder/1.0" }, redirect: "follow" })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const html = await response.text()
    const $ = load(html)
    const body = text($("main, article, #content, body").first().text())
    if (!body) throw new Error("No usable source content")
    const syllabication = provider === "wordhelp" ? text($(".syllables, .syllable, [class*=syllab], main").first().text()).match(/[A-Za-z]+(?:[-‧·][A-Za-z]+)+/u)?.[0] || "" : ""
    const definition = provider === "merriam_webster_thesaurus" ? body : text($(".definition, .def, .dtText, .sense, main").first().text()) || body
    const fields = {}
    if (["wiktionary", "google_definitions", "merriam_webster_thesaurus"].includes(provider)) fields.definition = definition
    if (provider === "wordhelp") { fields.syllabication = syllabication; fields.syllableCount = syllabication ? syllabication.split(/[-‧·]/u).length : 0 }
    const datumStatus = Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: fields[datum] ? "available" : item.capabilities[datum] ? "unavailable" : "not_offered" }]))
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
  oxford_bre: (entry) => previewHtmlAdapter("oxford_bre", entry),
  britannica: async (entry) => normalizeProviderPreview("britannica", await previewBritannicaLibraryEntry(entry), entry),
  merriam_webster_api: async (entry) => ({ ...normalizeProviderPreview("merriam_webster", await previewMerriamWebsterLibraryEntry(entry), entry), provider: "merriam_webster_api" }),
  merriam_webster_scrape: async (entry) => ({ ...normalizeProviderPreview("merriam_webster", await previewMerriamWebsterDictionaryEntry(entry), entry), provider: "merriam_webster_scrape" }),
  etymonline: previewEtymonlineAdapter,
  wiktionary: (entry) => previewHtmlAdapter("wiktionary", entry),
  cambridge: async (entry) => normalizeProviderPreview("cambridge", await previewCambridgeLibraryEntry(entry), entry),
  merriam_webster_thesaurus: (entry) => previewHtmlAdapter("merriam_webster_thesaurus", entry),
  wordhelp: (entry) => previewHtmlAdapter("wordhelp", entry),
  google_translate: previewGoogleTranslateAdapter,
  google_definitions: (entry) => previewHtmlAdapter("google_definitions", entry),
})

async function metricScore(client, provider, partOfSpeech, datum) {
  const item = manifestById.get(provider)
  const completeness = Number(item?.capabilities?.[datum] || 0)
  const quality = item?.capabilities?.[datum] ? Number(item.quality || 0) : 0
  const metric = await client.dictionaryProviderSuitabilityMetric.findUnique({ where: { provider_partOfSpeech_datum: { provider, partOfSpeech: lower(partOfSpeech) || "any", datum } } }).catch(() => null)
  const observed = metric?.attemptCount ? Math.round((metric.availableCount / metric.attemptCount) * 100) : 50
  const selected = metric?.eligibleApplyCount ? Math.round((metric.selectedApplyCount / metric.eligibleApplyCount) * 100) : 50
  return { provider, datum, score: Math.round((completeness + quality + observed + selected) / 4), components: { completeness, quality, observed, selected } }
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
    .map((row) => ({ provider: row.provider, score: Math.round(row.score * 100), components: { quality: row.quality, availability: row.availability, acceptance: row.acceptance, coverage: row.coverage } }))
    .sort((left, right) => right.score - left.score || left.provider.localeCompare(right.provider))
}

export function dictionaryBuilderBicDatumProviderIds(datum, rankedSources = []) {
  const eligible = rankedSources
    .filter((item) => Number(item?.score) > 0)
    .map((item) => text(item?.provider))
    .filter((provider, index, providers) => index === providers.indexOf(provider) && manifestById.get(scoringBaseProvider(provider))?.capabilities?.[datum])
  if (datum === "firstKnownUse") return eligible.filter((provider) => ["merriam_webster", "merriam_webster_api", "merriam_webster_scrape", "wiktionary"].includes(provider)).slice(0, 3)
  if (datum !== "syllabication") return eligible.slice(0, 3)
  const independent = eligible.filter((provider) => provider !== DICTIONARY_BUILDER_SYLLABLE_PROVIDER)
  return [DICTIONARY_BUILDER_SYLLABLE_PROVIDER, ...independent].filter((provider, index, providers) => manifestById.has(scoringBaseProvider(provider)) && index < 3 && providers.indexOf(provider) === index)
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
  const offered = rankedSources.filter((item) => Number(item?.score) > 0 && manifestById.get(scoringBaseProvider(text(item?.provider)))?.capabilities?.[datum])
  if (!offered.length) return []
  const highestScore = Number(offered[0].score || 0)
  const scoreBand = offered.filter((item) => Number(item.score || 0) >= highestScore - 5)
  const remaining = offered.filter((item) => !scoreBand.includes(item))
  const start = ((Number(rotation) % scoreBand.length) + scoreBand.length) % scoreBand.length
  return [...scoreBand.slice(start), ...scoreBand.slice(0, start), ...remaining].map((item) => text(item.provider))
}

function nextDatumRoundRobinOffset(partOfSpeech, datum) {
  const key = `${lower(partOfSpeech) || "any"}\u0000${text(datum)}`
  const offset = datumRoundRobinCursors.get(key) || 0
  datumRoundRobinCursors.set(key, offset + 1)
  return offset
}

function initialDictionaryProperProviders(ranked) {
  const bands = new Map()
  ranked.filter((item) => Number(item?.score) > 0 && item.provider !== "merriam_webster").forEach((item) => { const key = Math.floor(item.score / 5) * 5; bands.set(key, [...(bands.get(key) || []), item]) })
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
  const bicTopThreeByDatum = await dictionaryBuilderBicTopThreeByDatum(entry?.partOfSpeech, rankedSourcesByDatum)
  const selected = [...initialDictionaryProperProviders(ranked), "merriam_webster_api", "google_translate", DICTIONARY_BUILDER_SYLLABLE_PROVIDER]
  const results = await Promise.all(selected.map(async (provider) => {
    const adapter = fetcher[provider] || fetcher[scoringBaseProvider(provider)]
    try { return await adapter(entry) } catch (error) { return { provider, status: "unavailable", message: text(error.message), fields: {}, entries: [], media: [], datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: "unavailable" }])) } }
  }))
  const missing = DICTIONARY_BUILDER_DATUMS.filter((datum) => !results.some((result) => result.datumStatus?.[datum]?.status === "available"))
  const datumSourceOrder = {}
  for (const datum of missing) {
    const rankedForDatum = Array.isArray(rankedSourcesByDatum?.[datum]) ? rankedSourcesByDatum[datum] : await dictionaryBuilderRankDatumSources(entry?.partOfSpeech, datum)
    const rotatedOrder = dictionaryBuilderRoundRobinDatumSourceOrder(datum, rankedForDatum, datumRoundRobinOffsets?.[datum] || nextDatumRoundRobinOffset(entry?.partOfSpeech, datum))
    const sourceOrder = datum === "syllabication"
      ? [DICTIONARY_BUILDER_SYLLABLE_PROVIDER, ...rotatedOrder.filter((provider) => provider !== DICTIONARY_BUILDER_SYLLABLE_PROVIDER)].slice(0, 3)
      : (rotatedOrder.length ? rotatedOrder.slice(0, 3) : (bicTopThreeByDatum[datum] || []))
    datumSourceOrder[datum] = sourceOrder
    for (const provider of sourceOrder) {
      if (results.some((result) => result.provider === provider)) continue
      const adapter = fetcher[provider] || fetcher[scoringBaseProvider(provider)]
      try { results.push(await adapter(entry)) } catch (error) { results.push({ provider, status: "unavailable", message: text(error.message), fields: {}, entries: [], media: [], datumStatus: { [datum]: { status: "unavailable" } } }) }
      if (results.at(-1)?.datumStatus?.[datum]?.status === "available") break
    }
  }
  const snapshotId = crypto.randomUUID()
  const createdAt = nowDate().toISOString()
  const snapshot = { id: snapshotId, version: DICTIONARY_BUILDER_VERSION, entryId: text(entry?.id), ownerKey: owner, createdAt, expiresAtMs: Date.now() + TTL_MS, sourceOrder: results.map((result) => result.provider), datumSourceOrder, bicTopThreeByDatum, privateSources: results, sources: results.map(({ sourceUrl, privateMedia, ...result }) => result), citations: buildDictionaryBuilderCitations(entry?.english, createdAt), warnings: missing.map((datum) => `No selected source offered ${datum}; apply remains available.`) }
  snapshot.bytes = Buffer.byteLength(JSON.stringify(snapshot))
  snapshots.set(snapshotId, snapshot)
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
