// Where the query embedder lives: the env var, a farm-root file, or this box.
//
// The public farm had WIKI_EMBED_URL set to the literal string "disabled".
// That is truthy, so every query was POSTed to a URL that does not parse and
// semantic search was dead across 433 sites while keyword search kept working
// and hid it. These tests pin the two halves of the 0.14.0 fix: a value that
// is not an http(s) URL means "no proxy", and where the environment is not
// ours to set the address can come from a file instead.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { httpUrlOrNull, fileEmbedUrl } = require('../server/server.js')

const tmpFarm = () => fs.mkdtempSync(path.join(os.tmpdir(), 'similarity-farm-'))
const writeCfg = (root, body) =>
  fs.writeFileSync(path.join(root, 'similarity.json'),
    typeof body === 'string' ? body : JSON.stringify(body))

test('httpUrlOrNull accepts http and https, and nothing else', () => {
  assert.equal(httpUrlOrNull('https://hitchhiker.fm/system/semindex-embed.json'),
    'https://hitchhiker.fm/system/semindex-embed.json')
  assert.equal(httpUrlOrNull('http://localhost:4242/system/embed.json'),
    'http://localhost:4242/system/embed.json')

  // The bug this release exists for: truthy, but not an address.
  assert.equal(httpUrlOrNull('disabled'), null)
  assert.equal(httpUrlOrNull('off'), null)
  assert.equal(httpUrlOrNull('none'), null)
  assert.equal(httpUrlOrNull('true'), null)

  // Unset stays unset.
  assert.equal(httpUrlOrNull(undefined), null)
  assert.equal(httpUrlOrNull(''), null)

  // A URL, but not one we would ever POST to.
  assert.equal(httpUrlOrNull('file:///etc/passwd'), null)
  assert.equal(httpUrlOrNull('ftp://example.com/x'), null)
})

test('fileEmbedUrl reads the farm-root file, and no file means no proxy', () => {
  const root = tmpFarm()
  assert.equal(fileEmbedUrl(root), null, 'absent file must mean "not configured"')

  writeCfg(root, { embedUrl: 'https://hitchhiker.fm/system/semindex-embed.json' })
  assert.equal(fileEmbedUrl(root), 'https://hitchhiker.fm/system/semindex-embed.json')
})

test('fileEmbedUrl re-reads when the file changes, so a retarget needs no restart', () => {
  const root = tmpFarm()
  writeCfg(root, { embedUrl: 'https://one.example/embed.json' })
  assert.equal(fileEmbedUrl(root), 'https://one.example/embed.json')

  // Same path, new contents and a new mtime: the cache must not win.
  const file = path.join(root, 'similarity.json')
  const future = new Date(Date.now() + 5000)
  writeCfg(root, { embedUrl: 'https://two.example/embed.json' })
  fs.utimesSync(file, future, future)
  assert.equal(fileEmbedUrl(root), 'https://two.example/embed.json')

  // And removing it falls back to embedding in-process.
  fs.rmSync(file)
  assert.equal(fileEmbedUrl(root), null)
})

test('fileEmbedUrl degrades quietly on rubbish rather than throwing', () => {
  // A farm must keep serving pages even if this file is malformed: the worst
  // outcome allowed is "no proxy configured".
  const bad = tmpFarm()
  writeCfg(bad, '{ not json at all')
  assert.equal(fileEmbedUrl(bad), null)

  const wrongType = tmpFarm()
  writeCfg(wrongType, { embedUrl: 'disabled' })
  assert.equal(fileEmbedUrl(wrongType), null)

  const empty = tmpFarm()
  writeCfg(empty, {})
  assert.equal(fileEmbedUrl(empty), null)
})
