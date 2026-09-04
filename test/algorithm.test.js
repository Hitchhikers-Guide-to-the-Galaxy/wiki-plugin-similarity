import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseAlgorithm, rosterSites, refToUrl } from '../src/client/algorithm.js'

describe('parseAlgorithm', () => {
  it('reads weights, ALWAYS, NEVER and BATCH; ignores unknown words', () => {
    const a = parseAlgorithm('ALGORITHM\nWEIGHT liked 1.5\nWEIGHT neighborhood 0.3\nWEIGHT bogus 9\n' +
      'ALWAYS Ward.Bay.Wiki.org\nNEVER spam.example\nNEVER not a domain\nBATCH 25\nFROBNICATE now')
    assert.deepEqual(a.weights, { liked: 1.5, neighbourhood: 0.3 })
    assert.deepEqual(a.always, ['ward.bay.wiki.org'])
    assert.deepEqual(a.never, ['spam.example'])
    assert.equal(a.batch, 25)
  })
  it('an empty item means defaults', () => {
    assert.deepEqual(parseAlgorithm('ALGORITHM'), { weights: {}, always: [], never: [], batch: null })
  })
})

describe('rosterSites', () => {
  it('collects bare site lines from every roster item', () => {
    const page = { story: [
      { type: 'roster', text: 'Sites I like\nward.bay.wiki.org\nfed.wiki\n' },
      { type: 'markdown', text: 'not.a.roster' },
      { type: 'roster', text: 'ROSTER other/page\nfed.wiki\nlocalhost:3000' },
    ] }
    assert.deepEqual(rosterSites(page), ['ward.bay.wiki.org', 'fed.wiki', 'localhost:3000'])
  })
})

describe('refToUrl', () => {
  it('resolves site/slug, a title, and the default', () => {
    assert.equal(refToUrl(null, 'https://a.example'), 'https://a.example/search-algorithm.json')
    assert.equal(refToUrl('Search Algorithm', 'https://a.example'), 'https://a.example/search-algorithm.json')
    assert.equal(refToUrl('david.hitchhikers.earth/my-search', 'https://a.example'), '//david.hitchhikers.earth/my-search.json')
  })
})
