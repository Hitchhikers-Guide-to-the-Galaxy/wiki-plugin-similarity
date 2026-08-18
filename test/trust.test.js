// Restricted-site visibility: who counts as a trusted caller (server/trust.js)
// and how restricted globs behave (server/farm-lib.js RestrictedSet).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const trust = require('../server/trust.js')
const { RestrictedSet, loadRestricted, matchesAny } = require('../server/farm-lib.js')

const req = ({ remote = '127.0.0.1', xff = null, origin = null, host = 'wiki.example' } = {}) => ({
  socket: { remoteAddress: remote },
  headers: {
    host,
    ...(xff ? { 'x-forwarded-for': xff } : {}),
    ...(origin ? { origin } : {}),
  },
})

test('inCidr: v4, v6, mapped v4, mixed families never match', () => {
  assert.equal(trust.inCidr('100.112.20.25', '100.64.0.0/10'), true)
  assert.equal(trust.inCidr('100.127.255.255', '100.64.0.0/10'), true)
  assert.equal(trust.inCidr('100.128.0.0', '100.64.0.0/10'), false)
  assert.equal(trust.inCidr('82.13.63.160', '100.64.0.0/10'), false)
  assert.equal(trust.inCidr('::ffff:127.0.0.1', '127.0.0.0/8'), true)
  assert.equal(trust.inCidr('fd7a:115c:a1e0::1', 'fd7a:115c:a1e0::/48'), true)
  assert.equal(trust.inCidr('fd7a:115c:a1e1::1', 'fd7a:115c:a1e0::/48'), false)
  assert.equal(trust.inCidr('::1', '::1'), true)
  assert.equal(trust.inCidr('127.0.0.1', '::1'), false)
  assert.equal(trust.inCidr('garbage', '127.0.0.0/8'), false)
})

test('trustedNetwork: loopback tool with no XFF is trusted', () => {
  assert.equal(trust.trustedNetwork(req()), true)
  assert.equal(trust.trustedNetwork(req({ remote: '::ffff:127.0.0.1' })), true)
})

test('trustedNetwork: proxied tailnet client trusted, proxied WAN/LAN client not', () => {
  assert.equal(trust.trustedNetwork(req({ xff: '100.112.20.25' })), true)
  assert.equal(trust.trustedNetwork(req({ xff: '100.112.20.25, 10.0.0.1' })), true)
  assert.equal(trust.trustedNetwork(req({ xff: '82.13.63.160' })), false)
  assert.equal(trust.trustedNetwork(req({ xff: '192.168.0.42' })), false)
})

test('trustedNetwork: XFF is ignored unless the direct peer is loopback (no header forgery)', () => {
  assert.equal(trust.trustedNetwork(req({ remote: '192.168.0.42', xff: '100.112.20.25' })), false)
  assert.equal(trust.trustedNetwork(req({ remote: '100.112.20.25' })), false)  // direct, not via proxy
})

test('cross-origin browser requests are never trusted', () => {
  assert.equal(trust.isTrusted(req({ origin: 'https://evil.example', host: 'wiki.example' })), false)
  assert.equal(trust.isTrusted(req({ origin: 'https://wiki.example', host: 'wiki.example' })), true)
  assert.equal(trust.isTrusted(req({ origin: 'not a url' })), false)
})

test('session trust needs an owner file for isAuthorized (unclaimed sites say yes to everyone)', () => {
  const sh = { isAuthorized: () => true }
  const wan = req({ xff: '82.13.63.160' })
  assert.equal(trust.isTrusted(wan, { securityhandler: sh, ownerFileExists: false }), false)
  assert.equal(trust.isTrusted(wan, { securityhandler: sh, ownerFileExists: true }), true)
  assert.equal(trust.isTrusted(wan, { securityhandler: { isAdmin: () => true } }), true)
  assert.equal(trust.isTrusted(wan, { securityhandler: { isAdmin: () => { throw new Error('x') } } }), false)
})

test('WIKI_TRUSTED_NETS override narrows or widens the trusted set', () => {
  const nets = trust.parseNets('10.0.0.0/8')
  assert.equal(trust.trustedNetwork(req({ xff: '10.1.2.3' }), nets), true)
  assert.equal(trust.trustedNetwork(req({ xff: '100.112.20.25' }), nets), false)
})

test('RestrictedSet: exact names plus globs, has() answers both', () => {
  const r = new RestrictedSet(['pledge.fish'], ['*.private.fish', '*.pi5.private.fish'])
  assert.equal(r.has('pledge.fish'), true)
  assert.equal(r.has('david.private.fish'), true)
  assert.equal(r.has('puppet.pi5.private.fish'), true)
  assert.equal(r.has('codefish.club'), false)
  assert.equal(r.size, 1)
})

test('loadRestricted reads the local farm wikiDomains and env globs without extra farms', () => {
  const r = loadRestricted([], {
    wikiDomains: { 'a.example': { restricted: true }, 'b.example': {} },
    globs: ['*.private.fish'],
  })
  assert.equal(r.has('a.example'), true)
  assert.equal(r.has('b.example'), false)
  assert.equal(r.has('x.private.fish'), true)
})

test('PRIVATE scope selects restricted domains on the local farm too; * still includes them (callers exclude for untrusted)', () => {
  const r = new RestrictedSet([], ['*.private.fish'])
  assert.equal(matchesAny('x.private.fish', 'local', ['PRIVATE'], r), true)
  assert.equal(matchesAny('x.private.fish', 'public', ['PRIVATE'], r), true)
  assert.equal(matchesAny('x.private.fish', 'galaxy', ['PRIVATE'], r), false)
  assert.equal(matchesAny('x.private.fish', 'local', ['*'], r), true)
  assert.equal(matchesAny('codefish.club', 'local', ['PRIVATE'], r), false)
})
