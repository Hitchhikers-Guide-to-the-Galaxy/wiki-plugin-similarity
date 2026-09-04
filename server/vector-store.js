// wiki-plugin-similarity — the vector store (CommonJS)
//
// One place that turns a semantic-vectors.json file into something a query
// can scan in milliseconds, and keeps it there.
//
//   {farm}/{domain}/status/semantic-vectors.json
//     [{slug, title, vector[384], ...enrichment}]        ← the interchange
//
// The interchange is JSON with 384 double-precision numbers per page — 8.6 KB
// a page on disk, 872 MB for the ~100k pages of the galaxy tree. Parsed as
// JavaScript arrays that is several GB of heap, so the old byte-capped cache
// (counted in FILE bytes) could never hold a federation scope: every query
// re-parsed half the tree on the event loop — 46 s per query on the Pi5, and
// concurrent page saves 502'd behind it (Search Tool Plan, Phase 5).
//
// Here each file becomes ONE Float32Array matrix (n × dim, 1.5 KB a page) plus
// a light page list whose `vector` fields are subarray views into it, so every
// existing consumer (`page.vector`, dot()) keeps working unchanged while the
// whole galaxy fits in ~150 MB. The cache is capped in HEAP bytes, not file
// bytes, so the cap means what it says.
//
// The first parse of a file is still the expensive step, so its result is
// written to a plugin-owned disk cache (a raw .f32 beside a .json of the
// non-vector fields) and restarts read that instead — a 176 MB JSON becomes a
// 30 MB read into a typed array. Nothing is ever written into a farm or
// galaxy tree: one writer per tree (Semantic ReIndex Plan).
//
// warmUp() walks the trees at startup with setImmediate between files, so the
// first query is never the cold one.

const fs     = require('node:fs')
const path   = require('node:path')
const crypto = require('node:crypto')

const CACHE_BYTES = parseInt(process.env.WIKI_GALAXY_VECTOR_CACHE_MB || '512', 10) * 1024 * 1024
const PAGE_OVERHEAD = 160   // rough heap cost of one page object + its view

// Plugin-owned disk cache for parsed matrices. A function, not a constant,
// so tests can point it at a temp dir after import.
const storeDir = () => process.env.WIKI_SIMILARITY_STORE ||
  path.join(process.env.HOME || '/tmp', '.cache', 'wiki-similarity', 'store')

// ── The in-memory cache: file path → entry, LRU by insertion order ──────────
// Keyed by path, not domain, so the same domain name in different trees can
// never collide. An entry:
//   {mtimeMs, bytes, n, dim, matrix: Float32Array, pages: [{slug, title,
//    vector: Float32Array(view), ...enrichment}]}

const cache = new Map()
let cachedBytes = 0

const evictUntil = budget => {
  for (const [file, entry] of cache) {
    if (cachedBytes <= budget) break
    cache.delete(file)
    cachedBytes -= entry.bytes
  }
}

const heapBytes = (n, dim, pages) => {
  let b = n * dim * 4
  for (const p of pages) {
    b += PAGE_OVERHEAD + 2 * ((p.slug || '').length + (p.title || '').length +
      (p.synopsis ? p.synopsis.length : 0))
  }
  return b
}

// ── Building an entry from the JSON interchange ─────────────────────────────
// Pages whose vector is missing or of the wrong length are dropped rather
// than poisoning the matrix; dim is taken from the first well-formed vector.

const buildEntry = (raw, mtimeMs) => {
  if (!Array.isArray(raw)) return null
  let dim = 0
  for (const p of raw) {
    if (p && Array.isArray(p.vector) && p.vector.length) { dim = p.vector.length; break }
  }
  const good = raw.filter(p => p && typeof p.slug === 'string' &&
    Array.isArray(p.vector) && p.vector.length === dim)
  const n = good.length
  const matrix = new Float32Array(n * dim)
  const pages = new Array(n)
  for (let i = 0; i < n; i++) {
    const { vector, ...rest } = good[i]
    matrix.set(vector, i * dim)
    pages[i] = { ...rest, vector: matrix.subarray(i * dim, (i + 1) * dim) }
  }
  return { mtimeMs, n, dim, matrix, pages, bytes: heapBytes(n, dim, pages) }
}

// Same shape from the disk cache: the .f32 is the matrix, the .json the rest.
const entryFromStore = (f32File, metaFile, mtimeMs) => {
  let meta, buf
  try {
    meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
    buf = fs.readFileSync(f32File)
  } catch { return null }
  const { n, dim, pages: rest } = meta
  if (!Number.isInteger(n) || !Number.isInteger(dim) || !Array.isArray(rest) ||
      rest.length !== n || buf.length !== n * dim * 4) return null
  // Copy out of the Buffer pool so the matrix owns aligned memory of its own.
  const matrix = new Float32Array(n * dim)
  matrix.set(new Float32Array(buf.buffer, buf.byteOffset, n * dim))
  const pages = rest.map((p, i) =>
    ({ ...p, vector: matrix.subarray(i * dim, (i + 1) * dim) }))
  return { mtimeMs, n, dim, matrix, pages, bytes: heapBytes(n, dim, pages) }
}

// ── Disk cache naming: path hash + mtime + size — a changed file is a new key
const storeKey = (file, stat) =>
  crypto.createHash('sha1').update(file).digest('hex').slice(0, 16) +
  `-${Math.round(stat.mtimeMs)}-${stat.size}`

const storePaths = (file, stat) => {
  const base = path.join(storeDir(), storeKey(file, stat))
  return { f32: base + '.f32', meta: base + '.json' }
}

