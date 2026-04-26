import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

test("async side effect jobs dedupe, revive, and claim in memory mode", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = ""
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

  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = previousDatabaseUrl
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
