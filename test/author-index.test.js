import { describe, it, beforeEach, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Server modules are CJS (see server/package.json); Node imports them fine.
import authorIndex from '../server/author-index.js'
const { resolveAuthor, clearCache, fold } = authorIndex

// ── A farm is just sites carrying owner.json ─────────────────────────────────

let root, empty
const site = (dir, name, owner) => {
  const status = path.join(dir, name, 'status')
  fs.mkdirSync(status, { recursive: true })
  if (owner) fs.writeFileSync(path.join(status, 'owner.json'), JSON.stringify(owner))
}

before(() => {
  root  = fs.mkdtempSync(path.join(os.tmpdir(), 'author-farm-'))
  empty = fs.mkdtempSync(path.join(os.tmpdir(), 'author-none-'))

  // One account, several display names — the pseudonym case.
  site(root, 'a.example', { name: 'Ward Cunningham', oauth2: { username: 'ward' } })
  site(root, 'b.example', { name: 'ward.cunningham', oauth2: { username: 'ward' } })
  site(root, 'c.example', { name: 'Vogon Blor',      oauth2: { username: 'ward' } })
  // A second account that ALSO uses one of those display names.
  site(root, 'd.example', { name: 'Vogon Blor', oauth2: { username: 'zaphod' } })
  // A third, unrelated.
  site(root, 'e.example', { name: 'Marc Pierson', oauth2: { username: 'marc' } })
  // Private-farm shape: no oauth2, grouped by hashed friend secret.
  site(root, 'f.example', { name: 'Ward Cunningham', friend: { secret: 's3cret' } })
  // Unowned site — simply absent from the map.
  site(root, 'g.example', null)
  // A farm that keeps no ownership records at all.
  site(empty, 'x.example', null)
})
after(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(empty, { recursive: true, force: true })
})
beforeEach(() => clearCache())

const farms = () => [[root, 'local']]

describe('fold', () => {
  it('treats dots, underscores and spacing as the same separator', () => {
    assert.equal(fold('ward.cunningham'), fold('Ward Cunningham'))
    assert.equal(fold('David  Bovill'), 'david bovill')
  })
})

describe('resolveAuthor', () => {
  it('resolves a display name to every site of that account', () => {
    const r = resolveAuthor(farms(), 'Ward Cunningham')
    assert.deepEqual(r.sites.sort(), ['a.example', 'b.example', 'c.example', 'f.example'])
  })

  it('folds a differently-spelled display name to the same account', () => {
    assert.deepEqual(resolveAuthor(farms(), 'ward.cunningham').sites.sort(),
                     resolveAuthor(farms(), 'Ward Cunningham').sites.sort())
  })

  it('reports ambiguity when two accounts share a display name', () => {
    const r = resolveAuthor(farms(), 'Vogon Blor')
    assert.deepEqual(r.ambiguous.sort(), ['ward', 'zaphod'])
    assert.equal(r.sites, undefined)      // never guesses
  })

  it('lets an exact username win over someone else using it as a pseudonym', () => {
    // 'ward' is a username AND nobody's display name → unambiguous
    const r = resolveAuthor(farms(), 'ward')
    assert.deepEqual(r.sites.sort(), ['a.example', 'b.example', 'c.example'])
    assert.equal(r.ambiguous, undefined)
  })

  it('returns no sites for someone who owns nothing here', () => {
    assert.deepEqual(resolveAuthor(farms(), 'Nobody At All').sites, [])
  })

  it('says so when the farm keeps no ownership records', () => {
    assert.equal(resolveAuthor([[empty, 'local']], 'Ward Cunningham').available, false)
  })

  it('never returns the map, the names, or a friend secret', () => {
    const r = resolveAuthor(farms(), 'Ward Cunningham')
    assert.deepEqual(Object.keys(r), ['sites'])
    assert.ok(!JSON.stringify(r).includes('s3cret'))
    assert.ok(!JSON.stringify(r).includes('Vogon'))
  })
})
