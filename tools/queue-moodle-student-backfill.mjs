#!/usr/bin/env node
// @ts-check

import dotenv from "dotenv"
import process from "node:process"
import { getSharedPrismaClient, closeSharedPrismaClient } from "../src/infra/db/prisma-client.mjs"
import { isMoodleProvisioningEnabled, queueStudentProvisioning } from "../src/modules/admin/moodle-provisioning.mjs"

function assertDevelopmentEnvironment() {
  if (process.env.SIS_ENV_FILE !== ".env.dev" || process.env.DOTENV_CONFIG_PATH !== ".env.dev" || process.env.NODE_ENV !== "development") {
    throw new Error("Moodle backfill is restricted to the .env.dev development database")
  }
  const loaded = dotenv.config({ path: ".env.dev", override: false })
  if (loaded.error) throw loaded.error
}

async function main() {
  assertDevelopmentEnvironment()
  const apply = process.argv.includes("--apply")
  if (apply && (!isMoodleProvisioningEnabled() || !String(process.env.MOODLE_SIS_INITIAL_PASSWORD || "").trim())) {
    throw new Error("Applying a backfill requires the dedicated Moodle provisioning secret and initial password in .env.dev")
  }
  const prisma = await getSharedPrismaClient()
  try {
    const students = await prisma.student.findMany({
      where: {
        OR: [
          { moodleUserLink: null },
          { moodleUserLink: { is: { status: "blocked" } } },
        ],
      },
      include: { profile: true },
      orderBy: { studentNumber: "asc" },
    })
    if (!apply) {
      process.stdout.write(JSON.stringify({ mode: "dry-run", eligibleCount: students.length, applyFlagRequired: true }) + "\n")
      return
    }

    let queued = 0
    let blocked = 0
    for (const student of students) {
      const result = await prisma.$transaction((tx) => queueStudentProvisioning(tx, {
        student,
        profile: student.profile || {},
        password: String(process.env.MOODLE_SIS_INITIAL_PASSWORD),
        isNew: true,
      }))
      if (result.queued) queued += 1
      else blocked += 1
    }
    process.stdout.write(JSON.stringify({ mode: "applied-to-dev-outbox", eligibleCount: students.length, queued, blocked }) + "\n")
  } finally {
    await closeSharedPrismaClient()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
