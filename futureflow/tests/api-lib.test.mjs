// node --test futureflow/tests/api-lib.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  beslis, dagSleutel, familie, geldigeKey, HELPER, kosten, kostenOverzicht, limietenVan, limietLabel, masker, telOp, toestandVan, usd, WACHTTIJD,
} from '../lib/api.mjs'

const NU = Date.parse('2026-11-09T12:00:00Z')
const UUR = 3_600_000

test('geldigeKey en masker', () => {
  assert.equal(geldigeKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz_-0123'), true)
  for (const fout of ['sk-ant-kort', 'sk-proj-abcdefghijklmnopqrstuvwxyz', ' sk-ant-abcdefghijklmnopqrstuvwxyz', 'sk-ant-abcdefghijklmnopqrstu vwxyz', '', undefined, 42]) {
    assert.equal(geldigeKey(fout), false, String(fout))
  }
  assert.equal(masker('sk-ant-api03-abcdefghijklmnopqrstuvwxyzABCD'), 'sk-ant-…ABCD')
})

test('HELPER is exact de afgesproken opdracht', () => {
  assert.equal(HELPER, '/usr/bin/security find-generic-password -s futureflow-anthropic-api -a futureflow -w')
})

test('kosten per modelfamilie; onbekend model rekent als sonnet', () => {
  const u = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }
  assert.equal(kosten({ ...u, model: 'claude-opus-4-1' }), 15 + 75 + 1.5 + 18.75)
  assert.equal(kosten({ ...u, model: 'claude-sonnet-4-5' }), 3 + 15 + 0.3 + 3.75)
  assert.equal(kosten({ ...u, model: 'claude-haiku-4-5' }), 1 + 5 + 0.1 + 1.25)
  assert.equal(kosten({ ...u, model: 'iets-anders' }), kosten({ ...u, model: 'claude-sonnet-4-5' }))
  assert.equal(familie(undefined), 'sonnet')
  assert.equal(kosten({ model: 'claude-opus-4', output_tokens: 2000 }), 0.15)
  assert.equal(kosten(null), 0)
  assert.equal(kosten({ model: 'x', input_tokens: -5, output_tokens: NaN }), 0)
})

test('limietLabel en limietenVan: alleen 5u en 7d, met resetsAt in ms', () => {
  assert.equal(limietLabel('five_hour'), '5u')
  assert.equal(limietLabel('seven_day'), '7d')
  assert.equal(limietLabel('seven_day_opus'), '7d opus')
  assert.equal(limietLabel('spend_limit'), 'spend limit')
  assert.deepEqual(
    limietenVan([
      { kind: 'five_hour', percentUsed: 92, resetsAt: '2026-11-09T14:00:00Z' },
      { kind: 'seven_day', percentUsed: 40 },
      { kind: 'spend_limit', percentUsed: 120 },
      { kind: 'five_hour' },
      null,
    ]),
    [{ label: '5u', percent: 92, resetsAt: NU + 2 * UUR }, { label: '7d', percent: 40 }],
  )
  assert.deepEqual(limietenVan(undefined), [])
})

const S = (o = {}) => ({ modus: 'abonnement', auto: true, hoog: 90, laag: 50, laatsteWissel: 0, limieten: [], nu: NU, ...o })

