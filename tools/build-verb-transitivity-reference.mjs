#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { CLASSIFICATION_RULE_VERSION } from "../src/modules/admin/verb-transitivity-rules.mjs"

const execFileAsync = promisify(execFile)
const DEFAULT_PDF = "docs/esl/1000-FIVE-FORMS-VERB.pdf"
const DEFAULT_UNIMORPH = "tmp/unimorph/eng"
const DEFAULT_OUTPUT = "data/verb-transitivity-reference.json"
const DEFAULT_QUEUE = "data/verb-transitivity-review-queue.json"
const SLOTS = ["V1", "V2", "V3", "V4", "V5"]

function usage(message = "") {
  if (message) console.error(`Error: ${message}`)
  console.error("Usage: node tools/build-verb-transitivity-reference.mjs --unimorph <file> [--pdf <file>] [--corpus <json>] [--output <json>] [--queue <json>]")
  process.exit(1)
}

function parseArgs(argv) {
  const options = { unimorph: DEFAULT_UNIMORPH, pdf: DEFAULT_PDF, corpus: "data/verb-transitivity.json", output: DEFAULT_OUTPUT, queue: DEFAULT_QUEUE }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--unimorph") options.unimorph = argv[++index] || usage("--unimorph requires a path")
    else if (argument === "--pdf") options.pdf = argv[++index] || usage("--pdf requires a path")
    else if (argument === "--corpus") options.corpus = argv[++index] || usage("--corpus requires a path")
    else if (argument === "--output") options.output = argv[++index] || usage("--output requires a path")
    else if (argument === "--queue") options.queue = argv[++index] || usage("--queue requires a path")
    else if (argument === "--help" || argument === "-h") usage()
    else usage(`unknown option ${argument}`)
  }
  return options
}

function normalize(value) {
  return String(value == null ? "" : value).normalize("NFC").trim().toLocaleLowerCase("en-US")
}

function splitAlternatives(value) {
  const normalized = String(value == null ? "" : value).replace(/[’]/gu, "'").trim()
  if (!normalized) return []
  const expanded = normalized
    .replace(/[()]/gu, "")
    .split(/[\/,]/u)
    .map((part) => normalize(part))
    .filter(Boolean)
  return [...new Set(expanded)]
}

async function extractPdfRows(pdfPath) {
  let stdout
  try {
    ({ stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }))
  } catch (error) {
    throw new Error(`could not extract ${pdfPath} with pdftotext: ${error.message}`, { cause: error })
  }
  const rows = []
  for (const line of stdout.split(/\r?\n/u)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/u)
    if (!match) continue
    const columns = match[2].trim().split(/\s{2,}/u)
    if (columns.length < SLOTS.length) continue
    const fields = columns.length === SLOTS.length
      ? columns
      : [columns[0], ...columns.slice(-SLOTS.length + 1)]
    const base = splitAlternatives(fields[0])[0] || ""
    if (!base) continue
    rows.push({ row: Number(match[1]), base, slots: Object.fromEntries(SLOTS.map((slot, index) => [slot, splitAlternatives(fields[index])])) })
  }
  if (!rows.length) throw new Error(`no numbered verb rows found in ${pdfPath}`)
  return rows
}

function parseUniMorph(raw, targetForms) {
  const forms = new Map()
  let inputRows = 0
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.trim()) continue
    const fields = line.split("\t")
    if (fields.length < 3 || !fields[2].startsWith("V;")) continue
    inputRows += 1
    const lemma = normalize(fields[0])
    const form = normalize(fields[1])
    if (!lemma || !form || !targetForms.has(form)) continue
    const candidates = forms.get(form) || []
    const candidate = { lemma, features: fields[2].split(";").filter(Boolean) }
    if (!candidates.some((existing) => existing.lemma === candidate.lemma && existing.features.join(";") === candidate.features.join(";"))) candidates.push(candidate)
    forms.set(form, candidates)
  }
  return { forms, inputRows }
}

function candidateForBase(formCandidates, base) {
  return formCandidates.find((candidate) => candidate.lemma === base) || null
}

function corpusClassification(corpusEntries, lemma) {
  const entry = corpusEntries.get(lemma)
  if (!entry) return null
  return {
    classification: entry.classification || "uncertain",
    classificationConfidence: entry.classificationConfidence ?? null,
    total: entry.total,
    counts: entry.counts,
  }
}

