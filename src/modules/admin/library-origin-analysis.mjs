import * as cheerio from "cheerio"
import { fetchEtymonlinePreview } from "./library-origin.mjs"

const ORIGIN_LABELS = {
  native: "Native English",
  borrowed: "Borrowed / loanword",
  derived: "Derived / affixed",
  compound: "Compound",
  eponym: "Eponym",
  onomatopoeic: "Onomatopoeic",
  unknown: "Unknown",
}
const DONOR_LANGUAGE_RE = /\b(?:Old|Middle|Modern|Classical|Late|Medieval|Vulgar|Anglo-)?(?:French|Latin|Greek|Arabic|Norse|German|Dutch|Spanish|Italian|Portuguese|Russian|Irish|Welsh|Scottish Gaelic|Hebrew|Yiddish|Hindi|Sanskrit|Persian|Turkish|Japanese|Chinese|Korean|Malay|Tamil|Swahili|Finnish|Hungarian)\b/iu
const DONOR_ROUTE_RE = /\b(?:from|via|through)\s+(?:an?\s+)?(?:Old|Middle|Modern|Classical|Late|Medieval|Vulgar|Anglo-)?(?:French|Latin|Greek|Arabic|Norse|German|Dutch|Spanish|Italian|Portuguese|Russian|Irish|Welsh|Scottish Gaelic|Hebrew|Yiddish|Hindi|Sanskrit|Persian|Turkish|Japanese|Chinese|Korean|Malay|Tamil|Swahili|Finnish|Hungarian)\b/iu
const DIRECT_BORROWING_RE = /\b(?:borrowed|loanword|adopted\s+into\s+English|entered\s+English|taken\s+into\s+English)\b/iu
const NATIVE_LINEAGE_RE = /\b(?:Old English|Anglo-Saxon|Proto-Germanic|West Germanic|North Germanic|ancestral Germanic|inherited\s+(?:from\s+)?(?:English|Germanic)|Germanic inheritance)\b/iu
const ENGLISH_FORMATION_RE = /\b(?:formed|coined|created|made|built)\s+(?:in|within)\s+(?:modern\s+)?English\b/iu
const EXPLICIT_DERIVATION_RE = /\b(?:from|formed\s+from)\s+[^;\n]{0,120}\+\s*['"]?-?[a-z][a-z'-]*/iu
const EXPLICIT_COMPOUND_RE = /\b(?:compound(?:\s+of)?|combination\s+of)\b/iu
const COGNATE_COMPARISON_RE = /\b(?:compare|cognate|related\s+to)\b/iu
const AFFIX_RE = /^(?:anti|auto|counter|de|dis|en|em|ex|fore|hyper|il|im|in|inter|mal|mis|non|out|over|post|pre|pro|re|self|sub|super|trans|under|un)-?(.+)$/iu
const SUFFIX_RE = /^(.+?)(?:ness|ment|tion|sion|ity|able|ible|less|ful|ish|ly|er|or|ist|ism|ize|ise|ed|ing|en)$/iu
const MERRIAM_WEBSTER_HOST = "www.merriam-webster.com"
const MERRIAM_WEBSTER_ROOT = `https://${MERRIAM_WEBSTER_HOST}`
const WIKTIONARY_HOST = "en.wiktionary.org"
const WIKTIONARY_ROOT = `https://${WIKTIONARY_HOST}`
const JINA_READER_HOST = "r.jina.ai"
const JINA_READER_ROOT = `https://${JINA_READER_HOST}/`
const FETCH_TIMEOUT_MS = 8_000
const MAX_RESPONSE_BYTES = 1_500_000

const normalizeText = (value, max = 1200) => String(value == null ? "" : value)
  .normalize("NFC")
  .replace(/\p{Cc}/gu, " ")
  .replace(/\s+/gu, " ")
  .trim()
  .slice(0, max)

