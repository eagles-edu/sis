export function initQueueHubIsland({
  document,
  onQueueHubItemOpen,
  onQueueHubRefresh,
  onQueueHubSaveOrder,
  onQueueHubResetOrder,
} = {}) {
  const queueHubPanelsEl = document?.getElementById("queueHubPanels");
  queueHubPanelsEl?.addEventListener("click", (event) => {
    const target = event?.target;
    const ElementCtor = globalThis.Element;
    if (typeof ElementCtor !== "function" || !(target instanceof ElementCtor)) return;
    const openLink = target.closest(
      "[data-queue-hub-open-panel][data-queue-hub-open-index]",
    );
    const HTMLElementCtor = globalThis.HTMLElement;
    if (typeof HTMLElementCtor !== "function" || !(openLink instanceof HTMLElementCtor)) return;
    const panelId = String(openLink.getAttribute("data-queue-hub-open-panel") || "");
    const rowIndex = Number.parseInt(
      String(openLink.getAttribute("data-queue-hub-open-index") || ""),
      10,
    );
    const HTMLAnchorElementCtor = globalThis.HTMLAnchorElement;
    if (
      typeof HTMLAnchorElementCtor === "function" &&
      openLink instanceof HTMLAnchorElementCtor
    ) {
      event.preventDefault();
    }
    if (typeof onQueueHubItemOpen === "function") {
      onQueueHubItemOpen(panelId, Number.isFinite(rowIndex) ? rowIndex : 0);
    }
  });
  document?.getElementById("queueHubRefreshBtn")?.addEventListener("click", () => {
    if (typeof onQueueHubRefresh === "function") onQueueHubRefresh();
  });
  document?.getElementById("queueHubSaveOrderBtn")?.addEventListener("click", () => {
    if (typeof onQueueHubSaveOrder === "function") onQueueHubSaveOrder();
  });
  document?.getElementById("queueHubResetOrderBtn")?.addEventListener("click", () => {
    if (typeof onQueueHubResetOrder === "function") onQueueHubResetOrder();
  });

  return {
    dispose() {},
  };
}
