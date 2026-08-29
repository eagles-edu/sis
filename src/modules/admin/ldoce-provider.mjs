import { load } from "cheerio"

import { registerDictionaryProvider } from "./dictionary-providers.mjs"
import { fetchWithExponentialBackoff } from "./provider-http.mjs"

export const LDOCE_HOSTNAMES = new Set(["ldoceonline.com", "www.ldoceonline.com"])
export const LDOCE_BASE_URL = "https://www.ldoceonline.com/dictionary/"
export const LDOCE_MAX_HTML_BYTES = 2 * 1024 * 1024
const LDOCE_LABEL_EXPANSIONS = new Map([
  ["c", "countable"],
  ["u", "uncountable"],
  ["t", "transitive"],
  ["i", "intransitive"],
  ["singular", "singular"],
  ["plural", "plural"],
])

function text(value) {
  return String(value == null ? "" : value).replace(/\s+/gu, " ").trim()
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))]
}

function expandLdoceLabels(value) {
  return text(value).replace(/\[([^\]]+)\]/gu, (_, label) => LDOCE_LABEL_EXPANSIONS.get(text(label).toLowerCase()) || text(label))
}

function italicizeLdoceLabels(value) {
  return text(value).replace(/\[([^\]]+)\]/gu, (_, label) => `*${LDOCE_LABEL_EXPANSIONS.get(text(label).toLowerCase()) || text(label)}*`)
}

function validLdoceUrl(value) {
  const parsed = new URL(value)
  if (parsed.protocol !== "https:" || !LDOCE_HOSTNAMES.has(parsed.hostname.toLowerCase())) throw new Error("LDOCE URL host is not allowed")
  return parsed.toString()
}

