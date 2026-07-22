// wiki-plugin-similarity — embedding child process (CommonJS)
//
// ALL onnx/transformers work happens here, in a process fork()ed by
// embedder.js — never in the wiki-server process. A fatal error in the WASM
// runtime (abort, OOM, bad model file) kills this child only; the parent
// sees an exit event, fails the in-flight requests cleanly, and the farm
// keeps serving pages. That isolation is the plugin's safety contract:
// worst case is "semantic search unavailable", never a dead wiki.
//
// IPC protocol (parent → child, child → parent):
//   {id, op: 'embed', text}  →  {id, ok: true, vector: number[384]}
//   {id, op: 'warm'}         →  {id, ok: true}
//   any failure              →  {id, ok: false, error}
//
// The child exits 0 after WIKI_EMBED_IDLE_MS without work (default 5 min)
// so the ~0.5GB model doesn't stay pinned between searches; the parent
// respawns on demand and doesn't count a clean exit as a crash.
//
// WIKI_EMBED_MOCK=1 skips the model entirely and returns deterministic
// vectors — for tests and CI, where a text of '__CRASH__' also simulates a
// hard crash so the parent's isolation and breaker can be exercised.

const MODEL     = process.env.WIKI_EMBED_MODEL || 'Xenova/bge-small-en-v1.5'
const POOLING   = process.env.WIKI_EMBED_POOLING || 'cls'
const QUANTIZED = process.env.WIKI_EMBED_QUANTIZED === '1'
const IDLE_MS   = parseInt(process.env.WIKI_EMBED_IDLE_MS) || 5 * 60_000
const MOCK      = process.env.WIKI_EMBED_MOCK === '1'

// transformers.js statically imports onnxruntime-node, whose native binary
// needs glibc. On musl containers (node:alpine — the public farm) that import
// throws "Error loading shared library ld-linux-x86-64.so.2". Probe the
// native runtime with a CJS require first; if it can't load, register a
// module hook (Node >= 18.19) that redirects the onnxruntime-node import to
// onnxruntime-web — the WASM backend runs everywhere and benchmarks ~25ms a
// query. WIKI_EMBED_FORCE_WASM=1 forces the WASM path for testing.

const nativeOrtLoads = () => {
  if (process.env.WIKI_EMBED_FORCE_WASM === '1') return false
  try { require('onnxruntime-node'); return true } catch { return false }
}

let extractorPromise = null

const getExtractor = () => {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      if (!nativeOrtLoads()) {
        const { register } = require('node:module')
        if (typeof register !== 'function') {
          throw new Error('native onnxruntime unavailable and Node lacks ' +
            'module.register (need >= 18.19) for the WASM fallback')
        }
        register('./ort-hooks.mjs', require('node:url').pathToFileURL(__filename))
        console.log('[wiki-plugin-similarity] embed child: native onnxruntime unavailable — using WASM backend')
      }
      // Dynamic import: @xenova/transformers is ESM-only; this file must stay CJS.
      // The heavy deps are optionalDependencies — absent on slim installs,
      // where semindex delegation or WIKI_EMBED_URL is the path.
      const { pipeline, env } = await import('@xenova/transformers').catch(() => {
        throw new Error('no local embedder: @xenova/transformers is not installed. ' +
          'Install wiki-plugin-semindex, set WIKI_EMBED_URL, or reinstall ' +
          'wiki-plugin-similarity with optional dependencies.')
      })
      if (process.env.WIKI_MODEL_CACHE) env.cacheDir = process.env.WIKI_MODEL_CACHE
      if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1
      return pipeline('feature-extraction', MODEL, { quantized: QUANTIZED })
    })()
    extractorPromise.catch(() => { extractorPromise = null }) // allow retry
  }
  return extractorPromise
}

// Deterministic unit vector from text — mock mode only.
const mockVector = text => {
  const crypto = require('node:crypto')
  const v = []
  let seed = crypto.createHash('sha256').update(text).digest()
  while (v.length < 384) {
    for (const byte of seed) v.push((byte - 127.5) / 127.5)
    seed = crypto.createHash('sha256').update(seed).digest()
  }
  const vec = v.slice(0, 384)
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0))
  return vec.map(x => x / norm)
}

const embed = async text => {
  if (MOCK) {
    if (text === '__CRASH__') process.exit(13) // simulated hard crash (tests)
    return mockVector(text)
  }
  const extractor = await getExtractor()
  const out = await extractor(text, { pooling: POOLING, normalize: true })
  return Array.from(out.data)
}

let idleTimer = null
const bumpIdle = () => {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => process.exit(0), IDLE_MS)
}

process.on('message', async msg => {
  bumpIdle()
  try {
    if (msg.op === 'warm') {
      if (!MOCK) await getExtractor()
      process.send({ id: msg.id, ok: true })
    } else {
      process.send({ id: msg.id, ok: true, vector: await embed(msg.text) })
    }
  } catch (e) {
    try { process.send({ id: msg.id, ok: false, error: e.message }) } catch { /* parent gone */ }
  }
})

// Parent died or closed the channel — no reason to linger.
process.on('disconnect', () => process.exit(0))

bumpIdle()
