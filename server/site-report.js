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
const { loadVectors, dot } = require('./search-report')

const SITE_TOP_K          = 5     // neighbourhood size
const SITE_TOPK_WEIGHT    = 0.7
const SITE_CENTROID_WEIGHT = 0.3
const SITE_FLOOR          = 0.50  // sites whose topK falls below → dropped
const HIT_THRESHOLD       = 0.55  // evidence count, matches search-report's floor
const TOP_PAGES_SHOWN     = 3

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

const buildSiteReport = async (query, specs, limit,
                               { farms, restricted, embed, exclude },
                               format = null) => {
  const useSpecs = specs && specs.length ? specs : ['*']
  const patterns = useSpecs
    .map(s => ['PUBLIC', 'LOCAL', 'PRIVATE'].includes(s.toUpperCase()) ? s.toUpperCase() : s)
  let domains = listDomains(farms, patterns, restricted, 'status/semantic-vectors.json')
  if (exclude) domains = domains.filter(d => !exclude.has(d.domain))
  const qvec = await embed(query)

  let totalPages = 0
  const entries = domains.map(({ farm, domain }) => {
    const pages = loadVectors(farm, domain)
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
  if (format === 'flat') return { query, scanned: stats, sites }
  return siteReportPage(query, sites, stats, limit, useSpecs)
}

module.exports = {
  buildSiteReport, scoreSite, rankSites,
  SITE_TOP_K, SITE_TOPK_WEIGHT, SITE_CENTROID_WEIGHT, SITE_FLOOR, HIT_THRESHOLD,
}
