// test/exercise-mailer.spec.mjs
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

process.env.NODE_ENV = "test"
// allow any origin during test, then override in a CORS test
process.env.EXERCISE_MAILER_ORIGIN = "*"
process.env.EXERCISE_STORE_ENABLED = "false"
process.env.EXERCISE_STORE_REQUIRED = "false"
process.env.STUDENT_INTAKE_STORE_ENABLED = "false"
// Keep logs quiet for tests
process.env.MAILER_DEBUG = "false"

// build a mock nodemailer-like transporter
function makeMockTransport() {
  const calls = { verify: 0, sendMail: 0, last: null, history: [] }
  return {
    calls,
    verify(cb) {
      calls.verify += 1
      // async-ish
      setImmediate(() => cb(null, true))
    },
    async sendMail(mail) {
      calls.sendMail += 1
      calls.last = mail
      calls.history.push(mail)
      return { messageId: "test-message-id" }
    },
  }
}

// tiny fetch helper against a chosen port
async function fetchLocal(port, path, init = {}) {
  const url = `http://127.0.0.1:${port}${path}`
  const res = await fetch(url, init)
  return res
}

let server
let basePort
let transport

test("start server on a random port (0) with mock transport", async () => {
  // import after env is set
  const { startExerciseMailer } = await import(process.cwd() + "/server/exercise-mailer.mjs")

  transport = makeMockTransport()
  server = await startExerciseMailer({ transporter: transport, port: 0 })

  // wait until bound
  await new Promise((resolve) => server.once("listening", resolve))

  basePort = server.address().port
  assert.ok(Number.isInteger(basePort) && basePort > 0, "server bound to a random port")
})

test("GET /healthz returns ok + endpoint", async () => {
  const res = await fetchLocal(basePort, "/healthz")
  assert.equal(res.status, 200)
  assert.equal(res.headers.get("content-type"), "application/json")
  const body = await res.json()
  assert.equal(body.status, "ok")
  assert.equal(body.endpoint, "/api/exercise-submission")
  assert.equal(body.intakeEndpoint, "/api/student-intake-submission")
  assert.equal(body.studentAdminRuntime?.pagePath, "/admin/students")
  assert.equal(body.studentAdminRuntime?.apiPrefix, "/api/admin")
  assert.ok(Array.isArray(body.studentAdminRuntime?.pageSections))
  assert.ok(body.studentAdminRuntime.pageSections.includes("overview"))
  assert.ok(["memory", "redis"].includes(body.studentAdminRuntime?.sessionDriver))
  assert.ok(body.studentAdminRuntime?.filterCache)
})