// Written asynchronously through a temp name so a crash never leaves a
// half-file the next start could read. Failure to write is not an error —
// the disk cache is an accelerator, not the store.
const writeStore = (file, stat, entry) => {
  const { f32, meta } = storePaths(file, stat)
  const dir = storeDir()
  fs.mkdir(dir, { recursive: true }, err => {
    if (err) return
    const tmp = f32 + '.tmp'
    const rest = entry.pages.map(({ vector, ...p }) => p)
    fs.writeFile(tmp, Buffer.from(entry.matrix.buffer, entry.matrix.byteOffset,
      entry.matrix.byteLength), err2 => {
      if (err2) return
      fs.writeFile(meta + '.tmp', JSON.stringify({ n: entry.n, dim: entry.dim, pages: rest }),
        err3 => {
          if (err3) return
          fs.rename(meta + '.tmp', meta, () => fs.rename(tmp, f32, () => {}))
        })
    })
  })
}

// ── The cache core: one vectors FILE → its entry, mtime-fresh ───────────────

let stats = { parsed: 0, restored: 0, parseMs: 0 }

const loadEntry = file => {
  let stat
  try { stat = fs.statSync(file) } catch { return null }

  const hit = cache.get(file)
  if (hit && hit.mtimeMs === stat.mtimeMs) {
    cache.delete(file)            // refresh LRU position
    cache.set(file, hit)
    return hit
  }

  const t0 = Date.now()
  const { f32, meta } = storePaths(file, stat)
  let entry = fs.existsSync(f32) && fs.existsSync(meta)
    ? entryFromStore(f32, meta, stat.mtimeMs) : null
  if (entry) stats.restored += 1
  else {
    let raw
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
    entry = buildEntry(raw, stat.mtimeMs)
    if (!entry) return null
    stats.parsed += 1
    writeStore(file, stat, entry)
  }
  stats.parseMs += Date.now() - t0

  if (hit) { cache.delete(file); cachedBytes -= hit.bytes }
  cachedBytes += entry.bytes
  cache.set(file, entry)
  evictUntil(CACHE_BYTES)
  return entry
}

// A site's centroid: the mean of its unit page vectors, re-normalised —
// the site summary the Site Index carries for off-farm sites, computed here
// for the sites this farm holds itself. Cached on the entry.
const siteCentroid = file => {
  const e = loadEntry(file)
  if (!e || !e.n) return null
  if (e.centroid) return e.centroid
  const { n, dim, matrix } = e
  const sum = new Float64Array(dim)
  for (let i = 0; i < n; i++) {
    const row = matrix.subarray(i * dim, (i + 1) * dim)
    let norm = 0
    for (let j = 0; j < dim; j++) norm += row[j] * row[j]
    norm = Math.sqrt(norm) || 1
    for (let j = 0; j < dim; j++) sum[j] += row[j] / norm
  }
  let norm = 0
  for (let j = 0; j < dim; j++) norm += sum[j] * sum[j]
  norm = Math.sqrt(norm) || 1
  e.centroid = Float32Array.from(sum, x => x / norm)
  return e.centroid
}

// The compatibility surface — an array of pages, each with a `.vector` view.
const loadVectorsFile = file => {
  const entry = loadEntry(file)
  return entry ? entry.pages : []
}

const loadVectorsCached = (farm, domain) =>
  loadVectorsFile(path.join(farm, domain, 'status', 'semantic-vectors.json'))

// ── Warm-up: pay the parse once, at startup, off the request path ───────────
// farms: [[root, kind], ...]. Yields to the event loop between files, stops
// early if the cap is reached (the health route then says so).

let warm = { state: 'idle', done: 0, total: 0, ms: 0, startedAt: null, capped: false }

const vectorFiles = farms => {
  const files = []
  for (const [farm] of farms) {
    let entries
    try { entries = fs.readdirSync(farm, { withFileTypes: true }) } catch { continue }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const f = path.join(farm, ent.name, 'status', 'semantic-vectors.json')
      try { fs.accessSync(f, fs.constants.F_OK); files.push(f) } catch { /* unindexed */ }
    }
  }
  return files
}

const warmUp = async farms => {
  // Once per process: wiki-server calls startServer for every site of a farm.
  if (warm.state !== 'idle') return warm
  const files = vectorFiles(farms)
  warm = { state: 'warming', done: 0, total: files.length, ms: 0,
           startedAt: Date.now(), capped: false }
  for (const f of files) {
    if (cachedBytes > CACHE_BYTES * 0.95) { warm.capped = true; break }
    loadEntry(f)
    warm.done += 1
    warm.ms = Date.now() - warm.startedAt
    await new Promise(r => setImmediate(r))
  }
  warm.state = 'warm'
  warm.ms = Date.now() - warm.startedAt
  return warm
}

const storeStats = () => ({
  sites: cache.size,
  bytes: cachedBytes,
  capBytes: CACHE_BYTES,
  pages: [...cache.values()].reduce((n, e) => n + e.n, 0),
  parsed: stats.parsed,
  restored: stats.restored,
  parseMs: stats.parseMs,
  warm,
})

// For tests and for a future in-process reindex: forget everything.
const resetStore = () => {
  cache.clear(); cachedBytes = 0
  stats = { parsed: 0, restored: 0, parseMs: 0 }
  warm = { state: 'idle', done: 0, total: 0, ms: 0, startedAt: null, capped: false }
}

module.exports = {
  loadEntry, loadVectorsFile, loadVectorsCached, siteCentroid, warmUp, storeStats,
  resetStore, buildEntry, storeDir, CACHE_BYTES,
}
