// wiki-plugin-similarity
//
// One item type: similarity
//
// DSL in item.text (newline-separated lines):
//   *                         all indexed domains on this server
//   david.*                   glob pattern
//   *.fish                    glob pattern
//   david.hitchhikers.earth   explicit domain name
//   # comment                 ignored
//   LIST                      list indexed domains (mode directive)
//   SIMILAR: high             threshold preset AND ambient mode trigger
//   THRESHOLD: 0.72           exact cosine threshold (overrides SIMILAR:)
//   LIMIT: 8                  max results shown (default 10)
//
// Mode is determined by the FIRST meaningful line (Ward's ALL-CAPS convention):
//   LIST     → show a table of all indexed domains and their page counts;
//              optional glob patterns on subsequent lines filter the list
//   SIMILAR: → ambient mode — automatically find pages similar to this page
//   REPORT   → server-side ranked/bundled semantic report (ghost page)
//   KEYWORD  → galactic MiniSearch over live site-index.json files (ghost page)
//   (other)  → search form mode — user types a query, results appear
//
// Server endpoints required (all same-origin, served by this plugin's server
// component — works on any host, including the public farm):
//   GET  /system/indexed-domains.json?pattern=glob1,glob2
//   GET  /system/semantic-vectors.json?domain=
//   GET  /system/embed.json?text=query
//   POST /system/search-report.json
//   GET  /system/farm-search.json?q=&pattern=&limit=
//   GET  /system/build-index.json?domains=&force=

// ── DSL Parser ────────────────────────────────────────────────────────────────

const SIMILAR_THRESHOLDS = { high: 0.78, medium: 0.68, low: 0.58 }
const DEFAULT_THRESHOLD  = SIMILAR_THRESHOLDS.medium
const DEFAULT_LIMIT      = 10

// parseDSL returns { mode, specs, threshold, limit }
//
// mode: 'similar' if SIMILAR: is the first meaningful line (ambient auto-run),
//        'search'  otherwise (interactive search form).
//
// Ward's convention: ALL-CAPS keyword as first word signals a mode switch.
// Placing SIMILAR: first makes the item ambient; placing domain specs first
// (or leaving text empty) keeps it as an interactive search form.

const parseDSL = text => {
  const specs   = []
  let threshold = null
  let limit     = null
  let mode      = 'search'  // default: interactive search form
  let live      = false     // default: cache results in localStorage
  let force     = false     // BUILD mode: re-embed even when index is fresh
  let ghostUrl  = null      // GHOST mode: page-json URL to open as a ghost page
  let label     = null      // BUTTON: custom button caption (GHOST / BUILD modes)

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
    if (isCmd(upper, 'LIST')) {
      if (!specs.length && mode === 'search') mode = 'list'
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
    specs.push(['PUBLIC', 'LOCAL', 'PRIVATE'].includes(upper) ? upper : line)
  }

  return {
    mode,
    specs,
    threshold: threshold ?? DEFAULT_THRESHOLD,
    limit:     limit     ?? DEFAULT_LIMIT,
    live,
    force,
    ghostUrl,
    label,
    thresholdSet: threshold !== null,  // explicit THRESHOLD/SIMILAR in the DSL
  }
}

const isGlob = spec => spec.includes('*') || spec.includes('?')

// Scope keywords expand server-side: PUBLIC (Nextcloud mirror farms),
// LOCAL (primary farm), PRIVATE (public domains with restricted: true)
const isScope = spec => spec === 'PUBLIC' || spec === 'LOCAL' || spec === 'PRIVATE'

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

// ── Vector loading ────────────────────────────────────────────────────────────

const vectorCache = new Map()

// Route vector requests through the current wiki's plugin server. This keeps
// public HTTPS pages same-origin, avoids CORS failures, and lets the server read
// indices from its configured farm roots.
const vectorUrl = domain =>
  `${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(domain)}`

const loadVectors = async domain => {
  if (vectorCache.has(domain)) return vectorCache.get(domain)
  const res = await fetch(vectorUrl(domain))
  if (!res.ok) return []
  const data = await res.json()
  vectorCache.set(domain, data)
  return data
}

