import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"

const { initSchoolSetupBrandingIsland } = await import(
  "../web-asset/admin/school-setup-branding-island.mjs"
)

test("school setup branding island wires preview, logo, save, and layout controls", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <html>
        <body>
          <input id="schoolSetupStartDate" value="2026-04-15">
          <input id="schoolSetupEndDate" value="2026-04-30">
          <input id="schoolSetupLetterGradeRanges" value="A:90-100">
          <button id="schoolSetupAutoFillBtn" type="button"></button>
          <input id="schoolSetupNewsSourceDefaultCnn" type="checkbox">
          <input id="schoolSetupNewsSourceDefaultBbc" type="checkbox">
          <input id="schoolSetupNewsSourceCustom1Enabled" type="checkbox">
          <input id="schoolSetupNewsSourceCustom1Domain" value="example.com">
          <input id="schoolSetupNewsSourceCustom2Enabled" type="checkbox">
          <input id="schoolSetupNewsSourceCustom2Domain" value="example.org">
          <input id="schoolSetupNewsSourceCustom3Enabled" type="checkbox">
          <input id="schoolSetupNewsSourceCustom3Domain" value="example.net">
          <input id="schoolSetupNewsSourceCustom4Enabled" type="checkbox">
          <input id="schoolSetupNewsSourceCustom4Domain" value="example.edu">
          <input id="schoolSetupNewsSourceCustom5Enabled" type="checkbox">
          <input id="schoolSetupNewsSourceCustom5Domain" value="example.io">
          <input id="schoolSetupNewsSourceCustom6Enabled" type="checkbox">
          <input id="schoolSetupNewsSourceCustom6Domain" value="example.ai">
          <input id="schoolSetupNewsSourceCustom7Enabled" type="checkbox">
          <input id="schoolSetupNewsSourceCustom7Domain" value="example.dev">
          <input id="schoolSetupNewsSourceCustom8Enabled" type="checkbox">
          <input id="schoolSetupNewsSourceCustom8Domain" value="example.test">
          <input id="schoolSetupLogoFile" type="file">
          <button id="schoolSetupLogoClearBtn" type="button"></button>
          <button id="schoolSetupSaveBtn" type="button"></button>
          <button id="schoolSetupResetBtn" type="button"></button>
          <button id="profileFieldLayoutApplyBtn" type="button"></button>
          <button id="profileFieldLayoutResetBtn" type="button"></button>
          <button id="profileFieldLayoutRefreshBtn" type="button"></button>
          <button id="profileFieldCreateBtn" type="button"></button>
          <table><tbody id="profileFieldLayoutRows">
            <tr data-profile-field-key="custom-1">
              <td>
                <button type="button" data-profile-layout-action="delete"></button>
              </td>
            </tr>
          </tbody></table>
        </body>
      </html>`,
    { pretendToBeVisual: true, url: "http://127.0.0.1/" },
  )

  const events = []
  initSchoolSetupBrandingIsland({
    document: dom.window.document,
    onSchoolSetupPreviewChange() {
      events.push("preview")
    },
    onSchoolSetupAutoFill() {
      events.push("autofill")
    },
    onSchoolSetupLogoChange() {
      events.push("logo-change")
    },
    onSchoolSetupLogoClear() {
      events.push("logo-clear")
    },
    onSchoolSetupSave() {
      events.push("save")
    },
    onSchoolSetupReset() {
      events.push("reset")
    },
    onProfileFieldLayoutApply() {
      events.push("layout-apply")
    },
    onProfileFieldLayoutReset() {
      events.push("layout-reset")
    },
    onProfileFieldLayoutRefresh() {
      events.push("layout-refresh")
    },
    onProfileFieldCreate() {
      events.push("field-create")
    },
    onProfileFieldLayoutRowDelete(key) {
      events.push(["layout-delete", key])
    },
  })

  const document = dom.window.document
  document.getElementById("schoolSetupStartDate").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("schoolSetupEndDate").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("schoolSetupLetterGradeRanges").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("schoolSetupAutoFillBtn").click()
  document.getElementById("schoolSetupNewsSourceDefaultCnn").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("schoolSetupNewsSourceCustom1Domain").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("schoolSetupLogoFile").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("schoolSetupLogoClearBtn").click()
  document.getElementById("schoolSetupSaveBtn").click()
  document.getElementById("schoolSetupResetBtn").click()
  document.getElementById("profileFieldLayoutApplyBtn").click()
  document.getElementById("profileFieldLayoutResetBtn").click()
  document.getElementById("profileFieldLayoutRefreshBtn").click()
  document.getElementById("profileFieldCreateBtn").click()
  document.querySelector('button[data-profile-layout-action="delete"]').click()

  assert.deepEqual(events, [
    "preview",
    "preview",
    "preview",
    "autofill",
    "preview",
    "preview",
    "logo-change",
    "logo-clear",
    "save",
    "reset",
    "layout-apply",
    "layout-reset",
    "layout-refresh",
    "field-create",
    ["layout-delete", "custom-1"],
  ])

  dom.window.close()
})
