import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"

const { initProfileIsland } = await import("../web-asset/admin/profile-island.mjs")

test("profile island wires profile and student form controls", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <html>
        <body>
          <div class="page-section" data-page="profile">
            <button id="newBtn" type="button"></button>
            <button id="studentClearBtn" type="button"></button>
            <button id="saveBtn" type="button"></button>
            <button id="deleteBtn" type="button"></button>
            <button id="profileEditInfoBtn" type="button"></button>
            <button id="profileCreateInfoBtn" type="button"></button>
            <button id="profileRefreshInfoBtn" type="button"></button>
            <button id="profileBackToInfoBtn" type="button"></button>
            <select id="f_currentGrade"><option value="A1">A1</option></select>
            <form id="profileEditorForm"></form>
          </div>
        </body>
      </html>`,
    { pretendToBeVisual: true, url: "http://127.0.0.1/" },
  )

  const events = []
  initProfileIsland({
    document: dom.window.document,
    onProfileNewStudent() {
      events.push("new")
    },
    onProfileClearStudent() {
      events.push("clear")
    },
    onProfileSaveStudent() {
      events.push("save")
    },
    onProfileDeleteStudent() {
      events.push("delete")
    },
    onProfileEditInfo() {
      events.push("edit")
    },
    onProfileCreateInfo() {
      events.push("create")
    },
    onProfileRefreshInfo() {
      events.push("refresh")
    },
    onProfileBackToInfo() {
      events.push("back")
    },
    onProfileCurrentGradeChange(value) {
      events.push(["grade", value])
    },
    onProfileEditorSubmit(event) {
      event.preventDefault()
      events.push("submit")
    },
  })

  const document = dom.window.document
  document.getElementById("newBtn").click()
  document.getElementById("studentClearBtn").click()
  document.getElementById("saveBtn").click()
  document.getElementById("deleteBtn").click()
  document.getElementById("profileEditInfoBtn").click()
  document.getElementById("profileCreateInfoBtn").click()
  document.getElementById("profileRefreshInfoBtn").click()
  document.getElementById("profileBackToInfoBtn").click()
  document.getElementById("f_currentGrade").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("profileEditorForm").dispatchEvent(
    new dom.window.Event("submit", { bubbles: true, cancelable: true }),
  )

  assert.deepEqual(events, [
    "new",
    "clear",
    "save",
    "delete",
    "edit",
    "create",
    "refresh",
    "back",
    ["grade", "A1"],
    "submit",
  ])

  dom.window.close()
})
