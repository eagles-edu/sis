import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  assertMonitorEnvironment,
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

test("Library workflow monitor accepts only exact owned dev and test tuples", () => {
  assert.equal(assertMonitorEnvironment(devEnvironment()).label, "dev")
  assert.equal(assertMonitorEnvironment({ NODE_ENV: "test", SIS_ENV_FILE: ".env.test", DOTENV_CONFIG_PATH: ".env.test" }).label, "test")
  assert.throws(() => assertMonitorEnvironment({ NODE_ENV: "development", SIS_ENV_FILE: ".env", DOTENV_CONFIG_PATH: ".env" }), /matching explicit dev or test/u)
  assert.throws(() => assertMonitorEnvironment({ NODE_ENV: "development", SIS_ENV_FILE: ".env.dev", DOTENV_CONFIG_PATH: ".env.test" }), /matching explicit dev or test/u)
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
  assert.equal(metrics.split("\n").filter((line) => line.startsWith("sis_library_") && !line.includes('environment="dev"')).length, 0)
  assert.throws(() => monitorMetrics({ openReviewCount: -1 }), /finite non-negative/u)
})

test("test Library and Dictionary Builder metrics retain test-only labels", () => {
  const metrics = monitorMetrics({ environment: "test" })
  assert.match(metrics, /sis_library_workflow_check_success\{environment="test"\} 1\.000000/u)
  assert.match(metrics, /sis_library_dictionary_builder_check_success\{environment="test"\} 1\.000000/u)
  assert.doesNotMatch(metrics, /environment="dev"/u)
})

test("Dictionary Builder availability summary contains bounded source states and aggregate provider counts", () => {
  const availability = summarizeDictionaryBuilderDefinitionAvailability({
    sources: [
      { provider: "ldoce", definition: "sensitive definition", datumStatus: { definition: { status: "available" } } },
      { provider: "oxford_ame", datumStatus: { definition: { status: "not_found" } } },
      { provider: "britannica", datumStatus: { definition: { status: "not_offered" } } },
      { provider: "private-provider", datumStatus: { definition: { status: "available" } } },
    ],
  })
  assert.equal(availability.providersChecked, 2)
  assert.equal(availability.providersAvailable, 1)
  assert.equal(availability.providerAvailability.length, 12)
  assert.deepEqual(availability.providerAvailability.find((item) => item.provider === "ldoce"), { provider: "ldoce", checked: 1, available: 1 })
  assert.deepEqual(availability.providerAvailability.find((item) => item.provider === "oxford_ame"), { provider: "oxford_ame", checked: 1, available: 0 })
  assert.deepEqual(availability.providerAvailability.find((item) => item.provider === "google_translate"), { provider: "google_translate", checked: 0, available: 0 })
  assert.doesNotMatch(JSON.stringify(availability), /sensitive definition|private-provider/u)
  assert.equal(summarizeDictionaryBuilderDefinitionAvailability({ sources: [] }).providerAvailability.length, 12)
})

test("Dictionary Builder exports exactly twelve allowlisted checked states without marking unchecked sources unavailable", () => {
  const metrics = monitorMetrics()
  const checkedLines = metrics.split("\n").filter((line) => line.startsWith("sis_library_dictionary_builder_provider_checked{"))
  const availableLines = metrics.split("\n").filter((line) => line.startsWith("sis_library_dictionary_builder_provider_available{"))
  assert.equal(checkedLines.length, 12)
  assert.equal(availableLines.length, 0)
  assert.ok(checkedLines.some((line) => line.includes('provider="google_translate"') && line.endsWith(" 0.000000")))
  assert.doesNotMatch(metrics, /provider="private-provider"/u)
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
