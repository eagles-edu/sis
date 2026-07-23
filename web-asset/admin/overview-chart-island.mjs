// PERF-CONTRACT: ADMIN-OVERVIEW-CHART-ISLAND
// SVG chart work is intentionally evaluated after dashboard summary cards.
export function initOverviewChartIsland({ document, helpers = {}, onLevelDetailOpen }) {
  const { normalizeText, normalizeWeeklyAssignmentCompletion, shiftToFixedTimeZone, getLevelTheme, toRgba, shortLevelLabel, fullLevelLabel, openLevelDetailPanel } = helpers;
  const openDetail = onLevelDetailOpen || openLevelDetailPanel || (() => {});

function renderOverviewLineChart(weeklyRows = [], assignmentSummary = {}) {
  const svg = document.getElementById("overviewLineChart");
  if (!svg) return;
  svg.setAttribute("aria-label", "Current assignment completion percent (Mon to today)");
  const rows = normalizeWeeklyAssignmentCompletion(weeklyRows);

  const width = 900;
  const height = 320;
  const padLeft = 66;
  const padRight = 24;
  const padTop = 24;
  const padBottom = 92;
  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;
  const maxValue = 100;
  const stepX = rows.length > 1 ? chartWidth / (rows.length - 1) : 0;
  const xAt = (index) => padLeft + stepX * index;
  const yAt = (value) =>
    padTop + chartHeight - (Number(value || 0) / maxValue) * chartHeight;

  const todayIndex = (shiftToFixedTimeZone(new Date()).getUTCDay() + 6) % 7;
  const cappedTodayIndex = Math.max(0, Math.min(rows.length - 1, todayIndex));
  const fallbackCompletionPercent = Math.max(
    0,
    Math.min(100, Number(assignmentSummary?.currentCompletionPercent || 0) || 0),
  );
  const fallbackTargetedStudents = Math.max(
    0,
    Number.parseInt(
      String(assignmentSummary?.currentTargetedStudents || 0),
      10,
    ) || 0,
  );

  const assignmentStartIndex = rows.findIndex((row) => {
    const assigned = Math.max(
      Number(row.weeklyAssignedStudents || 0),
      Number(row.studentsWithAssignments || 0),
    );
    return assigned > 0;
  });

  let visibleRows = [];
  if (assignmentStartIndex >= 0 && assignmentStartIndex <= cappedTodayIndex) {
    let rollingPercent = 0;
    visibleRows = rows
      .map((row, index) => {
        if (index < assignmentStartIndex || index > cappedTodayIndex) return null;
        if (index === assignmentStartIndex) {
          return { index, day: row.day, completionPercent: 0 };
        }
        const assigned = Math.max(
          Number(row.weeklyAssignedStudents || 0),
          Number(row.studentsWithAssignments || 0),
        );
        const completed = Math.max(
          Number(row.cumulativeCompletedStudents || 0),
          Number(row.studentsCompletedAll || 0),
        );
        const reportedPercent = Number(row.completionPercent || 0);
        const computedPercent =
          assigned > 0 ? (completed / assigned) * 100 : reportedPercent;
        rollingPercent = Math.max(
          rollingPercent,
          Math.max(
            0,
            Math.min(100, Number.isFinite(computedPercent) ? computedPercent : 0),
          ),
        );
        return {
          index,
          day: row.day,
          completionPercent: Number(rollingPercent.toFixed(1)),
        };
      })
      .filter(Boolean);
  } else if (fallbackTargetedStudents > 0) {
    const fallbackRows = [{ index: 0, day: "Mon", completionPercent: 0 }];
    if (cappedTodayIndex > 0) {
      fallbackRows.push({
        index: cappedTodayIndex,
        day: rows[cappedTodayIndex]?.day || "Today",
        completionPercent: Number(fallbackCompletionPercent.toFixed(1)),
      });
    }
    visibleRows = fallbackRows;
  }

  if (!visibleRows.length) {
    visibleRows = rows
      .map((row, index) => {
        if (index > cappedTodayIndex) return null;
        return { index, day: row.day, completionPercent: 0 };
      })
      .filter(Boolean);
    if (!visibleRows.length)
      visibleRows = [{ index: 0, day: "Mon", completionPercent: 0 }];
  }

  const completionPoints = visibleRows
    .map((row) => `${xAt(row.index)},${yAt(row.completionPercent)}`)
    .join(" ");

  const xLabels = rows
    .map(
      (row, index) =>
        `<text x="${xAt(index)}" y="${height - 34}" text-anchor="middle" font-size="16" font-weight="700" fill="var(--chart-text)">${row.day}</text>`,
    )
    .join("");

  const yTicks = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const value = Math.round(maxValue * ratio);
      const y = padTop + chartHeight - chartHeight * ratio;
      return `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="var(--chart-grid)"></line><text x="${padLeft - 10}" y="${y + 5}" text-anchor="end" font-size="14" font-weight="700" fill="var(--chart-text)">${value}%</text>`;
    })
    .join("");

  svg.innerHTML = `
  <rect x="${padLeft}" y="${padTop}" width="${chartWidth}" height="${chartHeight}" fill="none" stroke="var(--border-strong)"></rect>
  ${yTicks}
  <polyline fill="none" stroke="var(--success-border)" stroke-width="3" points="${completionPoints}"></polyline>
  ${visibleRows
    .map(
      (row) =>
        `<circle cx="${xAt(row.index)}" cy="${yAt(row.completionPercent)}" r="3.5" fill="var(--success-border)"></circle>`,
    )
    .join("")}
  ${xLabels}
`;
}

