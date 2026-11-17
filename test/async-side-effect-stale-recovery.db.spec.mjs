import assert from "node:assert/strict"
import crypto from "node:crypto"
import dotenv from "dotenv"
import test from "node:test"

process.env.SIS_ENV_FILE = ".env.test"
process.env.DOTENV_CONFIG_PATH = ".env.test"
process.env.NODE_ENV = "test"
dotenv.config({ path: ".env.test", override: true })

test("database worker reclaims a stale processing job and records the new claim", async (t) => {
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { claimAsyncSideEffectJobs } = await import("../src/modules/async/side-effect-jobs.mjs")
  const previousTimeout = process.env.ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS
  process.env.ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS = "60000"

  let prisma = null
  const jobId = `ka071-stale-${crypto.randomUUID()}`
  const jobType = `ka071-stale-recovery-${crypto.randomUUID()}`
  const workerId = `ka071-recovery-${crypto.randomUUID()}`
  let created = false
  t.after(async () => {
    let cleanupError = null
    if (prisma) {
      try {
        if (created) await prisma.asyncSideEffectJob.deleteMany({ where: { id: jobId } })
        const remaining = await prisma.asyncSideEffectJob.count({ where: { id: jobId } })
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
  await prisma.asyncSideEffectJob.create({
    data: {
      id: jobId,
      jobType,
      status: "processing",
      dedupeKey: jobId,
      payloadJson: { probe: "synthetic" },
      resultJson: {},
      attempts: 1,
      availableAt: staleLock,
      lockedAt: staleLock,
      lockedBy: "ka071-interrupted-worker",
    },
  })
  created = true

  const claimed = await claimAsyncSideEffectJobs({ jobTypes: [jobType], take: 1, workerId })
  assert.equal(claimed.length, 1)
  assert.equal(claimed[0]?.id, jobId)
  assert.equal(claimed[0]?.status, "processing")
  assert.equal(claimed[0]?.attempts, 2)
  assert.equal(claimed[0]?.lockedBy, workerId)
  assert.ok(new Date(claimed[0]?.lockedAt || 0).valueOf() >= now.valueOf() - 5_000)

  const persisted = await prisma.asyncSideEffectJob.findUnique({ where: { id: jobId } })
  assert.equal(persisted?.status, "processing")
  assert.equal(persisted?.attempts, 2)
  assert.equal(persisted?.lockedBy, workerId)
})
