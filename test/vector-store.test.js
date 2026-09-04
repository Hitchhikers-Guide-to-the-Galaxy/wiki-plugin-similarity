import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The store dir is resolved per call, so the env can be set after import.
const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-store-test-'))
process.env.WIKI_SIMILARITY_STORE = storeRoot

import store from '../server/vector-store.js'
import searchReport from '../server/search-report.js'
const { loadVectorsFile, loadEntry, buildEntry, storeStats, resetStore, warmUp } = store
const { dot, buildReport } = searchReport

const unit = (i, dim = 8) => { const v = new Array(dim).fill(0); v[i] = 1; return v }
const sleep = ms => new Promise(r => setTimeout(r, ms))

describe('vector store', () => {
  let root, file
  const domain = 'store.example'
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-farm-'))
    const status = path.join(root, domain, 'status')
    fs.mkdirSync(status, { recursive: true })
    file = path.join(status, 'semantic-vectors.json')
    fs.writeFileSync(file, JSON.stringify([
      { slug: 'alpha', title: 'Alpha', vector: unit(0), chars: 500, synopsis: 'A' },
      { slug: 'beta',  title: 'Beta',  vector: unit(1), chars: 500 },
      { slug: 'broken', title: 'Broken', vector: [1, 2, 3] },       // wrong length
      { slug: 'novector', title: 'No Vector' },
    ]))
  })
  after(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(storeRoot, { recursive: true, force: true })
  })

  it('holds one Float32 matrix and hands out views that still dot()', () => {
    resetStore()
    const pages = loadVectorsFile(file)
    assert.equal(pages.length, 2, 'malformed vectors are dropped')
    assert.ok(pages[0].vector instanceof Float32Array)
    assert.equal(dot(pages[0].vector, unit(0)), 1)
    assert.equal(dot(pages[1].vector, unit(0)), 0)
    assert.equal(pages[0].synopsis, 'A', 'enrichment fields survive')
    assert.equal('vector' in pages[0] && pages[0].chars === 500, true)
    const e = loadEntry(file)
    assert.equal(e.n, 2); assert.equal(e.dim, 8)
    assert.equal(e.matrix.length, 16)
    assert.equal(storeStats().parsed, 1)
  })

  it('serves the same array on a repeat load and counts heap bytes', () => {
    const a = loadVectorsFile(file)
    const b = loadVectorsFile(file)
    assert.equal(a, b)
    const s = storeStats()
    assert.equal(s.sites, 1)
    assert.ok(s.bytes > 2 * 8 * 4 && s.bytes < 4096, `heap bytes ${s.bytes}`)
    assert.equal(s.pages, 2)
  })

  it('restores from the disk cache instead of parsing JSON', async () => {
    await sleep(150)   // the store write is asynchronous
    const files = fs.readdirSync(storeRoot)
    assert.ok(files.some(f => f.endsWith('.f32')), `store files: ${files}`)
    assert.ok(files.some(f => f.endsWith('.json')))
    resetStore()
    const pages = loadVectorsFile(file)
    assert.equal(pages.length, 2)
    assert.equal(dot(pages[1].vector, unit(1)), 1)
    const s = storeStats()
    assert.equal(s.restored, 1)
    assert.equal(s.parsed, 0)
  })

  it('a changed file is re-parsed under a new key', async () => {
    await sleep(20)
    fs.writeFileSync(file, JSON.stringify([
      { slug: 'gamma', title: 'Gamma', vector: unit(2), chars: 500 },
    ]))
    const pages = loadVectorsFile(file)
    assert.equal(pages.length, 1)
    assert.equal(pages[0].slug, 'gamma')
    assert.equal(storeStats().parsed, 1)
  })

  it('warmUp walks a farm and reports state', async () => {
    resetStore()
    const w = await warmUp([[root, 'galaxy']])
    assert.equal(w.state, 'warm')
    assert.equal(w.total, 1); assert.equal(w.done, 1)
    assert.equal(storeStats().sites, 1)
  })

  it('buildEntry takes dim from the first well-formed vector', () => {
    const e = buildEntry([{ slug: 'x', title: 'X', vector: [0, 1] }, { slug: 'y', title: 'Y', vector: [1, 0, 0] }], 1)
    assert.equal(e.dim, 2); assert.equal(e.n, 1)
    assert.equal(buildEntry({ not: 'a list' }, 1), null)
  })

  it('buildReport runs unchanged over the store', async () => {
    const ctx = { farms: [[root, 'galaxy']], restricted: new Set(), embed: async () => unit(2) }
    const page = await buildReport('gamma', ['GALAXY'], 5, ctx)
    const refs = page.story.filter(i => i.type === 'reference')
    assert.equal(refs.length, 1)
    assert.equal(refs[0].slug, 'gamma')
  })
})
