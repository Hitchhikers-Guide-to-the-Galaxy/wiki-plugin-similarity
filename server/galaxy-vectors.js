// wiki-plugin-similarity — galaxy vector store (CommonJS)
//
// The galaxy tree is a farm-shaped directory of OFF-FARM federation sites,
// written by the galaxy indexer (~/src/fedwiki-galaxy on the writer host):
//
//   {GALAXY_ROOT}/{domain}/status/semantic-vectors.json
//     [{slug, title, vector, chars, items, date, synopsis}]
//
// Entries are a superset of the farm shape: enrichment fields are precomputed
// at index time because off-farm pages have no local page JSON for
// search-report's enrich() to read.
//
// Farm vectors (149 MB across the whole farm) are cheap enough to re-read per
// query; galaxy scale is not. This module holds deserialized per-site entries
// in a byte-capped LRU keyed by file mtime, so a repeat query over a followed
// roster costs no JSON parsing at all.

const fs   = require('node:fs')
const path = require('node:path')

const CACHE_BYTES = parseInt(process.env.WIKI_GALAXY_VECTOR_CACHE_MB || '512', 10) * 1024 * 1024

// Galaxy root: env override, else the Pi5 tree, else the Mac staging tree.
const galaxyRoot = () => {
  if (process.env.WIKI_GALAXY_VECTORS) return process.env.WIKI_GALAXY_VECTORS
  const pi5 = '/mnt/wikimedia/galaxy'
  try { fs.accessSync(pi5, fs.constants.F_OK); return pi5 } catch { /* not the Pi5 */ }
  return path.join(process.env.HOME || '/tmp', '.cache', 'wiki-similarity', 'galaxy-vectors')
}

// domain → {mtimeMs, bytes, pages}
const cache = new Map()
let cachedBytes = 0

const evictUntil = budget => {
  for (const [domain, entry] of cache) {
    if (cachedBytes <= budget) break
    cache.delete(domain)
    cachedBytes -= entry.bytes
  }
}

// Same contract as search-report's loadVectors(farm, domain) — returns the
// entry array (with enrichment fields) or [].
const loadGalaxyVectors = (farm, domain) => {
  const file = path.join(farm, domain, 'status', 'semantic-vectors.json')
  let stat
  try { stat = fs.statSync(file) } catch { return [] }

  const hit = cache.get(domain)
  if (hit && hit.mtimeMs === stat.mtimeMs) {
    cache.delete(domain)          // refresh LRU position
    cache.set(domain, hit)
    return hit.pages
  }

  let pages
  try { pages = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return [] }
  if (!Array.isArray(pages)) return []

  if (hit) { cache.delete(domain); cachedBytes -= hit.bytes }
  cachedBytes += stat.size
  cache.set(domain, { mtimeMs: stat.mtimeMs, bytes: stat.size, pages })
  evictUntil(CACHE_BYTES)
  return pages
}

const galaxyCacheStats = () => ({
  sites: cache.size,
  bytes: cachedBytes,
  capBytes: CACHE_BYTES,
})

module.exports = { galaxyRoot, loadGalaxyVectors, galaxyCacheStats }
