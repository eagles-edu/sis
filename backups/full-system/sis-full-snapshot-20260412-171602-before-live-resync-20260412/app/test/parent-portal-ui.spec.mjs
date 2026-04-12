import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { JSDOM } from "jsdom"

const PARENT_PORTAL_HTML_PATH = path.resolve(process.cwd(), "web-asset/parent/parent-portal.html")
const PARENT_PORTAL_HTML = fs
  .readFileSync(PARENT_PORTAL_HTML_PATH, "utf8")
  .replace(/<script src="\/web-asset\/vendor\/fullcalendar\/index\.global\.min\.js"><\/script>\s*/i, "")

function jsonTextResponse(status, payload = {}) {
  const statusTextByCode = {
    200: "OK",
    401: "Unauthorized",
    404: "Not Found",
  }
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: statusTextByCode[status] || "",
    async text() {
      return JSON.stringify(payload)
    },
  }
}

async function waitFor(assertion, timeoutMs = 1000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion()
      return
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 15))
    }
  }
  assertion()
}

async function settleDomAsync(dom, rounds = 3, delayMs = 20) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => dom.window.setTimeout(resolve, delayMs))
  }
}

function toUrlText(resource) {
  if (typeof resource === "string") return resource
  if (resource && typeof resource.url === "string") return resource.url
  return String(resource)
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
}

async function createParentPortalDom(fetchHandler, url) {
  const dom = new JSDOM(PARENT_PORTAL_HTML, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    url,
    beforeParse(window) {
      window.fetch = (resource, init = {}) => fetchHandler(resource, init)
      window.scrollTo = () => {}
      window.FullCalendar = {
        Calendar: class CalendarStub {
          constructor(element, options = {}) {
            this.element = element
            this.options = options
            this.events = []
          }

          removeAllEvents() {
            this.events = []
          }

          addEventSource(events = []) {
            this.events = Array.isArray(events) ? [...events] : []
          }

          gotoDate(dateText) {
            this.currentDate = dateText
          }

          updateSize() {}

          render() {
            const eventHtml = this.events
              .map((event) => `<div class="fc-event">${String(event?.title || "")}</div>`)
              .join("")
            this.element.innerHTML = `<div class="fc"><div class="fc-toolbar"><div>${String(this.currentDate || "")}</div></div>${eventHtml}</div>`
          }
        },
      }
    },
  })

  await new Promise((resolve) => setTimeout(resolve, 30))
  return dom
}

test("parent news week-set modal keeps student-clone visuals with only wired controls", () => {
  assert.match(PARENT_PORTAL_HTML, /id="newsWeekSetModalPrevBtn"/)
  assert.match(PARENT_PORTAL_HTML, /id="newsWeekSetModalNextBtn"/)
  assert.match(PARENT_PORTAL_HTML, /id="closeNewsWeekSetModalBtn"/)
  assert.match(PARENT_PORTAL_HTML, /id="newsWeekSetModalCloseActionBtn"/)
  assert.doesNotMatch(PARENT_PORTAL_HTML, /id="newsWeekSetModalSubmitBtn"/)

  assert.match(PARENT_PORTAL_HTML, /getElementById\("newsWeekSetModalBackdrop"\)[\s\S]*closeNewsWeekSetModal\(\)/)
  assert.match(PARENT_PORTAL_HTML, /getElementById\("closeNewsWeekSetModalBtn"\)[\s\S]*closeNewsWeekSetModal\(\)/)
  assert.match(PARENT_PORTAL_HTML, /getElementById\("newsWeekSetModalCloseActionBtn"\)[\s\S]*closeNewsWeekSetModal\(\)/)
  assert.match(PARENT_PORTAL_HTML, /getElementById\("newsWeekSetModalPrevBtn"\)[\s\S]*shiftNewsWeekSetViewer\(-1\)/)
  assert.match(PARENT_PORTAL_HTML, /getElementById\("newsWeekSetModalNextBtn"\)[\s\S]*shiftNewsWeekSetViewer\(1\)/)

  assert.match(PARENT_PORTAL_HTML, /#newsWeekSetModal \.portal-modal-close/)
  assert.match(PARENT_PORTAL_HTML, /#newsWeekSetModal button/)
  assert.match(PARENT_PORTAL_HTML, /#newsWeekSetModal input,\s*#newsWeekSetModal textarea/)
})

test("parent portal static preview over http requires explicit apiOrigin", async () => {
  const calls = []

  const dom = await createParentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      calls.push(`${method} ${urlText}`)
      return jsonTextResponse(200, {})
    },
    "http://127.0.0.1:5500/web-asset/parent/parent-portal.html"
  )

  const document = dom.window.document
  await waitFor(() => {
    assert.match(document.getElementById("loginStatus").textContent || "", /Static preview mode requires \?apiOrigin=/i)
  })

  document.getElementById("parentsId").value = "cmkramer001"
  document.getElementById("parentPassword").value = "family-pass-123"
  document.getElementById("loginForm").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))

  await waitFor(() => {
    assert.match(document.getElementById("loginStatus").textContent || "", /Static preview mode requires \?apiOrigin=/i)
  })

  assert.ok(!calls.some((entry) => entry.includes("/api/parent/auth/login")))
  assert.equal(document.getElementById("loginCard").classList.contains("hidden"), false)
  assert.equal(document.getElementById("portalCard").classList.contains("hidden"), true)

  await settleDomAsync(dom)
  dom.window.close()
})