function buildReference(rows, unimorph, corpus) {
  const corpusEntries = new Map((Array.isArray(corpus.entries) ? corpus.entries : []).map((entry) => [normalize(entry.verb), entry]))
  const forms = {}
  const queue = []
  const summary = {
    rows: rows.length,
    forms: 0,
    morphologyMatched: 0,
    morphologyGaps: 0,
    directClassifications: 0,
    inheritedClassifications: 0,
    classificationGaps: 0,
  }
  const referenceRows = rows.map((row) => {
    const baseClassification = corpusClassification(corpusEntries, row.base)
    const rowForms = {}
    for (const slot of SLOTS) {
      rowForms[slot] = row.slots[slot].map((form) => {
        summary.forms += 1
        const candidates = unimorph.forms.get(form) || []
        const baseCandidate = candidateForBase(candidates, row.base)
        const directEntry = corpusEntries.get(form)
        const classification = directEntry
          ? { status: "direct", ...corpusClassification(corpusEntries, form) }
          : baseCandidate && baseClassification
            ? { status: "inherited", lemma: row.base, ...baseClassification }
            : { status: "gap" }
        if (baseCandidate) summary.morphologyMatched += 1
        else {
          summary.morphologyGaps += 1
          queue.push({ key: `${row.row}:${slot}:${form}:morphology`, row: row.row, base: row.base, slot, form, gapType: "morphology", status: "pending", candidates })
        }
        if (classification.status === "direct") summary.directClassifications += 1
        else if (classification.status === "inherited") summary.inheritedClassifications += 1
        else {
          summary.classificationGaps += 1
          queue.push({ key: `${row.row}:${slot}:${form}:classification`, row: row.row, base: row.base, slot, form, gapType: "classification", status: "pending", candidates })
        }
        forms[form] = { candidates, base: row.base, slot, row: row.row, correct: Boolean(baseCandidate), matchesBaseLemma: Boolean(baseCandidate), classification }
        return { form, correct: Boolean(baseCandidate), matchesBaseLemma: Boolean(baseCandidate), candidates, classification }
      })
    }
    return { row: row.row, base: row.base, slots: rowForms, classification: baseClassification }
  })
  return { rows: referenceRows, forms, queue, summary }
}

async function writeJson(outputPath, value) {
  const absolute = path.resolve(outputPath)
  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await fs.writeFile(absolute, `${JSON.stringify(value)}\n`)
}

async function build(options) {
  const [unimorphRaw, corpusRaw, rows] = await Promise.all([
    fs.readFile(path.resolve(options.unimorph), "utf8"),
    fs.readFile(path.resolve(options.corpus), "utf8"),
    extractPdfRows(path.resolve(options.pdf)),
  ])
  const corpus = JSON.parse(corpusRaw)
  const targetForms = new Set(rows.flatMap((row) => SLOTS.flatMap((slot) => row.slots[slot])))
  const unimorph = parseUniMorph(unimorphRaw, targetForms)
  const built = buildReference(rows, unimorph, corpus)
  const previousQueue = JSON.parse(await fs.readFile(path.resolve(options.queue), "utf8").catch(() => "{}"))
  const previousItems = new Map((Array.isArray(previousQueue.items) ? previousQueue.items : []).map((item) => [item.key, item]))
  const queueItems = built.queue.map((item) => {
    const previous = previousItems.get(item.key)
    return previous
      ? { ...item, status: previous.status || item.status, notes: previous.notes || null, reviewedAt: previous.reviewedAt || null, createdAt: previous.createdAt || new Date().toISOString() }
      : { ...item, createdAt: new Date().toISOString() }
  })
  const newGapCount = queueItems.filter((item) => !previousItems.has(item.key)).length
  const metadata = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      name: "UniMorph English",
      language: "eng",
      repository: "https://github.com/unimorph/eng",
      license: "CC BY-SA 3.0",
      sourceRevision: "66e0e9e8e2dcd196da081a25a48e5c1fe3d8b49b",
    },
    target: { pdf: path.relative(process.cwd(), path.resolve(options.pdf)), rows: rows.length, uniqueForms: targetForms.size },
    corpus: { source: corpus.source, classificationRuleVersion: corpus.classificationRuleVersion || CLASSIFICATION_RULE_VERSION },
    inputVerbRows: unimorph.inputRows,
  }
  await writeJson(options.output, { ...metadata, rows: built.rows, forms: built.forms })
  await writeJson(options.queue, { ...metadata, queueType: "transitivity-reference-review", summary: { ...built.summary, pendingItems: queueItems.filter((item) => item.status === "pending").length, newGapCount }, items: queueItems })
  console.log(`Wrote ${built.summary.rows} rows and ${built.summary.forms} forms to ${path.relative(process.cwd(), path.resolve(options.output))}`)
  console.log(`UniMorph matched ${built.summary.morphologyMatched}/${built.summary.forms}; classification gaps: ${built.summary.classificationGaps}`)
  console.log(`Wrote ${queueItems.length} review items (${newGapCount} new) to ${path.relative(process.cwd(), path.resolve(options.queue))}`)
}

build(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
