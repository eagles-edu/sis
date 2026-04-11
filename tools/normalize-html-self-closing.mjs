import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".cache",
  "coverage",
  "dist",
])

const DEFAULT_TARGETS = ["web-asset", path.join("dev", "tabulatorz", "test", "e2e")]

export function normalizeHtmlSelfClosingMarkup(source) {
  return source.replace(/ \/>/g, ">")
}

async function collectHtmlFilesFromTarget(targetPath, htmlFiles) {
  const stat = await fs.stat(targetPath).catch(() => null)
  if (!stat) {
    return
  }

  if (stat.isFile()) {
    if (targetPath.toLowerCase().endsWith(".html")) {
      htmlFiles.add(targetPath)
    }
    return
  }

  if (!stat.isDirectory()) {
    return
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true })
  for (const entry of entries) {
    const childPath = path.join(targetPath, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue
      }
      await collectHtmlFilesFromTarget(childPath, htmlFiles)
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      htmlFiles.add(childPath)
    }
  }
}

async function collectHtmlFiles(targets, cwd) {
  const htmlFiles = new Set()
  const searchTargets = targets.length > 0 ? targets : DEFAULT_TARGETS

  for (const target of searchTargets) {
    const resolvedTarget = path.resolve(cwd, target)
    await collectHtmlFilesFromTarget(resolvedTarget, htmlFiles)
  }

  return [...htmlFiles].sort()
}

function formatScanRoots(targets, cwd) {
  const searchTargets = targets.length > 0 ? targets : DEFAULT_TARGETS
  return searchTargets.map((target) => path.resolve(cwd, target))
}

export async function normalizeHtmlSelfClosingFiles(targets = [], options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const htmlFiles = await collectHtmlFiles(targets, cwd)
  const changedFiles = []

  for (const filePath of htmlFiles) {
    const original = await fs.readFile(filePath, "utf8")
    const normalized = normalizeHtmlSelfClosingMarkup(original)
    if (normalized === original) {
      continue
    }
    await fs.writeFile(filePath, normalized, "utf8")
    changedFiles.push(filePath)
  }

  return changedFiles
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
  const cwd = process.cwd()
  const scanRoots = formatScanRoots(args, cwd)

  console.log("Scanning roots:")
  for (const root of scanRoots) {
    console.log(`- ${root}`)
  }

  const changedFiles = await normalizeHtmlSelfClosingFiles(args)

  if (changedFiles.length === 0) {
    console.log("No HTML self-closing tags needed normalization.")
    return
  }

  for (const filePath of changedFiles) {
    console.log(filePath)
  }
  console.log(`Normalized ${changedFiles.length} HTML file(s).`)
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  await main()
}
