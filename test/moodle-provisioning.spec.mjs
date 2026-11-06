import test from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"
import { Readable } from "node:stream"
import * as XLSX from "xlsx"

import {
  handleMoodleProvisioningRequest,
  linkMoodleUsersWithClient,
  queueMoodleEnrollmentChange,
  queueStudentProvisioning,
} from "../src/modules/admin/moodle-provisioning.mjs"
import {
  buildMoodleRosterCorrectionExport,
  buildMoodleRosterExport,
} from "../src/modules/admin/moodle-roster-export.mjs"

function makeTransaction(student) {
  const state = { commands: [], link: null }
  return {
    state,
    student: { findUnique: async () => student },
    moodleUserLink: {
      upsert: async (input) => { state.link = input; return input },
      findUnique: async () => state.existingLink || null,
    },
    moodleProvisioningCommand: {
      create: async ({ data }) => {
        const command = { id: `cmd-${state.commands.length + 1}`, sequence: state.commands.length + 1, ...data }
        state.commands.push(command)
        return command
      },
    },
  }
}

const student = { id: "student-1", eaglesId: "eagles001", studentNumber: 1001 }
const profile = { englishName: "Sam", fullName: "Nguyen Van A", studentEmail: "sam@example.edu", currentGrade: "A1 Movers" }

test("new student provisioning creates ordered user, one-time password, Eagles Club and level membership commands", async () => {
  const previous = process.env.MOODLE_SIS_PROVISIONING_SECRET
  process.env.MOODLE_SIS_PROVISIONING_SECRET = "moodle-provisioning-test-secret"
  try {
    const tx = makeTransaction(student)
    const result = await queueStudentProvisioning(tx, { student, profile, password: "NotLogged-9!pass", isNew: true })
    assert.deepEqual(result, { queued: true })
    assert.deepEqual(tx.state.commands.map((command) => command.action), [
      "upsert_user", "set_password", "add_cohort", "promote_student",
    ])
    assert.deepEqual(tx.state.commands[2].payloadJson, {
      cohortIdnumber: "eagles-club", cohortName: "Eagles Club", eaglesId: "eagles001", studentNumber: 1001,
    })
    assert.equal(tx.state.commands[3].payloadJson.toLevel, "A1 Movers")
    const passwordCommand = tx.state.commands[1]
    assert.equal(passwordCommand.payloadJson.eaglesId, "eagles001")
    assert.equal(passwordCommand.encryptedPayload.includes("NotLogged-9!pass"), false)
    assert.equal(JSON.stringify(passwordCommand).includes("NotLogged-9!pass"), false)
    const packed = Buffer.from(passwordCommand.encryptedPayload, "base64")
    const key = Buffer.from(crypto.hkdfSync("sha256", Buffer.from(process.env.MOODLE_SIS_PROVISIONING_SECRET), Buffer.alloc(0), Buffer.from("eagles-sis-moodle-password-v1"), 32))
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12))
    decipher.setAuthTag(packed.subarray(12, 28))
    const decrypted = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8")
    assert.equal(decrypted, "NotLogged-9!pass")
    assert.equal(JSON.stringify(tx.state.commands).includes("NotLogged-9!pass"), false)
  } finally {
    if (previous === undefined) delete process.env.MOODLE_SIS_PROVISIONING_SECRET
    else process.env.MOODLE_SIS_PROVISIONING_SECRET = previous
  }
})

test("promotion removes only the prior SIS level and adds the new level while retaining Eagles Club", async () => {
  const previous = process.env.MOODLE_SIS_PROVISIONING_SECRET
  process.env.MOODLE_SIS_PROVISIONING_SECRET = "moodle-provisioning-test-secret"
  try {
    const tx = makeTransaction(student)
    await queueStudentProvisioning(tx, { student, profile: { ...profile, currentGrade: "A2 Flyers" }, previousLevel: "Movers" })
    assert.deepEqual(tx.state.commands.map((command) => command.action), [
      "upsert_user", "add_cohort", "promote_student",
    ])
    assert.deepEqual(tx.state.commands[1].payloadJson, {
      cohortIdnumber: "eagles-club", cohortName: "Eagles Club", eaglesId: "eagles001", studentNumber: 1001,
    })
    assert.equal(tx.state.commands[2].payloadJson.fromLevel, "A1 Movers")
    assert.equal(tx.state.commands[2].payloadJson.toLevel, "A2 Flyers")
  } finally {
    if (previous === undefined) delete process.env.MOODLE_SIS_PROVISIONING_SECRET
    else process.env.MOODLE_SIS_PROVISIONING_SECRET = previous
  }
})

