import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

const jobsSource = await fs.readFile(new URL("../src/modules/async/side-effect-jobs.mjs", import.meta.url), "utf8")

test("configured mirror runtimes never fall back to volatile side-effect jobs", () => {
  assert.match(jobsSource, /normalizeLower\(process\.env\.NODE_ENV\) === "test" && \["memory", "in-memory"\]\.includes\(backend\)/)
  assert.match(jobsSource, /useVolatileTestStorage\(\) \|\| !String\(process\.env\.DATABASE_URL \|\| ""\)\.trim\(\)/)
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
