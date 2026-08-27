import crypto from "node:crypto"

import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { previewBritannicaLibraryEntry } from "./britannica-provider.mjs"
import { previewLdoceLibraryEntry } from "./ldoce-provider.mjs"
import { fetchEtymonlinePreview } from "./library-origin.mjs"
import { previewMerriamWebsterDictionaryEntryWithApiFallback } from "./library-corpus.mjs"
import { previewOxfordLibraryEntry } from "./oxford-provider.mjs"

export const DICTIONARY_BUILDER_VERSION = "1.5"
export const DICTIONARY_BUILDER_DATUM_STATUS = Object.freeze(["available", "not_offered", "blocked", "malformed", "unavailable", "unsupported", "unselected", "manual", "invalid"])
export const DICTIONARY_BUILDER_DATUMS = Object.freeze(["vietnamese", "syllabication", "grammarClassification", "audio", "definition", "verbForms", "stems", "synonymsAntonyms", "examples", "recentExamples", "firstKnownUse", "originPath", "etymology", "worksCited"])
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
  return Object.freeze({ id, label, kind, quality, capabilities: Object.freeze(capabilities), searchUrl })
}

export const DICTIONARY_BUILDER_MANIFEST = Object.freeze([
  source("ldoce", "LD", "dictionary", 92, { definition: 96, grammarClassification: 90, examples: 90, audio: 96, verbForms: 75, syllabication: 72 }, (word) => `https://www.ldoceonline.com/dictionary/${encodeURIComponent(word)}`),
  source("oxford_ame", "OA", "dictionary", 91, { definition: 94, grammarClassification: 90, examples: 90, audio: 88, syllabication: 75 }, (word) => `https://www.oxfordlearnersdictionaries.com/definition/american_english/${encodeURIComponent(word.replace(/\s+/gu, "-"))}?q=${encodeURIComponent(word)}`),
  source("oxford_bre", "OB", "dictionary", 90, { definition: 94, grammarClassification: 90, examples: 90, audio: 88, syllabication: 75 }, (word) => `https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(word.replace(/\s+/gu, "-"))}?q=${encodeURIComponent(word)}`),
  source("britannica", "BR", "dictionary", 88, { definition: 94, grammarClassification: 86, examples: 88, recentExamples: 84, stems: 76, etymology: 76, firstKnownUse: 78, synonymsAntonyms: 78, syllabication: 70 }, (word) => `https://www.britannica.com/dictionary/${encodeURIComponent(word)}`),
  source("merriam_webster", "MW", "dictionary", 92, { definition: 96, grammarClassification: 88, examples: 88, verbForms: 86, stems: 82, etymology: 88, firstKnownUse: 88, synonymsAntonyms: 72, syllabication: 86 }, (word) => `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`),
  source("etymonline", "ET", "history", 93, { etymology: 98, originPath: 92, worksCited: 96 }, (word) => `https://www.etymonline.com/search?q=${encodeURIComponent(word)}`),
  source("wiktionary", "WK", "dictionary", 70, { definition: 72, etymology: 76, originPath: 70, synonymsAntonyms: 70, syllabication: 60 }, (word) => `https://en.wiktionary.org/w/index.php?search=${encodeURIComponent(word)}`),
  source("cambridge", "CA", "dictionary", 86, { definition: 90, grammarClassification: 84, examples: 84, audio: 85, syllabication: 72 }, (word) => `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word.replace(/\s+/gu, "-"))}`),
  source("merriam_webster_thesaurus", "TH", "thesaurus", 86, { synonymsAntonyms: 96 }, (word) => `https://www.merriam-webster.com/thesaurus/${encodeURIComponent(word)}`),
  source("wordhelp", "WH", "reference", 74, { syllabication: 88, verbForms: 66 }, (word) => `https://www.wordhelp.com/syllables/english/?q=${encodeURIComponent(word)}`),
  source("google_translate", "GT", "translation", 70, { vietnamese: 88 }, (word) => `https://translate.google.com/?sl=en&tl=vi&text=${encodeURIComponent(word)}&op=translate`),
  source("google_definitions", "GL", "reference", 68, { definition: 72 }, (word) => `https://www.google.com/search?q=define%3A${encodeURIComponent(word)}`),
])

const manifestById = new Map(DICTIONARY_BUILDER_MANIFEST.map((item) => [item.id, item]))

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
    datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: datum === "syllabication" ? syllabicationStatus : "not_offered" }])),
  }
}

