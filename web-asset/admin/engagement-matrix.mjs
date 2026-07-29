const tableByElement = new WeakMap()
let tabulatorPromise

async function getTabulator() {
  if (globalThis.Tabulator) return globalThis.Tabulator
  tabulatorPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "/web-asset/vendor/tabulatorz/tabulator.min.js"
    script.onload = () => resolve(globalThis.Tabulator)
    script.onerror = () => reject(new Error("Tabulator package failed to load"))
    document.head.appendChild(script)
  })
  return tabulatorPromise
}

function markFormatter(cell) {
  const value = cell.getValue()
  const timestamp = cell.getData()?.[`${cell.getField()}At`] || ""
  const mark = value === "yes" ? "✓" : "—"
  const title = timestamp ? new Date(timestamp).toLocaleString() : "Not recorded"
  return `<span class="engagement-matrix-mark ${value === "yes" ? "is-set" : "is-empty"}" title="${title}">${mark}</span>`
}

function eventColumn(title, field) {
  return { title, field, width: 86, hozAlign: "center", formatter: markFormatter }
}

function columns() {
  return [
    { title: "Recipient", columns: [
      { title: "Role", field: "reviewed", width: 90, frozen: true },
      { title: "Eagles ID", field: "id", width: 105, frozen: true },
      { title: "Family ID", field: "familyId", width: 120 },
      { title: "Name", field: "englishName", minWidth: 150, widthGrow: 2 },
      { title: "Level", field: "level", width: 125 },
      { title: "Email", field: "emailUsed", minWidth: 210, widthGrow: 2 },
      { title: "Batch ID", field: "batchId", minWidth: 145 },
      { title: "Queue", field: "queueType", width: 115 },
      { title: "Message ID", field: "providerMessageId", minWidth: 190 },
    ] },
    { title: "Brevo email events", columns: [
      eventColumn("Sent", "emailSent"),
      eventColumn("Delivered", "emailDelivered"),
      eventColumn("Opened", "emailOpened"),
      eventColumn("Clicked", "emailClicked"),
      eventColumn("Deferred", "emailDeferred"),
      eventColumn("Bounced", "emailBounced"),
      eventColumn("Blocked", "emailBlocked"),
      eventColumn("Complaint", "emailComplained"),
      eventColumn("Unsubscribed", "emailUnsubscribed"),
    ] },
    { title: "SIS interaction", columns: [
      eventColumn("Link clicked", "linkClicked"),
      eventColumn("PDF downloaded", "pdfDownloaded"),
      eventColumn("Acknowledged", "acknowledged"),
      eventColumn("Action completed", "actionCompleted"),
    ] },
  ]
}

export async function renderEngagementMatrix(element, rows = [], { groupBy = "groupKey" } = {}) {
  if (!element) return null
  const Tabulator = await getTabulator()
  let table = tableByElement.get(element)
  if (!table) {
    element.replaceChildren()
    table = new Tabulator(element, {
      data: rows,
      columns: columns(),
      layout: "fitDataStretch",
      height: "min(68vh, 680px)",
      responsiveLayout: "collapse",
      movableColumns: true,
      groupBy,
      groupStartOpen: true,
      groupHeader: (value, count) => `${String(value || "Un grouped")} · ${count} recipient${count === 1 ? "" : "s"}`,
      placeholder: "No engagement rows.",
      initialSort: [{ column: "id", dir: "asc" }],
    })
    tableByElement.set(element, table)
  } else {
    await table.replaceData(rows)
  }
  return table
}

export function clearEngagementMatrix(element) {
  const table = element ? tableByElement.get(element) : null
  if (table) void table.clearData()
}