const plainText = (value, max = 1200) => normalizeText(String(value == null ? "" : value)
  .replace(/\*\*/gu, "")
  .replace(/\*/gu, "")
  .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1"), max)

const confidenceLevel = (score) => {
  if (score >= 85) return "CL-A (high)"
  if (score >= 70) return "CL-B (good)"
  if (score >= 45) return "CL-C (tentative)"
  return "CL-D (insufficient)"
}

const candidate = (type, confidence, reason) => ({
  type,
  label: ORIGIN_LABELS[type],
  confidence: Math.max(0, Math.min(100, Math.round(confidence))),
  confidenceLevel: confidenceLevel(confidence),
  reason,
})

const uniqueText = (values, max = 1200) => [...new Set(values.map((value) => normalizeText(value, max)).filter(Boolean))]

const merriamWebsterDictionaryUrl = (word) => {
  const term = normalizeText(word, 200)
  return term ? `${MERRIAM_WEBSTER_ROOT}/dictionary/${encodeURIComponent(term)}` : ""
}

export const wiktionaryEnglishUrl = (word) => {
  const term = normalizeText(word, 200)
  return term ? `${WIKTIONARY_ROOT}/wiki/${encodeURIComponent(term)}#English` : ""
}

export function parseMerriamWebsterEtymology(html) {
  if (String(html || "").length > MAX_RESPONSE_BYTES) throw new Error("Merriam-Webster response exceeded the permitted size")
  const $ = cheerio.load(String(html || ""), { decodeEntities: true })
  const sections = $("[data-testid='etymology'], #etymology, .et, .etymology").toArray()
    .map((element) => {
      const section = $(element).clone()
      section.find("script, style, noscript, svg, button").remove()
      return normalizeText(section.text().replace(/^\s*etymology\s*:?\s*/iu, ""), 1200)
    })
    .filter((value) => value && value.length > 8)
  const etymology = uniqueText(sections).join("\n")
  if (!etymology) throw new Error("No Merriam-Webster etymology section was found")
  return etymology
}

export function parseMerriamWebsterReaderEtymology(markdown) {
  const source = String(markdown || "").replace(/\r\n?/gu, "\n")
  const match = source.match(/(?:^|\n)#{1,6}\s+Word History\s*\n+\s*Etymology\s*\n+([\s\S]*?)(?=\n#{1,6}\s|\s*$)/iu)
  const etymology = normalizeText(match?.[1]
    ?.replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1"), 1200)
  if (!etymology) throw new Error("No Merriam-Webster etymology section was found")
  return etymology
}

export function parseWiktionaryEnglishOriginDetails(html) {
  if (String(html || "").length > MAX_RESPONSE_BYTES) throw new Error("Wiktionary response exceeded the permitted size")
  const $ = cheerio.load(String(html || ""), { decodeEntities: true })
  const englishHeading = $("#English").first()
  if (!englishHeading.length || !/^h2$/iu.test(englishHeading.prop("tagName") || "")) throw new Error("No English section was found")
  const etymologySections = []
  const contextSections = new Map()
  let activeSection = null
  let lexicalHeading = ""
  const addContextItems = (title, node) => {
    const section = node.clone()
    section.find("script, style, noscript, svg, button, sup.reference, .mw-editsection").remove()
    const listItems = section.find("li").toArray().map((item) => normalizeText($(item).text(), 180)).filter(Boolean)
    const items = listItems.length ? listItems : [normalizeText(section.text(), 1200)].filter(Boolean)
    if (!items.length) return
    const current = contextSections.get(title) || []
    contextSections.set(title, uniqueText([...current, ...items], 180).slice(0, 60))
  }
  for (const sibling of englishHeading.parent().nextAll().toArray()) {
    const node = $(sibling)
    const heading = node.find("h2, h3, h4").first()
    if (heading.length) {
      const level = Number((heading.prop("tagName") || "").slice(1))
      const headingText = normalizeText(heading.text(), 160)
      if (level === 2) break
      if (level === 3) lexicalHeading = headingText
      if (/^etymology(?:\s+\d+)?$/iu.test(headingText)) activeSection = { kind: "etymology" }
      else if (/^(?:derived terms|descendants)$/iu.test(headingText)) activeSection = { kind: "context", title: level === 4 && lexicalHeading ? `${lexicalHeading} — ${headingText}` : headingText }
      else activeSection = null
      continue
    }
    if (!activeSection) continue
    if (node.is("script, style, noscript, svg, button")) continue
    if (activeSection.kind === "context") addContextItems(activeSection.title, node)
    else {
      const section = node.clone()
      section.find("script, style, noscript, svg, button, sup.reference, .mw-editsection").remove()
      const prose = normalizeText(section.text(), 1200)
      if (prose.length > 8) etymologySections.push(prose)
    }
  }
  const etymology = uniqueText(etymologySections).join("\n")
  if (!etymology) throw new Error("No English Wiktionary etymology section was found")
  return {
    etymology,
    contextSections: [...contextSections.entries()].map(([title, items]) => ({ title, items })),
  }
}

export function parseWiktionaryEnglishEtymology(html) {
  return parseWiktionaryEnglishOriginDetails(html).etymology
}

async function readBoundedResponseText(response, provider) {
  const declaredLength = Number(response.headers?.get?.("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error(`${provider} response exceeded the permitted size`)
  if (!response.body?.getReader) {
    const text = await response.text()
    if (text.length > MAX_RESPONSE_BYTES) throw new Error(`${provider} response exceeded the permitted size`)
    return text
  }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error(`${provider} response exceeded the permitted size`)
    }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength })
  return new TextDecoder().decode(bytes)
}

export async function fetchMerriamWebsterEtymology(word, fetchImpl = fetch) {
  const sourceUrl = merriamWebsterDictionaryUrl(word)
  if (!sourceUrl) throw new Error("A word or phrase is required")
  const parsedUrl = new URL(sourceUrl)
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== MERRIAM_WEBSTER_HOST) throw new Error("Merriam-Webster host is not allowed")
  const fetchDirect = async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetchImpl(sourceUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "SIS Library Origin Review/1.0 (+https://eagles.edu.vn)",
        },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Merriam-Webster is unavailable (HTTP ${response.status || 503})`)
      if (response.url) {
        const finalUrl = new URL(response.url)
        if (finalUrl.protocol !== "https:" || finalUrl.hostname !== MERRIAM_WEBSTER_HOST) throw new Error("Merriam-Webster redirect host is not allowed")
      }
      return { ok: true, etymology: parseMerriamWebsterEtymology(await readBoundedResponseText(response, "Merriam-Webster")), sourceUrl, retrieval: "direct" }
    } finally {
      clearTimeout(timer)
    }
  }
  const fetchReaderProxy = async () => {
    const proxyUrl = `${JINA_READER_ROOT}${sourceUrl}`
    const parsedProxyUrl = new URL(proxyUrl)
    if (parsedProxyUrl.protocol !== "https:" || parsedProxyUrl.hostname !== JINA_READER_HOST) throw new Error("Merriam-Webster reader proxy host is not allowed")
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetchImpl(proxyUrl, { headers: { Accept: "text/plain" }, signal: controller.signal })
      if (!response.ok) throw new Error(`Merriam-Webster reader fallback is unavailable (HTTP ${response.status || 503})`)
      if (response.url) {
        const finalUrl = new URL(response.url)
        if (finalUrl.protocol !== "https:" || finalUrl.hostname !== JINA_READER_HOST) throw new Error("Merriam-Webster reader proxy redirect host is not allowed")
      }
      return { ok: true, etymology: parseMerriamWebsterReaderEtymology(await readBoundedResponseText(response, "Merriam-Webster reader fallback")), sourceUrl, retrieval: "reader-proxy" }
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    return await fetchDirect()
  } catch (error) {
    try {
      return await fetchReaderProxy()
    } catch (fallbackError) {
      if (fallbackError?.name === "AbortError") throw new Error("Merriam-Webster timed out", { cause: fallbackError })
      throw new Error(`Merriam-Webster is unavailable: ${normalizeText(error?.message || fallbackError?.message, 180)}`, { cause: fallbackError })
    }
  }
}

const isAllowedWiktionaryUrl = (value) => {
  const parsedUrl = new URL(value)
  return parsedUrl.protocol === "https:" && parsedUrl.hostname === WIKTIONARY_HOST
}

export async function fetchWiktionaryEnglishEtymology(word, fetchImpl = fetch) {
  const sourceUrl = wiktionaryEnglishUrl(word)
  if (!sourceUrl) throw new Error("A word or phrase is required")
  if (!isAllowedWiktionaryUrl(sourceUrl)) throw new Error("Wiktionary host is not allowed")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(sourceUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "SIS Library Origin Review/1.0 (+https://eagles.edu.vn)",
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Wiktionary is unavailable (HTTP ${response.status || 503})`)
    if (response.url) {
      const finalUrl = new URL(response.url)
      if (!isAllowedWiktionaryUrl(finalUrl)) throw new Error("Wiktionary redirect host is not allowed")
    }
    const details = parseWiktionaryEnglishOriginDetails(await readBoundedResponseText(response, "Wiktionary"))
    return { ok: true, ...details, sourceUrl, retrieval: "direct" }
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Wiktionary timed out", { cause: error })
    throw new Error(`Wiktionary is unavailable: ${normalizeText(error?.message, 180)}`, { cause: error })
  } finally {
    clearTimeout(timer)
  }
}

