import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  assertAuthenticatedSmokePrerequisites,
  assertTestEnvironment,
  buildNoExternalMessageTestEnvironment,
  renderNightlySmokeMetrics,
  writeMetricsAtomically,
} from "../tools/run-keepalive-nightly-smoke.mjs"
import {
  applyKeepaliveTestEnvironment,
  buildKeepaliveTestContext,
} from "../tools/keepalive-test-environment.mjs"

const TEST_ENVIRONMENT = {
  NODE_ENV: "test",
  SIS_ENV_FILE: ".env.test",
  DOTENV_CONFIG_PATH: ".env.test",
  SIS_KEEPALIVE_NO_EXTERNAL_MESSAGES: "1",
}

test("nightly smoke requires the exact test environment tuple", () => {
  assert.doesNotThrow(() => assertTestEnvironment(TEST_ENVIRONMENT))
  assert.throws(() => assertTestEnvironment({ ...TEST_ENVIRONMENT, SIS_ENV_FILE: ".env.dev" }), /explicit test environment/u)
  assert.throws(() => assertTestEnvironment({ ...TEST_ENVIRONMENT, DOTENV_CONFIG_PATH: ".env" }), /explicit test environment/u)
  assert.throws(() => assertTestEnvironment({ ...TEST_ENVIRONMENT, NODE_ENV: "production" }), /explicit test environment/u)
  assert.throws(() => assertTestEnvironment({ ...TEST_ENVIRONMENT, SIS_KEEPALIVE_NO_EXTERNAL_MESSAGES: "0" }), /explicit test environment/u)
})

test("nightly authenticated smoke requires exact test accounts and an executable Chromium browser", () => {
  const credentials = {
    STUDENT_STUDENT_USER: "mark001",
    STUDENT_STUDENT_PASS: "student-test-password",
    STUDENT_PARENT_USER: "cmmark001",
    STUDENT_PARENT_PASS: "parent-test-password",
    STUDENT_ADMIN_USER: "test-admin",
    STUDENT_ADMIN_PASS: "admin-test-password",
  }
  const options = {
    environmentFileValues: credentials,
    chromiumAvailable: true,
  }
  assert.doesNotThrow(() => assertAuthenticatedSmokePrerequisites(TEST_ENVIRONMENT, options))
  assert.throws(() => assertAuthenticatedSmokePrerequisites(TEST_ENVIRONMENT, {
    ...options,
    environmentFileValues: { ...credentials, STUDENT_STUDENT_USER: "another-student" },
  }), /prerequisites are incomplete/u)
  assert.throws(() => assertAuthenticatedSmokePrerequisites(TEST_ENVIRONMENT, {
    ...options,
    environmentFileValues: { ...credentials, STUDENT_PARENT_USER: "another-parent" },
  }), /prerequisites are incomplete/u)
  assert.throws(() => assertAuthenticatedSmokePrerequisites(TEST_ENVIRONMENT, {
    ...options,
    environmentFileValues: { ...credentials, STUDENT_ADMIN_PASS: "" },
  }), /prerequisites are incomplete/u)
  assert.throws(() => assertAuthenticatedSmokePrerequisites(TEST_ENVIRONMENT, {
    ...options,
    chromiumAvailable: false,
  }), /prerequisites are incomplete/u)
})

