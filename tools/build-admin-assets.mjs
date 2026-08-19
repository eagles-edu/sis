// @ts-check

import fs from "node:fs/promises"
import crypto from "node:crypto"
import path from "node:path"
import process from "node:process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

import cssnano from "cssnano"
import postcss from "postcss"
import selectorParser from "postcss-selector-parser"
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
const PORTAL_THEME_COLORS_OUTPUT = path.join(REPO_ROOT, "web-asset/shared/portal-theme-colors.css")
const PORTAL_THEME_COLORS_MIN_OUTPUT = path.join(REPO_ROOT, "web-asset/shared/portal-theme-colors.min.css")
const STUDENT_PARENT_STRUCTURE_OUTPUT = path.join(REPO_ROOT, "web-asset/shared/student-parent-structure.css")
const STUDENT_PARENT_STRUCTURE_MIN_OUTPUT = path.join(REPO_ROOT, "web-asset/shared/student-parent-structure.min.css")
const STUDENT_PARENT_CRITICAL_SOURCE = path.join(REPO_ROOT, "web-asset/shared/student-parent-critical.css")
const STUDENT_PARENT_CRITICAL_OUTPUT = path.join(REPO_ROOT, "web-asset/shared/student-parent-critical.min.css")
const STUDENT_PARENT_PORTALS = [
  path.join(REPO_ROOT, "web-asset/student/student-portal.html"),
  path.join(REPO_ROOT, "web-asset/student/student-portal.css"),
  path.join(REPO_ROOT, "web-asset/student/student-portal.js"),
  path.join(REPO_ROOT, "web-asset/parent/parent-portal.html"),
  path.join(REPO_ROOT, "web-asset/parent/parent-portal.css"),
  path.join(REPO_ROOT, "web-asset/parent/parent-portal.js"),
]

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

const STUDENT_PARENT_PAGE_EXCLUSION_RE = /(?:admin-portal-page|portal-hub-page|student-points-page|grades-tabulator-page|report-card-page|enrollment-page|admin-portal|portal-hub|student-admin|admin-only|admin-panel|admin-card)/u
const studentParentSelectorParser = selectorParser((selectors) => {
  selectors.each((selector) => {
    if (STUDENT_PARENT_PAGE_EXCLUSION_RE.test(selector.toString())) selector.remove()
  })
})

/** @param {string} selector */
function filterStudentParentSelector(selector) {
  return studentParentSelectorParser.processSync(selector)
}

/**
 * @param {string} source
 * @returns {string}
 */
function buildPortalThemeColorsSource(source, extraTokens = []) {
  const sourceRoot = postcss.parse(source)
  const outputRoot = postcss.root()
  const lightTokens = postcss.rule({ selector: ":root" })
  const darkTokens = postcss.rule({ selector: 'html[data-theme="dark"]' })

  sourceRoot.walkRules((rule) => {
    if (rule.selector === ":root") {
      for (const node of rule.nodes ?? []) {
        if (node.type === "decl" && node.prop.startsWith("--")) lightTokens.append(node.clone())
      }
    }
    if (rule.selector.includes('data-theme="dark"')) {
      for (const node of rule.nodes ?? []) {
        if (node.type === "decl" && node.prop.startsWith("--")) darkTokens.append(node.clone())
      }
    }
  })

  for (const [name, value] of extraTokens) {
    lightTokens.append(postcss.decl({ prop: name, value }))
  }

  outputRoot.append(
    postcss.comment({ text: "Generated from portal-theme.css; keep the shared source authoritative." }),
    lightTokens,
    darkTokens,
  )
  return `${outputRoot.toString()}\n`
}

