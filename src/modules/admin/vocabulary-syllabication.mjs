function text(value) {
  return String(value == null ? "" : value).trim()
}

function hasUppercase(value) {
  return /[A-Z]/u.test(value)
}

function hasLegacyAccentStress(value) {
  return /[áéíóúýàèìòùâêîôûãẽĩõũÁÉÍÓÚÝÀÈÌÒÙÂÊÎÔÛÃẼĨÕŨ]/u.test(value)
}

// Older saved words used an accented vowel for stress. Convert that legacy
// representation for display/storage without losing any definition text.
export function normalizeVocabularySyllabication(value) {
  return text(value).split(/(\s+|-)/u).map((token) => {
    if (!token || /^\s+$/u.test(token) || token === "-") return token
    return hasLegacyAccentStress(token) ? token.toLocaleUpperCase("en-US") : token
  }).join("")
}

export function vocabularySyllabicationError(english, syllabication) {
  const word = text(english).toLocaleLowerCase("en-US")
  const value = normalizeVocabularySyllabication(syllabication)
  const renderedWords = value.split(/\s+/u).filter(Boolean)
  if (!renderedWords.length) return "Add syllabication."
  for (const renderedWord of renderedWords) {
    const syllables = renderedWord.split("-").filter(Boolean)
    if (!syllables.length || syllables.some((syllable) => !/^\p{L}+$/u.test(syllable))) return "Use letters, spaces, and hyphens only in syllabication."
    const partialCapital = syllables.find((syllable) => /[A-Z]/u.test(syllable) && Array.from(syllable).length > 1 && syllable !== syllable.toLocaleUpperCase("en-US"))
    if (partialCapital) return `Capitalize the complete stressed syllable "${partialCapital}"; do not capitalize only one character.`
    const stressIndexes = syllables.map((syllable, index) => (/[A-Z]/u.test(syllable) ? index : -1)).filter((index) => index >= 0)
    if (stressIndexes.some((index) => Array.from(syllables[index]).length === 1 && index !== 0)) return "A single-character stressed syllable is allowed only as the first syllable."
    const wordIsExactCompound = word.split(/\s+/u).includes(renderedWord.toLocaleLowerCase("en-US"))
    if (syllables.length > 1 && !wordIsExactCompound && stressIndexes.length !== 1) return "Every word split into syllables must have exactly one fully capitalized stressed syllable (for example, com-MEND-ed)."
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
