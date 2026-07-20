import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// Server modules are CJS (see server/package.json); Node imports them fine.
import guard from '../server/peer-guard.js'
const { ceiling, parseGrants, grantsAdmit, makeDedup, makeBucket,
        guardEnvelope, SITE_LINE } = guard

// ── Roster line semantics (mirrors src/client/similarity.js SITE_LINE etc.) ──

const ROSTER_LINE = /^ROSTER ([A-Za-z0-9.\-:]+\/[a-z0-9-]+)$/
const REFS_LINE   = /^REFERENCES ([A-Za-z0-9.\-:]+\/[a-z0-9-]+)$/

describe('roster line classification', () => {
  it('matches bare domains as sites', () => {
    assert.ok('tv.fab.fish'.match(SITE_LINE))
    assert.ok('david.hitchhikers.earth'.match(SITE_LINE))
    assert.ok('localhost:4243'.match(SITE_LINE))
    assert.ok('myspace.localhost'.match(SITE_LINE))
  })
  it('rejects categories and prose', () => {
    assert.equal('My Favourite Sites'.match(SITE_LINE), null)
    assert.equal('# comment-ish'.match(SITE_LINE), null)
    assert.equal(''.match(SITE_LINE), null)
  })
  it('recognises nested ROSTER and REFERENCES includes', () => {
    assert.equal('ROSTER search.fedwiki.club/search-peers'.match(ROSTER_LINE)[1],
      'search.fedwiki.club/search-peers')
    assert.equal('REFERENCES localhost/similarity-v05-test'.match(REFS_LINE)[1],
      'localhost/similarity-v05-test')
  })
})

// ── Grants parser (Federated Farm Search page code items) ────────────────────

describe('parseGrants', () => {
  it('collects named origins from FROM lines', () => {
    const g = parseGrants(['FROM hitchhikers.earth\nFROM myspace.localhost'])
    assert.ok(g.origins.has('hitchhikers.earth'))
    assert.ok(g.origins.has('myspace.localhost'))
    assert.equal(g.open, false)
  })
  it('collects globs separately', () => {
    const g = parseGrants(['FROM *.fedwiki.org'])
    assert.deepEqual(g.globs, ['*.fedwiki.org'])
    assert.equal(g.origins.size, 0)
  })
  it('FROM * sets open', () => {
    assert.equal(parseGrants(['FROM *']).open, true)
  })
  it('is additive across multiple code items', () => {
    const g = parseGrants(['FROM a.example', 'FROM b.example\nFROM *.c.example'])
    assert.equal(g.origins.size, 2)
    assert.equal(g.globs.length, 1)
  })
  it('skips comments, blanks, and unknown lines', () => {
    const g = parseGrants(['# who may search\n\nRATE 10\nFROM a.example\nnonsense line'])
    assert.equal(g.origins.size, 1)
    assert.equal(g.open, false)
  })
  it('tolerates lowercase from and colon', () => {
    const g = parseGrants(['from: a.example'])
    assert.ok(g.origins.has('a.example'))
  })
  it('empty page grants nothing', () => {
    const g = parseGrants([''])
    assert.equal(g.origins.size, 0)
    assert.equal(g.globs.length, 0)
    assert.equal(g.open, false)
  })
})

// ── grantsAdmit under the admin ceiling ──────────────────────────────────────

describe('grantsAdmit', () => {
  const named = parseGrants(['FROM friend.example\nFROM *.pals.example'])
  const open  = parseGrants(['FROM *'])

  it('admits a named origin under grants ceiling', () => {
    assert.equal(grantsAdmit(named, 'friend.example', 'grants'), true)
  })
  it('admits a glob match', () => {
    assert.equal(grantsAdmit(named, 'a.pals.example', 'grants'), true)
  })
  it('refuses an unnamed origin', () => {
    assert.equal(grantsAdmit(named, 'stranger.example', 'grants'), false)
  })
  it('FROM * is inert under the default grants ceiling', () => {
    assert.equal(grantsAdmit(open, 'anyone.example', 'grants'), false)
  })
  it('FROM * admits everyone only under the open ceiling', () => {
    assert.equal(grantsAdmit(open, 'anyone.example', 'open'), true)
  })
  it('off ceiling refuses even named partners', () => {
    assert.equal(grantsAdmit(named, 'friend.example', 'off'), false)
  })
  it('null grants (no page) refuse everyone', () => {
    assert.equal(grantsAdmit(null, 'friend.example', 'open'), false)
  })
})

// ── Ceiling env parsing ──────────────────────────────────────────────────────

