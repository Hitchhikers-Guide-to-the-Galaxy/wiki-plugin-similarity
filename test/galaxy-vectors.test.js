import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Server modules are CJS (see server/package.json); Node imports them fine.
import farmLib from '../server/farm-lib.js'
import galaxyVectors from '../server/galaxy-vectors.js'
import searchReport from '../server/search-report.js'

const { matchesAny, listDomains } = farmLib
const { loadGalaxyVectors, galaxyCacheStats } = galaxyVectors
const { buildReport } = searchReport

// ── Scope semantics: galaxy sites join only by explicit opt-in ───────────────

describe('GALAXY scope keyword', () => {
  const none = new Set()
  it('* never matches galaxy domains', () => {
    assert.equal(matchesAny('ward.dojo.fed.wiki', 'galaxy', ['*'], none), false)
    assert.equal(matchesAny('anarchive.earth', 'public', ['*'], none), true)
    assert.equal(matchesAny('plan.localhost', 'local', ['*'], none), true)
  })
  it('GALAXY matches only galaxy domains', () => {
    assert.equal(matchesAny('ward.dojo.fed.wiki', 'galaxy', ['GALAXY'], none), true)
    assert.equal(matchesAny('anarchive.earth', 'public', ['GALAXY'], none), false)
  })
  it('explicit domains and globs still reach galaxy sites (roster resolution)', () => {
    assert.equal(matchesAny('ward.dojo.fed.wiki', 'galaxy', ['ward.dojo.fed.wiki'], none), true)
    assert.equal(matchesAny('ward.dojo.fed.wiki', 'galaxy', ['*.fed.wiki'], none), true)
  })
})

// ── Galaxy vector store + pre-enriched report pipeline ───────────────────────

describe('galaxy tree end-to-end', () => {
  let root
  const domain = 'example.fed.wiki'
  const unit = new Array(384).fill(0)
  unit[0] = 1
  const entry = (slug, title, chars, extra = {}) => ({
    slug, title, vector: unit, chars, items: 3,
    date: Date.now() - 86_400_000, synopsis: `About ${title}`, ...extra,
  })

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'galaxy-test-'))
    const status = path.join(root, domain, 'status')
    fs.mkdirSync(status, { recursive: true })
    fs.writeFileSync(path.join(status, 'semantic-vectors.json'), JSON.stringify([
      entry('rich-page', 'Rich Page', 4000),
      entry('stub-page', 'Stub Page', 40),
    ]))
  })
  after(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it('listDomains sees a farm-shaped galaxy tree', () => {
    const domains = listDomains([[root, 'galaxy']], ['GALAXY'], new Set(),
      'status/semantic-vectors.json')
    assert.deepEqual(domains.map(d => d.domain), [domain])
    assert.equal(domains[0].kind, 'galaxy')
  })

  it('loadGalaxyVectors caches by mtime', () => {
    const first = loadGalaxyVectors(root, domain)
    assert.equal(first.length, 2)
    assert.ok(galaxyCacheStats().sites >= 1)
    const again = loadGalaxyVectors(root, domain)
    assert.equal(again, first) // same object → served from cache
  })

  it('buildReport ranks pre-enriched galaxy pages and drops stubs', async () => {
    const ctx = {
      farms: [[root, 'galaxy']],
      restricted: new Set(),
      embed: async () => unit,
    }
    const page = await buildReport('rich page', ['GALAXY'], 5, ctx)
    const refs = page.story.filter(i => i.type === 'reference')
    assert.equal(refs.length, 1) // stub-page dropped by STUB_CHARS
    assert.equal(refs[0].site, domain)
    assert.equal(refs[0].slug, 'rich-page')
    assert.equal(refs[0].text, 'About Rich Page') // stored synopsis carried through

    // '*' scans zero galaxy pages
    const star = await buildReport('rich page', ['*'], 5, ctx)
    assert.match(star.story[0].text, /scanned 0 pages/)
  })
})
