// The Rust core (similarity-core) as WebAssembly — the same code Sweet
// Server runs natively — answering this plugin's routes on node.
//
// Off unless WIKI_SIMILARITY_CORE=rust. When on, a middleware sits in front
// of the JavaScript routes and hands the core each request it can answer
// alone; anything else falls through to the JavaScript unchanged:
//
//   - peer-hello, peer-search, embed and build-index always stay in
//     JavaScript: the peer guard's replay and rate state must live in one
//     place, and the other two are the embedder's own work;
//   - a request that reaches for the network (peers asked by `farms` or
//     the cascade, the galaxy's remote indexes) falls through, because
//     WebAssembly here has no synchronous network;
//   - a query to embed comes back to JavaScript, which embeds it with the
//     plugin's embedder and calls the core again with the vector.
//
// Maths: V8's Math.log/log10/exp differ in the last bit between node
// builds, and the core reproduces them bit for bit. The module asks this
// node for a few telling values at load and picks its profile to match.

const fs = require('fs')
const path = require('path')

const WASM = path.join(__dirname, 'similarity-core.wasm')

// Routes the core answers here (see above for the ones it never takes).
const ROUTES = new Set([
  '/system/indexed-domains.json',
  '/system/semantic-vectors.json',
  '/system/similarity-health.json',
  '/system/galaxy-registry.json',
  '/system/galaxy-sites.json',
  '/system/title-twins.json',
  '/system/search-report.json',
  '/system/farm-search.json',
  '/system/galaxy-search.json',
  '/system/site-rank.json',
  '/system/site-report.json',
])

const wanted = () => (process.env.WIKI_SIMILARITY_CORE || 'js').trim().toLowerCase() === 'rust'

let core = null          // { call(handle, obj), open(obj), warm(handle), profile }
let loadError = null

const load = () => {
  if (core || loadError) return core
  try {
    const { WASI } = require('node:wasi')
    const wasi = new WASI({ version: 'preview1', env: process.env, preopens: { '/': '/' }, returnOnExit: true })
    const module = new WebAssembly.Module(fs.readFileSync(WASM))
    const instance = new WebAssembly.Instance(module, wasi.getImportObject())
    wasi.initialize(instance)
    const x = instance.exports
    const enc = new TextEncoder()
    const dec = new TextDecoder()
    const send = value => {
      const bytes = enc.encode(JSON.stringify(value))
      const ptr = x.sc_alloc(bytes.length)
      new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes)
      return [ptr, bytes.length]
    }
    const read = ptr => JSON.parse(dec.decode(new Uint8Array(x.memory.buffer, ptr, x.sc_result_len())))
    // this node's Math, on the inputs where the profiles differ
    const asks = read(x.sc_calibration_inputs())
    const profile = x.sc_calibrate(...send(asks.map(([f, v]) => [f, v, Math[f](v)])))
    core = {
      profile,
      open: config => x.sc_open(...send(config)),
      warm: handle => x.sc_warm(handle),
      call: (handle, request) => read(x.sc_call(handle, ...send(request))),
    }
    console.log(`[wiki-plugin-similarity] Rust core loaded (${(fs.statSync(WASM).size / 1e6).toFixed(1)} MB, maths profile ${profile})`)
  } catch (e) {
    loadError = e
    console.error('[wiki-plugin-similarity] Rust core unavailable, using JavaScript:', e.message)
  }
  return core
}

// WIKI_SIMILARITY_CORE_TRACE=1: one line per request, saying who answered
const trace = (req, who) => {
  if (process.env.WIKI_SIMILARITY_CORE_TRACE) console.log(`[similarity-core] ${req.method} ${req.originalUrl.slice(0, 80)} → ${who}`)
}

const handles = new Map()   // farmRoot → handle: one core state per farm

const readRaw = req => new Promise((resolve, reject) => {
  let data = ''
  req.setEncoding('utf8')
  req.on('data', chunk => { data += chunk })
  req.on('end', () => resolve(data))
  req.on('error', reject)
})

// Install the middleware on this site's app, ahead of the JavaScript
// routes. `ctx` carries what the JavaScript already works out per farm.
const mount = (app, { farmRoot, wikiDomains, version, localEmbedderAvailable,
  embedText, embedStatus, trustedSession, authorized, cors }) => {
  if (!wanted() || !load()) return false
  if (!handles.has(farmRoot)) {
    const handle = core.open({ farmRoot, wikiDomains: wikiDomains || null, version, localEmbedderAvailable })
    handles.set(farmRoot, handle)
    setImmediate(() => {
      const t = Date.now()
      core.warm(handle)
      console.log(`[wiki-plugin-similarity] Rust core warm: ${farmRoot} in ${Date.now() - t} ms`)
    })
  }
  const handle = handles.get(farmRoot)

  app.use(async (req, res, next) => {
    if (!ROUTES.has(req.path)) return next()
    const js = why => { trace(req, `javascript (${why})`); return next() }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') return next()
    try {
      let body = ''
      if (req.method === 'POST') {
        body = req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : await readRaw(req)
        // the stream is spent: leave the text where readBody finds it
        req.rawBodyText = body
      }
      const q = req.originalUrl.indexOf('?')
      const request = {
        method: req.method === 'HEAD' ? 'GET' : req.method,
        path: req.path,
        query: q < 0 ? '' : req.originalUrl.slice(q + 1),
        ifModifiedSince: req.headers['if-modified-since'] || null,
        body,
        caller: {
          remoteIp: (req.socket && req.socket.remoteAddress) || null,
          forwardedFor: req.headers['x-forwarded-for'] || null,
          origin: req.headers.origin || null,
          host: String(req.headers.host || ''),
          sessionTrusted: trustedSession(req),
          authorized: authorized(req),
        },
        embeds: {},
        embedStatus: req.path === '/system/similarity-health.json' ? embedStatus() : null,
      }
      for (let pass = 0; pass < 4; pass++) {
        const out = core.call(handle, request)
        if (out.fallthrough) return js('fell through')
        if (out.needEmbed !== undefined) {
          // the JavaScript route answers an embedder failure its own way
          try { request.embeds[out.needEmbed] = Array.from(await embedText(out.needEmbed)) }
          catch { return js('embedder failed') }
          continue
        }
        trace(req, `rust ${out.status}${pass ? ` after ${pass} embed` : ''}`)
        cors(res)
        res.status(out.status)
        for (const [k, v] of out.headers) res.set(k, v)
        return res.send(out.body)
      }
      return js('too many embeds')
    } catch (e) {
      console.error('[wiki-plugin-similarity] Rust core error, answering in JavaScript:', e.message)
      return next()
    }
  })
  return true
}

module.exports = { mount, wanted, ROUTES }
