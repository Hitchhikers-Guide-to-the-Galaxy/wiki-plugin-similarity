// wiki-plugin-similarity — per-item result cache in localStorage
// Split out of similarity.js; see the Splitting the Server phase of the plan.

// ── Result cache (localStorage) ──────────────────────────────────────────────
// Cache is keyed by item id. Invalidated when item.text changes (DSL edited).
// LIVE mode bypasses the cache entirely.

const cacheKey = id => `sim-cache-${id}`

const readCache = item => {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey(item.id)) || 'null')
    return c?.text === (item.text || '') ? c : null
  } catch { return null }
}

const writeCache = (item, data) => {
  try {
    localStorage.setItem(cacheKey(item.id), JSON.stringify({
      text: item.text || '',
      ts:   Date.now(),
      ...data,
    }))
  } catch { /* storage unavailable or full */ }
}

const cacheAge = ts => {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export { readCache, writeCache, cacheAge }
