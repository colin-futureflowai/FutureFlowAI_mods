// node --test futureflow/tests/openrouter-lib.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { beslis, eersteStap, HELPER, modusVan, OR_HELPER, toestandVan, WACHTTIJD } from '../lib/api.mjs'
import { ketting } from '../lib/accounts.mjs'
import {
  contextTekst, eigenBasis, geldigeOrKey, geldigModel, haalWeg, modelIdVoor, modellenVan, orInstellingen, orKosten, pasToe, perMtok, prijsTekst,
  SHIM_MERK, shimTekst, sorteer, teKlein,
} from '../lib/openrouter.mjs'

const NU = Date.parse('2026-11-10T12:00:00Z')

test('geldigeOrKey en geldigModel', () => {
  for (const [s, ok] of [
    ['sk-or-v1-0123456789abcdef0123456789abcdef', true],
    ['sk-or-ABCDEFGHIJKLMNOPQRST', true],
    ['sk-or-kort', false],
    ['sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ', false],
    [' sk-or-v1-0123456789abcdef0123456789abcdef', false],
    [undefined, false],
  ]) assert.equal(geldigeOrKey(s), ok, String(s))
  for (const [s, ok] of [
    ['anthropic/claude-sonnet-4.5', true],
    ['openai/gpt-5', true],
    ['x-ai/grok-4:free', true],
    ['anthropic/claude-opus-4.6[1m]', true],
    ['gpt-5', false],
    ['a/b c', false],
    ['a/b;rm', false],
    ['', false],
  ]) assert.equal(geldigModel(s), ok, s)
})

