// wiki-plugin-similarity — server-side component
//
// Registers same-origin /system routes with the wiki's Express app via the
// startServer(params) hook in wiki-server/lib/plugins.js. Everything a search
// needs runs in-process on whatever host serves the wiki — no HomeLab FastAPI
// dependency — so club members on the public farm get working search.
//
// Routes:
//   GET  /system/indexed-domains.json?pattern=glob1,glob2
//     [{domain, page_count, built}] for domains with a semantic-vectors.json;
//     built is when those vectors were last written (ISO, since 0.16.0).
//   GET  /system/semantic-vectors.json[?domain=]
//     Serves {farm}/{domain}/status/semantic-vectors.json.
//   GET|POST /system/embed.json  ?text=… | {text}
//     384-dim unit vector via the crash-isolated child-process embedder
//     (BAAI/bge-small-en-v1.5 — same model the indexes were built with).
//     POST for whole-page prose (long GET query strings die with 431).
//     Set WIKI_EMBED_URL to proxy to an external embedder instead.
//   GET  /system/similarity-health.json
//     Embedder supervisor state (child-process | semindex | url, breaker,
//     recent crashes) — 200 always; diagnosable from outside. Since 0.14.0 a
//     url embedder also reports the source it came from (env | file), and
//     localEmbedderAvailable says whether this box could embed unaided — the
//     local path is never exercised while a proxy is set, so nothing else
//     answers that question from outside.
//   POST /system/search-report.json  {query, domains, limit, threshold, live,
//                                     vector?, seed?, text?, excludePage?}
//     Ranked, stub-filtered, fork-bundled semantic report (page JSON).
//     Optionally seeded by an existing page: vector (precomputed embedding) >
//     seed {site, slug} (stored page vector from farm disk) > text (embedded
//     instead of query). excludePage {site, slug} drops the host page and its
//     slug-fork family from the results; defaults to seed.
//   POST /system/site-report.json  {query, domains, limit, format,
//                                   vector?, seed?, text?, excludePage?}
//     Which site should this page go on? Per-domain aggregation of the
//     page-vector scan (page JSON, or flat JSON with format: 'flat').
//     Same seed params; excludePage keeps an existing page from voting for
//     its own home site.
//   GET  /system/farm-search.json?q=…&pattern=…&limit=…
//     Galactic keyword search — reads each site's own per-edit MiniSearch
//     index (status/site-index.json). No index building.
//   GET  /system/title-twins.json?slug=…&pattern=…&limit=…
//     Which sites carry a page with this slug? Existence scan over each
//     site's sitemap (forks share the slug) — [{domain, slug, title}].
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
const { buildSiteReport } = require('./site-report')
const { searchFarm, keywordReportPage, findTwins } = require('./farm-search')
const { searchGalaxy } = require('./galaxy-search')
const { galaxyRoot, galaxyCacheStats } = require('./galaxy-vectors')
const { warmUp } = require('./vector-store')
const { resolveAuthor } = require('./author-index')
const { ceiling, grantingDomains, guardEnvelope } = require('./peer-guard')
const { postToPeer, appendPeerSections, makePeerDesk, setModelMeta } = require('./peer')
const { parseNets, isTrusted } = require('./trust')

const MODEL_META = { model: 'BAAI/bge-small-en-v1.5', dim: 384 }
const PLUGIN_VERSION = (() => {
  try { return require('../package.json').version } catch { return 'unknown' }
})()

// Optional external embedder (proxy) — unset means embed in-process.
//
// Validated since 0.14.0. The public farm was set to the literal string
// "disabled", which is truthy, so every query was POSTed to a URL that does
// not parse and semantic search was dead farm-wide. A value that is not an
// http(s) URL now means what whoever typed it meant: no proxy.
const httpUrlOrNull = raw => {
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol === 'http:' || u.protocol === 'https:') return raw
  } catch { /* not a URL at all */ }
  return null
}

