import * as cheerio from "cheerio"

const ETYMONLINE_HOST = "www.etymonline.com"
const ETYMONLINE_ROOT = `https://${ETYMONLINE_HOST}`
const MAX_RESPONSE_BYTES = 1_500_000
const FETCH_TIMEOUT_MS = 8_000
const MAX_PARAGRAPH_LENGTH = 4_000
const MAX_REFERENCES = 8
const LANGUAGE_NAMES = [
  "Old English", "Middle English", "Modern English", "English", "Old French", "Middle French", "French",
  "Old Norse", "Middle Dutch", "Dutch", "German", "Latin", "Greek", "Italian", "Spanish", "Portuguese",
  "Arabic", "Persian", "Sanskrit", "Hindi", "Hebrew", "Yiddish", "Celtic", "Gaelic", "Welsh", "Japanese",
  "Chinese", "Turkish", "Russian", "Polish", "Malay", "Malayalam", "Tamil", "Telugu", "Algonquian",
]
const LANGUAGE_PATTERN = new RegExp(`\\b(${LANGUAGE_NAMES.sort((left, right) => right.length - left.length).join("|")})\\b`, "giu")

function text(value) { return String(value == null ? "" : value).replace(/\s+/gu, " ").trim() }
function clamp(value, maximum = 240) { return text(value).slice(0, maximum) }