test("POST /api/exercise-submission succeeds (204) and dispatches notifications", async () => {
  const payload = {
    email: "student@example.com",
    studentId: "abc123",
    pageTitle: "Test Page",
    recipients: ["recipient@example.com"],
    answers: [{ id: 1, answers: ["ok"] }],
  }
  const res = await fetchLocal(basePort, "/api/exercise-submission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  assert.equal(res.status, 204)
  assert.equal(transport.calls.sendMail, 2, "teacher and learner messages were sent")
  assert.equal(transport.calls.history.length, 2)

  const [teacherMail, learnerMail] = transport.calls.history

  assert.ok(teacherMail, "teacher email payload captured")
  assert.equal(teacherMail.to[0], "recipient@example.com")
  assert.equal(teacherMail.subject, "abc123 Exercise submission — Test Page")
  assert.match(teacherMail.text, /^abc123 just completed Test Page\./m)
  assert.match(teacherMail.text, /Student ID: abc123/)
  assert.match(teacherMail.text, /Student email: student@example.com/)
  assert.match(teacherMail.text, /Question 1:/)
  assert.equal(teacherMail.cc, undefined)

  assert.ok(learnerMail, "learner confirmation payload captured")
  assert.equal(learnerMail.to[0], "student@example.com")
  assert.match(learnerMail.subject, /Confirmation/)
  assert.match(learnerMail.text, /Test Page/)
  assert.match(learnerMail.text, /Student ID: abc123/)
  assert.doesNotMatch(learnerMail.text, /Question 1:/)
})

test("POST /api/exercise-submission decodes obfuscated recipients", async () => {
  const beforeHistory = transport.calls.history.length
  const payload = {
    email: "student2@example.com",
    studentId: "def456",
    pageTitle: "Decode Test",
    recipients: [
      { utf8: Buffer.from("teacher2@example.com", "utf8").toString("hex") },
      {
        codepoints: Array.from("admin@example.com").map((char) => char.codePointAt(0)),
      },
    ],
    answers: [{ id: 1, answers: ["ok"] }],
  }

  const res = await fetchLocal(basePort, "/api/exercise-submission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })

  assert.equal(res.status, 204)
  const newHistory = transport.calls.history.slice(beforeHistory)
  assert.equal(newHistory.length, 2, "teacher + learner mails captured for obfuscated payload")

  const [teacherMail, learnerMail] = newHistory
  assert.deepEqual(teacherMail.to, ["teacher2@example.com", "admin@example.com"])
  assert.equal(learnerMail.to[0], "student2@example.com")
})

test("POST /api/exercise-submission with missing answers returns 400", async () => {
  const bad = { email: "x@example.com", answers: [] }
  const res = await fetchLocal(basePort, "/api/exercise-submission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bad),
  })
  assert.equal(res.status, 400)
  const b = await res.json()
  assert.match(b.error, /Missing answers/i)
})

test("POST /api/student-intake-submission accepts intake payload and does not send email", async () => {
  const beforeSendCount = transport.calls.sendMail
  const payload = {
    sourceFormId: "cf3",
    sourceUrl:
      "https://eagles.edu.vn/cac-khoa-hoc/trang-chu-tu-cach-thanh-vien/tham-gia-hinh-thuc-thanh-vien",
    fields: {
      "Full-Name-student": "Jane Student",
      DOB: "2014-10-01",
      "student-email": "parent@example.com",
      Signature: "Parent Name",
      "Mothers-phone": "0900000000",
      "Fathers-phone": "0911000000",
    },
  }

  const res = await fetchLocal(basePort, "/api/student-intake-submission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })

  assert.equal(res.status, 204)
  assert.equal(transport.calls.sendMail, beforeSendCount)
})

test("POST /api/student-intake-submission with missing fields returns 400", async () => {
  const res = await fetchLocal(basePort, "/api/student-intake-submission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceFormId: "cf3" }),
  })
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.match(body.error, /Missing intake form fields/i)
})

test("CORS echoes back allowed origin when specific origin is configured", async () => {
  // Spawn a one-off server with a specific origin to test the echo behavior
  const { startExerciseMailer } = await import(process.cwd() + "/server/exercise-mailer.mjs")
  const t2Transport = makeMockTransport()

  // Set a specific origin and start a temp server
  process.env.EXERCISE_MAILER_ORIGIN = "http://example.com"
  const tmp = await startExerciseMailer({ transporter: t2Transport, port: 0 })
  await new Promise((r) => tmp.once("listening", r))
  const tmpPort = tmp.address().port

  // Preflight
  const pre = await fetch(`http://127.0.0.1:${tmpPort}/api/exercise-submission`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://example.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
  })
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get("access-control-allow-origin"), "http://example.com")

  // Cleanup temp
  await new Promise((res) => tmp.close(res))
  process.env.EXERCISE_MAILER_ORIGIN = "*"
})

