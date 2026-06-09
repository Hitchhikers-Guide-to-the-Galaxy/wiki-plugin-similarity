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
//   SIMILAR: high             threshold preset AND ambient mode trigger
//   THRESHOLD: 0.72           exact cosine threshold (overrides SIMILAR:)
//   LIMIT: 8                  max results shown (default 10)
//
// Mode is determined by DSL (Ward's ALL-CAPS convention):
//   SIMILAR: as the FIRST meaningful line → ambient mode (no search form;
//     the item automatically finds pages similar to the current page)
//   Domain specs first, or empty text → search form mode (user types query)
//
// Server endpoints required:
//   GET  /system/indexed-domains.json?pattern=glob1,glob2
//   GET  /system/semantic-vectors.json?domain=
//   GET  /system/embed.json?text=query

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

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const upper = line.toUpperCase()
    if (upper.startsWith('SIMILAR:')) {
      const level = line.split(':')[1].trim().toLowerCase()
      threshold = SIMILAR_THRESHOLDS[level] ?? DEFAULT_THRESHOLD
      // SIMILAR: as the first meaningful line → ambient mode
      if (!specs.length && mode === 'search') mode = 'similar'
      continue
    }
    if (upper.startsWith('THRESHOLD:')) {
      threshold = parseFloat(line.split(':')[1]) || DEFAULT_THRESHOLD
      continue
    }
    if (upper.startsWith('LIMIT:')) {
      limit = parseInt(line.split(':')[1]) || DEFAULT_LIMIT
      continue
    }
    // Anything else is a domain spec
    specs.push(line)
  }

  return {
    mode,
    specs,
    threshold: threshold ?? DEFAULT_THRESHOLD,
    limit:     limit     ?? DEFAULT_LIMIT,
  }
}

const isGlob = spec => spec.includes('*') || spec.includes('?')

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
    if (spec === '*' || isGlob(spec)) {
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

// Detect whether the wiki is running on localhost (or a .localhost subdomain).
// On localhost we proxy all domain vector fetches through the local server's
// ?domain= parameter — this reads vectors directly from the farm folder on disk,
// avoiding any need for remote servers to have this plugin installed, and
// sidestepping CORS entirely.
const isLocalhost = () => {
  const h = window.location.hostname
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1'
}

const vectorUrl = domain => {
  if (isLocalhost()) {
    // Route through our local server — serves any farm domain from disk
    return `${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(domain)}`
  }
  // On a real server, fetch directly from the remote wiki
  return `http://${domain}/system/semantic-vectors.json`
}

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
  .similar-results h3 { margin:4px 0 6px; font-size:14px; color:#555; }
  .similar-results ul { margin:0; padding-left:18px; }
  .similar-results li { font-size:14px; padding:2px 0; }
  .similar-results .sim-domain { margin-left:6px; }
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
  const { mode, specs, threshold, limit } = parseDSL(item?.text || '')
  if (mode === 'similar') {
    const label = specs.length ? specs.join(', ') : 'current domain'
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}">
        <div class="sim-status">Finding similar pages across ${label}…</div>
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
  const { mode, specs, threshold, limit } = parseDSL(item?.text || '')
  const origin  = window.location.origin
  const status  = div.find('.sim-status')[0]
  const results = div.find('.sim-results')[0]

  div.on('dblclick', () => window.wiki.textEditor(div, item))

  div.on('click', '.sim-link', function (e) {
    e.preventDefault()
    const $a = $(this)
    window.wiki.doInternalLink($a.data('title'), div.parents('.page'), $a.data('site'))
  })

  if (mode === 'similar') {
    // Ambient mode — run automatically, no search form
    const run = async () => {
      try {
        const $page     = div.parents('.page')
        const pageTitle = $page.find('.title').text().trim() || document.title
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

        if (!scored.length) {
          status.textContent = `No similar pages found above threshold ${threshold}`
          return
        }
        results.innerHTML = `<h3>Similar Pages</h3><ul>${
          scored.map(({ domain, slug, title, score }) =>
            `<li>${simLink(domain, slug, title, score)}</li>`).join('')
        }</ul>`
        status.textContent = `${scored.length} similar pages found`
      } catch (e) {
        status.textContent = `Error: ${e.message}`
      }
    }
    run()
  } else {
    // Search form mode — preload domains, then wait for user input
    const input = div.find('.sim-input')[0]
    const btn   = div.find('.sim-btn')[0]
    let domainEntries = null

    const preload = async () => {
      try {
        status.textContent = 'Resolving domains…'
        domainEntries = await loadDomainEntries(specs, origin)
        const total = domainEntries.reduce((n, e) => n + e.pages.length, 0)
        status.textContent = `Ready — ${total.toLocaleString()} pages across ${domainEntries.length} domains`
      } catch (e) {
        status.textContent = `Load error: ${e.message}`
      }
    }
    preload()

    const doSearch = async () => {
      const query = input.value.trim()
      if (!query || !domainEntries) return
      btn.disabled = true
      status.textContent = 'Embedding query…'
      results.innerHTML = ''
      try {
        const qVec = await getEmbedding(query, origin)
        const scored = cosineScan(qVec, domainEntries,
          { threshold: 0, limit, excludeSlug: null, excludeDomain: null })
        results.innerHTML = scored.map(({ domain, slug, title, score }) =>
          `<div class="sim-result">${simLink(domain, slug, title, score)}</div>`).join('')
        status.textContent = `Top ${scored.length} results for "${query}"`
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
