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

import { parseDSL, DEFAULT_LIMIT, isScope, isGlob } from './dsl.js'
import { slugify, effectiveSpecs, resolveDomains } from './scope.js'
import { loadVectors, getEmbedding, lookupPageVector, cosineScan, loadDomainEntries } from './vectors.js'
import { resolveSubject, subjectNote } from './subject.js'
import { readCache, writeCache, cacheAge } from './cache.js'
import { runBatched, keyOf } from './batch.js'
import { loadAlgorithm, parseAlgorithm, learnedSignals } from './algorithm.js'
import { credit, learned, forget, installAmbient, rememberInto } from './learn.js'
import { STYLES, siteFlag } from './styles.js'
import { install, takePending } from './searchdoor.js'

// ── similarity item ────────────────────────────────────────────────────────────

const simLink = (domain, slug, title, score) =>
  `<a class="sim-link" data-title="${title}" data-slug="${slug}" data-site="${domain}" href="#">` +
  `${siteFlag(domain, score)} ${title}</a>`

const shortDate = ms => {
  try { return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) } catch { return '' }
}

// The graveyard's verdicts as this farm last read them from the graveyard
// wiki's sitemap (Dead Sites Plan): one request, every verdict.
const verdictRow = v => {
  if (!v || !v.feed) return ''
  const by = v.by || {}
  const order = ['abandoned', 'stale', 'dead', 'moved', 'lapsed', 'unreliable', 'flaky']
  const parts = order.filter(k => by[k]).map(k => `${by[k].toLocaleString()} ${k}`)
  const feedHost = String(v.feed).replace(/^https?:\/\//, '')
  const when = v.fetchedAt ? new Date(v.fetchedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
  const what = v.sites ? `${v.sites.toLocaleString()} sites${parts.length ? ` — ${parts.join(', ')}` : ''}` : 'none yet'
  return `<tr><th>Graveyard verdicts</th><td>${what} — read from <code>${feedHost}</code>'s sitemap, ${when}</td></tr>`
}

// A merged batch result as a page, the same shape search-report renders.
const flatPage = (query, merged) => {
  const id = () => Math.random().toString(16).slice(2, 18).padEnd(16, '0')
  const story = [{ type: 'markdown', id: id(),
    text: `Federated search for **${query}** — ${merged.length} results, searched a batch at a time, nearest sites first.` }]
  const titles = [...new Set(merged.map(r => r.title))]
  if (titles.length) story.push({ type: 'markdown', id: id(), text: titles.map(t => `- [[${t}]]`).join('\n') })
  story.push({ type: 'markdown', id: id(), text: '# Results' })
  for (const r of merged) {
    story.push({ type: 'reference', id: id(), site: r.site, slug: r.slug, title: r.title,
      text: (r.synopsis || `score ${r.score}`) + (r.via ? ` — via ${r.via}` : '') })
  }
  return { title: `${query} Federated Search`, story }
}

export const emit = (div, item) => {
  const { mode, specs, threshold, limit, force, ghostUrl, label } = parseDSL(item?.text || '')
  if (mode === 'ghost') {
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}" data-mode="${mode}" data-scope="${specs.join(',') || ''}">
        <div class="sim-form">
          <button class="sim-btn">${label || 'Open'}</button>
        </div>
        <div class="sim-status"></div>
      </div>`)
  } else if (mode === 'build') {
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}" data-mode="${mode}" data-scope="${specs.join(',') || ''}">
        <div class="sim-form">
          <button class="sim-btn">${label || `Index ${specs.length ? specs.join(', ') : '*'}${force ? ' (force)' : ''}`}</button>
        </div>
        <div class="sim-status"></div>
      </div>`)
  } else if (mode === 'list') {
    const label = specs.length ? specs.join(', ') : '*'
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}" data-mode="${mode}" data-scope="${specs.join(',') || ''}">
        <div class="sim-status">Loading indexed domains (${label})…</div>
        <div class="sim-list"></div>
      </div>`)
  } else if (mode === 'algorithm') {
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}" data-mode="${mode}" data-scope="">
        <div class="sim-status">Reading this search algorithm…</div>
        <div class="sim-list"></div>
      </div>`)
  } else if (mode === 'status') {
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}" data-mode="${mode}" data-scope="${specs.join(',') || ''}">
        <div class="sim-status">Reading the state of the index…</div>
        <div class="sim-list"></div>
      </div>`)
  } else if (mode === 'similar') {
    const label = specs.length ? specs.join(', ') : 'current domain'
    div.html(`
      <style>${STYLES}</style>
      <div class="similarity" data-id="${item.id}" data-mode="${mode}" data-scope="${specs.join(',') || ''}">
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
      <div class="similarity" data-id="${item.id}" data-mode="${mode}" data-scope="${specs.join(',') || ''}">
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
      <div class="similarity" data-id="${item.id}" data-mode="${mode}" data-scope="${specs.join(',') || ''}">
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
    force, ghostUrl, thresholdSet, batch, algorithm: algorithmRef } = parseDSL(item?.text || '')
  const origin  = window.location.origin
  const status  = div.find('.sim-status')[0]
  installAmbient()   // learn.js: neighbourhood + visits, once per page load
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
  // An explicit domain spec is taken at its word rather than looked up, so its
  // page count is unknown — not zero. Saying "0 pages" there told a reader
  // their site was unindexed when it was merely unqueried.
  const configSummary = (verb, pages, nDomains) => {
    const scale = pages > 0
      ? `${pages.toLocaleString()} pages across ${nDomains} domains`
      : `${nDomains} domain${nDomains === 1 ? '' : 's'}`
    const parts = [`${verb} — ${scale}`]
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
    // The vector store (0.18.0): what is resident in memory right now, and
    // whether the warm-up has finished — a federation search costs
    // milliseconds once it has, and a cold parse until it has.
    const storeRow = st => {
      if (!st || !st.warm) return ''
      const w = st.warm
      const mb = Math.round((st.bytes || 0) / 1e6)
      const state = w.state === 'warm'
        ? `warm — ${w.done.toLocaleString()} sites resident in ${Math.round(w.ms / 1000)} s`
        : w.state === 'warming' ? `warming — ${w.done.toLocaleString()} of ${w.total.toLocaleString()} sites so far`
        : 'not warmed'
      const capped = w.capped ? ' · <strong>cap reached</strong>, some sites re-parse per query' : ''
      return `<tr><th>Vector store</th><td>${(st.pages || 0).toLocaleString()} pages · ${mb} MB of ${Math.round((st.capBytes || 0) / 1e6)} MB · ${state}${capped}</td></tr>`
    }

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
            ${storeRow(health.store)}
            ${verdictRow(health.verdicts)}
          </table>
          <p class="sim-count">A domain's vectors are only rebuilt when its pages change, so an old
             date means a quiet site, not a broken one. Pages saved since the last build are findable
             by keyword but not yet by meaning.</p>`
      } catch (e) {
        status.textContent = `Index state unavailable: ${e.message}`
      }
    })()

  } else if (mode === 'algorithm') {
    // The item IS the reader's search algorithm: show what the ranker will
    // read from it, and what the browser has learned so far (algorithm.js).
    // Rendered a tick later, like every other mode: a synchronous render
    // here was wiped by a second emit wiki-client runs on the item at load.
    setTimeout(() => {
    const listDiv = div.find('.sim-list')[0]
    try {
      const a = parseAlgorithm(item.text || '')
      const learned = learnedSignals()
      const top = Object.entries(learned).sort((x, y) => y[1] - x[1]).slice(0, 8)
      status.style.display = 'none'
      listDiv.innerHTML = `<h3>This Search Algorithm</h3>
        <table>
          ${Object.entries(a.weights).map(([k, v]) => `<tr><th>weight ${k}</th><td>${v}</td></tr>`).join('')}
          <tr><th>always</th><td>${a.always.length ? a.always.join(', ') : '—'}</td></tr>
          <tr><th>never</th><td>${a.never.length ? a.never.join(', ') : '—'}</td></tr>
          <tr><th>batch</th><td>${a.batch || 50}</td></tr>
        </table>
        <p class="sim-count">Learned in this browser: ${top.length
          ? top.map(([d, v]) => `${d} (${v.toFixed(2)})`).join(', ')
          : 'nothing yet — sites you are near, open and click will appear here'}</p>
        <p class="sim-count"><button class="sim-remember">Remember</button> <button class="sim-forget">Forget</button>
          <span class="sim-remember-note"></span></p>`
      const note = listDiv.querySelector('.sim-remember-note')
      listDiv.querySelector('.sim-remember').addEventListener('click', async () => {
        try {
          const n = await rememberInto(div.parents('.page'))
          note.textContent = `${n} sites written into "Sites I visit" — read the roster above, delete any line.`
        } catch (e) { note.textContent = `Could not remember here: ${e.message}` }
      })
      listDiv.querySelector('.sim-forget').addEventListener('click', () => {
        forget(); note.textContent = 'Forgotten — the browser starts learning again from here.'
      })
    } catch (e) {
      status.textContent = `Algorithm unreadable: ${e.message}`
    }
    }, 0)

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

          // One request (Personal Search Plan, Phase 1): the server holds every
          // vector and the seed page's own, so it answers a seeded report in
          // one round trip. This item used to pull every site's vectors into
          // the browser — 417 requests and 167 MB on the Cafe — before it
          // could score a single page.
          const eff = await specsP
          status.textContent = (subject ? `${subjectNote(s)} · ` : '') + 'Asking for pages like this one…'
          const pageText = s.text || $page.find('.item')
            .map((_, el) => $(el).text().trim()).get().filter(Boolean).join('\n').slice(0, 2000)
          const body = {
            query: s.title, domains: eff.length ? eff : ['*'], limit, flat: true,
            seed: { site: s.site, slug: s.slug }, text: pageText || s.title,
            excludePage: { site: s.site, slug: s.slug },
          }
          if (thresholdSet) body.threshold = threshold
          const res = await fetch(`${origin}/system/search-report.json`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
          if (!res.ok) throw new Error(`search-report failed: ${res.status}`)
          const flat = await res.json()
          const scored = (flat.results || []).map(r => ({
            domain: r.site, slug: r.slug, title: r.title, score: r.semantic ?? r.score,
          }))
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
        // A batched item searches by the Site Index, not this farm's vector
        // listing — so say how far the index reaches, not how many domains
        // this host happens to hold (0 on a farm with no galaxy tree).
        const isBatched = batch != null ? batch > 0 : eff.some(sp => sp.toUpperCase() === 'GALAXY')
        if (isBatched) {
          try {
            const health = await fetch(`${origin}/system/similarity-health.json`).then(r => r.json())
            const si = health.siteIndex || {}
            const named = eff.filter(sp => /\./.test(sp) && !/[*?]/.test(sp) &&
              !['PUBLIC', 'LOCAL', 'PRIVATE', 'GALAXY'].includes(sp.toUpperCase()))
            const reach = si.count
              ? `ranks ${si.count.toLocaleString()} sites from the Site Index${si.via === 'peer' ? ' (a peer\'s copy)' : ''}`
              : 'no Site Index on this farm — batches ask its peers'
            const parts = [`Ready — ${reach}`]
            if (named.length) parts.push(`${named.length} named site${named.length > 1 ? 's' : ''} searched wherever held`)
            if (thresholdSet) parts.push(`threshold ${threshold}`)
            parts.push(`limit ${limit}`)
            readyLine = parts.join(' · ')
          } catch { /* keep the domain summary */ }
        }
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

    // Incremental federated search (batch.js): on by default for a scope
    // that reaches the galaxy, off for a farm-only scope, BATCH n/off decides.
    const batched = eff => batch != null ? batch > 0
      : eff.some(sp => sp.toUpperCase() === 'GALAXY')
    const results = div.find('.sim-results')[0]

    const doBatched = async (query, eff, seeded, resume = null) => {
      const algorithm = await loadAlgorithm(algorithmRef, origin)
      const rosterDomains = eff.filter(sp => !isScope(sp) && sp !== '*' && !isGlob(sp))
      let ghost = null
      const openAsPage = merged => {
        const page = flatPage(query, merged)
        if (ghost) ghost.remove()
        window.wiki.showResult(window.wiki.newPage(page), { $page: div.parents('.page') })
        ghost = div.parents('.page').next('.page')
      }
      const render = (merged, state) => {
        const shown = state.shown && state.shown.length ? state.shown : merged.slice(0, limit)
        const head = state.running
          ? `Searched ${state.searched.toLocaleString()} of ${state.total.toLocaleString()} sites — ` +
            `${merged.length} results — searching…`
          : state.converged
            ? `Searched ${state.searched.toLocaleString()} of ${state.total.toLocaleString()} sites — ` +
              `${merged.length} results — the top ${limit} stopped changing`
            : `Searched ${state.searched.toLocaleString()} of ${state.total.toLocaleString()} sites — ` +
              `${merged.length} results`
        const rest = state.total - state.searched
        // Which indexer answered, and how old its index is (Mini Indexer
        // Plan, Phase 4): the batches say who held each site, the Site Index
        // says when each site was last indexed and which indexer placed it.
        const answered = Object.entries(state.answered || {})
          .filter(([, n]) => n > 0)
          .map(([h, n]) => `${h === 'local' ? 'this farm' : h} (${n.toLocaleString()} site${n === 1 ? '' : 's'})`)
        const built = state.siteIndex?.builtAt ? ` · site index built ${shortDate(state.siteIndex.builtAt)}` : ''
        const tier = `<small class="sim-tier">semantic · nearest sites first${answered.length ? ` · answered by ${answered.join(', ')}` : ''}${built}</small>`
        const provenance = r => {
          const info = state.siteInfo?.get(r.site)
          const bits = []
          if (r.via) bits.push(`via ${r.via}`)
          if (info?.indexedAt) bits.push(`indexed ${shortDate(info.indexedAt * 1000)}${info.placedBy ? ` by ${info.placedBy}` : ''}`)
          return bits.length ? ` <small class="sim-src">${bits.join(' · ')}</small>` : ''
        }
        const opened = state.opened || new Set()
        const pendingLine = state.pending
          ? `<li class="sim-pending"><small>${state.pending} new result${state.pending > 1 ? 's' : ''} rank${state.pending > 1 ? '' : 's'} above — ` +
            `<button class="sim-fold">fold in</button></small></li>` : ''
        const cachedNote = state.resumed && !state.running && cache?.batched?.ts ? ` · ${cacheAge(cache.batched.ts)}` : ''
        results.innerHTML = `<h3>${head}${cachedNote}</h3>${tier}<ul>${pendingLine}${
          shown.map(r => `<li${opened.has(keyOf(r)) ? ' class="sim-opened"' : ''}>${simLink(r.site, r.slug, r.title, r.semantic)}` + provenance(r) +
            (opened.has(keyOf(r)) ? ` <small class="sim-mark">opened</small>` : '') +
            (r.siblings?.length ? ` <small>+${r.siblings.length}</small>` : '') +
            (r.movedFrom ? ` <small>moved here from ${r.movedFrom}</small>` : '') +
            (r.gone ? ` <small>site ${r.gone}${r.movedTo ? `, probably now ${r.movedTo}` : ''}</small>` : '') + '</li>').join('')
        }</ul><p class="sim-count sim-batch-controls">` +
          (state.running ? `<button class="sim-stop">Stop</button>` : '') +
          (!state.running && rest > 0 ? `<button class="sim-more">Search the remaining ${rest.toLocaleString()} sites</button>` : '') +
          (!state.running && merged.length ? `<button class="sim-open">Open as page</button>` : '') +
          (state.unindexed?.length && !state.running
            ? `<br><small>Sites that look relevant but carry no page vectors yet: ${state.unindexed.slice(0, 8).join(', ')}</small>` : '') +
          `</p>`
        results.querySelector('.sim-stop')?.addEventListener('click', () => state.stop())
        results.querySelector('.sim-more')?.addEventListener('click', () => state.continueAll())
        results.querySelector('.sim-open')?.addEventListener('click', () => openAsPage(merged))
        results.querySelector('.sim-fold')?.addEventListener('click', () => state.foldIn())
        results.querySelectorAll('.sim-link').forEach(a => a.addEventListener('click', e => {
          e.preventDefault()
          const { site, slug, title } = a.dataset
          credit(site, 'clicked')
          // the result opens beside the list; the list marks it and keeps its place
          state.markOpened(keyOf({ site, slug }))
          window.wiki.pageHandler.context = { site: window.location.hostname, slug: 'search-tool' }
          window.wiki.doInternalLink(title, div.parents('.page'), site)
        }))
      }
      status.textContent = ''
      const out = await runBatched({
        origin, query, seeded, specs: eff.length ? eff : ['GALAXY'], limit, threshold, thresholdSet,
        batch: batch || 100, roster: rosterDomains, algorithm, render, resume,
        status: t => { status.textContent = t },
        // remember the list per item and query, so coming back shows it at once
        save: snap => writeCache(item, { batched: { ...snap, ts: Date.now() } }),
      })
      status.textContent = readyLine
      return out
    }

    const doReport = async () => {
      const query = input.value.trim()
      if (!query) return
      btn.disabled = true
      status.textContent = farms.length ? 'Generating report (asking peer farms)…' : 'Generating report…'
      try {
        const eff = await specsP
        if (batched(eff)) {
          const seeded = subject && query === subject.title ? seedParams() : {}
          await doBatched(query, eff, seeded)
          return
        }
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

    // A query typed into the wiki's search box and sent here by the search
    // door. Only the farm-wide report takes it: that is the scope the box
    // used to search, and picking any nearer one would quietly narrow it.
    let handedOver = false
    if (mode === 'report' && specs.join(',') === '*') {
      const handed = takePending()
      if (handed) { input.value = handed; doReport(); handedOver = true }
    }
    // Keep your place: a batched item that remembers a list for this exact
    // DSL draws it at once and carries on from where it stopped — no
    // re-ranking, no refetch of what was already read.
    if (!handedOver && mode === 'report' && cache?.batched?.query) {
      const remembered = cache.batched
      input.value = remembered.query
      ;(async () => {
        try {
          const eff = await specsP
          if (!batched(eff)) return
          const seeded = subject && remembered.query === subject.title ? seedParams() : {}
          await doBatched(remembered.query, eff, seeded, remembered)
        } catch (e) { status.textContent = `Remembered list unavailable: ${e.message}` }
      })()
    }

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
  // editor: declared so wiki-client's preLoadEditors fetches this plugin on
  // every page, which is what puts the search door (below) on pages that carry
  // no similarity item. It hands straight back to the standard text editor, so
  // creating and editing an item behaves exactly as it did before.
  window.plugins.similarity = {
    emit,
    bind,
    editor: ($item, item) => window.wiki.textEditor($item, item),
  }
  install()
}
