import assert from "node:assert/strict"
import test from "node:test"
import verbRegularityData from "../data/verb-regularity.json" with { type: "json" }
import { getVerbRegularity } from "../src/modules/admin/verb-regularity.mjs"

test("1000-form verb reference classifies regular and irregular forms", () => {
  assert.equal(getVerbRegularity("accept").regularity, "regular")
  assert.equal(getVerbRegularity("break").regularity, "irregular")
  assert.equal(getVerbRegularity("eat").regularity, "irregular")
  assert.equal(getVerbRegularity("abide").regularity, "irregular")
  assert.equal(getVerbRegularity("read").regularity, "irregular")
  assert.equal(getVerbRegularity("set").regularity, "irregular")
  assert.equal(getVerbRegularity("unknown-verb").found, false)
})

test("generated regularity data contains every source row and all five forms", () => {
  assert.equal(verbRegularityData.sourceRowCount, 999)
  assert.equal(verbRegularityData.uniqueVerbCount, 996)
  assert.equal(verbRegularityData.rows.length, 999)
  assert.equal(verbRegularityData.irregularVerbs.length, 203)
  assert.equal(verbRegularityData.regularVerbs.length, 794)
  const american = verbRegularityData.rows.find((row) => row.base === "learn")
  assert.deepEqual(american.forms, {
    V1: "learn",
    V2: "learned",
    V3: "learned",
    V4: "learning",
    V5: "learns",
  })

  const color = verbRegularityData.rows.find((row) => row.base === "color")
  assert.deepEqual(color.forms, {
    V1: "color",
    V2: "colored",
    V3: "colored",
    V4: "coloring",
    V5: "colors",
  })

  const eat = verbRegularityData.rows.find((row) => row.base === "eat")
  assert.deepEqual(eat.forms, {
    V1: "eat",
    V2: "ate",
    V3: "eaten",
    V4: "eating",
    V5: "eats",
  })
  assert.equal(eat.regularity, "irregular")
})
