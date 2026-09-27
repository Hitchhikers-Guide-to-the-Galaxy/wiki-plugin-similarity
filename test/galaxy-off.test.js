// A host with the galaxy switched off (WIKI_GALAXY_VECTORS=off) has no
// galaxy tree, so galaxyRoot() is null. The Pi5's private farm runs that way
// by design. GET /system/galaxy-registry.json used to path.join(null, ...)
// and throw before its 404 branch, so Express answered 500 with an HTML
// TypeError page. These tests pin the 404 JSON a missing registry file gets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Before the require: server.js reads some of these at load time.
process.env.WIKI_GALAXY_VECTORS = 'off'
process.env.WIKI_VERDICTS = 'off'
process.env.WIKI_EMBED_URL = 'http://127.0.0.1:9/system/embed.json'   // no model warm-up

const require = createRequire(import.meta.url)
const { startServer } = require('../server/server.js')

// Just enough of Express to register routes and call one.
const fakeApp = () => {
  const routes = {}
  const add = verb => (p, h) => { routes[`${verb} ${p}`] = h }
  return { routes, get: add('GET'), post: add('POST'), options: add('OPTIONS'), use: () => {} }
}
const call = (handler, req = {}) => new Promise((resolve, reject) => {
  const res = {
    statusCode: 200, headers: {},
    setHeader (k, v) { this.headers[k.toLowerCase()] = v; return this },
    header (k, v) { return this.setHeader(k, v) },
    status (c) { this.statusCode = c; return this },
    type (t) { this.headers['content-type'] = t; return this },
    json (body) { resolve({ status: this.statusCode, body }) },
    send (body) { resolve({ status: this.statusCode, body }) },
    end () { resolve({ status: this.statusCode }) },
  }
  try { handler({ headers: {}, query: {}, hostname: 'localhost', ...req }, res) } catch (e) { reject(e) }
})

const farm = fs.mkdtempSync(path.join(os.tmpdir(), 'similarity-galaxy-off-'))
const app = fakeApp()
startServer({ argv: { status: path.join(farm, 'localhost', 'status') }, app })

test('galaxy-registry answers 404 JSON when the galaxy is off', async () => {
  const r = await call(app.routes['GET /system/galaxy-registry.json'])
  assert.equal(r.status, 404)
  assert.deepEqual(r.body, { error: 'no galaxy registry on this host' })
})
