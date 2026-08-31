import { existsSync } from "node:fs"

import { load } from "cheerio"

import { registerDictionaryProvider } from "./dictionary-providers.mjs"
import { fetchWithExponentialBackoff } from "./provider-http.mjs"
import { boundedDictionaryResponseText, buildRichDictionaryFields, cleanDictionaryText, uniqueDictionaryText, validateDictionaryPageUrl } from "./rich-dictionary-provider.mjs"

export const BRITANNICA_HOSTNAMES = new Set(["britannica.com", "www.britannica.com"])
const BRITANNICA_AUDIO_HOSTNAMES = new Set(["media.merriam-webster.com", ...BRITANNICA_HOSTNAMES])
export const BRITANNICA_BASE_URL = "https://www.britannica.com/dictionary/"
export const BRITANNICA_MAX_HTML_BYTES = 3 * 1024 * 1024
const BRITANNICA_BROWSER_TIMEOUT_MS = 15_000
const BRITANNICA_BROWSER_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

function validBritannicaUrl(value) { return validateDictionaryPageUrl(value, BRITANNICA_HOSTNAMES, "/dictionary/") }
function collectText(node, selectors) {
  const matches = node.find(selectors)
  return uniqueDictionaryText(matches.map((index) => matches.eq(index).text()).get())
}
function isBritannicaAccessChallenge(html) { return /just a moment|enable javascript and cookies|cf-chl-|challenge-platform|access denied/iu.test(String(html || "")) }

const BRITANNICA_ENTRY_SELECTOR = "[data-dictionary-entry], .dict-entry, .dictionary-entry, .entry, .entry-word, .entry-content"
const BRITANNICA_HEADER_SELECTOR = ".hw_d, .headword, .hword, [data-headword], h1, h2"
const BRITANNICA_SENSE_SELECTOR = ".sblocks .sense, .sblock_c .sense, .sense, .def-block, .definition-block, [data-sense]"

function hasBritannicaSense(node) {
  return node.find(BRITANNICA_SENSE_SELECTOR).length > 0 || node.find(".def_text, .definition, .def, .dtText, [data-definition]").length > 0
}

