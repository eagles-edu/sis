const DEFAULT_LANGUAGE = "en-US"
const DEFAULT_TIMEOUT_MS = 12000
const ESL_ENABLED_RULES = "ARTICLE_MISSING"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function isStyleMatch(match = {}) {
  const issueType = normalizeText(match?.issueType).toLowerCase()
  const category = normalizeText(match?.rule?.category?.id).toLowerCase()
  return issueType === "style" || category === "style"
}

function normalizeMatch(match = {}) {
  const from = Number.parseInt(String(match?.offset), 10)
  const length = Number.parseInt(String(match?.length), 10)
  const ruleId = normalizeText(match?.rule?.id || match?.rule?.subId || match?.rule?.category?.id)
  const message = normalizeText(match?.message || match?.shortMessage)
  if (!Number.isInteger(from) || from < 0 || !Number.isInteger(length) || length < 1 || !ruleId || !message) return null
  return {
    code: ruleId,
    ruleId,
    start: from,
    length,
    message,
    replacements: Array.isArray(match?.replacements)
      ? match.replacements.map((entry) => normalizeText(entry?.value)).filter(Boolean).slice(0, 5)
      : [],
    issueType: normalizeText(match?.issueType).toLowerCase() || "grammar",
    blocking: !isStyleMatch(match),
    severity: isStyleMatch(match) ? "advisory" : "blocking",
    source: "language-tool",
  }
}

export async function checkTextWithLanguageTool(text = "", options = {}) {
  const value = String(text == null ? "" : text)
  if (!value.trim()) return { matches: [], blockingIssues: [], advisoryIssues: [] }
  const endpoint = normalizeText(options?.endpoint)
  if (!endpoint) throw new Error("LanguageTool endpoint is not configured")
  const timeoutMs = Math.max(1000, Number.parseInt(String(options?.timeoutMs), 10) || DEFAULT_TIMEOUT_MS)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
  const body = new URLSearchParams({
    language: normalizeText(options?.language) || DEFAULT_LANGUAGE,
    text: value,
    enabledRules: normalizeText(options?.enabledRules) || ESL_ENABLED_RULES,
  })
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`LanguageTool returned HTTP ${response.status}`)
    const payload = await response.json()
    if (!payload || !Array.isArray(payload.matches)) throw new Error("LanguageTool returned an invalid response")
    const matches = payload.matches.map(normalizeMatch).filter(Boolean)
    return {
      matches,
      blockingIssues: matches.filter((match) => match.blocking),
      advisoryIssues: matches.filter((match) => !match.blocking),
    }
  } finally {
    clearTimeout(timeout)
  }
}
