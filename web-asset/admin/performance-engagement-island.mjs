// PERF-CONTRACT: ADMIN-PERFORMANCE-ISLAND
// Performance-engagement code is route-owned and must not return to the critical admin bundle.
export function initPerformanceEngagementIsland({ document, state, api, helpers = {} }) {
  const {
    normalizeText, normalizeLower, compareTableText, compareTableIsoDate,
    applySortDirection, rowWeekNumber, escapeHtml,
  } = helpers;
  const engagementDayHeading = helpers.engagementDayHeading || ((date, weekNumber) => {
    const dateText = normalizeText(date) || "Unknown day";
    return weekNumber ? `${dateText} | Week ${weekNumber}` : dateText;
  });

function normalizePerformanceEngagementSortField(field = "") {
  const normalized = normalizeText(field);
  if (
    [
      "reviewed",
      "id",
      "englishName",
      "level",
      "sentOkReturned",
      "emailOpened",
      "linkClicked",
      "pdfDownloaded",
      "acknowledged",
      "classDate",
      "classDay",
      "className",
      "reportId",
    ].includes(normalized)
  ) {
    return normalized;
  }
  return "classDate";
}

function normalizePerformanceEngagementRows(rows = []) {
  const source = Array.isArray(rows) ? rows : [];
  return source
    .map((row) => {
      const normalized = row && typeof row === "object" ? { ...row } : null;
      if (!normalized) return null;
      normalized.reviewed = normalizeText(normalized.reviewed);
      normalized.id = normalizeText(normalized.id);
      normalized.emailUsed = normalizeText(normalized.emailUsed);
      normalized.englishName = normalizeText(normalized.englishName);
      normalized.level = normalizeText(normalized.level);
      normalized.sentOkReturned = normalizeText(normalized.sentOkReturned);
      normalized.emailOpened = normalizeText(normalized.emailOpened);
      normalized.linkClicked = normalizeText(normalized.linkClicked);
      normalized.pdfDownloaded = normalizeText(normalized.pdfDownloaded);
      normalized.acknowledged = normalizeText(normalized.acknowledged);
      normalized.classDate = normalizeText(normalized.classDate);
      normalized.classDay = normalizeText(normalized.classDay);
      normalized.className = normalizeText(normalized.className);
      normalized.reportId = normalizeText(normalized.reportId);
      normalized.searchText = normalizeText(normalized.searchText);
      normalized.roleOrder = normalized.reviewed === "parent" ? 0 : 1;
      return normalized;
    })
    .filter(Boolean);
}

function performanceEngagementGroupKey(row = {}) {
  return normalizeText(row?.reportId) || `${normalizeText(row?.classDate)}-${normalizeText(row?.id)}`
}

function comparePerformanceEngagementGroupRows(left = {}, right = {}) {
  if (left.roleOrder !== right.roleOrder) return left.roleOrder - right.roleOrder;
  const nameCompare = compareTableText(left.englishName || left.id, right.englishName || right.id);
  if (nameCompare) return nameCompare;
  const reviewedCompare = compareTableText(left.reviewed, right.reviewed);
  if (reviewedCompare) return reviewedCompare;
  return compareTableText(left.id, right.id);
}

function performanceEngagementRowsForSelection() {
  const selectedDayKey = normalizeText(state.performanceEngagement?.selectedDayKey);
  const rows = normalizePerformanceEngagementRows(state.performanceEngagement?.rows);
  const filtered = rows.filter((row) => performanceEngagementRowMatchesFilters(row, Boolean(selectedDayKey), true));
  const grouped = new Map();
  filtered.forEach((row) => {
    const key = performanceEngagementGroupKey(row);
    const entry = grouped.get(key) || {
      reportId: normalizeText(row.reportId),
      classDate: normalizeText(row.classDate),
      classDay: normalizeText(row.classDay),
      className: normalizeText(row.className),
      sortRow: row,
      rows: [],
      searchText: "",
    };
    entry.rows.push(row);
    if (entry.sortRow.roleOrder > row.roleOrder) entry.sortRow = row;
    entry.searchText = `${entry.searchText} ${row.searchText}`.trim();
    grouped.set(key, entry);
  });
  return Array.from(grouped.values())
    .filter((entry) => {
      const hasParent = entry.rows.some((row) => row.reviewed === "parent");
      const hasStudent = entry.rows.some((row) => row.reviewed === "student");
      const searchMatches = !normalizeText(state.performanceEngagement?.search)
        || entry.rows.some((row) => performanceEngagementRowMatchesFilters(row, Boolean(selectedDayKey), false));
      return hasParent && hasStudent && searchMatches;
    })
    .map((entry) => {
      entry.rows.sort(comparePerformanceEngagementGroupRows);
      entry.searchText = normalizeLower(entry.searchText);
      return entry;
    })
    .sort((left, right) => {
      const sortField =
        normalizePerformanceEngagementSortField(state.performanceEngagement?.sortField);
      const sortDir =
        normalizeLower(state.performanceEngagement?.sortDir) === "asc" ? "asc" : "desc";
      let compareValue;
      const leftRow =
        left.rows.find((row) => row.reviewed === "student") || left.sortRow || left.rows[0] || {};
      const rightRow =
        right.rows.find((row) => row.reviewed === "student") || right.sortRow || right.rows[0] || {};
      if (sortField === "reviewed") compareValue = compareTableText(leftRow.reviewed, rightRow.reviewed);
      else if (sortField === "id") compareValue = compareTableText(leftRow.id, rightRow.id);
      else if (sortField === "englishName") compareValue = compareTableText(leftRow.englishName, rightRow.englishName);
      else if (sortField === "level") compareValue = compareTableText(leftRow.level, rightRow.level);
      else if (sortField === "sentOkReturned") compareValue = compareTableText(leftRow.sentOkReturned, rightRow.sentOkReturned);
      else if (sortField === "emailOpened") compareValue = compareTableText(leftRow.emailOpenedAt, rightRow.emailOpenedAt);
      else if (sortField === "linkClicked") compareValue = compareTableText(leftRow.linkClickedAt, rightRow.linkClickedAt);
      else if (sortField === "pdfDownloaded") compareValue = compareTableText(leftRow.pdfDownloadedAt, rightRow.pdfDownloadedAt);
      else if (sortField === "acknowledged") compareValue = compareTableText(leftRow.acknowledgedAt, rightRow.acknowledgedAt);
      else if (sortField === "classDay") compareValue = compareTableText(leftRow.classDay, rightRow.classDay);
      else if (sortField === "className") compareValue = compareTableText(leftRow.className, rightRow.className);
      else if (sortField === "reportId") compareValue = compareTableText(leftRow.reportId, rightRow.reportId);
      else compareValue = compareTableIsoDate(leftRow.classDate, rightRow.classDate);
      if (compareValue === 0) compareValue = compareTableText(leftRow.className, rightRow.className);
      if (compareValue === 0) compareValue = compareTableText(leftRow.reportId, rightRow.reportId);
      if (compareValue === 0) compareValue = comparePerformanceEngagementGroupRows(leftRow, rightRow);
      return applySortDirection(compareValue, sortDir);
    });
}

function performanceEngagementRowMatchesFilters(row = {}, includeSelectedDay = true, ignoreSearch = false) {
  const searchTerms = ignoreSearch ? [] : normalizeText(state.performanceEngagement?.search)
    .split("|").map((term) => normalizeLower(term)).filter(Boolean);
  const role = normalizeLower(state.performanceEngagement?.role);
  const level = normalizeLower(state.performanceEngagement?.level);
  const delivery = normalizeLower(state.performanceEngagement?.delivery);
  const selectedDayKey = normalizeText(state.performanceEngagement?.selectedDayKey);
  const isTrue = (value) => ["yes", "true", "1"].includes(normalizeLower(value));
  if (includeSelectedDay && selectedDayKey && normalizeText(row.classDate) !== selectedDayKey) return false;
  if (role && normalizeLower(row.reviewed) !== role) return false;
  if (level && normalizeLower(row.level) !== level) return false;
  const searchHaystack = [
    row.searchText,
    row.reviewed,
    row.id,
    row.englishName,
    row.level,
    row.classDate,
    row.classDay,
    row.className,
    row.reportId,
  ].map((value) => normalizeLower(value)).filter(Boolean).join(" ");
  if (searchTerms.length && !searchTerms.every((term) => searchHaystack.includes(term))) return false;
  if (delivery === "not-opened" && isTrue(row.emailOpened)) return false;
  if (delivery === "opened" && !isTrue(row.emailOpened)) return false;
  if (delivery === "clicked" && !isTrue(row.linkClicked)) return false;
  if (delivery === "acknowledged" && !isTrue(row.acknowledged)) return false;
  return true;
}

function renderPerformanceEngagementDayList() {
  const listEl = document.getElementById("performanceEngagementDayList");
  const summaryEl = document.getElementById("performanceEngagementHomeSummary");
  if (!listEl || !summaryEl) return;
  const rows = normalizePerformanceEngagementRows(state.performanceEngagement?.rows);
  const groupedDays = new Map();
  rows.forEach((row) => {
    if (!performanceEngagementRowMatchesFilters(row, false)) return;
    const dayKey = normalizeText(row.classDate) || "unknown";
    const day = groupedDays.get(dayKey) || {
      dayKey,
      classDate: normalizeText(row.classDate),
      classDay: normalizeText(row.classDay),
      weekNumber: rowWeekNumber("performance", row),
      classNames: new Set(),
      reports: new Set(),
      rowCount: 0,
      sentCount: 0,
      openCount: 0,
      clickCount: 0,
      pdfCount: 0,
      ackCount: 0,
    };
    day.classNames.add(normalizeText(row.className));
    if (normalizeText(row.reportId)) day.reports.add(normalizeText(row.reportId));
    day.rowCount += 1;
    if (row.sentOkReturned === "yes") day.sentCount += 1;
    if (row.emailOpened) day.openCount += 1;
    if (row.linkClicked) day.clickCount += 1;
    if (row.pdfDownloaded) day.pdfCount += 1;
    if (row.acknowledged) day.ackCount += 1;
    groupedDays.set(dayKey, day);
  });
  const days = Array.from(groupedDays.values()).sort((left, right) =>
    compareTableIsoDate(right.classDate, left.classDate),
  );
  if (!state.performanceEngagement.selectedDayKey && days.length) {
    state.performanceEngagement.selectedDayKey = days[0].dayKey;
  }
  const selectedStillExists = days.some(
    (day) => normalizeText(day.dayKey) === normalizeText(state.performanceEngagement.selectedDayKey),
  );
  if (!selectedStillExists && days.length) {
    state.performanceEngagement.selectedDayKey = days[0].dayKey;
  }
  summaryEl.textContent = days.length
    ? `${days.length} class day${days.length === 1 ? "" : "s"} | ${rows.length} tracked rows`
    : "No RC engagement rows matched the current search.";
  listEl.innerHTML = "";
  if (!days.length) {
    listEl.innerHTML = '<div class="small">No class days found.</div>';
    return;
  }
  days.forEach((day) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      normalizeText(state.performanceEngagement.selectedDayKey) === normalizeText(day.dayKey) ?
        "performance-engagement-day-card card is-active"
      : "performance-engagement-day-card card";
    button.dataset.surfaceRole = "card";
    button.innerHTML = `
      <strong>${escapeHtml(engagementDayHeading(day.classDate, day.weekNumber))}</strong>
      <span class="small">${escapeHtml(`reports=${day.reports.size} | rows=${day.rowCount} | opens=${day.openCount} | clicks=${day.clickCount} | pdf=${day.pdfCount}`)}</span>
    `;
    button.addEventListener("click", () => {
      state.performanceEngagement.selectedDayKey = day.dayKey;
      state.performanceEngagement.selectedReportId = "";
      renderPerformanceEngagementPage();
    });
    listEl.appendChild(button);
  });
}

