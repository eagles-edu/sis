const tableByElement = new WeakMap()
const tableReadyByElement = new WeakMap()
const columnGroups = [
  { label: "Recipient", fields: ["reviewed", "id", "familyId", "englishName", "level", "emailUsed", "batchId", "queueType", "providerMessageId"] },
  { label: "Positive events", fields: ["emailQueued", "emailSent", "emailDelivered", "emailProxy", "emailFirst", "emailUnique", "emailOpened", "emailClicked"] },
  { label: "Deferred", fields: ["emailDeferred"] },
  { label: "Negative events", fields: ["emailError", "emailInvalid", "emailBlocked", "emailSoft", "emailHard", "emailComplained", "emailUnsubscribed"] },
  { label: "SIS interaction", fields: ["linkClicked", "pdfDownloaded", "acknowledged", "actionCompleted"] },
]
let tabulatorPromise

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

function columns() {
  return [
    { title: "Recipient", columns: [
      { title: "Role", field: "reviewed", width: 90 },
      { title: "Eagles ID", field: "id", width: 105 },
      { title: "Family ID", field: "familyId", width: 120 },
      { title: "Name", field: "englishName", minWidth: 150, widthGrow: 2 },
      { title: "Level", field: "level", width: 125 },
      { title: "Email", field: "emailUsed", minWidth: 210, widthGrow: 2 },
      { title: "Batch ID", field: "batchId", minWidth: 145 },
      { title: "Queue", field: "queueType", width: 115 },
      { title: "Message ID", field: "providerMessageId", minWidth: 190 },
    ] },
    { title: "Positive events", columns: [
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
    { title: "Negative events", columns: [
      eventColumn("Error", "emailError", "negative"),
      eventColumn("Invalid", "emailInvalid", "negative"),
      eventColumn("Blocked", "emailBlocked", "negative"),
      eventColumn("Soft", "emailSoft", "negative"),
      eventColumn("Hard", "emailHard", "negative"),
      eventColumn("Complaint", "emailComplained", "negative"),
      eventColumn("Unsubscribed", "emailUnsubscribed", "negative"),
    ] },
    { title: "SIS interaction", columns: [
      eventColumn("Link clicked", "linkClicked", "interaction"),
      eventColumn("PDF downloaded", "pdfDownloaded", "interaction"),
      eventColumn("Acknowledged", "acknowledged", "interaction"),
      eventColumn("Action completed", "actionCompleted", "interaction"),
    ] },
  ]
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

function bindMatrixControls({ table, buttons, reset }) {
  const setGroupVisibility = (group, visible) => {
    for (const field of group.fields) {
      const column = table.getColumn(field)
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

export async function renderEngagementMatrix(element, rows = [], { groupBy = "groupKey" } = {}) {
  if (!element) return null
  const Tabulator = await getTabulator()
  let table = tableByElement.get(element)
  if (!table) {
    element.replaceChildren()
    const controls = createMatrixControls(element)
    const tableHost = document.createElement("div")
    tableHost.className = "engagement-matrix-table-host"
    element.appendChild(tableHost)
    let markTableReady
    const tableReady = new Promise((resolve) => {
      markTableReady = resolve
    })
    table = new Tabulator(tableHost, {
      data: rows,
      columns: columns(),
      layout: "fitData",
      height: "min(68vh, 680px)",
      movableColumns: true,
      groupBy,
      groupStartOpen: true,
      groupHeader: (value, count) => `${String(value || "Un grouped")} · ${count} recipient${count === 1 ? "" : "s"}`,
      placeholder: "No engagement rows.",
      initialSort: [{ column: "id", dir: "asc" }],
      tableBuilt: markTableReady,
    })
    tableByElement.set(element, table)
    tableReadyByElement.set(element, tableReady)
    await tableReady
    bindMatrixControls({ table, ...controls })
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
