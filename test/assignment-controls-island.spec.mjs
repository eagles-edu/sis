import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"

const { initAssignmentControlsIsland } = await import(
  "../web-asset/admin/assignment-controls-island.mjs"
)

test("assignment controls island wires assignment and reminder controls", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <html>
        <body>
          <select id="assignLevel"><option value="A1">A1</option></select>
          <input id="assignAssignedAt" value="2026-04-15">
          <input id="assignDueAt" value="">
          <select id="assignmentExerciseSelect">
            <option value="title-1" data-url="https://example.test/title-1">Title 1</option>
          </select>
          <input id="assignmentExerciseUrl" value="">
          <button id="assignmentAddItemBtn" type="button"></button>
          <button id="assignmentLoadTitlesBtn" type="button"></button>
          <button id="assignmentReloadTemplatesBtn" type="button"></button>
          <select id="assignmentSortField"><option value="dueAt">Due</option></select>
          <button id="assignmentSortDirBtn" type="button"></button>
          <input id="assignmentDataSearch" type="search">
          <button id="assignmentArchiveToggleBtn" type="button"></button>
          <button id="assignmentExportXlsxBtn" type="button"></button>
          <button id="assignmentPrintPdfBtn" type="button"></button>
          <button id="assignmentSaveTemplateBtn" type="button"></button>
          <button id="assignmentDeleteTemplateBtn" type="button"></button>
          <button id="assignmentSendBtn" type="button"></button>
          <button id="assignmentResetBtn" type="button"></button>
          <input id="levelReminderMode" value="selected">
          <button id="levelReminderSendBtn" type="button"></button>
          <button id="levelReminderSendAllBtn" type="button"></button>
          <button id="levelReminderClearBtn" type="button"></button>
          <button id="levelDetailCloseBtn" type="button"></button>
        </body>
      </html>`,
    { pretendToBeVisual: true, url: "http://127.0.0.1/" },
  )

  const events = []
  initAssignmentControlsIsland({
    document: dom.window.document,
    onAssignLevelChange() {
      events.push("level")
    },
    onAssignAssignedAtChange() {
      const dueEl = dom.window.document.getElementById("assignDueAt")
      if (!dueEl.value) dueEl.value = "2026-04-19"
      events.push("assigned")
    },
    onAssignmentExerciseSelectChange() {
      const selectEl = dom.window.document.getElementById("assignmentExerciseSelect")
      const urlEl = dom.window.document.getElementById("assignmentExerciseUrl")
      const selectedOption = selectEl.options[selectEl.selectedIndex]
      urlEl.value = selectedOption.dataset.url
      events.push("exercise-select")
    },
    onAssignmentAddItem() {
      events.push("add-item")
    },
    onAssignmentLoadTitles() {
      events.push("load-titles")
    },
    onAssignmentReloadTemplates() {
      events.push("reload-templates")
    },
    onAssignmentSortFieldChange(value) {
      events.push(["sort-field", value])
    },
    onAssignmentSortDirToggle() {
      events.push("sort-dir")
    },
    onAssignmentDataSearchInput(value) {
      events.push(["search", value])
    },
    onAssignmentArchiveToggle() {
      events.push("archive")
    },
    onAssignmentExportXlsx() {
      events.push("export")
    },
    onAssignmentPrintPdf() {
      events.push("print")
    },
    onAssignmentSaveTemplate() {
      events.push("save-template")
    },
    onAssignmentDeleteTemplate() {
      events.push("delete-template")
    },
    onAssignmentSend() {
      events.push("send")
    },
    onAssignmentReset() {
      events.push("reset")
    },
    onLevelReminderSend() {
      events.push("reminder-send")
    },
    onLevelReminderSendAll() {
      events.push("reminder-send-all")
    },
    onLevelReminderClear() {
      events.push("reminder-clear")
    },
    onLevelDetailClose() {
      events.push("detail-close")
    },
  })

  const document = dom.window.document
  document.getElementById("assignLevel").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("assignAssignedAt").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("assignmentExerciseSelect").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("assignmentAddItemBtn").click()
  document.getElementById("assignmentLoadTitlesBtn").click()
  document.getElementById("assignmentReloadTemplatesBtn").click()
  document.getElementById("assignmentSortField").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("assignmentSortDirBtn").click()
  document.getElementById("assignmentDataSearch").value = "fractions"
  document.getElementById("assignmentDataSearch").dispatchEvent(
    new dom.window.Event("input", { bubbles: true }),
  )
  document.getElementById("assignmentArchiveToggleBtn").click()
  document.getElementById("assignmentExportXlsxBtn").click()
  document.getElementById("assignmentPrintPdfBtn").click()
  document.getElementById("assignmentSaveTemplateBtn").click()
  document.getElementById("assignmentDeleteTemplateBtn").click()
  document.getElementById("assignmentSendBtn").click()
  document.getElementById("assignmentResetBtn").click()
  document.getElementById("levelReminderSendBtn").click()
  document.getElementById("levelReminderSendAllBtn").click()
  document.getElementById("levelReminderClearBtn").click()
  document.getElementById("levelDetailCloseBtn").click()

  assert.equal(document.getElementById("assignDueAt").value, "2026-04-19")
  assert.equal(
    document.getElementById("assignmentExerciseUrl").value,
    "https://example.test/title-1",
  )
  assert.deepEqual(events, [
    "level",
    "assigned",
    "exercise-select",
    "add-item",
    "load-titles",
    "reload-templates",
    ["sort-field", "dueAt"],
    "sort-dir",
    ["search", "fractions"],
    "archive",
    "export",
    "print",
    "save-template",
    "delete-template",
    "send",
    "reset",
    "reminder-send",
    "reminder-send-all",
    "reminder-clear",
    "detail-close",
  ])

  dom.window.close()
})
