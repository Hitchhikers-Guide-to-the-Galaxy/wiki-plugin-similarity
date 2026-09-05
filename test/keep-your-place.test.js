import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { keyOf, pendingAbove, foldIn, refreshShown, DEFAULT_BATCH } from '../src/client/batch.js'
import { parseDSL } from '../src/client/dsl.js'

const r = (site, slug, score) => ({ site, slug, score })

describe('keep your place (Personal Search Plan, Phase 1)', () => {
  it('counts results that rank above the shown list without moving it', () => {
    const shown = [r('a', 'x', 0.9), r('b', 'y', 0.8), r('c', 'z', 0.7)]
    const merged = [r('n', 'new', 0.95), r('a', 'x', 0.9), r('n', 'two', 0.85), r('b', 'y', 0.8), r('c', 'z', 0.7)]
    assert.equal(pendingAbove(shown, merged, 3), 2)
    assert.deepEqual(refreshShown(shown, merged).map(keyOf), ['a x', 'b y', 'c z'])
  })
  it('folds pending results in, and an opened result keeps its position', () => {
    const shown = [r('a', 'x', 0.9), r('b', 'y', 0.8), r('c', 'z', 0.7)]
    const merged = [r('n', 'new', 0.95), r('a', 'x', 0.9), r('n', 'two', 0.85), r('b', 'y', 0.8), r('c', 'z', 0.7)]
    const opened = new Set(['b y'])
    const out = foldIn(shown, merged, 3, opened)
    assert.deepEqual(out.map(keyOf), ['n new', 'b y', 'a x'])
    const plain = foldIn(shown, merged, 3, new Set())
    assert.deepEqual(plain.map(keyOf), ['n new', 'a x', 'n two'])
  })
  it('an opened result that fell below the limit is still listed, where it was', () => {
    const shown = [r('a', 'x', 0.9), r('b', 'y', 0.8), r('c', 'z', 0.7)]
    const merged = [r('n', '1', 0.99), r('n', '2', 0.98), r('n', '3', 0.97), r('a', 'x', 0.9), r('b', 'y', 0.8), r('c', 'z', 0.7)]
    const out = foldIn(shown, merged, 3, new Set(['c z']))
    assert.deepEqual(out.map(keyOf), ['n 1', 'n 2', 'c z'])
  })
  it('the default batch is a hundred sites', () => { assert.equal(DEFAULT_BATCH, 100) })
})

describe('AUTO (Like This Page)', () => {
  it('parses AUTO beside SUBJECT and REPORT', () => {
    const d = parseDSL('GALAXY\nREPORT\nSUBJECT\nAUTO\nBATCH 100\nLIMIT: 10')
    assert.equal(d.auto, true); assert.equal(d.subject, true); assert.equal(d.mode, 'report'); assert.equal(d.batch, 100)
    assert.equal(parseDSL('* REPORT').auto, false)
  })
})
