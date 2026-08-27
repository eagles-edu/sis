import { load } from "cheerio"

import { registerDictionaryProvider } from "./dictionary-providers.mjs"

export const OXFORD_HOSTNAMES = new Set(["oxfordlearnersdictionaries.com", "www.oxfordlearnersdictionaries.com"])
export const OXFORD_BASE_URL = "https://www.oxfordlearnersdictionaries.com/definition/american_english/"
export const OXFORD_MAX_HTML_BYTES = 2 * 1024 * 1024

function text(value) { return String(value == null ? "" : value).replace(/\s+/gu, " ").trim() }
function unique(values) { return [...new Set(values.map(text).filter(Boolean))] }

function validOxfordUrl(value) {
  const parsed = new URL(value)
  if (parsed.protocol !== "https:" || !OXFORD_HOSTNAMES.has(parsed.hostname.toLowerCase())) throw new Error("Oxford URL host is not allowed")
  if (!parsed.pathname.startsWith("/definition/american_english/")) throw new Error("Oxford URL path is not allowed")
  return parsed.toString()
}

async function boundedResponseText(response) {
  const contentLength = Number.parseInt(response.headers.get("content-length") || "0", 10)
  if (contentLength > OXFORD_MAX_HTML_BYTES) throw new Error("Oxford response exceeded the permitted size")
  if (!response.body) {
    const fallback = await response.text()
    if (Buffer.byteLength(fallback) > OXFORD_MAX_HTML_BYTES) throw new Error("Oxford response exceeded the permitted size")
    return fallback
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > OXFORD_MAX_HTML_BYTES) throw new Error("Oxford response exceeded the permitted size")
      chunks.push(Buffer.from(next.value))
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks).toString("utf8")
}

function audioUrl(node) {
  const value = text(node.find(".sound[data-src-mp3]").first().attr("data-src-mp3"))
  if (!value) return ""
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:" || !OXFORD_HOSTNAMES.has(parsed.hostname.toLowerCase())) return ""
    return parsed.toString()
  } catch { return "" }
}

function parsePronunciation(node) {
  const phon = text(node.find(".phon").first().text())
  return { us: phon.replace(/^NAmE\s*/u, "").trim() }
}

function parseSense(node, index) {
  const grammar = unique(node.find(".gram").map((_, child) => text(node.find(child).text())).get())
  const definition = text(node.find(".def").first().text())
  const examples = []
  node.find(".x").each((_, child) => {
    const example = text(node.find(child).text())
    if (example) examples.push({ text: example, audioUrl: "" })
  })
  return { number: text(node.find(".num").first().text()) || String(index + 1), grammar, activation: [], definition, examples }
}

function parseEntry(node, sourceUrl) {
  const headword = text(node.find(".webtop-g .h, .top-g .h").first().text())
  const partOfSpeech = text(node.find(".webtop-g .pos, .top-g .pos").first().text()).toLowerCase()
  const senses = []
  node.find(".sn-g").each((index, child) => {
    const sense = parseSense(node.find(child), index)
    if (sense.definition || sense.examples.length) senses.push(sense)
  })
  return { headword, homonym: "", hyphenation: "", partOfSpeech, pronunciation: parsePronunciation(node), inflections: [], relatedTopics: [], audio: { uk: "", us: audioUrl(node) }, senses, sourceUrl }
}

function italicizeLabels(value) {
  const label = text(value)
  return label ? `*${label.replace(/^\[|\]$/gu, "")}*` : ""
}

