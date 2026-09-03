// wiki-plugin-similarity — the search door
//
// The `search` link at the foot of every page, and the search box beside it,
// both build their result page in JavaScript: a fixed set of items, identical
// on every site, that no owner can edit. This redirects both to the Search
// Tool page, which is a real wiki page — shipped by this plugin, overridable
// by forking it.
//
// Why this lives in a plugin at all. The honest home for a change to the
// footer link is wiki-client, but wiki-client is bundled inside the wiki
// package: on the public farm that comes from an image we do not build, and
// the plugin door we do have installs wiki-plugin-* packages only. So a client
// fork could never reach the sites that need this most.
//
// Plugin bundles load lazily, by item type, so a plugin is normally absent
// from a page that does not use it. The one exception is preLoadEditors: a
// plugin whose factory declares an editor is fetched on every page load. This
// plugin declares one — delegating to the standard text editor, so editing
// behaves exactly as before — and that is what gets this file onto the page.
//
// Capture phase, because wiki-client binds the same link by delegation on a
// parent; stopping propagation there is what keeps the fabricated page from
// being built underneath us.

const SEARCH_TOOL = 'Search Tool'
const SLUG = 'search-tool'

// Only take the link over if the page is actually there. A site whose server
// cannot serve it — an older plugin, or a server that answers no plugin
// routes at all — keeps today's behaviour untouched, and nobody meets a dead
// link. Checked once, at load, so the click itself stays synchronous.
let available = null
const checkAvailable = () =>
  fetch(`/${SLUG}.json`, { method: 'GET' })
    .then(r => { available = r.ok })
    .catch(() => { available = false })

// The page the clicked link belongs to. doInternalLink opens the new page
// straight after it, which is what SUBJECT reads: "pages like the one I came
// from" needs no context passed, only the right position in the lineup.
const pageOf = target => {
  const $page = window.$(target).parents('.page')
  return $page.length ? $page : null
}

const openSearchTool = ($page, keepLineup) => {
  // Shift-click keeps what is already open, matching the behaviour it replaces.
  window.wiki.doInternalLink(SEARCH_TOOL, keepLineup ? null : $page)
}

const install = () => {
  if (typeof document === 'undefined' || !window.wiki || !window.$) return

  checkAvailable()

  document.addEventListener('click', e => {
    if (available !== true) return
    const link = e.target && e.target.closest && e.target.closest('a.search')
    if (!link) return
    const $page = pageOf(link)
    if (!$page) return
    e.preventDefault()
    e.stopPropagation()
    openSearchTool($page, e.shiftKey)
  }, true)

  // The search box: Enter builds the same fabricated page. Send it to the
  // Search Tool instead, carrying the query into the farm-wide search there
  // and running it, so a typed question still lands on results — on a page
  // the owner can change.
  document.addEventListener('keydown', e => {
    if (available !== true) return
    if (e.key !== 'Enter') return
    const input = e.target
    if (!input || !input.classList || !input.classList.contains('search')) return
    if (!input.closest('.searchbox')) return
    const query = (input.value || '').trim()
    if (!query) return
    e.preventDefault()
    e.stopPropagation()
    window.$('.incremental-search').remove()
    input.value = ''
    setPending(query)
    openSearchTool(window.$('.page').last(), false)
  }, true)
}

// Handing the query over, rather than racing the page.
//
// The first attempt polled for the search button and clicked it. The button
// exists as soon as the item is drawn, but its handler is attached later, when
// the item binds — so the click landed on nothing and the query sat in the box
// unrun. Instead the door leaves the query here and the report item collects
// it as it finishes wiring, which has no timing to get wrong.
let pending = null
const setPending = q => { pending = q }
const takePending = () => { const q = pending; pending = null; return q }

export { install, takePending }
