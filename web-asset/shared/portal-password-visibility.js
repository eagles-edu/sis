(() => {
  "use strict"

  const eyeIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.2 12s3.5-6 9.8-6 9.8 6 9.8 6-3.5 6-9.8 6-9.8-6-9.8-6Z"></path>
      <circle cx="12" cy="12" r="2.5"></circle>
    </svg>
  `

  function bind(root = document) {
    root.querySelectorAll("[data-password-visibility]").forEach((input) => {
      if (!(input instanceof HTMLInputElement) || input.dataset.passwordVisibilityBound === "1") return
      const field = input.closest(".password-visibility-field")
      const button = field?.querySelector("[data-password-visibility-toggle]")
      if (!(button instanceof HTMLButtonElement)) return
      input.dataset.passwordVisibilityBound = "1"
      button.innerHTML = eyeIcon
      button.addEventListener("click", () => {
        const visible = input.type === "text"
        input.type = visible ? "password" : "text"
        button.setAttribute("aria-pressed", visible ? "false" : "true")
        button.setAttribute("aria-label", visible ? "Show password" : "Hide password")
        button.title = visible ? "Show password" : "Hide password"
      })
    })
  }

  window.SIS_PASSWORD_VISIBILITY = { bind }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => bind(), { once: true })
  } else {
    bind()
  }
})()