function renderOverviewBarChart(levelRows = []) {
  const svg = document.getElementById("overviewBarChart");
  const actionsEl = document.getElementById("overviewBarDetailActions");
  if (!svg || !actionsEl) return;
  svg.setAttribute("aria-label", "Students versus current assignment completions by level");
  actionsEl.innerHTML = "";

  if (!levelRows.length) {
    svg.innerHTML =
      '<text x="18" y="44" font-size="16" font-weight="600" fill="var(--chart-text)">No level completion data available.</text>';
    return;
  }

  const width = 780;
  const height = 360;
  const padLeft = 62;
  const padRight = 20;
  const padTop = 24;
  const padBottom = 96;
  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;
  const maxValue = Math.max(
    1,
    ...levelRows.map((row) =>
      Math.max(
        Number(row.enrolledStudents || 0),
        Number(row.completedStudents || 0),
      ),
    ),
  );

  const groupCount = Math.max(1, levelRows.length);
  const groupWidth = chartWidth / groupCount;
  const barGap = Math.min(10, groupWidth * 0.16);
  const maxBarWidth = Math.max(8, (groupWidth - barGap - 10) / 2);
  const barWidth = Math.max(8, Math.min(26, maxBarWidth));

  const yAt = (value) =>
    padTop + chartHeight - (Number(value || 0) / maxValue) * chartHeight;

  const yTicks = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const value = Math.round(maxValue * ratio);
      const y = padTop + chartHeight - chartHeight * ratio;
      return `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="var(--chart-grid)"></line><text x="${padLeft - 10}" y="${y + 5}" text-anchor="end" font-size="14" font-weight="700" fill="var(--chart-text)">${value}</text>`;
    })
    .join("");

  const bars = [];
  const labels = [];
  const values = [];

  levelRows.forEach((row, index) => {
    const theme = getLevelTheme(row.level || "");
    const centerX = padLeft + groupWidth * index + groupWidth / 2;
    const enrolled = Number(row.enrolledStudents || 0);
    const completed = Number(row.completedStudents || 0);
    const enrolledX = centerX - barGap / 2 - barWidth;
    const completedX = centerX + barGap / 2;
    const enrolledY = yAt(enrolled);
    const completedY = yAt(completed);
    const enrolledHeight = Math.max(1, padTop + chartHeight - enrolledY);
    const completedHeight = Math.max(1, padTop + chartHeight - completedY);

    bars.push(
      `<rect x="${enrolledX}" y="${enrolledY}" width="${barWidth}" height="${enrolledHeight}" rx="4" fill="${toRgba(theme.color, 0.58)}" stroke="${theme.borderColor}" stroke-width="1"></rect>`,
    );
    bars.push(
      `<rect x="${completedX}" y="${completedY}" width="${barWidth}" height="${completedHeight}" rx="4" fill="${theme.color}" stroke="${theme.borderColor}" stroke-width="1"></rect>`,
    );
    values.push(
      `<text x="${enrolledX + barWidth / 2}" y="${Math.max(padTop + 14, enrolledY - 6)}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--chart-text)">${enrolled}</text>`,
    );
    values.push(
      `<text x="${completedX + barWidth / 2}" y="${Math.max(padTop + 14, completedY - 6)}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--chart-text)">${completed}</text>`,
    );
    labels.push(
      `<text x="${centerX}" y="${height - 38}" text-anchor="middle" font-size="18" font-weight="700" fill="var(--chart-text)">${shortLevelLabel(row.level || "")}</text>`,
    );

    const detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.className = "level-theme-btn bar-detail-action-btn portal-button portal-button-info";
    detailBtn.style.setProperty("--level-theme-bg", theme.color);
    detailBtn.style.setProperty("--level-theme-border", theme.borderColor);
    detailBtn.style.setProperty("--level-theme-text", theme.textColor);
    detailBtn.textContent = fullLevelLabel(row.level || "");
    const dueAt = normalizeText(row?.dueAt);
    const pending = Math.max(
      0,
      Number.parseInt(String(row?.outstandingAssignments || 0), 10) || 0,
    );
    detailBtn.title =
      dueAt ?
        `Open reminders (${pending} pending, due ${dueAt})`
      : `Open reminders (${pending} pending)`;
          detailBtn.addEventListener("click", () => openDetail(row));
    actionsEl.appendChild(detailBtn);
  });

  svg.innerHTML = `
  <rect x="${padLeft}" y="${padTop}" width="${chartWidth}" height="${chartHeight}" fill="none" stroke="var(--border-strong)"></rect>
  ${yTicks}
  ${bars.join("")}
  ${values.join("")}
  ${labels.join("")}
`;
}

  return {
    render({ weeklyRows = [], assignmentSummary = {}, levelRows = [] } = {}) {
      renderOverviewLineChart(weeklyRows, assignmentSummary);
      renderOverviewBarChart(levelRows);
    },
  };
}