function audioUrl(node) {
  const candidates = node.find("[data-src-mp3], audio source[type='audio/mpeg'], audio source[src], [data-audio-url], a[href]").map((_, child) => {
    const element = node.find(child)
    return element.attr("data-src-mp3") || element.attr("src") || element.attr("data-audio-url") || element.attr("href") || ""
  }).get()
  for (const candidate of candidates) {
    const value = cleanDictionaryText(candidate)
    if (!value) continue
    try {
      const parsed = new URL(value, "https://www.britannica.com")
      if (parsed.protocol === "https:" && BRITANNICA_AUDIO_HOSTNAMES.has(parsed.hostname.toLowerCase()) && /\/audio\//iu.test(parsed.pathname) && /\.(?:mp3|ogg|wav)$/iu.test(parsed.pathname)) return parsed.toString()
    } catch {}
  }
  const popup = node.find(".play_pron[data-lang='en_us'][data-dir][data-file], [data-lang='en_us'][data-dir][data-file]").first()
  const language = cleanDictionaryText(popup.attr("data-lang")).replace("_", "/")
  const directory = cleanDictionaryText(popup.attr("data-dir"))
  const file = cleanDictionaryText(popup.attr("data-file"))
  return language && directory && file ? `https://media.merriam-webster.com/audio/prons/${language}/mp3/${directory}/${file}.mp3` : ""
}

function collectBritannicaEntryScopes($) {
  const scopes = []
  const seen = new Set()
  const add = (scope) => {
    const element = scope?.[0]
    if (!element || seen.has(element) || !hasBritannicaSense(scope)) return
    seen.add(element)
    scopes.push(scope)
  }
  $(BRITANNICA_ENTRY_SELECTOR).each((_, node) => {
    const scope = $(node)
    if (scope.find(BRITANNICA_HEADER_SELECTOR).length && hasBritannicaSense(scope)) add(scope)
  })
  $("div.hw_d, [data-headword]").each((_, node) => {
    const header = $(node)
    const parentScope = header.closest(BRITANNICA_ENTRY_SELECTOR)
    if (parentScope.length && hasBritannicaSense(parentScope)) {
      add(parentScope)
      return
    }
    const siblingNodes = [node, ...header.nextUntil("div.hw_d, [data-headword]").toArray()]
    const siblingScope = $(siblingNodes)
    if (hasBritannicaSense(siblingScope)) add(siblingScope)
  })
  return scopes
}

export async function fetchBritannicaBrowserPage(sourceUrl) {
  let browser
  try {
    const { chromium } = await import("playwright")
    const launchOptions = { headless: true, args: ["--no-sandbox"] }
    const executablePath = process.env.BRITANNICA_BROWSER_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"
    if (existsSync(executablePath)) launchOptions.executablePath = executablePath
    browser = await chromium.launch(launchOptions)
    const context = await browser.newContext({ userAgent: BRITANNICA_BROWSER_USER_AGENT })
    const page = await context.newPage()
    const response = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: BRITANNICA_BROWSER_TIMEOUT_MS })
    const html = await page.content()
    const status = response?.status() || 200
    if (status >= 400 || isBritannicaAccessChallenge(html)) return { ok: false, status, robotBlocked: true, url: page.url(), html, message: "Britannica requires robot verification because the source presented an access challenge; open the source page and complete the prompt before retrying." }
    return { ok: true, status, url: page.url(), html }
  } catch (error) {
    return { ok: false, available: false, message: `Britannica browser access failed; no Library data was changed. ${error.message}` }
  } finally {
    await browser?.close().catch(() => {})
  }
}

function parseEntry(node, sourceUrl, index) {
  const headword = cleanDictionaryText(node.find(".hw_txt, .headword, .hword, [data-headword], h1, h2").first().text()).replace(/^\d+\s+/u, "")
  const partOfSpeech = cleanDictionaryText(node.find(".fl, .part-of-speech, .pos, [data-part-of-speech]").first().text()).toLowerCase()
  const labels = collectText(node, ".label, .usage, .grammar, .gram, .subtype, .register, .style, .sl, .sgram")
  const pronunciation = cleanDictionaryText(node.find(".hpron_word, .pron_w, [data-pronunciation]").first().text())
  const inflections = collectText(node, ".hw_infs_d .i_text, .hw_infs_m .i_text, .inflections li, [data-inflection]")
  const senses = []
  node.find(BRITANNICA_SENSE_SELECTOR).each((senseIndex, child) => {
    const senseNode = node.find(child)
    const definition = cleanDictionaryText(senseNode.find(".def_text, .definition, .def, .dtText, [data-definition]").first().text() || senseNode.clone().find(".example, .example-sentence, .vi, .vis, .synonyms, .collocations, .idioms, .phrases").remove().end().text())
    const senseLabels = collectText(senseNode, ".label, .usage, .grammar, .gram, .subtype, .register, .style, .sl, .sgram")
    const examples = collectText(senseNode, ".vi, .example, .example-sentence, [data-example]")
    if (!examples.length) examples.push(...collectText(senseNode, ".vis"))
    const blockNumber = cleanDictionaryText(senseNode.closest(".sblock").find(".sn_block_num").first().text())
    const senseLetter = cleanDictionaryText(senseNode.find(".sn_letter, [data-sense-letter]").first().text()).replace(/[.)]$/u, "")
    const number = cleanDictionaryText(senseNode.find(".sense-number, .num, .snum, .sn, [data-sense-number]").first().text()) || `${blockNumber}${senseLetter}`.trim() || String(senseIndex + 1)
    if (definition || examples.length) senses.push({ number, labels: senseLabels.length ? senseLabels : labels, definition, examples })
  })
  if (!senses.length) {
    const definitions = collectText(node, ".def_text, .definition, .def, .dtText, [data-definition]")
    definitions.forEach((definition, senseIndex) => senses.push({ number: String(senseIndex + 1), labels, definition, examples: [] }))
  }
  return { headword, partOfSpeech, labels, pronunciation: { us: pronunciation, uk: "" }, inflections, senses, sourceUrl, audio: { us: audioUrl(node), uk: "" } }
}

