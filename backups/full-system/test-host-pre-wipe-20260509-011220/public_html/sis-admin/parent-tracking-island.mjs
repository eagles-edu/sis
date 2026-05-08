export function initParentTrackingIsland({
  document,
  onParentTrackingClassDateChange,
  onParentTrackingStudentRefChange,
  onParentTrackingTeacherChange,
  onParentTrackingLessonSummaryInput,
  onParentTrackingRecommendationFocus,
  onParentTrackingRubricChange,
  onParentTrackingRubricInput,
  onParentTrackingActionInsert,
  onParentTrackingActionClear,
  onParentTrackingSave,
  onParentTrackingQueueSend,
  onParentTrackingClear,
  onPerformanceQueueExpand,
  onOverviewIncomingExerciseExpand,
  onOverviewIncomingExerciseRefresh,
  onPerformanceQueueRefresh,
  onPerformanceQueueSendAll,
  onPerformanceStagedRefresh,
  onParentQueueClose,
  onParentQueuePrev,
  onParentQueueNext,
  onParentQueueHold,
  onParentQueueEdit,
  onParentQueueRequeue,
  onParentQueueSendAll,
  onParentQueueModalClick,
} = {}) {
  const view = document?.defaultView || null;
  const ElementCtor = view?.Element || null;
  const HTMLTextAreaElementCtor = view?.HTMLTextAreaElement || null;
  const HTMLInputElementCtor = view?.HTMLInputElement || null;
  const HTMLSelectElementCtor = view?.HTMLSelectElement || null;
  const HTMLButtonElementCtor = view?.HTMLButtonElement || null;

  function isInstanceOf(value, ctor) {
    return typeof ctor === "function" && value instanceof ctor;
  }

  document?.getElementById("pt_classDate")?.addEventListener("change", () => {
    if (typeof onParentTrackingClassDateChange === "function") {
      onParentTrackingClassDateChange();
    }
  });
  document?.getElementById("pt_studentRefId")?.addEventListener("change", () => {
    if (typeof onParentTrackingStudentRefChange === "function") {
      onParentTrackingStudentRefChange();
    }
  });
  document?.getElementById("pt_teacherName")?.addEventListener("change", () => {
    if (typeof onParentTrackingTeacherChange === "function") {
      onParentTrackingTeacherChange();
    }
  });
  document?.getElementById("pt_lessonSummary")?.addEventListener("input", () => {
    if (typeof onParentTrackingLessonSummaryInput === "function") {
      onParentTrackingLessonSummaryInput();
    }
  });

  const parentTrackingSectionEl = document?.querySelector(
    '.page-section[data-page="parent-tracking"]',
  );
  parentTrackingSectionEl?.addEventListener("focusin", (event) => {
    const target = event?.target;
    if (!isInstanceOf(target, HTMLTextAreaElementCtor)) return;
    if (!String(target.name || "").startsWith("pt_rec_")) return;
    if (typeof onParentTrackingRecommendationFocus === "function") {
      onParentTrackingRecommendationFocus(String(target.name || ""));
    }
  });
  parentTrackingSectionEl?.addEventListener("change", (event) => {
    const target = event?.target;
    if (!isInstanceOf(target, HTMLInputElementCtor) && !isInstanceOf(target, HTMLSelectElementCtor))
      return;
    const fieldName = String(target.name || "");
    if (!fieldName.startsWith("pt_skill_") && !fieldName.startsWith("pt_conduct_")) return;
    if (typeof onParentTrackingRubricChange === "function") onParentTrackingRubricChange();
  });
  parentTrackingSectionEl?.addEventListener("input", (event) => {
    const target = event?.target;
    if (!isInstanceOf(target, HTMLInputElementCtor)) return;
    const fieldName = String(target.name || "");
    if (!fieldName.startsWith("pt_skill_") && !fieldName.startsWith("pt_conduct_")) return;
    if (typeof onParentTrackingRubricInput === "function") onParentTrackingRubricInput();
  });

  document?.getElementById("pt_actionInsertBtn")?.addEventListener("click", () => {
    if (typeof onParentTrackingActionInsert === "function") onParentTrackingActionInsert();
  });
  document?.getElementById("pt_actionClearBtn")?.addEventListener("click", () => {
    if (typeof onParentTrackingActionClear === "function") onParentTrackingActionClear();
  });
  document?.getElementById("pt_saveBtn")?.addEventListener("click", () => {
    if (typeof onParentTrackingSave === "function") onParentTrackingSave();
  });
  document?.getElementById("pt_queueSendBtn")?.addEventListener("click", () => {
    if (typeof onParentTrackingQueueSend === "function") onParentTrackingQueueSend();
  });
  document?.getElementById("pt_clearBtn")?.addEventListener("click", () => {
    if (typeof onParentTrackingClear === "function") onParentTrackingClear();
  });
  document?.getElementById("performanceQueueExpandBtn")?.addEventListener("click", () => {
    if (typeof onPerformanceQueueExpand === "function") onPerformanceQueueExpand();
  });
  document?.getElementById("overviewIncomingExerciseExpandBtn")?.addEventListener("click", () => {
    if (typeof onOverviewIncomingExerciseExpand === "function") onOverviewIncomingExerciseExpand();
  });
  document?.getElementById("overviewIncomingExerciseRefreshBtn")?.addEventListener("click", () => {
    if (typeof onOverviewIncomingExerciseRefresh === "function") onOverviewIncomingExerciseRefresh();
  });
  document?.getElementById("performanceQueueRefreshBtn")?.addEventListener("click", () => {
    if (typeof onPerformanceQueueRefresh === "function") onPerformanceQueueRefresh();
  });
  document?.getElementById("performanceQueueSendAllBtn")?.addEventListener("click", () => {
    if (typeof onPerformanceQueueSendAll === "function") onPerformanceQueueSendAll();
  });
  document?.getElementById("performanceStagedRefreshBtn")?.addEventListener("click", () => {
    if (typeof onPerformanceStagedRefresh === "function") onPerformanceStagedRefresh();
  });
  document?.getElementById("parentQueueCloseBtn")?.addEventListener("click", () => {
    if (typeof onParentQueueClose === "function") onParentQueueClose();
  });
  document?.getElementById("parentQueuePrevBtn")?.addEventListener("click", () => {
    if (typeof onParentQueuePrev === "function") onParentQueuePrev();
  });
  document?.getElementById("parentQueueNextBtn")?.addEventListener("click", () => {
    if (typeof onParentQueueNext === "function") onParentQueueNext();
  });
  document?.getElementById("parentQueueHoldBtn")?.addEventListener("click", () => {
    if (typeof onParentQueueHold === "function") onParentQueueHold();
  });
  document?.getElementById("parentQueueEditBtn")?.addEventListener("click", () => {
    if (typeof onParentQueueEdit === "function") onParentQueueEdit();
  });
  document?.getElementById("parentQueueRequeueBtn")?.addEventListener("click", () => {
    if (typeof onParentQueueRequeue === "function") onParentQueueRequeue();
  });
  document?.getElementById("parentQueueSendAllBtn")?.addEventListener("click", () => {
    if (typeof onParentQueueSendAll === "function") onParentQueueSendAll();
  });
  document?.getElementById("parentQueueModal")?.addEventListener("click", (event) => {
    if (typeof onParentQueueModalClick === "function") onParentQueueModalClick(event);
  });

  return {
    dispose() {},
  };
}
