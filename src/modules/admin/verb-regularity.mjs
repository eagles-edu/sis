import path from "node:path"
import { fileURLToPath } from "node:url"

import italicVerbData from "../../../data/verb-regularity.json" with { type: "json" }

const REFERENCE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/esl/1000-FIVE-FORMS-VERB.pdf")
const irregularVerbs = new Set(italicVerbData.irregularVerbs)
const normalize = (value) => String(value == null ? "" : value).normalize("NFC").trim().toLocaleLowerCase("en-US")

function regularPastForms(base) {
  const value = normalize(base)
  if (!value) return new Set()
  const forms = new Set([value + "ed"])
  if (value.endsWith("e")) forms.add(value + "d")
  if (/[^aeiou]y$/u.test(value)) forms.add(value.slice(0, -1) + "ied")
  if (/[aeiou][^aeiouwxy]$/u.test(value)) forms.add(value + value.at(-1) + "ed")
  if (value.endsWith("c")) forms.add(value + "ked")
  return forms
}

function spellingRegularity(row) {
  const base = normalize(row?.base)
  const past = normalize(row?.slots?.V2?.[0]?.form)
  const participle = normalize(row?.slots?.V3?.[0]?.form)
  if (!base || !past || !participle) return null
  const regularForms = regularPastForms(base)
  return regularForms.has(past) && regularForms.has(participle) ? "regular" : "irregular"
}

const regularityByVerb = new Map(
  (italicVerbData.rows || [])
    .map((row) => [normalize(row.base), row.regularity])
    .filter(([verb, regularity]) => verb && regularity),
)
const formsByVerb = new Map(
  (italicVerbData.rows || [])
    .map((row) => [normalize(row.base), row.forms])
    .filter(([verb, forms]) => verb && forms && Object.values(forms).every(Boolean)),
)

export function getVerbRegularity(verb) {
  const normalized = String(verb == null ? "" : verb).normalize("NFC").trim().toLocaleLowerCase("en-US")
  const regularity = regularityByVerb.get(normalized) || null
  return {
    verb: normalized,
    found: Boolean(regularity),
    regularity,
    source: italicVerbData.source + " plus regular spelling heuristic",
  }
}

export function getVerbForms(verb) {
  const normalized = normalize(verb).replace(/^to\s+/u, "")
  const forms = formsByVerb.get(normalized)
  if (!forms) return { verb: normalized, found: false, infinitive: null, forms: null }
  return {
    verb: normalized,
    found: true,
    infinitive: `to ${forms.V1}`,
    forms: { V1: forms.V1, V2: forms.V2, V3: forms.V3, V4: forms.V4, V5: forms.V5 },
  }
}

export { REFERENCE_PATH, irregularVerbs, regularPastForms, regularityByVerb, spellingRegularity, formsByVerb }