test('beslis: tabel', () => {
  const vol = { label: '5u', percent: 92, resetsAt: NU + UUR }
  const rijen = [
    ['auto uit: niets', S({ auto: false, limieten: [vol] }), null],
    ['onder de grens: niets', S({ limieten: [{ label: '5u', percent: 89.9 }] }), null],
    ['op de grens: naar api', S({ limieten: [{ label: '7d', percent: 90 }] }), { naar: 'api', reden: '7d-venster op 90% (grens 90%)', door: { label: '7d' } }],
    ['volste venster telt', S({ limieten: [{ label: '7d', percent: 91 }, vol] }), { naar: 'api', reden: '5u-venster op 92% (grens 90%)', door: { label: '5u', resetsAt: NU + UUR } }],
    ['binnen 5 min na wissel: niets', S({ limieten: [vol], laatsteWissel: NU - WACHTTIJD + 1 }), null],
    ['precies 5 min na wissel: wel', S({ limieten: [vol], laatsteWissel: NU - WACHTTIJD }), { naar: 'api', reden: '5u-venster op 92% (grens 90%)', door: { label: '5u', resetsAt: NU + UUR } }],
    ['api zonder overgeschakeldDoor (handmatig): blijft', S({ modus: 'api', limieten: [] }), null],
    ['api, reset nog niet voorbij, niets gemeten: blijft', S({ modus: 'api', overgeschakeldDoor: { label: '5u', resetsAt: NU + 1 } }), null],
    ['api, reset voorbij: terug', S({ modus: 'api', overgeschakeldDoor: { label: '5u', resetsAt: NU } }), { naar: 'abonnement', reden: '5u-venster is gereset' }],
    ['api, reset voorbij maar binnen wachttijd: blijft', S({ modus: 'api', overgeschakeldDoor: { label: '5u', resetsAt: NU - UUR }, laatsteWissel: NU - 60_000 }), null],
    ['api, gemeten onder laag: terug', S({ modus: 'api', overgeschakeldDoor: { label: '7d', resetsAt: NU + 48 * UUR }, limieten: [{ label: '7d', percent: 30, resetsAt: NU + 48 * UUR }] }), { naar: 'abonnement', reden: '7d-venster op 30% (onder 50%)' }],
    ['api, gemeten nog boven laag: blijft (ook na de oude reset)', S({ modus: 'api', overgeschakeldDoor: { label: '5u', resetsAt: NU - UUR }, limieten: [{ label: '5u', percent: 60, resetsAt: NU + 4 * UUR }] }), null],
    ['api, meting van een verlopen venster telt niet: reset beslist', S({ modus: 'api', overgeschakeldDoor: { label: '5u', resetsAt: NU - UUR }, limieten: [{ label: '5u', percent: 95, resetsAt: NU - UUR }] }), { naar: 'abonnement', reden: '5u-venster is gereset' }],
    ['api, ander venster gemeten: telt niet', S({ modus: 'api', overgeschakeldDoor: { label: '5u' }, limieten: [{ label: '7d', percent: 10 }] }), null],
    ['api, terug ook met auto uit', S({ modus: 'api', auto: false, overgeschakeldDoor: { label: '5u', resetsAt: NU - 1 } }), { naar: 'abonnement', reden: '5u-venster is gereset' }],
  ]
  for (const [naam, s, verwacht] of rijen) assert.deepEqual(beslis(s), verwacht, naam)
})

test('toestandVan: standaarden en grenzen', () => {
  assert.deepEqual(toestandVan(undefined), { modus: 'abonnement', auto: false, hoog: 90, laag: 50, laatsteWissel: 0 })
  assert.deepEqual(toestandVan({ modus: 'api', auto: true, hoog: 95, laag: 20, laatsteWissel: 5, overgeschakeldDoor: { label: '5u', resetsAt: 9 } }), {
    modus: 'api', auto: true, hoog: 95, laag: 20, laatsteWissel: 5, overgeschakeldDoor: { label: '5u', resetsAt: 9 },
  })
  assert.deepEqual(toestandVan({ hoog: 30, laag: 99, modus: 'x', auto: 'ja' }), { modus: 'abonnement', auto: false, hoog: 90, laag: 50, laatsteWissel: 0 })
  assert.equal(toestandVan({ hoog: 50, laag: 60 }).laag, 49)
})

test('kosten per dag: optellen, maand en vandaag, laatste 62 dagen', () => {
  const dag = dagSleutel(NU)
  assert.match(dag, /^2026-11-0[89]$/)
  let p = telOp({}, '2026-11-09', 1.25)
  p = telOp(p, '2026-11-09', 0.5)
  p = telOp(p, '2026-11-01', 2)
  p = telOp(p, '2026-10-31', 7)
  assert.deepEqual(kostenOverzicht(p, Date.parse('2026-11-09T12:00:00')), { vandaag: 1.75, maand: 3.75 })
  let veel = {}
  for (let i = 1; i <= 70; i++) veel = telOp(veel, `2026-0${i < 40 ? 1 : 2}-${String(i).padStart(2, '0')}`, 1)
  assert.equal(Object.keys(veel).length, 62)
  assert.equal(usd(1.234), '$ 1,23')
  assert.equal(usd(0.001), '< $ 0,01')
  assert.equal(usd(0), '$ 0,00')
})