function parseRelatedEntry(node, sourceUrl) {
  const headword = cleanDictionaryText(node.find(".ure, [data-headword], h2, h3").first().text()).replace(/^[-–—]\s*/u, "")
  const partOfSpeech = cleanDictionaryText(node.find(".uro_line .fl, .fl, .part-of-speech, .pos, [data-part-of-speech]").first().text()).toLowerCase()
  const labels = collectText(node, ".label, .usage, .grammar, .gram, .subtype, .register, .style, .sl, .sgram")
  const pronunciation = cleanDictionaryText(node.find(".pron_w, .hpron_word, [data-pronunciation]").first().text())
  const examples = collectText(node, ".vi, .example, .example-sentence, [data-example]")
  if (!examples.length) examples.push(...collectText(node, ".vis"))
  const senses = examples.length ? [{ number: "1", labels, definition: "", examples }] : []
  return { headword, partOfSpeech, labels, pronunciation: { us: pronunciation, uk: "" }, inflections: [], senses, sourceUrl, audio: { us: "", uk: "" } }
}

export function parseBritannicaHtml(html, { sourceUrl = "", lookupWord = "" } = {}) {
  const normalizedSourceUrl = sourceUrl ? validBritannicaUrl(sourceUrl) : ""
  const $ = load(String(html || ""))
  const parsedEntries = collectBritannicaEntryScopes($).flatMap((node, index) => {
    const primaryEntry = parseEntry(node, normalizedSourceUrl, index)
    const relatedEntries = node.find(".uros .uro, .related-entries .related-entry, [data-related-entry]").map((_, child) => parseRelatedEntry(node.find(child), normalizedSourceUrl)).get()
    return [primaryEntry, ...relatedEntries].filter((entry) => entry.senses.length)
  })
  const sourceRoot = $("body")
  const etymology = collectText(sourceRoot, ".etymology, .word-history, .history, .et, [data-etymology]")
  const firstKnownUse = collectText(sourceRoot, ".first-known-use, [data-first-known-use]")
  const synonyms = collectText(sourceRoot, ".synonyms li, .synonym li, .synonym, .syns li, [data-synonym]")
  const antonyms = collectText(sourceRoot, ".antonyms li, .antonym li, .antonym, .ants li, [data-antonym]")
  const stems = collectText(sourceRoot, ".stems li, .stem li, .stem, [data-stem]")
  const collocations = collectText(sourceRoot, ".collocations li, .collocation li, .collocation, [data-collocation]")
  const idioms = collectText(sourceRoot, ".idioms li, .idiom li, .idiom, [data-idiom]")
  const phrases = collectText(sourceRoot, ".phrases li, .phrase li, .phrase, [data-phrase]")
  const moreExamples = collectText(sourceRoot, ".more-examples li, .extra-examples li, [data-more-example], [data-extra-example]")
  if (!parsedEntries.length) return { ok: false, available: true, message: `No Britannica entry was found for ${cleanDictionaryText(lookupWord) || "the requested word"}; no Library data was changed.` }
  const richFields = buildRichDictionaryFields({ provider: "britannica", sourceName: "Britannica Dictionary", sourceUrl: normalizedSourceUrl, word: lookupWord, entries: parsedEntries, etymology, firstKnownUse, synonyms, collocations, idioms, phrases, includePartOfSpeechHeadings: true })
  const addSection = (definition, title, values) => {
    const items = uniqueDictionaryText(values)
    return items.length ? `${definition}\n\n**${title}:**\n${items.map((item) => `- ${item}`).join("\n")}` : definition
  }
  const definition = [
    ["Stems", stems],
    ["Antonyms", antonyms],
    ["More Examples", moreExamples],
  ].reduce((value, [title, values]) => addSection(value, title, values), richFields.definition)
  return { ok: true, provider: "britannica", sourceUrl: normalizedSourceUrl, lookupWord: cleanDictionaryText(lookupWord), entries: parsedEntries, fields: { ...richFields, definition, dictionaryMetadata: { ...richFields.dictionaryMetadata, additionalSections: { stems, synonyms, antonyms, moreExamples } } } }
}

