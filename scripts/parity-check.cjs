// Parity check: JS embedder vs FastAPI /embed (fastembed reference).
// Usage: node scripts/parity-check.cjs [pooling]
// Requires the FastAPI service on 127.0.0.1:4244.

const http = require('node:http')

process.env.WIKI_EMBED_POOLING = process.argv[2] || process.env.WIKI_EMBED_POOLING || 'cls'
const { embed } = require('../server/embedder')

const SAMPLES = [
  'gltf scene',
  'federated wiki plugin development',
  'The Buildless Movement refers to shipping web sites with no build step.',
  'semantic similarity search across wiki domains',
  'Hitchhikers Guide to the Galaxy',
  'design tokens and cascade layers',
  'a raspberry pi that indexes a wiki farm',
  'quine: a program that reproduces its own source',
  'live television production with cables.gl',
  'How do I restart the wiki server?',
]

const pyEmbed = text => new Promise((resolve, reject) => {
  const payload = JSON.stringify({ text })
  const req = http.request({
    hostname: '127.0.0.1', port: 4244, path: '/embed', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  }, res => {
    let data = ''
    res.on('data', c => (data += c))
    res.on('end', () => resolve(JSON.parse(data).vector))
  })
  req.on('error', reject)
  req.end(payload)
})

const cosine = (a, b) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s // both unit-normalised
}

;(async () => {
  console.log(`pooling=${process.env.WIKI_EMBED_POOLING} quantized=${process.env.WIKI_EMBED_QUANTIZED === '1'}`)
  let worst = 1
  for (const text of SAMPLES) {
    const [js, py] = await Promise.all([embed(text), pyEmbed(text)])
    if (js.length !== py.length) throw new Error(`dim mismatch ${js.length} vs ${py.length}`)
    const c = cosine(js, py)
    worst = Math.min(worst, c)
    console.log(`${c.toFixed(6)}  ${text.slice(0, 50)}`)
  }
  console.log(`\nworst cosine: ${worst.toFixed(6)}  ${worst >= 0.999 ? 'PASS' : 'FAIL'}`)
  process.exit(worst >= 0.999 ? 0 : 1)
})().catch(e => { console.error('parity check error:', e.message); process.exit(2) })
