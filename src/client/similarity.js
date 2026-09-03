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
//   SUBJECT                   modifier: act on the PREVIOUS page in the lineup
//                             (the host a tool page was opened beside; falls
//                             back to the containing page when none)
//   THRESHOLD: 0.72           exact cosine threshold (overrides SIMILAR:)
//   LIMIT: 8                  max results shown (default 10)
//   ROSTER site/slug          add the sites of a roster page to the scope
//   FARM other.farm.tld       ask a peer farm to continue the search (experimental)
//
// Mode is determined by the FIRST meaningful line (Ward's ALL-CAPS convention):
//   LIST     → show a table of all indexed domains and their page counts;
//              optional glob patterns on subsequent lines filter the list
//   SIMILAR: → ambient mode — automatically find pages similar to this page
//   REPORT   → server-side ranked/bundled semantic report (ghost page)
//   KEYWORD  → galactic MiniSearch over live site-index.json files (ghost page)
//   SITES    → which site should this page go on? — per-domain aggregation of
//              the page-vector scan (ghost page)
//   (other)  → search form mode — user types a query, results appear
//
// Server endpoints required (all same-origin, served by this plugin's server
// component — works on any host, including the public farm):
//   GET  /system/indexed-domains.json?pattern=glob1,glob2
//   GET  /system/semantic-vectors.json?domain=
//   POST /system/embed.json  {text}
//   POST /system/search-report.json
//   POST /system/site-report.json
//   GET  /system/farm-search.json?q=&pattern=&limit=
//   GET  /system/build-index.json?domains=&force=

