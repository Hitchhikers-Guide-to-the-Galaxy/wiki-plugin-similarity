// wiki-plugin-similarity — in-process query embedder (CommonJS)
//
// Reproduces the farm indexer's embeddings (fastembed, BAAI/bge-small-en-v1.5,
// 384-dim, L2-normalised, NO query prefix) using transformers.js — pure
// JS/WASM ONNX, no native dependencies, so it runs inside any wiki-server
// install including the public farm's container.
//
// Parity notes (verified against the FastAPI /embed reference):
//   - pooling and quantisation are configurable via env because they are the
//     two knobs that can desync scores from the prebuilt semantic-vectors.json:
//       WIKI_EMBED_POOLING   cls | mean   (default cls — BGE models use CLS)
//       WIKI_EMBED_QUANTIZED 1 | 0        (default 0 — fp32 matches fastembed)
//   - never add an instruction prefix: the index was built with plain .embed().
//
// Model files download on first use (~130MB fp32) into WIKI_MODEL_CACHE if set,
// else transformers.js's default cache. Subsequent runs are offline.

const MODEL     = process.env.WIKI_EMBED_MODEL || 'Xenova/bge-small-en-v1.5'
const POOLING   = process.env.WIKI_EMBED_POOLING || 'cls'
const QUANTIZED = process.env.WIKI_EMBED_QUANTIZED === '1'

// Prefer wiki-plugin-semindex's shared worker-thread embedder when installed:
// one model instance per process (shared with bulk indexing), inference off
// the event loop, and similarity's own heavy deps become optional. The
// sibling path works for npm installs (wiki/node_modules/*) and dev symlinks
// (~/Code/wiki-plugins/*) alike; the bare require covers other layouts.
const semindexLib = (() => {
  const path = require('node:path')
  const fs   = require('node:fs')
  try {
    const sibling = path.resolve(__dirname, '../../wiki-plugin-semindex/server/embed-lib.js')
    if (fs.existsSync(sibling)) return require(sibling)
    return require('wiki-plugin-semindex/server/embed-lib.js')
  } catch { return null }
})()

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
        console.log('[wiki-plugin-similarity] native onnxruntime unavailable — using WASM backend')
      }
      // Dynamic import: @xenova/transformers is ESM-only; this file must stay CJS.
      // Since 0.8.0 the heavy deps are optionalDependencies — absent on slim
      // installs, where semindex delegation or WIKI_EMBED_URL is the path.
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

// Embed one text → plain number[384], unit-normalised.
const embed = async text => {
  if (semindexLib) return semindexLib.embed(text)
  const extractor = await getExtractor()
  const out = await extractor(text, { pooling: POOLING, normalize: true })
  return Array.from(out.data)
}

// Warm the model in the background (call at startup; failures just defer to
// first request). With semindex delegation, don't warm — its worker spawns on
// demand and self-terminates when idle; pre-warming would just pin ~0.5GB.
const warm = () => { if (!semindexLib) getExtractor().catch(() => {}) }

module.exports = { embed, warm, viaSemindex: !!semindexLib }
