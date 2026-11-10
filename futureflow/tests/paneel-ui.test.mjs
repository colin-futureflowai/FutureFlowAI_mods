import { test } from 'node:test'
import assert from 'node:assert/strict'

import { binnenBreedte, KORT, LANG, kolommenVoor, onderstreping, rijBreedte, tabNamen, tabRijen, tabTekst } from '../lib/paneel-ui.mjs'

test('tabNamen: kort onder 50 kolommen, lang daarboven en zonder meting', () => {
  assert.deepEqual(tabNamen(44), KORT)
  assert.deepEqual(tabNamen(49), KORT)
  assert.deepEqual(tabNamen(50), LANG)
  assert.deepEqual(tabNamen(undefined), LANG)
})

test('tabRijen: elke rij past, volgorde blijft, alle vier tabs', () => {
  for (const kolommen of [20, 30, 44, 50, 60, 80, 100, 200]) {
    const breedte = binnenBreedte(kolommen)
    const namen = tabNamen(kolommen)
    const rijen = tabRijen(namen, breedte)
    assert.deepEqual(rijen.flat(), [0, 1, 2, 3])
    for (const rij of rijen) assert.ok(rijBreedte(namen, rij) <= breedte, `${kolommen}: ${rijBreedte(namen, rij)} > ${breedte}`)
  }
})

test('tabRijen: 110 kolommen is één rij, 44 kolommen twee', () => {
  assert.equal(tabRijen(LANG, binnenBreedte(110)).length, 1)
  assert.equal(tabRijen(KORT, binnenBreedte(44)).length, 2)
})

test('onderstreping: ▔ precies onder de naam van de gekozen tab', () => {
  const rij = [0, 1, 2]
  const streep = onderstreping(LANG, rij, 1)
  const regel = rij.map(i => tabTekst(i, LANG[i])).join(' · ')
  const begin = regel.indexOf('Wisselen')
  assert.equal(streep, ' '.repeat(begin) + '▔'.repeat(8))
  assert.equal(onderstreping(LANG, rij, 4), '')
})

test('kolommenVoor: twee kolommen vanaf 52, anders één; nooit te breed', () => {
  assert.deepEqual(kolommenVoor(98), { n: 2, breed: 48 })
  assert.deepEqual(kolommenVoor(42), { n: 1, breed: 42 })
  for (let b = 20; b < 200; b++) {
    const { n, breed } = kolommenVoor(b)
    assert.ok(n * breed + (n - 1) <= b)
  }
})

test('binnenBreedte: 80 zonder meting, nooit onder 20', () => {
  assert.equal(binnenBreedte(undefined), 78)
  assert.equal(binnenBreedte(44), 42)
  assert.equal(binnenBreedte(5), 20)
})
