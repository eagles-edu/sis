export function initProfileIsland({
  document,
  onProfileNewStudent,
  onProfileClearStudent,
  onProfileSaveStudent,
  onProfileDeleteStudent,
  onProfileEditInfo,
  onProfileCreateInfo,
  onProfileRefreshInfo,
  onProfileBackToInfo,
  onProfileCurrentGradeChange,
  onProfileEditorSubmit,
} = {}) {
  const view = document?.defaultView || null;
  const ElementCtor = view?.Element || null;

  function isInstanceOf(value, ctor) {
    return typeof ctor === "function" && value instanceof ctor;
  }

  document?.getElementById("newBtn")?.addEventListener("click", () => {
    if (typeof onProfileNewStudent === "function") onProfileNewStudent();
  });
  document?.getElementById("studentClearBtn")?.addEventListener("click", () => {
    if (typeof onProfileClearStudent === "function") onProfileClearStudent();
  });
  document?.getElementById("saveBtn")?.addEventListener("click", () => {
    if (typeof onProfileSaveStudent === "function") onProfileSaveStudent();
  });
  document?.getElementById("deleteBtn")?.addEventListener("click", () => {
    if (typeof onProfileDeleteStudent === "function") onProfileDeleteStudent();
  });
  document?.getElementById("profileEditInfoBtn")?.addEventListener("click", () => {
    if (typeof onProfileEditInfo === "function") onProfileEditInfo();
  });
  document?.getElementById("profileCreateInfoBtn")?.addEventListener("click", () => {
    if (typeof onProfileCreateInfo === "function") onProfileCreateInfo();
  });
  document?.getElementById("profileRefreshInfoBtn")?.addEventListener("click", () => {
    if (typeof onProfileRefreshInfo === "function") onProfileRefreshInfo();
  });
  document?.getElementById("profileBackToInfoBtn")?.addEventListener("click", () => {
    if (typeof onProfileBackToInfo === "function") onProfileBackToInfo();
  });
  document
    ?.querySelector('.page-section[data-page="profile"]')
    ?.addEventListener("change", (event) => {
      const target = event?.target;
      if (!isInstanceOf(target, ElementCtor)) return;
      if (target.id !== "f_currentGrade") return;
      if (typeof onProfileCurrentGradeChange === "function") {
        onProfileCurrentGradeChange(target.value);
      }
    });
  document
    ?.getElementById("profileEditorForm")
    ?.addEventListener("submit", (event) => {
      if (typeof onProfileEditorSubmit === "function") onProfileEditorSubmit(event);
    });

  return {
    dispose() {},
  };
}
