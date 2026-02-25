#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"

function printHelp() {
  console.log(`Usage: node tools/db-restore-failsafe.mjs [options]

Options:
  --file <path|latest>       Backup file path, or "latest" (default: latest)
  --output-dir <dir>         Backup directory for latest.json (default: backups/postgres)
  --database-url <url>       PostgreSQL connection URL (default: DATABASE_URL)
  --verify-only              Verify archive + checksum; do not restore
  --dry-run                  Print restore command and exit
  --yes                      Required for a real restore
  --clean                    Add --clean --if-exists to pg_restore
  --single-transaction       Add --single-transaction to pg_restore
  --help                     Show this help
`)
}

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
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
    file: "latest",
    outputDir: "",
    databaseUrl: "",
    verifyOnly: false,
    dryRun: false,
    yes: false,
    clean: false,
    singleTransaction: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]

    if (token === "--help" || token === "-h") {
      printHelp()
      process.exit(0)
    }

    if (token === "--file") {
      if (!next || next.startsWith("--")) throw new Error("Missing value for --file")
      args.file = next
      i += 1
      continue
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

    if (token === "--verify-only") {
      args.verifyOnly = true
      continue
    }

    if (token === "--dry-run") {
      args.dryRun = true
      continue
    }

    if (token === "--yes") {
      args.yes = true
      continue
    }

    if (token === "--clean") {
      args.clean = true
      continue
    }

    if (token === "--single-transaction") {
      args.singleTransaction = true
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

async function resolveBackupPath(fileArg, outputDir) {
  if (fileArg !== "latest") {
    return path.isAbsolute(fileArg) ? fileArg : path.resolve(fileArg)
  }

  const latestPath = path.join(outputDir, "latest.json")
  const latestRaw = await fsp.readFile(latestPath, "utf8")
  const latest = JSON.parse(latestRaw)
  const candidate = normalizeText(latest.backupPath || latest.backupFile || latest.backupFilename)
  if (!candidate) {
    throw new Error(`latest.json does not include backupPath/backupFile: ${latestPath}`)
  }
  return path.isAbsolute(candidate) ? candidate : path.resolve(outputDir, candidate)
}

async function readExpectedChecksum(backupPath) {
  const checksumPath = backupPath.replace(/\.dump$/u, ".sha256")
  const exists = await fsp
    .stat(checksumPath)
    .then((stat) => stat.isFile())
    .catch(() => false)
  if (!exists) return null

  const raw = await fsp.readFile(checksumPath, "utf8")
  const line = raw.split(/\r?\n/u)[0] || ""
  const match = line.match(/^([a-fA-F0-9]{64})\s+/u)
  if (!match) {
    throw new Error(`Invalid checksum format in ${checksumPath}`)
  }
  return match[1].toLowerCase()
}

function resolveConfig(args) {
  const outputDir = path.resolve(normalizeText(args.outputDir || process.env.DB_BACKUP_DIR || "backups/postgres"))
  const databaseUrl = normalizeText(args.databaseUrl || process.env.DATABASE_URL)

  if (!args.verifyOnly && !args.dryRun && !args.yes) {
    throw new Error("Real restore requires --yes")
  }

  if (!args.verifyOnly && !databaseUrl) {
    throw new Error("Missing DATABASE_URL. Set env var or pass --database-url.")
  }

  return {
    fileArg: args.file,
    outputDir,
    databaseUrl,
    verifyOnly: args.verifyOnly,
    dryRun: args.dryRun,
    clean: args.clean,
    singleTransaction: args.singleTransaction,
  }
}

async function main() {
  const parsedArgs = parseArgs(process.argv.slice(2))
  const config = resolveConfig(parsedArgs)

  await runCommand("pg_restore", ["--version"])

  const backupPath = await resolveBackupPath(config.fileArg, config.outputDir)
  const backupStat = await fsp.stat(backupPath).catch(() => null)
  if (!backupStat || !backupStat.isFile()) {
    throw new Error(`Backup dump not found: ${backupPath}`)
  }

  await runCommand("pg_restore", ["--list", backupPath])

  const expectedChecksum = await readExpectedChecksum(backupPath)
  if (expectedChecksum) {
    const actualChecksum = await sha256File(backupPath)
    if (actualChecksum.toLowerCase() !== expectedChecksum) {
      throw new Error(
        `Checksum mismatch for ${backupPath}. expected=${expectedChecksum} actual=${actualChecksum}`
      )
    }
  }

  if (config.verifyOnly) {
    console.log(`[ok] verified: ${backupPath}`)
    if (expectedChecksum) {
      console.log("[ok] checksum matches .sha256 sidecar")
    } else {
      console.log("[warn] no .sha256 sidecar found; archive structure still verified")
    }
    return
  }

  const restoreArgs = []
  if (config.clean) {
    restoreArgs.push("--clean", "--if-exists")
  }
  restoreArgs.push("--no-owner", "--no-privileges", "--exit-on-error")
  if (config.singleTransaction) {
    restoreArgs.push("--single-transaction")
  }
  restoreArgs.push("--dbname", config.databaseUrl, backupPath)

  if (config.dryRun) {
    console.log(
      `[dry-run] pg_restore ${restoreArgs
        .map((entry) => (entry === config.databaseUrl ? "<redacted DATABASE_URL>" : entry))
        .join(" ")}`
    )
    return
  }

  console.log(`[restore] database=${redactDatabaseUrl(config.databaseUrl)}`)
  console.log(`[restore] file=${backupPath}`)
  await runCommand("pg_restore", restoreArgs)
  console.log("[ok] restore completed")
}

main().catch((error) => {
  console.error(`db-restore-failsafe failed: ${error.message}`)
  process.exit(1)
})
