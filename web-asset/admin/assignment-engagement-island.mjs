/* PERF-CONTRACT: ASSIGNMENT-ENGAGEMENT-ISLAND
 * This implementation is intentionally outside student-admin.min.js. Load it
 * only when the assignment-engagement page is opened. */

import { renderEngagementMatrix, clearEngagementMatrix } from "/web-asset/admin/engagement-matrix.mjs"

export function initAssignmentEngagementIsland({ document, state, api, helpers, onError }) {
  const {
    normalizeText,
    normalizeLower,
    compareTableIsoDateTime,
    compareTableText,
    applySortDirection,
    escapeHtml,
    formatDateTime,
    rowWeekNumber,
    updateTableHeaderSortIndicators,
  } = helpers

  const searchText = (row = {}) => [
    row.dispatch?.assignmentTemplateId,
    row.dispatch?.studentRefId,
    row.dispatch?.eaglesId,
    row.dispatch?.englishName,
    row.dispatch?.level,
    row.recipientEmail,
    row.dispatch?.reminderKind,
    row.dispatch?.localDate,
    row.dispatch?.status,
    row.emailUsed,
  ].map((value) => normalizeLower(value)).filter(Boolean).join(" ")

  const dayKey = (row = {}) => {
    const dispatch = row.dispatch || {}
    return `${normalizeText(dispatch.localDate) || "unknown"}:${normalizeText(dispatch.reminderKind) || "unknown"}`
  }

  const weekForDate = (value = "") => {
    const dateText = normalizeText(value)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null
    const difference = Math.floor((new Date(`${dateText}T00:00:00Z`).getTime() - new Date("2026-02-21T00:00:00Z").getTime()) / 86400000)
    return Number.isFinite(difference) && difference >= 0 ? Math.floor(difference / 7) + 1 : null
  }

  const dayHeading = (value = "", weekNumber = null) => {
    const dateText = normalizeText(value) || "-"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return `${dateText} | - | WEEK -`
    const date = new Date(`${dateText}T00:00:00Z`)
    const explicitWeek = Number.parseInt(String(weekNumber ?? ""), 10)
    const week = Number.isInteger(explicitWeek) && explicitWeek >= 1 ? explicitWeek : weekForDate(dateText)
    return `${dateText} | ${["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][date.getUTCDay()]} | WEEK ${Number.isInteger(week) && week >= 1 ? week : "-"}`
  }

  const rowsForDisplay = (includeSelectedDay = true) => {
    const engagement = state.assignmentEngagement || {}
    const terms = normalizeText(engagement.search).split("|").map((term) => normalizeLower(term)).filter(Boolean)
    const selectedDayKey = normalizeText(engagement.selectedDayKey)
    const audience = normalizeLower(engagement.audience)
    const reminderKind = normalizeLower(engagement.reminderKind)
    const status = normalizeLower(engagement.status)
    const sortField = normalizeText(state.tableSort?.assignmentEngagement?.field) || "queuedAt"
    const sortDir = normalizeLower(state.tableSort?.assignmentEngagement?.dir) === "asc" ? "asc" : "desc"
    const grouped = new Map()
    for (const row of Array.isArray(engagement.rows) ? engagement.rows : []) {
      const dispatch = row.dispatch || {}
      if (audience && normalizeLower(row.audience) !== audience) continue
      if (reminderKind && normalizeLower(dispatch.reminderKind) !== reminderKind) continue
      if (status && normalizeLower(dispatch.status) !== status) continue
      if (includeSelectedDay && selectedDayKey && dayKey(row) !== selectedDayKey) continue
      const key = `${normalizeText(dispatch.assignmentTemplateId)}:${normalizeText(dispatch.eaglesId || dispatch.studentRefId)}:${normalizeText(dispatch.reminderKind)}`
      const group = grouped.get(key) || []
      group.push(row)
      grouped.set(key, group)
    }
    const rows = Array.from(grouped.values()).filter((group) => {
      const paired = group.some((row) => normalizeLower(row.audience) === "parent") && group.some((row) => normalizeLower(row.audience) === "student")
      return paired && (!terms.length || group.some((row) => terms.every((term) => searchText(row).includes(term))))
    }).flat()
    return rows.sort((left, right) => {
      const ld = left.dispatch || {}, rd = right.dispatch || {}
      const textValue = (row, dispatch) => ({ assignment: dispatch.assignmentTemplateId, student: dispatch.eaglesId || dispatch.studentRefId, recipient: row.recipientEmail, reminder: dispatch.reminderKind, status: dispatch.status }[sortField] || "")
      const compare = ["queuedAt", "openedAt", "clickedAt", "actionCompletedAt"].includes(sortField)
        ? compareTableIsoDateTime(left[sortField] || "", right[sortField] || "")
        : compareTableText(textValue(left, ld), textValue(right, rd))
      return applySortDirection(compare || compareTableText(ld.studentRefId, rd.studentRefId), sortDir)
    })
  }

  const metric = (row = {}) => {
    const dispatch = row.dispatch || {}
    const brevo = row.brevoDelivery || {}
    const status = normalizeLower(dispatch.status)
    return {
      groupKey: `${normalizeText(dispatch.assignmentTemplateId)}:${normalizeText(dispatch.eaglesId || dispatch.studentRefId)}:${normalizeText(dispatch.reminderKind)}`,
      batchId: normalizeText(brevo.batchId || dispatch.queueId),
      queueType: normalizeText(brevo.queueType || "assignment-reminder"),
      providerMessageId: normalizeText(brevo.providerMessageId),
      reviewed: normalizeText(row.audience),
      id: normalizeText(dispatch.eaglesId || dispatch.studentRefId),
      familyId: normalizeText(dispatch.familyId),
      englishName: normalizeText(dispatch.englishName),
      level: normalizeText(dispatch.level),
      emailSent: brevo.sentAt || row.sentAt ? "yes" : status === "sent" ? "yes" : "",
      emailDelivered: brevo.deliveredAt || row.deliveredAt ? "yes" : "",
      emailOpened: brevo.openedAt || row.openedAt ? "yes" : "",
      emailClicked: brevo.clickedAt ? "yes" : "",
      emailDeferred: brevo.deferredAt ? "yes" : "",
      emailBounced: brevo.bouncedAt || status === "failed" ? "yes" : "",
      emailBlocked: brevo.blockedAt ? "yes" : "",
      emailComplained: brevo.complainedAt ? "yes" : "",
      emailUnsubscribed: brevo.unsubscribedAt ? "yes" : "",
      emailSentAt: brevo.sentAt || row.sentAt || "",
      emailDeliveredAt: brevo.deliveredAt || row.deliveredAt || "",
      emailOpenedAt: brevo.openedAt || row.openedAt || "",
      emailClickedAt: brevo.clickedAt || "",
      emailDeferredAt: brevo.deferredAt || "",
      emailBouncedAt: brevo.bouncedAt || "",
      emailBlockedAt: brevo.blockedAt || "",
      emailComplainedAt: brevo.complainedAt || "",
      emailUnsubscribedAt: brevo.unsubscribedAt || "",
      linkClicked: row.clickedAt ? "yes" : "",
      linkClickedAt: row.clickedAt || "",
      pdfDownloaded: "",
      acknowledged: "",
      actionCompleted: row.actionCompletedAt ? "yes" : "",
      actionCompletedAt: row.actionCompletedAt || "",
      emailUsed: normalizeText(row.recipientEmail),
    }
  }

  function render() {
    const rowsEl = document.getElementById("assignmentEngagementRows")
    const summaryEl = document.getElementById("assignmentEngagementSummary")
    const tableSummaryEl = document.getElementById("assignmentEngagementTableSummary")
    const listEl = document.getElementById("assignmentEngagementDayList")
    const homeSummaryEl = document.getElementById("assignmentEngagementHomeSummary")
    if (!rowsEl || !summaryEl) return
    const allRows = Array.isArray(state.assignmentEngagement?.rows) ? state.assignmentEngagement.rows : []
    const rows = rowsForDisplay()
    const days = new Map()
    for (const row of rowsForDisplay(false)) {
      const dispatch = row.dispatch || {}
      const key = dayKey(row)
      const day = days.get(key) || { key, date: normalizeText(dispatch.localDate) || "unknown", kind: normalizeText(dispatch.reminderKind) || "unknown", week: rowWeekNumber("assignments", { dueAt: dispatch.localDate }), assignments: new Set(), recipients: 0, opened: 0, clicked: 0 }
      if (dispatch.assignmentTemplateId) day.assignments.add(normalizeText(dispatch.assignmentTemplateId))
      day.recipients += 1; if (row.openedAt) day.opened += 1; if (row.clickedAt) day.clicked += 1
      days.set(key, day)
    }
    const dayRows = [...days.values()].sort((a, b) => `${b.date}:${b.kind}`.localeCompare(`${a.date}:${a.kind}`))
    if (!state.assignmentEngagement.selectedDayKey && dayRows.length) state.assignmentEngagement.selectedDayKey = dayRows[0].key
    if (listEl) {
      listEl.replaceChildren()
      for (const day of dayRows) {
        const button = document.createElement("button")
        button.type = "button"
        button.className = `performance-engagement-day-card card${day.key === state.assignmentEngagement.selectedDayKey ? " is-active" : ""}`
        button.innerHTML = `<strong>${escapeHtml(dayHeading(day.date, day.week))}</strong><span class="small">assignments=${day.assignments.size} | recipients=${day.recipients} | opens=${day.opened} | clicks=${day.clicked}</span>`
        button.addEventListener("click", () => { state.assignmentEngagement.selectedDayKey = day.key; render() })
        listEl.appendChild(button)
      }
    }
    if (homeSummaryEl) homeSummaryEl.textContent = dayRows.length ? `${dayRows.length} class day${dayRows.length === 1 ? "" : "s"} | ${rowsForDisplay(false).length} recipients` : "No class days match the current filters."
    const sent = allRows.filter((row) => row.sentAt).length
    const opened = allRows.filter((row) => row.openedAt).length
    const clicked = allRows.filter((row) => row.clickedAt).length
    summaryEl.textContent = `${rows.length}/${allRows.length} shown | sent ${sent} | opened ${opened} | clicked ${clicked}`
    if (tableSummaryEl) tableSummaryEl.textContent = `${rows.length} recipient${rows.length === 1 ? "" : "s"} in the selected reminder group.`
    if (!rows.length) { clearEngagementMatrix(rowsEl); rowsEl.textContent = "No assignment engagement records match the current search."; return }
    void renderEngagementMatrix(rowsEl, rows.map(metric), { groupBy: "groupKey" })
  }

  async function load({ force = false } = {}) {
    if (state.assignmentEngagement.loading) return
    if (state.assignmentEngagement.loaded && !force) return render()
    state.assignmentEngagement.loading = true
    render()
    try {
      const payload = await api("/api/admin/assignment-reminder-engagement?take=1000")
      state.assignmentEngagement.rows = Array.isArray(payload?.items) ? payload.items : []
      state.assignmentEngagement.loaded = true
    } catch (error) {
      onError(error)
    } finally {
      state.assignmentEngagement.loading = false
      render()
    }
  }

  const root = document.querySelector('.page-section[data-page="assignment-engagement"]')
  root?.querySelector("#assignmentEngagementReloadBtn")?.addEventListener("click", () => load({ force: true }))
  root?.querySelector("#assignmentEngagementSearch")?.addEventListener("input", (event) => { state.assignmentEngagement.search = normalizeText(event.target.value); render() })
  root?.querySelector("#assignmentEngagementAudienceFilter")?.addEventListener("change", (event) => { state.assignmentEngagement.audience = normalizeText(event.target.value); render() })
  root?.querySelector("#assignmentEngagementReminderFilter")?.addEventListener("change", (event) => { state.assignmentEngagement.reminderKind = normalizeText(event.target.value); render() })
  root?.querySelector("#assignmentEngagementStatusFilter")?.addEventListener("change", (event) => { state.assignmentEngagement.status = normalizeText(event.target.value); render() })
  return { load, render }
}
