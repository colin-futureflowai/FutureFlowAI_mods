// Proxy voor claude-or (0.16.0, 0.17.0): pure regels zonder Node-API's en zonder imports, want dit bestand wordt
// los gekopieerd naar ~/.claude/futureflow/openrouter/proxy/lib/ (naast bridge/or-proxy.mjs).
// Headers doorgeven, usage meelezen uit JSON en SSE, logregel met telling raak/mis, de stand per sessie
// en model, en de host-check tegen DNS-rebinding. De proxy bewaart nooit headers of inhoud.
// 0.17.0: vaste aanbieder per sessie en model, terugval, harde stop en modelwissel via rijen.json.

export const PROXY_POORT = 20817
// Gelijk aan `version` in .claude-plugin/plugin.json (test). Een draaiende proxy met een andere versie
// krijgt van de CLI een /_ff/stop.
export const PROXY_VERSIE = '0.17.0'
// Na zoveel ms zonder aanvraag (en zonder lopende aanvraag) stopt de proxy.
export const PROXY_STIL_MS = 1_800_000
// Het log roteert op deze grootte naar log.1.jsonl (één generatie).
export const LOG_MAX_BYTES = 10 * 1024 * 1024
// Telling: de vorige 2xx-aanvraag in dezelfde baan mag hoogstens zo lang geleden zijn.
export const TELT_VENSTER_MS = 300_000
// Telling: onder zoveel invoertokens cachet geen aanbieder; telt niet.
export const TELT_MIN_TOKENS = 1024
// Raak bij minstens zoveel % uit de cache (gelijk aan CACHE_GRENS van de cache-meting).
export const RAAK_GRENS = 50

export function proxyUrl(poort = PROXY_POORT) {
  return `http://127.0.0.1:${poort}`
}

// Headers die niet doorgaan: hop-by-hop, host en lengte (de proxy zet ze zelf), en alles voor een proxy.
const WEG = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'keep-alive', 'transfer-encoding', 'upgrade'])

// Headers van de client naar OpenRouter. Key, sessie-id en anthropic-* blijven; upstream gevraagd om
// een ongecomprimeerd antwoord, zodat de proxy de stroom kan meelezen.
export function doorHeaders(headers) {
  const uit = {}
  for (const [naam, waarde] of Object.entries(headers ?? {})) {
    if (waarde === undefined) continue
    const n = naam.toLowerCase()
    if (WEG.has(n) || n.startsWith('proxy-')) continue
    uit[naam] = waarde
  }
  uit['accept-encoding'] = 'identity'
  return uit
}

// FNV-1a, 8 hex-tekens (zelfde rekenwijze als cacheBlok in lib/openrouter.mjs).
function fnv(tekst) {
  let x = 2166136261
  for (const c of String(tekst)) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0
  return x.toString(16).padStart(8, '0')
}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)

// Model, stream en baan uit de body. De baan (hash van systeemprompt en toolnamen) houdt hoofdlus,
// subagents en losse hulpaanvragen uit elkaar zonder inhoud te bewaren.
export function aanvraagInfo(bodyTekst) {
  let d
  try {
    d = JSON.parse(bodyTekst)
  } catch {
    return { stream: false }
  }
  if (!isObj(d)) return { stream: false }
  const uit = {}
  if (typeof d.model === 'string') uit.model = d.model
  uit.stream = d.stream === true
  const heeftSystem = d.system !== undefined && d.system !== null
  const heeftTools = Array.isArray(d.tools)
  if (heeftSystem || heeftTools) {
    const system = typeof d.system === 'string' ? d.system
      : Array.isArray(d.system) ? d.system.map(b => (isObj(b) && typeof b.text === 'string' ? b.text : '')).join('') : ''
    const tools = heeftTools ? d.tools.map(t => (isObj(t) && typeof t.name === 'string' ? t.name : '')).join(',') : ''
    uit.baan = fnv(`${system.slice(0, 2000)}\n${tools}`)
  }
  return uit
}

const telling = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

function uitUsage(usage) {
  const u = isObj(usage) ? usage : {}
  const g = { in: telling(u.input_tokens), uit: telling(u.output_tokens), read: telling(u.cache_read_input_tokens), write: telling(u.cache_creation_input_tokens) }
  if (typeof u.cost === 'number' && Number.isFinite(u.cost) && u.cost >= 0) g.kosten = u.cost
  return g
}

