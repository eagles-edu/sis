// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

import cssnano from "cssnano"
import postcss from "postcss"
import { extractCriticalCss } from "./extract-critical-css.mjs"

const require = createRequire(import.meta.url)
const { minify: uglifyMinify } = require("uglify-js")

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..")

const ADMIN_ASSET_TASKS = [
  {
    kind: "css",
    source: path.join(REPO_ROOT, "web-asset/admin/student-admin.css"),
    output: path.join(REPO_ROOT, "web-asset/admin/student-admin.min.css"),
  },
  {
    kind: "js",
    source: path.join(REPO_ROOT, "web-asset/admin/student-admin.js"),
    output: path.join(REPO_ROOT, "web-asset/admin/student-admin.min.js"),
    mapOutput: path.join(REPO_ROOT, "web-asset/admin/student-admin.min.js.map"),
  },
  {
    kind: "css",
    source: path.join(REPO_ROOT, "web-asset/shared/portal-theme.css"),
    output: path.join(REPO_ROOT, "web-asset/shared/portal-theme.min.css"),
  },
]

const CRITICAL_CSS_TASK = {
  html: path.join(REPO_ROOT, "web-asset/admin/student-admin.html"),
  sources: [
    path.join(REPO_ROOT, "web-asset/shared/portal-theme.css"),
    path.join(REPO_ROOT, "web-asset/admin/student-admin.css"),
  ],
  output: path.join(REPO_ROOT, "web-asset/admin/student-admin.critical.css"),
}
const CRITICAL_CSS_MARKER_RE = /(?:<!-- ADMIN_CRITICAL_CSS -->|<style id="admin-critical-css">[\s\S]*?<\/style>)/u

const ADMIN_ASSET_SHARED_DEPENDENCIES = [
  path.join(REPO_ROOT, "package.json"),
  path.join(REPO_ROOT, "package-lock.json"),
  path.join(REPO_ROOT, "tools/build-admin-assets.mjs"),
]

/**
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
async function readFileIfExists(filePath) {
  return fs.readFile(filePath, "utf8").catch(() => null)
}

/**
 * @param {string} filePath
 * @returns {Promise<number>}
 */
async function statMtimeMs(filePath) {
  const stat = await fs.stat(filePath).catch(() => null)
  return stat ? stat.mtimeMs : 0
}

/**
 * @param {string[]} filePaths
 * @returns {Promise<number>}
 */
async function newestMtimeMs(filePaths) {
  let newest = 0
  for (const filePath of filePaths) {
    const mtimeMs = await statMtimeMs(filePath)
    if (mtimeMs > newest) {
      newest = mtimeMs
    }
  }
  return newest
}

/**
 * @param {string} filePath
 * @param {string} next
 * @returns {Promise<boolean>}
 */
async function writeFileIfChanged(filePath, next) {
  const current = await readFileIfExists(filePath)
  if (current === next) {
    return false
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, next, "utf8")
  return true
}

/**
 * @param {string} html
 * @param {string} criticalCss
 * @returns {string}
 */
function renderCriticalCssHtml(html, criticalCss) {
  const block = `<style id="admin-critical-css">\n/* ADMIN_CRITICAL_CSS_START */\n${criticalCss}/* ADMIN_CRITICAL_CSS_END */\n</style>`
  if (!CRITICAL_CSS_MARKER_RE.test(html)) {
    throw new Error("admin HTML is missing the critical CSS marker")
  }
  return html.replace(CRITICAL_CSS_MARKER_RE, block)
}

/**
 * @param {string} sourcePath
 * @returns {Promise<{code: string, map: string}>}
 */
async function buildAdminCss(sourcePath) {
  const source = await fs.readFile(sourcePath, "utf8")
  const minifySelectors = sourcePath === path.join(REPO_ROOT, "web-asset/admin/student-admin.css")
  const processor = postcss([
    cssnano({
      preset: [
        "default",
        {
          minifySelectors,
        },
      ],
    }),
  ])
  const result = await processor.process(source, {
    from: sourcePath,
    to: sourcePath.replace(/\.css$/u, ".min.css"),
  })

  if (result.warnings().length > 0) {
    for (const warning of result.warnings()) {
      console.warn(`[cssnano] ${warning.toString()}`)
    }
  }

  return { code: result.css, map: "" }
}

/**
 * @param {string} sourcePath
 * @returns {Promise<{code: string, map: string}>}
 */
