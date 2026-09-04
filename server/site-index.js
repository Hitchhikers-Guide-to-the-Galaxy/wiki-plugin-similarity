// wiki-plugin-similarity — the Site Index (CommonJS)
//
// One vector per SITE for every site the federation registry knows, so a
// query can rank sites before it reads a single page vector — the resource
// selection step of federated search (design: search.fedwiki.club
// /incremental-federated-search). Built by site_index.py on the galaxy
// writer host into {GALAXY_ROOT}/sites.json:
//
//   { model, dim, builtAt, count,
//     sites: [{domain, kind: 'galaxy'|'farm', method: 'pages'|'sitemap',
//              pages, sampled, vector[dim], builtAt, source, indexedAt,
//              tier, owner, near: [domains], x, y}] }
//
// A farm that has no galaxy tree gets the index from its first PEER — the
// nearest sibling farm named in {farmRoot}/similarity.json `peers` — fetched
// by conditional GET into the plugin's cache dir and refreshed every few
// hours. Sites this farm itself serves are added from the vector store
// (siteCentroid) so local and private sites rank in the same space; those
// never leave the process.
//
// Held as one Float32 matrix (a few MB for a few thousand sites), mtime-fresh.

const fs    = require('node:fs')
const path  = require('node:path')
const http  = require('node:http')
const https = require('node:https')

const { siteCentroid } = require('./vector-store')
const { listDomains } = require('./farm-lib')

const TTL_MS = parseInt(process.env.WIKI_SITE_INDEX_TTL_MS || String(6 * 3600 * 1000), 10)

const cacheDir = () => path.join(process.env.HOME || '/tmp', '.cache', 'wiki-similarity')
const peerCopy = () => path.join(cacheDir(), 'galaxy-sites.json')

// ── Loading ─────────────────────────────────────────────────────────────────

let loaded = null   // {file, mtimeMs, model, dim, builtAt, domains[], matrix, meta[], byDomain}

const parseIndex = (raw, file, mtimeMs) => {
  const data = JSON.parse(raw)
  const sites = Array.isArray(data.sites) ? data.sites : []
  const dim = data.dim || (sites[0] && sites[0].vector.length) || 0
  const good = sites.filter(s => s && typeof s.domain === 'string' &&
    Array.isArray(s.vector) && s.vector.length === dim)
  const matrix = new Float32Array(good.length * dim)
  const meta = new Array(good.length)
  const byDomain = new Map()
  good.forEach((s, i) => {
    const { vector, ...rest } = s
    matrix.set(vector, i * dim)
    meta[i] = rest
    byDomain.set(s.domain, i)
  })
  return { file, mtimeMs, model: data.model, dim, builtAt: data.builtAt || 0,
           matrix, meta, byDomain, count: good.length }
}

// The index file for this host: the galaxy tree's own, else the peer copy.
const indexFile = galaxyDir => {
  if (galaxyDir) {
    const own = path.join(galaxyDir, 'sites.json')
    if (fs.existsSync(own)) return own
  }
  return fs.existsSync(peerCopy()) ? peerCopy() : null
}

const loadSiteIndex = galaxyDir => {
  const file = indexFile(galaxyDir)
  if (!file) return null
  let stat
  try { stat = fs.statSync(file) } catch { return null }
  if (loaded && loaded.file === file && loaded.mtimeMs === stat.mtimeMs) return loaded
  try { loaded = parseIndex(fs.readFileSync(file, 'utf8'), file, stat.mtimeMs) }
  catch (e) { console.error('[wiki-plugin-similarity] site index unreadable:', e.message); return null }
  return loaded
}

// ── Fetching from a peer ────────────────────────────────────────────────────

const getJson = (url, headers = {}, timeoutMs = 30_000) => new Promise((resolve, reject) => {
  const u = new URL(url)
  const mod = u.protocol === 'http:' ? http : https
  const req = mod.get(u, { headers, timeout: timeoutMs }, res => {
    let data = ''
    res.on('data', c => { data += c })
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
  })
  req.on('timeout', () => { req.destroy(new Error('timeout')) })
  req.on('error', reject)
})

