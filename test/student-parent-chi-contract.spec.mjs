import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import postcss from "postcss"

const rootDir = process.cwd()
const files = {
  colors: path.resolve(rootDir, "web-asset/shared/portal-theme-colors.css"),
  colorsMin: path.resolve(rootDir, "web-asset/shared/portal-theme-colors.min.css"),
  structure: path.resolve(rootDir, "web-asset/shared/student-parent-structure.css"),
  structureMin: path.resolve(rootDir, "web-asset/shared/student-parent-structure.min.css"),
  critical: path.resolve(rootDir, "web-asset/shared/student-parent-critical.css"),
  criticalMin: path.resolve(rootDir, "web-asset/shared/student-parent-critical.min.css"),
  sharedMin: path.resolve(rootDir, "web-asset/shared/portal-theme.min.css"),
  studentHtml: path.resolve(rootDir, "web-asset/student/student-portal.html"),
  parentHtml: path.resolve(rootDir, "web-asset/parent/parent-portal.html"),
  studentCss: path.resolve(rootDir, "web-asset/student/student-portal.css"),
  parentCss: path.resolve(rootDir, "web-asset/parent/parent-portal.css"),
  studentJs: path.resolve(rootDir, "web-asset/student/student-portal.js"),
  parentJs: path.resolve(rootDir, "web-asset/parent/parent-portal.js"),
}

const read = (name) => fs.readFileSync(files[name], "utf8")

function inlineCritical(html) {
  const match = html.match(/<style id="student-parent-critical-css">\s*\/\* STUDENT_PARENT_CRITICAL_CSS_START \*\/\s*([\s\S]*?)\/\* STUDENT_PARENT_CRITICAL_CSS_END \*\/\s*<\/style>/u)
  assert.ok(match, "Student/Parent HTML must contain the generated critical block")
  return match[1]
}

function declarationsWithRawColors(css, filePath) {
  const hits = []
  const root = postcss.parse(css, { from: filePath })
  root.walkDecls((decl) => {
    if (decl.prop.startsWith("--")) return
    if (/#(?:[0-9a-f]{3,8})\b|\b(?:rgba?|hsla?)\(/iu.test(decl.value)) hits.push(`${decl.prop}: ${decl.value}`)
  })
  return hits
}

function duplicateSelectorKeys(css, filePath) {
  const root = postcss.parse(css, { from: filePath })
  const seen = new Set()
  const duplicates = []
  function walk(container, parents = []) {
    for (const node of container.nodes || []) {
      if (node.type === "rule") {
        const key = `${parents.join("|")}::${node.selector}`
        if (seen.has(key)) duplicates.push(key)
        seen.add(key)
      } else if (node.type === "atrule" && node.nodes) {
        walk(node, [...parents, `${node.name} ${node.params}`])
      }
    }
  }
  walk(root)
  return duplicates
}

test("Student/Parent stylesheet load order is colors, structure, critical, then route CSS", () => {
  for (const name of ["studentHtml", "parentHtml"]) {
    const html = read(name)
    const colors = html.indexOf("portal-theme-colors.min.css")
    const structure = html.indexOf("student-parent-structure.min.css")
    const critical = html.indexOf('id="student-parent-critical-css"')
    const local = html.indexOf(name === "studentHtml" ? "student/student-portal.min.css" : "parent/parent-portal.min.css")
    assert.ok(colors >= 0 && colors < structure && structure < critical && critical < local, `${name} must preserve the pilot load order`)
    assert.equal(html.includes("portal-theme.min.css"), false, `${name} must not load the full shared theme`)
  }
})

test("generated critical blocks remain identical and derived from the authored source", () => {
  const criticalSource = read("critical")
  const criticalMin = read("criticalMin")
  assert.match(criticalSource, /--portal-chi:\s*1\.61803398875/)
  assert.equal(inlineCritical(read("studentHtml")), criticalMin)
  assert.equal(inlineCritical(read("parentHtml")), criticalMin)
  assert.match(criticalMin, /--portal-chi:1\.61803398875/)
})

test("the pilot color asset contains only shared custom-property roles", () => {
  const root = postcss.parse(read("colors"), { from: files.colors })
  const nonCustomDeclarations = []
  root.walkDecls((decl) => {
    if (!decl.prop.startsWith("--")) nonCustomDeclarations.push(`${decl.prop}: ${decl.value}`)
  })
  assert.deepEqual(nonCustomDeclarations, [])
  assert.match(read("colors"), /--portal-surface-card:/)
  assert.match(read("colors"), /html\[data-theme="dark"\]/)
})

test("generated Student/Parent structure routes color declarations through the pilot role file", () => {
  assert.deepEqual(
    declarationsWithRawColors(read("structure"), files.structure),
    [],
    "generated Student/Parent structure must not own raw color declarations",
  )
})

test("generated Student/Parent structure has no duplicate selector within an at-rule scope", () => {
  assert.deepEqual(duplicateSelectorKeys(read("structure"), files.structure), [])
})

test("Student/Parent panels and card surfaces carry the explicit χ classes", () => {
  for (const name of ["studentHtml", "parentHtml"]) {
    const html = read(name)
    for (const match of html.matchAll(/class="([^"]+)"/gu)) {
      const classes = new Set(match[1].split(/\s+/u))
      if (classes.has("panel")) {
        assert.ok(classes.has("panel-theme"), `${name} panel missing panel-theme`)
        assert.ok(classes.has("panel-structure"), `${name} panel missing panel-structure`)
      }
      if (["portal-theme-card", "homework-card", "report-head-card", "report-grade-card", "quarter-board-card"].some((token) => classes.has(token))) {
        assert.ok(classes.has("card-theme"), `${name} card missing card-theme`)
        assert.ok(classes.has("card-structure"), `${name} card missing card-structure`)
      }
    }
  }
  for (const name of ["studentJs", "parentJs"]) {
    assert.match(read(name), /decorateStudentParentSurfaces/)
    assert.match(read(name), /panel-theme/) 
    assert.match(read(name), /card-structure/)
  }
})

test("the new Student/Parent critical path routes geometry through χ tokens", () => {
  const critical = postcss.parse(read("critical"), { from: files.critical })
  const rawGeometry = []
  critical.walkDecls((decl) => {
    if (decl.prop.startsWith("--")) return
    if (/(?:\d+(?:\.\d+)?)(?:px|rem|em|vh|vw|ch|%)\b/iu.test(decl.value)) rawGeometry.push(`${decl.prop}: ${decl.value}`)
  })
  assert.deepEqual(rawGeometry, [], "authored critical geometry must use χ tokens")
  assert.match(read("critical"), /--portal-chi-base:\s*8px/)
  assert.match(read("critical"), /--portal-chi-dense:\s*1\.17461894309/)
})

test("Student/Parent route CSS has no page-local color literals", () => {
  for (const name of ["studentCss", "parentCss"]) {
    assert.deepEqual(declarationsWithRawColors(read(name), files[name]), [], `${name} must use shared color roles`)
  }
})

test("the Student/Parent split measurably reduces the loaded shared CSS payload", () => {
  const pilotBytes = Buffer.byteLength(read("colorsMin")) + Buffer.byteLength(read("structureMin")) + Buffer.byteLength(read("criticalMin"))
  const fullBytes = Buffer.byteLength(read("sharedMin"))
  assert.ok(pilotBytes < fullBytes, `pilot assets (${pilotBytes}) should be smaller than full theme (${fullBytes})`)
})
