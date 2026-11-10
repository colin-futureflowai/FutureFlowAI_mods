// Tab Accounts: keuze van het account, de ketting met de API-wissel, maskeren, poll-plan en
// sessie-telling. Pure functies, zonder Node-API's (ook bruikbaar in de hooks-module).
// Getallen en volgorde komen van claude-swap (MIT, github.com/realiti4/claude-swap, commit 5ac68bfb),
// met de zuinigere poll-getallen die Colin op 10-11-2026 koos.

import { beslis, horizon, WACHTTIJD } from './api.mjs'

// Sleutelhanger: het live item van Claude Code en futureflow's eigen items.
export const LIVE = 'Claude Code-credentials'
export const KOPIE = 'futureflow-accounts'
export const VORIGE = 'futureflow-accounts-vorige'
export const REDDING = 'futureflow-accounts-redding'

// Sleutels in het credential-object die bij de Mac horen, niet bij het account: bij een wissel
// blijft de live versie staan en ze gaan nooit mee in een kopie (claude-swap credentials.py:229-305).
export const GEDEELD = ['mcpOAuth', 'mcpOAuthClientConfig', 'mcpXaaIdp', 'mcpXaaIdpConfig', 'pluginSecrets']

// Een meting is bruikbaar voor een besluit zolang hij jonger is dan dit (ms).
export const VERS = 15 * 60_000

export const STANDAARD_INSTELLINGEN = {
  auto: false,
  marge5u: 90,
  marge7d: 90,
  strategie: 'meeste-ruimte',
  wachttijd: 5 * 60_000,
  hysterese: 10,
  stand: 'stil',
  maxWacht: 10 * 60_000,
}

const marge = (v, standaard) => (typeof v === 'number' && Number.isFinite(v) && v >= 50 && v <= 99 ? Math.round(v) : standaard)

// Instellingen uit accounts.json; onzin wordt de standaard. Marges 50-99; wachttijd, hysterese en
// maxWacht liggen vast (alleen auto, marges en stand zijn instelbaar).
export function instellingenVan(ruw) {
  const r = ruw && typeof ruw === 'object' && !Array.isArray(ruw) ? ruw : {}
  const s = STANDAARD_INSTELLINGEN
  return {
    auto: r.auto === true,
    marge5u: marge(r.marge5u, s.marge5u),
    marge7d: marge(r.marge7d, s.marge7d),
    strategie: 'meeste-ruimte',
    wachttijd: s.wachttijd,
    hysterese: s.hysterese,
    stand: r.stand === 'vragen' ? 'vragen' : 'stil',
    maxWacht: s.maxWacht,
  }
}

// colin@futureflowai.com → co…@futureflowai.com; korter dan 3 tekens voor de @ → …@domein.
export function maskEmail(e) {
  if (typeof e !== 'string') return '…'
  const at = e.lastIndexOf('@')
  if (at < 0) return '…'
  const naam = e.slice(0, at)
  const domein = e.slice(at + 1)
  return naam.length < 3 ? `…@${domein}` : `${naam.slice(0, 2)}…@${domein}`
}

// Plan uit het credential-object (zonder tokens): max + default_claude_max_20x → Max 20x.
export function planLabel(o) {
  const soort = typeof o?.subscriptionType === 'string' ? o.subscriptionType.toLowerCase() : ''
  const tier = typeof o?.rateLimitTier === 'string' ? o.rateLimitTier.toLowerCase() : ''
  if (soort === 'max') {
    const x = /max_(\d+)x/.exec(tier)
    return x ? `Max ${x[1]}x` : 'Max'
  }
  if (soort === 'team') return 'Team'
  if (soort === 'pro') return 'Pro'
  if (soort === 'enterprise') return 'Enterprise'
  return '?'
}

const getal = v => typeof v === 'number' && Number.isFinite(v)

