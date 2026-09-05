// wiki-plugin-similarity — SUBJECT — the page an item acts on
// Split out of similarity.js; see the Splitting the Server phase of the plan.

// ── Subject resolution ────────────────────────────────────────────────────────
// SUBJECT makes an item act on the page BEFORE its own in the lineup — the
// host a tool page was opened beside — falling back to the containing page so
// a tool page opened alone still works (and announces the fallback).
// The page div's id IS the slug (possibly _rev-suffixed on a historical view);
// data('data') carries the full raw page JSON; data('site') is set only on
// remote pages. `text` is title + opening prose, capped: the BGE-small
// embedder truncates around 512 tokens, so more would be discarded anyway.

// Tool pages are never the subject: opened from the ☰ menu, the page before
// this one is Selected Plugin Pages, and the reader means the page before
// that. Walk back past any of these to the page they were actually reading.
const TOOL_SLUGS = new Set(['selected-plugin-pages', 'search-tool', 'like-this-page', 'semantic-search',
                            'search-algorithm', 'personal-search-demo', 'search-tool-demo'])
const slugOfPage = $p => (($p.attr('id') || '').split('_rev')[0])

const resolveSubject = div => {
  const $self = div.parents('.page:first')
  let $host = $self.prev('.page')
  while ($host.length && TOOL_SLUGS.has(slugOfPage($host))) $host = $host.prev('.page')
  const $page = $host.length ? $host : $self
  const slug  = ($page.attr('id') || '').split('_rev')[0]
  const site  = $page.data('site') || window.location.hostname
  const data  = $page.data('data') || {}
  const title = data.title || $page.find('.title').text().trim() || slug
  const text  = [title, ...(data.story || [])
    .filter(i => i.type === 'markdown' || i.type === 'paragraph')
    .map(i => (i.text || '').trim()).filter(Boolean)].join('\n').slice(0, 2000)
  return { slug, site, title, text, isSelf: !$host.length }
}

const subjectNote = s =>
  `Subject: ${s.title}${s.isSelf ? ' (this page)' : ` @ ${s.site}`}`

export { resolveSubject, subjectNote }
