// src/modules/admin/student-news-compliance.mjs

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeNullableText(value) {
  const text = normalizeText(value)
  return text || null
}

function parseDateOrNull(value) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value
  const text = normalizeText(value)
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.valueOf()) ? null : parsed
}

function normalizeHttpUrl(value) {
  const text = normalizeText(value)
  if (!text) return ""
  try {
    const parsed = new URL(text)
    const protocol = normalizeLower(parsed.protocol)
    if (protocol !== "http:" && protocol !== "https:") return ""
    return parsed.toString()
  } catch (error) {
    void error
    return ""
  }
}

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

function hostnameFromUrl(value) {
  const text = normalizeText(value)
  if (!text) return ""
  try {
    const parsed = new URL(text)
    const protocol = normalizeLower(parsed.protocol)
    if (protocol !== "http:" && protocol !== "https:") return ""
    return normalizeDomainToken(parsed.hostname)
  } catch (error) {
    void error
    return ""
  }
}

function sourceDomainMatches(hostname, allowedDomain) {
  const host = normalizeDomainToken(hostname)
  const domain = normalizeDomainToken(allowedDomain)
  if (!host || !domain) return false
  return host === domain || host.endsWith(`.${domain}`)
}

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

  const thresholds = {
    articleTitle: Number(source?.thresholds?.articleTitle),
    byline: Number(source?.thresholds?.byline),
    articleDateline: Number(source?.thresholds?.articleDateline),
    leadSynopsis: Number(source?.thresholds?.leadSynopsis),
  }
  return {
    enabled,
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
  }
}

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

function decodeHtmlEntities(text = "") {
  return normalizeText(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
}

function stripTags(text = "") {
  return decodeHtmlEntities(
    normalizeText(text)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  )
}

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

function isCnnUrl(link = "") {
  const host = hostnameFromUrl(link)
  return Boolean(host) && host.endsWith("cnn.com")
}

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

function isRelativeDatelineToken(value = "") {
  return /^\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago$/i.test(normalizeText(value))
}

function extractRelativeDatelineFragment(value = "") {
  const text = normalizeText(value)
  if (!text) return ""
  const match = text.match(/\b\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/i)
  return match && match[0] ? normalizeText(match[0]) : ""
}

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

async function fetchViaJinaProxy(link = "") {
  const target = normalizeHttpUrl(link)
  if (!target) throw new Error("Source link is not a valid http/https URL.")
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

function tokenizeForSimilarity(value = "") {
  return new Set(
    normalizeLower(value)
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((entry) => normalizeText(entry))
      .filter((entry) => entry.length >= 2)
  )
}

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

function inferSourceOrganization(sourceLink = "") {
  const host = hostnameFromUrl(sourceLink)
  if (!host) return ""
  const parts = host.split(".").filter(Boolean)
  if (!parts.length) return ""
  if (parts.length === 1) return parts[0]
  return parts[parts.length - 2]
}

function statusErrorWithPayload(statusCode = 500, message = "Request failed", payload = {}) {
  const error = new Error(normalizeText(message) || "Request failed")
  error.statusCode = statusCode
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    error.payload = payload
  }
  return error
}

function normalizeValidationIssueEntry(fieldKey = "", entry = {}) {
  const key = normalizeText(fieldKey)
  if (!key) return null
  const source = entry && typeof entry === "object" ? entry : {}
  const status = normalizeLower(source.status) === "fixed" ? "fixed" : "pending"
  const steps = Array.isArray(source.steps)
    ? source.steps.map((item) => normalizeText(item)).filter(Boolean)
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
    updatedAt: parseDateOrNull(source.updatedAt)?.toISOString?.() || nowIso(),
  }
}

export function normalizeValidationIssueMap(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {}
  const normalized = {}
  Object.keys(source).forEach((fieldKey) => {
    const entry = normalizeValidationIssueEntry(fieldKey, source[fieldKey])
    if (entry) normalized[fieldKey] = entry
  })
  return normalized
}

export function stripAwaitingReReviewMarker(note = "") {
  return normalizeText(String(note || "").replaceAll(STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER, ""))
}

export function addAwaitingReReviewMarker(note = "") {
  const clean = stripAwaitingReReviewMarker(note)
  if (!clean) return STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER
  return `${clean}\n${STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER}`
}

function hasAwaitingReReviewMarker(note = "") {
  return normalizeText(note).includes(STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER)
}

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

function stripComplianceBlockFromReviewNote(note = "") {
  const text = stripAwaitingReReviewMarker(note)
  if (!text) return ""
  const escapedStart = STUDENT_NEWS_COMPLIANCE_NOTE_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const escapedEnd = STUDENT_NEWS_COMPLIANCE_NOTE_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const blockRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, "g")
  return normalizeText(text.replace(blockRegex, " ").replace(/\n{3,}/g, "\n\n"))
}

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
      error: "Source link is not a valid http/https URL.",
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
        `Use a full story URL (http/https) from an approved source: ${allowedSourcesText}.`,
        "Open the URL and confirm it loads the specific article (not homepage).",
        "Paste the exact URL including its path and save again.",
      ],
      criterion: `Hostname must match approved sources (${allowedSourcesText}).`,
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
      criterion: "Headline similarity must be at least 0.70.",
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
      criterion: "Dateline text similarity must be at least 0.70 and include required updated/timezone tokens.",
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

function isSentenceLike(value = "") {
  const text = normalizeText(value)
  if (!text) return false
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length < 4) return false
  return /[.!?]$/.test(text) || text.length >= 24
}

function datelineHasExplicitUpdatedCue(value = "") {
  const text = normalizeText(value)
  if (!text) return false
  return /\b(?:updated|last updated)\b/i.test(text)
}

