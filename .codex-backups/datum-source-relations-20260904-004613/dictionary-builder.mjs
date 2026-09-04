import crypto from "node:crypto"
import { existsSync } from "node:fs"
import { load } from "cheerio"

import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { previewBritannicaLibraryEntry } from "./britannica-provider.mjs"
import { previewCambridgeLibraryEntry } from "./cambridge-provider.mjs"
import { previewLdoceLibraryEntry } from "./ldoce-provider.mjs"
import { fetchEtymonlinePreview } from "./library-origin.mjs"
import { previewMerriamWebsterLibraryEntry } from "./library-corpus.mjs"
import { fetchMerriamWebsterBrowserPage, previewMerriamWebsterDictionaryEntry } from "./merriam-webster-provider.mjs"
import { previewOxfordBreLibraryEntry, previewOxfordLibraryEntry } from "./oxford-provider.mjs"
import { fetchWithExponentialBackoff } from "./provider-http.mjs"

export const DICTIONARY_BUILDER_VERSION = "1.5"
export const DICTIONARY_BUILDER_DATUM_STATUS = Object.freeze(["available", "not_offered", "not_found", "not_provided", "robot_blocked", "cookie_prompt", "robot_prompt", "paused", "waiting_for_input", "blocked", "malformed", "unavailable", "unsupported", "unselected", "manual", "invalid"])
export const DICTIONARY_BUILDER_DATUMS = Object.freeze(["vietnamese", "syllabication", "syllableCount", "grammarClassification", "audio", "verbFormAudio", "definition", "verbForms", "stems", "synonymsAntonyms", "examples", "firstKnownUse", "originPath", "etymology", "worksCited"])
export const DICTIONARY_BUILDER_SYLLABLE_PROVIDER = "wordhelp"

const TTL_MS = 30 * 60 * 1000
const MAX_SNAPSHOTS = 20
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024
const GOOGLE_TRANSLATE_TIMEOUT_MS = 8000
const DICTIONARY_BUILDER_PROVIDER_TIMEOUT_MS = 12000
const DICTIONARY_BUILDER_PREVIEW_TIMEOUT_MS = 45000
const snapshots = new Map()
const datumRoundRobinCursors = new Map()
const text = (value) => String(value == null ? "" : value).replace(/\s+/gu, " ").trim()
const lower = (value) => text(value).toLocaleLowerCase("en-US")
function audioFileName(sourceUrl) {
  try {
    const pathname = new URL(sourceUrl).pathname
    const fileName = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1))
    return /^[\w.-]+\.(?:mp3|ogg|wav)$/iu.test(fileName) ? fileName : ""
  } catch { return "" }
}
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
  source("merriam_webster", "MW", "dictionary", 92, { definition: 96, grammarClassification: 88, examples: 88, verbForms: 86, stems: 82, etymology: 88, originPath: 88, firstKnownUse: 88, synonymsAntonyms: 72, syllabication: 86, audio: 86 }, (word) => `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`),
  source("merriam_webster_api", "AP", "dictionary", 92, { definition: 96, grammarClassification: 88, verbForms: 86, stems: 82, etymology: 88, originPath: 88, firstKnownUse: 88, synonymsAntonyms: 72, syllabication: 86 }, (word) => `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`),
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
const DICTIONARY_BUILDER_AUDIO_DEFAULT_PROVIDER = "britannica"
const DICTIONARY_BUILDER_VERB_FORM_AUDIO_DEFAULT_PROVIDER = "oxford_ame"
export const DICTIONARY_BUILDER_MANDATORY_DATUM_PROVIDERS = Object.freeze({
  vietnamese: Object.freeze(["google_translate"]),
  syllabication: Object.freeze(["wordhelp", "ldoce"]),
  syllableCount: Object.freeze(["wordhelp"]),
  audio: Object.freeze(["britannica"]),
  verbFormAudio: Object.freeze(["oxford_ame"]),
  verbForms: Object.freeze(["merriam_webster_api"]),
  synonymsAntonyms: Object.freeze(["merriam_webster_thesaurus"]),
  firstKnownUse: Object.freeze(["merriam_webster_api"]),
})

export const DICTIONARY_BUILDER_PREFERRED_DATUM_PROVIDERS = Object.freeze({
  vietnamese: Object.freeze(["google_translate"]),
  syllabication: Object.freeze(["wordhelp", "ldoce"]),
  syllableCount: Object.freeze(["wordhelp"]),
  grammarClassification: Object.freeze(["merriam_webster_api", "merriam_webster_scrape"]),
  audio: Object.freeze(["britannica", "ldoce", "oxford_ame"]),
  verbFormAudio: Object.freeze(["oxford_ame", "oxford_bre"]),
  definition: Object.freeze(["britannica", "ldoce", "oxford_ame"]),
  verbForms: Object.freeze(["merriam_webster_api", "oxford_ame"]),
  stems: Object.freeze(["merriam_webster_api", "merriam_webster_scrape"]),
  synonymsAntonyms: Object.freeze(["merriam_webster_thesaurus", "merriam_webster_scrape"]),
  examples: Object.freeze(["britannica", "ldoce", "oxford_ame"]),
  firstKnownUse: Object.freeze(["merriam_webster_api", "merriam_webster_scrape"]),
  originPath: Object.freeze(["merriam_webster_api", "merriam_webster_scrape"]),
  etymology: Object.freeze(["etymonline", "merriam_webster_api", "wiktionary"]),
})

