import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"

const { initParentTrackingIsland } = await import(
  "../web-asset/admin/parent-tracking-island.mjs"
)

test("parent tracking island wires page controls and queue actions", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <html>
        <body>
          <div class="page-section" data-page="parent-tracking">
            <input id="pt_classDate" value="2026-04-15">
            <input id="pt_studentRefId" value="stu-01">
            <input id="pt_teacherName" value="Teacher">
            <textarea id="pt_lessonSummary"></textarea>
            <textarea name="pt_rec_listening"></textarea>
            <input type="number" name="pt_skill_questions" value="3">
            <input type="number" name="pt_conduct_focus" value="2">
            <button id="pt_actionInsertBtn" type="button"></button>
            <button id="pt_actionClearBtn" type="button"></button>
            <button id="pt_saveBtn" type="button"></button>
            <button id="pt_queueSendBtn" type="button"></button>
            <button id="pt_clearBtn" type="button"></button>
            <button id="performanceQueueExpandBtn" type="button"></button>
            <button id="overviewIncomingExerciseExpandBtn" type="button"></button>
            <button id="overviewIncomingExerciseRefreshBtn" type="button"></button>
            <button id="performanceQueueRefreshBtn" type="button"></button>
            <button id="performanceQueueSendAllBtn" type="button"></button>
            <button id="performanceStagedRefreshBtn" type="button"></button>
            <button id="parentQueueCloseBtn" type="button"></button>
            <button id="parentQueuePrevBtn" type="button"></button>
            <button id="parentQueueNextBtn" type="button"></button>
            <button id="parentQueueHoldBtn" type="button"></button>
            <button id="parentQueueEditBtn" type="button"></button>
            <button id="parentQueueRequeueBtn" type="button"></button>
            <button id="parentQueueSendAllBtn" type="button"></button>
            <div id="parentQueueModal"></div>
          </div>
        </body>
      </html>`,
    { pretendToBeVisual: true, url: "http://127.0.0.1/" },
  )

  const events = []
  initParentTrackingIsland({
    document: dom.window.document,
    onParentTrackingClassDateChange() {
      events.push("class-date")
    },
    onParentTrackingStudentRefChange() {
      events.push("student-ref")
    },
    onParentTrackingTeacherChange() {
      events.push("teacher")
    },
    onParentTrackingLessonSummaryInput() {
      events.push("lesson")
    },
    onParentTrackingRecommendationFocus(name) {
      events.push(["focus", name])
    },
    onParentTrackingRubricChange() {
      events.push("rubric-change")
    },
    onParentTrackingRubricInput() {
      events.push("rubric-input")
    },
    onParentTrackingActionInsert() {
      events.push("insert")
    },
    onParentTrackingActionClear() {
      events.push("action-clear")
    },
    onParentTrackingSave() {
      events.push("save")
    },
    onParentTrackingQueueSend() {
      events.push("queue-send")
    },
    onParentTrackingClear() {
      events.push("clear")
    },
    onPerformanceQueueExpand() {
      events.push("perf-expand")
    },
    onOverviewIncomingExerciseExpand() {
      events.push("incoming-expand")
    },
    onOverviewIncomingExerciseRefresh() {
      events.push("incoming-refresh")
    },
    onPerformanceQueueRefresh() {
      events.push("perf-refresh")
    },
    onPerformanceQueueSendAll() {
      events.push("perf-send-all")
    },
    onPerformanceStagedRefresh() {
      events.push("staged-refresh")
    },
    onParentQueueClose() {
      events.push("queue-close")
    },
    onParentQueuePrev() {
      events.push("queue-prev")
    },
    onParentQueueNext() {
      events.push("queue-next")
    },
    onParentQueueHold() {
      events.push("queue-hold")
    },
    onParentQueueEdit() {
      events.push("queue-edit")
    },
    onParentQueueRequeue() {
      events.push("queue-requeue")
    },
    onParentQueueSendAll() {
      events.push("queue-send-all")
    },
    onParentQueueModalClick() {
      events.push("queue-modal-click")
    },
  })

  const document = dom.window.document
  document.getElementById("pt_classDate").dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  document.getElementById("pt_studentRefId").dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  document.getElementById("pt_teacherName").dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  document.getElementById("pt_lessonSummary").dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  document.querySelector('textarea[name="pt_rec_listening"]').dispatchEvent(
    new dom.window.Event("focusin", { bubbles: true }),
  )
  document
    .querySelector('input[name="pt_skill_questions"]')
    .dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  document
    .querySelector('input[name="pt_conduct_focus"]')
    .dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  document.getElementById("pt_actionInsertBtn").click()
  document.getElementById("pt_actionClearBtn").click()
  document.getElementById("pt_saveBtn").click()
  document.getElementById("pt_queueSendBtn").click()
  document.getElementById("pt_clearBtn").click()
  document.getElementById("performanceQueueExpandBtn").click()
  document.getElementById("overviewIncomingExerciseExpandBtn").click()
  document.getElementById("overviewIncomingExerciseRefreshBtn").click()
  document.getElementById("performanceQueueRefreshBtn").click()
  document.getElementById("performanceQueueSendAllBtn").click()
  document.getElementById("performanceStagedRefreshBtn").click()
  document.getElementById("parentQueueCloseBtn").click()
  document.getElementById("parentQueuePrevBtn").click()
  document.getElementById("parentQueueNextBtn").click()
  document.getElementById("parentQueueHoldBtn").click()
  document.getElementById("parentQueueEditBtn").click()
  document.getElementById("parentQueueRequeueBtn").click()
  document.getElementById("parentQueueSendAllBtn").click()
  document.getElementById("parentQueueModal").dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true }),
  )

  assert.deepEqual(events, [
    "class-date",
    "student-ref",
    "teacher",
    "lesson",
    ["focus", "pt_rec_listening"],
    "rubric-change",
    "rubric-input",
    "insert",
    "action-clear",
    "save",
    "queue-send",
    "clear",
    "perf-expand",
    "incoming-expand",
    "incoming-refresh",
    "perf-refresh",
    "perf-send-all",
    "staged-refresh",
    "queue-close",
    "queue-prev",
    "queue-next",
    "queue-hold",
    "queue-edit",
    "queue-requeue",
    "queue-send-all",
    "queue-modal-click",
  ])

  dom.window.close()
})
