import * as cheerio from "cheerio"
import { fetchEtymonlinePreview } from "./library-origin.mjs"

const ORIGIN_TYPES = ["native", "borrowed", "derived", "compound", "eponym", "onomatopoeic", "unknown"]
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
const ENGLISH_FORMATION_RE = /\b(?:formed|coined|created|made|built)\s+(?:in|within)\s+(?:modern\s+)?English\b/iu
const EXPLICIT_DERIVATION_RE = /\bfrom\s+['"]?[a-z][a-z'-]*['"]?\s*\+\s*['"]?[a-z][a-z'-]*['"]?/iu
const EXPLICIT_COMPOUND_RE = /\b(?:compound(?:\s+of)?|combination\s+of)\b/iu
const AFFIX_RE = /^(?:anti|auto|counter|de|dis|en|em|ex|fore|hyper|il|im|in|inter|mal|mis|non|out|over|post|pre|pro|re|self|sub|super|trans|under|un)-?(.+)$/iu
const SUFFIX_RE = /^(.+?)(?:ness|ment|tion|sion|ity|able|ible|less|ful|ish|ly|er|or|ist|ism|ize|ise|ed|ing|en)$/iu
const MERRIAM_WEBSTER_HOST = "www.merriam-webster.com"
const MERRIAM_WEBSTER_ROOT = `https://${MERRIAM_WEBSTER_HOST}`
const JINA_READER_HOST = "r.jina.ai"
const JINA_READER_ROOT = `https://${JINA_READER_HOST}/`
const FETCH_TIMEOUT_MS = 8_000
const MAX_RESPONSE_BYTES = 1_500_000

const normalizeText = (value, max = 1200) => String(value == null ? "" : value)
  .normalize("NFC")
  .replace(/[\u0000-\u001F\u007F]/gu, " ")
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
      if (fallbackError?.name === "AbortError") throw new Error("Merriam-Webster timed out")
      throw new Error(`Merriam-Webster is unavailable: ${normalizeText(error?.message || fallbackError?.message, 180)}`)
    }
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
])

const sourceResult = (provider, result, error, prose) => ({
  provider,
  available: Boolean(result && !error && prose),
  excerpt: plainText(prose, 600),
  message: result && !error && prose ? "Etymology section retrieved." : normalizeText(result?.message || error?.message || `${provider} did not return an etymology section.`, 240),
})