const adapters = Object.freeze({
  ldoce: async (entry) => normalizeProviderPreview("ldoce", await previewLdoceLibraryEntry(entry), entry),
  oxford_ame: async (entry) => normalizeProviderPreview("oxford_ame", await previewOxfordLibraryEntry(entry), entry),
  oxford_bre: (entry) => previewPassiveAdapter("oxford_bre", entry),
  britannica: async (entry) => normalizeProviderPreview("britannica", await previewBritannicaLibraryEntry(entry), entry),
  merriam_webster: async (entry) => normalizeProviderPreview("merriam_webster", await previewMerriamWebsterDictionaryEntryWithApiFallback(entry), entry),
  etymonline: previewEtymonlineAdapter,
  wiktionary: (entry) => previewPassiveAdapter("wiktionary", entry),
  cambridge: (entry) => previewPassiveAdapter("cambridge", entry),
  merriam_webster_thesaurus: (entry) => previewPassiveAdapter("merriam_webster_thesaurus", entry),
  wordhelp: previewWordHelpAdapter,
  google_translate: previewGoogleTranslateAdapter,
  google_definitions: (entry) => previewPassiveAdapter("google_definitions", entry),
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
  const client = await getSharedPrismaClient()
  const rows = await Promise.all(DICTIONARY_BUILDER_MANIFEST
    .filter((item) => item.capabilities[datum])
    .map((item) => metricScore(client, item.id, partOfSpeech, datum)))
  return rows.sort((left, right) => right.score - left.score || left.provider.localeCompare(right.provider))
}

export function dictionaryBuilderBicDatumProviderIds(datum, rankedSources = []) {
  const eligible = rankedSources
    .map((item) => text(item?.provider))
    .filter((provider, index, providers) => index === providers.indexOf(provider) && manifestById.get(provider)?.capabilities?.[datum])
  if (datum !== "syllabication") return eligible.slice(0, 3)
  const independent = eligible.filter((provider) => provider !== DICTIONARY_BUILDER_SYLLABLE_PROVIDER)
  return [DICTIONARY_BUILDER_SYLLABLE_PROVIDER, ...independent].filter((provider, index, providers) => manifestById.has(provider) && index < 3 && providers.indexOf(provider) === index)
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
  const offered = rankedSources.filter((item) => manifestById.get(text(item?.provider))?.capabilities?.[datum])
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
  ranked.filter((item) => item.provider !== "merriam_webster").forEach((item) => { const key = Math.floor(item.score / 5) * 5; bands.set(key, [...(bands.get(key) || []), item]) })
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
  const ranked = Array.isArray(rankedSources) ? rankedSources : await dictionaryBuilderRankSources(entry?.partOfSpeech, "definition")
  const bicTopThreeByDatum = await dictionaryBuilderBicTopThreeByDatum(entry?.partOfSpeech, rankedSourcesByDatum)
  const selected = [...initialDictionaryProperProviders(ranked), "merriam_webster", "google_translate", DICTIONARY_BUILDER_SYLLABLE_PROVIDER]
  const results = await Promise.all(selected.map(async (provider) => {
    try { return await fetcher[provider](entry) } catch (error) { return { provider, status: "unavailable", message: text(error.message), fields: {}, entries: [], media: [], datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: "unavailable" }])) } }
  }))
  const missing = DICTIONARY_BUILDER_DATUMS.filter((datum) => !results.some((result) => result.datumStatus?.[datum]?.status === "available"))
  const datumSourceOrder = {}
  for (const datum of missing) {
    const sourceOrder = bicTopThreeByDatum[datum] || []
    datumSourceOrder[datum] = sourceOrder
    for (const provider of sourceOrder) {
      if (results.some((result) => result.provider === provider)) continue
      try { results.push(await fetcher[provider](entry)) } catch (error) { results.push({ provider, status: "unavailable", message: text(error.message), fields: {}, entries: [], media: [], datumStatus: { [datum]: { status: "unavailable" } } }) }
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
      await client.dictionaryProviderSuitabilityMetric.upsert({
        where: { provider_partOfSpeech_datum: { provider: result.provider, partOfSpeech: lower(partOfSpeech) || "any", datum } },
        create: { provider: result.provider, partOfSpeech: lower(partOfSpeech) || "any", datum, attemptCount: 1, availableCount: available ? 1 : 0, eligibleApplyCount: available ? 1 : 0, selectedApplyCount: available && selected.has(datum) ? 1 : 0 },
        update: { attemptCount: { increment: 1 }, availableCount: available ? { increment: 1 } : undefined, eligibleApplyCount: available ? { increment: 1 } : undefined, selectedApplyCount: available && selected.has(datum) ? { increment: 1 } : undefined },
      })
    }
  }
}
