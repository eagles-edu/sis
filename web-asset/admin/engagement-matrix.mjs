const tableByElement = new WeakMap()
const tableReadyByElement = new WeakMap()
// SIVB = Sticky ID Viewport Beacon. This is the contract shared by all
// engagement pages: ID text floats at the viewport centre over its matrix row
// while the event columns scroll underneath it.
export const ENGAGEMENT_IDENTITY_BLOCK_CONTRACT = "SIVB"
const columnGroups = [
  { label: "Recipient", fields: ["reviewed", "id", "familyId", "englishName", "level", "emailUsed", "parentName", "parentEmail", "learners", "profileComplete", "invitationStatus", "batchId", "queueType", "providerMessageId"] },
  { label: "Positive events", fields: ["emailQueued", "emailSent", "emailDelivered", "emailProxy", "emailFirst", "emailUnique", "emailOpened", "emailClicked"] },
  { label: "Deferred", fields: ["emailDeferred"] },
  { label: "Negative events", fields: ["emailError", "emailInvalid", "emailBlocked", "emailSoft", "emailHard", "emailComplained", "emailUnsubscribed"] },
  { label: "SIS interaction", fields: ["linkClicked", "pdfDownloaded", "acknowledged", "actionCompleted"] },
]
let tabulatorPromise

function normalizeGroupText(value, fallback = "Unassigned") {
  const text = value === undefined || value === null ? "" : String(value).trim()
  return text || fallback
}

export function formatEngagementGroupKey({ level, week, date, familyId, studentId, parentId, event }) {
  const weekText = normalizeGroupText(week, "-")
  return `${normalizeGroupText(level)}: week ${weekText} | ${normalizeGroupText(date, "unknown")} | ${normalizeGroupText(familyId)}: ${normalizeGroupText(studentId)} / ${normalizeGroupText(parentId)} | ${normalizeGroupText(event, "event")}`
}

export function formatEngagementGroupLabel(fields, count) {
  const countNumber = Number(count) || 0
  return `${formatEngagementGroupKey(fields)} | ${countNumber} recipient${countNumber === 1 ? "" : "s"}`
}

export function formatEngagementGroupHeader(value, count) {
  const label = String(value || "Unassigned")
  const countNumber = Number(count) || 0
  return `${label} | ${countNumber} recipient${countNumber === 1 ? "" : "s"}`
}

async function getTabulator() {
  if (globalThis.Tabulator) return globalThis.Tabulator
  if (!tabulatorPromise) {
    tabulatorPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script")
      script.src = "/web-asset/vendor/tabulatorz/tabulator.min.js"
      script.onload = () => {
        if (globalThis.Tabulator) resolve(globalThis.Tabulator)
        else reject(new Error("Tabulator package loaded without its global export"))
      }
      script.onerror = () => reject(new Error("Tabulator package failed to load"))
      document.head.appendChild(script)
    }).catch((error) => {
      // A transient network/cache failure must not poison every later Reload.
      tabulatorPromise = undefined
      throw error
    })
  }
  return tabulatorPromise
}

function formatEventTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return ""
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).formatToParts(date)
  const valueFor = (type) => parts.find((part) => part.type === type)?.value || ""
  return `${valueFor("day")}/${valueFor("month")} ${valueFor("hour")}:${valueFor("minute")}`
}

function markFormatter(cell, tone) {
  const value = cell.getValue()
  const timestamp = cell.getData()?.[`${cell.getField()}At`] || ""
  const mark = value === "yes" ? formatEventTime(timestamp) : "—"
  const title = timestamp ? new Date(timestamp).toLocaleString() : "Not recorded"
  return `<span class="engagement-matrix-mark is-${tone} ${value === "yes" ? "is-set" : "is-empty"}" title="${title}">${mark}</span>`
}

function eventColumn(title, field, tone) {
  return { title, field, width: 92, hozAlign: "center", formatter: (cell) => markFormatter(cell, tone) }
}

