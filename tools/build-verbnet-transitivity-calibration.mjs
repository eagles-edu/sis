#!/usr/bin/env node

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { XMLParser } from "fast-xml-parser"

const execFileAsync = promisify(execFile)
const DEFAULT_TARGET = "data/verb-transitivity-reference.json"
const DEFAULT_QUEUE = "data/verb-transitivity-review-queue.json"
const DEFAULT_CORPUS = "data/verb-transitivity.json"
const DEFAULT_OUTPUT = "data/verb-transitivity-verbnet-reference.json"
const DEFAULT_REPORT = "data/verb-transitivity-calibration-report.json"
const DEFAULT_CSV = "data/verb-transitivity-review.csv"
const CLASSIFICATIONS = ["intransitive", "monotransitive", "ambitransitive", "ditransitive"]
const XML_PARSER = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true })

function usage(message = "") {
  if (message) console.error(`Error: ${message}`)
  console.error("Usage: node tools/build-verbnet-transitivity-calibration.mjs --input <VerbNet-directory-or-tar.gz> [--target <json>] [--queue <json>] [--corpus <json>] [--output <json>] [--report <json>] [--csv <csv>]")
  process.exit(1)
}

function parseArgs(argv) {
  const options = { input: "", target: DEFAULT_TARGET, queue: DEFAULT_QUEUE, corpus: DEFAULT_CORPUS, output: DEFAULT_OUTPUT, report: DEFAULT_REPORT, csv: DEFAULT_CSV }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--input") options.input = argv[++index] || usage("--input requires a path")
    else if (argument === "--target") options.target = argv[++index] || usage("--target requires a path")
    else if (argument === "--queue") options.queue = argv[++index] || usage("--queue requires a path")
    else if (argument === "--corpus") options.corpus = argv[++index] || usage("--corpus requires a path")
    else if (argument === "--output") options.output = argv[++index] || usage("--output requires a path")
    else if (argument === "--report") options.report = argv[++index] || usage("--report requires a path")
    else if (argument === "--csv") options.csv = argv[++index] || usage("--csv requires a path")
    else if (argument === "--help" || argument === "-h") usage()
    else usage(`unknown option ${argument}`)
  }
  if (!options.input) usage("--input requires a VerbNet directory or tar.gz archive")
  return options
}

function normalizeVerb(value) {
  const normalized = String(value == null ? "" : value).normalize("NFC").trim().toLocaleLowerCase("en-US").replace(/[’]/gu, "'")
  return /^\p{L}[\p{L}'_-]*$/u.test(normalized) ? normalized : ""
}

function arrayValue(value) {
  if (value == null || value === "") return []
  return Array.isArray(value) ? value : [value]
}

function frameCategory(primary) {
  const frame = String(primary || "").trim()
  if (/^NP V NP(?:-Dative)? NP(?:$| )/u.test(frame)) return "ditransitive"
  if (/^NP V NP(?:$| )/u.test(frame)) return "monotransitive"
  if (frame === "NP V") return "intransitive"
  return null
}

function walkVerbNetClasses(node, output = []) {
  if (!node || typeof node !== "object") return output
  if (node["@_ID"] && node.MEMBERS && node.FRAMES) output.push(node)
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      if (Array.isArray(value)) value.forEach((item) => walkVerbNetClasses(item, output))
      else walkVerbNetClasses(value, output)
    }
  }
  return output
}

function readClass(node) {
  const classId = String(node["@_ID"])
  const members = arrayValue(node.MEMBERS?.MEMBER)
    .map((member) => ({ verb: normalizeVerb(member["@_name"]), verbNetKey: member["@_verbnet_key"] || null, grouping: member["@_grouping"] || null }))
    .filter((member) => member.verb)
  const frames = arrayValue(node.FRAMES?.FRAME).map((frame) => {
    const description = frame.DESCRIPTION || {}
    const primary = String(description["@_primary"] || "").trim()
    return {
      classId,
      descriptionNumber: description["@_descriptionNumber"] || null,
      primary,
      secondary: description["@_secondary"] || null,
      category: frameCategory(primary),
    }
  }).filter((frame) => frame.primary)
  return { classId, members, frames }
}

