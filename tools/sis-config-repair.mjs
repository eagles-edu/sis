#!/usr/bin/env node
// @ts-check

import { ensureSisConfigLoaded } from "../src/modules/admin/sis-config-store.mjs"

const timestamp = () => new Date().toISOString()

async function main() {
  const snapshot = await ensureSisConfigLoaded({ refresh: true })
  console.log(
    `[${timestamp()}] [sis-config-repair] synced ${snapshot.filePath} from ${snapshot.source || "file"} at ${snapshot.updatedAt || "<unknown>"}`,
  )
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[${timestamp()}] [sis-config-repair] failed: ${message}`)
  process.exitCode = 1
})