export function normalizeOriginTerm(value) {
  return text(value)
    .normalize("NFC")
    .replace(/[’‘]/gu, "'")
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/[^\p{L}\p{N}\s'\-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

export function etymonlineSearchUrl(word) {
  const term = normalizeOriginTerm(word)
  return term ? `${ETYMONLINE_ROOT}/search?q=${encodeURIComponent(term)}` : ""
}

function inlineMarkup(node) {
  if (node.type === "text") return node.data || ""
  if (node.type !== "tag") return ""
  if (node.name === "br") return "\n"
  const content = (node.children || []).map(inlineMarkup).join("")
  if (node.name === "em" || node.name === "i") return `*${content}*`
  if (node.name === "strong" || node.name === "b") return `**${content}**`
  return content
}

export function safeEtymonlineMarkup(html) {
  const $ = cheerio.load(`<div>${String(html || "")}</div>`, { decodeEntities: true })
  return ($("div").first().contents().toArray().map(inlineMarkup).join("") || "")
    .replace(/\s*\n\s*/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .trim()
    .slice(0, MAX_PARAGRAPH_LENGTH)
}

export function extractOriginPath(value) {
  const source = text(value)
  if (!source || !/(?:\bfrom\b|\bvia\b|\bthrough\b|\bborrowed\b|\bderived\b)/iu.test(source)) return ""
  const matches = []
  let match
  while ((match = LANGUAGE_PATTERN.exec(source))) {
    const name = match[1]
    if (!matches.some((item) => item.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US"))) matches.push(name)
  }
  LANGUAGE_PATTERN.lastIndex = 0
  if (matches.length < 2) return ""
  const normalized = matches.map((item) => item === "French" && matches.includes("Old French") ? "Old French" : item)
  if (!normalized.some((item) => item === "English")) normalized.push("English")
  return normalized.join(" → ")
}

export function buildOriginReference({ source = "", url = "", retrievedAt = new Date(), claims = [], provider = "", citation = "" } = {}) {
  const normalizedClaims = [...new Set((Array.isArray(claims) ? claims : [claims]).map((claim) => clamp(claim, 120)).filter(Boolean))].slice(0, 12)
  return {
    source: clamp(source, 120),
    url: clamp(url, 500),
    retrievedAt: new Date(retrievedAt).toISOString(),
    claims: normalizedClaims,
    provider: clamp(provider, 120),
    ...(text(citation) ? { citation: clamp(citation, 800) } : {}),
  }
}

export function normalizeOriginReferences(value) {
  const records = Array.isArray(value) ? value : []
  const output = []
  for (const record of records.slice(0, MAX_REFERENCES)) {
    if (!record || typeof record !== "object") continue
    const normalized = buildOriginReference(record)
    if (!normalized.source || !/^https:\/\//iu.test(normalized.url)) continue
    const key = normalized.url.toLocaleLowerCase("en-US")
    if (!output.some((item) => item.url.toLocaleLowerCase("en-US") === key)) output.push(normalized)
  }
  return output.length ? output : null
}

export function parseEtymonlineParagraph(html, { word = "", retrievedAt = new Date() } = {}) {
  if (String(html || "").length > MAX_RESPONSE_BYTES) throw new Error("Etymonline response exceeded the permitted size")
  const $ = cheerio.load(String(html || ""), { decodeEntities: true })
  const paragraph = $("section.prose p").first()
  if (!paragraph.length) throw new Error("No Etymonline definition paragraph was found")
  const normalizedParagraph = safeEtymonlineMarkup(paragraph.html())
  if (!normalizedParagraph) throw new Error("The Etymonline paragraph was empty")
  const url = etymonlineSearchUrl(word)
  const originPath = extractOriginPath(paragraph.text())
  const citation = `Online Etymology Dictionary. (n.d.). *${normalizeOriginTerm(word)}*. Retrieved ${new Date(retrievedAt).toISOString().slice(0, 10)}, from ${url}`
  return {
    paragraph: normalizedParagraph,
    originPath: originPath || null,
    sourceUrl: url,
    citation,
    retrievedAt: new Date(retrievedAt).toISOString(),
    reference: buildOriginReference({ source: "Online Etymology Dictionary", url, retrievedAt, claims: ["etymology", "originPath"].filter((claim) => claim === "etymology" || originPath), provider: "Etymonline", citation }),
  }
}

export function normalizeDefinitionText(value) {
  return String(value == null ? "" : value).replace(/\r\n?/gu, "\n").split("\n").map((line) => line.trimEnd()).join("\n").replace(/\n{3,}/gu, "\n\n").trim()
}

const DEFINITION_SECTION_RE = /^\*\*(First known use|Etymology|Stems|Synonyms|Antonyms|Works Cited):\*\*[\t ]*(.*)$/iu
const DEFINITION_SECTION_ORDER = ["Etymology", "First known use", "Stems", "Synonyms", "Antonyms", "Works Cited"]

export function parseDefinitionSections(value) {
  const sections = { body: [], Etymology: [], "First known use": [], Stems: [], Synonyms: [], Antonyms: [], "Works Cited": [] }
  let current = "body"
  normalizeDefinitionText(value).split("\n").forEach((line) => {
    const heading = line.match(DEFINITION_SECTION_RE)
    if (heading) {
      current = heading[1]
      if (heading[2]) sections[current].push(heading[2])
      return
    }
    sections[current].push(line)
  })
  return Object.fromEntries(Object.entries(sections).map(([key, lines]) => [key, lines.join("\n").trim()]))
}

export function insertEtymologyDeterministically(definition, paragraph) {
  const source = normalizeDefinitionText(definition)
  const addition = normalizeDefinitionText(paragraph)
  if (!addition) return source
  const firstUse = source.match(/^\*\*First known use:\*\*[\t ]*([^\n]*)$/imu)
  if (!firstUse && source.includes(addition)) return source
  let next = source
  if (firstUse) {
    const line = firstUse[0]
    if (line.includes(addition)) return source
    next = source.replace(line, `${line}${line.trim().endsWith(":**") ? ` ${addition}` : `; ${addition}`}`)
  } else {
    const sections = parseDefinitionSections(source)
    if (sections.Etymology) {
      next = source.replace(/^(\*\*Etymology:\*\*[\t ]*[^\n]*)$/imu, (line) => `${line}; ${addition}`)
    } else {
      const nextHeading = source.search(/^\*\*(?:Stems|Synonyms|Antonyms|Works Cited):\*\*/imu)
      next = nextHeading >= 0 ? `${source.slice(0, nextHeading).trimEnd()}\n\n${addition}\n\n${source.slice(nextHeading).trimStart()}` : (source ? `${source}\n\n${addition}` : addition)
    }
  }
  const parsed = parseDefinitionSections(next)
  const rendered = [
    parsed.body,
    ...DEFINITION_SECTION_ORDER.map((heading) => parsed[heading] ? `**${heading}:** ${parsed[heading]}` : ""),
  ].filter(Boolean).join("\n\n")
  return normalizeDefinitionText(rendered)
}

export async function fetchEtymonlinePreview(word, fetchImpl = fetch) {
  const sourceUrl = etymonlineSearchUrl(word)
  if (!sourceUrl) throw new Error("A word or phrase is required")
  const parsedUrl = new URL(sourceUrl)
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== ETYMONLINE_HOST) throw new Error("Etymonline host is not allowed")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(sourceUrl, { headers: { Accept: "text/html" }, signal: controller.signal })
    if (!response.ok) throw new Error("Etymonline is unavailable")
    if (response.url) {
      const finalUrl = new URL(response.url)
      if (finalUrl.protocol !== "https:" || finalUrl.hostname !== ETYMONLINE_HOST) throw new Error("Etymonline redirect host is not allowed")
    }
    let html
    if (response.body?.getReader) {
      const reader = response.body.getReader()
      const chunks = []
      let size = 0
      while (true) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("Etymonline response exceeded the permitted size") }
        chunks.push(next.value)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength })
      html = new TextDecoder().decode(bytes)
    } else {
      html = await response.text()
    }
    return parseEtymonlineParagraph(html, { word, retrievedAt: new Date() })
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Etymonline timed out")
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export const originConstants = { ETYMONLINE_HOST, ETYMONLINE_ROOT, MAX_RESPONSE_BYTES, MAX_PARAGRAPH_LENGTH }