export async function evaluateStudentNewsCompliance(payload = {}, options = {}) {
  const config = normalizeStudentNewsValidationConfig(options?.validationConfig || {})
  if (config.enabled === false) {
    return {
      passed: true,
      failedFields: {},
      revisionTasks: [],
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
  const failedFields = {}
  const validationDetails = {}

  const sourceHostname = hostnameFromUrl(normalizedSourceLink || rawSourceLink)
  const allowedDomains = Array.isArray(config.allowedDomains) ? config.allowedDomains : []
  if (!sourceHostname) {
    failedFields.sourceLink = {
      message: "Source must be a valid full story URL (http/https).",
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
      failedFields.sourceLink = {
        message: `Source domain is not allowed. Approved sources: ${allowedSourceText || STUDENT_NEWS_DEFAULT_ALLOWED_SOURCE_DOMAINS.join(", ")}.`,
        threshold: 1,
        score: 0,
      }
    }
  }

  const metadata = await fetchStudentNewsArticleMetadata(normalizedSourceLink || rawSourceLink)
  validationDetails.metadata = metadata
  if (!metadata.ok) {
    failedFields.sourceLink = failedFields.sourceLink || {
      message: normalizeText(metadata.error) || "Unable to fetch source URL.",
      threshold: 1,
      score: 0,
    }
  }

  const titleScore = studentNewsTextSimilarityScore(articleTitle, metadata?.title)
  validationDetails.articleTitle = {
    score: titleScore,
    threshold: config.thresholds.articleTitle,
    fetchedTitle: normalizeText(metadata?.title),
  }
  if (!articleTitle || titleScore < config.thresholds.articleTitle) {
    failedFields.articleTitle = {
      message: "Article title does not closely match source title.",
      score: titleScore,
      threshold: config.thresholds.articleTitle,
    }
  }

  const bylineScore = studentNewsTextSimilarityScore(byline, metadata?.byline)
  const orgFallback = inferSourceOrganization(normalizedSourceLink || rawSourceLink)
  const bylineOrgScore = studentNewsTextSimilarityScore(byline, orgFallback)
  const bylineFinalScore = Math.max(bylineScore, bylineOrgScore)
  validationDetails.byline = {
    score: bylineFinalScore,
    threshold: config.thresholds.byline,
    fetchedByline: normalizeText(metadata?.byline),
    organizationFallback: orgFallback,
    fallbackScore: bylineOrgScore,
  }
  if (!byline || bylineFinalScore < config.thresholds.byline) {
    failedFields.byline = {
      message: "Byline must match fetched author or source organization.",
      score: bylineFinalScore,
      threshold: config.thresholds.byline,
    }
  }

  const datelineTarget = normalizeText(metadata?.dateline?.combined)
  const fetchedUpdatedDateline = normalizeText(metadata?.dateline?.updated)
  const datelineScore = studentNewsTextSimilarityScore(articleDateline, datelineTarget)
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
  const datelinePassesThreshold = datelineScore >= config.thresholds.articleDateline || relaxedDatelineEquivalent
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
    threshold: config.thresholds.articleDateline,
    fetchedDateline: datelineTarget,
    fetchedUpdatedDateline,
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
  if (
    !articleDateline
    || !datelinePassesThreshold
    || (!relaxedDatelineEquivalent && requiresUpdatedToken && !hasUpdatedToken)
    || strictTimezoneOffsetRequired
    || descriptorMismatch
    || (!relaxedDatelineEquivalent && missingRequiredOffset && !hasLiteralTimezone)
  ) {
    failedFields.articleDateline = {
      message: "Dateline must reflect visible publish/updated time and timezone requirements.",
      score: datelineScore,
      threshold: config.thresholds.articleDateline,
    }
  }

  const leadScore = studentNewsTextSimilarityScore(leadSynopsis, metadata?.firstParagraph)
  validationDetails.leadSynopsis = {
    score: leadScore,
    threshold: config.thresholds.leadSynopsis,
    fetchedLead: normalizeText(metadata?.firstParagraph),
  }
  if (!leadSynopsis || leadScore < config.thresholds.leadSynopsis) {
    failedFields.leadSynopsis = {
      message: "Lead synopsis must align with the first paragraph of the source article.",
      score: leadScore,
      threshold: config.thresholds.leadSynopsis,
    }
  }

  if (!hasNounLikePhrase(actionActor)) {
    failedFields.actionActor = {
      message: "Action actor must include a noun or noun phrase.",
      score: 0,
      threshold: 1,
    }
  }
  if (!hasNounLikePhrase(actionAffected)) {
    failedFields.actionAffected = {
      message: "Action affected must include a noun or noun phrase.",
      score: 0,
      threshold: 1,
    }
  }
  if (!hasNounLikePhrase(actionWhere)) {
    failedFields.actionWhere = {
      message: "Action location must include a place (city/country/location phrase).",
      score: 0,
      threshold: 1,
    }
  }
  if (!isSentenceLike(actionWhat)) {
    failedFields.actionWhat = {
      message: "Action description must be at least one sentence.",
      score: 0,
      threshold: 1,
    }
  }
  if (!isSentenceLike(actionWhy)) {
    failedFields.actionWhy = {
      message: "Action reason must be at least one sentence.",
      score: 0,
      threshold: 1,
    }
  }
  if (!isSentenceLike(biasAssessment)) {
    failedFields.biasAssessment = {
      message: "Bias assessment must be at least one sentence.",
      score: 0,
      threshold: 1,
    }
  }

  const revisionTasks = Object.keys(failedFields).map((fieldKey) =>
    buildStudentNewsFieldRevisionTask(fieldKey, {
      allowedDomains,
    })
  )
  return {
    passed: Object.keys(failedFields).length === 0,
    failedFields,
    revisionTasks,
    details: validationDetails,
    config,
  }
}

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
