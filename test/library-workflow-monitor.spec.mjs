import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  assertDevEnvironment,
  cleanupSynthetic,
  readLastSuccessTimestamp,
  renderLibraryMetrics,
  selectSyntheticVocabularyCandidate,
  SYNTHETIC_VOCABULARY_CANDIDATES,
  summarizeDictionaryBuilderDefinitionAvailability,
  writeMetricsAtomically,
} from "../tools/monitor-library-workflow.mjs"
import { validateVocabularyEntry } from "../src/modules/admin/vocabulary-syllabication.mjs"

function devEnvironment() {
  return { NODE_ENV: "development", SIS_ENV_FILE: ".env.dev", DOTENV_CONFIG_PATH: ".env.dev" }
}

function monitorMetrics(overrides = {}) {
  return renderLibraryMetrics({
    checkedAt: 200,
    durationSeconds: 2.5,
    success: true,
    lastSuccessTimestamp: 200,
    apiAvailable: true,
    databaseAvailable: true,
    redisAvailable: true,
    cmuDictionaryAvailable: true,
    collegiateKeyConfigured: true,
    learnersKeyConfigured: true,
    studentAccessAvailable: true,
    adminAccessAvailable: true,
    saveCheckSuccess: true,
    reviewCheckSuccess: true,
    definitionSaveCheckSuccess: true,
    dictionaryBuilderCheckSuccess: true,
    dictionaryBuilderDefinitionProvidersAvailable: 3,
    dictionaryBuilderDefinitionProvidersChecked: 5,
    cleanupSuccess: true,
    openReviewCount: 4,
    oldestOpenReviewAgeSeconds: 3600,
    ...overrides,
  })
}

test("Library workflow monitor requires the explicit dev-owned environment", () => {
  assert.doesNotThrow(() => assertDevEnvironment(devEnvironment()))
  assert.throws(() => assertDevEnvironment({ NODE_ENV: "test", SIS_ENV_FILE: ".env.test", DOTENV_CONFIG_PATH: ".env.test" }), /explicit development environment/u)
  assert.throws(() => assertDevEnvironment({ NODE_ENV: "development", SIS_ENV_FILE: ".env", DOTENV_CONFIG_PATH: ".env" }), /explicit development environment/u)
  assert.throws(() => assertDevEnvironment({ NODE_ENV: "development", SIS_ENV_FILE: ".env.dev", DOTENV_CONFIG_PATH: ".env.test" }), /explicit development environment/u)
})

test("Library metrics expose access, save, review, queue-age, and dependency results without identity labels", () => {
  const metrics = monitorMetrics({
    studentAccessAvailable: false,
    saveCheckSuccess: false,
    reviewCheckSuccess: false,
    redisAvailable: false,
    openReviewCount: 2,
    oldestOpenReviewAgeSeconds: 7200,
  })
  assert.match(metrics, /sis_library_student_access_available\{environment="dev"\} 0\.000000/u)
  assert.match(metrics, /sis_library_save_check_success\{environment="dev"\} 0\.000000/u)
  assert.match(metrics, /sis_library_review_check_success\{environment="dev"\} 0\.000000/u)
  assert.match(metrics, /sis_library_definition_save_check_success\{environment="dev"\} 1\.000000/u)
  assert.match(metrics, /sis_library_dictionary_builder_check_success\{environment="dev"\} 1\.000000/u)
  assert.match(metrics, /sis_library_dictionary_builder_definition_providers_available\{environment="dev"\} 3\.000000/u)
  assert.match(metrics, /sis_library_dictionary_builder_definition_providers_checked\{environment="dev"\} 5\.000000/u)
  assert.match(metrics, /sis_library_oldest_open_review_age_seconds\{environment="dev"\} 7200\.000000/u)
  assert.match(metrics, /sis_library_redis_available\{environment="dev"\} 0\.000000/u)
  assert.doesNotMatch(metrics, /environment="(?:test|production)"|cookie|password|@[a-z0-9.-]+/iu)
  assert.equal(metrics.split("\n").filter((line) => line.startsWith("sis_library_") && !line.includes('{environment="dev"}')).length, 0)
  assert.throws(() => monitorMetrics({ openReviewCount: -1 }), /finite non-negative/u)
})

