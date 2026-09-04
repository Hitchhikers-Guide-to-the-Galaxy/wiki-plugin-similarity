// wiki-plugin-similarity — the learning loop, in the browser
//
// A site earns credit when it enters your neighbourhood, when you open a page
// from it, and when you click one of its search results. Scores live in
// localStorage['similarity:learned'] as {sites: {domain: {score, at}}} and
// decay by half every week, so the list follows where you read now. Nothing
// leaves the browser until the reader presses Remember on their Search
// Algorithm page, which writes the top sites into its "Sites I visit" roster
// through an ordinary page save — inspectable, forkable, deletable line by
// line. (Design: search.fedwiki.club/incremental-federated-search, layer three.)

import { LEARNED_KEY } from './algorithm.js'

const CREDIT = { neighbourhood: 0.1, visited: 0.2, clicked: 0.35 }
const HALF_LIFE_MS = 7 * 86_400_000
const MAX_SITES = 200

const load = () => {
  try { return JSON.parse(localStorage.getItem(LEARNED_KEY) || '{}').sites || {} } catch { return {} }
}
const save = sites => {
  try { localStorage.setItem(LEARNED_KEY, JSON.stringify({ sites, savedAt: Date.now() })) } catch { /* private mode */ }
}
const decayed = (entry, now) => {
  const weeks = Math.max(0, (now - (entry.at || now)) / HALF_LIFE_MS)
  return (entry.score || 0) * Math.pow(0.5, weeks)
}

// Credit one site for one kind of signal; returns the new score.
const credit = (domain, kind) => {
  if (!domain || domain === 'localhost') return 0
  const d = domain.toLowerCase()
  const now = Date.now()
  const sites = load()
  const cur = sites[d] ? decayed(sites[d], now) : 0
  const score = Math.min(1, cur + (CREDIT[kind] || 0.1))
  sites[d] = { score, at: now }
  // keep the list bounded: drop the faintest
  const keys = Object.keys(sites)
  if (keys.length > MAX_SITES) {
    keys.sort((a, b) => decayed(sites[b], now) - decayed(sites[a], now))
    for (const k of keys.slice(MAX_SITES)) delete sites[k]
  }
  save(sites)
  return score
}

// Current scores, decayed, best first: [[domain, score], ...]
const learned = () => {
  const now = Date.now()
  return Object.entries(load())
    .map(([d, e]) => [d, decayed(e, now)])
    .filter(([, s]) => s > 0.01)
    .sort((a, b) => b[1] - a[1])
}

const forget = () => save({})

// ── Ambient signals ─────────────────────────────────────────────────────────
// Installed once per page load by the first similarity item that binds:
// every site already in the lineup gets neighbourhood credit, and every page
// that later joins the lineup credits its site as visited. Wiki adds pages
// as .page divs under .main, so a MutationObserver is the hook.

let installed = false
const siteOf = el => {
  try { return (window.$ && window.$(el).data('site')) || window.location.hostname } catch { return window.location.hostname }
}
const installAmbient = () => {
  if (installed || typeof document === 'undefined') return
  installed = true
  const seen = new Set()
  document.querySelectorAll('.main > .page').forEach(p => {
    const site = siteOf(p)
    if (!seen.has(site)) { seen.add(site); credit(site, 'neighbourhood') }
  })
  const main = document.querySelector('.main')
  if (!main || typeof MutationObserver === 'undefined') return
  new MutationObserver(muts => {
    for (const m of muts) for (const node of m.addedNodes) {
      if (node.nodeType === 1 && node.classList.contains('page') && !node.classList.contains('ghost')) {
        credit(siteOf(node), 'visited')
      }
    }
  }).observe(main, { childList: true })
}

// ── Remember: write the learned sites into the page's roster ────────────────
// $page is the jQuery page div holding the Search Algorithm; the roster whose
// first line is "Sites I visit" is replaced in place through the standard
// page action, so the change is journaled like any edit. Resolves to the
// number of sites written, or throws when the page cannot be saved here.

const rememberInto = ($page, limit = 20) => new Promise((resolve, reject) => {
  const data = $page.data('data') || {}
  const item = (data.story || []).find(i => i.type === 'roster' && /^\s*sites i visit\b/i.test(i.text || ''))
  if (!item) return reject(new Error('no "Sites I visit" roster on this page'))
  const top = learned().slice(0, limit)
  if (!top.length) return reject(new Error('nothing learned yet'))
  const text = ['Sites I visit', ...top.map(([d]) => d)].join('\n')
  const updated = { ...item, text }
  try {
    window.wiki.pageHandler.put($page, { type: 'edit', id: item.id, item: updated })
    // reflect the edit in the rendered item without a reload
    const $item = $page.find(`.item[data-id="${item.id}"]`)
    if ($item.length) { $item.data('item', updated); window.wiki.plugins?.roster?.emit?.($item, updated) }
    resolve(top.length)
  } catch (e) { reject(e) }
})

export { credit, learned, forget, installAmbient, rememberInto, CREDIT }
