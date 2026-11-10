// node --test futureflow/tests/accounts-lib.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  instellingenVan, ketting, kettingAan, kettingInvoerVan, kiesAccount, maskEmail, planLabel, POLL, pollPlan, ruimte, handmatigTotVan, sessieMeting, STANDAARD_INSTELLINGEN,
  statusVan, telBezig, VERS,
} from '../lib/accounts.mjs'
import { beslis, STANDAARD } from '../lib/api.mjs'

const NU = 1_800_000_000_000
const MIN = 60_000
const AUTO = { ...STANDAARD_INSTELLINGEN, auto: true }

const acc = (id, extra = {}) => ({ id, sleutel: `u${id}:o${id}`, email: `a${id}…@x.nl`, plan: 'Max 5x', inRotatie: true, status: 'ok', ...extra })
const meting = (pct5u, pct7d = 10, extra = {}) => ({
  vensters: [{ label: '5u', pct: pct5u, resetsAt: NU + 60 * MIN }, { label: '7d', pct: pct7d, resetsAt: NU + 3 * 24 * 60 * MIN }],
  gemetenOp: NU - MIN,
  ...extra,
})
const apiAbo = { ...STANDAARD, auto: true, laatsteWissel: 0 }
const apiApi = { ...STANDAARD, auto: true, modus: 'api', laatsteWissel: NU - 60 * MIN, overgeschakeldDoor: { label: '5u', resetsAt: NU + 60 * MIN } }
const sess = pct => [{ label: '5u', percent: pct, resetsAt: NU + 60 * MIN }]

// Basis: A (1) actief, B (2) en C (3) in de rotatie.
const invoer = (o = {}) => ({
  accounts: [acc(1), acc(2), acc(3)],
  actief: 1,
  metingen: { 1: meting(92), 2: meting(30), 3: meting(50) },
  instellingen: AUTO,
  nu: NU,
  laatsteWissel: 0,
  api: apiAbo,
  sessieLimieten: sess(92),
  ...o,
})

test('instellingenVan: onzin → standaard, marges 50-99', () => {
  assert.deepEqual(instellingenVan(null), STANDAARD_INSTELLINGEN)
  assert.deepEqual(instellingenVan({ auto: 'ja', marge5u: 40, marge7d: 100, stand: 'raar' }), STANDAARD_INSTELLINGEN)
  const i = instellingenVan({ auto: true, marge5u: 80.4, marge7d: 95, stand: 'vragen', wachttijd: 1, hysterese: 0 })
  assert.equal(i.auto, true)
  assert.equal(i.marge5u, 80)
  assert.equal(i.marge7d, 95)
  assert.equal(i.stand, 'vragen')
  assert.equal(i.wachttijd, 5 * MIN)
  assert.equal(i.hysterese, 10)
})

test('maskEmail', () => {
  assert.equal(maskEmail('colin@futureflowai.com'), 'co…@futureflowai.com')
  assert.equal(maskEmail('ab@x.nl'), '…@x.nl')
  assert.equal(maskEmail('abc@x.nl'), 'ab…@x.nl')
  assert.equal(maskEmail('geen-at'), '…')
  assert.equal(maskEmail(undefined), '…')
})

