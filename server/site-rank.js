// wiki-plugin-similarity — site ranking (CommonJS)
//
// Which sites should a federated search read first? The resource-selection
// step: every site in the Site Index (plus this farm's own) is scored for one
// query and returned in the order the client should search them, batch by
// batch. Pure ranking over vectors already in memory — separable from fs.
//
// The order (Search Tool Plan, Phase 5; confirmed by David 2026-09-04):
//   1. preferred sites first — the item's ROSTER lines, the lineup's
//      neighbourhood, the registry's followed tier, and the reader's own
//      algorithm page (ALWAYS lines and learned scores);
//   2. everything else by centroid cosine to the query;
//   3. ties by index freshness (own farm > peer > galaxy), tier, size.
// NEVER lines prune a site from every batch.
//
// `algorithm` is the reader's Search Algorithm page as the client parsed it:
//   { weights: {liked, visited, neighbourhood, followed, centroid, fresh},
//     always: [domains], never: [domains], learned: {domain: 0..1} }
// Every field is optional; the defaults below apply.

const DEFAULT_WEIGHTS = {
  liked: 1.0, visited: 0.6, neighbourhood: 0.4, followed: 0.2,
  centroid: 1.0, fresh: 0.2, reliable: 0.3, stale: 0.2,
}
// How a verdict from the Semantic Site Graveyard moves a site (Dead Sites
// Plan): dead, lapsed and moved sites leave the list — a moved site is
// replaced by where it went when that is known — unless the reader's
// algorithm says TRUST any; unreliable and flaky sink by `reliable`.
const VERDICT_PENALTY = { unreliable: 1.0, flaky: 0.5 }
// Staleness (Dead Sites Plan, Phase 6): a live site nobody tends sinks by
// WEIGHT stale; a reader who wants the old ones sets it to 0 or below.
const STALE_PENALTY = { stale: 0.5, abandoned: 1.0 }
const KIND_FRESHNESS = { local: 1.0, public: 1.0, own: 1.0, farm: 0.8, peer: 0.6, galaxy: 0.4 }

const dot = (a, b) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

const norm = v => {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  n = Math.sqrt(n) || 1
  return Float32Array.from(v, x => x / n)
}

// qvec: number[] | Float32Array; index: loadSiteIndex() result or null;
// local: localSites() result; prefer: {roster: [], neighborhood: [], followed: bool};
// algorithm: see above. Returns [{domain, kind, method, tier, pages, indexedAt,
// source, centroid, score, reason}] best first, `never` sites removed.
const rankSites = (qvec, index, local, prefer = {}, algorithm = {}, verdicts = {}) => {
  const q = norm(qvec)
  const w = { ...DEFAULT_WEIGHTS, ...(algorithm.weights || {}) }
  const trust = String(algorithm.trust || 'flaky').toLowerCase()   // solid | flaky | any
  const never = new Set((algorithm.never || []).map(d => d.toLowerCase()))
  const always = new Set((algorithm.always || []).map(d => d.toLowerCase()))
  const learned = algorithm.learned || {}
  const roster = new Set((prefer.roster || []).map(d => d.toLowerCase()))
  const near = new Set((prefer.neighborhood || []).map(d => d.toLowerCase()))
  const wantFollowed = prefer.followed !== false

  const rows = new Map()   // domain → row; the freshest source wins
  const consider = (domain, kind, meta, vector) => {
    const d = domain.toLowerCase()
    if (never.has(d)) return
    const v = verdicts[d]
    if (v && trust !== 'any') {
      if (v.class === 'dead' || v.class === 'lapsed' || v.class === 'moved') {
        if (v.to && !verdicts[v.to]) rows.set(`moved:${d}`, { movedFrom: d, to: v.to })
        return
      }
      if (trust === 'solid' && (v.class === 'unreliable' || v.class === 'flaky')) return
    }
    const fresh = KIND_FRESHNESS[kind] ?? 0.4
    const prev = rows.get(d)
    if (prev && prev.fresh >= fresh) return
    rows.set(d, { domain, kind, fresh, meta, vector })
  }
  if (index) {
    const { dim, matrix, meta } = index
    for (let i = 0; i < meta.length; i++)
      consider(meta[i].domain, meta[i].kind === 'farm' ? 'farm' : 'galaxy', meta[i],
        matrix.subarray(i * dim, (i + 1) * dim))
  }
  for (const s of local || []) consider(s.domain, 'own', s, s.vector)

  const out = []
  const moved = []
  for (const [d, r] of rows) {
    if (r.movedFrom) { moved.push(r); continue }
    const centroid = dot(q, r.vector)
    const m = r.meta || {}
    const reasons = []
    let prefScore = 0
    if (always.has(d))          { prefScore += 2.0;             reasons.push('always') }
    if (roster.has(d))          { prefScore += w.liked;         reasons.push('roster') }
    if (near.has(d))            { prefScore += w.neighbourhood; reasons.push('neighbourhood') }
    if (wantFollowed && m.tier === 'followed') { prefScore += w.followed; reasons.push('followed') }
    if (learned[d] > 0)         { prefScore += w.visited * Math.min(1, learned[d]); reasons.push('learned') }
    const v = verdicts[d]
    const penalty = v ? (VERDICT_PENALTY[v.class] || 0) : 0
    const stale = v ? (STALE_PENALTY[v.class] || 0) : 0
    if (penalty || stale) reasons.push(v.class)
    const score = prefScore + w.centroid * centroid + w.fresh * r.fresh - w.reliable * penalty - w.stale * stale
    out.push({
      domain: r.domain, kind: r.kind, method: m.method || 'pages', tier: m.tier || '',
      pages: m.pages || 0, indexedAt: m.indexedAt || 0, source: m.source || r.kind,
      ...(m.peer ? { placedBy: m.peer } : {}),
      centroid: Number(centroid.toFixed(4)), preferred: prefScore > 0,
      score: Number(score.toFixed(4)), reason: reasons.join('+') || 'centroid',
      ...(v ? { verdict: v.class } : {}),
    })
  }
  // A moved site's destination is searched in its place, marked so
  for (const mv of moved) {
    const row = out.find(r => r.domain.toLowerCase() === mv.to)
    if (row) row.movedFrom = mv.movedFrom
  }
  out.sort((a, b) => b.score - a.score || (b.pages || 0) - (a.pages || 0) ||
    a.domain.localeCompare(b.domain))
  return out
}

// Cut the ordered list into batches: the first holds every preferred site
// (however many), the rest are `size` each — so "what I am near" always
// answers first and in one request.
const batches = (ranked, size = 50) => {
  const out = []
  const preferred = ranked.filter(r => r.preferred)
  const rest = ranked.filter(r => !r.preferred)
  if (preferred.length) out.push(preferred.map(r => r.domain))
  for (let i = 0; i < rest.length; i += size) out.push(rest.slice(i, i + size).map(r => r.domain))
  return out
}

module.exports = { rankSites, batches, DEFAULT_WEIGHTS, KIND_FRESHNESS, VERDICT_PENALTY, STALE_PENALTY }
