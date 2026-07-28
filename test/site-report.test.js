import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Server modules are CJS (see server/package.json); Node imports them fine.
import siteReport from '../server/site-report.js'
const { scoreSite, rankSites, SITE_TOP_K, SITE_TOPK_WEIGHT, SITE_CENTROID_WEIGHT,
        SITE_FLOOR } = siteReport

// Synthetic unit vectors in a small space — the formula is dimension-agnostic.
const unit = v => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return v.map(x => x / n)
}
const page = (slug, v) => ({ slug, title: slug, vector: unit(v) })

const Q = unit([1, 0, 0, 0])
const onTopic  = () => page('on-topic', [0.9, 0.1, 0, 0])   // sim ≈ 0.994
const offTopic = i => page(`off-${i}`, [0, 1, 0, 0])         // sim = 0

describe('scoreSite', () => {
  it('centroid of identical vectors equals the page similarity', () => {
    const p = onTopic()
    const s = scoreSite(Q, [p, { ...p, slug: 'twin' }])
    const sim = Q.reduce((acc, x, i) => acc + x * p.vector[i], 0)
    assert.ok(Math.abs(s.topk - sim) < 1e-9)
    assert.ok(Math.abs(s.centroid - sim) < 1e-9)
    assert.ok(Math.abs(s.score - sim) < 1e-9)
  })

  it('topK averages min(SITE_TOP_K, N) pages — small sites are not zero-padded', () => {
    const two = scoreSite(Q, [onTopic(), onTopic()])
    assert.ok(two.topk > 0.99, `2-page site topk should be its own mean, got ${two.topk}`)
    const many = scoreSite(Q, [
      ...Array.from({ length: SITE_TOP_K }, () => onTopic()),
      ...Array.from({ length: 20 }, (_, i) => offTopic(i)),
    ])
    assert.ok(Math.abs(many.topk - two.topk) < 1e-9,
      'topK must ignore pages beyond the top K')
  })

  it('weights blend topK and centroid', () => {
    const s = scoreSite(Q, [onTopic(), offTopic(1)])
    assert.ok(Math.abs(s.score -
      (SITE_TOPK_WEIGHT * s.topk + SITE_CENTROID_WEIGHT * s.centroid)) < 1e-12)
  })

  it('counts hits and reports top pages ordered by similarity', () => {
    const s = scoreSite(Q, [offTopic(1), onTopic(), offTopic(2)])
    assert.equal(s.hits, 1)
    assert.equal(s.topPages[0].slug, 'on-topic')
  })
})

describe('rankSites', () => {
  it('focused small site beats a large diffuse site with the same best pages', () => {
    const focused = { domain: 'niche.example', page_count: 2,
      pages: [onTopic(), onTopic()] }
    const diffuse = { domain: 'pod.example', page_count: 55,
      pages: [...Array.from({ length: 5 }, () => onTopic()),
              ...Array.from({ length: 50 }, (_, i) => offTopic(i))] }
    const ranked = rankSites(Q, [diffuse, focused])
    assert.equal(ranked[0].domain, 'niche.example')
    assert.equal(ranked[1].domain, 'pod.example')
    assert.ok(Math.abs(ranked[0].topk - ranked[1].topk) < 1e-9,
      'the two sites tie on topK — the centroid must decide')
  })

  it('a big site with a genuinely stronger cluster still wins', () => {
    const strongPage = page('strong', [0.99, 0.01, 0, 0])
    const big = { domain: 'big.example', page_count: 30,
      pages: [...Array.from({ length: 5 }, () => strongPage),
              ...Array.from({ length: 25 }, (_, i) => offTopic(i))] }
    const weakSmall = { domain: 'small.example', page_count: 2,
      pages: [page('meh-1', [0.62, 0.79, 0, 0]), page('meh-2', [0.62, 0.79, 0, 0])] }
    const ranked = rankSites(Q, [weakSmall, big])
    assert.equal(ranked[0].domain, 'big.example')
  })

  it('drops sites below the floor and empty sites', () => {
    const off = { domain: 'off.example', page_count: 3,
      pages: [offTopic(1), offTopic(2), offTopic(3)] }
    const empty = { domain: 'empty.example', page_count: 0, pages: [] }
    const on = { domain: 'on.example', page_count: 1, pages: [onTopic()] }
    const ranked = rankSites(Q, [off, empty, on])
    assert.deepEqual(ranked.map(s => s.domain), ['on.example'])
    assert.ok(ranked[0].topk >= SITE_FLOOR)
  })
})
