import assert from "node:assert/strict"
import crypto from "node:crypto"
import dotenv from "dotenv"
import test from "node:test"

process.env.SIS_ENV_FILE = ".env.test"
process.env.DOTENV_CONFIG_PATH = ".env.test"
process.env.NODE_ENV = "test"
dotenv.config({ path: ".env.test", override: true })

test("database stale recovery reclaims only idempotent PDFs and terminally fails uncertain or exhausted jobs", async (t) => {
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { claimAsyncSideEffectJobs } = await import("../src/modules/async/side-effect-jobs.mjs")
  const previousTimeout = process.env.ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS
  process.env.ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS = "60000"

  let prisma = null
  const jobIds = {
    pdf: `ka121-stale-pdf-${crypto.randomUUID()}`,
    email: `ka121-stale-email-${crypto.randomUUID()}`,
    exhaustedPdf: `ka121-stale-exhausted-${crypto.randomUUID()}`,
    unknown: `ka121-stale-unknown-${crypto.randomUUID()}`,
  }
  const workerId = `ka121-recovery-${crypto.randomUUID()}`
  const jobTypes = [
    "report-card-pdf",
    "announcement-email",
    "ka121-unknown-recovery",
  ]
  let created = false
  t.after(async () => {
    let cleanupError = null
    if (prisma) {
      try {
        if (created) await prisma.asyncSideEffectJob.deleteMany({ where: { id: { in: Object.values(jobIds) } } })
        const remaining = await prisma.asyncSideEffectJob.count({ where: { id: { in: Object.values(jobIds) } } })
        assert.equal(remaining, 0)
      } catch (error) {
        cleanupError = error
      }
      try {
        await prisma.$disconnect()
      } catch (error) {
        cleanupError ||= error
      }
    }
    if (previousTimeout === undefined) delete process.env.ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS
    else process.env.ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS = previousTimeout
    if (cleanupError) throw new AggregateError([cleanupError], "Stale job recovery cleanup failed")
  })

  prisma = await getSharedPrismaClient()
  const rows = await prisma.$queryRaw`SELECT current_database() AS name`
  assert.equal(rows[0]?.name, "sis-test")

  const now = new Date()
  const staleLock = new Date(now.valueOf() - 120_000)
  const makeStaleJob = (id, jobType, attempts = 1) => ({
    id,
    jobType,
    status: "processing",
    dedupeKey: id,
    payloadJson: { probe: "synthetic" },
    resultJson: {},
    attempts,
    availableAt: staleLock,
    lockedAt: staleLock,
    lockedBy: "ka121-interrupted-worker",
  })
  await prisma.asyncSideEffectJob.createMany({
    data: [
      makeStaleJob(jobIds.pdf, "report-card-pdf"),
      makeStaleJob(jobIds.email, "announcement-email"),
      makeStaleJob(jobIds.exhaustedPdf, "report-card-pdf", 3),
      makeStaleJob(jobIds.unknown, "ka121-unknown-recovery"),
    ],
  })
  created = true

  const claimed = await claimAsyncSideEffectJobs({ jobTypes, take: 10, workerId, maxAttempts: 3 })
  assert.equal(claimed.length, 1)
  assert.equal(claimed[0]?.id, jobIds.pdf)
  assert.equal(claimed[0]?.status, "processing")
  assert.equal(claimed[0]?.attempts, 2)
  assert.equal(claimed[0]?.lockedBy, workerId)
  assert.ok(new Date(claimed[0]?.lockedAt || 0).valueOf() >= now.valueOf() - 5_000)

  const persisted = await prisma.asyncSideEffectJob.findMany({ where: { id: { in: Object.values(jobIds) } } })
  const byId = new Map(persisted.map((job) => [job.id, job]))
  assert.equal(byId.get(jobIds.pdf)?.status, "processing")
  assert.equal(byId.get(jobIds.pdf)?.attempts, 2)
  assert.equal(byId.get(jobIds.pdf)?.lockedBy, workerId)
  for (const id of [jobIds.email, jobIds.exhaustedPdf, jobIds.unknown]) {
    assert.equal(byId.get(id)?.status, "failed", `${id} must not be reclaimed`)
    assert.equal(byId.get(id)?.lastError, "operation_timeout")
    assert.ok(byId.get(id)?.completedAt)
  }
})
