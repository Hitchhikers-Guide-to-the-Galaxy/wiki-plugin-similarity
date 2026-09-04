// wiki-plugin-similarity — shared farm helpers (CommonJS, see server/package.json)
//
// Used by server.js, search-report.js and farm-search.js. A "farms" list is
// [[rootPath, kind], ...] where kind is 'local' (the primary farm this wiki
// serves from) or 'public' (extra farms, e.g. the Nextcloud mirror).

const fs   = require('node:fs')
const path = require('node:path')

// ── Glob matching — supports * and ?, no path separator semantics ─────────────

const globMatch = (pattern, str) => {
  const p = pattern.length
  const s = str.length
  const dp = Array.from({ length: p + 1 }, () => new Array(s + 1).fill(false))
  dp[0][0] = true
  for (let i = 1; i <= p; i++) {
    if (pattern[i - 1] === '*') dp[i][0] = dp[i - 1][0]
  }
  for (let i = 1; i <= p; i++) {
    for (let j = 1; j <= s; j++) {
      if (pattern[i - 1] === '*') {
        dp[i][j] = dp[i - 1][j] || dp[i][j - 1]
      } else if (pattern[i - 1] === '?' || pattern[i - 1] === str[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      }
    }
  }
  return dp[p][s]
}

// ── Scope keywords (exact uppercase, per DSL convention) ──────────────────────
//   *        all farms — EXCEPT galaxy: off-farm sites join a search only by
//            explicit opt-in (GALAXY, an explicit domain, or a roster)
//   PUBLIC   domains in 'public' farms (Nextcloud mirror)
//   LOCAL    domains in the primary ('local') farm
//   PRIVATE  domains marked restricted (see loadRestricted) on any farm
//   GALAXY   off-farm federation sites in the 'galaxy' tree (see galaxy-vectors.js)

// ── Restricted domains ────────────────────────────────────────────────────────
// A Set of exact names PLUS a list of globs (WIKI_RESTRICTED_DOMAINS), so a
// whole namespace such as *.private.fish can be restricted with one env line
// without touching wikiDomains (which would also switch on login-to-view).
// `has(domain)` answers for both, so every caller's `restricted.has(...)`
// keeps working unchanged.

class RestrictedSet extends Set {
  constructor(names = [], globs = []) {
    super(names)
    this.globs = [...globs]
  }
  has(domain) {
    return super.has(domain) || this.globs.some(g => globMatch(g, domain))
  }
}

// Sources, all optional and merged:
//   opts.wikiDomains  the LOCAL farm's own wikiDomains map — wiki's farm.js
//                     hands it to every plugin as argv.wikiDomains, so the
//                     primary farm's restricted sites count without any
//                     WIKI_EXTRA_FARMS at all
//   opts.globs        WIKI_RESTRICTED_DOMAINS globs
//   publicFarms       config-*.json files in extra farm roots (the mirror)
const loadRestricted = (publicFarms, opts = {}) => {
  const restricted = new RestrictedSet([], opts.globs || [])
  for (const [domain, o] of Object.entries(opts.wikiDomains || {})) {
    if (o && o.restricted) restricted.add(domain)
  }
  for (const farm of publicFarms) {
    let files
    try { files = fs.readdirSync(farm) } catch { continue }
    for (const f of files) {
      if (!/^config-.*\.json$/.test(f)) continue
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(farm, f), 'utf8'))
        for (const [domain, opts] of Object.entries(cfg.wikiDomains || {})) {
          if (opts && opts.restricted) restricted.add(domain)
        }
      } catch { /* ignore malformed config */ }
    }
  }
  return restricted
}

const matchesAny = (domain, kind, patterns, restricted) =>
  patterns.some(p => {
    if (p === '*') return kind !== 'galaxy'
    if (p === 'PUBLIC') return kind === 'public'
    if (p === 'LOCAL') return kind === 'local'
    if (p === 'PRIVATE') return kind !== 'galaxy' && restricted.has(domain)
    if (p === 'GALAXY') return kind === 'galaxy'
    return globMatch(p, domain)
  })

// ── Domain listing ────────────────────────────────────────────────────────────
// List domains across farms matching the patterns, optionally requiring a file
// (relative to the domain dir) to exist. First farm wins on duplicate names.
// Returns [{farm, kind, domain}].
//
// The directory walk (one readdir plus one access per domain — ~1,000 stats
// for the galaxy tree, on a USB drive) is memoised per (farm, requireFile)
// for LIST_TTL_MS; pattern matching runs fresh on every call. Off under the
// node test runner, whose fixtures change between calls.

const LIST_TTL_MS = process.env.NODE_TEST_CONTEXT ? 0
  : parseInt(process.env.WIKI_LIST_TTL_MS || '30000', 10)
const listings = new Map()   // `${farm}\0${requireFile}` → {at, domains}

const domainDirs = (farm, requireFile) => {
  const key = `${farm}\0${requireFile || ''}`
  const hit = listings.get(key)
  if (hit && LIST_TTL_MS && Date.now() - hit.at < LIST_TTL_MS) return hit.domains
  const domains = []
  let entries
  try { entries = fs.readdirSync(farm, { withFileTypes: true }) } catch { entries = [] }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    if (requireFile) {
      try { fs.accessSync(path.join(farm, ent.name, requireFile), fs.constants.F_OK) }
      catch { continue }
    }
    domains.push(ent.name)
  }
  listings.set(key, { at: Date.now(), domains })
  return domains
}

const listDomains = (farms, patterns, restricted, requireFile = null) => {
  const seen = new Set()
  const out = []
  for (const [farm, kind] of farms) {
    for (const domain of domainDirs(farm, requireFile)) {
      if (seen.has(domain)) continue
      if (!matchesAny(domain, kind, patterns, restricted)) continue
      seen.add(domain)
      out.push({ farm, kind, domain })
    }
  }
  out.sort((a, b) => a.domain.localeCompare(b.domain))
  return out
}

const clearListings = () => listings.clear()

// First existing path for domain + relative sub-path across farm roots.
const findInFarms = (farms, domain, relPath) => {
  for (const [farm] of farms) {
    const full = path.join(farm, domain, relPath)
    try { fs.accessSync(full, fs.constants.F_OK); return full } catch { /* next */ }
  }
  return null
}

module.exports = { globMatch, RestrictedSet, loadRestricted, matchesAny, listDomains, findInFarms, clearListings }
