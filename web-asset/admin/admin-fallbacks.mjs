// PERF-CONTRACT: ADMIN-FALLBACK-BOUNDARY
// Compatibility handlers load only when an island fails or the test harness requests them.
/* global document, window, Element, HTMLElement, HTMLButtonElement, HTMLDivElement, HTMLInputElement, HTMLSelectElement, HTMLTableRowElement, HTMLTextAreaElement */
export function initAdminFallbacks(deps = {}) {
  // The fallback boundary receives a shared dependency bag; unused entries are intentional.
  // eslint-disable-next-line no-unused-vars
  const { STUDENT_NEWS_REVIEW_STATUS_SUBMITTED, a, action, addAssignmentDraftItem, applyAttendanceLevelTileStyle, applyGradeChartCurrentQuarterDefault, applyGradeChartCurrentSchoolYearDefault, applyNewsReviewAction, applyNewsReviewBulkApprove, applyNewsReviewViewerAction, applyParentTrackingLessonSummaryFromMemory, applyParentTrackingRubricSummaryScores, applyProfileFieldLayoutChanges, applySortState, approved, assignments, attendance, autoFillSchoolSetupFromInputs, bindById, buildGradesTabulatorLaunchUrl, button, chart, clearAttendanceForm, clearAttendanceLevelTileImage, clearGradeForm, clearLevelReminderForm, clearParentTrackingActionShortcutInputs, clearParentTrackingForm, clearSchoolSetupLogoDraft, closeGradeChartModal, closeLevelDetailPanel, closeNewsReviewViewer, closeParentQueueModal, compareIsoDateText, createProfileFieldFromSettings, data, dayLabelFromIsoDate, deleteAssignmentTemplate, deleteProfileFieldFromLayout, deleteSelectedQueuedParentReports, dueAt, editParentQueueModalItem, editor, error, exportVisibleTableRowsToXlsx, field, fill, form, gradeChartCurrentSchoolYear, handleAttendanceLevelImageUpload, handleError, handleSchoolSetupLogoUpload, holdParentQueueModalItem, href, id, input, insertParentTrackingActionShortcut, key, loadAssignmentTemplatesFromServer, loadExerciseTitles, loadIncomingExerciseResults, loadNewsReviewQueue, loadParentReportQueue, loadPerformanceEngagementData, newsReviewViewerCurrentItem, nextSundayIsoDate, normalizeLower, normalizeNewsReviewFilters, normalizeText, normalizedGradeChartPeriod, open, openGradeChartModalForLaneKey, openNewsReviewViewerByWeekSetId, page, parentTrackingFieldSetValue, performanceDataSearch, persistAttendanceFormContext, previewSchoolSetupFromInputs, printVisibleTableRowsPdf, profile, quarter, queueParentTrackingEmail, refreshAssignmentStudentOptions, refreshAttendanceLanding, refreshAttendanceLandingRows, refreshNewsReviewFilterControls, refreshParentTracking, rememberParentTrackingLessonSummary, rememberParentTrackingRecommendationFocus, rememberParentTrackingTeacherName, renderAssignmentLevelTiles, renderAssignmentTemplates, renderGradePulseChart, renderParentQueueModal, renderPerformanceEngagementPage, renderPerformanceQueueSection, renderPerformanceStagedSection, renderProfileFieldLayoutEditor, renderSchoolSetupPanel, reports, requested, requeueParentQueueModalItem, rerenderSortedTable, resetAssignmentForm, resetAttendanceLevelTileStyle, resetParentTrackingManualMetricsTouched, resetProfileFieldLayoutToDefault, resetUiSettings, rows, saveAssignmentTemplate, saveAttendance, saveAttendanceLandingForSelectedLevel, saveGrade, saveParentTrackingReport, saveSchoolSetupFromInputs, saved, school, schoolSetupDraftForRender, section, select, selected, sendAllQueuedParentReports, sendAssignmentAnnouncement, sendLevelReminders, sendSelectedQueuedParentReports, setAssignmentStatus, setGradeChartState, setNewsReviewFilterValues, setNewsReviewViewerEditMode, setParentQueueSelectionForVisibleRows, setProfileFieldLayoutEditorExpanded, setProfileLayoutStatus, setStatus, setTableSearchTerm, setup, shiftNewsReviewViewer, state, syncAttendanceDateDerivedFields, syncAttendanceLevelEditorInputs, syncParentTrackingForSelection, textarea, toggleTableArchivedView, tr, unqueueSelectedQueuedParentReports, updateAttendanceQuarterWarning, values, week } = deps;

function bindNewsReviewIslandFallback() {
  const newsReviewStatusEl = document.getElementById("newsReviewStatusFilter");
  const newsReviewCheckEl = document.getElementById("newsReviewCheckFilter");
  const newsReviewLevelEl = document.getElementById("newsReviewLevelFilter");
  const newsReviewStudentEl = document.getElementById("newsReviewStudentFilter");
  const newsReviewDateFromEl = document.getElementById("newsReviewDateFromFilter");
  const newsReviewDateToEl = document.getElementById("newsReviewDateToFilter");
  const newsReviewQueryEl = document.getElementById("newsReviewQueryFilter");
  const newsReviewRowsEl = document.getElementById("newsReviewRows");
  newsReviewStatusEl?.addEventListener("change", () => {
    setNewsReviewFilterValues({
      status: normalizeText(newsReviewStatusEl.value) || "all",
    });
    loadNewsReviewQueue().catch(handleError);
  });
  newsReviewCheckEl?.addEventListener("change", () => {
    setNewsReviewFilterValues({
      setAction: normalizeText(newsReviewCheckEl.value) || "all",
    });
    loadNewsReviewQueue().catch(handleError);
  });
  newsReviewLevelEl?.addEventListener("change", () => {
    setNewsReviewFilterValues({
      level: newsReviewLevelEl.value,
      studentRefId: "",
    });
    loadNewsReviewQueue().catch(handleError);
  });
  newsReviewStudentEl?.addEventListener("change", () => {
    setNewsReviewFilterValues({ studentRefId: newsReviewStudentEl.value });
    loadNewsReviewQueue().catch(handleError);
  });
  const applyNewsReviewDateRange = () => {
    let fromIso = normalizeText(newsReviewDateFromEl?.value).slice(0, 10);
    let toIso = normalizeText(newsReviewDateToEl?.value).slice(0, 10);
    if (fromIso && toIso && compareIsoDateText(fromIso, toIso) > 0) {
      const swapped = fromIso;
      fromIso = toIso;
      toIso = swapped;
      if (newsReviewDateFromEl) newsReviewDateFromEl.value = fromIso;
      if (newsReviewDateToEl) newsReviewDateToEl.value = toIso;
    }
    setNewsReviewFilterValues({ dateFrom: fromIso, dateTo: toIso });
    loadNewsReviewQueue().catch(handleError);
  };
  newsReviewDateFromEl?.addEventListener("change", applyNewsReviewDateRange);
  newsReviewDateToEl?.addEventListener("change", applyNewsReviewDateRange);
  newsReviewQueryEl?.addEventListener("input", () => {
    setNewsReviewFilterValues({ query: newsReviewQueryEl.value });
    loadNewsReviewQueue().catch(handleError);
  });
  document.getElementById("newsReviewRefreshBtn")?.addEventListener("click", () => {
    loadNewsReviewQueue({ notify: true }).catch(handleError);
  });
  document
    .getElementById("newsReviewClearFiltersBtn")
    ?.addEventListener("click", () => {
      state.newsReview.filters = normalizeNewsReviewFilters({
        status: "all",
        setAction: "all",
        level: "",
        studentRefId: "",
        dateFrom: "",
        dateTo: "",
        query: "",
        take: state.newsReview?.filters?.take || 200,
      });
      refreshNewsReviewFilterControls();
      loadNewsReviewQueue({ notify: true }).catch(handleError);
    });
  document
    .getElementById("newsReviewApproveQueueBtn")
    ?.addEventListener("click", () => {
      applyNewsReviewBulkApprove().catch(handleError);
    });
  newsReviewRowsEl?.addEventListener("click", (event) => {
    const target = event?.target;
    if (!(target instanceof Element)) return;
    if (target.closest("a[href]")) return;

    const openBtn = target.closest("button[data-news-review-open-week-set]");
    if (openBtn instanceof HTMLButtonElement) {
      const weekSetId = normalizeText(
        openBtn.getAttribute("data-news-review-open-week-set"),
      );
      const reportId = normalizeText(
        openBtn.getAttribute("data-news-review-open-report"),
      );
      if (!weekSetId) return;
      openNewsReviewViewerByWeekSetId(weekSetId, { reportId }).catch(handleError);
      return;
    }

    const rowEl = target.closest("tr[data-news-review-week-set-id]");
    if (rowEl instanceof HTMLTableRowElement) {
      const weekSetId = normalizeText(rowEl.dataset.newsReviewWeekSetId);
      if (!weekSetId) return;
      openNewsReviewViewerByWeekSetId(weekSetId).catch(handleError);
    }
  });
  document
    .getElementById("newsReviewViewerCloseBtn")
    ?.addEventListener("click", () => closeNewsReviewViewer());
  document
    .getElementById("newsReviewViewerEditBtn")
    ?.addEventListener("click", () => {
      const activeReport = newsReviewViewerCurrentItem();
      if (!activeReport) return;
      if (
        (normalizeLower(normalizeText(activeReport?.reviewStatus)) ||
          STUDENT_NEWS_REVIEW_STATUS_SUBMITTED) ===
        "approved"
      ) {
        return;
      }
      setNewsReviewViewerEditMode(!state.newsReview.viewerEditMode);
    });
  document
    .getElementById("newsReviewViewerSaveBtn")
    ?.addEventListener("click", () => {
      applyNewsReviewAction(
        normalizeText(newsReviewViewerCurrentItem()?.id),
        "save",
        {
          keepViewerOpen: true,
        },
      ).catch(handleError);
    });
  document
    .getElementById("newsReviewViewerPrevBtn")
    ?.addEventListener("click", () => shiftNewsReviewViewer(-1));
  document
    .getElementById("newsReviewViewerNextBtn")
    ?.addEventListener("click", () => shiftNewsReviewViewer(1));
  document
    .getElementById("newsReviewViewerApproveBtn")
    ?.addEventListener("click", () => {
      applyNewsReviewViewerAction("approve").catch(handleError);
    });
  document
    .getElementById("newsReviewViewerRevisionBtn")
    ?.addEventListener("click", () => {
      applyNewsReviewViewerAction("revision-requested").catch(handleError);
    });
  document
    .getElementById("newsReviewViewerModal")
    ?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeNewsReviewViewer();
    });
  document.addEventListener("keydown", (event) => {
    const modalEl = document.getElementById("newsReviewViewerModal");
    if (!(modalEl instanceof HTMLDivElement)) return;
    if (modalEl.classList.contains("hidden")) return;
    const key = normalizeText(event.key);
    if (key !== "ArrowLeft" && key !== "ArrowRight") return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      const tagName = normalizeLower(target.tagName);
      if (
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target.isContentEditable
      )
        return;
    }
    event.preventDefault();
    shiftNewsReviewViewer(key === "ArrowLeft" ? -1 : 1);
  });
}

