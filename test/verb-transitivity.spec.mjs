import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import test from "node:test"
import { checkVerbFormsTransitivity, checkVerbTransitivity, getVerbTransitivity } from "../src/modules/admin/verb-transitivity.mjs"

const execFileAsync = promisify(execFile)

test("verb transitivity data preserves corpus evidence and aggregates duplicate forms", () => {
  const give = getVerbTransitivity("GIVE")
  assert.equal(give.found, true)
  assert.equal(give.total, 7229825)
  assert.equal(give.counts.ditransitive, 1869386)
  assert.equal(give.classification, "ditransitive")
  assert.equal(give.recommendedType, "ditransitive")
  assert.equal(give.classificationConfidence, give.percentages.ditransitive)
  assert.equal(checkVerbTransitivity("sleep", "intransitive").matchesExpected, true)
  assert.equal(checkVerbTransitivity("access", "monotransitive").matchesExpected, true)
  assert.equal(checkVerbTransitivity("give", "transitive").matchesExpected, true)
  assert.equal(checkVerbTransitivity("read", "ambitransitive").matchesExpected, true)
  const inherited = checkVerbTransitivity("apologizes", "intransitive")
  assert.equal(inherited.matchesExpected, true)
  assert.equal(inherited.classificationEvidence, "corpus-lemma-inherited")
  assert.equal(inherited.resolvedLemma, "apologize")
})

test("unknown forms are reported without guessed transitivity", () => {
  const result = checkVerbTransitivity("not-in-the-corpus", "intransitive")
  assert.equal(result.found, false)
  assert.equal(result.matchesExpected, null)
  assert.equal(result.support, null)
})

test("form checks identify known and missing inflections", () => {
  const result = checkVerbFormsTransitivity({
    verbTransitivity: "ambitransitive",
    verbInfinitive: "read",
    verbV1: "read",
    verbV2: "read",
    verbV3: "read",
    verbV4: "reading",
    verbV5: "reads",
  })
  assert.deepEqual(result.checkedForms, ["read", "reading", "reads"])
  assert.deepEqual(result.missingForms, [])
  assert.equal(result.matchesExpected, true)
  assert.equal(result.verificationStatus, "verified")
  assert.deepEqual(result.inheritedForms, [])
})

test("generic transitive checks include monotransitive and ditransitive corpus evidence", () => {
  assert.equal(checkVerbTransitivity("sleep", "transitive").matchesExpected, false)
  assert.equal(checkVerbTransitivity("give", "transitive").matchesExpected, true)
  assert.equal(checkVerbTransitivity("unknown-transitive-form", "transitive").verificationStatus, "unavailable")
})

test("the prebuilt UniMorph reference stays separate from the runtime corpus and records review gaps", async () => {
  const reference = JSON.parse(await readFile("data/verb-transitivity-reference.json", "utf8"))
  const queue = JSON.parse(await readFile("data/verb-transitivity-review-queue.json", "utf8"))
  assert.equal(reference.source.name, "UniMorph English")
  assert.equal(reference.target.rows, 999)
  assert.equal(reference.forms.apologizes.correct, true)
  assert.equal(reference.forms.apologizes.matchesBaseLemma, true)
  assert.equal(reference.forms.apologizes.classification.status, "inherited")
  assert.ok(queue.items.length > 0)
  assert.equal(new Set(queue.items.map((item) => item.key)).size, queue.items.length)
  assert.ok(queue.items.every((item) => item.status === "pending"))
})

test("the offline VerbNet importer writes frame evidence and calibration conflicts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sis-verbnet-calibration-"))
  const verbNetDir = path.join(tempDir, "verbnet3.4")
  const target = path.join(tempDir, "target.json")
  const queue = path.join(tempDir, "queue.json")
  const corpus = path.join(tempDir, "corpus.json")
  const output = path.join(tempDir, "output.json")
  const report = path.join(tempDir, "report.json")
  const csv = path.join(tempDir, "review.csv")
  await mkdir(verbNetDir, { recursive: true })
  await writeFile(path.join(verbNetDir, "sample.xml"), `<?xml version="1.0"?>
<ROOT>
<VNCLASS ID="transfer-13.1">
  <MEMBERS><MEMBER name="give" verbnet_key="give#1" grouping="give.01"/></MEMBERS>
  <FRAMES>
    <FRAME><DESCRIPTION primary="NP V NP NP" secondary="Dative"/></FRAME>
    <FRAME><DESCRIPTION primary="NP V NP" secondary="Basic Transitive"/></FRAME>
  </FRAMES>
</VNCLASS>
<VNCLASS ID="sleep-40.1">
  <MEMBERS><MEMBER name="sleep" verbnet_key="sleep#1" grouping="sleep.01"/></MEMBERS>
  <FRAMES><FRAME><DESCRIPTION primary="NP V" secondary="Basic Intransitive"/></FRAME></FRAMES>
</VNCLASS>
</ROOT>`)
  await writeFile(target, JSON.stringify({ source: "test", rows: [{ base: "give" }, { base: "sleep" }, { base: "missing" }] }))
  await writeFile(queue, JSON.stringify({ items: [{ base: "give", gapType: "classification" }, { base: "missing", gapType: "classification" }] }))
  await writeFile(corpus, JSON.stringify({ entries: [{ verb: "give", classification: "monotransitive", total: 100 }, { verb: "sleep", classification: "intransitive", total: 100 }] }))
  try {
    await execFileAsync(process.execPath, ["tools/build-verbnet-transitivity-calibration.mjs", "--input", verbNetDir, "--target", target, "--queue", queue, "--corpus", corpus, "--output", output, "--report", report, "--csv", csv], { cwd: process.cwd() })
    const built = JSON.parse(await readFile(output, "utf8"))
    const calibration = JSON.parse(await readFile(report, "utf8"))
    const readable = await readFile(csv, "utf8")
    const give = built.entries.find((entry) => entry.verb === "give")
    assert.equal(give.classification, "ditransitive")
    assert.deepEqual(give.evidenceCategories, ["ditransitive", "monotransitive"])
    assert.equal(calibration.summary.conflicts, 1)
    assert.equal(calibration.entries.find((entry) => entry.verb === "give").status, "conflict")
    assert.equal(calibration.entries.find((entry) => entry.verb === "missing").status, "unmatched")
    assert.match(readable, /verb,reviewReason,affectedFormCount/u)
    assert.match(readable, /give,classification-gap/u)
    assert.match(readable, /give,classification-gap; corpus-vs-verbnet-conflict/u)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("the modern extractor aggregates raw TSV rows and applies the minimum count", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sis-verb-transitivity-"))
  const input = path.join(tempDir, "raw.tsv")
  const output = path.join(tempDir, "output.json")
  await writeFile(input, [
    "verb\targ_structure\tcount",
    "walk\t\t1500",
    "walk\tdobj\t500",
    "give\tiobj dobj\t3000",
    "give\tdobj\t2500",
    "ignore\t\t2000",
  ].join("\n"))
  try {
    await execFileAsync(process.execPath, ["tools/build-verb-transitivity-data.mjs", "--input", input, "--output", output], { cwd: process.cwd() })
    const built = JSON.parse(await readFile(output, "utf8"))
    assert.deepEqual(built.entries, [
      { verb: "give", classification: "ditransitive", classificationConfidence: 3000 / 5500, counts: { intransitive: 0, monotransitive: 2500, xtransitive: 0, ditransitive: 3000 }, total: 5500 },
    ])
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
