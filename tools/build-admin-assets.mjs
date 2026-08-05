// @ts-check

import fs from "node:fs/promises"
import crypto from "node:crypto"
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

// PERF-CONTRACT: STANDALONE-ASSET-TASKS
// Route-owned pages keep their application CSS/JS out of unrelated portal shells.
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
  ...[
    ["admin/grades-tabulator.css", "admin/grades-tabulator.min.css"],
    ["admin/student-enrollment.css", "admin/student-enrollment.min.css"],
    ["admin/report-card.css", "admin/report-card.min.css"],
    ["student/student-portal.css", "student/student-portal.min.css"],
    ["parent/parent-portal.css", "parent/parent-portal.min.css"],
  ].map(([source, output]) => ({
    kind: "css",
    source: path.join(REPO_ROOT, "web-asset", source),
    output: path.join(REPO_ROOT, "web-asset", output),
  })),
  ...[
    ["admin/grades-tabulator.js", "admin/grades-tabulator.min.js"],
    ["admin/student-enrollment.js", "admin/student-enrollment.min.js"],
    ["admin/report-card.js", "admin/report-card.min.js"],
    ["student/student-portal.js", "student/student-portal.min.js"],
    ["parent/parent-portal.js", "parent/parent-portal.min.js"],
  ].map(([source, output]) => ({
    kind: "js",
    source: path.join(REPO_ROOT, "web-asset", source),
    output: path.join(REPO_ROOT, "web-asset", output),
    mapOutput: path.join(REPO_ROOT, "web-asset", `${output}.map`),
  })),
]

const ADMIN_THEME_OUTPUT = path.join(REPO_ROOT, "web-asset/admin/admin-portal-theme.css")
const ADMIN_THEME_MIN_OUTPUT = path.join(REPO_ROOT, "web-asset/admin/admin-portal-theme.min.css")
const ADMIN_APP_CSS_OUTPUT = path.join(REPO_ROOT, "web-asset/admin/student-admin.min.css")
const ADMIN_APP_JS_OUTPUT = path.join(REPO_ROOT, "web-asset/admin/student-admin.min.js")

// PERF-CONTRACT: ADMIN-THEME-SPLIT
// Keep the shared source authoritative. The admin theme retains global rules,
// admin selectors, and mixed selectors; parent/student-only rules stay out of
// the admin critical path. Add a selector here only with authenticated visual
// and Lighthouse proof that it belongs in the dashboard shell.
const NON_ADMIN_PORTAL_PAGE_RE = /\b(?:student|parent|portal-hub|grades-tabulator)-portal-page\b/u

/**
 * @param {import("postcss").Container} container
 * @returns {import("postcss").ChildNode[]}
 */
function extractAdminThemeChildren(container) {
  /** @type {import("postcss").ChildNode[]} */
  const kept = []
  for (const node of container.nodes ?? []) {
    if (node.type === "rule") {
      if (!NON_ADMIN_PORTAL_PAGE_RE.test(node.selector) || node.selector.includes("admin-portal-page")) {
        kept.push(node.clone())
      }
      continue
    }
    if (node.type !== "atrule" || !node.nodes) {
      kept.push(node.clone())
      continue
    }
    const children = extractAdminThemeChildren(node)
    if (children.length === 0) continue
    kept.push(node.clone({ nodes: children }))
  }
  return kept
}

/** @param {string} source */
function buildAdminThemeSource(source) {
  const root = postcss.parse(source)
  return `${postcss.root({ nodes: extractAdminThemeChildren(root) }).toString()}\n`
}

const CRITICAL_CSS_TASK = {
  html: path.join(REPO_ROOT, "web-asset/admin/student-admin.html"),
  sources: [
    path.join(REPO_ROOT, "web-asset/shared/portal-theme.css"),
    path.join(REPO_ROOT, "web-asset/admin/student-admin.css"),
  ],
  output: path.join(REPO_ROOT, "web-asset/admin/student-admin.critical.css"),
}
// PERF-CONTRACT: ADMIN-ASSET-PARITY
// Critical CSS and generated admin assets must remain derived from source.
// Do not bypass this build path or edit generated outputs as the source of truth.
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