const ENV_EMBED_URL = (() => {
  const raw = process.env.WIKI_EMBED_URL
  if (!raw) return null
  const ok = httpUrlOrNull(raw)
  if (!ok) {
    console.log('[wiki-plugin-similarity] WIKI_EMBED_URL is not an http(s) URL ' +
      `(${JSON.stringify(raw)}) — ignoring it and embedding in-process`)
  }
  return ok
})()
// Farm indexer for BUILD requests (HomeLab FastAPI, or unset on the public farm).
const INDEXER_URL = process.env.WIKI_INDEXER_URL || null
// Optional additional farm roots, colon-separated absolute paths.
const EXTRA_FARMS = (process.env.WIKI_EXTRA_FARMS || '').split(':').filter(Boolean)
// Restricted-domain globs, comma-separated (e.g. "*.private.fish,*.pi5.private.fish").
// Restricted sites are hidden from every route unless the caller is trusted —
// see ./trust.js and WIKI_TRUSTED_NETS.
const RESTRICTED_GLOBS = (process.env.WIKI_RESTRICTED_DOMAINS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
const TRUSTED_NETS = parseNets()

// ── HTTP helpers ──────────────────────────────────────────────────────────────

// Pick the agent by protocol. Before 0.14.0 both helpers were http-only with
// port 80 hard-defaulted, so an https:// embed URL silently failed — the
// delegation path could never have worked across the public internet.
const agentFor = u => (u.protocol === 'https:' ? https : http)

const postJson = (url, body) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const u = new URL(url)
    const opts = {
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     u.pathname + u.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }
    const req = agentFor(u).request(opts, res => {
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
    agentFor(u).get(u, res => {
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


// ── Embed URL from the farm root ──────────────────────────────────────────────
// Where the environment is not ours to set — the public farm's stack belongs to
// its host — the address may instead come from a file in the farm root:
//
//   {farmRoot}/similarity.json   { "embedUrl": "https://host/system/…" }
//
// Cached by mtime so a synced edit retargets the embedder with no restart, the
// same discipline wiki-plugin-farm's keys.js uses for status/api-keys.json.
// The file is never served over HTTP; writing it means write access to the farm.
let cfgCache = null // { mtimeMs, embedUrl }

const fileEmbedUrl = farmRoot => {
  const file = path.join(farmRoot, 'similarity.json')
  let stat
  try { stat = fs.statSync(file) } catch { cfgCache = null; return null }
  if (cfgCache && cfgCache.mtimeMs === stat.mtimeMs) return cfgCache.embedUrl
  let embedUrl = null
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
    embedUrl = httpUrlOrNull(cfg.embedUrl)
    if (cfg.embedUrl && !embedUrl) {
      console.log(`caution: ${file}: embedUrl is not an http(s) URL — ignoring it`)
    }
  } catch (e) {
    console.log(`caution: ${file}: ${e.message}`)
  }
  cfgCache = { mtimeMs: stat.mtimeMs, embedUrl }
  return embedUrl
}

// Can this process turn text into a vector without leaving the box? Reported by
// the health route even when a proxy is configured, because with a proxy set the
// local path is never exercised and the logs stay silent about it — which is
// exactly the question that was unanswerable on the public farm.
const localEmbedderAvailable = () => {
  if (embedder.viaSemindex) return true
  try { require.resolve('@xenova/transformers'); return true } catch { return false }
}

// ── startServer — called by wiki-server/lib/plugins.js ────────────────────────

setModelMeta(MODEL_META)

const startServer = ({ argv, app }) => {
  // Farm root: argv.status = {farm}/{thisDomain}/status  →  go up two levels
  const farmRoot = path.dirname(path.dirname(argv.status))

  // env wins; then the farm-root file; then embed in-process.
  const embedUrl       = () => ENV_EMBED_URL || fileEmbedUrl(farmRoot)
  const embedUrlSource = () => (ENV_EMBED_URL ? 'env' : (fileEmbedUrl(farmRoot) ? 'file' : null))
  // primary farm is 'local'; extra farms (Nextcloud mirror) are 'public'.
  // The galaxy tree (off-farm federation sites, written by the galaxy
  // indexer) joins as kind 'galaxy' when present — never matched by '*',
  // only by GALAXY, an explicit domain, or a roster (see farm-lib.js).
  const farms = [[farmRoot, 'local'], ...EXTRA_FARMS.map(f => [f, 'public'])]
  const galaxyDir = galaxyRoot()
  if (galaxyDir && fs.existsSync(galaxyDir)) farms.push([galaxyDir, 'galaxy'])
  // Restricted = the local farm's own wikiDomains (argv, merged by wiki's
  // farm.js) + WIKI_RESTRICTED_DOMAINS globs + extra farms' config files.
  const restricted = loadRestricted(EXTRA_FARMS,
    { wikiDomains: argv.wikiDomains, globs: RESTRICTED_GLOBS })
  const ctx = { farms, restricted, embed: embedText }
  // Pay the vector parse once, now, off the request path — and only once per
  // process however many sites' startServer calls arrive (vector-store.js).
  warmUp(farms).then(w => {
    if (w.total) console.log(`[wiki-plugin-similarity] vector store warm: ` +
      `${w.done}/${w.total} files in ${w.ms} ms${w.capped ? ' (cap reached)' : ''}`)
  }).catch(e => console.error('[wiki-plugin-similarity] warm-up failed:', e.message))

  // Who may see restricted sites (./trust.js): owner session, a tool on this
  // host, or a proxied client on a trusted net. Everyone else gets the
  // public view — `ctxFor(req)` carries the exclusion into every scan.
  const ownerFile = path.join(argv.status || '', 'owner.json')
  const trusted = req => isTrusted(req, {
    securityhandler: app.securityhandler,
    ownerFileExists: (() => { try { return fs.existsSync(ownerFile) } catch { return false } })(),
    nets: TRUSTED_NETS,
  })
  const ctxFor = req => trusted(req) ? ctx : { ...ctx, exclude: restricted }
  const visible = (req, domain) => !restricted.has(domain) || trusted(req)

  console.log('[wiki-plugin-similarity] registering /system routes, farms:',
    farms.map(([f]) => f).join(', '),
    `| restricted: ${restricted.size} names + ${restricted.globs.length} globs`,
    `| trusted nets: ${TRUSTED_NETS.join(' ')}`)

  // Warm the embedding model in the background so the first query is fast.
  if (!embedUrl()) embedder.warm()

  async function embedText(text) {
    const url = embedUrl()
    if (!url) return embedder.embed(text)
    try {
      return (await postJson(url, { text })).vector
    } catch (e) {
      // A proxy we cannot reach is the same outage as a local embedder that
      // will not start, and callers must be able to tell "no vector to be had"
      // from "bad query". Without this the failure arrived as a bare 500 and
      // the client could not know to fall back to keyword search.
      const err = new Error(`remote embedder at ${url}: ${e.message}`)
      err.code = 'EMBEDDER_DOWN'
      throw err
    }
  }

  const cors = res => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }

  for (const route of ['/system/indexed-domains.json', '/system/semantic-vectors.json',
                       '/system/embed.json', '/system/search-report.json',
                       '/system/site-report.json',
                       '/system/farm-search.json', '/system/title-twins.json',
                       '/system/build-index.json',
                       '/system/galaxy-search.json', '/system/peer-search.json',
                       '/system/peer-hello.json', '/system/similarity-health.json',
                       '/system/galaxy-registry.json']) {
    app.options(route, (req, res) => { cors(res); res.sendStatus(204) })
  }

  // Peer federation transport, probes and rate limits live in ./peer.js —
  // one desk per server, built once at startup.
  const { requestIp, getFromPeer, probePeer, askPeers,
          isDuplicate, takeIpToken, takeGlobalToken } = makePeerDesk()

  // ── GET /system/indexed-domains.json?pattern=glob1,glob2 ──────────────────
  app.get('/system/indexed-domains.json', (req, res) => {
    cors(res)
    const raw      = req.query.pattern || '*'
    const patterns = raw.split(',').map(p => p.trim()).filter(Boolean)
    const limit    = parseInt(req.query.limit) || null
    let results = listDomains(farms, patterns, restricted, 'status/semantic-vectors.json')
      .filter(({ domain }) => visible(req, domain))
      .map(({ farm, domain }) => {
        const file = path.join(farm, domain, 'status', 'semantic-vectors.json')
        let pageCount = null
        let built = null
        try {
          // When the vectors were last written. One stat on top of a read we
          // are already paying for, and it is what lets a reader see whether
          // the index behind an answer is current or months old.
          built = new Date(fs.statSync(file).mtimeMs).toISOString()
          const pages = JSON.parse(fs.readFileSync(file, 'utf8'))
          pageCount = Array.isArray(pages) ? pages.length : null
        } catch { /* ignore */ }
        return { domain, page_count: pageCount, built }
      })
    if (limit) results = results.slice(0, limit)
    res.json(results)
  })

  // ── GET /system/galaxy-registry.json ──────────────────────────────────────
  // Read-only view of the galaxy site registry (written by the galaxy
  // indexer host — the similarity server never writes it).
  app.get('/system/galaxy-registry.json', (req, res) => {
    cors(res)
    fs.readFile(path.join(galaxyDir, 'registry.json'), 'utf8', (err, data) => {
      if (err) return res.status(404).json({ error: 'no galaxy registry on this host' })
      res.type('application/json').send(data)
    })
  })

  // ── GET /system/semantic-vectors.json[?domain=] ────────────────────────────
  app.get('/system/semantic-vectors.json', (req, res) => {
    cors(res)
    const domain  = req.query.domain || req.hostname || 'localhost'
    // Restricted vectors are as private as the pages: titles ride in the file
    // and the vectors themselves leak topic structure.
    if (!visible(req, domain)) {
      return res.status(403).json({ error: `${domain} is restricted` })
    }
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

  // ── GET|POST /system/embed.json ────────────────────────────────────────────
  // GET ?text=… suits short queries; POST {text} carries whole-page prose —
  // long text in a GET query string overflows Node's header limit and dies
  // with 431 before any handler runs. One handler, both verbs (the semindex
  // dual-verb house pattern).
  const embedHandler = async (req, res) => {
    cors(res)
    let text = req.query.text
    if (!text && req.method === 'POST') {
      try { text = (await readBody(req)).text } catch { /* fall through to 400 */ }
    }
    if (!text) return res.status(400).json({ error: 'text parameter required' })
    try {
      res.json({ vector: await embedText(text) })
    } catch (e) {
      console.error('[wiki-plugin-similarity] embed error:', e.message)
      res.status(e.code === 'EMBEDDER_DOWN' ? 503 : 502)
        .json({ error: `embedding unavailable: ${e.message}` })
    }
  }
  app.get('/system/embed.json', embedHandler)
  app.post('/system/embed.json', embedHandler)

  // Seed params shared by the report routes: a report can be seeded by an
  // existing page rather than typed text. Validated here so the pipelines can
  // trust shapes: vector must be a full-dimension number array; seed and
  // excludePage need site+slug strings; excludePage defaults to seed (a
  // report about a page should not lead with the page itself).
  const seedOptsFrom = body => {
    const vec = Array.isArray(body.vector) && body.vector.length === MODEL_META.dim &&
      body.vector.every(x => typeof x === 'number') ? body.vector : null
    const ref = v => (v && typeof v.site === 'string' && typeof v.slug === 'string')
      ? { site: v.site, slug: v.slug } : null
    const seed = ref(body.seed)
    return {
      vector: vec,
      seed,
      text: typeof body.text === 'string' && body.text.trim() ? body.text : null,
      excludePage: ref(body.excludePage) || seed,
    }
  }

  // ── GET /system/similarity-health.json — embedder supervisor state ────────
  app.get('/system/similarity-health.json', (req, res) => {
    cors(res)
    res.json({
      plugin: 'wiki-plugin-similarity',
      version: PLUGIN_VERSION,
      ...MODEL_META,
      embedder: (() => {
        const url = embedUrl()
        return url ? { via: 'url', url, source: embedUrlSource() } : embedder.status()
      })(),
      localEmbedderAvailable: localEmbedderAvailable(),
      galaxy: galaxyDir && fs.existsSync(galaxyDir)
        ? { root: galaxyDir }
        : null,
      // The vector store: sites and pages resident, heap bytes against the
      // cap, how many files were parsed vs restored from the disk cache, and
      // the warm-up state — `warm.state` is 'warm' once every file in every
      // tree is resident, which is when a federation query costs milliseconds.
      store: galaxyCacheStats(),
      // Restricted-site policy as this server sees it, and whether THIS
      // caller is trusted — the one-line answer to "why can't I see X?".
      restricted: { names: restricted.size, globs: restricted.globs },
      trustedNets: TRUSTED_NETS,
      callerTrusted: trusted(req),
    })
  })

  // ── POST /system/search-report.json ────────────────────────────────────────
  // body.farms: peer farms asked to continue the search (FARM prototype).
  // Optional page seed: {vector | seed: {site, slug} | text} + excludePage —
  // query stays required (report title + title-term boost). See seedOptsFrom.
  app.post('/system/search-report.json', async (req, res) => {
    cors(res)
    try {
      const body = await readBody(req)
      if (!body.query) return res.status(400).json({ error: 'query required' })

      // body.author narrows to the sites that person owns here. It is applied
      // locally AND forwarded to peers, who resolve the same plain name against
      // their own records — an endpoint that accepted the field but only
      // honoured it remotely would be a trap.
      let domains = body.domains || ['*']
      if (body.author) {
        const res_ = resolveAuthor(farms, String(body.author).slice(0, 100))
        if (res_.ambiguous) {
          return res.status(409).json({
            error: `"${body.author}" matches more than one account here`,
            accounts: res_.ambiguous,
            hint: 'ask again with a username',
          })
        }
        if (res_.available !== false) {
          // Author narrows on a different axis from scope, so the two INTERSECT
          // — replacing the caller's scope would silently widen a search that
          // asked to be narrow. Expand their patterns first, then keep only
          // what this author owns.
          const owned = new Set(res_.sites)
          domains = listDomains(farms, domains, restricted)
            .map(d => d.domain)
            .filter(d => owned.has(d))
          if (!domains.length) domains = [' none']   // match nothing, not everything
        }
      }

      const page = await buildReport(
        body.query, domains, body.limit || 10, ctxFor(req),
        body.threshold ?? null, !!body.live, seedOptsFrom(body))
      if (Array.isArray(body.farms) && body.farms.length) {
        const envelope = {
          query: body.query, kind: 'report', limit: body.limit || 10,
          hops: 0, requestId: crypto.randomBytes(8).toString('hex'),
          origin: req.hostname,
          // the name as typed, never our resolved username
          ...(body.author ? { author: String(body.author).slice(0, 100) } : {}),
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

  // ── POST /system/site-report.json ──────────────────────────────────────────
  // {query, domains, limit, format} → which SITE should this page go on?
  // Per-domain aggregation of the page-vector scan (site-report.js). Farm-local
  // by design — no peer federation; placement is a question about our own farm.
  app.post('/system/site-report.json', async (req, res) => {
    cors(res)
    try {
      const body = await readBody(req)
      if (!body.query) return res.status(400).json({ error: 'query required' })
      res.json(await buildSiteReport(
        body.query, body.domains || ['*'], body.limit || 10, ctxFor(req),
        body.format || null, seedOptsFrom(body)))
    } catch (e) {
      console.error('[wiki-plugin-similarity] site-report error:', e.message)
      res.status(e.code === 'EMBEDDER_DOWN' ? 503 : 500)
        .json({ error: `site-report failed: ${e.message}` })
    }
  })

  // ── GET /system/title-twins.json?slug=…&pattern=…&limit=… ────────────────
  // Which sites carry a page with this slug? An existence scan over each
  // site's own sitemap (mtime-cached), not a ranked search — forks share the
  // slug by definition. Answers [{domain, slug, title}].
  app.get('/system/title-twins.json', (req, res) => {
    cors(res)
    const slug = (req.query.slug || '').trim()
    if (!slug) return res.status(400).json({ error: 'slug parameter required' })
    const patterns = (req.query.pattern || '*').split(',').map(p => p.trim()).filter(Boolean)
    const limit = parseInt(req.query.limit) || 25
    try {
      res.json(findTwins(farms, patterns, restricted, slug, limit)
        .filter(t => visible(req, t.domain)))
    } catch (e) {
      res.status(500).json({ error: `title-twins failed: ${e.message}` })
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
        ? searchFarm(farms, localPatterns, restricted, q, limit,
                     trusted(req) ? null : restricted)
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
      let grantedNames = granted.map(d => d.domain)

      // An author filter is one more field on the envelope, and it travels as
      // the plain name the asker typed — never a username resolved against
      // their map. We answer from OUR OWN ownership records: we cannot resolve
      // another farm's pseudonyms, only ours. A farm that keeps no records
      // ignores the field and answers unfiltered rather than failing.
      let authorFilter = 'none'
      if (envelope.author) {
        const who = String(envelope.author).slice(0, 100)
        const res = resolveAuthor(farms, who)
        if (res.available === false) {
          authorFilter = 'ignored'          // no ownership records on this farm
        } else if (res.ambiguous) {
          authorFilter = 'ambiguous'        // shared display name — never guess
          grantedNames = []
        } else {
          authorFilter = 'applied'
          const owned = new Set(res.sites)
          grantedNames = grantedNames.filter(d => owned.has(d))
        }
      }
      if (!grantedNames.length) {
        return res.json({
          page: { title: `${envelope.query} Report`, story: [] },
          meta: { ...MODEL_META, version: PLUGIN_VERSION, farm: req.hostname,
                  sites: 0, count: 0, authorFilter },
        })
      }

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
        farm: req.hostname, sites: grantedNames.length, count, authorFilter } })
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

// httpUrlOrNull and fileEmbedUrl are exported for the tests: they decide whether
// this farm embeds for itself or delegates, which is worth pinning down.
module.exports = { startServer, httpUrlOrNull, fileEmbedUrl, localEmbedderAvailable }