export function createOriginSourceAdapter({ id, provider, fetchProse } = {}) {
  const sourceId = normalizeText(id, 80).toLowerCase()
  const sourceProvider = normalizeText(provider, 160)
  if (!sourceId || !/^[a-z0-9-]+$/u.test(sourceId)) throw new Error("Origin source adapters need a lowercase id")
  if (!sourceProvider || typeof fetchProse !== "function") throw new Error("Origin source adapters need a provider and fetchProse function")
  return Object.freeze({ id: sourceId, provider: sourceProvider, fetchProse })
}

export const DEFAULT_ORIGIN_SOURCE_ADAPTERS = Object.freeze([
  createOriginSourceAdapter({
    id: "etymonline",
    provider: "Etymonline",
    fetchProse: async (word, { fetchEtymonlinePreviewImpl }) => {
      const result = await fetchEtymonlinePreviewImpl(word)
      return { prose: result?.paragraph, sourceUrl: result?.sourceUrl, retrieval: "direct" }
    },
  }),
  createOriginSourceAdapter({
    id: "merriam-webster",
    provider: "Merriam-Webster Collegiate",
    fetchProse: async (word, { fetchMerriamWebsterEtymologyImpl }) => {
      const result = await fetchMerriamWebsterEtymologyImpl(word)
      return { prose: result?.etymology, sourceUrl: result?.sourceUrl, retrieval: result?.retrieval || "direct" }
    },
  }),
  createOriginSourceAdapter({
    id: "wiktionary",
    provider: "Wiktionary (English)",
    fetchProse: async (word, { fetchWiktionaryEnglishEtymologyImpl }) => {
      const result = await fetchWiktionaryEnglishEtymologyImpl(word)
      return { prose: result?.etymology, sourceUrl: result?.sourceUrl, retrieval: result?.retrieval || "direct", contextSections: result?.contextSections }
    },
  }),
])

