import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"

const { initReportSettingsIsland } = await import(
  "../web-asset/admin/report-settings-island.mjs"
)

test("report settings island wires import, settings, and report controls", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <html>
        <body>
          <button id="importBtn" type="button"></button>
          <button id="importTemplateBtn" type="button"></button>
          <button id="settingsSaveBtn" type="button"></button>
          <button id="settingsResetBtn" type="button"></button>
          <button id="reportSaveBtn" type="button"></button>
          <button id="reportGenerateBtn" type="button"></button>
          <button id="reportCardBtn" type="button"></button>
          <button id="reportClearBtn" type="button"></button>
          <select id="reportSortField"><option value="generatedAt">Generated</option></select>
          <button id="reportSortDirBtn" type="button"></button>
          <input id="reportDataSearch" type="search">
          <button id="reportArchiveToggleBtn" type="button"></button>
          <button id="reportExportXlsxBtn" type="button"></button>
          <button id="reportPrintPdfBtn" type="button"></button>
        </body>
      </html>`,
    { pretendToBeVisual: true, url: "http://127.0.0.1/" },
  )

  const events = []
  initReportSettingsIsland({
    document: dom.window.document,
    onImportSpreadsheet() {
      events.push("import")
    },
    onImportTemplate() {
      events.push("import-template")
    },
    onSettingsSave() {
      events.push("settings-save")
    },
    onSettingsReset() {
      events.push("settings-reset")
    },
    onReportSave() {
      events.push("report-save")
    },
    onReportGenerate() {
      events.push("report-generate")
    },
    onReportCard() {
      events.push("report-card")
    },
    onReportClear() {
      events.push("report-clear")
    },
    onReportSortFieldChange(value) {
      events.push(["sort-field", value])
    },
    onReportSortDirToggle() {
      events.push("sort-dir")
    },
    onReportDataSearchInput(value) {
      events.push(["search", value])
    },
    onReportArchiveToggle() {
      events.push("archive")
    },
    onReportExportXlsx() {
      events.push("export")
    },
    onReportPrintPdf() {
      events.push("print")
    },
  })

  const document = dom.window.document
  document.getElementById("importBtn").click()
  document.getElementById("importTemplateBtn").click()
  document.getElementById("settingsSaveBtn").click()
  document.getElementById("settingsResetBtn").click()
  document.getElementById("reportSaveBtn").click()
  document.getElementById("reportGenerateBtn").click()
  document.getElementById("reportCardBtn").click()
  document.getElementById("reportClearBtn").click()
  document.getElementById("reportSortField").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("reportSortDirBtn").click()
  document.getElementById("reportDataSearch").value = "science"
  document.getElementById("reportDataSearch").dispatchEvent(
    new dom.window.Event("input", { bubbles: true }),
  )
  document.getElementById("reportArchiveToggleBtn").click()
  document.getElementById("reportExportXlsxBtn").click()
  document.getElementById("reportPrintPdfBtn").click()

  assert.deepEqual(events, [
    "import",
    "import-template",
    "settings-save",
    "settings-reset",
    "report-save",
    "report-generate",
    "report-card",
    "report-clear",
    ["sort-field", "generatedAt"],
    "sort-dir",
    ["search", "science"],
    "archive",
    "export",
    "print",
  ])

  dom.window.close()
})