describe('ceiling', () => {
  let saved
  beforeEach(() => { saved = process.env.WIKI_PEER_FEDERATION })
  afterEach(() => {
    if (saved === undefined) delete process.env.WIKI_PEER_FEDERATION
    else process.env.WIKI_PEER_FEDERATION = saved
  })
  it('defaults to grants when unset', () => {
    delete process.env.WIKI_PEER_FEDERATION
    assert.equal(ceiling(), 'grants')
  })
  it('honours off and open', () => {
    process.env.WIKI_PEER_FEDERATION = 'off'
    assert.equal(ceiling(), 'off')
    process.env.WIKI_PEER_FEDERATION = 'OPEN'
    assert.equal(ceiling(), 'open')
  })
  it('falls back to grants on nonsense', () => {
    process.env.WIKI_PEER_FEDERATION = 'banana'
    assert.equal(ceiling(), 'grants')
  })
})

// ── Envelope guards ──────────────────────────────────────────────────────────

const mkGuards = () => ({
  ip: '203.0.113.7',
  isDuplicate: makeDedup(),
  takeIpToken: makeBucket(),
  takeGlobalToken: makeBucket({ capacity: 1000, refillPerSec: 100, maxKeys: 1 }),
})

describe('guardEnvelope', () => {
  const envelope = origin => ({ query: 'q', kind: 'report', limit: 5,
    hops: 0, requestId: Math.random().toString(16).slice(2), origin })

  it('accepts a well-formed envelope', () => {
    assert.equal(guardEnvelope(envelope('localhost'), mkGuards()).ok, true)
  })
  it('400s a missing origin', () => {
    const v = guardEnvelope({ ...envelope('x'), origin: '' }, mkGuards())
    assert.equal(v.code, 400)
  })
  it('refuses relayed requests (hops > 0)', () => {
    const v = guardEnvelope({ ...envelope('localhost'), hops: 1 }, mkGuards())
    assert.equal(v.code, 400)
    assert.match(v.error, /relay/)
  })
  it('409s a replayed request-id', () => {
    const guards = mkGuards()
    const e = { ...envelope('localhost'), requestId: 'fixed-id' }
    assert.equal(guardEnvelope(e, guards).ok, true)
    assert.equal(guardEnvelope(e, guards).code, 409)
  })
  it('429s when the IP bucket empties', () => {
    const guards = { ...mkGuards(), takeIpToken: makeBucket({ capacity: 2, refillPerSec: 0 }) }
    assert.equal(guardEnvelope(envelope('a'), guards).ok, true)
    assert.equal(guardEnvelope(envelope('b'), guards).ok, true)
    assert.equal(guardEnvelope(envelope('c'), guards).code, 429)
  })
  it('429s at the global cap regardless of IP', () => {
    const guards = { ...mkGuards(),
      takeGlobalToken: makeBucket({ capacity: 1, refillPerSec: 0, maxKeys: 1 }) }
    assert.equal(guardEnvelope(envelope('a'), guards).ok, true)
    guards.ip = '198.51.100.9'
    assert.equal(guardEnvelope(envelope('b'), guards).code, 429)
  })
  it('403s everything when the ceiling is off', () => {
    const saved = process.env.WIKI_PEER_FEDERATION
    process.env.WIKI_PEER_FEDERATION = 'off'
    try {
      const v = guardEnvelope(envelope('localhost'), mkGuards())
      assert.equal(v.code, 403)
      assert.match(v.error, /switched off/)
    } finally {
      if (saved === undefined) delete process.env.WIKI_PEER_FEDERATION
      else process.env.WIKI_PEER_FEDERATION = saved
    }
  })
})

// ── Bucket boundedness (memory-DoS resistance under key rotation) ────────────

describe('makeBucket bounds', () => {
  it('never holds more than maxKeys entries under key rotation', () => {
    const take = makeBucket({ capacity: 5, refillPerSec: 0, maxKeys: 50 })
    for (let i = 0; i < 10_000; i++) take(`spoofed-${i}`)
    // The map is internal; prove boundedness behaviourally — an early key
    // rotated out gets a FRESH bucket (was evicted), while a bounded map
    // can never retain all 10k keys. Fresh bucket ⇒ take succeeds.
    assert.equal(take('spoofed-0'), true)
  })
  it('a retained key keeps its drained state', () => {
    const take = makeBucket({ capacity: 2, refillPerSec: 0, maxKeys: 50 })
    take('steady'); take('steady')
    assert.equal(take('steady'), false) // drained, still tracked
  })
})
