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
//
// Keep your place (Personal Search Plan, Phase 1): what is on screen stays
// where it is while batches land. `shown` is the list the reader sees, in
// the order it was first drawn; `merged` is everything found, best first.
// A result that now ranks inside the top `limit` but is not on screen is
// counted as pending, announced, and folded in only on request — and an
// opened result keeps its position even then, so the list stays a map back
// to where the reader was. A snapshot of the run is handed to the item
// after every render, so it can draw itself again later and carry on.

const QUIET = 3
const DEFAULT_BATCH = 100   // answers in well under a second on a Pi over a tailnet (measured 5 September 2026)
const KEEP = 150            // merged results remembered per item

const keyOf = r => `${r.site} ${r.slug}`

const pendingAbove = (shown, merged, limit) => {
  const have = new Set(shown.map(keyOf))
  return merged.slice(0, limit).filter(r => !have.has(keyOf(r))).length
}

// Redraw the list from the merged order, but leave every opened result in
// the position it had — the reader found it there.
const foldIn = (shown, merged, limit, opened) => {
  const held = new Map()   // position → opened result
  shown.forEach((r, i) => { if (opened.has(keyOf(r))) held.set(i, r) })
  const heldKeys = new Set([...held.values()].map(keyOf))
  const rest = merged.filter(r => !heldKeys.has(keyOf(r)))
  const out = []
  let i = 0
  const size = Math.max(limit, held.size ? Math.max(...held.keys()) + 1 : 0)
  for (let pos = 0; pos < size; pos++) {
    if (held.has(pos)) out.push(held.get(pos))
    else if (i < rest.length) out.push(rest[i++])
  }
  return out
}

// Refresh shown entries from the merged list (siblings, moved flags) without moving them
const refreshShown = (shown, merged) => {
  const byKey = new Map(merged.map(r => [keyOf(r), r]))
  return shown.map(r => byKey.get(keyOf(r)) || r)
}

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
  const ka = a.slice(0, limit).map(keyOf).join('|')
  const kb = b.slice(0, limit).map(keyOf).join('|')
  return ka === kb
}

// opts: {origin, query, seeded, specs, limit, threshold, thresholdSet, batch,
//        roster, algorithm, prefer, render(results, state), status(text),
//        resume: a snapshot() from an earlier run, to continue without re-ranking,
//        save(snapshot): called after every render so the item can remember}
// Returns the final merged results; runs until done, stopped, or converged.
const runBatched = async opts => {
  const { origin, query, seeded = {}, specs, limit, batch, algorithm, render, resume } = opts
  const say = t => opts.status && opts.status(t)
  let rank
  if (resume && Array.isArray(resume.remaining)) {
    rank = { batches: resume.remaining, count: resume.total, sites: resume.sites || [],
             siteIndex: resume.siteIndex || null, unindexed: resume.unindexed || [] }
  } else {
    const prefer = {
      roster: [...(opts.roster || []), ...((algorithm && algorithm.liked) || [])],
      neighborhood: neighbourhoodDomains(),
      followed: true,
      ...(opts.prefer || {}),
    }
    say('Ranking sites…')
    rank = await post(`${origin}/system/site-rank.json`, {
      query, ...seeded, domains: specs, prefer, algorithm: algorithm || {}, batch: batch || DEFAULT_BATCH,
    })
  }
  const batches = rank.batches || []
  const total = rank.count || batches.reduce((n, b) => n + b.length, 0)
  const state = { searched: resume?.searched || 0, total, batches: batches.length, done: 0, stopped: false,
                  converged: false, running: true, unindexed: rank.unindexed || [],
                  // who answered: this farm and each peer, by sites searched
                  answered: resume?.answered || { local: 0 }, siteIndex: rank.siteIndex || null,
                  // what the Site Index says of each site: when it was indexed, by whom
                  siteInfo: new Map((rank.sites || []).map(r => [r.domain, r])),
                  // keep your place: the list as drawn, what ranks above it unseen, what was opened
                  shown: resume?.shown || [], pending: 0, opened: new Set(resume?.opened || []),
                  resumed: !!resume }

  const merged = new Map((resume?.merged || []).map(r => [keyOf(r), r]))
  let results = [...merged.values()].sort((a, b) => b.score - a.score)
  let quiet = 0
  const stop = () => { state.stopped = true }
  state.stop = stop
  const remember = () => { try { opts.save && opts.save(state.snapshot()) } catch { /* nothing to remember into */ } }
  state.foldIn = () => {
    state.shown = foldIn(state.shown, results, limit, state.opened)
    state.pending = 0
    render(results, state)
    remember()
  }
  state.markOpened = key => {
    state.opened.add(key)
    render(results, state)
    remember()
  }
  // what an item needs to draw itself again later, and to carry on
  state.snapshot = () => ({
    query, total, searched: state.searched, converged: state.converged, stopped: state.stopped,
    merged: results.slice(0, KEEP), shown: state.shown, opened: [...state.opened],
    remaining: batches.slice(state.done), answered: state.answered, siteIndex: state.siteIndex,
    unindexed: state.unindexed, sites: [...state.siteInfo.values()].slice(0, 400),
  })

  const runBatch = async domains => {
    const body = { query, ...seeded, domains, limit: Math.max(limit * 3, 30), flat: true }
    if (opts.thresholdSet) body.threshold = opts.threshold
    const flat = await post(`${origin}/system/search-report.json`, body)
    for (const r of flat.results || []) {
      const key = keyOf(r)
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
    // keep your place: draw the first list, then only refresh what is shown
    if (!state.shown.length) state.shown = next.slice(0, limit)
    else state.shown = refreshShown(state.shown, next)
    state.pending = pendingAbove(state.shown, next, limit)
  }

  const remaining = () => batches.slice(state.done)
  const loop = async (all = false) => {
    state.running = true
    state.stopped = false
    while (state.done < batches.length && !state.stopped) {
      await runBatch(batches[state.done])
      render(results, state)
      remember()
      if (!all && quiet >= QUIET && state.done < batches.length) {
        state.converged = true
        break
      }
    }
    state.running = false
    render(results, state)
    remember()
    return results
  }
  state.continueAll = () => { state.converged = false; quiet = -Infinity; return loop(true) }

  if (resume && resume.remaining && !resume.remaining.length) {
    // nothing left to search: draw what was remembered and stand still
    state.running = false
    state.converged = !!resume.converged
    render(results, state)
    return { results, state, remaining }
  }
  await loop(false)
  return { results, state, remaining }
}

export { runBatched, neighbourhoodDomains, QUIET, DEFAULT_BATCH, keyOf, pendingAbove, foldIn, refreshShown }
