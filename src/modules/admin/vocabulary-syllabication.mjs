import { dictionary as cmuDictionary } from "cmu-pronouncing-dictionary"

const MERRIAM_WEBSTER_API_BASE = "https://www.dictionaryapi.com/api/v3/references"
const MERRIAM_WEBSTER_CACHE_LIMIT = 2000
const MERRIAM_WEBSTER_TIMEOUT_MS = 5000
const merriamWebsterCache = new Map()

function text(value) {
  return String(value == null ? "" : value).trim()
}

function hasUppercase(value) {
  return /[A-Z]/u.test(value)
}

function hasAccentStress(value) {
  return /[aeiouy]\p{M}+/iu.test(String(value).normalize("NFD"))
}

function normalizeSyllabicationText(value) {
  return text(value)
    .normalize("NFC")
    .replace(/[\p{Pd}\u00AD\u2027\u00B7\u22C5\u2212]/gu, "-")
    .replace(/\p{Z}+/gu, " ")
}

// New Words stores stress as an accented vowel. An already accented entry is
// authoritative and remains untouched; an all-caps stressed syllable is
// converted to that same canonical representation on save.
export function normalizeVocabularySyllabication(value) {
  const vowels = { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý" }
  return normalizeSyllabicationText(value).split(/(\s+|-)/u).map((token) => {
    if (!token || /^\s+$/u.test(token) || token === "-") return token
    if (hasAccentStress(token)) return token
    if (!hasUppercase(token)) return token
    const chars = Array.from(token.toLocaleLowerCase("en-US"))
    const vowelIndex = chars.findIndex((char) => vowels[char])
    if (vowelIndex >= 0) chars[vowelIndex] = vowels[chars[vowelIndex]]
    return chars.join("")
  }).join("")
}

export function vocabularySyllabicationError(english, syllabication) {
  const word = text(english).toLocaleLowerCase("en-US")
  const value = normalizeSyllabicationText(syllabication)
  const renderedWords = value.split(/\s+/u).filter(Boolean)
  if (!renderedWords.length) return "Add syllabication."
  for (const renderedWord of renderedWords) {
    const syllables = renderedWord.split("-").filter(Boolean)
    if (!syllables.length || syllables.some((syllable) => !/^\p{L}+$/u.test(syllable))) return "Use letters, spaces, and hyphens only in syllabication."
    const partialCapital = syllables.find((syllable) => /[A-Z]/u.test(syllable) && Array.from(syllable).length > 1 && syllable !== syllable.toLocaleUpperCase("en-US"))
    if (partialCapital) return `Capitalize the complete stressed syllable "${partialCapital}"; do not capitalize only one character.`
    const stressIndexes = syllables.map((syllable, index) => (/[A-Z]/u.test(syllable) || hasAccentStress(syllable) ? index : -1)).filter((index) => index >= 0)
    if (stressIndexes.some((index) => Array.from(syllables[index]).length === 1 && index !== 0)) return "A single-character stressed syllable is allowed only as the first syllable."
    const wordIsExactCompound = word.split(/\s+/u).includes(renderedWord.toLocaleLowerCase("en-US"))
    if (syllables.length > 1 && !wordIsExactCompound && stressIndexes.length !== 1) return "Every word split into syllables must have exactly one stressed syllable. Research it using the provided dictionary links."
    if (syllables.length === 1 && stressIndexes.length) return "Do not capitalize an unsplit syllabication word. Split multi-syllable words and capitalize exactly one stressed syllable."
    if (stressIndexes.length > 1) return "Use exactly one stressed syllable per word."
  }
  return ""
}

export function vocabularyEntryError(row = {}) {
  const english = text(row?.english)
  if (/[A-Z]/u.test(english)) return "English word/phrase must be lowercase."
  return vocabularySyllabicationError(english, row?.syllabication)
}

function lettersOnly(value) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}]/gu, "")
    .toLocaleLowerCase("en-US")
}

function normalizedSyllableWord(value) {
  return normalizeVocabularySyllabication(value)
    .split("-")
    .filter(Boolean)
}

function stressedSyllableIndex(syllables = []) {
  return syllables.findIndex((syllable) => hasAccentStress(syllable) || hasUppercase(syllable))
}

function cmuSyllableProfile(word) {
  const pronunciation = text(cmuDictionary[text(word).toLocaleLowerCase("en-US")])
  if (!pronunciation) return null
  const stresses = pronunciation
    .split(/\s+/u)
    .map((phoneme) => /[012]$/u.exec(phoneme)?.[0] || "")
    .filter(Boolean)
  const primaryStressIndex = stresses.indexOf("1")
  if (primaryStressIndex < 0) return null
  return { syllableCount: stresses.length, primaryStressIndex }
}

