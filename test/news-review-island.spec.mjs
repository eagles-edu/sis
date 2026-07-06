import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"

const { initNewsReviewIsland } = await import(
  "../web-asset/admin/news-review-island.mjs"
)

test("news review island wires filters, actions, and modal controls", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <html>
        <body>
          <select id="newsReviewStatusFilter"><option value="all">All</option><option value="approved">Approved</option></select>
          <select id="newsReviewCheckFilter"><option value="all">All</option><option value="pending">Pending</option></select>
          <select id="newsReviewLevelFilter"><option value="">All levels</option><option value="A1">A1</option></select>
          <select id="newsReviewStudentFilter"><option value="">All students</option><option value="student-1">Student 1</option></select>
          <input id="newsReviewDateFromFilter" type="date">
          <input id="newsReviewDateToFilter" type="date">
          <input id="newsReviewQueryFilter" type="search">
          <button id="newsReviewRefreshBtn" type="button">Refresh</button>
          <button id="newsReviewClearFiltersBtn" type="button">Clear</button>
          <button id="newsReviewApproveQueueBtn" type="button">Approve Queue</button>
          <table>
            <tbody id="newsReviewRows">
              <tr data-news-review-week-set-id="week-1">
                <td>
                  <button
                    type="button"
                    data-news-review-open-week-set="week-1"
                    data-news-review-open-report="report-1"
                  >
                    Open
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div id="newsReviewViewerModal" class="hidden">
            <button id="newsReviewViewerCloseBtn" type="button">Close</button>
            <button id="newsReviewViewerPrevBtn" type="button">Prev</button>
            <button id="newsReviewViewerNextBtn" type="button">Next</button>
            <button id="newsReviewViewerApproveBtn" type="button">Approve</button>
            <button id="newsReviewViewerRevisionBtn" type="button">Revise</button>
          </div>
        </body>
      </html>`,
    { pretendToBeVisual: true, url: "http://127.0.0.1/" },
  )

  const events = []
  initNewsReviewIsland({
    document: dom.window.document,
    onNewsReviewStatusChange(value) {
      events.push(["status", value])
    },
    onNewsReviewCheckChange(value) {
      events.push(["check", value])
    },
    onNewsReviewLevelChange(level, studentRefId) {
      events.push(["level", level, studentRefId])
    },
    onNewsReviewStudentChange(value) {
      events.push(["student", value])
    },
    onNewsReviewDateRangeChange(fromIso, toIso) {
      events.push(["range", fromIso, toIso])
    },
    onNewsReviewQueryChange(value) {
      events.push(["query", value])
    },
    onNewsReviewRefresh() {
      events.push(["refresh"])
    },
    onNewsReviewClearFilters() {
      events.push(["clear"])
    },
    onNewsReviewApproveQueue() {
      events.push(["approve-queue"])
    },
    onNewsReviewOpenWeekSet(weekSetId, reportId) {
      events.push(["open", weekSetId, reportId])
    },
    onNewsReviewCloseViewer() {
      events.push(["close"])
    },
    onNewsReviewShiftViewer(direction) {
      events.push(["shift", direction])
    },
    onNewsReviewApplyViewerAction(action) {
      events.push(["action", action])
    },
  })

  const document = dom.window.document
  document.getElementById("newsReviewStatusFilter").value = "approved"
  document.getElementById("newsReviewStatusFilter").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("newsReviewCheckFilter").value = "pending"
  document.getElementById("newsReviewCheckFilter").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("newsReviewLevelFilter").value = "A1"
  document.getElementById("newsReviewLevelFilter").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("newsReviewStudentFilter").value = "student-1"
  document.getElementById("newsReviewStudentFilter").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("newsReviewDateFromFilter").value = "2026-03-15"
  document.getElementById("newsReviewDateToFilter").value = "2026-03-09"
  document.getElementById("newsReviewDateFromFilter").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("newsReviewQueryFilter").value = "market"
  document.getElementById("newsReviewQueryFilter").dispatchEvent(
    new dom.window.Event("input", { bubbles: true }),
  )
  document.getElementById("newsReviewRefreshBtn").click()
  document.getElementById("newsReviewClearFiltersBtn").click()
  document.getElementById("newsReviewApproveQueueBtn").click()
  document
    .querySelector('button[data-news-review-open-week-set="week-1"]')
    .click()
  document.getElementById("newsReviewViewerModal").classList.remove("hidden")
  document.getElementById("newsReviewViewerCloseBtn").click()
  document.getElementById("newsReviewViewerPrevBtn").click()
  document.getElementById("newsReviewViewerNextBtn").click()
  document.getElementById("newsReviewViewerApproveBtn").click()
  document.getElementById("newsReviewViewerRevisionBtn").click()
  document.getElementById("newsReviewViewerModal").dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true }),
  )
  document.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      key: "ArrowRight",
    }),
  )

  assert.deepEqual(events, [
    ["status", "approved"],
    ["check", "pending"],
    ["level", "A1", ""],
    ["student", "student-1"],
    ["range", "2026-03-09", "2026-03-15"],
    ["query", "market"],
    ["refresh"],
    ["clear"],
    ["approve-queue"],
    ["open", "week-1", "report-1"],
    ["close"],
    ["shift", -1],
    ["shift", 1],
    ["action", "approve"],
    ["action", "revision-requested"],
    ["close"],
    ["shift", 1],
  ])

  dom.window.close()
})
