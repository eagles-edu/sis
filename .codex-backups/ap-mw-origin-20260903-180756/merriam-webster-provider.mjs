import { existsSync } from "node:fs"

import { load } from "cheerio"

import { registerDictionaryProvider } from "./dictionary-providers.mjs"
import { fetchWithExponentialBackoff } from "./provider-http.mjs"
import { boundedDictionaryResponseText, buildRichDictionaryFields, cleanDictionaryText, uniqueDictionaryText, validateDictionaryPageUrl } from "./rich-dictionary-provider.mjs"

export const MERRIAM_WEBSTER_HOSTNAMES = new Set(["merriam-webster.com", "www.merriam-webster.com"])
const MERRIAM_WEBSTER_AUDIO_HOSTNAMES = new Set(["media.merriam-webster.com", ...MERRIAM_WEBSTER_HOSTNAMES])
export const MERRIAM_WEBSTER_BASE_URL = "https://www.merriam-webster.com/dictionary/"
export const MERRIAM_WEBSTER_MAX_HTML_BYTES = 3 * 1024 * 1024
const MERRIAM_WEBSTER_BROWSER_TIMEOUT_MS = 15_000
const MERRIAM_WEBSTER_BROWSER_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

function validMerriamWebsterUrl(value) { return validateDictionaryPageUrl(value, MERRIAM_WEBSTER_HOSTNAMES, "/dictionary/") }
function collectText(node, selectors) { return uniqueDictionaryText(node.find(selectors).map((_, child) => node.find(child).text()).get()) }
function isMerriamWebsterAccessChallenge(html) { return /just a moment|enable javascript and cookies|cf-chl-|challenge-platform|access denied/iu.test(String(html || "")) }

function audioUrl(node) {
  const candidates = node.find("[data-src-mp3], audio source[type='audio/mpeg'], audio source[src], [data-audio-url], a[href]").map((_, child) => {
    const element = node.find(child)
    return element.attr("data-src-mp3") || element.attr("src") || element.attr("data-audio-url") || element.attr("href") || ""
  }).get()
  for (const candidate of candidates) {
    const value = cleanDictionaryText(candidate)
    if (!value) continue
    try {
      const parsed = new URL(value, "https://www.merriam-webster.com")
      if (parsed.protocol === "https:" && MERRIAM_WEBSTER_AUDIO_HOSTNAMES.has(parsed.hostname.toLowerCase()) && /\/audio\//iu.test(parsed.pathname) && /\.(?:mp3|ogg|wav)$/iu.test(parsed.pathname)) return parsed.toString()
    } catch {}
  }
  return ""
}

export async function fetchMerriamWebsterBrowserPage(sourceUrl) {
  let browser
  try {
    const { chromium } = await import("playwright")
    const launchOptions = { headless: true, args: ["--no-sandbox"] }
    const executablePath = process.env.MERRIAM_WEBSTER_BROWSER_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"
    if (existsSync(executablePath)) launchOptions.executablePath = executablePath
    browser = await chromium.launch(launchOptions)
    const context = await browser.newContext({ userAgent: MERRIAM_WEBSTER_BROWSER_USER_AGENT })
    const page = await context.newPage()
    const response = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: MERRIAM_WEBSTER_BROWSER_TIMEOUT_MS })
    const html = await page.content()
    const status = response?.status() || 200
    if (status >= 400 || isMerriamWebsterAccessChallenge(html)) return { ok: false, status, robotBlocked: true, url: page.url(), html, message: "Merriam-Webster requires robot verification because the source presented an access challenge; open the source page and complete the prompt before retrying." }
    return { ok: true, status, url: page.url(), html }
  } catch (error) {
    return { ok: false, available: false, message: `Merriam-Webster browser access failed; no Library data was changed. ${error.message}` }
  } finally {
    await browser?.close().catch(() => {})
  }
}

function parseEntry(node, sourceUrl, index) {
  const headword = cleanDictionaryText(node.find(".hword, .hw, .headword, [data-headword], h1, h2").first().text())
  const partOfSpeech = cleanDictionaryText(node.find(".fl, .part-of-speech, .pos, [data-part-of-speech]").first().text()).toLowerCase()
  const labels = collectText(node, ".sl, .sgram, .gram, .label, .usage, .register, .vd")
  const senses = []
  const senseNodes = node.find(".sense, .sseq .sense, .dt, [data-sense]")
  senseNodes.each((senseIndex, child) => {
    const senseNode = node.find(child)
    const definition = cleanDictionaryText(senseNode.find(".dtText, .def, .definition, [data-definition]").first().text() || senseNode.clone().find(".vis, .example, .synonyms, .collocations, .idioms, .phrases").remove().end().text()).replace(/^:\s*/u, "")
    const senseLabels = collectText(senseNode, ".sl, .sgram, .gram, .label, .usage, .register, .vd")
    const examples = collectText(senseNode, ".vis, .example, .example-sentence, [data-example]")
    if (definition || examples.length) senses.push({ number: cleanDictionaryText(senseNode.find(".sn, .sense-number, .num, [data-sense-number]").first().text()) || String(senseIndex + 1), labels: senseLabels.length ? senseLabels : labels, definition, examples })
  })
  if (!senses.length) {
    collectText(node, ".dtText, .def, .definition, [data-definition]").forEach((definition, senseIndex) => senses.push({ number: String(senseIndex + 1), labels, definition: definition.replace(/^:\s*/u, ""), examples: [] }))
  }
  return { headword, partOfSpeech, labels, senses, sourceUrl, audio: { us: audioUrl(node), uk: "" } }
}