function oxfordFields(fieldEntries, definitionEntries = fieldEntries) {
  const labels = unique(fieldEntries.flatMap((entry) => entry.senses.flatMap((sense) => [...sense.grammar, ...sense.activation])))
  const lowerLabels = labels.map((label) => label.toLowerCase())
  const firstPos = fieldEntries[0]?.partOfSpeech || ""
  const blocks = []
  for (const entry of definitionEntries) {
    for (const sense of entry.senses) {
      const label = [...sense.grammar, ...sense.activation].map(italicizeLabels).join(", ")
      const body = [label, sense.definition].filter(Boolean).join(" — ")
      const number = String(sense.number || blocks.length + 1)
      const block = [`${number}. ${body}`.trim()]
      const exampleIndent = " ".repeat(number.length + 2)
      for (const example of sense.examples) block.push(`${exampleIndent}- ${example.text}`)
      blocks.push(block.join("\n"))
    }
  }
  const fields = {
    definition: blocks.join("\n\n"),
    dictionaryProvider: "oxford",
    dictionarySourceUrl: definitionEntries[0]?.sourceUrl || "",
    dictionaryMetadata: { provider: "oxford", entries: definitionEntries },
    grammarClassification: {
      grammarFamily: "oxford",
      grammarSubtype: labels.join(", "),
      grammarDetail: labels.join("; "),
    },
  }
  if (["noun", "proper noun"].includes(firstPos)) {
    const countable = lowerLabels.some((label) => label.includes("countable") && !label.includes("uncountable"))
    const uncountable = lowerLabels.some((label) => label.includes("uncountable"))
    if (countable && uncountable) fields.countability = "countable_and_uncountable"
    else if (countable) fields.countability = "countable"
    else if (uncountable) fields.countability = "uncountable"
  }
  if (firstPos === "verb") {
    const transitive = lowerLabels.some((label) => label.includes("transitive") && !label.includes("intransitive"))
    const intransitive = lowerLabels.some((label) => label.includes("intransitive"))
    if (transitive && intransitive) fields.verbTransitivity = "ambitransitive"
    else if (transitive) fields.verbTransitivity = "transitive"
    else if (intransitive) fields.verbTransitivity = "intransitive"
  }
  return fields
}

export function sanitizeOxfordPreview(preview) {
  if (!preview?.ok) return preview
  const fields = { ...preview.fields }
  delete fields.dictionaryMetadata
  const { selectedEntries, ...safePreview } = preview
  return {
    ...safePreview,
    fields,
    entries: preview.entries.map((entry) => ({
      ...entry,
      audio: { uk: false, us: Boolean(entry.audio?.us) },
      senses: (entry.senses || []).map((sense) => ({
        ...sense,
        examples: (sense.examples || []).map((example) => ({ text: example.text, audioAvailable: false })),
      })),
    })),
  }
}

export function parseOxfordHtml(html, { sourceUrl = "", lookupWord = "", partOfSpeech = "" } = {}) {
  const normalizedSourceUrl = sourceUrl ? validOxfordUrl(sourceUrl) : ""
  const $ = load(String(html || ""))
  const parsedEntries = $("#entryContent > .entry, #entryContent .entry").map((_, node) => parseEntry($(node), normalizedSourceUrl)).get().filter((entry) => entry.headword || entry.senses.length)
  const requested = text(partOfSpeech).toLowerCase()
  const selectedEntries = requested ? parsedEntries.filter((entry) => entry.partOfSpeech === requested) : parsedEntries
  if (!parsedEntries.length) return { ok: false, available: true, message: `No Oxford ${requested || ""} entry was found for ${text(lookupWord) || "the requested word"}; no Library data was changed.`.replace(/\s+/gu, " ") }
  return { ok: true, provider: "oxford", sourceUrl: normalizedSourceUrl, lookupWord: text(lookupWord), entries: parsedEntries, selectedEntries, fields: oxfordFields(selectedEntries, parsedEntries) }
}

export async function previewOxfordLibraryEntry(entry, fetchImpl = fetch) {
  const lookupWord = text(entry?.english)
  if (!lookupWord) return { ok: false, available: true, message: "An English word is required for Oxford preview; no Library data was changed." }
  const slug = encodeURIComponent(lookupWord.replace(/\s+/gu, "-"))
  const sourceUrl = validOxfordUrl(`${OXFORD_BASE_URL}${slug}?q=${encodeURIComponent(lookupWord)}`)
  let response
  try {
    response = await fetchImpl(sourceUrl, { headers: { Accept: "text/html", "User-Agent": "SIS-admin-Oxford-preview/1.0" }, redirect: "follow" })
  } catch (error) { return { ok: false, available: false, message: `Oxford is unavailable; no Library data was changed. ${error.message}` } }
  if (!response.ok) return { ok: false, available: false, message: `Oxford is unavailable (HTTP ${response.status || 503}); no Library data was changed.` }
  let html
  try { html = await boundedResponseText(response) } catch (error) { return { ok: false, available: false, message: `Oxford is unavailable; no Library data was changed. ${error.message}` } }
  let finalUrl
  try { finalUrl = response.url ? validOxfordUrl(response.url) : sourceUrl } catch { finalUrl = sourceUrl }
  return parseOxfordHtml(html, { sourceUrl: finalUrl, lookupWord, partOfSpeech: text(entry?.partOfSpeech) })
}

export const oxfordProvider = registerDictionaryProvider({ key: "oxford", preview: previewOxfordLibraryEntry })
