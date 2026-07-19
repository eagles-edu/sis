export function initAttendanceGradeControlsIsland({
  document,
  onAttendanceLevelStyleLevelChange,
  onAttendanceSave,
  onAttendanceLandingSaveAll,
  onAttendanceLandingReload,
  onAttendanceLevelApply,
  onAttendanceLevelClearImage,
  onAttendanceLevelReset,
  onAttendanceLevelImageChange,
  onAttendanceDateChange,
  onAttendanceQuarterChange,
  onAttendanceClear,
  onAttendanceSortFieldChange,
  onAttendanceSortDirToggle,
  onAttendanceDataSearchInput,
  onAttendanceArchiveToggle,
  onAttendanceExportXlsx,
  onAttendancePrintPdf,
  onPerformanceSortFieldChange,
  onPerformanceSortDirToggle,
  onPerformanceDataSearchInput,
  onPerformanceArchiveToggle,
  onPerformanceExportXlsx,
  onPerformancePrintPdf,
  onGradeSave,
  onGradeClear,
  onGradeSortFieldChange,
  onGradeSortDirToggle,
  onGradeDataSearchInput,
  onGradeArchiveToggle,
  onGradeExportXlsx,
  onGradePrintPdf,
  onOpenTabulatorGrades,
  onGradeChartLaneOpen,
  onGradeChartModalClose,
  onGradeChartModalBackdropClick,
  onGradeChartPeriodChange,
  onGradeChartGroupByChange,
  onGradeChartQuarterChange,
  onGradeChartSchoolYearChange,
  onGradeChartCustomRangeChange,
} = {}) {
  const view = document?.defaultView || null;
  const ElementCtor = view?.Element || null;
  const HTMLButtonElementCtor = view?.HTMLButtonElement || null;
  const HTMLInputElementCtor = view?.HTMLInputElement || null;
  const HTMLSelectElementCtor = view?.HTMLSelectElement || null;
  const HTMLDivElementCtor = view?.HTMLDivElement || null;
  const HTMLTextAreaElementCtor = view?.HTMLTextAreaElement || null;

  function isInstanceOf(value, ctor) {
    return typeof ctor === "function" && value instanceof ctor;
  }

  document?.getElementById("attendanceLevelStyleLevel")?.addEventListener("change", (event) => {
    if (typeof onAttendanceLevelStyleLevelChange === "function") {
      onAttendanceLevelStyleLevelChange(event?.target?.value || "");
    }
  });
  document?.getElementById("attendanceSaveBtn")?.addEventListener("click", () => {
    if (typeof onAttendanceSave === "function") onAttendanceSave();
  });
  document
    ?.getElementById("attendanceLandingSaveAllBtn")
    ?.addEventListener("click", () => {
      if (typeof onAttendanceLandingSaveAll === "function") onAttendanceLandingSaveAll();
    });
  document
    ?.getElementById("attendanceLandingReloadBtn")
    ?.addEventListener("click", () => {
      if (typeof onAttendanceLandingReload === "function") onAttendanceLandingReload();
    });
  document?.getElementById("attendanceLevelApplyBtn")?.addEventListener("click", () => {
    if (typeof onAttendanceLevelApply === "function") onAttendanceLevelApply();
  });
  document
    ?.getElementById("attendanceLevelClearImageBtn")
    ?.addEventListener("click", () => {
      if (typeof onAttendanceLevelClearImage === "function") onAttendanceLevelClearImage();
    });
  document?.getElementById("attendanceLevelResetBtn")?.addEventListener("click", () => {
    if (typeof onAttendanceLevelReset === "function") onAttendanceLevelReset();
  });
  document
    ?.getElementById("attendanceLevelImage")
    ?.addEventListener("change", (event) => {
      if (typeof onAttendanceLevelImageChange === "function") onAttendanceLevelImageChange(event);
    });
  document?.getElementById("a_date")?.addEventListener("change", () => {
    if (typeof onAttendanceDateChange === "function") onAttendanceDateChange();
  });
  document?.getElementById("a_quarter")?.addEventListener("change", () => {
    if (typeof onAttendanceQuarterChange === "function") onAttendanceQuarterChange();
  });
  document?.getElementById("attendanceClearBtn")?.addEventListener("click", () => {
    if (typeof onAttendanceClear === "function") onAttendanceClear();
  });
  document?.getElementById("attendanceSortField")?.addEventListener("change", (event) => {
    if (typeof onAttendanceSortFieldChange === "function") {
      onAttendanceSortFieldChange(event?.target?.value || "");
    }
  });
  document?.getElementById("attendanceSortDirBtn")?.addEventListener("click", () => {
    if (typeof onAttendanceSortDirToggle === "function") onAttendanceSortDirToggle();
  });
  document?.getElementById("attendanceDataSearch")?.addEventListener("input", (event) => {
    if (typeof onAttendanceDataSearchInput === "function") {
      onAttendanceDataSearchInput(event?.target?.value || "");
    }
  });
  document?.getElementById("attendanceArchiveToggleBtn")?.addEventListener("click", () => {
    if (typeof onAttendanceArchiveToggle === "function") onAttendanceArchiveToggle();
  });
  document?.getElementById("attendanceExportXlsxBtn")?.addEventListener("click", () => {
    if (typeof onAttendanceExportXlsx === "function") onAttendanceExportXlsx();
  });
  document?.getElementById("attendancePrintPdfBtn")?.addEventListener("click", () => {
    if (typeof onAttendancePrintPdf === "function") onAttendancePrintPdf();
  });

  document?.getElementById("performanceSortField")?.addEventListener("change", (event) => {
    if (typeof onPerformanceSortFieldChange === "function") {
      onPerformanceSortFieldChange(event?.target?.value || "");
    }
  });
  document?.getElementById("performanceSortDirBtn")?.addEventListener("click", () => {
    if (typeof onPerformanceSortDirToggle === "function") onPerformanceSortDirToggle();
  });
  document?.getElementById("performanceDataSearch")?.addEventListener("input", (event) => {
    if (typeof onPerformanceDataSearchInput === "function") {
      onPerformanceDataSearchInput(event?.target?.value || "");
    }
  });
  document?.getElementById("performanceArchiveToggleBtn")?.addEventListener("click", () => {
    if (typeof onPerformanceArchiveToggle === "function") onPerformanceArchiveToggle();
  });
  document?.getElementById("performanceExportXlsxBtn")?.addEventListener("click", () => {
    if (typeof onPerformanceExportXlsx === "function") onPerformanceExportXlsx();
  });
  document?.getElementById("performancePrintPdfBtn")?.addEventListener("click", () => {
    if (typeof onPerformancePrintPdf === "function") onPerformancePrintPdf();
  });

  document?.getElementById("gradeSaveBtn")?.addEventListener("click", () => {
    if (typeof onGradeSave === "function") onGradeSave();
  });
  document?.getElementById("gradeClearBtn")?.addEventListener("click", () => {
    if (typeof onGradeClear === "function") onGradeClear();
  });
  document?.getElementById("gradeSortField")?.addEventListener("change", (event) => {
    if (typeof onGradeSortFieldChange === "function") onGradeSortFieldChange(event?.target?.value || "");
  });
  document?.getElementById("gradeSortDirBtn")?.addEventListener("click", () => {
    if (typeof onGradeSortDirToggle === "function") onGradeSortDirToggle();
  });
  document?.getElementById("gradeDataSearch")?.addEventListener("input", (event) => {
    if (typeof onGradeDataSearchInput === "function") onGradeDataSearchInput(event?.target?.value || "");
  });
  document?.getElementById("gradeArchiveToggleBtn")?.addEventListener("click", () => {
    if (typeof onGradeArchiveToggle === "function") onGradeArchiveToggle();
  });
  document?.getElementById("gradeExportXlsxBtn")?.addEventListener("click", () => {
    if (typeof onGradeExportXlsx === "function") onGradeExportXlsx();
  });
  document?.getElementById("gradePrintPdfBtn")?.addEventListener("click", () => {
    if (typeof onGradePrintPdf === "function") onGradePrintPdf();
  });

  document?.getElementById("openTabulatorGradesBtn")?.addEventListener("click", () => {
    if (typeof onOpenTabulatorGrades === "function") onOpenTabulatorGrades();
  });

  document?.getElementById("gradeChartLanes")?.addEventListener("click", (event) => {
    const target = event?.target;
    if (!isInstanceOf(target, ElementCtor)) return;
    const openBtn = target.closest("button[data-grade-chart-open]");
    if (!isInstanceOf(openBtn, HTMLButtonElementCtor)) return;
    const laneKey = String(openBtn.getAttribute("data-grade-chart-open") || "");
    if (!laneKey) return;
    if (typeof onGradeChartLaneOpen === "function") onGradeChartLaneOpen(laneKey);
  });
  document?.getElementById("gradeChartModalCloseBtn")?.addEventListener("click", () => {
    if (typeof onGradeChartModalClose === "function") onGradeChartModalClose();
  });
  document?.getElementById("gradeChartModal")?.addEventListener("click", (event) => {
    if (typeof onGradeChartModalBackdropClick === "function") onGradeChartModalBackdropClick(event);
  });
  document?.addEventListener("keydown", (event) => {
    const modalEl = document?.getElementById("gradeChartModal");
    if (!isInstanceOf(modalEl, HTMLDivElementCtor)) return;
    if (modalEl.classList.contains("hidden")) return;
    if (String(event?.key || "") !== "Escape") return;
    const target = event?.target;
    if (isInstanceOf(target, HTMLInputElementCtor)) return;
    if (isInstanceOf(target, HTMLTextAreaElementCtor)) return;
    if (isInstanceOf(target, HTMLSelectElementCtor)) return;
    if (target?.isContentEditable) return;
    if (typeof onGradeChartModalClose === "function") onGradeChartModalClose();
  });
  document?.getElementById("gradeChartPeriods")?.addEventListener("click", (event) => {
    const target = event?.target;
    if (!isInstanceOf(target, ElementCtor)) return;
    const buttonEl = target.closest("[data-grade-chart-period]");
    if (!isInstanceOf(buttonEl, HTMLButtonElementCtor)) return;
    const period = String(buttonEl.getAttribute("data-grade-chart-period") || "");
    if (typeof onGradeChartPeriodChange === "function") onGradeChartPeriodChange(period);
  });
  document?.getElementById("gradeChartGroupBy")?.addEventListener("change", (event) => {
    if (typeof onGradeChartGroupByChange === "function") {
      onGradeChartGroupByChange(event?.target?.value || "");
    }
  });
  document?.getElementById("gradeChartQuarter")?.addEventListener("change", (event) => {
    if (typeof onGradeChartQuarterChange === "function") {
      onGradeChartQuarterChange(event?.target?.value || "");
    }
  });
  document?.getElementById("gradeChartSchoolYear")?.addEventListener("change", (event) => {
    if (typeof onGradeChartSchoolYearChange === "function") {
      onGradeChartSchoolYearChange(event?.target?.value || "");
    }
  });
  const applyGradeChartCustomRange = () => {
    let customFrom = String(document?.getElementById("gradeChartCustomFrom")?.value || "").slice(0, 10);
    let customTo = String(document?.getElementById("gradeChartCustomTo")?.value || "").slice(0, 10);
    if (customFrom && customTo && customFrom > customTo) {
      const swapped = customFrom;
      customFrom = customTo;
      customTo = swapped;
    }
    const fromEl = document?.getElementById("gradeChartCustomFrom");
    const toEl = document?.getElementById("gradeChartCustomTo");
    if (fromEl) fromEl.value = customFrom;
    if (toEl) toEl.value = customTo;
    if (typeof onGradeChartCustomRangeChange === "function") {
      onGradeChartCustomRangeChange(customFrom, customTo);
    }
  };
  document?.getElementById("gradeChartCustomFrom")?.addEventListener("change", applyGradeChartCustomRange);
  document?.getElementById("gradeChartCustomTo")?.addEventListener("change", applyGradeChartCustomRange);

  return {
    dispose() {},
  };
}
