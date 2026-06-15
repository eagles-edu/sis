export function initSchoolSetupBrandingIsland({
  document,
  onSchoolSetupPreviewChange,
  onSchoolSetupAutoFill,
  onSchoolSetupLogoChange,
  onSchoolSetupLogoClear,
  onSchoolSetupSave,
  onSchoolSetupReset,
  onProfileFieldLayoutApply,
  onProfileFieldLayoutReset,
  onProfileFieldLayoutRefresh,
  onProfileFieldCreate,
  onProfileFieldLayoutRowDelete,
} = {}) {
  const view = document?.defaultView || null;
  const ElementCtor = view?.Element || null;
  const HTMLButtonElementCtor = view?.HTMLButtonElement || null;
  const HTMLTableRowElementCtor = view?.HTMLTableRowElement || null;
  const previewIds = [
    "schoolSetupStartDate",
    "schoolSetupEndDate",
    "schoolSetupLetterGradeRanges",
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
  ];

  previewIds.forEach((id) => {
    document?.getElementById(id)?.addEventListener("change", () => {
      if (typeof onSchoolSetupPreviewChange === "function") onSchoolSetupPreviewChange();
    });
  });
  document?.getElementById("schoolSetupAutoFillBtn")?.addEventListener("click", () => {
    if (typeof onSchoolSetupAutoFill === "function") onSchoolSetupAutoFill();
  });
  document?.getElementById("schoolSetupLogoFile")?.addEventListener("change", (event) => {
    if (typeof onSchoolSetupLogoChange === "function") onSchoolSetupLogoChange(event);
  });
  document?.getElementById("schoolSetupLogoClearBtn")?.addEventListener("click", () => {
    if (typeof onSchoolSetupLogoClear === "function") onSchoolSetupLogoClear();
  });
  document?.getElementById("schoolSetupSaveBtn")?.addEventListener("click", () => {
    if (typeof onSchoolSetupSave === "function") onSchoolSetupSave();
  });
  document?.getElementById("schoolSetupResetBtn")?.addEventListener("click", () => {
    if (typeof onSchoolSetupReset === "function") onSchoolSetupReset();
  });
  document?.getElementById("profileFieldLayoutApplyBtn")?.addEventListener("click", () => {
    if (typeof onProfileFieldLayoutApply === "function") onProfileFieldLayoutApply();
  });
  document?.getElementById("profileFieldLayoutResetBtn")?.addEventListener("click", () => {
    if (typeof onProfileFieldLayoutReset === "function") onProfileFieldLayoutReset();
  });
  document?.getElementById("profileFieldLayoutRefreshBtn")?.addEventListener("click", () => {
    if (typeof onProfileFieldLayoutRefresh === "function") onProfileFieldLayoutRefresh();
  });
  document?.getElementById("profileFieldCreateBtn")?.addEventListener("click", () => {
    if (typeof onProfileFieldCreate === "function") onProfileFieldCreate();
  });
  document?.getElementById("profileFieldLayoutRows")?.addEventListener("click", (event) => {
    const target = event?.target;
    if (typeof ElementCtor !== "function" || !(target instanceof ElementCtor)) return;
    const button = target.closest("[data-profile-layout-action]");
    if (
      typeof HTMLButtonElementCtor !== "function" ||
      !(button instanceof HTMLButtonElementCtor)
    ) {
      return;
    }
    if (button.dataset.profileLayoutAction !== "delete") return;
    const row = button.closest("tr[data-profile-field-key]");
    if (
      typeof HTMLTableRowElementCtor !== "function" ||
      !(row instanceof HTMLTableRowElementCtor)
    ) {
      return;
    }
    if (typeof onProfileFieldLayoutRowDelete === "function") {
      onProfileFieldLayoutRowDelete(row.dataset.profileFieldKey || "");
    }
  });

  return {
    dispose() {},
  };
}