function bindSchoolSetupBrandingFallback() {
  document
    .getElementById("schoolSetupStartDate")
    ?.addEventListener("input", previewSchoolSetupFromInputs);
  document
    .getElementById("schoolSetupStartDate")
    ?.addEventListener("change", previewSchoolSetupFromInputs);
  document
    .getElementById("schoolSetupEndDate")
    ?.addEventListener("input", previewSchoolSetupFromInputs);
  document
    .getElementById("schoolSetupEndDate")
    ?.addEventListener("change", previewSchoolSetupFromInputs);
  document
    .getElementById("schoolSetupLetterGradeRanges")
    ?.addEventListener("input", previewSchoolSetupFromInputs);
  document
    .getElementById("schoolSetupLetterGradeRanges")
    ?.addEventListener("change", previewSchoolSetupFromInputs);
  document
    .getElementById("schoolSetupAutoFillBtn")
    ?.addEventListener("click", () => {
      try {
        autoFillSchoolSetupFromInputs();
        setStatus("Quarter rows auto-filled.");
      } catch (error) {
        const statusEl = document.getElementById("schoolSetupStatus");
        if (statusEl) {
          statusEl.style.color = "#b3262d";
          statusEl.textContent = error.message || "Unable to auto-fill quarter rows.";
        }
        setStatus(error.message || "Unable to auto-fill quarter rows.", true);
      }
    });
  [
    "schoolSetupNewsSourceDefaultCnn",
    "schoolSetupNewsSourceDefaultBbc",
    "schoolSetupNewsSourceCustom1Enabled",
    "schoolSetupNewsSourceCustom2Enabled",
    "schoolSetupNewsSourceCustom3Enabled",
    "schoolSetupNewsSourceCustom4Enabled",
    "schoolSetupNewsSourceCustom5Enabled",
    "schoolSetupNewsSourceCustom6Enabled",
    "schoolSetupNewsSourceCustom7Enabled",
    "schoolSetupNewsSourceCustom8Enabled",
    "schoolSetupNewsSourceCustom1Domain",
    "schoolSetupNewsSourceCustom2Domain",
    "schoolSetupNewsSourceCustom3Domain",
    "schoolSetupNewsSourceCustom4Domain",
    "schoolSetupNewsSourceCustom5Domain",
    "schoolSetupNewsSourceCustom6Domain",
    "schoolSetupNewsSourceCustom7Domain",
    "schoolSetupNewsSourceCustom8Domain",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", previewSchoolSetupFromInputs);
  });
  document
    .getElementById("schoolSetupLogoFile")
    ?.addEventListener("change", (event) => {
      handleSchoolSetupLogoUpload(event).catch((error) => {
        const draft = schoolSetupDraftForRender();
        renderSchoolSetupPanel({
          setup: draft.setup,
          profile: draft.profile,
          newsReportValidation: draft.newsReportValidation,
          message: error.message || "Unable to process school logo.",
          isError: true,
        });
        setStatus(error.message || "Unable to process school logo.", true);
      });
    });
  document
    .getElementById("schoolSetupLogoClearBtn")
    ?.addEventListener("click", () => {
      try {
        clearSchoolSetupLogoDraft();
        setStatus("School logo cleared from draft.");
      } catch (error) {
        setStatus(error.message || "Unable to clear school logo draft.", true);
      }
    });
  document.getElementById("schoolSetupSaveBtn")?.addEventListener("click", () => {
    saveSchoolSetupFromInputs({ notify: true })
      .then(() => {
        syncAttendanceDateDerivedFields();
        rerenderSortedTable("attendance");
        rerenderSortedTable("performance");
        rerenderSortedTable("grades");
        rerenderSortedTable("reports");
      })
      .catch(handleError);
  });
  document.getElementById("schoolSetupResetBtn")?.addEventListener("click", () => {
    resetUiSettings()
      .then(() => {
        const logoFileEl = document.getElementById("schoolSetupLogoFile");
        if (logoFileEl) logoFileEl.value = "";
        syncAttendanceDateDerivedFields();
        setStatus("School setup reloaded from saved values.");
      })
      .catch(handleError);
  });
  document
    .getElementById("profileFieldLayoutApplyBtn")
    ?.addEventListener("click", () => {
      try {
        applyProfileFieldLayoutChanges();
      } catch (error) {
        handleError(error);
      }
    });
  document
    .getElementById("profileFieldLayoutResetBtn")
    ?.addEventListener("click", () => {
      try {
        resetProfileFieldLayoutToDefault();
      } catch (error) {
        handleError(error);
      }
    });
  document
    .getElementById("profileFieldLayoutRefreshBtn")
    ?.addEventListener("click", () => {
      renderProfileFieldLayoutEditor();
      setProfileLayoutStatus("Layout editor reloaded.");
    });
  document
    .getElementById("profileFieldLayoutExpandBtn")
    ?.addEventListener("click", () => {
      setProfileFieldLayoutEditorExpanded(!state.profileLayoutExpanded);
    });
  document
    .getElementById("profileFieldCreateBtn")
    ?.addEventListener("click", () => {
      try {
        createProfileFieldFromSettings();
      } catch (error) {
        handleError(error);
      }
    });
  document
    .getElementById("profileFieldLayoutRows")
    ?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("[data-profile-layout-action]");
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.dataset.profileLayoutAction !== "delete") return;
      const row = button.closest("tr[data-profile-field-key]");
      if (!(row instanceof HTMLTableRowElement)) return;
      deleteProfileFieldFromLayout(row.dataset.profileFieldKey || "");
    });
}

