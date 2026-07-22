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
//     384-dim unit vector via the crash-isolated child-process embedder
//     (BAAI/bge-small-en-v1.5 — same model the indexes were built with).
//     Set WIKI_EMBED_URL to proxy to an external embedder instead.
//   GET  /system/similarity-health.json
//     Embedder supervisor state (child-process | semindex | url, breaker,
//     recent crashes) — 200 always; diagnosable from outside.
//   POST /system/search-report.json  {query, domains, limit, threshold, live}
//     Ranked, stub-filtered, fork-bundled semantic report (page JSON).
//   GET  /system/farm-search.json?q=…&pattern=…&limit=…
//     Galactic keyword search — reads each site's own per-edit MiniSearch
//     index (status/site-index.json). No index building.
//   GET  /system/build-index.json?domains=…&force=…
//     Proxy to the farm indexer (WIKI_INDEXER_URL) when configured; heavy
//     embedding is the indexer's job (Pi5 on the Hitchhikers farm), never
//     the wiki server's.
//   GET  /system/peer-hello.json
//     Capability probe: plugin version, embedding model, federation status.
//     404 here means the plugin is absent from the farm.
//   POST /system/peer-search.json
//     Federated peer search. Two keys: the admin's WIKI_PEER_FEDERATION
//     ceiling (off|grants|open) and each site's Federated Farm Search
//     grants page (FROM lines). Scope = union of granting sites only.
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

const crypto = require('node:crypto')
const https  = require('node:https')

const { loadRestricted, matchesAny, listDomains, findInFarms } = require('./farm-lib')
const embedder     = require('./embedder')
const { buildReport } = require('./search-report')
const { searchFarm, keywordReportPage } = require('./farm-search')
const { searchGalaxy } = require('./galaxy-search')
const { ceiling, grantingDomains, makeDedup, makeBucket, guardEnvelope } = require('./peer-guard')

const MODEL_META = { model: 'BAAI/bge-small-en-v1.5', dim: 384 }
const PLUGIN_VERSION = (() => {
  try { return require('../package.json').version } catch { return 'unknown' }
})()

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

// POST JSON to a peer farm's plugin server. Public peers speak https;
// *.localhost peers speak http via a loopback lookup (Node's resolver does
// not know RFC 6761 subdomains). Public domains follow /etc/hosts, so
// Offline Edit Mode routes peer calls to the local mirror by construction.
const postToPeer = (peer, routePath, body, timeoutMs = 30_000) =>
  new Promise((resolve, reject) => {
    const isLocal = peer.endsWith('.localhost') || peer.startsWith('localhost')
    const mod = isLocal ? http : https
    const payload = JSON.stringify(body)
    const opts = {
      hostname: peer.split(':')[0],
      port: peer.includes(':') ? peer.split(':')[1] : (isLocal ? 80 : 443),
      path: routePath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: timeoutMs,
    }
    if (isLocal) opts.lookup = (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }])
    const req = mod.request(opts, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch {
          resolve({ status: res.statusCode,
            body: { error: `no similarity server answered (${res.statusCode})` } })
        }
      })
    })
    req.on('timeout', () => { req.destroy(new Error('peer timeout')) })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })

