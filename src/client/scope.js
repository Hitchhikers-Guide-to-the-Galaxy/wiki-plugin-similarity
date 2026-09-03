// wiki-plugin-similarity — turning DSL specs into a concrete list of domains
// Split out of similarity.js; see the Splitting the Server phase of the plan.

import { isGlob, isScope } from './dsl.js'

// ── Slug ──────────────────────────────────────────────────────────────────────

const slugify = title => title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

// ── Domain resolution ─────────────────────────────────────────────────────────

const domainCache = new Map()

const resolveDomainsForSpec = async (spec, origin) => {
  if (domainCache.has(spec)) return domainCache.get(spec)
  const url = `${origin}/system/indexed-domains.json?pattern=${encodeURIComponent(spec)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`indexed-domains failed: ${res.status}`)
  const list = await res.json()
  domainCache.set(spec, list)
  return list
}

const resolveDomains = async (specs, origin) => {
  if (!specs.length) specs = [window.location.hostname]
  const seen = new Set()
  const result = []
  for (const spec of specs) {
    if (spec === '*' || isGlob(spec) || isScope(spec)) {
      for (const item of await resolveDomainsForSpec(spec, origin)) {
        if (!seen.has(item.domain)) { seen.add(item.domain); result.push(item) }
      }
    } else if (!seen.has(spec)) {
      seen.add(spec); result.push({ domain: spec, page_count: null })
    }
  }
  return result
}

// ── Roster resolution ─────────────────────────────────────────────────────────
// ROSTER site/slug resolves a roster page into domain names, following the
// roster plugin's own line semantics: bare domains are sites; category and
// blank lines are skipped; nested `ROSTER site/slug` includes another roster
// page; `REFERENCES site/slug` collects the .site of a page's reference items.
// Includes are followed transitively with a visited-set loop guard.

const SITE_LINE    = /^([a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+|localhost)(:\d+)?$/
const ROSTER_LINE  = /^ROSTER ([A-Za-z0-9.\-:]+\/[a-z0-9-]+)$/
const REFS_LINE    = /^REFERENCES ([A-Za-z0-9.\-:]+\/[a-z0-9-]+)$/

const fetchPage = async ref => {                 // ref = site/slug
  const i = ref.indexOf('/')
  const res = await fetch(`//${ref.slice(0, i)}/${ref.slice(i + 1)}.json`)
  if (!res.ok) throw new Error(`roster page ${ref} failed: ${res.status}`)
  return res.json()
}

const resolveRoster = async (ref, out, visited) => {
  if (visited.has(ref)) return
  visited.add(ref)
  let page
  try { page = await fetchPage(ref) } catch (e) { console.warn(e.message); return }
  for (const item of page.story || []) {
    if (item.type !== 'roster') continue
    for (const raw of (item.text || '').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line) continue
      const site = line.match(SITE_LINE)
      if (site) { out.add(site[0]); continue }
      const nested = line.match(ROSTER_LINE)
      if (nested) { await resolveRoster(nested[1], out, visited); continue }
      const refs = line.match(REFS_LINE)
      if (refs) {
        try {
          const refPage = await fetchPage(refs[1])
          for (const it of refPage.story || []) {
            if (it.type === 'reference' && it.site) out.add(it.site)
          }
        } catch (e) { console.warn(e.message) }
      }
      // anything else is a category name — skipped
    }
  }
}

const resolveRosters = async rosterRefs => {
  const out = new Set()
  const visited = new Set()
  for (const ref of rosterRefs) await resolveRoster(ref, out, visited)
  return [...out]
}

// Effective specs: DSL specs plus any domains contributed by ROSTER lines.
//
// SITE expands to the domain the page is being served from. A page shipped to
// every site in the farm — a plugin's utility page — cannot name its own home,
// and leaving the scope empty means the whole farm in the report modes. SITE
// is how such a page says "search here" and means it wherever it lands.
const effectiveSpecs = async (specs, rosterRefs) => {
  const here = (typeof window !== 'undefined' && window.location)
    ? window.location.hostname : null
  const expanded = specs.map(s => (s.toUpperCase() === 'SITE' && here ? here : s))
  return rosterRefs.length ? [...expanded, ...await resolveRosters(rosterRefs)] : expanded
}

export { slugify, resolveDomains, resolveRosters, effectiveSpecs, SITE_LINE, ROSTER_LINE, REFS_LINE }
