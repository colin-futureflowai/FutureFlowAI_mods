// Tab OpenRouter: key-controle, de instellingen die futureflow in ~/.claude/settings.json zet en
// exact weer weghaalt, de modellijst en de kostenschatting. Pure functies, zonder Node-API's.

import { OR_HELPER, OR_SERVICE, OR_URL } from './api.mjs'

export { OR_HELPER, OR_SERVICE, OR_URL }
export const OR_ACCOUNT = 'futureflow'

// Hoogstens één keer per 6 uur de lijst opnieuw ophalen (behalve op de knop).
export const CACHE_MS = 6 * 3_600_000
// Zoveel modellen toont de tab.
export const TOON = 20

const KEY = /^sk-or-[A-Za-z0-9_-]{20,}$/
const MODEL = /^[A-Za-z0-9~][A-Za-z0-9._~-]*\/[A-Za-z0-9._:~-]+(\[1m\])?$/

export function geldigeOrKey(s) {
  return typeof s === 'string' && KEY.test(s)
}

export function geldigModel(s) {
  return typeof s === 'string' && s.length <= 120 && MODEL.test(s)
}

// Wat futureflow voor OpenRouter in settings.json zet: hoofdmodel voor opus/sonnet/fable, het snelle
// model voor haiku (ook achtergrondtaken) en subagents.
export function orInstellingen(model, snel) {
  return {
    apiKeyHelper: OR_HELPER,
    env: {
      ANTHROPIC_BASE_URL: OR_URL,
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_FABLE_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: snel,
      CLAUDE_CODE_SUBAGENT_MODEL: snel,
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    },
  }
}

const kloon = d => (d && typeof d === 'object' ? JSON.parse(JSON.stringify(d)) : {})
const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v)

// Zet `gewenst` in een kopie van `data`. Alleen wat futureflow zelf toevoegt komt in de marker; een
// sleutel die al precies die waarde heeft blijft van de gebruiker. Een andere waarde op een van onze
// sleutels: { vreemd: '<sleutel>' } en niets veranderd.
export function pasToe(data, gewenst) {
  const nieuw = kloon(data)
  const marker = { env: {} }
  if (nieuw.apiKeyHelper !== undefined && nieuw.apiKeyHelper !== gewenst.apiKeyHelper) return { vreemd: 'apiKeyHelper' }
  if (nieuw.env !== undefined && !isObject(nieuw.env)) return { vreemd: 'env' }
  if (nieuw.env === undefined) {
    nieuw.env = {}
    marker.envNieuw = true
  }
  for (const [k, v] of Object.entries(gewenst.env)) {
    const nu = nieuw.env[k]
    if (nu === undefined) {
      nieuw.env[k] = v
      marker.env[k] = v
    } else if (nu !== v) {
      return { vreemd: `env.${k}` }
    }
  }
  // De helper noemt ons sleutelhanger-item: altijd van ons, ook als hij er al stond.
  nieuw.apiKeyHelper = gewenst.apiKeyHelper
  marker.apiKeyHelper = gewenst.apiKeyHelper
  return { data: nieuw, marker }
}

// Haalt precies weg wat de marker zegt, en alleen als de waarde nog gelijk is; onze helper altijd.
// Zonder marker (kwijt): alleen waarden die futureflow zelf zou schrijven, zodat het abonnement weer
// werkt: de base-URL van OpenRouter, en met onze helper erbij ook de lege ANTHROPIC_API_KEY, de
// betas-vlag en model-ids in OpenRouter-vorm (aanbieder/model).
export function haalWeg(data, marker) {
  const nieuw = kloon(data)
  const metHelper = nieuw.apiKeyHelper === OR_HELPER
  if (metHelper) delete nieuw.apiKeyHelper
  const m = isObject(marker) ? marker : undefined
  if (isObject(nieuw.env) && m && isObject(m.env)) {
    for (const [k, v] of Object.entries(m.env)) if (nieuw.env[k] === v) delete nieuw.env[k]
    if (m.envNieuw && Object.keys(nieuw.env).length === 0) delete nieuw.env
  } else if (isObject(nieuw.env) && !m) {
    const env = nieuw.env
    const voor = Object.keys(env).length
    if (env.ANTHROPIC_BASE_URL === OR_URL) delete env.ANTHROPIC_BASE_URL
    if (metHelper) {
      if (env.ANTHROPIC_API_KEY === '') delete env.ANTHROPIC_API_KEY
      if (env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS === '1') delete env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
    }
    if (metHelper || data?.env?.ANTHROPIC_BASE_URL === OR_URL) {
      for (const k of MODEL_SLEUTELS) if (geldigModel(env[k]) && env[k].includes('/')) delete env[k]
    }
    if (voor > 0 && Object.keys(env).length === 0) delete nieuw.env
  }
  return nieuw
}

