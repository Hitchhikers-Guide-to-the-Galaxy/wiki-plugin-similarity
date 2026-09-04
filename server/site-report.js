// wiki-plugin-similarity — site-report pipeline (CommonJS)
//
// Answers the placement question: "which SITE should this page go on?" — the
// site-level complement of search-report.js. Same per-page vector scan, but
// aggregated per domain instead of ranked globally. Deliberately different
// from search-report: no candidate truncation and no fork-bundling, because a
// page twinned on three sites is placement evidence for all three.
//
// Site score, for query vector q and a site's page vectors p_1..p_N:
//   topK     mean of the top min(SITE_TOP_K, N) of dot(q, p_i)
//            — "does this site already have a neighbourhood on the topic";
//            min(·, N) keeps a 2-page niche site fair against a 500-page one
//   centroid dot(q, normalize(mean(p_i)))
//            — a focused site's centroid stays close to its pages, a broad
//            person-pod's is diluted; prefers topical clusters, free to
//            compute in the same pass
//   score    SITE_TOPK_WEIGHT * topK + SITE_CENTROID_WEIGHT * centroid
//
// Query text should be a title + first paragraphs, not a whole page — the
// BGE-small embedder truncates around 512 tokens.

const fs     = require('node:fs')
const path   = require('node:path')
const crypto = require('node:crypto')

const { listDomains } = require('./farm-lib')
const { loadSiteIndex } = require('./site-index')
const { rankSites: rankByCentroid } = require('./site-rank')
const { loadVectors, dot, seedVector } = require('./search-report')

const SITE_TOP_K          = 5     // neighbourhood size
const SITE_TOPK_WEIGHT    = 0.7
const SITE_CENTROID_WEIGHT = 0.3
const SITE_FLOOR          = 0.50  // sites whose topK falls below → dropped
const HIT_THRESHOLD       = 0.55  // evidence count, matches search-report's floor
const TOP_PAGES_SHOWN     = 3

// Resource selection for the federation. Answering "which SITE" by reading
// every page vector of every site means 104,000 reads to rank a few hundred
// things — and beyond our own farm those are other people's wikis (see the
// Polite Index Plan). With the Site Index there is one stored vector per site,
// so the field can be narrowed before any page is touched. Only the strongest
// sites are then read in full, because the evidence a placement answer shows —
// topK, hits, the pages themselves — still needs real pages.
//
// Farm scope is left alone: it is ours, it is bounded, and a diluted centroid
// on a broad person-pod should not hide a site we own.
const PRESELECT_MIN_DOMAINS = 120  // below this, scanning everything is cheap
// Wide enough that a site whose pages answer well is not lost because its
// centroid is diluted: on the pattern-language query the true top five sat at
// centroid ranks 1, 3, 26, 104 and 108, so a narrow field would have dropped
// two of them. 250 of 1,385 keeps the answer and still skips three quarters.
const PRESELECT_KEEP        = 250  // sites read in full afterwards

const makeId = () => crypto.randomBytes(8).toString('hex')

// ── Scoring — one pass per site over vectors already in memory ───────────────

const scoreSite = (qvec, pages) => {
  const sum = new Float64Array(qvec.length)
  const sims = []
  for (const page of pages) {
    sims.push({ slug: page.slug, title: page.title, sim: dot(qvec, page.vector) })
    const v = page.vector
    for (let i = 0; i < sum.length; i++) sum[i] += v[i]
  }
  sims.sort((a, b) => b.sim - a.sim)

  const k = Math.min(SITE_TOP_K, sims.length)
  let topk = 0
  for (let i = 0; i < k; i++) topk += sims[i].sim
  topk = k ? topk / k : 0

  let norm = 0
  for (let i = 0; i < sum.length; i++) norm += sum[i] * sum[i]
  norm = Math.sqrt(norm)
  const centroid = norm > 0 ? dot(qvec, sum) / norm : 0

  return {
    score: SITE_TOPK_WEIGHT * topk + SITE_CENTROID_WEIGHT * centroid,
    topk,
    centroid,
    hits: sims.filter(s => s.sim >= HIT_THRESHOLD).length,
    topPages: sims.slice(0, TOP_PAGES_SHOWN),
  }
}

// Pure ranking over loaded sites — separable from fs for testing.
// siteEntries: [{domain, page_count, pages: [{slug, title, vector}], ...extra}]
const rankSites = (qvec, siteEntries) =>
  siteEntries
    .filter(e => e.pages.length)
    .map(e => ({ ...e, ...scoreSite(qvec, e.pages), pages: undefined }))
    .filter(e => e.topk >= SITE_FLOOR)
    .sort((a, b) => b.score - a.score)

// ── Owner lookup — only for the sites that make the report ───────────────────

const ownerName = (farm, domain) => {
  try {
    const owner = JSON.parse(fs.readFileSync(
      path.join(farm, domain, 'status', 'owner.json'), 'utf8'))
    return owner.name || null
  } catch { return null }
}

// ── Report page ───────────────────────────────────────────────────────────────

const evidenceLine = site => {
  const tops = site.top_pages.map(p => p.title).join(' · ')
  return `score ${site.score.toFixed(3)}` +
    (site.owner ? ` — owner ${site.owner}` : '') +
    ` — ${site.hits} page${site.hits === 1 ? '' : 's'} ≥ ${HIT_THRESHOLD}` +
    ` of ${site.page_count} — top: ${tops}`
}