test("parent portal static preview over http uses explicit apiOrigin for login", async () => {
  const calls = []
  let authenticated = false

  const dom = await createParentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      calls.push(`${method} ${urlText}`)

      const parsed = new URL(urlText, "http://preview.invalid")
      const pathname = parsed.pathname

      if (pathname === "/api/parent/auth/login" && method === "POST") {
        authenticated = true
        return jsonTextResponse(200, {
          authenticated: true,
          user: { parentsId: "cmkramer001", role: "parent" },
        })
      }

      if (pathname === "/api/parent/auth/me" && method === "GET") {
        if (!authenticated) return jsonTextResponse(401, { error: "Unauthorized" })
        return jsonTextResponse(200, {
          authenticated: true,
          user: { parentsId: "cmkramer001", role: "parent" },
        })
      }

      if (pathname === "/api/parent/children" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          items: [
            {
              eaglesId: "vi001",
              eaglesRefId: "s-vi001",
              studentNumber: 101,
              fullName: "Student One",
              englishName: "Student One",
              currentGrade: "egg-chicks",
            },
          ],
        })
      }

      if (pathname === "/api/parent/dashboard" && method === "GET") {
        return jsonTextResponse(200, {
          children: [
            {
              eaglesId: "vi001",
              attendance: { total: 20, present: 19, absent: 1 },
              assignments: { pending: 0, overdue: 0 },
              grades: { averageScorePercent: 92 },
              performance: { reportCount: 1 },
            },
          ],
        })
      }

      if (pathname === "/api/parent/children/vi001/profile" && method === "GET") {
        return jsonTextResponse(200, {
          child: {
            eaglesId: "vi001",
            studentNumber: 101,
            fullName: "Student One",
            currentGrade: "Pre-A1 Starters",
          },
          profile: {},
          lockedFields: [],
          immutableFields: ["eaglesId", "studentNumber"],
        })
      }

      return jsonTextResponse(404, { error: "Not found" })
    },
    "http://127.0.0.1:5500/web-asset/parent/parent-portal.html?apiOrigin=http://127.0.0.1:8788"
  )

  const document = dom.window.document
  document.getElementById("parentsId").value = "cmkramer001"
  document.getElementById("parentPassword").value = "family-pass-123"
  document.getElementById("loginForm").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))

  await waitFor(() => {
    assert.ok(calls.includes("POST http://127.0.0.1:8788/api/parent/auth/login"))
  })

  assert.ok(!calls.includes("POST /api/parent/auth/login"))

  await waitFor(() => {
    assert.equal(document.getElementById("loginCard").classList.contains("hidden"), true)
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), false)
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("parent portal keeps profile form on child page view instead of dashboard card", async () => {
  const dom = await createParentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      const parsed = new URL(urlText, "http://preview.invalid")
      const pathname = parsed.pathname

      if (pathname === "/api/parent/auth/me" && method === "GET") {
        return jsonTextResponse(200, {
          authenticated: true,
          user: { parentsId: "cmkramer001", role: "parent" },
        })
      }

      if (pathname === "/api/parent/children" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          items: [
            {
              eaglesId: "vi001",
              eaglesRefId: "s-vi001",
              studentNumber: 101,
              fullName: "Student One",
              englishName: "Student One",
              currentGrade: "Pre-A1 Starters",
            },
          ],
        })
      }

      if (pathname === "/api/parent/dashboard" && method === "GET") {
        return jsonTextResponse(200, {
          children: [
            {
              eaglesId: "vi001",
              attendance: { total: 20, present: 19, absent: 1 },
              assignments: { pending: 0, overdue: 0 },
              grades: { averageScorePercent: 92 },
              performance: { reportCount: 1 },
            },
          ],
        })
      }

      if (pathname === "/api/parent/children/vi001/profile" && method === "GET") {
        return jsonTextResponse(200, {
          child: {
            eaglesId: "vi001",
            studentNumber: 101,
            fullName: "Student One",
            currentGrade: "Pre-A1 Starters",
          },
          profile: {},
          lockedFields: [],
          immutableFields: ["eaglesId", "studentNumber"],
        })
      }

      return jsonTextResponse(404, { error: "Not found" })
    },
    "http://127.0.0.1:8787/parent/portal"
  )

  const document = dom.window.document

  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), false)
    assert.equal(document.getElementById("childPageCard").classList.contains("hidden"), true)
  })

  document.getElementById("openChildPageBtn").click()

  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), true)
    assert.equal(document.getElementById("childPageCard").classList.contains("hidden"), false)
  })

  document.getElementById("backToDashboardBtn").click()

  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), false)
    assert.equal(document.getElementById("childPageCard").classList.contains("hidden"), true)
  })

  dom.window.close()
})

