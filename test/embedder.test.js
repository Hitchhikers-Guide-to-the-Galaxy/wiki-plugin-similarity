import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Exercises the real child-process supervisor (server/embedder.js) with the
// child in mock mode: no model download, deterministic vectors, and a
// '__CRASH__' text that makes the child hard-exit — proving the crash is an
// event in the parent, not a parent death. Env must be set before the module
// loads its config, hence the dynamic import.

process.env.WIKI_EMBED_MOCK = '1'
process.env.WIKI_EMBED_NO_SEMINDEX = '1'
process.env.WIKI_EMBED_IDLE_MS = '1000'
process.env.WIKI_EMBED_TIMEOUT_MS = '10000'
process.env.WIKI_EMBED_MAX_CRASHES = '3'
process.env.WIKI_EMBED_CRASH_WINDOW_MS = '60000'
process.env.WIKI_EMBED_COOLDOWN_MS = '60000'

const embedder = (await import('../server/embedder.js')).default

describe('child-process embedder', () => {
  it('embeds via the child and returns a unit vector', async () => {
    const vector = await embedder.embed('hello federation')
    assert.equal(vector.length, 384)
    const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0))
    assert.ok(Math.abs(norm - 1) < 1e-6, `expected unit norm, got ${norm}`)
    // deterministic in mock mode
    assert.deepEqual(await embedder.embed('hello federation'), vector)
  })

  it('survives a child crash and recovers on the next call', async () => {
    await assert.rejects(embedder.embed('__CRASH__'), /exited/)
    const vector = await embedder.embed('still alive')
    assert.equal(vector.length, 384)
    const status = embedder.status()
    assert.equal(status.via, 'child-process')
    assert.equal(status.recentCrashes, 1)
  })

  it('opens the breaker after repeated crashes and fails fast', async () => {
    await assert.rejects(embedder.embed('__CRASH__'), /exited/)
    await assert.rejects(embedder.embed('__CRASH__'), /exited/)
    // three crashes inside the window → breaker open
    assert.equal(embedder.status().state, 'down')
    await assert.rejects(embedder.embed('anything'), err => {
      assert.equal(err.code, 'EMBEDDER_DOWN')
      assert.match(err.message, /temporarily unavailable/)
      return true
    })
  })
})