// ── Embedding ─────────────────────────────────────────────────────────────────

const getEmbedding = async (text, origin) => {
  const res = await fetch(`${origin}/system/embed.json?text=${encodeURIComponent(text)}`)
  if (!res.ok) throw new Error(`embed failed: ${res.status}`)
  return (await res.json()).vector
}

// Look up an existing page vector from the current domain's cached index.
// Returns the float[] vector if found, null otherwise.
const lookupPageVector = async (slug, domain) => {
  const pages = await loadVectors(domain)
  const entry = pages.find(p => p.slug === slug)
  return entry ? entry.vector : null
}

// ── Cosine search ─────────────────────────────────────────────────────────────

const cosineScan = (queryVec, domainEntries, { threshold, limit, excludeSlug, excludeDomain }) => {
  const results = []
  for (const { domain, pages } of domainEntries) {
    for (const { slug, title, vector } of pages) {
      if (slug === excludeSlug && domain === excludeDomain) continue
      let dot = 0
      for (let i = 0; i < queryVec.length; i++) dot += queryVec[i] * vector[i]
      if (dot >= threshold) results.push({ domain, slug, title, score: dot })
    }
  }
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

// ── Shared domain loading ─────────────────────────────────────────────────────

const loadDomainEntries = async (specs, origin) => {
  const domains = await resolveDomains(specs, origin)
  const entries = await Promise.all(
    domains.map(async ({ domain }) => ({ domain, pages: await loadVectors(domain) }))
  )
  return entries.filter(e => e.pages.length > 0)
}

// ── Result cache (localStorage) ──────────────────────────────────────────────
// Cache is keyed by item id. Invalidated when item.text changes (DSL edited).
// LIVE mode bypasses the cache entirely.

const cacheKey = id => `sim-cache-${id}`

const readCache = item => {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey(item.id)) || 'null')
    return c?.text === (item.text || '') ? c : null
  } catch { return null }
}

const writeCache = (item, data) => {
  try {
    localStorage.setItem(cacheKey(item.id), JSON.stringify({
      text: item.text || '',
      ts:   Date.now(),
      ...data,
    }))
  } catch { /* storage unavailable or full */ }
}

