// wiki-plugin-similarity — incremental federated search, client side
//
// Rank the sites first, then search them a batch at a time, merging results
// in place until the answer stops changing (design: search.fedwiki.club
// /incremental-federated-search).
//
//   1. POST site-rank.json  — every site the farm knows, ordered for this
//      query: preferred sites (roster, neighbourhood, followed, the reader's
//      algorithm) first, then by centroid similarity. Returns the batches.
//   2. POST search-report.json {flat: true, domains: batch} per batch — the
//      ordinary report pipeline over an explicit domain list; scores are
//      comparable across batches because every site shares one model.
//   3. Merge by score, render in the item as each batch lands, stop when
//      QUIET consecutive batches change nothing in the top `limit`, and
//      offer the rest behind a button.

const QUIET = 3

const neighbourhoodDomains = () => {
  const out = new Set()
  try {
    for (const site of Object.keys(window.wiki?.neighborhood || {})) out.add(site)
    document.querySelectorAll('.page').forEach(p => {
      const site = window.$ ? window.$(p).data('site') : null
      out.add(site || window.location.hostname)
    })
  } catch { /* no lineup to read */ }
  return [...out]
}

const post = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = new Error(`${url.split('/').pop()} failed: ${res.status}`)
    err.status = res.status
    err.body = await res.json().catch(() => ({}))
    throw err
  }
  return res.json()
}

const sameTop = (a, b, limit) => {
  const ka = a.slice(0, limit).map(r => `${r.site} ${r.slug}`).join('|')
  const kb = b.slice(0, limit).map(r => `${r.site} ${r.slug}`).join('|')
  return ka === kb
}

// opts: {origin, query, seeded, specs, limit, threshold, thresholdSet, batch,
//        roster, algorithm, prefer, render(results, state), status(text)}
// Returns the final merged results; runs until done, stopped, or converged.
const runBatched = async opts => {
  const { origin, query, seeded = {}, specs, limit, batch, algorithm, render } = opts
  const say = t => opts.status && opts.status(t)
  const prefer = {
    roster: [...(opts.roster || []), ...((algorithm && algorithm.liked) || [])],
    neighborhood: neighbourhoodDomains(),
    followed: true,
    ...(opts.prefer || {}),
  }
  say('Ranking sites…')
  const rank = await post(`${origin}/system/site-rank.json`, {
    query, ...seeded, domains: specs, prefer, algorithm: algorithm || {}, batch: batch || 50,
  })
  const batches = rank.batches || []
  // A domain named explicitly is searched whether or not this farm's Site
  // Index knows it: the cascade finds the peer that holds it. Unranked
  // explicit domains go last, as one more batch.
  const ranked = new Set(batches.flat().map(d => d.toLowerCase()))
  const explicit = (specs || []).filter(sp => typeof sp === 'string' && /\./.test(sp) &&
    !/[*?]/.test(sp) && !['PUBLIC', 'LOCAL', 'PRIVATE', 'GALAXY'].includes(sp.toUpperCase()) &&
    !ranked.has(sp.toLowerCase()))
  if (explicit.length) batches.push(explicit)
  const total = (rank.count || 0) + explicit.length || batches.reduce((n, b) => n + b.length, 0)
  const state = { searched: 0, total, batches: batches.length, done: 0, stopped: false,
                  converged: false, running: true, unindexed: rank.unindexed || [],
                  // who answered: this farm and each peer, by sites searched
                  answered: { local: 0 }, siteIndex: rank.siteIndex || null,
                  // what the Site Index says of each site: when it was indexed, by whom
                  siteInfo: new Map((rank.sites || []).map(r => [r.domain, r])) }

  const merged = new Map()
  let results = []
  let quiet = 0
  const stop = () => { state.stopped = true }
  state.stop = stop

  const runBatch = async domains => {
    const body = { query, ...seeded, domains, limit: Math.max(limit * 3, 30), flat: true }
    if (opts.thresholdSet) body.threshold = opts.threshold
    const flat = await post(`${origin}/system/search-report.json`, body)
    for (const r of flat.results || []) {
      const key = `${r.site} ${r.slug}`
      const prev = merged.get(key)
      if (!prev || prev.score < r.score) merged.set(key, r)
    }
    let peerDomains = 0
    for (const p of flat.peers || []) {
      state.answered[p.host] = (state.answered[p.host] || 0) + (p.domains || 0)
      peerDomains += p.domains || 0
    }
    state.answered.local += Math.max(0, ((flat.stats && flat.stats.domains) || 0) - peerDomains)
    const next = [...merged.values()].sort((a, b) => b.score - a.score)
    const unchanged = sameTop(results, next, limit)
    results = next
    state.searched += domains.length
    state.done += 1
    quiet = unchanged ? quiet + 1 : 0
  }

  const remaining = () => batches.slice(state.done)
  const loop = async (all = false) => {
    state.running = true
    state.stopped = false
    while (state.done < batches.length && !state.stopped) {
      await runBatch(batches[state.done])
      render(results, state)
      if (!all && quiet >= QUIET && state.done < batches.length) {
        state.converged = true
        break
      }
    }
    state.running = false
    render(results, state)
    return results
  }
  state.continueAll = () => { state.converged = false; quiet = -Infinity; return loop(true) }

  await loop(false)
  return { results, state, remaining }
}

export { runBatched, neighbourhoodDomains, QUIET }
