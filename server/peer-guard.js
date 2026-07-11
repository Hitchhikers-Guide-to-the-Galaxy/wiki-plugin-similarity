// wiki-plugin-similarity — peer-search guards (CommonJS)
//
// v1 trust mechanics for the FARM prototype (experimental). A peer request is
// served only when every guard passes:
//   - allowlist: the requesting farm appears in the serving site's own
//     `search-peers` page (a roster item — configuration as a wiki page)
//   - hops: v1 answers locally only, never re-forwards (hops must be 0)
//   - dedup: a request-id LRU drops replayed/looped envelopes
//   - rate: a small per-origin token bucket protects the embedder
//
// The allowlist seam is deliberately narrow: later versions swap the roster
// check for shared-secret pairs (v2) and trust-graph attestation (v3) without
// touching the callers.

const fs   = require('node:fs')
const path = require('node:path')

const SITE_LINE = /^([a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+|localhost)(:\d+)?$/

// ── Allowlist: roster item on the serving site's search-peers page ────────────

const readPeerRoster = (farms, servingDomain, slug = null) => {
  slug = slug || process.env.WIKI_SEARCH_PEERS_PAGE || 'search-peers'
  for (const [farm] of farms) {
    const p = path.join(farm, servingDomain, 'pages', slug)
    let page
    try { page = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { continue }
    const allowed = new Set()
    for (const item of page.story || []) {
      if (item.type !== 'roster') continue
      for (const raw of (item.text || '').split(/\r?\n/)) {
        const m = raw.trim().match(SITE_LINE)
        if (m) allowed.add(m[0])
      }
    }
    return allowed
  }
  return null // no peers page at all
}

// ── Request-id LRU dedup ──────────────────────────────────────────────────────

const makeDedup = (max = 500) => {
  const seen = new Map()
  return id => {
    if (!id) return false          // no id → cannot dedup, allow
    if (seen.has(id)) return true  // replay/loop
    seen.set(id, Date.now())
    while (seen.size > max) seen.delete(seen.keys().next().value)
    return false
  }
}

// ── Per-origin token bucket ───────────────────────────────────────────────────

const makeBucket = ({ capacity = 30, refillPerSec = 0.5 } = {}) => {
  const buckets = new Map()
  return origin => {
    const now = Date.now()
    let b = buckets.get(origin)
    if (!b) { b = { tokens: capacity, at: now }; buckets.set(origin, b) }
    b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSec)
    b.at = now
    if (b.tokens < 1) return false
    b.tokens -= 1
    return true
  }
}

// ── Envelope guard ────────────────────────────────────────────────────────────
// Returns {ok: true} or {ok: false, code, error}.

const guardEnvelope = (envelope, { allowed, isDuplicate, takeToken }) => {
  const origin = (envelope.origin || '').trim()
  if (!origin) {
    return { ok: false, code: 400, error: 'origin required' }
  }
  if (allowed === null) {
    return { ok: false, code: 403, error: 'this site has no search-peers page — peer search is not enabled here' }
  }
  if (!allowed.has(origin)) {
    return { ok: false, code: 403, error: `${origin} is not on this site's search-peers roster` }
  }
  if ((envelope.hops || 0) > 0) {
    return { ok: false, code: 400, error: 'relayed requests are not accepted (v1 answers locally only)' }
  }
  if (isDuplicate(envelope.requestId)) {
    return { ok: false, code: 409, error: 'duplicate request-id (replay or loop)' }
  }
  if (!takeToken(origin)) {
    return { ok: false, code: 429, error: 'rate limit exceeded for this peer' }
  }
  return { ok: true }
}

module.exports = { readPeerRoster, makeDedup, makeBucket, guardEnvelope, SITE_LINE }