test("parent portal profile fields keep reference form section and label ordering", async () => {
  const dom = await createParentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      const parsed = new URL(urlText, "http://preview.invalid")
      const pathname = parsed.pathname

      if (pathname === "/api/parent/auth/me" && method === "GET") {
        return jsonTextResponse(200, {
          authenticated: true,
          user: { parentsId: "cmkramer001", role: "parent" },
        })
      }

      if (pathname === "/api/parent/children" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          items: [
            {
              eaglesId: "vi001",
              eaglesRefId: "s-vi001",
              studentNumber: 101,
              fullName: "Student One",
              englishName: "Student One",
              currentGrade: "Pre-A1 Starters",
            },
          ],
        })
      }

      if (pathname === "/api/parent/dashboard" && method === "GET") {
        return jsonTextResponse(200, {
          children: [
            {
              eaglesId: "vi001",
              attendance: { total: 20, present: 19, absent: 1 },
              assignments: { pending: 0, overdue: 0 },
              grades: { averageScorePercent: 92 },
              performance: { reportCount: 1 },
            },
          ],
        })
      }

      if (pathname === "/api/parent/children/vi001/profile" && method === "GET") {
        return jsonTextResponse(200, {
          child: {
            eaglesId: "vi001",
            studentNumber: 101,
            fullName: "Student One",
            currentGrade: "egg-chicks",
          },
          profile: {
            id: "cmmdu4wxs000126g0g5mdskt2",
            studentRefId: "cmmdu4wxe000026g0cr1uxt8y",
            parentsId: "cmkramer001",
            memberSince: "2025-09",
            requiredValidationOk: true,
            updatedAt: "2026-03-08T04:50:17.210Z",
            normalizedFormPayload: "{\"ignore\":\"me\"}",
            fatherPhone: "0909000000",
            fullName: "Student One",
            city: "Ho Chi Minh City",
            motherName: "Parent Mother",
            dobText: "2011-03-17",
            englishName: "Anna",
            genderSelections: ["M"],
            studentPhone: "0901000000",
            schoolName: "HCMC Public School",
            currentSchoolGrade: "6A",
            currentGrade: "egg-chicks",
            fatherName: "Parent Father",
            streetAddress: "123 Street",
            hasGlasses: "Không",
            feverMedicineAllowed: ["Paracetamol"],
            signatureFullName: "Parent Signature",
          },
          lockedFields: [],
          immutableFields: ["eaglesId", "studentNumber"],
        })
      }

      return jsonTextResponse(404, { error: "Not found" })
    },
    "http://127.0.0.1:8787/parent/portal"
  )

  const document = dom.window.document

  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), false)
  })

  const sectionHeadings = [...document.querySelectorAll("#profileFields .profile-group h4")].map((node) => normalizeText(node.textContent))
  assert.deepEqual(sectionHeadings, [
    "Thông tin của người học",
    "Liên hệ của mẹ hoặc học sinh trưởng thành",
    "Liên hệ của ba",
    "Địa chỉ",
    "Thông tin sức khỏe của người học",
    "Chăm sóc trong giờ học (nếu người học là trẻ em)",
    "Xác nhận",
    "Thông tin tài khoản (chỉ xem)",
  ])

  const studentSectionLabels = [...document.querySelectorAll("#profileFields .profile-group:first-child .field-label")]
    .map((node) => normalizeText(node.textContent))
  assert.deepEqual(studentSectionLabels, [
    "Họ tên của người học *",
    "Tên tiếng Anh",
    "Giới tính *",
    "Số điện thoại của học sinh",
    "Email của học sinh",
    "Sở thích, thú vui và nhạc cụ",
    "Ngày sinh *",
    "Thứ tự sinh *",
    "Người học có bao nhiêu anh em? *",
    "Người học có bao nhiêu chị em? *",
    "Dân tộc *",
    "Các ngôn ngữ được nói ở nhà *",
    "Vui lòng cho biết ngôn ngữ khác",
    "Hiện đang học tại trường nào *",
    "Hiện đang học lớp mấy *",
  ])

  const motherSectionLabels = [...document.querySelectorAll("#profileFields .profile-group:nth-child(2) .field-label")]
    .map((node) => normalizeText(node.textContent))
  assert.deepEqual(motherSectionLabels, [
    "Họ tên của mẹ hoặc học sinh trưởng thành *",
    "Email của mẹ hoặc học sinh trưởng thành *",
    "Số điện thoại của mẹ hoặc học sinh trưởng thành *",
    "Khi khẩn cấp, sẽ gọi mẹ trước *",
    "Số Zalo hoặc cách khác để nhắn tin nhanh cho mẹ hoặc học sinh trưởng thành",
  ])

  const addressSectionLabels = [...document.querySelectorAll("#profileFields .profile-group:nth-child(4) .field-label")]
    .map((node) => normalizeText(node.textContent))
  assert.deepEqual(addressSectionLabels, [
    "Số nhà và tên đường *",
    "Địa chỉ mới 2026 *",
    "Phường và Quận *",
    "Thành phố *",
  ])

  assert.equal(document.getElementById("pf_dobText")?.getAttribute("type"), "date")
  assert.equal(document.getElementById("pf_birthOrder")?.getAttribute("type"), "number")
  assert.equal(document.getElementById("pf_studentPhone")?.getAttribute("type"), "tel")
  assert.equal(document.getElementById("pf_studentEmail")?.getAttribute("type"), "email")
  assert.equal(document.getElementById("pf_schoolName")?.value, "HCMC Public School")
  assert.equal(document.getElementById("pf_currentSchoolGrade")?.value, "6A")
  assert.equal(Boolean(document.getElementById("pf_currentGrade")), false)
  assert.equal(document.querySelectorAll("input[name='pf_genderSelections'][type='radio']").length, 2)
  assert.equal(document.querySelector("input[name='pf_genderSelections'][type='radio']:checked")?.value, "male")
  assert.equal(document.querySelector("input[name='pf_genderSelections'][type='radio'][value='female']")?.checked, false)
  assert.equal(document.querySelectorAll("input[name='pf_hasGlasses'][type='radio']").length, 2)

  assert.equal(Boolean(document.getElementById("pf_id")), false)
  assert.equal(Boolean(document.getElementById("pf_studentRefId")), false)
  assert.equal(Boolean(document.getElementById("pf_parentsId")), false)
  assert.equal(Boolean(document.getElementById("pf_memberSince")), false)
  assert.equal(Boolean(document.getElementById("pf_requiredValidationOk")), false)
  assert.equal(Boolean(document.getElementById("pf_updatedAt")), false)
  assert.equal(Boolean(document.getElementById("pf_normalizedFormPayload")), false)
  assert.equal(Boolean(document.getElementById("pf_meta_memberSince")), true)
  assert.equal(Boolean(document.getElementById("pf_meta_parentsId")), true)
  assert.equal(Boolean(document.getElementById("pf_meta_updatedAt")), true)
  assert.equal(document.getElementById("pf_meta_memberSince")?.disabled, true)
  assert.equal(document.getElementById("pf_meta_parentsId")?.disabled, true)
  assert.equal(document.getElementById("pf_meta_updatedAt")?.disabled, true)
  assert.equal(document.getElementById("pf_meta_memberSince")?.value, "09/2025")
  assert.equal(document.getElementById("pf_meta_parentsId")?.value, "cmkramer001")
  assert.equal(document.getElementById("pf_meta_updatedAt")?.value, "2026-03-08T04:50:17.210Z")

  const profileText = normalizeText(document.getElementById("profileFields").textContent)
  assert.equal(profileText.includes("studentRefId"), false)
  assert.equal(profileText.includes("Member Since"), true)
  assert.equal(profileText.includes("Parents ID"), true)
  assert.equal(profileText.includes("Updated At"), true)
  assert.equal(profileText.includes("requiredValidationOk"), false)
  assert.equal(profileText.includes("normalizedFormPayload"), false)
  assert.equal(profileText.includes("updatedAt"), false)

  await settleDomAsync(dom)
  dom.window.close()
})

