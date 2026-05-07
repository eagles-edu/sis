// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

import cssnano from "cssnano"
import postcss from "postcss"

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
  },
  {
    kind: "css",
    source: path.join(REPO_ROOT, "web-asset/shared/portal-theme.css"),
    output: path.join(REPO_ROOT, "web-asset/shared/portal-theme.min.css"),
  },
]

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
 * @param {string} sourcePath
 * @returns {Promise<string>}
 */
async function buildAdminCss(sourcePath) {
  const source = await fs.readFile(sourcePath, "utf8")
  const processor = postcss([
    cssnano({
      preset: [
        "default",
        {
          minifySelectors: false,
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

  return result.css
}

/**
 * @param {string} sourcePath
 * @returns {Promise<string>}
 */
async function buildAdminJs(sourcePath) {
  const source = await fs.readFile(sourcePath, "utf8")
  const result = uglifyMinify(source, {
    compress: {
      passes: 2,
    },
    mangle: true,
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

  return result.code
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

  for (const task of ADMIN_ASSET_TASKS) {
    const dependencyPaths = [task.source, ...ADMIN_ASSET_SHARED_DEPENDENCIES]
    const outputFresh = await isOutputFresh(dependencyPaths, task.output)
    if (!checkOnly && outputFresh) {
      continue
    }

    const next =
      task.kind === "css" ? await buildAdminCss(task.source) : await buildAdminJs(task.source)

    if (checkOnly) {
      const current = await readFileIfExists(task.output)
      if (current !== next) {
        staleFiles.push(path.relative(REPO_ROOT, task.output))
      }
      continue
    }

    if (await writeFileIfChanged(task.output, next)) {
      changedFiles.push(path.relative(REPO_ROOT, task.output))
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

await main()