test("normal SIS level promotions queue a direct Moodle move for linked students", async () => {
  const previousSecret = process.env.MOODLE_SIS_PROVISIONING_SECRET
  const previousEnabled = process.env.MOODLE_SIS_PROVISIONING_ENABLED
  process.env.MOODLE_SIS_PROVISIONING_SECRET = "moodle-provisioning-test-secret"
  delete process.env.MOODLE_SIS_PROVISIONING_ENABLED
  try {
    const tx = makeTransaction(student)
    tx.state.existingLink = { status: "active", moodleUserId: 41 }
    const result = await queueMoodleEnrollmentChange(tx, {
      student,
      action: "promote",
      fromLevel: "Movers",
      toLevel: "A2 Flyers",
    })
    assert.deepEqual(result, { queued: true, actions: ["promote_student"] })
    assert.equal(tx.state.commands.length, 1)
    assert.equal(tx.state.commands[0].action, "promote_student")
    assert.deepEqual(tx.state.commands[0].payloadJson, {
      fromLevel: "A1 Movers",
      toLevel: "A2 Flyers",
      eaglesId: "eagles001",
      studentNumber: 1001,
    })
  } finally {
    if (previousSecret === undefined) delete process.env.MOODLE_SIS_PROVISIONING_SECRET
    else process.env.MOODLE_SIS_PROVISIONING_SECRET = previousSecret
    if (previousEnabled === undefined) delete process.env.MOODLE_SIS_PROVISIONING_ENABLED
    else process.env.MOODLE_SIS_PROVISIONING_ENABLED = previousEnabled
  }
})

test("normal SIS unenrollment queues course removal and level-cohort removal but retains Eagles Club", async () => {
  const previousSecret = process.env.MOODLE_SIS_PROVISIONING_SECRET
  const previousEnabled = process.env.MOODLE_SIS_PROVISIONING_ENABLED
  process.env.MOODLE_SIS_PROVISIONING_SECRET = "moodle-provisioning-test-secret"
  delete process.env.MOODLE_SIS_PROVISIONING_ENABLED
  try {
    const tx = makeTransaction(student)
    tx.state.existingLink = { status: "active", moodleUserId: 41 }
    const result = await queueMoodleEnrollmentChange(tx, {
      student,
      action: "unenroll",
      fromLevel: "A1 Movers",
    })
    assert.deepEqual(result, { queued: true, actions: ["unenrol", "remove_cohort"] })
    assert.deepEqual(tx.state.commands.map((command) => command.action), ["unenrol", "remove_cohort"])
    assert.deepEqual(tx.state.commands.map((command) => command.payloadJson), [
      { level: "A1 Movers", eaglesId: "eagles001", studentNumber: 1001 },
      { cohortIdnumber: "A1 Movers", cohortName: "A1 Movers", eaglesId: "eagles001", studentNumber: 1001 },
    ])
  } finally {
    if (previousSecret === undefined) delete process.env.MOODLE_SIS_PROVISIONING_SECRET
    else process.env.MOODLE_SIS_PROVISIONING_SECRET = previousSecret
    if (previousEnabled === undefined) delete process.env.MOODLE_SIS_PROVISIONING_ENABLED
    else process.env.MOODLE_SIS_PROVISIONING_ENABLED = previousEnabled
  }
})

