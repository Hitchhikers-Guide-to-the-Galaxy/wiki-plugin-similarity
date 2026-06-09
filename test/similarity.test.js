import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Pure functions extracted for testing (mirrors src/client/similarity.js)

const SIMILAR_THRESHOLDS = { high: 0.78, medium: 0.68, low: 0.58 }
const DEFAULT_THRESHOLD  = SIMILAR_THRESHOLDS.medium
const DEFAULT_LIMIT      = 10

const parseDSL = text => {
  const specs = []
  let threshold = null, limit = null, mode = 'search', live = false
  const isCmd = (upper, kw) => upper === kw || (upper.startsWith(kw) && /^[\s:]/.test(upper.slice(kw.length)))
  const val   = (line, kw) => line.slice(kw.length).replace(/^\s*:?\s*/, '').trim()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const upper = line.toUpperCase()
    if (isCmd(upper, 'LIVE'))  { live = true; continue }
    if (isCmd(upper, 'LIST')) {
      if (!specs.length && mode === 'search') mode = 'list'
      continue
    }
    if (isCmd(upper, 'SIMILAR')) {
      const level = val(upper, 'SIMILAR').toLowerCase()
      threshold = SIMILAR_THRESHOLDS[level] || DEFAULT_THRESHOLD
      if (!specs.length && mode === 'search') mode = 'similar'
      continue
    }
    if (isCmd(upper, 'THRESHOLD')) {
      threshold = parseFloat(val(line, 'THRESHOLD')) || DEFAULT_THRESHOLD
      continue
    }
    if (isCmd(upper, 'LIMIT')) {
      limit = parseInt(val(line, 'LIMIT')) || DEFAULT_LIMIT
      continue
    }
    specs.push(line)
  }
  return { mode, specs, threshold: threshold ?? DEFAULT_THRESHOLD, limit: limit ?? DEFAULT_LIMIT, live }
}

const isGlob = spec => spec.includes('*') || spec.includes('?')
const slugify = title => title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

const cosineScan = (queryVec, domainEntries, { threshold, limit, excludeSlug, excludeDomain }) => {
  const results = []
  for (const { domain, pages } of domainEntries) {
    for (const { slug, title, vector } of pages) {
      if (slug === excludeSlug && domain === excludeDomain) continue
      let dot = 0
      for (let i = 0; i < queryVec.length; i++) dot += queryVec[i] * vector[i]
      if (dot >= threshold) results.push({ domain, slug, title, score: dot })
    }
  }
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

// ── DSL tests ─────────────────────────────────────────────────────────────────

describe('parseDSL — domain specs', () => {
  it('parses star', () => assert.deepEqual(parseDSL('*').specs, ['*']))
  it('parses glob', () => assert.deepEqual(parseDSL('david.*').specs, ['david.*']))
  it('parses multiple lines', () => assert.deepEqual(parseDSL('david.*\n*.fish').specs, ['david.*', '*.fish']))
  it('ignores comments', () => assert.deepEqual(parseDSL('# note\ndavid.x').specs, ['david.x']))
  it('empty text gives empty specs', () => assert.deepEqual(parseDSL('').specs, []))
})

describe('parseDSL — thresholds', () => {
  it('SIMILAR: high maps to 0.78', () => assert.equal(parseDSL('*\nSIMILAR: high').threshold, 0.78))
  it('SIMILAR: medium maps to 0.68', () => assert.equal(parseDSL('SIMILAR: medium').threshold, 0.68))
  it('SIMILAR: low maps to 0.58', () => assert.equal(parseDSL('SIMILAR: low').threshold, 0.58))
  it('THRESHOLD: exact value', () => assert.equal(parseDSL('THRESHOLD: 0.72').threshold, 0.72))
  it('default threshold is medium (0.68)', () => assert.equal(parseDSL('david.*').threshold, 0.68))
  it('threshold after domain specs', () => {
    assert.equal(parseDSL('david.*\nTHRESHOLD: 0.75').threshold, 0.75)
    assert.deepEqual(parseDSL('david.*\nTHRESHOLD: 0.75').specs, ['david.*'])
  })
})

describe('parseDSL — limit', () => {
  it('LIMIT: 5 parsed', () => assert.equal(parseDSL('LIMIT: 5').limit, 5))
  it('default limit is 10', () => assert.equal(parseDSL('david.*').limit, 10))
})

describe('parseDSL — bare commands default sensibly', () => {
  it('bare SIMILAR triggers similar mode', () => assert.equal(parseDSL('SIMILAR').mode, 'similar'))
  it('bare SIMILAR defaults to medium threshold', () => assert.equal(parseDSL('SIMILAR').threshold, 0.68))
  it('bare LIMIT defaults to 10', () => assert.equal(parseDSL('LIMIT').limit, 10))
  it('bare THRESHOLD defaults to medium', () => assert.equal(parseDSL('THRESHOLD').threshold, 0.68))
  it('bare LIST triggers list mode', () => assert.equal(parseDSL('LIST').mode, 'list'))
  it('domain starting with SIMILAR is not treated as command', () => {
    const r = parseDSL('similarity.example.com')
    assert.deepEqual(r.specs, ['similarity.example.com'])
    assert.equal(r.mode, 'search')
  })
})

describe('parseDSL — colon and whitespace tolerance', () => {
  it('LIMIT 5 (no colon)', () => assert.equal(parseDSL('LIMIT 5').limit, 5))
  it('LIMIT:5 (no space)', () => assert.equal(parseDSL('LIMIT:5').limit, 5))
  it('LIMIT  :  5 (extra spaces)', () => assert.equal(parseDSL('LIMIT  :  5').limit, 5))
  it('THRESHOLD 0.72 (no colon)', () => assert.equal(parseDSL('THRESHOLD 0.72').threshold, 0.72))
  it('THRESHOLD:0.72 (no space)', () => assert.equal(parseDSL('THRESHOLD:0.72').threshold, 0.72))
  it('SIMILAR high (no colon)', () => assert.equal(parseDSL('SIMILAR high').threshold, 0.78))
  it('SIMILAR:high (no space)', () => assert.equal(parseDSL('SIMILAR:high').threshold, 0.78))
  it('LIST (no colon) triggers list mode', () => assert.equal(parseDSL('LIST').mode, 'list'))
  it('LIST: (with colon) triggers list mode', () => assert.equal(parseDSL('LIST:').mode, 'list'))
  it('trailing whitespace on line ignored', () => assert.equal(parseDSL('LIMIT: 5   ').limit, 5))
})

describe('parseDSL — params do not bleed into specs', () => {
  it('SIMILAR line not in specs', () => {
    assert.deepEqual(parseDSL('david.*\nSIMILAR: high').specs, ['david.*'])
  })
  it('LIMIT line not in specs', () => {
    assert.deepEqual(parseDSL('david.*\nLIMIT: 5').specs, ['david.*'])
  })
})

describe('parseDSL — LIVE flag', () => {
  it('default is not live', () => assert.equal(parseDSL('SIMILAR').live, false))
  it('LIVE sets live=true', () => assert.equal(parseDSL('LIVE\nSIMILAR').live, true))
  it('LIVE anywhere in DSL sets live', () => assert.equal(parseDSL('SIMILAR\nLIVE').live, true))
  it('LIVE does not affect mode', () => assert.equal(parseDSL('LIVE\nSIMILAR').mode, 'similar'))
  it('LIVE does not end up in specs', () => assert.deepEqual(parseDSL('LIVE\ndavid.*').specs, ['david.*']))
})

// ── isGlob ────────────────────────────────────────────────────────────────────

describe('isGlob', () => {
  it('detects *', () => assert.equal(isGlob('david.*'), true))
  it('detects ?', () => assert.equal(isGlob('a.?.b'), true))
  it('plain domain is not a glob', () => assert.equal(isGlob('david.hitchhikers.earth'), false))
})

// ── slugify ───────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases and hyphenates', () => assert.equal(slugify('Pattern Machinery'), 'pattern-machinery'))
  it('strips special chars', () => assert.equal(slugify("What's Next?"), 'whats-next'))
})

