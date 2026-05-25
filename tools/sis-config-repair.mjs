#!/usr/bin/env node
// @ts-check

import { ensureSisConfigLoaded } from "../src/modules/admin/sis-config-store.mjs"

async function main() {
  try {
    const snapshot = await ensureSisConfigLoaded({ refresh: true })
    console.log(
      `[sis-config-repair] synced ${snapshot.filePath} from ${snapshot.source || "file"} at ${snapshot.updatedAt || "<unknown>"}`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[sis-config-repair] failed: ${message}`)
    process.exitCode = 1
  }
}

await main()
