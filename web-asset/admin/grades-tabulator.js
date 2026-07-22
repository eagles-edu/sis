(() => {
      "use strict"
      const state = {
        allRows: [],
        filteredRows: [],
        matrixRows: [],
        table: null,
        tableBuilt: false,
        columnSchemaKey: "",
        tableHeightPx: null,
        tableResizeObserver: null,
        responsiveCollapseEnabled: false,
        loading: false,
        compactMode: false,
        distributionModalPayload: null,
        distributionModalPoints: [],
        distributionModalActiveIndex: -1,
        distributionModalZoom: 1,
        distributionModalBaseWidth: 760,
        distributionModalBaseHeight: 360,
        distributionModalFullscreen: false,
        tableModalOpen: false,
        letterGradeRanges: [],
        uiSettingsMeta: null,
        schoolSetup: {
          schoolYear: "",
          schoolName: "",
          multiSchool: false,
          startDate: "",
          endDate: "",
          quarters: [],
        },
        filters: {
          period: "sytd",
          schoolYear: "",
          quarter: "",
          classKey: "all",
          studentKey: "all",
          schoolKey: "all",
          customFrom: "",
          customTo: "",
          search: "",
        },
      }
      const DEFAULT_LETTER_GRADE_RANGES = Object.freeze([
        Object.freeze({
          letter: "A",
          minPercent: 90,
          maxPercent: 100
        }),
        Object.freeze({
          letter: "B",
          minPercent: 80,
          maxPercent: 89.99
        }),
        Object.freeze({
          letter: "C",
          minPercent: 70,
          maxPercent: 79.99
        }),
        Object.freeze({
          letter: "D",
          minPercent: 60,
          maxPercent: 69.99
        }),
        Object.freeze({
          letter: "F",
          minPercent: 0,
          maxPercent: 59.99
        }),
      ])
      ;(() => {
        const root = document.documentElement
        const themeToggle = document.getElementById("studentThemeToggle")
        const themeIcon = document.getElementById("studentThemeToggleIcon")
        const themeLabel = null
        const themeState = window.SIS_PORTAL_THEME

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
          const next = themeState?.setTheme ? themeState.setTheme(theme) : (theme === "dark" ? "dark" : "light")
          root.dataset.theme = next
          syncThemeToggle(next)
        }

        themeToggle?.addEventListener("click", () => {
          applyTheme(themeState?.toggleTheme ? themeState.toggleTheme("light") : (root.dataset.theme === "dark" ? "light" : "dark"))
        })
        applyTheme(themeState?.getTheme ? themeState.getTheme("light") : (root.dataset.theme === "dark" ? "dark" : "light"))
      })()
      const API_ORIGIN = resolveApiOrigin()
      const INITIAL_AUTH_STATE =
        window.__SIS_ADMIN_INITIAL_AUTH__ &&
        typeof window.__SIS_ADMIN_INITIAL_AUTH__ === "object" ?
          window.__SIS_ADMIN_INITIAL_AUTH__
        : null
      const TODAY_ISO = localIsoDate(new Date())
      let SYSTEM_CURRENT_SCHOOL_YEAR = resolveSystemCurrentSchoolYear()
      const TABLE_PERSISTENCE_ID = "sis-grades-tabulator-v1"
      const LEGACY_TABLE_PERSISTENCE_ID = "sis-grades-tabulator-dev-v1"
      const UI_PREFS_KEY = "sis.grades-tabulator.ui-prefs.v1"
      const LEGACY_UI_PREFS_KEY = "sis.grades-tabulator-dev.ui-prefs.v1"
      const TABLE_UI_STATE_KEY = "sis.grades-tabulator.table-state.v1"
      const LEGACY_TABLE_UI_STATE_KEY = "sis.grades-tabulator-dev.table-state.v1"
      const TABLE_UI_STATE_SCHEMA_VERSION = 2
      const AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX = "auto-imported exercise score"
      const GRADE_RECORD_SOURCE_ASSIGNMENT = "assignment"
      const GRADE_RECORD_SOURCE_MANUAL = "manual"
      const GRADE_RECORD_SOURCE_AUTO_IMPORT = "auto-import"
      const GRADE_RECORD_SOURCES_VISIBLE_IN_MATRIX = new Set([
        GRADE_RECORD_SOURCE_ASSIGNMENT,
        GRADE_RECORD_SOURCE_MANUAL,
        GRADE_RECORD_SOURCE_AUTO_IMPORT,
      ])
      const ASSIGNMENT_HEAD_CLASS = "assignment-head"
      const ASSIGNMENT_HEAD_ELECTIVE_CLASS = "assignment-head elective"
      const TABLE_HEIGHT_MIN_PX = 320
      const TABLE_HEIGHT_MAX_PX = 1400
      const DISTRIBUTION_ZOOM_MIN = 1
      const DISTRIBUTION_ZOOM_MAX = 6
      const DISTRIBUTION_ZOOM_STEP = 0.1

      function normalizeText(value) {
        if (value === undefined || value === null) return ""
        return String(value).trim()
      }

      function normalizeLower(value) {
        return normalizeText(value).toLowerCase()
      }

      function normalizeGradeRecordSource(value) {
        const source = normalizeLower(value)
        if (
          source === GRADE_RECORD_SOURCE_ASSIGNMENT ||
          source === GRADE_RECORD_SOURCE_MANUAL ||
          source === GRADE_RECORD_SOURCE_AUTO_IMPORT
        ) {
          return source
        }
        return ""
      }

      function tableHostElement() {
        const el = document.getElementById("gradeGrid")
        return el instanceof HTMLElement ? el : null
      }

      function defaultTableHeightPx() {
        const viewportHeight = Number(window.innerHeight) || 900
        return Math.max(420, Math.min(760, Math.round(viewportHeight * 0.66)))
      }

      function normalizeTableHeightPx(value, fallback) {
        const hasValue = value !== null && value !== undefined && value !== ""
        const hasFallback = fallback !== null && fallback !== undefined && fallback !== ""
        const raw = hasValue ? Number(value) : Number.NaN
        const fallbackRaw = hasFallback ? Number(fallback) : Number.NaN
        const candidate = Number.isFinite(raw) ?
          raw :
          Number.isFinite(fallbackRaw) ?
          fallbackRaw :
          null
        if (!Number.isFinite(candidate)) return null
        return Math.max(TABLE_HEIGHT_MIN_PX, Math.min(TABLE_HEIGHT_MAX_PX, Math.round(candidate)))
      }

      function isMegsAssignmentTitle(value) {
        return /\bmegs\b/i.test(normalizeText(value))
      }

      function normalizeAssignmentHeaderTitle(value) {
        const raw = normalizeText(value)
        if (!raw) return "Exercise"
        const stripped = raw.replace(/\bmegs\b/gi, " ").replace(/\s+/g, " ").trim()
        return stripped || "Exercise"
      }

      function truncateHeaderTitle(value, maxLength = 12) {
        const text = normalizeText(value)
        if (!text) return ""
        const limit = Number.isFinite(maxLength) ? Math.max(4, Math.trunc(maxLength)) : 12
        if (text.length <= limit) return text
        return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`
      }

      function buildHeaderActionButtons(label = "Column") {
        const normalizedLabel = normalizeText(label) || "Column"
        const safeLabel = escapeHtml(normalizedLabel)
        return (
          `<span class=\"header-action-row\" role=\"group\" aria-label=\"${safeLabel} column controls\" data-header-label=\"${safeLabel}\">` +
          `<button class=\"header-action-btn plus\" type=\"button\" data-header-action=\"pin\" aria-label=\"Pin or unpin ${safeLabel} column\">+</button>` +
          `<button class=\"header-action-btn minus\" type=\"button\" data-header-action=\"hide\" aria-label=\"Hide ${safeLabel} column\">-</button>` +
          `</span>`
        )
      }

      function buildCoreHeaderCard(title, topSubline, bottomSubline, maxLength = 12) {
        const normalizedTitle = normalizeText(title) || "Column"
        const normalizedTopSubline = normalizeText(topSubline) || "-"
        const normalizedBottomSubline = normalizeText(bottomSubline)
        const shortTitle = truncateHeaderTitle(normalizedTitle, maxLength)
        return (
          `<span class=\"assignment-head core\">` +
          `${buildHeaderActionButtons(normalizedTitle)}` +
          `<span class=\"assignment-title-text\">${escapeHtml(shortTitle)}</span>` +
          `<span class=\"assignment-sub core-sub\">${escapeHtml(normalizedTopSubline)}</span>` +
          (normalizedBottomSubline ?
            `<span class=\"assignment-sub core-sub\">${escapeHtml(normalizedBottomSubline)}</span>` :
            "") +
          `</span>`
        )
      }

      function studentColumnDefaultWidthForViewport(viewportWidth) {
        const width = Number.isFinite(viewportWidth) ? viewportWidth : 1280
        if (width <= 420) return 92
        if (width <= 560) return 104
        if (width <= 760) return 118
        if (width <= 980) return 136
        return 182
      }

      function studentColumnMinWidthForResize() {
        return Math.max(24, Math.round((3 * 7.6) + 24))
      }

      function clampNumber(value, minValue, maxValue) {
        const min = Number.isFinite(minValue) ? minValue : 0
        const max = Number.isFinite(maxValue) ? Math.max(min, maxValue) : min
        if (!Number.isFinite(value)) return min
        return Math.min(max, Math.max(min, value))
      }

      function estimatedWidthFromChars(charCount, options = {}) {
        const minWidth = Math.max(48, Number(options.minWidth) || 48)
        const maxWidth = Math.max(minWidth, Number(options.maxWidth) || minWidth)
        const charWidth = Math.max(5.4, Number(options.charWidth) || 7.4)
        const cellPadding = Math.max(12, Number(options.cellPadding) || 28)
        const chars = Math.max(0, Number.isFinite(charCount) ? Math.round(charCount) : 0)
        const estimatedWidth = Math.round((chars * charWidth) + cellPadding)
        return clampNumber(estimatedWidth, minWidth, maxWidth)
      }

      function coreColumnDataWidth(rows, field, options = {}) {
        const sourceRows = Array.isArray(rows) ? rows : []
        const projectedText = typeof options.getText === "function" ?
          options.getText :
          (value) => normalizeText(value)
        let maxChars = Math.max(0, Number.parseInt(String(options.minChars || 0), 10) || 0)
        sourceRows.forEach((row) => {
          const text = normalizeText(projectedText(row?.[field], row))
          if (text.length > maxChars) maxChars = text.length
        })
        return estimatedWidthFromChars(maxChars, options)
      }

      function assignmentCellSummaryForWidth(value, rowData = {}) {
        if (rowData?.rowType === "stat") {
          if (normalizeText(rowData?.id) === "stat-distribution") return "Distribution"
          const summaryText = value && typeof value === "object" ?
            normalizeText(value.summaryText) :
            normalizeText(value)
          return summaryText || "n/a"
        }
        if (!value || typeof value !== "object") return "-/- Not done"
        const scoreLabel = Number.isFinite(value.score) && Number.isFinite(value.maxScore) && value.maxScore > 0 ?
          `${formatShortNumber(value.score)}/${formatShortNumber(value.maxScore)}` :
          Number.isFinite(value.score) ?
          `${formatShortNumber(value.score)}` :
          "-/-"
        const percentLabel = Number.isFinite(value.percent) ? `${Math.round(value.percent)}%` : "n/a"
        return `${scoreLabel} ${percentLabel}`.trim()
      }

      function assignmentColumnDataWidth(rows, field, options = {}) {
        return coreColumnDataWidth(rows, field, {
          ...options,
          getText: (value, row) => assignmentCellSummaryForWidth(value, row),
        })
      }

      function formatStudentNumberForWrap(value) {
        const text = normalizeText(value)
        if (!text) return ""
        const escaped = escapeHtml(text)
        if (/^\d{7,}$/u.test(text)) {
          return escaped.replace(/(\d{3})(?=\d)/g, "$1<wbr>")
        }
        return escaped
      }

      function normalizeLetterCode(value) {
        const text = normalizeText(value).toUpperCase()
        if (!text) return ""
        if (!/^[A-Z][A-Z0-9+-]{0,3}$/u.test(text)) return ""
        return text
      }

      function clampPercent(value) {
        if (!Number.isFinite(value)) return null
        if (value < 0) return 0
        if (value > 100) return 100
        return value
      }

      function normalizeLetterGradeRanges(source = []) {
        const rows = Array.isArray(source) ? source : []
        const normalized = rows
          .map((entry) => {
            const letter = normalizeLetterCode(entry?.letter)
            const minPercentRaw = toNumber(entry?.minPercent)
            const maxPercentRaw = toNumber(entry?.maxPercent)
            const minPercent = clampPercent(minPercentRaw)
            const maxPercent = clampPercent(maxPercentRaw)
            if (!letter) return null
            if (!Number.isFinite(minPercent) || !Number.isFinite(maxPercent)) return null
            const low = Math.min(minPercent, maxPercent)
            const high = Math.max(minPercent, maxPercent)
            return {
              letter,
              minPercent: low,
              maxPercent: high,
            }
          })
          .filter((entry) => entry && typeof entry === "object")
          .sort((left, right) => right.minPercent - left.minPercent)
        if (!normalized.length) {
          return DEFAULT_LETTER_GRADE_RANGES.map((entry) => ({
            ...entry
          }))
        }
        return normalized
      }

      function letterGradeRangesFromUiSettings(settings) {
        const candidate = settings && typeof settings === "object" ?
          settings?.schoolSetup?.letterGradeRanges :
          null
        return normalizeLetterGradeRanges(candidate)
      }

      function schoolYearFromUiSettings(settings) {
        const candidate = settings && typeof settings === "object" ?
          normalizeText(settings?.schoolSetup?.schoolYear) :
          ""
        return isSchoolYearKey(candidate) ? candidate : ""
      }

      function normalizeSchoolSetupQuarters(source = []) {
        return (Array.isArray(source) ? source : [])
          .map((entry) => {
            const quarter = normalizeQuarterCode(entry?.quarter)
            const startDate = normalizeText(entry?.startDate).slice(0, 10)
            const endDate = normalizeText(entry?.endDate).slice(0, 10)
            if (!quarter || !parseIsoDate(startDate) || !parseIsoDate(endDate)) return null
            if (compareIsoDate(startDate, endDate) > 0) return null
            return {
              quarter,
              startDate,
              endDate
            }
          })
          .filter((entry) => entry && typeof entry === "object")
          .sort((left, right) => quarterSortKey(left?.quarter) - quarterSortKey(right?.quarter))
      }

      function uiSettingsMetaFromSource(settings) {
        const candidate = settings && typeof settings === "object" ? settings : {}
        const schoolSetup = candidate?.schoolSetup && typeof candidate.schoolSetup === "object" ?
          candidate.schoolSetup :
          {}
        const quarters = Array.isArray(schoolSetup?.quarters) ? schoolSetup.quarters : []
        const startDate = normalizeText(schoolSetup?.startDate).slice(0, 10)
        const endDate = normalizeText(schoolSetup?.endDate).slice(0, 10)
        const isIsoDate = (value = "") => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
        const validRange = isIsoDate(startDate) && isIsoDate(endDate) && startDate <= endDate
        const validQuarters = quarters.filter((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
          const quarter = normalizeText(entry?.quarter || entry?.key).toLowerCase()
          const quarterStart = normalizeText(entry?.startDate).slice(0, 10)
          const quarterEnd = normalizeText(entry?.endDate).slice(0, 10)
          return /^q[1-4]$/.test(quarter) && isIsoDate(quarterStart) && isIsoDate(quarterEnd) && quarterStart <= quarterEnd
        })
        const schoolSetupState =
          validRange && validQuarters.length === 4 && validQuarters.length === quarters.length ?
            "ok" :
            "maintenance"
        return {
          schoolSetupStoredQuarterCount: quarters.length,
          schoolSetupStoredQuartersPresent: quarters.length > 0,
          schoolSetupStoredQuartersMissing: quarters.length < 4,
          schoolSetupState,
          schoolSetupHasIssues: schoolSetupState !== "ok",
        }
      }

      function syncSchoolSetupFromUiSettings(settings) {
        const setup = settings && typeof settings === "object" && settings.schoolSetup && typeof settings.schoolSetup === "object" ?
          settings.schoolSetup :
          {}
        const schoolYear = schoolYearFromUiSettings({
          schoolSetup: setup
        })
        const startDate = normalizeText(setup?.startDate).slice(0, 10)
        const endDate = normalizeText(setup?.endDate).slice(0, 10)
        const schoolProfile = settings && typeof settings === "object" && settings.schoolProfile && typeof settings.schoolProfile === "object" ?
          settings.schoolProfile : {}
        state.schoolSetup = {
          schoolYear: isSchoolYearKey(schoolYear) ? schoolYear : "",
          schoolName: normalizeText(schoolProfile.schoolName),
          multiSchool: settings?.multiSchool === true,
          startDate: parseIsoDate(startDate) ? startDate : "",
          endDate: parseIsoDate(endDate) ? endDate : "",
          quarters: normalizeSchoolSetupQuarters(setup?.quarters),
        }
        refreshSystemCurrentSchoolYear(state.schoolSetup.schoolYear)
      }

      function renderSchoolSetupWarning() {
        const warningEl = document.getElementById("schoolSetupWarning")
        if (!(warningEl instanceof HTMLElement)) return
        const meta = state.uiSettingsMeta || {}
        const portalIssue = meta.schoolSetupHasIssues === true || meta.schoolSetupStoredQuartersMissing === true
        if (!portalIssue) {
          warningEl.classList.add("hidden")
          warningEl.textContent = ""
          warningEl.removeAttribute("aria-live")
          return
        }
        warningEl.classList.remove("hidden")
        warningEl.setAttribute("aria-live", "polite")
        const schoolSetupHref = `${buildAdminRuntimeHref(
          normalizeText(window.__SIS_ADMIN_PAGE_PATH) || "/admin",
        )}#schoolSetupPanel`
        warningEl.innerHTML =
          `Quarter setup is incomplete or invalid. <a href="${schoolSetupHref}">Open School Setup</a> to restore it before rollover or after any settings hiccup.`
      }

      function renderGradeGridMaintenance(maintenance = {}) {
        const host = tableHostElement()
        if (!host) return
        if (state.table && typeof state.table.destroy === "function") {
          state.table.destroy()
        }
        state.table = null
        state.tableBuilt = false
        host.innerHTML = ""
        const shell = document.createElement("div")
        shell.className = "detail-empty grade-grid-maintenance"
        const figure = document.createElement("img")
        figure.src = "/web-asset/shared/maintenance.svg"
        figure.alt = ""
        figure.setAttribute("aria-hidden", "true")
        const title = document.createElement("div")
        title.className = "detail-empty-title"
        title.textContent = maintenance.title || "Quarter grades are temporarily unavailable"
        const lead = document.createElement("div")
        lead.className = "detail-empty-copy"
        lead.textContent = maintenance.lead || "Quarter setup is incomplete or invalid."
        const note = document.createElement("div")
        note.className = "detail-empty-copy"
        note.textContent = maintenance.note || "Open School Setup and save four explicit quarters before reloading the matrix."
        shell.append(figure, title, lead, note)
        host.append(shell)
      }

      function normalizeSearch(value) {
        return normalizeLower(value)
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d")
          .replace(/[^a-z0-9]+/g, " ")
          .trim()
      }

      function isSchoolYearKey(value) {
        return /^\d{4}-\d{4}$/.test(normalizeText(value))
      }

      function localIsoDate(value) {
        const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
        if (Number.isNaN(date.valueOf())) return ""
        const y = String(date.getFullYear()).padStart(4, "0")
        const m = String(date.getMonth() + 1).padStart(2, "0")
        const d = String(date.getDate()).padStart(2, "0")
        return `${y}-${m}-${d}`
      }

      function parseIsoDate(value) {
        const text = normalizeText(value).slice(0, 10)
        const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (!match) return null
        const y = Number.parseInt(match[1], 10)
        const m = Number.parseInt(match[2], 10)
        const d = Number.parseInt(match[3], 10)
        const date = new Date(y, m - 1, d)
        if (Number.isNaN(date.valueOf())) return null
        if (localIsoDate(date) !== text) return null
        return date
      }

      function isoDateOffset(value, days) {
        const parsed = parseIsoDate(value)
        if (!parsed) return ""
        const copy = new Date(parsed.getTime())
        copy.setDate(copy.getDate() + (Number.isFinite(days) ? Math.trunc(days) : 0))
        return localIsoDate(copy)
      }

      function compareIsoDate(left, right) {
        return normalizeText(left).slice(0, 10).localeCompare(normalizeText(right).slice(0, 10))
      }

      function startOfWeekIso(value) {
        const parsed = parseIsoDate(value)
        if (!parsed) return ""
        const copy = new Date(parsed.getTime())
        const weekday = copy.getDay()
        const diff = (weekday + 6) % 7
        copy.setDate(copy.getDate() - diff)
        return localIsoDate(copy)
      }

      function schoolYearForIsoDate(value) {
        const parsed = parseIsoDate(value)
        if (!parsed) return ""
        const setup = state.schoolSetup && typeof state.schoolSetup === "object" ? state.schoolSetup : {}
        const startDate = normalizeText(setup.startDate).slice(0, 10)
        const endDate = normalizeText(setup.endDate).slice(0, 10)
        const schoolYear = normalizeText(setup.schoolYear)
        if (!schoolYear || !parseIsoDate(startDate) || !parseIsoDate(endDate) || compareIsoDate(startDate, endDate) > 0) return ""
        const isoDate = localIsoDate(parsed)
        if (compareIsoDate(isoDate, startDate) >= 0 && compareIsoDate(isoDate, endDate) <= 0) return schoolYear
        return ""
      }

      function quarterFromIsoDate(value) {
        const setupQuarter = normalizeQuarterCode(schoolSetupQuarterForIsoDate(value))
        if (setupQuarter) return setupQuarter
        return ""
      }

      function calendarQuarterFromIsoDate(value) {
        void value
        return ""
      }

      function normalizeQuarterCode(value) {
        const text = normalizeLower(value)
        if (text === "q1" || text === "q2" || text === "q3" || text === "q4") return text
        if (text === "1") return "q1"
        if (text === "2") return "q2"
        if (text === "3") return "q3"
        if (text === "4") return "q4"
        return ""
      }

      function quarterSortKey(value) {
        const quarter = normalizeQuarterCode(value)
        if (quarter === "q1") return 1
        if (quarter === "q2") return 2
        if (quarter === "q3") return 3
        if (quarter === "q4") return 4
        return 9
      }

      function parseSchoolYearRange(value = "") {
        const match = normalizeText(value).match(/^(\d{4})-(\d{4})$/)
        if (!match) return null
        const startYear = Number.parseInt(match[1], 10)
        const endYear = Number.parseInt(match[2], 10)
        if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || endYear < startYear) return null
        return {
          startYear,
          endYear
        }
      }

      function schoolSetupQuarterForIsoDate(value = "") {
        const isoDate = normalizeText(value).slice(0, 10)
        if (!parseIsoDate(isoDate)) return ""
        const setup = state.schoolSetup && typeof state.schoolSetup === "object" ? state.schoolSetup : {}
        const quarters = Array.isArray(setup.quarters) ? setup.quarters : []
        for (let index = 0; index < quarters.length; index += 1) {
          const entry = quarters[index]
          const startDate = normalizeText(entry?.startDate).slice(0, 10)
          const endDate = normalizeText(entry?.endDate).slice(0, 10)
          if (!parseIsoDate(startDate) || !parseIsoDate(endDate)) continue
          if (compareIsoDate(isoDate, startDate) >= 0 && compareIsoDate(isoDate, endDate) <= 0) {
            return normalizeQuarterCode(entry?.quarter)
          }
        }
        return ""
      }

      function quarterForSchoolYear(yearLabel = "", isoDate = TODAY_ISO) {
        const targetYear = normalizeText(yearLabel)
        const dateKey = normalizeText(isoDate).slice(0, 10)
        if (!parseIsoDate(dateKey)) return ""
        const setupYear = normalizeText(state.schoolSetup?.schoolYear)
        if (targetYear && setupYear && targetYear === setupYear) {
          const setupQuarter = normalizeQuarterCode(schoolSetupQuarterForIsoDate(dateKey))
          if (setupQuarter) return setupQuarter
        }
        return ""
      }

      function resolveSystemCurrentSchoolYear() {
        const params = new URLSearchParams(window.location.search || "")
        const explicit = normalizeText(params.get("currentSchoolYear") || params.get("schoolYear"))
        if (normalizeLower(explicit) === "current" || normalizeLower(explicit) === "all") {
          const localSettingsSchoolYear = schoolYearFromUiSettings(loadUiSettingsFromLocalStorage())
          return isSchoolYearKey(localSettingsSchoolYear) ? localSettingsSchoolYear : ""
        }
        if (isSchoolYearKey(explicit)) return explicit
        const localSettingsSchoolYear = schoolYearFromUiSettings(loadUiSettingsFromLocalStorage())
        if (isSchoolYearKey(localSettingsSchoolYear)) return localSettingsSchoolYear
        return ""
      }

      function refreshSystemCurrentSchoolYear(nextSchoolYear) {
        const normalizedNext = normalizeText(nextSchoolYear)
        if (!isSchoolYearKey(normalizedNext)) return
        const previousYear = normalizeText(SYSTEM_CURRENT_SCHOOL_YEAR)
        SYSTEM_CURRENT_SCHOOL_YEAR = normalizedNext
        const activeYear = normalizeSchoolYearFilter(state.filters.schoolYear)
        const shouldPromoteFilter =
          activeYear === "current" ||
          !isSchoolYearKey(activeYear) ||
          (isSchoolYearKey(previousYear) && activeYear === previousYear)
        if (shouldPromoteFilter) {
          state.filters.schoolYear = "current"
        }
        applyCurrentSchoolYearDefault()
      }

      function parseCorrectTotalFromComments(value) {
        const text = normalizeText(value)
        const match = text.match(/\(\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*correct\s*\)/i)
        if (!match) return {
          correctCount: null,
          totalQuestions: null
        }
        const correctCount = toNumber(match[1])
        const totalQuestions = toNumber(match[2])
        return {
          correctCount: Number.isFinite(correctCount) ? correctCount : null,
          totalQuestions: Number.isFinite(totalQuestions) ? totalQuestions : null,
        }
      }

      function toNumber(value) {
        const parsed = Number.parseFloat(String(value))
        return Number.isFinite(parsed) ? parsed : null
      }

      function toBoolLabel(value) {
        if (value === true) return "Yes"
        if (value === false) return "No"
        return ""
      }

      function percentValue(part, whole) {
        if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null
        return (part / whole) * 100
      }

      function formatPercent(value) {
        if (!Number.isFinite(value)) return "n/a"
        return `${Math.round(value)}%`
      }

      function formatScoreCell(cell) {
        const row = cell.getRow().getData()
        const score = Number.isFinite(row.score) ? row.score : null
        const maxScore = Number.isFinite(row.maxScore) && row.maxScore > 0 ? row.maxScore : null
        const percent = Number.isFinite(row.scorePercent) ? Math.max(0, Math.min(100, row.scorePercent)) : null
        const valueText = score === null ? "-" : maxScore === null ? `${score}` : `${score}/${maxScore}`
        if (percent === null) return `<span>${escapeHtml(valueText)}</span>`
        return (
          `<span class="score-chip">` +
          `<span>${escapeHtml(valueText)}</span>` +
          `<span class="score-bar"><span class="score-bar-fill" style="width:${Math.round(percent)}%"></span></span>` +
          `</span>`
        )
      }

      function escapeHtml(value) {
        return normalizeText(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;")
      }

      function stripHtmlToText(value) {
        const html = normalizeText(value)
        if (!html) return ""
        const holder = document.createElement("div")
        holder.innerHTML = html
        return normalizeText(holder.textContent || holder.innerText)
      }

      function collapseValueToText(value) {
        if (value instanceof HTMLElement) return normalizeText(value.textContent || value.innerText)
        const text = normalizeText(value)
        if (!text) return "-"
        if (/[<>&]/.test(text)) {
          const stripped = stripHtmlToText(text)
          if (stripped) return stripped
        }
        return text
      }

      function buildResponsiveCollapseContent(hiddenData) {
        const entries = Array.isArray(hiddenData) ? hiddenData : []
        if (!entries.length) return ""
        const wrapper = document.createElement("div")
        wrapper.className = "collapse-list"
        entries.forEach((entry) => {
          const titleText = collapseValueToText(entry?.title) || "Field"
          const valueText = collapseValueToText(entry?.value)
          const item = document.createElement("div")
          item.className = "collapse-item"
          item.innerHTML =
            `<span class=\"collapse-label\">${escapeHtml(titleText)}</span>` +
            `<span class=\"collapse-value\">${escapeHtml(valueText)}</span>`
          wrapper.appendChild(item)
        })
        return wrapper
      }

      function orderedDistributionLabels() {
        const labels = normalizeLetterGradeRanges(state.letterGradeRanges)
          .map((entry) => normalizeText(entry?.letter))
          .filter((label) => Boolean(label) && label !== "N/A")
        return labels
      }

      function normalizeDistributionLabel(value) {
        const upper = normalizeText(value).toUpperCase()
        if (!upper) return ""
        if (upper === "NA" || upper === "N-A" || upper === "N/A") return ""
        return upper
      }

      function normalizeDistributionEntries(source = []) {
        const rows = Array.isArray(source) ? source : []
        const ordered = orderedDistributionLabels()
        const rank = new Map(ordered.map((label, index) => [label, index]))
        const normalized = rows
          .map((entry) => {
            let label = ""
            let rawCount = null
            if (Array.isArray(entry)) {
              label = normalizeDistributionLabel(entry[0])
              rawCount = toNumber(entry[1])
            } else if (entry && typeof entry === "object") {
              label = normalizeDistributionLabel(entry.label || entry.letter)
              rawCount = toNumber(entry.count)
            }
            if (!label || !Number.isFinite(rawCount)) return null
            return {
              label,
              count: Math.max(0, Math.round(rawCount)),
            }
          })
          .filter((entry) => entry && typeof entry === "object")
        normalized.sort((left, right) => {
          const leftRank = rank.has(left.label) ? rank.get(left.label) : 999
          const rightRank = rank.has(right.label) ? rank.get(right.label) : 999
          if (leftRank !== rightRank) return leftRank - rightRank
          return left.label.localeCompare(right.label)
        })
        return normalized
      }

      function parseDistributionEntriesFromText(value) {
        const text = normalizeText(value)
        if (!text) return []
        const parsed = []
        const regex = /([A-Z][A-Z0-9+\-/]*)\s*:\s*(\d+(?:\.\d+)?)/gi
        let match = regex.exec(text)
        while (match) {
          parsed.push({
            label: normalizeDistributionLabel(match[1]),
            count: toNumber(match[2]),
          })
          match = regex.exec(text)
        }
        return normalizeDistributionEntries(parsed)
      }

      function normalizeDistributionPayload(value, meta = {}) {
        const input = value && typeof value === "object" && !Array.isArray(value) ? value : {}
        const metaInput = meta && typeof meta === "object" ? meta : {}
        const fallbackSummary = normalizeText(value)
        const summaryText = normalizeText(input.summaryText) || fallbackSummary
        let entries = normalizeDistributionEntries(input.entries)
        if (!entries.length && summaryText) {
          entries = parseDistributionEntriesFromText(summaryText)
        }
        if (!entries.length) return null
        const totalFromPayload = toNumber(input.totalCount)
        const totalCount = Number.isFinite(totalFromPayload) ?
          Math.max(0, Math.round(totalFromPayload)) :
          entries.reduce((sum, entry) => sum + entry.count, 0)
        const assignmentTitle = normalizeText(input.assignmentTitle) || normalizeAssignmentHeaderTitle(metaInput.title)
        const dueLabel = normalizeText(input.dueLabel) || normalizeText(metaInput.dueAt) || "-"
        const questionTotalRaw = toNumber(input.questionTotal ?? metaInput.totalQuestions)
        const questionTotal = Number.isFinite(questionTotalRaw) ? questionTotalRaw : null
        const normalizedSummaryText = summaryText || entries.map((entry) => `${entry.label}:${entry.count}`).join(" ")
        return {
          entries,
          summaryText: normalizedSummaryText || "-",
          totalCount: Math.max(0, totalCount),
          assignmentTitle: assignmentTitle || "Exercise",
          dueLabel,
          questionTotal,
        }
      }

      function buildDistributionPointSeries(entries = [], options = {}) {
        const width = Math.max(120, Number(options.width) || 120)
        const height = Math.max(42, Number(options.height) || 42)
        const marginLeft = Math.max(0, Number(options.marginLeft) || 0)
        const marginRight = Math.max(0, Number(options.marginRight) || 0)
        const marginTop = Math.max(0, Number(options.marginTop) || 0)
        const marginBottom = Math.max(0, Number(options.marginBottom) || 0)
        const safeEntries = normalizeDistributionEntries(entries)
        if (!safeEntries.length) {
          return {
            points: [],
            maxCount: 1,
            width,
            height,
            marginLeft,
            marginRight,
            marginTop,
            marginBottom,
            plotWidth: Math.max(4, width - marginLeft - marginRight),
            plotHeight: Math.max(4, height - marginTop - marginBottom),
          }
        }
        const maxCount = Math.max(1, ...safeEntries.map((entry) => entry.count))
        const plotWidth = Math.max(4, width - marginLeft - marginRight)
        const plotHeight = Math.max(4, height - marginTop - marginBottom)
        const lastIndex = Math.max(1, safeEntries.length - 1)
        const points = safeEntries.map((entry, index) => {
          const x = safeEntries.length === 1 ?
            marginLeft + (plotWidth / 2) :
            marginLeft + ((plotWidth * index) / lastIndex)
          const y = marginTop + plotHeight - ((entry.count / maxCount) * plotHeight)
          return {
            index,
            label: entry.label,
            count: entry.count,
            x,
            y,
          }
        })
        return {
          points,
          maxCount,
          width,
          height,
          marginLeft,
          marginRight,
          marginTop,
          marginBottom,
          plotWidth,
          plotHeight,
        }
      }

      function buildDistributionSparklineSvg(entries = []) {
        const width = 158
        const height = 34
        const series = buildDistributionPointSeries(entries, {
          width,
          height,
          marginLeft: 4,
          marginRight: 4,
          marginTop: 3,
          marginBottom: 3,
        })
        if (!series.points.length) {
          return `<svg viewBox=\"0 0 ${width} ${height}\" preserveAspectRatio=\"none\"></svg>`
        }
        const baselineY = Math.round((height - series.marginBottom) * 100) / 100
        const pointsText = series.points
          .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
          .join(" ")
        const circles = series.points
          .map((point) => (
            `<circle class=\"distribution-mini-trendpoint\" cx=\"${point.x.toFixed(2)}\" cy=\"${point.y.toFixed(2)}\" r=\"1.65\"></circle>`
          ))
          .join("")
        return (
          `<svg viewBox=\"0 0 ${width} ${height}\" preserveAspectRatio=\"none\" aria-hidden=\"true\">` +
          `<line class=\"distribution-mini-trendline-baseline\" x1=\"2\" y1=\"${baselineY}\" x2=\"${width - 2}\" y2=\"${baselineY}\" stroke-width=\"1\"></line>` +
          `<polyline class=\"distribution-mini-trendline\" points=\"${pointsText}\" stroke-width=\"1.7\"></polyline>` +
          `${circles}` +
          `</svg>`
        )
      }

      function distributionModalElements() {
        return {
          modal: document.getElementById("distributionModal"),
          dialog: document.getElementById("distributionDialog"),
          closeButton: document.getElementById("distributionModalClose"),
          expandButton: document.getElementById("distributionModalExpand"),
          title: document.getElementById("distributionModalTitle"),
          meta: document.getElementById("distributionModalMeta"),
          chartShell: document.getElementById("distributionChartShell"),
          chartScroll: document.getElementById("distributionChartScroll"),
          chart: document.getElementById("distributionModalChart"),
          hover: document.getElementById("distributionModalHover"),
          zoomOut: document.getElementById("distributionZoomOut"),
          zoomIn: document.getElementById("distributionZoomIn"),
          zoomReset: document.getElementById("distributionZoomReset"),
          zoomRange: document.getElementById("distributionZoomRange"),
          zoomLabel: document.getElementById("distributionZoomLabel"),
        }
      }

      function clampDistributionZoom(value) {
        const raw = Number(value)
        if (!Number.isFinite(raw)) return state.distributionModalZoom
        const clamped = Math.min(DISTRIBUTION_ZOOM_MAX, Math.max(DISTRIBUTION_ZOOM_MIN, raw))
        return Math.round(clamped / DISTRIBUTION_ZOOM_STEP) * DISTRIBUTION_ZOOM_STEP
      }

      function setDistributionDialogFullscreen(nextValue) {
        const elements = distributionModalElements()
        const next = Boolean(nextValue)
        state.distributionModalFullscreen = next
        if (elements.dialog) {
          elements.dialog.classList.toggle("is-fullscreen", next)
        }
        if (elements.expandButton) {
          elements.expandButton.textContent = next ? "Windowed" : "Full screen"
          elements.expandButton.setAttribute(
            "aria-label",
            next ? "Switch distribution chart modal to windowed mode" : "Switch distribution chart modal to full screen mode"
          )
        }
      }

      function updateDistributionZoomUi() {
        const elements = distributionModalElements()
        if (elements.zoomRange) {
          elements.zoomRange.value = String(state.distributionModalZoom.toFixed(1))
        }
        if (elements.zoomLabel) {
          elements.zoomLabel.textContent = `${Math.round(state.distributionModalZoom * 100)}%`
        }
      }

      function applyDistributionChartZoom(nextZoom, options = {}) {
        const zoom = clampDistributionZoom(nextZoom)
        state.distributionModalZoom = zoom
        const config = options && typeof options === "object" ? options : {}
        const elements = distributionModalElements()
        if (elements.chart) {
          const baseWidth = Math.max(760, Number(state.distributionModalBaseWidth) || 760)
          const baseHeight = Math.max(360, Number(state.distributionModalBaseHeight) || 360)
          elements.chart.style.width = `${Math.round(baseWidth * zoom)}px`
          elements.chart.style.height = `${Math.round(baseHeight * zoom)}px`
        }
        updateDistributionZoomUi()
        if (config.refreshHover === true && state.distributionModalActiveIndex >= 0) {
          showDistributionHover(state.distributionModalActiveIndex)
        }
      }

      function hideDistributionHover() {
        const elements = distributionModalElements()
        if (elements.hover) {
          elements.hover.hidden = true
          elements.hover.textContent = ""
        }
        if (elements.chart) {
          elements.chart.querySelectorAll(".dist-point.is-active").forEach((point) => {
            point.classList.remove("is-active")
          })
        }
        state.distributionModalActiveIndex = -1
      }

      function showDistributionHover(index) {
        const pointIndex = Number.parseInt(String(index), 10)
        const payload = state.distributionModalPayload
        const points = Array.isArray(state.distributionModalPoints) ? state.distributionModalPoints : []
        const point = Number.isFinite(pointIndex) ? points[pointIndex] : null
        if (!payload || !point) {
          hideDistributionHover()
          return
        }
        const elements = distributionModalElements()
        if (!elements.chartShell || !elements.chart || !elements.hover) return
        const total = Number.isFinite(payload.totalCount) && payload.totalCount > 0 ? payload.totalCount : 0
        const percent = total > 0 ? ((point.count / total) * 100) : 0
        elements.hover.textContent = `${point.label}: ${point.count} (${Math.round(percent)}%)`
        elements.hover.hidden = false
        elements.chart.querySelectorAll(".dist-point").forEach((node) => {
          node.classList.toggle("is-active", Number.parseInt(node.getAttribute("data-point-index"), 10) === pointIndex)
        })
        const viewBox = elements.chart.viewBox?.baseVal
        const chartRect = elements.chart.getBoundingClientRect()
        const shellRect = elements.chartShell.getBoundingClientRect()
        if (!viewBox || !viewBox.width || !viewBox.height || chartRect.width <= 0 || chartRect.height <= 0) return
        const rawLeft = ((point.x / viewBox.width) * chartRect.width) + (chartRect.left - shellRect.left)
        const rawTop = ((point.y / viewBox.height) * chartRect.height) + (chartRect.top - shellRect.top)
        const clampedLeft = Math.min(Math.max(rawLeft, 12), Math.max(12, shellRect.width - 12))
        const clampedTop = Math.min(Math.max(rawTop, 26), Math.max(26, shellRect.height - 10))
        elements.hover.style.left = `${Math.round(clampedLeft)}px`
        elements.hover.style.top = `${Math.round(clampedTop)}px`
        state.distributionModalActiveIndex = pointIndex
      }

      function bindDistributionHoverHandlers() {
        const elements = distributionModalElements()
        if (!elements.chart) return
        elements.chart.onpointerleave = () => {
          hideDistributionHover()
        }
        elements.chart.querySelectorAll(".dist-point").forEach((pointNode) => {
          const pointIndex = Number.parseInt(pointNode.getAttribute("data-point-index"), 10)
          if (!Number.isFinite(pointIndex)) return
          pointNode.addEventListener("pointerenter", () => {
            showDistributionHover(pointIndex)
          })
          pointNode.addEventListener("pointermove", () => {
            showDistributionHover(pointIndex)
          })
          pointNode.addEventListener("focus", () => {
            showDistributionHover(pointIndex)
          })
          pointNode.addEventListener("blur", () => {
            hideDistributionHover()
          })
        })
      }

      function renderDistributionModalChart(payload) {
        const elements = distributionModalElements()
        if (!elements.chart) return
        const normalized = normalizeDistributionPayload(payload)
        if (!normalized || !normalized.entries.length) {
          elements.chart.innerHTML = ""
          state.distributionModalPoints = []
          hideDistributionHover()
          return
        }
        const width = Math.max(980, (normalized.entries.length * 128) + 220)
        const height = 480
        const series = buildDistributionPointSeries(normalized.entries, {
          width,
          height,
          marginLeft: 64,
          marginRight: 30,
          marginTop: 26,
          marginBottom: 70,
        })
        const maxCount = Math.max(1, series.maxCount)
        const tickCount = 4
        const gridLines = []
        for (let tick = 0; tick <= tickCount; tick += 1) {
          const y = series.marginTop + ((series.plotHeight * tick) / tickCount)
          const value = Math.round(maxCount - ((maxCount * tick) / tickCount))
          gridLines.push(
            `<line class=\"dist-grid\" x1=\"${series.marginLeft}\" y1=\"${y.toFixed(2)}\" x2=\"${(width - series.marginRight).toFixed(2)}\" y2=\"${y.toFixed(2)}\"></line>` +
            `<text class=\"dist-y-label\" x=\"${(series.marginLeft - 8).toFixed(2)}\" y=\"${(y + 4).toFixed(2)}\">${escapeHtml(formatShortNumber(value))}</text>`
          )
        }
        const linePoints = series.points
          .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
          .join(" ")
        const plotBottom = height - series.marginBottom
        const areaPath = series.points.length ?
          (
            `M ${series.points[0].x.toFixed(2)} ${plotBottom.toFixed(2)}` +
            ` L ${series.points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" L ")}` +
            ` L ${series.points[series.points.length - 1].x.toFixed(2)} ${plotBottom.toFixed(2)} Z`
          ) :
          ""
        const xLabels = series.points
          .map((point) => (
            `<text class=\"dist-label\" x=\"${point.x.toFixed(2)}\" y=\"${(height - 22).toFixed(2)}\">${escapeHtml(point.label)}</text>`
          ))
          .join("")
        const circles = series.points
          .map((point) => (
            `<circle class=\"dist-point\" data-point-index=\"${point.index}\" cx=\"${point.x.toFixed(2)}\" cy=\"${point.y.toFixed(2)}\" r=\"6\" tabindex=\"0\" aria-label=\"${escapeHtml(point.label)} ${escapeHtml(String(point.count))}\"></circle>`
          ))
          .join("")
        elements.chart.setAttribute("viewBox", `0 0 ${width} ${height}`)
        elements.chart.innerHTML =
          `<g>${gridLines.join("")}</g>` +
          `<line class=\"dist-axis distribution-mini-trendline-baseline\" x1=\"${series.marginLeft}\" y1=\"${plotBottom.toFixed(2)}\" x2=\"${(width - series.marginRight).toFixed(2)}\" y2=\"${plotBottom.toFixed(2)}\"></line>` +
          `<line class=\"dist-axis\" x1=\"${series.marginLeft}\" y1=\"${series.marginTop}\" x2=\"${series.marginLeft}\" y2=\"${plotBottom.toFixed(2)}\"></line>` +
          `<path class=\"dist-area\" d=\"${areaPath}\"></path>` +
          `<polyline class=\"dist-line distribution-mini-trendline\" points=\"${linePoints}\"></polyline>` +
          `${circles}` +
          `${xLabels}`
        state.distributionModalBaseWidth = width
        state.distributionModalBaseHeight = height
        state.distributionModalPoints = series.points
        state.distributionModalActiveIndex = -1
        bindDistributionHoverHandlers()
        applyDistributionChartZoom(state.distributionModalZoom, {
          refreshHover: false
        })
        if (elements.chartScroll) {
          elements.chartScroll.scrollLeft = 0
          elements.chartScroll.scrollTop = 0
        }
      }

      function closeDistributionModal() {
        const elements = distributionModalElements()
        if (!elements.modal) return
        elements.modal.hidden = true
        hideDistributionHover()
        state.distributionModalPayload = null
        state.distributionModalPoints = []
        state.distributionModalZoom = DISTRIBUTION_ZOOM_MIN
        updateDistributionZoomUi()
        document.body.classList.remove("distribution-modal-open")
      }

      function openDistributionModal(payload) {
        const normalized = normalizeDistributionPayload(payload)
        if (!normalized) return
        const elements = distributionModalElements()
        if (!elements.modal) return
        state.distributionModalZoom = DISTRIBUTION_ZOOM_MIN
        setDistributionDialogFullscreen(false)
        updateDistributionZoomUi()
        state.distributionModalPayload = normalized
        if (elements.title) {
          elements.title.textContent = `${normalized.assignmentTitle} Distribution`
        }
        if (elements.meta) {
          const questionText = Number.isFinite(normalized.questionTotal) ?
            ` | Q ${formatShortNumber(normalized.questionTotal)}` :
            ""
          elements.meta.textContent =
            `${normalized.assignmentTitle} | Due ${normalized.dueLabel} | Total ${formatShortNumber(normalized.totalCount)}${questionText}`
        }
        renderDistributionModalChart(normalized)
        elements.modal.hidden = false
        document.body.classList.add("distribution-modal-open")
        if (elements.closeButton) {
          elements.closeButton.focus()
        }
      }

      function tableModalElements() {
        return {
          card: document.getElementById("gradeGridCard"),
          backdrop: document.getElementById("tableModalBackdrop"),
          toggleButton: document.getElementById("tableModalBtn"),
        }
      }

      function setTableModalOpen(nextValue) {
        const elements = tableModalElements()
        const next = Boolean(nextValue)
        state.tableModalOpen = next
        if (elements.card) {
          elements.card.classList.toggle("is-table-modal", next)
        }
        if (elements.backdrop) {
          elements.backdrop.hidden = !next
        }
        if (elements.toggleButton) {
          elements.toggleButton.textContent = next ? "Exit table modal" : "Open table modal"
          elements.toggleButton.setAttribute(
            "aria-label",
            next ? "Exit table modal view" : "Open table modal view"
          )
        }
        document.body.classList.toggle("table-modal-open", next)
        if (state.table && typeof state.table.redraw === "function") {
          window.setTimeout(() => {
            state.table.redraw(true)
          }, 0)
        }
      }

      function bindTableModalControls() {
        const elements = tableModalElements()
        if (!elements.toggleButton || elements.toggleButton.dataset.bound === "true") return
        elements.toggleButton.dataset.bound = "true"
        elements.toggleButton.addEventListener("click", () => {
          setTableModalOpen(!state.tableModalOpen)
        })
        if (elements.backdrop) {
          elements.backdrop.addEventListener("click", () => {
            setTableModalOpen(false)
          })
        }
        document.addEventListener("keydown", (event) => {
          if (!state.tableModalOpen) return
          if (event.key === "Escape") {
            setTableModalOpen(false)
          }
        })
      }

      function bindDistributionModalControls() {
        const elements = distributionModalElements()
        if (!elements.modal || elements.modal.dataset.bound === "true") return
        elements.modal.dataset.bound = "true"
        if (elements.closeButton) {
          elements.closeButton.addEventListener("click", () => {
            closeDistributionModal()
          })
        }
        if (elements.expandButton) {
          elements.expandButton.addEventListener("click", () => {
            setDistributionDialogFullscreen(!state.distributionModalFullscreen)
          })
        }
        if (elements.zoomOut) {
          elements.zoomOut.addEventListener("click", () => {
            applyDistributionChartZoom(state.distributionModalZoom - DISTRIBUTION_ZOOM_STEP, {
              refreshHover: true
            })
          })
        }
        if (elements.zoomIn) {
          elements.zoomIn.addEventListener("click", () => {
            applyDistributionChartZoom(state.distributionModalZoom + DISTRIBUTION_ZOOM_STEP, {
              refreshHover: true
            })
          })
        }
        if (elements.zoomReset) {
          elements.zoomReset.addEventListener("click", () => {
            applyDistributionChartZoom(DISTRIBUTION_ZOOM_MIN, {
              refreshHover: true
            })
          })
        }
        if (elements.zoomRange) {
          elements.zoomRange.addEventListener("input", () => {
            applyDistributionChartZoom(elements.zoomRange?.value, {
              refreshHover: true
            })
          })
        }
        if (elements.chartScroll) {
          elements.chartScroll.addEventListener("scroll", () => {
            hideDistributionHover()
          })
          elements.chartScroll.addEventListener(
            "wheel",
            (event) => {
              if (elements.modal?.hidden) return
              event.preventDefault()
              const delta = event.deltaY < 0 ? DISTRIBUTION_ZOOM_STEP : -DISTRIBUTION_ZOOM_STEP
              applyDistributionChartZoom(state.distributionModalZoom + delta, {
                refreshHover: true
              })
            }, {
              passive: false
            }
          )
        }
        elements.modal.addEventListener("click", (event) => {
          const target = event.target
          if (!(target instanceof HTMLElement)) return
          if (target.getAttribute("data-close-distribution-modal") === "true") {
            closeDistributionModal()
          }
        })
        document.addEventListener("keydown", (event) => {
          if (elements.modal.hidden) return
          if (event.key === "Escape") {
            closeDistributionModal()
            return
          }
          if (event.key === "+" || event.key === "=") {
            event.preventDefault()
            applyDistributionChartZoom(state.distributionModalZoom + DISTRIBUTION_ZOOM_STEP, {
              refreshHover: true
            })
            return
          }
          if (event.key === "-" || event.key === "_") {
            event.preventDefault()
            applyDistributionChartZoom(state.distributionModalZoom - DISTRIBUTION_ZOOM_STEP, {
              refreshHover: true
            })
            return
          }
          if (event.key === "0") {
            event.preventDefault()
            applyDistributionChartZoom(DISTRIBUTION_ZOOM_MIN, {
              refreshHover: true
            })
          }
        })
      }

      function renderDistributionMiniCell(value, meta = {}) {
        const payload = normalizeDistributionPayload(value, meta)
        if (!payload) {
          const fallback = document.createElement("span")
          fallback.className = "stat-chip"
          fallback.textContent = normalizeText(value) || "n/a"
          return fallback
        }
        const button = document.createElement("button")
        button.type = "button"
        button.className = "distribution-mini-button portal-button portal-button-immutable-chrome"
        button.title = `${payload.summaryText} | Click for detail chart`
        button.setAttribute("aria-label", `Open distribution chart for ${payload.assignmentTitle}`)
        button.innerHTML =
          `<span class=\"distribution-mini-chart\" aria-hidden=\"true\">${buildDistributionSparklineSvg(payload.entries)}</span>` +
          `<span class=\"distribution-mini-meta\">View chart</span>`
        button.addEventListener("click", () => {
          openDistributionModal(payload)
        })
        return button
      }

      function syncCompactModeUi() {
        document.body.classList.toggle("is-compact", Boolean(state.compactMode))
        const button = document.getElementById("toggleCompactBtn")
        if (button) {
          button.textContent = state.compactMode ? "Dense rows: On" : "Dense rows: Off"
        }
      }

      function setCompactMode(nextValue) {
        state.compactMode = Boolean(nextValue)
        syncCompactModeUi()
        persistUiPreferences()
        if (state.table && typeof state.table.redraw === "function") {
          state.table.redraw(true)
        }
      }

      function toggleCompactMode() {
        setCompactMode(!state.compactMode)
      }

      function revealAllAssignmentColumns() {
        if (!state.table || typeof state.table.getColumns !== "function") return
        state.table.getColumns().forEach((column) => {
          const field = normalizeText(column?.getField?.())
          if (!field || !field.includes("|")) return
          if (typeof column?.show === "function") column.show()
        })
      }

      function debounce(fn, delay = 160) {
        let timer = null
        return (...args) => {
          if (timer !== null) window.clearTimeout(timer)
          timer = window.setTimeout(() => {
            timer = null
            fn(...args)
          }, Math.max(0, Number(delay) || 0))
        }
      }
      const persistTableUiStateSoon = debounce(() => {
        persistTableUiStateFromTable()
      }, 140)
      const persistTableHeightSoon = debounce(() => {
        if (!Number.isFinite(state.tableHeightPx)) return
        writeTableUiState({
          tableHeight: state.tableHeightPx
        })
      }, 140)

      function applyTableHeight(nextHeight, options = {}) {
        const config = options && typeof options === "object" ? options : {}
        const normalizedHeight = normalizeTableHeightPx(nextHeight, state.tableHeightPx || defaultTableHeightPx())
        if (!Number.isFinite(normalizedHeight)) return null
        state.tableHeightPx = normalizedHeight
        const host = tableHostElement()
        if (host && normalizeText(host.style.height) !== `${normalizedHeight}px`) {
          host.style.height = `${normalizedHeight}px`
        }
        if (config.redraw !== false && state.tableBuilt && state.table && typeof state.table.redraw === "function") {
          state.table.redraw(true)
        }
        if (config.persist !== false) {
          persistTableHeightSoon()
        }
        return normalizedHeight
      }

      function disconnectTableHeightResizeObserver() {
        if (state.tableResizeObserver && typeof state.tableResizeObserver.disconnect === "function") {
          state.tableResizeObserver.disconnect()
        }
        state.tableResizeObserver = null
      }

      function observeTableHeightResize() {
        disconnectTableHeightResizeObserver()
        if (typeof window.ResizeObserver !== "function") return
        const host = tableHostElement()
        if (!host) return
        state.tableResizeObserver = new window.ResizeObserver((entries) => {
          const firstEntry = Array.isArray(entries) && entries.length ? entries[0] : null
          const entryTarget = firstEntry?.target
          const rawHeight = entryTarget instanceof HTMLElement ?
            entryTarget.getBoundingClientRect().height :
            firstEntry?.contentRect?.height
          const normalizedHeight = normalizeTableHeightPx(rawHeight)
          if (!Number.isFinite(normalizedHeight)) return
          if (Math.abs(normalizedHeight - state.tableHeightPx) <= 1) return
          applyTableHeight(normalizedHeight, {
            persist: true,
            redraw: true
          })
        })
        state.tableResizeObserver.observe(host)
      }

      function normalizePeriodCode(value) {
        const period = normalizeLower(value)
        if (["week", "quarter", "qtd", "sytd", "archive", "custom"].includes(period)) return period
        return "sytd"
      }

      function currentOperationalSchoolYear() {
        return normalizeText(
          SYSTEM_CURRENT_SCHOOL_YEAR ||
            state.schoolSetup?.schoolYear ||
            "",
        )
      }

      function normalizeSchoolYearFilter(value) {
        const normalized = normalizeText(value)
        const lowered = normalizeLower(normalized)
        if (lowered === "all" || lowered === "current") return "current"
        const currentYear = currentOperationalSchoolYear()
        if (normalized && normalized === currentYear) return "current"
        if (isSchoolYearKey(normalized)) return normalized
        return "current"
      }

      function normalizeOperationalSchoolYear(value) {
        const normalized = normalizeSchoolYearFilter(value)
        if (normalized === "current") return currentOperationalSchoolYear()
        if (isSchoolYearKey(normalized)) return normalized
        return currentOperationalSchoolYear()
      }

      function normalizedFiltersSnapshot(source = {}) {
        const input = source && typeof source === "object" ? source : {}
        return {
          period: normalizePeriodCode(input.period),
          schoolYear: normalizeSchoolYearFilter(input.schoolYear),
          quarter: normalizeQuarterCode(input.quarter) || "",
          classKey: normalizeText(input.classKey) || "all",
          studentKey: normalizeText(input.studentKey) || "all",
          schoolKey: normalizeText(input.schoolKey) || "all",
          customFrom: normalizeText(input.customFrom).slice(0, 10),
          customTo: normalizeText(input.customTo).slice(0, 10),
          search: normalizeText(input.search),
        }
      }

      function persistUiPreferences() {
        try {
          const payload = {
            compactMode: Boolean(state.compactMode),
            filters: normalizedFiltersSnapshot(state.filters),
          }
          window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(payload))
          window.localStorage.removeItem(LEGACY_UI_PREFS_KEY)
        } catch (error) {
          void error
        }
      }

      function restoreUiPreferences() {
        try {
          const raw =
            window.localStorage.getItem(UI_PREFS_KEY) ||
            window.localStorage.getItem(LEGACY_UI_PREFS_KEY)
          if (!raw) return
          const parsed = JSON.parse(raw)
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
          if (!window.localStorage.getItem(UI_PREFS_KEY)) {
            window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(parsed))
          }
          state.compactMode = Boolean(parsed.compactMode)
          state.filters = {
            ...state.filters,
            ...normalizedFiltersSnapshot(parsed.filters),
          }
        } catch (error) {
          void error
        }
      }

      function filterQueryOverridesFromLocation() {
        const params = new URLSearchParams(window.location.search || "")
        const overrides = {}
        const hasQuarterParam = params.has("quarter")
        if (params.has("period")) {
          overrides.period = normalizePeriodCode(params.get("period"))
        }
        if (params.has("schoolYear")) {
          overrides.schoolYear = normalizeSchoolYearFilter(params.get("schoolYear"))
        }
        if (hasQuarterParam) {
          const quarter = normalizeQuarterCode(params.get("quarter"))
          overrides.quarter = quarter
        }
        if (params.has("classKey")) {
          overrides.classKey = normalizeText(params.get("classKey")) || "all"
        }
        if (params.has("studentKey")) {
          overrides.studentKey = normalizeText(params.get("studentKey")) || "all"
        }
        if (params.has("schoolKey")) {
          overrides.schoolKey = normalizeText(params.get("schoolKey")) || "all"
        }
        if (params.has("customFrom")) {
          overrides.customFrom = normalizeText(params.get("customFrom")).slice(0, 10)
        }
        if (params.has("customTo")) {
          overrides.customTo = normalizeText(params.get("customTo")).slice(0, 10)
        }
        if (params.has("search")) {
          overrides.search = normalizeText(params.get("search"))
        }
        const requestedSchoolYearCurrent =
          params.has("schoolYear") &&
          normalizeSchoolYearFilter(params.get("schoolYear")) === "current"
        const requestedPeriod = normalizePeriodCode(overrides.period || state.filters.period)
        if (
          requestedSchoolYearCurrent &&
          (requestedPeriod === "quarter" || requestedPeriod === "qtd") &&
          !hasQuarterParam
        ) {
          overrides.quarter = quarterForSchoolYear(SYSTEM_CURRENT_SCHOOL_YEAR, TODAY_ISO)
        }
        return overrides
      }

      function applyFilterQueryOverrides() {
        const overrides = filterQueryOverridesFromLocation()
        if (!Object.keys(overrides).length) return
        state.filters = normalizedFiltersSnapshot({
          ...state.filters,
          ...overrides,
        })
      }

      function applyCurrentSchoolYearDefault(options = {}) {
        const config = options && typeof options === "object" ? options : {}
        const force = config.force === true
        const currentYear = currentOperationalSchoolYear()
        if (!isSchoolYearKey(currentYear)) return
        const activeYear = normalizeSchoolYearFilter(state.filters.schoolYear)
        const activePeriod = normalizePeriodCode(state.filters.period)
        if (activePeriod === "archive") {
          if (force || activeYear === "current" || !isSchoolYearKey(activeYear)) {
            state.filters.schoolYear = "current"
          }
        } else if (force || activeYear === "current" || !isSchoolYearKey(activeYear)) {
          state.filters.schoolYear = "current"
        }
        const schoolYearSelect = document.getElementById("schoolYear")
        if (!(schoolYearSelect instanceof HTMLSelectElement)) return
        const currentOption = Array.from(schoolYearSelect.options || [])
          .find((option) => ["current", currentYear].includes(normalizeText(option?.value)))
        if (currentOption) {
          currentOption.value = currentYear
          currentOption.textContent = currentYear
        } else {
          const option = document.createElement("option")
          option.value = currentYear
          option.textContent = currentYear
          schoolYearSelect.appendChild(option)
        }
        const selectedYear = normalizeSchoolYearFilter(state.filters.schoolYear)
        schoolYearSelect.value = isSchoolYearKey(selectedYear) ? selectedYear : currentYear
      }

      function currentQuarterForFilters() {
        return (
          normalizeQuarterCode(
            quarterForSchoolYear(normalizeOperationalSchoolYear(state.filters.schoolYear), TODAY_ISO),
          ) ||
          normalizeQuarterCode(quarterFromIsoDate(TODAY_ISO)) ||
          ""
        )
      }

      function applyCurrentQuarterDefault(options = {}) {
        const config = options && typeof options === "object" ? options : {}
        const force = config.force === true
        const currentQuarter = currentQuarterForFilters()
        if (!currentQuarter) return
        const activeQuarter = normalizeQuarterCode(state.filters.quarter)
        if (force || !activeQuarter) {
          state.filters.quarter = currentQuarter
        }
        const quarterSelect = document.getElementById("quarter")
        if (quarterSelect instanceof HTMLSelectElement) {
          quarterSelect.value = normalizeQuarterCode(state.filters.quarter) || currentQuarter
        }
      }

      function normalizeSortDirection(value) {
        const text = normalizeLower(value)
        return text === "desc" ? "desc" : "asc"
      }

      function normalizeTableSortersSnapshot(source = []) {
        return (Array.isArray(source) ? source : [])
          .map((entry) => {
            const columnCandidate = entry?.column
            let column = ""
            if (typeof columnCandidate === "string") {
              column = normalizeText(columnCandidate)
            } else if (columnCandidate && typeof columnCandidate?.getField === "function") {
              column = normalizeText(columnCandidate.getField())
            } else if (columnCandidate && typeof columnCandidate === "object") {
              column = normalizeText(columnCandidate.field)
            }
            if (!column) column = normalizeText(entry?.field)
            if (!column) return null
            return {
              column,
              dir: normalizeSortDirection(entry?.dir),
            }
          })
          .filter((entry) => entry && typeof entry === "object")
      }

      function normalizeTableColumnLayoutSnapshot(source = [], options = {}) {
        const config = options && typeof options === "object" ? options : {}
        const includeWidth = config.includeWidth !== false
        return (Array.isArray(source) ? source : [])
          .map((entry) => {
            if (!entry || typeof entry !== "object") return null
            const field = normalizeText(entry.field)
            if (!field) return null
            const width = Number(entry.width)
            const normalized = {
              field
            }
            if (includeWidth && Number.isFinite(width) && width >= 30) normalized.width = Math.round(width)
            if (typeof entry.visible === "boolean") normalized.visible = entry.visible
            if (typeof entry.frozen === "boolean") normalized.frozen = entry.frozen
            return normalized
          })
          .filter((entry) => entry && typeof entry === "object")
      }

      function readTableUiState() {
        try {
          const rawCurrent = window.localStorage.getItem(TABLE_UI_STATE_KEY)
          const rawLegacy = window.localStorage.getItem(LEGACY_TABLE_UI_STATE_KEY)
          const raw = rawCurrent || rawLegacy
          if (!raw) return null
          const parsed = JSON.parse(raw)
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
          const sourceIsLegacy = !rawCurrent && Boolean(rawLegacy)
          const storedSchemaVersion = Number(parsed.schemaVersion) || 0
          const shouldResetPersistedWidths =
            sourceIsLegacy ||
            storedSchemaVersion < TABLE_UI_STATE_SCHEMA_VERSION
          const columnLayout = normalizeTableColumnLayoutSnapshot(parsed.columnLayout, {
            includeWidth: !shouldResetPersistedWidths,
          })
          const sorters = normalizeTableSortersSnapshot(parsed.sorters)
          const tableHeight = normalizeTableHeightPx(parsed.tableHeight)
          if (sourceIsLegacy || storedSchemaVersion !== TABLE_UI_STATE_SCHEMA_VERSION) {
            const migratedPayload = {
              schemaVersion: TABLE_UI_STATE_SCHEMA_VERSION,
              columnLayout,
              sorters,
            }
            if (Number.isFinite(tableHeight)) {
              migratedPayload.tableHeight = tableHeight
            }
            window.localStorage.setItem(TABLE_UI_STATE_KEY, JSON.stringify(migratedPayload))
            window.localStorage.removeItem(LEGACY_TABLE_UI_STATE_KEY)
          }
          return {
            columnLayout,
            sorters,
            tableHeight,
          }
        } catch (error) {
          void error
          return null
        }
      }

      function writeTableUiState(payload = {}) {
        const input = payload && typeof payload === "object" ? payload : {}
        const existing = readTableUiState() || {
          columnLayout: [],
          sorters: [],
          tableHeight: null
        }
        const nextColumnLayout = Array.isArray(input.columnLayout) ?
          normalizeTableColumnLayoutSnapshot(input.columnLayout) :
          existing.columnLayout
        const nextSorters = Array.isArray(input.sorters) ?
          normalizeTableSortersSnapshot(input.sorters) :
          existing.sorters
        const nextTableHeight = normalizeTableHeightPx(input.tableHeight, existing.tableHeight)
        const nextPayload = {
          schemaVersion: TABLE_UI_STATE_SCHEMA_VERSION,
          columnLayout: nextColumnLayout,
          sorters: nextSorters,
        }
        if (Number.isFinite(nextTableHeight)) {
          nextPayload.tableHeight = nextTableHeight
        }
        try {
          window.localStorage.setItem(
            TABLE_UI_STATE_KEY,
            JSON.stringify(nextPayload)
          )
          window.localStorage.removeItem(LEGACY_TABLE_UI_STATE_KEY)
        } catch (error) {
          void error
        }
      }

      function tableColumnFieldSet() {
        if (!state.table || typeof state.table.getColumns !== "function") return new Set()
        const fields = state.table.getColumns()
          .map((column) => normalizeText(column?.getField?.()))
          .filter(Boolean)
        return new Set(fields)
      }

      function waitForExpectedColumnCount(expectedCount, timeoutMs = 700) {
        const expected = Math.max(0, Number.parseInt(String(expectedCount || 0), 10) || 0)
        const timeout = Math.max(80, Number.parseInt(String(timeoutMs || 0), 10) || 0)
        if (!state.table || expected <= 0 || typeof state.table.getColumns !== "function") {
          return Promise.resolve(false)
        }
        const startedAt = Date.now()
        return new Promise((resolve) => {
          const check = () => {
            const columns = state.table && typeof state.table.getColumns === "function" ?
              state.table.getColumns() :
              []
            const currentCount = Array.isArray(columns) ? columns.length : 0
            if (currentCount >= expected) {
              resolve(true)
              return
            }
            if (Date.now() - startedAt >= timeout) {
              resolve(false)
              return
            }
            window.setTimeout(check, 16)
          }
          check()
        })
      }

      function ensureAssignmentColumnsPresent(columns = [], expectedAssignmentCount = 0) {
        const expected = Math.max(0, Number.parseInt(String(expectedAssignmentCount || 0), 10) || 0)
        if (!state.table || expected <= 0 || typeof state.table.getColumns !== "function") return
        const currentAssignmentCount = state.table.getColumns()
          .map((column) => normalizeText(column?.getField?.()))
          .filter((field) => field.includes("|"))
          .length
        if (currentAssignmentCount > 0) return
        try {
          state.table.setColumns(Array.isArray(columns) ? columns : [])
        } catch (error) {
          void error
        }
      }

      function persistTableUiStateFromTable() {
        if (!state.table) return
        const snapshot = {}
        const host = tableHostElement()
        const measuredHeight = host ? host.getBoundingClientRect().height : state.tableHeightPx
        const normalizedHeight = normalizeTableHeightPx(measuredHeight, state.tableHeightPx)
        if (Number.isFinite(normalizedHeight)) {
          snapshot.tableHeight = normalizedHeight
        }
        if (typeof state.table.getColumnLayout === "function") {
          const layout = normalizeTableColumnLayoutSnapshot(state.table.getColumnLayout())
          const hasAssignmentColumns = layout.some((entry) => normalizeText(entry?.field).includes("|"))
          if (Array.isArray(state.allRows) && state.allRows.length > 0 && hasAssignmentColumns) {
            snapshot.columnLayout = layout
          }
        }
        if (typeof state.table.getSorters === "function") {
          snapshot.sorters = normalizeTableSortersSnapshot(state.table.getSorters())
        }
        writeTableUiState(snapshot)
      }

      function applyStoredTableUiState(options = {}) {
        const config = options && typeof options === "object" ? options : {}
        const applyLayout = config.applyLayout !== false
        const applySort = config.applySort !== false
        const requiredAssignmentColumns = Math.max(
          0,
          Number.parseInt(String(config.requiredAssignmentColumns || 0), 10) || 0
        )
        const stored = readTableUiState()
        if (!stored || !state.table) return {
          layoutApplied: false,
          sortApplied: false
        }
        let layoutApplied = false
        let sortApplied = false
        if (applyLayout && stored.columnLayout.length && typeof state.table.setColumnLayout === "function") {
          const availableFields = tableColumnFieldSet()
          const filteredLayout = stored.columnLayout
            .filter((entry) => availableFields.has(normalizeText(entry?.field)))
          const currentAssignmentCount = Array.from(availableFields.values())
            .filter((field) => field.includes("|"))
            .length
          const layoutAssignmentCount = filteredLayout
            .filter((entry) => normalizeText(entry?.field).includes("|"))
            .length
          const visibleLayoutAssignmentCount = filteredLayout
            .filter((entry) => normalizeText(entry?.field).includes("|") && entry.visible !== false)
            .length
          const layoutHasExpectedAssignments = requiredAssignmentColumns <= 0 || layoutAssignmentCount > 0
          const layoutKeepsAssignmentsVisible = requiredAssignmentColumns <= 0 || visibleLayoutAssignmentCount > 0
          try {
            if (
              filteredLayout.length &&
              layoutHasExpectedAssignments &&
              layoutKeepsAssignmentsVisible &&
              (!currentAssignmentCount || layoutAssignmentCount > 0)
            ) {
              state.table.setColumnLayout(filteredLayout)
              layoutApplied = true
            }
          } catch (error) {
            void error
          }
        }
        if (applySort && stored.sorters.length && typeof state.table.setSort === "function") {
          const availableFields = tableColumnFieldSet()
          const sortable = stored.sorters
            .filter((entry) => availableFields.has(normalizeText(entry?.column)))
          try {
            if (sortable.length) {
              state.table.setSort(sortable)
              sortApplied = true
            }
          } catch (error) {
            void error
          }
        }
        return {
          layoutApplied,
          sortApplied
        }
      }

      function clearStoredTableUiState() {
        const preservedHeight = normalizeTableHeightPx(state.tableHeightPx)
        try {
          window.localStorage.removeItem(TABLE_UI_STATE_KEY)
          window.localStorage.removeItem(LEGACY_TABLE_UI_STATE_KEY)
          const persistencePrefixes = [
            `tabulator-${TABLE_PERSISTENCE_ID}-`,
            `tabulator-${LEGACY_TABLE_PERSISTENCE_ID}-`,
          ]
          const toRemove = []
          for (let index = 0; index < window.localStorage.length; index += 1) {
            const key = window.localStorage.key(index)
            if (!key) continue
            const matchesPrefix = persistencePrefixes.some((prefix) => key.startsWith(prefix))
            if (!matchesPrefix) continue
            toRemove.push(key)
          }
          toRemove.forEach((key) => {
            window.localStorage.removeItem(key)
          })
          if (Number.isFinite(preservedHeight)) {
            writeTableUiState({
              tableHeight: preservedHeight,
              columnLayout: [],
              sorters: []
            })
          }
        } catch (error) {
          void error
        }
      }

      function resolveApiOrigin() {
        const params = new URLSearchParams(window.location.search || "")
        const explicitOrigin = normalizeText(params.get("apiOrigin"))
        const fromLocation = window.location.protocol.startsWith("http") ? window.location.origin : ""
        const raw = explicitOrigin || fromLocation
        if (!raw) return ""
        try {
          return new URL(raw, window.location.origin).origin
        } catch (error) {
          void error
          return ""
        }
      }

      function resolveApiUrl(path) {
        const normalizedPath = normalizeText(path)
        if (!normalizedPath) return ""
        if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath
        if (!API_ORIGIN) return normalizedPath
        return new URL(normalizedPath, API_ORIGIN).toString()
      }

      function buildAdminRuntimeHref(pathname = "/admin") {
        const url = new URL(normalizeText(pathname) || "/admin", window.location.origin)
        if (API_ORIGIN) url.searchParams.set("apiOrigin", API_ORIGIN)
        return `${url.pathname}${url.search}${url.hash}`
      }

      function syncAdminNavLinks() {
        document.querySelectorAll('a[href^="/admin"]').forEach((linkEl) => {
          const href = normalizeText(linkEl.getAttribute("href"))
          if (!href) return
          linkEl.setAttribute("href", buildAdminRuntimeHref(href))
        })
      }

      function setStatus(message, isError) {
        const el = document.getElementById("statusLine")
        if (!el) return
        el.textContent = normalizeText(message)
        el.classList.toggle("is-error", Boolean(isError))
      }
      async function apiJson(path, options = {}) {
        const requestInit = {
          method: normalizeText(options.method || "GET") || "GET",
          credentials: "include",
          headers: {
            ...(options.headers || {}),
          },
        }
        if (options.body !== undefined) {
          requestInit.headers["content-type"] = "application/json"
          requestInit.body = JSON.stringify(options.body)
        }
        const response = await fetch(resolveApiUrl(path), requestInit)
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          const message = normalizeText(payload?.error) || `HTTP ${response.status}`
          const error = new Error(message)
          error.status = response.status
          throw error
        }
        return payload
      }
      async function ensureAuthenticated() {
        if (INITIAL_AUTH_STATE?.authenticated === true) {
          return INITIAL_AUTH_STATE
        }
        if (INITIAL_AUTH_STATE?.authenticated === false) {
          const error = new Error("Authentication required")
          error.status = 401
          throw error
        }
        const payload = await apiJson("/api/admin/auth/me")
        if (!payload || payload.authenticated === false) {
          const error = new Error("Authentication required")
          error.status = 401
          throw error
        }
        return payload
      }

      function loadUiSettingsFromLocalStorage() {
        try {
          const raw = window.localStorage.getItem("sis.admin.uiSettings")
          if (!raw) {
            state.uiSettingsMeta = uiSettingsMetaFromSource(null)
            return null
          }
          const parsed = JSON.parse(raw)
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            state.uiSettingsMeta = uiSettingsMetaFromSource(null)
            return null
          }
          state.uiSettingsMeta = uiSettingsMetaFromSource(parsed)
          return parsed
        } catch (error) {
          void error
          state.uiSettingsMeta = uiSettingsMetaFromSource(null)
          return null
        }
      }
      async function hydrateLetterGradeRanges() {
        const localSettings = loadUiSettingsFromLocalStorage()
        state.letterGradeRanges = letterGradeRangesFromUiSettings(localSettings)
        syncSchoolSetupFromUiSettings(localSettings)
        renderSchoolSetupWarning()
        try {
          const payload = await apiJson("/api/admin/settings/ui")
          const uiSettings = payload?.uiSettings
          state.uiSettingsMeta = payload?.meta && typeof payload.meta === "object" ?
            payload.meta :
            uiSettingsMetaFromSource(uiSettings)
          state.letterGradeRanges = letterGradeRangesFromUiSettings(uiSettings)
          syncSchoolSetupFromUiSettings(uiSettings)
          renderSchoolSetupWarning()
        } catch (error) {
          void error
        }
      }

      function formatStudentDisplay(eaglesId, englishName, fullName) {
        const left = normalizeText(eaglesId) || "-"
        const right = normalizeText(englishName) || normalizeText(fullName) || "-"
        return `${left}/${right}`
      }

      function formatStudentDisplayCompact(eaglesId, englishName, fullName) {
        const idText = normalizeText(eaglesId)
        if (idText) return idText
        return normalizeText(englishName) || normalizeText(fullName) || "-"
      }

      function flattenGradeRowsFromStudent(student) {
        const source = student && typeof student === "object" ? student : {}
        const profile = source.profile && typeof source.profile === "object" ? source.profile : {}
        const gradeRecords = Array.isArray(source.gradeRecords) ? source.gradeRecords : []
        const studentRefId = normalizeText(source.id)
        const eaglesId = normalizeText(source.eaglesId)
        const studentNumber = source.studentNumber === undefined || source.studentNumber === null ?
          "" :
          String(source.studentNumber)
        const fullName = normalizeText(profile.fullName)
        const englishName = normalizeText(profile.englishName)
        const schoolName = normalizeText(profile.schoolName) || "Unspecified"
        const level = normalizeText(profile.currentGrade)
        const studentLabel = formatStudentDisplay(eaglesId, englishName, fullName) || studentRefId
        const studentDisplayCompact = formatStudentDisplayCompact(eaglesId, englishName, fullName) || studentLabel
        return gradeRecords.map((record, index) => {
          const dueAt = localIsoDate(record?.dueAt)
          const submittedAt = localIsoDate(record?.submittedAt)
          const dateKey = dueAt || submittedAt
          const commentText = normalizeText(record?.comments)
          const parsedCorrectTotal = parseCorrectTotalFromComments(commentText)
          const rawScore = toNumber(record?.score)
          const rawScorePercent = toNumber(record?.scorePercent)
          const effectiveScore = rawScore
          const rawMaxScore = toNumber(record?.maxScore)
          const questionCount = Number.isFinite(parsedCorrectTotal.totalQuestions) && parsedCorrectTotal.totalQuestions > 0 ?
            parsedCorrectTotal.totalQuestions :
            rawMaxScore && rawMaxScore > 0 ?
            rawMaxScore :
            null
          const usesParsedCorrectCount = Number.isFinite(parsedCorrectTotal.correctCount)
          let correctCount = usesParsedCorrectCount ?
            parsedCorrectTotal.correctCount :
            effectiveScore
          if (
            !usesParsedCorrectCount &&
            Number.isFinite(correctCount) &&
            correctCount !== null &&
            Number.isFinite(rawMaxScore) &&
            rawMaxScore > 0 &&
            Number.isFinite(questionCount) &&
            questionCount > 0 &&
            rawMaxScore !== questionCount
          ) {
            correctCount = Number(((correctCount / rawMaxScore) * questionCount).toFixed(2))
          }
          const scorePercent = Number.isFinite(correctCount) && Number.isFinite(questionCount) && questionCount > 0 ?
            percentValue(correctCount, questionCount) :
            rawScorePercent !== null ?
            rawScorePercent :
            rawMaxScore && rawMaxScore > 0 && effectiveScore !== null ?
            percentValue(effectiveScore, rawMaxScore) :
            null
          const quarter = normalizeQuarterCode(record?.quarter)
          const schoolYear = normalizeText(record?.schoolYear)
          const className = normalizeText(record?.className)
          const assignmentName = normalizeText(record?.assignmentName)
          const sourceFromApi = normalizeGradeRecordSource(record?.source)
          const isStandaloneAutoImport =
            normalizeLower(commentText).startsWith(AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX) &&
            assignmentName &&
            className &&
            normalizeLower(assignmentName) === normalizeLower(className) &&
            dueAt &&
            submittedAt &&
            dueAt === submittedAt &&
            record?.homeworkCompleted === true &&
            record?.homeworkOnTime === true
          const rowSource =
            sourceFromApi ||
            (isStandaloneAutoImport ? GRADE_RECORD_SOURCE_AUTO_IMPORT : GRADE_RECORD_SOURCE_ASSIGNMENT)
          return {
            id: normalizeText(record?.id) || `${studentRefId}-${index + 1}`,
            studentRefId,
            studentNumber,
            eaglesId,
            fullName,
            englishName,
            studentLabel,
            studentDisplay: studentDisplayCompact,
            schoolName,
            level,
            className,
            assignmentName,
            source: rowSource,
            schoolYear,
            quarter,
            dueAt,
            submittedAt,
            dateKey,
            score: correctCount,
            maxScore: questionCount,
            rawScore,
            rawMaxScore,
            scorePercent,
            homeworkCompleted: record?.homeworkCompleted === true ? true : record?.homeworkCompleted === false ? false : null,
            homeworkOnTime: record?.homeworkOnTime === true ? true : record?.homeworkOnTime === false ? false : null,
            behaviorScore: toNumber(record?.behaviorScore),
            participationScore: toNumber(record?.participationScore),
            inClassScore: toNumber(record?.inClassScore),
            comments: commentText,
            searchText: normalizeSearch(
              [
                eaglesId,
                fullName,
                englishName,
                schoolName,
                className,
                assignmentName,
                schoolYear,
                quarter,
                level,
                record?.comments,
              ].join(" ")
            ),
          }
        })
      }

      function formatShortNumber(value) {
        if (!Number.isFinite(value)) return ""
        const rounded = Math.round(value * 100) / 100
        if (Number.isInteger(rounded)) return String(rounded)
        return String(rounded)
      }

      function resolveExerciseStatus(record = {}) {
        const completed = record?.homeworkCompleted === true || Boolean(record?.submittedAt) || Number.isFinite(record?.score)
        if (!completed) return "notdone"
        if (record?.homeworkOnTime === true) return "ontime"
        if (record?.homeworkOnTime === false) return "late"
        const dueAt = parseIsoDate(record?.dueAt)
        const submittedAt = parseIsoDate(record?.submittedAt)
        if (dueAt && submittedAt && submittedAt.valueOf() > dueAt.valueOf()) return "late"
        return "ontime"
      }

      function isStandaloneAutoImportedExerciseRow(row = {}) {
        const comments = normalizeLower(row?.comments)
        if (!comments.startsWith(AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX)) return false
        const assignmentName = normalizeLower(row?.assignmentName)
        const className = normalizeLower(row?.className)
        const dueAt = normalizeText(row?.dueAt)
        const submittedAt = normalizeText(row?.submittedAt)
        if (!assignmentName || !className || assignmentName !== className) return false
        if (!dueAt || !submittedAt || dueAt !== submittedAt) return false
        if (row?.homeworkCompleted !== true || row?.homeworkOnTime !== true) return false
        return true
      }

      function canonicalizeStandaloneAutoImportedTitle(value) {
        let title = normalizeText(value)
        if (!title) return ""
        try {
          if (/%[0-9a-f]{2}/i.test(title)) {
            const decoded = decodeURIComponent(title)
            if (normalizeText(decoded)) title = normalizeText(decoded)
          }
        } catch (error) {
          void error
        }
        title = title
          .replace(/[?#].*$/u, "")
          .replace(/\.(?:html?|php|aspx?)$/iu, "")
          .replace(/[-_]+/g, " ")
          .replace(/\s+\|\s+(?:id|sid|ref|session|attempt|timestamp|time|date)\s*[:=#-].*$/iu, "")
          .replace(/\s+/g, " ")
          .trim()
        return normalizeText(title)
      }

      function normalizedAssignmentTitleForRow(row = {}) {
        const baseTitle = normalizeText(row?.assignmentName) || "Untitled"
        if (!isStandaloneAutoImportedExerciseRow(row)) return baseTitle
        return canonicalizeStandaloneAutoImportedTitle(baseTitle) || baseTitle
      }

      function assignmentKeyFromRow(row = {}) {
        const title = normalizedAssignmentTitleForRow(row)
        const isStandaloneAutoImport = isStandaloneAutoImportedExerciseRow(row)
        const rowSource = isStandaloneAutoImport ?
          GRADE_RECORD_SOURCE_AUTO_IMPORT :
          normalizeGradeRecordSource(row?.source) || GRADE_RECORD_SOURCE_ASSIGNMENT
        const dueAt = isStandaloneAutoImport ? "" : normalizeText(row?.dueAt)
        const schoolYear = normalizeText(row?.schoolYear)
        const quarter = normalizeQuarterCode(row?.quarter)
        return `${rowSource}|${normalizeLower(title)}|${dueAt}|${schoolYear}|${quarter}`
      }

      function medianOfNumbers(values = []) {
        const numbers = (Array.isArray(values) ? values : [])
          .map((entry) => Number(entry))
          .filter((entry) => Number.isFinite(entry))
          .sort((left, right) => left - right)
        if (!numbers.length) return null
        const mid = Math.floor(numbers.length / 2)
        if (numbers.length % 2 === 1) return numbers[mid]
        return (numbers[mid - 1] + numbers[mid]) / 2
      }

      function modeOfNumbers(values = [], precision = 2) {
        const counts = new Map();
        (Array.isArray(values) ? values : [])
        .map((entry) => Number(entry))
          .filter((entry) => Number.isFinite(entry))
          .forEach((entry) => {
            const key = Number(entry.toFixed(Math.max(0, Math.min(6, precision))))
            counts.set(key, (counts.get(key) || 0) + 1)
          })
        let bestValue = null
        let bestCount = 0
        counts.forEach((count, key) => {
          if (count > bestCount) {
            bestCount = count
            bestValue = key
          }
        })
        return bestCount > 1 ? bestValue : null
      }

      function gradeBandFromPercent(percent) {
        if (!Number.isFinite(percent)) return "N/A"
        const ranges = normalizeLetterGradeRanges(state.letterGradeRanges)
        for (let index = 0; index < ranges.length; index += 1) {
          const range = ranges[index]
          if (percent >= range.minPercent && percent <= range.maxPercent) return range.letter
        }
        return "N/A"
      }

      function withCorrectCountComment(existing, correctCount, totalQuestions) {
        const base = normalizeText(existing)
          .replace(/\(\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*correct\s*\)\.?/gi, "")
          .trim()
        const detail = `(${formatShortNumber(correctCount)}/${formatShortNumber(totalQuestions)} correct).`
        if (!base) return `Manual score update ${detail}`
        return `${base.replace(/[.\s]+$/g, "")} ${detail}`
      }
      async function editExerciseCellScore(cell, meta = {}) {
        const rowData = cell?.getRow?.().getData?.() || {}
        if (rowData?.rowType === "stat") return
        const studentRefId = normalizeText(rowData?.studentRefId)
        if (!studentRefId) {
          setStatus("Cannot edit score: missing student id.", true)
          return
        }
        const currentValue = cell.getValue()
        const current = currentValue && typeof currentValue === "object" ? currentValue : {}
        const fallbackQuestions = Number.isFinite(meta?.totalQuestions) && meta.totalQuestions > 0 ? meta.totalQuestions : 10
        const totalQuestions =
          Number.isFinite(current?.maxScore) && current.maxScore > 0 ? current.maxScore : fallbackQuestions
        const currentScore = Number.isFinite(current?.score) ? current.score : null
        const promptValue = currentScore === null ? "" : formatShortNumber(currentScore)
        const promptLabel =
          `Correct answers for ${normalizeText(rowData.studentDisplay) || "student"}\n` +
          `${normalizeText(meta.title) || "Exercise"}\n` +
          `Enter a value between 0 and ${formatShortNumber(totalQuestions)}`
        const rawInput = window.prompt(promptLabel, promptValue)
        if (rawInput === null) return
        const parsedScore = toNumber(rawInput)
        if (!Number.isFinite(parsedScore) || parsedScore < 0) {
          setStatus("Invalid score. Enter a non-negative number.", true)
          return
        }
        if (Number.isFinite(totalQuestions) && parsedScore > totalQuestions) {
          setStatus(`Invalid score. Max allowed is ${formatShortNumber(totalQuestions)}.`, true)
          return
        }
        const dueAt = normalizeText(current?.dueAt) || normalizeText(meta?.dueAt)
        const effectiveSchoolYear =
          normalizeText(current?.schoolYear) ||
          (normalizeSchoolYearFilter(state.filters.schoolYear) !== "current" ?
            normalizeText(state.filters.schoolYear) :
            "") ||
          SYSTEM_CURRENT_SCHOOL_YEAR ||
          schoolYearForIsoDate(dueAt || TODAY_ISO)
        const effectiveQuarter =
          normalizeQuarterCode(current?.quarter) ||
          normalizeQuarterCode(rowData?.quarter) ||
          normalizeQuarterCode(meta?.quarter) ||
          normalizeQuarterCode(state.filters.quarter) ||
          quarterFromIsoDate(dueAt || TODAY_ISO)
        const todayIso = localIsoDate(new Date())
        const homeworkOnTime = dueAt ? compareIsoDate(todayIso, dueAt) <= 0 : true
        const payload = {
          id: normalizeText(current?.recordId) || undefined,
          className: normalizeText(current?.className) || normalizeText(rowData?.level) || "Unassigned class",
          level: normalizeText(current?.level) || normalizeText(rowData?.level) || null,
          schoolYear: effectiveSchoolYear,
          quarter: effectiveQuarter,
          assignmentName: normalizeText(current?.assignmentName) || normalizeText(meta?.title) || "Exercise",
          source: GRADE_RECORD_SOURCE_ASSIGNMENT,
          dueAt: dueAt || undefined,
          submittedAt: todayIso,
          score: parsedScore,
          maxScore: totalQuestions,
          homeworkCompleted: true,
          homeworkOnTime,
          comments: withCorrectCountComment(current?.comments, parsedScore, totalQuestions),
        }
        setStatus("Saving score edit...")
        try {
          await apiJson(`/api/admin/students/${encodeURIComponent(studentRefId)}/grades`, {
            method: "POST",
            body: payload,
          })
          await bootstrapRows()
          setStatus(
            `Saved ${normalizeText(rowData.studentDisplay)} ${normalizeText(meta.title)} ` +
            `(${formatShortNumber(parsedScore)}/${formatShortNumber(totalQuestions)}).`
          )
        } catch (error) {
          setStatus(normalizeText(error?.message) || "Failed to save score edit.", true)
        }
      }

      function resolveHeaderActionLabel(column) {
        const headerEl = column?.getElement?.()
        if (headerEl instanceof HTMLElement) {
          const actionRow = headerEl.querySelector(".header-action-row")
          const dataLabel = normalizeText(actionRow?.getAttribute("data-header-label")) ||
            normalizeText(actionRow?.getAttribute("aria-label"))
          if (dataLabel) return dataLabel.replace(/\\s*column controls$/i, "") || "Column"
          const titleNode = headerEl.querySelector(".assignment-title-text")
          const titleText = normalizeText(titleNode?.textContent)
          if (titleText) return titleText
        }
        const definition = column?.getDefinition?.() || {}
        const fallbackTitleHtml = normalizeText(definition?.title)
        if (fallbackTitleHtml) {
          const temp = document.createElement("div")
          temp.innerHTML = fallbackTitleHtml
          const titleText = normalizeText(temp.textContent || temp.innerText)
          if (titleText) return titleText
        }
        const fallbackField = normalizeText(definition?.field)
        return fallbackField || "Column"
      }

      function toggleColumnPinnedState(column) {
        const safeLabel = resolveHeaderActionLabel(column)
        const definition = column?.getDefinition?.() || {}
        const nextFrozen = !Boolean(definition?.frozen)
        const updateResult = column?.updateDefinition?.({
          frozen: nextFrozen
        })
        if (updateResult && typeof updateResult.then === "function") {
          updateResult
            .then(() => {
              setStatus(`${safeLabel} column ${nextFrozen ? "pinned" : "unpinned"}.`)
              persistTableUiStateFromTable()
            })
            .catch(() => {})
          return
        }
        setStatus(`${safeLabel} column ${nextFrozen ? "pinned" : "unpinned"}.`)
        persistTableUiStateFromTable()
      }

      function hideColumnFromHeaderAction(column) {
        const safeLabel = resolveHeaderActionLabel(column)
        if (typeof column?.hide === "function") {
          column.hide()
          setStatus(`${safeLabel} column hidden.`)
          persistTableUiStateSoon()
        }
      }

      function handleHeaderActionClick(event, column) {
        const eventTarget = event?.target
        if (!(eventTarget instanceof Element)) return
        const actionButton = eventTarget.closest("[data-header-action]")
        if (!(actionButton instanceof HTMLButtonElement)) return
        const action = normalizeLower(actionButton.getAttribute("data-header-action"))
        if (!action) return
        event.preventDefault()
        event.stopPropagation()
        if (action === "pin") {
          toggleColumnPinnedState(column)
          return
        }
        if (action === "hide") {
          hideColumnFromHeaderAction(column)
        }
      }

      function scoreCellRank(cell = {}) {
        if (!cell || typeof cell !== "object") return -1
        if (Number.isFinite(cell?.score)) return 3
        if (cell?.completed === true || Boolean(cell?.submittedAt)) return 2
        if (Number.isFinite(cell?.maxScore)) return 1
        return 0
      }

      function scoreCellPercentValue(cell = {}) {
        if (!cell || typeof cell !== "object") return null
        if (Number.isFinite(cell?.percent)) return Number(cell.percent)
        const score = Number(cell?.score)
        const maxScore = Number(cell?.maxScore)
        if (Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0) {
          return percentValue(score, maxScore)
        }
        return null
      }

      function scoreCellTimestampValue(cell = {}) {
        const submittedAt = normalizeText(cell?.submittedAt)
        const dueAt = normalizeText(cell?.dueAt)
        const candidate = submittedAt || dueAt
        if (!candidate) return null
        const parsed = new Date(candidate)
        if (Number.isNaN(parsed.valueOf())) return null
        return parsed.valueOf()
      }

      function shouldReplaceScoreCell(existingCell, nextCell) {
        if (!existingCell || typeof existingCell !== "object") return true
        if (!nextCell || typeof nextCell !== "object") return false
        const existingPercent = scoreCellPercentValue(existingCell)
        const nextPercent = scoreCellPercentValue(nextCell)
        if (Number.isFinite(nextPercent) && Number.isFinite(existingPercent)) {
          if (nextPercent !== existingPercent) return nextPercent > existingPercent
        } else if (Number.isFinite(nextPercent) && !Number.isFinite(existingPercent)) {
          return true
        } else if (!Number.isFinite(nextPercent) && Number.isFinite(existingPercent)) {
          return false
        }
        const existingRank = scoreCellRank(existingCell)
        const nextRank = scoreCellRank(nextCell)
        if (nextRank !== existingRank) return nextRank > existingRank
        const existingTimestamp = scoreCellTimestampValue(existingCell)
        const nextTimestamp = scoreCellTimestampValue(nextCell)
        if (
          Number.isFinite(nextTimestamp) &&
          Number.isFinite(existingTimestamp) &&
          nextTimestamp !== existingTimestamp
        ) {
          return nextTimestamp > existingTimestamp
        }
        if (Number.isFinite(nextCell?.percent) && !Number.isFinite(existingCell?.percent)) return true
        if (Number.isFinite(existingCell?.percent) && !Number.isFinite(nextCell?.percent)) return false
        if (Number.isFinite(nextCell?.score) && !Number.isFinite(existingCell?.score)) return true
        if (Number.isFinite(existingCell?.score) && !Number.isFinite(nextCell?.score)) return false
        return false
      }

      function buildMatrixModel(rows = []) {
        const sourceRows = Array.isArray(rows) ? rows : []
        const assignmentMetaMap = new Map()
        sourceRows.forEach((entry) => {
          const key = assignmentKeyFromRow(entry)
          const rowSource = normalizeGradeRecordSource(entry?.source) || GRADE_RECORD_SOURCE_ASSIGNMENT
          if (!assignmentMetaMap.has(key)) {
            assignmentMetaMap.set(key, {
              key,
              title: normalizedAssignmentTitleForRow(entry),
              dueAt: normalizeText(entry?.dueAt),
              quarter: normalizeUpper(entry?.quarter),
              totalQuestions: Number.isFinite(entry?.maxScore) ? entry.maxScore : null,
              type: rowSource === GRADE_RECORD_SOURCE_ASSIGNMENT ? "assignment" : "elective",
            })
            return
          }
          const existing = assignmentMetaMap.get(key)
          if (existing && existing.type !== "elective" && rowSource !== GRADE_RECORD_SOURCE_ASSIGNMENT) {
            existing.type = "elective"
          }
          if (!existing.dueAt && normalizeText(entry?.dueAt)) existing.dueAt = normalizeText(entry?.dueAt)
          if (
            Number.isFinite(entry?.maxScore) &&
            (!Number.isFinite(existing.totalQuestions) || entry.maxScore > existing.totalQuestions)
          ) {
            existing.totalQuestions = entry.maxScore
          }
        })
        const assignmentMeta = Array.from(assignmentMetaMap.values()).sort((left, right) => {
          const leftDue = normalizeText(left.dueAt)
          const rightDue = normalizeText(right.dueAt)
          if (leftDue && rightDue) return compareIsoDate(leftDue, rightDue)
          if (leftDue) return -1
          if (rightDue) return 1
          return normalizeText(left.title).localeCompare(normalizeText(right.title))
        })
        const byStudent = new Map()
        sourceRows.forEach((entry) => {
          const studentRefId = normalizeText(entry?.studentRefId)
          if (!studentRefId) return
          if (!byStudent.has(studentRefId)) {
            byStudent.set(studentRefId, {
              id: `student-${studentRefId}`,
              rowType: "student",
              rowOrder: 0,
              studentRefId,
              level: normalizeText(entry?.level) || "Unassigned",
              studentDisplay: normalizeText(entry?.studentDisplay) || normalizeText(entry?.studentLabel),
              studentNumber: normalizeText(entry?.studentNumber),
              quarter: normalizeUpper(entry?.quarter),
            })
          }
          const row = byStudent.get(studentRefId)
          if (!row.quarter && normalizeText(entry?.quarter)) row.quarter = normalizeUpper(entry?.quarter)
          const assignmentKey = assignmentKeyFromRow(entry)
          const scoreValue = toNumber(entry?.score)
          const maxScoreValue = toNumber(entry?.maxScore)
          const scorePercent = Number.isFinite(entry?.scorePercent) ?
            entry.scorePercent :
            scoreValue !== null && maxScoreValue !== null && maxScoreValue > 0 ?
            percentValue(scoreValue, maxScoreValue) :
            null
          const nextCell = {
            score: scoreValue,
            maxScore: maxScoreValue,
            percent: scorePercent,
            status: resolveExerciseStatus(entry),
            completed: entry?.homeworkCompleted === true || Boolean(entry?.submittedAt) || Number.isFinite(scoreValue),
            recordId: normalizeText(entry?.id),
            className: normalizeText(entry?.className),
            schoolYear: normalizeText(entry?.schoolYear),
            quarter: normalizeQuarterCode(entry?.quarter),
            assignmentName: normalizedAssignmentTitleForRow(entry),
            dueAt: normalizeText(entry?.dueAt),
            submittedAt: normalizeText(entry?.submittedAt),
            comments: normalizeText(entry?.comments),
            level: normalizeText(entry?.level),
          }
          const currentCell = row[assignmentKey]
          if (shouldReplaceScoreCell(currentCell, nextCell)) {
            row[assignmentKey] = nextCell
          }
        })
        const studentRows = Array.from(byStudent.values())
          .sort((left, right) => {
            const levelCompare = normalizeText(left.level).localeCompare(normalizeText(right.level))
            if (levelCompare !== 0) return levelCompare
            return normalizeText(left.studentDisplay).localeCompare(normalizeText(right.studentDisplay))
          })
        studentRows.forEach((row, index) => {
          row.rowOrder = index + 1
        })
        assignmentMeta.forEach((meta) => {
          studentRows.forEach((row) => {
            if (!row[meta.key]) row[meta.key] = null
          })
        })
        const classSize = studentRows.length || 1
        const statRows = [{
            id: "stat-mean",
            rowType: "stat",
            rowOrder: studentRows.length + 1,
            level: "",
            studentDisplay: "Mean",
            studentNumber: "",
            quarter: "",
          },
          {
            id: "stat-median",
            rowType: "stat",
            rowOrder: studentRows.length + 2,
            level: "",
            studentDisplay: "Median",
            studentNumber: "",
            quarter: "",
          },
          {
            id: "stat-mode",
            rowType: "stat",
            rowOrder: studentRows.length + 3,
            level: "",
            studentDisplay: "Mode",
            studentNumber: "",
            quarter: "",
          },
          {
            id: "stat-completion",
            rowType: "stat",
            rowOrder: studentRows.length + 4,
            level: "",
            studentDisplay: "Class completion",
            studentNumber: "",
            quarter: "",
          },
          {
            id: "stat-distribution",
            rowType: "stat",
            rowOrder: studentRows.length + 5,
            level: "",
            studentDisplay: "Grade distribution",
            studentNumber: "",
            quarter: "",
          },
        ]
        assignmentMeta.forEach((meta) => {
          const cells = studentRows.map((row) => row[meta.key]).filter((entry) => entry && typeof entry === "object")
          const scoreValues = cells
            .map((entry) => Number(entry?.score))
            .filter((entry) => Number.isFinite(entry))
          const percents = cells
            .map((entry) => Number(entry?.percent))
            .filter((entry) => Number.isFinite(entry))
          const mean = scoreValues.length ?
            scoreValues.reduce((sum, entry) => sum + entry, 0) / scoreValues.length :
            null
          const median = medianOfNumbers(scoreValues)
          const mode = modeOfNumbers(scoreValues)
          const completionCount = cells.filter((entry) => entry?.completed === true).length
          const completionPercent = percentValue(completionCount, classSize)
          const distribution = new Map()
          normalizeLetterGradeRanges(state.letterGradeRanges).forEach((entry) => {
            distribution.set(entry.letter, 0)
          })
          percents.forEach((entry) => {
            const band = gradeBandFromPercent(entry)
            if (band === "N/A") return
            distribution.set(band, (distribution.get(band) || 0) + 1)
          })
          const questionTotal = Number.isFinite(meta.totalQuestions) ? meta.totalQuestions : null
          const formatQRightStat = (value) => {
            if (!Number.isFinite(value)) return "n/a"
            const rightText = formatShortNumber(value)
            if (!Number.isFinite(questionTotal) || questionTotal <= 0) return rightText
            return `${rightText}/${formatShortNumber(questionTotal)}`
          }
          const distributionEntries = Array.from(distribution.entries())
            .filter(([, count]) => Number.isFinite(count))
            .map(([letter, count]) => ({
              label: letter,
              count: Math.max(0, Math.round(count)),
            }))
          const distributionText = distributionEntries
            .map((entry) => `${entry.label}:${entry.count}`)
            .join(" ")
          statRows[0][meta.key] = formatQRightStat(mean)
          statRows[1][meta.key] = formatQRightStat(median)
          statRows[2][meta.key] = formatQRightStat(mode)
          statRows[3][meta.key] = Number.isFinite(completionPercent) ? `${Math.round(completionPercent)}%` : "0%"
          statRows[4][meta.key] = {
            type: "distribution",
            entries: distributionEntries,
            summaryText: distributionText || "-",
            totalCount: distributionEntries.reduce((sum, entry) => sum + entry.count, 0),
            assignmentTitle: normalizeAssignmentHeaderTitle(meta.title),
            dueLabel: normalizeText(meta.dueAt) || "-",
            questionTotal,
          }
        })
        const viewportWidth = Number(window.innerWidth) || 1280
        const assignmentTitleMaxChars =
          viewportWidth <= 560 ? 7 : viewportWidth <= 880 ? 9 : viewportWidth <= 1180 ? 10 : 12
        const coreTitleMaxChars =
          viewportWidth <= 560 ? 8 : viewportWidth <= 880 ? 10 : viewportWidth <= 1180 ? 12 : 14
        const studentColumnMinWidth = studentColumnMinWidthForResize()
        const studentColumnDefaultWidth = studentColumnDefaultWidthForViewport(viewportWidth)
        const rowsWithStats = assignmentMeta.length ? [...studentRows, ...statRows] : studentRows
        const classColumnWidth = coreColumnDataWidth(rowsWithStats, "level", {
          minWidth: 104,
          maxWidth: 226,
          minChars: 8,
          charWidth: 7.2,
          cellPadding: 28,
        })
        const studentColumnWidth = coreColumnDataWidth(studentRows, "studentDisplay", {
          minWidth: studentColumnMinWidth,
          maxWidth: 420,
          minChars: 3,
          charWidth: 7.6,
          cellPadding: 32,
        })
        const studentNumberColumnWidth = coreColumnDataWidth(rowsWithStats, "studentNumber", {
          minWidth: 74,
          maxWidth: 192,
          minChars: 5,
          charWidth: 7.1,
          cellPadding: 26,
        })
        const quarterColumnWidth = coreColumnDataWidth(rowsWithStats, "quarter", {
          minWidth: 72,
          maxWidth: 114,
          minChars: 2,
          charWidth: 7.2,
          cellPadding: 24,
        })
        const baseColumns = [{
            title: "Order",
            field: "rowOrder",
            visible: false,
            headerSort: false
          },
          {
            title: buildCoreHeaderCard("Class Level", "Class", "Grouping", coreTitleMaxChars),
            field: "level",
            minWidth: 104,
            width: classColumnWidth,
            frozen: true,
            headerSort: true,
            cssClass: "assignment-col core-col",
            responsive: 0,
            headerTooltip: () => "Class Level | Roster grouping",
          },
          {
            title: buildCoreHeaderCard("Student", "eaglesId", "", coreTitleMaxChars),
            field: "studentDisplay",
            minWidth: studentColumnMinWidth,
            width: studentColumnWidth,
            frozen: true,
            headerSort: true,
            cssClass: "assignment-col core-col",
            responsive: 0,
            headerTooltip: () => "Student | eaglesId",
          },
          {
            title: buildCoreHeaderCard("Student Number", "Roster", "ID", coreTitleMaxChars),
            field: "studentNumber",
            minWidth: 74,
            width: studentNumberColumnWidth,
            hozAlign: "center",
            headerSort: true,
            cssClass: "assignment-col core-col student-number-col",
            responsive: 9,
            headerTooltip: () => "Student Number | Roster number",
            formatter: (cell) => (
              `<span class=\"student-number-wrap\">${formatStudentNumberForWrap(cell.getValue())}</span>`
            ),
          },
          {
            title: buildCoreHeaderCard("Quarter", "Term", "Bucket", coreTitleMaxChars),
            field: "quarter",
            minWidth: 72,
            width: quarterColumnWidth,
            hozAlign: "center",
            headerSort: true,
            cssClass: "assignment-col core-col",
            responsive: 10,
            headerTooltip: () => "Quarter | Term bucket",
          },
        ]
        const assignmentColumns = assignmentMeta.map((meta, index) => {
          const rawTitle = normalizeText(meta.title) || "Untitled"
          const fullTitle = normalizeAssignmentHeaderTitle(rawTitle)
          const headerTitle = truncateHeaderTitle(fullTitle, assignmentTitleMaxChars)
          const isMegsTitle = isMegsAssignmentTitle(rawTitle)
          const isElective = normalizeText(meta.type) === "elective"
          const headerClass = [
              isElective ? ASSIGNMENT_HEAD_ELECTIVE_CLASS : ASSIGNMENT_HEAD_CLASS,
              isMegsTitle ? "megs" : "",
            ]
            .filter(Boolean)
            .join(" ")
          const dueLabel = normalizeText(meta.dueAt) || "-"
          const questionLabel = Number.isFinite(meta.totalQuestions) ? formatShortNumber(meta.totalQuestions) : "-"
          const assignmentColumnMinWidth = viewportWidth <= 560 ? 66 : viewportWidth <= 880 ? 72 : 78
          const assignmentColumnMaxWidth = viewportWidth <= 560 ? 154 : viewportWidth <= 880 ? 170 : 190
          const assignmentColumnWidth = assignmentColumnDataWidth(rowsWithStats, meta.key, {
            minWidth: assignmentColumnMinWidth,
            maxWidth: assignmentColumnMaxWidth,
            minChars: viewportWidth <= 560 ? 8 : 9,
            charWidth: 7.1,
            cellPadding: 24,
          })
          return {
            title: `<span class=\"${headerClass}\">` +
              `${buildHeaderActionButtons(fullTitle)}` +
              `<span class=\"assignment-title-text\">${escapeHtml(headerTitle)}</span>` +
              `<span class=\"assignment-sub\">Q: ${escapeHtml(questionLabel)}</span>` +
              `<span class=\"assignment-sub\">${escapeHtml(dueLabel)}</span>` +
              `</span>`,
            field: meta.key,
            minWidth: assignmentColumnMinWidth,
            width: assignmentColumnWidth,
            hozAlign: "center",
            cssClass: ["assignment-col", isElective ? "elective-col" : ""].filter(Boolean).join(" "),
            responsive: 30 + index,
            headerTooltip: () => `${fullTitle} | Q: ${questionLabel} | Due: ${dueLabel}`,
            headerSort: true,
            sorter: (left, right) => {
              const leftPercent = left && typeof left === "object" && Number.isFinite(left.percent) ? left.percent : -1
              const rightPercent = right && typeof right === "object" && Number.isFinite(right.percent) ? right.percent : -1
              return leftPercent - rightPercent
            },
            tooltip: () => "Double-click a student score cell to edit and save.",
            cellDblClick: (_event, cell) => {
              void editExerciseCellScore(cell, meta)
            },
            formatter: (cell) => {
              const rowData = cell.getRow().getData()
              const value = cell.getValue()
              if (rowData?.rowType === "stat") {
                if (normalizeText(rowData?.id) === "stat-distribution") {
                  return renderDistributionMiniCell(value, meta)
                }
                const statText = value && typeof value === "object" ?
                  normalizeText(value.summaryText) :
                  normalizeText(value)
                return `<span class=\"stat-chip\">${escapeHtml(statText || "n/a")}</span>`
              }
              if (!value || typeof value !== "object") {
                return `<span class=\"exercise-cell\"><span></span><span></span></span>`
              }
              const scoreLabel = Number.isFinite(value.score) && Number.isFinite(value.maxScore) && value.maxScore > 0 ?
                `${formatShortNumber(value.score)}/${formatShortNumber(value.maxScore)}` :
                Number.isFinite(value.score) ?
                `${formatShortNumber(value.score)}` :
                "-/-"
              const percentLabel = Number.isFinite(value.percent) ? `${Math.round(value.percent)}%` : "n/a"
              const isCompleted =
                value?.completed === true ||
                Boolean(value?.submittedAt) ||
                Number.isFinite(value?.score)
              const status = ["ontime", "late"].includes(value.status) ?
                value.status :
                (isCompleted ? "ontime" : "")
              if (!isCompleted) {
                return `<span class=\"exercise-cell\"><span></span><span></span></span>`
              }
              return (
                `<span class=\"exercise-cell ${status}\">` +
                `<span>${escapeHtml(scoreLabel)}</span>` +
                `<span>${escapeHtml(percentLabel)}</span>` +
                `</span>`
              )
            },
          }
        })
        return {
          columns: [...baseColumns, ...assignmentColumns],
          rows: rowsWithStats,
          assignmentCount: assignmentColumns.length,
          studentCount: studentRows.length,
        }
      }

      function chunkArray(items, size) {
        const chunks = []
        const safeSize = Math.max(1, Number.parseInt(String(size || 1), 10) || 1)
        for (let i = 0; i < items.length; i += safeSize) {
          chunks.push(items.slice(i, i + safeSize))
        }
        return chunks
      }
      async function loadGradeRows() {
        state.loading = true
        setStatus("Loading student roster...")
        const roster = await apiJson("/api/admin/students?take=1000")
        const students = Array.isArray(roster?.items) ? roster.items : []
        const withGradeCounts = students.filter((entry) => {
          const gradeCount = Number(entry?.counts?.gradeRecords ?? entry?._count?.gradeRecords ?? 0)
          return Number.isFinite(gradeCount) && gradeCount > 0
        })
        const targetStudents = withGradeCounts.length ? withGradeCounts : students
        const allRows = []
        const chunks = chunkArray(targetStudents, 10)
        for (let index = 0; index < chunks.length; index += 1) {
          const batch = chunks[index]
          setStatus(`Loading grade details ${index + 1}/${chunks.length}...`)
          const details = await Promise.all(
            batch.map(async (student) => {
              const id = normalizeText(student?.id)
              if (!id) return null
              try {
                const detail = await apiJson(`/api/admin/students/${encodeURIComponent(id)}`)
                if (detail?.student && typeof detail.student === "object") return detail.student
                if (detail && typeof detail === "object" && normalizeText(detail.id)) return detail
                return null
              } catch (error) {
                void error
                return null
              }
            })
          )
          details.forEach((entry) => {
            if (!entry) return
            allRows.push(...flattenGradeRowsFromStudent(entry))
          })
        }
        state.allRows = allRows
        state.loading = false
      }

      function uniqueSortedValues(rows, key) {
        const values = Array.from(new Set((Array.isArray(rows) ? rows : [])
          .map((entry) => normalizeText(entry?.[key]))
          .filter(Boolean)))
        values.sort((left, right) => left.localeCompare(right, undefined, {
          sensitivity: "base"
        }))
        return values
      }

      function replaceSelectOptions(selectEl, values, selectedValue, allLabel, options = {}) {
        if (!(selectEl instanceof HTMLSelectElement)) return
        const config = options && typeof options === "object" ? options : {}
        const includeAll = config.includeAll !== false
        const topValue = normalizeText(config.topValue || "all")
        const current = normalizeText(selectedValue)
        const markup = includeAll ? [`<option value=\"${escapeHtml(topValue)}\">${escapeHtml(allLabel)}</option>`] : []
        values.forEach((value) => {
          markup.push(`<option value=\"${escapeHtml(value)}\">${escapeHtml(value)}</option>`)
        })
        selectEl.innerHTML = markup.join("")
        if (includeAll) {
          const selected = current || topValue
          selectEl.value = values.includes(selected) ? selected : topValue
          return
        }
        const fallback = values.length ? values[0] : ""
        selectEl.value = values.includes(current) ? current : fallback
      }

      function refreshFilterOptionLists() {
        const rows = Array.isArray(state.allRows) ? state.allRows : []
        const classValues = uniqueSortedValues(rows, "level")
        const schoolValues = uniqueSortedValues(rows, "schoolName")
        const currentYear = currentOperationalSchoolYear()
        const yearValues = uniqueSortedValues(rows, "schoolYear")
          .filter((year) => year !== currentYear)
        yearValues.sort((left, right) => right.localeCompare(left))
        const studentValues = Array.from(new Map(
            rows.map((row) => [normalizeText(row.studentRefId), normalizeText(row.studentLabel)])
            .filter(([key, value]) => key && value)
          ))
          .sort((left, right) => left[1].localeCompare(right[1], undefined, {
            sensitivity: "base"
          }))
        replaceSelectOptions(document.getElementById("classFilter"), classValues, state.filters.classKey, "All class levels")
        const schoolFilter = document.getElementById("schoolFilter")
        const configuredSchoolName = normalizeText(state.schoolSetup?.schoolName)
        const singleSchoolMode = state.schoolSetup?.multiSchool !== true && Boolean(configuredSchoolName)
        if (singleSchoolMode) {
          replaceSelectOptions(schoolFilter, [configuredSchoolName], configuredSchoolName, configuredSchoolName, {
            includeAll: false,
          })
          state.filters.schoolKey = configuredSchoolName
        } else {
          replaceSelectOptions(schoolFilter, schoolValues, state.filters.schoolKey, "All schools")
        }
        const schoolYearSelect = document.getElementById("schoolYear")
        const explicitSchoolYear = Array.from(schoolYearSelect?.options || [])
          .map((option) => normalizeText(option?.value))
          .find((value) => isSchoolYearKey(value)) || ""
        const visibleSchoolYear = currentYear || explicitSchoolYear
        replaceSelectOptions(schoolYearSelect, yearValues, state.filters.schoolYear, visibleSchoolYear || "School year", {
          topValue: visibleSchoolYear || "current",
        })
        const studentFilter = document.getElementById("studentFilter")
        if (studentFilter instanceof HTMLSelectElement) {
          const options = ["<option value=\"all\">All students</option>"]
          studentValues.forEach(([studentRefId, label]) => {
            options.push(`<option value=\"${escapeHtml(studentRefId)}\">${escapeHtml(label)}</option>`)
          })
          studentFilter.innerHTML = options.join("")
          const current = normalizeText(state.filters.studentKey) || "all"
          studentFilter.value = studentValues.some(([studentRefId]) => studentRefId === current) ? current : "all"
        }
        const periodCode = normalizePeriodCode(state.filters.period)
        const activeSchoolYear = normalizeSchoolYearFilter(state.filters.schoolYear)
        if (periodCode === "archive") {
          if (activeSchoolYear !== "current" && activeSchoolYear && !yearValues.includes(activeSchoolYear)) {
            state.filters.schoolYear = "current"
          }
        } else if (currentYear && (activeSchoolYear === "current" || !isSchoolYearKey(activeSchoolYear) || !yearValues.includes(activeSchoolYear))) {
          state.filters.schoolYear = "current"
          const yearSelect = document.getElementById("schoolYear")
          if (yearSelect instanceof HTMLSelectElement) yearSelect.value = currentYear || state.filters.schoolYear
        }
        const selectedSchoolYear = normalizeSchoolYearFilter(state.filters.schoolYear)
        const resolvedSchoolYear = normalizeOperationalSchoolYear(selectedSchoolYear)
        const currentQuarter = normalizeQuarterCode(quarterFromIsoDate(TODAY_ISO)) || ""
        const ssotQuarter = quarterForSchoolYear(resolvedSchoolYear || currentYear, TODAY_ISO)
        const currentQuarterFromSsot = normalizeQuarterCode(ssotQuarter)
        const activeQuarter = normalizeQuarterCode(state.filters.quarter)
        if ((periodCode === "quarter" || periodCode === "qtd") && !activeQuarter && currentQuarterFromSsot) {
          state.filters.quarter = currentQuarterFromSsot
        } else if (!activeQuarter) {
          state.filters.quarter = currentQuarterFromSsot || currentQuarter
        }
        const quarterSelect = document.getElementById("quarter")
        if (quarterSelect instanceof HTMLSelectElement) {
          quarterSelect.value =
            normalizeQuarterCode(state.filters.quarter) ||
            (periodCode === "quarter" || periodCode === "qtd" ? currentQuarterFromSsot : "") ||
            currentQuarter
        }
      }

      function rangeLabelForActiveFilters(period, rangeStart, rangeEnd, currentSchoolYear) {
        if (period === "archive") return `Archive only (excluding ${currentSchoolYear})`
        if (rangeStart || rangeEnd) return `${rangeStart || "..."} to ${rangeEnd || "..."}`
        return "All dates"
      }

      function shouldApplyTodayCap(targetSchoolYear, dateDerivedCurrentSchoolYear) {
        const target = normalizeText(targetSchoolYear)
        const dateDerived = normalizeText(dateDerivedCurrentSchoolYear)
        if (!target || !dateDerived) return false
        return target === dateDerived
      }

      function filteredRowsWithRange() {
        const rows = Array.isArray(state.allRows) ? state.allRows : []
        const filters = state.filters
        const requestedSchoolYear = normalizeSchoolYearFilter(filters.schoolYear)
        const currentSchoolYear = currentOperationalSchoolYear()
        const selectedSchoolYear = normalizeOperationalSchoolYear(requestedSchoolYear)
        const dateDerivedCurrentSchoolYear = schoolYearForIsoDate(TODAY_ISO)
        let rangeStart = ""
        let rangeEnd = ""
        if (filters.period === "week") {
          rangeStart = startOfWeekIso(TODAY_ISO)
          rangeEnd = isoDateOffset(rangeStart, 6)
        } else if (filters.period === "custom") {
          rangeStart = normalizeText(filters.customFrom).slice(0, 10)
          rangeEnd = normalizeText(filters.customTo).slice(0, 10)
        }
        if (rangeStart && rangeEnd && compareIsoDate(rangeStart, rangeEnd) > 0) {
          const swap = rangeStart
          rangeStart = rangeEnd
          rangeEnd = swap
        }
        const filtered = rows.filter((row) => {
          const rowDate = normalizeText(row?.dateKey)
          const rowQuarter = normalizeLower(row?.quarter)
          const rowSchoolYear = normalizeText(row?.schoolYear)
          const rowSource = normalizeGradeRecordSource(row?.source) || GRADE_RECORD_SOURCE_ASSIGNMENT
          if (!GRADE_RECORD_SOURCES_VISIBLE_IN_MATRIX.has(rowSource)) return false
          if (filters.period === "archive") {
            if (!rowSchoolYear || rowSchoolYear === currentSchoolYear) return false
            if (requestedSchoolYear !== "current" && rowSchoolYear !== selectedSchoolYear) return false
          } else {
            const targetSchoolYear = selectedSchoolYear || currentSchoolYear
            if (rowSchoolYear && rowSchoolYear !== targetSchoolYear) return false
          }
          if (filters.period === "quarter" || filters.period === "qtd") {
            if (!rowQuarter || rowQuarter !== normalizeLower(filters.quarter)) return false
            if (filters.period === "qtd") {
              const targetYear = selectedSchoolYear || currentSchoolYear
              if (
                rowDate &&
                compareIsoDate(rowDate, TODAY_ISO) > 0 &&
                shouldApplyTodayCap(targetYear, dateDerivedCurrentSchoolYear)
              ) {
                return false
              }
            }
          }
          if (filters.period === "sytd") {
            const targetYear = selectedSchoolYear || currentSchoolYear
            if (rowSchoolYear && rowSchoolYear !== targetYear) return false
            if (
              rowDate &&
              compareIsoDate(rowDate, TODAY_ISO) > 0 &&
              shouldApplyTodayCap(targetYear, dateDerivedCurrentSchoolYear)
            ) {
              return false
            }
          }
          if (filters.period === "week" || filters.period === "custom") {
            if (rangeStart || rangeEnd) {
              if (!rowDate) return false
              if (rangeStart && compareIsoDate(rowDate, rangeStart) < 0) return false
              if (rangeEnd && compareIsoDate(rowDate, rangeEnd) > 0) return false
            }
          }
          if (filters.classKey !== "all" && normalizeText(row?.level) !== filters.classKey) return false
          if (filters.studentKey !== "all" && normalizeText(row?.studentRefId) !== filters.studentKey) return false
          if (filters.schoolKey !== "all" && normalizeText(row?.schoolName) !== filters.schoolKey) return false
          const needle = normalizeSearch(filters.search)
          if (needle && !normalizeSearch(row?.searchText).includes(needle)) return false
          return true
        })
        return {
          rows: filtered,
          rangeStart,
          rangeEnd,
          currentSchoolYear,
          rangeLabel: rangeLabelForActiveFilters(filters.period, rangeStart, rangeEnd, currentSchoolYear),
        }
      }

      function ensureTable() {
        if (state.table) return
        if (typeof window.Tabulator !== "function") {
          setStatus("Tabulator assets are missing. Run: tools/sync-tabulatorz-assets.sh", true)
          return
        }
        const storedTableUiState = readTableUiState()
        const tableHeight = normalizeTableHeightPx(state.tableHeightPx, storedTableUiState?.tableHeight ?? defaultTableHeightPx())
        applyTableHeight(tableHeight, {
          persist: false,
          redraw: false
        })
        const viewportWidth = Number(window.innerWidth) || 1280
        const useResponsiveCollapse = false
        const coreTitleMaxChars =
          viewportWidth <= 560 ? 8 : viewportWidth <= 880 ? 10 : viewportWidth <= 1180 ? 12 : 14
        const studentColumnMinWidth = studentColumnMinWidthForResize()
        const studentColumnDefaultWidth = studentColumnDefaultWidthForViewport(viewportWidth)
        state.responsiveCollapseEnabled = useResponsiveCollapse
        state.table = new window.Tabulator("#gradeGrid", {
          data: [],
          layout: "fitDataTable",
          columnHeaderVertAlign: "bottom",
          columnDefaults: {
            headerSort: true,
            headerHozAlign: "left",
            vertAlign: "middle",
            resizable: true,
            headerClick: handleHeaderActionClick,
          },
          responsiveLayout: false,
          responsiveLayoutCollapseUseFormatters: false,
          responsiveLayoutCollapseFormatter: buildResponsiveCollapseContent,
          responsiveLayoutCollapseStartOpen: false,
          rowHeader: false,
          height: tableHeight,
          placeholder: "No grade rows match the selected filters.",
          pagination: false,
          movableColumns: true,
          resizableColumns: true,
          resizableColumnGuide: true,
          tooltipDelay: 120,
          initialSort: [{
            column: "rowOrder",
            dir: "asc"
          }, ],
          columns: [{
              title: "Order",
              field: "rowOrder",
              visible: false,
              headerSort: false
            },
            {
              title: buildCoreHeaderCard("Class Level", "Class", "Grouping", coreTitleMaxChars),
              field: "level",
              minWidth: 104,
              frozen: true,
              cssClass: "assignment-col core-col",
              responsive: 0,
              headerTooltip: () => "Class Level | Roster grouping",
            },
            {
              title: buildCoreHeaderCard("Student", "eaglesId", "", coreTitleMaxChars),
              field: "studentDisplay",
              minWidth: studentColumnMinWidth,
              width: studentColumnDefaultWidth,
              frozen: true,
              cssClass: "assignment-col core-col",
              responsive: 0,
              headerTooltip: () => "Student | eaglesId",
            },
            {
              title: buildCoreHeaderCard("Student Number", "Roster", "ID", coreTitleMaxChars),
              field: "studentNumber",
              minWidth: 74,
              hozAlign: "center",
              cssClass: "assignment-col core-col student-number-col",
              responsive: 9,
              headerTooltip: () => "Student Number | Roster number",
              formatter: (cell) => (
                `<span class=\"student-number-wrap\">${formatStudentNumberForWrap(cell.getValue())}</span>`
              ),
            },
            {
              title: buildCoreHeaderCard("Quarter", "Term", "Bucket", coreTitleMaxChars),
              field: "quarter",
              minWidth: 72,
              hozAlign: "center",
              cssClass: "assignment-col core-col",
              responsive: 10,
              headerTooltip: () => "Quarter | Term bucket",
            },
          ],
          rowFormatter: (row) => {
            const data = row.getData()
            const el = row.getElement()
            if (!el) return
            if (data?.rowType === "stat") {
              el.classList.add("is-stat-row")
            } else {
              el.classList.remove("is-stat-row")
            }
          },
        })
        observeTableHeightResize()
        state.tableBuilt = false
        if (typeof state.table?.on === "function") {
          state.table.on("tableBuilt", () => {
            state.tableBuilt = true
            renderTable()
          })
          state.table.on("columnMoved", () => {
            persistTableUiStateSoon()
          })
          state.table.on("columnResized", () => {
            persistTableUiStateSoon()
          })
          state.table.on("columnVisibilityChanged", () => {
            persistTableUiStateSoon()
          })
          state.table.on("dataSorted", () => {
            persistTableUiStateSoon()
          })
        }
      }

      function normalizeUpper(value) {
        return normalizeText(value).toUpperCase()
      }

      function matrixColumnSchemaKey(columns = []) {
        return (Array.isArray(columns) ? columns : [])
          .map((column) => {
            const field = normalizeText(column?.field)
            if (field) return field
            const titleText = stripHtmlToText(column?.title)
            return titleText || "column"
          })
          .join("|")
      }

      function currentTableColumnSchemaKey() {
        if (!state.table || typeof state.table.getColumns !== "function") return ""
        const columns = state.table.getColumns().map((column) => {
          const field = normalizeText(column?.getField?.())
          if (field) return {
            field
          }
          const definition = column?.getDefinition?.() || {}
          return {
            title: definition.title
          }
        })
        return matrixColumnSchemaKey(columns)
      }

      function updateMetrics(rows) {
        const source = Array.isArray(rows) ? rows : []
        const studentCount = new Set(source.map((entry) => normalizeText(entry?.studentRefId)).filter(Boolean)).size
        const classCount = new Set(source.map((entry) => normalizeText(entry?.level)).filter(Boolean)).size
        const scoreValues = source
          .map((entry) => Number(entry?.scorePercent))
          .filter((entry) => Number.isFinite(entry))
        const averagePercent = scoreValues.length ?
          scoreValues.reduce((sum, entry) => sum + entry, 0) / scoreValues.length :
          null
        const homeworkRows = source.filter((entry) => typeof entry?.homeworkCompleted === "boolean")
        const completedRows = homeworkRows.filter((entry) => entry.homeworkCompleted === true).length
        const completionRate = homeworkRows.length ? percentValue(completedRows, homeworkRows.length) : null
        const rowEl = document.getElementById("metricRows")
        const studentEl = document.getElementById("metricStudents")
        const classEl = document.getElementById("metricClasses")
        const avgEl = document.getElementById("metricAvgPercent")
        const completionEl = document.getElementById("metricCompletion")
        if (rowEl) rowEl.textContent = String(source.length)
        if (studentEl) studentEl.textContent = String(studentCount)
        if (classEl) classEl.textContent = String(classCount)
        if (avgEl) avgEl.textContent = formatPercent(averagePercent)
        if (completionEl) completionEl.textContent = formatPercent(completionRate)
      }

      function applyFilterControlState() {
        const quarter = document.getElementById("quarter")
        const customFrom = document.getElementById("customFrom")
        const customTo = document.getElementById("customTo")
        const isQuarterMode = state.filters.period === "quarter" || state.filters.period === "qtd"
        const isCustomMode = state.filters.period === "custom"
        if (quarter instanceof HTMLSelectElement) quarter.disabled = !isQuarterMode
        if (customFrom instanceof HTMLInputElement) customFrom.disabled = !isCustomMode
        if (customTo instanceof HTMLInputElement) customTo.disabled = !isCustomMode
      }

      function syncFilterControlValues() {
        const schoolYear = document.getElementById("schoolYear")
        const quarter = document.getElementById("quarter")
        if (schoolYear instanceof HTMLSelectElement) {
          const configuredYear = currentOperationalSchoolYear()
          const explicitSchoolYear = Array.from(schoolYear.options || [])
            .map((option) => normalizeText(option?.value))
            .find((value) => isSchoolYearKey(value)) || ""
          const visibleSchoolYear = configuredYear || explicitSchoolYear
          const selectedSchoolYear = normalizeSchoolYearFilter(state.filters.schoolYear)
          if (isSchoolYearKey(selectedSchoolYear)) schoolYear.value = selectedSchoolYear
          else if (visibleSchoolYear) schoolYear.value = visibleSchoolYear
        }
        if (quarter instanceof HTMLSelectElement) {
          const currentQuarter = currentQuarterForFilters()
          const activeQuarter = normalizeQuarterCode(state.filters.quarter)
          quarter.value = activeQuarter || currentQuarter || ""
          if (!activeQuarter && currentQuarter) {
            state.filters.quarter = currentQuarter
          }
        }
      }

      function syncPeriodButtons() {
        document.querySelectorAll("[data-period]").forEach((button) => {
          const period = normalizeLower(button.getAttribute("data-period"))
          const isActive = period === state.filters.period
          button.classList.toggle("is-active", isActive)
          button.setAttribute("aria-pressed", String(isActive))
          if (isActive) {
            button.style.background = "linear-gradient(180deg, #007b97 0%, #00647c 100%)"
            button.style.border = "2px solid #006f94"
            button.style.color = "#fbffff"
            button.style.boxShadow =
              "inset 0 0 0 1px rgba(255, 255, 255, 0.24), 0 0 0 1px rgba(6, 72, 111, 0.28), 0 10px 18px rgba(8, 22, 40, 0.14)"
            button.style.fontWeight = "900"
          } else {
            button.style.removeProperty("background")
            button.style.removeProperty("border")
            button.style.removeProperty("color")
            button.style.removeProperty("box-shadow")
            button.style.removeProperty("font-weight")
          }
        })
      }

      function renderTable() {
        const outcome = filteredRowsWithRange()
        state.filteredRows = outcome.rows
        const matrix = buildMatrixModel(state.filteredRows)
        state.matrixRows = matrix.rows
        const maintenanceNeeded =
          state.uiSettingsMeta?.schoolSetupHasIssues === true ||
          state.uiSettingsMeta?.schoolSetupState === "maintenance" ||
          state.uiSettingsMeta?.schoolSetupStoredQuartersMissing === true ||
          normalizeText(state.schoolSetup?.schoolSetupState) === "maintenance"
        if (maintenanceNeeded) {
          renderGradeGridMaintenance({
            title: "Quarter grades are temporarily unavailable",
            lead: "Quarter setup is incomplete or invalid.",
            note: "Open School Setup and save four explicit quarters before reloading the matrix.",
          })
          updateMetrics([])
          const rangeHint = document.getElementById("rangeHint")
          if (rangeHint) {
            rangeHint.textContent = "Quarter setup is unavailable until School Setup is restored."
          }
          if (!state.loading) {
            setStatus("Quarter setup is incomplete or invalid. Open School Setup to restore four explicit quarters.", true)
          }
          return
        }
        ensureTable()
        if (state.table && state.tableBuilt) {
          try {
            const nextSchemaKey = matrixColumnSchemaKey(matrix.columns)
            const liveSchemaKey = currentTableColumnSchemaKey()
            const liveFieldSet = tableColumnFieldSet()
            const tableHasAssignmentColumns = Array.from(liveFieldSet.values()).some((field) => field.includes("|"))
            const shouldResetColumns =
              nextSchemaKey !== state.columnSchemaKey ||
              (liveSchemaKey && liveSchemaKey !== nextSchemaKey) ||
              (matrix.assignmentCount > 0 && !tableHasAssignmentColumns)
            const applySortAndPersistState = () => {
              if (shouldResetColumns) {
                const applied = applyStoredTableUiState({
                  applyLayout: false,
                  applySort: true
                })
                if (
                  !applied.sortApplied &&
                  typeof state.table?.setSort === "function" &&
                  typeof state.table?.getSorters === "function"
                ) {
                  const activeSorters = normalizeTableSortersSnapshot(state.table.getSorters())
                  if (!activeSorters.length) {
                    state.table.setSort([{
                      column: "rowOrder",
                      dir: "asc"
                    }])
                  }
                }
              }
              persistTableUiStateFromTable()
              if (shouldResetColumns && matrix.assignmentCount > 0) {
                window.setTimeout(() => {
                  ensureAssignmentColumnsPresent(matrix.columns, matrix.assignmentCount)
                }, 0)
              }
            }
            const replaceRows = () => {
              const replaceResult = state.table.replaceData(matrix.rows)
              if (replaceResult && typeof replaceResult.then === "function") {
                replaceResult
                  .then(() => {
                    applySortAndPersistState()
                  })
                  .catch(() => {})
                return
              }
              applySortAndPersistState()
            }
            if (shouldResetColumns) {
              const setColumnsResult = state.table.setColumns(matrix.columns)
              state.columnSchemaKey = nextSchemaKey
              const expectedColumnCount = Array.isArray(matrix.columns) ? matrix.columns.length : 0
              const afterSetColumns = () => {
                const finishAfterColumnsReady = () => {
                  applyStoredTableUiState({
                    applyLayout: true,
                    applySort: false,
                    requiredAssignmentColumns: matrix.assignmentCount,
                  })
                  replaceRows()
                }
                if (!expectedColumnCount) {
                  finishAfterColumnsReady()
                  return
                }
                waitForExpectedColumnCount(expectedColumnCount)
                  .then(() => {
                    finishAfterColumnsReady()
                  })
                  .catch(() => {
                    finishAfterColumnsReady()
                  })
              }
              if (setColumnsResult && typeof setColumnsResult.then === "function") {
                setColumnsResult
                  .then(() => {
                    afterSetColumns()
                  })
                  .catch(() => {
                    replaceRows()
                  })
              } else {
                afterSetColumns()
              }
            } else {
              replaceRows()
            }
          } catch (error) {
            void error
          }
        }
        updateMetrics(state.filteredRows)
        const rangeHint = document.getElementById("rangeHint")
        if (rangeHint) {
          const periodLabel = state.filters.period.toUpperCase()
          const viewportHint = "Use horizontal scroll for full matrix and sticky identity columns."
          rangeHint.textContent =
            `Period ${periodLabel} | Range ${outcome.rangeLabel} | Students ${matrix.studentCount} | Exercises ${matrix.assignmentCount}` +
            ` | ${viewportHint}`
        }
        if (!state.loading) {
          setStatus(`Loaded ${state.filteredRows.length} grade rows into ${matrix.studentCount} students x ${matrix.assignmentCount} exercise columns.`)
        }
      }

      function readControlValues() {
        const schoolYear = document.getElementById("schoolYear")
        const quarter = document.getElementById("quarter")
        const classFilter = document.getElementById("classFilter")
        const studentFilter = document.getElementById("studentFilter")
        const schoolFilter = document.getElementById("schoolFilter")
        const customFrom = document.getElementById("customFrom")
        const customTo = document.getElementById("customTo")
        const searchInput = document.getElementById("searchInput")
        if (schoolYear instanceof HTMLSelectElement) {
          state.filters.schoolYear = normalizeSchoolYearFilter(schoolYear.value)
        }
        if (quarter instanceof HTMLSelectElement) state.filters.quarter = normalizeQuarterCode(quarter.value)
        if (classFilter instanceof HTMLSelectElement) state.filters.classKey = normalizeText(classFilter.value) || "all"
        if (studentFilter instanceof HTMLSelectElement) state.filters.studentKey = normalizeText(studentFilter.value) || "all"
        if (schoolFilter instanceof HTMLSelectElement) state.filters.schoolKey = normalizeText(schoolFilter.value) || "all"
        if (customFrom instanceof HTMLInputElement) state.filters.customFrom = normalizeText(customFrom.value).slice(0, 10)
        if (customTo instanceof HTMLInputElement) state.filters.customTo = normalizeText(customTo.value).slice(0, 10)
        if (searchInput instanceof HTMLInputElement) state.filters.search = normalizeText(searchInput.value)
        persistUiPreferences()
      }

      function bindControls() {
        const controls = [
          "schoolYear",
          "quarter",
          "classFilter",
          "studentFilter",
          "schoolFilter",
          "customFrom",
          "customTo",
        ]
        controls.forEach((id) => {
          const el = document.getElementById(id)
          if (!el) return
          el.addEventListener("change", () => {
            readControlValues()
            applyFilterControlState()
            renderTable()
          })
        })
        const searchInput = document.getElementById("searchInput")
        if (searchInput) {
          searchInput.addEventListener("input", () => {
            readControlValues()
            renderTable()
          })
        }
        document.querySelectorAll("[data-period]").forEach((button) => {
          button.addEventListener("click", () => {
            const nextPeriod = normalizePeriodCode(button.getAttribute("data-period"))
            state.filters.period = nextPeriod
            applyCurrentSchoolYearDefault()
            refreshFilterOptionLists()
            persistUiPreferences()
            syncPeriodButtons()
            applyFilterControlState()
            renderTable()
          })
        })
        const reloadBtn = document.getElementById("reloadBtn")
        if (reloadBtn) {
          reloadBtn.addEventListener("click", async () => {
            try {
              await bootstrapRows()
            } catch (error) {
              setStatus(normalizeText(error?.message) || "Reload failed.", true)
            }
          })
        }
        const toggleCompactBtn = document.getElementById("toggleCompactBtn")
        if (toggleCompactBtn) {
          toggleCompactBtn.addEventListener("click", () => {
            toggleCompactMode()
          })
        }
        const resetColumnsBtn = document.getElementById("resetColumnsBtn")
        if (resetColumnsBtn) {
          resetColumnsBtn.addEventListener("click", () => {
            clearStoredTableUiState()
            state.columnSchemaKey = ""
            renderTable()
            if (state.table && typeof state.table.setSort === "function") {
              state.table.setSort([{
                column: "rowOrder",
                dir: "asc"
              }])
            }
            setStatus("Saved column layout and sort reset to default.")
          })
        }
        const handleResize = debounce(() => {
          if (state.loading) return
          renderTable()
        }, 190)
        window.addEventListener("resize", handleResize)
      }
      function updateMenuToggleButtons() {
        const menuOpen = document.body.classList.contains("menu-open")
        const floatingMenuBtn = document.getElementById("floatingMenuBtn")
        if (floatingMenuBtn) {
          floatingMenuBtn.setAttribute("aria-expanded", menuOpen ? "true" : "false")
          floatingMenuBtn.setAttribute(
            "aria-label",
            menuOpen ? "Close navigation menu" : "Open navigation menu",
          )
        }
      }
      function setMenuOpen(shouldOpen) {
        document.body.classList.toggle("menu-open", Boolean(shouldOpen))
        updateMenuToggleButtons()
      }
      function bindMenuControls() {
        document
          .querySelectorAll("[data-menu-toggle]")
          .forEach((button) => {
            button.addEventListener("click", () => {
              const group = button.closest("[data-menu-group]")
              if (!group) return
              group.classList.toggle("expanded")
            })
          })
        document
          .querySelectorAll("#appSidebarNav a.menu-link")
          .forEach((link) => {
            link.addEventListener("click", () => {
              setMenuOpen(false)
            })
          })
        document.getElementById("floatingMenuBtn")?.addEventListener("click", () => {
          setMenuOpen(!document.body.classList.contains("menu-open"))
        })
        document.getElementById("menuBackdrop")?.addEventListener("click", () => {
          setMenuOpen(false)
        })
        updateMenuToggleButtons()
      }
      async function bootstrapRows() {
        if (state.loading) return
        state.loading = true
        try {
          await hydrateLetterGradeRanges()
          const params = new URLSearchParams(window.location.search || "")
          applyCurrentSchoolYearDefault({
            force: !params.has("schoolYear"),
          })
          applyCurrentQuarterDefault({
            force: !params.has("quarter"),
          })
          await loadGradeRows()
          refreshFilterOptionLists()
          applyCurrentQuarterDefault({
            force: !params.has("quarter"),
          })
          readControlValues()
          syncPeriodButtons()
          applyFilterControlState()
          renderTable()
          persistUiPreferences()
          setStatus(`SIS load complete. ${state.allRows.length} grade rows ready.`)
        } finally {
          state.loading = false
        }
      }
      async function init() {
        syncAdminNavLinks()
        if (!API_ORIGIN) {
          setStatus("Missing API origin. Open with ?apiOrigin=http://127.0.0.1:<dev-port>", true)
          return
        }
          restoreUiPreferences()
          applyCurrentSchoolYearDefault({
            force: true
          })
          applyFilterQueryOverrides()
          applyCurrentSchoolYearDefault()
          applyCurrentQuarterDefault({
            force: !new URLSearchParams(window.location.search || "").has("quarter"),
          })
          bindMenuControls()
          bindControls()
          bindTableModalControls()
          bindDistributionModalControls()
          syncFilterControlValues()
          syncCompactModeUi()
          syncPeriodButtons()
          applyFilterControlState()
          try {
          await ensureAuthenticated()
        } catch (error) {
          if (error && error.status === 401) {
            setStatus("Login required. Open /admin first, then return here.", true)
            return
          }
          throw error
        }
        await bootstrapRows()
      }
      init().catch((error) => {
        setStatus(normalizeText(error?.message) || "Failed to initialize tabulator page.", true)
      })
    })()
