import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

const jobsSource = await fs.readFile(new URL("../src/modules/async/side-effect-jobs.mjs", import.meta.url), "utf8")

test("configured mirror runtimes never fall back to volatile side-effect jobs", () => {
  assert.match(jobsSource, /normalizeLower\(process\.env\.NODE_ENV\) === "test" && \["memory", "in-memory"\]\.includes\(backend\)/)
  assert.match(jobsSource, /useVolatileTestStorage\(\) \|\| !hasConfiguredDatabaseUrl\(\)/)
  assert.match(jobsSource, /isRetrySafeAsyncSideEffectJob\(job\.jobType\)/)
  assert.match(jobsSource, /isRetrySafeAsyncSideEffectJob\(staleJob\.jobType\)/)
  assert.match(jobsSource, /lastError: "operation_timeout"/)
})

test("async side effect jobs dedupe, revive, and claim in explicit test memory mode", async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousBackend = process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND
  process.env.NODE_ENV = "test"
  process.env.DATABASE_URL = "postgresql://127.0.0.1:5432/sis-test"
  process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND = "memory"

  try {
    const mod = await import(`../src/modules/async/side-effect-jobs.mjs?memory=${Date.now()}`)
    const first = await mod.enqueueAsyncSideEffectJob(
      mod.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
      {
        queueId: "queue-01",
        announcementPayload: {
          recipients: ["parent@example.com"],
          assignmentTitle: "Week 1",
        },
      },
      { dedupeKey: "queue-01" }
    )
    assert.equal(first.status, mod.ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED)

    const claimed = await mod.claimAsyncSideEffectJobs({
      jobTypes: [mod.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL],
      take: 5,
      workerId: "test-worker",
    })
    assert.equal(claimed.length, 1)
    assert.equal(claimed[0].id, first.id)
    assert.equal(claimed[0].status, mod.ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING)

    const completed = await mod.completeAsyncSideEffectJob(first.id, { ok: true })
    assert.equal(completed.status, mod.ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED)

    const revived = await mod.enqueueAsyncSideEffectJob(
      mod.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
      {
        queueId: "queue-01",
        announcementPayload: {
          recipients: ["parent@example.com"],
          assignmentTitle: "Week 1",
        },
      },
      { dedupeKey: "queue-01" }
    )
    assert.equal(revived.id, first.id)
    assert.equal(revived.status, mod.ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED)
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    if (previousBackend === undefined) delete process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND
    else process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND = previousBackend
  }

})

test("announcement delivery failure listing exposes investigation fields without message or recipients", async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousBackend = process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND
  process.env.NODE_ENV = "test"
  process.env.DATABASE_URL = "postgresql://127.0.0.1:5432/sis-test"
  process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND = "memory"

  try {
    const mod = await import(`../src/modules/async/side-effect-jobs.mjs?delivery-failures=${Date.now()}`)
    const job = await mod.enqueueAsyncSideEffectJob(
      mod.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
      { announcementPayload: { recipients: ["private@example.invalid"], message: "private body" } },
    )
    await mod.claimAsyncSideEffectJobs({
      jobTypes: [mod.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL],
      take: 1,
      workerId: "ka072-investigation-test",
    })
    await mod.failAsyncSideEffectJob(job.id, Object.assign(new Error("private provider token response"), { statusCode: 503 }), { maxAttempts: 1 })

    const failures = await mod.listAnnouncementDeliveryFailures({ take: 10 })
    assert.equal(failures.length, 1)
    assert.equal(failures[0].id, job.id)
    assert.equal(failures[0].status, mod.ASYNC_SIDE_EFFECT_JOB_STATUS_FAILED)
    assert.equal(failures[0].attempts, 1)
    assert.equal(failures[0].lastError, "provider_unavailable")
    assert.equal(Object.hasOwn(failures[0], "payloadJson"), false)
    assert.equal(JSON.stringify(failures).includes("private@example.invalid"), false)
    assert.equal(JSON.stringify(failures).includes("private body"), false)
    assert.equal(JSON.stringify(failures).includes("private provider token response"), false)
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    if (previousBackend === undefined) delete process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND
    else process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND = previousBackend
  }
})