function completionFormatter(cell) {
  const value = String(cell.getValue() || "no").toLowerCase() === "yes" ? "yes" : "no"
  return `<span class="engagement-matrix-completion is-${value}">${value}</span>`
}

function columns({ profileMode = false } = {}) {
  const recipientColumns = profileMode
    ? [
        { title: "Name", field: "englishName", width: 180 },
        { title: "ParentID", field: "id", width: 125, hozAlign: "center", headerHozAlign: "center" },
        { title: "FamilyID", field: "familyId", width: 120 },
        { title: "Level", field: "level", width: 125 },
        { title: "Complete", field: "profileComplete", width: 135, hozAlign: "center", formatter: completionFormatter },
        { title: "Email", field: "emailUsed", minWidth: 220, widthGrow: 2 },
      ]
    : [
        { title: "Role", field: "reviewed", width: 90 },
        { title: "EaglesID", field: "id", width: 105, hozAlign: "center", headerHozAlign: "center" },
        { title: "FamilyID", field: "familyId", width: 120 },
        { title: "Name", field: "englishName", minWidth: 150, widthGrow: 2 },
        { title: "Level", field: "level", width: 125 },
        { title: "Email", field: "emailUsed", minWidth: 210, widthGrow: 2 },
        { title: "Parent", field: "parentName", minWidth: 170 },
        { title: "Contact", field: "parentEmail", minWidth: 210 },
        { title: "Learners", field: "learners", minWidth: 220 },
        { title: "Complete", field: "profileComplete", width: 135 },
        { title: "Invite", field: "invitationStatus", width: 115 },
        { title: "BatchID", field: "batchId", minWidth: 145 },
        { title: "Queue", field: "queueType", width: 115 },
        { title: "MessageID", field: "providerMessageId", minWidth: 190 },
      ]
  return [
    { title: "Recipient", columns: recipientColumns },
    { title: "Positive", columns: [
      eventColumn("Queued", "emailQueued", "positive"),
      eventColumn("Sent", "emailSent", "positive"),
      eventColumn("Delivered", "emailDelivered", "positive"),
      eventColumn("Proxy", "emailProxy", "positive"),
      eventColumn("First", "emailFirst", "positive"),
      eventColumn("Unique", "emailUnique", "positive"),
      eventColumn("Opened", "emailOpened", "positive"),
      eventColumn("Clicked", "emailClicked", "positive"),
    ] },
    { title: "Deferred", columns: [
      eventColumn("Deferred", "emailDeferred", "deferred"),
    ] },
    { title: "Negative", columns: [
      eventColumn("Error", "emailError", "negative"),
      eventColumn("Invalid", "emailInvalid", "negative"),
      eventColumn("Blocked", "emailBlocked", "negative"),
      eventColumn("Soft", "emailSoft", "negative"),
      eventColumn("Hard", "emailHard", "negative"),
      eventColumn("Complaint", "emailComplained", "negative"),
      eventColumn("Unsubscribed", "emailUnsubscribed", "negative"),
    ] },
    { title: "Interaction", columns: [
      eventColumn("Link", "linkClicked", "interaction"),
      eventColumn("PDF", "pdfDownloaded", "interaction"),
      eventColumn("Ack", "acknowledged", "interaction"),
      eventColumn("Action", "actionCompleted", "interaction"),
    ] },
  ]
}

function positionSivbBeacon(tableHost) {
  const holder = tableHost.querySelector(".tabulator-tableholder")
  const idCell = tableHost.querySelector('.tabulator-cell[tabulator-field="id"]')
  if (!holder || !idCell) return
  const holderLeft = holder.getBoundingClientRect().left
  const idWidth = idCell.getBoundingClientRect().width
  const left = Math.max(0, (window.innerWidth - idWidth) / 2 - holderLeft)
  tableHost.style.setProperty("--sivb-id-anchor-left", `${left}px`)
}

function bindSivbBeacon(tableHost) {
  const update = () => positionSivbBeacon(tableHost)
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(update)
    observer.observe(tableHost)
  }
  window.addEventListener("resize", update)
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(update)
  else update()
  // Tabulator fires tableBuilt before the first rows/cells are attached.
  setTimeout(update, 0)
}

