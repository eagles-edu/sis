export const CLASSIFICATION_RULE_VERSION = "v1"
export const DITRANSITIVE_THRESHOLD = 0.1
export const MIXED_USE_THRESHOLD = 0.1
export const DOMINANT_THRESHOLD = 0.5

const CATEGORIES = ["intransitive", "monotransitive", "xtransitive", "ditransitive"]

export function classifyVerbCounts(counts = {}, total = 0) {
  const denominator = Number(total) || CATEGORIES.reduce((sum, category) => sum + (Number(counts[category]) || 0), 0)
  const percentages = Object.fromEntries(CATEGORIES.map((category) => [category, denominator ? (Number(counts[category]) || 0) / denominator : 0]))
  let classification = "uncertain"
  let confidence = Math.max(...CATEGORIES.map((category) => percentages[category]))
  if (percentages.ditransitive >= DITRANSITIVE_THRESHOLD) {
    classification = "ditransitive"
    confidence = percentages.ditransitive
  } else if (percentages.intransitive >= MIXED_USE_THRESHOLD && percentages.monotransitive >= MIXED_USE_THRESHOLD) {
    classification = "ambitransitive"
    confidence = Math.min(percentages.intransitive, percentages.monotransitive) * 2
  } else if (percentages.intransitive >= DOMINANT_THRESHOLD) {
    classification = "intransitive"
    confidence = percentages.intransitive
  } else if (percentages.monotransitive >= DOMINANT_THRESHOLD) {
    classification = "monotransitive"
    confidence = percentages.monotransitive
  }
  return { classification, classificationConfidence: confidence, percentages }
}
