import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const imageDir = path.resolve(rootDir, "web-asset/images")
const assetStore = fs.readFileSync(path.resolve(rootDir, "src/modules/portal/portal-asset-store.mjs"), "utf8")

const classLevelAssets = [
  ["class-level-eggs-chicks", "eggs-chicks.svg"],
  ["class-level-pre-a1-starters", "starters.svg"],
  ["class-level-a1-movers", "movers.svg"],
  ["class-level-a2-flyers", "flyers.svg"],
  ["class-level-a2-ket", "ket.svg"],
  ["class-level-b1-pet", "pet.svg"],
  ["class-level-b2-ielts", "ielts.svg"],
]

test("every built-in class-level SVG is present, square, and safe", () => {
  for (const [assetKey, fileName] of classLevelAssets) {
    const svgPath = path.join(imageDir, fileName)
    assert.ok(fs.existsSync(svgPath), `${fileName} must exist`)
    const svg = fs.readFileSync(svgPath, "utf8")
    assert.match(assetStore, new RegExp(`assetKey: "${assetKey}"[^\n]*fileName: "${fileName}"`))
    assert.match(svg, /<svg\b[^>]*viewBox="0 0 [0-9.]+ [0-9.]+"/i, `${fileName} must declare a viewBox`)
    assert.doesNotMatch(svg, /<script\b|<foreignObject\b|\bon[a-z]+\s*=|javascript:/i, `${fileName} contains unsafe SVG markup`)
  }
})

test("IELTS tile SVG preserves its white square tile background", () => {
  const svg = fs.readFileSync(path.join(imageDir, "ielts.svg"), "utf8")
  assert.match(svg, /viewBox="0 0 2400 2400"/)
  assert.match(svg, /<rect\s+width="100%"\s+height="100%"\s+fill="#fff"\s*\/>/i)
})
