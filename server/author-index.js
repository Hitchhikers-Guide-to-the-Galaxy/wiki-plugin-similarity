// wiki-plugin-similarity — author resolution (CommonJS)
//
// A farm's identity map is not a file we ship: it is every site's own
// status/owner.json, which carries a display name alongside the account that
// owns the site. This module reads those, groups sites by account, and answers
// one question — "which of this farm's sites belong to the person called X?".
//
// Two rules the data forced:
//
//   * A username IS an identity; a display name is only a claim to one. One
//     account can answer to many display names, and two accounts can use the
//     same one. So an exact username match wins outright, and only a shared
//     display name counts as ambiguous.
//   * The map never leaves the farm. Nothing here is exposed on a route, and
//     callers get sites or a verdict — never the map, and never the other
//     names an account is known by. A peer asking on behalf of a person sends
//     the name they typed, and this farm answers from its own records.
//
// Private-farm sites have no oauth2 block; their friend.secret is hashed for
// grouping and never read out.

const fs     = require('node:fs')
const path   = require('node:path')
const crypto = require('node:crypto')

const TTL_MS = parseInt(process.env.WIKI_AUTHOR_INDEX_TTL_MS || '', 10) || 5 * 60_000

// Display names drift between a person's own sites — spacing, case, and dots or
// underscores standing in for spaces.
const fold = s => (s || '').toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim()

const identityKey = owner => {
  const oauth2 = owner.oauth2 || {}
  if (oauth2.username) return 'oauth2:' + oauth2.username
  if (oauth2.id)       return 'oauth2:' + oauth2.id
  const secret = (owner.friend || {}).secret
  if (secret) return 'friend:' + crypto.createHash('sha256').update(secret).digest('hex').slice(0, 12)
  return null
}

let cache = null   // {at, identities: Map(key → {names:Set, sites:Set})}

const buildIndex = farms => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.identities
  const identities = new Map()
  for (const [farm] of farms) {
    let entries
    try { entries = fs.readdirSync(farm, { withFileTypes: true }) } catch { continue }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      let owner
      try {
        owner = JSON.parse(fs.readFileSync(
          path.join(farm, ent.name, 'status', 'owner.json'), 'utf8'))
      } catch { continue }          // unowned or unreadable — simply not in the map
      const key = identityKey(owner)
      if (!key) continue
      if (!identities.has(key)) identities.set(key, { names: new Set(), sites: new Set() })
      const rec = identities.get(key)
      rec.sites.add(ent.name)
      if (owner.name) rec.names.add(owner.name)
    }
  }
  cache = { at: Date.now(), identities }
  return identities
}

// → {available:false}                    this farm keeps no ownership records
//   {ambiguous:[username, …]}            the name belongs to more than one account
//   {sites:[…]}                          resolved (possibly empty — owns nothing here)
const resolveAuthor = (farms, who) => {
  const identities = buildIndex(farms)
  if (!identities.size) return { available: false }

  const want = fold(who)
  const byUsername = [], byDisplay = []
  for (const [key, rec] of identities) {
    const username = key.slice(key.indexOf(':') + 1)
    if (fold(username) === want || key.toLowerCase() === want) byUsername.push({ key, username, rec })
    else if ([...rec.names].some(n => fold(n) === want)) byDisplay.push({ key, username, rec })
  }
  const hits = byUsername.length ? byUsername : byDisplay
  const accounts = [...new Set(hits.filter(h => h.key.startsWith('oauth2:')).map(h => h.username))]
  if (accounts.length > 1) return { ambiguous: accounts }
  return { sites: [...new Set(hits.flatMap(h => [...h.rec.sites]))] }
}

const clearCache = () => { cache = null }

module.exports = { resolveAuthor, clearCache, fold }
