import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { classifyVerbCounts } from "./verb-transitivity-rules.mjs"

const DATA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data/verb-transitivity.json")
const REFERENCE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data/verb-transitivity-reference.json")
const EXPECTED_TYPES = new Set(["intransitive", "monotransitive", "transitive", "ditransitive", "ambitransitive"])
const CATEGORY_LABELS = ["intransitive", "monotransitive", "xtransitive", "ditransitive"]
const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"))
const reference = fs.existsSync(REFERENCE_PATH) ? JSON.parse(fs.readFileSync(REFERENCE_PATH, "utf8")) : { forms: {} }
const entries = new Map((Array.isArray(data.entries) ? data.entries : []).map((entry) => [entry.verb, entry]))
const referenceForms = new Map(Object.entries(reference.forms || {}))

function normalize(value) {
  return String(value == null ? "" : value).normalize("NFC").trim().toLocaleLowerCase("en-US")
}

function percentages(entry) {
  const total = Number(entry?.total) || 0
  return Object.fromEntries(CATEGORY_LABELS.map((category) => [category, total ? (Number(entry.counts?.[category]) || 0) / total : 0]))
}

function dominantType(percent) {
  return CATEGORY_LABELS.reduce((winner, category) => percent[category] > percent[winner] ? category : winner, CATEGORY_LABELS[0])
}

function supportFor(expected, percent) {
  if (expected === "ambitransitive") return Math.min(percent.intransitive, percent.monotransitive) * 2
  if (expected === "transitive") return Math.min(1, percent.monotransitive + percent.ditransitive + percent.xtransitive)
  return percent[expected] || 0
}

function inheritedEntry(form) {
  const referenceForm = referenceForms.get(form)
  if (!referenceForm) return null
  for (const candidate of referenceForm.candidates || []) {
    const entry = entries.get(normalize(candidate.lemma))
    if (entry) return { entry, lemma: normalize(candidate.lemma), candidate, referenceForm }
  }
  return null
}

function resultFromEntry(verb, entry, metadata = {}) {
  const percent = percentages(entry)
  const derived = classifyVerbCounts(entry.counts, entry.total)
  return {
    verb,
    found: true,
    source: data.source,
    minTotalCount: data.minTotalCount,
    total: entry.total,
    counts: { ...entry.counts },
    percentages: percent,
    dominantType: dominantType(percent),
    recommendedType: entry.classification || derived.classification,
    classification: entry.classification || derived.classification,
    classificationConfidence: entry.classificationConfidence ?? derived.classificationConfidence,
    classificationEvidence: metadata.classificationEvidence || "corpus-form",
    ...metadata,
  }
}

export function getVerbTransitivity(verb) {
  const normalizedVerb = normalize(verb)
  const entry = entries.get(normalizedVerb)
  if (entry) return resultFromEntry(normalizedVerb, entry)
  const inherited = inheritedEntry(normalizedVerb)
  if (!inherited) return { verb: normalizedVerb, found: false, source: data.source, minTotalCount: data.minTotalCount, reviewRequired: Boolean(referenceForms.has(normalizedVerb)) }
  return resultFromEntry(normalizedVerb, inherited.entry, {
    classificationEvidence: "corpus-lemma-inherited",
    resolvedLemma: inherited.lemma,
    morphologySource: reference.source?.name || "UniMorph",
    morphologyFeatures: inherited.candidate.features,
    referenceRow: inherited.referenceForm.row,
    referenceBase: inherited.referenceForm.base,
  })
}

export function checkVerbTransitivity(verb, expectedType = "") {
  const expected = normalize(expectedType)
  const result = getVerbTransitivity(verb)
  if (!expected) return { ...result, expected: null, matchesExpected: null, support: null }
  if (!EXPECTED_TYPES.has(expected)) return { ...result, expected, matchesExpected: null, support: null, verificationStatus: "unavailable", verificationMessage: `The selected transitivity type is not supported: ${expectedType}` }
  if (!result.found) return { ...result, expected, matchesExpected: null, support: null, verificationStatus: "unavailable" }
  const support = supportFor(expected, result.percentages)
  return { ...result, expected, support, matchesExpected: support >= 0.5 }
}

export function checkVerbFormsTransitivity(payload = {}) {
  const expected = normalize(payload.verbTransitivity)
  const values = [payload.verb, payload.verbInfinitive, payload.verbV1, payload.verbV2, payload.verbV3, payload.verbV4, payload.verbV5]
  const forms = [...new Set(values.map(normalize).filter(Boolean))]
  const checks = forms.map((form) => checkVerbTransitivity(form, expected))
  const knownChecks = checks.filter((check) => check.found)
  const verificationStatus = !expected
    ? "not-requested"
    : !knownChecks.length
      ? "unavailable"
      : knownChecks.every((check) => check.matchesExpected === true)
        ? "verified"
        : knownChecks.some((check) => check.matchesExpected === false)
          ? "mismatch"
          : "unavailable"
  return {
    expected: expected || null,
    checkedForms: forms,
    foundForms: knownChecks.map((check) => check.verb),
    missingForms: checks.filter((check) => !check.found).map((check) => check.verb),
    directForms: knownChecks.filter((check) => check.classificationEvidence === "corpus-form").map((check) => check.verb),
    inheritedForms: knownChecks.filter((check) => check.classificationEvidence === "corpus-lemma-inherited").map((check) => check.verb),
    reviewGaps: checks.filter((check) => !check.found).map((check) => ({ verb: check.verb, reviewRequired: check.reviewRequired, gapType: check.reviewRequired ? "classification" : "unindexed-form" })),
    matchesExpected: expected ? (knownChecks.length ? knownChecks.every((check) => check.matchesExpected) : null) : null,
    verificationStatus,
    checks,
  }
}

export { DATA_PATH, EXPECTED_TYPES, REFERENCE_PATH }
