import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"

function waitForPortAnnouncement(child, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for exercise-mailer startup"))
    }, timeoutMs)
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)
      child.stdout?.off("data", onStdout)
      child.stderr?.off("data", onStderr)
      child.off("exit", onExit)
    }

    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const succeed = (port) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(port)
    }

    const parsePort = (chunk) => {
      const text = String(chunk || "")
      const match = text.match(/exercise-mailer listening on [^:]+:(\d+)/i)
      if (!match) return
      const port = Number.parseInt(String(match[1]), 10)
      if (Number.isFinite(port) && port > 0) succeed(port)
    }

    const onStdout = (chunk) => parsePort(chunk)
    const onStderr = (chunk) => parsePort(chunk)
    const onExit = (code, signal) => {
      fail(new Error(`exercise-mailer exited before startup (code=${code}, signal=${signal})`))
    }

    child.stdout?.on("data", onStdout)
    child.stderr?.on("data", onStderr)
    child.on("exit", onExit)
  })
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return
  child.kill("SIGTERM")
  await new Promise((resolve) => child.once("exit", resolve))
}

test("SMTP relay mode starts without SMTP auth credentials", async () => {
  const child = spawn("node", ["server/exercise-mailer.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      SIS_ENV_FILE: ".env.dev",
      EXERCISE_MAILER_HOST: "127.0.0.1",
      EXERCISE_MAILER_PORT: "8794",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "2526",
      SMTP_SECURE: "false",
      SMTP_AUTH_MODE: "none",
      SMTP_USER: "",
      SMTP_PASS: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  let port
  try {
    port = await waitForPortAnnouncement(child)
    const response = await fetch(`http://127.0.0.1:${port}/healthz`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.status, "ok")
  } finally {
    await stopChild(child)
  }
})
