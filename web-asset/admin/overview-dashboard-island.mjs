// PERF-CONTRACT: ADMIN-OVERVIEW-DASHBOARD-ISLAND
// The overview summary renderer is route-owned and must not return to the core
// admin bundle. It is loaded only when the overview dashboard has data to paint.

export function initOverviewDashboardIsland(deps = {}) {
  const {
    document,
    state,
    normalizeWeeklyAssignmentCompletion,
    sortLevelRows,
    isAssignedLevelRow,
    effectiveDashboardLevelCompletionRows,
    formatPercent,
    levelBadgeHtml,
    renderOverviewChartsAfterPaint,
    buildDashboardRiskLines,
    renderAttendanceAdminRiskSignals,
    renderPerformanceStagedSection,
  } = deps

  function renderDashboardSummary(summary = {}) {
    const today = summary.today || {};
    const assignments = summary.assignments || {};
    const weeklyAssignmentCompletion = normalizeWeeklyAssignmentCompletion(
      summary.weeklyAssignmentCompletion,
    );
    const classRows = sortLevelRows(
      (Array.isArray(summary.classEnrollmentAttendance) ?
        summary.classEnrollmentAttendance
      : []
      ).filter(isAssignedLevelRow),
    );
    const levelCompletion = effectiveDashboardLevelCompletionRows(summary);
    state.dashboardLevelCompletionRows = levelCompletion;
    const currentActiveLevels = levelCompletion.length;
    const currentTargetedStudents = levelCompletion.reduce((sum, row) => {
      const targeted =
        Number.parseInt(
          String(row?.totalAssignments ?? row?.enrolledStudents ?? 0),
          10,
        ) || 0;
      return sum + Math.max(0, targeted);
    }, 0);
    const currentCompletedStudents = levelCompletion.reduce((sum, row) => {
      const completed =
        Number.parseInt(
          String(row?.completedAssignments ?? row?.completedStudents ?? 0),
          10,
        ) || 0;
      return sum + Math.max(0, completed);
    }, 0);
    const currentPendingStudents = levelCompletion.reduce((sum, row) => {
      const explicitPending = Number.parseInt(
        String(row?.outstandingAssignments),
        10,
      );
      if (Number.isFinite(explicitPending))
        return sum + Math.max(0, explicitPending);
      const targeted =
        Number.parseInt(
          String(row?.totalAssignments ?? row?.enrolledStudents ?? 0),
          10,
        ) || 0;
      const completed =
        Number.parseInt(
          String(row?.completedAssignments ?? row?.completedStudents ?? 0),
          10,
        ) || 0;
      return sum + Math.max(0, targeted - completed);
    }, 0);
    const currentCompletionPercent =
      currentTargetedStudents > 0 ?
        (currentCompletedStudents / currentTargetedStudents) * 100
      : 0;
    const currentDueSoonLevels = levelCompletion.reduce((sum, row) => {
      const daysUntilDue = Number.parseInt(String(row?.daysUntilDue), 10);
      if (!Number.isFinite(daysUntilDue)) return sum;
      if (daysUntilDue < 0 || daysUntilDue > 2) return sum;
      return sum + 1;
    }, 0);
    const currentDueSoonPendingStudents = levelCompletion.reduce((sum, row) => {
      const daysUntilDue = Number.parseInt(String(row?.daysUntilDue), 10);
      if (!Number.isFinite(daysUntilDue)) return sum;
      if (daysUntilDue < 0 || daysUntilDue > 2) return sum;
      const explicitPending = Number.parseInt(
        String(row?.outstandingAssignments),
        10,
      );
      if (Number.isFinite(explicitPending))
        return sum + Math.max(0, explicitPending);
      const targeted =
        Number.parseInt(
          String(row?.totalAssignments ?? row?.enrolledStudents ?? 0),
          10,
        ) || 0;
      const completed =
        Number.parseInt(
          String(row?.completedAssignments ?? row?.completedStudents ?? 0),
          10,
        ) || 0;
      return sum + Math.max(0, targeted - completed);
    }, 0);
    const totalEnrollment = Math.max(
      0,
      Number(today.totalEnrollment ?? today.totalStudents ?? 0) || 0,
    );
    const attendanceCount = Math.max(0, Number(today.attendance || 0) || 0);
    const attendancePercentOfEnrollment =
      Number.isFinite(Number(today.attendancePercentOfEnrollment)) ?
        Number(today.attendancePercentOfEnrollment)
      : totalEnrollment > 0 ? (attendanceCount / totalEnrollment) * 100
      : 0;
    const unenrolledYtd = Math.max(0, Number(today.unenrolledYtd || 0) || 0);

    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    setValue("ovTotalEnrollment", String(totalEnrollment));
    setValue(
      "ovAttendancePctEnrollment",
      formatPercent(attendancePercentOfEnrollment),
    );
    setValue("ovUnenrolledYtd", String(unenrolledYtd));
    setValue("ovTodayAttendance", String(today.attendance || 0));
    setValue("ovTodayAbsences", String(today.absences || 0));
    setValue(
      "ovTardyRates",
      `${formatPercent(today.tardy10PlusPercent || 0)} / ${formatPercent(today.tardy30PlusPercent || 0)}`,
    );
    setValue("ovAtRiskCount", String(currentPendingStudents));
    setValue("ovOutstanding", String(currentCompletedStudents));
    setValue("ovOutstandingYtd", formatPercent(currentCompletionPercent));

    const privacyAlerts = Array.isArray(summary.analyticsOptOutAlerts) ? summary.analyticsOptOutAlerts : [];
    const privacySection = document.getElementById("overviewAnalyticsOptOutAlertsSection");
    const privacySummary = document.getElementById("overviewAnalyticsOptOutAlertsSummary");
    const privacyRows = document.getElementById("overviewAnalyticsOptOutAlertRows");
    if (privacySection) privacySection.classList.toggle("hidden", !privacyAlerts.length);
    if (privacySummary) {
      privacySummary.textContent = privacyAlerts.length === 1
        ? "1 member turned off anonymous analytics."
        : `${privacyAlerts.length} members recently turned off anonymous analytics.`;
    }
    if (privacyRows) {
      privacyRows.innerHTML = "";
      privacyAlerts.forEach((alert) => {
        const tr = document.createElement("tr");
        const portal = String(alert?.principalType || "member").replace(/^./u, (letter) => letter.toUpperCase());
        const cells = [portal, String(alert?.principalId || ""), String(alert?.occurredAt || "")];
        cells.forEach((value) => {
          const td = document.createElement("td");
          td.textContent = value;
          tr.appendChild(td);
        });
        privacyRows.appendChild(tr);
      });
    }

    const classBody = document.getElementById("overviewClassRows");
    if (classBody) {
      classBody.innerHTML = "";
      classRows.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
        <td>${levelBadgeHtml(row.level || "", { variant: "standard" })}</td>
        <td>${row.enrolled || 0}</td>
        <td>${row.attendanceToday || 0}</td>
      `;
        classBody.appendChild(tr);
      });
    }

    const assignmentBody = document.getElementById("overviewAssignmentRows");
    if (assignmentBody) {
      assignmentBody.innerHTML = "";
      [
        ["Active class levels", currentActiveLevels],
        ["Targeted students", currentTargetedStudents],
        ["Completed now", currentCompletedStudents],
        ["Pending reminders", currentPendingStudents],
        ["Due soon levels (<=2 days)", currentDueSoonLevels],
        ["Due soon pending students", currentDueSoonPendingStudents],
        ["Current completion %", formatPercent(currentCompletionPercent)],
      ].forEach(([label, value]) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${label}</td><td>${value}</td>`;
        assignmentBody.appendChild(tr);
      });
    }

    renderOverviewChartsAfterPaint({
      weeklyRows: weeklyAssignmentCompletion,
      assignmentSummary: {
        ...assignments,
        currentTargetedStudents,
        currentCompletedStudents,
        currentPendingStudents,
        currentCompletionPercent,
      },
      levelRows: levelCompletion,
    });

    const riskEl = document.getElementById("overviewRiskStudents");
    if (riskEl) riskEl.textContent = buildDashboardRiskLines(levelCompletion);
    renderAttendanceAdminRiskSignals();
    state.parentReportQueue.savedReportCountHint = Math.max(
      0,
      Number(summary?.parentReports?.total || 0) || 0,
    );
    renderPerformanceStagedSection();
  }

  return { renderDashboardSummary };
}