const cacheAge = ts => {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ── Styles ────────────────────────────────────────────────────────────────────

const STYLES = `
  .sim-form { display:flex; gap:6px; margin-bottom:8px; }
  .sim-input { flex:1; padding:6px 8px; font-size:14px; border:1px solid #ccc; border-radius:3px; }
  .sim-btn { padding:6px 14px; background:#c4561d; color:white; border:none;
             border-radius:3px; cursor:pointer; font-size:14px; }
  .sim-btn:disabled { opacity:0.5; cursor:not-allowed; }
  .sim-status { font-size:12px; color:#888; margin-bottom:6px; min-height:16px; }
  .sim-results { margin-top:4px; }
  .sim-result { display:flex; align-items:center; gap:8px; padding:3px 0;
                border-bottom:1px solid #f0f0f0; }
  .sim-flag { width:16px; height:16px; vertical-align:middle; margin-right:4px; }
  .sim-link { font-size:14px; color:#406; flex:1; }
  .sim-domain { font-size:11px; color:#999; }
  .similar-results h3, .sim-list h3 { margin:4px 0 6px; font-size:14px; color:#555; }
  .similar-results ul { margin:0; padding-left:18px; }
  .similar-results li { font-size:14px; padding:2px 0; }
  .similar-results .sim-domain { margin-left:6px; }
  .sim-count { font-size:12px; color:#888; margin:4px 0 0; }
  .sim-list table { border-collapse:collapse; width:100%; font-size:13px; }
  .sim-list th { text-align:left; font-size:11px; color:#888; padding:2px 8px 4px 0;
                 border-bottom:1px solid #ddd; }
  .sim-list td { padding:3px 8px 3px 0; border-bottom:1px solid #f0f0f0; vertical-align:middle; }
  .sim-list td:last-child { text-align:right; color:#999; font-size:11px; }
  .sim-list .sim-flag { margin-right:6px; }
`

const siteFlag = (domain, score) =>
  `<img class="sim-flag remote" src="${window.wiki.site(domain).flag()}"
        title="${domain} — score ${score.toFixed(3)}"
        data-site="${domain}">`

// ── similarity item ────────────────────────────────────────────────────────────

const simLink = (domain, slug, title, score) =>
  `<a class="sim-link" data-title="${title}" data-slug="${slug}" data-site="${domain}" href="#">` +
  `${siteFlag(domain, score)} ${title}</a>`

export const emit = (div, item) => {
  const { mode, specs, threshold, limit, force, ghostUrl, label } = parseDSL(item?.text || '')
  if (mode === 'ghost') {
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}">
        <div class="sim-form">
          <button class="sim-btn">${label || 'Open'}</button>
        </div>
        <div class="sim-status"></div>
      </div>`)
  } else if (mode === 'build') {
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}">
        <div class="sim-form">
          <button class="sim-btn">${label || `Index ${specs.length ? specs.join(', ') : '*'}${force ? ' (force)' : ''}`}</button>
        </div>
        <div class="sim-status"></div>
      </div>`)
  } else if (mode === 'list') {
    const label = specs.length ? specs.join(', ') : '*'
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}">
        <div class="sim-status">Loading indexed domains (${label})…</div>
        <div class="sim-list"></div>
      </div>`)
  } else if (mode === 'similar') {
    const label = specs.length ? specs.join(', ') : 'current domain'
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}">
        <div class="sim-status">Finding similar pages across ${label}…</div>
        <div class="sim-results"></div>
      </div>`)
  } else if (mode === 'author' || mode === 'report' || mode === 'keyword') {
    const label = specs.length ? specs.join(', ') : '(current domain)'
    const btnLabel = mode === 'report' ? 'Report' : mode === 'keyword' ? 'Keyword' : 'Author'
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages…" />
          <button class="sim-btn">${btnLabel}</button>
        </div>
        <div class="sim-status">Domains: ${label}</div>
        <div class="sim-results"></div>
      </div>`)
  } else {
    const label = specs.length ? specs.join(', ') : '(current domain)'
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages…" />
          <button class="sim-btn">Search</button>
        </div>
        <div class="sim-status">Domains: ${label}</div>
        <div class="sim-results"></div>
      </div>`)
  }
}

