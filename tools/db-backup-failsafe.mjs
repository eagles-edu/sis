#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"

const DAY_MS = 24 * 60 * 60 * 1000

function printHelp() {
  console.log(`Usage: node tools/db-backup-failsafe.mjs [options]

Options:
  --output-dir <dir>         Backup directory (default: backups/postgres)
  --database-url <url>       PostgreSQL connection URL (default: DATABASE_URL)
  --retention-days <n>       Delete backups older than n days (default: 30)
  --keep-min <n>             Always keep at least n newest backups (default: 14)
  --stale-lock-minutes <n>   Replace stale lock older than n minutes (default: 180)
  --dry-run                  Print actions without writing/deleting files
  --no-verify                Skip pg_restore --list verification step
  --no-prune                 Skip retention cleanup
  --verbose                  Print command details
  --help                     Show this help
`)
}

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function toPositiveInt(value, fallback) {
  const text = normalizeText(value)
  if (!text) return fallback
  const parsed = Number.parseInt(text, 10)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  return fallback
}

function formatTimestamp(date) {
  const yyyy = String(date.getUTCFullYear())
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
  const hh = String(date.getUTCHours()).padStart(2, "0")
  const min = String(date.getUTCMinutes()).padStart(2, "0")
  const ss = String(date.getUTCSeconds()).padStart(2, "0")
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}Z`
}

function redactDatabaseUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.password) parsed.password = "***"
    if (parsed.username) parsed.username = "***"
    return parsed.toString()
  } catch {
    return "<unparseable DATABASE_URL>"
  }
}

function parseArgs(argv) {
  const args = {
    outputDir: "",
    databaseUrl: "",
    retentionDays: "",
    keepMin: "",
    staleLockMinutes: "",
    dryRun: false,
    verify: true,
    prune: true,
    verbose: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]

    if (token === "--help" || token === "-h") {
      printHelp()
      process.exit(0)
    }

    if (token === "--output-dir") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --output-dir")
      args.outputDir = next
      i += 1
      continue
    }

    if (token === "--database-url") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --database-url")
      args.databaseUrl = next
      i += 1
      continue
    }

    if (token === "--retention-days") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --retention-days")
      args.retentionDays = next
      i += 1
      continue
    }

    if (token === "--keep-min") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --keep-min")
      args.keepMin = next
      i += 1
      continue
    }

    if (token === "--stale-lock-minutes") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --stale-lock-minutes")
      args.staleLockMinutes = next
      i += 1
      continue
    }

    if (token === "--dry-run") {
      args.dryRun = true
      continue
    }

    if (token === "--no-verify") {
      args.verify = false
      continue
    }

    if (token === "--no-prune") {
      args.prune = false
      continue
    }

    if (token === "--verbose") {
      args.verbose = true
      continue
    }

    throw new Error(`Unknown option: ${token}`)
  }

  return args
}

function runCommand(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8")
      })
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8")
      })
    }

    child.on("error", (error) => {
      reject(new Error(`Unable to execute ${command}: ${error.message}`))
    })

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      const suffix = signal ? ` (signal ${signal})` : ""
      const details = stderr.trim() || stdout.trim()
      reject(new Error(`${command} exited with code ${code}${suffix}${details ? `: ${details}` : ""}`))
    })
  })
}

async function ensureBinary(command) {
  await runCommand(command, ["--version"])
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256")
    const stream = fs.createReadStream(filePath)

    stream.on("error", reject)
    stream.on("data", (chunk) => {
      hash.update(chunk)
    })
    stream.on("end", () => {
      resolve(hash.digest("hex"))
    })
  })
}

async function writeTextAtomic(filePath, text) {
  const tmpPath = `${filePath}.tmp-${process.pid}`
  await fsp.writeFile(tmpPath, text, "utf8")
  await fsp.rename(tmpPath, filePath)
}

async function acquireLock(lockPath, staleMinutes) {
  const lockPayload = `${JSON.stringify(
    {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    },
    null,
    2
  )}\n`

  try {
    const handle = await fsp.open(lockPath, "wx")
    await handle.writeFile(lockPayload, "utf8")
    return handle
  } catch (error) {
    if (error?.code !== "EEXIST") throw error

    const lockStat = await fsp.stat(lockPath).catch(() => null)
    const staleMs = staleMinutes * 60 * 1000

    if (lockStat && Date.now() - lockStat.mtimeMs > staleMs) {
      const stalePath = `${lockPath}.stale-${formatTimestamp(new Date())}`
      await fsp.rename(lockPath, stalePath).catch(() => {})
      const handle = await fsp.open(lockPath, "wx")
      await handle.writeFile(lockPayload, "utf8")
      return handle
    }

    throw new Error(`Backup lock already exists at ${lockPath}`, { cause: error })
  }
}

async function releaseLock(lockHandle, lockPath) {
  if (lockHandle) {
    await lockHandle.close().catch(() => {})
  }
  await fsp.unlink(lockPath).catch(() => {})
}

function dumpNamePattern(fileName) {
  return /^postgres-\d{8}-\d{6}Z\.dump$/u.test(fileName)
}

async function pruneBackups(outputDir, retentionDays, keepMin, dryRun) {
  const cutoffMs = Date.now() - retentionDays * DAY_MS
  const entries = await fsp.readdir(outputDir, { withFileTypes: true })

  const dumps = []
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    if (!entry.isFile()) continue
    if (!dumpNamePattern(entry.name)) continue
    const fullPath = path.join(outputDir, entry.name)
    const stat = await fsp.stat(fullPath)
    dumps.push({
      path: fullPath,
      mtimeMs: stat.mtimeMs,
    })
  }

  dumps.sort((a, b) => b.mtimeMs - a.mtimeMs)

  const removed = []

  for (let i = 0; i < dumps.length; i += 1) {
    if (i < keepMin) continue
    const dump = dumps[i]
    if (dump.mtimeMs >= cutoffMs) continue

    const base = dump.path.slice(0, -".dump".length)
    const sidecars = [`${base}.sha256`, `${base}.json`]
    const targets = [dump.path, ...sidecars]

    if (!dryRun) {
      for (let j = 0; j < targets.length; j += 1) {
        await fsp.unlink(targets[j]).catch(() => {})
      }
    }

    removed.push(path.basename(dump.path))
  }

  return removed
}

async function verifyDump(dumpPath) {
  const { stdout } = await runCommand("pg_restore", ["--list", dumpPath])
  if (!stdout.trim()) {
    throw new Error(`pg_restore verification returned empty output for ${dumpPath}`)
  }
}

function resolveConfig(parsedArgs) {
  const databaseUrl = normalizeText(parsedArgs.databaseUrl || process.env.DATABASE_URL)
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL. Set env var or pass --database-url.")
  }

  return {
    outputDir: path.resolve(
      normalizeText(parsedArgs.outputDir || process.env.DB_BACKUP_DIR || "backups/postgres")
    ),
    databaseUrl,
    retentionDays: toPositiveInt(
      parsedArgs.retentionDays || process.env.DB_BACKUP_RETENTION_DAYS,
      30
    ),
    keepMin: toPositiveInt(parsedArgs.keepMin || process.env.DB_BACKUP_KEEP_MIN, 14),
    staleLockMinutes: toPositiveInt(
      parsedArgs.staleLockMinutes || process.env.DB_BACKUP_STALE_LOCK_MINUTES,
      180
    ),
    dryRun: parsedArgs.dryRun,
    verify: parsedArgs.verify,
    prune: parsedArgs.prune,
    verbose: parsedArgs.verbose,
  }
}

async function main() {
  const parsedArgs = parseArgs(process.argv.slice(2))
  const config = resolveConfig(parsedArgs)

  await fsp.mkdir(config.outputDir, { recursive: true })

  const lockPath = path.join(config.outputDir, ".backup.lock")
  let lockHandle = null
  let tmpDumpPath = ""

  try {
    lockHandle = await acquireLock(lockPath, config.staleLockMinutes)

    await ensureBinary("pg_dump")
    if (config.verify) {
      await ensureBinary("pg_restore")
    }

    const createdAt = new Date()
    const stamp = formatTimestamp(createdAt)
    const baseName = `postgres-${stamp}`
    const dumpPath = path.join(config.outputDir, `${baseName}.dump`)
    tmpDumpPath = `${dumpPath}.tmp`
    const checksumPath = path.join(config.outputDir, `${baseName}.sha256`)
    const metadataPath = path.join(config.outputDir, `${baseName}.json`)
    const manifestPath = path.join(config.outputDir, "manifest.jsonl")
    const latestPath = path.join(config.outputDir, "latest.json")

    const redactedUrl = redactDatabaseUrl(config.databaseUrl)

    if (config.verbose || config.dryRun) {
      console.log(`[backup] outputDir=${config.outputDir}`)
      console.log(`[backup] database=${redactedUrl}`)
      console.log(`[backup] verify=${config.verify} prune=${config.prune}`)
    }

    const dumpArgs = [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--file",
      tmpDumpPath,
      "--dbname",
      config.databaseUrl,
    ]

    if (config.dryRun) {
      console.log(
        `[dry-run] pg_dump --format=custom --no-owner --no-privileges --file ${tmpDumpPath} --dbname <redacted>`
      )
    } else {
      await runCommand("pg_dump", dumpArgs)
      await fsp.rename(tmpDumpPath, dumpPath)
    }

    let checksum = ""
    let sizeBytes = 0
    if (!config.dryRun) {
      if (config.verify) {
        await verifyDump(dumpPath)
      }
      const stat = await fsp.stat(dumpPath)
      sizeBytes = stat.size
      checksum = await sha256File(dumpPath)

      await writeTextAtomic(checksumPath, `${checksum}  ${path.basename(dumpPath)}\n`)
    } else if (config.verify) {
      console.log(`[dry-run] pg_restore --list ${dumpPath}`)
    }

    const metadata = {
      createdAt: createdAt.toISOString(),
      backupFile: path.basename(dumpPath),
      backupPath: dumpPath,
      outputDir: config.outputDir,
      checksumSha256: checksum,
      sizeBytes,
      verified: config.verify && !config.dryRun,
      databaseUrlRedacted: redactedUrl,
      retentionDays: config.retentionDays,
      keepMin: config.keepMin,
      toolVersion: "1",
    }

    if (!config.dryRun) {
      const metadataText = `${JSON.stringify(metadata, null, 2)}\n`
      await writeTextAtomic(metadataPath, metadataText)
      await fsp.appendFile(manifestPath, `${JSON.stringify(metadata)}\n`, "utf8")
      await writeTextAtomic(latestPath, metadataText)
    } else {
      console.log(`[dry-run] write metadata: ${metadataPath}`)
      console.log(`[dry-run] append manifest: ${manifestPath}`)
      console.log(`[dry-run] update latest pointer: ${latestPath}`)
    }

    let pruned = []
    if (config.prune) {
      pruned = await pruneBackups(config.outputDir, config.retentionDays, config.keepMin, config.dryRun)
    }

    if (config.dryRun) {
      if (pruned.length) {
        console.log(`[dry-run] would prune ${pruned.length} backups: ${pruned.join(", ")}`)
      } else {
        console.log("[dry-run] no backups match prune rules")
      }
      return
    }

    console.log(`[ok] backup: ${dumpPath}`)
    console.log(`[ok] checksum: ${checksum}`)
    console.log(`[ok] metadata: ${metadataPath}`)
    if (pruned.length) {
      console.log(`[ok] pruned backups: ${pruned.length}`)
    }
  } catch (error) {
    if (tmpDumpPath) {
      await fsp.unlink(tmpDumpPath).catch(() => {})
    }
    throw error
  } finally {
    await releaseLock(lockHandle, lockPath)
  }
}

main().catch((error) => {
  console.error(`db-backup-failsafe failed: ${error.message}`)
  process.exit(1)
})