function renderPerformanceEngagementRows() {
  const rowsEl = document.getElementById("performanceEngagementRows");
  const summaryEl = document.getElementById("performanceEngagementTableSummary");
  const selectedDayEl = document.getElementById("performanceEngagementSelectedDaySummary");
  if (!rowsEl || !summaryEl || !selectedDayEl) return;
  updatePerformanceEngagementSortIndicators();
  const engagementRows = performanceEngagementRowsForSelection();
  const selectedDay = normalizeText(state.performanceEngagement.selectedDayKey);
  const day = normalizeText(
    state.performanceEngagement.days?.find((entry) => normalizeText(entry.dayKey) === selectedDay)?.classDay,
  );
  const date = normalizeText(
    state.performanceEngagement.days?.find((entry) => normalizeText(entry.dayKey) === selectedDay)?.classDate,
  );
  selectedDayEl.textContent = selectedDay
    ? `${day || "Selected day"} | ${date || selectedDay}`
    : "No class day selected.";
  summaryEl.textContent = engagementRows.length
    ? `${engagementRows.length} report groups | ${engagementRows.reduce((sum, entry) => sum + entry.rows.length, 0)} tracked rows`
    : "No engagement rows matched this day and search.";
  rowsEl.innerHTML = "";
  if (!engagementRows.length) {
    rowsEl.innerHTML = '<tr><td colspan="9">No engagement rows for the selected class day.</td></tr>';
    return;
  }
  engagementRows.forEach((group, groupIndex) => {
    group.rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");
      if (group.rows.length > 1 && rowIndex === 0) tr.classList.add("pair-start");
      if (group.rows.length > 1 && rowIndex === group.rows.length - 1) tr.classList.add("pair-end");
      const reviewedClass =
        normalizeLower(row.reviewed) === "parent" ? "is-parent"
        : normalizeLower(row.reviewed) === "student" ? "is-student"
        : "";
      const sentClass =
        normalizeLower(row.sentOkReturned) === "no" ? "is-no"
        : normalizeLower(row.sentOkReturned) === "yes" ? "is-yes"
        : "is-empty";
      const emailClass = row.emailOpenedAt ? "is-set" : "is-empty";
      const linkClass = row.linkClickedAt ? "is-set" : "is-empty";
      const pdfClass = row.pdfDownloadedAt ? "is-set" : "is-empty";
      const ackClass = row.acknowledgedAt ? "is-set" : "is-empty";
      tr.innerHTML = `
        <td class="performance-engagement-reviewed-cell ${reviewedClass}">${escapeHtml(row.reviewed || "-")}</td>
        <td title="Email used: ${escapeHtml(row.emailUsed || "not available")}">${escapeHtml(row.id || "-")}</td>
        <td>${escapeHtml(row.englishName || "-")}</td>
        <td>${escapeHtml(row.level || "-")}</td>
        <td class="performance-engagement-status-cell ${sentClass}" title="${escapeHtml(row.sentOkReturned)}">${escapeHtml(row.sentOkReturned || "-")}</td>
        <td class="performance-engagement-event-cell ${emailClass}" title="${escapeHtml(row.emailOpenedAt || "")}">${escapeHtml(row.emailOpened || "-")}</td>
        <td class="performance-engagement-event-cell ${linkClass}" title="${escapeHtml(row.linkClickedAt || "")}">${escapeHtml(row.linkClicked || "-")}</td>
        <td class="performance-engagement-event-cell ${pdfClass}" title="${escapeHtml(row.pdfDownloadedAt || "")}">${escapeHtml(row.pdfDownloaded || "-")}</td>
        <td class="performance-engagement-event-cell ${ackClass}" title="${escapeHtml(row.acknowledgedAt || "")}">${escapeHtml(row.acknowledged || "-")}</td>
        <td>${escapeHtml(row.emailUsed || "-")}</td>
      `;
      rowsEl.appendChild(tr);
    });
    if (groupIndex < engagementRows.length - 1 && group.rows.length > 1
      && engagementRows[groupIndex + 1]?.rows?.length > 1) {
      const spacer = document.createElement("tr");
      spacer.className = "performance-engagement-pair-spacer";
      spacer.setAttribute("aria-hidden", "true");
      spacer.innerHTML = '<td colspan="10"></td>';
      rowsEl.appendChild(spacer);
    }
  });
}