function createMatrixControls(element) {
  const controls = document.createElement("div")
  controls.className = "engagement-matrix-controls"
  controls.setAttribute("aria-label", "Matrix column visibility")
  const label = document.createElement("span")
  label.className = "small"
  label.textContent = "Columns"
  controls.appendChild(label)
  const buttons = new Map()
  for (const group of columnGroups) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "portal-button portal-button-alt engagement-matrix-column-toggle"
    button.textContent = group.label
    button.setAttribute("aria-pressed", "true")
    controls.appendChild(button)
    buttons.set(group.label, button)
  }
  const reset = document.createElement("button")
  reset.type = "button"
  reset.className = "portal-button portal-button-alt engagement-matrix-column-reset"
  reset.textContent = "Reset columns"
  controls.appendChild(reset)
  element.appendChild(controls)
  return { controls, buttons, reset }
}

function findMatrixColumn(table, field) {
  const visit = (column) => {
    if (!column) return null
    if (column.getField?.() === field) return column
    for (const child of column.getSubColumns?.() || []) {
      const match = visit(child)
      if (match) return match
    }
    return null
  }
  for (const column of table.getColumns?.(true) || table.getColumns?.() || []) {
    const match = visit(column)
    if (match) return match
  }
  return null
}

function bindMatrixControls({ table, buttons, reset }) {
  const setGroupVisibility = (group, visible) => {
    for (const field of group.fields) {
      const column = findMatrixColumn(table, field)
      if (column) visible ? column.show() : column.hide()
    }
    const button = buttons.get(group.label)
    if (button) button.setAttribute("aria-pressed", visible ? "true" : "false")
  }
  for (const group of columnGroups) {
    const button = buttons.get(group.label)
    button?.addEventListener("click", () => {
      const visible = button.getAttribute("aria-pressed") !== "true"
      setGroupVisibility(group, visible)
    })
  }
  reset.addEventListener("click", () => {
    for (const group of columnGroups) setGroupVisibility(group, true)
  })
}

export async function renderEngagementMatrix(element, rows = [], { groupBy = "groupKey", initialSort, profileMode = false, groupHeader } = {}) {
  if (!element) return null
  const Tabulator = await getTabulator()
  let table = tableByElement.get(element)
  if (!table) {
    element.replaceChildren()
    const controls = createMatrixControls(element)
    const tableHost = document.createElement("div")
    tableHost.className = `engagement-matrix-table-host${profileMode ? " engagement-matrix-profile" : ""}`
    tableHost.dataset.engagementIdentityBlock = ENGAGEMENT_IDENTITY_BLOCK_CONTRACT
    element.appendChild(tableHost)
    let markTableReady
    const tableReady = new Promise((resolve) => {
      markTableReady = resolve
    })
    table = new Tabulator(tableHost, {
      data: rows,
      columns: columns({ profileMode }),
      layout: "fitData",
      height: "min(68vh, 680px)",
      movableColumns: true,
      groupBy,
      groupStartOpen: true,
      groupHeader: groupHeader || ((value, count) => `${String(value || "Un grouped")} · ${count} recipient${count === 1 ? "" : "s"}`),
      placeholder: "No engagement rows.",
      initialSort: initialSort || [{ column: "familyId", dir: "asc" }, { column: "id", dir: "asc" }],
      renderComplete: () => positionSivbBeacon(tableHost),
      tableBuilt: () => {
        bindSivbBeacon(tableHost)
        markTableReady()
      },
    })
    tableByElement.set(element, table)
    tableReadyByElement.set(element, tableReady)
    bindMatrixControls({ table, ...controls })
    await tableReady
  } else {
    await tableReadyByElement.get(element)
    await table.replaceData(rows)
  }
  return table
}

export function clearEngagementMatrix(element) {
  const table = element ? tableByElement.get(element) : null
  if (table) void table.clearData()
}
