import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import moved from '../server/moved.js'
const { followMoves, followMovesOnPage } = moved

const verdicts = {
  'readymade.wiki': { class: 'dead', to: 'duchamp.cat' },
  'gone.wiki': { class: 'lapsed', to: null },
}
const hasSlug = (d, s) => d === 'duchamp.cat' && s === 'fountain'

describe('followMoves', () => {
  it('rewrites to the twin when it holds the slug, labels otherwise', () => {
    const results = [
      { site: 'readymade.wiki', slug: 'fountain', title: 'Fountain' },
      { site: 'readymade.wiki', slug: 'bottle-rack', title: 'Bottle Rack' },
      { site: 'gone.wiki', slug: 'x', title: 'X' },
      { site: 'fine.wiki', slug: 'y', title: 'Y' },
    ]
    const out = followMoves(results, verdicts, hasSlug)
    assert.deepEqual(out, { rewritten: 1, labelled: 2 })
    assert.equal(results[0].site, 'duchamp.cat'); assert.equal(results[0].movedFrom, 'readymade.wiki')
    assert.equal(results[1].site, 'readymade.wiki'); assert.equal(results[1].gone, 'dead'); assert.equal(results[1].movedTo, 'duchamp.cat')
    assert.equal(results[2].gone, 'lapsed'); assert.equal(results[2].movedTo, undefined)
    assert.equal(results[3].gone, undefined)
  })
  it('annotates reference items on a page', () => {
    const page = { story: [
      { type: 'markdown', text: 'x' },
      { type: 'reference', site: 'readymade.wiki', slug: 'fountain', title: 'Fountain', text: 'a urinal' },
      { type: 'reference', site: 'readymade.wiki', slug: 'nope', title: 'Nope', text: 'gone' },
    ] }
    followMovesOnPage(page, verdicts, hasSlug)
    assert.equal(page.story[1].site, 'duchamp.cat'); assert.match(page.story[1].text, /was on readymade.wiki, now here/)
    assert.match(page.story[2].text, /site dead, probably moved to duchamp.cat/)
  })
})
