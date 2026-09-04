import test from 'node:test'
import assert from 'node:assert/strict'
import cascade from '../server/cascade.js'
const { askCascade, MAX_HOPS } = cascade

const peerThatHolds = (held, results = []) => async (host, path, body) => ({
  status: 200, body: { results, held: held.filter(d => body.domains.includes(d)),
    stats: { domains: held.filter(d => body.domains.includes(d)).length, pages: 10 } },
})

test('walks peers in order, asking each only what is still missing', async () => {
  const calls = []
  const post = async (host, path, body) => {
    calls.push([host, body.domains])
    if (host === 'a.example') return peerThatHolds(['x'], [{ site: 'x', slug: 's', score: 0.9 }])(host, path, body)
    return peerThatHolds(['y'], [{ site: 'y', slug: 't', score: 0.5 }])(host, path, body)
  }
  const out = await askCascade({ peers: ['https://a.example', 'https://b.example'], missing: ['x', 'y', 'z'], body: { query: 'q' }, post })
  assert.deepEqual(calls, [['a.example', ['x', 'y', 'z']], ['b.example', ['y', 'z']]])
  assert.deepEqual(out.missing, ['z'])
  assert.deepEqual(out.results.map(r => [r.site, r.via]), [['x', 'a.example'], ['y', 'b.example']])
  assert.deepEqual(out.peers.map(p => p.host), ['a.example', 'b.example'])
})

test('stops once nothing is missing', async () => {
  const calls = []
  const post = async (host, path, body) => { calls.push(host); return peerThatHolds(['x'])(host, path, body) }
  await askCascade({ peers: ['https://a.example', 'https://b.example'], missing: ['x'], body: {}, post })
  assert.deepEqual(calls, ['a.example'])
})

test('never asks a host already in the chain, and passes the chain on', async () => {
  const calls = []
  const post = async (host, path, body) => { calls.push([host, body.via, body.hops]); return peerThatHolds([])(host, path, body) }
  await askCascade({ peers: ['https://a.example', 'https://b.example'], missing: ['x'], body: {}, hops: 0, via: ['a.example'], post })
  assert.deepEqual(calls, [['b.example', ['a.example', 'b.example'], 1]])
})

test('does not delegate beyond MAX_HOPS', async () => {
  let called = false
  const out = await askCascade({ peers: ['https://a.example'], missing: ['x'], body: {}, hops: MAX_HOPS, post: async () => { called = true } })
  assert.equal(called, false)
  assert.deepEqual(out.missing, ['x'])
})

test('an older peer that reports no held list is taken to have answered everything', async () => {
  const calls = []
  const post = async host => { calls.push(host); return { status: 200, body: { results: [], stats: { domains: 2 } } } }
  const out = await askCascade({ peers: ['https://a.example', 'https://b.example'], missing: ['x', 'y'], body: {}, post })
  assert.deepEqual(calls, ['a.example'])
  assert.deepEqual(out.missing, [])
})

test('a failing peer is recorded and the walk goes on', async () => {
  const post = async (host, path, body) => {
    if (host === 'a.example') throw new Error('peer timeout')
    return peerThatHolds(['x'], [{ site: 'x', slug: 's' }])(host, path, body)
  }
  const out = await askCascade({ peers: ['https://a.example', 'https://b.example'], missing: ['x'], body: {}, post })
  assert.deepEqual(out.errors, ['a.example: peer timeout'])
  assert.deepEqual(out.results.map(r => r.via), ['b.example'])
})

test('a nested answer keeps the host that really held the page', async () => {
  const post = async () => ({ status: 200, body: { results: [{ site: 'x', slug: 's', via: 'deep.example' }], held: ['x'],
    stats: { domains: 1 }, peers: [{ host: 'deep.example', domains: 1, pages: 3 }] } })
  const out = await askCascade({ peers: ['https://a.example'], missing: ['x'], body: {}, post })
  assert.equal(out.results[0].via, 'deep.example')
  assert.deepEqual(out.peers.map(p => p.host), ['a.example', 'deep.example'])
})