function bindAssignmentControlsFallback() {
  bindById("assignLevel", "change", () => {
    refreshAssignmentStudentOptions();
    renderAssignmentLevelTiles();
  });
  bindById("assignAssignedAt", "change", () => {
    const dueEl = document.getElementById("assignDueAt");
    if (!normalizeText(dueEl?.value)) {
      if (dueEl)
        dueEl.value = nextSundayIsoDate(
          document.getElementById("assignAssignedAt").value,
        );
    }
  });
  bindById("assignmentExerciseSelect", "change", () => {
    const selectEl = document.getElementById("assignmentExerciseSelect");
    const urlEl = document.getElementById("assignmentExerciseUrl");
    if (!selectEl || !urlEl) return;
    const selectedOption = selectEl.options[selectEl.selectedIndex];
    const suggestedUrl = normalizeText(selectedOption?.dataset?.url);
    if (suggestedUrl) urlEl.value = suggestedUrl;
  });
  bindById("assignmentAddItemBtn", "click", () => {
    try {
      addAssignmentDraftItem();
    } catch (error) {
      handleError(error);
    }
  });
  bindById("assignmentLoadTitlesBtn", "click", () => {
    const q = normalizeText(
      document.getElementById("assignmentExerciseSelect").value,
    );
    loadExerciseTitles(q).catch(handleError);
  });
  bindById("assignmentReloadTemplatesBtn", "click", () => {
    loadAssignmentTemplatesFromServer()
      .then(() => {
        renderAssignmentTemplates();
        setAssignmentStatus("Assignments reloaded.");
      })
      .catch(handleError);
  });
  bindById("assignmentSortField", "change", () => {
    applySortState(
      "assignments",
      normalizeText(document.getElementById("assignmentSortField").value) ||
        "dueAt",
      { toggleIfSame: false, resetDirOnFieldChange: false },
    );
    rerenderSortedTable("assignments");
  });
  bindById("assignmentSortDirBtn", "click", () => {
    const currentField =
      normalizeText(state.tableSort?.assignments?.field) || "dueAt";
    applySortState("assignments", currentField, {
      toggleIfSame: true,
      resetDirOnFieldChange: false,
    });
    rerenderSortedTable("assignments");
  });
  const applyAssignmentDataSearch = () => {
    setTableSearchTerm(
      "assignments",
      document.getElementById("assignmentDataSearch").value,
    );
    rerenderSortedTable("assignments");
  };
  bindById("assignmentDataSearch", "input", applyAssignmentDataSearch);
  bindById("assignmentArchiveToggleBtn", "click", () => {
    try {
      toggleTableArchivedView("assignments");
    } catch (error) {
      handleError(error);
    }
  });
  bindById("assignmentExportXlsxBtn", "click", () => {
    exportVisibleTableRowsToXlsx("assignments").catch(handleError);
  });
  bindById("assignmentPrintPdfBtn", "click", () => {
    try {
      printVisibleTableRowsPdf("assignments");
    } catch (error) {
      handleError(error);
    }
  });
  bindById("assignmentSaveTemplateBtn", "click", () =>
    saveAssignmentTemplate().catch(handleError),
  );
  bindById("assignmentDeleteTemplateBtn", "click", () =>
    deleteAssignmentTemplate().catch(handleError),
  );
  bindById("assignmentSendBtn", "click", () =>
    sendAssignmentAnnouncement().catch(handleError),
  );
  bindById("assignmentResetBtn", "click", () => resetAssignmentForm());
  bindById("levelReminderSendBtn", "click", () =>
    sendLevelReminders(
      normalizeText(
        document.getElementById("levelReminderMode").value || "selected",
      ),
    ).catch(handleError),
  );
  bindById("levelReminderSendAllBtn", "click", () =>
    sendLevelReminders("all").catch(handleError),
  );
  bindById("levelReminderClearBtn", "click", () => clearLevelReminderForm());
  bindById("levelDetailCloseBtn", "click", () => closeLevelDetailPanel());
}

