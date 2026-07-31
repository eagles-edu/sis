import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"

class MockColumn {
  constructor(definition) {
    this.definition = definition
    this.visible = true
    this.children = (definition.columns || []).map((child) => new MockColumn(child))
  }

  getField() { return this.definition.field || "" }
  getSubColumns() { return this.children }
  show() { this.visible = true }
  hide() { this.visible = false }
}

class MockTabulator {
  constructor(_element, options) {
    this.options = options
    this.columns = options.columns.map((column) => new MockColumn(column))
    this.data = options.data
    options.tableBuilt?.()
  }

  getColumns() { return this.columns }
  async replaceData(rows) { this.data = rows }
  async clearData() { this.data = [] }
}

function flattenColumns(columns) {
  return columns.flatMap((column) => column.columns ? flattenColumns(column.columns) : [column])
}

test("engagement matrix uses ordered 16-event Brevo columns with profile identifiers", async () => {
  const dom = new JSDOM("<!doctype html><body><div id=matrix></div></body>", {
    pretendToBeVisual: true,
    url: "http://127.0.0.1/",
  })
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousTabulator = globalThis.Tabulator
  globalThis.document = dom.window.document
  globalThis.window = dom.window
  globalThis.Tabulator = MockTabulator

  try {
    const { renderEngagementMatrix, formatEngagementGroupKey, formatEngagementGroupLabel, formatEngagementGroupHeader, ENGAGEMENT_IDENTITY_BLOCK_CONTRACT } = await import("../web-asset/admin/engagement-matrix.mjs")
    const element = dom.window.document.getElementById("matrix")
    const table = await renderEngagementMatrix(element, [], { profileMode: true })
    const columns = flattenColumns(table.options.columns)
    assert.equal(columns.every((column) => !/\s/u.test(column.title)), true)

    assert.deepEqual(
      columns.slice(6, 22).map((column) => column.title),
      ["Queued", "Sent", "Delivered", "Proxy", "First", "Unique", "Opened", "Clicked", "Deferred", "Error", "Invalid", "Blocked", "Soft", "Hard", "Complaint", "Unsubscribed"],
    )
    assert.deepEqual(
      columns.slice(6, 22).map((column) => column.field),
      ["emailQueued", "emailSent", "emailDelivered", "emailProxy", "emailFirst", "emailUnique", "emailOpened", "emailClicked", "emailDeferred", "emailError", "emailInvalid", "emailBlocked", "emailSoft", "emailHard", "emailComplained", "emailUnsubscribed"],
    )
    assert.deepEqual(
      table.options.initialSort,
      [{ column: "familyId", dir: "asc" }, { column: "id", dir: "asc" }],
    )
    assert.equal(table.options.groupStartOpen, true)
    const fields = {
      level: "Starters",
      week: 30,
      date: "2026-07-31",
      familyId: "fam-000X",
      studentId: "student00X",
      parentId: "cmstudent00X",
      event: "assignment-created",
    }
    assert.equal(formatEngagementGroupKey(fields), "Starters: week 30 | 2026-07-31 | fam-000X: student00X / cmstudent00X | assignment-created")
    assert.equal(formatEngagementGroupLabel(fields, 2), "Starters: week 30 | 2026-07-31 | fam-000X: student00X / cmstudent00X | assignment-created | 2 recipients")
    assert.equal(formatEngagementGroupHeader(fields.level, 2), "Starters | 2 recipients")
    assert.equal(
      formatEngagementGroupLabel({ ...fields, event: "performance-report-created" }, 2),
      "Starters: week 30 | 2026-07-31 | fam-000X: student00X / cmstudent00X | performance-report-created | 2 recipients",
    )
    assert.deepEqual(
      table.options.columns[0].columns.map((column) => column.title),
      ["Name", "ParentID", "FamilyID", "Level", "Complete", "Email"],
    )
    const profileId = table.options.columns[0].columns.find((column) => column.field === "id")
    const profileName = table.options.columns[0].columns.find((column) => column.field === "englishName")
    assert.equal(profileName.width, 180)
    assert.equal(profileId.hozAlign, "center")
    assert.equal(profileId.headerHozAlign, "center")
    assert.equal(element.querySelector(".engagement-matrix-table-host").dataset.engagementIdentityBlock, ENGAGEMENT_IDENTITY_BLOCK_CONTRACT)
    assert.deepEqual(
      table.options.columns.map((column) => column.title),
      ["Recipient", "Positive", "Deferred", "Negative", "Interaction"],
    )
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Tabulator = previousTabulator
    dom.window.close()
  }
})

test("engagement matrix keeps the student ID column frozen and centered", async () => {
  const dom = new JSDOM("<!doctype html><body><div id=matrix></div></body>", { url: "http://127.0.0.1/" })
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousTabulator = globalThis.Tabulator
  globalThis.document = dom.window.document
  globalThis.window = dom.window
  globalThis.Tabulator = MockTabulator

  try {
    const { renderEngagementMatrix } = await import("../web-asset/admin/engagement-matrix.mjs?student-id-contract")
    const table = await renderEngagementMatrix(dom.window.document.getElementById("matrix"), [])
    const idColumn = flattenColumns(table.options.columns).find((column) => column.field === "id")
    const roleColumn = flattenColumns(table.options.columns).find((column) => column.field === "reviewed")
    assert.equal(roleColumn.width, 90)
    assert.equal(idColumn.width, 105)
    assert.equal(idColumn.hozAlign, "center")
    assert.equal(idColumn.headerHozAlign, "center")
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Tabulator = previousTabulator
    dom.window.close()
  }
})

test("engagement matrix group controls hide and restore complete column groups", async () => {
  const dom = new JSDOM("<!doctype html><body><div id=matrix></div></body>", {
    pretendToBeVisual: true,
    url: "http://127.0.0.1/",
  })
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousTabulator = globalThis.Tabulator
  globalThis.document = dom.window.document
  globalThis.window = dom.window
  globalThis.Tabulator = MockTabulator

  try {
    const { renderEngagementMatrix } = await import("../web-asset/admin/engagement-matrix.mjs")
    const element = dom.window.document.getElementById("matrix")
    const table = await renderEngagementMatrix(element, [])
    const positive = element.querySelectorAll(".engagement-matrix-column-toggle")[1]
    const reset = element.querySelector(".engagement-matrix-column-reset")
    assert.ok(positive)
    assert.ok(reset)

    positive.click()
    const positiveColumns = table.options.columns[1].columns
    assert.equal(positive.getAttribute("aria-pressed"), "false")
    assert.equal(positiveColumns.every((column) => table.getColumns()[1].children.find((child) => child.getField() === column.field)?.visible === false), true)

    reset.click()
    assert.equal(positive.getAttribute("aria-pressed"), "true")
    assert.equal(positiveColumns.every((column) => table.getColumns()[1].children.find((child) => child.getField() === column.field)?.visible === true), true)
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Tabulator = previousTabulator
    dom.window.close()
  }
})
