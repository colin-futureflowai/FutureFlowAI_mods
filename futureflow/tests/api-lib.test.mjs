// node --test futureflow/tests/api-lib.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  beslis, dagSleutel, geldigeKey, HELPER, horizon, houdTot, kosten, kostenOverzicht, limietenVan, limietLabel, masker, prijsSleutel, telOp, toestandVan, usd, WACHTTIJD,
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

const M = 1_000_000
const U = { input_tokens: M, output_tokens: M, cache_read_input_tokens: M, cache_creation_input_tokens: M }
const som = (i, o, l, w) => i + o + l + w
const bijna = (a, b, naam) => assert.ok(Math.abs(a - b) < 1e-9, `${naam}: ${a} ≠ ${b}`)

test('prijsSleutel uit het model-id, ook met datum of [1m]; onbekend → sonnet-5.5', () => {
  const rijen = [
    ['claude-opus-5-5', 'opus-5.5'],
    ['claude-opus-5', 'opus-5'],
    ['claude-opus-4-8', 'opus-4.8'],
    ['claude-opus-4-7', 'opus-4.7'],
    ['claude-opus-4-6', 'opus-4.6'],
    ['claude-opus-4-5-20251101', 'opus-4.5'],
    ['claude-sonnet-5-5', 'sonnet-5.5'],
    ['claude-sonnet-5', 'sonnet-5'],
    ['claude-sonnet-5-20261001', 'sonnet-5'],
    ['claude-sonnet-4-6[1m]', 'sonnet-4.6'],
    ['claude-sonnet-4-5', 'sonnet-4.5'],
    ['claude-haiku-5-5', 'haiku-5.5'],
    ['claude-haiku-5-5[1m]', 'haiku-5.5'],
    ['claude-haiku-4-5-20251001', 'haiku-4.5'],
    ['Claude-Opus-5-5', 'opus-5.5'],
    ['claude-opus-4-1', 'sonnet-5.5'],
    ['claude-3-5-sonnet-20241022', 'sonnet-5.5'],
    ['iets-anders', 'sonnet-5.5'],
    [undefined, 'sonnet-5.5'],
  ]
  for (const [model, sleutel] of rijen) assert.equal(prijsSleutel(model), sleutel, String(model))
})

test('kosten per model (input / output / cache lezen / cache schrijven 5 min)', () => {
  const rijen = [
    ['claude-opus-5-5', som(4, 20, 0.2, 5)],
    ['claude-opus-5', som(5, 25, 0.5, 6.25)],
    ['claude-opus-4-8', som(5, 25, 0.5, 6.25)],
    ['claude-opus-4-7', som(5, 25, 0.5, 6.25)],
    ['claude-opus-4-6', som(5, 25, 0.5, 6.25)],
    ['claude-opus-4-5', som(5, 25, 0.5, 6.25)],
    ['claude-sonnet-5-5', som(2, 10, 0.1, 2.5)],
    ['claude-sonnet-5', som(2, 10, 0.2, 2.5)],
    ['claude-sonnet-4-6', som(3, 15, 0.3, 3.75)],
    ['claude-sonnet-4-5', som(3, 15, 0.3, 3.75)],
    ['claude-haiku-4-5', som(1, 5, 0.1, 1.25)],
    ['onbekend', som(2, 10, 0.1, 2.5)],
  ]
  for (const [model, verwacht] of rijen) bijna(kosten({ ...U, model }), verwacht, model)
  bijna(kosten({ model: 'claude-opus-4-6', output_tokens: 2000 }), 0.05, 'opus 4.6 output')
  assert.equal(kosten(null), 0)
  assert.equal(kosten({ model: 'x', input_tokens: -5, output_tokens: NaN }), 0)
})