export const bind = (div, item) => {
  const { mode, specs, threshold, limit, live, force, ghostUrl, thresholdSet } =
    parseDSL(item?.text || '')
  const origin  = window.location.origin
  const status  = div.find('.sim-status')[0]
  const cache   = live ? null : readCache(item)

  // Standardised pre-search status: what will run, over how much, with what config.
  // e.g. "Report ready — 18,583 pages across 267 domains · threshold 0.68 · limit 20 · LIVE"
  const configSummary = (verb, pages, nDomains) => {
    const parts = [`${verb} — ${pages.toLocaleString()} pages across ${nDomains} domains`]
    if (thresholdSet) parts.push(`threshold ${threshold}`)
    parts.push(`limit ${limit}`)
    if (live) parts.push('LIVE')
    return parts.join(' · ')
  }

  div.on('dblclick', e => {
    if ($(e.target).closest('.sim-input').length) return
    window.wiki.textEditor(div, item)
  })
  div.on('click', '.sim-link', function (e) {
    e.preventDefault()
    const $a = $(this)
    // shift-click appends at the end of the lineup instead of truncating after this page
    const $page = e.shiftKey ? null : div.parents('.page')
    window.wiki.doInternalLink($a.data('title'), $page, $a.data('site'))
  })

  const scopeLabel = !specs.length || (specs.length === 1 && specs[0] === '*')
    ? 'on farm'
    : specs.length === 1 ? `on ${specs[0]}` : 'in domains'

  const cacheNote = ts => ts ? ` · cached ${cacheAge(ts)}` : ''

  if (mode === 'list') {
    const listDiv = div.find('.sim-list')[0]
    const patterns = specs.length ? specs.join(',') : '*'

    const renderList = (domains, ts) => {
      const totalPages = domains.reduce((n, d) => n + (d.page_count || 0), 0)
      status.style.display = 'none'
      listDiv.innerHTML = `<h3>Indexed Farm Domains</h3>
        <table>
          <tr><th>Domain</th><th>Pages</th></tr>
          ${domains.map(({ domain, page_count }) => `
            <tr>
              <td><img class="sim-flag remote" src="${window.wiki.site(domain).flag()}"
                       title="${domain}" data-site="${domain}"> ${domain}</td>
              <td>${page_count != null ? page_count.toLocaleString() : '—'}</td>
            </tr>`).join('')}
        </table>
        <p class="sim-count">${domains.length} domains — ${totalPages.toLocaleString()} pages${cacheNote(ts)}</p>`
    }

    if (cache?.domains) {
      renderList(cache.domains, cache.ts)
    } else {
      ;(async () => {
        try {
          const url = `${origin}/system/indexed-domains.json?pattern=${encodeURIComponent(patterns)}&limit=${limit}`
          const res = await fetch(url)
          if (!res.ok) throw new Error(`indexed-domains failed: ${res.status}`)
          const domains = await res.json()
          if (!domains.length) { status.textContent = 'No indexed domains found'; return }
          renderList(domains, null)
          writeCache(item, { domains })
        } catch (e) {
          status.textContent = `Error: ${e.message}`
        }
      })()
    }

  } else if (mode === 'similar') {
    const results = div.find('.sim-results')[0]

    const renderScored = (scored, ts) => {
      if (!scored.length) {
        status.textContent = `No similar pages found above threshold ${threshold}`
        return
      }
      results.innerHTML = `<h3>Similar Pages</h3><ul>${
        scored.map(({ domain, slug, title, score }) =>
          `<li>${simLink(domain, slug, title, score)}</li>`).join('')
      }</ul><p class="sim-count">${scored.length} found ${scopeLabel}${cacheNote(ts)}</p>`
      status.style.display = 'none'
    }

    if (cache?.scored) {
      renderScored(cache.scored, cache.ts)
    } else {
      ;(async () => {
        try {
          const $page         = div.parents('.page')
          const pageTitle     = $page.find('.title').text().trim() || document.title
          const currentSlug   = slugify(pageTitle)
          const currentDomain = window.location.hostname

          const domainEntries = await loadDomainEntries(specs, origin)
          const total = domainEntries.reduce((n, e) => n + e.pages.length, 0)
          status.textContent = `Searching ${total.toLocaleString()} pages…`

          let qVec = await lookupPageVector(currentSlug, currentDomain)
          if (!qVec) {
            status.textContent = 'Embedding page (not yet indexed)…'
            const pageText = $page.find('.item').map((_, el) => $(el).text().trim()).get().filter(Boolean).join('\n')
            qVec = await getEmbedding(pageText || pageTitle, origin)
          }

          const scored = cosineScan(qVec, domainEntries, {
            threshold, limit, excludeSlug: currentSlug, excludeDomain: currentDomain,
          })
          renderScored(scored, null)
          if (scored.length) writeCache(item, { scored })
        } catch (e) {
          status.textContent = `Error: ${e.message}`
        }
      })()
    }

  } else if (mode === 'ghost') {
    // Ghost mode — fetch page-json from any URL and open it as a ghost page
    const btn = div.find('.sim-btn')[0]

    const doGhost = async () => {
      if (!ghostUrl) { status.textContent = 'No URL — GHOST needs a page-json URL'; return }
      btn.disabled = true
      status.textContent = 'Fetching…'
      try {
        const res = await fetch(ghostUrl)
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
        const page = await res.json()
        window.wiki.showResult(window.wiki.newPage(page), { $page: div.parents('.page') })
        status.textContent = ''
      } catch (e) {
        status.textContent = `Error: ${e.message}`
      } finally {
        btn.disabled = false
      }
    }

    btn.addEventListener('click', doGhost)

  } else if (mode === 'build') {
    // Build mode — trigger a semantic index build; result opens as a ghost page
    const btn = div.find('.sim-btn')[0]

    const doBuild = async () => {
      btn.disabled = true
      status.textContent = 'Building index… (may take a while for large scopes)'
      try {
        const domains = encodeURIComponent((specs.length ? specs : ['*']).join(','))
        const res = await fetch(
          `${origin}/system/build-index.json?domains=${domains}&force=${force ? 1 : 0}`)
        if (res.status === 501) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.hint || 'indexing runs on the farm indexer, not this server')
        }
        if (!res.ok) throw new Error(`build-index failed: ${res.status}`)
        const page = await res.json()
        window.wiki.showResult(window.wiki.newPage(page), { $page: div.parents('.page') })
        status.textContent = ''
      } catch (e) {
        status.textContent = `Error: ${e.message}`
      } finally {
        btn.disabled = false
      }
    }

    btn.addEventListener('click', doBuild)

  } else if (mode === 'report') {
    // Report mode — server-side ranked/bundled search, opens result as ghost page
    const input = div.find('.sim-input')[0]
    const btn   = div.find('.sim-btn')[0]
    let readyLine = `Domains: ${specs.length ? specs.join(', ') : '*'}`

    // Preload the lightweight domain listing (counts only, no vectors) so the
    // status line shows scope and config before any search is issued.
    ;(async () => {
      try {
        const domains = await resolveDomains(specs.length ? specs : ['*'], origin)
        const pages = domains.reduce((n, d) => n + (d.page_count || 0), 0)
        readyLine = configSummary('Report ready', pages, domains.length)
        status.textContent = readyLine
      } catch (e) {
        status.textContent = `Domain listing unavailable: ${e.message}`
      }
    })()

    const doReport = async () => {
      const query = input.value.trim()
      if (!query) return
      btn.disabled = true
      status.textContent = 'Generating report…'
      try {
        const body = { query, domains: specs.length ? specs : ['*'], limit, live }
        if (thresholdSet) body.threshold = threshold
        const res = await fetch(`${origin}/system/search-report.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error(`search-report failed: ${res.status}`)
        const page = await res.json()
        const pageObj = window.wiki.newPage(page)
        window.wiki.showResult(pageObj, { $page: div.parents('.page') })
        status.textContent = readyLine
      } catch (e) {
        status.textContent = `Error: ${e.message}`
      } finally {
        btn.disabled = false
      }
    }

    btn.addEventListener('click', doReport)
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doReport() })

  } else if (mode === 'keyword') {
    // Keyword mode — galactic MiniSearch: the server reads each site's own
    // per-edit site-index.json; result opens as a ghost page.
    const input = div.find('.sim-input')[0]
    const btn   = div.find('.sim-btn')[0]

    status.textContent = `Keyword search ready — domains: ${specs.length ? specs.join(', ') : '*'} · limit ${limit}`

    const doKeyword = async () => {
      const query = input.value.trim()
      if (!query) return
      btn.disabled = true
      status.textContent = 'Searching live site indexes…'
      try {
        const pattern = encodeURIComponent((specs.length ? specs : ['*']).join(','))
        const res = await fetch(
          `${origin}/system/farm-search.json?q=${encodeURIComponent(query)}&pattern=${pattern}&limit=${limit}`)
        if (!res.ok) throw new Error(`farm-search failed: ${res.status}`)
        const page = await res.json()
        window.wiki.showResult(window.wiki.newPage(page), { $page: div.parents('.page') })
        status.textContent = `Keyword search ready — domains: ${specs.length ? specs.join(', ') : '*'} · limit ${limit}`
      } catch (e) {
        status.textContent = `Error: ${e.message}`
      } finally {
        btn.disabled = false
      }
    }

    btn.addEventListener('click', doKeyword)
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doKeyword() })

  } else if (mode === 'author') {
    // Author mode — same search form but creates a ghost page from results
    const input   = div.find('.sim-input')[0]
    const btn     = div.find('.sim-btn')[0]
    const results = div.find('.sim-results')[0]
    let domainEntries = null

    ;(async () => {
      try {
        if (!cache) status.textContent = 'Resolving domains…'
        domainEntries = await loadDomainEntries(specs, origin)
        const total = domainEntries.reduce((n, e) => n + e.pages.length, 0)
        status.textContent = configSummary('Author ready', total, domainEntries.length)
      } catch (e) {
        status.textContent = `Load error: ${e.message}`
      }
    })()

    const doAuthor = async () => {
      const query = input.value.trim()
      if (!query || !domainEntries) return
      btn.disabled = true
      status.textContent = 'Embedding query…'
      results.innerHTML = ''
      try {
        const qVec  = await getEmbedding(query, origin)
        const scored = cosineScan(qVec, domainEntries,
          { threshold, limit, excludeSlug: null, excludeDomain: null })

        // Unique titles for wiki-link list
        const seenTitles = new Set()
        const uniqueTitles = []
        for (const { title } of scored) {
          if (!seenTitles.has(title)) { seenTitles.add(title); uniqueTitles.push(title) }
        }

        const hexId = () => Math.floor(Math.random() * 0xffffffffffffffff).toString(16).padStart(16, '0')
        const primaryLines = uniqueTitles.map(t => `- [[${t}]]`).join('\n')

        const story = [
          { type: 'markdown', id: hexId(), text: `# Similar Pages\n\n${primaryLines}` },
          { type: 'markdown', id: hexId(), text: '# Reference Links' },
          ...scored.map(({ domain, slug, title, score }) => ({
            type: 'reference', id: hexId(), site: domain, slug, title,
            text: `score ${score.toFixed(3)}`,
          })),
        ]

        const pageObj = window.wiki.newPage({ title: `${query} Results`, story, journal: [] })
        window.wiki.showResult(pageObj, { $page: div.parents('.page') })

        status.textContent = `${scored.length} pages found`
        writeCache(item, { scored, query })
      } catch (e) {
        status.textContent = `Error: ${e.message}`
      } finally {
        btn.disabled = false
      }
    }

    btn.addEventListener('click', doAuthor)
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doAuthor() })

  } else {
    // Search form mode
    const input   = div.find('.sim-input')[0]
    const btn     = div.find('.sim-btn')[0]
    const results = div.find('.sim-results')[0]
    let domainEntries = null

    // Show cached results immediately while domains preload in background
    if (cache?.scored) {
      input.value = cache.query || ''
      results.innerHTML = cache.scored.map(({ domain, slug, title, score }) =>
        `<div class="sim-result">${simLink(domain, slug, title, score)}</div>`).join('') +
        `<p class="sim-count">Top ${cache.scored.length} for "${cache.query || ''}"${cacheNote(cache.ts)}</p>`
      status.textContent = ''
    }

    ;(async () => {
      try {
        if (!cache) status.textContent = 'Resolving domains…'
        domainEntries = await loadDomainEntries(specs, origin)
        const total = domainEntries.reduce((n, e) => n + e.pages.length, 0)
        status.textContent = configSummary('Search ready', total, domainEntries.length)
      } catch (e) {
        status.textContent = `Load error: ${e.message}`
      }
    })()

    const doSearch = async () => {
      const query = input.value.trim()
      if (!query || !domainEntries) return
      btn.disabled = true
      status.textContent = 'Embedding query…'
      results.innerHTML = ''
      try {
        const qVec = await getEmbedding(query, origin)
        const scored = cosineScan(qVec, domainEntries,
          { threshold, limit, excludeSlug: null, excludeDomain: null })
        results.innerHTML = scored.map(({ domain, slug, title, score }) =>
          `<div class="sim-result">${simLink(domain, slug, title, score)}</div>`).join('') +
          `<p class="sim-count">Top ${scored.length} for "${query}"</p>`
        status.textContent = ''
        writeCache(item, { scored, query })
      } catch (e) {
        status.textContent = `Error: ${e.message}`
      } finally {
        btn.disabled = false
      }
    }

    btn.addEventListener('click', doSearch)
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch() })
  }
}

// ── Register item type with the wiki ─────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.plugins = window.plugins || {}
  window.plugins.similarity = { emit, bind }
}
