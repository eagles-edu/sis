const providers = new Map()

function providerError(message) {
  const error = new Error(message)
  error.statusCode = 500
  return error
}

export function registerDictionaryProvider(provider) {
  const key = String(provider?.key || "").trim().toLowerCase()
  if (!key || typeof provider?.preview !== "function") throw providerError("Dictionary providers require a key and preview function")
  providers.set(key, Object.freeze({ ...provider, key }))
  return providers.get(key)
}

export function getDictionaryProvider(key) {
  const normalized = String(key || "").trim().toLowerCase()
  return providers.get(normalized) || null
}

export function listDictionaryProviders() {
  return [...providers.keys()]
}
