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
//   *        all farms
//   PUBLIC   domains in 'public' farms (Nextcloud mirror)
//   LOCAL    domains in the primary ('local') farm
//   PRIVATE  public domains marked "restricted": true in a farm config

const loadRestricted = publicFarms => {
  const restricted = new Set()
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
    if (p === '*') return true
    if (p === 'PUBLIC') return kind === 'public'
    if (p === 'LOCAL') return kind === 'local'
    if (p === 'PRIVATE') return kind === 'public' && restricted.has(domain)
    return globMatch(p, domain)
  })

// ── Domain listing ────────────────────────────────────────────────────────────
// List domains across farms matching the patterns, optionally requiring a file
// (relative to the domain dir) to exist. First farm wins on duplicate names.
// Returns [{farm, kind, domain}].

const listDomains = (farms, patterns, restricted, requireFile = null) => {
  const seen = new Set()
  const out = []
  for (const [farm, kind] of farms) {
    let entries
    try { entries = fs.readdirSync(farm, { withFileTypes: true }) } catch { continue }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const domain = ent.name
      if (seen.has(domain)) continue
      if (!matchesAny(domain, kind, patterns, restricted)) continue
      if (requireFile) {
        try { fs.accessSync(path.join(farm, domain, requireFile), fs.constants.F_OK) }
        catch { continue }
      }
      seen.add(domain)
      out.push({ farm, kind, domain })
    }
  }
  out.sort((a, b) => a.domain.localeCompare(b.domain))
  return out
}

// First existing path for domain + relative sub-path across farm roots.
const findInFarms = (farms, domain, relPath) => {
  for (const [farm] of farms) {
    const full = path.join(farm, domain, relPath)
    try { fs.accessSync(full, fs.constants.F_OK); return full } catch { /* next */ }
  }
  return null
}

module.exports = { globMatch, loadRestricted, matchesAny, listDomains, findInFarms }
