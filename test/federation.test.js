import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Server modules are CJS (see server/package.json); Node imports them fine.
import guard from '../server/peer-guard.js'
const { makeDedup, makeBucket, guardEnvelope, SITE_LINE } = guard

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

// ── Envelope guards ───────────────────────────────────────────────────────────

const mkGuards = allowed => ({
  allowed,
  isDuplicate: makeDedup(),
  takeToken: makeBucket(),
})

describe('guardEnvelope', () => {
  const envelope = origin => ({ query: 'q', kind: 'report', limit: 5,
    hops: 0, requestId: Math.random().toString(16).slice(2), origin })

  it('accepts an allowlisted peer', () => {
    const v = guardEnvelope(envelope('localhost'), mkGuards(new Set(['localhost'])))
    assert.equal(v.ok, true)
  })
  it('403s a peer missing from the roster', () => {
    const v = guardEnvelope(envelope('evil.example'), mkGuards(new Set(['localhost'])))
    assert.equal(v.ok, false)
    assert.equal(v.code, 403)
  })
  it('403s when the site has no search-peers page at all', () => {
    const v = guardEnvelope(envelope('localhost'), mkGuards(null))
    assert.equal(v.ok, false)
    assert.equal(v.code, 403)
    assert.match(v.error, /search-peers/)
  })
  it('400s a missing origin', () => {
    const v = guardEnvelope({ ...envelope('x'), origin: '' }, mkGuards(new Set(['x'])))
    assert.equal(v.code, 400)
  })
  it('refuses relayed requests (hops > 0)', () => {
    const v = guardEnvelope({ ...envelope('localhost'), hops: 1 },
      mkGuards(new Set(['localhost'])))
    assert.equal(v.code, 400)
    assert.match(v.error, /relay/)
  })
  it('409s a replayed request-id', () => {
    const guards = mkGuards(new Set(['localhost']))
    const e = { ...envelope('localhost'), requestId: 'fixed-id' }
    assert.equal(guardEnvelope(e, guards).ok, true)
    const replay = guardEnvelope(e, guards)
    assert.equal(replay.code, 409)
  })
  it('429s when the token bucket empties', () => {
    const guards = { allowed: new Set(['localhost']), isDuplicate: makeDedup(),
      takeToken: makeBucket({ capacity: 2, refillPerSec: 0 }) }
    assert.equal(guardEnvelope(envelope('localhost'), guards).ok, true)
    assert.equal(guardEnvelope(envelope('localhost'), guards).ok, true)
    assert.equal(guardEnvelope(envelope('localhost'), guards).code, 429)
  })
})
