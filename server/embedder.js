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

let extractorPromise = null

const getExtractor = () => {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      // Dynamic import: @xenova/transformers is ESM-only; this file must stay CJS.
      const { pipeline, env } = await import('@xenova/transformers')
      if (process.env.WIKI_MODEL_CACHE) env.cacheDir = process.env.WIKI_MODEL_CACHE
      return pipeline('feature-extraction', MODEL, { quantized: QUANTIZED })
    })()
    extractorPromise.catch(() => { extractorPromise = null }) // allow retry
  }
  return extractorPromise
}

// Embed one text → plain number[384], unit-normalised.
const embed = async text => {
  const extractor = await getExtractor()
  const out = await extractor(text, { pooling: POOLING, normalize: true })
  return Array.from(out.data)
}

// Warm the model in the background (call at startup; failures just defer to
// first request).
const warm = () => { getExtractor().catch(() => {}) }

module.exports = { embed, warm }
