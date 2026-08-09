(() => {
  "use strict"

  const ACTION_LIFETIME_MS = 8000
  const LOCAL_ACTION_DELAY_MS = 850
  const RESULT_VISIBLE_MS = 3600
  const activeActions = []
  let feedbackRoot = null
  let feedbackMessage = null

  function text(value) {
    return String(value ?? "").replace(/\s+/gu, " ").trim()
  }

  function labelFor(button) {
    if (!button) return "Action"
    return (
      text(button.getAttribute("aria-label")) ||
      text(button.getAttribute("title")) ||
      text(button.value) ||
      text(button.textContent) ||
      "Action"
    )
  }

  function ensureFeedbackRoot() {
    if (feedbackRoot && document.contains(feedbackRoot)) return feedbackRoot
    if (!document.body) return null
    feedbackRoot = document.createElement("div")
    feedbackRoot.className = "sis-action-feedback"
    feedbackRoot.hidden = true
    feedbackRoot.setAttribute("role", "status")
    feedbackRoot.setAttribute("aria-live", "polite")
    feedbackRoot.setAttribute("aria-atomic", "true")
    feedbackMessage = document.createElement("span")
    feedbackMessage.className = "sis-action-feedback__message"
    feedbackRoot.appendChild(feedbackMessage)
    document.body.appendChild(feedbackRoot)
    return feedbackRoot
  }

  function showRoot(state, message) {
    const root = ensureFeedbackRoot()
    if (!root || !feedbackMessage) return
    root.hidden = false
    root.dataset.state = state
    feedbackMessage.textContent = message
    if (state !== "pending") {
      window.clearTimeout(root._hideTimer)
      root._hideTimer = window.setTimeout(() => {
        root.hidden = true
      }, RESULT_VISIBLE_MS)
    }
  }

  function actionMessage(action, state, message = "") {
    const detail = text(message)
    if (state === "pending") return `Working: ${action.label}...`
    if (state === "error") return `Error: ${detail || `${action.label} failed.`}`
    return `OK: ${detail || `${action.label} activated.`}`
  }

  function setButtonState(action, state, message = "") {
    if (!action?.button) return
    action.button.dataset.actionFeedbackState = state
    action.button.dataset.actionFeedbackMessage = text(message)
    if (state === "pending") {
      action.button.setAttribute("aria-busy", "true")
    } else {
      action.button.removeAttribute("aria-busy")
      window.setTimeout(() => {
        if (action.button.dataset.actionFeedbackState === state) {
          delete action.button.dataset.actionFeedbackState
          delete action.button.dataset.actionFeedbackMessage
        }
      }, RESULT_VISIBLE_MS)
    }
  }

  function pruneActions() {
    const cutoff = Date.now() - ACTION_LIFETIME_MS
    for (let index = activeActions.length - 1; index >= 0; index -= 1) {
      if (activeActions[index].startedAt < cutoff || activeActions[index].state !== "pending") {
        activeActions.splice(index, 1)
      }
    }
  }

  function latestAction(button = null) {
    pruneActions()
    for (let index = activeActions.length - 1; index >= 0; index -= 1) {
      const action = activeActions[index]
      if (!button || action.button === button) return action
    }
    return null
  }

  function finish(action, state, message = "") {
    if (!action || action.state !== "pending") return false
    action.state = state
    window.clearTimeout(action.fallbackTimer)
    const visibleMessage = actionMessage(action, state, message)
    setButtonState(action, state, message)
    showRoot(state, visibleMessage)
    return true
  }

  function begin(button, source = "click") {
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return null
    const previous = latestAction(button)
    if (previous) finish(previous, "ok", "Superseded by the latest action.")
    const action = {
      button,
      label: labelFor(button),
      source,
      startedAt: Date.now(),
      state: "pending",
      requestCount: 0,
      settledRequestCount: 0,
      fallbackTimer: null,
    }
    activeActions.push(action)
    setButtonState(action, "pending")
    showRoot("pending", actionMessage(action, "pending"))
    action.fallbackTimer = window.setTimeout(() => {
      if (!action.requestCount) finish(action, "ok")
      else if (action.settledRequestCount >= action.requestCount) finish(action, "ok")
    }, LOCAL_ACTION_DELAY_MS)
    window.setTimeout(() => {
      if (action.state === "pending") finish(action, "ok", "Action accepted.")
    }, ACTION_LIFETIME_MS)
    return action
  }

  function result(state, message = "", button = null) {
    const action = latestAction(button)
    if (!action) return false
    return finish(action, state === "error" ? "error" : "ok", message)
  }

  function status(message = "", isError = false, button = null) {
    const action = latestAction(button)
    if (!action) return false
    const normalized = text(message)
    if (isError) return finish(action, "error", normalized)
    if (/\b(authenticat|check|delet|fetch|load|process|record|refresh|reload|save|send|sign|submit|sync|updat|upload|wait|work)\w*/iu.test(normalized)) {
      showRoot("pending", `Working: ${normalized || action.label}...`)
      return true
    }
    return finish(action, "ok", normalized)
  }

  function isActionButton(target) {
    if (!(target instanceof Element)) return null
    const button = target.closest("button, [role=button], input[type=button], input[type=submit], input[type=reset]")
    if (!button || button.closest("[data-action-feedback-ignore]")) return null
    return button
  }

  function installFetchObserver() {
    if (typeof window.fetch !== "function" || window.fetch.__sisActionFeedbackWrapped) return
    const originalFetch = window.fetch.bind(window)
    const wrappedFetch = (...args) => {
      const action = latestAction()
      const withinActionWindow = action && Date.now() - action.startedAt <= ACTION_LIFETIME_MS
      if (withinActionWindow) action.requestCount += 1
      const request = originalFetch(...args)
      if (!withinActionWindow) return request
      Promise.resolve(request).then((response) => {
        action.settledRequestCount += 1
        if (!response.ok) {
          response.clone().json().catch(() => null).then((payload) => {
            const detail = text(payload?.error) || text(payload?.message) || `Request failed (${response.status}).`
            finish(action, "error", detail)
          })
        } else if (action.state === "pending" && action.settledRequestCount >= action.requestCount) {
          window.setTimeout(() => finish(action, "ok"), 120)
        }
        return response
      }).catch((error) => {
        action.settledRequestCount += 1
        finish(action, "error", error?.message || "The request could not be completed.")
      })
      return request
    }
    wrappedFetch.__sisActionFeedbackWrapped = true
    window.fetch = wrappedFetch
  }

  function install() {
    if (typeof document === "undefined") return
    installFetchObserver()
    document.addEventListener("click", (event) => {
      const button = isActionButton(event.target)
      if (button) begin(button, "click")
    }, true)
    document.addEventListener("submit", (event) => {
      const submitter = event.submitter || event.target?.querySelector?.("button[type=submit], input[type=submit]")
      if (submitter && !latestAction(submitter)) begin(submitter, "submit")
    }, true)
    window.addEventListener("error", (event) => {
      const action = latestAction()
      if (action && Date.now() - action.startedAt <= ACTION_LIFETIME_MS) {
        finish(action, "error", event.message || "The action raised an error.")
      }
    })
    window.addEventListener("unhandledrejection", (event) => {
      const action = latestAction()
      if (action && Date.now() - action.startedAt <= ACTION_LIFETIME_MS) {
        finish(action, "error", event.reason?.message || "The action could not be completed.")
      }
    })
  }

  window.SIS_ACTION_FEEDBACK = Object.freeze({
    begin,
    status,
    ok: (message = "", button = null) => result("ok", message, button),
    error: (message = "", button = null) => result("error", message, button),
    result,
  })

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true })
  else install()
})()