export function sanitizeBritannicaPreview(preview) {
  if (!preview?.ok) return preview
  const fields = { ...preview.fields }
  delete fields.dictionaryMetadata
  return { ...preview, fields }
}

export async function previewBritannicaLibraryEntry(entry, fetchImpl = fetch, browserFetchImpl = fetchBritannicaBrowserPage) {
  const lookupWord = cleanDictionaryText(entry?.english)
  if (!lookupWord) return { ok: false, available: true, message: "An English word is required for Britannica preview; no Library data was changed." }
  const sourceUrl = validBritannicaUrl(`${BRITANNICA_BASE_URL}${encodeURIComponent(lookupWord)}`)
  let response
  try { response = await fetchWithExponentialBackoff(fetchImpl, sourceUrl, { headers: { Accept: "text/html", "User-Agent": "SIS-admin-Britannica-preview/1.0" }, redirect: "follow" }) } catch (error) { return { ok: false, available: false, message: `Britannica is unavailable; no Library data was changed. ${error.message}` } }
  if (!response.ok) {
    if (response.status !== 403) return { ok: false, available: false, message: `Britannica is unavailable (HTTP ${response.status || 503}); no Library data was changed.` }
    response = await browserFetchImpl(sourceUrl)
    if (!response?.ok) return { ok: false, status: response?.robotBlocked ? "robot_blocked" : undefined, available: false, message: response?.message || `Britannica is unavailable (HTTP ${response?.status || 503}); no Library data was changed.` }
  }
  let html
  try { html = typeof response.html === "string" ? response.html : await boundedDictionaryResponseText(response, BRITANNICA_MAX_HTML_BYTES) } catch (error) { return { ok: false, available: false, message: `Britannica is unavailable; no Library data was changed. ${error.message}` } }
  const finalUrl = response.url ? (() => { try { return validBritannicaUrl(response.url) } catch { return sourceUrl } })() : sourceUrl
  if (isBritannicaAccessChallenge(html)) {
    response = await browserFetchImpl(sourceUrl)
    if (!response?.ok) return { ok: false, status: response?.robotBlocked ? "robot_blocked" : undefined, available: false, message: response?.message || "Britannica requires robot verification because the source presented an access challenge; open the source page and complete the prompt before retrying." }
    try { html = typeof response.html === "string" ? response.html : await boundedDictionaryResponseText(response, BRITANNICA_MAX_HTML_BYTES) } catch (error) { return { ok: false, available: false, message: `Britannica is unavailable; no Library data was changed. ${error.message}` } }
    if (isBritannicaAccessChallenge(html)) return { ok: false, status: "robot_blocked", available: false, message: "Britannica requires robot verification because the source presented an access challenge; open the source page and complete the prompt before retrying." }
  }
  const browserFinalUrl = response.url ? (() => { try { return validBritannicaUrl(response.url) } catch { return sourceUrl } })() : sourceUrl
  return parseBritannicaHtml(html, { sourceUrl: browserFinalUrl || finalUrl, lookupWord })
}

export const britannicaProvider = registerDictionaryProvider({ key: "britannica", preview: previewBritannicaLibraryEntry })
