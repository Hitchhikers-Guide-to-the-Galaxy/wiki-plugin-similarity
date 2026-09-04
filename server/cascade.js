// wiki-plugin-similarity — the cascade beyond the first peer (CommonJS)
//
// A flat report names explicit domains. The ones this farm holds no vectors
// for are asked of its peers IN ORDER — each peer gets only what is still
// missing after the peers before it answered — and each answer says which
// domains it held, so the walk moves on with the rest. Two hops at most, and
// a host already in the chain is never asked again, so two farms that name
// each other as peers cannot bounce a question between them for ever.
//
//   Cafe → Pi5 (hitchhiker.fm) → mini (david.mini.private.fish)
//
// is the shape the Mini Indexer Plan builds: the Cafe names only the Pi5, the
// Pi5 names the mini after itself, and a site only the mini has indexed is
// still answered from plan.ide.earth — marked `via` the host that had it.

const MAX_HOPS = 2

const hostOf = peer => {
  try { return new URL(peer).host } catch { return null }
}

// peers: ['https://host', …] in preference order; missing: domains still
// unanswered; body: the flat request as received; hops/via: the chain so far;
// post(host, path, body, timeoutMs) → {status, body}. Returns
// {results[], peers[{host, domains, pages}], errors[], missing[]}.
const askCascade = async ({ peers, missing, body, hops = 0, via = [], post, timeoutMs = 20_000 }) => {
  const out = { results: [], peers: [], errors: [], missing: [...missing] }
  if (!missing.length || hops >= MAX_HOPS) return out
  const asked = new Set(via.map(h => String(h).toLowerCase()))
  for (const peer of peers || []) {
    if (!out.missing.length) break
    const host = hostOf(peer)
    if (!host || asked.has(host.toLowerCase())) continue
    asked.add(host.toLowerCase())
    const ask = out.missing
    try {
      const ans = await post(host, '/system/search-report.json', {
        ...body, domains: ask, hops: hops + 1, via: [...asked], farms: undefined, noPeers: undefined,
      }, timeoutMs)
      if (ans.status !== 200 || !Array.isArray(ans.body?.results)) {
        out.errors.push(`${host}: ${ans.body?.error || `status ${ans.status}`}`)
        continue
      }
      for (const r of ans.body.results) out.results.push({ ...r, via: r.via || host })
      // A peer's stats include what its own peers answered; count those
      // under the host that really held them, not twice.
      const s = ans.body.stats || {}
      const nested = ans.body.peers || []
      const nestedDomains = nested.reduce((n, p) => n + (p.domains || 0), 0)
      const nestedPages = nested.reduce((n, p) => n + (p.pages || 0), 0)
      out.peers.push({ host, domains: Math.max(0, (s.domains || 0) - nestedDomains),
                       pages: Math.max(0, (s.pages || 0) - nestedPages) })
      for (const p of nested) out.peers.push(p)   // what it asked in turn
      // A peer that says what it held lets the walk go on with the rest; an
      // older peer that does not is taken to have answered for everything.
      const held = Array.isArray(ans.body.held) ? new Set(ans.body.held) : null
      out.missing = held ? ask.filter(d => !held.has(d)) : []
    } catch (e) {
      out.errors.push(`${host}: ${e.message}`)
    }
  }
  return out
}

module.exports = { askCascade, MAX_HOPS, hostOf }
