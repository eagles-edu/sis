export function initNewsReviewIsland({
  document,
  onNewsReviewStatusChange,
  onNewsReviewCheckChange,
  onNewsReviewLevelChange,
  onNewsReviewStudentChange,
  onNewsReviewDateRangeChange,
  onNewsReviewQueryChange,
  onNewsReviewRefresh,
  onNewsReviewClearFilters,
  onNewsReviewOpenWeekSet,
  onNewsReviewCloseViewer,
  onNewsReviewEditViewer,
  onNewsReviewSaveViewer,
  onNewsReviewShiftViewer,
  onNewsReviewApplyViewerAction,
} = {}) {
  const view = document?.defaultView || null;
  const ElementCtor = view?.Element || null;
  const HTMLButtonElementCtor = view?.HTMLButtonElement || null;
  const HTMLTableRowElementCtor = view?.HTMLTableRowElement || null;
  const HTMLDivElementCtor = view?.HTMLDivElement || null;
  const HTMLElementCtor = view?.HTMLElement || null;

  function isInstanceOf(value, ctor) {
    return typeof ctor === "function" && value instanceof ctor;
  }

  const statusEl = document?.getElementById("newsReviewStatusFilter");
  const checkEl = document?.getElementById("newsReviewCheckFilter");
  const levelEl = document?.getElementById("newsReviewLevelFilter");
  const studentEl = document?.getElementById("newsReviewStudentFilter");
  const dateFromEl = document?.getElementById("newsReviewDateFromFilter");
  const dateToEl = document?.getElementById("newsReviewDateToFilter");
  const queryEl = document?.getElementById("newsReviewQueryFilter");
  const rowsEl = document?.getElementById("newsReviewRows");

  statusEl?.addEventListener("change", () => {
    if (typeof onNewsReviewStatusChange === "function") {
      onNewsReviewStatusChange(String(statusEl.value || "all"));
    }
  });
  checkEl?.addEventListener("change", () => {
    if (typeof onNewsReviewCheckChange === "function") {
      onNewsReviewCheckChange(String(checkEl.value || "all"));
    }
  });
  levelEl?.addEventListener("change", () => {
    if (typeof onNewsReviewLevelChange === "function") {
      onNewsReviewLevelChange(String(levelEl.value || ""), "");
    }
  });
  studentEl?.addEventListener("change", () => {
    if (typeof onNewsReviewStudentChange === "function") {
      onNewsReviewStudentChange(String(studentEl.value || ""));
    }
  });

  const applyNewsReviewDateRange = () => {
    let fromIso = String(dateFromEl?.value || "").trim().slice(0, 10);
    let toIso = String(dateToEl?.value || "").trim().slice(0, 10);
    if (fromIso && toIso && fromIso > toIso) {
      const swapped = fromIso;
      fromIso = toIso;
      toIso = swapped;
      if (dateFromEl) dateFromEl.value = fromIso;
      if (dateToEl) dateToEl.value = toIso;
    }
    if (typeof onNewsReviewDateRangeChange === "function") {
      onNewsReviewDateRangeChange(fromIso, toIso);
    }
  };
  dateFromEl?.addEventListener("change", applyNewsReviewDateRange);
  dateToEl?.addEventListener("change", applyNewsReviewDateRange);

  queryEl?.addEventListener("input", () => {
    if (typeof onNewsReviewQueryChange === "function") {
      onNewsReviewQueryChange(String(queryEl.value || ""));
    }
  });
  document?.getElementById("newsReviewRefreshBtn")?.addEventListener("click", () => {
    if (typeof onNewsReviewRefresh === "function") {
      onNewsReviewRefresh();
    }
  });
  document
    ?.getElementById("newsReviewClearFiltersBtn")
    ?.addEventListener("click", () => {
      if (typeof onNewsReviewClearFilters === "function") {
        onNewsReviewClearFilters();
      }
    });
  rowsEl?.addEventListener("click", (event) => {
    const target = event?.target;
    if (!isInstanceOf(target, ElementCtor)) return;
    if (target.closest("a[href]")) return;

    const openBtn = target.closest("button[data-news-review-open-week-set]");
    if (isInstanceOf(openBtn, HTMLButtonElementCtor)) {
      const weekSetId = String(openBtn.getAttribute("data-news-review-open-week-set") || "");
      const reportId = String(openBtn.getAttribute("data-news-review-open-report") || "");
      if (typeof onNewsReviewOpenWeekSet === "function") {
        onNewsReviewOpenWeekSet(weekSetId, reportId);
      }
      return;
    }

    const rowEl = target.closest("tr[data-news-review-week-set-id]");
    if (isInstanceOf(rowEl, HTMLTableRowElementCtor)) {
      const weekSetId = String(rowEl.dataset.newsReviewWeekSetId || "");
      if (typeof onNewsReviewOpenWeekSet === "function") {
        onNewsReviewOpenWeekSet(weekSetId, "");
      }
    }
  });

  document
    ?.getElementById("newsReviewViewerCloseBtn")
    ?.addEventListener("click", () => {
      if (typeof onNewsReviewCloseViewer === "function") onNewsReviewCloseViewer();
    });
  document
    ?.getElementById("newsReviewViewerEditBtn")
    ?.addEventListener("click", () => {
      if (typeof onNewsReviewEditViewer === "function") onNewsReviewEditViewer();
    });
  document
    ?.getElementById("newsReviewViewerSaveBtn")
    ?.addEventListener("click", () => {
      if (typeof onNewsReviewSaveViewer === "function") onNewsReviewSaveViewer();
    });
  document
    ?.getElementById("newsReviewViewerPrevBtn")
    ?.addEventListener("click", () => {
      if (typeof onNewsReviewShiftViewer === "function") onNewsReviewShiftViewer(-1);
    });
  document
    ?.getElementById("newsReviewViewerNextBtn")
    ?.addEventListener("click", () => {
      if (typeof onNewsReviewShiftViewer === "function") onNewsReviewShiftViewer(1);
    });
  document
    ?.getElementById("newsReviewViewerApproveBtn")
    ?.addEventListener("click", () => {
      if (typeof onNewsReviewApplyViewerAction === "function") {
        onNewsReviewApplyViewerAction("approve");
      }
    });
  document
    ?.getElementById("newsReviewViewerRevisionBtn")
    ?.addEventListener("click", () => {
      if (typeof onNewsReviewApplyViewerAction === "function") {
        onNewsReviewApplyViewerAction("revision-requested");
      }
    });
  document?.getElementById("newsReviewViewerModal")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget && typeof onNewsReviewCloseViewer === "function") {
      onNewsReviewCloseViewer();
    }
  });
  document?.addEventListener("keydown", (event) => {
    const modalEl = document.getElementById("newsReviewViewerModal");
    if (!isInstanceOf(modalEl, HTMLDivElementCtor)) return;
    if (modalEl.classList.contains("hidden")) return;
    const key = String(event.key || "");
    if (key !== "ArrowLeft" && key !== "ArrowRight") return;
    const target = event.target;
    if (isInstanceOf(target, HTMLElementCtor)) {
      const tagName = String(target.tagName || "").toLowerCase();
      if (
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target.isContentEditable
      ) {
        return;
      }
    }
    event.preventDefault();
    if (typeof onNewsReviewShiftViewer === "function") {
      onNewsReviewShiftViewer(key === "ArrowLeft" ? -1 : 1);
    }
  });

  return {
    dispose() {},
  };
}