test('modusVan: drie modi op één plek, vreemde helper en base-URL', () => {
  const tabel = [
    [{}, undefined, { modus: 'abonnement', vreemdeHelper: false, vreemdeBasis: false }],
    [{ apiKeyHelper: HELPER }, undefined, { modus: 'api', vreemdeHelper: false, vreemdeBasis: false }],
    [{ apiKeyHelper: OR_HELPER, env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api' } }, 'https://openrouter.ai/api', { modus: 'openrouter', vreemdeHelper: false, vreemdeBasis: false }],
    [{ apiKeyHelper: '~/x.sh' }, undefined, { modus: 'abonnement', vreemdeHelper: true, vreemdeBasis: false }],
    [{ env: { ANTHROPIC_BASE_URL: 'https://gw.example' } }, undefined, { modus: 'abonnement', vreemdeHelper: false, vreemdeBasis: true }],
    [{ env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api' } }, undefined, { modus: 'abonnement', vreemdeHelper: false, vreemdeBasis: true }],
  ]
  for (const [data, basis, verwacht] of tabel) assert.deepEqual(modusVan(data, basis), verwacht, JSON.stringify(data))
})

test('pasToe en haalWeg: heen en terug geeft hetzelfde object terug', () => {
  const gewenst = orInstellingen('openai/gpt-5', 'openai/gpt-5-mini')
  for (const begin of [
    {},
    { model: 'opus', env: { FOO: 'bar' } },
    { env: { CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' }, permissions: { allow: [] } },
    { env: {} },
  ]) {
    const r = pasToe(begin, gewenst)
    assert.equal(r.vreemd, undefined)
    assert.equal(r.data.apiKeyHelper, OR_HELPER)
    for (const [k, v] of Object.entries(gewenst.env)) assert.equal(r.data.env[k], v)
    const terug = haalWeg(r.data, r.marker)
    assert.equal(JSON.stringify(terug), JSON.stringify(begin))
    assert.equal(eigenBasis(r.marker), 'https://openrouter.ai/api')
  }
})

test('pasToe: een vooraf bestaande gelijke waarde blijft van de gebruiker', () => {
  const r = pasToe({ env: { CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' } }, orInstellingen('a/b', 'a/c'))
  assert.equal(r.marker.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, undefined)
  assert.equal(haalWeg(r.data, r.marker).env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, '1')
})

test('pasToe: vreemde waarden geweigerd, niets veranderd', () => {
  const gewenst = orInstellingen('a/b', 'a/c')
  for (const [data, sleutel] of [
    [{ apiKeyHelper: '~/x.sh' }, 'apiKeyHelper'],
    [{ apiKeyHelper: HELPER }, 'apiKeyHelper'],
    [{ env: { ANTHROPIC_BASE_URL: 'https://gw.example' } }, 'env.ANTHROPIC_BASE_URL'],
    [{ env: { ANTHROPIC_API_KEY: 'sk-ant-echt' } }, 'env.ANTHROPIC_API_KEY'],
    [{ env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-6' } }, 'env.ANTHROPIC_DEFAULT_OPUS_MODEL'],
    [{ env: 'x' }, 'env'],
  ]) assert.equal(pasToe(data, gewenst).vreemd, sleutel)
})

test('haalWeg: alleen gelijke waarden uit de marker; zonder marker alleen de helper', () => {
  const r = pasToe({}, orInstellingen('a/b', 'a/c'))
  r.data.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'eigen'
  assert.deepEqual(haalWeg(r.data, r.marker), { env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'eigen' } })
  assert.deepEqual(haalWeg({ apiKeyHelper: OR_HELPER, env: { X: '1' } }, undefined), { env: { X: '1' } })
  assert.deepEqual(haalWeg({ apiKeyHelper: '~/x.sh' }, undefined), { apiKeyHelper: '~/x.sh' })
})

test('modellenVan, sorteer (Claude eerst), prijzen per Mtok', () => {
  const ruw = { data: [
    { id: 'openai/gpt-5', name: 'OpenAI: GPT-5', context_length: 400000, pricing: { prompt: '0.00000125', completion: '0.00001' } },
    { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5', context_length: 1000000, pricing: { prompt: '0.000003', completion: '0.000015' } },
    { id: 'kapot id', name: 'x' },
    { id: 'openrouter/auto', name: 'Auto', pricing: { prompt: '-1', completion: '-1' } },
    { id: 'anthropic/claude-haiku-4.5', name: 'Anthropic: Claude Haiku 4.5', context_length: 200000, pricing: { prompt: '0.000001', completion: '0.000005' } },
  ] }
  const lijst = modellenVan(ruw)
  assert.equal(lijst.length, 4)
  assert.deepEqual(lijst[0], { id: 'openai/gpt-5', naam: 'OpenAI: GPT-5', context: 400000, in: 1.25, uit: 10 })
  assert.deepEqual(lijst[2], { id: 'openrouter/auto', naam: 'Auto' })
  assert.deepEqual(sorteer(lijst).map(m => m.id), ['anthropic/claude-haiku-4.5', 'anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'openrouter/auto'])
  assert.deepEqual(sorteer(lijst, 'GPT').map(m => m.id), ['openai/gpt-5'])
  assert.deepEqual(sorteer(lijst, 'haiku').map(m => m.id), ['anthropic/claude-haiku-4.5'])
  assert.equal(perMtok('0.000003'), 3)
  assert.equal(perMtok('x'), undefined)
  for (const [n, t] of [[3, '$3'], [1.25, '$1,25'], [0.15, '$0,15'], [15, '$15'], [undefined, '?']]) assert.equal(prijsTekst(n), t)
  for (const [n, t] of [[200000, '200k'], [1000000, '1M'], [1048576, '1M'], [undefined, '?']]) assert.equal(contextTekst(n), t)
})

test('orKosten: input (met cache) en output tegen de prijs per Mtok', () => {
  const usage = { input_tokens: 1000, cache_read_input_tokens: 1000, output_tokens: 2000 }
  assert.ok(Math.abs(orKosten(usage, { in: 3, uit: 15 }) - (2000 * 3 + 2000 * 15) / 1e6) < 1e-12)
  assert.equal(orKosten(usage, undefined), 0)
})

test('eersteStap: volgorde en beschikbaarheid', () => {
  const tabel = [
    [['api'], {}, 'api'],
    [['api', 'openrouter'], { openrouter: true }, 'api'],
    [['openrouter', 'api'], { openrouter: true }, 'openrouter'],
    [['openrouter', 'api'], { openrouter: false }, 'api'],
    [['openrouter'], {}, undefined],
    [['api', 'openrouter'], { api: false, openrouter: true }, 'openrouter'],
    [[], { openrouter: true }, undefined],
  ]
  for (const [stappen, b, verwacht] of tabel) assert.equal(eersteStap(stappen, b), verwacht, JSON.stringify([stappen, b]))
})

test('toestandVan: modus openrouter en stappen', () => {
  assert.deepEqual(toestandVan({}).stappen, ['api'])
  assert.equal(toestandVan({ modus: 'openrouter' }).modus, 'openrouter')
  assert.equal(toestandVan({ modus: 'raar' }).modus, 'abonnement')
  assert.deepEqual(toestandVan({ stappen: ['openrouter', 'api', 'openrouter', 'x'] }).stappen, ['openrouter', 'api'])
  assert.deepEqual(toestandVan({ stappen: [] }).stappen, [])
})

const basis = { modus: 'abonnement', auto: true, hoog: 90, laag: 50, laatsteWissel: 0, stappen: ['api'] }
const vol = [{ label: '5u', percent: 95, resetsAt: NU + 3_600_000 }]

test('beslis: tabel met stappen, beschikbaarheid en terug', () => {
  const tabel = [
    ['standaard naar api', { ...basis }, vol, 'api'],
    ['openrouter eerst', { ...basis, stappen: ['openrouter', 'api'], beschikbaar: { openrouter: true } }, vol, 'openrouter'],
    ['openrouter niet klaar → api', { ...basis, stappen: ['openrouter', 'api'], beschikbaar: { openrouter: false } }, vol, 'api'],
    ['alleen openrouter, niet klaar', { ...basis, stappen: ['openrouter'] }, vol, null],
    ['api zonder key → openrouter', { ...basis, stappen: ['api', 'openrouter'], beschikbaar: { api: false, openrouter: true } }, vol, 'openrouter'],
    ['geen stappen', { ...basis, stappen: [] }, vol, null],
    ['auto uit', { ...basis, auto: false }, vol, null],
    ['terug van openrouter na reset', { ...basis, modus: 'openrouter', overgeschakeldDoor: { label: '5u', resetsAt: NU - 1 } }, [], 'abonnement'],
    ['openrouter met de hand blijft', { ...basis, modus: 'openrouter' }, [], null],
    ['handmatig wint', { ...basis, handmatigTot: NU + 1 }, vol, null],
    ['wachttijd', { ...basis, laatsteWissel: NU - WACHTTIJD + 1 }, vol, null],
  ]
  for (const [naam, s, limieten, verwacht] of tabel) {
    const b = beslis({ ...s, limieten, nu: NU })
    assert.equal(b ? b.naar : null, verwacht, naam)
    // OpenRouter wisselt nooit stil (0.9.0): alleen een melding.
    if (b?.naar === 'openrouter' && s.modus === 'abonnement') assert.equal(b.alleenMelding, true, naam)
    if (b?.naar === 'api') assert.equal(b.alleenMelding, undefined, naam)
  }
})

test('ketting: OpenRouter als stap is alleen een melding', () => {
  const b = ketting({
    accounts: [acc(1), acc(2)], actief: 1, instellingen, laatsteWissel: 0, nu: NU, sessieLimieten: vol,
    api: { ...basis, stappen: ['openrouter', 'api'] }, beschikbaar: { openrouter: true }, metingen: { 1: meting(95), 2: meting(96) },
  })
  assert.deepEqual({ soort: b.soort, naar: b.naar, alleenMelding: b.alleenMelding }, { soort: 'api', naar: 'openrouter', alleenMelding: true })
})

test('modelIdVoor en teKlein: [1m] vanaf 1M context, te klein onder 200k', () => {
  assert.equal(modelIdVoor({ id: 'anthropic/claude-sonnet-4.5', context: 1_000_000 }), 'anthropic/claude-sonnet-4.5[1m]')
  assert.equal(modelIdVoor({ id: 'anthropic/claude-sonnet-4.5[1m]', context: 1_000_000 }), 'anthropic/claude-sonnet-4.5[1m]')
  assert.equal(modelIdVoor({ id: 'openai/gpt-5', context: 400_000 }), 'openai/gpt-5')
  assert.equal(modelIdVoor({ id: 'x/y' }), 'x/y')
  assert.ok(geldigModel(modelIdVoor({ id: 'a/b', context: 2_000_000 })))
  assert.equal(teKlein({ context: 128_000 }), true)
  assert.equal(teKlein({ context: 200_000 }), false)
  assert.equal(teKlein({}), false)
})

test('shimTekst: merkregel, pad tussen enkele aanhalingstekens, exec claude --settings', () => {
  const t = shimTekst("/Users/x/it's/settings.json")
  assert.ok(t.startsWith('#!/bin/sh\n'))
  assert.ok(t.split('\n').includes(SHIM_MERK))
  assert.match(t, /S='\/Users\/x\/it'\\''s\/settings\.json'/)
  assert.match(t, /exec claude --settings "\$S" "\$@"/)
})

const acc = (id, extra = {}) => ({ id, sleutel: String(id), email: `a${id}@x.nl`, plan: 'Max', inRotatie: true, status: 'ok', ...extra })
const meting = pct => ({ vensters: [{ label: '5u', pct, resetsAt: NU + 3_600_000 }], gemetenOp: NU - 60_000 })
const instellingen = { auto: true, marge5u: 90, marge7d: 90, strategie: 'meeste-ruimte', wachttijd: 300_000, hysterese: 10, stand: 'stil', maxWacht: 600_000 }

test('ketting: tabel met OpenRouter als laatste stap en terug naar een abonnement', () => {
  const tabel = [
    ['ander abonnement eerst', { api: { ...basis, stappen: ['api', 'openrouter'] }, beschikbaar: { openrouter: true }, metingen: { 1: meting(95), 2: meting(20) } }, { soort: 'account', naar: 2 }],
    ['alles vol → api', { api: { ...basis, stappen: ['api', 'openrouter'] }, beschikbaar: { openrouter: true }, metingen: { 1: meting(95), 2: meting(96) } }, { soort: 'api', naar: 'api' }],
    ['alles vol, openrouter eerst', { api: { ...basis, stappen: ['openrouter', 'api'] }, beschikbaar: { openrouter: true }, metingen: { 1: meting(95), 2: meting(96) } }, { soort: 'api', naar: 'openrouter' }],
    ['alles vol, alleen openrouter, geen key', { api: { ...basis, stappen: ['openrouter'] }, beschikbaar: { openrouter: false }, metingen: { 1: meting(95), 2: meting(96) } }, null],
    ['op openrouter, abonnement 2 weer ruimte', { api: { ...basis, modus: 'openrouter', overgeschakeldDoor: { label: '5u', resetsAt: NU + 3_600_000 } }, metingen: { 1: meting(95), 2: meting(30) } }, { soort: 'terug', naar: 2 }],
    ['op openrouter met de hand', { api: { ...basis, modus: 'openrouter' }, metingen: { 1: meting(95), 2: meting(30) } }, null],
  ]
  for (const [naam, extra, verwacht] of tabel) {
    const b = ketting({
      accounts: [acc(1), acc(2)], actief: 1, instellingen, laatsteWissel: 0, nu: NU, sessieLimieten: extra.api.modus === 'abonnement' ? vol : [], ...extra,
    })
    if (verwacht === null) assert.equal(b, null, naam)
    else assert.deepEqual({ soort: b?.soort, naar: b?.naar }, verwacht, naam)
  }
})

test('modellenVan: uitvoer van de CLI (al per Mtok) blijft gelijk', () => {
  const lijst = [{ id: 'openai/gpt-5', naam: 'GPT-5', context: 400000, in: 1.25, uit: 10 }, { id: 'x/y', naam: 'Y', in: -1 }]
  assert.deepEqual(modellenVan(lijst), [lijst[0], { id: 'x/y', naam: 'Y' }])
})
