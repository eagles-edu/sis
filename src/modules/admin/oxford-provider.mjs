import { load } from "cheerio"

import { registerDictionaryProvider } from "./dictionary-providers.mjs"
import { fetchWithExponentialBackoff } from "./provider-http.mjs"

export const OXFORD_HOSTNAMES = new Set(["oxfordlearnersdictionaries.com", "www.oxfordlearnersdictionaries.com"])
export const OXFORD_BASE_URL = "https://www.oxfordlearnersdictionaries.com/definition/american_english/"
export const OXFORD_BRE_BASE_URL = "https://www.oxfordlearnersdictionaries.com/definition/english/"
export const OXFORD_MAX_HTML_BYTES = 2 * 1024 * 1024

function text(value) { return String(value == null ? "" : value).replace(/\s+/gu, " ").trim() }
function unique(values) { return [...new Set(values.map(text).filter(Boolean))] }

function validOxfordUrl(value) {
  const parsed = new URL(value)
  if (parsed.protocol !== "https:" || !OXFORD_HOSTNAMES.has(parsed.hostname.toLowerCase())) throw new Error("Oxford URL host is not allowed")
  if (!parsed.pathname.startsWith("/definition/american_english/") && !parsed.pathname.startsWith("/definition/english/")) throw new Error("Oxford URL path is not allowed")
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

function validAudioUrl(value) {
  if (!value) return ""
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:" || !OXFORD_HOSTNAMES.has(parsed.hostname.toLowerCase())) return ""
    return parsed.toString()
  } catch { return "" }
}

function audioSources(node) {
  const sound = node.find(".sound").first()
  return {
    mp3: validAudioUrl(text(sound.attr("data-src-mp3"))),
    ogg: validAudioUrl(text(sound.attr("data-src-ogg"))),
  }
}

function audioUrl(node) {
  return audioSources(node).mp3
}

function verbFormAudio(node) {
  const formKeys = { root: "verbV1", thirdps: "verbV5", past: "verbV2", pastpart: "verbV3", prespart: "verbV4" }
  const result = {}
  node.find(".verb_forms_table tr.verb_form, [unbox=\"verbforms\"] .vp-g[form]").each((_, child) => {
    const row = node.find(child)
    const field = formKeys[text(row.attr("form"))]
    const americanPronunciation = row.find(".phons_n_am").first()
    const sources = audioSources(americanPronunciation.length ? americanPronunciation : row)
    if (field && sources.mp3) result[field] = { us: sources.mp3, ogg: sources.ogg }
  })
  if (result.verbV2) {
    result.verbV3 = {
      us: result.verbV3?.us || result.verbV2.us,
      ogg: result.verbV3?.ogg || result.verbV2.ogg,
    }
  }
  return result
}

