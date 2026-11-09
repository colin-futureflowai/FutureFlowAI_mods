// Tab API: key-controle, wisselbesluit (abonnement ↔ API) en kostenschatting. Pure functies, zonder Node-API's.

// Sleutelhanger-item en de apiKeyHelper die futureflow in ~/.claude/settings.json zet of weghaalt.
export const SERVICE = 'futureflow-anthropic-api'
export const ACCOUNT = 'futureflow'
export const HELPER = '/usr/bin/security find-generic-password -s futureflow-anthropic-api -a futureflow -w'

// Minimale tijd tussen twee wissels (ms), zodat auto niet heen en weer springt.
export const WACHTTIJD = 5 * 60_000

export const STANDAARD = { modus: 'abonnement', auto: false, hoog: 90, laag: 50, laatsteWissel: 0 }

const KEY = /^sk-ant-[A-Za-z0-9_-]{20,}$/

export function geldigeKey(s) {
  return typeof s === 'string' && KEY.test(s)
}

// Alleen het begin en de laatste 4 tekens; nooit de hele key.
export function masker(s) {
  return typeof s === 'string' && s.length >= 4 ? `sk-ant-…${s.slice(-4)}` : 'sk-ant-…'
}

// Geschatte prijzen in USD per miljoen tokens (input / output / cache lezen / cache schrijven 5 min),
// stand 2026-11-09 volgens de prijspagina van Anthropic. Schattingen: de factuur kan afwijken.
export const PRIJZEN = {
  opus: { input: 15, output: 75, cacheLezen: 1.5, cacheSchrijven: 18.75 },
  sonnet: { input: 3, output: 15, cacheLezen: 0.3, cacheSchrijven: 3.75 },
  haiku: { input: 1, output: 5, cacheLezen: 0.1, cacheSchrijven: 1.25 },
}

const telling = n => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)

// Modelfamilie uit het model-id (`claude-opus-4-…` → opus); onbekend → sonnet.
export function familie(model) {
  const m = typeof model === 'string' ? model.toLowerCase() : ''
  for (const f of ['opus', 'sonnet', 'haiku']) if (m.includes(f)) return f
  return 'sonnet'
}

// Kosten van één beurt in USD.
export function kosten(usage, prijzen = PRIJZEN) {
  if (!usage || typeof usage !== 'object') return 0
  const p = prijzen[familie(usage.model)] ?? prijzen.sonnet ?? PRIJZEN.sonnet
  const som =
    telling(usage.input_tokens) * p.input +
    telling(usage.output_tokens) * p.output +
    telling(usage.cache_read_input_tokens) * p.cacheLezen +
    telling(usage.cache_creation_input_tokens) * p.cacheSchrijven
  return som / 1_000_000
}

// Rate-limit-soort → label: five_hour → 5u, seven_day → 7d, seven_day_opus → 7d opus.
export function limietLabel(kind) {
  const naam = String(kind ?? '').toLowerCase()
  if (naam.includes('five') || naam.includes('5h')) return '5u'
  if (naam.includes('seven') || naam.includes('7d') || naam.includes('week')) {
    const rest = naam.replace(/seven_day|seven|7d|weekly|week/g, '').replace(/_/g, ' ').trim()
    return rest ? `7d ${rest}` : '7d'
  }
  return naam.replace(/_/g, ' ')
}

// De abonnementsvensters (5u en 7d) uit `rateLimits`; een spend-limit van een gateway telt niet.
export function limietenVan(rateLimits) {
  const uit = []
  for (const l of Array.isArray(rateLimits) ? rateLimits : []) {
    if (!l || typeof l !== 'object' || typeof l.percentUsed !== 'number' || !Number.isFinite(l.percentUsed)) continue
    const label = limietLabel(l.kind)
    if (!label.startsWith('5u') && !label.startsWith('7d')) continue
    const resetsAt = typeof l.resetsAt === 'string' ? Date.parse(l.resetsAt) : NaN
    uit.push({ label, percent: l.percentUsed, ...(Number.isNaN(resetsAt) ? {} : { resetsAt }) })
  }
  return uit
}

const getal = (v, min, max, standaard) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : standaard)

