import { buildOriginReference } from "./library-origin.mjs"

export function cleanDictionaryText(value) {
  return String(value == null ? "" : value).replace(/\s+/gu, " ").trim()
}

export function uniqueDictionaryText(values) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(cleanDictionaryText).filter(Boolean))]
}

export function validateDictionaryPageUrl(value, hostnames, pathPrefix) {
  const parsed = new URL(value)
  if (parsed.protocol !== "https:" || !hostnames.has(parsed.hostname.toLowerCase())) throw new Error("Dictionary URL host is not allowed")
  if (pathPrefix && !parsed.pathname.startsWith(pathPrefix)) throw new Error("Dictionary URL path is not allowed")
  return parsed.toString()
}

export async function boundedDictionaryResponseText(response, maximumBytes) {
  const contentLength = Number.parseInt(response.headers.get("content-length") || "0", 10)
  if (contentLength > maximumBytes) throw new Error("Dictionary response exceeded the permitted size")
  if (!response.body) {
    const fallback = await response.text()
    if (Buffer.byteLength(fallback) > maximumBytes) throw new Error("Dictionary response exceeded the permitted size")
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
      if (total > maximumBytes) throw new Error("Dictionary response exceeded the permitted size")
      chunks.push(Buffer.from(next.value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString("utf8")
}

export function senseDefinitionBlocks(entries) {
  const blocks = []
  for (const entry of entries) {
    for (const sense of entry.senses || []) {
      const number = String(sense.number || blocks.length + 1)
      const label = uniqueDictionaryText(sense.labels || []).join(", ")
      const body = [label ? `*${label}*` : "", sense.definition].filter(Boolean).join(" — ")
      const block = [`${number}. ${body}`.trim()]
      const exampleIndent = " ".repeat(number.length + 2)
      for (const example of sense.examples || []) block.push(`${exampleIndent}- ${example}`)
      blocks.push(block.join("\n"))
    }
  }
  return blocks
}

function labelSignals(entries) {
  return uniqueDictionaryText(entries.flatMap((entry) => [entry.partOfSpeech, ...(entry.labels || []), ...(entry.senses || []).flatMap((sense) => sense.labels || [])]))
}

export function deriveDictionaryEslFields(entries, provider) {
  const signals = labelSignals(entries)
  const lowerSignals = signals.map((value) => value.toLowerCase())
  const fields = {
    grammarClassification: {
      grammarFamily: provider,
      grammarSubtype: signals.join(", "),
      grammarDetail: signals.join("; "),
    },
  }
  const countable = lowerSignals.some((value) => /\bcount(?:able| noun)\b/u.test(value))
  const uncountable = lowerSignals.some((value) => /\b(?:uncountable|noncount|mass noun)\b/u.test(value))
  if (countable && uncountable) fields.countability = "countable_and_uncountable"
  else if (countable) fields.countability = "countable"
  else if (uncountable) fields.countability = "uncountable"
  const plural = lowerSignals.some((value) => /\bplural\b/u.test(value))
  const singular = lowerSignals.some((value) => /\bsingular\b/u.test(value))
  if (plural && singular) fields.nounNumber = "singular and plural"
  else if (plural) fields.nounNumber = "plural"
  else if (singular) fields.nounNumber = "singular"
  const transitive = lowerSignals.some((value) => /\btransitive\b/u.test(value) && !/\bintransitive\b/u.test(value))
  const intransitive = lowerSignals.some((value) => /\bintransitive\b/u.test(value))
  if (transitive && intransitive) fields.verbTransitivity = "ambitransitive"
  else if (transitive) fields.verbTransitivity = "transitive"
  else if (intransitive) fields.verbTransitivity = "intransitive"
  return fields
}

export function buildRichDictionaryFields({ provider, sourceName, sourceUrl, word, entries, etymology = [], firstKnownUse = [], synonyms = [], collocations = [], idioms = [], phrases = [] }) {
  const sections = senseDefinitionBlocks(entries)
  const addList = (title, values) => {
    const items = uniqueDictionaryText(values)
    if (items.length) sections.push(`**${title}:**\n${items.map((item) => `- ${item}`).join("\n")}`)
  }
  addList("Synonyms", synonyms)
  addList("Collocations", collocations)
  addList("Idioms", idioms)
  addList("Phrases", phrases)
  const etymologyText = uniqueDictionaryText(etymology).join("\n")
  const firstUseText = uniqueDictionaryText(firstKnownUse).join("; ")
  if (firstUseText) sections.push(`**First known use:** ${firstUseText}`)
  const citation = `${sourceName}. (n.d.). *${cleanDictionaryText(word)}*. Retrieved ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}, from ${sourceUrl}`
  return {
    definition: sections.join("\n\n"),
    etymology: etymologyText,
    originReferences: [buildOriginReference({ source: sourceName, url: sourceUrl, claims: ["definitions", "subtypes", "synonyms", "collocations", "idioms", "phrases", ...(etymologyText ? ["etymology"] : [])], provider, citation })],
    dictionaryProvider: provider,
    dictionarySourceUrl: sourceUrl,
    dictionaryMetadata: { provider, sourceName, entries, etymology, firstKnownUse, synonyms, collocations, idioms, phrases },
    ...deriveDictionaryEslFields(entries, provider),
  }
}
