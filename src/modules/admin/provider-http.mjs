const PROVIDER_BACKOFF_BASE_MS = 250
const PROVIDER_BACKOFF_MAX_MS = 2000
const PROVIDER_BACKOFF_ATTEMPTS = 3

function isTransientProviderFailure(error, response) {
  return Boolean(error) || [429, 500, 502, 503, 504].includes(Number(response?.status))
}

export async function fetchWithExponentialBackoff(fetchImpl, url, options) {
  let lastError
  for (let attempt = 0; attempt < PROVIDER_BACKOFF_ATTEMPTS; attempt += 1) {
    if (options?.signal?.aborted) throw options.signal.reason || new Error("Provider request aborted")
    let response
    try {
      response = await fetchImpl(url, options)
      if (!isTransientProviderFailure(null, response) || attempt === PROVIDER_BACKOFF_ATTEMPTS - 1) return response
    } catch (error) {
      if (options?.signal?.aborted) throw options.signal.reason || error
      lastError = error
      if (attempt === PROVIDER_BACKOFF_ATTEMPTS - 1) throw error
    }
    const delayMs = Math.min(PROVIDER_BACKOFF_MAX_MS, PROVIDER_BACKOFF_BASE_MS * (2 ** attempt))
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs)
      if (!options?.signal) return
      const abort = () => { clearTimeout(timer); reject(options.signal.reason || new Error("Provider request aborted")) }
      options.signal.addEventListener("abort", abort, { once: true })
      const cleanup = () => options.signal.removeEventListener("abort", abort)
      options.signal.addEventListener("abort", cleanup, { once: true })
      setTimeout(cleanup, delayMs)
    })
  }
  throw lastError || new Error("Provider request failed after exponential backoff")
}