test("nightly child environment preserves test access while removing external message credentials", () => {
  const childEnvironment = buildNoExternalMessageTestEnvironment({
    ...TEST_ENVIRONMENT,
    BREVO_API_KEY: "brevo-secret-sentinel",
    BREVO_API_URL: "https://api.brevo.com/v3/smtp/email",
    BREVO_API_BASE_URL: "https://api.brevo.com/v3",
    BREVO_FROM_EMAIL: "real-sender@example.com",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_USER: "smtp-user-sentinel",
    SMTP_PASS: "smtp-password-sentinel",
    STUDENT_STUDENT_USER: "mark001",
    DATABASE_URL: "postgresql://test-only",
  })
  assert.equal(childEnvironment.SIS_KEEPALIVE_NO_EXTERNAL_MESSAGES, "1")
  assert.equal(childEnvironment.EMAIL_PROVIDER, "smtp")
  assert.equal(childEnvironment.BREVO_API_URL, "http://127.0.0.1:1/v3/smtp/email")
  assert.equal(childEnvironment.BREVO_API_BASE_URL, "http://127.0.0.1:1/v3")
  assert.equal(childEnvironment.SMTP_HOST, "127.0.0.1")
  assert.equal(childEnvironment.SMTP_PORT, "1")
  assert.equal(childEnvironment.SMTP_AUTH_MODE, "none")
  assert.equal(childEnvironment.SMTP_FROM, "nightly-no-send@example.invalid")
  for (const key of ["BREVO_API_KEY", "BREVO_FROM_EMAIL", "SMTP_USER", "SMTP_PASS"]) {
    assert.equal(Object.hasOwn(childEnvironment, key), false, `${key} must not reach the suite`)
  }
  assert.equal(childEnvironment.STUDENT_STUDENT_USER, "mark001")
  assert.equal(childEnvironment.DATABASE_URL, "postgresql://test-only")
})

test("authenticated subsystem test context keeps environment ownership and test no-send isolation", () => {
  const context = buildKeepaliveTestContext({
    ...TEST_ENVIRONMENT,
    BREVO_API_KEY: "inherited-brevo-sentinel",
    SMTP_PASS: "inherited-smtp-sentinel",
  }, {
    DATABASE_URL: "postgresql://sis-test-only",
    BREVO_API_KEY: "dotenv-brevo-sentinel",
    SMTP_PASS: "dotenv-smtp-sentinel",
    STUDENT_ADMIN_USER: "configured-test-admin",
    STUDENT_ADMIN_PASS: "configured-test-password",
  })
  assert.equal(context?.databaseName, "sis-test")
  assert.equal(context?.noExternalMessagesEnforced, true)
  assert.equal(context?.values.SIS_ENV_FILE, ".env.test")
  assert.equal(context?.values.DOTENV_CONFIG_PATH, ".env.test")
  assert.equal(context?.values.NODE_ENV, "test")
  assert.equal(context?.values.DATABASE_URL, "postgresql://sis-test-only")
  assert.equal(context?.values.STUDENT_ADMIN_USER, "configured-test-admin")
  assert.equal(context?.values.SMTP_HOST, "127.0.0.1")
  assert.equal(context?.values.SMTP_PORT, "1")
  assert.equal(context?.values.BREVO_API_URL, "http://127.0.0.1:1/v3/smtp/email")
  for (const key of ["BREVO_API_KEY", "SMTP_PASS"]) {
    assert.equal(Object.hasOwn(context?.values || {}, key), false, `${key} must not be restored from an environment file`)
  }

  const devContext = buildKeepaliveTestContext({ NODE_ENV: "development", SIS_ENV_FILE: ".env.dev", DOTENV_CONFIG_PATH: ".env.dev" }, {})
  assert.equal(devContext?.databaseName, "sis_dev")
  assert.equal(devContext?.noExternalMessagesEnforced, false)
  assert.equal(buildKeepaliveTestContext({ NODE_ENV: "test", SIS_ENV_FILE: ".env.dev", DOTENV_CONFIG_PATH: ".env.dev" }, {}), null)
  assert.equal(buildKeepaliveTestContext({ NODE_ENV: "test", SIS_ENV_FILE: ".env.test", DOTENV_CONFIG_PATH: ".env" }, {}), null)
  assert.equal(buildKeepaliveTestContext({ NODE_ENV: "production", SIS_ENV_FILE: ".env", DOTENV_CONFIG_PATH: ".env" }, {}), null)
})

test("applying test subsystem context deletes inherited delivery secrets before merging its safe values", () => {
  const keys = ["BREVO_API_KEY", "SMTP_PASS"]
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    process.env.BREVO_API_KEY = "inherited-brevo-sentinel"
    process.env.SMTP_PASS = "inherited-smtp-sentinel"
    const context = buildKeepaliveTestContext(TEST_ENVIRONMENT, {
      DATABASE_URL: "postgresql://sis-test-only",
      BREVO_API_KEY: "dotenv-brevo-sentinel",
      SMTP_PASS: "dotenv-smtp-sentinel",
    })
    assert.equal(applyKeepaliveTestEnvironment(context), true)
    assert.equal(Boolean(process.env.BREVO_API_KEY), false)
    assert.equal(Boolean(process.env.SMTP_PASS), false)
    assert.equal(process.env.SMTP_HOST, "127.0.0.1")
    assert.equal(process.env.BREVO_API_URL, "http://127.0.0.1:1/v3/smtp/email")
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
})

