import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";

const ROOT_DIR = process.cwd();
const STUDENT_SESSION_COOKIE_NAME = "student_portal_sid";
const STUDENT_SESSION_ID = "fixture-student-session";
const STUDENT_LOGIN = {
  eaglesId: "flyers01",
  password: "student-pass-123",
};

let chromium = null;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  void error;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

function sendFile(response, filePath) {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === ".html"
    ? "text/html; charset=utf-8"
    : ext === ".css"
      ? "text/css; charset=utf-8"
      : ext === ".js" || ext === ".mjs"
        ? "application/javascript; charset=utf-8"
        : ext === ".svg"
          ? "image/svg+xml"
          : ext === ".png"
            ? "image/png"
            : ext === ".ico"
              ? "image/x-icon"
              : "application/octet-stream";
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": buffer.length,
  });
  response.end(buffer);
}

function isStudentAuthenticated(request) {
  const cookieHeader = request.headers.cookie || "";
  return cookieHeader.includes(`${STUDENT_SESSION_COOKIE_NAME}=${STUDENT_SESSION_ID}`);
}

function resolveStaticPath(rootDir, pathname) {
  const targetPath = path.resolve(rootDir, `.${pathname}`);
  if (!targetPath.startsWith(rootDir)) return "";
  return targetPath;
}

