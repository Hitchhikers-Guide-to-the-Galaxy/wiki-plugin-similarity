// wiki-plugin-similarity — following a moved site (Dead Sites Plan, Phase 3)
//
// A result whose site the Semantic Site Graveyard calls dead, lapsed or
// moved is rewritten to where the site went when that site holds the same
// slug, and labelled otherwise — so a reader who searches with TRUST any,
// or a stale peer's answer, still lands on a living page.
//
//   verdicts  {domain: {class, to}} from site-index.js loadVerdicts()
//   hasSlug   (domain, slug) => boolean — does the destination hold the page

const GONE = new Set(['dead', 'lapsed', 'moved'])

// results: [{site, slug, title, ...}] as buildReportFlat returns them
const followMoves = (results, verdicts, hasSlug) => {
  let rewritten = 0, labelled = 0
  for (const r of results) {
    const v = verdicts[(r.site || '').toLowerCase()]
    if (!v || !GONE.has(v.class)) continue
    if (v.to && hasSlug(v.to, r.slug)) {
      r.movedFrom = r.site
      r.site = v.to
      rewritten += 1
    } else {
      r.gone = v.class
      if (v.to) r.movedTo = v.to
      labelled += 1
    }
  }
  return { rewritten, labelled }
}

// The page form: reference items carry site/slug/text
const followMovesOnPage = (page, verdicts, hasSlug) => {
  const refs = (page.story || []).filter(i => i.type === 'reference')
  const out = followMoves(refs, verdicts, hasSlug)
  for (const r of refs) {
    if (r.movedFrom) r.text = `${r.text || ''} — was on ${r.movedFrom}, now here`.trim()
    else if (r.gone) r.text = `${r.text || ''} — site ${r.gone}${r.movedTo ? `, probably moved to ${r.movedTo}` : ''}`.trim()
  }
  return out
}

module.exports = { followMoves, followMovesOnPage, GONE }
