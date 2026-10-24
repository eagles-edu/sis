import { existsSync } from "node:fs"

import * as cheerio from "cheerio"
import { fetchWithExponentialBackoff } from "./provider-http.mjs"

const ETYMONLINE_HOST = "www.etymonline.com"
const ETYMONLINE_ROOT = `https://${ETYMONLINE_HOST}`
const MAX_RESPONSE_BYTES = 1_500_000
const FETCH_TIMEOUT_MS = 8_000
const MAX_PARAGRAPH_LENGTH = 4_000
const MAX_REFERENCES = 8
const ETYMONLINE_BROWSER_TIMEOUT_MS = 15_000
const ETYMONLINE_BROWSER_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
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
  return String(value == null ? "" : value).replace(/\r\n?/gu, "\n")
}

const DEFINITION_SECTION_RE = /^\*\*(First known use|Etymology|Origin path|Verb Forms|Stems|Synonyms|Antonyms|Works Cited):?\*\*:?[	 ]*(.*)$/iu
const DEFINITION_SECTION_ORDER = ["First known use", "Etymology", "Origin path", "Verb Forms", "Stems", "Synonyms", "Antonyms", "Works Cited"]
const STEM_LIST_ITEM_RE = /^\s*(?:(?:\d+|[a-z])[.)]|[-+*])\s+/iu

export function parseDefinitionSections(value) {
  const sections = { body: [], "First known use": [], Etymology: [], "Origin path": [], "Verb Forms": [], Stems: [], Synonyms: [], Antonyms: [], "Works Cited": [] }
  const sectionLabels = Object.fromEntries(Object.keys(sections).filter((key) => key !== "body").map((key) => [key.toLowerCase(), key]))
  let current = "body"
  normalizeDefinitionText(value).split("\n").forEach((line) => {
    const heading = line.match(DEFINITION_SECTION_RE)
    if (heading) {
      current = sectionLabels[heading[1].toLowerCase()] || "body"
      if (heading[2]) sections[current].push(heading[2])
      return
    }
    if (current === "Stems" && line.trim() && !STEM_LIST_ITEM_RE.test(line)) current = "Etymology"
    sections[current].push(line)
  })
  return Object.fromEntries(Object.entries(sections).map(([key, lines]) => [key, lines.join("\n").trim()]))
}

export function insertEtymologyDeterministically(definition, paragraph) {
  const source = normalizeDefinitionText(definition)
  const addition = normalizeDefinitionText(paragraph)
  if (!addition) return source
  if (source.includes(addition)) return source
  const parsed = parseDefinitionSections(source)
  parsed.Etymology = parsed.Etymology ? `${parsed.Etymology}\n\n${addition}` : addition
  const rendered = [
    parsed.body,
    ...DEFINITION_SECTION_ORDER.map((heading) => {
      if (!parsed[heading]) return ""
      return ["First known use", "Etymology"].includes(heading) ? `**${heading}**\n${parsed[heading]}` : `**${heading}:** ${parsed[heading]}`
    }),
  ].filter(Boolean).join("\n\n")
  return normalizeDefinitionText(rendered)
}

export async function fetchEtymonlineBrowserPage(sourceUrl, { signal } = {}) {
  const parsedUrl = new URL(sourceUrl)
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== ETYMONLINE_HOST || !parsedUrl.pathname.startsWith("/search")) throw new Error("Etymonline browser URL is not allowed")
  let browser
  const abortBrowser = () => { void browser?.close() }
  try {
    if (signal?.aborted) throw signal.reason || new Error("Etymonline browser access aborted")
    const { chromium } = await import("playwright")
    const launchOptions = { headless: true, args: ["--no-sandbox"] }
    const executablePath = process.env.ETYMONLINE_BROWSER_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"
    if (existsSync(executablePath)) launchOptions.executablePath = executablePath
    browser = await chromium.launch(launchOptions)
    signal?.addEventListener("abort", abortBrowser, { once: true })
    const context = await browser.newContext({ userAgent: ETYMONLINE_BROWSER_USER_AGENT })
    const page = await context.newPage()
    const response = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: ETYMONLINE_BROWSER_TIMEOUT_MS })
    const html = await page.content()
    const status = response?.status() || 200
    if (/just a moment|enable javascript and cookies|cf-chl-|challenge-platform|access denied|verify you are human|captcha/iu.test(html) || status === 403) {
      return { ok: false, status, robotBlocked: true, url: page.url(), html, message: "Etymonline requires browser verification because the source presented an access challenge; open the source page and retry after resolving it." }
    }
    if (status >= 400) return { ok: false, status, url: page.url(), html, message: `Etymonline returned HTTP ${status}` }
    return { ok: true, status, url: page.url(), html }
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error
    return { ok: false, available: false, message: `Etymonline browser access failed: ${error.message}` }
  } finally {
    signal?.removeEventListener("abort", abortBrowser)
    await browser?.close().catch(() => {})
  }
}

export async function fetchEtymonlinePreview(word, fetchImpl = fetch, browserFetchImpl = fetchEtymonlineBrowserPage) {
  const sourceUrl = etymonlineSearchUrl(word)
  if (!sourceUrl) throw new Error("A word or phrase is required")
  const parsedUrl = new URL(sourceUrl)
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== ETYMONLINE_HOST) throw new Error("Etymonline host is not allowed")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    let response = await fetchWithExponentialBackoff(fetchImpl, sourceUrl, { headers: { Accept: "text/html" }, signal: controller.signal })
    if (!response.ok) {
      const body = typeof response.text === "function" ? await response.text().catch(() => "") : String(response.html || "")
      const challenge = response.status === 403 || /just a moment|enable javascript and cookies|cf-chl-|challenge-platform|access denied|verify you are human|captcha/iu.test(body)
      if (!challenge) throw new Error(`Etymonline returned HTTP ${response.status || 503}`)
      response = await browserFetchImpl(sourceUrl, { signal: controller.signal })
      if (!response?.ok) {
        const error = new Error(response?.message || "Etymonline browser access failed")
        if (response?.robotBlocked) error.status = "robot_blocked"
        throw error
      }
    }
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
    } else if (typeof response.text === "function") {
      html = await response.text()
    } else {
      html = String(response.html || "")
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