function verbForms(node) {
  const formKeys = { root: "verbV1", thirdps: "verbV5", past: "verbV2", pastpart: "verbV3", prespart: "verbV4" }
  const result = {}
  node.find(".verb_forms_table tr.verb_form, [unbox=\"verbforms\"] .vp-g[form]").each((_, child) => {
    const row = node.find(child)
    const field = formKeys[text(row.attr("form"))]
    const cell = row.find("td.verb_form, td.form").first()
    const form = cell.length
      ? text(cell.text())
      : text(row.find(".vp").first().clone().find(".prefix").remove().end().text())
    if (field && form) result[field] = form
  })
  return result
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
  const headwordAudio = audioSources(node)
  return { headword, homonym: "", hyphenation: "", partOfSpeech, pronunciation: parsePronunciation(node), inflections: [], verbForms: verbForms(node), verbFormAudio: verbFormAudio(node), relatedTopics: [], audio: { uk: "", us: headwordAudio.mp3, ogg: headwordAudio.ogg }, senses, sourceUrl }
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
    const forms = definitionEntries.find((entry) => Object.keys(entry.verbForms || {}).length)?.verbForms || {}
    fields.verbForms = {
      verbInfinitive: forms.verbV1 ? `to ${forms.verbV1}` : "",
      verbV1: forms.verbV1 || "",
      verbV2: forms.verbV2 || "",
      verbV3: forms.verbV3 || "",
      verbV4: forms.verbV4 || "",
      verbV5: forms.verbV5 || "",
    }
    if (!Object.values(fields.verbForms).some(Boolean)) delete fields.verbForms
    const formAudio = definitionEntries.find((entry) => Object.keys(entry.verbFormAudio || {}).length)?.verbFormAudio || {}
    if (Object.keys(formAudio).length) fields.verbFormAudio = formAudio
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

function findOxfordPosUrl(html, lookupWord, partOfSpeech) {
  const requestedWord = text(lookupWord).toLocaleLowerCase("en-US")
  const requestedPos = text(partOfSpeech).toLocaleLowerCase("en-US")
  if (!requestedWord || !requestedPos) return ""
  const $ = load(String(html || ""))
  const links = $(".responsive_row.nearby a[href], .nearby a[href], a[href][title]").toArray()
  for (const node of links) {
    const link = $(node)
    const href = link.attr("href") || ""
    const word = text(link.find("data.hwd, .hwd").first().text() || link.text()).toLocaleLowerCase("en-US")
    const title = text(link.attr("title")).toLocaleLowerCase("en-US")
    if (!word.startsWith(requestedWord) || !(title.includes(requestedPos) || text(link.find("pos").first().text()).toLocaleLowerCase("en-US") === requestedPos)) continue
    try { return validOxfordUrl(new URL(href, OXFORD_BASE_URL).toString()) } catch {}
  }
  return ""
}

async function fetchOxfordPage(fetchImpl, sourceUrl) {
  let response
  try {
    response = await fetchWithExponentialBackoff(fetchImpl, sourceUrl, { headers: { Accept: "text/html", "User-Agent": "SIS-admin-Oxford-preview/1.0" }, redirect: "follow" })
  } catch (error) { return { ok: false, available: false, message: `Oxford is unavailable; no Library data was changed. ${error.message}` } }
  if (!response.ok) return { ok: false, available: false, message: `Oxford is unavailable (HTTP ${response.status || 503}); no Library data was changed.` }
  try {
    return { ok: true, url: response.url ? validOxfordUrl(response.url) : sourceUrl, html: await boundedResponseText(response) }
  } catch (error) { return { ok: false, available: false, message: `Oxford is unavailable; no Library data was changed. ${error.message}` } }
}

async function previewOxfordByBase(entry, fetchImpl, baseUrl) {
  const lookupWord = text(entry?.english)
  if (!lookupWord) return { ok: false, available: true, message: "An English word is required for Oxford preview; no Library data was changed." }
  const slug = encodeURIComponent(lookupWord.replace(/\s+/gu, "-"))
  const sourceUrl = validOxfordUrl(`${baseUrl}${slug}?q=${encodeURIComponent(lookupWord)}`)
  const requestedPartOfSpeech = text(entry?.partOfSpeech)
  const firstPage = await fetchOxfordPage(fetchImpl, sourceUrl)
  if (!firstPage.ok) return firstPage
  let page = firstPage
  let parsed = parseOxfordHtml(page.html, { sourceUrl: page.url, lookupWord, partOfSpeech: requestedPartOfSpeech })
  if (requestedPartOfSpeech.toLocaleLowerCase("en-US") === "verb" && !parsed.selectedEntries?.length) {
    const verbUrl = findOxfordPosUrl(page.html, lookupWord, requestedPartOfSpeech)
    if (verbUrl && verbUrl !== page.url) {
      const verbPage = await fetchOxfordPage(fetchImpl, verbUrl)
      if (verbPage.ok) {
        page = verbPage
        parsed = parseOxfordHtml(page.html, { sourceUrl: page.url, lookupWord, partOfSpeech: requestedPartOfSpeech })
      }
    }
  }
  return parsed
}

export async function previewOxfordLibraryEntry(entry, fetchImpl = fetch) {
  return previewOxfordByBase(entry, fetchImpl, OXFORD_BASE_URL)
}

export async function previewOxfordBreLibraryEntry(entry, fetchImpl = fetch) {
  return previewOxfordByBase(entry, fetchImpl, OXFORD_BRE_BASE_URL)
}

export const oxfordProvider = registerDictionaryProvider({ key: "oxford", preview: previewOxfordLibraryEntry })
