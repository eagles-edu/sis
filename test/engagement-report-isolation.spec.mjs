import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import dotenv from "dotenv"
import test from "node:test"

dotenv.config({ path: ".env.dev", override: true })
process.env.NODE_ENV = "development"
process.env.SIS_ENV_FILE = ".env.dev"
process.env.DOTENV_CONFIG_PATH = ".env.dev"

import "../tools/assert-prisma-environment.mjs"

function syntheticStudentNumber(stamp, offset = 0) {
  const value = Number.parseInt(stamp.replaceAll("-", "").slice(offset, offset + 8), 16)
  return 700000 + ((value + offset * 31) % 200000)
}

function mockTransporter() {
  return {
    verify(callback) {
      setImmediate(() => callback(null, true))
    },
    async sendMail() {
      return { messageId: "synthetic-engagement-message" }
    },
  }
}

test("report engagement enforces account scope and records one acknowledgement with privacy-safe IP", async () => {
  const { getSharedPrismaClient, closeSharedPrismaClient } = await import(
    "../src/infra/db/prisma-client.mjs"
  )
  const { hashScryptPassword } = await import("../src/modules/admin/users.mjs")
  const { startExerciseMailer } = await import("../server/exercise-mailer.mjs")
  const { closeStudentAdminRuntimeResources } = await import("../server/student-admin-routes.mjs")
  const prisma = await getSharedPrismaClient()
  const stamp = randomUUID()
  const password = "Synthetic-Engagement-42!"
  const parentId = `KA-P-${stamp}`
  const unrelatedParentId = `KA-UP-${stamp}`
  const studentEaglesId = `KA-S-${stamp}`
  const unrelatedStudentEaglesId = `KA-US-${stamp}`
  const recipientEmail = `ka-engagement-${stamp}@example.invalid`
  let targetStudent = null
  let unrelatedStudent = null
  let parentAccount = null
  let unrelatedParentAccount = null
  let studentAccount = null
  let unrelatedStudentAccount = null
  let targetLink = null
  let unrelatedLink = null
  let report = null
  let delivery = null
  let server = null

  try {
    const database = await prisma.$queryRaw`SELECT current_database() AS name`
    assert.equal(database[0]?.name, "sis_dev")
    targetStudent = await prisma.student.create({
      data: {
        externalKey: `ka-engagement-${stamp}-target`,
        studentNumber: syntheticStudentNumber(stamp),
        eaglesId: studentEaglesId,
        email: recipientEmail,
      },
    })
    unrelatedStudent = await prisma.student.create({
      data: {
        externalKey: `ka-engagement-${stamp}-unrelated`,
        studentNumber: syntheticStudentNumber(stamp, 8),
        eaglesId: unrelatedStudentEaglesId,
        email: `ka-unrelated-${stamp}@example.invalid`,
      },
    })
    parentAccount = await prisma.parentPortalAccount.create({
      data: {
        parentsId: parentId,
        email: `ka-parent-${stamp}@example.invalid`,
        passwordHash: hashScryptPassword(password),
      },
    })
    unrelatedParentAccount = await prisma.parentPortalAccount.create({
      data: {
        parentsId: unrelatedParentId,
        email: `ka-unrelated-parent-${stamp}@example.invalid`,
        passwordHash: hashScryptPassword(password),
      },
    })
    targetLink = await prisma.parentPortalStudentLink.create({
      data: { parentAccountId: parentAccount.id, studentRefId: targetStudent.id },
    })
    unrelatedLink = await prisma.parentPortalStudentLink.create({
      data: { parentAccountId: unrelatedParentAccount.id, studentRefId: unrelatedStudent.id },
    })
    studentAccount = await prisma.studentPortalAccount.create({
      data: {
        eaglesId: studentEaglesId,
        passwordHash: hashScryptPassword(password),
        studentRefId: targetStudent.id,
      },
    })
    unrelatedStudentAccount = await prisma.studentPortalAccount.create({
      data: {
        eaglesId: unrelatedStudentEaglesId,
        passwordHash: hashScryptPassword(password),
        studentRefId: unrelatedStudent.id,
      },
    })
    report = await prisma.parentClassReport.create({
      data: {
        studentRefId: targetStudent.id,
        className: "Keep Alive Synthetic",
        level: "Keep Alive Synthetic",
        schoolYear: "2026",
        quarter: "q1",
        workflowState: "published",
        publishedAt: new Date(),
        finalArtifactVersion: 1,
        metaPayload: { classDate: "2026-11-17" },
      },
    })
    delivery = await prisma.brevoEmailDelivery.create({
      data: {
        providerMessageId: `ka-engagement-${stamp}@example.invalid`,
        recipientEmail,
        reportId: report.id,
        status: "sent",
        sentAt: new Date(),
      },
    })

    server = await startExerciseMailer({
      transporter: mockTransporter(),
      port: 0,
      host: "127.0.0.1",
    })
    await new Promise((resolve, reject) => {
      server.once("listening", resolve)
      server.once("error", reject)
    })
    const address = server.address()
    const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`

    const login = async (path, body) => {
      const response = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      assert.equal(response.status, 200)
      return response.headers.get("set-cookie")?.split(";")[0] || ""
    }
    const unrelatedParentCookie = await login("/api/parent/auth/login", {
      parentsId: unrelatedParentId,
      password,
    })
    const unrelatedStudentCookie = await login("/api/student/auth/login", {
      eaglesId: unrelatedStudentEaglesId,
      password,
    })
    const parentCookie = await login("/api/parent/auth/login", { parentsId: parentId, password })
    const studentCookie = await login("/api/student/auth/login", { eaglesId: studentEaglesId, password })

    const parentDenied = await fetch(`${origin}/api/parent/reports/${report.id}/acknowledge`, {
      method: "POST",
      headers: { cookie: unrelatedParentCookie },
    })
    const studentDenied = await fetch(`${origin}/api/student/reports/${report.id}/acknowledge`, {
      method: "POST",
      headers: { cookie: unrelatedStudentCookie },
    })
    assert.equal(parentDenied.status, 403)
    assert.equal(studentDenied.status, 403)

    const acknowledge = async (path, cookie) => {
      const response = await fetch(`${origin}${path}`, { method: "POST", headers: { cookie } })
      assert.equal(response.status, 200)
      return response.json()
    }
    const parentPath = `/api/parent/reports/${report.id}/acknowledge`
    const firstParentAck = await acknowledge(parentPath, parentCookie)
    const secondParentAck = await acknowledge(parentPath, parentCookie)
    const concurrentParentAcks = await Promise.all([
      acknowledge(parentPath, parentCookie),
      acknowledge(parentPath, parentCookie),
    ])
    assert.equal(
      firstParentAck.report.metaPayload.parentReviewedAt,
      secondParentAck.report.metaPayload.parentReviewedAt,
    )
    assert.equal(secondParentAck.report.metaPayload.parentReviewedByUsername, parentId)
    for (const response of concurrentParentAcks) {
      assert.equal(response.report.metaPayload.parentReviewedAt, firstParentAck.report.metaPayload.parentReviewedAt)
    }

    const studentPath = `/api/student/reports/${report.id}/acknowledge`
    const firstStudentAck = await acknowledge(studentPath, studentCookie)
    const secondStudentAck = await acknowledge(studentPath, studentCookie)
    const concurrentStudentAcks = await Promise.all([
      acknowledge(studentPath, studentCookie),
      acknowledge(studentPath, studentCookie),
    ])
    assert.equal(
      firstStudentAck.report.metaPayload.studentReviewedAt,
      secondStudentAck.report.metaPayload.studentReviewedAt,
    )
    for (const response of concurrentStudentAcks) {
      assert.equal(response.report.metaPayload.studentReviewedAt, firstStudentAck.report.metaPayload.studentReviewedAt)
    }

    const missingReportPixel = await fetch(
      `${origin}/api/report-events/email-open.gif?reportId=missing-${stamp}&recipient=${encodeURIComponent(recipientEmail)}`,
    )
    const unrelatedRecipientPixel = await fetch(
      `${origin}/api/report-events/email-open.gif?reportId=${encodeURIComponent(report.id)}&recipient=${encodeURIComponent(`unrelated-${stamp}@example.invalid`)}`,
    )
    assert.equal(missingReportPixel.status, 200)
    assert.equal(unrelatedRecipientPixel.status, 200)
    const validPixel = await fetch(
      `${origin}/api/report-events/email-open.gif?reportId=${encodeURIComponent(report.id)}&recipient=${encodeURIComponent(recipientEmail)}&artifactVersion=1`,
      { headers: { "x-forwarded-for": "203.0.113.15" } },
    )
    assert.equal(validPixel.status, 200)

    const events = await prisma.parentClassReportEvent.findMany({
      where: { reportId: report.id },
      orderBy: { eventAt: "asc" },
    })
    assert.equal(events.filter((event) => event.eventType === "parent_review_acknowledged").length, 1)
    assert.equal(events.filter((event) => event.eventType === "student_review_acknowledged").length, 1)
    const opened = events.filter((event) => event.eventType === "email_opened")
    assert.equal(opened.length, 1)
    assert.equal(opened[0].recipientEmail, recipientEmail)
    assert.ok(opened[0].ipHash)
    assert.notEqual(opened[0].ipHash, "203.0.113.15")
    assert.equal(await prisma.parentClassReportEvent.count({ where: { reportId: `missing-${stamp}` } }), 0)
  } finally {
    const cleanupErrors = []
    const attempt = async (operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (server) {
      server.closeAllConnections?.()
      server.closeIdleConnections?.()
      await attempt(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))))
      await attempt(() => closeStudentAdminRuntimeResources())
    }
    if (report) await attempt(() => prisma.parentClassReportEvent.deleteMany({ where: { reportId: report.id } }))
    if (delivery) await attempt(() => prisma.brevoEmailDelivery.deleteMany({ where: { id: delivery.id } }))
    if (report) await attempt(() => prisma.parentClassReport.deleteMany({ where: { id: report.id } }))
    if (studentAccount) await attempt(() => prisma.studentPortalAccount.deleteMany({ where: { id: studentAccount.id } }))
    if (unrelatedStudentAccount) await attempt(() => prisma.studentPortalAccount.deleteMany({ where: { id: unrelatedStudentAccount.id } }))
    if (targetLink) await attempt(() => prisma.parentPortalStudentLink.deleteMany({ where: { id: targetLink.id } }))
    if (unrelatedLink) await attempt(() => prisma.parentPortalStudentLink.deleteMany({ where: { id: unrelatedLink.id } }))
    if (parentAccount) await attempt(() => prisma.parentPortalAccount.deleteMany({ where: { id: parentAccount.id } }))
    if (unrelatedParentAccount) await attempt(() => prisma.parentPortalAccount.deleteMany({ where: { id: unrelatedParentAccount.id } }))
    if (targetStudent) await attempt(() => prisma.student.deleteMany({ where: { id: targetStudent.id } }))
    if (unrelatedStudent) await attempt(() => prisma.student.deleteMany({ where: { id: unrelatedStudent.id } }))
    await attempt(() => closeSharedPrismaClient())
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic engagement cleanup failed")
  }
})
