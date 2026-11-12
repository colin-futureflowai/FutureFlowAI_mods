// node --test futureflow/tests/openrouter-lib.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { beslis, eersteStap, HELPER, modusVan, OR_HELPER, toestandVan, WACHTTIJD } from '../lib/api.mjs'
import { ketting } from '../lib/accounts.mjs'
import {
  contextTekst, eigenBasis, geldigeOrKey, geldigModel, haalWeg, modelIdVoor, modellenVan, orInstellingen, orKosten, pasToe, perMtok, prijsTekst,
  SHIM_MERK, OR_MARKER, orModelAlsStandaard, orcaArgs, orcaClaudeStart, shimTekst, instellingModellen, poortBestand, poortOordeel, poortTekst, sorteer, teKlein, cacheZwak, cacheBlok, cacheProef, cacheRonde, cacheOordeel, cacheTelling, cacheMetingen, cacheStand, keuzeVan, herstartCommando, herstartScript, asString, contextTeGroot, geldigeSessie,
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
  // Marker vóór de exec: zo herkent de mod een claude-or-sessie.
  const r = t.split('\n')
  assert.equal(OR_MARKER, 'FUTUREFLOW_OPENROUTER')
  assert.ok(r.indexOf('export FUTUREFLOW_OPENROUTER=1') > 0)
  assert.ok(r.indexOf('export FUTUREFLOW_OPENROUTER=1') < r.findIndex(x => x.startsWith('exec claude')))
  // Sessie-id voor OpenRouter (vaste aanbieder, cache raakt), ook vóór de exec.
  assert.ok(r.indexOf('export ANTHROPIC_CUSTOM_HEADERS') > 0)
  assert.ok(r.indexOf('export ANTHROPIC_CUSTOM_HEADERS') < r.findIndex(x => x.startsWith('exec claude')))
})

