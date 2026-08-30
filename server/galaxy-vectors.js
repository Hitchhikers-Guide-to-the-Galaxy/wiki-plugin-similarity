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
// This module holds deserialized per-site entries in a byte-capped LRU keyed
// by file path + mtime, so a repeat query costs no JSON parsing at all. Since
// 0.13.1 the FARM vectors ride the same cache: "cheap enough to re-read per
// query" proved false at 400 sites / 150 MB — the synchronous re-parse
// blocked the event loop for tens of seconds and 502'd concurrent page saves
// (Semantic ReIndex Plan, Phase 1; the yellow-halo bug, 2026-08-30).

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

// file path → {mtimeMs, bytes, pages} — keyed by path, not domain, so the
// same domain name in different farms (or farm vs galaxy) can never collide.
const cache = new Map()
let cachedBytes = 0

const evictUntil = budget => {
  for (const [file, entry] of cache) {
    if (cachedBytes <= budget) break
    cache.delete(file)
    cachedBytes -= entry.bytes
  }
}

// The cache core: one vectors FILE → its entry array (or []), mtime-fresh.
const loadVectorsFile = file => {
  let stat
  try { stat = fs.statSync(file) } catch { return [] }

  const hit = cache.get(file)
  if (hit && hit.mtimeMs === stat.mtimeMs) {
    cache.delete(file)            // refresh LRU position
    cache.set(file, hit)
    return hit.pages
  }

  let pages
  try { pages = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return [] }
  if (!Array.isArray(pages)) return []

  if (hit) { cache.delete(file); cachedBytes -= hit.bytes }
  cachedBytes += stat.size
  cache.set(file, { mtimeMs: stat.mtimeMs, bytes: stat.size, pages })
  evictUntil(CACHE_BYTES)
  return pages
}

// Same contract as the old loadVectors(farm, domain) — farm or galaxy tree.
const loadVectorsCached = (farm, domain) =>
  loadVectorsFile(path.join(farm, domain, 'status', 'semantic-vectors.json'))

const loadGalaxyVectors = loadVectorsCached

const galaxyCacheStats = () => ({
  sites: cache.size,
  bytes: cachedBytes,
  capBytes: CACHE_BYTES,
})

module.exports = { galaxyRoot, loadGalaxyVectors, loadVectorsCached, loadVectorsFile, galaxyCacheStats }