// Usage uit een JSON-antwoord van /v1/messages (of een message_start-event).
export function gebruikUitJson(obj) {
  const d = isObj(obj) ? obj : {}
  const bericht = isObj(d.message) ? d.message : {}
  const g = uitUsage(isObj(d.usage) ? d.usage : bericht.usage)
  const kosten = g.kosten
  delete g.kosten
  const aanbieder = typeof d.provider === 'string' ? d.provider : typeof bericht.provider === 'string' ? bericht.provider : undefined
  if (aanbieder) g.aanbieder = aanbieder.slice(0, 60)
  if (kosten !== undefined) g.kosten = kosten
  return g
}

// Leest een SSE-stroom mee: message_start (message.usage, message.provider) en message_delta (usage).
// Latere waarden > 0 overschrijven eerdere. Een regel die over chunks verdeeld is, telt pas als hij compleet is.
export function maakSseLezer() {
  let rest = ''
  const g = { in: 0, uit: 0, read: 0, write: 0 }
  let aanbieder
  let kosten
  const neem = nieuw => {
    for (const k of ['in', 'uit', 'read', 'write']) if (nieuw[k] > 0) g[k] = nieuw[k]
    if (nieuw.kosten !== undefined) kosten = nieuw.kosten
  }
  const regel = r => {
    const lijn = r.endsWith('\r') ? r.slice(0, -1) : r
    if (!lijn.startsWith('data:')) return
    const data = lijn.slice(5).trim()
    if (!data || data === '[DONE]') return
    let d
    try {
      d = JSON.parse(data)
    } catch {
      return
    }
    if (!isObj(d)) return
    if (d.type === 'message_start') {
      const m = isObj(d.message) ? d.message : {}
      neem(uitUsage(m.usage))
      const a = typeof m.provider === 'string' ? m.provider : typeof d.provider === 'string' ? d.provider : undefined
      if (a) aanbieder = a.slice(0, 60)
    } else if (d.type === 'message_delta') {
      neem(uitUsage(d.usage))
      if (typeof d.provider === 'string') aanbieder = d.provider.slice(0, 60)
    }
  }
  return {
    voeg(tekst) {
      rest += String(tekst)
      const regels = rest.split('\n')
      rest = regels.pop()
      for (const r of regels) regel(r)
    },
    uit() {
      const uit = { ...g }
      if (aanbieder) uit.aanbieder = aanbieder
      if (kosten !== undefined) uit.kosten = kosten
      return uit
    },
  }
}

const is2xx = s => typeof s === 'number' && s >= 200 && s < 300
const invoer = r => (r ? telling(r.in) + telling(r.read) + telling(r.write) : 0)

// Eén logregel. `vorige` is de laatste 2xx-regel van dezelfde sessie, model en baan.
// telt-niet: geen 2xx, geen vorige, vorige > 5 min geleden, invoer < 1024, of invoer < helft van de vorige (compact).
// gewisseld: de proxy wisselde zelf van aanbieder (cache daar koud) = telt-niet. vast: er stond een vaste
// aanbieder in de body. venster: alleen tests korter (OR_PROXY_VENSTER_MS).
export function logRegel({ t, sessie, pad, info, status, gebruik, ms, fout, vorige, gewisseld, vast, venster = TELT_VENSTER_MS }) {
  const g = gebruik ?? {}
  const totaal = invoer(g)
  const aandeel = totaal ? Math.round((100 * telling(g.read)) / totaal) : 0
  let tel = 'telt-niet'
  if (!gewisseld && is2xx(status) && vorige && t - vorige.t <= venster && t >= vorige.t && totaal >= TELT_MIN_TOKENS && totaal >= invoer(vorige) / 2) {
    tel = aandeel >= RAAK_GRENS ? 'raak' : 'mis'
  }
  const regel = { t, sessie: typeof sessie === 'string' && sessie ? sessie : 'onbekend', pad }
  if (info?.model !== undefined) regel.model = info.model
  if (info?.baan !== undefined) regel.baan = info.baan
  regel.stream = info?.stream === true
  regel.status = status
  if (g.aanbieder) regel.aanbieder = g.aanbieder
  Object.assign(regel, { in: telling(g.in), uit: telling(g.uit), read: telling(g.read), write: telling(g.write), aandeel, telling: tel, ms })
  if (g.kosten !== undefined) regel.kosten = g.kosten
  if (vast) regel.vast = true
  if (fout !== undefined && fout !== null && fout !== '') regel.fout = String(fout).slice(0, 200)
  return regel
}

