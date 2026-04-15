export function initAssignmentControlsIsland({
  document,
  onAssignLevelChange,
  onAssignAssignedAtChange,
  onAssignmentExerciseSelectChange,
  onAssignmentAddItem,
  onAssignmentLoadTitles,
  onAssignmentReloadTemplates,
  onAssignmentSortFieldChange,
  onAssignmentSortDirToggle,
  onAssignmentDataSearchInput,
  onAssignmentArchiveToggle,
  onAssignmentExportXlsx,
  onAssignmentPrintPdf,
  onAssignmentSaveTemplate,
  onAssignmentDeleteTemplate,
  onAssignmentSend,
  onAssignmentReset,
  onLevelReminderSend,
  onLevelReminderSendAll,
  onLevelReminderClear,
  onLevelDetailClose,
} = {}) {
  document?.getElementById("assignLevel")?.addEventListener("change", () => {
    if (typeof onAssignLevelChange === "function") onAssignLevelChange();
  });
  document?.getElementById("assignAssignedAt")?.addEventListener("change", () => {
    if (typeof onAssignAssignedAtChange === "function") onAssignAssignedAtChange();
  });
  document
    ?.getElementById("assignmentExerciseSelect")
    ?.addEventListener("change", (event) => {
      if (typeof onAssignmentExerciseSelectChange === "function") {
        onAssignmentExerciseSelectChange(event);
      }
    });
  document?.getElementById("assignmentAddItemBtn")?.addEventListener("click", () => {
    if (typeof onAssignmentAddItem === "function") onAssignmentAddItem();
  });
  document?.getElementById("assignmentLoadTitlesBtn")?.addEventListener("click", () => {
    if (typeof onAssignmentLoadTitles === "function") onAssignmentLoadTitles();
  });
  document
    ?.getElementById("assignmentReloadTemplatesBtn")
    ?.addEventListener("click", () => {
      if (typeof onAssignmentReloadTemplates === "function") onAssignmentReloadTemplates();
    });
  document?.getElementById("assignmentSortField")?.addEventListener("change", (event) => {
    if (typeof onAssignmentSortFieldChange === "function") {
      onAssignmentSortFieldChange(event?.target?.value || "");
    }
  });
  document?.getElementById("assignmentSortDirBtn")?.addEventListener("click", () => {
    if (typeof onAssignmentSortDirToggle === "function") onAssignmentSortDirToggle();
  });
  document?.getElementById("assignmentDataSearch")?.addEventListener("input", (event) => {
    if (typeof onAssignmentDataSearchInput === "function") {
      onAssignmentDataSearchInput(event?.target?.value || "");
    }
  });
  document?.getElementById("assignmentArchiveToggleBtn")?.addEventListener("click", () => {
    if (typeof onAssignmentArchiveToggle === "function") onAssignmentArchiveToggle();
  });
  document?.getElementById("assignmentExportXlsxBtn")?.addEventListener("click", () => {
    if (typeof onAssignmentExportXlsx === "function") onAssignmentExportXlsx();
  });
  document?.getElementById("assignmentPrintPdfBtn")?.addEventListener("click", () => {
    if (typeof onAssignmentPrintPdf === "function") onAssignmentPrintPdf();
  });
  document?.getElementById("assignmentSaveTemplateBtn")?.addEventListener("click", () => {
    if (typeof onAssignmentSaveTemplate === "function") onAssignmentSaveTemplate();
  });
  document
    ?.getElementById("assignmentDeleteTemplateBtn")
    ?.addEventListener("click", () => {
      if (typeof onAssignmentDeleteTemplate === "function") onAssignmentDeleteTemplate();
    });
  document?.getElementById("assignmentSendBtn")?.addEventListener("click", () => {
    if (typeof onAssignmentSend === "function") onAssignmentSend();
  });
  document?.getElementById("assignmentResetBtn")?.addEventListener("click", () => {
    if (typeof onAssignmentReset === "function") onAssignmentReset();
  });
  document?.getElementById("levelReminderSendBtn")?.addEventListener("click", () => {
    if (typeof onLevelReminderSend === "function") onLevelReminderSend();
  });
  document?.getElementById("levelReminderSendAllBtn")?.addEventListener("click", () => {
    if (typeof onLevelReminderSendAll === "function") onLevelReminderSendAll();
  });
  document?.getElementById("levelReminderClearBtn")?.addEventListener("click", () => {
    if (typeof onLevelReminderClear === "function") onLevelReminderClear();
  });
  document?.getElementById("levelDetailCloseBtn")?.addEventListener("click", () => {
    if (typeof onLevelDetailClose === "function") onLevelDetailClose();
  });

  return {
    dispose() {},
  };
}