function createStudentPortalFixtureServer(rootDir) {
  const studentPortalPath = path.join(rootDir, "web-asset/student/student-portal.html");

  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname);

    try {
      if (pathname === "/student/portal" && request.method === "GET") {
        sendFile(response, studentPortalPath);
        return;
      }

      if (pathname === "/api/student/auth/login" && request.method === "POST") {
        const payload = await readJsonBody(request);
        if (payload?.eaglesId !== STUDENT_LOGIN.eaglesId || payload?.password !== STUDENT_LOGIN.password) {
          sendJson(response, 401, { error: "Invalid eaglesId or password" });
          return;
        }
        sendJson(
          response,
          200,
          {
            authenticated: true,
            user: {
              eaglesId: STUDENT_LOGIN.eaglesId,
              role: "student",
            },
          },
          {
            "set-cookie": `${STUDENT_SESSION_COOKIE_NAME}=${STUDENT_SESSION_ID}; Path=/; HttpOnly; SameSite=Lax`,
          }
        );
        return;
      }

      if (pathname === "/api/student/auth/logout" && request.method === "POST") {
        sendJson(
          response,
          200,
          { ok: true, authenticated: false },
          {
            "set-cookie": `${STUDENT_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
          }
        );
        return;
      }

      if (pathname === "/api/student/auth/me" && request.method === "GET") {
        if (!isStudentAuthenticated(request)) {
          sendJson(response, 401, { error: "Unauthorized" });
          return;
        }
        sendJson(response, 200, {
          authenticated: true,
          user: {
            eaglesId: STUDENT_LOGIN.eaglesId,
            role: "student",
          },
        });
        return;
      }

      if (pathname === "/api/student/dashboard" && request.method === "GET") {
        if (!isStudentAuthenticated(request)) {
          sendJson(response, 401, { error: "Unauthorized" });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          generatedAt: "2026-03-13T09:15:00.000Z",
          child: {
            eaglesId: STUDENT_LOGIN.eaglesId,
            studentNumber: 106,
            fullName: "Flyers Student",
            englishName: "Flyers Student",
            currentGrade: "A2 Flyers",
            attendance: {
              total: 18,
              present: 16,
              absent: 1,
              late: 1,
              excused: 0,
            },
            assignments: {
              total: 4,
              completed: 2,
              overdue: 1,
              pending: 1,
            },
            grades: {
              total: 4,
              averageScorePercent: 82.5,
            },
            performance: {
              averageScorePercent: 82.5,
              reportCount: 2,
              latestReportAt: "2026-03-10T08:30:00.000Z",
            },
            details: {
              currentHomework: [
                {
                  id: "hw-current-1",
                  assignmentName: "Essay Draft",
                  className: "A2 Flyers",
                  dueDate: "2026-03-15",
                  dueAt: "2026-03-15T00:00:00.000Z",
                  comments: "Finish the final paragraph and upload the draft.",
                  status: "pending",
                },
              ],
              overdueHomework: [
                {
                  id: "hw-overdue-1",
                  assignmentName: "Vocabulary Corrections",
                  className: "A2 Flyers",
                  dueDate: "2026-03-11",
                  dueAt: "2026-03-11T00:00:00.000Z",
                  comments: "Corrections still need to be submitted.",
                  status: "overdue",
                },
              ],
              assignmentHistory: [
                {
                  id: "hw-current-1",
                  assignmentName: "Essay Draft",
                  className: "A2 Flyers",
                  dueDate: "2026-03-15",
                  dueAt: "2026-03-15T00:00:00.000Z",
                  comments: "Finish the final paragraph and upload the draft.",
                  status: "pending",
                },
                {
                  id: "hw-complete-1",
                  assignmentName: "Reading Log",
                  className: "A2 Flyers",
                  dueDate: "2026-03-08",
                  dueAt: "2026-03-08T00:00:00.000Z",
                  scorePercent: 92,
                  comments: "Submitted cleanly and on time.",
                  status: "completed",
                  homeworkOnTime: true,
                },
              ],
              attendanceHistory: [
                {
                  id: "att-1",
                  className: "A2 Flyers",
                  attendanceDate: "2026-03-10",
                  status: "present",
                  comments: "",
                },
                {
                  id: "att-2",
                  className: "A2 Flyers",
                  attendanceDate: "2026-03-11",
                  status: "late",
                  comments: "Arrived after the listening warm-up.",
                },
              ],
              gradeHistory: [
                {
                  id: "grade-1",
                  assignmentName: "Reading Log",
                  className: "A2 Flyers",
                  dueDate: "2026-03-08",
                  dueAt: "2026-03-08T00:00:00.000Z",
                  scorePercent: 92,
                  comments: "Submitted cleanly and on time.",
                  status: "completed",
                },
              ],
              reportArchive: [
                {
                  id: "report-1",
                  className: "A2 Flyers",
                  quarter: "q1",
                  generatedDate: "2026-03-10",
                  generatedAt: "2026-03-10T08:30:00.000Z",
                  comments: "Strong progress in spoken response and review habits.",
                },
              ],
            },
          },
          points: {
            totalPoints: 14,
            scheduledOnTimeCount: 1,
            electiveCount: 0,
            approvedReportCount: 2,
            adjustmentTotal: 0,
            lastActivityAt: "2026-03-12T10:00:00.000Z",
          },
          calendarTracks: {
            review: [
              {
                id: "review-track-1",
                title: "Science",
                quarter: "q1",
                generatedDate: "2026-03-10",
                startDate: "2026-03-08",
                endDate: "2026-03-15",
              },
            ],
            homework: [
              {
                id: "homework-track-1",
                title: "Essay Draft",
                className: "A2 Flyers",
                dueDate: "2026-03-11",
                startDate: "2026-03-08",
                endDate: "2026-03-15",
                overdue: true,
              },
            ],
          },
          newsReports: {
            submittedCount: 4,
            latestSubmittedAt: "2026-03-12T10:15:00.000Z",
          },
        });
        return;
      }

      if (pathname === "/api/student/news-reports/calendar" && request.method === "GET") {
        if (!isStudentAuthenticated(request)) {
          sendJson(response, 401, { error: "Unauthorized" });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          window: {
            todayDate: "2026-03-13",
            reportDate: "2026-03-13",
            closesAt: "2026-03-13T23:59:00.000Z",
          },
          calendar: [
            { date: "2026-03-10", color: "red", submittedAt: "" },
            { date: "2026-03-11", status: "missed", submittedAt: "" },
            { date: "2026-03-12", color: "green", submittedAt: "2026-03-12T10:15:00.000Z" },
            { date: "2026-03-13", color: "amber", canSubmit: true, submittedAt: "" },
          ],
          openReport: {
            reportDate: "2026-03-13",
          },
        });
        return;
      }

      if (pathname.startsWith("/web-asset/") && request.method === "GET") {
        const filePath = resolveStaticPath(rootDir, pathname);
        if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }
        sendFile(response, filePath);
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error?.message || "Server error");
    }
  });
}

const skipReason = chromium ? false : "playwright package is not installed";

test(
  "student portal login renders FullCalendar alerts and blinking overdue states",
  { skip: skipReason },
  async () => {
    const server = createStudentPortalFixtureServer(ROOT_DIR);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

    try {
      await page.goto(`http://127.0.0.1:${port}/student/portal`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#loginForm");
      await page.fill("#loginEaglesId", STUDENT_LOGIN.eaglesId);
      await page.fill("#loginPassword", STUDENT_LOGIN.password);
      await page.click('#loginForm button[type="submit"]');

      await page.waitForFunction(() => {
        const appPanel = globalThis.document.getElementById("appPanel");
        const homeCard = globalThis.document.getElementById("studentHomeCard");
        return Boolean(appPanel && !appPanel.classList.contains("hidden") && homeCard && !homeCard.classList.contains("hidden"));
      });

      await page.waitForFunction(() => {
        const badge = globalThis.document.getElementById("snapshotBadge");
        const studentNumber = globalThis.document.getElementById("studentNumberValue");
        return Boolean(
          badge &&
          badge.textContent &&
          badge.textContent.includes("HS") &&
          studentNumber &&
          studentNumber.textContent &&
          studentNumber.textContent.trim() === "106"
        );
      });

      const homeState = await page.evaluate(() => {
        return {
          overviewPanel: Boolean(globalThis.document.getElementById("overviewPanel")),
          snapshotBadge: globalThis.document.getElementById("snapshotBadge")?.textContent || "",
          portalStatus: globalThis.document.getElementById("portalStatus")?.textContent || "",
          studentNumber: globalThis.document.getElementById("studentNumberValue")?.textContent || "",
          metricLabels: Array.from(globalThis.document.querySelectorAll("#dashboardMetrics .metric .k")).map((node) => node.textContent || ""),
          identityHeadAscii: (globalThis.document.querySelector("#identityPanel .section-head h3")?.textContent || "")
            .normalize("NFD")
            .replace(/[đĐ]/g, (char) => (char === "Đ" ? "D" : "d"))
            .replace(/[\u0300-\u036f]/g, ""),
        };
      });

      assert.equal(homeState.overviewPanel, true);
      assert.match(homeState.snapshotBadge, /HS flyers01/i);
      assert.match(homeState.portalStatus, /Student session active\./i);
      assert.equal(homeState.studentNumber.trim(), "106");
      assert.equal(homeState.identityHeadAscii.trim(), "Thong tin dinh danh hoc sinh");
      assert(homeState.metricLabels.includes("Absent SYTD"));

      await page.evaluate(() => {
        globalThis.document.querySelector('a[data-page-target="current-homework"]')?.click();
      });
      await page.waitForFunction(() => {
        const detailCard = globalThis.document.getElementById("studentDetailPageCard");
        return Boolean(
          detailCard &&
          !detailCard.classList.contains("hidden") &&
          /Current Homework/i.test(globalThis.document.getElementById("studentDetailTitle")?.textContent || "") &&
          /Essay Draft/i.test(globalThis.document.getElementById("studentDetailPrimaryList")?.textContent || "") &&
          /Essay Draft/i.test(globalThis.document.getElementById("studentDetailCalendarGrid")?.textContent || "")
        );
      });

      await page.evaluate(() => {
        globalThis.document.querySelector('a[data-page-target="home"]')?.click();
      });
      await page.click("#openNewsPageBtn");
      await page.waitForFunction(() => {
        const newsCard = globalThis.document.getElementById("newsPageCard");
        return Boolean(newsCard && !newsCard.classList.contains("hidden"));
      });

      await page.waitForFunction(() => {
        return Boolean(
          globalThis.document.querySelector("#calendarGrid.fc") &&
          globalThis.document.querySelector("#calendarGrid .fc-obtrusive-alert") &&
          globalThis.document.querySelector("#calendarGrid .fc-daygrid-day.calendar-day-alert") &&
          globalThis.document.querySelectorAll("#calendarGrid .fc-event").length >= 5
        );
      });

      const calendarState = await page.evaluate(() => {
        const grid = globalThis.document.getElementById("calendarGrid");
        const eventTitles = Array.from(grid?.querySelectorAll(".fc-event") || []).map((node) =>
          node.getAttribute("title") || node.textContent || ""
        );
        const alertEvent = grid?.querySelector(".fc-obtrusive-alert");
        const missedNewsEvent = Array.from(grid?.querySelectorAll(".fc-event") || []).find((node) =>
          /MISSED NEWS REPORT/i.test(node.getAttribute("title") || node.textContent || "")
        );
        const openNewsEvent = Array.from(grid?.querySelectorAll(".fc-event") || []).find((node) =>
          /News report window open/i.test(node.getAttribute("title") || node.textContent || "")
        );
        const alertStyle = alertEvent ? globalThis.window.getComputedStyle(alertEvent) : null;
        const missedNewsStyle = missedNewsEvent ? globalThis.window.getComputedStyle(missedNewsEvent) : null;
        const openNewsStyle = openNewsEvent ? globalThis.window.getComputedStyle(openNewsEvent) : null;
        const alertDay = grid?.querySelector('.fc-daygrid-day[data-date="2026-03-11"]');
        const completedDay = grid?.querySelector('.fc-daygrid-day[data-date="2026-03-12"]');
        const openDay = grid?.querySelector('.fc-daygrid-day[data-date="2026-03-13"]');
        const alertDayStyle = alertDay ? globalThis.window.getComputedStyle(alertDay) : null;
        return {
          rendered: Boolean(grid?.classList.contains("fc") && grid?.querySelector(".fc-toolbar")),
          toolbarButtons: Array.from(globalThis.document.querySelectorAll(".fc-button")).map((node) => node.textContent || ""),
          calendarTitle: globalThis.document.getElementById("calendarTitle")?.textContent || "",
          eventTitles,
          dotEventCount: grid?.querySelectorAll(".fc-daygrid-dot-event, .fc-daygrid-event-dot")?.length || 0,
          alertAnimationName: alertStyle?.animationName || "",
          alertBackgroundColor: alertStyle?.backgroundColor || "",
          missedNewsTextColor: missedNewsStyle?.color || "",
          openNewsTextColor: openNewsStyle?.color || "",
          alertDayClassName: alertDay?.className || "",
          alertDayAnimationName: alertDayStyle?.animationName || "",
          completedDayClassName: completedDay?.className || "",
          openDayClassName: openDay?.className || "",
        };
      });

      assert.equal(calendarState.rendered, true);
      assert.ok(calendarState.toolbarButtons.some((label) => /your view/i.test(label)));
      assert.match(calendarState.calendarTitle, /Your View/i);
      assert.ok(calendarState.eventTitles.some((label) => /MISSED NEWS REPORT/i.test(label)));
      assert.ok(calendarState.eventTitles.some((label) => /MISSED HOMEWORK DEADLINE/i.test(label)));
      assert.ok(calendarState.eventTitles.some((label) => /Notes review track: Science/i.test(label)));
      assert.ok(calendarState.eventTitles.some((label) => /Current homework: Essay Draft/i.test(label)));
      assert.equal(calendarState.dotEventCount, 0);
      assert.match(calendarState.alertAnimationName, /overdueBlink/i);
      assert.match(calendarState.alertBackgroundColor, /rgb\(255,\s*35,\s*56\)/i);
      assert.match(calendarState.missedNewsTextColor, /rgb\(255,\s*255,\s*255\)/i);
      assert.match(calendarState.openNewsTextColor, /rgb\(0,\s*0,\s*0\)/i);
      assert.match(calendarState.alertDayClassName, /calendar-day-alert/);
      assert.match(calendarState.alertDayAnimationName, /dayAlertPulse/i);
      assert.match(calendarState.completedDayClassName, /calendar-day-completed/);
      assert.match(calendarState.openDayClassName, /calendar-day-open/);
    } finally {
      await page.close();
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  }
);
