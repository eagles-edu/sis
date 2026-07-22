window.SIS_REPORT_CARD_SAMPLE_DATA = {
      identity: {
        controlNumber: 1001,
        eaglesId: "PREVIEW-001",
        studentNumber: 1001,
        fullName: "Preview Student",
        englishName: "Preview Student",
        dayDate: "2026-06-11",
        reportDate: "2026-06-11",
      },
      scope: {
        className: "A2\u00A0Flyers",
        schoolYear: "2025-2026",
        quarter: "Q2",
      },
      attendance: {
        total: 3,
        absences: 1,
        tardy: 1,
        percent: "66.67%",
        rate: "66.67%",
      },
      currentHomework: {
        title: "Weekend Reading Packet",
        subject: "A2\u00A0Flyers",
        teacher: "Teacher",
        note: "Preview assignment details.",
        assignmentsCount: 1,
        exercisesCount: 2,
        exercises: [
          { title: "Exercise 1", detail: "Read and answer questions.", status: "Assigned" },
          { title: "Exercise 2", detail: "Read and answer questions.", status: "Pending" },
        ],
      },
      pastDueHomework: {
        title: "Vocab Review",
        subject: "A2\u00A0Flyers",
        teacher: "Teacher",
        note: "Outstanding work details.",
        assignmentsCount: 1,
        exercisesCount: 3,
        exercises: [
          { title: "Exercise A", detail: "Pending submission.", status: "Pending" },
          { title: "Exercise B", detail: "Pending submission.", status: "Pending" },
          { title: "Exercise C", detail: "Pending submission.", status: "Submitted" },
        ],
      },
      rubric: {
        title: "How to read the rubric",
        note: "Scoring interpretation for the rubric rows below.",
        body: "This template renders the immutable rubric snapshot from the saved report payload. Each row carries the prompt, the score with its explanation, and any recommendation for success.",
        rows: [
          {
            prompt: "Homework completion",
            resultScore: "50",
            resultExplanation: "Average completion across the selected scope.",
            recommendation: "Review incomplete assignments and reinforce deadlines.",
          },
          {
            prompt: "Homework on-time",
            resultScore: "50",
            resultExplanation: "Submission timing against due dates.",
            recommendation: "Confirm due-date awareness and home support.",
          },
          {
            prompt: "Behavior",
            resultScore: "4",
            resultExplanation: "Teacher-scored behavior signal.",
            recommendation: "Follow up on conduct notes where needed.",
          },
        ],
      },
      parentReview: {
        reviewedBy: "teacher.preview",
        reviewedAt: "2026-06-11",
      },
      studentReview: {
        reviewedBy: "Preview Student",
        reviewedAt: "2026-06-11",
      },
      snapshot: {
        source: "preview-sample",
        reportId: "preview-report-001",
        studentRefId: "PREVIEW-001",
        capturedAt: "2026-06-11T00:00:00.000Z",
        capturedAtDisplay: "2026-06-11 07:00:00 GMT+07:00",
        approvedAt: "2026-06-11T02:30:00.000Z",
        approvedAtDisplay: "2026-06-11 09:30:00 GMT+07:00",
        className: "A2 Flyers",
        schoolYear: "2025-2026",
        quarter: "Q2",
      },
    };

    /* Shared portal theme toggle wiring. */
    (() => {
      const root = document.documentElement
      const themeToggle = document.getElementById("studentThemeToggle")
      const themeIcon = document.getElementById("studentThemeToggleIcon")
      const themeLabel = null
      const themeState = window.SIS_PORTAL_THEME

      function getPreferredTheme() {
        return root.dataset.theme === "dark" || root.dataset.theme === "light"
          ? root.dataset.theme
          : "light"
      }

      function syncThemeToggle(theme) {
        if (!themeToggle || !themeIcon) return
        const isDark = theme === "dark"
        themeToggle.setAttribute("aria-pressed", String(isDark))
        themeToggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme")
        themeIcon.setAttribute("name", isDark ? "theme-sun" : "theme-moon")
        if (themeLabel) {
          themeLabel.textContent = isDark ? "Light" : "Dark"
        }
      }

      function applyTheme(theme) {
        const next = themeState?.setTheme ? themeState.setTheme(theme) : (theme === "light" ? "light" : "dark")
        root.dataset.theme = next
        syncThemeToggle(next)
      }

      syncThemeToggle(getPreferredTheme())
      themeToggle?.addEventListener("click", () => {
        applyTheme(themeState?.toggleTheme ? themeState.toggleTheme("dark") : (getPreferredTheme() === "dark" ? "light" : "dark"))
      })
    })();

    (() => {
      const isPortalMode = window.__SIS_REPORT_CARD_PORTAL_MODE === true
      const viewerRole = String(window.__SIS_REPORT_CARD_VIEWER_ROLE || "").trim().toLowerCase() === "parent" ? "parent" : "student"
      const homePath = String(window.__SIS_REPORT_CARD_HOME_PATH || "").trim()

      if (isPortalMode) {
        document.body.classList.remove("admin-portal-page")
        document.body.classList.add(viewerRole === "parent" ? "parent-portal-page" : "student-portal-page")
        document.body.classList.add("report-card-portal-mode")
        document.body.dataset.reportCardViewerRole = viewerRole
        const brandLogoLinkEl = document.querySelector(".brand-logo-wrap")
        if (brandLogoLinkEl instanceof HTMLAnchorElement) {
          brandLogoLinkEl.href = viewerRole === "parent" ? "/parent" : "/student"
          brandLogoLinkEl.setAttribute(
            "aria-label",
            viewerRole === "parent" ? "Go to parent dashboard" : "Go to student dashboard"
          )
        }

        const portalMarkup = viewerRole === "parent" ? `
          <button id="parentMenuBtn" class="floating-menu-btn portal-button portal-button-immutable-chrome" type="button" aria-label="Mở điều hướng">
            <span class="floating-menu-icon" aria-hidden="true"></span>
          </button>
          <aside id="parentSideNav" class="side-nav" aria-label="Điều hướng cổng phụ huynh">
            <div class="side-brand">
              <strong>Bảng điều khiển dành cho phụ huynh</strong>
              <span>Tổng quan kết quả học tập của học sinh</span>
            </div>
            <nav class="side-links">
              <a class="side-link active" href="#report-identity" data-view-target="dashboard" data-page-target="home">Trang chủ</a>
              <a class="side-link" href="#summary-title" data-view-target="dashboard" data-page-target="attendance-calendar">Điểm danh lớp học (SYTD)</a>
              <a class="side-link" href="#current-homework-title" data-view-target="dashboard" data-page-target="current-homework">Bài tập về nhà hiện tại</a>
              <a class="side-link" href="#past-due-title" data-view-target="dashboard" data-page-target="past-due-homework">Bài tập về nhà quá hạn</a>
              <a class="side-link" href="#metrics-note-title" data-view-target="dashboard" data-page-target="rubric">Bảng chấm điểm</a>
              <a class="side-link" href="#metrics-title" data-view-target="dashboard" data-page-target="rubric-results">Kết quả chấm điểm</a>
              <a class="side-link" href="#review-title" data-view-target="dashboard" data-page-target="parent-review">Xác nhận của phụ huynh</a>
              <a class="side-link" href="#student-review-title" data-view-target="dashboard" data-page-target="student-review">Xác nhận của học sinh</a>
            </nav>
          </aside>
          <button id="parentNavScrim" class="nav-scrim portal-button portal-button-immutable-chrome" type="button" aria-label="Đóng điều hướng"></button>
        ` : `
          <button id="menuBtn" class="floating-menu-btn portal-button portal-button-immutable-chrome" type="button" aria-label="Open navigation">
            <span class="floating-menu-icon" aria-hidden="true"></span>
          </button>
          <aside id="sideNav" class="side-nav" aria-label="Student navigation">
            <div class="side-brand">
              <strong>Student Dashboard</strong>
              <span>English learning and daily media reports</span>
            </div>
            <nav class="side-links">
              <a class="side-link active" href="#report-identity" data-view-target="home" data-page-target="home">Home</a>
              <a class="side-link" href="#summary-title" data-view-target="home" data-page-target="attendance-calendar">Attendance Calendar SYTD</a>
              <a class="side-link" href="#current-homework-title" data-view-target="home" data-page-target="current-homework">Current Homework</a>
              <a class="side-link" href="#past-due-title" data-view-target="home" data-page-target="past-due-homework">Past Due Homework</a>
              <a class="side-link" href="#metrics-note-title" data-view-target="home" data-page-target="rubric">Rubric</a>
              <a class="side-link" href="#metrics-title" data-view-target="home" data-page-target="rubric-results">Detailed Results</a>
              <a class="side-link" href="#review-title" data-view-target="home" data-page-target="parent-review">Parent Review</a>
              <a class="side-link" href="#student-review-title" data-view-target="home" data-page-target="student-review">Student Review</a>
            </nav>
          </aside>
          <button id="navOverlay" class="nav-overlay portal-button portal-button-immutable-chrome" type="button" aria-label="Close navigation"></button>
        `

        document.body.insertAdjacentHTML("afterbegin", portalMarkup)

        const menuBtnEl = document.getElementById(viewerRole === "parent" ? "parentMenuBtn" : "menuBtn")
        const navEl = document.getElementById(viewerRole === "parent" ? "parentSideNav" : "sideNav")
        const overlayEl = document.getElementById(viewerRole === "parent" ? "parentNavScrim" : "navOverlay")
        const navLinks = Array.from(navEl?.querySelectorAll("a[href^='#']") || [])

        function setMenuOpen(open) {
          const shouldOpen = Boolean(open)
          navEl?.classList.toggle("open", shouldOpen)
          document.body.classList.toggle("menu-open", shouldOpen)
        }

        menuBtnEl?.addEventListener("click", () => {
          setMenuOpen(!navEl?.classList.contains("open"))
        })
        overlayEl?.addEventListener("click", () => {
          setMenuOpen(false)
        })
        navLinks.forEach((link) => link.addEventListener("click", () => {
          setMenuOpen(false)
        }))

        document.addEventListener("click", (event) => {
          if (!document.body.classList.contains("menu-open")) return
          const target = event.target
          if (!(target instanceof Element)) return
          if (navEl?.contains(target)) return
          if (menuBtnEl?.contains(target)) return
          if (overlayEl?.contains(target)) return
          setMenuOpen(false)
        })

        document.addEventListener("keydown", (event) => {
          if (event.key !== "Escape") return
          setMenuOpen(false)
        })

        window.addEventListener("resize", () => {
          if (window.innerWidth >= 768) {
            setMenuOpen(false)
          }
        })

        setMenuOpen(false)
        void homePath
        return
      }

      const menuToggleBtnEl = document.getElementById("menuToggleBtn")
      const floatingMenuBtnEl = document.getElementById("floatingMenuBtn")
      const menuBackdropEl = document.getElementById("menuBackdrop")
      const sidebarEl = document.getElementById("appSidebarNav")
      const sidebarLinks = Array.from(document.querySelectorAll("#appSidebarNav a[href^='#']"))

      function updateMenuToggleButtonLabel() {
        const menuOpen = document.body.classList.contains("menu-open")
        if (menuToggleBtnEl)
          menuToggleBtnEl.textContent = menuOpen ? "Close Menu" : "Menu"
        if (floatingMenuBtnEl) {
          floatingMenuBtnEl.setAttribute("aria-expanded", menuOpen ? "true" : "false")
          floatingMenuBtnEl.setAttribute(
            "aria-label",
            menuOpen ? "Close navigation menu" : "Open navigation menu",
          )
        }
      }

      const toggleNavigationMenu = () => {
        document.body.classList.toggle("menu-open")
        updateMenuToggleButtonLabel()
      }

      menuToggleBtnEl?.addEventListener("click", toggleNavigationMenu)
      floatingMenuBtnEl?.addEventListener("click", toggleNavigationMenu)
      menuBackdropEl?.addEventListener("click", () => {
        document.body.classList.remove("menu-open")
        updateMenuToggleButtonLabel()
      })
      sidebarLinks.forEach((link) => link.addEventListener("click", () => {
        document.body.classList.remove("menu-open")
        updateMenuToggleButtonLabel()
      }))

      document.addEventListener("click", (event) => {
        if (!document.body.classList.contains("menu-open")) return
        const target = event.target
        if (!(target instanceof Element)) return
        if (sidebarEl?.contains(target)) return
        if (menuToggleBtnEl?.contains(target)) return
        if (floatingMenuBtnEl?.contains(target)) return
        document.body.classList.remove("menu-open")
        updateMenuToggleButtonLabel()
      })

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return
        document.body.classList.remove("menu-open")
        updateMenuToggleButtonLabel()
      })

      window.addEventListener("resize", () => {
        updateMenuToggleButtonLabel()
      })

      document.body.classList.remove("menu-open")
      updateMenuToggleButtonLabel()
    })();

    /* Shared portal theme state: canonical storage lives in portal-theme-state.js. */
    (async () => {
      const initialSource =
        window.REPORT_CARD_DATA
        || window.SIS_REPORT_CARD_DATA
        || window.__SIS_REPORT_CARD_DATA
        || null

      const search = new URLSearchParams(window.location.search || "")
      const studentRefId = String(search.get("studentRefId") || "").trim()
      const className = String(search.get("className") || "").trim()
      const schoolYear = String(search.get("schoolYear") || "").trim()
      const quarter = String(search.get("quarter") || "").trim()
      const reportId = String(search.get("reportId") || "").trim()
      const queueId = String(search.get("queueId") || "").trim()
      const apiOrigin = String(search.get("apiOrigin") || window.__SIS_ADMIN_API_ORIGIN || "").trim()
      const queuedSnapshotStorageKey = queueId ? `sis.reportCardPreview.${queueId}` : ""

      function buildAdminRuntimeHref(pathname = "/admin") {
        const url = new URL(String(pathname || "/admin").trim() || "/admin", window.location.origin)
        if (apiOrigin) url.searchParams.set("apiOrigin", apiOrigin)
        return `${url.pathname}${url.search}${url.hash}`
      }

      function syncAdminNavLinks() {
        document.querySelectorAll('a[href^="/admin"]').forEach((linkEl) => {
          const href = String(linkEl.getAttribute("href") || "").trim()
          if (!href) return
          linkEl.setAttribute("href", buildAdminRuntimeHref(href))
        })
      }

      function readQueuedSnapshot() {
        if (!queuedSnapshotStorageKey) return null
        try {
          const raw = window.localStorage.getItem(queuedSnapshotStorageKey)
          if (!raw) return null
          const parsed = JSON.parse(raw)
          return parsed && typeof parsed === "object" ? parsed : null
        } catch (error) {
          void error
          return null
        }
      }

      async function fetchCurrentSnapshot() {
        if (!studentRefId) return null
        const params = new URLSearchParams()
        if (className) params.set("className", className)
        if (schoolYear) params.set("schoolYear", schoolYear)
        if (quarter) params.set("quarter", quarter)
        if (reportId) params.set("reportId", reportId)
        const endpoint =
          `${apiOrigin}/api/admin/students/${encodeURIComponent(studentRefId)}/report-card.json`
          + (params.size ? `?${params.toString()}` : "")
        const response = await fetch(endpoint, {
          credentials: "include",
          headers: { accept: "application/json" },
        })
        if (!response.ok) throw new Error(`Unable to load report snapshot (${response.status})`)
        return response.json()
      }

      let source = readQueuedSnapshot() || initialSource
      if (!source && studentRefId) {
        try {
          source = await fetchCurrentSnapshot()
        } catch (error) {
          void error
        }
      }
      if (!source || typeof source !== "object") {
        source = window.SIS_REPORT_CARD_SAMPLE_DATA
      }

      syncAdminNavLinks()
      if (!source || typeof source !== "object") return

      const report = source.report || source
      const identity = report.identity || {}
      const scope = report.scope || {}
      const snapshot = report.snapshot || {}
      const attendance = normalizeAttendanceSummary(report.attendance, report)
      const metrics = report.metrics || {}
      const currentHomework = report.currentHomework || {}
      const pastDueHomework = report.pastDueHomework || report.outstandingHomework || {}
      const rubric = report.rubric || {}
      const parentReview = report.parentReview || {}
      const studentReview = report.studentReview || {}
      const portalMode = window.__SIS_REPORT_CARD_PORTAL_MODE === true

      const toDisplay = (value, fallback = "—") => {
        if (value === undefined || value === null || value === "") return fallback
        return String(value)
      }

      const setText = (selector, value, fallback = "—") => {
        const node = document.querySelector(selector)
        if (!node) return
        node.textContent = toDisplay(value, fallback)
      }

      const setSectionValue = (sectionSelector, value, fallback = "—") => {
        const section = document.querySelector(sectionSelector)
        if (!section) return
        const valueNode = section.querySelector(".summary-value")
        if (valueNode) valueNode.textContent = toDisplay(value, fallback)
      }

      function normalizeAttendanceSummary(attendanceReport = {}, report = {}) {
        const source = attendanceReport && typeof attendanceReport === "object" ? attendanceReport : {}
        const total = source.total ?? report.attendanceTotal ?? report.totalAttendance ?? null
        const presentRaw =
          source.present ??
          source.presentCount ??
          report.presentCount ??
          report.present ??
          null
        const absences =
          source.absences ??
          source.absenceCount ??
          report.absenceCount ??
          report.absences ??
          report.absentCount ??
          null
        const tardy =
          source.tardy ??
          source.tardyCount ??
          report.tardyCount ??
          report.tardy ??
          null
        const attendancePercent =
          source.percent ??
          source.rate ??
          source.attendanceRate ??
          source.attendancePercent ??
          report.attendanceRate ??
          report.attendancePercent ??
          null
        const present =
          presentRaw !== null && presentRaw !== undefined && presentRaw !== "" ?
            presentRaw
          : Number.isFinite(Number(total)) && Number.isFinite(Number(absences)) ?
            Math.max(0, Number(total) - Number(absences))
          : null
        const attendanceDays =
          Number.isFinite(Number(present)) ? `${Number(present)} day${Number(present) === 1 ? "" : "s"}`
          : null
        return { total, present, absences, tardy, attendancePercent, attendanceDays }
      }

      const renderExerciseList = (selector, exercises) => {
        const list = document.querySelector(selector)
        list.textContent = ""
        if (!list) return
        if (!Array.isArray(exercises) || !exercises.length) {
          const item = document.createElement("li")
          item.className = "exercise-item"
          item.textContent = "No exercises in this section."
          list.appendChild(item)
          return
        }
        exercises.forEach((exercise) => {
          const item = document.createElement("li")
          item.className = "exercise-item"

          const head = document.createElement("div")
          head.className = "exercise-head"

          const title = document.createElement("p")
          title.className = "exercise-title"
          title.textContent = toDisplay(exercise?.title || exercise?.name || exercise?.assignmentName)

          const status = document.createElement("span")
          status.className = "report-chip"
          status.textContent = toDisplay(exercise?.status || exercise?.state || "Pending")

          head.append(title, status)

          const meta = document.createElement("p")
          meta.className = "exercise-meta"
          meta.textContent = toDisplay(exercise?.detail || exercise?.note || exercise?.description)

          item.append(head, meta)
          list.appendChild(item)
        })
      }

      const renderHomeworkSection = (kind, payload) => {
        const section = document.querySelector(`[data-report-homework="${kind}"]`)
        if (!section || !payload) return

        const titleNode = section.querySelector("[data-report-homework-title]")
        const metaNode = section.querySelector("[data-report-homework-meta]")
        const noteNode = section.querySelector("[data-report-homework-note]")
        const exercisesSelector = `[data-report-homework-exercises="${kind}"]`

        if (titleNode) titleNode.textContent = toDisplay(payload.title || payload.assignmentName || payload.name)
        if (metaNode) {
          const subject = toDisplay(payload.subject || payload.className || payload.course)
          const teacher = toDisplay(payload.teacher || payload.owner || payload.assignee)
          metaNode.textContent = `${subject} · ${teacher}`
        }
        if (noteNode) noteNode.textContent = toDisplay(payload.note || payload.summary || payload.description)
        renderExerciseList(exercisesSelector, payload.exercises || payload.items || [])
      }

      const renderRubricRows = (rows) => {
        const tbody = document.getElementById("report-rubric-body")
        if (!tbody || !Array.isArray(rows) || !rows.length) return
        tbody.textContent = ""
        rows.forEach((row) => {
          const tr = document.createElement("tr")
          const metricCell = document.createElement("td")
          const resultCell = document.createElement("td")
          const recommendationCell = document.createElement("td")

          const metricTitle = document.createElement("p")
          metricTitle.className = "metric-title"
          metricTitle.textContent = toDisplay(row?.prompt || row?.metric || row?.title)

          const metricText = document.createElement("p")
          metricText.className = "metric-text"
          metricText.textContent = toDisplay(row?.resultExplanation || row?.detail || row?.subtitle)

          metricCell.append(metricTitle, metricText)
          const resultScore = toDisplay(row?.resultScore || row?.observedResult || row?.result || row?.observed)
          const resultExplanation = toDisplay(row?.resultExplanation || row?.detail || row?.summary || row?.interpretation)
          resultCell.textContent = `${resultScore}${resultExplanation ? ` · ${resultExplanation}` : ""}`
          recommendationCell.textContent = toDisplay(row?.recommendation || row?.actionNote || row?.action || row?.note)

          tr.append(metricCell, resultCell, recommendationCell)
          tbody.appendChild(tr)
        })
      }

      setText('[data-field="control-number"]', report.controlNumber || identity.controlNumber)
      setText('[data-field="student-name"]', identity.fullName || report.fullName || report.studentName)
      setText('[data-field="eagles-id"]', identity.eaglesId || report.eaglesId)
      setText('[data-field="english-name"]', identity.englishName || report.englishName)
      setText('[data-field="day-date"]', identity.dayDate || report.dayDate || report.reportDate)
      setText('[data-field="scope-class-name"]', scope.className || snapshot.className)
      setText('[data-field="scope-school-year"]', scope.schoolYear || snapshot.schoolYear)
      setText('[data-field="scope-quarter"]', scope.quarter || snapshot.quarter)
      setText('[data-field="snapshot-id"]', snapshot.reportId || report.reportId)
      setText('[data-field="snapshot-captured-at"]', snapshot.capturedAtDisplay || snapshot.capturedAt || report.generatedAt)
      setText('[data-field="snapshot-source"]', snapshot.source || (report.latestParentReport ? "saved-parent-report" : "derived-current-records"))
      setText('[data-field="metric-homework-completion"]', metrics.homeworkCompletionRate)
      setText('[data-field="metric-homework-on-time"]', metrics.homeworkOnTimeRate)
      setText('[data-field="metric-behavior"]', metrics.behaviorScore)
      setText('[data-field="metric-participation"]', metrics.participationScore)
      setText('[data-field="metric-in-class"]', metrics.inClassScore)
      setText('[data-field="metric-participation-points"]', metrics.participationPointsAward)
      setText(
        '[data-field="metric-teacher-summary"]',
        [
          `Teacher: ${toDisplay(metrics.teacherName)}`,
          `Lesson summary: ${toDisplay(metrics.lessonSummary)}`,
          `Vision status: ${toDisplay(metrics.visionStatus)}`,
          `Teacher comment: ${toDisplay(metrics.teacherComment)}`,
        ].join(" | ")
      )

      setSectionValue('[data-report-summary="attendance"]', attendance.attendanceDays)
      setSectionValue('[data-report-summary="absences"]', attendance.absences)
      setSectionValue('[data-report-summary="tardy"]', attendance.tardy)
      setSectionValue('[data-report-summary="attendance-percent"]', attendance.attendancePercent)

      setText("#current-assignment-count", currentHomework.assignmentsCount ?? currentHomework.assignmentCount ?? report.currentAssignmentCount)
      setText("#current-exercise-count", currentHomework.exercisesCount ?? currentHomework.exerciseCount ?? report.currentExerciseCount)
      setText("#past-assignment-count", pastDueHomework.assignmentsCount ?? pastDueHomework.assignmentCount ?? report.pastAssignmentCount)
      setText("#past-exercise-count", pastDueHomework.exercisesCount ?? pastDueHomework.exerciseCount ?? report.pastExerciseCount)

      renderHomeworkSection("current", currentHomework)
      renderHomeworkSection("past-due", pastDueHomework)

      setText('[data-report-rubric-note]', rubric.note || report.rubricNote)
      setText('[data-report-rubric-title]', rubric.title || report.rubricTitle)
      setText('[data-report-rubric-body]', rubric.body || report.rubricBody)
      renderRubricRows(rubric.rows || report.rubricRows || [])

      setText('[data-field="parent-reviewed-by"]', parentReview.reviewedBy || report.parentReviewedBy)
      setText('[data-field="parent-reviewed-at"]', parentReview.reviewedAt || report.parentReviewedAt)
      setText('[data-field="student-reviewed-by"]', studentReview.reviewedBy || report.studentReviewedBy)
      setText('[data-field="student-reviewed-at"]', studentReview.reviewedAt || report.studentReviewedAt)

      if (portalMode) {
        const viewerRole =
          String(window.__SIS_REPORT_CARD_VIEWER_ROLE || "").trim().toLowerCase() === "parent"
            ? "parent"
            : "student"
        const reportIdentifier = toDisplay(snapshot.reportId || report.reportId, "")
        const parentActionBtn = document.getElementById("parentReviewActionBtn")
        const studentActionBtn = document.getElementById("studentReviewActionBtn")
        const parentToggle = document.querySelector('input[name="parentReviewed"]')
        const studentToggle = document.querySelector('input[name="studentReviewed"]')
        const activeActionBtn = viewerRole === "parent" ? parentActionBtn : studentActionBtn
        const activeToggle = viewerRole === "parent" ? parentToggle : studentToggle
        const activeReviewedAtField = document.querySelector(
          viewerRole === "parent" ? '[data-field="parent-reviewed-at"]' : '[data-field="student-reviewed-at"]'
        )
        const activeReviewedByField = document.querySelector(
          viewerRole === "parent" ? '[data-field="parent-reviewed-by"]' : '[data-field="student-reviewed-by"]'
        )
        const activeReviewState =
          viewerRole === "parent"
            ? (parentReview.reviewedAt || report.parentReviewedAt)
            : (studentReview.reviewedAt || report.studentReviewedAt)

        if (viewerRole === "parent") {
          studentActionBtn?.classList.add("hidden")
          studentToggle?.closest(".review-toggle")?.classList.add("hidden")
        } else {
          parentActionBtn?.classList.add("hidden")
          parentToggle?.closest(".review-toggle")?.classList.add("hidden")
        }

        if (activeToggle instanceof HTMLInputElement) {
          activeToggle.checked = Boolean(activeReviewState)
        }
        if (activeActionBtn instanceof HTMLButtonElement) {
          if (activeReviewState) {
            activeActionBtn.textContent = "Review recorded"
            activeActionBtn.disabled = true
          }
          activeActionBtn.addEventListener("click", async () => {
            if (!reportIdentifier || activeActionBtn.disabled) return
            if (activeToggle instanceof HTMLInputElement && !activeToggle.checked) {
              activeToggle.checked = true
            }
            activeActionBtn.disabled = true
            const originalText = activeActionBtn.textContent
            activeActionBtn.textContent = "Recording..."
            try {
              const endpoint =
                viewerRole === "parent"
                  ? `/api/parent/reports/${encodeURIComponent(reportIdentifier)}/acknowledge`
                  : `/api/student/reports/${encodeURIComponent(reportIdentifier)}/acknowledge`
              const response = await fetch(endpoint, {
                method: "POST",
                credentials: "include",
                headers: { accept: "application/json" },
              })
              if (!response.ok) {
                throw new Error(`Unable to record review (${response.status})`)
              }
              const payload = await response.json()
              const nextReport = payload?.report || {}
              if (activeReviewedAtField) {
                activeReviewedAtField.textContent = toDisplay(
                  viewerRole === "parent" ? nextReport.parentReviewedAt : nextReport.studentReviewedAt
                )
              }
              if (activeReviewedByField) {
                activeReviewedByField.textContent = toDisplay(
                  viewerRole === "parent"
                    ? nextReport.parentReviewedByUsername
                    : nextReport.studentReviewedByUsername
                )
              }
              activeActionBtn.textContent = "Review recorded"
            } catch (error) {
              activeActionBtn.disabled = false
              activeActionBtn.textContent = originalText
              window.alert(error?.message || String(error))
              return
            }
          })
        }
      }
    })();