test("announcement email provider failures are terminal because delivery is not durably idempotent", async () => {
  const envKeys = [
    "NODE_ENV",
    "DATABASE_URL",
    "ASYNC_SIDE_EFFECT_JOB_BACKEND",
    "ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS",
    "EMAIL_PROVIDER",
    "BREVO_API_KEY",
    "BREVO_FROM_EMAIL",
    "BREVO_API_URL",
  ]
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]))
  const previousFetch = globalThis.fetch
  process.env.NODE_ENV = "test"
  process.env.DATABASE_URL = "postgresql://127.0.0.1:5432/sis-test"
  process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND = "memory"
  process.env.ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS = "60000"
  process.env.EMAIL_PROVIDER = "brevo"
  process.env.BREVO_API_KEY = "synthetic-test-key"
  process.env.BREVO_FROM_EMAIL = "sis-test@example.invalid"
  process.env.BREVO_API_URL = "https://brevo.invalid/v3/smtp/email"

  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ message: "temporary provider outage" }), { status: 503 })
  }

  try {
    const jobs = await import("../src/modules/async/side-effect-jobs.mjs")
    const worker = await import(`../src/modules/async/side-effect-worker.mjs?recovery=${Date.now()}`)
    const queueId = `ka121-${crypto.randomUUID()}`
    const recipient = `ka121-${crypto.randomUUID()}@example.invalid`
    const payload = {
      queueId,
      recipients: [recipient],
      assignmentTitle: "Synthetic retry check",
    }
    const first = await jobs.enqueueAsyncSideEffectJob(
      jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
      { announcementPayload: payload },
      { dedupeKey: queueId }
    )
    const queuedDuplicates = await Promise.all([
      jobs.enqueueAsyncSideEffectJob(
        jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
        { announcementPayload: { ...payload, assignmentTitle: "Changed duplicate" } },
        { dedupeKey: queueId }
      ),
      jobs.enqueueAsyncSideEffectJob(
        jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
        { announcementPayload: payload },
        { dedupeKey: queueId }
      ),
    ])
    assert.deepEqual(queuedDuplicates.map((job) => job.id), [first.id, first.id])
    assert.equal(queuedDuplicates[0].payloadJson.announcementPayload.assignmentTitle, "Synthetic retry check")

    const failures = []
    const failedDrain = await worker.drainAsyncSideEffectJobs({
      jobTypes: [jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL],
      take: 1,
      workerId: `ka121-worker-${crypto.randomUUID()}`,
      maxAttempts: 3,
      retryDelayMs: 10,
      onJobFailed: (_job, _error, updated) => failures.push(updated),
    })
    assert.deepEqual(failedDrain, { claimed: 1, succeeded: 0, failed: 1, callbackFailed: 0, remaining: 0, processing: 0 })
    assert.equal(failures[0]?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_FAILED)
    assert.equal(failures[0]?.attempts, 1)
    assert.equal(failures[0]?.lastError, "provider_unavailable")

    const secondDrain = await worker.drainAsyncSideEffectJobs({
      jobTypes: [jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL],
      take: 1,
      workerId: `ka121-no-retry-${crypto.randomUUID()}`,
    })
    assert.deepEqual(secondDrain, { claimed: 0, succeeded: 0, failed: 0, callbackFailed: 0, remaining: 0, processing: 0 })
    assert.equal(requests.length, 1)
    assert.equal(JSON.parse(requests[0].options.body).headers["Idempotency-Key"], `sis-email-${queueId}`)
    assert.equal(JSON.parse(requests[0].options.body).bcc[0].email, recipient)
  } finally {
    globalThis.fetch = previousFetch
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("parent report email provider outage is not retried automatically", async () => {
  const envKeys = [
    "NODE_ENV",
    "DATABASE_URL",
    "ASYNC_SIDE_EFFECT_JOB_BACKEND",
    "ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS",
    "EMAIL_PROVIDER",
    "BREVO_API_KEY",
    "BREVO_FROM_EMAIL",
    "BREVO_API_URL",
  ]
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]))
  const previousFetch = globalThis.fetch
  process.env.NODE_ENV = "test"
  process.env.DATABASE_URL = "postgresql://127.0.0.1:5432/sis-test"
  process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND = "memory"
  process.env.ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS = "60000"
  process.env.EMAIL_PROVIDER = "brevo"
  process.env.BREVO_API_KEY = "synthetic-test-key"
  process.env.BREVO_FROM_EMAIL = "sis-test@example.invalid"
  process.env.BREVO_API_URL = "https://brevo.invalid/v3/smtp/email"

  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ message: "temporary provider outage" }), { status: 503 })
  }

  try {
    const jobs = await import("../src/modules/async/side-effect-jobs.mjs")
    const worker = await import(`../src/modules/async/side-effect-worker.mjs?parent-report-failure=${Date.now()}`)
    const queueId = `ka121-parent-report-${crypto.randomUUID()}`
    const recipient = `ka121-parent-${crypto.randomUUID()}@example.invalid`
    const payload = {
      queueId,
      queueType: "parent-report",
      recipients: [recipient],
      assignmentTitle: "Synthetic published report",
      requestOrigin: "http://127.0.0.1:8788",
    }
    const queued = await jobs.enqueueAsyncSideEffectJob(
      jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
      { queueType: "parent-report", announcementPayload: payload },
      { dedupeKey: queueId },
    )
    const failures = []
    const failedDrain = await worker.drainAsyncSideEffectJobs({
      jobTypes: [jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL],
      take: 1,
      workerId: `ka121-parent-report-fail-${crypto.randomUUID()}`,
      maxAttempts: 3,
      retryDelayMs: 1,
      onJobFailed: (_job, error, updated) => failures.push({ message: error.message, updated }),
    })
    assert.deepEqual(failedDrain, { claimed: 1, succeeded: 0, failed: 1, callbackFailed: 0, remaining: 0, processing: 0 })
    assert.equal(failures[0]?.updated?.id, queued.id)
    assert.equal(failures[0]?.updated?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_FAILED)
    assert.equal(failures[0]?.updated?.attempts, 1)
    assert.match(failures[0]?.message || "", /Brevo email request failed \(503\)/u)

    const retryDrain = await worker.drainAsyncSideEffectJobs({
      jobTypes: [jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL],
      take: 1,
      workerId: `ka121-parent-report-no-retry-${crypto.randomUUID()}`,
    })
    assert.deepEqual(retryDrain, { claimed: 0, succeeded: 0, failed: 0, callbackFailed: 0, remaining: 0, processing: 0 })
    assert.equal(requests.length, 1)
    assert.ok(requests.every(({ url }) => url === "https://brevo.invalid/v3/smtp/email"))
    assert.equal(JSON.parse(requests[0].options.body).to[0].email, recipient)
    assert.ok(JSON.stringify(requests[0].options).includes("@example.invalid"))
  } finally {
    globalThis.fetch = previousFetch
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("stale recovery reclaims only idempotent PDFs and terminally fails uncertain side effects", async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousBackend = process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND
  const previousTimeout = process.env.ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS
  process.env.NODE_ENV = "test"
  process.env.DATABASE_URL = "postgresql://127.0.0.1:5432/sis-test"
  process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND = "memory"
  process.env.ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS = "60000"

  try {
    const jobs = await import("../src/modules/async/side-effect-jobs.mjs")
    const now = new Date("2026-11-18T00:00:00.000Z")
    const jobTypes = [
      jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF,
      jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
      "ka121-unknown-side-effect",
    ]
    const jobsToRecover = await Promise.all(jobTypes.map((jobType) => jobs.enqueueAsyncSideEffectJob(
      jobType,
      { probe: "synthetic", queueId: `ka121-${crypto.randomUUID()}` },
      { dedupeKey: `ka121-stale-${crypto.randomUUID()}`, availableAt: now }
    )))
    const firstClaim = await jobs.claimAsyncSideEffectJobs({
      jobTypes,
      take: 10,
      workerId: "ka121-worker-before-timeout",
      now,
    })
    assert.equal(firstClaim.length, 3)
    assert.deepEqual(firstClaim.map((job) => job.attempts), [1, 1, 1])

    const earlyClaim = await jobs.claimAsyncSideEffectJobs({
      jobTypes,
      take: 10,
      workerId: "ka121-worker-too-early",
      now: new Date(now.valueOf() + 59_999),
    })
    assert.deepEqual(earlyClaim, [])

    const recoveredClaim = await jobs.claimAsyncSideEffectJobs({
      jobTypes,
      take: 10,
      workerId: "ka121-worker-recovered",
      now: new Date(now.valueOf() + 60_000),
    })
    assert.equal(recoveredClaim.length, 1)
    assert.equal(recoveredClaim[0]?.id, jobsToRecover[0].id)
    assert.equal(recoveredClaim[0]?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING)
    assert.equal(recoveredClaim[0]?.attempts, 2)
    assert.equal(recoveredClaim[0]?.lockedBy, "ka121-worker-recovered")
    const emailFailures = await jobs.listAnnouncementDeliveryFailures({ take: 10 })
    assert.ok(emailFailures.some((job) => job.id === jobsToRecover[1].id && job.lastError === "operation_timeout"))
    const completed = await jobs.completeAsyncSideEffectJob(jobsToRecover[0].id, { recovered: true })
    assert.equal(completed?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED)
    const completedFailure = await jobs.failAsyncSideEffectJob(jobsToRecover[0].id, new Error("late callback error"), { maxAttempts: 3, retryDelayMs: 1 })
    assert.equal(completedFailure?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED)
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    if (previousBackend === undefined) delete process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND
    else process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND = previousBackend
    if (previousTimeout === undefined) delete process.env.ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS
    else process.env.ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS = previousTimeout
  }
})

