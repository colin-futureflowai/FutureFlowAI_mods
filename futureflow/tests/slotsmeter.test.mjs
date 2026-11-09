import assert from 'node:assert/strict'
import { test } from 'node:test'

import { meterTekst, meterToon } from '../lib/slotsmeter.mjs'

test('meterToon: ok vanaf de vloer, warn tussen kritiek en vloer, err eronder', () => {
  assert.equal(meterToon(40, 25, 10), 'ok')
  assert.equal(meterToon(25, 25, 10), 'ok')
  assert.equal(meterToon(24, 25, 10), 'warn')
  assert.equal(meterToon(10, 25, 10), 'warn')
  assert.equal(meterToon(9, 25, 10), 'err')
})

test('meterTekst: 8 cellen, percentage en GB met komma', () => {
  assert.equal(meterTekst(38, 16), '▰▰▰▱▱▱▱▱ 38% vrij (6,1 van 16 GB)')
  assert.equal(meterTekst(0, 16), '▱▱▱▱▱▱▱▱ 0% vrij (0,0 van 16 GB)')
  assert.equal(meterTekst(100, 16), '▰▰▰▰▰▰▰▰ 100% vrij (16,0 van 16 GB)')
})
