import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kpis } from '../lib/overzicht.mjs'

const TELLER = { beurten: 10, output: 5000, ingekort: 3, uitvoerVoor: 200000, uitvoerNa: 35200 }

test('lege invoer geeft vier kpis met streepje', () => {
  const k = kpis({})
  assert.equal(k.length, 4)
  for (const x of k) {
    assert.equal(x.waarde, '–')
    assert.equal(x.sub, 'nog geen gegevens')
    assert.equal(x.toon, 'mut')
  }
})

test('tokens bespaard (in)', () => {
  const k = kpis({ teller: TELLER })[0]
  assert.equal(k.titel, 'Tokens bespaard (in)')
  assert.equal(k.waarde, '41.2k')
  assert.equal(k.sub, '3× uitvoer ingekort')
  assert.equal(k.toon, 'groen')
})

test('tokens bespaard (uit) uit gemeten niveaus', () => {
  const k = kpis({ teller: TELLER, niveau: 'O2', perNiveau: { uit: { beurten: 6, output: 6000 }, O2: { beurten: 10, output: 5000 } } })[1]
  assert.equal(k.waarde, '≈5000')
  assert.equal(k.sub, 'schatting')
})

test('tokens bespaard (uit) zonder metingen: 35 procent', () => {
  assert.equal(kpis({ teller: TELLER })[1].waarde, '≈1750')
})

test('contextvenster', () => {
  const k = kpis({ context: { gebruikt: 76000, max: 100000 } })[2]
  assert.equal(k.waarde, '76%')
  assert.equal(k.toon, 'oranje')
  assert.equal(k.fractie, 0.76)
  assert.equal(kpis({ context: { gebruikt: 10000, max: 100000 } })[2].toon, 'groen')
})

test('vrij geheugen', () => {
  const k = kpis({ snapshot: { memory: { freePercent: 20, totalGB: 16 } } })[3]
  assert.equal(k.waarde, '20%')
  assert.equal(k.sub, 'van 16 GB')
  assert.equal(k.toon, 'oranje')
  assert.equal(kpis({ snapshot: { memory: { freePercent: 40, totalGB: 16 } } })[3].toon, 'groen')
})

test('kpi 1 zakt nooit onder 0 als de uitvoer na het inkorten groter is', () => {
  const k = kpis({ teller: { ...TELLER, uitvoerVoor: 1000, uitvoerNa: 5000 } })[0]
  assert.equal(k.waarde, '0')
})