test('planLabel', () => {
  assert.equal(planLabel({ subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' }), 'Max 20x')
  assert.equal(planLabel({ subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' }), 'Max 5x')
  assert.equal(planLabel({ subscriptionType: 'max' }), 'Max')
  assert.equal(planLabel({ subscriptionType: 'team', rateLimitTier: 'default_claude_max_5x' }), 'Team')
  assert.equal(planLabel({ subscriptionType: 'pro' }), 'Pro')
  assert.equal(planLabel({ subscriptionType: 'iets' }), '?')
  assert.equal(planLabel(undefined), '?')
})

test('ruimte: kleinste marge − pct, reset voorbij = 0 %, oud = null, per-model telt niet', () => {
  assert.equal(ruimte(meting(92), AUTO, NU), -2)
  assert.equal(ruimte(meting(20, 95), AUTO, NU), -5, '7d boven de marge telt als vol')
  const gereset = { vensters: [{ label: '5u', pct: 99, resetsAt: NU - 1 }, { label: '7d', pct: 40 }], gemetenOp: NU }
  assert.equal(ruimte(gereset, AUTO, NU), 50)
  assert.equal(ruimte(meting(20, 10, { gemetenOp: NU - VERS - 1 }), AUTO, NU), null)
  assert.equal(ruimte(undefined, AUTO, NU), null)
  assert.equal(ruimte({ vensters: [{ label: '7d opus', pct: 99 }, { label: '5u' }], gemetenOp: NU }, AUTO, NU), null)
})

test('kiesAccount en ketting: tabel', () => {
  const rijen = [
    ['actief 92 % 5u, B 30 % → account B', invoer({ metingen: { 1: meting(92), 2: meting(30), 3: meting(95) } }), { soort: 'account', naar: 2 }],
    ['meeste ruimte wint', invoer(), { soort: 'account', naar: 2 }],
    ['actief 92 %, B 85 % (te weinig verschil) → null', invoer({ accounts: [acc(1), acc(2)], metingen: { 1: meting(92), 2: meting(85) } }), null],
    ['actief 92 %, B 95 % en C 91 % → api', invoer({ metingen: { 1: meting(92), 2: meting(95), 3: meting(91) } }), { soort: 'api', naar: 'api' }],
    ['in api, B weer 20 % → terug B', invoer({ api: apiApi, metingen: { 1: meting(95), 2: meting(20), 3: meting(91) } }), { soort: 'terug', naar: 2 }],
    ['in api, B 85 % → null (wacht op hysterese)', invoer({ api: apiApi, metingen: { 1: meting(95), 2: meting(85), 3: meting(91) } }), null],
    ['binnen 5 min na wissel → null', invoer({ laatsteWissel: NU - 4 * MIN }), null],
    ['auto uit → oude gedrag: sessie 92 % → api', invoer({ instellingen: STANDAARD_INSTELLINGEN }), { soort: 'api', naar: 'api' }],
    ['B opnieuw-inloggen → C', invoer({ accounts: [acc(1), acc(2, { status: 'opnieuw-inloggen' }), acc(3)] }), { soort: 'account', naar: 3 }],
    ['B meting 20 min oud → C', invoer({ metingen: { 1: meting(92), 2: meting(30, 10, { gemetenOp: NU - 20 * MIN }), 3: meting(50) } }), { soort: 'account', naar: 3 }],
    ['B niet in rotatie → C', invoer({ accounts: [acc(1), acc(2, { inRotatie: false }), acc(3)] }), { soort: 'account', naar: 3 }],
    ['handmatigTot in de toekomst → null', invoer({ api: { ...apiAbo, handmatigTot: NU + MIN } }), null],
    ['API-wissel net gebeurd → null', invoer({ api: { ...apiAbo, laatsteWissel: NU - MIN } }), null],
    ['7d boven marge en 5u laag → telt als vol', invoer({ metingen: { 1: meting(10, 95), 2: meting(30), 3: meting(50) } }), { soort: 'account', naar: 2 }],
    ['venster met reset voorbij → 0 %', invoer({ metingen: { 1: { vensters: [{ label: '5u', pct: 99, resetsAt: NU - 1 }], gemetenOp: NU }, 2: meting(30), 3: meting(50) }, sessieLimieten: [] }), null],
    ['actief onder de marge → null', invoer({ metingen: { 1: meting(80), 2: meting(10), 3: meting(10) }, sessieLimieten: sess(80) }), null],
    ['in api met de hand (zonder door) → null', invoer({ api: { ...apiApi, overgeschakeldDoor: undefined }, metingen: { 1: meting(95), 2: meting(20), 3: meting(50) } }), null],
  ]
  for (const [naam, s, verwacht] of rijen) {
    const uit = ketting(s)
    if (verwacht === null) assert.equal(uit, null, naam)
    else {
      assert.ok(uit, `${naam}: kreeg null`)
      assert.equal(uit.soort, verwacht.soort, naam)
      assert.equal(uit.naar, verwacht.naar, naam)
      assert.equal(typeof uit.reden, 'string', naam)
    }
  }
})

test('ketting: oude meting van een kandidaat = wachten, niet naar de API', () => {
  const oud = m => ({ ...m, gemetenOp: NU - 20 * MIN })
  const vol = { 2: meting(95), 3: meting(95) }
  const rijen = [
    // [naam, invoer, verwacht soort of null]
    ['alle kandidaten vol en vers, actief 92 % → api', invoer({ metingen: { 1: meting(92), ...vol } }), 'api'],
    ['kandidaat zonder meting (429-backoff) → wachten', invoer({ metingen: { 1: meting(92), 2: meting(95) } }), null],
    ['kandidaat 20 min oud → wachten', invoer({ metingen: { 1: meting(92), 2: oud(meting(10)), 3: meting(95) } }), null],
    ['alle kandidaten oud → wachten', invoer({ metingen: { 1: meting(92), 2: oud(meting(95)), 3: oud(meting(95)) } }), null],
    ['oude kandidaat maar actief op 100 % → api', invoer({ metingen: { 2: oud(meting(95)) }, sessieLimieten: sess(100) }), 'api'],
    ['actief op 100 % met een oude meting en een kandidaat zonder meting → api', invoer({ metingen: { 1: oud(meting(100)) }, sessieLimieten: sess(100) }), 'api'],
    ['100 % maar reset al voorbij telt niet → wachten', invoer({ metingen: { 2: meting(95) }, sessieLimieten: [{ label: '5u', percent: 100, resetsAt: NU - 1 }] }), null],
    ['kandidaat met opnieuw-inloggen telt niet als onverse', invoer({ accounts: [acc(1), acc(2, { status: 'opnieuw-inloggen' }), acc(3)], metingen: { 3: meting(95) } }), 'api'],
    ['actief oude meting, sessie zegt 92 %, B vers 30 → account B', invoer({ metingen: { 1: oud(meting(10)), 2: meting(30), 3: meting(50) }, sessieLimieten: sess(92) }), 'account'],
    ['actief oude meting, sessie zegt 50 %, B vers → null', invoer({ metingen: { 1: oud(meting(92)), 2: meting(30), 3: meting(50) }, sessieLimieten: sess(50) }), null],
    ['actief zonder meting, sessie 92 % → account', invoer({ metingen: { 2: meting(30), 3: meting(50) }, sessieLimieten: sess(92) }), 'account'],
  ]
  for (const [naam, s, verwacht] of rijen) {
    const uit = ketting(s)
    assert.equal(uit === null ? null : uit.soort, verwacht, naam)
  }
})

test('ketting: een account-wissel noemt het venster dat hem veroorzaakte', () => {
  const uit = ketting(invoer({ metingen: { 1: meting(10, 95), 2: meting(30), 3: meting(50) }, sessieLimieten: [] }))
  assert.equal(uit.soort, 'account')
  assert.equal(uit.door.label, '7d')
})

test('ketting: keuze met de hand (accounts.handmatigTot) houdt auto tegen', () => {
  const rijen = [
    ['in de toekomst → null', invoer({ handmatigTot: NU + MIN }), null],
    ['precies nu → vrij', invoer({ handmatigTot: NU }), 'account'],
    ['voorbij → vrij', invoer({ handmatigTot: NU - MIN }), 'account'],
    ['geen → vrij', invoer(), 'account'],
    ['ook naar de API geblokkeerd', invoer({ handmatigTot: NU + MIN, metingen: { 1: meting(92), 2: meting(95), 3: meting(95) } }), null],
  ]
  for (const [naam, s, verwacht] of rijen) {
    const uit = ketting(s)
    assert.equal(uit === null ? null : uit.soort, verwacht, naam)
  }
})

test('handmatigTotVan: reset van het venster van de laatste wissel, anders hoogste venster, anders 5u / 7d', () => {
  const uur = 60 * MIN
  const rijen = [
    ['door met resetsAt', { door: { label: '5u', resetsAt: NU + 2 * uur }, meting: meting(10, 90) }, NU + 2 * uur],
    ['door zonder resetsAt 5u → 5 u', { door: { label: '5u' } }, NU + 5 * uur],
    ['door zonder resetsAt 7d → 7 d', { door: { label: '7d' } }, NU + 7 * 24 * uur],
    ['door met reset voorbij → lengte van het venster', { door: { label: '5u', resetsAt: NU - 1 } }, NU + 5 * uur],
    ['geen door: hoogste venster 7d', { meting: meting(20, 80) }, NU + 3 * 24 * 60 * MIN],
    ['geen door: hoogste venster 5u', { meting: meting(80, 20) }, NU + 60 * MIN],
    ['hoogste venster zonder resetsAt 7d → 7 d', { meting: { vensters: [{ label: '5u', pct: 10 }, { label: '7d', pct: 60 }], gemetenOp: NU } }, NU + 7 * 24 * uur],
    ['niets bekend → 5 u', {}, NU + 5 * uur],
    ['per-model-venster telt niet', { meting: { vensters: [{ label: '7d opus', pct: 99 }], gemetenOp: NU } }, NU + 5 * uur],
  ]
  for (const [naam, s, verwacht] of rijen) assert.equal(handmatigTotVan({ nu: NU, ...s }), verwacht, naam)
})

test('sessieMeting: alleen 5u en 7d met percentage', () => {
  assert.equal(sessieMeting([], NU), undefined)
  assert.equal(sessieMeting(undefined, NU), undefined)
  assert.equal(sessieMeting([{ label: '7d opus', percent: 90 }], NU), undefined)
  const m = sessieMeting([{ label: '5u', percent: 40, resetsAt: NU + MIN }, { label: '7d opus', percent: 90 }], NU)
  assert.deepEqual(m, { vensters: [{ label: '5u', pct: 40, resetsAt: NU + MIN }], gemetenOp: NU })
})

test('kiesAccount: auto uit, geen actief, actief zonder verse meting → null', () => {
  assert.equal(kiesAccount(invoer({ instellingen: STANDAARD_INSTELLINGEN })), null)
  assert.equal(kiesAccount(invoer({ actief: null })), null)
  assert.equal(kiesAccount(invoer({ metingen: { 2: meting(10) } })), null)
  assert.deepEqual(kiesAccount(invoer()).naar, 2)
})

test('ketting met één account in de rotatie = beslis', () => {
  const gevallen = [
    [apiAbo, sess(92)],
    [apiAbo, sess(50)],
    [apiApi, sess(20)],
    [apiApi, sess(95)],
    [{ ...apiAbo, auto: false }, sess(99)],
  ]
  for (const [api, sessieLimieten] of gevallen) {
    const s = invoer({ accounts: [acc(1), acc(2, { inRotatie: false })], api, sessieLimieten })
    const b = beslis({ ...api, limieten: sessieLimieten, nu: NU })
    const k = ketting(s)
    if (!b) assert.equal(k, null)
    else assert.deepEqual(k, { soort: 'api', naar: b.naar, reden: b.reden, ...(b.door ? { door: b.door } : {}) })
  }
})

test('pollPlan: vloer, beweging, stilstand, 429, reset-klem, jitter, uitgeput', () => {
  const mid = () => 0.5 // geen jitter
  // Eerste meting: actief op de vloer, kandidaat op zijn start.
  assert.deepEqual(pollPlan({ actief: true, uitgeput: false, recent429: false, nu: NU, rnd: mid }), { volgende: NU + POLL.vloer, interval: POLL.vloer })
  assert.equal(pollPlan({ actief: false, uitgeput: false, recent429: false, nu: NU, rnd: mid }).interval, POLL.kandidaatStart)
  // Beweging halveert, nooit onder de vloer.
  assert.equal(pollPlan({ vorig: { interval: 900_000, pct: 10 }, nieuwPct: 12, actief: false, uitgeput: false, recent429: false, nu: NU, rnd: mid }).interval, 450_000)
  assert.equal(pollPlan({ vorig: { interval: 400_000, pct: 10 }, nieuwPct: 12, actief: false, uitgeput: false, recent429: false, nu: NU, rnd: mid }).interval, POLL.vloer)
  // Stilstand ×1.5 tot het plafond.
  assert.equal(pollPlan({ vorig: { interval: 800_000, pct: 10 }, nieuwPct: 10.5, actief: false, uitgeput: false, recent429: false, nu: NU, rnd: mid }).interval, POLL.kandidaatMax)
  assert.equal(pollPlan({ vorig: { interval: 600_000, pct: 10 }, nieuwPct: 10, actief: true, uitgeput: false, recent429: false, nu: NU, rnd: mid }).interval, POLL.actiefMax)
  // Na een 429: minstens 600 s, dan ×1.5 tot 1800 s; Retry-After + 60 s.
  assert.equal(pollPlan({ vorig: { interval: POLL.vloer }, actief: true, uitgeput: false, recent429: true, mislukt: true, nu: NU, rnd: mid }).interval, POLL.na429Min)
  assert.equal(pollPlan({ vorig: { interval: 1_500_000, pct: 1 }, nieuwPct: 1, actief: true, uitgeput: false, recent429: true, nu: NU, rnd: mid }).interval, POLL.na429Max)
  const r = pollPlan({ vorig: { interval: POLL.vloer }, actief: true, uitgeput: false, recent429: true, mislukt: true, retryAfter: 3_000_000, nu: NU, rnd: mid })
  assert.equal(r.volgende, NU + 3_000_000 + 60_000)
  // Uitgeput: minstens 1200 s, maar niet later dan de reset + 60 s; nooit onder de vloer.
  assert.equal(pollPlan({ actief: true, uitgeput: true, recent429: false, nu: NU, rnd: mid }).interval, POLL.uitgeput)
  assert.equal(pollPlan({ actief: true, uitgeput: true, recent429: false, resetsAt: NU + 500_000, nu: NU, rnd: mid }).volgende, NU + 560_000)
  assert.equal(pollPlan({ actief: true, uitgeput: true, recent429: false, resetsAt: NU + 10_000, nu: NU, rnd: mid }).volgende, NU + POLL.vloer)
  // Jitter ±10 %.
  assert.equal(pollPlan({ actief: false, uitgeput: false, recent429: false, nu: NU, rnd: () => 1 }).volgende, NU + 660_000)
  assert.equal(pollPlan({ actief: false, uitgeput: false, recent429: false, nu: NU, rnd: () => 0 }).volgende, NU + 540_000)
  // Mislukt zonder 429: ×1.5.
  assert.equal(pollPlan({ vorig: { interval: 600_000 }, actief: true, uitgeput: false, recent429: false, mislukt: true, nu: NU, rnd: mid }).interval, 900_000)
})

test('telBezig: dode pid, desktop, eigen sessie, oude hartslag, waiting, onleesbaar, dubbel', () => {
  const r = telBezig({
    eigen: [
      { sessie: 's1', status: 'bezig', hartslag: NU - MIN },
      { sessie: 's2', status: 'bezig', hartslag: NU - 11 * MIN },
      { sessie: 's3', status: 'tussen', hartslag: NU },
      { sessie: 'ik', status: 'bezig', hartslag: NU },
    ],
    claude: [
      { pid: 10, sessionId: 's1', entrypoint: 'cli', status: 'busy', levend: true },
      { pid: 11, sessionId: 'c1', entrypoint: 'cli', status: 'busy', levend: false },
      { pid: 12, sessionId: 'c2', entrypoint: 'claude-desktop', status: 'busy', levend: true },
      { pid: 13, sessionId: 'c3', entrypoint: 'cli', status: 'waiting', levend: true },
      { pid: 14, sessionId: 'c4', entrypoint: 'cli', status: 'idle', levend: true },
      { pid: 15, sessionId: 'ik', entrypoint: 'cli', status: 'busy', levend: true },
      { pid: 16, sessionId: 'c5', entrypoint: 'cli', levend: true },
      { pid: 17, levend: true, onleesbaar: true },
    ],
    ikzelf: 'ik',
    nu: NU,
  })
  // Het eigen sessiebestand `bezig` telt (eigen beurt loopt); het eigen record van Claude Code niet.
  assert.deepEqual(r.wie.sort(), ['c3', 'c5', 'ik', 'pid 17', 's1'])
  assert.equal(r.bezig, 5)
  const tussen = telBezig({ eigen: [{ sessie: 'ik', status: 'tussen', hartslag: NU }], claude: [{ pid: 15, sessionId: 'ik', entrypoint: 'cli', status: 'busy', levend: true }], ikzelf: 'ik', nu: NU })
  assert.deepEqual(tussen, { bezig: 0, wie: [] })
  assert.deepEqual(telBezig({ eigen: [], claude: [], ikzelf: 'x', nu: NU }), { bezig: 0, wie: [] })
})

test('kettingAan: accounts-auto aan en twee of meer geldige accounts in de rotatie', () => {
  const a = (id, extra = {}) => ({ id, sleutel: `u${id}:o${id}`, ...extra })
  assert.equal(kettingAan(undefined), false)
  assert.equal(kettingAan('onzin'), false)
  assert.equal(kettingAan({ accounts: [a(1), a(2)], instellingen: { auto: false } }), false)
  assert.equal(kettingAan({ accounts: [a(1), a(2)], instellingen: { auto: true } }), true)
  // Rotatie ontbreekt = aan, zoals in de CLI; uit telt niet; kapotte rijen tellen niet.
  assert.equal(kettingAan({ accounts: [a(1), a(2, { inRotatie: false })], instellingen: { auto: true } }), false)
  assert.equal(kettingAan({ accounts: [a(1), { id: 0, sleutel: 'x:y' }, { id: 3, sleutel: 'geen-dubbelepunt' }], instellingen: { auto: true } }), false)
})

test('statusVan: alleen bekende velden; kettingInvoerVan maakt metingen uit 5u en 7d', () => {
  const ruw = {
    actief: 1,
    profiel: 'standaard',
    accounts: [
      { id: 1, email: 'co…@x.nl', plan: 'Max 20x', inRotatie: true, status: 'ok', gebruik: { '5u': { pct: 92, resetsAt: NU + MIN }, '7d': { pct: 10 } }, gemetenOp: NU - MIN, token: 'GEHEIM' },
      { id: 2, email: 'ab…@x.nl', plan: 'Pro', status: 'raar', gebruik: {} },
      { id: 'x' },
    ],
    instellingen: { auto: true, marge5u: 80 },
    laatsteWissel: { tijd: NU - 10 * MIN, van: null, naar: 1, auto: true },
    wacht: { sinds: NU, wie: ['s2', 4] },
  }
  const s = statusVan(ruw, NU)
  assert.equal(JSON.stringify(s).includes('GEHEIM'), false)
  assert.equal(s.accounts.length, 2)
  assert.equal(s.accounts[1].status, 'onbekend')
  assert.equal(s.accounts[1].inRotatie, true)
  assert.deepEqual(s.laatsteWissel, { tijd: NU - 10 * MIN, van: null, naar: 1, auto: true })
  assert.deepEqual(s.wacht, { sinds: NU, wie: ['s2'] })
  assert.equal(s.instellingen.marge5u, 80)
  assert.equal(s.gelezen, NU)
  const k = kettingInvoerVan(s)
  assert.equal(k.actief, 1)
  assert.equal(k.laatsteWissel, NU - 10 * MIN)
  assert.deepEqual(k.metingen[1], { vensters: [{ label: '5u', pct: 92, resetsAt: NU + MIN }, { label: '7d', pct: 10 }], gemetenOp: NU - MIN })
  assert.equal(k.metingen[2], undefined)
  assert.equal(statusVan(null, NU).actief, null)
  assert.equal(statusVan({ profiel: 'eigen' }, NU).profiel, 'eigen')
})
