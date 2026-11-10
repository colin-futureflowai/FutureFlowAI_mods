import assert from 'node:assert/strict'
import { test } from 'node:test'

import { grensVan, wisselOverzicht } from '../lib/wissel.mjs'

const NU = Date.parse('2026-11-10T12:00:00Z')
const instellingen = { auto: true, marge5u: 90, marge7d: 90, strategie: 'meeste-ruimte', wachttijd: 300_000, hysterese: 10, stand: 'stil', maxWacht: 600_000 }
const account = (id, pct5, extra = {}) => ({
  id,
  email: `colin${id}@futureflowai.com`,
  plan: 'Max 5x',
  inRotatie: true,
  status: 'ok',
  gebruik: { '5u': { pct: pct5 }, '7d': { pct: 20 } },
  gemetenOp: NU - 60_000,
  ...extra,
})
const basis = {
  modus: 'abonnement',
  apiAuto: true,
  stappen: ['api'],
  hoog: 90,
  laag: 50,
  accounts: { actief: 1, profiel: 'standaard', accounts: [account(1, 70), account(2, 30)], instellingen, gelezen: NU },
  limieten: [],
  apiKey: true,
  orKey: true,
  orModel: 'openai/gpt-5',
  orSnel: 'openai/gpt-5-mini',
  nu: NU,
}

test('vier stappen met hun stand; ← nu bij het abonnement; e-mail gemaskeerd', () => {
  const o = wisselOverzicht(basis)
  assert.equal(o.aan, true)
  assert.equal(o.nuOp, 'Abonnement (account 1, co…@futureflowai.com)')
  assert.deepEqual(o.regels.map(r => r.tekst), [
    '1. Je abonnement — 5u 70% · 7d 20%',
    '2. Ander abonnement — account 2, ruimte 60%',
    '3. Anthropic API — key ✓',
    '4. OpenRouter — melding: start claude-or (openai/gpt-5) (uit)',
  ])
  assert.deepEqual(o.regels.map(r => r.nu), [true, false, false, false])
  assert.deepEqual(o.regels.map(r => r.dim), [false, false, false, true])
  assert.match(o.zinnen[0], /^Haalt je huidige abonnement 90% van het 5u- of 7d-venster, dan gaat futureflow naar de volgende stap/)
  assert.equal(o.zinnen[1], 'Terug naar je abonnement zodra het weer onder 50% zit of gereset is.')
})

test('de eigen rate limits van de sessie gaan voor de meting van het account', () => {
  const o = wisselOverzicht({ ...basis, limieten: [{ label: '5u', percent: 91 }, { label: '7d', percent: 33 }] })
  assert.equal(o.regels[0].tekst, '1. Je abonnement — 5u 91% · 7d 33%')
})

test('op OpenRouter: nu bij OpenRouter, volgorde volgt stappen, redenen voor wat niet kan', () => {
  const o = wisselOverzicht({ ...basis, modus: 'openrouter', stappen: ['openrouter', 'api'], apiKey: false, orNu: 'openai/gpt-5', accounts: { ...basis.accounts, accounts: [account(1, 70)] } })
  assert.equal(o.nuOp, 'OpenRouter (openai/gpt-5)')
  assert.deepEqual(o.regels.map(r => r.tekst), [
    '1. Je abonnement — 5u 70% · 7d 20%',
    '2. Ander abonnement — geen tweede account',
    '3. OpenRouter — melding: start claude-or (openai/gpt-5)',
    '4. Anthropic API — geen key',
  ])
  assert.deepEqual(o.regels.map(r => r.nu), [false, false, true, false])
  const zonderModel = wisselOverzicht({ ...basis, stappen: ['openrouter'], orSnel: undefined })
  assert.equal(zonderModel.regels[2].tekst, '3. OpenRouter — geen model gekozen')
})

test('schakelaar: aan als API-auto óf accounts-auto aan staat; accounts-auto uit = stap 2 (uit)', () => {
  const uit = { ...basis.accounts, instellingen: { ...instellingen, auto: false } }
  assert.equal(wisselOverzicht({ ...basis, apiAuto: false, accounts: uit }).aan, false)
  assert.equal(wisselOverzicht({ ...basis, apiAuto: false }).aan, true)
  const o = wisselOverzicht({ ...basis, accounts: uit })
  assert.equal(o.aan, true)
  assert.equal(o.regels[1].tekst, '2. Ander abonnement — account 2, ruimte 60% (uit)')
})

test('zonder accounts en zonder meting', () => {
  const o = wisselOverzicht({ ...basis, accounts: null })
  assert.equal(o.nuOp, 'Abonnement')
  assert.equal(o.regels[0].tekst, '1. Je abonnement — nog niet gemeten')
  assert.equal(o.regels[1].tekst, '2. Ander abonnement — geen tweede account (uit)')
})

test('grenzen: binnen bereik en aan de goede kant van de andere', () => {
  assert.deepEqual(grensVan('hoog', ' 85% ', 50), { n: 85 })
  assert.match(grensVan('hoog', '100', 50).fout, /50 tot 99/)
  assert.match(grensVan('hoog', '45', 50).fout, /50 tot 99/)
  assert.match(grensVan('hoog', '60', 70).fout, /"wissel vanaf" \(60%\) moet hoger zijn dan "terug onder" \(70%\)/)
  assert.deepEqual(grensVan('laag', '40', 85), { n: 40 })
  assert.match(grensVan('laag', '88', 85).fout, /\(85%\) moet hoger zijn dan "terug onder" \(88%\)/)
})