// Kleinste (marge − pct) over de vensters 5u en 7d; een venster waarvan de reset voorbij is telt als
// 0 %. Per-model-vensters (7d opus …) tellen niet mee. null: geen of te oude meting, of geen venster
// met een percentage.
export function ruimte(m, i, nu) {
  if (!m || !Array.isArray(m.vensters) || !getal(m.gemetenOp) || nu - m.gemetenOp > VERS) return null
  let min = null
  for (const v of m.vensters) {
    if (!v || (v.label !== '5u' && v.label !== '7d') || !getal(v.pct)) continue
    const pct = getal(v.resetsAt) && v.resetsAt <= nu ? 0 : v.pct
    const r = (v.label === '5u' ? i.marge5u : i.marge7d) - pct
    if (min === null || r < min) min = r
  }
  return min
}

const rond = n => Math.round(n * 10) / 10

// De eigen rate limits van de sessie (`limietenVan`) als verse meting van het actieve account; alleen
// 5u en 7d. undefined als er geen venster met een percentage is.
export function sessieMeting(limieten, nu) {
  const vensters = []
  for (const l of Array.isArray(limieten) ? limieten : []) {
    if (!l || (l.label !== '5u' && l.label !== '7d') || !getal(l.percent)) continue
    vensters.push({ label: l.label, pct: l.percent, ...(getal(l.resetsAt) ? { resetsAt: l.resetsAt } : {}) })
  }
  return vensters.length ? { vensters, gemetenOp: nu } : undefined
}

// Staat een venster van een verse meting echt op 100 % (limiet bereikt, reset nog niet voorbij)?
function limietBereikt(m, nu) {
  if (!m || !Array.isArray(m.vensters) || !getal(m.gemetenOp) || nu - m.gemetenOp > VERS) return false
  return m.vensters.some(v => v && (v.label === '5u' || v.label === '7d') && getal(v.pct) && v.pct >= 100 && !(getal(v.resetsAt) && v.resetsAt <= nu))
}

// Het venster met de minste ruimte (het venster dat de wissel veroorzaakt).
function beperkendVenster(m, i, nu) {
  let best = null
  for (const v of m?.vensters ?? []) {
    if (!v || (v.label !== '5u' && v.label !== '7d') || !getal(v.pct)) continue
    const pct = getal(v.resetsAt) && v.resetsAt <= nu ? 0 : v.pct
    const r = (v.label === '5u' ? i.marge5u : i.marge7d) - pct
    if (!best || r < best.r) best = { r, v }
  }
  return best ? { label: best.v.label, ...(getal(best.v.resetsAt) ? { resetsAt: best.v.resetsAt } : {}) } : undefined
}

// Een keuze met de hand terwijl auto aan staat: tot wanneer auto die laat staan. De reset van het
// venster dat de laatste (automatische) wissel veroorzaakte (`door`); anders het hoogste venster (5u of
// 7d) van `meting`; zonder resetsAt (of al voorbij) de lengte van het venster; zonder enig venster 5 u.
// Zelfde regel als `handmatigTot` bij de API-wissel.
export function handmatigTotVan(s) {
  const nu = s.nu
  const tot = v => (getal(v.resetsAt) && v.resetsAt > nu ? v.resetsAt : nu + horizon(v.label))
  if (s.door && typeof s.door.label === 'string') return tot(s.door)
  let hoogste = null
  for (const v of s.meting?.vensters ?? []) {
    if (!v || (v.label !== '5u' && v.label !== '7d') || !getal(v.pct)) continue
    if (!hoogste || v.pct > hoogste.pct) hoogste = v
  }
  return hoogste ? tot(hoogste) : nu + horizon('5u')
}

// Strategie meeste ruimte: alleen met auto aan, buiten de wachttijd, en als het actieve account op of
// boven een marge zit. Dan het account in de rotatie (status ok, verse meting) met de meeste ruimte,
// mits dat minstens `hysterese` punten meer is dan het actieve.
export function kiesAccount(s) {
  const i = s.instellingen
  if (!i.auto || s.actief === null || s.actief === undefined) return null
  if (s.nu - (s.laatsteWissel ?? 0) < i.wachttijd) return null
  const rAct = ruimte(s.metingen?.[s.actief], i, s.nu)
  if (rAct === null || rAct > 0) return null
  let best = null
  for (const a of s.accounts) {
    if (a.id === s.actief || !a.inRotatie || a.status !== 'ok') continue
    const r = ruimte(s.metingen?.[a.id], i, s.nu)
    if (r === null || r <= 0) continue
    if (!best || r > best.r) best = { id: a.id, r }
  }
  if (!best || best.r < rAct + i.hysterese) return null
  return { naar: best.id, reden: `account ${s.actief} op of boven de marge; account ${best.id} heeft ${rond(best.r)} punten ruimte` }
}

