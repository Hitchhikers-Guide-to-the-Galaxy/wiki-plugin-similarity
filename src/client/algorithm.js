// wiki-plugin-similarity — the reader's own search algorithm, as a page
//
// The ranking a federated search uses is a wiki page the reader owns (design:
// search.fedwiki.club/incremental-federated-search, layer three). This module
// reads it: the ALGORITHM item's weights and rules, the page's roster items
// (sites liked, sites visited), and what this browser has learned so far
// (learn.js writes localStorage['similarity:learned']). What comes back is the
// `algorithm` object site-rank.json applies on top of the Site Index ranking.
//
//   ALGORITHM
//   WEIGHT liked 1.0          how much a roster site is lifted
//   WEIGHT visited 0.6        … a site this browser learned
//   WEIGHT neighbourhood 0.4  … a site already in the lineup
//   WEIGHT followed 0.2       … a registry followed-tier site
//   WEIGHT centroid 1.0       … similarity of the site to the query
//   WEIGHT fresh 0.2          … freshness of the index that holds the site
//   ALWAYS ward.bay.wiki.org  pinned into the first batch
//   NEVER  spam.example       pruned from every batch
//   BATCH 50                  sites searched per request
//
// Unknown words are ignored, so the vocabulary can grow release by release.

const LEARNED_KEY = 'similarity:learned'
const WEIGHT_NAMES = new Set(['liked', 'visited', 'neighbourhood', 'neighborhood', 'followed', 'centroid', 'fresh'])
const SITE = /^([a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+|localhost)(:\d+)?$/

const parseAlgorithm = text => {
  const out = { weights: {}, always: [], never: [], batch: null }
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [word, ...rest] = line.split(/\s+/)
    const kw = word.toUpperCase().replace(/:$/, '')
    if (kw === 'WEIGHT' && rest.length >= 2) {
      const name = rest[0].toLowerCase().replace('neighborhood', 'neighbourhood')
      const v = parseFloat(rest[1])
      if (WEIGHT_NAMES.has(name) && Number.isFinite(v)) out.weights[name] = v
    } else if (kw === 'ALWAYS' && rest[0] && SITE.test(rest[0])) out.always.push(rest[0].toLowerCase())
    else if (kw === 'NEVER' && rest[0] && SITE.test(rest[0])) out.never.push(rest[0].toLowerCase())
    else if (kw === 'BATCH' && rest[0]) out.batch = parseInt(rest[0]) || null
  }
  return out
}

// What this browser has learned: {domain: score 0..1}, decayed by learn.js.
const learnedSignals = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(LEARNED_KEY) || '{}')
    const out = {}
    for (const [d, v] of Object.entries(raw.sites || raw)) {
      const score = typeof v === 'number' ? v : (v && typeof v.score === 'number' ? v.score : 0)
      if (score > 0) out[d.toLowerCase()] = Math.min(1, score)
    }
    return out
  } catch { return {} }
}

// ref: 'site/slug' | 'Page Title' | 'page-slug' | null (→ this site's search-algorithm)
const refToUrl = (ref, origin) => {
  if (!ref) return `${origin}/search-algorithm.json`
  const i = ref.indexOf('/')
  if (i > 0 && SITE.test(ref.slice(0, i))) return `//${ref.slice(0, i)}/${ref.slice(i + 1)}.json`
  const slug = ref.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  return `${origin}/${slug}.json`
}

// Roster items on the page: every bare site line, all of them "liked".
const rosterSites = page => {
  const out = new Set()
  for (const item of page.story || []) {
    if (item.type !== 'roster') continue
    for (const raw of (item.text || '').split(/\r?\n/)) {
      const line = raw.trim()
      if (SITE.test(line)) out.add(line.toLowerCase())
    }
  }
  return [...out]
}

const cache = new Map()
const loadAlgorithm = async (ref, origin) => {
  const url = refToUrl(ref, origin)
  let algo = cache.get(url)
  if (!algo) {
    algo = { weights: {}, always: [], never: [], liked: [], batch: null, page: null }
    try {
      const res = await fetch(url)
      if (res.ok) {
        const page = await res.json()
        const item = (page.story || []).find(i => i.type === 'similarity' &&
          /^\s*ALGORITHM\b/im.test(i.text || ''))
        if (item) Object.assign(algo, parseAlgorithm(item.text))
        algo.liked = rosterSites(page)
        algo.page = { url, title: page.title }
      }
    } catch { /* no algorithm page: defaults apply */ }
    cache.set(url, algo)
  }
  return { ...algo, learned: learnedSignals() }
}

export { parseAlgorithm, learnedSignals, loadAlgorithm, rosterSites, refToUrl, LEARNED_KEY }
