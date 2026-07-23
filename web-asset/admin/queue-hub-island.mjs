// PERF-CONTRACT: ADMIN-QUEUE-HUB-ISLAND
// Queue Hub data, normalization, and rendering stay out of dashboard startup.
export function initQueueHubIsland({ document, state, api, helpers = {}, onQueueHubItemOpen, onOverviewNewsQueueUpdate }) {
  const {
    normalizeText, normalizeQueueHubPanelOrder, persistUiSettings, persistUiSettingsToServer,
    formatDateTime, formatPortalWeekRange, fullLevelLabel, resolveSystemLevelName,
    newsReviewAdminSetStatusToken, newsReviewWeekSetActionToken, weeklyMinimumNewsReports,
    newsReviewStatusChipHtml, newsReviewStatusLabel, newsReviewSetActionChipHtml,
    newsReviewSetActionLabel, escapeHtml,
    defaultPanelOrder = [], canManageUsers, setStatus,
  } = helpers;
  const panelIds = Array.isArray(helpers.panelIds) ? helpers.panelIds : [];
  const queueHubPath = helpers.queueHubPath || "/api/admin/queue-hub";
  const fixedTimeZone = helpers.fixedTimeZone || "Asia/Ho_Chi_Minh";
function setQueueHubStatus(message = "", isError = false) {
  const statusEl = document.getElementById("queueHubStatus");
  if (!statusEl) return;
  statusEl.style.color = isError ? "#b3262d" : "var(--portal-status-muted-text)";
  statusEl.textContent =
    normalizeText(message) || "Queue hub data not loaded yet.";
}

function queueHubPanelTitle(panelId = "") {
  const id = normalizeText(panelId);
  switch (id) {
    case "queued-performance-reports":
      return "Queued Performance Reports";
    case "unmatched-exercise-submissions":
      return "Exercise Submissions (Unmatched eaglesId)";
    case "current-assignments-pending":
      return "Current Assignments Not Yet Completed";
    case "overdue-homework":
      return "Past Overdue Homework";
    case "attendance-risk":
      return "At-Risk Attendance";
    case "news-report-review":
      return "News Week Sets (7 Reports)";
    case "pending-profile-submissions":
      return "Pending Profile Submissions";
    default:
      return id || "Queue Panel";
  }
}

function normalizeQueueHubPanelForUi(panel = {}) {
  const id = normalizeText(panel?.id);
  return {
    id,
    title: normalizeText(panel?.title) || queueHubPanelTitle(id),
    total: Math.max(0, Number.parseInt(String(panel?.total || 0), 10) || 0),
    items: Array.isArray(panel?.items) ? panel.items : [],
    deferred: Boolean(panel?.deferred),
  };
}

function queueHubCellHtml(html = "", text = "") {
  return {
    html: normalizeText(html),
    text: normalizeText(text),
    allowHtml: true,
  };
}

function extractEaglesIdFromText(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  const match = normalized.match(/\bEagles ID:\s*([A-Za-z0-9_-]+)/i);
  return normalizeText(match?.[1] || "");
}

function queueHubQueuedPerformanceReportSummary(item = {}) {
  const daySource = normalizeText(item?.scheduledFor || item?.queuedAt);
  const dayOfWeek = daySource ?
        new Date(daySource).toLocaleDateString("vi-VN", { weekday: "long", timeZone: fixedTimeZone })
    : "";
  const recipients = Array.isArray(item?.recipients) ? item.recipients : [];
  const payload = item?.payloadJson && typeof item.payloadJson === "object" ? item.payloadJson : {};
  return [
    normalizeText(
      item?.eaglesId ||
        payload?.eaglesId ||
        payload?.student?.eaglesId ||
        payload?.studentRef?.eaglesId ||
        extractEaglesIdFromText(item?.message || payload?.message || ""),
        "",
    ),
    dayOfWeek,
    recipients.length ? "has recipients" : "No recipients",
  ]
    .filter(Boolean)
    .join("; ");
}

function normalizeQueueHubCell(value = "") {
  if (value && typeof value === "object") {
    const html = normalizeText(value?.html);
    const text = normalizeText(value?.text);
    if (html) {
      return {
        html,
        text,
        allowHtml: value?.allowHtml !== false,
      };
    }
    return {
      html: "",
      text,
      allowHtml: false,
    };
  }
  return {
    html: "",
    text: normalizeText(value),
    allowHtml: false,
  };
}

function queueHubTableSpec(panelId = "") {
  switch (panelId) {
    case "queued-performance-reports":
      return {
        columns: ["Queued At", "Performance Report", "Status", "Level", "Queued By"],
        openColumnIndex: 1,
        row: (item) => [
          formatDateTime(item?.queuedAt),
          normalizeText(queueHubQueuedPerformanceReportSummary(item) || ""),
          normalizeText(item?.status),
          normalizeText(item?.level),
          normalizeText(item?.queuedByUsername),
        ],
        emptyText: "No queued performance reports.",
      };
    case "unmatched-exercise-submissions":
      return {
        columns: [
          "Received",
          "Eagles ID",
          "Email",
          "Exercise",
          "Score",
          "Status",
        ],
        openColumnIndex: 3,
        row: (item) => {
          const totalQuestions = Math.max(
            0,
            Number.parseInt(String(item?.totalQuestions || 0), 10) || 0,
          );
          const correctCount = Math.max(
            0,
            Number.parseInt(String(item?.correctCount || 0), 10) || 0,
          );
          const scorePercent = Number(item?.scorePercent || 0);
          const scoreLabel =
            totalQuestions > 0 ?
              `${correctCount}/${totalQuestions} (${Number.isFinite(scorePercent) ? scorePercent.toFixed(1) : "0.0"}%)`
            : `${Number.isFinite(scorePercent) ? scorePercent.toFixed(1) : "0.0"}%`;
          return [
            formatDateTime(item?.createdAt),
            normalizeText(item?.submittedEaglesId || "(not provided)"),
            normalizeText(item?.submittedEmail),
            normalizeText(item?.pageTitle),
            scoreLabel,
            normalizeText(item?.status),
          ];
        },
        emptyText: "No unmatched exercise submissions.",
      };
    case "current-assignments-pending":
      return {
        columns: ["Level", "Targeted", "Completed", "Pending", "Due At"],
        openColumnIndex: 0,
        row: (item) => {
          const targeted =
            Number.parseInt(
              String(
                item?.currentTargetedStudents ??
                  item?.targetedStudents ??
                  item?.enrolled ??
                  0,
              ),
              10,
            ) || 0;
          const completed =
            Number.parseInt(
              String(
                item?.currentCompletedStudents ?? item?.completedStudents ?? 0,
              ),
              10,
            ) || 0;
          const pending =
            Number.parseInt(
              String(
                item?.currentPendingStudents ??
                  item?.pendingStudents ??
                  (Array.isArray(item?.uncompletedStudents) ?
                    item.uncompletedStudents.length
                  : 0),
              ),
              10,
            ) || 0;
          return [
            fullLevelLabel(resolveSystemLevelName(item?.level || "")),
            String(targeted),
            String(completed),
            String(pending),
            formatDateTime(item?.dueAt || item?.nextDueAt || ""),
          ];
        },
        emptyText: "No current not-yet-completed assignment rows.",
      };
    case "overdue-homework":
      return {
        columns: ["Student", "Eagles ID", "Class", "Assignment", "Due At"],
        openColumnIndex: 0,
        row: (item) => [
          normalizeText(item?.fullName),
          normalizeText(item?.eaglesId || item?.studentRefId),
          normalizeText(item?.className),
          normalizeText(item?.assignmentName),
          formatDateTime(item?.dueAt),
        ],
        emptyText: "No overdue homework rows.",
      };
    case "attendance-risk":
      return {
        columns: ["Student", "Eagles ID", "Absences", "Late 30+", "Risk Score"],
        openColumnIndex: 0,
        row: (item) => {
          const absences = Math.max(
            0,
            Number.parseInt(String(item?.absences || 0), 10) || 0,
          );
          const late30 = Math.max(
            0,
            Number.parseInt(String(item?.late30Plus || 0), 10) || 0,
          );
          const riskScore = absences * 3 + late30 * 2;
          return [
            normalizeText(item?.fullName),
            normalizeText(item?.eaglesId || item?.studentRefId),
            String(absences),
            String(late30),
            String(riskScore),
          ];
        },
        emptyText: "No attendance risk rows.",
      };
    case "news-report-review":
      return {
        columns: [
          "Week Set",
          "Student",
          "Eagles ID",
          "Level",
          "Reports",
          "Status",
          "Action",
        ],
        openColumnIndex: 0,
        row: (item) => {
          const setStatus = newsReviewAdminSetStatusToken(item);
          const setAction = normalizeText(
            item?.setAction || newsReviewWeekSetActionToken(item),
          );
          return [
            formatPortalWeekRange(item?.weekStart, item?.weekEnd),
            normalizeText(item?.fullName || item?.student?.fullName),
            normalizeText(
              item?.eaglesId || item?.student?.eaglesId || item?.studentRefId,
            ),
            fullLevelLabel(resolveSystemLevelName(item?.level || "")),
            `${Math.max(0, Number.parseInt(String(item?.reportCount || 0), 10) || 0)}/${weeklyMinimumNewsReports()}`,
            queueHubCellHtml(
              newsReviewStatusChipHtml(setStatus),
              newsReviewStatusLabel(setStatus),
            ),
            queueHubCellHtml(
              newsReviewSetActionChipHtml(setAction),
              newsReviewSetActionLabel(setAction),
            ),
          ];
        },
        emptyText: "No weeks found.",
      };
    case "pending-profile-submissions":
      return {
        columns: [
          "Submitted At",
          "Submission",
          "Student Ref",
          "Status",
          "Failure Point",
        ],
        openColumnIndex: 1,
        row: (item) => [
          formatDateTime(item?.submittedAt || item?.updatedAt),
          normalizeText(item?.id),
          normalizeText(item?.studentRefId),
          normalizeText(item?.status),
          normalizeText(item?.failurePoint),
        ],
        emptyText: "No pending profile submissions.",
      };
    default:
      return {
        columns: ["Details"],
        row: (item) => [normalizeText(JSON.stringify(item))],
        emptyText: "No records.",
      };
  }
}

function queueHubPanelTableHtml(panel = {}) {
  const spec = queueHubTableSpec(panel?.id);
  const items = Array.isArray(panel?.items) ? panel.items : [];
  if (panel?.deferred) {
    return '<div class="queue-hub-empty data-surface" data-surface-role="data-surface">Panel deferred until Queue Hub is opened.</div>';
  }
  if (!items.length) {
    return `<div class="queue-hub-empty data-surface" data-surface-role="data-surface">${escapeHtml(spec.emptyText)}</div>`;
  }
  const visibleItems = items.slice(0, 25);
  const headerHtml = spec.columns
    .map((label) => `<th scope="col">${escapeHtml(label)}</th>`)
    .join("");
  const bodyHtml = visibleItems
    .map((item, index) => {
      const openColumnIndex = Number.parseInt(String(spec?.openColumnIndex), 10);
      const cells = spec
        .row(item)
        .map((value, cellIndex) => {
          const cell = normalizeQueueHubCell(value);
          const text = normalizeText(cell?.text);
          if (cellIndex === openColumnIndex) {
            return `<td><a href="#" class="queue-row-link" data-queue-hub-open-panel="${escapeHtml(normalizeText(panel?.id))}" data-queue-hub-open-index="${index}">${escapeHtml(text || "(open)")}</a></td>`;
          }
          if (cell?.allowHtml && cell?.html) {
            return `<td>${cell.html}</td>`;
          }
          return `<td>${escapeHtml(text)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const truncatedHint =
    items.length > visibleItems.length ?
      `<p class="small">Showing first ${visibleItems.length} of ${items.length} rows.</p>`
    : "";
  return `
  <div class="table-scroll-wrap data-surface" data-surface-role="data-surface">
    <table>
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  </div>
  ${truncatedHint}
`;
}

function queueHubPanelMapFromPayload(panels = []) {
  const map = {};
  const source = Array.isArray(panels) ? panels : [];
  source.forEach((entry) => {
    const panel = normalizeQueueHubPanelForUi(entry);
    if (!panel.id) return;
    map[panel.id] = panel;
  });
  panelIds.forEach((panelId) => {
    if (!map[panelId]) {
      map[panelId] = {
        id: panelId,
        title: queueHubPanelTitle(panelId),
        total: 0,
        items: [],
      };
    }
  });
  return map;
}

function queueHubOrderedPanels() {
  const panelOrder = normalizeQueueHubPanelOrder(state.queueHub.panelOrder);
  const panelsById =
    state.queueHub.panelsById && typeof state.queueHub.panelsById === "object" ?
      state.queueHub.panelsById
    : {};
  return panelOrder.map(
    (panelId) =>
      panelsById[panelId] || {
        id: panelId,
        title: queueHubPanelTitle(panelId),
        total: 0,
        items: [],
      },
  );
}

function markQueueHubOrderDirty(order = []) {
  const normalizedOrder = normalizeQueueHubPanelOrder(order);
  state.queueHub.panelOrder = normalizedOrder;
  state.queueHub.hasUnsavedOrder = true;
  persistUiSettings({
    ...state.uiSettings,
    queueHub: {
      ...(state.uiSettings?.queueHub || {}),
      panelOrder: normalizedOrder,
    },
  });
}

function moveQueueHubPanelBefore(panelId = "", beforePanelId = "") {
  const sourcePanelId = normalizeText(panelId);
  const targetPanelId = normalizeText(beforePanelId);
  const order = normalizeQueueHubPanelOrder(state.queueHub.panelOrder);
  const fromIndex = order.indexOf(sourcePanelId);
  const toIndex = order.indexOf(targetPanelId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
  order.splice(fromIndex, 1);
  order.splice(toIndex, 0, sourcePanelId);
  markQueueHubOrderDirty(order);
  renderQueueHubPanels();
  setQueueHubStatus(
    "Queue Hub order changed. Click Save Panel Order to persist.",
  );
}

function renderQueueHubPanels() {
  const panelRoot = document.getElementById("queueHubPanels");
  const saveBtn = document.getElementById("queueHubSaveOrderBtn");
  if (!panelRoot) return;
  const canReview = canManageUsers();
  panelRoot.innerHTML = "";
  if (!canReview) {
    panelRoot.innerHTML =
      '<div class="queue-hub-empty data-surface" data-surface-role="data-surface">Queue Hub is available for admin users only.</div>';
    if (saveBtn) saveBtn.disabled = true;
    return;
  }

  if (saveBtn) saveBtn.disabled = !state.queueHub.hasUnsavedOrder;
  const panels = queueHubOrderedPanels();
  if (!panels.length) {
    panelRoot.innerHTML =
      '<div class="queue-hub-empty data-surface" data-surface-role="data-surface">No queue hub panels available.</div>';
    return;
  }

  panels.forEach((panel) => {
    const panelEl = document.createElement("article");
    panelEl.className = `queue-hub-panel panel${state.queueHub.hasUnsavedOrder ? " queue-hub-order-dirty" : ""}`;
    panelEl.draggable = true;
    panelEl.dataset.queueHubPanelId = panel.id;
    panelEl.dataset.surfaceRole = "panel";
    panelEl.innerHTML = `
    <div class="queue-hub-panel-header">
      <h3>${escapeHtml(panel.title)}</h3>
      <span class="queue-hub-meta">total=${panel.total}</span>
    </div>
    ${queueHubPanelTableHtml(panel)}
  `;
    panelEl.addEventListener("dragstart", (event) => {
      state.queueHub.draggingPanelId = panel.id;
      panelEl.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", panel.id);
      }
    });
    panelEl.addEventListener("dragend", () => {
      state.queueHub.draggingPanelId = "";
      panelEl.classList.remove("dragging");
      panelRoot
        .querySelectorAll(".queue-hub-panel.drop-target")
        .forEach((entry) => entry.classList.remove("drop-target"));
    });
    panelEl.addEventListener("dragover", (event) => {
      event.preventDefault();
      panelEl.classList.add("drop-target");
    });
    panelEl.addEventListener("dragleave", () =>
      panelEl.classList.remove("drop-target"),
    );
    panelEl.addEventListener("drop", (event) => {
      event.preventDefault();
      panelEl.classList.remove("drop-target");
      const draggedPanelId = normalizeText(
        state.queueHub.draggingPanelId ||
          event.dataTransfer?.getData("text/plain"),
      );
      if (!draggedPanelId) return;
      moveQueueHubPanelBefore(draggedPanelId, panel.id);
    });
    panelRoot.appendChild(panelEl);
  });
}

function queueHubPanelById(panelId = "") {
  const id = normalizeText(panelId);
  if (!id) return null;
  const panelsById =
    state.queueHub?.panelsById && typeof state.queueHub.panelsById === "object" ?
      state.queueHub.panelsById
    : {};
  return panelsById[id] || null;
}

function queueHubItemByPanelIndex(panelId = "", rowIndex = 0) {
  const panel = queueHubPanelById(panelId);
  if (!panel || !Array.isArray(panel.items)) return null;
  const index = Math.max(0, Number.parseInt(String(rowIndex), 10) || 0);
  return panel.items[index] || null;
}



async function loadQueueHub({ notify = false, compact = false } = {}) {
  if (!canManageUsers()) {
    state.queueHub.loaded = true;
    state.queueHub.panelsById = {};
    state.queueHub.hasUnsavedOrder = false;
    renderQueueHubPanels();
    setQueueHubStatus("Queue Hub is hidden for this role.");
    return;
  }

  let payload;
  try {
    const requestPath = compact ? `${queueHubPath}?mode=compact` : queueHubPath;
    payload = await api(requestPath);
  } catch (error) {
    if (error && error.status === 404) {
      state.queueHub.loaded = true;
      state.queueHub.panelsById = {};
      state.queueHub.generatedAt = "";
      renderQueueHubPanels();
      setQueueHubStatus("Queue Hub API is not available on this runtime.", true);
      if (notify)
        setStatus("Queue Hub API is not available on this runtime.", true);
      return;
    }
    throw error;
  }

  state.queueHub.loaded = true;
  state.queueHub.generatedAt = normalizeText(payload?.generatedAt);
  state.queueHub.panelsById = queueHubPanelMapFromPayload(payload?.panels);
  if (!state.queueHub.hasUnsavedOrder) {
    const panelOrder = normalizeQueueHubPanelOrder(
      payload?.panelOrder || state.uiSettings?.queueHub?.panelOrder || [],
    );
    state.queueHub.panelOrder = panelOrder;
    persistUiSettings({
      ...state.uiSettings,
      queueHub: {
        ...(state.uiSettings?.queueHub || {}),
        panelOrder,
      },
    });
  }
  renderQueueHubPanels();
  onOverviewNewsQueueUpdate(
    state.queueHub?.panelsById?.["news-report-review"] || null,
  );
  const statusMessage = `Queue Hub loaded (${state.queueHub.generatedAt ? formatDateTime(state.queueHub.generatedAt) : "now"}).`;
  setQueueHubStatus(statusMessage);
  if (notify) setStatus(statusMessage);
}

async function saveQueueHubPanelOrder() {
  if (!canManageUsers())
    throw new Error("Only admin can save queue hub panel order.");
  const panelOrder = normalizeQueueHubPanelOrder(state.queueHub.panelOrder);
  persistUiSettings({
    ...state.uiSettings,
    queueHub: {
      ...(state.uiSettings?.queueHub || {}),
      panelOrder,
    },
  });
  await persistUiSettingsToServer(state.uiSettings, state.sisConfig, {
    notifyOnFailure: true,
  });
  state.queueHub.hasUnsavedOrder = false;
  renderQueueHubPanels();
  setQueueHubStatus("Queue Hub panel order saved.");
  setStatus("Queue Hub panel order saved.");
}

function resetQueueHubPanelOrder() {
  const panelOrder = normalizeQueueHubPanelOrder(
    defaultPanelOrder,
  );
  markQueueHubOrderDirty(panelOrder);
  renderQueueHubPanels();
  setQueueHubStatus(
    "Queue Hub panel order reset to default. Click Save Panel Order to persist.",
  );
}

  function bind() {
    document.getElementById("queueHubPanels")?.addEventListener("click", (event) => {
      const target = event?.target;
      const ElementCtor = globalThis.Element;
      if (typeof ElementCtor !== "function" || !(target instanceof ElementCtor)) return;
      const openBtn = target.closest("a[data-queue-hub-open-panel][data-queue-hub-open-index]");
      const HTMLAnchorElementCtor = globalThis.HTMLAnchorElement;
      if (
        typeof HTMLAnchorElementCtor !== "function" ||
        !(openBtn instanceof HTMLAnchorElementCtor)
      ) return;
      event.preventDefault();
      onQueueHubItemOpen?.(normalizeText(openBtn.getAttribute("data-queue-hub-open-panel")), Number.parseInt(normalizeText(openBtn.getAttribute("data-queue-hub-open-index")), 10) || 0);
    });
    document.getElementById("queueHubRefreshBtn")?.addEventListener("click", () => loadQueueHub({ notify: true }));
    document.getElementById("queueHubSaveOrderBtn")?.addEventListener("click", () => saveQueueHubPanelOrder().catch((error) => setStatus?.(error.message, true)));
    document.getElementById("queueHubResetOrderBtn")?.addEventListener("click", () => resetQueueHubPanelOrder());
  }

  return {
    load: loadQueueHub,
    render: renderQueueHubPanels,
    save: saveQueueHubPanelOrder,
    reset: resetQueueHubPanelOrder,
    bind,
    setStatus: setQueueHubStatus,
    itemAt(panelId = "", rowIndex = 0) {
      return queueHubItemByPanelIndex(panelId, rowIndex);
    },
  };
}