async function listXmlFiles(root) {
  const result = []
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(fullPath)
      else if (entry.isFile() && entry.name.toLocaleLowerCase("en-US").endsWith(".xml")) result.push(fullPath)
    }
  }
  await visit(root)
  return result.sort()
}

async function openInput(inputPath) {
  const absolute = path.resolve(inputPath)
  const stat = await fs.stat(absolute).catch(() => null)
  if (!stat) throw new Error(`VerbNet input does not exist: ${inputPath}`)
  if (stat.isDirectory()) return { root: absolute, cleanup: async () => {} }
  if (!stat.isFile() || !/\.(?:tar\.gz|tgz)$/iu.test(absolute)) throw new Error("--input must be a VerbNet directory or .tar.gz/.tgz archive")
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sis-verbnet-"))
  try {
    await execFileAsync("tar", ["-xzf", absolute, "-C", temporaryRoot])
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
    throw new Error(`could not extract VerbNet archive: ${error.message}`, { cause: error })
  }
  return { root: temporaryRoot, cleanup: () => fs.rm(temporaryRoot, { recursive: true, force: true }) }
}

async function readVerbNet(inputPath) {
  const opened = await openInput(inputPath)
  try {
    const files = await listXmlFiles(opened.root)
    if (!files.length) throw new Error("VerbNet input contains no XML files")
    const classes = []
    for (const file of files) {
      const parsed = XML_PARSER.parse(await fs.readFile(file, "utf8"))
      walkVerbNetClasses(parsed).forEach((node) => classes.push(readClass(node)))
    }
    const entries = new Map()
    for (const verbNetClass of classes) {
      for (const member of verbNetClass.members) {
        const entry = entries.get(member.verb) || { verb: member.verb, classes: new Set(), members: [], frames: [] }
        entry.classes.add(verbNetClass.classId)
        if (!entry.members.some((existing) => existing.verbNetKey === member.verbNetKey && existing.grouping === member.grouping)) entry.members.push(member)
        for (const frame of verbNetClass.frames) {
          if (!entry.frames.some((existing) => existing.classId === frame.classId && existing.primary === frame.primary && existing.secondary === frame.secondary)) entry.frames.push(frame)
        }
        entries.set(member.verb, entry)
      }
    }
    return { files, classes, entries }
  } finally {
    await opened.cleanup()
  }
}

function classifyCategories(categories) {
  const values = new Set(categories)
  if (values.has("ditransitive")) return "ditransitive"
  if (values.has("intransitive") && values.has("monotransitive")) return "ambitransitive"
  if (values.has("intransitive")) return "intransitive"
  if (values.has("monotransitive")) return "monotransitive"
  return "uncertain"
}

function targetVerbs(target) {
  const values = []
  for (const row of Array.isArray(target.rows) ? target.rows : []) values.push(row.base)
  for (const item of Array.isArray(target.items) ? target.items : []) values.push(item.base)
  return [...new Set(values.map(normalizeVerb).filter(Boolean))].sort((left, right) => left.localeCompare(right, "en-US"))
}

function corpusEntries(corpus) {
  return new Map((Array.isArray(corpus.entries) ? corpus.entries : []).map((entry) => [normalizeVerb(entry.verb), entry]))
}