export function parseMerriamWebsterHtml(html, { sourceUrl = "", lookupWord = "" } = {}) {
  const normalizedSourceUrl = sourceUrl ? validMerriamWebsterUrl(sourceUrl) : ""
  const $ = load(String(html || ""))
  const containers = $(".entry-word-section-container, .entry-word-section, [data-dictionary-entry], .dict-entry, .entry").filter((_, node) => $(node).find(".fl, .part-of-speech, .pos, [data-part-of-speech]").length || $(node).find(".dtText, .def, .definition, [data-definition]").length)
  const parsedEntries = containers.map((index, node) => parseEntry($(node), normalizedSourceUrl, index)).get().filter((entry) => entry.senses.length)
  const sourceRoot = $("body")
  const etymology = collectText(sourceRoot, ".word-history .et, .word-history .etymology, .etymology, .et, [data-etymology]")
  const firstKnownUse = collectText(sourceRoot, ".first-known-use, .date-box, [data-first-known-use]")
  const synonyms = collectText(sourceRoot, ".synonyms li, .synonym, .syns li, [data-synonym]")
  const collocations = collectText(sourceRoot, ".collocations li, .collocation, [data-collocation]")
  const idioms = collectText(sourceRoot, ".idioms li, .idiom, [data-idiom]")
  const phrases = collectText(sourceRoot, ".phrases li, .phrase, .phrase-block, [data-phrase]")
  if (!parsedEntries.length) return { ok: false, available: true, message: `No Merriam-Webster entry was found for ${cleanDictionaryText(lookupWord) || "the requested word"}; no Library data was changed.` }
  return { ok: true, provider: "merriam-webster", sourceUrl: normalizedSourceUrl, lookupWord: cleanDictionaryText(lookupWord), entries: parsedEntries, fields: buildRichDictionaryFields({ provider: "merriam-webster", sourceName: "Merriam-Webster.com Dictionary", sourceUrl: normalizedSourceUrl, word: lookupWord, entries: parsedEntries, etymology, firstKnownUse, synonyms, collocations, idioms, phrases }) }
}

export function sanitizeMerriamWebsterPreview(preview) {
  if (!preview?.ok) return preview
  const fields = { ...preview.fields }
  delete fields.dictionaryMetadata
  return { ...preview, fields }
}

export async function previewMerriamWebsterDictionaryEntry(entry, fetchImpl = fetch, browserFetchImpl = fetchMerriamWebsterBrowserPage) {
  const lookupWord = cleanDictionaryText(entry?.english)
  if (!lookupWord) return { ok: false, available: true, message: "An English word is required for Merriam-Webster preview; no Library data was changed." }
  const sourceUrl = validMerriamWebsterUrl(`${MERRIAM_WEBSTER_BASE_URL}${encodeURIComponent(lookupWord)}`)
  let response
  try { response = await fetchWithExponentialBackoff(fetchImpl, sourceUrl, { headers: { Accept: "text/html", "User-Agent": "SIS-admin-Merriam-Webster-preview/1.0" }, redirect: "follow" }) } catch (error) { return { ok: false, available: false, message: `Merriam-Webster is unavailable; no Library data was changed. ${error.message}` } }
  if (!response.ok) {
    if (response.status !== 403) return { ok: false, available: false, message: `Merriam-Webster is unavailable (HTTP ${response.status || 503}); no Library data was changed.` }
    response = await browserFetchImpl(sourceUrl)
    if (!response?.ok) return { ok: false, status: response?.robotBlocked ? "robot_blocked" : undefined, available: false, message: response?.message || `Merriam-Webster is unavailable (HTTP ${response?.status || 503}); no Library data was changed.` }
  }
  let html
  try { html = typeof response.html === "string" ? response.html : await boundedDictionaryResponseText(response, MERRIAM_WEBSTER_MAX_HTML_BYTES) } catch (error) { return { ok: false, available: false, message: `Merriam-Webster is unavailable; no Library data was changed. ${error.message}` } }
  if (isMerriamWebsterAccessChallenge(html)) {
    response = await browserFetchImpl(sourceUrl)
    if (!response?.ok) return { ok: false, status: response?.robotBlocked ? "robot_blocked" : undefined, available: false, message: response?.message || "Merriam-Webster requires robot verification; open the source page and complete the prompt before retrying." }
    try { html = typeof response.html === "string" ? response.html : await boundedDictionaryResponseText(response, MERRIAM_WEBSTER_MAX_HTML_BYTES) } catch (error) { return { ok: false, available: false, message: `Merriam-Webster is unavailable; no Library data was changed. ${error.message}` } }
    if (isMerriamWebsterAccessChallenge(html)) return { ok: false, status: "robot_blocked", available: false, message: "Merriam-Webster requires robot verification because the source presented an access challenge; open the source page and complete the prompt before retrying." }
  }
  const finalUrl = response.url ? (() => { try { return validMerriamWebsterUrl(response.url) } catch { return sourceUrl } })() : sourceUrl
  return parseMerriamWebsterHtml(html, { sourceUrl: finalUrl, lookupWord })
}

export const merriamWebsterProvider = registerDictionaryProvider({ key: "merriam-webster", preview: previewMerriamWebsterDictionaryEntry })