test("Dictionary Builder availability summary contains only aggregate provider counts", () => {
  const availability = summarizeDictionaryBuilderDefinitionAvailability({
    sources: [
      { provider: "private-provider", definition: "sensitive definition", datumStatus: { definition: { status: "available" } } },
      { provider: "other", datumStatus: { definition: { status: "not_found" } } },
      { provider: "not-applicable", datumStatus: { definition: { status: "not_offered" } } },
      { provider: "missing-status", datumStatus: {} },
    ],
  })
  assert.deepEqual(availability, { providersChecked: 2, providersAvailable: 1 })
  assert.doesNotMatch(JSON.stringify(availability), /sensitive definition|private-provider/u)
  assert.deepEqual(summarizeDictionaryBuilderDefinitionAvailability({ sources: [] }), { providersChecked: 0, providersAvailable: 0 })
})

test("synthetic Library monitor rotates only to unused CMUdict words with valid syllabication and primary stress", async () => {
  for (const candidate of SYNTHETIC_VOCABULARY_CANDIDATES) {
    const result = await validateVocabularyEntry(candidate, { overrideLookup: async () => null })
    assert.equal(result.message, "", `${candidate.english} must pass the local pronunciation contract`)
  }
  assert.deepEqual(selectSyntheticVocabularyCandidate(["monitor", "canopy"], { monitor: "", canopy: "", tomato: "" }, 0), {
    english: "tomato",
    syllabication: "to-MA-to",
  })
  assert.equal(selectSyntheticVocabularyCandidate(["monitor"], { monitor: "" }, 0), null)
})

test("Library monitor cleanup verifies exact synthetic contribution and canonical removal", async () => {
  const contribution = { id: "synthetic-contribution" }
  const entry = { id: "synthetic-entry", createdByName: "dev-admin" }
  const state = { contributions: [contribution], entry }
  const prisma = {
    libraryContribution: {
      findMany: async () => state.contributions.map(({ id }) => ({ id })),
      deleteMany: async () => { state.contributions = []; return { count: 1 } },
      count: async () => state.contributions.length,
    },
    libraryContributionRevision: { deleteMany: async () => ({ count: 1 }) },
    libraryEntry: {
      findUnique: async () => state.entry,
      delete: async () => { state.entry = null },
    },
    libraryEntryRevision: { deleteMany: async () => ({ count: 1 }) },
  }
  assert.equal(await cleanupSynthetic(prisma, { studentRefId: "student-ref", sourceId: "library-monitor-id", english: "librarymonitorid", expectedCreatorName: "dev-admin" }), true)
  assert.deepEqual(state, { contributions: [], entry: null })
})

test("Library monitor metrics write atomically and carry forward the previous success timestamp", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sis-library-monitor-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const metricsFile = path.join(directory, "library-workflow.prom")
  writeMetricsAtomically(metricsFile, monitorMetrics())
  assert.equal(readLastSuccessTimestamp(metricsFile), 200)
  writeMetricsAtomically(metricsFile, monitorMetrics({ success: false, lastSuccessTimestamp: readLastSuccessTimestamp(metricsFile), checkedAt: 300 }))
  const saved = fs.readFileSync(metricsFile, "utf8")
  assert.match(saved, /sis_library_workflow_check_success\{environment="dev"\} 0\.000000/u)
  assert.match(saved, /sis_library_workflow_last_success_timestamp_seconds\{environment="dev"\} 200\.000000/u)
  assert.deepEqual(fs.readdirSync(directory), ["library-workflow.prom"])
})