test("PDF retries stop at the configured maximum and callback errors do not requeue completed work", async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousBackend = process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND
  process.env.NODE_ENV = "test"
  process.env.DATABASE_URL = "postgresql://127.0.0.1:5432/sis-test"
  process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND = "memory"

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sis-pdf-retry-"))
  const blocker = path.join(tempDir, "file-parent")
  await fs.writeFile(blocker, "not a directory")

  try {
    const jobs = await import("../src/modules/async/side-effect-jobs.mjs")
    const worker = await import(`../src/modules/async/side-effect-worker.mjs?pdf-retry=${Date.now()}`)
    const job = await jobs.enqueueAsyncSideEffectJob(
      jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF,
      {
        student: {
          eaglesId: "EA-121",
          studentNumber: 121,
          profile: { fullName: "Synthetic Retry Test" },
          attendanceRecords: [],
          gradeRecords: [],
          parentReports: [],
        },
        filters: { schoolYear: "2025-2026", quarter: "q1" },
        outputPath: path.join(blocker, "report-card.pdf"),
      },
      { dedupeKey: `ka121-pdf-${crypto.randomUUID()}` },
    )

    const firstFailures = []
    const first = await worker.drainAsyncSideEffectJobs({
      jobTypes: [jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF],
      take: 1,
      maxAttempts: 2,
      retryDelayMs: 1,
      onJobFailed: (_job, _error, updated) => firstFailures.push(updated),
    })
    assert.equal(first.failed, 1)
    assert.equal(first.callbackFailed, 0)
    assert.equal(firstFailures[0]?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED)

    await new Promise((resolve) => setTimeout(resolve, 5))
    const secondFailures = []
    const second = await worker.drainAsyncSideEffectJobs({
      jobTypes: [jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF],
      take: 1,
      maxAttempts: 2,
      retryDelayMs: 1,
      onJobFailed: (_job, _error, updated) => secondFailures.push(updated),
    })
    assert.equal(second.failed, 1)
    assert.equal(secondFailures[0]?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_FAILED)
    const failures = await jobs.listAnnouncementDeliveryFailures({ take: 10 })
    assert.equal(failures.some((failure) => failure.id === job.id), false)
    const third = await worker.drainAsyncSideEffectJobs({ jobTypes: [jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF], take: 1, maxAttempts: 2, retryDelayMs: 1 })
    assert.equal(third.claimed, 0)

    const successful = await jobs.enqueueAsyncSideEffectJob(
      jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF,
      {
        student: {
          eaglesId: "EA-121",
          studentNumber: 121,
          profile: { fullName: "Synthetic Retry Test" },
          attendanceRecords: [],
          gradeRecords: [],
          parentReports: [],
        },
        filters: { schoolYear: "2025-2026", quarter: "q1" },
      },
      { dedupeKey: `ka121-pdf-callback-${crypto.randomUUID()}` },
    )
    const callbackResult = await worker.drainAsyncSideEffectJobs({
      jobTypes: [jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF],
      take: 1,
      onJobComplete: async () => { throw new Error("callback failed") },
    })
    assert.equal(callbackResult.succeeded, 1)
    assert.equal(callbackResult.callbackFailed, 1)
    const persisted = await jobs.completeAsyncSideEffectJob(successful.id, {})
    assert.equal(persisted?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    if (previousBackend === undefined) delete process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND
    else process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND = previousBackend
  }
})

test("report-card pdf worker writes the generated PDF to disk", async () => {
  const mod = await import(`../src/modules/async/side-effect-worker.mjs?pdf=${Date.now()}`)
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sis-pdf-job-"))
  const outputPath = path.join(tempDir, "report-card.pdf")

  const result = await mod.processReportCardPdfSideEffectJob({
    payloadJson: {
      student: {
        eaglesId: "EA-100",
        studentNumber: 100,
        profile: {
          fullName: "Test Student",
        },
        attendanceRecords: [],
        gradeRecords: [],
        parentReports: [],
      },
      filters: {
        schoolYear: "2025-2026",
        quarter: "q1",
      },
      outputPath,
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.outputPath, outputPath)

  const stat = await fs.stat(outputPath)
  assert.ok(stat.size > 0)

  await fs.rm(tempDir, { recursive: true, force: true })
})