// Het hele besluit: eerst een ander abonnement met ruimte, pas als alle abonnementen vol zitten de API
// (bestaande `beslis`), en terug van de API zodra een abonnement weer ruimte heeft.
// Minder dan twee accounts in de rotatie, of auto voor accounts uit: precies het oude gedrag (`beslis`).
export function ketting(s) {
  const { api, nu } = s
  const i = s.instellingen
  // De eigen rate limits van de sessie zijn de verse meting van het actieve account.
  const eigen = s.actief !== null && s.actief !== undefined ? sessieMeting(s.sessieLimieten, nu) : undefined
  const metingen = eigen ? { ...s.metingen, [s.actief]: eigen } : s.metingen
  const si = { ...s, metingen }
  const oud = () => {
    const b = beslis({ ...api, limieten: s.sessieLimieten, nu })
    return b ? { soort: 'api', naar: b.naar, reden: b.reden, ...(b.door ? { door: b.door } : {}) } : null
  }
  const rotatie = s.accounts.filter(a => a.inRotatie)
  if (rotatie.length < 2 || !i.auto) return oud()

  // Een keuze met de hand en de wachttijd van beide gaan altijd voor.
  if (typeof api.handmatigTot === 'number' && nu < api.handmatigTot) return null
  if (typeof s.handmatigTot === 'number' && nu < s.handmatigTot) return null
  if (nu - (api.laatsteWissel ?? 0) < WACHTTIJD) return null
  if (nu - (s.laatsteWissel ?? 0) < i.wachttijd) return null

  // Accounts in de rotatie met status ok en een verse meting; de rest telt niet mee.
  const bruikbaar = rotatie
    .filter(a => a.status === 'ok')
    .map(a => ({ id: a.id, r: ruimte(metingen?.[a.id], i, nu) }))
    .filter(x => x.r !== null)

  if (api.modus === 'abonnement') {
    const k = kiesAccount(si)
    if (k) {
      const door = beperkendVenster(metingen?.[s.actief], i, nu)
      return { soort: 'account', ...k, ...(door ? { door } : {}) }
    }
    if (bruikbaar.some(x => x.r > 0)) return null
    // Wachten, niet naar de API op oude data: een kandidaat zonder verse meting kan ruimte hebben.
    // Alleen als het actieve account echt op 100 % staat (limiet bereikt) mag het toch.
    const onverse = rotatie.some(a => a.id !== s.actief && a.status === 'ok' && ruimte(metingen?.[a.id], i, nu) === null)
    if (onverse && !limietBereikt(metingen?.[s.actief], nu)) return null
    return oud()
  }
  if (api.modus === 'api' && api.overgeschakeldDoor) {
    const best = bruikbaar.filter(x => x.r >= i.hysterese).sort((a, b) => b.r - a.r)[0]
    if (best) return { soort: 'terug', naar: best.id, reden: `account ${best.id} heeft weer ${rond(best.r)} punten ruimte` }
    return oud()
  }
  return null
}

// Poll-ritme per account (ms). Vorm van claude-swap poll_policy.py; getallen zuiniger (besluit Colin
// 10-11-2026: de accounts worden ook op andere machines gebruikt).
export const POLL = {
  vloer: 360_000, // nooit vaker per account
  actiefMax: 600_000, // stil actief account
  kandidaatStart: 600_000,
  kandidaatMax: 900_000, // stil niet-actief account
  uitgeput: 1_200_000,
  na429Min: 600_000,
  na429Max: 1_800_000,
  factor: 1.5,
  beweging: 1, // punten
  jitter: 0.1,
  resetMarge: 60_000,
  retryMarge: 60_000,
  recent429: 3_600_000,
}

