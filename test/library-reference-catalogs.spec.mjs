import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { buildAwlFamilyId, REFERENCE_CATALOGS } from "../src/modules/admin/library-reference-catalogs.mjs"

const html = fs.readFileSync(new URL("../web-asset/admin/library-admin.html", import.meta.url), "utf8")
const script = fs.readFileSync(new URL("../web-asset/admin/library-reference-catalogs.js", import.meta.url), "utf8")
const routes = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
const backfill = fs.readFileSync(new URL("../tools/backfill-library-reference-catalogs.mjs", import.meta.url), "utf8")
const testSync = fs.readFileSync(new URL("../tools/sync-and-restart-test-runtime.sh", import.meta.url), "utf8")
const liveSync = fs.readFileSync(new URL("../tools/sync-and-restart-live-runtime.sh", import.meta.url), "utf8")

test("AWL family IDs use the qualifying member, sublist, and position contract", () => {
  assert.equal(buildAwlFamilyId("accumulate", 4, 1), "ACCU0401")
  assert.equal(buildAwlFamilyId("access", 4, 1), "ACCU0401")
  assert.equal(buildAwlFamilyId("academic", 10, 12), "ACAD1012")
  assert.match(backfill, /const families = new Map\(\)/u)
  assert.match(backfill, /families\.values\(\)\]\.map/u)
})

test("reference lists expose complete controls and omit source columns from the table", () => {
  for (const id of ["libraryReferenceSort", "libraryReferenceDirection", "libraryReferencePageSize", "libraryReferenceFacetFilters", "libraryReferencePagination"]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(script, /filter_\$\{select\.dataset\.referenceFilter\}/u)
  assert.match(script, /pageSizeSelect\.value/u)
  assert.match(script, /!column\.toLowerCase\(\)\.startsWith\("source"\)/u)
  assert.match(script, /data-label="\$\{esc\(label\(column\)\)\}"/u)
  assert.match(fs.readFileSync(new URL("../web-asset/shared/portal-theme.css", import.meta.url), "utf8"), /library-reference-table td::before[\s\S]*?content: attr\(data-label\)/u)
  assert.match(routes, /worksheet\["!cols"\]/u)
  assert.match(routes, /!column\.toLowerCase\(\)\.startsWith\("source"\)/u)
  assert.match(routes, /bookType: format/u)
  for (const sync of [testSync, liveSync]) assert.match(sync, /web-asset\/admin\/library-reference-catalogs\.js\|/u)
  assert.deepEqual(Object.keys(REFERENCE_CATALOGS), ["verbs", "awl", "conjunctions", "prepositions", "determiners", "auxiliaries", "morphemes", "ed_ing_adjectives", "pronouns", "idioms", "figurative_language", "noun_types"])
})
