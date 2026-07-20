// wiki-plugin-similarity — peer-search guards (CommonJS)
//
// Two keys must turn before a farm answers a peer's search:
//
//   1. The farm admin's ceiling — WIKI_PEER_FEDERATION env:
//        off     refuse all peer search (kill switch)
//        grants  per-site owner grants honored; FROM * is inert (default)
//        open    FROM * takes effect
//      An env, not a page: the plugin cannot verify who wrote a page line,
//      and the environment is the one thing only the admin holds.
//
//   2. The site owner's grant — a "Federated Farm Search" page (slug
//      federated-farm-search, override WIKI_PEER_GRANTS_PAGE) whose CODE
//      items carry FROM lines:
//        FROM hitchhikers.earth      a named partner
//        FROM *.fedwiki.org          a glob family
//        FROM *                      everyone (needs ceiling = open)
//      Lines are additive. No page and no legacy search-peers roster means
//      the site is closed to peers — opt-in, never opt-out.
//
// The answer scope for an origin is exactly the union of sites that grant
// it (per-site consent — one site's grant never opens the whole farm).
// Restricted (login-to-view) sites are excluded below this layer,
// unconditionally.
//
// Migration: a site with no grants page but a legacy `search-peers` roster
// page has its roster lines read as FROM lines for that site only.
// Remove the fallback at 0.8.
//
// Rate limiting is keyed by remote IP, never by the asserted origin (origins
// are free to invent in v1), with a bounded LRU and a global cap.
//
// This guard seam stays narrow on purpose: v2 swaps the grant check for
// shared-secret HMAC verification, v3 for trust-graph attestation, without
// touching the callers.

const fs   = require('node:fs')
const path = require('node:path')

const { globMatch } = require('./farm-lib')

const SITE_LINE = /^([a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+|localhost)(:\d+)?$/

const CEILINGS = ['off', 'grants', 'open']
const ceiling = () => {
  const c = (process.env.WIKI_PEER_FEDERATION || 'grants').toLowerCase()
  return CEILINGS.includes(c) ? c : 'grants'
}

const grantsSlug = () => process.env.WIKI_PEER_GRANTS_PAGE || 'federated-farm-search'

// ── Grants parser ─────────────────────────────────────────────────────────────
// Input: the text of one or more code items. Output:
//   { open: bool, origins: Set<string>, globs: string[] }
// Unknown UPPERCASE lines are ignored (safe while every command is
// additive-permissive; a future restricting command must be version-gated
// via the hello route).

const parseGrants = texts => {
  const grants = { open: false, origins: new Set(), globs: [] }
  for (const text of texts) {
    for (const raw of (text || '').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const m = line.match(/^FROM[\s:]+(.+)$/i)
      if (!m) continue
      const value = m[1].trim()
      if (value === '*') grants.open = true
      else if (value.includes('*') || value.includes('?')) grants.globs.push(value)
      else if (value.match(SITE_LINE)) grants.origins.add(value)
    }
  }
  return grants
}

// Does this grant set admit the origin, under the admin ceiling?
const grantsAdmit = (grants, origin, ceil = ceiling()) => {
  if (!grants || ceil === 'off') return false
  if (grants.origins.has(origin)) return true
  if (grants.globs.some(g => globMatch(g, origin))) return true
  if (grants.open && ceil === 'open') return true
  return false
}

// ── Per-site grant reads, mtime-cached ────────────────────────────────────────

const grantCache = new Map() // "farm/domain" → {mtime, grants|null}

const readCodeItemTexts = page =>
  (page.story || []).filter(i => i.type === 'code').map(i => i.text || '')

const readRosterSiteLines = page => {
  const out = new Set()
  for (const item of page.story || []) {
    if (item.type !== 'roster') continue
    for (const raw of (item.text || '').split(/\r?\n/)) {
      const m = raw.trim().match(SITE_LINE)
      if (m) out.add(m[0])
    }
  }
  return out
}

// Grants for one site: the federated-farm-search page's code items, falling
// back to the legacy search-peers roster (read as FROM lines for this site).
// Returns null when the site declares nothing (closed).
const readSiteGrants = (farm, domain) => {
  const tryPage = (slug, extract) => {
    const p = path.join(farm, domain, 'pages', slug)
    let mtime
    try { mtime = fs.statSync(p).mtimeMs } catch { return undefined } // no page
    const key = `${farm}/${domain}/${slug}`
    const hit = grantCache.get(key)
    if (hit && hit.mtime === mtime) return hit.grants
    let grants = null
    try { grants = extract(JSON.parse(fs.readFileSync(p, 'utf8'))) } catch { /* unreadable */ }
    grantCache.set(key, { mtime, grants })
    if (grantCache.size > 2000) grantCache.delete(grantCache.keys().next().value)
    return grants
  }

  const fromPage = tryPage(grantsSlug(), page => parseGrants(readCodeItemTexts(page)))
  if (fromPage !== undefined) return fromPage
  const legacy = tryPage('search-peers', page => {
    const origins = readRosterSiteLines(page)
    return origins.size ? { open: false, origins, globs: [] } : null
  })
  return legacy !== undefined ? legacy : null
}

// The union of domains (from [{farm, domain}]) whose own grants admit the
// origin under the current ceiling.
const grantingDomains = (domains, origin, ceil = ceiling()) => {
  if (ceil === 'off') return []
  return domains.filter(({ farm, domain }) =>
    grantsAdmit(readSiteGrants(farm, domain), origin, ceil))
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

// ── Rate limiting: per-IP token buckets (bounded LRU) + a global bucket ──────
// Never key limits by the asserted origin: a spoofer rotating origins would
// both escape the limiter and grow the map without bound.

const makeBucket = ({ capacity = 30, refillPerSec = 0.5, maxKeys = 500 } = {}) => {
  const buckets = new Map()
  return key => {
    const now = Date.now()
    let b = buckets.get(key)
    if (!b) {
      b = { tokens: capacity, at: now }
    } else {
      buckets.delete(key) // refresh LRU position
      b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSec)
      b.at = now
    }
    buckets.set(key, b)
    while (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value)
    if (b.tokens < 1) return false
    b.tokens -= 1
    return true
  }
}

// ── Envelope guard ────────────────────────────────────────────────────────────
// Shape and abuse checks only — the consent decision (which sites grant this
// origin) is per-site and belongs to the caller via grantingDomains().
// Returns {ok: true} or {ok: false, code, error}.

const guardEnvelope = (envelope, { ip, isDuplicate, takeIpToken, takeGlobalToken }) => {
  if (ceiling() === 'off') {
    return { ok: false, code: 403, error: 'peer federation is switched off on this farm' }
  }
  if (!(envelope.origin || '').trim()) {
    return { ok: false, code: 400, error: 'origin required' }
  }
  if ((envelope.hops || 0) > 0) {
    return { ok: false, code: 400, error: 'relayed requests are not accepted (answers are local only)' }
  }
  if (isDuplicate(envelope.requestId)) {
    return { ok: false, code: 409, error: 'duplicate request-id (replay or loop)' }
  }
  if (takeGlobalToken && !takeGlobalToken('global')) {
    return { ok: false, code: 429, error: 'this farm is at its peer-search rate limit' }
  }
  if (!takeIpToken(ip || 'unknown')) {
    return { ok: false, code: 429, error: 'rate limit exceeded' }
  }
  return { ok: true }
}

module.exports = {
  ceiling, grantsSlug, parseGrants, grantsAdmit, readSiteGrants, grantingDomains,
  makeDedup, makeBucket, guardEnvelope, SITE_LINE,
}