test("parent portal menu opens a detailed homework page with calendar and history", async () => {
  const dom = await createParentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      const parsed = new URL(urlText, "http://preview.invalid")
      const pathname = parsed.pathname

      if (pathname === "/api/parent/auth/me" && method === "GET") {
        return jsonTextResponse(200, {
          authenticated: true,
          user: { parentsId: "cmkramer001", role: "parent" },
        })
      }

      if (pathname === "/api/parent/children" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          items: [
            {
              eaglesId: "vi001",
              eaglesRefId: "s-vi001",
              studentNumber: 101,
              fullName: "Student One",
              englishName: "Student One",
              currentGrade: "A2 Flyers",
            },
          ],
        })
      }

      if (pathname === "/api/parent/dashboard" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          children: [
            {
              eaglesId: "vi001",
              studentNumber: 101,
              fullName: "Student One",
              currentGrade: "A2 Flyers",
              attendance: { total: 20, present: 18, absent: 1, late: 1, excused: 0 },
              assignments: { total: 4, pending: 1, overdue: 1, completed: 2 },
              grades: { averageScorePercent: 88 },
              performance: { reportCount: 2 },
              details: {
                currentHomework: [
                  {
                    id: "hw-current-1",
                    assignmentName: "Essay Draft",
                    className: "A2 Flyers",
                    dueDate: "2026-03-15",
                    dueAt: "2026-03-15T00:00:00.000Z",
                    comments: "Finish the body paragraphs and submit online.",
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
                    comments: "Still missing corrections from the last class set.",
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
                    comments: "Finish the body paragraphs and submit online.",
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
                attendanceHistory: [],
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
                    generatedDate: "2026-03-09",
                    generatedAt: "2026-03-09T09:00:00.000Z",
                    comments: "Strong progress in speaking and written response depth.",
                  },
                ],
              },
            },
          ],
        })
      }

      if (pathname === "/api/parent/children/vi001/profile" && method === "GET") {
        return jsonTextResponse(200, {
          child: {
            eaglesId: "vi001",
            studentNumber: 101,
            fullName: "Student One",
            currentGrade: "A2 Flyers",
          },
          profile: {},
          lockedFields: [],
          immutableFields: ["eaglesId", "studentNumber"],
        })
      }

      return jsonTextResponse(404, { error: "Not found" })
    },
    "http://127.0.0.1:8787/parent/portal"
  )

  const document = dom.window.document

  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), false)
  })

  document.querySelector('a[data-page-target="current-homework"]').click()

  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), true)
    assert.equal(document.getElementById("portalDetailCard").classList.contains("hidden"), false)
    assert.match(document.getElementById("portalDetailTitle").textContent, /Current Homework|Bài tập về nhà hiện tại/i)
    assert.match(document.getElementById("portalDetailPrimaryList").textContent, /Essay Draft/i)
    assert.match(document.getElementById("portalDetailCalendarGrid").textContent, /Essay Draft/i)
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("parent portal news queue chips use canonical Approved/Waiting/Revise labels", async () => {
  const dom = await createParentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      const parsed = new URL(urlText, "http://preview.invalid")
      const pathname = parsed.pathname

      if (pathname === "/api/parent/auth/me" && method === "GET") {
        return jsonTextResponse(200, {
          authenticated: true,
          user: { parentsId: "cmkramer001", role: "parent" },
        })
      }
      if (pathname === "/api/parent/children" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          items: [
            {
              eaglesId: "vi001",
              eaglesRefId: "s-vi001",
              studentNumber: 101,
              fullName: "Student One",
              englishName: "Student One",
              currentGrade: "A2 Flyers",
            },
          ],
        })
      }
      if (pathname === "/api/parent/dashboard" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          children: [
            {
              eaglesId: "vi001",
              attendance: { total: 20, present: 19, absent: 1, late: 0, excused: 0 },
              assignments: { pending: 0, overdue: 0, completed: 2 },
              grades: { averageScorePercent: 91 },
              performance: { reportCount: 1 },
              details: { reportArchive: [] },
              newsReports: {
                submittedCount: 3,
                statusSummary: {
                  approved: 1,
                  submitted: 1,
                  revisionRequested: 1,
                },
                items: [
                  {
                    id: "news-2026-03-17",
                    reportDate: "2026-03-17",
                    reviewStatus: "submitted",
                    awaitingReReview: true,
                    submittedAt: "2026-03-17T09:20:00.000Z",
                  },
                  {
                    id: "news-2026-03-12",
                    reportDate: "2026-03-12",
                    reviewStatus: "revision-requested",
                    submittedAt: "2026-03-12T09:20:00.000Z",
                  },
                ],
                window: {
                  todayDate: "2026-03-13",
                  reportDate: "2026-03-16",
                  closesAt: "2026-03-16T23:59:00.000Z",
                },
                calendar: [
                  {
                    date: "2026-03-10",
                    status: "completed",
                    reviewStatus: "approved",
                    submittedAt: "2026-03-10T09:20:00.000Z",
                  },
                  {
                    date: "2026-03-11",
                    status: "completed",
                    reviewStatus: "submitted",
                    submittedAt: "2026-03-11T09:20:00.000Z",
                  },
                  {
                    date: "2026-03-12",
                    status: "completed",
                    reviewStatus: "revision-requested",
                    submittedAt: "2026-03-12T09:20:00.000Z",
                  },
                  {
                    date: "2026-03-16",
                    status: "open",
                    canSubmit: true,
                    submittedAt: "",
                  },
                ],
              },
            },
          ],
        })
      }
      if (pathname === "/api/parent/children/vi001/profile" && method === "GET") {
        return jsonTextResponse(200, {
          child: {
            eaglesId: "vi001",
            studentNumber: 101,
            fullName: "Student One",
            currentGrade: "A2 Flyers",
          },
          profile: {},
          lockedFields: [],
          immutableFields: ["eaglesId", "studentNumber"],
        })
      }
      return jsonTextResponse(404, { error: "Not found" })
    },
    "http://127.0.0.1:8787/parent/portal"
  )

  const document = dom.window.document
  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), false)
  })

  await waitFor(() => {
    const overviewSummary = normalizeText(
      document.getElementById("parentOverviewSummary")?.textContent
    )
    assert.match(overviewSummary, /Student One\s*\(vi001\)/i)
    assert.equal(document.querySelector('label[for="childSelect"]'), null)
    assert.equal(
      normalizeText(document.getElementById("childSelect")?.getAttribute("aria-label")),
      "Chọn học sinh"
    )
  })

  await waitFor(() => {
    const metricCards = Array.from(document.querySelectorAll("#dashboardMetrics .metric"))
    assert.ok(metricCards.length >= 9)
    const metricLabels = metricCards.map((node) =>
      normalizeText(node.querySelector(".k")?.textContent)
    )
    const metricValues = metricCards.map((node) =>
      normalizeText(node.querySelector(".v")?.textContent)
    )
    const metricsText = normalizeText(document.getElementById("dashboardMetrics")?.textContent)
    assert.ok(metricLabels.includes("Tin tức đã duyệt"))
    assert.ok(metricLabels.includes("Tin tức đã nộp"))
    assert.ok(metricLabels.includes("Tin tức cần sửa"))
    assert.ok(metricValues.includes("1"))
    assert.doesNotMatch(metricsText, /\b\d+\s*\/\s*\d+\s*\/\s*\d+\b/)
  })

  await waitFor(() => {
    const headers = Array.from(document.querySelectorAll("#newsQueueCard thead th")).map((node) =>
      normalizeText(node.textContent)
    )
    const firstLatestCell = document.querySelector("#newsQueueBody tr td:nth-child(4)")
    const latestSubmissionText = normalizeText(firstLatestCell?.textContent)
    const latestSubmissionHtml = normalizeText(firstLatestCell?.innerHTML)
    assert.deepEqual(headers, [
      "Tuần báo cáo",
      "#",
      "Trạng thái",
      "Nộp gần nhất",
      "Mở",
    ])
    const queueText = normalizeText(document.getElementById("newsQueueBody")?.textContent)
    assert.match(queueText, /Cần sửa/i)
    assert.doesNotMatch(queueText, /Submitted|None Submitted|Waiting|Revise/i)
    assert.match(latestSubmissionText, /^\d{2}\/\d{2}\/\d{2}\s*\d{2}:\d{2}:\d{2}\s+\+7$/)
    assert.match(latestSubmissionHtml, /queue-compact-datetime/)
    const summaryText = normalizeText(document.getElementById("newsQueueSummary")?.textContent)
    assert.match(
      summaryText,
      /Đã duyệt\s+\d+\s+•\s+Đã nộp\s+\d+\s+•\s+Chờ duyệt\s+\d+\s+•\s+Cần sửa\s+\d+/i
    )
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("parent portal opens news detail directly from news queue when dashboard card is hidden", async () => {
  const dom = await createParentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      const parsed = new URL(urlText, "http://preview.invalid")
      const pathname = parsed.pathname

      if (pathname === "/api/parent/auth/me" && method === "GET") {
        return jsonTextResponse(200, {
          authenticated: true,
          user: { parentsId: "cmkramer001", role: "parent" },
        })
      }
      if (pathname === "/api/parent/children" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          items: [
            {
              eaglesId: "vi001",
              eaglesRefId: "s-vi001",
              studentNumber: 101,
              fullName: "Student One",
              englishName: "Student One",
              currentGrade: "A2 Flyers",
            },
          ],
        })
      }
      if (pathname === "/api/parent/dashboard" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          children: [
            {
              eaglesId: "vi001",
              attendance: { total: 20, present: 19, absent: 1, late: 0, excused: 0 },
              assignments: { pending: 0, overdue: 0, completed: 2 },
              grades: { averageScorePercent: 91 },
              performance: { reportCount: 1 },
              details: { reportArchive: [] },
              newsReports: {
                submittedCount: 2,
                statusSummary: {
                  approved: 1,
                  submitted: 0,
                  revisionRequested: 1,
                },
                items: [
                  {
                    id: "news-2026-03-30",
                    reportDate: "2026-03-30",
                    sourceLink: "https://www.bbc.com/news/articles/cx30",
                    articleTitle: "Week report revise",
                    byline: "Reporter One",
                    articleDateline: "March 30, 2026",
                    leadSynopsis: "Lead",
                    actionActor: "Actor",
                    actionAffected: "Affected",
                    actionWhere: "Where",
                    actionWhat: "What",
                    actionWhy: "Why",
                    biasAssessment: "Bias",
                    reviewStatus: "revision-requested",
                    submittedAt: "2026-03-30T09:20:00.000Z",
                  },
                  {
                    id: "news-2026-03-29",
                    reportDate: "2026-03-29",
                    sourceLink: "https://www.bbc.com/news/articles/cx29",
                    articleTitle: "Week report approved",
                    byline: "Reporter Two",
                    articleDateline: "March 29, 2026",
                    leadSynopsis: "Lead",
                    actionActor: "Actor",
                    actionAffected: "Affected",
                    actionWhere: "Where",
                    actionWhat: "What",
                    actionWhy: "Why",
                    biasAssessment: "Bias",
                    reviewStatus: "approved",
                    submittedAt: "2026-03-29T09:20:00.000Z",
                  },
                ],
                window: {
                  todayDate: "2026-03-31",
                  reportDate: "2026-04-01",
                  closesAt: "2026-04-01T23:59:00.000Z",
                },
                calendar: [
                  {
                    date: "2026-03-30",
                    status: "completed",
                    reviewStatus: "revision-requested",
                    submittedAt: "2026-03-30T09:20:00.000Z",
                  },
                  {
                    date: "2026-03-29",
                    status: "completed",
                    reviewStatus: "approved",
                    submittedAt: "2026-03-29T09:20:00.000Z",
                  },
                  {
                    date: "2026-04-01",
                    status: "open",
                    canSubmit: true,
                    submittedAt: "",
                  },
                ],
              },
            },
          ],
        })
      }
      if (
        pathname === "/api/parent/children/vi001/news-reports/calendar" &&
        method === "GET"
      ) {
        return jsonTextResponse(200, {
          ok: true,
          items: [
            {
              id: "news-2026-03-30",
              reportDate: "2026-03-30",
              sourceLink: "https://www.bbc.com/news/articles/cx30",
              articleTitle: "Week report revise",
              byline: "Reporter One",
              articleDateline: "March 30, 2026",
              leadSynopsis: "Lead",
              actionActor: "Actor",
              actionAffected: "Affected",
              actionWhere: "Where",
              actionWhat: "What",
              actionWhy: "Why",
              biasAssessment: "Bias",
              reviewStatus: "revision-requested",
              submittedAt: "2026-03-30T09:20:00.000Z",
            },
            {
              id: "news-2026-03-29",
              reportDate: "2026-03-29",
              sourceLink: "https://www.bbc.com/news/articles/cx29",
              articleTitle: "Week report approved",
              byline: "Reporter Two",
              articleDateline: "March 29, 2026",
              leadSynopsis: "Lead",
              actionActor: "Actor",
              actionAffected: "Affected",
              actionWhere: "Where",
              actionWhat: "What",
              actionWhy: "Why",
              biasAssessment: "Bias",
              reviewStatus: "approved",
              submittedAt: "2026-03-29T09:20:00.000Z",
            },
          ],
          calendar: [
            {
              date: "2026-03-30",
              status: "completed",
              reviewStatus: "revision-requested",
              submittedAt: "2026-03-30T09:20:00.000Z",
            },
            {
              date: "2026-03-29",
              status: "completed",
              reviewStatus: "approved",
              submittedAt: "2026-03-29T09:20:00.000Z",
            },
            {
              date: "2026-04-01",
              status: "open",
              canSubmit: true,
              submittedAt: "",
            },
          ],
          window: {
            todayDate: "2026-03-31",
            reportDate: "2026-04-01",
            closesAt: "2026-04-01T23:59:00.000Z",
          },
          statusSummary: {
            approved: 1,
            submitted: 0,
            revisionRequested: 1,
          },
        })
      }
      if (pathname === "/api/parent/children/vi001/profile" && method === "GET") {
        return jsonTextResponse(200, {
          child: {
            eaglesId: "vi001",
            studentNumber: 101,
            fullName: "Student One",
            currentGrade: "A2 Flyers",
          },
          profile: {},
          lockedFields: [],
          immutableFields: ["eaglesId", "studentNumber"],
        })
      }
      return jsonTextResponse(404, { error: "Not found" })
    },
    "http://127.0.0.1:8787/parent/portal"
  )

  const document = dom.window.document

  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), false)
  })

  document.querySelector('a[data-page-target="news-reports"]').click()

  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), true)
    assert.equal(document.getElementById("portalDetailCard").classList.contains("hidden"), false)
  })

  await waitFor(() => {
    assert.ok(
      document.querySelector("#portalDetailQueueBody [data-open-news-week-set]"),
      "expected week-set trigger in detail queue"
    )
  })
  const openWeekSetTrigger = document.querySelector("#portalDetailQueueBody [data-open-news-week-set]")
  const targetWeekSet = normalizeText(openWeekSetTrigger?.getAttribute("data-open-news-week-set"))
  assert.match(targetWeekSet, /news-week-set/i)
  openWeekSetTrigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))

  await waitFor(() => {
    const modal = document.getElementById("newsWeekSetModal")
    assert.equal(document.body.classList.contains("modal-open"), true)
    assert.ok(modal && !modal.classList.contains("hidden"))
    assert.equal(document.getElementById("newsWeekSetModalSubmitBtn"), null)
    assert.ok(document.getElementById("newsWeekSetModalCloseActionBtn"))
    const statusChip = document.getElementById("newsViewerReviewStatusChip")
    assert.ok(statusChip)
    assert.equal(document.getElementById("newsViewerReviewStatus"), null)
    assert.match(normalizeText(statusChip?.textContent), /Cần sửa/i)
    assert.match(normalizeText(statusChip?.className), /chip-revise/i)
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("parent portal attendance overview renders class/tardy square stats", async () => {
  const dom = await createParentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      const parsed = new URL(urlText, "http://preview.invalid")
      const pathname = parsed.pathname

      if (pathname === "/api/parent/auth/me" && method === "GET") {
        return jsonTextResponse(200, {
          authenticated: true,
          user: { parentsId: "cmkramer001", role: "parent" },
        })
      }
      if (pathname === "/api/parent/children" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          items: [
            {
              eaglesId: "vi001",
              eaglesRefId: "s-vi001",
              studentNumber: 101,
              fullName: "Student One",
              englishName: "Student One",
              currentGrade: "A2 Flyers",
            },
          ],
        })
      }
      if (pathname === "/api/parent/dashboard" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          children: [
            {
              eaglesId: "vi001",
              attendance: { total: 40, present: 34, absent: 2, late: 4, tardy10: 3, tardy30: 1, excused: 0 },
              assignments: { pending: 0, overdue: 0 },
              grades: { averageScorePercent: 90 },
              performance: { reportCount: 0 },
              details: { reportArchive: [] },
            },
          ],
        })
      }
      if (pathname === "/api/parent/children/vi001/profile" && method === "GET") {
        return jsonTextResponse(200, {
          child: {
            eaglesId: "vi001",
            studentNumber: 101,
            fullName: "Student One",
            currentGrade: "A2 Flyers",
          },
          profile: {},
          lockedFields: [],
          immutableFields: ["eaglesId", "studentNumber"],
        })
      }
      return jsonTextResponse(404, { error: "Not found" })
    },
    "http://127.0.0.1:8787/parent/portal"
  )

  const document = dom.window.document
  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), false)
  })

  assert.equal(normalizeText(document.getElementById("attendanceClassesAttendedValue")?.textContent), "34")
  assert.equal(normalizeText(document.getElementById("attendanceClassesTotalValue")?.textContent), "40")
  assert.equal(normalizeText(document.getElementById("attendanceRateValue")?.textContent), "85%")
  assert.equal(normalizeText(document.getElementById("attendanceLateTardy10Value")?.textContent), "3")
  assert.equal(normalizeText(document.getElementById("attendanceLateTardy30Value")?.textContent), "1")
  assert.equal(normalizeText(document.getElementById("attendanceLateRateValue")?.textContent), "10%")

  await settleDomAsync(dom)
  dom.window.close()
})