// ── cosineScan ────────────────────────────────────────────────────────────────

describe('cosineScan', () => {
  const pages = [
    { slug: 'page-a', title: 'Page A', vector: [1, 0, 0] },
    { slug: 'page-b', title: 'Page B', vector: [0, 1, 0] },
    { slug: 'page-c', title: 'Page C', vector: [0.707, 0.707, 0] },
  ]
  const opts = { threshold: 0, limit: 10, excludeSlug: null, excludeDomain: null }

  it('sorts by score descending', () => {
    const r = cosineScan([1, 0, 0], [{ domain: 'd', pages }], opts)
    assert.equal(r[0].slug, 'page-a')
    assert.ok(r[0].score > r[1].score)
  })

  it('applies threshold filter', () => {
    const r = cosineScan([1, 0, 0], [{ domain: 'd', pages }], { ...opts, threshold: 0.5 })
    assert.ok(r.every(x => x.score >= 0.5))
    assert.ok(!r.find(x => x.slug === 'page-b'))  // score 0, below threshold
  })

  it('excludes current page', () => {
    const r = cosineScan([1, 0, 0], [{ domain: 'd', pages }],
      { ...opts, excludeSlug: 'page-a', excludeDomain: 'd' })
    assert.ok(!r.find(x => x.slug === 'page-a'))
  })

  it('respects limit', () => {
    const r = cosineScan([1, 0, 0], [{ domain: 'd', pages }], { ...opts, limit: 1 })
    assert.equal(r.length, 1)
  })

  it('merges across domains', () => {
    const entries = [
      { domain: 'a', pages: [{ slug: 'x', title: 'X', vector: [0, 0, 1] }] },
      { domain: 'b', pages: [{ slug: 'y', title: 'Y', vector: [1, 0, 0] }] },
    ]
    const r = cosineScan([1, 0, 0], entries, opts)
    assert.equal(r[0].domain, 'b')
    assert.equal(r[1].domain, 'a')
  })

  it('handles empty domain list', () => {
    assert.deepEqual(cosineScan([1, 0, 0], [], opts), [])
  })
})