function classifyOrigin({ word, etymonlineProse = "", merriamWebsterProse = "", additionalProse = [], stem = "" } = {}) {
  const term = normalizeText(word, 200)
  const suppliedStem = normalizeText(stem, 200)
  const prose = uniqueText([etymonlineProse, merriamWebsterProse, ...(Array.isArray(additionalProse) ? additionalProse : [])]).join("\n")
  const candidates = new Map(ORIGIN_TYPES.map((type) => [type, candidate(type, 8, "No supporting evidence yet.")]))
  const add = (type, confidence, reason) => {
    const current = candidates.get(type)
    if (confidence > current.confidence) candidates.set(type, candidate(type, confidence, reason))
  }
  const foreignDonor = DONOR_LANGUAGE_RE.test(prose)
  const directBorrowing = /\b(?:borrowed|loanword|adopted into English|directly from|via)\b/iu.test(prose)

  if (/\b(?:named after|from the name of|eponym)\b/iu.test(prose)) add("eponym", 94, "The source prose explicitly identifies a name-based origin.")
  if (/\b(?:onomatopoeic|imitative of sound|sound imitation|echoic)\b/iu.test(prose)) add("onomatopoeic", 94, "The source prose explicitly identifies a sound-imitation origin.")
  if (foreignDonor && (directBorrowing || /\bfrom\b/iu.test(prose))) {
    add("borrowed", 95, "The source prose gives a donor-language route for this complete English word.")
    add("derived", 18, "A donor form can contain older prefixes or roots, but that does not show English formation.")
  }
  if (/\b(?:Old English|Anglo-Saxon)\b/iu.test(prose) && !foreignDonor) add("native", 91, "The source prose traces the word through Old English or Anglo-Saxon without a stated donor-language entry route.")
  if (ENGLISH_FORMATION_RE.test(prose)) add("derived", 91, "The source prose explicitly says the exact word was formed or coined in English.")
  if ((EXPLICIT_DERIVATION_RE.test(prose) || suppliedStem) && !foreignDonor) {
    add("derived", suppliedStem ? 68 : 76, suppliedStem ? "The supplied stem supports an English affixation check; confirm the source says this exact form was made in English." : "The source prose presents the word as an affix plus a base, with no donor-language route stated.")
  }
  if ((EXPLICIT_COMPOUND_RE.test(prose) || /[ -]/u.test(term)) && !foreignDonor) {
    add("compound", /[ -]/u.test(term) ? 58 : 76, /[ -]/u.test(term) ? "The entry is a multi-part form; verify whether the source calls it a lexical compound rather than a free phrase." : "The source prose explicitly identifies a compound formation.")
  }
  if (!prose) add("unknown", 28, "Neither source returned usable etymology prose.")
  else if (![...candidates.values()].some((item) => item.confidence >= 45)) add("unknown", 46, "The retrieved prose does not state a direct English entry route or English formation event.")

  const ranked = [...candidates.values()]
    .sort((left, right) => right.confidence - left.confidence || left.type.localeCompare(right.type))
    .slice(0, 3)
  const determination = ranked[0]
  const apparentAffix = AFFIX_RE.test(term) || SUFFIX_RE.test(term)
  const caveats = []
  const missingInfo = []
  if (!etymonlineProse) caveats.push("Etymonline did not provide usable prose, so this is not a two-source determination.")
  if (!merriamWebsterProse) caveats.push("Merriam-Webster did not provide usable prose, so this is not a two-source determination.")
  if (determination.type === "borrowed" && /\b(?:prefix|root|PIE|Proto-Indo-European)\b/iu.test(prose)) caveats.push("Older prefix, root, and PIE information explains ancestry; the classification remains about how the complete current English word entered English.")
  if (determination.type === "compound" && /\s/u.test(term)) caveats.push("A spaced form can be a phrase rather than a lexical compound; verify the source's headword treatment.")
  if (determination.confidence < 70) missingInfo.push("Find a sentence that says either that this exact word entered English from a donor language or that it was formed in English from named parts.")
  if (apparentAffix && !suppliedStem && determination.confidence < 70) missingInfo.push("Provide the base or stem you intend to test, then look for source wording that connects that stem to formation of this exact English word.")
  if (determination.type === "unknown") missingInfo.push("Search both sources for the exact headword, including historical spelling variants, before assigning an origin type.")
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
  sourceAdapters = DEFAULT_ORIGIN_SOURCE_ADAPTERS,
} = {}) {
  const word = normalizeText(entry?.english, 200)
  if (!word) throw new Error("An English word or phrase is required for origin analysis.")
  const adapters = Array.isArray(sourceAdapters) ? sourceAdapters.map((adapter) => createOriginSourceAdapter(adapter)) : DEFAULT_ORIGIN_SOURCE_ADAPTERS
  if (!adapters.length) throw new Error("At least one origin source adapter is required")
  const results = await Promise.allSettled(adapters.map((adapter) => adapter.fetchProse(word, { fetchEtymonlinePreviewImpl, fetchMerriamWebsterEtymologyImpl })))
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
  const additionalProse = sourceRecords.filter((source) => !["etymonline", "merriam-webster"].includes(source.id)).map((source) => source.prose)
  const classification = classifyOrigin({ word, etymonlineProse, merriamWebsterProse, additionalProse, stem })
  return {
    ok: true,
    word,
    advisory: true,
    ...classification,
    sources: sourceRecords.map((source) => ({ ...sourceResult(source.provider, source.value, source.error, source.prose), id: source.id, sourceUrl: source.sourceUrl || null, retrieval: source.retrieval || null })),
  }
}

export { ORIGIN_LABELS, classifyOrigin }