/** @param {string[]} sources */
function collectStudentParentIdentifiers(sources) {
  const identifiers = new Set()
  for (const source of sources) {
    for (const match of source.matchAll(/(?:class|id)=["']([^"']+)["']/gu)) {
      for (const token of match[1].split(/\s+/u)) identifiers.add(token)
    }
    for (const match of source.matchAll(/(?:className|classList\.(?:add|toggle|remove))\s*(?:=|\()\s*["'`]([^"'`]+)["'`]/gu)) {
      for (const token of match[1].split(/\s+/u)) identifiers.add(token)
    }
    for (const match of source.matchAll(/\b(?:class|id)=["']([^"']+)["']/gu)) {
      for (const token of match[1].split(/\s+/u)) identifiers.add(token)
    }
  }
  return identifiers
}

/**
 * @param {import("postcss").Container} container
 * @param {Set<string>} identifiers
 * @param {string[]} parents
 * @param {Set<string>} seen
 * @returns {import("postcss").ChildNode[]}
 */
function extractStudentParentStructureChildren(container, identifiers, parents = [], seen = new Set()) {
  /** @type {import("postcss").ChildNode[]} */
  const kept = []
  for (const node of container.nodes ?? []) {
    if (node.type === "rule") {
      if (node.selector === ":root") continue
      const filteredSelector = filterStudentParentSelector(node.selector)
      if (!filteredSelector.trim()) continue
      const hasCustomProperties = node.nodes?.some((child) => child.type === "decl" && child.prop.startsWith("--"))
      const selectorTokens = Array.from(filteredSelector.matchAll(/[.#]([_a-zA-Z][-_a-zA-Z0-9]*)/gu), (match) => match[1])
      const relevant = selectorTokens.length === 0 || selectorTokens.some((token) => identifiers.has(token))
      if (!relevant && !hasCustomProperties) continue
      const key = `${parents.join("|")}::${filteredSelector}`
      if (seen.has(key)) continue
      seen.add(key)
      const clone = node.clone({ selector: filteredSelector })
      clone.walkDecls((decl) => {
        if (decl.prop.startsWith("--")) decl.remove()
      })
      if (clone.nodes?.length) kept.push(clone)
      continue
    }
    if (node.type !== "atrule") {
      kept.push(node.clone())
      continue
    }
    if (!node.nodes) {
      if (node.name === "font-face" || node.name === "keyframes" || node.name.endsWith("keyframes")) {
        kept.push(node.clone())
      }
      continue
    }
    const children = extractStudentParentStructureChildren(node, identifiers, [...parents, `${node.name} ${node.params}`], seen)
    if (children.length === 0) continue
    kept.push(node.clone({ nodes: children }))
  }
  return kept
}

/** @param {string} source @param {string[]} portalSources */
function buildStudentParentStructureSource(source, portalSources) {
  const identifiers = collectStudentParentIdentifiers(portalSources)
  const root = postcss.parse(source)
  const children = extractStudentParentStructureChildren(root, identifiers)
  return `${postcss.root({ nodes: children }).toString()}\n`
}

const STRUCTURE_COLOR_LITERAL_RE = /#(?:[0-9a-f]{3,8})\b|\b(?:rgba?|hsla?|color-mix)\(/iu

/** @param {string} source */
function externalizeStudentParentStructureColors(source) {
  const root = postcss.parse(source)
  const tokenByValue = new Map()
  const extraTokens = []
  root.walkDecls((decl) => {
    if (decl.prop.startsWith("--") || !STRUCTURE_COLOR_LITERAL_RE.test(decl.value)) return
    let token = tokenByValue.get(decl.value)
    if (!token) {
      token = `--portal-student-parent-structure-color-${String(extraTokens.length + 1).padStart(3, "0")}`
      tokenByValue.set(decl.value, token)
      extraTokens.push([token, decl.value])
    }
    decl.value = `var(${token})`
  })
  return {
    source: `${root.toString()}\n`,
    extraTokens,
  }
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
const STUDENT_PARENT_CRITICAL_CSS_MARKER_RE = /(?:<!-- STUDENT_PARENT_CRITICAL_CSS -->|<style id="student-parent-critical-css">[\s\S]*?<\/style>)/u

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

/** @param {string} html @param {string} criticalCss */
function renderStudentParentCriticalCssHtml(html, criticalCss) {
  const block = `<style id="student-parent-critical-css">\n/* STUDENT_PARENT_CRITICAL_CSS_START */\n${criticalCss}/* STUDENT_PARENT_CRITICAL_CSS_END */\n</style>`
  if (!STUDENT_PARENT_CRITICAL_CSS_MARKER_RE.test(html)) {
    throw new Error("student/parent HTML is missing the critical CSS marker")
  }
  return html.replace(STUDENT_PARENT_CRITICAL_CSS_MARKER_RE, block)
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
  const studentParentPortalSources = await Promise.all(STUDENT_PARENT_PORTALS.map((filePath) => fs.readFile(filePath, "utf8")))
  const structureDraft = buildStudentParentStructureSource(sharedThemeSource, studentParentPortalSources)
  const externalizedStructure = externalizeStudentParentStructureColors(structureDraft)
  const portalThemeColorsSource = buildPortalThemeColorsSource(sharedThemeSource, externalizedStructure.extraTokens)
  const studentParentStructureSource = externalizedStructure.source
  const studentParentCriticalSource = await fs.readFile(STUDENT_PARENT_CRITICAL_SOURCE, "utf8")

  const generatedCssAssets = [
    [PORTAL_THEME_COLORS_OUTPUT, portalThemeColorsSource],
    [STUDENT_PARENT_STRUCTURE_OUTPUT, studentParentStructureSource],
  ]
  for (const [outputPath, source] of generatedCssAssets) {
    if (checkOnly) {
      if (await readFileIfExists(outputPath) !== source) staleFiles.push(path.relative(REPO_ROOT, outputPath))
    } else if (await writeFileIfChanged(outputPath, source)) {
      changedFiles.push(path.relative(REPO_ROOT, outputPath))
    }
  }

  const generatedMinifiedAssets = [
    [PORTAL_THEME_COLORS_MIN_OUTPUT, await buildAdminCss(PORTAL_THEME_COLORS_OUTPUT)],
    [STUDENT_PARENT_STRUCTURE_MIN_OUTPUT, await buildAdminCss(STUDENT_PARENT_STRUCTURE_OUTPUT)],
    [STUDENT_PARENT_CRITICAL_OUTPUT, await buildAdminCss(STUDENT_PARENT_CRITICAL_SOURCE)],
  ]
  for (const [outputPath, result] of generatedMinifiedAssets) {
    if (checkOnly) {
      if (await readFileIfExists(outputPath) !== result.code) staleFiles.push(path.relative(REPO_ROOT, outputPath))
    } else if (await writeFileIfChanged(outputPath, result.code)) {
      changedFiles.push(path.relative(REPO_ROOT, outputPath))
    }
  }

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

  const studentParentCriticalHtml = generatedMinifiedAssets[2][1].code
  for (const htmlPath of [
    path.join(REPO_ROOT, "web-asset/student/student-portal.html"),
    path.join(REPO_ROOT, "web-asset/parent/parent-portal.html"),
  ]) {
    const htmlSource = await fs.readFile(htmlPath, "utf8")
    const htmlWithCritical = renderStudentParentCriticalCssHtml(htmlSource, studentParentCriticalHtml)
    if (checkOnly) {
      if (htmlSource !== htmlWithCritical) staleFiles.push(path.relative(REPO_ROOT, htmlPath))
    } else if (await writeFileIfChanged(htmlPath, htmlWithCritical)) {
      changedFiles.push(path.relative(REPO_ROOT, htmlPath))
    }
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