test("nightly smoke exports bounded status and retains the last successful time after failure", () => {
  const contents = renderNightlySmokeMetrics({
    checkedAt: 200,
    durationSeconds: 3.5,
    success: false,
    lastSuccessTimestamp: 100,
    failureCode: "suite_failed",
  })
  assert.match(contents, /outbound email credentials were removed, SMTP\/Brevo endpoints were pinned to loopback/u)
  assert.match(contents, /sis_keepalive_nightly_smoke_success\{environment="test"\} 0/u)
  assert.match(contents, /sis_keepalive_nightly_smoke_no_external_message_proof\{environment="test"\} 0/u)
  assert.match(contents, /sis_keepalive_nightly_smoke_last_check_timestamp_seconds\{environment="test"\} 200\.000000/u)
  assert.match(contents, /sis_keepalive_nightly_smoke_last_success_timestamp_seconds\{environment="test"\} 100\.000000/u)
  assert.match(contents, /sis_keepalive_nightly_smoke_failure_info\{environment="test",code="suite_failed"\} 1/u)
  assert.doesNotMatch(contents, /^sis_keepalive_nightly_smoke_failed_file_info\{/mu)
  assert.throws(() => renderNightlySmokeMetrics({ checkedAt: 1, durationSeconds: 0, success: false, lastSuccessTimestamp: 0, failureCode: "raw student error" }), /bounded vocabulary/u)
  assert.throws(() => renderNightlySmokeMetrics({ checkedAt: 1, durationSeconds: 0, success: false, lastSuccessTimestamp: 0, failureCode: "suite_failed", failedFile: "student-private-marker" }), /test spec basename/u)
  assert.match(renderNightlySmokeMetrics({ checkedAt: 1, durationSeconds: 0, success: false, lastSuccessTimestamp: 0, failureCode: "suite_failed", failedFile: "student-admin.spec.mjs" }), /sis_keepalive_nightly_smoke_failed_file_info\{environment="test",file="student-admin\.spec\.mjs"\} 1/u)
  assert.match(renderNightlySmokeMetrics({ checkedAt: 1, durationSeconds: 0, success: true, lastSuccessTimestamp: 1, failureCode: "none", noExternalMessagesVerified: true }), /sis_keepalive_nightly_smoke_no_external_message_proof\{environment="test"\} 1/u)
  assert.throws(() => renderNightlySmokeMetrics({ checkedAt: 1, durationSeconds: 0, success: false, lastSuccessTimestamp: 0, failureCode: "unbounded-provider-response" }), /bounded vocabulary/u)
})

test("nightly smoke metrics replace their prior snapshot atomically", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sis-keepalive-nightly-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, "nightly.prom")
  writeMetricsAtomically(file, "first\n")
  writeMetricsAtomically(file, "second\n")
  assert.equal(fs.readFileSync(file, "utf8"), "second\n")
  assert.deepEqual(fs.readdirSync(directory), ["nightly.prom"])
})

test("nightly systemd service pins the test environment and does not block required provider resources", () => {
  const servicePath = path.resolve("ops/monitoring/systemd/sis-keepalive-nightly-smoke-test.service")
  const service = fs.readFileSync(servicePath, "utf8")
  assert.match(service, /^Environment=SIS_KEEPALIVE_NO_EXTERNAL_MESSAGES=1$/mu)
  assert.match(service, /^Environment=PATH=\/home\/eagles\/\.nvm\/versions\/node\/v22\.22\.1\/bin:/mu)
  assert.match(service, /^User=eagles$/mu)
  assert.match(service, /^Group=eagles$/mu)
  assert.doesNotMatch(service, /^IPAddressDeny=/mu)
})