function renderPerformanceEngagementPage() {
  renderPerformanceEngagementDayList();
  renderPerformanceEngagementRows();
  updatePerformanceEngagementSortIndicators();
}

async function loadPerformanceEngagementData({ force = false } = {}) {
  const current = state.performanceEngagement || {};
  if (current.loading) return;
  if (current.loaded && !force) {
    renderPerformanceEngagementPage();
    return;
  }
  current.loading = true;
  state.performanceEngagement = { ...current };
  try {
    const params = new globalThis.URLSearchParams();
    const response = await api(
      `/api/admin/performance-engagement${params.toString() ? `?${params.toString()}` : ""}`,
    );
    state.performanceEngagement = {
      ...state.performanceEngagement,
      loaded: true,
      loading: false,
      generatedAt: normalizeText(response?.generatedAt),
      days: Array.isArray(response?.days) ? response.days : [],
      rows: Array.isArray(response?.rows) ? response.rows : [],
    };
    const performanceSearchEl = document.getElementById("performanceEngagementSearch");
    if (performanceSearchEl && performanceSearchEl.dataset.engagementSearchBound !== "true") {
      performanceSearchEl.addEventListener("input", (event) => {
        state.performanceEngagement.search = normalizeText(event?.target?.value);
        renderPerformanceEngagementPage();
      });
      performanceSearchEl.dataset.engagementSearchBound = "true";
    }
    const performanceRoleEl = document.getElementById("performanceEngagementRoleFilter");
    if (performanceRoleEl && performanceRoleEl.dataset.engagementFilterBound !== "true") {
      performanceRoleEl.addEventListener("change", (event) => {
        state.performanceEngagement.role = normalizeText(event?.target?.value);
        renderPerformanceEngagementPage();
      });
      performanceRoleEl.dataset.engagementFilterBound = "true";
    }
    const performanceLevelEl = document.getElementById("performanceEngagementLevelFilter");
    if (performanceLevelEl && performanceLevelEl.dataset.engagementFilterBound !== "true") {
      performanceLevelEl.addEventListener("change", (event) => {
        state.performanceEngagement.level = normalizeText(event?.target?.value);
        renderPerformanceEngagementPage();
      });
      performanceLevelEl.dataset.engagementFilterBound = "true";
    }
    const performanceDeliveryEl = document.getElementById("performanceEngagementDeliveryFilter");
    if (performanceDeliveryEl && performanceDeliveryEl.dataset.engagementFilterBound !== "true") {
      performanceDeliveryEl.addEventListener("change", (event) => {
        state.performanceEngagement.delivery = normalizeText(event?.target?.value);
        renderPerformanceEngagementPage();
      });
      performanceDeliveryEl.dataset.engagementFilterBound = "true";
    }
    if (
      state.performanceEngagement.selectedDayKey
      && !state.performanceEngagement.days.some(
        (day) => normalizeText(day.dayKey) === normalizeText(state.performanceEngagement.selectedDayKey),
      )
    ) {
      state.performanceEngagement.selectedDayKey = "";
    }
    renderPerformanceEngagementPage();
  } catch (error) {
    state.performanceEngagement = {
      ...state.performanceEngagement,
      loaded: true,
      loading: false,
      days: [],
      rows: [],
    };
    renderPerformanceEngagementPage();
    throw error;
  }
}

