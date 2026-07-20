// @ts-check

/**
 * One canonical class/level catalog for every admin data path.
 * Unknown values are still preserved after whitespace normalization so
 * custom levels remain usable without creating a second naming variant.
 */
export const LEVEL_DEFINITIONS = Object.freeze([
  { canonical: "Eggs & Chicks", aliases: ["EggChic", "EggChicks", "Eggs and Chicks", "Eggs Chicks"] },
  { canonical: "Pre-A1 Starters", aliases: ["Starters", "Pre A1 Starters", "G4", "Grade 4", "Level 4"] },
  { canonical: "A1 Movers", aliases: ["Movers", "G5", "Grade 5", "Level 5"] },
  { canonical: "A2 Flyers", aliases: ["Flyers", "G6", "Grade 6", "Level 6"] },
  { canonical: "A2 KET", aliases: ["KET", "G7", "Grade 7", "Level 7"] },
  { canonical: "B1 PET", aliases: ["PET", "G8", "Grade 8", "Level 8"] },
  { canonical: "B2+ IELTS", aliases: ["IELTS", "B2 IELTS", "G9", "Grade 9", "Level 9"] },
  { canonical: "C1+ TAYK", aliases: ["TAYK", "C1 TAYK", "G10", "Grade 10", "Level 10"] },
  { canonical: "Private", aliases: ["Private Class", "1:1 Private"] },
])

/** @param {unknown} value @returns {string} */
function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim().replace(/\s+/g, " ")
}

/** @param {unknown} value @returns {string} */
function normalizeLevelKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "")
}

const LEVEL_ALIAS_MAP = new Map()
for (const entry of LEVEL_DEFINITIONS) {
  for (const variant of [entry.canonical, ...(entry.aliases || [])]) {
    const key = normalizeLevelKey(variant)
    if (key) LEVEL_ALIAS_MAP.set(key, entry.canonical)
  }
}

/** @param {unknown} value @returns {string} */
export function canonicalizeLevel(value) {
  const text = normalizeText(value)
  if (!text) return ""
  return LEVEL_ALIAS_MAP.get(normalizeLevelKey(text)) || text
}

/** @param {unknown} value @returns {string[]} */
export function resolveLevelVariants(value) {
  const text = normalizeText(value)
  if (!text) return []
  const canonical = canonicalizeLevel(text)
  const definition = LEVEL_DEFINITIONS.find((entry) => entry.canonical === canonical)
  return definition ? Array.from(new Set([definition.canonical, ...(definition.aliases || [])])) : [text]
}