function summarize(entries, target, queue, sourceMetadata) {
  const targetClassificationItems = (Array.isArray(queue.items) ? queue.items : []).filter((item) => item.gapType === "classification")
  const targetGapRawBases = new Set(targetClassificationItems.map((item) => String(item.base || "").trim()).filter(Boolean))
  const targetGapBases = new Set([...targetGapRawBases].map(normalizeVerb).filter(Boolean))
  const classifiedGapItems = targetClassificationItems.filter((item) => entries.has(normalizeVerb(item.base)) && entries.get(normalizeVerb(item.base)).classification !== "uncertain")
  const classes = Object.fromEntries(CLASSIFICATIONS.map((classification) => [classification, 0]))
  for (const entry of entries.values()) if (classes[entry.classification] != null) classes[entry.classification] += 1
  const targetRawVerbs = new Set((Array.isArray(target.rows) ? target.rows : []).map((row) => String(row.base || "").trim()).filter(Boolean))
  const targetValidVerbs = new Set([...targetRawVerbs].map(normalizeVerb).filter(Boolean))
  const comparisonPairs = {}
  for (const entry of entries.values()) {
    if (!entry.corpusClassification) continue
    const pair = `${entry.corpusClassification}->${entry.classification}`
    comparisonPairs[pair] = (comparisonPairs[pair] || 0) + 1
  }
  const verbNetMatched = [...entries.values()].filter((entry) => entry.verbNetClasses.length > 0).length
  return {
    source: sourceMetadata,
    targetRows: Array.isArray(target.rows) ? target.rows.length : 0,
    targetUniqueVerbs: targetRawVerbs.size,
    targetValidVerbs: targetValidVerbs.size,
    targetInvalidVerbs: [...targetRawVerbs].filter((verb) => !normalizeVerb(verb)),
    verbNetMatched,
    verbNetUnmatched: Math.max(0, targetValidVerbs.size - verbNetMatched),
    classifications: classes,
    classificationGapItems: targetClassificationItems.length,
    classificationGapBases: targetGapBases.size,
    classificationGapInvalidBases: [...targetGapRawBases].filter((base) => !normalizeVerb(base)),
    classificationGapItemsWithFrameEvidence: classifiedGapItems.length,
    classificationGapBasesWithFrameEvidence: new Set(classifiedGapItems.map((item) => normalizeVerb(item.base))).size,
    frameEvidenceCategories: Object.fromEntries(CLASSIFICATIONS.filter((classification) => classification !== "ambitransitive").map((classification) => [classification, [...entries.values()].filter((entry) => entry.evidenceCategories.includes(classification)).length])),
    comparisonPairs,
  }
}

function buildReference(verbNet, target, corpus, queue) {
  const corpusByVerb = corpusEntries(corpus)
  const targets = targetVerbs(target)
  const entries = []
  const reportEntries = []
  for (const verb of targets) {
    const verbNetEntry = verbNet.entries.get(verb)
    const corpusEntry = corpusByVerb.get(verb)
    const frames = verbNetEntry?.frames || []
    const evidenceCategories = [...new Set(frames.map((frame) => frame.category).filter(Boolean))]
    const classification = classifyCategories(evidenceCategories)
    const corpusClassification = corpusEntry?.classification || null
    const status = !verbNetEntry
      ? "unmatched"
      : classification === "uncertain"
        ? "unclassified"
        : corpusClassification && corpusClassification !== classification
          ? "conflict"
          : "provisional"
    const output = {
      verb,
      classification,
      classificationSource: classification === "uncertain" ? null : "VerbNet frame-derived",
      status,
      confidence: classification === "uncertain" ? "none" : status === "conflict" ? "conflict" : "provisional",
      evidenceCategories,
      verbNetClasses: verbNetEntry ? [...verbNetEntry.classes].sort() : [],
      frames,
      corpusClassification,
      corpusTotal: corpusEntry?.total || null,
    }
    entries.push(output)
    reportEntries.push({ ...output, classificationGapBase: new Set((queue.items || []).filter((item) => item.gapType === "classification").map((item) => normalizeVerb(item.base))).has(verb) })
  }
  return { entries, reportEntries }
}

async function writeJson(filePath, value) {
  const absolute = path.resolve(filePath)
  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await fs.writeFile(absolute, `${JSON.stringify(value)}\n`)
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))]
}

