(() => {
      const IS_JSDOM_ENV = /\bjsdom\b/i.test(String(window.navigator?.userAgent || ""));
      const API_ORIGIN =
        window.__SIS_ADMIN_API_ORIGIN ||
        (!IS_JSDOM_ENV && window.location.protocol.startsWith("http") ? window.location.origin : "");
      const ADMIN_AUTH_PREFIX = window.__SIS_ADMIN_AUTH_PREFIX || "/api/admin/auth";
      const ENROLLMENT_STUDENTS_PATH =
        window.__SIS_ADMIN_ENROLLMENT_STUDENTS_PATH || "/api/admin/enrollment/students";
      const UI_SETTINGS_PATH =
        window.__SIS_ADMIN_UI_SETTINGS_PATH || "/api/admin/settings/ui";
      const ADMIN_ASSETS_PATH = "/api/admin/assets";
      const ENROLLMENT_REASONS = Array.isArray(window.__SIS_ADMIN_ENROLLMENT_REASONS)
        ? window.__SIS_ADMIN_ENROLLMENT_REASONS
        : [];
      const UNENROLLED_ONLY = window.__SIS_ADMIN_ENROLLMENT_UNENROLLED_ONLY || "__UNENROLLED_ONLY__";
      const TEXT_ZOOM_STORAGE_KEY = "sis.admin.globalTextZoomPercent.v1";
      const TEXT_ZOOM_DEFAULT = 100;
      const TEXT_ZOOM_MIN = 85;
      const TEXT_ZOOM_MAX = 125;
      const TEXT_ZOOM_STEP = 5;
      const DEFAULT_SCHOOL_PROFILE = {
        schoolName: "The Eagles Club",
        logoDataUrl: "",
      };
      const LEVEL_THEME_LOOKUP = new Map(
        [
          ["Eggs & Chicks", "#e0162b"],
          ["Pre-A1 Starters", "#FCAB15"],
          ["A1 Movers", "#913198"],
          ["A2 Flyers", "#b5d570"],
          ["A2 KET", "#038e9f"],
          ["B1 PET", "#cd1637"],
          ["B2+ IELTS", "#b10128"],
          ["C1+ TAYK", "#980001"],
          ["Private", "#002786"],
        ].map(([label, color]) => [normalizeLevelKey(label), color]),
      );
      const KNOWN_LEVELS = [
        "Eggs & Chicks",
        "Pre-A1 Starters",
        "A1 Movers",
        "A2 Flyers",
        "A2 KET",
        "B1 PET",
        "B2+ IELTS",
        "C1+ TAYK",
        "Private",
      ];
      const state = {
        globalTextZoomPercent: TEXT_ZOOM_DEFAULT,
      };
      let enrollmentHistoryModalReturnFocus = null;
      let openHistoryRailMenu = null;
      let enrollmentRowsCache = [];
      let levelTileStylesByLevel = {};

      function normalizeText(value) {
        return value === undefined || value === null ? "" : String(value).trim();
      }

      function normalizeLower(value) {
        return normalizeText(value).toLowerCase();
      }

      function normalizeLevelKey(value) {
        return normalizeLower(value).replace(/[^a-z0-9]/g, "");
      }

      function normalizeAssetUrl(value = "") {
        const raw = normalizeText(value);
        if (!raw || /^data:/i.test(raw) || /^blob:/i.test(raw) || /^https?:\/\//i.test(raw)) return raw;
        if (/^javascript:/i.test(raw)) return "";
        return `/${raw.replace(/^\/+/, "")}`;
      }

      function escapeHtml(value) {
        return normalizeText(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function apiUrl(path) {
        if (!API_ORIGIN) return path;
        return `${API_ORIGIN}${path}`;
      }

      function buildAdminLoginHref() {
        const url = new URL("/admin", window.location.origin);
        if (API_ORIGIN) url.searchParams.set("apiOrigin", API_ORIGIN);
        return `${url.pathname}${url.search}${url.hash}`;
      }

      function buildAdminRuntimeHref(pathname = "/admin") {
        const url = new URL(normalizeText(pathname) || "/admin", window.location.origin);
        if (API_ORIGIN) url.searchParams.set("apiOrigin", API_ORIGIN);
        return `${url.pathname}${url.search}${url.hash}`;
      }

      function syncAdminNavLinks() {
        document.querySelectorAll('a[href^="/admin"]').forEach((linkEl) => {
          const href = normalizeText(linkEl.getAttribute("href"));
          if (!href) return;
          linkEl.setAttribute("href", buildAdminRuntimeHref(href));
        });
      }

      function redirectToAdminLogin() {
        window.location.replace(buildAdminLoginHref());
      }

      async function api(path, options = {}) {
        const response = await fetch(apiUrl(path), {
          method: options.method || "GET",
          headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {}),
          },
          credentials: "include",
          cache: "no-store",
          body: options.body ? JSON.stringify(options.body) : undefined,
        });
        const text = await response.text();
        let payload = {};
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch {
            payload = {};
          }
        }
        if (!response.ok) {
          const error = new Error(
            payload?.error || payload?.message || `Request failed (${response.status})`,
          );
          error.status = response.status;
          throw error;
        }
        return payload;
      }

      function setStatus(message, isError = false) {
        window.SIS_ACTION_FEEDBACK?.status(normalizeText(message), isError);
        const el = document.getElementById("globalStatus");
        if (!el) return;
        el.textContent = normalizeText(message);
        el.classList.toggle("is-error", Boolean(isError));
      }

      function handleAuthError(error) {
        if (!(error && error.status === 401)) return false;
        redirectToAdminLogin();
        return true;
      }

      function syncNavigationMenuState() {
        const floatingMenuBtnEl = document.getElementById("floatingMenuBtn");
        const menuOpen = document.body.classList.contains("menu-open");
        if (floatingMenuBtnEl) {
          floatingMenuBtnEl.setAttribute("aria-expanded", menuOpen ? "true" : "false");
          floatingMenuBtnEl.setAttribute(
            "aria-label",
            menuOpen ? "Close navigation menu" : "Open navigation menu",
          );
        }
      }

      function toggleNavigationMenu(forceOpen = null) {
        const nextOpen =
          forceOpen === null ? !document.body.classList.contains("menu-open") : Boolean(forceOpen);
        document.body.classList.toggle("menu-open", nextOpen);
        syncNavigationMenuState();
      }

      function setAuthenticated(authenticated) {
        document.getElementById("sessionRequiredPanel")?.classList.toggle("hidden", authenticated);
        document.getElementById("app")?.classList.toggle("hidden", !authenticated);
        document.getElementById("logoutBtn")?.classList.toggle("hidden", !authenticated);
        if (!authenticated) toggleNavigationMenu(false);
      }

      function reasonLabel(value) {
        return normalizeText(value).replaceAll("_", " ");
      }

      function shiftHexColor(hexColor, delta = 0) {
        const parts = String(hexColor || "").match(/[0-9a-f]{2}/gi);
        if (!parts || parts.length < 3) return "#1b3f75";
        const shift = (part) => Math.max(0, Math.min(255, Number.parseInt(part, 16) + delta));
        return `#${parts.slice(0, 3).map((part) => shift(part).toString(16).padStart(2, "0")).join("")}`;
      }

      function toRgba(hexColor, alpha = 1) {
        const parts = String(hexColor || "").match(/[0-9a-f]{2}/gi);
        if (!parts || parts.length < 3) return `rgba(27, 63, 117, ${alpha})`;
        const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseInt(part, 16));
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }

      function preferredContrastText(hexColor) {
        const parts = String(hexColor || "").match(/[0-9a-f]{2}/gi);
        if (!parts || parts.length < 3) return "#f5f8ff";
        const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseInt(part, 16) / 255);
        const transform = (value) =>
          value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        const luminance = 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
        return luminance > 0.45 ? "#0b1220" : "#f5f8ff";
      }

      function buildChipStyle(color) {
        const borderColor = shiftHexColor(color, -42);
        const textColor = normalizeText(color).toLowerCase() === "#038e9f" ? "#fbffff" : preferredContrastText(color);
        return `--chip-bg:${color};--chip-border:${borderColor};--chip-dot:${toRgba(textColor, 0.95)};--chip-text:${textColor};`;
      }

      function chipHtml(label = "", color = "#002786") {
        return `<span class="level-chip level-chip-standard" style="${buildChipStyle(color)}">${escapeHtml(label)}</span>`;
      }

      function levelChipHtml(levelName = "") {
        const normalizedLevel = normalizeText(levelName || "Unassigned");
        const levelColor = LEVEL_THEME_LOOKUP.get(normalizeLevelKey(normalizedLevel)) || "#002786";
        return chipHtml(normalizedLevel, levelColor);
      }

      function levelTileConfig(levelName = "") {
        const key = normalizeLevelKey(levelName);
        const source = levelTileStylesByLevel && typeof levelTileStylesByLevel === "object"
          ? levelTileStylesByLevel
          : {};
        const raw = source[levelName] || source[key] || Object.entries(source).find(([label]) => normalizeLevelKey(label) === key)?.[1] || {};
        const fallbackColor = LEVEL_THEME_LOOKUP.get(key) || "#1d4999";
        const bgColor = normalizeText(raw?.bgColor || raw?.backgroundColor || fallbackColor) || fallbackColor;
        const assetKey = normalizeText(raw?.assetKey || "");
        const imageDataUrl = assetKey
          ? `${ADMIN_ASSETS_PATH}/raw/${encodeURIComponent(assetKey)}`
          : normalizeAssetUrl(raw?.imageDataUrl || raw?.backgroundImage || "");
        const title = normalizeText(raw?.title || "");
        return { assetKey, bgColor, imageDataUrl, title };
      }

      function renderLevelTiles(levels = []) {
        const tilesEl = document.getElementById("enrollmentLevelTiles");
        const hintEl = document.getElementById("enrollmentLevelTilesHint");
        if (!tilesEl) return;
        const selected = normalizeText(document.getElementById("filterLevel")?.value || "");
        const available = Array.from(new Set([...KNOWN_LEVELS, ...levels.filter(Boolean)]));
        tilesEl.innerHTML = "";
        available.forEach((level) => {
          const config = levelTileConfig(level);
          const tile = document.createElement("button");
          tile.type = "button";
          tile.className = "enrollment-level-tile";
          tile.setAttribute("role", "listitem");
          tile.setAttribute("data-level", level);
          tile.setAttribute("aria-label", `Filter enrollment by ${level}`);
          tile.setAttribute("aria-pressed", normalizeLower(selected) === normalizeLower(level) ? "true" : "false");
          tile.classList.toggle("is-active", normalizeLower(selected) === normalizeLower(level));
          tile.style.backgroundColor = config.bgColor;
          tile.style.color = preferredContrastText(config.bgColor);
          if (config.imageDataUrl) {
            const safeUrl = config.imageDataUrl.replace(/"/g, "%22");
            tile.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, .12), rgba(0, 0, 0, .12)), url("${safeUrl}")`;
          }
          tile.addEventListener("click", () => {
            const select = document.getElementById("filterLevel");
            if (select instanceof HTMLSelectElement) select.value = level;
            loadRows().catch((error) => {
              if (handleAuthError(error)) return;
              setStatus(error?.message || error, true);
            });
          });
          tilesEl.appendChild(tile);
        });
        if (hintEl) hintEl.textContent = `${available.length} class levels available. Tile colors and artwork come from saved System Config settings.`;
      }

      function currentLevelText(row) {
        return normalizeText(
          row?.profile?.currentGrade || row?.currentEnrollment?.level || historyPeriods(row)[0]?.level || ""
        );
      }

      function currentStatusText(row) {
        if (!row?.currentEnrollment) return "Needs enrollment";
        return normalizeLower(row?.currentEnrollment?.status || "active") === "unenrolled"
          ? "Unenrolled"
          : "Enrolled";
      }

      function currentStatusChipHtml(row) {
        if (!row?.currentEnrollment) return chipHtml("Needs enrollment", "#8a5a00");
        return normalizeLower(row?.currentEnrollment?.status || "active") === "unenrolled"
          ? chipHtml("Unenrolled", "#ad2c3c")
          : chipHtml("Enrolled", "#287a4f");
      }

      function currentSchoolYearText(row) {
        return normalizeText(row?.currentEnrollment?.schoolYear || historyPeriods(row)[0]?.schoolYear || "");
      }

      function currentSchoolYearChipHtml(row) {
        const schoolYear = currentSchoolYearText(row);
        return schoolYear ? chipHtml(schoolYear, "#2d78b4") : "";
      }

      function enrollmentStatusChipHtml(statusValue = "") {
        return normalizeLower(statusValue || "active") === "unenrolled"
          ? chipHtml("Unenrolled", "#ad2c3c")
          : chipHtml("Enrolled", "#287a4f");
      }

      function historyPeriods(row) {
        return Array.isArray(row?.enrollmentPeriods) ? row.enrollmentPeriods : [];
      }

      function formatHistoryDate(value) {
        const raw = normalizeText(value);
        if (!raw) return "";
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.valueOf())) return "";
        const day = String(parsed.getDate()).padStart(2, "0");
        const month = String(parsed.getMonth() + 1).padStart(2, "0");
        const year = String(parsed.getFullYear());
        return `${day}/${month}/${year}`;
      }

      function buildHistoryNote(row) {
        const periods = historyPeriods(row);
        if (!periods.length) return "";
        const currentPeriod = periods[0] || null;
        if (!currentPeriod) return "";
        const byId = new Map(periods.map((period) => [normalizeText(period?.id), period]));
        const previousPeriod = byId.get(normalizeText(currentPeriod?.promotedFromPeriodId || ""));
        const effectiveDate = formatHistoryDate(currentPeriod?.startedAt || currentPeriod?.createdAt);
        const dateSuffix = effectiveDate ? ` on ${effectiveDate}` : "";
        const currentLevel = normalizeText(currentPeriod?.level || "");
        const previousLevel = normalizeText(previousPeriod?.level || "");

        if (previousLevel && currentLevel && normalizeLower(previousLevel) !== normalizeLower(currentLevel)) {
          return `Student was promoted from ${previousLevel} to ${currentLevel}${dateSuffix}.`;
        }
        return "";
      }

      function enrollmentHistoryPeriodHtml(period = {}) {
        const headChips = [
          period?.schoolYear ? chipHtml(period.schoolYear, "#2d78b4") : "",
          period?.status ? enrollmentStatusChipHtml(period.status) : "",
          period?.level ? levelChipHtml(period.level) : "",
        ].filter(Boolean);
        const noteLines = [
          normalizeText(period?.unenrollmentReason) ? `Unenrollment reason: ${reasonLabel(period.unenrollmentReason)}` : "",
          normalizeText(period?.comment) ? `HX note: ${period.comment}` : "",
        ].filter(Boolean);
        return `
          <article class="enrollment-history-period portal-theme-card card" data-surface-role="card">
            <div class="enrollment-history-period__head">${headChips.join("")}</div>
            <div class="enrollment-history-period__meta">
              ${noteLines.map((line) => `<p class="enrollment-history-period__note">${escapeHtml(line)}</p>`).join("")}
            </div>
          </article>
        `;
      }

      function enrollmentHistoryModalHtml(row = {}) {
        const periods = historyPeriods(row);
        const note = buildHistoryNote(row);
        const fallback = periods.length
          ? periods.map((period) => enrollmentHistoryPeriodHtml(period)).join("")
          : '<p class="enrollment-history-empty">No history is recorded for this student.</p>';
        return `
          ${note ? `<p class="enrollment-history-modal__summary">${escapeHtml(note)}</p>` : ""}
          <div class="enrollment-history-modal__list">
            ${fallback}
          </div>
        `;
      }

      function historyRailHtml(row = {}) {
        const studentName = normalizeText(row?.profile?.fullName || row?.profile?.englishName || row?.eaglesId || "Student");
        return `
          <div class="history-rail">
            <button type="button" class="history-rail__button" data-history-toggle data-button-tooltip-title="menu" aria-haspopup="menu" aria-expanded="false" aria-label="Open history menu for ${escapeHtml(studentName)}">
              <span class="history-rail__dots" aria-hidden="true">⋮</span>
            </button>
            <div class="history-rail__menu hidden" data-history-menu role="menu" aria-label="History actions">
              <button type="button" class="portal-button portal-button-info" data-history-open role="menuitem">Notes</button>
            </div>
          </div>
        `;
      }

      function renderLevelOptions(select, selected = "") {
        if (!(select instanceof HTMLSelectElement)) return;
        select.innerHTML = '<option value="">Select level</option>';
        KNOWN_LEVELS.forEach((level) => {
          const option = document.createElement("option");
          option.value = level;
          option.textContent = level;
          if (normalizeText(selected) === level) option.selected = true;
          select.appendChild(option);
        });
      }

      function renderReasonOptions(select, selected = "") {
        if (!(select instanceof HTMLSelectElement)) return;
        select.innerHTML = '<option value="">Select reason</option>';
        ENROLLMENT_REASONS.forEach((reason) => {
          const option = document.createElement("option");
          option.value = reason;
          option.textContent = reasonLabel(reason);
          if (normalizeText(selected) === reason) option.selected = true;
          select.appendChild(option);
        });
      }

      function renderLevelFilterOptions(levels = []) {
        const select = document.getElementById("filterLevel");
        if (!(select instanceof HTMLSelectElement)) return;
        const current = normalizeText(select.value);
        select.innerHTML = '<option value="">All levels</option>';
        Array.from(new Set([...KNOWN_LEVELS, ...levels.filter(Boolean)])).forEach((level) => {
          const option = document.createElement("option");
          option.value = level;
          option.textContent = level;
          if (current === level) option.selected = true;
          select.appendChild(option);
        });
        const unenrolled = document.createElement("option");
        unenrolled.value = UNENROLLED_ONLY;
        unenrolled.textContent = "Unenrolled only";
        if (current === UNENROLLED_ONLY) unenrolled.selected = true;
        select.appendChild(unenrolled);
      }

      function updateSummary(rows = []) {
        const activeRows = rows.filter((row) => normalizeLower(row?.currentEnrollment?.status || "active") !== "unenrolled").length;
        const unenrolledRows = rows.length - activeRows;
        const visibleEl = document.getElementById("summaryVisibleRows");
        const activeEl = document.getElementById("summaryActiveRows");
        const unenrolledEl = document.getElementById("summaryUnenrolledRows");
        if (visibleEl) visibleEl.textContent = String(rows.length);
        if (activeEl) activeEl.textContent = String(activeRows);
        if (unenrolledEl) unenrolledEl.textContent = String(unenrolledRows);
      }

      async function loadRows() {
        const params = new URLSearchParams();
        const query = normalizeText(document.getElementById("searchQ")?.value || "");
        const level = normalizeText(document.getElementById("filterLevel")?.value || "");
        const includeUnenrolled = Boolean(document.getElementById("includeUnenrolled")?.checked);
        if (query) params.set("q", query);
        if (level) params.set("level", level);
        if (includeUnenrolled) params.set("includeUnenrolled", "true");
        params.set("take", "1000");

        const data = await api(`${ENROLLMENT_STUDENTS_PATH}?${params.toString()}`);
        const rows = Array.isArray(data?.items) ? data.items : [];
        enrollmentRowsCache = rows;
        renderLevelFilterOptions(rows.map((row) => currentLevelText(row)).filter(Boolean));
        renderLevelTiles(rows.map((row) => currentLevelText(row)).filter(Boolean));
        renderRows(rows);
        updateSummary(rows);
        setStatus("");
      }

      function setEnrollmentHistoryModalOpen(isOpen, row = null) {
        const modal = document.getElementById("enrollmentHistoryModal");
        const title = document.getElementById("enrollmentHistoryModalTitle");
        const summary = document.getElementById("enrollmentHistoryModalSummary");
        const body = document.getElementById("enrollmentHistoryModalBody");
        if (!(modal instanceof HTMLElement)) return;

        if (isOpen) {
          const studentName = normalizeText(row?.profile?.fullName || row?.profile?.englishName || row?.eaglesId || "Student");
          const schoolYear = currentSchoolYearText(row) || "Unknown school year";
          if (title instanceof HTMLElement) title.textContent = studentName;
          if (summary instanceof HTMLElement) {
            const currentStatus = currentStatusText(row);
            summary.textContent = `Current status: ${currentStatus}. School year: ${schoolYear}.`;
          }
          if (body instanceof HTMLElement) body.innerHTML = enrollmentHistoryModalHtml(row);
          modal.classList.remove("hidden");
          modal.setAttribute("aria-hidden", "false");
          document.body.classList.add("modal-open");
          enrollmentHistoryModalReturnFocus =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          const closeButton = modal.querySelector("[data-history-close]");
          if (closeButton instanceof HTMLElement) closeButton.focus();
          return;
        }

        const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (activeElement && modal.contains(activeElement)) {
          activeElement.blur();
        }
        if (enrollmentHistoryModalReturnFocus instanceof HTMLElement && !modal.contains(enrollmentHistoryModalReturnFocus)) {
          enrollmentHistoryModalReturnFocus.focus();
        }
        modal.classList.add("hidden");
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");
        enrollmentHistoryModalReturnFocus = null;
      }

      function openEnrollmentHistoryModal(row) {
        closeHistoryRailMenu();
        setEnrollmentHistoryModalOpen(true, row);
      }

      function closeEnrollmentHistoryModal() {
        setEnrollmentHistoryModalOpen(false);
      }

      function closeHistoryRailMenu(menuEl = openHistoryRailMenu) {
        if (!(menuEl instanceof HTMLElement)) return;
        menuEl.classList.add("hidden");
        const railEl = menuEl.closest(".history-rail");
        const toggleButton = railEl?.querySelector("[data-history-toggle]");
        if (toggleButton instanceof HTMLButtonElement) {
          toggleButton.setAttribute("aria-expanded", "false");
        }
        if (openHistoryRailMenu === menuEl) {
          openHistoryRailMenu = null;
        }
      }

      function toggleHistoryRailMenu(toggleButton) {
        if (!(toggleButton instanceof HTMLButtonElement)) return;
        const railEl = toggleButton.closest(".history-rail");
        const menuEl = railEl?.querySelector("[data-history-menu]");
        if (!(menuEl instanceof HTMLElement)) return;
        if (openHistoryRailMenu && openHistoryRailMenu !== menuEl) {
          closeHistoryRailMenu(openHistoryRailMenu);
        }
        const isOpen = !menuEl.classList.contains("hidden");
        if (isOpen) {
          closeHistoryRailMenu(menuEl);
          return;
        }
        menuEl.classList.remove("hidden");
        toggleButton.setAttribute("aria-expanded", "true");
        openHistoryRailMenu = menuEl;
      }

      function bindEnrollmentHistoryModalDismiss() {
        const modal = document.getElementById("enrollmentHistoryModal");
        if (!(modal instanceof HTMLElement)) return;
        modal.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          if (target.matches("[data-history-close]")) {
            closeEnrollmentHistoryModal();
          }
        });
      }

      function bindHistoryRailDismiss() {
        document.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const toggleButton = target.closest("[data-history-toggle]");
          if (toggleButton instanceof HTMLButtonElement) {
            toggleHistoryRailMenu(toggleButton);
            return;
          }
          const openButton = target.closest("[data-history-open]");
          if (openButton instanceof HTMLButtonElement) {
            const rowEl = openButton.closest("tr");
            const rowData = rowEl?.__sisRowData || null;
            closeHistoryRailMenu();
            if (rowData) openEnrollmentHistoryModal(rowData);
            return;
          }
          if (openHistoryRailMenu) {
            const railEl = openHistoryRailMenu.closest(".history-rail");
            if (!railEl?.contains(target)) {
              closeHistoryRailMenu();
            }
          }
        });
      }

      function syncExpandableTextareaHeight(textarea) {
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        textarea.style.height = "auto";
        textarea.style.height = `${Math.max(textarea.scrollHeight, 46)}px`;
      }

      function renderRows(rows = []) {
        const tbody = document.getElementById("enrollmentRows");
        if (!(tbody instanceof HTMLTableSectionElement)) return;
        enrollmentRowsCache = rows;
        closeHistoryRailMenu();
        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="3" class="table-empty">No students match current enrollment filters.</td></tr>';
          return;
        }
        tbody.innerHTML = "";
        rows.forEach((row) => {
          const tr = document.createElement("tr");
          tr.__sisRowData = row;
          tr.innerHTML = `
            <td data-label="Student">
              <div class="student-ident">
                <strong>${escapeHtml(row?.eaglesId || row?.profile?.englishName || row?.profile?.fullName || "")}</strong>
                <small>${escapeHtml(row?.profile?.fullName || row?.profile?.englishName || "")}</small>
                <small>#${escapeHtml(row?.studentNumber || "")}</small>
              </div>
            </td>
            <td data-label="Current status">
              <div class="status-cell-stack">
                <div class="status-chip-row">${currentStatusChipHtml(row)}${levelChipHtml(currentLevelText(row) || "Unassigned")}</div>
                <div class="status-chip-row status-chip-row--compact">${currentSchoolYearChipHtml(row) || chipHtml("Unknown", "#677892")}</div>
              </div>
            </td>
            <td data-label="Enrollment action">
              <div class="action-cell-layout">
                <div class="action-stack">
                  <div class="action-grid">
                  <select name="enrollmentAction" data-action aria-label="Enrollment action">
                    <option value="" selected disabled>Select action</option>
                    <option value="change-level">Change level</option>
                    <option value="promote">Promote</option>
                    <option value="unenroll">Unenroll</option>
                  </select>
                  <select name="enrollmentTargetLevel" data-level aria-label="Target level"></select>
                  <select name="enrollmentUnenrollmentReason" data-reason aria-label="Unenrollment reason"></select>
                  <button type="button" class="portal-button portal-button-affirm" data-apply>Apply</button>
                  <div class="action-comment-row">
                    <textarea name="enrollmentComment" data-comment class="comment-input action-comment" rows="1" placeholder="Comment" aria-label="Enrollment comment"></textarea>
                    ${historyRailHtml(row)}
                  </div>
                </div>
              </div>
              </div>
            </td>
          `;
          const levelSelect = tr.querySelector("[data-level]");
          const reasonSelect = tr.querySelector("[data-reason]");
          const actionSelect = tr.querySelector("[data-action]");
          const commentInput = tr.querySelector("[data-comment]");
          const applyButton = tr.querySelector("[data-apply]");
          renderLevelOptions(levelSelect, currentLevelText(row));
          renderReasonOptions(reasonSelect, "");
          const syncControls = () => {
            const action = normalizeText(actionSelect?.value || "");
            const isUnenroll = action === "unenroll";
            const hasAction = Boolean(action);
            if (levelSelect instanceof HTMLSelectElement) levelSelect.disabled = !hasAction || isUnenroll;
            if (reasonSelect instanceof HTMLSelectElement) reasonSelect.disabled = !isUnenroll;
            if (applyButton instanceof HTMLButtonElement) applyButton.disabled = !hasAction;
          };
          actionSelect?.addEventListener("change", syncControls);
          if (commentInput instanceof HTMLTextAreaElement) {
            syncExpandableTextareaHeight(commentInput);
            commentInput.addEventListener("input", () => syncExpandableTextareaHeight(commentInput));
          }
          syncControls();
          applyButton?.addEventListener("click", async () => {
            try {
              if (!(actionSelect instanceof HTMLSelectElement) || !normalizeText(actionSelect.value)) {
                setStatus("Select an enrollment action first.", true);
                return;
              }
              applyButton.disabled = true;
              const action = normalizeText(actionSelect?.value || "");
              await api(`/api/admin/students/${encodeURIComponent(row.id)}/enrollment`, {
                method: "POST",
                body: {
                  action,
                  level: normalizeText(levelSelect?.value || ""),
                  unenrollmentReason: normalizeText(reasonSelect?.value || ""),
                  comment: normalizeText(commentInput?.value || ""),
                },
              });
              const refreshed = await api(`/api/admin/students/${encodeURIComponent(row.id)}/enrollment`);
              if (refreshed?.student) {
                enrollmentRowsCache = enrollmentRowsCache.map((entry) =>
                  entry.id === row.id
                    ? {
                        ...entry,
                        ...refreshed.student,
                        profile: refreshed.student.profile || entry.profile,
                        currentEnrollment:
                          refreshed.currentEnrollment
                          || refreshed.student.currentEnrollment
                          || entry.currentEnrollment,
                        enrollmentPeriods:
                          Array.isArray(refreshed.student.enrollmentPeriods) && refreshed.student.enrollmentPeriods.length
                            ? refreshed.student.enrollmentPeriods
                            : entry.enrollmentPeriods,
                      }
                    : entry
                );
                renderRows(enrollmentRowsCache);
                updateSummary(enrollmentRowsCache);
              } else {
                await loadRows();
              }
              setStatus("Enrollment updated.");
            } catch (error) {
              if (handleAuthError(error)) return;
              setStatus(error?.message || error, true);
            } finally {
              applyButton.disabled = false;
            }
          });
          tbody.appendChild(tr);
        });
      }

      function normalizeSchoolLogoUrl(value = "") {
        const raw = normalizeText(value);
        if (!raw) return "";
        if (/^(?:data:|blob:|https?:|\/)/i.test(raw)) return raw;
        if (raw === "logo.svg" || raw === "images/logo.svg") {
          return "/web-asset/images/logo.svg";
        }
        if (raw.startsWith("web-asset/")) return `/${raw}`;
        return raw;
      }

      function normalizeSchoolProfile(source = {}) {
        const profile = source && typeof source === "object" && !Array.isArray(source)
          ? source
          : {};
        return {
          schoolName: normalizeText(profile.schoolName || DEFAULT_SCHOOL_PROFILE.schoolName),
          logoDataUrl: normalizeSchoolLogoUrl(
            profile.logoDataUrl || DEFAULT_SCHOOL_PROFILE.logoDataUrl,
          ),
        };
      }

      function schoolBrandFallbackToken(name = "") {
        const parts = normalizeText(name).split(/\s+/).filter(Boolean);
        if (!parts.length) return "SIS";
        return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "SIS";
      }

      function renderSchoolBranding(profile = DEFAULT_SCHOOL_PROFILE) {
        const normalizedProfile = normalizeSchoolProfile(profile);
        const schoolName = normalizedProfile.schoolName || DEFAULT_SCHOOL_PROFILE.schoolName;
        const logoDataUrl = normalizedProfile.logoDataUrl;
        const fallbackToken = schoolBrandFallbackToken(schoolName);
        const schoolNameEl = document.getElementById("appSchoolName");
        const imageTargets = [
          { imageId: "appBrandLogo", fallbackId: "appBrandLogoFallback" },
          { imageId: "sidebarLogoImg", fallbackId: "sidebarLogoFallback" },
        ];
        if (schoolNameEl) {
          schoolNameEl.textContent = schoolName.toUpperCase();
          schoolNameEl.title = schoolName;
        }
        const hasLogo = Boolean(logoDataUrl);
        imageTargets.forEach(({ imageId, fallbackId }) => {
          const imageEl = document.getElementById(imageId);
          const fallbackEl = document.getElementById(fallbackId);
          if (imageEl instanceof HTMLImageElement) {
            imageEl.classList.toggle("hidden", !hasLogo);
            imageEl.src = hasLogo ? logoDataUrl : "data:,";
          }
          if (fallbackEl) {
            fallbackEl.classList.toggle("hidden", hasLogo);
            fallbackEl.textContent = fallbackToken;
            fallbackEl.title = schoolName;
          }
        });
      }

      async function loadBranding() {
        try {
          const payload = await api(UI_SETTINGS_PATH);
          levelTileStylesByLevel = payload?.uiSettings?.levelTileStylesByLevel && typeof payload.uiSettings.levelTileStylesByLevel === "object"
            ? payload.uiSettings.levelTileStylesByLevel
            : {};
          renderSchoolBranding(payload?.uiSettings?.schoolProfile || DEFAULT_SCHOOL_PROFILE);
        } catch {
          levelTileStylesByLevel = {};
          renderSchoolBranding(DEFAULT_SCHOOL_PROFILE);
        }
      }

      function normalizeTextZoomPercent(value) {
        const numeric = Number.parseInt(value, 10);
        if (!Number.isFinite(numeric)) return TEXT_ZOOM_DEFAULT;
        return Math.max(TEXT_ZOOM_MIN, Math.min(TEXT_ZOOM_MAX, numeric));
      }

      function loadGlobalTextZoomFromStorage() {
        let stored = "";
        try {
          stored = normalizeText(window.SIS_PORTAL_PREFERENCES?.get(TEXT_ZOOM_STORAGE_KEY, ""));
        } catch {
          stored = "";
        }
        return normalizeTextZoomPercent(stored || TEXT_ZOOM_DEFAULT);
      }

      function persistGlobalTextZoomToStorage(value = state.globalTextZoomPercent) {
        const normalized = normalizeTextZoomPercent(value);
        state.globalTextZoomPercent = normalized;
        try {
          void window.SIS_PORTAL_PREFERENCES?.save(TEXT_ZOOM_STORAGE_KEY, String(normalized));
        } catch {
          void 0;
        }
        return normalized;
      }

      function applyGlobalTextZoom() {
        const percent = normalizeTextZoomPercent(state.globalTextZoomPercent);
        state.globalTextZoomPercent = percent;
        document.documentElement.style.setProperty("--sis-global-text-zoom", String(percent / 100));
        document.querySelectorAll("[data-text-zoom-label]").forEach((labelEl) => {
          labelEl.textContent = `${percent}%`;
        });
      }

      function updateGlobalTextZoom(action = "") {
        const mode = normalizeLower(action);
        let next = normalizeTextZoomPercent(state.globalTextZoomPercent);
        if (mode === "decrease") next -= TEXT_ZOOM_STEP;
        else if (mode === "increase") next += TEXT_ZOOM_STEP;
        else next = TEXT_ZOOM_DEFAULT;
        persistGlobalTextZoomToStorage(next);
        applyGlobalTextZoom();
        setStatus(`Global text size: ${next}%`);
      }

      function syncThemeToggle() {
        const theme = window.SIS_PORTAL_THEME?.getTheme("light") || "light";
        const button = document.getElementById("studentThemeToggle");
        const icon = document.getElementById("studentThemeToggleIcon");
        const label = null;
        const dark = theme === "dark";
        if (button) {
          button.setAttribute("aria-pressed", dark ? "true" : "false");
          button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
        }
        if (icon) icon.setAttribute("name", dark ? "theme-sun" : "theme-moon");
        if (label) label.textContent = dark ? "Light" : "Dark";
      }

      async function logout() {
        await api(`${ADMIN_AUTH_PREFIX}/logout`, { method: "POST" });
        setAuthenticated(false);
        updateSummary([]);
        setStatus("Signed out.");
      }

      const INITIAL_AUTH = window.__SIS_ADMIN_INITIAL_AUTH__ && typeof window.__SIS_ADMIN_INITIAL_AUTH__ === "object"
        ? window.__SIS_ADMIN_INITIAL_AUTH__
        : { authenticated: false };

      async function bootstrap() {
        state.globalTextZoomPercent = loadGlobalTextZoomFromStorage();
        applyGlobalTextZoom();
        renderSchoolBranding(DEFAULT_SCHOOL_PROFILE);
        syncThemeToggle();
        syncAdminNavLinks();
        if (INITIAL_AUTH.authenticated) {
          setAuthenticated(true);
          await loadBranding();
          await loadRows();
          return;
        }
        redirectToAdminLogin();
      }
      document.getElementById("logoutBtn")?.addEventListener("click", () => logout().catch((error) => {
        if (handleAuthError(error)) return;
        setStatus(error?.message || error, true);
      }));
      document.getElementById("floatingMenuBtn")?.addEventListener("click", () => {
        toggleNavigationMenu();
      });
      document.getElementById("menuBackdrop")?.addEventListener("click", () => {
        toggleNavigationMenu(false);
      });
      document.getElementById("refreshBtn")?.addEventListener("click", () => loadRows().catch((error) => {
        if (handleAuthError(error)) return;
        setStatus(error?.message || error, true);
      }));
      document.getElementById("searchQ")?.addEventListener("input", () => {
        window.clearTimeout(window.__sisEnrollmentSearchTimer || 0);
        window.__sisEnrollmentSearchTimer = window.setTimeout(() => {
          loadRows().catch((error) => {
            if (handleAuthError(error)) return;
            setStatus(error?.message || error, true);
          });
        }, 180);
      });
      document.getElementById("filterLevel")?.addEventListener("change", () => loadRows().catch((error) => {
        if (handleAuthError(error)) return;
        setStatus(error?.message || error, true);
      }));
      document.getElementById("enrollmentLevelAllBtn")?.addEventListener("click", () => {
        const select = document.getElementById("filterLevel");
        if (select instanceof HTMLSelectElement) select.value = "";
        loadRows().catch((error) => {
          if (handleAuthError(error)) return;
          setStatus(error?.message || error, true);
        });
      });
      document.getElementById("includeUnenrolled")?.addEventListener("change", () => loadRows().catch((error) => {
        if (handleAuthError(error)) return;
        setStatus(error?.message || error, true);
      }));
      [["studentTextZoomDownBtn", "decrease"], ["studentTextZoomUpBtn", "increase"], ["studentTextZoomResetBtn", "reset"]].forEach(([id, action]) => {
        document.getElementById(id)?.addEventListener("click", () => updateGlobalTextZoom(action));
      });
      document.getElementById("studentThemeToggle")?.addEventListener("click", () => {
        window.SIS_PORTAL_THEME?.toggleTheme("light");
        syncThemeToggle();
      });
      bindEnrollmentHistoryModalDismiss();
      bindHistoryRailDismiss();
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        const modal = document.getElementById("enrollmentHistoryModal");
        if (modal instanceof HTMLElement && !modal.classList.contains("hidden")) {
          closeEnrollmentHistoryModal();
        }
      });
      document.addEventListener("click", (event) => {
        if (!document.body.classList.contains("menu-open")) return;
        const target = event.target;
        const sidebarEl = document.getElementById("appSidebarNav");
        const floatingMenuBtnEl = document.getElementById("floatingMenuBtn");
        if (!(target instanceof Node)) return;
        if (sidebarEl?.contains(target)) return;
        if (floatingMenuBtnEl?.contains(target)) return;
        toggleNavigationMenu(false);
      });

      bootstrap().catch((error) => {
        if (handleAuthError(error)) return;
        setAuthenticated(false);
        setStatus(error?.message || error, true);
      });
    })();