// Telt een regel op in de stand (per sessie → model); werkt `stand` bij en geeft hem terug.
export function werkStandBij(stand, regel) {
  const s = isObj(stand) ? stand : {}
  if (!regel || typeof regel.model !== 'string') return s
  const perSessie = (s[regel.sessie] ??= {})
  const m = (perSessie[regel.model] ??= { aanvragen: 0, raak: 0, mis: 0, in: 0, read: 0, laatst: 0 })
  m.aanvragen += 1
  if (regel.telling === 'raak') m.raak += 1
  if (regel.telling === 'mis') m.mis += 1
  m.in += invoer(regel)
  m.read += telling(regel.read)
  if (regel.aanbieder) m.aanbieder = regel.aanbieder
  m.laatst = regel.t
  return s
}

// Alleen de proxy zelf: 127.0.0.1:<poort> of localhost:<poort> (tegen DNS-rebinding).
export function geldigeHost(host, poort) {
  if (typeof host !== 'string') return false
  const h = host.toLowerCase()
  return h === `127.0.0.1:${poort}` || h === `localhost:${poort}`
}

// De eigen paden: het logboek op / en alles onder /_ff/.
export function isEigenPad(pad) {
  const p = String(pad ?? '').split('?')[0]
  return p === '/' || p.startsWith('/_ff/')
}

// Een fout in de vorm van de Anthropic-API, zodat Claude Code hem leesbaar toont.
export function foutAntwoord(bericht) {
  return { type: 'error', error: { type: 'api_error', message: String(bericht) } }
}

// ---- 0.17.0: vaste aanbieder, terugval en harde stop ----

// Zoveel missers op rij in één baan: andere aanbieder.
export const MIS_WISSEL = 2
// Zoveel missers op rij ná een wissel: het model stoppen (ergste geval vijf dure beurten: twee, één koude, twee).
export const MIS_STOP = 2
// Zo lang is een aanbieder die twee keer miste `slecht` voor dit model.
export const SLECHT_MS = 86_400_000

const naam = v => typeof v === 'string' && v !== ''

// Telt raak, mis of fout op voor een aanbieder van een model, of zet hem `slecht` tot nu + SLECHT_MS.
// Geeft een nieuw object terug; het oude blijft.
export function werkAanbiederBij(a, model, aanbieder, wat, nu) {
  const uit = isObj(a) ? { ...a } : {}
  if (!naam(model) || !naam(aanbieder)) return uit
  const perModel = { ...(isObj(uit[model]) ? uit[model] : {}) }
  const oud = isObj(perModel[aanbieder]) ? perModel[aanbieder] : {}
  const s = { raak: telling(oud.raak), mis: telling(oud.mis), fout: telling(oud.fout), laatst: telling(oud.laatst) }
  if (typeof oud.slechtTot === 'number') s.slechtTot = oud.slechtTot
  if (wat === 'raak' || wat === 'mis' || wat === 'fout') {
    s[wat] += 1
    s.laatst = nu
  } else if (wat === 'slecht') s.slechtTot = nu + SLECHT_MS
  perModel[aanbieder] = s
  uit[model] = perModel
  return uit
}

// Aanbieders die voor dit model nu `slecht` zijn.
export function slechte(a, model, nu) {
  const perModel = isObj(a) && isObj(a[model]) ? a[model] : {}
  return Object.entries(perModel).filter(([, s]) => isObj(s) && typeof s.slechtTot === 'number' && s.slechtTot > nu).map(([n]) => n)
}

// Beste bekende aanbieder: niet slecht, raak > 0, hoogste raak/(raak+mis), bij gelijk de nieuwste.
export function kiesAanbieder(a, model, nu, zonder = []) {
  const perModel = isObj(a) && isObj(a[model]) ? a[model] : {}
  const slecht = new Set(slechte(a, model, nu))
  const weg = new Set(Array.isArray(zonder) ? zonder : [])
  let beste
  for (const [n, s] of Object.entries(perModel)) {
    if (!isObj(s) || slecht.has(n) || weg.has(n) || telling(s.raak) === 0) continue
    const score = telling(s.raak) / (telling(s.raak) + telling(s.mis))
    if (!beste || score > beste.score || (score === beste.score && telling(s.laatst) > beste.laatst)) beste = { n, score, laatst: telling(s.laatst) }
  }
  return beste?.n
}