function bindParentTrackingIslandFallback() {
  bindById("pt_classDate", "change", () => {
    const classDate = normalizeText(document.getElementById("pt_classDate").value);
    parentTrackingFieldSetValue("pt_classDay", dayLabelFromIsoDate(classDate));
    resetParentTrackingManualMetricsTouched();
    applyParentTrackingLessonSummaryFromMemory({ force: true });
    syncParentTrackingForSelection({}).catch(handleError);
  });
  bindById("pt_studentRefId", "change", () => {
    resetParentTrackingManualMetricsTouched();
    syncParentTrackingForSelection({}).catch(handleError);
  });
  bindById("pt_teacherName", "change", () => {
    rememberParentTrackingTeacherName();
  });
  bindById("pt_lessonSummary", "input", () => {
    rememberParentTrackingLessonSummary();
  });
  const parentTrackingSectionEl = document.querySelector(
    '.page-section[data-page="parent-tracking"]',
  );
  parentTrackingSectionEl?.addEventListener("focusin", (event) => {
    const target = event?.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    if (!normalizeText(target.name).startsWith("pt_rec_")) return;
    rememberParentTrackingRecommendationFocus(target.name);
  });
  parentTrackingSectionEl?.addEventListener("change", (event) => {
    const target = event?.target;
    if (
      !(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)
    )
      return;
    const fieldName = normalizeText(target.name);
    if (!fieldName.startsWith("pt_skill_") && !fieldName.startsWith("pt_conduct_"))
      return;
    applyParentTrackingRubricSummaryScores();
  });
  parentTrackingSectionEl?.addEventListener("input", (event) => {
    const target = event?.target;
    if (!(target instanceof HTMLInputElement)) return;
    const fieldName = normalizeText(target.name);
    if (!fieldName.startsWith("pt_skill_") && !fieldName.startsWith("pt_conduct_"))
      return;
    applyParentTrackingRubricSummaryScores();
  });
  document
    .getElementById("pt_actionInsertBtn")
    ?.addEventListener("click", () => insertParentTrackingActionShortcut());
  document
    .getElementById("pt_actionClearBtn")
    ?.addEventListener("click", () => clearParentTrackingActionShortcutInputs());
  bindById("pt_saveBtn", "click", () => saveParentTrackingReport().catch(handleError));
  bindById("pt_queueSendBtn", "click", () => queueParentTrackingEmail().catch(handleError));
  bindById("pt_clearBtn", "click", () => {
    clearParentTrackingForm();
    refreshParentTracking({ preserveStudentSelection: true }).catch(handleError);
  });
  document
    .getElementById("performanceQueueExpandBtn")
    ?.addEventListener("click", () => {
      const nextShowAll = !state.parentReportQueue.showAll;
      loadParentReportQueue({ showAll: nextShowAll }).catch(handleError);
    });
  bindById("overviewIncomingExerciseExpandBtn", "click", () => {
      const nextShowAll = !state.incomingExerciseQueue.showAll;
      loadIncomingExerciseResults({ showAll: nextShowAll }).catch(handleError);
    });
  bindById("overviewIncomingExerciseRefreshBtn", "click", () => {
      loadIncomingExerciseResults({
        showAll: state.incomingExerciseQueue.showAll,
      }).catch(handleError);
    });
  document
    .getElementById("performanceQueueRefreshBtn")
    ?.addEventListener("click", () => {
      loadParentReportQueue({ showAll: state.parentReportQueue.showAll }).catch(
        handleError,
      );
    });
  document
    .getElementById("performanceQueueSendAllBtn")
    ?.addEventListener("click", () => {
      sendAllQueuedParentReports().catch(handleError);
    });
  document
    .getElementById("performanceQueueSendSelectedBtn")
    ?.addEventListener("click", () => {
      sendSelectedQueuedParentReports().catch(handleError);
    });
  document
    .getElementById("performanceQueueUnqueueSelectedBtn")
    ?.addEventListener("click", () => {
      unqueueSelectedQueuedParentReports().catch(handleError);
    });
  document
    .getElementById("performanceQueueDeleteSelectedBtn")
    ?.addEventListener("click", () => {
      deleteSelectedQueuedParentReports().catch(handleError);
    });
  document
    .getElementById("performanceQueueSelectAll")
    ?.addEventListener("change", (event) => {
      const target = event.target;
      setParentQueueSelectionForVisibleRows(Boolean(target?.checked), state.parentReportQueue.items);
      renderPerformanceQueueSection({
        total: state.parentReportQueue.total,
        hasMore: state.parentReportQueue.hasMore,
        items: state.parentReportQueue.items,
      });
    });
  document
    .getElementById("performanceStagedRefreshBtn")
    ?.addEventListener("click", () => {
      loadParentReportQueue({ showAll: state.parentReportQueue.showAll })
        .then(() => {
          renderPerformanceStagedSection(state.visibleTableRows?.performance || []);
          setStatus("Staged performance reports reloaded.");
        })
        .catch(handleError);
    });
  bindById("performanceEngagementReloadBtn", "click", () => {
    loadPerformanceEngagementData({ force: true }).catch(handleError);
  });
  bindById("performanceEngagementSearch", "input", (event) => {
    state.performanceEngagement.search = normalizeText(event?.target?.value);
    renderPerformanceEngagementPage();
  });
  bindById("performanceEngagementLevelFilter", "change", (event) => {
    state.performanceEngagement.level = normalizeText(event?.target?.value);
    renderPerformanceEngagementPage();
  });
  bindById("performanceEngagementDeliveryFilter", "change", (event) => {
    state.performanceEngagement.delivery = normalizeText(event?.target?.value);
    renderPerformanceEngagementPage();
  });
  bindById("parentQueueCloseBtn", "click", () => closeParentQueueModal());
  bindById("parentQueuePrevBtn", "click", () => {
    if (state.parentReportQueue.modalIndex <= 0) return;
    state.parentReportQueue.modalIndex -= 1;
    renderParentQueueModal();
  });
  bindById("parentQueueNextBtn", "click", () => {
    const total =
      Array.isArray(state.parentReportQueue?.items) ?
        state.parentReportQueue.items.length
      : 0;
    if (state.parentReportQueue.modalIndex >= total - 1) return;
    state.parentReportQueue.modalIndex += 1;
    renderParentQueueModal();
  });
  bindById("parentQueueHoldBtn", "click", () => holdParentQueueModalItem().catch(handleError));
  bindById("parentQueueEditBtn", "click", () => editParentQueueModalItem().catch(handleError));
  bindById("parentQueueRequeueBtn", "click", () =>
      requeueParentQueueModalItem().catch(handleError),
    );
  bindById("parentQueueSendAllBtn", "click", () =>
      sendAllQueuedParentReports().catch(handleError),
    );
  bindById("parentQueueModal", "click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.id !== "parentQueueModal") return;
    closeParentQueueModal();
  });
}

