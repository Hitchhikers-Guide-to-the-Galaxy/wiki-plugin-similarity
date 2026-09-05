// wiki-plugin-similarity — the item's line-oriented DSL: parse it, and classify a spec
// Split out of similarity.js; see the Splitting the Server phase of the plan.

// ── DSL Parser ────────────────────────────────────────────────────────────────

const SIMILAR_THRESHOLDS = { high: 0.78, medium: 0.68, low: 0.58 }
const DEFAULT_THRESHOLD  = SIMILAR_THRESHOLDS.medium
const DEFAULT_LIMIT      = 10

// parseDSL returns { mode, specs, threshold, limit, ... }
//
// mode: 'algorithm' if ALGORITHM is the first meaningful line — the item IS
//        the reader's search algorithm (weights and rules, see algorithm.js);
//        elsewhere in an item, ALGORITHM site/slug names the page to read one from;
//       'status' if STATUS is present — the state of the index behind the answers;
//       'similar' if SIMILAR: is the first meaningful line (ambient auto-run),
//        'search'  otherwise (interactive search form).
//
// Ward's convention: ALL-CAPS keyword as first word signals a mode switch.
// Placing SIMILAR: first makes the item ambient; placing domain specs first
// (or leaving text empty) keeps it as an interactive search form.

const parseDSL = text => {
  const specs   = []
  const rosterRefs = []     // ROSTER site/slug — roster pages whose sites join the scope
  const farms   = []        // FARM domain — peer farms asked to continue the search
  let threshold = null
  let limit     = null
  let mode      = 'search'  // default: interactive search form
  let live      = false     // default: cache results in localStorage
  let subject   = false     // SUBJECT modifier: act on the previous lineup page
  let force     = false     // BUILD mode: re-embed even when index is fresh
  let ghostUrl  = null      // GHOST mode: page-json URL to open as a ghost page
  let label     = null      // BUTTON: custom button caption (GHOST / BUILD modes)
  let batch     = null      // BATCH n: search sites n at a time, widening (0 = off)
  let algorithm = null      // ALGORITHM site/slug or [[Page]]: the reader's Search Algorithm page
  let auto      = false     // AUTO: run as soon as the item has a query (a SUBJECT title, say) — no button press

  // Match a keyword at the start of a line (case-insensitive), requiring it to
  // be followed by end-of-string, whitespace, or colon — not by more word chars.
  // This prevents domain specs like "similarity.example.com" matching SIMILAR.
  const isCmd  = (upper, kw) => upper === kw || (upper.startsWith(kw) && /^[\s:]/.test(upper.slice(kw.length)))
  // Extract the value after the keyword, tolerating optional colon and whitespace.
  // Returns '' for bare commands (e.g. "SIMILAR" alone), callers use their default.
  const val    = (line, kw) => line.slice(kw.length).replace(/^\s*:?\s*/, '').trim()

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const upper = line.toUpperCase()
    if (isCmd(upper, 'LIVE'))  { live = true; continue }
    if (isCmd(upper, 'AUTO'))  { auto = true; continue }
    if (isCmd(upper, 'SUBJECT')) { subject = true; continue }
    if (isCmd(upper, 'AUTHOR')) {
      if (!specs.length && mode === 'search') mode = 'author'
      continue
    }
    if (isCmd(upper, 'REPORT')) {
      if (mode === 'search') mode = 'report'
      continue
    }
    if (isCmd(upper, 'KEYWORD')) {
      if (mode === 'search') mode = 'keyword'
      continue
    }
    if (isCmd(upper, 'SITES')) {
      if (mode === 'search') mode = 'sites'
      continue
    }
    if (isCmd(upper, 'BUILD')) {
      if (mode === 'search') mode = 'build'
      continue
    }
    if (isCmd(upper, 'FORCE')) { force = true; continue }
    if (isCmd(upper, 'GHOST')) {
      ghostUrl = val(line, 'GHOST')
      if (mode === 'search') mode = 'ghost'
      continue
    }
    if (isCmd(upper, 'BUTTON')) { label = val(line, 'BUTTON'); continue }
    if (isCmd(upper, 'BATCH')) {
      const b = val(line, 'BATCH').toLowerCase()
      batch = (b === 'off' || b === 'no' || b === '0') ? 0 : (parseInt(b) || 100)
      continue
    }
    if (isCmd(upper, 'ALGORITHM')) {
      const ref = val(line, 'ALGORITHM').replace(/^\[\[|\]\]$/g, '').trim()
      algorithm = ref || 'search-algorithm'
      if (mode === 'search' && !specs.length) mode = 'algorithm'
      continue
    }
    if (isCmd(upper, 'ROSTER')) {
      const ref = val(line, 'ROSTER')
      if (ref) rosterRefs.push(ref)
      continue
    }
    if (isCmd(upper, 'FARM')) {
      const peer = val(line, 'FARM')
      if (peer) farms.push(peer)
      continue
    }
    if (isCmd(upper, 'LIST')) {
      if (!specs.length && mode === 'search') mode = 'list'
      continue
    }
    if (isCmd(upper, 'STATUS')) {
      if (mode === 'search') mode = 'status'
      continue
    }
    if (isCmd(upper, 'DOOR')) {
      if (mode === 'search') mode = 'door'
      continue
    }
    if (isCmd(upper, 'SIMILAR')) {
      const level = val(upper, 'SIMILAR').toLowerCase()
      threshold = SIMILAR_THRESHOLDS[level] || DEFAULT_THRESHOLD  // '' → medium
      if (!specs.length && mode === 'search') mode = 'similar'
      continue
    }
    if (isCmd(upper, 'THRESHOLD')) {
      const tv = val(line, 'THRESHOLD')
      threshold = SIMILAR_THRESHOLDS[tv.toLowerCase()] ?? (parseFloat(tv) || DEFAULT_THRESHOLD)
      continue
    }
    if (isCmd(upper, 'LIMIT')) {
      limit = parseInt(val(line, 'LIMIT')) || DEFAULT_LIMIT  // '' → 10
      continue
    }
    // Anything else is a domain spec (glob, explicit domain, or scope keyword)
    specs.push(['PUBLIC', 'LOCAL', 'PRIVATE', 'GALAXY', 'SITE'].includes(upper) ? upper : line)
  }

  return {
    mode,
    specs,
    rosterRefs,
    farms,
    threshold: threshold ?? DEFAULT_THRESHOLD,
    limit:     limit     ?? DEFAULT_LIMIT,
    live,
    subject,
    force,
    ghostUrl,
    label,
    batch,
    algorithm,
    auto,
    thresholdSet: threshold !== null,  // explicit THRESHOLD/SIMILAR in the DSL
  }
}

const isGlob = spec => spec.includes('*') || spec.includes('?')

// Scope keywords expand server-side: PUBLIC (Nextcloud mirror farms),
// LOCAL (primary farm), PRIVATE (public domains with restricted: true),
// GALAXY (off-farm federation sites indexed into the galaxy tree)
const isScope = spec => spec === 'PUBLIC' || spec === 'LOCAL' || spec === 'PRIVATE' ||
  spec === 'GALAXY'

export { parseDSL, isGlob, isScope, SIMILAR_THRESHOLDS, DEFAULT_THRESHOLD, DEFAULT_LIMIT }
