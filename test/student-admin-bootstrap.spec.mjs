import assert from "node:assert/strict"
import test from "node:test"
import { runStudentAdminAuthBootstrap } from "../web-asset/admin/student-admin-bootstrap.mjs"

test("student admin auth bootstrap handles static preview without API calls", async () => {
  const calls = []
  const result = await runStudentAdminAuthBootstrap({
    api() {
      calls.push("api")
    },
    state: {},
    showLogin() {
      calls.push("showLogin")
    },
    showApp() {
      calls.push("showApp")
    },
    setStatus(message, isError) {
      calls.push(["status", message, isError])
    },
    handleError(error) {
      calls.push(["error", error?.message || ""])
    },
    bootAfterLogin() {
      calls.push("boot")
    },
    isStaticAdminPreviewMode() {
      return true
    },
    ADMIN_API_ORIGIN: "",
    staticPreviewHelpMessage() {
      return "preview help"
    },
    currentRoleName() {
      return "admin"
    },
    normalizeRolePolicy(value) {
      return value
    },
    getCurrentRolePolicy() {
      return "policy"
    },
  })

  assert.deepEqual(result, { status: "preview" })
  assert.deepEqual(calls, ["showLogin", ["status", "preview help", true]])
})

test("student admin auth bootstrap loads session and runs post-login boot", async () => {
  const calls = []
  const result = await runStudentAdminAuthBootstrap({
    async api(path) {
      calls.push(["api", path])
      return {
        user: { username: "admin" },
        rolePolicy: { canManageUsers: true },
      }
    },
    state: {},
    showLogin() {
      calls.push("showLogin")
    },
    showApp() {
      calls.push("showApp")
    },
    setStatus(message, isError) {
      calls.push(["status", message, isError])
    },
    handleError(error) {
      calls.push(["error", error?.message || ""])
    },
    async bootAfterLogin() {
      calls.push("boot")
    },
    isStaticAdminPreviewMode() {
      return false
    },
    ADMIN_API_ORIGIN: "http://127.0.0.1",
    staticPreviewHelpMessage() {
      return "preview help"
    },
    currentRoleName() {
      return "admin"
    },
    normalizeRolePolicy(roleName, rolePolicy, currentPolicy) {
      calls.push(["normalizeRolePolicy", roleName, rolePolicy, currentPolicy])
      return { merged: true }
    },
    getCurrentRolePolicy() {
      return { current: true }
    },
  })

  assert.deepEqual(result, {
    status: "authenticated",
    user: { username: "admin" },
  })
  assert.deepEqual(calls, [
    ["api", "/api/admin/auth/me?bootstrap=1"],
    ["normalizeRolePolicy", "admin", { canManageUsers: true }, { current: true }],
    "showApp",
    ["status", "Authenticated as admin.", undefined],
    "boot",
  ])
})

test("late unauthenticated bootstrap cannot override a newer successful login", async () => {
  let resolveBootstrap
  const calls = []
  const state = { authUser: null }
  const bootstrap = runStudentAdminAuthBootstrap({
    api() {
      return new Promise((resolve) => {
        resolveBootstrap = resolve
      })
    },
    state,
    showLogin() {
      calls.push("showLogin")
    },
    showApp() {
      calls.push("showApp")
    },
    setStatus() {
      calls.push("setStatus")
    },
    isStaticAdminPreviewMode() {
      return false
    },
    ADMIN_API_ORIGIN: "http://127.0.0.1",
  })

  state.authUser = { username: "admin" }
  resolveBootstrap({ authenticated: false, reason: "no-session" })

  assert.deepEqual(await bootstrap, { status: "superseded" })
  assert.deepEqual(state.authUser, { username: "admin" })
  assert.deepEqual(calls, [])
})
