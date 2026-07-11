// wiki-plugin-similarity — server-side component
//
// Registers same-origin /system routes with the wiki's Express app via the
// startServer(params) hook in wiki-server/lib/plugins.js. Everything a search
// needs runs in-process on whatever host serves the wiki — no HomeLab FastAPI
// dependency — so club members on the public farm get working search.
//
// Routes:
//   GET  /system/indexed-domains.json?pattern=glob1,glob2
//     [{domain, page_count}] for domains with a semantic-vectors.json.
//   GET  /system/semantic-vectors.json[?domain=]
//     Serves {farm}/{domain}/status/semantic-vectors.json.
//   GET  /system/embed.json?text=…
//     384-dim unit vector via the in-process transformers.js embedder
//     (BAAI/bge-small-en-v1.5 — same model the indexes were built with).
//     Set WIKI_EMBED_URL to proxy to an external embedder instead.
//   POST /system/search-report.json  {query, domains, limit, threshold, live}
//     Ranked, stub-filtered, fork-bundled semantic report (page JSON).
//   GET  /system/farm-search.json?q=…&pattern=…&limit=…
//     Galactic keyword search — reads each site's own per-edit MiniSearch
//     index (status/site-index.json). No index building.
//   GET  /system/build-index.json?domains=…&force=…
//     Proxy to the farm indexer (WIKI_INDEXER_URL) when configured; heavy
//     embedding is the indexer's job (Pi5 on the Hitchhikers farm), never
//     the wiki server's.
//
// Farm root is derived from argv.status ({farm}/{domain}/status); extra farm
// roots come from WIKI_EXTRA_FARMS (colon-separated absolute paths).
//
// CommonJS on purpose (see sibling server/package.json): wiki-server's older
// require() loader throws ERR_REQUIRE_ESM on an ESM server.js and swallows the
// error, silently dropping these routes. CJS loads under every Node / wiki
// version, while the plugin's root package stays "type":"module".

const fs   = require('node:fs')
const path = require('node:path')
const http = require('node:http')

const { loadRestricted, matchesAny, listDomains, findInFarms } = require('./farm-lib')
const embedder     = require('./embedder')
const { buildReport } = require('./search-report')
const { searchFarm, keywordReportPage } = require('./farm-search')

// Optional external embedder (proxy) — unset means embed in-process.
const EMBED_URL   = process.env.WIKI_EMBED_URL || null
// Farm indexer for BUILD requests (HomeLab FastAPI, or unset on the public farm).
const INDEXER_URL = process.env.WIKI_INDEXER_URL || null
// Optional additional farm roots, colon-separated absolute paths.
const EXTRA_FARMS = (process.env.WIKI_EXTRA_FARMS || '').split(':').filter(Boolean)

// ── HTTP helpers ──────────────────────────────────────────────────────────────

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
        catch (e) { reject(new Error(`response parse error: ${e.message}`)) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })

const getJson = url =>
  new Promise((resolve, reject) => {
    const u = new URL(url)
    http.get(u, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error(`response parse error: ${e.message}`)) }
      })
    }).on('error', reject)
  })

// Read a JSON request body without assuming a body-parser is mounted.
const readBody = req =>
  new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body)
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) }
      catch (e) { reject(new Error(`invalid JSON body: ${e.message}`)) }
    })
    req.on('error', reject)
  })

// ── startServer — called by wiki-server/lib/plugins.js ────────────────────────