// Wanneer de volgende meting. Beweging (≥ 1 punt) halveert het interval (vloer), stilstand ×1.5 tot
// het plafond; na een 429 minstens na429Min en ×1.5 tot na429Max; uitgeput minstens `uitgeput`;
// mislukt (geen 429) ×1.5 tot na429Max. Jitter ±10 %, nooit later dan resetsAt + 60 s, nooit eerder
// dan de vloer, en na een Retry-After (ms) pas daarna + 60 s.
export function pollPlan(p) {
  const P = POLL
  const start = p.actief ? P.vloer : P.kandidaatStart
  const plafond = p.actief ? P.actiefMax : P.kandidaatMax
  const basis = getal(p.vorig?.interval) && p.vorig.interval > 0 ? p.vorig.interval : start
  let interval
  if (p.mislukt) interval = Math.min(P.na429Max, Math.max(P.vloer, basis * P.factor))
  else if (!getal(p.vorig?.pct) || !getal(p.nieuwPct)) interval = start
  else if (Math.abs(p.nieuwPct - p.vorig.pct) >= P.beweging) interval = Math.max(P.vloer, basis / 2)
  else interval = Math.min(plafond, Math.max(P.vloer, basis * P.factor))
  if (p.recent429) interval = Math.min(P.na429Max, Math.max(interval, basis * P.factor, P.na429Min))
  if (p.uitgeput) interval = Math.max(interval, P.uitgeput)

  const nu = p.nu
  let volgende = nu + interval * (1 + P.jitter * (2 * p.rnd() - 1))
  if (getal(p.resetsAt) && p.resetsAt > nu) volgende = Math.min(volgende, p.resetsAt + P.resetMarge)
  volgende = Math.max(volgende, nu + P.vloer)
  if (getal(p.retryAfter)) volgende = Math.max(volgende, nu + p.retryAfter + P.retryMarge)
  return { volgende: Math.round(volgende), interval: Math.round(interval) }
}

const HARTSLAG = 10 * 60_000

// Hoeveel terminal-sessies nu midden in een beurt zitten. Eigen bestand `bezig` met een hartslag
// jonger dan 10 min telt, ook dat van de eigen sessie (de mod zet het pas op `tussen` als de beurt
// klaar is; zo wisselt een sessie nooit midden in haar eigen beurt). Een record van Claude Code telt als
// de pid leeft, het geen desktop-sessie is en de status niet `idle` is (busy, waiting en onbekend
// tellen). Onleesbaar telt. Alleen het record van Claude Code van de eigen sessie telt nooit: hoe
// lang dat na een beurt nog `busy` blijft, is niet bekend.
export function telBezig(p) {
  const wie = new Set()
  for (const e of Array.isArray(p.eigen) ? p.eigen : []) {
    if (!e) continue
    if (e.status === 'bezig' && getal(e.hartslag) && p.nu - e.hartslag < HARTSLAG) wie.add(e.sessie)
  }
  for (const c of Array.isArray(p.claude) ? p.claude : []) {
    if (!c || !c.levend) continue
    if (c.onleesbaar) {
      wie.add(`pid ${c.pid}`)
      continue
    }
    if (c.sessionId !== undefined && c.sessionId === p.ikzelf) continue
    if (c.entrypoint === 'claude-desktop') continue
    if (c.status === 'idle') continue
    wie.add(c.sessionId ?? `pid ${c.pid}`)
  }
  return { bezig: wie.size, wie: [...wie] }
}

// ---- voor de mod (hooks/accounts.tsx en hooks/api.tsx) ----

const geldigAccount = a => a && typeof a === 'object' && Number.isInteger(a.id) && a.id > 0

