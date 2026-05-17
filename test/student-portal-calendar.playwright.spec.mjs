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

const CHROMIUM_EXECUTABLE_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean);

function resolveChromiumExecutablePath() {
  if (!chromium) return "";
  try {
    const bundledPath = chromium.executablePath();
    if (bundledPath && fs.existsSync(bundledPath)) return bundledPath;
  } catch (error) {
    void error;
  }
  for (const candidatePath of CHROMIUM_EXECUTABLE_CANDIDATES) {
    if (fs.existsSync(candidatePath)) return candidatePath;
  }
  return "";
}

const CHROMIUM_EXECUTABLE_PATH = resolveChromiumExecutablePath();
const CHROMIUM_LAUNCH_OPTIONS = CHROMIUM_EXECUTABLE_PATH
  ? { headless: true, executablePath: CHROMIUM_EXECUTABLE_PATH }
  : { headless: true };
const FIXED_Q1_NOW = "2025-09-10T09:00:00.000Z";

function resolvePlaywrightSkipReason() {
  if (!chromium) return "playwright package is not installed";
  if (!CHROMIUM_EXECUTABLE_PATH) return "playwright browser executable is not installed";
  return false;
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

function createStudentPortalFixtureServer(rootDir, options = {}) {
  const studentPortalPath = path.join(rootDir, "web-asset/student/student-portal.html");
  const defaultSchoolSetup = {
    startDate: "2025-08-01",
    endDate: "2026-07-31",
    schoolYear: "2025-2026",
    quarters: [
      { quarter: "q1", startDate: "2025-08-01", endDate: "2025-10-31" },
      { quarter: "q2", startDate: "2025-11-01", endDate: "2026-01-31" },
      { quarter: "q3", startDate: "2026-02-01", endDate: "2026-04-30" },
      { quarter: "q4", startDate: "2026-05-01", endDate: "2026-07-31" },
    ],
  };
  const dashboardSchoolSetup = options.dashboardSchoolSetup || defaultSchoolSetup;
  const studentNewsItems = [
    {
      id: "news-2026-03-17",
      reportDate: "2026-03-17",
      sourceLink: "https://www.bbc.com/news/articles/cx22x?ok-submit=1",
      articleTitle: "Waiting Report",
      byline: "Reporter One",
      articleDateline: "March 17, 2026",
      leadSynopsis: "Waiting report lead summary.",
      actionActor: "Actor A",
      actionAffected: "Affected A",
      actionWhere: "City A",
      actionWhat: "Action A",
      actionWhy: "Reason A",
      biasAssessment: "Bias A",
      reviewStatus: "submitted",
      awaitingReReview: true,
      submittedAt: "2026-03-17T09:05:00.000Z",
    },
    {
      id: "news-2026-03-13",
      reportDate: "2026-03-13",
      sourceLink: "https://www.bbc.com/news/articles/cx22y?ok-submit=1",
      articleTitle: "Revise Report",
      byline: "Reporter Two",
      articleDateline: "March 13, 2026",
      leadSynopsis: "Revise report lead summary.",
      actionActor: "Actor B",
      actionAffected: "Affected B",
      actionWhere: "City B",
      actionWhat: "Action B",
      actionWhy: "Reason B",
      biasAssessment: "Bias B",
      reviewStatus: "revision-requested",
      awaitingReReview: false,
      submittedAt: "2026-03-13T11:30:00.000Z",
    },
    {
      id: "news-2026-03-12",
      reportDate: "2026-03-12",
      sourceLink: "https://www.bbc.com/news/articles/cx22z?ok-submit=1",
      articleTitle: "Approved Report",
      byline: "Reporter Three",
      articleDateline: "March 12, 2026",
      leadSynopsis: "Approved report lead summary.",
      actionActor: "Actor C",
      actionAffected: "Affected C",
      actionWhere: "City C",
      actionWhat: "Action C",
      actionWhy: "Reason C",
      biasAssessment: "Bias C",
      reviewStatus: "approved",
      awaitingReReview: false,
      submittedAt: "2026-03-12T10:15:00.000Z",
    },
  ];
  let submitCounter = 0;

  function listNewsItems() {
    return studentNewsItems
      .slice()
      .sort((left, right) => String(right.reportDate || "").localeCompare(String(left.reportDate || "")));
  }

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
            schoolSetup: dashboardSchoolSetup,
            details: {
              currentQuarterDeadline: "2026-03-31T00:00:00.000Z",
              unfinishedCurrentQuarterAssignments: [
                {
                  id: "bundle-current",
                  assignmentTemplateId: "bundle-current",
                  assignmentTitle: "Essay Draft",
                  itemTitles: ["Essay Draft"],
                  itemLinks: [
                    {
                      id: "bundle-current:item-1",
                      title: "Essay Draft",
                      url: "https://example.com/essay-draft",
                    },
                  ],
                  href: "https://example.com/essay-draft",
                  meta: "Assigned Mar 1, 2026 | Due Mar 15, 2026 | Deadline Mar 31, 2026",
                  note: "Open the exercise link below to finish this assignment.",
                  quarterDeadline: "2026-03-31T00:00:00.000Z",
                  completed: false,
                  tone: "warn",
                },
              ],
              pastQuartersUnfinishedAssignments: [
                {
                  id: "bundle-past-complete",
                  assignmentTemplateId: "bundle-past-complete",
                  assignmentTitle: "Late Exercise",
                  itemTitles: ["Late Exercise"],
                  itemLinks: [
                    {
                      id: "bundle-past-complete:item-1",
                      title: "Late Exercise",
                      url: "https://example.com/late-exercise",
                    },
                  ],
                  href: "https://example.com/late-exercise",
                  meta: "Assigned Feb 1, 2026 | Due Feb 12, 2026 | Deadline Feb 28, 2026",
                  note: "Completed for progress tracking only.",
                  quarterDeadline: "2026-02-28T00:00:00.000Z",
                  completed: true,
                  tone: "good",
                  countsTowardQuarter: false,
                },
                {
                  id: "bundle-past-open",
                  assignmentTemplateId: "bundle-past-open",
                  assignmentTitle: "Missed Exercise",
                  itemTitles: ["Missed Exercise"],
                  itemLinks: [
                    {
                      id: "bundle-past-open:item-1",
                      title: "Missed Exercise",
                      url: "https://example.com/missed-exercise",
                    },
                  ],
                  href: "https://example.com/missed-exercise",
                  meta: "Assigned Jan 20, 2026 | Due Jan 28, 2026 | Deadline Jan 31, 2026",
                  note: "You can still finish this for practice and progress, but it will not change quarter grades.",
                  quarterDeadline: "2026-01-31T00:00:00.000Z",
                  completed: false,
                  tone: "warn",
                  countsTowardQuarter: false,
                },
              ],
              currentHomework: [
                {
                  id: "hw-current-1",
                  assignmentName: "Essay Draft",
                  className: "A2 Flyers",
                  dueDate: "2025-09-15",
                  dueAt: "2025-09-15T00:00:00.000Z",
                  comments: "Finish the final paragraph and upload the draft.",
                  status: "pending",
                },
              ],
              overdueHomework: [
                {
                  id: "hw-overdue-1",
                  assignmentName: "Vocabulary Corrections",
                  className: "A2 Flyers",
                  dueDate: "2025-09-11",
                  dueAt: "2025-09-11T00:00:00.000Z",
                  comments: "Corrections still need to be submitted.",
                  status: "overdue",
                },
              ],
              assignmentHistory: [
                {
                  id: "hw-current-1",
                  assignmentName: "Essay Draft",
                  className: "A2 Flyers",
                  dueDate: "2025-09-15",
                  dueAt: "2025-09-15T00:00:00.000Z",
                  comments: "Finish the final paragraph and upload the draft.",
                  status: "pending",
                },
                {
                  id: "hw-complete-1",
                  assignmentName: "Reading Log",
                  className: "A2 Flyers",
                  dueDate: "2025-09-08",
                  dueAt: "2025-09-08T00:00:00.000Z",
                  scorePercent: 92,
                  comments: "Submitted cleanly and on time.",
                  status: "completed",
                  homeworkOnTime: true,
                },
                {
                  id: "hw-late-1",
                  assignmentName: "Late Exercise",
                  className: "A2 Flyers",
                  dueDate: "2025-09-06",
                  dueAt: "2025-09-06T00:00:00.000Z",
                  submittedAt: "2025-09-07T14:30:00.000Z",
                  scorePercent: 85,
                  comments: "Submitted after the deadline for Q1 tracking.",
                  status: "completed",
                  homeworkCompleted: true,
                  homeworkOnTime: false,
                },
                {
                  id: "hw-missed-1",
                  assignmentName: "Missed Exercise",
                  className: "A2 Flyers",
                  dueDate: "2025-09-05",
                  dueAt: "2025-09-05T00:00:00.000Z",
                  scorePercent: 0,
                  comments: "Not submitted before the Q1 deadline.",
                  status: "overdue",
                  homeworkCompleted: false,
                  homeworkOnTime: false,
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
                  dueDate: "2025-09-08",
                  dueAt: "2025-09-08T00:00:00.000Z",
                  scorePercent: 92,
                  comments: "Submitted cleanly and on time.",
                  status: "completed",
                },
                {
                  id: "grade-2",
                  assignmentName: "Late Exercise",
                  className: "A2 Flyers",
                  dueDate: "2025-09-06",
                  dueAt: "2025-09-06T00:00:00.000Z",
                  submittedAt: "2025-09-07T14:30:00.000Z",
                  scorePercent: 85,
                  comments: "Submitted after the deadline for Q1 tracking.",
                  status: "completed",
                  homeworkCompleted: true,
                  homeworkOnTime: false,
                },
                {
                  id: "grade-3",
                  assignmentName: "Missed Exercise",
                  className: "A2 Flyers",
                  dueDate: "2025-09-05",
                  dueAt: "2025-09-05T00:00:00.000Z",
                  scorePercent: 0,
                  comments: "Not submitted before the Q1 deadline.",
                  status: "overdue",
                  homeworkCompleted: false,
                  homeworkOnTime: false,
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
                dueDate: "2025-09-11",
                startDate: "2025-09-08",
                endDate: "2025-09-15",
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
        const items = listNewsItems();
        const statusSummary = items.reduce(
          (acc, entry) => {
            if (entry.reviewStatus === "approved") acc.approved += 1;
            else if (entry.reviewStatus === "revision-requested")
              acc.revisionRequested += 1;
            else acc.submitted += 1;
            return acc;
          },
          { submitted: 0, approved: 0, revisionRequested: 0 },
        );
        sendJson(response, 200, {
          ok: true,
          window: {
            todayDate: "2026-03-13",
            reportDate: "2026-03-16",
            closesAt: "2026-03-16T23:59:00.000Z",
          },
          statusSummary,
          items,
          calendar: [
            { date: "2026-03-10", color: "red", submittedAt: "" },
            { date: "2026-03-11", status: "missed", submittedAt: "" },
            { date: "2026-03-12", color: "green", submittedAt: "2026-03-12T10:15:00.000Z" },
            {
              date: "2026-03-13",
              status: "completed",
              reviewStatus: "revision-requested",
              submittedAt: "2026-03-13T11:30:00.000Z",
            },
            {
              date: "2026-03-17",
              status: "completed",
              reviewStatus: "submitted",
              awaitingReReview: true,
              submittedAt: "2026-03-17T09:05:00.000Z",
            },
            { date: "2026-03-16", color: "amber", canSubmit: true, submittedAt: "" },
          ],
          openReport: {
            reportDate: "2026-03-16",
          },
        });
        return;
      }

      if (pathname === "/api/student/news-reports" && request.method === "POST") {
        if (!isStudentAuthenticated(request)) {
          sendJson(response, 401, { error: "Unauthorized" });
          return;
        }
        const payload = await readJsonBody(request);
        const sourceLink = String(payload?.sourceLink || "");
        if (sourceLink.includes("ok-submit=1")) {
          submitCounter += 1;
          const submittedAt = `2026-03-17T12:0${Math.min(submitCounter, 9)}:00.000Z`;
          const reportDate = String(payload?.reportDate || "");
          const existingIndex = studentNewsItems.findIndex((entry) => entry.reportDate === reportDate);
          const nextItem = {
            id: `news-${reportDate}`,
            reportDate,
            sourceLink: String(payload?.sourceLink || ""),
            articleTitle: String(payload?.articleTitle || ""),
            byline: String(payload?.byline || ""),
            articleDateline: String(payload?.articleDateline || ""),
            leadSynopsis: String(payload?.leadSynopsis || ""),
            actionActor: String(payload?.actionActor || ""),
            actionAffected: String(payload?.actionAffected || ""),
            actionWhere: String(payload?.actionWhere || ""),
            actionWhat: String(payload?.actionWhat || ""),
            actionWhy: String(payload?.actionWhy || ""),
            biasAssessment: String(payload?.biasAssessment || ""),
            reviewStatus: "submitted",
            awaitingReReview: false,
            submittedAt,
          };
          if (existingIndex >= 0) {
            studentNewsItems.splice(existingIndex, 1, nextItem);
          } else {
            studentNewsItems.push(nextItem);
          }
          sendJson(response, 200, {
            ok: true,
            saved: true,
            item: nextItem,
          });
          return;
        }
        if (sourceLink.includes("drift=1")) {
          sendJson(response, 200, {
            error: "Saved and marked for revision. Update flagged fields and save again.",
            message: "Saved and marked for revision. Update flagged fields and save again.",
            saved: true,
            complianceFailed: true,
            item: {
              reportDate: "2026-03-16",
              sourceLink: payload?.sourceLink || "",
              articleTitle: payload?.articleTitle || "",
              byline: payload?.byline || "",
              articleDateline: payload?.articleDateline || "",
              leadSynopsis: payload?.leadSynopsis || "",
              actionActor: payload?.actionActor || "",
              actionAffected: payload?.actionAffected || "",
              actionWhere: payload?.actionWhere || "",
              actionWhat: payload?.actionWhat || "",
              actionWhy: payload?.actionWhy || "",
              biasAssessment: payload?.biasAssessment || "",
              failedFields: ["sourceLink", "byline", "articleDateline"],
              validationIssuesJson: {
                sourceLink: {
                  status: "pending",
                  message: "fetch failed",
                  score: 0,
                  threshold: 1,
                  steps: ["Use the exact full URL for the article."],
                },
                byline: {
                  status: "pending",
                  message: "Byline must match fetched author or source organization.",
                  score: 0,
                  threshold: 0.7,
                  steps: ["Copy the byline exactly as shown on the article page."],
                },
                articleDateline: {
                  status: "pending",
                  message:
                    "Dateline must reflect visible publish/updated time and timezone requirements.",
                  score: 0,
                  threshold: 0.7,
                  steps: ["Use the visible article publish/updated timestamp text."],
                },
              },
            },
          });
          return;
        }
        sendJson(response, 200, {
          error: "Saved and marked for revision. Update flagged fields and save again.",
          message: "Saved and marked for revision. Update flagged fields and save again.",
          saved: true,
          complianceFailed: true,
          item: {
            reportDate: "2026-03-16",
            sourceLink: payload?.sourceLink || "",
            articleTitle: payload?.articleTitle || "",
            byline: payload?.byline || "",
            articleDateline: payload?.articleDateline || "",
            leadSynopsis: payload?.leadSynopsis || "",
            actionActor: payload?.actionActor || "",
            actionAffected: payload?.actionAffected || "",
            actionWhere: payload?.actionWhere || "",
            actionWhat: payload?.actionWhat || "",
            actionWhy: payload?.actionWhy || "",
            biasAssessment: payload?.biasAssessment || "",
          },
          failedFields: {
            sourceLink: {
              message: "fetch failed",
              score: 0,
              threshold: 1,
            },
            articleTitle: {
              message: "Article title does not closely match source title.",
              score: 0,
              threshold: 0.7,
            },
            byline: {
              message: "Byline must match fetched author or source organization.",
              score: 0,
              threshold: 0.7,
            },
            articleDateline: {
              message:
                "Dateline must reflect visible publish/updated time and timezone requirements.",
              score: 0,
              threshold: 0.7,
            },
            leadSynopsis: {
              message: "Lead synopsis must align with the first paragraph of the source article.",
              score: 0,
              threshold: 0.5,
            },
          },
          revisionTasks: [
            {
              field: "sourceLink",
              steps: ["Use the direct article URL from the allowed source site."],
            },
          ],
          validation: {
            metadata: {
              ok: false,
              error: "fetch failed",
            },
            sourceLink: {
              score: 0,
              threshold: 1,
            },
            articleTitle: {
              score: 0,
              threshold: 0.7,
            },
            byline: {
              score: 0,
              threshold: 0.7,
            },
            articleDateline: {
              score: 0,
              threshold: 0.7,
            },
            leadSynopsis: {
              score: 0,
              threshold: 0.5,
            },
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

const skipReason = resolvePlaywrightSkipReason();

test(
  "student portal login renders FullCalendar alerts and blinking overdue states",
  { skip: skipReason },
  async () => {
    const server = createStudentPortalFixtureServer(ROOT_DIR);
    let browser = null;
    let page = null;

    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS);
      page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
      await page.addInitScript(({ fixedNowIso }) => {
        const fixedNow = new Date(fixedNowIso).valueOf();
        if (!Number.isFinite(fixedNow)) return;
        const RealDate = Date;
        class MockDate extends RealDate {
          constructor(...args) {
            super(...(args.length ? args : [fixedNow]));
          }
          static now() {
            return fixedNow;
          }
        }
        window.Date = MockDate;
      }, { fixedNowIso: FIXED_Q1_NOW });

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

      await page.click("#studentThemeToggle");
      await page.waitForFunction(() => globalThis.document.documentElement.getAttribute("data-theme") === "dark");
      await page.waitForFunction(() => {
        const squares = globalThis.document.querySelectorAll("#attendanceCalendarMetrics .attendance-square-v.is-percent");
        return Boolean(squares.length && Array.from(squares).every((square) => globalThis.window.getComputedStyle(square).color));
      });

      const attendanceDarkThemeState = await page.evaluate(() => {
        const squares = Array.from(globalThis.document.querySelectorAll("#attendanceCalendarMetrics .attendance-square-v.is-percent"));
        const probe = globalThis.document.createElement("span");
        probe.style.color = "var(--secondary-color)";
        globalThis.document.body.appendChild(probe);
        const expectedColor = globalThis.window.getComputedStyle(probe).color;
        probe.remove();
        return {
          theme: globalThis.document.documentElement.getAttribute("data-theme") || "",
          texts: squares.map((square) => square.textContent || ""),
          colors: squares.map((square) => globalThis.window.getComputedStyle(square).color),
          expectedColor,
        };
      });

      assert.equal(attendanceDarkThemeState.theme, "dark");
      assert.ok(attendanceDarkThemeState.texts.length >= 2);
      attendanceDarkThemeState.texts.forEach((text) => assert.match(text, /%/));
      attendanceDarkThemeState.colors.forEach((color) => assert.equal(color, attendanceDarkThemeState.expectedColor));

      await page.click("#studentThemeToggle");
      await page.waitForFunction(() => globalThis.document.documentElement.getAttribute("data-theme") === "light");

      await page.waitForFunction(() => {
        const body = globalThis.document.getElementById("newsQueueBody");
        return Boolean(body && body.textContent && !/Loading/i.test(body.textContent));
      });

      const newsQueueState = await page.evaluate(() => {
        const body = globalThis.document.getElementById("newsQueueBody");
        const rows = Array.from(body?.querySelectorAll("tr") || []);
        const firstLatestCell = rows[0]?.querySelector("td:nth-child(4)");
        const headers = Array.from(
          globalThis.document.querySelectorAll("#newsQueueCard thead th"),
        ).map((node) => (node.textContent || "").trim());
        return {
          text: body?.textContent || "",
          rowCount: rows.length,
          headers,
          actionButtons: Array.from(
            body?.querySelectorAll("button[data-open-news-week-set]") || [],
          ).length,
          latestSubmissionText: (firstLatestCell?.textContent || "").replace(/\s+/g, " ").trim(),
          latestSubmissionHtml: firstLatestCell?.innerHTML || "",
        };
      });

      assert.deepEqual(newsQueueState.headers, [
        "Week Set",
        "#",
        "Status",
        "Latest Submission",
        "Open",
      ]);
      assert.match(newsQueueState.text, /(Approved|Waiting|Revise|No student week sets found\.)/i);
      assert.equal(newsQueueState.text.includes("Loading"), false);
      assert.ok(newsQueueState.rowCount >= 1);
      assert.ok(newsQueueState.actionButtons >= 1);
      assert.match(newsQueueState.text, /^\s*.*\d{2}\/\d{2}-\d{2}\/\d{2}\s+\d{4}.*$/s);
      assert.doesNotMatch(newsQueueState.text, /\b\d{4}-\d{2}-\d{2}\s+to\s+\d{4}-\d{2}-\d{2}\b/i);
      assert.match(newsQueueState.latestSubmissionText, /^\d{2}\/\d{2}\/\d{2}\s*\d{2}:\d{2}:\d{2}\s+\+7$/);
      assert.match(newsQueueState.latestSubmissionHtml, /queue-compact-datetime/);
      assert.match(newsQueueState.text, /Revise/i);
      assert.match(newsQueueState.text, /Waiting/i);
      assert.equal(/Needs Revision/i.test(newsQueueState.text), false);

      const openedWaitingDate = await page.evaluate(() => {
        const waitingTrigger = Array.from(
          globalThis.document.querySelectorAll(
            "#newsQueueBody button[data-open-news-week-set]",
          ),
        ).find((node) => /Waiting/i.test(node.closest("tr")?.textContent || ""));
        if (!waitingTrigger) return "";
        const targetDate = waitingTrigger.getAttribute("data-open-news-report-date") || "";
        waitingTrigger.dispatchEvent(
          new globalThis.MouseEvent("click", { bubbles: true }),
        );
        const viewer = globalThis.document.getElementById("newsWeekSetModal");
        return viewer && !viewer.classList.contains("hidden") ? targetDate : "";
      });
      assert.match(openedWaitingDate, /^\d{4}-\d{2}-\d{2}$/);

      await page.waitForFunction(() => {
        const modal = globalThis.document.getElementById("newsWeekSetModal");
        return Boolean(modal && !modal.classList.contains("hidden"));
      });

      const modalBeforeSubmit = await page.evaluate(() => {
        const statusChip = globalThis.document.getElementById("newsViewerReviewStatusChip");
        return {
          hasSubmit: Boolean(globalThis.document.getElementById("newsWeekSetModalSubmitBtn")),
          hasRequestRevision: Boolean(globalThis.document.getElementById("newsWeekSetModalRevisionBtn")),
          hasStatusChip: Boolean(statusChip),
          hasLegacyStatusInput: Boolean(globalThis.document.getElementById("newsViewerReviewStatus")),
          statusChipClass: statusChip?.className || "",
          statusChipText: statusChip?.textContent || "",
          submittedAt: globalThis.document.getElementById("newsViewerSubmittedAt")?.value || "",
        };
      });
      assert.equal(modalBeforeSubmit.hasSubmit, true);
      assert.equal(modalBeforeSubmit.hasRequestRevision, false);
      assert.equal(modalBeforeSubmit.hasStatusChip, true);
      assert.equal(modalBeforeSubmit.hasLegacyStatusInput, false);
      assert.match(modalBeforeSubmit.statusChipText, /Waiting/i);
      assert.match(modalBeforeSubmit.statusChipClass, /\bchip-revise\b/i);
      assert.match(modalBeforeSubmit.submittedAt, /2026|Mar|March/i);

      await page.fill("#newsViewerArticleTitle", "Waiting Report Updated");
      await page.click("#newsWeekSetModalSubmitBtn");

      await page.waitForFunction(() => {
        const status = globalThis.document.getElementById("formStatus");
        const modal = globalThis.document.getElementById("newsWeekSetModal");
        return Boolean(
          status &&
            /Report saved\./i.test(status.textContent || "") &&
            modal &&
            !modal.classList.contains("hidden"),
        );
      });
      await page.waitForFunction(
        (previousSubmittedAt) => {
          const submittedAt = globalThis.document.getElementById("newsViewerSubmittedAt")?.value || "";
          return Boolean(submittedAt && submittedAt !== previousSubmittedAt);
        },
        modalBeforeSubmit.submittedAt,
      );

      const modalAfterSubmit = await page.evaluate(() => ({
        submittedAt: globalThis.document.getElementById("newsViewerSubmittedAt")?.value || "",
        articleTitle: globalThis.document.getElementById("newsViewerArticleTitle")?.value || "",
      }));
      assert.notEqual(modalAfterSubmit.submittedAt, modalBeforeSubmit.submittedAt);
      assert.equal(modalAfterSubmit.articleTitle, "Waiting Report Updated");

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
        globalThis.document.querySelector('a[data-page-target="grades-ytd"]')?.click();
      });

      await page.waitForFunction(() =>
        Array.from(globalThis.document.querySelectorAll(".grade-quarter-picker-btn")).some((button) =>
          (button.textContent || "").trim().toUpperCase().startsWith("Q1")
        )
      );

      await page.evaluate(() => {
        const q1Button = Array.from(globalThis.document.querySelectorAll(".grade-quarter-picker-btn")).find((button) =>
          (button.textContent || "").trim().toUpperCase().startsWith("Q1")
        );
        q1Button?.click();
      });

      await page.waitForFunction(() => {
        const detailCard = globalThis.document.getElementById("studentDetailPageCard");
        const grid = globalThis.document.getElementById("studentDetailCalendarGrid");
        return Boolean(
          detailCard &&
          !detailCard.classList.contains("hidden") &&
          /Grades YTD/i.test(globalThis.document.getElementById("studentDetailTitle")?.textContent || "") &&
          grid &&
          grid.querySelectorAll(".tabulator-row:not(.tabulator-header-row)").length >= 2 &&
          !grid.querySelector(".fc")
        );
      });

      const gradesQuarterState = await page.evaluate(() => {
        const grid = globalThis.document.getElementById("studentDetailCalendarGrid");
        const rowNodes = Array.from(grid?.querySelectorAll(".tabulator-row:not(.tabulator-header-row)") || []);
        const rows = rowNodes.map((row) => ({
          text: row.textContent || "",
          isCurrent: row.classList.contains("is-current-quarter"),
          className: row.className || "",
          status: row.querySelector(".grade-status-pill")?.textContent || "",
          backgroundColor: globalThis.window.getComputedStyle(row).backgroundColor,
        }));
        return {
          title: globalThis.document.getElementById("studentDetailTitle")?.textContent || "",
          summary: globalThis.document.getElementById("studentDetailCalendarSummary")?.textContent || "",
          activeQuarter: Array.from(globalThis.document.querySelectorAll(".grade-quarter-picker-btn")).find((button) =>
            button.getAttribute("aria-pressed") === "true"
          )?.textContent || "",
          rowCount: rows.length,
          rows,
          firstRow: rows[0] || null,
          secondRow: rows[1] || null,
          statusPillColors: Array.from(grid?.querySelectorAll(".grade-status-pill") || []).map((node) =>
            globalThis.window.getComputedStyle(node).color
          ),
          hasCalendar: Boolean(grid?.querySelector(".fc")),
          hasTabulator: Boolean(grid?.querySelector(".tabulator")),
        };
      });

      assert.match(gradesQuarterState.title, /Grades YTD/i);
      assert.match(gradesQuarterState.summary, /Q1-Q4|quarter rows are derived|quý/i);
      assert.match(gradesQuarterState.activeQuarter || "", /^Q1/i);
      assert.equal(gradesQuarterState.rowCount, 4);
      assert.equal(gradesQuarterState.hasCalendar, false);
      assert.equal(gradesQuarterState.hasTabulator, true);
      assert.match(gradesQuarterState.firstRow?.text || "", /Essay Draft/i);
      assert.match(gradesQuarterState.firstRow?.className || "", /is-open/i);
      assert.match(gradesQuarterState.firstRow?.status || "", /Open/i);
      assert.equal(gradesQuarterState.firstRow?.backgroundColor, "rgb(255, 240, 204)");
      assert.match(gradesQuarterState.firstRow?.text || "", /0\.0%/);
      assert.match(gradesQuarterState.firstRow?.text || "", /0\.0\/10/);
      assert.match(gradesQuarterState.secondRow?.text || "", /Reading Log/i);
      assert.match(gradesQuarterState.secondRow?.className || "", /is-completed/i);
      assert.equal(gradesQuarterState.secondRow?.backgroundColor, "rgb(226, 245, 233)");
      assert.match(gradesQuarterState.secondRow?.text || "", /92(?:\.0)?%/);
      assert.match(gradesQuarterState.secondRow?.text || "", /9\.2\/10/);
      assert.ok(gradesQuarterState.statusPillColors.length >= 4);
      assert.ok(gradesQuarterState.statusPillColors.every((color) => color === "rgb(255, 255, 255)"));
      assert.ok(gradesQuarterState.rows.some((row) => /Late Exercise/i.test(row.text) && /is-late/i.test(row.className) && /Completed/i.test(row.status) && /Submitted/i.test(row.text) && /Due/i.test(row.text)));
      assert.ok(gradesQuarterState.rows.some((row) => /Late Exercise/i.test(row.text) && row.backgroundColor === "rgb(243, 236, 255)"));
      assert.ok(gradesQuarterState.rows.some((row) => /Missed Exercise/i.test(row.text) && /is-missed/i.test(row.className) && /Incomplete/i.test(row.status) && /Submitted pending/i.test(row.text) && /Not submitted before the Q1 deadline/i.test(row.text)));

      const assignmentPanels = await page.evaluate(() => {
        const primaryPanel = globalThis.document.getElementById("studentDetailPrimaryList");
        const historyPanel = globalThis.document.getElementById("studentDetailHistoryList");
        return {
          primaryTitle: globalThis.document.getElementById("studentDetailPrimaryTitle")?.textContent || "",
          historyTitle: globalThis.document.getElementById("studentDetailHistoryTitle")?.textContent || "",
          primarySummary: globalThis.document.getElementById("studentDetailPrimarySummary")?.textContent || "",
          historySummary: globalThis.document.getElementById("studentDetailHistorySummary")?.textContent || "",
          primaryText: primaryPanel?.textContent || "",
          historyText: historyPanel?.textContent || "",
          primaryLinks: Array.from(primaryPanel?.querySelectorAll("a.detail-link, .detail-item-title a") || []).map((node) => node.getAttribute("href") || ""),
          historyLinks: Array.from(historyPanel?.querySelectorAll("a.detail-link, .detail-item-title a") || []).map((node) => node.getAttribute("href") || ""),
          itemCount: {
            primary: primaryPanel?.querySelectorAll(".detail-item").length || 0,
            history: historyPanel?.querySelectorAll(".detail-item").length || 0,
          },
          historyItemClasses: Array.from(historyPanel?.querySelectorAll(".detail-item") || []).map((node) => node.className || ""),
        };
      });

      assert.match(assignmentPanels.primaryTitle, /Unfinished Assignments: Current Quarter/i);
      assert.match(assignmentPanels.historyTitle, /Past Quarters' Unfinished Assignments/i);
      assert.match(assignmentPanels.primarySummary, /keep them in this quarter|quarter closes/i);
      assert.match(assignmentPanels.historySummary, /practice and progress|quarter grades/i);
      assert.equal(assignmentPanels.itemCount.primary, 1);
      assert.equal(assignmentPanels.itemCount.history, 2);
      assert.ok(assignmentPanels.primaryLinks.includes("https://example.com/essay-draft"));
      assert.ok(assignmentPanels.historyLinks.includes("https://example.com/late-exercise"));
      assert.ok(assignmentPanels.historyLinks.includes("https://example.com/missed-exercise"));
      assert.match(assignmentPanels.primaryText, /Assigned/i);
      assert.match(assignmentPanels.primaryText, /Due/i);
      assert.match(assignmentPanels.primaryText, /Deadline/i);
      assert.match(assignmentPanels.historyText, /practice and progress|progress tracking only/i);
      assert.match(assignmentPanels.historyText, /progress tracking only|practice and progress/i);
      assert.ok(assignmentPanels.historyItemClasses.some((className) => /\bgood\b/i.test(className)));
      assert.ok(assignmentPanels.historyItemClasses.some((className) => /\bwarn\b/i.test(className)));

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
          /NONE SUBMITTED/i.test(node.getAttribute("title") || node.textContent || "")
        );
        const openNewsEvent = Array.from(grid?.querySelectorAll(".fc-event") || []).find((node) =>
          /OPEN/i.test(node.getAttribute("title") || node.textContent || "")
        );
        const alertStyle = alertEvent ? globalThis.window.getComputedStyle(alertEvent) : null;
        const missedNewsStyle = missedNewsEvent ? globalThis.window.getComputedStyle(missedNewsEvent) : null;
        const openNewsStyle = openNewsEvent ? globalThis.window.getComputedStyle(openNewsEvent) : null;
        const alertDay = grid?.querySelector('.fc-daygrid-day[data-date="2026-03-11"]');
        const completedDay = grid?.querySelector('.fc-daygrid-day[data-date="2026-03-12"]');
        const openDay = grid?.querySelector('.fc-daygrid-day[data-date="2026-03-16"]');
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
      assert.ok(calendarState.eventTitles.some((label) => /NONE SUBMITTED/i.test(label)));
      assert.ok(calendarState.eventTitles.some((label) => /WAITING/i.test(label)));
      assert.ok(calendarState.eventTitles.some((label) => /Notes review track: Science/i.test(label)));
      assert.equal(calendarState.dotEventCount, 0);
      assert.match(calendarState.alertAnimationName, /overdueBlink/i);
      assert.match(calendarState.alertBackgroundColor, /rgb\(255,\s*35,\s*56\)/i);
      assert.match(calendarState.missedNewsTextColor, /rgb\(11,\s*18,\s*32\)/i);
      assert.match(calendarState.openNewsTextColor, /rgb\(15,\s*74,\s*115\)/i);
      assert.match(calendarState.alertDayClassName, /calendar-day-alert/);
      assert.match(calendarState.alertDayAnimationName, /dayAlertPulse/i);
      assert.match(calendarState.completedDayClassName, /calendar-day-completed/);
      assert.match(calendarState.openDayClassName, /calendar-day-open/);
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
      }
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  }
);

test(
  "student portal opens compliance modal when soft-save payload omits top-level failedFields",
  { skip: skipReason },
  async () => {
    const server = createStudentPortalFixtureServer(ROOT_DIR);
    let browser = null;
    let page = null;

    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS);
      page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

      await page.goto(`http://127.0.0.1:${port}/student/portal`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector("#loginForm");
      await page.fill("#loginEaglesId", STUDENT_LOGIN.eaglesId);
      await page.fill("#loginPassword", STUDENT_LOGIN.password);
      await page.click('#loginForm button[type="submit"]');

      await page.waitForFunction(() => {
        const appPanel = globalThis.document.getElementById("appPanel");
        const homeCard = globalThis.document.getElementById("studentHomeCard");
        return Boolean(
          appPanel &&
            !appPanel.classList.contains("hidden") &&
            homeCard &&
            !homeCard.classList.contains("hidden"),
        );
      });

      await page.click("#openNewsPageBtn");
      await page.waitForFunction(() => {
        const newsCard = globalThis.document.getElementById("newsPageCard");
        return Boolean(newsCard && !newsCard.classList.contains("hidden"));
      });

      await page.fill(
        "#sourceLink",
        "https://www.bbc.com/news/articles/cy91vrzxn34o?drift=1",
      );
      await page.fill(
        "#articleTitle",
        "How Pakistan won over Trump to become an unlikely mediator in the Iran war",
      );
      await page.fill("#byline", "Caroline Davies");
      await page.fill("#articleDateline", "9 hours ago");
      await page.fill(
        "#leadSynopsis",
        "Pakistan's role as intermediary in this conflict took many by surprise.",
      );
      await page.fill("#actionActor", "Pakistan");
      await page.fill("#actionAffected", "Iran");
      await page.fill("#actionWhere", "Middle East");
      await page.fill(
        "#actionWhat",
        "Pakistan mediated communications between parties.",
      );
      await page.fill(
        "#actionWhy",
        "Regional security concerns pushed diplomatic intervention.",
      );
      await page.fill(
        "#biasAssessment",
        "Coverage frames Pakistan as unexpectedly strategic.",
      );

      await page.click("#submitBtn");

      await page.waitForFunction(() => {
        const modal = globalThis.document.getElementById("newsComplianceModal");
        return Boolean(modal && !modal.classList.contains("hidden"));
      });

      const complianceState = await page.evaluate(() => {
        const summary = globalThis.document.getElementById("newsComplianceModalSummary");
        const sourceHelp = globalThis.document.getElementById(
          "newsValidationHelp-sourceLink",
        );
        return {
          ctaVisible: !globalThis.document
            .getElementById("openNewsComplianceModalBtn")
            ?.classList.contains("hidden"),
          summaryText: summary?.textContent || "",
          sourceHelpText: sourceHelp?.textContent || "",
        };
      });

      assert.equal(complianceState.ctaVisible, true);
      assert.match(complianceState.summaryText, /revision/i);
      assert.match(complianceState.sourceHelpText, /fetch failed/i);
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
      }
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  },
);

test(
  "student portal opens compliance modal for soft-save success payload even when openReport omits validation issues",
  { skip: skipReason },
  async () => {
    const server = createStudentPortalFixtureServer(ROOT_DIR);
    let browser = null;
    let page = null;

    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS);
      page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

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

      await page.click("#openNewsPageBtn");
      await page.waitForFunction(() => {
        const newsCard = globalThis.document.getElementById("newsPageCard");
        return Boolean(newsCard && !newsCard.classList.contains("hidden"));
      });

      await page.fill("#sourceLink", "https://www.bbc.com/news/articles/cy91vrzxn34o");
      await page.fill(
        "#articleTitle",
        "How Pakistan won over Trump to become an unlikely mediator in the Iran war",
      );
      await page.fill("#byline", "Caroline Davies");
      await page.fill("#articleDateline", "9 hours ago");
      await page.fill(
        "#leadSynopsis",
        "Pakistan's role as intermediary in this conflict took many by surprise.",
      );
      await page.fill("#actionActor", "Pakistan");
      await page.fill("#actionAffected", "Iran");
      await page.fill("#actionWhere", "Middle East");
      await page.fill("#actionWhat", "Pakistan mediated communications between parties.");
      await page.fill("#actionWhy", "Regional security concerns pushed diplomatic intervention.");
      await page.fill("#biasAssessment", "Coverage frames Pakistan as unexpectedly strategic.");

      await page.click("#submitBtn");

      await page.waitForFunction(() => {
        const modal = globalThis.document.getElementById("newsComplianceModal");
        const summary = globalThis.document.getElementById("newsComplianceModalSummary");
        return Boolean(
          modal &&
            !modal.classList.contains("hidden") &&
            summary &&
            summary.textContent &&
            summary.textContent.trim().length > 0,
        );
      });

      const complianceState = await page.evaluate(() => {
        const modal = globalThis.document.getElementById("newsComplianceModal");
        const summary = globalThis.document.getElementById("newsComplianceModalSummary");
        const cta = globalThis.document.getElementById("openNewsComplianceModalBtn");
        const sourceHelp = globalThis.document.getElementById("newsValidationHelp-sourceLink");
        return {
          modalVisible: Boolean(modal && !modal.classList.contains("hidden")),
          ctaVisible: Boolean(cta && !cta.classList.contains("hidden") && !cta.hasAttribute("disabled")),
          formStatus: globalThis.document.getElementById("formStatus")?.textContent || "",
          summaryText: summary?.textContent || "",
          sourceHelpText: sourceHelp?.textContent || "",
        };
      });

      assert.equal(complianceState.modalVisible, true);
      assert.equal(complianceState.ctaVisible, true);
      assert.match(complianceState.formStatus, /Saved and marked for revision/i);
      assert.match(complianceState.summaryText, /revision/i);
      assert.match(complianceState.sourceHelpText, /fetch failed/i);
      assert.match(complianceState.sourceHelpText, /Score 0\.00 < 1\.00/i);
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
      }
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  }
);
