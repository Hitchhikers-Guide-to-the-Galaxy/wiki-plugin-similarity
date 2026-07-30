// wiki-plugin-similarity — page vectors, embedding, and the cosine scan over them
// Split out of similarity.js; see the Splitting the Server phase of the plan.

import { resolveDomains } from './scope.js'

// ── Vector loading ────────────────────────────────────────────────────────────

const vectorCache = new Map()

// Route vector requests through the current wiki's plugin server. This keeps
// public HTTPS pages same-origin, avoids CORS failures, and lets the server read
// indices from its configured farm roots.
const vectorUrl = domain =>
  `${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(domain)}`

const loadVectors = async domain => {
  if (vectorCache.has(domain)) return vectorCache.get(domain)
  const res = await fetch(vectorUrl(domain))
  if (!res.ok) return []
  const data = await res.json()
  vectorCache.set(domain, data)
  return data
}

// ── Embedding ─────────────────────────────────────────────────────────────────

// POST, never GET: page-length text in a query string overflows Node's header
// limit and dies with 431 before any handler runs (server ≥ 0.11.0).
const getEmbedding = async (text, origin) => {
  const res = await fetch(`${origin}/system/embed.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`embed failed: ${res.status}`)
  return (await res.json()).vector
}

// Look up an existing page vector from the current domain's cached index.
// Returns the float[] vector if found, null otherwise.
const lookupPageVector = async (slug, domain) => {
  const pages = await loadVectors(domain)
  const entry = pages.find(p => p.slug === slug)
  return entry ? entry.vector : null
}
// ── Cosine search ─────────────────────────────────────────────────────────────

const cosineScan = (queryVec, domainEntries, { threshold, limit, excludeSlug, excludeDomain }) => {
  const results = []
  for (const { domain, pages } of domainEntries) {
    for (const { slug, title, vector } of pages) {
      if (slug === excludeSlug && domain === excludeDomain) continue
      let dot = 0
      for (let i = 0; i < queryVec.length; i++) dot += queryVec[i] * vector[i]
      if (dot >= threshold) results.push({ domain, slug, title, score: dot })
    }
  }
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

// ── Shared domain loading ─────────────────────────────────────────────────────

const loadDomainEntries = async (specs, origin) => {
  const domains = await resolveDomains(specs, origin)
  const entries = await Promise.all(
    domains.map(async ({ domain }) => ({ domain, pages: await loadVectors(domain) }))
  )
  return entries.filter(e => e.pages.length > 0)
}

export { loadVectors, vectorUrl, getEmbedding, lookupPageVector, cosineScan, loadDomainEntries }