const siteReportPage = (query, sites, stats, limit, specs) => {
  const story = [{
    type: 'markdown', id: makeId(),
    text: `Site report for **${query}** — scanned ${stats.pages.toLocaleString()} pages ` +
      `across ${stats.domains} domains; ${stats.above_floor} sites above the floor.\n\n` +
      `<small>Config — domains: ${specs.join(', ')}; limit: ${limit}; ` +
      `site floor: ${SITE_FLOOR} (mean of top ${SITE_TOP_K} page similarities).</small>`,
  }]

  story.push({ type: 'markdown', id: makeId(), text: '# Results' })
  for (const site of sites) {
    story.push({
      type: 'reference', id: makeId(),
      site: site.domain, slug: 'welcome-visitors', title: site.domain,
      text: evidenceLine(site),
    })
  }
  if (!sites.length) {
    story.push({
      type: 'markdown', id: makeId(),
      text: `No site clears the floor — nowhere on the farm has a page ` +
        `neighbourhood for this topic yet. A new site may be the answer.`,
    })
  }

  story.push({
    type: 'markdown', id: makeId(),
    text: `# Scoring\n\nSite score = ${SITE_TOPK_WEIGHT} × mean of the top ` +
      `${SITE_TOP_K} page similarities + ${SITE_CENTROID_WEIGHT} × similarity to the ` +
      `site centroid. The neighbourhood term finds sites that already hold pages ` +
      `on the topic; the centroid term prefers focused topical sites over large ` +
      `mixed ones. Forked pages count for every site that carries them.`,
  })
  return { title: `${query} Site Report`, story }
}

// ── Entry point ───────────────────────────────────────────────────────────────
// Same context shape as buildReport: farms [[root, kind], ...], restricted
// Set, embed async text → number[], optional exclude Set.
// seedOpts: {vector, seed: {site, slug}, text, excludePage: {site, slug}} —
// same precedence as buildReport (see search-report.js seedVector). For a
// placement question about an EXISTING page, excludePage drops that page's
// own vector from its home site's scoring — otherwise the site it already
// sits on wins on the strength of the page itself.

const buildSiteReport = async (query, specs, limit,
                               { farms, restricted, embed, exclude },
                               format = null, seedOpts = {}) => {
  const useSpecs = specs && specs.length ? specs : ['*']
  const patterns = useSpecs
    .map(s => ['PUBLIC', 'LOCAL', 'PRIVATE'].includes(s.toUpperCase()) ? s.toUpperCase() : s)
  let domains = listDomains(farms, patterns, restricted, 'status/semantic-vectors.json')
  if (exclude) domains = domains.filter(d => !exclude.has(d.domain))
  const qvec = await seedVector(seedOpts, query, farms, embed)

  // Narrow by stored site vector before reading any pages.
  const reachesGalaxy = useSpecs.some(s2 => String(s2).toUpperCase() === 'GALAXY')
  let considered = null
  if (reachesGalaxy && domains.length > PRESELECT_MIN_DOMAINS) {
    // farms is [[rootPath, kind], …]; the galaxy tree is the one kind 'galaxy'.
    const galaxyDir = (farms.find(([, kind]) => kind === 'galaxy') || [])[0] || null
    const index = loadSiteIndex(galaxyDir)
    if (index) {
      // Centroid alone. rankSites also carries the reader's preferences — the
      // followed tier, rosters, learned scores — which is right for deciding
      // what to search first for a person, and wrong here: "which site should
      // this page live on" is not a question about whose wikis you like. Left
      // personalised, a followed-tier bonus of 0.2 swamped centroid gaps and
      // pushed the second-best site (0.890) out of the field while pulling in
      // one ranked #108. Weights zeroed so only topical fit orders the field.
      const OBJECTIVE = { weights: { liked: 0, visited: 0, neighbourhood: 0,
                                     followed: 0, centroid: 1, fresh: 0 } }
      const order = new Map(
        rankByCentroid(qvec, index, [], {}, OBJECTIVE).map((r, i) => [r.domain, i]))
      const known = domains.filter(d => order.has(d.domain))
      // A site the index has not caught up with is not silently dropped; it
      // keeps its place behind the ranked ones rather than losing its turn.
      const unknown = domains.filter(d => !order.has(d.domain))
      known.sort((a, b) => order.get(a.domain) - order.get(b.domain))
      considered = domains.length
      domains = known.concat(unknown).slice(0, PRESELECT_KEEP)
    }
  }

  const ex = seedOpts.excludePage
  let totalPages = 0
  const entries = domains.map(({ farm, domain }) => {
    let pages = loadVectors(farm, domain)
    if (ex && ex.slug && domain === ex.site)
      pages = pages.filter(p => p.slug !== ex.slug)
    totalPages += pages.length
    return { farm, domain, page_count: pages.length, pages }
  })

  const ranked = rankSites(qvec, entries)
  const sites = ranked.slice(0, limit).map(site => ({
    domain: site.domain,
    page_count: site.page_count,
    owner: ownerName(site.farm, site.domain),
    score: Number(site.score.toFixed(4)),
    topk: Number(site.topk.toFixed(4)),
    centroid: Number(site.centroid.toFixed(4)),
    hits: site.hits,
    top_pages: site.topPages.map(p =>
      ({ slug: p.slug, title: p.title, score: Number(p.sim.toFixed(4)) })),
  }))

  const stats = { domains: domains.length, pages: totalPages, above_floor: ranked.length }
  // Say so when most of the field was judged on its site vector alone.
  if (considered !== null) { stats.considered = considered; stats.preselected = true }
  if (format === 'flat') return { query, scanned: stats, sites }
  return siteReportPage(query, sites, stats, limit, useSpecs)
}

module.exports = {
  buildSiteReport, scoreSite, rankSites,
  SITE_TOP_K, SITE_TOPK_WEIGHT, SITE_CENTROID_WEIGHT, SITE_FLOOR, HIT_THRESHOLD,
}
