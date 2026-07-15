import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  normalizeHtmlSelfClosingFiles,
  normalizeHtmlSelfClosingMarkup,
} from "../tools/normalize-html-self-closing.mjs"

const packageJsonPath = path.resolve(process.cwd(), "package.json")
const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"))
const scriptPath = path.resolve(process.cwd(), "tools/normalize-html-self-closing.mjs")

test("package.json exposes an HTML self-closing normalization script", () => {
  assert.equal(packageJson.scripts["html:normalize-self-closing"], "node tools/normalize-html-self-closing.mjs")
})

test("normalizeHtmlSelfClosingMarkup removes spaced self-closing void tags", () => {
  const source = '<meta charset="utf-8" />\n<link rel="preload" href="/style.css" as="style" />\n'
  const normalized = normalizeHtmlSelfClosingMarkup(source)

  assert.equal(normalized, '<meta charset="utf-8">\n<link rel="preload" href="/style.css" as="style">\n')
})

test("normalizeHtmlSelfClosingMarkup preserves markup between svg tags", () => {
  const source = '<meta charset="utf-8" />\n<svg><path d="M0 0" /></svg>\n<img src="logo.png" />\n'
  const normalized = normalizeHtmlSelfClosingMarkup(source)

  assert.equal(normalized, '<meta charset="utf-8">\n<svg><path d="M0 0" /></svg>\n<img src="logo.png">\n')
})

test("normalizeHtmlSelfClosingFiles rewrites html targets in place", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sis-html-normalizer-"))
  try {
    const sourceDir = path.join(tempDir, "web-asset", "admin")
    const nestedSourceDir = path.join(tempDir, "dev", "tabulatorz", "test", "e2e")
    const backupDir = path.join(tempDir, "backups", "full-system", "snapshot", "app", "web-asset")
    const docsDir = path.join(tempDir, "docs")
    await fs.mkdir(sourceDir, { recursive: true })
    await fs.mkdir(nestedSourceDir, { recursive: true })
    await fs.mkdir(backupDir, { recursive: true })
    await fs.mkdir(docsDir, { recursive: true })

    const sourceHtmlPath = path.join(sourceDir, "sample.html")
    const nestedSourceHtmlPath = path.join(nestedSourceDir, "index.html")
    const backupHtmlPath = path.join(backupDir, "backup.html")
    const docsHtmlPath = path.join(docsDir, "README.html")
    const txtPath = path.join(sourceDir, "sample.txt")
    await fs.writeFile(sourceHtmlPath, '<meta charset="utf-8" />\n<img src="logo.png" />\n')
    await fs.writeFile(nestedSourceHtmlPath, '<link rel="stylesheet" href="/style.css" />\n')
    await fs.writeFile(backupHtmlPath, '<meta charset="utf-8" />\n')
    await fs.writeFile(docsHtmlPath, '<meta charset="utf-8" />\n')
    await fs.writeFile(txtPath, "leave this /> alone\n")

    const changedFiles = await normalizeHtmlSelfClosingFiles([], { cwd: tempDir })

    assert.deepEqual(changedFiles, [nestedSourceHtmlPath, sourceHtmlPath])
    assert.equal(await fs.readFile(sourceHtmlPath, "utf8"), '<meta charset="utf-8">\n<img src="logo.png">\n')
    assert.equal(await fs.readFile(nestedSourceHtmlPath, "utf8"), '<link rel="stylesheet" href="/style.css">\n')
    assert.equal(await fs.readFile(backupHtmlPath, "utf8"), '<meta charset="utf-8" />\n')
    assert.equal(await fs.readFile(docsHtmlPath, "utf8"), '<meta charset="utf-8" />\n')
    assert.equal(await fs.readFile(txtPath, "utf8"), "leave this /> alone\n")
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("normalizeHtmlSelfClosing CLI prints the roots it scans", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sis-html-normalizer-cli-"))
  try {
    const sourceDir = path.join(tempDir, "web-asset", "admin")
    const sourceRoot = path.join(tempDir, "web-asset")
    const nestedSourceDir = path.join(tempDir, "dev", "tabulatorz", "test", "e2e")
    await fs.mkdir(sourceDir, { recursive: true })
    await fs.mkdir(nestedSourceDir, { recursive: true })

    const sourceHtmlPath = path.join(sourceDir, "sample.html")
    const nestedSourceHtmlPath = path.join(nestedSourceDir, "index.html")
    await fs.writeFile(sourceHtmlPath, '<meta charset="utf-8" />\n')
    await fs.writeFile(nestedSourceHtmlPath, '<link rel="stylesheet" href="/style.css" />\n')

    const output = execFileSync(process.execPath, [scriptPath], {
      cwd: tempDir,
      encoding: "utf8",
    })

    assert.match(output, /Scanning roots:/)
    assert.match(output, new RegExp(`- ${sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
    assert.match(output, new RegExp(`- ${nestedSourceDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
    assert.match(output, /Normalized 2 HTML file\(s\)\./)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
