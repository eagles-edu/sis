/* global Element, HTMLAnchorElement, document, fetch, window */

// PERF-CONTRACT: ADMIN-OVERVIEW-SHELL
// Authenticated overview pages get a small data shell first. The full admin
// application is loaded only when a staff member opens a route or control.

const apiOrigin = String(window.__SIS_ADMIN_API_ORIGIN__ || "").trim();
const apiPrefix = String(window.__SIS_ADMIN_API_PREFIX__ || "/api/admin").trim() || "/api/admin";
const initialPageSlug = String(window.__SIS_ADMIN_PAGE_SLUG__ || "overview").trim().toLowerCase();

function apiUrl(path) {
  const suffix = String(path || "").startsWith("/") ? String(path) : `/${path}`;
  return `${apiOrigin}${apiPrefix}${suffix.startsWith(apiPrefix) ? suffix.slice(apiPrefix.length) : suffix}`;
}

async function loadDashboard() {
  const response = await fetch(apiUrl("/dashboard"), { credentials: "include" });
  if (!response.ok) throw new Error(`Dashboard request failed: ${response.status}`);
  return response.json();
}

function text(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value ?? "");
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(value) {
  return `${number(value).toFixed(1)}%`;
}

function renderDashboard(summary = {}) {
  const today = summary.today || {};
  const rows = Array.isArray(summary.levelCompletion) ? summary.levelCompletion : [];
  const totalEnrollment = number(today.totalEnrollment ?? today.totalStudents);
  const attendance = number(today.attendance);
  const targeted = rows.reduce((total, row) => total + number(row?.totalAssignments ?? row?.enrolledStudents), 0);
  const completed = rows.reduce((total, row) => total + number(row?.completedAssignments ?? row?.completedStudents), 0);
  const pending = rows.reduce((total, row) => total + Math.max(0, number(row?.outstandingAssignments) || number(row?.totalAssignments ?? row?.enrolledStudents) - number(row?.completedAssignments ?? row?.completedStudents)), 0);

  text("ovTotalEnrollment", totalEnrollment);
  text("ovAttendancePctEnrollment", percent(today.attendancePercentOfEnrollment ?? (totalEnrollment ? attendance / totalEnrollment * 100 : 0)));
  text("ovUnenrolledYtd", number(today.unenrolledYtd));
  text("ovTodayAttendance", attendance);
  text("ovTodayAbsences", number(today.absences));
  text("ovTardyRates", `${percent(today.tardy10PlusPercent)} / ${percent(today.tardy30PlusPercent)}`);
  text("ovAtRiskCount", pending);
  text("ovOutstanding", completed);
  text("ovOutstandingYtd", percent(targeted ? completed / targeted * 100 : 0));

  const assignmentRows = document.getElementById("overviewAssignmentRows");
  if (assignmentRows) {
    assignmentRows.replaceChildren();
    [
      ["Active class levels", rows.length],
      ["Targeted students", targeted],
      ["Completed now", completed],
      ["Pending reminders", pending],
    ].forEach(([label, value]) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${label}</td><td>${value}</td>`;
      assignmentRows.appendChild(row);
    });
  }
}

function handOffToFullApp() {
  const shell = document.getElementById("adminOverviewShellStatus");
  if (shell) shell.textContent = "Loading admin tools...";
  window.__SIS_LOAD_ADMIN_APP__?.();
}

function installViewportHandoff() {
  const target = document.getElementById("systemHealthSection") ||
    document.getElementById("overviewLineChart") ||
    document.getElementById("overviewAssignmentTableWrap") ||
    document.getElementById("overviewNewsQueueSection");
  if (!target) return;

  let handedOff = false;
  let userScrolled = false;
  const handOffOnce = () => {
    if (handedOff) return;
    handedOff = true;
    window.removeEventListener("scroll", checkViewport);
    window.removeEventListener("resize", checkViewport);
    handOffToFullApp();
  };
  const checkViewport = () => {
    if (!userScrolled) return;
    const bounds = target.getBoundingClientRect();
    if (bounds.top <= window.innerHeight + 200 && bounds.bottom >= -200) {
      handOffOnce();
    }
  };
  window.addEventListener("scroll", () => {
    userScrolled = true;
    checkViewport();
  }, { passive: true });
  window.addEventListener("resize", checkViewport, { passive: true });
}

async function boot() {
  if (initialPageSlug && initialPageSlug !== "overview") {
    handOffToFullApp();
    return;
  }
  try {
    renderDashboard(await loadDashboard());
    const shell = document.getElementById("adminOverviewShellStatus");
    if (shell) shell.textContent = "Overview ready. Select a tool to continue.";
    // Keep the shell light until the user scrolls to deferred content.
    // Click remains the explicit fallback for keyboard and direct interaction.
    installViewportHandoff();
  } catch (error) {
    const shell = document.getElementById("adminOverviewShellStatus");
    if (shell) shell.textContent = error?.message || "Overview data unavailable.";
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("a, button") : null;
    if (!target || target.id === "adminOverviewShellStatus") return;
    event.preventDefault();
    handOffToFullApp();
    if (target instanceof HTMLAnchorElement && target.href) {
      window.history.pushState({}, "", target.href);
      window.__SIS_LOAD_ADMIN_APP__?.({ replayPage: target.dataset.pageLink || "" });
      return;
    }
    window.__SIS_LOAD_ADMIN_APP__?.({ replayClick: target });
  }, { capture: true, once: true });
}

boot();
