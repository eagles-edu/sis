export function initOverviewNewsQueueIsland({
  document,
  onOverviewNewsQueueRefresh,
  onOverviewNewsQueueOpen,
  onOverviewNewsQueueQueueHub,
  onOverviewNewsQueueShowAll,
} = {}) {
  document?.getElementById("overviewNewsQueueShowAllBtn")?.addEventListener(
    "click",
    () => {
      if (typeof onOverviewNewsQueueShowAll === "function") {
        onOverviewNewsQueueShowAll();
      }
    },
  );
  document?.getElementById("overviewNewsQueueRefreshBtn")?.addEventListener(
    "click",
    () => {
      if (typeof onOverviewNewsQueueRefresh === "function") {
        onOverviewNewsQueueRefresh();
      }
    },
  );
  document?.getElementById("overviewNewsQueueOpenBtn")?.addEventListener("click", () => {
    if (typeof onOverviewNewsQueueOpen === "function") {
      onOverviewNewsQueueOpen();
    }
  });
  document?.getElementById("overviewNewsQueueQueueHubBtn")?.addEventListener(
    "click",
    () => {
      if (typeof onOverviewNewsQueueQueueHub === "function") {
        onOverviewNewsQueueQueueHub();
      }
    },
  );

  return {
    dispose() {},
  };
}