function bindAttendanceGradeControlsFallback() {
  document
    .getElementById("attendanceLevelStyleLevel")
    ?.addEventListener("change", () => {
      state.levelTileStyleEditor.pendingImageDataUrl = "";
      syncAttendanceLevelEditorInputs();
    });
  bindById("attendanceSaveBtn", "click", () => saveAttendance().catch(handleError));
  bindById("attendanceLandingSaveAllBtn", "click", () =>
    saveAttendanceLandingForSelectedLevel().catch(handleError),
  );
  bindById("attendanceLandingReloadBtn", "click", () =>
    refreshAttendanceLanding({ reloadRows: true }).catch(handleError),
  );
  bindById("attendanceLevelApplyBtn", "click", () => {
    try {
      applyAttendanceLevelTileStyle();
    } catch (error) {
      handleError(error);
    }
  });
  bindById("attendanceLevelClearImageBtn", "click", () => {
    try {
      clearAttendanceLevelTileImage();
    } catch (error) {
      handleError(error);
    }
  });
  bindById("attendanceLevelResetBtn", "click", () => {
    try {
      resetAttendanceLevelTileStyle();
    } catch (error) {
      handleError(error);
    }
  });
  bindById("attendanceLevelImage", "change", (event) => {
    try {
      handleAttendanceLevelImageUpload(event);
    } catch (error) {
      handleError(error);
    }
  });
  bindById("a_date", "change", () => {
    syncAttendanceDateDerivedFields();
    state.attendanceLanding.selectionsByStudentId = {};
    persistAttendanceFormContext();
    refreshAttendanceLandingRows({ hydrate: false }).catch(handleError);
  });
  bindById("a_schoolYear", "change", persistAttendanceFormContext);
  bindById("a_quarter", "change", () => {
    updateAttendanceQuarterWarning();
    persistAttendanceFormContext();
  });
  bindById("attendanceClearBtn", "click", () => {
    clearAttendanceForm();
    setStatus("Attendance form cleared.");
  });
  bindById("attendanceSortField", "change", () => {
    applySortState(
      "attendance",
      normalizeText(document.getElementById("attendanceSortField").value) ||
        "attendanceDate",
      { toggleIfSame: false, resetDirOnFieldChange: false },
    );
    rerenderSortedTable("attendance");
  });
  bindById("attendanceSortDirBtn", "click", () => {
    const currentField =
      normalizeText(state.tableSort?.attendance?.field) || "attendanceDate";
    applySortState("attendance", currentField, {
      toggleIfSame: true,
      resetDirOnFieldChange: false,
    });
    rerenderSortedTable("attendance");
  });
  const applyAttendanceDataSearch = () => {
    setTableSearchTerm(
      "attendance",
      document.getElementById("attendanceDataSearch").value,
    );
    rerenderSortedTable("attendance");
  };
  bindById("attendanceDataSearch", "input", applyAttendanceDataSearch);
  bindById("attendanceArchiveToggleBtn", "click", () => {
    try {
      toggleTableArchivedView("attendance");
    } catch (error) {
      handleError(error);
    }
  });
  bindById("attendanceExportXlsxBtn", "click", () => {
    exportVisibleTableRowsToXlsx("attendance").catch(handleError);
  });
  bindById("attendancePrintPdfBtn", "click", () => {
    try {
      printVisibleTableRowsPdf("attendance");
    } catch (error) {
      handleError(error);
    }
  });
  bindById("performanceSortField", "change", () => {
    applySortState(
      "performance",
      normalizeText(document.getElementById("performanceSortField").value) ||
        "generatedAt",
      { toggleIfSame: false, resetDirOnFieldChange: false },
    );
    rerenderSortedTable("performance");
  });
  bindById("performanceSortDirBtn", "click", () => {
    const currentField =
      normalizeText(state.tableSort?.performance?.field) || "generatedAt";
    applySortState("performance", currentField, {
      toggleIfSame: true,
      resetDirOnFieldChange: false,
    });
    rerenderSortedTable("performance");
  });
  const applyPerformanceDataSearch = () => {
    setTableSearchTerm(
      "performance",
      document.getElementById("performanceDataSearch").value,
    );
    rerenderSortedTable("performance");
  };
  bindById("performanceDataSearch", "input", applyPerformanceDataSearch);
  bindById("performanceExportXlsxBtn", "click", () => {
    exportVisibleTableRowsToXlsx("performance").catch(handleError);
  });
  bindById("performancePrintPdfBtn", "click", () => {
    try {
      printVisibleTableRowsPdf("performance");
    } catch (error) {
      handleError(error);
    }
  });
  bindById("gradeSaveBtn", "click", () => saveGrade().catch(handleError));
  bindById("gradeClearBtn", "click", () => {
    clearGradeForm();
    setStatus("Grade form cleared.");
  });
  bindById("gradeSortField", "change", () => {
    applySortState(
      "grades",
      normalizeText(document.getElementById("gradeSortField").value) || "dueAt",
      { toggleIfSame: false, resetDirOnFieldChange: false },
    );
    rerenderSortedTable("grades");
  });
  bindById("gradeSortDirBtn", "click", () => {
    const currentField = normalizeText(state.tableSort?.grades?.field) || "dueAt";
    applySortState("grades", currentField, {
      toggleIfSame: true,
      resetDirOnFieldChange: false,
    });
    rerenderSortedTable("grades");
  });
  const applyGradeDataSearch = () => {
    setTableSearchTerm("grades", document.getElementById("gradeDataSearch").value);
    rerenderSortedTable("grades");
  };
  bindById("gradeDataSearch", "input", applyGradeDataSearch);
  bindById("gradeArchiveToggleBtn", "click", () => {
    try {
      toggleTableArchivedView("grades");
    } catch (error) {
      handleError(error);
    }
  });
  bindById("gradeExportXlsxBtn", "click", () => {
    exportVisibleTableRowsToXlsx("grades").catch(handleError);
  });
  bindById("gradePrintPdfBtn", "click", () => {
    try {
      printVisibleTableRowsPdf("grades");
    } catch (error) {
      handleError(error);
    }
  });

  document
    .getElementById("openTabulatorGradesBtn")
    ?.addEventListener("click", () => {
      window.location.assign(buildGradesTabulatorLaunchUrl());
    });
  document.getElementById("gradeChartLanes")?.addEventListener("click", (event) => {
    const target = event?.target;
    if (!(target instanceof Element)) return;
    const openBtn = target.closest("button[data-grade-chart-open]");
    if (!(openBtn instanceof HTMLButtonElement)) return;
    const laneKey = normalizeText(openBtn.getAttribute("data-grade-chart-open"));
    if (!laneKey) return;
    openGradeChartModalForLaneKey(laneKey);
  });
  document
    .getElementById("gradeChartModalCloseBtn")
    ?.addEventListener("click", () => {
      closeGradeChartModal();
    });
  document.getElementById("gradeChartModal")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeGradeChartModal();
  });
  document.addEventListener("keydown", (event) => {
    if (!state.gradeChartModalOpen) return;
    if (normalizeText(event.key) !== "Escape") return;
    closeGradeChartModal();
  });
  document
    .getElementById("gradeChartPeriods")
    ?.addEventListener("click", (event) => {
      const target = event?.target;
      if (!(target instanceof Element)) return;
      const buttonEl = target.closest("[data-grade-chart-period]");
      if (!(buttonEl instanceof HTMLButtonElement)) return;
      const period = normalizedGradeChartPeriod(
        buttonEl.getAttribute("data-grade-chart-period"),
      );
      setGradeChartState({ period });
      applyGradeChartCurrentSchoolYearDefault();
      applyGradeChartCurrentQuarterDefault();
      renderGradePulseChart(state.visibleTableRows?.grades || []);
    });
  document.getElementById("gradeChartGroupBy")?.addEventListener("change", () => {
    setGradeChartState({
      groupBy: document.getElementById("gradeChartGroupBy")?.value || "class",
    });
    renderGradePulseChart(state.visibleTableRows?.grades || []);
  });
  document.getElementById("gradeChartQuarter")?.addEventListener("change", () => {
    setGradeChartState({
      quarter: document.getElementById("gradeChartQuarter")?.value || "",
    });
    renderGradePulseChart(state.visibleTableRows?.grades || []);
  });
  document
    .getElementById("gradeChartSchoolYear")
    ?.addEventListener("change", () => {
      setGradeChartState({
        schoolYear:
          document.getElementById("gradeChartSchoolYear")?.value ||
          gradeChartCurrentSchoolYear(),
      });
      renderGradePulseChart(state.visibleTableRows?.grades || []);
    });
  const applyGradeChartCustomRange = () => {
    let customFrom = normalizeText(
      document.getElementById("gradeChartCustomFrom")?.value,
    ).slice(0, 10);
    let customTo = normalizeText(
      document.getElementById("gradeChartCustomTo")?.value,
    ).slice(0, 10);
    if (customFrom && customTo && compareIsoDateText(customFrom, customTo) > 0) {
      const swapped = customFrom;
      customFrom = customTo;
      customTo = swapped;
    }
    const fromEl = document.getElementById("gradeChartCustomFrom");
    const toEl = document.getElementById("gradeChartCustomTo");
    if (fromEl) fromEl.value = customFrom;
    if (toEl) toEl.value = customTo;
    setGradeChartState({ customFrom, customTo });
    renderGradePulseChart(state.visibleTableRows?.grades || []);
  };
  document
    .getElementById("gradeChartCustomFrom")
    ?.addEventListener("change", applyGradeChartCustomRange);
  document
    .getElementById("gradeChartCustomTo")
    ?.addEventListener("change", applyGradeChartCustomRange);
}

  return { bindNewsReviewIslandFallback, bindSchoolSetupBrandingFallback, bindAssignmentControlsFallback, bindParentTrackingIslandFallback, bindAttendanceGradeControlsFallback };
}