export const DICTIONARY_BUILDER_INITIAL_SERVER_PROVIDERS = Object.freeze(["ldoce", "oxford_ame", "merriam_webster_thesaurus", "britannica", "merriam_webster_scrape", "merriam_webster_api", "wordhelp"])

function scoringBaseProvider(provider) {
  return scoringSourceById.get(text(provider))?.provider || text(provider)
}

function canonicalDictionaryProviderId(provider) {
  return text(provider) === "merriam_webster" ? "merriam_webster_scrape" : text(provider)
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
  const metricByKey = new Map(metrics.map((item) => [settingKey(canonicalDictionaryProviderId(item.provider), item.partOfSpeech, item.datum), item]))
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

const DICTIONARY_BUILDER_CITATION_NAMES = Object.freeze({
  ldoce: "Longman Dictionary of Contemporary English",
  oxford_ame: "Oxford Learner's Dictionaries — American English",
  oxford_bre: "Oxford Learner's Dictionaries — English/British",
  britannica: "Britannica Dictionary",
  merriam_webster: "Merriam-Webster.com Dictionary",
  merriam_webster_scrape: "Merriam-Webster.com Dictionary",
  merriam_webster_api: "Merriam-Webster Collegiate Dictionary API",
  etymonline: "Online Etymology Dictionary",
  wiktionary: "Wiktionary — English entry",
  cambridge: "Cambridge Dictionary",
  merriam_webster_thesaurus: "Merriam-Webster Thesaurus",
  wordhelp: "WordHelp",
  google_translate: "Google Translate",
})

function apaCitation(provider, word, url = "", retrievedAt = nowDate()) {
  const name = DICTIONARY_BUILDER_CITATION_NAMES[provider] || provider
  const date = new Date(retrievedAt).toISOString().slice(0, 10)
  return `${name}. (n.d.). *${text(word)}*. Retrieved ${date}, from ${url || `{${provider}_url}`}`
}

export function buildDictionaryBuilderCitations(word, retrievedAt = nowDate()) {
  const recordKeys = ["definition_primary", "definition_related_pos_1", "definition_related_pos_2", "audio_uk", "audio_us", "verb_forms", "stems", "lexical_relations", "sentence_examples", "recent_examples", "first_known_use", "etymology_origin"]
  return recordKeys.map((key) => ({ key, provider: null, datum: key, populated: false, citation: "" }))
}

const DICTIONARY_BUILDER_CITATION_KEY_BY_DATUM = Object.freeze({
  definition: "definition_primary",
  verbForms: "verb_forms",
  verbFormAudio: "verb_forms",
  stems: "stems",
  synonymsAntonyms: "lexical_relations",
  examples: "sentence_examples",
  firstKnownUse: "first_known_use",
  originPath: "etymology_origin",
  etymology: "etymology_origin",
  worksCited: "etymology_origin",
})

export function buildSelectedDictionaryBuilderCitations(word, retrievedAt, claims = [], sources = []) {
  const sourceByProvider = new Map(sources.map((item) => [canonicalDictionaryProviderId(item?.provider), item]))
  const records = buildDictionaryBuilderCitations(word, retrievedAt)
  const populated = new Map()
  for (const claim of claims) {
    const key = DICTIONARY_BUILDER_CITATION_KEY_BY_DATUM[claim?.field]
    if (!key || populated.has(key)) continue
    const provider = canonicalDictionaryProviderId(claim.provider)
    const source = sourceByProvider.get(provider)
    if (!source?.sourceUrl || claim.status === "manual") continue
    populated.set(key, { key, provider, datum: claim.field, populated: true, citation: apaCitation(provider, word, source.sourceUrl, retrievedAt) })
  }
  return records.map((record) => populated.get(record.key) || record)
}

function localAudioMarkup(asset) {
  const id = text(asset?.id)
  const dialect = text(asset?.dialect).toLocaleLowerCase("en-US")
  const slot = text(asset?.slot || "headword")
  if (!id || !["us", "uk"].includes(dialect) || !/^[a-z0-9_-]+$/iu.test(id)) return ""
  const mediaUrl = `/api/admin/library/media/${encodeURIComponent(id)}`
  const iconPath = "/web-asset/icons/svg/speaker-red-usa.svg"
  const label = `${slot} ${dialect.toUpperCase()}`
  const key = `${slot}:${dialect}`
  return `<a class="library-audio-play" data-library-audio-trigger="${dialect}" data-library-audio-key="${key}" href="${mediaUrl}" aria-label="Play ${label} pronunciation" title="Play ${label} pronunciation"><img src="${iconPath}" alt="${label} speaker"></a><audio preload="none" hidden data-library-preview-audio="${key}" data-local-library-media="true" src="${mediaUrl}"></audio>`
}

function stripLocalAudioMarkup(value) {
  return String(value == null ? "" : value)
    .replace(/<a class="library-audio-play" data-library-audio-trigger="(?:us|uk)" data-library-audio-key="[a-z0-9_-]+:(?:us|uk)" href="\/api\/admin\/library\/media\/[a-z0-9_%.-]+" aria-label="Play [^"]+ pronunciation" title="Play [^"]+ pronunciation"><img src="\/web-asset\/icons\/svg\/speaker-(?:red-usa|blue-uk)\.svg" alt="[^"]+ speaker"><\/a><audio preload="none" hidden data-library-preview-audio="[a-z0-9_-]+:(?:us|uk)" data-local-library-media="true" src="\/api\/admin\/library\/media\/[a-z0-9_%.-]+"><\/audio>/giu, "")
    .replace(/[ \t]+$/gmu, "")
}

export function formatDictionaryBuilderDefinition(entry, fields = {}, citations = [], audioAssets = []) {
  const headword = text(entry?.english)
  const partOfSpeech = text(entry?.partOfSpeech)
  const multiline = (value) => String(value == null ? "" : value).replace(/\r\n?/gu, "\n").trim()
  const uniqueBlocks = (value) => {
    const seen = new Set()
    return multiline(value).split(/\n{2,}/u).map((block) => block.trim()).filter((block) => {
      const normalized = block.replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US")
      if (!normalized || normalized === "<hr>") return normalized !== "<hr>"
      if (seen.has(normalized)) return false
      seen.add(normalized)
      return true
    }).join("\n\n")
  }
  const definitionSections = (value) => {
    const sections = { body: [], firstKnownUse: [], etymology: [], originPath: [], verbForms: [], stems: [], synonymsAntonyms: [], examples: [], worksCited: [] }
    const headings = new Map([["first known use", "firstKnownUse"], ["etymology", "etymology"], ["origin path", "originPath"], ["verb forms", "verbForms"], ["stems", "stems"], ["synonyms", "synonymsAntonyms"], ["antonyms", "synonymsAntonyms"], ["works cited", "worksCited"], ["examples", "examples"]])
    let section = "body"
    stripLocalAudioMarkup(value).replace(/\r\n?/gu, "\n").split("\n").forEach((line) => {
      const match = line.match(/^\*\*(First known use|Etymology|Origin path|Verb Forms|Stems|Synonyms|Antonyms|Works Cited):?\*\*:?\s*(.*)$/iu)
      if (match) {
        section = headings.get(match[1].toLocaleLowerCase("en-US")) || "body"
        if (match[2]) sections[section].push(match[2])
        return
      }
      const examplesHeading = line.match(/^\*{1,2}Examples of ([^*\n]+)\*{2}\*?\s*(?:\([^\n]*\))?\s*$/iu)
      if (examplesHeading) {
        section = "examples"
        return
      }
      if (line.trim() === "<hr>") return
      const tableHeading = line.match(/^\|\s*\*\*Synonyms\*\*\s*\|\s*\*\*Antonyms\*\*\s*\|\s*$/iu)
      if (tableHeading) section = "synonymsAntonyms"
      sections[section].push(line)
    })
    return Object.fromEntries(Object.entries(sections).map(([key, lines]) => [key, lines.join("\n").trim()]))
  }
  const parsed = definitionSections(fields.definition)
  const definitionLines = multiline(parsed.body).split("\n")
  const generatedHeader = `**${headword}**${partOfSpeech ? ` *${partOfSpeech}*` : ""}`.toLocaleLowerCase("en-US")
  const bodyHeaderIndex = definitionLines.findIndex((line) => line.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US") === generatedHeader)
  if (bodyHeaderIndex >= 0) definitionLines.splice(bodyHeaderIndex, 1)
  const definition = multiline(definitionLines.join("\n"))
  const listLines = (value) => String(value == null ? "" : value).split(/\r?\n/u).map((line) => text(line).replace(/^[-*]\s*/u, "")).filter(Boolean).map((line) => `  - ${line}`).join("\n")
  const relationRows = (value) => {
    const sections = { synonyms: [], antonyms: [] }
    let section = ""
    let tableMode = false
    for (const line of String(value == null ? "" : value).split(/\r?\n/u)) {
      const tableCells = line.trim().startsWith("|") && line.trim().endsWith("|") ? line.trim().slice(1, -1).split(/(?<!\\)\|/u).map((cell) => cell.replace(/\\\|/gu, "|").replace(/[*]/gu, "").trim()) : null
      if (tableCells) {
        if (tableCells.length >= 2 && /^synonyms$/iu.test(tableCells[0]) && /^antonyms$/iu.test(tableCells[1])) tableMode = true
        else if (tableMode && tableCells.length >= 2 && !/^:?-{3,}:?$/u.test(tableCells[0])) {
          if (tableCells[0]) sections.synonyms.push(tableCells[0])
          if (tableCells[1]) sections.antonyms.push(tableCells[1])
        }
        continue
      }
      const normalized = text(line).replace(/[:*]/gu, "").toLocaleLowerCase("en-US")
      if (normalized === "synonyms" || normalized === "antonyms") { section = normalized; continue }
      if (section && text(line)) sections[section].push(text(line).replace(/^[-*]\s*/u, ""))
    }
    return sections
  }
  const audioBySlot = new Map((Array.isArray(audioAssets) ? audioAssets : []).filter((asset) => text(asset?.dialect).toLocaleLowerCase("en-US") === "us").map((asset) => [`${text(asset?.slot || "headword")}\u0000us`, asset]))
  const controlsFor = (slot) => [...audioBySlot.entries()]
    .filter(([key]) => key.startsWith(`${slot}\u0000`))
    .map(([, asset]) => localAudioMarkup({ ...asset, slot }))
    .filter(Boolean)
    .join(" ")
  const headwordAudio = controlsFor("headword")
  const lines = []
  if (headwordAudio) lines.push(headwordAudio)
  lines.push(`**${headword}**${partOfSpeech ? ` *${partOfSpeech}*` : ""}`)
  if (definition) lines.push(definition)
  const parsedFormValues = Object.fromEntries(multiline(parsed.verbForms).split("\n").map((line) => {
    const match = line.match(/^(INF|V1|V2|V3|V4|V5):\s*(.+)$/iu)
    if (!match) return []
    return [match[1].toLocaleUpperCase("en-US") === "INF" ? "verbInfinitive" : `verb${match[1].toUpperCase()}`, match[2].trim()]
  }).filter((entry) => entry.length === 2))
  const providedFormValues = fields.verbForms && typeof fields.verbForms === "object" && !Array.isArray(fields.verbForms) ? fields.verbForms : fields
  const formValues = Object.fromEntries(["verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5"].map((key) => [key, text(providedFormValues[key]) || parsedFormValues[key] || ""]))
  const forms = ["verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5"].map((key) => [key, text(formValues[key])]).filter(([, value]) => value)
  if (forms.length) lines.push(`**Verb Forms**\n${forms.map(([key, value]) => {
    const slot = key === "verbInfinitive" ? "verbInfinitive" : key
    const control = controlsFor(slot)
    return `${key.replace("verb", "").replace("Infinitive", "INF")}: ${value}${control ? ` ${control}` : ""}`
  }).join("\n")}`)
  const stems = multiline(fields.stems) || multiline(parsed.stems)
  if (stems) lines.push(`**Stems**\n${listLines(stems)}`)
  const relations = relationRows(multiline(fields.synonymsAntonyms) || multiline(parsed.synonymsAntonyms))
  if (relations.synonyms.length || relations.antonyms.length) {
    const rowCount = Math.max(relations.synonyms.length, relations.antonyms.length)
    const rows = Array.from({ length: rowCount }, (_, index) => `| ${relations.synonyms[index] || ""} | ${relations.antonyms[index] || ""} |`).join("\n")
    lines.push(`| **Synonyms** | **Antonyms** |\n|--------------|--------------|\n${rows}`)
  }
  const examples = multiline(fields.examples) || multiline(parsed.examples)
  if (examples) lines.push(`**Examples of ${headword} in a Sentence** (<= 10 max)\n${listLines(examples)}`)
  const firstKnownUse = multiline(fields.firstKnownUse) || multiline(parsed.firstKnownUse)
  const originPath = multiline(fields.originPath) || multiline(parsed.originPath) || "YTBD"
  const etymology = uniqueBlocks(fields.etymology) || uniqueBlocks(parsed.etymology)
  const worksCited = multiline(fields.worksCited) || multiline(parsed.worksCited)
  const hasHistoricalSections = Boolean(firstKnownUse || originPath || etymology)
  if (hasHistoricalSections) lines.push("<hr>")
  if (firstKnownUse) lines.push(`**First known use**\n${firstKnownUse}`)
  lines.push(`**Origin path**\n${originPath}`)
  if (etymology) lines.push(`**Etymology**\n${etymology}`)
  const cited = [...new Map([...citations
    .filter((item) => item?.populated !== false && item?.citation)
    .map((item) => [text(item.citation).toLocaleLowerCase("en-US"), text(item.citation)]), ...worksCited.split("\n").map((citation) => text(citation).replace(/^[-+*]\s*/u, "").trim()).filter(Boolean).map((citation) => [citation.toLocaleLowerCase("en-US"), citation])])].map(([, citation]) => citation)
  if (hasHistoricalSections) lines.push("<hr>")
  lines.push(`**Works Cited**${cited.length ? `\n${cited.join("\n")}` : ""}`)
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

function comparablePartOfSpeech(value) {
  const normalized = lower(value)
  return ["proper noun", "adjective", "adverb", "conjunction", "preposition", "determiner", "pronoun", "interjection", "numeral", "verb", "noun"].find((partOfSpeech) => normalized === partOfSpeech || normalized.includes(partOfSpeech)) || ""
}

function relationNodeMatchesPartOfSpeech($, node, partOfSpeech) {
  const target = comparablePartOfSpeech(partOfSpeech)
  if (!target) return false
  let current = node
  while (current) {
    const container = $(current)
    const markers = container.find(".fl, .part-of-speech, .pos, [data-part-of-speech], h2, h3").toArray()
      .map((marker) => comparablePartOfSpeech($(marker).text()))
      .filter(Boolean)
    const uniqueMarkers = [...new Set(markers)]
    if (uniqueMarkers.length === 1) return uniqueMarkers[0] === target
    current = current.parent
  }
  return false
}

export function normalizeProviderPreview(provider, preview, entry) {
  const sourceItem = manifestById.get(provider)
  const offered = sourceItem?.capabilities || {}
  const isVerbEntry = lower(entry?.partOfSpeech) === "verb"
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
  const structuredDefinition = entries.map((item) => {
    const heading = text(item?.partOfSpeech) ? `**${text(item?.headword) || text(entry?.english)}** *${text(item.partOfSpeech)}*` : ""
    const senses = (Array.isArray(item?.senses) ? item.senses : []).map((sense, index) => {
      const number = text(sense?.number) || String(index + 1)
      const labels = Array.isArray(sense?.labels) ? sense.labels.map(text).filter(Boolean).join(", ") : ""
      const body = [labels ? `*${labels}*` : "", text(sense?.definition)].filter(Boolean).join(" — ")
      const examples = (Array.isArray(sense?.examples) ? sense.examples : []).map((example) => `   - ${text(typeof example === "object" ? example.text : example)}`).filter((line) => line !== "   - ")
      return [`${number}. ${body}`.trim(), ...examples].filter(Boolean).join("\n")
    })
    return [heading, ...senses].filter(Boolean).join("\n\n")
  }).filter(Boolean).join("\n\n")
  const primary = entries.find((item) => lower(item?.partOfSpeech) === lower(entry?.partOfSpeech)) || entries[0] || {}
  const audioEntries = entries.length ? entries : [primary]
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
  const forms = isVerbEntry ? ["verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5"].reduce((result, key, index) => ({ ...result, [key]: providedForms[key] || fields[key] || inflections[index] || "" }), {}) : {}
  const audio = ["us"].flatMap((dialect) => {
    const source = audioEntries.find((item) => item?.audio?.[dialect])?.audio?.[dialect]
    return source ? [{ dialect, available: true, fileName: audioFileName(source) }] : []
  })
  const verbFormAudio = isVerbEntry ? Object.fromEntries(audioEntries.flatMap((item) => item?.verbFormAudio && typeof item.verbFormAudio === "object" ? Object.entries(item.verbFormAudio) : []).filter(([, values]) => values?.us).map(([slot, values]) => [slot, values])) : {}
  const normalizedVerbFormAudio = !isVerbEntry ? {} : Object.keys(verbFormAudio).length ? verbFormAudio : fields.verbFormAudio && typeof fields.verbFormAudio === "object" ? fields.verbFormAudio : {}
  const safeVerbFormAudio = Object.fromEntries(Object.entries(normalizedVerbFormAudio).map(([slot, values]) => [slot, { us: Boolean(values?.us), fileName: audioFileName(values?.us) }]))
  const privateMedia = [
    ...audio.flatMap(({ dialect }) => {
      const sourceUrl = audioEntries.find((item) => item?.audio?.[dialect])?.audio?.[dialect]
      return sourceUrl ? [{ dialect, slot: "headword", sourceUrl }] : []
    }),
    ...Object.entries(normalizedVerbFormAudio).flatMap(([slot, values]) => values?.us ? [{ dialect: "us", slot, sourceUrl: values.us }] : []),
  ]
  const audioValue = audio.length || Object.keys(safeVerbFormAudio).length ? [...audio, ...Object.keys(safeVerbFormAudio).map((slot) => ({ dialect: "us", slot, available: true, fileName: safeVerbFormAudio[slot].fileName }))] : []
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
    verbFormAudio: safeVerbFormAudio,
    definition: structuredDefinition || normalizedFields.definition,
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
  const normalizedDatumStatus = Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, ["verbForms", "verbFormAudio"].includes(datum) && !isVerbEntry ? { status: "not_offered" } : datumStatus(values[datum], offered[datum])]))
  return { provider, status: "available", message: "", sourceUrl: text(preview.sourceUrl), fields: { ...normalizedFields, definition: structuredDefinition || normalizedFields.definition, audio: headwordAudio, verbFormAudio: safeVerbFormAudio }, entries: entries.map((item) => ({ headword: text(item.headword), partOfSpeech: text(item.partOfSpeech), senses: Array.isArray(item.senses) ? item.senses.map((sense) => ({ number: text(sense.number), definition: text(sense.definition), examples: (sense.examples || []).map((example) => text(typeof example === "object" ? example.text : example)).filter(Boolean) })) : [] })), datumStatus: normalizedDatumStatus, media: headwordAudio, privateMedia }
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
      if (provider === "merriam_webster_thesaurus" && response.status === 403) {
        response = await browserFetchImpl(sourceUrl)
        if (!response?.ok) return { provider, status: response?.robotBlocked ? "robot_blocked" : "unavailable", message: response?.message || `${item.label} browser access failed`, sourceUrl, fields: {}, entries: [], media: [], datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: item.capabilities[datum] ? response?.robotBlocked ? "robot_blocked" : "unavailable" : "not_offered" }])) }
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
      const relationRows = (selectors) => $(selectors).filter((_, node) => relationNodeMatchesPartOfSpeech($, node, entry?.partOfSpeech)).map((_, node) => text($(node).text())).get().filter(Boolean)
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
  merriam_webster_thesaurus: (entry) => previewHtmlAdapter("merriam_webster_thesaurus", entry, fetch, fetchMerriamWebsterBrowserPage),
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
  const restricted = datum === "firstKnownUse"
    ? eligible.filter((provider) => ["merriam_webster", "merriam_webster_api", "merriam_webster_scrape", "wiktionary"].includes(provider))
    : eligible
  const mandatory = (DICTIONARY_BUILDER_MANDATORY_DATUM_PROVIDERS[datum] || []).filter((provider) => manifestById.get(scoringBaseProvider(provider))?.capabilities?.[datum])
  const ordered = [...mandatory, ...restricted.filter((provider) => !mandatory.includes(provider))]
  return ordered.filter((provider, index, providers) => manifestById.has(scoringBaseProvider(provider)) && providers.indexOf(provider) === index).slice(0, datum === "vietnamese" ? 1 : 3)
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
  const adapter = fetcher[provider] || fetcher[provider === "merriam_webster" ? "merriam_webster_api" : scoringBaseProvider(provider)]
  if (provider !== "merriam_webster_scrape" || !adapter) return adapter
  return async (...args) => ({ ...await adapter(...args), provider })
}

