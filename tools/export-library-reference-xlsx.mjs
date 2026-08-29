#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"
import XLSX from "xlsx"
import { exportReferenceCatalog, REFERENCE_CATALOGS } from "../src/modules/admin/library-reference-catalogs.mjs"

const outputDirectory = path.resolve(process.argv[2] || "docs/esl/reference-lists")
const label = (value) => String(value).replace(/([A-Z])/gu, " $1").replace(/_/gu, " ").replace(/^./u, (character) => character.toUpperCase())

function workbookFor(catalogKey, rows) {
  const catalog = REFERENCE_CATALOGS[catalogKey]
  const columns = [...new Set(["term", "partOfSpeech", "subtype", ...catalog.columns, "editorialStatus"])].filter((column) => !column.toLowerCase().startsWith("source") && (rows.some((row) => Object.prototype.hasOwnProperty.call(row, column)) || catalog.columns.includes(column)))
  const headers = columns.map(label)
  const sheet = XLSX.utils.json_to_sheet(rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ""]))), { header: columns })
  XLSX.utils.sheet_add_aoa(sheet, [headers], { origin: "A1" })
  sheet["!cols"] = headers.map((header, index) => ({ wch: Math.min(42, Math.max(header.length + 2, ...rows.slice(0, 200).map((row) => String(row[columns[index]] ?? "").length + 2))) }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, catalogKey)
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" })
}

await fs.mkdir(outputDirectory, { recursive: true })
const summary = []
for (const catalogKey of Object.keys(REFERENCE_CATALOGS)) {
  const rows = await exportReferenceCatalog(catalogKey)
  const filePath = path.join(outputDirectory, `${catalogKey}.xlsx`)
  await fs.writeFile(filePath, workbookFor(catalogKey, rows))
  summary.push({ catalog: catalogKey, rows: rows.length, file: filePath })
}
console.log(JSON.stringify({ ok: true, outputDirectory, files: summary }, null, 2))