test("parent portal report archive sorts newest first and clears outstanding after acknowledgement", async () => {
  const dom = await createParentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      const parsed = new URL(urlText, "http://preview.invalid")
      const pathname = parsed.pathname

      if (pathname === "/api/parent/auth/me" && method === "GET") {
        return jsonTextResponse(200, {
          authenticated: true,
          user: { parentsId: "cmkramer001", role: "parent" },
        })
      }
      if (pathname === "/api/parent/children" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          items: [
            {
              eaglesId: "vi001",
              eaglesRefId: "s-vi001",
              studentNumber: 101,
              fullName: "Student One",
              englishName: "Student One",
              currentGrade: "A2 Flyers",
            },
          ],
        })
      }
      if (pathname === "/api/parent/dashboard" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          children: [
            {
              eaglesId: "vi001",
              attendance: { total: 10, present: 10, absent: 0, late: 0, excused: 0 },
              assignments: { pending: 0, overdue: 0 },
              grades: { averageScorePercent: 92 },
              performance: { reportCount: 2 },
              details: {
                reportArchive: [
                  {
                    id: "report-old",
                    className: "A2 Flyers",
                    schoolYear: "2026-2027",
                    quarter: "q1",
                    generatedDate: "2026-03-09",
                    generatedAt: "2026-03-09T09:00:00.000Z",
                    comments: "Older report",
                    homeworkCompletionRate: 92,
                    homeworkOnTimeRate: 90,
                    behaviorScore: 88,
                    participationScore: 87,
                    inClassScore: 89,
                    participationPointsAward: 8,
                  },
                  {
                    id: "report-new",
                    className: "A2 Flyers",
                    schoolYear: "2026-2027",
                    quarter: "q2",
                    generatedDate: "2026-05-09",
                    generatedAt: "2026-05-09T09:00:00.000Z",
                    comments: "Most recent report",
                    classDate: "2026-05-08",
                    classDay: "Friday",
                    teacherName: "Ms. Nguyen",
                    lessonSummary: "Reviewed Unit 6 reading and speaking strategy.",
                    visionStatus: "needs-check",
                    homeworkAnnouncement: "Homework Past Due | due 2026-05-07",
                    currentHomeworkStatus: "Cần theo dõi",
                    currentHomeworkHeader: "Homework Past Due",
                    currentHomeworkSummary: "Homework Past Due | due 2026-05-07",
                    pastDueHomeworkCount: "2",
                    pastDueHomeworkSummary: "2 bài tập quá hạn cần xử lý ngay.",
                    outstandingAssignments: [
                      {
                        assignmentName: "Homework Past Due",
                        dueAt: "2026-05-07",
                        deepLink: "https://eagles.edu.vn/homework/hw-1",
                      },
                      {
                        assignmentName: "Workbook Review",
                        dueAt: "2026-05-08",
                      },
                    ],
                    homeworkCompletionRate: 68,
                    homeworkOnTimeRate: 72,
                    behaviorScore: 74,
                    participationScore: 70,
                    inClassScore: 73,
                    participationPointsAward: 3,
                    rubricPayload: {
                      skillScores: { pt_skill_questions: "6" },
                      conductScores: { pt_conduct_focus: "7" },
                      recommendations: {
                        pt_rec_questions: "Ask at least one clarifying question each class.",
                        pt_rec_focus: "Move seat forward and reduce distractions.",
                      },
                    },
                  },
                ],
              },
            },
          ],
        })
      }
      if (pathname === "/api/parent/children/vi001/profile" && method === "GET") {
        return jsonTextResponse(200, {
          child: {
            eaglesId: "vi001",
            studentNumber: 101,
            fullName: "Student One",
            currentGrade: "A2 Flyers",
          },
          profile: {},
          lockedFields: [],
          immutableFields: ["eaglesId", "studentNumber"],
        })
      }
      return jsonTextResponse(404, { error: "Not found" })
    },
    "http://127.0.0.1:8787/parent/portal"
  )

  const document = dom.window.document
  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), false)
  })

  const reportLinks = Array.from(document.querySelectorAll("#performanceReportsList .report-archive-link"))
  assert.equal(reportLinks.length, 2)
  assert.match(normalizeText(reportLinks[0]?.textContent), /Q2/i)
  assert.match(normalizeText(reportLinks[1]?.textContent), /Q1/i)

  reportLinks[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))

  await waitFor(() => {
    assert.equal(document.getElementById("performanceReportModal").classList.contains("hidden"), false)
    assert.match(normalizeText(document.getElementById("performanceReportModalTitle")?.textContent), /1\/2/i)
    assert.match(
      normalizeText(document.getElementById("performanceReportModalMeta")?.textContent),
      /Date:.*\| Day:.*\| Time:|Ngày:.*\| Thứ:.*\| Giờ:/i
    )
    assert.match(normalizeText(document.getElementById("performanceReportIdentity")?.textContent), /A2 Flyers \| 101 \| Student One \| vi001/i)
    assert.match(normalizeText(document.getElementById("reportCurrentHomeworkHeader")?.textContent), /Homework Past Due/i)
    assert.match(normalizeText(document.getElementById("reportCurrentHomeworkBadgeValue")?.textContent), /theo dõi|theo doi/i)
    assert.match(normalizeText(document.getElementById("reportCurrentHomeworkSummary")?.textContent), /Homework Past Due/i)
    assert.match(normalizeText(document.getElementById("reportPastDueHomeworkPreviewBtn")?.textContent), /Xem danh sách chưa đầy đủ/i)
    assert.match(normalizeText(document.getElementById("reportPastDueHomeworkSummary")?.textContent), /2 bài tập quá hạn/i)
    assert.match(normalizeText(document.getElementById("performanceReportAttendanceMetrics")?.textContent), /Hồ sơ điểm danh lớp học|Chuyên cần|Lớp đã học/i)
    assert.equal(document.getElementById("performanceReportGradesHint")?.classList.contains("hidden"), true)
    assert.match(normalizeText(document.getElementById("performanceReportGradesTable")?.textContent), /Q2|68%/i)
    const sectionsText = normalizeText(document.getElementById("performanceReportModalSections")?.textContent)
    assert.match(sectionsText, /Class Focus|Trọng tâm lớp học/i)
    assert.match(sectionsText, /Lesson Summary|Tóm tắt buổi học/i)
    assert.match(sectionsText, /Needs eye check|Cần kiểm tra mắt/i)
    assert.match(sectionsText, /Ms\. Nguyen/i)
    assert.match(sectionsText, /Performance Snapshot|Tổng hợp kết quả/i)
    assert.match(sectionsText, /Basic Student Skills|Kỹ năng cơ bản của học sinh/i)
    assert.match(sectionsText, /Conduct During Class|Tác phong trong lớp/i)
    assert.match(sectionsText, /Prose|Tóm tắt của giáo viên/i)
    assert.match(sectionsText, /Comments|Nhận xét gửi phụ huynh/i)
    assert.match(sectionsText, /clarifying question/i)
  })

  document
    .getElementById("reportPastDueHomeworkPreviewBtn")
    ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))

  await waitFor(() => {
    assert.equal(document.getElementById("pastDueHomeworkModal").classList.contains("hidden"), false)
    const tableText = normalizeText(document.getElementById("pastDueHomeworkTableBody")?.textContent)
    assert.match(tableText, /Homework Past Due/i)
    assert.match(tableText, /Workbook Review/i)
  })

  document
    .getElementById("closePastDueHomeworkModalBtn")
    ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))

  document.getElementById("performanceReportNextBtn").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))

  await waitFor(() => {
    assert.match(normalizeText(document.getElementById("performanceReportModalTitle")?.textContent), /2\/2/i)
  })

  document.getElementById("performanceReportPrevBtn").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))

  await waitFor(() => {
    assert.match(normalizeText(document.getElementById("performanceReportModalTitle")?.textContent), /1\/2/i)
  })

  document.getElementById("acknowledgePerformanceReportBtn").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))

  await waitFor(() => {
    assert.match(normalizeText(document.getElementById("performanceReportAckStatus")?.textContent), /acknowledged on|Đã xác nhận lúc/i)
    assert.equal(document.querySelector('#performanceReportsList [data-report-id="report-new"]')?.classList.contains("is-outstanding"), false)
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("parent portal grade/class fallback ignores immutable eagles level when public-school field is missing", async () => {
  const dom = await createParentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      const parsed = new URL(urlText, "http://preview.invalid")
      const pathname = parsed.pathname

      if (pathname === "/api/parent/auth/me" && method === "GET") {
        return jsonTextResponse(200, {
          authenticated: true,
          user: { parentsId: "cmkramer001", role: "parent" },
        })
      }

      if (pathname === "/api/parent/children" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          items: [
            {
              eaglesId: "vi001",
              eaglesRefId: "s-vi001",
              studentNumber: 101,
              fullName: "Student One",
              englishName: "Student One",
              currentGrade: "egg-chicks",
            },
          ],
        })
      }

      if (pathname === "/api/parent/dashboard" && method === "GET") {
        return jsonTextResponse(200, {
          children: [
            {
              eaglesId: "vi001",
              attendance: { total: 0, present: 0, absent: 0 },
              assignments: { pending: 0, overdue: 0 },
              grades: { averageScorePercent: null },
              performance: { reportCount: 0 },
            },
          ],
        })
      }

      if (pathname === "/api/parent/children/vi001/profile" && method === "GET") {
        return jsonTextResponse(200, {
          child: {
            eaglesId: "vi001",
            studentNumber: 101,
            fullName: "Student One",
            currentGrade: "egg-chicks",
          },
          profile: {
            fullName: "Student One",
            schoolName: "Fallback Public School",
            currentGrade: "egg-chicks",
          },
          lockedFields: [],
          immutableFields: ["eaglesId", "studentNumber"],
        })
      }

      return jsonTextResponse(404, { error: "Not found" })
    },
    "http://127.0.0.1:8787/parent/portal"
  )

  const document = dom.window.document

  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), false)
  })

  assert.equal(document.getElementById("immutableGrade")?.textContent?.trim(), "egg-chicks")
  assert.equal(document.getElementById("pf_currentSchoolGrade")?.value, "")
  assert.equal(document.querySelectorAll("input[name='pf_genderSelections'][type='radio']:checked").length, 0)

  await settleDomAsync(dom)
  dom.window.close()
})

