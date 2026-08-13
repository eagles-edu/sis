import fs from "node:fs"
import { execFileSync } from "node:child_process"

const pdfPath = "docs/esl/1000-FIVE-FORMS-VERB.pdf"
const referencePath = "data/verb-transitivity-reference.json"
const outputPath = "data/verb-regularity.json"
const xml = execFileSync("pdftohtml", ["-xml", "-i", "-stdout", pdfPath], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
const italicVerbs = [...xml.matchAll(/<text[^>]*font="3"[^>]*><i>(\d+)\s+([^<]+)<\/i><\/text>/gu)]
  .map((match) => match[2].trim().toLocaleLowerCase("en-US"))
const reference = JSON.parse(fs.readFileSync(referencePath, "utf8"))
const normalize = (value) => String(value == null ? "" : value).normalize("NFC").trim().toLocaleLowerCase("en-US")
const americanBaseOverrides = new Map([
  ["co-operate", "cooperate"],
  ["colour", "color"],
  ["favour", "favor"],
  ["fulfil", "fulfill"],
  ["mould", "mold"],
  ["moult", "molt"],
  ["practise", "practice"],
  ["satirise", "satirize"],
])
const americanFormOverrides = new Map([
  ["burn", { V2: "burned", V3: "burned" }],
  ["co-operate", { V1: "cooperate", V2: "cooperated", V3: "cooperated", V4: "cooperating", V5: "cooperates" }],
  ["colour", { V1: "color", V2: "colored", V3: "colored", V4: "coloring", V5: "colors" }],
  ["counsel", { V2: "counseled", V3: "counseled", V4: "counseling" }],
  ["dream", { V2: "dreamed", V3: "dreamed" }],
  ["dwell", { V2: "dwelt", V3: "dwelt" }],
  ["favour", { V1: "favor", V2: "favored", V3: "favored", V4: "favoring", V5: "favors" }],
  ["fulfil", { V1: "fulfill", V2: "fulfilled", V3: "fulfilled", V4: "fulfilling", V5: "fulfills" }],
  ["imperil", { V2: "imperiled", V3: "imperiled", V4: "imperiling" }],
  ["kneel", { V2: "knelt", V3: "knelt" }],
  ["learn", { V2: "learned", V3: "learned" }],
  ["leap", { V2: "leaped", V3: "leaped" }],
  ["lean", { V2: "leaned", V3: "leaned" }],
  ["mould", { V1: "mold", V2: "molded", V3: "molded", V4: "molding", V5: "molds" }],
  ["moult", { V1: "molt", V2: "molted", V3: "molted", V4: "molting", V5: "molts" }],
  ["practise", { V1: "practice", V2: "practiced", V3: "practiced", V4: "practicing", V5: "practices" }],
  ["quarrel", { V2: "quarreled", V3: "quarreled", V4: "quarreling" }],
  ["satirise", { V1: "satirize", V2: "satirized", V3: "satirized", V4: "satirizing", V5: "satirizes" }],
  ["signal", { V2: "signaled", V3: "signaled", V4: "signaling" }],
  ["smell", { V2: "smelled", V3: "smelled" }],
  ["spell", { V2: "spelled", V3: "spelled" }],
  ["spill", { V2: "spilled", V3: "spilled" }],
  ["spoil", { V2: "spoiled", V3: "spoiled" }],
  ["travel", { V2: "traveled", V3: "traveled", V4: "traveling" }],
  ["wet", { V2: "wetted", V3: "wetted" }],
  ["worship", { V2: "worshiped", V3: "worshiped", V4: "worshiping" }],
  ["get", { V3: "gotten" }],
])
const regularPastForms = (base) => {
  const value = normalize(base)
  if (!value) return new Set()
  const forms = new Set([value + "ed"])
  if (value.endsWith("e")) forms.add(value + "d")
  if (/[^aeiou]y$/u.test(value)) forms.add(value.slice(0, -1) + "ied")
  if (/[aeiou][^aeiouwxy]$/u.test(value)) forms.add(value + value.at(-1) + "ed")
  if (value.endsWith("c")) forms.add(value + "ked")
  return forms
}
const spellingRegularity = (row) => {
  const base = normalize(row?.base)
  const past = normalize(row?.slots?.V2?.[0]?.form)
  const participle = normalize(row?.slots?.V3?.[0]?.form)
  if (!base || !past || !participle) return null
  const regularForms = regularPastForms(base)
  return regularForms.has(past) && regularForms.has(participle) ? "regular" : "irregular"
}
const italicSet = new Set(italicVerbs)
const rows = (reference.rows || []).map((row) => {
  const sourceBase = normalize(row.base)
  const base = americanBaseOverrides.get(sourceBase) || sourceBase
  const overrides = americanFormOverrides.get(sourceBase) || {}
  const forms = Object.fromEntries(["V1", "V2", "V3", "V4", "V5"].map((slot) => [slot, overrides[slot] || String(row.slots?.[slot]?.[0]?.form || "").trim()]))
  const americanRow = { base, slots: { V2: [{ form: forms.V2 }], V3: [{ form: forms.V3 }] } }
  return {
    row: row.row,
    base,
    forms,
    regularity: italicSet.has(base) ? "irregular" : spellingRegularity(americanRow),
  }
})
const allVerbs = [...new Set(rows.map((row) => row.base).filter(Boolean))]
const irregularVerbs = [...new Set(rows.filter((row) => row.regularity === "irregular").map((row) => row.base))].sort()
const regularVerbs = [...new Set(rows.filter((row) => row.regularity === "regular").map((row) => row.base))].sort()
const result = {
  source: pdfPath,
  dialect: "AmEng",
  generatedAt: new Date().toISOString(),
  irregularVerbs,
  regularVerbs,
  allVerbs,
  sourceRowCount: rows.length,
  uniqueVerbCount: allVerbs.length,
  rows,
}
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8")
console.log("Wrote " + new Set(italicVerbs).size + " source irregular signals and " + result.uniqueVerbCount + " unique verbs across " + result.sourceRowCount + " source rows to " + outputPath)