// Append peer farms' results to a locally-built report page. Each peer gets
// its own section; provenance rides on the reference items' site field.
// Scores merge visually only when the peer declares the same embedding model.
const appendPeerSections = (page, peerOutcomes) => {
  const mk = () => crypto.randomBytes(8).toString('hex')
  for (const { peer, status, body } of peerOutcomes) {
    if (status === 200 && body.page) {
      const sameModel = body.meta && body.meta.model === MODEL_META.model
      page.story.push({
        type: 'markdown', id: mk(),
        text: `# From ${peer}\n\n<small>${body.meta?.count ?? '?'} results — ` +
          `model ${body.meta?.model || 'undeclared'}${sameModel ? '' :
            ' (different model: scores not comparable with local results)'}</small>`,
      })
      for (const item of body.page.story || []) {
        if (item.type === 'reference') page.story.push({ ...item, id: mk() })
      }
    } else {
      page.story.push({
        type: 'markdown', id: mk(),
        text: `<small>Peer ${peer}: ${body?.error || `failed (${status})`}</small>`,
      })
    }
  }
  return page
}

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
                       '/system/farm-search.json', '/system/build-index.json',
                       '/system/galaxy-search.json', '/system/peer-search.json',
                       '/system/peer-hello.json', '/system/similarity-health.json']) {
    app.options(route, (req, res) => { cors(res); res.sendStatus(204) })
  }

  // Peer federation guards (shared across peer requests). Rate limits are
  // keyed by remote IP — never by the asserted origin — plus a global cap.
  const isDuplicate     = makeDedup()
  const takeIpToken     = makeBucket()
  const takeGlobalToken = makeBucket({ capacity: 120, refillPerSec: 2, maxKeys: 1 })

  const requestIp = req =>
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress || 'unknown'

  // GET JSON from a peer (hello probe) — same transport rules as postToPeer.
  const getFromPeer = (peer, routePath, timeoutMs = 10_000) =>
    new Promise((resolve, reject) => {
      const isLocal = peer.endsWith('.localhost') || peer.startsWith('localhost')
      const mod = isLocal ? http : https
      const opts = {
        hostname: peer.split(':')[0],
        port: peer.includes(':') ? peer.split(':')[1] : (isLocal ? 80 : 443),
        path: routePath,
        timeout: timeoutMs,
      }
      if (isLocal) opts.lookup = (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }])
      const req = mod.get(opts, res => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
          catch { resolve({ status: res.statusCode, body: null }) }
        })
      })
      req.on('timeout', () => { req.destroy(new Error('peer timeout')) })
      req.on('error', reject)
    })

  // Hello probe cache: peer → {at, ok, body}. TTL 1h, small LRU.
  const helloCache = new Map()
  const HELLO_TTL = 60 * 60_000

  const probePeer = async peer => {
    const hit = helloCache.get(peer)
    if (hit && Date.now() - hit.at < HELLO_TTL) return hit
    let entry
    try {
      const { status, body } = await getFromPeer(peer, '/system/peer-hello.json')
      entry = { at: Date.now(), ok: status === 200 && body && body.plugin, body }
    } catch {
      entry = { at: Date.now(), ok: false, body: null }
    }
    helloCache.set(peer, entry)
    if (helloCache.size > 200) helloCache.delete(helloCache.keys().next().value)
    return entry
  }

  const askPeers = async (peers, envelope) => {
    const outcomes = await Promise.all(peers.map(async peer => {
      const hello = await probePeer(peer)
      if (!hello.ok) {
        return { peer, status: 0,
          body: { error: 'peer does not answer hello — no similarity federation there' } }
      }
      if (hello.body.federation && hello.body.federation.enabled === false) {
        return { peer, status: 0, body: { error: 'peer has federation switched off' } }
      }
      try {
        const { status, body } = await postToPeer(peer, '/system/peer-search.json', envelope)
        return { peer, status, body }
      } catch (e) {
        return { peer, status: 0, body: { error: e.message } }
      }
    }))
    return outcomes
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
      res.status(e.code === 'EMBEDDER_DOWN' ? 503 : 502)
        .json({ error: `embedding unavailable: ${e.message}` })
    }
  })

  // ── GET /system/similarity-health.json — embedder supervisor state ────────
  app.get('/system/similarity-health.json', (req, res) => {
    cors(res)
    res.json({
      plugin: 'wiki-plugin-similarity',
      version: PLUGIN_VERSION,
      ...MODEL_META,
      embedder: EMBED_URL ? { via: 'url', url: EMBED_URL } : embedder.status(),
    })
  })

  // ── POST /system/search-report.json ────────────────────────────────────────
  // body.farms: peer farms asked to continue the search (FARM prototype).
  app.post('/system/search-report.json', async (req, res) => {
    cors(res)
    try {
      const body = await readBody(req)
      if (!body.query) return res.status(400).json({ error: 'query required' })
      const page = await buildReport(
        body.query, body.domains || ['*'], body.limit || 10, ctx,
        body.threshold ?? null, !!body.live)
      if (Array.isArray(body.farms) && body.farms.length) {
        const envelope = {
          query: body.query, kind: 'report', limit: body.limit || 10,
          hops: 0, requestId: crypto.randomBytes(8).toString('hex'),
          origin: req.hostname,
        }
        appendPeerSections(page, await askPeers(body.farms.slice(0, 8), envelope))
      }
      res.json(page)
    } catch (e) {
      console.error('[wiki-plugin-similarity] search-report error:', e.message)
      res.status(e.code === 'EMBEDDER_DOWN' ? 503 : 500)
        .json({ error: `search-report failed: ${e.message}` })
    }
  })

  // ── GET /system/farm-search.json?q=…&pattern=…&limit=…&farms=… ────────────
  // Explicit sites absent from farm disk are searched over HTTP via the
  // galaxy cache; ?farms= asks peer farms to continue the search.
  app.get('/system/farm-search.json', async (req, res) => {
    cors(res)
    const q = (req.query.q || '').trim()
    if (!q) return res.status(400).json({ error: 'q parameter required' })
    const patterns = (req.query.pattern || '*').split(',').map(p => p.trim()).filter(Boolean)
    const limit = parseInt(req.query.limit) || 10
    try {
      // Split explicit hostnames into on-disk domains and off-farm galaxy sites
      const isExplicit = p => !p.includes('*') && !p.includes('?') &&
        !['PUBLIC', 'LOCAL', 'PRIVATE'].includes(p) && p.includes('.')
      const galaxySites = patterns.filter(p =>
        isExplicit(p) && !findInFarms(farms, p, 'status/site-index.json'))
      const localPatterns = patterns.filter(p => !galaxySites.includes(p))

      const outcome = localPatterns.length
        ? searchFarm(farms, localPatterns, restricted, q, limit)
        : { results: [], searched: 0, matched: 0 }
      if (galaxySites.length) {
        const remote = await searchGalaxy(galaxySites, q, limit)
        outcome.results = [...outcome.results, ...remote.results]
          .sort((a, b) => b.score - a.score).slice(0, limit)
        outcome.searched += remote.searched
        outcome.matched += remote.matched
      }
      if (req.query.format === 'flat') return res.json(outcome)

      const page = keywordReportPage(q, outcome, limit, patterns)
      const peers = (req.query.farms || '').split(',').map(s => s.trim()).filter(Boolean)
      if (peers.length) {
        const envelope = {
          query: q, kind: 'keyword', limit,
          hops: 0, requestId: crypto.randomBytes(8).toString('hex'),
          origin: req.hostname,
        }
        appendPeerSections(page, await askPeers(peers.slice(0, 8), envelope))
      }
      res.json(page)
    } catch (e) {
      console.error('[wiki-plugin-similarity] farm-search error:', e.message)
      res.status(500).json({ error: `farm-search failed: ${e.message}` })
    }
  })

  // ── GET /system/galaxy-search.json?q=…&sites=…&limit=… ────────────────────
  // Keyword search over arbitrary federation sites — reads their own per-edit
  // site-index.json over HTTP with a conditional-GET disk cache.
  app.get('/system/galaxy-search.json', async (req, res) => {
    cors(res)
    const q = (req.query.q || '').trim()
    const sites = (req.query.sites || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!q) return res.status(400).json({ error: 'q parameter required' })
    if (!sites.length) return res.status(400).json({ error: 'sites parameter required' })
    const limit = parseInt(req.query.limit) || 10
    try {
      const outcome = await searchGalaxy(sites, q, limit)
      if (req.query.format === 'flat') return res.json(outcome)
      res.json(keywordReportPage(q, outcome, limit, sites))
    } catch (e) {
      console.error('[wiki-plugin-similarity] galaxy-search error:', e.message)
      res.status(500).json({ error: `galaxy-search failed: ${e.message}` })
    }
  })

  // ── GET /system/peer-hello.json — capability probe ────────────────────────
  // "Does this farm run the Similarity plugin, and does it federate?"
  // A 404 (or HTML) here means the plugin is absent. Static JSON, no embedder
  // cost; does not advertise any FROM list.
  app.get('/system/peer-hello.json', (req, res) => {
    cors(res)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.json({
      plugin: 'wiki-plugin-similarity',
      version: PLUGIN_VERSION,
      ...MODEL_META,
      site: req.hostname,
      federation: {
        enabled: ceiling() !== 'off',
        kinds: ['report', 'keyword'],
        hopsAccepted: 0,
      },
    })
  })

  // ── POST /system/peer-search.json — federated peer search ────────────────
  // Two keys must turn: the farm admin's WIKI_PEER_FEDERATION ceiling, and
  // each site's own Federated Farm Search grants page. The answer scope for
  // an origin is exactly the union of sites that granted it — one site's
  // grant never opens the whole farm. Restricted (login-to-view) sites are
  // excluded unconditionally. Abuse guards: hop limit, request-id dedup,
  // IP-keyed + global rate limits.
  app.post('/system/peer-search.json', async (req, res) => {
    cors(res)
    try {
      const envelope = await readBody(req)
      const verdict = guardEnvelope(envelope,
        { ip: requestIp(req), isDuplicate, takeIpToken, takeGlobalToken })
      if (!verdict.ok) return res.status(verdict.code).json({ error: verdict.error })
      if (!envelope.query) return res.status(400).json({ error: 'query required' })

      const origin = envelope.origin.trim()
      const allDomains = listDomains(farms, ['*'], restricted)
        .filter(d => !restricted.has(d.domain))
      const granted = grantingDomains(allDomains, origin)
      if (!granted.length) {
        return res.status(403).json({
          error: `no site on this farm grants federated search to ${origin}`,
          hint: 'a site opts in with FROM lines on its Federated Farm Search page',
        })
      }
      const grantedNames = granted.map(d => d.domain)

      const limit = envelope.limit || 10
      let page
      if (envelope.kind === 'keyword') {
        const outcome = searchFarm(farms, grantedNames, restricted,
          envelope.query, limit, restricted)
        page = keywordReportPage(envelope.query, outcome, limit, grantedNames)
      } else {
        page = await buildReport(envelope.query, grantedNames, limit,
          { ...ctx, exclude: restricted })
      }
      const count = page.story.filter(i => i.type === 'reference').length
      res.json({ page, meta: { ...MODEL_META, version: PLUGIN_VERSION,
        farm: req.hostname, sites: grantedNames.length, count } })
    } catch (e) {
      console.error('[wiki-plugin-similarity] peer-search error:', e.message)
      res.status(e.code === 'EMBEDDER_DOWN' ? 503 : 500)
        .json({ error: `peer-search failed: ${e.message}` })
    }
  })

  // ── GET /system/build-index.json?domains=…&force=… ────────────────────────
  // Resolution order: WIKI_INDEXER_URL proxy (explicit config wins) → local
  // wiki-plugin-semindex (in-process enqueue, owner/admin only) → 501.
  const semindex = (() => {
    try {
      const sibling = path.resolve(__dirname, '../../wiki-plugin-semindex/server/indexer.js')
      if (fs.existsSync(sibling)) return require(sibling)
      return require('wiki-plugin-semindex/server/indexer.js')
    } catch { return null }
  })()

  app.get('/system/build-index.json', async (req, res) => {
    cors(res)
    if (INDEXER_URL) {
      try {
        const qs = new URLSearchParams({
          domains: req.query.domains || '*',
          force:   req.query.force || '0',
        })
        return res.json(await getJson(`${INDEXER_URL}?${qs}`))
      } catch (e) {
        return res.status(502).json({ error: `farm indexer unavailable: ${e.message}` })
      }
    }
    if (semindex) {
      const sh = app.securityhandler
      const ok = (() => {
        try { return !!sh && (!!sh.isAdmin?.(req) || !!sh.isAuthorized?.(req)) } catch { return false }
      })()
      if (!ok) return res.sendStatus(403)
      if (semindex.MODE !== 'writer') {
        return res.status(409).json({ error: `semindex mode is '${semindex.MODE}' — not a writer` })
      }
      const queued = semindex.enqueueGlobs(req.query.domains || '*', req.query.force === '1')
      return res.json({ queued, ...semindex.status() })
    }
    res.status(501).json({
      error: 'no indexer available on this server',
      hint: 'Install wiki-plugin-semindex for in-process indexing, or set ' +
            'WIKI_INDEXER_URL to proxy to a farm indexer; indexes can also ' +
            'arrive by sync.',
    })
  })

  console.log('[wiki-plugin-similarity] routes registered')
}

module.exports = { startServer }