test('Haiku 5.5: tot 100k tokens prompt de lage prijs, daarboven de hoge', () => {
  // 60k input + 30k cache lezen + 10k schrijven = 100k: nog laag.
  const laag = { model: 'claude-haiku-5-5', input_tokens: 60_000, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 10_000, output_tokens: 1000 }
  bijna(kosten(laag), (60_000 * 0.1 + 30_000 * 0.01 + 10_000 * 0.125 + 1000 * 0.5) / M, 'laag')
  const hoog = { ...laag, input_tokens: 60_001 }
  bijna(kosten(hoog), (60_001 * 0.5 + 30_000 * 0.05 + 10_000 * 0.625 + 1000 * 2.5) / M, 'hoog')
  bijna(kosten({ ...U, model: 'claude-haiku-5-5[1m]' }), som(0.5, 2.5, 0.05, 0.625), 'hoog, 3M prompt')
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
    ['op de grens: naar api; zonder resetsAt rekent door met 7 dagen', S({ limieten: [{ label: '7d', percent: 90 }] }), { naar: 'api', reden: '7d-venster op 90% (grens 90%)', door: { label: '7d', resetsAt: NU + 7 * 24 * UUR } }],
    ['5u zonder resetsAt: door met 5 uur', S({ limieten: [{ label: '5u', percent: 95 }] }), { naar: 'api', reden: '5u-venster op 95% (grens 90%)', door: { label: '5u', resetsAt: NU + 5 * UUR } }],
    ['een verlopen meting boven de grens telt niet', S({ limieten: [{ label: '5u', percent: 99, resetsAt: NU - 1 }] }), null],
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
    // M1: 5u gereset, maar 7d staat nog boven de grens: blijven (anders 5 min later weer naar API).
    ['api, 5u gereset maar 7d nog ≥ hoog: blijft', S({ modus: 'api', overgeschakeldDoor: { label: '5u', resetsAt: NU - 1 }, limieten: [{ label: '7d', percent: 92, resetsAt: NU + 48 * UUR }] }), null],
    ['api, 5u gemeten onder laag maar 7d nog ≥ hoog: blijft', S({ modus: 'api', overgeschakeldDoor: { label: '5u', resetsAt: NU + UUR }, limieten: [{ label: '5u', percent: 10, resetsAt: NU + UUR }, { label: '7d', percent: 95 }] }), null],
    ['api, 5u gereset en 7d onder hoog: terug', S({ modus: 'api', overgeschakeldDoor: { label: '5u', resetsAt: NU - 1 }, limieten: [{ label: '7d', percent: 80, resetsAt: NU + 48 * UUR }] }), { naar: 'abonnement', reden: '5u-venster is gereset' }],
    // I4: een keuze met de hand gaat voor tot handmatigTot.
    ['met de hand op abonnement, venster nog ≥ hoog, voor handmatigTot: blijft', S({ handmatigTot: NU + 1, limieten: [vol] }), null],
    ['met de hand op abonnement, op handmatigTot: weer naar api', S({ handmatigTot: NU, limieten: [vol] }), { naar: 'api', reden: '5u-venster op 92% (grens 90%)', door: { label: '5u', resetsAt: NU + UUR } }],
    ['met de hand op abonnement, na handmatigTot onder de grens: niets', S({ handmatigTot: NU - UUR, limieten: [{ label: '5u', percent: 3 }] }), null],
    ['api met handmatigTot nog niet voorbij: auto zet niet terug', S({ modus: 'api', handmatigTot: NU + UUR, overgeschakeldDoor: { label: '5u', resetsAt: NU - 1 } }), null],
    ['met de hand op api (geen overgeschakeldDoor): auto zet nooit terug', S({ modus: 'api', limieten: [{ label: '5u', percent: 1 }] }), null],
  ]
  for (const [naam, s, verwacht] of rijen) assert.deepEqual(beslis(s), verwacht, naam)
})

test('houdTot: laatste reset van de vensters ≥ hoog en van overgeschakeldDoor; anders undefined', () => {
  const H = (o = {}) => ({ hoog: 90, limieten: [], nu: NU, ...o })
  assert.equal(houdTot(H()), undefined)
  assert.equal(houdTot(H({ limieten: [{ label: '5u', percent: 50, resetsAt: NU + UUR }] })), undefined)
  assert.equal(houdTot(H({ limieten: [{ label: '5u', percent: 95, resetsAt: NU + UUR }, { label: '7d', percent: 91, resetsAt: NU + 40 * UUR }] })), NU + 40 * UUR)
  assert.equal(houdTot(H({ limieten: [{ label: '7d', percent: 93 }] })), NU + horizon('7d'))
  assert.equal(houdTot(H({ overgeschakeldDoor: { label: '5u', resetsAt: NU + 2 * UUR } })), NU + 2 * UUR)
  assert.equal(houdTot(H({ overgeschakeldDoor: { label: '5u', resetsAt: NU - 1 } })), undefined)
  assert.equal(houdTot(H({ limieten: [{ label: '5u', percent: 99, resetsAt: NU - 1 }] })), undefined)
  assert.equal(horizon('5u'), 5 * UUR)
  assert.equal(horizon('7d opus'), 7 * 24 * UUR)
})

test('toestandVan: standaarden en grenzen', () => {
  assert.deepEqual(toestandVan(undefined), { modus: 'abonnement', auto: false, hoog: 90, laag: 50, laatsteWissel: 0, stappen: ['api'] })
  assert.deepEqual(toestandVan({ modus: 'api', auto: true, hoog: 95, laag: 20, laatsteWissel: 5, overgeschakeldDoor: { label: '5u', resetsAt: 9 } }), {
    modus: 'api', auto: true, hoog: 95, laag: 20, laatsteWissel: 5, overgeschakeldDoor: { label: '5u', resetsAt: 9 }, stappen: ['api'],
  })
  assert.deepEqual(toestandVan({ hoog: 30, laag: 99, modus: 'x', auto: 'ja' }), { modus: 'abonnement', auto: false, hoog: 90, laag: 50, laatsteWissel: 0, stappen: ['api'] })
  assert.equal(toestandVan({ hoog: 50, laag: 60 }).laag, 49)
  assert.equal(toestandVan({ handmatigTot: 123 }).handmatigTot, 123)
  assert.equal('handmatigTot' in toestandVan({ handmatigTot: 'morgen' }), false)
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
