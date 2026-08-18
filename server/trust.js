// wiki-plugin-similarity — who may see restricted sites (CommonJS)
//
// Restricted (login-to-view / tailnet-only) sites are hidden from every
// /system route unless the CALLER is trusted. Three ways to be trusted:
//
//   1. an owner/admin session on this wiki (app.securityhandler);
//   2. a direct loopback connection with no X-Forwarded-For — a tool on the
//      same host (wiki-search, an indexer, a healthcheck);
//   3. a loopback connection carrying X-Forwarded-For whose first hop is in
//      WIKI_TRUSTED_NETS — the reverse proxy in front of us (Caddy) vouching
//      for a tailnet client. The header is believed ONLY when the direct
//      peer is loopback: a LAN client hitting the wiki port directly cannot
//      forge its way in by adding the header.
//
// A cross-origin browser request (Origin host ≠ Host) is never trusted, even
// from a trusted network: otherwise any web page open in a tailnet member's
// browser could read private results through the permissive CORS header.
//
// Default nets: Tailscale CGNAT + Tailscale ULA + loopback.

const net = require('node:net')

const DEFAULT_NETS = '100.64.0.0/10,fd7a:115c:a1e0::/48,127.0.0.0/8,::1'

const parseNets = (spec = process.env.WIKI_TRUSTED_NETS || DEFAULT_NETS) =>
  String(spec).split(',').map(s => s.trim()).filter(Boolean)

// Strip IPv4-mapped IPv6 and zone ids: "::ffff:127.0.0.1" → "127.0.0.1".
const normalizeIp = ip => {
  if (!ip) return ''
  let s = String(ip).trim()
  const zone = s.indexOf('%')
  if (zone !== -1) s = s.slice(0, zone)
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  return m ? m[1] : s
}

const ipToBigInt = ip => {
  const kind = net.isIP(ip)
  if (kind === 4) {
    return ip.split('.').reduce((n, o) => (n << 8n) + BigInt(o), 0n)
  }
  if (kind === 6) {
    // expand :: and any embedded dotted-quad tail
    let [head, tail = ''] = ip.split('::')
    const toGroups = part => part ? part.split(':').flatMap(g => {
      if (g.includes('.')) {
        const v = Number(ipToBigInt(g))
        return [(v >>> 16).toString(16), (v & 0xffff).toString(16)]
      }
      return [g]
    }) : []
    const h = toGroups(head), t = toGroups(tail)
    const groups = ip.includes('::')
      ? [...h, ...new Array(8 - h.length - t.length).fill('0'), ...t]
      : h
    if (groups.length !== 8) return null
    return groups.reduce((n, g) => (n << 16n) + BigInt(parseInt(g, 16)), 0n)
  }
  return null
}

// ip within CIDR (or exact address when no prefix). Mixed families never match.
const inCidr = (ip, cidr) => {
  const [base, bitsRaw] = String(cidr).split('/')
  const a = normalizeIp(ip), b = normalizeIp(base)
  const fa = net.isIP(a), fb = net.isIP(b)
  if (!fa || fa !== fb) return false
  const width = fa === 4 ? 32 : 128
  const bits = bitsRaw === undefined ? width : parseInt(bitsRaw, 10)
  if (!(bits >= 0 && bits <= width)) return false
  const x = ipToBigInt(a), y = ipToBigInt(b)
  if (x === null || y === null) return false
  const shift = BigInt(width - bits)
  return (x >> shift) === (y >> shift)
}

const inAnyNet = (ip, nets) => nets.some(n => inCidr(ip, n))

const LOOPBACK = ['127.0.0.0/8', '::1']
const isLoopback = ip => inAnyNet(ip, LOOPBACK)

// The network side of trust: direct peer address + first X-Forwarded-For hop.
const trustedNetwork = (req, nets = parseNets()) => {
  const direct = normalizeIp(req.socket && req.socket.remoteAddress)
  if (!isLoopback(direct)) return false
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  if (!xff) return true                       // a tool on this very host
  return inAnyNet(normalizeIp(xff), nets)     // the proxy vouches for a client
}

// Cross-origin browser requests are never trusted (see header comment).
const crossOrigin = req => {
  const origin = req.headers.origin
  if (!origin) return false
  try { return new URL(origin).host !== String(req.headers.host || '') }
  catch { return true }
}

// Owner/admin session on this wiki. isAuthorized() answers true for an
// UNCLAIMED site under some security modules, so it only counts when the
// site actually has an owner file to be authorised against.
const trustedSession = (req, securityhandler, ownerFileExists) => {
  const sh = securityhandler
  if (!sh) return false
  try { if (sh.isAdmin && sh.isAdmin(req)) return true } catch { /* not admin */ }
  try { if (ownerFileExists && sh.isAuthorized && sh.isAuthorized(req)) return true }
  catch { /* not authorised */ }
  return false
}

const isTrusted = (req, { securityhandler = null, ownerFileExists = false, nets = parseNets() } = {}) => {
  if (crossOrigin(req)) return false
  if (trustedSession(req, securityhandler, ownerFileExists)) return true
  return trustedNetwork(req, nets)
}

module.exports = { DEFAULT_NETS, parseNets, normalizeIp, inCidr, inAnyNet,
                   isLoopback, trustedNetwork, crossOrigin, trustedSession, isTrusted }