test("GET /healthz includes CORS headers for allowed loopback preview origin", async () => {
  const { startExerciseMailer } = await import(process.cwd() + "/server/exercise-mailer.mjs")
  const t3Transport = makeMockTransport()

  process.env.EXERCISE_MAILER_ORIGIN = "http://example.com"
  const tmp = await startExerciseMailer({ transporter: t3Transport, port: 0 })
  await new Promise((r) => tmp.once("listening", r))
  const tmpPort = tmp.address().port

  const res = await fetch(`http://127.0.0.1:${tmpPort}/healthz`, {
    headers: {
      Origin: "http://127.0.0.1:46145",
    },
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get("access-control-allow-origin"), "http://127.0.0.1:46145")

  await new Promise((done) => tmp.close(done))
  process.env.EXERCISE_MAILER_ORIGIN = "*"
})

test("runtime self-heal syncs admin html on mismatch when enabled", async () => {
  const { startExerciseMailer } = await import(process.cwd() + "/server/exercise-mailer.mjs")
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sis-self-heal-src-"))
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sis-self-heal-runtime-"))
  const sourceHtmlPath = path.join(sourceRoot, "web-asset", "admin", "student-admin.html")
  const runtimeHtmlPath = path.join(runtimeRoot, "web-asset", "admin", "student-admin.html")
  fs.mkdirSync(path.dirname(sourceHtmlPath), { recursive: true })
  fs.mkdirSync(path.dirname(runtimeHtmlPath), { recursive: true })
  fs.writeFileSync(sourceHtmlPath, "<html>source-v2</html>\n")
  fs.writeFileSync(runtimeHtmlPath, "<html>runtime-v1</html>\n")

  const prevEnabled = process.env.SIS_RUNTIME_SELF_HEAL_ENABLED
  const prevSourceRoot = process.env.SIS_RUNTIME_SELF_HEAL_SOURCE_ROOT
  const prevRuntimeRoot = process.env.SIS_RUNTIME_SELF_HEAL_RUNTIME_ROOT
  const prevInterval = process.env.SIS_RUNTIME_SELF_HEAL_INTERVAL_MS

  process.env.SIS_RUNTIME_SELF_HEAL_ENABLED = "true"
  process.env.SIS_RUNTIME_SELF_HEAL_SOURCE_ROOT = sourceRoot
  process.env.SIS_RUNTIME_SELF_HEAL_RUNTIME_ROOT = runtimeRoot
  process.env.SIS_RUNTIME_SELF_HEAL_INTERVAL_MS = "1000"

  let tmp = null
  try {
    tmp = await startExerciseMailer({ transporter: makeMockTransport(), port: 0, host: "127.0.0.1" })
    await new Promise((r) => tmp.once("listening", r))

    const synced = fs.readFileSync(runtimeHtmlPath, "utf8")
    assert.equal(synced, "<html>source-v2</html>\n")

    const tmpPort = tmp.address().port
    const res = await fetch(`http://127.0.0.1:${tmpPort}/healthz`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.runtimeSelfHeal?.enabled, true)
    assert.equal(body.runtimeSelfHeal?.lastResult, "synced")
    assert.ok(Number(body.runtimeSelfHeal?.syncCount) >= 1)
  } finally {
    if (tmp) await new Promise((done) => tmp.close(done))

    if (prevEnabled === undefined) delete process.env.SIS_RUNTIME_SELF_HEAL_ENABLED
    else process.env.SIS_RUNTIME_SELF_HEAL_ENABLED = prevEnabled

    if (prevSourceRoot === undefined) delete process.env.SIS_RUNTIME_SELF_HEAL_SOURCE_ROOT
    else process.env.SIS_RUNTIME_SELF_HEAL_SOURCE_ROOT = prevSourceRoot

    if (prevRuntimeRoot === undefined) delete process.env.SIS_RUNTIME_SELF_HEAL_RUNTIME_ROOT
    else process.env.SIS_RUNTIME_SELF_HEAL_RUNTIME_ROOT = prevRuntimeRoot

    if (prevInterval === undefined) delete process.env.SIS_RUNTIME_SELF_HEAL_INTERVAL_MS
    else process.env.SIS_RUNTIME_SELF_HEAL_INTERVAL_MS = prevInterval
  }
})

test("shutdown", async () => {
  await new Promise((res) => server.close(res))
})
