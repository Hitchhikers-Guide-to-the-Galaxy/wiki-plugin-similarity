// wiki-plugin-similarity — galaxy keyword search (CommonJS)
//
// Extends the galactic keyword search beyond farm disk: for a federation site
// this server does NOT host, fetch its per-edit MiniSearch index
// (/system/site-index.json) and sitemap over HTTP with a conditional-GET disk
// cache, then search it exactly like a farm domain. The browser never holds
// an index; the server's cache is shared by every reader.
//
// Cache layout: {cacheDir}/{site}/site-index.json + sitemap.json + meta.json
// (meta holds each file's Last-Modified for revalidation and a fetched-at
// timestamp for the TTL). Within TTL the disk copy is used as-is; after TTL a
// conditional GET revalidates (304 = keep). Unreachable sites fall back to
// whatever the cache holds.

const fs    = require('node:fs')
const path  = require('node:path')
const https = require('node:https')
const http  = require('node:http')

const MiniSearch = require('minisearch')

const CACHE_DIR = process.env.WIKI_GALAXY_CACHE ||
  path.join(__dirname, '.galaxy-cache')
const TTL_MS      = parseInt(process.env.WIKI_GALAXY_TTL_MS) || 5 * 60_000
const CONCURRENCY = 8
const LRU_MAX     = 50   // deserialized indexes held in memory

const MS_OPTIONS = { fields: ['title', 'content'] }

// ── HTTP fetch with Last-Modified revalidation ────────────────────────────────
// *.localhost sites need a loopback lookup (Node's resolver doesn't know
// RFC 6761 subdomains); public domains follow /etc/hosts, so Offline Edit
// Mode diverts these fetches to the local mirror by construction.

const fetchConditional = (site, filePath, lastModified) =>
  new Promise(resolve => {
    const isLocal = site.endsWith('.localhost') || site.startsWith('localhost')
    const mod = isLocal ? http : https
    const opts = {
      hostname: site.split(':')[0],
      port: site.includes(':') ? site.split(':')[1] : (isLocal ? 80 : 443),
      path: filePath,
      headers: lastModified ? { 'If-Modified-Since': lastModified } : {},
      timeout: 10_000,
    }
    if (isLocal) opts.lookup = (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }])
    const req = mod.get(opts, res => {
      if (res.statusCode === 304) { res.resume(); return resolve({ status: 304 }) }
      if (res.statusCode !== 200) { res.resume(); return resolve({ status: res.statusCode }) }
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => resolve({
        status: 200, data, lastModified: res.headers['last-modified'] || null,
      }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0 }) })
    req.on('error', () => resolve({ status: 0 }))
  })

// ── Disk cache ────────────────────────────────────────────────────────────────

const siteDir = site => path.join(CACHE_DIR, site.replace(/[^a-zA-Z0-9.:-]/g, '_'))

const readMeta = site => {
  try { return JSON.parse(fs.readFileSync(path.join(siteDir(site), 'meta.json'), 'utf8')) }
  catch { return {} }
}

const refreshFile = async (site, name, meta) => {
  const { status, data, lastModified } =
    await fetchConditional(site, `/system/${name}`, meta[name]?.lastModified)
  if (status === 200) {
    fs.mkdirSync(siteDir(site), { recursive: true })
    fs.writeFileSync(path.join(siteDir(site), name), data)
    meta[name] = { lastModified, fetchedAt: Date.now() }
  } else if (status === 304) {
    meta[name].fetchedAt = Date.now()
  }
  // any other status: keep whatever the cache holds
}

// Ensure the cache for a site is fresh-enough; returns true if usable files exist.
const ensureSite = async site => {
  const meta = readMeta(site)
  const stale = name => !meta[name] || (Date.now() - (meta[name].fetchedAt || 0)) > TTL_MS
  if (stale('site-index.json') || stale('sitemap.json')) {
    await Promise.all([
      refreshFile(site, 'site-index.json', meta),
      refreshFile(site, 'sitemap.json', meta),
    ])
    try { fs.writeFileSync(path.join(siteDir(site), 'meta.json'), JSON.stringify(meta)) }
    catch { /* cache dir unwritable — searching still works this request */ }
  }
  return fs.existsSync(path.join(siteDir(site), 'site-index.json'))
}

// ── In-memory LRU of deserialized indexes ─────────────────────────────────────

const lru = new Map() // site → {mtime, ms, titles, synopses}

const loadCachedIndex = site => {
  const indexPath = path.join(siteDir(site), 'site-index.json')
  let mtime
  try { mtime = fs.statSync(indexPath).mtimeMs } catch { return null }
  const hit = lru.get(site)
  if (hit && hit.mtime === mtime) {
    lru.delete(site); lru.set(site, hit) // refresh LRU position
    return hit
  }
  let ms
  try { ms = MiniSearch.loadJSON(fs.readFileSync(indexPath, 'utf8'), MS_OPTIONS) }
  catch { return null }
  const titles = new Map()
  const synopses = new Map()
  try {
    const sitemap = JSON.parse(fs.readFileSync(path.join(siteDir(site), 'sitemap.json'), 'utf8'))
    for (const p of sitemap) {
      titles.set(p.slug, p.title)
      if (p.synopsis) synopses.set(p.slug, p.synopsis)
    }
  } catch { /* titles fall back to slugs */ }
  const entry = { mtime, ms, titles, synopses }
  lru.set(site, entry)
  while (lru.size > LRU_MAX) lru.delete(lru.keys().next().value)
  return entry
}

// ── Search remote sites ───────────────────────────────────────────────────────
// sites: explicit hostnames not present on farm disk. Returns the same result
// row shape as farm-search.js so callers can merge.

const searchGalaxy = async (sites, query, limit) => {
  const results = []
  let searched = 0
  for (let i = 0; i < sites.length; i += CONCURRENCY) {
    const batch = sites.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async site => {
      if (!await ensureSite(site)) return
      const entry = loadCachedIndex(site)
      if (!entry) return
      searched += 1
      let hits
      try { hits = entry.ms.search(query, { boost: { title: 2 } }) } catch { return }
      for (const h of hits) {
        results.push({
          domain: site,
          slug: String(h.id),
          title: entry.titles.get(String(h.id)) || String(h.id),
          synopsis: entry.synopses.get(String(h.id)) || '',
          score: h.score,
        })
      }
    }))
  }
  results.sort((a, b) => b.score - a.score)
  return { results: results.slice(0, limit), searched, matched: results.length }
}

module.exports = { searchGalaxy }