const sourceResult = (provider, result, error, prose) => ({
  provider,
  available: Boolean(result && !error && prose),
  excerpt: plainText(prose, 600),
  message: result && !error && prose ? "Etymology section retrieved." : normalizeText(result?.message || error?.message || `${provider} did not return an etymology section.`, 240),
  contextSections: Array.isArray(result?.contextSections)
    ? result.contextSections.map((section) => ({ title: normalizeText(section?.title, 160), items: uniqueText(Array.isArray(section?.items) ? section.items : [], 180).slice(0, 60) })).filter((section) => section.title && section.items.length)
    : [],
})

function classifyOrigin({ word, etymonlineProse = "", merriamWebsterProse = "", wiktionaryProse = "", additionalProse = [], sourceAvailability = [], stem = "" } = {}) {
  const term = normalizeText(word, 200)
  const suppliedStem = normalizeText(stem, 200)
  const sourceProse = [
    { source: "Etymonline", prose: normalizeText(etymonlineProse, 1200) },
    { source: "Merriam-Webster", prose: normalizeText(merriamWebsterProse, 1200) },
    { source: "Wiktionary", prose: normalizeText(wiktionaryProse, 1200) },
    ...(Array.isArray(additionalProse) ? additionalProse.map((value, index) => ({ source: `Additional source ${index + 1}`, prose: normalizeText(value, 1200) })) : []),
  ].filter(({ prose }) => prose)
  const prose = sourceProse.map(({ prose: value }) => value).join("\n")
  const clauses = sourceProse.flatMap(({ source, prose: value }) => value
    .split(/(?:[!?;]+|\n+|\.\s+(?=[A-Z]))/u)
    .map((text) => normalizeText(text, 400))
    .filter(Boolean)
    .map((text) => ({ source, text })))
  const candidates = new Map()
  const add = (type, confidence, reason) => {
    const current = candidates.get(type)
    if (!current || confidence > current.confidence) candidates.set(type, candidate(type, confidence, reason))
  }
  const directBorrowingClauses = clauses.filter(({ text }) => DONOR_LANGUAGE_RE.test(text) && (DIRECT_BORROWING_RE.test(text) || DONOR_ROUTE_RE.test(text)))
  const nativeLineageClauses = clauses.filter(({ text }) => NATIVE_LINEAGE_RE.test(text))
  const explicitDerivationClauses = clauses.filter(({ text }) => ENGLISH_FORMATION_RE.test(text) || EXPLICIT_DERIVATION_RE.test(text))
  const nativeEnglishFormation = sourceProse.some(({ source }) => nativeLineageClauses.some((claim) => claim.source === source) && explicitDerivationClauses.some((claim) => claim.source === source))
  const cognateComparison = clauses.some(({ text }) => COGNATE_COMPARISON_RE.test(text) && DONOR_LANGUAGE_RE.test(text))

  if (/\b(?:named after|from the name of|eponym)\b/iu.test(prose)) add("eponym", 94, "The source prose explicitly identifies a name-based origin.")
  if (/\b(?:onomatopoeic|imitative of sound|sound imitation|echoic)\b/iu.test(prose)) add("onomatopoeic", 94, "The source prose explicitly identifies a sound-imitation origin.")
  if (directBorrowingClauses.length && !nativeEnglishFormation) add("borrowed", 95, "A source clause gives this English word a direct donor-language route.")
  if (nativeLineageClauses.length) add("native", nativeEnglishFormation ? 96 : 91, nativeEnglishFormation ? "The source traces inherited English/Germanic material and explicitly forms this word in English." : "A source clause traces the word through Old English, Anglo-Saxon, or ancestral Germanic inheritance.")
  if (explicitDerivationClauses.length) add("derived", ENGLISH_FORMATION_RE.test(prose) ? 91 : 76, ENGLISH_FORMATION_RE.test(prose) ? "The source prose explicitly says the exact word was formed or coined in English." : "The source prose presents the word as an affix plus a base.")
  if ((EXPLICIT_COMPOUND_RE.test(prose) || /[ -]/u.test(term)) && !directBorrowingClauses.length) {
    add("compound", /[ -]/u.test(term) ? 58 : 76, /[ -]/u.test(term) ? "The entry is a multi-part form; verify whether the source calls it a lexical compound rather than a free phrase." : "The source prose explicitly identifies a compound formation.")
  }
  if (!candidates.size) add("unknown", prose ? 46 : 28, prose ? "The retrieved prose does not establish a direct donor route, inherited lineage, or English formation." : "No source returned usable etymology prose.")

  const ranked = [...candidates.values()]
    .sort((left, right) => right.confidence - left.confidence || left.type.localeCompare(right.type))
    .slice(0, 3)
  const determination = ranked[0]
  const apparentAffix = AFFIX_RE.test(term) || SUFFIX_RE.test(term)
  const caveats = []
  const missingInfo = []
  const expectedSources = Array.isArray(sourceAvailability) && sourceAvailability.length
    ? sourceAvailability
    : [
      { provider: "Etymonline", prose: etymonlineProse },
      { provider: "Merriam-Webster", prose: merriamWebsterProse },
      { provider: "Wiktionary (English)", prose: wiktionaryProse },
    ]
  const unavailableProviders = expectedSources.filter((source) => !normalizeText(source?.prose, 1200)).map((source) => normalizeText(source?.provider, 160)).filter(Boolean)
  if (unavailableProviders.length) caveats.push(`${unavailableProviders.join(", ")} did not provide usable prose; this advisory is based on ${expectedSources.length - unavailableProviders.length} of ${expectedSources.length} configured source(s).`)
  if (cognateComparison) caveats.push("A cognate comparison identifies related forms; it does not by itself establish a borrowing route.")
  if (determination.type === "borrowed" && /\b(?:prefix|root|PIE|Proto-Indo-European)\b/iu.test(prose)) caveats.push("Older prefix, root, and PIE information explains ancestry; the classification remains about how the complete current English word entered English.")
  if (determination.type === "compound" && /\s/u.test(term)) caveats.push("A spaced form can be a phrase rather than a lexical compound; verify the source's headword treatment.")
  if (determination.confidence < 70) missingInfo.push("Find a sentence that says either that this exact word entered English from a donor language, inherited an English/Germanic lineage, or was formed in English from named parts.")
  if (apparentAffix && !suppliedStem && determination.confidence < 70) missingInfo.push("Provide the base or stem you intend to test, then look for source wording that connects that stem to formation of this exact English word.")
  if (determination.type === "unknown") missingInfo.push("Search all configured sources for the exact headword, including historical spelling variants, before assigning an origin type.")
  const requiresStem = apparentAffix && !suppliedStem && determination.confidence < 70

  return {
    determination,
    topCandidates: ranked,
    caveats: uniqueText(caveats, 360),
    missingInfo: uniqueText(missingInfo, 360),
    requiresStem,
    stemPrompt: requiresStem ? "Enter the possible base or stem only if you have evidence for it. This review will not change the entry." : "",
  }
}

