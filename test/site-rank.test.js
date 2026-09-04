import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import siteRank from '../server/site-rank.js'
const { rankSites, batches, DEFAULT_WEIGHTS } = siteRank

const dim = 4
const unit = v => { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)); return v.map(x => x / n) }
const mkIndex = sites => {
  const matrix = new Float32Array(sites.length * dim)
  const meta = sites.map((s, i) => { matrix.set(unit(s.v), i * dim); const { v, ...m } = s; return m })
  return { dim, matrix, meta, byDomain: new Map(meta.map((m, i) => [m.domain, i])), count: sites.length }
}
const Q = [1, 0, 0, 0]
const index = mkIndex([
  { domain: 'topical.example', kind: 'galaxy', tier: 'tail', pages: 50, v: [0.9, 0.1, 0, 0] },
  { domain: 'off.example',     kind: 'galaxy', tier: 'tail', pages: 500, v: [0, 1, 0, 0] },
  { domain: 'followed.example', kind: 'galaxy', tier: 'followed', pages: 20, v: [0, 0, 1, 0] },
  { domain: 'farm.example',    kind: 'farm',   tier: '', pages: 10, v: [0.5, 0.5, 0, 0] },
])

describe('rankSites', () => {
  it('orders by centroid when nothing is preferred', () => {
    const r = rankSites(Q, index, [], { followed: false })
    assert.equal(r[0].domain, 'topical.example')
    assert.equal(r[0].reason, 'centroid')
    assert.ok(r.every(x => !x.preferred))
  })
  it('preferred sites lead: roster, neighbourhood, followed, always', () => {
    const r = rankSites(Q, index, [], { roster: ['off.example'], neighborhood: ['farm.example'] },
      { always: ['followed.example'] })
    const lead = r.filter(x => x.preferred).map(x => x.domain)
    assert.deepEqual(new Set(lead), new Set(['off.example', 'farm.example', 'followed.example']))
    assert.equal(r.find(x => x.domain === 'off.example').reason, 'roster')
    assert.equal(r.find(x => x.domain === 'followed.example').reason, 'always+followed')
    assert.equal(r[r.length - 1].domain, 'topical.example', 'unpreferred sites follow')
  })
  it('NEVER prunes; learned scores lift', () => {
    const r = rankSites(Q, index, [], {}, { never: ['topical.example'], learned: { 'off.example': 0.8 } })
    assert.ok(!r.some(x => x.domain === 'topical.example'))
    assert.ok(r.find(x => x.domain === 'off.example').preferred)
  })
  it('the freshest source wins a duplicated domain', () => {
    const local = [{ domain: 'farm.example', kind: 'local', vector: Float32Array.from(unit([1, 0, 0, 0])), source: 'own' }]
    const r = rankSites(Q, index, local, { followed: false })
    const f = r.find(x => x.domain === 'farm.example')
    assert.equal(f.kind, 'own')
    assert.equal(f.centroid, 1)
  })
  it('batches put every preferred site in the first batch, the rest in slices', () => {
    const r = rankSites(Q, index, [], { roster: ['off.example', 'followed.example'] })
    const b = batches(r, 1)
    assert.equal(b[0].length, 2)
    assert.equal(b.length, 3)
    assert.equal(b[1][0], 'topical.example')
  })
  it('weights are overridable and default is exported', () => {
    assert.equal(DEFAULT_WEIGHTS.centroid, 1.0)
    const r = rankSites(Q, index, [], { roster: ['off.example'] }, { weights: { liked: 0 } })
    assert.equal(r.find(x => x.domain === 'off.example').preferred, false, 'a zero weight is no preference')
    assert.equal(r[0].domain, 'topical.example', 'so the better centroid leads')
  })
})
