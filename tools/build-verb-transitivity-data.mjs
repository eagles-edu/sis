#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import { CLASSIFICATION_RULE_VERSION, classifyVerbCounts } from "../src/modules/admin/verb-transitivity-rules.mjs"

const DEFAULT_OUTPUT = "data/verb-transitivity.json"
const CATEGORIES = ["intransitive", "monotransitive", "xtransitive", "ditransitive"]

function usage(message = "") {
  if (message) console.error(`Error: ${message}`)
  console.error("Usage: node tools/build-verb-transitivity-data.mjs --input <file-or-directory> [--input <path>] [--output <json>] [--min-count <number>]")
  process.exit(1)
}

function parseArgs(argv) {
  const options = { inputs: [], output: DEFAULT_OUTPUT, minCount: 2000 }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--input") options.inputs.push(argv[++index] || usage("--input requires a path"))
    else if (argument === "--output") options.output = argv[++index] || usage("--output requires a path")
    else if (argument === "--min-count") options.minCount = Number(argv[++index])
    else if (argument === "--help" || argument === "-h") usage()
    else usage(`unknown option ${argument}`)
  }
  if (!options.inputs.length) usage("at least one --input path is required")
  if (!Number.isSafeInteger(options.minCount) || options.minCount < 0) usage("--min-count must be a non-negative integer")
  return options
}

function normalizeVerb(value) {
  const normalized = String(value == null ? "" : value).normalize("NFC").trim().toLocaleLowerCase("en-US")
  return /^\p{L}[\p{L}'’\-]*$/u.test(normalized) ? normalized : ""
}

function count(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

async function inputFiles(inputPath) {
  const absolute = path.resolve(inputPath)
  const stat = await fs.stat(absolute).catch(() => null)
  if (!stat) throw new Error(`input path does not exist: ${inputPath}`)
  if (stat.isFile()) return [absolute]
  if (!stat.isDirectory()) throw new Error(`input path is not a file or directory: ${inputPath}`)
  const entries = await fs.readdir(absolute, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(absolute, entry.name)).sort()
}

function addCounts(index, verb, values) {
  const key = normalizeVerb(verb)
  if (!key) return
  const existing = index.get(key) || Object.fromEntries(CATEGORIES.map((category) => [category, 0]))
  CATEGORIES.forEach((category) => { existing[category] += count(values[category]) })
  index.set(key, existing)
}

function parseFile(raw, source) {
  const rows = raw.split(/\r?\n/u).map((line) => line.split("\t")).filter((fields) => fields.some(Boolean))
  if (!rows.length) return new Map()
  const header = rows[0].map((field) => field.trim().toLocaleLowerCase("en-US"))
  const derived = header[0] === "verb" && header[1] === "intrans" && header[2] === "trans" && header[3] === "xtrans" && header[4] === "ditrans"
  const index = new Map()
  for (const [rowNumber, fields] of rows.entries()) {
    if (rowNumber === 0 && (fields[0] || "").trim().toLocaleLowerCase("en-US") === "verb") continue
    if (derived) {
      if (fields.length < 5) throw new Error(`${source}:${rowNumber + 1} has fewer than five derived columns`)
      addCounts(index, fields[0], { intransitive: fields[1], monotransitive: fields[2], xtransitive: fields[3], ditransitive: fields[4] })
      continue
    }
    if (fields.length < 3) throw new Error(`${source}:${rowNumber + 1} has fewer than three raw columns`)
    const verb = normalizeVerb(fields[0])
    const argumentStructure = fields[1] || ""
    const rowCount = count(fields[2])
    if (!verb || !rowCount) continue
    const hasDirectObject = argumentStructure.includes("dobj")
    const hasIndirectObject = argumentStructure.includes("iobj")
    const category = hasDirectObject && hasIndirectObject
      ? "ditransitive"
      : hasDirectObject
        ? "monotransitive"
        : hasIndirectObject
          ? "xtransitive"
          : "intransitive"
    addCounts(index, verb, { [category]: rowCount })
  }
  return index
}

async function build(options) {
  const files = (await Promise.all(options.inputs.map(inputFiles))).flat()
  if (!files.length) throw new Error("no input files found")
  const aggregate = new Map()
  for (const file of files) {
    const parsed = parseFile(await fs.readFile(file, "utf8"), file)
    for (const [verb, counts] of parsed) addCounts(aggregate, verb, counts)
  }
  const entries = [...aggregate.entries()]
    .map(([verb, counts]) => {
      const total = CATEGORIES.reduce((sum, category) => sum + counts[category], 0)
      const classification = classifyVerbCounts(counts, total)
      return { verb, classification: classification.classification, classificationConfidence: classification.classificationConfidence, counts, total }
    })
    .filter((entry) => entry.total > options.minCount)
    .sort((left, right) => left.verb.localeCompare(right.verb, "en-US"))
  const output = path.resolve(options.output)
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify({ source: "Google Syntactic NGram corpus", minTotalCount: options.minCount, classificationRuleVersion: CLASSIFICATION_RULE_VERSION, entries })}\n`)
  console.log(`Wrote ${entries.length} verb forms from ${files.length} input file(s) to ${path.relative(process.cwd(), output)}`)
}

build(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