import { parseDSL, DEFAULT_LIMIT } from './dsl.js'
import { slugify, effectiveSpecs, resolveDomains } from './scope.js'
import { loadVectors, getEmbedding, lookupPageVector, cosineScan, loadDomainEntries } from './vectors.js'
import { resolveSubject, subjectNote } from './subject.js'
import { readCache, writeCache, cacheAge } from './cache.js'
import { STYLES, siteFlag } from './styles.js'

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
  } else if (mode === 'status') {
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}">
        <div class="sim-status">Reading the state of the index…</div>
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
  } else if (mode === 'author' || mode === 'report' || mode === 'keyword' || mode === 'sites') {
    const label = specs.length ? specs.join(', ') : '(current domain)'
    const btnLabel = mode === 'report' ? 'Report' : mode === 'keyword' ? 'Keyword'
      : mode === 'sites' ? 'Sites' : 'Author'
    const hint = mode === 'sites' ? 'Where should this page go? Title + first paragraph…'
      : 'Search wiki pages…'
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="${hint}" />
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
  const { mode, specs, rosterRefs, farms, threshold, limit, live, subject: subjectFlag,
    force, ghostUrl, thresholdSet } = parseDSL(item?.text || '')
  const origin  = window.location.origin
  const status  = div.find('.sim-status')[0]
  // The subject depends on where in the lineup this page was opened, so
  // cached results from one host must never replay beside another.
  const subject = subjectFlag ? resolveSubject(div) : null
  const cache   = (live || subject) ? null : readCache(item)
  // Scope = DSL specs plus roster-page domains (resolved once, shared by modes)
  const specsP  = effectiveSpecs(specs, rosterRefs)
  // Seed params for the server report routes — the stored page vector wins
  // server-side; text is the fallback for remote or unindexed subjects.
  const seedParams = () => subject ? {
    seed: { site: subject.site, slug: subject.slug },
    text: subject.text,
    excludePage: { site: subject.site, slug: subject.slug },
  } : {}

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

  if (mode === 'status') {
    // The state of the index behind every other item on the page: which model,
    // how much is indexed, when it was last built, and — the one that decides
    // whether any of this works — whether a query can be turned into a vector
    // at all. A search page that cannot say this leaves the reader guessing
    // why an answer looks thin.
    const listDiv = div.find('.sim-list')[0]

    const ago = iso => {
      if (!iso) return 'unknown'
      const days = (Date.now() - new Date(iso)) / 86400000
      if (days < 1) return 'today'
      if (days < 2) return 'yesterday'
      return `${Math.floor(days)} days ago`
    }
    const day = iso => (iso ? new Date(iso).toISOString().slice(0, 10) : '—')

    ;(async () => {
      try {
        // Whether search works is answered by trying it, not by reading a
        // field. A delegated embedder reports no supervisor state at all, so
        // a proxy pointed at a dead address looked healthy here — the exact
        // silent failure this panel exists to prevent.
        const probeEmbedder = () =>
          fetch(`${origin}/system/embed.json?text=ping`)
            .then(async r => r.ok
              ? { ok: true }
              : { ok: false, detail: ((await r.json().catch(() => ({}))).error || `status ${r.status}`)
                  .replace(/^embedding unavailable: /, '') })
            .catch(e => ({ ok: false, detail: e.message }))

        const [health, domains, probe] = await Promise.all([
          fetch(`${origin}/system/similarity-health.json`).then(r => r.json()),
          fetch(`${origin}/system/indexed-domains.json`).then(r => r.ok ? r.json() : []),
          probeEmbedder(),
        ])
        const emb   = health.embedder || {}
        const built = domains.map(d => d.built).filter(Boolean).sort()
        const pages = domains.reduce((n, d) => n + (d.page_count || 0), 0)

        // "Up" means a query can be embedded right now — proven a moment ago.
        const down  = !probe.ok
        const upLine = down
          ? `<strong>Semantic search is down</strong> — a query cannot be turned into a vector right now (${probe.detail}), so searches on this page will answer by keyword instead.`
          : `Semantic search is <strong>up</strong> — checked just now by embedding a word.`
        const via = emb.via === 'url'
          ? `delegated to <code>${emb.url}</code> (from ${emb.source || 'config'})`
          : emb.via === 'semindex' ? 'in this process, via the SemIndex plugin'
          : 'in this process, in a supervised child'

        status.style.display = 'none'
        listDiv.innerHTML = `<h3>The Index Behind These Answers</h3>
          <p>${upLine}</p>
          <table>
            <tr><th>Model</th><td>${health.model || '—'} · ${health.dim || '—'} dimensions</td></tr>
            <tr><th>Embedder</th><td>${via}${down ? ' — <strong>currently down</strong>' : ''}</td></tr>
            <tr><th>Indexed</th><td>${domains.length.toLocaleString()} domains · ${pages.toLocaleString()} pages</td></tr>
            <tr><th>Newest page vectors</th><td>${day(built[built.length - 1])} (${ago(built[built.length - 1])})</td></tr>
            <tr><th>Oldest page vectors</th><td>${day(built[0])} (${ago(built[0])})</td></tr>
            <tr><th>Plugin</th><td>wiki-plugin-similarity ${health.version || '—'}</td></tr>
          </table>
          <p class="sim-count">A domain's vectors are only rebuilt when its pages change, so an old
             date means a quiet site, not a broken one. Pages saved since the last build are findable
             by keyword but not yet by meaning.</p>`
      } catch (e) {
        status.textContent = `Index state unavailable: ${e.message}`
      }
    })()

  } else if (mode === 'list') {
    const listDiv = div.find('.sim-list')[0]

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
          const eff = await specsP
          const patterns = eff.length ? eff.join(',') : '*'
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
          // SUBJECT: act on the previous lineup page; otherwise this page.
          const $page = div.parents('.page')
          const s = subject || (() => {
            const pageTitle = $page.find('.title').text().trim() || document.title
            return { slug: slugify(pageTitle), site: window.location.hostname,
              title: pageTitle, text: null, isSelf: true }
          })()

          const domainEntries = await loadDomainEntries(await specsP, origin)
          const total = domainEntries.reduce((n, e) => n + e.pages.length, 0)
          status.textContent = (subject ? `${subjectNote(s)} · ` : '') +
            `Searching ${total.toLocaleString()} pages…`

          let qVec = await lookupPageVector(s.slug, s.site)
          if (!qVec) {
            status.textContent = 'Embedding page (not yet indexed)…'
            const pageText = s.text || $page.find('.item')
              .map((_, el) => $(el).text().trim()).get().filter(Boolean).join('\n')
            qVec = await getEmbedding(pageText || s.title, origin)
          }

          const scored = cosineScan(qVec, domainEntries, {
            threshold, limit, excludeSlug: s.slug, excludeDomain: s.site,
          })
          renderScored(scored, null)
          if (subject) {  // keep the subject visible above the results
            status.textContent = subjectNote(s)
            status.style.display = ''
          }
          if (scored.length && !subject) writeCache(item, { scored })
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

    // SUBJECT: the host page IS the query — prefill its title (editable) and
    // seed the server search with its stored vector.
    if (subject && !input.value) input.value = subject.title

    // Preload the lightweight domain listing (counts only, no vectors) so the
    // status line shows scope and config before any search is issued.
    ;(async () => {
      try {
        const eff = await specsP
        const domains = await resolveDomains(eff.length ? eff : ['*'], origin)
        const pages = domains.reduce((n, d) => n + (d.page_count || 0), 0)
        readyLine = configSummary('Report ready', pages, domains.length)
        if (farms.length) readyLine += ` · +${farms.length} peer farm${farms.length > 1 ? 's' : ''}`
        if (subject) readyLine = `${subjectNote(subject)} · ${readyLine}`
        status.textContent = readyLine
      } catch (e) {
        status.textContent = `Domain listing unavailable: ${e.message}`
      }
    })()

    // The embedder and the keyword index share nothing: one can be down while
    // the other is perfectly healthy. A report that cannot embed its query
    // should say so and answer with words, not leave an error and no results.
    // 502/503 are what the server sends when embedding is unavailable — a
    // missing local embedder, or the circuit breaker open after crashes.
    const EMBEDDER_DOWN = new Set([502, 503])

    const keywordInstead = async (query, eff) => {
      const pattern = encodeURIComponent((eff.length ? eff : ['*']).join(','))
      const farmsParam = farms.length ? `&farms=${encodeURIComponent(farms.join(','))}` : ''
      const res = await fetch(
        `${origin}/system/farm-search.json?q=${encodeURIComponent(query)}&pattern=${pattern}&limit=${limit}${farmsParam}`)
      if (!res.ok) throw new Error(`keyword search also failed: ${res.status}`)
      const page = await res.json()
      // The server titles this page "… Keyword Search", so the reader can see
      // which tier answered without being told twice.
      window.wiki.showResult(window.wiki.newPage(page), { $page: div.parents('.page') })
    }

    const doReport = async () => {
      const query = input.value.trim()
      if (!query) return
      btn.disabled = true
      status.textContent = farms.length ? 'Generating report (asking peer farms)…' : 'Generating report…'
      try {
        const eff = await specsP
        // A hand-edited query is a new question — drop the page seed then.
        const seeded = subject && query === subject.title ? seedParams() : {}
        const body = { query, domains: eff.length ? eff : ['*'], limit, live, ...seeded }
        if (farms.length) body.farms = farms
        if (thresholdSet) body.threshold = threshold
        const res = await fetch(`${origin}/system/search-report.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (EMBEDDER_DOWN.has(res.status)) {
          const body = await res.json().catch(() => ({}))
          const why = (body.error || `status ${res.status}`).replace(/^embedding unavailable: /, '')
          status.textContent = 'Semantic search unavailable — searching by keyword instead…'
          await keywordInstead(query, eff)
          status.textContent = `Semantic search unavailable (${why}) — these are keyword matches, ranked by word not meaning.`
          return
        }
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

  } else if (mode === 'sites') {
    // Sites mode — which site should this page go on? Server aggregates the
    // page-vector scan per domain; result opens as a ghost page.
    const input = div.find('.sim-input')[0]
    const btn   = div.find('.sim-btn')[0]
    let readyLine = `Domains: ${specs.length ? specs.join(', ') : '*'}`

    if (subject && !input.value) input.value = subject.title

    ;(async () => {
      try {
        const eff = await specsP
        const domains = await resolveDomains(eff.length ? eff : ['*'], origin)
        const pages = domains.reduce((n, d) => n + (d.page_count || 0), 0)
        readyLine = configSummary('Site report ready', pages, domains.length)
        if (subject) readyLine = `${subjectNote(subject)} · ${readyLine}`
        status.textContent = readyLine
      } catch (e) {
        status.textContent = `Domain listing unavailable: ${e.message}`
      }
    })()

    const doSites = async () => {
      const query = input.value.trim()
      if (!query) return
      btn.disabled = true
      status.textContent = 'Ranking sites…'
      try {
        const eff = await specsP
        const seeded = subject && query === subject.title ? seedParams() : {}
        const res = await fetch(`${origin}/system/site-report.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, domains: eff.length ? eff : ['*'], limit, ...seeded }),
        })
        if (!res.ok) throw new Error(`site-report failed: ${res.status}`)
        const page = await res.json()
        window.wiki.showResult(window.wiki.newPage(page), { $page: div.parents('.page') })
        status.textContent = readyLine
      } catch (e) {
        status.textContent = `Error: ${e.message}`
      } finally {
        btn.disabled = false
      }
    }

    btn.addEventListener('click', doSites)
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSites() })

  } else if (mode === 'keyword') {
    // Keyword mode — galactic MiniSearch: the server reads each site's own
    // per-edit site-index.json; result opens as a ghost page.
    const input = div.find('.sim-input')[0]
    const btn   = div.find('.sim-btn')[0]

    // SUBJECT: keyword search wants words, not vectors — the host title is
    // the prewired query (editable), finding forks and namesakes alike.
    if (subject && !input.value) input.value = subject.title

    status.textContent = (subject ? `${subjectNote(subject)} · ` : '') +
      `Keyword search ready — domains: ${specs.length ? specs.join(', ') : '*'} · limit ${limit}`

    const doKeyword = async () => {
      const query = input.value.trim()
      if (!query) return
      btn.disabled = true
      status.textContent = 'Searching live site indexes…'
      try {
        const eff = await specsP
        const pattern = encodeURIComponent((eff.length ? eff : ['*']).join(','))
        const farmsParam = farms.length ? `&farms=${encodeURIComponent(farms.join(','))}` : ''
        const res = await fetch(
          `${origin}/system/farm-search.json?q=${encodeURIComponent(query)}&pattern=${pattern}&limit=${limit}${farmsParam}`)
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

    if (subject && !input.value) input.value = subject.title

    ;(async () => {
      try {
        if (!cache) status.textContent = 'Resolving domains…'
        domainEntries = await loadDomainEntries(await specsP, origin)
        const total = domainEntries.reduce((n, e) => n + e.pages.length, 0)
        status.textContent = (subject ? `${subjectNote(subject)} · ` : '') +
          configSummary('Author ready', total, domainEntries.length)
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

    if (subject && !input.value) input.value = subject.title

    ;(async () => {
      try {
        if (!cache) status.textContent = 'Resolving domains…'
        domainEntries = await loadDomainEntries(await specsP, origin)
        const total = domainEntries.reduce((n, e) => n + e.pages.length, 0)
        status.textContent = (subject ? `${subjectNote(subject)} · ` : '') +
          configSummary('Search ready', total, domainEntries.length)
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