test('shimTekst: zet x-session-id en laat bestaande eigen headers staan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-shim-'))
  const nep = path.join(dir, 'claude')
  fs.writeFileSync(nep, '#!/bin/sh\nprintf "%s" "$ANTHROPIC_CUSTOM_HEADERS"\n', { mode: 0o755 })
  const inst = path.join(dir, 'settings.json')
  fs.writeFileSync(inst, '{}')
  fs.writeFileSync(path.join(dir, 'poort'), 'ok\n')
  const shim = path.join(dir, 'claude-or')
  fs.writeFileSync(shim, shimTekst(inst), { mode: 0o755 })
  const draai = env => spawnSync('/bin/sh', [shim], { env: { PATH: `${dir}:/usr/bin:/bin`, ...env }, encoding: 'utf8' }).stdout
  const een = draai({})
  assert.match(een, /^x-session-id: [0-9A-Za-z-]{8,}$/)
  assert.notEqual(draai({}), een)
  assert.match(draai({ ANTHROPIC_CUSTOM_HEADERS: 'x-eigen: 1' }), /^x-eigen: 1\nx-session-id: [0-9A-Za-z-]{8,}$/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('startcheck: elk model moet gemeten zijn en cachen; poortbestand en shim', () => {
  const m = (oordeel) => ({ oordeel, aandeel: 50, raak: 3, van: 5, gemeten: 1 })
  const metingen = { 'a/goed': m('goed'), 'a/wissel': m('wisselend'), 'a/zwak': m('zwak'), 'qwen/gemeten': m('goed') }
  assert.deepEqual(poortOordeel(['a/goed[1m]', 'a/wissel', 'a/goed', undefined, 'qwen/gemeten'], metingen), { ok: true, redenen: [] })
  assert.deepEqual(poortOordeel(['a/goed', 'a/zwak[1m]', 'b/nieuw', 'qwen/x', 'b/nieuw'], metingen), {
    ok: false,
    redenen: [{ id: 'a/zwak', reden: 'zwak' }, { id: 'b/nieuw', reden: 'ongemeten' }, { id: 'qwen/x', reden: 'zwak' }],
  })
  assert.deepEqual(poortOordeel(['a/b'], undefined).redenen, [{ id: 'a/b', reden: 'ongemeten' }])
  assert.equal(poortTekst([{ id: 'a/zwak', reden: 'zwak' }, { id: 'b/nieuw', reden: 'ongemeten' }]), 'a/zwak cachet niet in een agent-lus; b/nieuw is nog niet gemeten')
  assert.equal(poortBestand({ ok: true, redenen: [] }), 'ok\n')
  assert.equal(poortBestand({ ok: false, redenen: [{ id: 'b/nieuw', reden: 'ongemeten' }] }), 'geweigerd\nb/nieuw is nog niet gemeten\n')
  // Alle modellen die een sessie kan gebruiken, elk één keer en zonder [1m].
  assert.deepEqual(instellingModellen(orInstellingen({ m1: 'a/een[1m]', m4: 'a/vier', m5: 'a/vijf' })), ['a/een', 'a/vier', 'a/vijf'])
  assert.deepEqual(instellingModellen(undefined), [])
  // De shim leest het poortbestand naast het settings-bestand, vóór de exec.
  const r = shimTekst("/Users/x/it's/settings.json").split('\n')
  assert.ok(r.includes("P='/Users/x/it'\\''s/poort'"))
  assert.ok(r.findIndex(x => x.startsWith('if [ "$POORT" != "ok" ]')) < r.findIndex(x => x.startsWith('exec claude')))
  assert.ok(shimTekst('/a/settings.json', '/b/p').includes("P='/b/p'"))
})

test('cacheZwak: qwen-modellen, andere niet', () => {
  assert.equal(cacheZwak({ id: 'qwen/qwen3.8-max-0902' }), true)
  assert.equal(cacheZwak({ id: 'moonshotai/kimi-k3.1-pro' }), false)
  assert.equal(cacheZwak({}), false)
  assert.equal(cacheZwak(null), false)
})

test('orModelAlsStandaard: id met / of een gekozen model; Claude-modellen en leeg niet', () => {
  assert.equal(orModelAlsStandaard('openai/gpt-5.1', {}), true)
  assert.equal(orModelAlsStandaard('gpt-x', { m1: 'gpt-x[1m]' }), true)
  assert.equal(orModelAlsStandaard('opus', { m1: 'openai/gpt-5' }), false)
  assert.equal(orModelAlsStandaard('claude-opus-5-5', undefined), false)
  assert.equal(orModelAlsStandaard(undefined, { m1: 'a/b' }), false)
  assert.equal(orModelAlsStandaard('', { m1: '' }), false)
})

test('orcaArgs: terminal create in de worktree (id) of de map (path); zonder bin niets', () => {
  const c = "cd '/a' && '/s' --resume 'x'"
  assert.deepEqual(orcaArgs({ bin: '/o/bin/', worktree: 'repo-1::/w/p', cwd: '/a', commando: c }),
    ['/o/bin/orca', 'terminal', 'create', '--worktree', 'id:repo-1::/w/p', '--title', 'claude-or', '--command', c, '--focus', '--json'])
  assert.equal(orcaArgs({ bin: '/o', worktree: undefined, cwd: '/a', commando: c })[4], 'path:/a')
  assert.equal(orcaArgs({ bin: undefined, worktree: 'r::/w', cwd: '/a', commando: c }), undefined)
  assert.equal(orcaArgs({ bin: 'rel', worktree: 'r::/w', cwd: '/a', commando: c }), undefined)
  assert.equal(orcaArgs({ bin: '/o', worktree: 'zonder', cwd: 'rel', commando: c }), undefined)
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

test('herstart: commando quoot map, shim en sessie; ongeldig id of relatieve map → undefined', () => {
  const id = 'f2b8903e-a21c-4741-b219-c03db7d5e4cb'
  assert.equal(herstartCommando({ cwd: "/a/b'c d", sessie: id, shim: '/h/.local/bin/claude-or' }), `cd '/a/b'\\''c d' && '/h/.local/bin/claude-or' --resume '${id}'`)
  assert.equal(herstartCommando({ cwd: '/a', sessie: 'x; rm -rf /', shim: '/s' }), undefined)
  assert.equal(herstartCommando({ cwd: 'rel', sessie: id, shim: '/s' }), undefined)
  assert.equal(geldigeSessie('abc'), false)
  assert.equal(asString('a"b\\c\nd'), '"a\\"b\\\\c d"')
  const t = herstartScript('terminal', `cd '/x' && 'y' --resume '${id}'`)
  assert.match(t, /tell application "Terminal"/)
  assert.match(t, /do script "cd '\/x' && 'y' --resume/)
  assert.match(herstartScript('iterm', 'ls'), /tell application "iTerm"[\s\S]*write text "ls"/)
  assert.equal(contextTeGroot(300_000, 200_000), true)
  assert.equal(contextTeGroot(100_000, 200_000), false)
  assert.equal(contextTeGroot(undefined, 200_000), false)
})

test('orInstellingen: Model 1-5; lege 2-4 = Model 1, lege 5 = geen extra regel; 4 = haiku en subagents', () => {
  const e = orInstellingen({ m1: 'a/een', m2: 'a/twee[1m]', m3: '', m4: 'a/vier' }).env
  assert.equal(e.ANTHROPIC_MODEL, 'a/een')
  assert.equal(e.ANTHROPIC_DEFAULT_OPUS_MODEL, 'a/een')
  assert.equal(e.ANTHROPIC_DEFAULT_SONNET_MODEL, 'a/twee[1m]')
  assert.equal(e.ANTHROPIC_DEFAULT_FABLE_MODEL, 'a/een')
  assert.equal(e.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'a/vier')
  assert.equal(e.CLAUDE_CODE_SUBAGENT_MODEL, 'a/vier')
  assert.equal(e.ENABLE_TOOL_SEARCH, 'true')
  // De beta-vlag zet tool search uit en hoort er dus niet in.
  assert.equal(e.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, undefined)
  assert.equal(e.ANTHROPIC_CUSTOM_MODEL_OPTION, undefined)
  const v = orInstellingen({ m1: 'a/een', m5: 'x/vijf' }).env
  assert.equal(v.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'a/een')
  assert.equal(v.ANTHROPIC_CUSTOM_MODEL_OPTION, 'x/vijf')
  assert.equal(v.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME, 'Model 5 · x/vijf')
  assert.ok(v.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION)
})

test('keuzeVan: oude vorm migreert (hoofd/opus → 1, sonnet → 2, fable → 3, snel → 4); onzin = leeg', () => {
  assert.deepEqual(keuzeVan({ model: 'a/h', snel: 'a/s' }), { m1: 'a/h', m4: 'a/s' })
  assert.deepEqual(keuzeVan({ model: 'a/h', opus: 'a/o', sonnet: 'a/so', fable: 'a/f', snel: 'a/s' }), { m1: 'a/o', m2: 'a/so', m3: 'a/f', m4: 'a/s' })
  assert.deepEqual(keuzeVan({ m1: 'a/1', model: 'a/h', m5: 'a/5' }), { m1: 'a/1', m5: 'a/5' })
  for (const ruw of [undefined, null, 'x', 42, ['a/b'], { model: 42, snel: null }]) assert.deepEqual(keuzeVan(ruw), {})
})

test('orcaClaudeStart: claude-workers via Orca herkennen; --terminal, codex en andere commando\'s niet', () => {
  assert.equal(orcaClaudeStart('orca orchestration worker-start --spec "x" --worktree current --agent claude --json'), true)
  assert.equal(orcaClaudeStart("cd /a && '/o/bin/orca' agent launch --agent=claude --prompt 'p'"), true)
  assert.equal(orcaClaudeStart('orca worktree create --repo id:r --name t --agent claude-agent-teams --json'), true)
  assert.equal(orcaClaudeStart('orca orchestration worker-start --spec x --terminal t1 --worktree current --json'), false)
  assert.equal(orcaClaudeStart('orca agent launch --agent codex --json'), false)
  assert.equal(orcaClaudeStart('echo orca agent launch'), false)
  assert.equal(orcaClaudeStart('claude --agent claude'), false)
})

test('orcaArgs: geen orca uit de projectmap', () => {
  assert.equal(orcaArgs({ bin: '/proj/bin', worktree: 'r::/w', cwd: '/proj', commando: 'x' }), undefined)
})

test('cacheProef: zes rondes met groeiende lus, vaste prefix, markering op systeem en laatste tool_result', () => {
  const p = cacheProef('qwen/x[1m]', 'zaad-1')
  assert.equal(p.length, 6)
  assert.deepEqual(p.map(b => b.messages.length), [3, 5, 7, 9, 11, 13])
  for (const b of p) {
    assert.equal(b.model, 'qwen/x')
    assert.equal(b.max_tokens, 16)
    assert.deepEqual(b.system[0].cache_control, { type: 'ephemeral' })
    assert.equal(b.tools[0].name, 'Read')
    const gemarkeerd = b.messages.flatMap(m => m.content).filter(c => c.cache_control)
    assert.equal(gemarkeerd.length, 1)
    assert.equal(gemarkeerd[0], b.messages.at(-1).content[0])
    assert.equal(gemarkeerd[0].type, 'tool_result')
  }
  // Prefix gelijk: ronde 2 begint met de berichten van ronde 1 (op de markering na).
  const zonder = m => JSON.stringify(m, (k, v) => (k === 'cache_control' ? undefined : v))
  assert.equal(zonder(p[1].messages.slice(0, 3)), zonder(p[0].messages))
  assert.equal(p[0].system[0].text, p[5].system[0].text)
  // Ander zaad: andere tekst, dus geen treffer uit een eerdere meting.
  assert.notEqual(cacheProef('qwen/x', 'zaad-2')[0].system[0].text, p[0].system[0].text)
  assert.equal(cacheBlok('a'), cacheBlok('a'))
  assert.equal(cacheBlok('a', 5).split(' ').length, 5)
})

test('cacheRonde, cacheTelling en cacheOordeel: één misser is nog goed, meer is wisselend, nooit raak is zwak', () => {
  assert.deepEqual(cacheRonde({ input_tokens: 3187, cache_read_input_tokens: 9408 }), { in: 3187, read: 9408, write: 0, aandeel: 75 })
  assert.deepEqual(cacheRonde({ input_tokens: 0, cache_read_input_tokens: null }), { in: 0, read: 0, write: 0, aandeel: 0 })
  assert.deepEqual(cacheRonde(undefined), { in: 0, read: 0, write: 0, aandeel: 0 })
  // Elke ronde 100 tokens; het aandeel uit cache per ronde.
  const r = (...a) => a.map(aandeel => ({ in: 100 - aandeel, read: aandeel, write: 0, aandeel }))
  assert.equal(cacheOordeel(r(0, 67, 75, 80, 83, 86)), 'goed') // openai
  assert.equal(cacheOordeel(r(0, 67, 0, 80, 83, 86)), 'goed') // één misser (kimi, grok)
  assert.equal(cacheOordeel(r(0, 0, 67, 32, 0, 86)), 'wisselend') // gemini
  assert.equal(cacheOordeel(r(0, 0, 0, 0, 0, 86)), 'wisselend')
  assert.equal(cacheOordeel(r(0, 35, 26, 21, 17, 14)), 'zwak') // qwen
  assert.equal(cacheOordeel(r(0, 75, 80)), 'onbekend')
  assert.equal(cacheOordeel(null), 'onbekend')
  assert.deepEqual(cacheTelling(r(0, 67, 0, 80, 83, 86)), { raak: 4, van: 5, aandeel: 63 })
  assert.deepEqual(cacheTelling(r(0, 35, 26, 21, 17, 14)), { raak: 0, van: 5, aandeel: 23 })
  assert.deepEqual(cacheTelling(undefined), { raak: 0, van: 0, aandeel: 0 })
})

test('cacheMetingen en cacheStand: een eigen meting gaat voor de vaste lijst; onzin en oude metingen vallen weg', () => {
  const goed = { oordeel: 'goed', aandeel: 78, raak: 5, van: 5, gemeten: 5 }
  const m = cacheMetingen({
    'qwen/a': { ...goed, extra: 1 },
    'x/b': { ...goed, oordeel: 'raar' },
    'x/oud': { oordeel: 'laat', aandeel: 80, gemeten: 1 },
    'x/zonder': { oordeel: 'goed', aandeel: 80, gemeten: 1 },
    geen: 1,
    'x/c': null,
  })
  assert.deepEqual(m, { 'qwen/a': goed })
  assert.deepEqual(cacheMetingen('x'), {})
  assert.equal(cacheStand({ id: 'qwen/a' }, m).oordeel, 'goed')
  assert.equal(cacheStand({ id: 'qwen/a' }, m).raak, 5)
  assert.equal(cacheStand({ id: 'qwen/b' }, m).oordeel, 'zwak')
  assert.equal(cacheStand({ id: 'qwen/b' }, m).aandeel, undefined)
  assert.equal(cacheStand({ id: 'openai/gpt-5' }, m), null)
  assert.equal(cacheStand({ id: 'openai/gpt-5' }, { 'openai/gpt-5': { ...goed, oordeel: 'zwak' } }).tekst, 'cachet niet in een agent-lus: duur in Claude Code')
  assert.match(cacheStand({ id: 'a/b' }, { 'a/b': { ...goed, oordeel: 'wisselend' } }).tekst, /wisselend/)
})
