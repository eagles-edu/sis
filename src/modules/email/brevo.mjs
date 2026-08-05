// @ts-check

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function configuredProvider() {
  const requested = normalizeLower(process.env.EMAIL_PROVIDER || "")
  if (requested === "brevo" || requested === "smtp") return requested
  return normalizeText(process.env.BREVO_API_KEY) ? "brevo" : "smtp"
}

export function isBrevoEmailProvider() {
  return configuredProvider() === "brevo"
}

export function getEmailProviderStatus() {
  const provider = configuredProvider()
  const fromEmail = normalizeText(process.env.BREVO_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER)
  return {
    provider,
    configured: provider === "smtp" || Boolean(normalizeText(process.env.BREVO_API_KEY)),
    fromEmail,
    endpoint: provider === "brevo"
      ? normalizeText(process.env.BREVO_API_URL) || "https://api.brevo.com/v3/smtp/email"
      : "",
  }
}

function brevoConfig() {
  const apiKey = normalizeText(process.env.BREVO_API_KEY)
  const fromEmail = normalizeText(process.env.BREVO_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER)
  const fromName = normalizeText(process.env.BREVO_FROM_NAME || "Eagles Student Admin")
  if (!apiKey) {
    const error = new Error("BREVO_API_KEY is required when EMAIL_PROVIDER=brevo")
    error.statusCode = 503
    throw error
  }
  if (!fromEmail) {
    const error = new Error("BREVO_FROM_EMAIL or SMTP_FROM is required when EMAIL_PROVIDER=brevo")
    error.statusCode = 503
    throw error
  }
  return {
    apiKey,
    fromEmail,
    fromName,
    endpoint: normalizeText(process.env.BREVO_API_URL) || "https://api.brevo.com/v3/smtp/email",
  }
}

function brevoStatisticsConfig() {
  const apiKey = normalizeText(process.env.BREVO_API_KEY)
  if (!apiKey) {
    const error = new Error("BREVO_API_KEY is required for Brevo statistics")
    error.statusCode = 503
    throw error
  }
  const configuredEndpoint = normalizeText(process.env.BREVO_API_URL)
  let apiBase = normalizeText(process.env.BREVO_API_BASE_URL)
  if (!apiBase && configuredEndpoint) {
    try {
      apiBase = new URL(configuredEndpoint).origin + "/v3"
    } catch (error) {
      void error
    }
  }
  return {
    apiKey,
    apiBase: (apiBase || "https://api.brevo.com/v3").replace(/\/$/, ""),
  }
}

async function getBrevoStatisticsResource(resource, params = {}) {
  const config = brevoStatisticsConfig()
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") query.set(key, String(value))
  }
  let response
  try {
    response = await fetch(`${config.apiBase}${resource}?${query.toString()}`, {
      method: "GET",
      headers: { accept: "application/json", "api-key": config.apiKey },
      signal: AbortSignal.timeout(15000),
    })
  } catch (cause) {
    const detail = normalizeText(cause?.message || cause)
    const error = new Error(`Brevo statistics request failed${detail ? `: ${detail}` : ""}`)
    error.statusCode = 503
    throw error
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = normalizeText(body?.message || body?.code || response.statusText)
    const error = new Error(`Brevo statistics request failed (${response.status})${detail ? `: ${detail}` : ""}`)
    error.statusCode = response.status >= 500 ? 503 : 502
    throw error
  }
  return body
}

/** @returns {Promise<Record<string, unknown>>} */
export async function getBrevoStatistics({ days = 30 } = {}) {
  const requestedDays = Math.min(90, Math.max(1, Number.parseInt(String(days), 10) || 30))
  const reportDays = Math.min(30, requestedDays)
  const [aggregated, reports] = await Promise.all([
    getBrevoStatisticsResource("/smtp/statistics/aggregatedReport", { days: requestedDays }),
    getBrevoStatisticsResource("/smtp/statistics/reports", { days: reportDays, sort: "asc" }),
  ])
  return {
    ok: true,
    days: requestedDays,
    reportDays,
    fetchedAt: new Date().toISOString(),
    aggregated,
    reports: Array.isArray(reports?.reports) ? reports.reports : [],
  }
}

/**
 * @param {{
 *   from?: { email?: unknown, name?: unknown },
 *   to?: Array<{ email?: unknown, name?: unknown }>,
 *   bcc?: Array<{ email?: unknown, name?: unknown }>,
 *   subject: string,
 *   text?: string,
 *   html?: string,
 *   idempotencyKey?: unknown,
 *   attachments?: Array<{ filename?: unknown, content?: unknown, contentType?: unknown }>,
 * }} message
 * @returns {Promise<{ messageId: string, provider: "brevo", duplicate?: boolean }>}
 */
export async function sendBrevoEmail(message) {
  const config = brevoConfig()
  const to = Array.isArray(message.to) ? message.to : []
  const bcc = Array.isArray(message.bcc) ? message.bcc : []
  const attachments = Array.isArray(message.attachments)
    ? message.attachments.map((attachment) => ({
        name: normalizeText(attachment.filename),
        content: Buffer.isBuffer(attachment.content)
          ? attachment.content.toString("base64")
          : normalizeText(attachment.content),
        ...(normalizeText(attachment.contentType)
          ? { contentType: normalizeText(attachment.contentType) }
          : {}),
      }))
    : []
  const idempotencyKey = normalizeText(message.idempotencyKey)
  const payload = {
    sender: {
      email: normalizeText(message.from?.email) || config.fromEmail,
      name: normalizeText(message.from?.name) || config.fromName,
    },
    to: to.map((entry) => ({ email: normalizeText(entry.email), ...(normalizeText(entry.name) ? { name: normalizeText(entry.name) } : {}) })),
    ...(bcc.length
      ? { bcc: bcc.map((entry) => ({ email: normalizeText(entry.email), ...(normalizeText(entry.name) ? { name: normalizeText(entry.name) } : {}) })) }
      : {}),
    subject: normalizeText(message.subject),
    textContent: normalizeText(message.text),
    htmlContent: normalizeText(message.html),
    ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
    ...(attachments.length ? { attachment: attachments } : {}),
  }

  let response
  try {
    response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": config.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    })
  } catch (cause) {
    const detail = normalizeText(cause?.message || cause)
    const error = new Error(`Brevo email request failed${detail ? `: ${detail}` : ""}`)
    error.statusCode = 503
    throw error
  }
  const responseBody = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (idempotencyKey && normalizeLower(responseBody?.code) === "duplicate_parameter") {
      return { messageId: "", provider: "brevo", duplicate: true }
    }
    const detail = normalizeText(responseBody?.message || responseBody?.code || response.statusText)
    const error = new Error(`Brevo email request failed (${response.status})${detail ? `: ${detail}` : ""}`)
    error.statusCode = response.status >= 500 ? 503 : 502
    throw error
  }
  return {
    messageId: normalizeText(responseBody?.messageId || responseBody?.messageIds?.[0]),
    provider: "brevo",
  }
}