// Zet `provider` in de body: met een vaste aanbieder order zonder terugval, anders de slechte negeren.
// Een body met eigen `provider` blijft ongewijzigd (zelfde object).
export function metAanbieder(body, vast, negeer) {
  if (!isObj(body) || body.provider !== undefined) return body
  if (naam(vast)) return { ...body, provider: { order: [vast], allow_fallbacks: false } }
  if (Array.isArray(negeer) && negeer.length) return { ...body, provider: { ignore: [...negeer] } }
  return body
}

// Bij deze status van een vaste aanbieder één keer opnieuw zonder hem.
export function probeerOpnieuw(status) {
  return status === 429 || status === 404 || (typeof status === 'number' && status >= 500 && status <= 599)
}

// Missertelling per baan: wissel na MIS_WISSEL, stop na MIS_STOP ná een wissel. telt-niet laat de teller staan.
export function besluit(baan, tel) {
  const b = { mis: telling(baan?.mis), gewisseld: baan?.gewisseld === true }
  if (tel === 'raak') return { baan: { ...b, mis: 0 }, actie: 'niets' }
  if (tel !== 'mis') return { baan: b, actie: 'niets' }
  const mis = b.mis + 1
  if (!b.gewisseld && mis >= MIS_WISSEL) return { baan: { mis: 0, gewisseld: true }, actie: 'wissel' }
  if (b.gewisseld && mis >= MIS_STOP) return { baan: { mis, gewisseld: true }, actie: 'stop' }
  return { baan: { ...b, mis }, actie: 'niets' }
}

const zonder1m = x => String(x ?? '').replace(/\[1m\]$/, '')
const RIJEN = ['m1', 'm2', 'm3', 'm4', 'm5']

// Modelwissel in lopende sessies: een id dat niet meer gekozen is maar eerder in rij N stond, wordt het
// huidige model van rij N (zonder [1m]). Staat het nog in een rij, of nergens, dan blijft het.
export function wisselModel(id, nu, historie) {
  if (!naam(id)) return id
  const kaal = zonder1m(id)
  const rijen = isObj(nu) ? nu : {}
  if (RIJEN.some(r => naam(rijen[r]) && zonder1m(rijen[r]) === kaal)) return id
  let beste
  for (const r of RIJEN) {
    const lijst = isObj(historie) && Array.isArray(historie[r]) ? historie[r] : []
    for (const v of lijst) {
      if (!isObj(v) || zonder1m(v.id) !== kaal || !naam(rijen[r])) continue
      const t = telling(v.t)
      if (!beste || t > beste.t) beste = { r, t }
    }
  }
  return beste ? zonder1m(rijen[beste.r]) : id
}

// Noemt cache.json dit model zwak? (op het id zonder [1m])
export function isZwak(metingen, model) {
  if (!isObj(metingen) || !naam(model)) return false
  const m = metingen[zonder1m(model)]
  return isObj(m) && m.oordeel === 'zwak'
}

// De fout die Claude Code toont als de proxy een model weigert.
export function stopBericht(model, poort) {
  return `futureflow: ${model} cachet niet in deze sessie en is gestopt om kosten te voorkomen. Kies een ander model met /model of op http://127.0.0.1:${poort}/.`
}

// Meting die de proxy in cache.json zet bij een stop; `van` = de missers die tot de stop leidden.
export function zwakMeting(aandeel, nu) {
  return { oordeel: 'zwak', aandeel, raak: 0, van: MIS_WISSEL + MIS_STOP, gemeten: nu }
}

// Schrijvende paden (POST /_ff/…): eigen Host, x-ff: 1, JSON, en geen Origin van een andere site.
export function geldigeSchrijf({ host, origin, xff, contentType, poort }) {
  if (!geldigeHost(host, poort) || xff !== '1') return false
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) return false
  return origin === undefined || origin === `http://127.0.0.1:${poort}` || origin === `http://localhost:${poort}`
}