test("normal SIS enrollment changes do not create Moodle commands for unlinked or disabled students", async () => {
  const previousSecret = process.env.MOODLE_SIS_PROVISIONING_SECRET
  const previousEnabled = process.env.MOODLE_SIS_PROVISIONING_ENABLED
  process.env.MOODLE_SIS_PROVISIONING_SECRET = "moodle-provisioning-test-secret"
  delete process.env.MOODLE_SIS_PROVISIONING_ENABLED
  try {
    for (const link of [null, { status: "disabled", moodleUserId: 41 }]) {
      const tx = makeTransaction(student)
      tx.state.existingLink = link
      const result = await queueMoodleEnrollmentChange(tx, {
        student,
        action: "promote",
        fromLevel: "A1 Movers",
        toLevel: "A2 Flyers",
      })
      assert.deepEqual(result, { queued: false, reason: "not_linked" })
      assert.equal(tx.state.commands.length, 0)
    }
  } finally {
    if (previousSecret === undefined) delete process.env.MOODLE_SIS_PROVISIONING_SECRET
    else process.env.MOODLE_SIS_PROVISIONING_SECRET = previousSecret
    if (previousEnabled === undefined) delete process.env.MOODLE_SIS_PROVISIONING_ENABLED
    else process.env.MOODLE_SIS_PROVISIONING_ENABLED = previousEnabled
  }
})

test("missing provisioning identity fields block commands without writing partial account payloads", async () => {
  const previous = process.env.MOODLE_SIS_PROVISIONING_SECRET
  process.env.MOODLE_SIS_PROVISIONING_SECRET = "moodle-provisioning-test-secret"
  try {
    const tx = makeTransaction(student)
    const result = await queueStudentProvisioning(tx, { student, profile: { ...profile, fullName: "" } })
    assert.equal(result.queued, false)
    assert.deepEqual(result.missing, ["full_name"])
    assert.equal(tx.state.commands.length, 0)
    assert.equal(tx.state.link.update.status, "blocked")
  } finally {
    if (previous === undefined) delete process.env.MOODLE_SIS_PROVISIONING_SECRET
    else process.env.MOODLE_SIS_PROVISIONING_SECRET = previous
  }
})

test("signed provisioning endpoints reject unsigned or invalid requests before database access", async () => {
  const previous = process.env.MOODLE_SIS_PROVISIONING_SECRET
  process.env.MOODLE_SIS_PROVISIONING_SECRET = "moodle-provisioning-test-secret"
  try {
    const raw = JSON.stringify({ limit: 10 })
    const request = Readable.from([raw])
    request.method = "POST"
    request.url = "/api/moodle/provisioning/poll"
    request.headers = {
      host: "localhost",
      "x-sis-source": "moodle",
      "x-sis-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-sis-nonce": "abcdefghijklmnopqrstuvwx",
      "x-sis-signature": "0".repeat(64),
    }
    const response = {
      status: 0,
      headers: {},
      writeHead(status, headers) { this.status = status; this.headers = headers },
      end(body) { this.body = body },
    }
    assert.equal(await handleMoodleProvisioningRequest(request, response), true)
    assert.equal(response.status, 401)
    assert.deepEqual(JSON.parse(response.body), { errorCode: "request_rejected" })
    assert.equal(response.headers["X-SIS-Timestamp"].length > 0, true)
    assert.equal(response.headers["X-SIS-Nonce"].length > 0, true)
    const expected = crypto.createHmac("sha256", process.env.MOODLE_SIS_PROVISIONING_SECRET)
      .update(`${response.headers["X-SIS-Timestamp"]}\n${response.headers["X-SIS-Nonce"]}\n${response.body}`)
      .digest("hex")
    assert.equal(response.headers["X-SIS-Signature"], expected)
  } finally {
    if (previous === undefined) delete process.env.MOODLE_SIS_PROVISIONING_SECRET
    else process.env.MOODLE_SIS_PROVISIONING_SECRET = previous
  }
})

