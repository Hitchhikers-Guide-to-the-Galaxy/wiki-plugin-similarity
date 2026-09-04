// wiki-plugin-similarity — galaxy vector access (CommonJS)
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
// Since 0.18.0 the loading and caching live in vector-store.js (one typed
// matrix per file, heap-capped, disk-cached, warmed at startup); this module
// keeps the galaxy root rule and the names every caller already uses.

const fs   = require('node:fs')
const path = require('node:path')

const store = require('./vector-store')

// Galaxy root: env override ('off' means none), else the Pi5 tree, else the
// Mac staging tree. Returns null when the galaxy is switched off — the Pi5's
// private farm sets that so it does not hold a second copy of the store.
const galaxyRoot = () => {
  const env = process.env.WIKI_GALAXY_VECTORS
  if (env) return /^(off|none|0|false)$/i.test(env) ? null : env
  const pi5 = '/mnt/wikimedia/galaxy'
  try { fs.accessSync(pi5, fs.constants.F_OK); return pi5 } catch { /* not the Pi5 */ }
  return path.join(process.env.HOME || '/tmp', '.cache', 'wiki-similarity', 'galaxy-vectors')
}

const { loadVectorsFile, loadVectorsCached } = store
const loadGalaxyVectors = loadVectorsCached
const galaxyCacheStats = store.storeStats

module.exports = { galaxyRoot, loadGalaxyVectors, loadVectorsCached, loadVectorsFile, galaxyCacheStats }