function bindPerformanceEngagementSortHeaderEvents() {
  document
    .querySelectorAll("th[data-performance-engagement-sort]")
    .forEach((thEl) => {
      if (thEl.dataset.sortBound === "1") return;
      thEl.dataset.sortBound = "1";
      const onSort = () => {
        const field = normalizeText(
          thEl.getAttribute("data-performance-engagement-sort"),
        );
        if (!field) return;
        const currentField = normalizePerformanceEngagementSortField(
          state.performanceEngagement?.sortField,
        );
        const nextDir =
          currentField === field &&
          normalizeLower(state.performanceEngagement?.sortDir) === "desc" ?
            "asc"
          : currentField === field ?
            "desc"
          : "desc";
        state.performanceEngagement.sortField = field;
        state.performanceEngagement.sortDir = nextDir;
        renderPerformanceEngagementRows();
        updatePerformanceEngagementSortIndicators();
      };
      thEl.addEventListener("click", onSort);
      thEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSort();
      });
    });
}

function updatePerformanceEngagementSortIndicators() {
  document
    .querySelectorAll("th[data-performance-engagement-sort]")
    .forEach((thEl) => {
      const field = normalizeText(
        thEl.getAttribute("data-performance-engagement-sort"),
      );
      const activeState = state.performanceEngagement || {};
      const activeField = normalizePerformanceEngagementSortField(
        activeState.sortField,
      );
      const active = activeField === field;
      const ascending = normalizeLower(activeState.sortDir) === "asc";
      thEl.classList.toggle("sort-active-asc", active && ascending);
      thEl.classList.toggle("sort-active-desc", active && !ascending);
      thEl.setAttribute(
        "aria-sort",
        active ? (ascending ? "ascending" : "descending") : "none",
      );
    });
}



  return {
    load: loadPerformanceEngagementData,
    render: renderPerformanceEngagementPage,
    bind: bindPerformanceEngagementSortHeaderEvents,
  };
}
