// Tab Accounts: keuze van het account, de ketting met de API-wissel, maskeren, poll-plan en
// sessie-telling. Pure functies, zonder Node-API's (ook bruikbaar in de hooks-module).
// Getallen en volgorde komen van claude-swap (MIT, github.com/realiti4/claude-swap, commit 5ac68bfb),
// met de zuinigere poll-getallen die Colin op 10-11-2026 koos.

import { beslis, WACHTTIJD } from './api.mjs'

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
  const oud = () => {
    const b = beslis({ ...api, limieten: s.sessieLimieten, nu })
    return b ? { soort: 'api', naar: b.naar, reden: b.reden, ...(b.door ? { door: b.door } : {}) } : null
  }
  const rotatie = s.accounts.filter(a => a.inRotatie)
  if (rotatie.length < 2 || !i.auto) return oud()

  // Een keuze met de hand en de wachttijd van beide gaan altijd voor.
  if (typeof api.handmatigTot === 'number' && nu < api.handmatigTot) return null
  if (nu - (api.laatsteWissel ?? 0) < WACHTTIJD) return null
  if (nu - (s.laatsteWissel ?? 0) < i.wachttijd) return null

  // Accounts in de rotatie met status ok en een verse meting; de rest telt niet mee.
  const bruikbaar = rotatie
    .filter(a => a.status === 'ok')
    .map(a => ({ id: a.id, r: ruimte(s.metingen?.[a.id], i, nu) }))
    .filter(x => x.r !== null)

  if (api.modus === 'abonnement') {
    const k = kiesAccount(s)
    if (k) return { soort: 'account', ...k }
    if (bruikbaar.some(x => x.r > 0)) return null
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

// Hoeveel andere terminal-sessies nu midden in een beurt zitten. Eigen bestand `bezig` met een hartslag
// jonger dan 10 min telt; een record van Claude Code telt als de pid leeft, het geen desktop-sessie is
// en de status niet `idle` is (busy, waiting en onbekend tellen). Onleesbaar telt. De eigen sessie nooit.
export function telBezig(p) {
  const wie = new Set()
  for (const e of Array.isArray(p.eigen) ? p.eigen : []) {
    if (!e || e.sessie === p.ikzelf) continue
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
