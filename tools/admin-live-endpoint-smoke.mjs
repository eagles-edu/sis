#!/usr/bin/env node
import process from "node:process";

const DEFAULT_BASE_URL = "http://127.0.0.1:8786";
const DEFAULT_ADMIN_USER = "admin";
const DEFAULT_ADMIN_PASS = "3825u2z";
const DEFAULT_PARENT_ID = "cmkramer001";
const DEFAULT_PARENT_PASS = "P1k@ch00";
const DEFAULT_STUDENT_ID = "ben001";
const DEFAULT_STUDENT_PASS = "P1k@ch00";

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }

    if (token.startsWith("--no-")) {
      result[token.slice(5)] = false;
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex > 0) {
      result[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
      continue;
    }

    result[key] = true;
  }
  return result;
}

function textOrDefault(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeBaseUrl(value) {
  return textOrDefault(value, DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function looksLikeBinaryResponse(pathname, accept, contentType) {
  const value = `${pathname} ${accept || ""} ${contentType || ""}`.toLowerCase();
  return value.includes("spreadsheetml") || value.includes("application/pdf") || value.includes(".xlsx");
}

function extractFirstId(payload) {
  if (!payload || typeof payload !== "object") return "";
  const candidates = [
    payload.id,
    payload.recordId,
    payload.reportId,
    payload.studentRefId,
    payload.templateId,
    payload.user?.id,
    payload.item?.id,
    payload.record?.id,
    payload.report?.id,
    payload.student?.id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

const args = parseArgs(process.argv.slice(2));
const config = {
  baseUrl: normalizeBaseUrl(
    textOrDefault(
      args["base-url"],
      process.env.ADMIN_SMOKE_BASE_URL,
      process.env.SIS_SMOKE_BASE_URL
    )
  ),
  adminUser: textOrDefault(
    args["admin-user"],
    process.env.ADMIN_SMOKE_ADMIN_USER,
    process.env.STUDENT_ADMIN_USER,
    DEFAULT_ADMIN_USER
  ),
  adminPass: textOrDefault(
    args["admin-pass"],
    process.env.ADMIN_SMOKE_ADMIN_PASS,
    process.env.STUDENT_ADMIN_PASS,
    DEFAULT_ADMIN_PASS
  ),
  parentId: textOrDefault(
    args["parent-id"],
    process.env.ADMIN_SMOKE_PARENT_ID,
    process.env.STUDENT_PARENT_USER,
    DEFAULT_PARENT_ID
  ),
  parentPass: textOrDefault(
    args["parent-pass"],
    process.env.ADMIN_SMOKE_PARENT_PASS,
    process.env.STUDENT_PARENT_PASS,
    DEFAULT_PARENT_PASS
  ),
  studentId: textOrDefault(
    args["student-id"],
    process.env.ADMIN_SMOKE_STUDENT_ID,
    process.env.STUDENT_STUDENT_USER,
    DEFAULT_STUDENT_ID
  ),
  studentPass: textOrDefault(
    args["student-pass"],
    process.env.ADMIN_SMOKE_STUDENT_PASS,
    process.env.STUDENT_STUDENT_PASS,
    DEFAULT_STUDENT_PASS
  ),
  mutations: Boolean(args.mutations || args.full),
  points: Boolean(args.points || args.full),
  notifications: Boolean(args.notifications || args.full),
  logout: args["no-logout"] ? false : true,
};

const results = [];
const cleanupTasks = [];

function record(step, status, detail = "") {
  const ok = status >= 200 && status < 300;
  const prefix = ok ? "[ok]" : "[fail]";
  const suffix = detail ? ` ${detail}` : "";
  console.log(`${prefix} ${step} (${status})${suffix}`);
  results.push({ step, status, ok, detail });
  return ok;
}

function addCleanup(step, fn) {
  cleanupTasks.push({ step, fn });
}

async function request(step, {
  method = "GET",
  path,
  headers = {},
  body,
  binary = false,
  expectedStatuses,
} = {}) {
  const requestHeaders = new Headers(headers);
  let requestBody = body;
  if (requestBody && typeof requestBody === "object" && !(requestBody instanceof ArrayBuffer) && !(requestBody instanceof Uint8Array) && !(requestBody instanceof FormData)) {
    if (!requestHeaders.has("content-type")) requestHeaders.set("content-type", "application/json");
    requestBody = JSON.stringify(requestBody);
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: requestBody,
  });
  const contentType = response.headers.get("content-type") || "";
  let detail;
  let json = null;

  if (binary || looksLikeBinaryResponse(path, requestHeaders.get("accept"), contentType)) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    detail = `binary:${bytes.length}`;
  } else {
    const text = await response.text();
    detail = text.replace(/\s+/g, " ").slice(0, 240);
    if (contentType.includes("json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
      json = safeJsonParse(text);
    }
  }

  const statusOk = Array.isArray(expectedStatuses)
    ? expectedStatuses.includes(response.status)
    : response.ok;
  record(step, response.status, detail);
  return { response, json, detail, statusOk };
}

async function login(step, path, payload, cookieName) {
  const { response, json } = await request(step, {
    method: "POST",
    path,
    body: payload,
  });
  const cookie = (response.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie || !cookie.includes(`${cookieName}=`)) {
    throw new Error(`${step}: missing ${cookieName} cookie`);
  }
  if (!json?.authenticated) {
    throw new Error(`${step}: expected authenticated=true`);
  }
  return { cookie, json };
}

async function runCleanup() {
  while (cleanupTasks.length) {
    const task = cleanupTasks.pop();
    try {
      await task.fn();
    } catch (error) {
      record(`cleanup ${task.step}`, 500, error instanceof Error ? error.message : String(error));
    }
  }
}

async function main() {
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(
    `Modes: mutations=${config.mutations ? "on" : "off"} points=${config.points ? "on" : "off"} notifications=${config.notifications ? "on" : "off"} logout=${config.logout ? "on" : "off"}`
  );

  const admin = await login(
    "admin login",
    "/api/admin/login",
    { username: config.adminUser, password: config.adminPass },
    "student_admin_sid"
  );
  const adminHeaders = { Cookie: admin.cookie };

  await request("admin auth me", { path: "/api/admin/auth/me", headers: adminHeaders });
  await request("admin permissions", { path: "/api/admin/permissions", headers: adminHeaders });
  await request("admin runtime health", { path: "/api/admin/runtime/health", headers: adminHeaders });
  await request("admin runtime service-control GET", { path: "/api/admin/runtime/service-control", headers: adminHeaders });
  await request("admin dashboard", { path: "/api/admin/dashboard", headers: adminHeaders });
  await request("admin queue hub", { path: "/api/admin/queue-hub", headers: adminHeaders });
  await request("admin profile submissions", { path: "/api/admin/profile-submissions?take=5", headers: adminHeaders });
  await request("admin exercise titles", { path: "/api/admin/exercise-titles?take=5", headers: adminHeaders });
  await request("admin incoming exercise results", { path: "/api/admin/exercise-results/incoming?take=5", headers: adminHeaders });
  await request("admin filters", { path: "/api/admin/filters", headers: adminHeaders });
  await request("admin next student number", { path: "/api/admin/students/next-student-number", headers: adminHeaders });
  const students = await request("admin students list", { path: "/api/admin/students?take=5", headers: adminHeaders });
  const studentRefId = textOrDefault(students.json?.items?.[0]?.id, "cmmdu4xg1005i26g04rjzypx5");
  await request("admin import template", {
    path: "/api/admin/students/import-template.xlsx",
    headers: { ...adminHeaders, Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    binary: true,
  });
  await request("admin family lookup", { path: "/api/admin/family?phone=0900111222", headers: adminHeaders });
  await request("admin users list", { path: "/api/admin/users?take=5", headers: adminHeaders });
  await request("admin notifications batch status", {
    path: "/api/admin/notifications/batch-status?queueType=parent-report&take=5",
    headers: adminHeaders,
  });
  await request("admin news reports list", { path: "/api/admin/news-reports?take=5", headers: adminHeaders });
  await request("admin points summary", { path: "/api/admin/points/summary", headers: adminHeaders });
  await request("admin points students", { path: "/api/admin/points/students?take=5", headers: adminHeaders });
  await request("admin points ledger", {
    path: `/api/admin/points/ledger?studentRefId=${encodeURIComponent(studentRefId)}`,
    headers: adminHeaders,
  });
  await request("admin assignment templates list", { path: "/api/admin/assignment-templates?take=5", headers: adminHeaders });
  await request("admin student detail", {
    path: `/api/admin/students/${encodeURIComponent(studentRefId)}`,
    headers: adminHeaders,
  });
  await request("admin report card pdf", {
    path: `/api/admin/students/${encodeURIComponent(studentRefId)}/report-card.pdf?className=A1&schoolYear=2026-2027&quarter=q1`,
    headers: { ...adminHeaders, Accept: "application/pdf" },
    binary: true,
  });

  if (config.mutations) {
    const settingsBefore = await request("admin ui settings GET", { path: "/api/admin/settings/ui", headers: adminHeaders });
    const originalUiSettings = settingsBefore.json?.uiSettings;
    if (originalUiSettings && typeof originalUiSettings === "object") {
      const tempUiSettings = {
        ...originalUiSettings,
        multiSchool: !originalUiSettings.multiSchool,
        schoolProfile: {
          ...(originalUiSettings.schoolProfile || {}),
          schoolName: `Smoke Test School ${new Date().toISOString()}`,
        },
      };
      await request("admin ui settings PUT temp", {
        method: "PUT",
        path: "/api/admin/settings/ui",
        headers: adminHeaders,
        body: { uiSettings: tempUiSettings },
      });
      await request("admin ui settings GET verify", { path: "/api/admin/settings/ui", headers: adminHeaders });
      addCleanup("admin ui settings restore", async () => {
        await request("admin ui settings restore", {
          method: "PUT",
          path: "/api/admin/settings/ui",
          headers: adminHeaders,
          body: { uiSettings: originalUiSettings },
        });
      });
    }

    const templateName = `Smoke Template ${Date.now().toString(36)}`;
    const templatePayload = {
      assignmentTitle: templateName,
      exerciseTitle: "Smoke Exercise",
      assignedAt: "2026-04-25",
      dueAt: "2026-04-26",
      level: "Pre-A1 Starters",
      message: "Live smoke test template",
      items: [{ id: "item-1", title: "Check 1", url: "https://example.com/check-1", done: false }],
      completed: false,
    };
    const templateCreate = await request("assignment template create", {
      method: "POST",
      path: "/api/admin/assignment-templates",
      headers: adminHeaders,
      body: templatePayload,
    });
    const templateId = extractFirstId(templateCreate.json);
    if (templateId) {
      addCleanup("assignment template delete", async () => {
        await request("assignment template delete", {
          method: "DELETE",
          path: `/api/admin/assignment-templates/${encodeURIComponent(templateId)}`,
          headers: adminHeaders,
        });
      });
      await request("assignment template get", {
        path: `/api/admin/assignment-templates/${encodeURIComponent(templateId)}`,
        headers: adminHeaders,
      });
      await request("assignment template update", {
        method: "PUT",
        path: `/api/admin/assignment-templates/${encodeURIComponent(templateId)}`,
        headers: adminHeaders,
        body: { ...templatePayload, completed: true, completedAt: "2026-04-25T00:00:00.000Z" },
      });
    }

    const importName = `Smoke Import ${Date.now().toString(36)}`;
    const importPayload = {
      items: [
        {
          assignmentTitle: importName,
          exerciseTitle: "Smoke Import Exercise",
          assignedAt: "2026-04-25",
          dueAt: "2026-04-26",
          level: "Pre-A1 Starters",
          message: "Smoke import item",
          items: [{ id: "import-1", title: "Import Check", url: "https://example.com/import-check", done: false }],
          completed: false,
        },
      ],
    };
    await request("assignment templates import", {
      method: "POST",
      path: "/api/admin/assignment-templates/import",
      headers: adminHeaders,
      body: importPayload,
    });
    const imported = await request("assignment templates import cleanup list", {
      path: `/api/admin/assignment-templates?take=20&q=${encodeURIComponent(importName)}`,
      headers: adminHeaders,
    });
    const importedItems = Array.isArray(imported.json?.items) ? imported.json.items : [];
    for (const item of importedItems) {
      const itemId = extractFirstId(item);
      if (!itemId) continue;
      addCleanup(`imported assignment template ${itemId}`, async () => {
        await request("assignment template delete imported", {
          method: "DELETE",
          path: `/api/admin/assignment-templates/${encodeURIComponent(itemId)}`,
          headers: adminHeaders,
        });
      });
    }

    const preview = await request("assignment preview create", {
      method: "POST",
      path: "/api/admin/assignment-announcements/volatile",
      headers: adminHeaders,
      body: {
        assignmentTitle: `Smoke Preview ${Date.now().toString(36)}`,
        level: "Pre-A1 Starters",
        assignedAt: "2026-04-25",
        dueAt: "2026-04-26",
        message: "Smoke preview message",
        items: [{ title: "Check 1", url: "https://example.com/check-1" }],
      },
    });
    if (preview.json?.path) {
      await request("assignment preview page", {
        path: preview.json.path,
        headers: { ...adminHeaders, Accept: "text/html" },
      });
    }

    await request("admin export xlsx", {
      method: "POST",
      path: "/api/admin/exports/xlsx",
      headers: { ...adminHeaders, Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      binary: true,
      body: {
        filename: `smoke-${Date.now().toString(36)}.xlsx`,
        sheetName: "Smoke",
        columns: [{ key: "id", label: "ID" }],
        rows: [{ id: "1" }],
      },
    });

    const tempStudentNumber = 99002;
    const studentCreate = await request("admin student create", {
      method: "POST",
      path: "/api/admin/students",
      headers: adminHeaders,
      body: { eaglesId: `SMOKE-${Date.now().toString(36)}`, studentNumber: tempStudentNumber },
    });
    const createdStudentId = extractFirstId(studentCreate.json);
    if (createdStudentId) {
      addCleanup("admin student delete", async () => {
        await request("admin student delete", {
          method: "DELETE",
          path: `/api/admin/students/${encodeURIComponent(createdStudentId)}`,
          headers: adminHeaders,
        });
      });
    }

    if (config.notifications) {
      await request("admin notification email", {
        method: "POST",
        path: "/api/admin/notifications/email",
        headers: adminHeaders,
        body: {
          deliveryMode: "weekend-batch",
          queueType: "parent-report",
          assignmentTitle: `Smoke Notification ${Date.now().toString(36)}`,
          level: "Pre-A1 Starters",
          message: "Smoke notification queue",
          recipients: ["parent-one@example.com"],
        },
      });

      const queueListing = await request("admin notification batch status list (post-create)", {
        path: "/api/admin/notifications/batch-status?queueType=parent-report&take=20",
        headers: adminHeaders,
      });
      const queuedItem = Array.isArray(queueListing.json?.items)
        ? queueListing.json.items.find((entry) => String(entry?.assignmentTitle || "").startsWith("Smoke Notification "))
        : null;
      if (queuedItem?.id) {
        await request("admin notification batch status hold", {
          method: "POST",
          path: "/api/admin/notifications/batch-status",
          headers: adminHeaders,
          body: {
            action: "hold",
            queueId: queuedItem.id,
            queueType: queuedItem.queueType || "parent-report",
          },
        });
        await request("admin notification batch status requeue", {
          method: "POST",
          path: "/api/admin/notifications/batch-status",
          headers: adminHeaders,
          body: {
            action: "requeue",
            queueId: queuedItem.id,
            queueType: queuedItem.queueType || "parent-report",
          },
        });
      }
    }

    const attendanceSave = await request("admin student attendance save", {
      method: "POST",
      path: `/api/admin/students/${encodeURIComponent(studentRefId)}/attendance`,
      headers: adminHeaders,
      body: {
        className: "Smoke Class",
        schoolYear: "2026-2027",
        quarter: "q1",
        attendanceDate: "2026-04-25",
        status: "present",
      },
    });
    const attendanceId = extractFirstId(attendanceSave.json?.record || attendanceSave.json);
    if (attendanceId) {
      addCleanup("admin student attendance delete", async () => {
        await request("admin student attendance delete", {
          method: "DELETE",
          path: `/api/admin/students/${encodeURIComponent(studentRefId)}/attendance/${encodeURIComponent(attendanceId)}`,
          headers: adminHeaders,
        });
      });
    }

    const gradeSave = await request("admin student grade save", {
      method: "POST",
      path: `/api/admin/students/${encodeURIComponent(studentRefId)}/grades`,
      headers: adminHeaders,
      body: {
        className: "Smoke Class",
        schoolYear: "2026-2027",
        quarter: "q1",
        assignmentName: `Smoke Grade ${Date.now().toString(36)}`,
        dueAt: "2026-04-25",
        submittedAt: "2026-04-25",
        homeworkCompleted: true,
        homeworkOnTime: true,
        behaviorScore: 8,
        participationScore: 8,
        inClassScore: 8,
      },
    });
    const gradeId = extractFirstId(gradeSave.json?.record || gradeSave.json);
    if (gradeId) {
      addCleanup("admin student grade delete", async () => {
        await request("admin student grade delete", {
          method: "DELETE",
          path: `/api/admin/students/${encodeURIComponent(studentRefId)}/grades/${encodeURIComponent(gradeId)}`,
          headers: adminHeaders,
        });
      });
    }

    const reportSave = await request("admin student report save", {
      method: "POST",
      path: `/api/admin/students/${encodeURIComponent(studentRefId)}/reports`,
      headers: adminHeaders,
      body: {
        className: "Smoke Class",
        schoolYear: "2026-2027",
        quarter: "q1",
        comments: "Smoke report",
      },
    });
    const reportId = extractFirstId(reportSave.json?.report || reportSave.json);
    if (reportId) {
      addCleanup("admin student report delete", async () => {
        await request("admin student report delete", {
          method: "DELETE",
          path: `/api/admin/students/${encodeURIComponent(studentRefId)}/reports/${encodeURIComponent(reportId)}`,
          headers: adminHeaders,
        });
      });
    }
    await request("admin student report generate", {
      method: "POST",
      path: `/api/admin/students/${encodeURIComponent(studentRefId)}/reports/generate`,
      headers: adminHeaders,
      body: {
        className: "Smoke Class",
        schoolYear: "2026-2027",
        quarter: "q1",
      },
    });
  }

  if (config.points) {
    const plus = await request("admin points adjustments +1", {
      method: "POST",
      path: "/api/admin/points/adjustments",
      headers: adminHeaders,
      body: {
        studentRefId,
        pointsDelta: 1,
        reason: `smoke +1 ${Date.now().toString(36)}`,
      },
    });
    if (plus.statusOk) {
      await request("admin points adjustments -1", {
        method: "POST",
        path: "/api/admin/points/adjustments",
        headers: adminHeaders,
        body: {
          studentRefId,
          pointsDelta: -1,
          reason: `smoke -1 ${Date.now().toString(36)}`,
        },
      });
    }
  }

  const newsListing = await request("admin news reports focus list", {
    path: "/api/admin/news-reports?take=1",
    headers: adminHeaders,
  });
  const newsItem = Array.isArray(newsListing.json?.items) ? newsListing.json.items[0] : null;
  if (config.mutations && newsItem?.id) {
    await request("admin news report approve", {
      method: "POST",
      path: `/api/admin/news-reports/${encodeURIComponent(newsItem.id)}`,
      headers: adminHeaders,
      body: {
        action: "approve",
        reviewNote: "smoke approve",
      },
    });
    await request("admin news report reset", {
      method: "POST",
      path: `/api/admin/news-reports/${encodeURIComponent(newsItem.id)}`,
      headers: adminHeaders,
      body: {
        action: "reset",
        reviewNote: "smoke reset",
      },
    });
  }

  await runCleanup();

  if (config.logout) {
    await request("admin auth logout", {
      method: "POST",
      path: "/api/admin/auth/logout",
      headers: adminHeaders,
    });
    await request("admin auth me after logout", {
      path: "/api/admin/auth/me",
      headers: adminHeaders,
      expectedStatuses: [401],
    });
  }

  const parent = await login(
    "parent login",
    "/api/parent/auth/login",
    { parentsId: config.parentId, password: config.parentPass },
    "parent_portal_sid"
  );
  const parentHeaders = { Cookie: parent.cookie };
  await request("parent auth me", { path: "/api/parent/auth/me", headers: parentHeaders });
  await request("parent dashboard", { path: "/api/parent/dashboard", headers: parentHeaders });
  await request("parent children", { path: "/api/parent/children", headers: parentHeaders });

  const student = await login(
    "student login",
    "/api/student/auth/login",
    { eaglesId: config.studentId, password: config.studentPass },
    "student_portal_sid"
  );
  const studentHeaders = { Cookie: student.cookie };
  await request("student auth me", { path: "/api/student/auth/me", headers: studentHeaders });
  await request("student dashboard", { path: "/api/student/dashboard", headers: studentHeaders });
  await request("student news reports", { path: "/api/student/news-reports", headers: studentHeaders });
  await request("student news calendar", { path: "/api/student/news-reports/calendar", headers: studentHeaders });

  const failures = results.filter((entry) => !entry.ok && !entry.step.includes("auth me after logout"));
  const summary = {
    baseUrl: config.baseUrl,
    mutations: config.mutations,
    points: config.points,
    logout: config.logout,
    total: results.length,
    failures: failures.length,
    steps: results,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
