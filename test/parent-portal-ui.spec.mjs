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
    assert.match(document.getElementById("portalDetailTitle").textContent, /Current Homework/i)
    assert.match(document.getElementById("portalDetailPrimaryList").textContent, /Essay Draft/i)
    assert.match(document.getElementById("portalDetailCalendarGrid").textContent, /Essay Draft/i)
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