async function buildAdminJs(sourcePath) {
  const outputPath = sourcePath.replace(/\.js$/u, ".min.js")
  const source = await fs.readFile(sourcePath, "utf8")
  const result = uglifyMinify(source, {
    compress: {
      passes: 2,
    },
    mangle: true,
    sourceMap: {
      filename: path.basename(outputPath),
      url: `${path.basename(outputPath)}.map`,
    },
    output: {
      comments: false,
    },
  })

  if (result.error) {
    throw result.error
  }

  if (!result.code) {
    throw new Error(`uglify-js did not return output for ${sourcePath}`)
  }

  return {
    code: `${result.code}\n//# sourceMappingURL=${path.basename(outputPath)}.map\n`,
    map: result.map || "",
  }
}

/**
 * @param {string[]} dependencyPaths
 * @param {string} outputPath
 * @returns {Promise<boolean>}
 */
async function isOutputFresh(dependencyPaths, outputPath) {
  const outputStat = await fs.stat(outputPath).catch(() => null)
  if (!outputStat) {
    return false
  }
  const newestDependencyMtime = await newestMtimeMs(dependencyPaths)
  return outputStat.mtimeMs >= newestDependencyMtime
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const args = new Set(process.argv.slice(2))
  const checkOnly = args.has("--check")
  const changedFiles = []
  const staleFiles = []

  const criticalHtmlSource = await fs.readFile(CRITICAL_CSS_TASK.html, "utf8")
  const criticalResults = []
  for (const sourcePath of CRITICAL_CSS_TASK.sources) {
    criticalResults.push(extractCriticalCss(await fs.readFile(sourcePath, "utf8"), criticalHtmlSource))
  }
  const criticalCss = `${criticalResults.map((result) => result.css).filter(Boolean).join("\n")}\n`
  const criticalHtml = renderCriticalCssHtml(criticalHtmlSource, criticalCss)
  if (checkOnly) {
    const currentCriticalCss = await readFileIfExists(CRITICAL_CSS_TASK.output)
    if (currentCriticalCss !== criticalCss) staleFiles.push(path.relative(REPO_ROOT, CRITICAL_CSS_TASK.output))
    const currentHtml = await readFileIfExists(CRITICAL_CSS_TASK.html)
    if (currentHtml !== criticalHtml) staleFiles.push(path.relative(REPO_ROOT, CRITICAL_CSS_TASK.html))
  } else if (await writeFileIfChanged(CRITICAL_CSS_TASK.output, criticalCss)) {
    changedFiles.push(path.relative(REPO_ROOT, CRITICAL_CSS_TASK.output))
  }
  if (!checkOnly && await writeFileIfChanged(CRITICAL_CSS_TASK.html, criticalHtml)) {
    changedFiles.push(path.relative(REPO_ROOT, CRITICAL_CSS_TASK.html))
  }

  for (const task of ADMIN_ASSET_TASKS) {
    const dependencyPaths = [task.source, ...ADMIN_ASSET_SHARED_DEPENDENCIES]
    const outputPaths = [task.output, task.mapOutput].filter(Boolean)
    const outputFresh = (await Promise.all(outputPaths.map((outputPath) => isOutputFresh(dependencyPaths, outputPath)))).every(Boolean)
    if (!checkOnly && outputFresh) {
      continue
    }

    const next =
      task.kind === "css" ? await buildAdminCss(task.source) : await buildAdminJs(task.source)

    if (checkOnly) {
      const current = await readFileIfExists(task.output)
      if (current !== next.code) {
        staleFiles.push(path.relative(REPO_ROOT, task.output))
      }
      if (task.mapOutput) {
        const currentMap = await readFileIfExists(task.mapOutput)
        if (currentMap !== next.map) staleFiles.push(path.relative(REPO_ROOT, task.mapOutput))
      }
      continue
    }

    if (await writeFileIfChanged(task.output, next.code)) {
      changedFiles.push(path.relative(REPO_ROOT, task.output))
    }
    if (task.mapOutput && await writeFileIfChanged(task.mapOutput, next.map)) {
      changedFiles.push(path.relative(REPO_ROOT, task.mapOutput))
    }
  }

  if (checkOnly) {
    if (staleFiles.length > 0) {
      throw new Error(`admin asset outputs are stale:\n- ${staleFiles.join("\n- ")}`)
    }
    console.log("Admin asset outputs are up to date.")
    return
  }

  if (changedFiles.length === 0) {
    console.log("Admin asset outputs are already up to date.")
    return
  }

  for (const filePath of changedFiles) {
    console.log(filePath)
  }
  console.log(`Updated ${changedFiles.length} admin asset file(s).`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
