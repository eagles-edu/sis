// src/modules/admin/student-news-compliance.mjs
// @ts-check

import { checkTextWithLanguageTool } from "./student-news-language-tool.mjs"
import { parseStudentNewsSentence } from "./student-news-parser.mjs"
import { checkVerbTransitivity } from "./verb-transitivity.mjs"
import { validateVocabularyEntry, vocabularyEntryError } from "./vocabulary-syllabication.mjs"

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeNullableText(value) {
  const text = normalizeText(value)
  return text || null
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function parseDateOrNull(value) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value
  const text = normalizeText(value)
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.valueOf()) ? null : parsed
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeHttpUrl(value) {
  const text = normalizeText(value)
  if (!text) return ""
  try {
    const parsed = new URL(text)
    const protocol = normalizeLower(parsed.protocol)
    if (protocol !== "https:") return ""
    return parsed.toString()
  } catch (error) {
    void error
    return ""
  }
}

/**
 * @returns {string}
 */
function nowIso() {
  return new Date().toISOString()
}

const STUDENT_NEWS_REVIEW_STATUS_SUBMITTED = "submitted"
const STUDENT_NEWS_REVIEW_STATUS_APPROVED = "approved"
const STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED = "revision-requested"
const STUDENT_NEWS_REVIEW_STATUS_COLOR = {
  [STUDENT_NEWS_REVIEW_STATUS_APPROVED]: "green",
  [STUDENT_NEWS_REVIEW_STATUS_SUBMITTED]: "amber",
  [STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED]: "red",
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizeStudentNewsReviewStatus(value, fallback = STUDENT_NEWS_REVIEW_STATUS_SUBMITTED) {
  const token = normalizeLower(value)
  if (!token) return fallback
  if (token === "all") return "all"
  if (token === "approved" || token === "approve") return STUDENT_NEWS_REVIEW_STATUS_APPROVED
  if (
    token === "revision-requested"
    || token === "revision_requested"
    || token === "revision"
    || token === "revise"
    || token === "request-revision"
    || token === "request_revision"
  ) {
    return STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED
  }
  if (
    token === "submitted"
    || token === "pending"
    || token === "needs-review"
    || token === "needs_review"
    || token === "needsreview"
  ) {
    return STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
  }
  return fallback
}

/**
 * @param {unknown} status
 * @returns {string}
 */
function resolveStudentNewsStatusColor(status) {
  const normalized = normalizeStudentNewsReviewStatus(status, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED)
  return STUDENT_NEWS_REVIEW_STATUS_COLOR[normalized] || "amber"
}

const STUDENT_NEWS_COMPLIANCE_NOTE_START = "[[SIS-COMPLIANCE-V1]]"
const STUDENT_NEWS_COMPLIANCE_NOTE_END = "[[/SIS-COMPLIANCE-V1]]"
const STUDENT_NEWS_FIXED_NOTE_PREFIX = "FIXED PER COMPLIANCE RESOLUTION ON SAVE"
const STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER = "[[SIS-AWAITING-RE-REVIEW]]"
const STUDENT_NEWS_DEFAULT_ALLOWED_SOURCE_DOMAINS = Object.freeze(["cnn.com", "bbc.com"])
const STUDENT_NEWS_MAX_CUSTOM_ALLOWED_SOURCES = 8
const STUDENT_NEWS_SOURCE_DOMAIN_MAX_LENGTH = 140
const STUDENT_NEWS_HTTP_HEADERS = Object.freeze({
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
})
const STUDENT_NEWS_FIELD_LABELS = Object.freeze({
  sourceLink: "Source Full Web Address (url)",
  articleTitle: "Article Title",
  byline: "Byline (Author)",
  articleDateline: "Dateline",
  leadSynopsis: "Lead Synopsis",
})
const STUDENT_NEWS_FIELD_MAX_LENGTHS = Object.freeze({
  sourceLink: 2048,
  articleTitle: 240,
  byline: 240,
  articleDateline: 240,
  leadSynopsis: 5000,
  actionActor: 2000,
  actionAffected: 2000,
  actionWhere: 2000,
  actionWhat: 4000,
  actionWhy: 4000,
  biasAssessment: 5000,
})
const STUDENT_NEWS_DEFAULT_THRESHOLDS = Object.freeze({
  articleTitle: 0.7,
  byline: 0.7,
  articleDateline: 0.7,
  leadSynopsis: 0.5,
})
const STUDENT_NEWS_DEFAULT_VOCABULARY_MINIMUM = 5
const STUDENT_NEWS_VOCABULARY_PARTS_OF_SPEECH = Object.freeze([
  "adjective",
  "noun",
  "verb",
  "adverb",
  "conjunction",
  "preposition",
  "determiner",
  "pronoun",
  "interjection",
  "phrase",
  "idiom",
  "clause",
])

function normalizeStudentNewsVocabulary(value) {
  const rows = Array.isArray(value) ? value : []
  return rows.slice(0, 100).map((row) => ({
    partOfSpeech: normalizeLower(row?.partOfSpeech),
    english: normalizeText(row?.english),
    vietnamese: normalizeText(row?.vietnamese),
    syllabication: normalizeText(row?.syllabication),
    definition: normalizeText(row?.definition),
    verbTransitivity: normalizeLower(row?.esl?.verbTransitivity),
    etymologyType: normalizeLower(row?.esl?.etymologyType),
    etymology: normalizeText(row?.esl?.etymology),
  }))
}

function isValidStudentNewsSyllabication(value, english = "") {
  return !vocabularyEntryError({ english, syllabication: value })
}

async function studentNewsVocabularyRowError(row, index, dictionaryValidation = null) {
  const missing = []
  if (!STUDENT_NEWS_VOCABULARY_PARTS_OF_SPEECH.includes(row.partOfSpeech)) missing.push("part of speech")
  if (!row.english) missing.push("English")
  else if (/[A-Z]/u.test(row.english)) {
    return { index, english: row.english, fields: ["english"], message: `Entry ${index + 1} must use lowercase for Word/Phrase EN.` }
  }
  if (!row.vietnamese) missing.push("Vietnamese")
  if (!row.syllabication) missing.push("syllabication")
  else if (vocabularyEntryError(row)) {
    const entryLabel = row.english ? `\"${row.english}\"` : "this entry"
    return {
      index,
      english: row.english,
      fields: ["syllabication"],
      message: `Entry ${index + 1} (${entryLabel}) has invalid syllabication: ${vocabularyEntryError(row)}`,
    }
  }
  const resolvedDictionaryValidation = dictionaryValidation || await validateVocabularyEntry(row)
  if (resolvedDictionaryValidation.message) {
    const entryLabel = row.english ? `\"${row.english}\"` : "this entry"
    return {
      index,
      english: row.english,
      fields: ["syllabication"],
      message: `Entry ${index + 1} (${entryLabel}) has invalid syllabication: ${resolvedDictionaryValidation.message}`,
    }
  }
  if (!row.definition) missing.push("definition")
  if (!missing.length) return null
  const entryLabel = row.english ? `\"${row.english}\"` : "blank entry"
  return {
    index,
    english: row.english,
    fields: missing.map((field) => ({
      "part of speech": "partOfSpeech",
      English: "english",
      Vietnamese: "vietnamese",
      syllabication: "syllabication",
      definition: "definition",
    }[field])).filter(Boolean),
    message: `Entry ${index + 1} (${entryLabel}) is incomplete: add ${missing.join(", ")}.`,
  }
}

function findStudentNewsVocabularyExtraPointWarnings(value) {
  return normalizeStudentNewsVocabulary(value)
    .map((row, index) => {
      const english = normalizeText(row.english)
      const syllabication = normalizeText(row.syllabication)
      const verified = STUDENT_NEWS_VERIFIED_COMPOUND_SYLLABICATIONS[normalizeLower(english)]
      if (!verified || !syllabication || normalizeLower(english) !== normalizeLower(syllabication)) return null
      return {
        index,
        english,
        message: `Entry ${index + 1} ("${english}") passes as a compound, but its verified dictionary syllabication is "${verified}" for extra points.`,
      }
    })
    .filter(Boolean)
}

function findStudentNewsTransitivityAttempts(value) {
  return normalizeStudentNewsVocabulary(value)
    .map((row, index) => {
      if (row.partOfSpeech !== "verb" || !row.verbTransitivity) return null
      let verification
      try {
        verification = checkVerbTransitivity(row.english, row.verbTransitivity)
      } catch (error) {
        verification = { found: false, matchesExpected: null, verificationStatus: "unavailable", verificationMessage: error.message || "Transitivity verification is unavailable." }
      }
      return {
        index,
        english: row.english,
        transitivity: row.verbTransitivity,
        fields: ["verbTransitivity"],
        verificationStatus: verification.matchesExpected === true ? "verified" : verification.matchesExpected === false ? "mismatch" : "unavailable",
        verification: {
          found: verification.found === true,
          matchesExpected: verification.matchesExpected ?? null,
          classification: verification.classification || null,
          classificationEvidence: verification.classificationEvidence || null,
        },
        message: `Entry ${index + 1}${row.english ? ` ("${row.english}")` : ""} includes an optional transitivity attempt for extra points.`,
      }
    })
    .filter(Boolean)
}

function findStudentNewsEtymologyAttempts(value) {
  return normalizeStudentNewsVocabulary(value)
    .map((row, index) => {
      if (!row.etymologyType && !row.etymology) return null
      return {
        index,
        english: row.english,
        fields: [row.etymologyType ? "etymologyType" : null, row.etymology ? "etymology" : null].filter(Boolean),
        etymologyType: row.etymologyType || null,
        etymology: row.etymology || null,
        message: `Entry ${index + 1}${row.english ? ` ("${row.english}")` : ""} includes an optional etymology attempt for extra points.`,
      }
    })
    .filter(Boolean)
}

async function evaluateStudentNewsVocabulary(value, { minimumWords = STUDENT_NEWS_DEFAULT_VOCABULARY_MINIMUM } = {}) {
  if (value === undefined || value === null) return { passed: true, message: "", count: 0 }
  const rows = normalizeStudentNewsVocabulary(value)
  const transitivityAttempts = findStudentNewsTransitivityAttempts(value)
  const populated = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => Object.values(row).some(Boolean))
  const validatedRows = await Promise.all(populated.map(async ({ row, index }) => {
    const dictionaryValidation = await validateVocabularyEntry(row)
    return {
      row,
      index,
      dictionaryValidation,
      error: await studentNewsVocabularyRowError(row, index, dictionaryValidation),
    }
  }))
  const rowErrors = validatedRows.map((entry) => entry.error).filter(Boolean)
  const rowWarnings = validatedRows
    .filter((entry) => !entry.error && entry.dictionaryValidation.warning)
    .map((entry) => ({ index: entry.index, english: entry.row.english, message: entry.dictionaryValidation.warning, fields: ["syllabication"] }))
  const minimum = Math.max(1, Math.min(100, Math.trunc(Number(minimumWords)) || STUDENT_NEWS_DEFAULT_VOCABULARY_MINIMUM))
  if (rowErrors.length || populated.length < minimum) {
    return {
      passed: false,
      message: rowErrors.length
        ? rowErrors.map((entry) => entry.message).join(" ")
        : `At least ${minimum} complete vocabulary rows are required.`,
      count: populated.length,
      rowErrors,
      rowWarnings,
      transitivityAttemptCount: transitivityAttempts.length,
      transitivityAttempts,
    }
  }
  return { passed: true, message: "", count: populated.length, rowErrors: [], rowWarnings, transitivityAttemptCount: transitivityAttempts.length, transitivityAttempts }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeDomainToken(value) {
  const raw = normalizeLower(value)
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/[#?].*$/, "")
    .replace(/^www\./, "")
    .trim()
  if (!raw) return ""
  if (raw.length > STUDENT_NEWS_SOURCE_DOMAIN_MAX_LENGTH) return ""
  if (!/^[a-z0-9.-]+$/.test(raw)) return ""
  if (!raw.includes(".")) return ""
  return raw
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function hostnameFromUrl(value) {
  const text = normalizeText(value)
  if (!text) return ""
  try {
    const parsed = new URL(text)
    const protocol = normalizeLower(parsed.protocol)
    if (protocol !== "https:") return ""
    return normalizeDomainToken(parsed.hostname)
  } catch (error) {
    void error
    return ""
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasSpecificArticlePath(value) {
  const text = normalizeText(value)
  if (!text) return false
  try {
    const parsed = new URL(text)
    const protocol = normalizeLower(parsed.protocol)
    if (protocol !== "https:") return false
    const pathname = normalizeText(parsed.pathname)
    return Boolean(pathname && pathname !== "/")
  } catch (error) {
    void error
    return false
  }
}

/**
 * @param {unknown} hostname
 * @param {unknown} allowedDomain
 * @returns {boolean}
 */
function sourceDomainMatches(hostname, allowedDomain) {
  const host = normalizeDomainToken(hostname)
  const domain = normalizeDomainToken(allowedDomain)
  if (!host || !domain) return false
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * @param {Record<string, unknown> | null | undefined} [config]
 * @returns {{
 *   enabled: boolean,
 *   allowedDomains: string[],
 *   thresholds: {
 *     articleTitle: number,
 *     byline: number,
 *     articleDateline: number,
 *     leadSynopsis: number,
 *   },
 * }}
 */
function normalizeStudentNewsValidationConfig(config = {}) {
  const source = config && typeof config === "object" ? config : {}
  const enabled = source?.enabled !== false
  const incomingDomains = Array.isArray(source.allowedDomains)
    ? source.allowedDomains
    : []
  const normalizedDomains = incomingDomains
    .map((entry) => normalizeDomainToken(entry))
    .filter(Boolean)
  const allowedDomains = normalizedDomains.length
    ? Array.from(new Set(normalizedDomains))
    : [...STUDENT_NEWS_DEFAULT_ALLOWED_SOURCE_DOMAINS]
  const grammarSource = source?.grammarEngine && typeof source.grammarEngine === "object"
    ? source.grammarEngine
    : {}

  const thresholds = {
    articleTitle: Number(source?.thresholds?.articleTitle),
    byline: Number(source?.thresholds?.byline),
    articleDateline: Number(source?.thresholds?.articleDateline),
    leadSynopsis: Number(source?.thresholds?.leadSynopsis),
  }
  return {
    enabled,
    vocabularyMinimumWords: Number.isFinite(Number(source?.vocabularyMinimumWords))
      ? Math.max(1, Math.min(100, Math.trunc(Number(source.vocabularyMinimumWords))))
      : STUDENT_NEWS_DEFAULT_VOCABULARY_MINIMUM,
    allowedDomains,
    thresholds: {
      articleTitle: Number.isFinite(thresholds.articleTitle)
        ? Math.max(0.1, Math.min(1, thresholds.articleTitle))
        : STUDENT_NEWS_DEFAULT_THRESHOLDS.articleTitle,
      byline: Number.isFinite(thresholds.byline)
        ? Math.max(0.1, Math.min(1, thresholds.byline))
        : STUDENT_NEWS_DEFAULT_THRESHOLDS.byline,
      articleDateline: Number.isFinite(thresholds.articleDateline)
        ? Math.max(0.1, Math.min(1, thresholds.articleDateline))
        : STUDENT_NEWS_DEFAULT_THRESHOLDS.articleDateline,
      leadSynopsis: Number.isFinite(thresholds.leadSynopsis)
        ? Math.max(0.1, Math.min(1, thresholds.leadSynopsis))
        : STUDENT_NEWS_DEFAULT_THRESHOLDS.leadSynopsis,
    },
    grammarEngine: {
      enabled: grammarSource.enabled === true,
      endpoint: normalizeText(grammarSource.endpoint),
      language: normalizeText(grammarSource.language) || "en-US",
      timeoutMs: Math.max(1000, Math.min(30000, Number.parseInt(String(grammarSource.timeoutMs), 10) || 12000)),
    },
  }
}

/**
 * @param {unknown} value
 * @param {unknown} [maxLength]
 * @returns {{ value: string, truncated: boolean }}
 */
function clampText(value, maxLength = 0) {
  const text = normalizeText(value)
  const max = Number.parseInt(String(maxLength), 10) || 0
  if (max <= 0) return { value: text, truncated: false }
  if (text.length <= max) return { value: text, truncated: false }
  return {
    value: text.slice(0, max),
    truncated: true,
  }
}

/**
 * @param {string} [text]
 * @returns {string}
 */
function decodeHtmlEntities(text = "") {
  return normalizeText(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
}

/**
 * @param {string} [text]
 * @returns {string}
 */
function stripTags(text = "") {
  return decodeHtmlEntities(
    normalizeText(text)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  )
}

/**
 * @param {string} [html]
 * @param {string} [selectorPattern]
 * @returns {string}
 */
function extractMetaContent(html = "", selectorPattern = "") {
  const pattern = normalizeText(selectorPattern)
  if (!pattern) return ""
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regexes = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i"),
  ]
  for (const regex of regexes) {
    const match = normalizeText(html).match(regex)
    if (match && match[1]) return stripTags(match[1])
  }
  return ""
}

/**
 * @param {string} [html]
 * @returns {string}
 */
function extractTitleFromHtml(html = "") {
  const h1TitleMatch = normalizeText(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  const h1Title = h1TitleMatch && h1TitleMatch[1] ? stripTags(h1TitleMatch[1]) : ""
  const metaTitle = extractMetaContent(html, "og:title")
    || extractMetaContent(html, "twitter:title")
  const titleMatch = normalizeText(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const documentTitle = titleMatch && titleMatch[1] ? stripTags(titleMatch[1]) : ""
  const mergedMeta = chooseMoreSpecificTitle(metaTitle, documentTitle)
  return chooseMoreSpecificTitle(h1Title, mergedMeta)
}

/**
 * @param {string} [html]
 * @returns {string}
 */
function extractFirstParagraphFromHtml(html = "") {
  const body = normalizeText(html)
  const paragraphRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi
  let match
  while ((match = paragraphRegex.exec(body))) {
    const text = stripTags(match[1])
    if (text.length >= 40) return text
  }
  return ""
}

/**
 * @param {string} [html]
 * @param {string} [plainText]
 * @returns {string}
 */
function extractBylineFromHtml(html = "", plainText = "") {
  const metaByline = extractMetaContent(html, "author")
    || extractMetaContent(html, "article:author")
    || extractMetaContent(html, "parsely-author")
  if (metaByline) {
    const parsedMetaByline = parseJinaBylineCandidate(metaByline)
    if (parsedMetaByline) return parsedMetaByline
  }
  const htmlCandidateRegex =
    /<(?:span|div|p)[^>]*(?:data-testid|class|id)=["'][^"']*(?:byline|author)[^"']*["'][^>]*>([\s\S]{1,180}?)<\/(?:span|div|p)>/gi
  let htmlCandidateMatch
  while ((htmlCandidateMatch = htmlCandidateRegex.exec(normalizeText(html)))) {
    const candidate = stripTags(htmlCandidateMatch[1] || "")
    const parsedCandidate = parseJinaBylineCandidate(candidate)
    if (parsedCandidate) return parsedCandidate
  }
  const plainLines = normalizeText(plainText).split(/\r?\n/).map((line) => normalizeText(line)).filter(Boolean)
  for (const line of plainLines.slice(0, 120)) {
    const parsedCandidate = parseJinaBylineCandidate(line)
    if (parsedCandidate) return parsedCandidate
  }
  for (const line of plainLines.slice(0, 120)) {
    const prefixMatch = line.match(/^(?:by|written by)\s+/i)
    if (!prefixMatch) continue
    const candidate = normalizeText(line.slice(prefixMatch[0].length))
    const bylineMatch = candidate.match(
      /^([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,3})(?:\s*,\s*.+)?$/
    )
    if (bylineMatch && bylineMatch[1]) return normalizeText(bylineMatch[1])
  }
  return ""
}

/**
 * @param {string} [html]
 * @param {string} [plainText]
 * @returns {{ publish: string, updated: string, combined: string }}
 */
function extractDatelineSnippets(html = "", plainText = "") {
  const publishedMeta = extractMetaContent(html, "article:published_time")
    || extractMetaContent(html, "og:published_time")
    || extractMetaContent(html, "publish_date")
  const updatedMeta = extractMetaContent(html, "article:modified_time")
    || extractMetaContent(html, "og:modified_time")
    || extractMetaContent(html, "lastmod")
  const relativeVisible = extractRelativeDatelineFragment(plainText)
  const publishedVisible = normalizeText(plainText).match(/(?:published|publish date)[^.\n]{0,220}/i)?.[0] || ""
  const updatedVisible = normalizeText(plainText).match(/(?:updated|last updated)[^.\n]{0,220}/i)?.[0] || ""
  const publish = publishedVisible || relativeVisible || publishedMeta
  const updated = updatedVisible || updatedMeta
  return {
    publish: normalizeText(publish),
    updated: normalizeText(updated),
    combined: [publish, updated].map((entry) => normalizeText(entry)).filter(Boolean).join(" | "),
  }
}

/**
 * @param {string} [link]
 * @returns {boolean}
 */
function isBbcLiveUrl(link = "") {
  const host = hostnameFromUrl(link)
  if (!host || !host.endsWith("bbc.com")) return false
  try {
    const { pathname } = new URL(link)
    return /\/news\/live\//i.test(pathname)
  } catch (error) {
    void error
    return false
  }
}

/**
 * @param {string} [link]
 * @returns {boolean}
 */
function isCnnUrl(link = "") {
  const host = hostnameFromUrl(link)
  return Boolean(host) && host.endsWith("cnn.com")
}

/**
 * @param {string} [link]
 * @returns {string}
 */
function resolveBbcAmpUrl(link = "") {
  try {
    const url = new URL(link)
    if (!url.pathname.endsWith(".amp")) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}.amp`
    }
    return url.toString()
  } catch (error) {
    void error
    return ""
  }
}

/**
 * @param {string} [link]
 * @returns {string}
 */
function resolveCnnAmpUrl(link = "") {
  try {
    const url = new URL(link)
    url.searchParams.set("outputType", "amp")
    return url.toString()
  } catch (error) {
    void error
    return ""
  }
}

/**
 * @param {string} [line]
 * @returns {boolean}
 */
function isLikelyJinaMetadataLine(line = "") {
  const text = normalizeText(line)
  if (!text) return true
  if (/^(?:title|url source|published time|updated time|last updated|markdown content)\s*:/i.test(text)) {
    return true
  }
  if (/^\[[^\]]+\]\(https?:\/\/[^)]+\)\s*$/i.test(text)) return true
  if (/^!\[[^\]]*\]\(https?:\/\/[^)]+\)\s*$/i.test(text)) return true
  if (/^\*\s+\[[^\]]+\]\(https?:\/\/[^)]+\)\s*$/i.test(text)) return true
  if (/^add as preferred on google$/i.test(text)) return true
  if (/^(?:listen|download|podcast)$/i.test(text)) return true
  if (/^(?:share|save|share save)$/i.test(text)) return true
  if (
    /^(?:skip to content|watch live|home|news|sport|business|technology|health|culture|arts|travel|earth|audio|video|live|documentaries|weather|newsletters)$/i
      .test(text)
  ) {
    return true
  }
  return false
}

/**
 * @param {string} [value]
 * @returns {boolean}
 */
function isRelativeDatelineToken(value = "") {
  return /^\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago$/i.test(normalizeText(value))
}

/**
 * @param {string} [value]
 * @returns {string}
 */
function extractRelativeDatelineFragment(value = "") {
  const text = normalizeText(value)
  if (!text) return ""
  const match = text.match(/\b\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/i)
  return match && match[0] ? normalizeText(match[0]) : ""
}

/**
 * @param {string} [line]
 * @returns {string}
 */
function parseJinaBylineCandidate(line = "") {
  const text = normalizeText(line)
  if (!text || isLikelyJinaMetadataLine(text) || isRelativeDatelineToken(text)) return ""
  if (/\b(?:getty images?|afp|reuters|associated press|ap photo)\b/i.test(text)) return ""
  const explicit = text.match(/^(?:byline|author)\s*:\s*(.+)$/i)
  const normalized = normalizeText(explicit && explicit[1] ? explicit[1] : text.replace(/^(?:by|written by)\s+/i, ""))
  if (!normalized || /^(?:share|save)$/i.test(normalized)) return ""
  const truncated = normalizeText(normalized.replace(/\s*(?:\||-)\s*(?:bbc|cnn|reuters|associated press|ap)\b.*$/i, ""))
  const compact = normalizeText(truncated.replace(/,\s*(?:bbc|cnn|reuters|associated press|ap)\b.*$/i, ""))
  const ranked = compact || normalized
  const roleByline = normalized.match(
    /^([A-Z][A-Za-z.'’-]+\s+[A-Z][A-Za-z.'’-]+)(?:\s+[A-Za-z][A-Za-z.'’-]*)*\s+(?:Correspondent|Reporter|Editor|Producer|Writer|Analyst|Presenter|Contributor|Columnist)\b/i
  )
  if (roleByline && roleByline[1]) {
    return normalizeText(roleByline[1])
  }
  const commaRoleByline = ranked.match(/^([A-Z][A-Za-z.'’-]+\s+[A-Z][A-Za-z.'’-]+),\s*.+$/)
  if (commaRoleByline && commaRoleByline[1]) {
    return normalizeText(commaRoleByline[1])
  }
  const candidate = ranked
  const match = candidate.match(/^([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,3})$/)
  if (!match || !match[1]) return ""
  return normalizeText(match[1])
}

/**
 * @param {Array<{ level?: unknown, text?: unknown }>} [candidates]
 * @returns {string}
 */
function chooseBestJinaHeading(candidates = []) {
  const normalized = Array.isArray(candidates)
    ? candidates
      .map((entry) => {
        const level = Number.parseInt(String(entry?.level), 10) || 0
        const text = normalizeText(entry?.text)
        const words = text.split(/\s+/).filter(Boolean).length
        return { level, text, words }
      })
      .filter((entry) => entry.level >= 1 && Boolean(entry.text))
    : []
  if (!normalized.length) return ""
  const h1 = normalized.filter((entry) => entry.level === 1)
  const pool = h1.length ? h1 : normalized
  pool.sort((left, right) => {
    if (left.words !== right.words) return right.words - left.words
    return right.text.length - left.text.length
  })
  return pool[0]?.text || ""
}

/**
 * @param {string} [preferred]
 * @param {string} [fallback]
 * @returns {string}
 */
function chooseMoreSpecificTitle(preferred = "", fallback = "") {
  const a = normalizeText(preferred)
  const b = normalizeText(fallback)
  if (!a) return b
  if (!b) return a
  const wordsA = a.split(/\s+/).filter(Boolean).length
  const wordsB = b.split(/\s+/).filter(Boolean).length
  if (wordsA !== wordsB) return wordsA > wordsB ? a : b
  return a.length >= b.length ? a : b
}

/**
 * @param {string} [line]
 * @returns {boolean}
 */
function isLikelyJinaParagraph(line = "") {
  const text = normalizeText(line)
  if (!text || text.length < 40) return false
  if (isLikelyJinaMetadataLine(text)) return false
  if (/^(?:\d+\.\s*)?#{1,6}\s+/.test(text)) return false
  if (/^(?:title|url source|published time|updated time|last updated|markdown content)\s*:/i.test(text)) return false
  if (/^(?:published|updated|last updated|publish date)\b/i.test(text)) return false
  if (isRelativeDatelineToken(text)) return false
  if (/^(?:by|author)\s+/i.test(text)) return false
  if (/^\[.*\]\(https?:\/\/[^)]+\)\s*$/i.test(text)) return false
  if (/!\[[^\]]*\]\(https?:\/\/[^)]+\)/i.test(text)) return false
  const words = text.split(/\s+/).filter(Boolean)
  return words.length >= 8
}

/**
 * @param {string} [markdownText]
 * @returns {{ title: string, dateline: string, byline: string, firstParagraph: string }}
 */
function parseGenericJinaMarkdown(markdownText = "") {
  const allLines = normalizeText(markdownText)
    .split(/\r?\n/)
    .map((raw) => normalizeText(stripTags(raw)))
    .filter((line) => line.length > 0)
  if (!allLines.length) {
    return { title: "", dateline: "", byline: "", firstParagraph: "" }
  }
  const contentStart = allLines.findIndex((line) => /^markdown content\s*:/i.test(line))
  const contentLines = contentStart >= 0 ? allLines.slice(contentStart + 1) : allLines
  const lines = contentLines.length ? contentLines : allLines
  const headingCandidates = []
  const paragraphCandidates = []
  let titleMeta = ""
  let publishedMeta = ""
  let updatedMeta = ""
  let visiblePublish = ""
  let visibleUpdated = ""
  let relativePublish = ""
  let byline = ""
  for (const line of allLines) {
    if (!line) continue
    if (!titleMeta) {
      const titleMetaMatch = line.match(/^title:\s*(.+)$/i)
      if (titleMetaMatch && titleMetaMatch[1]) {
        titleMeta = normalizeText(titleMetaMatch[1])
      }
    }
    if (!publishedMeta) {
      const publishedMetaMatch = line.match(/^published\s*time:\s*(.+)$/i)
      if (publishedMetaMatch && publishedMetaMatch[1]) {
        publishedMeta = normalizeText(publishedMetaMatch[1])
      }
    }
    if (!updatedMeta) {
      const updatedMetaMatch = line.match(/^updated\s*time:\s*(.+)$/i)
      if (updatedMetaMatch && updatedMetaMatch[1]) {
        updatedMeta = normalizeText(updatedMetaMatch[1])
      }
    }
  }
  for (const line of lines) {
    if (!visiblePublish) {
      const publishedVisibleMatch = line.match(/^(?:published|publish date)(?!\s*time\s*:)\b[^.\n]{0,220}/i)
      if (publishedVisibleMatch && publishedVisibleMatch[0]) {
        visiblePublish = normalizeText(publishedVisibleMatch[0])
      }
    }
    if (!visibleUpdated) {
      const updatedVisibleMatch = line.match(/^(?:updated|last updated)\b[^.\n]{0,220}/i)
      if (updatedVisibleMatch && updatedVisibleMatch[0]) {
        visibleUpdated = normalizeText(updatedVisibleMatch[0])
      }
    }
    if (!relativePublish) {
      const relativeFragment = extractRelativeDatelineFragment(line)
      if (relativeFragment) relativePublish = relativeFragment
    }
    if (!byline) {
      const bylineCandidate = parseJinaBylineCandidate(line)
      if (bylineCandidate) byline = bylineCandidate
    }
    const heading = line.match(/^(?:\d+\.\s*)?(#{1,6})\s+(.+)/)
    if (heading && heading[1] && heading[2]) {
      headingCandidates.push({
        level: heading[1].length,
        text: normalizeText(heading[2]),
      })
    }
    if (isLikelyJinaParagraph(line)) {
      paragraphCandidates.push(line)
    }
  }

  const headingTitle = chooseBestJinaHeading(headingCandidates)
  const title = chooseMoreSpecificTitle(headingTitle, titleMeta)
  const firstParagraph = paragraphCandidates.find((entry) => {
    if (!entry) return false
    if (/^url source:/i.test(entry)) return false
    if (title && normalizeLower(entry) === normalizeLower(title)) return false
    return true
  }) || ""
  const publish = visiblePublish || relativePublish || publishedMeta
  const updated = visibleUpdated || updatedMeta
  const dateline = [publish, updated].filter(Boolean).join(" | ")
  return { title, dateline, byline, firstParagraph }
}

/**
 * @param {string} [link]
 * @returns {Promise<string>}
 */
async function fetchViaJinaProxy(link = "") {
  const target = normalizeHttpUrl(link)
  if (!target) throw new Error("Source link is not a valid https URL.")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(`https://r.jina.ai/${target}`, {
      headers: STUDENT_NEWS_HTTP_HEADERS,
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!response.ok) throw new Error(`Proxy fetch returned HTTP ${response.status}`)
    return await response.text()
  } catch (error) {
    clearTimeout(timeout)
    throw error
  }
}

/**
 * @param {string} [markdownText]
 * @returns {{ ok: boolean, title: string, firstParagraph: string, dateline?: { publish: string, updated: string, combined: string } }}
 */
function parseBbcLiveMarkdown(markdownText = "") {
  const lines = normalizeText(markdownText).split(/\r?\n/)
  let title = ""
  let dateline = ""
  for (const line of lines) {
    const titleMatch = line.match(/^title:\s*(.+)$/i)
    if (!title && titleMatch && titleMatch[1]) title = normalizeText(titleMatch[1])
    const timeMatch = line.match(/^published\s*time:\s*(.+)$/i)
    if (!dateline && timeMatch && timeMatch[1]) dateline = normalizeText(timeMatch[1])
    if (title && dateline) break
  }

  let headingText = ""
  let firstParagraph = ""
  for (const raw of lines) {
    const line = raw.trim()
    if (!headingText) {
      const headingMatch = line.match(/^(?:\d+\.\s*)?(#+)\s+(.+)/)
      if (headingMatch && headingMatch[2]) {
        headingText = normalizeText(headingMatch[2])
        if (!title) title = headingText
        continue
      }
    }
    if (headingText && !firstParagraph) {
      if (!line) continue
      if (/^!\[.*\]\(.+\)/.test(line)) continue
      if (/^(?:\d+\.\s*)?(#+)\s+/.test(line)) continue
      firstParagraph = normalizeText(line)
      break
    }
  }

  return {
    ok: Boolean(title || firstParagraph || dateline),
    title,
    firstParagraph,
    dateline: dateline
      ? {
          publish: dateline,
          updated: "",
          combined: dateline,
        }
      : undefined,
  }
}

/**
 * @param {string} [value]
 * @returns {Set<string>}
 */
function tokenizeForSimilarity(value = "") {
  return new Set(
    normalizeLower(value)
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((entry) => normalizeText(entry))
      .filter((entry) => entry.length >= 2)
  )
}

/**
 * @param {string} [left]
 * @param {string} [right]
 * @returns {number}
 */
export function studentNewsTextSimilarityScore(left = "", right = "") {
  const a = normalizeLower(left)
  const b = normalizeLower(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if ((a.length >= 16 && b.includes(a)) || (b.length >= 16 && a.includes(b))) {
    return 0.92
  }
  const tokensA = tokenizeForSimilarity(a)
  const tokensB = tokenizeForSimilarity(b)
  if (!tokensA.size || !tokensB.size) return 0
  let intersection = 0
  tokensA.forEach((token) => {
    if (tokensB.has(token)) intersection += 1
  })
  const union = tokensA.size + tokensB.size - intersection
  if (union <= 0) return 0
  return intersection / union
}

function normalizeNewsComparableText(value = "") {
  return normalizeLower(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function newsComparableTextMatches(left = "", right = "") {
  const a = normalizeNewsComparableText(left)
  const b = normalizeNewsComparableText(right)
  if (!a || !b) return false
  return a === b || (a.length >= 16 && b.includes(a)) || (b.length >= 16 && a.includes(b))
}

/**
 * @param {string} [sourceLink]
 * @returns {string}
 */
function inferSourceOrganization(sourceLink = "") {
  const host = hostnameFromUrl(sourceLink)
  if (!host) return ""
  const parts = host.split(".").filter(Boolean)
  if (!parts.length) return ""
  if (parts.length === 1) return parts[0]
  return parts[parts.length - 2]
}

/**
 * @param {number} [statusCode]
 * @param {string} [message]
 * @param {Record<string, unknown>} [payload]
 * @returns {Error & { statusCode?: number, payload?: Record<string, unknown> }}
 */
function statusErrorWithPayload(statusCode = 500, message = "Request failed", payload = {}) {
  /** @type {Error & { statusCode?: number, payload?: Record<string, unknown> }} */
  const error = new Error(normalizeText(message) || "Request failed")
  error.statusCode = statusCode
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    error.payload = payload
  }
  return error
}

/**
 * @param {string} [fieldKey]
 * @param {Record<string, unknown> | null | undefined} [entry]
 * @returns {{
 *   field: string,
 *   label: string,
 *   status: string,
 *   message: string,
 *   criterion: string,
 *   steps: string[],
 *   score: number | null,
 *   threshold: number | null,
 *   updatedAt: string,
 * } | null}
 */
function normalizeValidationIssueEntry(fieldKey = "", entry = {}) {
  const key = normalizeText(fieldKey)
  if (!key) return null
  const source = entry && typeof entry === "object" ? entry : {}
  const status = normalizeLower(source.status) === "fixed" ? "fixed" : "pending"
  const steps = Array.isArray(source.steps)
    ? source.steps.map((item) => normalizeText(item)).filter(Boolean)
    : []
  const sentenceIssues = Array.isArray(source.sentenceIssues)
    ? source.sentenceIssues.map((issue) => ({
      ruleId: normalizeText(issue?.ruleId),
      start: Math.max(0, Number.parseInt(String(issue?.start), 10) || 0),
      length: Math.max(1, Number.parseInt(String(issue?.length), 10) || 1),
      message: normalizeText(issue?.message),
      replacements: Array.isArray(issue?.replacements) ? issue.replacements.map((value) => normalizeText(value)).filter(Boolean).slice(0, 5) : [],
      blocking: issue?.blocking !== false,
    })).filter((issue) => issue.ruleId && issue.message)
    : []
  return {
    field: key,
    label: normalizeText(source.label || STUDENT_NEWS_FIELD_LABELS[key] || key),
    status,
    message: normalizeText(source.message),
    criterion: normalizeText(source.criterion),
    steps,
    score: Number.isFinite(Number(source.score)) ? Number(source.score) : null,
    threshold: Number.isFinite(Number(source.threshold)) ? Number(source.threshold) : null,
    ruleIds: [...new Set([
      ...(Array.isArray(source.ruleIds) ? source.ruleIds.map((ruleId) => normalizeText(ruleId)) : []),
      ...sentenceIssues.map((issue) => issue.ruleId),
    ].filter(Boolean))],
    sentenceIssues,
    updatedAt: parseDateOrNull(source.updatedAt)?.toISOString?.() || nowIso(),
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} [value]
 * @returns {Record<string, ReturnType<typeof normalizeValidationIssueEntry>>}
 */
export function normalizeValidationIssueMap(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {}
  const normalized = {}
  Object.keys(source).forEach((fieldKey) => {
    const entry = normalizeValidationIssueEntry(fieldKey, source[fieldKey])
    if (entry) normalized[fieldKey] = entry
  })
  return normalized
}

/**
 * @param {string} [note]
 * @returns {string}
 */
export function stripAwaitingReReviewMarker(note = "") {
  return normalizeText(String(note || "").replaceAll(STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER, ""))
}

/**
 * @param {string} [note]
 * @returns {string}
 */
export function addAwaitingReReviewMarker(note = "") {
  const clean = stripAwaitingReReviewMarker(note)
  if (!clean) return STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER
  return `${clean}\n${STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER}`
}

/**
 * @param {string} [note]
 * @returns {boolean}
 */
function hasAwaitingReReviewMarker(note = "") {
  return normalizeText(note).includes(STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER)
}

/**
 * @param {Record<string, unknown> | null | undefined} [row]
 * @returns {boolean}
 */
export function resolveStudentNewsAwaitingReReview(row = {}) {
  if (
    normalizeStudentNewsReviewStatus(row?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED)
    !== STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
  ) {
    return false
  }
  if (row?.awaitingReReview === true) return true
  return hasAwaitingReReviewMarker(row?.reviewNote)
}

/**
 * @param {string} [note]
 * @returns {string}
 */
function stripComplianceBlockFromReviewNote(note = "") {
  const text = stripAwaitingReReviewMarker(note)
  if (!text) return ""
  const escapedStart = STUDENT_NEWS_COMPLIANCE_NOTE_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const escapedEnd = STUDENT_NEWS_COMPLIANCE_NOTE_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const blockRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, "g")
  return normalizeText(text.replace(blockRegex, " ").replace(/\n{3,}/g, "\n\n"))
}

/**
 * @param {Record<string, unknown> | null | undefined} [issueMap]
 * @returns {string}
 */
export function buildStudentNewsComplianceBlock(issueMap = {}) {
  const normalized = normalizeValidationIssueMap(issueMap)
  const fields = Object.keys(normalized)
  if (!fields.length) return ""
  const lines = fields
    .sort((left, right) => left.localeCompare(right))
    .map((fieldKey) => {
      const entry = normalized[fieldKey]
      const label = normalizeText(entry?.label || STUDENT_NEWS_FIELD_LABELS[fieldKey] || fieldKey)
      if (entry?.status === "fixed") {
        return `- [FIXED][${fieldKey}] ${STUDENT_NEWS_FIXED_NOTE_PREFIX} - ${label} now meets compliance criteria.`
      }
      const steps = Array.isArray(entry?.steps) && entry.steps.length
        ? entry.steps.map((step, index) => `Step ${index + 1}: ${normalizeText(step)}`).join(" ")
        : "Step 1: update this field to match the source article and save again."
      const criterion = normalizeText(entry?.criterion)
      const score = Number.isFinite(Number(entry?.score)) ? Number(entry.score).toFixed(2) : ""
      const threshold = Number.isFinite(Number(entry?.threshold)) ? Number(entry.threshold).toFixed(2) : ""
      const scoreToken = score && threshold ? ` (score ${score} < ${threshold})` : ""
      return `- [PENDING][${fieldKey}] ${label}: ${normalizeText(entry?.message)}${scoreToken}${criterion ? ` | Criteria: ${criterion}` : ""} | ${steps}`
    })
  return [STUDENT_NEWS_COMPLIANCE_NOTE_START, ...lines, STUDENT_NEWS_COMPLIANCE_NOTE_END].join("\n")
}

/**
 * @param {string} [existingReviewNote]
 * @param {Record<string, unknown> | null | undefined} [issueMap]
 * @returns {string}
 */
export function mergeStudentNewsReviewNoteWithCompliance(existingReviewNote = "", issueMap = {}) {
  const manual = stripComplianceBlockFromReviewNote(existingReviewNote)
  const complianceBlock = buildStudentNewsComplianceBlock(issueMap)
  if (manual && complianceBlock) return `${manual}\n\n${complianceBlock}`
  if (complianceBlock) return complianceBlock
  return manual
}

async function fetchStudentNewsArticleMetadata(sourceLink = "") {
  const link = normalizeHttpUrl(sourceLink)
  if (!link) {
    return {
      ok: false,
      error: "Source link is not a valid https URL.",
      sourceLink: normalizeText(sourceLink),
    }
  }
  const hostname = hostnameFromUrl(link)
  const isBbcDomain = Boolean(hostname && hostname.endsWith("bbc.com"))
  const isCnnDomain = Boolean(hostname && hostname.endsWith("cnn.com"))
  const bbcLive = isBbcLiveUrl(link)
  let primaryError = ""
  let primaryMetadata = null

  async function attemptHtmlFetch(url, viaLabel = "primary") {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 12000)
      const response = await fetch(url, {
        redirect: "follow",
        headers: STUDENT_NEWS_HTTP_HEADERS,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (response.ok) {
        const html = await response.text()
        const plainText = stripTags(html)
        return {
          ok: true,
          via: viaLabel,
          sourceLink: url,
          hostname: hostnameFromUrl(url) || hostname,
          title: extractTitleFromHtml(html),
          byline: extractBylineFromHtml(html, plainText),
          dateline: extractDatelineSnippets(html, plainText),
          firstParagraph: extractFirstParagraphFromHtml(html),
        }
      }
      return {
        ok: false,
        error: `Source URL returned HTTP ${response.status}.`,
      }
    } catch (error) {
      return {
        ok: false,
        error: normalizeText(error?.message) || "Unable to fetch source article metadata.",
      }
    }
  }

  const primaryAttempt = await attemptHtmlFetch(link, "primary")
  if (primaryAttempt?.ok) {
    primaryMetadata = primaryAttempt
  } else {
    primaryError = primaryAttempt?.error || "Unable to fetch source article metadata."
  }

  let fallbackMetadata = null
  let fallbackError = ""
  const primaryDatelineCombined = normalizeText(primaryMetadata?.dateline?.combined)
  const needsAuthorDatelineEnrichment = (isBbcDomain || isCnnDomain)
    && !bbcLive
    && (!normalizeText(primaryMetadata?.byline) || !primaryDatelineCombined)
  const needsFallback = (
    !primaryMetadata?.ok
    || !primaryMetadata?.title
    || !primaryMetadata?.firstParagraph
    || needsAuthorDatelineEnrichment
  )
  const fallbackNeedsAuthorDateline = (candidate = {}) =>
    needsAuthorDatelineEnrichment
    && (
      !normalizeText(candidate?.byline)
      || !normalizeText(candidate?.dateline?.combined)
    )

  if (needsFallback) {
    const variantCandidates = []
    if (isBbcDomain) variantCandidates.push({ url: resolveBbcAmpUrl(link), via: "bbc-amp" })
    if (isCnnDomain) variantCandidates.push({ url: resolveCnnAmpUrl(link), via: "cnn-amp" })
    let bestVariantCandidate = null

    for (const candidate of variantCandidates) {
      if (!candidate?.url || candidate.url === link) continue
      const attempt = await attemptHtmlFetch(candidate.url, candidate.via)
      if (attempt?.ok && attempt?.title && attempt?.firstParagraph) {
        if (!bestVariantCandidate) bestVariantCandidate = attempt
        if (!fallbackNeedsAuthorDateline(attempt)) {
          fallbackMetadata = attempt
          break
        }
      }
      if (!fallbackError && attempt?.error) fallbackError = attempt.error
    }
    if (!fallbackMetadata?.ok && bestVariantCandidate?.ok) {
      fallbackMetadata = bestVariantCandidate
    }
  }

  if ((needsFallback && (!fallbackMetadata?.ok || fallbackNeedsAuthorDateline(fallbackMetadata))) && bbcLive) {
    try {
      const proxyBody = await fetchViaJinaProxy(link)
      const parsed = parseBbcLiveMarkdown(proxyBody)
      if (parsed.ok) {
        const seed = fallbackMetadata?.ok ? fallbackMetadata : primaryMetadata
        const seedDateline = normalizeText(seed?.dateline?.combined)
        fallbackMetadata = {
          ok: true,
          via: seed?.ok ? "primary+bbc-live-fallback" : "bbc-live-fallback",
          sourceLink: link,
          hostname,
          title: chooseMoreSpecificTitle(parsed.title, seed?.title),
          byline: normalizeText(seed?.byline) || "",
          dateline: seedDateline
            ? seed.dateline
            : (parsed.dateline || { publish: "", updated: "", combined: "" }),
          firstParagraph: parsed.firstParagraph || seed?.firstParagraph || "",
        }
      } else {
        fallbackError = "BBC liveblog fallback did not return usable content."
      }
    } catch (error) {
      fallbackError = normalizeText(error?.message) || "BBC liveblog fallback fetch failed."
    }
  }

  if ((needsFallback && (!fallbackMetadata?.ok || fallbackNeedsAuthorDateline(fallbackMetadata))) && (isBbcDomain || isCnnDomain)) {
    try {
      const proxyBody = await fetchViaJinaProxy(link)
      const parsed = parseGenericJinaMarkdown(proxyBody)
      if (parsed.title || parsed.firstParagraph || parsed.byline || parsed.dateline) {
        const seed = fallbackMetadata?.ok ? fallbackMetadata : primaryMetadata
        const proxyDateline = normalizeText(parsed.dateline)
        const seedDateline = normalizeText(seed?.dateline?.combined)
        let resolvedDateline = seed?.dateline || { publish: "", updated: "", combined: "" }
        if (proxyDateline) {
          resolvedDateline = {
            publish: proxyDateline,
            updated: "",
            combined: proxyDateline,
          }
        } else if (!seedDateline) {
          resolvedDateline = { publish: "", updated: "", combined: "" }
        }
        fallbackMetadata = {
          ok: true,
          via: seed?.ok ? "primary+proxy" : "proxy",
          sourceLink: link,
          hostname,
          title: chooseMoreSpecificTitle(parsed.title, seed?.title),
          byline: normalizeText(parsed.byline) || normalizeText(seed?.byline) || "",
          dateline: resolvedDateline,
          firstParagraph: parsed.firstParagraph || seed?.firstParagraph || "",
        }
      } else {
        fallbackError = "Proxy fetch returned no usable content."
      }
    } catch (error) {
      fallbackError = normalizeText(error?.message) || "Proxy fetch failed."
    }
  }

  const chosen = fallbackMetadata?.ok ? fallbackMetadata : primaryMetadata
  const ok = Boolean(chosen?.ok)
  if (ok) {
    return {
      ...chosen,
      via: chosen?.via || (fallbackMetadata?.ok ? fallbackMetadata.via : "primary"),
      primaryError: primaryError || undefined,
      fallbackError: fallbackError || undefined,
    }
  }

  return {
    ok: false,
    error: fallbackError || primaryError || "Unable to fetch source article metadata.",
    sourceLink: link,
    hostname,
    via: fallbackMetadata ? fallbackMetadata.via : "primary",
    primaryError: primaryError || undefined,
    fallbackError: fallbackError || undefined,
  }
}

function buildStudentNewsFieldRevisionTask(fieldKey = "", context = {}) {
  const allowedSourcesText = Array.isArray(context?.allowedDomains) && context.allowedDomains.length
    ? context.allowedDomains.join(", ")
    : STUDENT_NEWS_DEFAULT_ALLOWED_SOURCE_DOMAINS.join(", ")
  if (fieldKey === "sourceLink") {
    return {
      field: fieldKey,
      label: STUDENT_NEWS_FIELD_LABELS[fieldKey],
      steps: [
        `Open the real article page from an approved source: ${allowedSourcesText}.`,
        "Do not use only the site home page such as bbc.com or cnn.com.",
        "Copy the full web address for that article and paste it again.",
      ],
      criterion: `Hostname must match approved sources (${allowedSourcesText}) and the URL must open a specific article page.`,
    }
  }
  if (fieldKey === "articleTitle") {
    return {
      field: fieldKey,
      label: STUDENT_NEWS_FIELD_LABELS[fieldKey],
      steps: [
        "Copy the article headline exactly as displayed on the source page.",
        "Remove extra words that are not in the headline.",
        "Save again after title text matches the source.",
      ],
      criterion: "Blocking check: normalized headline must match the fetched source headline exactly or by containment; otherwise similarity must be at least 0.70.",
    }
  }
  if (fieldKey === "byline") {
    return {
      field: fieldKey,
      label: STUDENT_NEWS_FIELD_LABELS[fieldKey],
      steps: [
        "Use the article author name as shown on the source page.",
        "If author is not listed, use the source organization/domain name (for example: bbc or cnn).",
        "Save again after byline matches author/organization.",
      ],
      criterion: "Byline similarity must be at least 0.70.",
    }
  }
  if (fieldKey === "articleDateline") {
    return {
      field: fieldKey,
      label: STUDENT_NEWS_FIELD_LABELS[fieldKey],
      steps: [
        "Enter the visible publish timestamp from the source page.",
        "If the page shows Updated timestamp, include it in the dateline text.",
        "If timezone text is used, include full timezone text and GMT offset (example: GMT+7).",
      ],
      criterion: "Blocking check: visible publish/updated date line must match the fetched source dateline and include required updated/timezone tokens.",
    }
  }
  if (fieldKey === "actionActor") {
    return {
      field: fieldKey,
      label: "Who/what did Action?",
      steps: [
        "Identify who or what performed the main action in the article.",
        "Use a clear noun or noun phrase.",
        "Save again after adding the actor phrase.",
      ],
      criterion: "Must contain at least one noun or noun phrase.",
    }
  }
  if (fieldKey === "actionAffected") {
    return {
      field: fieldKey,
      label: "Who/what was Affected by Action?",
      steps: [
        "Identify who or what received impact from the action.",
        "Use a clear noun or noun phrase.",
        "Save again after adding the affected entity.",
      ],
      criterion: "Must contain at least one noun or noun phrase.",
    }
  }
  if (fieldKey === "actionWhere") {
    return {
      field: fieldKey,
      label: "Where did Action take place?",
      steps: [
        "Enter the location of the event from the source article.",
        "Include at least a city or country.",
        "Save again after adding the location.",
      ],
      criterion: "Must include a location phrase (city/country/place).",
    }
  }
  if (fieldKey === "actionWhat") {
    return {
      field: fieldKey,
      label: "What Action Occurred?",
      steps: [
        "Describe the action in one complete sentence.",
        "Keep the sentence factual and source-aligned.",
        "Save again after updating the action sentence.",
      ],
      criterion: "Must be at least one sentence.",
    }
  }
  if (fieldKey === "actionWhy") {
    return {
      field: fieldKey,
      label: "Why did Action happen?",
      steps: [
        "Explain why the event happened in one complete sentence.",
        "Use source-supported reasons only.",
        "Save again after updating the why sentence.",
      ],
      criterion: "Must be at least one sentence.",
    }
  }
  if (fieldKey === "biasAssessment") {
    return {
      field: fieldKey,
      label: "Bias Assessment",
      steps: [
        "Write one clear sentence evaluating bias/spin in the report.",
        "Reference wording, framing, or omitted context.",
        "Save again after adding the bias sentence.",
      ],
      criterion: "Must be at least one sentence.",
    }
  }
  if (fieldKey === "vocabulary") {
    return {
      field: fieldKey,
      label: "Vocabulary",
      steps: [
        "Complete every vocabulary row with part of speech, English, Vietnamese, syllabication, and definition.",
        "Do mark one stress only when a space-separated phrase contains a hyphenated multi-syllable word, such as in the MÓRN-ing; do not add stress to one-syllable phrases or compound words such as air-strike.",
        "Save again after correcting the named entry and its highlighted field.",
      ],
      criterion: "Every vocabulary row must be complete and use valid syllabication.",
    }
  }
  return {
    field: fieldKey,
    label: STUDENT_NEWS_FIELD_LABELS[fieldKey] || fieldKey,
    steps: [
      "Summarize only the first paragraph of the source article.",
      "Keep key facts and wording aligned with the source lead paragraph.",
      "Save again after synopsis reflects the source lead.",
    ],
    criterion: "Lead synopsis similarity must be at least 0.50.",
  }
}

function shouldRequireGmtOffset(datelineText = "") {
  const text = normalizeLower(datelineText)
  if (!text) return false
  return /(timezone|time zone|gmt|utc|ict|est|edt|pst|pdt|cst|bst)/i.test(text)
}

function hasTimezoneLiteral(datelineText = "") {
  const text = normalizeLower(datelineText)
  if (!text) return false
  return /\b(?:ict|est|edt|pst|pdt|cst|cdt|bst|cet|cest|ist|jst|aest|aedt|utc|gmt)\b/i.test(text)
}

function hasTimezoneDescriptor(datelineText = "") {
  const text = normalizeLower(datelineText)
  if (!text) return false
  return (
    /\b(?:timezone|time zone)\b/i.test(text)
    || /\b(?:indochina|eastern|pacific|central|british|coordinated universal|greenwich mean)\s+time\b/i.test(text)
    || /\([^)]*\btime\b[^)]*\)/i.test(text)
  )
}

function hasTimezoneOffset(datelineText = "") {
  const text = normalizeLower(datelineText)
  if (!text) return false
  return /\b(?:gmt|utc)\s*[+-]\s*\d{1,2}(?::?\d{2})?\b/i.test(text)
}

function parseRelativeDatelineToken(value = "") {
  const fragment = extractRelativeDatelineFragment(value)
  const text = normalizeLower(fragment)
  if (!text) return null
  const match = text.match(/\b(\d+)\s*(minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/i)
  if (!match || !match[1] || !match[2]) return null
  const amount = Number.parseInt(match[1], 10)
  if (!Number.isFinite(amount) || amount < 0) return null
  const rawUnit = normalizeLower(match[2]).replace(/s$/, "")
  const supportedUnits = new Set(["minute", "hour", "day", "week", "month", "year"])
  if (!supportedUnits.has(rawUnit)) return null
  return { amount, unit: rawUnit }
}

function relativeDatelineToMinutes(value = "") {
  const token = parseRelativeDatelineToken(value)
  if (!token) return Number.NaN
  const multipliers = {
    minute: 1,
    hour: 60,
    day: 60 * 24,
    week: 60 * 24 * 7,
    month: 60 * 24 * 30,
    year: 60 * 24 * 365,
  }
  const unitMinutes = multipliers[token.unit]
  if (!Number.isFinite(unitMinutes)) return Number.NaN
  return token.amount * unitMinutes
}

function monthTokenToNumber(token = "") {
  const value = normalizeLower(token).replace(/\.$/, "")
  if (value.startsWith("jan")) return 1
  if (value.startsWith("feb")) return 2
  if (value.startsWith("mar")) return 3
  if (value.startsWith("apr")) return 4
  if (value === "may") return 5
  if (value.startsWith("jun")) return 6
  if (value.startsWith("jul")) return 7
  if (value.startsWith("aug")) return 8
  if (value.startsWith("sep")) return 9
  if (value.startsWith("oct")) return 10
  if (value.startsWith("nov")) return 11
  if (value.startsWith("dec")) return 12
  return 0
}

function dateKeyFromParts(year = 0, month = 0, day = 0) {
  const y = Number.parseInt(String(year), 10)
  const m = Number.parseInt(String(month), 10)
  const d = Number.parseInt(String(day), 10)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ""
  if (y < 1900 || y > 2300 || m < 1 || m > 12 || d < 1 || d > 31) return ""
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

function localTodayDateKey() {
  const now = new Date()
  return dateKeyFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

function dateKeyToUtcMs(key = "") {
  const normalized = normalizeText(key)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return Number.NaN
  const [year, month, day] = normalized.split("-").map((part) => Number.parseInt(part, 10))
  if (
    !Number.isFinite(year)
    || !Number.isFinite(month)
    || !Number.isFinite(day)
    || month < 1
    || month > 12
    || day < 1
    || day > 31
  ) {
    return Number.NaN
  }
  return Date.UTC(year, month - 1, day)
}

function hasDateKeyNearLocalToday(dateKeys = [], windowDays = 0) {
  const keys = Array.isArray(dateKeys)
    ? dateKeys.map((entry) => normalizeText(entry)).filter(Boolean)
    : []
  if (!keys.length) return false
  const spanDays = Number.parseInt(String(windowDays), 10)
  const spanMs = Math.max(0, Number.isFinite(spanDays) ? spanDays : 0) * 24 * 60 * 60 * 1000
  const todayMs = dateKeyToUtcMs(localTodayDateKey())
  if (!Number.isFinite(todayMs)) return false
  return keys.some((key) => {
    const value = dateKeyToUtcMs(key)
    return Number.isFinite(value) && Math.abs(value - todayMs) <= spanMs
  })
}

function haveDateKeysWithinDays(leftKeys = [], rightKeys = [], windowDays = 0) {
  const left = Array.isArray(leftKeys)
    ? leftKeys.map((entry) => normalizeText(entry)).filter(Boolean)
    : []
  const right = Array.isArray(rightKeys)
    ? rightKeys.map((entry) => normalizeText(entry)).filter(Boolean)
    : []
  if (!left.length || !right.length) return false
  const spanDays = Number.parseInt(String(windowDays), 10)
  const spanMs = Math.max(0, Number.isFinite(spanDays) ? spanDays : 0) * 24 * 60 * 60 * 1000
  const leftValues = left.map((key) => dateKeyToUtcMs(key)).filter((value) => Number.isFinite(value))
  const rightValues = right.map((key) => dateKeyToUtcMs(key)).filter((value) => Number.isFinite(value))
  if (!leftValues.length || !rightValues.length) return false
  return leftValues.some((leftValue) =>
    rightValues.some((rightValue) => Math.abs(leftValue - rightValue) <= spanMs)
  )
}

function extractDateKeysFromDatelineText(value = "") {
  const text = normalizeText(value)
  if (!text) return []
  const keys = new Set()

  const isoRegex = /(\d{4})-(\d{2})-(\d{2})(?=[T\s]|$|[^\d])/g
  for (const match of text.matchAll(isoRegex)) {
    const key = dateKeyFromParts(match[1], match[2], match[3])
    if (key) keys.add(key)
  }

  const monthFirstRegex =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})\b/gi
  for (const match of text.matchAll(monthFirstRegex)) {
    const month = monthTokenToNumber(match[1])
    const key = dateKeyFromParts(match[3], month, match[2])
    if (key) keys.add(key)
  }

  const dayFirstRegex =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/gi
  for (const match of text.matchAll(dayFirstRegex)) {
    const month = monthTokenToNumber(match[2])
    const key = dateKeyFromParts(match[3], month, match[1])
    if (key) keys.add(key)
  }

  return [...keys]
}

function hasNounLikePhrase(value = "") {
  const text = normalizeText(value)
  if (!text) return false
  const tokens = text
    .replace(/[^A-Za-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
  return tokens.length >= 1
}

const STUDENT_NEWS_SENTENCE_RULES = Object.freeze({
  capitalization: "sentence-capitalization",
  punctuation: "sentence-punctuation",
  spelling: "sentence-spelling",
  subjectVerbAgreement: "subject-verb-agreement",
  tenseConsistency: "verb-tense-consistency",
  parallelStructure: "parallel-structure",
  clauseFragment: "clause-fragment",
  sentenceType: "sentence-type",
  conjunctionUse: "conjunction-use",
  determinerUse: "determiner-use",
  adjectiveUse: "adjective-use",
  adverbUse: "adverb-use",
})

const STUDENT_NEWS_COMMON_SPELLING_ERRORS = Object.freeze({
  accomodate: "accommodate",
  definately: "definitely",
  enviroment: "environment",
  goverment: "government",
  occured: "occurred",
  recieve: "receive",
  seperate: "separate",
  becuase: "because",
})

const STUDENT_NEWS_VERIFIED_COMPOUND_SYLLABICATIONS = Object.freeze({
  "air-conditioning": "air-con-di-tion-ing",
  "thirty-seven": "THIR-ty-SEV-en",
  "runner-up": "RUN-ner-up",
})

const STUDENT_NEWS_IRREGULAR_PAST_VERBS = new Set([
  "was", "were", "had", "did", "went", "saw", "made", "took", "gave", "came", "became",
])

const STUDENT_NEWS_PRESENT_VERBS = new Set([
  "am", "is", "are", "has", "have", "do", "does", "go", "goes", "make", "makes", "take", "takes",
  "give", "gives", "come", "comes", "become", "becomes", "act", "acts", "report", "reports",
  "say", "says", "show", "shows", "need", "needs", "cause", "causes", "affect", "affects",
])

const STUDENT_NEWS_PAST_TIME_MARKERS = /\b(?:yesterday|last\s+(?:week|month|year|night)|ago|earlier)\b/iu
const STUDENT_NEWS_FUTURE_TIME_MARKERS = /\b(?:tomorrow|next\s+(?:week|month|year))\b/iu

function studentNewsSentenceWords(value = "") {
  const raw = String(value == null ? "" : value)
  return Array.from(raw.matchAll(/\b[A-Za-z]+(?:'[A-Za-z]+)?\b/gu)).map((match) => ({
    text: match[0],
    lower: match[0].toLocaleLowerCase("en-US"),
    start: match.index || 0,
    length: match[0].length,
  }))
}

function studentNewsIssue(ruleId, start, length, message) {
  return {
    code: ruleId,
    ruleId,
    severity: "blocking",
    source: "internal",
    start: Math.max(0, Number(start) || 0),
    length: Math.max(1, Number(length) || 1),
    message: String(message || "").trim(),
  }
}

export function classifyStudentNewsSentence(value = "") {
  return parseStudentNewsSentence(value).classification
}

function buildStudentNewsGrammarIssues(raw) {
  const text = String(raw == null ? "" : raw)
  const trimmed = text.trim()
  if (!trimmed) return []
  const startOffset = text.indexOf(trimmed)
  const words = studentNewsSentenceWords(text)
  const parsed = parseStudentNewsSentence(text)
  const issues = []
  const firstLetterOffset = trimmed.search(/[A-Za-z]/u)
  if (firstLetterOffset >= 0 && /[a-z]/u.test(trimmed[firstLetterOffset])) {
    issues.push(studentNewsIssue(
      STUDENT_NEWS_SENTENCE_RULES.capitalization,
      startOffset + firstLetterOffset,
      1,
      "Start the sentence with a capital letter.",
    ))
  }
  if (!/[.!?]$/u.test(trimmed)) {
    issues.push(studentNewsIssue(
      STUDENT_NEWS_SENTENCE_RULES.punctuation,
      startOffset + Math.max(0, trimmed.length - 1),
      1,
      "End the sentence with a full stop, question mark, or exclamation mark.",
    ))
  }
  if (words.length < 3) {
    issues.push(studentNewsIssue(
      STUDENT_NEWS_SENTENCE_RULES.clauseFragment,
      startOffset,
      Math.max(1, trimmed.length),
      "This is a fragment; include a subject and a finite verb in a complete clause.",
    ))
  }
  const leadingSubordinator = /^(because|although|while|when|if|since|after|before|unless)\b/iu.exec(trimmed)
  if (leadingSubordinator && parsed.clauses.some((clause) => clause.clauseType === "subordinate") && !parsed.clauses.some((clause) => clause.independent)) {
    issues.push(studentNewsIssue(
      STUDENT_NEWS_SENTENCE_RULES.clauseFragment,
      startOffset + parsed.clauses[0].start,
      Math.max(1, parsed.clauses[0].end - parsed.clauses[0].start),
      "This subordinate clause contains a subject and finite verb but no independent main clause; connect it to an independent clause.",
    ))
  }

  words.forEach((word) => {
    const correction = STUDENT_NEWS_COMMON_SPELLING_ERRORS[word.lower]
    if (!correction) return
    issues.push(studentNewsIssue(
      STUDENT_NEWS_SENTENCE_RULES.spelling,
      word.start,
      word.length,
      `Possible spelling error in “${word.text}”.`,
    ))
  })

  const addWordIssue = (ruleId, word, message) => {
    if (word) issues.push(studentNewsIssue(ruleId, word.start, word.length, message))
  }
  for (let index = 0; index < words.length - 1; index += 1) {
    const subject = words[index]
    const verb = words[index + 1]
    if (["he", "she", "it"].includes(subject.lower) && ["are", "were", "have", "do", "go", "need", "say"].includes(verb.lower)) {
      addWordIssue(STUDENT_NEWS_SENTENCE_RULES.subjectVerbAgreement, verb, `The subject “${subject.text}” requires a singular verb form.`)
    }
    if (["they", "we", "you"].includes(subject.lower) && ["is", "was", "has", "does", "goes", "needs", "says"].includes(verb.lower)) {
      addWordIssue(STUDENT_NEWS_SENTENCE_RULES.subjectVerbAgreement, verb, `The subject “${subject.text}” requires a plural or non-third-person verb form.`)
    }
    if (subject.lower === "i" && ["is", "are", "has", "does"].includes(verb.lower)) {
      addWordIssue(STUDENT_NEWS_SENTENCE_RULES.subjectVerbAgreement, verb, `The subject “${subject.text}” does not agree with “${verb.text}”.`)
    }
    if (subject.lower === "a" && ["apple", "event", "official", "action", "article", "error"].includes(verb.lower)) {
      addWordIssue(STUDENT_NEWS_SENTENCE_RULES.determinerUse, subject, `Use “an” before the vowel sound in “${verb.text}”.`)
    }
    if (subject.lower === "an" && ["boy", "car", "student", "report", "government"].includes(verb.lower)) {
      addWordIssue(STUDENT_NEWS_SENTENCE_RULES.determinerUse, subject, `Use “a” before the consonant sound in “${verb.text}”.`)
    }
  }

  if (STUDENT_NEWS_PAST_TIME_MARKERS.test(trimmed)) {
    const present = words.find((word) => STUDENT_NEWS_PRESENT_VERBS.has(word.lower))
    if (present) addWordIssue(STUDENT_NEWS_SENTENCE_RULES.tenseConsistency, present, `The past-time marker requires a consistent past-tense verb near “${present.text}”.`)
  }
  if (STUDENT_NEWS_FUTURE_TIME_MARKERS.test(trimmed)) {
    const past = words.find((word) => STUDENT_NEWS_IRREGULAR_PAST_VERBS.has(word.lower))
    if (past) addWordIssue(STUDENT_NEWS_SENTENCE_RULES.tenseConsistency, past, `The future-time marker requires a consistent future construction near “${past.text}”.`)
  }

  const commaSplice = /\b(?:is|are|was|were|has|have|did|does|do|[A-Za-z]+ed)\b\s*,\s+[A-Za-z]+\s+(?:is|are|was|were|has|have|did|does|do|[A-Za-z]+(?:s|ed))\b/gu.exec(trimmed)
  if (commaSplice && !/\b(?:and|but|or|so|yet|for|nor)\b/iu.test(commaSplice[0])) {
    const commaOffset = startOffset + commaSplice.index + commaSplice[0].indexOf(",")
    issues.push(studentNewsIssue(STUDENT_NEWS_SENTENCE_RULES.sentenceType, commaOffset, 1, "Separate two independent clauses with a conjunction or stronger punctuation."))
  }
  if (/\b(?:to\s+\w+\s+and\s+\w+ing|\w+ing\s+and\s+to\s+\w+)\b/iu.test(trimmed)) {
    const match = /\b(?:to\s+\w+\s+and\s+\w+ing|\w+ing\s+and\s+to\s+\w+)\b/iu.exec(trimmed)
    issues.push(studentNewsIssue(STUDENT_NEWS_SENTENCE_RULES.parallelStructure, startOffset + (match?.index || 0), match?.[0]?.length || 1, "Use matching grammatical forms for the coordinated actions."))
  }
  if (/^(?:and|but|because|so)\b/iu.test(trimmed)) {
    issues.push(studentNewsIssue(STUDENT_NEWS_SENTENCE_RULES.conjunctionUse, startOffset, words[0]?.length || 1, "Begin with this conjunction only when it clearly connects to a preceding clause."))
  }
  if (/\b(?:very quickly|quickly very|extremely sudden)\b/iu.test(trimmed)) {
    const match = /\b(?:very quickly|quickly very|extremely sudden)\b/iu.exec(trimmed)
    issues.push(studentNewsIssue(STUDENT_NEWS_SENTENCE_RULES.adverbUse, startOffset + (match?.index || 0), match?.[0]?.length || 1, "Place the adverb next to the verb or adjective it modifies."))
  }
  if (/\b(?:a|an)\s+(?:quickly|slowly|carefully)\b/iu.test(trimmed)) {
    const match = /\b(?:a|an)\s+(?:quickly|slowly|carefully)\b/iu.exec(trimmed)
    issues.push(studentNewsIssue(STUDENT_NEWS_SENTENCE_RULES.adjectiveUse, startOffset + (match?.index || 0), match?.[0]?.length || 1, "Use an adjective after the determiner when the noun is being described."))
  }
  return issues.sort((left, right) => left.start - right.start || left.ruleId.localeCompare(right.ruleId))
}

/**
 * Return deterministic, range-based sentence findings for the two fields
 * that explicitly require complete sentences. Suggestions are intentionally
 * excluded: students receive the raw sentence and explanatory comments.
 *
 * @param {unknown} value
 * @returns {Array<{ ruleId: string, start: number, length: number, message: string }>}
 */
export function buildStudentNewsSentenceIssues(value = "") {
  return buildStudentNewsGrammarIssues(value)
}

export function buildStudentNewsSentenceReport(value = "") {
  const text = value === undefined || value === null ? "" : String(value)
  const parser = parseStudentNewsSentence(text)
  return {
    sentenceType: parser.classification,
    issues: buildStudentNewsSentenceIssues(text),
    parser,
    status: parser.text ? "completed" : "empty",
  }
}

async function buildStudentNewsLanguageReports(actionWhy, biasAssessment, config) {
  const fallback = {
    actionWhy: { ...buildStudentNewsSentenceReport(actionWhy), advisoryIssues: [], languageToolStatus: "disabled" },
    biasAssessment: { ...buildStudentNewsSentenceReport(biasAssessment), advisoryIssues: [], languageToolStatus: "disabled" },
  }
  if (config?.grammarEngine?.enabled !== true) return fallback
  const entries = [
    ["actionWhy", actionWhy],
    ["biasAssessment", biasAssessment],
  ]
  const reports = { ...fallback }
  for (const [field, value] of entries) {
    if (!normalizeText(value)) continue
    let result
    try {
      result = await checkTextWithLanguageTool(value, config.grammarEngine)
    } catch (error) {
      const message = error instanceof Error ? error.message : "LanguageTool request failed"
      const unavailable = new Error(`Grammar validation unavailable: ${message}`, { cause: error })
      unavailable.statusCode = 503
      unavailable.code = "STUDENT_NEWS_VALIDATION_UNAVAILABLE"
      unavailable.payload = {
        ok: false,
        status: "unavailable",
        validation: {
          engines: {
            internal: "completed",
            languageTool: "unavailable",
          },
        },
      }
      throw unavailable
    }
    const fallbackIssues = fallback[field].issues
    const externalIssues = Array.isArray(result.blockingIssues) ? result.blockingIssues : []
    const issues = [
      ...externalIssues,
      ...fallbackIssues.filter((fallbackIssue) =>
        !externalIssues.some((externalIssue) =>
          externalIssue.start === fallbackIssue.start &&
          externalIssue.length === fallbackIssue.length
        )
      ),
    ].sort((left, right) => left.start - right.start || left.ruleId.localeCompare(right.ruleId))
    reports[field] = {
      sentenceType: classifyStudentNewsSentence(value),
      issues,
      advisoryIssues: result.advisoryIssues,
      parser: fallback[field].parser,
      status: "completed",
      languageToolStatus: "completed",
    }
  }
  return reports
}

function isSentenceLike(value = "") {
  return buildStudentNewsSentenceIssues(value).length === 0
}

function datelineHasExplicitUpdatedCue(value = "") {
  const text = normalizeText(value)
  if (!text) return false
  return /\b(?:updated|last updated)\b/i.test(text)
}

/**
 * @param {Record<string, unknown>} [failedFields]
 * @param {string[]} [allowedDomains]
 * @returns {Array<Record<string, unknown>>}
 */
function buildTasksFromFailedFields(failedFields = {}, allowedDomains = []) {
  return Object.keys(
    failedFields && typeof failedFields === "object" && !Array.isArray(failedFields)
      ? failedFields
      : {}
  ).map((fieldKey) =>
    buildStudentNewsFieldRevisionTask(fieldKey, {
      allowedDomains,
    })
  )
}

/**
 * @param {Record<string, unknown> | null | undefined} [payload]
 * @param {Record<string, unknown> | null | undefined} [options]
 * @returns {{
 *   passed: boolean,
 *   failedFields: Record<string, Record<string, unknown>>,
 *   requiredTasks: Array<Record<string, unknown>>,
 *   config: ReturnType<typeof normalizeStudentNewsValidationConfig>,
 * }}
 */
export async function evaluateStudentNewsMinimumRequirements(payload = {}, options = {}) {
  const config = normalizeStudentNewsValidationConfig(options?.validationConfig || {})
  const normalizedSourceLink = normalizeHttpUrl(payload?.sourceLink)
  const rawSourceLink = normalizeText(payload?.sourceLink)
  const articleTitle = normalizeText(payload?.articleTitle)
  const byline = normalizeText(payload?.byline)
  const articleDateline = normalizeText(payload?.articleDateline)
  const leadSynopsis = normalizeText(payload?.leadSynopsis)
  const actionActor = normalizeText(payload?.actionActor)
  const actionAffected = normalizeText(payload?.actionAffected)
  const actionWhere = normalizeText(payload?.actionWhere)
  const actionWhat = normalizeText(payload?.actionWhat)
  const actionWhy = normalizeText(payload?.actionWhy)
  const biasAssessment = normalizeText(payload?.biasAssessment)
  const sentenceReports = await buildStudentNewsLanguageReports(actionWhy, biasAssessment, config)
  const failedFields = {}

  if (!rawSourceLink) {
    failedFields.sourceLink = {
      message: "Source must contain data.",
      score: 0,
      threshold: 1,
    }
  } else if (!normalizedSourceLink) {
    failedFields.sourceLink = {
      message: "Source must be a valid full story URL (https).",
      score: 0,
      threshold: 1,
    }
  } else if (!hasSpecificArticlePath(normalizedSourceLink)) {
    failedFields.sourceLink = {
      message: "Source must link to the exact article, not only the site home page.",
      score: 0,
      threshold: 1,
    }
  }
  if (!articleTitle) {
    failedFields.articleTitle = {
      message: "Article title must contain data.",
      score: 0,
      threshold: 1,
    }
  }
  if (!byline) {
    failedFields.byline = {
      message: "Byline must contain data.",
      score: 0,
      threshold: 1,
    }
  }
  if (!articleDateline) {
    failedFields.articleDateline = {
      message: "Dateline must contain data.",
      score: 0,
      threshold: 1,
    }
  }
  if (!leadSynopsis) {
    failedFields.leadSynopsis = {
      message: "Lead synopsis must contain data.",
      score: 0,
      threshold: 1,
    }
  }
  if (!actionActor) {
    failedFields.actionActor = {
      message: "Action actor must contain data.",
      score: 0,
      threshold: 1,
    }
  }
  if (!actionAffected) {
    failedFields.actionAffected = {
      message: "Action affected must contain data.",
      score: 0,
      threshold: 1,
    }
  }
  if (!actionWhere) {
    failedFields.actionWhere = {
      message: "Action location must contain data.",
      score: 0,
      threshold: 1,
    }
  }
  if (!actionWhat) {
    failedFields.actionWhat = {
      message: "Action description must contain data.",
      score: 0,
      threshold: 1,
    }
  }
  if (!actionWhy) {
    failedFields.actionWhy = {
      message: "Action reason must contain data.",
      score: 0,
      threshold: 1,
    }
  } else if (sentenceReports.actionWhy.issues.length) {
    const sentenceIssues = sentenceReports.actionWhy.issues
    failedFields.actionWhy = {
      message: "Action reason must be at least one sentence.",
      score: 0,
      threshold: 1,
      ruleIds: sentenceIssues.map((issue) => issue.ruleId),
      sentenceIssues,
      sentenceType: sentenceReports.actionWhy.sentenceType,
    }
  }
  if (!biasAssessment) {
    failedFields.biasAssessment = {
      message: "Bias assessment must contain data.",
      score: 0,
      threshold: 1,
    }
  } else if (sentenceReports.biasAssessment.issues.length) {
    const sentenceIssues = sentenceReports.biasAssessment.issues
    failedFields.biasAssessment = {
      message: "Bias assessment must be at least one sentence.",
      score: 0,
      threshold: 1,
      ruleIds: sentenceIssues.map((issue) => issue.ruleId),
      sentenceIssues,
      sentenceType: sentenceReports.biasAssessment.sentenceType,
    }
  }
  const vocabularyValidation = await evaluateStudentNewsVocabulary(payload?.vocabulary, {
    minimumWords: config.vocabularyMinimumWords,
  })
  if (!vocabularyValidation.passed) {
    failedFields.vocabulary = {
      message: vocabularyValidation.message,
      score: vocabularyValidation.count,
      threshold: config.vocabularyMinimumWords,
      rowErrors: vocabularyValidation.rowErrors || [],
    }
  }
  const vocabularyWarnings = vocabularyValidation.rowWarnings || []
  const transitivityAttempts = vocabularyValidation.transitivityAttempts || []

  return {
    status: Object.keys(failedFields).length ? "fail" : "pass",
    passed: Object.keys(failedFields).length === 0,
    failedFields,
    requiredTasks: buildTasksFromFailedFields(failedFields, config.allowedDomains),
    sentenceReports,
    config,
    warningFields: vocabularyWarnings.length || transitivityAttempts.length ? {
      vocabulary: {
        message: [
          vocabularyWarnings.length ? "Some vocabulary entries could not be verified right now." : "",
          transitivityAttempts.length ? `${transitivityAttempts.length} optional transitivity attempt(s) can earn extra points.` : "",
        ].filter(Boolean).join(" "),
        rowWarnings: vocabularyWarnings,
        transitivityAttemptCount: transitivityAttempts.length,
        transitivityAttempts,
      },
    } : {},
  }
}

export {
  evaluateStudentNewsVocabulary,
  findStudentNewsTransitivityAttempts,
  isValidStudentNewsSyllabication,
  normalizeStudentNewsVocabulary,
}

/**
 * @param {Record<string, unknown> | null | undefined} [payload]
 * @param {Record<string, unknown> | null | undefined} [options]
 * @returns {Promise<{
 *   passed: boolean,
 *   failedFields: Record<string, Record<string, unknown>>,
 *   warningFields: Record<string, Record<string, unknown>>,
 *   revisionTasks: Array<Record<string, unknown>>,
 *   warningTasks: Array<Record<string, unknown>>,
 *   details: Record<string, unknown>,
 *   config: ReturnType<typeof normalizeStudentNewsValidationConfig>,
 * }>}
 */
export async function evaluateStudentNewsCompliance(payload = {}, options = {}) {
  const config = normalizeStudentNewsValidationConfig(options?.validationConfig || {})
  if (config.enabled === false) {
    return {
      passed: true,
      failedFields: {},
      warningFields: {},
      revisionTasks: [],
      warningTasks: [],
      details: {
        skipped: true,
        reason: "validation-disabled",
      },
      config,
    }
  }
  const normalizedSourceLink = normalizeHttpUrl(payload?.sourceLink)
  const rawSourceLink = normalizeText(payload?.sourceLink)
  const articleTitle = normalizeText(payload?.articleTitle)
  const byline = normalizeText(payload?.byline)
  const articleDateline = normalizeText(payload?.articleDateline)
  const leadSynopsis = normalizeText(payload?.leadSynopsis)
  const actionActor = normalizeText(payload?.actionActor)
  const actionAffected = normalizeText(payload?.actionAffected)
  const actionWhere = normalizeText(payload?.actionWhere)
  const actionWhat = normalizeText(payload?.actionWhat)
  const actionWhy = normalizeText(payload?.actionWhy)
  const biasAssessment = normalizeText(payload?.biasAssessment)
  const sentenceReports = options?.sentenceReports && typeof options.sentenceReports === "object"
    ? options.sentenceReports
    : await buildStudentNewsLanguageReports(actionWhy, biasAssessment, config)
  const failedFields = {}
  const warningFields = {}
  const validationDetails = {}
  validationDetails.sentenceReports = sentenceReports
  validationDetails.parser = {
    sentences: Object.values(sentenceReports)
      .map((report) => report?.parser)
      .filter(Boolean),
    clauses: Object.values(sentenceReports)
      .flatMap((report) => Array.isArray(report?.parser?.clauses) ? report.parser.clauses : []),
    phrases: Object.values(sentenceReports)
      .flatMap((report) => Array.isArray(report?.parser?.phrases) ? report.parser.phrases : []),
  }
  validationDetails.engines = {
    internal: "completed",
    languageTool: config.grammarEngine.enabled ? "completed" : "disabled",
  }
  const preferredThresholds = {
    articleTitle: config.thresholds.articleTitle,
    byline: config.thresholds.byline,
    articleDateline: Math.min(config.thresholds.articleDateline, 0.6),
    leadSynopsis: Math.min(config.thresholds.leadSynopsis, 0.45),
  }

  const sourceHostname = hostnameFromUrl(normalizedSourceLink || rawSourceLink)
  const allowedDomains = Array.isArray(config.allowedDomains) ? config.allowedDomains : []
  if (!rawSourceLink) {
    failedFields.sourceLink = {
      message: "Source must contain data.",
      threshold: 1,
      score: 0,
    }
  } else if (!sourceHostname) {
    failedFields.sourceLink = {
      message: "Source must be a valid full story URL (https).",
      threshold: 1,
      score: 0,
    }
  } else if (!hasSpecificArticlePath(normalizedSourceLink)) {
    failedFields.sourceLink = {
      message: "Source must link to the exact article, not only the site home page.",
      threshold: 1,
      score: 0,
    }
  } else {
    const sourceAllowed = allowedDomains.some((domain) => sourceDomainMatches(sourceHostname, domain))
    validationDetails.sourceLink = {
      hostname: sourceHostname,
      allowedDomains,
      sourceAllowed,
    }
    if (!sourceAllowed) {
      const allowedSourceText = allowedDomains.join(", ")
      warningFields.sourceLink = {
        message: `Source domain is not allowed. Approved sources: ${allowedSourceText || STUDENT_NEWS_DEFAULT_ALLOWED_SOURCE_DOMAINS.join(", ")}.`,
        threshold: 1,
        score: 0,
      }
    }
  }

  const metadata = await fetchStudentNewsArticleMetadata(normalizedSourceLink || rawSourceLink)
  validationDetails.metadata = metadata
  if (!metadata.ok && !failedFields.sourceLink) {
    warningFields.sourceLink = warningFields.sourceLink || {
      message: normalizeText(metadata.error) || "Unable to fetch source URL.",
      threshold: 1,
      score: 0,
    }
  }

  const titleScore = studentNewsTextSimilarityScore(articleTitle, metadata?.title)
  const titleTextMatches = newsComparableTextMatches(articleTitle, metadata?.title)
  validationDetails.articleTitle = {
    score: titleScore,
    threshold: preferredThresholds.articleTitle,
    fetchedTitle: normalizeText(metadata?.title),
    normalizedMatch: titleTextMatches,
  }
  if (!articleTitle) {
    failedFields.articleTitle = {
      message: "Article title must contain data.",
      score: titleScore,
      threshold: 1,
    }
  } else if (metadata?.title && titleScore < preferredThresholds.articleTitle && !titleTextMatches) {
    failedFields.articleTitle = {
      message: "Article title does not closely match source title.",
      score: titleScore,
      threshold: preferredThresholds.articleTitle,
    }
  }

  const bylineScore = studentNewsTextSimilarityScore(byline, metadata?.byline)
  const orgFallback = inferSourceOrganization(normalizedSourceLink || rawSourceLink)
  const bylineOrgScore = studentNewsTextSimilarityScore(byline, orgFallback)
  const bylineFinalScore = Math.max(bylineScore, bylineOrgScore)
  validationDetails.byline = {
    score: bylineFinalScore,
    threshold: preferredThresholds.byline,
    fetchedByline: normalizeText(metadata?.byline),
    organizationFallback: orgFallback,
    fallbackScore: bylineOrgScore,
  }
  if (!byline) {
    failedFields.byline = {
      message: "Byline must contain data.",
      score: bylineFinalScore,
      threshold: 1,
    }
  } else if (bylineFinalScore < preferredThresholds.byline) {
    warningFields.byline = {
      message: "Byline must match fetched author or source organization.",
      score: bylineFinalScore,
      threshold: preferredThresholds.byline,
    }
  }

  const datelineTarget = normalizeText(metadata?.dateline?.combined)
  const fetchedUpdatedDateline = normalizeText(metadata?.dateline?.updated)
  const datelineScore = studentNewsTextSimilarityScore(articleDateline, datelineTarget)
  const datelineTextMatches = newsComparableTextMatches(articleDateline, datelineTarget)
  const articleRelativeMinutes = relativeDatelineToMinutes(articleDateline)
  const targetRelativeMinutes = relativeDatelineToMinutes(datelineTarget)
  const targetIsRelative = Boolean(parseRelativeDatelineToken(datelineTarget))
  const relativeDatelineCompatible = Number.isFinite(articleRelativeMinutes)
    && Number.isFinite(targetRelativeMinutes)
    && Math.abs(articleRelativeMinutes - targetRelativeMinutes) <= 24 * 60
  const articleDateKeys = extractDateKeysFromDatelineText(articleDateline)
  const targetDateKeys = extractDateKeysFromDatelineText(datelineTarget)
  const todayKey = localTodayDateKey()
  const articleHasTodayWord = /\btoday\b/i.test(articleDateline)
  const articleHasTodayDate = articleDateKeys.includes(todayKey)
  const targetHasTodayDate = targetDateKeys.includes(todayKey)
  const articleHasNearTodayDate = hasDateKeyNearLocalToday(articleDateKeys, 1)
  const targetHasNearTodayDate = hasDateKeyNearLocalToday(targetDateKeys, 1)
  const dateKeyOverlap = articleDateKeys.some((key) => targetDateKeys.includes(key))
  const dateKeysNearMatch = haveDateKeysWithinDays(articleDateKeys, targetDateKeys, 1)
  const articleTodayEquivalent = articleHasTodayWord || articleHasTodayDate || articleHasNearTodayDate
  const targetTodayEquivalent = targetHasTodayDate || targetHasNearTodayDate
  const acceptsTodayStamp = articleTodayEquivalent
  const relaxedDatelineEquivalent = (
    relativeDatelineCompatible
    || dateKeyOverlap
    || dateKeysNearMatch
    || (targetIsRelative && articleTodayEquivalent)
    || (targetTodayEquivalent && articleTodayEquivalent)
  )
  const datelinePassesThreshold = datelineScore >= config.thresholds.articleDateline || relaxedDatelineEquivalent || datelineTextMatches
  const requiresUpdatedToken =
    datelineHasExplicitUpdatedCue(datelineTarget)
    || datelineHasExplicitUpdatedCue(fetchedUpdatedDateline)
  const hasUpdatedToken = /updated/i.test(articleDateline)
  const requiresOffset = shouldRequireGmtOffset(datelineTarget) || shouldRequireGmtOffset(articleDateline)
  const hasLiteralTimezone = hasTimezoneLiteral(articleDateline)
  const hasFullTimezoneDescriptor = hasTimezoneDescriptor(articleDateline)
  const hasGmtOffset = hasTimezoneOffset(articleDateline)
  const missingRequiredOffset = requiresOffset && !hasGmtOffset
  const strictTimezoneOffsetRequired = missingRequiredOffset && hasLiteralTimezone
  const descriptorMismatch = hasLiteralTimezone && !hasFullTimezoneDescriptor
  validationDetails.articleDateline = {
    score: datelineScore,
    threshold: preferredThresholds.articleDateline,
    fetchedDateline: datelineTarget,
    fetchedUpdatedDateline,
    normalizedMatch: datelineTextMatches,
    requiresUpdatedToken,
    hasUpdatedToken,
    requiresOffset,
    hasLiteralTimezone,
    hasFullTimezoneDescriptor,
    hasGmtOffset,
    targetIsRelative,
    relativeDatelineCompatible,
    dateKeyOverlap,
    articleDateKeys,
    targetDateKeys,
    articleHasNearTodayDate,
    targetHasNearTodayDate,
    dateKeysNearMatch,
    articleTodayEquivalent,
    targetTodayEquivalent,
    acceptsTodayStamp,
    relaxedDatelineEquivalent,
    missingRequiredOffset,
    strictTimezoneOffsetRequired,
    descriptorMismatch,
  }
  const hasDatelineReference = Boolean(datelineTarget || fetchedUpdatedDateline)
  const datelineWarns = hasDatelineReference && (
    !datelinePassesThreshold
    || (!relaxedDatelineEquivalent && requiresUpdatedToken && !hasUpdatedToken)
    || strictTimezoneOffsetRequired
    || descriptorMismatch
    || (!relaxedDatelineEquivalent && missingRequiredOffset && !hasLiteralTimezone)
  )
  if (!articleDateline) {
    failedFields.articleDateline = {
      message: "Dateline must contain data.",
      score: datelineScore,
      threshold: 1,
    }
  } else if (datelineWarns) {
    failedFields.articleDateline = {
      message: "Dateline must reflect visible publish/updated time and timezone requirements.",
      score: datelineScore,
      threshold: preferredThresholds.articleDateline,
    }
  }

  const leadScore = studentNewsTextSimilarityScore(leadSynopsis, metadata?.firstParagraph)
  validationDetails.leadSynopsis = {
    score: leadScore,
    threshold: preferredThresholds.leadSynopsis,
    fetchedLead: normalizeText(metadata?.firstParagraph),
  }
  if (!leadSynopsis) {
    failedFields.leadSynopsis = {
      message: "Lead synopsis must contain data.",
      score: leadScore,
      threshold: 1,
    }
  } else if (leadScore < preferredThresholds.leadSynopsis) {
    warningFields.leadSynopsis = {
      message: "Lead synopsis must align with the first paragraph of the source article.",
      score: leadScore,
      threshold: preferredThresholds.leadSynopsis,
    }
  }

  if (!actionActor) {
    failedFields.actionActor = {
      message: "Action actor must contain data.",
      score: 0,
      threshold: 1,
    }
  } else if (!hasNounLikePhrase(actionActor)) {
    warningFields.actionActor = {
      message: "Action actor should include a noun or noun phrase.",
      score: 0,
      threshold: 1,
    }
  }
  if (!actionAffected) {
    failedFields.actionAffected = {
      message: "Action affected must contain data.",
      score: 0,
      threshold: 1,
    }
  } else if (!hasNounLikePhrase(actionAffected)) {
    warningFields.actionAffected = {
      message: "Action affected should include a noun or noun phrase.",
      score: 0,
      threshold: 1,
    }
  }
  if (!actionWhere) {
    failedFields.actionWhere = {
      message: "Action location must contain data.",
      score: 0,
      threshold: 1,
    }
  } else if (!hasNounLikePhrase(actionWhere)) {
    warningFields.actionWhere = {
      message: "Action location should include a place (city/country/location phrase).",
      score: 0,
      threshold: 1,
    }
  }
  if (!actionWhat) {
    failedFields.actionWhat = {
      message: "Action description must contain data.",
      score: 0,
      threshold: 1,
    }
  }
  if (!actionWhy) {
    failedFields.actionWhy = {
      message: "Action reason must contain data.",
      score: 0,
      threshold: 1,
    }
  }
  if (!biasAssessment) {
    failedFields.biasAssessment = {
      message: "Bias assessment must contain data.",
      score: 0,
      threshold: 1,
    }
  }

  for (const [field, label] of [["actionWhy", "Action reason"], ["biasAssessment", "Bias assessment"]]) {
    const advisoryIssues = Array.isArray(sentenceReports?.[field]?.advisoryIssues)
      ? sentenceReports[field].advisoryIssues
      : []
    if (!advisoryIssues.length) continue
    warningFields[field] = {
      message: `${label} has style or readability suggestions.`,
      ruleIds: advisoryIssues.map((issue) => issue.ruleId),
      sentenceIssues: advisoryIssues,
      score: 0,
      threshold: 1,
    }
  }

  const vocabularyRowWarnings = findStudentNewsVocabularyExtraPointWarnings(payload?.vocabulary)
  const transitivityAttempts = findStudentNewsTransitivityAttempts(payload?.vocabulary)
  const etymologyAttempts = findStudentNewsEtymologyAttempts(payload?.vocabulary)
  const vocabularyRows = normalizeStudentNewsVocabulary(payload?.vocabulary)
  const populatedVocabularyRows = vocabularyRows.filter((row) => Object.values(row).some(Boolean))
  const vocabularyExtraRows = populatedVocabularyRows.length > config.vocabularyMinimumWords
    ? populatedVocabularyRows.slice(config.vocabularyMinimumWords)
    : []
  if (vocabularyRowWarnings.length || vocabularyExtraRows.length || transitivityAttempts.length || etymologyAttempts.length) {
    const vocabularyMessages = []
    if (vocabularyExtraRows.length) {
      vocabularyMessages.push(`${vocabularyExtraRows.length} vocabulary entr${vocabularyExtraRows.length === 1 ? "y" : "ies"} beyond the required five can earn extra points.`)
    }
    if (vocabularyRowWarnings.length) {
      vocabularyMessages.push("A multi-syllable part of a compound can be split for extra points.")
    }
    if (transitivityAttempts.length) {
      vocabularyMessages.push(`${transitivityAttempts.length} optional transitivity attempt${transitivityAttempts.length === 1 ? "" : "s"} can earn extra points.`)
    }
    if (etymologyAttempts.length) {
      vocabularyMessages.push(`${etymologyAttempts.length} optional etymology attempt${etymologyAttempts.length === 1 ? "" : "s"} can earn extra points.`)
    }
    warningFields.vocabulary = {
      message: vocabularyMessages.join(" "),
      score: populatedVocabularyRows.length,
      threshold: config.vocabularyMinimumWords,
      extraEntryCount: vocabularyExtraRows.length,
      rowWarnings: vocabularyRowWarnings,
      transitivityAttemptCount: transitivityAttempts.length,
      transitivityAttempts,
      etymologyAttemptCount: etymologyAttempts.length,
      etymologyAttempts,
      extraPointCount: vocabularyExtraRows.length + vocabularyRowWarnings.length + transitivityAttempts.length + etymologyAttempts.length,
    }
  }
  const revisionTasks = buildTasksFromFailedFields(failedFields, allowedDomains)
  const warningTasks = buildTasksFromFailedFields(warningFields, allowedDomains)
  if (vocabularyRowWarnings.length) {
    warningTasks.push({
      field: "vocabulary",
      label: "Vocabulary extra points",
      steps: [
        "Keep the compound form as entered to satisfy required validation.",
        "For extra points, split the multi-syllable part into syllables.",
      ],
      criterion: "Optional: show syllable boundaries for multi-syllable compound parts.",
    })
  }
  if (vocabularyExtraRows.length) {
    warningTasks.push({
      field: "vocabulary",
      label: "Vocabulary extra entries",
      steps: [
        `Keep at least ${config.vocabularyMinimumWords} complete vocabulary entries.`,
        "Add additional complete entries for extra points.",
      ],
      criterion: `Optional: provide more than ${config.vocabularyMinimumWords} complete vocabulary entries.`,
    })
  }
  if (transitivityAttempts.length) {
    warningTasks.push({
      field: "vocabulary",
      label: "Transitivity extra points",
      steps: [
        "Choose a transitivity type when the vocabulary row is a verb.",
        "The bundled list is advisory; an unknown or differing result does not block saving.",
      ],
      criterion: "Optional: attempt a transitivity selection for a verb vocabulary row.",
    })
  }
  if (etymologyAttempts.length) {
    warningTasks.push({
      field: "vocabulary",
      label: "Etymology extra points",
      steps: [
        "Choose an origin type when you know the word history.",
        "Add a brief word-origin note when you can support it; this field is optional and does not block saving.",
      ],
      criterion: "Optional: attempt an etymology type or word-origin note for a vocabulary row.",
    })
  }
  return {
    status: Object.keys(failedFields).length ? "fail" : "pass",
    passed: Object.keys(failedFields).length === 0,
    failedFields,
    warningFields,
    revisionTasks,
    warningTasks,
    details: validationDetails,
    config,
  }
}

/**
 * @param {Array<Record<string, unknown>>} [revisionTasks]
 * @returns {Map<string, Record<string, unknown>>}
 */
function revisionTasksByField(revisionTasks = []) {
  const source = Array.isArray(revisionTasks) ? revisionTasks : []
  const map = new Map()
  source.forEach((task) => {
    const field = normalizeText(task?.field)
    if (!field) return
    map.set(field, task)
  })
  return map
}

/**
 * @param {Record<string, unknown> | null | undefined} [previousIssues]
 * @param {Record<string, unknown> | null | undefined} [compliance]
 * @returns {{ issues: Record<string, ReturnType<typeof normalizeValidationIssueEntry>>, newlyFixed: string[] }}
 */
export function updateStudentNewsValidationIssues(previousIssues = {}, compliance = {}) {
  const previous = normalizeValidationIssueMap(previousIssues)
  const failedFields = compliance?.failedFields && typeof compliance.failedFields === "object"
    ? compliance.failedFields
    : {}
  const tasksByField = revisionTasksByField(compliance?.revisionTasks)
  const nextIssues = {}
  const newlyFixed = []
  const fieldKeys = new Set([
    ...Object.keys(previous),
    ...Object.keys(failedFields),
  ])
  fieldKeys.forEach((fieldKey) => {
    const previousEntry = previous[fieldKey]
    const failed = failedFields[fieldKey]
    if (failed) {
      const task = tasksByField.get(fieldKey) || buildStudentNewsFieldRevisionTask(fieldKey, {
        allowedDomains: compliance?.config?.allowedDomains || [],
      })
      nextIssues[fieldKey] = normalizeValidationIssueEntry(fieldKey, {
        ...(previousEntry || {}),
        status: "pending",
        label: task?.label || STUDENT_NEWS_FIELD_LABELS[fieldKey] || fieldKey,
        message: normalizeText(failed?.message),
        criterion: normalizeText(task?.criterion),
        steps: Array.isArray(task?.steps) ? task.steps : [],
        score: Number.isFinite(Number(failed?.score)) ? Number(failed?.score) : null,
        threshold: Number.isFinite(Number(failed?.threshold)) ? Number(failed?.threshold) : null,
        ruleIds: Array.isArray(failed?.ruleIds) ? failed.ruleIds : [],
        sentenceIssues: Array.isArray(failed?.sentenceIssues) ? failed.sentenceIssues : [],
        updatedAt: nowIso(),
      })
      return
    }
    if (!previousEntry) return
    if (normalizeLower(previousEntry.status) !== "fixed") newlyFixed.push(fieldKey)
    nextIssues[fieldKey] = normalizeValidationIssueEntry(fieldKey, {
      ...previousEntry,
      status: "fixed",
      message: "Resolved on latest save.",
      score: previousEntry?.score,
      threshold: previousEntry?.threshold,
      updatedAt: nowIso(),
    })
  })
  return {
    issues: nextIssues,
    newlyFixed,
  }
}
