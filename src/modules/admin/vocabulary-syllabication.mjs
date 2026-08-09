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
    if (hasAccentStress(token)) return token.toLocaleLowerCase("en-US")
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
