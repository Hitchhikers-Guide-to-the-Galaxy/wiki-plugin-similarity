// wiki-plugin-similarity — galactic keyword search (CommonJS)
//
// Fedwiki maintains a serialized MiniSearch index per site: the wiki-server
// updates {domain}/status/site-index.json on every edit. This module READS
// those indexes across every domain on the farm(s) — no index building of any
// kind. On the farm server the files are per-edit fresh because the server
// itself writes them.
//
// The server-built index stores no fields (storedFields is empty), so display
// titles come from each domain's status/sitemap.json.
//
// Loaded indexes are cached per domain and invalidated by file mtime.

const fs   = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const MiniSearch = require('minisearch')
const { listDomains } = require('./farm-lib')

// site-index.json was serialized with these options; loadJSON needs them.
const MS_OPTIONS = { fields: ['title', 'content'] }

const makeId = () => crypto.randomBytes(8).toString('hex')

// ── Per-domain index cache, mtime-invalidated ─────────────────────────────────

const cache = new Map() // domain → {mtime, ms, titles, synopses}

const loadDomainIndex = (farm, domain) => {
  const indexPath = path.join(farm, domain, 'status', 'site-index.json')
  let mtime
  try { mtime = fs.statSync(indexPath).mtimeMs } catch { return null }

  const hit = cache.get(domain)
  if (hit && hit.mtime === mtime) return hit

  let ms
  try {
    ms = MiniSearch.loadJSON(fs.readFileSync(indexPath, 'utf8'), MS_OPTIONS)
  } catch { return null }

  // Titles + synopses from the sitemap (the index stores no fields).
  const titles = new Map()
  const synopses = new Map()
  try {
    const sitemap = JSON.parse(fs.readFileSync(
      path.join(farm, domain, 'status', 'sitemap.json'), 'utf8'))
    for (const p of sitemap) {
      titles.set(p.slug, p.title)
      if (p.synopsis) synopses.set(p.slug, p.synopsis)
    }
  } catch { /* titles fall back to slugs */ }

  const entry = { mtime, ms, titles, synopses }
  cache.set(domain, entry)
  return entry
}

// ── Search across domains ─────────────────────────────────────────────────────

const searchFarm = (farms, patterns, restricted, query, limit, exclude = null) => {
  let domains = listDomains(farms, patterns, restricted, 'status/site-index.json')
  // Peer answers must never carry restricted sites (see peer-guard.js)
  if (exclude) domains = domains.filter(d => !exclude.has(d.domain))
  const results = []
  let searched = 0
  for (const { farm, domain } of domains) {
    const entry = loadDomainIndex(farm, domain)
    if (!entry) continue
    searched += 1
    let hits
    try { hits = entry.ms.search(query, { boost: { title: 2 } }) } catch { continue }
    for (const h of hits) {
      results.push({
        domain,
        slug: String(h.id),
        title: entry.titles.get(String(h.id)) || String(h.id),
        synopsis: entry.synopses.get(String(h.id)) || '',
        score: h.score,
      })
    }
  }
  results.sort((a, b) => b.score - a.score)
  return { results: results.slice(0, limit), searched, matched: results.length }
}

// ── Report page JSON (ghost-page ready, mirrors search-report style) ──────────

const keywordReportPage = (query, { results, searched, matched }, limit, specs) => {
  const story = [{
    type: 'markdown', id: makeId(),
    text: `Keyword search for **${query}** — searched the live site indexes of ` +
      `${searched} domains; ${matched} matches, top ${Math.min(limit, results.length)} shown.\n\n` +
      `<small>Config — domains: ${(specs || ['*']).join(', ')}; limit: ${limit}. ` +
      `Reads each site's own per-edit MiniSearch index (site-index.json) — ` +
      `no separate index is built.</small>`,
  }]

  const seenTitles = new Set()
  const uniqueTitles = results.map(r => r.title).filter(t => {
    if (seenTitles.has(t)) return false
    seenTitles.add(t)
    return true
  })
  if (uniqueTitles.length) {
    story.push({
      type: 'markdown', id: makeId(),
      text: uniqueTitles.map(t => `- [[${t}]]`).join('\n'),
    })
  }

  story.push({ type: 'markdown', id: makeId(), text: '# Results' })
  for (const r of results) {
    story.push({
      type: 'reference', id: makeId(),
      site: r.domain, slug: r.slug, title: r.title,
      text: r.synopsis || `score ${r.score.toFixed(2)}`,
    })
  }
  return { title: `${query} Keyword Search`, story }
}

module.exports = { searchFarm, keywordReportPage }