async function runDictionaryBuilderProvider(adapter, entry, provider, timeoutMs = DICTIONARY_BUILDER_PROVIDER_TIMEOUT_MS, parentSignal = null) {
  if (typeof adapter !== "function") return { provider, status: "unavailable", message: "Provider adapter is unavailable.", fields: {}, entries: [], media: [], datumStatus: {} }
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(parentSignal.reason || new Error("Dictionary Builder preview aborted"))
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent()
    else parentSignal.addEventListener("abort", abortFromParent, { once: true })
  }
  const providerFetch = (url, options = {}) => fetch(url, { ...options, signal: controller.signal })
  let timer
  try {
    const result = await Promise.race([
      provider === "google_translate" ? adapter(entry, { fetchImpl: providerFetch }) : adapter(entry, providerFetch),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(Object.assign(new Error(`${provider} preview timed out; waiting for input.`), { code: "DICTIONARY_BUILDER_PROVIDER_TIMEOUT" })); reject(controller.signal.reason) }, timeoutMs) }),
    ])
    return { ...result, provider }
  } catch (error) {
    const timedOut = ["DICTIONARY_BUILDER_PROVIDER_TIMEOUT", "DICTIONARY_BUILDER_PREVIEW_TIMEOUT"].includes(error?.code)
    return { provider, status: timedOut ? "waiting_for_input" : "unavailable", message: text(error?.message) || `${provider} preview is unavailable.`, fields: {}, entries: [], media: [], datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: timedOut ? "waiting_for_input" : "unavailable" }])) }
  } finally {
    if (timer) clearTimeout(timer)
    parentSignal?.removeEventListener("abort", abortFromParent)
    controller.abort()
  }
}

