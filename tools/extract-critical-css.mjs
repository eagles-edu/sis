// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import postcss from "postcss"

/**
 * Extract complete CSS rule nodes whose selector list contains an ID that is
 * present in the target HTML. The source stylesheet is never rewritten.
 *
 * This deliberately keeps a whole selector list when one selector matches.
 * Splitting comma-separated selectors or slicing CSS by byte offsets can
 * change cascade and at-rule behavior.
 */

/**
 * @param {string} html
 * @returns {Set<string>}
 */
function collectHtmlIds(html) {
  return new Set(
    [...html.matchAll(/\bid\s*=\s*(["'])([^"']+)\1/giu)].map((match) => match[2])
  )
}

/**
 * @param {string} selector
 * @returns {string[]}
 */
function collectSelectorIds(selector) {
  return [...selector.matchAll(/#[A-Za-z_][\w-]*/gu)].map((match) => match[0].slice(1))
}

/**
 * @param {import("postcss").Container} container
 * @param {Set<string>} ids
 * @returns {import("postcss").ChildNode[]}
 */
function extractChildren(container, ids) {
  /** @type {import("postcss").ChildNode[]} */
  const extracted = []

  for (const node of container.nodes ?? []) {
    if (node.type === "rule") {
      const selectorIds = collectSelectorIds(node.selector)
      if (selectorIds.some((id) => ids.has(id))) {
        extracted.push(node.clone())
      }
      continue
    }

    if (node.type !== "atrule" || !node.nodes) continue
    const children = extractChildren(node, ids)
    if (children.length === 0) continue

    const clone = node.clone({ nodes: [] })
    clone.append(children)
    extracted.push(clone)
  }

  return extracted
}

/**
 * @param {string} source
 * @param {string} html
 * @returns {{css: string, ruleCount: number, idCount: number}}
 */
export function extractCriticalCss(source, html) {
  const ids = collectHtmlIds(html)
  const root = postcss.parse(source)
  const extracted = extractChildren(root, ids)
  const output = postcss.root({ nodes: extracted })
  return {
    css: output.toString(),
    ruleCount: extracted.reduce((count, node) => {
      if (node.type === "rule") return count + 1
      return count + node.nodes.filter((child) => child.type === "rule").length
    }, 0),
    idCount: ids.size,
  }
}

/**
 * @param {string[]} args
 */
async function main(args) {
  const [htmlPath, outputPath, ...cssPaths] = args
  if (!htmlPath || !outputPath || cssPaths.length === 0) {
    throw new Error("Usage: node tools/extract-critical-css.mjs <html> <output> <css> [<css> ...]")
  }

  const html = await fs.readFile(htmlPath, "utf8")
  const extracted = []
  for (const cssPath of cssPaths) {
    extracted.push(extractCriticalCss(await fs.readFile(cssPath, "utf8"), html))
  }
  const css = extracted.map((result) => result.css).filter(Boolean).join("\n")
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${css}\n`, "utf8")
  console.log(`${outputPath}: ${extracted.reduce((count, result) => count + result.ruleCount, 0)} rules from ${extracted[0].idCount} HTML IDs`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