export async function analyzeLibraryOrigin(entry, {
  stem = "",
  fetchEtymonlinePreviewImpl = fetchEtymonlinePreview,
  fetchMerriamWebsterEtymologyImpl = fetchMerriamWebsterEtymology,
  fetchWiktionaryEnglishEtymologyImpl = fetchWiktionaryEnglishEtymology,
  sourceAdapters = DEFAULT_ORIGIN_SOURCE_ADAPTERS,
} = {}) {
  const word = normalizeText(entry?.english, 200)
  if (!word) throw new Error("An English word or phrase is required for origin analysis.")
  const adapters = Array.isArray(sourceAdapters) ? sourceAdapters.map((adapter) => createOriginSourceAdapter(adapter)) : DEFAULT_ORIGIN_SOURCE_ADAPTERS
  if (!adapters.length) throw new Error("At least one origin source adapter is required")
  const results = await Promise.allSettled(adapters.map((adapter) => adapter.fetchProse(word, { fetchEtymonlinePreviewImpl, fetchMerriamWebsterEtymologyImpl, fetchWiktionaryEnglishEtymologyImpl })))
  const sourceRecords = adapters.map((adapter, index) => {
    const result = results[index]
    const value = result.status === "fulfilled" ? result.value : null
    const prose = normalizeText(value?.prose, 1200)
    return {
      id: adapter.id,
      provider: adapter.provider,
      prose,
      sourceUrl: normalizeText(value?.sourceUrl, 500),
      retrieval: normalizeText(value?.retrieval, 80),
      error: result.status === "rejected" ? result.reason : null,
      value,
    }
  })
  const etymonlineProse = sourceRecords.find((source) => source.id === "etymonline")?.prose || ""
  const merriamWebsterProse = sourceRecords.find((source) => source.id === "merriam-webster")?.prose || ""
  const wiktionaryProse = sourceRecords.find((source) => source.id === "wiktionary")?.prose || ""
  const additionalProse = sourceRecords.filter((source) => !["etymonline", "merriam-webster", "wiktionary"].includes(source.id)).map((source) => source.prose)
  const classification = classifyOrigin({ word, etymonlineProse, merriamWebsterProse, wiktionaryProse, additionalProse, sourceAvailability: sourceRecords, stem })
  return {
    ok: true,
    word,
    advisory: true,
    ...classification,
    sources: sourceRecords.map((source) => ({ ...sourceResult(source.provider, source.value, source.error, source.prose), id: source.id, sourceUrl: source.sourceUrl || null, retrieval: source.retrieval || null })),
  }
}

export { ORIGIN_LABELS, classifyOrigin }
