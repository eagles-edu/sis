export function initOverviewNewsQueueIsland({
  document,
  onOverviewNewsQueueRefresh,
  onOverviewNewsQueueOpen,
  onOverviewNewsQueueQueueHub,
} = {}) {
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