/** @param {string} content */
function assetVersion(content) {
  return `sha256-${crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)}`
}

/**
 * Keep cache-busting tokens coupled to generated content. A fixed token lets
 * an already-open admin session run an obsolete application bundle after a
 * sync, even though source/runtime hashes are otherwise in parity.
 * @param {string} html
 * @param {{css: string, js: string}} assets
 */
function renderAdminAssetVersions(html, assets) {
  const replacements = [
    [/(\/web-asset\/admin\/student-admin\.min\.css)\?v=[^"']+/gu, `$1?v=${assetVersion(assets.css)}`],
    [/(\/web-asset\/admin\/student-admin\.min\.js)\?v=[^"']+/gu, `$1?v=${assetVersion(assets.js)}`],
  ]
  return replacements.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), html)
}

/**
 * @param {string} sourcePath
 * @returns {Promise<{code: string, map: string}>}
 */
async function buildAdminCss(sourcePath) {
  const source = await fs.readFile(sourcePath, "utf8")
  const minifySelectors = sourcePath === path.join(REPO_ROOT, "web-asset/admin/student-admin.css")
  const removeReplacedPerformanceTableRules = sourcePath === path.join(REPO_ROOT, "web-asset/admin/student-admin.css")
  const processor = postcss([
    ...(removeReplacedPerformanceTableRules ? [{
      postcssPlugin: "sis-remove-replaced-performance-table-rules",
      Once(root) {
        root.walkRules((rule) => {
          if (rule.selector?.includes(".performance-engagement-table")) rule.remove()
        })
      },
    }] : []),
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

  const sharedThemeSource = await fs.readFile(
    path.join(REPO_ROOT, "web-asset/shared/portal-theme.css"),
    "utf8",
  )
  const adminThemeSource = buildAdminThemeSource(sharedThemeSource)
  if (checkOnly) {
    if (await readFileIfExists(ADMIN_THEME_OUTPUT) !== adminThemeSource) {
      staleFiles.push(path.relative(REPO_ROOT, ADMIN_THEME_OUTPUT))
    }
  } else if (await writeFileIfChanged(ADMIN_THEME_OUTPUT, adminThemeSource)) {
    changedFiles.push(path.relative(REPO_ROOT, ADMIN_THEME_OUTPUT))
  }
  const adminThemeMinified = await buildAdminCss(ADMIN_THEME_OUTPUT)
  if (checkOnly) {
    if (await readFileIfExists(ADMIN_THEME_MIN_OUTPUT) !== adminThemeMinified.code) {
      staleFiles.push(path.relative(REPO_ROOT, ADMIN_THEME_MIN_OUTPUT))
    }
  } else if (await writeFileIfChanged(ADMIN_THEME_MIN_OUTPUT, adminThemeMinified.code)) {
    changedFiles.push(path.relative(REPO_ROOT, ADMIN_THEME_MIN_OUTPUT))
  }

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
  } else if (await writeFileIfChanged(CRITICAL_CSS_TASK.output, criticalCss)) {
    changedFiles.push(path.relative(REPO_ROOT, CRITICAL_CSS_TASK.output))
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

  const versionedHtml = renderAdminAssetVersions(criticalHtml, {
    css: await fs.readFile(ADMIN_APP_CSS_OUTPUT, "utf8"),
    js: await fs.readFile(ADMIN_APP_JS_OUTPUT, "utf8"),
  })
  if (checkOnly) {
    const currentHtml = await readFileIfExists(CRITICAL_CSS_TASK.html)
    if (currentHtml !== versionedHtml) staleFiles.push(path.relative(REPO_ROOT, CRITICAL_CSS_TASK.html))
  } else if (await writeFileIfChanged(CRITICAL_CSS_TASK.html, versionedHtml)) {
    changedFiles.push(path.relative(REPO_ROOT, CRITICAL_CSS_TASK.html))
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
