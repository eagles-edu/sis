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
  assert.match(jobsSource, /status: ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING,[\s\S]*?lockedAt: \{ lte: staleBefore \}/)
  assert.match(jobsSource, /status: ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED,[\s\S]*?lockedAt: null,[\s\S]*?lockedBy: null/)
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

test("announcement dispatch retries provider outages and preserves provider idempotency", async () => {
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
  let acceptedRequests = 0
  let releaseOutage
  let markOutageStarted
  const outageStarted = new Promise((resolve) => {
    markOutageStarted = resolve
  })
  const outageGate = new Promise((resolve) => {
    releaseOutage = resolve
  })
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    if (requests.length === 1) {
      markOutageStarted()
      await outageGate
      return new Response(JSON.stringify({ message: "temporary provider outage" }), { status: 503 })
    }
    if (requests.length === 2) {
      acceptedRequests += 1
      return new Response("{}", { status: 201 })
    }
    return new Response(JSON.stringify({ code: "duplicate_parameter" }), { status: 400 })
  }

  try {
    const jobs = await import("../src/modules/async/side-effect-jobs.mjs")
    const worker = await import(`../src/modules/async/side-effect-worker.mjs?recovery=${Date.now()}`)
    const queueId = `ka071-${crypto.randomUUID()}`
    const recipient = `ka071-${crypto.randomUUID()}@example.invalid`
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

    let outageRecord = null
    const firstDrain = worker.drainAsyncSideEffectJobs({
      jobTypes: [jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL],
      take: 1,
      workerId: `ka071-worker-${crypto.randomUUID()}`,
      maxAttempts: 3,
      retryDelayMs: 10,
      onJobFailed: (_job, _error, updated) => {
        outageRecord = updated
      },
    })
    await outageStarted
    const processingDuplicate = await jobs.enqueueAsyncSideEffectJob(
      jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
      { announcementPayload: payload },
      { dedupeKey: queueId }
    )
    assert.equal(processingDuplicate.id, first.id)
    assert.equal(processingDuplicate.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING)
    releaseOutage()

    const firstDrainResult = await firstDrain
    assert.deepEqual(firstDrainResult, { claimed: 1, succeeded: 0, failed: 1, remaining: 0, processing: 0 })
    assert.equal(outageRecord?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED)
    assert.equal(outageRecord?.attempts, 1)
    assert.equal(outageRecord?.lastError, "provider_unavailable")

    await new Promise((resolve) => setTimeout(resolve, 20))
    const completions = []
    const retryFailures = []
    const retryResult = await worker.drainAsyncSideEffectJobs({
      jobTypes: [jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL],
      take: 1,
      workerId: `ka071-retry-${crypto.randomUUID()}`,
      maxAttempts: 3,
      retryDelayMs: 10,
      onJobComplete: (_job, result, completed) => completions.push({ result, completed }),
      onJobFailed: (_job, error, updated) => retryFailures.push({ message: error.message, updated }),
    })
    assert.deepEqual(
      retryResult,
      { claimed: 1, succeeded: 1, failed: 0, remaining: 0, processing: 0 },
      retryFailures.map((failure) => `${failure.message}; status=${failure.updated?.status}`).join("\n"),
    )
    assert.equal(completions[0]?.completed?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED)
    assert.equal(completions[0]?.completed?.attempts, 2)
    assert.equal(completions[0]?.result?.sent, 1)

    const revived = await jobs.enqueueAsyncSideEffectJob(
      jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
      { announcementPayload: payload },
      { dedupeKey: queueId }
    )
    assert.equal(revived.id, first.id)
    assert.equal(revived.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED)
    assert.equal(revived.attempts, 0)
    const duplicateProviderResult = await worker.drainAsyncSideEffectJobs({
      jobTypes: [jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL],
      take: 1,
      workerId: `ka071-provider-dedupe-${crypto.randomUUID()}`,
      onJobComplete: (_job, result, completed) => completions.push({ result, completed }),
    })
    assert.equal(duplicateProviderResult.succeeded, 1)
    assert.equal(completions[1]?.completed?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED)
    assert.equal(completions[1]?.result?.sent, 1)
    assert.equal(requests.length, 3)
    assert.equal(acceptedRequests, 1)
    const idempotencyKeys = requests.map(({ options }) => JSON.parse(options.body).headers["Idempotency-Key"])
    assert.deepEqual(idempotencyKeys, [`sis-email-${queueId}`, `sis-email-${queueId}`, `sis-email-${queueId}`])
    assert.ok(requests.every(({ options }) => JSON.parse(options.body).bcc[0].email.endsWith("@example.invalid")))
  } finally {
    releaseOutage?.()
    globalThis.fetch = previousFetch
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("parent report email provider outage remains retryable and does not expose a recipient", async () => {
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
    if (requests.length === 1) {
      return new Response(JSON.stringify({ message: "temporary provider outage" }), { status: 503 })
    }
    return new Response("{}", { status: 201 })
  }

  try {
    const jobs = await import("../src/modules/async/side-effect-jobs.mjs")
    const worker = await import(`../src/modules/async/side-effect-worker.mjs?parent-report-failure=${Date.now()}`)
    const queueId = `ka097-parent-report-${crypto.randomUUID()}`
    const recipient = `ka097-parent-${crypto.randomUUID()}@example.invalid`
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
      workerId: `ka097-parent-report-fail-${crypto.randomUUID()}`,
      maxAttempts: 3,
      retryDelayMs: 1,
      onJobFailed: (_job, error, updated) => failures.push({ message: error.message, updated }),
    })
    assert.deepEqual(failedDrain, { claimed: 1, succeeded: 0, failed: 1, remaining: 0, processing: 0 })
    assert.equal(failures[0]?.updated?.id, queued.id)
    assert.equal(failures[0]?.updated?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED)
    assert.equal(failures[0]?.updated?.attempts, 1)
    assert.match(failures[0]?.message || "", /Brevo email request failed \(503\)/u)

    await new Promise((resolve) => setTimeout(resolve, 5))
    const completions = []
    const retryDrain = await worker.drainAsyncSideEffectJobs({
      jobTypes: [jobs.ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL],
      take: 1,
      workerId: `ka097-parent-report-retry-${crypto.randomUUID()}`,
      maxAttempts: 3,
      retryDelayMs: 1,
      onJobComplete: (_job, result, completed) => completions.push({ result, completed }),
    })
    assert.deepEqual(retryDrain, { claimed: 1, succeeded: 1, failed: 0, remaining: 0, processing: 0 })
    assert.equal(completions[0]?.completed?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED)
    assert.equal(completions[0]?.completed?.attempts, 2)
    assert.equal(completions[0]?.result?.sent, 1)
    assert.equal(requests.length, 2)
    assert.ok(requests.every(({ url }) => url === "https://brevo.invalid/v3/smtp/email"))
    assert.equal(JSON.parse(requests[1].options.body).to[0].email, recipient)
    assert.equal(
      JSON.parse(requests[0].options.body).headers["Idempotency-Key"],
      JSON.parse(requests[1].options.body).headers["Idempotency-Key"],
    )
    assert.ok(requests.every(({ options }) => JSON.stringify(options).includes("@example.invalid")))
  } finally {
    globalThis.fetch = previousFetch
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("test memory backend reclaims stale processing jobs only after the lock timeout", async () => {
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
    const job = await jobs.enqueueAsyncSideEffectJob(
      "ka071-stale-recovery",
      { probe: "synthetic" },
      { dedupeKey: `ka071-stale-${crypto.randomUUID()}`, availableAt: now }
    )
    const firstClaim = await jobs.claimAsyncSideEffectJobs({
      jobTypes: ["ka071-stale-recovery"],
      take: 1,
      workerId: "ka071-worker-before-timeout",
      now,
    })
    assert.equal(firstClaim[0]?.id, job.id)
    assert.equal(firstClaim[0]?.attempts, 1)

    const earlyClaim = await jobs.claimAsyncSideEffectJobs({
      jobTypes: ["ka071-stale-recovery"],
      take: 1,
      workerId: "ka071-worker-too-early",
      now: new Date(now.valueOf() + 59_999),
    })
    assert.deepEqual(earlyClaim, [])

    const recoveredClaim = await jobs.claimAsyncSideEffectJobs({
      jobTypes: ["ka071-stale-recovery"],
      take: 1,
      workerId: "ka071-worker-recovered",
      now: new Date(now.valueOf() + 60_000),
    })
    assert.equal(recoveredClaim[0]?.id, job.id)
    assert.equal(recoveredClaim[0]?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING)
    assert.equal(recoveredClaim[0]?.attempts, 2)
    assert.equal(recoveredClaim[0]?.lockedBy, "ka071-worker-recovered")
    const completed = await jobs.completeAsyncSideEffectJob(job.id, { recovered: true })
    assert.equal(completed?.status, jobs.ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED)
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