const startServer = ({ argv, app }) => {
  // Farm root: argv.status = {farm}/{thisDomain}/status  →  go up two levels
  const farmRoot = path.dirname(path.dirname(argv.status))
  // primary farm is 'local'; extra farms (Nextcloud mirror) are 'public'
  const farms = [[farmRoot, 'local'], ...EXTRA_FARMS.map(f => [f, 'public'])]
  const restricted = loadRestricted(EXTRA_FARMS)
  const ctx = { farms, restricted, embed: embedText }

  console.log('[wiki-plugin-similarity] registering /system routes, farms:',
    farms.map(([f]) => f).join(', '))

  // Warm the embedding model in the background so the first query is fast.
  if (!EMBED_URL) embedder.warm()

  async function embedText(text) {
    if (EMBED_URL) return (await postJson(EMBED_URL, { text })).vector
    return embedder.embed(text)
  }

  const cors = res => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }

  for (const route of ['/system/indexed-domains.json', '/system/semantic-vectors.json',
                       '/system/embed.json', '/system/search-report.json',
                       '/system/farm-search.json', '/system/build-index.json']) {
    app.options(route, (req, res) => { cors(res); res.sendStatus(204) })
  }

  // ── GET /system/indexed-domains.json?pattern=glob1,glob2 ──────────────────
  app.get('/system/indexed-domains.json', (req, res) => {
    cors(res)
    const raw      = req.query.pattern || '*'
    const patterns = raw.split(',').map(p => p.trim()).filter(Boolean)
    const limit    = parseInt(req.query.limit) || null
    let results = listDomains(farms, patterns, restricted, 'status/semantic-vectors.json')
      .map(({ farm, domain }) => {
        let pageCount = null
        try {
          const pages = JSON.parse(fs.readFileSync(
            path.join(farm, domain, 'status', 'semantic-vectors.json'), 'utf8'))
          pageCount = Array.isArray(pages) ? pages.length : null
        } catch { /* ignore */ }
        return { domain, page_count: pageCount }
      })
    if (limit) results = results.slice(0, limit)
    res.json(results)
  })

  // ── GET /system/semantic-vectors.json[?domain=] ────────────────────────────
  app.get('/system/semantic-vectors.json', (req, res) => {
    cors(res)
    const domain  = req.query.domain || req.hostname || 'localhost'
    const vecFile = findInFarms(farms, domain, 'status/semantic-vectors.json')
    if (!vecFile) {
      return res.status(404).json({ error: `vectors not found for ${domain}` })
    }
    fs.readFile(vecFile, 'utf8', (err, data) => {
      if (err) {
        return res.status(500).json({ error: `unable to read vectors for ${domain}: ${err.message}` })
      }
      res.type('application/json').send(data)
    })
  })

  // ── GET /system/embed.json?text=… ──────────────────────────────────────────
  app.get('/system/embed.json', async (req, res) => {
    cors(res)
    const text = req.query.text
    if (!text) return res.status(400).json({ error: 'text parameter required' })
    try {
      res.json({ vector: await embedText(text) })
    } catch (e) {
      console.error('[wiki-plugin-similarity] embed error:', e.message)
      res.status(502).json({ error: `embedding unavailable: ${e.message}` })
    }
  })

  // ── POST /system/search-report.json ────────────────────────────────────────
  app.post('/system/search-report.json', async (req, res) => {
    cors(res)
    try {
      const body = await readBody(req)
      if (!body.query) return res.status(400).json({ error: 'query required' })
      const page = await buildReport(
        body.query, body.domains || ['*'], body.limit || 10, ctx,
        body.threshold ?? null, !!body.live)
      res.json(page)
    } catch (e) {
      console.error('[wiki-plugin-similarity] search-report error:', e.message)
      res.status(500).json({ error: `search-report failed: ${e.message}` })
    }
  })

  // ── GET /system/farm-search.json?q=…&pattern=…&limit=… ────────────────────
  app.get('/system/farm-search.json', (req, res) => {
    cors(res)
    const q = (req.query.q || '').trim()
    if (!q) return res.status(400).json({ error: 'q parameter required' })
    const patterns = (req.query.pattern || '*').split(',').map(p => p.trim()).filter(Boolean)
    const limit = parseInt(req.query.limit) || 10
    try {
      const outcome = searchFarm(farms, patterns, restricted, q, limit)
      if (req.query.format === 'flat') return res.json(outcome)
      res.json(keywordReportPage(q, outcome, limit, patterns))
    } catch (e) {
      console.error('[wiki-plugin-similarity] farm-search error:', e.message)
      res.status(500).json({ error: `farm-search failed: ${e.message}` })
    }
  })

  // ── GET /system/build-index.json?domains=…&force=… ────────────────────────
  // Heavy embedding is the farm indexer's job — proxy when configured, else
  // explain where indexing happens.
  app.get('/system/build-index.json', async (req, res) => {
    cors(res)
    if (!INDEXER_URL) {
      return res.status(501).json({
        error: 'no farm indexer configured on this server',
        hint: 'Indexing runs on the farm indexer (Pi5 on the Hitchhikers farm); ' +
              'indexes arrive by sync. Set WIKI_INDEXER_URL to enable proxying.',
      })
    }
    try {
      const qs = new URLSearchParams({
        domains: req.query.domains || '*',
        force:   req.query.force || '0',
      })
      res.json(await getJson(`${INDEXER_URL}?${qs}`))
    } catch (e) {
      res.status(502).json({ error: `farm indexer unavailable: ${e.message}` })
    }
  })

  console.log('[wiki-plugin-similarity] routes registered')
}

module.exports = { startServer }
