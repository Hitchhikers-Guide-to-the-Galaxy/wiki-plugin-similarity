// WIKI_SIMILARITY_CORE=rust: the Rust core (server/similarity-core.wasm)
// answers the routes it can, and answers them as the JavaScript does. One
// small farm, served twice in one process — once by the JavaScript routes,
// once with the core's middleware in front — and each answer compared.
// Skipped when the .wasm has not been built (scripts/build-wasm.sh).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const WASM = path.join(import.meta.dirname, '../server/similarity-core.wasm')
const built = fs.existsSync(WASM)

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'similarity-rust-core-'))
Object.assign(process.env, {
  HOME: home, WIKI_EMBED_MOCK: '1', WIKI_EMBED_NO_SEMINDEX: '1', WIKI_VERDICTS: 'off',
  WIKI_GALAXY_VECTORS: 'off', WIKI_SIMILARITY_STORE: path.join(home, 'store'),
  WIKI_EMBED_IDLE_MS: '1000',   // the mock embed child exits, and so can the test
})
delete process.env.WIKI_EMBED_URL
delete process.env.WIKI_EXTRA_FARMS

// A farm of two sites; each page's vector is fixed and unit length.
const farm = path.join(home, 'farm')
const DIM = 384
const vec = seed => {
  const v = Array.from({ length: DIM }, (_, i) => Math.sin(seed * 7.3 + i * 0.37))
  const n = Math.hypot(...v)
  return v.map(x => x / n)
}
const SITES = {
  'alpha.example': ['Cosine Similarity', 'Vector Search', 'Welcome Visitors'],
  'beta.example': ['Keyword Search', 'Cosine Similarity', 'Welcome Visitors'],
}
const slug = t => t.toLowerCase().replace(/\s/g, '-')
let seed = 1
for (const [site, titles] of Object.entries(SITES)) {
  const status = path.join(farm, site, 'status')
  const pages = path.join(farm, site, 'pages')
  fs.mkdirSync(status, { recursive: true })
  fs.mkdirSync(pages, { recursive: true })
  const vectors = titles.map(title => ({ slug: slug(title), title, vector: vec(seed++) }))
  fs.writeFileSync(path.join(status, 'semantic-vectors.json'), JSON.stringify(vectors))
  for (const title of titles) {
    fs.writeFileSync(path.join(pages, slug(title)), JSON.stringify({
      title,
      story: [{ type: 'paragraph', id: 'a1', text: `${title} on ${site}: a page about search and vectors.` }],
      journal: [{ type: 'create', date: 1700000000000, item: { title } }],
    }))
  }
}

// Just enough of Express: middleware in order, then the route.
const fakeApp = () => {
  const stack = []
  const routes = {}
  const add = verb => (p, h) => { routes[`${verb} ${p}`] = h }
  const app = { routes, get: add('GET'), post: add('POST'), options: add('OPTIONS'), use: h => stack.push(h) }
  app.handle = (method, url, body) => new Promise((resolve, reject) => {
    const [p, q = ''] = url.split('?')
    const req = {
      method, path: p, originalUrl: url, hostname: 'alpha.example',
      query: Object.fromEntries(new URLSearchParams(q)),
      headers: { host: 'alpha.example' }, socket: { remoteAddress: '127.0.0.1' },
      body, handledBy: 'rust',
    }
    const headers = {}
    const res = {
      statusCode: 200,
      setHeader (k, v) { headers[k.toLowerCase()] = v; return this },
      set (k, v) { return this.setHeader(k, v) },
      header (k, v) { return this.setHeader(k, v) },
      status (c) { this.statusCode = c; return this },
      type (t) { headers['content-type'] = t; return this },
      json (b) { resolve({ by: req.handledBy, status: this.statusCode, body: b }) },
      send (b) { resolve({ by: req.handledBy, status: this.statusCode, body: typeof b === 'string' ? JSON.parse(b) : b }) },
      sendStatus (c) { resolve({ by: req.handledBy, status: c }) },
      end () { resolve({ by: req.handledBy, status: this.statusCode }) },
    }
    let i = 0
    const next = () => {
      const h = stack[i++]
      if (h) return h(req, res, next)
      req.handledBy = 'javascript'
      const route = routes[`${method} ${p}`]
      if (!route) return reject(new Error(`no route ${method} ${p}`))
      route(req, res)
    }
    Promise.resolve().then(next).catch(reject)
  })
  return app
}

const { startServer } = require('../server/server.js')
const argv = { status: path.join(farm, 'alpha.example', 'status') }
let js, rust
before(async () => {
  process.env.WIKI_SIMILARITY_CORE = 'js'
  js = fakeApp(); startServer({ argv, app: js })
  process.env.WIKI_SIMILARITY_CORE = 'rust'
  rust = fakeApp(); startServer({ argv, app: rust })
  await new Promise(r => setTimeout(r, 300))   // both stores warm
})

// Scores carry an age term read from the clock; the two calls are
// milliseconds apart, so compare them to three places. Story item ids are
// random in both.
const round = v => typeof v === 'number' ? Math.round(v * 1000) / 1000
  : Array.isArray(v) ? v.map(round)
  : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'id' || k === 'date' ? typeof x : round(x)]))
    : v

const CASES = [
  ['GET', '/system/indexed-domains.json'],
  ['GET', '/system/semantic-vectors.json?domain=beta.example'],
  ['GET', '/system/title-twins.json?slug=cosine-similarity'],
  ['GET', '/system/galaxy-sites.json'],
  ['GET', '/system/farm-search.json?q=cosine&format=flat'],
  ['GET', '/system/farm-search.json?q=vector'],
  ['POST', '/system/search-report.json', { query: 'cosine similarity', flat: true }],
  ['POST', '/system/search-report.json', { query: 'vector search', limit: 3 }],
  ['POST', '/system/search-report.json', {}],
]

for (const [method, url, body] of CASES) {
  test(`${method} ${url}${body ? ' ' + JSON.stringify(body) : ''}`, { skip: !built && 'no .wasm built' }, async () => {
    const a = await js.handle(method, url, body)
    const b = await rust.handle(method, url, body)
    assert.equal(a.by, 'javascript')
    assert.equal(b.by, 'rust', 'the Rust core answered, not the JavaScript behind it')
    assert.equal(b.status, a.status)
    assert.deepEqual(round(b.body), round(a.body))
  })
}

test('a request that asks peers falls through to the JavaScript', { skip: !built && 'no .wasm built' }, async () => {
  const b = await rust.handle('GET', '/system/farm-search.json?q=vector&farms=localhost:1')
  assert.equal(b.by, 'javascript')
})