// Of de ketting (accounts eerst, dan de API) het besluit neemt: accounts-auto aan en minstens twee
// accounts in de rotatie, zoals `ketting` dat ook bepaalt. `staat` = accounts.json zoals de CLI hem
// schrijft (of onzin: dan niet, en blijft het oude API-gedrag). Rotatie ontbreekt = aan, zoals in de CLI.
export function kettingAan(staat) {
  if (!staat || typeof staat !== 'object' || !Array.isArray(staat.accounts)) return false
  const rotatie = staat.accounts.filter(a => geldigAccount(a) && typeof a.sleutel === 'string' && a.sleutel.includes(':') && a.inRotatie !== false)
  return rotatie.length >= 2 && instellingenVan(staat.instellingen).auto
}

const STATUSSEN = new Set(['ok', 'opnieuw-inloggen', 'onbekend'])
const tekst = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined)
const venster = v => {
  if (!v || typeof v !== 'object') return undefined
  return { ...(getal(v.pct) ? { pct: v.pct } : {}), ...(getal(v.resetsAt) ? { resetsAt: v.resetsAt } : {}) }
}

// Uitvoer van `cli/accounts.mjs status --json`, nagekeken: alleen bekende velden, zodat de tab en het
// besluit nooit iets anders zien dan wat de CLI belooft (gemaskeerde e-mail, getallen, tijden).
export function statusVan(ruw, gelezen) {
  const d = ruw && typeof ruw === 'object' ? ruw : {}
  const accounts = (Array.isArray(d.accounts) ? d.accounts : []).filter(geldigAccount).map(a => {
    const g = a.gebruik && typeof a.gebruik === 'object' ? a.gebruik : {}
    const v5 = venster(g['5u'])
    const v7 = venster(g['7d'])
    return {
      id: a.id,
      email: tekst(a.email, 120) ?? '…',
      plan: tekst(a.plan, 40) ?? '?',
      inRotatie: a.inRotatie !== false,
      status: STATUSSEN.has(a.status) ? a.status : 'onbekend',
      ...(tekst(a.statusUitleg) ? { statusUitleg: tekst(a.statusUitleg) } : {}),
      ...(tekst(a.label, 60) ? { label: tekst(a.label, 60) } : {}),
      gebruik: { ...(v5 ? { '5u': v5 } : {}), ...(v7 ? { '7d': v7 } : {}) },
      ...(getal(a.gemetenOp) ? { gemetenOp: a.gemetenOp } : {}),
      ...(tekst(a.fout) ? { fout: tekst(a.fout) } : {}),
    }
  })
  const lw = d.laatsteWissel
  const w = d.wacht
  return {
    actief: Number.isInteger(d.actief) ? d.actief : null,
    profiel: d.profiel === 'eigen' ? 'eigen' : 'standaard',
    accounts,
    instellingen: instellingenVan(d.instellingen),
    ...(lw && getal(lw.tijd) && Number.isInteger(lw.naar)
      ? { laatsteWissel: { tijd: lw.tijd, van: Number.isInteger(lw.van) ? lw.van : null, naar: lw.naar, auto: lw.auto === true } }
      : {}),
    ...(w && getal(w.sinds) ? { wacht: { sinds: w.sinds, wie: Array.isArray(w.wie) ? w.wie.filter(x => typeof x === 'string').slice(0, 10) : [] } } : {}),
    ...(tekst(d.fout) ? { fout: tekst(d.fout) } : {}),
    gelezen,
  }
}

// Invoer voor `ketting` uit een nagekeken status: accounts en metingen (alleen 5u en 7d).
export function kettingInvoerVan(status) {
  const accounts = status.accounts.map(a => ({ id: a.id, sleutel: String(a.id), email: a.email, plan: a.plan, inRotatie: a.inRotatie, status: a.status }))
  const metingen = {}
  for (const a of status.accounts) {
    if (!getal(a.gemetenOp)) continue
    const vensters = []
    for (const label of ['5u', '7d']) {
      const v = a.gebruik[label]
      if (v) vensters.push({ label, ...v })
    }
    metingen[a.id] = { vensters, gemetenOp: a.gemetenOp }
  }
  return { accounts, actief: status.actief, metingen, instellingen: status.instellingen, laatsteWissel: status.laatsteWissel?.tijd ?? 0 }
}