test("parent portal profile draft submit surfaces API errors on child page", async () => {
  const calls = []
  const dom = await createParentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      const parsed = new URL(urlText, "http://preview.invalid")
      const pathname = parsed.pathname
      calls.push(`${method} ${pathname}`)

      if (pathname === "/api/parent/auth/me" && method === "GET") {
        return jsonTextResponse(200, {
          authenticated: true,
          user: { parentsId: "cmkramer001", role: "parent" },
        })
      }
      if (pathname === "/api/parent/children" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          items: [
            {
              eaglesId: "vi001",
              eaglesRefId: "s-vi001",
              studentNumber: 101,
              fullName: "Student One",
              englishName: "Student One",
              currentGrade: "A2 Flyers",
            },
          ],
        })
      }
      if (pathname === "/api/parent/dashboard" && method === "GET") {
        return jsonTextResponse(200, {
          children: [
            {
              eaglesId: "vi001",
              attendance: { total: 20, present: 19, absent: 1 },
              assignments: { pending: 0, overdue: 0 },
              grades: { averageScorePercent: 92 },
              performance: { reportCount: 1 },
            },
          ],
        })
      }
      if (pathname === "/api/parent/children/vi001/profile" && method === "GET") {
        return jsonTextResponse(200, {
          child: {
            eaglesId: "vi001",
            studentNumber: 101,
            fullName: "Student One",
            currentGrade: "A2 Flyers",
          },
          profile: {
            schoolName: "Original School",
          },
          lockedFields: [],
          immutableFields: ["eaglesId", "studentNumber"],
        })
      }
      if (pathname === "/api/parent/children/vi001/profile-draft" && method === "PUT") {
        return jsonTextResponse(403, { error: "Profile draft save is temporarily blocked" })
      }
      return jsonTextResponse(404, { error: "Not found" })
    },
    "http://127.0.0.1:8787/parent/portal"
  )

  const document = dom.window.document
  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), false)
  })

  document.getElementById("openChildPageBtn").click()
  await waitFor(() => {
    assert.equal(document.getElementById("childPageCard").classList.contains("hidden"), false)
  })

  const schoolNameInput = document.getElementById("pf_schoolName")
  assert.ok(schoolNameInput)
  schoolNameInput.value = "Updated School"
  schoolNameInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  document.getElementById("saveDraftBtn").click()

  await waitFor(() => {
    assert.ok(calls.includes("PUT /api/parent/children/vi001/profile-draft"))
  })
  await waitFor(() => {
    const statusText = normalizeText(document.getElementById("childPageStatus").textContent)
    assert.match(statusText, /temporarily blocked/i)
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("parent portal profile review submit surfaces API errors when no draft exists", async () => {
  const calls = []
  const dom = await createParentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      const parsed = new URL(urlText, "http://preview.invalid")
      const pathname = parsed.pathname
      calls.push(`${method} ${pathname}`)

      if (pathname === "/api/parent/auth/me" && method === "GET") {
        return jsonTextResponse(200, {
          authenticated: true,
          user: { parentsId: "cmkramer001", role: "parent" },
        })
      }
      if (pathname === "/api/parent/children" && method === "GET") {
        return jsonTextResponse(200, {
          ok: true,
          items: [
            {
              eaglesId: "vi001",
              eaglesRefId: "s-vi001",
              studentNumber: 101,
              fullName: "Student One",
              englishName: "Student One",
              currentGrade: "A2 Flyers",
            },
          ],
        })
      }
      if (pathname === "/api/parent/dashboard" && method === "GET") {
        return jsonTextResponse(200, {
          children: [
            {
              eaglesId: "vi001",
              attendance: { total: 20, present: 19, absent: 1 },
              assignments: { pending: 0, overdue: 0 },
              grades: { averageScorePercent: 92 },
              performance: { reportCount: 1 },
            },
          ],
        })
      }
      if (pathname === "/api/parent/children/vi001/profile" && method === "GET") {
        return jsonTextResponse(200, {
          child: {
            eaglesId: "vi001",
            studentNumber: 101,
            fullName: "Student One",
            currentGrade: "A2 Flyers",
          },
          profile: {
            schoolName: "Original School",
          },
          lockedFields: [],
          immutableFields: ["eaglesId", "studentNumber"],
        })
      }
      if (pathname === "/api/parent/children/vi001/profile-submit" && method === "POST") {
        return jsonTextResponse(400, { error: "No saved draft found to submit" })
      }
      return jsonTextResponse(404, { error: "Not found" })
    },
    "http://127.0.0.1:8787/parent/portal"
  )

  const document = dom.window.document
  await waitFor(() => {
    assert.equal(document.getElementById("portalCard").classList.contains("hidden"), false)
  })

  document.getElementById("openChildPageBtn").click()
  await waitFor(() => {
    assert.equal(document.getElementById("childPageCard").classList.contains("hidden"), false)
  })

  document.getElementById("submitReviewBtn").click()
  await waitFor(() => {
    assert.ok(calls.includes("POST /api/parent/children/vi001/profile-submit"))
  })
  await waitFor(() => {
    const statusText = normalizeText(document.getElementById("childPageStatus").textContent)
    assert.match(statusText, /no saved draft found to submit/i)
  })

  await settleDomAsync(dom)
  dom.window.close()
})