const MODEL_SLEUTELS = ['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']

// Welke base-URL van ons is: die uit de marker, en zonder marker de vaste URL van OpenRouter (dan is
// hij met haalWeg weer weg te halen en blokkeert hij het wisselen niet).
export function eigenBasis(marker) {
  if (!isObject(marker)) return OR_URL
  return isObject(marker.env) && typeof marker.env.ANTHROPIC_BASE_URL === 'string' ? marker.env.ANTHROPIC_BASE_URL : undefined
}

// Prijs per token (string of getal) → USD per miljoen tokens; undefined bij onzin of negatief.
export function perMtok(v) {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e4) / 1e4 : undefined
}

const alPerMtok = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)

// Uitvoer van GET /api/v1/models (of de CLI-uitvoer daarvan, al per Mtok) → { id, naam, context, in, uit } (prijzen per Mtok); onbruikbare weg.
export function modellenVan(ruw) {
  const lijst = Array.isArray(ruw?.data) ? ruw.data : Array.isArray(ruw) ? ruw : []
  const uit = []
  for (const m of lijst) {
    if (!m || !geldigModel(m.id)) continue
    const context = Number.isFinite(m.context_length) ? m.context_length : Number.isFinite(m.context) ? m.context : undefined
    // Van de API: per token in `pricing`; al omgerekend (uitvoer van de CLI): per Mtok in `in`/`uit`.
    const prijsIn = m.pricing ? perMtok(m.pricing.prompt) : alPerMtok(m.in)
    const prijsUit = m.pricing ? perMtok(m.pricing.completion) : alPerMtok(m.uit)
    uit.push({
      id: m.id,
      naam: typeof (m.name ?? m.naam) === 'string' ? String(m.name ?? m.naam).slice(0, 80) : m.id,
      ...(context !== undefined ? { context } : {}),
      ...(prijsIn !== undefined ? { in: prijsIn } : {}),
      ...(prijsUit !== undefined ? { uit: prijsUit } : {}),
    })
  }
  return uit
}

export const isClaude = id => typeof id === 'string' && id.startsWith('anthropic/')

// Filtert op id of naam (hoofdletters maken niet uit) en sorteert: Claude via OpenRouter eerst, dan op id.
export function sorteer(lijst, zoek) {
  const z = typeof zoek === 'string' ? zoek.trim().toLowerCase() : ''
  return (Array.isArray(lijst) ? lijst : [])
    .filter(m => !z || m.id.toLowerCase().includes(z) || String(m.naam).toLowerCase().includes(z))
    .sort((a, b) => Number(isClaude(b.id)) - Number(isClaude(a.id)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// Prijs per Mtok als tekst: $3 of $0,15; onbekend → ?.
export function prijsTekst(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?'
  const t = n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(2).replace(/0$/, '').replace(/\.0$/, '') : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return `$${t.replace('.', ',')}`
}

// Context als tekst: 200k, 1M.
export function contextTekst(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '?'
  return n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M`.replace('.', ',') : `${Math.round(n / 1000)}k`
}

const telling = n => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)

// Geschatte kosten van één beurt op OpenRouter (USD) met de prijzen van het model (per Mtok).
// Cache-tokens tellen als gewone input: OpenRouter rekent per aanbieder, dit is een bovengrens.
export function orKosten(usage, prijs) {
  if (!usage || typeof usage !== 'object' || !prijs) return 0
  const input = telling(usage.input_tokens) + telling(usage.cache_read_input_tokens) + telling(usage.cache_creation_input_tokens)
  return (input * telling(prijs.in) + telling(usage.output_tokens) * telling(prijs.uit)) / 1_000_000
}
