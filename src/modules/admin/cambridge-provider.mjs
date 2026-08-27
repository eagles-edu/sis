import { load } from "cheerio"

import { registerDictionaryProvider } from "./dictionary-providers.mjs"

export const CAMBRIDGE_HOSTNAMES = new Set(["dictionary.cambridge.org"])
export const CAMBRIDGE_BASE_URL = "https://dictionary.cambridge.org/dictionary/english/"
export const CAMBRIDGE_MAX_HTML_BYTES = 3 * 1024 * 1024

function text(value) { return String(value == null ? "" : value).replace(/\s+/gu, " ").trim() }
function validUrl(value) {
  const parsed = new URL(value)
  const validPath = parsed.pathname.startsWith("/dictionary/english/") || parsed.pathname.startsWith("/us/dictionary/english/")
  if (parsed.protocol !== "https:" || !CAMBRIDGE_HOSTNAMES.has(parsed.hostname.toLowerCase()) || !validPath) throw new Error("Cambridge URL host or path is not allowed")
  return parsed.toString()
}
async function boundedText(response) {
  const contentLength = Number.parseInt(response.headers.get("content-length") || "0", 10)
  if (contentLength > CAMBRIDGE_MAX_HTML_BYTES) throw new Error("Cambridge response exceeded the permitted size")
  const html = await response.text()
  if (Buffer.byteLength(html) > CAMBRIDGE_MAX_HTML_BYTES) throw new Error("Cambridge response exceeded the permitted size")
  return html
}
function pronunciationToSyllabication(value) {
  const pronunciation = text(value).replace(/[\/]/gu, "")
  if (!pronunciation) return ""
  const marked = pronunciation.replace(/·/gu, "-")
  if (marked.includes("-")) return marked.replace(/ˈ([^\s-]+)/u, (_, syllable) => syllable.toUpperCase()).replace(/ˈ/gu, "")
  const stress = marked.indexOf("ˈ")
  if (stress < 0) return marked
  const before = marked.slice(0, stress).replace(/[ˌˈ]/gu, "")
  const after = marked.slice(stress + 1).replace(/[ˌˈ]/gu, "")
  return before && after ? `${before}-${after.toUpperCase()}` : after.toUpperCase()
}
function parseEntry($, node, sourceUrl) {
  const root = $(node)
  const headword = text(root.find(".dpos-h_hw .hw, .di-title .hw").first().text())
  const partOfSpeech = text(root.find(".pos.dpos").first().text()).toLowerCase()
  const pronunciation = text(root.find(".pron .ipa").first().text())
  const senses = root.find(".def-block").map((index, senseNode) => {
    const sense = $(senseNode)
    const definition = text(sense.find(".def").first().text())
    const examples = sense.find(".eg").map((_, example) => ({ text: text($(example).text()), audioUrl: "" })).get().filter((item) => item.text)
    return { number: text(sense.find(".sense-num, .num").first().text()) || String(index + 1), grammar: [], activation: [], definition, examples }
  }).get().filter((sense) => sense.definition || sense.examples.length)
  const audio = {}
  for (const region of ["uk", "us"]) {
    const source = root.find(`.${region} source[type="audio/mpeg"]`).first().attr("src")
    if (source) audio[region] = new URL(source, "https://dictionary.cambridge.org").toString()
  }
  return { headword, partOfSpeech, hyphenation: pronunciationToSyllabication(pronunciation), pronunciation: { uk: pronunciation, us: pronunciation }, inflections: [], senses, sourceUrl, audio }
}
export function parseCambridgeHtml(html, { sourceUrl = "", lookupWord = "", partOfSpeech = "" } = {}) {
  const normalizedSourceUrl = sourceUrl ? validUrl(sourceUrl) : ""
  const $ = load(String(html || ""))
  const parsedEntries = $(".entry-body__el").map((_, node) => parseEntry($, node, normalizedSourceUrl)).get().filter((entry) => entry.headword || entry.senses.length)
  const requested = text(partOfSpeech).toLowerCase()
  const selectedEntries = requested ? parsedEntries.filter((entry) => entry.partOfSpeech === requested) : parsedEntries
  if (!parsedEntries.length) return { ok: false, available: true, message: `No Cambridge entry was found for ${text(lookupWord) || "the requested word"}; no Library data was changed.` }
  return { ok: true, provider: "cambridge", sourceUrl: normalizedSourceUrl, lookupWord: text(lookupWord), entries: parsedEntries, selectedEntries, fields: { syllabication: selectedEntries[0]?.hyphenation || parsedEntries[0]?.hyphenation || "" } }
}
export async function previewCambridgeLibraryEntry(entry, fetchImpl = fetch) {
  const lookupWord = text(entry?.english)
  if (!lookupWord) return { ok: false, available: true, message: "An English word is required for Cambridge preview; no Library data was changed." }
  const sourceUrl = validUrl(`${CAMBRIDGE_BASE_URL}${encodeURIComponent(lookupWord.replace(/\s+/gu, "-"))}`)
  let response
  try { response = await fetchImpl(sourceUrl, { headers: { Accept: "text/html", "User-Agent": "SIS-admin-Cambridge-preview/1.0" }, redirect: "follow" }) } catch (error) { return { ok: false, available: false, message: `Cambridge is unavailable; no Library data was changed. ${error.message}` } }
  if (!response.ok) return { ok: false, available: false, message: `Cambridge is unavailable (HTTP ${response.status || 503}); no Library data was changed.` }
  try { return parseCambridgeHtml(await boundedText(response), { sourceUrl: response.url || sourceUrl, lookupWord, partOfSpeech: text(entry?.partOfSpeech) }) } catch (error) { return { ok: false, available: false, message: `Cambridge is unavailable; no Library data was changed. ${error.message}` } }
}

export const cambridgeProvider = registerDictionaryProvider({ key: "cambridge", preview: previewCambridgeLibraryEntry })
