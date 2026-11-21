import { createConnection } from "node:net"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const DEV_API_LISTENER_HOST = "127.0.0.1"
export const DEV_API_LISTENER_PORT = 8788
export const DEV_API_LISTENER_TIMEOUT_MS = 60_000
export const DEV_API_LISTENER_POLL_INTERVAL_MS = 1_000
export const DEV_API_LISTENER_PROBE_TIMEOUT_MS = 1_000

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

export function probeDevApiListener({
  host = DEV_API_LISTENER_HOST,
  port = DEV_API_LISTENER_PORT,
  timeoutMs = DEV_API_LISTENER_PROBE_TIMEOUT_MS,
  connect = createConnection,
} = {}) {
  return new Promise((resolve) => {
    let socket
    let settled = false

    const finish = (isReady) => {
      if (settled) return
      settled = true
      if (socket) {
        socket.removeAllListeners()
        socket.destroy()
      }
      resolve(isReady)
    }

    try {
      socket = connect({ host, port })
      socket.once("connect", () => finish(true))
      socket.once("error", () => finish(false))
      socket.setTimeout(timeoutMs, () => finish(false))
    } catch {
      finish(false)
    }
  })
}

export async function waitForDevApiListener({
  host = DEV_API_LISTENER_HOST,
  port = DEV_API_LISTENER_PORT,
  timeoutMs = DEV_API_LISTENER_TIMEOUT_MS,
  pollIntervalMs = DEV_API_LISTENER_POLL_INTERVAL_MS,
  probeTimeoutMs = DEV_API_LISTENER_PROBE_TIMEOUT_MS,
  now = Date.now,
  pause = sleep,
  probe = probeDevApiListener,
} = {}) {
  const deadline = now() + timeoutMs

  while (now() < deadline) {
    if (await probe({ host, port, timeoutMs: probeTimeoutMs })) return true

    const remainingMs = deadline - now()
    if (remainingMs <= 0) break
    await pause(Math.min(pollIntervalMs, remainingMs))
  }

  return false
}

async function run() {
  const ready = await waitForDevApiListener()
  if (!ready) {
    process.stderr.write("Dev API listener did not become ready before monitor preflight timeout.\n")
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ""
if (invokedPath && import.meta.url === invokedPath) await run()