let refreshing = null
// Refresh the peer copy if older than TTL. peers: ['https://host', ...].
// Conditional on Last-Modified so an unchanged index costs one 304.
const refreshFromPeers = async (peers, galaxyDir) => {
  if (!peers || !peers.length) return null
  if (galaxyDir && fs.existsSync(path.join(galaxyDir, 'sites.json'))) return null
  if (refreshing) return refreshing
  refreshing = (async () => {
    const copy = peerCopy()
    let age = Infinity, since = null
    try { const st = fs.statSync(copy); age = Date.now() - st.mtimeMs; since = st.mtime.toUTCString() } catch { /* none */ }
    if (age < TTL_MS) return copy
    for (const peer of peers) {
      try {
        const base = peer.replace(/\/$/, '')
        const res = await getJson(`${base}/system/galaxy-sites.json`, since ? { 'If-Modified-Since': since } : {})
        if (res.status === 304) { fs.utimesSync(copy, new Date(), new Date()); return copy }
        if (res.status !== 200) continue
        JSON.parse(res.body)   // reject a non-index answer before it is cached
        fs.mkdirSync(cacheDir(), { recursive: true })
        fs.writeFileSync(copy + '.tmp', res.body)
        fs.renameSync(copy + '.tmp', copy)
        console.log(`[wiki-plugin-similarity] site index refreshed from ${peer}`)
        return copy
      } catch (e) {
        console.log(`[wiki-plugin-similarity] site index from ${peer} failed: ${e.message}`)
      }
    }
    return fs.existsSync(copy) ? copy : null
  })().finally(() => { refreshing = null })
  return refreshing
}

// ── This farm's own sites, from the vector store ────────────────────────────
// Local farm sites (kind local/public) get centroids from their own page
// vectors; a restricted (private) site is included only when the caller may
// see it — `exclude` carries that decision, as it does for every scan.

const localSites = (farms, restricted, exclude) => {
  const out = []
  const domains = listDomains(farms.filter(([, kind]) => kind !== 'galaxy'), ['*'],
    restricted, 'status/semantic-vectors.json')
  for (const { farm, kind, domain } of domains) {
    if (exclude && exclude.has(domain)) continue
    const v = siteCentroid(path.join(farm, domain, 'status', 'semantic-vectors.json'))
    if (v) out.push({ domain, kind, method: 'pages', vector: v, source: 'own' })
  }
  return out
}

// ── Demand log ──────────────────────────────────────────────────────────────
// Sites that rank highly for real queries but carry no page vectors
// (method: sitemap) are counted here; the galaxy scout reads the file and
// promotes them, so what people search for decides what is embedded next.
// {domain: {count, last}} in the plugin's cache dir; never a farm tree.

const wantedFile = () => path.join(cacheDir(), 'wanted.json')
let wantedBuf = null, wantedTimer = null
const noteWanted = domains => {
  if (!domains || !domains.length) return
  if (!wantedBuf) { try { wantedBuf = JSON.parse(fs.readFileSync(wantedFile(), 'utf8')) } catch { wantedBuf = {} } }
  const now = Date.now()
  for (const d of domains) {
    const e = wantedBuf[d] || { count: 0, last: 0 }
    e.count += 1; e.last = now
    wantedBuf[d] = e
  }
  if (!wantedTimer) {
    wantedTimer = setTimeout(() => {
      wantedTimer = null
      try {
        fs.mkdirSync(cacheDir(), { recursive: true })
        fs.writeFileSync(wantedFile(), JSON.stringify(wantedBuf))
      } catch { /* a log, not a store */ }
    }, 5000).unref()
  }
}

const siteIndexStats = galaxyDir => {
  const idx = loadSiteIndex(galaxyDir)
  if (!idx) return null
  return { file: idx.file, count: idx.count, dim: idx.dim, builtAt: idx.builtAt,
           via: idx.file === peerCopy() ? 'peer' : 'galaxy' }
}

module.exports = { loadSiteIndex, refreshFromPeers, localSites, siteIndexStats, indexFile, peerCopy, noteWanted, wantedFile }
