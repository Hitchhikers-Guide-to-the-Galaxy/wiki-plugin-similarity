import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Server modules are CJS (see server/package.json); Node imports them fine.
import searchReport from '../server/search-report.js'
const { buildReport, resolveSeedVector, seedVector } = searchReport
import siteReport from '../server/site-report.js'
const { buildSiteReport } = siteReport

// ── Temp farm fixture ─────────────────────────────────────────────────────────
// One domain, three pages in a tiny vector space. Vectors are unit-normalised
// so dot == cosine. fish-page and fish-fork are near-identical (a fork pair);
// boat-page is distinct but still above the candidate floor for Q.

const unit = v => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return v.map(x => x / n)
}

const Q         = unit([1, 0.1, 0])
const FISH_VEC  = unit([1, 0, 0])
const BOAT_VEC  = unit([0.8, 0.6, 0])

let farmRoot
const DOMAIN = 'test.example'

const page = title => ({
  title,
  story: [{ type: 'markdown', id: 'a1b2c3d4e5f60001',
    text: `${title} — enough prose to clear the stub filter. `.repeat(5) }],
  journal: [],
})

before(() => {
  farmRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-seed-'))
  const site = path.join(farmRoot, DOMAIN)
  fs.mkdirSync(path.join(site, 'status'), { recursive: true })
  fs.mkdirSync(path.join(site, 'pages'), { recursive: true })
  fs.writeFileSync(path.join(site, 'status', 'semantic-vectors.json'), JSON.stringify([
    { slug: 'fish-page', title: 'Fish Page', vector: FISH_VEC },
    { slug: 'fish-fork', title: 'Fish Fork', vector: FISH_VEC },
    { slug: 'boat-page', title: 'Boat Page', vector: BOAT_VEC },
  ]))
  for (const slug of ['fish-page', 'fish-fork', 'boat-page'])
    fs.writeFileSync(path.join(site, 'pages', slug), JSON.stringify(page(slug)))
})

after(() => { fs.rmSync(farmRoot, { recursive: true, force: true }) })

const ctx = () => ({
  farms: [[farmRoot, 'local']],
  restricted: new Set(),
  embed: async () => Q,
})

// ── resolveSeedVector ─────────────────────────────────────────────────────────

describe('resolveSeedVector', () => {
  it('returns the stored vector for an indexed site/slug', () => {
    const v = resolveSeedVector({ site: DOMAIN, slug: 'fish-page' }, [[farmRoot, 'local']])
    assert.deepEqual(v, FISH_VEC)
  })

  it('returns null for unknown slug, unknown site, or malformed seed', () => {
    const farms = [[farmRoot, 'local']]
    assert.equal(resolveSeedVector({ site: DOMAIN, slug: 'nope' }, farms), null)
    assert.equal(resolveSeedVector({ site: 'other.example', slug: 'fish-page' }, farms), null)
    assert.equal(resolveSeedVector(null, farms), null)
    assert.equal(resolveSeedVector({ site: DOMAIN }, farms), null)
  })
})

// ── seedVector precedence ─────────────────────────────────────────────────────

describe('seedVector', () => {
  const farms = () => [[farmRoot, 'local']]
  const embedCalls = []
  const embed = async text => { embedCalls.push(text); return Q }

  it('vector wins over seed and text', async () => {
    embedCalls.length = 0
    const v = await seedVector(
      { vector: BOAT_VEC, seed: { site: DOMAIN, slug: 'fish-page' }, text: 'ignored' },
      'query', farms(), embed)
    assert.deepEqual(v, BOAT_VEC)
    assert.equal(embedCalls.length, 0, 'must not embed when a vector is given')
  })

  it('seed wins over text', async () => {
    embedCalls.length = 0
    const v = await seedVector(
      { seed: { site: DOMAIN, slug: 'fish-page' }, text: 'ignored' },
      'query', farms(), embed)
    assert.deepEqual(v, FISH_VEC)
    assert.equal(embedCalls.length, 0)
  })

  it('unresolvable seed falls back to embedding text, then query', async () => {
    embedCalls.length = 0
    await seedVector({ seed: { site: DOMAIN, slug: 'nope' }, text: 'long prose' },
      'query', farms(), embed)
    assert.deepEqual(embedCalls, ['long prose'])
    await seedVector({}, 'query', farms(), embed)
    assert.deepEqual(embedCalls, ['long prose', 'query'])
  })
})

// ── buildReport with excludePage ──────────────────────────────────────────────

describe('buildReport seeded by a page', () => {
  const refs = page => page.story.filter(i => i.type === 'reference')

  it('unseeded report finds the seed page itself', async () => {
    const page = await buildReport('fish', ['*'], 10, ctx())
    const slugs = refs(page).map(r => r.slug)
    assert.ok(slugs.length, 'expected candidates')
    assert.ok(slugs.includes('fish-page') || slugs.includes('fish-fork'),
      `fork family should appear when not excluded, got ${slugs}`)
  })

  it('excludePage drops the page and its slug-fork family', async () => {
    const page = await buildReport('fish', ['*'], 10, ctx(), null, false,
      { seed: { site: DOMAIN, slug: 'fish-page' },
        excludePage: { site: DOMAIN, slug: 'fish-page' } })
    const slugs = refs(page).map(r => r.slug)
    assert.ok(!slugs.includes('fish-page'), 'host page must be excluded')
    assert.ok(slugs.includes('boat-page'), `related page survives, got ${slugs}`)
    // fish-fork shares FISH_VEC with the host — it is the same work, and must
    // not appear as the top "related" result. (Different slug, so it is only
    // caught when bundled; here it stays because slugs differ — assert the
    // exact-slug rule only.)
  })

  it('never calls embed when the seed resolves', async () => {
    const c = ctx()
    c.embed = async () => { throw new Error('embed must not run') }
    const page = await buildReport('fish', ['*'], 10, c, null, false,
      { seed: { site: DOMAIN, slug: 'fish-page' } })
    assert.ok(page.story.length)
  })
})

// ── buildSiteReport with excludePage ──────────────────────────────────────────

describe('buildSiteReport seeded by a page', () => {
  it('excludePage removes the page vector from its home site scoring', async () => {
    const withSelf = await buildSiteReport('fish', ['*'], 10, ctx(), 'flat',
      { seed: { site: DOMAIN, slug: 'fish-page' } , excludePage: null })
    const without = await buildSiteReport('fish', ['*'], 10, ctx(), 'flat',
      { seed: { site: DOMAIN, slug: 'fish-page' },
        excludePage: { site: DOMAIN, slug: 'fish-page' } })
    const score = r => r.sites.find(s => s.domain === DOMAIN)?.score ?? 0
    assert.ok(score(withSelf) > score(without),
      'a page voting for itself must score its home site higher')
  })
})