async function runDictionaryBuilderPreview(taskFactory, timeoutMs = DICTIONARY_BUILDER_PREVIEW_TIMEOUT_MS) {
  const controller = new AbortController()
  let timer
  try {
    return await Promise.race([
      taskFactory(controller.signal),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(Object.assign(new Error("Dictionary Builder preview timed out; waiting for input."), { code: "DICTIONARY_BUILDER_PREVIEW_TIMEOUT" })); reject(controller.signal.reason) }, timeoutMs) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    controller.abort()
  }
}

function sameDictionaryProvider(left, right) {
  return canonicalDictionaryProviderId(left) === canonicalDictionaryProviderId(right)
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

function publicSourceUrl(provider, word) {
  const item = manifestById.get(provider) || manifestById.get(scoringBaseProvider(provider))
  return item?.searchUrl?.(text(word)) || ""
}

function sourceLabel(provider) {
  return manifestById.get(provider)?.label || scoringSourceById.get(provider)?.label || provider
}

function datumStatusLabel(status) {
  return text(status || "not attempted").replaceAll("_", " ")
}

export function buildDictionaryBuilderAcquisitionLog(entry, results = [], { initialProviders = DICTIONARY_BUILDER_INITIAL_SERVER_PROVIDERS } = {}) {
  const sourceByProvider = new Map(results.map((result) => [result.provider, result]))
  const isVerb = lower(entry?.partOfSpeech) === "verb"
  const applicableDatums = new Set(DICTIONARY_BUILDER_DATUMS.filter((datum) => isVerb || !["verbForms", "verbFormAudio"].includes(datum)))
  const lines = [
    "Dictionary Builder acquisition log",
    `Word: ${text(entry?.english) || "(missing)"} | POS: ${text(entry?.partOfSpeech) || "(missing)"}`,
    "",
    "Initial source connections:",
  ]
  initialProviders.forEach((provider) => {
    const result = sourceByProvider.get(provider)
    lines.push(`- ${sourceLabel(provider)}: ${result ? `completed (${result.status || "unknown"})` : "not pulled"}${result?.message ? ` — ${text(result.message)}` : ""}`)
  })
  lines.push("", "Pertinent datum availability and primary/secondary pulls:")
  Object.entries(DICTIONARY_BUILDER_PREFERRED_DATUM_PROVIDERS).filter(([datum]) => applicableDatums.has(datum)).forEach(([datum, providers]) => {
    const details = providers.map((provider, index) => {
      const result = sourceByProvider.get(provider)
      const status = result?.datumStatus?.[datum]?.status || (result ? result.status : "not pulled")
      return `${index === 0 ? "primary" : "secondary"} ${sourceLabel(provider)}=${datumStatusLabel(status)}`
    })
    const successful = providers.filter((provider) => sourceByProvider.get(provider)?.datumStatus?.[datum]?.status === "available")
    lines.push(`- ${datum}: ${details.join("; ")} | ${successful.length ? `successful pull: ${successful.map(sourceLabel).join(", ")}` : "waiting for confirmed source data"}`)
  })
  const issues = results.flatMap((result) => {
    const sourceIssues = result.message ? [`${sourceLabel(result.provider)}: ${text(result.message)}`] : []
    const datumIssues = Object.entries(result.datumStatus || {}).filter(([datum, state]) => applicableDatums.has(datum) && state?.status && state.status !== "available" && state.status !== "not_offered").map(([datum, state]) => `${sourceLabel(result.provider)} / ${datum}: ${datumStatusLabel(state.status)}`)
    return [...sourceIssues, ...datumIssues]
  })
  lines.push("", issues.length ? "Issues affecting acquisition:" : "Issues affecting acquisition: none reported")
  issues.forEach((issue) => lines.push(`- ${issue}`))
  return lines.join("\n")
}

export async function previewDictionaryBuilder(entry, { ownerKey, fetcher = adapters, rankedSources = null, rankedSourcesByDatum = {}, datumRoundRobinOffsets = {} } = {}) {
  const owner = text(ownerKey)
  if (!owner) throw new Error("Dictionary Builder requires an authenticated session binding")
  const applicableDatums = DICTIONARY_BUILDER_DATUMS.filter((datum) => lower(entry?.partOfSpeech) === "verb" || !["verbForms", "verbFormAudio"].includes(datum))
  const ranked = Array.isArray(rankedSources) ? rankedSources : await dictionaryBuilderRankDatumSources(entry?.partOfSpeech, "definition")
  const initialProviderBases = new Set(DICTIONARY_BUILDER_INITIAL_SERVER_PROVIDERS.map((provider) => scoringBaseProvider(provider)))
  const rankedInitialExtras = rankedDatumProviderIds("definition", ranked).filter((provider) => !initialProviderBases.has(scoringBaseProvider(provider)))
  const selected = [...DICTIONARY_BUILDER_INITIAL_SERVER_PROVIDERS, ...rankedInitialExtras, "merriam_webster_thesaurus", "google_translate", DICTIONARY_BUILDER_SYLLABLE_PROVIDER]
    .filter((provider, index, providers) => index === providers.indexOf(provider))
  const results = await runDictionaryBuilderPreview(
    (signal) => Promise.all(selected.map((provider) => runDictionaryBuilderProvider(dictionaryBuilderAdapter(fetcher, provider), entry, provider, DICTIONARY_BUILDER_PROVIDER_TIMEOUT_MS, signal))),
  ).catch((error) => selected.map((provider) => ({ provider, status: "waiting_for_input", message: text(error?.message) || "Dictionary Builder preview timed out; waiting for input.", fields: {}, entries: [], media: [], datumStatus: Object.fromEntries(DICTIONARY_BUILDER_DATUMS.map((datum) => [datum, { status: "waiting_for_input" }])) })))
  const previewTimedOut = results.some((result) => result?.status === "waiting_for_input" || Object.values(result?.datumStatus || {}).some((datum) => datum?.status === "waiting_for_input"))
  const missing = applicableDatums.filter((datum) => !results.some((result) => result.datumStatus?.[datum]?.status === "available"))
  const requestedDatums = [...new Set([...applicableDatums, ...missing, "audio"])]
  const datumSourceOrder = {}
  for (const datum of requestedDatums) {
    const rankedForDatum = Array.isArray(rankedSourcesByDatum?.[datum]) ? rankedSourcesByDatum[datum] : await dictionaryBuilderRankDatumSources(entry?.partOfSpeech, datum)
    const rankedOrder = rankedDatumProviderIds(datum, rankedForDatum)
    const sourceOrder = datum === "originPath"
      ? DICTIONARY_BUILDER_PREFERRED_DATUM_PROVIDERS.originPath
      : dictionaryBuilderBicDatumProviderIds(datum, rankedForDatum)
    const normalizedSourceOrder = sourceOrder.map((provider) => results.find((result) => sameDictionaryProvider(result.provider, provider))?.provider || provider)
    datumSourceOrder[datum] = normalizedSourceOrder
    if (previewTimedOut) continue
    for (const provider of normalizedSourceOrder) {
      if (results.some((result) => sameDictionaryProvider(result.provider, provider))) continue
      const adapter = dictionaryBuilderAdapter(fetcher, provider)
      results.push(await runDictionaryBuilderProvider(adapter, entry, provider))
    }
  }
  const bicTopThreeByDatum = {}
  for (const datum of DICTIONARY_BUILDER_DATUMS) {
    const rankedForDatum = Array.isArray(rankedSourcesByDatum?.[datum]) ? rankedSourcesByDatum[datum] : await dictionaryBuilderRankDatumSources(entry?.partOfSpeech, datum)
    const available = currentAvailableDatumProviders(datum, results, rankedForDatum)
    const availableRanked = rankedForDatum.filter((item) => available.includes(text(item?.provider)))
    bicTopThreeByDatum[datum] = dictionaryBuilderBicDatumProviderIds(datum, availableRanked)
  }
  const snapshotId = crypto.randomUUID()
  const createdAt = nowDate().toISOString()
  const snapshot = { id: snapshotId, version: DICTIONARY_BUILDER_VERSION, entryId: text(entry?.id), ownerKey: owner, createdAt, expiresAtMs: Date.now() + TTL_MS, sourceOrder: results.map((result) => result.provider), datumSourceOrder, bicTopThreeByDatum, privateSources: results, sources: results.map(({ sourceUrl, privateMedia, ...result }) => ({ ...result, sourceUrl: publicSourceUrl(result.provider, entry?.english) })), citations: buildDictionaryBuilderCitations(entry?.english, createdAt), warnings: missing.map((datum) => `No selected source offered ${datum}; apply remains available.`) }
  snapshot.acquisitionLog = buildDictionaryBuilderAcquisitionLog(entry, results)
  snapshot.bytes = Buffer.byteLength(JSON.stringify(snapshot))
  snapshots.set(snapshotId, snapshot)
  cleanCache()
  return publicSnapshot(snapshot)
}

export async function retryDictionaryBuilderSnapshot(snapshotId, entry, { ownerKey, provider, datum = "", fetcher = adapters } = {}) {
  cleanCache()
  const snapshot = snapshots.get(text(snapshotId))
  if (!snapshot || snapshot.ownerKey !== text(ownerKey) || snapshot.entryId !== text(entry?.id)) return null
  const providerId = text(provider)
  const previous = snapshot.privateSources.find((result) => result.provider === providerId)
  if (!manifestById.has(scoringBaseProvider(providerId))) return null
  const adapter = dictionaryBuilderAdapter(fetcher, providerId)
  let refreshed
  try {
    refreshed = await adapter(entry)
  } catch (error) {
    refreshed = { provider: providerId, status: "unavailable", message: text(error.message), fields: {}, entries: [], media: [], datumStatus: {} }
  }
  const refreshedSources = previous
    ? snapshot.privateSources.map((result) => result.provider === providerId ? refreshed : result)
    : [...snapshot.privateSources, refreshed]
  snapshot.privateSources = refreshedSources
  snapshot.sources = refreshedSources.map(({ sourceUrl, privateMedia, ...result }) => ({ ...result, sourceUrl: publicSourceUrl(result.provider, entry?.english) }))
  snapshot.sourceOrder = refreshedSources.map((result) => result.provider)
  if (datum && !snapshot.datumSourceOrder[datum]?.includes(providerId)) snapshot.datumSourceOrder[datum] = [providerId, ...(snapshot.datumSourceOrder[datum] || [])]
  snapshot.acquisitionLog = buildDictionaryBuilderAcquisitionLog(entry, refreshedSources)
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
  const selected = new Set((Array.isArray(selectedFields) ? selectedFields : []).map((item) => `${text(item?.provider)}\u0000${text(item?.datum)}`))
  for (const result of snapshot.sources || []) {
    for (const datum of DICTIONARY_BUILDER_DATUMS) {
      const status = result.datumStatus?.[datum]?.status
      const countsTowardAvailability = status === "available" || status === "not_found" || status === "not_offered"
      if (!countsTowardAvailability) continue
      const available = status === "available"
      const provider = canonicalDictionaryProviderId(result.provider)
      const selectedProviderDatum = selected.has(`${result.provider}\u0000${datum}`) || selected.has(`${provider}\u0000${datum}`)
      await client.dictionaryProviderSuitabilityMetric.upsert({
        where: { provider_partOfSpeech_datum: { provider, partOfSpeech: lower(partOfSpeech) || "any", datum } },
        create: { provider, partOfSpeech: lower(partOfSpeech) || "any", datum, attemptCount: 1, availableCount: available ? 1 : 0, eligibleApplyCount: available ? 1 : 0, selectedApplyCount: available && selectedProviderDatum ? 1 : 0 },
        update: { attemptCount: { increment: 1 }, availableCount: available ? { increment: 1 } : undefined, eligibleApplyCount: available ? { increment: 1 } : undefined, selectedApplyCount: available && selectedProviderDatum ? { increment: 1 } : undefined },
      })
    }
  }
}
