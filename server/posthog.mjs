import { PostHog } from "posthog-node"

const token = String(process.env.POSTHOG_PROJECT_TOKEN || "").trim()
const host = String(process.env.POSTHOG_HOST || "").trim()
const isProduction = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production"

if ((!token || !host) && !isProduction) {
  const missingVariable = !token ? "POSTHOG_PROJECT_TOKEN" : "POSTHOG_HOST"
  throw new Error(
    `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`
  )
}

export const posthog = token && host
  ? new PostHog(token, {
      host,
      enableExceptionAutocapture: true,
      flushAt: 1,
      flushInterval: 0,
    })
  : null

export default posthog