test("Moodle roster export contains native upload CSV and SIS identity sheets without passwords", () => {
  const result = buildMoodleRosterExport([{
    eaglesId: "eagles001",
    studentNumber: 1001,
    email: "student@example.edu",
    profile: { englishName: "Sam", fullName: "Nguyen Van A", currentGrade: "Movers" },
    currentEnrollment: { level: "A1 Movers", status: "active" },
  }])
  const workbook = XLSX.read(result.workbook, { type: "buffer" })
  const nativeRows = XLSX.utils.sheet_to_json(workbook.Sheets["Moodle CSV"], { header: 1, raw: false })
  const sisRows = XLSX.utils.sheet_to_json(workbook.Sheets["SIS Link"], { header: 1, raw: false })
  const nativeCsv = XLSX.read(result.csv, { type: "buffer", raw: false })
  const csvRows = XLSX.utils.sheet_to_json(nativeCsv.Sheets[nativeCsv.SheetNames[0]], { header: 1, raw: false })
  assert.equal(result.rowCount, 1)
  assert.deepEqual(nativeRows[0], ["username", "idnumber", "firstname", "lastname", "email"])
  assert.deepEqual(nativeRows[1], ["eagles001", "1001", "Sam", "Nguyen Van A", "student@example.edu"])
  assert.deepEqual(sisRows[0], ["eaglesId", "studentNumber", "englishName", "fullName", "email", "level"])
  assert.deepEqual(sisRows[1], ["eagles001", "1001", "Sam", "Nguyen Van A", "student@example.edu", "A1 Movers"])
  assert.deepEqual(csvRows[1], nativeRows[1])
  assert.equal(result.csv.toString("utf8").toLowerCase().includes("password"), false)
  assert.deepEqual(workbook.SheetNames, ["Moodle CSV", "SIS Link", "Instructions"])
})

test("Moodle roster export fails closed for incomplete current-student identities", () => {
  let error
  try {
    buildMoodleRosterExport([{
      eaglesId: "eagles002",
      studentNumber: 1002,
      email: "",
      profile: { englishName: "Sam", fullName: "" },
      currentEnrollment: { level: "A1 Movers", status: "active" },
    }])
  } catch (caught) {
    error = caught
  }
  assert.ok(error instanceof Error)
  assert.match(error.message, /Moodle roster export blocked/u)
  assert.match(error.message, /1 current student needs correction/u)
  assert.match(error.message, /valid student email/u)
  assert.match(error.message, /fullName/u)
})

test("Moodle correction workbook contains only blocked students in the SIS import format", () => {
  const result = buildMoodleRosterCorrectionExport([
    {
      eaglesId: "eagles001",
      studentNumber: 1001,
      email: "",
      profile: { englishName: "Sam", fullName: "", studentEmail: "" },
      currentEnrollment: { level: "Movers", status: "active" },
    },
    {
      eaglesId: "eagles002",
      studentNumber: 1002,
      email: "ready@example.edu",
      profile: { englishName: "Lee", fullName: "Nguyen Van B" },
      currentEnrollment: { level: "A1 Movers", status: "active" },
    },
  ])
  const workbook = XLSX.read(result.workbook, { type: "buffer" })
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Student Import"], { header: 1, raw: false })

  assert.equal(result.rowCount, 1)
  assert.deepEqual(rows[0], [
    "eaglesId", "studentNumber", "englishName", "fullName", "studentEmail", "currentGrade", "missingFields",
  ])
  assert.deepEqual(rows[1], [
    "eagles001", "1001", "Sam", "", "", "A1 Movers", "fullName, valid student email",
  ])
  assert.deepEqual(workbook.SheetNames, ["Student Import", "Instructions"])
})

test("signed Moodle roster links bind each numeric Moodle user ID to matching SIS identity", async () => {
  const savedLinks = new Map()
  const client = {
    $transaction: async (handler) => handler(client),
    student: {
      findUnique: async ({ where }) => where.eaglesId === "eagles001" ? student : null,
    },
    moodleUserLink: {
      findUnique: async ({ where }) => savedLinks.get(where.studentRefId) || null,
      findFirst: async ({ where }) => [...savedLinks.values()].find((link) => link.moodleUserId === where.moodleUserId && link.studentRefId !== where.studentRefId) || null,
      upsert: async ({ where, create, update }) => {
        const link = savedLinks.get(where.studentRefId) ? { ...savedLinks.get(where.studentRefId), ...update } : { ...create }
        savedLinks.set(where.studentRefId, link)
        return link
      },
    },
  }
  assert.deepEqual(await linkMoodleUsersWithClient(client, [{ eaglesId: "eagles001", studentNumber: 1001, moodleUserId: 41 }]), { linked: 1 })
  assert.equal(savedLinks.get("student-1").moodleUserId, 41)
  assert.equal(savedLinks.get("student-1").status, "active")
  await assert.rejects(
    () => linkMoodleUsersWithClient(client, [{ eaglesId: "eagles001", studentNumber: 9999, moodleUserId: 42 }]),
    /does not match SIS/u,
  )
  assert.equal(savedLinks.get("student-1").moodleUserId, 41)
})