// De bewaarde toestand, aangevuld met standaarden; onzin wordt de standaard.
export function toestandVan(ruw) {
  const r = ruw && typeof ruw === 'object' ? ruw : {}
  const t = {
    modus: r.modus === 'api' ? 'api' : 'abonnement',
    auto: r.auto === true,
    hoog: getal(r.hoog, 50, 100, STANDAARD.hoog),
    laag: getal(r.laag, 0, 90, STANDAARD.laag),
    laatsteWissel: typeof r.laatsteWissel === 'number' && Number.isFinite(r.laatsteWissel) ? r.laatsteWissel : 0,
  }
  if (t.laag >= t.hoog) t.laag = Math.min(STANDAARD.laag, t.hoog - 1)
  const d = r.overgeschakeldDoor
  if (d && typeof d === 'object' && typeof d.label === 'string') {
    t.overgeschakeldDoor = { label: d.label, ...(typeof d.resetsAt === 'number' && Number.isFinite(d.resetsAt) ? { resetsAt: d.resetsAt } : {}) }
  }
  return t
}

// Wisselen of niet. Naar API: auto aan, modus abonnement en een venster ≥ hoog (het volste telt).
// Terug: modus api en overgeschakeld door een venster; is dat venster gemeten (en nog niet verlopen),
// dan pas onder `laag`, anders pas na zijn resetsAt. Nooit binnen WACHTTIJD na de vorige wissel.
export function beslis(s) {
  const nu = s.nu
  if (nu - (s.laatsteWissel ?? 0) < WACHTTIJD) return null
  const limieten = Array.isArray(s.limieten) ? s.limieten : []

  if (s.modus === 'abonnement') {
    if (!s.auto) return null
    const vol = limieten.filter(l => l.percent >= s.hoog).sort((a, b) => b.percent - a.percent)[0]
    if (!vol) return null
    return {
      naar: 'api',
      reden: `${vol.label}-venster op ${vol.percent}% (grens ${s.hoog}%)`,
      door: { label: vol.label, ...(vol.resetsAt !== undefined ? { resetsAt: vol.resetsAt } : {}) },
    }
  }

  if (s.modus === 'api' && s.overgeschakeldDoor) {
    const door = s.overgeschakeldDoor
    const gemeten = limieten.find(l => l.label === door.label && (l.resetsAt === undefined || l.resetsAt > nu))
    if (gemeten) {
      return gemeten.percent < s.laag ? { naar: 'abonnement', reden: `${door.label}-venster op ${gemeten.percent}% (onder ${s.laag}%)` } : null
    }
    if (door.resetsAt !== undefined && nu >= door.resetsAt) return { naar: 'abonnement', reden: `${door.label}-venster is gereset` }
  }
  return null
}

const twee = n => String(n).padStart(2, '0')

// Lokale datum als sleutel voor de kostenstore: 2026-11-09.
export function dagSleutel(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${twee(d.getMonth() + 1)}-${twee(d.getDate())}`
}

// Telt bedrag op bij de dag; houdt de laatste 62 dagen.
export function telOp(perDag, dag, bedrag) {
  const oud = perDag && typeof perDag === 'object' ? perDag : {}
  const nieuw = { ...oud, [dag]: telling(oud[dag]) + telling(bedrag) }
  const dagen = Object.keys(nieuw).sort()
  for (const d of dagen.slice(0, Math.max(0, dagen.length - 62))) delete nieuw[d]
  return nieuw
}

// Kosten vandaag en deze kalendermaand.
export function kostenOverzicht(perDag, ms) {
  const p = perDag && typeof perDag === 'object' ? perDag : {}
  const dag = dagSleutel(ms)
  const maand = dag.slice(0, 7)
  let deMaand = 0
  for (const [d, v] of Object.entries(p)) if (d.startsWith(maand)) deMaand += telling(v)
  return { vandaag: telling(p[dag]), maand: deMaand }
}

// $ 1,23; onder een cent maar niet nul: < $ 0,01.
export function usd(n) {
  const v = telling(n)
  if (v > 0 && v < 0.005) return '< $ 0,01'
  return `$ ${v.toFixed(2).replace('.', ',')}`
}