function csvCell(value) {
  const text = String(value == null ? "" : value).replace(/[\r\n]/gu, " ")
  return /[",]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text
}

function buildCsv(report, queue) {
  const reportByVerb = new Map(report.entries.map((entry) => [entry.verb, entry]))
  const classificationItems = (queue.items || []).filter((item) => item.gapType === "classification")
  const groupedGaps = new Map()
  for (const item of classificationItems) {
    const base = String(item.base || "").trim()
    const group = groupedGaps.get(base) || { base, forms: new Set(), rows: new Set(), slots: new Set(), statuses: new Set() }
    if (item.form) group.forms.add(item.form)
    if (item.row != null) group.rows.add(item.row)
    if (item.slot) group.slots.add(item.slot)
    if (item.status) group.statuses.add(item.status)
    groupedGaps.set(base, group)
  }
  const gapRows = [...groupedGaps.values()].sort((left, right) => left.base.localeCompare(right.base, "en-US"))
  const frameText = (entry) => uniqueValues((entry?.frames || []).filter((frame) => frame.category).map((frame) => `${frame.primary} (${frame.category})`)).join("; ")
  const classText = (entry) => uniqueValues(entry?.verbNetClasses || []).join(", ")
  const records = new Map()
  const addRecord = (verb, reason, entry, gap = null) => {
    const record = records.get(verb) || { verb, reasons: new Set(), forms: new Set(), rows: new Set(), slots: new Set(), statuses: new Set(), entry: null }
    record.reasons.add(reason)
    if (gap) {
      gap.forms.forEach((form) => record.forms.add(form))
      gap.rows.forEach((row) => record.rows.add(row))
      gap.slots.forEach((slot) => record.slots.add(slot))
      gap.statuses.forEach((status) => record.statuses.add(status))
    }
    if (entry) record.entry = entry
    records.set(verb, record)
  }
  for (const gap of gapRows) addRecord(gap.base, "classification-gap", reportByVerb.get(gap.base), gap)
  for (const entry of report.entries) {
    if (entry.status === "conflict") addRecord(entry.verb, "corpus-vs-verbnet-conflict", entry)
    if (entry.status === "unmatched") addRecord(entry.verb, "verbnet-unmatched", entry)
    if (entry.status === "unclassified") addRecord(entry.verb, "verbnet-unclassified", entry)
  }
  const headers = ["verb", "reviewReason", "affectedFormCount", "affectedForms", "pdfRows", "pdfSlots", "corpusClassification", "verbnetClassification", "status", "frameEvidence", "verbnetClasses", "reviewStatus"]
  const rows = [...records.values()].sort((left, right) => left.verb.localeCompare(right.verb, "en-US")).map((record) => {
    const entry = record.entry
    const status = entry?.status || "pending"
    return [
      record.verb,
      [...record.reasons].sort().join("; "),
      record.forms.size,
      [...record.forms].sort().join(", "),
      [...record.rows].sort((left, right) => Number(left) - Number(right)).join(", "),
      [...record.slots].sort().join(", "),
      entry?.corpusClassification || "",
      entry?.classification || "",
      status,
      frameText(entry),
      classText(entry),
      [...record.statuses].sort().join("; ") || "pending",
    ]
  })
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n"
}

async function build(options) {
  const [target, corpus, queue, verbNet] = await Promise.all([
    fs.readFile(path.resolve(options.target), "utf8").then(JSON.parse),
    fs.readFile(path.resolve(options.corpus), "utf8").then(JSON.parse),
    fs.readFile(path.resolve(options.queue), "utf8").then(JSON.parse),
    readVerbNet(options.input),
  ])
  const source = {
    name: "VerbNet",
    version: "3.4",
    repository: "https://github.com/cu-clear/verbnet",
    sourceRevision: "ae8e9cfdc2c0d3414b748763612f1a0a34194cc6",
    license: "VerbNet 3.X license; University of Colorado attribution required",
  }
  const built = buildReference(verbNet, target, corpus, queue)
  const summary = summarize(new Map(built.entries.map((entry) => [entry.verb, entry])), target, queue, source)
  const conflicts = built.reportEntries.filter((entry) => entry.status === "conflict")
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: { ...summary, conflicts: conflicts.length, conflictVerbs: conflicts.map((entry) => entry.verb) },
    entries: built.reportEntries,
  }
  await writeJson(options.output, { schemaVersion: 1, generatedAt: report.generatedAt, source, target: { source: target.source, pdf: target.target?.pdf }, entries: built.entries })
  await writeJson(options.report, report)
  const csvPath = path.resolve(options.csv)
  await fs.mkdir(path.dirname(csvPath), { recursive: true })
  await fs.writeFile(csvPath, buildCsv(report, queue))
  console.log(`Parsed ${verbNet.files.length} XML files and ${verbNet.entries.size} VerbNet verbs`)
  console.log(`Matched ${summary.verbNetMatched}/${summary.targetUniqueVerbs} target verbs; frame evidence for ${summary.classificationGapItemsWithFrameEvidence}/${summary.classificationGapItems} classification-gap items`)
  console.log(`Wrote ${path.relative(process.cwd(), path.resolve(options.output))}`)
  console.log(`Wrote ${path.relative(process.cwd(), path.resolve(options.report))}`)
  console.log(`Wrote ${path.relative(process.cwd(), csvPath)}`)
}

build(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