async function boundedResponseText(response) {
  const contentLength = Number.parseInt(response.headers.get("content-length") || "0", 10)
  if (contentLength > LDOCE_MAX_HTML_BYTES) throw new Error("LDOCE response exceeded the permitted size")
  if (!response.body) {
    const fallback = await response.text()
    if (Buffer.byteLength(fallback) > LDOCE_MAX_HTML_BYTES) throw new Error("LDOCE response exceeded the permitted size")
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
      if (total > LDOCE_MAX_HTML_BYTES) throw new Error("LDOCE response exceeded the permitted size")
      chunks.push(Buffer.from(next.value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString("utf8")
}

function audioUrl(node, selector) {
  const value = text(node.find(selector).first().attr("data-src-mp3"))
  if (!value) return ""
  try {
    return validLdoceUrl(value)
  } catch {
    return ""
  }
}

function parsePronunciation(node) {
  return {
    uk: text(node.find(".PronCodes .PRON").first().text()) || text(node.find(".PronCodes .neutral").first().text()),
    us: text(node.find(".PronCodes .AMEVARPRON").first().text()) || text(node.find(".PronCodes .AMEPRON").first().text()),
  }
}

function parseInflections(node) {
  const values = []
  node.find(".Inflections, .verbTable .simpleForm, .verbTable .continuousForm").each((_, child) => {
    const value = text(node.find(child).text())
    if (value) values.push(value)
  })
  return unique(values)
}

function parseExamples(sense) {
  const examples = []
  sense.find(".EXAMPLE").each((_, example) => {
    const source = sense.find(example)
    const exampleText = text(source.clone().find(".speaker").remove().end().text())
    const exampleAudio = audioUrl(source, ".speaker.exafile, .speaker")
    if (exampleText) examples.push({ text: exampleText, audioUrl: exampleAudio })
  })
  return examples
}

function parseSense(sense, index) {
  const grammar = unique(sense.find(".GRAM").map((_, node) => text(sense.find(node).text())).get())
  const activation = unique(sense.find(".ACTIV").map((_, node) => text(sense.find(node).text())).get())
  const definition = text(sense.find(".DEF").first().text())
  return {
    number: text(sense.find(".sensenum").first().text()) || String(index + 1),
    grammar,
    activation,
    definition,
    examples: parseExamples(sense),
  }
}

function parseEntry(node, sourceUrl) {
  const head = node.find(".frequent.Head, .Head").first()
  const senses = []
  node.find(".Sense").each((index, sense) => {
    const parsed = parseSense(node.find(sense), index)
    if (parsed.definition || parsed.examples.length) senses.push(parsed)
  })
  const relatedTopics = unique(node.find(".Crossref a").map((_, link) => text(node.find(link).text())).get())
  return {
    headword: text(head.find(".HWD").first().text()),
    homonym: text(head.find(".HOMNUM").first().text()),
    hyphenation: text(head.find(".HYPHENATION").first().text()),
    partOfSpeech: text(head.find(".POS").first().text()).toLowerCase(),
    pronunciation: parsePronunciation(head),
    inflections: parseInflections(node),
    relatedTopics,
    audio: { uk: audioUrl(head, ".brefile"), us: audioUrl(head, ".amefile") },
    senses,
    sourceUrl,
  }
}

function collectGrammar(entries) {
  const labels = unique(entries.flatMap((entry) => entry.senses.flatMap((sense) => [...sense.grammar, ...sense.activation])))
  const codes = unique(labels.flatMap((label) => [...label.matchAll(/\[([A-Z])\]/gu)].map((match) => match[1])))
  return { labels, codes }
}

function ldoceFields(fieldEntries, definitionEntries = fieldEntries) {
  const { labels, codes } = collectGrammar(fieldEntries)
  const firstPos = fieldEntries[0]?.partOfSpeech || ""
  const blocks = []
  for (const entry of definitionEntries) {
    for (const sense of entry.senses) {
      const label = [...sense.grammar, ...sense.activation].map(italicizeLdoceLabels).join(", ")
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
    dictionaryProvider: "ldoce",
    dictionarySourceUrl: definitionEntries[0]?.sourceUrl || "",
    dictionaryMetadata: { provider: "ldoce", entries: definitionEntries },
    grammarClassification: {
      grammarFamily: "ldoce",
      grammarSubtype: codes.map((code) => expandLdoceLabels(`[${code}]`)).join(", "),
      grammarDetail: labels.map(expandLdoceLabels).join("; "),
    },
  }
  if (["noun", "proper noun"].includes(firstPos)) {
    if (codes.includes("C") && codes.includes("U")) fields.countability = "countable_and_uncountable"
    else if (codes.includes("C")) fields.countability = "countable"
    else if (codes.includes("U")) fields.countability = "uncountable"
  }
  if (firstPos === "verb") {
    if (codes.includes("T") && codes.includes("I")) fields.verbTransitivity = "ambitransitive"
    else if (codes.includes("T")) fields.verbTransitivity = "transitive"
    else if (codes.includes("I")) fields.verbTransitivity = "intransitive"
  }
  return fields
}

export function sanitizeLdocePreview(preview) {
  if (!preview?.ok) return preview
  const fields = { ...preview.fields }
  delete fields.dictionaryMetadata
  const { selectedEntries, ...safePreview } = preview
  return {
    ...safePreview,
    fields,
    entries: preview.entries.map((entry) => {
      const { audio, senses, ...safeEntry } = entry
      return {
        ...safeEntry,
        audio: { uk: Boolean(audio?.uk), us: Boolean(audio?.us) },
        senses: (senses || []).map((sense) => ({
          ...sense,
          examples: (sense.examples || []).map((example) => {
            const { audioUrl, ...safeExample } = example
            return { ...safeExample, audioAvailable: Boolean(audioUrl) }
          }),
        })),
      }
    }),
  }
}

export function parseLdoceHtml(html, { sourceUrl = "", lookupWord = "", partOfSpeech = "" } = {}) {
  const normalizedSourceUrl = sourceUrl ? validLdoceUrl(sourceUrl) : ""
  const $ = load(String(html || ""))
  const parsedEntries = $("span.dictentry, .dictentry").map((_, node) => parseEntry($(node), normalizedSourceUrl)).get().filter((entry) => entry.headword || entry.senses.length)
  const requested = text(partOfSpeech).toLowerCase()
  const selectedEntries = requested ? parsedEntries.filter((entry) => entry.partOfSpeech === requested) : parsedEntries
  if (!parsedEntries.length) return { ok: false, available: true, message: `No LDOCE ${requested || ""} entry was found for ${text(lookupWord) || "the requested word"}; no Library data was changed.`.replace(/\s+/gu, " ") }
  return { ok: true, provider: "ldoce", sourceUrl: normalizedSourceUrl, lookupWord: text(lookupWord), entries: parsedEntries, selectedEntries, fields: ldoceFields(selectedEntries, parsedEntries) }
}

export async function previewLdoceLibraryEntry(entry, fetchImpl = fetch) {
  const lookupWord = text(entry?.english)
  if (!lookupWord) return { ok: false, available: true, message: "An English word is required for LDOCE preview; no Library data was changed." }
  const sourceUrl = validLdoceUrl(`${LDOCE_BASE_URL}${encodeURIComponent(lookupWord)}`)
  let response
  try {
    response = await fetchWithExponentialBackoff(fetchImpl, sourceUrl, { headers: { Accept: "text/html", "User-Agent": "SIS-admin-LDOCE-preview/1.0" }, redirect: "follow" })
  } catch (error) {
    return { ok: false, available: false, message: `LDOCE is unavailable; no Library data was changed. ${error.message}` }
  }
  if (!response.ok) return { ok: false, available: false, message: `LDOCE is unavailable (HTTP ${response.status || 503}); no Library data was changed.` }
  let html
  try {
    html = await boundedResponseText(response)
  } catch (error) {
    return { ok: false, available: false, message: `LDOCE is unavailable; no Library data was changed. ${error.message}` }
  }
  const finalUrl = response.url ? validLdoceUrl(response.url) : sourceUrl
  return parseLdoceHtml(html, { sourceUrl: finalUrl, lookupWord, partOfSpeech: text(entry?.partOfSpeech) })
}

export const ldoceProvider = registerDictionaryProvider({ key: "ldoce", preview: previewLdoceLibraryEntry })
