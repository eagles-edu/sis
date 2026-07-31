/* PERF-CONTRACT: ASSIGNMENT-ENGAGEMENT-ISLAND
 * This implementation is intentionally outside student-admin.min.js. Load it
 * only when the assignment-engagement page is opened. */

import {
  renderEngagementMatrix,
  clearEngagementMatrix,
  formatEngagementGroupKey,
  formatEngagementGroupHeader,
} from "/web-asset/admin/engagement-matrix.mjs?v=20260801-sivb"

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
  let matrixVersion = 0
  let matrixRender = Promise.resolve()

  function queueMatrixRender(rowsEl, rows) {
    const version = ++matrixVersion
    matrixRender = matrixRender
      .catch(() => {})
      .then(async () => {
        if (version !== matrixVersion) return
        if (!rows.length) {
          clearEngagementMatrix(rowsEl)
          rowsEl.textContent = "No assignment engagement records match the current search."
          return
        }
        await renderEngagementMatrix(rowsEl, rows.map(metric), {
          groupBy: "groupKey",
          groupHeader: formatEngagementGroupHeader,
        })
      })
    matrixRender.catch(onError)
  }

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
    const batchId = normalizeText(row.brevoDelivery?.batchId || dispatch.queueId)
    return `${normalizeText(dispatch.localDate) || "unknown"}:${batchId || normalizeText(dispatch.reminderKind) || "unknown"}`
  }

  const rawGroupKey = (row = {}) => {
    const dispatch = row.dispatch || {}
    const brevo = row.brevoDelivery || {}
    return `${normalizeText(brevo.batchId || dispatch.queueId) || "no-batch"}:${normalizeText(dispatch.assignmentTemplateId)}:${normalizeText(dispatch.eaglesId || dispatch.studentRefId)}:${normalizeText(dispatch.reminderKind)}`
  }

  const groupLabel = (group = []) => {
    const first = group[0] || {}
    const dispatch = first.dispatch || {}
    const student = group.find((row) => normalizeLower(row.audience) === "student") || first
    const studentDispatch = student.dispatch || dispatch
    return formatEngagementGroupKey({
      level: studentDispatch.level,
      week: rowWeekNumber("assignments", dispatch),
      date: dispatch.localDate,
      familyId: studentDispatch.familyId,
      studentId: studentDispatch.eaglesId || studentDispatch.studentRefId,
      parentId: (group.find((row) => normalizeLower(row.audience) === "parent") || {}).dispatch?.parentsId,
      event: "assignment-created",
    })
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
      const batchId = normalizeText(row.brevoDelivery?.batchId || dispatch.queueId)
      const key = rawGroupKey(row)
      const group = grouped.get(key) || []
      group.push(row)
      grouped.set(key, group)
    }
    const rows = Array.from(grouped.values()).filter((group) => {
      const paired = group.some((row) => normalizeLower(row.audience) === "parent") && group.some((row) => normalizeLower(row.audience) === "student")
      return paired && (!terms.length || group.some((row) => terms.every((term) => searchText(row).includes(term))))
    }).flatMap((group) => {
      const displayKey = groupLabel(group)
      return group.map((row) => ({ ...row, __engagementGroupKey: displayKey }))
    })
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
      groupKey: normalizeText(row.__engagementGroupKey) || rawGroupKey(row),
      batchId: normalizeText(brevo.batchId || dispatch.queueId),
      queueType: normalizeText(brevo.queueType || "assignment-reminder"),
      providerMessageId: normalizeText(brevo.providerMessageId),
      reviewed: normalizeText(row.audience),
      id: normalizeText(dispatch.eaglesId || dispatch.studentRefId),
      familyId: normalizeText(dispatch.familyId),
      englishName: normalizeText(dispatch.englishName),
      level: normalizeText(dispatch.level),
      emailQueued: brevo.queuedAt || row.queuedAt ? "yes" : "",
      emailQueuedAt: brevo.queuedAt || row.queuedAt || "",
      emailSent: brevo.sentAt || row.sentAt ? "yes" : status === "sent" ? "yes" : "",
      emailDelivered: brevo.deliveredAt || row.deliveredAt ? "yes" : "",
      emailProxy: brevo.proxyLoadedAt ? "yes" : "",
      emailFirst: brevo.firstOpenedAt ? "yes" : "",
      emailUnique: brevo.uniqueOpenedAt ? "yes" : "",
      emailOpened: brevo.openedAt || row.openedAt ? "yes" : "",
      emailClicked: brevo.clickedAt ? "yes" : "",
      emailDeferred: brevo.deferredAt ? "yes" : "",
      emailError: brevo.errorAt ? "yes" : "",
      emailInvalid: brevo.invalidAt ? "yes" : "",
      emailBlocked: brevo.blockedAt ? "yes" : "",
      emailSoft: brevo.softBouncedAt ? "yes" : "",
      emailHard: brevo.hardBouncedAt || status === "failed" ? "yes" : "",
      emailComplained: brevo.complainedAt ? "yes" : "",
      emailUnsubscribed: brevo.unsubscribedAt ? "yes" : "",
      emailSentAt: brevo.sentAt || row.sentAt || "",
      emailDeliveredAt: brevo.deliveredAt || row.deliveredAt || "",
      emailProxyAt: brevo.proxyLoadedAt || "",
      emailFirstAt: brevo.firstOpenedAt || "",
      emailUniqueAt: brevo.uniqueOpenedAt || "",
      emailOpenedAt: brevo.openedAt || row.openedAt || "",
      emailClickedAt: brevo.clickedAt || "",
      emailDeferredAt: brevo.deferredAt || "",
      emailErrorAt: brevo.errorAt || "",
      emailInvalidAt: brevo.invalidAt || "",
      emailBlockedAt: brevo.blockedAt || "",
      emailSoftAt: brevo.softBouncedAt || "",
      emailHardAt: brevo.hardBouncedAt || "",
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
      const day = days.get(key) || { key, date: normalizeText(dispatch.localDate) || "unknown", kind: normalizeText(dispatch.reminderKind) || "unknown", week: rowWeekNumber("assignments", dispatch), assignments: new Set(), recipients: 0, opened: 0, clicked: 0 }
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
    queueMatrixRender(rowsEl, rows)
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
  const dayListToggle = root?.querySelector("#assignmentEngagementDayToggleBtn")
  const engagementGrid = root?.querySelector(".assignment-engagement-grid")
  dayListToggle?.addEventListener("click", () => {
    const collapsed = engagementGrid?.classList.toggle("is-day-list-collapsed") || false
    dayListToggle.setAttribute("aria-expanded", collapsed ? "false" : "true")
    dayListToggle.textContent = collapsed ? "Show class days" : "Hide class days"
  })
  root?.querySelector("#assignmentEngagementReloadBtn")?.addEventListener("click", () => load({ force: true }))
  root?.querySelector("#assignmentEngagementSearch")?.addEventListener("input", (event) => { state.assignmentEngagement.search = normalizeText(event.target.value); render() })
  root?.querySelector("#assignmentEngagementAudienceFilter")?.addEventListener("change", (event) => { state.assignmentEngagement.audience = normalizeText(event.target.value); render() })
  root?.querySelector("#assignmentEngagementReminderFilter")?.addEventListener("change", (event) => { state.assignmentEngagement.reminderKind = normalizeText(event.target.value); render() })
  root?.querySelector("#assignmentEngagementStatusFilter")?.addEventListener("change", (event) => { state.assignmentEngagement.status = normalizeText(event.target.value); render() })
  return { load, render }
}
