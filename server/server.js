// wiki-plugin-similarity — server-side component
//
// Registers three routes with the wiki's Express app via the startServer(params)
// hook in wiki-server/lib/plugins.js.
//
// Routes:
//   GET /system/indexed-domains.json?pattern=glob1,glob2
//     Returns [{domain, page_count}] for all domains whose semantic-vectors.json
//     exists and whose name matches any of the supplied glob patterns.
//
//   GET /system/semantic-vectors.json
//     Serves {farm}/{req.hostname}/status/semantic-vectors.json.
//     req.hostname selects the domain in a fedwiki farm.
//
//   GET /system/embed?text=…
//     Proxies to the local FastAPI /embed endpoint and returns {vector:[…]}.
//     Requires the FastAPI server to be running on EMBED_URL (default localhost:8000).
//
// Farm root is derived from argv.status which is {farm}/{domain}/status.

import fs   from 'node:fs'
import path from 'node:path'
import http from 'node:http'

const EMBED_URL      = process.env.WIKI_EMBED_URL   || 'http://localhost:8000/embed'
// Optional additional farm roots to search when a domain's vectors aren't found
// in the primary farm. Colon-separated list of absolute paths, e.g.:
//   WIKI_EXTRA_FARMS=/Users/david/Nextcloud/fedwiki:/Users/david/other-farm
const EXTRA_FARMS    = (process.env.WIKI_EXTRA_FARMS || '').split(':').filter(Boolean)

// ── Glob matching ─────────────────────────────────────────────────────────────
// Supports * (any chars) and ? (one char). No path separator semantics needed.

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

const matchesAny = (domain, patterns) =>
  patterns.some(p => p === '*' || globMatch(p, domain))

// ── Multi-farm helpers ────────────────────────────────────────────────────────

// Return the first path that exists across all farm roots for a given domain
// and relative sub-path (e.g. 'status/semantic-vectors.json').
const findInFarms = (farmRoot, domain, relPath) => {
  const farms = [farmRoot, ...EXTRA_FARMS]
  for (const farm of farms) {
    const full = path.join(farm, domain, relPath)
    try { fs.accessSync(full, fs.constants.F_OK); return full } catch { /* try next */ }
  }
  return null
}

// ── Discover indexed domains ───────────────────────────────────────────────────

const findIndexedDomains = (farmRoot, patterns) => {
  const farms = [farmRoot, ...EXTRA_FARMS]
  const seen  = new Set()
  const results = []

  for (const farm of farms) {
    let entries
    try { entries = fs.readdirSync(farm, { withFileTypes: true }) } catch { continue }

    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const domain = ent.name
      if (seen.has(domain)) continue          // first farm wins
      if (!matchesAny(domain, patterns)) continue
      const vecFile = path.join(farm, domain, 'status', 'semantic-vectors.json')
      try { fs.accessSync(vecFile, fs.constants.F_OK) } catch { continue }
      seen.add(domain)
      let pageCount = null
      try {
        const pages = JSON.parse(fs.readFileSync(vecFile, 'utf8'))
        pageCount = Array.isArray(pages) ? pages.length : null
      } catch { /* ignore */ }
      results.push({ domain, page_count: pageCount })
    }
  }

  results.sort((a, b) => a.domain.localeCompare(b.domain))
  return results
}

// ── Fetch helper (node:http, avoids fetch() version concerns) ─────────────────

const postJson = (url, body) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const u = new URL(url)
    const opts = {
      hostname: u.hostname,
      port:     u.port || 80,
      path:     u.pathname + u.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }
    const req = http.request(opts, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error(`embed response parse error: ${e.message}`)) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })

// ── startServer — called by wiki-server/lib/plugins.js ────────────────────────

export const startServer = ({ argv, app }) => {
  // Farm root: argv.status = {farm}/{thisDomain}/status  →  go up two levels
  const farmRoot = path.dirname(path.dirname(argv.status))

  console.log('[wiki-plugin-similarity] registering /system routes, farm:', farmRoot)

  // CORS helper
  const cors = res => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }

  // ── OPTIONS pre-flight ─────────────────────────────────────────────────────
  app.options('/system/indexed-domains.json', (req, res) => {
    cors(res); res.sendStatus(204)
  })
  app.options('/system/semantic-vectors.json', (req, res) => {
    cors(res); res.sendStatus(204)
  })
  app.options('/system/embed.json', (req, res) => {
    cors(res); res.sendStatus(204)
  })

  // ── GET /system/indexed-domains.json?pattern=glob1,glob2 ──────────────────
  app.get('/system/indexed-domains.json', (req, res) => {
    cors(res)
    const raw = req.query.pattern || '*'
    const patterns = raw.split(',').map(p => p.trim()).filter(Boolean)
    const results = findIndexedDomains(farmRoot, patterns)
    res.json(results)
  })

  // ── GET /system/semantic-vectors.json ─────────────────────────────────────
  // Two modes:
  //   ?domain=david.hitchhikers.earth  — local proxy: searches all farm roots
  //       on disk (private farm + WIKI_EXTRA_FARMS). Lets localhost clients load
  //       vectors for any domain without CORS or remote plugin requirements.
  //   (no ?domain)  — req.hostname selects the domain; works for farm requests
  //       where Caddy routes each hostname to this server.
  app.get('/system/semantic-vectors.json', (req, res) => {
    cors(res)
    const domain  = req.query.domain || req.hostname || 'localhost'
    const vecFile = findInFarms(farmRoot, domain, 'status/semantic-vectors.json')
    if (!vecFile) {
      return res.status(404).json({ error: `vectors not found for ${domain}` })
    }
    res.sendFile(vecFile)
  })

  // ── GET /system/embed.json?text=… ────────────────────────────────────────
  app.get('/system/embed.json', async (req, res) => {
    cors(res)
    const text = req.query.text
    if (!text) return res.status(400).json({ error: 'text parameter required' })
    try {
      const result = await postJson(EMBED_URL, { text })
      res.json(result)
    } catch (e) {
      console.error('[wiki-plugin-similarity] embed proxy error:', e.message)
      res.status(502).json({ error: `embed service unavailable: ${e.message}` })
    }
  })

  console.log('[wiki-plugin-similarity] routes registered')
}
