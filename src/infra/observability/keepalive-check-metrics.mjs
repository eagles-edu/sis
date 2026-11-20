const GROUP_STALE_AFTER_SECONDS = Object.freeze({
  parent_profile: { dev: 1200, test: 1200 },
  engagement: { dev: 180, test: 180 },
  student_library: { dev: 900, test: 900 },
  student_news: { dev: 900, test: 900 },
  dictionary_builder: { dev: 900, test: 900 },
  assignment_notifications: { dev: 180, test: 180 },
  grade_feeds: { dev: 900, test: 900 },
  attendance: { dev: 900, test: 900 },
  parent_reports: { dev: 180, test: 180 },
  student_profile_enrollment: { dev: 180, test: 180 },
})

const FAILURE_CODES = new Set([
  "none",
  "workflow_failed",
  "dependency_unavailable",
  "cleanup_failed",
  "configuration_invalid",
])

function metricNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new TypeError("Keep-alive metric values must be finite non-negative numbers")
  return number.toFixed(6)
}

function environmentLabel(environment) {
  if (environment === "dev" || environment === "test") return environment
  throw new TypeError("Keep-alive metrics require a controlled environment label")
}

export function readKeepaliveLastSuccess(contents, environment, group) {
  const label = environmentLabel(environment)
  if (!Object.hasOwn(GROUP_STALE_AFTER_SECONDS, group)) throw new TypeError("Unknown keep-alive check group")
  const escapedGroup = group.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = String(contents || "").match(new RegExp(`^sis_keepalive_check_last_success_timestamp_seconds\\{environment="${label}",group="${escapedGroup}"\\} ([0-9]+(?:\\.[0-9]+)?)$`, "mu"))
  return match ? Number(match[1]) : 0
}

export function renderKeepaliveCheckMetrics({ environment, checkedAt, results, previousMetrics = "" }) {
  const label = environmentLabel(environment)
  const entries = Object.entries(results || {})
  if (!entries.length) return ""
  const lines = [
    "# HELP sis_keepalive_check_success Whether the latest run of a logical keep-alive check group passed.",
    "# TYPE sis_keepalive_check_success gauge",
    "# HELP sis_keepalive_check_last_check_timestamp_seconds Unix timestamp of the latest run of a logical keep-alive check group.",
    "# TYPE sis_keepalive_check_last_check_timestamp_seconds gauge",
    "# HELP sis_keepalive_check_last_success_timestamp_seconds Unix timestamp of the latest successful run of a logical keep-alive check group.",
    "# TYPE sis_keepalive_check_last_success_timestamp_seconds gauge",
    "# HELP sis_keepalive_check_duration_seconds Duration of the latest run of a logical keep-alive check group.",
    "# TYPE sis_keepalive_check_duration_seconds gauge",
    "# HELP sis_keepalive_check_stale_after_seconds Configured freshness limit; zero disables scheduled staleness checks for on-demand groups.",
    "# TYPE sis_keepalive_check_stale_after_seconds gauge",
    "# HELP sis_keepalive_check_failure_info Bounded failure category for the latest check; exactly one category is one.",
    "# TYPE sis_keepalive_check_failure_info gauge",
  ]
  for (const [group, result] of entries) {
    if (!Object.hasOwn(GROUP_STALE_AFTER_SECONDS, group)) throw new TypeError("Unknown keep-alive check group")
    if (typeof result?.success !== "boolean") throw new TypeError("Keep-alive check result must be boolean")
    const failureCode = result.success ? "none" : String(result.failureCode || "workflow_failed")
    if (!FAILURE_CODES.has(failureCode)) throw new TypeError("Keep-alive failure code is not in the bounded vocabulary")
    const staleAfter = GROUP_STALE_AFTER_SECONDS[group][label]
    const lastSuccess = result.success
      ? checkedAt
      : readKeepaliveLastSuccess(previousMetrics, label, group)
    const groupLabel = `environment="${label}",group="${group}"`
    lines.push(
      `sis_keepalive_check_success{${groupLabel}} ${result.success ? 1 : 0}`,
      `sis_keepalive_check_last_check_timestamp_seconds{${groupLabel}} ${metricNumber(checkedAt)}`,
      `sis_keepalive_check_last_success_timestamp_seconds{${groupLabel}} ${metricNumber(lastSuccess)}`,
      `sis_keepalive_check_duration_seconds{${groupLabel}} ${metricNumber(result.durationSeconds)}`,
      `sis_keepalive_check_stale_after_seconds{${groupLabel}} ${metricNumber(staleAfter)}`,
      `sis_keepalive_check_failure_info{${groupLabel},code="${failureCode}"} 1`,
    )
  }
  return `${lines.join("\n")}\n`
}
