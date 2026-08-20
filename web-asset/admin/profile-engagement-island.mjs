/* PERF-CONTRACT: PROFILE-ENGAGEMENT-ISLAND */

import { clearEngagementMatrix, formatEngagementGroupHeader, renderEngagementMatrix } from "/web-asset/admin/engagement-matrix.mjs?v=20260801-sivb"

export function initProfileEngagementIsland({ document, api, onError }) {
  const rowsEl = document.getElementById("profileEngagementRows")
  const summaryEl = document.getElementById("profileEngagementSummary")
  const searchEl = document.getElementById("profileEngagementSearch")
  const reloadEl = document.getElementById("profileEngagementReloadBtn")
  let rows = []
  let renderVersion = 0
  let renderQueue = Promise.resolve()

  const normalize = (value) => value === undefined || value === null ? "" : String(value).trim()
  const lower = (value) => normalize(value).toLowerCase()
  const visibleRows = () => {
    const terms = normalize(searchEl?.value).toLowerCase().split("|").map((value) => value.trim()).filter(Boolean)
    if (!terms.length) return rows
    return rows.filter((row) => terms.every((term) => [row.parentsId, row.familyId, row.eaglesIds, row.learners, row.parentName, row.parentEmail].join(" ").toLowerCase().includes(term)))
  }

  const metric = (row = {}) => {
    const brevo = row.brevoDelivery || {}
    const invitationField = (field) => row[`invitation${field[0].toUpperCase()}${field.slice(1)}`] || ""
    const event = (field) => brevo[field] || invitationField(field)
    const yes = (field) => event(field) ? "yes" : ""
    const parentsId = normalize(row.parentsId || row.id)
    const familyId = normalize(row.familyId)
    const eaglesIds = normalize(row.eaglesIds || row.id) || "-"
    return {
      groupKey: `${parentsId || "Unassigned"}: ${familyId || "Unassigned"} - ${eaglesIds}`,
      batchId: normalize(brevo.batchId),
      queueType: normalize(brevo.queueType || "profile-invitation"),
      providerMessageId: normalize(brevo.providerMessageId),
      reviewed: "parent/adult",
      id: parentsId,
      familyId,
      englishName: normalize(row.parentName),
      level: "",
      emailUsed: normalize(row.parentEmail),
      parentName: normalize(row.parentName),
      parentEmail: normalize(row.parentEmail),
      learners: normalize(row.learners),
      profileComplete: normalize(row.profileComplete),
      invitationStatus: normalize(row.invitationStatus),
      emailQueued: event("queuedAt") || row.invitationQueuedAt ? "yes" : "",
      emailQueuedAt: event("queuedAt") || row.invitationQueuedAt || "",
      emailSent: event("sentAt") || row.invitationSentAt ? "yes" : "",
      emailSentAt: event("sentAt") || row.invitationSentAt || "",
      emailDelivered: yes("deliveredAt"), emailDeliveredAt: event("deliveredAt"),
      emailProxy: yes("proxyLoadedAt"), emailProxyAt: event("proxyLoadedAt"),
      emailFirst: yes("firstOpenedAt"), emailFirstAt: event("firstOpenedAt"),
      emailUnique: yes("uniqueOpenedAt"), emailUniqueAt: event("uniqueOpenedAt"),
      emailOpened: yes("openedAt"), emailOpenedAt: event("openedAt"),
      emailClicked: yes("clickedAt"), emailClickedAt: event("clickedAt"),
      emailDeferred: yes("deferredAt"), emailDeferredAt: event("deferredAt"),
      emailError: yes("errorAt"), emailErrorAt: event("errorAt"),
      emailInvalid: yes("invalidAt"), emailInvalidAt: event("invalidAt"),
      emailBlocked: yes("blockedAt"), emailBlockedAt: event("blockedAt"),
      emailSoft: yes("softBouncedAt"), emailSoftAt: event("softBouncedAt"),
      emailHard: yes("hardBouncedAt"), emailHardAt: event("hardBouncedAt"),
      emailComplained: yes("complainedAt"), emailComplainedAt: event("complainedAt"),
      emailUnsubscribed: yes("unsubscribedAt"), emailUnsubscribedAt: event("unsubscribedAt"),
      searchText: [row.parentsId, row.familyId, row.eaglesIds, row.parentName, row.parentEmail, row.learners].map(lower).join(" "),
    }
  }

  const render = async () => {
    if (!rowsEl) return
    const visible = visibleRows()
    if (summaryEl) summaryEl.textContent = `${visible.length} parent/adult family records | ${visible.reduce((sum, row) => sum + Number(row.learnerCount || 0), 0)} learners`
    const version = ++renderVersion
    renderQueue = renderQueue.catch(() => {}).then(async () => {
      if (version !== renderVersion) return
      if (!visible.length) {
        clearEngagementMatrix(rowsEl)
        rowsEl.textContent = "No profile engagement rows match the current search."
        return
      }
      await renderEngagementMatrix(rowsEl, visible.map(metric), {
        groupBy: "groupKey",
        profileMode: true,
        groupHeader: formatEngagementGroupHeader,
      })
    })
    return renderQueue
  }

  const load = async () => {
    try {
      const payload = await api("/api/admin/profile-engagement?take=2000")
      rows = Array.isArray(payload?.rows) ? payload.rows : []
      await render()
    } catch (error) {
      if (summaryEl) summaryEl.textContent = error?.message || "Profile engagement unavailable."
      onError(error)
    }
  }

  searchEl?.addEventListener("input", () => render().catch(onError))
  reloadEl?.addEventListener("click", () => load())
  return { load, render }
}