function isExactUnsplitCompound(english, syllabication) {
  const normalizedEnglish = text(english).toLocaleLowerCase("en-US")
  const normalizedSyllabication = normalizeSyllabicationText(syllabication).toLocaleLowerCase("en-US")
  return normalizedEnglish.includes("-") && normalizedEnglish === normalizedSyllabication
}

function cacheMerriamWebsterResult(key, value) {
  if (merriamWebsterCache.size >= MERRIAM_WEBSTER_CACHE_LIMIT) {
    merriamWebsterCache.delete(merriamWebsterCache.keys().next().value)
  }
  merriamWebsterCache.set(key, value)
  return value
}

function merriamWebsterApiKey(source) {
  return source === "collegiate"
    ? text(process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY)
    : text(process.env.MERRIAM_WEBSTER_LEARNERS_API_KEY)
}

function extractMerriamWebsterDivision(payload, word) {
  const expectedWord = lettersOnly(word)
  const entries = Array.isArray(payload) ? payload : []
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue
    const headword = text(entry?.hwi?.hw)
    const inflections = Array.isArray(entry?.ins) ? entry.ins.map((item) => text(item?.if)) : []
    const variants = [headword, ...inflections].filter(Boolean)
    const matched = variants.find((candidate) => lettersOnly(candidate) === expectedWord)
    if (matched) return matched
  }
  return ""
}

async function lookupMerriamWebster(source, word, fetchImpl = globalThis.fetch) {
  const key = `${source}:${text(word).toLocaleLowerCase("en-US")}`
  if (merriamWebsterCache.has(key)) return merriamWebsterCache.get(key)
  const apiKey = merriamWebsterApiKey(source)
  if (!apiKey || typeof fetchImpl !== "function") return { status: "unavailable" }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), MERRIAM_WEBSTER_TIMEOUT_MS)
  try {
    const response = await fetchImpl(
      `${MERRIAM_WEBSTER_API_BASE}/${source}/json/${encodeURIComponent(text(word))}?key=${encodeURIComponent(apiKey)}`,
      { signal: controller.signal },
    )
    if (!response?.ok) return { status: "unavailable" }
    const division = extractMerriamWebsterDivision(await response.json(), word)
    return cacheMerriamWebsterResult(key, division ? { status: "found", division } : { status: "missing" })
  } catch {
    return { status: "unavailable" }
  } finally {
    clearTimeout(timeout)
  }
}

function authoritativeDivisionMatches(entered, authoritative) {
  const enteredNormalized = normalizeSyllabicationText(entered)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US")
  const authoritativeNormalized = text(authoritative)
    .replace(/\*/gu, "-")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US")
  return enteredNormalized === authoritativeNormalized
}

/**
 * Verifies a vocabulary entry without exposing an authoritative correction.
 * @param {{ english?: unknown, syllabication?: unknown }} row
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export async function validateVocabularyEntry(row = {}, options = {}) {
  const formatError = vocabularyEntryError(row)
  if (formatError) return { message: formatError, warning: "" }
  const english = text(row.english).toLocaleLowerCase("en-US")
  const enteredWords = normalizeSyllabicationText(row.syllabication).split(/\s+/u).filter(Boolean)
  const englishWords = english.split(/\s+/u).filter(Boolean)
  if (enteredWords.length !== englishWords.length) {
    return { message: "Syllabication is incorrect. Research it using the provided dictionary links.", warning: "" }
  }
  for (let index = 0; index < englishWords.length; index += 1) {
    const word = englishWords[index]
    const entered = enteredWords[index]
    if (isExactUnsplitCompound(word, entered)) continue
    const profile = cmuSyllableProfile(word)
    const syllables = normalizedSyllableWord(entered)
    if (!profile) {
      return { message: "Syllabication requires manual dictionary research. Use the provided dictionary links.", warning: "" }
    }
    if (syllables.length !== profile.syllableCount || stressedSyllableIndex(syllables) !== profile.primaryStressIndex) {
      return { message: "Syllabication or primary stress is incorrect. Research it using the provided dictionary links.", warning: "" }
    }
    const collegiate = await lookupMerriamWebster("collegiate", word, options.fetchImpl)
    const dictionaryResult = collegiate.status === "missing"
      ? await lookupMerriamWebster("learners", word, options.fetchImpl)
      : collegiate
    if (dictionaryResult.status === "unavailable") {
      return { message: "", warning: "Syllabication could not be verified right now. Research it using the provided dictionary links." }
    }
    if (dictionaryResult.status !== "found") {
      return { message: "Syllabication requires manual dictionary research. Use the provided dictionary links.", warning: "" }
    }
    if (!authoritativeDivisionMatches(entered, dictionaryResult.division)) {
      return { message: "Syllabication or primary stress is incorrect. Research it using the provided dictionary links.", warning: "" }
    }
  }
  return { message: "", warning: "" }
}

export function resetVocabularyDictionaryCacheForTest() {
  merriamWebsterCache.clear()
}
