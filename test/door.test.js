import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { doorOpen, setDoor, DOOR_KEY } from '../src/client/door.js'
import { pageUrl } from '../src/client/styles.js'
import { parseDSL } from '../src/client/dsl.js'

const fake = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) } }

describe('the search box door (0.25.0)', () => {
  it('is shut by default, with no storage, and when storage throws', () => {
    assert.equal(doorOpen(null), false)
    assert.equal(doorOpen(fake()), false)
    assert.equal(doorOpen({ getItem: () => { throw new Error('blocked') } }), false)
    assert.equal(setDoor(true, { setItem: () => { throw new Error('blocked') } }), false)
  })
  it('opens and shuts, under the plugin key', () => {
    const s = fake()
    assert.equal(setDoor(true, s), true); assert.equal(doorOpen(s), true); assert.equal(s.getItem(DOOR_KEY), 'on')
    setDoor(false, s); assert.equal(doorOpen(s), false); assert.equal(s.getItem(DOOR_KEY), null)
  })
  it('DOOR is a mode word, and door.example.com is still a domain', () => {
    assert.equal(parseDSL('DOOR').mode, 'door')
    assert.equal(parseDSL('DOOR\n*').mode, 'door')
    assert.equal(parseDSL('*\nDOOR').mode, 'door')
    const d = parseDSL('door.example.com\nREPORT')
    assert.equal(d.mode, 'report'); assert.deepEqual(d.specs, ['door.example.com'])
  })
})

describe('result links carry the real page URL', () => {
  it('https for the federation, http for localhost farms', () => {
    assert.equal(pageUrl('a.b.earth', 'x'), 'https://a.b.earth/view/x')
    assert.equal(pageUrl('plan.localhost', 'x-y'), 'http://plan.localhost/view/x-y')
    assert.equal(pageUrl('localhost:3000', 'x'), 'http://localhost:3000/view/x')
    assert.equal(pageUrl('notlocalhost.earth', 'x'), 'https://notlocalhost.earth/view/x')
  })
})
