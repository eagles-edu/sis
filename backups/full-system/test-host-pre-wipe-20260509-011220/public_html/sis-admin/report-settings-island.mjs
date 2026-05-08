export function initReportSettingsIsland({
  document,
  onImportSpreadsheet,
  onImportTemplate,
  onSettingsSave,
  onSettingsReset,
  onReportSave,
  onReportGenerate,
  onReportCard,
  onReportClear,
  onReportSortFieldChange,
  onReportSortDirToggle,
  onReportDataSearchInput,
  onReportArchiveToggle,
  onReportExportXlsx,
  onReportPrintPdf,
} = {}) {
  document?.getElementById("importBtn")?.addEventListener("click", () => {
    if (typeof onImportSpreadsheet === "function") onImportSpreadsheet();
  });
  document?.getElementById("importTemplateBtn")?.addEventListener("click", () => {
    if (typeof onImportTemplate === "function") onImportTemplate();
  });
  document?.getElementById("settingsSaveBtn")?.addEventListener("click", () => {
    if (typeof onSettingsSave === "function") onSettingsSave();
  });
  document?.getElementById("settingsResetBtn")?.addEventListener("click", () => {
    if (typeof onSettingsReset === "function") onSettingsReset();
  });
  document?.getElementById("reportSaveBtn")?.addEventListener("click", () => {
    if (typeof onReportSave === "function") onReportSave();
  });
  document?.getElementById("reportGenerateBtn")?.addEventListener("click", () => {
    if (typeof onReportGenerate === "function") onReportGenerate();
  });
  document?.getElementById("reportCardBtn")?.addEventListener("click", () => {
    if (typeof onReportCard === "function") onReportCard();
  });
  document?.getElementById("reportClearBtn")?.addEventListener("click", () => {
    if (typeof onReportClear === "function") onReportClear();
  });
  document?.getElementById("reportSortField")?.addEventListener("change", (event) => {
    if (typeof onReportSortFieldChange === "function") {
      onReportSortFieldChange(event?.target?.value || "");
    }
  });
  document?.getElementById("reportSortDirBtn")?.addEventListener("click", () => {
    if (typeof onReportSortDirToggle === "function") onReportSortDirToggle();
  });
  document?.getElementById("reportDataSearch")?.addEventListener("input", (event) => {
    if (typeof onReportDataSearchInput === "function") {
      onReportDataSearchInput(event?.target?.value || "");
    }
  });
  document?.getElementById("reportArchiveToggleBtn")?.addEventListener("click", () => {
    if (typeof onReportArchiveToggle === "function") onReportArchiveToggle();
  });
  document?.getElementById("reportExportXlsxBtn")?.addEventListener("click", () => {
    if (typeof onReportExportXlsx === "function") onReportExportXlsx();
  });
  document?.getElementById("reportPrintPdfBtn")?.addEventListener("click", () => {
    if (typeof onReportPrintPdf === "function") onReportPrintPdf();
  });

  return {
    dispose() {},
  };
}
