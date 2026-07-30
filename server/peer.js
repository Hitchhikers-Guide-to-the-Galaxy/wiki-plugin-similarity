// wiki-plugin-similarity — peer federation transport and guards (CommonJS)
//
// Everything a farm needs to ASK another farm, and to survive being asked: the
// HTTP transport, the hello probe and its cache, replay dedup, and the rate
// limits. Split out of server.js so the part carrying a security surface can be
// read on its own — the routes stay beside the search they call.
//
// Nothing here knows how a search works; it moves envelopes and enforces limits.

const http   = require('node:http')
const https  = require('node:https')
const crypto = require('node:crypto')

let MODEL_META = {}
const setModelMeta = m => { MODEL_META = m }

const { makeDedup, makeBucket } = require('./peer-guard')

// POST JSON to a peer farm's plugin server. Public peers speak https;
// *.localhost peers speak http via a loopback lookup (Node's resolver does
// not know RFC 6761 subdomains). Public domains follow /etc/hosts, so
// Offline Edit Mode routes peer calls to the local mirror by construction.
const postToPeer = (peer, routePath, body, timeoutMs = 30_000) =>
  new Promise((resolve, reject) => {
    const isLocal = peer.endsWith('.localhost') || peer.startsWith('localhost')
    const mod = isLocal ? http : https
    const payload = JSON.stringify(body)
    const opts = {
      hostname: peer.split(':')[0],
      port: peer.includes(':') ? peer.split(':')[1] : (isLocal ? 80 : 443),
      path: routePath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: timeoutMs,
    }
    if (isLocal) opts.lookup = (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }])
    const req = mod.request(opts, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch {
          resolve({ status: res.statusCode,
            body: { error: `no similarity server answered (${res.statusCode})` } })
        }
      })
    })
    req.on('timeout', () => { req.destroy(new Error('peer timeout')) })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })

// Append peer farms' results to a locally-built report page. Each peer gets
// its own section; provenance rides on the reference items' site field.
// Scores merge visually only when the peer declares the same embedding model.
const appendPeerSections = (page, peerOutcomes) => {
  const mk = () => crypto.randomBytes(8).toString('hex')
  for (const { peer, status, body } of peerOutcomes) {
    if (status === 200 && body.page) {
      const sameModel = body.meta && body.meta.model === MODEL_META.model
      page.story.push({
        type: 'markdown', id: mk(),
        text: `# From ${peer}\n\n<small>${body.meta?.count ?? '?'} results — ` +
          `model ${body.meta?.model || 'undeclared'}${sameModel ? '' :
            ' (different model: scores not comparable with local results)'}</small>`,
      })
      for (const item of body.page.story || []) {
        if (item.type === 'reference') page.story.push({ ...item, id: mk() })
      }
    } else {
      page.story.push({
        type: 'markdown', id: mk(),
        text: `<small>Peer ${peer}: ${body?.error || `failed (${status})`}</small>`,
      })
    }
  }
  return page
}

// ── One desk per server ───────────────────────────────────────────────────────
// The buckets and the dedup window are per-farm state, built once at startup.
// MODEL_META is injected because appendPeerSections compares a peer's declared
// model against ours before letting scores sit together.

const makePeerDesk = () => {
  // Peer federation guards (shared across peer requests). Rate limits are
  // keyed by remote IP — never by the asserted origin — plus a global cap.
  const isDuplicate     = makeDedup()
  const takeIpToken     = makeBucket()
  const takeGlobalToken = makeBucket({ capacity: 120, refillPerSec: 2, maxKeys: 1 })

  const requestIp = req =>
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress || 'unknown'

  // GET JSON from a peer (hello probe) — same transport rules as postToPeer.
  const getFromPeer = (peer, routePath, timeoutMs = 10_000) =>
    new Promise((resolve, reject) => {
      const isLocal = peer.endsWith('.localhost') || peer.startsWith('localhost')
      const mod = isLocal ? http : https
      const opts = {
        hostname: peer.split(':')[0],
        port: peer.includes(':') ? peer.split(':')[1] : (isLocal ? 80 : 443),
        path: routePath,
        timeout: timeoutMs,
      }
      if (isLocal) opts.lookup = (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }])
      const req = mod.get(opts, res => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
          catch { resolve({ status: res.statusCode, body: null }) }
        })
      })
      req.on('timeout', () => { req.destroy(new Error('peer timeout')) })
      req.on('error', reject)
    })

  // Hello probe cache: peer → {at, ok, body}. TTL 1h, small LRU.
  const helloCache = new Map()
  const HELLO_TTL = 60 * 60_000

  const probePeer = async peer => {
    const hit = helloCache.get(peer)
    if (hit && Date.now() - hit.at < HELLO_TTL) return hit
    let entry
    try {
      const { status, body } = await getFromPeer(peer, '/system/peer-hello.json')
      entry = { at: Date.now(), ok: status === 200 && body && body.plugin, body }
    } catch {
      entry = { at: Date.now(), ok: false, body: null }
    }
    helloCache.set(peer, entry)
    if (helloCache.size > 200) helloCache.delete(helloCache.keys().next().value)
    return entry
  }

  const askPeers = async (peers, envelope) => {
    const outcomes = await Promise.all(peers.map(async peer => {
      const hello = await probePeer(peer)
      if (!hello.ok) {
        return { peer, status: 0,
          body: { error: 'peer does not answer hello — no similarity federation there' } }
      }
      if (hello.body.federation && hello.body.federation.enabled === false) {
        return { peer, status: 0, body: { error: 'peer has federation switched off' } }
      }
      try {
        const { status, body } = await postToPeer(peer, '/system/peer-search.json', envelope)
        return { peer, status, body }
      } catch (e) {
        return { peer, status: 0, body: { error: e.message } }
      }
    }))
    return outcomes
  }
  return { requestIp, getFromPeer, probePeer, askPeers,
           isDuplicate, takeIpToken, takeGlobalToken }
}

module.exports = { postToPeer, appendPeerSections, makePeerDesk, setModelMeta }
