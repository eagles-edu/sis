import assert from "node:assert/strict"
import fs from "node:fs"
import net from "node:net"
import test from "node:test"
import { probeDevApiListener, waitForDevApiListener } from "../tools/wait-for-dev-api-listener.mjs"

const DEV_MONITOR_UNITS = new Map([
  ["sis-engagement-monitor-dev.service", 90],
  ["sis-parent-profile-monitor-dev.service", 180],
  ["sis-grade-feed-monitor-dev.service", 120],
  ["sis-library-monitor-dev.service", 330],
  ["sis-news-monitor-dev.service", 150],
])

test("the dev API listener probe succeeds only after a TCP connection is accepted", async () => {
  const server = net.createServer((socket) => socket.end())
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  try {
    const address = server.address()
    assert.equal(typeof address, "object")
    assert.equal(await probeDevApiListener({ port: address.port, timeoutMs: 100 }), true)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test("dev API readiness retries transient refusal until the listener opens", async () => {
  let currentTime = 0
  let attempts = 0
  const ready = await waitForDevApiListener({
    timeoutMs: 50,
    pollIntervalMs: 10,
    now: () => currentTime,
    pause: async (durationMs) => { currentTime += durationMs },
    probe: async () => {
      attempts += 1
      return attempts === 3
    },
  })

  assert.equal(ready, true)
  assert.equal(attempts, 3)
})

test("dev API readiness fails within its bound when the listener stays unavailable", async () => {
  let currentTime = 0
  let attempts = 0
  const ready = await waitForDevApiListener({
    timeoutMs: 25,
    pollIntervalMs: 10,
    now: () => currentTime,
    pause: async (durationMs) => { currentTime += durationMs },
    probe: async () => {
      attempts += 1
      return false
    },
  })

  assert.equal(ready, false)
  assert.equal(attempts, 3)
})

test("every dev API-backed monitor waits for the local listener with a bounded unit deadline", () => {
  for (const [unitName, timeoutSeconds] of DEV_MONITOR_UNITS) {
    const service = fs.readFileSync(new URL(`../ops/monitoring/systemd/${unitName}`, import.meta.url), "utf8")
    assert.match(service, /^Type=oneshot$/mu, unitName)
    assert.match(service, /^ExecStartPre=\/home\/eagles\/\.nvm\/versions\/node\/v22\.22\.1\/bin\/node tools\/wait-for-dev-api-listener\.mjs$/mu, unitName)
    assert.match(service, new RegExp(`^TimeoutStartSec=${timeoutSeconds}s$`, "mu"), unitName)
    assert.doesNotMatch(service, /\/home\/(?:admin|test)\.eagles\.edu\.vn|\.env(?:\.test)?(?:\s|$)/u, unitName)
  }
})
