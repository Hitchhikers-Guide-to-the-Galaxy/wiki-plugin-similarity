import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import siteIndex from '../server/site-index.js'
import siteRank from '../server/site-rank.js'
const { parseVerdicts } = siteIndex
const { rankSites } = siteRank

const sitemap = [
  { slug: 'readymadewiki', title: 'readymade.wiki', synopsis: 'readymade.wiki is dead: http 404 since 8 August 2026, last seen 6 August 2026; 31 pages remain indexed; probably moved to hatrack.example.' },
  { slug: 'oldwiki', title: 'old.wiki', synopsis: 'old.wiki has moved: it now answers from new.wiki; last seen as itself 1 May 2026.' },
  { slug: 'gonewiki', title: 'gone.wiki', synopsis: 'gone.wiki has lapsed: its name no longer resolves; last seen 2 May 2026.' },
  { slug: 'shakywiki', title: 'shaky.wiki', synopsis: 'shaky.wiki is unreliable: up 62% of the last 30 days, 4 flaps, last seen 3 September 2026.' },
  { slug: 'welcome-visitors', title: 'Welcome Visitors', synopsis: 'Welcome to the graveyard of the federation …' },
]

describe('parseVerdicts', () => {
  it('reads class and destination from the verdict sentence', () => {
    const v = parseVerdicts(sitemap)
    assert.equal(v['readymade.wiki'].class, 'dead')
    assert.equal(v['readymade.wiki'].to, 'hatrack.example')
    assert.equal(v['old.wiki'].class, 'moved'); assert.equal(v['old.wiki'].to, 'new.wiki')
    assert.equal(v['gone.wiki'].class, 'lapsed')
    assert.equal(v['shaky.wiki'].class, 'unreliable'); assert.equal(v['shaky.wiki'].to, null)
    assert.equal(Object.keys(v).length, 4, 'hand pages are not verdicts')
  })
})

const dim = 4
const unit = v => { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)); return v.map(x => x / n) }
const mkIndex = sites => {
  const matrix = new Float32Array(sites.length * dim)
  const meta = sites.map((s, i) => { matrix.set(unit(s.v), i * dim); const { v, ...m } = s; return m })
  return { dim, matrix, meta, byDomain: new Map(meta.map((m, i) => [m.domain, i])), count: sites.length }
}
const Q = [1, 0, 0, 0]
const index = mkIndex([
  { domain: 'readymade.wiki', kind: 'galaxy', tier: 'tail', pages: 30, v: [1, 0, 0, 0] },
  { domain: 'hatrack.example', kind: 'galaxy', tier: 'tail', pages: 30, v: [0.9, 0.1, 0, 0] },
  { domain: 'shaky.wiki', kind: 'galaxy', tier: 'tail', pages: 30, v: [0.95, 0.05, 0, 0] },
  { domain: 'fine.wiki', kind: 'galaxy', tier: 'tail', pages: 30, v: [0.8, 0.2, 0, 0] },
])
const verdicts = parseVerdicts(sitemap)

describe('rankSites with verdicts', () => {
  it('drops dead sites, searches where they moved, and sinks the unreliable', () => {
    const r = rankSites(Q, index, [], { followed: false }, {}, verdicts)
    const names = r.map(x => x.domain)
    assert.ok(!names.includes('readymade.wiki'))
    assert.equal(r.find(x => x.domain === 'hatrack.example').movedFrom, 'readymade.wiki')
    const shaky = r.find(x => x.domain === 'shaky.wiki')
    assert.equal(shaky.verdict, 'unreliable')
    assert.ok(shaky.reason.includes('unreliable'))
    assert.ok(r.indexOf(shaky) > r.indexOf(r.find(x => x.domain === 'fine.wiki')), 'unreliable sinks below a weaker but solid site')
  })
  it('TRUST any keeps everything; TRUST solid drops the shaky', () => {
    const any = rankSites(Q, index, [], { followed: false }, { trust: 'any' }, verdicts)
    assert.ok(any.some(x => x.domain === 'readymade.wiki'))
    const solid = rankSites(Q, index, [], { followed: false }, { trust: 'solid' }, verdicts)
    assert.ok(!solid.some(x => x.domain === 'shaky.wiki'))
  })
})
